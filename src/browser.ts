/** File browser panel: a BROWSER, not an index (CLAUDE.md non-goal). Rooted
 *  at the active file's directory or a folder you point it at; every level is
 *  fetched lazily on expand — no cache, no recursion, no vault. */
import * as ipc from "./ipc";

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

  private emptyHint() {
    const d = document.createElement("div");
    d.className = "browser-hint";
    d.textContent = "Open a file to root the browser";
    return d;
  }

  private async renderLevel(dirPath: string, depth: number): Promise<HTMLElement> {
    const box = document.createElement("div");
    let entries;
    try {
      entries = await ipc.listDir(dirPath);
    } catch {
      return box;
    }
    for (const e of entries) {
      const row = document.createElement("div");
      row.className = "browser-row " + (e.is_dir ? "browser-dir" : "browser-file");
      row.style.paddingLeft = `${10 + depth * 14}px`;
      row.dataset.path = e.path;
      row.textContent = (e.is_dir ? "▸ " : "") + e.name;
      if (!e.is_dir && e.path === this.activeFile) row.classList.add("browser-active");
      box.appendChild(row);
      if (e.is_dir) {
        let child: HTMLElement | null = null;
        row.onclick = async () => {
          if (child) {
            const open = !child.hidden;
            child.hidden = open;
            row.textContent = (open ? "▸ " : "▾ ") + e.name;
          } else {
            child = await this.renderLevel(e.path, depth + 1); // lazy fetch
            row.after(child);
            row.textContent = "▾ " + e.name;
          }
        };
      } else {
        row.onclick = () => this.onOpen(e.path);
      }
    }
    return box;
  }
}
