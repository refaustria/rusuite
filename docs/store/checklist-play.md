# Google Play – checklist for the first release (P10-M9)

Everything that only Play Console (or Google Cloud Console) can do, in order, with the values to enter. Steps marked
**scripted** are a command of [`scripts/store/play.mjs`](README.md); **console** steps are clicks. Do the list once per
app where it says "×3" (Calc, Write, Show). Values that must not be in the repository (e-mail addresses of people,
phone numbers, keys) are placeholders in `<angle brackets>`.

| | Calc | Write | Show |
|---|---|---|---|
| App name | Rusuite Calc | Rusuite Write | Rusuite Show |
| Package name | `dev.rusuite.calc` | `dev.rusuite.write` | `dev.rusuite.show` |
| Artifact of `mobile-release.yml` | `android-calc` | `android-write` | `android-show` |

## 0. Developer account (console, once)
1. **console** – Play Console › *Settings* (gear) › *Developer account* › *Account details*: note the **account type**
   (*Organization* or *Personal*) of the `refaustria` account. Also visible on the *Verify your identity* page and
   in the *Dashboard* of a new app ("Test your app with at least 12 testers…" appears only for personal accounts).
   - **Personal account created after 13 Nov 2023**: production access needs a **closed test with at least 12 testers
     who stay opted in for 14 consecutive days**, then *Dashboard › Apply for production* (a short questionnaire about
     the test). Plan for it: step 8 below.
   - **Organization account** (D-U-N-S verified): no testing requirement, step 8 is optional.
2. **console** – the identity/contact verification banners are cleared (developer name **refaustria** or the
   organization name, public contact e-mail `<support e-mail>`, website `https://rusuit.es/`).

## 1. Create the apps (console, ×3)
*Home › Create app*:
- App name: **Rusuite Calc** (Write, Show); default language: **English (United States) – en-US**;
- App or game: **App**; Free or paid: **Free** (cannot be changed to paid later – intended);
- Declarations: tick *Developer Program Policies* and *US export laws*; *Create app*.

The package name is not asked here: it is fixed by the first uploaded bundle (step 3).

## 2. Play App Signing (console, ×3 – at the first release)
On the first release (step 3) Play Console asks how the app is signed: choose **"Let Google manage and protect your app
signing key (recommended)"** – Google generates the **app signing key**; our keystore (`ANDROID_KEYSTORE_BASE64`,
[docs/mobile.md](../mobile.md)) is the **upload key**. Nothing to export or upload besides the AAB. Afterwards
*Test and release › Setup › App signing* shows both certificates; keep the SHA-256 of the *app signing key* in
`~/rusuite-signing/play-app-signing.txt` (not in the repo) – it is the certificate the installed apps carry.
If the upload key is ever lost: *App signing › Request upload key reset* (no data loss).

## 3. First bundle by hand (console, ×3)
The Android Publisher API cannot reach an app before its first bundle was uploaded in the console (it answers 404
"Package not found" – `play.mjs` points here).
1. Run `mobile-release.yml` (tag push, or *Actions › Mobile release › Run workflow*) with the keystore secrets set;
   download the artifact `android-<app>` → `rusuite-<app>-<version>-android.aab`.
2. **console** – *Test and release › Testing › Internal testing › Create new release* → step 2 (signing) → upload
   the AAB → release name `<version> (<versionCode>)` → release notes from `docs/store/release-notes/en.txt`
   (`<en-US>…</en-US>`) → *Next* → *Save and publish*.
3. **console** – *Internal testing › Testers*: create the list **Rusuite internal** with `<tester e-mails>` (up to
   100), save; copy the opt-in link for the testers.

## 4. Service account for the API (console, once)
1. **console (Google Cloud)** – <https://console.cloud.google.com/> → new project **rusuite-play** → *APIs & Services ›
   Library* → enable **Google Play Android Developer API**.
2. *IAM & Admin › Service accounts › Create*: name **rusuite-play-publisher** (no project roles needed) → *Keys › Add
   key › JSON* → the file goes to `~/rusuite-signing/play-service-account.json` (chmod 600) and to the repository
   secret: `gh secret set PLAY_SERVICE_ACCOUNT_JSON -R refaustria/rusuite < ~/rusuite-signing/play-service-account.json`.
3. **console (Play)** – *Users and permissions › Invite new users* → the service account's e-mail
   (`rusuite-play-publisher@rusuite-play.iam.gserviceaccount.com`) → *App permissions › Add app*: the three apps →
   the **Release manager** preset, i.e. at least: *View app information*, *Release to production, exclude devices,
   and use Play App Signing*, *Release apps to testing tracks*, *Manage testing tracks and edit tester lists*,
   *Manage store presence* → *Invite user*. (Account permissions: none.) It can take a few minutes – up to a day in
   rare cases – until the API accepts the account.
4. **scripted** – `PLAY_SERVICE_ACCOUNT_FILE=~/rusuite-signing/play-service-account.json node scripts/store/play.mjs validate`
   → `3/3 apps visible`.

## 5. Store settings and listing (×3)
1. **console** – *Grow users › Store presence › Store settings*: App category **Productivity**; tags: *Office*,
   *Spreadsheet* / *Word processor* / *Presentation* (pick the closest the console offers); contact details: e-mail
   `<support e-mail>`, website `https://rusuit.es/` (phone optional – leave empty).
2. **scripted** – `node scripts/store/play.mjs listing push --app <app>`: title, short and full description in the
   22 Play languages (Irish and Maltese have no Play listing language and show en-US), icon 512 px, feature graphic,
   phone/7"/10" screenshots (en-US and de-DE own sets, the others fall back to en-US). First with `--dry-run`.
3. **console** – *Main store listing*: check the result once (the preview), especially that the icon and the feature
   graphic are accepted (no alpha in the icon).

## 6. App content (console, ×3 – *Policy and programs › App content*)
| Section | Answer |
|---|---|
| Privacy policy | `https://rusuit.es/privacy.html` |
| Ads | **No, my app does not contain ads** |
| App access | **All functionality is available without special access** (no account, no login) |
| Content rating | questionnaire below |
| Target audience and content | **18 and over** only (reasoning below); *Appeals to children*: **No** |
| News apps | **No** |
| Data safety | answers below |
| Government apps | **No** |
| Financial features | **My app doesn't provide any financial features** |
| Health | **My app does not have any health features** |
| Advertising ID | **No** (the apps declare no `AD_ID` permission and no ads SDK) |

**Content rating (IARC)** – e-mail `<support e-mail>`; category **"Utility, Productivity, Communication, or Other"**
(newer questionnaire versions call it *All other app types*; not "Game", "Social networking …" or "Reference, News
or Educational"). Answers: violence –
No; fear/horror – No; sexuality / nudity – No; language (profanity) – No; controlled substances (drugs, alcohol,
tobacco) – No; crude humour – No; gambling (real or simulated) – No; *users can interact or exchange content
with each other* – **No** (no chat, no accounts, no UGC shared through the app); *shares the user's current location
with other users* – **No**; *digital purchases* – **No**; *unrestricted internet access (e.g. a web browser)* – **No**;
*promotes or sells age-restricted products* – No. Expected result: **Everyone / PEGI 3 / USK 0 / IARC 3+**.

**Target audience: 18 and over – why.** Selecting any age group under 13 puts the apps under the *Families* policy
(Designed-for-Families review, extra disclosure and SDK requirements, "teacher approved" questions) without any
benefit for an office suite; 13–17 groups add the "appeals to children" review. "18 and over" keeps the review simple
and does **not** limit who can install: the content rating stays *Everyone*, so the apps are visible and installable
for all ages. (If the owner prefers students in the target groups, choose 13–15, 16–17 and 18+; never under 13.)

**Data safety** – *Does your app collect or share any of the required user data types?* → **No**. Then *Next* →
*Save* → *Submit*. (With "No", the encryption-in-transit and deletion questions are not asked.) The documents stay
on the device ([ADR 0009](../adr/0009-documents-never-leave-the-device.md)); the apps open no connection on their own.
> **Check before answering – "Report a problem".** The mobile builds include the "Report a problem" dialog
> (packages/ui-shared/src/report): when – and only when – the user submits it, the text, the screenshots the user
> attached and the diagnostics shown in the dialog go to `https://rusuit.es/api/report`, which files a public GitHub
> issue. Google counts data that leaves the device as "collected", even optional and user-initiated. Either
> (a) the owner decides to hide "Report a problem" in the Android/iOS shells (a small code task) and "No data
> collected" is exact, or (b) declare: *Collected, not shared, optional, processed in transit encrypted* –
> **App info and performance › Diagnostics** and **Messages › Other in-app messages** (the report text and
> screenshots), purpose **App functionality** (bug reports). PM: confirm (a) or (b) with the owner before submitting.

## 7. Countries and pricing (console, ×3)
*Test and release › Production › Countries/regions*: **Add countries/regions › select all** (≈ 175). Price: Free (from
step 1). Leave *Managed publishing* off unless the owner wants to press the final publish himself (then step 10 ends
with *Publishing overview › Publish changes*).

## 8. Closed test – personal accounts only (console + scripted, ×3)
1. **console** – *Testing › Closed testing › Create track* (or use the default *Closed testing – Alpha*, API track
   name `alpha`) → *Testers*: an e-mail list with **≥ 12** testers (Google accounts), or a Google Group → save, copy the
   opt-in link, testers opt in **and install**.
2. **scripted** – `node scripts/store/play.mjs upload --app <app> --aab dist/rusuite-<app>-<version>-android.aab --track closed`
   (or `mobile-release.yml` with *track* = closed). A brand-new app answers "Only releases with status draft may be
   created on draft app" until its first release went through the console: then add `--status draft` and press
   *Review release › Start rollout* in the console once.
3. Wait **14 days** with ≥ 12 testers opted in (*Dashboard* shows the counter) → **console** – *Dashboard › Apply for
   production* → answer the questionnaire (how the test went, what changed, readiness).

## 9. Status check (scripted)
`node scripts/store/play.mjs status` – tracks, releases, version codes of the three apps. The review state is not in
the API: *Publishing overview* in the console.

## 10. Production release (scripted, then console)
1. **scripted** – `node scripts/store/play.mjs upload --app <app> --aab … --track production --rollout 0.2`
   (staged; `--dry-run` first) or `--track production` for 100 %. Release notes: `docs/store/release-notes/<lang>.txt`.
2. **console** – *Publishing overview*: the changes are **in review** (first review of a new app: up to 7 days). With
   managed publishing: *Publish changes* after approval.
3. **console** – raise a staged rollout later in *Production › Releases › Manage rollout › Update rollout* (a version
   code can be uploaded only once, so `play.mjs upload` cannot re-send the same AAB).
