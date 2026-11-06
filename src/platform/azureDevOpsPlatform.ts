import { getClient } from "azure-devops-extension-api";
import {
  CommonServiceIds,
  type IHostNavigationService,
  type IHostPageLayoutService,
  type ILocationService,
  type IProjectPageService,
} from "azure-devops-extension-api/Common";
import { ExtensionManagementRestClient } from "azure-devops-extension-api/ExtensionManagement";
import {
  FieldType,
  WorkItemErrorPolicy,
  WorkItemTrackingRestClient,
  WorkItemTrackingServiceIds,
  WorkItemTypeFieldsExpandLevel,
  type IWorkItemFormNavigationService,
  type WorkItemBatchGetRequest,
  type WorkItemField as ApiWorkItemField,
  type WorkItemTagDefinition,
} from "azure-devops-extension-api/WorkItemTracking";
import * as SDK from "azure-devops-extension-sdk";
import type { FieldKind, Platform } from "./platform";

const HOST_ANSWER_TIMEOUT_SECONDS = 30;

/** Extension Data Service has no project scope, so each project's document lies in the organization's scope under the project's id. */
function settingsCollection(): [publisher: string, extension: string, scopeType: string, scopeValue: string, collection: string] {
  const { publisherId, extensionId } = SDK.getExtensionContext();
  return [publisherId, extensionId, "Default", "Current", "settings"];
}

/** Declared in vss-extension.json. */
const SETTINGS_PANEL_CONTRIBUTION = "waypoint-settings-panel";

/**
 * The panel's page says here that it has started, which it has once the host has answered its handshake:
 * a page the host never answers may never be shown, so the hub keeps waiting for it. The hub and the panel
 * are pages of one extension on one host, and a channel needs nothing from Azure DevOps, which is what is
 * in doubt when a panel stays empty. A panel starting in another tab at the same moment counts too, which
 * costs one missing warning.
 */
const PANEL_STARTED_CHANNEL = `${SETTINGS_PANEL_CONTRIBUTION}-started`;

const PANEL_START_TIMEOUT_SECONDS = 30;

/**
 * Extension Data Service creates a missing document whatever revision the save names, and answers 400
 * if the document exists at another one. So this revision never overwrites anything, as -1 would.
 */
const REVISION_OF_A_NEW_DOCUMENT = 0;

/** The Project security namespace, and GENERIC_WRITE ("Edit project-level information") in it. */
const PROJECT_SECURITY_NAMESPACE = "52d39943-cb85-4d7f-8fa8-c6baac873819";
const EDIT_PROJECT_PERMISSION = 2;

/** The API package declares what a tag looks like, but has no call that reads the project's tags. */
class WorkItemTagClient extends WorkItemTrackingRestClient {
  getProjectTags(project: string): Promise<WorkItemTagDefinition[]> {
    return this.beginRequest({ apiVersion: "7.1", routeTemplate: "{project}/_apis/wit/tags", routeValues: { project } });
  }
}

/** The real platform. Must be created inside the Azure DevOps host page. */
export function createAzureDevOpsPlatform(): Platform {
  const handshake = SDK.init();

  /** Runs a call to Azure DevOps once the host has answered, and rejects with an Error if it fails or stalls. */
  const answered = <T>(call: () => Promise<T>): Promise<T> => answeredInTime(handshake.then(call));
  const workItemClient = () => getClient(WorkItemTrackingRestClient);
  const hostNavigation = () => SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);

  /** The fields on a type, none if the project has no such type, next to what the project says about each field. */
  const readFieldsOnType = async (projectId: string, workItemType: string, expand: WorkItemTypeFieldsExpandLevel) => {
    const client = workItemClient();
    const [typeFields, projectFields] = await Promise.all([
      client.getWorkItemTypeFieldsWithReferences(projectId, workItemType, expand).catch((error: { status?: number }) => {
        if (error.status === 404) return [];
        throw error;
      }),
      client.getFields(projectId),
    ]);
    return { typeFields, projectFields };
  };

  return {
    getProject: () =>
      answered(async () => {
        const projectPage = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const project = await projectPage.getProject();
        if (!project) throw new Error("Azure DevOps reported no project for this page.");
        return { id: project.id };
      }),

    getCurrentUser: () =>
      answered(async () => {
        const { id, displayName } = SDK.getUser();
        return { id, displayName };
      }),

    isProjectAdministrator: (projectId) =>
      answered(async () => {
        return canEditProject(projectId);
      }),

    getSettingsDocument: (projectId) =>
      answered(async () => {
        const document = await getClient(ExtensionManagementRestClient)
          .getDocumentByName(...settingsCollection(), projectId)
          .catch((error: { status?: number }) => {
            // Azure DevOps answers 404 both for a missing document and for a collection nothing has been saved to yet.
            if (error.status === 404) return null;
            throw error;
          });
        if (document === null) return null;
        // The rest is what was saved: these two are Extension Data Service's own.
        const content = Object.fromEntries(Object.entries(document).filter(([key]) => key !== "id" && key !== "__etag"));
        return { content, revision: document.__etag };
      }),

    saveSettingsDocument: (projectId, content, revision) =>
      answered(async () => {
        await getClient(ExtensionManagementRestClient).setDocumentByName(
          { ...content, id: projectId, __etag: revision ?? REVISION_OF_A_NEW_DOCUMENT },
          ...settingsCollection(),
        );
      }),

    getWorkItemTypes: (projectId) =>
      answered(async () => {
        const types = await workItemClient().getWorkItemTypes(projectId);
        return types.map((type) => type.name);
      }),

    getPicklistFields: (projectId, workItemType) =>
      answered(async () => {
        const { typeFields, projectFields } = await readFieldsOnType(projectId, workItemType, WorkItemTypeFieldsExpandLevel.AllowedValues);
        // System.State and other non-picklists also have allowed values, so those alone do not make a picklist field.
        const picklists = new Set(projectFields.filter((field) => field.isPicklist).map((field) => field.referenceName));
        return typeFields
          .filter((field) => picklists.has(field.referenceName))
          .map((field) => ({
            referenceName: field.referenceName,
            name: field.name,
            values: (field.allowedValues ?? []).map(String),
          }));
      }),

    getWorkItemFields: (projectId, workItemType) =>
      answered(async () => {
        const { typeFields, projectFields } = await readFieldsOnType(projectId, workItemType, WorkItemTypeFieldsExpandLevel.None);
        const byReference = new Map(projectFields.map((field) => [field.referenceName, field]));
        return typeFields.map(({ referenceName, name }) => ({ referenceName, name, kind: kindOf(byReference.get(referenceName)) }));
      }),

    getProjectTags: (projectId) =>
      answered(async () => {
        const tags = await getClient(WorkItemTagClient).getProjectTags(projectId);
        return tags.map(({ name }) => name);
      }),

    queryWorkItemIds: (projectId, workItemType) =>
      answered(async () => {
        const result = await workItemClient().queryByWiql({ query: flatQueryForType(workItemType) }, projectId);
        return result.workItems.map((workItem) => workItem.id);
      }),

    getWorkItemsBatch: (projectId, ids, fields) =>
      answered(async () => {
        const request = { ids, fields, errorPolicy: WorkItemErrorPolicy.Omit } as WorkItemBatchGetRequest;
        const answer = await workItemClient().getWorkItemsBatch(request, projectId);
        return answer.filter(Boolean).map(({ id, fields }) => ({ id, fields }));
      }),

    getQueryParams: () =>
      answered(async () => {
        const navigation = await hostNavigation();
        return navigation.getQueryParams();
      }),

    setQueryParams: (parameters) =>
      answered(async () => {
        const navigation = await hostNavigation();
        // Declared as returning nothing, but the host answers the call, also when it refuses.
        await navigation.setQueryParams(parameters);
      }),

    openSettingsPanel: async (onStartProblem) => {
      const layout = await answered(() => SDK.getService<IHostPageLayoutService>(CommonServiceIds.HostPageLayoutService));
      // Open until the panel closes, since a page that is only slow can still start after the timer.
      const pageStarted = new BroadcastChannel(PANEL_STARTED_CHANNEL);
      let hasStarted = false;
      const timer = setTimeout(
        () => onStartProblem(`The panel did not start within ${PANEL_START_TIMEOUT_SECONDS} seconds, so it may stay empty. Close it and try again.`),
        PANEL_START_TIMEOUT_SECONDS * 1000,
      );
      pageStarted.onmessage = () => {
        hasStarted = true;
        clearTimeout(timer);
        onStartProblem(null);
      };
      // Not under the timeout: the panel stays open for as long as the administrator works in it.
      return new Promise<boolean>((resolve) => {
        layout.openPanel<boolean>(`${SDK.getExtensionContext().id}.${SETTINGS_PANEL_CONTRIBUTION}`, {
          title: "Waypoint settings",
          // A stray click beside the panel must not throw away what the administrator has changed.
          lightDismiss: false,
          onClose: (saved) => {
            clearTimeout(timer);
            pageStarted.close();
            if (!hasStarted) onStartProblem("The panel was closed before it started. Open it and try again.");
            resolve(saved === true);
          },
        });
      });
    },

    announceSettingsPanelStarted: () => {
      void handshake.then(() => {
        const channel = new BroadcastChannel(PANEL_STARTED_CHANNEL);
        channel.postMessage("started");
        channel.close();
      });
    },

    closeSettingsPanel: (saved) =>
      answered(async () => {
        const panel = SDK.getConfiguration().panel as { close(result: boolean): Promise<void> } | undefined;
        if (!panel) throw new Error("Waypoint's settings are not open in a panel.");
        await panel.close(saved);
      }),

    openWorkItem: async (id) => {
      const navigation = await answered(() =>
        SDK.getService<IWorkItemFormNavigationService>(WorkItemTrackingServiceIds.WorkItemFormNavigationService),
      );
      // Not under the timeout: the host answers when the work item closes, however long it stays open.
      await navigation.openWorkItem(id).catch((rejection: unknown) => {
        throw asError(rejection);
      });
    },
  };
}

/**
 * Answers for the signed-in user, by a permission that only administrators hold by default. It
 * measures the permission rather than membership of Project Administrators. In the test organization
 * a Stakeholder got no and the owner yes, but a plain Project Administrator has not been tried, and
 * asking with `vso.work` alone is not documented, see #23. So anything but a clear yes or no is an
 * error. The API package has no client for this.
 */
async function canEditProject(projectId: string): Promise<boolean> {
  const location = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);
  const url = new URL(`_apis/permissions/${PROJECT_SECURITY_NAMESPACE}/${EDIT_PROJECT_PERMISSION}`, await location.getServiceLocation());
  url.searchParams.set("tokens", `$PROJECT:vstfs:///Classification/TeamProject/${projectId}`);
  url.searchParams.set("alwaysAllowAdministrators", "false");
  url.searchParams.set("api-version", "7.1");

  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${await SDK.getAccessToken()}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Azure DevOps answered ${response.status} when asked about permissions.`);
  const { value } = (await response.json()) as { value?: unknown[] };
  const canEdit = value?.[0];
  if (typeof canEdit !== "boolean") throw new Error("Azure DevOps gave no clear answer when asked about permissions.");
  return canEdit;
}

/** A field the project says nothing about counts as text, which is what most fields are. */
function kindOf(field: ApiWorkItemField | undefined): FieldKind {
  if (field?.isIdentity) return "identity";
  switch (field?.type) {
    case FieldType.Html:
    case FieldType.History:
      return "html";
    case FieldType.Boolean:
      return "yesNo";
    case FieldType.DateTime:
      return "date";
    default:
      return "text";
  }
}

function flatQueryForType(workItemType: string): string {
  const quotedType = `'${workItemType.replace(/'/g, "''")}'`;
  return `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = ${quotedType} ORDER BY [System.Id]`;
}

/** The SDK has no timeout of its own: a host that never answers would leave the hub waiting forever. */
function answeredInTime<T>(answer: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Azure DevOps did not answer within ${HOST_ANSWER_TIMEOUT_SECONDS} seconds.`)),
      HOST_ANSWER_TIMEOUT_SECONDS * 1000,
    );
    answer.then(resolve, (rejection: unknown) => reject(asError(rejection))).finally(() => clearTimeout(timer));
  });
}

/** XDM carries the host's rejections as JSON, so they arrive as plain values rather than as Error instances. */
function asError(rejection: unknown): Error {
  if (rejection instanceof Error) return rejection;
  const message = typeof rejection === "string" ? rejection : (rejection as { message?: unknown } | null)?.message;
  return new Error(typeof message === "string" && message ? message : "Azure DevOps rejected the call without a reason.");
}
