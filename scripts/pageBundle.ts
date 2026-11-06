// Builds a page of the hub's own for a real browser, with its real template and its real Content Security Policy.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Page } from "@playwright/test";
import webpack, { type Configuration } from "webpack";
import config from "../webpack.config.mjs";

const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };

/** A made-up origin, so that the page's Content Security Policy applies as it does in Azure DevOps. */
export const PAGE_ORIGIN = "https://waypoint.invalid";

export function buildPage(entry: string, output: string): Promise<void> {
  const pageConfig: Configuration = {
    ...(config as Configuration),
    mode: "production",
    entry: { hub: entry },
    output: { ...(config as Configuration).output, path: output },
  };
  return new Promise((resolve, reject) => {
    webpack(pageConfig, (error, stats) => {
      if (error) reject(error);
      else if (stats?.hasErrors()) reject(new Error(stats.toString("errors-only")));
      else resolve();
    });
  });
}

/** Answers for the made-up origin from the built page. */
export async function servePage(page: Page, output: string): Promise<void> {
  await page.route(`${PAGE_ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      body: readFileSync(join(output, path)),
    });
  });
}
