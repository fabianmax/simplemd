/** Typed wrappers around the Tauri IPC surface. Keep ALL @tauri-apps imports
 *  here so the rest of the frontend stays headless-testable. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog, ask } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

export interface FileContent {
  content: string;
  hash: string;
}

export const readFile = (path: string) => invoke<FileContent>("read_file", { path });
export const saveFile = (path: string, content: string) =>
  invoke<string>("save_file", { path, content });
export const addRecent = (path: string) => invoke<void>("add_recent", { path });
export const getRecents = () => invoke<string[]>("get_recents");
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}
export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const takePendingOpen = () => invoke<string[]>("take_pending_open");
export const watchFile = (path: string) => invoke<void>("watch_file", { path });
export const unwatchFile = (path: string) => invoke<void>("unwatch_file", { path });
export const writeRecovery = (fileName: string, content: string) =>
  invoke<string>("write_recovery", { fileName, content });

export const onMenu = (cb: (id: string) => void) =>
  listen<string>("menu", (e) => cb(e.payload));
export const onOpenRequest = (cb: () => void) => listen("open-request", () => cb());
export const onFileChanged = (cb: (path: string, hash: string) => void) =>
  listen<{ path: string; hash: string }>("file-changed", (e) =>
    cb(e.payload.path, e.payload.hash),
  );

export const setTitle = (title: string) => getCurrentWindow().setTitle(title);
export const openExternal = (url: string) => invoke<void>("open_external", { url });
export const openWithDefaultApp = (path: string) => openPath(path);
export interface ResolvedLink {
  path: string;
  exists: boolean;
  is_md: boolean;
}
export const resolveLink = (baseDir: string, target: string) =>
  invoke<ResolvedLink>("resolve_link", { baseDir, target });
export const showFormatMenu = () => invoke<void>("show_format_menu");
export const log = (msg: string) => invoke<void>("frontend_log", { msg }).catch(() => {});

export async function pickMarkdownFile(): Promise<string | null> {
  const picked = await openDialog({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickSavePath(): Promise<string | null> {
  const picked = await saveDialog({
    defaultPath: "Untitled.md",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  return picked ?? null;
}

export async function pickFolder(): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

export const confirmDiscard = (fileName: string) =>
  ask(`"${fileName}" has unsaved changes. Discard them?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
