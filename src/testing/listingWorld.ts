import type { FakeWorkItem, FakeWorld } from "../platform/fakePlatform";
import type { WorkItemField } from "../platform/platform";

// Invented data, for what a real browser draws: the Marketplace screenshot and the checks in browser/.

export const PHASE_FIELD = "Custom.Phase";
export const PHASES = ["Idea", "Planning", "Development", "Production", "Paused", "Retired"];

export const CURRENT_SITUATION: WorkItemField = { referenceName: "Custom.CurrentSituation", name: "Current situation", kind: "html" };
export const WAITING_ON: WorkItemField = { referenceName: "Custom.WaitingOn", name: "Waiting on", kind: "text" };
export const IMPROVING: WorkItemField = { referenceName: "Custom.ImprovementUnderWay", name: "Improvement under way", kind: "yesNo" };

const group = (id: number, title: string): FakeWorkItem => ({ id, type: "Epic", fields: { "System.Title": title } });

const object = (id: number, title: string, phase: string, parent: number, rest: Record<string, unknown> = {}): FakeWorkItem => ({
  id,
  type: "Feature",
  fields: { "System.Title": title, [PHASE_FIELD]: phase, "System.Parent": parent, ...rest },
});

const situation = (html: string) => ({ [CURRENT_SITUATION.referenceName]: html });
const waitingOn = (who: string) => ({ [WAITING_ON.referenceName]: who });
const improving = { [IMPROVING.referenceName]: true };

export const LISTING_SETTINGS = {
  objectType: "Feature",
  groupType: "Epic",
  phaseField: PHASE_FIELD,
  phaseOrder: PHASES,
  roles: { currentSituation: CURRENT_SITUATION.referenceName, waitingOn: WAITING_ON.referenceName, marker: IMPROVING.referenceName },
};

export const LISTING_WORLD: FakeWorld = {
  workItemTypes: ["Epic", "Feature"],
  savedSettings: { "project-1": { version: 1, settings: LISTING_SETTINGS, log: [{ at: Date.UTC(2026, 10, 2, 9), userId: "user-1", userName: "Ada Admin" }] } },
  picklistFields: { Feature: [{ referenceName: PHASE_FIELD, name: "Phase", values: PHASES }] },
  workItemFields: { Feature: [CURRENT_SITUATION, WAITING_ON, IMPROVING] },
  workItems: [
    group(1, "Invoicing"),
    group(2, "Onboarding"),
    group(3, "Reporting"),
    object(11, "Scan incoming invoices", "Idea", 1, situation("<p>Comparing two ways to read the supplier's layout.</p>")),
    object(12, "Match invoices to orders", "Development", 1, { ...situation("<p>Second test run on last month's invoices.</p>"), ...waitingOn("Access to the ledger") }),
    object(13, "Send payment reminders", "Production", 1, { ...situation("<p>New wording goes live with the next run.</p>"), ...improving }),
    object(14, "Archive paid invoices", "Paused", 1, situation("<p>Paused while the retention rules are reviewed.</p>")),
    object(21, "Create accounts for new hires", "Planning", 2, waitingOn("Security review")),
    object(22, "Order equipment", "Idea", 2),
    object(23, "Send welcome letters", "Production", 2),
    object(24, "Print badges", "Planning", 2, situation("<p>Estimating the printer integration.</p>")),
    object(31, "Monthly sales report", "Production", 3, improving),
    object(32, "Inventory report", "Paused", 3, waitingOn("Warehouse team")),
    object(33, "Fax summary", "Retired", 3),
    object(34, "Quarterly forecast", "Idea", 3),
    object(35, "Audit extract", "Development", 3, situation("<p>Fields agreed with the auditors. Building the export.</p>")),
  ],
};
