import { describe, it, expect } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { createEditorState } from "../src/editor/setup";
import {
  toggleInlineSpec,
  setHeadingSpec,
  toggleTaskListSpec,
  toggleBulletListSpec,
  insertLinkSpec,
  insertCodeFenceSpec,
  insertTableSpec,
} from "../src/editor/format";

const state = (doc: string, from: number, to = from) =>
  createEditorState(doc).update({ selection: EditorSelection.single(from, to) }).state;

const apply = (s: ReturnType<typeof state>, spec: object) => s.update(spec).state;

describe("toggleInlineSpec", () => {
  it("wraps a selection", () => {
    const s = state("make this bold", 5, 9);
    expect(apply(s, toggleInlineSpec(s, "**")).doc.toString()).toBe("make **this** bold");
  });
  it("unwraps when markers surround the selection", () => {
    const s = state("make **this** bold", 7, 11);
    expect(apply(s, toggleInlineSpec(s, "**")).doc.toString()).toBe("make this bold");
  });
  it("unwraps when markers are inside the selection", () => {
    const s = state("make **this** bold", 5, 13);
    expect(apply(s, toggleInlineSpec(s, "**")).doc.toString()).toBe("make this bold");
  });
  it("empty selection: inserts pair, cursor inside", () => {
    const s = state("ab", 1);
    const next = apply(s, toggleInlineSpec(s, "*"));
    expect(next.doc.toString()).toBe("a**b");
    expect(next.selection.main.head).toBe(2);
  });
});

describe("setHeadingSpec", () => {
  it("sets a level on a plain line", () => {
    const s = state("title", 2);
    expect(apply(s, setHeadingSpec(s, 2)).doc.toString()).toBe("## title");
  });
  it("changes an existing level", () => {
    const s = state("### title", 5);
    expect(apply(s, setHeadingSpec(s, 1)).doc.toString()).toBe("# title");
  });
  it("level 0 strips the heading", () => {
    const s = state("## title", 4);
    expect(apply(s, setHeadingSpec(s, 0)).doc.toString()).toBe("title");
  });
  it("applies across a multi-line selection", () => {
    const s = state("a\nb", 0, 3);
    expect(apply(s, setHeadingSpec(s, 2)).doc.toString()).toBe("## a\n## b");
  });
});

describe("line-prefix toggles", () => {
  it("task list on, then off", () => {
    let s = state("alpha\nbeta", 0, 8);
    s = apply(s, toggleTaskListSpec(s));
    expect(s.doc.toString()).toBe("- [ ] alpha\n- [ ] beta");
    s = s.update({ selection: EditorSelection.single(0, s.doc.length) }).state;
    expect(apply(s, toggleTaskListSpec(s)).doc.toString()).toBe("alpha\nbeta");
  });
  it("checked tasks also strip", () => {
    const s = state("- [x] done", 3);
    expect(apply(s, toggleTaskListSpec(s)).doc.toString()).toBe("done");
  });
  it("bullet toggle ignores task lines when detecting", () => {
    const s = state("- [ ] task", 2);
    expect(apply(s, toggleBulletListSpec(s)).doc.toString()).toBe("- - [ ] task");
  });
  it("mixed lines: adds only where missing", () => {
    const s = state("- a\nb", 0, 5);
    expect(apply(s, toggleBulletListSpec(s)).doc.toString()).toBe("- a\n- b");
  });
});

describe("insertions", () => {
  it("link wraps selection and selects the url placeholder", () => {
    const s = state("see spec here", 4, 8);
    const next = apply(s, insertLinkSpec(s));
    expect(next.doc.toString()).toBe("see [spec](url) here");
    expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe("url");
  });
  it("fence wraps selected lines", () => {
    const s = state("const x = 1;", 0, 12);
    expect(apply(s, insertCodeFenceSpec(s)).doc.toString()).toBe("```\nconst x = 1;\n```");
  });
  it("empty fence places cursor inside", () => {
    const s = state("", 0);
    const next = apply(s, insertCodeFenceSpec(s));
    expect(next.doc.toString()).toBe("```\n\n```");
    expect(next.selection.main.head).toBe(4);
  });
  it("table skeleton lands after the current line", () => {
    const s = state("intro", 3);
    expect(apply(s, insertTableSpec(s)).doc.toString()).toContain("| column | column |");
  });
});

describe("selection edge cases (found by e2e)", () => {
  it("bold on select-all trims the trailing newline out of the wrap", () => {
    const s = state("format me\n", 0, 10);
    expect(apply(s, toggleInlineSpec(s, "**")).doc.toString()).toBe("**format me**\n");
  });
  it("heading skips empty lines in a multi-line selection", () => {
    const s = state("format me\n", 0, 10);
    expect(apply(s, setHeadingSpec(s, 2)).doc.toString()).toBe("## format me\n");
  });
});

describe("byte-safety: toggles are exact inverses", () => {
  it("bold wrap then unwrap round-trips, selection tracking the text", () => {
    const doc = "hello world";
    let s = state(doc, 0, 5);
    s = apply(s, toggleInlineSpec(s, "**")); // wrap; selection follows "hello"
    expect(s.doc.toString()).toBe("**hello** world");
    s = apply(s, toggleInlineSpec(s, "**")); // unwrap via surrounding markers
    expect(s.doc.toString()).toBe(doc);
  });
});
