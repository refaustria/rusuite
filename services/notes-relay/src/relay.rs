//! The relay's logic, independent of the transport: connections, subscriptions, validation and fan-out. One mutex
//! guards the store and the subscription table, so "read the log for a new subscriber" and "append + forward" can
//! never interleave (no gaps, no duplicates between catch-up and live delivery).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use notes_sync::protocol::{self, ClientMsg, DocSeq, ErrorCode, RelayMsg, StopSharing};
use notes_sync::{
    join_request_signer, key_wrap_recipient, DeviceId, DocId, Envelope, Kind, MemberList,
    NotebookId, Role, SyncError,
};
use rand_core::{OsRng, RngCore};
use tokio::sync::{mpsc, watch};

use crate::clock::Clock;
use crate::config::Limits;
use crate::store::Store;

/// An encoded `RelayMsg`, shared between the connections it goes to.
pub type Frame = Arc<Vec<u8>>;

struct Sub {
    device: DeviceId,
    member: bool,
    docs: HashSet<DocId>,
}

struct ConnEntry {
    tx: mpsc::Sender<Frame>,
    subs: HashMap<NotebookId, Sub>,
}

struct Inner {
    store: Store,
    conns: HashMap<u64, ConnEntry>,
}

/// One WebSocket connection's identity on the relay.
pub struct ConnHandle {
    pub id: u64,
    pub challenge: [u8; 32],
}

pub struct Relay {
    inner: Mutex<Inner>,
    clock: Arc<dyn Clock>,
    pub limits: Limits,
    next_conn: AtomicU64,
    shutdown: watch::Sender<bool>,
}

fn code_of(e: &SyncError) -> ErrorCode {
    match e {
        SyncError::BadSignature | SyncError::WeakKey => ErrorCode::BadSignature,
        SyncError::NotMember => ErrorCode::NotMember,
        SyncError::Forbidden { .. } => ErrorCode::Forbidden,
        SyncError::WrongEpoch { .. } => ErrorCode::WrongEpoch,
        SyncError::MemberList(_) => ErrorCode::MemberList,
        _ => ErrorCode::Malformed,
    }
}

fn kind_name(k: Kind) -> &'static str {
    match k {
        Kind::Update => "update",
        Kind::Snapshot => "snapshot",
        Kind::Blob => "blob",
        Kind::Presence => "presence",
        Kind::MemberList => "member-list",
        Kind::KeyWrap => "key-wrap",
        Kind::JoinRequest => "join-request",
    }
}

fn frame(m: &RelayMsg) -> Frame {
    Arc::new(m.encode())
}

impl Inner {
    /// Queues `m` for every connection matching `pred` (except `skip`). A connection whose queue is full is dropped:
    /// it reconnects and catches up from its "have" markers.
    fn fan_out(&mut self, skip: u64, nb: &NotebookId, m: &RelayMsg, pred: impl Fn(&Sub) -> bool) {
        let f = frame(m);
        let mut overflow = Vec::new();
        for (id, c) in &self.conns {
            if *id == skip {
                continue;
            }
            if let Some(s) = c.subs.get(nb) {
                if pred(s) && c.tx.try_send(f.clone()).is_err() {
                    overflow.push(*id);
                }
            }
        }
        for id in overflow {
            eprintln!("notes-relay event=drop-slow-connection");
            self.conns.remove(&id);
        }
    }

    fn sub(&self, conn: u64, nb: &NotebookId) -> Option<&Sub> {
        self.conns.get(&conn).and_then(|c| c.subs.get(nb))
    }

    /// The connection authenticated as `author` (a current member) for `nb`.
    fn require_member_sub(
        &self,
        conn: u64,
        nb: &NotebookId,
        author: &DeviceId,
    ) -> Result<(), ErrorCode> {
        match self.sub(conn, nb) {
            Some(s) if s.member && s.device == *author => Ok(()),
            _ => Err(ErrorCode::NotSubscribed),
        }
    }
}

impl Relay {
    pub fn new(
        data_dir: &Path,
        limits: Limits,
        clock: Arc<dyn Clock>,
    ) -> std::io::Result<Arc<Relay>> {
        Ok(Arc::new(Relay {
            inner: Mutex::new(Inner {
                store: Store::new(data_dir, limits.clone())?,
                conns: HashMap::new(),
            }),
            clock,
            limits,
            next_conn: AtomicU64::new(1),
            shutdown: watch::channel(false).0,
        }))
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn now(&self) -> u64 {
        self.clock.now()
    }

    /// Asks every connection to close (graceful shutdown).
    pub fn shutdown(&self) {
        let _ = self.shutdown.send(true);
    }

    pub fn shutdown_signal(&self) -> watch::Receiver<bool> {
        self.shutdown.subscribe()
    }

    pub fn register(&self) -> (ConnHandle, mpsc::Receiver<Frame>) {
        let id = self.next_conn.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel(self.limits.connection_queue);
        let mut challenge = [0u8; 32];
        OsRng.fill_bytes(&mut challenge);
        self.lock().conns.insert(
            id,
            ConnEntry {
                tx,
                subs: HashMap::new(),
            },
        );
        (ConnHandle { id, challenge }, rx)
    }

    pub fn unregister(&self, id: u64) {
        self.lock().conns.remove(&id);
    }

    /// Number of open connections (health, tests).
    pub fn connections(&self) -> usize {
        self.lock().conns.len()
    }

    /// Handles one client message; returns the frames for this connection, in order. Frames for other connections
    /// are queued on their channels.
    pub fn handle(&self, conn: &ConnHandle, msg: ClientMsg) -> Vec<RelayMsg> {
        match msg {
            ClientMsg::Subscribe {
                notebook_id,
                signing_pub,
                proof,
                docs,
            } => self.subscribe(conn, notebook_id, &signing_pub, &proof, docs),
            ClientMsg::Unsubscribe { notebook_id } => {
                if let Some(c) = self.lock().conns.get_mut(&conn.id) {
                    c.subs.remove(&notebook_id);
                }
                Vec::new()
            }
            ClientMsg::Publish { tag, envelope } => {
                let kind = envelope.kind;
                match self.publish(conn, &envelope) {
                    Ok(Some(seq)) => vec![RelayMsg::Accepted { tag, seq }],
                    Ok(None) => Vec::new(),
                    Err(code) => {
                        eprintln!(
                            "notes-relay event=reject kind={} code={code:?}",
                            kind_name(kind)
                        );
                        if kind == Kind::Presence {
                            vec![RelayMsg::Error {
                                code,
                                notebook_id: Some(envelope.notebook_id),
                            }]
                        } else {
                            vec![RelayMsg::Rejected { tag, code }]
                        }
                    }
                }
            }
            ClientMsg::FetchBlob {
                notebook_id,
                blob_id,
            } => {
                let mut g = self.lock();
                let member = g.sub(conn.id, &notebook_id).is_some_and(|s| s.member);
                if !member {
                    return vec![RelayMsg::Error {
                        code: ErrorCode::NotSubscribed,
                        notebook_id: Some(notebook_id),
                    }];
                }
                match g.store.get_blob(&notebook_id, &blob_id) {
                    Ok(Some(envelope)) => vec![RelayMsg::Blob { envelope }],
                    Ok(None) => vec![RelayMsg::BlobMissing {
                        notebook_id,
                        blob_id,
                    }],
                    Err(code) => vec![RelayMsg::Error {
                        code,
                        notebook_id: Some(notebook_id),
                    }],
                }
            }
            ClientMsg::StopSharing(req) => {
                let nb = req.notebook_id;
                match self.stop_sharing(&req, conn.id) {
                    Ok(()) => vec![RelayMsg::Deleted { notebook_id: nb }],
                    Err(code) => vec![RelayMsg::Error {
                        code,
                        notebook_id: Some(nb),
                    }],
                }
            }
        }
    }

    fn subscribe(
        &self,
        conn: &ConnHandle,
        nb: NotebookId,
        signing_pub: &[u8; 32],
        proof: &[u8; 64],
        docs: Vec<DocSeq>,
    ) -> Vec<RelayMsg> {
        let err = |code| {
            vec![RelayMsg::Error {
                code,
                notebook_id: Some(nb),
            }]
        };
        let device = match protocol::verify_subscribe(&conn.challenge, &nb, signing_pub, proof) {
            Ok(d) => d,
            Err(_) => return err(ErrorCode::BadSignature),
        };
        if docs.len() > 100_000 {
            return err(ErrorCode::TooLarge);
        }
        let now = self.now();
        let mut g = self.lock();
        let inner = &mut *g;
        let (role, was_member) = match inner.store.get(&nb) {
            Ok(n) => (n.latest().role_of(&device), n.chain.was_member(&device)),
            Err(code) => return err(code),
        };
        let Some(c) = inner.conns.get_mut(&conn.id) else {
            return Vec::new();
        };
        let Some(role) = role else {
            if was_member {
                c.subs.remove(&nb);
                return vec![RelayMsg::Revoked { notebook_id: nb }];
            }
            c.subs.insert(
                nb,
                Sub {
                    device,
                    member: false,
                    docs: HashSet::new(),
                },
            );
            return vec![RelayMsg::Pending { notebook_id: nb }];
        };
        let sub = c.subs.entry(nb).or_insert(Sub {
            device,
            member: true,
            docs: HashSet::new(),
        });
        sub.device = device;
        sub.member = true;
        sub.docs.extend(docs.iter().map(|d| d.doc_id));
        let store = &mut inner.store;
        let mut out = Vec::new();
        let result = (|| -> Result<(), ErrorCode> {
            let _ = store.touch(&nb, now);
            let member_lists = store.get(&nb)?.member_envelopes.clone();
            let key_wraps = store.wraps_for(&nb, &device)?;
            let join_requests = if role.can_manage() {
                store.joins(&nb, now)?
            } else {
                Vec::new()
            };
            out.push(RelayMsg::Subscribed {
                notebook_id: nb,
                member_lists,
                key_wraps,
                join_requests,
                docs: store.doc_list(&nb)?,
            });
            for d in &docs {
                let entries = store.read_doc(&nb, &d.doc_id, d.seq)?;
                let last = store
                    .get(&nb)?
                    .docs
                    .get(&d.doc_id)
                    .map(|s| s.last_seq)
                    .unwrap_or(0);
                out.extend(
                    entries
                        .into_iter()
                        .map(|(seq, envelope)| RelayMsg::Deliver { seq, envelope }),
                );
                out.push(RelayMsg::CaughtUp {
                    notebook_id: nb,
                    doc_id: d.doc_id,
                    last,
                });
            }
            Ok(())
        })();
        match result {
            Ok(()) => out,
            Err(code) => err(code),
        }
    }

    /// The epoch rule: not newer than the member list's; an older one only within the grace window after rotation.
    fn check_epoch(
        &self,
        latest_epoch: u32,
        since: u64,
        env: &Envelope,
        now: u64,
    ) -> Result<(), ErrorCode> {
        if env.epoch > latest_epoch {
            return Err(ErrorCode::WrongEpoch);
        }
        if env.epoch < latest_epoch && now >= since.saturating_add(self.limits.epoch_grace_secs) {
            return Err(ErrorCode::StaleEpoch);
        }
        Ok(())
    }

    fn check_size(&self, env: &Envelope) -> Result<(), ErrorCode> {
        let max = match env.kind {
            Kind::Blob => self.limits.blob_max_bytes,
            Kind::JoinRequest => self.limits.join_request_max_bytes,
            _ => self.limits.envelope_max_bytes,
        };
        if env.encoded_len() > max {
            return Err(ErrorCode::TooLarge);
        }
        Ok(())
    }

    /// `Ok(Some(seq))` → `Accepted`; `Ok(None)` → no reply (presence).
    fn publish(&self, conn: &ConnHandle, env: &Envelope) -> Result<Option<u64>, ErrorCode> {
        self.check_size(env)?;
        let now = self.now();
        let nb = env.notebook_id;
        let mut g = self.lock();
        let inner = &mut *g;
        match env.kind {
            Kind::MemberList => {
                if !inner.store.exists(&nb) {
                    let list = MemberList::validate_genesis(env).map_err(|e| code_of(&e))?;
                    inner.store.create(env, now)?;
                    eprintln!("notes-relay event=create members={}", list.members.len());
                    return Ok(Some(list.version));
                }
                let n = inner.store.get(&nb)?;
                let prev = n.latest().clone();
                let next = prev.validate_next(env).map_err(|e| code_of(&e))?;
                inner.require_member_sub(conn.id, &nb, &env.author)?;
                inner.store.append_member_list(env, now)?;
                let admitted: Vec<DeviceId> = next
                    .members
                    .iter()
                    .filter(|m| prev.member(&m.device_id).is_none())
                    .map(|m| m.device_id)
                    .collect();
                inner.store.consume_joins(&nb, &admitted)?;
                // Revocations and admissions for open subscriptions.
                let mut notices = Vec::new();
                for c in inner.conns.values_mut() {
                    let Some(s) = c.subs.get(&nb) else { continue };
                    let listed = next.member(&s.device).is_some();
                    let notice = match (s.member, listed) {
                        (true, false) => Some(RelayMsg::Revoked { notebook_id: nb }),
                        (false, true) => Some(RelayMsg::Admitted { notebook_id: nb }),
                        _ => None,
                    };
                    if let Some(m) = notice {
                        c.subs.remove(&nb);
                        notices.push((c.tx.clone(), m));
                    }
                }
                for (tx, m) in notices {
                    let _ = tx.try_send(frame(&m));
                }
                inner.fan_out(
                    conn.id,
                    &nb,
                    &RelayMsg::MemberList {
                        envelope: env.clone(),
                    },
                    |s| s.member,
                );
                eprintln!(
                    "notes-relay event=member-list members={} rotated={}",
                    next.members.len(),
                    next.epoch != prev.epoch
                );
                Ok(Some(next.version))
            }
            Kind::KeyWrap => {
                let n = inner.store.get(&nb)?;
                let latest = n.latest().clone();
                latest.authorize(env).map_err(|e| code_of(&e))?;
                if env.epoch != latest.epoch {
                    return Err(ErrorCode::WrongEpoch);
                }
                let recipient = key_wrap_recipient(env).map_err(|e| code_of(&e))?;
                if latest.member(&recipient).is_none() {
                    return Err(ErrorCode::NotMember);
                }
                inner.require_member_sub(conn.id, &nb, &env.author)?;
                inner.store.put_wrap(env, &recipient)?;
                inner.fan_out(
                    conn.id,
                    &nb,
                    &RelayMsg::KeyWrap {
                        envelope: env.clone(),
                    },
                    |s| s.device == recipient,
                );
                Ok(Some(0))
            }
            Kind::JoinRequest => {
                let n = inner.store.get(&nb)?;
                join_request_signer(env).map_err(|e| code_of(&e))?;
                if n.latest().member(&env.author).is_some() {
                    return Err(ErrorCode::Forbidden);
                }
                let managers: HashSet<DeviceId> = n
                    .latest()
                    .members
                    .iter()
                    .filter(|m| m.role.can_manage())
                    .map(|m| m.device_id)
                    .collect();
                match inner.sub(conn.id, &nb) {
                    Some(s) if !s.member && s.device == env.author => {}
                    _ => return Err(ErrorCode::NotSubscribed),
                }
                inner.store.put_join(env, now)?;
                inner.fan_out(
                    conn.id,
                    &nb,
                    &RelayMsg::JoinRequest {
                        envelope: env.clone(),
                    },
                    |s| s.member && managers.contains(&s.device),
                );
                Ok(Some(0))
            }
            Kind::Update | Kind::Snapshot | Kind::Blob | Kind::Presence => {
                let n = inner.store.get(&nb)?;
                let latest = n.latest();
                latest.authorize(env).map_err(|e| code_of(&e))?;
                let since = n.epoch_since(latest.epoch);
                self.check_epoch(latest.epoch, since, env, now)?;
                inner.require_member_sub(conn.id, &nb, &env.author)?;
                match env.kind {
                    Kind::Update => {
                        let seq = inner.store.append_update(env, now)?;
                        let doc = env.doc_id;
                        inner.fan_out(
                            conn.id,
                            &nb,
                            &RelayMsg::Deliver {
                                seq,
                                envelope: env.clone(),
                            },
                            |s| s.member && s.docs.contains(&doc),
                        );
                        Ok(Some(seq))
                    }
                    Kind::Snapshot => {
                        inner.store.put_snapshot(env, now)?;
                        Ok(Some(env.covers))
                    }
                    Kind::Blob => {
                        inner.store.put_blob(env)?;
                        Ok(Some(0))
                    }
                    _ => {
                        let doc = env.doc_id;
                        inner.fan_out(
                            conn.id,
                            &nb,
                            &RelayMsg::Presence {
                                envelope: env.clone(),
                            },
                            |s| s.member && (doc == DocId::NOTEBOOK || s.docs.contains(&doc)),
                        );
                        Ok(None)
                    }
                }
            }
        }
    }

    /// Owner-signed "stop sharing": deletes everything and tells the subscribers. `conn` (0 = HTTP) gets the reply
    /// directly instead of a queued notice.
    pub fn stop_sharing(&self, req: &StopSharing, conn: u64) -> Result<(), ErrorCode> {
        let now = self.now();
        let device = req.verify(now).map_err(|e| match e {
            SyncError::BadSignature | SyncError::WeakKey => ErrorCode::BadSignature,
            _ => ErrorCode::Malformed,
        })?;
        let nb = req.notebook_id;
        let mut g = self.lock();
        let inner = &mut *g;
        let n = inner.store.get(&nb)?;
        match n.latest().role_of(&device) {
            Some(Role::Owner) => {}
            Some(_) => return Err(ErrorCode::Forbidden),
            None => return Err(ErrorCode::NotMember),
        }
        inner.store.delete(&nb)?;
        let f = frame(&RelayMsg::Deleted { notebook_id: nb });
        for (id, c) in inner.conns.iter_mut() {
            if c.subs.remove(&nb).is_some() && *id != conn {
                let _ = c.tx.try_send(f.clone());
            }
        }
        eprintln!("notes-relay event=stop-sharing");
        Ok(())
    }

    /// Inactivity and join-request expiry.
    pub fn sweep(&self) {
        let now = self.now();
        let mut g = self.lock();
        let deleted = g.store.sweep(now);
        for nb in &deleted {
            let f = frame(&RelayMsg::Deleted { notebook_id: *nb });
            for c in g.conns.values_mut() {
                if c.subs.remove(nb).is_some() {
                    let _ = c.tx.try_send(f.clone());
                }
            }
        }
        if !deleted.is_empty() {
            eprintln!("notes-relay event=sweep deleted={}", deleted.len());
        }
    }

    /// The storage root (tests).
    pub fn data_dir(&self) -> std::path::PathBuf {
        self.lock().store.root().to_path_buf()
    }
}
