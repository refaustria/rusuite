# Cloud connectors (user-owned accounts) – design and plan

- Status: planned, not scheduled (owner 2026-10-15: "nothing on my cloud but rather local drive or custom cloud connection (Google, iCloud etc.)")
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
