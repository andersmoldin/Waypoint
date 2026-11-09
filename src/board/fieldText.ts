import type { FieldKind, WorkItem, WorkItemField } from "../platform/platform";
import { htmlAsText } from "./htmlText";

/**
 * What has been read from each work item, so that building the board anew on every filter change parses
 * no rich text twice. A fetch brings new work items, so what is read goes with the fetch it came from.
 */
const TEXTS_READ = new WeakMap<WorkItem, Map<string, string>>();

/** A field of a work item as text to show. See {@link valueText}. */
export function fieldText(item: WorkItem, { kind, referenceName }: WorkItemField): string {
  const texts = TEXTS_READ.get(item) ?? new Map<string, string>();
  TEXTS_READ.set(item, texts);
  const key = `${kind} ${referenceName}`;
  const read = texts.get(key) ?? valueText(kind, item.fields[referenceName]);
  texts.set(key, read);
  return read;
}

/** What a field shows when its value cannot even be written out. It costs that field, not the board. */
const UNREADABLE_VALUE = "Could not be read here. Open the work item to see it.";

/**
 * A field's value as text to show, or "" if it is empty. `workitemsbatch` leaves empty fields out, and
 * a field holding only spaces or empty HTML is just as empty to whoever reads it.
 */
function valueText(kind: FieldKind, value: unknown): string {
  if (value === undefined || value === null) return "";
  const shown = valueAsText(kind, value);
  return shown.trim() === "" ? "" : shown;
}

function valueAsText(kind: FieldKind, value: unknown): string {
  switch (kind) {
    case "html":
      return typeof value === "string" ? htmlAsText(value) : plainText(value);
    case "yesNo":
      return value === true ? "Yes" : value === false ? "No" : plainText(value);
    case "date": {
      const written = plainText(value);
      const date = new Date(written);
      return Number.isNaN(date.getTime()) ? written : date.toLocaleString();
    }
    case "identity": {
      const { displayName } = value as { displayName?: unknown };
      return typeof displayName === "string" ? displayName : plainText(value);
    }
    case "text":
      return plainText(value);
  }
}

/** A value of a shape nobody expected still shows what it holds, not "[object Object]". */
export function plainText(value: unknown): string {
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch {
    return UNREADABLE_VALUE;
  }
}
