/**
 * SPIKE (throwaway): minimal live-preview CM6 extension, built strictly to the
 * researched rules so the stress numbers reflect the real v1 design:
 *   - per-LINE source reveal (never per-block)
 *   - Decoration.replace({widget}) for fences/tables — never atomicRanges
 *   - marker hiding via CSS class (font-size 0.01em) — never display:none
 *   - rebuilds frozen during drag-selection (capture-phase pointerdown)
 *   - ensureSyntaxTree for full-doc coverage (lang-markdown parses lazily;
 *     plain syntaxTree() silently stops decorating where parsing stopped)
 */
import { EditorState, StateField, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType, ViewPlugin } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false });

export type SpikeMode = "widgets" | "in-place";

// --- per-line reveal predicate ------------------------------------------------
export function revealedLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).number;
    const to = state.doc.lineAt(r.to).number;
    for (let l = from; l <= to; l++) lines.add(l);
  }
  return lines;
}

// --- widgets -------------------------------------------------------------------
class CodeBlockWidget extends WidgetType {
  constructor(readonly code: string, readonly lang: string) { super(); }
  eq(o: CodeBlockWidget) { return o.code === this.code && o.lang === this.lang; }
  toDOM() {
    const pre = document.createElement("pre");
    pre.className = "sp-fence";
    pre.textContent = this.code;
    return pre;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly src: string) { super(); }
  eq(o: TableWidget) { return o.src === this.src; }
  toDOM() {
    const div = document.createElement("div");
    div.className = "sp-table";
    div.innerHTML = md.render(this.src); // spike only; prod sanitizes
    return div;
  }
}

// --- drag freeze -----------------------------------------------------------------
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
  const up = () => setTimeout(() => view.dispatch({ effects: setDragging.of(false) }), 100);
  view.dom.addEventListener("pointerdown", down, { capture: true });
  window.addEventListener("pointerup", up);
  return {
    destroy() {
      view.dom.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointerup", up);
    },
  };
});

// --- decoration builder ----------------------------------------------------------
export let lastBuildMs = 0; // exposed for the measurement harness

export function buildDecorations(state: EditorState, mode: SpikeMode): DecorationSet {
  const t0 = performance.now();
  const revealed = revealedLines(state);
  const builder = new RangeSetBuilder<Decoration>();
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  const lineDeco = Decoration.line({ class: "sp-hide-markers" });
  if (!tree) return builder.finish();

  tree.iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "Table") {
        const startLine = state.doc.lineAt(node.from).number;
        const endLine = state.doc.lineAt(node.to).number;
        let touched = false;
        for (let l = startLine; l <= endLine; l++) if (revealed.has(l)) { touched = true; break; }
        if (touched || mode === "in-place") return false;
        const src = state.doc.sliceString(node.from, node.to);
        const widget =
          node.name === "FencedCode"
            ? new CodeBlockWidget(src.match(/^```\w*\n?([\s\S]*?)\n?```$/)?.[1] ?? src, "")
            : new TableWidget(src);
        builder.add(node.from, node.to, Decoration.replace({ widget, block: true }));
        return false;
      }
      if (node.name.startsWith("ATXHeading")) {
        const line = state.doc.lineAt(node.from);
        if (!revealed.has(line.number)) builder.add(line.from, line.from, lineDeco);
        return false;
      }
      return undefined;
    },
  });
  const set = builder.finish();
  lastBuildMs = performance.now() - t0;
  return set;
}

export function livePreview(mode: SpikeMode) {
  const field = StateField.define<DecorationSet>({
    create: (s) => buildDecorations(s, mode),
    update(deco, tr) {
      if (tr.state.field(draggingField)) return deco.map(tr.changes);
      if (!tr.docChanged && !tr.selection) return deco.map(tr.changes);
      return buildDecorations(tr.state, mode);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [draggingField, dragFreeze, field];
}
