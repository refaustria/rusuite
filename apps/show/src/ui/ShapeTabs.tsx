// Contextual ribbon tabs of P8-16: Shape Format (Insert Shapes, Edit
// Shape › Change Shape, Shape Styles, Shape Fill / Outline with Arrows and
// Connector type, Arrange with rotate / flip) and, for a selected table,
// Table Design (table styles, style options, shading, borders) and Layout
// (rows & columns, merge, cell size, alignment, cell margins), plus the
// Insert › Table picker.

import { DI } from "./designIcons";
import type { ReactNode } from "react";
import {
  ColorPicker, Icon, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, RibbonRow, RibbonTableSizePicker,
  type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab, type ThemePalette,
} from "@rusuite/ui-shared";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";
import type { Anchor } from "../generated/Anchor";
import type { ArrowSize } from "../generated/ArrowSize";
import type { ConnectorKind } from "../generated/ConnectorKind";
import type { Preset } from "../generated/Preset";
import type { TableLook } from "../generated/TableLook";
import { css } from "../model";
import { ARROW_PRESETS } from "../shapes/connectors";
import { singleCell, splitCommand, TABLE_STYLES, type BorderKind } from "../shapes/tables";
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
function TableStylePreview({ accent, palette }: { accent: number; palette: ThemePalette }) {
  const slot = `accent${accent}` as ThemeColorSlot;
  const c = (tint: number) => css({ kind: "theme", value: { slot, tint } }, palette);
  const rows = [c(0), c(0.6), c(0.8), c(0.6)];
  return (
    <svg aria-hidden="true" width="44" height="30" viewBox="0 0 44 30">
      {rows.map((fill, i) => (
        <rect key={i} x="1" y={1 + i * 7} width="42" height="7" fill={fill} stroke="#fff" strokeWidth="0.8" />
      ))}
      <path d="M15 1v28M29 1v28" stroke="#fff" strokeWidth="0.8" />
    </svg>
  );
}

const LOOK: { key: keyof TableLook; label: string }[] = [
  { key: "firstRow", label: "show.look.firstRow" },
  { key: "firstCol", label: "show.look.firstCol" },
  { key: "lastRow", label: "show.look.lastRow" },
  { key: "lastCol", label: "show.look.lastCol" },
  { key: "bandRows", label: "show.look.bandRows" },
  { key: "bandCols", label: "show.look.bandCols" },
];

const BORDERS: BorderKind[] = ["all", "outside", "inside", "none", "top", "bottom", "left", "right", "insideH", "insideV"];

/** Table Design: style options, table styles, shading and borders of the cell selection. */
export function tableDesignTab(store: ShowStore, palette: ThemePalette, t: T): RibbonTab | null {
  const sel = store.selectedTable();
  if (!sel) return null;
  const { table } = sel;
  const range = store.cellRange();
  const shading = range ? (table.cells[range.r0]?.[range.c0]?.fill ?? null) : null;
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
            <RibbonGallery
              label={t("show.tableStyles")}
              items={TABLE_STYLES.map((s) => ({ id: s.id, label: t("show.tableStyle.medium2", { n: s.accent }), preview: <TableStylePreview accent={s.accent} palette={palette} /> }))}
              selected={table.styleId ?? ""}
              hideLabels
              itemClassName="h-9 w-12"
              onSelect={(id) => void store.setTableStyle(id)}
            />
            <RibbonButton label={t("show.table.clearStyle")} icon="clear" size="large" disabled={!table.styleId} onClick={() => void store.setTableStyle(null)} />
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
                menu={BORDERS.map((b) => ({ id: `border-${b}`, label: t(`show.border.${b}`), onSelect: () => void store.setCellBorders(b) }))}
              />
            </RibbonStack>
          </>
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

/** Layout (table): rows & columns, merge, cell size, alignment and margins of the cell selection. */
export function tableLayoutTab(store: ShowStore, t: T): RibbonTab | null {
  const sel = store.selectedTable();
  if (!sel) return null;
  const range = store.cellRange();
  const multi = !!range && !singleCell(sel.table, range);
  const merged = !!range && splitCommand(sel.shape.id, sel.table, range.r0, range.c0) !== null;
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
            <RibbonButton label={t("show.table.split")} icon="deleteCells" showLabel disabled={!merged} onClick={() => void store.splitCell()} />
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
              label={t("show.table.margins")}
              icon="margins"
              size="large"
              menu={MARGINS.map((m) => ({ id: `margins-${m.id}`, label: t(`show.table.margins.${m.id}`), onSelect: () => void store.setCellMargins(m.insets) }))}
            />
          </>
        ),
      },
    ],
  };
}

