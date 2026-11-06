import { MAX_WORK_ITEMS_PER_BATCH, type PicklistField, type Platform, type StoredDocument, type User, type WorkItemField } from "./platform";

export interface FakeWorkItem {
  id: number;
  type: string;
  fields: Record<string, unknown>;
  /** Lies in another project: `workitemsbatch` can still read it, but a query for the project's work items does not find it. */
  inAnotherProject?: boolean;
}

/** What the fake's Azure DevOps holds. Anything left out is simply not there. */
export interface FakeWorld {
  projectId?: string;
  /** The signed-in user. */
  user?: User;
  /** Whether the signed-in user administers the project. */
  isAdministrator?: boolean;
  /** The stored settings document of each project, by project id. */
  savedSettings?: Record<string, unknown>;
  /** The project's work item types. By default, those that have picklist fields or work items here. */
  workItemTypes?: string[];
  picklistFields?: Record<string, PicklistField[]>;
  /** The fields of each work item type, besides its picklist fields. */
  workItemFields?: Record<string, WorkItemField[]>;
  /** The project's tags. By default, those the work items here have. */
  projectTags?: string[];
  workItems?: FakeWorkItem[];
  /** The query parameters in the URL the hub is opened with. */
  queryParams?: Record<string, string>;
  /** How the settings panel's page comes up: in time, only once the test lets it, or never. By default in time. */
  settingsPanelStart?: "in-time" | "late" | "never";
  /** Makes one platform method reject with the given error. */
  failures?: Partial<Record<keyof Platform, Error>>;
}

export interface FakePlatform extends Platform {
  /** Tells the listener each time the settings panel opens or closes, the way the host shows and removes it. */
  onSettingsPanelChange(listener: (open: boolean) => void): void;
  /** Whether the settings panel's page has announced itself. */
  settingsPanelHasStarted(): boolean;
  /** Brings up a settings panel whose page is late. */
  letSettingsPanelStart(): void;
  /** The ids of the work items opened in Azure DevOps so far. */
  openedWorkItems: number[];
}

/** An in-memory platform for tests. It answers the way Azure DevOps does, down to the quirks of `workitemsbatch`. */
export function createFakePlatform(world: FakeWorld = {}): FakePlatform {
  const {
    projectId = "project-1",
    user = { id: "user-1", displayName: "Ada Admin" },
    isAdministrator = false,
    savedSettings = {},
    picklistFields = {},
    workItemFields = {},
    workItems = [],
    workItemTypes = [...new Set([...Object.keys(picklistFields), ...workItems.map((item) => item.type)])],
    projectTags = [...new Set(workItems.flatMap((item) => tagsIn(item)))],
    queryParams: queryParamsAtStart = {},
    settingsPanelStart = "in-time",
    failures = {},
  } = world;

  const documents = new Map<string, StoredDocument>(
    Object.entries(savedSettings).map(([id, content]) => [id, { content, revision: 1 }]),
  );
  let queryParams = queryParamsAtStart;
  const opened: number[] = [];
  let panelListener: (open: boolean) => void = () => undefined;
  let answerPanelOpener: (saved: boolean) => void = () => undefined;
  let panelHasStarted = false;
  let reportStartProblem: (problem: string | null) => void = () => undefined;

  const answering = <Method extends keyof Platform>(method: Method, answer: Platform[Method]): Platform[Method] =>
    (async (...args: never[]) => {
      const failure = failures[method];
      if (failure) throw failure;
      return (answer as (...args: never[]) => unknown)(...args);
    }) as Platform[Method];

  const fieldsOf = (type: string): WorkItemField[] => [
    ...(picklistFields[type] ?? []).map(({ referenceName, name }) => ({ referenceName, name, kind: "text" as const })),
    ...(workItemFields[type] ?? []),
  ];
  const fieldExists = (field: string) =>
    field.startsWith("System.") ||
    [...Object.keys(picklistFields), ...Object.keys(workItemFields)].some((type) => fieldsOf(type).some(({ referenceName }) => referenceName === field));

  const requireThisProject = (id: string) => {
    if (id !== projectId) throw new Error(`The fake holds only project ${projectId}, not ${id}.`);
  };

  return {
    onSettingsPanelChange: (listener) => {
      panelListener = listener;
    },
    settingsPanelHasStarted: () => panelHasStarted,
    letSettingsPanelStart: () => panelListener(true),
    openedWorkItems: opened,
    getProject: answering("getProject", async () => ({ id: projectId })),
    getCurrentUser: answering("getCurrentUser", async () => user),
    isProjectAdministrator: answering("isProjectAdministrator", async (id) => {
      requireThisProject(id);
      return isAdministrator;
    }),
    getSettingsDocument: answering("getSettingsDocument", async (id) => documents.get(id) ?? null),
    saveSettingsDocument: answering("saveSettingsDocument", async (id, content, revision) => {
      const stored = documents.get(id);
      // Extension Data Service creates a missing document whatever the revision, and answers a save
      // based on any other revision than the document's with 400 and saves nothing.
      if (stored && stored.revision !== revision) throw new Error("The document has changed since it was read.");
      documents.set(id, { content: JSON.parse(JSON.stringify(content)), revision: (stored?.revision ?? 0) + 1 });
    }),
    getWorkItemTypes: answering("getWorkItemTypes", async (id) => {
      requireThisProject(id);
      return workItemTypes;
    }),
    getPicklistFields: answering("getPicklistFields", async (id, type) => {
      requireThisProject(id);
      return picklistFields[type] ?? [];
    }),
    getWorkItemFields: answering("getWorkItemFields", async (id, type) => {
      requireThisProject(id);
      return fieldsOf(type);
    }),
    getProjectTags: answering("getProjectTags", async (id) => {
      requireThisProject(id);
      return projectTags;
    }),
    queryWorkItemIds: answering("queryWorkItemIds", async (id, type) => {
      requireThisProject(id);
      return workItems.filter((item) => item.type === type && !item.inAnotherProject).map((item) => item.id);
    }),
    getWorkItemsBatch: answering("getWorkItemsBatch", async (projectIdAsked, ids, fields) => {
      requireThisProject(projectIdAsked);
      if (ids.length > MAX_WORK_ITEMS_PER_BATCH) {
        throw new Error(`A batch can read at most ${MAX_WORK_ITEMS_PER_BATCH} work items.`);
      }
      const unknownField = fields.find((field) => !fieldExists(field));
      if (unknownField) throw new Error(`TF51535: Cannot find field ${unknownField}.`);
      return ids.flatMap((id) => {
        const item = workItems.find((candidate) => candidate.id === id);
        return item ? [{ id, fields: answeredFields(item, fields) }] : [];
      });
    }),
    getQueryParams: answering("getQueryParams", async () => queryParams),
    setQueryParams: answering("setQueryParams", async (parameters) => {
      queryParams = Object.fromEntries(Object.entries({ ...queryParams, ...parameters }).filter(([, value]) => value !== ""));
    }),
    openSettingsPanel: answering(
      "openSettingsPanel",
      (onStartProblem) =>
        new Promise<boolean>((resolve) => {
          answerPanelOpener = resolve;
          reportStartProblem = onStartProblem;
          if (settingsPanelStart === "in-time") panelListener(true);
          else onStartProblem("The panel did not start in time.");
        }),
    ),
    announceSettingsPanelStarted: () => {
      panelHasStarted = true;
      reportStartProblem(null);
    },
    closeSettingsPanel: answering("closeSettingsPanel", async (saved) => {
      panelListener(false);
      answerPanelOpener(saved);
    }),
    openWorkItem: answering("openWorkItem", async (id) => {
      opened.push(id);
      // The host's dialog takes the focus, and the browser then clears it in the hub's frame.
      (document.activeElement as HTMLElement | null)?.blur();
    }),
  };
}

function tagsIn(item: FakeWorkItem): string[] {
  const tags = item.fields["System.Tags"];
  return typeof tags === "string" ? tags.split("; ") : [];
}

/** `workitemsbatch` leaves empty fields out of its answer instead of returning them empty. */
function answeredFields(item: FakeWorkItem, asked: string[]): Record<string, unknown> {
  const stored: Record<string, unknown> = { "System.WorkItemType": item.type, ...item.fields };
  return Object.fromEntries(
    asked.flatMap((field) => {
      const value = stored[field];
      return value === undefined || value === null || value === "" ? [] : [[field, value]];
    }),
  );
}
