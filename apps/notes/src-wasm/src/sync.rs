//! Sharing (P11-N5b): the device side of `notes-sync` for the TypeScript sync engine (`apps/notes/src/sync`).
//!
//! One [`SyncClient`] per page holds the device keys and, per shared notebook, the verified member chain, the keyring,
//! the invites this device created and the join requests waiting for admission. Everything that needs a key or a
//! signature happens here; the engine moves opaque frames and envelopes and gets JSON events back. Decrypted bytes
//! (Loro updates, blobs, presence) are handed over separately through [`SyncClient::take_payload`] (no base64 on the
//! hot path).
//!
//! **Content payloads** (inside the encryption): `tag u8 ‖ id_len u16 BE ‖ id (UTF-8) ‖ data` – tag 1 = the notebook
//! doc (`id` = the local notebook id, envelope doc = [`DocId::NOTEBOOK`]), 2 = a page doc (`id` = its local doc id,
//! envelope doc = `SHA-256("rusuite-notes/page-doc/v1" ‖ notebook ‖ id)[..16]`), 3 = a blob (`id` = its SHA-256 hex,
//! envelope doc = `SHA-256("rusuite-notes/blob-id/v1" ‖ epoch-0 key ‖ id)[..16]`, a keyed id the relay cannot confirm
//! guesses with). Presence payloads are the engine's own bytes.

use std::collections::{BTreeMap, HashSet};

use notes_core::{blob_id, log_record, split_log};
use notes_sync::protocol::{self, ClientMsg, DocSeq, RelayMsg, StopSharing};
use notes_sync::{
    admit, create_share, join_request, key_wrap_recipient, remove_member, set_role, unwrap_keyring,
    DeviceId, DeviceKeys, DevicePublic, DocId, Envelope, Invite, JoinRequest, Keyring, Kind,
    MemberChain, NotebookId, OsRng, PendingInvites, Role,
};
use serde_json::{json, Value};

const BOOK_MAGIC: &[u8] = b"RNSB1";
const TAG_NOTEBOOK: u8 = 1;
const TAG_PAGE: u8 = 2;
const TAG_BLOB: u8 = 3;

pub type SyncResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn role_str(r: Role) -> &'static str {
    match r {
        Role::Owner => "owner",
        Role::CoOwner => "coOwner",
        Role::Edit => "edit",
        Role::Read => "read",
    }
}

pub fn parse_role(s: &str) -> SyncResult<Role> {
    Ok(match s {
        "owner" => Role::Owner,
        "coOwner" => Role::CoOwner,
        "edit" => Role::Edit,
        "read" => Role::Read,
        _ => return Err(format!("unknown role {s}")),
    })
}

fn kind_str(k: Kind) -> &'static str {
    match k {
        Kind::Update => "update",
        Kind::Snapshot => "snapshot",
        Kind::Blob => "blob",
        Kind::Presence => "presence",
        Kind::MemberList => "memberList",
        Kind::KeyWrap => "keyWrap",
        Kind::JoinRequest => "joinRequest",
    }
}

/// The first 16 bytes of `SHA-256(parts…)`.
fn hash16(parts: &[&[u8]]) -> DocId {
    let mut v = Vec::new();
    for p in parts {
        v.extend_from_slice(p);
    }
    let hex = blob_id(&v);
    DocId::from_hex(&hex[..32]).expect("hex of a SHA-256")
}

fn content(tag: u8, id: &str, data: &[u8]) -> SyncResult<Vec<u8>> {
    let len = u16::try_from(id.len()).map_err(|_| "id too long".to_string())?;
    let mut v = Vec::with_capacity(3 + id.len() + data.len());
    v.push(tag);
    v.extend_from_slice(&len.to_be_bytes());
    v.extend_from_slice(id.as_bytes());
    v.extend_from_slice(data);
    Ok(v)
}

fn parse_content(p: &[u8]) -> SyncResult<(u8, String, &[u8])> {
    let bad = || "malformed content payload".to_string();
    let tag = *p.first().ok_or_else(bad)?;
    let len =
        u16::from_be_bytes(p.get(1..3).ok_or_else(bad)?.try_into().map_err(|_| bad())?) as usize;
    let id = p.get(3..3 + len).ok_or_else(bad)?;
    let id = std::str::from_utf8(id).map_err(|_| bad())?.to_string();
    Ok((tag, id, &p[3 + len..]))
}

fn join_to_bytes(j: &JoinRequest) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(&j.device.signing);
    v.extend_from_slice(&j.device.agreement);
    v.push(match j.role {
        Role::Owner => 0,
        Role::CoOwner => 1,
        Role::Edit => 2,
        Role::Read => 3,
    });
    v.extend_from_slice(j.invite_id.as_bytes());
    v.extend_from_slice(j.display_name.as_bytes());
    v
}

fn join_from_bytes(b: &[u8]) -> SyncResult<JoinRequest> {
    if b.len() < 81 {
        return Err("malformed join".into());
    }
    let mut signing = [0u8; 32];
    signing.copy_from_slice(&b[..32]);
    let mut agreement = [0u8; 32];
    agreement.copy_from_slice(&b[32..64]);
    let role = match b[64] {
        1 => Role::CoOwner,
        2 => Role::Edit,
        3 => Role::Read,
        _ => return Err("malformed join role".into()),
    };
    let mut id = [0u8; 16];
    id.copy_from_slice(&b[65..81]);
    Ok(JoinRequest {
        device: DevicePublic { signing, agreement },
        display_name: String::from_utf8_lossy(&b[81..]).into_owned(),
        role,
        invite_id: DocId(id),
    })
}

fn join_json(j: &JoinRequest) -> Value {
    json!({
        "inviteId": j.invite_id.to_hex(),
        "device": j.device.device_id().to_hex(),
        "name": j.display_name,
        "role": role_str(j.role),
    })
}

/// One shared notebook as this device knows it.
#[derive(Default)]
struct Book {
    /// The notebook's id in the core / local storage (learnt from the first notebook-doc payload when joining).
    local_id: String,
    chain: Option<MemberChain>,
    member_envs: Vec<Envelope>,
    /// The latest member-list version this device signed and the relay has not accepted yet.
    proposed: Option<u64>,
    keyring: Option<Keyring>,
    invites: PendingInvites,
    /// Opened join requests waiting for Admit / Decline.
    joins: Vec<JoinRequest>,
    /// The invite this device is joining with (until it is a member).
    joining: Option<Invite>,
    requested: bool,
    challenge: Option<[u8; 32]>,
    /// Docs subscribed and not caught up yet: their deliveries are history (`authorize_historic`).
    catching_up: HashSet<DocId>,
}

impl Book {
    fn chain(&self) -> SyncResult<&MemberChain> {
        self.chain
            .as_ref()
            .ok_or_else(|| "not a member yet".to_string())
    }

    fn keyring(&self) -> SyncResult<&Keyring> {
        self.keyring
            .as_ref()
            .ok_or_else(|| "no notebook key yet".to_string())
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut v = log_record(BOOK_MAGIC);
        v.extend(log_record(self.local_id.as_bytes()));
        let ring = self
            .keyring
            .as_ref()
            .map(|k| k.to_bytes().to_vec())
            .unwrap_or_default();
        v.extend(log_record(&ring));
        v.extend(log_record(&self.invites.to_bytes()));
        let joining = self
            .joining
            .as_ref()
            .map(Invite::to_fragment)
            .unwrap_or_default();
        v.extend(log_record(joining.as_bytes()));
        v.extend(log_record(&[u8::from(self.requested)]));
        v.extend(log_record(&(self.joins.len() as u32).to_be_bytes()));
        for j in &self.joins {
            v.extend(log_record(&join_to_bytes(j)));
        }
        for e in &self.member_envs {
            v.extend(log_record(&e.encode()));
        }
        v
    }

    fn from_bytes(b: &[u8]) -> SyncResult<Book> {
        let (recs, _) = split_log(b);
        let bad = || "malformed sharing state".to_string();
        if recs.first().map(Vec::as_slice) != Some(BOOK_MAGIC) || recs.len() < 7 {
            return Err(bad());
        }
        let mut book = Book {
            local_id: String::from_utf8(recs[1].clone()).map_err(|_| bad())?,
            ..Book::default()
        };
        if !recs[2].is_empty() {
            book.keyring = Some(Keyring::from_bytes(&recs[2]).map_err(err)?);
        }
        book.invites = PendingInvites::from_bytes(&recs[3]).map_err(err)?;
        if !recs[4].is_empty() {
            let f = std::str::from_utf8(&recs[4]).map_err(|_| bad())?;
            book.joining = Some(Invite::from_fragment(f).map_err(err)?);
        }
        book.requested = recs[5].first() == Some(&1);
        let n = u32::from_be_bytes(recs[6].as_slice().try_into().map_err(|_| bad())?) as usize;
        let joins = recs.get(7..7 + n).ok_or_else(bad)?;
        book.joins = joins
            .iter()
            .map(|j| join_from_bytes(j))
            .collect::<Result<_, _>>()?;
        let envs = recs[7 + n..]
            .iter()
            .map(|e| Envelope::decode(e).map_err(err))
            .collect::<Result<Vec<_>, _>>()?;
        if !envs.is_empty() {
            book.chain = Some(MemberChain::from_envelopes(&envs).map_err(err)?);
        }
        book.member_envs = envs;
        Ok(book)
    }

    fn merge_keys(&mut self, ring: Keyring) {
        let mut mine = self.keyring.take().unwrap_or_default();
        for e in ring.epochs().collect::<Vec<_>>() {
            if mine.get(e).is_err() {
                if let Ok(k) = ring.get(e) {
                    mine.insert(k.clone());
                }
            }
        }
        self.keyring = Some(mine);
    }

    /// Every device's latest known display name (removed devices keep theirs from older lists).
    fn names(&self) -> BTreeMap<DeviceId, String> {
        let mut out = BTreeMap::new();
        let (Some(chain), Some(ring)) = (&self.chain, &self.keyring) else {
            return out;
        };
        for l in chain.lists() {
            for m in &l.members {
                if let Ok(n) = l.display_name(ring, &m.device_id) {
                    out.insert(m.device_id, n);
                }
            }
        }
        out
    }

    fn doc_id(&self, nb: &NotebookId, doc: &str) -> DocId {
        if doc == self.local_id {
            DocId::NOTEBOOK
        } else {
            hash16(&[b"rusuite-notes/page-doc/v1", &nb.0, doc.as_bytes()])
        }
    }

    fn blob_doc_id(&self, sha: &str) -> SyncResult<DocId> {
        let key0 = self.keyring()?.get(0).map_err(err)?;
        Ok(hash16(&[
            b"rusuite-notes/blob-id/v1",
            key0.expose_secret(),
            sha.as_bytes(),
        ]))
    }
}

/// The device's sharing state.
#[derive(Default)]
pub struct SyncClient {
    keys: Option<DeviceKeys>,
    books: BTreeMap<NotebookId, Book>,
    payload: Vec<u8>,
}

fn nb_id(hex: &str) -> SyncResult<NotebookId> {
    NotebookId::from_hex(hex).map_err(err)
}

impl SyncClient {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn keys(&self) -> SyncResult<&DeviceKeys> {
        self.keys
            .as_ref()
            .ok_or_else(|| "no device keys".to_string())
    }

    fn book(&self, nb: &NotebookId) -> SyncResult<&Book> {
        self.books
            .get(nb)
            .ok_or_else(|| format!("unknown shared notebook {nb}"))
    }

    fn book_mut(&mut self, nb: &NotebookId) -> SyncResult<&mut Book> {
        self.books
            .get_mut(nb)
            .ok_or_else(|| format!("unknown shared notebook {nb}"))
    }

    /// Bytes from the last event that carried a payload (decrypted update, blob or presence).
    pub fn take_payload(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.payload)
    }

    // ---- device -----------------------------------------------------------------------------------------------

    /// New device keys (replacing none: call only when nothing is stored) → their bytes to store.
    pub fn device_create(&mut self) -> Vec<u8> {
        let k = DeviceKeys::generate(&mut OsRng);
        let bytes = k.to_bytes().to_vec();
        self.keys = Some(k);
        bytes
    }

    /// Loads stored device keys → the device id (hex).
    pub fn device_load(&mut self, bytes: &[u8]) -> SyncResult<String> {
        let k = DeviceKeys::from_bytes(bytes).map_err(err)?;
        let id = k.device_id().to_hex();
        self.keys = Some(k);
        Ok(id)
    }

    pub fn device_id(&self) -> SyncResult<String> {
        Ok(self.keys()?.device_id().to_hex())
    }

    // ---- notebooks --------------------------------------------------------------------------------------------

    /// Restores a stored notebook (`book_save` bytes) → its status.
    pub fn book_load(&mut self, bytes: &[u8]) -> SyncResult<Value> {
        let book = Book::from_bytes(bytes)?;
        let nb = match (&book.chain, &book.joining) {
            (Some(c), _) => c.latest().notebook_id,
            (None, Some(i)) => i.notebook_id,
            _ => return Err("sharing state without a notebook".into()),
        };
        self.books.insert(nb, book);
        self.status(&nb.to_hex())
    }

    pub fn book_save(&self, nb: &str) -> SyncResult<Vec<u8>> {
        Ok(self.book(&nb_id(nb)?)?.to_bytes())
    }

    pub fn book_forget(&mut self, nb: &str) -> SyncResult<()> {
        self.books.remove(&nb_id(nb)?);
        Ok(())
    }

    pub fn set_local_id(&mut self, nb: &str, local_id: &str) -> SyncResult<()> {
        self.book_mut(&nb_id(nb)?)?.local_id = local_id.to_string();
        Ok(())
    }

    /// Turns sharing on for local notebook `local_id`: a new relay notebook with this device as its owner →
    /// `{notebook}` and the genesis member list (publish it first, no subscription needed).
    pub fn share_create(
        &mut self,
        local_id: &str,
        display_name: &str,
    ) -> SyncResult<(Value, Vec<u8>)> {
        let keys = self.keys()?;
        let nb = NotebookId::random(&mut OsRng);
        let (keyring, chain, env) = create_share(keys, nb, display_name, &mut OsRng);
        let book = Book {
            local_id: local_id.to_string(),
            chain: Some(chain),
            member_envs: vec![env.clone()],
            keyring: Some(keyring),
            ..Book::default()
        };
        self.books.insert(nb, book);
        Ok((json!({ "notebook": nb.to_hex() }), env.encode()))
    }

    /// Opens an invite link fragment (`#i=` value) → `{notebook, role, expiresAt}`. The engine then subscribes
    /// (`Pending`) and sends [`SyncClient::join_request`].
    pub fn join_start(&mut self, fragment: &str, now: u64) -> SyncResult<Value> {
        let invite = Invite::from_fragment(fragment).map_err(err)?;
        if invite.is_expired(now) {
            return Err("invite expired".into());
        }
        let nb = invite.notebook_id;
        let out = json!({ "notebook": nb.to_hex(), "role": role_str(invite.role), "expiresAt": invite.expires_at });
        let book = self.books.entry(nb).or_default();
        if book.chain.is_none() {
            book.joining = Some(invite);
        }
        Ok(out)
    }

    /// The `JoinRequest` envelope for the invite being joined.
    pub fn join_request(&mut self, nb: &str, name: &str, now: u64) -> SyncResult<Vec<u8>> {
        let nb = nb_id(nb)?;
        let keys = self.keys.as_ref().ok_or("no device keys")?;
        let book = self.books.get_mut(&nb).ok_or("unknown notebook")?;
        let invite = book.joining.as_ref().ok_or("not joining")?;
        let env = join_request(invite, keys, name, now, &mut OsRng).map_err(err)?;
        book.requested = true;
        Ok(env.encode())
    }

    /// The status of a notebook: membership, names, roles, open join requests.
    pub fn status(&self, nb: &str) -> SyncResult<Value> {
        let id = nb_id(nb)?;
        let book = self.book(&id)?;
        let me = self.keys.as_ref().map(DeviceKeys::device_id);
        let Some(chain) = &book.chain else {
            return Ok(json!({
                "notebook": nb, "localId": book.local_id, "member": false,
                "joining": book.joining.is_some(), "requested": book.requested,
                "inviteRole": book.joining.as_ref().map(|i| role_str(i.role)),
            }));
        };
        let latest = chain.latest();
        let names = book.names();
        let members: Vec<Value> = latest
            .members
            .iter()
            .map(|m| {
                json!({
                    "device": m.device_id.to_hex(),
                    "name": names.get(&m.device_id).cloned().unwrap_or_default(),
                    "role": role_str(m.role),
                    "me": Some(m.device_id) == me,
                })
            })
            .collect();
        let all_names: serde_json::Map<String, Value> = names
            .iter()
            .map(|(d, n)| (d.to_hex(), Value::String(n.clone())))
            .collect();
        let role = me.and_then(|d| latest.role_of(&d)).map(role_str);
        let removed = role.is_none() && me.is_some_and(|d| chain.was_member(&d));
        Ok(json!({
            "notebook": nb,
            "localId": book.local_id,
            "member": role.is_some(),
            "removed": removed,
            "role": role,
            "epoch": latest.epoch,
            "version": latest.version,
            "hasKey": book.keyring.as_ref().is_some_and(|k| k.get(latest.epoch).is_ok()),
            "members": members,
            "names": all_names,
            "joins": book.joins.iter().map(join_json).collect::<Vec<_>>(),
            "invites": book.invites.len(),
        }))
    }

    pub fn doc_id(&self, nb: &str, doc: &str) -> SyncResult<String> {
        let id = nb_id(nb)?;
        Ok(self.book(&id)?.doc_id(&id, doc).to_hex())
    }

    pub fn blob_doc_id(&self, nb: &str, sha: &str) -> SyncResult<String> {
        Ok(self.book(&nb_id(nb)?)?.blob_doc_id(sha)?.to_hex())
    }

    // ---- frames -----------------------------------------------------------------------------------------------

    /// `Subscribe` for the docs `[[doc hex, seq], …]` (needs the connection's challenge).
    pub fn subscribe_frame(&mut self, nb: &str, docs: &[(String, u64)]) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let keys = self.keys.as_ref().ok_or("no device keys")?;
        let book = self.books.get_mut(&id).ok_or("unknown notebook")?;
        let challenge = book.challenge.ok_or("no challenge")?;
        let mut list = Vec::with_capacity(docs.len());
        for (d, seq) in docs {
            let doc_id = DocId::from_hex(d).map_err(err)?;
            book.catching_up.insert(doc_id);
            list.push(DocSeq { doc_id, seq: *seq });
        }
        Ok(protocol::subscribe(keys, &challenge, id, list).encode())
    }

    pub fn publish_frame(tag: u32, envelope: &[u8]) -> SyncResult<Vec<u8>> {
        let envelope = Envelope::decode(envelope).map_err(err)?;
        Ok(ClientMsg::Publish { tag, envelope }.encode())
    }

    pub fn fetch_blob_frame(&self, nb: &str, sha: &str) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let blob_id = self.book(&id)?.blob_doc_id(sha)?;
        Ok(ClientMsg::FetchBlob {
            notebook_id: id,
            blob_id,
        }
        .encode())
    }

    pub fn stop_sharing_frame(&self, nb: &str, now: u64) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        Ok(ClientMsg::StopSharing(StopSharing::new(self.keys()?, id, now)).encode())
    }

    // ---- sealing ----------------------------------------------------------------------------------------------

    fn seal(
        &self,
        nb: &NotebookId,
        doc_id: DocId,
        kind: Kind,
        covers: u64,
        plain: &[u8],
    ) -> SyncResult<Vec<u8>> {
        let book = self.book(nb)?;
        let chain = book.chain()?;
        let key = book.keyring()?.get(chain.latest().epoch).map_err(err)?;
        let env = Envelope::seal(
            self.keys()?,
            key,
            *nb,
            doc_id,
            kind,
            covers,
            plain,
            &mut OsRng,
        )
        .map_err(err)?;
        Ok(env.encode())
    }

    /// An `Update` (covers 0) or `Snapshot` (covers > 0) envelope for local doc `doc` (the notebook doc or a page).
    pub fn seal_doc(&self, nb: &str, doc: &str, covers: u64, data: &[u8]) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let book = self.book(&id)?;
        let tag = if doc == book.local_id {
            TAG_NOTEBOOK
        } else {
            TAG_PAGE
        };
        let kind = if covers > 0 {
            Kind::Snapshot
        } else {
            Kind::Update
        };
        self.seal(
            &id,
            book.doc_id(&id, doc),
            kind,
            covers,
            &content(tag, doc, data)?,
        )
    }

    pub fn seal_blob(&self, nb: &str, sha: &str, data: &[u8]) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let doc_id = self.book(&id)?.blob_doc_id(sha)?;
        self.seal(&id, doc_id, Kind::Blob, 0, &content(TAG_BLOB, sha, data)?)
    }

    /// A notebook-wide presence envelope (every subscribed member gets it, nothing is stored).
    pub fn seal_presence(&self, nb: &str, data: &[u8]) -> SyncResult<Vec<u8>> {
        self.seal(&nb_id(nb)?, DocId::NOTEBOOK, Kind::Presence, 0, data)
    }

    /// Re-encrypts one of this device's queued envelopes with the current epoch key (after `StaleEpoch`).
    pub fn reencrypt(&self, nb: &str, envelope: &[u8]) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let book = self.book(&id)?;
        let ring = book.keyring()?;
        let key = ring.get(book.chain()?.latest().epoch).map_err(err)?;
        let env = Envelope::decode(envelope).map_err(err)?;
        Ok(env
            .reencrypt(ring, key, self.keys()?, &mut OsRng)
            .map_err(err)?
            .encode())
    }

    /// The epoch of an encoded envelope (the engine re-encrypts queued ones older than the current epoch).
    pub fn envelope_epoch(envelope: &[u8]) -> SyncResult<u32> {
        Ok(Envelope::decode(envelope).map_err(err)?.epoch)
    }

    // ---- membership -------------------------------------------------------------------------------------------

    /// A single-use invite link fragment for `role` → `{fragment, inviteId, expiresAt}`.
    pub fn invite_create(
        &mut self,
        nb: &str,
        role: &str,
        relay_hint: &str,
        now: u64,
    ) -> SyncResult<Value> {
        let id = nb_id(nb)?;
        let role = parse_role(role)?;
        let invite = Invite::create(id, role, relay_hint, now, &mut OsRng).map_err(err)?;
        let book = self.book_mut(&id)?;
        book.invites.prune(now);
        book.invites.add(&invite);
        Ok(
            json!({ "fragment": invite.to_fragment(), "inviteId": invite.invite_id().to_hex(), "expiresAt": invite.expires_at }),
        )
    }

    fn record_list(book: &mut Book, env: &Envelope) -> SyncResult<()> {
        let chain = book.chain.as_mut().ok_or("not a member")?;
        let version = chain.apply(env).map_err(err)?.version;
        book.member_envs.push(env.clone());
        book.proposed = Some(version);
        Ok(())
    }

    /// Admits the device of an open join request → framed envelopes (the member list, then the key wrap).
    pub fn admit(&mut self, nb: &str, invite_id: &str) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let keys = self.keys.as_ref().ok_or("no device keys")?;
        let book = self.books.get_mut(&id).ok_or("unknown notebook")?;
        let pos = book
            .joins
            .iter()
            .position(|j| j.invite_id.to_hex() == invite_id)
            .ok_or("no such join request")?;
        let join = book.joins[pos].clone();
        let (list, wrap) =
            admit(book.chain()?, keys, book.keyring()?, &join, &mut OsRng).map_err(err)?;
        Self::record_list(book, &list)?;
        book.joins.remove(pos);
        let mut out = log_record(&list.encode());
        out.extend(log_record(&wrap.encode()));
        Ok(out)
    }

    pub fn decline(&mut self, nb: &str, invite_id: &str) -> SyncResult<()> {
        self.book_mut(&nb_id(nb)?)?
            .joins
            .retain(|j| j.invite_id.to_hex() != invite_id);
        Ok(())
    }

    /// Removes a device (key rotation) → framed envelopes (the member list, then a wrap per remaining device).
    pub fn remove(&mut self, nb: &str, device: &str) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let device = DeviceId::from_hex(device).map_err(err)?;
        let keys = self.keys.as_ref().ok_or("no device keys")?;
        let book = self.books.get_mut(&id).ok_or("unknown notebook")?;
        let chain = book.chain.as_ref().ok_or("not a member")?;
        let ring = book.keyring.as_mut().ok_or("no key")?;
        let (list, wraps) = remove_member(chain, keys, ring, &device, &mut OsRng).map_err(err)?;
        Self::record_list(book, &list)?;
        let mut out = log_record(&list.encode());
        for w in wraps {
            out.extend(log_record(&w.encode()));
        }
        Ok(out)
    }

    pub fn set_role(&mut self, nb: &str, device: &str, role: &str) -> SyncResult<Vec<u8>> {
        let id = nb_id(nb)?;
        let device = DeviceId::from_hex(device).map_err(err)?;
        let role = parse_role(role)?;
        let keys = self.keys.as_ref().ok_or("no device keys")?;
        let book = self.books.get_mut(&id).ok_or("unknown notebook")?;
        let env = set_role(
            book.chain()?,
            keys,
            book.keyring()?,
            &device,
            role,
            &mut OsRng,
        )
        .map_err(err)?;
        Self::record_list(book, &env)?;
        Ok(env.encode())
    }

    // ---- relay messages ---------------------------------------------------------------------------------------

    /// Handles one relay frame of notebook `nb`'s connection → a JSON event (payload bytes via `take_payload`).
    pub fn handle(&mut self, nb: &str, frame: &[u8], now: u64) -> Value {
        match self.handle_inner(nb, frame, now) {
            Ok(v) => v,
            Err(e) => json!({ "type": "invalid", "reason": e }),
        }
    }

    fn handle_inner(&mut self, nb: &str, frame: &[u8], now: u64) -> SyncResult<Value> {
        let id = nb_id(nb)?;
        let msg = RelayMsg::decode(frame).map_err(err)?;
        let me = self.keys()?.device_id();
        let book = self.books.get_mut(&id).ok_or("unknown notebook")?;
        Ok(match msg {
            RelayMsg::Challenge { nonce, .. } => {
                book.challenge = Some(nonce);
                book.catching_up.clear();
                json!({ "type": "challenge" })
            }
            RelayMsg::Subscribed {
                notebook_id,
                member_lists,
                key_wraps,
                join_requests,
                docs,
            } => {
                if notebook_id != id {
                    return Err("subscribed for another notebook".into());
                }
                let chain = MemberChain::from_envelopes(&member_lists).map_err(err)?;
                if let Some(old) = &book.chain {
                    // No rollback: every list we hold must still be there (except our own unaccepted proposal).
                    for l in old.lists() {
                        if Some(l.version) == book.proposed {
                            continue;
                        }
                        if !chain.lists().iter().any(|n| n == l) {
                            return Err("the relay's member lists do not extend ours".into());
                        }
                    }
                }
                book.chain = Some(chain);
                book.member_envs = member_lists;
                book.proposed = None;
                book.joining = None;
                for w in &key_wraps {
                    let ring =
                        unwrap_keyring(w, self.keys.as_ref().expect("checked"), book.chain()?)
                            .map_err(err)?;
                    book.merge_keys(ring);
                }
                let mut joins = Vec::new();
                for j in &join_requests {
                    if let Some(v) = Self::open_join(book, j, now) {
                        joins.push(v);
                    }
                }
                let docs: Vec<Value> = docs
                    .iter()
                    .map(|d| json!([d.doc_id.to_hex(), d.seq]))
                    .collect();
                json!({ "type": "subscribed", "docs": docs, "newJoins": joins })
            }
            RelayMsg::Pending { .. } => json!({ "type": "pending", "requested": book.requested }),
            RelayMsg::Admitted { .. } => json!({ "type": "admitted" }),
            RelayMsg::Revoked { .. } => json!({ "type": "revoked" }),
            RelayMsg::Deleted { .. } => json!({ "type": "deleted" }),
            RelayMsg::Deliver { seq, envelope } => {
                let doc = envelope.doc_id;
                let historic = book.catching_up.contains(&doc);
                match Self::open_content(book, &envelope, historic) {
                    Ok((tag, local, data)) => {
                        self.payload = data;
                        json!({
                            "type": "deliver", "doc": doc.to_hex(), "seq": seq, "kind": kind_str(envelope.kind),
                            "target": match tag { TAG_NOTEBOOK => "notebook", TAG_PAGE => "page", _ => "blob" },
                            "id": local, "author": envelope.author.to_hex(),
                        })
                    }
                    Err(reason) => {
                        json!({ "type": "dropped", "doc": doc.to_hex(), "seq": seq, "reason": reason })
                    }
                }
            }
            RelayMsg::CaughtUp { doc_id, last, .. } => {
                book.catching_up.remove(&doc_id);
                json!({ "type": "caughtUp", "doc": doc_id.to_hex(), "last": last })
            }
            RelayMsg::Presence { envelope } => {
                let chain = book.chain()?;
                chain.authorize(&envelope).map_err(err)?;
                self.payload = envelope.open(book.keyring()?).map_err(err)?;
                json!({ "type": "presence", "author": envelope.author.to_hex() })
            }
            RelayMsg::MemberList { envelope } => {
                let chain = book.chain.as_mut().ok_or("not a member")?;
                let before = chain.latest().version;
                if chain.apply(&envelope).map_err(err)?.version > before {
                    book.member_envs.push(envelope);
                }
                json!({ "type": "members" })
            }
            RelayMsg::KeyWrap { envelope } => {
                if key_wrap_recipient(&envelope).map_err(err)? != me {
                    return Err("key wrap for another device".into());
                }
                let ring = unwrap_keyring(
                    &envelope,
                    self.keys.as_ref().expect("checked"),
                    book.chain()?,
                )
                .map_err(err)?;
                book.merge_keys(ring);
                json!({ "type": "keys", "epoch": envelope.epoch })
            }
            RelayMsg::JoinRequest { envelope } => match Self::open_join(book, &envelope, now) {
                Some(j) => json!({ "type": "joinRequest", "join": j }),
                None => json!({ "type": "ignored" }),
            },
            RelayMsg::Blob { envelope } => match Self::open_content(book, &envelope, true) {
                Ok((_, sha, data)) => {
                    if blob_id(&data) != sha {
                        return Ok(
                            json!({ "type": "dropped", "reason": "blob content does not match its id" }),
                        );
                    }
                    self.payload = data;
                    json!({ "type": "blob", "sha": sha })
                }
                Err(reason) => json!({ "type": "dropped", "reason": reason }),
            },
            RelayMsg::BlobMissing { blob_id, .. } => {
                json!({ "type": "blobMissing", "blob": blob_id.to_hex() })
            }
            RelayMsg::Accepted { tag, seq } => {
                if book.proposed.is_some_and(|v| v == seq) {
                    book.proposed = None;
                }
                json!({ "type": "accepted", "tag": tag, "seq": seq })
            }
            RelayMsg::Rejected { tag, code } => {
                json!({ "type": "rejected", "tag": tag, "code": format!("{code:?}") })
            }
            RelayMsg::Error { code, .. } => json!({ "type": "error", "code": format!("{code:?}") }),
        })
    }

    fn open_join(book: &mut Book, env: &Envelope, now: u64) -> Option<Value> {
        if book.joins.iter().any(|j| j.invite_id == env.doc_id) {
            return None;
        }
        let j = book.invites.open(env, now).ok()?;
        let v = join_json(&j);
        book.joins.push(j);
        Some(v)
    }

    /// Verifies (live or historic) and decrypts an update / snapshot / blob envelope → (tag, local id, data).
    fn open_content(
        book: &Book,
        env: &Envelope,
        historic: bool,
    ) -> Result<(u8, String, Vec<u8>), String> {
        let chain = book.chain()?;
        if !matches!(env.kind, Kind::Update | Kind::Snapshot | Kind::Blob) {
            return Err(format!("unexpected {}", kind_str(env.kind)));
        }
        let auth = if historic {
            chain.authorize_historic(env)
        } else {
            chain.authorize(env)
        };
        auth.map_err(err)?;
        let plain = env.open(book.keyring()?).map_err(err)?;
        let (tag, local, data) = parse_content(&plain)?;
        let expected = match tag {
            TAG_NOTEBOOK => DocId::NOTEBOOK,
            TAG_PAGE => book_doc(chain, &local),
            TAG_BLOB => book.blob_doc_id(&local)?,
            _ => return Err("unknown content tag".into()),
        };
        if expected != env.doc_id || (tag == TAG_BLOB) != (env.kind == Kind::Blob) {
            return Err("content does not match its envelope".into());
        }
        if tag == TAG_NOTEBOOK && !book.local_id.is_empty() && book.local_id != local {
            return Err("notebook doc of another local notebook".into());
        }
        Ok((tag, local, data.to_vec()))
    }
}

fn book_doc(chain: &MemberChain, local: &str) -> DocId {
    hash16(&[
        b"rusuite-notes/page-doc/v1",
        &chain.latest().notebook_id.0,
        local.as_bytes(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;

    fn challenge(c: &mut SyncClient, nb: &str) {
        let f = RelayMsg::Challenge {
            nonce: [7; 32],
            protocol: 1,
        }
        .encode();
        assert_eq!(c.handle(nb, &f, NOW)["type"], "challenge");
    }

    fn deliver(env: &[u8], seq: u64) -> Vec<u8> {
        RelayMsg::Deliver {
            seq,
            envelope: Envelope::decode(env).unwrap(),
        }
        .encode()
    }

    fn records(b: &[u8]) -> Vec<Vec<u8>> {
        split_log(b).0
    }

    /// Owner shares, invites, the invitee joins and is admitted; both exchange an update, a blob and presence.
    #[test]
    fn share_invite_admit_exchange_remove() {
        let mut owner = SyncClient::new();
        let owner_keys = owner.device_create();
        let (v, genesis) = owner.share_create("nb-local", "Anna").unwrap();
        let nb = v["notebook"].as_str().unwrap().to_string();
        let st = owner.status(&nb).unwrap();
        assert_eq!(st["role"], "owner");
        assert_eq!(st["members"][0]["name"], "Anna");

        let inv = owner.invite_create(&nb, "edit", "", NOW).unwrap();
        let mut ben = SyncClient::new();
        ben.device_create();
        let j = ben
            .join_start(inv["fragment"].as_str().unwrap(), NOW)
            .unwrap();
        assert_eq!(j["notebook"], nb.as_str());
        assert_eq!(ben.status(&nb).unwrap()["member"], false);
        let req = ben.join_request(&nb, "Ben", NOW).unwrap();

        // The owner gets the request live.
        let f = RelayMsg::JoinRequest {
            envelope: Envelope::decode(&req).unwrap(),
        }
        .encode();
        let ev = owner.handle(&nb, &f, NOW);
        assert_eq!(ev["type"], "joinRequest");
        assert_eq!(ev["join"]["name"], "Ben");
        // A second delivery of the same request is ignored.
        assert_eq!(owner.handle(&nb, &f, NOW)["type"], "ignored");
        let invite_id = ev["join"]["inviteId"].as_str().unwrap().to_string();
        let out = records(&owner.admit(&nb, &invite_id).unwrap());
        assert_eq!(out.len(), 2);

        // Ben subscribes again as a member: chain + his wrap.
        challenge(&mut ben, &nb);
        let doc_nb = DocId::NOTEBOOK.to_hex();
        ben.subscribe_frame(&nb, &[(doc_nb.clone(), 0)]).unwrap();
        let sub = RelayMsg::Subscribed {
            notebook_id: nb_id(&nb).unwrap(),
            member_lists: vec![
                Envelope::decode(&genesis).unwrap(),
                Envelope::decode(&out[0]).unwrap(),
            ],
            key_wraps: vec![Envelope::decode(&out[1]).unwrap()],
            join_requests: vec![],
            docs: vec![],
        }
        .encode();
        assert_eq!(ben.handle(&nb, &sub, NOW)["type"], "subscribed");
        let st = ben.status(&nb).unwrap();
        assert_eq!(st["role"], "edit");
        assert_eq!(st["hasKey"], true);
        assert_eq!(st["names"].as_object().unwrap().len(), 2);

        // The owner's notebook-doc update reaches Ben (catch-up) with the local id.
        let up = owner.seal_doc(&nb, "nb-local", 0, b"loro-bytes").unwrap();
        let ev = ben.handle(&nb, &deliver(&up, 1), NOW);
        assert_eq!(ev["type"], "deliver", "{ev}");
        assert_eq!(ev["target"], "notebook");
        assert_eq!(ev["id"], "nb-local");
        assert_eq!(ben.take_payload(), b"loro-bytes");
        ben.set_local_id(&nb, "nb-local").unwrap();
        let caught = RelayMsg::CaughtUp {
            notebook_id: nb_id(&nb).unwrap(),
            doc_id: DocId::NOTEBOOK,
            last: 1,
        }
        .encode();
        assert_eq!(ben.handle(&nb, &caught, NOW)["type"], "caughtUp");

        // Ben's page update reaches the owner live.
        let page = ben.seal_doc(&nb, "pg-1", 0, b"page").unwrap();
        assert_eq!(
            owner.doc_id(&nb, "pg-1").unwrap(),
            ben.doc_id(&nb, "pg-1").unwrap()
        );
        let ev = owner.handle(&nb, &deliver(&page, 1), NOW);
        assert_eq!(ev["target"], "page");
        assert_eq!(owner.take_payload(), b"page");

        // Blobs: keyed id, checked content.
        let sha = blob_id(b"img");
        assert_eq!(
            owner.blob_doc_id(&nb, &sha).unwrap(),
            ben.blob_doc_id(&nb, &sha).unwrap()
        );
        let blob = owner.seal_blob(&nb, &sha, b"img").unwrap();
        let f = RelayMsg::Blob {
            envelope: Envelope::decode(&blob).unwrap(),
        }
        .encode();
        assert_eq!(ben.handle(&nb, &f, NOW)["sha"], sha.as_str());
        assert_eq!(ben.take_payload(), b"img");

        // Presence.
        let p = ben.seal_presence(&nb, b"{\"page\":1}").unwrap();
        let f = RelayMsg::Presence {
            envelope: Envelope::decode(&p).unwrap(),
        }
        .encode();
        assert_eq!(owner.handle(&nb, &f, NOW)["type"], "presence");
        assert_eq!(owner.take_payload(), b"{\"page\":1}");

        // Save / load keeps everything.
        let saved = owner.book_save(&nb).unwrap();
        let mut again = SyncClient::new();
        again.device_load(&owner_keys).unwrap();
        assert_eq!(again.book_load(&saved).unwrap()["role"], "owner");
        assert_eq!(
            again.status(&nb).unwrap()["members"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        // Promote, then remove Ben: new epoch; Ben's next update is refused by the owner.
        let ben_dev = ben.device_id().unwrap();
        owner.set_role(&nb, &ben_dev, "coOwner").unwrap();
        let rm = records(&owner.remove(&nb, &ben_dev).unwrap());
        assert_eq!(rm.len(), 1, "no other device to wrap for");
        assert_eq!(owner.status(&nb).unwrap()["epoch"], 1);
        let late = ben.seal_doc(&nb, "pg-1", 0, b"late").unwrap();
        let ev = owner.handle(&nb, &deliver(&late, 2), NOW);
        assert_eq!(ev["type"], "dropped", "{ev}");
    }

    #[test]
    fn read_only_member_updates_are_refused_and_tampering_detected() {
        let mut owner = SyncClient::new();
        owner.device_create();
        let (v, genesis) = owner.share_create("nb", "Anna").unwrap();
        let nb = v["notebook"].as_str().unwrap().to_string();
        let inv = owner.invite_create(&nb, "read", "", NOW).unwrap();
        let mut rita = SyncClient::new();
        rita.device_create();
        rita.join_start(inv["fragment"].as_str().unwrap(), NOW)
            .unwrap();
        let req = rita.join_request(&nb, "Rita", NOW).unwrap();
        let f = RelayMsg::JoinRequest {
            envelope: Envelope::decode(&req).unwrap(),
        }
        .encode();
        let id = owner.handle(&nb, &f, NOW)["join"]["inviteId"]
            .as_str()
            .unwrap()
            .to_string();
        let out = records(&owner.admit(&nb, &id).unwrap());
        challenge(&mut rita, &nb);
        let sub = RelayMsg::Subscribed {
            notebook_id: nb_id(&nb).unwrap(),
            member_lists: vec![
                Envelope::decode(&genesis).unwrap(),
                Envelope::decode(&out[0]).unwrap(),
            ],
            key_wraps: vec![Envelope::decode(&out[1]).unwrap()],
            join_requests: vec![],
            docs: vec![],
        }
        .encode();
        rita.handle(&nb, &sub, NOW);
        assert_eq!(rita.status(&nb).unwrap()["role"], "read");
        let forged = rita.seal_doc(&nb, "pg", 0, b"x").unwrap();
        assert_eq!(
            owner.handle(&nb, &deliver(&forged, 1), NOW)["type"],
            "dropped"
        );

        // A flipped ciphertext byte fails.
        let mut up = owner.seal_doc(&nb, "pg", 0, b"hello").unwrap();
        let n = up.len();
        up[n - 70] ^= 1;
        assert_eq!(rita.handle(&nb, &deliver(&up, 1), NOW)["type"], "dropped");
        // A rolled back member list (relay hides the admission) is refused.
        challenge(&mut rita, &nb);
        let rollback = RelayMsg::Subscribed {
            notebook_id: nb_id(&nb).unwrap(),
            member_lists: vec![Envelope::decode(&genesis).unwrap()],
            key_wraps: vec![],
            join_requests: vec![],
            docs: vec![],
        }
        .encode();
        assert_eq!(rita.handle(&nb, &rollback, NOW)["type"], "invalid");
    }

    #[test]
    fn reencrypt_after_rotation() {
        let mut owner = SyncClient::new();
        owner.device_create();
        let (v, _) = owner.share_create("nb", "Anna").unwrap();
        let nb = v["notebook"].as_str().unwrap().to_string();
        let old = owner.seal_doc(&nb, "pg", 0, b"offline").unwrap();
        assert_eq!(SyncClient::envelope_epoch(&old).unwrap(), 0);
        // A second device to remove so the epoch rotates.
        let inv = owner.invite_create(&nb, "edit", "", NOW).unwrap();
        let mut x = SyncClient::new();
        x.device_create();
        x.join_start(inv["fragment"].as_str().unwrap(), NOW)
            .unwrap();
        let req = x.join_request(&nb, "X", NOW).unwrap();
        let f = RelayMsg::JoinRequest {
            envelope: Envelope::decode(&req).unwrap(),
        }
        .encode();
        let id = owner.handle(&nb, &f, NOW)["join"]["inviteId"]
            .as_str()
            .unwrap()
            .to_string();
        owner.admit(&nb, &id).unwrap();
        owner.remove(&nb, &x.device_id().unwrap()).unwrap();
        let new = owner.reencrypt(&nb, &old).unwrap();
        assert_eq!(SyncClient::envelope_epoch(&new).unwrap(), 1);
        assert!(SyncClient::publish_frame(3, &new).is_ok());
        assert!(owner.stop_sharing_frame(&nb, NOW).is_ok());
    }
}
