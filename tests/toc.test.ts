// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { createEditorState } from "../src/editor/setup";
import { extractHeadings, activeHeadingIndex, headingText, TocPanel } from "../src/toc";

const headings = (doc: string) => extractHeadings(createEditorState(doc));

describe("heading extraction", () => {
  it("reads level and text for ATX headings", () => {
    const got = headings("# One\n\ntext\n\n### Three\n");
    expect(got.map((h) => [h.level, h.text])).toEqual([
      [1, "One"],
      [3, "Three"],
    ]);
    expect(got[0].from).toBe(0);
  });

  it("ignores '#' lines inside fenced code — the reason this uses the tree", () => {
    const doc = "# Real\n\n```sh\n# not a heading\necho hi\n```\n\n## Also real\n";
    expect(headings(doc).map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("handles setext headings", () => {
    expect(headings("Title\n=====\n\nSub\n---\n").map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Sub"],
    ]);
  });

  it("strips closing hashes and keeps inline markup readable", () => {
    expect(headingText("## Title ##", 2)).toBe("Title");
    expect(headingText("###   Spaced   ", 3)).toBe("Spaced");
    expect(headingText("`code` in a heading", 1)).toBe("`code` in a heading");
  });

  it("shows depth for an empty heading rather than a blank row", () => {
    expect(headingText("###", 3)).toBe("###");
    expect(headings("## \n").map((h) => h.text)).toEqual(["##"]);
  });

  it("returns nothing for a document without headings", () => {
    expect(headings("just prose\n\nmore prose\n")).toEqual([]);
  });
});

describe("active section", () => {
  const hs = [
    { level: 1, text: "a", from: 0 },
    { level: 2, text: "b", from: 10 },
    { level: 2, text: "c", from: 20 },
  ];
  it("is the last heading at or before the cursor", () => {
    expect(activeHeadingIndex(hs, 0)).toBe(0);
    expect(activeHeadingIndex(hs, 9)).toBe(0);
    expect(activeHeadingIndex(hs, 10)).toBe(1);
    expect(activeHeadingIndex(hs, 25)).toBe(2);
  });
  it("is -1 before the first heading, and safe when there are none", () => {
    expect(activeHeadingIndex([{ level: 1, text: "a", from: 5 }], 2)).toBe(-1);
    expect(activeHeadingIndex([], 0)).toBe(-1);
  });
});

describe("TocPanel", () => {
  const build = () => {
    const parent = document.createElement("div");
    const picked: number[] = [];
    const panel = new TocPanel(parent, (pos) => picked.push(pos));
    return { parent, picked, panel };
  };

  it("renders one row per heading, indented by depth, and jumps on click", () => {
    const { parent, picked, panel } = build();
    panel.toggle();
    panel.render(headings("# One\n\n## Two\n"), 0);
    const rows = parent.querySelectorAll<HTMLElement>(".toc-row");
    expect([...rows].map((r) => r.textContent)).toEqual(["One", "Two"]);
    expect(rows[0].dataset.level).toBe("1");
    expect(rows[1].dataset.level).toBe("2");
    // deeper headings sit further right
    expect(parseInt(rows[1].style.paddingLeft)).toBeGreaterThan(
      parseInt(rows[0].style.paddingLeft),
    );
    rows[1].click();
    expect(picked).toEqual([7]);
  });

  it("moves the highlight without rebuilding the rows", () => {
    const { parent, panel } = build();
    panel.toggle();
    panel.render(headings("# One\n\n## Two\n"), 0);
    const before = [...parent.querySelectorAll(".toc-row")];
    expect(before[0].classList.contains("toc-active")).toBe(true);

    panel.setActive(1);
    const after = [...parent.querySelectorAll(".toc-row")];
    expect(after[0]).toBe(before[0]); // same elements: no rebuild
    expect(after[0].classList.contains("toc-active")).toBe(false);
    expect(after[1].classList.contains("toc-active")).toBe(true);
  });

  it("says so when there is nothing to outline", () => {
    const { parent, panel } = build();
    panel.toggle();
    panel.render([], -1);
    expect(parent.querySelector(".toc-row")).toBeNull();
    expect(parent.querySelector(".toc-hint")?.textContent).toContain("No headings");
  });

  it("toggles open and closed", () => {
    const { panel } = build();
    expect(panel.isOpen).toBe(false);
    expect(panel.toggle()).toBe(true);
    expect(panel.isOpen).toBe(true);
    expect(panel.toggle()).toBe(false);
  });
});
