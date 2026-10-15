// Conditional formatting dialogs: Excel's small quick-rule dialogs
// (Greater Than…, Top 10 Items…), the New / Edit Formatting Rule dialog,
// the highlight format editor (Format Cells for a rule) and the
// Conditional Formatting Rules Manager. Rules go to the core through the
// store; the manager sends its edits as one compound on OK / Apply.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ColorPicker, Dialog, type Color } from "@rusuite/ui-shared";
import type { CfRule } from "../generated/CfRule";
import type { CfValue } from "../generated/CfValue";
import type { CompareOp } from "../generated/CompareOp";
import type { DxfStyle } from "../generated/DxfStyle";
import type { IconSetKind } from "../generated/IconSetKind";
import { ICON_SETS, iconCount } from "../grid/cf";
import { normalize } from "../grid/Selection";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import { DxfSample, GlyphSvg, IconSetPreview } from "./previews";
import { HIGHLIGHT_PRESETS, ICON_SET_GROUPS, isRankRule, quickRule, quickValueCount, rgb, type QuickRuleKind } from "./presets";
import {
  COMPARE_OPS, defaultIcons, describeRule, formFromRule, manageCommands, moveShown, needsTwo, newRuleForm, parseRanges, rangesText, RULE_TYPES,
  ruleFromForm, ruleTouches, type AverageOp, type ContainsWhat, type RuleForm, type TextOp, type Threshold, type ValueStyle,
} from "./rules";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg disabled:opacity-50";
const ROW = "flex flex-wrap items-center gap-2";

function Buttons({ onCancel, okLabel, extra }: { onCancel: () => void; okLabel?: string; extra?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      {extra}
      <button type="submit" className={BTN}>
        {okLabel ?? t("common.ok")}
      </button>
      <button type="button" className={BTN} onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

// --- highlight format editor -----------------------------------------------------

type FontStyle = "regular" | "bold" | "italic" | "boldItalic";

/** Format Cells for a rule: font style and colour, underline, strikethrough, border, fill, number format. */
export function FormatDialog({ initial, onOk, onCancel }: { initial: DxfStyle; onOk: (dxf: DxfStyle) => void; onCancel: () => void }) {
  const t = useT();
  const [dxf, setDxf] = useState<DxfStyle>({ ...initial });
  const fontStyle: FontStyle = dxf.bold ? (dxf.italic ? "boldItalic" : "bold") : dxf.italic ? "italic" : "regular";
  const patch = (p: Partial<DxfStyle>) =>
    setDxf((d) => {
      const out: DxfStyle = { ...d, ...p };
      for (const k of Object.keys(out) as (keyof DxfStyle)[]) if (out[k] === undefined) delete out[k];
      return out;
    });
  const borderColor = dxf.borders?.top?.color;
  const setBorder = (color: Color | null | undefined) => {
    if (color === undefined) return patch({ borders: undefined });
    const c = color ?? rgb("000000");
    const side = { style: "thin" as const, color: c };
    patch({ borders: { left: side, right: side, top: side, bottom: side } });
  };
  return (
    <Dialog open title={t("calc.cf.formatTitle")} onClose={onCancel}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onOk(dxf);
        }}
      >
        <label className={ROW}>
          <span className="w-28">{t("calc.cf.fontStyle")}</span>
          <select
            className={FIELD}
            value={fontStyle}
            onChange={(e) => {
              const v = e.target.value as FontStyle;
              patch({ bold: v === "bold" || v === "boldItalic" ? true : undefined, italic: v === "italic" || v === "boldItalic" ? true : undefined });
            }}
          >
            {(["regular", "bold", "italic", "boldItalic"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`calc.cf.fontStyle.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <div className={ROW}>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!!dxf.underline} onChange={(e) => patch({ underline: e.target.checked || undefined })} />
            {t("fmt.underline")}
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!!dxf.strike} onChange={(e) => patch({ strike: e.target.checked || undefined })} />
            {t("calc.cf.strike")}
          </label>
        </div>
        <div className={ROW}>
          <span className="w-28">{t("calc.cf.fontColor")}</span>
          <ColorPicker label={t("calc.cf.fontColor")} kind="text" value={dxf.fontColor} onSelect={(c) => patch({ fontColor: c ?? undefined })} />
        </div>
        <div className={ROW}>
          <span className="w-28">{t("calc.cf.fill")}</span>
          <ColorPicker label={t("calc.cf.fill")} kind="fill" value={dxf.fill} onSelect={(c) => patch({ fill: c ?? undefined })} />
        </div>
        <div className={ROW}>
          <label className="flex items-center gap-2">
            <span className="w-28">{t("calc.cf.border")}</span>
            <select className={FIELD} value={dxf.borders ? "outline" : "none"} onChange={(e) => setBorder(e.target.value === "outline" ? (borderColor ?? null) : undefined)}>
              <option value="none">{t("calc.cf.border.none")}</option>
              <option value="outline">{t("calc.cf.border.outline")}</option>
            </select>
          </label>
          {dxf.borders && <ColorPicker label={t("calc.cf.borderColor")} kind="text" value={borderColor} onSelect={(c) => setBorder(c)} />}
        </div>
        <label className={ROW}>
          <span className="w-28">{t("calc.fmt.code")}</span>
          <input className={`${FIELD} flex-1`} value={dxf.numberFormat ?? ""} onChange={(e) => patch({ numberFormat: e.target.value || undefined })} />
        </label>
        <div className={ROW}>
          <span className="w-28">{t("calc.cf.preview")}</span>
          <DxfSample dxf={dxf} label={t("calc.cf.sample")} />
        </div>
        <Buttons
          onCancel={onCancel}
          extra={
            <button type="button" className={`${BTN} mr-auto`} onClick={() => setDxf({})}>
              {t("calc.cf.clearFormat")}
            </button>
          }
        />
      </form>
    </Dialog>
  );
}

/** The "with" select of the quick dialogs: Excel's presets, then Custom Format…. */
function PresetSelect({ value, onChange, onCustom }: { value: string; onChange: (id: string) => void; onCustom: () => void }) {
  const t = useT();
  return (
    <select
      className={FIELD}
      aria-label={t("calc.cf.with")}
      value={value}
      onChange={(e) => (e.target.value === "custom" ? onCustom() : onChange(e.target.value))}
    >
      {HIGHLIGHT_PRESETS.map((p) => (
        <option key={p.id} value={p.id}>
          {t(`calc.cf.preset.${p.id}`)}
        </option>
      ))}
      <option value="custom">{t("calc.cf.customFormat")}</option>
    </select>
  );
}

// --- quick rules ----------------------------------------------------------------------

/** Greater Than… / Between… / Text that Contains… / Duplicate Values… / Top 10 Items… / Above Average…. */
export function QuickRuleDialog({ store, quick }: { store: CalcStore; quick: QuickRuleKind }) {
  const t = useT();
  const count = quickValueCount(quick);
  const rank = isRankRule(quick);
  const [values, setValues] = useState<string[]>(rank ? ["10"] : ["", ""]);
  const [preset, setPreset] = useState(HIGHLIGHT_PRESETS[0]!.id);
  const [custom, setCustom] = useState<DxfStyle | null>(null);
  const [editing, setEditing] = useState(false);
  const [duplicate, setDuplicate] = useState(true);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const dxf = preset === "custom" && custom ? custom : (HIGHLIGHT_PRESETS.find((p) => p.id === preset) ?? HIGHLIGHT_PRESETS[0]!).dxf;
  const set = (i: number, v: string) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)));
  const missing = rank ? !(Number(values[0]) >= 1) : values.slice(0, count).some((v) => v.trim() === "");
  return (
    <>
      <Dialog open={!editing} title={t(`calc.cf.title.${quick}`)} onClose={close}>
        <form
          className="flex w-[28rem] flex-col gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (missing) return;
            close();
            void store.addCfRule(quickRule(quick, values, dxf, store.selectionRects(), duplicate));
          }}
        >
          <p>{t(`calc.cf.prompt.${quick}`)}</p>
          <div className={ROW}>
            {quick === "duplicateValues" ? (
              <select className={FIELD} aria-label={t("calc.cf.valuesKind")} value={duplicate ? "duplicate" : "unique"} onChange={(e) => setDuplicate(e.target.value === "duplicate")}>
                <option value="duplicate">{t("calc.cf.duplicate")}</option>
                <option value="unique">{t("calc.cf.unique")}</option>
              </select>
            ) : rank ? (
              <>
                <input
                  type="number"
                  min={1}
                  max={quick.endsWith("Percent") ? 100 : 1000}
                  className={`${FIELD} w-20`}
                  aria-label={t("calc.cf.rank")}
                  value={values[0]}
                  onChange={(e) => set(0, e.target.value)}
                  autoFocus
                />
                {quick.endsWith("Percent") && <span>%</span>}
              </>
            ) : (
              Array.from({ length: count }, (_, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span>{t("calc.cf.and")}</span>}
                  <input
                    className={`${FIELD} w-32`}
                    aria-label={count === 2 ? t(i === 0 ? "calc.cf.value1" : "calc.cf.value2") : t("calc.cf.value")}
                    value={values[i]}
                    onChange={(e) => set(i, e.target.value)}
                    autoFocus={i === 0}
                  />
                </span>
              ))
            )}
            <span>{t(quick === "duplicateValues" ? "calc.cf.valuesWith" : quick.endsWith("Average") ? "calc.cf.averageWith" : "calc.cf.withLabel")}</span>
            <PresetSelect
              value={preset}
              onChange={setPreset}
              onCustom={() => {
                setPreset("custom");
                setEditing(true);
              }}
            />
          </div>
          <Buttons onCancel={close} />
        </form>
      </Dialog>
      {editing && (
        <FormatDialog
          initial={custom ?? {}}
          onOk={(d) => {
            setCustom(d);
            setEditing(false);
          }}
          onCancel={() => {
            if (!custom) setPreset(HIGHLIGHT_PRESETS[0]!.id);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

// --- New / Edit Formatting Rule ------------------------------------------------------

const VALUE_TYPES: CfValue["type"][] = ["num", "percent", "formula", "percentile"];

function ThresholdFields({ label, value, onChange, ends }: { label: string; value: Threshold; onChange: (t: Threshold) => void; ends?: "min" | "max" }) {
  const t = useT();
  const types = ends ? [ends, ...VALUE_TYPES] : VALUE_TYPES;
  const fixed = value.type === "min" || value.type === "max";
  return (
    <>
      <select className={FIELD} aria-label={t("calc.cf.typeOf", { what: label })} value={value.type} onChange={(e) => onChange({ type: e.target.value as CfValue["type"], value: value.value })}>
        {types.map((k) => (
          <option key={k} value={k}>
            {t(`calc.cf.valueType.${k}`)}
          </option>
        ))}
      </select>
      <input
        className={`${FIELD} w-24`}
        aria-label={t("calc.cf.valueOf", { what: label })}
        disabled={fixed}
        value={fixed ? "" : value.value}
        onChange={(e) => onChange({ type: value.type, value: e.target.value })}
      />
    </>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <input
      type="color"
      aria-label={label}
      className="h-8 w-10 cursor-pointer rounded border border-ui-border bg-ui-bg p-0.5"
      value={`#${value.toLowerCase()}`}
      onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())}
    />
  );
}

function ValuesEditor({ f, set }: { f: RuleForm; set: (p: Partial<RuleForm>) => void }) {
  const t = useT();
  const allSets = ICON_SET_GROUPS.flatMap((g) => g.sets);
  return (
    <div className="flex flex-col gap-2">
      <label className={ROW}>
        <span className="w-28">{t("calc.cf.formatStyle")}</span>
        <select className={FIELD} value={f.style} onChange={(e) => set({ style: e.target.value as ValueStyle })}>
          {(["scale2", "scale3", "dataBar", "iconSet"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`calc.cf.style.${s}`)}
            </option>
          ))}
        </select>
      </label>
      {(f.style === "scale2" || f.style === "scale3") &&
        ([0, 1, 2] as const)
          .filter((i) => f.style === "scale3" || i !== 1)
          .map((i) => {
            const label = t(["calc.cf.minimum", "calc.cf.midpoint", "calc.cf.maximum"][i]!);
            const p = f.points[i]!;
            const update = (q: Partial<RuleForm["points"][number]>) => set({ points: f.points.map((x, j) => (j === i ? { ...x, ...q } : x)) });
            return (
              <div key={i} className={ROW}>
                <span className="w-28">{label}</span>
                <ThresholdFields label={label} value={p} ends={i === 0 ? "min" : i === 2 ? "max" : undefined} onChange={(v) => update(v)} />
                <ColorInput label={t("calc.cf.colorOf", { what: label })} value={p.color} onChange={(color) => update({ color })} />
              </div>
            );
          })}
      {f.style === "dataBar" && (
        <>
          <div className={ROW}>
            <span className="w-28">{t("calc.cf.minimum")}</span>
            <ThresholdFields label={t("calc.cf.minimum")} value={f.barMin} ends="min" onChange={(barMin) => set({ barMin })} />
          </div>
          <div className={ROW}>
            <span className="w-28">{t("calc.cf.maximum")}</span>
            <ThresholdFields label={t("calc.cf.maximum")} value={f.barMax} ends="max" onChange={(barMax) => set({ barMax })} />
          </div>
          <div className={ROW}>
            <span className="w-28">{t("calc.cf.barColor")}</span>
            <ColorInput label={t("calc.cf.barColor")} value={f.barColor} onChange={(barColor) => set({ barColor })} />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.barOnly} onChange={(e) => set({ barOnly: e.target.checked })} />
              {t("calc.cf.barOnly")}
            </label>
          </div>
        </>
      )}
      {f.style === "iconSet" && (
        <>
          <div className={ROW}>
            <span className="w-28">{t("calc.cf.iconStyle")}</span>
            <select
              className={FIELD}
              value={f.iconSet}
              onChange={(e) => {
                const iconSet = e.target.value as IconSetKind;
                set({ iconSet, icons: iconCount(iconSet) === f.icons.length ? f.icons : defaultIcons(iconSet) });
              }}
            >
              {allSets.map((s) => (
                <option key={s} value={s}>
                  {t(`calc.cf.icons.${s}`)}
                </option>
              ))}
            </select>
            <IconSetPreview set={f.iconSet} />
          </div>
          <div className={ROW}>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.iconReverse} onChange={(e) => set({ iconReverse: e.target.checked })} />
              {t("calc.cf.reverseIcons")}
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.iconOnly} onChange={(e) => set({ iconOnly: e.target.checked })} />
              {t("calc.cf.iconOnly")}
            </label>
          </div>
          {/* Highest icon first, as in Excel; the lowest takes everything below the one above it. */}
          {f.icons
            .map((th, i) => ({ th, i }))
            .reverse()
            .map(({ th, i }) => {
              const icon = ICON_SETS[f.iconSet][f.iconReverse ? f.icons.length - 1 - i : i];
              const label = t("calc.cf.iconN", { n: f.icons.length - i });
              return (
                <div key={i} className={ROW}>
                  <span className="flex w-28 items-center gap-1">
                    {icon && <GlyphSvg glyph={icon} />}
                    {i === 0 ? t("calc.cf.otherwise") : t("calc.cf.whenAtLeast")}
                  </span>
                  {i > 0 && (
                    <ThresholdFields label={label} value={th} onChange={(v) => set({ icons: f.icons.map((x, j) => (j === i ? v : x)) })} />
                  )}
                </div>
              );
            })}
        </>
      )}
    </div>
  );
}

function OpSelect({ value, onChange }: { value: CompareOp; onChange: (op: CompareOp) => void }) {
  const t = useT();
  return (
    <select className={FIELD} aria-label={t("calc.cf.operator")} value={value} onChange={(e) => onChange(e.target.value as CompareOp)}>
      {COMPARE_OPS.map((op) => (
        <option key={op} value={op}>
          {t(`calc.op.${op}`)}
        </option>
      ))}
    </select>
  );
}

function RuleEditor({ f, set }: { f: RuleForm; set: (p: Partial<RuleForm>) => void }) {
  const t = useT();
  switch (f.type) {
    case "values":
      return <ValuesEditor f={f} set={set} />;
    case "contains":
      return (
        <div className={ROW}>
          <select className={FIELD} aria-label={t("calc.cf.containsWhat")} value={f.containsWhat} onChange={(e) => set({ containsWhat: e.target.value as ContainsWhat })}>
            {(["cellValue", "specificText", "blanks", "noBlanks", "errors", "noErrors"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`calc.cf.contains.${k}`)}
              </option>
            ))}
          </select>
          {f.containsWhat === "cellValue" && (
            <>
              <OpSelect value={f.op} onChange={(op) => set({ op })} />
              <input className={`${FIELD} w-28`} aria-label={t("calc.cf.value1")} value={f.v1} onChange={(e) => set({ v1: e.target.value })} />
              {needsTwo(f.op) && (
                <>
                  <span>{t("calc.cf.and")}</span>
                  <input className={`${FIELD} w-28`} aria-label={t("calc.cf.value2")} value={f.v2} onChange={(e) => set({ v2: e.target.value })} />
                </>
              )}
            </>
          )}
          {f.containsWhat === "specificText" && (
            <>
              <select className={FIELD} aria-label={t("calc.cf.operator")} value={f.textOp} onChange={(e) => set({ textOp: e.target.value as TextOp })}>
                {(["containing", "notContaining", "beginsWith", "endsWith"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`calc.cf.text.${k}`)}
                  </option>
                ))}
              </select>
              <input className={`${FIELD} w-40`} aria-label={t("calc.cf.value")} value={f.text} onChange={(e) => set({ text: e.target.value })} />
            </>
          )}
        </div>
      );
    case "topBottom":
      return (
        <div className={ROW}>
          <select className={FIELD} aria-label={t("calc.cf.topOrBottom")} value={f.bottom ? "bottom" : "top"} onChange={(e) => set({ bottom: e.target.value === "bottom" })}>
            <option value="top">{t("calc.filter.top")}</option>
            <option value="bottom">{t("calc.filter.bottom")}</option>
          </select>
          <input type="number" min={1} className={`${FIELD} w-20`} aria-label={t("calc.cf.rank")} value={f.rank} onChange={(e) => set({ rank: e.target.value })} />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={f.percent} onChange={(e) => set({ percent: e.target.checked })} />
            {t("calc.cf.percentOfRange")}
          </label>
        </div>
      );
    case "average":
      return (
        <div className={ROW}>
          <select className={FIELD} aria-label={t("calc.cf.averageOp")} value={f.average} onChange={(e) => set({ average: e.target.value as AverageOp })}>
            {(["above", "below", "equalAbove", "equalBelow"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`calc.cf.average.${k}`)}
              </option>
            ))}
          </select>
          <span>{t("calc.cf.averageOfRange")}</span>
        </div>
      );
    case "uniqueDup":
      return (
        <div className={ROW}>
          <span>{t("calc.cf.formatAll")}</span>
          <select className={FIELD} aria-label={t("calc.cf.valuesKind")} value={f.unique ? "unique" : "duplicate"} onChange={(e) => set({ unique: e.target.value === "unique" })}>
            <option value="duplicate">{t("calc.cf.duplicate")}</option>
            <option value="unique">{t("calc.cf.unique")}</option>
          </select>
          <span>{t("calc.cf.valuesInRange")}</span>
        </div>
      );
    case "formula":
      return (
        <label className="flex flex-col gap-1">
          {t("calc.cf.formulaPrompt")}
          <input className={FIELD} aria-label={t("calc.cf.formula")} value={f.formula} onChange={(e) => set({ formula: e.target.value })} autoFocus />
        </label>
      );
  }
}

/** New Formatting Rule / Edit Formatting Rule: rule type list, its description, and the format. */
export function RuleDialog({ title, initial, onOk, onCancel }: { title: string; initial: RuleForm; onOk: (rule: CfRule) => void; onCancel: () => void }) {
  const t = useT();
  const [f, setF] = useState<RuleForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [formatting, setFormatting] = useState(false);
  const set = (p: Partial<RuleForm>) => {
    setF((x) => ({ ...x, ...p }));
    setError(null);
  };
  return (
    <>
      <Dialog open={!formatting} title={title} onClose={onCancel}>
        <form
          className="flex w-[34rem] max-w-[calc(100vw-3rem)] flex-col gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const r = ruleFromForm(f);
            if ("error" in r) setError(t(r.error));
            else onOk(r.rule);
          }}
        >
          <span id="cf-rule-type">{t("calc.cf.selectType")}</span>
          <div role="listbox" aria-labelledby="cf-rule-type" className="flex flex-col rounded border border-ui-border bg-ui-bg py-0.5">
            {RULE_TYPES.map((k) => (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={f.type === k}
                className="min-h-7 px-2 text-left hover:bg-ui-hover aria-selected:bg-ui-active"
                onClick={() => set({ type: k })}
              >
                {t(`calc.cf.type.${k}`)}
              </button>
            ))}
          </div>
          <span className="font-medium">{t("calc.cf.editDescription")}</span>
          <div className="rounded border border-ui-border p-2">
            <RuleEditor f={f} set={set} />
            {f.type !== "values" && (
              <div className={`${ROW} mt-3`}>
                <span>{t("calc.cf.preview")}</span>
                <DxfSample dxf={f.dxf} label={Object.keys(f.dxf).length > 0 ? t("calc.cf.sample") : t("calc.cf.noFormat")} />
                <button type="button" className={BTN} onClick={() => setFormatting(true)}>
                  {t("calc.cf.formatButton")}
                </button>
              </div>
            )}
          </div>
          <div role="alert" className="min-h-5 text-xs text-red-700">
            {error}
          </div>
          <Buttons onCancel={onCancel} />
        </form>
      </Dialog>
      {formatting && (
        <FormatDialog
          initial={f.dxf}
          onOk={(dxf) => {
            set({ dxf });
            setFormatting(false);
          }}
          onCancel={() => setFormatting(false)}
        />
      )}
    </>
  );
}

// --- Rules Manager ------------------------------------------------------------------------

interface Item {
  key: number;
  rule: CfRule;
  /** The "applies to" box as typed. */
  text: string;
}

let itemSeq = 0;
const toItem = (rule: CfRule): Item => ({ key: ++itemSeq, rule, text: `=${rangesText(rule.ranges)}` });

/** Conditional Formatting Rules Manager: the sheet's rules by priority, edited locally until OK / Apply. */
export function ManageRulesDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const sheet = store.getState().activeSheet;
  const sel = useMemo(() => normalize(store.getState().selection), [store]);
  const [original, setOriginal] = useState<CfRule[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [scope, setScope] = useState<"selection" | "sheet">("selection");
  const [selected, setSelected] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ key: number | null; form: RuleForm } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    void store.sheetRules(sheet).then(({ rules }) => {
      setOriginal(rules);
      const next = rules.map(toItem);
      setItems(next);
      setSelected((s) => (next.length > 0 && s === null ? next[0]!.key : s));
    });
  useEffect(load, [store, sheet]);

  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const shown = items.filter((it) => scope === "sheet" || ruleTouches(it.rule, sel));
  const current = shown.find((it) => it.key === selected) ?? null;
  const update = (key: number, p: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  /** The edited list, or `null` (with a message) when an "applies to" box does not parse. */
  const edited = (): CfRule[] | null => {
    const out: CfRule[] = [];
    for (const it of items) {
      const ranges = parseRanges(it.text);
      if (!ranges) {
        setError(t("calc.cf.err.range", { text: it.text }));
        return null;
      }
      out.push({ ...it.rule, ranges });
    }
    return out;
  };
  const commit = async (then: () => void) => {
    const rules = edited();
    if (!rules || !original) return;
    const commands = manageCommands(sheet, original, rules);
    if (commands.length > 0) await store.applyCfCommands(commands);
    then();
  };
  const move = (delta: -1 | 1) => {
    if (current) setItems(moveShown(items, shown, current, delta));
  };

  return (
    <>
      <Dialog open={editor === null} title={t("calc.cf.manageTitle")} onClose={close}>
        <form
          className="flex w-[46rem] max-w-[calc(100vw-3rem)] flex-col gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void commit(close);
          }}
        >
          <label className={ROW}>
            {t("calc.cf.showFor")}
            <select className={FIELD} value={scope} onChange={(e) => setScope(e.target.value as "selection" | "sheet")}>
              <option value="selection">{t("calc.cf.scope.selection")}</option>
              <option value="sheet">{t("calc.cf.scope.sheet")}</option>
            </select>
          </label>
          <div className={ROW}>
            <button type="button" className={BTN} onClick={() => setEditor({ key: null, form: newRuleForm([{ ...sel }]) })}>
              {t("calc.cf.newRule")}
            </button>
            <button type="button" className={BTN} disabled={!current} onClick={() => current && setEditor({ key: current.key, form: formFromRule(current.rule) })}>
              {t("calc.cf.editRule")}
            </button>
            <button
              type="button"
              className={BTN}
              disabled={!current}
              onClick={() => {
                if (!current) return;
                const i = shown.indexOf(current);
                setItems((list) => list.filter((it) => it.key !== current.key));
                setSelected(shown[i + 1]?.key ?? shown[i - 1]?.key ?? null);
              }}
            >
              {t("calc.cf.deleteRule")}
            </button>
            <button type="button" className={BTN} aria-label={t("calc.cf.moveUp")} title={t("calc.cf.moveUp")} disabled={!current || shown.indexOf(current) <= 0} onClick={() => move(-1)}>
              ▲
            </button>
            <button
              type="button"
              className={BTN}
              aria-label={t("calc.cf.moveDown")}
              title={t("calc.cf.moveDown")}
              disabled={!current || shown.indexOf(current) >= shown.length - 1}
              onClick={() => move(1)}
            >
              ▼
            </button>
          </div>
          <div className="max-h-72 overflow-auto rounded border border-ui-border">
            <table className="w-full border-collapse text-left text-sm" aria-label={t("calc.cf.rules")}>
              <thead className="sticky top-0 bg-ui-panel">
                <tr>
                  <th className="px-2 py-1 font-medium">{t("calc.cf.col.rule")}</th>
                  <th className="px-2 py-1 font-medium">{t("calc.cf.col.format")}</th>
                  <th className="px-2 py-1 font-medium">{t("calc.cf.col.appliesTo")}</th>
                  <th className="px-2 py-1 font-medium">{t("calc.cf.col.stop")}</th>
                </tr>
              </thead>
              <tbody>
                {original === null && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-ui-muted">
                      {t("calc.filter.loading")}
                    </td>
                  </tr>
                )}
                {shown.map((it) => {
                  const d = describeRule(it.rule);
                  const k = it.rule.kind;
                  return (
                    <tr
                      key={it.key}
                      aria-selected={it.key === selected}
                      data-testid="cf-rule-row"
                      className="cursor-default border-t border-ui-border aria-selected:bg-ui-active"
                      onClick={() => setSelected(it.key)}
                      onDoubleClick={() => setEditor({ key: it.key, form: formFromRule(it.rule) })}
                    >
                      <td className="px-2 py-1">
                        <button type="button" className="text-left" onClick={() => setSelected(it.key)}>
                          {t(d.key, d.params)}
                        </button>
                      </td>
                      <td className="px-2 py-1">
                        {k.type === "iconSet" ? (
                          <IconSetPreview set={k.set} size={14} />
                        ) : k.type === "dataBar" || k.type === "colorScale" ? (
                          <span
                            className="inline-block h-5 w-28 border border-ui-border"
                            style={{
                              background:
                                k.type === "dataBar"
                                  ? `linear-gradient(to right, #${(k.color.kind === "rgb" ? k.color.value : "638EC6")}, #fff)`
                                  : `linear-gradient(to right, ${k.points.map((p) => (p.color.kind === "rgb" ? `#${p.color.value}` : "#fff")).join(", ")})`,
                            }}
                          />
                        ) : (
                          <DxfSample dxf={it.rule.dxf} label={it.rule.dxf ? t("calc.cf.sample") : t("calc.cf.noFormat")} />
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <input
                          className={`${FIELD} w-40`}
                          aria-label={t("calc.cf.col.appliesTo")}
                          value={it.text}
                          onFocus={() => setSelected(it.key)}
                          onChange={(e) => {
                            update(it.key, { text: e.target.value });
                            setError(null);
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          aria-label={t("calc.cf.col.stop")}
                          checked={it.rule.stopIfTrue}
                          onChange={(e) => update(it.key, { rule: { ...it.rule, stopIfTrue: e.target.checked } })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div role="alert" className="min-h-5 text-xs text-red-700">
            {error}
          </div>
          <Buttons
            onCancel={close}
            extra={
              <button type="button" className={BTN} onClick={() => void commit(load)}>
                {t("calc.cf.apply")}
              </button>
            }
          />
        </form>
      </Dialog>
      {editor && (
        <RuleDialog
          title={editor.key === null ? t("calc.cf.newRuleTitle") : t("calc.cf.editRuleTitle")}
          initial={editor.form}
          onCancel={() => setEditor(null)}
          onOk={(rule) => {
            if (editor.key === null) {
              const it = toItem({ ...rule, id: 0 });
              setItems((list) => [it, ...list]);
              setSelected(it.key);
            } else {
              const key = editor.key;
              setItems((list) => list.map((it) => (it.key === key ? { ...it, rule: { ...rule, ranges: it.rule.ranges } } : it)));
            }
            setEditor(null);
          }}
        />
      )}
    </>
  );
}

/** The conditional formatting dialogs of the store's dialog state. */
export function CfDialog({ store, dialog }: { store: CalcStore; dialog: { kind: "cfQuick"; quick: QuickRuleKind } | { kind: "cfRule"; rule: CfRule | null } | { kind: "cfManage" } }) {
  const t = useT();
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  switch (dialog.kind) {
    case "cfQuick":
      return <QuickRuleDialog key={dialog.quick} store={store} quick={dialog.quick} />;
    case "cfManage":
      return <ManageRulesDialog store={store} />;
    case "cfRule":
      return (
        <RuleDialog
          title={t("calc.cf.newRuleTitle")}
          initial={dialog.rule ? formFromRule(dialog.rule) : newRuleForm(store.selectionRects())}
          onCancel={close}
          onOk={(rule) => {
            close();
            void store.addCfRule({ ...rule, ranges: store.selectionRects() });
          }}
        />
      );
  }
}
