// apps/ai/scripts/import/import-knowledge-market.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { GovernedKnowledgeVectorPort } from "../../server/services/knowledge/qdrant-collections";
import { DATASETS, is_dry_run, knowledge_ingest_config } from "./import.config";
import { stream_csv_batches } from "./lib/csv";
import { ImportReport } from "./lib/report";
import { build_platform_knowledge_point, map_myskin_row } from "./map-knowledge";

/** Injected ports for one market-knowledge ingest run. */
export interface MarketKnowledgeDeps {
  /** Governed platform upsert (the ONLY Qdrant surface used). */
  readonly vector_port: Pick<GovernedKnowledgeVectorPort, "upsert_platform">;
  /** Batch embedder (real: GeminiEmbeddingService.createEmbeddings). */
  readonly embed_many: (texts: string[]) => Promise<number[][]>;
  /** Pinned embedding version stamped on every payload. */
  readonly embedding_version: string;
  /** Parse + report only; no embeds, no upserts. */
  readonly dry_run: boolean;
  /** Global row index to resume from (rows before it are skipped silently). */
  readonly start_row: number;
  /** Called after each processed batch with the next resume row index. */
  readonly on_batch_done?: (next_row: number) => Promise<void> | void;
}

/** Result of one market-knowledge ingest run. */
export interface MarketKnowledgeResult {
  readonly points_upserted: number;
  readonly next_row: number;
  readonly report: ImportReport;
}

/**
 * Ingest myskin scrape batches into the governed platform knowledge
 * collection. Idempotent: point ids derive from source_id, so re-running
 * overwrites the same points. Resumable via start_row + on_batch_done.
 *
 * @param batches - Row batches (async or sync iterable; real runs stream).
 * @param deps - Injected vector/embedding ports and run flags.
 * @returns Upsert count, next resume row, and the integrity report.
 */
export async function import_market_knowledge(
  batches: AsyncIterable<Record<string, string>[]> | Iterable<Record<string, string>[]>,
  deps: MarketKnowledgeDeps,
): Promise<MarketKnowledgeResult> {
  console.log("[import:knowledge:market] start", {
    dry_run: deps.dry_run,
    start_row: deps.start_row,
  });
  const report = new ImportReport("knowledge:market");
  const seen = new Set<string>();
  let row_index = 0;
  let points_upserted = 0;

  for await (const batch of batches) {
    const kept: Record<string, string>[] = [];
    for (const row of batch) {
      if (row_index >= deps.start_row) kept.push(row);
      row_index += 1;
    }
    if (kept.length === 0) continue;
    report.read(kept.length);

    const docs = [];
    for (const row of kept) {
      const doc = map_myskin_row(row);
      if (!doc) {
        report.skipped("missing sku/id/url or name");
        continue;
      }
      if (seen.has(doc.source_id)) {
        report.skipped("duplicate source_id in source");
        continue;
      }
      seen.add(doc.source_id);
      docs.push(doc);
    }

    if (docs.length > 0 && !deps.dry_run) {
      const vectors = await deps.embed_many(docs.map((doc) => doc.text));
      const points = docs.map((doc, index) =>
        build_platform_knowledge_point(doc, vectors[index]!, deps.embedding_version),
      );
      await deps.vector_port.upsert_platform(points);
    }
    points_upserted += docs.length;
    report.upserted(docs.length);
    await deps.on_batch_done?.(row_index);
  }
  console.log("[import:knowledge:market] done", { points_upserted, next_row: row_index });
  return { points_upserted, next_row: row_index, report };
}

/** Read the resume row from the progress file (0 when absent/corrupt). */
export function read_progress(progress_file: string): number {
  if (!existsSync(progress_file)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(progress_file, "utf8")) as { next_row?: number };
    return Number.isSafeInteger(parsed.next_row) && parsed.next_row! > 0 ? parsed.next_row! : 0;
  } catch {
    return 0;
  }
}

/** Persist the resume row after a completed batch. */
export function write_progress(progress_file: string, next_row: number): void {
  writeFileSync(progress_file, JSON.stringify({ next_row }), "utf8");
}

/** Fixed delay between batches (embedding rate-limit friendliness). */
function delay(duration_ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration_ms));
}

/** CLI entry: stream the myskin CSV → governed platform knowledge. */
async function run_cli(): Promise<void> {
  const config = knowledge_ingest_config();
  const dry_run = is_dry_run();
  const from_start = process.argv.includes("--from-start");
  const start_row = from_start ? 0 : read_progress(config.progress_file);

  // Lazy imports keep unit tests free of eager Qdrant/Gemini construction.
  const { GeminiEmbeddingService } = await import("../../services/embeddings/gemini-embedding-service");
  const { create_knowledge_qdrant_driver } = await import("../../services/vector/qdrant-service");
  const { create_qdrant_knowledge_adapter } = await import("../../server/services/knowledge/qdrant-collections");

  const embedding = new GeminiEmbeddingService(config.gemini_api_key, {
    model: config.embedding_model,
    dimensions: config.embedding_dimensions,
    batchSize: 16,
  });
  const vector_port = create_qdrant_knowledge_adapter({
    driver: create_knowledge_qdrant_driver(),
    embedding_version: config.embedding_version,
    vector_size: config.embedding_dimensions,
  });
  if (!dry_run) await vector_port.ensure_collections();

  const { report, points_upserted, next_row } = await import_market_knowledge(
    stream_csv_batches(DATASETS.myskin.source, config.batch_size),
    {
      vector_port,
      embed_many: (texts) => embedding.createEmbeddings(texts),
      embedding_version: config.embedding_version,
      dry_run,
      start_row,
      on_batch_done: async (next) => {
        if (!dry_run) {
          write_progress(config.progress_file, next);
          await delay(config.batch_delay_ms);
        }
      },
    },
  );
  console.log(report.summary());
  console.log(
    `[import:knowledge:market] points=${points_upserted} next_row=${next_row}` +
      (dry_run ? " (dry-run — no embeds, no writes)" : ""),
  );
}

if (process.argv[1]?.includes("import-knowledge-market")) {
  run_cli().catch((e) => {
    console.error("[import:knowledge:market] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
