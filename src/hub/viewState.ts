import { TAG_SEPARATOR, type BoardFilter, type BoardFilterField, type Group } from "../board/boardModel";

const TAB_PARAMETER = "tab";
const KEYWORD_PARAMETER = "keyword";
const GROUP_PARAMETER = "group";
/** Keeps a filter field's name apart from the other parameters in the URL, whatever an administrator names it. */
const FILTER_FIELD_PARAMETER = "filter.";

/** What a link says about the view. Anyone can write a link, so nothing here is known to exist on the board. */
export interface ViewState {
  /** The name of the tab the link asks for, if any. */
  tab: string | null;
  /** The keyword the link asks for, without spaces around it. */
  keyword: string;
  /** What the link has where it names groups, piece by piece. */
  groups: string[];
  /** What the link has for each filter field it names, by the filter field's name. */
  filterFields: Map<string, string>;
}

export function readViewState(parameters: Record<string, string>): ViewState {
  return {
    tab: parameters[TAB_PARAMETER] ?? null,
    keyword: (parameters[KEYWORD_PARAMETER] ?? "").trim(),
    groups: (parameters[GROUP_PARAMETER] ?? "").split(","),
    filterFields: new Map(
      Object.entries(parameters).flatMap(([name, value]) => (name.startsWith(FILTER_FIELD_PARAMETER) ? [[name.slice(FILTER_FIELD_PARAMETER.length), value] as const] : [])),
    ),
  };
}

/**
 * The filter a link asks for. A group the board does not list counts for nothing, also one that is
 * hidden, and so does anything a filter field does not offer.
 */
export function filterFromLink({ keyword, groups, filterFields: inLink }: ViewState, shownGroups: Group[], filterFields: BoardFilterField[]): BoardFilter {
  return {
    keyword,
    groups: shownGroups.filter(({ id }) => groups.includes(String(id))).map(({ id }) => id),
    filterFields: filterFields.flatMap((filterField) => {
      const values = valuesFromLink(filterField, inLink.get(filterField.name) ?? "");
      return values.length > 0 ? [{ name: filterField.name, values }] : [];
    }),
  };
}

function valuesFromLink(filterField: BoardFilterField, inLink: string): string[] {
  switch (filterField.type) {
    case "startsWith":
      return inLink.trim() === "" ? [] : [inLink.trim()];
    case "tagPrefix": {
      const tags = inLink.split(TAG_SEPARATOR);
      return filterField.options.filter(({ id }) => tags.includes(id)).map(({ id }) => id);
    }
    case "choice":
    case "filled":
      return filterField.options.filter(({ id }) => id === inLink).map(({ id }) => id);
  }
}

export function tabParameters(tabName: string): Record<string, string> {
  return { [TAB_PARAMETER]: tabName };
}

/** The value of a filter that asks for nothing is empty, which takes the parameter out of the URL. */
export function filterParameters({ keyword, groups, filterFields: asked }: BoardFilter, filterFields: BoardFilterField[]): Record<string, string> {
  return {
    [KEYWORD_PARAMETER]: keyword,
    [GROUP_PARAMETER]: groups.join(","),
    ...Object.fromEntries(
      filterFields.map(({ name }) => [`${FILTER_FIELD_PARAMETER}${name}`, asked.find((filterField) => filterField.name === name)?.values.join(TAG_SEPARATOR) ?? ""]),
    ),
  };
}

/** Those of `wanted` that the URL does not already say. */
export function parametersToWrite(inUrl: Record<string, string>, wanted: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(wanted).filter(([name, value]) => (inUrl[name] ?? "") !== value));
}
