import { defineConfig } from "@playwright/test";

// Run through `npm run e2e`, on the owner's computer: see docs/publicering.md.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 0,
  // Long enough to log in by hand when the session has expired.
  timeout: 10 * 60_000,
  reporter: "list",
});
