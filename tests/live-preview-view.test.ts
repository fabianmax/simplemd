// @vitest-environment jsdom
/** Live-preview behaviour that only exists with a running view: the drag
 *  freeze, and the parse-budget fallback. */
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
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


describe("clicking a rendered table", () => {
  const doc = "text\n\n| name | note |\n| --- | --- |\n| a | first |\n\ntail\n";

  it("puts the cursor in the clicked cell and reveals the source", () => {
    const view = mount(doc);
    const cell = [...view.dom.querySelectorAll("td")].find(
      (td) => td.textContent === "first",
    )!;
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(doc.slice(view.state.selection.main.head).startsWith("first")).toBe(true);
    expect(view.dom.querySelector(".lp-table")).toBeNull(); // now editable source
    view.destroy();
  });

  it("falls back to the table start when the click misses a cell", () => {
    const view = mount(doc);
    const table = view.dom.querySelector(".lp-table")!;
    table.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.selection.main.head).toBe(doc.indexOf("| name"));
    view.destroy();
  });
});
