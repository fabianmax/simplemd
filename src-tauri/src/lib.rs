pub mod commands;
mod git;
pub mod menu;
pub mod watcher;
pub mod window;

use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

/// Files handed to us before the webview was ready to receive events
/// (cold-start Finder open, CLI args). The frontend drains this on startup
/// and whenever it gets an "open-request" nudge — single source of truth,
/// so a file is never opened twice.
pub struct PendingOpen(pub Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev/CLI fallback: `simplemd path.md` (Launch Services is the primary path).
    let initial: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpen(Mutex::new(initial)))
        .manage(commands::ActiveWatch(Mutex::new(std::collections::HashMap::new())))
        .manage(window::PendingHandoff::default())
        .manage(window::LastFocused::default())
        // A destroyed window must not strand the watches it held, nor drop the
        // ones another window is still using.
        .on_window_event(|window, event| match event {
            // Remembered here because a menu click makes every window report
            // "not focused" — see window::LastFocused.
            tauri::WindowEvent::Focused(true) => {
                window.state::<window::LastFocused>().set(window.label());
            }
            tauri::WindowEvent::Destroyed => {
                window.state::<commands::ActiveWatch>().release_window(window.label());
                window.state::<window::PendingHandoff>().forget(window.label());
                window.state::<window::LastFocused>().clear_if(window.label());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::save_file,
            commands::add_recent,
            commands::get_recents,
            commands::list_dir,
            commands::resolve_link,
            commands::open_external,
            menu::show_format_menu,
            commands::frontend_log,
            commands::watch_file,
            commands::unwatch_file,
            commands::write_recovery,
            take_pending_open,
            git::git_info,
            window::new_window,
            window::take_handoff,
        ])
        .setup(|app| {
            let handle = app.handle();
            let recents = commands::load_recents(handle);
            app.set_menu(menu::build(handle, &recents)?)?;
            menu::attach_handler(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Launch Services document-open (Finder double-click, `open -a`).
        // This is the sandbox-safe open path — see CLAUDE.md.
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if !paths.is_empty() {
                let state = app.state::<PendingOpen>();
                state.0.lock().unwrap().extend(paths);
                // Nudge the focused window; it drains the pending queue. Sent
                // to one window so which window a Finder open lands in is
                // deterministic — a broadcast would race every open window.
                match window::target(app) {
                    Some(w) => {
                        // emit_to, not emit: see the note in menu::attach_handler.
                        let _ = app.emit_to(w.label(), "open-request", ());
                    }
                    None => {
                        let _ = app.emit("open-request", ());
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn harness_works() {
        assert_eq!(1 + 1, 2);
    }
}
