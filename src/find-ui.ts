/** The find popup: CM's search state and commands, simplemd's chrome.
 *
 *  CM's stock panel is a full-width bar with replace, three checkboxes and five
 *  buttons — too much furniture for a review surface. This is the same engine
 *  behind a pill: query, count, ▲ ▼ ✕. It has to be a CM *panel* rather than a
 *  free-floating div, because the match highlighter only paints while a panel
 *  is open (`searchHighlighter` returns Decoration.none on a null panel).
 *
 *  No case/regexp/word toggles: the query is smart-cased instead (see below),
 *  which is the opinionated default this project prefers over a settings row.
 *  No replace: rewriting an agent's plan in bulk is not what this window is for.
 */
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  setSearchQuery,
} from "@codemirror/search";

/** Uppercase in the query means the reader typed it on purpose. */
export function smartCase(search: string): boolean {
  return /[A-Z]/.test(search);
}

export interface MatchCount {
  total: number;
  /** 1-based position of the selected match, null when the cursor is elsewhere. */
  index: number | null;
  /** counting stopped at the cap */
  capped: boolean;
}

const COUNT_CAP = 500;

/** Matches of `query` in the document, and which one the selection is on.
 *  Capped: a two-letter query in a long file is not worth a full scan on every
 *  keystroke, and no one reads past "500+" anyway. */
export function countMatches(
  state: EditorState,
  query: SearchQuery,
  cap = COUNT_CAP,
): MatchCount {
  if (!query.valid) return { total: 0, index: null, capped: false };
  const sel = state.selection.main;
  let total = 0;
  let index: number | null = null;
  const cursor = query.getCursor(state);
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) index = total;
    if (total >= cap) return { total, index, capped: true };
  }
  return { total, index, capped: false };
}

/** "3/12", "12" when the cursor sits off-match, "0" for no hits, "" for no query. */
export function matchLabel(query: string, count: MatchCount): string {
  if (!query) return "";
  if (count.total === 0) return "0";
  const total = `${count.total}${count.capped ? "+" : ""}`;
  return count.index == null ? total : `${count.index}/${total}`;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "find-btn";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  // The editor must not lose the selection to the button.
  b.onmousedown = (e) => e.preventDefault();
  b.onclick = onClick;
  return b;
}

export function findPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "find-pop";
  dom.setAttribute("role", "search");

  const input = document.createElement("input");
  input.className = "find-input";
  input.placeholder = "Find";
  input.setAttribute("main-field", "true"); // openSearchPanel focuses this
  input.setAttribute("aria-label", "Find in document");

  const count = document.createElement("span");
  count.className = "find-count";

  // Where the reader was when the panel opened: every keystroke searches from
  // here, so typing "wat…" walks forward from the cursor instead of chaining
  // findNext off its own previous hit.
  let anchor = view.state.selection.main.from;

  const applyQuery = (jump: boolean) => {
    const search = input.value;
    const query = new SearchQuery({ search, caseSensitive: smartCase(search) });
    view.dispatch({ effects: setSearchQuery.of(query) });
    if (!jump || !query.valid) return render();
    const cursor = query.getCursor(view.state, anchor);
    let hit = cursor.next();
    if (hit.done) {
      const wrapped = query.getCursor(view.state, 0);
      hit = wrapped.next();
    }
    if (!hit.done) {
      view.dispatch({
        selection: EditorSelection.range(hit.value.from, hit.value.to),
        effects: EditorView.scrollIntoView(hit.value.from, { y: "center" }),
      });
    }
    render();
  };

  const render = () => {
    const query = getSearchQuery(view.state);
    count.textContent = matchLabel(input.value, countMatches(view.state, query));
    dom.classList.toggle("find-empty", !!input.value && count.textContent === "0");
  };

  input.oninput = () => applyQuery(true);
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  };

  dom.append(
    input,
    count,
    button("▲", "Previous match (⇧⌘G)", () => findPrevious(view)),
    button("▼", "Next match (⌘G)", () => findNext(view)),
    button("✕", "Close (esc)", () => closeSearchPanel(view)),
  );

  return {
    dom,
    top: true,
    mount() {
      // openSearchPanel seeds the query from the selection before mounting.
      input.value = getSearchQuery(view.state).search;
      anchor = view.state.selection.main.from;
      render();
    },
    update(update: ViewUpdate) {
      const query = getSearchQuery(update.state);
      // Query set from outside the popup (⌘F over a selection).
      if (query.search !== getSearchQuery(update.startState).search) {
        if (query.search !== input.value) input.value = query.search;
      }
      if (update.docChanged || update.selectionSet || update.transactions.length) render();
    },
  };
}
