/** Tab dragging: reorder within the strip, tear off out of it.
 *
 *  All of the decisions live here as pure functions so they can be tested
 *  without a window — the DOM half in app.ts only measures and dispatches. */

/** Move one item. `to` is the index the item ends up at, after removal. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** The active tab must stay the SAME TAB, not the same index — the quiet bug
 *  in every reorder implementation. */
export function activeAfterMove(active: number, from: number, to: number): number {
  if (active === from) return to;
  // dragging out of the way shifts everything between the two positions
  if (from < active && to >= active) return active - 1;
  if (from > active && to <= active) return active + 1;
  return active;
}

/** Which gap the pointer is over, given each tab's horizontal midpoint. */
export function dropIndex(midpoints: readonly number[], x: number): number {
  let index = 0;
  for (const mid of midpoints) {
    if (x > mid) index++;
    else break;
  }
  return index;
}

/** A gap index from `dropIndex` is a position among n+1 gaps; the index the
 *  dragged tab lands on is one less when it moved rightwards past itself. */
export function moveTarget(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

export interface Point {
  x: number;
  y: number;
}
export interface TearOffGeometry {
  /** Bottom edge of the tab strip, in client coordinates. */
  stripBottom: number;
  viewport: { width: number; height: number };
}

/** How far below the strip a drop has to land to count as "out", when it is
 *  still inside the window. Deep enough that a sloppy drop onto the strip's own
 *  row never tears a tab off by accident. */
export const TEAR_OFF_DEPTH = 80;

export function shouldTearOff(p: Point, geo: TearOffGeometry): boolean {
  const outsideWindow =
    p.x < 0 || p.y < 0 || p.x > geo.viewport.width || p.y > geo.viewport.height;
  // Full-screen windows have no "outside", so depth has to work on its own.
  return outsideWindow || p.y > geo.stripBottom + TEAR_OFF_DEPTH;
}

/** Past this many pixels a press becomes a drag; below it, it is still a click
 *  that switches tabs. Same threshold the link handler uses. */
export const DRAG_THRESHOLD = 4;

export function isDrag(start: Point, now: Point): boolean {
  return Math.abs(now.x - start.x) > DRAG_THRESHOLD || Math.abs(now.y - start.y) > DRAG_THRESHOLD;
}
