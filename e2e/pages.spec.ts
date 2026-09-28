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

test("the privacy page is linked from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
});

test("shared links get a preview image, and the app can be installed", async ({ request }) => {
  // What link-preview crawlers see: the HTML as served, without running scripts.
  const html = await (await request.get("/join/some-call")).text();
  const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? "";
  expect(image).toMatch(/^https?:\/\/[^/]+\/og-image\.png$/);
  expect((await request.get(new URL(image).pathname)).ok()).toBe(true);

  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"/>');
  const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
    name: string;
    icons: { src: string }[];
  };
  expect(manifest.name).toBe("Zipcall");
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  }
});
