import "./styles.css";
import { App } from "./app";
import { mark, flush, afterPaint } from "./trace";
import { invoke } from "@tauri-apps/api/core";

const log = (msg: string) => void invoke("frontend_log", { msg }).catch(() => {});
window.addEventListener("error", (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => log(`unhandled rejection: ${e.reason}`));
window.addEventListener("pagehide", () => log("pagehide (window closing or navigating!)"));
log("frontend booted");
mark("boot");

const root = document.querySelector<HTMLDivElement>("#app")!;
const app = new App(root);
mark("chrome");
void app.init().then(() => {
  // Flushed here, NOT after a frame: requestAnimationFrame is throttled while
  // the window is occluded or unfocused, which turned a 70ms startup into a
  // 2-second "measurement". The number that means anything is process start ->
  // UI built, which is what the Rust side stamps this line with.
  mark("ready");
  flush();
  afterPaint(() => {
    mark("firstFrame");
    flush("frame");
  });
});
