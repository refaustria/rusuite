// Custom table styles (P9-C2): the New / Modify Table Style dialog (name,
// the table elements with fill / font / border and stripe size, a
// preview, "Set as default table style for this document") and the
// helpers that turn the dialog's result into the `setTableStyles`
// command (new, modified with a rename, duplicated, deleted, default).

import { useMemo, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { BorderStyle } from "../generated/BorderStyle";
import type { CustomTableStyle } from "../generated/CustomTableStyle";
import type { DxfStyle } from "../generated/DxfStyle";
import type { Table } from "../generated/Table";
import type { TableStyleElementType } from "../generated/TableStyleElementType";
import type { TableStyles } from "../generated/TableStyles";
import type { StyleRename } from "../generated/StyleRename";
import { colorCss } from "../grid/style";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import { customLook, customStyle, freshStyleName, isStripe, TABLE_STYLE_ELEMENTS, tableStyle } from "./styles";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm";

/** Whether `name` is a built-in style name (`TableStyleMedium2`, `PivotStyleLight16`, …). */
export function isBuiltinStyleName(name: string): boolean {
  return /^(TableStyle(Light|Medium|Dark)|PivotStyle(Light|Medium|Dark))[1-9]\d*$/.test(name);
}

/** Why a style name cannot be used (`null`: fine). `except`: the style being modified. */
export function styleNameProblem(styles: TableStyles | undefined, name: string, except?: string): "empty" | "taken" | null {
  const n = name.trim();
  if (!n) return "empty";
  if (isBuiltinStyleName(n)) return "taken";
  const other = customStyle(styles, n);
  if (other && other.name.toLowerCase() !== except?.toLowerCase()) return "taken";
  return null;
}

/** The style list after saving `style` (new, or replacing `original`), with the default flag. */
export function saveStyle(styles: TableStyles | undefined, style: CustomTableStyle, original: string | null, makeDefault: boolean): { styles: TableStyles; renamed: StyleRename[] } {
  const list = [...(styles?.custom ?? [])];
  const at = original ? list.findIndex((s) => s.name.toLowerCase() === original.toLowerCase()) : -1;
  if (at >= 0) list[at] = style;
  else list.push(style);
  const renamed = original && at >= 0 && original !== style.name ? [{ from: original, to: style.name }] : [];
  let def = styles?.defaultStyle ?? null;
  if (renamed.length && def?.toLowerCase() === original!.toLowerCase()) def = style.name;
  if (makeDefault) def = style.name;
  else if (def?.toLowerCase() === style.name.toLowerCase()) def = null;
  return { styles: { custom: list, ...(def ? { defaultStyle: def } : {}) }, renamed };
}

/** The style list without `name` (Delete); a deleted default falls back to `TableStyleMedium2`. */
export function deleteStyle(styles: TableStyles | undefined, name: string): TableStyles {
  const custom = (styles?.custom ?? []).filter((s) => s.name.toLowerCase() !== name.toLowerCase());
  const def = styles?.defaultStyle && styles.defaultStyle.toLowerCase() !== name.toLowerCase() ? styles.defaultStyle : undefined;
  return { custom, ...(def ? { defaultStyle: def } : {}) };
}

/** Set As Default: any style (built-in or custom) becomes the default of new tables. */
export function withDefault(styles: TableStyles | undefined, name: string): TableStyles {
  const custom = styles?.custom ?? [];
  return name === "TableStyleMedium2" ? { custom } : { custom, defaultStyle: name };
}

const rgb = (hex: string) => ({ kind: "rgb" as const, value: hex.replace("#", "").toUpperCase() });

/** A built-in style as editable elements (Duplicate of a built-in style). */
export function builtinAsCustom(id: string, name: string): CustomTableStyle {
  const def = tableStyle(id);
  if (!def) return { name, elements: [] };
  const line = { style: "thin" as BorderStyle, color: rgb(def.line) };
  const elements: CustomTableStyle["elements"] = [
    { type: "wholeTable", dxf: { ...(def.bodyFill ? { fill: rgb(def.bodyFill) } : {}), ...(def.bodyColor !== "#000000" ? { fontColor: rgb(def.bodyColor) } : {}), borders: { top: line, bottom: line } } },
    { type: "headerRow", dxf: { bold: true, fontColor: rgb(def.headerColor), ...(def.headerFill ? { fill: rgb(def.headerFill) } : {}), borders: { bottom: line } } },
    { type: "totalRow", dxf: { bold: true, ...(def.totalsFill ? { fill: rgb(def.totalsFill) } : {}), borders: { top: { style: "double", color: rgb(def.totalsLine) } } } },
    { type: "firstColumn", dxf: { bold: true, ...(def.edgeFill ? { fill: rgb(def.edgeFill) } : {}) } },
    { type: "lastColumn", dxf: { bold: true, ...(def.edgeFill ? { fill: rgb(def.edgeFill) } : {}) } },
    { type: "firstRowStripe", dxf: { fill: rgb(def.band) } },
    { type: "firstColumnStripe", dxf: { fill: rgb(def.band) } },
  ];
  return { name, elements };
}

const BORDERS: BorderStyle[] = ["thin", "medium", "thick", "double", "dashed", "dotted"];

/** The preview table: header, four data rows, a totals row, four columns. */
const PREVIEW: Table = {
  id: 0, name: "Preview", r0: 0, c0: 0, r1: 5, c1: 3, headerRow: true, totalsRow: true, columns: [], style: "",
  look: { firstColumn: true, lastColumn: true, bandedRows: true, bandedColumns: true },
};

function StylePreview({ style }: { style: CustomTableStyle }) {
  const cw = 36, rh = 14;
  const cells = [];
  for (let r = PREVIEW.r0; r <= PREVIEW.r1; r++) {
    for (let c = PREVIEW.c0; c <= PREVIEW.c1; c++) {
      const l = customLook(style, PREVIEW, r, c);
      const x = c * cw, y = r * rh;
      cells.push(<rect key={`f${r}:${c}`} x={x} y={y} width={cw} height={rh} fill={l.fill ?? "#FFFFFF"} />);
      cells.push(<rect key={`t${r}:${c}`} x={x + 6} y={y + rh / 2 - 1} width={cw - 14} height={2} fill={l.color ?? "#595959"} opacity={l.bold ? 1 : 0.6} />);
      if (l.top) cells.push(<line key={`a${r}:${c}`} x1={x} y1={y + 0.5} x2={x + cw} y2={y + 0.5} stroke={l.top} />);
      if (l.bottom) cells.push(<line key={`b${r}:${c}`} x1={x} y1={y + rh - 0.5} x2={x + cw} y2={y + rh - 0.5} stroke={l.bottom} />);
      if (l.left) cells.push(<line key={`l${r}:${c}`} x1={x + 0.5} y1={y} x2={x + 0.5} y2={y + rh} stroke={l.left} />);
      if (l.right) cells.push(<line key={`r${r}:${c}`} x1={x + cw - 0.5} y1={y} x2={x + cw - 0.5} y2={y + rh} stroke={l.right} />);
    }
  }
  const w = cw * 4, h = rh * 6;
  return (
    <svg data-testid="table-style-preview" width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="border border-ui-border">
      {cells}
    </svg>
  );
}

/** A colour field: a swatch input plus "none". */
function ColorField({ label, value, onChange, noneLabel }: { label: string; value: DxfStyle["fill"]; onChange: (v: DxfStyle["fill"]) => void; noneLabel: string }) {
  const css = colorCss(value) ?? "#ffffff";
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-xs">{label}</span>
      <input type="color" aria-label={label} value={css.toLowerCase()} onChange={(e) => onChange(rgb(e.target.value))} className="h-7 w-10" />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? undefined : rgb(css))} />
        {noneLabel}
      </label>
    </div>
  );
}

/** New Table Style / Modify Table Style. `original`: the custom style being modified. */
export function TableStyleDialog({ store, mode, name, tableId }: { store: CalcStore; mode: "new" | "modify" | "duplicate"; name?: string; tableId?: number }) {
  const t = useT();
  const styles = store.getState().info?.tableStyles;
  const initial = useMemo<CustomTableStyle>(() => {
    const existing = name ? customStyle(styles, name) : undefined;
    if (mode === "modify" && existing) return structuredClone(existing);
    if (mode === "duplicate" && name) {
      const copy = t("calc.tableStyle.copyName", { name: existing?.name ?? name });
      return existing ? { ...structuredClone(existing), name: copy } : builtinAsCustom(name, copy);
    }
    return { name: freshStyleName(styles, t("calc.tableStyle.baseName")), elements: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const original = mode === "modify" ? (name ?? null) : null;
  const [style, setStyle] = useState<CustomTableStyle>(initial);
  const [kind, setKind] = useState<TableStyleElementType>("wholeTable");
  const [makeDefault, setMakeDefault] = useState(!!original && styles?.defaultStyle?.toLowerCase() === original.toLowerCase());
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const el = style.elements.find((e) => e.type === kind);
  const dxf: DxfStyle = el?.dxf ?? {};
  const setEl = (patch: Partial<{ dxf: DxfStyle; size: number }>) => {
    const next = { type: kind, size: el?.size, dxf, ...patch };
    const elements = style.elements.filter((e) => e.type !== kind);
    const empty = Object.keys(next.dxf).length === 0 && (next.size ?? 1) === 1;
    if (!empty) elements.push({ type: kind, dxf: next.dxf, ...(next.size && next.size !== 1 ? { size: next.size } : {}) });
    setStyle({ ...style, elements });
  };
  const setDxf = (patch: Partial<DxfStyle>) => {
    const d: DxfStyle = { ...dxf, ...patch };
    for (const k of Object.keys(d) as (keyof DxfStyle)[]) if (d[k] === undefined) delete d[k];
    setEl({ dxf: d });
  };
  const border = dxf.borders?.top ?? dxf.borders?.bottom ?? dxf.borders?.left ?? dxf.borders?.right;
  const setBorder = (s: BorderStyle | "", color = border?.color ?? rgb("#000000")) => {
    setDxf({ borders: s ? { top: { style: s, color }, bottom: { style: s, color }, left: { style: s, color }, right: { style: s, color } } : undefined });
  };
  const problem = styleNameProblem(styles, style.name, original ?? undefined);
  const formatted = new Set(style.elements.map((e) => e.type));
  return (
    <Dialog open title={t(mode === "modify" ? "calc.tableStyle.modifyTitle" : "calc.tableStyle.newTitle")} onClose={close}>
      <form
        className="flex w-[34rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return;
          const saved = saveStyle(styles, { ...style, name: style.name.trim() }, original, makeDefault);
          close();
          void store.tables.setStyles(saved.styles, saved.renamed).then(() => {
            if (tableId !== undefined && mode !== "modify") void store.tables.setStyle(tableId, style.name.trim());
          });
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.tableStyle.name")}</span>
          <input className={FIELD} aria-label={t("calc.tableStyle.name")} value={style.name} onChange={(e) => setStyle({ ...style, name: e.target.value })} />
          {problem === "taken" && (
            <span role="alert" className="text-xs text-red-700">
              {t("calc.tableStyle.taken")}
            </span>
          )}
        </label>
        <div className="flex gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs">{t("calc.tableStyle.element")}</span>
            <div role="listbox" aria-label={t("calc.tableStyle.element")} className="flex h-56 w-44 flex-col overflow-auto rounded border border-ui-border">
              {TABLE_STYLE_ELEMENTS.map((k) => (
                <div
                  key={k}
                  role="option"
                  tabIndex={k === kind ? 0 : -1}
                  aria-selected={k === kind}
                  className={`cursor-default px-2 py-0.5 text-xs ${k === kind ? "bg-ui-active" : "hover:bg-ui-hover"} ${formatted.has(k) ? "font-semibold" : ""}`}
                  onClick={() => setKind(k)}
                  onKeyDown={(e) => {
                    const i = TABLE_STYLE_ELEMENTS.indexOf(kind);
                    if (e.key === "ArrowDown") setKind(TABLE_STYLE_ELEMENTS[Math.min(i + 1, TABLE_STYLE_ELEMENTS.length - 1)]!);
                    if (e.key === "ArrowUp") setKind(TABLE_STYLE_ELEMENTS[Math.max(i - 1, 0)]!);
                  }}
                >
                  {t(`calc.tableStyle.el.${k}`)}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2" data-testid="table-style-element">
            <span className="text-xs font-medium">{t("calc.tableStyle.format", { element: t(`calc.tableStyle.el.${kind}`) })}</span>
            <ColorField label={t("calc.tableStyle.fill")} value={dxf.fill} noneLabel={t("calc.tableStyle.noColor")} onChange={(v) => setDxf({ fill: v })} />
            <ColorField label={t("calc.tableStyle.fontColor")} value={dxf.fontColor} noneLabel={t("calc.tableStyle.automatic")} onChange={(v) => setDxf({ fontColor: v })} />
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={!!dxf.bold} onChange={(e) => setDxf({ bold: e.target.checked ? true : undefined })} />
                {t("calc.tableStyle.bold")}
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={!!dxf.italic} onChange={(e) => setDxf({ italic: e.target.checked ? true : undefined })} />
                {t("calc.tableStyle.italic")}
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-24">{t("calc.tableStyle.border")}</span>
              <select className={FIELD} aria-label={t("calc.tableStyle.border")} value={border?.style ?? ""} onChange={(e) => setBorder(e.target.value as BorderStyle | "")}>
                <option value="">{t("calc.tableStyle.noBorder")}</option>
                {BORDERS.map((b) => (
                  <option key={b} value={b}>
                    {t(`calc.tableStyle.borderStyle.${b}`)}
                  </option>
                ))}
              </select>
              <input
                type="color"
                aria-label={t("calc.tableStyle.borderColor")}
                disabled={!border}
                value={(colorCss(border?.color) ?? "#000000").toLowerCase()}
                onChange={(e) => border && setBorder(border.style, rgb(e.target.value))}
                className="h-7 w-10"
              />
            </div>
            {isStripe(kind) && (
              <label className="flex items-center gap-2 text-xs">
                <span className="w-24">{t("calc.tableStyle.stripeSize")}</span>
                <select className={FIELD} aria-label={t("calc.tableStyle.stripeSize")} value={el?.size ?? 1} onChange={(e) => setEl({ size: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className={`${BTN} self-start`} disabled={!el} onClick={() => setStyle({ ...style, elements: style.elements.filter((e) => e.type !== kind) })}>
              {t("calc.tableStyle.clear")}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs">{t("calc.tableStyle.preview")}</span>
            <StylePreview style={style} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          {t("calc.tableStyle.setDefault")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="submit" className={BTN} disabled={!!problem}>
            {t("common.ok")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
