/** Tab (#15). Pure state -> spec, like everything in format.ts.
 *
 *  Two spaces, never a tab character: CommonMark advances a hard tab to the
 *  next four-column stop and renderers disagree about the rest, while spaces
 *  mean exactly what they look like. Two is also the width of "- ", so an
 *  indented bullet lines up under its parent's text.
 *
 *  On a list line Tab is a LEVEL change rather than a blind indent — the item
 *  is re-indented to the content offset of the item above it at the same level,
 *  which is what CommonMark requires for it to nest instead of starting a new
 *  list. Numbers are never rewritten: renumbering is a re-serialization, and
 *  this project does not do those. */
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export const INDENT_UNIT = "  ";

export interface ListMarker {
  /** columns of leading whitespace */
  indent: number;
  /** where the item's text starts, i.e. the indent a child needs */
  content: number;
}

/** The list marker of a line, or null when the line is not a list item. */
export function listMarker(text: string): ListMarker | null {
  const m = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(?=\S|$)/.exec(text);
  if (!m) return null;
  return {
    indent: m[1].length,
    content: m[1].length + m[2].length + m[3].length,
  };
}

const leadingWhitespace = (text: string) => /^[ \t]*/.exec(text)![0].length;

/** Indent a list line one level: to the content offset of the nearest item
 *  above it at the same level. Without such a sibling the item cannot legally
 *  nest — it is the first of its list — so it falls back to one unit, which
 *  keeps Tab from feeling broken and still produces valid markdown. */
function listIndent(lineAt: (n: number) => string, line: number, marker: ListMarker): number {
  for (let n = line - 1; n >= 1; n--) {
    const text = lineAt(n);
    if (text.trim() === "") continue;
    const above = listMarker(text);
    if (!above) break;
    if (above.indent === marker.indent) return above.content;
    if (above.indent < marker.indent) break; // already nested under this one
  }
  return marker.indent + INDENT_UNIT.length;
}

/** Outdent a list line: back to the indent of the item that encloses it, or one
 *  unit out when nothing encloses it. */
function listOutdent(lineAt: (n: number) => string, line: number, marker: ListMarker): number {
  for (let n = line - 1; n >= 1; n--) {
    const text = lineAt(n);
    if (text.trim() === "") continue;
    const above = listMarker(text);
    if (!above) break;
    if (above.indent < marker.indent) return above.indent;
  }
  return Math.max(0, marker.indent - INDENT_UNIT.length);
}

/** Replace the leading whitespace of `line` with `width` spaces. */
function reindent(
  state: EditorState,
  lineNumber: number,
  width: number,
): { from: number; to: number; insert: string } {
  const line = state.doc.line(lineNumber);
  return {
    from: line.from,
    to: line.from + leadingWhitespace(line.text),
    insert: " ".repeat(width),
  };
}

/** Tab (dir 1) and ⇧Tab (dir -1). */
export function indentSpec(state: EditorState, dir: 1 | -1): TransactionSpec {
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  // A selection that ends exactly at the start of a line does not include it:
  // dragging down to the next line's start selects the lines above it, and
  // indenting one more than was highlighted reads as a bug.
  const end = state.doc.lineAt(range.to);
  const last =
    end.from === range.to && range.to > range.from ? state.doc.lineAt(range.to - 1) : end;
  const lineAt = (n: number) => state.doc.line(n).text;

  // One line, and it is a list item: change its level.
  if (first.number === last.number) {
    const marker = listMarker(first.text);
    if (marker) {
      const width =
        dir === 1
          ? listIndent(lineAt, first.number, marker)
          : listOutdent(lineAt, first.number, marker);
      if (width === marker.indent) return {};
      const change = reindent(state, first.number, width);
      const shift = width - marker.indent;
      return {
        changes: change,
        selection: EditorSelection.cursor(Math.max(change.from, range.head + shift)),
        scrollIntoView: true,
        userEvent: dir === 1 ? "input.indent" : "delete.dedent",
      };
    }
    // Plain cursor on an ordinary line: Tab inserts the unit where the cursor
    // is, exactly like any other editor.
    if (range.empty && dir === 1) {
      return {
        changes: { from: range.from, insert: INDENT_UNIT },
        selection: EditorSelection.cursor(range.from + INDENT_UNIT.length),
        scrollIntoView: true,
        userEvent: "input.indent",
      };
    }
  }

  // Everything else — a multi-line selection, or ⇧Tab on an ordinary line —
  // shifts whole lines, the way every editor does it.
  const changes = [];
  for (let n = first.number; n <= last.number; n++) {
    const text = state.doc.line(n).text;
    if (dir === -1 && text.trim() === "") continue; // nothing to take off
    const width = leadingWhitespace(text);
    const next =
      dir === 1 ? width + INDENT_UNIT.length : Math.max(0, width - INDENT_UNIT.length);
    if (next !== width) changes.push(reindent(state, n, next));
  }
  if (!changes.length) return {};
  return {
    changes,
    scrollIntoView: true,
    userEvent: dir === 1 ? "input.indent" : "delete.dedent",
  };
}
