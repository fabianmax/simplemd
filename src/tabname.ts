/** Tab labels. Agent files are named by convention — plan.md, README.md,
 *  notes.md — so three tabs reading the same word is the normal case, not the
 *  edge case (#8).
 *
 *  Pure over the list of paths: a name that is unique shows alone, a colliding
 *  one gets the shortest tail of directory segments that tells it apart. */
export interface TabLabel {
  name: string;
  /** Directory tail shown after the name, "" when the name stands alone. */
  hint: string;
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Directory segments of a path, innermost last. */
function dirSegments(path: string): string[] {
  return path.split("/").slice(0, -1).filter(Boolean);
}

function tail(segments: string[], k: number): string {
  return segments.slice(Math.max(0, segments.length - k)).join("/");
}

export function tabLabels(paths: (string | null)[]): TabLabel[] {
  const labels: TabLabel[] = paths.map((p) => ({
    name: p ? baseName(p) : "Untitled",
    hint: "",
  }));

  const groups = new Map<string, number[]>();
  labels.forEach((l, i) => {
    // Untitled tabs have no path to disambiguate with, so they never group.
    if (paths[i] === null) return;
    const g = groups.get(l.name);
    if (g) g.push(i);
    else groups.set(l.name, [i]);
  });

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const segs = members.map((i) => dirSegments(paths[i] as string));
    const depth = Math.max(...segs.map((s) => s.length));
    for (let k = 1; k <= Math.max(depth, 1); k++) {
      const hints = segs.map((s) => tail(s, k));
      // Stop at the first depth that tells every member apart; at full depth
      // stop regardless — two identical paths are the same file, and openPath
      // never opens one twice.
      if (new Set(hints).size === hints.length || k === depth) {
        members.forEach((idx, n) => (labels[idx].hint = hints[n]));
        break;
      }
    }
  }
  return labels;
}
