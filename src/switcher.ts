/** ⌘P quick switcher: fuzzy-filter open tabs + recent files. Pure matching
 *  logic here (headless-testable); DOM overlay in switcher-ui.ts. */

export interface SwitchItem {
  path: string;
  /** open tab index, or -1 for a recent file */
  tabIndex: number;
}

/** Subsequence fuzzy match on the file NAME (path as tiebreak), scored:
 *  contiguous runs and prefix hits rank higher; shorter names win ties. */
export function fuzzyScore(query: string, candidate: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      streak++;
      score += streak * 2 + (ci === 0 ? 8 : 0);
      qi++;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return null;
  return score - c.length * 0.01;
}

export function rankItems(items: SwitchItem[], query: string): SwitchItem[] {
  const name = (p: string) => p.split("/").pop() ?? p;
  return items
    .map((item) => {
      const s = fuzzyScore(query, name(item.path)) ?? fuzzyScore(query, item.path);
      return s == null ? null : { item, s: s + (item.tabIndex >= 0 ? 4 : 0) };
    })
    .filter((x): x is { item: SwitchItem; s: number } => x !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}
