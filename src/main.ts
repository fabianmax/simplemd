import "./styles.css";
import { createEditor } from "./editor/setup";

const app = document.querySelector<HTMLDivElement>("#app")!;
createEditor(app);

// SPIKE (dev-only): if spike/config.json is present, run the measurement harness
// instead of the app. Guarded by DEV so production builds never include it.
if (import.meta.env.DEV) {
  fetch("/spike/config.json").then(async (r) => {
    if (r.ok) {
      await import("../spike/spike.css");
      const { runSpike } = await import("../spike/harness");
      runSpike();
    }
  }).catch(() => {});
}
