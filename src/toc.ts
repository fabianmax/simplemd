/** Outline panel: jump targets derived from the document's headings.
 *
 *  Headings come from the lezer tree, never from a `^#+` scan — a "#" inside a
 *  fenced block is code, not a heading, and only the tree knows the difference.
 *  Like the browser this is a view over the buffer: nothing is indexed, nothing
 *  is stored, and the outline is rebuilt from state on demand. */
import type { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";

export interface Heading {
  level: number;
  text: string;
  /** Document offset of the heading's first character. */
  from: number;
}

const PARSE_BUDGET_MS = 1000;

/** Strip the markers, keep the text. Works for ATX ("## Title ##") and setext
 *  (the underline is a second line we never look at). */
export function headingText(raw: string, level: number): string {
  const text = raw
    .split("\n")[0]
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
  // An empty heading is still a real jump target; show its depth rather than
  // an unclickable blank row.
  return text || "#".repeat(level);
}

export function extractHeadings(state: EditorState): Heading[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const out: Heading[] = [];
  tree.iterate({
    enter(node) {
      const m = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!m) return undefined;
      const level = Number(m[1]);
      out.push({
        level,
        text: headingText(state.doc.sliceString(node.from, node.to), level),
        from: node.from,
      });
      return false; // the heading's own children are markers and inline marks
    },
  });
  return out;
}

/** The heading whose section contains `pos`; -1 before the first one. */
export function activeHeadingIndex(headings: Heading[], pos: number): number {
  let active = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].from <= pos) active = i;
    else break;
  }
  return active;
}

export class TocPanel {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private rows: HTMLElement[] = [];

  constructor(
    parent: HTMLElement,
    private onPick: (pos: number) => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "toc";
    this.root.hidden = true;
    const header = document.createElement("div");
    header.className = "toc-header";
    header.textContent = "Outline";
    this.list = document.createElement("div");
    this.list.className = "toc-list";
    this.root.append(header, this.list);
    parent.appendChild(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle(): boolean {
    this.root.hidden = !this.root.hidden;
    return this.isOpen;
  }

  render(headings: Heading[], active: number) {
    this.rows = headings.map((h, i) => {
      const row = document.createElement("div");
      row.className = "toc-row";
      row.dataset.level = String(h.level);
      row.textContent = h.text;
      row.title = h.text;
      // Indent by depth, on the row: the outline is a list, not a tree of
      // panels, so there is no wrapper to hang it on.
      row.style.paddingLeft = `${8 + (h.level - 1) * 11}px`;
      if (i === active) row.classList.add("toc-active");
      row.onclick = () => this.onPick(h.from);
      return row;
    });
    this.list.replaceChildren(
      ...(this.rows.length ? this.rows : [hint("No headings yet")]),
    );
  }

  /** Cursor moved: only the highlight changes, so do not rebuild the list. */
  setActive(active: number) {
    this.rows.forEach((row, i) => row.classList.toggle("toc-active", i === active));
  }
}

function hint(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "toc-hint";
  d.textContent = text;
  return d;
}
