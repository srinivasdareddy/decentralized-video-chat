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
    // Synthetic cameras and microphones, so calls work without hardware.
    // (Of the three fake cameras, fake_device_1 imitates a depth camera,
    // which can't be sent in a call; tests switch between the other two.)
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream=device-count=3"],
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
