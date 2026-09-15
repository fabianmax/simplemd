/** File browser panel: a BROWSER, not an index (CLAUDE.md non-goal). Rooted
 *  at the active file's directory or a folder you point it at; every level is
 *  fetched lazily on expand — no cache, no recursion, no vault. */
import * as ipc from "./ipc";
import { ICON, svgIcon } from "./icons";
import { readStored, writeStored } from "./store";

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

const WIDTH_KEY = "simplemd.browser-width";
export const MIN_WIDTH = 160;
export const MAX_WIDTH = 520;
export const DEFAULT_WIDTH = 220;

export function clampWidth(px: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)));
}

function storedWidth(): number {
  const raw = readStored(WIDTH_KEY);
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) && n > 0 ? clampWidth(n) : DEFAULT_WIDTH;
}

function storeWidth(px: number) {
  writeStored(WIDTH_KEY, String(px));
}

export class BrowserPanel {
  readonly root: HTMLElement;
  private header: HTMLElement;
  private tree: HTMLElement;
  private resizer: HTMLElement;
  /** dir -> its rendered level, so a refresh only touches what is on screen.
   *  This is the browser's whole memory: no cache of anything unrendered. */
  private levels = new Map<string, HTMLElement>();
  private widthPx = DEFAULT_WIDTH;
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
    this.resizer = document.createElement("div");
    this.resizer.className = "browser-resizer";
    this.resizer.hidden = true;
    this.resizer.setAttribute("role", "separator");
    this.resizer.setAttribute("aria-orientation", "vertical");
    this.resizer.onmousedown = (e) => this.beginResize(e);
    parent.appendChild(this.resizer);
    this.setWidth(storedWidth());
  }

  get isOpen() {
    return !this.root.hidden;
  }

  get width() {
    return this.widthPx;
  }

  setWidth(px: number) {
    this.widthPx = clampWidth(px);
    this.root.style.width = `${this.widthPx}px`;
  }

  /** Mouse events, not pointer events: the rest of this codebase already drives
   *  its drag handling from mousedown/mouseup, and they are trivially testable. */
  private beginResize(e: MouseEvent) {
    e.preventDefault(); // otherwise the drag starts a text selection
    const startX = e.clientX;
    const startWidth = this.widthPx;
    const move = (ev: MouseEvent) => this.setWidth(startWidth + (ev.clientX - startX));
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      storeWidth(this.widthPx);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.body.classList.add("resizing");
  }

  async toggle(defaultRoot: string | null, activeFile: string | null) {
    if (this.isOpen) {
      this.root.hidden = true;
      this.resizer.hidden = true;
      return;
    }
    this.activeFile = activeFile;
    if (!this.rootPath) this.rootPath = defaultRoot;
    this.root.hidden = false;
    this.resizer.hidden = false;
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
    this.levels.clear(); // the whole tree is about to be replaced
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

  /** Re-reads git state for the levels currently on screen (after a save, or an
   *  external write). Never walks anything that is not already rendered. */
  async refreshGit() {
    if (!this.isOpen) return;
    for (const [dir, level] of this.levels) {
      if (level.hidden) continue; // collapsed: not on screen, not worth a subprocess
      applyGit(level, await gitStates(dir));
    }
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
    this.levels.set(dirPath, box);
    let entries;
    try {
      entries = await ipc.listDir(dirPath);
    } catch {
      return box;
    }
    const git = await gitStates(dirPath);
    for (const e of entries) {
      const row = this.row(e);
      setGitState(row, git.get(e.path));
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

// --- git markers ----------------------------------------------------------------

const GIT_TITLE: Record<string, string> = {
  M: "changed",
  A: "staged",
  "?": "untracked",
};

/** Never throws: a directory outside a repo is a non-event, not an error. */
async function gitStates(dir: string): Promise<Map<string, string>> {
  try {
    const info = await ipc.gitInfo(dir);
    return new Map(info.entries.map((e) => [e.path, e.state]));
  } catch {
    return new Map();
  }
}

function setGitState(row: HTMLElement, state: string | undefined) {
  row.querySelector(".browser-git")?.remove();
  delete row.dataset.git;
  if (!state) return;
  row.dataset.git = state;
  const dot = document.createElement("span");
  dot.className = "browser-git";
  dot.title = GIT_TITLE[state] ?? state;
  row.appendChild(dot);
}

function applyGit(level: HTMLElement, states: Map<string, string>) {
  // Direct children only: a nested level refreshes against its own directory.
  for (const row of level.children) {
    if (!(row instanceof HTMLElement) || !row.classList.contains("browser-row")) continue;
    const path = row.dataset.path;
    if (path) setGitState(row, states.get(path));
  }
}
