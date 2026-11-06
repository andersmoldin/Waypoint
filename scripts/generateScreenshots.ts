// Renders the Marketplace screenshots from the real hub and its real page, with invented data.
// Run with `npm run screenshots` whenever the hub's appearance changes.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PAGE_ORIGIN, buildPage, servePage } from "./pageBundle.ts";

const SIZE = { width: 1366, height: 768 };
const OUTPUT = new URL("../images/screenshots/", import.meta.url);

const bundle = mkdtempSync(join(tmpdir(), "waypoint-screenshots-"));
try {
  await buildPage("./src/testing/listingScreenshot.tsx", bundle);

  mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: SIZE });
    await servePage(page, bundle);
    await page.goto(`${PAGE_ORIGIN}/hub.html`);
    await page.getByRole("region", { name: "Board" }).waitFor();
    await page.screenshot({ path: fileURLToPath(new URL("board.png", OUTPUT)) });
    console.log("Wrote images/screenshots/board.png");
  } finally {
    await browser.close();
  }
} finally {
  rmSync(bundle, { recursive: true, force: true });
}
