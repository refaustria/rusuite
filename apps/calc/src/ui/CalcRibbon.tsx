// Calc's ribbon: File (backstage) / Home / Insert / View. The commands
// reuse the store actions and, for the dialogs owned by the ShortcutLayer
// (Save As, New with its discard prompt, shortcut help), the shortcut map.

import { useState } from "react";
import {
  AlignmentControls, BordersDropdown, ColorControls, FontControls, NumberFormatSelect, PromptDialog, RIBBON_SELECT, Ribbon, RibbonButton,
  RibbonMenuButton, RibbonRow, RibbonStack, StyleToggles, triggerShortcut, type AnySession, type CellStylePatch,
  type FormatControlProps, type RibbonGroup, type RibbonTab,
} from "@rusuite/ui-shared";
import { normalize } from "../grid/Selection";
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
 * TODO(P6-3): slot for the Calc commands P6-3 adds (`calcActions.ts`: context
 * menu actions, dialogs). Groups are appended to their tab; `tabs` adds
 * whole tabs (e.g. Data) after Insert.
 */
export interface CalcRibbonExtras {
  home?: RibbonGroup[];
  insert?: RibbonGroup[];
  view?: RibbonGroup[];
  tabs?: RibbonTab[];
}

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

/** Best effort: also put copied cells on the system clipboard. */
function toSystemClipboard(text: string) {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // no clipboard access (tests, insecure context)
  }
}

type SizeDialog = { axis: "row" | "col"; initial: string } | null;

export interface CalcRibbonProps {
  store: CalcStore;
  session: AnySession;
  onExportPdf: () => void;
  view: CalcView;
  onViewChange: (v: CalcView) => void;
  extras?: CalcRibbonExtras;
}

export function CalcRibbon({ store, session, onExportPdf, view, onViewChange, extras }: CalcRibbonProps) {
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.selection);
  useCalc(store, (s) => s.activeSheet);
  const ready = useCalc(store, (s) => s.info !== null);
  const canUndo = useCalc(store, (s) => s.canUndo);
  const canRedo = useCalc(store, (s) => s.canRedo);
  const name = useCalc(store, (s) => s.name);
  const dirty = useCalc(store, (s) => s.dirty);
  const [sizeDialog, setSizeDialog] = useState<SizeDialog>(null);

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

  const openSizeDialog = (axis: "row" | "col") => {
    const s = store.getState();
    const geo = store.geometry(s.activeSheet);
    const size = axis === "row" ? geo.row.size(s.selection.anchor.row) : geo.col.size(s.selection.anchor.col);
    setSizeDialog({ axis, initial: String(Math.round(size)) });
  };
  const applySize = (text: string) => {
    const dlg = sizeDialog;
    setSizeDialog(null);
    const px = Number(text);
    if (!dlg || !Number.isFinite(px) || px < 0 || px > 2000) return;
    const r = normalize(store.getState().selection);
    const [from, to] = dlg.axis === "row" ? [r.r0, r.r1] : [r.c0, r.c1];
    // Whole-sheet selections would be millions of commands: cap at the first 1000.
    for (let i = from; i <= Math.min(to, from + 999); i++) void (dlg.axis === "row" ? store.setRowHeight(i, px) : store.setColWidth(i, px));
    done();
  };

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
            <RibbonButton label="Paste" icon="paste" size="large" shortcut="Mod+V" disabled={off} onClick={run(() => store.paste())} />
            <RibbonStack>
              <RibbonButton
                label="Cut"
                icon="cut"
                shortcut="Mod+X"
                showLabel
                disabled={off}
                onClick={run(() => {
                  toSystemClipboard(store.copy());
                  return store.clearSelection();
                })}
              />
              <RibbonButton label="Copy" icon="copy" shortcut="Mod+C" showLabel disabled={off} onClick={run(() => toSystemClipboard(store.copy()))} />
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
              <AlignmentControls {...fmt} parts={["vertical", "wrap"]} />
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
                { id: "rows", label: "Insert sheet rows", icon: "insertRows", onSelect: run(() => store.structure("insert", "rows")) },
                { id: "cols", label: "Insert sheet columns", icon: "insertCols", onSelect: run(() => store.structure("insert", "cols")) },
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
                { id: "rows", label: "Delete sheet rows", icon: "deleteRows", onSelect: run(() => store.structure("delete", "rows")) },
                { id: "cols", label: "Delete sheet columns", icon: "deleteCols", onSelect: run(() => store.structure("delete", "cols")) },
              ]}
            />
            <RibbonMenuButton
              label="Format"
              icon="format"
              size="large"
              disabled={off}
              menu={[
                { separator: true, label: "Cell size" },
                { id: "rowHeight", label: "Row height…", icon: "rowHeight", onSelect: () => openSizeDialog("row") },
                { id: "colWidth", label: "Column width…", icon: "colWidth", onSelect: () => openSizeDialog("col") },
              ]}
            />
          </>
        ),
      },
      {
        label: "Editing",
        items: <RibbonButton label="Clear" icon="clear" size="large" shortcut="Delete" tooltip="Clear contents" disabled={off} onClick={run(() => store.clearSelection())} />,
      },
      ...(extras?.home ?? []),
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: "Insert",
    groups: [
      {
        label: "Sheets",
        items: <RibbonButton label="New sheet" icon="sheet" size="large" disabled={off} onClick={run(() => store.addSheet())} />,
      },
      {
        label: "Rows & columns",
        items: (
          <RibbonStack>
            <RibbonButton label="Insert rows" icon="insertRows" showLabel disabled={off} onClick={run(() => store.structure("insert", "rows"))} />
            <RibbonButton label="Insert columns" icon="insertCols" showLabel disabled={off} onClick={run(() => store.structure("insert", "cols"))} />
          </RibbonStack>
        ),
      },
      ...(extras?.insert ?? []),
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
      ...(extras?.view ?? []),
    ],
  };

  return (
    <>
      <Ribbon
        appName="Rusuite Calc"
        documentTitle={`${name ?? "Untitled"}${dirty ? " •" : ""}`}
        accent="#217346"
        tabs={[home, insert, ...(extras?.tabs ?? []), viewTab]}
        backstage={{
          session,
          onNew: () => triggerShortcut("Mod+N"),
          onOpen: () => void store.openFile(),
          onSave: () => void store.saveFile(),
          onSaveAs: () => triggerShortcut("Mod+Shift+S"),
          onExportPdf,
          onCloseDocument: () => triggerShortcut("Mod+N"),
        }}
      />
      <PromptDialog
        open={sizeDialog !== null}
        title={sizeDialog?.axis === "row" ? "Row height" : "Column width"}
        label={sizeDialog?.axis === "row" ? "Row height (pixels)" : "Column width (pixels)"}
        initial={sizeDialog?.initial ?? ""}
        onClose={() => setSizeDialog(null)}
        onSubmit={applySize}
      />
    </>
  );
}
