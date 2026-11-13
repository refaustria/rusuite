//! Key wraps: the notebook keyring encrypted for one member device.
//!
//! `ephemeral X25519 × recipient X25519 → HKDF-SHA-256(salt = ephemeral_pub ‖ recipient_pub,
//! info = "rusuite-notes/keywrap/v1" ‖ notebook ‖ epoch ‖ recipient id) → XChaCha20-Poly1305` over the keyring bytes
//! with the envelope AAD plus recipient id and ephemeral key. The envelope is signed by an owner/co-owner, so the
//! recipient knows who handed out the key; the relay sees only the recipient's device id.

use rand_core::CryptoRngCore;
use serde::{Deserialize, Serialize};
use x25519_dalek::{EphemeralSecret, PublicKey};
use zeroize::Zeroizing;

use crate::bytes::{decode_exact, encode};
use crate::crypto;
use crate::envelope::{Envelope, Kind};
use crate::error::SyncError;
use crate::ids::{DeviceId, DocId, NotebookId};
use crate::keys::{DeviceKeys, DevicePublic, Keyring};
use crate::members::MemberChain;

const INFO: &[u8] = b"rusuite-notes/keywrap/v1";

/// The structured payload of a `KeyWrap` envelope (the relay reads `recipient` to route and store it).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct KeyWrapBody {
    pub recipient: DeviceId,
    pub ephemeral_pub: [u8; 32],
    pub ciphertext: Vec<u8>,
}

fn wrap_key(
    shared: &[u8; 32],
    ephemeral_pub: &[u8; 32],
    recipient: &DevicePublic,
    nb: &NotebookId,
    epoch: u32,
) -> Zeroizing<[u8; 32]> {
    let mut salt = ephemeral_pub.to_vec();
    salt.extend_from_slice(&recipient.agreement);
    crypto::derive(
        &salt,
        shared,
        &[INFO, &nb.0, &epoch.to_be_bytes(), &recipient.device_id().0],
    )
}

fn aad(env: &Envelope, recipient: &DeviceId, ephemeral_pub: &[u8; 32]) -> Vec<u8> {
    let mut v = env.aad();
    v.extend_from_slice(&recipient.0);
    v.extend_from_slice(ephemeral_pub);
    v
}

/// Wraps `keyring` (epoch = its newest key) for `recipient`, signed by `signer` (an owner/co-owner device).
pub fn wrap_keyring(
    signer: &DeviceKeys,
    notebook_id: NotebookId,
    recipient: &DevicePublic,
    keyring: &Keyring,
    rng: &mut impl CryptoRngCore,
) -> Result<Envelope, SyncError> {
    let epoch = keyring
        .current()
        .ok_or(SyncError::MissingEpochKey(0))?
        .epoch();
    let eph = EphemeralSecret::random_from_rng(&mut *rng);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(recipient.agreement));
    if !shared.was_contributory() {
        return Err(SyncError::WeakKey);
    }
    let key = wrap_key(shared.as_bytes(), &eph_pub, recipient, &notebook_id, epoch);
    let recipient_id = recipient.device_id();
    let mut env = Envelope {
        notebook_id,
        doc_id: DocId::NOTEBOOK,
        epoch,
        kind: Kind::KeyWrap,
        author: signer.device_id(),
        covers: 0,
        nonce: crypto::random_nonce(rng),
        payload: Vec::new(),
        signature: [0; 64],
    };
    let ciphertext = crypto::seal(
        &key,
        &env.nonce,
        &aad(&env, &recipient_id, &eph_pub),
        &keyring.to_bytes(),
    );
    env.payload = encode(&KeyWrapBody {
        recipient: recipient_id,
        ephemeral_pub: eph_pub,
        ciphertext,
    });
    Ok(Envelope::new_signed(
        signer,
        env.notebook_id,
        env.doc_id,
        env.epoch,
        env.kind,
        0,
        env.nonce,
        env.payload,
    ))
}

/// The device a key wrap is addressed to (for the relay; no secrets involved).
pub fn key_wrap_recipient(env: &Envelope) -> Result<DeviceId, SyncError> {
    if env.kind != Kind::KeyWrap {
        return Err(SyncError::WrongKind(env.kind));
    }
    let body: KeyWrapBody = decode_exact(&env.payload, "key wrap")?;
    Ok(body.recipient)
}

/// Opens a key wrap addressed to `me`. The signer must have been an owner/co-owner in a list of the wrap's epoch, and
/// the keyring must contain that epoch and nothing newer.
pub fn unwrap_keyring(
    env: &Envelope,
    me: &DeviceKeys,
    chain: &MemberChain,
) -> Result<Keyring, SyncError> {
    if env.kind != Kind::KeyWrap {
        return Err(SyncError::WrongKind(env.kind));
    }
    let latest = chain.latest();
    if env.notebook_id != latest.notebook_id {
        return Err(SyncError::WrongNotebook);
    }
    chain.authorize_historic(env)?;
    let body: KeyWrapBody = decode_exact(&env.payload, "key wrap")?;
    if body.recipient != me.device_id() {
        return Err(SyncError::NotMember);
    }
    let shared = me
        .agreement()
        .diffie_hellman(&PublicKey::from(body.ephemeral_pub));
    if !shared.was_contributory() {
        return Err(SyncError::WeakKey);
    }
    let key = wrap_key(
        shared.as_bytes(),
        &body.ephemeral_pub,
        &me.public(),
        &env.notebook_id,
        env.epoch,
    );
    let plain = Zeroizing::new(crypto::open(
        &key,
        &env.nonce,
        &aad(env, &body.recipient, &body.ephemeral_pub),
        &body.ciphertext,
    )?);
    let ring = Keyring::from_bytes(&plain)?;
    if ring.current().map(|k| k.epoch()) != Some(env.epoch) {
        return Err(SyncError::Malformed("keyring epoch"));
    }
    Ok(ring)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::invite::JoinRequest;
    use crate::members::{admit, create_share, Role};
    use rand_core::OsRng;

    fn setup() -> (DeviceKeys, DeviceKeys, MemberChain, Keyring, Envelope) {
        let owner = DeviceKeys::generate(&mut OsRng);
        let ben = DeviceKeys::generate(&mut OsRng);
        let (ring, mut chain, _) =
            create_share(&owner, NotebookId::random(&mut OsRng), "Ana", &mut OsRng);
        let join = JoinRequest {
            device: ben.public(),
            display_name: "Ben".into(),
            role: Role::Edit,
            invite_id: DocId([1; 16]),
        };
        let (list, wrap) = admit(&chain, &owner, &ring, &join, &mut OsRng).unwrap();
        chain.apply(&list).unwrap();
        (owner, ben, chain, ring, wrap)
    }

    #[test]
    fn wrap_unwrap() {
        let (_, ben, chain, ring, wrap) = setup();
        assert_eq!(key_wrap_recipient(&wrap).unwrap(), ben.device_id());
        let got = unwrap_keyring(&wrap, &ben, &chain).unwrap();
        assert_eq!(
            got.get(0).unwrap().expose_secret(),
            ring.get(0).unwrap().expose_secret()
        );
        // The key is not visible in the payload.
        let raw = ring.get(0).unwrap().expose_secret();
        assert!(!wrap.payload.windows(32).any(|w| w == raw));
    }

    #[test]
    fn only_the_recipient_can_unwrap() {
        let (owner, _, chain, _, wrap) = setup();
        let eve = DeviceKeys::generate(&mut OsRng);
        assert_eq!(
            unwrap_keyring(&wrap, &eve, &chain).unwrap_err(),
            SyncError::NotMember
        );
        assert_eq!(
            unwrap_keyring(&wrap, &owner, &chain).unwrap_err(),
            SyncError::NotMember
        );
        // Re-addressing the body to Eve breaks the signature.
        let mut body: KeyWrapBody = decode_exact(&wrap.payload, "kw").unwrap();
        body.recipient = eve.device_id();
        let mut t = wrap.clone();
        t.payload = encode(&body);
        assert_eq!(
            unwrap_keyring(&t, &eve, &chain).unwrap_err(),
            SyncError::BadSignature
        );
    }

    #[test]
    fn tampering_and_unauthorized_signers_are_refused() {
        let (_, ben, chain, ring, wrap) = setup();
        let mut t = wrap.clone();
        let n = t.payload.len();
        t.payload[n - 1] ^= 1;
        assert_eq!(
            unwrap_keyring(&t, &ben, &chain).unwrap_err(),
            SyncError::BadSignature
        );
        // An editor (Ben himself) wrapping keys for someone: not allowed to sign key wraps.
        let eve = DeviceKeys::generate(&mut OsRng);
        let by_editor = wrap_keyring(
            &ben,
            chain.latest().notebook_id,
            &eve.public(),
            &ring,
            &mut OsRng,
        )
        .unwrap();
        assert!(matches!(
            unwrap_keyring(&by_editor, &eve, &chain),
            Err(SyncError::Forbidden {
                role: Role::Edit,
                ..
            })
        ));
        // An outsider's wrap.
        let mallory = DeviceKeys::generate(&mut OsRng);
        let fake = wrap_keyring(
            &mallory,
            chain.latest().notebook_id,
            &ben.public(),
            &ring,
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(
            unwrap_keyring(&fake, &ben, &chain).unwrap_err(),
            SyncError::NotMember
        );
    }

    #[test]
    fn low_order_agreement_key_is_refused() {
        let (owner, _, chain, ring, _) = setup();
        let weak = DevicePublic {
            signing: owner.signing_public(),
            agreement: [0; 32],
        };
        assert_eq!(
            wrap_keyring(&owner, chain.latest().notebook_id, &weak, &ring, &mut OsRng).unwrap_err(),
            SyncError::WeakKey
        );
    }
}
