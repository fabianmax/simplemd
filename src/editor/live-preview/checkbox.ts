/** Task-list checkbox toggling. The change is same-length ([ ] <-> [x]), so
 *  every selection maps through unchanged — this is the regression guard
 *  against the documented Obsidian cursor-jump bug. */
import type { EditorState, TransactionSpec } from "@codemirror/state";

export function toggleTaskSpec(
  state: EditorState,
  markerFrom: number,
  markerTo: number,
): TransactionSpec | null {
  const marker = state.doc.sliceString(markerFrom, markerTo);
  if (!/^\[[ xX]\]$/.test(marker)) return null;
  const next = marker === "[ ]" ? "[x]" : "[ ]";
  return { changes: { from: markerFrom, to: markerTo, insert: next } };
}
