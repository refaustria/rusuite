# Cloud connectors (user-owned accounts) – design and plan

- Status: **v1 implemented (P8-36, 2026-10-16): generic WebDAV connections**, desktop and web; S3 and the generic
  OAuth connector are next. Earlier: planned (owner 2026-10-15: "nothing on my cloud but rather local drive or custom
  cloud connection (Google, iCloud etc.)")
- Constraint: ADR 0009 – no Rusuite server involvement; client ↔ provider only.

## Design
- `packages/ui-shared`: a `FileProvider` interface behind `Backend`: `{ id, label, icon, isAvailable(), connect(), disconnect(), pick(kinds) -> FileRef | null, read(ref) -> bytes, write(ref | {name, folder}, bytes) -> FileRef, recent(ref) metadata }`. The existing local flows become the `local` provider (browser file input/download or File System Access API; desktop native dialogs). The backstage Open/Save pages show provider tabs ("This device", "Google Drive", …); recent entries remember their provider and `FileRef` so Save goes back to the same place.
- Providers (web and desktop share the implementation; the webview just needs the OAuth redirect to be a page we serve, e.g. `/oauth/callback.html`):
  | Provider | Mechanism | Needs from the owner |
  |---|---|---|
  | Google Drive | OAuth 2.0 PKCE (`drive.file` scope – only files the user picked or we created), Google Picker API for choosing, Drive API v3 `files.get?alt=media` / `files.create|update` (multipart) | a Google Cloud project with an OAuth client ID (type Web) and the Picker API key; authorized origins `https://resuite.inceptum.at` and the desktop redirect |
  | OneDrive / SharePoint | MSAL (browser, PKCE) + Microsoft Graph `/me/drive` (`Files.ReadWrite` scope), OneDrive File Picker v8 | an Entra app registration (SPA) |
  | Dropbox | OAuth PKCE + Dropbox API v2 (`files/download`, `files/upload`), Chooser/Saver for picking | a Dropbox app key |
  | iCloud Drive | **No public web API** for third-party files. On macOS/iOS/Windows (iCloud for Windows) it is a folder in the native file dialog – covered by the local provider; on the web it is not possible. Document this honestly in the UI. |
  | Nextcloud / WebDAV (optional, cheap) | WebDAV with user credentials (app password) – fits self-hosters | nothing |
- Security: tokens in `sessionStorage` (web) or the app-data store (desktop), never in the URL after the callback; refresh via PKCE where supported; "Disconnect" wipes tokens; CSP `connect-src` lists only enabled provider origins (`https://www.googleapis.com https://accounts.google.com https://graph.microsoft.com https://login.microsoftonline.com https://api.dropboxapi.com https://content.dropboxapi.com`), added per provider in the nginx conf; conflict handling on save (ETag / `If-Match`) with a "File changed on the server – overwrite / save as copy" dialog.
- Autosave/recovery stays local (ADR 0009); cloud writes happen only on explicit Save.

## Plan (after P7-12 privacy hardening; before mobile)
1. `FileProvider` abstraction + local provider refactor + provider tabs in the backstage (no new providers yet). ~1 week.
2. Google Drive (most common ask) with Picker. ~1–2 weeks incl. e2e against a test account? (e2e with real OAuth is not automatable in CI – use a mocked provider in tests, manual check with the owner's test project).
3. OneDrive, Dropbox. ~1 week each.
4. WebDAV (optional). ~3 days.

## Owner decisions needed when scheduling
- Which providers first (Google Drive, OneDrive, Dropbox, WebDAV)? iCloud only via the native file system.
- Provider app registrations: the OAuth client IDs/keys must be created in the owner's accounts (we can prepare exact instructions).


## Amendment 2026-10-16 (owner): generic and opt-in

The owner's direction: connectors must be **generic** – the user decides whether to connect a cloud at all; Rusuite offers no cloud service and does not register provider apps on the user's behalf. Consequences for the first implementation (task to be scheduled after the current Phase 8 batch):
1. Order: **WebDAV first** (Nextcloud/ownCloud/Synology/most self-hosted and many commercial drives; no OAuth, user enters URL + credentials, stored only on the device), then **S3-compatible** (optional), then OAuth providers (Google Drive, OneDrive, Dropbox) through a **generic OAuth PKCE connector** where the user pastes their own client id (documented step-by-step) – no Rusuite-owned client ids.
2. Everything behind one `FileProvider` interface (list/open/save/save-as/rename, conflicts via ETag/If-Match) and one "Connections" dialog (File › Open/Save › Add a connection…), off by default, CSP `connect-src` extended per connection origin at runtime where the platform allows (desktop: Tauri allowlist; web: the user is told which origin will be contacted).
3. iCloud stays native-file-system only.


## v1 as built (P8-36, 2026-10-16)
- **Interface**: `packages/ui-shared/src/connectors/provider.ts` – `FileProvider` (`list`, `stat`, `read` → bytes +
  ETag, `write(path, bytes, { ifMatch, ifNoneMatch })` → ETag, 409/412 → `ConflictError`, `mkdir`, `delete`,
  `rename`), `Connection { id, kind: "webdav", name, baseUrl, auth: basic | bearer, rootPath, allowHttp,
  rememberPassword }`. Paths are connection-relative (`/Docs/a.xlsx`), the same rules in Rust (`app_common::connector`).
- **Transports**: desktop – `app_common::webdav::WebDavClient` (reqwest + rustls/ring, PROPFIND depth 0/1, GET, PUT
  with `If-Match`/`If-None-Match`, MKCOL, DELETE, MOVE; HTTPS only unless "allow http"; redirects only within the
  origin and never to plain HTTP), exposed by the shells as `connector_list/stat/read/write/mkdir/delete/rename`
  (`app_common::connectors_tauri`, feature `tauri-connectors`). Web – `connectors/webdav-fetch.ts` (`fetch`, the same
  semantics, `credentials: "omit"`, `redirect: "manual"`, no referrer). `Backend.connectors` picks the platform.
- **Storage** (device only, never synced, never logged): web – IndexedDB `rusuite-connections` (`kv`: records without
  secrets + remote recent files; `secrets`: a password only with "Remember password on this device", unencrypted, as
  the dialog says; otherwise asked once per page). Desktop – `connections.json` in the app data dir (secrets stripped
  again in Rust) and remembered passwords in the OS keyring (`keyring` crate: Keychain / Credential Manager / Secret
  Service; chosen over Stronghold because it needs no extra master password and uses the platform's own store). If
  the keyring fails, the app says so and asks again next session. "Forget all connections" (File › Home › Privacy)
  removes records, secrets and remote recent files.
- **UI**: File › Open and File › Save As are backstage pages: "This device" (the previous dialog/download) and
  Connections (configured ones, "Add a connection…") with the file browser. Remote documents: title
  "Budget.xlsx – Nextcloud – Rusuite Calc", the connection's name in the status bar, Save writes back with `If-Match`;
  a conflict asks Overwrite / Save a copy / Reload theirs; recent files remember connection + path. Autosave stays
  local.
- **CORS** (web): the server must answer the preflight for this site's origin – `Access-Control-Allow-Origin:
  https://resuite.inceptum.at`, methods `GET, PUT, PROPFIND, MKCOL, DELETE, MOVE, OPTIONS`, headers `Authorization,
  Depth, Destination, Overwrite, If-Match, If-None-Match, Content-Type`, `Access-Control-Expose-Headers: ETag`.
  Nextcloud/ownCloud: a CORS app or the web server config. Chromium additionally asks the user before a public site
  contacts a LAN address (Local Network Access).
- **CSP – owner decision pending** (ADR 0009 amendment 2026-10-16, proposed): the live `connect-src 'self'` blocks
  every user-configured host, so on the web the connection is shown disabled with "This site's security policy does
  not allow connections to other servers" (detected via `securitypolicyviolation`). Prepared, not applied –
  `deploy/nginx/resuite.inceptum.at.conf`: `set $csp_connect "'self' https:";` (i.e. `connect-src 'self' https:;`).
  Desktop needs no CSP change (requests are made in Rust).
- **Tests**: Rust – `app_common::{connector, webdav, connectors_tauri}` (paths, multistatus parsing, a hand-rolled
  HTTP mock for PROPFIND/GET/PUT/MKCOL/DELETE/MOVE, conflicts, redirects, secrets stripped); TS – the provider
  contract against the in-memory fake and the fetch transport (over a simulated WebDAV server), controller, session,
  stores, dialogs and the file browser; e2e `packages/e2e/tests/connectors.spec.ts` against a Node WebDAV server
  (`support/webdav.ts`, port 4846).
- **Next**: S3-compatible connector; generic OAuth PKCE connector (user's own client id); shared connection records
  across the three desktop apps (today each app has its own data dir; the keyring entries are shared).
