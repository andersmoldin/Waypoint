import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const platformPackages = ["azure-devops-extension-sdk", "azure-devops-extension-api"];

export default defineConfig([
  globalIgnores(["dist/", "out/", "test-results/", "playwright-report/"]),
  tseslint.configs.recommended,
  {
    // Free text from work items is always rendered as text, never as HTML.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Render free text as text. Data from work items never reaches the page as HTML.",
        },
      ],
    },
  },
  {
    // The platform adapter is the only seam to Azure DevOps.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/platform/azureDevOpsPlatform.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: platformPackages.flatMap((name) => [name, `${name}/*`]),
              message: "Talk to Azure DevOps through the Platform interface in src/platform/platform.ts.",
            },
          ],
        },
      ],
    },
  },
]);
