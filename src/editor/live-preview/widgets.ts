import { WidgetType, type EditorView } from "@codemirror/view";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { toggleTaskSpec } from "./checkbox";

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
  constructor(readonly src: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.src === this.src;
  }
  toDOM() {
    const div = document.createElement("div");
    div.className = "lp-table";
    div.innerHTML = DOMPurify.sanitize(md.render(this.src), SANITIZE);
    // Rendered links must not navigate the app webview.
    div.addEventListener("click", (e) => e.preventDefault());
    return div;
  }
  // Default ignoreEvent (true) lets CM place the cursor at the widget's
  // position on click -> the table reveals as raw source.
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
