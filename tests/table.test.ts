/** Rendered table cell -> source offset (#2). */
import { describe, it, expect } from "vitest";
import { splitRow, cellPos } from "../src/editor/live-preview/table";

const SRC = "| name | note |\n| --- | --- |\n| a | first |\n| b | second |";

describe("splitRow", () => {
  it("drops the opening and closing pipes", () => {
    expect(splitRow("| a | b |").map(([f, t]) => "| a | b |".slice(f, t))).toEqual([
      " a ",
      " b ",
    ]);
  });
  it("keeps rows written without outer pipes", () => {
    expect(splitRow("a | b").map(([f, t]) => "a | b".slice(f, t))).toEqual(["a ", " b"]);
  });
  it("keeps empty cells", () => {
    expect(splitRow("| a |  | c |").length).toBe(3);
  });
  it("does not split on an escaped pipe or one inside code", () => {
    expect(splitRow("| a \\| b | `x | y` |").length).toBe(2);
  });
});

describe("cellPos", () => {
  const at = (row: number, col: number) => SRC.slice(cellPos(SRC, 0, row, col));

  it("lands on the header text", () => {
    expect(at(0, 0).startsWith("name")).toBe(true);
    expect(at(0, 1).startsWith("note")).toBe(true);
  });
  it("skips the delimiter row when counting body rows", () => {
    expect(at(1, 0).startsWith("a |")).toBe(true);
    expect(at(2, 1).startsWith("second")).toBe(true);
  });
  it("offsets by the table's document position", () => {
    expect(cellPos(SRC, 100, 1, 0)).toBe(cellPos(SRC, 0, 1, 0) + 100);
  });
  it("clamps coordinates that do not exist", () => {
    expect(cellPos(SRC, 0, 99, 99)).toBeLessThanOrEqual(SRC.length);
    expect(cellPos(SRC, 0, 99, 99)).toBeGreaterThan(0);
  });
});
