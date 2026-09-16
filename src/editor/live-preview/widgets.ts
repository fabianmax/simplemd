import { WidgetType, type EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { toggleTaskSpec } from "./checkbox";
import { cellPos } from "./table";

const md = new MarkdownIt({ html: false });

/** GitHub-shaped allow-list (per research: string-in/string-out, no hooks). */
const SANITIZE = {
  ALLOWED_TAGS: [
    "table", "thead", "tbody", "tr", "th", "td",
    "p", "strong", "em", "del", "code", "a", "br", "span",
  ],
  ALLOWED_ATTR: ["href", "align"],
  ALLOW_DATA_ATTR: false,
};

export class TableWidget extends WidgetType {
  constructor(readonly src: string, readonly from: number) {
    super();
  }
  eq(other: TableWidget) {
    return other.src === this.src && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const div = document.createElement("div");
    div.className = "lp-table";
    div.innerHTML = DOMPurify.sanitize(md.render(this.src), SANITIZE);
    // Rendered links must not navigate the app webview.
    div.addEventListener("click", (e) => e.preventDefault());
    // A block widget swallows its own events, so a click has to be mapped back
    // to the source by hand — otherwise the cursor never enters the table and
    // it cannot be edited at all (#2). Cell-precise: click a cell, land in that
    // cell's text with the row revealed as source.
    div.addEventListener("mousedown", (e) => {
      const cell = (e.target as HTMLElement | null)?.closest?.("td, th");
      const pos = cell ? cellPos(this.src, this.from, ...coords(cell)) : this.from;
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
      view.focus();
    });
    return div;
  }
  ignoreEvent(e: Event) {
    return e.type === "mousedown"; // handled above; CM must not also act.
  }
}

/** [row, col] of a rendered cell, header = row 0. */
function coords(cell: Element): [number, number] {
  const row = cell.parentElement as HTMLTableRowElement | null;
  const col = row ? Array.prototype.indexOf.call(row.children, cell) : 0;
  if (!row) return [0, 0];
  const inHead = row.parentElement?.tagName === "THEAD" || cell.tagName === "TH";
  if (inHead) return [0, col];
  const body = row.parentElement;
  const index = body ? Array.prototype.indexOf.call(body.children, row) : 0;
  return [index + 1, col];
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly markerFrom: number, readonly markerTo: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return (
      other.checked === this.checked &&
      other.markerFrom === this.markerFrom &&
      other.markerTo === this.markerTo
    );
  }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = `lp-checkbox${this.checked ? " lp-checked" : ""}`;
    box.textContent = this.checked ? "☑" : "☐";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.onmousedown = (e) => {
      // preventDefault: the click must NOT move the cursor (Obsidian's
      // documented cursor-jump bug) — only toggle the marker text.
      e.preventDefault();
      const spec = toggleTaskSpec(view.state, this.markerFrom, this.markerTo);
      if (spec) view.dispatch(spec);
    };
    return box;
  }
  ignoreEvent(e: Event) {
    return e.type === "mousedown"; // we handle it; CM must not.
  }
}
