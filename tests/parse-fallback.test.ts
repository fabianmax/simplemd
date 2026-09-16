/** A syntax-tree miss must not blank the document: buildDecorations falls back
 *  to the partial tree the background parse has produced so far. ensureSyntaxTree
 *  is stubbed to miss, which is what an exhausted budget looks like. */
import { describe, it, expect, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";

vi.mock("@codemirror/language", async (orig) => ({
  ...(await orig<typeof import("@codemirror/language")>()),
  ensureSyntaxTree: () => null,
}));

import { createEditorState } from "../src/editor/setup";
import { buildDecorations } from "../src/editor/live-preview/decorations";

const DOC = "# Head\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail\n";

describe("syntax tree miss", () => {
  it("still decorates what is parsed", () => {
    const state = createEditorState(DOC).update({
      selection: EditorSelection.cursor(DOC.length - 1),
    }).state;
    expect(buildDecorations(state).size).toBeGreaterThan(0);
  });
});
