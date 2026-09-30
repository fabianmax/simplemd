/** The hover hint's one piece of logic: long URLs are cut in the middle. */
import { describe, it, expect } from "vitest";
import { shortenUrl } from "../src/editor/link-tooltip";

describe("shortenUrl", () => {
  it("leaves a short URL alone", () => {
    expect(shortenUrl("https://example.com/plan.md")).toBe("https://example.com/plan.md");
  });
  it("keeps the host and the file name of a long one", () => {
    const long = "https://example.com/" + "deep/".repeat(20) + "spec.md";
    const short = shortenUrl(long);
    expect(short.length).toBeLessThanOrEqual(64);
    expect(short.startsWith("https://example.com/")).toBe(true);
    expect(short.endsWith("spec.md")).toBe(true);
    expect(short).toContain("…");
  });
});
