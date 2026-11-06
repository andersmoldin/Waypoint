import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test as base, type Frame, type Page } from "@playwright/test";
import { axeViolations } from "../browser/axe.ts";

const ORGANIZATION = "https://dev.azure.com/andersmoldin";
const HUB = `${ORGANIZATION}/Waypoint-test/_apps/hub/andersmoldin-dev.waypoint-dev.waypoint-hub`;
/** Outside the repository, and used for nothing but this test. */
const BROWSER_PROFILE = join(homedir(), ".cache", "waypoint-e2e-profile");
/** A Stakeholder or Reader has no gear, so the settings are opened from a profile logged in as a Project Administrator. */
const ADMINISTRATOR_BROWSER_PROFILE = join(homedir(), ".cache", "waypoint-e2e-administrator-profile");
const BUILD_COMMIT_META = 'meta[name="waypoint-commit"]';
const SETTINGS_PANEL = 'main[aria-label="Waypoint settings"]';

async function usingProfile(profile: string, use: (page: Page) => Promise<void>): Promise<void> {
  const context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: false, viewport: null });
  await use(await context.newPage());
  await context.close();
}

const test = base.extend<{ page: Page; administratorPage: Page }>({
  page: async ({}, use) => usingProfile(BROWSER_PROFILE, use),
  administratorPage: async ({}, use) => usingProfile(ADMINISTRATOR_BROWSER_PROFILE, use),
});

async function frameHolding(page: Page, selector: string): Promise<Frame | undefined> {
  for (const frame of page.frames()) {
    if (await frame.locator(selector).count().catch(() => 0)) return frame;
  }
  return undefined;
}

/** The hub and its panel run in frames on a host of Marketplace's choosing, so each is found by what it contains. */
async function waitForFrame(page: Page, selector: string, message: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        found = await frameHolding(page, selector);
        return found !== undefined;
      },
      { message, timeout: 60_000 },
    )
    .toBe(true);
  return found!;
}

function hubFrame(page: Page): Promise<Frame> {
  return waitForFrame(page, BUILD_COMMIT_META, "The Waypoint hub never appeared. Is Waypoint (dev) installed in the test organization?");
}

/** Opens the hub and makes sure the test organization runs the commit under test. */
async function openHub(page: Page, query = ""): Promise<Frame> {
  const commit = process.env.WAYPOINT_E2E_COMMIT;
  if (!commit) throw new Error("Run this through `npm run e2e`, which says which commit is under test.");

  await page.goto(`${HUB}${query}`);
  // The first time, and when the session has expired, this waits for a login by hand.
  await page.waitForURL(`${HUB}**`, { timeout: 5 * 60_000 });

  const hub = await hubFrame(page);
  expect(
    await hub.locator(BUILD_COMMIT_META).getAttribute("content"),
    "The test organization runs another build than this commit. Marketplace updates installed extensions with a delay, so wait until publish-dev.yml is green and run this again.",
  ).toBe(commit);
  return hub;
}

/** This work item is in the first phase of the first tab of any set-up, and the test organization holds invented data. */
const KNOWN_OBJECT = "PROCESS_102.Dagny.KontrolleraUppgifter";

test("the logged-in user sees the board with the test organization's data", async ({ page }) => {
  const hub = await openHub(page);

  // The account stays out of the repository, and a user's access level cannot be read as that user,
  // so the person running the test confirms it: scripts/runE2e.ts.
  const account = await page.evaluate(async (url) => {
    const connection = await (await fetch(url)).json();
    return connection.authenticatedUser.properties.Account.$value as string;
  }, `${ORGANIZATION}/_apis/connectionData?api-version=7.1-preview`);
  expect(account, "No account is logged in, in the browser this test opens.").not.toBe("Anonymous");
  console.log(`Logged in as ${account}`);

  // Only the real adapter can get this from Azure DevOps. The test needs this work item to stay in this phase.
  const board = hub.getByRole("region", { name: "Board" });
  await expect(board).toBeVisible({ timeout: 60_000 });
  const firstPhase = board.getByRole("list", { name: /^Idéfas / });
  await expect(firstPhase.getByRole("listitem").filter({ hasText: KNOWN_OBJECT })).toBeVisible();
});

test("axe-core finds nothing on the real page, in the real colors of the account's theme", async ({ page }) => {
  const hub = await openHub(page);
  await expect(hub.getByRole("region", { name: "Board" })).toBeVisible({ timeout: 60_000 });

  expect(await axeViolations(hub)).toEqual([]);
});

test("the logged-in user can read the project's tags, which a filter field of tags needs", async ({ page }) => {
  await openHub(page);

  // A question about what this user may read, so it is asked as them. No setup in the test organization holds a filter field to go through the adapter with.
  const tags = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, value: ((await response.json()) as { value?: unknown }).value };
  }, `${ORGANIZATION}/Waypoint-test/_apis/wit/tags?api-version=7.1`);

  expect(tags.status).toBe(200);
  expect(Array.isArray(tags.value)).toBe(true);
});

test("a Project Administrator opens the settings panel from the gear and it has its content", async ({ administratorPage: page }) => {
  const hub = await openHub(page);

  // Exactly, since the box a project without settings gets has a button called "Open settings".
  const gear = hub.getByRole("button", { name: "Settings", exact: true });
  await expect(gear, `No gear. Log in as a Project Administrator in the browser this test opens, which uses ${ADMINISTRATOR_BROWSER_PROFILE}.`).toBeVisible({ timeout: 60_000 });
  await gear.click();

  // Only read: nothing here saves, so the test organization's settings stay as they are.
  const panel = await waitForFrame(page, SETTINGS_PANEL, "The settings panel's page never appeared, although the host may show the panel's title.");
  await expect(panel.getByRole("button", { name: "Save" })).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText("Object work item type")).toBeVisible();
  // Visible inside the frame says nothing about the frame, which the host sizes and can hide.
  const frameElement = await panel.frameElement();
  expect(await frameElement.isVisible(), "The host keeps the settings panel's frame hidden.").toBe(true);
  const frameSize = await frameElement.boundingBox();
  expect(frameSize?.height, "The settings panel's frame has hardly any height.").toBeGreaterThan(200);

  // The hub stops waiting for the panel after 30 seconds, and a panel it cannot hear from would be reported as failed.
  await page.waitForTimeout(31_000);
  await expect(hub.getByText(/could not open its settings/)).toBeHidden();

  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => frameHolding(page, SETTINGS_PANEL).then((frame) => frame !== undefined)).toBe(false);
});

test("a filter in the link holds through a reload, and × takes it out of the address", async ({ page }) => {
  const cards = (hub: Frame) => hub.getByRole("region", { name: "Board" }).getByRole("listitem");
  const shownByTheFilter = (hub: Frame) => cards(hub).filter({ hasText: KNOWN_OBJECT });

  let hub = await openHub(page, `?keyword=${encodeURIComponent(KNOWN_OBJECT)}`);
  await expect(shownByTheFilter(hub)).toBeVisible({ timeout: 60_000 });
  await expect(hub.getByRole("searchbox", { name: "Filter by keyword" })).toHaveValue(KNOWN_OBJECT);
  await expect(cards(hub)).toHaveCount(1);

  await page.reload();
  hub = await hubFrame(page);
  await expect(shownByTheFilter(hub)).toBeVisible({ timeout: 60_000 });
  await expect(hub.getByRole("searchbox", { name: "Filter by keyword" })).toHaveValue(KNOWN_OBJECT);

  await hub.getByRole("button", { name: "Clear and dismiss filters" }).click();
  await expect(hub.getByRole("searchbox", { name: "Filter by keyword" })).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.has("keyword")).toBe(false);
});
