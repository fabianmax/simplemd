# M1 spike results — 2026-08-30

Measured inside the real Tauri v2 WKWebView on Apple Silicon (debug build,
dev server). Harness: `spike/harness.ts`; runner: `spike/run-matrix.sh`;
corpora: deterministic agent-plan-shaped markdown (`spike/gen-corpus.ts`,
seed 42). Raw JSON in `spike/results/`.

## Experiment 1.1 — CM6 live-preview stress (the #1 open risk)

Corpora: 1k / 10k / 50k lines; 54 / 506 / 2,434 fenced blocks; 33 KB / 334 KB /
1.7 MB. Full-document decoration rebuild on every keystroke (naive — no
viewport scoping, no caching). "widgets" = fences+tables as
`Decoration.replace` block widgets; "in-place" = no widgets (fallback #1).

| run | init (ms) | typing sync p50/p95/max (ms) | deco rebuild p95 (ms) | paint p95 (ms) | cursor p95 (ms) | height drift (px/120 moves) |
|---|---|---|---|---|---|---|
| 1k-widgets | 47 | 1 / 3 / 5 | 1 | 18 | 18 | 2,854 |
| 1k-in-place | 37 | 1 / 2 / 3 | 1 | 18 | 18 | 0 |
| 10k-widgets | 68 | 3 / 4 / 5 | 3 | 18 | 18 | 4,014 |
| 10k-in-place | 51 | 3 / 4 / 6 | 2 | 18 | 18 | 0 |
| 50k-widgets | 148 | 11 / 13 / 19 | 9 | 18 | 18 | 1,932 |
| 50k-in-place | 125 | 7 / 8 / 13 | 5 | 18 | 18 | 0 |

Notes on reading the table:
- "paint p95 = 18 ms" is the RAF measurement floor (one 60 Hz frame); it means
  every update painted within a single frame at every size. "sync" is the true
  synchronous dispatch cost.
- Height drift on cursor travel in widgets mode is the widget↔raw-source swap
  when the cursor enters/leaves a fence — inherent to reveal, same as Obsidian.
  Scroll-only height drift was **0 px at every size** (stable height map; no
  scrollbar churn).
- Peak app-process RSS was flat ~115 MB at all sizes. **Known gap:** WKWebView
  content lives in a separate system-spawned WebContent process that `ps` on
  the app PID does not capture; webview memory was not attributed.

### Verdict: GATE PASSED — full live preview with block widgets is viable

- 10k lines: sync p95 **4 ms** (gate: <16 ms) — 4× headroom.
- 50k lines / 2,434 fences: sync p95 **13 ms**, max 19 ms (gate: <50 ms) —
  passes even with naive full-document rebuilds. CM6's viewport
  virtualization does the heavy lifting: only visible widgets materialize.
- **No fallback needed.** Viewport-scoped rebuilds and block caching remain
  available as optimization headroom (deco rebuild is 70-80% of sync cost at
  50k), not as necessities.
- Decision: **v1 ships the widgets design.** Fence/table widgets, per-line
  reveal, full-doc rebuild initially; add viewport scoping only if real-world
  files regress.

## Experiment 1.2 — markdown-it under JavaScriptCore

Full-document `md.render()` (markdown-it 15, GFM-ish corpus, warm):

| corpus | JSC (this spike) | V8 (research, similar-size corpus) |
|---|---|---|
| 334 KB / 10k lines | **11 ms** | ~67 ms (583 KB) |
| 1.7 MB / 50k lines | **43 ms** | ~222 ms (1.76 MB) |

JSC is comfortably fast for this corpus shape — if anything faster than the
research corpus on V8 (different corpus composition; not a controlled A/B).
Conclusion: **markdown-it performance is a non-issue in the real runtime.**
The V8-vs-JSC risk is retired for the render path.

## Experiment 1.3 — watcher proof (Rust, `src-tauri/src/watcher.rs`)

Design: watch parent directory (never an fd) → 120 ms debounce → hash gate.
`cargo test watcher`:

- `survives_atomic_writes_torture` — **1,000 write-temp-then-rename cycles;
  watcher never goes silent, sees final content.** (An inode-bound watch dies
  on cycle 1 — Zed's bug.) ✅
- `silent_on_identical_rewrite_and_touch` — no emission for self-save echo or
  mtime-only touch; still catches the next real change. ✅
- `burst_collapses_to_one_emission` — 20 rapid writes → exactly one event. ✅

Remaining for v1 (needs the app UI): buffer-replace on reload with scroll
anchored to nearest heading, and the manual no-focus-steal check with the
window in the background.

## Status vs plan

- M1 exit criteria: **met** — all three experiments have numbers; the
  live-preview strategy is chosen from measurements.
- `spike/` is retained as reference until v1's editor module lands, then
  deleted (per plan: nothing gets promoted by copy-paste without review).
