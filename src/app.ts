/** App state: one window, one file (v1). Owns the open/save/dirty lifecycle. */
import { EditorView } from "codemirror";
import { createEditorState } from "./editor/setup";
import { fromDisk, toDisk, type Eol } from "./fileio";
import * as ipc from "./ipc";

export class App {
  view: EditorView;
  path: string | null = null;
  eol: Eol = "\n";
  /** Hash of the file's bytes on disk as of our last read/save.
   *  Used in v1b to suppress the watcher's echo of our own saves. */
  diskHash: string | null = null;
  dirty = false;

  constructor(parent: HTMLElement) {
    this.view = new EditorView({
      state: createEditorState("", [this.dirtyTracker()]),
      parent,
    });
  }

  private dirtyTracker() {
    return EditorView.updateListener.of((u) => {
      if (u.docChanged && !this.dirty) {
        this.dirty = true;
        this.updateTitle();
      }
    });
  }

  async init() {
    await ipc.onMenu((id) => this.handleMenu(id));
    await ipc.onOpenRequest(() => this.drainPending());
    await this.drainPending();
    this.updateTitle();
  }

  private async drainPending() {
    const paths = await ipc.takePendingOpen();
    // v1 is single-file: the last requested path wins.
    const last = paths.at(-1);
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
      const name = this.path.split("/").pop() ?? this.path;
      if (!(await ipc.confirmDiscard(name))) return false;
    }
    const { content, hash } = await ipc.readFile(path);
    const { text, eol } = fromDisk(content);
    this.path = path;
    this.eol = eol;
    this.diskHash = hash;
    this.setDocument(text);
    this.dirty = false;
    this.updateTitle();
    this.view.focus();
    void ipc.addRecent(path);
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
    this.updateTitle();
  }

  private updateTitle() {
    const name = this.path ? this.path.split("/").pop() : "No file";
    void ipc.setTitle(`${this.dirty ? "• " : ""}${name} — simplemd`);
  }
}
