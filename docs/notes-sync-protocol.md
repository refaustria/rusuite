# Rusuite Notes – sync protocol, membership and relay (P11-N5a)

Implements spec `docs/superpowers/specs/2026-11-12-notes-design.md` section 4.3 (sharing, identity, membership) and
4.4 (relay). Code: `crates/notes-sync` (crypto, membership, wire types; native and `wasm32-unknown-unknown`) and
`services/notes-relay` (axum 0.8 + tokio). The CRDT payloads (Loro updates/snapshots) are opaque bytes here.

## 1. Primitives

| Purpose | Choice (RustCrypto, identical native/WASM) |
| --- | --- |
| Device signing | Ed25519 (`ed25519-dalek` 2.2, strict verification, weak keys refused) |
| Key agreement for key wraps | X25519 (`x25519-dalek` 2.0, ephemeral–static, non-contributory results refused) |
| Symmetric encryption | XChaCha20-Poly1305 (`chacha20poly1305` 0.10, random 24-byte nonces) |
| Key derivation | HKDF-SHA-256 (`hkdf` 0.12, `sha2` 0.10), every use with its own label |
| Randomness | `rand_core` 0.6 `OsRng` → `getrandom` 0.2 (`js` backend in the browser) |
| Structured encoding | `postcard` 1.1 (serde, compact, deterministic, `no_std`, no trailing bytes accepted) |

Secrets (`DeviceKeys`, `NotebookKey`, invite secrets, wrap keys, decrypted keyrings) are zeroized on drop and never
printed by `Debug`. The crate has no clock, threads or file system: callers pass `now`.

## 2. Identities and keys

- **Device**: `DeviceKeys { signing: Ed25519, agreement: X25519 }`, generated once per device and stored locally
  (`DeviceKeys::to_bytes`, 69 bytes: `"RNDK" ‖ 1 ‖ sk_ed ‖ sk_x`). `DeviceId = SHA-256("rusuite-notes/device-id/v1" ‖
  Ed25519 public key)`.
- **Notebook**: random 16-byte `NotebookId`; docs (notebook doc, pages), blobs and invites have 16-byte `DocId`s.
  `DocId::NOTEBOOK` (all zero) is used by notebook-level envelopes.
- **Notebook key**: 32 random bytes per **epoch** (starts at 0, +1 on every member removal). Used only through
  HKDF subkeys: `HKDF(salt "rusuite-notes/notebook-key/v1", ikm key, info label ‖ epoch)` with labels `content` and
  `name`. A device keeps a `Keyring` (all epochs it knows); new members receive the whole keyring so they can read
  history from before they joined.

## 3. Envelope

One envelope per Loro update, snapshot, blob, presence message, member list, key wrap or join request. Wire layout
(big-endian, 170 bytes + payload):

```
version=1 (1) ‖ notebook_id (16) ‖ doc_id (16) ‖ epoch (4) ‖ kind (1) ‖ author DeviceId (32) ‖ covers (8) ‖
nonce (24) ‖ payload_len (4) ‖ payload ‖ signature (64)
```

- `kind`: 1 Update, 2 Snapshot, 3 Blob, 4 Presence, 5 MemberList, 6 KeyWrap, 7 JoinRequest.
- `covers`: snapshots only – the doc's relay sequence number the snapshot includes; must be 0 otherwise.
- **Signature**: Ed25519 by the author over `"rusuite-notes/envelope/v1" ‖` all preceding bytes. Anyone holding the
  member list (the relay included) can verify it without any key material.
- **Content kinds** (Update, Snapshot, Blob, Presence): `payload = XChaCha20-Poly1305(content key of epoch, nonce,
  plaintext, AAD)`, `AAD = "rusuite-notes/aad/v1" ‖ notebook_id ‖ doc_id ‖ epoch ‖ kind ‖ author ‖ covers`. Moving a
  ciphertext to another notebook/doc/epoch/kind/author fails authentication even if re-signed.
- **MemberList**: payload = postcard `MemberList` (public keys and roles in clear, names encrypted), nonce all zero.
- **KeyWrap**: payload = postcard `{recipient DeviceId, ephemeral_pub, ciphertext}` (section 5).
- **JoinRequest**: payload = postcard `{signing_pub, sealed}`; `doc_id` = invite id (section 6).
- Blob ids: chosen by the client (random or a keyed hash of the content; never the plain SHA-256, which would let
  the server confirm guesses). The relay stores blobs by this id, first write wins.

Clients verify before applying: `MemberChain::authorize` for live envelopes (author in the **latest** list, role
allows the kind, signature valid, epoch not newer than the list's) and `MemberChain::authorize_historic` for
catch-up (author allowed in some list version of the envelope's epoch), then `Envelope::open(keyring)`.

## 4. Membership

`MemberList { notebook_id, version u64, epoch u32, members: [{device_id, signing_pub, agreement_pub, role,
display_name: {nonce, ciphertext}}] }`. Roles: `Owner`, `CoOwner`, `Edit`, `Read`. Display names are encrypted with
the list epoch's `name` subkey, AAD `"rusuite-notes/name/v1" ‖ notebook_id ‖ device_id` (cut at 256 bytes).

The envelope signature is the owner signature. Rules (enforced by clients and the relay):

1. The genesis list has version 1, epoch 0 and is signed by a device listed in it as `Owner`; it creates the
   notebook on the relay.
2. Each later version is strictly greater than the previous (no rollback, no replay, no fork) and signed by an
   `Owner`/`CoOwner` **of the previous version**.
3. At least one `Owner`/`CoOwner` remains (last-owner removal/demotion refused); device ids match their keys; no
   duplicates; at most 1000 devices.
4. The epoch stays or increases by exactly 1; removing any device requires the increase (key rotation).
5. A `CoOwner` may admit, remove and re-role non-owners, but may not remove, demote or create an `Owner`.

What each role may send: Update/Snapshot/Blob – Owner, CoOwner, Edit; Presence – everyone; MemberList/KeyWrap –
Owner, CoOwner; JoinRequest – non-members only.

## 5. Key wraps

`wrap_keyring(signer, notebook, recipient, keyring)`: ephemeral X25519 key `e`;
`k = HKDF(salt e_pub ‖ recipient_agreement_pub, ikm X25519(e, recipient), info "rusuite-notes/keywrap/v1" ‖
notebook ‖ epoch ‖ recipient_id)`; `ciphertext = XChaCha20-Poly1305(k, nonce, keyring bytes, envelope AAD ‖ recipient
‖ e_pub)`. The envelope's epoch is the keyring's newest epoch; the relay accepts wraps only for the current epoch,
only from owners/co-owners, only for current members. `unwrap_keyring` checks the signer was a manager in a list of
that epoch and that the keyring's newest key is that epoch.

## 6. Flows

**Create share.** `create_share(owner, notebook_id, name)` → keyring (epoch 0), chain, genesis envelope. The owner
publishes the genesis (no subscription needed), then subscribes.

**Invite.** `Invite::create(notebook, role, relay_hint, now)` (role ≠ Owner, expires after 7 days); the owner device
keeps it in `PendingInvites` (persist locally; contains secrets). Link: `https://rusuit.es/notes/#i=<to_fragment>`
(unpadded base64url of `{v, notebook_id, invite_secret 32 B, role, relay_hint, expires_at}`) – the fragment never
reaches a server. From the secret: `invite_id = HKDF(…"invite-id")[..16]` and `seal_key = HKDF(…"join-seal" ‖
notebook)`. "Share with myself" uses the same flow on the second device.

**Join.** The invitee's device subscribes (gets `Pending`), then publishes `join_request(invite, keys, name, now)`:
`doc_id = invite_id`, `payload = {signing_pub, sealed}`, `sealed = XChaCha(seal_key, nonce, {agreement_pub, name},
envelope AAD ‖ signing_pub)`, signed by the new device key. The relay verifies the signature against the carried
key, stores **one** request per invite id (a second gets `InviteUsed`) and forwards it to subscribed managers (and
on their next subscribe, until it expires after 7 days or is consumed).

**Admit.** A manager device: `PendingInvites::open(env, now)` (known invite, not used, not expired, signature,
decryption; marks it used only on success; the role comes from the owner's own record) → `admit(chain, keys,
keyring, join)` → next member list (same epoch) + key wrap of the whole keyring. Publish the list, then the wrap.
The relay tells the invitee's pending connection `Admitted`; it subscribes again as a member and receives the chain
and its wrap. The relay marks the join request consumed (8-byte tombstone, so the invite cannot be reused).

**Remove.** `remove_member(chain, keys, &mut keyring, device)`: new epoch key, every display name re-sealed under
it, next list without the device, a wrap of the new keyring for every remaining device except the signer. Publish
the list, then the wraps. The relay immediately sends `Revoked` to the removed device's open subscriptions and from
then on refuses its envelopes (`NotMember`) and its subscriptions (`Revoked`). The removed device keeps what it had
already synced but never gets the new key.

**Offline edits across a rotation.** Updates made offline by *remaining* members under the old epoch are accepted
during a grace window (default 300 s after the rotation); after it the relay answers `StaleEpoch` and the client
re-encrypts its queued envelopes with `Envelope::reencrypt(keyring, new_key, keys)` (own envelopes only: checks the
author and signature, fresh nonce, new epoch, new signature) and publishes again. A revoked device's offline edits
are refused regardless of epoch, shown as rejected on its device, and never forwarded; other clients would refuse
them even if a relay forwarded them (`MemberChain::authorize` → `NotMember`).

**Change role.** `set_role(chain, keys, keyring, device, role)` (e.g. promote to co-owner so a notebook is not
orphaned). Same epoch.

**Reconnect / catch-up.** On connect the relay sends `Challenge { nonce, protocol }`. The client sends
`Subscribe { notebook_id, signing_pub, proof = Ed25519("rusuite-notes/auth/v1" ‖ nonce ‖ notebook_id), docs:
[{doc_id, seq = last applied}] }`. Members get `Subscribed { member_lists (all versions), key_wraps (theirs),
join_requests (managers only), docs (every doc with its last seq) }`, then per requested doc the missing envelopes as
`Deliver { seq, envelope }` in order and `CaughtUp { doc_id, last }`, then live `Deliver`s. `Subscribe` may be sent
again to add docs. Sequence numbers are the relay's own, per doc, starting at 1.

**Compaction.** A writer uploads a `Snapshot` envelope with `covers = n` (it has applied all entries ≤ n; n ≤ last
seq; n greater than the previous snapshot's). The relay stores it as the doc's snapshot and drops log entries ≤ n.
A client whose marker is below n receives the snapshot as `Deliver { seq: n }` followed by entries > n. Snapshots keep
the full Loro history (spec 9: no shallow snapshots). A snapshot is also accepted when the notebook is over quota if
the result fits (compaction is the way out of a full quota).

**Large documents** (P11-X1). The relay refuses document envelopes over its `envelope_max_bytes` (1 MB by default)
with `TooLarge`. A client therefore sends the updates of one doc as **several `Update` envelopes of at most 512 KiB
each** (the core's `export_update_chunks`: the operations split by per-peer counter ranges, each part a valid Loro
update; members import them in any order – Loro holds a part whose dependencies are missing until they arrive). This
matters for the first share of a large page (e.g. a long pasted text); images are blobs and travel separately. A
compaction snapshot over 512 KiB is not uploaded: the doc keeps its log (catch-up costs more round trips, nothing is
lost).

**Blobs.** `Publish` a `Blob` envelope (≤ 25 MB) with the blob id as `doc_id`; `FetchBlob { notebook_id, blob_id }`
→ `Blob { envelope }` or `BlobMissing`.

**Presence.** `Publish` a `Presence` envelope (cursor/selection/page/colour; any member, `doc_id` = page or
`DocId::NOTEBOOK` for notebook-wide); forwarded to the other members subscribed to that doc, never stored, never
acknowledged.

**Stop sharing.** `StopSharing { notebook_id, signing_pub, issued_at, signature = Ed25519("rusuite-notes/stop-
sharing/v1" ‖ notebook_id ‖ issued_at) }`, over the WebSocket or as the body of `DELETE /api/notes/notebooks/<hex
id>`. Valid ±600 s around the relay's clock, from an `Owner` of the latest list only. The relay deletes the
notebook's directory and sends `Deleted` to every subscriber (HTTP: 204, 403 not an owner, 404 unknown, 400
malformed).

## 7. Wire messages

`GET /api/notes/ws`, binary WebSocket frames, one postcard `ClientMsg`/`RelayMsg` per frame (envelopes embedded as
byte strings). Text frames and undecodable frames get `Error { Malformed }`; the connection stays open.

- Client → relay: `Subscribe`, `Unsubscribe`, `Publish { tag, envelope }`, `FetchBlob`, `StopSharing`.
- Relay → client: `Challenge`, `Subscribed`, `Pending`, `Admitted`, `Revoked`, `Deleted`, `Deliver`, `CaughtUp`,
  `Presence`, `MemberList`, `KeyWrap`, `JoinRequest`, `Blob`, `BlobMissing`, `Accepted { tag, seq }` (seq: the
  update's sequence number, the snapshot's `covers`, the member list's version, 0 otherwise), `Rejected { tag,
  code }`, `Error { code, notebook_id? }`.
- Error codes: `Malformed`, `BadSignature`, `NotMember`, `Forbidden`, `WrongEpoch` (newer than the list),
  `StaleEpoch` (re-encrypt), `MemberList` (a rule in section 4), `NotFound`, `NotSubscribed` (this connection has not
  authenticated as the envelope's author – blocks third-party replays), `TooLarge`, `QuotaExceeded`, `RateLimited`,
  `Outdated` (snapshot covers nothing new), `InviteUsed`, `TooManyRequests` (open join requests), `Internal`.

Publishing requires a member subscription of this connection as the envelope's author (exceptions: the genesis
member list, which creates the notebook; join requests, which need a pending subscription as their author).

## 8. Relay

**Checks (never decrypts):** frame and envelope size; signature against the author's key in the latest member list;
author's role for the kind; epoch (not newer; older only within the grace window); member-list chain rules; key
wraps only for current members and the current epoch; one join request per invite id.

**Storage** (`NOTES_DATA_DIR`, default `/var/lib/rusuite-notes`), one directory per notebook:
`meta.json` (`created_at`, `last_active`, `[epoch, since]`), `members/<version>.env`, `wraps/<epoch>-<device>`,
`joins/<invite id>` (received-at + envelope; 8-byte tombstone once consumed), `docs/<doc>.log` (append-only records
`seq ‖ len ‖ envelope`; a torn tail is cut on load), `docs/<doc>.snap`, `blobs/<blob id>`. No IP addresses, no
names, no plaintext. One mutex serialises storage and fan-out so catch-up and live delivery never overlap or leave
gaps (storage work runs on blocking threads). A connection whose outgoing queue (4096 frames) overflows is dropped;
it reconnects and catches up.

**Limits** (environment, defaults): `NOTES_QUOTA_MB` 200 per notebook (all stored bytes), `NOTES_BLOB_MAX_MB` 25,
`NOTES_ENVELOPE_MAX_KB` 1024 (every non-blob envelope; join requests ≤ 4 KB), `NOTES_RATE_PER_SEC` 50 messages per
connection (token bucket, burst 50; excess → `RateLimited`), `NOTES_INACTIVE_DAYS` 365 (notebooks without publish
or subscribe activity are deleted by the hourly sweep, which also drops join requests older than 7 days),
`NOTES_EPOCH_GRACE_SECS` 300. `NOTES_LISTEN` default `127.0.0.1:8732`.

**Endpoints:** `GET /api/notes/ws`, `GET /api/notes/health` → `{ ok, version, connections }`,
`DELETE /api/notes/notebooks/{id}`. Logs: one line per notable event (`event=create|member-list|reject|stop-sharing|
sweep …`, with kind and error code only) – no ids, names, IPs or content. SIGTERM/Ctrl-C: open WebSockets are closed,
then the server stops.

**Deployment** (PM): `cargo build --release -p notes-relay` → `/usr/local/bin/rusuite-notes-relay`;
`deploy/notes-relay.service` → `/etc/systemd/system/rusuite-notes-relay.service` (DynamicUser, StateDirectory
`/var/lib/rusuite-notes`, hardened), `systemctl daemon-reload && systemctl enable --now rusuite-notes-relay`;
`deploy/nginx/notes-relay.conf` → `/etc/nginx/snippets/rusuite-notes.conf` plus `include
/etc/nginx/snippets/rusuite-notes*.conf;` in the vhost's TLS server block; `nginx -t && systemctl reload nginx`;
check `curl -s https://rusuit.es/api/notes/health`. Port 8732 (8787 is the report relay). Self-hosting: the same
binary and files with another origin; desktop apps accept a custom relay URL (spec 4.4).

## 9. Threat model

**The relay (or anyone with its disk) sees:** notebook ids, doc/blob/invite ids, envelope kinds, sizes and timing,
epochs and their change times, sequence numbers, the authoring device id of every envelope, all devices' public keys
and roles, the member count and how it changes, which device a key wrap is for, and that a join request was made for
some invite id. It also sees connection-level metadata (one connection's subscriptions), but stores no IP addresses
and nginx is configured without access logs for `/api/notes/`.

**It cannot:** read content, presence, blobs, snapshots, display names or the invitee's name/agreement key (all
encrypted); obtain notebook keys (wraps need a member's X25519 secret); forge or alter an envelope, member list, key
wrap or join request (Ed25519 by a device key it does not hold); add a member (needs an owner signature); roll back
the member list (versions strictly increase; clients reject rollbacks); replay a member's envelopes as a third party
(publishing needs an authenticated subscription as the author; Loro dedupes identical updates anyway); learn invite
secrets (link fragments never reach it); reuse an invite (one request per invite id, and the owner's
`PendingInvites` marks it used).

**It can:** withhold, delay or drop messages (availability; clients detect gaps through sequence numbers and resync);
refuse service; delete data (clients keep their local copy and can re-share); see traffic patterns. A malicious relay
colluding with a removed device could *show other clients* that device's old-epoch edits as if they had been
accepted before the removal (clients accept historic envelopes signed under an epoch the author belonged to); it
cannot make those edits readable to the removed device or let it read anything newer.

**Removed devices** keep everything they had already synced (as in the spec) and the old epoch keys; they cannot
decrypt anything encrypted after the rotation, and their new envelopes are refused by the relay and by clients.

**Invites** are bearer secrets until used or expired (7 days): whoever opens the link first gets the request slot.
The owner sees the requester's display name before admitting (admission is an explicit action on an owner/co-owner
device). Share links only over channels you trust.

**Not covered (v1):** metadata hiding (sizes/timing), post-compromise security beyond rotation on removal, device
key compromise of a current member (remove the device), malicious owners, a fully trusted ordering service (the
relay assigns order; CRDT merging makes order irrelevant for convergence).
