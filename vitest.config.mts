import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // azure-devops-ui ships untranspiled ES modules that import their own CSS,
    // so Vitest has to process the package instead of handing it to Node.
    server: { deps: { inline: ["azure-devops-ui"] } },
  },
});
