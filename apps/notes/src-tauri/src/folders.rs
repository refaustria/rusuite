//! Notebook folders of the desktop app (P11-N7, docs/notes-format.md §2): every notebook lives in a folder of its
//! own ([`FolderStore`]: `notebook.json`, `docs/`, `blobs/`). The UI's storage calls (`NotesStore` in
//! `src/store.ts`) land here: the core's persist effects are written into the folder of their notebook, a notebook
//! is read back from it, and the small app settings ("meta": known notebooks, recent pages, sharing state) are JSON
//! files in the app data directory.
//!
//! Which folder holds which notebook is the registry (`notebooks.json` in the app data directory, id → path). A
//! notebook the core created without a folder yet (the welcome notebook, File › New, a restored backup, an import, a
//! joined shared notebook) gets one on its first write: the folder picked for it ([`Folders::set_pending`]) or a
//! new one under the default root (`~/Documents/Rusuite Notes/<name>`). Folders are never deleted by the app:
//! "Remove local data" and closing only forget them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use notes_core::{FolderStore, LoadWarning, PersistEffect, StoredDoc, MANIFEST};

/// The registry file in the app data directory.
pub const REGISTRY: &str = "notebooks.json";

/// The default root's folder name inside the user's documents folder.
pub const DEFAULT_ROOT_NAME: &str = "Rusuite Notes";

#[derive(Debug, thiserror::Error)]
pub enum FolderError {
    #[error("{0}")]
    Core(#[from] notes_core::CoreError),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{} holds no notebook (notebook.json is missing)", .0.display())]
    NotANotebook(PathBuf),
    #[error("this notebook is already open from {}", .0.display())]
    AlreadyOpen(PathBuf),
    #[error("invalid settings key {0:?}")]
    BadKey(String),
}

/// A notebook folder the UI opened.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFolder {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// The registry and the open folder stores.
#[derive(Debug)]
pub struct Folders {
    data_dir: PathBuf,
    default_root: PathBuf,
    registry: BTreeMap<String, PathBuf>,
    stores: BTreeMap<String, FolderStore>,
    /// The folder File › New notebook in folder… picked for the next new notebook.
    pending: Option<PathBuf>,
}

impl Folders {
    /// The registry of `data_dir`; new notebooks go to `default_root` (missing / unreadable registry: empty).
    #[must_use]
    pub fn load(data_dir: &Path, default_root: &Path) -> Self {
        let registry = std::fs::read(data_dir.join(REGISTRY))
            .ok()
            .and_then(|b| serde_json::from_slice::<BTreeMap<String, PathBuf>>(&b).ok())
            .unwrap_or_default();
        Folders {
            data_dir: data_dir.to_path_buf(),
            default_root: default_root.to_path_buf(),
            registry,
            stores: BTreeMap::new(),
            pending: None,
        }
    }

    #[must_use]
    pub fn default_root(&self) -> &Path {
        &self.default_root
    }

    fn save_registry(&self) -> Result<(), FolderError> {
        std::fs::create_dir_all(&self.data_dir)?;
        let json = serde_json::to_vec_pretty(&self.registry).map_err(std::io::Error::other)?;
        let path = self.data_dir.join(REGISTRY);
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    /// The folder of a notebook.
    #[must_use]
    pub fn path_of(&self, id: &str) -> Option<&Path> {
        self.registry.get(id).map(PathBuf::as_path)
    }

    /// The store of a registered notebook (opened on first use; `None`: not registered, or the folder is gone).
    fn store(&mut self, id: &str) -> Option<&FolderStore> {
        if !self.stores.contains_key(id) {
            let path = self.registry.get(id)?;
            let store = FolderStore::open(path).ok()?;
            if store.manifest().notebook_id != id {
                return None;
            }
            self.stores.insert(id.to_owned(), store);
        }
        self.stores.get(id)
    }

    fn register(&mut self, store: FolderStore) -> Result<OpenedFolder, FolderError> {
        let m = store.manifest();
        let opened = OpenedFolder {
            id: m.notebook_id.clone(),
            name: m.name.clone(),
            path: store.root().to_string_lossy().into_owned(),
        };
        self.registry
            .insert(opened.id.clone(), store.root().to_path_buf());
        self.stores.insert(opened.id.clone(), store);
        self.save_registry()?;
        Ok(opened)
    }

    /// The folder picked for the next new notebook: an empty folder is used as it is, any other gets a new
    /// sub-folder named after the notebook.
    pub fn set_pending(&mut self, folder: Option<PathBuf>) {
        self.pending = folder;
    }

    /// Opens an existing notebook folder (File › Open notebook folder…, a recent folder) and registers it.
    pub fn open_folder(&mut self, path: &Path) -> Result<OpenedFolder, FolderError> {
        if !path.join(MANIFEST).is_file() {
            return Err(FolderError::NotANotebook(path.to_path_buf()));
        }
        let store = FolderStore::open(path)?;
        let id = store.manifest().notebook_id.clone();
        if let Some(existing) = self.registry.get(&id) {
            if !same_path(existing, path)
                && self.stores.contains_key(&id)
                && existing.join(MANIFEST).is_file()
            {
                return Err(FolderError::AlreadyOpen(existing.clone()));
            }
        }
        self.stores.remove(&id);
        self.register(store)
    }

    /// Writes persist effects into the folders of their notebooks. A notebook without a folder gets one first
    /// (named `name_of(id)`, the core's notebook name), unless all its effects are deletions.
    pub fn apply(
        &mut self,
        effects: &[PersistEffect],
        name_of: impl Fn(&str) -> Option<String>,
    ) -> Result<(), FolderError> {
        let mut by_nb: BTreeMap<&str, Vec<PersistEffect>> = BTreeMap::new();
        for e in effects {
            by_nb.entry(e.notebook()).or_default().push(e.clone());
        }
        for (nb, effects) in by_nb {
            if self.store(nb).is_none() {
                if effects
                    .iter()
                    .all(|e| matches!(e, PersistEffect::Delete { .. }))
                {
                    continue;
                }
                let name = name_of(nb).unwrap_or_else(|| "Notebook".to_owned());
                let root = self.new_folder(&name)?;
                let store = FolderStore::create(&root, nb, &name)?;
                self.register(store)?;
            }
            if let Some(store) = self.store(nb) {
                store.apply(&effects)?;
            }
        }
        Ok(())
    }

    /// Where a new notebook's folder goes: the pending pick, else a new folder under the default root.
    fn new_folder(&mut self, name: &str) -> Result<PathBuf, FolderError> {
        let dir = folder_name(name);
        let root = match self.pending.take() {
            Some(p) if is_empty_dir(&p) => return Ok(p),
            Some(p) => p,
            None => self.default_root.clone(),
        };
        std::fs::create_dir_all(&root)?;
        Ok(unique(&root, &dir))
    }

    /// The stored documents of a notebook (empty when it has no folder), plus the warnings of the read (a torn
    /// log tail is cut off and reported as `truncated_log`).
    pub fn load_docs(
        &mut self,
        id: &str,
    ) -> Result<(Vec<StoredDoc>, Vec<LoadWarning>), FolderError> {
        match self.store(id) {
            Some(s) => Ok(s.read_docs()?),
            None => Ok((Vec::new(), Vec::new())),
        }
    }

    /// All blobs of a notebook.
    pub fn blobs(&mut self, id: &str) -> Result<Vec<Vec<u8>>, FolderError> {
        let Some(s) = self.store(id) else {
            return Ok(Vec::new());
        };
        let ids = s.blob_ids()?;
        ids.iter().map(|sha| Ok(s.get_blob(sha)?)).collect()
    }

    /// One blob (`None`: not stored).
    pub fn get_blob(&mut self, id: &str, sha: &str) -> Option<Vec<u8>> {
        self.store(id)?.get_blob(sha).ok()
    }

    /// Forgets a notebook (its folder stays).
    pub fn forget(&mut self, id: &str) -> Result<(), FolderError> {
        self.stores.remove(id);
        if self.registry.remove(id).is_some() {
            self.save_registry()?;
        }
        Ok(())
    }

    /// Forgets every notebook and the app settings ("Remove local data" – the folders stay).
    pub fn forget_all(&mut self) -> Result<(), FolderError> {
        self.stores.clear();
        self.registry.clear();
        self.pending = None;
        self.save_registry()?;
        match std::fs::remove_dir_all(self.meta_dir()) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    // ---- meta: one JSON file per key ------------------------------------------------------------------------

    fn meta_dir(&self) -> PathBuf {
        self.data_dir.join("meta")
    }

    fn meta_path(&self, key: &str) -> Result<PathBuf, FolderError> {
        if key.is_empty() || key.len() > 200 {
            return Err(FolderError::BadKey(key.to_owned()));
        }
        // Hex keeps any key (`sync:book:<id>`) a safe file name.
        let hex: String = key.bytes().map(|b| format!("{b:02x}")).collect();
        Ok(self.meta_dir().join(format!("{hex}.json")))
    }

    /// The JSON value stored under `key`.
    pub fn meta_get(&self, key: &str) -> Result<Option<String>, FolderError> {
        match std::fs::read_to_string(self.meta_path(key)?) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Stores a JSON value (`None`: removes it).
    pub fn meta_set(&self, key: &str, json: Option<&str>) -> Result<(), FolderError> {
        let path = self.meta_path(key)?;
        match json {
            Some(json) => {
                std::fs::create_dir_all(self.meta_dir())?;
                let tmp = path.with_extension("tmp");
                std::fs::write(&tmp, json)?;
                std::fs::rename(tmp, path)?;
            }
            None => match std::fs::remove_file(path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                _ => {}
            },
        }
        Ok(())
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn is_empty_dir(p: &Path) -> bool {
    std::fs::read_dir(p).is_ok_and(|mut d| d.next().is_none())
}

/// A notebook name as a folder name: no path separators, reserved or control characters, no leading / trailing
/// dots and spaces, at most 80 characters, never empty or a reserved Windows device name.
#[must_use]
pub fn folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(80)
        .collect();
    let trimmed = trimmed.trim_end_matches(['.', ' ']).to_owned();
    let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if trimmed.is_empty() || reserved {
        "Notebook".to_owned()
    } else {
        trimmed
    }
}

/// `root/name`, or `root/name (2)`, `(3)` … when that exists.
fn unique(root: &Path, name: &str) -> PathBuf {
    let first = root.join(name);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| root.join(format!("{name} ({n})")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notes_core::{binary, decode_effects, encode_effects, log_record, NotesHost};
    use serde_json::{json, Value};

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "rusuite-notes-folders-{tag}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn call(host: &mut NotesHost, req: Value) -> Value {
        serde_json::from_str(&notes_core::dispatch_with(host, &req.to_string())).unwrap()
    }

    fn names(host: &NotesHost) -> impl Fn(&str) -> Option<String> + '_ {
        |id| {
            host.list_notebooks()
                .into_iter()
                .find(|n| n.id == id)
                .map(|n| n.info.name)
        }
    }

    /// A host with a new notebook and one page; the effects went to `folders`.
    fn make(folders: &mut Folders, name: &str) -> (NotesHost, String) {
        let mut host = NotesHost::new("desk");
        let nb = call(&mut host, json!({"type": "createNotebook", "name": name}));
        let id = nb["ok"]["notebook"]["id"].as_str().unwrap().to_owned();
        let s = call(
            &mut host,
            json!({"type": "createSection", "notebook": id, "title": "S"}),
        );
        let sid = s["ok"]["id"].as_str().unwrap().to_owned();
        call(
            &mut host,
            json!({"type": "createPage", "notebook": id, "parent": sid, "title": "P"}),
        );
        // Through the wire format, as the UI sends them.
        let effects = decode_effects(&encode_effects(&host.take_effects())).unwrap();
        folders.apply(&effects, names(&host)).unwrap();
        (host, id)
    }

    fn reopen(folders: &mut Folders, id: &str) -> Value {
        let mut host = NotesHost::new("desk");
        let (docs, _) = folders.load_docs(id).unwrap();
        assert!(docs.iter().any(|d| d.id == id));
        for d in docs {
            binary::load_doc(&mut host, id, &d.id, &d.snapshot, &d.log);
        }
        call(&mut host, json!({"type": "openNotebook", "id": id}))
    }

    #[test]
    fn create_persist_and_reopen() {
        let tmp = Tmp::new("create");
        let data = tmp.0.join("data");
        let root = tmp.0.join("Documents").join(DEFAULT_ROOT_NAME);
        let mut folders = Folders::load(&data, &root);
        let (_, id) = make(&mut folders, "Work: plans/2026");
        let path = folders.path_of(&id).unwrap().to_path_buf();
        assert_eq!(path, root.join("Work plans 2026"));
        assert!(path.join(MANIFEST).is_file());
        // A second notebook of the same name gets its own folder.
        let (_, id2) = make(&mut folders, "Work: plans/2026");
        assert_eq!(
            folders.path_of(&id2).unwrap(),
            root.join("Work plans 2026 (2)")
        );
        // A restart reads the registry and the folder.
        let mut again = Folders::load(&data, &root);
        let opened = reopen(&mut again, &id);
        assert_eq!(opened["ok"]["notebook"]["info"]["name"], "Work: plans/2026");
        let tree = opened["ok"]["tree"].to_string();
        assert!(tree.contains("\"S\"") && tree.contains("\"P\""), "{tree}");
    }

    #[test]
    fn open_folder_and_pending_pick() {
        let tmp = Tmp::new("open");
        let data = tmp.0.join("data");
        let mut folders = Folders::load(&data, &tmp.0.join("root"));
        // An empty picked folder is used as it is.
        let picked = tmp.0.join("picked");
        std::fs::create_dir_all(&picked).unwrap();
        folders.set_pending(Some(picked.clone()));
        let (_, id) = make(&mut folders, "Mine");
        assert_eq!(folders.path_of(&id).unwrap(), picked);
        // A non-empty one gets a sub-folder.
        folders.set_pending(Some(tmp.0.clone()));
        let (_, id2) = make(&mut folders, "Other");
        assert_eq!(folders.path_of(&id2).unwrap(), tmp.0.join("Other"));
        // Another install (fresh app data) opens the folder.
        let mut other = Folders::load(&tmp.0.join("data2"), &tmp.0.join("root"));
        assert!(matches!(
            other.open_folder(&tmp.0),
            Err(FolderError::NotANotebook(_))
        ));
        let opened = other.open_folder(&picked).unwrap();
        assert_eq!(
            (opened.id.as_str(), opened.name.as_str()),
            (id.as_str(), "Mine")
        );
        assert_eq!(
            reopen(&mut other, &id)["ok"]["notebook"]["info"]["name"],
            "Mine"
        );
        // Opening the same folder again is fine; a copy of an open notebook elsewhere is not.
        other.open_folder(&picked).unwrap();
        let copy = tmp.0.join("copy");
        std::fs::create_dir_all(copy.join("docs")).unwrap();
        std::fs::copy(picked.join(MANIFEST), copy.join(MANIFEST)).unwrap();
        assert!(matches!(
            other.open_folder(&copy),
            Err(FolderError::AlreadyOpen(_))
        ));
        // Forgetting keeps the folder.
        other.forget(&id).unwrap();
        assert!(other.path_of(&id).is_none());
        assert!(picked.join(MANIFEST).is_file());
        assert!(other.load_docs(&id).unwrap().0.is_empty());
    }

    #[test]
    fn a_torn_log_tail_is_ignored() {
        let tmp = Tmp::new("torn");
        let data = tmp.0.join("data");
        let mut folders = Folders::load(&data, &tmp.0.join("root"));
        let (mut host, id) = make(&mut folders, "Torn");
        call(
            &mut host,
            json!({"type": "renameNotebook", "notebook": id, "name": "Renamed"}),
        );
        folders.apply(&host.take_effects(), names(&host)).unwrap();
        let log = folders
            .path_of(&id)
            .unwrap()
            .join("docs")
            .join(format!("{id}.log"));
        let good = std::fs::read(&log).unwrap();
        assert!(!good.is_empty());
        // An interrupted write: a record header promising more bytes than follow.
        let mut torn = good.clone();
        torn.extend_from_slice(&log_record(b"0123456789")[..7]);
        std::fs::write(&log, &torn).unwrap();
        let mut again = Folders::load(&data, &tmp.0.join("root"));
        let (_, warnings) = again.load_docs(&id).unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "truncated_log");
        assert_eq!(
            std::fs::read(&log).unwrap(),
            good,
            "the tail is cut off on disk"
        );
        assert_eq!(
            reopen(&mut again, &id)["ok"]["notebook"]["info"]["name"],
            "Renamed"
        );
    }

    #[test]
    fn backup_import_gets_a_folder() {
        let tmp = Tmp::new("backup");
        let data = tmp.0.join("data");
        let mut folders = Folders::load(&data, &tmp.0.join("root"));
        let (mut host, id) = make(&mut folders, "Backed up");
        let blob = host.put_blob(&id, b"picture bytes").unwrap();
        folders.apply(&host.take_effects(), names(&host)).unwrap();
        assert_eq!(
            folders.get_blob(&id, &blob).as_deref(),
            Some(&b"picture bytes"[..])
        );
        let backup = host
            .export_backup(&id, &folders.blobs(&id).unwrap())
            .unwrap();
        // The browser backup (.rnotes) restored on a fresh desktop install.
        let tmp2 = Tmp::new("backup2");
        let mut desk = Folders::load(&tmp2.0.join("data"), &tmp2.0.join("root"));
        let mut fresh = NotesHost::new("desk");
        let reply: Value =
            serde_json::from_str(&binary::import_backup(&mut fresh, &backup)).unwrap();
        let restored = reply["ok"]["notebook"]["id"].as_str().unwrap().to_owned();
        desk.apply(&fresh.take_effects(), names(&fresh)).unwrap();
        assert_eq!(
            desk.path_of(&restored).unwrap(),
            tmp2.0.join("root").join("Backed up")
        );
        assert_eq!(
            desk.get_blob(&restored, &blob).as_deref(),
            Some(&b"picture bytes"[..])
        );
        assert_eq!(
            reopen(&mut desk, &restored)["ok"]["notebook"]["info"]["name"],
            "Backed up"
        );
    }

    #[test]
    fn deletions_alone_create_nothing() {
        let tmp = Tmp::new("delete");
        let mut folders = Folders::load(&tmp.0.join("data"), &tmp.0.join("root"));
        folders
            .apply(
                &[PersistEffect::Delete {
                    notebook: "nb1".into(),
                    doc: "d1".into(),
                }],
                |_| Some("X".into()),
            )
            .unwrap();
        assert!(folders.path_of("nb1").is_none());
        assert!(!tmp.0.join("root").exists());
    }

    #[test]
    fn meta_round_trip_and_forget_all() {
        let tmp = Tmp::new("meta");
        let data = tmp.0.join("data");
        let mut folders = Folders::load(&data, &tmp.0.join("root"));
        assert_eq!(folders.meta_get("notes:known").unwrap(), None);
        folders.meta_set("notes:known", Some("[1,2]")).unwrap();
        folders.meta_set("sync:book:../x", Some("{}")).unwrap();
        assert_eq!(
            folders.meta_get("notes:known").unwrap().as_deref(),
            Some("[1,2]")
        );
        assert_eq!(
            folders.meta_get("sync:book:../x").unwrap().as_deref(),
            Some("{}")
        );
        // Hex file names: nothing escapes the meta folder.
        for e in std::fs::read_dir(data.join("meta")).unwrap() {
            let n = e.unwrap().file_name().to_string_lossy().into_owned();
            let stem = n.strip_suffix(".json").unwrap();
            assert!(stem.bytes().all(|b| b.is_ascii_hexdigit()), "{n}");
        }
        folders.meta_set("notes:known", None).unwrap();
        folders.meta_set("notes:known", None).unwrap();
        assert_eq!(folders.meta_get("notes:known").unwrap(), None);
        assert!(folders.meta_get("").is_err());
        let (_, id) = make(&mut folders, "Keep");
        let path = folders.path_of(&id).unwrap().to_path_buf();
        folders.forget_all().unwrap();
        assert!(folders.path_of(&id).is_none());
        assert_eq!(folders.meta_get("sync:book:../x").unwrap(), None);
        assert!(path.join(MANIFEST).is_file(), "the folder stays");
        assert!(Folders::load(&data, &tmp.0.join("root"))
            .path_of(&id)
            .is_none());
    }

    #[test]
    fn folder_names() {
        assert_eq!(folder_name("My notebook"), "My notebook");
        assert_eq!(
            folder_name("  a/b\\c:d*e?f\"g<h>i|j  "),
            "a b c d e f g h i j"
        );
        assert_eq!(folder_name("..."), "Notebook");
        assert_eq!(folder_name("CON"), "Notebook");
        assert_eq!(folder_name("com1.txt"), "Notebook");
        assert_eq!(folder_name("Notizbuch für Ärzte."), "Notizbuch für Ärzte");
        assert_eq!(folder_name(&"x".repeat(200)).len(), 80);
    }
}
