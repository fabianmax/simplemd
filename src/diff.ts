/** "Since I last looked" diff — pure logic (headless-testable).
 *
 *  Word-level, never line-level: agents reflow paragraphs, and a line diff
 *  of reflowed prose reads as everything-deleted-everything-readded
 *  (docs/research/2026-08-30-findings.md). Positions are offsets into the
 *  CURRENT text; nothing is ever written into the document.
 */
import { diffWordsWithSpace } from "diff";

export interface DiffResult {
  /** inserted/changed spans in the current text */
  added: { from: number; to: number }[];
  /** deletion points in the current text, with the removed words */
  removed: { pos: number; text: string }[];
  /** offset of the first change in the current text, if any */
  firstChange: number | null;
}

/** Guard: above this size, skip word diffing (O(n²) worst case) and fall back
 *  to first-differing-line only. */
export const WORD_DIFF_LIMIT = 1_000_000;

export function computeDiff(baseline: string, current: string): DiffResult {
  if (baseline === current) return { added: [], removed: [], firstChange: null };
  if (baseline.length > WORD_DIFF_LIMIT || current.length > WORD_DIFF_LIMIT) {
    return { added: [], removed: [], firstChange: firstDifference(baseline, current) };
  }
  const parts = diffWordsWithSpace(baseline, current);
  const added: { from: number; to: number }[] = [];
  const removed: { pos: number; text: string }[] = [];
  let pos = 0;
  for (const part of parts) {
    if (part.added) {
      const from = pos;
      pos += part.value.length;
      // coalesce with an adjacent previous run
      const last = added[added.length - 1];
      if (last && last.to === from) last.to = pos;
      else added.push({ from, to: pos });
    } else if (part.removed) {
      const last = removed[removed.length - 1];
      if (last && last.pos === pos) last.text += part.value;
      else removed.push({ pos, text: part.value });
    } else {
      pos += part.value.length;
    }
  }
  // A removal immediately followed by an addition is a replacement — the
  // added highlight already marks it; drop the redundant deletion caret.
  const filtered = removed.filter(
    (r) => !added.some((a) => a.from === r.pos),
  );
  const firsts = [
    ...added.map((a) => a.from),
    ...filtered.map((r) => r.pos),
    ...removed.filter((r) => !filtered.includes(r)).map((r) => r.pos),
  ];
  return {
    added,
    removed: filtered,
    firstChange: firsts.length ? Math.min(...firsts) : firstDifference(baseline, current),
  };
}

export function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a === b ? 0 : n;
}

export function changeCount(d: DiffResult): number {
  return d.added.length + d.removed.length;
}

/** All change anchors in document order — the ↑/↓ navigation stops. */
export function changeAnchors(d: DiffResult): number[] {
  return [...d.added.map((a) => a.from), ...d.removed.map((r) => r.pos)].sort((x, y) => x - y);
}
