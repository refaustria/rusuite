// Style dialogs (P8-21, Word's): Modify Style / Create New Style from
// Formatting (name, type, based on, next paragraph style, a formatting
// toolbar, preview, "Add to the Styles gallery", "Automatically update",
// Format ▾ › Font… / Paragraph… / Border… / Numbering…), Create a Style
// (name + Modify…), Font… (also Find › Format › Font…, where every field
// may stay "not set"), Numbering…, Style… (Find › Format › Style…).

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ColorPicker, Dialog, FONT_FAMILIES, FONT_SIZES, Icon, RibbonIcon } from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { FontFace } from "../../../../packages/ui-shared/src/generated/FontFace";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Underline } from "../../../../packages/ui-shared/src/generated/Underline";
import type { Alignment } from "../generated/Alignment";
import type { Numbering } from "../generated/Numbering";
import type { NumberingRef } from "../generated/NumberingRef";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { StyleKind } from "../generated/StyleKind";
import type { StyleSheet } from "../generated/StyleSheet";
import { colorCss } from "../sync/schema";
import { fontCss, isParagraphKind, paneStyles, styleLabel } from "../features/styleCss";
import type { StyleFormValues } from "../features/styleCommands";
import { BUTTON, INPUT, ParagraphDialog, Row, cm, pt, type ParagraphValues } from "./dialogs";
import { BordersShadingDialog } from "./formatDialogs";
import { useT } from "../i18n";

const SMALL = "h-7 min-w-7 rounded border border-ui-border bg-ui-bg px-1.5 text-sm text-ui-fg hover:bg-ui-hover aria-pressed:bg-ui-active aria-pressed:border-ui-focus";

const fontName = (f: FontFace | null | undefined): string => (!f ? "" : f.kind === "named" ? f.value : f.value === "majorLatin" ? "+major" : "+minor");
const fontOf = (name: string): FontFace | null =>
  name === "" ? null : name === "+major" ? { kind: "theme", value: "majorLatin" } : name === "+minor" ? { kind: "theme", value: "minorLatin" } : { kind: "named", value: name };

/** CSS of the dialog's preview text. */
export function sampleCss(run: RunProperties, p: ParagraphProperties): CSSProperties {
  const size = run.size != null ? Math.min(28, run.size / 100) : 11;
  const deco = [run.underline && run.underline !== "none" ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ");
  return {
    fontFamily: fontCss(run.font),
    fontSize: `${size}pt`,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" : "normal",
    textDecoration: deco || undefined,
    color: run.color && run.color.kind !== "auto" ? colorCss(run.color) : undefined,
    backgroundColor: run.highlight && run.highlight.kind !== "auto" ? colorCss(run.highlight) : undefined,
    textAlign: (p.alignment as CSSProperties["textAlign"]) ?? "left",
    marginLeft: p.indent?.left ? `${p.indent.left / 15}px` : undefined,
    fontVariant: run.smallCaps ? "small-caps" : undefined,
    textTransform: run.allCaps ? "uppercase" : undefined,
  };
}

/** Word's description line under the preview ("Font: Calibri Light, 16 pt, Bold, …, Based on: Normal"). */
export function describeFormat(run: RunProperties, p: ParagraphProperties | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  const parts: string[] = [];
  const f = fontName(run.font);
  if (f) parts.push(`${t("write.styles.font")}: ${f === "+major" ? t("write.styles.headingsFont") : f === "+minor" ? t("write.styles.bodyFont") : f}`);
  if (run.size != null) parts.push(`${run.size / 100} pt`);
  if (run.bold) parts.push(t("fmt.bold"));
  if (run.italic) parts.push(t("fmt.italic"));
  if (run.underline && run.underline !== "none") parts.push(t("fmt.underline"));
  if (run.strike) parts.push(t("fmt.strike"));
  if (run.color && run.color.kind !== "auto") parts.push(`${t("write.fontColor")}: ${colorCss(run.color) ?? ""}`);
  if (run.highlight && run.highlight.kind !== "auto") parts.push(t("write.highlight"));
  if (p?.alignment) parts.push(t(`write.styles.align.${p.alignment}`));
  if (p?.spacing?.before != null) parts.push(`${t("write.styles.spaceBefore")}: ${pt(p.spacing.before)} pt`);
  if (p?.spacing?.after != null) parts.push(`${t("write.styles.spaceAfter")}: ${pt(p.spacing.after)} pt`);
  if (p?.indent?.left) parts.push(`${t("write.styles.indentLeft")}: ${cm(p.indent.left)} cm`);
  return parts.join(", ");
}

// ----- Font… -------------------------------------------------------------------------

type Tri = "" | "on" | "off";
const tri = (v: boolean | null | undefined): Tri => (v == null ? "" : v ? "on" : "off");
const fromTri = (v: Tri): boolean | null => (v === "" ? null : v === "on");

/** The effects checkboxes of the Font tab (Word's order). */
export const FONT_EFFECTS = ["strike", "doubleStrike", "superscript", "subscript", "smallCaps", "allCaps", "hidden", "outline", "shadow", "emboss", "imprint"] as const;
type Effect = (typeof FONT_EFFECTS)[number];
type EffectsState = Record<Effect, Tri>;

const effectsOf = (r: RunProperties, allowUnset: boolean): EffectsState => {
  const out = {} as EffectsState;
  for (const e of FONT_EFFECTS) {
    if (e === "superscript" || e === "subscript") {
      out[e] = r.verticalAlign == null ? (allowUnset ? "" : "off") : r.verticalAlign === e ? "on" : "off";
    } else {
      const v = (r as Record<string, unknown>)[e] as boolean | null | undefined;
      out[e] = allowUnset ? tri(v) : v ? "on" : "off";
    }
  }
  return out;
};

const num = (s: string): number | null => {
  const v = Number(s.trim().replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/**
 * Word's Font dialog (Ctrl+D): the Font tab (font, style, size, colour,
 * underline, the effects checkboxes) and the Advanced tab (character
 * spacing: scale, spacing expanded / condensed by, position raised /
 * lowered by, kerning for fonts of N pt and above). With `allowUnset`
 * (Find › Format) every field can stay "not set" and only the set ones are
 * returned.
 */
export function FontDialog({ open, initial, allowUnset, onSubmit, onClose }: {
  open: boolean;
  initial: RunProperties;
  allowUnset?: boolean;
  onSubmit: (run: RunProperties) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"font" | "advanced">("font");
  const [v, setV] = useState({
    font: "", bold: "" as Tri, italic: "" as Tri, size: "", underline: "", color: null as Color | null,
    fx: effectsOf({}, true), scale: "", spacing: "", position: "", kerning: false, kernPt: "",
  });
  useEffect(() => {
    if (!open) return;
    setTab("font");
    setV({
      font: fontName(initial.font),
      bold: tri(initial.bold),
      italic: tri(initial.italic),
      size: initial.size != null ? String(initial.size / 100) : "",
      underline: initial.underline ?? (allowUnset ? "" : "none"),
      color: initial.color ?? null,
      fx: effectsOf(initial, !!allowUnset),
      scale: initial.scale != null ? String(initial.scale) : allowUnset ? "" : "100",
      spacing: initial.charSpacing != null ? String(initial.charSpacing / 20) : allowUnset ? "" : "0",
      position: initial.position != null ? String(initial.position / 2) : allowUnset ? "" : "0",
      kerning: (initial.kerning ?? 0) > 0,
      kernPt: initial.kerning ? String(initial.kerning / 2) : "",
    });
  }, [open, initial, allowUnset]);
  const size = v.size.trim() === "" ? null : Number(v.size.replace(",", "."));
  const scale = num(v.scale);
  const spacing = num(v.spacing);
  const position = num(v.position);
  const kernPt = num(v.kernPt);
  const valid =
    (size === null || (Number.isFinite(size) && size >= 1 && size <= 1638)) &&
    (scale === null || (scale >= 1 && scale <= 600)) &&
    (spacing === null || Math.abs(spacing) <= 1584) &&
    (position === null || Math.abs(position) <= 1584) &&
    (!v.kerning || kernPt === null || (kernPt >= 1 && kernPt <= 1638));
  const unset = allowUnset ? <option value="">{t("write.find.notSet")}</option> : null;
  const setFx = (e: Effect, on: boolean) => {
    const fx = { ...v.fx, [e]: on ? "on" : "off" } as EffectsState;
    // Word: superscript and subscript, strikethrough and double, small caps and all caps, emboss and engrave exclude each other.
    const pairs: [Effect, Effect][] = [["superscript", "subscript"], ["strike", "doubleStrike"], ["smallCaps", "allCaps"], ["emboss", "imprint"]];
    if (on) for (const [a, b] of pairs) if (e === a) fx[b] = "off"; else if (e === b) fx[a] = "off";
    setV({ ...v, fx });
  };
  const preview: RunProperties = {
    ...(fontOf(v.font) ? { font: fontOf(v.font)! } : {}),
    bold: fromTri(v.bold),
    italic: fromTri(v.italic),
    size: size != null && valid ? size * 100 : null,
    color: v.color,
    smallCaps: v.fx.smallCaps === "on",
    allCaps: v.fx.allCaps === "on",
  } as RunProperties;
  const tabBtn = (id: "font" | "advanced", label: string) => (
    <button type="button" role="tab" aria-selected={tab === id} className={SMALL} aria-pressed={tab === id} onClick={() => setTab(id)}>
      {label}
    </button>
  );
  return (
    <Dialog open={open} title={t("write.styles.fontDialog")} onClose={onClose}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const out: RunProperties = {};
          const font = fontOf(v.font);
          if (font) out.font = font;
          const b = fromTri(v.bold);
          const i = fromTri(v.italic);
          if (b !== null) out.bold = b;
          if (i !== null) out.italic = i;
          if (size !== null) out.size = Math.round(size * 100);
          const init = initial as Record<string, unknown>;
          if (v.underline && (allowUnset || initial.underline != null || v.underline !== "none")) out.underline = v.underline as Underline;
          if (v.color) out.color = v.color;
          // Unchanged defaults stay unset (an "off" box / 0 / 100 % the run never had).
          const keep = (k: string, val: unknown, def: unknown) => allowUnset || init[k] != null || val !== def;
          for (const fx of FONT_EFFECTS) {
            const on = fromTri(v.fx[fx]);
            if (on === null || fx === "superscript" || fx === "subscript") continue;
            if (fx === "strike" || keep(fx, on, false)) (out as Record<string, unknown>)[fx] = on;
          }
          const sup = fromTri(v.fx.superscript);
          const sub = fromTri(v.fx.subscript);
          if (sup || sub) out.verticalAlign = sup ? "superscript" : "subscript";
          else if ((sup === false || sub === false) && (allowUnset || initial.verticalAlign != null)) out.verticalAlign = "baseline";
          if (scale !== null && keep("scale", Math.round(scale), 100)) out.scale = Math.round(scale);
          if (spacing !== null && keep("charSpacing", Math.round(spacing * 20), 0)) out.charSpacing = Math.round(spacing * 20);
          if (position !== null && keep("position", Math.round(position * 2), 0)) out.position = Math.round(position * 2);
          const kern = v.kerning ? Math.round((kernPt ?? 1) * 2) : 0;
          if ((allowUnset && v.kerning) || (!allowUnset && keep("kerning", kern, 0))) out.kerning = kern;
          onSubmit(out);
        }}
      >
        <div role="tablist" className="flex gap-1">
          {tabBtn("font", t("write.font.tabFont"))}
          {tabBtn("advanced", t("write.font.tabAdvanced"))}
        </div>
        {tab === "font" ? (
          <>
            <Row label={t("write.styles.font")}>
              <select aria-label={t("write.styles.font")} className={INPUT} value={v.font} onChange={(e) => setV({ ...v, font: e.target.value })}>
                {allowUnset ? unset : <option value="">{t("write.styles.inherit")}</option>}
                <option value="+minor">{t("write.styles.bodyFont")}</option>
                <option value="+major">{t("write.styles.headingsFont")}</option>
                {(FONT_FAMILIES.includes(v.font) || v.font === "" || v.font.startsWith("+") ? FONT_FAMILIES : [v.font, ...FONT_FAMILIES]).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t("write.styles.bold")}>
              <select aria-label={t("write.styles.bold")} className={INPUT} value={v.bold} onChange={(e) => setV({ ...v, bold: e.target.value as Tri })}>
                {unset}
                <option value="on">{t("write.styles.yes")}</option>
                <option value="off">{t("write.styles.no")}</option>
              </select>
            </Row>
            <Row label={t("write.styles.italic")}>
              <select aria-label={t("write.styles.italic")} className={INPUT} value={v.italic} onChange={(e) => setV({ ...v, italic: e.target.value as Tri })}>
                {unset}
                <option value="on">{t("write.styles.yes")}</option>
                <option value="off">{t("write.styles.no")}</option>
              </select>
            </Row>
            <Row label={t("write.styles.sizePt")}>
              <input aria-label={t("write.styles.sizePt")} className={INPUT} list="write-font-sizes" value={v.size} onChange={(e) => setV({ ...v, size: e.target.value })} />
            </Row>
            <datalist id="write-font-sizes">
              {FONT_SIZES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Row label={t("fmt.underline")}>
              <select aria-label={t("fmt.underline")} className={INPUT} value={v.underline} onChange={(e) => setV({ ...v, underline: e.target.value })}>
                {unset}
                <option value="none">{t("write.borderStyle.none")}</option>
                <option value="single">{t("write.borderStyle.single")}</option>
                <option value="double">{t("write.borderStyle.double")}</option>
              </select>
            </Row>
            <Row label={t("write.fontColor")}>
              <span className="flex items-center gap-1">
                <ColorPicker label={t("write.fontColor")} kind="text" value={v.color ?? undefined} onSelect={(c) => setV({ ...v, color: c })} />
                {v.color && (
                  <button type="button" className={SMALL} onClick={() => setV({ ...v, color: null })}>
                    {t("write.styles.inherit")}
                  </button>
                )}
              </span>
            </Row>
            <fieldset className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-ui-border p-2">
              <legend className="px-1 text-xs text-ui-muted">{t("write.styles.effects")}</legend>
              {FONT_EFFECTS.map((fx) => (
                <label key={fx} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    aria-label={t(`write.font.fx.${fx}`)}
                    checked={v.fx[fx] === "on"}
                    ref={(el) => {
                      if (el) el.indeterminate = v.fx[fx] === "";
                    }}
                    onChange={(e) => setFx(fx, e.target.checked)}
                  />
                  <span>{t(`write.font.fx.${fx}`)}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <>
            <Row label={t("write.font.scale")}>
              <input aria-label={t("write.font.scale")} className={INPUT} value={v.scale} onChange={(e) => setV({ ...v, scale: e.target.value })} />
            </Row>
            <Row label={t("write.font.spacing")}>
              <input aria-label={t("write.font.spacing")} className={INPUT} value={v.spacing} onChange={(e) => setV({ ...v, spacing: e.target.value })} />
            </Row>
            <Row label={t("write.font.position")}>
              <input aria-label={t("write.font.position")} className={INPUT} value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} />
            </Row>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" aria-label={t("write.font.kerning")} checked={v.kerning} onChange={(e) => setV({ ...v, kerning: e.target.checked, kernPt: e.target.checked && !v.kernPt ? "1" : v.kernPt })} />
              <span>{t("write.font.kerning")}</span>
              <input aria-label={t("write.font.kerningPt")} className={`${INPUT} w-14`} disabled={!v.kerning} value={v.kernPt} onChange={(e) => setV({ ...v, kernPt: e.target.value })} />
              <span>{t("write.font.pointsAbove")}</span>
            </label>
            <p className="text-xs text-ui-muted">{t("write.font.advancedHint")}</p>
          </>
        )}
        <div className="rounded border border-ui-border bg-white p-2 text-black" aria-label={t("write.styles.preview")}>
          <span style={sampleCss(preview, {})}>{t("write.styles.sampleShort")}</span>
        </div>
        <DialogButtons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

function DialogButtons({ onClose, disabled, extra }: { onClose: () => void; disabled?: boolean; extra?: ReactNode }) {
  const t = useT();
  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      {extra}
      <span className="flex-1" />
      <button type="submit" className={BUTTON} disabled={disabled}>
        {t("common.ok")}
      </button>
      <button type="button" className={BUTTON} onClick={onClose}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

// ----- Numbering… / Style… ---------------------------------------------------------

/** Numbering…: none or one of the document's lists (level 1). */
export function NumberingDialog({ open, numbering, initial, onSubmit, onClose }: {
  open: boolean;
  numbering: Numbering;
  initial: NumberingRef | null | undefined;
  onSubmit: (n: NumberingRef | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState("");
  useEffect(() => {
    if (open) setV(initial && initial.numId ? String(initial.numId) : "");
  }, [open, initial]);
  return (
    <Dialog open={open} title={t("write.styles.numbering")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(v ? { numId: Number(v), level: 0 } : { numId: 0, level: 0 });
        }}
      >
        <Row label={t("write.styles.list")}>
          <select aria-label={t("write.styles.list")} className="h-7 w-40 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg" value={v} onChange={(e) => setV(e.target.value)}>
            <option value="">{t("write.styles.noNumbering")}</option>
            {numbering.defs.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.levels[0]?.kind === "bullet" ? t("list.bullet") : t("list.numbered")} {d.id}
              </option>
            ))}
          </select>
        </Row>
        <DialogButtons onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** Find › Format › Style…: one of the document's styles. */
export function StylePickDialog({ open, sheet, initial, onSubmit, onClose }: {
  open: boolean;
  sheet: StyleSheet | null;
  initial: string | null | undefined;
  onSubmit: (id: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState("");
  useEffect(() => {
    if (open) setV(initial ?? "");
  }, [open, initial]);
  const all = useMemo(() => paneStyles(sheet, "all", new Map()), [sheet]);
  return (
    <Dialog open={open} title={t("write.find.findStyle")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(v || null);
        }}
      >
        <select aria-label={t("write.find.findStyle")} size={10} className="w-full rounded border border-ui-border bg-ui-bg text-sm text-ui-fg" value={v} onChange={(e) => setV(e.target.value)}>
          <option value="">{t("write.find.notSet")}</option>
          {all.map((s) => (
            <option key={s.id} value={s.id}>
              {styleLabel(s)}
            </option>
          ))}
        </select>
        <DialogButtons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- Modify Style / Create New Style from Formatting --------------------------------

const ALIGNS: Alignment[] = ["left", "center", "right", "justify"];

/**
 * Modify Style (`kindEditable = false`) or Create New Style from
 * Formatting. The formatting fields are the style's effective formatting;
 * the caller turns the difference into `UpdateStyle` / `AddStyle`.
 */
export function ModifyStyleDialog({ open, title, sheet, numbering, initial, kindEditable, ownId, onSubmit, onClose }: {
  open: boolean;
  title: string;
  sheet: StyleSheet | null;
  numbering: Numbering;
  initial: StyleFormValues | null;
  kindEditable: boolean;
  /** The edited style (excluded from "based on"). */
  ownId?: string;
  onSubmit: (v: StyleFormValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState<StyleFormValues | null>(initial);
  const [sub, setSub] = useState<null | "font" | "paragraph" | "border" | "numbering">(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (open) {
      setV(initial);
      setSub(null);
      setMenu(false);
    }
  }, [open, initial]);
  const all = useMemo(() => (sheet ? paneStyles(sheet, "all", new Map()) : []), [sheet]);
  if (!open || !v) return null;
  const para = isParagraphKind(v.kind);
  const parents = all.filter((s) => s.id !== ownId && (isParagraphKind(v.kind) ? isParagraphKind(s.kind) : s.kind === "character"));
  const nexts = all.filter((s) => isParagraphKind(s.kind));
  const run = v.run;
  const setRun = (patch: RunProperties) => setV({ ...v, run: { ...run, ...patch } });
  const setPara = (patch: ParagraphProperties) => setV({ ...v, paragraph: { ...v.paragraph, ...patch } });
  const spacing = v.paragraph.spacing ?? {};
  const indent = v.paragraph.indent ?? {};
  const toggle = (k: "bold" | "italic") => setRun({ [k]: !run[k] });
  const paraValues: ParagraphValues = { alignment: v.paragraph.alignment ?? null, indent, spacing };
  return (
    <>
      <Dialog open={open && sub === null} title={title} onClose={onClose}>
        <form
          className="flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-2 text-sm"
          data-testid="modify-style-dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (v.name.trim()) onSubmit(v);
          }}
        >
          <p className="font-medium">{t("write.styles.properties")}</p>
          <Row label={t("write.styles.name")}>
            <input aria-label={t("write.styles.name")} className="h-7 w-64 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Row>
          <Row label={t("write.styles.type")}>
            <select aria-label={t("write.styles.type")} className="h-7 w-64 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg" value={v.kind} disabled={!kindEditable} onChange={(e) => {
                const kind = e.target.value as StyleKind;
                const toChar = kind === "character";
                // A character style starts from the paragraph's look: nothing of its own.
                setV({ ...v, kind, basedOn: toChar ? "DefaultParagraphFont" : "Normal", run: toChar ? {} : v.run, next: toChar ? "" : v.next });
              }}>
              <option value="paragraph">{t("write.styles.kind.paragraph")}</option>
              <option value="character">{t("write.styles.kind.character")}</option>
              <option value="linked">{t("write.styles.kind.linked")}</option>
            </select>
          </Row>
          <Row label={t("write.styles.basedOn")}>
            <select aria-label={t("write.styles.basedOn")} className="h-7 w-64 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg" value={v.basedOn} onChange={(e) => setV({ ...v, basedOn: e.target.value })}>
              <option value="">{t("write.styles.noStyle")}</option>
              {parents.map((s) => (
                <option key={s.id} value={s.id}>
                  {styleLabel(s)}
                </option>
              ))}
            </select>
          </Row>
          {para && (
            <Row label={t("write.styles.next")}>
              <select aria-label={t("write.styles.next")} className="h-7 w-64 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg" value={v.next || ownId || ""} onChange={(e) => setV({ ...v, next: e.target.value })}>
                {!ownId && <option value="">{t("write.styles.sameStyle")}</option>}
                {nexts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {styleLabel(s)}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <p className="font-medium">{t("write.styles.formatting")}</p>
          <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={t("write.styles.formatting")}>
            <select aria-label={t("write.styles.font")} className="h-7 w-36 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg" value={fontName(run.font)} onChange={(e) => setRun({ font: fontOf(e.target.value) })}>
              <option value="+minor">{t("write.styles.bodyFont")}</option>
              <option value="+major">{t("write.styles.headingsFont")}</option>
              {(FONT_FAMILIES.includes(fontName(run.font)) || fontName(run.font).startsWith("+") || !fontName(run.font) ? FONT_FAMILIES : [fontName(run.font), ...FONT_FAMILIES]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select aria-label={t("write.styles.sizePt")} className="h-7 w-16 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg" value={run.size != null ? String(run.size / 100) : "11"} onChange={(e) => setRun({ size: Math.round(Number(e.target.value) * 100) })}>
              {[...new Set([...FONT_SIZES, run.size != null ? run.size / 100 : 11])].sort((a, b) => a - b).map((s) => (
                <option key={s} value={String(s)}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className={`${SMALL} font-bold`} aria-label={t("fmt.bold")} aria-pressed={!!run.bold} onClick={() => toggle("bold")}>
              B
            </button>
            <button type="button" className={`${SMALL} italic`} aria-label={t("fmt.italic")} aria-pressed={!!run.italic} onClick={() => toggle("italic")}>
              I
            </button>
            <button type="button" className={`${SMALL} underline`} aria-label={t("fmt.underline")} aria-pressed={!!run.underline && run.underline !== "none"} onClick={() => setRun({ underline: run.underline && run.underline !== "none" ? "none" : "single" })}>
              U
            </button>
            <ColorPicker label={t("write.fontColor")} kind="text" value={run.color ?? undefined} onSelect={(c) => setRun({ color: c ?? { kind: "auto" } })} />
            {para && (
              <>
                {ALIGNS.map((a) => (
                  <button key={a} type="button" className={SMALL} aria-label={t(`write.styles.align.${a}`)} title={t(`write.styles.align.${a}`)} aria-pressed={(v.paragraph.alignment ?? "left") === a} onClick={() => setPara({ alignment: a })}>
                    {a === "left" ? <Icon name="alignLeft" /> : a === "center" ? <Icon name="alignCenter" /> : a === "right" ? <Icon name="alignRight" /> : <RibbonIcon name="alignJustify" />}
                  </button>
                ))}
                {[1, 1.5, 2].map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={SMALL}
                    aria-label={t("write.styles.lineSpacingN", { n: l })}
                    aria-pressed={spacing.line?.kind === "multiple" && spacing.line.value === l}
                    onClick={() => setPara({ spacing: { ...spacing, line: { kind: "multiple", value: l } } })}
                  >
                    {l}
                  </button>
                ))}
                <label className="flex items-center gap-1 text-xs">
                  {t("write.styles.spaceBefore")}
                  <input aria-label={t("write.styles.spaceBeforePt")} className="h-7 w-12 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg" value={pt(spacing.before ?? 0)} onChange={(e) => setPara({ spacing: { ...spacing, before: Math.max(0, Math.round(Number(e.target.value.replace(",", ".")) * 20) || 0) } })} />
                </label>
                <label className="flex items-center gap-1 text-xs">
                  {t("write.styles.spaceAfter")}
                  <input aria-label={t("write.styles.spaceAfterPt")} className="h-7 w-12 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg" value={pt(spacing.after ?? 0)} onChange={(e) => setPara({ spacing: { ...spacing, after: Math.max(0, Math.round(Number(e.target.value.replace(",", ".")) * 20) || 0) } })} />
                </label>
                <button type="button" className={SMALL} aria-label={t("list.outdent")} title={t("list.outdent")} onClick={() => setPara({ indent: { ...indent, left: Math.max(0, (indent.left ?? 0) - 720) } })}>
                  ⇤
                </button>
                <button type="button" className={SMALL} aria-label={t("list.indent")} title={t("list.indent")} onClick={() => setPara({ indent: { ...indent, left: (indent.left ?? 0) + 720 } })}>
                  ⇥
                </button>
              </>
            )}
          </div>
          <div className="max-h-40 overflow-hidden rounded border border-ui-border bg-white p-3 text-black" data-testid="style-preview" aria-label={t("write.styles.preview")}>
            <p className="m-0 text-[10px] text-gray-400">{t("write.styles.previousParagraph")}</p>
            <p className="my-1" style={sampleCss(run, para ? v.paragraph : {})}>
              {t("write.styles.sampleText")}
            </p>
            <p className="m-0 text-[10px] text-gray-400">{t("write.styles.followingParagraph")}</p>
          </div>
          <p className="text-xs text-ui-muted" data-testid="style-description">
            {describeFormat(run, para ? v.paragraph : null, t)}
            {v.basedOn && `, ${t("write.styles.basedOnName", { name: styleLabel(sheet?.styles.find((s) => s.id === v.basedOn) ?? { id: v.basedOn, name: v.basedOn, kind: "paragraph" }) })}`}
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={v.quickFormat} onChange={(e) => setV({ ...v, quickFormat: e.target.checked })} /> {t("write.styles.addToGallery")}
            </label>
            {para && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={v.autoRedefine} onChange={(e) => setV({ ...v, autoRedefine: e.target.checked })} /> {t("write.styles.autoUpdate")}
              </label>
            )}
          </div>
          <DialogButtons
            onClose={onClose}
            disabled={!v.name.trim()}
            extra={
              <span className="relative">
                <button type="button" className={BUTTON} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                  {t("write.styles.formatMenu")} ▾
                </button>
                {menu && (
                  <span role="menu" aria-label={t("write.styles.formatMenu")} className="absolute bottom-8 left-0 z-10 flex w-40 flex-col rounded border border-ui-border bg-ui-panel py-1 shadow-lg">
                    {(["font", "paragraph", "border", "numbering"] as const)
                      .filter((k) => para || k === "font")
                      .map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="menuitem"
                          className="px-3 py-1 text-left hover:bg-ui-hover"
                          onClick={() => {
                            setMenu(false);
                            setSub(k);
                          }}
                        >
                          {t(`write.styles.format.${k}`)}
                        </button>
                      ))}
                  </span>
                )}
              </span>
            }
          />
        </form>
      </Dialog>
      <FontDialog
        open={sub === "font"}
        initial={run}
        onClose={() => setSub(null)}
        onSubmit={(r) => {
          setV({ ...v, run: { ...r, font: r.font ?? run.font } });
          setSub(null);
        }}
      />
      <ParagraphDialog
        open={sub === "paragraph"}
        initial={paraValues}
        onClose={() => setSub(null)}
        onSubmit={(p) => {
          setPara({ alignment: p.alignment, indent: p.indent, spacing: p.spacing });
          setSub(null);
        }}
      />
      <BordersShadingDialog
        open={sub === "border"}
        initial={{ borders: v.paragraph.borders ?? {}, shading: v.paragraph.shading ?? null }}
        onClose={() => setSub(null)}
        onSubmit={(b) => {
          setPara({ borders: b.borders, shading: b.shading ?? undefined });
          setSub(null);
        }}
      />
      <NumberingDialog
        open={sub === "numbering"}
        numbering={numbering}
        initial={v.paragraph.numbering}
        onClose={() => setSub(null)}
        onSubmit={(n) => {
          setPara({ numbering: n });
          setSub(null);
        }}
      />
    </>
  );
}

/** Create a Style: a name and a preview of the selection's formatting; Modify… opens the full dialog. */
export function CreateStyleDialog({ open, preview, onSubmit, onModify, onClose }: {
  open: boolean;
  preview: { run: RunProperties; paragraph: ParagraphProperties };
  onSubmit: (name: string) => void;
  onModify: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(t("write.styles.newStyleName"));
  }, [open, t]);
  return (
    <Dialog open={open} title={t("write.styles.createTitle")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <label className="flex flex-col gap-1">
          {t("write.styles.name")}
          <input aria-label={t("write.styles.name")} className="h-7 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-xs text-ui-muted">{t("write.styles.paragraphPreview")}</p>
        <div className="rounded border border-ui-border bg-white p-2 text-black">
          <span style={sampleCss(preview.run, preview.paragraph)}>{t("write.styles.sampleShort")}</span>
        </div>
        <DialogButtons
          onClose={onClose}
          disabled={!name.trim()}
          extra={
            <button type="button" className={BUTTON} disabled={!name.trim()} onClick={() => onModify(name.trim())}>
              {t("write.styles.modifyDots")}
            </button>
          }
        />
      </form>
    </Dialog>
  );
}

/** "Do you want to delete style X from the document?" */
export function DeleteStyleDialog({ open, name, onConfirm, onClose }: { open: boolean; name: string; onConfirm: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} title={t("write.styles.deleteTitle")} onClose={onClose}>
      <div className="flex w-80 flex-col gap-3 text-sm">
        <p>{t("write.styles.deleteQuestion", { name })}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onConfirm}>
            {t("write.styles.yes")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("write.styles.no")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
