/** Holding the viewport still across a reconfiguration (#4).
 *
 *  ⌘E swaps the live-preview extensions, which changes line heights — a table
 *  widget collapses to raw pipe lines, hidden markers come back. Keeping the
 *  pixel scroll offset therefore moves the text: the further into the file, the
 *  further it jumps. Anchor on a LINE instead, and keep the offset inside that
 *  line so tall blocks do not snap.
 *
 *  Pure over a tiny slice of EditorView so it is headless-testable. */

export interface ViewportAnchor {
  /** 1-based line at the top of the viewport. */
  line: number;
  /** Pixels of that line's block already scrolled past. */
  offset: number;
}

export interface Heights {
  scrollTop: number;
  /** Line number of the block covering the given height. */
  lineAtHeight(height: number): number;
  /** Top of the given line's block, same coordinate space as scrollTop. */
  topOfLine(line: number): number;
  lines: number;
}

export function captureAnchor(h: Heights): ViewportAnchor {
  const line = h.lineAtHeight(h.scrollTop);
  return { line, offset: h.scrollTop - h.topOfLine(line) };
}

/** Scroll offset that puts `anchor` back where it was. Never negative, and
 *  clamped to a document that may meanwhile have fewer lines. */
export function restoredScrollTop(h: Heights, anchor: ViewportAnchor): number {
  const line = Math.max(1, Math.min(anchor.line, h.lines));
  return Math.max(0, h.topOfLine(line) + anchor.offset);
}
