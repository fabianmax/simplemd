// @vitest-environment jsdom
/** Live-preview behaviour that only exists with a running view: the drag
 *  freeze, and the parse-budget fallback. */
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { forceParsing } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { createEditorState } from "../src/editor/setup";

const DOC = "text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail\n";
const TABLE_INSIDE = 10; // inside the header row

function mount(doc = DOC) {
  const view = new EditorView({ state: createEditorState(doc), parent: document.body });
  return view;
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("drag freeze", () => {
  it("holds decorations still while the pointer is down", () => {
    const view = mount();
    expect(view.dom.querySelector(".lp-table")).not.toBeNull();
    view.dom.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    view.dispatch({ selection: EditorSelection.cursor(TABLE_INSIDE) });
    // Frozen: the table is still rendered even though the cursor is in it.
    expect(view.dom.querySelector(".lp-table")).not.toBeNull();
    view.destroy();
  });

  it("rebuilds once the drag ends", async () => {
    const view = mount();
    view.dom.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    view.dispatch({ selection: EditorSelection.cursor(TABLE_INSIDE) });
    window.dispatchEvent(new Event("pointerup"));
    await tick(150); // freeze releases ~100ms after pointerup
    // Thawed: the cursor line reveals its source, no keystroke needed.
    expect(view.dom.querySelector(".lp-table")).toBeNull();
    view.destroy();
  });
});


describe("editing a table cell in place (#13)", () => {
  const doc = "text\n\n| name | note |\n| --- | --- |\n| a | **first** |\n\ntail\n";
  const cellNamed = (view: EditorView, text: string) =>
    [...view.dom.querySelectorAll<HTMLTableCellElement>("th, td")].find(
      (c) => c.textContent === text,
    )!;
  const click = (cell: HTMLElement, init: MouseEventInit = {}) =>
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, ...init }));
  const type = (cell: HTMLElement, text: string) => {
    cell.textContent = text;
    cell.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("shows that cell's source and leaves the table rendered", () => {
    const view = mount(doc);
    const cell = cellNamed(view, "first"); // rendered: **first** shows as first
    click(cell);

    expect(cell.textContent).toBe("**first**"); // source, in place
    expect(cell.getAttribute("contenteditable")).toBeTruthy();
    expect(view.dom.querySelector(".lp-table")).not.toBeNull(); // still a table
    // The CM cursor must NOT move into the table, or the reveal predicate
    // would turn the whole thing back into pipe syntax.
    expect(view.state.selection.main.from).toBe(0);
    view.destroy();
  });

  it("writes what is typed back into that cell's range", () => {
    const view = mount(doc);
    click(cellNamed(view, "first"));
    const cell = view.dom.querySelector<HTMLElement>(".lp-cell-edit")!;
    type(cell, "**second**");

    expect(view.state.doc.toString()).toBe(doc.replace("**first**", "**second**"));
    // Same element, still editing: a re-render here would eat the caret.
    expect(view.dom.querySelector(".lp-cell-edit")).toBe(cell);
    view.destroy();
  });

  it("escapes a typed pipe instead of splitting the row", () => {
    const view = mount(doc);
    click(cellNamed(view, "a"));
    type(view.dom.querySelector<HTMLElement>(".lp-cell-edit")!, "x | y");
    expect(view.state.doc.toString()).toContain("| x \\| y |");
    view.destroy();
  });

  it("only one cell is in source at a time", () => {
    const view = mount(doc);
    click(cellNamed(view, "a"));
    click(cellNamed(view, "note"));
    expect(view.dom.querySelectorAll(".lp-cell-edit").length).toBe(1);
    view.destroy();
  });

  it("Tab moves to the next cell, Escape hands the editor back", () => {
    const view = mount(doc);
    click(cellNamed(view, "name"));
    const first = view.dom.querySelector<HTMLElement>(".lp-cell-edit")!;
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    const second = view.dom.querySelector<HTMLElement>(".lp-cell-edit")!;
    expect(second).not.toBe(first);
    expect(second.textContent).toBe("note");

    second.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.dom.querySelector(".lp-cell-edit")).toBeNull();
    view.destroy();
  });

  it("⌘-click on a link inside a cell asks the app to open it (#14)", () => {
    const linky = "| a |\n|---|\n| [docs](https://example.com) |\n";
    const view = mount("text\n\n" + linky);
    const seen: string[] = [];
    view.dom.addEventListener("simplemd-link", (e) =>
      seen.push((e as CustomEvent<string>).detail),
    );
    const link = view.dom.querySelector<HTMLElement>(".lp-table a")!;
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, metaKey: true }));

    expect(seen).toEqual(["https://example.com"]);
    expect(view.dom.querySelector(".lp-cell-edit")).toBeNull(); // not an edit
    view.destroy();
  });
});

describe("streaming parse", () => {
  /** A document far too big to parse inside the first build's budget: the tail
   *  is undecorated at first, and the field has to catch up as the background
   *  parse advances — with no keystroke to prompt it (#3, #9). */
  const BIG = "| a | b |\n|---|---|\n| 1 | 2 |\n\nprose paragraph\n\n".repeat(20_000);

  /** TableWidgets in the decorations the view is actually using. */
  const tables = (view: EditorView) => {
    let n = 0;
    for (const source of view.state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(view) : source;
      set.between(0, view.state.doc.length, (_f, _t, d) => {
        const w = (d.spec as { widget?: { constructor: { name: string } } }).widget;
        if (w?.constructor.name === "TableWidget") n++;
      });
    }
    return n;
  };

  it("decorates the tail once the parse gets there", () => {
    const view = new EditorView({ state: createEditorState(BIG), parent: document.body });
    const first = tables(view);
    expect(first).toBeGreaterThan(0); // the top of the file reads at once
    expect(first).toBeLessThan(20_000); // …and the rest is not parsed yet

    forceParsing(view, view.state.doc.length, 20_000);
    expect(tables(view)).toBeGreaterThan(first); // caught up on its own
    view.destroy();
  });
});
