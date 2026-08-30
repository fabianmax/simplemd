import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

/** Build the editor state separately from the view so tests can run headless in Node. */
export function createEditorState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown(), history(), keymap.of([...defaultKeymap, ...historyKeymap])],
  });
}

export function createEditor(parent: HTMLElement, doc = ""): EditorView {
  return new EditorView({ state: createEditorState(doc), parent });
}
