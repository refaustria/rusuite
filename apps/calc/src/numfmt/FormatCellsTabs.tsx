// Format Cells tabs besides Number (P8-44 / C-08): Alignment, Font, Border,
// Fill and Protection. Each edits a slice of `FormatState`; the dialog
// sends the changes on OK (`formatCommands`).

import { useState } from "react";
import { ColorPicker, cssColor, FONT_FAMILIES, FONT_SIZES, OFFICE_THEME, STANDARD_COLORS, THEME_SLOTS, type Color } from "@rusuite/ui-shared";
import type { BorderSide } from "../generated/BorderSide";
import type { BorderStyle } from "../generated/BorderStyle";
import type { HAlign } from "../generated/HAlign";
import type { VAlign } from "../generated/VAlign";
import { useT } from "../i18n";
import { borderPreset, toggleEdge, UNDERLINE_KINDS, type Edge, type FormatState, type ScriptKind, type UnderlineKind } from "./formatCells";
import type { PatternType } from "../generated/PatternType";
import { patternBackground, PATTERN_TYPES } from "../grid/patterns";

const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";

export interface TabProps {
  state: FormatState;
  set: (p: Partial<FormatState>) => void;
}

const H_ALIGNS: HAlign[] = ["general", "left", "center", "right", "fill", "justify"];
const V_ALIGNS: VAlign[] = ["top", "center", "bottom"];

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function AlignmentTab({ state, set }: TabProps) {
  const t = useT();
  return (
    <div className="flex gap-6">
      <div className="flex flex-1 flex-col gap-2">
        <label className="flex flex-col gap-1">
          {t("calc.fmt.horizontal")}
          <select className={FIELD} aria-label={t("calc.fmt.horizontal")} value={state.horizontal} onChange={(e) => set({ horizontal: e.target.value as HAlign })}>
            {H_ALIGNS.map((h) => (
              <option key={h} value={h}>
                {t(`calc.fmt.h.${h}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {t("calc.fmt.indent")}
          <input
            type="number"
            min={0}
            max={15}
            aria-label={t("calc.fmt.indent")}
            className={`${FIELD} w-16`}
            value={state.indent}
            onChange={(e) => set({ indent: Math.max(0, Math.min(15, Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          {t("calc.fmt.vertical")}
          <select className={FIELD} aria-label={t("calc.fmt.vertical")} value={state.vertical} onChange={(e) => set({ vertical: e.target.value as VAlign })}>
            {V_ALIGNS.map((v) => (
              <option key={v} value={v}>
                {t(`calc.fmt.v.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs text-ui-muted">{t("calc.fmt.textControl")}</legend>
          <Check label={t("calc.fmt.wrap")} checked={state.wrapText} onChange={(wrapText) => set({ wrapText })} />
          <Check label={t("calc.fmt.shrink")} checked={state.shrinkToFit} onChange={(shrinkToFit) => set({ shrinkToFit })} />
          <Check label={t("calc.fmt.merge")} checked={state.merge} onChange={(merge) => set({ merge })} />
        </fieldset>
      </div>
      <fieldset className="flex w-40 flex-col items-center gap-2">
        <legend className="text-xs text-ui-muted">{t("calc.fmt.orientation")}</legend>
        <div className="flex h-24 w-24 items-center justify-center rounded border border-ui-border bg-ui-bg" aria-hidden>
          <span style={{ transform: `rotate(${-state.rotation}deg)` }}>{t("calc.fmt.textSample")} —</span>
        </div>
        <input type="range" min={-90} max={90} aria-label={t("calc.fmt.orientation")} value={state.rotation} onChange={(e) => set({ rotation: Number(e.target.value) })} />
        <label className="flex items-center gap-2">
          <input
            type="number"
            min={-90}
            max={90}
            aria-label={t("calc.fmt.degrees")}
            className={`${FIELD} w-16`}
            value={state.rotation}
            onChange={(e) => set({ rotation: Math.max(-90, Math.min(90, Math.round(Number(e.target.value) || 0))) })}
          />
          {t("calc.fmt.degrees")}
        </label>
      </fieldset>
    </div>
  );
}

type FontStyleKind = "regular" | "italic" | "bold" | "boldItalic";

export function FontTab({ state, set }: TabProps) {
  const t = useT();
  const styleKind: FontStyleKind = state.bold ? (state.italic ? "boldItalic" : "bold") : state.italic ? "italic" : "regular";
  const families = FONT_FAMILIES.includes(state.fontFamily) ? FONT_FAMILIES : [state.fontFamily, ...FONT_FAMILIES];
  const sizes = FONT_SIZES.includes(state.fontSize) ? FONT_SIZES : [...FONT_SIZES, state.fontSize].sort((a, b) => a - b);
  const preview: React.CSSProperties = {
    fontFamily: state.fontFamily,
    fontWeight: state.bold ? 700 : 400,
    fontStyle: state.italic ? "italic" : "normal",
    fontSize: `${Math.min(state.fontSize, 28)}pt`,
    textDecoration: [state.underline !== "none" ? "underline" : "", state.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none",
    textDecorationStyle: state.underline.startsWith("double") ? "double" : "solid",
    textUnderlineOffset: state.underline.endsWith("Accounting") ? "0.3em" : undefined,
    color: cssColor(state.color ?? undefined, OFFICE_THEME) ?? undefined,
    verticalAlign: state.script === "superscript" ? "super" : state.script === "subscript" ? "sub" : undefined,
  };
  const setScript = (s: ScriptKind, on: boolean) => set({ script: on ? s : "baseline" });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          {t("calc.fmt.fontName")}
          <select className={FIELD} aria-label={t("calc.fmt.fontName")} value={state.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-32 flex-col gap-1">
          {t("calc.fmt.fontStyle")}
          <select
            className={FIELD}
            aria-label={t("calc.fmt.fontStyle")}
            value={styleKind}
            onChange={(e) => {
              const k = e.target.value as FontStyleKind;
              set({ bold: k === "bold" || k === "boldItalic", italic: k === "italic" || k === "boldItalic" });
            }}
          >
            {(["regular", "italic", "bold", "boldItalic"] as FontStyleKind[]).map((k) => (
              <option key={k} value={k}>
                {t(`calc.fmt.style.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-20 flex-col gap-1">
          {t("calc.fmt.size")}
          <select className={FIELD} aria-label={t("calc.fmt.size")} value={state.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })}>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1">
          {t("calc.fmt.underline")}
          <select className={FIELD} aria-label={t("calc.fmt.underline")} value={state.underline} onChange={(e) => set({ underline: e.target.value as UnderlineKind })}>
            {UNDERLINE_KINDS.map((u) => (
              <option key={u} value={u}>
                {t(`calc.fmt.u.${u}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          {t("calc.fmt.color")}
          <ColorPicker label={t("calc.fmt.color")} kind="text" value={state.color ?? undefined} onSelect={(color) => set({ color })} />
        </div>
      </div>
      <div className="flex gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs text-ui-muted">{t("calc.fmt.effects")}</legend>
          <Check label={t("calc.fmt.strike")} checked={state.strike} onChange={(strike) => set({ strike })} />
          <Check label={t("calc.fmt.superscript")} checked={state.script === "superscript"} onChange={(on) => setScript("superscript", on)} />
          <Check label={t("calc.fmt.subscript")} checked={state.script === "subscript"} onChange={(on) => setScript("subscript", on)} />
        </fieldset>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-ui-muted">{t("calc.fmt.preview")}</span>
          <div data-testid="font-preview" className="flex h-16 items-center justify-center overflow-hidden rounded border border-ui-border bg-white text-black">
            <span style={preview}>{"AaBbCcYyZz" /* i18n-ignore: sample glyphs */}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const LINE_STYLES: BorderStyle[] = ["hair", "dotted", "dashed", "thin", "medium", "thick", "double"];

function lineDash(style: BorderStyle): string | undefined {
  return style === "dashed" ? "4 2" : style === "dotted" ? "1 2" : style === "hair" ? "1 1" : undefined;
}
function lineWidth(style: BorderStyle): number {
  return style === "medium" ? 2 : style === "thick" ? 3 : 1;
}

/** Lines of the 2 × 2 preview (100 × 70) per edge. */
const PREVIEW: Record<Edge, [number, number, number, number]> = {
  top: [10, 10, 110, 10],
  insideHorizontal: [10, 45, 110, 45],
  bottom: [10, 80, 110, 80],
  left: [10, 10, 10, 80],
  insideVertical: [60, 10, 60, 80],
  right: [110, 10, 110, 80],
  diagonalUp: [10, 80, 110, 10],
  diagonalDown: [10, 10, 110, 80],
};
const COLUMN_A: Edge[] = ["top", "insideHorizontal", "bottom", "diagonalUp"];
const ROW_B: Edge[] = ["left", "insideVertical", "right", "diagonalDown"];

function EdgeIcon({ edge }: { edge: Edge }) {
  const [x1, y1, x2, y2] = PREVIEW[edge];
  const s = (v: number, max: number) => (v / max) * 14 + 1;
  return (
    <svg width="16" height="16" aria-hidden>
      <rect x="1" y="1" width="14" height="14" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <line x1={s(x1 - 10, 100)} y1={s(y1 - 10, 70)} x2={s(x2 - 10, 100)} y2={s(y2 - 10, 70)} stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function BorderTab({ state, set }: TabProps) {
  const t = useT();
  const [style, setStyle] = useState<BorderStyle>("thin");
  const [color, setColor] = useState<Color>({ kind: "auto" });
  const line: BorderSide = { style, color };
  const edges = state.edges;
  const toggle = (e: Edge) => set({ edges: toggleEdge(edges, e, line) });
  const edgeButton = (e: Edge) => (
    <button key={e} type="button" className={`${BTN} px-1`} aria-label={t(`calc.fmt.edge.${e}`)} aria-pressed={!!edges[e]} onClick={() => toggle(e)}>
      <EdgeIcon edge={e} />
    </button>
  );
  return (
    <div className="flex gap-4">
      <div className="flex w-32 flex-col gap-2">
        <span>{t("calc.fmt.line")}</span>
        <div role="listbox" aria-label={t("calc.fmt.line")} className="flex flex-col rounded border border-ui-border bg-ui-bg py-1">
          {LINE_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === style}
              aria-label={t(`calc.fmt.line.${s}`)}
              className={`flex h-6 items-center px-2 ${s === style ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => setStyle(s)}
            >
              <svg width="90" height="8" aria-hidden>
                {s === "double" ? (
                  <>
                    <line x1="0" y1="2" x2="90" y2="2" stroke="currentColor" />
                    <line x1="0" y1="6" x2="90" y2="6" stroke="currentColor" />
                  </>
                ) : (
                  <line x1="0" y1="4" x2="90" y2="4" stroke="currentColor" strokeWidth={lineWidth(s)} strokeDasharray={lineDash(s)} />
                )}
              </svg>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {t("calc.fmt.color")}
          <ColorPicker label={t("calc.fmt.color")} kind="text" value={color} onSelect={(c) => setColor(c ?? { kind: "auto" })} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <span>{t("calc.fmt.presets")}</span>
        <div className="flex gap-2">
          {(["none", "outline", "inside"] as const).map((p) => (
            <button key={p} type="button" className={BTN} onClick={() => set({ edges: borderPreset(edges, p, line) })}>
              {t(`calc.fmt.preset.${p}`)}
            </button>
          ))}
        </div>
        <span>{t("calc.fmt.borderLabel")}</span>
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">{COLUMN_A.map(edgeButton)}</div>
          <svg data-testid="border-preview" width="120" height="90" className="rounded border border-ui-border bg-white" role="img" aria-label={t("calc.fmt.preview")}>
            <text x="35" y="32" fontSize="10" fill="#888" textAnchor="middle">{t("calc.fmt.textSample")}</text>
            <text x="85" y="32" fontSize="10" fill="#888" textAnchor="middle">{t("calc.fmt.textSample")}</text>
            <text x="35" y="67" fontSize="10" fill="#888" textAnchor="middle">{t("calc.fmt.textSample")}</text>
            <text x="85" y="67" fontSize="10" fill="#888" textAnchor="middle">{t("calc.fmt.textSample")}</text>
            {(Object.keys(PREVIEW) as Edge[]).map((e) => {
              const side = edges[e];
              const [x1, y1, x2, y2] = PREVIEW[e];
              return (
                <g key={e}>
                  {side && (
                    <line
                      data-edge={e}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={cssColor(side.color, OFFICE_THEME) ?? "#000"}
                      strokeWidth={side.style === "double" ? 3 : lineWidth(side.style)}
                      strokeDasharray={lineDash(side.style)}
                    />
                  )}
                  {/* A wide transparent hit line: clicking the preview toggles the edge. */}
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="8" onClick={() => toggle(e)} />
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex gap-1 pl-10">{ROW_B.map(edgeButton)}</div>
        <p className="text-xs text-ui-muted">{t("calc.fmt.borderHint")}</p>
      </div>
    </div>
  );
}

/** Theme colours (no tint) then the standard colours. */
const FILL_COLORS: Color[] = [
  ...THEME_SLOTS.map((slot) => ({ kind: "theme", value: { slot, tint: 0 } }) as Color),
  ...STANDARD_COLORS.map((hex) => ({ kind: "rgb", value: hex }) as Color),
];

export function FillTab({ state, set }: TabProps) {
  const t = useT();
  const current = JSON.stringify(state.fill);
  return (
    <div className="flex gap-6">
      <div className="flex flex-col gap-2">
        <span>{t("calc.fmt.background")}</span>
        <button type="button" className={BTN} aria-pressed={state.fill === null} onClick={() => set({ fill: null })}>
          {t("calc.fmt.noColor")}
        </button>
        <div role="group" aria-label={t("calc.fmt.background")} className="grid grid-cols-10 gap-0.5">
          {FILL_COLORS.map((c) => {
            const css = cssColor(c, OFFICE_THEME) ?? "transparent";
            const label = c.kind === "rgb" ? `#${c.value}` : c.kind === "theme" ? c.value.slot : "";
            return (
              <button
                key={JSON.stringify(c)}
                type="button"
                aria-label={label}
                aria-pressed={JSON.stringify(c) === current}
                className="h-5 w-5 rounded-sm border border-ui-border aria-pressed:ring-2 aria-pressed:ring-ui-focus"
                style={{ background: css }}
                onClick={() => set({ fill: c })}
              />
            );
          })}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <label className="flex flex-col gap-1">
          {t("calc.fmt.patternColor")}
          <ColorPicker label={t("calc.fmt.patternColor")} kind="text" value={state.patternColor ?? undefined} onSelect={(patternColor) => set({ patternColor })} />
        </label>
        <label className="flex flex-col gap-1">
          {t("calc.fmt.patternStyle")}
          <select
            className={FIELD}
            aria-label={t("calc.fmt.patternStyle")}
            value={state.pattern ?? ""}
            onChange={(e) => set({ pattern: (e.target.value || null) as PatternType | null })}
          >
            <option value="">{t("calc.fmt.pattern.none")}</option>
            {PATTERN_TYPES.map((p) => (
              <option key={p} value={p}>
                {t(`calc.fmt.pattern.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-ui-muted">{t("calc.fmt.sample")}</span>
        <div
          data-testid="fill-sample"
          className="h-16 rounded border border-ui-border"
          style={
            state.pattern
              ? patternBackground({ pattern: state.pattern, fg: state.patternColor ?? undefined, bg: state.fill ?? undefined })
              : { background: state.fill ? (cssColor(state.fill, OFFICE_THEME) ?? "transparent") : "#ffffff" }
          }
        />
      </div>
    </div>
  );
}

export function ProtectionTab({ state, set }: TabProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <Check label={t("calc.fmt.locked")} checked={state.locked} onChange={(locked) => set({ locked })} />
      <Check label={t("calc.fmt.hidden")} checked={state.hidden} onChange={(hidden) => set({ hidden })} />
      <p className="text-xs text-ui-muted">{t("calc.fmt.protectionNote")}</p>
    </div>
  );
}
