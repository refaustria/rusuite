# Signing the desktop builds

From 3.1415 on, `.github/workflows/release.yml` signs the installers **whenever the matching repository secrets
exist** and builds them unsigned, exactly as up to 3.141, when they do not. No secret is required for the workflow to
succeed; each platform switches on by itself once its secrets are set. The secrets and the material behind them never
enter the repository: the PM keeps the material in `~/rusuite-signing/` (mode 700) and stores it as GitHub repository
secrets with `gh secret set`. Scripts read them from the environment and print neither keys nor passwords.

| Platform | What gets signed | How | Job |
| --- | --- | --- | --- |
| macOS (Apple Silicon + Intel) | the `.app` (hardened runtime) in the `.dmg` and `.app.tar.gz`, notarized and stapled | Developer ID Application certificate + App Store Connect API key, Tauri's own signing/notarization (`APPLE_*` env) | `release` (macOS legs) |
| Windows | the app `.exe`, the NSIS installer (and its uninstaller), the MSI | Authenticode: a PFX in the runner's certificate store **or** Azure Trusted Signing (`artifact-signing-cli`) | `release` (windows-latest) |
| Linux | `.deb`, `.rpm`, `.AppImage`: detached `<file>.asc` | GPG release key | `sign-linux` |
| all | `SHA256SUMS` over every installer + `SHA256SUMS.asc` | GPG release key | `sign-linux` |

`signing.json` (job `signing-manifest`) records per OS what was actually signed – each build leg verifies its own
signature (`codesign`/`stapler`/`spctl` on macOS, `Get-AuthenticodeSignature` on Windows) and leaves a record; an OS
counts as signed only when all its legs did. The Downloads page (`scripts/gen-downloads.mjs`) reads it: a signed OS
gets a "signed" line instead of the Gatekeeper/SmartScreen steps, the "not signed yet" notice names only the OSes still
unsigned, and with GPG the page links the `.asc` files, `SHA256SUMS(.asc)` and the public key. Without `signing.json`
(all releases up to 3.141) the page is the unsigned one.

## Secrets

Repository secrets of `refaustria/rusuite` (Settings › Secrets and variables › Actions, or `gh secret set`).

| Secret | Content | How it is produced | Used by |
| --- | --- | --- | --- |
| `APPLE_CERTIFICATE` | base64 (one line) of the Developer ID Application `.p12` | `make-csr.sh` → `asc.mjs certificates create --type DEVELOPER_ID_APPLICATION` → `p12.sh` → `base64 -w0` | `release`, macOS; **switch** for macOS signing |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password | chosen by the PM (`P12_PASSWORD` of `p12.sh`) | `release`, macOS |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <name> (PM7LTV7M72)` | the certificate's common name (`p12.sh` prints it) | `release`, macOS |
| `APPLE_TEAM_ID` | `PM7LTV7M72` | Apple Developer › Membership details | `release`, macOS |
| `APPLE_API_ISSUER` | issuer id (UUID) of the App Store Connect API key | App Store Connect › Users and Access › Integrations › Team Keys (shown above the table) | `release`, macOS notarization |
| `APPLE_API_KEY` | key id of that key (10 characters) | same page, "Key ID" | `release`, macOS notarization |
| `APPLE_API_KEY_CONTENT` | the text of `AuthKey_<key id>.p8` | downloaded once when the key is created; **switch** for notarization | `release`, macOS notarization |
| `WINDOWS_CERTIFICATE` | base64 of a code-signing `.pfx` (exportable key) | from the CA, see "Windows" below; **switch** for the PFX path | `release`, Windows |
| `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password | from the export | `release`, Windows |
| `AZURE_TENANT_ID` | Entra ID tenant id | Azure portal › Microsoft Entra ID › Overview | `release`, Windows (Azure) |
| `AZURE_CLIENT_ID` | app registration (client) id | Entra ID › App registrations › New registration | `release`, Windows (Azure) |
| `AZURE_CLIENT_SECRET` | a client secret of that registration | App registration › Certificates & secrets; **switch** for the Azure path | `release`, Windows (Azure) |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | e.g. `https://weu.codesigning.azure.net` | the signing account's region endpoint (Overview › URI) | `release`, Windows (Azure) |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | signing account name | Azure portal › Trusted Signing account | `release`, Windows (Azure) |
| `AZURE_CERT_PROFILE` | certificate profile name (Public Trust) | the account › Certificate profiles | `release`, Windows (Azure) |
| `GPG_PRIVATE_KEY` | ASCII-armored secret release key | `gpg-key.sh` → `~/rusuite-signing/rusuite-release-key.secret.asc`; **switch** for `sign-linux` | `sign-linux` |
| `GPG_PASSPHRASE` | its passphrase | chosen by the PM (`GPG_PASSPHRASE` of `gpg-key.sh`) | `sign-linux` |

Switches: macOS signs when `APPLE_CERTIFICATE` is set and notarizes when `APPLE_API_KEY_CONTENT` is set too (signed
but not notarized still meets Gatekeeper, so the page keeps the macOS steps then). Windows uses the PFX when
`WINDOWS_CERTIFICATE` is set, else Azure when `AZURE_CLIENT_SECRET` is set. A switch that is on with a companion secret
missing fails that build leg with "`<NAME>` is empty" (never a silently unsigned build).

## PM commands, once the material exists

All files in `~/rusuite-signing/`; `R=refaustria/rusuite`. `gh secret set NAME -R $R` without `--body` asks for the
value without echoing it; piping a file keeps it out of the shell history.

```
# Apple (needs the App Store Connect API key: .p8, key id, issuer id)
export ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id> ASC_KEY_PATH=~/rusuite-signing/AuthKey_<key id>.p8
scripts/signing/make-csr.sh ~/rusuite-signing rusuite-devid
node scripts/signing/asc.mjs certificates create --type DEVELOPER_ID_APPLICATION \
  --csr ~/rusuite-signing/rusuite-devid.csr --out ~/rusuite-signing/devid.cer
read -rs P12_PASSWORD && export P12_PASSWORD
scripts/signing/p12.sh ~/rusuite-signing/devid.cer ~/rusuite-signing/rusuite-devid.key ~/rusuite-signing/devid.p12
base64 -w0 ~/rusuite-signing/devid.p12 | gh secret set APPLE_CERTIFICATE -R $R
printf '%s' "$P12_PASSWORD" | gh secret set APPLE_CERTIFICATE_PASSWORD -R $R
gh secret set APPLE_SIGNING_IDENTITY -R $R --body "Developer ID Application: <name as p12.sh printed> (PM7LTV7M72)"
gh secret set APPLE_TEAM_ID -R $R --body PM7LTV7M72
gh secret set APPLE_API_ISSUER -R $R --body "$ASC_ISSUER_ID"
gh secret set APPLE_API_KEY -R $R --body "$ASC_KEY_ID"
gh secret set APPLE_API_KEY_CONTENT -R $R < "$ASC_KEY_PATH"

# GPG release key (then commit keys/rusuite-release-key.asc and note the fingerprint in the release notes)
read -rs GPG_PASSPHRASE && export GPG_PASSPHRASE
scripts/signing/gpg-key.sh ~/rusuite-signing
gh secret set GPG_PRIVATE_KEY -R $R < ~/rusuite-signing/rusuite-release-key.secret.asc
printf '%s' "$GPG_PASSPHRASE" | gh secret set GPG_PASSPHRASE -R $R

# Windows, PFX path
base64 -w0 ~/rusuite-signing/windows.pfx | gh secret set WINDOWS_CERTIFICATE -R $R
gh secret set WINDOWS_CERTIFICATE_PASSWORD -R $R
# Windows, Azure path (values from the Azure portal)
for s in AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_TRUSTED_SIGNING_ENDPOINT AZURE_TRUSTED_SIGNING_ACCOUNT AZURE_CERT_PROFILE; do gh secret set $s -R $R; done

gh secret list -R $R                      # names only – check them against the table above
```

Then a test run of the workflow (docs/release.md, section 2) with tag `v0.0.0-test`: the `Verify the macOS signature`
/ `Verify the Windows signatures` steps and `sign / GPG + SHA256SUMS` must be green, the draft must carry
`signing.json` with the expected `true`s, `SHA256SUMS`, `SHA256SUMS.asc` and nine Linux `.asc` files.

The same API key serves the mobile work: `asc.mjs bundle-ids register --id dev.rusuite.calc --name "Rusuite Calc"
--platform IOS` (likewise `.write`, `.show`), `certificates create --type DISTRIBUTION --csr …` and
`profiles create --bundle-id dev.rusuite.calc --type IOS_APP_STORE --certificate <cert id> --out calc.mobileprovision`;
`certificates list` / `profiles list` show ids and expiry dates.

If `certificates create --type DEVELOPER_ID_APPLICATION` answers 403: Apple lets only the **Account Holder** create
Developer ID certificates, and a team API key may not be allowed to. The owner then creates it in the developer portal
(Certificates › + › Developer ID Application, G2 Sub-CA) with the same CSR and hands the `.cer` to the PM; `p12.sh`
continues from there.

## Windows: what the owner has to buy or set up

Since June 2023 CAs issue publicly trusted code-signing keys only on hardware (token or cloud HSM); such keys cannot be
exported to a `.pfx`. That leaves:

1. **Azure Trusted Signing** ("Artifact Signing"; recommended). Needs an Azure subscription, a Trusted Signing account
   (Basic tier about US$10/month, 5,000 signatures), identity validation of the publisher (organizations with a
   verifiable business history; individual developers only in some countries – check Microsoft's current eligibility
   for Austria first), a Public Trust certificate profile and an app registration with the role "Trusted Signing
   Certificate Profile Signer" on the account. Result: the six `AZURE_*` secrets. The certificates are short-lived and
   renewed by Azure; every signature is timestamped, so installers stay valid.
2. **OV or EV certificate from a CA** (about €200–600 per year; EV no longer skips SmartScreen's reputation check). With
   a cloud HSM (DigiCert KeyLocker, SSL.com eSigner, Certum SimplySign, …) signing goes through the CA's own tool;
   that needs its own `signCommand` (a small follow-up in `scripts/signing/tauri-sign-config.mjs`) – the PFX path here
   only fits a certificate whose key is exportable (e.g. an existing one, or a private test CA).

Either way SmartScreen may still ask for a while until the certificate (or Azure identity) has built reputation; the
Downloads page says so in its Windows line. Tauri signs with `signtool` (sha256, timestamp
`http://timestamp.digicert.com`) for the PFX path and calls `artifact-signing-cli -e <endpoint> -d "Rusuite <App>" <file>`
for each file on the Azure path (installed in the job with `cargo install artifact-signing-cli --version 0.12.0 --locked`;
it is the renamed `trusted-signing-cli`).

## Renewal dates

| Item | Valid | Renew |
| --- | --- | --- |
| Apple Developer Program membership | 1 year | yearly; signed + notarized releases keep opening when it lapses, new builds cannot be signed |
| Developer ID Application certificate | 5 years | before expiry: new CSR + certificate, new `APPLE_CERTIFICATE`/`_PASSWORD`/`_SIGNING_IDENTITY` |
| App Store Connect API key | no expiry | revoke and replace if leaked |
| GPG release key | 3 years (`gpg-key.sh`) | extend: `GNUPGHOME=~/rusuite-signing/gnupg gpg --quick-set-expire <fingerprint> 3y`, re-export public key to `keys/` and the secret |
| Azure client secret | ≤ 24 months (chosen at creation) | new secret → `AZURE_CLIENT_SECRET` |
| OV/EV certificate | ≤ 15 months | from the CA |

`asc.mjs certificates list` and `profiles list` print the Apple expiry dates.

## Verifying a download

- **macOS**: `spctl --assess --type execute -vv "/Applications/Rusuite Calc.app"` → `accepted`, `source=Notarized
  Developer ID`; `codesign -dv --verbose=4` shows `Authority=Developer ID Application: …`.
- **Windows**: file Properties › Digital Signatures, or PowerShell `Get-AuthenticodeSignature .\Rusuite.Calc_…_x64-setup.exe`
  → `Valid`.
- **Linux / all files**: import the public key (`keys/rusuite-release-key.asc`, also at
  <https://rusuit.es/rusuite-release-key.asc>), compare its fingerprint with the one on the Downloads page, then
  ```
  gpg --import rusuite-release-key.asc
  gpg --verify Rusuite.Calc_<version>_amd64.deb.asc Rusuite.Calc_<version>_amd64.deb
  gpg --verify SHA256SUMS.asc SHA256SUMS && sha256sum --check --ignore-missing SHA256SUMS
  ```

## Files

- `.github/workflows/release.yml` – the conditional steps and the jobs `sign-linux`, `signing-manifest`.
- `scripts/signing/ci-macos-env.sh`, `verify-macos.sh`, `tauri-sign-config.mjs`, `sign-release.sh`, `manifest.mjs`,
  `lib.sh` – used by the workflow.
- `scripts/signing/asc.mjs`, `make-csr.sh`, `p12.sh`, `gpg-key.sh` – the PM's tools.
- Tests: `node --test scripts/signing/*.test.mjs` (throwaway keys, mocked `fetch` and `gh`; nothing contacts Apple,
  Azure or GitHub).
