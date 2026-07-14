/**
 * Public surface of the governed agentic orchestration package.
 *
 * Consumers (the AI gateway and tests) import only from this entrypoint;
 * everything here is dependency-isolated from legacy agent implementations.
 */
export * from "./version";
export * from "./ports";
export * from "./hash";
export * from "./contracts";
export * from "./context/context-pack";
export * from "./schemas/observation";
export * from "./state";
export * from "./graph";
