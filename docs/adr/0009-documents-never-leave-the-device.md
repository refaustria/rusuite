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

## Amendment 2026-10-15 – user-owned cloud connectors are allowed
The owner clarified: documents live on the user's local drive **or in the user's own cloud account** (Google Drive, iCloud, OneDrive, Dropbox, …), never on Rusuite infrastructure. Connectors therefore talk **directly from the client to the provider** with the user's own authorization (OAuth PKCE in the browser, native dialogs on desktop), tokens stay in the user's browser/app data, no Rusuite proxy or server component is involved, and the CSP `connect-src` is extended only with the explicit provider API origins the user enabled. Design and plan: `docs/cloud-connectors-plan.md`.


## Amendment 2026-10-16 – cloud connectors v1 (WebDAV) and the web CSP (DECIDED 2026-10-16: desktop only – the web CSP stays `connect-src 'self'`; connectors and the AI assistant are desktop-app features; the website keeps the strict policy)
P8-36 implements the owner's "generic and opt-in" direction: a connection is a WebDAV server URL plus the user's own
credentials, entered by the user and stored only on the device (web: IndexedDB, the password only with "Remember
password on this device"; desktop: the app data directory and the OS keyring). Rusuite offers no cloud service,
registers no provider apps and runs no proxy.

1. **Desktop**: the shells' `connector_*` commands use `app_common::webdav` (reqwest + rustls) behind `app-common`'s
   opt-in `webdav`/`tauri-connectors` features – the only HTTP client in the workspace; the shells' own
   `Cargo.toml`s still have none (Decision 3 holds for them; `scripts/privacy-check.sh` now also refuses HTTP clients
   anywhere but `app-common` and a `webdav` default feature). Requests go only to the configured server: HTTPS
   unless the user allows `http://` for a LAN server, no redirects to other hosts or to plain HTTP.
2. **Web**: `packages/ui-shared/src/connectors/webdav-fetch.ts` is the one allowed `fetch` for documents
   (privacy-check allow-list); it runs only when the user browses, opens or saves through a connection.
3. **The trade-off for the owner**: Decision 2's `connect-src 'self'` makes the browser refuse every user-configured
   server, so on the live site the connections UI detects the block and shows the connection disabled ("This site's
   security policy does not allow connections to other servers"). Enabling WebDAV on the web needs
   `connect-src 'self' https:` (nginx: `set $csp_connect "'self' https:";` – prepared, **not applied**). That widens
   what a hypothetical injected script could contact from "this origin" to "any HTTPS host". It does not change where
   documents go: the code sends them only to a server the user configured, and the e2e request audit
   (`connectors.spec.ts`) proves there is no background traffic – with no connection, only the page's own files and
   `/version.json`; with one, only that host. Per-origin lists are impossible on a static site (the CSP is a server
   header, the connections live in each user's browser). Alternative: keep the CSP and offer connections in the
   desktop apps only (the current state).

## Amendment 2026-10-16 – AI assistant v1 (DECIDED 2026-10-16: desktop only – the web CSP stays `connect-src 'self'`; connectors and the AI assistant are desktop-app features; the website keeps the strict policy for the web CSP)
P8-37 implements the owner's "AI connection via API" direction (`docs/ai-plan.md`) inside the same rules as the cloud
connectors: the user's own provider account and API key, requests **directly from the page / webview to the provider
the user configured**, no Rusuite proxy, no telemetry, nothing in the background.

1. **Opt-in, per action.** AI is off by default (File › Options… › AI). Content leaves the device only when the user
   runs an AI action (or presses Test in the settings): the selection (or the active cell / range / slide) plus a
   one-line description of the document; the whole document only with "Include whole document" (off by default, with
   a size warning). Conversations live in memory for the current document only.
2. **Key on the device only.** Web: `localStorage` of this origin (unencrypted – the settings say so); desktop: the OS
   keyring through the shells' existing secret commands. Never in URLs or logs; "Forget key" deletes it.
3. **One transport.** `packages/ui-shared/src/ai/providers/http.ts` is the only `fetch` of the assistant
   (`scripts/privacy-check.sh` allow-list; the script also rejects any use of it outside the provider adapters):
   `credentials: "omit"`, no referrer, no cache, no redirects. The desktop shells need no new Rust dependency (the
   webview's `fetch` with `csp: null`; Anthropic allows browser calls with `anthropic-dangerous-direct-browser-access`,
   local OpenAI-compatible servers usually allow the app's origin) – Decision 3 holds unchanged.
4. **The web CSP – owner decision.** With the live `connect-src 'self'` the browser refuses the provider; the panel
   detects the `securitypolicyviolation` and says so ("This site's security policy does not allow connections to
   the AI provider…"), and the e2e suite proves no request leaves while AI is disabled or unused. To offer the
   assistant on the web, the narrow option is
   `set $csp_connect "'self' https://api.anthropic.com https://api.openai.com";`
   (i.e. `connect-src 'self' https://api.anthropic.com https://api.openai.com;` – prepared, **not applied**): it adds
   exactly the two hosted providers; local or self-hosted endpoints (Ollama, LM Studio, vLLM) then work in the desktop
   apps only. The connectors' broader `connect-src 'self' https:` (amendment above) would cover the hosted providers
   and any HTTPS endpoint as well; if the owner chooses it for WebDAV, the AI needs no separate change. Either way the
   code contacts only the origin the user configured, and only on an explicit action.


## Decision 2026-10-16 (owner): desktop only

The owner chose option (c): the web CSP stays `connect-src 'self'`. Cloud connectors and the AI assistant are available in the desktop apps only; the web apps hide those entry points and say so ("available in the desktop apps"). ADR 0009's original guarantee for the website is unchanged.
