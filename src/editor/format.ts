/** Formatting commands as pure state->spec functions (headless-testable).
 *  All of them edit SOURCE text — the live preview just re-decorates.
 *  Thin dispatch wrappers at the bottom are what menu events call. */
import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Toggle an inline marker pair (** * ~~ `) around each selection range. */
export function toggleInlineSpec(state: EditorState, marker: string): TransactionSpec {
  const m = marker.length;
  return state.changeByRange((range) => {
    // Markdown emphasis cannot wrap leading/trailing whitespace or newlines —
    // shrink the range to its content first.
    let { from, to } = range;
    while (from < to && /\s/.test(state.doc.sliceString(from, from + 1))) from++;
    while (to > from && /\s/.test(state.doc.sliceString(to - 1, to))) to--;
    const before = state.doc.sliceString(Math.max(0, from - m), from);
    const after = state.doc.sliceString(to, to + m);
    if (before === marker && after === marker) {
      // unwrap surrounding markers
      return {
        changes: [
          { from: from - m, to: from },
          { from: to, to: to + m },
        ],
        range: EditorSelection.range(from - m, to - m),
      };
    }
    const inner = state.doc.sliceString(from, to);
    if (inner.startsWith(marker) && inner.endsWith(marker) && inner.length >= 2 * m) {
      // markers inside the selection
      return {
        changes: [
          { from, to: from + m },
          { from: to - m, to },
        ],
        range: EditorSelection.range(from, to - 2 * m),
      };
    }
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + m, to + m),
    };
  });
}

/** Set (or clear, level=0) the ATX heading level of every selected line. */
export function setHeadingSpec(state: EditorState, level: number): TransactionSpec {
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let ln = a; ln <= b; ln++) {
      if (seen.has(ln)) continue;
      seen.add(ln);
      const line = state.doc.line(ln);
      if (line.text.trim() === "") continue; // never head an empty line
      const current = /^#{1,6} /.exec(line.text)?.[0] ?? "";
      const next = level > 0 ? "#".repeat(level) + " " : "";
      if (current !== next) {
        changes.push({ from: line.from, to: line.from + current.length, insert: next });
      }
    }
  }
  return { changes };
}

/** Toggle a line prefix across selected lines: if EVERY selected line already
 *  has it, strip it; otherwise add it where missing. */
export function toggleLinePrefixSpec(
  state: EditorState,
  prefix: string,
  detect: RegExp,
): TransactionSpec {
  const lines: { from: number; text: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let ln = a; ln <= b; ln++) {
      if (!seen.has(ln)) {
        seen.add(ln);
        const l = state.doc.line(ln);
        lines.push({ from: l.from, text: l.text });
      }
    }
  }
  const all = lines.every((l) => detect.test(l.text));
  const changes = lines.flatMap((l) => {
    const match = detect.exec(l.text);
    if (all && match) return [{ from: l.from, to: l.from + match[0].length, insert: "" }];
    if (!all && !match) return [{ from: l.from, insert: prefix }];
    return [];
  });
  return { changes };
}

export const toggleTaskListSpec = (s: EditorState) =>
  toggleLinePrefixSpec(s, "- [ ] ", /^- \[[ xX]\] /);
export const toggleBulletListSpec = (s: EditorState) =>
  toggleLinePrefixSpec(s, "- ", /^- (?!\[[ xX]\] )/);

/** Wrap selection as a link; select the URL placeholder for immediate typing. */
export function insertLinkSpec(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to) || "text";
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3; // [text](
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
}

/** Wrap the selected lines in a fence, or insert an empty one. */
export function insertCodeFenceSpec(state: EditorState): TransactionSpec {
  const r = state.selection.main;
  if (r.empty) {
    const insert = "```\n\n```";
    return {
      changes: { from: r.from, insert },
      selection: EditorSelection.cursor(r.from + 4),
    };
  }
  const first = state.doc.lineAt(r.from);
  const last = state.doc.lineAt(r.to);
  return {
    changes: [
      { from: first.from, insert: "```\n" },
      { from: last.to, insert: "\n```" },
    ],
  };
}

export function insertTableSpec(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const insert = `${line.length ? "\n\n" : ""}| column | column |\n| ------ | ------ |\n|        |        |\n`;
  return {
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.indexOf("column")),
  };
}

// --- dispatch wrappers (what menu events call) ---------------------------------

const run = (view: EditorView, spec: TransactionSpec) => {
  view.dispatch(spec);
  view.focus();
};

export const formatCommands: Record<string, (view: EditorView) => void> = {
  "fmt:bold": (v) => run(v, toggleInlineSpec(v.state, "**")),
  "fmt:italic": (v) => run(v, toggleInlineSpec(v.state, "*")),
  "fmt:strike": (v) => run(v, toggleInlineSpec(v.state, "~~")),
  "fmt:code": (v) => run(v, toggleInlineSpec(v.state, "`")),
  "fmt:link": (v) => run(v, insertLinkSpec(v.state)),
  "fmt:fence": (v) => run(v, insertCodeFenceSpec(v.state)),
  "fmt:task": (v) => run(v, toggleTaskListSpec(v.state)),
  "fmt:list": (v) => run(v, toggleBulletListSpec(v.state)),
  "fmt:table": (v) => run(v, insertTableSpec(v.state)),
  "fmt:h0": (v) => run(v, setHeadingSpec(v.state, 0)),
  "fmt:h1": (v) => run(v, setHeadingSpec(v.state, 1)),
  "fmt:h2": (v) => run(v, setHeadingSpec(v.state, 2)),
  "fmt:h3": (v) => run(v, setHeadingSpec(v.state, 3)),
  "fmt:h4": (v) => run(v, setHeadingSpec(v.state, 4)),
  "fmt:h5": (v) => run(v, setHeadingSpec(v.state, 5)),
  "fmt:h6": (v) => run(v, setHeadingSpec(v.state, 6)),
};
