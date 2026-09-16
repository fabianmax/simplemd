// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const ipcStub = vi.hoisted(() => ({
  readFile: vi.fn(async () => ({ content: "# doc\n", hash: "h1" })),
  saveFile: vi.fn(async () => "h1"),
  addRecent: vi.fn(async () => {}),
  getRecents: vi.fn(async () => [] as string[]),
  listDir: vi.fn(async () => [] as unknown[]),
  takePendingOpen: vi.fn(async () => [] as string[]),
  watchFile: vi.fn(async () => {}),
  unwatchFile: vi.fn(async () => {}),
  writeRecovery: vi.fn(async () => "/tmp/recovery.md"),
  onMenu: vi.fn(async () => () => {}),
  onOpenRequest: vi.fn(async () => () => {}),
  onFileChanged: vi.fn(async () => () => {}),
  setTitle: vi.fn(async () => {}),
  openExternal: vi.fn(async () => {}),
  openWithDefaultApp: vi.fn(async () => {}),
  resolveLink: vi.fn(async () => ({ path: "", exists: false, is_md: false })),
  showFormatMenu: vi.fn(async () => {}),
  log: vi.fn(() => {}),
  pickMarkdownFile: vi.fn(async () => null),
  pickSavePath: vi.fn(async () => null),
  pickFolder: vi.fn(async () => null),
  confirmDiscard: vi.fn(async () => true),
  gitInfo: vi.fn(async () => ({ branch: null as string | null, entries: [] })),
  newWindow: vi.fn(async () => "win-2"),
  takeHandoff: vi.fn(async () => null as null | { path: string | null; text: string; dirty: boolean }),
}));
vi.mock("../src/ipc", () => ipcStub);
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import { App } from "../src/app";

/** The chrome is the part of App with no pure core to test separately, so it is
 *  driven through the real DOM the app builds. */
describe("window chrome", () => {
  let root: HTMLElement;
  let app: App;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    root = document.createElement("div");
    document.body.replaceChildren(root);
    ipcStub.takePendingOpen.mockResolvedValueOnce([]);
    app = new App(root);
    await app.init();
  });

  const browserToggle = () => root.querySelector<HTMLButtonElement>(".browser-toggle")!;
  const previewToggle = () => root.querySelector<HTMLButtonElement>(".preview-toggle")!;

  it("anchors the browser toggle to the window, not to the tab strip", () => {
    const btn = browserToggle();
    expect(btn).not.toBeNull();
    // the regression this fixes: riding in the strip moved it by the panel width
    expect(btn.closest(".tab-strip")).toBeNull();
    expect(btn.parentElement?.classList.contains("main-row")).toBe(true);
  });

  it("keeps the toggle in place when the browser opens, and lights it", async () => {
    const btn = browserToggle();
    const row = root.querySelector(".main-row")!;
    expect(row.classList.contains("browser-open")).toBe(false);
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    await app.toggleBrowser();
    expect(row.classList.contains("browser-open")).toBe(true);
    expect(btn.classList.contains("chrome-btn-on")).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    // still the same element in the same parent — it did not move into the strip
    expect(browserToggle()).toBe(btn);
    expect(btn.parentElement?.classList.contains("main-row")).toBe(true);

    await app.toggleBrowser();
    expect(row.classList.contains("browser-open")).toBe(false);
    expect(btn.classList.contains("chrome-btn-on")).toBe(false);
  });

  it("offers the raw/rendered switch only once a document is open", async () => {
    expect(previewToggle().hidden).toBe(true);
    await app.openPath("/docs/plan.md");
    expect(previewToggle().hidden).toBe(false);
    expect(previewToggle().closest(".tab-strip")).not.toBeNull();
  });

  it("lights the raw/rendered switch in raw mode, from either entry point", async () => {
    await app.openPath("/docs/plan.md");
    const btn = previewToggle();
    expect(btn.classList.contains("chrome-btn-on")).toBe(false);

    btn.click(); // the button
    expect(btn.classList.contains("chrome-btn-on")).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");

    app.togglePreview(); // ⌘E / the menu
    expect(btn.classList.contains("chrome-btn-on")).toBe(false);
  });

  it("shows the branch in the status bar, and only the stats without one", async () => {
    const bar = () => root.querySelector<HTMLElement>(".status-bar")!;
    ipcStub.gitInfo.mockResolvedValue({ branch: "v1.5-visual", entries: [] });
    await app.openPath("/repo/plan.md");
    await vi.waitFor(() => expect(bar().textContent).toContain("v1.5-visual"));
    expect(bar().textContent).toContain("words");
    expect(bar().hidden).toBe(false);

    ipcStub.gitInfo.mockResolvedValue({ branch: null, entries: [] });
    await app.openPath("/elsewhere/notes.md");
    await vi.waitFor(() => expect(bar().textContent).not.toContain("v1.5-visual"));
    expect(bar().textContent).toContain("words");
  });

  it("asks git about the directory of the active file only", async () => {
    ipcStub.gitInfo.mockClear();
    await app.openPath("/repo/deep/plan.md");
    await vi.waitFor(() => expect(ipcStub.gitInfo).toHaveBeenCalled());
    expect(ipcStub.gitInfo).toHaveBeenCalledWith("/repo/deep");
  });

  it("outlines the open document, right of the editor column", async () => {
    ipcStub.readFile.mockResolvedValueOnce({
      content: "# Title\n\ntext\n\n## Section\n\nmore\n",
      hash: "h1",
    });
    await app.openPath("/docs/plan.md");
    const toggle = root.querySelector<HTMLButtonElement>(".toc-toggle")!;
    expect(toggle.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".toc")!.hidden).toBe(true);

    toggle.click();
    const panel = root.querySelector<HTMLElement>(".toc")!;
    expect(panel.hidden).toBe(false);
    expect(toggle.classList.contains("chrome-btn-on")).toBe(true);
    // right of the editor column, so the tab strip still spans the editor only
    expect(panel.previousElementSibling?.classList.contains("editor-column")).toBe(true);
    expect([...panel.querySelectorAll(".toc-row")].map((r) => r.textContent)).toEqual([
      "Title",
      "Section",
    ]);
  });

  it("jumps the cursor to the heading that was clicked", async () => {
    const doc = "# Title\n\ntext\n\n## Section\n\nmore\n";
    ipcStub.readFile.mockResolvedValueOnce({ content: doc, hash: "h1" });
    await app.openPath("/docs/plan.md");
    app.toggleToc();
    const rows = root.querySelectorAll<HTMLElement>(".toc-row");
    rows[1].click();
    expect(app.view.state.selection.main.head).toBe(doc.indexOf("## Section"));
  });

  it("follows the cursor without rebuilding the list", async () => {
    const doc = "# Title\n\ntext\n\n## Section\n\nmore\n";
    ipcStub.readFile.mockResolvedValueOnce({ content: doc, hash: "h1" });
    await app.openPath("/docs/plan.md");
    app.toggleToc();
    const rowsBefore = [...root.querySelectorAll(".toc-row")];
    expect(rowsBefore[0].classList.contains("toc-active")).toBe(true);

    app.view.dispatch({ selection: { anchor: doc.length - 1 } });
    const rowsAfter = [...root.querySelectorAll(".toc-row")];
    expect(rowsAfter[0]).toBe(rowsBefore[0]); // same elements
    expect(rowsAfter[1].classList.contains("toc-active")).toBe(true);
  });

  it("keeps the outline closed until asked, and hides its button with no document", () => {
    expect(root.querySelector<HTMLButtonElement>(".toc-toggle")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".toc")!.hidden).toBe(true);
  });

  // --- tab dragging ---------------------------------------------------------

  /** jsdom has no layout, so the strip's geometry is stated explicitly:
   *  three 100px tabs starting at x=0, strip 28px tall. */
  const layOutTabs = () => {
    const strip = root.querySelector<HTMLElement>(".tab-strip")!;
    strip.getBoundingClientRect = () =>
      ({ left: 0, right: 900, top: 0, bottom: 28, width: 900, height: 28 }) as DOMRect;
    root.querySelectorAll<HTMLElement>(".tab").forEach((el, i) => {
      el.getBoundingClientRect = () =>
        ({
          left: i * 100,
          right: i * 100 + 100,
          top: 0,
          bottom: 28,
          width: 100,
          height: 28,
        }) as DOMRect;
    });
  };

  const openThree = async () => {
    for (const name of ["a", "b", "c"]) {
      ipcStub.readFile.mockResolvedValueOnce({ content: `# ${name}\n`, hash: `h-${name}` });
      await app.openPath(`/docs/${name}.md`);
    }
    layOutTabs();
  };

  const drag = (tabIndex: number, from: number, to: { x: number; y: number }) => {
    const tab = root.querySelectorAll<HTMLElement>(".tab")[tabIndex];
    tab.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: from, clientY: 14, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: to.x, clientY: to.y }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: to.x, clientY: to.y }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true })); // the click a drag leaves behind
  };

  const paths = () => app.tabs.map((t) => t.path);

  it("reorders a tab within the strip and keeps the same tab active", async () => {
    await openThree();
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    expect(app.active).toBe(2); // c, the last opened

    drag(0, 50, { x: 260, y: 14 }); // a, dropped past c's midpoint
    expect(paths()).toEqual(["/docs/b.md", "/docs/c.md", "/docs/a.md"]);
    expect(app.tabs[app.active].path).toBe("/docs/c.md"); // still c
  });

  it("a click with a twitch still switches tabs", async () => {
    await openThree();
    const tab = root.querySelectorAll<HTMLElement>(".tab")[0];
    tab.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 14, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 52, clientY: 15 })); // under threshold
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 52, clientY: 15 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(app.active).toBe(0);
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]); // nothing moved
  });

  it("tears a tab off into a new window, carrying the unsaved buffer", async () => {
    await openThree();
    app.view.dispatch({ changes: { from: 0, insert: "edited " } }); // c is active and now dirty
    expect(app.tabs[2].dirty).toBe(true);
    ipcStub.newWindow.mockClear();

    drag(2, 250, { x: 250, y: 300 }); // well below the strip
    await vi.waitFor(() => expect(ipcStub.newWindow).toHaveBeenCalled());

    const [handoff] = ipcStub.newWindow.mock.calls[0];
    expect(handoff.path).toBe("/docs/c.md");
    expect(handoff.dirty).toBe(true);
    expect(handoff.text).toContain("edited"); // the buffer, not the file on disk
    await vi.waitFor(() => expect(paths()).toEqual(["/docs/a.md", "/docs/b.md"]));
    expect(ipcStub.confirmDiscard).not.toHaveBeenCalled(); // nothing is being discarded
  });

  it("keeps the tab when the new window fails to open", async () => {
    await openThree();
    ipcStub.newWindow.mockRejectedValueOnce(new Error("no window"));
    drag(1, 150, { x: 150, y: 300 });
    await vi.waitFor(() => expect(ipcStub.newWindow).toHaveBeenCalled());
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
  });

  it("adopts a handed-off tab on startup, dirty flag and all", async () => {
    ipcStub.takeHandoff.mockResolvedValueOnce({
      path: "/docs/torn.md",
      text: "# torn\nwith edits",
      dirty: true,
    });
    ipcStub.readFile.mockResolvedValueOnce({ content: "# torn\n", hash: "disk" });
    const other = new App(document.createElement("div"));
    await other.init();
    expect(other.tabs).toHaveLength(1);
    expect(other.tabs[0].path).toBe("/docs/torn.md");
    expect(other.tabs[0].dirty).toBe(true);
    expect(other.view.state.doc.toString()).toBe("# torn\nwith edits"); // buffer, not disk
    expect(ipcStub.watchFile).toHaveBeenCalledWith("/docs/torn.md");
  });

  it("survives a tab re-render without losing either button", async () => {
    await app.openPath("/docs/plan.md");
    await app.toggleBrowser();
    const before = { b: browserToggle(), p: previewToggle() };
    app.renderChrome();
    expect(browserToggle()).toBe(before.b);
    expect(previewToggle()).toBe(before.p);
    expect(previewToggle().hidden).toBe(false);
  });
});
