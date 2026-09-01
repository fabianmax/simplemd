import { describe, it, expect } from "vitest";
import { fromDisk, toDisk } from "../src/fileio";

describe("line-ending round-trip (byte-identity invariant)", () => {
  const roundTrip = (raw: string) => {
    const { text, eol } = fromDisk(raw);
    return toDisk(text, eol);
  };

  it("LF file: identical", () => {
    const raw = "# A\n\ntext\n";
    expect(roundTrip(raw)).toBe(raw);
  });

  it("uniform CRLF file: identical, buffer is LF-only", () => {
    const raw = "# A\r\n\r\ntext\r\n";
    const { text } = fromDisk(raw);
    expect(text).not.toContain("\r");
    expect(roundTrip(raw)).toBe(raw);
  });

  it("mixed endings: passes through untouched", () => {
    const raw = "# A\r\ntext\nmore\r\n";
    expect(roundTrip(raw)).toBe(raw);
  });

  it("no trailing newline: identical", () => {
    expect(roundTrip("no newline at end")).toBe("no newline at end");
  });

  it("empty file: identical", () => {
    expect(roundTrip("")).toBe("");
  });

  it("lone CR characters: untouched", () => {
    const raw = "a\rb\n";
    expect(roundTrip(raw)).toBe(raw);
  });
});
