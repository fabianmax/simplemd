import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EditorSelection, EditorState } from "@codemirror/state";
import { createEditorState } from "../src/editor/setup";
import { revealedLines } from "../src/editor/live-preview/reveal";
import { buildDecorations } from "../src/editor/live-preview/decorations";
import { toggleTaskSpec } from "../src/editor/live-preview/checkbox";

const sink = readFileSync(new URL("./fixtures/kitchen-sink.md", import.meta.url), "utf8");

const stateAt = (doc: string, anchor = 0) =>
  createEditorState(doc, [], { preview: true }).update({
    selection: EditorSelection.cursor(anchor),
  }).state;

/** Collect decoration class names / widget types between from..to. */
function decosIn(state: EditorState, from: number, to: number) {
  const found: string[] = [];
  buildDecorations(state).between(from, to, (_f, _t, deco) => {
    const spec = deco.spec;
    found.push(spec.class ?? spec.widget?.constructor?.name ?? "replace");
  });
  return found;
}

describe("reveal predicate", () => {
  it("reveals exactly the cursor line", () => {
    const s = stateAt("# a\ntext\n# b", 5); // cursor on line 2
    expect([...revealedLines(s)]).toEqual([2]);
  });
  it("reveals every line a selection spans", () => {
    const s = createEditorState("a\nb\nc\nd", [], {}).update({
      selection: EditorSelection.single(0, 6),
    }).state;
    expect([...revealedLines(s)].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("decorations", () => {
  it("hides heading marker when cursor is elsewhere", () => {
    const s = stateAt("# Head\n\ntext", 10);
    expect(decosIn(s, 0, 2)).toContain("lp-hidden");
  });
  it("shows heading marker when cursor is on the line", () => {
    const s = stateAt("# Head\n\ntext", 2);
    expect(decosIn(s, 0, 2)).not.toContain("lp-hidden");
  });
  it("replaces an untouched table with a widget", () => {
    const doc = "text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const s = stateAt(doc, 0);
    expect(decosIn(s, 6, doc.length)).toContain("TableWidget");
  });
  it("reveals table source when cursor is inside it", () => {
    const doc = "text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const s = stateAt(doc, 8); // inside table
    expect(decosIn(s, 6, doc.length)).not.toContain("TableWidget");
  });
  it("task markers become checkbox widgets", () => {
    const doc = "- [ ] task\n\nelsewhere";
    const s = stateAt(doc, doc.length - 1);
    expect(decosIn(s, 0, 10)).toContain("CheckboxWidget");
  });
  it("fence lines get constant styling regardless of cursor", () => {
    const doc = "```ts\nconst x = 1;\n```\n";
    const away = stateAt(doc + "\ntext", doc.length + 3);
    const inside = stateAt(doc + "\ntext", 8);
    for (const s of [away, inside]) {
      const classes = decosIn(s, 0, doc.length);
      expect(classes).toContain("lp-code-line");
      expect(classes).toContain("lp-fence-line");
    }
  });
  it("hides inline-code marks but never fence marks via lp-hidden", () => {
    const doc = "`x`\n\n```\ny\n```\n\ncursor here";
    const s = stateAt(doc, doc.length - 1);
    expect(decosIn(s, 0, 3)).toContain("lp-hidden");
    expect(decosIn(s, 5, 14)).not.toContain("lp-hidden");
  });
  it("chips inline code whether or not the line is revealed", () => {
    const doc = "a `x` b\nplain";
    // cursor off the line: markers hidden, chip present
    const away = stateAt(doc, doc.length - 1);
    expect(decosIn(away, 2, 5)).toContain("lp-inline-code");
    expect(decosIn(away, 2, 5)).toContain("lp-hidden");
    // cursor on the line: backticks come back, chip must NOT blink off
    const on = stateAt(doc, 0);
    expect(decosIn(on, 2, 5)).toContain("lp-inline-code");
    expect(decosIn(on, 2, 5)).not.toContain("lp-hidden");
  });
  it("does not chip fenced code (same lezer tag, different treatment)", () => {
    const doc = "```\ny\n```\n\ncursor";
    const s = stateAt(doc, doc.length - 1);
    expect(decosIn(s, 0, 10)).not.toContain("lp-inline-code");
  });
});

describe("checkbox toggle (Obsidian cursor-jump regression guard)", () => {
  it("toggles [ ] -> [x] and back, same length", () => {
    const s = stateAt("- [ ] task", 9);
    const spec = toggleTaskSpec(s, 2, 5)!;
    const next = s.update(spec).state;
    expect(next.doc.toString()).toBe("- [x] task");
    const spec2 = toggleTaskSpec(next, 2, 5)!;
    expect(next.update(spec2).state.doc.toString()).toBe("- [ ] task");
  });
  it("preserves the selection exactly", () => {
    const s = stateAt("- [ ] task with cursor later", 20);
    const next = s.update(toggleTaskSpec(s, 2, 5)!).state;
    expect(next.selection.main.head).toBe(20);
  });
  it("refuses to toggle non-marker text", () => {
    const s = stateAt("- [ ] task", 0);
    expect(toggleTaskSpec(s, 0, 3)).toBeNull();
  });
});

describe("byte-identity invariant (THE standing test)", () => {
  const cases: Record<string, string> = {
    "kitchen sink fixture": sink,
    "no trailing newline": "# x\ntext",
    "unicode + emoji": "# ünïcødé 🎯\n\n- [ ] tâsk\n",
    "windows-style content (pre-normalized)": "# a\n\nb\n",
    "reference links": "[a][1]\n\n[1]: https://e.com\n",
    "deeply nested": "> - [ ] **`x`** *[l](https://e.com)*\n",
  };
  for (const [name, doc] of Object.entries(cases)) {
    it(`${name}: decorated state returns source byte-for-byte`, () => {
      const s = createEditorState(doc, [], { preview: true });
      buildDecorations(s); // force the full decoration pass
      expect(s.doc.toString()).toBe(doc);
    });
  }

  it("survives an edit cycle with decorations active", () => {
    const s = createEditorState(sink, [], { preview: true });
    const mid = Math.floor(sink.length / 2);
    const edited = s.update({ changes: { from: mid, insert: "XYZ" } }).state;
    buildDecorations(edited);
    const undone = edited.update({ changes: { from: mid, to: mid + 3 } }).state;
    expect(undone.doc.toString()).toBe(sink);
  });
});

describe("linkUrlAt (click-to-follow resolution)", async () => {
  const { linkUrlAt } = await import("../src/editor/live-preview/decorations");
  const doc = "A [web link](https://example.com) and <https://auto.link> here.";
  const s = createEditorState(doc);
  it("resolves inside the link text", () => {
    expect(linkUrlAt(s, doc.indexOf("web") + 1)).toBe("https://example.com");
  });
  it("resolves inside the URL part", () => {
    expect(linkUrlAt(s, doc.indexOf("example"))).toBe("https://example.com");
  });
  it("resolves autolinks", () => {
    expect(linkUrlAt(s, doc.indexOf("auto"))).toBe("https://auto.link");
  });
  it("null on plain text", () => {
    expect(linkUrlAt(s, doc.length - 2)).toBeNull();
  });
  it("resolves relative file links", () => {
    const d2 = "see [spec](./sub/nested.md) now";
    expect(linkUrlAt(createEditorState(d2), 6)).toBe("./sub/nested.md");
  });
});

describe("linkUrlAt — reference-style links", async () => {
  const { linkUrlAt } = await import("../src/editor/live-preview/decorations");
  it("resolves [text][label]", () => {
    const doc = "see [the spec][1] here\n\n[1]: https://spec.example.com\n";
    expect(linkUrlAt(createEditorState(doc), 6)).toBe("https://spec.example.com");
  });
  it("resolves collapsed [label]", () => {
    const doc = "see [spec] here\n\n[spec]: https://s.example.com\n";
    expect(linkUrlAt(createEditorState(doc), 6)).toBe("https://s.example.com");
  });
  it("case-insensitive label match", () => {
    const doc = "see [X][Ref] end\n\n[ref]: https://r.example.com\n";
    expect(linkUrlAt(createEditorState(doc), 5)).toBe("https://r.example.com");
  });
  it("null for undefined reference", () => {
    const doc = "see [x][nope] end\n";
    expect(linkUrlAt(createEditorState(doc), 5)).toBeNull();
  });
});

describe("linkUrlAt — boundary clicks (the real-user miss)", async () => {
  const { linkUrlAt } = await import("../src/editor/live-preview/decorations");
  const doc = "A [web link](https://example.com) end";
  const s = createEditorState(doc);
  it("resolves at the opening bracket boundary (pos of '[')", () => {
    expect(linkUrlAt(s, 2)).toBe("https://example.com");
  });
  it("resolves at the closing paren boundary", () => {
    expect(linkUrlAt(s, 33)).toBe("https://example.com");
  });
  it("still null one char before the link", () => {
    expect(linkUrlAt(s, 1)).toBeNull();
  });
});

describe("link hover affordance", () => {
  it("link spans carry the lp-link class in preview", () => {
    const doc = "A [web link](https://example.com) end";
    const s = stateAt(doc, doc.length - 1);
    expect(decosIn(s, 2, 33)).toContain("lp-link");
  });
});
