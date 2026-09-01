//! File IO commands. Saves are atomic (temp + rename in the same directory) —
//! the same write pattern agents use, and the pattern our own watcher is built
//! to survive.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

fn hex(h: [u8; 32]) -> String {
    h.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Serialize)]
pub struct FileContent {
    pub content: String,
    pub hash: String,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContent, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Cannot read {path}: {e}"))?;
    let hash = hex(Sha256::digest(&bytes).into());
    let content =
        String::from_utf8(bytes).map_err(|_| format!("{path} is not valid UTF-8"))?;
    Ok(FileContent { content, hash })
}

/// Atomic save: write a temp file in the same directory, fsync, rename over.
/// Returns the hash of the written bytes (the frontend uses it to suppress
/// the watcher's echo of our own save).
#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<String, String> {
    save_atomic(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

pub fn save_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<String> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    let file_name = path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a file path"))?
        .to_string_lossy()
        .into_owned();
    // Dot-prefixed temp name: never matches the watcher's filename filter.
    let tmp = dir.join(format!(".{file_name}.simplemd-{}", std::process::id()));

    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // Preserve the original file's permissions across the rename.
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, path)?;
    Ok(hex(Sha256::digest(bytes).into()))
}

// --- file browser -----------------------------------------------------------

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// One directory level, lazily fetched per expand. A browser, NOT an index
/// (CLAUDE.md): no recursion, no cache, no vault. Shows ALL files except
/// dotfiles (user feedback 2026-09-01); non-markdown files open with the
/// system default app.
#[tauri::command]
pub fn frontend_log(msg: String) {
    eprintln!("[frontend] {msg}");
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| format!("Cannot read {path}: {e}"))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let ft = e.file_type().ok()?;
            if ft.is_symlink() {
                return None; // no aliases/symlinks in the browser (user feedback)
            }
            let is_dir = ft.is_dir();
            Some(DirEntry {
                name,
                path: e.path().to_string_lossy().into_owned(),
                is_dir,
            })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[derive(Serialize)]
pub struct ResolvedLink {
    pub path: String,
    pub exists: bool,
    pub is_md: bool,
}

/// Resolve a non-URL link target ([spec](./spec.md), /abs/path, sub/file.txt)
/// against the directory of the file containing it.
#[tauri::command]
pub fn resolve_link(base_dir: String, target: String) -> ResolvedLink {
    // minimal %-decoding for the common case of spaces in filenames
    let target = target.replace("%20", " ");
    let raw = if target.starts_with('/') {
        PathBuf::from(&target)
    } else {
        Path::new(&base_dir).join(&target)
    };
    let path = raw.canonicalize().unwrap_or(raw);
    let is_md = path.extension().map_or(false, |e| {
        e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown")
    });
    ResolvedLink {
        exists: path.exists(),
        is_md,
        path: path.to_string_lossy().into_owned(),
    }
}

// --- file watching --------------------------------------------------------

/// Active watches, one per open tab. Dropping a guard unwinds its
/// debounce thread and forwarding thread.
pub struct ActiveWatch(pub Mutex<std::collections::HashMap<String, notify::RecommendedWatcher>>);

#[derive(Clone, Serialize)]
pub struct FileChanged {
    pub path: String,
    pub hash: String,
}

#[tauri::command]
pub fn watch_file(
    app: AppHandle,
    state: State<ActiveWatch>,
    path: String,
) -> Result<(), String> {
    let mut watches = state.0.lock().unwrap();
    if watches.contains_key(&path) {
        return Ok(());
    }
    let fw = crate::watcher::watch_file(PathBuf::from(&path), Duration::from_millis(120))
        .map_err(|e| e.to_string())?;
    watches.insert(path.clone(), fw.guard);
    let changes = fw.changes;
    std::thread::spawn(move || {
        while let Ok(h) = changes.recv() {
            let _ = app.emit("file-changed", FileChanged { path: path.clone(), hash: hex(h) });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_file(state: State<ActiveWatch>, path: String) {
    state.0.lock().unwrap().remove(&path);
}

/// Sidecar recovery copy — written the moment a conflict is detected,
/// BEFORE the user chooses. Never lose an edit (CLAUDE.md requirement #3).
#[tauri::command]
pub fn write_recovery(app: AppHandle, file_name: String, content: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let path = dir.join(format!("{ts}-{file_name}"));
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// --- recent files -------------------------------------------------------------

const MAX_RECENTS: usize = 10;

fn recents_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("recents.json"))
}

pub fn load_recents(app: &AppHandle) -> Vec<String> {
    recents_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_recents(app: AppHandle) -> Vec<String> {
    load_recents(&app)
}

#[tauri::command]
pub fn add_recent(app: AppHandle, path: String) -> Result<(), String> {
    let mut recents = load_recents(&app);
    recents.retain(|p| p != &path);
    recents.insert(0, path);
    recents.truncate(MAX_RECENTS);
    if let Some(p) = recents_path(&app) {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        fs::write(&p, serde_json::to_string(&recents).unwrap()).map_err(|e| e.to_string())?;
    }
    // Recents changed -> rebuild the native menu.
    crate::menu::rebuild(&app, &recents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir() -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("simplemd-cmd-{}", std::process::id()))
            .join(format!("{:?}", std::thread::current().id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn save_is_atomic_and_changes_inode() {
        use std::os::unix::fs::MetadataExt;
        let dir = tempdir();
        let path = dir.join("plan.md");
        fs::write(&path, "old").unwrap();
        let ino_before = fs::metadata(&path).unwrap().ino();

        let hash = save_atomic(&path, b"new content").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new content");
        assert_ne!(fs::metadata(&path).unwrap().ino(), ino_before, "not rename-based");
        assert_eq!(hash, hex(Sha256::digest(b"new content").into()));
        // No temp litter left behind.
        let litter: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains("simplemd-"))
            .collect();
        assert!(litter.is_empty());
    }

    #[test]
    fn save_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir();
        let path = dir.join("exec.md");
        fs::write(&path, "x").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        save_atomic(&path, b"y").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn list_dir_shows_all_files_hides_dotfiles() {
        let dir = tempdir();
        fs::create_dir_all(dir.join("zsub")).unwrap();
        fs::write(dir.join("b-plan.md"), "x").unwrap();
        fs::write(dir.join("code.rs"), "x").unwrap();
        fs::write(dir.join(".hidden.md"), "x").unwrap();
        std::os::unix::fs::symlink(dir.join("b-plan.md"), dir.join("alias.md")).unwrap();
        let got = list_dir(dir.to_string_lossy().into_owned()).unwrap();
        let names: Vec<_> = got.iter().map(|e| e.name.as_str()).collect();
        // dirs first, then ALL files case-insensitively sorted; dotfiles hidden
        assert_eq!(names, vec!["zsub", "b-plan.md", "code.rs"]);
        assert!(got[0].is_dir);
    }

    #[test]
    fn resolve_link_relative_and_markdown_detection() {
        let dir = tempdir();
        fs::write(dir.join("spec.md"), "x").unwrap();
        fs::write(dir.join("data.csv"), "x").unwrap();
        let base = dir.to_string_lossy().into_owned();
        let md = resolve_link(base.clone(), "./spec.md".into());
        assert!(md.exists && md.is_md);
        let csv = resolve_link(base.clone(), "data.csv".into());
        assert!(csv.exists && !csv.is_md);
        let gone = resolve_link(base, "missing.md".into());
        assert!(!gone.exists);
    }

    #[test]
    fn save_triggers_watch_with_matching_hash() {
        // The save->watch interplay the frontend's echo suppression relies on:
        // the hash save_atomic returns must equal the hash the watcher emits.
        let dir = tempdir();
        let path = dir.join("watched.md");
        fs::write(&path, "old").unwrap();
        let w = crate::watcher::watch_file(path.clone(), std::time::Duration::from_millis(120))
            .unwrap();
        let returned = save_atomic(&path, b"agent-or-self wrote this").unwrap();
        let emitted = w
            .changes
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("watcher missed an atomic save");
        assert_eq!(hex(emitted), returned);
    }

    #[test]
    fn save_creates_new_file() {
        let dir = tempdir();
        let path = dir.join("fresh.md");
        save_atomic(&path, b"hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }
}
