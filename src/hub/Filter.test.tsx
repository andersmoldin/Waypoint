import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePlatform, type FakeWorld } from "../platform/fakePlatform";
import type { WorkItemField } from "../platform/platform";
import { expectNoAccessibilityViolations, renderHub } from "../testing/hubRig";
import { AKTUELLT_LAGE, OUR_TABS, lifecycleWorld, process, robot, savedSettings } from "../testing/lifecycleWorld";
import { REDRAW_BUDGET, fastestOfThreeGoes, timeOf } from "../testing/timing";

const PROJECT = "this-project";
const bodil = robot(1, "PROCESS_101.Bodil");
const cassius = robot(2, "PROCESS_103.Cassius");
const ovrigt = robot(3, "Övrigt");

const WORK_ITEMS = [
  bodil,
  cassius,
  ovrigt,
  process(11, "Fakturor", "Idéfas", 1),
  process(12, "Arkivering", "Under utveckling", 1),
  process(13, "Löner", "Idéfas", 2),
  process(14, "Attester", "I produktion", 2),
  process(15, "Föräldralös faktura", "Idéfas"),
];

const world = (rest: FakeWorld = {}) =>
  lifecycleWorld(WORK_ITEMS, { projectId: PROJECT, savedSettings: { [PROJECT]: savedSettings({ tabs: OUR_TABS }) }, ...rest });

const opened = async (rest: FakeWorld = {}) => {
  const platform = createFakePlatform(world(rest));
  renderHub(platform);
  await screen.findByRole("region", { name: "Board" });
  return platform;
};

/** The titles of the cards on the chosen tab. */
const cardTitles = () =>
  [...screen.getByRole("region", { name: "Board" }).querySelectorAll(".waypoint-card-title")].map((title) => title.textContent);

const filterButton = () => screen.getByRole("button", { name: /^Filter/ });
const filterRow = () => screen.queryByRole("toolbar", { name: "Filter" });
const keywordBox = () => screen.getByRole("searchbox", { name: "Filter by keyword" }) as HTMLInputElement;
const typeKeyword = (keyword: string) => fireEvent.change(keywordBox(), { target: { value: keyword } });
const groupDropdown = () => screen.getByRole("button", { name: /^Group/ });

/** Opens the dropdown if needed, and clicks the option for the group. */
const chooseGroup = (name: string) => {
  if (screen.queryByRole("listbox", { name: /^Group/ }) === null) fireEvent.click(groupDropdown());
  fireEvent.click(option(name));
};

const options = () => screen.getAllByRole("option");
/** The library gives an option's checkbox a name that becomes part of the option's, so the option is found by its text. */
const optionsNamed = (name: string) => options().filter(({ textContent }) => textContent === name);
const option = (name: string) => optionsNamed(name)[0];

describe("the filter row", () => {
  it("is hidden when the hub opens without a filter in the URL, and shows and hides with the filter icon", async () => {
    await opened();
    expect(filterRow()).toBeNull();
    expect(filterButton().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(filterButton());

    expect(filterRow()).toBeTruthy();
    expect(filterButton().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(keywordBox());
    await expectNoAccessibilityViolations();

    fireEvent.click(filterButton());

    expect(filterRow()).toBeNull();
  });
});

describe("the keyword", () => {
  it("narrows the board to the objects whose title has it, without regard to case, and without fetching anything", async () => {
    const platform = await opened();
    const read = vi.spyOn(platform, "getWorkItemsBatch");
    fireEvent.click(filterButton());

    typeKeyword("FAKTUR");

    await waitFor(() => expect(cardTitles()).toEqual(["Fakturor", "Föräldralös faktura"]));
    expect(read).not.toHaveBeenCalled();
  });

  it("also finds the objects of a group whose name has it", async () => {
    await opened();
    fireEvent.click(filterButton());

    typeKeyword("cassius");

    await waitFor(() => expect(cardTitles()).toEqual(["Löner"]));
  });

  it("finds a title however its accented letters are encoded", async () => {
    await opened({ workItems: [bodil, process(11, "Lo\u0308ner", "Idéfas", 1)] });
    fireEvent.click(filterButton());

    typeKeyword("l\u00f6n");

    await waitFor(() => expect(cardTitles()).toEqual(["Lo\u0308ner"]));
  });

  it("looks for what is typed as a whole, and takes no notice of spaces around it", async () => {
    await opened({ workItems: [bodil, process(11, "Lön och skatt", "Idéfas", 1), process(12, "Skatt och lön", "Idéfas", 1)] });
    fireEvent.click(filterButton());

    typeKeyword("  lön och ");

    await waitFor(() => expect(cardTitles()).toEqual(["Lön och skatt"]));
  });

  it("does not take a keyword as a pattern", async () => {
    await opened({ workItems: [bodil, process(11, "PROCESS_103", "Idéfas", 1), process(12, "PROCESSX103", "Idéfas", 1)] });
    fireEvent.click(filterButton());

    typeKeyword("process_1.*");

    await waitFor(() => expect(cardTitles()).toEqual([]));
  });
});

describe("the group", () => {
  it("narrows the board to the objects of the groups chosen, of which any will do", async () => {
    await opened();
    fireEvent.click(filterButton());

    chooseGroup("PROCESS_101.Bodil");

    expect(cardTitles()).toEqual(["Fakturor", "Arkivering"]);
    // The library puts the open dropdown in a layer of its own, outside the page's landmarks.
    await expectNoAccessibilityViolations(screen.getByRole("main"));
    await expectNoAccessibilityViolations(screen.getByRole("listbox", { name: /^Group/ }));

    chooseGroup("PROCESS_103.Cassius");

    expect(cardTitles()).toEqual(["Fakturor", "Löner", "Arkivering"]);
  });

  it("leaves the group list above the board as it is", async () => {
    await opened();
    fireEvent.click(filterButton());

    chooseGroup("PROCESS_101.Bodil");

    const groupList = within(screen.getByRole("list", { name: "Groups" })).getAllByRole("listitem");
    expect(groupList.map(({ textContent }) => textContent)).toEqual(["PROCESS_101.Bodil", "PROCESS_103.Cassius", "Övrigt"]);
  });

  it("offers the groups the board lists, in name order, and not a hidden one", async () => {
    await opened({ savedSettings: { [PROJECT]: savedSettings({ tabs: OUR_TABS, hiddenGroups: [3] }) } });
    fireEvent.click(filterButton());

    fireEvent.click(groupDropdown());

    expect(options().map(({ textContent }) => textContent)).toEqual(["PROCESS_101.Bodil", "PROCESS_103.Cassius"]);
  });

  it("keeps two groups with the same name apart", async () => {
    const platform = await opened({ workItems: [...WORK_ITEMS, robot(4, "PROCESS_101.Bodil"), process(41, "Tvillingens", "Idéfas", 4)] });
    fireEvent.click(filterButton());

    fireEvent.click(groupDropdown());
    fireEvent.click(optionsNamed("PROCESS_101.Bodil")[1]);

    expect(cardTitles()).toEqual(["Tvillingens"]);
    await waitFor(async () => expect((await platform.getQueryParams()).group).toBe("4"));
  });

  it("is not offered when the project has no groups", async () => {
    await opened({ workItems: [process(11, "Föräldralös", "Idéfas")] });
    fireEvent.click(filterButton());

    expect(screen.queryByRole("button", { name: "Group" })).toBeNull();
    expect(keywordBox()).toBeTruthy();
    await expectNoAccessibilityViolations();
  });

  it("renders names from the organization as text, never as HTML", async () => {
    const injected = `<img src=x onerror="window.__hacked=1"><b>grupp</b>`;
    await opened({ workItems: [robot(5, injected), process(51, "Under grupp", "Idéfas", 5)] });
    fireEvent.click(filterButton());

    fireEvent.click(groupDropdown());

    expect(option(injected)).toBeTruthy();
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("the keyword and the group together", () => {
  it("leave only the objects that pass both", async () => {
    await opened();
    fireEvent.click(filterButton());

    chooseGroup("PROCESS_103.Cassius");
    typeKeyword("attester");
    fireEvent.click(screen.getByRole("tab", { name: "Drift" }));

    await waitFor(() => expect(cardTitles()).toEqual(["Attester"]));
  });
});

describe("the × on the filter row", () => {
  it("closes the row, clears the filter, takes it out of the URL and leaves the rest of the URL alone", async () => {
    const platform = await opened({ queryParams: { keyword: "faktur", group: "1", tab: "Före produktion", other: "kvar" } });
    expect(cardTitles()).toEqual(["Fakturor"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear and dismiss filters" }));

    expect(filterRow()).toBeNull();
    expect(cardTitles()).toEqual(["Fakturor", "Löner", "Föräldralös faktura", "Arkivering"]);
    expect(filterButton().getAttribute("aria-label")).toBe("Filter");
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion", other: "kvar" }));
  });

  it("gives focus back to the filter icon, and the row opens empty the next time", async () => {
    await opened({ queryParams: { keyword: "faktur" } });

    fireEvent.click(screen.getByRole("button", { name: "Clear and dismiss filters" }));

    await waitFor(() => expect(document.activeElement).toBe(filterButton()));
    fireEvent.click(filterButton());
    expect(keywordBox().value).toBe("");
  });

  it("closes the row when no filter is active, without writing to the URL", async () => {
    const platform = await opened();
    await waitFor(async () => expect((await platform.getQueryParams()).tab).toBe("Före produktion"));
    const write = vi.spyOn(platform, "setQueryParams");
    fireEvent.click(filterButton());

    fireEvent.click(screen.getByRole("button", { name: "Clear and dismiss filters" }));

    expect(filterRow()).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("the blue dot on the filter icon", () => {
  const dot = () => document.querySelector(".waypoint-filter-dot");

  it("shows only while a filter is active and the row is hidden, and the icon's name says the same", async () => {
    await opened();
    expect(dot()).toBeNull();

    fireEvent.click(filterButton());
    chooseGroup("PROCESS_101.Bodil");
    expect(dot()).toBeNull();
    expect(filterButton().getAttribute("aria-label")).toBe("Filter");

    fireEvent.click(filterButton());
    expect(filterRow()).toBeNull();
    expect(dot()).not.toBeNull();
    expect(filterButton().getAttribute("aria-label")).toBe("Filter, a filter is active");
    expect(cardTitles()).toEqual(["Fakturor", "Arkivering"]);
    await expectNoAccessibilityViolations();

    fireEvent.click(filterButton());
    expect(dot()).toBeNull();
    expect(keywordBox().value).toBe("");
    expect(screen.getByRole("button", { name: /^Group/ }).textContent).toContain("PROCESS_101.Bodil");
  });

  it("does not show for a row closed with nothing in it", async () => {
    await opened();
    fireEvent.click(filterButton());
    fireEvent.click(filterButton());

    expect(dot()).toBeNull();
  });
});

describe("the filter icon", () => {
  it("is not there when there is no board to filter", async () => {
    renderHub(createFakePlatform({ picklistFields: {} }));

    await screen.findByText(/isn't set up/);
    expect(screen.queryByRole("button", { name: /^Filter/ })).toBeNull();
  });

  it("sits beside the gear for an administrator, and is there for everyone else too", async () => {
    await opened({ isAdministrator: true });

    await screen.findByRole("button", { name: "Settings" });
    expect(filterButton()).toBeTruthy();
    await expectNoAccessibilityViolations();
  });
});

describe("the tooltip on the filter icon", () => {
  const WINDOW_WIDTH = 1366;
  /** The place the library leaves between a tooltip's container and the window, on each side. */
  const LIBRARY_EXTRA_SPACE = 5000;
  const tooltip = () => document.querySelector(".bolt-tooltip");

  beforeEach(() => {
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(WINDOW_WIDTH);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(768);
    // jsdom has no layout, so a tooltip is laid out here as in a browser: where its style says, as wide as its text.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const width = this.classList.contains("bolt-tooltip") ? (this.textContent ?? "").length * 6 : 0;
      const { left: fromLeft, right: fromRight } = (this as HTMLElement).style;
      const left = fromLeft
        ? parseFloat(fromLeft) - LIBRARY_EXTRA_SPACE
        : fromRight
          ? WINDOW_WIDTH - (parseFloat(fromRight) - LIBRARY_EXTRA_SPACE) - width
          : 0;
      return { left, right: left + width, width, top: 40, bottom: 68, height: 28 } as DOMRect;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("stays inside the window when a click gives it a longer text, and the icon keeps focus", async () => {
    await opened({ queryParams: { keyword: "faktur" } });
    fireEvent.mouseMove(document.body, { clientX: WINDOW_WIDTH - 60, clientY: 30 });
    const button = filterButton();
    fireEvent.mouseEnter(button);
    await waitFor(() => expect(tooltip()?.textContent).toBe("Filter"));
    button.focus();

    fireEvent.click(button);

    expect(tooltip()?.textContent).toBe("Filter, a filter is active");
    expect(tooltip()?.getBoundingClientRect().right).toBeLessThanOrEqual(WINDOW_WIDTH);
    expect(button.getAttribute("aria-describedby")).toBe(tooltip()?.id);
    expect(document.activeElement).toBe(button);
  });
});

describe("the filter in the URL", () => {
  it("is written there as it changes, beside the other parameters", async () => {
    const platform = await opened({ queryParams: { other: "kvar" } });
    fireEvent.click(filterButton());

    typeKeyword("  faktur ");
    await waitFor(async () => expect((await platform.getQueryParams()).keyword).toBe("faktur"));
    chooseGroup("PROCESS_101.Bodil");
    chooseGroup("PROCESS_103.Cassius");

    await waitFor(async () =>
      expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion", other: "kvar", keyword: "faktur", group: "1,2" }),
    );
  });

  it("does not write again when only spaces change", async () => {
    const platform = await opened({ queryParams: { keyword: "faktur", tab: "Före produktion" } });
    const write = vi.spyOn(platform, "setQueryParams");

    typeKeyword("faktur ");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(write).not.toHaveBeenCalled();
  });

  it("is the same after a reload, with the row open and the tab kept", async () => {
    const platform = await opened();
    fireEvent.click(screen.getByRole("tab", { name: "Drift" }));
    fireEvent.click(filterButton());
    chooseGroup("PROCESS_103.Cassius");
    typeKeyword("attest");
    await waitFor(async () => expect((await platform.getQueryParams()).keyword).toBe("attest"));

    cleanup();
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Drift");
    expect(filterRow()).toBeTruthy();
    expect(keywordBox().value).toBe("attest");
    expect(screen.getByRole("button", { name: /^Group/ }).textContent).toContain("PROCESS_103.Cassius");
    expect(cardTitles()).toEqual(["Attester"]);
    await expectNoAccessibilityViolations();
  });

  it("opens the row from a link without taking focus, and writes nothing when the URL already says it", async () => {
    const platform = createFakePlatform(world({ queryParams: { tab: "Före produktion", keyword: "faktur", group: "1" } }));
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });

    expect(filterRow()).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
    expect(cardTitles()).toEqual(["Fakturor"]);
    await new Promise((resolve) => setTimeout(resolve));
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["a group that does not exist", { group: "999" }],
    ["a group that is hidden", { group: "3" }],
    ["a group that is not a work item id", { group: "Bodil" }],
    ["a group written another way", { group: "1.0" }],
    ["a group with spaces", { group: " 1" }],
    ["a group that is an object", { group: "11" }],
    ["only commas for groups", { group: ",," }],
    ["a keyword of only spaces", { keyword: "   " }],
  ])("ignores %s: no error, nothing narrowed, the row hidden and the URL cleaned", async (_kind, queryParams) => {
    const platform = await opened({
      queryParams: { ...queryParams, tab: "Före produktion", other: "kvar" },
      savedSettings: { [PROJECT]: savedSettings({ tabs: OUR_TABS, hiddenGroups: [3] }) },
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(filterRow()).toBeNull();
    expect(cardTitles()).toEqual(["Fakturor", "Löner", "Föräldralös faktura", "Arkivering"]);
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion", other: "kvar" }));
  });

  it.each([
    ["group", { group: "" }],
    ["keyword", { keyword: "" }],
  ])("takes an empty %s as asking for nothing, and has nothing to write", async (_kind, queryParams) => {
    const platform = createFakePlatform(world({ queryParams: { ...queryParams, tab: "Före produktion" } }));
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });

    expect(filterRow()).toBeNull();
    expect(cardTitles()).toHaveLength(4);
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps what is valid in a list of groups and drops the rest", async () => {
    const platform = await opened({ queryParams: { group: "2,abc,999,1,1" } });

    expect(cardTitles()).toEqual(["Fakturor", "Löner", "Arkivering"]);
    await waitFor(async () => expect((await platform.getQueryParams()).group).toBe("1,2"));
  });

  it("treats a keyword with markup as text to look for, never as HTML", async () => {
    const injected = `<img src=x onerror="window.__hacked=1"><b>x</b>`;
    await opened({ queryParams: { keyword: injected } });

    expect(keywordBox().value).toBe(injected);
    expect(cardTitles()).toEqual([]);
    expect(document.querySelector("img, b")).toBeNull();
  });

  it("says so, shows the whole board and leaves the URL alone until the filter changes, when the URL cannot be read", async () => {
    const platform = createFakePlatform(world({ failures: { getQueryParams: new Error("The host refused.") } }));
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });

    expect((await screen.findByText(/could not read the link/)).textContent).toContain("without a filter");
    expect(filterRow()).toBeNull();
    expect(write).not.toHaveBeenCalled();

    fireEvent.click(filterButton());
    chooseGroup("PROCESS_101.Bodil");

    expect(write).toHaveBeenCalledWith({ keyword: "", group: "1" });
    expect(screen.queryByText(/could not read the link/)).toBeNull();
  });

  it("says so, and still filters, when the URL cannot be written", async () => {
    await opened({ failures: { setQueryParams: new Error("The host refused.") } });
    fireEvent.click(filterButton());

    chooseGroup("PROCESS_101.Bodil");

    expect(cardTitles()).toEqual(["Fakturor", "Arkivering"]);
    expect((await screen.findByText(/could not put the filter in the address/)).textContent).toContain("The host refused.");
  });

  it("still holds after the settings are saved", async () => {
    const platform = await opened({ isAdministrator: true, queryParams: { keyword: "faktur", group: "1" } });
    expect(cardTitles()).toEqual(["Fakturor"]);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("main", { name: "Waypoint settings" });
    fireEvent.click(await within(settings).findByRole("button", { name: "Save" }));

    await waitFor(() => expect(cardTitles()).toEqual(["Fakturor"]));
    expect(keywordBox().value).toBe("faktur");
    expect((await platform.getQueryParams()).group).toBe("1");
  });
});

describe("the filter between visits", () => {
  it("is not kept: a new visit without it in the URL shows the whole board with the row hidden", async () => {
    const stored = createFakePlatform(world());
    const save = vi.spyOn(stored, "saveSettingsDocument");
    renderHub(stored);
    await screen.findByRole("region", { name: "Board" });
    fireEvent.click(filterButton());
    chooseGroup("PROCESS_101.Bodil");
    typeKeyword("faktur");
    await waitFor(() => expect(cardTitles()).toEqual(["Fakturor"]));

    cleanup();
    await opened();

    expect(filterRow()).toBeNull();
    expect(cardTitles()).toEqual(["Fakturor", "Löner", "Föräldralös faktura", "Arkivering"]);
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("rich text under a changing filter", () => {
  afterEach(() => vi.restoreAllMocks());

  const BESKRIVNING: WorkItemField = { referenceName: "Custom.Beskrivning", name: "Beskrivning", kind: "html" };
  const FEATURES = WORK_ITEMS.filter(({ type }) => type === "Feature");
  const withRichText = (rest: FakeWorld = {}) => ({
    workItems: WORK_ITEMS.map((item) =>
      item.type === "Feature"
        ? { ...item, fields: { ...item.fields, [AKTUELLT_LAGE.referenceName]: `<div>Läge ${item.id}</div>`, [BESKRIVNING.referenceName]: `<p>Text ${item.id}</p>` } }
        : item,
    ),
    workItemFields: { Feature: [AKTUELLT_LAGE, BESKRIVNING] },
    savedSettings: {
      [PROJECT]: savedSettings({
        tabs: OUR_TABS,
        roles: { currentSituation: AKTUELLT_LAGE.referenceName },
        detailFields: [AKTUELLT_LAGE.referenceName, BESKRIVNING.referenceName],
      }),
    },
    ...rest,
  });
  const board = () => screen.getByRole("region", { name: "Board" });

  it("is parsed once per object and field, however the filter changes, and shows the same", async () => {
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    await opened(withRichText());
    const parsedOnce = FEATURES.length * 2;
    expect(parse).toHaveBeenCalledTimes(parsedOnce);
    const shownAtFirst = board().textContent;
    const allCards = cardTitles();
    fireEvent.click(filterButton());

    typeKeyword("faktur");
    await waitFor(() => expect(cardTitles()).toEqual(["Fakturor", "Föräldralös faktura"]));
    expect(board().textContent).toContain("Läge 11");
    const firstGroupName = String(bodil.fields["System.Title"]);
    chooseGroup(firstGroupName);
    expect(cardTitles()).toEqual(["Fakturor"]);
    chooseGroup(firstGroupName);
    typeKeyword("");
    await waitFor(() => expect(cardTitles()).toEqual(allCards));

    expect(board().textContent).toBe(shownAtFirst);
    fireEvent.click(screen.getByRole("button", { name: /^Fakturor/ }));
    const panel = await screen.findByRole("dialog");
    expect(panel.textContent).toContain("Läge 11");
    expect(panel.textContent).toContain("Text 11");
    expect(parse).toHaveBeenCalledTimes(parsedOnce);
  });

  it("is read anew when a new fetch brings other text", async () => {
    const fakturor = process(11, "Fakturor", "Idéfas", 1);
    fakturor.fields[AKTUELLT_LAGE.referenceName] = "<div>Före</div>";
    await opened(withRichText({ isAdministrator: true, workItems: [bodil, fakturor] }));
    expect(board().textContent).toContain("Före");

    fakturor.fields[AKTUELLT_LAGE.referenceName] = "<div>Efter</div>";
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("main", { name: "Waypoint settings" });
    fireEvent.click(await within(settings).findByRole("button", { name: "Save" }));

    await waitFor(() => expect(board().textContent).toContain("Efter"));
    expect(board().textContent).not.toContain("Före");
  });
});

describe("the outcome of filtering", () => {
  const status = () => screen.getByRole("status");

  it("is announced in a status that is there before the filter is, counting every tab", async () => {
    await opened();
    expect(status().textContent).toBe("");
    fireEvent.click(filterButton());

    chooseGroup("PROCESS_103.Cassius");
    expect(status().textContent).toBe("2 objects match the filter across all tabs.");

    typeKeyword("attester");
    await waitFor(() => expect(status().textContent).toBe("1 object matches the filter across all tabs."));
  });

  it("counts in the column headings", async () => {
    await opened({ queryParams: { group: "2" } });

    const headings = within(screen.getByRole("region", { name: "Board" })).getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Idéfas 1 object",
      "Under utvärdering 0 objects",
      "Under planering 0 objects",
      "Under utveckling 0 objects",
    ]);
  });

  it("leaves out the columns that exist only for objects it took away", async () => {
    await opened({
      workItems: [bodil, process(11, "Med fas", "Avvecklad", 1), process(12, "Gammal", "Nedlagd", 1), process(13, "Utan fas", undefined, 1)],
      queryParams: { keyword: "med fas", tab: "Avslut" },
    });

    const headings = within(screen.getByRole("region", { name: "Board" })).getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual(["Under avveckling 0 objects", "Avvecklad 1 object", "Avfärdad 0 objects"]);
  });
});

describe("a project with more objects than the board can hold", () => {
  const many = (first: number, count: number, parent: number) =>
    Array.from({ length: count }, (_, index) => process(first + index, `Process ${first + index}`, "Idéfas", parent));
  const beyond = process(9001, "Bortom gränsen", "Pausad", 2);
  const large = { workItems: [bodil, robot(2, "Zeta"), ...many(100, 2100, 1), beyond], savedSettings: { [PROJECT]: savedSettings() } };

  it("lets the keyword reach an object beyond the first 2,000, and the banner goes when all the rest fit", async () => {
    await opened(large);
    expect(screen.getByText("Showing 2,000 of 2,101. Narrow with filters or hide groups in settings.")).toBeTruthy();
    expect(screen.queryByText("Bortom gränsen")).toBeNull();
    fireEvent.click(filterButton());

    typeKeyword("bortom");

    expect(await screen.findByText("Bortom gränsen")).toBeTruthy();
    expect(screen.queryByText(/^Showing [\d,]+ of /)).toBeNull();
  }, 60_000);

  it("lets the group reach an object beyond the first 2,000, also from a link", async () => {
    await opened({ ...large, queryParams: { group: "2" } });

    expect(screen.getByText("Bortom gränsen")).toBeTruthy();
    expect(screen.queryByText(/^Showing [\d,]+ of /)).toBeNull();
  }, 60_000);

  it("counts what is left after the filter when that too is more than the board can hold", async () => {
    await opened({ workItems: [bodil, robot(2, "Zeta"), ...many(100, 2003, 2), ...many(5000, 50, 1)], savedSettings: { [PROJECT]: savedSettings() }, queryParams: { group: "2" } });

    expect(screen.getByText("Showing 2,000 of 2,003. Narrow with filters or hide groups in settings.")).toBeTruthy();
  }, 60_000);
});

describe("filtering a board of 2,000 objects", () => {
  // Only the library's wait for a pause in typing runs on timers here, so that the measure is the work and not the wait.
  const passTheTypingPause = () => act(() => void vi.advanceTimersByTime(KEYWORD_PAUSE));
  const KEYWORD_PAUSE = 200;
  const cards = () => screen.queryAllByText(/^Process \d+$/);
  const processes = (phaseOf: (index: number) => string) =>
    Array.from({ length: 2000 }, (_, index) => process(100 + index, `Process ${index}`, phaseOf(index), 1 + (Math.floor(index / 2) % 2)));
  const onOneTab = () => "Idéfas";
  const spread = (index: number) => ["Idéfas", "Under utvärdering", "Under planering", "Under utveckling"][index % 4];
  const onTwoTabs = (index: number) => ["Idéfas", "I produktion"][index % 2];

  it.each([
    ["all in one column", onOneTab],
    ["spread over the tab's columns", spread],
  ])("redraws without noticeable delay in both directions, with the objects %s", async (_spread, phaseOf) => {
    await opened({ workItems: [bodil, cassius, ...processes(phaseOf)] });
    fireEvent.click(filterButton());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const [narrowed, widened] = fastestOfThreeGoes(() => {
        typeKeyword("Process 1999");
        const narrowing = timeOf(passTheTypingPause);
        expect(cards()).toHaveLength(1);

        typeKeyword("");
        const widening = timeOf(passTheTypingPause);
        expect(cards()).toHaveLength(2000);
        return [narrowing, widening];
      });

      expect(narrowed).toBeLessThan(REDRAW_BUDGET);
      expect(widened).toBeLessThan(REDRAW_BUDGET);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);

  it("redraws without noticeable delay when a group is chosen, and on a tab change with the filter on", async () => {
    await opened({ workItems: [bodil, cassius, ...processes(onTwoTabs)] });
    expect(cards()).toHaveLength(1000);
    fireEvent.click(filterButton());
    fireEvent.click(groupDropdown());
    const [firstTab] = screen.getAllByRole("tab");

    const [chosen, tabChanged] = fastestOfThreeGoes(() => {
      const firstGroup = option("PROCESS_101.Bodil");
      const choosing = timeOf(() => fireEvent.click(firstGroup));
      expect(cards()).toHaveLength(500);

      const changing = timeOf(() => fireEvent.click(screen.getByRole("tab", { name: "Drift" })));
      expect(cards()).toHaveLength(500);
      expect(cardTitles()).not.toContain("Process 0");

      fireEvent.click(firstTab);
      fireEvent.click(option("PROCESS_101.Bodil"));
      expect(cards()).toHaveLength(1000);
      return [choosing, changing];
    });

    expect(chosen).toBeLessThan(REDRAW_BUDGET);
    expect(tabChanged).toBeLessThan(REDRAW_BUDGET);
  }, 60_000);
});
