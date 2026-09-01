# simplemd

A deliberately small macOS Markdown viewer/editor for working alongside coding
agents.

## Why

Coding agents (Claude Code, Codex, Warp CLIs) dump their thinking onto disk as
Markdown: plans, specs, task lists, reviews. Reading and correcting those files
is the worst part of the loop — existing editors steal focus when the file
changes, demand vaults and projects, or silently reformat the document.
simplemd does one thing:

> An agent writes a plan → you read it rendered → you fix the two wrong
> assumptions in place → the agent picks it up.

## What it does

- **Live preview** — rendered Markdown you edit directly; the line under the
  cursor reveals its raw source. `⌘E` for full raw view. Fenced code stays
  editable in place with syntax highlighting.
- **Agent-aware reloading** — external writes appear silently: no modal, no
  focus steal, cursor and scroll preserved. Agents write atomically
  (temp + rename); the watcher is built for exactly that.
- **"Since you last looked"** — when a file changes under you, the words that
  changed are highlighted against the version you last saw (not the last save,
  not a git commit), with scroll-to-first-change and a change-count pill.
- **Never loses an edit** — if a file changes while you have unsaved edits, a
  non-modal bar offers *Keep mine / Take theirs*, and a recovery copy is
  written before you choose.
- **Byte-faithful** — the buffer is the source text; rendering is view-only
  decoration. Open + save is byte-for-byte identical, always. Your diffs stay
  clean.
- Tabs, `⌘P` fuzzy quick-switch, a file browser (`⇧⌘B`) that is a browser and
  not a vault, formatting hotkeys (`⌘B`/`⌘I`/`⌘K`, `⌘1–6`), dark mode.

## What it refuses to be

No vault. No project setup. No plugins. No git client. No AI chat window.
Open a file, edit, save — that is the whole onboarding. See `CLAUDE.md` for
the full non-goals list; it is load-bearing.

## Install

Unsigned local builds for now (signing/notarization/Homebrew cask planned).

```sh
git clone <this repo> && cd simplemd
npm install
npm run tauri build
# → src-tauri/target/release/bundle/macos/simplemd.app
```

Open files from the terminal:

```sh
open -a simplemd path/to/plan.md
```

`.md`/`.markdown` are registered file associations — Finder double-click and
"Open With" work once the app has been launched once.

## Keys

| Key | Action |
|---|---|
| `⌘O` / `⌘T` | open file / new tab |
| `⌘P` | quick-switch (open tabs + recents) |
| `⌘W` | close tab |
| `⌘S` | save (atomic) |
| `⌘E` | toggle live preview ⇄ raw source |
| `⇧⌘B` | toggle file browser |
| `⌘B` `⌘I` `⌘K` | bold · italic · link |
| `⌘1–6`, `⌘0` | heading level · paragraph |

## Development

Tauri v2 + vanilla TypeScript + CodeMirror 6 + markdown-it. Built agent-first:
most of the code is written by coding agents, so everything important is
verifiable headlessly — editor logic and the byte-identity invariant in vitest,
the watcher against real atomic writes in `cargo test`.

```sh
npm run tauri dev   # run
npm test            # frontend tests (vitest)
cargo test          # watcher/save tests (in src-tauri/)
```

Architecture decisions and their evidence live in `CLAUDE.md` and
`docs/research/` — including the measured spike data behind the editor-core
choice.
