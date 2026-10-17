// The contextual table tabs (Word's Table Design and Table Layout), shown
// while the caret is in a table. Commands are built from the live
// selection when clicked and go to Rust first (`SetTableProps`,
// `MergeCells`, `SplitCell`, `SetCellProps`, `SetRowProps`, …); the patch
// re-renders the table.

import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { ColorPicker, Icon, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonRow, RibbonStack, type RibbonGalleryItem, type RibbonTab } from "@rusuite/ui-shared";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TableLook } from "../generated/TableLook";
import type { VAlign } from "../generated/VAlign";
import type { Alignment } from "../generated/Alignment";
import type { WriteCommand } from "../generated/WriteCommand";
import {
  cellAlignmentCommands, cellBordersCommand, colWidthsOf, deleteCols, deleteRows, deleteTable, distributeCols, distributeRows, insertCol, insertRow,
  lookOf, mergeCellsCommand, WORD_DEFAULT_LOOK, selectInTable, setColWidths, setRowHeight, setSelectedColWidth, setTableStyle, shadeCells, tableContext, toggleLook,
  type CellBorderPreset, type TableContext,
} from "../features/tables";
import { BUILTIN_TABLE_STYLES, GALLERY_TABLE_STYLES, resolveCell, tableStyleFor } from "../features/tableStyles";
import type { WriteFeatures } from "../features/WriteFeatures";
import { borderCss, colorCss, TWIPS_PER_PX } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { cm, fromCm, INPUT } from "./dialogs";
import type { BorderStyle } from "../generated/BorderStyle";
import { autoFitCommand, BORDER_PENS, contentWidths, measureNatural, PEN_WEIGHTS, penCss, renderedWidths } from "../features/tables2";
import { BORDER_STYLES } from "./formatDialogs";
import { t } from "../i18n";

/** What the tabs show of the caret's table (kept small: it is compared on every selection change). */
export interface TableInfo {
  id: number;
  style: string | null;
  look: TableLook;
  /** Whether the table has a look of its own (else the gallery previews Word's default). */
  hasLook: boolean;
  cells: number;
  merged: boolean;
  /** Row height (twips) of the caret's row, if set. */
  rowHeight: number | null;
  /** Width (twips) of the caret's grid column, if known. */
  colWidth: number | null;
}

export function tableInfo(t: TableContext | null): TableInfo | null {
  if (!t) return null;
  const merged = t.cell.bottom - t.cell.top > 1 || t.cell.right - t.cell.left > 1;
  return {
    id: t.table,
    style: t.props.style ?? null,
    look: lookOf(t),
    hasLook: !!t.props.look,
    cells: t.cells.length,
    merged,
    rowHeight: t.rowProps.height && t.rowProps.height.value > 0 ? t.rowProps.height.value : null,
    colWidth: t.props.colWidths?.[t.col] ?? null,
  };
}

// ----- style previews -------------------------------------------------------------------

/** A 5 × 5 thumbnail of a table style under `look` (fills and edges from `resolveCell`). */
export function TableStylePreview({ styleId, look, styles }: { styleId: string; look: TableLook; styles: StyleSheet["styles"] }) {
  const all = [...styles, ...BUILTIN_TABLE_STYLES.filter((b) => !styles.some((s) => s.id === b.id))];
  const style = tableStyleFor(all, styleId);
  const n = 5;
  const cells: ReactNode[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const res = resolveCell(style, { look }, {}, { row0: r, row1: r, col0: c, col1: c }, n, n);
      const b = res.cell.borders ?? {};
      const edge = (s: (typeof b)["top"]) => (s && s.style !== "none" ? borderCss({ ...s, width: Math.min(s.width, 15) }) : "1px solid transparent");
      const fill = res.cell.shading && res.cell.shading.kind !== "auto" ? colorCss(res.cell.shading) : undefined;
      const text = res.run.color && res.run.color.kind !== "auto" ? colorCss(res.run.color) : "#9ca3af";
      cells.push(
        <span
          key={`${r}:${c}`}
          className="flex items-center justify-center"
          style={{ background: fill ?? "#fff", borderTop: edge(b.top), borderLeft: edge(b.left), borderBottom: edge(b.bottom), borderRight: edge(b.right) }}
        >
          <span className="block h-px w-2" style={{ background: text, height: res.run.bold ? 2 : 1 }} />
        </span>,
      );
    }
  }
  return (
    <span className="grid h-9 w-14 bg-white" style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, borderCollapse: "collapse" }} aria-hidden="true">
      {cells}
    </span>
  );
}

const styleName = (id: string, styles: StyleSheet["styles"]) =>
  styles.find((s) => s.id === id)?.name ?? BUILTIN_TABLE_STYLES.find((s) => s.id === id)?.name ?? id;

export function tableStyleItems(look: TableLook, styles: StyleSheet["styles"]): RibbonGalleryItem[] {
  const docStyles = styles.filter((s) => s.kind === "table" && s.id !== "TableNormal" && !GALLERY_TABLE_STYLES.includes(s.id)).map((s) => s.id);
  return [...GALLERY_TABLE_STYLES, ...docStyles].map((id) => ({
    id,
    label: styleName(id, styles),
    preview: <TableStylePreview styleId={id} look={look} styles={styles} />,
  }));
}

// ----- icons ----------------------------------------------------------------------------------

const svg = (children: ReactNode) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
export const MERGE_ICON = svg(<><rect x="2.5" y="4" width="15" height="12" /><path d="M6 10h8M12 8l2 2-2 2M8 8l-2 2 2 2" /></>);
export const SPLIT_ICON = svg(<><rect x="2.5" y="4" width="15" height="12" /><path d="M10 4v12M4.5 10h3M15.5 10h-3" /></>);
export const SELECT_ICON = svg(<><rect x="2.5" y="4" width="15" height="12" strokeDasharray="2 1.5" /><path d="M8 8l5 2.5-2.2.6-.6 2.2z" /></>);
export const PROPS_ICON = svg(<><rect x="2.5" y="4" width="15" height="12" /><path d="M2.5 8h15M7.5 4v12" /><circle cx="13.5" cy="12.5" r="1.5" /></>);
export const DIST_ROWS_ICON = svg(<><rect x="3" y="3" width="14" height="14" /><path d="M3 7.7h14M3 12.3h14" /><path d="M10 4.5v2M10 13.5v2" /></>);
export const DIST_COLS_ICON = svg(<><rect x="3" y="3" width="14" height="14" /><path d="M7.7 3v14M12.3 3v14" /><path d="M4.5 10h2M13.5 10h2" /></>);
export const PAINTER_ICON = svg(<><path d="M4 16l2.5-.6L15 6.9 13.1 5 4.6 13.5z" /><path d="M12 6l2 2" /><path d="M3 18h14" /></>);
export const SPLIT_TABLE_ICON = svg(<><rect x="3" y="2.5" width="14" height="5.5" /><rect x="3" y="12" width="14" height="5.5" /><path d="M7 10h6" strokeDasharray="1.5 1.5" /></>);
export const AUTOFIT_ICON = svg(<><rect x="3" y="4" width="14" height="12" /><path d="M10 4v12M5 10h3M15 10h-3M6.5 8.5L5 10l1.5 1.5M13.5 8.5L15 10l-1.5 1.5" /></>);
export const TO_TEXT_ICON = svg(<><rect x="2.5" y="3" width="7" height="7" /><path d="M5.5 3v7M2.5 6.5h7" /><path d="M11 13h7M11 16h5M12 8l2.5 2.5L17 8" /></>);
export const MARGINS_ICON = svg(<><rect x="3" y="3" width="14" height="14" /><rect x="6" y="6" width="8" height="8" strokeDasharray="1.5 1.5" /></>);

const alignIcon = (v: VAlign, h: Alignment) => {
  const y = v === "top" ? 6 : v === "center" ? 10 : 14;
  const [x1, x2] = h === "left" ? [5, 11] : h === "center" ? [7, 13] : [9, 15];
  return svg(<><rect x="3" y="3" width="14" height="14" strokeWidth="1" /><path d={`M${x1} ${y - 1.5}h${x2 - x1}M${x1} ${y + 1.5}h${x2 - x1 - 2}`} /></>);
};

const BORDER_PRESETS: { id: CellBorderPreset; key: string; icon: ReactNode }[] = [
  { id: "bottom", key: "fmt.border.bottom", icon: <Icon name="borderBottom" /> },
  { id: "top", key: "fmt.border.top", icon: <Icon name="borderTop" /> },
  { id: "left", key: "fmt.border.left", icon: <Icon name="borderLeft" /> },
  { id: "right", key: "fmt.border.right", icon: <Icon name="borderRight" /> },
  { id: "none", key: "fmt.border.none", icon: <Icon name="borderNone" /> },
  { id: "all", key: "fmt.border.all", icon: <Icon name="borderAll" /> },
  { id: "outside", key: "fmt.border.outline", icon: <Icon name="borderOutline" /> },
  { id: "inside", key: "write.border.inside", icon: <Icon name="borders" /> },
  { id: "insideH", key: "write.border.insideH", icon: <Icon name="borders" /> },
  { id: "insideV", key: "write.border.insideV", icon: <Icon name="borders" /> },
];

// Two rows of three (Word's order: header/total/banded rows, then the columns).
const LOOK_KEYS: { key: keyof TableLook; label: string }[] = [
  { key: "firstRow", label: "write.look.headerRow" },
  { key: "lastRow", label: "write.look.totalRow" },
  { key: "bandedRows", label: "write.look.bandedRows" },
  { key: "firstCol", label: "write.look.firstColumn" },
  { key: "lastCol", label: "write.look.lastColumn" },
  { key: "bandedCols", label: "write.look.bandedColumns" },
];

// ----- the tabs -----------------------------------------------------------------------------

export interface TableTabsArgs {
  editor: Editor;
  ctl: SyncController;
  features: WriteFeatures;
  info: TableInfo;
  /** Document styles (for the gallery). */
  styles: StyleSheet["styles"];
}

/** Table Design and Table Layout. */
export function tableTabs({ editor, ctl, features, info, styles }: TableTabsArgs): RibbonTab[] {
  const live = () => tableContext(editor.state);
  const run = (make: (t: TableContext) => WriteCommand | WriteCommand[] | null) => () => {
    const tc = live();
    if (!tc) return;
    const c = make(tc);
    const cmds = Array.isArray(c) ? c : c ? [c] : [];
    if (cmds.length) void ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds }).then(() => editor.commands.focus());
  };
  const pageWidth = () => {
    const p = ctl.page;
    return p ? p.width - p.margins.left - p.margins.right : 9026;
  };
  const items = tableStyleItems(info.hasLook ? info.look : WORD_DEFAULT_LOOK, styles);
  const ui = features.ui.getState();
  /** Rendered row heights (twips) of the caret's table, for Distribute Rows. */
  const rowHeights = (tc: TableContext): number[] => {
    const dom = editor.view.nodeDOM(tc.pos) as HTMLElement | null;
    const table = dom?.querySelector?.("table") ?? (dom?.tagName === "TABLE" ? dom : null);
    const zoom = table && (table as HTMLElement).offsetWidth ? table.getBoundingClientRect().width / (table as HTMLElement).offsetWidth || 1 : 1;
    return Array.from(table?.querySelectorAll(":scope > tbody > tr") ?? []).map((tr) => Math.round((tr.getBoundingClientRect().height / zoom) * TWIPS_PER_PX));
  };

  const design: RibbonTab = {
    id: "tableDesign",
    label: t("write.tableDesign"),
    toolbarLabel: t("write.tableDesign"),
    groups: [
      {
        label: t("write.styleOptions"),
        items: (
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] leading-4 text-ui-fg" role="group" aria-label={t("write.styleOptions")}>
            {LOOK_KEYS.map(({ key, label }) => (
              <label key={key} className="flex h-5 items-center gap-1 whitespace-nowrap">
                <input type="checkbox" checked={info.look[key]} onChange={run((tc) => toggleLook(tc, key))} />
                {t(label)}
              </label>
            ))}
          </div>
        ),
      },
      {
        label: t("write.tableStyles"),
        items: (
          <>
            <RibbonGallery label={t("write.tableStyles")} items={items.slice(0, 4)} selected={info.style ?? ""} itemClassName="h-14 w-16 p-0.5" onSelect={(id) => run((tc) => setTableStyle(tc, id))()} />
            <RibbonGallery
              label={t("write.moreTableStyles")}
              variant="dropdown"
              size="small"
              icon="chevronDown"
              items={[...items, { id: "", label: t("write.clearTableStyle"), preview: <span className="text-[10px]">{t("write.none")}</span> }]}
              selected={info.style ?? ""}
              columns={4}
              itemClassName="h-16 w-20 p-1"
              onSelect={(id) => run((tc) => setTableStyle(tc, id))()}
            />
          </>
        ),
      },
      {
        label: t("write.borders"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <ColorPicker label={t("write.shading")} kind="fill" onSelect={(c) => run((tc) => shadeCells(tc, c))()} />
              <span aria-hidden="true" className="whitespace-nowrap pr-1 text-xs">
                {t("write.shading")}
              </span>
            </RibbonRow>
            <RibbonMenuButton
              label={t("fmt.borders")}
              showLabel
              icon={<Icon name="borders" />}
              menu={[
                ...BORDER_PRESETS.map((b) => ({ id: b.id, label: t(b.key), icon: b.icon, onSelect: run((tc) => cellBordersCommand(tc, b.id, b.id === "none" ? undefined : ui.pen)) })),
                { separator: true as const },
                { id: "gridlines", label: t("write.w5.viewGridlines"), checked: ui.gridlines, onSelect: () => features.ui.set({ gridlines: !ui.gridlines }) },
                { id: "dialog", label: t("write.w5.bordersShadingDots"), onSelect: () => features.ui.openDialog("tableBorders") },
              ]}
            />
          </RibbonStack>
        ),
      },
      {
        label: t("write.w5.borderGroup"),
        items: (
          <>
            <RibbonGallery
              label={t("write.w5.borderStyles")}
              variant="dropdown"
              size="large"
              icon={<Icon name="borders" />}
              items={BORDER_PENS.map((p, i) => ({
                id: String(i),
                label: t("write.w5.penLabel", { style: t(`write.borderStyle.${p.style}`), n: p.width / 20 }),
                preview: <span className="block w-12" style={{ borderTop: penCss(p), color: colorCss(p.color) ?? "#000" }} />,
              }))}
              columns={2}
              itemClassName="h-8 w-16 p-1"
              onSelect={(id) => features.ui.set({ pen: BORDER_PENS[Number(id)]!, borderPainter: true })}
            />
            <RibbonStack>
              <RibbonRow>
                <select
                  aria-label={t("write.w5.lineStyle")}
                  title={t("write.w5.lineStyle")}
                  className={`${INPUT} h-6 w-20 text-xs`}
                  value={ui.pen.style}
                  onChange={(e) => features.ui.set({ pen: { ...ui.pen, style: e.target.value as BorderStyle } })}
                >
                  {BORDER_STYLES.map((st) => (
                    <option key={st} value={st}>
                      {t(`write.borderStyle.${st}`)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("write.w5.lineWeight")}
                  title={t("write.w5.lineWeight")}
                  className={`${INPUT} h-6 w-16 text-xs`}
                  value={String(ui.pen.width)}
                  onChange={(e) => features.ui.set({ pen: { ...ui.pen, width: Number(e.target.value) } })}
                >
                  {PEN_WEIGHTS.map((w) => (
                    <option key={w} value={String(w)}>
                      {t("write.ptValue", { n: w / 20 })}
                    </option>
                  ))}
                </select>
              </RibbonRow>
              <RibbonRow>
                <ColorPicker label={t("write.w5.penColor")} kind="text" value={ui.pen.color} onSelect={(c) => features.ui.set({ pen: { ...ui.pen, color: c ?? { kind: "auto" } } })} />
                <span aria-hidden="true" className="whitespace-nowrap pr-1 text-xs">
                  {t("write.w5.penColor")}
                </span>
              </RibbonRow>
            </RibbonStack>
            <RibbonButton
              label={t("write.w5.borderPainter")}
              icon={PAINTER_ICON}
              size="large"
              pressed={ui.borderPainter}
              tooltip={t("write.w5.borderPainterTip")}
              onClick={() => features.ui.set({ borderPainter: !ui.borderPainter })}
            />
          </>
        ),
      },
    ],
  };

  const alignPanel = (close: () => void) => (
    <div className="grid grid-cols-3 gap-0.5 p-0.5" role="group" aria-label={t("write.cellAlignment")}>
      {(["top", "center", "bottom"] as VAlign[]).flatMap((v) =>
        (["left", "center", "right"] as Alignment[]).map((h) => (
          <button
            key={`${v}-${h}`}
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded text-ui-fg hover:bg-ui-hover"
            aria-label={t(`write.cellAlign.${v}.${h}`)}
            title={t(`write.cellAlign.${v}.${h}`)}
            onClick={() => {
              close();
              run((tc) => cellAlignmentCommands(tc, v, h, editor.state.doc))();
            }}
          >
            {alignIcon(v, h)}
          </button>
        )),
      )}
    </div>
  );

  const layout: RibbonTab = {
    id: "tableLayout",
    label: t("write.tableLayout"),
    toolbarLabel: t("write.tableLayout"),
    groups: [
      {
        label: t("write.table"),
        items: (
          <>
            <RibbonMenuButton
              label={t("write.select")}
              icon={SELECT_ICON}
              size="large"
              menu={(["cell", "column", "row", "table"] as const).map((k) => ({ id: k, label: t(`write.select.${k}`), onSelect: () => selectInTable(editor.view, k) }))}
            />
            <RibbonButton label={t("write.w5.viewGridlines")} icon="table" size="large" pressed={ui.gridlines} onClick={() => features.ui.set({ gridlines: !ui.gridlines })} />
            <RibbonButton label={t("write.properties")} icon={PROPS_ICON} size="large" tooltip={t("write.tablePropertiesDots")} onClick={() => features.ui.openDialog("tableProps")} />
          </>
        ),
      },
      {
        label: t("write.rowsCols"),
        items: (
          <>
            <RibbonMenuButton
              label={t("cmd.delete")}
              icon="trash"
              size="large"
              menu={[
                { id: "rows", label: t("write.deleteRows"), icon: "deleteRows", onSelect: run(deleteRows) },
                { id: "cols", label: t("write.deleteCols"), icon: "deleteCols", onSelect: run(deleteCols) },
                { id: "table", label: t("write.deleteTable"), icon: "table", onSelect: run(deleteTable) },
              ]}
            />
            <RibbonButton label={t("write.insertAbove")} icon="insertRows" size="large" onClick={run((tc) => insertRow(tc, false))} />
            <RibbonButton label={t("write.insertBelow")} icon="insertRows" size="large" onClick={run((tc) => insertRow(tc, true))} />
            <RibbonButton label={t("write.insertLeft")} icon="insertCols" size="large" onClick={run((tc) => insertCol(tc, false))} />
            <RibbonButton label={t("write.insertRight")} icon="insertCols" size="large" onClick={run((tc) => insertCol(tc, true))} />
          </>
        ),
      },
      {
        label: t("write.merge"),
        items: (
          <>
            <RibbonButton label={t("write.mergeCells")} icon={MERGE_ICON} size="large" disabled={info.cells < 2} onClick={run(mergeCellsCommand)} />
            <RibbonButton label={t("write.splitCells")} icon={SPLIT_ICON} size="large" tooltip={t("write.splitCellsDots")} onClick={() => features.ui.openDialog("splitCells")} />
            <RibbonButton label={t("write.w5.splitTable")} icon={SPLIT_TABLE_ICON} size="large" shortcut="Mod+Shift+Enter" tooltip={t("write.w5.splitTableTip")} onClick={() => void features.splitTable(editor)} />
          </>
        ),
      },
      {
        label: t("write.cellSize"),
        items: (
          <>
            <RibbonStack>
              <CellSizeField
                label={t("write.heightCm")}
                value={info.rowHeight == null ? "" : cm(info.rowHeight)}
                onCommit={(tw) => run((tc) => setRowHeight(tc, tw && tw > 0 ? { value: tw, rule: "atLeast" } : null))()}
              />
              <CellSizeField
                label={t("write.widthCm")}
                value={info.colWidth == null ? "" : cm(info.colWidth)}
                onCommit={(tw) => {
                  if (tw && tw > 0) run((tc) => setColWidths(tc, setSelectedColWidth(tc, colWidthsOf(tc, pageWidth()), tw)))();
                }}
              />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("write.distributeRows")} icon={DIST_ROWS_ICON} showLabel onClick={run((tc) => distributeRows(tc, rowHeights(tc)))} />
              <RibbonButton label={t("write.distributeCols")} icon={DIST_COLS_ICON} showLabel onClick={run((tc) => setColWidths(tc, distributeCols(tc, colWidthsOf(tc, pageWidth()))))} />
            </RibbonStack>
            <RibbonButton label={t("write.rowHeight")} icon="rowHeight" size="large" tooltip={t("write.rowHeightDots")} onClick={() => features.ui.openDialog("rowHeight")} />
            <RibbonMenuButton
              label={t("write.w5.autoFit")}
              icon={AUTOFIT_ICON}
              size="large"
              menu={[
                {
                  id: "contents",
                  label: t("write.w5.autoFitContents"),
                  onSelect: run((tc) => autoFitCommand(tc, "contents", contentWidths(measureNatural(editor.view, tc), 216, pageWidth()))),
                },
                { id: "window", label: t("write.w5.autoFitWindow"), onSelect: run((tc) => autoFitCommand(tc, "window", renderedWidths(editor.view, tc))) },
                { id: "fixed", label: t("write.w5.fixedWidth"), onSelect: run((tc) => autoFitCommand(tc, "fixed", renderedWidths(editor.view, tc))) },
              ]}
            />
          </>
        ),
      },
      {
        label: t("write.alignment"),
        items: (
          <>
            <RibbonMenuButton label={t("write.cellAlignment")} icon={alignIcon("center", "center")} size="large" menu={alignPanel} />
            <RibbonButton label={t("write.cellMargins")} icon={MARGINS_ICON} size="large" tooltip={t("write.cellMarginsDots")} onClick={() => features.ui.openDialog("cellMargins")} />
          </>
        ),
      },
      {
        label: t("write.data"),
        items: (
          <>
            <RibbonButton
              label={t("write.headerRow")}
              icon="insertRows"
              size="large"
              tooltip={t("write.headerRowTip")}
              onClick={run((tc) => ({ type: "setRowProps", table: tc.table, rows: [0], header: !((tc.node.firstChild?.attrs.props as { header?: boolean } | null)?.header) }))}
            />
            <RibbonButton label={t("write.w5.convertToText")} icon={TO_TEXT_ICON} size="large" tooltip={t("write.w5.convertToTextTip")} onClick={() => features.ui.openDialog("tableToText")} />
          </>
        ),
      },
    ],
  };
  return [design, layout];
}

/** A cm field of the Cell Size group (commits twips on Enter / blur). */
function CellSizeField({ label, value, onCommit }: { label: string; value: string; onCommit: (twips: number | null) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-ui-fg">
      <span className="whitespace-nowrap">{label}</span>
      <input
        key={value}
        aria-label={label}
        className="h-6 w-14 rounded border border-ui-border bg-ui-bg px-1 text-xs text-ui-fg"
        defaultValue={value}
        onBlur={(e) => e.target.value !== value && onCommit(fromCm(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(fromCm((e.target as HTMLInputElement).value));
          }
        }}
      />
    </label>
  );
}

