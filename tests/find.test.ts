// @vitest-environment jsdom
/** The find popup: smart case, the count label, and typing into the pill. */
import { describe, it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  SearchQuery,
  getSearchQuery,
  openSearchPanel,
  searchPanelOpen,
} from "@codemirror/search";
import { createEditorState } from "../src/editor/setup";
import { smartCase, matchLabel, countMatches } from "../src/find-ui";

const DOC = "alpha beta\nAlpha gamma\nalpha delta\n";

describe("smart case", () => {
  it("stays case-insensitive for a lowercase query", () => {
    expect(smartCase("alpha")).toBe(false);
  });
  it("turns case-sensitive as soon as the reader types a capital", () => {
    expect(smartCase("Alpha")).toBe(true);
  });
});

describe("match counting", () => {
  const state = (cursor = 0) =>
    createEditorState(DOC).update({ selection: EditorSelection.cursor(cursor) }).state;

  it("counts every hit, case-insensitively", () => {
    expect(countMatches(state(), new SearchQuery({ search: "alpha" })).total).toBe(3);
  });
  it("respects case when the query carries one", () => {
    const q = new SearchQuery({ search: "Alpha", caseSensitive: true });
    expect(countMatches(state(), q).total).toBe(1);
  });
  it("reports which match the selection is on", () => {
    const sel = createEditorState(DOC).update({
      selection: EditorSelection.range(DOC.indexOf("alpha delta"), DOC.indexOf("alpha delta") + 5),
    }).state;
    expect(countMatches(sel, new SearchQuery({ search: "alpha" })).index).toBe(3);
  });
  it("stops at the cap rather than scanning a long file per keystroke", () => {
    const big = createEditorState("alpha ".repeat(2000));
    const c = countMatches(big, new SearchQuery({ search: "alpha" }), 50);
    expect(c).toMatchObject({ total: 50, capped: true });
  });
});

describe("count label", () => {
  const none = { total: 0, index: null, capped: false };
  it("says nothing without a query", () => {
    expect(matchLabel("", none)).toBe("");
  });
  it("shows a bare zero for no hits", () => {
    expect(matchLabel("zzz", none)).toBe("0");
  });
  it("shows position and total once the cursor is on a match", () => {
    expect(matchLabel("a", { total: 12, index: 3, capped: false })).toBe("3/12");
  });
  it("shows the total alone off-match, and marks a capped count", () => {
    expect(matchLabel("a", { total: 12, index: null, capped: false })).toBe("12");
    expect(matchLabel("a", { total: 500, index: 2, capped: true })).toBe("2/500+");
  });
});

describe("the popup", () => {
  const mount = () => {
    const view = new EditorView({ state: createEditorState(DOC), parent: document.body });
    openSearchPanel(view);
    return view;
  };
  const pop = (view: EditorView) => ({
    input: view.dom.querySelector<HTMLInputElement>(".find-pop .find-input")!,
    count: view.dom.querySelector<HTMLElement>(".find-pop .find-count")!,
    buttons: [...view.dom.querySelectorAll<HTMLButtonElement>(".find-pop .find-btn")],
  });
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("is a pill, not CM's bar — no replace, no toggles", () => {
    const view = mount();
    const { input, buttons } = pop(view);
    expect(input).not.toBeNull();
    expect(view.dom.querySelector('[name="replace"]')).toBeNull();
    expect(view.dom.querySelectorAll('.find-pop input[type="checkbox"]').length).toBe(0);
    expect(buttons.map((b) => b.textContent)).toEqual(["▲", "▼", "✕"]);
    view.destroy();
  });

  it("selects the first match while typing and counts the rest", () => {
    const view = mount();
    const { input, count } = pop(view);
    type(input, "alpha");
    const sel = view.state.selection.main;
    expect(view.state.doc.sliceString(sel.from, sel.to)).toBe("alpha");
    expect(sel.from).toBe(0);
    expect(count.textContent).toBe("1/3");
    view.destroy();
  });

  it("steps with the buttons, and wraps at the end", () => {
    const view = mount();
    const { input, count, buttons } = pop(view);
    type(input, "alpha");
    buttons[1].click(); // ▼
    expect(count.textContent).toBe("2/3");
    buttons[1].click();
    expect(count.textContent).toBe("3/3");
    buttons[1].click(); // past the last one
    expect(count.textContent).toBe("1/3");
    buttons[0].click(); // ▲ back round the other way
    expect(count.textContent).toBe("3/3");
    view.destroy();
  });

  it("smart-cases the query it sends to CM", () => {
    const view = mount();
    const { input, count } = pop(view);
    type(input, "Alpha");
    expect(getSearchQuery(view.state).caseSensitive).toBe(true);
    expect(count.textContent).toBe("1/1");
    view.destroy();
  });

  it("marks a query with no hits instead of growing an error row", () => {
    const view = mount();
    const { input, count } = pop(view);
    type(input, "zzz");
    expect(count.textContent).toBe("0");
    expect(view.dom.querySelector(".find-pop")!.classList.contains("find-empty")).toBe(true);
    view.destroy();
  });

  it("closes on Escape and on ✕", () => {
    const view = mount();
    pop(view).input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(searchPanelOpen(view.state)).toBe(false);

    openSearchPanel(view);
    pop(view).buttons[2].click();
    expect(searchPanelOpen(view.state)).toBe(false);
    view.destroy();
  });
});
