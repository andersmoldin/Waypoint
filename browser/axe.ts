import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Frame, Page } from "@playwright/test";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

interface AxeRun {
  axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; help: string; nodes: { target: unknown }[] }[] }> };
}

/** Runs axe-core over a page or frame as it stands, with contrast, which jsdom cannot measure. */
export async function axeViolations(target: Page | Frame): Promise<unknown[]> {
  await target.evaluate(AXE);
  return target.evaluate(async () => {
    const { violations } = await (window as unknown as AxeRun).axe.run(document, {
      rules: {
        // Off by default, but they are WCAG's 2.5.3 and 2.5.8.
        "label-content-name-mismatch": { enabled: true },
        "target-size": { enabled: true },
        // A best practice, not a WCAG rule: the library's tooltips live in a portal outside every landmark, and they repeat a button's name.
        region: { enabled: false },
      },
    });
    return violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map(({ target }) => target) }));
  });
}
