// apps/ai/scripts/import/lib/csv.ts
import { readFileSync, createReadStream } from "node:fs";
import { parse } from "csv-parse/sync";
import { parse as parse_stream } from "csv-parse";

/**
 * Read a CSV file into plain string records keyed by header.
 * Uses csv-parse in sync mode; handles quoted fields with embedded commas
 * and newlines (the legacy INCI columns rely on this).
 *
 * @param path - Absolute or repo-relative path to the CSV file.
 * @returns One object per data row, values as trimmed strings.
 */
export function read_csv_records(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
  return records;
}

/**
 * Stream a CSV file as batches of records without loading it into memory.
 * Required for the 125.8 MB myskin scrape; small files may keep using
 * read_csv_records. Handles a UTF-8 BOM and quoted embedded newlines.
 *
 * @param path - Absolute path to the CSV file.
 * @param batch_size - Records per yielded batch (positive integer).
 * @yields Arrays of header-keyed string records, in file order.
 */
export async function* stream_csv_batches(
  path: string,
  batch_size: number,
): AsyncGenerator<Record<string, string>[]> {
  console.log("[csv] stream_csv_batches — start", { path, batch_size });
  const parser = createReadStream(path).pipe(
    parse_stream({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }),
  );
  let batch: Record<string, string>[] = [];
  for await (const record of parser) {
    batch.push(record as Record<string, string>);
    if (batch.length >= batch_size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
  console.log("[csv] stream_csv_batches — done", { path });
}
