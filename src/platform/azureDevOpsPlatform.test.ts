import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../vss-extension.json";
import { createAzureDevOpsPlatform } from "./azureDevOpsPlatform";
import type { Platform } from "./platform";

const PROJECT_ID = "project-1";

describe("the real platform outside a responding Azure DevOps host", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up visibly instead of waiting forever", async () => {
    const project = createAzureDevOpsPlatform().getProject();
    const outcome = expect(project).rejects.toThrow("Azure DevOps did not answer within 30 seconds.");

    await vi.advanceTimersByTimeAsync(30_000);

    await outcome;
  });
});

describe("the real platform when the Azure DevOps host rejects a call", () => {
  let stopHost: () => void;
  afterEach(() => stopHost());

  it.each([
    ["an error object", { name: "AccessDeniedError", message: "Access denied." }, "Access denied."],
    ["plain text", "Access denied.", "Access denied."],
    ["an object without a message", { status: 500 }, "Azure DevOps rejected the call without a reason."],
  ])("rejects with an Error when the rejection is %s", async (_kind, rejection, expectedMessage) => {
    stopHost = playHost({ rejectingServiceRequestsWith: rejection }).stop;

    const failure = await createAzureDevOpsPlatform()
      .getProject()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(expectedMessage);
  });
});

describe("the real platform against Azure DevOps", () => {
  let stopHost: () => void;
  const fetched = vi.fn<(request: { url: string; method: string; body: unknown }) => ServerAnswer>();

  beforeEach(() => {
    fetched.mockReset();
    stopHost = playHost({}).stop;
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      const { status = 200, body } = fetched({
        url,
        method: options.method ?? "GET",
        body: options.body ? JSON.parse(options.body as string) : undefined,
      });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    });
  });

  afterEach(() => {
    stopHost();
    vi.unstubAllGlobals();
  });

  it("identifies the project by the id the host gives", async () => {
    await expect(createAzureDevOpsPlatform().getProject()).resolves.toEqual({ id: PROJECT_ID });
  });

  it("asks for the ids of one work item type in the project with a flat query", async () => {
    fetched.mockReturnValue({ body: { workItems: [{ id: 17 }, { id: 18 }] } });

    const ids = await createAzureDevOpsPlatform().queryWorkItemIds(PROJECT_ID, "Feature");

    expect(ids).toEqual([17, 18]);
    const [{ url, method, body }] = fetched.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toContain(`/${PROJECT_ID}/_apis/wit/wiql`);
    expect(body).toEqual({
      query:
        "SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Feature' ORDER BY [System.Id]",
    });
  });

  it("cannot be made to run another query through a work item type name", async () => {
    fetched.mockReturnValue({ body: { workItems: [] } });

    await createAzureDevOpsPlatform().queryWorkItemIds(PROJECT_ID, "x' OR [System.Id] > 0 OR 'x' = 'x");

    expect((fetched.mock.calls[0][0].body as { query: string }).query).toContain(
      "[System.WorkItemType] = 'x'' OR [System.Id] > 0 OR ''x'' = ''x' ORDER BY",
    );
  });

  it("passes on the refusal when a project has more work items than a query may return", async () => {
    const refusal = "VS402337: The number of work items returned exceeds the size limit of 20000.";
    fetched.mockReturnValue({ status: 400, body: { message: refusal } });

    await expect(createAzureDevOpsPlatform().queryWorkItemIds(PROJECT_ID, "Feature")).rejects.toThrow(refusal);
  });

  it("passes on a failure to read a batch", async () => {
    fetched.mockReturnValue({ status: 500, body: { message: "The server broke." } });

    await expect(createAzureDevOpsPlatform().getWorkItemsBatch(PROJECT_ID, [17], ["System.Title"])).rejects.toThrow(
      "The server broke.",
    );
  });

  it("reads work items without failing the whole batch for one that is gone", async () => {
    fetched.mockReturnValue({
      body: [{ id: 17, rev: 3, fields: { "System.Title": "En process" } }, null],
    });

    const items = await createAzureDevOpsPlatform().getWorkItemsBatch(PROJECT_ID, [17, 999], ["System.Title", "System.Parent"]);

    expect(items).toEqual([{ id: 17, fields: { "System.Title": "En process" } }]);
    const [{ url, method, body }] = fetched.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toContain(`/${PROJECT_ID}/_apis/wit/workItemsBatch`);
    expect(body).toEqual({ ids: [17, 999], fields: ["System.Title", "System.Parent"], errorPolicy: 2 });
  });

  it("counts only real picklist fields on the type, in the order Azure DevOps lists them", async () => {
    fetched.mockImplementation(({ url }) =>
      url.includes("/workitemtypes/Feature/fields")
        ? {
            body: [
              { referenceName: "System.State", name: "State", allowedValues: ["New", "Closed"] },
              { referenceName: "Custom.Forvaltningsomrade", name: "Förvaltningsområde", allowedValues: ["Inköp", "Ekonomi"] },
              { referenceName: "Custom.Niva", name: "Nivå", allowedValues: [3, 1] },
              { referenceName: "Custom.Utan", name: "Utan värden" },
            ],
          }
        : {
            body: [
              { referenceName: "Custom.Annan", isPicklist: true },
              { referenceName: "Custom.Niva", isPicklist: true },
              { referenceName: "Custom.Utan", isPicklist: true },
              { referenceName: "Custom.Forvaltningsomrade", isPicklist: true },
              { referenceName: "System.State", isPicklist: false },
            ],
          },
    );

    const fields = await createAzureDevOpsPlatform().getPicklistFields(PROJECT_ID, "Feature");

    expect(fields).toEqual([
      { referenceName: "Custom.Forvaltningsomrade", name: "Förvaltningsområde", values: ["Inköp", "Ekonomi"] },
      { referenceName: "Custom.Niva", name: "Nivå", values: ["3", "1"] },
      { referenceName: "Custom.Utan", name: "Utan värden", values: [] },
    ]);
    const fieldsUrl = fetched.mock.calls.map(([{ url }]) => url).find((url) => url.includes("workitemtypes"));
    expect(decodeURIComponent(fieldsUrl ?? "")).toContain("$expand=1");
  });

  it("finds no picklist fields on a work item type the project does not have", async () => {
    fetched.mockImplementation(({ url }) =>
      url.includes("/workitemtypes/")
        ? { status: 404, body: { message: "VS402323: Work item type Feature does not exist in project." } }
        : { body: [] },
    );

    await expect(createAzureDevOpsPlatform().getPicklistFields(PROJECT_ID, "Feature")).resolves.toEqual([]);
  });

  it("passes on any other failure to read the fields", async () => {
    fetched.mockImplementation(({ url }) =>
      url.includes("/workitemtypes/") ? { status: 500, body: { message: "The server broke." } } : { body: [] },
    );

    await expect(createAzureDevOpsPlatform().getPicklistFields(PROJECT_ID, "Feature")).rejects.toThrow("The server broke.");
  });

  it("tells what kind of value each field on a type holds, by the numbers Azure DevOps answers this client with", async () => {
    fetched.mockImplementation(({ url }) =>
      url.includes("/workitemtypes/Feature/fields")
        ? {
            body: [
              { referenceName: "Custom.GKL", name: "GKL" },
              { referenceName: "Custom.Beskrivning", name: "Beskrivning" },
              { referenceName: "System.History", name: "History" },
              { referenceName: "Custom.Pagar", name: "Pågår" },
              { referenceName: "System.CreatedDate", name: "Created Date" },
              { referenceName: "System.AssignedTo", name: "Assigned To" },
              { referenceName: "Custom.Niva", name: "Nivå" },
              { referenceName: "Custom.Okand", name: "Okänd för projektet" },
            ],
          }
        : {
            body: [
              { referenceName: "Custom.Annan", type: 9, isIdentity: false },
              { referenceName: "Custom.GKL", type: 0, isIdentity: false },
              { referenceName: "Custom.Beskrivning", type: 4, isIdentity: false },
              { referenceName: "System.History", type: 6, isIdentity: false },
              { referenceName: "Custom.Pagar", type: 9, isIdentity: false },
              { referenceName: "System.CreatedDate", type: 2, isIdentity: false },
              { referenceName: "System.AssignedTo", type: 0, isIdentity: true },
              { referenceName: "Custom.Niva", type: 1, isIdentity: false },
            ],
          },
    );

    const fields = await createAzureDevOpsPlatform().getWorkItemFields(PROJECT_ID, "Feature");

    expect(fields).toEqual([
      { referenceName: "Custom.GKL", name: "GKL", kind: "text" },
      { referenceName: "Custom.Beskrivning", name: "Beskrivning", kind: "html" },
      { referenceName: "System.History", name: "History", kind: "html" },
      { referenceName: "Custom.Pagar", name: "Pågår", kind: "yesNo" },
      { referenceName: "System.CreatedDate", name: "Created Date", kind: "date" },
      { referenceName: "System.AssignedTo", name: "Assigned To", kind: "identity" },
      { referenceName: "Custom.Niva", name: "Nivå", kind: "text" },
      { referenceName: "Custom.Okand", name: "Okänd för projektet", kind: "text" },
    ]);
  });

  it("finds no fields on a work item type the project does not have", async () => {
    fetched.mockImplementation(({ url }) =>
      url.includes("/workitemtypes/")
        ? { status: 404, body: { message: "VS402323: Work item type Feature does not exist in project." } }
        : { body: [] },
    );

    await expect(createAzureDevOpsPlatform().getWorkItemFields(PROJECT_ID, "Feature")).resolves.toEqual([]);
  });

  it("reads the names of the project's tags", async () => {
    fetched.mockReturnValue({
      body: [
        { id: "a", name: "IT-stöd: Dokportalen", lastUpdated: "/Date(1)/" },
        { id: "b", name: "Internt", lastUpdated: "/Date(2)/" },
      ],
    });

    await expect(createAzureDevOpsPlatform().getProjectTags(PROJECT_ID)).resolves.toEqual(["IT-stöd: Dokportalen", "Internt"]);
    const [{ url, method }] = fetched.mock.calls[0];
    expect(method).toBe("GET");
    expect(url).toContain(`/${PROJECT_ID}/_apis/wit/tags`);
  });

  it("passes on a failure to read the tags", async () => {
    fetched.mockReturnValue({ status: 403, body: { message: "TF400813: Not authorized." } });

    await expect(createAzureDevOpsPlatform().getProjectTags(PROJECT_ID)).rejects.toThrow("TF400813: Not authorized.");
  });

  const SETTINGS_DOCUMENTS =
    "/_apis/ExtensionManagement/InstalledExtensions/andersmoldin/waypoint-dev/Data/Scopes/Default/Current/Collections/settings/Documents";

  it("reads the settings document of this project from the organization's shared scope", async () => {
    fetched.mockReturnValue({ body: { id: PROJECT_ID, __etag: 7, version: 1, log: [] } });

    await expect(createAzureDevOpsPlatform().getSettingsDocument(PROJECT_ID)).resolves.toEqual({
      content: { version: 1, log: [] },
      revision: 7,
    });
    // A request a previous test left in flight can land here too, so this one is picked out by its address.
    const request = fetched.mock.calls.map(([call]) => call).find(({ url }) => url.includes(SETTINGS_DOCUMENTS));
    expect(request?.method).toBe("GET");
    expect(request?.url).toContain(`${SETTINGS_DOCUMENTS}/${PROJECT_ID}`);
  });

  it("reports that nothing is saved when the document does not exist", async () => {
    fetched.mockReturnValue({ status: 404, body: { message: "The collection does not exist" } });

    await expect(createAzureDevOpsPlatform().getSettingsDocument(PROJECT_ID)).resolves.toBeNull();
  });

  it("passes on any other failure to read the settings document", async () => {
    fetched.mockReturnValue({ status: 500, body: { message: "The server broke." } });

    await expect(createAzureDevOpsPlatform().getSettingsDocument(PROJECT_ID)).rejects.toThrow("The server broke.");
  });

  it("saves the settings document under the project's id, based on the revision it read", async () => {
    fetched.mockReturnValue({ body: {} });

    await createAzureDevOpsPlatform().saveSettingsDocument(PROJECT_ID, { version: 1 }, 7);

    const [{ url, method, body }] = fetched.mock.calls[0];
    expect(method).toBe("PUT");
    expect(url).toContain(SETTINGS_DOCUMENTS);
    expect(url).not.toContain(PROJECT_ID);
    expect(body).toEqual({ id: PROJECT_ID, __etag: 7, version: 1 });
  });

  it("does not overwrite a document someone else has created when it read that there was none", async () => {
    fetched.mockReturnValue({ body: {} });

    await createAzureDevOpsPlatform().saveSettingsDocument(PROJECT_ID, { version: 1 }, null);

    // Extension Data Service creates a missing document whatever the revision, and answers 400 if there is one. Only -1 overwrites.
    expect(fetched.mock.calls[0][0].body).toEqual({ id: PROJECT_ID, __etag: 0, version: 1 });
  });

  it("rejects when someone else has saved since the document was read", async () => {
    fetched.mockReturnValue({ status: 400, body: { message: "The document has been changed." } });

    await expect(createAzureDevOpsPlatform().saveSettingsDocument(PROJECT_ID, { version: 1 }, 7)).rejects.toThrow(
      "The document has been changed.",
    );
  });

  it.each([
    [[true], true],
    [[false], false],
  ])("asks whether the user may edit the project, and gets %j", async (answer, expected) => {
    fetched.mockReturnValue({ body: { count: 1, value: answer } });

    await expect(createAzureDevOpsPlatform().isProjectAdministrator(PROJECT_ID)).resolves.toBe(expected);

    const url = new URL(fetched.mock.calls[0][0].url);
    // GENERIC_WRITE ("Edit project-level information") in the Project security namespace.
    expect(url.pathname).toContain("/_apis/permissions/52d39943-cb85-4d7f-8fa8-c6baac873819/2");
    expect(url.searchParams.get("tokens")).toBe(`$PROJECT:vstfs:///Classification/TeamProject/${PROJECT_ID}`);
    expect(url.searchParams.get("alwaysAllowAdministrators")).toBe("false");
  });

  it("rejects when it cannot tell whether the user may edit the project", async () => {
    fetched.mockReturnValueOnce({ status: 401, body: { message: "Not authorized." } });
    await expect(createAzureDevOpsPlatform().isProjectAdministrator(PROJECT_ID)).rejects.toThrow("401");

    fetched.mockReturnValueOnce({ body: { count: 0, value: [] } });
    await expect(createAzureDevOpsPlatform().isProjectAdministrator(PROJECT_ID)).rejects.toThrow("no clear answer");
  });

  it("identifies itself when asking about permissions", async () => {
    let headers: HeadersInit | undefined;
    vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
      headers = options.headers;
      return new Response(JSON.stringify({ count: 1, value: [true] }));
    });

    await createAzureDevOpsPlatform().isProjectAdministrator(PROJECT_ID);

    expect(headers).toMatchObject({ Authorization: "Bearer host-token" });
  });

  it("knows who is signed in from the host", async () => {
    await expect(createAzureDevOpsPlatform().getCurrentUser()).resolves.toEqual({ id: "user-1", displayName: "Ada Admin" });
  });

  it("lists the project's work item types", async () => {
    fetched.mockReturnValue({ body: [{ name: "Feature", isDisabled: false }, { name: "Issue", isDisabled: true }] });

    // A disabled type can still have work items, so saved settings naming one must keep working.
    await expect(createAzureDevOpsPlatform().getWorkItemTypes(PROJECT_ID)).resolves.toEqual(["Feature", "Issue"]);
    expect(fetched.mock.calls[0][0].url).toContain(`/${PROJECT_ID}/_apis/wit/workItemTypes`);
  });

  it("reads the query parameters of the host page", async () => {
    await expect(createAzureDevOpsPlatform().getQueryParams()).resolves.toEqual({ tab: "Drift" });
  });

  it("writes query parameters to the host page", async () => {
    stopHost();
    const written: unknown[] = [];
    stopHost = playHost({ onSetQueryParams: (parameters) => written.push(parameters) }).stop;

    await createAzureDevOpsPlatform().setQueryParams({ tab: "Avslut" });

    expect(written).toEqual([{ tab: "Avslut" }]);
  });

  it("opens the panel the manifest declares, in a way that keeps unsaved work from a stray click, and settles when it closes", async () => {
    stopHost();
    const opened: { contributionId: string; options: { lightDismiss: boolean; onClose: HostProxy } }[] = [];
    let callBack: (proxy: HostProxy, ...args: unknown[]) => void = () => undefined;
    const host = playHost({ onOpenPanel: (contributionId, options) => opened.push({ contributionId, options: options as never }) });
    stopHost = host.stop;
    callBack = host.callBack;

    const closed = createAzureDevOpsPlatform().openSettingsPanel(() => undefined);
    await vi.waitFor(() => expect(opened).toHaveLength(1));

    const panelId = manifest.contributions.find(({ type }) => type === "ms.vss-web.external-content")?.id;
    expect(opened[0].contributionId).toBe(`andersmoldin.waypoint-dev.${panelId}`);
    expect(opened[0].options.lightDismiss).toBe(false);

    callBack(opened[0].options.onClose, true);
    await expect(closed).resolves.toBe(true);
  });

  it("counts a panel closed by the host's own button as nothing saved", async () => {
    stopHost();
    const opened: { onClose: HostProxy }[] = [];
    const host = playHost({ onOpenPanel: (_id, options) => opened.push(options as never) });
    stopHost = host.stop;

    const closed = createAzureDevOpsPlatform().openSettingsPanel(() => undefined);
    await vi.waitFor(() => expect(opened).toHaveLength(1));

    host.callBack(opened[0].onClose);
    await expect(closed).resolves.toBe(false);
  });

  describe("when the panel's page may never come up", () => {
    let opened: { onClose: HostProxy }[];
    let callBack: (proxy: HostProxy, ...args: unknown[]) => void;
    const startProblem = vi.fn<(problem: string | null) => void>();

    /** Fake timers for the wait only: the channel's message and the test's own turn of the event loop stay real. */
    async function openPanel(): Promise<{ closed: Promise<boolean>; platform: Platform }> {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      stopHost();
      startProblem.mockReset();
      opened = [];
      const host = playHost({ onOpenPanel: (_id, options) => opened.push(options as never) });
      stopHost = host.stop;
      callBack = host.callBack;
      const platform = createAzureDevOpsPlatform();
      const closed = platform.openSettingsPanel(startProblem);
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      return { closed, platform };
    }

    /** Lets the panel's message reach the hub: a channel delivers it in a later turn of the event loop. */
    async function announceFromThePanel(platform: Platform): Promise<void> {
      const overheard = new BroadcastChannel("waypoint-settings-panel-started");
      const delivered = new Promise((resolve) => (overheard.onmessage = resolve));
      platform.announceSettingsPanelStarted();
      await delivered;
      overheard.close();
      await new Promise((resolve) => setImmediate(resolve));
    }

    afterEach(() => vi.useRealTimers());

    it("says so when the page has not started in time, and still settles when the panel closes", async () => {
      const { closed } = await openPanel();

      await vi.advanceTimersByTimeAsync(29_000);
      expect(startProblem).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(startProblem).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("did not start within 30 seconds"));

      callBack(opened[0].onClose);
      await expect(closed).resolves.toBe(false);
      expect(startProblem).toHaveBeenLastCalledWith(expect.stringContaining("closed before it started"));
    });

    it("reports no problem when the page starts in time", async () => {
      const { closed, platform } = await openPanel();

      await announceFromThePanel(platform);
      await vi.advanceTimersByTimeAsync(30_000);

      callBack(opened[0].onClose, true);
      await expect(closed).resolves.toBe(true);
      expect(startProblem).toHaveBeenCalledExactlyOnceWith(null);
    });

    it("counts a page the host never answers as not started", async () => {
      const { closed } = await openPanel();
      const overheard = new BroadcastChannel("waypoint-settings-panel-started");
      const heard = vi.fn();
      overheard.onmessage = heard;

      // The hub has its answers, and from here the host answers nothing, which is what the panel's page meets.
      stopHost();
      createAzureDevOpsPlatform().announceSettingsPanelStarted();
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(30_000);
      await new Promise((resolve) => setImmediate(resolve));
      overheard.close();

      expect(heard).not.toHaveBeenCalled();
      expect(startProblem).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("did not start within 30 seconds"));

      callBack(opened[0].onClose);
      await expect(closed).resolves.toBe(false);
    });

    it("takes the problem back when a slow page starts after all, and has nothing to add when it closes", async () => {
      const { closed, platform } = await openPanel();

      await vi.advanceTimersByTimeAsync(30_000);
      await announceFromThePanel(platform);
      expect(startProblem).toHaveBeenLastCalledWith(null);

      callBack(opened[0].onClose);
      await expect(closed).resolves.toBe(false);
      expect(startProblem).toHaveBeenLastCalledWith(null);
    });

    it("says so when the panel is closed before its page has started", async () => {
      const { closed } = await openPanel();

      callBack(opened[0].onClose);

      await expect(closed).resolves.toBe(false);
      expect(startProblem).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("closed before it started"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(startProblem).toHaveBeenCalledOnce();
    });
  });

  it("opens a work item through the host, and settles only when the host says it has closed", async () => {
    stopHost();
    const opened: unknown[] = [];
    let close: (workItem: unknown) => void = () => undefined;
    stopHost = playHost({
      onOpenWorkItem: (id) => {
        opened.push(id);
        return new Promise((resolve) => {
          close = resolve;
        });
      },
    }).stop;

    let settled = false;
    const closed = createAzureDevOpsPlatform()
      .openWorkItem(17)
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(opened).toEqual([17]));
    expect(settled).toBe(false);

    close({ id: 17 });
    await closed;
  });

  it("rejects with an Error when the host refuses to open a work item", async () => {
    stopHost();
    stopHost = playHost({ onOpenWorkItem: () => Promise.reject({ message: "No such work item." }) }).stop;

    const failure = await createAzureDevOpsPlatform()
      .openWorkItem(17)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("No such work item.");
  });

  it("closes the panel it is running in through the host", async () => {
    stopHost();
    const closes: unknown[] = [];
    stopHost = playHost({ onClosePanel: (saved) => closes.push(saved) }).stop;

    await createAzureDevOpsPlatform().closeSettingsPanel(true);

    expect(closes).toEqual([true]);
  });
});

interface ServerAnswer {
  status?: number;
  body: unknown;
}

/** A function of the SDK's that has reached the host, and that the host can call back on. */
interface HostProxy {
  __proxyFunctionId: number;
}

/**
 * Plays the host on the SDK's real message channel. jsdom delivers the SDK's messages to the window
 * itself, without the source the SDK requires, so the answers are dispatched with that source set.
 * A service's methods reach the SDK the way they do from the real host: as proxies it calls back on.
 */
function playHost({
  rejectingServiceRequestsWith,
  onOpenPanel = () => undefined,
  onClosePanel = () => undefined,
  onSetQueryParams = () => undefined,
  onOpenWorkItem = () => undefined,
}: {
  rejectingServiceRequestsWith?: unknown;
  onOpenPanel?: (contributionId: string, options: unknown) => unknown;
  onClosePanel?: (saved: unknown) => unknown;
  onSetQueryParams?: (parameters: unknown) => unknown;
  onOpenWorkItem?: (id: unknown) => unknown;
}): { stop: () => void; callBack: (proxy: HostProxy, ...args: unknown[]) => void } {
  const proxies = new Map<string, (...args: never[]) => unknown>();
  const proxied = (name: string, method: (...args: never[]) => unknown) => {
    const proxyId = `${proxies.size + 1}`;
    proxies.set(`proxy${proxyId}`, method);
    return { [name]: { __proxyFunctionId: proxyId } };
  };

  const services = new Map<string, (...args: never[]) => unknown>([
    [
      "ms.vss-tfs-web.tfs-page-data-service",
      () => proxied("getProject", () => ({ id: PROJECT_ID, name: "Waypoint-test" })),
    ],
    [
      "ms.vss-features.location-service",
      () => ({
        ...proxied("getResourceAreaLocation", () => "https://dev.azure.test/andersmoldin/"),
        ...proxied("getServiceLocation", () => "https://dev.azure.test/andersmoldin/"),
      }),
    ],
    ["ms.vss-features.host-page-layout-service", () => proxied("openPanel", onOpenPanel as never)],
    [
      "ms.vss-features.host-navigation-service",
      () => ({
        ...proxied("getQueryParams", () => ({ tab: "Drift" })),
        ...proxied("setQueryParams", onSetQueryParams as never),
      }),
    ],
    ["ms.vss-work-web.work-item-form-navigation-service", () => proxied("openWorkItem", onOpenWorkItem as never)],
  ]);

  /** Like the real host: only what it has registered can be called, and any other name is answered with an error. */
  const call = (registered: Map<string, (...args: never[]) => unknown>, name: string, args: never[]) => {
    const method = registered.get(name);
    if (typeof method !== "function") return { error: `The played host has no ${name}.` };
    return { result: method(...args) };
  };

  let handshakeToken = "";

  const answerRequest = (event: MessageEvent<string>) => {
    const request = JSON.parse(event.data);
    if (!request.methodName || request.fromPlayedHost) return;
    handshakeToken = request.handshakeToken;
    const send = (outcome: object) => {
      const reply = JSON.stringify({ id: request.id, handshakeToken: request.handshakeToken, ...outcome });
      window.dispatchEvent(new MessageEvent("message", { data: reply, source: window }));
    };
    const outcome = answer(request);
    if ("result" in outcome && outcome.result instanceof Promise) {
      outcome.result.then(
        (result) => send({ result }),
        (error) => send({ error }),
      );
    } else {
      send(outcome);
    }
  };

  const answer = (request: { methodName: string; params: never[] }) => {
    switch (request.methodName) {
      case "initialHandshake":
        return {
          result: {
            context: {
              extension: { id: "andersmoldin.waypoint-dev", publisherId: "andersmoldin", extensionId: "waypoint-dev" },
              user: { id: "user-1", displayName: "Ada Admin" },
            },
            contributionId: "host",
            initialConfig: { panel: proxied("close", onClosePanel as never) },
          },
        };
      case "getAccessToken":
        return { result: { token: "host-token" } };
      case "getService":
        if (rejectingServiceRequestsWith !== undefined) return { error: rejectingServiceRequestsWith };
        return call(services, request.params[0], []);
      default:
        return call(proxies, request.methodName, request.params);
    }
  };

  window.addEventListener("message", answerRequest);
  return {
    stop: () => window.removeEventListener("message", answerRequest),
    callBack: (proxy, ...args) => {
      const request = {
        id: 1_000_000,
        fromPlayedHost: true,
        instanceId: "__proxyFunctions",
        methodName: `proxy${proxy.__proxyFunctionId}`,
        params: args,
        handshakeToken,
      };
      window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(request), source: window }));
    },
  };
}
