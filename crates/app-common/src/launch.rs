//! Documents the OS hands to a desktop shell (P11-D1): a Finder / Explorer double-click or "Open with" (macOS:
//! the `RunEvent::Opened` Apple Event, Windows / Linux: the command line, forwarded to the running instance by
//! `tauri-plugin-single-instance`), and files dropped onto the window or the Dock icon.
//!
//! The shells queue those paths in a [`LaunchQueue`] and tell the page; the page asks the unsaved-changes question
//! and takes them ([`LaunchQueue::take`]). Only paths the OS delivered are ever read this way – the page never names
//! a path – exactly like the open dialog grants the one picked file. One document per window: the first openable
//! file is opened, further openable ones are reported (and put on the recent list by the shell), files of other
//! types are reported as not openable.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Whether `path` has one of `extensions` (lower case, without the dot; the comparison ignores case).
pub fn openable(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| extensions.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// The documents of a command line (`std::env::args()`, the program first): every argument that is not a flag
/// (`--smoke`, macOS `-psn_…`) and names an existing file, relative ones resolved against `cwd`. `file://` URLs
/// (some Linux file managers) count as their path.
pub fn paths_from_args<I, S>(args: I, cwd: &Path) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .filter_map(|a| {
            let a = a.as_ref();
            if a.is_empty() || a.starts_with('-') {
                return None;
            }
            let path = file_url_path(a).unwrap_or_else(|| PathBuf::from(a));
            let path = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            path.is_file().then_some(path)
        })
        .collect()
}

/// The path of a `file://` URL (`file:///a/b%20c.xlsx` → `/a/b c.xlsx`; Windows `file:///C:/x` → `C:/x`); `None`
/// for anything else (another scheme, a remote host, bad percent-encoding).
pub fn file_url_path(url: &str) -> Option<PathBuf> {
    let rest = url
        .strip_prefix("file://")
        .or_else(|| url.strip_prefix("FILE://"))?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if !rest.starts_with('/') {
        return None;
    }
    let decoded = percent_decode(rest)?;
    // `/C:/x` → `C:/x` (a drive letter after the root slash).
    let b = decoded.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        return Some(PathBuf::from(&decoded[1..]));
    }
    Some(PathBuf::from(decoded))
}

fn percent_decode(s: &str) -> Option<String> {
    let mut out = Vec::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hi = (bytes.next()? as char).to_digit(16)?;
            let lo = (bytes.next()? as char).to_digit(16)?;
            out.push(u8::try_from(hi * 16 + lo).ok()?);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}

/// What [`LaunchQueue::take`] hands out.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Taken {
    /// The document to open (the first openable path), when the page opens one.
    pub open: Option<PathBuf>,
    /// Further openable paths (one document per window): the shell puts them on the recent list.
    pub not_opened: Vec<PathBuf>,
    /// Paths of types the app cannot open.
    pub unsupported: Vec<PathBuf>,
}

/// The paths the OS delivered and the page has not taken yet, oldest first, each once.
#[derive(Debug, Default)]
pub struct LaunchQueue(Mutex<VecDeque<PathBuf>>);

impl LaunchQueue {
    fn queue(&self) -> std::sync::MutexGuard<'_, VecDeque<PathBuf>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Queues `paths` (one already waiting is not queued twice); whether anything was added.
    pub fn push(&self, paths: impl IntoIterator<Item = PathBuf>) -> bool {
        let mut q = self.queue();
        let before = q.len();
        for p in paths {
            if !q.contains(&p) {
                q.push_back(p);
            }
        }
        q.len() > before
    }

    /// Whether an openable path waits (the page then asks about unsaved changes before taking it).
    pub fn has_openable(&self, extensions: &[&str]) -> bool {
        self.queue().iter().any(|p| openable(p, extensions))
    }

    /// Takes every waiting path: with `open` the first openable one is to be opened and the others are
    /// `not_opened`; without (the user kept the open document) the openable ones are dropped. Unsupported paths
    /// are always reported.
    pub fn take(&self, extensions: &[&str], open: bool) -> Taken {
        let mut taken = Taken::default();
        for p in self.queue().drain(..) {
            if !openable(&p, extensions) {
                taken.unsupported.push(p);
            } else if !open {
                // Declined: nothing of it is opened.
            } else if taken.open.is_none() {
                taken.open = Some(p);
            } else {
                taken.not_opened.push(p);
            }
        }
        taken
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXT: &[&str] = &["xlsx", "csv"];

    #[test]
    fn openable_compares_the_extension_without_case() {
        assert!(openable(Path::new("/a/B.XLSX"), EXT));
        assert!(openable(Path::new("x.csv"), EXT));
        assert!(!openable(Path::new("x.docx"), EXT));
        assert!(!openable(Path::new("xlsx"), EXT));
        assert!(!openable(Path::new("/a/.xlsx"), EXT));
    }

    #[test]
    fn file_urls_decode_to_paths() {
        assert_eq!(
            file_url_path("file:///home/u/My%20Book.xlsx"),
            Some(PathBuf::from("/home/u/My Book.xlsx"))
        );
        assert_eq!(
            file_url_path("file://localhost/tmp/%C3%A4.csv"),
            Some(PathBuf::from("/tmp/ä.csv"))
        );
        assert_eq!(
            file_url_path("file:///C:/Users/x.xlsx"),
            Some(PathBuf::from("C:/Users/x.xlsx"))
        );
        assert_eq!(file_url_path("file://server/share/x.xlsx"), None);
        assert_eq!(file_url_path("https://x/y.xlsx"), None);
        assert_eq!(file_url_path("file:///bad%zz"), None);
        assert_eq!(file_url_path("/plain/path.xlsx"), None);
    }

    #[test]
    fn args_keep_existing_files_and_skip_flags() {
        let dir = std::env::temp_dir().join(format!("rusuite-launch-args-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.xlsx"), b"x").unwrap();
        std::fs::write(dir.join("sub/b c.csv"), b"x").unwrap();
        let abs = dir.join("a.xlsx").to_string_lossy().into_owned();
        let url = format!("file://{}", dir.join("sub/b%20c.csv").to_string_lossy());
        let args = [
            "app-calc",
            "--smoke",
            "-psn_0_12345",
            &abs,
            "sub/b c.csv",
            &url,
            "missing.xlsx",
            "sub",
            "",
        ];
        assert_eq!(
            paths_from_args(args, &dir),
            vec![
                dir.join("a.xlsx"),
                dir.join("sub/b c.csv"),
                dir.join("sub/b c.csv"),
            ]
        );
        // The program name alone: nothing to open.
        assert!(paths_from_args(["app-calc"], &dir).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_queue_hands_out_the_first_openable_path_once() {
        let q = LaunchQueue::default();
        assert!(!q.has_openable(EXT));
        assert!(q.push([PathBuf::from("/d/notes.txt"), PathBuf::from("/d/a.xlsx")]));
        // The same path again (a second Apple Event, a repeated drop) is not queued twice.
        assert!(!q.push([PathBuf::from("/d/a.xlsx")]));
        assert!(q.push([PathBuf::from("/d/b.csv")]));
        assert!(q.has_openable(EXT));
        let taken = q.take(EXT, true);
        assert_eq!(taken.open, Some(PathBuf::from("/d/a.xlsx")));
        assert_eq!(taken.not_opened, vec![PathBuf::from("/d/b.csv")]);
        assert_eq!(taken.unsupported, vec![PathBuf::from("/d/notes.txt")]);
        // Taken once: nothing waits any more.
        assert!(!q.has_openable(EXT));
        assert_eq!(q.take(EXT, true), Taken::default());
    }

    #[test]
    fn a_declined_open_drops_the_documents_but_reports_unsupported_files() {
        let q = LaunchQueue::default();
        q.push([PathBuf::from("/d/a.xlsx"), PathBuf::from("/d/x.pdf")]);
        // Only unsupported files waiting: nothing to ask about.
        let taken = q.take(EXT, false);
        assert_eq!(taken.open, None);
        assert!(taken.not_opened.is_empty());
        assert_eq!(taken.unsupported, vec![PathBuf::from("/d/x.pdf")]);
        q.push([PathBuf::from("/d/x.pdf")]);
        assert!(!q.has_openable(EXT));
    }
}
