/** Read-only governed tool execution for G5 shadow evaluation. */
import { z } from "zod";

import { hash_canonical } from "./hashing";
import type { ToolCatalogue } from "./tool-catalogue";
import type { SideEffectClass } from "./tool-definition";

export interface SimulationToolCall {
  readonly name: string;
  readonly arguments: unknown;
}

export interface SimulationContext {
  readonly tenant_id?: string;
  readonly run_id?: string;
  readonly correlation_id?: string;
}

export interface ReadOnlyToolExecutor {
  execute(call: SimulationToolCall, context?: SimulationContext): Promise<unknown>;
}

export interface SimulatedSideEffect {
  readonly code: "SIDE_EFFECT_SUPPRESSED";
  readonly tool_name: string;
  readonly side_effect: Exclude<SideEffectClass, "read">;
  readonly simulated: true;
}

export interface ShadowToolIntent {
  readonly tool_name: string;
  readonly side_effect: Exclude<SideEffectClass, "read">;
  readonly arguments_hash: string;
  readonly tenant_id?: string;
  readonly run_id?: string;
}

export interface SimulationAuditPort {
  record_would_have_called(intent: ShadowToolIntent): Promise<void>;
}

const simulated_side_effect_schema = z.object({
  code: z.literal("SIDE_EFFECT_SUPPRESSED"),
  tool_name: z.string().min(1),
  side_effect: z.enum(["draft_write", "commit"]),
  simulated: z.literal(true),
}).strict();

export class SimulationToolError extends Error {
  readonly code: "TOOL_UNKNOWN" | "TOOL_INPUT_INVALID" | "TOOL_OUTPUT_INVALID";

  constructor(code: SimulationToolError["code"]) {
    super("The shadow tool call could not be simulated safely.");
    this.name = "SimulationToolError";
    this.code = code;
  }
}

/**
 * Executes reads through an injected read-only executor and suppresses every
 * draft/commit implementation before it can touch production state.
 */
export class SimulationToolExecutor {
  constructor(
    private readonly catalogue: ToolCatalogue,
    private readonly read_only_executor: ReadOnlyToolExecutor,
    private readonly audit: SimulationAuditPort,
  ) {}

  async execute(
    call: SimulationToolCall,
    context: SimulationContext = {},
  ): Promise<unknown> {
    const definition = this.catalogue.get(call.name);
    if (!definition) throw new SimulationToolError("TOOL_UNKNOWN");
    const input = definition.input_schema.safeParse(call.arguments);
    if (!input.success) throw new SimulationToolError("TOOL_INPUT_INVALID");

    if (definition.side_effect === "read") {
      const output = await this.read_only_executor.execute(
        { name: definition.name, arguments: input.data },
        context,
      );
      const parsed = definition.output_schema.safeParse(output);
      if (!parsed.success) throw new SimulationToolError("TOOL_OUTPUT_INVALID");
      return parsed.data;
    }

    const intent: ShadowToolIntent = {
      tool_name: definition.name,
      side_effect: definition.side_effect,
      arguments_hash: hash_canonical(input.data),
      ...(context.tenant_id ? { tenant_id: context.tenant_id } : {}),
      ...(context.run_id ? { run_id: context.run_id } : {}),
    };
    await this.audit.record_would_have_called(Object.freeze(intent));
    return simulated_side_effect_schema.parse({
      code: "SIDE_EFFECT_SUPPRESSED",
      tool_name: definition.name,
      side_effect: definition.side_effect,
      simulated: true,
    });
  }
}
