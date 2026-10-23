# Store publishing (Google Play, App Store)

Rusuite Calc, Write and Show ship to Google Play and the App Store from the same tag as the desktop release
(cycle 3.1415, P10-M7…M9). Everything after "the app exists in the console" is scripted; what only the consoles can
do is in the checklists: **[checklist-play.md](checklist-play.md)** and **[checklist-appstore.md](checklist-appstore.md)**
(app creation, Play App Signing, questionnaires, API access, the final clicks).

| Piece | What it does |
|---|---|
| [`.github/workflows/mobile-release.yml`](../../.github/workflows/mobile-release.yml) | on `v*` tags (or *Run workflow* with `tag` + `track`): version check against the tag, signed AAB + APK per app → artifact (14 days) → Play upload; signed `.ipa` per app → artifact → TestFlight. Succeeds without secrets (debug-signed APK/AAB, simulator builds, a notice per skipped upload). |
| [`scripts/store/play.mjs`](../../scripts/store/play.mjs) | Android Publisher API v3: `upload`, `listing push`, `status`, `validate` |
| [`scripts/store/asc.mjs`](../../scripts/store/asc.mjs) | App Store Connect API: `apps list`, `app info`, `app-info push`, `version ensure/push`, `build attach/export-compliance`, `review notes`, `submit`, `testflight groups/add` (builds on `scripts/signing/asc.mjs`) |
| [`scripts/mobile/*.sh`](../../scripts/mobile) | the build steps shared by `mobile.yml` and `mobile-release.yml` (version code, keystore, smoke tests, TestFlight upload) |
| `docs/store/listing/<lang>.json`, `release-notes/<lang>.txt`, `review-notes.txt`, `screenshots/`, `graphics/` | the store texts and images (P10-M7, [SCREENSHOTS.md](SCREENSHOTS.md)) |

Both scripts: Node ≥ 20, no dependencies, `--help` lists every option, API errors show the store's status, code and
message (403/404 point to the checklist), 429/5xx are retried with backoff. They never print a key or token.

## Credentials (environment only, never in the repo)
| Store | Locally (PM, `~/rusuite-signing/`) | GitHub secret (`mobile-release.yml`) |
|---|---|---|
| Google Play | `PLAY_SERVICE_ACCOUNT_FILE=~/rusuite-signing/play-service-account.json` (or `PLAY_SERVICE_ACCOUNT_JSON` = the JSON text) | `PLAY_SERVICE_ACCOUNT_JSON` |
| App Store Connect | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` (the `.p8`) | `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_CONTENT` |
| Android signing | – | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| iOS signing | – | `IOS_CERTIFICATE`, `IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION_CALC/_WRITE/_SHOW`, `APPLE_DEVELOPMENT_TEAM` |
| Review contact (App Store) | `ASC_REVIEW_FIRST_NAME`, `ASC_REVIEW_LAST_NAME`, `ASC_REVIEW_EMAIL`, `ASC_REVIEW_PHONE` (or `--contact-*`) | – |

## Order of a store release
Prerequisite once: the checklists up to "the apps exist, the API sees them" (`play.mjs validate` → 3/3,
`asc.mjs apps list` → 3 apps) and the first Android bundle uploaded by hand ([checklist-play.md](checklist-play.md) § 3).

1. **Tag** – `git tag -a v3.1415.0 -m "Rusuite 3.1415" && git push origin v3.1415.0` ([release.md](../release.md)).
   `release.yml` builds the desktop apps, **`mobile-release.yml`** the mobile ones: AABs to the Play **internal**
   track (`play.mjs upload --track internal`, release notes from `release-notes/<lang>.txt`), IPAs to TestFlight.
   Without the secrets: download the artifacts `android-<app>` / `ios-<app>` and upload by hand.
2. **Listings** – per app:
   ```sh
   node scripts/store/play.mjs listing push --app calc --dry-run && node scripts/store/play.mjs listing push --app calc
   node scripts/store/asc.mjs app-info push --app calc
   node scripts/store/asc.mjs version ensure --app calc --version 3.1415
   node scripts/store/asc.mjs version push --app calc --version 3.1415
   ```
3. **Attach + review details (App Store)** –
   `asc.mjs build attach --app calc --version 3.1415 --build 4415000` (waits until TestFlight processed it),
   `asc.mjs review notes --app calc --version 3.1415 --file docs/store/review-notes.txt`.
4. **Test** – internal testers install from the Play internal track and TestFlight (group *Internal*). Personal Play
   accounts: the closed test of 12 testers × 14 days comes first ([checklist-play.md](checklist-play.md) § 8).
5. **Submit** (only with the owner's go per store) –
   Play: `play.mjs upload --app calc --aab dist/rusuite-calc-3.1415.0-android.aab --track production --rollout 0.2`
   (or promote in the console); App Store: `asc.mjs submit --app calc --version 3.1415` (shows), then `--yes`.
   After approval: Play rolls out by itself (unless managed publishing), App Store needs *Release This Version*.
6. `play.mjs status` / `asc.mjs app info --app calc` to follow the state.

Workflow by hand: *Actions › Mobile release › Run workflow* – *Use workflow from* `main`, *tag* `v3.1415.0` (empty =
the branch), *track* `internal|closed|open|production`. (`workflow_dispatch` needs the workflow on the default
branch; the agents' token cannot dispatch – the PM/owner clicks.)

## `play.mjs`
```
upload --app <app> --aab <file> --track internal|closed|open|production [--rollout 0.1] [--status completed|draft|inProgress|halted]
       [--notes <dir|<lang>.txt>] [--name <release name>] [--resumable] [--changes-not-sent-for-review] [--dry-run]
listing push --app <app> [--langs en,de] [--images own|all|none] [--dry-run]
status [--app <app>]
validate
```
- One *edit* per command: `edits.insert` → changes → `edits.commit`; `--dry-run` runs `edits.validate` and deletes the
  edit (nothing changes in the console); a failed command deletes its edit.
- `upload`: bundles ≤ 64 MB go as one request, bigger ones (or `--resumable`) as a resumable upload. Tracks: `closed`
  = Play's `alpha`, `open` = `beta`. `--rollout` = staged rollout (`inProgress` with `userFraction`). Release notes
  (≤ 500 characters) go only to languages that already have a store listing – run `listing push` once, then the
  next upload carries all of them.
- `listing push`: title (≤ 30), short (≤ 80) and full description (≤ 4000) from `listing/<lang>.json`; icon
  (`graphics/<app>/icon-512.png`), feature graphic (`feature-1024x500.png`), screenshots `screenshots/<app>/phone`,
  `tablet-7`, `tablet-10` (`<lang>/` sub-folder; ≤ 8 per type) → `phoneScreenshots`, `sevenInchScreenshots`,
  `tenInchScreenshots`, each type replaced (`images.deleteall` + upload). `--images own`: en-US plus languages with
  their own folder (Play shows the default language's graphics for the rest); `all`: en for every language.
- `status`: tracks with releases, status, fraction and version codes; the review state is not in the API.
- `validate`: opens (and deletes) an edit for each package – prints which apps the service account can see.

## `asc.mjs`
See `node scripts/store/asc.mjs --help`. Notes:
- `app-info push`: `appInfoLocalizations` (name = listing `title`, `subtitle`, `privacyPolicyUrl`
  `https://rusuit.es/privacy.html`), `appInfos` categories `PRODUCTIVITY`/`BUSINESS`, `ageRatingDeclarations` with
  every answer "NONE"/false. Fields the API version does not know (Apple keeps adding age-rating questions) are dropped
  and named in the output – answer those in the console.
- `version push`: `appStoreVersionLocalizations` (description, keywords ≤ 100, whatsNew, promotionalText ≤ 170,
  supportUrl and marketingUrl `https://rusuit.es/`); `whatsNew` is dropped automatically where Apple refuses it (an
  app's first version). Screenshots per locale: `phone-67` → `APP_IPHONE_67`, `phone-65` → `APP_IPHONE_65`,
  `tablet-10` → `APP_IPAD_PRO_3GEN_129` and `APP_IPAD_PRO_129` (≤ 10 each; the pixel size is checked first): the set is
  emptied, each file reserved (`appScreenshots`), uploaded in Apple's chunks, committed with its MD5, then polled
  until delivered. `--images own|all|none` as for Play (the App Store shows the primary locale's screenshots where a
  locale has none). A locale Apple refuses is reported; the others go on (exit 1 at the end).
- `build attach --build <number>|latest`: polls (`--interval 30` s, `--timeout 60` min) until the build is `VALID`,
  checks that its version train (`CFBundleShortVersionString`, e.g. `3.1415.0`) is the App Store version (`3.1415`;
  trailing `.0` ignored), then sets `appStoreVersions/<id>/relationships/build`.
- `submit` without `--yes` only prints the state; with `--yes` it reuses an open `reviewSubmission` or creates one,
  adds the version (`reviewSubmissionItems`) and submits.

## Locales
| Rusuite | Play | App Store | | Rusuite | Play | App Store |
|---|---|---|---|---|---|---|
| bg | `bg` | – | | hu | `hu-HU` | `hu` |
| cs | `cs-CZ` | `cs` | | it | `it-IT` | `it` |
| da | `da-DK` | `da` | | lt | `lt` | – |
| de | `de-DE` | `de-DE` | | lv | `lv` | – |
| el | `el-GR` | `el` | | mt | – | – |
| en | `en-US` (default) | `en-US` (primary) | | nl | `nl-NL` | `nl-NL` |
| es | `es-ES` | `es-ES` | | pl | `pl-PL` | `pl` |
| et | `et` | – | | pt | `pt-PT` | `pt-PT` |
| fi | `fi-FI` | `fi` | | ro | `ro` | `ro` |
| fr | `fr-FR` | `fr-FR` | | sk | `sk` | `sk` |
| ga | – | – | | sl | `sl` | `sl-SI` (added by Apple in 2025; unverified code) |
| hr | `hr` | `hr` | | sv | `sv-SE` | `sv` |

Play: 22 of 24 (no Irish, no Maltese listing language). App Store: 18 of 24 (no Bulgarian, Estonian, Irish, Latvian,
Lithuanian, Maltese). Unsupported languages are reported by the scripts and not sent; those storefronts show en-US.
The single source is `scripts/store/lib.mjs` (`PLAY_LOCALES`, `ASC_LOCALES`).

## Tests
`node --test scripts/store/*.test.mjs` – every command against a mocked `fetch` (request shapes, the edit lifecycle,
`--dry-run`, retries, the screenshot reserve/upload/commit, the build poll), with the small fixtures in
`scripts/store/testdata/store/` (same layout as `docs/store/`). Google and Apple are never called.
