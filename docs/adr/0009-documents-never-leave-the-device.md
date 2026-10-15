# ADR 0009 – Documents never leave the device; no cross-browser or server-side document state

- Status: accepted (owner requirement 2026-10-15: "documents shall not be shared cross browsers, otherwise sensitive information may be shared")
- Date: 2026-10-15

## Decision
1. **No server-side document state, ever.** The web deployment serves static files only (ADR 0005). Documents, autosave/recovery copies, recent-file entries and settings live exclusively in the user's own browser profile (IndexedDB/localStorage of the `resuite.inceptum.at` origin) or, on desktop, in the OS user's app-data directory. Nothing is uploaded, synced or shared between browsers, devices or users.
2. **The server enforces it.** nginx sends a `Content-Security-Policy` with `connect-src 'self'` (and no third-party origins anywhere), so even a mistaken fetch cannot reach another host; there are no analytics, fonts or CDNs. The only request the pages make besides their own assets is `/version.json`.
3. **No HTTP clients in the shells.** `app-*` crates must not depend on `reqwest`/`tauri-plugin-http` or similar; a CI grep guards this.
4. **Shared computers.** Because autosave copies persist in the browser, the UI offers "Remove local copies and recent files from this browser" (backstage) and a setting to disable keeping autosave copies in the browser; the portal and backstage state plainly where data is stored.
5. **Future features** that would move documents off the device (sharing, cloud storage, collaboration) need an explicit owner decision and a new ADR; the README non-goal "co-authoring" stands.

## Verification
- `packages/e2e`: a test asserts that loading and using each app issues requests only to the page origin and only for static assets and `/version.json`.
- CI: `scripts/privacy-check.sh` greps app sources for `fetch(`/`XMLHttpRequest`/`WebSocket`/`sendBeacon` outside the allow-list and the shells' `Cargo.toml` for HTTP clients.
