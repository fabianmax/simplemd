import "./styles.css";
import { App } from "./app";
import { invoke } from "@tauri-apps/api/core";

const log = (msg: string) => void invoke("frontend_log", { msg }).catch(() => {});
window.addEventListener("error", (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => log(`unhandled rejection: ${e.reason}`));
window.addEventListener("pagehide", () => log("pagehide (window closing or navigating!)"));
log("frontend booted");

const root = document.querySelector<HTMLDivElement>("#app")!;
const app = new App(root);
void app.init();
