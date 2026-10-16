// Excel's Text Import Wizard (P8-35), shared by Data › Text to Columns and
// opening a `.csv` / `.txt` file: step 1 original data type (and file
// origin), step 2 delimiters / text qualifier or the fixed-width break
// lines (click the ruler to add one, drag to move, double-click to
// remove), step 3 column data formats, destination (Text to Columns) and
// the decimal / thousands separators. The preview comes from the core
// (`splitPreview`).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { ColumnFormat } from "../generated/ColumnFormat";
import type { DateOrder } from "../generated/DateOrder";
import type { SplitKind } from "../generated/SplitKind";
import type { TextEncoding } from "../generated/TextEncoding";
import type { TextImportOptions } from "../generated/TextImportOptions";
import { useT } from "../i18n";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

/** Preview rows shown. */
export const PREVIEW_ROWS = 8;
/** Width of one character of the fixed-width ruler, px. */
export const CHAR_PX = 8;

export const ENCODINGS: TextEncoding[] = ["utf8", "windows1252", "utf16Le", "utf16Be"];

/** Delimited by the first of `seps` (`\t`, `;`, `,`, ` ` or another character). */
export function delimited(sep: string): SplitKind {
  return {
    kind: "delimited", tab: sep === "\t", semicolon: sep === ";", comma: sep === ",", space: sep === " ",
    ...(["\t", ";", ",", " "].includes(sep) || sep === "" ? {} : { other: sep }), consecutive: false,
  };
}

/** The breaks of a fixed-width split guessed from the text: columns that are blank on every line, after text. */
export function guessBreaks(lines: readonly string[]): number[] {
  const width = Math.max(0, ...lines.map((l) => l.length));
  const out: number[] = [];
  for (let i = 1; i < width; i++) {
    const blankHere = lines.every((l) => (l[i - 1] ?? " ") === " ");
    const textNext = lines.some((l) => (l[i] ?? " ") !== " ");
    if (blankHere && textNext && !out.includes(i)) out.push(i);
  }
  return out;
}

/** The number of columns of a preview. */
export function previewColumns(rows: readonly string[][]): number {
  return Math.max(0, ...rows.map((r) => r.length));
}

/** `formats` with column `i` set (missing ones General). */
export function setFormat(formats: readonly ColumnFormat[], i: number, f: ColumnFormat): ColumnFormat[] {
  const out = [...formats];
  while (out.length <= i) out.push({ kind: "general" });
  out[i] = f;
  return out;
}

/** Adds, moves or removes a fixed-width break (kept sorted, unique, > 0). */
export function editBreaks(breaks: readonly number[], op: { add: number } | { remove: number } | { move: number; to: number }): number[] {
  let out = [...breaks];
  if ("add" in op) out.push(op.add);
  else if ("remove" in op) out = out.filter((b) => b !== op.remove);
  else out = out.map((b) => (b === op.move ? op.to : b));
  return [...new Set(out.filter((b) => b > 0))].sort((a, b) => a - b);
}

export interface TextWizardProps {
  title: string;
  /** The text to split (the selected cells' texts, or the file). */
  text: string;
  initial: TextImportOptions;
  preview: (text: string, options: TextImportOptions, max: number) => Promise<string[][]>;
  /** Import: the file origin (encoding) and its change. */
  encoding?: { value: TextEncoding; onChange: (e: TextEncoding) => void };
  /** Text to Columns: the destination reference. */
  dest?: string;
  onFinish: (options: TextImportOptions, dest?: string) => void;
  onCancel: () => void;
}

export function TextWizard({ title, text, initial, preview, encoding, dest: initialDest, onFinish, onCancel }: TextWizardProps) {
  const t = useT();
  const [step, setStep] = useState(1);
  const [options, setOptions] = useState<TextImportOptions>(initial);
  const [rows, setRows] = useState<string[][]>([]);
  const [selected, setSelected] = useState(0);
  const [dest, setDest] = useState(initialDest ?? "");
  const lines = text.split(/\r\n|\n|\r/).slice(0, PREVIEW_ROWS);
  useEffect(() => {
    let live = true;
    void preview(text, options, PREVIEW_ROWS).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [text, options, preview]);
  const split = options.split;
  const set = (p: Partial<TextImportOptions>) => setOptions((o) => ({ ...o, ...p }));
  const setSplit = (p: Partial<Extract<SplitKind, { kind: "delimited" }>>) =>
    setOptions((o) => (o.split.kind === "delimited" ? { ...o, split: { ...o.split, ...p } } : o));
  const formats = options.formats ?? [];
  const fmt = formats[selected] ?? { kind: "general" };
  const cols = previewColumns(rows);
  return (
    <Dialog open title={t("calc.wizard.step", { title, step, of: 3 })} onClose={onCancel}>
      <div className="flex w-[40rem] max-w-full flex-col gap-3 text-sm" data-testid="text-wizard">
        {step === 1 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t("calc.wizard.dataType")}</legend>
            <label className="flex h-8 items-center gap-2">
              <input type="radio" name="wizard-kind" checked={split.kind === "delimited"} onChange={() => set({ split: delimited(";") })} />
              {t("calc.wizard.delimited")}
            </label>
            <label className="flex h-8 items-center gap-2">
              <input type="radio" name="wizard-kind" checked={split.kind === "fixedWidth"} onChange={() => set({ split: { kind: "fixedWidth", breaks: guessBreaks(lines) } })} />
              {t("calc.wizard.fixedWidth")}
            </label>
            {encoding && (
              <label className="flex items-center gap-2">
                <span>{t("calc.wizard.origin")}</span>
                <select className={FIELD} value={encoding.value} onChange={(e) => encoding.onChange(e.target.value as TextEncoding)}>
                  {ENCODINGS.map((e) => (
                    <option key={e} value={e}>
                      {t(`calc.wizard.encoding.${e}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        )}
        {step === 2 && split.kind === "delimited" && (
          <div className="flex gap-6">
            <fieldset className="flex flex-col gap-1">
              <legend className="font-medium">{t("calc.wizard.delimiters")}</legend>
              {(["tab", "semicolon", "comma", "space"] as const).map((k) => (
                <label key={k} className="flex h-7 items-center gap-2">
                  <input type="checkbox" checked={!!split[k]} onChange={(e) => setSplit({ [k]: e.target.checked })} data-testid={`wizard-${k}`} />
                  {t(`calc.wizard.${k}`)}
                </label>
              ))}
              <label className="flex h-7 items-center gap-2">
                <input type="checkbox" checked={split.other !== undefined} onChange={(e) => setSplit({ other: e.target.checked ? (split.other ?? "|") : undefined })} />
                {t("calc.wizard.other")}
                <input
                  className={`${FIELD} w-10 font-mono`}
                  aria-label={t("calc.wizard.otherChar")}
                  maxLength={1}
                  value={split.other ?? ""}
                  onChange={(e) => setSplit({ other: e.target.value === "" ? undefined : e.target.value })}
                />
              </label>
            </fieldset>
            <div className="flex flex-col gap-2">
              <label className="flex h-7 items-center gap-2">
                <input type="checkbox" checked={!!split.consecutive} onChange={(e) => setSplit({ consecutive: e.target.checked })} />
                {t("calc.wizard.consecutive")}
              </label>
              <label className="flex items-center gap-2">
                {t("calc.wizard.qualifier")}
                <select
                  className={FIELD}
                  value={options.qualifier === null ? "none" : (options.qualifier ?? '"')}
                  onChange={(e) => set({ qualifier: e.target.value === "none" ? (null as unknown as undefined) : e.target.value })}
                >
                  <option value={'"'}>"</option>
                  <option value="'">'</option>
                  <option value="none">{t("calc.wizard.none")}</option>
                </select>
              </label>
            </div>
          </div>
        )}
        {step === 2 && split.kind === "fixedWidth" && (
          <BreakEditor lines={lines} breaks={split.breaks} onChange={(breaks) => set({ split: { kind: "fixedWidth", breaks } })} />
        )}
        {step === 3 && (
          <div className="flex gap-6">
            <fieldset className="flex flex-col gap-1">
              <legend className="font-medium">{t("calc.wizard.columnFormat")}</legend>
              {(["general", "text", "date", "skip"] as const).map((k) => (
                <label key={k} className="flex h-7 items-center gap-2">
                  <input
                    type="radio"
                    name="wizard-format"
                    checked={fmt.kind === k}
                    onChange={() => set({ formats: setFormat(formats, selected, k === "date" ? { kind: "date", order: "mdy" } : { kind: k }) })}
                  />
                  {t(`calc.wizard.format.${k}`)}
                  {k === "date" && (
                    <select
                      className={FIELD}
                      aria-label={t("calc.wizard.dateOrder")}
                      value={fmt.kind === "date" ? fmt.order : "mdy"}
                      onChange={(e) => set({ formats: setFormat(formats, selected, { kind: "date", order: e.target.value as DateOrder }) })}
                    >
                      {(["mdy", "dmy", "ymd"] as const).map((o) => (
                        <option key={o} value={o}>
                          {o.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-2">
              {initialDest !== undefined && (
                <label className="flex items-center gap-2">
                  {t("calc.wizard.destination")}
                  <input className={`${FIELD} w-32 font-mono`} value={dest} onChange={(e) => setDest(e.target.value)} data-testid="wizard-dest" />
                </label>
              )}
              <label className="flex items-center gap-2">
                {t("calc.wizard.decimal")}
                <select className={FIELD} value={options.decimal ?? "."} onChange={(e) => set({ decimal: e.target.value, thousands: e.target.value === "," ? "." : "," })}>
                  <option value=".">.</option>
                  <option value=",">,</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                {t("calc.wizard.thousands")}
                <select className={FIELD} value={options.thousands ?? ","} onChange={(e) => set({ thousands: e.target.value })}>
                  <option value=",">,</option>
                  <option value=".">.</option>
                  <option value=" ">{t("calc.wizard.space")}</option>
                  <option value="'">'</option>
                </select>
              </label>
            </div>
          </div>
        )}
        <div className="max-h-52 overflow-auto rounded border border-ui-border bg-ui-bg" aria-label={t("calc.wizard.preview")} role="region">
          <table className="border-collapse font-mono text-xs" data-testid="wizard-preview">
            {step === 3 && (
              <thead>
                <tr>
                  {Array.from({ length: cols }, (_, i) => (
                    <th
                      key={i}
                      className={`cursor-pointer border border-ui-border px-1 font-normal ${i === selected ? "bg-ui-hover font-semibold" : ""}`}
                      onClick={() => setSelected(i)}
                    >
                      {t(`calc.wizard.format.${(formats[i] ?? { kind: "general" }).kind}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {Array.from({ length: cols }, (_, i) => (
                    <td
                      key={i}
                      className={`whitespace-pre border border-ui-border px-1 ${step === 3 && i === selected ? "bg-ui-hover" : ""} ${(formats[i]?.kind ?? "") === "skip" ? "text-ui-muted line-through" : ""}`}
                      onClick={() => step === 3 && setSelected(i)}
                    >
                      {r[i] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className={BTN} disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
            {t("calc.wizard.back")}
          </button>
          <button type="button" className={BTN} disabled={step === 3} onClick={() => setStep((s) => s + 1)}>
            {t("calc.wizard.next")}
          </button>
          <button type="button" className={BTN} data-testid="wizard-finish" onClick={() => onFinish(options, initialDest !== undefined ? dest : undefined)}>
            {t("calc.wizard.finish")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The fixed-width ruler: click to add a break line, drag one to move it, double-click to remove it. */
function BreakEditor({ lines, breaks, onChange }: { lines: string[]; breaks: number[]; onChange: (b: number[]) => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(20, ...lines.map((l) => l.length + 4));
  const at = (e: { clientX: number }) => {
    const r = box.current?.getBoundingClientRect();
    return r ? Math.max(1, Math.round((e.clientX - r.left) / CHAR_PX)) : 1;
  };
  const drag = (b: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let to = b;
    const move = (ev: PointerEvent) => {
      to = at(ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (to !== b) onChange(editBreaks(breaks, { move: b, to }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-ui-muted">{t("calc.wizard.breakHelp")}</p>
      <div
        ref={box}
        className="relative cursor-crosshair overflow-hidden rounded border border-ui-border bg-ui-bg font-mono text-xs"
        style={{ width: width * CHAR_PX, height: 16 + lines.length * 16 }}
        data-testid="wizard-ruler"
        onClick={(e) => onChange(editBreaks(breaks, { add: at(e) }))}
      >
        {lines.map((l, i) => (
          <div key={i} className="absolute whitespace-pre" style={{ top: 16 + i * 16, left: 0, letterSpacing: 0, width: width * CHAR_PX }}>
            {[...l].map((ch, j) => (
              <span key={j} className="inline-block text-center" style={{ width: CHAR_PX }}>
                {ch}
              </span>
            ))}
          </div>
        ))}
        {breaks.map((b) => (
          <div
            key={b}
            role="separator"
            aria-label={t("calc.wizard.breakAt", { n: b })}
            className="absolute top-0 h-full w-1 -translate-x-1/2 cursor-ew-resize bg-blue-600/70"
            style={{ left: b * CHAR_PX }}
            onPointerDown={drag(b)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onChange(editBreaks(breaks, { remove: b }));
            }}
          />
        ))}
      </div>
    </div>
  );
}
