import { describe, it, expect } from "vitest";
import { computeDiff, changeAnchors, changeCount, WORD_DIFF_LIMIT } from "../src/diff";

describe("computeDiff — word level", () => {
  it("marks only the changed words in reflowed prose (THE case)", () => {
    const base = "The watcher must handle rename-based writes without flicker.";
    const cur = "The watcher must handle rename-based atomic writes without any flicker.";
    const d = computeDiff(base, cur);
    const addedText = d.added.map((a) => cur.slice(a.from, a.to)).join("|");
    expect(addedText).toContain("atomic");
    expect(addedText).toContain("any");
    expect(addedText).not.toContain("watcher"); // unchanged words unmarked
    expect(d.addedWords).toBe(2);
  });

  it("word counts feed the +N / −M pill", () => {
    const d = computeDiff("alpha beta gamma", "alpha delta");
    expect(d.addedWords).toBeGreaterThan(0);
    expect(d.removedWords).toBeGreaterThan(0);
  });

  it("reports pure deletions with position and text", () => {
    const base = "keep this obsolete part and this";
    const cur = "keep this part and this";
    const d = computeDiff(base, cur);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].text.trim()).toBe("obsolete");
    expect(cur.slice(d.removed[0].pos)).toMatch(/^part/);
  });

  it("replacement produces added mark, no redundant deletion caret", () => {
    const d = computeDiff("status: open", "status: done");
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(0);
  });

  it("identical inputs -> empty diff, null firstChange", () => {
    const d = computeDiff("same", "same");
    expect(changeCount(d)).toBe(0);
    expect(d.firstChange).toBeNull();
  });

  it("firstChange is the earliest anchor", () => {
    const base = "aaa bbb ccc";
    const cur = "aaa XXX ccc YYY";
    const d = computeDiff(base, cur);
    expect(d.firstChange).toBe(4);
    expect(changeAnchors(d)[0]).toBe(4);
  });

  it("size guard: over-limit falls back to first difference only", () => {
    const base = "x".repeat(WORD_DIFF_LIMIT + 1);
    const cur = base.slice(0, 500) + "Y" + base.slice(501);
    const d = computeDiff(base, cur);
    expect(d.added).toHaveLength(0);
    expect(d.firstChange).toBe(500);
  });

  it("multiline agent rewrite: anchors are in document order", () => {
    const base = "# plan\n\nstep one is simple\n\nstep two is hard\n";
    const cur = "# plan\n\nstep one is trivial\n\nstep two is very hard\n";
    const d = computeDiff(base, cur);
    const anchors = changeAnchors(d);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    expect([...anchors].sort((a, b) => a - b)).toEqual(anchors);
  });
});
