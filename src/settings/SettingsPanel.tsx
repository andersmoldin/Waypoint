import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize } from "azure-devops-ui/Pill";
import React, { useEffect, useRef, useState } from "react";
import type { Group } from "../board/boardModel";
import { readGroups } from "../board/loadBoard";
import type { PicklistField, Platform, StoredDocument, WorkItemField } from "../platform/platform";
import { CardFieldSettings, NO_CARD_CHOICES, type CardChoices } from "./CardFieldSettings";
import { Choice } from "./Choice";
import { FilterFieldSettings, filterFieldDraftsOf, filterFieldsProblem, savedFilterFieldsOf } from "./FilterFieldSettings";
import {
  GUESSED_TYPES,
  InvalidSettingsError,
  arrangeTabs,
  documentAfterChange,
  goneFieldsMessage,
  orderPhases,
  parseSettingsDocument,
  phasesInPicklistOrder,
  readCardFields,
  readFieldsOfType,
  readProjectOptions,
  readableLog,
  usablePhaseField,
  type LogEntry,
  type Phase,
  type Settings,
} from "./settings";
import { TabSettings, draftOf, savedTabsOf, tabsProblem } from "./TabSettings";
import "./SettingsPanel.css";

type PanelState =
  | { status: "loading" }
  | { status: "failed"; reason: string }
  | { status: "invalid"; reason: string; projectId: string; stored: StoredDocument }
  | { status: "ready"; start: FormStart };

/** What the form starts from. */
interface FormStart {
  projectId: string;
  /** The revision the form's changes are based on, or null if nothing is saved. */
  revision: number | null;
  saved: Settings | null;
  log: LogEntry[];
  workItemTypes: string[];
  /** The picklist fields on the object type the form starts with. */
  picklistFields: PicklistField[];
  /** Every field on the object type the form starts with. */
  fields: WorkItemField[];
  /** Why the saved settings cannot be used, although they are well formed: they name something the project no longer has. */
  problem: string | null;
}

/** The settings panel, which the host shows in a frame of its own beside the hub. */
export function SettingsPanel({ platform }: { platform: Platform }): React.JSX.Element {
  useEffect(() => platform.announceSettingsPanelStarted(), [platform]);

  return (
    <main className="waypoint-settings flex-column flex-grow" aria-label="Waypoint settings">
      {/* The title the host shows lies in another frame, so a screen reader in this one needs a heading of its own to start from. */}
      <h1 className="screen-reader-only">Waypoint settings</h1>
      <RenderFailureBoundary platform={platform}>
        <PanelLoader platform={platform} />
      </RenderFailureBoundary>
    </main>
  );
}

/** Without this, React empties the panel when something in it throws while rendering. */
class RenderFailureBoundary extends React.Component<{ platform: Platform; children: React.ReactNode }, { reason: string | null }> {
  state: { reason: string | null } = { reason: null };

  static getDerivedStateFromError(error: Error) {
    return { reason: error.message };
  }

  render() {
    const { platform, children } = this.props;
    const { reason } = this.state;
    return reason === null ? children : <FailureWithClose platform={platform} message={`Waypoint's settings stopped working: ${reason}`} />;
  }
}

function PanelLoader({ platform }: { platform: Platform }): React.JSX.Element {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let unmounted = false;
    loadPanel(platform).then(
      (loaded) => unmounted || setState(loaded),
      (error: Error) => unmounted || setState({ status: "failed", reason: error.message }),
    );
    return () => {
      unmounted = true;
    };
  }, [platform]);

  return <PanelContent state={state} platform={platform} />;
}

async function loadPanel(platform: Platform): Promise<PanelState> {
  const { id: projectId } = await platform.getProject();
  const stored = await platform.getSettingsDocument(projectId);

  let document = { settings: null as Settings | null, log: [] as LogEntry[] };
  if (stored) {
    try {
      document = parseSettingsDocument(stored.content);
    } catch (error) {
      if (!(error instanceof InvalidSettingsError)) throw error;
      return { status: "invalid", reason: error.message, projectId, stored };
    }
  }

  const objectType = document.settings?.objectType ?? GUESSED_TYPES.objectType;
  const { workItemTypes, picklistFields, fields } = await readProjectOptions(platform, projectId, objectType);
  return {
    status: "ready",
    start: {
      projectId,
      revision: stored?.revision ?? null,
      saved: document.settings,
      log: document.log,
      workItemTypes,
      picklistFields,
      fields,
      problem: document.settings && problemWith(document.settings, workItemTypes, picklistFields, fields),
    },
  };
}

function problemWith(settings: Settings, workItemTypes: string[], picklistFields: PicklistField[], fields: WorkItemField[]): string | null {
  try {
    usablePhaseField(settings, workItemTypes, picklistFields);
    const { gone } = readCardFields(settings, fields);
    return gone.length > 0 ? goneFieldsMessage(gone) : null;
  } catch (error) {
    if (error instanceof InvalidSettingsError) return error.message;
    throw error;
  }
}

function PanelContent({ state, platform }: { state: PanelState; platform: Platform }): React.JSX.Element {
  switch (state.status) {
    case "loading":
      return <p role="status">Loading…</p>;
    case "failed":
      return <FailureWithClose platform={platform} message={`Waypoint could not load its settings: ${state.reason}`} />;
    case "invalid":
      return <InvalidSettings platform={platform} reason={state.reason} projectId={state.projectId} stored={state.stored} />;
    case "ready":
      return <SettingsForm platform={platform} start={state.start} />;
  }
}

/** Closes the panel, or says why it could not. */
function useClosing(platform: Platform) {
  const [failure, setFailure] = useState<string | null>(null);
  const close = () => {
    setFailure(null);
    platform.closeSettingsPanel(false).catch((error: Error) => setFailure(`Waypoint could not close its settings: ${error.message}`));
  };
  return { close, failure };
}

/** Saves a change with its log entry and closes the panel, or says how far it got. */
function useSaving(platform: Platform, projectId: string, revision: number | null, log: LogEntry[]) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (settings: Settings | null) => {
    setSaving(true);
    setFailure(null);
    try {
      const user = await platform.getCurrentUser();
      const entry = { at: Date.now(), userId: user.id, userName: user.displayName };
      const document = documentAfterChange(settings, log, entry);
      // The hub would refuse what it cannot read back, and every viewer would pay for it.
      parseSettingsDocument(document);
      await platform.saveSettingsDocument(projectId, document, revision);
    } catch (error) {
      // A save that timed out may still have gone through, so this cannot say that nothing changed.
      setFailure(
        error instanceof InvalidSettingsError
          ? `Waypoint did not save the settings, since the hub could not have read them. ${error.message}`
          : `Waypoint could not save the settings: ${(error as Error).message} Close the settings and open them again to see what is saved, for example if someone else has saved in the meantime.`,
      );
      setSaving(false);
      return;
    }
    await platform.closeSettingsPanel(true).catch((error: Error) => {
      setFailure(`The settings are saved, but Waypoint could not close them: ${error.message} Reload the page to see the change.`);
    });
  };

  return { save, saving, failure };
}

function PanelFailure({ reason }: { reason: string | null }): React.JSX.Element | null {
  return reason ? <MessageCard severity={MessageCardSeverity.Error}>{reason}</MessageCard> : null;
}

function FailureWithClose({ platform, message }: { platform: Platform; message: string }): React.JSX.Element {
  const { close, failure } = useClosing(platform);
  return (
    <>
      <MessageCard severity={MessageCardSeverity.Error}>{message}</MessageCard>
      <PanelFailure reason={failure} />
      <ButtonGroup>
        <Button text="Close" onClick={close} />
      </ButtonGroup>
    </>
  );
}

function InvalidSettings({
  platform,
  reason,
  projectId,
  stored,
}: {
  platform: Platform;
  reason: string;
  projectId: string;
  stored: StoredDocument;
}): React.JSX.Element {
  const log = readableLog(stored.content);
  const { save, saving, failure } = useSaving(platform, projectId, stored.revision, log);
  const { close, failure: closeFailure } = useClosing(platform);
  return (
    <>
      <MessageCard severity={MessageCardSeverity.Error}>
        {reason} Going back to the defaults replaces them. The hub then guesses again until settings are saved.
      </MessageCard>
      <PanelFailure reason={failure ?? closeFailure} />
      <ButtonGroup>
        <Button text="Reset to defaults" danger disabled={saving} onClick={() => save(null)} />
        <Button text="Cancel" disabled={saving} onClick={close} />
      </ButtonGroup>
      <ChangeLog log={log} />
    </>
  );
}

function SettingsForm({ platform, start }: { platform: Platform; start: FormStart }): React.JSX.Element {
  const { projectId, saved, log, workItemTypes, problem } = start;
  const [objectType, setObjectType] = useState(ifProjectHasIt(workItemTypes, saved?.objectType ?? GUESSED_TYPES.objectType));
  const [groupType, setGroupType] = useState(ifProjectHasIt(workItemTypes, saved?.groupType ?? GUESSED_TYPES.groupType));
  const [picklistFields, setPicklistFields] = useState(start.picklistFields);
  const [fields, setFields] = useState(start.fields);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsFailure, setFieldsFailure] = useState<string | null>(null);

  /** The saved field on the saved type, or nothing if it is gone so that the form asks. On any other type, the first field. */
  const fieldToStartWith = (fields: PicklistField[], type: string): PicklistField | undefined =>
    saved?.objectType === type ? fields.find((field) => field.referenceName === saved.phaseField) : fields[0];

  const isSavedField = (field: PicklistField | undefined, type: string) => saved?.objectType === type && saved.phaseField === field?.referenceName;

  /** The phases of a field: in the saved order if it is the saved field on the saved type, otherwise in picklist order. */
  const phasesOf = (field: PicklistField | undefined, type: string): Phase[] => {
    if (!field) return [];
    return saved && isSavedField(field, type) ? orderPhases(saved.phaseOrder, field.values) : phasesInPicklistOrder(field.values);
  };

  /** The tabs of a field: as saved if it is the saved field on the saved type, otherwise one with all its phases. */
  const tabsOf = (field: PicklistField | undefined, type: string) =>
    draftOf(arrangeTabs(isSavedField(field, type) ? saved?.tabs : undefined, phasesOf(field, type)));

  /** What the settings saved for this type say about the card, as far as the type still has it. On any other type, nothing. */
  const cardChoicesOf = (fieldsOfType: WorkItemField[], type: string): CardChoices => {
    if (saved?.objectType !== type) return NO_CARD_CHOICES;
    const { roles, details } = readCardFields(saved, fieldsOfType);
    return {
      roles: Object.fromEntries(Object.entries(roles).map(([role, { referenceName }]) => [role, referenceName])),
      detailFields: saved.detailFields ? details.map(({ referenceName }) => referenceName) : null,
    };
  };

  const startingField = fieldToStartWith(picklistFields, objectType);
  const [phaseField, setPhaseField] = useState(startingField?.referenceName ?? "");
  const [phases, setPhases] = useState(phasesOf(startingField, objectType));
  const [tabs, setTabs] = useState(tabsOf(startingField, objectType));
  const [hiddenGroups, setHiddenGroups] = useState(saved?.hiddenGroups ?? []);
  const [filterFields, setFilterFields] = useState(() => filterFieldDraftsOf(saved?.filterFields ?? []));
  const [cardChoices, setCardChoices] = useState(cardChoicesOf(fields, objectType));
  const { save, saving, failure } = useSaving(platform, projectId, start.revision, log);
  const { close, failure: closeFailure } = useClosing(platform);

  // A question can end after a newer one has been asked, even about the same type, so only the latest counts.
  const latestFieldsRequest = useRef(0);
  const chooseObjectType = (type: string) => {
    const request = ++latestFieldsRequest.current;
    setObjectType(type);
    setFieldsLoading(true);
    setFieldsFailure(null);
    setPicklistFields([]);
    setFields([]);
    setPhaseField("");
    setPhases([]);
    setTabs(tabsOf(undefined, type));
    setCardChoices(NO_CARD_CHOICES);
    readFieldsOfType(platform, projectId, type)
      .then(
        ({ picklistFields: picklists, fields: allFields }) => {
          if (latestFieldsRequest.current !== request) return;
          const field = fieldToStartWith(picklists, type);
          setPicklistFields(picklists);
          setFields(allFields);
          setPhaseField(field?.referenceName ?? "");
          setPhases(phasesOf(field, type));
          setTabs(tabsOf(field, type));
          setCardChoices(cardChoicesOf(allFields, type));
        },
        (error: Error) => {
          if (latestFieldsRequest.current === request) setFieldsFailure(error.message);
        },
      )
      .finally(() => {
        if (latestFieldsRequest.current === request) setFieldsLoading(false);
      });
  };

  const choosePhaseField = (reference: string) => {
    const field = picklistFields.find(({ referenceName }) => referenceName === reference);
    setPhaseField(reference);
    setPhases(phasesOf(field, objectType));
    setTabs(tabsOf(field, objectType));
  };

  const typeOptions = [...workItemTypes].sort((a, b) => a.localeCompare(b)).map((type) => ({ id: type, text: type }));
  const complete = objectType !== "" && groupType !== "" && phaseField !== "" && tabsProblem(tabs, phases) === null && filterFieldsProblem(filterFields, picklistFields, fields) === null;

  return (
    <>
      {problem && (
        <MessageCard severity={MessageCardSeverity.Error}>
          {problem} Choose what to use instead, or go back to the defaults, and the hub guesses again until settings are saved.
        </MessageCard>
      )}
      <Choice
        label="Object work item type"
        options={typeOptions}
        selected={objectType}
        reselectable={fieldsFailure !== null}
        onChange={chooseObjectType}
      />
      <Choice label="Group work item type" options={typeOptions} selected={groupType} onChange={setGroupType} />
      <p className="waypoint-settings-hint">An object's group is always its parent. A parent of any other type doesn't count as a group.</p>
      <Choice
        label="Phase field"
        options={picklistFields.map((field) => ({ id: field.referenceName, text: field.name }))}
        selected={phaseField}
        onChange={choosePhaseField}
      />
      <PanelFailure reason={fieldsFailure && `Waypoint could not read the fields: ${fieldsFailure}`} />
      {!fieldsFailure && !fieldsLoading && objectType !== "" && picklistFields.length === 0 && (
        <p className="waypoint-settings-hint">{objectType} has no picklist field. Choose another type, or add one to the process.</p>
      )}
      <PhaseOrder phases={phases} onChange={setPhases} />
      <TabSettings draft={tabs} phases={phases} onChange={setTabs} />
      <HiddenGroups platform={platform} projectId={projectId} groupType={groupType} hidden={hiddenGroups} onChange={setHiddenGroups} />
      <FilterFieldSettings platform={platform} projectId={projectId} drafts={filterFields} picklistFields={picklistFields} fields={fields} onChange={setFilterFields} />
      <CardFieldSettings fields={fields} choices={cardChoices} onChange={setCardChoices} />
      <PanelFailure reason={failure ?? closeFailure} />
      <ButtonGroup>
        <Button
          text="Save"
          primary
          disabled={!complete || saving}
          onClick={() =>
            save({
              objectType,
              groupType,
              phaseField,
              phaseOrder: phases.map(({ name }) => name),
              hiddenGroups,
              tabs: savedTabsOf(tabs, phases),
              filterFields: savedFilterFieldsOf(filterFields),
              ...(Object.keys(cardChoices.roles).length > 0 && { roles: cardChoices.roles }),
              ...(cardChoices.detailFields && { detailFields: cardChoices.detailFields }),
            })
          }
        />
        {problem && <Button text="Reset to defaults" danger disabled={saving} onClick={() => save(null)} />}
        <Button text="Cancel" disabled={saving} onClick={close} />
      </ButtonGroup>
      <ChangeLog log={log} />
    </>
  );
}

/** The given type if the project has it, otherwise none: the form then asks for a choice instead of keeping a type that is gone. */
function ifProjectHasIt(workItemTypes: string[], type: string): string {
  return workItemTypes.includes(type) ? type : "";
}

/** Dragging needs a steady hand and a mouse, so every move can also be made with the buttons. */
function PhaseOrder({ phases, onChange }: { phases: Phase[]; onChange: (phases: Phase[]) => void }): React.JSX.Element | null {
  const dragged = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= phases.length) return;
    const reordered = [...phases];
    const [phase] = reordered.splice(from, 1);
    reordered.splice(to, 0, phase);
    onChange(reordered);
    setAnnouncement(`${phase.name} moved to position ${to + 1} of ${phases.length}.`);
  };

  if (phases.length === 0) return null;
  return (
    <section className="waypoint-settings-section" aria-labelledby="waypoint-phase-order-heading">
      <h2 id="waypoint-phase-order-heading" className="waypoint-settings-heading">
        Phase order
      </h2>
      <p className="waypoint-settings-hint">Drag a phase, or use its buttons, to put the phases in the order the board should show them.</p>
      <ol className="waypoint-phase-order" role="list" aria-labelledby="waypoint-phase-order-heading">
        {phases.map((phase, index) => (
          <li
            key={phase.name}
            className="waypoint-phase"
            draggable
            onDragStart={(event) => {
              dragged.current = index;
              // Firefox starts no drag unless the drag carries data.
              event.dataTransfer.setData("text/plain", phase.name);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged.current !== null) move(dragged.current, index);
              dragged.current = null;
            }}
          >
            <span className="waypoint-phase-name">{phase.name}</span>
            {phase.isNew && <Pill size={PillSize.compact}>New</Pill>}
            <Button
              subtle
              iconProps={{ iconName: "ChevronUp" }}
              ariaLabel={`Move ${phase.name} up`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            />
            <Button
              subtle
              iconProps={{ iconName: "ChevronDown" }}
              ariaLabel={`Move ${phase.name} down`}
              disabled={index === phases.length - 1}
              onClick={() => move(index, index + 1)}
            />
          </li>
        ))}
      </ol>
      <p className="screen-reader-only" role="status">
        {announcement}
      </p>
    </section>
  );
}

type GroupsState = { status: "loading" } | { status: "failed"; reason: string } | { status: "ready"; groups: Group[] };

/**
 * `hidden` may name more than the groups listed here: those of another group type, or ones that cannot
 * be read just now. They are kept, so that nothing starts showing because of a failed read. What was
 * hidden when the panel opened is what gets read, so that a group outside the project stays listed after
 * it is unticked and can be ticked again.
 */
function HiddenGroups({
  platform,
  projectId,
  groupType,
  hidden,
  onChange,
}: {
  platform: Platform;
  projectId: string;
  groupType: string;
  hidden: number[];
  onChange: (hidden: number[]) => void;
}): React.JSX.Element | null {
  const [state, setState] = useState<GroupsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [hiddenAtOpen] = useState(hidden);

  useEffect(() => {
    if (groupType === "") return undefined;
    // An answer can come after another type has been chosen, so only the latest question counts.
    let outdated = false;
    setState({ status: "loading" });
    readGroups(platform, projectId, groupType, hiddenAtOpen).then(
      (groups) => outdated || setState({ status: "ready", groups }),
      (error: Error) => outdated || setState({ status: "failed", reason: error.message }),
    );
    return () => {
      outdated = true;
    };
  }, [platform, projectId, groupType, hiddenAtOpen, attempt]);

  if (groupType === "") return null;
  return (
    <section className="waypoint-settings-section" aria-labelledby="waypoint-hidden-groups-heading">
      <h2 id="waypoint-hidden-groups-heading" className="waypoint-settings-heading">
        Hidden groups
      </h2>
      <p className="waypoint-settings-hint">Hidden groups and their objects don't show on the board.</p>
      {state.status === "loading" && (
        <p className="waypoint-settings-hint" role="status">
          Loading groups…
        </p>
      )}
      {state.status === "failed" && (
        <>
          <PanelFailure reason={`Waypoint could not read the groups: ${state.reason} Saving keeps the groups that are hidden now.`} />
          <ButtonGroup>
            <Button text="Try again" onClick={() => setAttempt((attempts) => attempts + 1)} />
          </ButtonGroup>
        </>
      )}
      {state.status === "ready" && state.groups.length === 0 && <p className="waypoint-settings-hint">The project has no groups of type {groupType}.</p>}
      {state.status === "ready" && state.groups.length > 0 && (
        <ul className="waypoint-hidden-groups" role="list" aria-labelledby="waypoint-hidden-groups-heading">
          {state.groups.map(({ id, name }) => (
            <li key={id}>
              {/* The id tells groups with the same name apart. */}
              <Checkbox
                label={`${name} (#${id})`}
                checked={hidden.includes(id)}
                onChange={(_event, checked) => onChange(checked ? [...hidden, id] : hidden.filter((other) => other !== id))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeLog({ log }: { log: LogEntry[] }): React.JSX.Element {
  return (
    <section className="waypoint-settings-section" aria-labelledby="waypoint-change-log-heading">
      <h2 id="waypoint-change-log-heading" className="waypoint-settings-heading">
        Change log
      </h2>
      {log.length === 0 ? (
        <p className="waypoint-settings-hint">Nothing has been saved yet.</p>
      ) : (
        <ul className="waypoint-change-log" role="list" aria-labelledby="waypoint-change-log-heading">
          {[...log].reverse().map((entry, index) => (
            <li key={index}>
              <span>{entry.userName}</span>, <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
