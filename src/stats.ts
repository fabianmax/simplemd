/** Document stats for the status bar. Token count is the standard ~4 chars/
 *  token heuristic — an estimate for agent-budget intuition, not a tokenizer. */
export function docStats(text: string): { words: number; tokens: number } {
  const words = text.split(/\s+/).filter(Boolean).length;
  return { words, tokens: Math.ceil(text.length / 4) };
}

export function formatStats(s: { words: number; tokens: number }): string {
  const n = (x: number) => x.toLocaleString("en-US");
  return `${n(s.words)} words · ~${n(s.tokens)} tokens`;
}
