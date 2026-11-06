import { describe, expect, it } from "vitest";
import type { FieldKind, WorkItem } from "../platform/platform";
import { NO_CARD_FIELDS, arrangeTabs, phasesInPicklistOrder, type FilterField } from "../settings/settings";
import { PHASE_FIELD } from "../testing/lifecycleWorld";
import { fastestOfThreeGoes, timeOf } from "../testing/timing";
import { NO_FILTER, buildBoard, offeredFilterFields, tagOptions, type BoardFilter, type BoardFilterField } from "./boardModel";

function group(id: number, title: string, type = "Epic"): WorkItem {
  return { id, fields: { "System.Title": title, "System.WorkItemType": type } };
}

/** `count` objects with consecutive ids from `firstId`, all under the same parent. */
function objects(firstId: number, count: number, parent?: number): WorkItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    fields: { "System.Title": `Objekt ${firstId + index}`, [PHASE_FIELD]: "Idéfas", "System.Parent": parent },
  }));
}

function board(allObjects: WorkItem[], parents: WorkItem[], hiddenGroups: number[] = [], filter: BoardFilter = NO_FILTER) {
  return buildBoard({ phaseField: PHASE_FIELD, tabs: arrangeTabs(undefined, phasesInPicklistOrder(["Idéfas"])), hiddenGroups, groupType: "Epic", filterFields: [], cardFields: NO_CARD_FIELDS, objects: allObjects, parents }, filter);
}

const shownIds = (built: ReturnType<typeof board>) => built.tabs[0].columns.flatMap((column) => column.cards.map((card) => card.id));

describe("a board of 2,000 objects", () => {
  // Times buildBoard alone. The tests of tabs and filter measure the whole way to the changed DOM.
  it("is built without noticeable delay", () => {
    const parents = Array.from({ length: 100 }, (_, index) => group(9000 + index, `Grupp ${99 - index}`));
    const allObjects = Array.from({ length: 2000 }, (_, index) => objects(index + 1, 1, 9000 + (index % 100))[0]);

    const [elapsed] = fastestOfThreeGoes(() => [timeOf(() => board(allObjects, parents))]);

    expect(shownIds(board(allObjects, parents))).toHaveLength(2000);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("the cut at 2,000 objects", () => {
  it("keeps the objects of the groups that sort first, whatever order they were fetched in", () => {
    const built = board([...objects(1, 2000, 900), ...objects(5001, 5, 901)], [group(900, "Cassius"), group(901, "Bodil")]);

    const shown = shownIds(built);
    expect(shown).toHaveLength(2000);
    expect(shown.slice(0, 5)).toEqual([5001, 5002, 5003, 5004, 5005]);
    expect(shown).toContain(1995);
    expect(shown).not.toContain(1996);
    expect(built.truncation).toEqual({ shown: 2000, total: 2005 });
  });

  it("cuts objects without a group first, and counts a parent of the wrong type as no group", () => {
    const withoutParent = objects(1, 2);
    const underWrongType = objects(11, 2, 902);
    const built = board(
      [...withoutParent, ...underWrongType, ...objects(1001, 1998, 900)],
      [group(900, "Zeta"), group(902, "Bodil", "Task")],
    );

    const shown = shownIds(built);
    expect(shown).toHaveLength(2000);
    expect(shown.slice(-2)).toEqual([1, 2]);
    expect(shown).not.toContain(11);
    expect(shown).not.toContain(12);
    expect(built.truncation).toEqual({ shown: 2000, total: 2002 });
  });

  it("orders groups by name in fixed Swedish order, ignoring case, and keeps same-named groups apart", () => {
    const built = board(
      [
        ...objects(1, 2, 903),
        ...objects(11, 2, 902),
        ...objects(21, 2, 901),
        ...objects(31, 2, 900),
        ...objects(41, 2, 904),
        ...objects(51, 2, 905),
        ...objects(61, 2, 906),
      ],
      [
        group(900, "Övrigt"),
        group(901, "PROCESS_102"),
        group(902, "process_101"),
        group(903, "PROCESS_102"),
        group(904, "Zeta"),
        group(905, "Ärenden"),
        group(906, "Åtgärder"),
      ],
    );

    // Å, Ä and Ö come after Z, in that order. Most other languages would put them with A and O.
    expect(shownIds(built)).toEqual([11, 12, 21, 22, 1, 2, 41, 42, 61, 62, 51, 52, 31, 32]);
  });

  it("counts every object of a phase, also those it cut, and keeps a column whose objects were all cut", () => {
    const inPhase = (phase: string | undefined, id: number, parent: number): WorkItem => ({
      id,
      fields: { "System.Title": `Objekt ${id}`, [PHASE_FIELD]: phase, "System.Parent": parent },
    });
    const built = buildBoard({
      phaseField: PHASE_FIELD,
      tabs: arrangeTabs(undefined, phasesInPicklistOrder(["Idéfas", "Pausad"])),
      hiddenGroups: [],
      groupType: "Epic",
      filterFields: [],
      cardFields: NO_CARD_FIELDS,
      objects: [
        ...objects(1, 2000, 900),
        inPhase("Idéfas", 3001, 901),
        inPhase("Pausad", 3002, 901),
        inPhase("Nedlagd", 3003, 901),
        inPhase(undefined, 3004, 901),
      ],
      parents: [group(900, "Bodil"), group(901, "Zeta")],
    }, NO_FILTER);

    expect(built.tabs[0].columns.map((column) => [column.kind, column.cards.length, column.total])).toEqual([
      ["picklist", 2000, 2001],
      ["picklist", 0, 1],
      ["unlisted", 0, 1],
      ["without-phase", 0, 1],
    ]);
  });

  it("does not cut, and says nothing, at exactly 2,000 objects", () => {
    const built = board(objects(1, 2000, 900), [group(900, "Bodil")]);

    expect(shownIds(built)).toHaveLength(2000);
    expect(built.truncation).toBeNull();
  });
});

describe("hidden groups", () => {
  it("are chosen before the cut, so that an object beyond 2,000 can be reached by hiding what comes before it", () => {
    const built = board([...objects(1, 2500, 900), ...objects(5001, 2, 901)], [group(900, "Bodil"), group(901, "Zeta")], [900]);

    expect(shownIds(built)).toEqual([5001, 5002]);
    expect(built.truncation).toBeNull();
  });

  it("do not count towards the total when what is left is still cut", () => {
    const built = board([...objects(1, 10, 900), ...objects(101, 2003, 901)], [group(900, "Bodil"), group(901, "Zeta")], [900]);

    expect(shownIds(built)).toHaveLength(2000);
    expect(built.truncation).toEqual({ shown: 2000, total: 2003 });
    expect(built.tabs[0].columns[0].total).toBe(2003);
  });

  it("are left out of the group list, and leave no trace in the columns", () => {
    const inPhase = (phase: string | undefined, id: number): WorkItem => ({
      id,
      fields: { "System.Title": `Objekt ${id}`, [PHASE_FIELD]: phase, "System.Parent": 900 },
    });
    const built = board([inPhase("Nedlagd", 1), inPhase(undefined, 2), inPhase("Idéfas", 3)], [group(900, "Bodil"), group(901, "Zeta")], [900]);

    expect(built.groups.map(({ name }) => name)).toEqual(["Zeta"]);
    expect(built.tabs[0].columns.map((column) => [column.kind, column.total])).toEqual([["picklist", 0]]);
  });

  it("do not hide an object whose parent is of the wrong type, which has no group to hide", () => {
    const built = board(objects(1, 1, 902), [group(902, "Bodil", "Task")], [902]);

    expect(shownIds(built)).toEqual([1]);
    expect(built.tabs[0].columns[0].cards[0].group).toBeNull();
  });

  it("change nothing when they name a group that no longer exists", () => {
    const built = board(objects(1, 2, 900), [group(900, "Bodil")], [999]);

    expect(shownIds(built)).toEqual([1, 2]);
    expect(built.groups.map(({ name }) => name)).toEqual(["Bodil"]);
  });
});

describe("the filter", () => {
  const parents = [group(900, "Bodil"), group(901, "Zeta")];
  const filtered = (filter: BoardFilter, hiddenGroups: number[] = []) =>
    board([...objects(1, 2500, 900), ...objects(5001, 2, 901), ...objects(6001, 1)], parents, hiddenGroups, filter);

  it("is applied before the cut, so that an object beyond 2,000 can be reached by keyword", () => {
    const built = filtered({ keyword: "objekt 5002", groups: [], filterFields: [] });

    expect(shownIds(built)).toEqual([5002]);
    expect(built.truncation).toBeNull();
  });

  it("is applied before the cut, so that an object beyond 2,000 can be reached by group", () => {
    const built = filtered({ keyword: "", groups: [901], filterFields: [] });

    expect(shownIds(built)).toEqual([5001, 5002]);
    expect(built.truncation).toBeNull();
  });

  it("counts what is left in the banner and the column when that too is cut", () => {
    const built = filtered({ keyword: "objekt", groups: [900], filterFields: [] });

    expect(shownIds(built)).toHaveLength(2000);
    expect(built.truncation).toEqual({ shown: 2000, total: 2500 });
    expect(built.tabs[0].columns[0].total).toBe(2500);
  });

  it("finds no object in a hidden group, by group name or by title", () => {
    expect(shownIds(filtered({ keyword: "bodil", groups: [], filterFields: [] }, [900]))).toEqual([]);
    expect(shownIds(filtered({ keyword: "objekt 1", groups: [], filterFields: [] }, [900]))).toEqual([]);
  });
});

describe("the tags a tag prefix offers", () => {
  const PREFIX = "IT-stöd: ";

  it("are those that begin with the prefix, shown without it and in Swedish order, whatever order they come in", () => {
    expect(tagOptions(["IT-stöd: Ärendesystemet", "Internt", "IT-stöd: Zeta", "IT-stöd: Dokportalen", "Annat IT-stöd: Dokportalen"], PREFIX)).toEqual([
      { id: "IT-stöd: Dokportalen", text: "Dokportalen" },
      { id: "IT-stöd: Zeta", text: "Zeta" },
      { id: "IT-stöd: Ärendesystemet", text: "Ärendesystemet" },
    ]);
  });

  it("do not include a tag that is nothing but the prefix, since it would have no name to show", () => {
    expect(tagOptions(["IT-stöd:", "IT-stöd: "], "IT-stöd:")).toEqual([]);
  });

  it("are found without regard to case or to how accented letters are encoded, as Azure DevOps treats tags alike without regard to case", () => {
    expect(tagOptions(["it-stöd: Dokportalen"], "IT-stöd: ")).toEqual([{ id: "it-stöd: Dokportalen", text: "Dokportalen" }]);
  });
});

describe("the filter fields the board offers", () => {
  const known = {
    picklistFields: [{ referenceName: "Custom.Omrade", name: "Område", values: ["Inköp", "Ekonomi"] }],
    fields: [
      { referenceName: "Custom.GKL", name: "GKL", kind: "text" as const },
      { referenceName: "Custom.Beskrivning", name: "Beskrivning", kind: "html" as const },
      { referenceName: "System.AssignedTo", name: "Assigned To", kind: "identity" as const },
      { referenceName: "Custom.Pagar", name: "Pågår", kind: "yesNo" as const },
    ],
    tags: ["IT-stöd: Dokportalen", "IT-stöd: Gammalt", "IT-stöd: Ärendesystemet"],
  };

  it("leave out the tags that are unticked, and take along a new one with nothing set", () => {
    const { offered } = offeredFilterFields([{ type: "tagPrefix", name: "IT-stöd", prefix: "IT-stöd: ", excludedTags: ["it-stöd: gammalt", "IT-stöd: Finns inte längre"] }], known);

    expect(offered).toEqual([
      {
        type: "tagPrefix",
        name: "IT-stöd",
        options: [
          { id: "IT-stöd: Dokportalen", text: "Dokportalen" },
          { id: "IT-stöd: Ärendesystemet", text: "Ärendesystemet" },
        ],
      },
    ]);
  });

  it.each([
    ["a picklist field the type has lost", { type: "choice", name: "Borta", referenceName: "Custom.Borta" }],
    ["a field that is no picklist", { type: "choice", name: "Borta", referenceName: "Custom.GKL" }],
    ["a text field the type has lost", { type: "startsWith", name: "Borta", referenceName: "Custom.Borta" }],
    ["rich text, whose value says nothing about how it begins", { type: "startsWith", name: "Borta", referenceName: "Custom.Beskrivning" }],
    ["a person, who has no text to begin with", { type: "startsWith", name: "Borta", referenceName: "System.AssignedTo" }],
    ["rich text, which can be empty to the eye although it has a value", { type: "filled", name: "Borta", referenceName: "Custom.Beskrivning", filledText: "Ja", emptyText: "Nej" }],
    ["a yes or no, which always has a value", { type: "filled", name: "Borta", referenceName: "Custom.Pagar", filledText: "Ja", emptyText: "Nej" }],
  ] as [string, FilterField][])("do not include %s, and say that it is gone", (_kind, saved) => {
    const { offered, gone } = offeredFilterFields([saved], known);

    expect(offered).toEqual([]);
    expect(gone).toEqual(["Borta"]);
  });
});

describe("filtering on filter fields", () => {
  const item = (id: number, fields: Record<string, unknown> = {}): WorkItem => ({ id, fields: { "System.Title": `Objekt ${id}`, [PHASE_FIELD]: "Idéfas", ...fields } });

  const shownBy = (objects: WorkItem[], field: BoardFilterField, values: string[]) =>
    shownIds(
      buildBoard(
        {
          phaseField: PHASE_FIELD,
          tabs: arrangeTabs(undefined, phasesInPicklistOrder(["Idéfas"])),
          hiddenGroups: [],
          groupType: "Epic",
          filterFields: [field],
          cardFields: NO_CARD_FIELDS,
          objects,
          parents: [],
        },
        { ...NO_FILTER, filterFields: [{ name: field.name, values }] },
      ),
    );

  describe("a tag prefix", () => {
    const FIELD: BoardFilterField = { type: "tagPrefix", name: "IT-stöd", options: [] };
    const OBJECTS = [
      item(1, { "System.Tags": "IT-stöd: Dokportalen" }),
      item(2, { "System.Tags": "Internt; IT-stöd: Dokportalen 2; IT-stöd: Ärendesystemet" }),
      item(3, { "System.Tags": "IT-stöd: Dokportalen 2; Internt" }),
      item(4, { "System.Tags": "Internt" }),
      item(5),
    ];

    it("splits the tags on '; ' and matches the whole tag, wherever in the string it lies", () => {
      expect(shownBy(OBJECTS, FIELD, ["IT-stöd: Dokportalen"])).toEqual([1]);
      expect(shownBy(OBJECTS, FIELD, ["IT-stöd: Ärendesystemet"])).toEqual([2]);
    });

    it("lets any of the chosen do", () => {
      expect(shownBy(OBJECTS, FIELD, ["IT-stöd: Dokportalen", "IT-stöd: Ärendesystemet"])).toEqual([1, 2]);
    });

    it("does not take part of the tag string for a tag", () => {
      expect(shownBy(OBJECTS, FIELD, ["Internt; IT-stöd: Dokportalen 2"])).toEqual([]);
    });
  });

  describe("text that starts with", () => {
    const FIELD: BoardFilterField = { type: "startsWith", name: "GKL", referenceName: "Custom.GKL" };

    it("matches the beginning only, without regard to case, and a missing field has no beginning", () => {
      const objects = [item(1, { "Custom.GKL": "7.3.0" }), item(2, { "Custom.GKL": "17.3.0" }), item(3, { "Custom.GKL": "7.4.0" }), item(4), item(5, { "Custom.GKL": "Ab7.3" }), item(6, { "Custom.GKL": 7.3 })];

      expect(shownBy(objects, FIELD, ["7.3"])).toEqual([1, 6]);
      expect(shownBy(objects, FIELD, ["aB"])).toEqual([5]);
    });

    it("does not take the text as a pattern", () => {
      expect(shownBy([item(1, { "Custom.GKL": "7x3" })], FIELD, ["7.3"])).toEqual([]);
    });
  });

  describe("a choice", () => {
    it("matches the value exactly, and a missing field has no value", () => {
      const field: BoardFilterField = { type: "choice", name: "Område", referenceName: "Custom.Omrade", options: [] };
      const objects = [item(1, { "Custom.Omrade": "Inköp" }), item(2, { "Custom.Omrade": "Inköp och lager" }), item(3)];

      expect(shownBy(objects, field, ["Inköp"])).toEqual([1]);
    });
  });

  describe("filled in or empty", () => {
    const FIELD: BoardFilterField = { type: "filled", name: "Väntar på", referenceName: "Custom.VantarPa", options: [] };
    const OBJECTS = [item(1, { "Custom.VantarPa": "Intressent" }), item(2), item(3, { "Custom.VantarPa": "   " }), item(4, { "Custom.VantarPa": { displayName: "Ada" } }), item(5, { "Custom.VantarPa": null })];

    it("counts a value of any shape as filled in", () => {
      expect(shownBy(OBJECTS, FIELD, ["filled"])).toEqual([1, 4]);
    });

    it("counts a missing field and one of only spaces as empty", () => {
      expect(shownBy(OBJECTS, FIELD, ["empty"])).toEqual([2, 3, 5]);
    });
  });

  it("narrows before the cut, so that an object beyond the first 2,000 can be reached and the banner counts what is left", () => {
    const field: BoardFilterField = { type: "startsWith", name: "GKL", referenceName: "Custom.GKL" };
    const many = [...Array.from({ length: 2100 }, (_, index) => item(index + 1)), ...Array.from({ length: 3 }, (_, index) => item(5001 + index, { "Custom.GKL": "7.3.0" }))];
    const built = buildBoard(
      { phaseField: PHASE_FIELD, tabs: arrangeTabs(undefined, phasesInPicklistOrder(["Idéfas"])), hiddenGroups: [], groupType: "Epic", filterFields: [field], cardFields: NO_CARD_FIELDS, objects: many, parents: [] },
      { ...NO_FILTER, filterFields: [{ name: "GKL", values: ["7.3"] }] },
    );

    expect(shownIds(built)).toEqual([5001, 5002, 5003]);
    expect(built.truncation).toBeNull();
  });

  it("asks of every field in the filter, and ignores a name the board does not offer", () => {
    const fields: BoardFilterField[] = [
      { type: "startsWith", name: "GKL", referenceName: "Custom.GKL" },
      { type: "filled", name: "Väntar på", referenceName: "Custom.VantarPa", options: [] },
    ];
    const built = buildBoard(
      { phaseField: PHASE_FIELD, tabs: arrangeTabs(undefined, phasesInPicklistOrder(["Idéfas"])), hiddenGroups: [], groupType: "Epic", filterFields: fields, cardFields: NO_CARD_FIELDS, objects: [item(1, { "Custom.GKL": "7.3.0" }), item(2, { "Custom.GKL": "7.3.0", "Custom.VantarPa": "Någon" })], parents: [] },
      {
        ...NO_FILTER,
        filterFields: [
          { name: "GKL", values: ["7.3"] },
          { name: "Väntar på", values: ["empty"] },
          { name: "Finns inte", values: ["x"] },
        ],
      },
    );

    expect(shownIds(built)).toEqual([1]);
  });
});

describe("what a card shows from a field", () => {
  const SITUATION = "Custom.Lage";
  const cardWith = (kind: FieldKind, value: unknown) => {
    const field = { referenceName: SITUATION, name: "Läge", kind };
    const built = buildBoard({
      phaseField: PHASE_FIELD,
      tabs: arrangeTabs(undefined, phasesInPicklistOrder(["Idéfas"])),
      hiddenGroups: [],
      groupType: "Epic",
      filterFields: [],
      cardFields: { roles: { currentSituation: field }, details: [field], gone: [] },
      objects: [{ id: 1, fields: { [PHASE_FIELD]: "Idéfas", [SITUATION]: value } }],
      parents: [],
    }, NO_FILTER);
    return built.tabs[0].columns[0].cards[0];
  };

  it.each([
    ["a line of text in a div", "<div>Körs nattetid. </div>", "Körs nattetid."],
    ["paragraphs, each on its own line", "<p>Ett</p><p>Två</p>", "Ett\nTvå"],
    ["line breaks", "Ett<br>Två<br/>Tre", "Ett\nTvå\nTre"],
    ["a list, each item on its own line", "<ul><li>Ett</li><li>Två</li></ul>", "Ett\nTvå"],
    ["a table, cell by cell and row by row", "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>", "A B\nC"],
    ["formatting inside a line", "Väntar <b>på</b> <a href='https://example.test'>avtal</a>", "Väntar på avtal"],
    ["entities", "Inköp &amp; juridik&nbsp;&lt;nu&gt;", "Inköp & juridik <nu>"],
    ["line breaks in the source, which are only spaces", "<div>Ett\n   två</div>", "Ett två"],
    ["what is not text", "<style>p{}</style><script>alert(1)</script>Kvar", "Kvar"],
    ["unclosed tags", "<div>Ett<div>Två", "Ett\nTvå"],
    ["empty HTML", "<div><br></div><p> &nbsp; </p>", ""],
    ["only an image", "<img src='https://example.test/x.png'>", ""],
  ])("reads rich text as plain text: %s", (_kind, html, expected) => {
    const card = cardWith("html", html);

    expect(card.currentSituation).toBe(expected);
    expect(card.details).toEqual([{ name: "Läge", value: expected }]);
  });

  it.each([
    ["markup that decodes to something like a tag, which stays text", "&lt;img src=x onerror=alert(1)&gt;Kvar", "<img src=x onerror=alert(1)>Kvar"],
    ["an entity written twice, which is decoded once", "&amp;lt;b&amp;gt;", "&lt;b&gt;"],
    ["a less-than sign that begins no tag", "1 < 2 <3", "1 < 2 <3"],
    ["a tag with a > in a quoted attribute", `<a title="x>y" href='z>w'>Kvar</a>`, "Kvar"],
    ["a tag that never ends", "Kvar<div title=", "Kvar"],
    ["a quote that never ends", `Kvar<div title="x>y`, "Kvar"],
    ["comments", "<!-- ej --><!--><!--->Kvar<!-- ej --!>Med<!-- ej", "KvarMed"],
    ["declarations and processing instructions", "<!doctype html><?xml version='1'>Kvar", "Kvar"],
    ["end tags that close nothing", "Ett</b></><//x>Två", "EttTvå"],
    ["script and style in any case, and in svg", "<SCRIPT>x</ScRiPt><svg><script>y</script><style>z</style></svg>Kvar", "Kvar"],
    ["what a browser never shows", "<title>a</title><template>b</template><noscript>c</noscript><iframe>d</iframe><noembed>e</noembed><noframes>f</noframes>Kvar", "Kvar"],
    ["an element of that kind that never ends", "Kvar<script>x", "Kvar"],
    ["a form whose fields have the names of the page's own properties", "<form><input name=childNodes><input name=body id=attributes>Kvar</form>", "Kvar"],
    ["block elements with attributes, in capitals", '<DIV CLASS="a">Ett</DIV><P>Två<BR/>Tre', "Ett\nTvå\nTre"],
    ["nesting far deeper than any field is written", `${"<div>".repeat(200_000)}Kvar`, "Kvar"],
    ["many formatting elements that differ in an attribute", `<p>${Array.from({ length: 500 }, (_, index) => `<b a${index}>`).join("")}${"<p>x".repeat(3)}`, "x\nx\nx"],
  ])("reads rich text as nothing but its text: %s", (_kind, html, expected) => {
    expect(cardWith("html", html).currentSituation).toBe(expected);
  });

  it.each<[string, FieldKind, unknown]>([
    ["rich text", "html", { toString: null }],
    ["a date", "date", { toString: null }],
    ["text", "text", { toString: null }],
  ])("shows %s of a shape nobody expected as what it holds, without failing", (_kind, kind, value) => {
    expect(cardWith(kind, value).details).toEqual([{ name: "Läge", value: '{"toString":null}' }]);
  });

  it("says that a field could not be read, and the rest of the card stays", () => {
    // The only way a value cannot even be written out: nothing can follow it down.
    const unreadable: unknown[] = [];
    unreadable.push(unreadable);

    expect(cardWith("text", unreadable).details).toEqual([{ name: "Läge", value: "Could not be read here. Open the work item to see it." }]);
  });

  it.each<[string, FieldKind, unknown, string]>([
    ["text exactly as it stands", "text", "  <b>Ett</b>  två ", "  <b>Ett</b>  två "],
    ["only spaces as empty", "text", "   ", ""],
    ["a number", "text", 0, "0"],
    ["a missing field as empty", "text", undefined, ""],
    ["yes", "yesNo", true, "Yes"],
    ["no, which is a value and not empty", "yesNo", false, "No"],
    ["a person by name", "identity", { displayName: "Ada Admin", uniqueName: "ada@example.test" }, "Ada Admin"],
    ["a person that is only text", "identity", "Ada Admin", "Ada Admin"],
    ["a person of a shape nobody expected as what it holds", "identity", { id: "u1" }, '{"id":"u1"}'],
    ["a date that cannot be read as it stands", "date", "inte ett datum", "inte ett datum"],
  ])("shows %s", (_kind, kind, value, expected) => {
    expect(cardWith(kind, value).details).toEqual([{ name: "Läge", value: expected }]);
  });
});
