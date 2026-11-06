import type { PicklistField, WorkItem, WorkItemField } from "../platform/platform";
import { fieldsForFilter, type CardFields, type FilterField, type PhaseTab } from "../settings/settings";
import { fieldText } from "./fieldText";

export const TITLE_FIELD = "System.Title";
export const TYPE_FIELD = "System.WorkItemType";
export const PARENT_FIELD = "System.Parent";
export const TAGS_FIELD = "System.Tags";

/** v1 is dimensioned for this many objects per project. A board never holds more. */
export const MAX_OBJECTS_ON_BOARD = 2000;

export interface Board {
  /** The groups to list above the columns, in name order, whether or not any object is in them. Hidden groups are not among them. */
  groups: Group[];
  /** The filter fields the viewer can narrow by. */
  filterFields: BoardFilterField[];
  /** At least one. Every object left after hiding groups and filtering is counted on one of them. */
  tabs: BoardTab[];
  /** Set when more objects are left after hiding groups and filtering than the board can hold, so that the cut is never silent. */
  truncation: Truncation | null;
}

export interface BoardTab {
  name: string;
  columns: Column[];
}

export interface Truncation {
  shown: number;
  total: number;
}

interface ColumnContents {
  /** The cards the board can hold. Fewer than `total` only when the board was cut. */
  cards: Card[];
  /** How many objects are left in this column after hiding groups and filtering, whether they got a card or not. */
  total: number;
}

/**
 * `new` is a phase the picklist has gained since the order was saved; `unlisted` holds a phase value
 * the picklist no longer has; `without-phase` holds objects with no phase at all.
 */
export type Column = ColumnContents & { dividerBefore?: string } & ({ kind: "picklist" | "new" | "unlisted"; phase: string } | { kind: "without-phase" });

export interface Card {
  id: number;
  title: string;
  /** The phase the object is in, or null if its phase field is empty. */
  phase: string | null;
  group: Group | null;
  /** The current situation, or "" if it is empty or the role is not pointed at a field. */
  currentSituation: string;
  /** What the object waits on, "" if nothing, or null if the role is not pointed at a field, so that nothing can be said about it. */
  waitingOn: string | null;
  /** The name of the marker field if the object is marked, otherwise null. */
  marker: string | null;
  /** The fields of the detail panel, in order. A value is "" if the field is empty. */
  details: { name: string; value: string }[];
}

export interface Group {
  id: number;
  name: string;
  color: string;
}

/** What a board is built from: the settings as they stand and everything fetched. */
export interface BoardSource {
  /** The reference name of the field that holds an object's phase. */
  phaseField: string;
  /** The tabs, at least one, with the phases that get a column whether or not any object is in them, in order. */
  tabs: PhaseTab[];
  /** The work item ids of the groups that are not to show. */
  hiddenGroups: number[];
  groupType: string;
  filterFields: BoardFilterField[];
  /** What the cards and their detail panels show from each object. */
  cardFields: CardFields;
  objects: WorkItem[];
  /** Every work item that may be a group: the objects' parents and the project's groups. Only those of the group type count. */
  parents: WorkItem[];
}

/** What the viewer has narrowed the board to. An object has to pass all of it. */
export interface BoardFilter {
  /** Without spaces around it. Empty when no keyword is asked for. */
  keyword: string;
  /** The work item ids of the groups asked for, of which any will do. Empty when no group is asked for. */
  groups: number[];
  /** What is asked of the filter fields. One the viewer asks nothing of is not here. */
  filterFields: AskedFilterField[];
}

export interface AskedFilterField {
  /** The name of the filter field. */
  name: string;
  /** What {@link fieldMatcher} takes for the field's type. Never empty. */
  values: string[];
}

export const NO_FILTER: BoardFilter = { keyword: "", groups: [], filterFields: [] };

export function isFilterActive({ keyword, groups, filterFields }: BoardFilter): boolean {
  return keyword !== "" || groups.length > 0 || filterFields.length > 0;
}

/** What a viewer can pick in a filter field's dropdown. `id` is what the filter holds and a link says. */
export interface FilterOption {
  id: string;
  text: string;
}

/** A saved filter field as it can be used today, with what it has to offer. */
export type BoardFilterField =
  | { type: "choice"; name: string; referenceName: string; options: FilterOption[] }
  | { type: "tagPrefix"; name: string; options: FilterOption[] }
  | { type: "startsWith"; name: string; referenceName: string }
  | { type: "filled"; name: string; referenceName: string; options: FilterOption[] };

/** What a filter on filled in or empty asks for, in the filter and in a link. */
const FILLED = "filled";
const EMPTY = "empty";

/** How `workitemsbatch` writes the tags of an object, and so how a link writes several. A tag cannot hold a `;`. */
export const TAG_SEPARATOR = "; ";

/**
 * The saved filter fields the project can still use, and the names of those it cannot because their
 * field is gone or can no longer be used that way. Asking `workitemsbatch` for a field that does not
 * exist fails the whole read, so such a filter field costs itself and not the board.
 */
export function offeredFilterFields(
  saved: FilterField[],
  { picklistFields, fields, tags }: { picklistFields: PicklistField[]; fields: WorkItemField[]; tags: string[] },
): { offered: BoardFilterField[]; gone: string[] } {
  const offered: BoardFilterField[] = [];
  const gone: string[] = [];
  for (const filterField of saved) {
    if (filterField.type === "tagPrefix") {
      const { name, prefix, excludedTags } = filterField;
      offered.push({ type: "tagPrefix", name, options: tagOptions(tags, prefix).filter(({ id }) => !excludedTags.some((tag) => isSameTag(tag, id))) });
    } else if (!fieldsForFilter(filterField.type, picklistFields, fields).some(({ referenceName }) => referenceName === filterField.referenceName)) {
      gone.push(filterField.name);
    } else if (filterField.type === "choice") {
      const values = picklistFields.find(({ referenceName }) => referenceName === filterField.referenceName)?.values ?? [];
      offered.push({ ...filterField, options: values.map((value) => ({ id: value, text: value })) });
    } else if (filterField.type === "filled") {
      const { name, referenceName, filledText, emptyText } = filterField;
      offered.push({ type: "filled", name, referenceName, options: [{ id: FILLED, text: filledText }, { id: EMPTY, text: emptyText }] });
    } else {
      offered.push(filterField);
    }
  }
  return { offered, gone };
}

/** Azure DevOps treats tags alike without regard to case, and a project cannot hold two that differ only in that. */
export function isSameTag(a: string, b: string): boolean {
  return searchable(a) === searchable(b);
}

/**
 * The tags that begin with the prefix, in name order and named without it. `id` is the whole tag. The
 * prefix is found the way tags are told apart, and a tag that is nothing but the prefix has no name to
 * show and is not among them.
 */
export function tagOptions(tags: string[], prefix: string): FilterOption[] {
  const wanted = prefix.normalize();
  return tags
    .flatMap((tag) => {
      const whole = tag.normalize();
      const text = whole.slice(wanted.length);
      return searchable(whole.slice(0, wanted.length)) === searchable(wanted) && text.trim() !== "" ? [{ id: tag, text }] : [];
    })
    .sort((a, b) => NAME_ORDER.compare(a.text, b.text));
}

/**
 * Turns fetched work items into what the hub draws. Objects in a hidden group and objects that do not
 * pass the filter are left out before anything else happens, so that both make room for what comes after
 * them. Every other object is counted: one without a phase or with a phase the picklist has lost gets a
 * column of its own, and one whose parent is missing or of the wrong type is shown as having no group.
 * Only the first {@link MAX_OBJECTS_ON_BOARD} in group order get a card, and both the board and each
 * column say how many were cut.
 */
export function buildBoard(source: BoardSource, filter: BoardFilter): Board {
  const { phaseField, tabs, groupType, cardFields, parents } = source;
  const { currentSituation, waitingOn, marker } = cardFields.roles;
  const hiddenGroups = new Set(source.hiddenGroups);
  const groups = new Map(groupsAmong(parents, groupType).map((group) => [group.id, group]));
  const groupOfObject = (object: WorkItem): Group | null => {
    const parentId = parentIdOf(object);
    return (parentId !== null && groups.get(parentId)) || null;
  };
  const passesFilter = filterPredicate(filter, source.filterFields);
  const objects = source.objects.filter((object) => {
    const group = groupOfObject(object);
    return !(group && hiddenGroups.has(group.id)) && passesFilter(object, group);
  });
  const toCard = (object: WorkItem): Card => ({
    id: object.id,
    title: text(object.fields[TITLE_FIELD]),
    phase: text(object.fields[phaseField]) || null,
    group: groupOfObject(object),
    currentSituation: currentSituation ? fieldText(object, currentSituation) : "",
    waitingOn: waitingOn ? fieldText(object, waitingOn) : null,
    marker: marker && object.fields[marker.referenceName] === true ? marker.name : null,
    details: cardFields.details.map((field) => ({ name: field.name, value: fieldText(object, field) })),
  });

  const emptyColumn = (): ColumnContents => ({ cards: [], total: 0 });
  const phases = tabs.flatMap((tab) => tab.phases);
  const phaseColumns = new Map(phases.map(({ name }) => [name, emptyColumn()]));
  const withoutPhase = emptyColumn();
  const columnOf = (object: WorkItem): ColumnContents => {
    const phase = text(object.fields[phaseField]);
    if (!phase) return withoutPhase;
    const column = phaseColumns.get(phase) ?? emptyColumn();
    phaseColumns.set(phase, column);
    return column;
  };

  [...objects].sort(inGroupOrder(groupOfObject)).forEach((object, position) => {
    const column = columnOf(object);
    column.total += 1;
    if (position < MAX_OBJECTS_ON_BOARD) column.cards.push(toCard(object));
  });

  const listed = new Set(phases.map(({ name }) => name));
  const boardTabs: BoardTab[] = tabs.map(({ name, phases: phasesInTab }) => ({
    name,
    columns: phasesInTab.map(({ name: phase, isNew, dividerBefore }) => ({
      kind: isNew ? "new" : "picklist",
      phase,
      dividerBefore,
      ...(phaseColumns.get(phase) ?? emptyColumn()),
    })),
  }));
  // No tab lists these, and they must not vanish, so they come last on the last tab.
  const { columns: onLastTab } = boardTabs[boardTabs.length - 1];
  for (const [phase, column] of phaseColumns) {
    if (!listed.has(phase)) onLastTab.push({ kind: "unlisted", phase, ...column });
  }
  if (withoutPhase.total > 0) onLastTab.push({ kind: "without-phase", ...withoutPhase });
  return {
    groups: shownGroups(source),
    filterFields: source.filterFields,
    tabs: boardTabs,
    truncation: objects.length > MAX_OBJECTS_ON_BOARD ? { shown: MAX_OBJECTS_ON_BOARD, total: objects.length } : null,
  };
}

function filterPredicate({ keyword, groups, filterFields: asked }: BoardFilter, filterFields: BoardFilterField[]): (object: WorkItem, group: Group | null) => boolean {
  const askedKeyword = searchable(keyword);
  const askedGroups = new Set(groups);
  const fieldMatchers = filterFields.flatMap((filterField) => {
    const askedOfField = asked.find(({ name }) => name === filterField.name);
    return askedOfField ? [fieldMatcher(filterField, askedOfField.values)] : [];
  });
  return (object, group) =>
    fieldMatchers.every((matches) => matches(object)) &&
    (askedGroups.size === 0 || (group !== null && askedGroups.has(group.id))) &&
    (askedKeyword === "" || searchable(text(object.fields[TITLE_FIELD])).includes(askedKeyword) || (group !== null && searchable(group.name).includes(askedKeyword)));
}

/**
 * Whether an object has what is asked of a filter field. A choice and filled in or empty hold the id of
 * one option, a tag prefix the whole tags of which any will do, and text that starts with what is typed.
 * `workitemsbatch` leaves empty fields out, so a missing field holds nothing that can match, and counts as empty.
 */
function fieldMatcher(filterField: BoardFilterField, values: string[]): (object: WorkItem) => boolean {
  switch (filterField.type) {
    case "choice":
      return (object) => text(object.fields[filterField.referenceName]) === values[0];
    case "tagPrefix": {
      const asked = new Set(values.map(searchable));
      return (object) => text(object.fields[TAGS_FIELD]).split(TAG_SEPARATOR).some((tag) => asked.has(searchable(tag)));
    }
    case "startsWith": {
      const asked = searchable(values[0]);
      return (object) => searchable(text(object.fields[filterField.referenceName])).startsWith(asked);
    }
    case "filled": {
      const wantsFilled = values[0] === FILLED;
      return (object) => (text(object.fields[filterField.referenceName]).trim() !== "") === wantsFilled;
    }
  }
}

/** The same for everyone, whatever their browser's language, and however the text's accented letters are encoded. */
function searchable(value: string): string {
  return value.normalize().toLowerCase();
}

/** The groups a board of this source lists, and so the ones a filter can ask for. */
export function shownGroups({ parents, groupType, hiddenGroups }: BoardSource): Group[] {
  return groupsAmong(parents, groupType).filter((group) => !hiddenGroups.includes(group.id));
}

/** The work items that are groups of the given type, in name order. */
export function groupsAmong(workItems: WorkItem[], groupType: string): Group[] {
  return workItems.filter((item) => item.fields[TYPE_FIELD] === groupType).map(groupOf).sort(inNameOrder);
}

/**
 * Groups by name, with objects that have no group last. The sort is stable, so objects keep the order
 * they came in within their group. Two groups with the same name are told apart by id, so that they
 * stay apart and the cut falls in the same place every time.
 */
function inGroupOrder(groupOfObject: (object: WorkItem) => Group | null): (a: WorkItem, b: WorkItem) => number {
  return (a, b) => {
    const [groupA, groupB] = [groupOfObject(a), groupOfObject(b)];
    if (!groupA || !groupB) return Number(!groupA) - Number(!groupB);
    return inNameOrder(groupA, groupB);
  };
}

function inNameOrder(a: Group, b: Group): number {
  return NAME_ORDER.compare(a.name, b.name) || a.id - b.id;
}

/** Always Swedish, so that everyone who opens the same view gets the same objects, whatever their browser's language. */
const NAME_ORDER = new Intl.Collator("sv");

/** The id of an object's parent, or null if it has none. */
export function parentIdOf(object: WorkItem): number | null {
  const parentId = object.fields[PARENT_FIELD];
  return typeof parentId === "number" ? parentId : null;
}

function groupOf(parent: WorkItem): Group {
  return { id: parent.id, name: text(parent.fields[TITLE_FIELD]), color: GROUP_COLORS[parent.id % GROUP_COLORS.length] };
}

/** `workitemsbatch` leaves empty fields out, so a field that is missing is an empty one. */
function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Chosen by work item id, so that a group keeps its color between visits and for everyone who looks,
 * whichever other groups exist. The name is always shown next to it, so color is never the only signal.
 */
const GROUP_COLORS = [
  "#0078d4",
  "#8764b8",
  "#038387",
  "#ca5010",
  "#c239b3",
  "#498205",
  "#986f0b",
  "#4f6bed",
  "#e3008c",
  "#00838f",
  "#7a7574",
  "#d13438",
];
