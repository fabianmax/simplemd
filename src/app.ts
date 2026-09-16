/** App state: one window, N tabs, one shared EditorView (states swap on tab
 *  switch — the CM6 pattern). Owns open/save/dirty and the agent-loop reload
 *  path (silent reload, per-tab conflicts, recovery sidecars). */
import { EditorView } from "codemirror";
import { EditorSelection, type EditorState, type StateEffect } from "@codemirror/state";
import { createEditorState, previewCompartment, previewExtension } from "./editor/setup";
import { fromDisk, toDisk, type Eol } from "./fileio";
import { classifyChange, nearestHeadingAbove } from "./sync";
import { computeDiff, changeAnchors, changeCount, type DiffResult } from "./diff";
import { setDiff, clearDiff } from "./editor/diff-decorations";
import { linkUrlAt } from "./editor/live-preview/decorations";
import { formatCommands } from "./editor/format";
import * as ipc from "./ipc";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SwitcherUI } from "./switcher-ui";
import { docStats, formatStats } from "./stats";
import { BrowserPanel } from "./browser";
import { TocPanel, extractHeadings, activeHeadingIndex } from "./toc";
import {
  reorder,
  activeAfterMove,
  dropIndex,
  moveTarget,
  shouldTearOff,
  isDrag,
} from "./tabdrag";
import { ICON, svgIcon } from "./icons";
import { DEFAULT_ZOOM, loadZoom, saveZoom, stepZoom, zoomKeyDirection, zoomLabel } from "./zoom";
import { captureAnchor, restoredScrollTop, type Heights } from "./viewport";
import { openSearchPanel, findNext, findPrevious } from "@codemirror/search";

export interface Tab {
  /** null = untitled scratch tab, gets a path on first save */
  path: string | null;
  state: EditorState; // authoritative only while INACTIVE
  eol: Eol;
  diskHash: string;
  dirty: boolean;
  conflict: boolean; // conflict pending; bar shows when tab becomes active
  /** what the user last SAW (snapshotted on focus-loss) — the diff baseline */
  baseline: string;
  /** external changes vs baseline, shown as highlights until dismissed */
  diff: DiffResult | null;
}

export class App {
  view: EditorView;
  tabs: Tab[] = [];
  active = -1;
  private previewOn = true;
  private reloading = false;
  private conflictBar: HTMLElement;
  private emptyState: HTMLElement;
  private tabStrip: HTMLElement;
  private switcher: SwitcherUI;
  private diffPill: HTMLElement;
  private statusBar: HTMLElement;
  private statsTimer: ReturnType<typeof setTimeout> | null = null;
  private browser: BrowserPanel;
  private browserToggle: HTMLButtonElement;
  private zoomPill: HTMLElement;
  private previewToggle: HTMLButtonElement;
  private mainRow: HTMLElement;
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;
  private zoom = DEFAULT_ZOOM;
  private branch: string | null = null;
  private toc: TocPanel;
  private tocToggle: HTMLButtonElement;
  private tocTimer: ReturnType<typeof setTimeout> | null = null;
  private dropMarker: HTMLElement;
  /** Set for exactly one click: the one a finished drag would otherwise fire. */
  private dragged = false;
  private diffCount: HTMLElement;
  private diffNav = 0;

  constructor(parent: HTMLElement) {
    // Layout: the browser is full-height at the left; everything that belongs to
    // the document — tabs, conflict bar, empty state, editor, pill, status — is
    // stacked in a column to its right, so tabs never span the browser.
    const mainRow = document.createElement("div");
    mainRow.className = "main-row";
    parent.appendChild(mainRow);
    this.browser = new BrowserPanel(mainRow, (path) => void this.openAnyPath(path));
    const column = document.createElement("div");
    column.className = "editor-column";
    mainRow.appendChild(column);
    // Right of the column, so the tab strip still spans the editor only.
    this.toc = new TocPanel(mainRow, (pos) => this.goTo(pos));

    this.tabStrip = document.createElement("div");
    this.tabStrip.className = "tab-strip";
    column.appendChild(this.tabStrip);
    // Anchored to the window's left edge, NOT to the tab strip: riding in the
    // strip meant the button slid right by the panel width whenever the browser
    // opened. It is absolutely positioned over main-row, so it holds the same
    // spot in both states; the browser header and the strip reserve room for it.
    this.browserToggle = document.createElement("button");
    this.browserToggle.className = "chrome-btn browser-toggle";
    this.browserToggle.title = "Toggle file browser (\u2318\u21e7B)";
    this.browserToggle.setAttribute("aria-label", "Toggle file browser");
    this.browserToggle.setAttribute("aria-pressed", "false");
    this.browserToggle.appendChild(svgIcon(ICON.sidebar, "chrome-btn-icon"));
    this.browserToggle.onclick = () => void this.toggleBrowser();
    mainRow.appendChild(this.browserToggle);
    this.mainRow = mainRow;
    // 13: the same switch as ⌘E, reachable without the menu bar. Lit when raw
    // source is showing, exactly like the browser toggle is lit when open.
    this.previewToggle = document.createElement("button");
    this.previewToggle.className = "chrome-btn preview-toggle";
    this.previewToggle.title = "Toggle raw source (\u2318E)";
    this.previewToggle.setAttribute("aria-label", "Toggle raw source");
    this.previewToggle.appendChild(svgIcon(ICON.code, "chrome-btn-icon"));
    this.previewToggle.onclick = () => this.togglePreview();
    this.tocToggle = document.createElement("button");
    this.tocToggle.className = "chrome-btn toc-toggle";
    this.tocToggle.title = "Toggle outline (\u2318\u21e7O)";
    this.tocToggle.setAttribute("aria-label", "Toggle outline");
    this.tocToggle.appendChild(svgIcon(ICON.outline, "chrome-btn-icon"));
    this.tocToggle.onclick = () => this.toggleToc();
    this.dropMarker = document.createElement("div");
    this.dropMarker.className = "tab-drop-marker";
    this.dropMarker.hidden = true;
    this.tabStrip.appendChild(this.dropMarker);
    this.conflictBar = this.buildConflictBar(column);
    this.emptyState = document.createElement("div");
    this.emptyState.className = "empty-state";
    this.emptyState.innerHTML =
      "<div><h2>simplemd</h2><p>Drop a Markdown file here, or press <kbd>⌘O</kbd></p></div>";
    column.appendChild(this.emptyState);
    const editorHost = document.createElement("div");
    editorHost.className = "editor-host";
    column.appendChild(editorHost);
    ({ pill: this.diffPill, count: this.diffCount } = this.buildDiffPill(column));
    this.statusBar = document.createElement("div");
    this.statusBar.className = "status-bar";
    this.statusBar.hidden = true;
    column.appendChild(this.statusBar);
    // After the diff pill in the DOM so CSS can lift it clear when both show.
    this.zoomPill = document.createElement("div");
    this.zoomPill.className = "zoom-pill";
    this.zoomPill.hidden = true;
    column.appendChild(this.zoomPill);
    // Capture phase: the menu equivalents AppKit matches never reach here, so
    // this only ever fires for the ones it cannot express (see zoomKeyDirection).
    window.addEventListener(
      "keydown",
      (e) => {
        const dir = zoomKeyDirection(e);
        if (dir === 0) return;
        e.preventDefault();
        this.zoomBy(dir);
      },
      { capture: true },
    );
    // Empty tab-strip area double-click opens a new tab (user feedback).
    this.tabStrip.ondblclick = (e) => {
      if (e.target === this.tabStrip) this.newUntitledTab();
    };
    // Suppress the webview's default context menu everywhere — its "Reload"
    // wipes all tab state (reported as 'reload closes the tab'). Inside the
    // editor, show the native formatting menu instead.
    // Plain click on a link ALWAYS follows it. Implemented as a capture-phase
    // mousedown/mouseup pair with a drag threshold — DOM `click` is unreliable
    // after CM's mousedown handling in WKWebView, and pointer events are not
    // synthesized for accessibility-driven clicks. A drag (move > 4px) is a
    // selection, not a follow.
    let linkCandidate: { url: string; x: number; y: number } | null = null;
    editorHost.addEventListener(
      "mousedown",
      (e) => {
        linkCandidate = null;
        if (!this.activeTab || !this.previewOn || e.button !== 0) return;
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return;
        const url = linkUrlAt(this.view.state, pos);
        if (url) linkCandidate = { url, x: e.clientX, y: e.clientY };
      },
      { capture: true },
    );
    editorHost.addEventListener(
      "mouseup",
      (e) => {
        const c = linkCandidate;
        linkCandidate = null;
        if (!c) return;
        if (Math.hypot(e.clientX - c.x, e.clientY - c.y) > 4) return; // drag = select
        void this.openLink(c.url);
      },
      { capture: true },
    );
    document.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (editorHost.contains(e.target as Node) && this.activeTab) {
        void ipc.showFormatMenu();
      }
    });
    this.view = new EditorView({ state: this.makeState(""), parent: editorHost });
    this.switcher = new SwitcherUI(
      parent,
      (item) => {
        if (item.tabIndex >= 0 && item.tabIndex < this.tabs.length) {
          this.switchTo(item.tabIndex);
        } else {
          void this.openPath(item.path);
        }
      },
      () => this.view.focus(),
    );
  }

  private async openSwitcher() {
    const open = this.tabs.map((t, i) => ({ path: t.path ?? "Untitled", tabIndex: i }));
    const openPaths = new Set(open.map((o) => o.path));
    const recents = (await ipc.getRecents())
      .filter((p) => !openPaths.has(p))
      .map((p) => ({ path: p, tabIndex: -1 }));
    this.switcher.open([...open, ...recents]);
  }

  // --- editor state plumbing --------------------------------------------------

  private makeState(text: string) {
    return createEditorState(text, [this.dirtyTracker()], { preview: this.previewOn });
  }

  /** Link routing (user feedback): http(s)/mailto -> external browser;
   *  relative/absolute paths resolve against the file's directory —
   *  markdown opens as a tab, anything else opens with its default app. */
  private async openLink(url: string) {
    void ipc.log(`link click: ${url}`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("file:")) {
      await ipc.openExternal(url).then(
        () => void ipc.log("openExternal resolved"),
        (e) => void ipc.log(`openExternal FAILED: ${e}`),
      );
      return;
    }
    const target = url.startsWith("file://") ? decodeURIComponent(url.slice(7)) : url;
    const baseDir = this.activeTab?.path?.replace(/\/[^/]+$/, "") ?? "/";
    const clean = target.replace(/[#?].*$/, ""); // strip anchors/queries
    if (!clean) return;
    const r = await ipc.resolveLink(baseDir, clean);
    if (!r.exists) return;
    if (r.is_md) await this.openPath(r.path);
    else void ipc.openWithDefaultApp(r.path);
  }

  /** Browser rows use the same routing minus URL handling. */
  private async openAnyPath(path: string) {
    if (/\.(md|markdown)$/i.test(path)) await this.openPath(path);
    else void ipc.openWithDefaultApp(path);
  }

  private dirtyTracker() {
    return EditorView.updateListener.of((u) => {
      const tab = this.tabs[this.active];
      if (u.docChanged) {
        if (this.statsTimer) clearTimeout(this.statsTimer);
        this.statsTimer = setTimeout(() => this.renderStats(), 300);
        // The tree walk is the expensive half, so rebuild on a debounce...
        if (this.tocTimer) clearTimeout(this.tocTimer);
        this.tocTimer = setTimeout(() => this.renderToc(), 300);
      } else if (u.selectionSet) {
        // ...but following the cursor only moves a class.
        this.syncTocActive();
      }
      if (u.docChanged && !this.reloading && tab && !tab.dirty) {
        tab.dirty = true;
        this.renderChrome();
      }
    });
  }

  /** Read-only git context: the branch in the status bar, markers in the browser.
   *  Refreshed on the events that can change it — never polled. */
  private async refreshGit(withBrowser = false) {
    const dir = this.activeTab?.path?.replace(/\/[^/]+$/, "") ?? null;
    let branch: string | null = null;
    if (dir) {
      try {
        branch = (await ipc.gitInfo(dir)).branch;
      } catch {
        branch = null;
      }
    }
    if (branch !== this.branch) {
      this.branch = branch;
      this.renderStats();
    }
    // Only on the events that can actually change a file's state: one subprocess
    // per rendered level is fine after a save, wasteful on every tab switch.
    if (withBrowser) await this.browser.refreshGit();
  }

  private renderStats() {
    const tab = this.activeTab;
    this.statusBar.hidden = !tab;
    if (!tab) return;
    const stats = formatStats(docStats(this.view.state.doc.toString()));
    this.statusBar.textContent = this.branch ? `\u2387 ${this.branch} \u00b7 ${stats}` : stats;
  }

  zoomBy(dir: 1 | -1) {
    this.applyZoom(stepZoom(this.zoom, dir));
  }

  resetZoom() {
    this.applyZoom(DEFAULT_ZOOM);
  }

  private applyZoom(zoom: number, flash = true) {
    this.zoom = zoom;
    this.view.dom.style.setProperty("--zoom", String(zoom));
    // Unlike the vw ramp, this font-size change does NOT come from a window
    // resize, so CM6's DOMObserver will not remeasure on its own.
    this.view.requestMeasure();
    saveZoom(zoom);
    if (flash) this.flashZoom();
  }

  /** The size is only worth showing while it is changing. */
  private flashZoom() {
    this.zoomPill.textContent = zoomLabel(this.zoom);
    this.zoomPill.hidden = false;
    if (this.zoomTimer) clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => {
      this.zoomPill.hidden = true;
      this.zoomTimer = null;
    }, 1400);
  }

  // --- tab dragging -------------------------------------------------------------

  /** Reorder inside the strip, or tear the tab out into its own window. The
   *  decisions are in tabdrag.ts; this only measures and dispatches. */
  private beginTabDrag(e: MouseEvent, index: number) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let gap = index;

    const move = (ev: MouseEvent) => {
      const now = { x: ev.clientX, y: ev.clientY };
      if (!dragging) {
        if (!isDrag(start, now)) return; // still a click
        dragging = true;
        document.body.classList.add("dragging-tab");
      }
      gap = dropIndex(this.tabMidpoints(), now.x);
      this.showDropMarker(gap);
    };

    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("dragging-tab");
      this.dropMarker.hidden = true;
      if (!dragging) return;
      this.dragged = true;
      // Cleared on the next turn, once the click this drag produced has passed.
      setTimeout(() => (this.dragged = false), 0);
      const point = { x: ev.clientX, y: ev.clientY };
      if (shouldTearOff(point, this.tearOffGeometry())) void this.tearOff(index, point);
      else this.moveTab(index, moveTarget(index, gap));
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  private tabElements(): HTMLElement[] {
    return [...this.tabStrip.querySelectorAll<HTMLElement>(".tab")];
  }

  private tabMidpoints(): number[] {
    return this.tabElements().map((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
  }

  private tearOffGeometry() {
    return {
      stripBottom: this.tabStrip.getBoundingClientRect().bottom,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  /** A line in the gap, rather than shuffling the tabs themselves: no layout
   *  thrash mid-drag, and the hit-testing stays honest. */
  private showDropMarker(gap: number) {
    const els = this.tabElements();
    if (els.length === 0) return;
    const strip = this.tabStrip.getBoundingClientRect();
    const edge =
      gap >= els.length
        ? els[els.length - 1].getBoundingClientRect().right
        : els[gap].getBoundingClientRect().left;
    this.dropMarker.style.left = `${edge - strip.left + this.tabStrip.scrollLeft}px`;
    this.dropMarker.hidden = false;
  }

  moveTab(from: number, to: number) {
    if (to === from || from < 0 || to < 0) return;
    this.tabs = reorder(this.tabs, from, to);
    this.active = activeAfterMove(this.active, from, to);
    this.renderChrome();
  }

  /** Hand the tab to a new window, then close it here — in that order, so a
   *  window that fails to open leaves the tab exactly where it was. */
  async tearOff(index: number, point: { x: number; y: number }) {
    const tab = this.tabs[index];
    if (!tab) return;
    const text =
      index === this.active ? this.view.state.doc.toString() : tab.state.doc.toString();
    try {
      await ipc.newWindow(
        { path: tab.path, text, dirty: tab.dirty },
        [window.screenX + point.x - 80, window.screenY + point.y - 16],
      );
    } catch {
      return;
    }
    await this.closeTab(index, true);
  }

  /** The menu item (\u2318\u21e7B) and the tab-strip button share this path. */
  async toggleBrowser() {
    const dir = this.activeTab?.path?.replace(/\/[^/]+$/, "") ?? null;
    await this.browser.toggle(dir, this.activeTab?.path ?? null);
    this.syncBrowserToggle();
  }

  private syncBrowserToggle() {
    const on = this.browser.isOpen;
    this.browserToggle.classList.toggle("chrome-btn-on", on);
    this.browserToggle.setAttribute("aria-pressed", String(on));
    // The strip only needs to clear the floating toggle when no panel does.
    this.mainRow.classList.toggle("browser-open", on);
  }

  toggleToc() {
    const open = this.toc.toggle();
    this.tocToggle.classList.toggle("chrome-btn-on", open);
    this.tocToggle.setAttribute("aria-pressed", String(open));
    if (open) this.renderToc();
  }

  /** Rebuild the outline. Cheap enough to run on a debounce, but never on a
   *  keystroke: the tree walk is the expensive half. */
  renderToc() {
    if (!this.toc.isOpen) return;
    const headings = extractHeadings(this.view.state);
    this.toc.render(headings, activeHeadingIndex(headings, this.view.state.selection.main.head));
  }

  private syncTocActive() {
    if (!this.toc.isOpen) return;
    const headings = extractHeadings(this.view.state);
    this.toc.setActive(activeHeadingIndex(headings, this.view.state.selection.main.head));
  }

  /** Jump from the outline: move the cursor there and put the line at the top. */
  goTo(pos: number) {
    this.view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 8 }),
    });
    this.view.focus();
  }

  private syncPreviewToggle() {
    const raw = !this.previewOn;
    this.previewToggle.classList.toggle("chrome-btn-on", raw);
    this.previewToggle.setAttribute("aria-pressed", String(raw));
  }

  /** The EditorView slice captureAnchor/restoredScrollTop need. */
  private heights(): Heights {
    const view = this.view;
    return {
      scrollTop: view.scrollDOM.scrollTop,
      lineAtHeight: (h) => view.state.doc.lineAt(view.lineBlockAtHeight(h).from).number,
      topOfLine: (n) => view.lineBlockAt(view.state.doc.line(n).from).top,
      lines: view.state.doc.lines,
    };
  }

  togglePreview() {
    // Line heights differ between the two modes, so the pixel offset alone
    // would move the text under the reader (#4).
    const anchor = captureAnchor(this.heights());
    this.previewOn = !this.previewOn;
    this.syncPreviewToggle();
    this.view.dispatch({
      effects: previewCompartment.reconfigure(
        this.previewOn ? previewExtension() : [],
      ),
    });
    // After the measure cycle: the new heights (widgets built or dropped) are
    // only known once CM has laid the document out again.
    this.view.requestMeasure({
      read: () => restoredScrollTop(this.heights(), anchor),
      write: (top) => {
        this.view.scrollDOM.scrollTop = top;
      },
    });
    this.view.focus();
  }

  // --- lifecycle ---------------------------------------------------------------

  async init() {
    await ipc.onMenu((id) => this.handleMenu(id));
    await ipc.onOpenRequest(() => this.drainPending());
    await ipc.onFileChanged((p, h) => this.handleFileChanged(p, h));
    await getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") {
        for (const p of e.payload.paths) {
          if (/\.(md|markdown)$/i.test(p)) void this.openPath(p);
        }
      }
    });
    // Snapshot the baseline whenever the user looks away from the window.
    window.addEventListener("blur", () => {
      const tab = this.activeTab;
      if (tab && !tab.diff) tab.baseline = this.view.state.doc.toString();
    });
    await this.adoptHandoff();
    await this.drainPending();
    this.applyZoom(loadZoom(), false);
    this.renderChrome();
  }

  private async drainPending() {
    for (const p of await ipc.takePendingOpen()) await this.openPath(p);
  }

  async handleMenu(id: string) {
    if (id === "open") {
      const p = await ipc.pickMarkdownFile();
      if (p) await this.openPath(p);
    } else if (id === "new-window") {
      await ipc.newWindow();
    } else if (id === "new-tab") {
      this.newUntitledTab();
    } else if (id === "save") {
      await this.save();
    } else if (id === "close-tab") {
      await this.closeTab(this.active);
    } else if (id === "find") {
      openSearchPanel(this.view);
    } else if (id === "find-next") {
      findNext(this.view);
    } else if (id === "find-prev") {
      findPrevious(this.view);
    } else if (id === "toggle-preview") {
      this.togglePreview();
    } else if (id === "quick-switch") {
      await this.openSwitcher();
    } else if (id === "toggle-browser") {
      await this.toggleBrowser();
    } else if (id === "toggle-toc") {
      this.toggleToc();
    } else if (id === "zoom-in") {
      this.zoomBy(1);
    } else if (id === "zoom-out") {
      this.zoomBy(-1);
    } else if (id === "zoom-reset") {
      this.resetZoom();
    } else if (id.startsWith("recent:")) {
      await this.openPath(id.slice("recent:".length));
    } else if (id.startsWith("fmt:")) {
      if (this.activeTab) formatCommands[id]?.(this.view);
    }
  }

  // --- tabs ---------------------------------------------------------------------

  newUntitledTab() {
    this.tabs.push({
      path: null,
      state: this.makeState(""),
      eol: "\n",
      diskHash: "",
      dirty: false,
      conflict: false,
      baseline: "",
      diff: null,
    });
    this.switchTo(this.tabs.length - 1);
  }

  /** A window opened by a tear-off adopts the tab that was dragged out of the
   *  other window — buffer and dirty flag included, so no edit is re-read from
   *  disk and lost. */
  private async adoptHandoff() {
    let handoff;
    try {
      handoff = await ipc.takeHandoff();
    } catch {
      return;
    }
    if (!handoff) return;
    const { path, text, dirty } = handoff;
    // The disk hash is what the file was when it left, so an external write
    // still registers; a dirty tab keeps its own text either way.
    let diskHash = "";
    let eol: Eol = "\n";
    if (path) {
      try {
        const onDisk = await ipc.readFile(path);
        diskHash = onDisk.hash;
        eol = fromDisk(onDisk.content).eol;
      } catch {
        /* gone from disk: the buffer is all we have, which is the point */
      }
    }
    this.tabs.push({
      path,
      state: this.makeState(text),
      eol,
      diskHash,
      dirty,
      conflict: false,
      baseline: text,
      diff: null,
    });
    this.switchTo(this.tabs.length - 1);
    if (path) void ipc.watchFile(path);
  }

  async openPath(path: string): Promise<void> {
    const existing = this.tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      this.switchTo(existing);
      return;
    }
    const { content, hash } = await ipc.readFile(path);
    const { text, eol } = fromDisk(content);
    const tab: Tab = {
      path,
      state: this.makeState(text),
      eol,
      diskHash: hash,
      dirty: false,
      conflict: false,
      baseline: text,
      diff: null,
    };
    this.tabs.push(tab);
    this.switchTo(this.tabs.length - 1);
    void ipc.addRecent(path);
    void ipc.watchFile(path);
  }

  switchTo(index: number) {
    if (index < 0 || index >= this.tabs.length) return;
    this.stashActive();
    this.active = index;
    void this.refreshGit(); // branch only: the tab moved, no file changed
    this.renderToc(); // a different document means a different outline
    const tab = this.tabs[index];
    this.view.setState(tab.state);
    if (tab.diff && changeCount(tab.diff) > 0) {
      this.diffNav = 0;
      const effects: StateEffect<unknown>[] = [setDiff.of(tab.diff)];
      if (tab.diff.firstChange != null) {
        effects.push(EditorView.scrollIntoView(
          Math.min(tab.diff.firstChange, this.view.state.doc.length), { y: "center" }));
      }
      this.view.dispatch({ effects });
    }
    this.renderChrome();
    this.browser.markActive(tab.path);
    this.view.focus();
  }

  /** Untitled tabs get a real path on first save. */
  private async ensurePath(tab: Tab): Promise<boolean> {
    if (tab.path) return true;
    const picked = await ipc.pickSavePath();
    if (!picked) return false;
    tab.path = /\.(md|markdown)$/i.test(picked) ? picked : `${picked}.md`;
    void ipc.addRecent(tab.path);
    void ipc.watchFile(tab.path);
    return true;
  }

  /** Persist the live view state back into the active tab before switching
   *  away — and snapshot the diff baseline: this is "I last looked here". */
  private stashActive() {
    const tab = this.tabs[this.active];
    if (!tab) return;
    tab.state = this.view.state;
    if (!tab.diff) tab.baseline = this.view.state.doc.toString();
  }

  async closeTab(index: number, force = false) {
    const tab = this.tabs[index];
    if (!tab) return;
    // force: the tab moved to another window, nothing is being discarded.
    if (tab.dirty && !force) {
      if (index !== this.active) this.switchTo(index);
      if (!(await ipc.confirmDiscard(fileName(tab.path)))) return;
    }
    if (tab.path) void ipc.unwatchFile(tab.path);
    this.tabs.splice(index, 1);
    if (this.tabs.length === 0) {
      this.active = -1;
      this.view.setState(this.makeState(""));
    } else {
      this.active = -1; // force real switch (index may be unchanged)
      this.switchTo(Math.min(index, this.tabs.length - 1));
      return;
    }
    this.renderChrome();
  }

  private get activeTab(): Tab | undefined {
    return this.tabs[this.active];
  }

  // --- save -----------------------------------------------------------------------

  async save() {
    const tab = this.activeTab;
    if (!tab) return;
    if (!(await this.ensurePath(tab)) || !tab.path) return;
    const text = this.view.state.doc.toString();
    tab.diskHash = await ipc.saveFile(tab.path, toDisk(text, tab.eol));
    tab.dirty = false;
    tab.conflict = false;
    // The user authored this content — it becomes the new baseline.
    tab.baseline = text;
    tab.diff = null;
    this.view.dispatch({ effects: clearDiff.of(null) });
    this.renderChrome();
    void this.refreshGit(true); // the file's git state just changed
  }

  // --- the agent loop ---------------------------------------------------------------

  private async handleFileChanged(path: string, hash: string) {
    const index = this.tabs.findIndex((t) => t.path === path);
    const tab = this.tabs[index];
    if (!tab) return;
    const isActive = index === this.active;
    void this.refreshGit(true); // an external write changes git state too
    const dirty = isActive
      ? tab.dirty
      : tab.dirty; // stored per-tab; view state only diverges in doc/selection
    switch (classifyChange(hash, tab.diskHash, dirty)) {
      case "ignore":
        return;
      case "reload":
        if (isActive) await this.reloadActiveFromDisk();
        else await this.reloadBackgroundTab(tab);
        return;
      case "conflict": {
        const text = isActive ? this.view.state.doc.toString() : tab.state.doc.toString();
        void ipc.writeRecovery(fileName(tab.path), text);
        tab.conflict = true;
        this.renderChrome();
        return;
      }
    }
  }

  /** Silent reload of the ACTIVE tab: keep cursor line and heading-anchored
   *  scroll. NEVER touches window focus. */
  private async reloadActiveFromDisk() {
    const tab = this.activeTab;
    if (!tab?.path) return;
    const { content, hash } = await ipc.readFile(tab.path);
    const { text, eol } = fromDisk(content);
    tab.eol = eol;
    tab.diskHash = hash;

    const prev = this.view.state;
    const cursorLine = prev.doc.lineAt(prev.selection.main.head).number;
    const topLine = prev.doc.lineAt(
      this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop).from,
    ).number;
    const anchor = nearestHeadingAbove((n) => prev.doc.line(n).text, topLine);

    // "Since I last looked": diff the new disk content against the baseline.
    tab.diff = computeDiff(tab.baseline, text);
    this.diffNav = 0;

    this.reloading = true;
    try {
      this.view.dispatch({ changes: { from: 0, to: prev.doc.length, insert: text } });
      const doc = this.view.state.doc;
      const line = doc.line(Math.min(cursorLine, doc.lines));
      const effects: StateEffect<unknown>[] = [];
      if (changeCount(tab.diff) > 0) {
        effects.push(setDiff.of(tab.diff));
        if (tab.diff.firstChange != null) {
          // Scroll to the first change — the cheapest high-value feature found.
          effects.push(EditorView.scrollIntoView(
            Math.min(tab.diff.firstChange, doc.length), { y: "center" }));
        }
      } else if (anchor) {
        for (let ln = 1; ln <= doc.lines; ln++) {
          if (doc.line(ln).text === anchor.text) {
            effects.push(EditorView.scrollIntoView(doc.line(ln).from, { y: "start" }));
            break;
          }
        }
      }
      this.view.dispatch({ selection: { anchor: line.from }, effects });
    } finally {
      this.reloading = false;
    }
    tab.dirty = false;
    tab.conflict = false;
    this.renderChrome();
  }

  /** Background tab: swap in fresh disk content, keep the cursor's line number. */
  private async reloadBackgroundTab(tab: Tab) {
    if (!tab.path) return;
    const { content, hash } = await ipc.readFile(tab.path);
    const { text, eol } = fromDisk(content);
    const oldLine = tab.state.doc.lineAt(tab.state.selection.main.head).number;
    const next = this.makeState(text);
    const line = next.doc.line(Math.min(oldLine, next.doc.lines));
    tab.state = next.update({ selection: EditorSelection.cursor(line.from) }).state;
    tab.eol = eol;
    tab.diskHash = hash;
    tab.dirty = false;
    tab.conflict = false;
    // Diff vs the user's last look; applied when the tab is activated.
    tab.diff = computeDiff(tab.baseline, text);
    this.renderChrome();
  }

  // --- diff pill ------------------------------------------------------------------

  private buildDiffPill(parent: HTMLElement) {
    const pill = document.createElement("div");
    pill.className = "diff-pill";
    pill.hidden = true;
    const count = document.createElement("span");
    const prev = document.createElement("button");
    prev.textContent = "▲";
    prev.onclick = () => this.navigateDiff(-1);
    const next = document.createElement("button");
    next.textContent = "▼";
    next.onclick = () => this.navigateDiff(1);
    const dismiss = document.createElement("button");
    dismiss.textContent = "✕";
    dismiss.title = "Mark as seen";
    dismiss.onclick = () => this.dismissDiff();
    pill.append(count, prev, next, dismiss);
    parent.appendChild(pill);
    return { pill, count };
  }

  private navigateDiff(dir: 1 | -1) {
    const tab = this.activeTab;
    if (!tab?.diff) return;
    const anchors = changeAnchors(tab.diff);
    if (anchors.length === 0) return;
    this.diffNav = (this.diffNav + dir + anchors.length) % anchors.length;
    const pos = Math.min(anchors[this.diffNav], this.view.state.doc.length);
    this.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    this.view.focus();
  }

  private dismissDiff() {
    const tab = this.activeTab;
    if (!tab) return;
    tab.baseline = this.view.state.doc.toString();
    tab.diff = null;
    this.view.dispatch({ effects: clearDiff.of(null) });
    this.renderChrome();
    this.view.focus();
  }

  // --- conflict bar (non-modal; acts on the active tab) ------------------------------

  private buildConflictBar(parent: HTMLElement): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "conflict-bar";
    bar.hidden = true;
    const label = document.createElement("span");
    label.textContent = "File changed on disk while you have unsaved edits.";
    const keep = document.createElement("button");
    keep.textContent = "Keep mine";
    keep.onclick = () => this.resolveKeepMine();
    const take = document.createElement("button");
    take.textContent = "Take theirs";
    take.onclick = () => this.resolveTakeTheirs();
    bar.append(label, keep, take);
    parent.appendChild(bar);
    return bar;
  }

  private async resolveKeepMine() {
    const tab = this.activeTab;
    if (tab?.path) {
      const { hash } = await ipc.readFile(tab.path);
      tab.diskHash = hash; // buffer wins; next ⌘S overwrites
      tab.conflict = false;
    }
    this.renderChrome();
    this.view.focus();
  }

  private async resolveTakeTheirs() {
    await this.reloadActiveFromDisk();
    this.view.focus();
  }

  // --- chrome -------------------------------------------------------------------------

  /** Single render pass for tab strip, conflict bar, empty state, and title. */
  renderChrome() {
    const tab = this.activeTab;
    this.emptyState.hidden = this.tabs.length > 0;
    this.conflictBar.hidden = !tab?.conflict;
    this.syncBrowserToggle();
    this.syncPreviewToggle();

    this.tabStrip.replaceChildren(
      ...this.tabs.map((t, i) => {
        const el = document.createElement("div");
        el.className =
          "tab" +
          (i === this.active ? " tab-active" : "") +
          (t.conflict ? " tab-conflict" : "");
        const name = document.createElement("span");
        name.textContent = fileName(t.path);
        name.title = t.path ?? "Untitled";
        if (t.dirty) {
          const dot = document.createElement("span");
          dot.className = "tab-dot";
          el.appendChild(dot);
        }
        const close = document.createElement("button");
        close.className = "tab-close";
        close.textContent = "×";
        close.onclick = (e) => {
          e.stopPropagation();
          void this.closeTab(i);
        };
        el.append(name, close);
        el.onclick = () => {
          // A finished drag is followed by a click; that click must not also
          // switch tabs, or every reorder would change the active tab.
          if (this.dragged) return;
          this.switchTo(i);
        };
        el.onmousedown = (e) => this.beginTabDrag(e, i);
        el.onauxclick = (e) => {
          if (e.button === 1) void this.closeTab(i);
        };
        return el;
      }),
      this.previewToggle,
      this.tocToggle,
    );
    // Nothing to switch, and nothing to outline, with no document open.
    this.previewToggle.hidden = this.tabs.length === 0;
    this.tocToggle.hidden = this.tabs.length === 0;

    const changes = tab?.diff ? changeCount(tab.diff) : 0;
    this.diffPill.hidden = changes === 0;
    if (changes > 0 && tab?.diff) {
      this.diffCount.replaceChildren();
      const plus = document.createElement("span");
      plus.className = "diff-plus";
      plus.textContent = `+${tab.diff.addedWords}`;
      const minus = document.createElement("span");
      minus.className = "diff-minus";
      minus.textContent = `−${tab.diff.removedWords}`;
      this.diffCount.append(plus, minus);
      this.diffCount.title = "words changed since you last looked";
    }
    this.renderStats();

    const title = tab ? `${tab.dirty ? "• " : ""}${fileName(tab.path)} — simplemd` : "simplemd";
    void ipc.setTitle(title);
  }
}

export function fileName(path: string | null): string {
  return path?.split("/").pop() ?? "Untitled";
}
