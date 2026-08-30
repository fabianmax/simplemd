/**
 * Generates synthetic agent-plan-shaped markdown corpora for the M1 stress spike.
 * Shape target (per CLAUDE.md research): ~30% fenced code lines, tables, task
 * lists, headings — at 50k lines this yields >=1,000 fenced blocks.
 *
 * Usage: npx tsx spike/gen-corpus.ts   (writes spike/corpus-{1k,10k,50k}.md)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Deterministic PRNG so corpora are reproducible across runs/machines.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = "plan review agent step verify watcher buffer render decoration state file reload diff spec task module editor viewport widget".split(" ");

function generate(targetLines: number, seed = 42): { text: string; fences: number } {
  const rnd = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const sentence = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const out: string[] = [];
  let fences = 0;
  let section = 0;

  while (out.length < targetLines) {
    const r = rnd();
    if (r < 0.08) {
      out.push("", `## Section ${++section}: ${sentence(3)}`, "");
    } else if (r < 0.38) {
      // fenced code block, 4-16 lines — the block-replace widget stressor
      fences++;
      const lang = pick(["ts", "rust", "sh", "json"]);
      out.push("```" + lang);
      const n = 4 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) out.push(`const v${i} = ${Math.floor(rnd() * 1e6)}; // ${sentence(3)}`);
      out.push("```", "");
    } else if (r < 0.48) {
      // table, 3-8 rows
      out.push("| step | owner | status |", "|---|---|---|");
      const n = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) out.push(`| ${sentence(2)} | agent | ${pick(["done", "open", "blocked"])} |`);
      out.push("");
    } else if (r < 0.62) {
      // task list
      const n = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) out.push(`- [${rnd() < 0.5 ? " " : "x"}] ${sentence(5)}`);
      out.push("");
    } else {
      // prose with inline formatting
      out.push(`${sentence(6)} **${pick(WORDS)}** ${sentence(4)} \`${pick(WORDS)}\` ${sentence(5)}.`, "");
    }
  }
  return { text: out.slice(0, targetLines).join("\n") + "\n", fences };
}

for (const [name, lines] of [["1k", 1_000], ["10k", 10_000], ["50k", 50_000]] as const) {
  const { text, fences } = generate(lines);
  const path = join(import.meta.dirname, `corpus-${name}.md`);
  writeFileSync(path, text);
  console.log(`${path}: ${lines} lines, ${fences} fenced blocks, ${(text.length / 1024).toFixed(0)} KB`);
}
