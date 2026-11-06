import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePlatform } from "../platform/fakePlatform";
import { expectNoAccessibilityViolations, renderHub } from "../testing/hubRig";
import { OUR_TABS, PHASES, lifecycleWorld, process, robot, savedSettings } from "../testing/lifecycleWorld";
import { REDRAW_BUDGET, fastestOfThreeGoes, timeOf } from "../testing/timing";

const PROJECT = "this-project";
const bodil = robot(1, "PROCESS_101.Bodil");

const withTabs = (tabs: unknown, phaseOrder: string[] = PHASES) => ({ [PROJECT]: savedSettings({ tabs, phaseOrder }) });

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

const columnNames = () =>
  within(screen.getByRole("region", { name: "Board" }))
    .queryAllByRole("heading")
    .map((heading) => heading.textContent?.replace(/ \d+ objects?$/, ""));

describe("the tabs", () => {
  it("show the saved tabs without numbers, and the first one by default", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, process(11, "Pågår", "Under utveckling", 1), process(12, "Körs", "I produktion", 1)], {
          projectId: PROJECT,
          savedSettings: withTabs(OUR_TABS),
        }),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(tabNames()).toEqual(["Före produktion", "Drift", "Avslut"]);
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Före produktion");
    expect(columnNames()).toEqual(["Idéfas", "Under utvärdering", "Under planering", "Under utveckling"]);
    expect(screen.getByText("Pågår")).toBeTruthy();
    expect(screen.queryByText("Körs")).toBeNull();
    await expectNoAccessibilityViolations();
  });
});

describe("the chosen tab", () => {
  const world = (rest = {}) =>
    lifecycleWorld([bodil, process(11, "Pågår", "Under utveckling", 1), process(12, "Körs", "I produktion", 1)], {
      projectId: PROJECT,
      savedSettings: withTabs(OUR_TABS),
      ...rest,
    });

  const chosenTab = () => screen.getByRole("tab", { selected: true }).textContent;

  it("shows that tab's columns and is written to the URL", async () => {
    const platform = createFakePlatform(world());
    renderHub(platform);

    fireEvent.click(await screen.findByRole("tab", { name: "Drift" }));

    expect(chosenTab()).toBe("Drift");
    expect(columnNames()).toEqual(["I produktion", "Pausad"]);
    expect(screen.getByText("Körs")).toBeTruthy();
    expect(screen.queryByText("Pågår")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "Drift" })).toBeTruthy();
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Drift" }));
    await expectNoAccessibilityViolations();
  });

  it("is the same after a reload", async () => {
    const platform = createFakePlatform(world());
    renderHub(platform);
    fireEvent.click(await screen.findByRole("tab", { name: "Avslut" }));
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Avslut" }));

    cleanup();
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Avslut");
  });

  it("comes from a link, and is not written again when the URL already says it", async () => {
    const platform = createFakePlatform(world({ queryParams: { tab: "Drift", other: "kvar" } }));
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Drift");
    expect(write).not.toHaveBeenCalled();
    expect(await platform.getQueryParams()).toEqual({ tab: "Drift", other: "kvar" });
  });

  it("is written to the URL when the hub opens without one, beside the other parameters", async () => {
    const platform = createFakePlatform(world({ queryParams: { other: "kvar" } }));
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Före produktion");
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion", other: "kvar" }));
  });

  it("leaves other parameters in the URL alone", async () => {
    const platform = createFakePlatform(world({ queryParams: { other: "kvar" } }));
    renderHub(platform);

    fireEvent.click(await screen.findByRole("tab", { name: "Drift" }));

    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Drift", other: "kvar" }));
  });

  it.each([
    ["a tab that does not exist", "Finns inte"],
    ["a tab in the wrong case", "drift"],
    ["an empty value", ""],
    ["an index", "1"],
    ["markup", "<img src=x onerror=alert(1)>"],
  ])("falls back to the first tab, without an error, and writes it to the URL when the URL names %s", async (_kind, tab) => {
    const platform = createFakePlatform(world({ queryParams: { tab, other: "kvar" } }));
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Före produktion");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion", other: "kvar" }));
  });

  it("says so, still shows the board, and leaves the URL alone until a tab is chosen, when the URL cannot be read", async () => {
    const platform = createFakePlatform(world({ failures: { getQueryParams: new Error("The host refused.") } }));
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Före produktion");
    expect((await screen.findByText(/could not read the link/)).textContent).toContain("The host refused.");
    expect(write).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Drift" }));

    expect(write).toHaveBeenCalledWith({ tab: "Drift" });
  });

  it("does not say the link failed while the board is still loading", async () => {
    const fake = createFakePlatform(world({ failures: { getQueryParams: new Error("The host refused.") } }));
    renderHub({ ...fake, getProject: () => new Promise(() => undefined) });

    await new Promise((resolve) => setTimeout(resolve));

    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(screen.queryByText(/could not read the link/)).toBeNull();
  });

  it.each([
    ["the board cannot be loaded", /could not load the board/, world({ failures: { getQueryParams: new Error("The host refused."), getProject: new Error("The host refused.") } })],
    ["there is no board to show", /isn't set up/, { picklistFields: {}, failures: { getQueryParams: new Error("The host refused.") } }],
  ])("neither says the link failed nor writes to the URL when %s", async (_case, message, broken) => {
    const platform = createFakePlatform(broken);
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);

    await screen.findByText(message);
    await new Promise((resolve) => setTimeout(resolve));

    expect(screen.queryByText(/could not read the link/)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("does not write to the URL when the board cannot be loaded, even if the URL can be read", async () => {
    const platform = createFakePlatform(world({ failures: { getProject: new Error("The host refused.") } }));
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);

    await screen.findByText(/could not load the board/);

    expect(write).not.toHaveBeenCalled();
  });

  it("still shows the board, and leaves the URL alone, when the host's answer about the URL is not what it should be", async () => {
    const fake = createFakePlatform(world({ queryParams: { tab: "Drift" } }));
    renderHub({ ...fake, getQueryParams: async () => null as never });

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Före produktion");
    expect(await screen.findByText(/could not read the link/)).toBeTruthy();
    expect(await fake.getQueryParams()).toEqual({ tab: "Drift" });
  });

  it("says so, and still shows the board, when the URL cannot be written as the hub opens", async () => {
    renderHub(createFakePlatform(world({ failures: { setQueryParams: new Error("The host refused.") } })));

    await screen.findByRole("region", { name: "Board" });
    expect(chosenTab()).toBe("Före produktion");
    expect((await screen.findByText(/could not put the tab in the address/)).textContent).toContain("The host refused.");
  });

  it("says so, and still changes tab, when the URL cannot be written", async () => {
    renderHub(createFakePlatform(world({ failures: { setQueryParams: new Error("The host refused.") } })));

    fireEvent.click(await screen.findByRole("tab", { name: "Drift" }));

    expect(chosenTab()).toBe("Drift");
    expect((await screen.findByText(/could not put the tab in the address/)).textContent).toContain("The host refused.");
  });

  it("does not write to the URL again when the chosen tab is chosen again", async () => {
    const platform = createFakePlatform(world());
    const write = vi.spyOn(platform, "setQueryParams");
    renderHub(platform);

    fireEvent.click(await screen.findByRole("tab", { name: "Före produktion" }));
    await new Promise((resolve) => setTimeout(resolve));

    expect(write).toHaveBeenCalledTimes(1);
    expect(await platform.getQueryParams()).toEqual({ tab: "Före produktion" });
  });
});

describe("the tabs on a keyboard", () => {
  const press = (key: number) => fireEvent.keyDown(document.activeElement as Element, { which: key, keyCode: key });
  const [ENTER, SPACE, LEFT, RIGHT] = [13, 32, 37, 39];

  // jsdom does no layout, and the library's arrow keys skip anything without a size.
  beforeEach(() => vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100));
  afterEach(() => vi.restoreAllMocks());

  const opened = async () => {
    const platform = createFakePlatform(lifecycleWorld([bodil], { projectId: PROJECT, savedSettings: withTabs(OUR_TABS) }));
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });
    return platform;
  };

  it("have one tab stop, so that Tab reaches them once", async () => {
    await opened();

    expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it.each([
    ["Enter", ENTER],
    ["Space", SPACE],
  ])("move with the arrow keys and change with %s", async (_name, key) => {
    const platform = await opened();
    screen.getByRole("tab", { name: "Före produktion" }).focus();

    press(RIGHT);
    press(RIGHT);
    press(LEFT);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Drift" }));
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Före produktion");

    press(key);

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Drift");
    expect(columnNames()).toEqual(["I produktion", "Pausad"]);
    await waitFor(async () => expect(await platform.getQueryParams()).toEqual({ tab: "Drift" }));
  });
});

describe("the phases on the tabs", () => {
  const opened = async (saved: Record<string, unknown>, workItems = [bodil]) => {
    renderHub(createFakePlatform(lifecycleWorld(workItems, { projectId: PROJECT, savedSettings: saved, queryParams: { tab: "Avslut" } })));
    await screen.findByRole("region", { name: "Board" });
  };

  it("show a divider with its text before the phase it is set on, and only there", async () => {
    await opened(withTabs(OUR_TABS));

    const board = screen.getByRole("region", { name: "Board" });
    const divider = within(board).getByRole("separator", { name: "Blev aldrig av" });
    expect(divider.textContent).toBe("Blev aldrig av");
    const avfardad = within(board).getByRole("heading", { name: /^Avfärdad/ }).closest("section") as HTMLElement;
    expect(avfardad.previousElementSibling).toBe(divider);
    expect(within(board).getAllByRole("separator")).toHaveLength(1);
    await expectNoAccessibilityViolations();
  });

  it("follow the saved phase order within a tab, whatever order the tab lists them in", async () => {
    const reversed = OUR_TABS.map((tab) => ({ ...tab, phases: [...tab.phases].reverse() }));
    await opened(withTabs(reversed));

    expect(columnNames()).toEqual(["Under avveckling", "Avvecklad", "Avfärdad"]);
  });

  it("put a value the picklist has gained last on the last tab, marked as new", async () => {
    const withoutAvvecklad = OUR_TABS.map((tab) => ({ ...tab, phases: tab.phases.filter(({ name }) => name !== "Avvecklad") }));
    await opened(withTabs(withoutAvvecklad, PHASES.filter((phase) => phase !== "Avvecklad")));

    expect(columnNames()).toEqual(["Under avveckling", "Avfärdad", "Avvecklad (new)"]);
  });

  it("drop a value the picklist has lost", async () => {
    const tabs = [OUR_TABS[0], OUR_TABS[1], { ...OUR_TABS[2], phases: [{ name: "Borttagen", dividerBefore: "Gammal" }, ...OUR_TABS[2].phases] }];
    await opened(withTabs(tabs, ["Borttagen", ...PHASES]));

    expect(columnNames()).toEqual(["Under avveckling", "Avvecklad", "Avfärdad"]);
    expect(screen.queryByText("Gammal")).toBeNull();
  });

  it("keep objects no tab holds visible, last on the last tab", async () => {
    await opened(withTabs(OUR_TABS), [bodil, process(11, "Kvar", "Nedlagd", 1), process(12, "Utan fas", undefined, 1)]);

    expect(columnNames()).toEqual(["Under avveckling", "Avvecklad", "Avfärdad", "Nedlagd (not in the picklist)", "No phase"]);
    expect(screen.getByText("Kvar")).toBeTruthy();
    expect(screen.getByText("Utan fas")).toBeTruthy();
  });

  it("say so on a tab whose phases are all gone from the picklist", async () => {
    const tabs = [OUR_TABS[0], { name: "Avslut", phases: [{ name: "Borttagen" }] }, { name: "Sist", phases: OUR_TABS[1].phases.concat(OUR_TABS[2].phases) }];
    await opened(withTabs(tabs, ["Borttagen", ...PHASES]));

    expect(columnNames()).toEqual([]);
    expect(screen.getByText("This tab has no phases.")).toBeTruthy();
  });

  it("all share one tab when nothing else is saved", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: PROJECT, savedSettings: { [PROJECT]: savedSettings() } })));

    await screen.findByRole("region", { name: "Board" });
    expect(tabNames()).toEqual(["All phases"]);
    expect(columnNames()).toEqual(PHASES);
  });

  it("render names from the organization as text, never as HTML", async () => {
    const injected = (name: string) => `<img src=x onerror="window.__hacked='${name}'"><b>${name}</b>`;
    const rest = PHASES.filter((phase) => phase !== "Avfärdad").map((name) => ({ name }));
    await opened(withTabs([{ name: "Avslut", phases: [{ name: "Avfärdad", dividerBefore: injected("divider") }] }, { name: injected("tab"), phases: rest }]));

    expect(screen.getByRole("separator").textContent).toBe(injected("divider"));
    expect(screen.getByRole("tab", { name: injected("tab") })).toBeTruthy();
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("saved tabs that are not valid", () => {
  const phase = { name: "Idéfas" };
  const rest = PHASES.slice(1).map((name) => ({ name }));

  it.each([
    ["a phase the phase order does not have", [{ name: "Drift", phases: [phase, ...rest, { name: "Annan" }] }]],
    ["no tab for a phase in the phase order", [{ name: "Drift", phases: rest }]],
    ["a tab name with spaces around it", [{ name: " Drift", phases: [phase, ...rest] }]],
    ["a divider with spaces around it", [{ name: "Drift", phases: [{ ...phase, dividerBefore: " Gammal" }, ...rest] }]],
    ["tabs that are not a list", "trasigt"],
    ["an empty list of tabs", []],
    ["a tab that is not a tab", ["Drift"]],
    ["something a tab should not have", [{ name: "Drift", phases: [phase], surprise: true }]],
    ["a tab without a name", [{ phases: [phase] }]],
    ["a tab with a blank name", [{ name: "  ", phases: [phase] }]],
    ["two tabs with the same name", [{ name: "Drift", phases: [phase] }, { name: "Drift", phases: [] }]],
    ["a tab without phases", [{ name: "Drift" }]],
    ["a phase that is only a name", [{ name: "Drift", phases: ["Idéfas"] }]],
    ["a phase without a name", [{ name: "Drift", phases: [{}] }]],
    ["something a phase should not have", [{ name: "Drift", phases: [{ ...phase, surprise: true }] }]],
    ["a divider of the wrong kind", [{ name: "Drift", phases: [{ ...phase, dividerBefore: 7 }] }]],
    ["a blank divider", [{ name: "Drift", phases: [{ ...phase, dividerBefore: " " }] }]],
    ["a phase listed twice on a tab", [{ name: "Drift", phases: [phase, phase] }]],
    ["a phase on two tabs", [{ name: "Drift", phases: [phase] }, { name: "Avslut", phases: [phase] }]],
    ["a tab with no phases, which the settings panel never saves", [{ name: "Drift", phases: [phase, ...rest] }, { name: "Tom", phases: [] }]],
    ["more tabs than a picklist has values", Array.from({ length: 2_049 }, (_, index) => ({ name: `Flik ${index}`, phases: [] }))],
  ])("say so visibly and draw no board when storage holds %s", async (_kind, tabs) => {
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: PROJECT, savedSettings: withTabs(tabs) })));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("saved settings");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
  });
});

describe("changing tab on a board of 2,000 objects", () => {
  it.each([
    ["spread over all phases", (index: number) => PHASES[index % PHASES.length]],
    ["all on the tab changed to", () => "I produktion"],
  ])("redraws without noticeable delay, with the objects %s", async (_spread, phaseOf) => {
    const processes = Array.from({ length: 2000 }, (_, index) => process(100 + index, `Process ${index}`, phaseOf(index), 1));
    renderHub(createFakePlatform(lifecycleWorld([bodil, ...processes], { projectId: PROJECT, savedSettings: withTabs(OUR_TABS) })));
    const driftTab = await screen.findByRole("tab", { name: "Drift" });
    const [firstTab] = screen.getAllByRole("tab");
    const cardsOnDrift = processes.filter(({ fields }) => ["I produktion", "Pausad"].includes(fields["Custom.Livscykel"] as string)).length;

    const [elapsed] = fastestOfThreeGoes(() => {
      const changing = timeOf(() => fireEvent.click(driftTab));
      expect(screen.queryAllByText(/^Process \d+$/)).toHaveLength(cardsOnDrift);

      fireEvent.click(firstTab);
      return [changing];
    });

    expect(elapsed).toBeLessThan(REDRAW_BUDGET);
  }, 30_000);
});
