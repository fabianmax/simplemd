/** The hover hint for links. The native `title` attribute took a second and a
 *  half to appear, which is long enough that nobody ever saw it — so this is
 *  CM's own tooltip at 120ms, showing where the link goes as well as the
 *  gesture that follows it (a browser's status bar, roughly). */
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { linkUrlAt } from "./live-preview/decorations";

/** Long URLs are cut in the middle: the host and the file name are the two
 *  parts that say what a link is. */
export function shortenUrl(url: string, max = 64): string {
  if (url.length <= max) return url;
  const head = Math.ceil((max - 1) / 2);
  return `${url.slice(0, head)}…${url.slice(url.length - (max - head - 1))}`;
}

export function linkTooltip(): Extension {
  // NOTE: `tooltips({position: "fixed"})` is a no-op in this app. CM forces
  // absolute positioning when its browser check says iOS, and that check is
  // true for this WKWebView — worth knowing before debugging a tooltip that
  // reports a sane rect and sane styles. Absolute works fine here: the wrapper
  // lands directly under <body> with nothing clipping it.
  return hoverTooltip(
    (view, pos): Tooltip | null => {
      const url = linkUrlAt(view.state, pos);
      if (!url) return null;
      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-link-tip";
          const key = document.createElement("span");
          key.className = "cm-link-tip-key";
          key.textContent = "\u2318-click";
          const target = document.createElement("span");
          target.textContent = shortenUrl(url);
          dom.append(key, target);
          return { dom };
        },
      };
    },
    { hoverTime: 120 },
  );
}
