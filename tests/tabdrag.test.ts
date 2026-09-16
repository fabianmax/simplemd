import { describe, it, expect } from "vitest";
import {
  reorder,
  activeAfterMove,
  dropIndex,
  shouldTearOff,
  isDrag,
  moveTarget,
  TEAR_OFF_DEPTH,
} from "../src/tabdrag";

describe("reorder", () => {
  const list = ["a", "b", "c", "d"];
  it("moves an item right and left", () => {
    expect(reorder(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reorder(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("is a no-op onto itself, and leaves the input alone", () => {
    expect(reorder(list, 1, 1)).toEqual(list);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores out-of-range indices instead of corrupting the list", () => {
    expect(reorder(list, -1, 2)).toEqual(list);
    expect(reorder(list, 1, 9)).toEqual(list);
  });
});

describe("activeAfterMove", () => {
  // The invariant: whatever tab was active is still active afterwards.
  const check = (list: string[], active: number, from: number, to: number) => {
    const was = list[active];
    const now = reorder(list, from, to);
    return { tab: now[activeAfterMove(active, from, to)], was };
  };
  const list = ["a", "b", "c", "d"];

  it("follows the dragged tab when it is the active one", () => {
    expect(activeAfterMove(1, 1, 3)).toBe(3);
    expect(activeAfterMove(2, 2, 0)).toBe(0);
  });

  it("keeps the same tab active for every possible move", () => {
    for (let active = 0; active < list.length; active++) {
      for (let from = 0; from < list.length; from++) {
        for (let to = 0; to < list.length; to++) {
          const { tab, was } = check(list, active, from, to);
          expect(tab, `active=${active} from=${from} to=${to}`).toBe(was);
        }
      }
    }
  });
});

describe("dropIndex", () => {
  // three tabs of width 100, so midpoints at 50 / 150 / 250
  const mids = [50, 150, 250];
  it("maps a position to the gap it is over", () => {
    expect(dropIndex(mids, 10)).toBe(0);
    expect(dropIndex(mids, 60)).toBe(1);
    expect(dropIndex(mids, 160)).toBe(2);
    expect(dropIndex(mids, 400)).toBe(3);
  });
  it("puts anything in an empty strip first", () => {
    expect(dropIndex([], 123)).toBe(0);
  });
});

describe("moveTarget", () => {
  it("accounts for the dragged tab's own slot when it moves right", () => {
    // [a b c d], dragging a (0) into the gap after c (gap 3) lands it at 2
    expect(moveTarget(0, 3)).toBe(2);
    expect(moveTarget(0, 1)).toBe(0); // the gap it already occupies
  });
  it("leaves leftward moves alone", () => {
    expect(moveTarget(3, 1)).toBe(1);
    expect(moveTarget(2, 0)).toBe(0);
  });
});

describe("shouldTearOff", () => {
  const geo = { stripBottom: 30, viewport: { width: 1000, height: 800 } };

  it("does not fire for a drop on the strip or just under it", () => {
    expect(shouldTearOff({ x: 400, y: 20 }, geo)).toBe(false);
    expect(shouldTearOff({ x: 400, y: 30 + TEAR_OFF_DEPTH }, geo)).toBe(false);
  });
  it("fires once the drop is deep in the document area", () => {
    expect(shouldTearOff({ x: 400, y: 30 + TEAR_OFF_DEPTH + 1 }, geo)).toBe(true);
  });
  it("fires past any window edge — a full-screen window has no outside", () => {
    expect(shouldTearOff({ x: -5, y: 20 }, geo)).toBe(true);
    expect(shouldTearOff({ x: 1200, y: 20 }, geo)).toBe(true);
    expect(shouldTearOff({ x: 400, y: -5 }, geo)).toBe(true);
    expect(shouldTearOff({ x: 400, y: 900 }, geo)).toBe(true);
  });
});

describe("isDrag", () => {
  it("lets a twitch stay a click so tabs still switch", () => {
    expect(isDrag({ x: 100, y: 10 }, { x: 103, y: 12 })).toBe(false);
  });
  it("becomes a drag past the threshold, in either axis", () => {
    expect(isDrag({ x: 100, y: 10 }, { x: 110, y: 10 })).toBe(true);
    expect(isDrag({ x: 100, y: 10 }, { x: 100, y: 30 })).toBe(true);
  });
});
