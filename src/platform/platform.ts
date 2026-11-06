/**
 * The platform adapter: the only seam between Waypoint and Azure DevOps.
 * Everything else in the code talks to this interface, never to the SDK.
 * Every method rejects with an Error if Azure DevOps cannot answer.
 */
export interface Platform {
  /** The project the hub is open in. */
  getProject(): Promise<Project>;
  /** Who is signed in. */
  getCurrentUser(): Promise<User>;
  /**
   * Whether the signed-in user administers the project. It decides what the hub offers,
   * not what the user can do: storage does not enforce it, see SECURITY.md.
   */
  isProjectAdministrator(projectId: string): Promise<boolean>;
  /** The project's stored settings document as it lies in storage, or null if nothing has been saved. */
  getSettingsDocument(projectId: string): Promise<StoredDocument | null>;
  /**
   * Replaces the project's settings document. `revision` is the revision the change was based on, or
   * null if nothing was saved. Rejects without saving if someone else has saved since.
   */
  saveSettingsDocument(projectId: string, content: object, revision: number | null): Promise<void>;
  /** The names of the project's work item types. */
  getWorkItemTypes(projectId: string): Promise<string[]>;
  /**
   * The picklist fields on a work item type, in the order Azure DevOps lists them, each with its
   * values in picklist order. Empty if the project has no work item type by that name.
   */
  getPicklistFields(projectId: string, workItemType: string): Promise<PicklistField[]>;
  /** Every field on a work item type. Empty if the project has no work item type by that name. */
  getWorkItemFields(projectId: string, workItemType: string): Promise<WorkItemField[]>;
  /** The names of the project's tags, in no order to rely on. */
  getProjectTags(projectId: string): Promise<string[]>;
  /** The ids of every work item of a type in the project. */
  queryWorkItemIds(projectId: string, workItemType: string): Promise<number[]>;
  /**
   * Reads at most {@link MAX_WORK_ITEMS_PER_BATCH} work items, in the order asked for. A work item
   * that no longer exists or cannot be read is left out, and so is every field that is empty or that
   * the work item's type does not have. Rejects the whole batch if a field does not exist at all.
   */
  getWorkItemsBatch(projectId: string, ids: number[], fields: string[]): Promise<WorkItem[]>;
  /** The query parameters in the host page's URL. Not to be trusted: anyone can write a link. */
  getQueryParams(): Promise<Record<string, string>>;
  /** Adds or changes the given query parameters in the host page's URL, and removes those with an empty value. Others stay. */
  setQueryParams(parameters: Record<string, string>): Promise<void>;
  /**
   * Opens the settings panel. Settles when the panel has closed, with whether anything was saved. The
   * host draws the panel whether or not its page ever comes up, so `onStartProblem` hears what is wrong
   * when the page has not announced itself, and null once it has, which a slow page can still do later.
   */
  openSettingsPanel(onStartProblem: (problem: string | null) => void): Promise<boolean>;
  /** Tells the hub, from inside the settings panel, that the panel's page has started: it is running and the host has answered it. Until the host has, the hub hears nothing. */
  announceSettingsPanelStarted(): void;
  /** Closes the settings panel from inside it, and says whether anything was saved. */
  closeSettingsPanel(saved: boolean): Promise<void>;
  /** Opens a work item in Azure DevOps. Settles when it has closed again. */
  openWorkItem(id: number): Promise<void>;
}

/** Azure DevOps rejects a `workitemsbatch` call asking for more than this. */
export const MAX_WORK_ITEMS_PER_BATCH = 200;

export interface Project {
  id: string;
}

export interface User {
  id: string;
  displayName: string;
}

export interface StoredDocument {
  /** Not to be trusted: anyone who can open the hub can write it. */
  content: unknown;
  /** Identifies this version of the document, so that a save can tell if someone else has saved since. */
  revision: number;
}

export interface PicklistField {
  referenceName: string;
  name: string;
  values: string[];
}

/** What a field's value is, as far as using it goes. */
export type FieldKind = "text" | "html" | "yesNo" | "date" | "identity";

export interface WorkItemField {
  referenceName: string;
  name: string;
  kind: FieldKind;
}

export interface WorkItem {
  id: number;
  fields: Record<string, unknown>;
}
