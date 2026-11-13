//! [`FolderStore`]: the desktop notebook folder (`docs/notes-format.md`). Feature `fs`; never built for wasm.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::backup::{Backup, NotebookManifest, StoredDoc, MANIFEST};
use crate::effects::{is_safe_id, log_record, split_log, LoadWarning, PersistEffect};
use crate::{CoreError, NotebookSummary, NotesHost};

/// A notebook folder: `notebook.json`, `docs/<id>.snapshot`, `docs/<id>.log`, `blobs/<sha256>`.
#[derive(Debug, Clone)]
pub struct FolderStore {
    root: PathBuf,
    manifest: NotebookManifest,
}

fn bad_id(id: &str) -> CoreError {
    CoreError::BadRequest(format!("bad id {id}"))
}

/// Writes a file atomically (temp file + rename).
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), CoreError> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

impl FolderStore {
    /// Creates the folder layout for notebook `notebook_id` in `root` (which may exist and must not contain a
    /// notebook yet).
    pub fn create(root: &Path, notebook_id: &str, name: &str) -> Result<Self, CoreError> {
        if !is_safe_id(notebook_id) {
            return Err(bad_id(notebook_id));
        }
        if root.join(MANIFEST).exists() {
            return Err(CoreError::Format(format!(
                "{} already holds a notebook",
                root.display()
            )));
        }
        fs::create_dir_all(root.join("docs"))?;
        fs::create_dir_all(root.join("blobs"))?;
        let manifest = NotebookManifest::new(notebook_id, name);
        write_atomic(&root.join(MANIFEST), &manifest.to_json())?;
        Ok(Self {
            root: root.to_path_buf(),
            manifest,
        })
    }

    /// Opens an existing notebook folder.
    pub fn open(root: &Path) -> Result<Self, CoreError> {
        let manifest = NotebookManifest::parse(&fs::read(root.join(MANIFEST))?)?;
        fs::create_dir_all(root.join("docs"))?;
        fs::create_dir_all(root.join("blobs"))?;
        Ok(Self {
            root: root.to_path_buf(),
            manifest,
        })
    }

    #[must_use]
    pub fn manifest(&self) -> &NotebookManifest {
        &self.manifest
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn doc_path(&self, id: &str, ext: &str) -> Result<PathBuf, CoreError> {
        if !is_safe_id(id) {
            return Err(bad_id(id));
        }
        Ok(self.root.join("docs").join(format!("{id}.{ext}")))
    }

    fn blob_path(&self, sha: &str) -> Result<PathBuf, CoreError> {
        if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(bad_id(sha));
        }
        Ok(self.root.join("blobs").join(sha))
    }

    /// Every stored document. A log whose last record was cut off by a crash is repaired (truncated to its
    /// last complete record) and reported as a warning.
    pub fn read_docs(&self) -> Result<(Vec<StoredDoc>, Vec<LoadWarning>), CoreError> {
        let mut ids = std::collections::BTreeSet::new();
        for e in fs::read_dir(self.root.join("docs"))? {
            let name = e?.file_name().to_string_lossy().into_owned();
            if let Some(id) = name
                .strip_suffix(".snapshot")
                .or_else(|| name.strip_suffix(".log"))
            {
                if is_safe_id(id) {
                    ids.insert(id.to_string());
                }
            }
        }
        let mut docs = Vec::new();
        let mut warnings = Vec::new();
        for id in ids {
            let snapshot = fs::read(self.doc_path(&id, "snapshot")?).unwrap_or_default();
            let log_path = self.doc_path(&id, "log")?;
            let mut log = fs::read(&log_path).unwrap_or_default();
            let (_, valid) = split_log(&log);
            if valid < log.len() {
                warnings.push(LoadWarning {
                    code: "truncated_log".into(),
                    doc: id.clone(),
                    message: format!(
                        "{} trailing bytes of an interrupted write removed",
                        log.len() - valid
                    ),
                });
                log.truncate(valid);
                OpenOptions::new()
                    .write(true)
                    .open(&log_path)?
                    .set_len(valid as u64)?;
            }
            docs.push(StoredDoc { id, snapshot, log });
        }
        Ok((docs, warnings))
    }

    /// Loads the folder into `host` and opens the notebook.
    pub fn load_into(
        &self,
        host: &mut NotesHost,
    ) -> Result<(NotebookSummary, Vec<LoadWarning>), CoreError> {
        let (docs, mut warnings) = self.read_docs()?;
        let nb = &self.manifest.notebook_id;
        for d in docs {
            warnings.extend(host.load_doc(nb, &d.id, &d.snapshot, &d.log)?);
        }
        Ok((host.open_notebook(nb)?, warnings))
    }

    /// Writes the effects that belong to this notebook (others are skipped).
    pub fn apply(&self, effects: &[PersistEffect]) -> Result<(), CoreError> {
        for e in effects
            .iter()
            .filter(|e| e.notebook() == self.manifest.notebook_id)
        {
            match e {
                PersistEffect::Append { doc, bytes, .. } => {
                    let mut f = OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(self.doc_path(doc, "log")?)?;
                    f.write_all(&log_record(bytes))?;
                    f.sync_data()?;
                }
                PersistEffect::Replace { doc, snapshot, .. } => {
                    // Snapshot first: a crash in between leaves the old log, which re-imports harmlessly.
                    write_atomic(&self.doc_path(doc, "snapshot")?, snapshot)?;
                    let log = self.doc_path(doc, "log")?;
                    if log.exists() {
                        fs::remove_file(log)?;
                    }
                }
                PersistEffect::Delete { doc, .. } => {
                    for ext in ["snapshot", "log"] {
                        let p = self.doc_path(doc, ext)?;
                        if p.exists() {
                            fs::remove_file(p)?;
                        }
                    }
                }
                PersistEffect::Blob { sha256, bytes, .. } => {
                    let p = self.blob_path(sha256)?;
                    if !p.exists() {
                        write_atomic(&p, bytes)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn get_blob(&self, sha256: &str) -> Result<Vec<u8>, CoreError> {
        Ok(fs::read(self.blob_path(sha256)?)?)
    }

    /// Ids of every stored blob.
    pub fn blob_ids(&self) -> Result<Vec<String>, CoreError> {
        let mut out = Vec::new();
        for e in fs::read_dir(self.root.join("blobs"))? {
            let name = e?.file_name().to_string_lossy().into_owned();
            if self.blob_path(&name).is_ok() {
                out.push(name);
            }
        }
        out.sort();
        Ok(out)
    }

    /// The folder as a `.rnotes` archive (files as they are on disk).
    pub fn export_backup(&self) -> Result<Vec<u8>, CoreError> {
        let (docs, _) = self.read_docs()?;
        let blobs = self
            .blob_ids()?
            .into_iter()
            .map(|id| Ok((id.clone(), self.get_blob(&id)?)))
            .collect::<Result<Vec<_>, CoreError>>()?;
        Backup {
            manifest: self.manifest.clone(),
            docs,
            blobs,
        }
        .write()
    }

    /// Unpacks a `.rnotes` archive into a new notebook folder `root`.
    pub fn import_backup(root: &Path, bytes: &[u8]) -> Result<(Self, Vec<LoadWarning>), CoreError> {
        let (b, warnings) = Backup::read(bytes)?;
        let store = Self::create(root, &b.manifest.notebook_id, &b.manifest.name)?;
        for d in &b.docs {
            if !d.snapshot.is_empty() {
                write_atomic(&store.doc_path(&d.id, "snapshot")?, &d.snapshot)?;
            }
            if !d.log.is_empty() {
                write_atomic(&store.doc_path(&d.id, "log")?, &d.log)?;
            }
        }
        for (sha, bytes) in &b.blobs {
            write_atomic(&store.blob_path(sha)?, bytes)?;
        }
        Ok((store, warnings))
    }
}
