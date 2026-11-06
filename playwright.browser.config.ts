import { defineConfig } from "@playwright/test";

// What jsdom cannot show: the real hub in real Chrome, with invented data and no Azure DevOps. Run with `npm run browser`.
export default defineConfig({
  testDir: "browser",
  reporter: "list",
  workers: 1,
  timeout: 60_000,
  use: { channel: "chrome" },
});
