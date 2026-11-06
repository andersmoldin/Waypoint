import { Button } from "azure-devops-ui/Button";
import React, { useEffect, useRef, useState } from "react";
import type { WorkItemField } from "../platform/platform";
import { Choice } from "./Choice";
import { ROLE_NAMES, fieldsForRole, fieldsWithRoles, type CardRoles } from "./settings";

/** What the form holds for the card and its detail panel, as the settings would store it. */
export interface CardChoices {
  roles: CardRoles;
  /** The detail panel's fields, or null as long as the panel follows the card's roles. */
  detailFields: string[] | null;
}

export const NO_CARD_CHOICES: CardChoices = { roles: {}, detailFields: null };

const ROLE_LABELS: Record<keyof CardRoles, string> = {
  currentSituation: "Current situation",
  waitingOn: "Waiting on",
  marker: "Marker",
};

const NO_FIELD = "";

/** The form's part for what the card and the detail panel show from each object, among the fields on the object's type. */
export function CardFieldSettings({
  fields,
  choices,
  onChange,
}: {
  fields: WorkItemField[];
  choices: CardChoices;
  onChange: (choices: CardChoices) => void;
}): React.JSX.Element {
  const { roles, detailFields } = choices;
  const chooseRole = (role: keyof CardRoles, field: string) => {
    const others = Object.fromEntries(Object.entries(roles).filter(([name]) => name !== role));
    onChange({ ...choices, roles: field === NO_FIELD ? others : { ...others, [role]: field } });
  };

  return (
    <>
      <section className="waypoint-settings-section" aria-labelledby="waypoint-card-roles-heading">
        <h2 id="waypoint-card-roles-heading" className="waypoint-settings-heading">
          Card
        </h2>
        <p className="waypoint-settings-hint">
          Every role is optional. Current situation shows at most two lines. Waiting on marks the card in yellow when the field is filled in. Marker
          shows the field's name as a label when its value is yes.
        </p>
        {ROLE_NAMES.map((role) => (
          <Choice
            key={role}
            label={ROLE_LABELS[role]}
            options={[{ id: NO_FIELD, text: "None" }, ...fieldOptions(fieldsForRole(role, fields))]}
            selected={roles[role] ?? NO_FIELD}
            filterable
            onChange={(field) => chooseRole(role, field)}
          />
        ))}
      </section>
      <DetailFieldList
        fields={fields}
        chosen={detailFields ?? fieldsWithRoles(roles)}
        onChange={(chosen) => onChange({ ...choices, detailFields: chosen })}
      />
    </>
  );
}

function DetailFieldList({
  fields,
  chosen,
  onChange,
}: {
  fields: WorkItemField[];
  chosen: string[];
  onChange: (chosen: string[]) => void;
}): React.JSX.Element {
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const removedAt = useRef<number | null>(null);

  // The button that was pressed goes with its field, and focus must not fall out of the form with it.
  useEffect(() => {
    if (removedAt.current === null) return;
    const removeButtons = list.current?.querySelectorAll<HTMLElement>(".waypoint-detail-field-remove") ?? [];
    (removeButtons[Math.min(removedAt.current, removeButtons.length - 1)] ?? heading.current)?.focus();
    removedAt.current = null;
  });

  const nameOf = (referenceName: string) => fields.find((field) => field.referenceName === referenceName)?.name ?? referenceName;

  const move = (from: number, to: number) => {
    const reordered = [...chosen];
    const [field] = reordered.splice(from, 1);
    reordered.splice(to, 0, field);
    onChange(reordered);
    setAnnouncement(`${nameOf(field)} moved to position ${to + 1} of ${chosen.length}.`);
  };
  const remove = (index: number) => {
    removedAt.current = index;
    onChange(chosen.filter((_field, position) => position !== index));
    setAnnouncement(`${nameOf(chosen[index])} removed.`);
  };
  const add = (field: string) => {
    onChange([...chosen, field]);
    setAnnouncement(`${nameOf(field)} added.`);
  };

  return (
    <section className="waypoint-settings-section" aria-labelledby="waypoint-detail-fields-heading">
      <h2 id="waypoint-detail-fields-heading" className="waypoint-settings-heading" ref={heading} tabIndex={-1}>
        Detail panel
      </h2>
      <p className="waypoint-settings-hint">
        A click on a card opens a panel with the object's title and these fields in this order. Until the list is changed it follows the card.
      </p>
      {chosen.length > 0 && (
        <ol className="waypoint-detail-fields" role="list" aria-labelledby="waypoint-detail-fields-heading" ref={list}>
          {chosen.map((referenceName, index) => {
            const name = nameOf(referenceName);
            return (
              <li key={referenceName} className="waypoint-detail-field">
                <span className="waypoint-detail-field-name">{name}</span>
                <Button
                  subtle
                  iconProps={{ iconName: "ChevronUp" }}
                  ariaLabel={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                />
                <Button
                  subtle
                  iconProps={{ iconName: "ChevronDown" }}
                  ariaLabel={`Move ${name} down`}
                  disabled={index === chosen.length - 1}
                  onClick={() => move(index, index + 1)}
                />
                <Button
                  subtle
                  className="waypoint-detail-field-remove"
                  iconProps={{ iconName: "Cancel" }}
                  ariaLabel={`Remove ${name}`}
                  onClick={() => remove(index)}
                />
              </li>
            );
          })}
        </ol>
      )}
      <Choice
        label="Add a field"
        options={fieldOptions(fields.filter(({ referenceName }) => !chosen.includes(referenceName)))}
        selected=""
        filterable
        onChange={add}
      />
      <p className="screen-reader-only" role="status">
        {announcement}
      </p>
    </section>
  );
}

function fieldOptions(fields: WorkItemField[]): { id: string; text: string }[] {
  return [...fields].sort((a, b) => a.name.localeCompare(b.name)).map(({ referenceName, name }) => ({ id: referenceName, text: name }));
}
