// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const listDir = vi.fn();
vi.mock("../src/ipc", () => ({
  listDir: (p: string) => listDir(p),
  pickFolder: vi.fn(),
}));

import { BrowserPanel } from "../src/browser";

const entry = (name: string, dir: boolean, base = "/root") => ({
  name,
  path: `${base}/${name}`,
  is_dir: dir,
});

describe("BrowserPanel", () => {
  let parent: HTMLElement;
  let opened: string[];
  let panel: BrowserPanel;

  beforeEach(() => {
    parent = document.createElement("div");
    opened = [];
    panel = new BrowserPanel(parent, (p) => opened.push(p));
    listDir.mockReset();
  });

  it("renders one level; files open on click", async () => {
    listDir.mockResolvedValueOnce([entry("sub", true), entry("plan.md", false)]);
    await panel.toggle("/root", null);
    const rows = parent.querySelectorAll(".browser-row");
    expect([...rows].map((r) => r.textContent)).toEqual(["▸ sub", "plan.md"]);
    (rows[1] as HTMLElement).click();
    expect(opened).toEqual(["/root/plan.md"]);
    expect(listDir).toHaveBeenCalledTimes(1); // no recursion — a browser, not an index
  });

  it("expands a directory lazily, exactly once", async () => {
    listDir.mockResolvedValueOnce([entry("sub", true)]);
    await panel.toggle("/root", null);
    listDir.mockResolvedValueOnce([entry("nested.md", false, "/root/sub")]);
    const dirRow = parent.querySelector<HTMLElement>(".browser-dir")!;
    dirRow.click();
    await vi.waitFor(() => {
      expect(parent.textContent).toContain("nested.md");
    });
    expect(listDir).toHaveBeenCalledTimes(2);
    // collapse + re-expand: no third fetch
    dirRow.click();
    dirRow.click();
    expect(listDir).toHaveBeenCalledTimes(2);
    const nested = [...parent.querySelectorAll<HTMLElement>(".browser-file")].find(
      (r) => r.textContent === "nested.md",
    )!;
    nested.click();
    expect(opened).toEqual(["/root/sub/nested.md"]);
  });

  it("marks the active file", async () => {
    listDir.mockResolvedValueOnce([entry("a.md", false), entry("b.md", false)]);
    await panel.toggle("/root", "/root/b.md");
    expect(parent.querySelector(".browser-active")?.textContent).toBe("b.md");
    panel.markActive("/root/a.md");
    expect(parent.querySelector(".browser-active")?.textContent).toBe("a.md");
  });

  it("toggle hides and re-shows without refetching root eagerly", async () => {
    listDir.mockResolvedValue([entry("a.md", false)]);
    await panel.toggle("/root", null);
    expect(panel.isOpen).toBe(true);
    await panel.toggle("/root", null);
    expect(panel.isOpen).toBe(false);
  });
});
