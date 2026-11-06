import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakePlatform, type FakePlatform, type FakeWorld } from "../platform/fakePlatform";
import { expectNoAccessibilityViolations, renderHub } from "../testing/hubRig";
import { PHASES, PHASE_FIELD, process, robot, savedSettings } from "../testing/lifecycleWorld";
import type { FilterField } from "./settings";

const PROJECT = "this-project";
const OMRADE_FIELD = "Custom.Forvaltningsomrade";
const GKL_FIELD = "Custom.GKL";
const VANTAR_FIELD = "Custom.VantarPa";

const WORK_ITEMS = [
  robot(1, "Bodil"),
  { ...process(101, "PROCESS_101.Bodil.HamtaUnderlag", "Idéfas", 1), fields: { ...process(101, "PROCESS_101.Bodil.HamtaUnderlag", "Idéfas", 1).fields, [OMRADE_FIELD]: "Inköp", [GKL_FIELD]: "7.3.0" } },
  process(102, "PROCESS_102.Bodil.SkickaSvar", "Idéfas", 1),
];

function adminWorld(filterFields?: FilterField[], rest: FakeWorld = {}): FakeWorld {
  return {
    projectId: PROJECT,
    isAdministrator: true,
    workItemTypes: ["Epic", "Feature", "Issue"],
    picklistFields: {
      Feature: [
        { referenceName: PHASE_FIELD, name: "Livscykel", values: PHASES },
        { referenceName: OMRADE_FIELD, name: "Förvaltningsområde", values: ["Inköp", "Ekonomi"] },
      ],
      Issue: [{ referenceName: "Custom.IssueFas", name: "Issuefas", values: ["Ny"] }],
    },
    workItemFields: {
      Feature: [
        { referenceName: GKL_FIELD, name: "GKL", kind: "text" },
        { referenceName: VANTAR_FIELD, name: "Väntar på", kind: "text" },
        { referenceName: "Custom.Beskrivning", name: "Beskrivning", kind: "html" },
        { referenceName: "Custom.Pagar", name: "Pågår", kind: "yesNo" },
        { referenceName: "System.AssignedTo", name: "Assigned To", kind: "identity" },
        { referenceName: "System.CreatedDate", name: "Created Date", kind: "date" },
      ],
    },
    workItems: WORK_ITEMS,
    projectTags: ["IT-stöd: Ärendesystemet", "Internt", "IT-stöd: Dokportalen"],
    savedSettings: { [PROJECT]: savedSettings({ filterFields: filterFields ?? [] }) },
    ...rest,
  };
}

async function openSettings(world: FakeWorld = adminWorld()): Promise<{ platform: FakePlatform; settings: HTMLElement }> {
  const platform = createFakePlatform(world);
  renderHub(platform);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  const settings = await screen.findByRole("main", { name: "Waypoint settings" });
  await within(settings).findByRole("button", { name: "Save" });
  return { platform, settings };
}

async function storedFilterFields(platform: FakePlatform): Promise<unknown> {
  const stored = await platform.getSettingsDocument(PROJECT);
  return (stored?.content as { settings: { filterFields: unknown } }).settings.filterFields;
}

const add = (settings: HTMLElement) => fireEvent.click(within(settings).getByRole("button", { name: "Add filter" }));
const dropdownOf = (settings: HTMLElement, name: string) => within(settings).getByRole<HTMLInputElement>("button", { name });
const textOf = (settings: HTMLElement, name: string) => within(settings).getByRole<HTMLInputElement>("textbox", { name });
const type = (settings: HTMLElement, name: string, text: string) => fireEvent.change(textOf(settings, name), { target: { value: text } });
const choose = async (settings: HTMLElement, name: string, option: string) => {
  fireEvent.click(dropdownOf(settings, name));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};
const offered = async (settings: HTMLElement, name: string) => {
  fireEvent.click(dropdownOf(settings, name));
  const options = (await screen.findAllByRole("option")).map(({ textContent }) => textContent);
  fireEvent.click(dropdownOf(settings, name));
  return options;
};
const saveButton = (settings: HTMLElement) => within(settings).getByRole("button", { name: "Save" });
const save = async (settings: HTMLElement) => {
  fireEvent.click(saveButton(settings));
  await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
};
const canSave = (settings: HTMLElement) => saveButton(settings).getAttribute("aria-disabled") !== "true";
const tagBoxes = (settings: HTMLElement) => within(settings).getAllByRole<HTMLElement>("checkbox", { name: /^Offer / });

describe("adding filter fields", () => {
  it("saves one of each type, and the filter row offers them", async () => {
    const { platform, settings } = await openSettings();
    await expectNoAccessibilityViolations(settings);

    add(settings);
    type(settings, "Name of filter 1", "Förvaltningsområde");
    await choose(settings, "Field of filter 1", "Förvaltningsområde");

    add(settings);
    await choose(settings, "Type of filter 2", "Tags with a prefix");
    type(settings, "Name of filter 2", "IT-stöd");
    type(settings, "Tag prefix of filter 2", "IT-stöd: ");
    await within(settings).findByRole("checkbox", { name: "Offer Dokportalen" });

    add(settings);
    await choose(settings, "Type of filter 3", "Text that starts with");
    type(settings, "Name of filter 3", "GKL");
    await choose(settings, "Field of filter 3", "GKL");

    add(settings);
    await choose(settings, "Type of filter 4", "Filled in or empty");
    type(settings, "Name of filter 4", "Väntar på");
    await choose(settings, "Field of filter 4", "Väntar på");
    type(settings, "Text for filled in, filter 4", "Waiting");
    type(settings, "Text for empty, filter 4", "Not waiting");
    await expectNoAccessibilityViolations(settings);

    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([
      { type: "choice", name: "Förvaltningsområde", referenceName: OMRADE_FIELD },
      { type: "tagPrefix", name: "IT-stöd", prefix: "IT-stöd: ", excludedTags: [] },
      { type: "startsWith", name: "GKL", referenceName: GKL_FIELD },
      { type: "filled", name: "Väntar på", referenceName: VANTAR_FIELD, filledText: "Waiting", emptyText: "Not waiting" },
    ]);
    const toggle = await screen.findByRole("button", { name: /^Filter/ });
    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: /^Förvaltningsområde/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^IT-stöd/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "GKL starts with" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Väntar på/ })).toBeTruthy();
  });

  it("logs the change like any other save", async () => {
    const { platform, settings } = await openSettings();
    add(settings);
    type(settings, "Name of filter 1", "Område");
    await choose(settings, "Field of filter 1", "Förvaltningsområde");

    await save(settings);

    const stored = await platform.getSettingsDocument(PROJECT);
    expect((stored?.content as { log: unknown[] }).log).toHaveLength(1);
  });

  it("offers each type the fields it can use, in name order", async () => {
    const { settings } = await openSettings();
    add(settings);

    expect(await offered(settings, "Field of filter 1")).toEqual(["Förvaltningsområde", "Livscykel"]);

    await choose(settings, "Type of filter 1", "Text that starts with");
    expect(await offered(settings, "Field of filter 1")).toEqual(["Förvaltningsområde", "GKL", "Livscykel", "Väntar på"]);

    await choose(settings, "Type of filter 1", "Filled in or empty");
    expect(await offered(settings, "Field of filter 1")).toEqual(["Assigned To", "Created Date", "Förvaltningsområde", "GKL", "Livscykel", "Väntar på"]);
  });

  it("leaves the name to the administrator when a field is chosen", async () => {
    const { settings } = await openSettings();
    add(settings);

    await choose(settings, "Field of filter 1", "Förvaltningsområde");

    expect(textOf(settings, "Name of filter 1").value).toBe("");
    expect(canSave(settings)).toBe(false);
  });

  it("takes spaces off the name and the texts, and not off the prefix", async () => {
    const { platform, settings } = await openSettings();
    add(settings);
    await choose(settings, "Type of filter 1", "Tags with a prefix");
    type(settings, "Name of filter 1", "  IT-stöd ");
    type(settings, "Tag prefix of filter 1", "IT-stöd: ");
    add(settings);
    await choose(settings, "Type of filter 2", "Filled in or empty");
    type(settings, "Name of filter 2", "Väntar på");
    await choose(settings, "Field of filter 2", "Väntar på");
    type(settings, "Text for filled in, filter 2", " Waiting ");

    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([
      { type: "tagPrefix", name: "IT-stöd", prefix: "IT-stöd: ", excludedTags: [] },
      { type: "filled", name: "Väntar på", referenceName: VANTAR_FIELD, filledText: "Waiting", emptyText: "Empty" },
    ]);
  });
});

describe("what cannot be saved", () => {
  const problemOf = (settings: HTMLElement) => within(settings).getByRole("region", { name: "Filters" }).querySelector("[aria-live].waypoint-settings-hint")?.textContent;

  it.each([
    ["no name", async (settings: HTMLElement) => type(settings, "Name of filter 1", "   "), "Give every filter a name."],
    ["no field", async () => undefined, "Choose a field for filter 1."],
  ])("refuses a filter with %s, and says why", async (_kind, prepare, problem) => {
    const { settings } = await openSettings();
    add(settings);
    type(settings, "Name of filter 1", "Något");

    await prepare(settings);

    expect(canSave(settings)).toBe(false);
    expect(problemOf(settings)).toBe(problem);
  });

  it("refuses two filters with the same name", async () => {
    const { settings } = await openSettings();
    add(settings);
    type(settings, "Name of filter 1", "Förvaltningsområde");
    await choose(settings, "Field of filter 1", "Förvaltningsområde");
    add(settings);
    type(settings, "Name of filter 2", "Livscykel");
    await choose(settings, "Field of filter 2", "Livscykel");
    expect(canSave(settings)).toBe(true);

    type(settings, "Name of filter 2", " Förvaltningsområde ");

    expect(canSave(settings)).toBe(false);
    expect(problemOf(settings)).toBe("Two filters are named Förvaltningsområde. Give each filter a name of its own.");
  });

  it.each([
    ["no prefix", ""],
    ["a prefix of only spaces", "   "],
    ["a prefix with a semicolon, which no tag can hold", "IT;stöd"],
  ])("refuses %s", async (_kind, prefix) => {
    const { settings } = await openSettings();
    add(settings);
    await choose(settings, "Type of filter 1", "Tags with a prefix");
    type(settings, "Name of filter 1", "IT-stöd");

    type(settings, "Tag prefix of filter 1", prefix);

    expect(canSave(settings)).toBe(false);
    expect(problemOf(settings)).toBe("Give filter 1 a tag prefix, without a semicolon.");
  });

  it("refuses a filled in or empty without words for its answers", async () => {
    const { settings } = await openSettings();
    add(settings);
    await choose(settings, "Type of filter 1", "Filled in or empty");
    type(settings, "Name of filter 1", "Väntar på");
    await choose(settings, "Field of filter 1", "Väntar på");
    expect(canSave(settings)).toBe(true);

    type(settings, "Text for empty, filter 1", " ");

    expect(canSave(settings)).toBe(false);
    expect(problemOf(settings)).toBe("Give filter 1 a text for both filled in and empty.");
  });

  it("asks for a new field when the saved one is gone, and removing the filter also lets it save", async () => {
    const { platform, settings } = await openSettings(adminWorld([{ type: "startsWith", name: "Borttaget", referenceName: "Custom.Borttaget" }]));

    expect(dropdownOf(settings, "Field of filter 1")).toBeTruthy();
    expect(canSave(settings)).toBe(false);

    fireEvent.click(within(settings).getByRole("button", { name: "Remove filter Borttaget" }));

    expect(canSave(settings)).toBe(true);
    await save(settings);
    expect(await storedFilterFields(platform)).toEqual([]);
  });

  it("asks for a new field when the object type is changed to one without it", async () => {
    const { settings } = await openSettings(adminWorld([{ type: "startsWith", name: "GKL", referenceName: GKL_FIELD }]));
    expect(canSave(settings)).toBe(true);

    await choose(settings, "Object work item type", "Issue");

    await waitFor(() => expect(dropdownOf(settings, "Phase field")).toBeTruthy());
    expect(within(settings).getByRole("region", { name: "Filters" }).textContent).toContain("Choose a field for filter 1.");
  });
});

describe("removing a filter field", () => {
  it("takes it away, moves the focus to the add button and says so", async () => {
    const { platform, settings } = await openSettings(
      adminWorld([
        { type: "startsWith", name: "GKL", referenceName: GKL_FIELD },
        { type: "choice", name: "Område", referenceName: OMRADE_FIELD },
      ]),
    );

    fireEvent.click(within(settings).getByRole("button", { name: "Remove filter GKL" }));

    expect(textOf(settings, "Name of filter 1").value).toBe("Område");
    expect(document.activeElement).toBe(within(settings).getByRole("button", { name: "Add filter" }));
    expect(within(settings).getByText("Filter GKL removed.")).toBeTruthy();
    await save(settings);
    expect(await storedFilterFields(platform)).toEqual([{ type: "choice", name: "Område", referenceName: OMRADE_FIELD }]);
  });
});

describe("what is saved stays as it was", () => {
  const ALL: FilterField[] = [
    { type: "choice", name: "Område", referenceName: OMRADE_FIELD },
    { type: "tagPrefix", name: "IT-stöd", prefix: "IT-stöd: ", excludedTags: ["IT-stöd: Dokportalen"] },
    { type: "startsWith", name: "GKL", referenceName: GKL_FIELD },
    { type: "filled", name: "Väntar på", referenceName: VANTAR_FIELD, filledText: "Waiting", emptyText: "Not waiting" },
  ];

  it("through opening and saving the panel without changing anything", async () => {
    const { platform, settings } = await openSettings(adminWorld(ALL));
    await within(settings).findByRole("checkbox", { name: "Offer Ärendesystemet" });
    await expectNoAccessibilityViolations(settings);

    await save(settings);

    expect(await storedFilterFields(platform)).toEqual(ALL);
  });

  it("when settings saved before filter fields existed leave them out", async () => {
    const { platform, settings } = await openSettings(adminWorld(undefined, { savedSettings: { [PROJECT]: savedSettings() } }));

    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([]);
  });
});

describe("unticking tags", () => {
  const TAGS: FilterField = { type: "tagPrefix", name: "IT-stöd", prefix: "IT-stöd: ", excludedTags: [] };

  it("lists the project's tags with the prefix without it, in name order, and those unticked are saved whole and left out of the row", async () => {
    const { platform, settings } = await openSettings(adminWorld([TAGS]));
    await within(settings).findByRole("checkbox", { name: "Offer Dokportalen" });
    expect(tagBoxes(settings).map((box) => box.getAttribute("aria-label") ?? box.textContent)).toEqual(["Offer Dokportalen", "Offer Ärendesystemet"]);

    fireEvent.click(within(settings).getByRole("checkbox", { name: "Offer Dokportalen" }));
    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([{ ...TAGS, excludedTags: ["IT-stöd: Dokportalen"] }]);
    fireEvent.click(await screen.findByRole("button", { name: /^Filter/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^IT-stöd/ }));
    expect(screen.getAllByRole("option").map(({ textContent }) => textContent)).toEqual(["Ärendesystemet"]);
  });

  it("can be undone", async () => {
    const { platform, settings } = await openSettings(adminWorld([{ ...TAGS, excludedTags: ["IT-stöd: Dokportalen"] }]));
    const box = await within(settings).findByRole("checkbox", { name: "Offer Dokportalen" });
    expect(box.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(box);
    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([TAGS]);
  });

  it("lets a new tag in without any setting, ticked", async () => {
    const { settings } = await openSettings(adminWorld([{ ...TAGS, excludedTags: ["IT-stöd: Dokportalen"] }], { projectTags: ["IT-stöd: Dokportalen", "IT-stöd: Ny"] }));

    const box = await within(settings).findByRole("checkbox", { name: "Offer Ny" });

    expect(box.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps an unticked tag that is gone, so that it stays unticked if it comes back", async () => {
    const stays: FilterField = { ...TAGS, excludedTags: ["IT-stöd: Tillfälligt borta"] };
    const { platform, settings } = await openSettings(adminWorld([stays]));
    await within(settings).findByRole("checkbox", { name: "Offer Dokportalen" });

    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([stays]);
  });

  it("keeps the unticked tags through a saved change of prefix, so that they are unticked again when it changes back", async () => {
    const { platform, settings } = await openSettings(adminWorld([{ ...TAGS, excludedTags: ["IT-stöd: Dokportalen"] }]));
    await within(settings).findByRole("checkbox", { name: "Offer Dokportalen" });

    type(settings, "Tag prefix of filter 1", "Internt");
    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([{ ...TAGS, prefix: "Internt", excludedTags: ["IT-stöd: Dokportalen"] }]);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const reopened = await screen.findByRole("main", { name: "Waypoint settings" });
    await within(reopened).findByRole("button", { name: "Save" });
    type(reopened, "Tag prefix of filter 1", "IT-stöd: ");

    expect((await within(reopened).findByRole("checkbox", { name: "Offer Dokportalen" })).getAttribute("aria-checked")).toBe("false");
    expect(within(reopened).getByRole("checkbox", { name: "Offer Ärendesystemet" }).getAttribute("aria-checked")).toBe("true");
  });

  it("says so when no tag has the prefix", async () => {
    const { settings } = await openSettings(adminWorld([{ ...TAGS, prefix: "Saknas: " }]));

    expect(await within(settings).findByText("The project has no tags that begin with this prefix.")).toBeTruthy();
  });

  it("reads the tags only once a filter needs them, and only once", async () => {
    const platform = createFakePlatform(adminWorld());
    const read = vi.spyOn(platform, "getProjectTags");
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("main", { name: "Waypoint settings" });
    await within(settings).findByRole("button", { name: "Save" });
    expect(read).not.toHaveBeenCalled();

    add(settings);
    await choose(settings, "Type of filter 1", "Tags with a prefix");
    add(settings);
    await choose(settings, "Type of filter 2", "Tags with a prefix");
    await act(async () => undefined);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("says so when the tags cannot be read, keeps what is unticked, and can try again", async () => {
    const stays: FilterField = { ...TAGS, excludedTags: ["IT-stöd: Dokportalen"] };
    const platform = createFakePlatform(adminWorld([stays]));
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });
    vi.spyOn(platform, "getProjectTags").mockRejectedValueOnce(new Error("TF400813: Not authorized."));
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("main", { name: "Waypoint settings" });

    const failure = await within(settings).findByText(/could not read the tags/);
    expect(failure.textContent).toContain("TF400813");
    expect(failure.textContent).toContain("Saving keeps the tags that are unticked now.");

    fireEvent.click(within(settings).getByRole("button", { name: "Try again" }));

    expect(await within(settings).findByRole("checkbox", { name: "Offer Dokportalen" })).toBeTruthy();
    expect(within(settings).queryByText(/could not read the tags/)).toBeNull();
  });

  it("can save although the tags cannot be read, with what is unticked kept", async () => {
    const stays: FilterField = { ...TAGS, excludedTags: ["IT-stöd: Dokportalen"] };
    const platform = createFakePlatform(adminWorld([stays]));
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });
    vi.spyOn(platform, "getProjectTags").mockRejectedValueOnce(new Error("TF400813: Not authorized."));
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("main", { name: "Waypoint settings" });
    await within(settings).findByText(/could not read the tags/);

    await save(settings);

    expect(await storedFilterFields(platform)).toEqual([stays]);
  });

  it("renders tags from the organization as text, never as HTML", async () => {
    const injected = `<img src=x onerror="window.__hacked=1"><b>tagg</b>`;
    const { settings } = await openSettings(adminWorld([TAGS], { projectTags: [`IT-stöd: ${injected}`] }));

    expect(await within(settings).findByRole("checkbox", { name: `Offer ${injected}` })).toBeTruthy();
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("damaged filter fields in the stored document", () => {
  it.each([
    ["not a list", { a: 1 }],
    ["an entry that is no filter field", ["x"]],
    ["an unknown type", [{ type: "regex", name: "X", referenceName: "F" }]],
    ["no name", [{ type: "choice", referenceName: "F" }]],
    ["a name with spaces around it", [{ type: "choice", name: " X ", referenceName: "F" }]],
    ["no field", [{ type: "startsWith", name: "X" }]],
    ["two with one name", [{ type: "choice", name: "X", referenceName: "F" }, { type: "startsWith", name: "X", referenceName: "G" }]],
    ["a blank prefix", [{ type: "tagPrefix", name: "X", prefix: "  ", excludedTags: [] }]],
    ["a prefix with a semicolon", [{ type: "tagPrefix", name: "X", prefix: "a;b", excludedTags: [] }]],
    ["unticked tags that are no list", [{ type: "tagPrefix", name: "X", prefix: "a", excludedTags: "b" }]],
    ["a tag unticked twice", [{ type: "tagPrefix", name: "X", prefix: "a", excludedTags: ["ab", "ab"] }]],
    ["no text for an answer", [{ type: "filled", name: "X", referenceName: "F", filledText: "Ja" }]],
    ["something unknown in one", [{ type: "choice", name: "X", referenceName: "F", extra: 1 }]],
  ])("show a visible error, with %s", async (_kind, filterFields) => {
    renderHub(createFakePlatform(adminWorld(undefined, { savedSettings: { [PROJECT]: savedSettings({ filterFields }) } })));

    expect((await screen.findByText(/could not load the board/)).textContent).toContain("not valid");
  });
});
