// Formulas › Error Checking and Evaluate Formula (P9-C4), as in Excel:
// the Error Checking dialog walks the flagged cells (Next / Previous,
// Ignore Error, Edit in Formula Bar and the rule's fix), Evaluate Formula
// steps through a formula with Evaluate / Step In / Step Out.

import { Dialog } from "@rusuite/ui-shared";
import type { ErrorIssue } from "../generated/ErrorIssue";
import { cellAddress, colName, sheetPrefix } from "../grid/address";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";

function close(store: CalcStore): void {
  store.closeDialog();
  store.focusGrid();
}

/** The fix a rule offers (Excel's first button / menu item). */
export function fixFor(store: CalcStore, issue: ErrorIssue): { label: string; run: () => void } | null {
  switch (issue.rule) {
    case "numberAsText":
      return { label: "calc.err.convert", run: () => void store.audit.convertToNumber() };
    case "inconsistentFormula":
      return issue.suggestion ? { label: "calc.err.copyFormula", run: () => void store.audit.copySuggestion(issue) } : null;
    case "unlockedFormula":
      return { label: "calc.err.lock", run: () => void store.audit.lockCell(issue) };
    default:
      return { label: "calc.err.showSteps", run: () => void store.audit.evaluate() };
  }
}

export function ErrorCheckingDialog({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.selection);
  const st = store.getState();
  const a = st.selection.anchor;
  const issue = store.audit.issueAt(st.activeSheet, a.row, a.col);
  const any = store.audit.issuesOn(st.activeSheet).length > 0;
  const sheetName = st.info?.sheets.find((s) => s.id === st.activeSheet)?.name ?? "";
  const info = issue ? store.audit.describe(issue) : null;
  const fix = issue ? fixFor(store, issue) : null;
  const after = (run: () => void) => () => {
    run();
    // Excel moves on to the next error after a fix or Ignore.
    window.setTimeout(() => store.audit.step(1, false), 150);
  };
  return (
    <Dialog open title={t("calc.err.dialogTitle")} onClose={() => close(store)}>
      <div className="flex w-[30rem] gap-3 text-sm" data-testid="error-checking">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {issue && info ? (
            <>
              <p className="font-semibold" data-testid="error-cell">
                {t("calc.err.inCell", { cell: `${sheetPrefix(sheetName)}${cellAddress(issue.row, issue.col)}` })}
              </p>
              <p className="rounded border border-ui-border bg-ui-bg px-2 py-1 font-mono text-xs" data-testid="error-input">
                {store.activeCell()?.input ?? ""}
              </p>
              <p className="font-semibold" data-testid="error-title">
                {info.title}
              </p>
              <p className="text-xs">{info.text}</p>
            </>
          ) : (
            <p data-testid="error-done">{any ? t("calc.err.pick") : t("calc.err.complete")}</p>
          )}
        </div>
        <div className="flex w-48 flex-col gap-1">
          {fix && (
            <button type="button" className={BTN} onClick={after(fix.run)}>
              {t(fix.label)}
            </button>
          )}
          <button type="button" className={BTN} disabled={!issue} onClick={() => issue && after(() => store.audit.ignore(issue))()}>
            {t("calc.err.ignore")}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!issue}
            onClick={() => {
              store.closeDialog();
              store.beginEdit(null, "bar");
              store.focusEditor();
            }}
          >
            {t("calc.err.editInBar")}
          </button>
          <button type="button" className={BTN} onClick={() => store.openDialog({ kind: "formulaOptions" })}>
            {t("calc.err.options")}
          </button>
          <span className="flex-1" />
          <div className="flex gap-1">
            <button type="button" className={`${BTN} flex-1`} disabled={!any} onClick={() => store.audit.step(-1)}>
              {t("calc.err.previous")}
            </button>
            <button type="button" className={`${BTN} flex-1`} disabled={!any} onClick={() => store.audit.step(1)}>
              {t("calc.err.next")}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** The formula text with the part evaluated next underlined. */
function Underlined({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <span>
      {text.slice(0, start)}
      <u data-testid="eval-next" className="decoration-2">
        {text.slice(start, end)}
      </u>
      {text.slice(end)}
    </span>
  );
}

export function EvaluateFormulaDialog({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const frames = store.audit.frames;
  const f = frames[frames.length - 1];
  if (!f) return null;
  const steps = f.evaluation.steps;
  const done = f.index >= steps.length;
  const step = done ? null : steps[f.index]!;
  const names = store.getState().info?.sheets ?? [];
  const ref = `${sheetPrefix(names.find((s) => s.id === f.sheet)?.name ?? "")}${"$"}${colName(f.col)}$${f.row + 1}`;
  return (
    <Dialog open title={t("calc.eval.title")} onClose={() => close(store)}>
      <div className="flex w-[34rem] flex-col gap-2 text-sm" data-testid="evaluate-formula">
        <div className="flex gap-2">
          <div className="w-36 shrink-0">
            <p className="text-xs">{t("calc.eval.reference")}</p>
            <p className="font-mono" data-testid="eval-ref">
              {ref}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs">{t("calc.eval.evaluation")}</p>
            <p className="min-h-16 break-all rounded border border-ui-border bg-ui-bg px-2 py-1 font-mono" data-testid="eval-text">
              {f.evaluation.formula === "" ? f.evaluation.result : step ? <Underlined text={step.text} start={step.start} end={step.end} /> : f.evaluation.result}
            </p>
          </div>
        </div>
        <p className="text-xs text-ui-muted">{step ? t("calc.eval.hint") : t("calc.eval.doneHint")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} disabled={f.evaluation.formula === ""} onClick={() => store.audit.evalNext()}>
            {done ? t("calc.eval.restart") : t("calc.eval.evaluate")}
          </button>
          <button type="button" className={BTN} disabled={!step?.stepIn} onClick={() => void store.audit.stepIn()}>
            {t("calc.eval.stepIn")}
          </button>
          <button type="button" className={BTN} disabled={frames.length < 2} onClick={() => store.audit.stepOut()}>
            {t("calc.eval.stepOut")}
          </button>
          <button type="button" className={BTN} onClick={() => close(store)}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
