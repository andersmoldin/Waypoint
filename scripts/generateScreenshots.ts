// Renders the Marketplace screenshots from the real hub and its real page, with invented data.
// Run with `npm run screenshots` whenever the hub's appearance changes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import webpack, { type Configuration } from "webpack";
import config from "../webpack.config.mjs";

const SIZE = { width: 1366, height: 768 };
const OUTPUT = new URL("../images/screenshots/", import.meta.url);
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };

const bundle = mkdtempSync(join(tmpdir(), "waypoint-screenshots-"));
try {
  await new Promise<void>((resolve, reject) => {
    const screenshotConfig: Configuration = {
      ...(config as Configuration),
      mode: "production",
      entry: { hub: "./src/testing/listingScreenshot.tsx" },
      output: { ...(config as Configuration).output, path: bundle },
    };
    webpack(screenshotConfig, (error, stats) => {
      if (error) reject(error);
      else if (stats?.hasErrors()) reject(new Error(stats.toString("errors-only")));
      else resolve();
    });
  });

  mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: SIZE });
    // A made-up origin, so that the page's Content Security Policy applies as it does in Azure DevOps.
    await page.route("https://waypoint.invalid/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        body: readFileSync(join(bundle, path)),
      });
    });
    await page.goto("https://waypoint.invalid/hub.html");
    await page.getByRole("region", { name: "Board" }).waitFor();
    await page.screenshot({ path: fileURLToPath(new URL("board.png", OUTPUT)) });
    console.log("Wrote images/screenshots/board.png");
  } finally {
    await browser.close();
  }
} finally {
  rmSync(bundle, { recursive: true, force: true });
}
