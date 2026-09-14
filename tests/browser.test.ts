// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const listDir = vi.fn();
const pickFolder = vi.fn();
vi.mock("../src/ipc", () => ({
  listDir: (p: string) => listDir(p),
  pickFolder: () => pickFolder(),
}));

import {
  BrowserPanel,
  entryKind,
  clampWidth,
  MIN_WIDTH,
  MAX_WIDTH,
  DEFAULT_WIDTH,
} from "../src/browser";

const entry = (name: string, dir: boolean, base = "/root") => ({
  name,
  path: `${base}/${name}`,
  is_dir: dir,
});

const names = (el: ParentNode) =>
  [...el.querySelectorAll(".browser-name")].map((r) => r.textContent);

describe("entryKind", () => {
  it("classifies into the five kinds", () => {
    expect(entryKind("notes", true)).toBe("dir");
    expect(entryKind("plan.md", false)).toBe("md");
    expect(entryKind("README.markdown", false)).toBe("md");
    expect(entryKind("shot.PNG", false)).toBe("image");
    expect(entryKind("app.ts", false)).toBe("code");
    expect(entryKind("Cargo.toml", false)).toBe("code");
    expect(entryKind("LICENSE", false)).toBe("file");
  });

  it("a directory is a dir whatever its name looks like", () => {
    expect(entryKind("docs.md", true)).toBe("dir");
  });
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
    pickFolder.mockReset();
    // Node shadows the jsdom global ("localStorage is not available because
    // --localstorage-file was not provided"), so stand one up explicitly.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  it("renders one level; files open on click", async () => {
    listDir.mockResolvedValueOnce([entry("sub", true), entry("plan.md", false)]);
    await panel.toggle("/root", null);
    expect(names(parent)).toEqual(["sub", "plan.md"]);
    const rows = parent.querySelectorAll<HTMLElement>(".browser-row");
    expect([...rows].map((r) => r.dataset.kind)).toEqual(["dir", "md"]);
    rows[1].click();
    expect(opened).toEqual(["/root/plan.md"]);
    expect(listDir).toHaveBeenCalledTimes(1); // no recursion — a browser, not an index
  });

  it("gives every row an icon, and only directories a chevron", async () => {
    listDir.mockResolvedValueOnce([entry("sub", true), entry("plan.md", false)]);
    await panel.toggle("/root", null);
    const rows = parent.querySelectorAll<HTMLElement>(".browser-row");
    for (const row of rows) expect(row.querySelector("svg.browser-icon")).not.toBeNull();
    // files keep an empty chevron slot so their names line up with folders
    expect(rows[0].querySelector("svg.browser-chevron")).not.toBeNull();
    expect(rows[1].querySelector("svg.browser-chevron")).toBeNull();
    expect(rows[1].querySelector(".browser-chevron")).not.toBeNull();
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
    // the open state is a class, not rewritten text — the chevron rotates in CSS
    expect(dirRow.classList.contains("browser-open")).toBe(true);
    // collapse + re-expand: no third fetch
    dirRow.click();
    expect(dirRow.classList.contains("browser-open")).toBe(false);
    dirRow.click();
    expect(dirRow.classList.contains("browser-open")).toBe(true);
    expect(listDir).toHaveBeenCalledTimes(2);
    const nested = [...parent.querySelectorAll<HTMLElement>(".browser-file")].find(
      (r) => r.textContent === "nested.md",
    )!;
    nested.click();
    expect(opened).toEqual(["/root/sub/nested.md"]);
  });

  it("nests each level in its own wrapper, tagged with its depth", async () => {
    listDir.mockResolvedValueOnce([entry("sub", true)]);
    await panel.toggle("/root", null);
    listDir.mockResolvedValueOnce([entry("nested.md", false, "/root/sub")]);
    parent.querySelector<HTMLElement>(".browser-dir")!.click();
    await vi.waitFor(() => {
      expect(parent.querySelectorAll(".browser-level").length).toBe(2);
    });
    const levels = [...parent.querySelectorAll<HTMLElement>(".browser-level")];
    expect(levels.map((l) => l.dataset.depth)).toEqual(["0", "1"]);
    // the child level is nested inside the parent level: the guide rule and the
    // indent are CSS on the wrapper, never an inline padding on the row
    expect(levels[0].contains(levels[1])).toBe(true);
    expect(parent.querySelector<HTMLElement>(".browser-row")!.style.paddingLeft).toBe("");
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

  it("drags to a new width, clamped at both ends, and remembers it", async () => {
    listDir.mockResolvedValue([entry("a.md", false)]);
    await panel.toggle("/root", null);
    expect(panel.width).toBe(DEFAULT_WIDTH);
    const grip = parent.querySelector<HTMLElement>(".browser-resizer")!;
    expect(grip.hidden).toBe(false);

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 220, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    expect(panel.width).toBe(300);
    expect(panel.root.style.width).toBe("300px");

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 9000 }));
    expect(panel.width).toBe(MAX_WIDTH);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: -9000 }));
    expect(panel.width).toBe(MIN_WIDTH);

    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(localStorage.getItem("simplemd.browser-width")).toBe(String(MIN_WIDTH));
    // listeners released: a stray move after mouseup must not resize anything
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
    expect(panel.width).toBe(MIN_WIDTH);
    expect(document.body.classList.contains("resizing")).toBe(false);
  });

  it("picks the remembered width up on the next launch", () => {
    localStorage.setItem("simplemd.browser-width", "300");
    const next = new BrowserPanel(document.createElement("div"), () => {});
    expect(next.width).toBe(300);
  });

  it("clamps a corrupt stored width instead of trusting it", () => {
    localStorage.setItem("simplemd.browser-width", "99999");
    const next = new BrowserPanel(document.createElement("div"), () => {});
    expect(next.width).toBe(MAX_WIDTH);
    expect(clampWidth(0)).toBe(MIN_WIDTH);
  });

  it("falls back to the default when storage is unavailable or throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    const next = new BrowserPanel(document.createElement("div"), () => {});
    expect(next.width).toBe(DEFAULT_WIDTH);
    // and a drag must still work, it just will not be remembered
    expect(() => next.setWidth(300)).not.toThrow();
    expect(next.width).toBe(300);
  });

  it("hides the resize grip along with the panel", async () => {
    listDir.mockResolvedValue([entry("a.md", false)]);
    const grip = parent.querySelector<HTMLElement>(".browser-resizer")!;
    expect(grip.hidden).toBe(true);
    await panel.toggle("/root", null);
    expect(grip.hidden).toBe(false);
    await panel.toggle("/root", null);
    expect(grip.hidden).toBe(true);
  });

  it("with no root, the hint offers a folder picker (otherwise a dead end)", async () => {
    await panel.toggle(null, null);
    const pick = parent.querySelector<HTMLButtonElement>(".browser-pick")!;
    expect(pick).not.toBeNull();
    pickFolder.mockResolvedValueOnce("/picked");
    listDir.mockResolvedValueOnce([entry("a.md", false, "/picked")]);
    pick.click();
    await vi.waitFor(() => {
      expect(names(parent)).toEqual(["a.md"]);
    });
    expect(listDir).toHaveBeenCalledWith("/picked");
  });
});
