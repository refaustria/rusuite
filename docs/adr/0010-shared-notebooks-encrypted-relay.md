# ADR 0010 – Shared notebooks (Rusuite Notes) via an end-to-end encrypted relay

- Status: accepted (owner decision 2026-11-12: shared notes must update instantly with visible editors; transport =
  encrypted relay on rusuit.es, "fürs erste")
- Date: 2026-11-13
- Amends: ADR 0009 (for Rusuite Notes only); README non-goal "real-time co-authoring"
- Design: `docs/superpowers/specs/2026-11-12-notes-design.md`, protocol: `docs/notes-sync-protocol.md`

## Context
ADR 0009 guarantees that documents never leave the device. OneNote-style shared notebooks need edits to travel
between people in real time, including to people who are offline at the moment of the edit. Peer-to-peer
(WebRTC) only works while peers are online together; the user's own cloud (WebDAV) means polling and is desktop-only
under the strict web CSP. Both fail the owner's "instant" requirement.

## Decision
1. **Unshared notebooks keep ADR 0009 unchanged.** They live only on the device (web: IndexedDB of the origin,
   desktop: a folder the user chose) and never contact any server. The e2e request audit proves it.
2. **Shared notebooks leave the device only as ciphertext.** Every CRDT update, snapshot, attachment and presence
   message is encrypted on the device (XChaCha20-Poly1305 with the notebook's epoch key) and signed with the author
   device's Ed25519 key. Display names are encrypted too. Keys exist only on member devices; invitation secrets travel
   only in the URL fragment, which browsers never send to the server.
3. **One server component:** `services/notes-relay` behind `https://rusuit.es/api/notes/` (same origin, so the web
   CSP stays `connect-src 'self'`). It stores and forwards envelopes, verifies signatures and membership without
   decrypting, enforces quotas and rate limits, and deletes everything of a notebook on "Stop sharing" or after 12
   months of inactivity. It stores no IP addresses, names or plaintext. What it can see: notebook and doc ids,
   envelope sizes and timing, device public keys and the number of members.
4. **Membership** is an owner-signed member list (owner / co-owner / edit / read-only). Removing a member rotates the
   notebook key; the removed device receives nothing newer.
5. **Self-hosting:** the relay is one binary; desktop apps accept a custom relay URL. The web app uses only its own
   origin.
6. **Scope:** Write, Calc and Show stay single-writer (ADR 0007 unchanged). The README non-goal reads "real-time
   co-authoring (except shared notebooks in Rusuite Notes, ADR 0010)".

## Verification
- `packages/e2e`: request audit for Notes – no traffic at all for unshared notebooks; with a shared notebook only
  `/api/notes/` (WebSocket) besides static assets and `/version.json`.
- Relay tests: storage directory contains no plaintext marker after a session; tampered/non-member/revoked envelopes
  rejected.
- `scripts/privacy-check.sh`: the Notes relay client is the only allowed `WebSocket` user.

## Consequences
- The privacy statement in the portal and backstage gets a Notes paragraph ("shared notebooks are end-to-end
  encrypted; the server cannot read them").
- Losing all devices of all owners/co-owners means the notebook can no longer be administered (members keep their
  copies); the UI recommends adding a co-owner.
