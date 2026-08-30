import { describe, it, expect } from "vitest";
import { createEditorState } from "../src/editor/setup";

describe("editor state (headless)", () => {
  it("holds the document byte-for-byte", () => {
    const doc = "# Plan\n\n- [ ] step one\n\n```ts\nconst x = 1;\n```\n";
    expect(createEditorState(doc).doc.toString()).toBe(doc);
  });

  it("round-trips an edit without touching the rest of the file", () => {
    const doc = "# A\n\ntext\n";
    const state = createEditorState(doc);
    const tr = state.update({ changes: { from: 0, to: 3, insert: "# B" } });
    expect(tr.state.doc.toString()).toBe("# B\n\ntext\n");
  });
});
