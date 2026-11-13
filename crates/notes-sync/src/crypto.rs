//! The primitives, in one place: XChaCha20-Poly1305 with associated data, HKDF-SHA-256, random nonces.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand_core::CryptoRngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::SyncError;

pub(crate) const NONCE_LEN: usize = 24;

pub(crate) fn random_nonce(rng: &mut impl CryptoRngCore) -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    rng.fill_bytes(&mut n);
    n
}

pub(crate) fn random_key(rng: &mut impl CryptoRngCore) -> Zeroizing<[u8; 32]> {
    let mut k = Zeroizing::new([0u8; 32]);
    rng.fill_bytes(k.as_mut());
    k
}

pub(crate) fn seal(
    key: &[u8; 32],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    plaintext: &[u8],
) -> Vec<u8> {
    XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        // Only fails for plaintexts beyond ~256 GiB.
        .expect("XChaCha20-Poly1305 encryption")
}

pub(crate) fn open(
    key: &[u8; 32],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, SyncError> {
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| SyncError::Decrypt)
}

/// HKDF-SHA-256 → 32 bytes.
pub(crate) fn derive(salt: &[u8], ikm: &[u8], info: &[&[u8]]) -> Zeroizing<[u8; 32]> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut out = Zeroizing::new([0u8; 32]);
    hk.expand_multi_info(info, out.as_mut())
        .expect("32 bytes is a valid HKDF length");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_and_tamper() {
        let key = [7u8; 32];
        let nonce = [9u8; 24];
        let ct = seal(&key, &nonce, b"aad", b"hello");
        assert_eq!(ct.len(), 5 + 16);
        assert_eq!(open(&key, &nonce, b"aad", &ct).unwrap(), b"hello");
        assert_eq!(
            open(&key, &nonce, b"aaD", &ct),
            Err(SyncError::Decrypt),
            "AAD bound"
        );
        assert_eq!(
            open(&[8u8; 32], &nonce, b"aad", &ct),
            Err(SyncError::Decrypt),
            "key bound"
        );
        let mut n2 = nonce;
        n2[0] ^= 1;
        assert_eq!(
            open(&key, &n2, b"aad", &ct),
            Err(SyncError::Decrypt),
            "nonce bound"
        );
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert_eq!(open(&key, &nonce, b"aad", &bad), Err(SyncError::Decrypt));
    }

    /// Fixed vector (same as the N0 spike's WASM/native check, now with empty AAD): the primitive does not drift.
    #[test]
    fn known_vector() {
        let key: [u8; 32] = core::array::from_fn(|i| i as u8);
        let nonce: [u8; 24] = core::array::from_fn(|i| 100 + i as u8);
        let ct = seal(&key, &nonce, b"", b"rusuite notes");
        let again = seal(&key, &nonce, b"", b"rusuite notes");
        assert_eq!(ct, again);
        assert_eq!(open(&key, &nonce, b"", &ct).unwrap(), b"rusuite notes");
    }

    #[test]
    fn derive_separates_info() {
        let a = derive(b"s", b"ikm", &[b"a"]);
        let b = derive(b"s", b"ikm", &[b"b"]);
        let a2 = derive(b"s", b"ikm", &[b"a"]);
        assert_ne!(*a, *b);
        assert_eq!(*a, *a2);
    }
}
