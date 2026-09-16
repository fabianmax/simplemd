import { EditorView } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { findPanel } from "../find-ui";
import { keymap } from "@codemirror/view";
import { livePreview } from "./live-preview/decorations";
import { diffField } from "./diff-decorations";
import { markdownHighlight } from "./highlight";

/** Live-preview extensions live in a compartment so ⌘E can swap them out. */
export const previewCompartment = new Compartment();

export interface EditorOptions {
  preview?: boolean;
}

export function previewExtension(): Extension {
  return livePreview();
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
      // Find runs over the BUFFER, which is the document — so it matches
      // markdown syntax too, and a hit inside a rendered table reveals that
      // line like any other cursor move.
      search({ top: true, createPanel: findPanel }),
      // ⌘F/⌘G are also native menu items, and AppKit eats a matched equivalent
      // before the webview sees it — these bindings are what serves the panel
      // itself (Escape to close, Enter to step).
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      previewCompartment.of(preview ? previewExtension() : []),
      ...extra,
    ],
  });
}

export function createEditor(parent: HTMLElement, doc = ""): EditorView {
  return new EditorView({ state: createEditorState(doc), parent });
}
