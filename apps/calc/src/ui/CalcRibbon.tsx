// Calc's ribbon: File (backstage) / Home / Insert / View. The commands
// reuse `calcActions` (shared with the shortcuts and context menus, whose
// dialogs CalcDialogs renders) and, for the dialogs owned by the
// ShortcutLayer (Save As, New with its discard prompt, shortcut help), the
// shortcut map.

import { useMemo, type ReactNode } from "react";
import {
  AlignmentControls, BordersDropdown, ColorControls, FontControls, NumberFormatSelect, RIBBON_SELECT, Ribbon, RibbonButton,
  RibbonMenuButton, RibbonRow, RibbonSplitButton, RibbonStack, StyleToggles, triggerShortcut, type AnySession, type CellStylePatch,
  type FormatControlProps, type RibbonTab,
} from "@rusuite/ui-shared";
import { calcActions } from "../calcActions";
import { sheetMenu } from "../SheetTabs";
import { toolbarValue } from "../grid/style";
import { useCalc, type CalcStore } from "../state/store";

/** View options of the grid (View tab). */
export interface CalcView {
  zoom: number;
  gridlines: boolean;
  formulaBar: boolean;
}

export const DEFAULT_CALC_VIEW: CalcView = { zoom: 1, gridlines: true, formulaBar: true };
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * Adds (`delta` 1) or removes (-1) one decimal place in every section of a
 * number format code: `General`/`0` → `0.0`, `#,##0.00` → `#,##0.0`.
 */
export function changeDecimals(code: string, delta: 1 | -1): string {
  const base = code === "General" || code === "" ? "0" : code;
  return base
    .split(";")
    .map((section) => {
      const m = /0(?:\.(0+))?(?![\s\S]*0)/.exec(section);
      if (!m) return section;
      const places = Math.max(0, (m[1]?.length ?? 0) + delta);
      const digits = places > 0 ? `0.${"0".repeat(places)}` : "0";
      return section.slice(0, m.index) + digits + section.slice(m.index + m[0].length);
    })
    .join(";");
}

export interface CalcRibbonProps {
  store: CalcStore;
  session: AnySession;
  onExportPdf: () => void;
  /** File › Print page (settings and preview). */
  print?: ReactNode;
  view: CalcView;
  onViewChange: (v: CalcView) => void;
}

export function CalcRibbon({ store, session, onExportPdf, print, view, onViewChange }: CalcRibbonProps) {
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.selection);
  const activeSheet = useCalc(store, (s) => s.activeSheet);
  useCalc(store, (s) => s.info?.sheets);
  const ready = useCalc(store, (s) => s.info !== null);
  const canUndo = useCalc(store, (s) => s.canUndo);
  const canRedo = useCalc(store, (s) => s.canRedo);
  const name = useCalc(store, (s) => s.name);
  const dirty = useCalc(store, (s) => s.dirty);
  const actions = useMemo(() => calcActions(store), [store]);

  const off = !ready;
  const done = () => store.focusGrid();
  const run = (fn: () => unknown) => () => {
    void fn();
    done();
  };
  const fmt: FormatControlProps = {
    value: toolbarValue(store.activeStyle()),
    disabled: off,
    onChange: (patch: CellStylePatch) => {
      void store.applyStyle(patch);
      done();
    },
  };
  const numberFormat = fmt.value.numberFormat ?? "General";

  const home: RibbonTab = {
    id: "home",
    label: "Home",
    toolbarLabel: "Formatting",
    groups: [
      {
        label: "Undo",
        items: (
          <RibbonStack>
            <RibbonButton label="Undo" icon="undo" shortcut="Mod+Z" disabled={off || !canUndo} onClick={run(() => store.undo())} />
            <RibbonButton label="Redo" icon="redo" shortcut="Mod+Y" disabled={off || !canRedo} onClick={run(() => store.redo())} />
          </RibbonStack>
        ),
      },
      {
        label: "Clipboard",
        items: (
          <>
            <RibbonSplitButton
              label="Paste"
              icon="paste"
              size="large"
              shortcut="Mod+V"
              disabled={off}
              onClick={run(actions.paste)}
              menu={[
                { id: "all", label: "Paste", icon: "paste", shortcut: "Mod+V", onSelect: run(actions.paste) },
                { id: "values", label: "Paste values", shortcut: "Mod+Shift+V", onSelect: run(actions.pasteValues) },
              ]}
            />
            <RibbonStack>
              <RibbonButton label="Cut" icon="cut" shortcut="Mod+X" showLabel disabled={off} onClick={run(actions.cut)} />
              <RibbonButton label="Copy" icon="copy" shortcut="Mod+C" showLabel disabled={off} onClick={run(actions.copy)} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: "Font",
        items: (
          <RibbonStack>
            <RibbonRow>
              <FontControls {...fmt} />
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...fmt} />
              <BordersDropdown onChange={fmt.onChange} disabled={off} />
              <ColorControls {...fmt} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: "Alignment",
        items: (
          <RibbonStack>
            <RibbonRow>
              <AlignmentControls {...fmt} parts={["vertical"]} />
              <RibbonButton label="Wrap text" icon="lineBreak" pressed={!!fmt.value.alignment?.wrapText} disabled={off} onClick={run(actions.toggleWrap)} />
            </RibbonRow>
            <RibbonRow>
              <AlignmentControls {...fmt} parts={["horizontal"]} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: "Number",
        items: (
          <RibbonStack>
            <RibbonRow>
              <NumberFormatSelect {...fmt} />
            </RibbonRow>
            <RibbonRow>
              <RibbonButton label="Percent style" icon="percent" disabled={off} onClick={() => fmt.onChange({ numberFormat: "0%" })} />
              <RibbonButton label="Comma style" icon="comma" disabled={off} onClick={() => fmt.onChange({ numberFormat: "#,##0.00" })} />
              <RibbonButton
                label="Increase decimal"
                icon="decimalMore"
                disabled={off}
                onClick={() => fmt.onChange({ numberFormat: changeDecimals(numberFormat, 1) })}
              />
              <RibbonButton
                label="Decrease decimal"
                icon="decimalLess"
                disabled={off}
                onClick={() => fmt.onChange({ numberFormat: changeDecimals(numberFormat, -1) })}
              />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: "Cells",
        items: (
          <>
            <RibbonMenuButton
              label="Insert"
              icon="insertCells"
              size="large"
              disabled={off}
              menu={[
                { id: "rows", label: "Insert sheet rows", icon: "insertRows", onSelect: run(actions.insertRows) },
                { id: "cols", label: "Insert sheet columns", icon: "insertCols", onSelect: run(actions.insertCols) },
                { separator: true },
                { id: "sheet", label: "Insert sheet", icon: "sheet", onSelect: run(() => store.addSheet()) },
              ]}
            />
            <RibbonMenuButton
              label="Delete"
              icon="deleteCells"
              size="large"
              disabled={off}
              menu={[
                { id: "rows", label: "Delete sheet rows", icon: "deleteRows", onSelect: run(actions.deleteRows) },
                { id: "cols", label: "Delete sheet columns", icon: "deleteCols", onSelect: run(actions.deleteCols) },
                { separator: true },
                { id: "sheet", label: "Delete sheet", icon: "sheet", onSelect: () => void store.deleteSheet(activeSheet) },
              ]}
            />
            <RibbonMenuButton
              label="Format"
              icon="format"
              size="large"
              disabled={off}
              menu={[
                { separator: true, label: "Cell size" },
                { id: "rowHeight", label: "Row height…", icon: "rowHeight", onSelect: actions.rowHeight },
                { id: "autofit", label: "AutoFit column width", onSelect: run(actions.autofitCols) },
                { id: "colWidth", label: "Column width…", icon: "colWidth", onSelect: actions.colWidth },
                { separator: true, label: "Visibility" },
                { id: "hideRows", label: "Hide rows", onSelect: run(actions.hideRows) },
                { id: "hideCols", label: "Hide columns", onSelect: run(actions.hideCols) },
                { id: "unhideRows", label: "Unhide rows", onSelect: run(actions.unhideRows) },
                { id: "unhideCols", label: "Unhide columns", onSelect: run(actions.unhideCols) },
                { separator: true },
                { id: "formatCells", label: "Format cells…", icon: "format", shortcut: "Mod+1", onSelect: actions.formatCells },
              ]}
            />
          </>
        ),
      },
      {
        label: "Editing",
        items: (
          <>
            <RibbonButton label="Clear" icon="clear" size="large" shortcut="Delete" tooltip="Clear contents" disabled={off} onClick={run(actions.clearContents)} />
            <RibbonSplitButton
              label="Find"
              icon="find"
              size="large"
              shortcut="Mod+F"
              disabled={off}
              onClick={actions.find}
              menuLabel="Find options"
              menu={[
                { id: "find", label: "Find…", icon: "find", shortcut: "Mod+F", onSelect: actions.find },
                { id: "replace", label: "Replace…", shortcut: "Mod+H", onSelect: actions.replace },
              ]}
            />
          </>
        ),
      },
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: "Insert",
    groups: [
      {
        label: "Sheets",
        items: (
          <>
            <RibbonButton label="New sheet" icon="sheet" size="large" disabled={off} onClick={run(() => store.addSheet())} />
            <RibbonMenuButton
              label="Sheet"
              icon="sheet"
              size="large"
              disabled={off}
              menu={sheetMenu(store, activeSheet, () => store.openDialog({ kind: "renameSheet", sheet: activeSheet }))}
            />
          </>
        ),
      },
      {
        label: "Rows & columns",
        items: (
          <RibbonStack>
            <RibbonButton label="Insert rows" icon="insertRows" showLabel disabled={off} onClick={run(actions.insertRows)} />
            <RibbonButton label="Insert columns" icon="insertCols" showLabel disabled={off} onClick={run(actions.insertCols)} />
          </RibbonStack>
        ),
      },
    ],
  };

  const viewTab: RibbonTab = {
    id: "view",
    label: "View",
    groups: [
      {
        label: "Show",
        items: (
          <RibbonStack>
            <RibbonButton label="Gridlines" icon="gridlines" showLabel pressed={view.gridlines} onClick={() => onViewChange({ ...view, gridlines: !view.gridlines })} />
            <RibbonButton label="Formula bar" icon="formulaBar" showLabel pressed={view.formulaBar} onClick={() => onViewChange({ ...view, formulaBar: !view.formulaBar })} />
          </RibbonStack>
        ),
      },
      {
        label: "Zoom",
        items: (
          <>
            <RibbonStack>
              <select
                aria-label="Zoom"
                className={`${RIBBON_SELECT} w-20`}
                value={String(view.zoom)}
                onChange={(e) => onViewChange({ ...view, zoom: Number(e.target.value) })}
              >
                {ZOOM_LEVELS.map((z) => (
                  <option key={z} value={String(z)}>
                    {Math.round(z * 100)} %
                  </option>
                ))}
              </select>
              <RibbonButton label="100 %" icon="zoom" showLabel tooltip="Zoom to 100 %" onClick={() => onViewChange({ ...view, zoom: 1 })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: "Help",
        items: <RibbonButton label="Keyboard shortcuts" icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  return (
    <Ribbon
      appName="Rusuite Calc"
      documentTitle={`${name ?? "Untitled"}${dirty ? " •" : ""}`}
      accent="#217346"
      tabs={[home, insert, viewTab]}
      backstage={{
        session,
        onNew: () => triggerShortcut("Mod+N"),
        onOpen: () => triggerShortcut("Mod+O"),
        onSave: () => void store.saveFile(),
        onSaveAs: () => triggerShortcut("Mod+Shift+S"),
        onExportPdf,
        print,
        onCloseDocument: () => triggerShortcut("Mod+N"),
      }}
    />
  );
}
