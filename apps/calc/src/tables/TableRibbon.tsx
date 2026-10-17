// Excel tables in Calc's ribbon (P8-35): Insert › Tables › Table (Ctrl+T)
// and the contextual Table Design tab shown while a cell of a table is
// selected: the table name, Resize Table, Summarize with PivotTable,
// Remove Duplicates, Convert to Range, the Table Style Options and the
// Table Styles gallery with the custom styles (P9-C2: New Table Style…,
// Modify / Duplicate / Delete / Set As Default on an item's context menu)
// and Insert Slicer. The external table data group is not offered.

import { useEffect, useState } from "react";
import { ContextMenu, RIBBON_SELECT, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type ContextMenuItem, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import type { Table } from "../generated/Table";
import type { TableStyles } from "../generated/TableStyles";
import { useT } from "../i18n";
import { deleteStyle, withDefault } from "./TableStyleDialog";
import type { CalcStore } from "../state/store";
import { tableDesignIcon, convertIcon, duplicatesIcon, resizeIcon, tableIcon } from "./icons";
import { customStyle, DEFAULT_TABLE_STYLE, previewColors, TABLE_STYLES, tableStyleNumber } from "./styles";

/** A table style's gallery preview: header band, striped rows, lines. */
export function TableStylePreview({ id, width = 61, height = 46, styles }: { id: string; width?: number; height?: number; styles?: TableStyles }) {
  const c = previewColors(id, styles);
  const rows = 5;
  const rh = height / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const fill = r === 0 ? c.header : c.rows[(r - 1) % 2];
    out.push(<rect key={`f${r}`} x={0} y={r * rh} width={width} height={rh} fill={fill} />);
    const text = r === 0 ? c.headerText : "#595959";
    out.push(<rect key={`t${r}`} x={4} y={r * rh + rh / 2 - 1} width={width * 0.3} height={2} fill={text} opacity={r === 0 ? 1 : 0.6} />);
    out.push(<rect key={`v${r}`} x={width * 0.62} y={r * rh + rh / 2 - 1} width={width * 0.3} height={2} fill={text} opacity={r === 0 ? 1 : 0.6} />);
  }
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {out}
      <line x1={0} y1={rh} x2={width} y2={rh} stroke={c.line} />
      <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={c.line} />
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke="#c8c8c8" />
    </svg>
  );
}

/** Excel's gallery label (`Medium 2`; a custom style: its name). */
export function tableStyleLabel(t: T, id: string, styles?: TableStyles): string {
  const custom = customStyle(styles, id);
  if (custom) return custom.name;
  const s = tableStyleNumber(id);
  return s ? t(`calc.table.styleName.${s.family}`, { n: s.n }) : t("calc.table.styleNone");
}

/** The Table Styles gallery panel: Custom, Light, Medium, Dark, then Clear and New Table Style…; right-click: Modify / Duplicate / Delete / Set As Default. */
function StyleGalleryPanel({ store, table, close }: { store: CalcStore; table: Table; close: () => void }) {
  const t = useT();
  const styles = store.getState().info?.tableStyles;
  const style = table.style || DEFAULT_TABLE_STYLE;
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const done = (p: Promise<void>) => {
    void p;
    store.focusGrid();
  };
  const custom = (styles?.custom ?? []).map((s) => s.name);
  const isDefault = (id: string) => (styles?.defaultStyle ?? DEFAULT_TABLE_STYLE).toLowerCase() === id.toLowerCase();
  const menuItems = (id: string): ContextMenuItem[] => {
    const own = !!customStyle(styles, id);
    const items: ContextMenuItem[] = [
      { id: "apply", label: t("calc.tableStyle.apply"), onSelect: () => { close(); done(store.tables.setStyle(table.id, id)); } },
      { separator: true },
    ];
    if (own) items.push({ id: "modify", label: t("calc.tableStyle.modifyDots"), onSelect: () => { close(); store.openDialog({ kind: "tableStyle", mode: "modify", name: id }); } });
    items.push({ id: "duplicate", label: t("calc.tableStyle.duplicateDots"), onSelect: () => { close(); store.openDialog({ kind: "tableStyle", mode: "duplicate", name: id }); } });
    if (own) items.push({ id: "delete", label: t("calc.tableStyle.delete"), onSelect: () => { close(); done(store.tables.setStyles(deleteStyle(styles, id))); } });
    items.push({ separator: true });
    items.push({ id: "default", label: t("calc.tableStyle.setAsDefault"), disabled: isDefault(id), onSelect: () => { close(); done(store.tables.setStyles(withDefault(styles, id))); } });
    return items;
  };
  const groups: { key: string; label: string; ids: string[] }[] = [
    ...(custom.length ? [{ key: "custom", label: t("calc.table.styleGroup.custom"), ids: custom }] : []),
    ...(["light", "medium", "dark"] as const).map((family) => ({ key: family, label: t(`calc.table.styleGroup.${family}`), ids: TABLE_STYLES.filter((s) => tableStyleNumber(s)?.family === family) })),
  ];
  return (
    <div className="flex max-h-[70vh] w-max flex-col gap-1 overflow-auto" data-testid="table-style-gallery">
      {groups.map((g, i) => (
        <div key={g.key}>
          <div className="px-1 text-[11px] font-medium text-ui-muted">{g.label}</div>
          <RibbonGallery
            label={g.label}
            items={g.ids.map((s) => ({ id: s, label: tableStyleLabel(t, s, styles), preview: <TableStylePreview id={s} styles={styles} /> }))}
            selected={style}
            columns={7}
            hideLabels={g.key !== "custom"}
            itemClassName={g.key === "custom" ? "h-[66px] w-[67px] p-0.5 text-[10px]" : "h-[52px] w-[67px] p-0.5"}
            autoFocus={i === 0}
            onItemContextMenu={(id, at) => setMenu({ id, at })}
            onSelect={(s) => {
              close();
              done(store.tables.setStyle(table.id, s));
            }}
          />
        </div>
      ))}
      <div className="mx-1 mt-1 flex flex-col border-t border-ui-border pt-1">
        <button type="button" className="h-7 rounded px-2 text-left text-xs hover:bg-ui-hover" onClick={() => { close(); store.openDialog({ kind: "tableStyle", mode: "new", tableId: table.id }); }}>
          {t("calc.tableStyle.newDots")}
        </button>
        <button
          type="button"
          className="h-7 rounded px-2 text-left text-xs hover:bg-ui-hover"
          onClick={() => {
            close();
            done(store.tables.setStyle(table.id, ""));
          }}
        >
          {t("calc.table.clearStyle")}
        </button>
      </div>
      <ContextMenu at={menu?.at ?? null} label={t("calc.tableStyle.menu")} items={menu ? menuItems(menu.id) : []} onClose={() => setMenu(null)} />
    </div>
  );
}

/** Insert › Tables › Table (next to PivotTable). */
export function tableInsertButton(store: CalcStore, t: T, off: boolean) {
  return (
    <RibbonButton
      label={t("calc.table.table")}
      icon={tableIcon()}
      size="large"
      shortcut="Mod+T"
      tooltip={t("calc.table.insertTip")}
      disabled={off}
      onClick={() => openCreateTable(store)}
    />
  );
}

/** Ctrl+T / Insert › Table: the dialog with the selection (a single cell: its region) and a header guess. */
export function openCreateTable(store: CalcStore): void {
  if (store.tables.active()) {
    store.pushError(new Error(store.tables.overlapMessage()));
    return;
  }
  const a = store.activeAnchor();
  const sel = store.selectionRange();
  const single = sel.r0 === sel.r1 && sel.c0 === sel.c1;
  const range = single ? store.currentRegion(a.row, a.col) : sel;
  store.openDialog({
    kind: "createTable",
    range,
    hasHeaders: store.tables.guessHeaders(range),
  });
}

/** The table name box (Enter renames). */
function NameBox({ store, table, label }: { store: CalcStore; table: Table; label: string }) {
  const [text, setText] = useState(table.name);
  useEffect(() => setText(table.name), [table.name]);
  return (
    <input
      aria-label={label}
      data-testid="table-name"
      className={`${RIBBON_SELECT} w-28 font-mono`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (text !== table.name) void store.tables.rename(table.id, text);
          store.focusGrid();
        } else if (e.key === "Escape") {
          setText(table.name);
          store.focusGrid();
        }
      }}
      onBlur={() => setText(table.name)}
    />
  );
}

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: () => void; testId?: string }) {
  return (
    <label className="flex h-6 items-center gap-1.5 px-1 text-xs">
      <input type="checkbox" checked={checked} onChange={onChange} data-testid={testId} />
      {label}
    </label>
  );
}

/** The contextual Table Design tab (`null`: no table cell selected). */
export function tableDesignTab(store: CalcStore, t: T): RibbonTab | null {
  const table = store.tables.active();
  if (!table) return null;
  const tables = store.tables;
  const id = table.id;
  const done = (p: Promise<void>) => {
    void p;
    store.focusGrid();
  };
  const style = table.style || DEFAULT_TABLE_STYLE;
  return {
    id: "tableDesign",
    label: t("calc.table.tab"),
    groups: [
      {
        label: t("calc.table.properties"),
        items: (
          <RibbonStack>
            <NameBox store={store} table={table} label={t("calc.table.name")} />
            <RibbonButton label={t("calc.table.resize")} icon={resizeIcon()} showLabel onClick={() => store.openDialog({ kind: "resizeTable", id })} />
          </RibbonStack>
        ),
      },
      {
        label: t("calc.table.tools"),
        items: (
          <>
            <RibbonStack>
              <RibbonButton label={t("calc.table.summarize")} icon={tableDesignIcon()} showLabel onClick={() => store.openDialog({ kind: "pivotCreate" })} />
              <RibbonButton
                label={t("calc.dup.button")}
                icon={duplicatesIcon()}
                showLabel
                onClick={() =>
                  store.openDialog({
                    kind: "removeDuplicates",
                    range: {
                      r0: table.r0,
                      c0: table.c0,
                      r1: table.r1 - (table.totalsRow ? 1 : 0),
                      c1: table.c1,
                    },
                    hasHeader: table.headerRow,
                  })
                }
              />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("calc.table.convert")} icon={convertIcon()} showLabel onClick={() => done(tables.convertToRange(id))} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.table.styleOptions"),
        items: (
          <>
            <RibbonStack>
              <Check label={t("calc.table.headerRow")} checked={table.headerRow} onChange={() => done(tables.setOption(id, "headerRow", !table.headerRow))} />
              <Check
                label={t("calc.table.totalRow")}
                testId="table-total-row"
                checked={!!table.totalsRow}
                onChange={() => done(tables.setOption(id, "totalsRow", !table.totalsRow))}
              />
            </RibbonStack>
            <RibbonStack>
              <Check
                label={t("calc.table.bandedRows")}
                checked={table.look.bandedRows}
                onChange={() => done(tables.setLook(id, { bandedRows: !table.look.bandedRows }))}
              />
              <Check
                label={t("calc.table.bandedColumns")}
                checked={table.look.bandedColumns}
                onChange={() =>
                  done(
                    tables.setLook(id, {
                      bandedColumns: !table.look.bandedColumns,
                    }),
                  )
                }
              />
            </RibbonStack>
            <RibbonStack>
              <Check
                label={t("calc.table.firstColumn")}
                checked={table.look.firstColumn}
                onChange={() =>
                  done(
                    tables.setLook(id, {
                      firstColumn: !table.look.firstColumn,
                    }),
                  )
                }
              />
              <Check
                label={t("calc.table.lastColumn")}
                checked={table.look.lastColumn}
                onChange={() => done(tables.setLook(id, { lastColumn: !table.look.lastColumn }))}
              />
            </RibbonStack>
            <RibbonStack>
              <Check
                label={t("calc.table.filterButton")}
                checked={!!table.autoFilter}
                onChange={() => done(tables.setOption(id, "filterButton", !table.autoFilter))}
              />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.table.styles"),
        items: (
          <RibbonMenuButton
            label={t("calc.table.stylesGallery")}
            icon={<TableStylePreview id={style} width={32} height={24} styles={store.getState().info?.tableStyles} />}
            size="large"
            menu={(close) => <StyleGalleryPanel store={store} table={table} close={close} />}
          />
        ),
      },
    ],
  };
}
