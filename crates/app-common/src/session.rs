//! Recent files and crash-recovery entries (README Phase 5), independent
//! of the transport and of where the data lives.
//!
//! A [`Session`] keeps two things in a [`Storage`]:
//!
//! * the **recent list** (`recent.json`): the last [`RECENT_LIMIT`] opened
//!   or saved files, newest first, one entry per path (desktop) or per
//!   name (web, where the file is only reachable through a stored
//!   snapshot, [`RecentEntry::blob_id`]);
//! * **recovery entries** (`recovery-<id>.json`): the autosaved snapshot
//!   of an unsaved document, one per document id (a new id per editing
//!   session). The UI lists them at startup ([`Session::recovery_list`])
//!   and offers Restore/Discard.
//!
//! The desktop shells use a [`DirStorage`] under the app data directory
//! (feature `fs`); the web frontend keeps the same JSON shapes in
//! IndexedDB (`packages/ui-shared/src/recent`), so this module is the
//! reference for its behaviour.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Revision;

/// Maximum length of the recent list.
pub const RECENT_LIMIT: usize = 10;

/// Name of the recent list in the storage.
pub const RECENT_KEY: &str = "recent.json";

/// Prefix of recovery entry names in the storage.
pub const RECOVERY_PREFIX: &str = "recovery-";

/// One recently opened or saved file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct RecentEntry {
    /// The file name shown in the menu.
    pub name: String,
    /// Absolute path (desktop); `null` on the web.
    #[serde(default)]
    pub path: Option<String>,
    /// Id of the stored document snapshot that re-opens the entry (web,
    /// where there is no path); `null` on the desktop.
    #[serde(default)]
    pub blob_id: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub opened_at: f64,
}

impl RecentEntry {
    /// Identity in the list: the path when there is one, else the name.
    pub fn key(&self) -> &str {
        self.path.as_deref().unwrap_or(&self.name)
    }
}

/// Puts `entry` at the front of `list`, drops older entries with the same
/// [`RecentEntry::key`] and trims the list to [`RECENT_LIMIT`]. Returns
/// the removed entries (so the caller can delete their blobs).
pub fn push_recent(list: &mut Vec<RecentEntry>, entry: RecentEntry) -> Vec<RecentEntry> {
    let mut removed: Vec<RecentEntry> = Vec::new();
    let mut kept = Vec::with_capacity(list.len() + 1);
    for e in list.drain(..) {
        if e.key() == entry.key() {
            removed.push(e);
        } else {
            kept.push(e);
        }
    }
    kept.insert(0, entry);
    if kept.len() > RECENT_LIMIT {
        removed.extend(kept.drain(RECENT_LIMIT..));
    }
    // A replaced entry whose blob the new entry reuses must not be deleted.
    let new_blob = kept[0].blob_id.clone();
    for r in &mut removed {
        if r.blob_id.is_some() && r.blob_id == new_blob {
            r.blob_id = None;
        }
    }
    *list = kept;
    removed
}

/// The autosaved snapshot of one unsaved document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct RecoveryEntry {
    /// The document id (new per editing session; `[A-Za-z0-9_-]`, 1–64
    /// characters).
    pub id: String,
    /// The document's file name, `null` for a new document.
    pub name: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub saved_at: f64,
    /// The core revision the snapshot was taken at.
    pub revision: Revision,
    /// The core's `recoverySnapshot` JSON (input of `restoreRecovery`).
    pub json: String,
}

/// A [`RecoveryEntry`] without its snapshot, for listing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct RecoveryInfo {
    pub id: String,
    pub name: Option<String>,
    pub saved_at: f64,
    pub revision: Revision,
}

impl From<&RecoveryEntry> for RecoveryInfo {
    fn from(e: &RecoveryEntry) -> Self {
        RecoveryInfo {
            id: e.id.clone(),
            name: e.name.clone(),
            saved_at: e.saved_at,
            revision: e.revision,
        }
    }
}

/// Whether `id` is a valid document id: 1–64 characters of
/// `[A-Za-z0-9_-]` (it becomes part of a file name).
pub fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Errors of [`Session`] and its storages.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("invalid document id {0:?}")]
    InvalidId(String),
    #[error("invalid storage name {0:?}")]
    InvalidName(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("corrupt {name}: {message}")]
    Corrupt { name: String, message: String },
}

#[cfg(feature = "fs")]
impl From<std::io::Error> for SessionError {
    fn from(e: std::io::Error) -> Self {
        SessionError::Storage(e.to_string())
    }
}

/// A flat namespace of named text blobs (names: `[A-Za-z0-9_.-]`, no
/// leading dot).
pub trait Storage {
    fn read(&self, name: &str) -> Result<Option<String>, SessionError>;
    fn write(&mut self, name: &str, data: &str) -> Result<(), SessionError>;
    /// Removing a missing name is not an error.
    fn remove(&mut self, name: &str) -> Result<(), SessionError>;
    /// All names, in any order.
    fn names(&self) -> Result<Vec<String>, SessionError>;
}

fn check_name(name: &str) -> Result<(), SessionError> {
    let ok = !name.is_empty()
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
    if ok {
        Ok(())
    } else {
        Err(SessionError::InvalidName(name.to_owned()))
    }
}

/// An in-memory [`Storage`] (tests, and hosts without persistence).
#[derive(Debug, Default, Clone)]
pub struct MemoryStorage(pub BTreeMap<String, String>);

impl Storage for MemoryStorage {
    fn read(&self, name: &str) -> Result<Option<String>, SessionError> {
        check_name(name)?;
        Ok(self.0.get(name).cloned())
    }

    fn write(&mut self, name: &str, data: &str) -> Result<(), SessionError> {
        check_name(name)?;
        self.0.insert(name.to_owned(), data.to_owned());
        Ok(())
    }

    fn remove(&mut self, name: &str) -> Result<(), SessionError> {
        check_name(name)?;
        self.0.remove(name);
        Ok(())
    }

    fn names(&self) -> Result<Vec<String>, SessionError> {
        Ok(self.0.keys().cloned().collect())
    }
}

/// A [`Storage`] of files in one directory (created on the first write).
/// Writes go to a temporary file that is then renamed, so a crash never
/// leaves a half-written entry.
#[cfg(feature = "fs")]
#[derive(Debug, Clone)]
pub struct DirStorage {
    root: std::path::PathBuf,
}

#[cfg(feature = "fs")]
impl DirStorage {
    pub fn new(root: impl Into<std::path::PathBuf>) -> Self {
        DirStorage { root: root.into() }
    }

    pub fn root(&self) -> &std::path::Path {
        &self.root
    }
}

#[cfg(feature = "fs")]
impl Storage for DirStorage {
    fn read(&self, name: &str) -> Result<Option<String>, SessionError> {
        check_name(name)?;
        match std::fs::read_to_string(self.root.join(name)) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn write(&mut self, name: &str, data: &str) -> Result<(), SessionError> {
        check_name(name)?;
        std::fs::create_dir_all(&self.root)?;
        let tmp = self.root.join(format!(".{name}.tmp"));
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, self.root.join(name))?;
        Ok(())
    }

    fn remove(&mut self, name: &str) -> Result<(), SessionError> {
        check_name(name)?;
        match std::fs::remove_file(self.root.join(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    fn names(&self) -> Result<Vec<String>, SessionError> {
        let dir = match std::fs::read_dir(&self.root) {
            Ok(d) => d,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut names = Vec::new();
        for entry in dir {
            let entry = entry?;
            if let Some(name) = entry.file_name().to_str() {
                if check_name(name).is_ok() && entry.file_type()?.is_file() {
                    names.push(name.to_owned());
                }
            }
        }
        Ok(names)
    }
}

fn recovery_name(id: &str) -> Result<String, SessionError> {
    if !valid_id(id) {
        return Err(SessionError::InvalidId(id.to_owned()));
    }
    Ok(format!("{RECOVERY_PREFIX}{id}.json"))
}

/// The recent list and the recovery entries of one app, kept in a
/// [`Storage`]. See the module docs.
#[derive(Debug, Clone)]
pub struct Session<S: Storage> {
    storage: S,
}

impl<S: Storage> Session<S> {
    pub fn new(storage: S) -> Self {
        Session { storage }
    }

    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// The recent list, newest first. A corrupt list reads as empty (it is
    /// a convenience, never worth an error dialog).
    pub fn recent(&self) -> Result<Vec<RecentEntry>, SessionError> {
        Ok(self
            .storage
            .read(RECENT_KEY)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default())
    }

    fn write_recent(&mut self, list: &[RecentEntry]) -> Result<(), SessionError> {
        let json = serde_json::to_string(list).map_err(|e| SessionError::Storage(e.to_string()))?;
        self.storage.write(RECENT_KEY, &json)
    }

    /// Adds `entry` (see [`push_recent`]) and returns the new list.
    pub fn add_recent(&mut self, entry: RecentEntry) -> Result<Vec<RecentEntry>, SessionError> {
        let mut list = self.recent()?;
        push_recent(&mut list, entry);
        self.write_recent(&list)?;
        Ok(list)
    }

    /// Removes the entries with key `key` (a path, or a name on the web)
    /// and returns the new list.
    pub fn remove_recent(&mut self, key: &str) -> Result<Vec<RecentEntry>, SessionError> {
        let mut list = self.recent()?;
        list.retain(|e| e.key() != key);
        self.write_recent(&list)?;
        Ok(list)
    }

    /// The recent entry for `path`, if any (the desktop shells only re-open
    /// paths that are on the list).
    pub fn recent_path(&self, path: &str) -> Result<Option<RecentEntry>, SessionError> {
        Ok(self
            .recent()?
            .into_iter()
            .find(|e| e.path.as_deref() == Some(path)))
    }

    /// Stores (replaces) a recovery entry.
    pub fn recovery_put(&mut self, entry: &RecoveryEntry) -> Result<(), SessionError> {
        let name = recovery_name(&entry.id)?;
        let json =
            serde_json::to_string(entry).map_err(|e| SessionError::Storage(e.to_string()))?;
        self.storage.write(&name, &json)
    }

    /// The recovery entry `id`, if present.
    pub fn recovery_get(&self, id: &str) -> Result<Option<RecoveryEntry>, SessionError> {
        let name = recovery_name(id)?;
        let Some(s) = self.storage.read(&name)? else {
            return Ok(None);
        };
        serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| SessionError::Corrupt {
                name,
                message: e.to_string(),
            })
    }

    /// Removes the recovery entry `id` (missing is not an error).
    pub fn recovery_remove(&mut self, id: &str) -> Result<(), SessionError> {
        let name = recovery_name(id)?;
        self.storage.remove(&name)
    }

    /// All readable recovery entries without their snapshots, newest
    /// first. Unreadable entries are skipped.
    pub fn recovery_list(&self) -> Result<Vec<RecoveryInfo>, SessionError> {
        let mut list = Vec::new();
        for name in self.storage.names()? {
            let Some(id) = name
                .strip_prefix(RECOVERY_PREFIX)
                .and_then(|n| n.strip_suffix(".json"))
            else {
                continue;
            };
            if let Ok(Some(entry)) = self.recovery_get(id) {
                list.push(RecoveryInfo::from(&entry));
            }
        }
        list.sort_by(|a, b| b.saved_at.total_cmp(&a.saved_at));
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, at: f64) -> RecentEntry {
        RecentEntry {
            name: name.into(),
            path: Some(format!("/docs/{name}")),
            blob_id: None,
            opened_at: at,
        }
    }

    fn web(name: &str, blob: &str, at: f64) -> RecentEntry {
        RecentEntry {
            name: name.into(),
            path: None,
            blob_id: Some(blob.into()),
            opened_at: at,
        }
    }

    fn recovery(id: &str, at: f64) -> RecoveryEntry {
        RecoveryEntry {
            id: id.into(),
            name: Some(format!("{id}.xlsx")),
            saved_at: at,
            revision: Revision(7),
            json: r#"{"sheets":[]}"#.into(),
        }
    }

    #[test]
    fn recent_is_newest_first_deduplicated_and_capped() {
        let mut list = Vec::new();
        for i in 0..12 {
            let removed = push_recent(&mut list, file(&format!("f{i}"), f64::from(i)));
            assert_eq!(removed.len(), usize::from(i >= 10));
        }
        assert_eq!(list.len(), RECENT_LIMIT);
        assert_eq!(list[0].name, "f11");
        assert_eq!(list[9].name, "f2");
        let removed = push_recent(&mut list, file("f5", 99.0));
        assert_eq!(removed, vec![file("f5", 5.0)]);
        assert_eq!(list.len(), RECENT_LIMIT);
        assert_eq!(list[0], file("f5", 99.0));
        assert_eq!(list.iter().filter(|e| e.name == "f5").count(), 1);
    }

    #[test]
    fn web_entries_key_by_name_and_report_stale_blobs() {
        let mut list = vec![web("a.xlsx", "b1", 1.0)];
        let removed = push_recent(&mut list, web("a.xlsx", "b2", 2.0));
        assert_eq!(removed, vec![web("a.xlsx", "b1", 1.0)]);
        // Re-using the same blob id: the old entry's blob must survive.
        let removed = push_recent(&mut list, web("a.xlsx", "b2", 3.0));
        assert_eq!(removed[0].blob_id, None);
        assert_eq!(list, vec![web("a.xlsx", "b2", 3.0)]);
    }

    #[test]
    fn recent_entry_json_shape() {
        let json = serde_json::to_value(web("a", "x", 5.0)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"name":"a","path":null,"blobId":"x","openedAt":5.0})
        );
        let back: RecentEntry = serde_json::from_str(r#"{"name":"a","openedAt":1}"#).unwrap();
        assert_eq!((back.path, back.blob_id), (None, None));
    }

    #[test]
    fn session_recent_roundtrip() {
        let mut s = Session::new(MemoryStorage::default());
        assert!(s.recent().unwrap().is_empty());
        s.add_recent(file("a", 1.0)).unwrap();
        let list = s.add_recent(file("b", 2.0)).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(s.recent().unwrap(), list);
        assert_eq!(s.recent_path("/docs/a").unwrap(), Some(file("a", 1.0)));
        assert_eq!(s.recent_path("/etc/passwd").unwrap(), None);
        assert_eq!(s.remove_recent("/docs/a").unwrap(), vec![file("b", 2.0)]);
        // A corrupt list reads as empty.
        let mut s = Session::new(MemoryStorage::default());
        s.storage.write(RECENT_KEY, "not json").unwrap();
        assert!(s.recent().unwrap().is_empty());
    }

    #[test]
    fn recovery_put_get_list_remove() {
        let mut s = Session::new(MemoryStorage::default());
        s.recovery_put(&recovery("old", 1.0)).unwrap();
        s.recovery_put(&recovery("new", 2.0)).unwrap();
        s.storage.write("recovery-bad.json", "{").unwrap();
        s.add_recent(file("a", 1.0)).unwrap();
        let list = s.recovery_list().unwrap();
        assert_eq!(
            list.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["new", "old"]
        );
        assert_eq!(list[0].revision, Revision(7));
        assert_eq!(s.recovery_get("old").unwrap(), Some(recovery("old", 1.0)));
        assert!(matches!(
            s.recovery_get("bad"),
            Err(SessionError::Corrupt { .. })
        ));
        s.recovery_remove("old").unwrap();
        s.recovery_remove("old").unwrap();
        assert_eq!(s.recovery_get("old").unwrap(), None);
        assert_eq!(s.recovery_list().unwrap().len(), 1);
    }

    #[test]
    fn ids_and_names_are_validated() {
        assert!(valid_id("a-B_9"));
        for bad in ["", "../x", "a/b", "a.b", &"x".repeat(65)] {
            assert!(!valid_id(bad), "{bad}");
        }
        let mut s = Session::new(MemoryStorage::default());
        let mut e = recovery("x", 1.0);
        e.id = "../../etc".into();
        assert!(matches!(
            s.recovery_put(&e),
            Err(SessionError::InvalidId(_))
        ));
        assert!(matches!(
            s.recovery_get(""),
            Err(SessionError::InvalidId(_))
        ));
        let mut m = MemoryStorage::default();
        assert!(matches!(
            m.write(".hidden", ""),
            Err(SessionError::InvalidName(_))
        ));
    }

    #[cfg(feature = "fs")]
    #[test]
    fn dir_storage_persists() {
        let dir = std::env::temp_dir().join(format!("rusuite-session-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut s = Session::new(DirStorage::new(&dir));
        assert!(s.recent().unwrap().is_empty());
        assert!(s.recovery_list().unwrap().is_empty());
        s.add_recent(file("a", 1.0)).unwrap();
        s.recovery_put(&recovery("doc1", 3.0)).unwrap();
        let again = Session::new(DirStorage::new(&dir));
        assert_eq!(again.recent().unwrap(), vec![file("a", 1.0)]);
        assert_eq!(again.recovery_list().unwrap()[0].id, "doc1");
        s.recovery_remove("doc1").unwrap();
        assert!(again.recovery_list().unwrap().is_empty());
        // No temporary files are left behind.
        let mut names = again.storage().names().unwrap();
        names.sort();
        assert_eq!(names, [RECENT_KEY]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
