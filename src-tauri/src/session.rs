//! Which tabs were open, so a launch lands where the last one left off.
//!
//! Deliberately NOT a workspace: no layout, no scroll positions, no per-project
//! state — a list of paths and which one was in front. It is the tabs of the
//! window that last had focus, not of every window: simplemd is tabs-first and
//! multi-window is a tear-off convenience, so restoring one window predictably
//! beats restoring N with rules nobody can remember.

use crate::window::LastFocused;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Session {
    pub paths: Vec<String>,
    /// Path of the tab that was in front — a path, not an index, because a file
    /// that vanished between runs must not shift which tab comes up active.
    #[serde(default)]
    pub active: Option<String>,
}

impl Session {
    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }
}

/// label -> the session that window was opened to restore. Take-once, exactly
/// like PendingHandoff: the payload has to be waiting before the frontend asks.
#[derive(Default)]
pub struct PendingRestore(pub Mutex<HashMap<String, Session>>);

impl PendingRestore {
    pub fn store(&self, label: &str, session: Session) {
        self.0.lock().unwrap().insert(label.to_owned(), session);
    }
    pub fn take(&self, label: &str) -> Option<Session> {
        self.0.lock().unwrap().remove(label)
    }
}

fn path_of(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("session.json"))
}

pub fn load(app: &AppHandle) -> Session {
    path_of(app).map(|p| load_from(&p)).unwrap_or_default()
}

pub fn save(app: &AppHandle, session: &Session) {
    if let Some(path) = path_of(app) {
        save_to(&path, session);
    }
}

/// Split from `load`/`save` so the format is testable without an app handle.
pub fn load_from(path: &std::path::Path) -> Session {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_to(path: &std::path::Path, session: &Session) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(session) {
        let _ = fs::write(path, json);
    }
}

/// Report a window's open tabs. Only the window that currently holds focus
/// writes: otherwise a background window's reload would overwrite the session
/// with tabs the reader is not looking at.
///
/// An EMPTY report is never written. Closing the last tab, or the last window,
/// has to leave the session as it was — otherwise "quit, come back" would find
/// nothing, which is the whole point of the feature.
#[tauri::command]
pub fn set_session(
    app: AppHandle,
    window: tauri::Window,
    paths: Vec<String>,
    active: Option<String>,
) {
    let focused = app.state::<LastFocused>().get();
    if focused.is_some_and(|l| l != window.label()) {
        return;
    }
    let session = Session { paths, active };
    if session.is_empty() {
        return;
    }
    save(&app, &session);
}

/// Tauri injects the calling window, so a window can only take its own.
#[tauri::command]
pub fn take_restore(window: tauri::Window, state: tauri::State<PendingRestore>) -> Option<Session> {
    state.take(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("simplemd-session-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d.join(name)
    }

    #[test]
    fn round_trips_paths_and_the_front_tab() {
        let p = tmp("a.json");
        let s = Session {
            paths: vec!["/a/plan.md".into(), "/b/notes.md".into()],
            active: Some("/b/notes.md".into()),
        };
        save_to(&p, &s);
        let back = load_from(&p);
        assert_eq!(back.paths, s.paths);
        assert_eq!(back.active, s.active);
    }

    #[test]
    fn a_missing_or_broken_file_is_an_empty_session_not_an_error() {
        assert!(load_from(&tmp("nope.json")).is_empty());
        let p = tmp("broken.json");
        fs::write(&p, b"{ not json").unwrap();
        assert!(load_from(&p).is_empty());
    }

    #[test]
    fn an_older_file_without_the_active_field_still_loads() {
        let p = tmp("old.json");
        fs::write(&p, br#"{"paths":["/a/plan.md"]}"#).unwrap();
        let s = load_from(&p);
        assert_eq!(s.paths.len(), 1);
        assert_eq!(s.active, None);
    }
}
