import { expect, test } from "./fixtures.ts";

test("the landing page leads to a new call", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Zipcall/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Video calls, straight from your browser.",
  );

  await page.getByRole("link", { name: "Start a call" }).first().click();
  await expect(page).toHaveURL(/\/newcall$/);

  const name = page.getByRole("textbox", { name: "Call name" });
  await expect(name).toHaveValue(/^[a-z]+-[a-z]+-[a-z0-9]{4}$/);
  await name.fill("Team Standup");
  await page.getByRole("button", { name: "Start call" }).click();
  await expect(page).toHaveURL(/\/join\/team%20standup$/);
  await expect(page.locator(".call-room")).toHaveText("team standup");
});

test("call names can't contain slashes", async ({ page }) => {
  await page.goto("/newcall");
  await page.getByRole("textbox", { name: "Call name" }).fill("a/b");
  await expect(page.getByRole("button", { name: "Start call" })).toBeDisabled();
  await expect(page.getByText("Call names can't contain slashes")).toBeVisible();
});

test("unknown pages say so", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("the unsupported-browser page offers the call link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/notsupportedios?room=happy-panda");
  await page.getByRole("button", { name: "Copy call link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/join\/happy-panda$/);
});
