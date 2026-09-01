import "./styles.css";
import { App } from "./app";

const root = document.querySelector<HTMLDivElement>("#app")!;
const app = new App(root);
void app.init();

// SPIKE (dev-only): retained until v1 ships; runs the measurement harness
// when spike/config.json is present. Never part of production builds.
if (import.meta.env.DEV) {
  fetch("/spike/config.json")
    .then(async (r) => {
      if (r.ok) {
        await import("../spike/spike.css");
        const { runSpike } = await import("../spike/harness");
        runSpike();
      }
    })
    .catch(() => {});
}
