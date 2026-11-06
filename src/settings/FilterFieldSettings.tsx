import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { FormItem } from "azure-devops-ui/FormItem";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { TextField } from "azure-devops-ui/TextField";
import React, { useEffect, useRef, useState } from "react";
import { isSameTag, tagOptions } from "../board/boardModel";
import type { PicklistField, Platform, WorkItemField } from "../platform/platform";
import { Choice } from "./Choice";
import { fieldsForFilter, isTagPrefix, type FilterField, type FilterFieldType } from "./settings";

/** A filter field as the form holds it, with what its other types would need, so that changing type loses nothing. */
export interface FilterFieldDraft {
  /** Tells drafts apart, since a name can be blank or the same as another's while typing. */
  key: number;
  type: FilterFieldType;
  name: string;
  referenceName: string;
  prefix: string;
  excludedTags: string[];
  filledText: string;
  emptyText: string;
}

const TYPE_OPTIONS: { id: FilterFieldType; text: string }[] = [
  { id: "choice", text: "One value of a picklist" },
  { id: "tagPrefix", text: "Tags with a prefix" },
  { id: "startsWith", text: "Text that starts with" },
  { id: "filled", text: "Filled in or empty" },
];

const emptyDraft = (key: number): FilterFieldDraft => ({ key, type: "choice", name: "", referenceName: "", prefix: "", excludedTags: [], filledText: "Filled in", emptyText: "Empty" });

export function filterFieldDraftsOf(saved: FilterField[]): FilterFieldDraft[] {
  return saved.map((filterField, key) => ({ ...emptyDraft(key), ...filterField }));
}

/** What to store for the drafts. */
export function savedFilterFieldsOf(drafts: FilterFieldDraft[]): FilterField[] {
  return drafts.map(({ type, name: untrimmed, referenceName, prefix, excludedTags, filledText, emptyText }) => {
    const name = untrimmed.trim();
    switch (type) {
      case "choice":
      case "startsWith":
        return { type, name, referenceName };
      case "tagPrefix":
        return { type, name, prefix, excludedTags };
      case "filled":
        return { type, name, referenceName, filledText: filledText.trim(), emptyText: emptyText.trim() };
    }
  });
}

/** Why the drafts cannot be saved, or null if they can. */
export function filterFieldsProblem(drafts: FilterFieldDraft[], picklistFields: PicklistField[], fields: WorkItemField[]): string | null {
  const names = drafts.map(({ name }) => name.trim());
  if (names.includes("")) return "Give every filter a name.";
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) return `Two filters are named ${repeated}. Give each filter a name of its own.`;
  for (const [index, draft] of drafts.entries()) {
    const filter = `filter ${index + 1}`;
    if (draft.type === "tagPrefix") {
      if (!isTagPrefix(draft.prefix)) return `Give ${filter} a tag prefix, without a semicolon.`;
    } else {
      if (!fieldsForFilter(draft.type, picklistFields, fields).some(({ referenceName }) => referenceName === draft.referenceName)) return `Choose a field for ${filter}.`;
      if (draft.type === "filled" && (draft.filledText.trim() === "" || draft.emptyText.trim() === "")) return `Give ${filter} a text for both filled in and empty.`;
    }
  }
  return null;
}

type TagsState = { status: "loading" } | { status: "failed"; reason: string } | { status: "ready"; tags: string[] };

export function FilterFieldSettings({
  platform,
  projectId,
  drafts,
  picklistFields,
  fields,
  onChange,
}: {
  platform: Platform;
  projectId: string;
  drafts: FilterFieldDraft[];
  picklistFields: PicklistField[];
  fields: WorkItemField[];
  onChange: (drafts: FilterFieldDraft[]) => void;
}): React.JSX.Element {
  const [announcement, setAnnouncement] = useState("");
  const addButton = useRef<Button>(null);
  const addedKey = useRef<number | null>(null);

  const change = (key: number, changes: Partial<FilterFieldDraft>) => onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)));

  const add = () => {
    const key = Math.max(-1, ...drafts.map((draft) => draft.key)) + 1;
    addedKey.current = key;
    onChange([...drafts, emptyDraft(key)]);
  };

  const remove = (key: number, label: string) => {
    onChange(drafts.filter((draft) => draft.key !== key));
    setAnnouncement(`Filter ${label} removed.`);
    addButton.current?.focus();
  };

  const tags = useProjectTags(platform, projectId, drafts.some(({ type }) => type === "tagPrefix"));

  return (
    <section className="waypoint-settings-section" aria-labelledby="waypoint-filters-heading">
      <h2 id="waypoint-filters-heading" className="waypoint-settings-heading">
        Filters
      </h2>
      <p className="waypoint-settings-hint">
        Besides keyword and group, the filter row offers these. A link goes by a filter's name, so a link to a filter that is renamed no longer narrows by it.
      </p>
      <ol className="waypoint-filter-list" role="list" aria-labelledby="waypoint-filters-heading">
        {drafts.map((draft, index) => {
          const { type } = draft;
          const number = index + 1;
          const label = draft.name.trim() || String(number);
          return (
            <li key={draft.key} className="waypoint-filter-field">
              <FormItem label={`Name of filter ${number}`}>
                <TextField autoFocus={draft.key === addedKey.current} value={draft.name} onChange={(_event, name) => change(draft.key, { name })} />
              </FormItem>
              <Choice
                label={`Type of filter ${number}`}
                options={TYPE_OPTIONS}
                selected={type}
                onChange={(id) => change(draft.key, { type: id as FilterFieldType })}
              />
              {type === "tagPrefix" ? (
                <TagPrefix number={number} draft={draft} tags={tags} onChange={(changes) => change(draft.key, changes)} />
              ) : (
                <Choice
                  label={`Field of filter ${number}`}
                  options={fieldOptions(type, picklistFields, fields)}
                  selected={draft.referenceName}
                  onChange={(referenceName) => change(draft.key, { referenceName })}
                />
              )}
              {type === "filled" && (
                <>
                  <FormItem label={`Text for filled in, filter ${number}`}>
                    <TextField value={draft.filledText} onChange={(_event, filledText) => change(draft.key, { filledText })} />
                  </FormItem>
                  <FormItem label={`Text for empty, filter ${number}`}>
                    <TextField value={draft.emptyText} onChange={(_event, emptyText) => change(draft.key, { emptyText })} />
                  </FormItem>
                </>
              )}
              <Button className="waypoint-remove-filter" subtle iconProps={{ iconName: "Delete" }} ariaLabel={`Remove filter ${label}`} onClick={() => remove(draft.key, label)} />
            </li>
          );
        })}
      </ol>
      <Button ref={addButton} className="waypoint-add-filter" text="Add filter" iconProps={{ iconName: "Add" }} onClick={add} />
      <p className="waypoint-settings-hint" aria-live="polite">
        {filterFieldsProblem(drafts, picklistFields, fields)}
      </p>
      <p className="screen-reader-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

function fieldOptions(type: Exclude<FilterFieldType, "tagPrefix">, picklistFields: PicklistField[], fields: WorkItemField[]): { id: string; text: string }[] {
  return fieldsForFilter(type, picklistFields, fields)
    .map(({ referenceName, name }) => ({ id: referenceName, text: name }))
    .sort((a, b) => a.text.localeCompare(b.text));
}

/** Reads the tags once a filter needs them, and all tag filters share what was read. */
function useProjectTags(platform: Platform, projectId: string, needed: boolean): TagsState & { retry: () => void } {
  const [state, setState] = useState<TagsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needed) return undefined;
    let outdated = false;
    setState({ status: "loading" });
    platform.getProjectTags(projectId).then(
      (tags) => outdated || setState({ status: "ready", tags }),
      (error: Error) => outdated || setState({ status: "failed", reason: error.message }),
    );
    return () => {
      outdated = true;
    };
  }, [platform, projectId, needed, attempt]);

  return { ...state, retry: () => setAttempt((attempts) => attempts + 1) };
}

function TagPrefix({
  number,
  draft: { prefix, excludedTags },
  tags,
  onChange,
}: {
  number: number;
  draft: FilterFieldDraft;
  tags: TagsState & { retry: () => void };
  onChange: (changes: Partial<FilterFieldDraft>) => void;
}): React.JSX.Element {
  const options = tags.status === "ready" && isTagPrefix(prefix) ? tagOptions(tags.tags, prefix) : [];
  return (
    <>
      <FormItem label={`Tag prefix of filter ${number}`} message="Write it exactly as the tags begin, with any space after it. The filter row shows the tags without it.">
        <TextField value={prefix} onChange={(_event, value) => onChange({ prefix: value })} />
      </FormItem>
      {tags.status === "loading" && (
        <p className="waypoint-settings-hint" role="status">
          Loading tags…
        </p>
      )}
      {tags.status === "failed" && (
        <>
          <MessageCard severity={MessageCardSeverity.Error}>{`Waypoint could not read the tags: ${tags.reason} Saving keeps the tags that are unticked now.`}</MessageCard>
          <ButtonGroup>
            <Button text="Try again" onClick={tags.retry} />
          </ButtonGroup>
        </>
      )}
      {tags.status === "ready" && isTagPrefix(prefix) && options.length === 0 && <p className="waypoint-settings-hint">The project has no tags that begin with this prefix.</p>}
      {options.length > 0 && (
        <>
          <p className="waypoint-settings-hint">Untick a tag to leave it out of the filter. New tags with the prefix are offered without any setting.</p>
          <ul className="waypoint-filter-tags" role="list" aria-label={`Tags offered by filter ${number}`}>
            {options.map(({ id, text }) => (
              <li key={id}>
                <Checkbox
                  label={text}
                  ariaLabel={`Offer ${text}`}
                  checked={!excludedTags.some((tag) => isSameTag(tag, id))}
                  onChange={(_event, offered) => onChange({ excludedTags: offered ? excludedTags.filter((tag) => !isSameTag(tag, id)) : [...excludedTags, id] })}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
