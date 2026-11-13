//! Errors. Messages never contain key material or plaintext.

use crate::envelope::Kind;
use crate::members::Role;

/// Why a member-list version was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MemberListError {
    #[error("the first member list must have version 1 and epoch 0")]
    BadGenesis,
    #[error("the first member list must be signed by an owner listed in it")]
    GenesisSignerNotOwner,
    #[error("version {got} does not follow version {prev}")]
    VersionNotIncreasing { prev: u64, got: u64 },
    #[error("the signer is not an owner or co-owner of the previous version")]
    SignerNotOwner,
    #[error("no owner or co-owner would remain")]
    NoOwnerLeft,
    #[error("a device id does not match its signing key")]
    DeviceIdMismatch,
    #[error("a device is listed twice")]
    DuplicateMember,
    #[error("more than {0} members")]
    TooManyMembers(usize),
    #[error("removing a member requires a new epoch (key rotation)")]
    RemovalWithoutRotation,
    #[error("epoch {got} does not follow epoch {prev}")]
    BadEpoch { prev: u32, got: u32 },
    #[error("a co-owner may not remove, demote or create an owner")]
    CoOwnerMayNotChangeOwner,
    #[error("the envelope header does not match the member list")]
    HeaderMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SyncError {
    #[error("malformed {0}")]
    Malformed(&'static str),
    #[error("signature invalid")]
    BadSignature,
    #[error("decryption failed (wrong key, or the data was tampered with)")]
    Decrypt,
    #[error("no key for epoch {0}")]
    MissingEpochKey(u32),
    #[error("the envelope belongs to another notebook")]
    WrongNotebook,
    #[error("unexpected envelope kind {0:?}")]
    WrongKind(Kind),
    #[error("epoch {got} is not accepted (current epoch {current})")]
    WrongEpoch { got: u32, current: u32 },
    #[error("the author is not a member of the notebook")]
    NotMember,
    #[error("a {role:?} member may not send {kind:?}")]
    Forbidden { role: Role, kind: Kind },
    #[error("member list refused: {0}")]
    MemberList(#[from] MemberListError),
    #[error("unknown invite")]
    UnknownInvite,
    #[error("the invite was already used")]
    InviteUsed,
    #[error("the invite has expired")]
    InviteExpired,
    #[error("invalid invite: {0}")]
    BadInvite(&'static str),
    #[error("only the author's own device can re-encrypt its envelopes")]
    NotOwnEnvelope,
    #[error("a low-order public key was rejected")]
    WeakKey,
}
