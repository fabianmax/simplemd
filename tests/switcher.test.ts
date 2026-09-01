import { describe, it, expect } from "vitest";
import { fuzzyScore, rankItems } from "../src/switcher";

describe("fuzzyScore", () => {
  it("matches subsequences", () => {
    expect(fuzzyScore("pln", "plan.md")).not.toBeNull();
    expect(fuzzyScore("xyz", "plan.md")).toBeNull();
  });
  it("prefers contiguous and prefix matches", () => {
    expect(fuzzyScore("plan", "plan.md")!).toBeGreaterThan(fuzzyScore("plan", "p-l-a-n.md")!);
    expect(fuzzyScore("pl", "plan.md")!).toBeGreaterThan(fuzzyScore("pl", "apl.md")!);
  });
  it("empty query matches everything", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("rankItems", () => {
  const items = [
    { path: "/a/review.md", tabIndex: -1 },
    { path: "/b/plan.md", tabIndex: 0 },
    { path: "/c/planning-notes.md", tabIndex: -1 },
  ];
  it("open tabs rank above recents on equal match", () => {
    const r = rankItems(items, "plan");
    expect(r[0].path).toBe("/b/plan.md");
  });
  it("filters non-matches", () => {
    expect(rankItems(items, "review").length).toBe(1);
  });
  it("matches against full path as fallback", () => {
    expect(rankItems(items, "/c/").length).toBe(1);
  });
});
