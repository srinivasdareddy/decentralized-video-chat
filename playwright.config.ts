import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    permissions: ["camera", "microphone"],
    // A synthetic camera and microphone, so calls work without hardware.
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Set E2E_BASE_URL to test a server that's already running (e.g. Docker).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && node server/index.ts",
        url: `${baseURL}/healthz`,
        env: { PORT: String(PORT) },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
