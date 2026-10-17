// File › Options of Write (P9-W5): General (user name), Proofing
// (AutoCorrect as you type) and Advanced (the ruler's measurement unit).
// Saved in this browser only (`features/writeOptions.ts`).

import { useEffect, useState, useSyncExternalStore } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { WriteUi } from "../features/WriteFeatures";
import { saveOptions, type AutoCorrectOptions, type RulerUnit, type WriteOptions } from "../features/writeOptions";
import { BUTTON, Buttons, INPUT, Row } from "./dialogs";
import { useT } from "../i18n";

type Page = "general" | "proofing" | "advanced";
const AC_KEYS: (keyof AutoCorrectOptions)[] = ["smartQuotes", "dashes", "replaceText", "ordinals"];

export function WriteOptionsDialog({ ui }: { ui: WriteUi }) {
  const t = useT();
  const { dialog, options } = useSyncExternalStore(ui.subscribe, ui.getState);
  const open = dialog === "writeOptions";
  const [page, setPage] = useState<Page>("general");
  const [v, setV] = useState<WriteOptions>(options);
  useEffect(() => {
    if (open) setV(options);
  }, [open, options]);
  const close = () => ui.openDialog(null);
  return (
    <Dialog open={open} title={t("write.w5.options.title")} onClose={close}>
      <form
        className="flex w-[30rem] max-w-full gap-3 text-sm"
        data-testid="write-options"
        onSubmit={(e) => {
          e.preventDefault();
          saveOptions(v);
          ui.set({ options: v, dialog: null });
        }}
      >
        <div role="tablist" aria-orientation="vertical" aria-label={t("write.w5.options.title")} className="flex w-28 shrink-0 flex-col gap-1 border-r border-ui-border pr-2">
          {(["general", "proofing", "advanced"] as Page[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={page === p} className={`rounded px-2 py-1 text-left hover:bg-ui-hover ${page === p ? "bg-ui-hover font-medium" : ""}`} onClick={() => setPage(p)}>
              {t(`write.w5.options.${p}`)}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div role="tabpanel" hidden={page !== "general"} className="flex flex-col items-start gap-2">
            <p className="text-xs text-ui-muted">{t("write.user.intro")}</p>
            <button type="button" className={BUTTON} onClick={() => ui.openDialog("userName")}>
              {t("write.w5.options.userName")}
            </button>
          </div>
          <fieldset role="tabpanel" hidden={page !== "proofing"} className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">{t("write.w5.options.autoCorrect")}</legend>
            {AC_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={v.autoCorrect[k]} onChange={(e) => setV({ ...v, autoCorrect: { ...v.autoCorrect, [k]: e.target.checked } })} />
                {t(`write.w5.ac.${k}`)}
              </label>
            ))}
          </fieldset>
          <div role="tabpanel" hidden={page !== "advanced"} className="flex flex-col gap-2">
            <Row label={t("write.w5.options.units")}>
              <select aria-label={t("write.w5.options.units")} className={`${INPUT} w-36`} value={v.rulerUnit ?? ""} onChange={(e) => setV({ ...v, rulerUnit: (e.target.value || null) as RulerUnit | null })}>
                <option value="">{t("write.w5.unit.auto")}</option>
                <option value="cm">{t("write.w5.unit.centimeters")}</option>
                <option value="in">{t("write.w5.unit.inches")}</option>
              </select>
            </Row>
          </div>
          <Buttons onClose={close} />
        </div>
      </form>
    </Dialog>
  );
}
