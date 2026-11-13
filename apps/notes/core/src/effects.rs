//! Persist effects (what the storage layer must write) and the binary framings of `docs/notes-format.md`.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One storage write the core asks for. The core never touches storage itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PersistEffect {
    /// Append one update record to `docs/<doc>.log`.
    Append {
        notebook: String,
        doc: String,
        bytes: Vec<u8>,
    },
    /// Replace `docs/<doc>.snapshot` by this full-history snapshot and empty the log.
    Replace {
        notebook: String,
        doc: String,
        snapshot: Vec<u8>,
    },
    /// Remove the document (snapshot and log).
    Delete { notebook: String, doc: String },
    /// Store `blobs/<sha256>` (content-addressed; writing an existing blob again is a no-op).
    Blob {
        notebook: String,
        sha256: String,
        bytes: Vec<u8>,
    },
}

impl PersistEffect {
    #[must_use]
    pub fn notebook(&self) -> &str {
        match self {
            PersistEffect::Append { notebook, .. }
            | PersistEffect::Replace { notebook, .. }
            | PersistEffect::Delete { notebook, .. }
            | PersistEffect::Blob { notebook, .. } => notebook,
        }
    }

    fn parts(&self) -> (u8, &str, &str, &[u8]) {
        match self {
            PersistEffect::Append {
                notebook,
                doc,
                bytes,
            } => (1, notebook, doc, bytes),
            PersistEffect::Replace {
                notebook,
                doc,
                snapshot,
            } => (2, notebook, doc, snapshot),
            PersistEffect::Delete { notebook, doc } => (3, notebook, doc, &[]),
            PersistEffect::Blob {
                notebook,
                sha256,
                bytes,
            } => (4, notebook, sha256, bytes),
        }
    }
}

/// A non-fatal problem while loading (shown like the other apps' reader warnings).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct LoadWarning {
    /// `truncated_log` | `bad_record` | `blob_mismatch` | `unknown_entry`.
    pub code: String,
    pub doc: String,
    pub message: String,
}

fn push_u16(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    let n = u16::try_from(b.len()).unwrap_or(u16::MAX);
    out.extend_from_slice(&n.to_le_bytes());
    out.extend_from_slice(&b[..usize::from(n)]);
}

fn push_u32(out: &mut Vec<u8>, b: &[u8]) {
    let n = u32::try_from(b.len()).unwrap_or(u32::MAX);
    out.extend_from_slice(&n.to_le_bytes());
    out.extend_from_slice(b);
}

/// Encodes effects for the shells: `count:u32 { kind:u8 notebook:u16-str doc:u16-str bytes:u32-len }*`,
/// little-endian (kind 1 append, 2 replace, 3 delete, 4 blob with `doc` = sha256 hex).
#[must_use]
pub fn encode_effects(effects: &[PersistEffect]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(
        &u32::try_from(effects.len())
            .unwrap_or(u32::MAX)
            .to_le_bytes(),
    );
    for e in effects {
        let (kind, nb, doc, bytes) = e.parts();
        out.push(kind);
        push_u16(&mut out, nb);
        push_u16(&mut out, doc);
        push_u32(&mut out, bytes);
    }
    out
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.at..self.at.checked_add(n)?)?;
        self.at += n;
        Some(s)
    }
    fn u16(&mut self) -> Option<u16> {
        self.take(2).map(|s| u16::from_le_bytes([s[0], s[1]]))
    }
    fn u32(&mut self) -> Option<u32> {
        self.take(4)
            .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn str16(&mut self) -> Option<String> {
        let n = self.u16()?;
        String::from_utf8(self.take(usize::from(n))?.to_vec()).ok()
    }
    fn bytes32(&mut self) -> Option<Vec<u8>> {
        let n = self.u32()?;
        Some(self.take(n as usize)?.to_vec())
    }
}

/// Decodes [`encode_effects`] output (`None` if malformed).
#[must_use]
pub fn decode_effects(b: &[u8]) -> Option<Vec<PersistEffect>> {
    let mut r = Reader { b, at: 0 };
    let n = r.u32()?;
    let mut out = Vec::new();
    for _ in 0..n {
        let kind = r.take(1)?[0];
        let notebook = r.str16()?;
        let doc = r.str16()?;
        let bytes = r.bytes32()?;
        out.push(match kind {
            1 => PersistEffect::Append {
                notebook,
                doc,
                bytes,
            },
            2 => PersistEffect::Replace {
                notebook,
                doc,
                snapshot: bytes,
            },
            3 => PersistEffect::Delete { notebook, doc },
            4 => PersistEffect::Blob {
                notebook,
                sha256: doc,
                bytes,
            },
            _ => return None,
        });
    }
    Some(out)
}

/// One `.log` record: `len:u32 LE` + bytes.
#[must_use]
pub fn log_record(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 4);
    push_u32(&mut out, bytes);
    out
}

/// Splits a `.log` file into records. A truncated last record (a crash during append) is dropped; the second
/// value is the byte length of the valid prefix (shorter than `log` exactly when something was dropped).
#[must_use]
pub fn split_log(log: &[u8]) -> (Vec<Vec<u8>>, usize) {
    let mut r = Reader { b: log, at: 0 };
    let mut out = Vec::new();
    loop {
        let start = r.at;
        if start == log.len() {
            return (out, start);
        }
        match r.bytes32() {
            Some(b) => out.push(b),
            None => return (out, start),
        }
    }
}

/// Blob framing for `export_backup` in the shells: `{ len:u32 bytes }*`.
#[must_use]
pub fn split_blobs(b: &[u8]) -> Vec<Vec<u8>> {
    split_log(b).0
}

/// SHA-256 hex of a blob: its id.
#[must_use]
pub fn blob_id(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(bytes);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// Ids used as file names (`docs/<id>.*`, `blobs/<sha>`) must be plain: ASCII letters, digits, `-`, `_`.
#[must_use]
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effects_round_trip() {
        let e = vec![
            PersistEffect::Append {
                notebook: "nb".into(),
                doc: "d".into(),
                bytes: vec![1, 2],
            },
            PersistEffect::Replace {
                notebook: "nb".into(),
                doc: "d".into(),
                snapshot: vec![3],
            },
            PersistEffect::Delete {
                notebook: "nb".into(),
                doc: "x".into(),
            },
            PersistEffect::Blob {
                notebook: "nb".into(),
                sha256: blob_id(b"a"),
                bytes: b"a".to_vec(),
            },
        ];
        assert_eq!(decode_effects(&encode_effects(&e)).unwrap(), e);
        assert!(decode_effects(&encode_effects(&e)[..10]).is_none());
    }

    #[test]
    fn log_records_and_truncation() {
        let mut log = log_record(b"one");
        log.extend(log_record(b"two"));
        let good = log.len();
        log.extend(&log_record(b"three")[..5]);
        let (recs, valid) = split_log(&log);
        assert_eq!(recs, vec![b"one".to_vec(), b"two".to_vec()]);
        assert_eq!(valid, good);
        assert_eq!(split_log(&log[..2]), (vec![], 0));
    }

    #[test]
    fn ids() {
        assert_eq!(
            blob_id(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(is_safe_id("pg-1f-3") && !is_safe_id("../x") && !is_safe_id(""));
    }
}
