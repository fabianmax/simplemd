/** Typed wrappers around the Tauri IPC surface. Keep ALL @tauri-apps imports
 *  here so the rest of the frontend stays headless-testable. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";

export interface FileContent {
  content: string;
  hash: string;
}

export const readFile = (path: string) => invoke<FileContent>("read_file", { path });
export const saveFile = (path: string, content: string) =>
  invoke<string>("save_file", { path, content });
export const addRecent = (path: string) => invoke<void>("add_recent", { path });
export const takePendingOpen = () => invoke<string[]>("take_pending_open");

export const onMenu = (cb: (id: string) => void) =>
  listen<string>("menu", (e) => cb(e.payload));
export const onOpenRequest = (cb: () => void) => listen("open-request", () => cb());

export const setTitle = (title: string) => getCurrentWindow().setTitle(title);

export async function pickMarkdownFile(): Promise<string | null> {
  const picked = await openDialog({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export const confirmDiscard = (fileName: string) =>
  ask(`"${fileName}" has unsaved changes. Discard them?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
