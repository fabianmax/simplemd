import { describe, it, expect } from "vitest";
import { classifyChange, nearestHeadingAbove } from "../src/sync";

describe("classifyChange (echo suppression + conflict detection)", () => {
  it("ignores the echo of our own save", () => {
    expect(classifyChange("abc", "abc", false)).toBe("ignore");
    expect(classifyChange("abc", "abc", true)).toBe("ignore");
  });
  it("reloads silently when buffer is clean", () => {
    expect(classifyChange("new", "old", false)).toBe("reload");
  });
  it("conflicts when buffer is dirty", () => {
    expect(classifyChange("new", "old", true)).toBe("conflict");
  });
  it("reloads when no file hash is known yet", () => {
    expect(classifyChange("new", null, false)).toBe("reload");
  });
});

describe("nearestHeadingAbove", () => {
  const doc = ["# Top", "text", "## Section", "more", "even more"];
  const at = (n: number) => doc[n - 1];
  it("finds the heading at the line itself", () => {
    expect(nearestHeadingAbove(at, 3)).toEqual({ line: 3, text: "## Section" });
  });
  it("walks upward past prose", () => {
    expect(nearestHeadingAbove(at, 5)).toEqual({ line: 3, text: "## Section" });
  });
  it("null when no heading above", () => {
    expect(nearestHeadingAbove((n) => ["a", "b"][n - 1], 2)).toBeNull();
  });
});
