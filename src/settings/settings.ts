import type { FieldKind, PicklistField, Platform, WorkItemField } from "../platform/platform";

/** What a Project Administrator has chosen for a project. */
export interface Settings {
  /** The work item type of the objects on the board. */
  objectType: string;
  /** The work item type a parent must have to count as the object's group. */
  groupType: string;
  /** The reference name of the picklist field that holds an object's phase. */
  phaseField: string;
  /** The phases in the order the administrator put them, as they were when saved. */
  phaseOrder: string[];
  /**
   * The work item ids of the groups the board leaves out. Ids rather than names, since names can be
   * changed and shared. An id stays when its group is gone, where it matches nothing, so that a group
   * that comes back is still hidden and a failed read in the panel cannot bring one back.
   */
  hiddenGroups: number[];
  /** How the phases are divided into tabs. Without it, all phases share one tab. */
  tabs?: SavedTab[];
  /** What the viewer can narrow the board by, besides keyword and group. */
  filterFields: FilterField[];
  /** The field behind each role on the card. A role left out is simply not on the card. */
  roles?: CardRoles;
  /** The reference names of the fields in the detail panel, in order. Left out, the panel follows the card's roles. */
  detailFields?: string[];
}

/** One way of narrowing the board. `name` is what the filter row calls it and what a link goes by, so no two share one. */
export type FilterField =
  /** One value of a picklist field. */
  | { type: "choice"; name: string; referenceName: string }
  /**
   * Any of the project's tags that begin with `prefix`, which is kept as written, spaces and all.
   * `excludedTags` are whole tags, the ones unticked, so that a new tag is offered without anyone asking.
   */
  | { type: "tagPrefix"; name: string; prefix: string; excludedTags: string[] }
  /** Text that begins with what the viewer types. */
  | { type: "startsWith"; name: string; referenceName: string }
  /** Whether a field holds anything, with what to call each answer. */
  | { type: "filled"; name: string; referenceName: string; filledText: string; emptyText: string };

export type FilterFieldType = FilterField["type"];

/** A tab as it is saved. The phase order decides the order of its columns; this only says which phases it holds. */
export interface SavedTab {
  /** Identifies the tab in a link, so no two tabs share one. */
  name: string;
  phases: SavedTabPhase[];
}

export interface SavedTabPhase {
  name: string;
  dividerBefore?: string;
}

/** The optional roles a field can have on the card, by the field's reference name. */
export interface CardRoles {
  currentSituation?: string;
  waitingOn?: string;
  marker?: string;
}

/** What the saved settings ask the card and the detail panel to show, as far as the object's type still has it. */
export interface CardFields {
  roles: Partial<Record<keyof CardRoles, WorkItemField>>;
  details: WorkItemField[];
  /** The reference names in the settings that the object's type does not have, or has as something the role cannot use. */
  gone: string[];
}

/** One saved change: who made it and when. Written by the browser, so it is never proof of anything. */
export interface LogEntry {
  /** When the change was saved, in milliseconds since the epoch. A number, since Azure DevOps and its REST client may turn a date string into something else. */
  at: number;
  userId: string;
  userName: string;
}

/**
 * A project's stored settings document. `settings` is null after going back to the defaults, when
 * only the log remains. A stored document may say so with null or by leaving the settings out.
 */
export interface SettingsDocument {
  settings: Settings | null;
  log: LogEntry[];
}

/** A phase as it stands today: `isNew` if the picklist has gained it since the order was saved. */
export interface Phase {
  name: string;
  isNew: boolean;
}

/** A phase in its tab, with the text of the divider before it if it has one. */
export type TabPhase = Phase & { dividerBefore?: string };

/** A tab as it stands today: the phases the picklist has now, in the order they are shown. */
export interface PhaseTab {
  name: string;
  phases: TabPhase[];
}

/** The stored settings cannot be used. A Project Administrator can fix or reset them in the settings panel. */
export class InvalidSettingsError extends Error {}

const CURRENT_VERSION = 1;

/** Keeps the document far below the 5 MB that Extension Data Service allows. The oldest entries go first. */
const MAX_LOG_ENTRIES = 500;

/** Azure DevOps keeps work item ids as 32-bit integers, and the panel asks it about the saved ones. */
const MAX_WORK_ITEM_ID = 2 ** 31 - 1;

/** The one tab there is until an administrator has divided the phases. */
export const DEFAULT_TAB_NAME = "All phases";

/** What the hub guesses before anything is saved. The phase field is guessed from what the project has. */
export const GUESSED_TYPES = { objectType: "Feature", groupType: "Epic" };

/**
 * Reads a stored settings document. Storage is writable by anyone who can open the hub, so nothing
 * about the document is taken on trust, and one that is not valid is rejected rather than replaced.
 */
export function parseSettingsDocument(content: unknown): SettingsDocument {
  if (!isRecord(content)) throw new InvalidSettingsError("The saved settings are not valid: they are not a settings document.");
  if (content.version !== CURRENT_VERSION) {
    throw new InvalidSettingsError(`The saved settings have an unknown version: ${JSON.stringify(content.version)}.`);
  }
  requireOnlyKnownKeys(content, ["version", "settings", "log"]);
  if (!Array.isArray(content.log) || !content.log.every(isLogEntry)) {
    throw new InvalidSettingsError("The saved settings are not valid: the change log is damaged.");
  }
  const { settings } = content;
  return { settings: settings === null || settings === undefined ? null : parseSettings(settings), log: content.log };
}

function parseSettings(settings: unknown): Settings {
  if (!isRecord(settings)) throw new InvalidSettingsError("The saved settings are not valid: the settings in the document are damaged.");
  requireOnlyKnownKeys(settings, ["objectType", "groupType", "phaseField", "phaseOrder", "hiddenGroups", "tabs", "filterFields", "roles", "detailFields"]);
  // Settings saved before groups could be hidden or filter fields set leave them out.
  const { objectType, groupType, phaseField, phaseOrder, hiddenGroups = [], tabs, filterFields = [], roles, detailFields } = settings;
  if (!isName(objectType) || !isName(groupType) || !isName(phaseField)) {
    throw new InvalidSettingsError("The saved settings are not valid: the object type, group type and phase field must all be set.");
  }
  if (!Array.isArray(phaseOrder) || !phaseOrder.every(isName) || new Set(phaseOrder).size !== phaseOrder.length) {
    throw new InvalidSettingsError("The saved settings are not valid: the phase order must list each phase once.");
  }
  if (!Array.isArray(hiddenGroups) || !hiddenGroups.every(isWorkItemId) || new Set(hiddenGroups).size !== hiddenGroups.length) {
    throw new InvalidSettingsError("The saved settings are not valid: the hidden groups must list each group's work item id once.");
  }
  return {
    objectType,
    groupType,
    phaseField,
    phaseOrder,
    hiddenGroups,
    ...(tabs === undefined ? {} : { tabs: parseTabs(tabs, phaseOrder) }),
    filterFields: parseFilterFields(filterFields),
    ...(roles === undefined ? {} : { roles: parseRoles(roles) }),
    ...(detailFields === undefined ? {} : { detailFields: parseDetailFields(detailFields) }),
  };
}

function parseFilterFields(filterFields: unknown): FilterField[] {
  if (!Array.isArray(filterFields)) throw new InvalidSettingsError("The saved settings are not valid: the filter fields must be a list.");
  const parsed = filterFields.map(parseFilterField);
  if (new Set(parsed.map(({ name }) => name)).size !== parsed.length) {
    throw new InvalidSettingsError("The saved settings are not valid: two filter fields have the same name.");
  }
  return parsed;
}

function parseFilterField(filterField: unknown): FilterField {
  if (!isRecord(filterField)) throw new InvalidSettingsError("The saved settings are not valid: a filter field is damaged.");
  const { type, name, referenceName, prefix, excludedTags, filledText, emptyText } = filterField;
  if (!isTrimmedText(name)) throw new InvalidSettingsError("The saved settings are not valid: a filter field has no proper name.");
  const damaged = new InvalidSettingsError(`The saved settings are not valid: the filter field ${name} is damaged.`);
  switch (type) {
    case "choice":
    case "startsWith":
      requireOnlyKnownKeys(filterField, ["type", "name", "referenceName"]);
      if (!isName(referenceName)) throw damaged;
      return { type, name, referenceName };
    case "tagPrefix":
      requireOnlyKnownKeys(filterField, ["type", "name", "prefix", "excludedTags"]);
      if (!isTagPrefix(prefix) || !Array.isArray(excludedTags) || !excludedTags.every(isName) || new Set(excludedTags).size !== excludedTags.length) throw damaged;
      return { type, name, prefix, excludedTags };
    case "filled":
      requireOnlyKnownKeys(filterField, ["type", "name", "referenceName", "filledText", "emptyText"]);
      if (!isName(referenceName) || !isTrimmedText(filledText) || !isTrimmedText(emptyText)) throw damaged;
      return { type, name, referenceName, filledText, emptyText };
    default:
      throw damaged;
  }
}

/** A tag cannot hold a `;`, since that is what separates tags, so a prefix with one could never match. */
export function isTagPrefix(value: unknown): value is string {
  return isName(value) && value.trim() !== "" && !value.includes(";");
}

function parseTabs(tabs: unknown, phaseOrder: string[]): SavedTab[] {
  if (!Array.isArray(tabs) || tabs.length === 0) throw new InvalidSettingsError("The saved settings are not valid: the tabs must be a list of at least one tab.");
  const parsed = tabs.map(parseTab);
  if (new Set(parsed.map(({ name }) => name)).size !== parsed.length) {
    throw new InvalidSettingsError("The saved settings are not valid: two tabs have the same name.");
  }
  const phaseNames = parsed.flatMap(({ phases }) => phases.map(({ name }) => name));
  if (new Set(phaseNames).size !== phaseNames.length) {
    throw new InvalidSettingsError("The saved settings are not valid: a phase can only be on one tab, once.");
  }
  // They are saved together, so if they disagree, something other than the settings panel has written them.
  if (phaseNames.length !== phaseOrder.length || !phaseNames.every((name) => phaseOrder.includes(name))) {
    throw new InvalidSettingsError("The saved settings are not valid: the tabs and the phase order list different phases.");
  }
  return parsed;
}

function parseTab(tab: unknown): SavedTab {
  if (!isRecord(tab)) throw new InvalidSettingsError("The saved settings are not valid: a tab is damaged.");
  requireOnlyKnownKeys(tab, ["name", "phases"]);
  const { name, phases } = tab;
  if (!isTrimmedText(name)) throw new InvalidSettingsError("The saved settings are not valid: a tab has no proper name.");
  if (!Array.isArray(phases)) throw new InvalidSettingsError(`The saved settings are not valid: the tab ${name} has no list of phases.`);
  return { name, phases: phases.map(parseTabPhase) };
}

function parseTabPhase(phase: unknown): SavedTabPhase {
  if (!isRecord(phase)) throw new InvalidSettingsError("The saved settings are not valid: a phase on a tab is damaged.");
  requireOnlyKnownKeys(phase, ["name", "dividerBefore"]);
  const { name, dividerBefore } = phase;
  if (!isName(name)) throw new InvalidSettingsError("The saved settings are not valid: a phase on a tab has no name.");
  if (dividerBefore === undefined) return { name };
  if (!isTrimmedText(dividerBefore)) throw new InvalidSettingsError(`The saved settings are not valid: the divider before ${name} has no proper text.`);
  return { name, dividerBefore };
}

function parseRoles(roles: unknown): CardRoles {
  if (!isRecord(roles)) throw new InvalidSettingsError("The saved settings are not valid: the card's roles are damaged.");
  requireOnlyKnownKeys(roles, ROLE_NAMES);
  if (!Object.values(roles).every(isName)) {
    throw new InvalidSettingsError("The saved settings are not valid: each of the card's roles must name a field.");
  }
  return roles;
}

function parseDetailFields(detailFields: unknown): string[] {
  if (!Array.isArray(detailFields) || !detailFields.every(isName) || new Set(detailFields).size !== detailFields.length) {
    throw new InvalidSettingsError("The saved settings are not valid: the detail panel must list each field once.");
  }
  return detailFields;
}

/**
 * What the project has to choose from: its work item types, and the fields on the object type if
 * it is one of them. The object type may come from a stored document, so Azure DevOps is
 * only asked about it once it is known to be the project's own.
 */
export async function readProjectOptions(
  platform: Platform,
  projectId: string,
  objectType: string,
): Promise<{ workItemTypes: string[]; picklistFields: PicklistField[]; fields: WorkItemField[] }> {
  const workItemTypes = await platform.getWorkItemTypes(projectId);
  if (!workItemTypes.includes(objectType)) return { workItemTypes, picklistFields: [], fields: [] };
  return { workItemTypes, ...(await readFieldsOfType(platform, projectId, objectType)) };
}

/** The fields on a work item type: its picklist fields, which hold values to choose from, and all of them. */
export async function readFieldsOfType(platform: Platform, projectId: string, workItemType: string): Promise<{ picklistFields: PicklistField[]; fields: WorkItemField[] }> {
  const [picklistFields, fields] = await Promise.all([platform.getPicklistFields(projectId, workItemType), platform.getWorkItemFields(projectId, workItemType)]);
  return { picklistFields, fields };
}

/**
 * The kinds of field whose value a filter can judge. Rich text can look empty although it has a value, and a
 * yes or no always has one. A person and a date come as something else than what is shown, so they have no beginning to match.
 */
const FILTERABLE_KINDS: Record<"startsWith" | "filled", FieldKind[]> = {
  startsWith: ["text"],
  filled: ["text", "identity", "date"],
};

/** The fields a filter field of a type can use. */
export function fieldsForFilter(type: Exclude<FilterFieldType, "tagPrefix">, picklistFields: PicklistField[], fields: WorkItemField[]): Pick<WorkItemField, "referenceName" | "name">[] {
  return type === "choice" ? picklistFields : fields.filter(({ kind }) => FILTERABLE_KINDS[type].includes(kind));
}

/**
 * The phase field that settings name, if the project still has everything they name. Rejects
 * them otherwise, since a group type that is gone would otherwise just leave every object without a group.
 */
export function usablePhaseField(settings: Settings, workItemTypes: string[], picklistFields: PicklistField[]): PicklistField {
  const { objectType, groupType, phaseField } = settings;
  for (const type of [objectType, groupType]) {
    if (!workItemTypes.includes(type)) {
      throw new InvalidSettingsError(`The saved settings name ${type} as a work item type, but the project has no such type.`);
    }
  }
  const field = picklistFields.find(({ referenceName }) => referenceName === phaseField);
  if (!field) {
    throw new InvalidSettingsError(`The saved settings name ${phaseField} as the phase field, but ${objectType} has no such picklist field.`);
  }
  return field;
}

/** The kinds of field each role can use. A marker is a yes or a no, and the others show their value as text. */
const ROLE_KINDS: Record<keyof CardRoles, FieldKind[]> = {
  currentSituation: ["text", "html"],
  waitingOn: ["text", "html", "identity"],
  marker: ["yesNo"],
};

/** The roles, in the order the card and the settings list them. */
export const ROLE_NAMES = Object.keys(ROLE_KINDS) as (keyof CardRoles)[];

/** A card that shows only what every object has. */
export const NO_CARD_FIELDS: CardFields = { roles: {}, details: [], gone: [] };

/** The fields a role can be pointed at. */
export function fieldsForRole(role: keyof CardRoles, fields: WorkItemField[]): WorkItemField[] {
  return fields.filter(({ kind }) => ROLE_KINDS[role].includes(kind));
}

/**
 * Finds what saved settings name for the card and the detail panel among the fields on the object's
 * type. Stored settings are not to be trusted, and `workitemsbatch` refuses the whole batch if it is
 * asked for a field that does not exist, so only what is found here may be read.
 */
export function readCardFields(settings: Settings, fields: WorkItemField[]): CardFields {
  const gone = new Set<string>();
  const findUsable = (referenceName: string, usable: WorkItemField[]) => {
    const field = usable.find((candidate) => candidate.referenceName === referenceName);
    if (!field) gone.add(referenceName);
    return field;
  };

  const roles: CardFields["roles"] = {};
  for (const role of ROLE_NAMES) {
    const referenceName = settings.roles?.[role];
    const field = referenceName === undefined ? undefined : findUsable(referenceName, fieldsForRole(role, fields));
    if (field) roles[role] = field;
  }
  const details = settings.detailFields
    ? settings.detailFields.flatMap((referenceName) => findUsable(referenceName, fields) ?? [])
    : fieldsWithRoles(roles);
  return { roles, details, gone: [...gone] };
}

/** What the detail panel shows until an administrator chooses otherwise: the fields on the card, each once. */
export function fieldsWithRoles<Field>(roles: Partial<Record<keyof CardRoles, Field>>): Field[] {
  return [...new Set(ROLE_NAMES.flatMap((role) => roles[role] ?? []))] as Field[];
}

/** Says what {@link CardFields.gone} holds, to whoever is looking at the board or the settings. */
export function goneFieldsMessage(gone: string[]): string {
  return `The saved settings name ${gone.join(", ")} for the cards or the detail panel, but the object's work item type no longer has them in a form that can be used.`;
}

/** The log entries that can still be read from a document that may be damaged. */
export function readableLog(content: unknown): LogEntry[] {
  const log = isRecord(content) ? content.log : undefined;
  return Array.isArray(log) ? log.filter(isLogEntry) : [];
}

/** The document to store for a change: what the project's settings now are, and the log with this change added. */
export function documentAfterChange(settings: Settings | null, log: LogEntry[], entry: LogEntry): object {
  return { version: CURRENT_VERSION, settings, log: [...log, entry].slice(-MAX_LOG_ENTRIES) };
}

/**
 * Applies a saved order to what the picklist has today: values it has lost go, and values it has
 * gained come last, in picklist order, marked as new. Nothing is written back until an administrator saves.
 */
export function orderPhases(phaseOrder: string[], picklistValues: string[]): Phase[] {
  const inPicklist = new Set(picklistValues);
  const inOrder = new Set(phaseOrder);
  return [
    ...phaseOrder.filter((phase) => inPicklist.has(phase)).map((name) => ({ name, isNew: false })),
    ...picklistValues.filter((phase) => !inOrder.has(phase)).map((name) => ({ name, isNew: true })),
  ];
}

/** The phases of a field no order has been saved for: as the picklist lists them. */
export function phasesInPicklistOrder(picklistValues: string[]): Phase[] {
  return picklistValues.map((name) => ({ name, isNew: false }));
}

/**
 * Divides today's phases, already in order, into their tabs. A phase no saved tab holds, as one the
 * picklist has gained, comes last on the last tab, and without saved tabs all phases share one.
 */
export function arrangeTabs(savedTabs: SavedTab[] | undefined, phases: Phase[]): PhaseTab[] {
  if (!savedTabs) return [{ name: DEFAULT_TAB_NAME, phases }];
  const saved = new Map(
    savedTabs.flatMap((tab, tabIndex) => tab.phases.map(({ name, dividerBefore }) => [name, { tabIndex, dividerBefore }] as const)),
  );
  const tabs: PhaseTab[] = savedTabs.map(({ name }) => ({ name, phases: [] }));
  for (const phase of phases) {
    const placement = saved.get(phase.name);
    const { phases: inTab } = tabs[placement?.tabIndex ?? tabs.length - 1];
    inTab.push(placement?.dividerBefore ? { ...phase, dividerBefore: placement.dividerBefore } : phase);
  }
  return tabs;
}

function requireOnlyKnownKeys(record: Record<string, unknown>, known: string[]): void {
  const unknown = Object.keys(record).filter((key) => !known.includes(key));
  if (unknown.length > 0) throw new InvalidSettingsError(`The saved settings are not valid: unknown content: ${unknown.join(", ")}.`);
}

function isLogEntry(entry: unknown): entry is LogEntry {
  return (
    isRecord(entry) &&
    typeof entry.at === "number" &&
    !Number.isNaN(new Date(entry.at).getTime()) &&
    isName(entry.userId) &&
    isName(entry.userName)
  );
}

function isWorkItemId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= MAX_WORK_ITEM_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Text as the settings panel saves it: not blank, and without spaces around it. */
function isTrimmedText(value: unknown): value is string {
  return isName(value) && value.trim() === value;
}
