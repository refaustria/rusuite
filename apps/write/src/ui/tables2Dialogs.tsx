// P9-W5 dialogs: Table Properties (Table / Row / Column / Cell tabs, text
// wrapping and Table Positioning), Convert Text to Table, Convert Table to
// Text and the table Borders and Shading dialog (None / Box / All / Grid /
// Custom with a clickable preview). Lengths in cm like Word's German and
// metric defaults; the values go through `features/tables2.ts`.

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { ColorPicker, Dialog } from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { BorderSide } from "../generated/BorderSide";
import type { BorderStyle } from "../generated/BorderStyle";
import type { TableAnchor } from "../generated/TableAnchor";
import type { TableBorders } from "../generated/TableBorders";
import type { TablePosSpec } from "../generated/TablePosSpec";
import type { TextSeparator } from "../generated/TextSeparator";
import type { VAlign } from "../generated/VAlign";
import type { WriteCommand } from "../generated/WriteCommand";
import {
  ANCHORS, AROUND, columnsFor, guessSeparator, H_SPECS, penCss, rectBordersCommands, rowsFor, selectedTextBlocks, settingBorders, settingOf,
  separatorOf, tablePropsForm, tablePropsFormCommands, tableToTextCommand, textToTableCommand, V_SPECS,
  type BorderSetting, type SeparatorKind, type TablePropsForm,
} from "../features/tables2";
import { colWidthsOf, NO_BORDER, tableContext } from "../features/tables";
import type { WriteUi } from "../features/WriteFeatures";
import type { SyncController } from "../sync/SyncPlugin";
import { mergeBorders, tableStyleFor } from "../features/tableStyles";
import { colorCss } from "../sync/schema";
import { BORDER_STYLES, BORDER_WIDTHS_PT } from "./formatDialogs";
import { BUTTON, Buttons, cm, fromCm, INPUT, Row } from "./dialogs";
import { useT } from "../i18n";

type PropsTab = "table" | "row" | "column" | "cell";

function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: [T, string][]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="flex gap-1 border-b border-ui-border" role="tablist" aria-label={label}>
      {tabs.map(([k, name]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={`px-3 py-1 ${value === k ? "border-b-2 border-ui-focus font-medium" : ""}`} onClick={() => onChange(k)}>
          {name}
        </button>
      ))}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A length field in cm bound to a twips value; invalid text keeps the last value. */
function CmField({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (twips: number) => void }) {
  const [text, setText] = useState(cm(value));
  useEffect(() => setText(cm(value)), [value]);
  return (
    <Row label={label}>
      <input
        aria-label={label}
        className={INPUT}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const v = fromCm(e.target.value);
          if (v != null && v >= 0) onChange(v);
        }}
      />
    </Row>
  );
}

const specKey = (s: TablePosSpec | null, vertical: boolean) => (s == null ? "write.w5.pos.offset" : `write.w5.pos.${vertical ? "v" : "h"}.${s}`);

// ----- Table Properties ------------------------------------------------------------------------

export function TablePropertiesDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: TablePropsForm;
  onSubmit: (v: TablePropsForm) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<PropsTab>("table");
  const [v, setV] = useState(initial);
  const [positioning, setPositioning] = useState(false);
  useEffect(() => {
    if (!open) return;
    setV(initial);
    setPositioning(false);
  }, [open, initial]);
  const set = (p: Partial<TablePropsForm>) => setV((x) => ({ ...x, ...p }));
  const pos = v.position;
  const setPos = (p: Partial<TablePropsForm["position"]>) => set({ position: { ...pos, ...p } });
  const panel = (k: PropsTab, children: ReactNode) => (
    <div role="tabpanel" hidden={tab !== k} className="flex flex-col gap-2">
      {children}
    </div>
  );
  return (
    <Dialog open={open} title={t("write.tableProperties")} onClose={onClose}>
      <form
        className="flex w-[26rem] max-w-full flex-col gap-2 text-sm"
        data-testid="table-props-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(v);
        }}
      >
        <Tabs
          label={t("write.tableProperties")}
          value={tab}
          onChange={setTab}
          tabs={[["table", t("write.w5.tab.table")], ["row", t("write.w5.tab.row")], ["column", t("write.w5.tab.column")], ["cell", t("write.w5.tab.cell")]]}
        />
        {panel(
          "table",
          <>
            <p className="font-medium">{t("write.w5.size")}</p>
            <div className="flex items-center gap-2">
              <Check label={t("write.w5.preferredWidth")} checked={v.widthOn} onChange={(on) => set({ widthOn: on, width: on && !v.width ? 9026 : v.width })} />
              {v.widthUnit === "pct" ? (
                <input aria-label={t("write.w5.widthValue")} className={INPUT} type="number" min={0} max={600} disabled={!v.widthOn} value={v.width} onChange={(e) => set({ width: Number(e.target.value) || 0 })} />
              ) : (
                <CmLength label={t("write.w5.widthValue")} value={v.width} disabled={!v.widthOn} onChange={(w) => set({ width: w })} />
              )}
              <select aria-label={t("write.w5.measureIn")} className={INPUT} value={v.widthUnit} disabled={!v.widthOn} onChange={(e) => set({ widthUnit: e.target.value as "twips" | "pct", width: e.target.value === "pct" ? 100 : 9026 })}>
                <option value="twips">{t("write.w5.unit.cm")}</option>
                <option value="pct">{t("write.w5.unit.percent")}</option>
              </select>
            </div>
            <p className="font-medium">{t("fmt.alignment")}</p>
            <div role="radiogroup" aria-label={t("fmt.alignment")} className="flex gap-3">
              {(["left", "center", "right"] as const).map((a) => (
                <label key={a} className="flex items-center gap-1">
                  <input type="radio" name="tbl-align" checked={v.alignment === a} onChange={() => set({ alignment: a })} />
                  {t(a === "left" ? "write.left" : a === "center" ? "write.centered" : "write.right")}
                </label>
              ))}
            </div>
            <CmField label={t("write.indentFromLeft")} value={v.indent} disabled={v.alignment !== "left"} onChange={(i) => set({ indent: i })} />
            <p className="font-medium">{t("write.w5.textWrapping")}</p>
            <div role="radiogroup" aria-label={t("write.w5.textWrapping")} className="flex items-center gap-3">
              {(["none", "around"] as const).map((w) => (
                <label key={w} className="flex items-center gap-1">
                  <input type="radio" name="tbl-wrap" checked={v.wrap === w} onChange={() => set({ wrap: w })} />
                  {t(`write.w5.wrap.${w}`)}
                </label>
              ))}
              <button type="button" className={BUTTON} disabled={v.wrap !== "around"} onClick={() => setPositioning(!positioning)}>
                {t("write.w5.positioning")}
              </button>
            </div>
            {positioning && v.wrap === "around" && (
              <fieldset className="flex flex-col gap-2 rounded border border-ui-border p-2" data-testid="table-positioning">
                <legend className="px-1 text-xs text-ui-muted">{t("write.w5.tablePositioning")}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5">
                    {t("write.w5.horizontal")}
                    <select aria-label={t("write.w5.horizontal")} className={`${INPUT} w-full`} value={pos.xSpec ?? ""} onChange={(e) => setPos({ xSpec: (e.target.value || undefined) as TablePosSpec | undefined })}>
                      {H_SPECS.map((s) => (
                        <option key={s ?? ""} value={s ?? ""}>
                          {t(specKey(s, false))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    {t("write.w5.relativeTo")}
                    <select aria-label={t("write.w5.hRelativeTo")} className={`${INPUT} w-full`} value={pos.horzAnchor ?? "text"} onChange={(e) => setPos({ horzAnchor: e.target.value as TableAnchor })}>
                      {ANCHORS.map((a) => (
                        <option key={a} value={a}>
                          {t(`write.w5.anchor.${a}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pos.xSpec == null && <CmField label={t("write.w5.hPosition")} value={pos.x} onChange={(x) => setPos({ x })} />}
                  <span />
                  <label className="flex flex-col gap-0.5">
                    {t("write.w5.vertical")}
                    <select aria-label={t("write.w5.vertical")} className={`${INPUT} w-full`} value={pos.ySpec ?? ""} onChange={(e) => setPos({ ySpec: (e.target.value || undefined) as TablePosSpec | undefined })}>
                      {V_SPECS.map((s) => (
                        <option key={s ?? ""} value={s ?? ""}>
                          {t(specKey(s, true))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    {t("write.w5.relativeTo")}
                    <select aria-label={t("write.w5.vRelativeTo")} className={`${INPUT} w-full`} value={pos.vertAnchor ?? "margin"} onChange={(e) => setPos({ vertAnchor: e.target.value as TableAnchor })}>
                      {ANCHORS.map((a) => (
                        <option key={a} value={a}>
                          {t(`write.w5.anchor.${a === "text" ? "paragraph" : a}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pos.ySpec == null && <CmField label={t("write.w5.vPosition")} value={pos.y} onChange={(y) => setPos({ y })} />}
                </div>
                <p className="text-xs text-ui-muted">{t("write.w5.distanceFromText")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <CmField label={t("write.topCm")} value={pos.topFromText} onChange={(n) => setPos({ topFromText: n })} />
                  <CmField label={t("write.leftCm")} value={pos.leftFromText} onChange={(n) => setPos({ leftFromText: n })} />
                  <CmField label={t("write.bottomCm")} value={pos.bottomFromText} onChange={(n) => setPos({ bottomFromText: n })} />
                  <CmField label={t("write.rightCm")} value={pos.rightFromText} onChange={(n) => setPos({ rightFromText: n })} />
                </div>
                <Check label={t("write.w5.allowOverlap")} checked={pos.overlap !== false} onChange={(on) => setPos({ overlap: on })} />
              </fieldset>
            )}
            <Check label={t("write.autoResize")} checked={v.autoResize} onChange={(on) => set({ autoResize: on })} />
          </>,
        )}
        {panel(
          "row",
          <>
            <div className="flex items-center gap-2">
              <Check label={t("write.w5.specifyHeight")} checked={v.heightOn} onChange={(on) => set({ heightOn: on, height: on && !v.height ? 567 : v.height })} />
              <CmLength label={t("write.w5.heightValue")} value={v.height} disabled={!v.heightOn} onChange={(h) => set({ height: h })} />
              <select aria-label={t("write.w5.rowHeightIs")} className={INPUT} value={v.heightRule} disabled={!v.heightOn} onChange={(e) => set({ heightRule: e.target.value as TablePropsForm["heightRule"] })}>
                <option value="atLeast">{t("write.w5.atLeast")}</option>
                <option value="exact">{t("write.w5.exactly")}</option>
              </select>
            </div>
            <p className="font-medium">{t("write.w5.options")}</p>
            <Check label={t("write.allowRowBreak")} checked={!v.cantSplit} onChange={(on) => set({ cantSplit: !on })} />
            <Check label={t("write.repeatHeaderRow")} checked={v.header} onChange={(on) => set({ header: on })} />
          </>,
        )}
        {panel(
          "column",
          <div className="flex items-center gap-2">
            <Check label={t("write.w5.preferredWidth")} checked={v.colWidthOn} onChange={(on) => set({ colWidthOn: on })} />
            <CmLength label={t("write.w5.columnWidth")} value={v.colWidth} disabled={!v.colWidthOn} onChange={(w) => set({ colWidth: w })} />
          </div>,
        )}
        {panel(
          "cell",
          <>
            <p className="font-medium">{t("write.w5.verticalAlignment")}</p>
            <div role="radiogroup" aria-label={t("write.w5.verticalAlignment")} className="flex gap-3">
              {(["top", "center", "bottom"] as VAlign[]).map((a) => (
                <label key={a} className="flex items-center gap-1">
                  <input type="radio" name="cell-valign" checked={v.vAlign === a} onChange={() => set({ vAlign: a })} />
                  {t(`write.w5.valign.${a}`)}
                </label>
              ))}
            </div>
          </>,
        )}
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** An inline cm input (no row label). */
function CmLength({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (twips: number) => void }) {
  const [text, setText] = useState(cm(value));
  useEffect(() => setText(cm(value)), [value]);
  return (
    <input
      aria-label={label}
      className={INPUT}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const v = fromCm(e.target.value);
        if (v != null && v >= 0) onChange(v);
      }}
    />
  );
}

// ----- Convert Text to Table / Table to Text --------------------------------------------------

function SeparatorChoice({ kind, other, onKind, onOther, withParagraphs = true }: {
  kind: SeparatorKind;
  other: string;
  onKind: (k: SeparatorKind) => void;
  onOther: (s: string) => void;
  withParagraphs?: boolean;
}) {
  const t = useT();
  const kinds: SeparatorKind[] = withParagraphs ? ["paragraph", "comma", "tab", "other"] : ["comma", "tab", "other"];
  return (
    <fieldset className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label={t("write.w5.separateAt")}>
      <legend className="mb-1 font-medium">{t("write.w5.separateAt")}</legend>
      {kinds.map((k) => (
        <label key={k} className="flex items-center gap-1">
          <input type="radio" name="sep" checked={kind === k} onChange={() => onKind(k)} />
          {t(`write.w5.sep.${k}`)}
        </label>
      ))}
      <input aria-label={t("write.w5.sep.otherChar")} className={`${INPUT} w-10`} maxLength={1} value={other} disabled={kind !== "other"} onChange={(e) => onOther(e.target.value)} />
    </fieldset>
  );
}

export function TextToTableDialog({ open, initialKind, columnsFor, rowsFor, onSubmit, onClose }: {
  open: boolean;
  initialKind: SeparatorKind;
  columnsFor: (sep: TextSeparator) => number;
  rowsFor: (sep: TextSeparator, cols: number) => number;
  onSubmit: (sep: TextSeparator, cols: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<SeparatorKind>(initialKind);
  const [other, setOther] = useState("-");
  const [cols, setCols] = useState("1");
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setCols(String(columnsFor(separatorOf(initialKind, "-"))));
  }, [open, initialKind, columnsFor]);
  const sep = separatorOf(kind, other);
  const n = Math.max(1, Math.min(63, Math.round(Number(cols) || 1)));
  return (
    <Dialog open={open} title={t("write.w5.textToTable")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        data-testid="text-to-table-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(sep, n);
        }}
      >
        <p className="font-medium">{t("write.w5.tableSize")}</p>
        <Row label={t("write.numColumns")}>
          <input aria-label={t("write.numColumns")} type="number" min={1} max={63} className={INPUT} value={cols} onChange={(e) => setCols(e.target.value)} />
        </Row>
        <Row label={t("write.numRows")}>
          <span data-testid="text-to-table-rows">{rowsFor(sep, n)}</span>
        </Row>
        <SeparatorChoice
          kind={kind}
          other={other}
          onKind={(k) => {
            setKind(k);
            setCols(String(columnsFor(separatorOf(k, other))));
          }}
          onOther={(s) => {
            setOther(s);
            setCols(String(columnsFor(separatorOf("other", s))));
          }}
        />
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

export function TableToTextDialog({ open, onSubmit, onClose }: { open: boolean; onSubmit: (sep: TextSeparator) => void; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<SeparatorKind>("tab");
  const [other, setOther] = useState("-");
  useEffect(() => {
    if (open) setKind("tab");
  }, [open]);
  return (
    <Dialog open={open} title={t("write.w5.tableToText")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        data-testid="table-to-text-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(separatorOf(kind, other));
        }}
      >
        <SeparatorChoice kind={kind} other={other} onKind={setKind} onOther={setOther} />
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- Borders and Shading (tables) ----------------------------------------------------------

type Line = keyof TableBorders;
const LINES: Line[] = ["top", "insideH", "bottom", "left", "insideV", "right"];
const isOn = (s: BorderSide | null | undefined) => !!s && s.style !== "none";

export interface TableBordersValues {
  borders: TableBorders;
  shading: Color | null;
  /** Apply to: the selected cells or the whole table. */
  wholeTable: boolean;
}

export function TableBordersDialog({ open, initial, cells, onSubmit, onClose }: {
  open: boolean;
  initial: TableBordersValues;
  /** Several cells selected (the preview shows inside lines). */
  cells: number;
  onSubmit: (v: TableBordersValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"borders" | "shading">("borders");
  const [style, setStyle] = useState<BorderStyle>("single");
  const [width, setWidth] = useState(0.5);
  const [color, setColor] = useState<Color>({ kind: "auto" });
  const [b, setB] = useState<TableBorders>(initial.borders);
  const [shading, setShading] = useState<Color | null>(initial.shading);
  const [whole, setWhole] = useState(initial.wholeTable);
  useEffect(() => {
    if (!open) return;
    setTab("borders");
    setB(initial.borders);
    setShading(initial.shading);
    setWhole(initial.wholeTable);
    const first = LINES.map((k) => initial.borders[k]).find(isOn);
    setStyle(first?.style && first.style !== "none" ? first.style : "single");
    setWidth(first ? Math.round((first.width / 20) * 100) / 100 : 0.5);
    setColor(first?.color ?? { kind: "auto" });
  }, [open, initial]);
  const pen: BorderSide = { style, width: Math.round(width * 20), color };
  const setting: BorderSetting = settingOf(b, pen);
  const inner = whole || cells > 1;
  const toggle = (k: Line) => setB({ ...b, [k]: isOn(b[k]) ? NO_BORDER : pen });
  const line = (k: Line) => (isOn(b[k]) ? penCss(b[k]) : "1px dashed #c8c8c8");
  const stroke = colorCss(color.kind === "auto" ? null : color) ?? "#000";
  return (
    <Dialog open={open} title={t("write.bordersShading")} onClose={onClose}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-2 text-sm"
        data-testid="table-borders-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ borders: b, shading, wholeTable: whole });
        }}
      >
        <Tabs label={t("write.bordersShading")} value={tab} onChange={setTab} tabs={[["borders", t("write.borders")], ["shading", t("write.shading")]]} />
        <div role="tabpanel" hidden={tab !== "borders"} className="flex gap-4">
          <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("write.setting")}>
            <p className="font-medium">{t("write.setting")}</p>
            {(["none", "box", "all", "grid", "custom"] as BorderSetting[]).map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="tbl-setting"
                  checked={setting === s}
                  onChange={() => {
                    if (s !== "custom") setB(settingBorders(s, pen));
                  }}
                />
                {t(`write.w5.setting.${s}`)}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Row label={t("write.borderStyle")}>
              <select aria-label={t("write.borderStyle")} className={INPUT} value={style} onChange={(e) => setStyle(e.target.value as BorderStyle)}>
                {BORDER_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {t(`write.borderStyle.${s}`)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t("write.borderColor")}>
              <ColorPicker label={t("write.borderColor")} kind="text" value={color} onSelect={(c) => setColor(c ?? { kind: "auto" })} />
            </Row>
            <Row label={t("write.borderWidth")}>
              <select aria-label={t("write.borderWidth")} className={INPUT} value={String(width)} onChange={(e) => setWidth(Number(e.target.value))}>
                {BORDER_WIDTHS_PT.map((w) => (
                  <option key={w} value={String(w)}>
                    {t("write.ptValue", { n: w })}
                  </option>
                ))}
              </select>
            </Row>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("write.preview")}</p>
            <p className="max-w-32 text-xs text-ui-muted">{t("write.w5.previewHint")}</p>
            <div className="relative h-28 w-28" data-testid="borders-preview" style={{ color: stroke }}>
              <div className="absolute inset-3" style={{ borderTop: line("top"), borderBottom: line("bottom"), borderLeft: line("left"), borderRight: line("right") }} />
              {inner && <div className="absolute inset-x-3 top-1/2" style={{ borderTop: line("insideH") }} />}
              {inner && <div className="absolute inset-y-3 left-1/2" style={{ borderLeft: line("insideV") }} />}
              {(inner ? LINES : (["top", "bottom", "left", "right"] as Line[])).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={t(`write.w5.line.${k}`)}
                  aria-pressed={isOn(b[k])}
                  className={`absolute bg-transparent ${k === "top" ? "inset-x-3 top-1 h-4" : k === "bottom" ? "inset-x-3 bottom-1 h-4" : k === "left" ? "inset-y-3 left-1 w-4" : k === "right" ? "inset-y-3 right-1 w-4" : k === "insideH" ? "inset-x-3 top-[calc(50%-8px)] h-4" : "inset-y-3 left-[calc(50%-8px)] w-4"}`}
                  onClick={() => toggle(k)}
                />
              ))}
            </div>
            <Row label={t("write.w5.applyTo")}>
              <select aria-label={t("write.w5.applyTo")} className={INPUT} value={whole ? "table" : "cell"} onChange={(e) => setWhole(e.target.value === "table")}>
                <option value="cell">{t("write.w5.applyCell")}</option>
                <option value="table">{t("write.w5.applyTable")}</option>
              </select>
            </Row>
          </div>
        </div>
        <div role="tabpanel" hidden={tab !== "shading"} className="flex items-center gap-2">
          <span>{t("write.w5.fill")}</span>
          <ColorPicker label={t("write.w5.fill")} kind="fill" value={shading ?? undefined} onSelect={(c) => setShading(c)} />
          <button type="button" className={BUTTON} onClick={() => setShading(null)}>
            {t("write.w5.noColor")}
          </button>
        </div>
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- wiring ------------------------------------------------------------------------------

/** The P9-W5 dialogs the UI store asks for (Table Properties, text ↔ table, Borders and Shading of tables). */
export function Tables2Dialogs({ ui, ctl, editor }: { ui: WriteUi; ctl: SyncController; editor: Editor | null }) {
  const { dialog } = useSyncExternalStore(ui.subscribe, ui.getState);
  const close = () => {
    ui.openDialog(null);
    editor?.commands.focus();
  };
  const table = useMemo(
    () => (editor && (dialog === "tableProps" || dialog === "tableToText" || dialog === "tableBorders") ? tableContext(editor.state) : null),
    [editor, dialog],
  );
  const content = ctl.page ? ctl.page.width - ctl.page.margins.left - ctl.page.margins.right : 9026;
  const widths = useMemo(() => (table ? colWidthsOf(table, content) : []), [table, content]);
  const propsInitial = useMemo(() => (table ? tablePropsForm(table, widths) : null), [table, widths]);
  const blocks = useMemo(() => (editor && dialog === "textToTable" ? selectedTextBlocks(editor.state) : []), [editor, dialog]);
  const texts = useMemo(() => blocks.map((b) => b.textContent), [blocks]);
  const bordersInitial = useMemo<TableBordersValues>(() => {
    if (!table) return { borders: {}, shading: null, wholeTable: false };
    const whole = table.cells.length <= 1;
    const cellNode = table.node.nodeAt(table.map.map[table.cell.top * table.map.width + table.cell.left]!);
    const own = (cellNode?.attrs.extra as { borders?: TableBorders } | null)?.borders;
    // The whole table: the borders in effect (its style's, then its own), as Word's preview shows them.
    const style = tableStyleFor(ctl.styles?.styles ?? [], table.props.style);
    const effective = mergeBorders(style?.table?.borders, table.props.borders);
    return { borders: (whole ? effective : own) ?? {}, shading: (cellNode?.attrs.shading as Color | null) ?? null, wholeTable: whole };
  }, [table, ctl]);
  const run = (cmds: WriteCommand[]) => {
    if (cmds.length) void ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });
  };
  return (
    <>
      <TablePropertiesDialog
        open={dialog === "tableProps" && !!table && !!propsInitial}
        initial={propsInitial ?? EMPTY_FORM}
        onClose={close}
        onSubmit={(v) => {
          if (table && propsInitial) run(tablePropsFormCommands(table, propsInitial, v, widths));
          close();
        }}
      />
      <TextToTableDialog
        open={dialog === "textToTable" && blocks.length > 0}
        initialKind={guessSeparator(texts)}
        columnsFor={(sep) => columnsFor(texts, sep)}
        rowsFor={(sep, n) => rowsFor(texts, sep, n)}
        onClose={close}
        onSubmit={(sep, cols) => {
          const cmd = textToTableCommand(blocks, sep, cols);
          if (cmd) void ctl.run(cmd);
          close();
        }}
      />
      <TableToTextDialog
        open={dialog === "tableToText" && !!table}
        onClose={close}
        onSubmit={(sep) => {
          if (table) void ctl.run(tableToTextCommand(table, sep));
          close();
        }}
      />
      <TableBordersDialog
        open={dialog === "tableBorders" && !!table}
        initial={bordersInitial}
        cells={table?.cells.length ?? 1}
        onClose={close}
        onSubmit={(v) => {
          if (table) {
            const cmds = rectBordersCommands(table, v.borders, v.wholeTable);
            if (v.shading !== bordersInitial.shading) cmds.push({ type: "setCellProps", cells: table.cells, patch: { shading: v.shading ?? { kind: "auto" } } });
            run(cmds);
          }
          close();
        }}
      />
    </>
  );
}

const EMPTY_FORM: TablePropsForm = {
  alignment: "left", indent: 0, widthOn: false, widthUnit: "twips", width: 0, wrap: "none", position: AROUND, autoResize: true,
  heightOn: false, height: 0, heightRule: "atLeast", cantSplit: false, header: false, colWidthOn: false, colWidth: 0, vAlign: "top",
};
