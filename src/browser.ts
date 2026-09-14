/** File browser panel: a BROWSER, not an index (CLAUDE.md non-goal). Rooted
 *  at the active file's directory or a folder you point it at; every level is
 *  fetched lazily on expand — no cache, no recursion, no vault. */
import * as ipc from "./ipc";
import { ICON, svgIcon } from "./icons";

export type EntryKind = "dir" | "md" | "image" | "code" | "file";

/** Five kinds, deliberately: this is decoration, not a file-type registry. */
export function entryKind(name: string, isDir: boolean): EntryKind {
  if (isDir) return "dir";
  if (/\.(md|markdown)$/i.test(name)) return "md";
  if (/\.(png|jpe?g|gif|webp|svg|heic|avif)$/i.test(name)) return "image";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|rb|java|swift|c|h|cpp|sh|zsh|json|toml|ya?ml|css|html?)$/i.test(name))
    return "code";
  return "file";
}

export class BrowserPanel {
  readonly root: HTMLElement;
  private header: HTMLElement;
  private tree: HTMLElement;
  private rootPath: string | null = null;
  private activeFile: string | null = null;

  constructor(
    parent: HTMLElement,
    private onOpen: (path: string) => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "browser";
    this.root.hidden = true;
    this.header = document.createElement("div");
    this.header.className = "browser-header";
    this.tree = document.createElement("div");
    this.tree.className = "browser-tree";
    this.root.append(this.header, this.tree);
    parent.appendChild(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  async toggle(defaultRoot: string | null, activeFile: string | null) {
    if (this.isOpen) {
      this.root.hidden = true;
      return;
    }
    this.activeFile = activeFile;
    if (!this.rootPath) this.rootPath = defaultRoot;
    this.root.hidden = false;
    if (this.rootPath) await this.setRoot(this.rootPath);
    else this.tree.replaceChildren(this.emptyHint());
  }

  markActive(path: string | null) {
    this.activeFile = path;
    for (const el of this.tree.querySelectorAll<HTMLElement>(".browser-file")) {
      el.classList.toggle("browser-active", el.dataset.path === path);
    }
  }

  async setRoot(path: string) {
    this.rootPath = path;
    this.header.replaceChildren();
    const up = document.createElement("button");
    up.textContent = "↑";
    up.title = "Parent folder";
    up.onclick = () => {
      const parent = path.replace(/\/[^/]+$/, "");
      if (parent) void this.setRoot(parent);
    };
    const name = document.createElement("span");
    name.textContent = path.split("/").pop() || path;
    name.title = path;
    const pick = document.createElement("button");
    pick.textContent = "…";
    pick.title = "Choose folder";
    pick.onclick = async () => {
      const p = await ipc.pickFolder();
      if (p) void this.setRoot(p);
    };
    this.header.append(up, name, pick);
    this.tree.replaceChildren(await this.renderLevel(path, 0));
  }

  /** With no root there is no header, so the folder picker has to live here —
   *  otherwise the empty panel is a dead end. */
  private emptyHint() {
    const d = document.createElement("div");
    d.className = "browser-hint";
    const line = document.createElement("p");
    line.textContent = "Open a file to root the browser, or";
    const pick = document.createElement("button");
    pick.className = "browser-pick";
    pick.textContent = "Choose folder…";
    pick.onclick = async () => {
      const p = await ipc.pickFolder();
      if (p) await this.setRoot(p);
    };
    d.append(line, pick);
    return d;
  }

  private row(e: ipc.DirEntry): HTMLElement {
    const kind = entryKind(e.name, e.is_dir);
    const row = document.createElement("div");
    row.className =
      "browser-row " + (e.is_dir ? "browser-dir" : `browser-file browser-${kind}`);
    row.dataset.path = e.path;
    row.dataset.kind = kind;
    // Files carry an empty chevron slot so their names align with folder names.
    let chevron: Element;
    if (e.is_dir) {
      chevron = svgIcon(ICON.chevron, "browser-chevron");
    } else {
      const slot = document.createElement("span");
      slot.className = "browser-chevron";
      chevron = slot;
    }
    const name = document.createElement("span");
    name.className = "browser-name";
    name.textContent = e.name;
    name.title = e.name;
    row.append(chevron, svgIcon(ICON[kind], "browser-icon"), name);
    if (!e.is_dir && e.path === this.activeFile) row.classList.add("browser-active");
    return row;
  }

  private async renderLevel(dirPath: string, depth: number): Promise<HTMLElement> {
    // Indentation and the guide rule live on this wrapper, not on each row.
    const box = document.createElement("div");
    box.className = "browser-level";
    box.dataset.depth = String(depth);
    let entries;
    try {
      entries = await ipc.listDir(dirPath);
    } catch {
      return box;
    }
    for (const e of entries) {
      const row = this.row(e);
      box.appendChild(row);
      if (e.is_dir) {
        let child: HTMLElement | null = null;
        row.onclick = async () => {
          if (child) {
            const open = !child.hidden;
            child.hidden = open;
            row.classList.toggle("browser-open", !open);
          } else {
            child = await this.renderLevel(e.path, depth + 1); // lazy fetch
            row.after(child);
            row.classList.add("browser-open");
          }
        };
      } else {
        row.onclick = () => this.onOpen(e.path);
      }
    }
    return box;
  }
}
