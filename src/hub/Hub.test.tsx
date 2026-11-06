import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakePlatform, type FakePlatform } from "../platform/fakePlatform";
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

const bodil = robot(1, "PROCESS_101.Bodil");
const cassius = robot(2, "PROCESS_103.Cassius");

const columnNames = () => within(screen.getByRole("region", { name: "Board" })).getAllByRole("heading").map((h) => h.textContent);

const groupNames = () => within(screen.getByRole("list", { name: "Groups" })).getAllByRole("listitem").map((item) => item.textContent);

const cardsIn = (phase: string) => {
  const cards = screen.queryByRole("list", { name: (name) => name.startsWith(`${phase} `) });
  return cards ? within(cards).queryAllByRole("listitem") : [];
};

describe("Waypoint hub", () => {
  it("opens with its name", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil])));

    expect(screen.getByRole("heading", { name: "Waypoint" })).toBeTruthy();
    await screen.findByRole("region", { name: "Board" });
  });

  it("says so visibly when Azure DevOps cannot be reached", async () => {
    renderHub(createFakePlatform({ failures: { getProject: new Error("Azure DevOps did not answer within 30 seconds.") } }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Waypoint could not load the board");
    expect(alert.textContent).toContain("did not answer within 30 seconds");
    await expectNoAccessibilityViolations();
  });
});

describe("when something unexpected comes back", () => {
  it("says so and keeps the gear when the board cannot be drawn", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      get displayName(): string {
        throw new Error("Ett värde ingen väntat sig.");
      },
    };
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, { ...process(11, "En process", "Idéfas", 1), fields: { ...process(11, "En process", "Idéfas", 1).fields, [ASSIGNED_TO.referenceName]: broken } }], {
          isAdministrator: true,
          savedSettings: { "project-1": savedSettings({ detailFields: [ASSIGNED_TO.referenceName] }) },
        }),
      ),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Waypoint could not show the board: Ett värde ingen väntat sig.");
    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it.each([
    ["a filter field", { "filter.GKL": ["7.3"] }],
    ["the keyword", { keyword: 7 }],
    ["the groups", { group: ["1"] }],
  ])("ignores %s in a link if it is not text, and shows the board", async (_part, queryParams) => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)], {
          queryParams: queryParams as never,
          savedSettings: { "project-1": savedSettings({ filterFields: [{ type: "startsWith", name: "GKL", referenceName: GKL.referenceName }] }) },
        }),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(cardsIn("Idéfas")).toHaveLength(1);
    expect(screen.queryByText(/could not read the link/)).toBeNull();
  });
});

describe("before anything is set up", () => {
  const forvaltningsomrade = { referenceName: "Custom.Forvaltningsomrade", name: "Förvaltningsområde", values: ["Ekonomi", "HR"] };
  const livscykel = { referenceName: "Custom.Livscykel", name: "Livscykel", values: ["Idéfas", "Pausad"] };

  it("guesses Feature under Epic and the first picklist field, and says so in a box leading to the settings", async () => {
    renderHub(
      createFakePlatform({
        picklistFields: { Feature: [forvaltningsomrade, livscykel] },
        workItems: [
          robot(1, "PROCESS_101.Bodil"),
          { id: 11, type: "Feature", fields: { "System.Title": "En process", "Custom.Forvaltningsomrade": "HR", "System.Parent": 1 } },
          { id: 12, type: "User Story", fields: { "System.Title": "Inte ett objekt", "Custom.Forvaltningsomrade": "HR" } },
        ],
      }),
    );

    const box = await screen.findByText(/isn't set up/);
    expect(box.textContent).toContain("Feature");
    expect(box.textContent).toContain("Epic");
    expect(box.textContent).toContain("Förvaltningsområde");
    expect(box.textContent).toMatch(/settings/);
    expect(columnNames()).toEqual(["Ekonomi 0 objects", "HR 1 object"]);
    expect(within(cardsIn("HR")[0]).getByText("PROCESS_101.Bodil")).toBeTruthy();
    expect(screen.queryByText("Inte ett objekt")).toBeNull();
    await expectNoAccessibilityViolations();
  });

  it("shows all phases as columns in a single tab", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil])));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["All phases"]);
    await expectNoAccessibilityViolations();
  });

  it("explains itself in the box instead of breaking when the guess finds no picklist field", async () => {
    renderHub(createFakePlatform({ picklistFields: {} }));

    const box = await screen.findByText(/isn't set up/);
    expect(box.textContent).toContain("no picklist field");
    expect(box.textContent).toContain("Feature");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
    await expectNoAccessibilityViolations();
  });

  it("does not count another project's saved settings", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil], {
          projectId: "this-project",
          savedSettings: { "other-project": savedSettings() },
        }),
      ),
    );

    expect(await screen.findByText(/isn't set up/)).toBeTruthy();
  });

  it("counts a stored document that leaves the settings out as nothing set up, not as an error", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: { version: 1, log: [] } } })));

    expect(await screen.findByText(/isn't set up/)).toBeTruthy();
    await screen.findByRole("region", { name: "Board" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("once settings are saved", () => {
  const twoPicklists = {
    Story: [
      { referenceName: "Custom.Annat", name: "Annat", values: ["A", "B"] },
      { referenceName: "Custom.Fas", name: "Fas", values: ["Tidig", "Sen"] },
    ],
  };

  it("shows the board the settings describe, without the box", async () => {
    renderHub(
      createFakePlatform({
        projectId: "this-project",
        savedSettings: {
          "this-project": savedSettings({ objectType: "Story", groupType: "Theme", phaseField: "Custom.Fas", phaseOrder: ["Tidig", "Sen"] }),
        },
        picklistFields: twoPicklists,
        workItems: [
          { id: 1, type: "Theme", fields: { "System.Title": "Ett tema" } },
          { id: 2, type: "Epic", fields: { "System.Title": "Ett epos" } },
          { id: 11, type: "Story", fields: { "System.Title": "Under tema", "Custom.Fas": "Sen", "System.Parent": 1 } },
          { id: 12, type: "Story", fields: { "System.Title": "Under epos", "Custom.Fas": "Sen", "System.Parent": 2 } },
        ],
      }),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames()).toEqual(["Tidig 0 objects", "Sen 2 objects"]);
    const [underTheme, underEpic] = cardsIn("Sen");
    expect(within(underTheme).getByText("Ett tema")).toBeTruthy();
    expect(within(underEpic).getByText("No group")).toBeTruthy();
    expect(screen.queryByText(/isn't set up/)).toBeNull();
  });

  it.each([
    ["a document that is not settings", "trasigt"],
    ["an unknown version", { ...savedSettings(), version: 99 }],
    ["a version that cannot be turned into text", { ...savedSettings(), version: { toString: 1 } }],
    ["something this version does not know", { ...savedSettings(), surprise: true }],
    ["a missing phase field", savedSettings({ phaseField: undefined })],
    ["a phase field of the wrong kind", savedSettings({ phaseField: 7 })],
    ["a setting this version does not know", savedSettings({ surprise: true })],
    ["no phase order", savedSettings({ phaseOrder: undefined })],
    ["a phase order that is not a list of names", savedSettings({ phaseOrder: ["Idéfas", 7] })],
    ["a phase listed twice", savedSettings({ phaseOrder: ["Idéfas", "Idéfas"] })],
    ["hidden groups that are not a list", savedSettings({ hiddenGroups: 1 })],
    ["empty hidden groups", savedSettings({ hiddenGroups: null })],
    ["a hidden group that is not a work item id", savedSettings({ hiddenGroups: [1, "Bodil"] })],
    ["a hidden group with an id no work item can have", savedSettings({ hiddenGroups: [0] })],
    ["a hidden group with an id too large for a work item", savedSettings({ hiddenGroups: [2 ** 31] })],
    ["a hidden group with an id that is not a whole number", savedSettings({ hiddenGroups: [1.5] })],
    ["a group hidden twice", savedSettings({ hiddenGroups: [1, 1] })],
    ["a log that is not a list", { ...savedSettings(), log: "trasig" }],
    ["a log entry without a time", { ...savedSettings(), log: [{ userId: "u", userName: "U" }] }],
    ["a log entry with a time that is no time", { ...savedSettings(), log: [{ at: "igår", userId: "u", userName: "U" }] }],
    ["a log entry with a time no date can hold", { ...savedSettings(), log: [{ at: 1e300, userId: "u", userName: "U" }] }],
  ])("says so visibly and draws no board when storage holds %s", async (_kind, document) => {
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: document } })));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("saved settings");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
    expect(screen.queryByText(/isn't set up/)).toBeNull();
  });

  it("says so visibly when the saved phase field is not a picklist field on the object's type", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: savedSettings({ phaseField: "Custom.Borta" }) } }),
      ),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("a phase field that Feature does not have");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
  });
});

describe("a large project", () => {
  const processes = (count: number) =>
    Array.from({ length: count }, (_, index) => process(100 + index, `Process ${index}`, "Idéfas", 1));

  it("says how many objects it shows of the real total when there are more than it can show", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, ...processes(3412)])));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.getByText("Showing 2,000 of 3,412. Narrow with filters or hide groups in settings.")).toBeTruthy();
    expect(cardsIn("Idéfas")).toHaveLength(2000);
    expect(columnNames()[0]).toBe("Idéfas 2,000 of 3,412 objects");
    await expectNoAccessibilityViolations();
  }, 60_000);

  it("keeps a phase whose objects were all cut from saying it has none", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([robot(1, "Bodil"), ...processes(2000), robot(2, "Zeta"), process(9001, "Sist", "Pausad", 2), process(9002, "Utan fas", undefined, 2)]),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    const columns = columnNames();
    expect(columns).toContain("Pausad 0 of 1 object");
    expect(columns.pop()).toBe("No phase 0 of 1 object");
  }, 30_000);

  it("shows all of exactly 2,000 objects without a banner", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, ...processes(2000)])));

    await screen.findByRole("region", { name: "Board" });
    expect(cardsIn("Idéfas")).toHaveLength(2000);
    expect(columnNames()[0]).toBe("Idéfas 2,000 objects");
    expect(screen.queryByText(/^Showing /)).toBeNull();
  }, 30_000);
});

describe("when the board cannot be fetched", () => {
  const unreachable = "TF400893: Unable to contact the server.";

  const expectErrorInsteadOfBoard = async () => {
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Waypoint could not load the board");
    expect(alert.textContent).toContain(unreachable);
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
    await expectNoAccessibilityViolations();
  };

  /** Lets every read through except those `fails` picks out. */
  const failingReads = (platform: FakePlatform, fails: (fields: string[], readNumber: number) => boolean): FakePlatform => {
    let reads = 0;
    return {
      ...platform,
      getWorkItemsBatch: (projectId, ids, fields) =>
        fails(fields, ++reads) ? Promise.reject(new Error(unreachable)) : platform.getWorkItemsBatch(projectId, ids, fields),
    };
  };

  it.each([
    ["the saved settings", "getSettingsDocument"],
    ["the fields of the work item type", "getPicklistFields"],
    ["the list of objects", "queryWorkItemIds"],
    ["any work item", "getWorkItemsBatch"],
  ] as const)("shows an error instead of an empty board when %s cannot be read", async (_what, method) => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)], {
          failures: { [method]: new Error(unreachable) },
        }),
      ),
    );

    await expectErrorInsteadOfBoard();
  });

  it("shows an error instead of part of the board when one batch of many cannot be read", async () => {
    const processes = Array.from({ length: 450 }, (_, index) => process(100 + index, `Process ${index}`, "Idéfas", 1));
    renderHub(failingReads(createFakePlatform(lifecycleWorld([bodil, ...processes])), (_fields, read) => read === 2));

    await expectErrorInsteadOfBoard();
  });

  it("shows an error instead of a board without groups when the parents cannot be read", async () => {
    renderHub(
      failingReads(createFakePlatform(lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)])), (fields) =>
        fields.includes("System.WorkItemType"),
      ),
    );

    await expectErrorInsteadOfBoard();
  });
});

describe("the saved phase order", () => {
  it("decides the order of the columns", async () => {
    const phaseOrder = ["Pausad", ...PHASES.filter((phase) => phase !== "Pausad")];
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: savedSettings({ phaseOrder }) } })));

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames()).toEqual(phaseOrder.map((phase) => `${phase} 0 objects`));
  });

  it("puts picklist values added since it was saved last, marked as new", async () => {
    const phaseOrder = PHASES.filter((phase) => phase !== "Idéfas" && phase !== "Avfärdad").reverse();
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: savedSettings({ phaseOrder }) } })));

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames()).toEqual([
      ...phaseOrder.map((phase) => `${phase} 0 objects`),
      "Idéfas (new) 0 objects",
      "Avfärdad (new) 0 objects",
    ]);
  });

  it("drops a value the picklist no longer has", async () => {
    const phaseOrder = ["Borttagen", ...PHASES];
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: savedSettings({ phaseOrder }) } })));

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames()).toEqual(PHASES.map((phase) => `${phase} 0 objects`));
  });

  it("still shows objects that are left in a value the picklist no longer has", async () => {
    const phaseOrder = ["Borttagen", ...PHASES];
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, process(11, "Kvar", "Borttagen", 1)], { projectId: "p", savedSettings: { p: savedSettings({ phaseOrder }) } }),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames().pop()).toBe("Borttagen (not in the picklist) 1 object");
  });
});

describe("the phase board", () => {
  it("shows every phase as a column in picklist order, with the number of objects in the heading", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([
          bodil,
          process(11, "PROCESS_101.Bodil.Arkivera", "Pausad", 1),
          process(12, "PROCESS_101.Bodil.HamtaUnderlag", "Idéfas", 1),
          process(13, "PROCESS_101.Bodil.KontrolleraUppgifter", "Idéfas", 1),
        ]),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames()).toEqual(
      PHASES.map((phase) => `${phase} ${{ Idéfas: "2 objects", Pausad: "1 object" }[phase] ?? "0 objects"}`),
    );
    await expectNoAccessibilityViolations();
  });

  it("gives each card the title exactly as it stands and the group's name and color", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([
          bodil,
          cassius,
          process(11, "  PROCESS_101.Bodil.Arkivera ", "Idéfas", 1),
          process(12, "beskrivande rubrik utan namn", "Pausad", 1),
          process(13, "PROCESS_103.Cassius.Arkivera", "Idéfas", 2),
        ]),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    const [first, other] = cardsIn("Idéfas");
    const [sameGroup] = cardsIn("Pausad");
    expect(within(first).getByText("PROCESS_101.Bodil.Arkivera", { normalizer: (text) => text.trim() }).textContent).toBe(
      "  PROCESS_101.Bodil.Arkivera ",
    );
    expect(within(first).getByText("PROCESS_101.Bodil")).toBeTruthy();
    expect(within(other).getByText("PROCESS_103.Cassius")).toBeTruthy();
    expect(first.style.borderLeftColor).not.toBe("");
    expect(sameGroup.style.borderLeftColor).toBe(first.style.borderLeftColor);
    expect(other.style.borderLeftColor).not.toBe(first.style.borderLeftColor);
    await expectNoAccessibilityViolations();
  });

  it("shows an object without a parent as having no group", async () => {
    renderHub(createFakePlatform(lifecycleWorld([process(11, "Föräldralös", "Idéfas")])));

    await screen.findByRole("region", { name: "Board" });
    const [card] = cardsIn("Idéfas");
    expect(within(card).getByText("Föräldralös")).toBeTruthy();
    expect(within(card).getByText("No group")).toBeTruthy();
  });

  it("shows an object whose parent cannot be read or has the wrong type as having no group", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([
          { id: 5, type: "Task", fields: { "System.Title": "En uppgift" } },
          process(11, "Förälder raderad", "Idéfas", 999),
          process(12, "Förälder av fel typ", "Idéfas", 5),
        ]),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    const cards = cardsIn("Idéfas");
    expect(cards.map((card) => within(card).queryByText("No group") !== null)).toEqual([true, true]);
    expect(screen.queryByText("En uppgift")).toBeNull();
  });

  it("keeps objects with an empty phase field in their own column, last", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, process(11, "Utan fas", undefined, 1)])));

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames().pop()).toBe("No phase 1 object");
    expect(within(cardsIn("No phase")[0]).getByText("Utan fas")).toBeTruthy();
  });

  it("has no column for an empty phase field when every object has a phase", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, process(11, "Med fas", "Idéfas", 1)])));

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames()).toHaveLength(PHASES.length);
  });

  it("keeps objects whose phase is no longer in the picklist visible, in a marked column after the others", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, process(11, "Gammal", "Nedlagd", 1)])));

    await screen.findByRole("region", { name: "Board" });
    expect(columnNames().pop()).toBe("Nedlagd (not in the picklist) 1 object");
    expect(within(cardsIn("Nedlagd")[0]).getByText("Gammal")).toBeTruthy();
  });

  it("reads every object even when there are more than one batch can hold", async () => {
    const processes = Array.from({ length: 450 }, (_, index) => process(100 + index, `Process ${index}`, "Idéfas", 1));
    renderHub(createFakePlatform(lifecycleWorld([bodil, ...processes])));

    await screen.findByRole("region", { name: "Board" });
    expect(cardsIn("Idéfas")).toHaveLength(450);
  });

  it("renders free text as text, never as HTML", async () => {
    const injected = (name: string) => `<img src=x onerror="window.__hacked='${name}'"><b>${name}</b>`;
    renderHub(
      createFakePlatform({
        picklistFields: {
          Feature: [{ referenceName: "Custom.Fas", name: injected("field"), values: [injected("phase")] }],
        },
        workItems: [
          { id: 1, type: "Epic", fields: { "System.Title": injected("group") } },
          {
            id: 11,
            type: "Feature",
            fields: { "System.Title": injected("title"), "Custom.Fas": injected("phase"), "System.Parent": 1 },
          },
        ],
      }),
    );

    await screen.findByRole("region", { name: "Board" });
    for (const name of ["group", "title", "phase"]) {
      expect(document.body.textContent).toContain(injected(name));
    }
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("the group list", () => {
  it("sits above the board and shows every group in name order, also one without objects", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([
          cassius,
          bodil,
          robot(3, "Ännu tom"),
          { id: 5, type: "Task", fields: { "System.Title": "En uppgift" } },
          process(11, "En process", "Idéfas", 2),
          process(12, "Under uppgift", "Idéfas", 5),
          process(13, "Föräldralös", "Idéfas"),
        ]),
      ),
    );

    const board = await screen.findByRole("region", { name: "Board" });
    expect(groupNames()).toEqual(["PROCESS_101.Bodil", "PROCESS_103.Cassius", "Ännu tom"]);
    expect(screen.getByRole("list", { name: "Groups" }).compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expectNoAccessibilityViolations();
  });

  it("is not there when the project has no groups", async () => {
    renderHub(createFakePlatform(lifecycleWorld([process(11, "Föräldralös", "Idéfas")])));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.queryByRole("list", { name: "Groups" })).toBeNull();
  });

  it("includes a group that only an object's parent link leads to", async () => {
    const fake = createFakePlatform(lifecycleWorld([bodil, cassius, process(11, "En process", "Idéfas", 2)]));
    const platform: FakePlatform = {
      ...fake,
      queryWorkItemIds: async (id, type) => (await fake.queryWorkItemIds(id, type)).filter((itemId) => itemId !== 2),
    };
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(groupNames()).toEqual(["PROCESS_101.Bodil", "PROCESS_103.Cassius"]);
  });

  it("reads every group even when there are more than one batch can hold", async () => {
    const robots = Array.from({ length: 450 }, (_, index) => robot(1000 + index, `Robot ${index}`));
    renderHub(createFakePlatform(lifecycleWorld(robots)));

    await screen.findByRole("region", { name: "Board" });
    expect(groupNames()).toHaveLength(450);
  });

  it("shows an error instead of a board when the groups cannot be listed", async () => {
    const fake = createFakePlatform(lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)]));
    const platform: FakePlatform = {
      ...fake,
      queryWorkItemIds: (id, type) => (type === "Epic" ? Promise.reject(new Error("TF400893: Unable to contact the server.")) : fake.queryWorkItemIds(id, type)),
    };
    renderHub(platform);

    expect((await screen.findByRole("alert")).textContent).toContain("TF400893");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
  });
});

describe("dimming through the group list", () => {
  const world = () =>
    lifecycleWorld([
      bodil,
      cassius,
      process(11, "Bodils i idéfas", "Idéfas", 1),
      process(12, "Bodils pausade", "Pausad", 1),
      process(13, "Cassius'", "Idéfas", 2),
      process(14, "Föräldralös", "Idéfas"),
    ]);

  const opened = async () => {
    renderHub(createFakePlatform(world()));
    await screen.findByRole("region", { name: "Board" });
    return { bodilItem: groupItem("PROCESS_101.Bodil"), cassiusItem: groupItem("PROCESS_103.Cassius") };
  };

  const groupItem = (name: string) => within(screen.getByRole("list", { name: "Groups" })).getByText(name);

  /** The titles of the cards as they now look, split by whether they are dimmed. */
  const cards = () => {
    const all = within(screen.getByRole("region", { name: "Board" })).getAllByRole("listitem");
    const titles = (list: HTMLElement[]) => list.map((card) => card.querySelector(".waypoint-card-title")?.textContent).sort();
    const isDimmed = (card: HTMLElement) => card.classList.contains("waypoint-card-dimmed");
    return { dimmed: titles(all.filter(isDimmed)), lit: titles(all.filter((card) => !isDimmed(card))) };
  };

  const ALL = ["Bodils i idéfas", "Bodils pausade", "Cassius'", "Föräldralös"];
  const BODIL_LIT = { dimmed: ["Cassius'", "Föräldralös"], lit: ["Bodils i idéfas", "Bodils pausade"] };
  const CASSIUS_LIT = { dimmed: ["Bodils i idéfas", "Bodils pausade", "Föräldralös"], lit: ["Cassius'"] };
  const NOTHING_DIMMED = { dimmed: [], lit: ALL };

  it("dims nothing until a group is pointed at or focused", async () => {
    await opened();

    expect(cards()).toEqual(NOTHING_DIMMED);
  });

  it("dims every other group's cards, in every phase, while the pointer is on a group", async () => {
    const { bodilItem } = await opened();

    fireEvent.mouseEnter(bodilItem);
    expect(cards()).toEqual(BODIL_LIT);
    await expectNoAccessibilityViolations();

    fireEvent.mouseLeave(bodilItem);
    expect(cards()).toEqual(NOTHING_DIMMED);
  });

  it("dims every other group's cards while keyboard focus is on a group", async () => {
    const { cassiusItem } = await opened();

    act(() => cassiusItem.focus());
    expect(document.activeElement).toBe(cassiusItem);
    expect(cards()).toEqual(CASSIUS_LIT);

    act(() => cassiusItem.blur());
    expect(cards()).toEqual(NOTHING_DIMMED);
  });

  it("follows the pointer while it is on a group, and goes back to the focused group when it leaves", async () => {
    const { bodilItem, cassiusItem } = await opened();
    act(() => cassiusItem.focus());

    fireEvent.mouseEnter(bodilItem);
    expect(cards()).toEqual(BODIL_LIT);

    fireEvent.mouseLeave(bodilItem);
    expect(cards()).toEqual(CASSIUS_LIT);
  });

  it("marks the group's own cards in a way that is not only the dimming of the others", async () => {
    const { bodilItem } = await opened();
    const marked = () =>
      within(screen.getByRole("region", { name: "Board" }))
        .getAllByRole("listitem")
        .filter((card) => card.getAttribute("aria-current") === "true")
        .map((card) => card.querySelector(".waypoint-card-title")?.textContent)
        .sort();
    expect(marked()).toEqual([]);

    fireEvent.mouseEnter(bodilItem);

    expect(marked()).toEqual(BODIL_LIT.lit);
  });

  it("starts over with nothing dimmed when the board is loaded again after a save", async () => {
    renderHub(createFakePlatform({ ...world(), projectId: "p", isAdministrator: true, savedSettings: { p: savedSettings() } }));
    await screen.findByRole("region", { name: "Board" });
    const item = groupItem("PROCESS_101.Bodil");
    act(() => item.focus());
    expect(cards()).toEqual(BODIL_LIT);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settings = await screen.findByRole("main", { name: "Waypoint settings" });
    fireEvent.click(await within(settings).findByRole("button", { name: "Save" }));

    await waitFor(() => expect(cards()).toEqual(NOTHING_DIMMED));
  });
});

describe("reading many objects", () => {
  it("asks for no more batches once one has failed", async () => {
    const processes = Array.from({ length: 2_000 }, (_, index) => process(100 + index, `Process ${index}`, "Idéfas", 1));
    const platform = createFakePlatform(lifecycleWorld([bodil, ...processes]));
    let asked = 0;
    platform.getWorkItemsBatch = async () => {
      asked += 1;
      throw new Error("TF400733: Too many requests.");
    };
    renderHub(platform);

    expect((await screen.findByRole("alert")).textContent).toContain("Too many requests");
    expect(asked).toBeLessThanOrEqual(6);
  });

  it("asks a few batches at a time, and gets them all", async () => {
    const processes = Array.from({ length: 2_000 }, (_, index) => process(100 + index, `Process ${index}`, "Idéfas", 1));
    const platform = createFakePlatform(lifecycleWorld([bodil, ...processes]));
    const read = platform.getWorkItemsBatch;
    let reading = 0;
    let most = 0;
    platform.getWorkItemsBatch = async (...args) => {
      most = Math.max(most, ++reading);
      await new Promise((resolve) => setTimeout(resolve));
      const answer = await read(...args);
      reading -= 1;
      return answer;
    };
    renderHub(platform);

    await screen.findByRole("region", { name: "Board" });
    expect(cardsIn("Idéfas")).toHaveLength(2_000);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(6);
  });
});

describe("hidden groups", () => {
  const ovrigt = robot(3, "Övrigt");
  const saved = (hiddenGroups: number[]) => ({ projectId: "p", savedSettings: { p: savedSettings({ hiddenGroups }) } });

  it("are neither in the group list nor on the board, and neither are their objects", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld(
          [bodil, ovrigt, process(11, "Synlig", "Idéfas", 1), process(12, "Mall", "Idéfas", 3), process(13, "Gammal mall", "Nedlagd", 3), process(14, "Mall utan fas", undefined, 3)],
          saved([3]),
        ),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(groupNames()).toEqual(["PROCESS_101.Bodil"]);
    expect(columnNames()).toEqual(PHASES.map((phase) => `${phase} ${phase === "Idéfas" ? "1 object" : "0 objects"}`));
    for (const hidden of ["Övrigt", "Mall", "Gammal mall", "Mall utan fas"]) expect(screen.queryByText(hidden)).toBeNull();
    await expectNoAccessibilityViolations();
  });

  it("make room for an object beyond the first 2,000, and take the banner with them when all the rest fit", async () => {
    const many = Array.from({ length: 2100 }, (_, index) => process(100 + index, `Process ${index}`, "Idéfas", 1));
    renderHub(createFakePlatform(lifecycleWorld([bodil, robot(2, "Zeta"), ...many, process(9001, "Bortom gränsen", "Pausad", 2)], saved([1]))));

    await screen.findByRole("region", { name: "Board" });
    expect(within(cardsIn("Pausad")[0]).getByText("Bortom gränsen")).toBeTruthy();
    expect(cardsIn("Idéfas")).toHaveLength(0);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  }, 30_000);

  it("do not count in the banner's total", async () => {
    const many = (first: number, count: number, parent: number) =>
      Array.from({ length: count }, (_, index) => process(first + index, `Process ${first + index}`, "Idéfas", parent));
    renderHub(createFakePlatform(lifecycleWorld([bodil, robot(2, "Zeta"), ...many(100, 50, 1), ...many(1000, 2003, 2)], saved([1]))));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.getByText("Showing 2,000 of 2,003. Narrow with filters or hide groups in settings.")).toBeTruthy();
    expect(columnNames()[0]).toBe("Idéfas 2,000 of 2,003 objects");
  }, 60_000);

  it("are none in settings saved before there were any to hide", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, process(11, "Synlig", "Idéfas", 1)], { projectId: "p", savedSettings: { p: savedSettings() } })));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.getByText("Synlig")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a card's roles", () => {
  /** A process with the given fields filled in, in a project whose settings point the roles at our fields. */
  const onOurCard = (fields: Record<string, unknown>, roles: Record<string, unknown> = OUR_ROLES) => {
    const processWithFields = process(11, "PROCESS_101.Bodil.Arkivera", "Idéfas", 1);
    processWithFields.fields = { ...processWithFields.fields, ...fields };
    return createFakePlatform(lifecycleWorld([bodil, processWithFields], { projectId: "p", savedSettings: { p: savedSettings({ roles }) } }));
  };

  const card = async () => {
    await screen.findByRole("region", { name: "Board" });
    return cardsIn("Idéfas")[0];
  };

  it("shows the current situation as plain text, whatever HTML the field holds", async () => {
    renderHub(onOurCard({ [AKTUELLT_LAGE.referenceName]: "<div>Körs nattetid.&nbsp;</div><div>Nästa steg: <b>test</b>.</div>" }));

    expect(within(await card()).getByText("Körs nattetid. Nästa steg: test.")).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    await expectNoAccessibilityViolations();
  });

  it("leaves out a current situation that is empty once the HTML is gone", async () => {
    renderHub(onOurCard({ [AKTUELLT_LAGE.referenceName]: "<div><br></div>" }));

    const button = within(await card()).getByRole("button");
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(button.textContent).not.toContain("<");
  });

  it("works with no role pointed at a field", async () => {
    renderHub(onOurCard({ [AKTUELLT_LAGE.referenceName]: "Syns inte", [VANTAR_PA.referenceName]: "Juridik", [FORBATTRING_PAGAR.referenceName]: true }, {}));

    const shown = await card();
    expect(within(shown).getByText("PROCESS_101.Bodil.Arkivera")).toBeTruthy();
    expect(shown.textContent).not.toMatch(/Syns inte|Juridik|Förbättring|aiting/);
  });

  it("marks a card that waits in words, beside the yellow, when the field is filled in", async () => {
    renderHub(onOurCard({ [VANTAR_PA.referenceName]: "Inköp & juridik" }));

    const shown = await card();
    expect(within(shown).getByText("Inköp & juridik")).toBeTruthy();
    expect(within(shown).getByText("Waiting on:").textContent).toBe("Waiting on: Inköp & juridik");
    await expectNoAccessibilityViolations();
  });

  it.each([
    ["empty", undefined],
    ["only spaces", "   "],
  ])("does not mark a card as waiting when the field is %s", async (_kind, value) => {
    renderHub(onOurCard({ [VANTAR_PA.referenceName]: value }));

    expect(within(await card()).queryByText("Waiting on:")).toBeNull();
  });

  it("shows the marker as a label with the field's name when the value is yes", async () => {
    renderHub(onOurCard({ [FORBATTRING_PAGAR.referenceName]: true }));

    expect(within(await card()).getByText("Förbättring pågår")).toBeTruthy();
  });

  it("shows no marker label when the value is no", async () => {
    renderHub(onOurCard({ [FORBATTRING_PAGAR.referenceName]: false }));

    expect(within(await card()).queryByText("Förbättring pågår")).toBeNull();
  });

  it("names the card with its title, phase, group and that it waits", async () => {
    renderHub(onOurCard({ [VANTAR_PA.referenceName]: "Juridik" }));

    const button = within(await card()).getByRole("button");
    expect(screen.getByRole("button", { name: "PROCESS_101.Bodil.Arkivera, PROCESS_101.Bodil, Waiting on: Juridik, phase Idéfas" })).toBe(button);
  });

  it("names the marker with the rest, and keeps a long current situation out of the name, as its description", async () => {
    const long = "Mycket lång beskrivning. ".repeat(20).trim();
    renderHub(onOurCard({ [FORBATTRING_PAGAR.referenceName]: true, [AKTUELLT_LAGE.referenceName]: long }));

    const button = within(await card()).getByRole("button");
    expect(screen.getByRole("button", { name: "PROCESS_101.Bodil.Arkivera, PROCESS_101.Bodil, Förbättring pågår, phase Idéfas, not waiting" })).toBe(button);
    expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(long);
    expect(button.textContent).not.toContain(long);
    await expectNoAccessibilityViolations();
  });

  it("says in the card's name that it does not wait, when the role is pointed at a field", async () => {
    renderHub(onOurCard({}));

    await card();
    expect(screen.getByRole("button", { name: "PROCESS_101.Bodil.Arkivera, PROCESS_101.Bodil, phase Idéfas, not waiting" })).toBeTruthy();
  });

  it("says nothing in the card's name about waiting when no role is pointed at a field", async () => {
    renderHub(onOurCard({}, {}));

    await card();
    expect(screen.getByRole("button", { name: "PROCESS_101.Bodil.Arkivera, PROCESS_101.Bodil, phase Idéfas" })).toBeTruthy();
  });

  it("renders the fields as text, never as HTML", async () => {
    const injected = '<img src=x onerror="window.__hacked=1"><b>fet</b>';
    renderHub(onOurCard({ [AKTUELLT_LAGE.referenceName]: `&lt;img src=x onerror="window.__hacked=1"&gt;`, [VANTAR_PA.referenceName]: injected }));

    expect((await card()).textContent).toContain(injected);
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("the detail panel", () => {
  const arkivering = (fields: Record<string, unknown> = {}) => {
    const item = process(11, "PROCESS_101.Bodil.Arkivera", "Idéfas", 1);
    item.fields = { ...item.fields, ...fields };
    return item;
  };

  const opened = async (world: Parameters<typeof lifecycleWorld>[1], fields: Record<string, unknown> = {}) => {
    const platform = createFakePlatform(lifecycleWorld([bodil, arkivering(fields)], { projectId: "p", ...world }));
    renderHub(platform);
    await screen.findByRole("region", { name: "Board" });
    fireEvent.click(within(cardsIn("Idéfas")[0]).getByRole("button"));
    return { platform, panel: await screen.findByRole("dialog") };
  };

  const shownFields = (panel: HTMLElement) =>
    [...panel.querySelectorAll("dt")].map((term) => [term.textContent, term.nextElementSibling?.textContent]);

  it("opens on a click and shows the object with the chosen fields, in the chosen order, as text", async () => {
    const { panel } = await opened(
      {
        savedSettings: {
          p: savedSettings({
            roles: OUR_ROLES,
            detailFields: [GKL.referenceName, ASSIGNED_TO.referenceName, FORBATTRING_PAGAR.referenceName, AKTUELLT_LAGE.referenceName, VANTAR_PA.referenceName],
          }),
        },
      },
      {
        [GKL.referenceName]: "14.1.0",
        [ASSIGNED_TO.referenceName]: { displayName: "Ada Admin", uniqueName: "ada@example.test" },
        [FORBATTRING_PAGAR.referenceName]: false,
        [AKTUELLT_LAGE.referenceName]: "<div>Första raden</div><div>Andra raden</div>",
      },
    );

    expect(within(panel).getByRole("heading", { name: "PROCESS_101.Bodil.Arkivera" })).toBeTruthy();
    expect(shownFields(panel)).toEqual([
      ["GKL", "14.1.0"],
      ["Assigned To", "Ada Admin"],
      ["Förbättring pågår", "No"],
      ["Aktuellt läge", "Första raden\nAndra raden"],
      ["Väntar på", "Not filled in"],
    ]);
    await expectNoAccessibilityViolations();
  });

  it("shows the card's fields until other fields are chosen", async () => {
    const { panel } = await opened({ savedSettings: { p: savedSettings({ roles: OUR_ROLES }) } }, { [VANTAR_PA.referenceName]: "Juridik" });

    expect(shownFields(panel)).toEqual([
      ["Aktuellt läge", "Not filled in"],
      ["Väntar på", "Juridik"],
      ["Förbättring pågår", "Not filled in"],
    ]);
  });

  it("can hold a field that is not on the card, such as a date", async () => {
    const { panel } = await opened(
      { savedSettings: { p: savedSettings({ detailFields: [CREATED_DATE.referenceName] }) } },
      { [CREATED_DATE.referenceName]: "2026-11-05T07:11:24.09Z" },
    );

    expect(shownFields(panel)).toEqual([["Created Date", new Date("2026-11-05T07:11:24.09Z").toLocaleString()]]);
  });

  it("can hold the phase field like any other field", async () => {
    const { panel } = await opened({ savedSettings: { p: savedSettings({ detailFields: [PHASE_FIELD] }) } });

    expect(shownFields(panel)).toEqual([["Livscykel", "Idéfas"]]);
  });

  it.each([
    ["nothing is set up", savedSettings()],
    ["the saved list is empty", savedSettings({ roles: OUR_ROLES, detailFields: [] })],
  ])("shows only the title and the way to the work item when %s", async (_case, saved) => {
    const { panel } = await opened({ savedSettings: { p: saved } });

    expect(within(panel).getByRole("heading", { name: "PROCESS_101.Bodil.Arkivera" })).toBeTruthy();
    expect(shownFields(panel)).toEqual([]);
    expect(within(panel).getByRole("button", { name: "Open work item" })).toBeTruthy();
    await expectNoAccessibilityViolations();
  });

  it("opens the work item in Azure DevOps", async () => {
    const { platform, panel } = await opened({});

    fireEvent.click(within(panel).getByRole("button", { name: "Open work item" }));

    await waitFor(() => expect(platform.openedWorkItems).toEqual([11]));
    expect(within(panel).queryByRole("alert")).toBeNull();
  });

  it("takes the focus back when the work item closes, so the keyboard stays in the panel", async () => {
    const { platform, panel } = await opened({});
    const button = within(panel).getByRole("button", { name: "Open work item" });

    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(platform.openedWorkItems).toEqual([11]));
    await waitFor(() => expect(document.activeElement).toBe(button));
    fireEvent.keyDown(button, { key: "Escape", keyCode: 27, which: 27 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says so visibly when the work item cannot be opened", async () => {
    const { panel } = await opened({ failures: { openWorkItem: new Error("The host refused.") } });

    fireEvent.click(within(panel).getByRole("button", { name: "Open work item" }));

    expect((await within(panel).findByRole("alert")).textContent).toContain("could not open the work item: The host refused.");
  });

  it("closes and gives the focus back to the card", async () => {
    const { panel } = await opened({});
    const card = within(cardsIn("Idéfas")[0]).getByRole("button");

    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(card);
  });

  it.each(["Close", "Open work item"])("closes on Escape with the focus on its %s button, and gives the focus back to the card", async (name) => {
    const { panel } = await opened({});
    const card = within(cardsIn("Idéfas")[0]).getByRole("button");

    const button = within(panel).getByRole("button", { name });
    button.focus();
    fireEvent.keyDown(button, { key: "Escape", keyCode: 27, which: 27 });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(card);
  });

  it("renders the fields as text, never as HTML", async () => {
    const injected = '<img src=x onerror="window.__hacked=1"><b>fet</b>';
    const { panel } = await opened(
      { savedSettings: { p: savedSettings({ detailFields: [GKL.referenceName] }) } },
      { "System.Title": injected, [GKL.referenceName]: injected },
    );

    expect(panel.textContent).toContain(injected);
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("settings that name a field the object's type does not have", () => {
  const world = (roles: Record<string, unknown>, detailFields?: string[]) =>
    lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)], {
      projectId: "p",
      savedSettings: { p: savedSettings({ roles, ...(detailFields && { detailFields }) }) },
    });

  it("say so visibly, and the board still shows without it instead of failing for everyone", async () => {
    renderHub(createFakePlatform(world({ waitingOn: "Custom.Borta" }, ["Custom.OcksaBorta"])));

    await screen.findByRole("region", { name: "Board" });
    const warning = screen.getByText(/no longer has/);
    expect(warning.textContent).toContain("2 fields");
    expect(warning.textContent).toContain("A Project Administrator");
    await expectNoAccessibilityViolations();
  });

  it("count a marker pointed at something that is not a yes or a no among them", async () => {
    renderHub(createFakePlatform(world({ marker: VANTAR_PA.referenceName })));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.getByText(/no longer has/).textContent).toContain("1 field");
  });
});

describe("damaged settings for the card", () => {
  it.each([
    ["roles that are not a record", savedSettings({ roles: "trasig" })],
    ["a role this version does not know", savedSettings({ roles: { surprise: "Custom.VantarPa" } })],
    ["a role that names no field", savedSettings({ roles: { waitingOn: 7 } })],
    ["detail fields that are not a list of names", savedSettings({ detailFields: ["Custom.GKL", 7] })],
    ["a detail field listed twice", savedSettings({ detailFields: ["Custom.GKL", "Custom.GKL"] })],
  ])("say so visibly and draw no board when storage holds %s", async (_kind, document) => {
    renderHub(createFakePlatform(lifecycleWorld([bodil], { projectId: "p", savedSettings: { p: document } })));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("saved settings");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
  });
});

describe("hidden groups", () => {
  it("says so when they leave nothing on the board, so that an empty board is not taken for the truth", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, cassius, process(11, "En process", "Idéfas", 1), process(12, "En annan", "Pausad", 2)], {
          savedSettings: { "project-1": savedSettings({ hiddenGroups: [1, 2] }) },
        }),
      ),
    );

    expect((await screen.findByText(/Every object is in a group hidden in Waypoint's settings/)).textContent).toContain("A Project Administrator can change this");
    await expectNoAccessibilityViolations();
  });

  it("says nothing while any object is left", async () => {
    renderHub(
      createFakePlatform(
        lifecycleWorld([bodil, cassius, process(11, "En process", "Idéfas", 1), process(12, "En annan", "Pausad", 2)], {
          savedSettings: { "project-1": savedSettings({ hiddenGroups: [1] }) },
        }),
      ),
    );

    await screen.findByRole("region", { name: "Board" });
    expect(screen.queryByText(/hidden in Waypoint's settings/)).toBeNull();
  });
});

describe("a phase without cards", () => {
  it("has its heading and no empty list, which a screen reader would announce as a list of nothing", async () => {
    renderHub(createFakePlatform(lifecycleWorld([bodil, process(11, "En process", "Idéfas", 1)])));

    await screen.findByRole("region", { name: "Board" });
    expect(screen.getByRole("heading", { name: /^Pausad/ })).toBeTruthy();
    expect(screen.queryByRole("list", { name: /^Pausad/ })).toBeNull();
  });
});
