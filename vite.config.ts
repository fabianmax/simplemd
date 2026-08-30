import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/

import { writeFileSync, mkdirSync } from "node:fs";

/** SPIKE (dev-only): receive measurement results from inside the WKWebView. */
const spikeReport = () => ({
  name: "spike-report",
  configureServer(server: any) {
    server.middlewares.use("/spike-report", (req: any, res: any) => {
      let body = "";
      req.on("data", (c: any) => (body += c));
      req.on("end", () => {
        const data = JSON.parse(body);
        mkdirSync("spike/results", { recursive: true });
        writeFileSync(`spike/results/${data.name}.json`, JSON.stringify(data, null, 2));
        res.end("ok");
      });
    });
  },
});

export default defineConfig(async () => ({
  plugins: [spikeReport()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
