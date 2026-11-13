//! On-disk storage. One directory per notebook (`<data>/<notebook hex>/`), nothing but signed ciphertext envelopes and
//! counters – no IP addresses, no names, no plaintext:
//!
//! ```text
//! meta.json                    {created_at, last_active, epochs: [[epoch, since]]}
//! members/<version:020>.env    every member-list version (the chain)
//! wraps/<epoch:010>-<device>   key wraps (one per epoch and recipient device)
//! joins/<invite id>            8-byte received-at + join-request envelope (8 bytes only = consumed)
//! docs/<doc>.log               append-only records: seq u64 BE ‖ len u32 BE ‖ envelope
//! docs/<doc>.snap              the latest snapshot envelope (its `covers` = the seq it includes)
//! blobs/<blob id>              blob envelopes
//! ```
//!
//! Files are written whole (temp file + rename) except log appends; a torn trailing log record is cut on load.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use notes_sync::protocol::{DocSeq, ErrorCode};
use notes_sync::{DeviceId, DocId, Envelope, MemberChain, MemberList, NotebookId};
use serde::{Deserialize, Serialize};

use crate::config::Limits;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Meta {
    pub created_at: u64,
    pub last_active: u64,
    /// When each epoch became current.
    pub epochs: Vec<(u32, u64)>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DocState {
    pub last_seq: u64,
    pub snapshot_covers: u64,
}

pub struct Notebook {
    dir: PathBuf,
    pub chain: MemberChain,
    pub member_envelopes: Vec<Envelope>,
    pub meta: Meta,
    persisted_active: u64,
    pub docs: BTreeMap<DocId, DocState>,
    pub bytes: u64,
}

impl Notebook {
    pub fn latest(&self) -> &MemberList {
        self.chain.latest()
    }

    /// When `epoch` became current (0 if unknown).
    pub fn epoch_since(&self, epoch: u32) -> u64 {
        self.meta
            .epochs
            .iter()
            .rev()
            .find(|(e, _)| *e == epoch)
            .map(|(_, t)| *t)
            .unwrap_or(0)
    }
}

pub struct Store {
    root: PathBuf,
    limits: Limits,
    open: HashMap<NotebookId, Notebook>,
}

fn io(e: std::io::Error) -> ErrorCode {
    eprintln!("notes-relay event=io-error kind={:?}", e.kind());
    ErrorCode::Internal
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), ErrorCode> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(io)?;
    fs::rename(&tmp, path).map_err(io)
}

fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn dir_bytes(dir: &Path) -> u64 {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_bytes(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Parses a log file; returns the records and the length of the valid prefix.
fn parse_log(b: &[u8]) -> (Vec<(u64, &[u8])>, usize) {
    let mut out = Vec::new();
    let mut at = 0;
    while b.len() - at >= 12 {
        let seq = u64::from_be_bytes(b[at..at + 8].try_into().expect("8"));
        let len = u32::from_be_bytes(b[at + 8..at + 12].try_into().expect("4")) as usize;
        if b.len() - at - 12 < len {
            break;
        }
        out.push((seq, &b[at + 12..at + 12 + len]));
        at += 12 + len;
    }
    (out, at)
}

fn record(seq: u64, env: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(12 + env.len());
    v.extend_from_slice(&seq.to_be_bytes());
    v.extend_from_slice(&(env.len() as u32).to_be_bytes());
    v.extend_from_slice(env);
    v
}

impl Store {
    pub fn new(root: impl Into<PathBuf>, limits: Limits) -> std::io::Result<Store> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        Ok(Store {
            root,
            limits,
            open: HashMap::new(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn dir(&self, nb: &NotebookId) -> PathBuf {
        self.root.join(nb.to_hex())
    }

    pub fn exists(&self, nb: &NotebookId) -> bool {
        self.open.contains_key(nb) || self.dir(nb).join("meta.json").is_file()
    }

    /// The notebook, loaded from disk on first use.
    pub fn get(&mut self, nb: &NotebookId) -> Result<&mut Notebook, ErrorCode> {
        if !self.open.contains_key(nb) {
            let n = self.load(nb)?;
            self.open.insert(*nb, n);
        }
        Ok(self.open.get_mut(nb).expect("inserted"))
    }

    fn load(&self, nb: &NotebookId) -> Result<Notebook, ErrorCode> {
        let dir = self.dir(nb);
        let meta: Meta = match fs::read(dir.join("meta.json")) {
            Ok(b) => serde_json::from_slice(&b).map_err(|_| ErrorCode::Internal)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(ErrorCode::NotFound),
            Err(e) => return Err(io(e)),
        };
        let mut names: Vec<_> = fs::read_dir(dir.join("members"))
            .map_err(io)?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "env"))
            .collect();
        names.sort();
        let mut member_envelopes = Vec::new();
        for p in names {
            let b = fs::read(&p).map_err(io)?;
            member_envelopes.push(Envelope::decode(&b).map_err(|_| ErrorCode::Internal)?);
        }
        // Stored lists were validated on the way in; re-validating guards against a damaged directory.
        let chain =
            MemberChain::from_envelopes(&member_envelopes).map_err(|_| ErrorCode::Internal)?;
        let mut docs = BTreeMap::new();
        if let Ok(rd) = fs::read_dir(dir.join("docs")) {
            for e in rd.flatten() {
                let p = e.path();
                let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                let Ok(doc) = DocId::from_hex(stem) else {
                    continue;
                };
                let st: &mut DocState = docs.entry(doc).or_default();
                match p.extension().and_then(|x| x.to_str()) {
                    Some("log") => {
                        let b = fs::read(&p).map_err(io)?;
                        let (recs, valid) = parse_log(&b);
                        if valid < b.len() {
                            // A torn append (crash): cut it.
                            let f = fs::OpenOptions::new().write(true).open(&p).map_err(io)?;
                            f.set_len(valid as u64).map_err(io)?;
                        }
                        if let Some((seq, _)) = recs.last() {
                            st.last_seq = st.last_seq.max(*seq);
                        }
                    }
                    Some("snap") => {
                        let b = fs::read(&p).map_err(io)?;
                        let env = Envelope::decode(&b).map_err(|_| ErrorCode::Internal)?;
                        st.snapshot_covers = env.covers;
                        st.last_seq = st.last_seq.max(env.covers);
                    }
                    _ => {}
                }
            }
        }
        Ok(Notebook {
            bytes: dir_bytes(&dir),
            persisted_active: meta.last_active,
            dir,
            chain,
            member_envelopes,
            meta,
            docs,
        })
    }

    fn save_meta(n: &mut Notebook) -> Result<(), ErrorCode> {
        let b = serde_json::to_vec(&n.meta).map_err(|_| ErrorCode::Internal)?;
        write_atomic(&n.dir.join("meta.json"), &b)?;
        n.persisted_active = n.meta.last_active;
        Ok(())
    }

    /// Records activity (persisted at most hourly: the inactivity limit counts in months).
    pub fn touch(&mut self, nb: &NotebookId, now: u64) -> Result<(), ErrorCode> {
        let n = self.get(nb)?;
        n.meta.last_active = n.meta.last_active.max(now);
        if n.meta.last_active >= n.persisted_active + 3600 {
            Store::save_meta(n)?;
        }
        Ok(())
    }

    fn check_quota(&self, n: &Notebook, add: u64, remove: u64) -> Result<(), ErrorCode> {
        if n.bytes.saturating_sub(remove) + add > self.limits.notebook_quota_bytes {
            return Err(ErrorCode::QuotaExceeded);
        }
        Ok(())
    }

    /// Creates a notebook from its validated genesis list.
    pub fn create(&mut self, genesis: &Envelope, now: u64) -> Result<(), ErrorCode> {
        let nb = genesis.notebook_id;
        if self.exists(&nb) {
            return Err(ErrorCode::MemberList);
        }
        let chain = MemberChain::genesis(genesis).map_err(|_| ErrorCode::MemberList)?;
        let dir = self.dir(&nb);
        for sub in ["members", "wraps", "joins", "docs", "blobs"] {
            fs::create_dir_all(dir.join(sub)).map_err(io)?;
        }
        let bytes = genesis.encode();
        write_atomic(&dir.join("members").join(format!("{:020}.env", 1)), &bytes)?;
        let mut n = Notebook {
            dir,
            chain,
            member_envelopes: vec![genesis.clone()],
            meta: Meta {
                created_at: now,
                last_active: now,
                epochs: vec![(0, now)],
            },
            persisted_active: 0,
            docs: BTreeMap::new(),
            bytes: bytes.len() as u64,
        };
        Store::save_meta(&mut n)?;
        n.bytes = dir_bytes(&n.dir);
        self.open.insert(nb, n);
        Ok(())
    }

    /// Appends a member-list version that the caller validated against the latest one.
    pub fn append_member_list(&mut self, env: &Envelope, now: u64) -> Result<(), ErrorCode> {
        let nb = env.notebook_id;
        let size = env.encoded_len() as u64;
        self.get(&nb)?;
        self.check_quota(self.open.get(&nb).expect("loaded"), size, 0)?;
        let n = self.open.get_mut(&nb).expect("loaded");
        let prev_epoch = n.latest().epoch;
        n.chain.apply(env).map_err(|_| ErrorCode::MemberList)?;
        let list = n.latest().clone();
        write_atomic(
            &n.dir
                .join("members")
                .join(format!("{:020}.env", list.version)),
            &env.encode(),
        )?;
        n.member_envelopes.push(env.clone());
        n.bytes += size;
        if list.epoch != prev_epoch {
            n.meta.epochs.push((list.epoch, now));
        }
        n.meta.last_active = now;
        Store::save_meta(n)
    }

    pub fn put_wrap(&mut self, env: &Envelope, recipient: &DeviceId) -> Result<(), ErrorCode> {
        let nb = env.notebook_id;
        let b = env.encode();
        let n = self.get(&nb)?;
        let path = n
            .dir
            .join("wraps")
            .join(format!("{:010}-{}", env.epoch, recipient.to_hex()));
        let old = file_len(&path);
        let n = self.open.get(&nb).expect("loaded");
        self.check_quota(n, b.len() as u64, old)?;
        write_atomic(&path, &b)?;
        let n = self.open.get_mut(&nb).expect("loaded");
        n.bytes = n.bytes - old + b.len() as u64;
        Ok(())
    }

    /// Key wraps addressed to `device`, oldest epoch first.
    pub fn wraps_for(
        &mut self,
        nb: &NotebookId,
        device: &DeviceId,
    ) -> Result<Vec<Envelope>, ErrorCode> {
        let n = self.get(nb)?;
        let suffix = format!("-{}", device.to_hex());
        let mut paths: Vec<_> = fs::read_dir(n.dir.join("wraps"))
            .map_err(io)?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|f| f.to_str())
                    .is_some_and(|f| f.ends_with(&suffix))
            })
            .collect();
        paths.sort();
        paths
            .iter()
            .map(|p| {
                let b = fs::read(p).map_err(io)?;
                Envelope::decode(&b).map_err(|_| ErrorCode::Internal)
            })
            .collect()
    }

    /// Stores a join request; one per invite id for the invite's lifetime (single use).
    pub fn put_join(&mut self, env: &Envelope, now: u64) -> Result<(), ErrorCode> {
        let nb = env.notebook_id;
        let max = self.limits.max_join_requests;
        let n = self.get(&nb)?;
        let dir = n.dir.join("joins");
        let path = dir.join(env.doc_id.to_hex());
        if path.exists() {
            return Err(ErrorCode::InviteUsed);
        }
        let count = fs::read_dir(&dir).map_err(io)?.count();
        if count >= max {
            return Err(ErrorCode::TooManyRequests);
        }
        let mut b = now.to_be_bytes().to_vec();
        b.extend_from_slice(&env.encode());
        let n = self.open.get(&nb).expect("loaded");
        self.check_quota(n, b.len() as u64, 0)?;
        write_atomic(&path, &b)?;
        self.open.get_mut(&nb).expect("loaded").bytes += b.len() as u64;
        Ok(())
    }

    /// Open (not consumed, not expired) join requests.
    pub fn joins(&mut self, nb: &NotebookId, now: u64) -> Result<Vec<Envelope>, ErrorCode> {
        let ttl = self.limits.join_request_ttl_secs;
        let n = self.get(nb)?;
        let mut out = Vec::new();
        for e in fs::read_dir(n.dir.join("joins")).map_err(io)?.flatten() {
            let Ok(b) = fs::read(e.path()) else { continue };
            if b.len() <= 8 {
                continue;
            }
            let at = u64::from_be_bytes(b[..8].try_into().expect("8"));
            if now >= at + ttl {
                continue;
            }
            if let Ok(env) = Envelope::decode(&b[8..]) {
                out.push(env);
            }
        }
        Ok(out)
    }

    /// Marks the join requests of `admitted` devices consumed (kept as 8-byte tombstones until they expire, so the
    /// invite cannot be used again).
    pub fn consume_joins(
        &mut self,
        nb: &NotebookId,
        admitted: &[DeviceId],
    ) -> Result<(), ErrorCode> {
        let n = self.get(nb)?;
        let mut freed = 0;
        for e in fs::read_dir(n.dir.join("joins")).map_err(io)?.flatten() {
            let Ok(b) = fs::read(e.path()) else { continue };
            if b.len() <= 8 {
                continue;
            }
            if let Ok(env) = Envelope::decode(&b[8..]) {
                if admitted.contains(&env.author) {
                    write_atomic(&e.path(), &b[..8])?;
                    freed += b.len() as u64 - 8;
                }
            }
        }
        n.bytes = n.bytes.saturating_sub(freed);
        Ok(())
    }

    /// Appends an update; returns its sequence number.
    pub fn append_update(&mut self, env: &Envelope, now: u64) -> Result<u64, ErrorCode> {
        let nb = env.notebook_id;
        let rec_len = 12 + env.encoded_len() as u64;
        let n = self.get(&nb)?;
        let seq = n.docs.get(&env.doc_id).map(|d| d.last_seq).unwrap_or(0) + 1;
        let n = self.open.get(&nb).expect("loaded");
        self.check_quota(n, rec_len, 0)?;
        let n = self.open.get_mut(&nb).expect("loaded");
        let path = n
            .dir
            .join("docs")
            .join(format!("{}.log", env.doc_id.to_hex()));
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(io)?;
        f.write_all(&record(seq, &env.encode())).map_err(io)?;
        n.docs.entry(env.doc_id).or_default().last_seq = seq;
        n.bytes += rec_len;
        n.meta.last_active = n.meta.last_active.max(now);
        if n.meta.last_active >= n.persisted_active + 3600 {
            Store::save_meta(n)?;
        }
        Ok(seq)
    }

    /// Stores a snapshot and drops the log entries it covers.
    pub fn put_snapshot(&mut self, env: &Envelope, now: u64) -> Result<(), ErrorCode> {
        let nb = env.notebook_id;
        let n = self.get(&nb)?;
        let st = n.docs.get(&env.doc_id).copied().unwrap_or_default();
        if env.covers == 0 || env.covers > st.last_seq {
            return Err(ErrorCode::Malformed);
        }
        if env.covers <= st.snapshot_covers {
            return Err(ErrorCode::Outdated);
        }
        let docs = n.dir.join("docs");
        let log_path = docs.join(format!("{}.log", env.doc_id.to_hex()));
        let snap_path = docs.join(format!("{}.snap", env.doc_id.to_hex()));
        let old_log = fs::read(&log_path).unwrap_or_default();
        let (recs, _) = parse_log(&old_log);
        let mut kept = Vec::new();
        for (seq, b) in recs.into_iter().filter(|(s, _)| *s > env.covers) {
            kept.extend_from_slice(&record(seq, b));
        }
        let snap = env.encode();
        let old_snap = file_len(&snap_path);
        let removed = old_snap + old_log.len() as u64;
        let added = snap.len() as u64 + kept.len() as u64;
        let n = self.open.get(&nb).expect("loaded");
        self.check_quota(n, added, removed)?;
        write_atomic(&snap_path, &snap)?;
        write_atomic(&log_path, &kept)?;
        let n = self.open.get_mut(&nb).expect("loaded");
        n.bytes = n.bytes.saturating_sub(removed) + added;
        n.docs.entry(env.doc_id).or_default().snapshot_covers = env.covers;
        n.meta.last_active = n.meta.last_active.max(now);
        Ok(())
    }

    /// What a client with `have` is missing: the snapshot (if it covers more than `have`) and the later log entries,
    /// as `(seq, envelope)` in order (a snapshot is delivered with seq = its `covers`).
    pub fn read_doc(
        &mut self,
        nb: &NotebookId,
        doc: &DocId,
        have: u64,
    ) -> Result<Vec<(u64, Envelope)>, ErrorCode> {
        let n = self.get(nb)?;
        let st = n.docs.get(doc).copied().unwrap_or_default();
        let docs = n.dir.join("docs");
        let mut out = Vec::new();
        let mut from = have;
        if st.snapshot_covers > have {
            let b = fs::read(docs.join(format!("{}.snap", doc.to_hex()))).map_err(io)?;
            out.push((
                st.snapshot_covers,
                Envelope::decode(&b).map_err(|_| ErrorCode::Internal)?,
            ));
            from = st.snapshot_covers;
        }
        let log = fs::read(docs.join(format!("{}.log", doc.to_hex()))).unwrap_or_default();
        for (seq, b) in parse_log(&log).0 {
            if seq > from {
                out.push((seq, Envelope::decode(b).map_err(|_| ErrorCode::Internal)?));
            }
        }
        Ok(out)
    }

    pub fn doc_list(&mut self, nb: &NotebookId) -> Result<Vec<DocSeq>, ErrorCode> {
        Ok(self
            .get(nb)?
            .docs
            .iter()
            .map(|(d, s)| DocSeq {
                doc_id: *d,
                seq: s.last_seq,
            })
            .collect())
    }

    /// Stores a blob (first write wins: blob ids are content-derived by the clients).
    pub fn put_blob(&mut self, env: &Envelope) -> Result<(), ErrorCode> {
        let nb = env.notebook_id;
        let n = self.get(&nb)?;
        let path = n.dir.join("blobs").join(env.doc_id.to_hex());
        if path.exists() {
            return Ok(());
        }
        let b = env.encode();
        let n = self.open.get(&nb).expect("loaded");
        self.check_quota(n, b.len() as u64, 0)?;
        write_atomic(&path, &b)?;
        self.open.get_mut(&nb).expect("loaded").bytes += b.len() as u64;
        Ok(())
    }

    pub fn get_blob(
        &mut self,
        nb: &NotebookId,
        blob: &DocId,
    ) -> Result<Option<Envelope>, ErrorCode> {
        let n = self.get(nb)?;
        match fs::read(n.dir.join("blobs").join(blob.to_hex())) {
            Ok(b) => Ok(Some(Envelope::decode(&b).map_err(|_| ErrorCode::Internal)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io(e)),
        }
    }

    /// Removes everything stored for the notebook.
    pub fn delete(&mut self, nb: &NotebookId) -> Result<(), ErrorCode> {
        self.open.remove(nb);
        match fs::remove_dir_all(self.dir(nb)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(ErrorCode::NotFound),
            Err(e) => Err(io(e)),
        }
    }

    /// Deletes notebooks inactive for longer than the limit and expired join requests. Returns the deleted notebooks.
    pub fn sweep(&mut self, now: u64) -> Vec<NotebookId> {
        let mut deleted = Vec::new();
        let Ok(rd) = fs::read_dir(&self.root) else {
            return deleted;
        };
        let ids: Vec<NotebookId> = rd
            .flatten()
            .filter_map(|e| {
                e.file_name()
                    .to_str()
                    .and_then(|s| NotebookId::from_hex(s).ok())
            })
            .collect();
        for nb in ids {
            let last = match self.open.get(&nb) {
                Some(n) => n.meta.last_active,
                None => fs::read(self.dir(&nb).join("meta.json"))
                    .ok()
                    .and_then(|b| serde_json::from_slice::<Meta>(&b).ok())
                    .map(|m| m.last_active)
                    .unwrap_or(0),
            };
            if now >= last.saturating_add(self.limits.inactive_secs) {
                if self.delete(&nb).is_ok() {
                    deleted.push(nb);
                }
                continue;
            }
            let ttl = self.limits.join_request_ttl_secs;
            let joins = self.dir(&nb).join("joins");
            let mut freed = 0;
            for e in fs::read_dir(&joins).into_iter().flatten().flatten() {
                let Ok(b) = fs::read(e.path()) else { continue };
                let at = b
                    .get(..8)
                    .map(|h| u64::from_be_bytes(h.try_into().expect("8")))
                    .unwrap_or(0);
                if now >= at.saturating_add(ttl) && fs::remove_file(e.path()).is_ok() {
                    freed += b.len() as u64;
                }
            }
            if let Some(n) = self.open.get_mut(&nb) {
                n.bytes = n.bytes.saturating_sub(freed);
            }
        }
        deleted
    }

    /// Drops the in-memory cache (tests: reload from disk).
    pub fn forget(&mut self) {
        self.open.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notes_sync::{create_share, DeviceKeys, Kind, OsRng};

    fn tmp() -> PathBuf {
        let mut r = [0u8; 8];
        rand_core::RngCore::fill_bytes(&mut OsRng, &mut r);
        std::env::temp_dir().join(format!(
            "notes-store-{}",
            r.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ))
    }

    #[test]
    fn torn_append_is_cut_and_quota_counts_bytes() {
        let dir = tmp();
        let limits = Limits {
            notebook_quota_bytes: 4096,
            ..Limits::default()
        };
        let owner = DeviceKeys::generate(&mut OsRng);
        let nb = NotebookId::random(&mut OsRng);
        let doc = DocId::random(&mut OsRng);
        let (ring, _, genesis) = create_share(&owner, nb, "A", &mut OsRng);
        let mut st = Store::new(&dir, limits.clone()).unwrap();
        st.create(&genesis, 1).unwrap();
        let up = |n: usize| {
            Envelope::seal(
                &owner,
                ring.current().unwrap(),
                nb,
                doc,
                Kind::Update,
                0,
                &vec![1u8; n],
                &mut OsRng,
            )
            .unwrap()
        };
        assert_eq!(st.append_update(&up(10), 2).unwrap(), 1);
        assert_eq!(st.append_update(&up(10), 2).unwrap(), 2);
        let bytes = st.get(&nb).unwrap().bytes;
        assert_eq!(bytes, dir_bytes(&dir.join(nb.to_hex())));
        assert_eq!(
            st.append_update(&up(4000), 3),
            Err(ErrorCode::QuotaExceeded)
        );
        // A crash in the middle of an append leaves a partial record.
        let log = dir
            .join(nb.to_hex())
            .join("docs")
            .join(format!("{}.log", doc.to_hex()));
        let full = fs::metadata(&log).unwrap().len();
        let mut f = fs::OpenOptions::new().append(true).open(&log).unwrap();
        f.write_all(&[0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1]).unwrap();
        drop(f);
        let mut st = Store::new(&dir, limits).unwrap();
        assert_eq!(st.get(&nb).unwrap().docs[&doc].last_seq, 2);
        assert_eq!(fs::metadata(&log).unwrap().len(), full);
        assert_eq!(st.append_update(&up(10), 4).unwrap(), 3);
        assert_eq!(st.read_doc(&nb, &doc, 1).unwrap().len(), 2);
        // Nothing about the device, IPs or names: only hex ids, numbers and envelopes.
        let meta = fs::read_to_string(dir.join(nb.to_hex()).join("meta.json")).unwrap();
        assert!(meta.starts_with("{\"created_at\":1,"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
