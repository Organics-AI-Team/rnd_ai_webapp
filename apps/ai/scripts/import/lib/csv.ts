// apps/ai/scripts/import/lib/csv.ts
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

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
