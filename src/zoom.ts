/** Reader-controlled text size for the document view. A ladder of fixed steps,
 *  not a free multiplier: every stop is a round percentage the indicator can
 *  show, and repeated presses land on the same sizes every time. */
import { readStored, writeStored } from "./store";

const KEY = "simplemd.zoom";
export const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2] as const;
export const DEFAULT_ZOOM = 1;

function nearestIndex(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    if (Math.abs(ZOOM_STEPS[i] - zoom) < Math.abs(ZOOM_STEPS[best] - zoom)) best = i;
  }
  return best;
}

/** One step up (+1) or down (-1); saturates at the ends rather than wrapping. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const i = nearestIndex(current) + dir;
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i))];
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/** ⌘= / ⌘- reach us through the native menu, but muda can only express the
 *  character "=" (Code::Equal), so on a layout with a dedicated "+" key — German
 *  ISO, for one — ⌘+ never matches a menu equivalent and falls through to the
 *  webview. AppKit consumes equivalents it *does* match before the webview sees
 *  them, so handling both places cannot double-step. */
export function zoomKeyDirection(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): 1 | -1 | 0 {
  if (!e.metaKey || e.ctrlKey || e.altKey) return 0;
  if (e.key === "+" || e.key === "=") return 1;
  if (e.key === "-") return -1;
  return 0;
}

export function loadZoom(): number {
  const raw = readStored(KEY);
  const n = Number(raw);
  // snap rather than trust: a hand-edited or stale value must still be a step
  return raw !== null && Number.isFinite(n) && n > 0 ? ZOOM_STEPS[nearestIndex(n)] : DEFAULT_ZOOM;
}

export function saveZoom(zoom: number): void {
  writeStored(KEY, String(zoom));
}
