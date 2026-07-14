/**
 * Public surface of the governed agentic orchestration package.
 *
 * Consumers (the AI gateway and tests) import only from this entrypoint;
 * everything here is dependency-isolated from legacy agent implementations.
 */
export * from "./version";
export * from "./ports";
