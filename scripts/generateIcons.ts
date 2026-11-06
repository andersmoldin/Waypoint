// Renders the icons' SVGs to the PNGs that are checked in, so the build needs no image tool: the
// Marketplace icon in two variants and sizes, and the hub's menu icon in a variant per theme.
// Run with `npm run icons`. Chromium is the renderer the SVGs were designed in.
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const VARIANTS = ["light", "dark"] as const;
// The Marketplace icon's SVGs are drawn on a 128 px grid. Marketplace wants 128 px and takes 256 px.
const MARKETPLACE_GRID = 128;
const MARKETPLACE_SIZES = [128, 256];
// The menu shows the hub's icon at 16 px next to glyphs in the theme's primary text color, so the
// icon is drawn on a 16 px grid in that color and rendered at scale 2 to be crisp on Retina.
const MENU_ICON_GRID = 16;
const MENU_ICON_SCALE = 2;
const MENU_ICON_COLORS: Record<(typeof VARIANTS)[number], string> = { light: "rgba(0, 0, 0, 0.9)", dark: "rgba(255, 255, 255, 0.95)" };

const OUTPUT = new URL("../images/icons/", import.meta.url);
mkdirSync(OUTPUT, { recursive: true });
const svgSource = (name: string) => readFileSync(new URL(`../assets/icons/${name}.svg`, import.meta.url), "utf8");

const browser = await chromium.launch({ channel: "chrome" });
try {
  /** Renders an SVG drawn on a grid of `grid` px to a PNG of `grid * scale` px. `color` is what currentColor resolves to. */
  async function render({ svg, file, grid, scale, color }: { svg: string; file: string; grid: number; scale: number; color?: string }) {
    const page = await browser.newPage({ viewport: { width: grid, height: grid }, deviceScaleFactor: scale });
    const style = `margin:0;background:transparent${color ? `;color:${color}` : ""}`;
    await page.setContent(`<!doctype html><body style="${style}">${svg}</body>`);
    await page.locator("svg").screenshot({ path: fileURLToPath(new URL(file, OUTPUT)), omitBackground: true });
    await page.close();
    console.log(`Wrote images/icons/${file}`);
  }

  for (const variant of VARIANTS) {
    const svg = svgSource(`waypoint-${variant}`);
    for (const size of MARKETPLACE_SIZES) {
      await render({ svg, file: `waypoint-${variant}-${size}.png`, grid: MARKETPLACE_GRID, scale: size / MARKETPLACE_GRID });
    }
  }
  const menuIcon = svgSource("waypoint-hub");
  for (const variant of VARIANTS) {
    const file = `waypoint-hub-${variant}-${MENU_ICON_GRID * MENU_ICON_SCALE}.png`;
    await render({ svg: menuIcon, file, grid: MENU_ICON_GRID, scale: MENU_ICON_SCALE, color: MENU_ICON_COLORS[variant] });
  }
} finally {
  await browser.close();
}
