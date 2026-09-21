import { expect, test } from "@playwright/test";

const local_adapter = !process.env.E2E_BASE_URL;
test.skip(!local_adapter, "credential-free browser adapter runs only on the local CI server");

/** Start one synthetic governed run from the public test console. */
async function start_run(
  page: import("@playwright/test").Page,
  agent: "raw_material_research" | "formulation" | "sales_rnd",
  scenario: string,
): Promise<void> {
  await page.getByLabel("Agent").selectOption(agent);
  await page.getByLabel("Scenario message").fill(scenario);
  await page.getByRole("button", { name: "Start governed run" }).click();
  await expect(page.getByTestId("ai-run-view")).toBeVisible();
}

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    { name: "commercial_test_tenant", value: "tenant_a", url: "http://localhost:3000" },
    { name: "commercial_test_role", value: "manager", url: "http://localhost:3000" },
  ]);
  await page.goto("/commercial-test/agentic", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Agentic test console" })).toBeVisible();
  await expect(page.getByTestId("commercial-test-ready")).toBeAttached({ timeout: 15_000 });
});

test("all three agents complete with governed tools and evidence", async ({ page }) => {
  for (const [agent, tool] of [
    ["raw_material_research", "knowledge.search"],
    ["formulation", "formula.search"],
    ["sales_rnd", "web.search"],
  ] as const) {
    await start_run(page, agent, "scenario:normal");
    await expect(page.getByTestId("run-activity")).toContainText(tool);
    await expect(page.getByTestId("ai-evidence-list")).toBeVisible();
    await expect(page.getByTestId("run-answer")).toContainText("Synthetic evidence-backed");
    await expect(page.getByTestId("run-completed")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/chain of thought|hidden reasoning/i);
  }
});

test("formulation pauses once for clarification and requires manager approval", async ({ page }) => {
  await start_run(page, "formulation", "scenario:clarification_approval");
  await expect(page.getByTestId("ai-clarification-card")).toBeVisible();
  await page.getByLabel("Your answer").fill("Target 5% niacinamide.");
  await page.getByRole("button", { name: "Continue run" }).click();

  await expect(page.getByTestId("ai-approval-card")).toBeVisible();
  await expect(page.getByTestId("ai-approval-card")).toContainText("formula.confirm");
  await page.getByRole("button", { name: "Approve" }).click();

  await expect(page.getByTestId("run-completed")).toBeVisible();
  await expect(page.getByTestId("artifact-card")).toContainText("confirmed");
  await expect(page.getByTestId("run-answer")).toContainText("manager-approved");
});

test("a student sees the checkpoint but cannot decide it; manager denial fails safely", async ({ context, page }) => {
  await context.addCookies([
    { name: "commercial_test_role", value: "student", url: "http://localhost:3000" },
  ]);
  await page.reload();
  await start_run(page, "formulation", "scenario:clarification_approval");
  await page.getByLabel("Your answer").fill("Target 5% niacinamide.");
  await page.getByRole("button", { name: "Continue run" }).click();
  await expect(page.getByTestId("ai-approval-card")).toContainText(
    "A workspace manager must decide",
  );
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await context.addCookies([
    { name: "commercial_test_role", value: "manager", url: "http://localhost:3000" },
  ]);
  await page.getByLabel("Render as manager").check();
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByTestId("run-failed")).toContainText("POLICY_PERMISSION_MISSING");
});

test("EventSource reconnect replays after Last-Event-ID without duplicate actions", async ({ page }) => {
  await start_run(page, "raw_material_research", "scenario:reconnect");
  await expect(page.getByTestId("run-completed")).toBeVisible();
  await expect(page.getByTestId("run-activity").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("run-client-error")).toHaveCount(0);
});

for (const [scenario, code] of [
  ["scenario:budget", "LIMIT_COST"],
  ["scenario:emergency", "POLICY_EMERGENCY_DISABLED"],
] as const) {
  test(`${scenario} surfaces the typed fail-safe code`, async ({ page }) => {
    await start_run(page, "raw_material_research", scenario);
    await expect(page.getByTestId("run-failed")).toContainText(code);
    await expect(page.getByTestId("run-completed")).toHaveCount(0);
  });
}
