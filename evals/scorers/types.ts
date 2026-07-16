/** Shared result contract for deterministic commercial scorers. */
export interface DeterministicScore {
  readonly passed: boolean;
  readonly failures: string[];
}

/**
 * Deduplicate stable failure codes while retaining first-observed order.
 *
 * @param failures - Failure codes emitted by one or more scorers.
 * @returns Ordered unique failure codes.
 */
export function unique_failures(failures: readonly string[]): string[] {
  return [...new Set(failures)];
}
