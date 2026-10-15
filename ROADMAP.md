# Roadmap – ideas beyond the README scope

Captured here, **not implemented** unless essential to the current phase. README is the authority on scope.

## Tooling / DX
- `cargo xtask` crate for dev commands (roundtrip, testdata generation) instead of shell scripts – shell is fine for Phase 0.
- Pre-commit hook running `cargo fmt --check` and `clippy`.
- Nightly CI job running the roundtrip harness against LibreOffice (slow; keep out of PR CI).

## Formats
- Compare rewritten files against Open XML SDK validator (Windows/.NET) in addition to LibreOffice – gives real "would Office repair this" signal.

## Later phases (noted while planning Phase 0)
- (none yet)
