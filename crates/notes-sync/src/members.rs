//! Membership: versioned member lists signed by an owner or co-owner, the rules every version must satisfy, and the
//! admit / remove / change-role flows that produce new versions.
//!
//! Rules ([`MemberList::validate_genesis`], [`MemberList::validate_next`]):
//! 1. The first list has version 1, epoch 0 and is signed by a device listed in it as `Owner`.
//! 2. Every later version is strictly greater (no rollback, no replay) and signed by an `Owner`/`CoOwner` of the
//!    *previous* version.
//! 3. At least one `Owner`/`CoOwner` remains; device ids match their keys; no device is listed twice.
//! 4. The epoch stays or grows by exactly one; removing a device requires the new epoch (key rotation).
//! 5. A `CoOwner` may admit, remove and re-role non-owners, but may not remove, demote or create an `Owner`.

use rand_core::CryptoRngCore;
use serde::{Deserialize, Serialize};

use crate::bytes::{decode_exact, encode};
use crate::crypto::{self, NONCE_LEN};
use crate::envelope::{Envelope, Kind};
use crate::error::{MemberListError, SyncError};
use crate::ids::{DeviceId, DocId, NotebookId};
use crate::invite::JoinRequest;
use crate::keys::{device_id_of, DeviceKeys, DevicePublic, Keyring, NotebookKey};
use crate::keywrap::wrap_keyring;

/// Upper bound on devices per notebook (keeps member lists and rotations small).
pub const MAX_MEMBERS: usize = 1000;
/// Upper bound on an encrypted display name (UTF-8 bytes + tag).
pub const MAX_NAME_CIPHERTEXT: usize = 512;
const NAME_LABEL: &[u8] = b"name";
const NAME_AAD: &[u8] = b"rusuite-notes/name/v1";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum Role {
    Owner,
    CoOwner,
    Edit,
    Read,
}

impl Role {
    /// May sign member lists and key wraps.
    pub fn can_manage(self) -> bool {
        matches!(self, Role::Owner | Role::CoOwner)
    }

    /// May send updates, snapshots and blobs.
    pub fn can_write(self) -> bool {
        !matches!(self, Role::Read)
    }

    pub fn may_send(self, kind: Kind) -> bool {
        match kind {
            Kind::Update | Kind::Snapshot | Kind::Blob => self.can_write(),
            Kind::Presence => true,
            Kind::MemberList | Kind::KeyWrap => self.can_manage(),
            // Join requests come from devices that are not members yet.
            Kind::JoinRequest => false,
        }
    }
}

/// A display name encrypted with the list epoch's name key (the relay never sees names).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct SealedName {
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

fn name_aad(notebook_id: &NotebookId, device_id: &DeviceId) -> Vec<u8> {
    let mut v = NAME_AAD.to_vec();
    v.extend_from_slice(&notebook_id.0);
    v.extend_from_slice(&device_id.0);
    v
}

impl SealedName {
    /// Names longer than 256 bytes are cut at a character boundary.
    pub fn seal(
        key: &NotebookKey,
        notebook_id: &NotebookId,
        device_id: &DeviceId,
        name: &str,
        rng: &mut impl CryptoRngCore,
    ) -> SealedName {
        let mut end = name.len().min(256);
        while !name.is_char_boundary(end) {
            end -= 1;
        }
        let nonce = crypto::random_nonce(rng);
        let ciphertext = crypto::seal(
            &key.subkey(NAME_LABEL),
            &nonce,
            &name_aad(notebook_id, device_id),
            &name.as_bytes()[..end],
        );
        SealedName { nonce, ciphertext }
    }

    pub fn open(
        &self,
        key: &NotebookKey,
        notebook_id: &NotebookId,
        device_id: &DeviceId,
    ) -> Result<String, SyncError> {
        let b = crypto::open(
            &key.subkey(NAME_LABEL),
            &self.nonce,
            &name_aad(notebook_id, device_id),
            &self.ciphertext,
        )?;
        String::from_utf8(b).map_err(|_| SyncError::Malformed("display name"))
    }
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Member {
    pub device_id: DeviceId,
    pub signing_pub: [u8; 32],
    pub agreement_pub: [u8; 32],
    pub role: Role,
    pub display_name: SealedName,
}

impl Member {
    pub fn public(&self) -> DevicePublic {
        DevicePublic {
            signing: self.signing_pub,
            agreement: self.agreement_pub,
        }
    }

    fn new(
        device: &DevicePublic,
        role: Role,
        name: &str,
        key: &NotebookKey,
        nb: &NotebookId,
        rng: &mut impl CryptoRngCore,
    ) -> Member {
        let id = device.device_id();
        Member {
            device_id: id,
            signing_pub: device.signing,
            agreement_pub: device.agreement,
            role,
            display_name: SealedName::seal(key, nb, &id, name, rng),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct MemberList {
    pub notebook_id: NotebookId,
    pub version: u64,
    /// The current epoch: content must be encrypted with this epoch's key (the relay allows a short grace window for
    /// the previous one).
    pub epoch: u32,
    pub members: Vec<Member>,
}

impl MemberList {
    pub fn member(&self, id: &DeviceId) -> Option<&Member> {
        self.members.iter().find(|m| m.device_id == *id)
    }

    pub fn role_of(&self, id: &DeviceId) -> Option<Role> {
        self.member(id).map(|m| m.role)
    }

    /// Signs this list as `signer` (the envelope's signature is the owner signature).
    pub fn to_envelope(&self, signer: &DeviceKeys) -> Envelope {
        Envelope::new_signed(
            signer,
            self.notebook_id,
            DocId::NOTEBOOK,
            self.epoch,
            Kind::MemberList,
            0,
            [0; NONCE_LEN],
            encode(self),
        )
    }

    /// Decodes the list carried by `env` and checks that the header agrees with it. No signature check.
    pub fn from_envelope(env: &Envelope) -> Result<MemberList, SyncError> {
        if env.kind != Kind::MemberList {
            return Err(SyncError::WrongKind(env.kind));
        }
        let list: MemberList = decode_exact(&env.payload, "member list")?;
        if list.notebook_id != env.notebook_id
            || list.epoch != env.epoch
            || env.doc_id != DocId::NOTEBOOK
            || env.nonce != [0; NONCE_LEN]
        {
            return Err(MemberListError::HeaderMismatch.into());
        }
        Ok(list)
    }

    fn check_structure(&self) -> Result<(), MemberListError> {
        if self.members.len() > MAX_MEMBERS {
            return Err(MemberListError::TooManyMembers(MAX_MEMBERS));
        }
        for (i, m) in self.members.iter().enumerate() {
            if device_id_of(&m.signing_pub) != m.device_id {
                return Err(MemberListError::DeviceIdMismatch);
            }
            if self.members[..i].iter().any(|o| o.device_id == m.device_id) {
                return Err(MemberListError::DuplicateMember);
            }
            if m.display_name.ciphertext.len() > MAX_NAME_CIPHERTEXT {
                return Err(MemberListError::HeaderMismatch);
            }
        }
        if !self.members.iter().any(|m| m.role.can_manage()) {
            return Err(MemberListError::NoOwnerLeft);
        }
        Ok(())
    }

    /// Rule 1: the list that creates a shared notebook.
    pub fn validate_genesis(env: &Envelope) -> Result<MemberList, SyncError> {
        let list = MemberList::from_envelope(env)?;
        if list.version != 1 || list.epoch != 0 {
            return Err(MemberListError::BadGenesis.into());
        }
        list.check_structure()?;
        let signer = list
            .member(&env.author)
            .filter(|m| m.role == Role::Owner)
            .ok_or(MemberListError::GenesisSignerNotOwner)?;
        env.verify(&signer.signing_pub)?;
        Ok(list)
    }

    /// Rules 2–5: `env` as the successor of `self`.
    pub fn validate_next(&self, env: &Envelope) -> Result<MemberList, SyncError> {
        if env.kind != Kind::MemberList {
            return Err(SyncError::WrongKind(env.kind));
        }
        if env.notebook_id != self.notebook_id {
            return Err(SyncError::WrongNotebook);
        }
        let signer = self.member(&env.author).ok_or(SyncError::NotMember)?;
        if !signer.role.can_manage() {
            return Err(MemberListError::SignerNotOwner.into());
        }
        env.verify(&signer.signing_pub)?;
        let next = MemberList::from_envelope(env)?;
        if next.version <= self.version {
            return Err(MemberListError::VersionNotIncreasing {
                prev: self.version,
                got: next.version,
            }
            .into());
        }
        next.check_structure()?;
        let bad_epoch = MemberListError::BadEpoch {
            prev: self.epoch,
            got: next.epoch,
        };
        let rotated = match next.epoch.checked_sub(self.epoch) {
            Some(0) => false,
            Some(1) => true,
            _ => return Err(bad_epoch.into()),
        };
        let removed = self
            .members
            .iter()
            .any(|m| next.member(&m.device_id).is_none());
        if removed && !rotated {
            return Err(MemberListError::RemovalWithoutRotation.into());
        }
        if signer.role == Role::CoOwner {
            let owners_kept = self
                .members
                .iter()
                .filter(|m| m.role == Role::Owner)
                .all(|m| next.role_of(&m.device_id) == Some(Role::Owner));
            let no_new_owner = next
                .members
                .iter()
                .filter(|m| m.role == Role::Owner)
                .all(|m| self.role_of(&m.device_id) == Some(Role::Owner));
            if !owners_kept || !no_new_owner {
                return Err(MemberListError::CoOwnerMayNotChangeOwner.into());
            }
        }
        Ok(next)
    }

    /// May `env.author` send `env.kind` under this list? Checks notebook, membership, role and the signature (not the
    /// epoch: see [`MemberChain::authorize`] and the relay's grace window).
    pub fn authorize(&self, env: &Envelope) -> Result<Role, SyncError> {
        if env.notebook_id != self.notebook_id {
            return Err(SyncError::WrongNotebook);
        }
        let m = self.member(&env.author).ok_or(SyncError::NotMember)?;
        if !m.role.may_send(env.kind) {
            return Err(SyncError::Forbidden {
                role: m.role,
                kind: env.kind,
            });
        }
        env.verify(&m.signing_pub)?;
        Ok(m.role)
    }

    /// A member's display name (needs the list epoch's key).
    pub fn display_name(&self, keyring: &Keyring, id: &DeviceId) -> Result<String, SyncError> {
        let m = self.member(id).ok_or(SyncError::NotMember)?;
        m.display_name
            .open(keyring.get(self.epoch)?, &self.notebook_id, id)
    }

    /// The next version with `f` applied to a copy; names re-sealed under `new_key` when it differs.
    fn successor(
        &self,
        keyring: &Keyring,
        new_key: &NotebookKey,
        rng: &mut impl CryptoRngCore,
        f: impl FnOnce(&mut Vec<Member>),
    ) -> Result<MemberList, SyncError> {
        let mut members = self.members.clone();
        f(&mut members);
        if new_key.epoch() != self.epoch {
            let old = keyring.get(self.epoch)?;
            for m in &mut members {
                let name = m.display_name.open(old, &self.notebook_id, &m.device_id)?;
                m.display_name =
                    SealedName::seal(new_key, &self.notebook_id, &m.device_id, &name, rng);
            }
        }
        Ok(MemberList {
            notebook_id: self.notebook_id,
            version: self.version + 1,
            epoch: new_key.epoch(),
            members,
        })
    }
}

/// A validated sequence of member lists (what a client keeps per shared notebook).
#[derive(Clone, Debug)]
pub struct MemberChain {
    lists: Vec<MemberList>,
}

impl MemberChain {
    pub fn genesis(env: &Envelope) -> Result<MemberChain, SyncError> {
        Ok(MemberChain {
            lists: vec![MemberList::validate_genesis(env)?],
        })
    }

    /// The chain from all versions in order (as the relay sends them on subscribe).
    pub fn from_envelopes<'a>(
        envs: impl IntoIterator<Item = &'a Envelope>,
    ) -> Result<MemberChain, SyncError> {
        let mut it = envs.into_iter();
        let first = it
            .next()
            .ok_or(SyncError::Malformed("empty member chain"))?;
        let mut chain = MemberChain::genesis(first)?;
        for e in it {
            chain.apply(e)?;
        }
        Ok(chain)
    }

    /// Appends the next version. Re-applying a version the chain already holds (identical content) is a no-op;
    /// a different list with an old version is a rollback and refused.
    pub fn apply(&mut self, env: &Envelope) -> Result<&MemberList, SyncError> {
        let latest = self.latest();
        if let Ok(list) = MemberList::from_envelope(env) {
            if list.version <= latest.version && self.lists.contains(&list) {
                return Ok(self.latest());
            }
        }
        let next = latest.validate_next(env)?;
        self.lists.push(next);
        Ok(self.latest())
    }

    pub fn latest(&self) -> &MemberList {
        self.lists.last().expect("a chain is never empty")
    }

    pub fn lists(&self) -> &[MemberList] {
        &self.lists
    }

    /// Live envelopes: the author must be in the *latest* list with a role allowed to send the kind, the signature
    /// must verify, and the epoch must not be newer than the latest list's. A removed device is refused here even if
    /// a relay forwarded its message.
    pub fn authorize(&self, env: &Envelope) -> Result<Role, SyncError> {
        let latest = self.latest();
        let role = latest.authorize(env)?;
        if env.epoch > latest.epoch {
            return Err(SyncError::WrongEpoch {
                got: env.epoch,
                current: latest.epoch,
            });
        }
        Ok(role)
    }

    /// Catch-up from the relay's log: the author must have been allowed to send the kind in some list version of the
    /// envelope's epoch (history written by members removed later stays readable).
    pub fn authorize_historic(&self, env: &Envelope) -> Result<Role, SyncError> {
        // Report the newest list's reason (e.g. `Forbidden` rather than "not yet a member" from an older version).
        let mut err = None;
        for l in self.lists.iter().rev().filter(|l| l.epoch == env.epoch) {
            match l.authorize(env) {
                Ok(r) => return Ok(r),
                Err(e) => {
                    err.get_or_insert(e);
                }
            }
        }
        Err(err.unwrap_or(SyncError::NotMember))
    }

    /// Was this device ever listed (to tell "removed" from "never a member")?
    pub fn was_member(&self, id: &DeviceId) -> bool {
        self.lists.iter().any(|l| l.member(id).is_some())
    }
}

/// Creates a shared notebook: epoch-0 key, genesis list (version 1) with `owner` as its only member.
pub fn create_share(
    owner: &DeviceKeys,
    notebook_id: NotebookId,
    display_name: &str,
    rng: &mut impl CryptoRngCore,
) -> (Keyring, MemberChain, Envelope) {
    let key = NotebookKey::generate(0, rng);
    let list = MemberList {
        notebook_id,
        version: 1,
        epoch: 0,
        members: vec![Member::new(
            &owner.public(),
            Role::Owner,
            display_name,
            &key,
            &notebook_id,
            rng,
        )],
    };
    let env = list.to_envelope(owner);
    let chain = MemberChain { lists: vec![list] };
    (Keyring::new(key), chain, env)
}

fn checked(
    chain: &MemberChain,
    list: &MemberList,
    signer: &DeviceKeys,
) -> Result<Envelope, SyncError> {
    let env = list.to_envelope(signer);
    chain.latest().validate_next(&env)?;
    Ok(env)
}

/// Admits the device of an opened join request: the next member-list version (same epoch) and a key wrap of the whole
/// keyring for it. Publish the list first, then the wrap.
pub fn admit(
    chain: &MemberChain,
    signer: &DeviceKeys,
    keyring: &Keyring,
    join: &JoinRequest,
    rng: &mut impl CryptoRngCore,
) -> Result<(Envelope, Envelope), SyncError> {
    let latest = chain.latest();
    if latest.member(&join.device.device_id()).is_some() {
        return Err(MemberListError::DuplicateMember.into());
    }
    let key = keyring.get(latest.epoch)?.clone();
    let nb = latest.notebook_id;
    let member = Member::new(&join.device, join.role, &join.display_name, &key, &nb, rng);
    let list = latest.successor(keyring, &key, rng, |ms| ms.push(member))?;
    let list_env = checked(chain, &list, signer)?;
    let wrap = wrap_keyring(signer, nb, &join.device, keyring, rng)?;
    Ok((list_env, wrap))
}

/// Removes `device`: generates the next epoch key (added to `keyring`), re-seals every name under it, and wraps the
/// new keyring for every remaining device except the signer. Publish the list first, then the wraps.
pub fn remove_member(
    chain: &MemberChain,
    signer: &DeviceKeys,
    keyring: &mut Keyring,
    device: &DeviceId,
    rng: &mut impl CryptoRngCore,
) -> Result<(Envelope, Vec<Envelope>), SyncError> {
    let latest = chain.latest();
    if latest.member(device).is_none() {
        return Err(SyncError::NotMember);
    }
    let new_key = NotebookKey::generate(latest.epoch + 1, rng);
    let list = latest.successor(keyring, &new_key, rng, |ms| {
        ms.retain(|m| m.device_id != *device)
    })?;
    let list_env = checked(chain, &list, signer)?;
    let mut ring = keyring.clone();
    ring.insert(new_key);
    let me = signer.device_id();
    let wraps = list
        .members
        .iter()
        .filter(|m| m.device_id != me)
        .map(|m| wrap_keyring(signer, list.notebook_id, &m.public(), &ring, rng))
        .collect::<Result<Vec<_>, _>>()?;
    *keyring = ring;
    Ok((list_env, wraps))
}

/// Changes a member's role (e.g. promote to co-owner so the notebook is never orphaned). Same epoch.
pub fn set_role(
    chain: &MemberChain,
    signer: &DeviceKeys,
    keyring: &Keyring,
    device: &DeviceId,
    role: Role,
    rng: &mut impl CryptoRngCore,
) -> Result<Envelope, SyncError> {
    let latest = chain.latest();
    if latest.member(device).is_none() {
        return Err(SyncError::NotMember);
    }
    let key = keyring.get(latest.epoch)?.clone();
    let list = latest.successor(keyring, &key, rng, |ms| {
        for m in ms.iter_mut().filter(|m| m.device_id == *device) {
            m.role = role;
        }
    })?;
    checked(chain, &list, signer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keywrap::unwrap_keyring;
    use rand_core::OsRng;

    struct Fx {
        nb: NotebookId,
        owner: DeviceKeys,
        ring: Keyring,
        chain: MemberChain,
        genesis: Envelope,
    }

    fn fx() -> Fx {
        let owner = DeviceKeys::generate(&mut OsRng);
        let nb = NotebookId::random(&mut OsRng);
        let (ring, chain, genesis) = create_share(&owner, nb, "Ana", &mut OsRng);
        Fx {
            nb,
            owner,
            ring,
            chain,
            genesis,
        }
    }

    fn join(dev: &DeviceKeys, role: Role, name: &str) -> JoinRequest {
        JoinRequest {
            device: dev.public(),
            display_name: name.into(),
            role,
            invite_id: DocId([7; 16]),
        }
    }

    /// Admits a fresh device with `role`, returning its keys.
    fn add(f: &mut Fx, role: Role) -> DeviceKeys {
        let dev = DeviceKeys::generate(&mut OsRng);
        let (list, _wrap) = admit(
            &f.chain,
            &f.owner,
            &f.ring,
            &join(&dev, role, "Ben"),
            &mut OsRng,
        )
        .unwrap();
        f.chain.apply(&list).unwrap();
        dev
    }

    /// Signs an arbitrary successor (bypassing the flow helpers) to test the validator itself.
    fn successor_env(f: &Fx, signer: &DeviceKeys, edit: impl FnOnce(&mut MemberList)) -> Envelope {
        let mut l = f.chain.latest().clone();
        l.version += 1;
        edit(&mut l);
        l.to_envelope(signer)
    }

    #[test]
    fn genesis_is_valid_and_names_are_encrypted() {
        let f = fx();
        let list = MemberList::validate_genesis(&f.genesis).unwrap();
        assert_eq!(list.version, 1);
        assert_eq!(list.role_of(&f.owner.device_id()), Some(Role::Owner));
        assert_eq!(
            list.display_name(&f.ring, &f.owner.device_id()).unwrap(),
            "Ana"
        );
        assert!(
            !f.genesis.payload.windows(3).any(|w| w == b"Ana"),
            "the relay never sees names"
        );
        let wrong = Keyring::new(NotebookKey::generate(0, &mut OsRng));
        assert_eq!(
            list.display_name(&wrong, &f.owner.device_id()),
            Err(SyncError::Decrypt)
        );
    }

    #[test]
    fn genesis_rules() {
        let f = fx();
        let other = DeviceKeys::generate(&mut OsRng);
        // Signed by a device that is not in the list.
        let list = MemberList::from_envelope(&f.genesis).unwrap();
        assert_eq!(
            MemberList::validate_genesis(&list.to_envelope(&other)),
            Err(MemberListError::GenesisSignerNotOwner.into())
        );
        // Version must be 1, epoch 0.
        let mut v2 = list.clone();
        v2.version = 2;
        assert_eq!(
            MemberList::validate_genesis(&v2.to_envelope(&f.owner)),
            Err(MemberListError::BadGenesis.into())
        );
        // Signer listed, but not as Owner.
        let mut ed = list.clone();
        ed.members[0].role = Role::Edit;
        ed.members.push(Member::new(
            &other.public(),
            Role::Owner,
            "x",
            f.ring.get(0).unwrap(),
            &f.nb,
            &mut OsRng,
        ));
        assert_eq!(
            MemberList::validate_genesis(&ed.to_envelope(&f.owner)),
            Err(MemberListError::GenesisSignerNotOwner.into())
        );
        // Tampered signature.
        let mut t = f.genesis.clone();
        t.signature[0] ^= 1;
        assert_eq!(
            MemberList::validate_genesis(&t),
            Err(SyncError::BadSignature)
        );
        // Header epoch disagrees with the payload.
        let mut h = f.genesis.clone();
        h.epoch = 1;
        assert_eq!(
            MemberList::validate_genesis(&h),
            Err(MemberListError::HeaderMismatch.into())
        );
    }

    #[test]
    fn admit_adds_member_and_wraps_keyring() {
        let mut f = fx();
        let ben = DeviceKeys::generate(&mut OsRng);
        let (list, wrap) = admit(
            &f.chain,
            &f.owner,
            &f.ring,
            &join(&ben, Role::Edit, "Ben"),
            &mut OsRng,
        )
        .unwrap();
        let l = f.chain.apply(&list).unwrap().clone();
        assert_eq!(l.version, 2);
        assert_eq!(l.epoch, 0);
        assert_eq!(l.role_of(&ben.device_id()), Some(Role::Edit));
        let ring = unwrap_keyring(&wrap, &ben, &f.chain).unwrap();
        assert_eq!(
            ring.get(0).unwrap().expose_secret(),
            f.ring.get(0).unwrap().expose_secret()
        );
        assert_eq!(l.display_name(&ring, &ben.device_id()).unwrap(), "Ben");
        // Admitting twice is refused.
        assert_eq!(
            admit(
                &f.chain,
                &f.owner,
                &f.ring,
                &join(&ben, Role::Edit, "Ben"),
                &mut OsRng
            )
            .unwrap_err(),
            MemberListError::DuplicateMember.into()
        );
    }

    #[test]
    fn rollback_and_replay_are_refused() {
        let mut f = fx();
        add(&mut f, Role::Edit);
        let v2 = f.chain.latest().clone();
        add(&mut f, Role::Read);
        // Re-sending the old v2 (replay) is a no-op for the chain, but as a successor of v3 it is a rollback.
        let replay = v2.to_envelope(&f.owner);
        assert!(f.chain.apply(&replay).is_ok());
        assert_eq!(f.chain.latest().version, 3);
        assert_eq!(
            f.chain.latest().validate_next(&replay),
            Err(MemberListError::VersionNotIncreasing { prev: 3, got: 2 }.into())
        );
        // A *different* list claiming an old version is refused.
        let mut forged = v2.clone();
        forged.members.truncate(1);
        forged.epoch = 1;
        assert!(f.chain.apply(&forged.to_envelope(&f.owner)).is_err());
        // Same version again (fork) is refused.
        let same = successor_env(&f, &f.owner, |l| l.version -= 1);
        assert!(matches!(
            f.chain.latest().validate_next(&same),
            Err(SyncError::MemberList(
                MemberListError::VersionNotIncreasing { .. }
            ))
        ));
    }

    #[test]
    fn signer_must_be_owner_or_coowner_of_previous_version() {
        let mut f = fx();
        let editor = add(&mut f, Role::Edit);
        let reader = add(&mut f, Role::Read);
        let outsider = DeviceKeys::generate(&mut OsRng);
        for (who, expect) in [
            (&editor, SyncError::from(MemberListError::SignerNotOwner)),
            (&reader, MemberListError::SignerNotOwner.into()),
            (&outsider, SyncError::NotMember),
        ] {
            let env = successor_env(&f, who, |l| l.members[1].role = Role::Owner);
            assert_eq!(f.chain.latest().validate_next(&env), Err(expect));
        }
        // An editor that lists itself as owner in the *new* version is still judged by the previous version.
        let env = successor_env(&f, &editor, |l| {
            for m in &mut l.members {
                m.role = Role::Owner;
            }
        });
        assert_eq!(
            f.chain.latest().validate_next(&env),
            Err(MemberListError::SignerNotOwner.into())
        );
        // Tampered member list (signature over other bytes).
        let mut t = successor_env(&f, &f.owner, |_| {});
        t.payload[3] ^= 1;
        assert!(f.chain.latest().validate_next(&t).is_err());
    }

    #[test]
    fn last_owner_removal_refused() {
        let mut f = fx();
        add(&mut f, Role::Edit);
        let me = f.owner.device_id();
        let mut ring = f.ring.clone();
        assert_eq!(
            remove_member(&f.chain, &f.owner, &mut ring, &me, &mut OsRng).unwrap_err(),
            MemberListError::NoOwnerLeft.into()
        );
        assert_eq!(
            ring.current().unwrap().epoch(),
            0,
            "keyring untouched on failure"
        );
        // Demoting the only owner is refused too.
        assert_eq!(
            set_role(&f.chain, &f.owner, &f.ring, &me, Role::Edit, &mut OsRng).unwrap_err(),
            MemberListError::NoOwnerLeft.into()
        );
        // With a co-owner present the owner may leave.
        let co = add(&mut f, Role::CoOwner);
        let mut ring = f.ring.clone();
        let (env, wraps) = remove_member(&f.chain, &f.owner, &mut ring, &me, &mut OsRng).unwrap();
        let l = f.chain.apply(&env).unwrap();
        assert_eq!(l.role_of(&co.device_id()), Some(Role::CoOwner));
        assert_eq!(wraps.len(), 2);
    }

    #[test]
    fn removal_requires_rotation_and_epoch_steps_by_one() {
        let mut f = fx();
        let ben = add(&mut f, Role::Edit);
        let no_rotation = successor_env(&f, &f.owner, |l| {
            l.members.retain(|m| m.device_id != ben.device_id())
        });
        assert_eq!(
            f.chain.latest().validate_next(&no_rotation),
            Err(MemberListError::RemovalWithoutRotation.into())
        );
        let jump = successor_env(&f, &f.owner, |l| l.epoch = 2);
        assert_eq!(
            f.chain.latest().validate_next(&jump),
            Err(MemberListError::BadEpoch { prev: 0, got: 2 }.into())
        );
        // Voluntary rotation without removal is fine.
        let rotate = successor_env(&f, &f.owner, |l| l.epoch = 1);
        assert!(f.chain.latest().validate_next(&rotate).is_ok());
    }

    #[test]
    fn structure_rules() {
        let mut f = fx();
        let ben = add(&mut f, Role::Edit);
        let dup = successor_env(&f, &f.owner, |l| {
            let m = l.members[1].clone();
            l.members.push(m)
        });
        assert_eq!(
            f.chain.latest().validate_next(&dup),
            Err(MemberListError::DuplicateMember.into())
        );
        let mismatch = successor_env(&f, &f.owner, |l| {
            l.members[1].device_id = f.owner.device_id()
        });
        assert_eq!(
            f.chain.latest().validate_next(&mismatch),
            Err(MemberListError::DeviceIdMismatch.into())
        );
        let _ = ben;
        let too_many = successor_env(&f, &f.owner, |l| {
            let m = l.members[1].clone();
            for _ in 0..MAX_MEMBERS {
                let k = DeviceKeys::generate(&mut OsRng);
                let mut n = m.clone();
                n.signing_pub = k.signing_public();
                n.device_id = k.device_id();
                l.members.push(n);
            }
        });
        assert_eq!(
            f.chain.latest().validate_next(&too_many),
            Err(MemberListError::TooManyMembers(MAX_MEMBERS).into())
        );
    }

    #[test]
    fn coowner_limits() {
        let mut f = fx();
        let co = add(&mut f, Role::CoOwner);
        let ed = add(&mut f, Role::Edit);
        let owner_id = f.owner.device_id();
        // May admit and remove non-owners.
        let mut ring = f.ring.clone();
        let (env, _) =
            remove_member(&f.chain, &co, &mut ring, &ed.device_id(), &mut OsRng).unwrap();
        let mut chain = f.chain.clone();
        chain.apply(&env).unwrap();
        // May not remove, demote or create an owner.
        let mut ring = f.ring.clone();
        assert_eq!(
            remove_member(&f.chain, &co, &mut ring, &owner_id, &mut OsRng).unwrap_err(),
            MemberListError::CoOwnerMayNotChangeOwner.into()
        );
        assert_eq!(
            set_role(&f.chain, &co, &f.ring, &owner_id, Role::Edit, &mut OsRng).unwrap_err(),
            MemberListError::CoOwnerMayNotChangeOwner.into()
        );
        assert_eq!(
            set_role(
                &f.chain,
                &co,
                &f.ring,
                &ed.device_id(),
                Role::Owner,
                &mut OsRng
            )
            .unwrap_err(),
            MemberListError::CoOwnerMayNotChangeOwner.into()
        );
        // The owner may promote.
        let env = set_role(
            &f.chain,
            &f.owner,
            &f.ring,
            &ed.device_id(),
            Role::CoOwner,
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(
            f.chain.apply(&env).unwrap().role_of(&ed.device_id()),
            Some(Role::CoOwner)
        );
    }

    #[test]
    fn remove_rotates_reseals_names_and_excludes_removed_device() {
        let mut f = fx();
        let ben = add(&mut f, Role::Edit);
        let cleo = add(&mut f, Role::Edit);
        let mut ring = f.ring.clone();
        let (env, wraps) =
            remove_member(&f.chain, &f.owner, &mut ring, &cleo.device_id(), &mut OsRng).unwrap();
        let l = f.chain.apply(&env).unwrap().clone();
        assert_eq!(l.epoch, 1);
        assert_eq!(ring.current().unwrap().epoch(), 1);
        assert!(l.member(&cleo.device_id()).is_none());
        assert_eq!(wraps.len(), 1, "only Ben (the owner keeps its own keyring)");
        let bring = unwrap_keyring(&wraps[0], &ben, &f.chain).unwrap();
        assert_eq!(bring.epochs().collect::<Vec<_>>(), vec![0, 1]);
        assert_eq!(l.display_name(&bring, &ben.device_id()).unwrap(), "Ben");
        // The old key cannot read the new names.
        assert_eq!(
            l.display_name(
                &Keyring::new(f.ring.get(0).unwrap().clone()),
                &ben.device_id()
            ),
            Err(SyncError::MissingEpochKey(1))
        );
        // Cleo cannot unwrap anything addressed to Ben.
        assert!(unwrap_keyring(&wraps[0], &cleo, &f.chain).is_err());
        assert_eq!(
            remove_member(&f.chain, &f.owner, &mut ring, &cleo.device_id(), &mut OsRng)
                .unwrap_err(),
            SyncError::NotMember
        );
    }

    #[test]
    fn authorize_rules() {
        let mut f = fx();
        let ed = add(&mut f, Role::Edit);
        let rd = add(&mut f, Role::Read);
        let outsider = DeviceKeys::generate(&mut OsRng);
        let key = f.ring.get(0).unwrap().clone();
        let doc = DocId::random(&mut OsRng);
        let seal = |k: &DeviceKeys, kind: Kind| {
            Envelope::seal(k, &key, f.nb, doc, kind, 0, b"x", &mut OsRng).unwrap()
        };
        assert_eq!(f.chain.authorize(&seal(&ed, Kind::Update)), Ok(Role::Edit));
        assert_eq!(
            f.chain.authorize(&seal(&f.owner, Kind::Snapshot)),
            Ok(Role::Owner)
        );
        for kind in [Kind::Update, Kind::Snapshot, Kind::Blob] {
            assert_eq!(
                f.chain.authorize(&seal(&rd, kind)),
                Err(SyncError::Forbidden {
                    role: Role::Read,
                    kind
                }),
                "read-only member sending {kind:?}"
            );
        }
        assert_eq!(
            f.chain.authorize(&seal(&rd, Kind::Presence)),
            Ok(Role::Read)
        );
        assert_eq!(
            f.chain.authorize(&seal(&outsider, Kind::Update)),
            Err(SyncError::NotMember)
        );
        // An editor may not sign member lists or key wraps.
        let l = successor_env(&f, &ed, |_| {});
        assert_eq!(
            f.chain.latest().authorize(&l),
            Err(SyncError::Forbidden {
                role: Role::Edit,
                kind: Kind::MemberList
            })
        );
        // Tampered signature / ciphertext.
        let mut t = seal(&ed, Kind::Update);
        t.payload[0] ^= 1;
        assert_eq!(f.chain.authorize(&t), Err(SyncError::BadSignature));
        // Another notebook.
        let other = Envelope::seal(
            &ed,
            &key,
            NotebookId::random(&mut OsRng),
            doc,
            Kind::Update,
            0,
            b"x",
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(f.chain.authorize(&other), Err(SyncError::WrongNotebook));
        // A future epoch.
        let future = Envelope::seal(
            &ed,
            &NotebookKey::generate(1, &mut OsRng),
            f.nb,
            doc,
            Kind::Update,
            0,
            b"x",
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(
            f.chain.authorize(&future),
            Err(SyncError::WrongEpoch { got: 1, current: 0 })
        );
    }

    #[test]
    fn removed_device_is_refused_live_but_its_history_stays_valid() {
        let mut f = fx();
        let cleo = add(&mut f, Role::Edit);
        let key0 = f.ring.get(0).unwrap().clone();
        let doc = DocId::random(&mut OsRng);
        let before = Envelope::seal(
            &cleo,
            &key0,
            f.nb,
            doc,
            Kind::Update,
            0,
            b"before",
            &mut OsRng,
        )
        .unwrap();
        let mut ring = f.ring.clone();
        let (env, _) =
            remove_member(&f.chain, &f.owner, &mut ring, &cleo.device_id(), &mut OsRng).unwrap();
        f.chain.apply(&env).unwrap();
        // Cleo keeps editing offline with the old key: refused live.
        let offline = Envelope::seal(
            &cleo,
            &key0,
            f.nb,
            doc,
            Kind::Update,
            0,
            b"after",
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(f.chain.authorize(&offline), Err(SyncError::NotMember));
        assert_eq!(f.chain.authorize(&before), Err(SyncError::NotMember));
        // Her earlier, relay-accepted updates are still valid history.
        assert_eq!(f.chain.authorize_historic(&before), Ok(Role::Edit));
        assert!(f.chain.was_member(&cleo.device_id()));
        // History under epoch 1 from her is impossible: she was never in an epoch-1 list.
        let forged = Envelope::seal(
            &cleo,
            ring.get(1).unwrap(),
            f.nb,
            doc,
            Kind::Update,
            0,
            b"x",
            &mut OsRng,
        )
        .unwrap();
        assert_eq!(
            f.chain.authorize_historic(&forged),
            Err(SyncError::NotMember)
        );
    }

    #[test]
    fn chain_from_envelopes() {
        let mut f = fx();
        let mut envs = vec![f.genesis.clone()];
        for role in [Role::Edit, Role::Read] {
            let dev = DeviceKeys::generate(&mut OsRng);
            let (l, _) = admit(
                &f.chain,
                &f.owner,
                &f.ring,
                &join(&dev, role, "x"),
                &mut OsRng,
            )
            .unwrap();
            f.chain.apply(&l).unwrap();
            envs.push(l);
        }
        let c = MemberChain::from_envelopes(&envs).unwrap();
        assert_eq!(c.latest(), f.chain.latest());
        assert!(
            MemberChain::from_envelopes(&envs[1..]).is_err(),
            "must start at the genesis"
        );
        assert!(MemberChain::from_envelopes(&[]).is_err());
    }

    #[test]
    fn names_are_cut_at_256_bytes() {
        let f = fx();
        let long = "ä".repeat(200);
        let id = f.owner.device_id();
        let s = SealedName::seal(f.ring.get(0).unwrap(), &f.nb, &id, &long, &mut OsRng);
        let back = s.open(f.ring.get(0).unwrap(), &f.nb, &id).unwrap();
        assert_eq!(back.len(), 256);
        // Bound to the device: moving a sealed name to another member fails.
        assert_eq!(
            s.open(f.ring.get(0).unwrap(), &f.nb, &DeviceId([1; 32])),
            Err(SyncError::Decrypt)
        );
    }
}
