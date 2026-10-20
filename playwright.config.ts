import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      // Use a preinstalled Chromium when the bundled browser isn't downloaded (e.g. CI images).
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
    permissions: ["microphone"],
  },
  webServer: {
    // Offline heuristic evaluator: no API key required, results are clearly labelled.
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: { INTERVIEW_AI_MODE: "test", DATABASE_PATH: "var/e2e/e2e.sqlite", AUDIO_STORAGE_DIR: "var/e2e/audio" },
  },
});
