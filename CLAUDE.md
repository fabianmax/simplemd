# simplemd

A deliberately small, opinionated macOS Markdown viewer/editor.

## The one job

**simplemd is the human review surface in an agent loop.**

Coding agents (Claude Code, Codex, Warp CLIs) dump their thinking onto disk as
`.md` files: plans, specs, task lists, reports, reviews. Today reading and
correcting those files is the worst part of the loop. simplemd exists to make
that one thing fast and pleasant:

> An agent writes a plan → I read it rendered → I fix the two wrong
> assumptions in place → the agent picks it up.

Everything in this repo is judged against that loop. If a feature does not make
that loop faster, it does not ship.

## Non-goals (read this before adding anything)

simplemd is **not**:

- a note-taking system, PKM, wiki, or knowledge graph
- a project/vault/workspace manager — there is no "create a project" step, ever
- a plugin platform
- a general-purpose code editor (Sublime already does that job here)
- a git client
- an AI chat window — the agents live in the terminal, simplemd only shows and
  edits their files

The failure mode of every editor evaluated below is **doing more than this**.
When in doubt, cut the feature.

## Design principles (earned from tools already tried)

| Tried | Kept | Rejected |
|---|---|---|
| **Sublime** | lean, instant, no ceremony | extension surface you must remember how to configure — simplemd ships opinionated defaults, nothing to install |
| **Typora** | elegant, seamless inline rendering | typewriter feel — simplemd is for **code-adjacent** documents: fenced code, tables, task lists must be first-class |
| **Obsidian** | live preview, tabs, quick switcher | vault requirement, bloat — **open a file, edit, save. That is the whole onboarding.** |
| **Codex built-in md viewer** | in-place editing, rendering, **diff when the agent edits** | buggy, no CLI, weak file navigation — simplemd must be reachable from the terminal and from Finder |

Distilled:

1. **Zero ceremony.** Launch to editable file in one step. No setup, no project.
2. **Opinionated.** One good default beats a settings pane. Config surface stays near zero.
3. **Code-centric, not prose-centric.** The documents are specs, not essays.
4. **Agent-aware.** Files change under you constantly. That is normal operation,
   not an error case.
5. **Small enough to keep.** Feature creep is the thing that killed every
   alternative.

## Core UX model

### Two modes, one document

- **View mode (default):** rendered Markdown.
- **Edit mode:** raw Markdown source.
- **The bridge:** in view mode, the block under the cursor reveals its raw
  source while everything else stays rendered. Editing never means "switch to
  the other pane" — you click and type. (Obsidian Live Preview / Typora are the
  reference implementations to study.)
- A hard toggle to full-raw view stays available for whole-file edits.

### Tabs

Multiple files open at once. Tab strip, `⌘T` new, `⌘W` close, `⌘P` quick-switch
by fuzzy name.

### File browser

A toggleable side panel rooted at the current file's directory (or a folder you
point it at). It is a browser, **not an index** — no vault, no cache, no
"add folder to workspace" modal.

### Formatting menu

Menu bar + hotkeys for the basics only: headings, bold, italic, code, code
fence, link, list, task list, table. Enough to never hand-type syntax; not a
word processor.

### Hotkeys

First-class and discoverable. All bindings carry a modifier (`⌘S`, `⌘T`, `⌘P`,
`⌘E` mode toggle, `⌘B`/`⌘I`, `⌘1..6` headings) — bare letters are impossible in
an editor. A leader-chord layer may be added later if the `⌘` space runs out.

### Dark mode

Both themes, following the system by default. Dark is the primary design target.

## Agent-integration requirements (the differentiator)

These are the requirements no existing editor got right, and the reason this
project exists.

1. **Just-in-time reload.** External writes appear immediately, without a
   "file changed on disk, reload?" modal stealing focus. Scroll position and
   cursor survive the reload.
2. **Show what the agent changed.** When a file changes underneath an open tab,
   surface the diff — at minimum a change highlight, ideally "what changed since
   I last looked at this."
3. **Never lose an edit.** Concurrent edit (me typing while an agent rewrites)
   is not the primary use case but *will* happen. It must degrade safely:
   detect, preserve both sides, never silently clobber. Data loss is the one
   unacceptable bug class.
4. **Agents write atomically.** Most tools write temp-file-then-rename. The file
   watcher must handle rename-based writes, rapid bursts, and partial writes
   without flicker or corruption.
5. **CLI entrypoint.** `simplemd path/to/plan.md` opens in the running instance,
   in a new tab. This is how files get opened in practice — agents print paths,
   and those paths must be one command (or one click) away.
6. **Finder integration.** Register as a `.md` handler; "Open With" and
   double-click must work.
7. **Git-aware, read-only.** Knowing a file is modified/untracked is useful
   review context. Committing is not simplemd's job.

## Technical constraints

- **Target:** macOS desktop app, Apple Silicon native.
- **Startup must be fast.** This is a side tool opened dozens of times a day;
  a slow launch kills the loop. (Editorio proves ~100 ms / 40 MB is achievable.)
- **Application shell: Tauri v2.** Decided 2026-08-30.

### Why Tauri v2

Chosen over Electron and a native AppKit shell for two reasons:

1. **Size and startup.** simplemd is opened dozens of times a day; Electron's
   ~150 MB bundle and cold-start cost work directly against the one job.
2. **The preview can be isolated.** Tauri can run the rendered preview in its own
   webview with `permissions: []`. This matters because the threat model is real:
   *an agent summarizes an untrusted README and it lands in a file you open.*
   `window.__TAURI_INTERNALS__.invoke` is defined unconditionally in every
   webview, so any script that executes can call any command that webview is
   permitted — the zero-permission preview webview is what makes that safe.
   Electron cannot express this boundary as cleanly.

**Accepted trade-offs, stated honestly:**

- **Tauri v2 ships no CSP by default** (`csp: Option<Csp>`, no default value).
  One must be written explicitly. This is the most commonly-missed Tauri setting.
- `RETURN_TRUSTED_TYPE` is a no-op on WKWebView (Trusted Types is Chromium-only)
  — a genuine security regression versus Electron.
- **Runtime is JavaScriptCore, not V8.** Every benchmark in `docs/research/` was
  measured in Node. Re-measure in the real webview before designing around any
  of those numbers.
- **macOS UI automation is the weak spot** — see the testing note below.

### Testing strategy (consequence of the shell choice)

The agentic-first goal requires agents to verify their own work headlessly, and
Tauri's macOS UI-automation story is its weakest area. So the testing weight goes
on layers that do not need a running app:

- **Editor logic is tested headless in Node** (vitest). CM6 state, decorations,
  the `shouldShowSource` predicate, commands and keymaps are all pure functions
  over `EditorState` — this is the bulk of the product and needs no window.
- **Markdown pipeline is tested on fixtures**, byte-for-byte, including the
  round-trip invariant: parse + decorate + copy + save must equal input exactly.
- **Watcher and conflict logic is tested in Rust** against a temp directory with
  real atomic writes (write-temp + rename), which is what agents actually do.
- **UI automation is the fallback, not the foundation.** Verify whether
  `tauri-driver` supports macOS before relying on it for anything.

If this testing story fails in practice, that is grounds to revisit the shell —
it was the deciding trade-off, not an afterthought.

## Settled technical decisions

Derived from research on 2026-08-30; evidence in `docs/research/`.

### The core invariant

> **The buffer is the source text. Rendering is view-only decoration over it.
> Nothing ever re-serializes the document.**

This is the most important technical rule in the project. Editors that parse
Markdown to a tree and serialize back **rewrite the whole file** — renumbered
lists, changed link syntax, altered fences. GitLab documented exactly this in
their WYSIWYG rollout. For simplemd that is fatal: a reformatted plan file turns
every subsequent agent diff into noise.

Consequence: **copy, save, and round-trip must be byte-for-byte identical to a
plain textarea.**

### Editor core: CodeMirror 6

The invariant above disqualifies the whole block-editor family — ProseMirror,
Tiptap, Lexical, BlockNote, Milkdown — because they all round-trip through a
document model. CM6 satisfies it natively, is the only battle-tested live-preview
implementation (Obsidian), has documented failure modes with known fixes, and its
logic is headless-testable, which this project weights heavily.

**Live-preview rules, each one earned from a documented bug:**

- **Fenced code renders in place, never as widgets** (decided from spike data,
  v1c): in-place beats widgets on both axes (sync p95 8 ms vs 13 ms at 50k
  lines; 0 px vs ~2-4k px cursor-travel height drift) and is better product —
  code stays directly editable with nested-language highlighting, matching the
  code-centric positioning. Widgets are reserved for tables (raw pipe syntax is
  unreadable). GFM requires `base: markdownLanguage` explicitly — the
  `markdown()` default is commonmark-only, silently dropping tables/task lists.
- **Reveal raw source per *line*, not per block.** A 40-line fenced block or a
  wide table is one block; revealing it wholesale is a huge visual jump. Per-line
  also kills the layout-shift bug class. Invariant to hold: *every line has a
  stable height regardless of cursor position, and lines never reflow when
  clicked into.*
- **Never use `atomicRanges`** to hide syntax — one backspace deletes an entire
  decorated span. Use `Decoration.widget` + `WidgetType`.
- **Never use `display:none`** to hide markers — it breaks cursor placement. Use
  `font-size: 0.01em` (block markers) or `max-width: 0` + opacity (inline).
- **Freeze decoration rebuilds during drag-selection** (capture-phase
  `pointerdown`, release ~100 ms after `pointerup`), or text jumps under the
  mouse mid-drag.
- **Viewport-scope syntax highlighting.** Whole-document highlighting of a
  code-heavy file costs seconds; one viewport costs <20 ms.
- ~~Expect a performance cliff around 10K+ lines~~ **Spike-verified 2026-08-30**
  (`docs/research/spike-results.md`): full live preview with block widgets and
  naive full-document rebuilds passes at 50k lines / 2,434 fences in WKWebView
  (typing sync p95 13 ms; paints within one frame at every size). Viewport
  scoping is optimization headroom, not a prerequisite. markdown-it under JSC:
  1.7 MB in 43 ms — render performance is a non-issue.

### Markdown rendering

- **markdown-it** for the preview path. **remark/unified is disqualified** —
  18-29x slower and degrading superlinearly (6.3 s on a 1.76 MB file), because
  un-disableable `position` objects blow the AST up ~17x. Keep remark for offline
  transforms only.
- Derive block boundaries from the **lezer tree**, never from blank lines —
  blank-line splitting is silently wrong (a loose list becomes three tight ones,
  reference links break). Correct splitting took a full re-render 67 ms -> 6.9 ms.
- If rendering moves to a worker, **ship HTML strings, never ASTs** — cloning a
  token array costs 4x more than re-parsing.
- **Diff the preview DOM (morphdom-style), do not virtualize it.** That preserves
  scroll, `<details>` state and already-rendered diagrams across the constant
  re-renders agent files cause. Virtualizing breaks find-in-page and anchors.
- Sanitize with a **string-in/string-out** call and no hooks; port a GitHub-shaped
  allow-list rather than trusting a general-purpose default.

### File watching (requirement #1, and the easiest thing to get fatally wrong)

Verified: **Claude Code writes atomically** — `Edit` and `Write` both change the
inode (write-to-temp then `rename()`). No partial reads were ever observable.

Therefore:

- **Never hold a file descriptor.** A kqueue/`DispatchSource` watch binds to the
  *inode*; after the first agent write it points at an orphan and goes
  **permanently silent — no events, no error.** It passes every manual test, then
  dies in real use. This is Zed's bug.
- **Watch the parent directory**, filter by filename, re-`open()` by path, track
  identity by `(dev, inode)`.
- **`NSFilePresenter` is useless here** — Apple: it is not notified about changes
  made with low-level read/write calls, only those through a file coordinator.
  No agent, no `git`, no `sed` uses `NSFileCoordinator`.

Target algorithm: watch directory -> ~120 ms debounce -> stat, then
**hash-compare before reloading** (kills self-save echo and touch-only churn) ->
if buffer is clean, replace it and restore scroll/cursor **anchored to the
nearest heading, not a line number**, and **never activate the window** -> if
dirty, show a non-modal bar (*View diff / Keep mine / Take theirs*) and
immediately write a sidecar recovery copy.

Focus stealing is a shipped-product killer, verbatim from a Typora issue:
*"This makes working with AI agents that are modifying plan files impossible, as
the focus jumps between Typora windows."*

### Diff / review UX

- **Never line-diff prose.** Agents reflow paragraphs, so a line diff reads as
  "everything deleted, everything re-added." Use **word-level** diffing.
- **Baseline is "since I last looked", not "since last save."** Snapshot on tab
  focus-loss. No incumbent does this; Marked's baseline is the last save, which
  is the wrong reference point for an agent loop.
- **Scroll to the first change on reload.** Cheapest high-value feature found.
- **Never store review state inside the `.md` file.** iA Writer writes authorship
  metadata into the document and it leaks into every other editor. Use a sidecar
  keyed by path + hash.
- **Do not use a git commit as the baseline** — agent plans are often untracked,
  and the interesting delta is "since 30 seconds ago."

### CLI and distribution

- **The CLI must route through Launch Services**, i.e. the shape
  `open -a simplemd file.md` -> `application(_:open:)`. Command-line arguments
  grant **no** file access under sandboxing (Apple DTS is explicit), and neither
  `--args` nor a private-IPC design (Zed's) issues a sandbox extension. Marked 2
  — sandboxed, on the App Store, the closest analogue to simplemd — ships a
  five-line `open -a` shell script.
  Designing this shape now keeps sandboxing a later option instead of a rewrite.
- **The app must accept bare file paths** from Launch Services. Dropping them is
  Obsidian's fatal bug.
- **Distribution:** Developer ID + hardened runtime + notarize + staple,
  unsandboxed to start, Homebrew cask for the symlink. Notarization **cannot
  staple a standalone binary**, so the CLI lives *inside* the `.app` bundle
  (BBEdit's cask is the template).
- App Store review has historically rejected exactly this CLI feature
  (Guideline 2.3); Panic removed Transmit's "Open In Terminal" at Apple's request.

## Status (2026-09-01)

**v1.1 shipped** (on top of the v1 core loop): tabs with per-tab watches and
background-tab silent reload, ⌘P fuzzy quick-switch (open tabs + recents),
formatting menu/hotkeys (⌘B/I/K, ⌘0-6 headings, lists/task/fence/table).
**v1.2 merged**: the differentiator — "since I last looked"
word-level diff. Baseline snapshots on focus-loss (window blur / tab switch),
external reloads highlight added words + deletion carets as view-only
decorations, scroll-to-first-change, floating pill with count + ↑/↓ + dismiss
(dismiss = new baseline). Own saves reset the baseline. 69 vitest + 8 cargo.
**v1.3**: file browser (⌘⇧B) — lazy per-level listing, no index/vault.
**v1.5**: visual batch (`docs/plans/v1.5-visual-batch.md`) — code font reads as
code (Menlo stack; the 0.92em on the line was compounding with the 0.92em on
the span, because @lezer/markdown gives InlineCode and CodeText the same tag),
text scales with the window (`clamp` on `.cm-content`; the `76ch` measure
widens with it), file browser gets SVG icons, a real tree with guide rules, and
a toggle pinned to the tab strip sharing one path with ⌘⇧B.
**v1.5.1** (usage feedback): inline code renders as a chip (a decoration, not a
highlight rule — same lezer tag as fenced code), the browser is drag-resizable
with the width remembered in localStorage (guarded: unavailable storage just
means the default), and the layout moved tabs/conflict bar/pill/status into an
editor column right of the browser, so tabs no longer span the panel.
**v1.6**: reader-controlled text size. Default ramp lowered ~1.5px (13.5px at an
800px window, 16.5px at 1600px); ⌘= / ⌘- step a fixed ladder (60-200%) shown for
1.4s in a corner pill; remembered in localStorage. ⌘0 could not be the reset —
it is Paragraph in the Format menu. muda cannot express a main-row "+", so the
menu carries ⌘= and a capture-phase keydown catches ⌘+ on layouts that have that
key (AppKit consumes matched equivalents, so the two cannot double-step).
**v1.6.1**: browser toggle anchored to the window's left edge (it used to ride
in the tab strip and slide right by the panel width); raw/rendered switch as a
button at the right of the strip, lit in raw mode. `tests/app.test.ts` exists
now — mock `../src/ipc` + `@tauri-apps/api/webview` and CM6 runs under jsdom, so
App-level chrome IS headlessly testable; put App changes there from the start.
Signing/notarization/Homebrew cask deferred by user decision 2026-09-01
until a GitHub repo exists; app runs unsigned locally meanwhile.

Open polish debt: diff visuals (user: "not 100% appealing" — colors,
deletion carets, pill), app icon, DMG (needs Finder-automation permission
or the non-styled path).

## How we build this: agentic-first

This project is an experiment in **agent-first software creation**. The codebase
is written primarily by coding agents, so it is optimized for agents to work in:

- **Small, verifiable slices.** Every change ends in something runnable and
  checkable, not a half-wired refactor.
- **Tests an agent can run headlessly.** A change is not done until an agent can
  prove it works without a human looking at a screen. Stack choice is weighted
  heavily on this.
- **Decisions get written down.** Architectural choices land in this file or in
  `docs/decisions/`, because the next agent has no memory of the conversation
  that produced them.
- **The non-goals list is load-bearing.** Agents are eager. This file is the
  brake. Adding a feature means arguing against the non-goals first.
- **Read before writing.** Match the surrounding code's idiom; this codebase
  should read as if one author wrote it.
