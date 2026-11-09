import { DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { FilterBar } from "azure-devops-ui/FilterBar";
import type { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { KeywordFilterBarItem, TextFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { getSafeId } from "azure-devops-ui/Util";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { DropdownMultiSelection, DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import React, { useEffect, useState } from "react";
import type { BoardFilter, BoardFilterField, Group } from "../board/boardModel";
import "./FilterRow.css";

const KEYWORD_ITEM = "keyword";
const GROUP_ITEM = "group";
const FILTER_COMMAND_ID = "waypoint-filter";
/** The answer in filled in or empty that asks for neither. It is never part of a filter, so it does not collide with an option. */
const ALL_ITEM = { id: "all", text: "All" };

/** Keeps a filter field apart from the row's other items, whatever an administrator names it. */
const fieldItemKey = ({ name }: BoardFilterField) => `field:${name}`;

/** The filter icon. The dot says that the board is narrowed although the row that says how is out of sight. */
export function filterCommand({
  rowIsOpen,
  filterIsActive,
  onActivate,
}: {
  rowIsOpen: boolean;
  filterIsActive: boolean;
  onActivate: () => void;
}): IHeaderCommandBarItem {
  const showsDot = filterIsActive && !rowIsOpen;
  const name = showsDot ? "Filter, a filter is active" : "Filter";
  return {
    id: FILTER_COMMAND_ID,
    role: "button",
    ariaLabel: name,
    ariaExpanded: rowIsOpen,
    // The library places a tooltip only as it mounts, and mounts a new one for a new id, so that a text changed by a click still fits the window.
    tooltipProps: { id: showsDot ? `${FILTER_COMMAND_ID}-tooltip-dot` : `${FILTER_COMMAND_ID}-tooltip`, text: name },
    iconProps: { iconName: "Filter", className: showsDot ? "waypoint-filter-dot" : undefined },
    important: true,
    onActivate,
  };
}

export function focusFilterCommand(): void {
  document.getElementById(getSafeId(FILTER_COMMAND_ID) as string)?.focus();
}

/**
 * Lets the viewer change the filter. The row holds what is being typed and chosen for as long as it is
 * open, and hands over each change: `filter` says what it opens with, and from then on the row is ahead of it.
 */
export function FilterRow({
  filter,
  groups,
  filterFields,
  takeFocus,
  onFilterChanged,
  onDismissed,
}: {
  filter: BoardFilter;
  groups: Group[];
  filterFields: BoardFilterField[];
  /** Whether focus goes to the row when it opens, as it does when the viewer opens it, and not when a link does. */
  takeFocus: boolean;
  onFilterChanged: (filter: BoardFilter) => void;
  onDismissed: () => void;
}): React.JSX.Element {
  const [{ rowFilter, selection, groupItems, fieldSelections }] = useState(() => {
    const rowFilter = new Filter();
    rowFilter.setState(
      {
        [KEYWORD_ITEM]: { value: filter.keyword },
        [GROUP_ITEM]: { value: filter.groups.map(String) },
        ...Object.fromEntries(filterFields.map((filterField) => [fieldItemKey(filterField), { value: rowValue(filterField, filter) }])),
      },
      true,
    );
    return {
      rowFilter,
      selection: new DropdownMultiSelection(),
      // Group ids are unique where names are not, and the library compares items by id.
      groupItems: groups.map(({ id, name }) => ({ id: String(id), text: name })),
      fieldSelections: new Map(filterFields.map((filterField) => [filterField, filterField.type === "tagPrefix" ? new DropdownMultiSelection() : new DropdownSelection()])),
    };
  });

  /**
   * The library's own name is "Group filter: Bodil" for what it shows as "Group: Bodil", and a name has
   * to hold the words on the screen for voice control to find it. It says the same as what is shown.
   */
  const dropdownName = (name: string, key: string, items: { id: string; text: string }[]) => {
    const inRow = rowFilter.getFilterItemValue<string[]>(key) ?? [];
    const chosen = items.filter(({ id }) => inRow.includes(id));
    return chosen.length === 0 ? name : `${name}: ${chosen[0].text}${chosen.length > 1 ? ` (+${chosen.length - 1})` : ""}`;
  };

  useEffect(() => {
    const handOver = () => {
      const changed: BoardFilter = {
        keyword: (rowFilter.getFilterItemValue<string>(KEYWORD_ITEM) ?? "").trim(),
        groups: (rowFilter.getFilterItemValue<string[]>(GROUP_ITEM) ?? []).map(Number),
        filterFields: filterFields.flatMap((filterField) => {
          const values = askedInRow(filterField, rowFilter.getFilterItemValue<string | string[]>(fieldItemKey(filterField)));
          return values.length > 0 ? [{ name: filterField.name, values }] : [];
        }),
      };
      // The library also says so when the filter has only come to mean the same, as when spaces are added after a word.
      if (changed.keyword !== filter.keyword || String(changed.groups) !== String(filter.groups) || JSON.stringify(changed.filterFields) !== JSON.stringify(filter.filterFields)) {
        onFilterChanged(changed);
      }
    };
    rowFilter.subscribe(handOver, FILTER_CHANGE_EVENT);
    return () => rowFilter.unsubscribe(handOver, FILTER_CHANGE_EVENT);
  }, [rowFilter, filter, filterFields, onFilterChanged]);

  return (
    <FilterBar
      filter={rowFilter}
      searchRoleAriaLabel="Filter"
      onDismissClicked={onDismissed}
      onMounted={(bar) => {
        if (takeFocus) bar.focus();
      }}
    >
      <KeywordFilterBarItem filterItemKey={KEYWORD_ITEM} placeholder="Filter by keyword" />
      {groupItems.length > 0 ? (
        <DropdownFilterBarItem
          filterItemKey={GROUP_ITEM}
          placeholder="Group"
          ariaLabel={dropdownName("Group", GROUP_ITEM, groupItems)}
          items={groupItems}
          selection={selection}
          showFilterBox
          showPlaceholderAsLabel
        />
      ) : null}
      {filterFields.map((filterField) => {
        const key = fieldItemKey(filterField);
        if (filterField.type === "startsWith") return <TextFilterBarItem key={key} filterItemKey={key} placeholder={`${filterField.name} starts with`} />;
        // A dropdown with nothing to choose from would only be in the way.
        if (filterField.options.length === 0) return null;
        const items = filterField.type === "filled" ? [ALL_ITEM, ...filterField.options] : filterField.options;
        return (
          <DropdownFilterBarItem
            key={key}
            filterItemKey={key}
            placeholder={filterField.name}
            ariaLabel={dropdownName(filterField.name, key, items)}
            items={items}
            selection={fieldSelections.get(filterField)}
            showFilterBox={filterField.type === "tagPrefix"}
            hideClearAction={filterField.type === "filled"}
            showPlaceholderAsLabel
          />
        );
      })}
    </FilterBar>
  );
}

/** What the row holds for a filter field: text for a box, and for a dropdown the ids it has chosen. */
function rowValue(filterField: BoardFilterField, { filterFields }: BoardFilter): string | string[] {
  const asked = filterFields.find(({ name }) => name === filterField.name)?.values ?? [];
  if (filterField.type === "startsWith") return asked[0] ?? "";
  return filterField.type === "filled" && asked.length === 0 ? [ALL_ITEM.id] : asked;
}

/** What the filter asks of a filter field, from what the row holds for it. */
function askedInRow(filterField: BoardFilterField, inRow: string | string[] | undefined): string[] {
  if (filterField.type === "startsWith") {
    const typed = String(inRow ?? "").trim();
    return typed === "" ? [] : [typed];
  }
  return (Array.isArray(inRow) ? inRow : []).filter((id) => filterField.type !== "filled" || id !== ALL_ITEM.id);
}
