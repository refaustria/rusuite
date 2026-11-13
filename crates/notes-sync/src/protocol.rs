//! The relay's WebSocket protocol (`GET /api/notes/ws`, binary frames, one postcard-encoded message per frame).
//!
//! 1. The relay greets with [`RelayMsg::Challenge`].
//! 2. The client [`ClientMsg::Subscribe`]s per notebook with a proof (Ed25519 over the challenge and notebook id) and
//!    its "have" markers (the relay's per-doc sequence numbers it already applied). Members get
//!    [`RelayMsg::Subscribed`] (member-list chain, their key wraps, join requests for managers, the doc directory),
//!    then the missing envelopes per doc as [`RelayMsg::Deliver`] and [`RelayMsg::CaughtUp`], then live ones.
//!    Non-members get [`RelayMsg::Pending`] (they may send one join request and wait for [`RelayMsg::Admitted`]);
//!    removed devices get [`RelayMsg::Revoked`].
//! 3. [`ClientMsg::Publish`] sends an envelope; durable ones are answered with [`RelayMsg::Accepted`] (with the
//!    assigned sequence number) or [`RelayMsg::Rejected`]. Presence is never acknowledged nor stored.
//!
//! Full description: `docs/notes-sync-protocol.md`.

use serde::{Deserialize, Serialize};

use crate::bytes::{arr64, decode_exact, encode};
use crate::envelope::Envelope;
use crate::error::SyncError;
use crate::ids::{DeviceId, DocId, NotebookId};
use crate::keys::{self, device_id_of, DeviceKeys};

pub const PROTOCOL_VERSION: u16 = 1;
/// A stop-sharing request is valid for this long around its timestamp (replay window).
pub const STOP_SHARING_WINDOW_SECS: u64 = 600;
const AUTH_DOMAIN: &[u8] = b"rusuite-notes/auth/v1";
const STOP_DOMAIN: &[u8] = b"rusuite-notes/stop-sharing/v1";

/// A doc and a sequence number: "I have applied everything up to `seq`" (client → relay) or "the log ends at `seq`"
/// (relay → client).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct DocSeq {
    pub doc_id: DocId,
    pub seq: u64,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum ClientMsg {
    /// Authenticate for `notebook_id` and (re)subscribe to `docs`. May be sent again to add docs.
    Subscribe {
        notebook_id: NotebookId,
        signing_pub: [u8; 32],
        #[serde(with = "arr64")]
        proof: [u8; 64],
        docs: Vec<DocSeq>,
    },
    Unsubscribe {
        notebook_id: NotebookId,
    },
    /// `tag` is echoed in `Accepted`/`Rejected`.
    Publish {
        tag: u32,
        envelope: Envelope,
    },
    FetchBlob {
        notebook_id: NotebookId,
        blob_id: DocId,
    },
    StopSharing(StopSharing),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum ErrorCode {
    Malformed,
    BadSignature,
    NotMember,
    Forbidden,
    /// The epoch is newer than the member list's.
    WrongEpoch,
    /// An old epoch after the grace window: re-encrypt with the current key ([`Envelope::reencrypt`]).
    StaleEpoch,
    MemberList,
    NotFound,
    /// Publishing for a notebook this connection has not authenticated for (as the envelope's author).
    NotSubscribed,
    TooLarge,
    QuotaExceeded,
    RateLimited,
    /// A snapshot that covers nothing new.
    Outdated,
    InviteUsed,
    TooManyRequests,
    Internal,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum RelayMsg {
    Challenge {
        nonce: [u8; 32],
        protocol: u16,
    },
    Subscribed {
        notebook_id: NotebookId,
        /// Every member-list version, oldest first (verify with [`crate::MemberChain::from_envelopes`]).
        member_lists: Vec<Envelope>,
        /// Key wraps addressed to this device.
        key_wraps: Vec<Envelope>,
        /// Open join requests (owners and co-owners only).
        join_requests: Vec<Envelope>,
        /// Every doc of the notebook with its last sequence number.
        docs: Vec<DocSeq>,
    },
    /// Authenticated, but not a member (yet): send a join request and wait for `Admitted`.
    Pending {
        notebook_id: NotebookId,
    },
    /// A member list now includes this device: subscribe again.
    Admitted {
        notebook_id: NotebookId,
    },
    /// This device was removed (or the subscription refers to a device no longer listed).
    Revoked {
        notebook_id: NotebookId,
    },
    /// The owner stopped sharing; the relay deleted everything.
    Deleted {
        notebook_id: NotebookId,
    },
    Deliver {
        seq: u64,
        envelope: Envelope,
    },
    CaughtUp {
        notebook_id: NotebookId,
        doc_id: DocId,
        last: u64,
    },
    Presence {
        envelope: Envelope,
    },
    MemberList {
        envelope: Envelope,
    },
    KeyWrap {
        envelope: Envelope,
    },
    JoinRequest {
        envelope: Envelope,
    },
    Blob {
        envelope: Envelope,
    },
    BlobMissing {
        notebook_id: NotebookId,
        blob_id: DocId,
    },
    Accepted {
        tag: u32,
        seq: u64,
    },
    Rejected {
        tag: u32,
        code: ErrorCode,
    },
    Error {
        code: ErrorCode,
        notebook_id: Option<NotebookId>,
    },
}

impl ClientMsg {
    pub fn encode(&self) -> Vec<u8> {
        encode(self)
    }
    pub fn decode(b: &[u8]) -> Result<ClientMsg, SyncError> {
        decode_exact(b, "client message")
    }
}

impl RelayMsg {
    pub fn encode(&self) -> Vec<u8> {
        encode(self)
    }
    pub fn decode(b: &[u8]) -> Result<RelayMsg, SyncError> {
        decode_exact(b, "relay message")
    }
}

fn auth_bytes(challenge: &[u8; 32], nb: &NotebookId) -> Vec<u8> {
    let mut v = AUTH_DOMAIN.to_vec();
    v.extend_from_slice(challenge);
    v.extend_from_slice(&nb.0);
    v
}

/// The `Subscribe` message for `notebook_id` answering `challenge`.
pub fn subscribe(
    keys: &DeviceKeys,
    challenge: &[u8; 32],
    notebook_id: NotebookId,
    docs: Vec<DocSeq>,
) -> ClientMsg {
    ClientMsg::Subscribe {
        notebook_id,
        signing_pub: keys.signing_public(),
        proof: keys.sign(&auth_bytes(challenge, &notebook_id)),
        docs,
    }
}

/// The relay's check of a `Subscribe` proof → the authenticated device.
pub fn verify_subscribe(
    challenge: &[u8; 32],
    notebook_id: &NotebookId,
    signing_pub: &[u8; 32],
    proof: &[u8; 64],
) -> Result<DeviceId, SyncError> {
    keys::verify(signing_pub, &auth_bytes(challenge, notebook_id), proof)?;
    Ok(device_id_of(signing_pub))
}

/// "Stop sharing": the owner asks the relay to delete everything it stores for the notebook.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct StopSharing {
    pub notebook_id: NotebookId,
    pub signing_pub: [u8; 32],
    /// Unix seconds; the relay accepts ±[`STOP_SHARING_WINDOW_SECS`].
    pub issued_at: u64,
    #[serde(with = "arr64")]
    pub signature: [u8; 64],
}

impl StopSharing {
    fn bytes(nb: &NotebookId, issued_at: u64) -> Vec<u8> {
        let mut v = STOP_DOMAIN.to_vec();
        v.extend_from_slice(&nb.0);
        v.extend_from_slice(&issued_at.to_be_bytes());
        v
    }

    pub fn new(keys: &DeviceKeys, notebook_id: NotebookId, now: u64) -> StopSharing {
        StopSharing {
            notebook_id,
            signing_pub: keys.signing_public(),
            issued_at: now,
            signature: keys.sign(&StopSharing::bytes(&notebook_id, now)),
        }
    }

    /// Signature and freshness; returns the signer (the relay then checks it is an `Owner`).
    pub fn verify(&self, now: u64) -> Result<DeviceId, SyncError> {
        if self.issued_at.abs_diff(now) > STOP_SHARING_WINDOW_SECS {
            return Err(SyncError::Malformed("stop sharing request is not fresh"));
        }
        keys::verify(
            &self.signing_pub,
            &StopSharing::bytes(&self.notebook_id, self.issued_at),
            &self.signature,
        )?;
        Ok(device_id_of(&self.signing_pub))
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(self)
    }

    pub fn decode(b: &[u8]) -> Result<StopSharing, SyncError> {
        decode_exact(b, "stop sharing")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::Kind;
    use crate::keys::NotebookKey;
    use rand_core::OsRng;

    #[test]
    fn messages_roundtrip() {
        let k = DeviceKeys::generate(&mut OsRng);
        let nb = NotebookId::random(&mut OsRng);
        let env = Envelope::seal(
            &k,
            &NotebookKey::generate(0, &mut OsRng),
            nb,
            DocId::random(&mut OsRng),
            Kind::Update,
            0,
            b"u",
            &mut OsRng,
        )
        .unwrap();
        let msgs = vec![
            subscribe(
                &k,
                &[1; 32],
                nb,
                vec![DocSeq {
                    doc_id: env.doc_id,
                    seq: 3,
                }],
            ),
            ClientMsg::Publish {
                tag: 9,
                envelope: env.clone(),
            },
            ClientMsg::StopSharing(StopSharing::new(&k, nb, 100)),
        ];
        for m in msgs {
            assert_eq!(ClientMsg::decode(&m.encode()).unwrap(), m);
        }
        let r = RelayMsg::Deliver {
            seq: 4,
            envelope: env,
        };
        assert_eq!(RelayMsg::decode(&r.encode()).unwrap(), r);
        let mut b = r.encode();
        b.push(0);
        assert!(RelayMsg::decode(&b).is_err(), "trailing bytes");
        assert!(ClientMsg::decode(&[200, 1, 2]).is_err());
    }

    #[test]
    fn subscribe_proof() {
        let k = DeviceKeys::generate(&mut OsRng);
        let nb = NotebookId::random(&mut OsRng);
        let ch = [5u8; 32];
        let ClientMsg::Subscribe {
            signing_pub, proof, ..
        } = subscribe(&k, &ch, nb, vec![])
        else {
            unreachable!()
        };
        assert_eq!(
            verify_subscribe(&ch, &nb, &signing_pub, &proof).unwrap(),
            k.device_id()
        );
        // Replayed on another connection (other challenge) or for another notebook: refused.
        assert!(verify_subscribe(&[6; 32], &nb, &signing_pub, &proof).is_err());
        assert!(verify_subscribe(&ch, &NotebookId([0; 16]), &signing_pub, &proof).is_err());
        let other = DeviceKeys::generate(&mut OsRng);
        assert!(verify_subscribe(&ch, &nb, &other.signing_public(), &proof).is_err());
    }

    #[test]
    fn stop_sharing_freshness_and_signature() {
        let k = DeviceKeys::generate(&mut OsRng);
        let nb = NotebookId::random(&mut OsRng);
        let s = StopSharing::new(&k, nb, 10_000);
        assert_eq!(s.verify(10_000 + 600).unwrap(), k.device_id());
        assert!(s.verify(10_000 + 601).is_err(), "stale");
        assert!(s.verify(10_000 - 601).is_err(), "from the future");
        let mut t = s.clone();
        t.notebook_id = NotebookId([9; 16]);
        assert_eq!(t.verify(10_000), Err(SyncError::BadSignature));
        assert_eq!(StopSharing::decode(&s.encode()).unwrap(), s);
    }
}
