import type { FieldKind, WorkItem, WorkItemField } from "../platform/platform";

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
      return htmlAsText(String(value));
    case "yesNo":
      return value === true ? "Yes" : value === false ? "No" : plainText(value);
    case "date": {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
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
function plainText(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Elements whose content is not text anyone wrote for reading. */
const NOT_READ = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

/** Elements that begin a line of their own. */
const LINE_ELEMENTS = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "LI", "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL"]);

/**
 * The text of a rich text field. The HTML comes from whoever can edit the work item, so it never reaches
 * the page: a parsed document runs no scripts and loads nothing, and only its text is taken out of it.
 */
function htmlAsText(html: string): string {
  const parts: string[] = [];
  const read = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    const name = node.nodeName;
    if (NOT_READ.has(name)) return;
    const separator = LINE_ELEMENTS.has(name) ? "\n" : name === "TD" || name === "TH" ? " " : "";
    parts.push(separator);
    node.childNodes.forEach(read);
    parts.push(separator);
  };
  read(new DOMParser().parseFromString(html, "text/html").body);
  return parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}
