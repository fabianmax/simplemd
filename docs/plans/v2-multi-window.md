# v2 — multi-window and tab dragging

Two asks: `⌘N` opens a new window, and tabs can be dragged — within the strip to
reorder, out of it to open in their own window.

The second is the easy half. The first breaks three pieces of global state that
were correct only because there had never been more than one window.

## What breaks the moment a second window exists

Found by reading, before writing anything:

1. **Menu events are broadcast** (`menu.rs:188`, `app.emit("menu", …)`). Every
   window receives every menu command: one `⌘S` saves in all of them, `⌘W`
   closes a tab in each, `⌘E` toggles them all. This is the headline bug.
   Fix: emit to `get_focused_window()`, falling back to a broadcast when no
   window has focus.
2. **The watch registry is keyed by path alone** (`commands.rs:164`), and
   `watch_file` returns early when a path is already watched (`:179`). Two
   windows on the same file share one watcher — and the first `unwatch_file`
   (`:196`) drops it, leaving the other window **silently blind**. That is
   exactly the failure mode CLAUDE.md builds the whole watcher design around, so
   it cannot ship this way. Fix: refcount owners by window label; drop the
   watcher when the last owner lets go, and when a window is destroyed.
3. **`devtools` targets the hardcoded label `"main"`** (`menu.rs:183`).
   Fix: the focused window.

`file-changed` is *already* right: a broadcast is what we want, since every
window holding that path should reload, and each frontend ignores paths it does
not have open. `PendingOpen` stays global — first drainer wins — but the
`open-request` nudge follows the menu rule and goes to the focused window, so
which window a Finder open lands in is deterministic.

## Slice 1 — a second window

- Rust `new_window(handoff: Option<Handoff>) -> String`: unique label
  (`win-<counter>`), `WebviewWindowBuilder` on `index.html`, cascaded 28px from
  the focused window so it does not land exactly on top. Returns the label.
- File ▸ **New Window**, `⌘N`. (`⌘T` stays New Tab.)
- Menu routing, watch refcounting and the devtools fix from above.
- `WindowEvent::Destroyed` releases that window's watches.

Each window runs its own frontend instance, so `App`, its tabs and its
`EditorView` are already per-window with no change. Recents stay app-global.

**`⌘W` keeps closing the tab, not the window** — that is the existing behaviour
and the empty state is a reasonable resting place. Revisit only if it annoys.

## Slice 2 — reorder within the strip

Pure, and therefore tested headlessly:

- `reorder(list, from, to)` — the move itself.
- `activeAfterMove(active, from, to)` — the active tab must stay the *same tab*,
  not the same index. This is the part that silently breaks.
- `dropIndex(midpoints, x)` — which gap the pointer is over.

DOM: `mousedown` on a tab arms a drag; movement past the 4px threshold the link
handler already uses starts it (below that it is still a click, so switching
tabs by clicking must keep working). While dragging, a 2px accent insertion
marker sits in the target gap — the tabs themselves do not move, which avoids
layout thrash mid-drag and keeps the hit-testing honest.

## Slice 3 — tear off into a new window

On drop, tear off when the pointer is **outside the window** or **≥80px below
the strip** — deliberate enough not to fire on a sloppy drop, and reachable even
when the window is full-screen (where there is no "outside").

**The handoff must carry the buffer, not the path.** Re-reading from disk in the
new window would discard unsaved edits, and losing an edit is the one
unacceptable bug class in this project. So:

- Rust holds `PendingHandoff: HashMap<window label, Handoff>`, where
  `Handoff { path: Option<String>, text: String, dirty: bool }`.
- The torn-off tab closes in the source window *after* `new_window` returns, so
  a failure to build the window leaves the tab where it was.
- The new window drains with `take_handoff(window)` — Tauri injects the calling
  window, so a window can only ever take its own — and opens the tab with that
  exact text, restoring the dirty flag.
- An untitled tab tears off as an untitled tab (`path: None`).

The new window is positioned at the drop point (`window.screenX + clientX`), so
it appears where it was dropped.

## Tests

Rust:
- two windows watching one path; one unwatches → the other still receives
- last owner unwatches → the watcher is dropped
- a destroyed window releases only its own watches
- handoff is take-once, and scoped to the window that stored it

Vitest (pure): `reorder`, `activeAfterMove`, `dropIndex`, `shouldTearOff`.

Vitest (jsdom, `app.test.ts`): a drag past the threshold reorders and keeps the
same tab active; a 2px twitch still counts as a click and switches tabs; a drop
outside calls `newWindow` with the buffer text and *then* closes the tab.

Not testable headlessly: that two real windows do not fight over the menu. Verify
by opening a second window from the menu in the running app and checking that a
save in one does not dirty the other.

## Risks

- **Menu routing is the whole feature.** If `get_focused_window()` returns
  `None` at the wrong moment (menu open, window animating), a command could hit
  the wrong window. The broadcast fallback keeps it working rather than silently
  doing nothing.
- **Drag must not eat the click.** The threshold is what keeps clicking a tab
  working; it has its own test.
- **Tear-off is the data-loss risk.** Hence: buffer in the payload, and close
  the source tab only after the new window exists.

---

## What verification found (and the plan did not)

Every one of these was invisible to the test suite and showed up only by opening
two real windows. All three are now fixed, and all three are the same shape:
an API that *reads* as window-scoped and is not.

1. **Capabilities are scoped by window label.** `capabilities/default.json`
   listed `"windows": ["main"]`, so a window labelled `win-1` had no permissions
   at all — not even `event.listen`. The new window opened and sat there inert,
   reporting only `event.listen not allowed on window "win-1"`. Fixed with the
   glob `"win-*"`. Anything that opens a window under a new label needs this.

2. **A new window does not reliably raise `Focused(true)`.** Focus was being
   *remembered* rather than queried (because a macOS menu click leaves every
   window reporting `is_focused() == false` — the original "route to the focused
   window" lookup fell straight through to the broadcast it was meant to
   replace). But a freshly built window never fired the event, so the remembered
   label stayed `main` and every command kept landing there. `new_window` now
   calls `set_focus()` and records the label itself.

3. **`Emitter::emit` is app-wide even when called on a `Window`** — and the JS
   `listen()` receives events sent to *any* target. `w.emit("menu", …)` reads
   exactly like "send this to w", and does not: the Rust log showed
   `new-tab -> win-1` while *both* windows opened a tab. Both halves have to be
   scoped, or neither is: `app.emit_to(label, …)` in Rust, and
   `getCurrentWindow().listen(…)` in the frontend. `file-changed` deliberately
   stays a broadcast on both sides.

**Verified in the running app**: New Window opens a second window; one menu
command reaches exactly one window; and after a real focus change (⌘`) the next
command follows to the other window. Tab dragging and tear-off are covered by
the unit and jsdom tests only — a mouse drag inside the webview cannot be
synthesised from the outside.
