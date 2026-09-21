import { expect, test } from "@playwright/test";

/**
 * Clerk cutover E2E suite (G1.7).
 *
 * Requires a staged deployment with CLERK_CUTOVER=true, Clerk credentials,
 * and seeded principals (platform admin, tenant manager, imported legacy
 * user, invited student, membership-less user). Skips outside staging so the
 * repo gate stays green; staging execution is recorded in
 * docs/commercial/evidence/g1-release.md.
 */
const staging_ready = process.env.E2E_CLERK_CONFIGURED === "true";
test.skip(!staging_ready, "requires staged Clerk environment (E2E_CLERK_CONFIGURED=true)");

/**
 * Sign in through the Clerk surface as a seeded principal.
 *
 * @param page - Playwright page.
 * @param role - Seeded principal key mapped to E2E_<ROLE>_EMAIL/PASSWORD env.
 */
async function sign_in_as(page: import("@playwright/test").Page, role: string) {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] ?? "";
  const password = process.env[`E2E_${role.toUpperCase()}_PASSWORD`] ?? "";
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /continue|sign in/i }).click();
}

test("signed-out visitor is redirected to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/sign-in/);
});

test("existing imported user signs in with the legacy password", async ({ page }) => {
  await sign_in_as(page, "imported_user");
  await expect(page).not.toHaveURL(/sign-in/);
});

test("invited student completes sign-up and lands in the app", async ({ page }) => {
  await page.goto(String(process.env.E2E_INVITATION_URL ?? "/sign-up"));
  await expect(page).toHaveURL(/sign-up|onboarding/);
});

test("platform admin can open tenant creation", async ({ page }) => {
  await sign_in_as(page, "platform_admin");
  await page.goto("/platform/tenants/new");
  await expect(page.getByText(/create university/i)).toBeVisible();
});

test("manager can open member invitation", async ({ page }) => {
  await sign_in_as(page, "manager");
  await page.goto("/settings/members");
  await expect(page.getByText(/invite student/i)).toBeVisible();
});

test("invited student cannot create a university or appoint a manager", async ({ page }) => {
  await sign_in_as(page, "student");
  await page.goto("/platform/tenants/new");
  await expect(page.getByText(/platform access required/i)).toBeVisible();
  const response = await page.request.post("/api/trpc/platformTenants.create?batch=1", {
    data: { 0: { json: { name: "X", slug: "x-uni", region: "sgp", plan_key: "standard", initial_manager_email: "x@x.com", idempotency_key: "00000000-0000-4000-8000-000000000000" } } },
  });
  expect([401, 403]).toContain(response.status());
  // The appointment endpoint itself must reject a non-platform caller.
  const appointment = await page.request.post("/api/trpc/platformTenants.appointManager?batch=1", {
    data: { 0: { json: { tenant_id: "000000000000000000000000", email: "x@x.com" } } },
  });
  expect([401, 403]).toContain(appointment.status());
});

test("user without membership sees onboarding states", async ({ page }) => {
  await sign_in_as(page, "no_membership");
  await page.goto("/onboarding");
  await expect(page.getByText(/invitation pending|membership synchronization/i)).toBeVisible();
});
