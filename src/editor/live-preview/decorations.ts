/** Live-preview decoration layer. Rules earned from research + spike:
 *  - buffer is source text; ALL of this is view-only decoration
 *  - per-line reveal; marker hiding via CSS class, never display:none
 *  - never atomicRanges
 *  - constant (reveal-independent) line styling for fences/quotes so line
 *    heights never change with cursor position
 *  - rebuilds frozen during drag-selection (capture-phase pointerdown)
 */
import { EditorState, StateField, StateEffect, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { revealedLines, setsEqual } from "./reveal";
import { TableWidget, CheckboxWidget } from "./widgets";

const hideMark = Decoration.mark({ class: "lp-hidden" });
const fenceLine = Decoration.line({ class: "lp-fence-line" });
const codeLine = Decoration.line({ class: "lp-code-line" });
const quoteLine = Decoration.line({ class: "lp-quote-line" });

const PARSE_BUDGET_MS = 5000;

export function buildDecorations(state: EditorState): DecorationSet {
  const revealed = revealedLines(state);
  const deco: Range<Decoration>[] = [];
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS);
  if (!tree) return Decoration.none;

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
                widget: new TableWidget(state.doc.sliceString(node.from, node.to)),
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
function linkClickHandler(openLink: (url: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      // Plain click follows a RENDERED link (chrome hidden). Once the line is
      // revealed (cursor on it), plain clicks edit; ⌘-click always follows.
      if (!e.metaKey) {
        const line = view.state.doc.lineAt(pos).number;
        if (revealedLines(view.state).has(line)) return false;
      }
      const tree = ensureSyntaxTree(view.state, pos, 50);
      if (!tree) return false;
      let n = tree.resolveInner(pos, 0);
      while (n.parent && n.name !== "Link" && n.name !== "URL" && n.name !== "Autolink") {
        n = n.parent;
      }
      const scope = n.name === "URL" ? n.parent ?? n : n;
      const urlNode =
        scope.name === "URL" ? scope : scope.getChild?.("URL") ?? null;
      if (!urlNode) return false;
      openLink(view.state.doc.sliceString(urlNode.from, urlNode.to));
      e.preventDefault();
      return true;
    },
  });
}

// --- the extension ---------------------------------------------------------------
export function livePreview(openLink: (url: string) => void = () => {}) {
  const field = StateField.define<DecorationSet>({
    create: buildDecorations,
    update(deco, tr) {
      if (tr.state.field(draggingField)) return deco.map(tr.changes);
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
  return [draggingField, dragFreeze, field, linkClickHandler(openLink)];
}
