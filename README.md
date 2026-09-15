<div align="center">

<img src="assets/icon.svg" width="112" height="112" alt="">

# simplemd

**A deliberately small macOS Markdown viewer/editor for working alongside coding agents.**

macOS 11+ · Apple Silicon · MIT

</div>

## Why

Coding agents (Claude Code, Codex, Warp CLIs) dump their thinking onto disk as
Markdown: plans, specs, task lists, reviews. Reading and correcting those files
is the worst part of the loop — existing editors steal focus when the file
changes, demand vaults and projects, or silently reformat the document.
simplemd does one thing:

> An agent writes a plan → you read it rendered → you fix the two wrong
> assumptions in place → the agent picks it up.

Every feature below earns its place against that loop, or it does not ship.

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
- **Built for code-adjacent documents** — fenced code, tables and task lists
  are first-class. These are specs, not essays.
- **Review context without the ceremony** — current git branch in the status
  bar and change markers in the file browser, read-only. Committing is not
  simplemd's job.
- **Navigation** — tabs, `⌘P` fuzzy quick-switch, a file browser (`⇧⌘B`) that
  is a browser and not a vault, an outline panel (`⇧⌘O`), reader-controlled
  text size, and dark mode that follows the system.

## What it refuses to be

No vault. No project setup. No plugins. No git client. No AI chat window.
Open a file, edit, save — that is the whole onboarding. See [`CLAUDE.md`](CLAUDE.md)
for the full non-goals list; it is load-bearing.

## Install

> **Unsigned.** Signing and notarization are wired up but have never been
> executed — that needs an Apple Developer ID this project does not have. macOS
> will treat the app as unidentified: right-click → Open the first time, or
> clear the quarantine flag with
> `xattr -d com.apple.quarantine /Applications/simplemd.app`.

```sh
git clone https://github.com/fabianmax/simplemd && cd simplemd
npm install
CI=true npm run tauri build
# → src-tauri/target/release/bundle/macos/simplemd.app
# → src-tauri/target/release/bundle/dmg/simplemd_<version>_aarch64.dmg
```

`CI=true` skips the DMG bundler's AppleScript window-styling step, which
otherwise needs Finder automation permission. Drop it if you have granted that
and want the styled window.

### From the terminal

The CLI ships inside the bundle — notarization cannot staple a standalone
binary. Symlink it onto your `PATH`:

```sh
ln -s /Applications/simplemd.app/Contents/Helpers/simplemd /usr/local/bin/simplemd
simplemd path/to/plan.md
```

It opens in the already-running instance, in a new tab. `open -a simplemd
path/to/plan.md` does the same without the symlink — the CLI routes through
Launch Services either way, because command-line arguments grant no file access
under sandboxing and a document-open does.

`.md`/`.markdown` are registered file associations, so Finder double-click and
"Open With" work once the app has been launched once.

## Keys

| Key | Action |
|---|---|
| `⌘O` · `⌘T` · `⌘W` | open file · new tab · close tab |
| `⌘S` | save (atomic) |
| `⌘P` | quick-switch (open tabs + recents) |
| `⌘E` | toggle live preview ⇄ raw source |
| `⇧⌘B` · `⇧⌘O` | toggle file browser · outline |
| `⌘=` · `⌘-` | text size up · down |
| `⌘B` · `⌘I` · `⌘K` · `⇧⌘C` | bold · italic · link · inline code |
| `⌘1`–`⌘6` · `⌘0` | heading level · paragraph |

Lists, task lists, code fences and tables live in the Format menu without
bindings. Every binding carries a modifier — bare letters are impossible in an
editor.

## Development

Tauri v2 + vanilla TypeScript + CodeMirror 6 + markdown-it.

```sh
npm run tauri dev   # run
npm test            # frontend tests (vitest)
cd src-tauri && cargo test   # watcher, save and git tests
```

Built agent-first: most of the code is written by coding agents, so everything
important is verifiable headlessly. Editor logic and the byte-identity
invariant run in vitest; the watcher is tested against real atomic writes in
`cargo test`. A change is not done until an agent can prove it works without a
human looking at a screen.

Architecture decisions and the evidence behind them live in
[`CLAUDE.md`](CLAUDE.md), [`docs/decisions/`](docs/decisions/) and
[`docs/research/`](docs/research/) — including the measured spike data behind
the editor-core choice and why the whole block-editor family was disqualified.

## License

MIT — see [LICENSE](LICENSE).
