/**
 * Line-ending handling. CM6 normalizes documents to "\n" internally, so CRLF
 * files must be detected on load and restored on save — the byte-identity
 * invariant (CLAUDE.md) must hold for them too.
 *
 * Rule: normalize ONLY when every newline in the file is CRLF. Mixed-ending
 * files pass through untouched (lone \r stays visible in the buffer), which
 * keeps them trivially byte-identical.
 */
export type Eol = "\n" | "\r\n";

export function fromDisk(raw: string): { text: string; eol: Eol } {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length;
  if (crlf > 0 && crlf === lf) {
    return { text: raw.replaceAll("\r\n", "\n"), eol: "\r\n" };
  }
  return { text: raw, eol: "\n" };
}

export function toDisk(text: string, eol: Eol): string {
  return eol === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
}
