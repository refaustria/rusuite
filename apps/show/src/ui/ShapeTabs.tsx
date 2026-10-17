// Contextual ribbon tabs of P8-16: Shape Format (Insert Shapes, Edit
// Shape › Change Shape, Shape Styles, Shape Fill / Outline with Arrows and
// Connector type, Arrange with rotate / flip) and, for a selected table,
// Table Design (table styles, style options, shading, borders) and Layout
// (rows & columns, merge, cell size, alignment, cell margins), plus the
// Insert › Table picker.

import { DI } from "./designIcons";
import type { ReactNode } from "react";
import {
  ColorPicker, Icon, RibbonButton, formatNumber, RibbonGallery, RibbonMenuButton, RibbonStack, RibbonRow, RibbonTableSizePicker,
  type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab, type ThemePalette,
} from "@rusuite/ui-shared";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";
import type { Anchor } from "../generated/Anchor";
import type { ArrowSize } from "../generated/ArrowSize";
import type { ConnectorKind } from "../generated/ConnectorKind";
import type { Preset } from "../generated/Preset";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Table } from "../generated/Table";
import type { TableLook } from "../generated/TableLook";
import type { TableStyleDef } from "../generated/TableStyleDef";
import { css } from "../model";
import { ARROW_PRESETS } from "../shapes/connectors";
import { BORDER_KINDS, PEN_WEIGHTS_PT, singleCell, styleCell, tableStyleGroups } from "../shapes/tables";
import type { LineDash } from "../generated/LineDash";
import type { TextDirection } from "../generated/TextDirection";
import { sitesOf } from "../canvas/EditHandles";
import type { ShowState, ShowStore } from "../state/store";
import { ShapeLibrary } from "./ShapeGallery";

type T = (key: string, args?: Record<string, string | number>) => string;

/** Insert › Table: the 10 × 8 picker and Insert Table… (a dialog for larger tables). */
export function tableMenu(store: ShowStore, t: T) {
  return (close: () => void): ReactNode => (
    <div className="flex flex-col gap-1 p-1">
      <RibbonTableSizePicker
        maxRows={8}
        maxCols={10}
        onPick={(rows, cols) => {
          close();
          void store.insertTable(rows, cols);
        }}
      />
      <button
        type="button"
        className="rounded px-2 py-1 text-left text-sm hover:bg-ui-hover"
        onClick={() => {
          close();
          store.openDialog({ kind: "insertTable" });
        }}
      >
        {t("show.table.insertDots")}
      </button>
    </div>
  );
}

/** Insert › Shapes / the shapes button: the grouped library (a click arms drawing, keys insert). */
export function shapesMenu(store: ShowStore, state: ShowState) {
  return (close: () => void): ReactNode => (
    <ShapeLibrary
      recent={state.recentShapes}
      autoFocus
      onPick={(id, keyboard) => {
        close();
        if (keyboard) void store.insertChoice(id);
        else store.setDrawMode(id);
      }}
    />
  );
}

const STYLE_KINDS = ["fill", "light", "outline"] as const;
const SAMPLE = "Abc"; // i18n-ignore: sample text of a style preview

function styleItems(palette: ThemePalette, t: T): RibbonGalleryItem[] {
  return STYLE_KINDS.flatMap((kind) =>
    [1, 2, 3, 4, 5, 6].map((accent) => {
      const slot = `accent${accent}` as ThemeColorSlot;
      const c = (tint: number) => css({ kind: "theme", value: { slot, tint } }, palette);
      const fill = kind === "fill" ? c(0) : kind === "light" ? c(0.8) : "none";
      const stroke = kind === "fill" ? c(-0.25) : c(0);
      return {
        id: `${kind}-${accent}`,
        label: t(`show.shapeStyle.${kind}`, { n: accent }),
        preview: (
          <svg aria-hidden="true" width="40" height="22" viewBox="0 0 40 22">
            <rect x="2" y="2" width="36" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth={kind === "outline" ? 2 : 1} />
            <text x="20" y="15" textAnchor="middle" fontSize="9" fill={kind === "fill" ? "#fff" : "#333"}>
              {SAMPLE}
            </text>
          </svg>
        ),
      };
    }),
  );
}

/** The Shape Format tab's groups for the selection. */
export function shapeFormatGroups(store: ShowStore, state: ShowState, palette: ThemePalette, t: T, arrange: RibbonMenuItem[]) {
  const sel = store.selectedShapes();
  const autos = sel.filter((s) => s.kind.kind === "auto");
  const connectors = sel.filter((s) => s.kind.kind === "connector");
  const first = sel[0];
  const conn = connectors[0]?.kind.kind === "connector" ? connectors[0].kind.value : null;
  const arrows: RibbonMenuItem[] = [
    ...ARROW_PRESETS.map((a) => ({
      id: `arrows-${a.id}`,
      label: t(`show.arrows.${a.id}`),
      checked: !!conn && (conn.head?.kind ?? "none") === a.head && (conn.tail?.kind ?? "none") === a.tail,
      disabled: !conn,
      onSelect: () => void store.setArrows(a.head, a.tail),
    })),
    { separator: true, label: t("show.arrows.size") },
    ...(["small", "medium", "large"] as ArrowSize[]).map((size) => ({
      id: `arrowSize-${size}`,
      label: t(`show.arrows.${size}`),
      disabled: !conn,
      onSelect: () => void store.setArrowSize(size),
    })),
  ];
  const connectorMenu: RibbonMenuItem[] = [
    ...(["straight", "elbow", "curved"] as ConnectorKind[]).map((kind) => ({
      id: `connector-${kind}`,
      label: t(`show.connector.${kind}`),
      checked: conn?.kind === kind,
      disabled: !conn,
      onSelect: () => void store.setConnectorKind(kind),
    })),
    { separator: true },
    {
      id: "reroute",
      label: t("show.connector.reroute"),
      disabled: !conn,
      onSelect: () => {
        const slide = store.currentSlide();
        void store.rerouteConnectors((id) => {
          const s = slide?.shapes.find((x) => x.id === id);
          return s ? sitesOf(s) : [];
        });
      },
    },
  ];
  return [
    {
      label: t("show.insertShapes"),
      items: (
        <>
          <RibbonMenuButton label={t("show.shapes")} icon="shapes" size="large" menu={shapesMenu(store, state)} />
          <RibbonStack>
            <RibbonMenuButton
              label={t("show.changeShape")}
              icon="shapes"
              showLabel
              disabled={autos.length === 0}
              menu={(close) => (
                <ShapeLibrary
                  presetsOnly
                  autoFocus
                  onPick={(id) => {
                    close();
                    void store.changeShape(id as Preset);
                  }}
                />
              )}
            />
            <RibbonButton
              label={t("show.editPoints")}
              icon={<svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 15L7 4l6 4 4 9z" /><rect x="5.5" y="2.5" width="3" height="3" fill="currentColor" /><rect x="11.5" y="6.5" width="3" height="3" fill="currentColor" /></svg>}
              showLabel
              disabled={autos.length !== 1}
              pressed={autos.length === 1 && state.editPoints === autos[0]!.id}
              onClick={() => store.setEditPoints(!(autos.length === 1 && state.editPoints === autos[0]!.id))}
            />
          </RibbonStack>
        </>
      ),
    },
    {
      label: t("show.shapeStyles"),
      items: (
        <>
          <RibbonGallery
            label={t("show.shapeStyles")}
            items={styleItems(palette, t)}
            variant="dropdown"
            icon="format"
            columns={6}
            hideLabels
            itemClassName="h-8 w-12"
            disabled={sel.length === 0}
            onSelect={(id) => {
              const [kind, n] = id.split("-");
              void store.applyShapeStyle({ kind: kind as "fill" | "light" | "outline", accent: Number(n) });
            }}
          />
          <RibbonStack>
            <ColorPicker
              label={t("show.shapeFill")}
              kind="fill"
              value={first && first.fill.kind === "solid" ? first.fill.value : undefined}
              theme={palette}
              disabled={sel.length === 0}
              onSelect={(c) => void store.setFill(c)}
            />
            <ColorPicker
              label={t("show.shapeOutline")}
              kind="fill"
              value={first && first.line.fill.kind === "solid" ? first.line.fill.value : undefined}
              theme={palette}
              disabled={sel.length === 0}
              onSelect={(c) => void store.setLine(c)}
            />
          </RibbonStack>
          <RibbonStack>
            <RibbonMenuButton label={t("show.arrows")} icon="line" showLabel disabled={!conn} menu={arrows} />
            <RibbonMenuButton label={t("show.connectorType")} icon="arrange" showLabel disabled={!conn} menu={connectorMenu} />
          </RibbonStack>
        </>
      ),
    },
    {
      label: t("show.arrange"),
      items: (
        <>
          <RibbonMenuButton label={t("show.arrange")} icon="arrange" size="large" menu={arrange} />
          <RibbonMenuButton
            label={t("show.rotate")}
            icon="redo"
            size="large"
            disabled={sel.length === 0}
            menu={[
              { id: "rotRight", label: t("show.rotate.right"), onSelect: () => void store.rotateOrFlip("right") },
              { id: "rotLeft", label: t("show.rotate.left"), onSelect: () => void store.rotateOrFlip("left") },
              { id: "flipV", label: t("show.rotate.flipV"), onSelect: () => void store.rotateOrFlip("flipV") },
              { id: "flipH", label: t("show.rotate.flipH"), onSelect: () => void store.rotateOrFlip("flipH") },
              { separator: true },
              { id: "moreRotation", label: t("show.rotate.moreDots"), onSelect: () => store.openFormatPane("size") },
            ]}
          />
          <RibbonButton label={t("show.selPane.title")} icon={DI.selectionPane} showLabel pressed={state.selectionPane} onClick={() => store.toggleSelectionPane()} />
        </>
      ),
    },
  ];
}

/** A small table picture of a table style (header row, banded rows). */
/** A 5 × 4 sample table drawn with `style` and the selected table's options (gallery previews). */
export function TableStylePreview({ style, look, palette }: { style: TableStyleDef; look: TableLook; palette: ThemePalette }) {
  const rows = 5;
  const cols = 4;
  const sample: Table = {
    rows: Array.from({ length: rows }, () => ({ height: 1 })),
    cols: Array.from({ length: cols }, () => ({ width: 1 })),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ text: { props: { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" }, paragraphs: [] } }))),
    styleId: style.id,
    look,
  };
  const cw = 42 / cols;
  const rh = 28 / rows;
  const out: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = styleCell(sample, r, c, [style]);
      const x = 1 + c * cw;
      const y = 1 + r * rh;
      out.push(<rect key={`f${r}-${c}`} x={x} y={y} width={cw} height={rh} fill={s.fill ? css(s.fill, palette) : "#ffffff"} />);
      const line = (k: string, l: { color: Color; width: number } | null, x1: number, y1: number, x2: number, y2: number) =>
        l && out.push(<line key={`${k}${r}-${c}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={css(l.color, palette)} strokeWidth={l.width > 20000 ? 1.4 : 0.6} />);
      line("t", s.borders.top, x, y, x + cw, y);
      line("b", s.borders.bottom, x, y + rh, x + cw, y + rh);
      line("l", s.borders.left, x, y, x, y + rh);
      line("r", s.borders.right, x + cw, y, x + cw, y + rh);
      if (s.textColor) out.push(<rect key={`t${r}-${c}`} x={x + cw * 0.25} y={y + rh * 0.4} width={cw * 0.5} height={0.9} fill={css(s.textColor, palette)} />);
    }
  }
  return (
    <svg aria-hidden="true" width="44" height="30" viewBox="0 0 44 30" data-style-id={style.id}>
      {out}
    </svg>
  );
}

/** The localized name of a built-in table style ("Medium Style 2 – Accent 3"); other styles keep their own. */
export function tableStyleLabel(style: TableStyleDef, t: T): string {
  const m = /^(?:(No Style, No Grid)|(No Style, Table Grid)|(Themed|Light|Medium|Dark) Style (\d))(?: - Accent (\d)(?:\/Accent (\d))?)?$/.exec(style.name);
  if (!m) return style.name;
  const base = m[1] ? t("show.tableStyle.noGrid") : m[2] ? t("show.tableStyle.tableGrid") : t(`show.tableStyle.${m[3]!.toLowerCase()}`, { n: m[4]! });
  if (m[6]) return t("show.tableStyle.accentPair", { name: base, a: m[5]!, b: m[6] });
  if (m[5]) return t("show.tableStyle.accent", { name: base, a: m[5] });
  return base;
}

/** Table Styles ▾: every built-in style grouped Light / Medium / Dark (and the presentation's own). */
function TableStylesMenu({ store, table, palette, t, close }: { store: ShowStore; table: Table; palette: ThemePalette; t: T; close: () => void }) {
  const custom = store.getState().pres?.tableStyles ?? [];
  const groups: { id: string; label: string; styles: TableStyleDef[] }[] = [
    ...(custom.length ? [{ id: "custom", label: t("show.tableStyleGroup.custom"), styles: custom }] : []),
    ...tableStyleGroups().map((g) => ({ id: g.id, label: t(`show.tableStyleGroup.${g.id}`), styles: g.styles })),
  ];
  return (
    <div
      className="flex max-h-[70vh] w-[22rem] flex-col gap-2 overflow-y-auto p-2"
      data-testid="table-styles-menu"
      onMouseOver={(e) => previewFrom(store, e.target)}
      onFocus={(e) => previewFrom(store, e.target)}
      onMouseLeave={() => store.previewTableStyle(null)}
    >
      {groups.map((g) => (
        <section key={g.id} className="flex flex-col gap-1">
          <h3 className="px-1 text-[11px] font-medium text-ui-muted">{g.label}</h3>
          <div role="group" aria-label={g.label} className="grid grid-cols-7 gap-1">
            {g.styles.map((s) => {
              const label = tableStyleLabel(s, t);
              return (
                <button
                  key={s.id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={table.styleId?.toUpperCase() === s.id.toUpperCase()}
                  className={`flex h-9 w-11 items-center justify-center rounded border ${table.styleId?.toUpperCase() === s.id.toUpperCase() ? "border-ui-focus bg-ui-active" : "border-transparent hover:bg-ui-hover"}`}
                  onClick={() => {
                    close();
                    void store.setTableStyle(s.id);
                  }}
                >
                  <TableStylePreview style={s} look={table.look} palette={palette} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The styles shown inline in Table Design: the Best Match for Document group (as PowerPoint's first gallery row). */
function quickTableStyles(): TableStyleDef[] {
  return tableStyleGroups().find((g) => g.id === "best")!.styles;
}

/** Live preview: the style id of the gallery item under the pointer (or focused) is shown on the table. */
function previewFrom(store: ShowStore, target: EventTarget) {
  const el = target instanceof Element ? target.closest("[data-style-id]") ?? target.querySelector?.("[data-style-id]") : null;
  const id = el?.getAttribute("data-style-id") ?? null;
  if (id) store.previewTableStyle(id);
}

const LOOK: { key: keyof TableLook; label: string }[] = [
  { key: "firstRow", label: "show.look.firstRow" },
  { key: "firstCol", label: "show.look.firstCol" },
  { key: "lastRow", label: "show.look.lastRow" },
  { key: "lastCol", label: "show.look.lastCol" },
  { key: "bandRows", label: "show.look.bandRows" },
  { key: "bandCols", label: "show.look.bandCols" },
];

/** Draw Borders › Pen Style. */
const PEN_DASHES: LineDash[] = ["solid", "dash", "dot"];

/** Table Design: style options, table styles, shading and borders of the cell selection. */
export function tableDesignTab(store: ShowStore, palette: ThemePalette, t: T): RibbonTab | null {
  const sel = store.selectedTable();
  if (!sel) return null;
  const { table } = sel;
  const range = store.cellRange();
  const shading = range ? (table.cells[range.r0]?.[range.c0]?.fill ?? null) : null;
  const pen = store.getState().pen;
  return {
    id: "tableDesign",
    label: t("show.tableDesign"),
    groups: [
      {
        label: t("show.tableStyleOptions"),
        items: (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {LOOK.map((l) => (
              <label key={l.key} className="flex items-center gap-1 whitespace-nowrap">
                <input type="checkbox" checked={!!table.look[l.key]} onChange={(e) => void store.setTableLook(l.key, e.currentTarget.checked)} />
                {t(l.label)}
              </label>
            ))}
          </div>
        ),
      },
      {
        label: t("show.tableStyles"),
        items: (
          <>
            <div className="contents" onMouseOver={(e) => previewFrom(store, e.target)} onFocus={(e) => previewFrom(store, e.target)} onMouseLeave={() => store.previewTableStyle(null)} onBlur={() => store.previewTableStyle(null)}>
            <RibbonGallery
              label={t("show.tableStyles")}
              items={quickTableStyles().map((s) => ({ id: s.id, label: tableStyleLabel(s, t), preview: <TableStylePreview style={s} look={table.look} palette={palette} /> }))}
              selected={table.styleId ?? ""}
              hideLabels
              itemClassName="h-9 w-12"
              onSelect={(id) => void store.setTableStyle(id)}
            />
            </div>
            <RibbonMenuButton label={t("show.tableStyle.more")} icon="table" size="large" showLabel menu={(close) => <TableStylesMenu store={store} table={table} palette={palette} t={t} close={close} />} />
            <RibbonButton label={t("show.table.clearStyle")} icon="clear" size="large" onClick={() => void store.clearTable()} />
          </>
        ),
      },
      {
        label: t("show.table.cellFormat"),
        items: (
          <>
            <RibbonStack>
              <RibbonRow>
                <ColorPicker
                  label={t("show.table.shading")}
                  kind="fill"
                  value={shading?.kind === "solid" ? shading.value : undefined}
                  theme={palette}
                  onSelect={(c) => void store.setCellShading(c)}
                />
                <span aria-hidden="true" className="whitespace-nowrap pr-1 text-xs">
                  {t("show.table.shading")}
                </span>
              </RibbonRow>
              <RibbonButton label={t("show.table.noShading")} icon="clear" showLabel onClick={() => void store.setCellShading(null)} />
            </RibbonStack>
            <RibbonStack>
              <RibbonMenuButton
                label={t("show.table.borders")}
                icon="gridlines"
                showLabel
                menu={BORDER_KINDS.map((b) => ({ id: `border-${b}`, label: t(`show.border.${b}`), onSelect: () => void store.setCellBorders(b) }))}
              />
            </RibbonStack>
          </>
        ),
      },
      {
        // the pen the Borders menu draws with (PowerPoint's Draw Borders group)
        label: t("show.table.drawBorders"),
        items: (
          <RibbonStack>
            <RibbonMenuButton
              label={t("show.pen.style")}
              icon={<svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h14" /><path d="M3 10h14" strokeDasharray="3 2" /><path d="M3 14h14" strokeDasharray="1 2" /></svg>}
              showLabel
              menu={PEN_DASHES.map((d) => ({ id: `pen-dash-${d}`, label: t(`show.pen.dash.${d}`), checked: pen.dash === d, onSelect: () => store.setPen({ dash: d }) }))}
            />
            <RibbonMenuButton
              label={t("show.pen.weight")}
              icon={<svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M3 5h14" strokeWidth="1" /><path d="M3 10h14" strokeWidth="2" /><path d="M3 15h14" strokeWidth="3.5" /></svg>}
              showLabel
              menu={PEN_WEIGHTS_PT.map((w) => ({
                id: `pen-weight-${w}`,
                label: t("show.pen.pt", { n: formatNumber(w, { maximumFractionDigits: 2 }) }),
                checked: Math.round(w * 12700) === pen.width,
                onSelect: () => store.setPen({ width: Math.round(w * 12700) }),
              }))}
            />
            <RibbonRow>
              <ColorPicker label={t("show.pen.color")} kind="text" value={pen.color} theme={palette} onSelect={(c) => c && store.setPen({ color: c })} />
              <span aria-hidden="true" className="whitespace-nowrap pr-1 text-xs">
                {t("show.pen.color")}
              </span>
            </RibbonRow>
          </RibbonStack>
        ),
      },
    ],
  };
}

const MARGINS: { id: string; insets: { left: number; top: number; right: number; bottom: number } }[] = [
  { id: "normal", insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 } },
  { id: "none", insets: { left: 0, top: 0, right: 0, bottom: 0 } },
  { id: "narrow", insets: { left: 45720, top: 45720, right: 45720, bottom: 45720 } },
  { id: "wide", insets: { left: 137160, top: 137160, right: 137160, bottom: 137160 } },
];

const DIRECTIONS: TextDirection[] = ["horizontal", "rotate90", "rotate270", "stacked"];

/** Layout (table): rows & columns, merge, cell size, alignment, text direction and margins of the cell selection. */
export function tableLayoutTab(store: ShowStore, t: T): RibbonTab | null {
  const sel = store.selectedTable();
  if (!sel) return null;
  const range = store.cellRange();
  const multi = !!range && !singleCell(sel.table, range);
  const vert = range ? (sel.table.cells[range.r0]?.[range.c0]?.text.props.vert ?? "horizontal") : "horizontal";
  const anchorBtn = (a: Anchor, label: string, icon: string) => (
    <RibbonButton label={t(label)} icon={<span aria-hidden="true" className="text-[11px]">{icon}</span>} onClick={() => void store.setCellAnchor(a)} />
  );
  return {
    id: "tableLayout",
    label: t("show.tableLayout"),
    groups: [
      {
        label: t("show.table.rowsCols"),
        items: (
          <>
            <RibbonMenuButton
              label={t("cmd.delete")}
              icon="trash"
              size="large"
              menu={[
                { id: "delRows", label: t("show.table.deleteRows"), onSelect: () => void store.deleteRows() },
                { id: "delCols", label: t("show.table.deleteCols"), onSelect: () => void store.deleteCols() },
                { id: "delTable", label: t("show.table.deleteTable"), onSelect: () => void store.deleteTable() },
              ]}
            />
            <RibbonStack>
              <RibbonButton label={t("show.table.insertAbove")} icon="insertRows" showLabel onClick={() => void store.insertRows(false)} />
              <RibbonButton label={t("show.table.insertBelow")} icon="insertRows" showLabel onClick={() => void store.insertRows(true)} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("show.table.insertLeft")} icon="insertCols" showLabel onClick={() => void store.insertCols(false)} />
              <RibbonButton label={t("show.table.insertRight")} icon="insertCols" showLabel onClick={() => void store.insertCols(true)} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.table.mergeGroup"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("show.table.merge")} icon="insertCells" showLabel disabled={!multi} onClick={() => void store.mergeCells()} />
            <RibbonButton label={t("show.table.splitDots")} icon="deleteCells" showLabel disabled={!range} onClick={() => store.openDialog({ kind: "splitCells" })} />
          </RibbonStack>
        ),
      },
      {
        label: t("show.table.cellSize"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("show.table.distributeRows")} icon="rowHeight" showLabel onClick={() => void store.distributeTable("rows")} />
            <RibbonButton label={t("show.table.distributeCols")} icon="colWidth" showLabel onClick={() => void store.distributeTable("cols")} />
          </RibbonStack>
        ),
      },
      {
        label: t("show.table.alignment"),
        items: (
          <>
            <RibbonStack>
              <RibbonRow>
                <RibbonButton label={t("show.alignTextLeft")} icon={<Icon name="alignLeft" />} onClick={() => void store.setCellAlignment("left")} />
                <RibbonButton label={t("show.centerText")} icon={<Icon name="alignCenter" />} onClick={() => void store.setCellAlignment("center")} />
                <RibbonButton label={t("show.alignTextRight")} icon={<Icon name="alignRight" />} onClick={() => void store.setCellAlignment("right")} />
              </RibbonRow>
              <RibbonRow>
                {anchorBtn("top", "show.table.alignTop", "⤒")}
                {anchorBtn("middle", "show.table.alignMiddle", "↕")}
                {anchorBtn("bottom", "show.table.alignBottom", "⤓")}
              </RibbonRow>
            </RibbonStack>
            <RibbonMenuButton
              label={t("show.table.textDirection")}
              icon={<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 16V5.5l3.5 9 3.5-9V16" transform="rotate(90 8.5 10.5)" /><path d="M15.5 4v12M13.5 14l2 2 2-2" /></svg>}
              size="large"
              menu={DIRECTIONS.map((d) => ({ id: `vert-${d}`, label: t(`show.fmtPane.dir.${d}`), checked: vert === d, onSelect: () => void store.setCellVert(d) }))}
            />
            <RibbonMenuButton
              label={t("show.table.margins")}
              icon="margins"
              size="large"
              menu={[
                ...MARGINS.map((m) => ({ id: `margins-${m.id}`, label: t(`show.table.margins.${m.id}`), onSelect: () => void store.setCellMargins(m.insets) })),
                { separator: true as const },
                { id: "margins-custom", label: t("show.table.margins.custom"), onSelect: () => store.openDialog({ kind: "cellLayout" }) },
              ]}
            />
          </>
        ),
      },
    ],
  };
}

