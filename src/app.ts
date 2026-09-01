/** App state: one window, one file (v1). Owns the open/save/dirty lifecycle
 *  and the agent-loop reload path (silent reload, conflict bar, recovery). */
import { EditorView } from "codemirror";
import { createEditorState } from "./editor/setup";
import { fromDisk, toDisk, type Eol } from "./fileio";
import { classifyChange, nearestHeadingAbove } from "./sync";
import * as ipc from "./ipc";

export class App {
  view: EditorView;
  path: string | null = null;
  eol: Eol = "\n";
  /** Hash of the file's bytes on disk as of our last read/save; watcher
   *  events carrying this hash are echoes of our own writes. */
  diskHash: string | null = null;
  dirty = false;
  private reloading = false;
  private conflictBar: HTMLElement;

  constructor(parent: HTMLElement) {
    this.conflictBar = this.buildConflictBar(parent);
    const editorHost = document.createElement("div");
    editorHost.className = "editor-host";
    parent.appendChild(editorHost);
    this.view = new EditorView({
      state: createEditorState("", [this.dirtyTracker()]),
      parent: editorHost,
    });
  }

  private dirtyTracker() {
    return EditorView.updateListener.of((u) => {
      if (u.docChanged && !this.reloading && !this.dirty) {
        this.dirty = true;
        this.updateTitle();
      }
    });
  }

  async init() {
    await ipc.onMenu((id) => this.handleMenu(id));
    await ipc.onOpenRequest(() => this.drainPending());
    await ipc.onFileChanged((hash) => this.handleFileChanged(hash));
    await this.drainPending();
    this.updateTitle();
  }

  private async drainPending() {
    const paths = await ipc.takePendingOpen();
    const last = paths.at(-1); // v1 is single-file: last requested path wins
    if (last) await this.openPath(last);
  }

  async handleMenu(id: string) {
    if (id === "open") {
      const p = await ipc.pickMarkdownFile();
      if (p) await this.openPath(p);
    } else if (id === "save") {
      await this.save();
    } else if (id.startsWith("recent:")) {
      await this.openPath(id.slice("recent:".length));
    }
    // "toggle-preview" lands in v1c.
  }

  async openPath(path: string): Promise<boolean> {
    if (this.dirty && this.path) {
      if (!(await ipc.confirmDiscard(this.fileName()))) return false;
    }
    const { content, hash } = await ipc.readFile(path);
    const { text, eol } = fromDisk(content);
    this.path = path;
    this.eol = eol;
    this.diskHash = hash;
    this.hideConflict();
    this.setDocument(text);
    this.dirty = false;
    this.updateTitle();
    this.view.focus();
    void ipc.addRecent(path);
    void ipc.watchFile(path);
    return true;
  }

  private setDocument(text: string) {
    this.view.setState(createEditorState(text, [this.dirtyTracker()]));
  }

  async save() {
    if (!this.path) return;
    const text = this.view.state.doc.toString();
    this.diskHash = await ipc.saveFile(this.path, toDisk(text, this.eol));
    this.dirty = false;
    this.hideConflict();
    this.updateTitle();
  }

  // --- the agent loop -------------------------------------------------------

  private async handleFileChanged(hash: string) {
    if (!this.path) return;
    switch (classifyChange(hash, this.diskHash, this.dirty)) {
      case "ignore":
        return;
      case "reload":
        await this.reloadFromDisk();
        return;
      case "conflict":
        // Sidecar recovery FIRST — before the user chooses anything.
        void ipc.writeRecovery(this.fileName(), this.view.state.doc.toString());
        this.showConflict();
        return;
    }
  }

  /** Silent reload: replace the buffer, keep cursor line and scroll anchored
   *  to the nearest heading. NEVER touches window focus. */
  private async reloadFromDisk() {
    if (!this.path) return;
    const { content, hash } = await ipc.readFile(this.path);
    const { text, eol } = fromDisk(content);
    this.eol = eol;
    this.diskHash = hash;

    const prev = this.view.state;
    const cursorLine = prev.doc.lineAt(prev.selection.main.head).number;
    const topLine = prev.doc.lineAt(
      this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop).from,
    ).number;
    const anchor = nearestHeadingAbove((n) => prev.doc.line(n).text, topLine);

    this.reloading = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: prev.doc.length, insert: text },
      });
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
    this.dirty = false;
    this.updateTitle();
  }

  // --- conflict bar (non-modal: typing keeps working underneath) -------------

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

  private showConflict() {
    this.conflictBar.hidden = false;
  }
  private hideConflict() {
    this.conflictBar.hidden = true;
  }

  private async resolveKeepMine() {
    // Buffer wins; next ⌘S overwrites disk. Adopt the on-disk hash so the
    // same external write doesn't re-trigger the bar.
    if (this.path) {
      const { hash } = await ipc.readFile(this.path);
      this.diskHash = hash;
    }
    this.hideConflict();
    this.view.focus();
  }

  private async resolveTakeTheirs() {
    await this.reloadFromDisk();
    this.hideConflict();
    this.view.focus();
  }

  private fileName(): string {
    return this.path?.split("/").pop() ?? "untitled";
  }

  private updateTitle() {
    const name = this.path ? this.fileName() : "No file";
    void ipc.setTitle(`${this.dirty ? "• " : ""}${name} — simplemd`);
  }
}
