import { describe, it, expect } from "vitest";
import { docStats, formatStats } from "../src/stats";

describe("docStats", () => {
  it("counts words and estimates tokens at ~4 chars each", () => {
    const s = docStats("one two three");
    expect(s.words).toBe(3);
    expect(s.tokens).toBe(Math.ceil(13 / 4));
  });
  it("empty doc is zero", () => {
    expect(docStats("")).toEqual({ words: 0, tokens: 0 });
  });
  it("formats with separators", () => {
    expect(formatStats({ words: 1234, tokens: 56789 })).toBe("1,234 words · ~56,789 tokens");
  });
});
