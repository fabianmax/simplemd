/** Live-preview decoration layer. Rules earned from research + spike:
 *  - buffer is source text; ALL of this is view-only decoration
 *  - per-line reveal; marker hiding via CSS class, never display:none
 *  - never atomicRanges
 *  - constant (reveal-independent) line styling for fences/quotes so line
 *    heights never change with cursor position
 *  - rebuilds frozen during drag-selection (capture-phase pointerdown)
 */
import { EditorState, StateField, StateEffect, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { revealedLines, setsEqual } from "./reveal";
import { TableWidget, CheckboxWidget } from "./widgets";

const hideMark = Decoration.mark({ class: "lp-hidden" });
const linkMark = Decoration.mark({ class: "lp-link" });
const inlineCodeMark = Decoration.mark({ class: "lp-inline-code" });
const fenceLine = Decoration.line({ class: "lp-fence-line" });
const codeLine = Decoration.line({ class: "lp-code-line" });
const quoteLine = Decoration.line({ class: "lp-quote-line" });

const PARSE_BUDGET_MS = 5000;

export function buildDecorations(state: EditorState): DecorationSet {
  const revealed = revealedLines(state);
  const deco: Range<Decoration>[] = [];
  // A budget miss must never blank the document: fall back to whatever the
  // background parse has produced so far and decorate that. parseWatcher
  // rebuilds once the full tree lands.
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);

  const lineRevealed = (pos: number) => revealed.has(state.doc.lineAt(pos).number);
  const anyLineRevealed = (from: number, to: number) => {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    for (let l = a; l <= b; l++) if (revealed.has(l)) return true;
    return false;
  };
  const eachLine = (from: number, to: number, d: Decoration) => {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    for (let l = a; l <= b; l++) deco.push(d.range(state.doc.line(l).from));
  };

  tree.iterate({
    enter(node) {
      switch (node.name) {
        case "Table": {
          if (!anyLineRevealed(node.from, node.to)) {
            deco.push(
              Decoration.replace({
                widget: new TableWidget(
                  state.doc.sliceString(node.from, node.to),
                  node.from,
                ),
                block: true,
              }).range(node.from, node.to),
            );
            return false; // widget covers children
          }
          return undefined; // revealed: keep iterating (marks stay visible)
        }
        case "FencedCode": {
          // Constant styling — identical whether revealed or not.
          eachLine(node.from, node.to, codeLine);
          const first = state.doc.lineAt(node.from);
          const last = state.doc.lineAt(node.to);
          deco.push(fenceLine.range(first.from));
          if (last.from !== first.from) deco.push(fenceLine.range(last.from));
          return false;
        }
        case "Blockquote": {
          eachLine(node.from, node.to, quoteLine); // constant styling
          return undefined; // children (marks, emphasis) still processed
        }
        case "Link":
        case "Autolink": {
          // hover affordance: pointer cursor + underline (preview mode only —
          // this decoration set doesn't exist in raw mode)
          deco.push(linkMark.range(node.from, node.to));
          return undefined;
        }
        case "HeaderMark": {
          const parent = node.node.parent;
          if (parent && parent.name.startsWith("ATXHeading") && !lineRevealed(node.from)) {
            // Include the following space so hidden "# " doesn't indent.
            const to =
              state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            deco.push(hideMark.range(node.from, to));
          }
          return undefined;
        }
        case "EmphasisMark":
        case "StrikethroughMark": {
          if (!lineRevealed(node.from)) deco.push(hideMark.range(node.from, node.to));
          return undefined;
        }
        case "InlineCode": {
          // Reveal-independent, exactly like the fence line styling: the chip
          // must not blink off when the cursor enters the line. Background and
          // inline padding only — neither changes the line box height.
          deco.push(inlineCodeMark.range(node.from, node.to));
          return undefined;
        }
        case "CodeMark": {
          const parent = node.node.parent;
          if (parent?.name === "InlineCode" && !lineRevealed(node.from)) {
            deco.push(hideMark.range(node.from, node.to));
          }
          return undefined;
        }
        case "LinkMark":
        case "URL": {
          const parent = node.node.parent;
          if (parent?.name === "Link" && !lineRevealed(node.from)) {
            deco.push(hideMark.range(node.from, node.to));
          }
          return undefined;
        }
        case "TaskMarker": {
          if (!lineRevealed(node.from)) {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            deco.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked, node.from, node.to),
              }).range(node.from, node.to),
            );
          }
          return undefined;
        }
        default:
          return undefined;
      }
    },
  });

  return Decoration.set(deco, true);
}

// --- drag freeze ---------------------------------------------------------------
const setDragging = StateEffect.define<boolean>();
const draggingField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setDragging)) return e.value;
    return v;
  },
});
/** Forces a rebuild from outside the doc/selection path (see parseWatcher). */
const rebuildPreview = StateEffect.define<null>();

/** Background parsing finishes in its own transactions, which carry neither a
 *  doc change nor a selection — so a set built from a partial tree would stay
 *  partial until the next keystroke. Watch for the tree completing and ask for
 *  one rebuild. */
const parseWatcher = ViewPlugin.define((view) => {
  let complete = syntaxTreeAvailable(view.state, view.state.doc.length);
  let alive = true;
  return {
    update(u: ViewUpdate) {
      const now = syntaxTreeAvailable(u.state, u.state.doc.length);
      const grew = now && !complete;
      complete = now;
      // Dispatching inside update() is illegal; hop out of the update cycle.
      if (grew) queueMicrotask(() => {
        if (alive) view.dispatch({ effects: rebuildPreview.of(null) });
      });
    },
    destroy() {
      alive = false;
    },
  };
});

const dragFreeze = ViewPlugin.define((view) => {
  const down = () => view.dispatch({ effects: setDragging.of(true) });
  const up = () =>
    setTimeout(() => view.dispatch({ effects: setDragging.of(false) }), 100);
  view.dom.addEventListener("pointerdown", down, { capture: true });
  window.addEventListener("pointerup", up);
  return {
    destroy() {
      view.dom.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointerup", up);
    },
  };
});

// --- link opening ----------------------------------------------------------------

function insideLink(n: { name: string; parent: unknown } | null): boolean {
  let cur = n as { name: string; parent: typeof cur | null } | null;
  while (cur) {
    if (cur.name === "Link" || cur.name === "URL" || cur.name === "Autolink") return true;
    cur = cur.parent;
  }
  return false;
}

/** URL of the Link/Autolink containing pos, or null. Pure — tested headless.
 *  Boundary-tolerant: a click on the very edge of a rendered link lands on
 *  the hidden `[` marker (zero visual width), where side-0 resolution finds
 *  nothing — try both sides before giving up. */
export function linkUrlAt(state: EditorState, pos: number): string | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 200);
  if (!tree) return null;
  let n = tree.resolveInner(pos, 1);
  if (!insideLink(n)) n = tree.resolveInner(pos, -1);
  if (!insideLink(n)) n = tree.resolveInner(pos, 0);
  while (n.parent && n.name !== "Link" && n.name !== "URL" && n.name !== "Autolink") {
    n = n.parent;
  }
  if (n.name === "Autolink") return state.doc.sliceString(n.from + 1, n.to - 1);
  // (helper used above)

  const scope = n.name === "URL" ? (n.parent ?? n) : n;
  const urlNode = scope.name === "URL" ? scope : scope.getChild("URL");
  if (urlNode) return state.doc.sliceString(urlNode.from, urlNode.to);
  // Reference-style link [text][label] / collapsed [label]: resolve the label
  // against the document's LinkReference definitions. (lezer, by design, does
  // not validate references — see CLAUDE.md.)
  if (scope.name !== "Link") return null;
  const labels = scope.getChildren("LinkLabel");
  const label = labels.length
    ? state.doc.sliceString(labels[labels.length - 1].from + 1, labels[labels.length - 1].to - 1)
    : (() => {
        const marks = scope.getChildren("LinkMark");
        return marks.length >= 2
          ? state.doc.sliceString(marks[0].to, marks[1].from)
          : null;
      })();
  if (!label) return null;
  const refTree = ensureSyntaxTree(state, state.doc.length, 200);
  let found: string | null = null;
  refTree?.iterate({
    enter(node) {
      if (found || node.name !== "LinkReference") return found ? false : undefined;
      const lab = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (lab && url) {
        const labText = state.doc.sliceString(lab.from + 1, lab.to - 1);
        if (labText.toLowerCase() === label.toLowerCase()) {
          found = state.doc.sliceString(url.from, url.to);
        }
      }
      return undefined;
    },
  });
  return found;
}


// --- the extension ---------------------------------------------------------------
export function livePreview() {
  const field = StateField.define<DecorationSet>({
    create: buildDecorations,
    update(deco, tr) {
      if (tr.state.field(draggingField)) return deco.map(tr.changes);
      // Thawing after a drag: that transaction carries no doc change and no
      // selection, so without this the set stays frozen at its drag-start
      // shape — a table the cursor now sits in keeps rendering as a widget
      // until the next keystroke.
      //
      // `false` is load-bearing: a reconfiguring transaction (⌘E) runs update()
      // on the field it just created, against a startState that never had the
      // drag flag. The required form throws there.
      if (tr.startState.field(draggingField, false)) return buildDecorations(tr.state);
      for (const e of tr.effects) if (e.is(rebuildPreview)) return buildDecorations(tr.state);
      if (tr.docChanged) return buildDecorations(tr.state);
      if (tr.selection) {
        // Rebuild only when the revealed-line set actually changed.
        if (setsEqual(revealedLines(tr.startState), revealedLines(tr.state))) {
          return deco.map(tr.changes);
        }
        return buildDecorations(tr.state);
      }
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [draggingField, dragFreeze, parseWatcher, field];
}
