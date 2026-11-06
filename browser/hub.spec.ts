import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PAGE_ORIGIN, buildPage, servePage } from "../scripts/pageBundle.ts";
import { axeViolations } from "./axe.ts";

let bundle: string;

test.beforeAll(async () => {
  bundle = mkdtempSync(join(tmpdir(), "waypoint-browser-"));
  await buildPage("./src/testing/browserCheckPage.tsx", bundle);
});

test.afterAll(() => rmSync(bundle, { recursive: true, force: true }));

async function open(page: Page, scenario: string): Promise<void> {
  await servePage(page, bundle);
  await page.goto(`${PAGE_ORIGIN}/hub.html?scenario=${scenario}`);
}

const filterButton = (page: Page) => page.getByRole("button", { name: /^Filter/ });
const board = (page: Page) => page.getByRole("region", { name: "Board" });

for (const forcedColors of ["none", "active"] as const) {
  test.describe(`axe-core with forced colors ${forcedColors}`, () => {
    test.use({ forcedColors });

    test("finds nothing on the board", async ({ page }) => {
      await open(page, "board");
      await board(page).waitFor();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("finds nothing with the filter row open, also in an open dropdown", async ({ page }) => {
      await open(page, "board");
      await filterButton(page).click();
      await page.getByPlaceholder("Filter by keyword").waitFor();
      expect(await axeViolations(page)).toEqual([]);

      await page.getByRole("button", { name: /^Waiting/ }).click();
      await page.getByRole("option", { name: "Not waiting" }).waitFor();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("finds nothing with an active filter and the row closed", async ({ page }) => {
      await open(page, "from-a-link");
      await board(page).waitFor();
      await filterButton(page).click();
      await page.getByRole("button", { name: "Filter, a filter is active" }).waitFor();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("finds nothing in a card's detail panel", async ({ page }) => {
      await open(page, "board");
      await board(page).getByRole("button").first().click();
      await page.getByRole("button", { name: "Open work item" }).waitFor();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("finds nothing with a group in focus and the other cards dimmed", async ({ page }) => {
      await open(page, "board");
      await page.getByRole("list", { name: "Groups" }).getByRole("listitem").first().focus();
      await page.locator(".waypoint-card-dimmed").first().waitFor();
      expect(await axeViolations(page)).toEqual([]);
    });

    for (const [scenario, shown] of [
      ["not-set-up", /isn't set up/],
      ["cannot-be-used", /could not load the board/],
      ["field-gone", /no longer has/],
      ["all-hidden", /hidden in Waypoint's settings/],
    ] as const) {
      test(`finds nothing with the message of ${scenario}`, async ({ page }) => {
        await open(page, scenario);
        await page.getByText(shown).first().waitFor();
        expect(await axeViolations(page)).toEqual([]);
      });
    }

    test("finds nothing in the settings panel", async ({ page }) => {
      await open(page, "settings");
      await page.getByRole("heading", { name: "Change log" }).waitFor();
      expect(await axeViolations(page)).toEqual([]);
    });
  });
}

test.describe("the filter icon's dot", () => {
  const dotAgainstButton = (page: Page) =>
    page.evaluate(() => {
      const icon = document.querySelector(".waypoint-filter-dot") as Element;
      const dot = getComputedStyle(icon, "::after");
      return { ring: dot.borderTopColor, ringWidth: dot.borderTopWidth, fill: dot.backgroundColor, background: getComputedStyle(document.body).backgroundColor };
    });

  const showDot = async (page: Page) => {
    await open(page, "from-a-link");
    await board(page).waitFor();
    await filterButton(page).click();
    await page.getByRole("button", { name: "Filter, a filter is active" }).waitFor();
  };

  test("has a ring that stays when a theme's blue is the color of the button", async ({ page }) => {
    await showDot(page);
    await page.evaluate(() => document.documentElement.style.setProperty("--communication-background", "rgb(255, 255, 255)"));

    const { ring, ringWidth, fill } = await dotAgainstButton(page);

    expect(ringWidth).toBe("1px");
    expect(fill).toBe("rgb(255, 255, 255)");
    expect(ring).not.toBe(fill);
    await expect(page.locator(".waypoint-filter-dot")).toBeVisible();
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`with forced colors on a ${colorScheme} background`, () => {
      test.use({ forcedColors: "active", colorScheme });

      test("is drawn in system colors, apart from the background", async ({ page }) => {
        await showDot(page);

        const { ring, fill, background } = await dotAgainstButton(page);

        expect(ring).not.toBe(background);
        expect(fill).not.toBe(background);
      });
    });
  }
});

test.describe("a field of type html", () => {
  const BOMBS: [string, string][] = [
    ["formatting elements that differ in an attribute", `<p>${Array.from({ length: 2_000 }, (_, index) => `<b a${index}>`).join("")}${"<p>x".repeat(2_000)}`],
    ["nested templates, which crash a tree", "<template>".repeat(100_000)],
    ["deep nesting", "<div>".repeat(200_000)],
    ["misnested links and blocks", "<a><div>x</a>".repeat(71_000)],
    ["base elements, which report to the page's policy", "<base href=x>".repeat(100_000)],
  ];

  for (const [kind, html] of BOMBS) {
    test(`reads ${kind} in about the time of its length`, async ({ page }) => {
      await open(page, "empty");

      const { elapsed } = await page.evaluate((html) => {
        const started = performance.now();
        (window as unknown as { waypointChecks: { readHtml: (html: string) => string } }).waypointChecks.readHtml(html);
        return { elapsed: performance.now() - started };
      }, html);

      expect(elapsed).toBeLessThan(1_000);
    });
  }

  for (const [kind, html] of [
    ["a form field named like a property of an element", "<form><input name=childNodes>Kept</form>"],
    ["a field that belongs to a form from afar", "<form id=f></form><input form=f name=childNodes>Kept"],
    ["images named like the document's body", "<img name=body><img name=body>Kept"],
  ] as const) {
    test(`reads ${kind} as its text`, async ({ page }) => {
      await open(page, "empty");

      const text = await page.evaluate((html) => (window as unknown as { waypointChecks: { readHtml: (html: string) => string } }).waypointChecks.readHtml(html), html);

      expect(text).toBe("Kept");
    });
  }

  test("reaches the page as text, runs nothing and asks for nothing", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(PAGE_ORIGIN)) requests.push(request.url());
    });
    const hostile = [
      "<img src=https://attacker.invalid/a onerror=window.ran=1>",
      "<svg onload=window.ran=1><script>window.ran=1</script></svg>",
      "<iframe srcdoc='<script>parent.ran=1</script>' src=https://attacker.invalid/b></iframe>",
      "<a href=javascript:window.ran=1>link</a><link rel=stylesheet href=https://attacker.invalid/c>",
      "<style>@import 'https://attacker.invalid/d';</style><meta http-equiv=refresh content='0;url=https://attacker.invalid/e'>",
      "&lt;img src=https://attacker.invalid/f onerror=window.ran=1&gt;",
    ].join("");
    await open(page, "empty");

    await page.evaluate((hostile) => (window as unknown as { waypointChecks: { showBoardWith: (value: string) => void } }).waypointChecks.showBoardWith(hostile), hostile);
    await board(page).waitFor();
    await board(page).getByRole("button").first().click();
    await page.getByRole("button", { name: "Open work item" }).waitFor();

    expect(await page.evaluate(() => "ran" in window)).toBe(false);
    expect(await page.locator("#root img, #root svg[onload], #root iframe, #root link, #root meta, #root a[href^='javascript'], #root style").count()).toBe(0);
    expect(requests).toEqual([]);
  });
});

test("a very long text waiting on someone leaves the next card in view", async ({ page }) => {
  await open(page, "empty");

  await page.evaluate(() => (window as unknown as { waypointChecks: { showBoardWith: (value: string) => void } }).waypointChecks.showBoardWith("word ".repeat(20_000)));
  await board(page).waitFor();

  await expect(page.getByText("The next card")).toBeInViewport();
});

test("a keyboard reaches everything, and the panel gives focus back", async ({ page }) => {
  await open(page, "board");
  await board(page).waitFor();

  const reached = new Set<string>();
  for (let press = 0; press < 25; press += 1) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("role") ?? document.activeElement?.tagName ?? ""));
  }
  for (const stop of ["Filter", "tab", "Board", "LI"]) expect([...reached]).toContain(stop);

  // The icons in the header are one stop, and the arrow keys move between them, as in Azure DevOps' own header.
  await filterButton(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();

  const card = board(page).getByRole("button").first();
  await card.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Open work item" }).waitFor();
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
});

test.describe("at the width of 400 % zoom", () => {
  test.use({ viewport: { width: 320, height: 256 } });

  test("only the board scrolls sideways", async ({ page }) => {
    await open(page, "board");
    await board(page).waitFor();

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
