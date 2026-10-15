// Data › Data Validation…: Excel's dialog with the Settings, Input Message
// and Error Alert tabs (Clear All, OK, Cancel), and the alert a failed
// check of a committed edit shows (Stop: Retry / Cancel; Warning: Yes /
// No / Cancel; Information: OK / Cancel).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { CompareOp } from "../generated/CompareOp";
import type { ErrorStyle } from "../generated/ErrorStyle";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import {
  ALLOW_KINDS, ERROR_STYLES, formFromValidation, VALIDATION_OPS, validationFromForm, type AllowKind, type ValidationForm,
} from "./validation";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg disabled:opacity-50";

type Tab = "settings" | "input" | "error";

export function ValidationDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const [f, setF] = useState<ValidationForm>(() => formFromValidation(store.activeValidation()));
  const [tab, setTab] = useState<Tab>("settings");
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<ValidationForm>) => {
    setF((x) => ({ ...x, ...p }));
    setError(null);
  };
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const between = f.op === "between" || f.op === "notBetween";
  const compared = f.allow !== "any" && f.allow !== "list" && f.allow !== "custom";
  const tabs: Tab[] = ["settings", "input", "error"];
  return (
    <Dialog open title={t("calc.dv.title")} onClose={close}>
      <form
        className="flex w-[28rem] max-w-[calc(100vw-3rem)] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const r = validationFromForm(f, store.selectionRects());
          if ("error" in r) {
            setTab("settings");
            setError(t(r.error));
            return;
          }
          close();
          void (r.validation ? store.setValidation(r.validation) : store.removeValidation());
        }}
      >
        <div role="tablist" aria-label={t("calc.dv.title")} className="flex gap-1 border-b border-ui-border">
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className="-mb-px rounded-t border border-transparent px-3 py-1 aria-selected:border-ui-border aria-selected:border-b-ui-panel aria-selected:bg-ui-panel"
              onClick={() => setTab(k)}
            >
              {t(`calc.dv.tab.${k}`)}
            </button>
          ))}
        </div>
        {tab === "settings" && (
          <div role="tabpanel" aria-label={t("calc.dv.tab.settings")} className="flex flex-col gap-2">
            <span className="font-medium">{t("calc.dv.criteria")}</span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                {t("calc.dv.allow")}
                <select className={FIELD} value={f.allow} onChange={(e) => set({ allow: e.target.value as AllowKind })}>
                  {ALLOW_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`calc.dv.allow.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={f.allowBlank} disabled={f.allow === "any"} onChange={(e) => set({ allowBlank: e.target.checked })} />
                {t("calc.dv.ignoreBlank")}
              </label>
              {f.allow === "list" && (
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={f.showDropdown} onChange={(e) => set({ showDropdown: e.target.checked })} />
                  {t("calc.dv.dropdown")}
                </label>
              )}
            </div>
            {compared && (
              <>
                <label className="flex items-center gap-2">
                  <span className="w-24">{t("calc.dv.data")}</span>
                  <select className={FIELD} value={f.op} onChange={(e) => set({ op: e.target.value as CompareOp })}>
                    {VALIDATION_OPS.map((op) => (
                      <option key={op} value={op}>
                        {t(`calc.op.${op}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-24">{between ? t("calc.dv.minimum") : t("calc.dv.value")}</span>
                  <input className={`${FIELD} flex-1`} value={f.f1} onChange={(e) => set({ f1: e.target.value })} />
                </label>
                {between && (
                  <label className="flex items-center gap-2">
                    <span className="w-24">{t("calc.dv.maximum")}</span>
                    <input className={`${FIELD} flex-1`} value={f.f2} onChange={(e) => set({ f2: e.target.value })} />
                  </label>
                )}
              </>
            )}
            {f.allow === "list" && (
              <label className="flex items-center gap-2">
                <span className="w-24">{t("calc.dv.source")}</span>
                <input className={`${FIELD} flex-1`} value={f.source} placeholder={t("calc.dv.sourceHint")} onChange={(e) => set({ source: e.target.value })} />
              </label>
            )}
            {f.allow === "custom" && (
              <label className="flex items-center gap-2">
                <span className="w-24">{t("calc.dv.formula")}</span>
                <input className={`${FIELD} flex-1`} value={f.formula} onChange={(e) => set({ formula: e.target.value })} />
              </label>
            )}
          </div>
        )}
        {tab === "input" && (
          <div role="tabpanel" aria-label={t("calc.dv.tab.input")} className="flex flex-col gap-2">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.showInput} onChange={(e) => set({ showInput: e.target.checked })} />
              {t("calc.dv.showInput")}
            </label>
            <label className="flex flex-col gap-1">
              {t("calc.dv.inputTitle")}
              <input className={FIELD} value={f.inputTitle} maxLength={32} onChange={(e) => set({ inputTitle: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              {t("calc.dv.inputMessage")}
              <textarea className={`${FIELD} h-24 py-1`} value={f.inputMessage} maxLength={255} onChange={(e) => set({ inputMessage: e.target.value })} />
            </label>
          </div>
        )}
        {tab === "error" && (
          <div role="tabpanel" aria-label={t("calc.dv.tab.error")} className="flex flex-col gap-2">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.showError} onChange={(e) => set({ showError: e.target.checked })} />
              {t("calc.dv.showError")}
            </label>
            <label className="flex items-center gap-2">
              <span className="w-24">{t("calc.dv.style")}</span>
              <select className={FIELD} value={f.errorStyle} onChange={(e) => set({ errorStyle: e.target.value as ErrorStyle })}>
                {ERROR_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {t(`calc.dv.style.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t("calc.dv.errorTitle")}
              <input className={FIELD} value={f.errorTitle} maxLength={32} onChange={(e) => set({ errorTitle: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              {t("calc.dv.errorMessage")}
              <textarea className={`${FIELD} h-24 py-1`} value={f.errorMessage} maxLength={255} onChange={(e) => set({ errorMessage: e.target.value })} />
            </label>
          </div>
        )}
        <div role="alert" className="min-h-5 text-xs text-red-700">
          {error}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={`${BTN} mr-auto`}
            onClick={() => {
              close();
              void store.removeValidation();
            }}
          >
            {t("calc.dv.clearAll")}
          </button>
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const ALERT_ICON: Record<ErrorStyle, { glyph: string; color: string }> = {
  stop: { glyph: "✕", color: "#d13438" },
  warning: { glyph: "!", color: "#c19c00" },
  information: { glyph: "i", color: "#0078d4" },
};

/** The alert of a value that failed its cell's validation; the edit stays open behind it. */
export function ValidationAlertDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const alert = useCalc(store, (s) => s.validationAlert);
  if (!alert) return null;
  const answer = (a: "accept" | "retry" | "cancel") => () => void store.answerValidation(a);
  const icon = ALERT_ICON[alert.style];
  return (
    <Dialog open title={alert.title || "Rusuite Calc"} onClose={answer("cancel")}>
      <div className="flex w-96 max-w-[calc(100vw-3rem)] flex-col gap-4 text-sm" data-testid="validation-alert" data-style={alert.style}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
            style={{ background: icon.color }}
          >
            {icon.glyph}
          </span>
          <div className="flex flex-col gap-2">
            <p className="whitespace-pre-wrap">{alert.message}</p>
            {alert.style === "warning" && <p>{t("calc.dv.continue")}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {alert.style === "stop" && (
            <>
              <button type="button" className={BTN} onClick={answer("retry")}>
                {t("calc.dv.retry")}
              </button>
              <button type="button" className={BTN} onClick={answer("cancel")}>
                {t("common.cancel")}
              </button>
            </>
          )}
          {alert.style === "warning" && (
            <>
              <button type="button" className={BTN} onClick={answer("accept")}>
                {t("calc.dv.yes")}
              </button>
              <button type="button" className={BTN} onClick={answer("retry")}>
                {t("calc.dv.no")}
              </button>
              <button type="button" className={BTN} onClick={answer("cancel")}>
                {t("common.cancel")}
              </button>
            </>
          )}
          {alert.style === "information" && (
            <>
              <button type="button" className={BTN} onClick={answer("accept")}>
                {t("common.ok")}
              </button>
              <button type="button" className={BTN} onClick={answer("cancel")}>
                {t("common.cancel")}
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
