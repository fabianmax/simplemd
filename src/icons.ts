/** Inline SVG icons. No icon font, no dependency: every path strokes
 *  currentColor, so dark mode needs no second rule. */
const SHEET = "M9.2 1.9H4.3c-.6 0-1 .4-1 1v10.2c0 .6.4 1 1 1h7.4c.6 0 1-.4 1-1V5.4z";
const FOLD = "M9.2 1.9v3.5h3.5";

export const ICON = {
  dir: ["M1.6 4.3c0-.6.4-1 1-1h3.2l1.4 1.6h6.2c.6 0 1 .4 1 1v6.2c0 .6-.4 1-1 1h-10.8c-.6 0-1-.4-1-1z"],
  md: [SHEET, FOLD, "M5.6 8.6h4.8", "M5.6 11h3.2"],
  file: [SHEET, FOLD],
  code: ["M6.2 5.4 3.6 8l2.6 2.6", "M9.8 5.4 12.4 8l-2.6 2.6"],
  image: [
    "M2.4 3.4h11.2c.4 0 .8.4.8.8v7.6c0 .4-.4.8-.8.8H2.4a.8.8 0 0 1-.8-.8V4.2c0-.4.4-.8.8-.8z",
    "M1.8 11.2 5.6 7.6l2.8 2.6 2-1.8 3.4 3",
  ],
  chevron: ["M6.4 4.2 10.2 8l-3.8 3.8"],
  sidebar: [
    "M2.6 3.2h10.8c.7 0 1.2.5 1.2 1.2v7.2c0 .7-.5 1.2-1.2 1.2H2.6c-.7 0-1.2-.5-1.2-1.2V4.4c0-.7.5-1.2 1.2-1.2z",
    "M6.3 3.2v9.6",
  ],
} as const;

export function svgIcon(paths: readonly string[], cls: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("viewBox", "0 0 16 16");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "1.3");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("class", cls);
  el.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    el.appendChild(p);
  }
  return el;
}
