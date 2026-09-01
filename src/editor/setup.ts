import { EditorView } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { livePreview } from "./live-preview/decorations";
import { diffField } from "./diff-decorations";
import { markdownHighlight } from "./highlight";

/** Live-preview extensions live in a compartment so ⌘E can swap them out. */
export const previewCompartment = new Compartment();

export interface EditorOptions {
  preview?: boolean;
  openLink?: (url: string) => void;
}

export function previewExtension(openLink?: (url: string) => void): Extension {
  return livePreview(openLink);
}

/** Build the editor state separately from the view so tests can run headless in Node.
 *  NOTE: ⌘O/⌘S/⌘W/⌘E are owned by the native menu — never bind them here. */
export function createEditorState(
  doc: string,
  extra: Extension[] = [],
  opts: EditorOptions = {},
): EditorState {
  const preview = opts.preview ?? true;
  return EditorState.create({
    doc,
    extensions: [
      // markdownLanguage = commonmark + GFM (tables, task lists, strikethrough).
      // The default base is commonmark-only — GFM must be explicit.
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      markdownHighlight,
      diffField,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      previewCompartment.of(preview ? previewExtension(opts.openLink) : []),
      ...extra,
    ],
  });
}

export function createEditor(parent: HTMLElement, doc = ""): EditorView {
  return new EditorView({ state: createEditorState(doc), parent });
}
