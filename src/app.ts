/** App state: one window, N tabs, one shared EditorView (states swap on tab
 *  switch — the CM6 pattern). Owns open/save/dirty and the agent-loop reload
 *  path (silent reload, per-tab conflicts, recovery sidecars). */
import { EditorView } from "codemirror";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { createEditorState, previewCompartment, previewExtension } from "./editor/setup";
import { fromDisk, toDisk, type Eol } from "./fileio";
import { classifyChange, nearestHeadingAbove } from "./sync";
import * as ipc from "./ipc";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface Tab {
  path: string;
  state: EditorState; // authoritative only while INACTIVE
  eol: Eol;
  diskHash: string;
  dirty: boolean;
  conflict: boolean; // conflict pending; bar shows when tab becomes active
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

  constructor(parent: HTMLElement) {
    this.tabStrip = document.createElement("div");
    this.tabStrip.className = "tab-strip";
    this.tabStrip.hidden = true;
    parent.appendChild(this.tabStrip);
    this.conflictBar = this.buildConflictBar(parent);
    this.emptyState = document.createElement("div");
    this.emptyState.className = "empty-state";
    this.emptyState.innerHTML =
      "<div><h2>simplemd</h2><p>Drop a Markdown file here, or press <kbd>⌘O</kbd></p></div>";
    parent.appendChild(this.emptyState);
    const editorHost = document.createElement("div");
    editorHost.className = "editor-host";
    parent.appendChild(editorHost);
    this.view = new EditorView({ state: this.makeState(""), parent: editorHost });
  }

  // --- editor state plumbing --------------------------------------------------

  private makeState(text: string) {
    return createEditorState(text, [this.dirtyTracker()], {
      preview: this.previewOn,
      openLink: (url) => void ipc.openExternal(url),
    });
  }

  private dirtyTracker() {
    return EditorView.updateListener.of((u) => {
      const tab = this.tabs[this.active];
      if (u.docChanged && !this.reloading && tab && !tab.dirty) {
        tab.dirty = true;
        this.renderChrome();
      }
    });
  }

  togglePreview() {
    this.previewOn = !this.previewOn;
    this.view.dispatch({
      effects: previewCompartment.reconfigure(
        this.previewOn ? previewExtension((url) => void ipc.openExternal(url)) : [],
      ),
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
    await this.drainPending();
    this.renderChrome();
  }

  private async drainPending() {
    for (const p of await ipc.takePendingOpen()) await this.openPath(p);
  }

  async handleMenu(id: string) {
    if (id === "open" || id === "new-tab") {
      const p = await ipc.pickMarkdownFile();
      if (p) await this.openPath(p);
    } else if (id === "save") {
      await this.save();
    } else if (id === "close-tab") {
      await this.closeTab(this.active);
    } else if (id === "toggle-preview") {
      this.togglePreview();
    } else if (id.startsWith("recent:")) {
      await this.openPath(id.slice("recent:".length));
    }
  }

  // --- tabs ---------------------------------------------------------------------

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
    this.view.setState(this.tabs[index].state);
    this.renderChrome();
    this.view.focus();
  }

  /** Persist the live view state back into the active tab before switching away. */
  private stashActive() {
    const tab = this.tabs[this.active];
    if (tab) tab.state = this.view.state;
  }

  async closeTab(index: number) {
    const tab = this.tabs[index];
    if (!tab) return;
    if (tab.dirty) {
      if (index !== this.active) this.switchTo(index);
      if (!(await ipc.confirmDiscard(fileName(tab.path)))) return;
    }
    void ipc.unwatchFile(tab.path);
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
    const text = this.view.state.doc.toString();
    tab.diskHash = await ipc.saveFile(tab.path, toDisk(text, tab.eol));
    tab.dirty = false;
    tab.conflict = false;
    this.renderChrome();
  }

  // --- the agent loop ---------------------------------------------------------------

  private async handleFileChanged(path: string, hash: string) {
    const index = this.tabs.findIndex((t) => t.path === path);
    const tab = this.tabs[index];
    if (!tab) return;
    const isActive = index === this.active;
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
    if (!tab) return;
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

    this.reloading = true;
    try {
      this.view.dispatch({ changes: { from: 0, to: prev.doc.length, insert: text } });
      const doc = this.view.state.doc;
      const line = doc.line(Math.min(cursorLine, doc.lines));
      const effects = [];
      if (anchor) {
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
    this.renderChrome();
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
    if (tab) {
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
    this.tabStrip.hidden = this.tabs.length === 0;
    this.conflictBar.hidden = !tab?.conflict;

    this.tabStrip.replaceChildren(
      ...this.tabs.map((t, i) => {
        const el = document.createElement("div");
        el.className =
          "tab" +
          (i === this.active ? " tab-active" : "") +
          (t.conflict ? " tab-conflict" : "");
        const name = document.createElement("span");
        name.textContent = `${t.dirty ? "• " : ""}${fileName(t.path)}`;
        name.title = t.path;
        const close = document.createElement("button");
        close.className = "tab-close";
        close.textContent = "×";
        close.onclick = (e) => {
          e.stopPropagation();
          void this.closeTab(i);
        };
        el.append(name, close);
        el.onclick = () => this.switchTo(i);
        el.onauxclick = (e) => {
          if (e.button === 1) void this.closeTab(i);
        };
        this.tabStrip.appendChild(el);
        return el;
      }),
    );

    const title = tab ? `${tab.dirty ? "• " : ""}${fileName(tab.path)} — simplemd` : "simplemd";
    void ipc.setTitle(title);
  }
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}
