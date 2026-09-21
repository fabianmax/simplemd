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
    let boot = std::time::Instant::now();
    // Dev/CLI fallback: `simplemd path.md` (Launch Services is the primary path).
    let initial: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpen(Mutex::new(initial)))
        .manage(commands::Boot(boot))
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
            commands::create_file,
            commands::add_recent,
            commands::get_recents,
            commands::list_dir,
            commands::resolve_link,
            commands::open_external,
            menu::show_format_menu,
            commands::frontend_log,
            commands::trace,
            commands::watch_file,
            commands::unwatch_file,
            commands::write_recovery,
            take_pending_open,
            git::git_info,
            window::new_window,
            window::take_handoff,
        ])
        .on_page_load(move |_w, payload| {
            // Splits the pre-JS half of startup: process -> page start -> script
            // done. Only under SIMPLEMD_TRACE; see commands::trace.
            if std::env::var_os("SIMPLEMD_TRACE").is_some() {
                println!(
                    "trace: page {:?} | +{:.1}ms since process start",
                    payload.event(),
                    boot.elapsed().as_secs_f64() * 1000.0
                );
            }
        })
        .setup(move |app| {
            let t = |what: &str| {
                if std::env::var_os("SIMPLEMD_TRACE").is_some() {
                    println!(
                        "trace: {what} | +{:.1}ms since process start",
                        boot.elapsed().as_secs_f64() * 1000.0
                    );
                }
            };
            t("setup entered");
            let handle = app.handle();
            let recents = commands::load_recents(handle);
            t("recents loaded");
            app.set_menu(menu::build(handle, &recents)?)?;
            t("menu set");
            menu::attach_handler(handle);
            // Paint the window in the app's own background BEFORE the webview
            // has any CSS: it is on screen ~100ms before the frontend paints,
            // and white-flashing into a dark editor reads as a slow launch.
            if let Some(w) = app.get_webview_window("main") {
                window::paint_background(&w);
            }
            t("setup done");
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
