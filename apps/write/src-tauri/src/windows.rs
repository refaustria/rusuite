//! One window per document (P11-D2): every document window has its own [`Doc`] (the core's host, the file
//! binding, the close guard and the documents routed to it), kept in [`Docs`] by window label. Every document
//! command takes the calling window's document ([`CurrentDoc`]), so the page's `invoke` calls stay as they were.
//! Shared across windows: the session store (recent list, recovery), settings, connections, the AI assistant and
//! the single instance.
//!
//! Opening (dialog, Finder / Explorer, a drop, a recent file, a second start) follows
//! [`app_common::windows::route`]: an untitled, unmodified, empty focused window takes the document, otherwise a
//! new window opens (cascaded from the focused one, same size), and a document already open only brings its window
//! to the front. File › New opens a new window. macOS keeps running without windows (Dock click or File › New
//! opens one) and has a Window menu; Quit asks each window with unsaved changes in turn ([`quit`]).
//! This file is identical in the three document shells; the app's host is [`crate::HostState`].

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use app_common::launch::LaunchQueue;
use app_common::windows::{self as rules, Labels, Quit, QuitStep, WindowDoc};

use crate::{CloseGuard, DocPath, HostState};

/// One window's document.
#[derive(Default)]
pub struct Doc {
    /// The core's host (document, undo, revision, dirty flag).
    pub host: HostState,
    /// The file the document is bound to.
    pub path: DocPath,
    /// Holds close requests while the document is dirty.
    pub guard: CloseGuard,
    /// Documents routed to this window that its page has not taken yet.
    pub launch: LaunchQueue,
}

impl Doc {
    /// Untitled, unmodified and empty, nothing waiting: an opened document may go into this window.
    pub fn pristine(&self) -> bool {
        self.path.untouched() && !self.guard.is_set() && self.launch.is_empty()
    }

    /// The file this window holds or is about to open.
    pub fn file(&self) -> Option<PathBuf> {
        self.path
            .bound()
            .or_else(|| self.launch.first_openable(crate::OPEN_EXTENSIONS))
    }
}

/// The documents of all windows (Tauri-managed).
#[derive(Default)]
pub struct Docs(Mutex<Registry>);

#[derive(Default)]
struct Registry {
    docs: HashMap<String, Arc<Doc>>,
    /// Document windows, the most recently focused last.
    order: Vec<String>,
    labels: Labels,
    quit: Quit,
    /// Recovery entry id → the window whose document autosaves it (not offered to other windows as a crash copy).
    recovery: HashMap<String, String>,
}

impl Docs {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The document of window `label` (a new, empty one the first time).
    pub fn doc(&self, label: &str) -> Arc<Doc> {
        let mut reg = self.lock();
        if rules::is_document_label(label) && !reg.order.iter().any(|l| l == label) {
            reg.order.insert(0, label.to_owned());
        }
        reg.docs.entry(label.to_owned()).or_default().clone()
    }

    /// The document of window `label`, if it has one.
    pub fn get(&self, label: &str) -> Option<Arc<Doc>> {
        self.lock().docs.get(label).cloned()
    }

    /// The label for a new window (`taken`: whether a window of that label exists).
    pub fn next_label(&self, taken: impl Fn(&str) -> bool) -> String {
        self.lock().labels.next(taken)
    }

    /// Window `label` came to the front.
    pub fn focus(&self, label: &str) {
        if !rules::is_document_label(label) {
            return;
        }
        let mut reg = self.lock();
        reg.order.retain(|l| l != label);
        reg.order.push(label.to_owned());
    }

    /// The document window most recently in front.
    pub fn focused(&self) -> Option<String> {
        self.lock().order.last().cloned()
    }

    /// What the router needs to know about every document window.
    pub fn windows(&self) -> Vec<WindowDoc> {
        let reg = self.lock();
        reg.order
            .iter()
            .filter_map(|label| {
                let doc = reg.docs.get(label)?;
                Some(WindowDoc {
                    label: label.clone(),
                    path: doc.file(),
                    pristine: doc.pristine(),
                })
            })
            .collect()
    }

    /// Window `label` closed: its document is dropped. While quitting: what to do next.
    pub fn remove(&self, label: &str) -> Option<QuitStep> {
        let mut reg = self.lock();
        reg.docs.remove(label);
        reg.order.retain(|l| l != label);
        reg.recovery.retain(|_, owner| owner != label);
        if rules::is_document_label(label) {
            reg.quit.closed(label)
        } else {
            None
        }
    }

    /// Window `label` autosaved recovery entry `id`.
    pub fn own_recovery(&self, id: &str, label: &str) {
        self.lock().recovery.insert(id.to_owned(), label.to_owned());
    }

    /// The recovery entries other open windows autosave (their documents are open, not lost).
    pub fn recovery_of_others(&self, label: &str) -> Vec<String> {
        let reg = self.lock();
        reg.recovery
            .iter()
            .filter(|(_, owner)| *owner != label)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Starts quitting with the open document windows (label, dirty); see [`Quit::start`].
    pub fn quit_start(&self, windows: &[(String, bool)]) -> (Vec<String>, QuitStep) {
        let mut reg = self.lock();
        let focused = reg.order.last().cloned();
        reg.quit.start(windows, focused.as_deref())
    }

    pub fn quitting(&self) -> bool {
        self.lock().quit.active()
    }

    /// Window `label`'s user cancelled its close question.
    pub fn close_cancelled(&self, label: &str) {
        self.lock().quit.cancelled(label);
    }
}

/// The calling window's document: a command argument (`doc: CurrentDoc`) resolved from the invoking webview.
pub struct CurrentDoc {
    pub label: String,
    pub doc: Arc<Doc>,
}

impl std::ops::Deref for CurrentDoc {
    type Target = Doc;
    fn deref(&self) -> &Doc {
        &self.doc
    }
}

impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for CurrentDoc {
    fn from_command(cmd: tauri::ipc::CommandItem<'de, R>) -> Result<Self, tauri::ipc::InvokeError> {
        use tauri::Manager as _;
        let webview = cmd.message.webview_ref();
        let label = webview.label().to_owned();
        let doc = webview.state::<Docs>().doc(&label);
        Ok(CurrentDoc { label, doc })
    }
}

/// The page tells the shell that its user cancelled the close question (stops quitting).
#[tauri::command]
pub fn close_cancelled(window: tauri::Window, docs: tauri::State<'_, Docs>) {
    docs.close_cancelled(window.label());
}

#[cfg(desktop)]
pub use desktop::*;

#[cfg(desktop)]
mod desktop {
    use std::path::PathBuf;

    use app_common::launch::openable;
    use app_common::windows::{self as rules, QuitStep, Target};
    use serde::Deserialize;
    use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

    use super::Docs;
    use crate::launch::OPEN_DOCUMENT_EVENT;
    use crate::CLOSE_REQUESTED_EVENT;

    /// Menu ids of the shell's own items.
    const MENU_NEW: &str = "rusuite-new-window";
    const MENU_QUIT: &str = "rusuite-quit";

    /// The open document windows.
    fn document_windows(app: &AppHandle) -> Vec<WebviewWindow> {
        app.webview_windows()
            .into_values()
            .filter(|w| rules::is_document_label(w.label()))
            .collect()
    }

    /// Brings a window to the front (also out of the Dock / taskbar).
    pub fn bring_to_front(window: &WebviewWindow) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    /// The logical position and inner size of `window` and its monitor's area, for [`rules::cascade`].
    type Placement = ((f64, f64), (f64, f64), Option<(f64, f64, f64, f64)>);

    fn placement(window: &WebviewWindow) -> Option<Placement> {
        let scale = window.scale_factor().ok()?;
        let pos = window.outer_position().ok()?.to_logical::<f64>(scale);
        let size = window.inner_size().ok()?.to_logical::<f64>(scale);
        let bounds = window.current_monitor().ok().flatten().map(|m| {
            let k = m.scale_factor();
            let p = m.position().to_logical::<f64>(k);
            let s = m.size().to_logical::<f64>(k);
            (p.x, p.y, s.width, s.height)
        });
        Some(((pos.x, pos.y), (size.width, size.height), bounds))
    }

    /// Opens a new document window (the configured window under a new label), cascaded from the focused one with
    /// its size; `paths` wait for its page. Never from a synchronous command (deadlocks on Windows).
    pub fn create(app: &AppHandle, paths: Vec<PathBuf>) -> tauri::Result<WebviewWindow> {
        let docs = app.state::<Docs>();
        let from = docs.focused().and_then(|l| app.get_webview_window(&l));
        let label = docs.next_label(|l| app.get_webview_window(l).is_some());
        docs.doc(&label).launch.push(paths);
        let mut config = app
            .config()
            .app
            .windows
            .first()
            .cloned()
            .unwrap_or_default();
        config.label.clone_from(&label);
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, &config)?;
        if let Some((pos, size, bounds)) = from.as_ref().and_then(placement) {
            let (x, y) = rules::cascade(pos, size, bounds);
            builder = builder.position(x, y).inner_size(size.0, size.1);
        }
        let window = builder.focused(true).build()?;
        docs.focus(&label);
        Ok(window)
    }

    /// [`create`] off the calling thread, one window per entry of `windows` in order (each cascaded from the one
    /// before): the OS events that open windows (drops, menu, a second start) run on the event loop, where building
    /// a window deadlocks on Windows.
    pub fn spawn_create(app: &AppHandle, windows: Vec<Vec<PathBuf>>) {
        if windows.is_empty() {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            for paths in windows {
                let _ = create(&app, paths);
            }
        });
    }

    /// The registry with every open document window (the configured one has no document until its page calls).
    fn registry(app: &AppHandle) -> tauri::State<'_, Docs> {
        let docs = app.state::<Docs>();
        for window in document_windows(app) {
            docs.doc(window.label());
        }
        docs
    }

    /// Hands `paths` to window `label`'s page (it opens the first, names unsupported ones).
    fn deliver(app: &AppHandle, label: &str, paths: Vec<PathBuf>) {
        let doc = app.state::<Docs>().doc(label);
        if !doc.launch.push(paths) {
            return;
        }
        if let Some(window) = app.get_webview_window(label) {
            bring_to_front(&window);
            let _ = window.emit_to(EventTarget::labeled(label), OPEN_DOCUMENT_EVENT, ());
        }
    }

    /// Opens documents from the OS (`here`: the window they were dropped on, else the focused one) by the rules
    /// of [`rules::route`]. Files of other types are named by that window (a new one when none is open).
    pub fn open(
        app: &AppHandle,
        paths: Vec<PathBuf>,
        here: Option<&str>,
    ) -> Vec<(PathBuf, Target)> {
        if paths.is_empty() {
            return Vec::new();
        }
        let docs = registry(app);
        let (paths, unsupported): (Vec<_>, Vec<_>) = paths
            .into_iter()
            .partition(|p| openable(p, crate::OPEN_EXTENSIONS));
        let focused = here
            .map(str::to_owned)
            .or_else(|| docs.focused())
            .filter(|l| app.get_webview_window(l).is_some());
        let routes = rules::route(paths, &docs.windows(), focused.as_deref());
        let mut new = Vec::new();
        for (path, target) in &routes {
            match target {
                Target::Window(label) => deliver(app, label, vec![path.clone()]),
                Target::Focus(label) => {
                    if let Some(window) = app.get_webview_window(label) {
                        bring_to_front(&window);
                    }
                }
                Target::New => new.push(vec![path.clone()]),
            }
        }
        if !unsupported.is_empty() {
            match focused {
                Some(label) => deliver(app, &label, unsupported),
                None => new.push(unsupported),
            }
        }
        spawn_create(app, new);
        routes
    }

    /// The open dialog or the recent list of window `here` picked `path`: `true` when that window opens it
    /// itself (it is pristine); otherwise the document's own window comes to the front or a new window opens it.
    pub fn open_here(app: &AppHandle, here: &str, path: PathBuf) -> bool {
        let docs = registry(app);
        let routes = rules::route(vec![path.clone()], &docs.windows(), Some(here));
        match routes.first().map(|(_, t)| t) {
            Some(Target::Window(label)) if label == here => true,
            Some(Target::Focus(label)) => {
                if let Some(window) = app.get_webview_window(label) {
                    bring_to_front(&window);
                }
                false
            }
            _ => {
                spawn_create(app, vec![vec![path]]);
                false
            }
        }
    }

    /// Asks window `label` to close (it asks about unsaved changes); one that is gone moves on.
    fn ask_close(app: &AppHandle, label: &str) {
        match app.get_webview_window(label) {
            Some(window) => {
                bring_to_front(&window);
                let _ = window.emit_to(EventTarget::labeled(label), CLOSE_REQUESTED_EVENT, ());
            }
            None => {
                if let Some(step) = app.state::<Docs>().remove(label) {
                    quit_step(app, step);
                }
            }
        }
    }

    fn quit_step(app: &AppHandle, step: QuitStep) {
        match step {
            QuitStep::Ask(label) => ask_close(app, &label),
            QuitStep::Exit => app.exit(0),
        }
    }

    /// Quit (macOS Cmd+Q, like Pages): windows without unsaved changes close, then each dirty window is brought to
    /// the front and asks Save / Don't save / Cancel in turn; Cancel stops quitting.
    pub fn quit(app: &AppHandle) {
        let docs = app.state::<Docs>();
        let windows: Vec<(String, bool)> = document_windows(app)
            .iter()
            .map(|w| {
                let dirty = docs.get(w.label()).is_some_and(|d| d.guard.is_set());
                (w.label().to_owned(), dirty)
            })
            .collect();
        let (clean, step) = docs.quit_start(&windows);
        for label in clean {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
        quit_step(app, step);
    }

    /// The shell's part of the window events: the close guard, focus, closed windows and dropped files.
    pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
        let label = window.label();
        let app = window.app_handle();
        let docs = window.state::<Docs>();
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if docs.get(label).is_some_and(|d| d.guard.hold_close()) {
                    api.prevent_close();
                    let _ = window.emit_to(EventTarget::labeled(label), CLOSE_REQUESTED_EVENT, ());
                }
            }
            tauri::WindowEvent::Focused(true) => docs.focus(label),
            tauri::WindowEvent::Destroyed => {
                if let Some(step) = docs.remove(label) {
                    quit_step(app, step);
                }
            }
            // Files dropped onto a window from the OS (P11-D1).
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. })
                if rules::is_document_label(label) =>
            {
                open(app, paths.clone(), Some(label));
            }
            _ => {}
        }
    }

    /// The shell's part of the app events: macOS keeps running without windows, opens one on a Dock click, and
    /// gets Finder / Dock documents as `Opened`.
    pub fn on_run_event(app: &AppHandle, event: &tauri::RunEvent) {
        match event {
            tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } if rules::keeps_running_without_windows(cfg!(target_os = "macos"))
                && !app.state::<Docs>().quitting() =>
            {
                api.prevent_exit();
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                open(app, crate::launch::url_paths(urls), None);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => reopen(app, *has_visible_windows),
            _ => {}
        }
    }

    /// A Dock click (or a start without a document while running): a window to work in.
    pub fn reopen(app: &AppHandle, has_visible_windows: bool) {
        if app.state::<Docs>().quitting() {
            return;
        }
        let windows = document_windows(app);
        if windows.is_empty() {
            spawn_create(app, vec![Vec::new()]);
        } else if !has_visible_windows {
            let docs = app.state::<Docs>();
            let front = docs
                .focused()
                .and_then(|l| app.get_webview_window(&l))
                .or_else(|| windows.into_iter().next());
            if let Some(window) = front {
                bring_to_front(&window);
            }
        }
    }

    /// File › New (Cmd/Ctrl+N): an untitled document in a new window.
    #[tauri::command]
    pub async fn window_new(app: AppHandle) -> Result<(), String> {
        create(&app, Vec::new())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// The texts of the macOS menu bar, localized by the page (`menu.*`); `{app}` stands for the app's name.
    #[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    pub struct MenuTexts {
        pub about: String,
        pub services: String,
        pub hide: String,
        pub hide_others: String,
        pub show_all: String,
        pub quit: String,
        pub file: String,
        pub new_window: String,
        pub close_window: String,
        pub edit: String,
        pub undo: String,
        pub redo: String,
        pub cut: String,
        pub copy: String,
        pub paste: String,
        pub select_all: String,
        pub view: String,
        pub fullscreen: String,
        pub window: String,
        pub minimize: String,
        pub zoom: String,
        pub bring_all_to_front: String,
    }

    impl Default for MenuTexts {
        fn default() -> Self {
            let s = |v: &str| v.to_owned();
            MenuTexts {
                about: s("About {app}"),
                services: s("Services"),
                hide: s("Hide {app}"),
                hide_others: s("Hide Others"),
                show_all: s("Show All"),
                quit: s("Quit {app}"),
                file: s("File"),
                new_window: s("New"),
                close_window: s("Close Window"),
                edit: s("Edit"),
                undo: s("Undo"),
                redo: s("Redo"),
                cut: s("Cut"),
                copy: s("Copy"),
                paste: s("Paste"),
                select_all: s("Select All"),
                view: s("View"),
                fullscreen: s("Enter Full Screen"),
                window: s("Window"),
                minimize: s("Minimize"),
                zoom: s("Zoom"),
                bring_all_to_front: s("Bring All to Front"),
            }
        }
    }

    /// The macOS menu bar: Tauri's default menu with the shell's File › New (Cmd+N) and Quit (Cmd+Q, which asks
    /// about unsaved changes instead of terminating) and a Window menu that macOS fills with the open windows
    /// ([`tauri::menu::WINDOW_SUBMENU_ID`]). Built on every desktop (checked everywhere), set on macOS only.
    pub fn menu(app: &AppHandle, t: &MenuTexts) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
        use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem as P, Submenu};
        let info = app.package_info();
        let name = info.name.clone();
        let named = |s: &str| s.replace("{app}", &name);
        let about = AboutMetadata {
            name: Some(name.clone()),
            version: Some(info.version.to_string()),
            copyright: app.config().bundle.copyright.clone(),
            ..Default::default()
        };
        let app_menu = Submenu::with_items(
            app,
            &name,
            true,
            &[
                &P::about(app, Some(&named(&t.about)), Some(about))?,
                &P::separator(app)?,
                &P::services(app, Some(&t.services))?,
                &P::separator(app)?,
                &P::hide(app, Some(&named(&t.hide)))?,
                &P::hide_others(app, Some(&t.hide_others))?,
                &P::show_all(app, Some(&t.show_all))?,
                &P::separator(app)?,
                &MenuItem::with_id(app, MENU_QUIT, named(&t.quit), true, Some("CmdOrCtrl+Q"))?,
            ],
        )?;
        let file = Submenu::with_items(
            app,
            &t.file,
            true,
            &[
                &MenuItem::with_id(app, MENU_NEW, &t.new_window, true, Some("CmdOrCtrl+N"))?,
                &P::separator(app)?,
                &P::close_window(app, Some(&t.close_window))?,
            ],
        )?;
        let edit = Submenu::with_items(
            app,
            &t.edit,
            true,
            &[
                &P::undo(app, Some(&t.undo))?,
                &P::redo(app, Some(&t.redo))?,
                &P::separator(app)?,
                &P::cut(app, Some(&t.cut))?,
                &P::copy(app, Some(&t.copy))?,
                &P::paste(app, Some(&t.paste))?,
                &P::select_all(app, Some(&t.select_all))?,
            ],
        )?;
        let view = Submenu::with_items(
            app,
            &t.view,
            true,
            &[&P::fullscreen(app, Some(&t.fullscreen))?],
        )?;
        let window = Submenu::with_id_and_items(
            app,
            tauri::menu::WINDOW_SUBMENU_ID,
            &t.window,
            true,
            &[
                &P::minimize(app, Some(&t.minimize))?,
                &P::maximize(app, Some(&t.zoom))?,
                &P::separator(app)?,
                &P::bring_all_to_front(app, Some(&t.bring_all_to_front))?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
    }

    /// Wires the menu (macOS) into the builder.
    pub fn with_menu(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        #[cfg(target_os = "macos")]
        let builder = builder.menu(|app| menu(app, &MenuTexts::default()));
        builder.on_menu_event(|app, event| match event.id().as_ref() {
            MENU_NEW => {
                if !app.state::<Docs>().quitting() {
                    spawn_create(app, vec![Vec::new()]);
                }
            }
            MENU_QUIT => quit(app),
            _ => {}
        })
    }

    /// The last menu texts set ([`menu_texts`] rebuilds the menu only when they change).
    #[derive(Default)]
    pub struct MenuState(std::sync::Mutex<Option<MenuTexts>>);

    /// The page's localized menu texts (each window sends them when it starts; macOS only, elsewhere ignored).
    #[tauri::command]
    pub fn menu_texts(
        app: AppHandle,
        texts: MenuTexts,
        state: tauri::State<'_, MenuState>,
    ) -> Result<(), String> {
        let mut last = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if last.as_ref() == Some(&texts) {
            return Ok(());
        }
        if cfg!(target_os = "macos") {
            let menu = menu(&app, &texts).map_err(|e| e.to_string())?;
            app.set_menu(menu).map_err(|e| e.to_string())?;
        }
        *last = Some(texts);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_window_is_pristine_until_used() {
        let docs = Docs::default();
        let doc = docs.doc("main");
        assert!(doc.pristine());
        doc.guard.set(true);
        assert!(!doc.pristine(), "unsaved changes");
        doc.guard.set(false);
        doc.path.set(Some(PathBuf::from("/d/a.xlsx")));
        assert!(!doc.pristine(), "bound to a file");
        assert_eq!(doc.file(), Some(PathBuf::from("/d/a.xlsx")));
        let other = docs.doc("doc-1");
        let ext = crate::OPEN_EXTENSIONS[0];
        other.launch.push([PathBuf::from(format!("/d/b.{ext}"))]);
        assert!(!other.pristine(), "a document waits");
        assert_eq!(other.file(), Some(PathBuf::from(format!("/d/b.{ext}"))));
        // Each window has its own document.
        assert!(!Arc::ptr_eq(&doc, &other));
        assert!(Arc::ptr_eq(&doc, &docs.doc("main")));
    }

    #[test]
    fn registry_tracks_focus_close_and_recovery_owners() {
        let docs = Docs::default();
        docs.doc("main");
        docs.doc("doc-1");
        docs.doc("audience");
        docs.focus("doc-1");
        docs.focus("audience");
        assert_eq!(docs.focused().as_deref(), Some("doc-1"));
        let labels: Vec<_> = docs.windows().into_iter().map(|w| w.label).collect();
        assert_eq!(labels, vec!["main".to_owned(), "doc-1".to_owned()]);
        docs.own_recovery("r-main", "main");
        docs.own_recovery("r-doc", "doc-1");
        assert_eq!(docs.recovery_of_others("main"), vec!["r-doc".to_owned()]);
        assert_eq!(docs.remove("doc-1"), None);
        assert!(docs.get("doc-1").is_none());
        assert_eq!(docs.focused().as_deref(), Some("main"));
        assert!(docs.recovery_of_others("main").is_empty());
        assert_eq!(docs.next_label(|l| l == "main"), "doc-1");
    }

    #[test]
    fn quitting_moves_on_when_the_asked_window_closes() {
        let docs = Docs::default();
        docs.doc("main");
        docs.doc("doc-1");
        docs.focus("doc-1");
        let windows = [("main".to_owned(), true), ("doc-1".to_owned(), true)];
        let (clean, step) = docs.quit_start(&windows);
        assert!(clean.is_empty() && docs.quitting());
        assert_eq!(step, QuitStep::Ask("doc-1".into()));
        assert_eq!(docs.remove("doc-1"), Some(QuitStep::Ask("main".into())));
        docs.close_cancelled("main");
        assert!(!docs.quitting());
        assert_eq!(docs.remove("main"), None);
    }
}
