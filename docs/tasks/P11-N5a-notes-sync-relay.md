# Task P11-N5a – `notes-sync` (crypto, membership, wire protocol) + `services/notes-relay`

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec `docs/superpowers/specs/2026-11-12-notes-design.md`
(section 4, esp. 4.3 membership and 4.4 relay), `docs/notes-spike-report.md` (crypto numbers, relay behaviour, the
"container does not exist" pitfall), the spike relay/crypto on branch `p11/n0-loro-spike`
(`spikes/notes-loro/relay.mjs`, `spikes/notes-loro/rust/`), `services/report-relay` (axum style, config, tests,
systemd/nginx files under `deploy/`), ADR 0009.

Branch `p11/n5a-notes-sync`, worktree `/home/bojan/rusuite-wt/p11-n5a-notes-sync`. Model: Opus. Port 5120.
Independent of P11-N1 (running in parallel): work with opaque update bytes + doc ids; do not depend on `model-notes`.

## `crates/notes-sync` (wasm-compatible, `#![forbid(unsafe_code)]`, RustCrypto only)
Libraries (PM decision): `chacha20poly1305` (XChaCha20-Poly1305), `ed25519-dalek` 2 (device signing keys),
`x25519-dalek` 2 (key agreement for key wraps), `hkdf` + `sha2`, `rand_core` with `getrandom` (`js` feature on wasm),
serialization `postcard` or CBOR (`ciborium`) – pick one, justify in the report. Zeroize secrets.
1. **Device identity:** `DeviceKeys { signing: Ed25519, agreement: X25519 }`, generate/serialize/restore;
   `DeviceId` = hash of the signing public key.
2. **Notebook keys with epochs:** symmetric `NotebookKey` per epoch (32 B); epoch increments on member removal.
3. **Envelope** (one per Loro update/snapshot/blob/presence message):
   `{ notebook_id, doc_id, epoch, kind: Update|Snapshot|Blob|Presence|MemberList|KeyWrap|JoinRequest, author: DeviceId,
   nonce(24), ciphertext, signature(Ed25519 over all preceding fields) }`. AAD binds notebook_id/doc_id/epoch/kind/
   author. The relay can verify signatures and membership **without** decrypting.
4. **Member list:** versioned, owner-signed (co-owners may sign too): entries `{device_id, signing_pub, agreement_pub,
   role: Owner|CoOwner|Edit|Read, display_name_ciphertext}` – display names are encrypted with the notebook key (relay
   never sees names). Validation rules: version strictly increasing, signer is Owner/CoOwner of the previous version,
   at least one Owner/CoOwner remains.
5. **Invite / admit:** invite link fragment carries `{notebook_id, invite_secret, role, relay_hint}`. Invitee sends a
   `JoinRequest` (its public keys + encrypted display name) sealed with a key derived from `invite_secret` (HKDF) so the
   relay cannot read or forge it; an Owner/CoOwner device admits it: new member-list version + `KeyWrap` of the current
   epoch key for that device (X25519 ECDH + HKDF + XChaCha). Invites are single-use by default, with expiry (7 days);
   "reusable invite" option for "share with my own devices"? – no: own devices use the same single-use flow (owner
   decision "share with yourself").
6. **Remove:** new epoch key, wrap for each remaining device, new member list without the removed device; the relay
   rejects envelopes from devices not in the latest list, and envelopes with an old epoch after a grace window
   (offline edits made before the removal by *remaining* members must still be accepted: they re-encrypt queued updates
   with the new epoch on reconnect – provide `reencrypt` helper). **Review focus 4** ("revoked device keeps editing
   offline → rejected, visible on its device, never applied for others") is owned here: test it end to end.
7. **Presence:** small encrypted ephemeral envelope (cursor/selection/page/name colour) – never stored by the relay.

## `services/notes-relay` (axum 0.8 + tokio, WebSocket, same style as `report-relay`)
- Endpoint `GET /api/notes/ws` (WebSocket, binary frames). Client subscribes to `notebook_id` + doc ids with "have"
  version markers (the relay's own per-doc sequence numbers); relay sends missing envelopes, then live ones.
- Storage on disk (configurable dir): per notebook: member lists, key wraps, per doc append-only envelope log with
  sequence numbers, latest snapshot envelope (a client-uploaded `Snapshot` lets the relay drop log entries older than
  the snapshot's sequence marker), blobs by hash. **Never** decrypts; stores no IP addresses or names.
- Checks: signature valid; author is member with Edit/Owner/CoOwner for updates, any member for presence; member-list
  chain valid; first member list of a new notebook creates it (owner = signer).
- Limits (configurable, defaults documented): 200 MB per notebook, 25 MB per blob, 50 msgs/s per connection, max
  envelope 1 MB, notebooks inactive for 12 months deleted; `DELETE` = owner-signed "stop sharing" removes everything.
- Health endpoint, structured logs without content, graceful shutdown; `deploy/notes-relay.service` (systemd) and an
  nginx snippet `deploy/nginx/notes-relay.conf` (location `/api/notes/` with WebSocket upgrade, proxy to
  `127.0.0.1:8732` – choose a free port, document it) – the PM applies them on the server.
- `docs/notes-sync-protocol.md`: message formats, flows (create share, invite, admit, remove, reconnect/catch-up,
  compaction, stop sharing), threat model (what the server sees: notebook ids, doc ids, sizes, timing, device public
  keys, member count).

## Tests
Unit tests for every crypto/membership rule (tampered ciphertext/signature/AAD, wrong epoch, non-member, read-only
member sending update, member-list rollback, last owner removal refused); wasm check of `notes-sync`; relay
integration tests with real WebSocket clients on port 5120: two clients converge on opaque payloads, late joiner
catch-up, snapshot truncation, quota/rate-limit errors, revoked device rejected, stop sharing; a test that greps the
relay's storage dir after a session for any plaintext marker string → none.

## In scope
`crates/notes-sync/**`, `services/notes-relay/**`, `deploy/notes-relay.service`, `deploy/nginx/notes-relay.conf`,
workspace `Cargo.toml`/`Cargo.lock`, `.github/workflows/ci.yml` (wasm check list only), `docs/notes-sync-protocol.md`.

## Report (≤ 50 lines): protocol summary, library versions, threat-model notes, deploy steps for the PM.
