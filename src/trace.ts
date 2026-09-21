/** Startup/open timing. CLAUDE.md makes launch speed a constraint ("a slow
 *  launch kills the loop"), and nothing measured it — so this is the ruler (#9).
 *
 *  Marks are collected in memory and flushed as ONE line through the existing
 *  log command, which stamps it with the elapsed time since process start. Cost
 *  when nobody is looking: one invoke per startup and one per file opened. */
import * as ipc from "./ipc";

const t0 = performance.now();
const marks: string[] = [];

export function mark(name: string) {
  marks.push(`${name}=${(performance.now() - t0).toFixed(1)}`);
}

/** After the browser has actually painted, not merely after the DOM is built:
 *  two frames, because the first fires before the paint it schedules. */
export function afterPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function flush(prefix = "startup") {
  if (!marks.length) return;
  void ipc.trace(`${prefix} ${marks.join(" ")}`);
  marks.length = 0;
}

/** One-shot timer for a single operation (opening a file). */
export function timer(label: string) {
  const start = performance.now();
  const parts: string[] = [];
  return {
    lap(name: string) {
      parts.push(`${name}=${(performance.now() - start).toFixed(1)}`);
    },
    done() {
      void ipc.trace(`${label} ${parts.join(" ")}`);
    },
  };
}
