//! Rusuite Notes sharing core (P11-N5a, spec section 4.3/4.4): everything a device and the relay need to share a
//! notebook end to end encrypted, with no Rusuite account and a server that never sees plaintext.
//!
//! - [`DeviceKeys`]: one Ed25519 signing key + one X25519 agreement key per device; [`DeviceId`] = hash of the signing
//!   public key.
//! - [`NotebookKey`] / [`Keyring`]: a 32-byte symmetric key per *epoch*; the epoch increments when a member is removed.
//! - [`Envelope`]: the one signed unit on the wire (Loro update, snapshot, blob, presence, member list, key wrap, join
//!   request). The relay checks signatures and membership without decrypting anything.
//! - [`MemberList`] / [`MemberChain`]: versioned, owner-signed membership with the validation rules.
//! - [`Invite`], [`PendingInvites`], [`join_request`], [`admit`], [`remove_member`]: the invite/admit/remove flows.
//! - [`protocol`]: the relay's WebSocket messages.
//!
//! The crate is `wasm32-unknown-unknown` compatible: no threads, file system or clock (callers pass `now`), randomness
//! from the caller's CSPRNG (`rand_core::OsRng` = `getrandom`, the `js` backend in the browser). Protocol details and
//! the threat model: `docs/notes-sync-protocol.md`.

#![forbid(unsafe_code)]

mod bytes;
mod crypto;
pub mod envelope;
pub mod error;
pub mod ids;
pub mod invite;
pub mod keys;
pub mod keywrap;
pub mod members;
pub mod protocol;

pub use envelope::{Envelope, Kind};
pub use error::{MemberListError, SyncError};
pub use ids::{DeviceId, DocId, NotebookId};
pub use invite::{
    join_request, join_request_signer, Invite, JoinRequest, PendingInvites, INVITE_TTL_SECS,
};
pub use keys::{device_id_of, DeviceKeys, DevicePublic, Keyring, NotebookKey};
pub use keywrap::{key_wrap_recipient, unwrap_keyring, wrap_keyring};
pub use members::{
    admit, create_share, remove_member, set_role, Member, MemberChain, MemberList, Role,
    SealedName, MAX_MEMBERS,
};
pub use rand_core::{CryptoRngCore, OsRng};
