## Common rules (all Rusuite tasks)
- Repo: /home/bojan/rusuite. Read README.md ("Architecture", "Core Principles", "Repository Structure", "Contributing") and docs/adr/*.md first. Do NOT expand scope beyond this brief; put ideas in your final report, not in code.
- Toolchain: start every Bash call with `export PATH="$HOME/.cargo/bin:$PATH"`. LibreOffice is at `soffice`.
- Other agents work in the SAME working tree on other branches/crates at the same time. Touch ONLY the paths listed in "In scope". Never run `git checkout`/`git switch`/`git stash`/`git reset`/`git clean`; instead create your own branch with `git worktree add /home/bojan/rusuite-wt/<branch> -b <branch> main` and work inside that worktree. Run all commands from inside the worktree.
- Rust: `#![forbid(unsafe_code)]`, `thiserror` for errors (no anyhow), serde derives on model types, unit tests next to code, integration tests in `tests/`, no new dependencies beyond those listed in the brief without a strong reason stated in the report.
- Definition of done, run from the worktree root, all must pass:
```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
- Git: exactly one commit on your branch when done. Message: "<TASK-ID>: <summary>" + short body. End the message with exactly these two lines:
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YGiiEDN1zSPaDE4h1jA1hU
- Do not push. Do not touch README.md, STATUS.md, ROADMAP.md, docs/adr/, or any crate not in scope.
- Final report (max 50 lines): what you built, public API summary, acceptance outputs (tail), anything you could not do, ideas for ROADMAP.

## Deployment (added 2026-10-15)
- Agents never run `scripts/deploy-web.sh` or touch the live server (parallel branch deploys overwrite each other). The PM deploys from `main` after merging.
- For live checks use the e2e suite against a local server on a private port (`BASE_URL`), never against `resuite.inceptum.at`.

## Disk (added 2026-10-15)
- The server disk is shared; a worktree's `target/` is ~7–14 GB (dev profile now uses line-tables-only debug info). Use your worktree's own `target/` (never `CARGO_TARGET_DIR` pointing at another checkout: test binaries bake in the manifest path and insta snapshots then fail). Do not run `cargo build --release` for the whole workspace unless the brief asks; delete large temporary artifacts you create. If `df -h /` shows < 10 GB free, stop and report instead of filling the disk.
- e2e servers: start your `serve.mjs` on a private port derived from your task number (e.g. P8-33 → 4833; never 4391 or 4321, which other agents use), remember its PID, and stop it with `kill <PID>` before you report. Never leave a server running and never use `pkill -f serve.mjs` (it kills other agents' servers).
- Never `git add` screenshots or `.task` files: `shots/` and `.task/` are git-ignored; use `git add <paths>` rather than `git add -A` when your worktree has such folders. The scratchpad directory is shared by all agents of a session: never write fixed file names there (`serve.pid`, `out.txt`). Keep per-task state inside your own worktree (e.g. `<worktree>/.task/serve.pid`, git-ignored) or prefix every scratchpad file with your task id (`P8-33-serve.pid`). Screenshots: `shots/<task-id>-*.png`.

## Cycle 3.141 (added 2026-10-17)
- Task ids `P9-C<n>` (Calc), `P9-S<n>` (Show), `P9-W<n>` (Write), `P9-L<n>` (languages), `P9-A<n>` (AI). e2e ports: Calc 491n, Show 492n, Write 493n, languages 494n, AI 495n (n = batch number). Screenshots `shots/<task-id>-*.png`.
- No version bumps, tags or release builds during the cycle (owner rule, docs/versioning.md); the PM does the release at the end.

## Cycle 3.1415 (added 2026-10-22)
- Task ids `P10-S<n>` (signing), `P10-M<n>` (mobile), `P10-R<n>` (release). e2e ports: signing 502n, mobile 501n (n = task number, e.g. P10-M2 → 5012), release 5030. Screenshots `shots/<task-id>-*.png`. Plan: `docs/plan-3.1415.md`.
- No version bumps, tags or release builds during the cycle; the PM releases at the end. Version strings stay `3.141.0` until P10-R1.
- Secrets: never commit, print or log a key, password, keystore, certificate or token. Signing material lives in `~/rusuite-signing/` (PM only) and in GitHub repository secrets; scripts and workflows read them from the environment and must work (unsigned) when they are absent.
- Mobile CI: iOS cannot be built on this server. A task whose brief says so may push its own branch to `origin` (only its branch, `git push -u origin <branch>`) to run `.github/workflows/mobile.yml`; never push `main` or tags. Watch runs with `gh run list --branch <branch>` / `gh run view <id> --log-failed`.
- Android builds locally: SDK `/home/bojan/android-sdk` (platforms 34–36, build-tools 36, NDK 28.2.13676358, no emulator – no `/dev/kvm`), Java 21 at `/usr/bin/java`. Export `ANDROID_HOME=/home/bojan/android-sdk NDK_HOME=/home/bojan/android-sdk/ndk/28.2.13676358 JAVA_HOME=$(dirname $(dirname $(readlink -f /usr/bin/java)))` and add the Rust targets you need with `rustup target add`.
