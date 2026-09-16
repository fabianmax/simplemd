//! Window creation and the tab handoff that makes a tear-off safe.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The label of the window that most recently had focus.
///
/// Asking the windows directly does NOT work for menu commands: while a macOS
/// menu is being tracked, focus belongs to the menu, so every window reports
/// `is_focused() == false` and a "route to the focused window" lookup falls
/// through to a broadcast — which is the bug it was meant to fix (verified: one
/// New Tab opened a tab in both windows). So focus is remembered as it changes.
#[derive(Default)]
pub struct LastFocused(pub Mutex<Option<String>>);

impl LastFocused {
    pub fn set(&self, label: &str) {
        *self.0.lock().unwrap() = Some(label.to_owned());
    }
    pub fn clear_if(&self, label: &str) {
        let mut cur = self.0.lock().unwrap();
        if cur.as_deref() == Some(label) {
            *cur = None;
        }
    }
    pub fn get(&self) -> Option<String> {
        self.0.lock().unwrap().clone()
    }
}

/// The window a command should act on: the remembered one while it still
/// exists, otherwise whichever window currently claims focus.
pub fn target(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(label) = app.state::<LastFocused>().get() {
        if let Some(w) = app.get_webview_window(&label) {
            return Some(w);
        }
    }
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

/// A tab in flight between windows. It carries the BUFFER, not just the path:
/// re-reading from disk in the new window would discard unsaved edits, and
/// losing an edit is the one unacceptable bug class here (CLAUDE.md).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Handoff {
    pub path: Option<String>,
    pub text: String,
    pub dirty: bool,
}

/// label -> the tab that window was opened to receive. Take-once.
#[derive(Default)]
pub struct PendingHandoff(pub Mutex<HashMap<String, Handoff>>);

impl PendingHandoff {
    pub fn store(&self, label: &str, handoff: Handoff) {
        self.0.lock().unwrap().insert(label.to_owned(), handoff);
    }
    pub fn take(&self, label: &str) -> Option<Handoff> {
        self.0.lock().unwrap().remove(label)
    }
    pub fn forget(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }
}

static NEXT_LABEL: AtomicU32 = AtomicU32::new(1);

/// Open a window, optionally pre-loaded with a torn-off tab. `at` is a screen
/// position (the drop point); without it the window cascades off the focused one
/// so it never lands exactly on top.
#[tauri::command]
pub fn new_window(
    app: AppHandle,
    handoff: Option<Handoff>,
    at: Option<(f64, f64)>,
) -> Result<String, String> {
    let label = format!("win-{}", NEXT_LABEL.fetch_add(1, Ordering::Relaxed));
    if let Some(h) = handoff {
        // Stored BEFORE the window exists: the frontend drains on startup, so
        // the payload has to be waiting when it asks.
        app.state::<PendingHandoff>().store(&label, h);
    }

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("simplemd")
        .inner_size(960.0, 760.0);
    builder = match at {
        Some((x, y)) => builder.position(x, y),
        None => match target(&app).and_then(|w| w.outer_position().ok()) {
            Some(p) => builder.position(p.x as f64 + 28.0, p.y as f64 + 28.0),
            None => builder,
        },
    };

    let win = builder.build().map_err(|e| {
        app.state::<PendingHandoff>().forget(&label); // never strand a payload
        e.to_string()
    })?;
    // A new window does not reliably raise a Focused event, so claim the focus
    // and record it here: the menu has to route to this window from the moment
    // it opens, not from whenever macOS decides to tell us about it.
    let _ = win.set_focus();
    app.state::<LastFocused>().set(&label);
    Ok(label)
}

/// Tauri injects the calling window, so a window can only ever take its own.
#[tauri::command]
pub fn take_handoff(window: tauri::Window, state: tauri::State<PendingHandoff>) -> Option<Handoff> {
    state.take(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handoff(text: &str) -> Handoff {
        Handoff { path: Some("/p/plan.md".into()), text: text.into(), dirty: true }
    }

    #[test]
    fn a_handoff_is_taken_once_and_only_by_its_own_window() {
        let store = PendingHandoff::default();
        store.store("win-1", handoff("draft"));

        assert!(store.take("win-2").is_none(), "another window must not take it");
        assert_eq!(store.take("win-1").unwrap().text, "draft");
        assert!(store.take("win-1").is_none(), "second take must be empty");
    }

    #[test]
    fn focus_is_remembered_across_a_menu_click() {
        let last = LastFocused::default();
        assert!(last.get().is_none());
        last.set("main");
        last.set("win-1"); // the user clicked the other window
        // A menu click makes every window report "not focused"; the remembered
        // label is what survives that, and is what a command must route to.
        assert_eq!(last.get().as_deref(), Some("win-1"));
    }

    #[test]
    fn a_closed_window_stops_being_the_target_but_others_are_untouched() {
        let last = LastFocused::default();
        last.set("win-1");
        last.clear_if("main"); // a different window closed
        assert_eq!(last.get().as_deref(), Some("win-1"));
        last.clear_if("win-1"); // the remembered one closed
        assert!(last.get().is_none(), "a destroyed window must not stay the target");
    }

    #[test]
    fn a_failed_window_build_strands_nothing() {
        let store = PendingHandoff::default();
        store.store("win-9", handoff("x"));
        store.forget("win-9");
        assert!(store.take("win-9").is_none());
    }
}
