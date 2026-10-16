// The ribbon parts of the data tools (P8-35): Data › Get Data (From
// Text/CSV), Data Tools (Text to Columns, Remove Duplicates), Forecast
// (What-If Analysis › Goal Seek), Outline (Group, Ungroup, Subtotal,
// Show / Hide Detail); Home › Paste ▾ (Excel's paste gallery and Paste
// Special…); Insert › Pictures; the Page Layout tab (Print Area, Breaks,
// Print Titles) and View › Page Break Preview.

import { useRef } from "react";
import { RibbonButton, RibbonMenuButton, RibbonStack, type RibbonMenuItem as MenuItem, type RibbonGroup, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import type { PasteSpecial } from "../generated/PasteSpecial";
import { isWholeCols, isWholeRows, normalize } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { PICTURE_ACCEPT, readImageFile } from "../pictures/controller";
import {
  breakPreviewIcon, duplicatesIcon, groupIcon, hideDetailIcon, pageBreakIcon, pasteIcon, pictureIcon, printAreaIcon, printTitlesIcon, showDetailIcon, subtotalIcon,
  textToColumnsIcon, ungroupIcon, whatIfIcon,
} from "../tables/icons";
import { manualBreakAt, withBreak, withoutBreak } from "./pageBreaks";
import { validationIcon } from "../ui/icons";

/** Excel's paste gallery (Home › Paste ▾): the options as Paste Special settings (Picture and Linked Picture are not offered). */
export const PASTE_GALLERY: { id: string; mark: Parameters<typeof pasteIcon>[0]; special: PasteSpecial }[] = [
  { id: "formulas", mark: "fx", special: { parts: "formulas" } },
  { id: "formulasNumbers", mark: "%", special: { parts: "formulasAndNumberFormats" } },
  { id: "keepSource", mark: "brush", special: { parts: "all" } },
  { id: "noBorders", mark: "nob", special: { parts: "allExceptBorders" } },
  { id: "keepWidths", mark: "w", special: { parts: "allAndColumnWidths" } },
  { id: "transpose", mark: "↔", special: { parts: "all", transpose: true } },
  { id: "values", mark: "123", special: { parts: "values" } },
  { id: "valuesNumbers", mark: "%", special: { parts: "valuesAndNumberFormats" } },
  { id: "valuesSource", mark: "123", special: { parts: "values" } },
  { id: "formatting", mark: "brush", special: { parts: "formats" } },
  { id: "link", mark: "link", special: { link: true } },
];

/** Home › Paste ▾ menu entries. */
export function pasteMenu(store: CalcStore, t: T, paste: () => void, run: (fn: () => unknown) => () => void): MenuItem[] {
  return [
    { id: "all", label: t("cmd.paste"), icon: "paste", shortcut: "Mod+V", onSelect: run(paste) },
    { id: "values", label: t("calc.pasteValues"), shortcut: "Mod+Shift+V", onSelect: run(() => store.pasteSpecial({ parts: "values" })) },
    { separator: true },
    ...PASTE_GALLERY.map((g) => ({ id: `ps-${g.id}`, label: t(`calc.ps.gallery.${g.id}`), icon: pasteIcon(g.mark, 16), onSelect: run(() => store.pasteSpecial(g.special)) })),
    { separator: true },
    { id: "special", label: t("calc.ps.dots"), shortcut: "Mod+Alt+V", onSelect: () => store.openDialog({ kind: "pasteSpecial" }) },
  ];
}

/** Text to Columns works on one column at a time (Excel). */
export function openTextToColumns(store: CalcStore, t: T): void {
  const r = normalize(store.getState().selection);
  if (r.c0 !== r.c1) {
    store.pushError(new Error(t("calc.wizard.oneColumn")));
    return;
  }
  const last = store.usedExtent(store.getState().activeSheet).lastRow;
  store.openDialog({ kind: "textToColumns", range: { ...r, r1: Math.min(r.r1, Math.max(r.r0, last)) } });
}

/** Remove Duplicates over the table, the selection or its current region. */
export function openRemoveDuplicates(store: CalcStore): void {
  const tb = store.tables.active();
  if (tb) {
    store.openDialog({ kind: "removeDuplicates", range: { r0: tb.r0, c0: tb.c0, r1: tb.r1 - (tb.totalsRow ? 1 : 0), c1: tb.c1 }, hasHeader: tb.headerRow });
    return;
  }
  const sel = store.selectionRange();
  const a = store.activeAnchor();
  const range = sel.r0 === sel.r1 && sel.c0 === sel.c1 ? store.currentRegion(a.row, a.col) : sel;
  store.openDialog({ kind: "removeDuplicates", range, hasHeader: store.tables.guessHeaders(range) });
}

/** Subtotal over the current region (its first row holds the headers). */
export function openSubtotal(store: CalcStore): void {
  const sel = store.selectionRange();
  const a = store.activeAnchor();
  const range = sel.r0 === sel.r1 && sel.c0 === sel.c1 ? store.currentRegion(a.row, a.col) : sel;
  store.openDialog({ kind: "subtotal", range });
}

/** Group / Ungroup the selection's rows (or whole columns' columns). */
export function groupSelection(store: CalcStore, ungroup: boolean, axis?: "rows" | "cols"): Promise<void> {
  const r = normalize(store.getState().selection);
  const cols = axis ? axis === "cols" : isWholeCols(r) && !isWholeRows(r);
  const sheet = store.getState().activeSheet;
  return store.apply({ type: "groupOutline", sheet, axis: cols ? "cols" : "rows", i0: cols ? r.c0 : r.r0, i1: cols ? r.c1 : r.r1, ungroup });
}

/** Show / Hide Detail: expands or collapses the group whose summary line is the active row (or the next one). */
export function showDetail(store: CalcStore, show: boolean): Promise<void> {
  const sheet = store.getState().activeSheet;
  const a = store.activeAnchor();
  const below = store.outlineProps().summaryBelow;
  const rows = store.cache(sheet).rows;
  const level = (i: number) => rows.get(i)?.outlineLevel ?? 0;
  // The summary row: the active row if it summarizes, else the end of its group.
  let s = a.row;
  if (!(level(below ? s - 1 : s + 1) > level(s))) {
    const l = level(s);
    while (s >= 0 && s < 1_048_575 && level(s) >= l && l > 0) s += below ? 1 : -1;
  }
  return store.apply({ type: "setOutlineCollapsed", sheet, axis: "rows", index: s, collapsed: !show });
}

/** Data › Get Data › From Text/CSV: picks a file and opens the import wizard. */
export function importText(store: CalcStore): void {
  void store.api.backend.openFile().then((file) => {
    if (file) store.openDialog({ kind: "textImport", name: file.name, bytesBase64: file.bytesBase64 });
  });
}

export function dataTabGroups(store: CalcStore, t: T, off: boolean, validation: () => void): RibbonGroup[] {
  const run = (fn: () => unknown) => () => {
    void fn();
    store.focusGrid();
  };
  return [
    {
      label: t("calc.dataTools"),
      items: (
        <>
          <RibbonButton label={t("calc.wizard.ttcButton")} icon={textToColumnsIcon()} size="large" disabled={off} onClick={() => openTextToColumns(store, t)} />
          <RibbonStack>
            <RibbonButton label={t("calc.dup.button")} icon={duplicatesIcon(16)} showLabel disabled={off} onClick={() => openRemoveDuplicates(store)} />
            <RibbonButton label={t("calc.dv.button")} icon={validationIcon(16)} showLabel tooltip={t("calc.dv.title")} disabled={off} onClick={validation} />
          </RibbonStack>
        </>
      ),
    },
    {
      label: t("calc.forecast"),
      items: (
        <RibbonMenuButton
          label={t("calc.goal.whatIf")}
          icon={whatIfIcon()}
          size="large"
          disabled={off}
          menu={[{ id: "goalSeek", label: t("calc.goal.dots"), onSelect: () => store.openDialog({ kind: "goalSeek" }) }]}
        />
      ),
    },
    {
      label: t("calc.outline.group.label"),
      items: (
        <>
          <RibbonMenuButton
            label={t("calc.outline.group")}
            icon={groupIcon()}
            size="large"
            disabled={off}
            menu={[
              { id: "rows", label: t("calc.outline.groupRows"), shortcut: "Alt+Shift+ArrowRight", onSelect: run(() => groupSelection(store, false, "rows")) },
              { id: "cols", label: t("calc.outline.groupCols"), onSelect: run(() => groupSelection(store, false, "cols")) },
            ]}
          />
          <RibbonMenuButton
            label={t("calc.outline.ungroup")}
            icon={ungroupIcon()}
            size="large"
            disabled={off}
            menu={[
              { id: "rows", label: t("calc.outline.ungroupRows"), shortcut: "Alt+Shift+ArrowLeft", onSelect: run(() => groupSelection(store, true, "rows")) },
              { id: "cols", label: t("calc.outline.ungroupCols"), onSelect: run(() => groupSelection(store, true, "cols")) },
              { separator: true },
              { id: "clear", label: t("calc.outline.clear"), onSelect: run(() => store.apply({ type: "clearOutline", sheet: store.getState().activeSheet })) },
            ]}
          />
          <RibbonButton label={t("calc.subtotal.button")} icon={subtotalIcon()} size="large" disabled={off} onClick={() => openSubtotal(store)} />
          <RibbonStack>
            <RibbonButton label={t("calc.outline.showDetail")} icon={showDetailIcon()} showLabel disabled={off} onClick={run(() => showDetail(store, true))} />
            <RibbonButton label={t("calc.outline.hideDetail")} icon={hideDetailIcon()} showLabel disabled={off} onClick={run(() => showDetail(store, false))} />
          </RibbonStack>
        </>
      ),
    },
  ];
}

/** Data › Get & Transform Data: From Text/CSV. */
export function getDataGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  return {
    label: t("calc.getData"),
    items: <RibbonButton label={t("calc.getData.text")} icon={textToColumnsIcon()} size="large" disabled={off} onClick={() => importText(store)} />,
  };
}

/** Insert › Illustrations › Pictures (from this device). */
export function PicturesButton({ store, t, off }: { store: CalcStore; t: T; off: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <RibbonButton label={t("calc.picture.button")} icon={pictureIcon()} size="large" tooltip={t("calc.picture.tip")} disabled={off} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        className="hidden"
        data-testid="picture-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void readImageFile(f).then((img) => store.pictures.insert(img), (err) => store.pushError(err));
        }}
      />
    </>
  );
}

/** The Page Layout tab: Print Area, Breaks, Print Titles. */
export function pageLayoutTab(store: CalcStore, t: T, off: boolean): RibbonTab {
  const sheet = store.getState().activeSheet;
  const info = store.getState().info?.sheets.find((s) => s.id === sheet);
  const run = (fn: () => unknown) => () => {
    void fn();
    store.focusGrid();
  };
  const a = store.activeAnchor();
  const setBreaks = (axis: "rows" | "cols", breaks: number[]) => store.apply({ type: "setPageBreaks", sheet, axis, breaks });
  const rowBreaks = info?.rowBreaks ?? [];
  const colBreaks = info?.colBreaks ?? [];
  const here = manualBreakAt(rowBreaks, colBreaks, a.row, a.col);
  return {
    id: "pageLayout",
    label: t("calc.tab.pageLayout"),
    groups: [
      {
        label: t("calc.pageSetup"),
        items: (
          <>
            <RibbonMenuButton
              label={t("calc.printArea")}
              icon={printAreaIcon()}
              size="large"
              disabled={off}
              menu={[
                {
                  id: "set",
                  label: t("calc.printArea.set"),
                  onSelect: run(() => {
                    const r = store.selectionRange();
                    const ref = `$${colLetter(r.c0)}$${r.r0 + 1}:$${colLetter(r.c1)}$${r.r1 + 1}`;
                    return store.setPrintNames(ref, printTitlesPart(store, "rows"), printTitlesPart(store, "cols"));
                  }),
                },
                { id: "clear", label: t("calc.printArea.clear"), onSelect: run(() => store.setPrintNames("", printTitlesPart(store, "rows"), printTitlesPart(store, "cols"))) },
              ]}
            />
            <RibbonMenuButton
              label={t("calc.breaks")}
              icon={pageBreakIcon()}
              size="large"
              disabled={off}
              menu={[
                {
                  id: "insert",
                  label: t("calc.breaks.insert"),
                  onSelect: run(async () => {
                    // Excel: a break above the active row and left of the active column (A1: none).
                    if (a.row > 0) await setBreaks("rows", withBreak(rowBreaks, a.row));
                    if (a.col > 0) await setBreaks("cols", withBreak(colBreaks, a.col));
                  }),
                },
                {
                  id: "remove",
                  label: t("calc.breaks.remove"),
                  disabled: !here.row && !here.col,
                  onSelect: run(async () => {
                    if (here.row) await setBreaks("rows", withoutBreak(rowBreaks, a.row));
                    if (here.col) await setBreaks("cols", withoutBreak(colBreaks, a.col));
                  }),
                },
                {
                  id: "reset",
                  label: t("calc.breaks.reset"),
                  disabled: rowBreaks.length === 0 && colBreaks.length === 0,
                  onSelect: run(async () => {
                    await setBreaks("rows", []);
                    await setBreaks("cols", []);
                  }),
                },
              ]}
            />
            <RibbonButton label={t("calc.printTitles")} icon={printTitlesIcon()} size="large" disabled={off} onClick={() => store.openDialog({ kind: "printTitles" })} />
          </>
        ),
      },
    ],
  };
}

const colLetter = (c: number) => {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** The rows (`$1:$2`) or columns (`$A:$B`) part of the sheet's Print_Titles (`""`: none). */
export function printTitlesPart(store: CalcStore, axis: "rows" | "cols"): string {
  const sheet = store.getState().activeSheet;
  const n = (store.getState().info?.names ?? []).find((x) => x.builtin === "printTitles" && x.sheet === sheet);
  const parts = (n?.refersTo ?? "").split(",").map((p) => p.replace(/^.*!/, ""));
  return parts.find((p) => (axis === "rows" ? /^\$?\d+:\$?\d+$/ : /^\$?[A-Za-z]+:\$?[A-Za-z]+$/).test(p)) ?? "";
}

/** View › Workbook Views: Normal / Page Break Preview. */
export function workbookViewsGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  const on = store.getState().pageBreakPreview;
  return {
    label: t("calc.workbookViews"),
    items: (
      <RibbonStack>
        <RibbonButton label={t("calc.view.normal")} icon="gridlines" showLabel pressed={!on} disabled={off} onClick={() => store.setPageBreakPreview(false)} />
        <RibbonButton label={t("calc.view.breakPreview")} icon={breakPreviewIcon(16)} showLabel pressed={on} disabled={off} onClick={() => store.setPageBreakPreview(true)} />
      </RibbonStack>
    ),
  };
}
