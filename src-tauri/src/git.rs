//! Read-only git context: the branch, and which files in ONE directory differ
//! from HEAD. Read-only is the whole scope — committing is not simplemd's job
//! (CLAUDE.md non-goals).
//!
//! Shells out to `git` rather than reading `.git/` directly: worktrees, submodules
//! and `.git`-as-a-file all resolve correctly for free, and one `git` invocation
//! costs a few ms. Every failure degrades to "no git info" — a directory outside
//! a repo, a missing binary, and a broken repo are all the same non-event here.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Default)]
pub struct GitInfo {
    /// Branch name, or a short sha when HEAD is detached. None = not a repo.
    pub branch: Option<String>,
    /// Absolute path -> single-letter state, for entries of the queried dir only.
    pub entries: Vec<GitEntry>,
}

#[derive(Serialize)]
pub struct GitEntry {
    pub path: String,
    /// "M" changed (tracked), "A" added/staged, "?" untracked.
    pub state: String,
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn branch_of(dir: &Path) -> Option<String> {
    let name = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_owned();
    if name.is_empty() {
        return None;
    }
    if name == "HEAD" {
        // detached: a short sha is more use than the word "HEAD"
        let sha = git(dir, &["rev-parse", "--short", "HEAD"])?.trim().to_owned();
        return if sha.is_empty() { Some(name) } else { Some(sha) };
    }
    Some(name)
}

/// Porcelain v1, NUL-separated so filenames with spaces or quotes need no
/// unquoting. Scoped to `dir` with `-- .` and `--untracked-files=normal`, which
/// collapses an untracked subtree into its directory instead of walking it —
/// this stays a browser, not an index.
fn entries_of(dir: &Path) -> Vec<GitEntry> {
    let Some(out) = git(
        dir,
        &["status", "--porcelain", "-z", "--untracked-files=normal", "--", "."],
    ) else {
        return Vec::new();
    };
    // Resolved once: it is the same for every entry, and this is a subprocess.
    let Some(root) = git(dir, &["rev-parse", "--show-toplevel"]) else {
        return Vec::new();
    };
    let root = Path::new(root.trim());
    let mut entries = Vec::new();
    let mut fields = out.split('\0').filter(|f| !f.is_empty());
    while let Some(field) = fields.next() {
        if field.len() < 4 {
            continue;
        }
        let (code, rel) = field.split_at(3);
        let code = code.as_bytes();
        // Renames carry a second NUL field (the old path) — consume and ignore it.
        if code[0] == b'R' {
            fields.next();
        }
        let state = match (code[0], code[1]) {
            (b'?', _) => "?",
            (b' ', _) => "M",      // worktree-only change
            (b'A', _) => "A",
            (_, b' ') => "A",      // staged, worktree clean
            _ => "M",
        };
        // Porcelain paths are relative to the repo root, not to `dir`.
        let abs = root.join(rel.trim_end_matches('/'));
        entries.push(GitEntry {
            path: abs.to_string_lossy().into_owned(),
            state: state.to_owned(),
        });
    }
    entries
}

#[tauri::command]
pub fn git_info(dir: String) -> GitInfo {
    let path = Path::new(&dir);
    let Some(branch) = branch_of(path) else {
        return GitInfo::default();
    };
    GitInfo { branch: Some(branch), entries: entries_of(path) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir()
            .join(format!("simplemd-git-{}", std::process::id()))
            .join(name);
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        for args in [
            vec!["init", "--initial-branch=main"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            Command::new("git").arg("-C").arg(&d).args(&args).output().unwrap();
        }
        d
    }

    fn commit(d: &Path) {
        Command::new("git").arg("-C").arg(d).args(["add", "-A"]).output().unwrap();
        Command::new("git")
            .arg("-C")
            .arg(d)
            .args(["commit", "-m", "x", "--no-gpg-sign"])
            .output()
            .unwrap();
    }

    #[test]
    fn reports_the_branch() {
        let d = repo("branch");
        fs::write(d.join("a.md"), "x").unwrap();
        commit(&d);
        assert_eq!(git_info(d.to_string_lossy().into_owned()).branch.unwrap(), "main");
    }

    #[test]
    fn reports_a_short_sha_when_head_is_detached() {
        let d = repo("detached");
        fs::write(d.join("a.md"), "x").unwrap();
        commit(&d);
        Command::new("git").arg("-C").arg(&d).args(["checkout", "--detach"]).output().unwrap();
        let branch = git_info(d.to_string_lossy().into_owned()).branch.unwrap();
        assert_ne!(branch, "HEAD");
        assert!(branch.len() >= 7 && branch.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn a_plain_directory_is_not_an_error_it_is_simply_not_a_repo() {
        let d = std::env::temp_dir().join(format!("simplemd-nogit-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let info = git_info(d.to_string_lossy().into_owned());
        assert!(info.branch.is_none());
        assert!(info.entries.is_empty());
    }

    #[test]
    fn marks_modified_and_untracked_files_by_absolute_path() {
        let d = repo("status");
        fs::write(d.join("tracked.md"), "one").unwrap();
        commit(&d);
        fs::write(d.join("tracked.md"), "two").unwrap(); // modified
        fs::write(d.join("new file.md"), "x").unwrap(); // untracked, with a space

        let info = git_info(d.to_string_lossy().into_owned());
        let state = |name: &str| {
            info.entries
                .iter()
                .find(|e| e.path.ends_with(name))
                .map(|e| e.state.as_str())
                .unwrap_or("clean")
        };
        assert_eq!(state("tracked.md"), "M");
        assert_eq!(state("new file.md"), "?");
        // absolute paths, so the frontend can match them against row identities
        assert!(info.entries.iter().all(|e| e.path.starts_with('/')));
    }

    #[test]
    fn an_untracked_subtree_collapses_to_its_directory() {
        let d = repo("subtree");
        fs::write(d.join("a.md"), "x").unwrap();
        commit(&d);
        fs::create_dir_all(d.join("fresh/deeper")).unwrap();
        fs::write(d.join("fresh/deeper/one.md"), "x").unwrap();
        fs::write(d.join("fresh/two.md"), "x").unwrap();

        let info = git_info(d.to_string_lossy().into_owned());
        // one entry for the directory, NOT one per file inside it
        assert_eq!(info.entries.len(), 1);
        assert!(info.entries[0].path.ends_with("fresh"));
        assert_eq!(info.entries[0].state, "?");
    }
}
