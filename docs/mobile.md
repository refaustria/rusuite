# Mobile apps (Android, iOS)

Rusuite Calc, Write and Show also build as Android and iOS apps (cycle 3.1415, P10-M1; plan:
[mobile-plan.md](mobile-plan.md), decision: [ADR 0005 amendment](adr/0005-web-target-via-wasm.md)). They are the same
Tauri shells (`apps/<app>/src-tauri`) and frontends as the desktop apps, built for the phone: the native Rust core,
no WASM. The compact phone layout (P10-M2), touch editing (M3–M5), PDF/print (M6) and store publishing (M7–M9) come
later; until then the apps look like the desktop web on a phone.

| | Calc | Write | Show |
|---|---|---|---|
| Android `applicationId` / iOS bundle id | `dev.rusuite.calc` | `dev.rusuite.write` | `dev.rusuite.show` |
| Name | Rusuite Calc | Rusuite Write | Rusuite Show |
| Opens / "Open with" | `.xlsx` (Open also `.csv`/`.tsv`/`.txt`) | `.docx`, `.dotx` | `.pptx` |

- Minimum OS: **Android 8.0 (API 26)**, target SDK 36; **iOS 15**. Apple team `PM7LTV7M72`.
- Architectures: Android `arm64-v8a` + `x86_64` (emulator); iOS `arm64` + the arm64 simulator. No armv7.
- Versions: `tauri.conf.json` `version` (e.g. `3.141.0`) is the Android `versionName` and iOS
  `CFBundleShortVersionString`. The Android `versionCode` (Tauri) and the iOS `CFBundleVersion` (set by `mobile.yml`)
  are **major·1 000 000 + minor·1 000 + patch**: 3.141.0 → 3 141 000, 3.1415.0 → 4 415 000, 3.14159.0 → 17 159 000
  (increasing). Google Play's limit is 2 100 000 000: minors up to 2 096 999 fit (3.1415926 → 1 418 926 000),
  3.14159265 does not – it needs an explicit `bundle.android.versionCode` (and a matching iOS build number).

## Layout of the code
- `apps/<app>/src-tauri/gen/android` – the Android Studio / Gradle project (`tauri android init`, committed and
  edited: `minSdk 26`, `targetSdk 36`, `ndkVersion`, signing from `keystore.properties`, the "Open with" intent
  filters, FileProvider paths limited to `cache/share/`). Build outputs, `jniLibs`, `tauri.settings.gradle`,
  `keystore.properties` and `*.jks` are git-ignored.
- `apps/<app>/src-tauri/gen/apple` – the Xcode project (`tauri ios init`, generated on a macOS runner and committed).
- `apps/<app>/src-tauri/Info.ios.plist` – merged into the iOS `Info.plist` by `tauri ios build`:
  `CFBundleDocumentTypes` + `UTImportedTypeDeclarations` for the app's type, `LSSupportsOpeningDocumentsInPlace`,
  `UIFileSharingEnabled` (the app's folder in Files), all orientations, `ITSAppUsesNonExemptEncryption = false`.
- `apps/<app>/src-tauri/capabilities/mobile.json` – the mobile windows' permissions (`core:default` only); the desktop
  capabilities are limited to Linux/macOS/Windows.
- `apps/<app>/src-tauri/src/mobile.rs` – the mobile commands (below); `lib.rs` has `#[cfg_attr(mobile,
  tauri::mobile_entry_point)]`, desktop-only parts behind `#[cfg(desktop)]` (dialog parents, print, connectors,
  monitor swapping).
- `crates/tauri-plugin-rusuite-mobile` – the native half (Kotlin `android/`, Swift `ios/`) and its Rust API.
- Icons: `tauri icon src-tauri/icons/icon.png -o <tmp>`; the Android mipmaps (adaptive icon, white background) are in
  `gen/android/app/src/main/res/mipmap-*`, the iOS set in `src-tauri/icons/ios` (and the Xcode asset catalog). Do not
  run `tauri icon` without `-o`: it would also rewrite the desktop icons.

## How documents work on mobile
`ui-shared`'s `TauriBackend` switches to its mobile mode when `isMobile()` (the plugin's page marker
`window.__RUSUITE_MOBILE__ = "android" | "ios"`, set before any app code runs; the web build on a phone is not a mobile
shell):

| Backend | Shell command | Android | iOS |
|---|---|---|---|
| `openFile()` | `open_document` | `ACTION_OPEN_DOCUMENT` (all document providers: Downloads, Drive, OneDrive …), persistable read/write grant | `UIDocumentPickerViewController(forOpeningContentTypes:asCopy: false)` – opens in place |
| `saveFile()` | `save_document` | write back with `openOutputStream(uri, "wt")` | coordinated write to the bookmarked security-scoped URL |
| untitled / Save As / write refused | `save_document` | `ACTION_CREATE_DOCUMENT` ("save to"; share sheet when no provider) | `UIDocumentPickerViewController(forExporting:asCopy: true)` from a temporary copy |
| `share()` | `share_document` | `ACTION_SEND` via the app's FileProvider | `UIActivityViewController` |
| "Open with" | `take_launch_document` | `ACTION_VIEW` / `ACTION_EDIT` intents (cold start and `onNewIntent`) | `RunEvent::Opened` (`scene:openURLContexts:`) |
| Recent files | `recent_open` | the persisted content URI | the bookmark |
| `exportPdf()` (P10-M6) | `export_pdf { suggestedName, paper }` | `WebView.createPrintDocumentAdapter()` → PDF in `cacheDir/pdf` → `ACTION_CREATE_DOCUMENT` (`application/pdf`; share sheet when no provider) | `UIPrintPageRenderer` + `viewPrintFormatter()` → PDF → `UIDocumentPickerViewController(forExporting:)` |
| `print(paper)` | `print_pdf { suggestedName, paper }` | the same PDF to `PrintManager.print` (adapter over the file) | `UIPrintInteractionController`, `printingItem` = PDF data |
| `sharePdf()` | `share_pdf { suggestedName, paper }` | `ACTION_SEND` of the PDF (`cache/share/`) | `UIActivityViewController` |

- A document is bound to an opaque **handle** (content URI / `bm:<bookmark>`), kept by the shell's `DocPath` exactly
  like a desktop path: Open binds once the core opened the file, Save writes there, New/recovery unbind it. A read-only
  "Open with" grant makes the next Save ask where to save.
- The session (`DocumentSession`) asks for the launch document on start and whenever the page becomes visible again;
  it goes through the app's Open, after the unsaved-changes question.
- `Backend.capabilities = { print: true, saveAs: true, share: true, pdf: true }` on mobile (P10-M6; without the plugin's
  `window.__RUSUITE_PDF__` marker `print` and `pdf` are false, `print()` rejects with `UnsupportedError` and the UI hides
  Print). Desktop and web are unchanged
  (`print: true, share: false`).
- Recent files and crash recovery stay JSON files in the app data directory (Android
  `/data/user/0/dev.rusuite.<app>/…`, iOS `Library/Application Support/dev.rusuite.<app>`).
- **No connections, no AI assistant** (owner rule): the mobile `TauriBackend` has neither, so File › Options › AI and
  Connections never appear; the shells are built without the connector commands and the OS keyring.
  Nor "Report a problem" (Help menu, File, the compact "⋯" sheet; `reportAvailable()`): it sends text, screenshots
  and diagnostics to rusuit.es, and the store privacy declarations say "no data collected" (web and desktop keep it).
- Permissions: Android only `INTERNET` (Tauri's webview loads the bundled pages from `http://tauri.localhost`, which
  Chromium treats as a network load, and `tauri android dev` from the dev server – the apps make no network
  requests); no storage permission (the pickers grant access per document). iOS: none.

## PDF and printing (P10-M6)
The page mounts its print root (`#rusuite-print-root`, the pages of File › Print) and calls `export_pdf` / `print_pdf` /
`share_pdf` with `paper = { widthMm, heightMm, landscape }` (the first page's `@page` size); the plugin renders the webview's
print media to a PDF and hands it on (table above). File › Print and Export PDF… are back on mobile, plus **Share as PDF…**.
Limitations:
- An export returns only the chosen name, no handle: the apps cannot open a PDF, so it never enters the recent list.
- Android: the adapter's `LayoutResultCallback` / `WriteResultCallback` constructors are package-private in the SDK stubs
  (public but `@hide` in the framework), so the driver lives in `android/print/RusuitePdfWriter.kt` (package
  `android.print`) – the established way to drive the WebView adapter without the print dialog. Not run on a device here
  (no emulator on the build server); CI compiles it.
- iOS: `paperRect` / `printableRect` of `UIPrintPageRenderer` are set by key-value coding (they are read-only properties);
  only the Swift compile is verified (CI macOS runner).
- Printing goes through a finished PDF, so the system print dialog cannot re-lay out the pages for another paper size
  (it scales); choose the paper in File › Print first.
- No new permission: printing and the pickers need none (`mobile.yml` checks the APK's permission list).

## Building locally (Linux, Android only)
iOS needs macOS (CI below). Android on this server: SDK `/home/bojan/android-sdk` (platforms 34–36, build-tools 36,
NDK 28.2.13676358), Java 21; no emulator here (no `/dev/kvm`).

```sh
export ANDROID_HOME=$HOME/android-sdk NDK_HOME=$HOME/android-sdk/ndk/28.2.13676358
export JAVA_HOME=$(dirname $(dirname $(readlink -f /usr/bin/java)))
rustup target add aarch64-linux-android x86_64-linux-android
pnpm --filter calc android:build --apk --target aarch64   # release, signed with the debug key
pnpm --filter calc android:build --aab --target aarch64 --target x86_64   # App Bundle as in CI
pnpm --filter calc android:dev                             # on a connected device / emulator (adb)
$ANDROID_HOME/build-tools/36.0.0/aapt dump badging apps/calc/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```
Outputs: `gen/android/app/build/outputs/apk/universal/release/*.apk`, `…/bundle/universalRelease/*.aab`. Measured
here (P10-M1, arm64 APK, release, stripped): Calc 19.2 MB, Write 14.6 MB, Show 15.7 MB; first build ≈ 6.5 min (Gradle
download + the whole workspace in release), then 45–100 s per app. CI (both ABIs, AAB + APK): ≈ 13 min cold, ≈ 8 min
with the Rust cache.

Several apps in one `target/`: tauri's build script writes the generated Kotlin sources (`TauriActivity.kt`, …) only
for the app it last ran for and does not notice another app's project, so the next app's Gradle build fails with
"Unresolved reference 'TauriActivity'". Run `cargo clean -p tauri --release --target aarch64-linux-android` before
switching apps (CI builds one app per job and is not affected). Android
Studio: open `apps/<app>/src-tauri/gen/android` (run `pnpm --filter <app> tauri android build` once first, it writes
`tauri.settings.gradle`). On macOS: `pnpm --filter <app> ios:build` (or `tauri ios dev`, `tauri ios open`).

Release signing: put `apps/<app>/src-tauri/gen/android/keystore.properties` (git-ignored) next to the Gradle project:
```properties
storeFile=/absolute/path/to/upload.jks
storePassword=…
keyAlias=…
keyPassword=…
```
Without it release builds are signed with the debug key (fine for sideloading, refused by Play).

## CI: `.github/workflows/mobile.yml`
Runs on `workflow_dispatch` and on pushes to `main` and `p10/m*` that touch `apps/`, `crates/`, `packages/`, the lock
files or the workflow (one path filter for both). Matrix over the three apps:
- **android** (ubuntu-22.04): Java 21, SDK/NDK via `android-actions/setup-android`, Rust targets, `tauri android
  build --aab --apk --target aarch64 --target x86_64`; smoke: `aapt dump badging` (package, versionCode, minSdk 26,
  targetSdk 36, ABIs) and the manifest's VIEW/EDIT intent filters with the app's MIME type, `apksigner`. Artifacts
  `android-<app>` (AAB + APK, 7 days).
- **ios** (macos-15, newest Xcode): without signing secrets a simulator build (`tauri ios build --debug --target
  aarch64-sim`), with them `tauri ios build --export-method app-store-connect` → `.ipa`. Smoke: `plutil` on the built
  `Info.plist` (bundle id, versions, document types, open in place, file sharing). If `gen/apple` is missing it runs
  `tauri ios init --ci` first and uploads the project as `gen-apple-<app>` (that is how the committed projects were
  made).

### Secrets (repository secrets; names only)
| Secret | Used for |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | upload keystore (`base64 -w0 upload.jks`); its presence switches to release signing |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | `keystore.properties` |
| `IOS_CERTIFICATE`, `IOS_CERTIFICATE_PASSWORD` | Apple Distribution certificate (base64 `.p12`) and its password |
| `IOS_MOBILE_PROVISION_CALC`, `IOS_MOBILE_PROVISION_WRITE`, `IOS_MOBILE_PROVISION_SHOW` | App Store provisioning profile per bundle id (base64 `.mobileprovision`) |
| `APPLE_DEVELOPMENT_TEAM` | `PM7LTV7M72` |

The workflow passes the certificate and the app's profile to the Tauri CLI as `IOS_CERTIFICATE`,
`IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION`, which imports them into a temporary keychain. Uploading to Play /
TestFlight: **`mobile-release.yml`** on version tags (P10-M8) – the same build steps (shared in
`scripts/mobile/*.sh`: version code, keystore, smoke tests), then `scripts/store/play.mjs upload` and `xcrun altool`;
store listings, screenshots, review and submission: **[store/README.md](store/README.md)** and the console checklists
next to it.

## Known limitations
- Nothing has run on a device or emulator yet (no KVM on the server, no macOS): CI proves that the projects compile,
  link and package with the expected ids, versions, intent filters and document types; the picker / write-back /
  share / Open with flows are implemented against the platform APIs but untested on hardware.
- Print is hidden (P10-M6). Show's presenter view cannot open its second window on mobile (no permission in the
  mobile capability, one display); whether its single-window fallback takes over is untested (P10-M5).
- iOS cold start with a document: tao delivers `scene:openURLContexts:`; a document passed in the scene's connection
  options at a cold launch may not reach `RunEvent::Opened` (then the user opens it again from Files or Recent).
- An iOS export to a provider that refuses bookmarks leaves the document untitled (the next Save asks again).
- Android `INTERNET` permission is declared (see above); removing it needs a device test.
