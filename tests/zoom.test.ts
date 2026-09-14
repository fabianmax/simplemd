import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ZOOM_STEPS,
  DEFAULT_ZOOM,
  stepZoom,
  zoomLabel,
  zoomKeyDirection,
  loadZoom,
  saveZoom,
} from "../src/zoom";

const key = (over: Partial<KeyboardEvent> & { key: string }) => ({
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  ...over,
});

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

describe("zoom ladder", () => {
  it("steps up and down through the fixed stops", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.9, -1)).toBe(0.8);
  });

  it("saturates at both ends instead of wrapping", () => {
    const min = ZOOM_STEPS[0];
    const max = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    expect(stepZoom(min, -1)).toBe(min);
    expect(stepZoom(max, 1)).toBe(max);
  });

  it("snaps an off-ladder value to the nearest stop before stepping", () => {
    expect(stepZoom(1.07, 1)).toBe(1.25); // nearest is 1.1, one up from there
    expect(stepZoom(1.07, -1)).toBe(1);
  });

  it("labels as whole percentages", () => {
    expect(zoomLabel(0.6)).toBe("60%");
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(1.25)).toBe("125%");
  });
});

describe("zoom key fallback", () => {
  it("claims the shortcuts the native menu cannot express", () => {
    expect(zoomKeyDirection(key({ key: "+" }))).toBe(1);
    expect(zoomKeyDirection(key({ key: "=" }))).toBe(1);
    expect(zoomKeyDirection(key({ key: "-" }))).toBe(-1);
  });

  it("ignores anything that is not a bare ⌘ chord", () => {
    expect(zoomKeyDirection(key({ key: "+", metaKey: false }))).toBe(0);
    expect(zoomKeyDirection(key({ key: "+", ctrlKey: true }))).toBe(0);
    expect(zoomKeyDirection(key({ key: "-", altKey: true }))).toBe(0);
    expect(zoomKeyDirection(key({ key: "b" }))).toBe(0);
  });
});

describe("zoom persistence", () => {
  it("round-trips a step", () => {
    saveZoom(1.4);
    expect(loadZoom()).toBe(1.4);
  });

  it("defaults when nothing is stored", () => {
    expect(loadZoom()).toBe(DEFAULT_ZOOM);
  });

  it("snaps a corrupt or out-of-range value onto the ladder", () => {
    store.set("simplemd.zoom", "9");
    expect(loadZoom()).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    store.set("simplemd.zoom", "1.07");
    expect(loadZoom()).toBe(1.1);
    store.set("simplemd.zoom", "not a number");
    expect(loadZoom()).toBe(DEFAULT_ZOOM);
    store.set("simplemd.zoom", "0");
    expect(loadZoom()).toBe(DEFAULT_ZOOM);
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadZoom()).toBe(DEFAULT_ZOOM);
    expect(() => saveZoom(1.6)).not.toThrow();
  });
});
