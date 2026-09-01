/** Per-LINE source reveal — the one predicate that decides everything.
 *  A line is "revealed" (shows raw markdown) when any selection range
 *  touches it. Per-line, never per-block: stable line heights, no reflow
 *  (see docs/research/spike-results.md). */
import type { EditorState } from "@codemirror/state";

export function revealedLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).number;
    const to = state.doc.lineAt(r.to).number;
    for (let l = from; l <= to; l++) lines.add(l);
  }
  return lines;
}

export function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
