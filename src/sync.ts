/** Pure decision logic for external file-change events (headless-testable). */

export type ChangeAction = "ignore" | "reload" | "conflict";

/**
 * Classify a watcher event.
 * - `ignore`: the event is the echo of our own save (hash matches what we
 *   last wrote/read) — the self-echo suppression from the v1 plan.
 * - `reload`: disk changed, buffer is clean — reload silently.
 * - `conflict`: disk changed under unsaved edits — surface, never clobber.
 */
export function classifyChange(
  eventHash: string,
  diskHash: string | null,
  dirty: boolean,
): ChangeAction {
  if (eventHash === diskHash) return "ignore";
  return dirty ? "conflict" : "reload";
}

/** Nearest heading at or above `lineNumber` (1-based); null if none. */
export function nearestHeadingAbove(
  lineTextAt: (n: number) => string,
  lineNumber: number,
): { line: number; text: string } | null {
  for (let ln = lineNumber; ln >= 1; ln--) {
    const t = lineTextAt(ln);
    if (/^#{1,6} /.test(t)) return { line: ln, text: t };
  }
  return null;
}
