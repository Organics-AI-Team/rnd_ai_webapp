// apps/ai/scripts/import/lib/report.ts

/** Accumulates per-import counters and renders a printable integrity summary. */
export class ImportReport {
  private read_count = 0;
  private upserted_count = 0;
  private readonly skip_reasons = new Map<string, number>();

  /** @param label - Dataset label shown in the summary. */
  constructor(private readonly label: string) {}

  /** Record N rows read from source. */
  read(n: number): void {
    this.read_count += n;
  }

  /** Record N rows upserted to the target. */
  upserted(n: number): void {
    this.upserted_count += n;
  }

  /** Record one skipped row with a reason (reasons are tallied). */
  skipped(reason: string): void {
    this.skip_reasons.set(reason, (this.skip_reasons.get(reason) ?? 0) + 1);
  }

  /** Total number of skipped rows across all reasons. */
  private skip_total(): number {
    let t = 0;
    for (const n of this.skip_reasons.values()) t += n;
    return t;
  }

  /** Render a one-block human-readable summary. */
  summary(): string {
    const reasons = [...this.skip_reasons.entries()].map(([r, n]) => `    - ${r}: ${n}`).join("\n");
    return [
      `[import:${this.label}] read=${this.read_count} upserted=${this.upserted_count} skipped=${this.skip_total()}`,
      reasons,
    ]
      .filter(Boolean)
      .join("\n");
  }
}
