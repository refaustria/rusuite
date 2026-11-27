//! One window per document (P11-D2, desktop): the pure rules behind the document shells' window registry.
//!
//! Each document window of Calc, Write and Show holds its own document (core, file binding, dirty flag, undo,
//! recovery, close guard). This module decides, without any Tauri types, where an opened document goes
//! ([`route`]), what the next window is called ([`Labels`]), where it appears ([`cascade`]), whether the app
//! keeps running without windows ([`keeps_running_without_windows`]) and in which order Quit asks about unsaved
//! documents ([`Quit`]), and holds documents that arrive before the first window exists ([`Startup`]). The shells (`apps/*/src-tauri/src/windows.rs`) apply it to real windows.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

/// The label of the window the app starts with (`tauri.conf.json`).
pub const MAIN_LABEL: &str = "main";
/// Labels of further document windows: `doc-1`, `doc-2`, ... (the capabilities match `doc-*`).
pub const DOC_PREFIX: &str = "doc-";
/// How far a new window is moved from the focused one (logical pixels, right and down), as Office does.
pub const CASCADE: f64 = 24.0;

/// What the router needs to know about one open document window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowDoc {
    pub label: String,
    /// The file the document is bound to (or being opened from); `None` = untitled.
    pub path: Option<PathBuf>,
    /// Untitled, unmodified and empty, with nothing waiting to open: an opened document may replace it.
    pub pristine: bool,
}

/// Where one opened document goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// Into this existing (pristine) window.
    Window(String),
    /// The document is already open there: only bring that window to the front.
    Focus(String),
    /// Into a new window.
    New,
}

/// Same file? Compared as given and, when both exist, by their canonical paths (`./a.xlsx`, symlinks).
pub fn same_file(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Routes opened documents (open dialog, Finder / Explorer, a drop, a recent file, a second launch): a document
/// already open focuses its window; the first other one goes into the focused window when that is pristine;
/// every further one gets a new window. The same path twice is routed once.
pub fn route(
    paths: Vec<PathBuf>,
    windows: &[WindowDoc],
    focused: Option<&str>,
) -> Vec<(PathBuf, Target)> {
    let mut reuse = focused
        .and_then(|f| windows.iter().find(|w| w.label == f))
        .filter(|w| w.pristine && w.path.is_none())
        .map(|w| w.label.clone());
    let mut out: Vec<(PathBuf, Target)> = Vec::new();
    for path in paths {
        if out.iter().any(|(p, _)| same_file(p, &path)) {
            continue;
        }
        let open = windows
            .iter()
            .find(|w| w.path.as_deref().is_some_and(|p| same_file(p, &path)));
        let target = match (open, reuse.take()) {
            (Some(w), keep) => {
                reuse = keep;
                Target::Focus(w.label.clone())
            }
            (None, Some(label)) => Target::Window(label),
            (None, None) => Target::New,
        };
        out.push((path, target));
    }
    out
}

/// Documents that arrive before the app has started: macOS delivers a Finder / Dock open of a cold start
/// (`application:openURLs:`, Tauri's `RunEvent::Opened`) before `didFinishLaunching`, so before Tauri's setup has
/// created the configured window. Routed then, they would see no window and each get a new one while the
/// configured window opened empty behind them. They wait here until setup, then go through [`route`] like any
/// open: the configured window takes the first, every further one gets a new window.
#[derive(Debug, Default)]
pub struct Startup {
    started: bool,
    early: Vec<PathBuf>,
}

impl Startup {
    /// `paths` to route now, or `None` when they are held until [`Startup::start`].
    pub fn hold(&mut self, paths: Vec<PathBuf>) -> Option<Vec<PathBuf>> {
        if self.started {
            return Some(paths);
        }
        self.early.extend(paths);
        None
    }

    /// The app has started (its configured window exists): from now on nothing is held. Returns the documents
    /// that waited, in the order they came.
    pub fn start(&mut self) -> Vec<PathBuf> {
        self.started = true;
        std::mem::take(&mut self.early)
    }
}

/// Hands out window labels: `main` first (when it is not open), then `doc-1`, `doc-2`, ... never reused while
/// the app runs (a closed window's label could still have events in flight).
#[derive(Debug, Default)]
pub struct Labels {
    next: u32,
}

impl Labels {
    /// The next free label; `taken` says whether a label is in use.
    pub fn next(&mut self, taken: impl Fn(&str) -> bool) -> String {
        if !taken(MAIN_LABEL) && self.next == 0 {
            return MAIN_LABEL.to_owned();
        }
        loop {
            self.next += 1;
            let label = format!("{DOC_PREFIX}{}", self.next);
            if !taken(&label) {
                return label;
            }
        }
    }
}

/// Whether `label` names a document window (not Show's audience window or another helper).
pub fn is_document_label(label: &str) -> bool {
    label == MAIN_LABEL
        || label
            .strip_prefix(DOC_PREFIX)
            .is_some_and(|n| !n.is_empty())
}

/// Where a new window appears: [`CASCADE`] right and down from `from` (the focused window's logical position),
/// moved back to `origin` when it would leave the screen area `bounds` (logical: x, y, width, height).
pub fn cascade(
    from: (f64, f64),
    size: (f64, f64),
    bounds: Option<(f64, f64, f64, f64)>,
) -> (f64, f64) {
    let (x, y) = (from.0 + CASCADE, from.1 + CASCADE);
    match bounds {
        Some((bx, by, bw, bh)) if x + size.0 > bx + bw || y + size.1 > by + bh => {
            (bx + CASCADE, by + CASCADE)
        }
        _ => (x, y),
    }
}

/// macOS keeps an app running after its last window closed (Dock click or File › New opens a window again);
/// Windows and Linux quit with the last window.
pub fn keeps_running_without_windows(macos: bool) -> bool {
    macos
}

/// Quit with several windows (Cmd+Q, like Pages): clean windows close at once; the dirty ones are asked one at a
/// time, the focused one first. Cancelling a question stops quitting; the windows still open stay.
#[derive(Debug, Default)]
pub struct Quit {
    active: bool,
    asking: Option<String>,
    queue: VecDeque<String>,
}

/// What the shell does next while quitting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuitStep {
    /// Ask this window (focus it and send it the close request).
    Ask(String),
    /// Nothing left to ask: exit.
    Exit,
}

impl Quit {
    /// Starts quitting with `windows` (label, dirty). Returns the clean windows to close now and the first step.
    pub fn start(
        &mut self,
        windows: &[(String, bool)],
        focused: Option<&str>,
    ) -> (Vec<String>, QuitStep) {
        self.active = true;
        self.asking = None;
        let mut dirty: Vec<String> = windows
            .iter()
            .filter(|(_, d)| *d)
            .map(|(l, _)| l.clone())
            .collect();
        if let Some(pos) = focused.and_then(|f| dirty.iter().position(|l| l == f)) {
            let first = dirty.remove(pos);
            dirty.insert(0, first);
        }
        self.queue = dirty.into();
        let clean = windows
            .iter()
            .filter(|(_, d)| !*d)
            .map(|(l, _)| l.clone())
            .collect();
        (clean, self.advance())
    }

    fn advance(&mut self) -> QuitStep {
        match self.queue.pop_front() {
            Some(label) => {
                self.asking = Some(label.clone());
                QuitStep::Ask(label)
            }
            None => QuitStep::Exit,
        }
    }

    /// Whether the app is quitting (windows that close must not keep the app alive or open a new one).
    pub fn active(&self) -> bool {
        self.active
    }

    /// A window closed. While quitting: the next step once the asked window is gone (`None`: keep waiting).
    pub fn closed(&mut self, label: &str) -> Option<QuitStep> {
        if !self.active {
            return None;
        }
        self.queue.retain(|l| l != label);
        if self.asking.as_deref() == Some(label) || self.asking.is_none() {
            return Some(self.advance());
        }
        None
    }

    /// The asked window's user chose Cancel: quitting stops.
    pub fn cancelled(&mut self, label: &str) {
        if self.asking.as_deref() == Some(label) || self.asking.is_none() {
            *self = Self::default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(label: &str, path: Option<&str>, pristine: bool) -> WindowDoc {
        WindowDoc {
            label: label.into(),
            path: path.map(PathBuf::from),
            pristine,
        }
    }

    fn paths(p: &[&str]) -> Vec<PathBuf> {
        p.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn documents_opened_before_the_first_window_go_into_it_then_new_windows() {
        let mut startup = Startup::default();
        // Cold start: two Finder documents, then a Dock drop, all before setup.
        assert_eq!(startup.hold(vec!["/a.xlsx".into(), "/b.xlsx".into()]), None);
        assert_eq!(startup.hold(vec!["/c.xlsx".into()]), None);
        let early = startup.start();
        assert_eq!(early.len(), 3);
        // Setup made the configured window: pristine and focused.
        let routes = route(early, &[win(MAIN_LABEL, None, true)], Some(MAIN_LABEL));
        let targets: Vec<_> = routes.into_iter().map(|(_, t)| t).collect();
        assert_eq!(
            targets,
            vec![Target::Window(MAIN_LABEL.into()), Target::New, Target::New]
        );
        // Started: later opens are routed at once, nothing waits.
        assert_eq!(
            startup.hold(vec!["/d.xlsx".into()]),
            Some(vec!["/d.xlsx".into()])
        );
        assert!(startup.start().is_empty());
    }

    #[test]
    fn an_empty_focused_window_is_reused() {
        let windows = [win("main", None, true)];
        assert_eq!(
            route(paths(&["/a.xlsx"]), &windows, Some("main")),
            vec![(PathBuf::from("/a.xlsx"), Target::Window("main".into()))]
        );
    }

    #[test]
    fn a_used_window_gets_a_new_one() {
        // Edited, untitled: not pristine.
        let windows = [win("main", None, false)];
        assert_eq!(
            route(paths(&["/a.xlsx"]), &windows, Some("main"))[0].1,
            Target::New
        );
        // A document is open there.
        let windows = [win("main", Some("/b.xlsx"), false)];
        assert_eq!(
            route(paths(&["/a.xlsx"]), &windows, Some("main"))[0].1,
            Target::New
        );
        // Pristine but not focused: the focused window decides.
        let windows = [
            win("main", None, true),
            win("doc-1", Some("/b.xlsx"), false),
        ];
        assert_eq!(
            route(paths(&["/a.xlsx"]), &windows, Some("doc-1"))[0].1,
            Target::New
        );
        // No focused window (macOS, all closed).
        assert_eq!(route(paths(&["/a.xlsx"]), &[], None)[0].1, Target::New);
    }

    #[test]
    fn several_files_open_one_window_each() {
        let windows = [win("main", None, true)];
        let routed = route(
            paths(&["/a.xlsx", "/b.xlsx", "/c.xlsx", "/a.xlsx"]),
            &windows,
            Some("main"),
        );
        let targets: Vec<_> = routed.into_iter().map(|(_, t)| t).collect();
        assert_eq!(
            targets,
            vec![Target::Window("main".into()), Target::New, Target::New]
        );
    }

    #[test]
    fn an_open_document_focuses_its_window() {
        let windows = [
            win("main", None, true),
            win("doc-3", Some("/a.xlsx"), false),
        ];
        let routed = route(paths(&["/a.xlsx", "/b.xlsx"]), &windows, Some("main"));
        let targets: Vec<_> = routed.into_iter().map(|(_, t)| t).collect();
        // The empty window is still used for the next document.
        assert_eq!(
            targets,
            vec![Target::Focus("doc-3".into()), Target::Window("main".into())]
        );
    }

    #[test]
    fn the_same_file_by_another_path_is_found() {
        let dir = std::env::temp_dir().join(format!("rusuite-windows-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let file = dir.join("a.xlsx");
        std::fs::write(&file, b"PK").unwrap();
        let other = dir.join("sub").join("..").join("a.xlsx");
        assert!(same_file(&file, &other));
        assert!(!same_file(&file, &dir.join("missing.xlsx")));
        let windows = [WindowDoc {
            label: "main".into(),
            path: Some(file.clone()),
            pristine: false,
        }];
        assert_eq!(
            route(vec![other], &windows, Some("main"))[0].1,
            Target::Focus("main".into())
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn labels_start_with_main_and_are_never_reused() {
        let mut labels = Labels::default();
        assert_eq!(labels.next(|_| false), "main");
        assert_eq!(labels.next(|l| l == "main"), "doc-1");
        assert_eq!(labels.next(|l| l == "main" || l == "doc-2"), "doc-3");
        // `main` closed later (macOS): new windows still get fresh labels.
        assert_eq!(labels.next(|_| false), "doc-4");
        assert!(is_document_label("main") && is_document_label("doc-4"));
        assert!(
            !is_document_label("audience")
                && !is_document_label("doc-")
                && !is_document_label("audience-doc-1")
        );
    }

    #[test]
    fn new_windows_cascade_and_stay_on_screen() {
        assert_eq!(cascade((100.0, 50.0), (1200.0, 800.0), None), (124.0, 74.0));
        let screen = Some((0.0, 0.0, 1440.0, 900.0));
        assert_eq!(
            cascade((100.0, 50.0), (1200.0, 800.0), screen),
            (124.0, 74.0)
        );
        assert_eq!(
            cascade((230.0, 90.0), (1200.0, 800.0), screen),
            (24.0, 24.0)
        );
    }

    #[test]
    fn only_macos_keeps_running_without_windows() {
        assert!(keeps_running_without_windows(true));
        assert!(!keeps_running_without_windows(false));
        assert_eq!(
            keeps_running_without_windows(cfg!(target_os = "macos")),
            cfg!(target_os = "macos")
        );
    }

    #[test]
    fn quit_asks_dirty_windows_one_at_a_time_focused_first() {
        let mut quit = Quit::default();
        assert!(!quit.active());
        let windows = [
            ("main".to_owned(), true),
            ("doc-1".to_owned(), false),
            ("doc-2".to_owned(), true),
        ];
        let (clean, step) = quit.start(&windows, Some("doc-2"));
        assert!(quit.active());
        assert_eq!(clean, vec!["doc-1".to_owned()]);
        assert_eq!(step, QuitStep::Ask("doc-2".into()));
        // A clean window closing does not move on; the asked one does.
        assert_eq!(quit.closed("doc-1"), None);
        assert_eq!(quit.closed("doc-2"), Some(QuitStep::Ask("main".into())));
        assert_eq!(quit.closed("main"), Some(QuitStep::Exit));
    }

    #[test]
    fn cancel_stops_quitting() {
        let mut quit = Quit::default();
        let windows = [("main".to_owned(), true), ("doc-1".to_owned(), true)];
        assert_eq!(quit.start(&windows, None).1, QuitStep::Ask("main".into()));
        // Another window's cancel (not asked) changes nothing.
        quit.cancelled("doc-1");
        assert!(quit.active());
        quit.cancelled("main");
        assert!(!quit.active());
        assert_eq!(quit.closed("main"), None);
        // Nothing dirty: exit at once.
        let (clean, step) = quit.start(&[("main".to_owned(), false)], Some("main"));
        assert_eq!((clean, step), (vec!["main".to_owned()], QuitStep::Exit));
    }
}
