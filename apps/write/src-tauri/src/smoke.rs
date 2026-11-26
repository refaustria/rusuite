//! `--smoke` (P8-41): a start-up check for release builds, run by CI on
//! every platform (`.github/workflows/release.yml`, job `smoke`).
//!
//! `app-<name> --smoke` opens the normal main window; once its page has
//! loaded, a script waits for the UI to render and makes a real IPC round
//! trip (`ping`, then `dispatch` with `documentState`), then reports to
//! [`Smoke::finish`]. That checks the reply, the native window title and
//! the version, prints `ok <ping> | <title>` and exits 0 – or prints
//! `smoke: FAIL …` to stderr and exits 1 (2 after [`TIMEOUT`]). The same
//! line also goes to the file named by `RUSUITE_SMOKE_OUT`, if set (a GUI
//! subsystem binary on Windows may have no usable stdout). Without the flag
//! nothing here runs. This file is identical in the three shells.
//!
//! `app-<name> --smoke <file>` (P11-D1) also checks the "open with" path: the shell got the document on its
//! command line, so the page must open it on start – the binary waits until the window title names the file,
//! the document is bound to it (the core opened it) and it is on the recent list ([`check_opened`]).
//!
//! `app-<name> --smoke <file> <file> …` (P11-D2) also checks one window per document ([`check_windows`]): each
//! file opens in its own window with its name in the title (the first in the configured window, no window left
//! empty: the files are offered before setup, as macOS hands a cold start's Finder documents), opening the second file again only brings its window
//! to the front, and closing that window (its close guard held, then released by its own page) leaves the first
//! window with its document.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;

/// The command-line flag.
pub const FLAG: &str = "--smoke";

/// How long the whole check may take before the process gives up.
pub const TIMEOUT: Duration = Duration::from_secs(120);

/// Run in the main webview once it has loaded (the IPC bridge is injected
/// by Tauri into every page).
pub const SCRIPT: &str = r#"(async () => {
  const ipc = window.__TAURI_INTERNALS__;
  const report = (r) => ipc.invoke("smoke_report", { report: r });
  try {
    const t0 = Date.now();
    while (!(document.getElementById("root")?.childElementCount > 0)) {
      if (Date.now() - t0 > 60000) throw new Error("the UI did not render within 60 s");
      await new Promise((r) => setTimeout(r, 100));
    }
    const ping = await ipc.invoke("ping");
    const reply = await ipc.invoke("dispatch", { request: JSON.stringify({ type: "documentState" }) });
    await report({ ping, reply, error: null });
  } catch (e) {
    await report({ ping: null, reply: null, error: String(e) });
  }
})();"#;

/// What the page sends back.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct Report {
    pub ping: Option<String>,
    pub reply: Option<String>,
    pub error: Option<String>,
}

/// Tauri-managed smoke state: off unless the process got [`FLAG`].
#[derive(Debug, Default)]
pub struct Smoke {
    enabled: bool,
    started: AtomicBool,
    /// The documents of the command line: the main window's page must open the first, each further one gets a
    /// window of its own.
    files: Vec<PathBuf>,
}

impl Smoke {
    /// The state for this process's command line.
    pub fn from_args() -> Self {
        let mut smoke = Smoke::new(std::env::args().skip(1).any(|a| a == FLAG));
        let cwd = std::env::current_dir().unwrap_or_default();
        smoke.files = app_common::launch::paths_from_args(std::env::args(), &cwd);
        smoke
    }

    pub fn new(enabled: bool) -> Self {
        Smoke {
            enabled,
            started: AtomicBool::new(false),
            files: Vec::new(),
        }
    }

    /// `--smoke <file>`: the document the page must have opened.
    pub fn file(&self) -> Option<&Path> {
        self.files().first().map(PathBuf::as_path)
    }

    /// `--smoke <file> <file> …`: every document of the command line.
    pub fn files(&self) -> &[PathBuf] {
        if self.enabled {
            &self.files
        } else {
            &[]
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// True exactly once in smoke mode: the caller then runs [`SCRIPT`] and
    /// starts the [`TIMEOUT`] watchdog.
    pub fn start(&self) -> bool {
        self.enabled && !self.started.swap(true, Ordering::SeqCst)
    }

    /// Exits the process with the result of the page's [`Report`]; does
    /// nothing outside smoke mode.
    pub fn finish(&self, app: &str, title: &str, report: &Report) {
        if !self.enabled {
            return;
        }
        match check(app, env!("CARGO_PKG_VERSION"), title, report) {
            Ok(line) => {
                let line = format!("ok {line}");
                println!("{line}");
                let _ = std::io::stdout().flush();
                write_out(&line);
                std::process::exit(0);
            }
            Err(e) => fail(1, &e),
        }
    }
}

/// Starts a thread that ends the process with exit code 2 after [`TIMEOUT`].
pub fn watchdog() {
    std::thread::spawn(|| {
        std::thread::sleep(TIMEOUT);
        fail(2, &format!("no report within {} s", TIMEOUT.as_secs()));
    });
}

fn fail(code: i32, message: &str) -> ! {
    let line = format!("smoke: FAIL {message}");
    eprintln!("{line}");
    let _ = std::io::stderr().flush();
    write_out(&line);
    std::process::exit(code);
}

/// The result line into `RUSUITE_SMOKE_OUT` (best effort).
fn write_out(line: &str) {
    if let Some(path) = std::env::var_os("RUSUITE_SMOKE_OUT") {
        let _ = std::fs::write(path, format!("{line}\n"));
    }
}

/// `--smoke <file>`: the window title names `file`, the document is bound to it (`bound`: the shell's current
/// file, set once the core opened it) and it is on the recent list (`recent`: the paths).
pub fn check_opened(
    file: &Path,
    title: &str,
    bound: Option<&Path>,
    recent: &[String],
) -> Result<(), String> {
    let name = file
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    if !title.contains(&name) {
        return Err(format!(
            "window title {title:?} lacks the opened file {name:?}"
        ));
    }
    if bound != Some(file) {
        return Err(format!("document bound to {bound:?}, expected {file:?}"));
    }
    let path = file.to_string_lossy();
    if !recent.iter().any(|r| *r == path) {
        return Err(format!("{path} is not on the recent list {recent:?}"));
    }
    Ok(())
}

/// Waits up to `secs` for `done` (polling off the async runtime's workers).
#[cfg(desktop)]
async fn wait_for(secs: u64, mut done: impl FnMut() -> Result<(), String>) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    loop {
        match done() {
            Ok(()) => return Ok(()),
            Err(e) if t0.elapsed() > Duration::from_secs(secs) => return Err(e),
            Err(_) => {
                let pause = || std::thread::sleep(Duration::from_millis(200));
                let _ = tauri::async_runtime::spawn_blocking(pause).await;
            }
        }
    }
}

/// `--smoke <file> <file> …` (P11-D2): one window per document. Each file is bound in its own window whose title
/// names it; opening the second again focuses its window (no new one); closing that window is held by its close
/// guard and goes to its own page, which closes it; the first window keeps its document.
#[cfg(desktop)]
pub async fn check_windows(app: &tauri::AppHandle, files: &[PathBuf]) -> Result<String, String> {
    use app_common::windows::{is_document_label, Target};
    use tauri::Manager as _;
    let docs = app.state::<crate::windows::Docs>();
    let open_windows = || -> Vec<tauri::WebviewWindow> {
        app.webview_windows()
            .into_values()
            .filter(|w| is_document_label(w.label()))
            .collect()
    };
    let window_of = |file: &Path| -> Result<tauri::WebviewWindow, String> {
        let name = file
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let w = open_windows()
            .into_iter()
            .find(|w| {
                docs.get(w.label())
                    .and_then(|d| d.path.current())
                    .as_deref()
                    == Some(file)
            })
            .ok_or_else(|| format!("no window holds {}", file.display()))?;
        let title = w.title().unwrap_or_default();
        if !title.contains(&name) {
            return Err(format!(
                "window {} has title {title:?}, expected {name:?}",
                w.label()
            ));
        }
        Ok(w)
    };
    wait_for(60, || {
        let n = open_windows().len();
        if n != files.len() {
            return Err(format!("{n} windows open for {} documents", files.len()));
        }
        files.iter().try_for_each(|f| window_of(f).map(|_| ()))
    })
    .await?;
    let first = window_of(&files[0])?;
    let second = window_of(&files[1])?;
    if first.label() == second.label() {
        return Err("two documents in one window".into());
    }
    // The command line came before setup (as a macOS cold start's Finder open does): the configured window takes
    // the first document, and no empty window is left over, also a moment later.
    if first.label() != app_common::windows::MAIN_LABEL {
        return Err(format!(
            "the first document opened in {}, not in the configured window",
            first.label()
        ));
    }
    let _ = wait_for(1, || Err(String::new())).await;
    let n = open_windows().len();
    if n != files.len() {
        return Err(format!(
            "{n} windows for {} documents after starting",
            files.len()
        ));
    }
    let mut labels: Vec<String> = open_windows()
        .iter()
        .map(|w| w.label().to_owned())
        .collect();
    labels.sort();
    // The same document again: its window comes to the front, no new one.
    let routes = crate::windows::open(app, vec![files[1].clone()], Some(first.label()));
    if routes.iter().map(|(_, t)| t).collect::<Vec<_>>()
        != vec![&Target::Focus(second.label().to_owned())]
    {
        return Err(format!(
            "opening {} again routed {routes:?}",
            files[1].display()
        ));
    }
    let _ = wait_for(1, || Err(String::new())).await;
    if open_windows().len() != files.len() {
        return Err("opening an open document again made a new window".into());
    }
    // Closing the second window while its document counts as dirty: the shell holds the close and asks that
    // window's page only (its document is clean, so it closes without a question).
    let label = second.label().to_owned();
    docs.get(&label)
        .ok_or("no document for the second window")?
        .guard
        .set(true);
    second.close().map_err(|e| e.to_string())?;
    if app.get_webview_window(&label).is_none() {
        return Err("the close guard did not hold the close".into());
    }
    wait_for(30, || match app.get_webview_window(&label) {
        Some(_) => Err(format!(
            "window {label} did not close after its page answered"
        )),
        None => Ok(()),
    })
    .await?;
    if docs.get(&label).is_some() {
        return Err(format!(
            "the document of closed window {label} is still kept"
        ));
    }
    // The first window still holds its document.
    let first = window_of(&files[0]).map_err(|e| format!("after closing {label}: {e}"))?;
    Ok(format!(
        "windows {} → {} closed, {} kept",
        labels.join("+"),
        label,
        first.label()
    ))
}

/// The checks: no script error, `ping` names the app and this version, the
/// core answered `documentState` (clean, untitled-or-named document) and
/// the native window title names the app.
pub fn check(app: &str, version: &str, title: &str, report: &Report) -> Result<String, String> {
    if let Some(e) = &report.error {
        return Err(format!("page script: {e}"));
    }
    let ping = report.ping.as_deref().ok_or("no ping reply")?;
    let expected = format!("{app} {version}");
    if ping != expected {
        return Err(format!("ping answered {ping:?}, expected {expected:?}"));
    }
    let reply = report.reply.as_deref().ok_or("no dispatch reply")?;
    let reply: serde_json::Value =
        serde_json::from_str(reply).map_err(|e| format!("dispatch reply is not JSON: {e}"))?;
    let state = reply
        .get("ok")
        .ok_or_else(|| format!("dispatch failed: {reply}"))?;
    if state.get("dirty") != Some(&serde_json::Value::Bool(false)) {
        return Err(format!("unexpected documentState: {state}"));
    }
    if !title.contains(app) {
        return Err(format!("window title {title:?} lacks {app:?}"));
    }
    Ok(format!("{ping} | {title}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(ping: &str, reply: &str) -> Report {
        Report {
            ping: Some(ping.into()),
            reply: Some(reply.into()),
            error: None,
        }
    }

    #[test]
    fn check_accepts_a_clean_round_trip() {
        let r = report("Rusuite X 1.2.3", r#"{"ok":{"dirty":false,"name":null}}"#);
        assert_eq!(
            check("Rusuite X", "1.2.3", "Untitled – Rusuite X", &r).unwrap(),
            "Rusuite X 1.2.3 | Untitled – Rusuite X"
        );
    }

    #[test]
    fn check_rejects_each_failure() {
        let good = r#"{"ok":{"dirty":false}}"#;
        let title = "Rusuite X";
        assert!(check(
            "Rusuite X",
            "1.0.0",
            title,
            &report("Rusuite X 0.9.0", good)
        )
        .is_err());
        assert!(check("Rusuite X", "1.0.0", title, &report("Rusuite X 1.0.0", "{")).is_err());
        let err = r#"{"err":{"code":"x"}}"#;
        assert!(check("Rusuite X", "1.0.0", title, &report("Rusuite X 1.0.0", err)).is_err());
        let dirty = r#"{"ok":{"dirty":true}}"#;
        assert!(check(
            "Rusuite X",
            "1.0.0",
            title,
            &report("Rusuite X 1.0.0", dirty)
        )
        .is_err());
        let r = report("Rusuite X 1.0.0", good);
        assert!(check("Rusuite X", "1.0.0", "Other", &r).is_err());
        let failed = Report {
            error: Some("boom".into()),
            ..r
        };
        assert!(check("Rusuite X", "1.0.0", title, &failed)
            .unwrap_err()
            .contains("boom"));
    }

    #[test]
    fn check_opened_needs_title_binding_and_recent_entry() {
        let file = Path::new("/d/Book 1.xlsx");
        let recent = vec!["/d/Book 1.xlsx".to_owned()];
        let title = "Book 1.xlsx – Rusuite X";
        assert!(check_opened(file, title, Some(file), &recent).is_ok());
        assert!(
            check_opened(file, "Untitled – Rusuite X", Some(file), &recent)
                .unwrap_err()
                .contains("lacks")
        );
        assert!(check_opened(file, title, None, &recent).is_err());
        assert!(check_opened(file, title, Some(file), &[]).is_err());
        assert_eq!(Smoke::new(false).file(), None);
    }

    #[test]
    fn start_fires_once_and_only_in_smoke_mode() {
        let off = Smoke::new(false);
        assert!(!off.start());
        // Outside smoke mode `finish` returns instead of exiting.
        off.finish("Rusuite X", "Rusuite X", &Report::default());
        let on = Smoke::new(true);
        assert!(on.enabled());
        assert!(on.start());
        assert!(!on.start());
        assert!(SCRIPT.contains("smoke_report") && SCRIPT.contains("documentState"));
    }
}
