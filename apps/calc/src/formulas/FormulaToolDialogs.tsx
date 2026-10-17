// Dialogs of the Formulas tools (P9-C4): File › Options › Formulas
// (calculation options, R1C1 reference style), Apply Names and Paste
// Names (F3).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { CalcModeWire } from "../generated/CalcModeWire";
import type { ErrorRule } from "../generated/ErrorRule";
import { ALL_RULES, type ErrorSettings } from "../audit/controller";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";

function close(store: CalcStore): void {
  store.closeDialog();
  store.focusGrid();
}

export const CALC_MODES: readonly CalcModeWire[] = ["automatic", "automaticNoTables", "manual"];

/** File › Options › Formulas: workbook calculation and the R1C1 reference style. */
export function FormulaOptionsDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const current = useCalc(store, (s) => s.info?.calc?.options);
  const [mode, setMode] = useState<CalcModeWire>(current?.mode ?? "automatic");
  const [r1c1, setR1c1] = useState(current?.r1c1 ?? false);
  const [checks, setChecks] = useState<ErrorSettings>(() => ({ ...store.audit.settings, rules: [...store.audit.settings.rules] }));
  const rule = (r: ErrorRule) => (
    <label key={r} className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checks.rules.includes(r)}
        disabled={!checks.background}
        onChange={(e) => setChecks({ ...checks, rules: e.target.checked ? [...checks.rules, r] : checks.rules.filter((x) => x !== r) })}
      />
      {t(`calc.err.rule.${r}`)}
    </label>
  );
  return (
    <Dialog open title={t("calc.calcOpt.title")} onClose={() => close(store)}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        data-testid="formula-options"
        onSubmit={(e) => {
          e.preventDefault();
          const base = store.calcTools.options();
          store.audit.setSettings(checks);
          const same = base.mode === mode && base.r1c1 === r1c1;
          if (same) close(store);
          else void store.calcTools.setOptions({ ...base, mode, r1c1 }).then((ok) => ok && close(store));
        }}
      >
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs font-semibold">{t("calc.calcOpt.calculation")}</legend>
          {CALC_MODES.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="calc-mode" checked={mode === m} onChange={() => setMode(m)} />
              {t(`calc.calcOpt.mode.${m}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs font-semibold">{t("calc.calcOpt.working")}</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={r1c1} onChange={(e) => setR1c1(e.target.checked)} />
            {t("calc.calcOpt.r1c1")}
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs font-semibold">{t("calc.calcOpt.errorChecking")}</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={checks.background} onChange={(e) => setChecks({ ...checks, background: e.target.checked })} />
            {t("calc.calcOpt.background")}
          </label>
          <p className="mt-1 text-xs font-semibold">{t("calc.calcOpt.rules")}</p>
          {ALL_RULES.map(rule)}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={() => close(store)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Formulas › Define Name ▾ › Apply Names…: the names to apply, "Ignore Relative/Absolute". */
export function ApplyNamesDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const names = store.calcTools.pastableNames();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ignore, setIgnore] = useState(true);
  const toggle = (n: string) => {
    const next = new Set(picked);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setPicked(next);
  };
  return (
    <Dialog open title={t("calc.applyNames.title")} onClose={() => close(store)}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        data-testid="apply-names"
        onSubmit={(e) => {
          e.preventDefault();
          if (picked.size === 0) return;
          void store.calcTools.applyNames([...picked], ignore).then((ok) => ok && close(store));
        }}
      >
        <span className="text-xs">{t("calc.applyNames.names")}</span>
        <div role="listbox" aria-multiselectable aria-label={t("calc.applyNames.names")} className="flex h-40 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
          {names.length === 0 && <span className="px-2 text-ui-muted">{t("calc.names.none")}</span>}
          {names.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={picked.has(n)}
              className={`px-2 py-0.5 text-left font-mono ${picked.has(n) ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => toggle(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={ignore} onChange={(e) => setIgnore(e.target.checked)} />
          {t("calc.applyNames.ignoreRelative")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={() => close(store)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={picked.size === 0}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Paste Names (F3): a name into the formula, or Paste List. */
export function PasteNamesDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const names = store.calcTools.pastableNames();
  const [picked, setPicked] = useState<string | null>(names[0] ?? null);
  const editing = !!store.getState().edit;
  const done = () => {
    store.closeDialog();
    if (store.getState().edit) store.focusEditor();
    else store.focusGrid();
  };
  const paste = (n: string) => {
    store.closeDialog();
    store.calcTools.pasteName(n);
  };
  return (
    <Dialog open title={t("calc.pasteNames.title")} onClose={done}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        data-testid="paste-names"
        onSubmit={(e) => {
          e.preventDefault();
          if (picked) paste(picked);
        }}
      >
        <span className="text-xs">{t("calc.pasteNames.list")}</span>
        <div role="listbox" aria-label={t("calc.pasteNames.list")} className="flex h-40 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
          {names.length === 0 && <span className="px-2 text-ui-muted">{t("calc.names.none")}</span>}
          {names.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={picked === n}
              className={`px-2 py-0.5 text-left font-mono ${picked === n ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => setPicked(n)}
              onDoubleClick={() => paste(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between gap-2">
          <button
            type="button"
            className={BTN}
            disabled={names.length === 0 || editing}
            onClick={() => {
              store.closeDialog();
              void store.calcTools.pasteList().then(() => store.focusGrid());
            }}
          >
            {t("calc.pasteNames.pasteList")}
          </button>
          <span className="flex gap-2">
            <button type="button" className={BTN} onClick={done}>
              {t("common.cancel")}
            </button>
            <button type="submit" className={BTN} disabled={!picked}>
              {t("common.ok")}
            </button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}
