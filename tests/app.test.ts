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
