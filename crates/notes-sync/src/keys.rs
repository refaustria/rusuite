//! Device identity (Ed25519 + X25519, one pair per device) and the notebook's epoch keys.

use std::collections::BTreeMap;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand_core::CryptoRngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::crypto;
use crate::error::SyncError;
use crate::ids::DeviceId;

const DEVICE_KEYS_MAGIC: &[u8; 4] = b"RNDK";
const DEVICE_KEYS_VERSION: u8 = 1;

/// `SHA-256("rusuite-notes/device-id/v1" ‖ signing public key)`.
pub fn device_id_of(signing_pub: &[u8; 32]) -> DeviceId {
    let mut h = Sha256::new();
    h.update(b"rusuite-notes/device-id/v1");
    h.update(signing_pub);
    DeviceId(h.finalize().into())
}

/// Strict Ed25519 verification (rejects malleable and small-order encodings).
pub(crate) fn verify(signing_pub: &[u8; 32], msg: &[u8], sig: &[u8; 64]) -> Result<(), SyncError> {
    let vk = VerifyingKey::from_bytes(signing_pub).map_err(|_| SyncError::BadSignature)?;
    if vk.is_weak() {
        return Err(SyncError::WeakKey);
    }
    vk.verify_strict(msg, &Signature::from_bytes(sig))
        .map_err(|_| SyncError::BadSignature)
}

/// A device's secret keys. Never leaves the device; zeroized on drop; `Debug` prints only the device id.
pub struct DeviceKeys {
    signing: SigningKey,
    agreement: StaticSecret,
}

/// A device's public keys (what member lists and join requests carry).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct DevicePublic {
    pub signing: [u8; 32],
    pub agreement: [u8; 32],
}

impl DevicePublic {
    pub fn device_id(&self) -> DeviceId {
        device_id_of(&self.signing)
    }
}

impl DeviceKeys {
    pub fn generate(rng: &mut impl CryptoRngCore) -> Self {
        DeviceKeys {
            signing: SigningKey::generate(rng),
            agreement: StaticSecret::random_from_rng(rng),
        }
    }

    /// `"RNDK" ‖ 1 ‖ Ed25519 secret (32) ‖ X25519 secret (32)` – for the device's local key store only.
    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        let mut v = Zeroizing::new(Vec::with_capacity(69));
        v.extend_from_slice(DEVICE_KEYS_MAGIC);
        v.push(DEVICE_KEYS_VERSION);
        v.extend_from_slice(self.signing.as_bytes());
        v.extend_from_slice(self.agreement.as_bytes());
        v
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, SyncError> {
        if b.len() != 69 || &b[..4] != DEVICE_KEYS_MAGIC || b[4] != DEVICE_KEYS_VERSION {
            return Err(SyncError::Malformed("device keys"));
        }
        let mut s = Zeroizing::new([0u8; 32]);
        s.copy_from_slice(&b[5..37]);
        let mut a = Zeroizing::new([0u8; 32]);
        a.copy_from_slice(&b[37..69]);
        Ok(DeviceKeys {
            signing: SigningKey::from_bytes(&s),
            agreement: StaticSecret::from(*a),
        })
    }

    pub fn public(&self) -> DevicePublic {
        DevicePublic {
            signing: self.signing.verifying_key().to_bytes(),
            agreement: PublicKey::from(&self.agreement).to_bytes(),
        }
    }

    pub fn device_id(&self) -> DeviceId {
        device_id_of(&self.signing.verifying_key().to_bytes())
    }

    pub fn signing_public(&self) -> [u8; 32] {
        self.signing.verifying_key().to_bytes()
    }

    pub(crate) fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.signing.sign(msg).to_bytes()
    }

    pub(crate) fn agreement(&self) -> &StaticSecret {
        &self.agreement
    }
}

impl std::fmt::Debug for DeviceKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DeviceKeys({})", self.device_id())
    }
}

/// The notebook's symmetric key for one epoch. Content, names and blob ids use keys derived from it (HKDF, distinct
/// labels), never the key itself.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct NotebookKey {
    epoch: u32,
    key: [u8; 32],
}

impl NotebookKey {
    pub fn generate(epoch: u32, rng: &mut impl CryptoRngCore) -> Self {
        NotebookKey {
            epoch,
            key: *crypto::random_key(rng),
        }
    }

    pub fn from_bytes(epoch: u32, key: [u8; 32]) -> Self {
        NotebookKey { epoch, key }
    }

    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// The raw key, for the device's local key store only.
    pub fn expose_secret(&self) -> &[u8; 32] {
        &self.key
    }

    pub(crate) fn subkey(&self, label: &[u8]) -> Zeroizing<[u8; 32]> {
        crypto::derive(
            b"rusuite-notes/notebook-key/v1",
            &self.key,
            &[label, &self.epoch.to_be_bytes()],
        )
    }
}

impl std::fmt::Debug for NotebookKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NotebookKey(epoch {})", self.epoch)
    }
}

/// All epoch keys a device knows for one notebook. New members receive the whole keyring (older epochs included), so
/// they can read history encrypted before they joined.
#[derive(Clone, Default, Debug)]
pub struct Keyring {
    keys: BTreeMap<u32, NotebookKey>,
}

impl Keyring {
    pub fn new(key: NotebookKey) -> Self {
        let mut k = Keyring::default();
        k.insert(key);
        k
    }

    pub fn insert(&mut self, key: NotebookKey) {
        self.keys.insert(key.epoch, key);
    }

    pub fn get(&self, epoch: u32) -> Result<&NotebookKey, SyncError> {
        self.keys
            .get(&epoch)
            .ok_or(SyncError::MissingEpochKey(epoch))
    }

    /// The newest key.
    pub fn current(&self) -> Option<&NotebookKey> {
        self.keys.values().next_back()
    }

    pub fn epochs(&self) -> impl Iterator<Item = u32> + '_ {
        self.keys.keys().copied()
    }

    /// `[count u32][epoch u32, key 32]…` (big-endian), for key wraps and local storage.
    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        let mut v = Zeroizing::new(Vec::with_capacity(4 + self.keys.len() * 36));
        v.extend_from_slice(&(self.keys.len() as u32).to_be_bytes());
        for k in self.keys.values() {
            v.extend_from_slice(&k.epoch.to_be_bytes());
            v.extend_from_slice(&k.key);
        }
        v
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, SyncError> {
        let bad = SyncError::Malformed("keyring");
        let n = u32::from_be_bytes(b.get(..4).ok_or(bad.clone())?.try_into().expect("4 bytes"))
            as usize;
        if n == 0 || n > 1 << 16 || b.len() != 4 + n * 36 {
            return Err(bad);
        }
        let mut ring = Keyring::default();
        for c in b[4..].chunks_exact(36) {
            let epoch = u32::from_be_bytes(c[..4].try_into().expect("4 bytes"));
            let mut key = [0u8; 32];
            key.copy_from_slice(&c[4..]);
            if ring.keys.contains_key(&epoch) {
                key.zeroize();
                return Err(bad);
            }
            ring.insert(NotebookKey::from_bytes(epoch, key));
            key.zeroize();
        }
        Ok(ring)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;

    #[test]
    fn device_keys_roundtrip() {
        let k = DeviceKeys::generate(&mut OsRng);
        let b = k.to_bytes();
        let k2 = DeviceKeys::from_bytes(&b).unwrap();
        assert_eq!(k.public(), k2.public());
        assert_eq!(k.device_id(), k2.device_id());
        assert_eq!(k.public().device_id(), k.device_id());
        assert!(DeviceKeys::from_bytes(&b[..68]).is_err());
        let mut wrong = b.to_vec();
        wrong[0] = b'X';
        assert!(DeviceKeys::from_bytes(&wrong).is_err());
    }

    #[test]
    fn debug_never_prints_secrets() {
        let k = DeviceKeys::generate(&mut OsRng);
        let s = format!("{k:?}");
        assert!(s.starts_with("DeviceKeys("));
        assert!(!s.contains(&crate::bytes::hex(&k.to_bytes()[5..37])));
        let nk = NotebookKey::generate(3, &mut OsRng);
        assert_eq!(format!("{nk:?}"), "NotebookKey(epoch 3)");
    }

    #[test]
    fn signatures_verify_strictly() {
        let k = DeviceKeys::generate(&mut OsRng);
        let sig = k.sign(b"msg");
        assert!(verify(&k.signing_public(), b"msg", &sig).is_ok());
        assert_eq!(
            verify(&k.signing_public(), b"msG", &sig),
            Err(SyncError::BadSignature)
        );
        let other = DeviceKeys::generate(&mut OsRng);
        assert_eq!(
            verify(&other.signing_public(), b"msg", &sig),
            Err(SyncError::BadSignature)
        );
        // The identity point is a weak key.
        let mut ident = [0u8; 32];
        ident[0] = 1;
        assert!(verify(&ident, b"msg", &sig).is_err());
    }

    #[test]
    fn subkeys_depend_on_label_and_epoch() {
        let k0 = NotebookKey::from_bytes(0, [1; 32]);
        let k1 = NotebookKey::from_bytes(1, [1; 32]);
        assert_ne!(*k0.subkey(b"content"), *k0.subkey(b"name"));
        assert_ne!(*k0.subkey(b"content"), *k1.subkey(b"content"));
    }

    #[test]
    fn keyring_roundtrip_and_current() {
        let mut r = Keyring::new(NotebookKey::generate(0, &mut OsRng));
        r.insert(NotebookKey::generate(2, &mut OsRng));
        r.insert(NotebookKey::generate(1, &mut OsRng));
        assert_eq!(r.current().unwrap().epoch(), 2);
        let r2 = Keyring::from_bytes(&r.to_bytes()).unwrap();
        assert_eq!(r2.epochs().collect::<Vec<_>>(), vec![0, 1, 2]);
        assert_eq!(
            r2.get(1).unwrap().expose_secret(),
            r.get(1).unwrap().expose_secret()
        );
        assert_eq!(r2.get(5).unwrap_err(), SyncError::MissingEpochKey(5));
        let b = r.to_bytes();
        assert!(Keyring::from_bytes(&b[..b.len() - 1]).is_err());
        assert!(Keyring::from_bytes(&[0, 0, 0, 0]).is_err());
    }
}
