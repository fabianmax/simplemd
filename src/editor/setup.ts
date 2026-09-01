import { EditorView } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

/** Build the editor state separately from the view so tests can run headless in Node.
 *  NOTE: ⌘O/⌘S/⌘W/⌘E are owned by the native menu — never bind them here. */
export function createEditorState(doc: string, extra: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      ...extra,
    ],
  });
}

export function createEditor(parent: HTMLElement, doc = ""): EditorView {
  return new EditorView({ state: createEditorState(doc), parent });
}
