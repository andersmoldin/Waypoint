import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePlatform, type FakePlatform, type FakeWorld } from "../platform/fakePlatform";
import { expectNoAccessibilityViolations, renderHub } from "../testing/hubRig";
import {
  AKTUELLT_LAGE,
  ASSIGNED_TO,
  CREATED_DATE,
  FORBATTRING_PAGAR,
  GKL,
  OUR_ROLES,
  PHASES,
  PHASE_FIELD,
  VANTAR_PA,
  lifecycleWorld,
  process,
  robot,
  savedSettings,
} from "../testing/lifecycleWorld";

const PROJECT = "this-project";
const bodil = robot(1, "PROCESS_101.Bodil");

/** A project shaped like ours, opened by a Project Administrator. */
function adminWorld(rest: FakeWorld = {}): FakeWorld {
  return lifecycleWorld([bodil], { projectId: PROJECT, isAdministrator: true, ...rest });
}

const panel = () => screen.findByRole("main", { name: "Waypoint settings" });

async function openSettings(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  return panel();
}

async function storedContent(platform: FakePlatform, project = PROJECT): Promise<Record<string, unknown>> {
  return (await platform.getSettingsDocument(project))?.content as Record<string, unknown>;
}

describe("the gear", () => {
  it("is there for a Project Administrator and opens the settings in a panel", async () => {
    renderHub(createFakePlatform(adminWorld()));

    const opened = await openSettings();

    expect(opened).toBeTruthy();
  });

  it("is not there for anyone else", async () => {
    renderHub(createFakePlatform(adminWorld({ isAdministrator: false })));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("is not offered when it cannot be told who administers the project, and the board still shows", async () => {
    renderHub(
      createFakePlatform(adminWorld({ failures: { isProjectAdministrator: new Error("TF400813: Not authorized.") } })),
    );

    await screen.findByRole("region", { name: "Board" });
    const warning = await screen.findByText(/could not check/);
    expect(warning.textContent).toContain("TF400813");
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("says so visibly when the panel cannot be opened", async () => {
    renderHub(createFakePlatform(adminWorld({ failures: { openSettingsPanel: new Error("The host refused.") } })));

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect((await screen.findByText(/could not open its settings/)).textContent).toContain("The host refused.");
    await screen.findByRole("region", { name: "Board" });
  });
});

describe("a panel that may not start", () => {
  it("says so in the hub when the panel's page never comes up, and the board still shows", async () => {
    renderHub(createFakePlatform(adminWorld({ settingsPanelStart: "never" })));

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect((await screen.findByText(/could not open its settings/)).textContent).toContain("did not start");
    await screen.findByRole("region", { name: "Board" });
    expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull();
  });

  it("takes that back when a panel that was only slow starts after all", async () => {
    const platform = createFakePlatform(adminWorld({ settingsPanelStart: "late" }));
    renderHub(platform);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByText(/could not open its settings/);

    act(() => platform.letSettingsPanelStart());

    await panel();
    await waitFor(() => expect(screen.queryByText(/could not open its settings/)).toBeNull());
  });

  it("tells the hub that its page runs as soon as it shows", async () => {
    const platform = createFakePlatform(adminWorld());
    renderHub(platform);

    await openSettings();

    expect(platform.settingsPanelHasStarted()).toBe(true);
  });

  describe("and breaks while it renders", () => {
    /** Azure DevOps never answers like this, which is what makes it a way to make the form throw. */
    const breakingWorld = () => adminWorld({ picklistFields: { Feature: [{ referenceName: PHASE_FIELD, name: "Phase", values: null as never }] } });

    beforeEach(() => {
      // React reports what a boundary catches on the console.
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it("shows the error and a way out instead of an empty surface", async () => {
      const platform = createFakePlatform(breakingWorld());
      renderHub(platform);

      const opened = await openSettings();

      await within(opened).findByText(/stopped working: .+/);
      expect(platform.settingsPanelHasStarted()).toBe(true);

      fireEvent.click(within(opened).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    });
  });
});

describe("the box shown before anything is set up", () => {
  it("leads a Project Administrator to the settings", async () => {
    renderHub(createFakePlatform(adminWorld()));

    await screen.findByText(/isn't set up/);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));

    expect(await panel()).toBeTruthy();
  });

  it("tells anyone else who can change it, without a way in", async () => {
    renderHub(createFakePlatform(adminWorld({ isAdministrator: false })));

    expect((await screen.findByText(/isn't set up/)).textContent).toContain("A Project Administrator");
    expect(screen.queryByRole("button", { name: "Open settings" })).toBeNull();
  });
});

describe("choosing what the board shows", () => {
  const annat = { referenceName: "Custom.Annat", name: "Annat", values: ["A", "B"] };
  const storyFas = { referenceName: "Custom.StoryFas", name: "Storyfas", values: ["Tidig", "Sen"] };

  const manyTypes = (rest: FakeWorld = {}) =>
    adminWorld({
      workItemTypes: ["User Story", "Theme", "Epic", "Feature"],
      picklistFields: {
        Feature: [
          { referenceName: PHASE_FIELD, name: "Livscykel", values: PHASES },
          annat,
        ],
        "User Story": [storyFas],
      },
      ...rest,
    });

  it("starts from the hub's guess, and saving it makes it the project's settings", async () => {
    const platform = createFakePlatform(manyTypes());
    renderHub(platform);
    const settings = await openSettings();

    await formLoaded(settings);
    expect(chosen(settings, "Object work item type")).toBe("Feature");
    expect(chosen(settings, "Group work item type")).toBe("Epic");
    expect(chosen(settings, "Phase field")).toBe("Livscykel");
    const description = document.getElementById(dropdown(settings, "Phase field").getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("Livscykel");
    await expectNoAccessibilityViolations(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    expect(await storedContent(platform)).toMatchObject({
      version: 1,
      settings: { objectType: "Feature", groupType: "Epic", phaseField: PHASE_FIELD, phaseOrder: PHASES },
    });
    await waitFor(() => expect(screen.queryByText(/isn't set up/)).toBeNull());
    await screen.findByRole("region", { name: "Board" });
  });

  it("lets the administrator choose the types and the phase field among the picklist fields on the object's type", async () => {
    const platform = createFakePlatform(manyTypes());
    renderHub(platform);
    const settings = await openSettings();

    await choose(settings, "Object work item type", "User Story");
    await waitFor(() => expect(chosen(settings, "Phase field")).toBe("Storyfas"));
    await choose(settings, "Group work item type", "Theme");
    expect(phaseNames(settings)).toEqual(["Tidig", "Sen"]);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(async () =>
      expect(await storedContent(platform)).toMatchObject({
        settings: { objectType: "User Story", groupType: "Theme", phaseField: "Custom.StoryFas", phaseOrder: ["Tidig", "Sen"] },
      }),
    );
  });

  it("does not let the administrator save without a phase field, and says why", async () => {
    renderHub(createFakePlatform(manyTypes({ picklistFields: {} })));
    const settings = await openSettings();

    expect((await within(settings).findByText(/has no picklist field/)).textContent).toContain("Feature");
    expect(within(settings).getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("asks for a new choice when the saved type or field is gone", async () => {
    const saved = savedSettings({ objectType: "Borta" });
    renderHub(createFakePlatform(manyTypes({ savedSettings: { [PROJECT]: saved } })));
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    await formLoaded(settings);
    expect(chosen(settings, "Object work item type")).toBe("Choose…");
    expect(within(settings).getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves the other projects in the organization alone", async () => {
    const other = savedSettings({ objectType: "Theme" });
    const platform = createFakePlatform(manyTypes({ savedSettings: { "other-project": other } }));
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(async () => expect(await storedContent(platform)).toBeTruthy());
    expect(await storedContent(platform, "other-project")).toEqual(other);
  });

  it("closes without saving when cancelled", async () => {
    const platform = createFakePlatform(manyTypes());
    renderHub(platform);
    const settings = await openSettings();

    fireEvent.click(await within(settings).findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    expect(await platform.getSettingsDocument(PROJECT)).toBeNull();
  });

  it("renders names from the organization as text, never as HTML", async () => {
    const injected = (name: string) => `<img src=x onerror="window.__hacked='${name}'"><b>${name}</b>`;
    renderHub(
      createFakePlatform(
        manyTypes({
          workItemTypes: ["Feature", "Epic"],
          picklistFields: { Feature: [{ referenceName: PHASE_FIELD, name: injected("field"), values: [injected("phase")] }] },
          savedSettings: {
            [PROJECT]: { ...savedSettings({ phaseOrder: [injected("phase")] }), log: [{ at: Date.parse("2026-11-05T10:00:00Z"), userId: "u", userName: injected("user") }] },
          },
        }),
      ),
    );
    const settings = await openSettings();

    await formLoaded(settings);
    expect(chosen(settings, "Phase field")).toBe(injected("field"));
    for (const name of ["phase", "user"]) expect(settings.textContent).toContain(injected(name));
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("a dropdown's filter box", () => {
  /** Inside a form item, the box is named by the item's label. */
  const filterBox = (label: string) => screen.queryByRole("textbox", { name: label });

  const openedWithTypes = async (count: number) => {
    const workItemTypes = Array.from({ length: count }, (_, index) => `Type ${index + 1}`);
    renderHub(createFakePlatform(adminWorld({ workItemTypes })));
    const settings = await openSettings();
    await formLoaded(settings);
    return settings;
  };

  it.each(["Object work item type", "Group work item type"])("is there in %s with more than ten options", async (label) => {
    const settings = await openedWithTypes(11);

    fireEvent.click(dropdown(settings, label));

    await screen.findByRole("option", { name: "Type 1" });
    expect(filterBox(label)).toBeTruthy();
  });

  it("is not there with ten options", async () => {
    const settings = await openedWithTypes(10);

    fireEvent.click(dropdown(settings, "Object work item type"));

    await screen.findByRole("option", { name: "Type 1" });
    expect(filterBox("Object work item type")).toBeNull();
  });

  it("is there for a card's fields however few they are", async () => {
    const settings = await openedWithTypes(2);

    fireEvent.click(dropdown(settings, "Current situation"));

    await screen.findByRole("option", { name: "None" });
    expect(filterBox("Current situation")).toBeTruthy();
  });
});

describe("the change log", () => {
  it("gets an entry saying who saved and when, for every save, and shows them newest first", async () => {
    const platform = createFakePlatform(adminWorld({ workItemTypes: ["Feature", "Epic"], user: { id: "ada", displayName: "Ada Admin" } }));
    renderHub(platform);
    const before = Date.now();

    for (let save = 0; save < 2; save++) {
      const settings = await openSettings();
      await formLoaded(settings);
      fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    }

    const { log } = await storedContent(platform);
    expect(log).toEqual([
      { at: expect.any(Number), userId: "ada", userName: "Ada Admin" },
      { at: expect.any(Number), userId: "ada", userName: "Ada Admin" },
    ]);
    const [first] = log as { at: number }[];
    expect(first.at).toBeGreaterThanOrEqual(before);
    expect(first.at).toBeLessThanOrEqual(Date.now());

    const settings = await openSettings();
    const shown = within(await within(settings).findByRole("list", { name: "Change log" })).getAllByRole("listitem");
    expect(shown).toHaveLength(2);
    expect(shown[0].textContent).toContain("Ada Admin");
    expect(shown[0].querySelector("time")?.getAttribute("datetime")).toBe(new Date((log as { at: number }[])[1].at).toISOString());
  });

  it("does not grow without end", async () => {
    const log = Array.from({ length: 500 }, (_, index) => ({ at: Date.parse("2026-01-01T00:00:00Z"), userId: `old-${index}`, userName: "Gammal" }));
    const platform = createFakePlatform(
      adminWorld({ workItemTypes: ["Feature", "Epic"], savedSettings: { [PROJECT]: { ...savedSettings(), log } } }),
    );
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());

    const stored = (await storedContent(platform)).log as { userId: string }[];
    expect(stored).toHaveLength(500);
    expect(stored[0].userId).toBe("old-1");
    expect(stored[499].userId).toBe("user-1");
  });

  it("logs nothing and saves nothing when someone else has saved in the meantime, and says so", async () => {
    const platform = createFakePlatform(adminWorld({ workItemTypes: ["Feature", "Epic"] }));
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);
    const theirs = savedSettings({ groupType: "Theirs" });
    await platform.saveSettingsDocument(PROJECT, theirs, null);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    expect((await within(settings).findByRole("alert")).textContent).toContain("could not save");
    expect(await storedContent(platform)).toEqual(theirs);
    expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeTruthy();
  });

  it("does not save when it cannot be told who is saving", async () => {
    const platform = createFakePlatform(
      adminWorld({ workItemTypes: ["Feature", "Epic"], failures: { getCurrentUser: new Error("Who?") } }),
    );
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    expect((await within(settings).findByRole("alert")).textContent).toContain("Who?");
    expect(await platform.getSettingsDocument(PROJECT)).toBeNull();
  });
});

describe("the phase order in the settings", () => {
  const savedOrder = (phaseOrder: string[]) => ({ [PROJECT]: savedSettings({ phaseOrder }) });
  const opened = async (world: FakeWorld) => {
    const platform = createFakePlatform(adminWorld({ workItemTypes: ["Feature", "Epic"], ...world }));
    renderHub(platform);
    const settings = await openSettings();
    await within(settings).findByRole("list", { name: "Phase order" });
    return { platform, settings };
  };

  it("starts from the picklist, can be moved with the buttons, and the board follows what is saved", async () => {
    const { platform, settings } = await opened({});
    expect(phaseNames(settings)).toEqual(PHASES);

    fireEvent.click(within(settings).getByRole("button", { name: "Move Pausad up" }));
    fireEvent.click(within(settings).getByRole("button", { name: "Move Idéfas down" }));

    const moved = ["Under utvärdering", "Idéfas", "Under planering", "Under utveckling", "Pausad", "I produktion", "Under avveckling", "Avvecklad", "Avfärdad"];
    expect(phaseNames(settings)).toEqual(moved);
    expect(within(within(settings).getByRole("region", { name: "Phase order" })).getByRole("status").textContent).toBe("Idéfas moved to position 2 of 9.");
    await expectNoAccessibilityViolations(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(async () => expect(await storedContent(platform)).toMatchObject({ settings: { phaseOrder: moved } }));
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)[0]).toBe("Under utvärdering 0 objects"));
  });

  it("can be dragged", async () => {
    const { settings } = await opened({});
    const row = (phase: string) => phaseRow(settings, phase);
    const dataTransfer = { setData: () => undefined, effectAllowed: "" };

    fireEvent.dragStart(row("Avfärdad"), { dataTransfer });
    fireEvent.dragOver(row("Idéfas"), { dataTransfer });
    fireEvent.drop(row("Idéfas"), { dataTransfer });

    expect(phaseNames(settings)).toEqual(["Avfärdad", ...PHASES.filter((phase) => phase !== "Avfärdad")]);
  });

  it.each([
    ["Phase field", "Livscykel"],
    ["Object work item type", "Feature"],
  ])("keeps an unsaved order when %s is given the value it already has", async (label, option) => {
    const { platform, settings } = await opened({});
    const row = (phase: string) => phaseRow(settings, phase);
    const dataTransfer = { setData: () => undefined, effectAllowed: "" };
    fireEvent.dragStart(row("Avfärdad"), { dataTransfer });
    fireEvent.drop(row("Idéfas"), { dataTransfer });
    const moved = ["Avfärdad", ...PHASES.filter((phase) => phase !== "Avfärdad")];

    await choose(settings, label, option);

    expect(chosen(settings, label)).toBe(option);
    expect(phaseNames(settings)).toEqual(moved);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    expect(await storedContent(platform)).toMatchObject({ settings: { phaseOrder: moved } });
  });

  it("offers no move past either end", async () => {
    const { settings } = await opened({});

    expect(within(settings).getByRole("button", { name: "Move Idéfas up" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(settings).getByRole("button", { name: "Move Avfärdad down" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the saved order when reopened", async () => {
    const order = [...PHASES].reverse();
    const { settings } = await opened({ savedSettings: savedOrder(order) });

    expect(phaseNames(settings)).toEqual(order);
  });

  it("shows a value the picklist has gained last, marked as new, until it is saved", async () => {
    const order = PHASES.filter((phase) => phase !== "Avfärdad");
    const { platform, settings } = await opened({ savedSettings: savedOrder(order) });

    expect(phaseNames(settings)).toEqual(PHASES);
    expect(within(phaseRow(settings, "Avfärdad")).getByText("New")).toBeTruthy();
    expect(within(phaseRow(settings, "Idéfas")).queryByText("New")).toBeNull();

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());

    expect(await storedContent(platform)).toMatchObject({ settings: { phaseOrder: PHASES } });
    await waitFor(() => expect(screen.queryByText(/\(new\)/)).toBeNull());
    await screen.findByRole("region", { name: "Board" });
  });

  it("drops a value the picklist has lost", async () => {
    const { platform, settings } = await opened({ savedSettings: savedOrder(["Borttagen", ...PHASES]) });

    expect(phaseNames(settings)).toEqual(PHASES);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());

    expect(await storedContent(platform)).toMatchObject({ settings: { phaseOrder: PHASES } });
  });
});

describe("a parent of the wrong type", () => {
  it("stops counting as a group once the group type is changed", async () => {
    const platform = createFakePlatform(
      lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)], {
        projectId: PROJECT,
        isAdministrator: true,
        workItemTypes: ["Feature", "Epic", "Theme"],
      }),
    );
    renderHub(platform);
    expect(await within(await screen.findByRole("region", { name: "Board" })).findByText("PROCESS_101.Bodil")).toBeTruthy();
    const settings = await openSettings();
    await formLoaded(settings);

    await choose(settings, "Group work item type", "Theme");
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("No group")).toBeTruthy();
    expect(screen.queryByText("PROCESS_101.Bodil")).toBeNull();
  });
});

describe("hiding groups", () => {
  const ovrigt = robot(2, "Övrigt");
  const tema = { id: 3, type: "Theme", fields: { "System.Title": "Ett tema" } };
  const world = (rest: FakeWorld = {}): FakeWorld =>
    lifecycleWorld([bodil, ovrigt, tema, process(11, "Synlig", "Idéfas", 1), process(12, "Mall", "Idéfas", 2)], {
      projectId: PROJECT,
      isAdministrator: true,
      workItemTypes: ["Feature", "Epic", "Theme"],
      ...rest,
    });

  const checkbox = (settings: HTMLElement, name: string) => within(settings).findByRole("checkbox", { name });
  const isHidden = async (settings: HTMLElement, name: string) => (await checkbox(settings, name)).getAttribute("aria-checked") === "true";
  const panelClosed = () => waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());

  it("is saved with its log entry, and takes the group and its objects off the board", async () => {
    const platform = createFakePlatform(world());
    renderHub(platform);
    await screen.findByText("Mall");
    const settings = await openSettings();

    expect(await isHidden(settings, "Övrigt (#2)")).toBe(false);
    await expectNoAccessibilityViolations(settings);
    fireEvent.click(await checkbox(settings, "Övrigt (#2)"));
    expect(await isHidden(settings, "Övrigt (#2)")).toBe(true);
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await panelClosed();

    expect(await storedContent(platform)).toMatchObject({
      settings: { hiddenGroups: [2] },
      log: [expect.objectContaining({ userId: "user-1" })],
    });
    await screen.findByText("Synlig");
    await waitFor(() => expect(screen.queryByText("Mall")).toBeNull());
    expect(within(screen.getByRole("list", { name: "Groups" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["PROCESS_101.Bodil"]);
  });

  it("offers a hidden group again, so that it can be brought back", async () => {
    const platform = createFakePlatform(world({ savedSettings: { [PROJECT]: savedSettings({ hiddenGroups: [2] }) } }));
    renderHub(platform);
    const settings = await openSettings();

    expect(await isHidden(settings, "Övrigt (#2)")).toBe(true);
    fireEvent.click(await checkbox(settings, "Övrigt (#2)"));
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await panelClosed();

    expect(await storedContent(platform)).toMatchObject({ settings: { hiddenGroups: [] } });
    expect(await screen.findByText("Mall")).toBeTruthy();
  });

  it("offers a hidden group in another project, so that it can be brought back", async () => {
    const moved = { ...robot(7, "Flyttad"), inAnotherProject: true };
    const platform = createFakePlatform(
      lifecycleWorld([bodil, moved, process(11, "Synlig", "Idéfas", 1), process(13, "Hos flyttad", "Idéfas", 7)], {
        projectId: PROJECT,
        isAdministrator: true,
        savedSettings: { [PROJECT]: savedSettings({ hiddenGroups: [7] }) },
      }),
    );
    renderHub(platform);
    await screen.findByText("Synlig");
    expect(screen.queryByText("Hos flyttad")).toBeNull();
    const settings = await openSettings();

    expect(await isHidden(settings, "Flyttad (#7)")).toBe(true);
    fireEvent.click(await checkbox(settings, "Flyttad (#7)"));
    expect(await isHidden(settings, "Flyttad (#7)")).toBe(false);
    fireEvent.click(await checkbox(settings, "Flyttad (#7)"));
    expect(await isHidden(settings, "Flyttad (#7)")).toBe(true);
    fireEvent.click(await checkbox(settings, "Flyttad (#7)"));
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await panelClosed();

    expect(await storedContent(platform)).toMatchObject({ settings: { hiddenGroups: [] } });
    expect(await screen.findByText("Hos flyttad")).toBeTruthy();
  });

  it("does not offer a hidden id that cannot be read or is of another type, and keeps it when saving", async () => {
    const hiddenGroups = [3, 11, 404, 2];
    const platform = createFakePlatform(world({ savedSettings: { [PROJECT]: savedSettings({ hiddenGroups }) } }));
    renderHub(platform);
    const settings = await openSettings();

    await checkbox(settings, "Övrigt (#2)");
    expect(within(settings).getAllByRole("checkbox").map((box) => box.getAttribute("aria-label") ?? box.textContent)).toEqual([
      "PROCESS_101.Bodil (#1)",
      "Övrigt (#2)",
    ]);
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await panelClosed();

    expect(await storedContent(platform)).toMatchObject({ settings: { hiddenGroups } });
  });

  it("offers the groups of the chosen group type, and remembers what was hidden if the type is chosen again", async () => {
    renderHub(createFakePlatform(world({ savedSettings: { [PROJECT]: savedSettings({ hiddenGroups: [2] }) } })));
    const settings = await openSettings();
    await checkbox(settings, "Övrigt (#2)");

    await choose(settings, "Group work item type", "Theme");
    await checkbox(settings, "Ett tema (#3)");
    expect(within(settings).queryByRole("checkbox", { name: "Övrigt (#2)" })).toBeNull();

    await choose(settings, "Group work item type", "Epic");
    expect(await isHidden(settings, "Övrigt (#2)")).toBe(true);
  });

  it("tells groups with the same name apart, and goes by the one that was chosen", async () => {
    const platform = createFakePlatform(
      lifecycleWorld([robot(1, "Robot"), robot(2, "Robot"), process(11, "Hos ettan", "Idéfas", 1), process(12, "Hos tvåan", "Idéfas", 2)], {
        projectId: PROJECT,
        isAdministrator: true,
      }),
    );
    renderHub(platform);
    const settings = await openSettings();

    fireEvent.click(await checkbox(settings, "Robot (#2)"));
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await panelClosed();

    expect(await screen.findByText("Hos ettan")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Hos tvåan")).toBeNull());
  });

  it("says so when the group type has no groups", async () => {
    renderHub(createFakePlatform(world({ workItemTypes: ["Feature", "Epic", "Tom"] })));
    const settings = await openSettings();
    await checkbox(settings, "Övrigt (#2)");

    await choose(settings, "Group work item type", "Tom");

    expect((await within(settings).findByText(/has no groups/)).textContent).toContain("Tom");
    expect(within(settings).queryByRole("checkbox")).toBeNull();
  });

  /** A project with one hidden group, where the panel is refused the groups the given number of times. */
  const openedWithGroupsRefused = async (times: number) => {
    const fake = createFakePlatform(world({ savedSettings: { [PROJECT]: savedSettings({ hiddenGroups: [2] }) } }));
    let refusals = 0;
    const platform: FakePlatform = {
      ...fake,
      queryWorkItemIds: (id, type) =>
        type === "Epic" && refusals-- > 0 ? Promise.reject(new Error("TF400893: Unable to contact the server.")) : fake.queryWorkItemIds(id, type),
    };
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });
    refusals = times;
    return { platform, settings: await openSettings() };
  };

  it("says so when the groups cannot be read, and can ask again", async () => {
    const { settings } = await openedWithGroupsRefused(1);

    const alert = await within(settings).findByRole("alert");
    expect(alert.textContent).toContain("could not read the groups");
    expect(alert.textContent).toContain("TF400893");
    await expectNoAccessibilityViolations(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Try again" }));

    expect(await isHidden(settings, "Övrigt (#2)")).toBe(true);
    expect(within(settings).queryByRole("alert")).toBeNull();
  });

  it("keeps what is hidden when saving while the groups cannot be read", async () => {
    const { platform, settings } = await openedWithGroupsRefused(1);
    await within(settings).findByRole("alert");

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(async () => expect(await storedContent(platform)).toMatchObject({ settings: { hiddenGroups: [2] }, log: [expect.anything()] }));
  });

  it("ignores an answer about a group type that is no longer chosen", async () => {
    const fake = createFakePlatform(world());
    let answerTheme: () => void = () => undefined;
    const platform: FakePlatform = {
      ...fake,
      queryWorkItemIds: (id, type) =>
        type === "Theme"
          ? new Promise((resolve) => {
              answerTheme = () => resolve(fake.queryWorkItemIds(id, type));
            })
          : fake.queryWorkItemIds(id, type),
    };
    renderHub(platform);
    const settings = await openSettings();
    await checkbox(settings, "Övrigt (#2)");

    await choose(settings, "Group work item type", "Theme");
    await choose(settings, "Group work item type", "Epic");
    await checkbox(settings, "Övrigt (#2)");
    await act(async () => {
      answerTheme();
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(within(settings).queryByRole("checkbox", { name: "Ett tema (#3)" })).toBeNull();
    expect(await checkbox(settings, "Övrigt (#2)")).toBeTruthy();
  });

  it("renders group names as text, never as HTML", async () => {
    const injected = `<img src=x onerror="window.__hacked='group'"><b>group</b>`;
    renderHub(createFakePlatform(lifecycleWorld([robot(1, injected)], { projectId: PROJECT, isAdministrator: true })));
    const settings = await openSettings();

    await checkbox(settings, `${injected} (#1)`);
    expect(document.querySelector("img, b")).toBeNull();
  });

  it("is forgotten when going back to the defaults", async () => {
    const platform = createFakePlatform(world({ savedSettings: { [PROJECT]: savedSettings({ groupType: "Borta", hiddenGroups: [2] }) } }));
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    fireEvent.click(await within(settings).findByRole("button", { name: "Reset to defaults" }));

    expect(await screen.findByText("Mall")).toBeTruthy();
  });
});

describe("settings that cannot be used", () => {
  const broken = { version: 99, whatever: true };

  it("lead a Project Administrator from the error to a reset, which goes back to the guess", async () => {
    const platform = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: broken }, workItemTypes: ["Feature", "Epic"] }));
    renderHub(platform);
    expect((await screen.findByRole("alert")).textContent).toContain("unknown version");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    expect((await within(settings).findByRole("alert")).textContent).toContain("unknown version");
    expect(await storedContent(platform)).toEqual(broken);
    await expectNoAccessibilityViolations(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Reset to defaults" }));

    expect(await screen.findByText(/isn't set up/)).toBeTruthy();
    await screen.findByRole("region", { name: "Board" });
    expect(await storedContent(platform)).toEqual({
      version: 1,
      settings: null,
      log: [{ at: expect.any(Number), userId: "user-1", userName: "Ada Admin" }],
    });
  });

  it("lead to the reset even when the version cannot be turned into text", async () => {
    const version = { toString: 1 };
    const platform = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: { ...savedSettings(), version } } }));
    renderHub(platform);
    expect((await screen.findByRole("alert")).textContent).toContain(`unknown version: ${JSON.stringify(version)}`);

    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    expect((await within(settings).findByRole("alert")).textContent).toContain(`unknown version: ${JSON.stringify(version)}`);
    fireEvent.click(within(settings).getByRole("button", { name: "Reset to defaults" }));

    await screen.findByText(/isn't set up/);
    expect(await storedContent(platform)).toMatchObject({ version: 1, settings: null, log: [expect.objectContaining({ userId: "user-1" })] });
  });

  it("go back to the defaults even if storage drops the empty settings when saving", async () => {
    const fake = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: broken } }));
    const platform: FakePlatform = {
      ...fake,
      saveSettingsDocument: (id, content, revision) =>
        fake.saveSettingsDocument(id, JSON.parse(JSON.stringify(content, (_key, value) => value ?? undefined)), revision),
    };
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));

    fireEvent.click(await within(await panel()).findByRole("button", { name: "Reset to defaults" }));

    await screen.findByText(/isn't set up/);
    expect(await storedContent(platform)).not.toHaveProperty("settings");
    expect(screen.queryByRole("alert")).toBeNull();

    const reopened = await openSettings();
    await formLoaded(reopened);
    expect(within(reopened).queryByRole("alert")).toBeNull();
  });

  it("are never replaced unless the administrator asks", async () => {
    const platform = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: broken } }));
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    fireEvent.click(await within(settings).findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    expect(await storedContent(platform)).toEqual(broken);
    expect((await screen.findByRole("alert")).textContent).toContain("unknown version");
  });

  it("keep what can still be read of the log", async () => {
    const entry = { at: Date.parse("2026-11-05T10:00:00Z"), userId: "bo", userName: "Bo Bas" };
    const platform = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: { ...broken, log: ["trasig", { at: 1e300, userId: "u", userName: "Ingen tid" }, entry] } } }));
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    expect((await within(settings).findByRole("list", { name: "Change log" })).textContent).toContain("Bo Bas");
    fireEvent.click(within(settings).getByRole("button", { name: "Reset to defaults" }));

    await screen.findByText(/isn't set up/);
    expect((await storedContent(platform)).log).toEqual([entry, expect.objectContaining({ userId: "user-1" })]);
  });

  it("tell anyone else who can fix them, without a way in", async () => {
    renderHub(createFakePlatform(adminWorld({ isAdministrator: false, savedSettings: { [PROJECT]: broken } })));

    expect((await screen.findByRole("alert")).textContent).toContain("A Project Administrator");
    expect(screen.queryByRole("button", { name: "Open settings" })).toBeNull();
  });

  it("can be fixed in the form when only the saved phase field is gone", async () => {
    const platform = createFakePlatform(
      adminWorld({ savedSettings: { [PROJECT]: savedSettings({ phaseField: "Custom.Borta" }) }, workItemTypes: ["Feature", "Epic"] }),
    );
    renderHub(platform);
    expect((await screen.findByRole("alert")).textContent).toContain("Custom.Borta");
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    await choose(settings, "Phase field", "Livscykel");
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await screen.findByRole("region", { name: "Board" });
    expect(await storedContent(platform)).toMatchObject({ settings: { phaseField: PHASE_FIELD, phaseOrder: PHASES } });
  });
});

describe("settings that name something the project no longer has", () => {
  it("say so visibly on the hub when the group type is gone, instead of showing every object without a group", async () => {
    renderHub(createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: savedSettings({ groupType: "Borta" }) } })));

    expect((await screen.findByRole("alert")).textContent).toContain("Borta");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
  });

  it("say so visibly on the hub when the object type is gone", async () => {
    renderHub(createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: savedSettings({ objectType: "Borta" }) } })));

    expect((await screen.findByRole("alert")).textContent).toContain("Borta");
  });

  it("explain themselves in the panel and offer the way back to the defaults", async () => {
    const platform = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: savedSettings({ groupType: "Borta" }) } }));
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    expect((await within(settings).findByRole("alert")).textContent).toContain("Borta");
    fireEvent.click(within(settings).getByRole("button", { name: "Reset to defaults" }));

    await screen.findByText(/isn't set up/);
    expect(await storedContent(platform)).toMatchObject({ settings: null, log: [expect.objectContaining({ userId: "user-1" })] });
  });

  it("lead from the hub's error to the way back to the defaults, even if Azure DevOps refuses to be asked about the saved type", async () => {
    const refused = "a:b";
    const fake = createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: savedSettings({ objectType: refused }) } }));
    const platform: FakePlatform = {
      ...fake,
      getPicklistFields: (id, type) =>
        type === refused ? Promise.reject(new Error("A potentially dangerous Request.Path value was detected.")) : fake.getPicklistFields(id, type),
    };
    renderHub(platform);

    expect((await screen.findByRole("alert")).textContent).toContain(`${refused} as a work item type`);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();

    expect((await within(settings).findByRole("alert")).textContent).toContain(`${refused} as a work item type`);
    expect(chosen(settings, "Object work item type")).toBe("Choose…");
    fireEvent.click(within(settings).getByRole("button", { name: "Reset to defaults" }));

    await screen.findByText(/isn't set up/);
    await screen.findByRole("region", { name: "Board" });
    expect(await storedContent(platform)).toMatchObject({ settings: null, log: [expect.objectContaining({ userId: "user-1" })] });
  });

  it("leave the phase field unchosen when the saved object type is chosen again", async () => {
    const platform = createFakePlatform(
      adminWorld({
        workItemTypes: ["Feature", "Epic", "Theme"],
        savedSettings: { [PROJECT]: savedSettings({ phaseField: "Custom.Borta" }) },
      }),
    );
    renderHub(platform);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    const settings = await panel();
    await formLoaded(settings);
    expect(chosen(settings, "Phase field")).toBe("Choose…");

    await choose(settings, "Object work item type", "Theme");
    await choose(settings, "Object work item type", "Feature");

    await within(settings).findByText("Phase field");
    await waitFor(() => expect(within(settings).queryByText(/has no picklist field/)).toBeNull());
    expect(chosen(settings, "Phase field")).toBe("Choose…");
  });
});

describe("valid settings", () => {
  it("offer no reset that a stray click could use to throw them away", async () => {
    renderHub(createFakePlatform(adminWorld({ savedSettings: { [PROJECT]: savedSettings() } })));
    const settings = await openSettings();

    await formLoaded(settings);
    expect(within(settings).queryByRole("button", { name: "Reset to defaults" })).toBeNull();
    expect(within(settings).queryByRole("alert")).toBeNull();
  });
});

describe("the form while a new object type's fields are on their way", () => {
  /** Opens the panel with every question about Theme's fields waiting to be answered, or refused, by the test. */
  const openedWithThemeHeldBack = async () => {
    const temafas = { referenceName: "Custom.Temafas", name: "Temafas", values: ["Tidig", "Mitten", "Sen"] };
    const fake = createFakePlatform(adminWorld({ workItemTypes: ["Feature", "Epic", "Theme"], picklistFields: { Theme: [temafas] } }));
    const held: { answer: () => void; refuse: () => void }[] = [];
    const platform: FakePlatform = {
      ...fake,
      getPicklistFields: (id, type) =>
        type !== "Theme"
          ? fake.getPicklistFields(id, type)
          : new Promise((resolve, reject) => {
              held.push({ answer: () => resolve(fake.getPicklistFields(id, type)), refuse: () => reject(new Error("TF400893: Too late.")) });
            }),
    };
    renderHub(platform);
    return { platform, held, settings: await openSettings() };
  };

  const settleWithin = (settle: () => void) =>
    act(async () => {
      settle();
      await new Promise((resolve) => setTimeout(resolve));
    });

  it.each([
    ["an answer", "answer"],
    ["a refusal", "refuse"],
  ] as const)("ignores an older question about the same type if it ends last, with %s", async (_kind, ending) => {
    const { platform, held, settings } = await openedWithThemeHeldBack();
    await choose(settings, "Object work item type", "Theme");
    await choose(settings, "Object work item type", "Feature");
    await choose(settings, "Object work item type", "Theme");
    await settleWithin(held[1].answer);
    const row = (phase: string) => phaseRow(settings, phase);
    const dataTransfer = { setData: () => undefined, effectAllowed: "" };
    fireEvent.dragStart(row("Sen"), { dataTransfer });
    fireEvent.drop(row("Tidig"), { dataTransfer });
    const moved = ["Sen", "Tidig", "Mitten"];

    await settleWithin(held[0][ending]);

    expect(phaseNames(settings)).toEqual(moved);
    expect(within(settings).queryByRole("alert")).toBeNull();

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    await waitFor(async () => expect(await storedContent(platform)).toMatchObject({ settings: { objectType: "Theme", phaseOrder: moved } }));
  });

  it("keeps waiting for the latest question when an older one about the same type ends first", async () => {
    const { held, settings } = await openedWithThemeHeldBack();
    await choose(settings, "Object work item type", "Theme");
    await choose(settings, "Object work item type", "Feature");
    await choose(settings, "Object work item type", "Theme");

    await settleWithin(held[0].refuse);

    expect(within(settings).queryByRole("alert")).toBeNull();
    expect(within(settings).queryByText(/has no picklist field/)).toBeNull();

    await settleWithin(held[1].answer);

    expect(phaseNames(settings)).toEqual(["Tidig", "Mitten", "Sen"]);
  });

  it("does not claim that the type has no picklist field", async () => {
    renderHub(createFakePlatform(adminWorld({ workItemTypes: ["Feature", "Epic", "Theme"] })));
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(dropdown(settings, "Object work item type"));
    fireEvent.click(await screen.findByRole("option", { name: "Theme" }));

    expect(within(settings).queryByText(/has no picklist field/)).toBeNull();
    expect((await within(settings).findByText(/has no picklist field/)).textContent).toContain("Theme");
  });
});

describe("when the panel cannot do what it was asked", () => {
  it("does not claim that nothing changed if saving fails, since a save that timed out may still have gone through", async () => {
    const platform = createFakePlatform(adminWorld({ failures: { saveSettingsDocument: new Error("Azure DevOps did not answer within 30 seconds.") } }));
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    const alert = await within(settings).findByRole("alert");
    expect(alert.textContent).toContain("did not answer within 30 seconds");
    expect(alert.textContent).toContain("open them again");
    expect(alert.textContent).not.toContain("nothing changed");
  });

  it("says that the settings are saved if only closing the panel fails", async () => {
    const platform = createFakePlatform(adminWorld({ failures: { closeSettingsPanel: new Error("The host refused.") } }));
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));

    const alert = await within(settings).findByRole("alert");
    expect(alert.textContent).toContain("are saved");
    expect(alert.textContent).toContain("The host refused.");
    expect(await storedContent(platform)).toMatchObject({ settings: { objectType: "Feature" } });
  });

  it("says so visibly if cancelling cannot close the panel", async () => {
    renderHub(createFakePlatform(adminWorld({ failures: { closeSettingsPanel: new Error("The host refused.") } })));
    const settings = await openSettings();
    await formLoaded(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Cancel" }));

    expect((await within(settings).findByRole("alert")).textContent).toContain("The host refused.");
  });

  it("still shows the warning about the failed access check when the settings are the board's problem", async () => {
    renderHub(
      createFakePlatform(
        adminWorld({
          savedSettings: { [PROJECT]: { version: 99 } },
          failures: { isProjectAdministrator: new Error("TF400813: Not authorized.") },
        }),
      ),
    );

    expect((await screen.findByText(/could not check/)).textContent).toContain("TF400813");
    expect(await screen.findByText(/unknown version/)).toBeTruthy();
  });
});

describe("the panel when Azure DevOps cannot answer", () => {
  it("says so visibly and can be closed", async () => {
    const platform = createFakePlatform(adminWorld({ failures: { getWorkItemTypes: new Error("TF400893: Unable to contact the server.") } }));
    renderHub(platform);
    const settings = await openSettings();

    expect((await within(settings).findByRole("alert")).textContent).toContain("TF400893");

    fireEvent.click(within(settings).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
  });

  it("asks again when the same object type is chosen after its fields could not be read", async () => {
    const temafas = { referenceName: "Custom.Temafas", name: "Temafas", values: ["Tidig", "Sen"] };
    const fake = createFakePlatform(adminWorld({ workItemTypes: ["Feature", "Epic", "Theme"], picklistFields: { Theme: [temafas] } }));
    let refusals = 1;
    const platform: FakePlatform = {
      ...fake,
      getPicklistFields: (id, type) =>
        type === "Theme" && refusals-- > 0 ? Promise.reject(new Error("TF400893: Unable to contact the server.")) : fake.getPicklistFields(id, type),
    };
    renderHub(platform);
    const settings = await openSettings();

    await choose(settings, "Object work item type", "Theme");
    expect((await within(settings).findByRole("alert")).textContent).toContain("could not read the fields");

    await choose(settings, "Object work item type", "Theme");

    await waitFor(() => expect(chosen(settings, "Phase field")).toBe("Temafas"));
    expect(within(settings).queryByRole("alert")).toBeNull();
    expect(phaseNames(settings)).toEqual(["Tidig", "Sen"]);
  });
});

describe("the card's roles in the settings", () => {
  const opened = async (world: FakeWorld = {}) => {
    const platform = createFakePlatform(adminWorld(world));
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);
    return { platform, settings };
  };

  const save = async (settings: HTMLElement) => {
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
  };

  const savedSettingsOf = async (platform: FakePlatform) => (await storedContent(platform)).settings as Record<string, unknown>;

  it("have no field to begin with, and saving leaves them out", async () => {
    const { platform, settings } = await opened();

    for (const role of ["Current situation", "Waiting on", "Marker"]) expect(chosen(settings, role)).toBe("None");
    await expectNoAccessibilityViolations(settings);

    await save(settings);
    const stored = await savedSettingsOf(platform);
    expect(stored.roles).toBeUndefined();
    expect(stored.detailFields).toBeUndefined();
  });

  it("can each be pointed at a field, and the board follows what is saved", async () => {
    const platform = createFakePlatform(
      lifecycleWorld(
        [
          bodil,
          {
            id: 11,
            type: "Feature",
            fields: {
              "System.Title": "En process",
              [PHASE_FIELD]: "Idéfas",
              [AKTUELLT_LAGE.referenceName]: "<div>Körs nattetid.</div>",
              [VANTAR_PA.referenceName]: "Juridik",
              [FORBATTRING_PAGAR.referenceName]: true,
            },
          },
        ],
        { projectId: PROJECT, isAdministrator: true },
      ),
    );
    renderHub(platform);
    const settings = await openSettings();

    await choose(settings, "Current situation", "Aktuellt läge");
    await choose(settings, "Waiting on", "Väntar på");
    await choose(settings, "Marker", "Förbättring pågår");
    await save(settings);

    expect((await savedSettingsOf(platform)).roles).toEqual(OUR_ROLES);
    await screen.findByText("Körs nattetid.");
    expect(screen.getByText("Juridik")).toBeTruthy();
    expect(screen.getByText("Förbättring pågår")).toBeTruthy();
  });

  it("offer only the fields each role can use", async () => {
    const { settings } = await opened();

    fireEvent.click(dropdown(settings, "Marker"));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["None", "Förbättring pågår"]);
    fireEvent.click(await screen.findByRole("option", { name: "None" }));

    fireEvent.click(dropdown(settings, "Current situation"));
    const situationOptions = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(situationOptions).toEqual(expect.arrayContaining(["Aktuellt läge", "Väntar på"]));
    expect(situationOptions).not.toContain(FORBATTRING_PAGAR.name);
    expect(situationOptions).not.toContain(CREATED_DATE.name);
    expect(situationOptions).not.toContain(ASSIGNED_TO.name);
    fireEvent.click(await screen.findByRole("option", { name: "None" }));

    fireEvent.click(dropdown(settings, "Waiting on"));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toContain(ASSIGNED_TO.name);
  });

  it("come back when reopened, and each can be set to none again", async () => {
    const { platform, settings } = await opened({ savedSettings: { [PROJECT]: savedSettings({ roles: OUR_ROLES }) } });

    expect(chosen(settings, "Current situation")).toBe("Aktuellt läge");
    expect(chosen(settings, "Waiting on")).toBe("Väntar på");
    expect(chosen(settings, "Marker")).toBe("Förbättring pågår");

    await choose(settings, "Waiting on", "None");
    await save(settings);

    expect((await savedSettingsOf(platform)).roles).toEqual({
      currentSituation: AKTUELLT_LAGE.referenceName,
      marker: FORBATTRING_PAGAR.referenceName,
    });
  });

  it("start over on another object type, and come back on the saved one", async () => {
    const theme = { referenceName: "Custom.Temafas", name: "Temafas", values: ["Tidig"] };
    const { platform, settings } = await opened({
      workItemTypes: ["Epic", "Feature", "Theme"],
      picklistFields: { Feature: [{ referenceName: PHASE_FIELD, name: "Livscykel", values: PHASES }], Theme: [theme] },
      savedSettings: { [PROJECT]: savedSettings({ roles: OUR_ROLES, detailFields: [GKL.referenceName] }) },
    });

    await choose(settings, "Object work item type", "Theme");
    await waitFor(() => expect(chosen(settings, "Phase field")).toBe("Temafas"));
    expect(chosen(settings, "Waiting on")).toBe("None");
    expect(detailFieldNames(settings)).toEqual([]);

    await choose(settings, "Object work item type", "Feature");
    await waitFor(() => expect(chosen(settings, "Waiting on")).toBe("Väntar på"));
    expect(detailFieldNames(settings)).toEqual(["GKL"]);

    await choose(settings, "Object work item type", "Theme");
    await waitFor(() => expect(chosen(settings, "Phase field")).toBe("Temafas"));
    await save(settings);
    const stored = await savedSettingsOf(platform);
    expect(stored.roles).toBeUndefined();
    expect(stored.detailFields).toBeUndefined();
  });

  it("renders names from the organization as text, never as HTML", async () => {
    const injected = '<img src=x onerror="window.__hacked=1"><b>fet</b>';
    const { settings } = await opened({
      workItemFields: { Feature: [{ referenceName: "Custom.Elak", name: injected, kind: "text" }] },
      savedSettings: { [PROJECT]: savedSettings({ roles: { waitingOn: "Custom.Elak" } }) },
    });

    expect(chosen(settings, "Waiting on")).toBe(injected);
    expect(detailFieldNames(settings)).toEqual([injected]);
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("the detail panel's fields in the settings", () => {
  const opened = async (world: FakeWorld = {}) => {
    const platform = createFakePlatform(adminWorld(world));
    renderHub(platform);
    const settings = await openSettings();
    await formLoaded(settings);
    return { platform, settings };
  };

  const savedDetailFields = async (platform: FakePlatform, settings: HTMLElement) => {
    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());
    return ((await storedContent(platform)).settings as { detailFields?: string[] }).detailFields;
  };

  it("follow the card's roles until they are changed, and are then left out of what is saved", async () => {
    const { platform, settings } = await opened();
    expect(detailFieldNames(settings)).toEqual([]);

    await choose(settings, "Marker", "Förbättring pågår");
    await choose(settings, "Current situation", "Aktuellt läge");

    expect(detailFieldNames(settings)).toEqual(["Aktuellt läge", "Förbättring pågår"]);
    await expect(savedDetailFields(platform, settings)).resolves.toBeUndefined();
  });

  it("are a free list: any field on the type can be added, moved and removed, in that order", async () => {
    const { platform, settings } = await opened({ savedSettings: { [PROJECT]: savedSettings({ roles: { waitingOn: VANTAR_PA.referenceName } }) } });
    expect(detailFieldNames(settings)).toEqual(["Väntar på"]);

    await choose(settings, "Add a field", "GKL");
    await choose(settings, "Add a field", "Created Date");
    expect(detailFieldNames(settings)).toEqual(["Väntar på", "GKL", "Created Date"]);
    await expectNoAccessibilityViolations(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Move Created Date up" }));
    fireEvent.click(within(settings).getByRole("button", { name: "Remove Väntar på" }));

    expect(detailFieldNames(settings)).toEqual(["Created Date", "GKL"]);
    expect(within(settings).getByText("Väntar på removed.")).toBeTruthy();
    await expect(savedDetailFields(platform, settings)).resolves.toEqual([CREATED_DATE.referenceName, GKL.referenceName]);
  });

  it("do not offer what is already on the list", async () => {
    const { settings } = await opened({ savedSettings: { [PROJECT]: savedSettings({ detailFields: [GKL.referenceName] }) } });

    fireEvent.click(dropdown(settings, "Add a field"));

    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).not.toContain("GKL");
    expect(options).toContain(CREATED_DATE.name);
  });

  it("offer the phase field and the title like any other field", async () => {
    const { platform, settings } = await opened({
      workItemFields: { Feature: [{ referenceName: "System.Title", name: "Title", kind: "text" }] },
    });

    await choose(settings, "Add a field", "Livscykel");
    await choose(settings, "Add a field", "Title");

    expect(detailFieldNames(settings)).toEqual(["Livscykel", "Title"]);
    await expect(savedDetailFields(platform, settings)).resolves.toEqual([PHASE_FIELD, "System.Title"]);
  });

  it("keep the focus on the pressed button when a field moves, also when it reaches either end", async () => {
    const { settings } = await opened({
      savedSettings: { [PROJECT]: savedSettings({ detailFields: [GKL.referenceName, CREATED_DATE.referenceName, ASSIGNED_TO.referenceName] }) },
    });
    const button = (name: string) => within(settings).getByRole("button", { name });

    fireEvent.click(button("Move GKL down"));
    expect(detailFieldNames(settings)).toEqual(["Created Date", "GKL", "Assigned To"]);
    expect(document.activeElement).toBe(button("Move GKL down"));

    fireEvent.click(button("Move GKL down"));
    expect(detailFieldNames(settings)).toEqual(["Created Date", "Assigned To", "GKL"]);
    expect(document.activeElement).toBe(button("Move GKL down"));

    fireEvent.click(button("Move GKL up"));
    fireEvent.click(button("Move GKL up"));
    expect(detailFieldNames(settings)).toEqual(["GKL", "Created Date", "Assigned To"]);
    expect(document.activeElement).toBe(button("Move GKL up"));
  });

  it("move the focus to the next field when one is removed, and to the list's heading when none is left", async () => {
    const { settings } = await opened({ savedSettings: { [PROJECT]: savedSettings({ detailFields: [GKL.referenceName, CREATED_DATE.referenceName] }) } });

    fireEvent.click(within(settings).getByRole("button", { name: "Remove GKL" }));
    await waitFor(() => expect(document.activeElement).toBe(within(settings).getByRole("button", { name: "Remove Created Date" })));

    fireEvent.click(within(settings).getByRole("button", { name: "Remove Created Date" }));
    await waitFor(() => expect(document.activeElement).toBe(within(settings).getByRole("heading", { name: "Detail panel" })));
  });

  it("can be emptied, and the panel then stays empty instead of going back to the card's fields", async () => {
    const { platform, settings } = await opened({ savedSettings: { [PROJECT]: savedSettings({ roles: OUR_ROLES, detailFields: [GKL.referenceName] }) } });

    fireEvent.click(within(settings).getByRole("button", { name: "Remove GKL" }));

    expect(detailFieldNames(settings)).toEqual([]);
    await expect(savedDetailFields(platform, settings)).resolves.toEqual([]);
  });
});

describe("settings that name a field the object's type no longer has, in the panel", () => {
  it("say so, leave it out of the form, and saving drops it", async () => {
    const platform = createFakePlatform(
      adminWorld({
        savedSettings: {
          [PROJECT]: savedSettings({
            roles: { waitingOn: "Custom.Borta", marker: FORBATTRING_PAGAR.referenceName },
            detailFields: ["Custom.OcksaBorta", GKL.referenceName],
          }),
        },
      }),
    );
    renderHub(platform);
    const settings = await openSettings();

    await formLoaded(settings);
    const alert = within(settings).getByRole("alert");
    expect(alert.textContent).toContain("Custom.Borta");
    expect(alert.textContent).toContain("Custom.OcksaBorta");
    expect(chosen(settings, "Waiting on")).toBe("None");
    expect(detailFieldNames(settings)).toEqual(["GKL"]);
    await expectNoAccessibilityViolations(settings);

    fireEvent.click(within(settings).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "Waypoint settings" })).toBeNull());

    expect((await storedContent(platform)).settings).toMatchObject({
      roles: { marker: FORBATTRING_PAGAR.referenceName },
      detailFields: [GKL.referenceName],
    });
    await waitFor(() => expect(screen.queryByText(/no longer has/)).toBeNull());
  });
});

function phaseRow(settings: HTMLElement, phase: string): HTMLElement {
  return within(within(settings).getByRole("list", { name: "Phase order" })).getByText(phase).closest("li") as HTMLElement;
}

function phaseNames(settings: HTMLElement): string[] {
  return within(within(settings).getByRole("list", { name: "Phase order" }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".waypoint-phase-name")?.textContent ?? "");
}

function detailFieldNames(settings: HTMLElement): string[] {
  const list = within(settings).queryByRole("list", { name: "Detail panel" });
  return list ? within(list).getAllByRole("listitem").map((row) => row.textContent ?? "") : [];
}

/** What a dropdown shows as chosen. */
function chosen(settings: HTMLElement, label: string): string {
  return dropdown(settings, label).value;
}

function dropdown(settings: HTMLElement, label: string): HTMLInputElement {
  return within(settings).getByRole<HTMLInputElement>("button", { name: label });
}

/** Waits for the form to have loaded. */
function formLoaded(settings: HTMLElement): Promise<HTMLElement> {
  return within(settings).findByRole("button", { name: "Save" });
}

async function choose(settings: HTMLElement, label: string, option: string): Promise<void> {
  await formLoaded(settings);
  fireEvent.click(dropdown(settings, label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
