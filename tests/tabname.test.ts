/** Tab labels: a unique name stands alone, a colliding one earns a folder tail. */
import { describe, it, expect } from "vitest";
import { tabLabels } from "../src/tabname";

describe("tab labels", () => {
  it("leaves unique names undecorated", () => {
    expect(tabLabels(["/a/plan.md", "/b/notes.md"])).toEqual([
      { name: "plan.md", hint: "" },
      { name: "notes.md", hint: "" },
    ]);
  });

  it("adds the parent folder when names collide", () => {
    expect(tabLabels(["/work/simplemd/plan.md", "/work/other/plan.md"])).toEqual([
      { name: "plan.md", hint: "simplemd" },
      { name: "plan.md", hint: "other" },
    ]);
  });

  it("goes deeper only as far as it has to", () => {
    const l = tabLabels(["/work/simplemd/docs/plan.md", "/work/other/docs/plan.md"]);
    expect(l.map((x) => x.hint)).toEqual(["simplemd/docs", "other/docs"]);
  });

  it("decorates only the colliding tabs", () => {
    const l = tabLabels(["/a/plan.md", "/b/plan.md", "/c/readme.md"]);
    expect(l.map((x) => x.hint)).toEqual(["a", "b", ""]);
  });

  it("handles three-way collisions", () => {
    const l = tabLabels(["/x/plan.md", "/y/plan.md", "/z/plan.md"]);
    expect(l.map((x) => x.hint)).toEqual(["x", "y", "z"]);
  });

  it("calls untitled tabs Untitled and never hints them", () => {
    expect(tabLabels([null, null, "/a/plan.md"])).toEqual([
      { name: "Untitled", hint: "" },
      { name: "Untitled", hint: "" },
      { name: "plan.md", hint: "" },
    ]);
  });

  it("survives a file at the filesystem root", () => {
    expect(tabLabels(["/plan.md", "/a/plan.md"]).map((x) => x.hint)).toEqual(["", "a"]);
  });
});
