// The dialogs Calc opens through the store (`store.openDialog`): Format
// Cells (number format, Ctrl+1, numfmt/NumberFormatDialog.tsx), the name
// dialogs (names/NameDialogs.tsx), Insert Function, Find & Replace (Ctrl+F / Ctrl+H), the
// row height / column width prompts, the sheet dialogs (confirm
// delete, rename, tab colour, unhide), the merge warning and the sort /
// AutoFilter dialogs (sortFilter/SortFilterDialogs.tsx), conditional
// formatting (condFormat/CfDialogs.tsx) and data validation
// (validation/ValidationDialogs.tsx).

import { useEffect, useRef, useState } from "react";
import { cssColor, Dialog, OFFICE_THEME, PromptDialog, STANDARD_COLORS, THEME_SLOTS, type Color } from "@rusuite/ui-shared";
import { NumberFormatDialog } from "./numfmt/NumberFormatDialog";
import { CreateNamesDialog, DefineNameDialog, GoToDialog, NameManagerDialog } from "./names/NameDialogs";
import { InsertFunctionDialog } from "./formulas/InsertFunctionDialog";
import type { FindOptions } from "./state/find";
import { unhideableSheets, useCalc, type CalcStore } from "./state/store";
import { useT } from "./i18n";
import { CfDialog } from "./condFormat/CfDialogs";
import { ValidationDialog } from "./validation/ValidationDialogs";
import { ChartDialog } from "./charts/ChartDialogs";
import { LinkDialog, UserNameDialog } from "./comments/LinkDialog";
import { CustomFilterDialog, CustomSortDialog, FilterPanel, SortExpandDialog, Top10Dialog } from "./sortFilter/SortFilterDialogs";
import { PivotDialog } from "./pivot/PivotDialogs";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

/** Non-modal Find & Replace panel (the grid stays usable while it is open). */
function FindPanel({ store, replace }: { store: CalcStore; replace: boolean }) {
  const t = useT();
  const [opts, setOpts] = useState<FindOptions>({ query: "", matchCase: false, wholeCell: false, allSheets: false });
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(replace);
  const [status, setStatus] = useState("");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => setShowReplace(replace), [replace]);
  useEffect(() => first.current?.focus(), [replace]);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const set = (p: Partial<FindOptions>) => {
    setOpts((o) => ({ ...o, ...p }));
    setStatus("");
  };
  const report = (hit: unknown) => setStatus(hit ? "" : t("calc.find.noMatch"));
  const empty = opts.query === "";
  return (
    <div
      role="dialog"
      aria-label={showReplace ? t("cmd.findReplace") : t("cmd.find")}
      className="fixed right-4 top-24 z-40 w-96 rounded-lg border border-ui-border bg-ui-panel p-3 text-sm text-ui-fg shadow-xl"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!empty) void store.findNext(opts, false).then(report);
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{showReplace ? t("cmd.findReplace") : t("cmd.find")}</h2>
          <button type="button" className="text-xs underline" onClick={() => setShowReplace((r) => !r)}>
            {showReplace ? t("calc.find.hideReplace") : t("cmd.replaceDots")}
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-24">{t("calc.find.what")}</span>
          <input ref={first} className={`${FIELD} flex-1`} value={opts.query} onChange={(e) => set({ query: e.target.value })} />
        </label>
        {showReplace && (
          <label className="flex items-center gap-2">
            <span className="w-24">{t("calc.find.with")}</span>
            <input className={`${FIELD} flex-1`} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          </label>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-1">
            {t("calc.find.within")}
            <select className={FIELD} value={opts.allSheets ? "book" : "sheet"} onChange={(e) => set({ allSheets: e.target.value === "book" })}>
              <option value="sheet">{t("calc.sheet")}</option>
              <option value="book">{t("calc.find.workbook")}</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={opts.matchCase} onChange={(e) => set({ matchCase: e.target.checked })} />
            {t("calc.find.matchCase")}
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={opts.wholeCell} onChange={(e) => set({ wholeCell: e.target.checked })} />
            {t("calc.find.wholeCell")}
          </label>
        </div>
        <div role="status" className="min-h-5 text-xs text-ui-muted">
          {status}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {showReplace && (
            <>
              <button
                type="button"
                className={BTN}
                disabled={empty}
                onClick={() => void store.replaceAll(opts, replacement).then((n) => setStatus(t("calc.find.replaced", { count: n })))}
              >
                {t("calc.find.replaceAll")}
              </button>
              <button type="button" className={BTN} disabled={empty} onClick={() => void store.replaceNext(opts, replacement).then(report)}>
                {t("cmd.replace")}
              </button>
            </>
          )}
          <button type="button" className={BTN} disabled={empty} onClick={() => void store.findNext(opts, true).then(report)}>
            {t("calc.find.prev")}
          </button>
          <button type="submit" className={BTN} disabled={empty}>
            {t("calc.find.next")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.close")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Theme colours (no tint) then the standard colours, as in Excel's tab colour menu. */
const TAB_COLORS: { label: string; color: Color }[] = [
  ...THEME_SLOTS.map((slot) => ({ label: `theme-${slot}`, color: { kind: "theme", value: { slot, tint: 0 } } as Color })), // i18n-ignore: an id, named at render
  ...STANDARD_COLORS.map((hex) => ({ label: `#${hex}`, color: { kind: "rgb", value: hex } as Color })),
];

function TabColorDialog({ store, sheet }: { store: CalcStore; sheet: number }) {
  const t = useT();
  const info = store.getState().info?.sheets.find((s) => s.id === sheet);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const pick = (color: Color | null) => {
    void store.setTabColor(sheet, color);
    close();
  };
  const current = JSON.stringify(info?.tabColor ?? null);
  return (
    <Dialog open title={t("calc.tabColor.title")} onClose={close}>
      <div className="flex w-64 flex-col gap-2 text-sm">
        <div className="text-xs text-ui-muted">{info?.name}</div>
        <div role="group" aria-label={t("calc.tabColor.colours")} className="grid grid-cols-10 gap-0.5">
          {TAB_COLORS.map(({ label, color }) => (
            <button
              key={label}
              type="button"
              aria-label={label.startsWith("theme-") ? t("calc.tabColor.theme", { slot: label.slice(6) }) : label}
              aria-pressed={JSON.stringify(color) === current}
              className="h-5 w-5 rounded-sm border border-ui-border aria-pressed:ring-2 aria-pressed:ring-ui-focus"
              style={{ background: cssColor(color, OFFICE_THEME) }}
              onClick={() => pick(color)}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={() => pick(null)}>
            {t("calc.tabColor.none")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Unhide: the hidden sheets ("very hidden" ones excluded), one to show again. */
function UnhideDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const hidden = unhideableSheets(store.getState().info?.sheets ?? []);
  const [picked, setPicked] = useState<number | null>(hidden[0]?.id ?? null);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  return (
    <Dialog open title={t("calc.unhide")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          if (picked !== null) void store.unhideSheet(picked);
        }}
      >
        <span id="calc-unhide-label">{t("calc.unhide.label")}</span>
        <div role="listbox" aria-labelledby="calc-unhide-label" className="flex max-h-48 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-0.5">
          {hidden.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === picked}
              className="min-h-8 px-2 text-left hover:bg-ui-hover aria-selected:bg-ui-active"
              onClick={() => setPicked(s.id)}
              onDoubleClick={() => {
                close();
                void store.unhideSheet(s.id);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={picked === null}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function CalcDialogs({ store }: { store: CalcStore }) {
  const t = useT();
  const dialog = useCalc(store, (s) => s.dialog);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  if (!dialog) return null;
  switch (dialog.kind) {
    case "numberFormat":
      return <NumberFormatDialog store={store} />;
    case "tabColor":
      return <TabColorDialog store={store} sheet={dialog.sheet} />;
    case "renameSheet": {
      const name = store.getState().info?.sheets.find((s) => s.id === dialog.sheet)?.name ?? "";
      return (
        <PromptDialog
          open
          title={t("calc.rename.title")}
          label={t("calc.sheetName")}
          initial={name}
          confirmLabel={t("calc.rename.confirm")}
          onClose={close}
          onSubmit={(v) => {
            void store.renameSheet(dialog.sheet, v);
            close();
          }}
        />
      );
    }
    case "deleteSheet":
      return (
        <Dialog open title={t("calc.deleteSheet")} onClose={close}>
          <form
            className="flex w-80 flex-col gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              close();
              void store.deleteSheet(dialog.sheet, true);
            }}
          >
            <p>
              {t("calc.deleteSheet.confirm", { name: dialog.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN} onClick={close}>
                {t("common.cancel")}
              </button>
              <button type="submit" className={BTN}>
                {t("cmd.delete")}
              </button>
            </div>
          </form>
        </Dialog>
      );
    case "find":
      return <FindPanel store={store} replace={dialog.replace} />;
    case "unhideSheet":
      return <UnhideDialog store={store} />;
    case "sortExpand":
      return <SortExpandDialog store={store} />;
    case "customSort":
      return <CustomSortDialog key={JSON.stringify(dialog.range)} store={store} range={dialog.range} hasHeader={dialog.hasHeader} />;
    case "filterMenu":
      return <FilterPanel key={`${dialog.col}:${dialog.at.x}:${dialog.at.y}`} store={store} col={dialog.col} at={dialog.at} />;
    case "customFilter":
      return <CustomFilterDialog store={store} col={dialog.col} preset={dialog.preset} />;
    case "top10":
      return <Top10Dialog store={store} col={dialog.col} />;
    case "cfQuick":
    case "cfRule":
    case "cfManage":
      return <CfDialog store={store} dialog={dialog} />;
    case "recommendedCharts":
    case "changeChartType":
    case "moveChart":
    case "selectData":
      return <ChartDialog store={store} dialog={dialog} />;
    case "dataValidation":
      return <ValidationDialog store={store} />;
    case "nameManager":
      return <NameManagerDialog store={store} />;
    case "defineName":
      return <DefineNameDialog key={JSON.stringify(dialog.edit ?? null)} store={store} edit={dialog.edit} back={dialog.back} />;
    case "createNames":
      return <CreateNamesDialog store={store} />;
    case "goTo":
      return <GoToDialog store={store} />;
    case "insertFunction":
      return <InsertFunctionDialog store={store} category={dialog.category} />;
    case "link":
      return <LinkDialog store={store} />;
    case "userName":
      return <UserNameDialog store={store} next={dialog.next} />;
    case "pivotCreate":
    case "pivotDelete":
    case "pivotValueField":
    case "pivotFieldSettings":
    case "pivotOptions":
    case "pivotMove":
    case "pivotSource":
    case "pivotFilter":
      return <PivotDialog store={store} dialog={dialog} />;
    case "mergeConfirm":
      return (
        <Dialog open title={t("calc.mergeCells")} onClose={close}>
          <form
            className="flex w-80 flex-col gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              close();
              void store.mergeSelection(dialog.merge, true);
            }}
          >
            <p>{t("calc.mergeConfirm.text")}</p>
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
    case "rowHeight":
    case "colWidth": {
      const rows = dialog.kind === "rowHeight";
      return (
        <PromptDialog
          open
          title={rows ? t("calc.rowHeight") : t("calc.colWidth")}
          label={rows ? t("calc.rowHeightPt") : t("calc.colWidthChars")}
          initial={String(store.currentSize(rows ? "rows" : "cols"))}
          onClose={close}
          onSubmit={(v) => {
            const n = Number(v.replace(",", "."));
            if (!Number.isFinite(n) || n < 0 || n > (rows ? 409 : 255)) {
              store.pushError(new Error(rows ? t("calc.rowHeightRange") : t("calc.colWidthRange")));
              return;
            }
            void store.setSize(rows ? "rows" : "cols", n);
            close();
          }}
        />
      );
    }
  }
}
