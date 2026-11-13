//! Opaque identifiers: notebook and doc ids are random 16-byte values chosen by clients; a device id is the SHA-256 of
//! the device's Ed25519 public key (domain-separated).

use serde::{Deserialize, Serialize};

use crate::error::SyncError;
use rand_core::CryptoRngCore;

macro_rules! id_type {
    ($(#[$m:meta])* $name:ident, $n:expr) => {
        $(#[$m])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        pub struct $name(pub [u8; $n]);

        impl $name {
            pub const LEN: usize = $n;

            pub fn random(rng: &mut impl CryptoRngCore) -> Self {
                let mut b = [0u8; $n];
                rng.fill_bytes(&mut b);
                $name(b)
            }

            pub fn as_bytes(&self) -> &[u8; $n] {
                &self.0
            }

            /// Lower-case hex (file names on the relay, logs, UI).
            pub fn to_hex(&self) -> String {
                crate::bytes::hex(&self.0)
            }

            pub fn from_hex(s: &str) -> Result<Self, SyncError> {
                let v = crate::bytes::unhex(s).ok_or(SyncError::Malformed(stringify!($name)))?;
                let a: [u8; $n] = v.try_into().map_err(|_| SyncError::Malformed(stringify!($name)))?;
                Ok($name(a))
            }

            pub(crate) fn from_slice(s: &[u8]) -> Result<Self, SyncError> {
                let a: [u8; $n] = s.try_into().map_err(|_| SyncError::Malformed(stringify!($name)))?;
                Ok($name(a))
            }
        }

        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}({})", stringify!($name), self.to_hex())
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.to_hex())
            }
        }
    };
}

id_type!(
    /// A shared notebook (random, 128 bits; appears in invite links and on the relay).
    NotebookId,
    16
);
id_type!(
    /// A Loro document (the notebook doc or a page), a blob, or an invite (for join requests) inside a notebook.
    DocId,
    16
);
id_type!(
    /// A device: `SHA-256("rusuite-notes/device-id/v1" ‖ Ed25519 public key)`.
    DeviceId,
    32
);

impl DocId {
    /// The doc id of notebook-level envelopes (member lists, key wraps).
    pub const NOTEBOOK: DocId = DocId([0; 16]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip_and_errors() {
        let id = NotebookId([0xab; 16]);
        assert_eq!(id.to_hex(), "ab".repeat(16));
        assert_eq!(NotebookId::from_hex(&id.to_hex()).unwrap(), id);
        assert!(NotebookId::from_hex("abc").is_err());
        assert!(NotebookId::from_hex(&"ab".repeat(15)).is_err());
        assert!(NotebookId::from_hex(&"zz".repeat(16)).is_err());
        assert_eq!(
            format!("{:?}", DocId::NOTEBOOK),
            format!("DocId({})", "00".repeat(16))
        );
    }

    #[test]
    fn random_ids_differ() {
        let mut rng = rand_core::OsRng;
        assert_ne!(DocId::random(&mut rng), DocId::random(&mut rng));
    }
}
