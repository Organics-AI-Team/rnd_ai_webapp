import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository_root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const schema_source = readFileSync(join(repository_root, "prisma/schema.prisma"), "utf8");

const tenant_owned_models = [
  "Product",
  "StockEntry",
  "Formula",
  "FormulaVersionLog",
  "FormulaComment",
  "Order",
  "CreditTransaction",
  "ProductLog",
  "Conversation",
  "Feedback",
  "AiResponse",
  "ChatThread",
  "ChatMessage",
  "PriceCalculation",
];

/**
 * Extract one model block from the Prisma schema.
 *
 * @param name - Model name.
 * @returns Block text between "model X {" and its closing brace.
 */
function model_block(name: string): string {
  const match = schema_source.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`model not found: ${name}`);
  return match[0];
}

describe("tenant provenance schema (G2.2)", () => {
  it.each(tenant_owned_models)("%s declares nullable tenantId ObjectId", (name) => {
    expect(model_block(name)).toMatch(/tenantId\s+String\?\s+@db\.ObjectId/);
  });

  it.each([
    ["FormulaComment", /@@index\(\[tenantId, formulaId/],
    ["FormulaVersionLog", /@@index\(\[tenantId, formulaId/],
    ["ChatMessage", /@@index\(\[tenantId, threadId\]/],
    ["ChatThread", /@@index\(\[tenantId, ownerProfileId\]/],
    ["Conversation", /@@index\(\[tenantId, ownerProfileId\]/],
    ["Order", /@@index\(\[tenantId, status\]/],
    ["Formula", /@@index\(\[tenantId, status\]/],
    ["CreditTransaction", /@@index\(\[tenantId, createdAt\]/],
    ["PriceCalculation", /@@index\(\[tenantId, createdAt\]/],
  ] as const)("%s carries its compound tenant index", (name, pattern) => {
    expect(model_block(name)).toMatch(pattern);
  });

  it("keeps RawMaterial platform-global", () => {
    expect(model_block("RawMaterial")).not.toMatch(/tenantId/);
  });

  it("marks UserLog with an explicit scope", () => {
    const block = model_block("UserLog");
    expect(block).toMatch(/tenantId\s+String\?\s+@db\.ObjectId/);
    expect(block).toMatch(/scope\s+String\?/);
  });

  it.each(["Conversation", "ChatThread", "Formula", "Feedback", "AiResponse"])(
    "%s declares ownerProfileId",
    (name) => {
      expect(model_block(name)).toMatch(/ownerProfileId\s+String\?\s+@db\.ObjectId/);
    },
  );
});
