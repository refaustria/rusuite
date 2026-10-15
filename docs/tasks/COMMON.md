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
