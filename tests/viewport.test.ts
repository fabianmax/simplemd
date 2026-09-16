/** Anchoring the viewport to a line across a mode switch (#4). */
import { describe, it, expect } from "vitest";
import { captureAnchor, restoredScrollTop, type Heights } from "../src/viewport";

/** Heights over a list of line heights — the one thing that differs between
 *  rendered and raw. */
function heights(lineHeights: number[], scrollTop: number): Heights {
  const top = (line: number) =>
    lineHeights.slice(0, line - 1).reduce((a, b) => a + b, 0);
  return {
    scrollTop,
    lineAtHeight(h) {
      let line = 1;
      while (line < lineHeights.length && top(line + 1) <= h) line++;
      return line;
    },
    topOfLine: top,
    lines: lineHeights.length,
  };
}

const RENDERED = [20, 20, 90, 20, 20, 20]; // line 3 is a table widget
const RAW = [20, 20, 20, 20, 20, 20]; // …three raw pipe lines' worth shorter

describe("viewport anchor", () => {
  it("keeps the top line at the top when heights change above it", () => {
    const before = heights(RENDERED, 150); // line 5 at the top
    const anchor = captureAnchor(before);
    expect(anchor.line).toBe(5);
    const after = heights(RAW, 150);
    expect(restoredScrollTop(after, anchor)).toBe(80); // line 5's new top
  });

  it("keeps the offset inside a tall block", () => {
    const anchor = captureAnchor(heights(RENDERED, 60)); // 20px into line 3
    expect(anchor).toEqual({ line: 3, offset: 20 });
    expect(restoredScrollTop(heights(RENDERED, 0), anchor)).toBe(60);
  });

  it("clamps to a document that lost lines, and never goes negative", () => {
    const anchor = { line: 99, offset: -500 };
    expect(restoredScrollTop(heights(RAW, 0), anchor)).toBe(0);
  });

  it("is a no-op when nothing about the layout changed", () => {
    const h = heights(RENDERED, 137);
    expect(restoredScrollTop(h, captureAnchor(h))).toBe(137);
  });
});
