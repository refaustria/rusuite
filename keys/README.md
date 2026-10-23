# Release signing keys

`rusuite-release-key.asc` (added by the PM, docs/signing.md) is the public half of the **Rusuite release key**
(`Rusuite release key <release@rusuit.es>`). It signs the Linux packages (`<file>.asc`) and `SHA256SUMS` of every
release from 3.1415 on. The private key is never in this repository; it lives in `~/rusuite-signing/` and in the
`GPG_PRIVATE_KEY` repository secret. `scripts/deploy-web.sh` publishes the file as
<https://rusuit.es/rusuite-release-key.asc> when it exists.

Verify a download:

```
gpg --import rusuite-release-key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
gpg --verify Rusuite.Calc_3.1415.0_amd64.deb.asc Rusuite.Calc_3.1415.0_amd64.deb
```
