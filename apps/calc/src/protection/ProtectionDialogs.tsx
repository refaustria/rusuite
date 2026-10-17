// Excel's protection dialogs (P9-C1): Protect Sheet (password, "Allow all
// users of this worksheet to" list, then Confirm Password), Protect
// Structure and Windows, and the Unprotect Sheet / Workbook password
// prompt. A wrong password shows Excel's message in the dialog.

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import { CalcApiError } from "../backend/calcApi";
import type { SheetProtection } from "../generated/SheetProtection";
import type { CalcStore } from "../state/store";
import { useT } from "../i18n";
import { ALLOW_OPTIONS, DEFAULT_SHEET_PROTECTION, newSalt } from "./protection";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

function useClose(store: CalcStore) {
  return () => {
    store.closeDialog();
    store.focusGrid();
  };
}

/** The Confirm Password step both protect dialogs share ("Reenter password to proceed."). */
function ConfirmStep({ onBack, onConfirm, password }: { onBack: () => void; onConfirm: () => void; password: string }) {
  const t = useT();
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="flex w-80 flex-col gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (again !== password) setError(t("calc.protect.mismatch"));
        else onConfirm();
      }}
    >
      <label className="flex flex-col gap-1">
        {t("calc.protect.reenter")}
        <input autoFocus type="password" aria-label={t("calc.protect.reenter")} className={FIELD} value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      <p className="text-xs text-ui-muted">{t("calc.protect.caution")}</p>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="submit" className={BTN}>
          {t("common.ok")}
        </button>
        <button type="button" className={BTN} onClick={onBack}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

export function ProtectSheetDialog({ store, sheet }: { store: CalcStore; sheet: number }) {
  const t = useT();
  const close = useClose(store);
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<SheetProtection>({ ...DEFAULT_SHEET_PROTECTION });
  const [confirm, setConfirm] = useState(false);
  const submit = () => {
    close();
    void store.applyChecked({ type: "protectSheet", sheet, options, ...(password ? { password, salt: newSalt() } : {}) });
  };
  return (
    <Dialog open title={confirm ? t("calc.protect.confirmTitle") : t("calc.protect.sheetTitle")} onClose={close}>
      {confirm ? (
        <ConfirmStep password={password} onBack={() => setConfirm(false)} onConfirm={submit} />
      ) : (
        <form
          className="flex w-80 flex-col gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) setConfirm(true);
            else submit();
          }}
        >
          <label className="flex items-center gap-2">
            <input type="checkbox" checked disabled readOnly />
            {t("calc.protect.contents")}
          </label>
          <label className="flex flex-col gap-1">
            {t("calc.protect.sheetPassword")}
            <input autoFocus type="password" aria-label={t("calc.protect.sheetPassword")} className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <span id="calc-protect-allow">{t("calc.protect.allow")}</span>
          <div role="group" aria-labelledby="calc-protect-allow" className="flex max-h-56 flex-col overflow-auto rounded border border-ui-border bg-ui-bg p-1">
            {ALLOW_OPTIONS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={!options[key]} onChange={(e) => setOptions((o) => ({ ...o, [key]: !e.target.checked }))} />
                {t(label)}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="submit" className={BTN}>
              {t("common.ok")}
            </button>
            <button type="button" className={BTN} onClick={close}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function ProtectWorkbookDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const [password, setPassword] = useState("");
  const [structure, setStructure] = useState(true);
  const [windows, setWindows] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const submit = () => {
    close();
    void store.applyChecked({ type: "protectWorkbook", structure, windows, ...(password ? { password, salt: newSalt() } : {}) });
  };
  return (
    <Dialog open title={confirm ? t("calc.protect.confirmTitle") : t("calc.protect.bookTitle")} onClose={close}>
      {confirm ? (
        <ConfirmStep password={password} onBack={() => setConfirm(false)} onConfirm={submit} />
      ) : (
        <form
          className="flex w-72 flex-col gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) setConfirm(true);
            else submit();
          }}
        >
          <span>{t("calc.protect.bookFor")}</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={structure} onChange={(e) => setStructure(e.target.checked)} />
            {t("calc.protect.structure")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={windows} onChange={(e) => setWindows(e.target.checked)} />
            {t("calc.protect.windows")}
          </label>
          <label className="flex flex-col gap-1">
            {t("calc.protect.bookPassword")}
            <input type="password" aria-label={t("calc.protect.bookPassword")} className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="submit" className={BTN} disabled={!structure && !windows}>
              {t("common.ok")}
            </button>
            <button type="button" className={BTN} onClick={close}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function UnprotectDialog({ store, target, sheet }: { store: CalcStore; target: "sheet" | "workbook"; sheet: number }) {
  const t = useT();
  const close = useClose(store);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog open title={target === "sheet" ? t("calc.protect.unprotectSheet") : t("calc.protect.unprotectBook")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const cmd = target === "sheet" ? ({ type: "unprotectSheet", sheet, password } as const) : ({ type: "unprotectWorkbook", password } as const);
          void store.api
            .apply(cmd)
            .then((env) => {
              store.applyEnvelope(env);
              close();
            })
            .catch((err: unknown) => {
              if (err instanceof CalcApiError && err.code === "wrong_password") setError(t("calc.protect.wrongPassword"));
              else {
                close();
                store.pushError(err);
              }
            });
        }}
      >
        <label className="flex flex-col gap-1">
          {t("calc.protect.password")}
          <input autoFocus type="password" aria-label={t("calc.protect.password")} className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
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
