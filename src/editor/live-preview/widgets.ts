import { WidgetType, type EditorView } from "@codemirror/view";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { toggleTaskSpec } from "./checkbox";
import { cellRange, escapeCell } from "./table";

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

/** Where each rendered table sits in the document. Kept on the DOM rather than
 *  in the widget instance because the DOM outlives the instance: every
 *  keystroke builds a new widget, and `updateDOM` hands the old DOM back. */
const tables = new WeakMap<HTMLElement, { src: string; from: number }>();

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
    tables.set(div, { src: this.src, from: this.from });
    bindTable(div, view);
    return div;
  }
  /** Called with the DOM of the previous instance. While a cell is being
   *  edited the DOM is left exactly as it is — re-rendering it would replace
   *  the element the caret lives in, and typing would break after one
   *  character (#13). */
  updateDOM(dom: HTMLElement, _view: EditorView) {
    tables.set(dom, { src: this.src, from: this.from });
    if (editing && dom.contains(editing)) return true;
    dom.innerHTML = DOMPurify.sanitize(md.render(this.src), SANITIZE);
    return true;
  }
  /** Everything inside is ours: the cell is an editable island, and a keystroke
   *  in it must not reach the editor's keymap. */
  ignoreEvent() {
    return true;
  }
}

/** [row, col] of a rendered cell, header = row 0. */
function coords(cell: Element): [number, number] {
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!row) return [0, 0];
  const col = Array.prototype.indexOf.call(row.children, cell);
  const inHead = row.parentElement?.tagName === "THEAD" || cell.tagName === "TH";
  if (inHead) return [0, col];
  const body = row.parentElement;
  const index = body ? Array.prototype.indexOf.call(body.children, row) : 0;
  return [index + 1, col];
}

/** The cell currently showing its source, if any. The rebuild check reads this
 *  rather than document.activeElement: it is our own state, it survives an
 *  environment that does not implement focus for editable islands, and it says
 *  what we actually mean. */
let editing: HTMLTableCellElement | null = null;

/** WebKit takes contenteditable="plaintext-only", which keeps pasted markup
 *  out; elsewhere the value does not stick and plain editable has to do.
 *  Probed on first use, not at import: this module is loaded by headless tests
 *  where there is no document at all. */
let plaintextOnly: boolean | null = null;
function editableValue(): string {
  if (plaintextOnly === null) {
    const probe = document.createElement("div");
    probe.setAttribute("contenteditable", "plaintext-only");
    plaintextOnly = probe.contentEditable === "plaintext-only";
  }
  return plaintextOnly ? "plaintext-only" : "true";
}

function bindTable(div: HTMLElement, view: EditorView) {
  div.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement | null;
    // ⌘-click follows a link, here as everywhere else (#14). The app opens it:
    // relative links have to be resolved against the file's directory.
    const link = e.metaKey ? target?.closest?.("a[href]") : null;
    if (link) {
      e.preventDefault();
      div.dispatchEvent(
        new CustomEvent("simplemd-link", {
          bubbles: true,
          detail: link.getAttribute("href"),
        }),
      );
      return;
    }
    const cell = target?.closest?.("th, td") as HTMLTableCellElement | null;
    if (!cell) return;
    if (cell === editing) return; // already source: let the caret move normally
    e.preventDefault();
    beginEdit(cell, view);
  });
  // A rendered link must never navigate the app's own webview.
  div.addEventListener("click", (e) => {
    if ((e.target as HTMLElement | null)?.closest?.("a[href]")) e.preventDefault();
  });
}

/** Show one cell's raw source and let it be typed into. The table keeps its
 *  shape; every other cell stays rendered. The CM selection is deliberately NOT
 *  moved into the table — that is what would flip the whole thing to source. */
function beginEdit(cell: HTMLTableCellElement, view: EditorView) {
  const div = cell.closest(".lp-table") as HTMLElement | null;
  const table = div && tables.get(div);
  if (!div || !table) return;

  const [row, col] = coords(cell);
  let range = cellRange(table.src, table.from, row, col);
  if (range.to > view.state.doc.length) return;

  endEdit(view); // commit whatever cell was open before this one
  editing = cell;
  cell.textContent = view.state.doc.sliceString(range.from, range.to);
  cell.setAttribute("contenteditable", editableValue());
  cell.classList.add("lp-cell-edit");
  cell.focus();
  placeCaretAtEnd(cell);

  const write = () => {
    const insert = escapeCell(cell.textContent ?? "");
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      // No selection in the spec: the cursor stays where the reader left it in
      // the document, and the reveal predicate leaves the table rendered.
      userEvent: "input.type",
    });
    range = { from: range.from, to: range.from + insert.length };
  };

  cell.oninput = write;
  cell.onblur = () => endEdit(view);
  cell.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // a newline cannot live in a GFM cell
      endEdit(view);
      view.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      endEdit(view);
      view.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const cells = [...div.querySelectorAll<HTMLTableCellElement>("th, td")];
      const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      endEdit(view);
      if (next) beginEdit(next, view);
      else view.focus();
    }
  };
}

/** Hand the cell back to the renderer. */
function endEdit(view: EditorView) {
  const cell = editing;
  if (!cell) return;
  editing = null;
  cell.oninput = null;
  cell.onblur = null;
  cell.onkeydown = null;
  cell.removeAttribute("contenteditable");
  cell.classList.remove("lp-cell-edit");
  const div = cell.closest(".lp-table") as HTMLElement | null;
  const table = div && tables.get(div);
  if (!div || !table) return;
  const [row, col] = coords(cell);
  const range = cellRange(table.src, table.from, row, col);
  const text = view.state.doc.sliceString(
    Math.min(range.from, view.state.doc.length),
    Math.min(range.to, view.state.doc.length),
  );
  cell.innerHTML = DOMPurify.sanitize(md.renderInline(text), SANITIZE);
}

function placeCaretAtEnd(el: HTMLElement) {
  const sel = el.ownerDocument.getSelection?.();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
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
