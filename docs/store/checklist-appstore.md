# App Store – checklist for the first release (P10-M9)

Everything that only App Store Connect (or the Apple Developer site) can do, in order, with the values to enter.
Steps marked **scripted** are a command of [`scripts/store/asc.mjs`](README.md) (or `scripts/signing/asc.mjs`);
**console** steps are clicks. "×3" = once per app. Values that must not be in the repository (people's e-mail
addresses, phone numbers, keys) are placeholders in `<angle brackets>`.

| | Calc | Write | Show |
|---|---|---|---|
| Name | Rusuite Calc | Rusuite Write | Rusuite Show |
| Bundle ID | `dev.rusuite.calc` | `dev.rusuite.write` | `dev.rusuite.show` |
| SKU | `rusuite-calc` | `rusuite-write` | `rusuite-show` |
| Artifact of `mobile-release.yml` | `ios-calc` | `ios-write` | `ios-show` |

Team: `PM7LTV7M72`. Version record: `3.1415` (public name, [versioning.md](../versioning.md)); the build carries
`CFBundleShortVersionString 3.1415.0` and `CFBundleVersion 4415000`.

## 0. Account and agreements (console, once)
1. **console** – <https://appstoreconnect.apple.com/> › *Business* (formerly *Agreements, Tax, and Banking*): the
   **Apple Developer Program License Agreement** is accepted (the *Free Apps* agreement comes with it; paid apps
   agreement, tax and banking are not needed for free apps).
2. **console** – *Business › EU Digital Services Act*: declare the **trader status** (required to distribute in the
   EU). As a company publishing apps: **trader** → address, phone `<public phone>`, e-mail `<support e-mail>` (shown on
   the product pages in the EU) – verified by Apple before the apps appear in EU storefronts.

## 1. API key (console, once)
**console** – *Users and Access › Integrations › App Store Connect API › Team Keys › +*: name **rusuite-store**,
access **App Manager** (needed for metadata, screenshots, builds, TestFlight groups and review submission; *Developer*
can upload builds but cannot edit metadata or submit). Download `AuthKey_<key id>.p8` (only once) to
`~/rusuite-signing/`. The key P10-S1 created for notarization works too if its role is App Manager or Admin (the
*Team Keys* table shows it). Repository secrets (for the TestFlight upload in `mobile-release.yml`, also used for
notarization): `APPLE_API_KEY` (key id), `APPLE_API_ISSUER` (issuer id), `APPLE_API_KEY_CONTENT` (the `.p8` text) –
commands in [docs/signing.md](../signing.md). Locally: `export ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/rusuite-signing/AuthKey_….p8`.

## 2. Bundle IDs, certificate, profiles (scripted, once – P10-S1)
`node scripts/signing/asc.mjs bundle-ids list` shows the three ids (else `bundle-ids register --id dev.rusuite.calc
--name "Rusuite Calc" --platform IOS`, …); the Apple Distribution certificate and the three App Store profiles are the
`IOS_*` secrets of [docs/mobile.md](../mobile.md) ([docs/signing.md](../signing.md) has the commands).

## 3. Create the apps (console, ×3)
The API cannot create apps. *Apps › + › New App*: Platforms **iOS**; Name **Rusuite Calc** (unique in the App
Store); Primary language **English (U.S.)**; Bundle ID **dev.rusuite.calc**; SKU **rusuite-calc**; User access
**Full Access** → *Create*. Then **scripted** – `node scripts/store/asc.mjs apps list` lists all three.

## 4. App information (scripted, then console, ×3)
1. **scripted** – `node scripts/store/asc.mjs app-info push --app <app>`: name and subtitle in the 18 App Store
   locales (Bulgarian, Estonian, Irish, Latvian, Lithuanian, Maltese have no App Store localization → en-US shows),
   privacy policy URL `https://rusuit.es/privacy.html`, categories **Productivity** (primary) / **Business**
   (secondary), the age rating questionnaire with every answer "None"/"No".
2. **console** – *App Information*: check *Age Rating* shows **4+** (if Apple added questions the API does not know
   yet, `app-info push` prints "refused …" – answer those here: all "None"/"No"; *Made for Kids*: **No**);
   *Content Rights*: "Does your app contain, show, or access third-party content?" → **No** (documents are the
   user's own files).

## 5. App Privacy (console, ×3)
*App Privacy › Get Started*: *Do you or your third-party partners collect data from this app?* → **No, we do not
collect data from this app** → *Publish*. Privacy policy URL: `https://rusuit.es/privacy.html` (set by step 4).
> **Check before answering – "Report a problem"** (same question as on Play, [checklist-play.md](checklist-play.md)
> § 6): the dialog sends what the user typed/attached plus diagnostics to `https://rusuit.es/api/report` when the user
> submits it. Apple's exemption for optional feedback forms requires, among others, that the user's name or account
> is shown in the form – the Rusuite report is anonymous, so it does not clearly apply. Either hide the dialog in the
> mobile shells ("not collected" is then exact) or declare **Diagnostics › Other diagnostic data** and **User
> content › Other user content**, *not linked to the user*, *not used for tracking*, purpose *App functionality*.

## 6. Pricing and availability (console, ×3)
*Pricing and Availability*: price **USD 0.00 (Free)**; *Availability*: **all countries or regions**; *App
Distribution Methods*: Public. iPad: the apps are universal (no extra step); *Mac (Apple silicon) availability*: leave
on or switch off as the owner prefers (the desktop apps are the Mac version) – default **off**.

## 7. Encryption (none)
The apps' `Info.plist` has `ITSAppUsesNonExemptEncryption = false` ([docs/mobile.md](../mobile.md)), so TestFlight
asks nothing. If a build still shows *Missing Compliance*: **scripted** – `node scripts/store/asc.mjs build
export-compliance --app <app> --build <number>`.

## 8. TestFlight (console + scripted)
1. **scripted** – the tag runs `mobile-release.yml`: signed `.ipa` per app → `xcrun altool --upload-app` (needs the
   `IOS_*` and `APPLE_API_*` secrets). Processing takes 5–30 minutes; Apple e-mails the account holder.
2. **console** – *TestFlight › Internal Testing › +*: group **Internal**, *Enable automatic distribution* on, add
   testers (App Store Connect users of the team, up to 100). **scripted** – `asc.mjs testflight groups --app <app>`;
   a build not distributed automatically: `asc.mjs testflight add --app <app> --group Internal --build <number>`.
3. External testers (optional): a group **Beta**, *Test Information* (feedback e-mail `<support e-mail>`, beta
   description, privacy URL) and the first external build go through *Beta App Review* – not needed for the release.

## 9. Version, build, review details (scripted, ×3)
```sh
node scripts/store/asc.mjs version ensure --app <app> --version 3.1415          # iOS version, release MANUAL
node scripts/store/asc.mjs version push   --app <app> --version 3.1415          # texts + screenshots
node scripts/store/asc.mjs build attach   --app <app> --version 3.1415 --build 4415000   # waits for VALID
node scripts/store/asc.mjs review notes   --app <app> --version 3.1415 --file docs/store/review-notes.txt \
  --contact-first <first> --contact-last <last> --contact-email <e-mail> --contact-phone <+43 …>
```
Screenshots needed by Apple: iPhone 6.7"/6.9" (`phone-67`, 1290×2796) and iPad 13" (`tablet-10`, 2048×2732);
6.5" (`phone-65`, 1284×2778) is optional. Sign-in required: **No** (no demo account).
**console** – open the version page once: every locale shows its texts, the build, *App Review Information*; the
*Copyright* field: `© 2026 refaustria` (or the owner's legal name) – the scripts do not set it, enter it here;
*Version Release*: **Manually release this version** (set by `version ensure`).

## 10. Submit (scripted with confirmation, then console)
1. **scripted** – `node scripts/store/asc.mjs submit --app <app> --version 3.1415` prints state, build, locales and
   review details and changes nothing; with the owner's go: the same command with **`--yes`** creates the review
   submission and submits it. (Console alternative: version page › *Add for Review* › *Submit to App Review*.)
2. Review takes ~1–3 days; a rejection arrives in *App Review* messages (answer in the console, fix, `submit` again).
3. **console** – after *Pending Developer Release*: *Release This Version* (release type MANUAL – nothing goes live
   without this click).
