//! Invites and join requests ("share", including "share with myself" for one's own devices).
//!
//! The invite travels only in a link fragment (`https://rusuit.es/notes/#i=<Invite::to_fragment>`), never sent to the
//! server: `{notebook_id, invite_secret, role, relay_hint, expires_at}`. From the secret (HKDF) come
//! - the *invite id* (16 bytes; the join request's `doc_id`, so the relay can keep a single request per invite without
//!   learning the secret), and
//! - the *seal key* that encrypts the invitee's agreement key and display name inside the join request.
//!
//! The join request is signed by the invitee's new device key (the relay checks the signature against the signing key
//! carried in clear and refuses a second request for the same invite id). Only a device holding the secret – the
//! owner/co-owner who created the invite, via [`PendingInvites`] – can open it. Invites are single-use and expire after
//! [`INVITE_TTL_SECS`]; the role is taken from the owner's own record, never from the request.

use rand_core::CryptoRngCore;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::bytes::{b64url, decode_exact, encode, unb64url};
use crate::crypto;
use crate::envelope::{Envelope, Kind};
use crate::error::SyncError;
use crate::ids::{DocId, NotebookId};
use crate::keys::{DeviceKeys, DevicePublic};
use crate::members::Role;

/// Invites expire after 7 days.
pub const INVITE_TTL_SECS: u64 = 7 * 24 * 3600;
const INVITE_VERSION: u8 = 1;
const MAX_RELAY_HINT: usize = 256;
const MAX_JOIN_NAME: usize = 256;

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct InviteWire {
    v: u8,
    #[zeroize(skip)]
    notebook_id: NotebookId,
    secret: [u8; 32],
    #[zeroize(skip)]
    role: Role,
    relay_hint: String,
    expires_at: u64,
}

/// An invitation (holds the secret: keep it only in the link and in the creator's [`PendingInvites`]).
#[derive(Clone)]
pub struct Invite {
    pub notebook_id: NotebookId,
    secret: Zeroizing<[u8; 32]>,
    /// The intended role (shown to the invitee; the admitting device uses its own record).
    pub role: Role,
    /// Relay origin for self-hosted relays; empty = the site's own `/api/notes/ws`.
    pub relay_hint: String,
    /// Unix seconds.
    pub expires_at: u64,
}

impl std::fmt::Debug for Invite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Invite")
            .field("notebook_id", &self.notebook_id)
            .field("secret", &"<redacted>")
            .field("role", &self.role)
            .field("relay_hint", &self.relay_hint)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

fn invite_id_of(secret: &[u8; 32]) -> DocId {
    let k = crypto::derive(b"rusuite-notes/invite/v1", secret, &[b"invite-id"]);
    DocId(k[..16].try_into().expect("16 bytes"))
}

fn seal_key_of(secret: &[u8; 32], nb: &NotebookId) -> Zeroizing<[u8; 32]> {
    crypto::derive(b"rusuite-notes/invite/v1", secret, &[b"join-seal", &nb.0])
}

impl Invite {
    /// A new single-use invite for `role` (not `Owner`), valid for 7 days from `now`.
    pub fn create(
        notebook_id: NotebookId,
        role: Role,
        relay_hint: &str,
        now: u64,
        rng: &mut impl CryptoRngCore,
    ) -> Result<Invite, SyncError> {
        if role == Role::Owner {
            return Err(SyncError::BadInvite(
                "an invite cannot grant the owner role",
            ));
        }
        if relay_hint.len() > MAX_RELAY_HINT {
            return Err(SyncError::BadInvite("relay hint too long"));
        }
        Ok(Invite {
            notebook_id,
            secret: crypto::random_key(rng),
            role,
            relay_hint: relay_hint.to_owned(),
            expires_at: now.saturating_add(INVITE_TTL_SECS),
        })
    }

    /// The link fragment value (unpadded base64url).
    pub fn to_fragment(&self) -> String {
        let w = InviteWire {
            v: INVITE_VERSION,
            notebook_id: self.notebook_id,
            secret: *self.secret,
            role: self.role,
            relay_hint: self.relay_hint.clone(),
            expires_at: self.expires_at,
        };
        let bytes = Zeroizing::new(encode(&w));
        b64url(&bytes)
    }

    pub fn from_fragment(s: &str) -> Result<Invite, SyncError> {
        let bytes =
            Zeroizing::new(unb64url(s.trim()).ok_or(SyncError::BadInvite("not base64url"))?);
        let w: InviteWire = decode_exact(&bytes, "invite")?;
        if w.v != INVITE_VERSION {
            return Err(SyncError::BadInvite("unknown version"));
        }
        if w.role == Role::Owner || w.relay_hint.len() > MAX_RELAY_HINT {
            return Err(SyncError::BadInvite("invalid fields"));
        }
        Ok(Invite {
            notebook_id: w.notebook_id,
            secret: Zeroizing::new(w.secret),
            role: w.role,
            relay_hint: w.relay_hint.clone(),
            expires_at: w.expires_at,
        })
    }

    pub fn invite_id(&self) -> DocId {
        invite_id_of(&self.secret)
    }

    pub fn is_expired(&self, now: u64) -> bool {
        now >= self.expires_at
    }
}

#[derive(Serialize, Deserialize)]
struct JoinPayload {
    signing_pub: [u8; 32],
    sealed: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct JoinSealed {
    agreement_pub: [u8; 32],
    display_name: String,
}

fn join_aad(env: &Envelope, signing_pub: &[u8; 32]) -> Vec<u8> {
    let mut v = env.aad();
    v.extend_from_slice(signing_pub);
    v
}

/// The invitee's side: a `JoinRequest` envelope for `invite`, signed by `me`.
pub fn join_request(
    invite: &Invite,
    me: &DeviceKeys,
    display_name: &str,
    now: u64,
    rng: &mut impl CryptoRngCore,
) -> Result<Envelope, SyncError> {
    if invite.is_expired(now) {
        return Err(SyncError::InviteExpired);
    }
    let mut end = display_name.len().min(MAX_JOIN_NAME);
    while !display_name.is_char_boundary(end) {
        end -= 1;
    }
    let signing_pub = me.signing_public();
    let mut env = Envelope {
        notebook_id: invite.notebook_id,
        doc_id: invite.invite_id(),
        epoch: 0,
        kind: Kind::JoinRequest,
        author: me.device_id(),
        covers: 0,
        nonce: crypto::random_nonce(rng),
        payload: Vec::new(),
        signature: [0; 64],
    };
    let inner = Zeroizing::new(encode(&JoinSealed {
        agreement_pub: me.public().agreement,
        display_name: display_name[..end].to_owned(),
    }));
    let sealed = crypto::seal(
        &seal_key_of(&invite.secret, &invite.notebook_id),
        &env.nonce,
        &join_aad(&env, &signing_pub),
        &inner,
    );
    env.payload = encode(&JoinPayload {
        signing_pub,
        sealed,
    });
    env.signature = me.sign(&env.signed_bytes());
    Ok(env)
}

/// The relay's check: a well-formed join request signed by the key it carries. Returns that signing key.
pub fn join_request_signer(env: &Envelope) -> Result<[u8; 32], SyncError> {
    if env.kind != Kind::JoinRequest {
        return Err(SyncError::WrongKind(env.kind));
    }
    if env.epoch != 0 || env.doc_id == DocId::NOTEBOOK {
        return Err(SyncError::Malformed("join request header"));
    }
    let p: JoinPayload = decode_exact(&env.payload, "join request")?;
    env.verify(&p.signing_pub)?;
    Ok(p.signing_pub)
}

/// An opened join request: who asked, under which invite, and the role the owner's record grants.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JoinRequest {
    pub device: DevicePublic,
    pub display_name: String,
    pub role: Role,
    pub invite_id: DocId,
}

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct PendingEntry {
    #[zeroize(skip)]
    invite_id: DocId,
    #[zeroize(skip)]
    notebook_id: NotebookId,
    secret: [u8; 32],
    #[zeroize(skip)]
    role: Role,
    expires_at: u64,
    used: bool,
}

/// The invites a device created and has not yet consumed (persist locally with [`PendingInvites::to_bytes`]).
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct PendingInvites {
    entries: Vec<PendingEntry>,
}

impl std::fmt::Debug for PendingInvites {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PendingInvites({} entries)", self.entries.len())
    }
}

impl PendingInvites {
    pub fn add(&mut self, invite: &Invite) {
        self.entries.push(PendingEntry {
            invite_id: invite.invite_id(),
            notebook_id: invite.notebook_id,
            secret: *invite.secret,
            role: invite.role,
            expires_at: invite.expires_at,
            used: false,
        });
    }

    /// Opens a join request for one of our invites and marks the invite used (only after the request decrypted, so a
    /// forged request cannot burn it).
    pub fn open(&mut self, env: &Envelope, now: u64) -> Result<JoinRequest, SyncError> {
        let signing_pub = join_request_signer(env)?;
        let entry = self
            .entries
            .iter_mut()
            .find(|e| e.invite_id == env.doc_id && e.notebook_id == env.notebook_id)
            .ok_or(SyncError::UnknownInvite)?;
        if entry.used {
            return Err(SyncError::InviteUsed);
        }
        if now >= entry.expires_at {
            return Err(SyncError::InviteExpired);
        }
        let p: JoinPayload = decode_exact(&env.payload, "join request")?;
        let inner = Zeroizing::new(crypto::open(
            &seal_key_of(&entry.secret, &entry.notebook_id),
            &env.nonce,
            &join_aad(env, &signing_pub),
            &p.sealed,
        )?);
        let s: JoinSealed = decode_exact(&inner, "join request body")?;
        entry.used = true;
        Ok(JoinRequest {
            device: DevicePublic {
                signing: signing_pub,
                agreement: s.agreement_pub,
            },
            display_name: s.display_name.clone(),
            role: entry.role,
            invite_id: entry.invite_id,
        })
    }

    /// Drops expired and used invites.
    pub fn prune(&mut self, now: u64) {
        self.entries.retain(|e| !e.used && now < e.expires_at);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(encode(self))
    }

    pub fn from_bytes(b: &[u8]) -> Result<PendingInvites, SyncError> {
        decode_exact(b, "pending invites")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;

    const NOW: u64 = 1_800_000_000;

    fn setup(role: Role) -> (Invite, PendingInvites, DeviceKeys) {
        let inv =
            Invite::create(NotebookId::random(&mut OsRng), role, "", NOW, &mut OsRng).unwrap();
        let mut p = PendingInvites::default();
        p.add(&inv);
        (inv, p, DeviceKeys::generate(&mut OsRng))
    }

    #[test]
    fn fragment_roundtrip_and_redaction() {
        let inv = Invite::create(
            NotebookId::random(&mut OsRng),
            Role::Edit,
            "https://notes.example",
            NOW,
            &mut OsRng,
        )
        .unwrap();
        let s = inv.to_fragment();
        assert!(s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        let back = Invite::from_fragment(&s).unwrap();
        assert_eq!(back.notebook_id, inv.notebook_id);
        assert_eq!(back.role, Role::Edit);
        assert_eq!(back.relay_hint, "https://notes.example");
        assert_eq!(back.expires_at, NOW + INVITE_TTL_SECS);
        assert_eq!(back.invite_id(), inv.invite_id());
        assert!(format!("{inv:?}").contains("<redacted>"));
        assert!(Invite::from_fragment("not*base64").is_err());
        assert!(Invite::from_fragment(&s[..s.len() - 2]).is_err());
    }

    #[test]
    fn invites_cannot_grant_owner() {
        assert!(Invite::create(NotebookId([1; 16]), Role::Owner, "", NOW, &mut OsRng).is_err());
        let long = "x".repeat(300);
        assert!(Invite::create(NotebookId([1; 16]), Role::Edit, &long, NOW, &mut OsRng).is_err());
    }

    #[test]
    fn join_roundtrip_single_use() {
        let (inv, mut p, dev) = setup(Role::Read);
        let env = join_request(&inv, &dev, "Ben", NOW + 10, &mut OsRng).unwrap();
        assert_eq!(join_request_signer(&env).unwrap(), dev.signing_public());
        assert!(
            !env.payload.windows(3).any(|w| w == b"Ben"),
            "the relay cannot read the name"
        );
        let j = p.open(&env, NOW + 20).unwrap();
        assert_eq!(j.device, dev.public());
        assert_eq!(j.display_name, "Ben");
        assert_eq!(j.role, Role::Read);
        assert_eq!(p.open(&env, NOW + 21), Err(SyncError::InviteUsed));
        // A second device using the same link is refused as well.
        let dev2 = DeviceKeys::generate(&mut OsRng);
        let env2 = join_request(&inv, &dev2, "Eve", NOW + 30, &mut OsRng).unwrap();
        assert_eq!(p.open(&env2, NOW + 31), Err(SyncError::InviteUsed));
        p.prune(NOW + 40);
        assert!(p.is_empty());
    }

    #[test]
    fn expiry() {
        let (inv, mut p, dev) = setup(Role::Edit);
        assert_eq!(
            join_request(&inv, &dev, "Ben", NOW + INVITE_TTL_SECS, &mut OsRng),
            Err(SyncError::InviteExpired)
        );
        let env = join_request(&inv, &dev, "Ben", NOW + 5, &mut OsRng).unwrap();
        assert_eq!(
            p.open(&env, NOW + INVITE_TTL_SECS),
            Err(SyncError::InviteExpired)
        );
    }

    #[test]
    fn forged_requests_are_refused_and_do_not_burn_the_invite() {
        let (inv, mut p, dev) = setup(Role::Edit);
        // Someone without the secret: guesses the invite id is impossible; with the id but a wrong key → no decrypt.
        let wrong = Invite::create(inv.notebook_id, Role::Edit, "", NOW, &mut OsRng).unwrap();
        let mut forged = join_request(&wrong, &dev, "Mallory", NOW, &mut OsRng).unwrap();
        assert_eq!(p.open(&forged, NOW), Err(SyncError::UnknownInvite));
        forged.doc_id = inv.invite_id();
        forged.signature = dev.sign(&forged.signed_bytes());
        assert_eq!(p.open(&forged, NOW), Err(SyncError::Decrypt));
        // Tampered payload or signature.
        let good = join_request(&inv, &dev, "Ben", NOW, &mut OsRng).unwrap();
        let mut t = good.clone();
        let n = t.payload.len();
        t.payload[n - 1] ^= 1;
        assert_eq!(p.open(&t, NOW), Err(SyncError::BadSignature));
        let mut s = good.clone();
        s.signature[1] ^= 1;
        assert_eq!(join_request_signer(&s), Err(SyncError::BadSignature));
        // Swapping in another signing key (re-signed) breaks the sealed AAD.
        let other = DeviceKeys::generate(&mut OsRng);
        let mut body: JoinPayload = decode_exact(&good.payload, "j").unwrap();
        body.signing_pub = other.signing_public();
        let mut sw = good.clone();
        sw.payload = encode(&body);
        sw.author = other.device_id();
        sw.signature = other.sign(&sw.signed_bytes());
        assert_eq!(p.open(&sw, NOW), Err(SyncError::Decrypt));
        // The real one still works.
        assert!(p.open(&good, NOW).is_ok());
    }

    #[test]
    fn wrong_kind_and_header() {
        let (inv, _, dev) = setup(Role::Edit);
        let mut env = join_request(&inv, &dev, "Ben", NOW, &mut OsRng).unwrap();
        env.epoch = 1;
        assert!(join_request_signer(&env).is_err());
        env.epoch = 0;
        env.kind = Kind::Update;
        assert_eq!(
            join_request_signer(&env),
            Err(SyncError::WrongKind(Kind::Update))
        );
    }

    #[test]
    fn pending_persistence() {
        let (inv, p, dev) = setup(Role::Edit);
        let mut back = PendingInvites::from_bytes(&p.to_bytes()).unwrap();
        assert_eq!(back.len(), 1);
        let env = join_request(&inv, &dev, "Ben", NOW, &mut OsRng).unwrap();
        assert!(back.open(&env, NOW).is_ok());
    }
}
