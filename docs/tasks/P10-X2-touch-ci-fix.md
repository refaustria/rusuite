# Task P10-X2 – Touch e2e stability on CI: the floating selection bar's tap after a long press

Read `docs/tasks/COMMON.md` first (incl. "Cycle 3.1415"; e2e port 5022), then `packages/ui-shared/src/compact/longPress.ts` (the `installLongPress` quiet window, `QUIET_MS`), `apps/write/src/touch/*` (selection bar, handles), `packages/e2e/tests/write-touch.spec.ts` (`selectionFlow`, `longPress` helper), `packages/e2e/support/*`, `docs/testing.md` ("stable e2e" guide), `.github/workflows/ci.yml` (e2e job: 2 workers, one retry, `timeout-minutes`).

Branch `p10/x2-touch-ci-fix`, worktree `/home/bojan/rusuite-wt/p10-x2-touch-ci-fix`. Model: Opus.

## Failure (CI run 39929879970 on main, both `mobile` and `tablet` projects, retry too; passes locally)
`write-touch.spec.ts` › `selectionFlow`: after the long press selected the word and the floating bar appeared, `bold.tap()` on the bar's Bold button leaves `aria-pressed="false"` (expect timeout 10 s). Hypotheses to verify with a trace (download the trace artifact of that run with `gh run download 39929879970 -n <artifact>` if still available – otherwise reproduce locally with CPU throttling: `page.emulateMedia`, `CDPSession.send("Emulation.setCPUThrottlingRate", { rate: 6 })`):
1. The quiet window of `installLongPress` (400 ms, 250 ms after P10-X1) swallows the bar's tap on a slow runner: the quiet window must apply **only to the long-pressed target** (the document/editor), never to UI controls (the selection bar, sheets, bars); or the bar's buttons act on `pointerup` with `pointerType === "touch"` and stop the synthesized click.
2. The tap lands while the bar is re-positioning (selection change → bar moves); the test must wait for the bar to be stable (`toBeVisible` + a `boundingBox` that is unchanged across two frames, or a `data-stable` attribute set by the bar after positioning).
3. The synthesized `click` after a touch is cancelled because the editor re-focuses (ProseMirror) on `touchend` – then handle `pointerup` in the bar.
Fix the root cause in the code (not only the test); keep mouse behaviour identical; add a unit test for the quiet-window scoping in `compact.test.tsx`/`longPress` tests.

## Also
- Review the other `*-touch.spec.ts` and `compact.spec.ts` flows for the same pattern (a tap on a UI control right after a long press or after a selection change) and apply the same helper (`tapStable(locator)` in `packages/e2e/support`), including Calc's fill-handle tap and Show's long-press menus.
- The CI e2e job: raise `timeout-minutes` to 30 and set `retries: 1` only on CI (already?) – check; make sure `playwright install --with-deps` is cached (actions/cache on `~/.cache/ms-playwright`, keyed by the Playwright version) so setup takes seconds, not 8–11 minutes.
- `docs/testing.md`: add "taps after long press / selection changes" to the stable-e2e guide.

## Verification
`pnpm typecheck`; `pnpm test`; full e2e on port 5022 three times for the `mobile` + `tablet` projects (`--repeat-each=3` for the touch specs) with CPU throttling ×4 in the test fixture via an env flag (`E2E_SLOW=1` → `Emulation.setCPUThrottlingRate`), and once without; push your branch so the CI e2e job runs on it (`gh run list --branch p10/x2-touch-ci-fix`) – paste the run URL with the e2e job green. One commit per item (code fix, test helpers, CI), trailer as in COMMON. Report (≤ 30 lines): the verified root cause (from the trace), the fix, CI timings before/after.
