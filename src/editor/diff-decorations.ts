/** View-only decorations for the "since I last looked" diff. Ranges arrive
 *  via effect (computed outside); user edits map them; clear removes all. */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { DiffResult } from "../diff";

export const setDiff = StateEffect.define<DiffResult>();
export const clearDiff = StateEffect.define<null>();

const addedMark = Decoration.mark({ class: "lp-diff-added" });

class RemovedWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: RemovedWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "lp-diff-removed";
    const t = this.text.trim();
    s.textContent = t.length > 60 ? t.slice(0, 57) + "…" : t;
    s.title = `removed: ${this.text}`;
    return s;
  }
}

export const diffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearDiff)) return Decoration.none;
      if (e.is(setDiff)) {
        const d = e.value;
        const docLen = tr.state.doc.length;
        const ranges = [
          ...d.added
            .filter((a) => a.from < a.to && a.to <= docLen)
            .map((a) => addedMark.range(a.from, a.to)),
          ...d.removed
            .filter((r) => r.pos <= docLen && r.text.trim().length > 0)
            .map((r) => Decoration.widget({ widget: new RemovedWidget(r.text), side: -1 }).range(r.pos)),
        ];
        return Decoration.set(ranges, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
