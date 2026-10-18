// Go To Special (Home › Find & Select ▾, Go To › Special…): Excel's list of
// criteria; the core finds the cells (`goToSpecial`), the result becomes a
// multi-area selection (P9-C7).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { GoToKind } from "../generated/GoToKind";
import type { GoToTypes } from "../generated/GoToTypes";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";

/** The dialog's choices: the core's kinds plus Current array (from the grid's spill ranges). */
export type GoToChoice = GoToKind | "currentArray";

/** Excel's two columns of choices, top to bottom. */
export const GOTO_CHOICES: GoToChoice[][] = [
  ["notes", "constants", "formulas", "blanks", "currentRegion", "currentArray"],
  ["rowDifferences", "columnDifferences", "precedents", "dependents", "lastCell", "visibleCellsOnly", "conditionalFormats", "dataValidation"],
];

export function GoToSpecialDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const [kind, setKind] = useState<GoToChoice>("constants");
  const [types, setTypes] = useState<GoToTypes>({ numbers: true, text: true, logicals: true, errors: true });
  const [all, setAll] = useState(false);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const typed = kind === "constants" || kind === "formulas";
  const levels = kind === "precedents" || kind === "dependents";
  const box = (k: keyof GoToTypes) => (
    <label className="flex items-center gap-1.5 pl-6">
      <input type="checkbox" checked={types[k]} disabled={!typed} onChange={(e) => setTypes({ ...types, [k]: e.target.checked })} />
      {t(`calc.goToSpecial.${k}`)}
    </label>
  );
  const radio = (k: GoToChoice) => (
    <label key={k} className="flex items-center gap-1.5">
      <input type="radio" name="goto-special" checked={kind === k} onChange={() => setKind(k)} />
      {t(`calc.goToSpecial.${k}`)}
    </label>
  );
  return (
    <Dialog open title={t("calc.goToSpecial.title")} onClose={close}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void store.goToSpecial(kind, types, all).then((found) => {
            if (found) close();
          });
        }}
      >
        <fieldset className="grid grid-cols-2 gap-x-6 gap-y-1">
          <legend className="sr-only">{t("calc.goToSpecial.select")}</legend>
          <div className="flex flex-col gap-1">
            {GOTO_CHOICES[0]!.slice(0, 3).map(radio)}
            {box("numbers")}
            {box("text")}
            {box("logicals")}
            {box("errors")}
            {GOTO_CHOICES[0]!.slice(3).map(radio)}
          </div>
          <div className="flex flex-col gap-1">
            {GOTO_CHOICES[1]!.slice(0, 4).map(radio)}
            <label className="flex items-center gap-1.5 pl-6">
              <input type="radio" name="goto-levels" checked={!all} disabled={!levels} onChange={() => setAll(false)} />
              {t("calc.goToSpecial.directOnly")}
            </label>
            <label className="flex items-center gap-1.5 pl-6">
              <input type="radio" name="goto-levels" checked={all} disabled={!levels} onChange={() => setAll(true)} />
              {t("calc.goToSpecial.allLevels")}
            </label>
            {GOTO_CHOICES[1]!.slice(4).map(radio)}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
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
