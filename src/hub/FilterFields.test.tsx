import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakePlatform, type FakeWorkItem, type FakeWorld } from "../platform/fakePlatform";
import type { FilterField } from "../settings/settings";
import { expectNoAccessibilityViolations, renderHub } from "../testing/hubRig";
import { PHASES, PHASE_FIELD, process, robot, savedSettings } from "../testing/lifecycleWorld";

const PROJECT = "this-project";
const OMRADE_FIELD = "Custom.Forvaltningsomrade";
const GKL_FIELD = "Custom.GKL";
const VANTAR_FIELD = "Custom.VantarPa";

const OMRADE: FilterField = { type: "choice", name: "Förvaltningsområde", referenceName: OMRADE_FIELD };
const IT_STOD: FilterField = { type: "tagPrefix", name: "IT-stöd", prefix: "IT-stöd: ", excludedTags: ["IT-stöd: Gammalt"] };
const GKL: FilterField = { type: "startsWith", name: "GKL", referenceName: GKL_FIELD };
const VANTAR: FilterField = { type: "filled", name: "Väntar på", referenceName: VANTAR_FIELD, filledText: "Waiting", emptyText: "Not waiting" };
const ALL_FILTER_FIELDS = [OMRADE, IT_STOD, GKL, VANTAR];

const withFields = (item: FakeWorkItem, fields: Record<string, unknown>): FakeWorkItem => ({ ...item, fields: { ...item.fields, ...fields } });

const HAMTA = "PROCESS_101.Bodil.HamtaUnderlag";
const SVARA = "PROCESS_102.Bodil.SkickaSvar";
const ARKIVERA = "PROCESS_103.Cassius.Arkivera";
const TOM = "PROCESS_104.Cassius.Tom";

const WORK_ITEMS = [
  robot(1, "Bodil"),
  robot(2, "Cassius"),
  withFields(process(101, HAMTA, "Idéfas", 1), { [OMRADE_FIELD]: "Inköp", "System.Tags": "Internt; IT-stöd: Dokportalen", [GKL_FIELD]: "7.3.0", [VANTAR_FIELD]: "Intressent" }),
  withFields(process(102, SVARA, "Idéfas", 1), { [OMRADE_FIELD]: "Ekonomi", "System.Tags": "IT-stöd: Ärendesystemet", [GKL_FIELD]: "7.4.0" }),
  withFields(process(103, ARKIVERA, "Idéfas", 2), { [OMRADE_FIELD]: "Inköp", "System.Tags": "IT-stöd: Dokportalen; IT-stöd: Gammalt; IT-stöd: Ärendesystemet", [GKL_FIELD]: "17.3.0" }),
  process(104, TOM, "Idéfas", 2),
];
const EVERYTHING = [HAMTA, SVARA, ARKIVERA, TOM];

const world = (filterFields: FilterField[] = ALL_FILTER_FIELDS, rest: FakeWorld = {}): FakeWorld => ({
  projectId: PROJECT,
  workItemTypes: ["Epic", "Feature"],
  picklistFields: {
    Feature: [
      { referenceName: PHASE_FIELD, name: "Livscykel", values: PHASES },
      { referenceName: OMRADE_FIELD, name: "Förvaltningsområde", values: ["Inköp", "Ekonomi"] },
    ],
  },
  workItemFields: {
    Feature: [
      { referenceName: GKL_FIELD, name: "GKL", kind: "text" },
      { referenceName: VANTAR_FIELD, name: "Väntar på", kind: "text" },
    ],
  },
  workItems: WORK_ITEMS,
  savedSettings: { [PROJECT]: savedSettings({ filterFields }) },
  ...rest,
});

const opened = async (filterFields?: FilterField[], rest?: FakeWorld) => {
  const platform = createFakePlatform(world(filterFields, rest));
  renderHub(platform);
  await screen.findByRole("region", { name: "Board" });
  return platform;
};

/** Opens the row, for a board opened without a filter in its link. */
const openedWithRow = async (filterFields?: FilterField[], rest?: FakeWorld) => {
  const platform = await opened(filterFields, rest);
  fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
  return platform;
};

const cardTitles = () => [...screen.getByRole("region", { name: "Board" }).querySelectorAll(".waypoint-card-title")].map((title) => title.textContent);
const dropdown = (name: string | RegExp) => screen.getByRole("button", { name: typeof name === "string" ? new RegExp(`^${name}`) : name });
const optionTexts = () => screen.getAllByRole("option").map(({ textContent }) => textContent);
const clickOption = (text: string) => fireEvent.click(screen.getAllByRole("option").filter(({ textContent }) => textContent === text)[0]);
const typeText = (name: string, text: string) => fireEvent.change(screen.getByRole("textbox", { name }), { target: { value: text } });
const inUrl = async (platform: { getQueryParams(): Promise<Record<string, string>> }) => platform.getQueryParams();

describe("the name of a dropdown", () => {
  const named = (name: string) => dropdown(name).getAttribute("aria-label");

  it("holds the words it shows, which voice control goes by", async () => {
    await openedWithRow();

    expect(named("Väntar på")).toBe("Väntar på: All");
    expect(named("Förvaltningsområde")).toBe("Förvaltningsområde");
    expect(named("Group")).toBe("Group");
  });

  it("follows what is chosen, also of several", async () => {
    await openedWithRow();

    fireEvent.click(dropdown("Väntar på"));
    clickOption("Waiting");
    expect(named("Väntar på")).toBe("Väntar på: Waiting");

    fireEvent.click(dropdown("IT-stöd"));
    clickOption("Dokportalen");
    clickOption("Ärendesystemet");
    expect(named("IT-stöd")).toBe("IT-stöd: Dokportalen (+1)");
  });
});

describe("a filter field of one choice", () => {
  it("offers the picklist's values, narrows the board to the one chosen and says so in the URL", async () => {
    const platform = await openedWithRow();

    fireEvent.click(dropdown("Förvaltningsområde"));
    expect(optionTexts()).toEqual(["Inköp", "Ekonomi"]);
    clickOption("Ekonomi");

    expect(cardTitles()).toEqual([SVARA]);
    await waitFor(async () => expect((await inUrl(platform))["filter.Förvaltningsområde"]).toBe("Ekonomi"));
  });

  it("holds one value at a time, and can be emptied again", async () => {
    const platform = await openedWithRow();

    fireEvent.click(dropdown("Förvaltningsområde"));
    clickOption("Ekonomi");
    fireEvent.click(dropdown("Förvaltningsområde"));
    clickOption("Inköp");
    expect(cardTitles()).toEqual([HAMTA, ARKIVERA]);

    fireEvent.click(dropdown("Förvaltningsområde"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(cardTitles()).toEqual(EVERYTHING);
    await waitFor(async () => expect((await inUrl(platform))["filter.Förvaltningsområde"]).toBeUndefined());
  });
});

describe("a filter field of tags with a prefix", () => {
  it("offers the tags with the prefix, without it, in name order and without those unticked", async () => {
    await openedWithRow();

    fireEvent.click(dropdown("IT-stöd"));

    expect(optionTexts()).toEqual(["Dokportalen", "Ärendesystemet"]);
    await expectNoAccessibilityViolations(screen.getByRole("listbox", { name: /^IT-stöd/ }));
  });

  it("offers a new tag with the prefix without anyone asking", async () => {
    await openedWithRow(undefined, { projectTags: ["IT-stöd: Dokportalen", "IT-stöd: Ny", "IT-stöd: Gammalt", "Internt"] });

    fireEvent.click(dropdown("IT-stöd"));

    expect(optionTexts()).toEqual(["Dokportalen", "Ny"]);
  });

  it("lets any of those chosen do, and matches whole tags", async () => {
    const platform = await openedWithRow();

    fireEvent.click(dropdown("IT-stöd"));
    clickOption("Ärendesystemet");
    expect(cardTitles()).toEqual([SVARA, ARKIVERA]);

    clickOption("Dokportalen");

    expect(cardTitles()).toEqual([HAMTA, SVARA, ARKIVERA]);
    await waitFor(async () => expect((await inUrl(platform))["filter.IT-stöd"]).toBe("IT-stöd: Dokportalen; IT-stöd: Ärendesystemet"));
  });

  it("is not offered when the project has no such tag, and reads the tags only when a filter field needs them", async () => {
    await openedWithRow([{ type: "tagPrefix", name: "Saknas", prefix: "Saknas: ", excludedTags: [] }]);
    expect(screen.queryByRole("button", { name: /^Saknas/ })).toBeNull();
    cleanup();

    const platform = createFakePlatform(world([GKL]));
    const read = vi.spyOn(platform, "getProjectTags");
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the tags on each object only when a filter field needs them", async () => {
    const platform = createFakePlatform(world([GKL]));
    const read = vi.spyOn(platform, "getWorkItemsBatch");
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });

    expect(read.mock.calls.flatMap(([, , fields]) => fields)).not.toContain("System.Tags");
  });

  it("costs itself and not the board when the tags cannot be read, says why and keeps its place in the link", async () => {
    const platform = await openedWithRow(undefined, {
      failures: { getProjectTags: new Error("TF400813: Not authorized.") },
      queryParams: { "filter.IT-stöd": "IT-stöd: Dokportalen" },
    });

    expect(cardTitles()).toEqual(EVERYTHING);
    expect(screen.queryByRole("button", { name: /^IT-stöd/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "GKL starts with" })).toBeTruthy();
    const warning = screen.getByText(/could not read the project's tags/);
    expect(warning.textContent).toContain("left out 1 filter");
    expect(warning.textContent).toContain("TF400813");
    expect((await inUrl(platform))["filter.IT-stöd"]).toBe("IT-stöd: Dokportalen");
  });
});

describe("a filter field of text that starts with", () => {
  it("narrows the board to what begins with what is typed, and says so in the URL", async () => {
    const platform = await openedWithRow();

    typeText("GKL starts with", " 7.3 ");

    await waitFor(() => expect(cardTitles()).toEqual([HAMTA]));
    await waitFor(async () => expect((await inUrl(platform))["filter.GKL"]).toBe("7.3"));
  });

  it("does not count a box of only spaces", async () => {
    const platform = await openedWithRow();
    await waitFor(async () => expect((await inUrl(platform)).tab).toBeTruthy());
    const write = vi.spyOn(platform, "setQueryParams");

    typeText("GKL starts with", "   ");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(cardTitles()).toEqual(EVERYTHING);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("a filter field of filled in or empty", () => {
  it("offers All and the two answers in the words chosen, with All to start with", async () => {
    await openedWithRow();
    expect(dropdown("Väntar på").textContent).toContain("All");

    fireEvent.click(dropdown("Väntar på"));

    expect(optionTexts()).toEqual(["All", "Waiting", "Not waiting"]);
  });

  it("narrows the board by each answer, counts a missing field as empty, and goes back with All", async () => {
    const platform = await openedWithRow();

    fireEvent.click(dropdown("Väntar på"));
    clickOption("Waiting");
    expect(cardTitles()).toEqual([HAMTA]);
    await waitFor(async () => expect((await inUrl(platform))["filter.Väntar på"]).toBe("filled"));

    fireEvent.click(dropdown("Väntar på"));
    clickOption("Not waiting");
    expect(cardTitles()).toEqual([SVARA, ARKIVERA, TOM]);
    await waitFor(async () => expect((await inUrl(platform))["filter.Väntar på"]).toBe("empty"));

    fireEvent.click(dropdown("Väntar på"));
    clickOption("All");
    expect(cardTitles()).toEqual(EVERYTHING);
    await waitFor(async () => expect((await inUrl(platform))["filter.Väntar på"]).toBeUndefined());
  });
});

describe("all the filter fields together", () => {
  it("leave only the objects that pass them all, also with keyword and group", async () => {
    await openedWithRow();

    fireEvent.click(dropdown("Förvaltningsområde"));
    clickOption("Inköp");
    fireEvent.click(dropdown("IT-stöd"));
    clickOption("Dokportalen");
    fireEvent.click(dropdown("Väntar på"));
    clickOption("Not waiting");

    expect(cardTitles()).toEqual([ARKIVERA]);
    expect(screen.getAllByRole("status").some(({ textContent }) => textContent === "1 object matches the filter across all tabs.")).toBe(true);
  });

  it("are cleared by the ×, also from the URL, and the row opens empty the next time", async () => {
    const platform = await opened(undefined, {
      queryParams: { "filter.Förvaltningsområde": "Inköp", "filter.IT-stöd": "IT-stöd: Dokportalen", "filter.GKL": "7", "filter.Väntar på": "filled", other: "kvar" },
    });
    expect(cardTitles()).toEqual([HAMTA]);

    fireEvent.click(screen.getByRole("button", { name: "Clear and dismiss filters" }));

    expect(cardTitles()).toEqual(EVERYTHING);
    await waitFor(async () => expect(await inUrl(platform)).toEqual({ tab: "All phases", other: "kvar" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect((screen.getByRole("textbox", { name: "GKL starts with" }) as HTMLInputElement).value).toBe("");
    expect(dropdown("Väntar på").textContent).toContain("All");
  });

  it("show the blue dot when the row is hidden", async () => {
    await openedWithRow();
    fireEvent.click(dropdown("Väntar på"));
    clickOption("Waiting");

    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

    expect(screen.getByRole("button", { name: "Filter, a filter is active" })).toBeTruthy();
    expect(cardTitles()).toEqual([HAMTA]);
  });

  it("have nothing for axe to find in the row", async () => {
    await openedWithRow();

    await expectNoAccessibilityViolations();
  });
});

describe("the filter fields in a link", () => {
  const LINK = {
    tab: "All phases",
    "filter.Förvaltningsområde": "Inköp",
    "filter.IT-stöd": "IT-stöd: Dokportalen; IT-stöd: Ärendesystemet",
    "filter.GKL": "7",
    "filter.Väntar på": "filled",
  };

  it("open the row with all of them filled in, without writing anything, and hold through a reload", async () => {
    const platform = createFakePlatform(world(undefined, { queryParams: LINK }));
    const write = vi.spyOn(platform, "setQueryParams");

    for (let visit = 0; visit < 2; visit++) {
      renderHub(platform);
      await screen.findByRole("region", { name: "Board" });

      expect(cardTitles()).toEqual([HAMTA]);
      expect(dropdown("Förvaltningsområde").textContent).toContain("Inköp");
      expect(dropdown("IT-stöd").textContent).toContain("Dokportalen (+1)");
      expect((screen.getByRole("textbox", { name: "GKL starts with" }) as HTMLInputElement).value).toBe("7");
      expect(dropdown("Väntar på").textContent).toContain("Waiting");
      cleanup();
    }

    await new Promise((resolve) => setTimeout(resolve));
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["a value the picklist does not have", { "filter.Förvaltningsområde": "Finns inte" }],
    ["a tag that does not exist", { "filter.IT-stöd": "IT-stöd: Finns inte" }],
    ["a tag that is unticked", { "filter.IT-stöd": "IT-stöd: Gammalt" }],
    ["a tag without its prefix", { "filter.IT-stöd": "Dokportalen" }],
    ["text of only spaces", { "filter.GKL": "   " }],
    ["an answer that is neither", { "filter.Väntar på": "maybe" }],
    ["the word for all", { "filter.Väntar på": "all" }],
  ])("ignore %s: no error, nothing narrowed, the row hidden and the URL cleaned", async (_kind, queryParams) => {
    const platform = await opened(undefined, { queryParams: { ...queryParams, tab: "All phases", other: "kvar" } });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Filter" })).toBeNull();
    expect(cardTitles()).toEqual(EVERYTHING);
    await waitFor(async () => expect(await inUrl(platform)).toEqual({ tab: "All phases", other: "kvar" }));
  });

  it.each([
    ["a filter field that does not exist", { "filter.Finns inte": "x" }],
    ["a name meant to trip up the code", { "filter.__proto__": "x", "filter.constructor": "y" }],
  ])("ignore %s: no error, nothing narrowed, the row hidden and the parameter left where it is", async (_kind, queryParams) => {
    const link = { ...queryParams, tab: "All phases", other: "kvar" };
    const platform = await opened(undefined, { queryParams: link });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Filter" })).toBeNull();
    expect(cardTitles()).toEqual(EVERYTHING);
    await new Promise((resolve) => setTimeout(resolve));
    expect(await inUrl(platform)).toEqual(link);
  });

  it("keep what is valid in a list of tags and drop the rest", async () => {
    const platform = await opened(undefined, { queryParams: { "filter.IT-stöd": "IT-stöd: Gammalt; IT-stöd: Ärendesystemet; Internt" } });

    expect(cardTitles()).toEqual([SVARA, ARKIVERA]);
    await waitFor(async () => expect((await inUrl(platform))["filter.IT-stöd"]).toBe("IT-stöd: Ärendesystemet"));
  });

  it("take a picklist value with a '; ' in it as one value", async () => {
    const platform = await opened([OMRADE], {
      picklistFields: { Feature: [{ referenceName: PHASE_FIELD, name: "Livscykel", values: PHASES }, { referenceName: OMRADE_FIELD, name: "Förvaltningsområde", values: ["Inköp; lager"] }] },
      workItems: [withFields(process(1, "Delad", "Idéfas"), { [OMRADE_FIELD]: "Inköp; lager" }), process(2, "Annan", "Idéfas")],
      queryParams: { "filter.Förvaltningsområde": "Inköp; lager", tab: "All phases" },
    });

    expect(cardTitles()).toEqual(["Delad"]);
    expect((await inUrl(platform))["filter.Förvaltningsområde"]).toBe("Inköp; lager");
  });

  it("treat markup as text to look for, never as HTML", async () => {
    const injected = `<img src=x onerror="window.__hacked=1"><b>x</b>`;
    await opened(undefined, { queryParams: { "filter.GKL": injected } });

    expect((screen.getByRole("textbox", { name: "GKL starts with" }) as HTMLInputElement).value).toBe(injected);
    expect(document.querySelector("img, b")).toBeNull();
  });

  it("are not kept between visits", async () => {
    const platform = await openedWithRow();
    fireEvent.click(dropdown("Väntar på"));
    clickOption("Waiting");
    expect(cardTitles()).toEqual([HAMTA]);
    const save = vi.spyOn(platform, "saveSettingsDocument");
    cleanup();

    await opened();

    expect(cardTitles()).toEqual(EVERYTHING);
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("names from the organization in the filter fields", () => {
  it("render as text, never as HTML", async () => {
    const injected = `<img src=x onerror="window.__hacked=1"><b>namn</b>`;
    await openedWithRow([{ type: "tagPrefix", name: injected, prefix: "IT-stöd: ", excludedTags: [] }], { projectTags: [`IT-stöd: ${injected}`] });

    fireEvent.click(dropdown(/^</));

    expect(optionTexts()).toEqual([injected]);
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("a filter field whose field is gone", () => {
  const GONE: FilterField = { type: "startsWith", name: "Borttaget", referenceName: "Custom.Borttaget" };

  it("costs itself and not the board, and the hub says so", async () => {
    await openedWithRow([GONE, GKL]);

    expect(cardTitles()).toEqual(EVERYTHING);
    expect(screen.queryByRole("textbox", { name: "Borttaget starts with" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "GKL starts with" })).toBeTruthy();
    expect(screen.getByText(/left out 1 filter/).textContent).toContain("A Project Administrator");
  });

  it("keeps its place in a link, so that the link holds if the field comes back, and the rest still narrows", async () => {
    const platform = await opened([GONE, GKL], { queryParams: { "filter.Borttaget": "x", "filter.GKL": "7.3" } });

    expect(cardTitles()).toEqual([HAMTA]);
    await new Promise((resolve) => setTimeout(resolve));
    expect((await inUrl(platform))["filter.Borttaget"]).toBe("x");
  });
});

describe("the filter fields before anything is set up", () => {
  it("are none, so the row holds only keyword and group", async () => {
    renderHub(createFakePlatform({ ...world(), savedSettings: {} }));
    await screen.findByRole("region", { name: "Board" });

    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));

    expect(screen.queryByRole("textbox", { name: /starts with/ })).toBeNull();
    expect(dropdown("Group")).toBeTruthy();
  });
});

