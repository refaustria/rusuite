# Rusuite – Project Status

_Maintained by the PM agent. Read at the start of every session; update after every task._

## Current phase: Phase 0 – Foundation

Milestone: workspace + CI green, `fmt-ooxml` opens/writes OOXML packages, `core-model` has run formatting / colors / fonts / theme colors, roundtrip harness runs against LibreOffice headless, first ADRs written.

## Task board

| ID | Task | Model | State | Branch | Notes |
|---|---|---|---|---|---|
| P0-1 | Workspace scaffold: Cargo workspace (all crates as stubs), pnpm workspace, fmt/clippy config, `pnpm test` placeholder, CI workflow, .gitignore, LICENSE | Sonnet | todo | `p0/workspace` | everything else depends on this |
| P0-2 | `fmt-ooxml`: open ZIP package, parse `[Content_Types].xml` + `_rels`, generic XML helpers, write package back byte-stable | Opus | todo | `p0/fmt-ooxml` | needs provisional reference files (P0-5) |
| P0-3 | `core-model`: run formatting, colors (RGB/theme/auto), font definitions, theme colors, serde derive | Opus | todo | `p0/core-model` | types specified in brief by PM |
| P0-4 | Roundtrip harness: `scripts/roundtrip.sh` + `xtask roundtrip` – read → write → open in headless LibreOffice → count errors/warnings; reports per file | Sonnet | todo | `p0/roundtrip` | first version uses copy-through, then wires to fmt-ooxml |
| P0-5 | Provisional reference files in `testdata/{docx,xlsx,pptx}` generated with LibreOffice headless | Sonnet | todo | (with P0-4) | PROVISIONAL – need real-Office files from owner |
| P0-6 | ADRs: 0001 Rust owns the document model, 0002 IPC strategy, 0003 workspace/crate layout | PM | todo | `p0/adrs` | PM writes docs, not code |
| P0-7 | `docs/setup.md` – what was installed on the dev server | PM | todo | `p0/adrs` | |

## Environment (dev server)
- Debian 13, 16 cores, 30 GB RAM
- Installed this session: rustup (stable 1.99, clippy, rustfmt), pnpm 12 (via npm -g), LibreOffice headless (apt). Details in `docs/setup.md`.
- Tauri system deps (webkit2gtk-4.1-dev, gtk-3-dev, build-essential, pkg-config) were already present.

## Last decisions
1. 2026-10-15: Git identity for commits set locally to `Bojan <bojan@referee.at>` (previous commits were by `refaustria`). Change with `git config user.*` if wrong.
2. 2026-10-15: Phase 0 split into 7 tasks; P0-1 runs first, then P0-2/3/4 in parallel.
3. 2026-10-15: `core-model` Phase 0 scope implemented by Opus against a PM-written type spec, not Fable (scope is a well-understood OOXML mapping; escalate only if design questions arise).
4. 2026-10-15: Roundtrip harness verification = LibreOffice headless `--convert-to` of the rewritten file succeeds and the output is non-empty, plus a structural diff of the ZIP part list and XML against the original. (LibreOffice has no "repair dialog" counter in headless mode; a failed/empty conversion is the proxy.)

## Open questions for the owner
- Reference files: `testdata/` is empty. I am generating PROVISIONAL files with LibreOffice. Please provide real-Office files when you can: a small `.docx` (headings, bold/italic runs, list, table, image), a `.xlsx` (2 sheets, numbers/text/dates, a few formulas, styled cells), a `.pptx` (3 slides, title/content layouts, shapes, image).
- Git identity (see decision 1).

## Blocked
- none
