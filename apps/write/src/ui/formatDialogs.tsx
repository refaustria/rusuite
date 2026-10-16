// P8-17 dialogs: Split Cells, Cell Margins, Table Properties (Table
// Layout tab), Borders and Shading and Tabs (Home › Paragraph). Lengths in
// cm, border widths in points like Word.

import { useEffect, useState } from "react";
import { ColorPicker, Dialog } from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { BorderSide } from "../generated/BorderSide";
import type { BorderStyle } from "../generated/BorderStyle";
import type { CellMargins } from "../generated/CellMargins";
import type { ParagraphBorders } from "../generated/ParagraphBorders";
import type { TabKind } from "../generated/TabKind";
import type { TabLeader } from "../generated/TabLeader";
import type { TabStop } from "../generated/TabStop";
import { NO_PARA_BORDER, type BordersShadingValues } from "../features/paragraphFormat";
import type { TablePropsValues } from "../features/tables";
import { DEFAULT_TAB_TWIPS } from "../features/tabStops";
import { colorCss } from "../sync/schema";
import { BUTTON, Buttons, cm, fromCm, INPUT, Row } from "./dialogs";
import { useT } from "../i18n";

// ----- split cells --------------------------------------------------------------------

export function SplitCellsDialog({ open, rowsValid, onSubmit, onClose }: {
  open: boolean;
  /** Whether a number of rows divides the cell (Word allows only divisors of a merged cell's rows). */
  rowsValid: (rows: number) => boolean;
  onSubmit: (rows: number, cols: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [cols, setCols] = useState("2");
  const [rows, setRows] = useState("1");
  useEffect(() => {
    if (open) {
      setCols("2");
      setRows("1");
    }
  }, [open]);
  const c = Number(cols);
  const r = Number(rows);
  const valid = Number.isInteger(c) && Number.isInteger(r) && c >= 1 && r >= 1 && c <= 63 && r <= 99 && (c > 1 || r > 1) && rowsValid(r);
  return (
    <Dialog open={open} title={t("write.splitCells")} onClose={onClose}>
      <form
        className="flex w-64 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(r, c);
        }}
      >
        <Row label={t("write.numColumns")}>
          <input aria-label={t("write.numColumns")} type="number" min={1} className={INPUT} value={cols} onChange={(e) => setCols(e.target.value)} />
        </Row>
        <Row label={t("write.numRows")}>
          <input aria-label={t("write.numRows")} type="number" min={1} className={INPUT} value={rows} onChange={(e) => setRows(e.target.value)} />
        </Row>
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

// ----- cell margins -------------------------------------------------------------------

/** Word's default cell margins (Normal Table): 0 top/bottom, 0.19 cm left/right. */
export const DEFAULT_CELL_MARGINS: Required<{ [K in keyof CellMargins]: number }> = { top: 0, left: 108, bottom: 0, right: 108 };

export function CellMarginsDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: CellMargins | null | undefined;
  onSubmit: (m: CellMargins) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [m, setM] = useState({ top: "", bottom: "", left: "", right: "" });
  useEffect(() => {
    if (!open) return;
    const v = (k: keyof CellMargins) => cm(initial?.[k] ?? DEFAULT_CELL_MARGINS[k]);
    setM({ top: v("top"), bottom: v("bottom"), left: v("left"), right: v("right") });
  }, [open, initial]);
  const parsed = { top: fromCm(m.top), bottom: fromCm(m.bottom), left: fromCm(m.left), right: fromCm(m.right) };
  const valid = Object.values(parsed).every((v) => v != null && v >= 0);
  const field = (k: keyof typeof m, label: string) => (
    <Row label={label}>
      <input aria-label={label} className={INPUT} value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
    </Row>
  );
  return (
    <Dialog open={open} title={t("write.cellMargins")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ top: parsed.top!, bottom: parsed.bottom!, left: parsed.left!, right: parsed.right! });
        }}
      >
        <p className="text-xs text-ui-muted">{t("write.defaultCellMargins")}</p>
        {field("top", t("write.topCm"))}
        {field("bottom", t("write.bottomCm"))}
        {field("left", t("write.leftCm"))}
        {field("right", t("write.rightCm"))}
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

// ----- table properties ---------------------------------------------------------------

export function TablePropsDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: TablePropsValues;
  onSubmit: (v: TablePropsValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState(initial);
  const [indent, setIndent] = useState("0");
  useEffect(() => {
    if (!open) return;
    setV(initial);
    setIndent(cm(initial.indent));
  }, [open, initial]);
  const ind = fromCm(indent);
  return (
    <Dialog open={open} title={t("write.tableProperties")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ind != null) onSubmit({ ...v, indent: v.alignment === "left" ? ind : initial.indent });
        }}
      >
        <p className="font-medium">{t("write.table")}</p>
        <div role="radiogroup" aria-label={t("fmt.alignment")} className="flex gap-3">
          {(["left", "center", "right"] as const).map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input type="radio" name="tbl-align" checked={v.alignment === a} onChange={() => setV({ ...v, alignment: a })} />
              {t(a === "left" ? "write.left" : a === "center" ? "write.centered" : "write.right")}
            </label>
          ))}
        </div>
        <Row label={t("write.indentFromLeft")}>
          <input aria-label={t("write.indentFromLeft")} className={INPUT} value={indent} disabled={v.alignment !== "left"} onChange={(e) => setIndent(e.target.value)} />
        </Row>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.layout === "autofit"} onChange={(e) => setV({ ...v, layout: e.target.checked ? "autofit" : "fixed" })} />
          {t("write.autoResize")}
        </label>
        <p className="font-medium">{t("write.rowOptions")}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!v.cantSplit} onChange={(e) => setV({ ...v, cantSplit: !e.target.checked })} />
          {t("write.allowRowBreak")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.header} onChange={(e) => setV({ ...v, header: e.target.checked })} />
          {t("write.repeatHeaderRow")}
        </label>
        <Buttons onClose={onClose} disabled={ind == null} />
      </form>
    </Dialog>
  );
}

// ----- borders and shading ------------------------------------------------------------

/** Border widths offered (points → twips: 1 pt = 20). */
export const BORDER_WIDTHS_PT = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
export const BORDER_STYLES: BorderStyle[] = ["single", "double", "dashed", "dotted", "thick"];
const SIDES = ["top", "bottom", "left", "right", "between"] as const;
type Side = (typeof SIDES)[number];

const isOn = (s: BorderSide | null | undefined) => !!s && s.style !== "none";

export function BordersShadingDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: BordersShadingValues;
  onSubmit: (v: BordersShadingValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [style, setStyle] = useState<BorderStyle>("single");
  const [width, setWidth] = useState(0.5);
  const [color, setColor] = useState<Color>({ kind: "auto" });
  const [sides, setSides] = useState<Record<Side, boolean>>({ top: false, bottom: false, left: false, right: false, between: false });
  const [shading, setShading] = useState<Color | null>(null);
  useEffect(() => {
    if (!open) return;
    const b = initial.borders;
    const first = SIDES.map((k) => b[k]).find(isOn);
    setStyle(first?.style ?? "single");
    setWidth(first ? Math.round((first.width / 20) * 100) / 100 : 0.5);
    setColor(first?.color ?? { kind: "auto" });
    setSides(Object.fromEntries(SIDES.map((k) => [k, isOn(b[k])])) as Record<Side, boolean>);
    setShading(initial.shading);
  }, [open, initial]);
  const side: BorderSide = { style, width: Math.round(width * 20), color, space: 1 };
  const setting = (s: "none" | "box" | "all") =>
    setSides({ top: s !== "none", bottom: s !== "none", left: s !== "none", right: s !== "none", between: s === "all" });
  const css = (k: Side) => (sides[k] ? `${style === "double" ? 3 : Math.max(1, Math.round(width * 1.33))}px ${style === "double" ? "double" : style === "dashed" ? "dashed" : style === "dotted" ? "dotted" : "solid"} ${colorCss(color.kind === "auto" ? null : color) ?? "#000"}` : "1px dashed #ccc");
  return (
    <Dialog open={open} title={t("write.bordersShading")} onClose={onClose}>
      <form
        className="flex w-[26rem] flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const borders: ParagraphBorders = {};
          for (const k of SIDES) {
            if (sides[k]) borders[k] = side;
            else if (isOn(initial.borders[k])) borders[k] = NO_PARA_BORDER;
          }
          onSubmit({ borders, shading });
        }}
      >
        <div className="flex gap-4">
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t("write.setting")}</p>
            <button type="button" className={BUTTON} onClick={() => setting("none")}>
              {t("write.settingNone")}
            </button>
            <button type="button" className={BUTTON} onClick={() => setting("box")}>
              {t("write.settingBox")}
            </button>
            <button type="button" className={BUTTON} onClick={() => setting("all")}>
              {t("write.settingAll")}
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Row label={t("write.borderStyle")}>
              <select aria-label={t("write.borderStyle")} className={INPUT} value={style} onChange={(e) => setStyle(e.target.value as BorderStyle)}>
                {BORDER_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {t(`write.borderStyle.${s}`)}
                  </option>
                ))}
              </select>
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
            <Row label={t("write.borderColor")}>
              <ColorPicker label={t("write.borderColor")} kind="text" value={color} onSelect={(c) => setColor(c ?? { kind: "auto" })} />
            </Row>
          </div>
        </div>
        <p className="font-medium">{t("write.preview")}</p>
        <div className="flex items-start gap-3">
          <div className="flex flex-col gap-1">
            {SIDES.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={sides[k]} onChange={(e) => setSides({ ...sides, [k]: e.target.checked })} />
                {t(`write.side.${k}`)}
              </label>
            ))}
          </div>
          <div className="flex flex-1 flex-col bg-white p-2" aria-hidden="true">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="px-1 py-1 text-[9px] leading-3 text-gray-500"
                style={{
                  background: shading ? colorCss(shading) : undefined,
                  borderTop: i === 0 ? css("top") : css("between"),
                  borderBottom: i === 1 ? css("bottom") : "none",
                  borderLeft: css("left"),
                  borderRight: css("right"),
                }}
              >
                {"Lorem ipsum dolor sit amet consectetur adipiscing elit sed do"} {/* i18n-ignore: preview text */}
              </div>
            ))}
          </div>
        </div>
        <Row label={t("write.shading")}>
          <ColorPicker label={t("write.shadingFill")} kind="fill" value={shading ?? undefined} onSelect={(c) => setShading(c && c.kind !== "auto" ? c : null)} />
        </Row>
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- tabs ---------------------------------------------------------------------------

export const TAB_DIALOG_KINDS: TabKind[] = ["left", "center", "right", "decimal", "bar"];
export const TAB_LEADERS: TabLeader[] = ["none", "dot", "hyphen", "underscore"];

/** Tabs dialog state: the stops after Set / Clear / Clear All. */
export function setStop(stops: TabStop[], stop: TabStop): TabStop[] {
  return [...stops.filter((s) => s.pos !== stop.pos), stop].sort((a, b) => a.pos - b.pos);
}

export function TabsDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: TabStop[];
  onSubmit: (stops: TabStop[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [stops, setStops] = useState<TabStop[]>([]);
  const [pos, setPos] = useState("");
  const [kind, setKind] = useState<TabKind>("left");
  const [leader, setLeader] = useState<TabLeader>("none");
  useEffect(() => {
    if (!open) return;
    setStops(initial);
    const f = initial[0];
    setPos(f ? cm(f.pos) : "");
    setKind(f?.kind ?? "left");
    setLeader(f?.leader ?? "none");
  }, [open, initial]);
  const tw = fromCm(pos);
  const pick = (s: TabStop) => {
    setPos(cm(s.pos));
    setKind(s.kind);
    setLeader(s.leader ?? "none");
  };
  const set = () => {
    if (tw == null || tw < 0) return;
    setStops(setStop(stops, leader === "none" ? { pos: tw, kind } : { pos: tw, kind, leader }));
  };
  return (
    <Dialog open={open} title={t("write.tabs")} onClose={onClose}>
      <form
        className="flex w-[24rem] flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          // A typed position not yet set counts (Word's OK sets it).
          const typed = tw != null && tw >= 0 && !stops.some((s) => s.pos === tw) && pos.trim() !== "" ? setStop(stops, leader === "none" ? { pos: tw, kind } : { pos: tw, kind, leader }) : stops;
          onSubmit(typed);
        }}
      >
        <div className="flex gap-3">
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span>{t("write.tabStopPosition")}</span>
              <input aria-label={t("write.tabStopPosition")} className={INPUT} value={pos} onChange={(e) => setPos(e.target.value)} />
            </label>
            <ul role="listbox" aria-label={t("write.tabStops")} className="h-28 w-28 overflow-auto rounded border border-ui-border bg-ui-bg">
              {stops.map((s) => (
                <li
                  key={s.pos}
                  role="option"
                  aria-selected={tw === s.pos}
                  className="cursor-pointer px-1 hover:bg-ui-hover aria-selected:bg-ui-active"
                  onClick={() => pick(s)}
                >
                  {t("write.cmValue", { n: cm(s.pos) })}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-xs text-ui-muted">{t("write.defaultTabStops", { n: cm(DEFAULT_TAB_TWIPS) })}</p>
            <p className="font-medium">{t("fmt.alignment")}</p>
            <div role="radiogroup" aria-label={t("fmt.alignment")} className="grid grid-cols-2 gap-x-2">
              {TAB_DIALOG_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="radio" name="tab-kind" checked={kind === k} onChange={() => setKind(k)} />
                  {t(`write.tabKind.${k}`)}
                </label>
              ))}
            </div>
            <p className="font-medium">{t("write.leader")}</p>
            <div role="radiogroup" aria-label={t("write.leader")} className="grid grid-cols-2 gap-x-2">
              {TAB_LEADERS.map((l) => (
                <label key={l} className="flex items-center gap-1">
                  <input type="radio" name="tab-leader" checked={leader === l} onChange={() => setLeader(l)} />
                  {t(`write.leader.${l}`)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className={BUTTON} disabled={tw == null || tw < 0} onClick={set}>
            {t("write.tabSet")}
          </button>
          <button type="button" className={BUTTON} disabled={tw == null || !stops.some((s) => s.pos === tw)} onClick={() => setStops(stops.filter((s) => s.pos !== tw))}>
            {t("write.tabClear")}
          </button>
          <button type="button" className={BUTTON} disabled={!stops.length} onClick={() => setStops([])}>
            {t("write.tabClearAll")}
          </button>
        </div>
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}
