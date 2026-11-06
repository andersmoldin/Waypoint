import type { FakeWorkItem, FakeWorld } from "../platform/fakePlatform";
import type { PicklistField, WorkItemField } from "../platform/platform";

export const PHASE_FIELD = "Custom.Livscykel";

export const PHASES = [
  "Idéfas",
  "Under utvärdering",
  "Under planering",
  "Under utveckling",
  "I produktion",
  "Pausad",
  "Under avveckling",
  "Avvecklad",
  "Avfärdad",
];

/** How we divide {@link PHASES} into tabs, the way it lies in a settings document. */
export const OUR_TABS = [
  { name: "Före produktion", phases: [{ name: "Idéfas" }, { name: "Under utvärdering" }, { name: "Under planering" }, { name: "Under utveckling" }] },
  { name: "Drift", phases: [{ name: "I produktion" }, { name: "Pausad" }] },
  { name: "Avslut", phases: [{ name: "Under avveckling" }, { name: "Avvecklad" }, { name: "Avfärdad", dividerBefore: "Blev aldrig av" }] },
];

const LIVSCYKEL: PicklistField = { referenceName: PHASE_FIELD, name: "Livscykel", values: PHASES };

/** The fields on a process besides Livscykel, as our organization has them. */
export const AKTUELLT_LAGE: WorkItemField = { referenceName: "Custom.AktuelltLage", name: "Aktuellt läge", kind: "html" };
export const VANTAR_PA: WorkItemField = { referenceName: "Custom.VantarPa", name: "Väntar på", kind: "text" };
export const FORBATTRING_PAGAR: WorkItemField = { referenceName: "Custom.ForbattringPagar", name: "Förbättring pågår", kind: "yesNo" };
export const GKL: WorkItemField = { referenceName: "Custom.GKL", name: "GKL", kind: "text" };
export const ASSIGNED_TO: WorkItemField = { referenceName: "System.AssignedTo", name: "Assigned To", kind: "identity" };
export const CREATED_DATE: WorkItemField = { referenceName: "System.CreatedDate", name: "Created Date", kind: "date" };

/** The roles on our organization's cards, for saved settings. */
export const OUR_ROLES = {
  currentSituation: AKTUELLT_LAGE.referenceName,
  waitingOn: VANTAR_PA.referenceName,
  marker: FORBATTRING_PAGAR.referenceName,
};

/** A robot: the group in our organization. */
export function robot(id: number, title: string): FakeWorkItem {
  return { id, type: "Epic", fields: { "System.Title": title } };
}

/** A process: the object in our organization. Leave out `phase` or `parent` for an empty field. */
export function process(id: number, title: string, phase?: string, parent?: number): FakeWorkItem {
  return { id, type: "Feature", fields: { "System.Title": title, [PHASE_FIELD]: phase, "System.Parent": parent } };
}

/** The stored document of a project whose settings match a project shaped like ours, with the given settings changed. */
export function savedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    settings: { objectType: "Feature", groupType: "Epic", phaseField: PHASE_FIELD, phaseOrder: PHASES, ...overrides },
    log: [],
  };
}

/** A project shaped like ours, where Livscykel is the only picklist field on a process. */
export function lifecycleWorld(workItems: FakeWorkItem[], rest: FakeWorld = {}): FakeWorld {
  return {
    workItemTypes: ["Epic", "Feature"],
    picklistFields: { Feature: [LIVSCYKEL] },
    workItemFields: { Feature: [AKTUELLT_LAGE, VANTAR_PA, FORBATTRING_PAGAR, GKL, ASSIGNED_TO, CREATED_DATE] },
    workItems,
    ...rest,
  };
}
