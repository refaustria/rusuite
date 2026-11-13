//! `notebook.json` and the `.rnotes` backup archive (a zip of the notebook folder tree, `docs/notes-format.md`).
use std::io::{Cursor, Read, Write};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::effects::{blob_id, is_safe_id, LoadWarning};
use crate::CoreError;

pub const FORMAT_NAME: &str = "rusuite-notes";
pub const MANIFEST: &str = "notebook.json";
/// The backup file extension.
pub const BACKUP_EXT: &str = "rnotes";

/// `notebook.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct NotebookManifest {
    /// Always `rusuite-notes`.
    pub format: String,
    pub format_version: u32,
    /// Also the id of the notebook document (`docs/<notebookId>.snapshot`).
    pub notebook_id: String,
    /// The notebook name when last written (informative; the notebook doc is authoritative).
    pub name: String,
}

impl NotebookManifest {
    #[must_use]
    pub fn new(notebook_id: &str, name: &str) -> Self {
        Self {
            format: FORMAT_NAME.into(),
            format_version: model_notes::FORMAT_VERSION,
            notebook_id: notebook_id.into(),
            name: name.into(),
        }
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, CoreError> {
        let m: NotebookManifest = serde_json::from_slice(bytes)
            .map_err(|e| CoreError::Format(format!("notebook.json: {e}")))?;
        if m.format != FORMAT_NAME {
            return Err(CoreError::Format(format!(
                "not a Rusuite Notes notebook ({})",
                m.format
            )));
        }
        if m.format_version > model_notes::FORMAT_VERSION {
            return Err(CoreError::Format(format!(
                "notebook format {} is newer than this app ({})",
                m.format_version,
                model_notes::FORMAT_VERSION
            )));
        }
        if !is_safe_id(&m.notebook_id) {
            return Err(CoreError::Format("bad notebook id".into()));
        }
        Ok(m)
    }

    #[must_use]
    pub fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec_pretty(self).unwrap_or_default()
    }
}

/// One document as stored: snapshot (may be empty) and log (`.log` framing, may be empty).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StoredDoc {
    pub id: String,
    pub snapshot: Vec<u8>,
    pub log: Vec<u8>,
}

/// The content of a backup archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backup {
    pub manifest: NotebookManifest,
    pub docs: Vec<StoredDoc>,
    /// (sha256 hex, bytes).
    pub blobs: Vec<(String, Vec<u8>)>,
}

fn zerr(e: impl std::fmt::Display) -> CoreError {
    CoreError::Format(format!("backup: {e}"))
}

impl Backup {
    /// Writes the archive (deflate, fixed timestamps: the same content gives the same bytes).
    pub fn write(&self) -> Result<Vec<u8>, CoreError> {
        let opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::DEFAULT)
            .unix_permissions(0o644);
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let mut put = |name: &str, data: &[u8]| -> Result<(), CoreError> {
            zip.start_file(name, opts).map_err(zerr)?;
            zip.write_all(data).map_err(zerr)
        };
        put(MANIFEST, &self.manifest.to_json())?;
        for d in &self.docs {
            if !d.snapshot.is_empty() {
                put(&format!("docs/{}.snapshot", d.id), &d.snapshot)?;
            }
            if !d.log.is_empty() {
                put(&format!("docs/{}.log", d.id), &d.log)?;
            }
        }
        for (sha, bytes) in &self.blobs {
            put(&format!("blobs/{sha}"), bytes)?;
        }
        Ok(zip.finish().map_err(zerr)?.into_inner())
    }

    /// Reads an archive. Unknown entries and blobs whose hash does not match are skipped with a warning.
    pub fn read(bytes: &[u8]) -> Result<(Backup, Vec<LoadWarning>), CoreError> {
        let mut zip = ZipArchive::new(Cursor::new(bytes)).map_err(zerr)?;
        let mut manifest = None;
        let mut docs: std::collections::BTreeMap<String, StoredDoc> = Default::default();
        let mut blobs = Vec::new();
        let mut warnings = Vec::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(zerr)?;
            if f.is_dir() {
                continue;
            }
            let name = f.name().map_err(zerr)?.into_owned();
            let mut data = Vec::new();
            f.read_to_end(&mut data).map_err(zerr)?;
            let warn = |code: &str, msg: String| LoadWarning {
                code: code.into(),
                doc: name.clone(),
                message: msg,
            };
            if name == MANIFEST {
                manifest = Some(NotebookManifest::parse(&data)?);
            } else if let Some(rest) = name.strip_prefix("docs/") {
                let (id, snap) = if let Some(id) = rest.strip_suffix(".snapshot") {
                    (id, true)
                } else if let Some(id) = rest.strip_suffix(".log") {
                    (id, false)
                } else {
                    warnings.push(warn("unknown_entry", format!("ignored {name}")));
                    continue;
                };
                if !is_safe_id(id) {
                    warnings.push(warn("unknown_entry", format!("ignored {name}")));
                    continue;
                }
                let d = docs.entry(id.to_string()).or_insert_with(|| StoredDoc {
                    id: id.into(),
                    ..Default::default()
                });
                if snap {
                    d.snapshot = data;
                } else {
                    d.log = data;
                }
            } else if let Some(sha) = name.strip_prefix("blobs/") {
                if blob_id(&data) == sha {
                    blobs.push((sha.to_string(), data));
                } else {
                    warnings.push(warn(
                        "blob_mismatch",
                        format!("{name} does not match its hash; skipped"),
                    ));
                }
            } else {
                warnings.push(warn("unknown_entry", format!("ignored {name}")));
            }
        }
        let manifest =
            manifest.ok_or_else(|| CoreError::Format("backup has no notebook.json".into()))?;
        Ok((
            Backup {
                manifest,
                docs: docs.into_values().collect(),
                blobs,
            },
            warnings,
        ))
    }
}
