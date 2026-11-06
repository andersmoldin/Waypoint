import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { getSafeId } from "azure-devops-ui/Util";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import React, { useEffect, useRef } from "react";

interface ChoiceProps {
  options: { id: string; text: string }[];
  selected: string;
  /** Whether choosing what is already chosen counts as a choice. Otherwise it does nothing, so that unsaved changes stay. */
  reselectable?: boolean;
  /** Whether the options can be narrowed by typing, however few they are. Left out, the dropdown offers it above ten options. */
  filterable?: boolean;
  onChange: (id: string) => void;
}

/** A dropdown with a visible label above it. */
export function Choice({ label, ...choice }: ChoiceProps & { label: string }): React.JSX.Element {
  return (
    <FormItem label={label}>
      <ChoiceDropdown descriptionId={`waypoint-choice-${label.replace(/\W/g, "-")}`} {...choice} />
    </FormItem>
  );
}

/** A dropdown named by the label around it or, if there is none, by `ariaLabel`. `descriptionId` must be unique on the page. */
export function ChoiceDropdown({
  ariaLabel,
  descriptionId,
  options,
  selected,
  reselectable = false,
  filterable,
  onChange,
}: ChoiceProps & { ariaLabel?: string; descriptionId: string }): React.JSX.Element {
  const selection = useRef(new DropdownSelection()).current;
  useEffect(() => {
    const index = options.findIndex((option) => option.id === selected);
    if (index >= 0) selection.select(index);
    else selection.clear();
  }, [options, selected, selection]);

  // The dropdown is named by its label alone, so the choice has to be its description to be heard.
  return (
    <>
      <Dropdown
        ariaLabel={ariaLabel}
        ariaDescribedBy={descriptionId}
        items={options}
        selection={selection}
        placeholder="Choose…"
        showFilterBox={filterable}
        onSelect={(_event, item) => {
          if (reselectable || item.id !== selected) onChange(item.id);
        }}
      />
      {/* The dropdown prefixes the id it is given, so the description has to as well. */}
      <span id={getSafeId(descriptionId)} hidden>
        {options.find((option) => option.id === selected)?.text ?? "Nothing chosen"}
      </span>
    </>
  );
}
