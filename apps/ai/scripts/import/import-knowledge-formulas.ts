// apps/ai/scripts/import/import-knowledge-formulas.ts
import type { Db } from "mongodb";
import type { GovernedKnowledgeVectorPort } from "../../server/services/knowledge/qdrant-collections";
import { is_dry_run, knowledge_ingest_config, mongo_uri, target_identity } from "./import.config";
import { ImportReport } from "./lib/report";
import {
  build_tenant_knowledge_point,
  map_formula_doc,
  type ImportedFormulaDoc,
} from "./map-knowledge";

/** Injected ports for one formula-knowledge ingest run. */
export interface FormulaKnowledgeDeps {
  /** Governed tenant upsert (enforces the tenant payload contract). */
  readonly vector_port: Pick<GovernedKnowledgeVectorPort, "upsert_tenant">;
  /** Batch embedder. */
  readonly embed_many: (texts: string[]) => Promise<number[][]>;
  /** Pinned embedding version stamped on every payload. */
  readonly embedding_version: string;
  /** Owning tenant — the ONLY tenant read and the ONLY tenant written. */
  readonly tenant_id: string;
  /** Formulas embedded/upserted per batch. */
  readonly batch_size: number;
  /** Read + report only. */
  readonly dry_run: boolean;
}

/** Result of one formula-knowledge ingest run. */
export interface FormulaKnowledgeResult {
  readonly points_upserted: number;
  readonly report: ImportReport;
}

/**
 * Ingest the tenant's imported formulas as tenant-scoped knowledge points
 * ("similar past formulas"). Idempotent: deterministic point ids by
 * source_id, and the query is hard-filtered to the target tenant.
 *
 * @param db - Connected Mongo database holding the `formulas` collection.
 * @param deps - Injected vector/embedding ports and run flags.
 * @returns Upsert count and the integrity report.
 */
export async function import_formula_knowledge(
  db: Db,
  deps: FormulaKnowledgeDeps,
): Promise<FormulaKnowledgeResult> {
  console.log("[import:knowledge:formulas] start", {
    tenant_id: deps.tenant_id,
    dry_run: deps.dry_run,
  });
  const report = new ImportReport("knowledge:formulas");
  const cursor = db
    .collection("formulas")
    .find({ tenantId: deps.tenant_id })
    .batchSize(deps.batch_size);
  let points_upserted = 0;
  let batch: ImportedFormulaDoc[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    report.read(batch.length);
    const docs = [];
    for (const formula of batch) {
      const doc = map_formula_doc(formula);
      if (!doc) {
        report.skipped("missing rd_formula_id or name");
        continue;
      }
      docs.push(doc);
    }
    if (docs.length > 0 && !deps.dry_run) {
      const vectors = await deps.embed_many(docs.map((doc) => doc.text));
      const points = docs.map((doc, index) =>
        build_tenant_knowledge_point(deps.tenant_id, doc, vectors[index]!, deps.embedding_version),
      );
      await deps.vector_port.upsert_tenant({ tenant_id: deps.tenant_id }, points);
    }
    points_upserted += docs.length;
    report.upserted(docs.length);
    batch = [];
  };

  for await (const formula of cursor) {
    batch.push(formula as unknown as ImportedFormulaDoc);
    if (batch.length >= deps.batch_size) await flush();
  }
  await flush();
  console.log("[import:knowledge:formulas] done", { points_upserted });
  return { points_upserted, report };
}

/** CLI entry: tenant formulas → governed tenant knowledge. */
async function run_cli(): Promise<void> {
  const config = knowledge_ingest_config();
  void mongo_uri(); // validate the Mongo env early
  const { tenant_id } = target_identity();
  const dry_run = is_dry_run();

  const { GeminiEmbeddingService } = await import("../../services/embeddings/gemini-embedding-service");
  const { create_knowledge_qdrant_driver } = await import("../../services/vector/qdrant-service");
  const { create_qdrant_knowledge_adapter } = await import("../../server/services/knowledge/qdrant-collections");
  const { default: client_promise } = await import("@rnd-ai/shared-database");

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

  const client = await client_promise;
  try {
    const { report, points_upserted } = await import_formula_knowledge(client.db(), {
      vector_port,
      embed_many: (texts) => embedding.createEmbeddings(texts),
      embedding_version: config.embedding_version,
      tenant_id,
      batch_size: config.batch_size,
      dry_run,
    });
    console.log(report.summary());
    console.log(
      `[import:knowledge:formulas] points=${points_upserted}` +
        (dry_run ? " (dry-run — no embeds, no writes)" : ""),
    );
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.includes("import-knowledge-formulas")) {
  run_cli().catch((e) => {
    console.error("[import:knowledge:formulas] failed:", e?.message ?? e);
    process.exitCode = 1;
  });
}
