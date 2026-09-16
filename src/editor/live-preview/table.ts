/** Mapping a rendered table cell back to its source offset.
 *
 *  The rendered table is a block widget, so a click inside it has to be
 *  translated by hand — without this, clicking a table does nothing at all and
 *  the source never reveals (#2). Pure and line-based: GFM cells cannot contain
 *  a newline, so row N of the rendered table is one source line. */

/** Cell boundaries of one table row, as [start, end] offsets into `line`.
 *  Pipes inside inline code or escaped with a backslash do not split a cell —
 *  the same two exceptions GFM makes. */
export function splitRow(line: string): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  let start = 0;
  let code = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "`") code = !code;
    else if (c === "|" && !code) {
      cells.push([start, i]);
      start = i + 1;
    }
  }
  cells.push([start, line.length]);
  // A leading pipe opens the row rather than an empty first cell; a trailing
  // one closes it. Both are optional in GFM, hence the emptiness test.
  if (cells.length > 1 && line.slice(0, cells[0][1]).trim() === "") cells.shift();
  if (cells.length > 1 && line.slice(cells[cells.length - 1][0]).trim() === "") cells.pop();
  return cells;
}

/** Document offset of the text in rendered cell (row, col), where row 0 is the
 *  header. `from` is the table node's start. Out-of-range coordinates clamp
 *  rather than fail: the caller is a mouse event, not a parser. */
export function cellPos(src: string, from: number, row: number, col: number): number {
  const lines = src.split("\n");
  // Source line 1 is the delimiter row — it renders as nothing, so every body
  // row is one line further down than its rendered index.
  const target = Math.min(row === 0 ? 0 : row + 1, lines.length - 1);
  let offset = from;
  for (let i = 0; i < target; i++) offset += lines[i].length + 1;
  const line = lines[target];
  const cells = splitRow(line);
  if (!cells.length) return offset;
  const [cellStart, cellEnd] = cells[Math.min(col, cells.length - 1)];
  // Land on the text, not on the padding space after the pipe.
  const text = line.slice(cellStart, cellEnd);
  return offset + cellStart + (text.length - text.trimStart().length);
}
