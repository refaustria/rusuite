// The Format Shape pane (P8-28, right of the stage), PowerPoint's two
// pages for the selected shapes:
// - Size & Properties: height, width, rotation, lock aspect ratio (kept
//   for the session; pictures locked by default) and the position from the
//   slide's top-left corner (`SetTransform`; Arrange › Rotate › More
//   Rotation Options opens it);
// - Text Options › Text Box: vertical alignment, text direction, autofit
//   (Do not Autofit / Shrink text on overflow / Resize shape to fit text),
//   margins, wrap text in shape, columns (`SetBodyProps`; the shrink scale
//   is computed and stored).
// Lengths in centimetres or inches by UI language.

import { useEffect, useState } from "react";
import { RibbonIcon, formatNumber, useLocale } from "@rusuite/ui-shared";
import type { Anchor } from "../generated/Anchor";
import type { Autofit } from "../generated/Autofit";
import type { BodyProps } from "../generated/BodyProps";
import type { TextDirection } from "../generated/TextDirection";
import type { Transform } from "../generated/Transform";
import { textOf } from "../model";
import { useShow, type ShowStore } from "../state/store";
import { emuPerUnit, rulerUnit, type RulerUnit } from "../canvas/guides";
import { useT } from "../i18n";

const BTN = "flex h-8 min-w-8 items-center justify-center rounded px-1 text-xs hover:bg-ui-hover";

/** Parses a number typed with a decimal point or comma (`null` = not a number). */
export function parseLocaleNumber(text: string): number | null {
  const v = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return text.trim() !== "" && Number.isFinite(v) ? v : null;
}

/** A number field committed on Enter / blur; `value` is shown in `digits` decimals. */
function NumField({ label, value, digits = 2, suffix, min, max, onCommit, testId }: { label: string; value: number | null; digits?: number; suffix?: string; min?: number; max?: number; onCommit: (v: number) => void; testId?: string }) {
  const shown = value === null ? "" : formatNumber(value, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = parseLocaleNumber(text);
    if (v === null) {
      setText(shown);
      return;
    }
    const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
    if (value === null || Math.abs(c - value) > 1e-9) onCommit(c);
    else setText(shown);
  };
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          data-testid={testId}
          className="h-8 w-20 rounded border border-ui-border bg-ui-bg px-1 text-right text-xs"
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        {suffix && <span className="w-5 text-ui-muted">{suffix}</span>}
      </span>
    </label>
  );
}

function Radio<T extends string>({ name, value, options, onChange }: { name: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-col gap-0.5">
      {options.map((o) => (
        <label key={o.value} className="flex min-h-8 items-center gap-2">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** The common value of `values` (`null` when they differ or there are none). */
function common<T>(values: T[]): T | null {
  if (!values.length) return null;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0]! : null;
}

export function FormatShapePane({ store }: { store: ShowStore }) {
  const t = useT();
  const locale = useLocale();
  const page = useShow(store, (s) => s.formatPane);
  useShow(store, (s) => s.selection);
  useShow(store, (s) => s.pres);
  if (!page) return null;
  const unit: RulerUnit = rulerUnit(locale);
  const per = emuPerUnit(unit);
  const sel = store.selectedShapes();
  const ts = sel.map((s) => s.transform);
  const one = sel.length === 1 ? sel[0]! : null;
  const locked = sel.length > 0 && sel.every((s) => store.aspectLocked(s));
  const textShapes = sel.filter((s) => s.kind.kind === "auto" && s.kind.value.geometry !== "line");
  const bodies: BodyProps[] = textShapes.map((s) => textOf(s)?.props ?? { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" });

  const setT = (f: (t: Transform) => Transform) => void store.setTransforms(sel.map((s) => [s.id, f(s.transform)]));
  const size = (axis: "w" | "h", v: number) =>
    setT((tr) => {
      const emu = Math.max(1, Math.round(v * per));
      if (!locked) return { ...tr, [axis]: emu };
      const k = emu / Math.max(1, tr[axis]);
      return axis === "w" ? { ...tr, w: emu, h: Math.max(1, Math.round(tr.h * k)) } : { ...tr, h: emu, w: Math.max(1, Math.round(tr.w * k)) };
    });
  const tab = (id: "size" | "text", label: string) => (
    <button type="button" role="tab" aria-selected={page === id} className={`${BTN} flex-1 ${page === id ? "font-semibold text-ui-fg underline" : "text-ui-muted"}`} onClick={() => store.openFormatPane(id)}>
      {label}
    </button>
  );
  const vert = common(bodies.map((b) => b.vert ?? "horizontal"));
  const anchor = common(bodies.map((b) => b.anchor));
  const autofit = common(bodies.map((b) => b.autofit));
  const wrap = common(bodies.map((b) => b.wrap));
  const ins = (k: "left" | "right" | "top" | "bottom") => common(bodies.map((b) => b.insets[k]));
  // each shape keeps its other margins
  const setIns = (k: "left" | "right" | "top" | "bottom", v: number) => void store.setBodyProps((b) => ({ insets: { ...b.insets, [k]: Math.max(0, Math.round(v * per)) } }));
  const cols = common(bodies.map((b) => b.columns ?? 1));
  const colGap = common(bodies.map((b) => b.columnSpacing ?? 0));
  const shrunk = textShapes.length === 1 ? bodies[0] : undefined;

  return (
    <aside aria-label={t("show.fmtPane.title")} data-testid="format-pane" className="flex w-64 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-xs text-ui-fg">
      <div className="flex items-center gap-1 border-b border-ui-border px-2 py-1">
        <span className="flex-1 text-sm font-semibold">{t("show.fmtPane.title")}</span>
        <button type="button" className={BTN} title={t("show.close")} aria-label={t("show.close")} onClick={() => store.openFormatPane(null)}>
          <RibbonIcon name="close" />
        </button>
      </div>
      <div role="tablist" className="flex border-b border-ui-border px-1">
        {tab("size", t("show.fmtPane.size"))}
        {tab("text", t("show.fmtPane.text"))}
      </div>
      {sel.length === 0 ? (
        <p className="p-3 text-ui-muted">{t("show.fmtPane.none")}</p>
      ) : page === "size" ? (
        <div className="flex flex-col gap-1 overflow-y-auto p-3" data-testid="format-size">
          <h3 className="font-semibold">{t("show.fmtPane.sizeHead")}</h3>
          <NumField label={t("show.fmtPane.height")} value={common(ts.map((x) => x.h)) === null ? null : ts[0]!.h / per} suffix={unit} min={0.01} onCommit={(v) => size("h", v)} testId="fmt-height" />
          <NumField label={t("show.fmtPane.width")} value={common(ts.map((x) => x.w)) === null ? null : ts[0]!.w / per} suffix={unit} min={0.01} onCommit={(v) => size("w", v)} testId="fmt-width" />
          <NumField label={t("show.fmtPane.rotation")} value={common(ts.map((x) => x.rotationDeg ?? 0))} digits={1} suffix="°" min={-3600} max={3600} onCommit={(v) => setT((tr) => ({ ...tr, rotationDeg: ((v % 360) + 360) % 360 }))} testId="fmt-rotation" />
          <label className="flex min-h-8 items-center gap-2">
            <input type="checkbox" checked={locked} onChange={(e) => void store.setAspectLocked(sel.map((s) => s.id), e.currentTarget.checked)} data-testid="fmt-lock" />
            {t("show.fmtPane.lockAspect")}
          </label>
          <h3 className="mt-2 font-semibold">{t("show.fmtPane.position")}</h3>
          <NumField label={t("show.fmtPane.horizontal")} value={one ? one.transform.x / per : null} suffix={unit} onCommit={(v) => setT((tr) => ({ ...tr, x: Math.round(v * per) }))} testId="fmt-x" />
          <NumField label={t("show.fmtPane.vertical")} value={one ? one.transform.y / per : null} suffix={unit} onCommit={(v) => setT((tr) => ({ ...tr, y: Math.round(v * per) }))} testId="fmt-y" />
          <p className="text-ui-muted">{t("show.fmtPane.fromCorner")}</p>
        </div>
      ) : textShapes.length === 0 ? (
        <p className="p-3 text-ui-muted">{t("show.fmtPane.noText")}</p>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto p-3" data-testid="format-text">
          <h3 className="font-semibold">{t("show.fmtPane.textBox")}</h3>
          <label className="flex items-center justify-between gap-2">
            {t("show.fmtPane.valign")}
            <select className="h-8 rounded border border-ui-border bg-ui-bg text-xs" value={anchor ?? ""} onChange={(e) => void store.setBodyProps({ anchor: e.currentTarget.value as Anchor })} data-testid="fmt-anchor">
              {anchor === null && <option value="">—</option>}
              <option value="top">{t("fmt.alignTop")}</option>
              <option value="middle">{t("fmt.alignMiddle")}</option>
              <option value="bottom">{t("fmt.alignBottom")}</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            {t("show.fmtPane.direction")}
            <select className="h-8 max-w-36 rounded border border-ui-border bg-ui-bg text-xs" value={vert ?? ""} onChange={(e) => void store.setBodyProps({ vert: e.currentTarget.value as TextDirection })} data-testid="fmt-direction">
              {vert === null && <option value="">—</option>}
              <option value="horizontal">{t("show.fmtPane.dir.horizontal")}</option>
              <option value="rotate90">{t("show.fmtPane.dir.rotate90")}</option>
              <option value="rotate270">{t("show.fmtPane.dir.rotate270")}</option>
              <option value="stacked">{t("show.fmtPane.dir.stacked")}</option>
            </select>
          </label>
          <div className="mt-1" data-testid="fmt-autofit">
            <Radio<Autofit>
              name={t("show.fmtPane.autofit")}
              value={autofit}
              options={[
                { value: "none", label: t("show.autofit.none") },
                { value: "shrink", label: t("show.autofit.shrink") },
                { value: "resize", label: t("show.autofit.resize") },
              ]}
              onChange={(v) => void store.setBodyProps({ autofit: v })}
            />
            {shrunk?.autofit === "shrink" && shrunk.fontScale !== undefined && (
              <p className="text-ui-muted" data-testid="fmt-font-scale">{t("show.autofit.scale", { scale: formatNumber(shrunk.fontScale / 1000, { maximumFractionDigits: 1 }) })}</p>
            )}
          </div>
          <NumField label={t("show.fmtPane.left")} value={ins("left") === null ? null : ins("left")! / per} suffix={unit} min={0} onCommit={(v) => setIns("left", v)} />
          <NumField label={t("show.fmtPane.right")} value={ins("right") === null ? null : ins("right")! / per} suffix={unit} min={0} onCommit={(v) => setIns("right", v)} />
          <NumField label={t("show.fmtPane.top")} value={ins("top") === null ? null : ins("top")! / per} suffix={unit} min={0} onCommit={(v) => setIns("top", v)} />
          <NumField label={t("show.fmtPane.bottom")} value={ins("bottom") === null ? null : ins("bottom")! / per} suffix={unit} min={0} onCommit={(v) => setIns("bottom", v)} />
          <label className="flex min-h-8 items-center gap-2">
            <input type="checkbox" checked={wrap ?? false} onChange={(e) => void store.setBodyProps({ wrap: e.currentTarget.checked })} data-testid="fmt-wrap" />
            {t("show.fmtPane.wrap")}
          </label>
          <h3 className="mt-2 font-semibold">{t("show.fmtPane.columns")}</h3>
          <NumField label={t("show.fmtPane.colCount")} value={cols} digits={0} min={1} max={16} onCommit={(v) => void store.setBodyProps({ columns: Math.round(v) })} testId="fmt-columns" />
          <NumField label={t("show.fmtPane.colSpacing")} value={colGap === null ? null : colGap / per} suffix={unit} min={0} onCommit={(v) => void store.setBodyProps({ columnSpacing: Math.round(v * per) })} />
        </div>
      )}
    </aside>
  );
}
