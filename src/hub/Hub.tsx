import { Header, TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Page } from "azure-devops-ui/Page";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { getSafeId } from "azure-devops-ui/Util";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { NO_FILTER, buildBoard, isFilterActive, shownGroups, type Board, type BoardFilter, type BoardFilterField } from "../board/boardModel";
import { loadBoard, type Guess, type LoadedBoard } from "../board/loadBoard";
import type { Platform } from "../platform/platform";
import { InvalidSettingsError, goneFieldsMessage } from "../settings/settings";
import { FilterRow, filterCommand, focusFilterCommand } from "./FilterRow";
import { PhaseBoard, formatCount } from "./PhaseBoard";
import { filterFromLink, filterParameters, parametersToWrite, readViewState, tabParameters } from "./viewState";

type HubState =
  | { status: "loading" }
  | LoadedState
  | { status: "failed"; reason: string; settingsAreInvalid: boolean };

/** The filter lives beside the board it narrows, since the icon that shows it sits in the header above. */
type LoadedState = { status: "loaded"; loaded: LoadedBoard; openingTabIndex: number; filter: BoardFilter; filterRow: FilterRowState };

/** What the filter row reports back. */
interface FilterHandlers {
  onFilterChanged: (filter: BoardFilter, filterFields: BoardFilterField[]) => void;
  onFilterRowDismissed: () => void;
}

/** A row a link opened leaves focus alone, while one the viewer opened takes it. */
type FilterRowState = "closed" | "opened-by-link" | "opened-by-viewer";

/** Whether the gear is offered. It stays hidden until the answer is known to be yes. */
type Access = { isAdministrator: boolean; checkFailedBecause?: string };

export function Hub({ platform }: { platform: Platform }): React.JSX.Element {
  const [state, setState] = useState<HubState>({ status: "loading" });
  const [access, setAccess] = useState<Access>({ isAdministrator: false });
  const [panelFailure, setPanelFailure] = useState<string | null>(null);
  const [linkFailure, setLinkFailure] = useState<string | null>(null);
  const [timesSaved, setTimesSaved] = useState(0);

  const focusFilterCommandNext = useRef(false);

  const writeToUrl = (parameters: Record<string, string>) => {
    const what = !("tab" in parameters) ? "filter" : Object.keys(parameters).length > 1 ? "tab and the filter" : "tab";
    platform
      .setQueryParams(parameters)
      .catch((error: Error) => setLinkFailure(`Waypoint could not put the ${what} in the address, so a link will not show it: ${error.message}`));
  };

  useEffect(() => {
    let unmounted = false;
    setState({ status: "loading" });
    setLinkFailure(null);
    // A link that cannot be read costs the link, not the board.
    const link = platform
      .getQueryParams()
      .then((parameters) => ({ parameters, view: readViewState(parameters), failure: null }))
      .catch((error: Error) => ({
        parameters: {},
        view: readViewState({}),
        failure: `Waypoint could not read the link, so it shows the first tab without a filter: ${error.message}`,
      }));
    Promise.all([loadBoard(platform), link])
      .then(([loaded, { parameters, view, failure }]) => {
        if (unmounted) return;
        const { source } = loaded;
        // A tab the board does not have counts for nothing, and the first tab shows.
        const openingTabIndex = Math.max(source?.tabs.findIndex((candidate) => candidate.name === view.tab) ?? 0, 0);
        const filter = source ? filterFromLink(view, shownGroups(source), source.filterFields) : NO_FILTER;
        setState({ status: "loaded", loaded, openingTabIndex, filter, filterRow: isFilterActive(filter) ? "opened-by-link" : "closed" });
        if (!source) return;
        setLinkFailure(failure);
        if (failure) return;
        const toWrite = parametersToWrite(parameters, {
          ...tabParameters(source.tabs[openingTabIndex].name),
          ...filterParameters(filter, source.filterFields),
        });
        if (Object.keys(toWrite).length > 0) writeToUrl(toWrite);
      })
      // After the answer as well, since a page left on "Loading…" says nothing about what went wrong.
      .catch((error: Error) => unmounted || setState({ status: "failed", reason: error.message, settingsAreInvalid: error instanceof InvalidSettingsError }));
    return () => {
      unmounted = true;
    };
  }, [platform, timesSaved]);

  useEffect(() => {
    let unmounted = false;
    platform.getProject().then(
      ({ id }) =>
        platform.isProjectAdministrator(id).then(
          (isAdministrator) => unmounted || setAccess({ isAdministrator }),
          (error: Error) => unmounted || setAccess({ isAdministrator: false, checkFailedBecause: error.message }),
        ),
      // The board fails on the same project, and says so.
      () => undefined,
    );
    return () => {
      unmounted = true;
    };
  }, [platform]);

  const openSettings = () => {
    setPanelFailure(null);
    platform.openSettingsPanel(setPanelFailure).then(
      (saved) => saved && setTimesSaved((times) => times + 1),
      (error: Error) => setPanelFailure(error.message),
    );
  };
  const openSettingsIfAllowed = access.isAdministrator ? openSettings : null;

  const onTabChosen = (tabName: string) => {
    setLinkFailure(null);
    writeToUrl(tabParameters(tabName));
  };

  // A change that arrives while the board is being loaded again has nothing left to change.
  const updateLoaded = (change: (current: LoadedState) => Partial<LoadedState>) =>
    setState((current) => (current.status === "loaded" ? { ...current, ...change(current) } : current));

  const onFilterChanged = (filter: BoardFilter, filterFields: BoardFilterField[]) => {
    updateLoaded(() => ({ filter }));
    setLinkFailure(null);
    writeToUrl(filterParameters(filter, filterFields));
  };

  const toggleFilterRow = () => updateLoaded(({ filterRow }) => ({ filterRow: filterRow === "closed" ? "opened-by-viewer" : "closed" }));

  const onFilterRowDismissed = () => {
    focusFilterCommandNext.current = true;
    updateLoaded(() => ({ filterRow: "closed" }));
  };

  useEffect(() => {
    if (!focusFilterCommandNext.current) return;
    focusFilterCommandNext.current = false;
    focusFilterCommand();
  });

  return (
    <main className="flex-grow flex-column">
      <Page className="flex-grow">
        <Header
          title="Waypoint"
          titleSize={TitleSize.Large}
          commandBarItems={[
            ...(state.status === "loaded" && state.loaded.source
              ? [filterCommand({ rowIsOpen: state.filterRow !== "closed", filterIsActive: isFilterActive(state.filter), onActivate: toggleFilterRow })]
              : []),
            ...(access.isAdministrator
              ? [
                  {
                    id: "settings",
                    role: "button",
                    ariaLabel: "Settings",
                    tooltipProps: { text: "Settings" },
                    iconProps: { iconName: "Settings" },
                    important: true,
                    onActivate: openSettings,
                  },
                ]
              : []),
          ]}
        />
        {panelFailure && (
          <PageContent>
            <MessageCard severity={MessageCardSeverity.Error}>Waypoint could not open its settings: {panelFailure}</MessageCard>
          </PageContent>
        )}
        {access.checkFailedBecause && (
          <PageContent>
            <MessageCard severity={MessageCardSeverity.Warning}>
              Waypoint could not check whether you can change its settings, so the gear is hidden: {access.checkFailedBecause}
            </MessageCard>
          </PageContent>
        )}
        {linkFailure && (
          <PageContent>
            <MessageCard severity={MessageCardSeverity.Warning}>{linkFailure}</MessageCard>
          </PageContent>
        )}
        {/* New for each load, so that what saved settings mend also comes back. */}
        <RenderFailureBoundary key={timesSaved}>
          <HubContent
            state={state}
            platform={platform}
            openSettings={openSettingsIfAllowed}
            onTabChosen={onTabChosen}
            filterHandlers={{ onFilterChanged, onFilterRowDismissed }}
          />
        </RenderFailureBoundary>
      </Page>
    </main>
  );
}

/** Without this, React empties the whole page when something in the board throws. Outside it, the gear stays, as the way to a mend. */
class RenderFailureBoundary extends React.Component<{ children: React.ReactNode }, { reason: string | null }> {
  state: { reason: string | null } = { reason: null };

  static getDerivedStateFromError(error: Error) {
    return { reason: error.message };
  }

  render() {
    const { reason } = this.state;
    return reason === null ? (
      this.props.children
    ) : (
      <PageContent>
        <MessageCard severity={MessageCardSeverity.Error}>Waypoint could not show the board: {reason}</MessageCard>
      </PageContent>
    );
  }
}

/** `openSettings` is null when the user cannot open the settings. */
function HubContent({
  state,
  platform,
  openSettings,
  onTabChosen,
  filterHandlers,
}: {
  state: HubState;
  platform: Platform;
  openSettings: (() => void) | null;
  onTabChosen: (tabName: string) => void;
  filterHandlers: FilterHandlers;
}): React.JSX.Element {
  switch (state.status) {
    case "loading":
      return (
        <PageContent>
          <p role="status">Loading…</p>
        </PageContent>
      );
    case "failed":
      return (
        <PageContent>
          <MessageCard
            severity={MessageCardSeverity.Error}
            buttonProps={state.settingsAreInvalid && openSettings ? [{ text: "Open settings", onClick: openSettings }] : undefined}
          >
            Waypoint could not load the board: {state.reason}
            {state.settingsAreInvalid && !openSettings && " A Project Administrator can fix or reset them in Waypoint's settings."}
          </MessageCard>
        </PageContent>
      );
    case "loaded":
      return <LoadedHub state={state} platform={platform} openSettings={openSettings} onTabChosen={onTabChosen} filterHandlers={filterHandlers} />;
  }
}

function LoadedHub({
  state: {
    loaded: { guess, source, filterFieldWarnings, goneFields },
    openingTabIndex,
    filter,
    filterRow,
  },
  platform,
  openSettings,
  onTabChosen,
  filterHandlers: { onFilterChanged, onFilterRowDismissed },
}: {
  state: LoadedState;
  platform: Platform;
  openSettings: (() => void) | null;
  onTabChosen: (tabName: string) => void;
  filterHandlers: FilterHandlers;
}): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(openingTabIndex);
  const board = useMemo(() => source && buildBoard(source, filter), [source, filter]);
  const notSetUp = guess && <NotSetUpBox guess={guess} openSettings={openSettings} />;
  if (!board) return <PageContent>{notSetUp}</PageContent>;

  const selectTab = (tabId: string) => {
    const index = Number(tabId);
    if (index === selectedIndex) return;
    setSelectedIndex(index);
    onTabChosen(board.tabs[index].name);
  };
  return (
    <>
      {/* Tabs are told apart by index: the library compares ids without regard to case and puts them in the DOM. */}
      <TabBar ariaLabel="Phase tabs" selectedTabId={String(selectedIndex)} onSelectedTabChanged={selectTab} tabSize={TabSize.Tall}>
        {board.tabs.map((tab, index) => (
          <Tab key={index} id={String(index)} name={tab.name} />
        ))}
      </TabBar>
      <PageContent>
        {filterRow !== "closed" && (
          <FilterRow
            filter={filter}
            groups={board.groups}
            filterFields={board.filterFields}
            takeFocus={filterRow === "opened-by-viewer"}
            onFilterChanged={(changed) => onFilterChanged(changed, board.filterFields)}
            onDismissed={onFilterRowDismissed}
          />
        )}
        {notSetUp}
        {filterFieldWarnings.map((warning) => (
          <MessageCard key={warning} severity={MessageCardSeverity.Warning}>
            {warning}
          </MessageCard>
        ))}
        {goneFields.length > 0 && <GoneFieldsWarning goneFields={goneFields} />}
        {board.objectsAllHidden !== null && (
          <MessageCard severity={MessageCardSeverity.Info}>
            {`All ${formatCount(board.objectsAllHidden)} objects are in groups hidden in Waypoint's settings. A Project Administrator can change this.`}
          </MessageCard>
        )}
        <div className="flex-column rhythm-vertical-16" role="tabpanel" aria-labelledby={getSafeId(`tab-${selectedIndex}`)}>
          <PhaseBoard columns={board.tabs[selectedIndex].columns} groups={board.groups} truncation={board.truncation} platform={platform} />
        </div>
        {/* Always there, and last so that it takes no part in the spacing, since a screen reader only announces what changes in a status that already exists. */}
        <p className="screen-reader-only" role="status">
          {isFilterActive(filter) ? filterResult(board) : ""}
        </p>
      </PageContent>
    </>
  );
}

/** All tabs count: what the filter finds can lie on another tab than the one in view. */
function filterResult({ tabs }: Board): string {
  const found = tabs.flatMap(({ columns }) => columns).reduce((sum, { total }) => sum + total, 0);
  return `${formatCount(found)} ${found === 1 ? "object matches" : "objects match"} the filter across all tabs.`;
}

function PageContent({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="page-content page-content-top flex-column rhythm-vertical-16">{children}</div>;
}

function NotSetUpBox({
  guess: { objectType, groupType, phaseFieldName },
  openSettings,
}: {
  guess: Guess;
  openSettings: (() => void) | null;
}): React.JSX.Element {
  const whoCan = openSettings ? "You can" : "A Project Administrator can";
  return (
    <MessageCard
      severity={MessageCardSeverity.Info}
      buttonProps={openSettings ? [{ text: "Open settings", onClick: openSettings }] : undefined}
    >
      {phaseFieldName
        ? `Waypoint isn't set up for this project yet. This is a guess: ${objectType} work items under their ${groupType} parents, with phases from ${phaseFieldName}. ${whoCan} change this in Waypoint's settings.`
        : `Waypoint isn't set up for this project yet. It looked for ${objectType} work items under ${groupType} parents, but found no picklist field on ${objectType} to use as phases. ${whoCan} add one to the process or choose another work item type in Waypoint's settings.`}
    </MessageCard>
  );
}

function GoneFieldsWarning({ goneFields }: { goneFields: string[] }): React.JSX.Element {
  return (
    <MessageCard severity={MessageCardSeverity.Warning}>
      {`${goneFieldsMessage(goneFields)} The board does without them. A Project Administrator can choose other fields in Waypoint's settings.`}
    </MessageCard>
  );
}
