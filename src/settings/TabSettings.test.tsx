import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFakePlatform, type FakePlatform, type FakeWorld } from "../platform/fakePlatform";
import { expectNoAccessibilityViolations, renderHub } from "../testing/hubRig";
import { OUR_TABS, PHASES, lifecycleWorld, process, robot, savedSettings } from "../testing/lifecycleWorld";

const PROJECT = "this-project";
const bodil = robot(1, "PROCESS_101.Bodil");

function adminWorld(rest: FakeWorld = {}): FakeWorld {
  return lifecycleWorld([bodil, process(11, "Körs", "I produktion", 1)], { projectId: PROJECT, isAdministrator: true, ...rest });
}

async function openSettings(world: FakeWorld = adminWorld()): Promise<{ platform: FakePlatform; settings: HTMLElement }> {
  const platform = createFakePlatform(world);
  renderHub(platform);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  const settings = await screen.findByRole("main", { name: "Waypoint settings" });
  await within(settings).findByRole("button", { name: "Save" });
  return { platform, settings };
}

const saved = (tabs: unknown, phaseOrder: string[] = PHASES) => ({ savedSettings: { [PROJECT]: savedSettings({ tabs, phaseOrder }) } });

async function storedTabs(platform: FakePlatform): Promise<unknown> {
  const stored = await platform.getSettingsDocument(PROJECT);
  return (stored?.content as { settings: { tabs: unknown } }).settings.tabs;
}

const tabNameFields = (settings: HTMLElement) => within(settings).getAllByRole<HTMLInputElement>("textbox", { name: /^Name of tab / });
const tabNames = (settings: HTMLElement) => tabNameFields(settings).map((field) => field.value);

const addTab = (settings: HTMLElement, name: string) => {
  fireEvent.click(within(settings).getByRole("button", { name: "Add tab" }));
  fireEvent.change(tabNameFields(settings).pop() as HTMLElement, { target: { value: name } });
};

const placementDropdown = (settings: HTMLElement, phase: string) => within(settings).getByRole<HTMLInputElement>("button", { name: `Tab for ${phase}` });

const place = async (settings: HTMLElement, phase: string, tab: string) => {
  fireEvent.click(placementDropdown(settings, phase));
  fireEvent.click(await screen.findByRole("option", { name: tab }));
};

const setDivider = (settings: HTMLElement, phase: string, text: string) =>
  fireEvent.change(within(settings).getByRole("textbox", { name: `Divider before ${phase}` }), { target: { value: text } });

const save = async (settings: HTMLElement) => {
  fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
};

const saveButton = (settings: HTMLElement) => within(settings).getByRole("button", { name: "Save" });

describe("setting up tabs", () => {
  it("starts from one tab with all phases", async () => {
    const { platform, settings } = await openSettings();

    expect(tabNames(settings)).toEqual(["All phases"]);
    expect(PHASES.map((phase) => placementDropdown(settings, phase).value)).toEqual(PHASES.map(() => "All phases"));
    await expectNoAccessibilityViolations(settings);

    await save(settings);

    expect(await storedTabs(platform)).toEqual([{ name: "All phases", phases: PHASES.map((name) => ({ name })) }]);
  });

  it("lets the administrator divide the phases into named tabs with a divider, and the hub follows", async () => {
    const { platform, settings } = await openSettings();

    fireEvent.change(tabNameFields(settings)[0], { target: { value: "Före produktion" } });
    addTab(settings, "Drift");
    addTab(settings, "Avslut");
    for (const phase of ["I produktion", "Pausad"]) await place(settings, phase, "Drift");
    for (const phase of ["Under avveckling", "Avvecklad", "Avfärdad"]) await place(settings, phase, "Avslut");
    setDivider(settings, "Avfärdad", "Blev aldrig av");
    await expectNoAccessibilityViolations(settings);

    await save(settings);

    expect(await storedTabs(platform)).toEqual(OUR_TABS);
    const stored = await platform.getSettingsDocument(PROJECT);
    expect((stored?.content as { log: unknown[] }).log).toHaveLength(1);

    await screen.findByRole("tab", { name: "Före produktion" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Före produktion", "Drift", "Avslut"]);
    fireEvent.click(screen.getByRole("tab", { name: "Avslut" }));
    expect(screen.getByRole("separator", { name: "Blev aldrig av" })).toBeTruthy();
  });

  it("shows what is saved when opened again", async () => {
    const { settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    expect(tabNames(settings)).toEqual(["Före produktion", "Drift", "Avslut"]);
    expect(placementDropdown(settings, "Pausad").value).toBe("Drift");
    expect(within(settings).getByRole<HTMLInputElement>("textbox", { name: "Divider before Avfärdad" }).value).toBe("Blev aldrig av");
    expect(within(settings).getByRole<HTMLInputElement>("textbox", { name: "Divider before Pausad" }).value).toBe("");
  });

  it("saves the phases of a tab in the phase order, also after they have been moved", async () => {
    const { platform, settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    fireEvent.click(within(settings).getByRole("button", { name: "Move Pausad up" }));
    await save(settings);

    expect(await storedTabs(platform)).toEqual([OUR_TABS[0], { name: "Drift", phases: [{ name: "Pausad" }, { name: "I produktion" }] }, OUR_TABS[2]]);
  });

  it("does not store spaces around names and texts, or a divider with no text", async () => {
    const { platform, settings } = await openSettings();

    fireEvent.change(tabNameFields(settings)[0], { target: { value: "  Allt " } });
    setDivider(settings, "Pausad", " Paus ");
    setDivider(settings, "Idéfas", "   ");
    await save(settings);

    const [tab] = (await storedTabs(platform)) as { name: string; phases: unknown[] }[];
    expect(tab.name).toBe("Allt");
    expect(tab.phases).toContainEqual({ name: "Pausad", dividerBefore: "Paus" });
    expect(tab.phases).toContainEqual({ name: "Idéfas" });
  });

  it("lets a tab be renamed everywhere it is shown", async () => {
    const { settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    fireEvent.change(tabNameFields(settings)[1], { target: { value: "I drift" } });

    await waitFor(() => expect(placementDropdown(settings, "Pausad").value).toBe("I drift"));
  });

  it("sets no limit on the length of a tab name or a divider", async () => {
    const { settings } = await openSettings();

    const fields = [tabNameFields(settings)[0], within(settings).getByRole<HTMLInputElement>("textbox", { name: "Divider before Pausad" })];

    expect(fields.map((field) => field.maxLength)).toEqual([-1, -1]);
  });

  it("puts the name field of a new tab under the keyboard", async () => {
    const { settings } = await openSettings();

    fireEvent.click(within(settings).getByRole("button", { name: "Add tab" }));

    expect(document.activeElement).toBe(tabNameFields(settings)[1]);
  });
});

describe("the order of the tabs", () => {
  it("can be changed, and decides which tab the hub opens on", async () => {
    const { platform, settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    fireEvent.click(within(settings).getByRole("button", { name: "Move tab Drift up" }));

    expect(tabNames(settings)).toEqual(["Drift", "Före produktion", "Avslut"]);
    expect(within(settings).getByText("Tab Drift moved to position 1 of 3.")).toBeTruthy();

    await save(settings);

    expect(((await storedTabs(platform)) as { name: string }[]).map(({ name }) => name)).toEqual(["Drift", "Före produktion", "Avslut"]);

    const stored = await platform.getSettingsDocument(PROJECT);
    cleanup();
    renderHub(createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: stored?.content } })));

    await waitFor(() => expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Drift"));
  });

  it("offers no move past either end", async () => {
    const { settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    expect(within(settings).getByRole("button", { name: "Move tab Före produktion up" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(settings).getByRole("button", { name: "Move tab Avslut down" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("removing a tab", () => {
  it("moves its phases to the tab before it", async () => {
    const { platform, settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    fireEvent.click(within(settings).getByRole("button", { name: "Remove tab Drift" }));

    expect(tabNames(settings)).toEqual(["Före produktion", "Avslut"]);
    expect(placementDropdown(settings, "Pausad").value).toBe("Före produktion");
    expect(within(settings).getByText("Tab Drift removed. Its phases moved to tab Före produktion.")).toBeTruthy();
    expect(document.activeElement).toBe(within(settings).getByRole("button", { name: "Add tab" }));

    await save(settings);

    const [first] = (await storedTabs(platform)) as { phases: { name: string }[] }[];
    expect(first.phases.map(({ name }) => name)).toEqual(PHASES.slice(0, 6));
  });

  it("moves the first tab's phases to the tab after it, dividers and all", async () => {
    const tabs = [{ name: "Först", phases: [{ name: "Idéfas", dividerBefore: "Början" }] }, { name: "Resten", phases: PHASES.slice(1).map((name) => ({ name })) }];
    const { platform, settings } = await openSettings(adminWorld(saved(tabs)));

    fireEvent.click(within(settings).getByRole("button", { name: "Remove tab Först" }));
    await save(settings);

    expect(await storedTabs(platform)).toEqual([{ name: "Resten", phases: [{ name: "Idéfas", dividerBefore: "Början" }, ...PHASES.slice(1).map((name) => ({ name }))] }]);
  });

  it("is not offered for the only tab", async () => {
    const { settings } = await openSettings();

    expect(within(settings).getByRole("button", { name: "Remove tab All phases" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("tabs that cannot be saved", () => {
  const expectRefused = (settings: HTMLElement, reason: RegExp) => {
    expect(within(settings).getByText(reason)).toBeTruthy();
    expect(saveButton(settings).getAttribute("aria-disabled")).toBe("true");
  };

  it("a tab with no name", async () => {
    const { settings } = await openSettings();

    fireEvent.change(tabNameFields(settings)[0], { target: { value: "   " } });

    expectRefused(settings, /Give every tab a name/);
  });

  it("two tabs with the same name, spaces aside", async () => {
    const { settings } = await openSettings(adminWorld(saved(OUR_TABS)));

    fireEvent.change(tabNameFields(settings)[1], { target: { value: " Avslut " } });

    expectRefused(settings, /Two tabs are named Avslut/);
  });

  it("a tab with no phases, until it gets one", async () => {
    const { settings } = await openSettings();

    addTab(settings, "Tom");

    expectRefused(settings, /The tab Tom has no phases/);

    await place(settings, "Pausad", "Tom");

    expect(saveButton(settings).getAttribute("aria-disabled")).not.toBe("true");
    expect(within(settings).queryByText(/has no phases/)).toBeNull();
  });
});

describe("tabs and what the picklist has today", () => {
  it("put a value the picklist has gained on the last tab, and drop one it has lost", async () => {
    const tabs = [OUR_TABS[0], { name: "Avslut", phases: [{ name: "Borttagen", dividerBefore: "Gammal" }, ...OUR_TABS[2].phases] }];
    const phaseOrder = ["Borttagen", ...PHASES.filter((phase) => phase !== "I produktion" && phase !== "Pausad")];
    const { platform, settings } = await openSettings(adminWorld(saved(tabs, phaseOrder)));

    expect(placementDropdown(settings, "I produktion").value).toBe("Avslut");
    expect(within(settings).queryByRole("button", { name: "Tab for Borttagen" })).toBeNull();

    await save(settings);

    const stored = (await storedTabs(platform)) as { phases: { name: string }[] }[];
    expect(stored[1].phases.map(({ name }) => name)).toEqual(["Under avveckling", "Avvecklad", "Avfärdad", "I produktion", "Pausad"]);
  });

  it("start over from one tab when another phase field is chosen, and come back with the saved one", async () => {
    const annat = { referenceName: "Custom.Annat", name: "Annat", values: ["A", "B"] };
    const livscykel = { referenceName: "Custom.Livscykel", name: "Livscykel", values: PHASES };
    const { settings } = await openSettings(adminWorld({ ...saved(OUR_TABS), picklistFields: { Feature: [livscykel, annat] } }));

    fireEvent.click(within(settings).getByRole("button", { name: "Phase field" }));
    fireEvent.click(await screen.findByRole("option", { name: "Annat" }));

    expect(tabNames(settings)).toEqual(["All phases"]);
    expect(placementDropdown(settings, "A").value).toBe("All phases");

    fireEvent.click(within(settings).getByRole("button", { name: "Phase field" }));
    fireEvent.click(await screen.findByRole("option", { name: "Livscykel" }));

    expect(tabNames(settings)).toEqual(["Före produktion", "Drift", "Avslut"]);
  });

  it("are not offered when there are no phases to divide", async () => {
    const { settings } = await openSettings(adminWorld({ picklistFields: { Feature: [{ referenceName: "Custom.Tom", name: "Tom", values: [] }] } }));

    expect(within(settings).queryByRole("button", { name: "Add tab" })).toBeNull();
    expect(saveButton(settings).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("keep the chosen tab after a save, and go to the first in the URL too if it is renamed", async () => {
    const { platform, settings } = await openSettings(adminWorld({ ...saved(OUR_TABS), queryParams: { tab: "Drift" } }));

    await save(settings);
    await waitFor(() => expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Drift"));

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const reopened = await screen.findByRole("main", { name: "Waypoint settings" });
    await within(reopened).findByRole("button", { name: "Save" });
    fireEvent.change(tabNameFields(reopened)[1], { target: { value: "I drift" } });
    await save(reopened);

    await waitFor(() => expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Före produktion"));
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion" }));
  });
});

describe("names from the organization in the tab settings", () => {
  it("are rendered as text, never as HTML", async () => {
    const injected = (name: string) => `<img src=x onerror="window.__hacked='${name}'"><b>${name}</b>`;
    const { settings } = await openSettings(
      adminWorld(saved([{ name: injected("tab"), phases: PHASES.map((name, index) => (index === 0 ? { name, dividerBefore: injected("divider") } : { name })) }])),
    );

    expect(tabNames(settings)).toEqual([injected("tab")]);
    expect(placementDropdown(settings, "Idéfas").value).toBe(injected("tab"));
    expect(document.querySelector("img, b")).toBeNull();
  });
});
