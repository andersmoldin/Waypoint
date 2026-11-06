import { Button } from "azure-devops-ui/Button";
import { TextField } from "azure-devops-ui/TextField";
import React, { useRef, useState } from "react";
import { ChoiceDropdown } from "./Choice";
import type { Phase, PhaseTab, SavedTab } from "./settings";

/** The tabs as the form holds them. A phase's tab goes by key, since a name can be blank or the same as another's while typing. */
export interface TabsDraft {
  tabs: { key: number; name: string }[];
  placements: Map<string, Placement>;
}

interface Placement {
  tabKey: number;
  divider: string;
}

export function draftOf(tabs: PhaseTab[]): TabsDraft {
  return {
    tabs: tabs.map(({ name }, key) => ({ key, name })),
    placements: new Map(
      tabs.flatMap(({ phases }, tabKey) => phases.map(({ name, dividerBefore = "" }) => [name, { tabKey, divider: dividerBefore }] as const)),
    ),
  };
}

/** What to store for the draft, with each tab's phases in the order the form has them. */
export function savedTabsOf({ tabs, placements }: TabsDraft, phases: Phase[]): SavedTab[] {
  return tabs.map(({ key, name }) => ({
    name: name.trim(),
    phases: phases
      .filter((phase) => placements.get(phase.name)?.tabKey === key)
      .map((phase) => {
        const dividerBefore = placements.get(phase.name)?.divider.trim();
        return dividerBefore ? { name: phase.name, dividerBefore } : { name: phase.name };
      }),
  }));
}

/** Why the draft cannot be saved, or null if it can. */
export function tabsProblem(draft: TabsDraft, phases: Phase[]): string | null {
  const tabs = savedTabsOf(draft, phases);
  const names = tabs.map(({ name }) => name);
  if (names.includes("")) return "Give every tab a name.";
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) return `Two tabs are named ${repeated}. Give each tab a name of its own.`;
  const withoutPhases = phases.length > 0 && tabs.find((tab) => tab.phases.length === 0);
  return withoutPhases ? `The tab ${withoutPhases.name} has no phases. Move a phase to it, or remove it.` : null;
}

export function TabSettings({
  draft,
  phases,
  onChange,
}: {
  draft: TabsDraft;
  phases: Phase[];
  onChange: (draft: TabsDraft) => void;
}): React.JSX.Element | null {
  const { tabs, placements } = draft;
  const [announcement, setAnnouncement] = useState("");
  const addButton = useRef<Button>(null);
  const addedKey = useRef<number | null>(null);

  /** How to speak of a tab, also while its name is blank. */
  const label = (index: number) => tabs[index].name.trim() || String(index + 1);

  const add = () => {
    const key = Math.max(...tabs.map((tab) => tab.key)) + 1;
    addedKey.current = key;
    onChange({ tabs: [...tabs, { key, name: "" }], placements });
  };

  const rename = (key: number, name: string) => onChange({ tabs: tabs.map((tab) => (tab.key === key ? { key, name } : tab)), placements });

  const move = (from: number, to: number) => {
    const reordered = [...tabs];
    const [tab] = reordered.splice(from, 1);
    reordered.splice(to, 0, tab);
    onChange({ tabs: reordered, placements });
    setAnnouncement(`Tab ${label(from)} moved to position ${to + 1} of ${tabs.length}.`);
  };

  /** Moves the tab's phases next door, so that none of them is left without a tab. */
  const remove = (index: number) => {
    const { key } = tabs[index];
    const heirIndex = index === 0 ? 1 : index - 1;
    onChange({
      tabs: tabs.filter((tab) => tab.key !== key),
      placements: new Map(
        [...placements].map(([phase, placement]) => [phase, placement.tabKey === key ? { ...placement, tabKey: tabs[heirIndex].key } : placement]),
      ),
    });
    setAnnouncement(`Tab ${label(index)} removed. Its phases moved to tab ${label(heirIndex)}.`);
    addButton.current?.focus();
  };

  const place = (phase: string, change: Partial<Placement>) => {
    const placement = placements.get(phase);
    if (placement) onChange({ tabs, placements: new Map(placements).set(phase, { ...placement, ...change }) });
  };

  if (phases.length === 0) return null;
  const tabOptions = tabs.map((tab, index) => ({ id: String(tab.key), text: tab.name.trim() || `Tab ${label(index)}` }));
  return (
    <section className="waypoint-settings-section" aria-labelledby="waypoint-tabs-heading">
      <h2 id="waypoint-tabs-heading" className="waypoint-settings-heading">
        Tabs
      </h2>
      <p className="waypoint-settings-hint">The hub opens on the first tab. Within a tab, the phases follow the phase order above.</p>
      <ol className="waypoint-tab-list" role="list" aria-labelledby="waypoint-tabs-heading">
        {tabs.map((tab, index) => (
          <li key={tab.key} className="waypoint-tab-row">
            <TextField
              containerClassName="waypoint-tab-name"
              ariaLabel={`Name of tab ${index + 1}`}
              autoFocus={tab.key === addedKey.current}
              value={tab.name}
              onChange={(_event, name) => rename(tab.key, name)}
            />
            <Button
              subtle
              iconProps={{ iconName: "ChevronUp" }}
              ariaLabel={`Move tab ${label(index)} up`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            />
            <Button
              subtle
              iconProps={{ iconName: "ChevronDown" }}
              ariaLabel={`Move tab ${label(index)} down`}
              disabled={index === tabs.length - 1}
              onClick={() => move(index, index + 1)}
            />
            <Button
              subtle
              iconProps={{ iconName: "Delete" }}
              ariaLabel={`Remove tab ${label(index)}`}
              disabled={tabs.length === 1}
              onClick={() => remove(index)}
            />
          </li>
        ))}
      </ol>
      <Button ref={addButton} className="waypoint-add-tab" text="Add tab" iconProps={{ iconName: "Add" }} onClick={add} />
      <p className="waypoint-settings-hint" aria-live="polite">
        {tabsProblem(draft, phases)}
      </p>
      <p className="screen-reader-only" aria-live="polite">
        {announcement}
      </p>
      <table className="waypoint-phase-placement">
        <caption className="waypoint-settings-hint">Choose each phase's tab. A divider is a line with a text before the phase, to set it apart from those before it.</caption>
        <thead>
          <tr>
            <th scope="col">Phase</th>
            <th scope="col">Tab</th>
            <th scope="col">Divider before</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((phase, index) => {
            const placement = placements.get(phase.name);
            return (
              <tr key={phase.name}>
                <th scope="row">{phase.name}</th>
                <td>
                  <ChoiceDropdown
                    ariaLabel={`Tab for ${phase.name}`}
                    descriptionId={`waypoint-tab-of-phase-${index}`}
                    options={tabOptions}
                    selected={String(placement?.tabKey)}
                    onChange={(id) => place(phase.name, { tabKey: Number(id) })}
                  />
                </td>
                <td>
                  <TextField
                    ariaLabel={`Divider before ${phase.name}`}
                    value={placement?.divider ?? ""}
                    onChange={(_event, divider) => place(phase.name, { divider })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
