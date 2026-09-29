/** Tab: two spaces, and a level change on a list line (#15). */
import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { createEditorState } from "../src/editor/setup";
import { indentSpec, listMarker, INDENT_UNIT } from "../src/editor/indent";

/** Apply Tab (dir 1) or ⇧Tab (dir -1) with the cursor at `at`, return the doc. */
function press(doc: string, at: number | [number, number], dir: 1 | -1): string {
  const state: EditorState = createEditorState(doc).update({
    selection:
      typeof at === "number"
        ? EditorSelection.cursor(at)
        : EditorSelection.range(at[0], at[1]),
  }).state;
  return state.update(indentSpec(state, dir)).state.doc.toString();
}

const at = (doc: string, needle: string) => doc.indexOf(needle) + needle.length;

describe("list markers", () => {
  it("reads indent and content offset", () => {
    expect(listMarker("- item")).toEqual({ indent: 0, content: 2 });
    expect(listMarker("  - item")).toEqual({ indent: 2, content: 4 });
    expect(listMarker("1. item")).toEqual({ indent: 0, content: 3 });
    expect(listMarker("10. item")).toEqual({ indent: 0, content: 4 });
    expect(listMarker("1) item")).toEqual({ indent: 0, content: 3 });
  });
  it("is not fooled by prose or by a horizontal rule", () => {
    expect(listMarker("just text")).toBeNull();
    expect(listMarker("---")).toBeNull();
    expect(listMarker("-not a list")).toBeNull();
  });
});

describe("Tab on a list", () => {
  it("nests under the bullet above, at its content offset", () => {
    const doc = "- parent\n- child\n";
    expect(press(doc, at(doc, "- child"), 1)).toBe("- parent\n  - child\n");
  });

  it("uses the marker width of an ordered item, so text lines up", () => {
    const doc = "1. parent\n2. child\n";
    expect(press(doc, at(doc, "2. child"), 1)).toBe("1. parent\n   2. child\n");
  });

  it("never renumbers — that would be a re-serialization", () => {
    const doc = "1. one\n2. two\n3. three\n";
    expect(press(doc, at(doc, "3. three"), 1)).toBe("1. one\n2. two\n   3. three\n");
  });

  it("falls back to one unit for the first item of a list", () => {
    const doc = "text\n\n- only\n";
    expect(press(doc, at(doc, "- only"), 1)).toBe("text\n\n  - only\n");
  });

  it("does not nest twice under the same parent", () => {
    const doc = "- parent\n  - child\n";
    // already nested under "- parent", no sibling at this level above it
    expect(press(doc, at(doc, "  - child"), 1)).toBe("- parent\n    - child\n");
  });

  it("⇧Tab returns the item to its parent's level", () => {
    const doc = "- parent\n  - child\n";
    expect(press(doc, at(doc, "  - child"), -1)).toBe("- parent\n- child\n");
  });

  it("⇧Tab on a top-level item leaves it alone", () => {
    const doc = "- one\n- two\n";
    expect(press(doc, at(doc, "- two"), -1)).toBe(doc);
  });
});

describe("Tab elsewhere", () => {
  it("inserts the unit at the cursor", () => {
    const doc = "some text\n";
    expect(press(doc, 4, 1)).toBe("some" + INDENT_UNIT + " text\n");
  });

  it("shifts every line of a multi-line selection", () => {
    const doc = "one\ntwo\nthree\n";
    expect(press(doc, [0, 8], 1)).toBe("  one\n  two\nthree\n");
  });

  it("⇧Tab takes one unit off, never past the margin", () => {
    const doc = "    one\n  two\nthree\n";
    expect(press(doc, [0, 12], -1)).toBe("  one\ntwo\nthree\n");
  });

  it("leaves blank lines alone when outdenting", () => {
    const doc = "  one\n\n  two\n";
    expect(press(doc, [0, 10], -1)).toBe("one\n\ntwo\n");
  });
});
