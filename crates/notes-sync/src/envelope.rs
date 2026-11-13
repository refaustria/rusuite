//! The envelope: one signed (and, for content, encrypted) unit per Loro update, snapshot, blob, presence message,
//! member list, key wrap or join request.
//!
//! Wire layout (all integers big-endian), 170 bytes + payload:
//! `version=1 (1) ‖ notebook_id (16) ‖ doc_id (16) ‖ epoch (4) ‖ kind (1) ‖ author (32) ‖ covers (8) ‖ nonce (24) ‖
//! payload_len (4) ‖ payload ‖ signature (64)`.
//!
//! The Ed25519 signature covers `"rusuite-notes/envelope/v1" ‖` every preceding byte. For content kinds the payload is
//! `XChaCha20-Poly1305(content key of epoch, nonce, plaintext, AAD)` with
//! `AAD = "rusuite-notes/aad/v1" ‖ notebook_id ‖ doc_id ‖ epoch ‖ kind ‖ author ‖ covers`, so moving a ciphertext to
//! another notebook, doc, epoch, kind or author fails to decrypt even before the signature is checked.

use rand_core::CryptoRngCore;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::crypto::{self, NONCE_LEN};
use crate::error::SyncError;
use crate::ids::{DeviceId, DocId, NotebookId};
use crate::keys::{self, DeviceKeys, Keyring, NotebookKey};

pub const ENVELOPE_VERSION: u8 = 1;
/// Bytes before the payload (incl. its length).
pub const HEADER_LEN: usize = 1 + 16 + 16 + 4 + 1 + 32 + 8 + NONCE_LEN + 4;
/// Fixed bytes of every envelope (header + signature).
pub const OVERHEAD: usize = HEADER_LEN + 64;
const SIG_DOMAIN: &[u8] = b"rusuite-notes/envelope/v1";
const AAD_DOMAIN: &[u8] = b"rusuite-notes/aad/v1";
const CONTENT_LABEL: &[u8] = b"content";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[repr(u8)]
pub enum Kind {
    /// A Loro update (durable, appended to the doc's log).
    Update = 1,
    /// A compacted Loro snapshot covering the doc's log up to `covers`.
    Snapshot = 2,
    /// An attachment; `doc_id` is the blob id.
    Blob = 3,
    /// Ephemeral cursor/selection/page/colour; never stored by the relay.
    Presence = 4,
    /// A member-list version (payload: the list, display names encrypted).
    MemberList = 5,
    /// The keyring wrapped for one member device.
    KeyWrap = 6,
    /// An invitee's public keys and name, sealed with the invite secret.
    JoinRequest = 7,
}

impl Kind {
    pub fn from_u8(b: u8) -> Option<Kind> {
        Some(match b {
            1 => Kind::Update,
            2 => Kind::Snapshot,
            3 => Kind::Blob,
            4 => Kind::Presence,
            5 => Kind::MemberList,
            6 => Kind::KeyWrap,
            7 => Kind::JoinRequest,
            _ => return None,
        })
    }

    /// Encrypted with the notebook's content key.
    pub fn is_content(self) -> bool {
        matches!(
            self,
            Kind::Update | Kind::Snapshot | Kind::Blob | Kind::Presence
        )
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Envelope {
    pub notebook_id: NotebookId,
    pub doc_id: DocId,
    pub epoch: u32,
    pub kind: Kind,
    pub author: DeviceId,
    /// Snapshots: the doc's relay sequence number the snapshot includes (the relay may drop log entries ≤ it).
    /// 0 for every other kind.
    pub covers: u64,
    pub nonce: [u8; NONCE_LEN],
    /// The ciphertext (content kinds, join requests) or the structured body (member list, key wrap).
    pub payload: Vec<u8>,
    pub signature: [u8; 64],
}

impl Envelope {
    fn header(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(HEADER_LEN + self.payload.len());
        v.push(ENVELOPE_VERSION);
        v.extend_from_slice(&self.notebook_id.0);
        v.extend_from_slice(&self.doc_id.0);
        v.extend_from_slice(&self.epoch.to_be_bytes());
        v.push(self.kind as u8);
        v.extend_from_slice(&self.author.0);
        v.extend_from_slice(&self.covers.to_be_bytes());
        v.extend_from_slice(&self.nonce);
        v.extend_from_slice(&(self.payload.len() as u32).to_be_bytes());
        v
    }

    /// What the signature covers.
    pub fn signed_bytes(&self) -> Vec<u8> {
        let mut v = SIG_DOMAIN.to_vec();
        v.extend_from_slice(&self.header());
        v.extend_from_slice(&self.payload);
        v
    }

    /// The associated data of content encryption.
    pub fn aad(&self) -> Vec<u8> {
        let mut v = AAD_DOMAIN.to_vec();
        v.extend_from_slice(&self.notebook_id.0);
        v.extend_from_slice(&self.doc_id.0);
        v.extend_from_slice(&self.epoch.to_be_bytes());
        v.push(self.kind as u8);
        v.extend_from_slice(&self.author.0);
        v.extend_from_slice(&self.covers.to_be_bytes());
        v
    }

    /// Bytes on the wire.
    pub fn encoded_len(&self) -> usize {
        OVERHEAD + self.payload.len()
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut v = self.header();
        v.extend_from_slice(&self.payload);
        v.extend_from_slice(&self.signature);
        v
    }

    pub fn decode(b: &[u8]) -> Result<Envelope, SyncError> {
        let bad = SyncError::Malformed("envelope");
        if b.len() < OVERHEAD || b[0] != ENVELOPE_VERSION {
            return Err(bad);
        }
        let payload_len =
            u32::from_be_bytes(b[HEADER_LEN - 4..HEADER_LEN].try_into().expect("4")) as usize;
        if b.len() != OVERHEAD + payload_len {
            return Err(bad);
        }
        let mut at = 1;
        let mut take = |n: usize| {
            let s = &b[at..at + n];
            at += n;
            s
        };
        let notebook_id = NotebookId::from_slice(take(16))?;
        let doc_id = DocId::from_slice(take(16))?;
        let epoch = u32::from_be_bytes(take(4).try_into().expect("4"));
        let kind = Kind::from_u8(take(1)[0]).ok_or(SyncError::Malformed("envelope kind"))?;
        let author = DeviceId::from_slice(take(32))?;
        let covers = u64::from_be_bytes(take(8).try_into().expect("8"));
        let nonce: [u8; NONCE_LEN] = take(NONCE_LEN).try_into().expect("24");
        take(4);
        let payload = take(payload_len).to_vec();
        let signature: [u8; 64] = take(64).try_into().expect("64");
        if kind != Kind::Snapshot && covers != 0 {
            return Err(SyncError::Malformed("covers on a non-snapshot envelope"));
        }
        Ok(Envelope {
            notebook_id,
            doc_id,
            epoch,
            kind,
            author,
            covers,
            nonce,
            payload,
            signature,
        })
    }

    /// Builds and signs an envelope (`author` = the signing device).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new_signed(
        keys: &DeviceKeys,
        notebook_id: NotebookId,
        doc_id: DocId,
        epoch: u32,
        kind: Kind,
        covers: u64,
        nonce: [u8; NONCE_LEN],
        payload: Vec<u8>,
    ) -> Envelope {
        let mut e = Envelope {
            notebook_id,
            doc_id,
            epoch,
            kind,
            author: keys.device_id(),
            covers,
            nonce,
            payload,
            signature: [0; 64],
        };
        e.signature = keys.sign(&e.signed_bytes());
        e
    }

    /// Checks that `signing_pub` belongs to the author and signed exactly these bytes.
    pub fn verify(&self, signing_pub: &[u8; 32]) -> Result<(), SyncError> {
        if keys::device_id_of(signing_pub) != self.author {
            return Err(SyncError::BadSignature);
        }
        keys::verify(signing_pub, &self.signed_bytes(), &self.signature)
    }

    /// Encrypts `plaintext` with `key` (its epoch) and signs: Update, Snapshot (with `covers`), Blob, Presence.
    #[allow(clippy::too_many_arguments)]
    pub fn seal(
        keys: &DeviceKeys,
        key: &NotebookKey,
        notebook_id: NotebookId,
        doc_id: DocId,
        kind: Kind,
        covers: u64,
        plaintext: &[u8],
        rng: &mut impl CryptoRngCore,
    ) -> Result<Envelope, SyncError> {
        if !kind.is_content() {
            return Err(SyncError::WrongKind(kind));
        }
        if kind != Kind::Snapshot && covers != 0 {
            return Err(SyncError::Malformed("covers on a non-snapshot envelope"));
        }
        let mut e = Envelope {
            notebook_id,
            doc_id,
            epoch: key.epoch(),
            kind,
            author: keys.device_id(),
            covers,
            nonce: crypto::random_nonce(rng),
            payload: Vec::new(),
            signature: [0; 64],
        };
        e.payload = crypto::seal(&key.subkey(CONTENT_LABEL), &e.nonce, &e.aad(), plaintext);
        e.signature = keys.sign(&e.signed_bytes());
        Ok(e)
    }

    /// Decrypts a content envelope with the keyring's key for its epoch. Does not check the signature or membership:
    /// call [`crate::MemberChain::authorize`] (live) or [`crate::MemberChain::authorize_historic`] (catch-up) first.
    pub fn open(&self, keyring: &Keyring) -> Result<Vec<u8>, SyncError> {
        if !self.kind.is_content() {
            return Err(SyncError::WrongKind(self.kind));
        }
        let key = keyring.get(self.epoch)?;
        crypto::open(
            &key.subkey(CONTENT_LABEL),
            &self.nonce,
            &self.aad(),
            &self.payload,
        )
    }

    /// Re-encrypts one of this device's own queued envelopes (made offline under an older epoch) with `new_key`:
    /// fresh nonce, new epoch, new signature. Used on reconnect after a key rotation.
    pub fn reencrypt(
        &self,
        keyring: &Keyring,
        new_key: &NotebookKey,
        keys: &DeviceKeys,
        rng: &mut impl CryptoRngCore,
    ) -> Result<Envelope, SyncError> {
        if self.author != keys.device_id() {
            return Err(SyncError::NotOwnEnvelope);
        }
        self.verify(&keys.signing_public())?;
        let plain = zeroize::Zeroizing::new(self.open(keyring)?);
        Envelope::seal(
            keys,
            new_key,
            self.notebook_id,
            self.doc_id,
            self.kind,
            self.covers,
            &plain,
            rng,
        )
    }
}

impl Serialize for Envelope {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bytes(&self.encode())
    }
}

impl<'de> Deserialize<'de> for Envelope {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Envelope, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = Envelope;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an encoded envelope")
            }
            fn visit_bytes<E: serde::de::Error>(self, v: &[u8]) -> Result<Envelope, E> {
                Envelope::decode(v).map_err(E::custom)
            }
            fn visit_byte_buf<E: serde::de::Error>(self, v: Vec<u8>) -> Result<Envelope, E> {
                self.visit_bytes(&v)
            }
        }
        d.deserialize_bytes(V)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;

    fn setup() -> (DeviceKeys, NotebookKey, NotebookId, DocId) {
        (
            DeviceKeys::generate(&mut OsRng),
            NotebookKey::generate(0, &mut OsRng),
            NotebookId::random(&mut OsRng),
            DocId::random(&mut OsRng),
        )
    }

    fn update(
        k: &DeviceKeys,
        key: &NotebookKey,
        nb: NotebookId,
        doc: DocId,
        pt: &[u8],
    ) -> Envelope {
        Envelope::seal(k, key, nb, doc, Kind::Update, 0, pt, &mut OsRng).unwrap()
    }

    #[test]
    fn seal_open_roundtrip_and_encoding() {
        let (k, key, nb, doc) = setup();
        let e = update(&k, &key, nb, doc, b"loro update bytes");
        assert_eq!(e.author, k.device_id());
        assert!(e.verify(&k.signing_public()).is_ok());
        let ring = Keyring::new(key.clone());
        assert_eq!(e.open(&ring).unwrap(), b"loro update bytes");
        let wire = e.encode();
        assert_eq!(wire.len(), e.encoded_len());
        assert_eq!(wire.len(), OVERHEAD + 17 + 16);
        assert_eq!(Envelope::decode(&wire).unwrap(), e);
        // serde (postcard) carries the same bytes.
        let pc = postcard::to_allocvec(&e).unwrap();
        assert_eq!(postcard::from_bytes::<Envelope>(&pc).unwrap(), e);
        // The plaintext is not on the wire.
        assert!(!wire.windows(4).any(|w| w == b"loro"));
    }

    #[test]
    fn decode_rejects_malformed() {
        let (k, key, nb, doc) = setup();
        let wire = update(&k, &key, nb, doc, b"x").encode();
        assert!(
            Envelope::decode(&wire[..wire.len() - 1]).is_err(),
            "truncated"
        );
        let mut longer = wire.clone();
        longer.push(0);
        assert!(Envelope::decode(&longer).is_err(), "trailing bytes");
        let mut v = wire.clone();
        v[0] = 2;
        assert!(Envelope::decode(&v).is_err(), "version");
        let mut kind = wire.clone();
        kind[1 + 16 + 16 + 4] = 99;
        assert!(Envelope::decode(&kind).is_err(), "unknown kind");
        assert!(Envelope::decode(&[]).is_err());
        // covers on an update
        let mut c = wire.clone();
        c[1 + 16 + 16 + 4 + 1 + 32 + 7] = 1;
        assert!(Envelope::decode(&c).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails_signature_and_decryption() {
        let (k, key, nb, doc) = setup();
        let ring = Keyring::new(key.clone());
        let mut e = update(&k, &key, nb, doc, b"secret");
        e.payload[0] ^= 1;
        assert_eq!(e.verify(&k.signing_public()), Err(SyncError::BadSignature));
        assert_eq!(e.open(&ring), Err(SyncError::Decrypt));
    }

    #[test]
    fn tampered_signature_fails() {
        let (k, key, nb, doc) = setup();
        let mut e = update(&k, &key, nb, doc, b"secret");
        e.signature[10] ^= 1;
        assert_eq!(e.verify(&k.signing_public()), Err(SyncError::BadSignature));
    }

    #[test]
    fn every_header_field_is_signed_and_bound_as_aad() {
        let (k, key, nb, doc) = setup();
        let ring = {
            let mut r = Keyring::new(key.clone());
            r.insert(NotebookKey::from_bytes(1, *key.expose_secret()));
            r
        };
        let e = update(&k, &key, nb, doc, b"secret");
        let other = DeviceKeys::generate(&mut OsRng);
        type Mutation = Box<dyn Fn(&mut Envelope)>;
        let mutations: Vec<(&str, Mutation)> = vec![
            ("notebook", Box::new(|e| e.notebook_id.0[0] ^= 1)),
            ("doc", Box::new(|e| e.doc_id.0[0] ^= 1)),
            ("epoch", Box::new(|e| e.epoch = 1)),
            ("kind", Box::new(|e| e.kind = Kind::Presence)),
            ("nonce", Box::new(|e| e.nonce[0] ^= 1)),
        ];
        for (name, m) in mutations {
            let mut t = e.clone();
            m(&mut t);
            assert_eq!(
                t.verify(&k.signing_public()),
                Err(SyncError::BadSignature),
                "{name}: signature"
            );
            assert_eq!(t.open(&ring), Err(SyncError::Decrypt), "{name}: AAD");
        }
        // Claiming another author: the signature does not verify with that author's key, and decryption fails.
        let mut t = e.clone();
        t.author = other.device_id();
        assert_eq!(
            t.verify(&other.signing_public()),
            Err(SyncError::BadSignature)
        );
        assert_eq!(t.verify(&k.signing_public()), Err(SyncError::BadSignature));
        assert_eq!(t.open(&ring), Err(SyncError::Decrypt));
        // Re-signing a moved ciphertext with another key still fails the AAD.
        let mut moved = e.clone();
        moved.doc_id = DocId::random(&mut OsRng);
        moved.author = other.device_id();
        moved.signature = other.sign(&moved.signed_bytes());
        assert!(moved.verify(&other.signing_public()).is_ok());
        assert_eq!(moved.open(&ring), Err(SyncError::Decrypt));
    }

    #[test]
    fn wrong_epoch_key_fails() {
        let (k, key, nb, doc) = setup();
        let e = update(&k, &key, nb, doc, b"secret");
        let other = Keyring::new(NotebookKey::generate(0, &mut OsRng));
        assert_eq!(e.open(&other), Err(SyncError::Decrypt));
        let missing = Keyring::new(NotebookKey::generate(1, &mut OsRng));
        assert_eq!(e.open(&missing), Err(SyncError::MissingEpochKey(0)));
    }

    #[test]
    fn seal_refuses_non_content_kinds_and_stray_covers() {
        let (k, key, nb, doc) = setup();
        for kind in [Kind::MemberList, Kind::KeyWrap, Kind::JoinRequest] {
            assert_eq!(
                Envelope::seal(&k, &key, nb, doc, kind, 0, b"x", &mut OsRng),
                Err(SyncError::WrongKind(kind))
            );
        }
        assert!(Envelope::seal(&k, &key, nb, doc, Kind::Update, 5, b"x", &mut OsRng).is_err());
        let snap = Envelope::seal(&k, &key, nb, doc, Kind::Snapshot, 5, b"x", &mut OsRng).unwrap();
        assert_eq!(Envelope::decode(&snap.encode()).unwrap().covers, 5);
    }

    #[test]
    fn nonces_are_fresh() {
        let (k, key, nb, doc) = setup();
        let a = update(&k, &key, nb, doc, b"same");
        let b = update(&k, &key, nb, doc, b"same");
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.payload, b.payload);
    }

    #[test]
    fn reencrypt_moves_own_envelope_to_new_epoch() {
        let (k, key0, nb, doc) = setup();
        let key1 = NotebookKey::generate(1, &mut OsRng);
        let mut ring = Keyring::new(key0.clone());
        ring.insert(key1.clone());
        let old = update(&k, &key0, nb, doc, b"offline edit");
        let new = old.reencrypt(&ring, &key1, &k, &mut OsRng).unwrap();
        assert_eq!(new.epoch, 1);
        assert_ne!(new.nonce, old.nonce);
        assert!(new.verify(&k.signing_public()).is_ok());
        assert_eq!(
            new.open(&Keyring::new(key1.clone())).unwrap(),
            b"offline edit"
        );
        // Someone else's envelope cannot be re-encrypted (it would carry our signature as theirs).
        let other = DeviceKeys::generate(&mut OsRng);
        assert_eq!(
            old.reencrypt(&ring, &key1, &other, &mut OsRng),
            Err(SyncError::NotOwnEnvelope)
        );
        // A tampered queued envelope is refused.
        let mut bad = old.clone();
        bad.payload[0] ^= 1;
        assert_eq!(
            bad.reencrypt(&ring, &key1, &k, &mut OsRng),
            Err(SyncError::BadSignature)
        );
    }
}
