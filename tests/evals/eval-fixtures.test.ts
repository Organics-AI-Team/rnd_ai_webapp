import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  eval_case_v1_schema,
  type EvalCaseV1,
} from "../../evals/schemas/eval-case";

const fixture_directory = join(process.cwd(), "evals/fixtures/v1");
const fixture_categories = {
  "clarification-approval.jsonl": "clarification_approval",
  "formulation.jsonl": "formulation",
  "raw-materials.jsonl": "raw_materials",
  "sales-rnd.jsonl": "sales_rnd",
  "security.jsonl": "security",
} as const;
const expected_file_counts = {
  "clarification-approval.jsonl": 25,
  "formulation.jsonl": 25,
  "raw-materials.jsonl": 25,
  "sales-rnd.jsonl": 25,
  "security.jsonl": 50,
} as const;
const required_security_scenarios = [
  "approval_spoofing",
  "budget_exhaustion",
  "expired_checkpoint",
  "platform_admin_without_support_grant",
  "prompt_injection",
  "retrieved_instruction_injection",
  "tenant_isolation",
  "tool_argument_injection",
  "unsupported_claim",
  "webhook_replay",
] as const;
const forbidden_public_identity_keys = new Set([
  "actor_id",
  "api_key",
  "model",
  "permissions",
  "policy_id",
  "provider",
  "role",
  "support_access_grant",
  "tenant_id",
  "tool_allowlist",
  "user_id",
]);
const expected_corpus_sha256 = "2a2083f316fef7c3d6f69f2bf54569e1b60c958978a92621e82d3f97dc900f3c";

/**
 * Load and parse one immutable JSON Lines fixture.
 *
 * @param file_name - Corpus file name relative to the v1 fixture directory.
 * @returns Parsed JSON values in their on-disk order.
 */
function load_jsonl_file(file_name: keyof typeof fixture_categories): unknown[] {
  return readFileSync(join(fixture_directory, file_name), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/**
 * Validate every fixture and retain its source file for category assertions.
 *
 * @returns Validated cases paired with their corpus file names.
 */
function load_validated_cases(): Array<{
  file_name: keyof typeof fixture_categories;
  value: EvalCaseV1;
}> {
  return Object.keys(fixture_categories).flatMap((file_name) =>
    load_jsonl_file(file_name as keyof typeof fixture_categories).map((value) => ({
      file_name: file_name as keyof typeof fixture_categories,
      value: eval_case_v1_schema.parse(value),
    })),
  );
}

/**
 * Collect object keys recursively without retaining any fixture values.
 *
 * @param value - Public input value to inspect.
 * @returns Every nested object key present in the value.
 */
function collect_object_keys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collect_object_keys);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [key, ...collect_object_keys(nested)]);
}

/**
 * Hash the byte-stable corpus with file names as domain separators.
 *
 * @returns Lowercase SHA-256 digest for the complete v1 fixture set.
 */
function corpus_sha256(): string {
  const hash = createHash("sha256");
  for (const file_name of Object.keys(fixture_categories).sort()) {
    const file_path = join(fixture_directory, file_name);
    hash.update(`${basename(file_path)}\n`, "utf8");
    hash.update(readFileSync(file_path));
  }
  return hash.digest("hex");
}

describe("commercial evaluation corpus v1", () => {
  it("validates every evaluation case and unique ID", () => {
    const cases = load_validated_cases().map(({ value }) => value);

    expect(cases).toHaveLength(150);
    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
    expect(cases.every(({ id }) => /^eval_v1_[a-z0-9_]+$/.test(id))).toBe(true);

    const with_unknown_field = { ...cases[0], unexpected: true };
    expect(eval_case_v1_schema.safeParse(with_unknown_field).success).toBe(false);
  });

  it("keeps exact per-file counts, categories, and synthetic provenance", () => {
    const cases = load_validated_cases();

    for (const [file_name, category] of Object.entries(fixture_categories)) {
      const file_cases = cases.filter((entry) => entry.file_name === file_name);
      expect(file_cases, file_name).toHaveLength(
        expected_file_counts[file_name as keyof typeof expected_file_counts],
      );
      expect(file_cases.every(({ value }) => value.category === category), file_name).toBe(true);
      expect(
        file_cases.every(
          ({ value }) =>
            value.data_classification === "synthetic" &&
            value.provenance.origin === "purpose_built_synthetic" &&
            value.provenance.redaction_status === "not_applicable" &&
            value.provenance.review_status === "approved",
        ),
        file_name,
      ).toBe(true);
    }
  });

  it("keeps public input identity-free and complete expected outcomes", () => {
    const cases = load_validated_cases().map(({ value }) => value);

    for (const test_case of cases) {
      const public_keys = collect_object_keys(test_case.input);
      expect(
        public_keys.filter((key) => forbidden_public_identity_keys.has(key)),
        test_case.id,
      ).toEqual([]);
      expect(test_case.deterministic_checks.length, test_case.id).toBeGreaterThan(0);
      expect(test_case.rubric.criteria.length, test_case.id).toBeGreaterThan(0);
      expect(
        test_case.rubric.criteria.reduce((total, criterion) => total + criterion.weight, 0),
        test_case.id,
      ).toBeCloseTo(1, 10);
      expect(
        test_case.expected_tools.filter((tool) => test_case.forbidden_tools.includes(tool)),
        test_case.id,
      ).toEqual([]);
      expect(
        test_case.expected_behavior.allowed_side_effects.filter((effect) =>
          test_case.expected_behavior.forbidden_side_effects.includes(effect),
        ),
        test_case.id,
      ).toEqual([]);
    }

    expect(
      eval_case_v1_schema.safeParse({
        ...cases[0],
        input: { ...cases[0].input, tenant_id: "tenant_a" },
      }).success,
    ).toBe(false);
  });

  it("encodes exact deterministic formulation constraints", () => {
    const formula_cases = load_validated_cases()
      .map(({ value }) => value)
      .filter(({ category }) => category === "formulation");

    for (const test_case of formula_cases) {
      const constraints = test_case.expected_artifact.formula_constraints;
      expect(constraints, test_case.id).not.toBeNull();
      expect(constraints?.total_percent.target, test_case.id).toBe(100);
      expect(constraints?.total_percent.tolerance, test_case.id).toBe(0.01);
      expect(constraints?.usage_limits.length, test_case.id).toBeGreaterThan(0);
      expect(constraints?.incompatibilities.length, test_case.id).toBeGreaterThan(0);
      expect(constraints?.phase_requirements.length, test_case.id).toBeGreaterThan(0);
      expect(constraints?.maximum_cost_thb_per_kg, test_case.id).toBeGreaterThan(0);
      expect(constraints?.manager_confirmation_required, test_case.id).toBe(true);
      expect(test_case.approval.required, test_case.id).toBe(true);
      expect(test_case.approval.approver_role, test_case.id).toBe("manager");
    }
  });

  it("covers every required security scenario and both tenant fixtures", () => {
    const security_cases = load_validated_cases()
      .map(({ value }) => value)
      .filter(({ category }) => category === "security");

    expect(
      [...new Set(security_cases.map(({ security_scenario }) => security_scenario))].sort(),
    ).toEqual([...required_security_scenarios].sort());
    expect(new Set(security_cases.map(({ tenant_fixture }) => tenant_fixture))).toEqual(
      new Set(["tenant_a", "tenant_b"]),
    );
    expect(
      security_cases.some(
        ({ security_scenario, actor_fixture }) =>
          security_scenario === "platform_admin_without_support_grant" &&
          actor_fixture === "actor_platform_admin_no_grant",
      ),
    ).toBe(true);
  });

  it("pins the immutable corpus SHA-256", () => {
    const digest = corpus_sha256();
    console.info(`eval corpus v1 sha256: ${digest}`);
    expect(digest).toBe(expected_corpus_sha256);
  });
});
