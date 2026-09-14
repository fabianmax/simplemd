/** Markdown syntax styling — applied in BOTH preview and raw modes so line
 *  heights and fonts never change when markers reveal (stability rule). */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const style = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.55em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.18em", fontWeight: "600" },
  { tag: t.heading4, fontSize: "1.05em", fontWeight: "600" },
  { tag: t.heading5, fontWeight: "600" },
  { tag: t.heading6, fontWeight: "600", color: "var(--fg-dim)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--fg-dim)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.95em" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--fg-dim)" },
  { tag: t.quote, color: "var(--fg-dim)", fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--fg-dim)" },
  { tag: t.meta, color: "var(--fg-dim)" },
  { tag: t.contentSeparator, color: "var(--fg-dim)" },
  { tag: t.list, color: "var(--accent)" },
  // inside fenced code (nested languages)
  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: t.string, color: "var(--syn-string)" },
  { tag: t.comment, color: "var(--fg-dim)", fontStyle: "italic" },
  { tag: t.number, color: "var(--syn-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-fn)" },
  { tag: t.typeName, color: "var(--syn-type)" },
]);

export const markdownHighlight = syntaxHighlighting(style);
