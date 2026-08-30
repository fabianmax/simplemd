/**
 * SPIKE measurement harness. Runs inside the real Tauri WKWebView.
 * Driven by spike/config.json; POSTs results to the Vite dev middleware,
 * which writes spike/results/<corpus>-<mode>.json.
 * WKWebView has no layout-shift observer and no performance.memory, so:
 *   - CLS proxy = total document-height drift across cursor moves
 *   - memory is sampled outside via `ps` (correlated by phase timestamps)
 */
import { EditorView } from "codemirror";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { livePreview, lastBuildMs, type SpikeMode } from "./live-preview";

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
const stats = (xs: number[]) => ({ p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs), n: xs.length });

async function measureTyping(view: EditorView, positions: number[], perPos: number) {
  const samples: number[] = [];
  const sync: number[] = [];
  const build: number[] = [];
  for (const pos of positions) {
    view.dispatch({ selection: EditorSelection.cursor(Math.min(pos, view.state.doc.length)) });
    await raf();
    for (let i = 0; i < perPos; i++) {
      const at = view.state.selection.main.head;
      const t0 = performance.now();
      view.dispatch({ changes: { from: at, insert: "x" }, selection: EditorSelection.cursor(at + 1) });
      sync.push(performance.now() - t0); // real work: dispatch is synchronous
      build.push(lastBuildMs);           // decoration rebuild share of it
      await raf(); // frame in which the update painted
      samples.push(performance.now() - t0);
    }
  }
  return { toPaint: stats(samples), sync: stats(sync), decoBuild: stats(build) };
}

async function measureCursorTravel(view: EditorView, startLine: number, steps: number) {
  const samples: number[] = [];
  let heightDrift = 0;
  let prevHeight = view.scrollDOM.scrollHeight;
  for (let i = 0; i < steps; i++) {
    const line = view.state.doc.line(Math.min(startLine + i, view.state.doc.lines));
    const t0 = performance.now();
    view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
    await raf();
    samples.push(performance.now() - t0);
    const h = view.scrollDOM.scrollHeight;
    heightDrift += Math.abs(h - prevHeight);
    prevHeight = h;
  }
  return { latency: stats(samples), totalHeightDriftPx: heightDrift };
}

async function measureScroll(view: EditorView, chunks: number) {
  const dom = view.scrollDOM;
  const drifts: number[] = [];
  const samples: number[] = [];
  for (let i = 0; i <= chunks; i++) {
    const target = (dom.scrollHeight - dom.clientHeight) * (i / chunks);
    const before = dom.scrollHeight;
    const t0 = performance.now();
    dom.scrollTop = target;
    await raf(); await raf(); // let CM measure/rebuild the viewport
    samples.push(performance.now() - t0);
    drifts.push(Math.abs(dom.scrollHeight - before));
  }
  return { latency: stats(samples), heightDrift: stats(drifts) };
}

export async function runSpike() {
  const cfg = await (await fetch("/spike/config.json")).json() as { corpus: string; mode: SpikeMode };
  const text = await (await fetch(`/spike/corpus-${cfg.corpus}.md`)).text();

  document.body.innerHTML = `<div id="app" style="height:100vh"></div>`;
  const t0 = performance.now();
  const view = new EditorView({
    state: EditorState.create({ doc: text, extensions: [markdown(), livePreview(cfg.mode)] }),
    parent: document.querySelector("#app")!,
  });
  await raf(); await raf();
  const initialRenderMs = performance.now() - t0;

  const L = view.state.doc.lines;
  const posOf = (frac: number) => view.state.doc.line(Math.max(1, Math.floor(L * frac))).from;
  const phases: Record<string, unknown> = { config: cfg, lines: L, chars: text.length, initialRenderMs };

  // Experiment 1.2: markdown-it full render in JSC (research numbers were V8)
  {
    const MarkdownIt = (await import("markdown-it")).default;
    const m = new MarkdownIt({ html: false });
    m.render(text); // warmup
    const t = performance.now();
    m.render(text);
    phases.markdownItFullRenderMs = performance.now() - t;
  }

  phases.typing = await measureTyping(view, [posOf(0.1), posOf(0.5), posOf(0.9)], 60);
  phases.cursorTravel = await measureCursorTravel(view, Math.floor(L * 0.4), 120);
  phases.scroll = await measureScroll(view, 40);
  phases.finishedAt = Date.now();

  await fetch("/spike-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${cfg.corpus}-${cfg.mode}`, ...phases }),
  });
  document.title = "SPIKE-DONE";
}
