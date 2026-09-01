//! File watcher built for agent-written files (M1.3 spike -> production candidate).
//!
//! Rules (from docs/research/2026-08-30-findings.md):
//! - Watch the PARENT DIRECTORY, never a file descriptor: agents write
//!   atomically (temp + rename), so an inode-bound watch goes permanently
//!   silent after the first write.
//! - Debounce ~120ms: agents burst-write.
//! - Hash-gate: only report when content actually changed (kills self-save
//!   echo and touch-only churn).

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};

pub struct FileWatch {
    /// Receives the new content hash each time the watched file's content changes.
    pub changes: Receiver<[u8; 32]>,
    /// Kept alive; dropping it stops the watch (the whole thread chain unwinds:
    /// watcher -> debounce thread -> `changes` sender).
    pub guard: notify::RecommendedWatcher,
}

pub fn hash_file(path: &Path) -> Option<[u8; 32]> {
    let bytes = std::fs::read(path).ok()?;
    Some(Sha256::digest(&bytes).into())
}

/// Watch `file` for content changes. Emits one hash per actual content change.
pub fn watch_file(file: PathBuf, debounce: Duration) -> notify::Result<FileWatch> {
    let dir = file
        .parent()
        .expect("watched file must have a parent directory")
        .to_path_buf();
    let file_name = file.file_name().expect("watched path must be a file").to_owned();

    let (raw_tx, raw_rx) = channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            // Any event touching our filename (create/rename lands here too).
            if event.paths.iter().any(|p| p.file_name() == Some(&file_name)) {
                let _ = raw_tx.send(());
            }
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    let (tx, changes) = channel();
    let mut last_hash = hash_file(&file);
    std::thread::spawn(move || loop {
        // Block for the first signal; a disconnect means the watcher was dropped.
        match raw_rx.recv() {
            Err(_) => break,
            Ok(()) => {}
        }
        // Debounce: absorb the burst until it goes quiet.
        loop {
            match raw_rx.recv_timeout(debounce) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        // Hash-gate: emit only on real content change. The file may briefly
        // not exist mid-rename; treat unreadable as "no change yet".
        if let Some(h) = hash_file(&file) {
            if last_hash.as_ref() != Some(&h) {
                last_hash = Some(h);
                if tx.send(h).is_err() {
                    return;
                }
            }
        }
    });

    Ok(FileWatch { changes, guard: watcher })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{Duration, Instant};

    /// Write the way agents do: temp file in the same dir, then rename over.
    fn agent_write(path: &Path, content: &str) {
        let tmp = path.with_extension("tmp-write");
        fs::write(&tmp, content).unwrap();
        fs::rename(&tmp, path).unwrap();
    }

    fn recv_within(w: &FileWatch, d: Duration) -> Option<[u8; 32]> {
        w.changes.recv_timeout(d).ok()
    }

    const DEBOUNCE: Duration = Duration::from_millis(120);
    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn survives_atomic_writes_torture() {
        // THE test: 1,000 atomic (temp+rename) writes; an inode-bound watcher
        // dies after the first one. Ours must see the final content.
        let dir = tempdir();
        let file = dir.join("plan.md");
        agent_write(&file, "v0");
        let w = watch_file(file.clone(), DEBOUNCE).unwrap();

        let start = Instant::now();
        for i in 1..=1000 {
            agent_write(&file, &format!("version {i}"));
        }
        // Drain until we see the hash of the final content.
        let want = Sha256::digest(b"version 1000").into();
        let mut got = None;
        while start.elapsed() < WAIT {
            if let Some(h) = recv_within(&w, WAIT) {
                got = Some(h);
                if h == want {
                    break;
                }
            } else {
                break;
            }
        }
        assert_eq!(got, Some(want), "watcher went silent or missed the final write");
    }

    #[test]
    fn silent_on_identical_rewrite_and_touch() {
        let dir = tempdir();
        let file = dir.join("plan.md");
        agent_write(&file, "same content");
        let w = watch_file(file.clone(), DEBOUNCE).unwrap();

        // Same content rewritten (self-save echo) + a bare touch: no emission.
        agent_write(&file, "same content");
        let now = filetime_now();
        filetime::set_file_mtime(&file, now).unwrap();
        assert!(
            recv_within(&w, Duration::from_millis(800)).is_none(),
            "emitted for a no-op change"
        );

        // But a real change still gets through afterwards.
        agent_write(&file, "different");
        assert!(recv_within(&w, WAIT).is_some(), "missed a real change");
    }

    #[test]
    fn burst_collapses_to_one_emission() {
        let dir = tempdir();
        let file = dir.join("plan.md");
        agent_write(&file, "v0");
        let w = watch_file(file.clone(), DEBOUNCE).unwrap();

        for i in 1..=20 {
            agent_write(&file, &format!("burst {i}"));
        }
        assert!(recv_within(&w, WAIT).is_some());
        // The burst was inside one debounce window -> nothing further pending.
        assert!(
            recv_within(&w, Duration::from_millis(600)).is_none(),
            "burst produced multiple emissions"
        );
    }

    fn tempdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("simplemd-watch-{}", std::process::id()))
            .join(format!("{:?}", std::thread::current().id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn filetime_now() -> filetime::FileTime {
        filetime::FileTime::now()
    }
}
