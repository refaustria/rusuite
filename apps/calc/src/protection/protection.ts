// Sheet and workbook protection on the UI side (P9-C1): what the Review
// tab, the Format menu, the sheet tab menu, the formula bar and the
// status bar ask about the active sheet, and the commands they send. The
// core refuses every forbidden change itself (`sheet_protected`,
// `workbook_protected`); the UI only refuses early where Excel does (no
// editor opens on a locked cell).

import type { SheetProtection } from "../generated/SheetProtection";
import type { WorkbookProtection } from "../generated/WorkbookProtection";
import type { CalcStore } from "../state/store";
import { t } from "../i18n";

/** Excel's Protect Sheet defaults: selecting cells allowed, everything else protected. */
export const DEFAULT_SHEET_PROTECTION: SheetProtection = {
  sheet: true, objects: true, scenarios: true, formatCells: true, formatColumns: true, formatRows: true,
  insertColumns: true, insertRows: true, insertHyperlinks: true, deleteColumns: true, deleteRows: true,
  selectLockedCells: false, selectUnlockedCells: false, sort: true, autoFilter: true, pivotTables: true,
};

/** The "Allow all users of this worksheet to" list of Excel's dialog: option key and label key (checked = `false` in the file). */
export const ALLOW_OPTIONS: { key: keyof Omit<SheetProtection, "sheet" | "password">; label: string }[] = [
  { key: "selectLockedCells", label: "calc.protect.allow.selectLocked" },
  { key: "selectUnlockedCells", label: "calc.protect.allow.selectUnlocked" },
  { key: "formatCells", label: "calc.protect.allow.formatCells" },
  { key: "formatColumns", label: "calc.protect.allow.formatColumns" },
  { key: "formatRows", label: "calc.protect.allow.formatRows" },
  { key: "insertColumns", label: "calc.protect.allow.insertColumns" },
  { key: "insertRows", label: "calc.protect.allow.insertRows" },
  { key: "insertHyperlinks", label: "calc.protect.allow.insertHyperlinks" },
  { key: "deleteColumns", label: "calc.protect.allow.deleteColumns" },
  { key: "deleteRows", label: "calc.protect.allow.deleteRows" },
  { key: "sort", label: "calc.protect.allow.sort" },
  { key: "autoFilter", label: "calc.protect.allow.autoFilter" },
  { key: "pivotTables", label: "calc.protect.allow.pivotTables" },
  { key: "objects", label: "calc.protect.allow.objects" },
  { key: "scenarios", label: "calc.protect.allow.scenarios" },
];

/** The protection in force on `sheet` (default: the active sheet). */
export function sheetProtection(store: CalcStore, sheet = store.getState().activeSheet): SheetProtection | undefined {
  const p = store.getState().info?.sheets.find((s) => s.id === sheet)?.protection;
  return p?.sheet ? p : undefined;
}

export function workbookProtection(store: CalcStore): WorkbookProtection | undefined {
  const p = store.getState().info?.workbookProtection;
  return p && (p.lockStructure || p.lockWindows) ? p : undefined;
}

export function hasPassword(p: { password?: { legacy?: number; hashed?: unknown } } | undefined): boolean {
  return !!p?.password && (p.password.legacy !== undefined || p.password.hashed !== undefined);
}

/** Whether the active cell is locked (Format Cells › Protection; Excel's default: locked). */
export function activeCellLocked(store: CalcStore): boolean {
  return store.activeStyle().protection?.locked !== false;
}

/** The formula bar hides the active cell's formula: a hidden formula cell on a protected sheet. */
export function formulaHidden(store: CalcStore): boolean {
  const cell = store.activeCell();
  return !!sheetProtection(store) && store.activeStyle().protection?.hidden === true && !!cell?.input.startsWith("=");
}

/** Typing into a locked cell of a protected sheet: Excel's message, and `true` (no editor opens). */
export function refuseLockedEdit(store: CalcStore): boolean {
  if (!sheetProtection(store) || !activeCellLocked(store)) return false;
  store.pushError(new Error(t("calc.protect.refused")));
  return true;
}

/** 16 random bytes, standard base64: the salt Excel uses for a SHA-512 password hash. */
export function newSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Review › Protect Sheet / Unprotect Sheet (the button toggles, as in Excel). */
export function toggleSheetProtection(store: CalcStore, sheet = store.getState().activeSheet): void {
  const p = sheetProtection(store, sheet);
  if (!p) store.openDialog({ kind: "protectSheet", sheet });
  else if (hasPassword(p)) store.openDialog({ kind: "unprotect", target: "sheet", sheet });
  else void store.applyChecked({ type: "unprotectSheet", sheet });
}

/** Review › Protect Workbook (toggles). */
export function toggleWorkbookProtection(store: CalcStore): void {
  const p = workbookProtection(store);
  if (!p) store.openDialog({ kind: "protectWorkbook" });
  else if (hasPassword(p)) store.openDialog({ kind: "unprotect", target: "workbook", sheet: store.getState().activeSheet });
  else void store.applyChecked({ type: "unprotectWorkbook" });
}

/** Home › Format › Lock Cell: toggles `locked` on the selection. */
export function toggleLockCell(store: CalcStore): void {
  const sheet = store.getState().activeSheet;
  void store.apply({ type: "applyStyle", sheet, ...store.selectionRange(), patch: { protection: { locked: !activeCellLocked(store) } } });
}
