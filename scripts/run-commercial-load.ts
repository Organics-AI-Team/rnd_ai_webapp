/** CLI for the credential-free, in-process commercial load campaign (G5.8). */

import { run_commercial_load_campaign } from "../tests/load/commercial-ai-load";

/** Parse the only supported bounded CLI option. */
export function parse_load_args(args: readonly string[]): { repetitions: number } {
  if (args.length === 0) return { repetitions: 3 };
  if (args.length !== 1 || !args[0]?.startsWith("--repetitions=")) {
    throw new Error("commercial load arguments are invalid");
  }
  const repetitions = Number(args[0].slice("--repetitions=".length));
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new Error("commercial load arguments are invalid");
  }
  return { repetitions };
}

/** Silence expected coordinator info logs while preserving errors and restoring state. */
export async function run_quietly<T>(operation: () => Promise<T>): Promise<T> {
  const original = console.info;
  console.info = () => undefined;
  try {
    return await operation();
  } finally {
    console.info = original;
  }
}

/** Run the campaign and emit one JSON evidence document to stdout. */
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parse_load_args(args);
  const result = await run_quietly(() => run_commercial_load_campaign(options));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

const invoked_directly = process.argv[1]?.endsWith("run-commercial-load.ts") ?? false;
if (invoked_directly) {
  main().catch((error) => {
    console.error(
      "commercial load failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });
}
