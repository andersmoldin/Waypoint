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

/** Elements whose content is not text anyone wrote for reading, and that a browser does not show. */
const NOT_READ = ["script", "style", "template", "noscript", "title", "iframe", "noembed", "noframes"];

const END_OF_NOT_READ = new Map(NOT_READ.map((name) => [name, new RegExp(`</${name}(?=[\\s/>])`, "gi")]));

/** Elements that begin a line of their own. */
const LINE_ELEMENTS = new Set(["address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "section", "table", "tr", "ul"]);

const SPACE_IN_MARKUP = " \t\n\f\r";

/**
 * The text of a rich text field. The HTML comes from whoever can edit the work item, so it never reaches
 * the page, and no tree is built from it either: a browser needs minutes or crashes on some HTML of a few
 * kilobytes, and elements in a tree can take the names of its own properties. This reads the string once
 * from start to end, so that its time follows its length whatever it holds, and all that can come out is text.
 */
function htmlAsText(html: string): string {
  const parts: string[] = [];
  let position = 0;
  while (position < html.length) {
    const markup = html.indexOf("<", position);
    parts.push(html.slice(position, markup === -1 ? html.length : markup).replace(/\s+/g, " "));
    position = markup === -1 ? html.length : afterMarkup(html, markup, parts);
  }
  return decodedEntities(parts.join(""))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Reads the markup that begins at `start`, adds what it means for the text, and says where the text goes on. */
function afterMarkup(html: string, start: number, parts: string[]): number {
  if (html.startsWith("<!--", start)) return afterComment(html, start);
  const next = html[start + 1];
  if (next === "!" || next === "?") return after(html, ">", start + 2);

  const isEndTag = next === "/";
  const nameStart = isEndTag ? start + 2 : start + 1;
  if (!/[a-z]/i.test(html[nameStart] ?? "")) {
    if (isEndTag) return after(html, ">", nameStart);
    // A less-than sign that begins no tag is text, and the entity keeps it from looking like a tag to what comes next.
    parts.push("&lt;");
    return start + 1;
  }

  let nameEnd = nameStart;
  while (nameEnd < html.length && !SPACE_IN_MARKUP.includes(html[nameEnd]) && html[nameEnd] !== "/" && html[nameEnd] !== ">") nameEnd += 1;
  const name = html.slice(nameStart, nameEnd).toLowerCase();
  parts.push(LINE_ELEMENTS.has(name) ? "\n" : name === "td" || name === "th" ? " " : "");

  const end = afterTag(html, nameEnd);
  const endOfNotRead = isEndTag ? undefined : END_OF_NOT_READ.get(name);
  if (!endOfNotRead) return end;
  endOfNotRead.lastIndex = end;
  return endOfNotRead.exec(html)?.index ?? html.length;
}

function after(html: string, wanted: string, from: number): number {
  const found = html.indexOf(wanted, from);
  return found === -1 ? html.length : found + wanted.length;
}

/** Starts inside the opening, since `<!-->` and `<!--->` are whole comments to a browser. */
function afterComment(html: string, start: number): number {
  const end = /--!?>/g;
  end.lastIndex = start + 2;
  const found = end.exec(html);
  return found ? found.index + found[0].length : html.length;
}

/** Where a tag ends: at the first `>` outside a quoted attribute value. A tag that never ends takes the rest with it, as in a browser. */
function afterTag(html: string, from: number): number {
  let afterEquals = false;
  for (let position = from; position < html.length; position += 1) {
    const character = html[position];
    if (character === ">") return position + 1;
    if (afterEquals && (character === '"' || character === "'")) {
      const closing = html.indexOf(character, position + 1);
      if (closing === -1) return html.length;
      position = closing;
      afterEquals = false;
    } else if (character === "=") {
      afterEquals = true;
    } else if (!SPACE_IN_MARKUP.includes(character)) {
      afterEquals = false;
    }
  }
  return html.length;
}

/** No `<` is left in the text, so that the browser's own table of entities gets one text node to read, and no element. */
function decodedEntities(text: string): string {
  return new DOMParser().parseFromString(text, "text/html").body.textContent ?? "";
}
