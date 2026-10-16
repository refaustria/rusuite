// Format Cells › Number (Ctrl+1, P8-23): Excel's categories (General,
// Number, Currency, Accounting, Date, Time, Percentage, Fraction,
// Scientific, Text, Custom – Special is not offered) with their options and
// a live sample formatted by the core (colour included); Custom lists the
// built-in codes and the workbook's own.

import { useEffect, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import {
  buildCode, CATEGORIES, customCodes, DATE_CODES, FRACTION_CODES, NEGATIVE_STYLES, parseCode, previewValue, SYMBOLS, TIME_CODES,
  type CurrencySymbol, type FormatChoice, type NegativeStyle,
} from "../numberFormat";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

/** A formatted sample (text and colour) from the core. */
function useSample(store: CalcStore, value: number | null, code: string, fallback: string): { text: string; color: string | null } {
  const [sample, setSample] = useState<{ text: string; color: string | null }>({ text: "", color: null });
  useEffect(() => {
    let live = true;
    if (value === null) {
      setSample({ text: fallback, color: null });
      return;
    }
    store.api.formatSample(value, code).then(
      (s) => live && setSample(s),
      () => live && setSample({ text: "—", color: null }),
    );
    return () => {
      live = false;
    };
  }, [store, value, code, fallback]);
  return sample;
}

/** One entry of the Negative numbers list, rendered like Excel's (red ones red). */
function NegativeOption({ store, code, selected, onPick }: { store: CalcStore; code: string; selected: boolean; onPick: () => void }) {
  const s = useSample(store, -1234.1, code, "");
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`px-2 py-0.5 text-left font-mono ${selected ? "bg-ui-active" : "hover:bg-ui-hover"}`}
      style={s.color ? { color: s.color } : undefined}
      onClick={onPick}
    >
      {s.text}
    </button>
  );
}

function CodeList({ label, codes, value, onPick, labels }: { label: string; codes: readonly string[]; value: string; onPick: (c: string) => void; labels?: (c: string) => string }) {
  return (
    <div role="listbox" aria-label={label} className="flex max-h-40 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
      {codes.map((c) => (
        <button
          key={c}
          type="button"
          role="option"
          aria-selected={c === value}
          className={`shrink-0 truncate px-2 py-0.5 text-left font-mono text-xs ${c === value ? "bg-ui-active" : "hover:bg-ui-hover"}`}
          onClick={() => onPick(c)}
        >
          {labels ? labels(c) : c}
        </button>
      ))}
    </div>
  );
}

export function NumberFormatDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const [choice, setChoice] = useState<FormatChoice>(() => parseCode(store.activeStyle().numberFormat));
  const code = buildCode(choice);
  const cell = store.activeCell();
  const value = previewValue(cell);
  const sample = useSample(store, value, code, cell?.display ?? "");
  const set = (p: Partial<FormatChoice>) => setChoice((c) => ({ ...c, ...p }));
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const c = choice.category;
  const negCode = (n: NegativeStyle) => buildCode({ ...choice, negative: n });
  const decimals = (
    <label className="flex items-center gap-2">
      {t("calc.fmt.decimals")}
      <input
        type="number"
        min={0}
        max={30}
        aria-label={t("calc.fmt.decimals")}
        className={`${FIELD} w-16`}
        value={choice.decimals}
        onChange={(e) => set({ decimals: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
      />
    </label>
  );
  const symbols = (
    <label className="flex items-center gap-2">
      {t("calc.fmt.symbol")}
      <select className={FIELD} aria-label={t("calc.fmt.symbol")} value={choice.symbol} onChange={(e) => set({ symbol: e.target.value as CurrencySymbol })}>
        {SYMBOLS.map((s) => (
          <option key={s || "none"} value={s}>
            {s || t("calc.fmt.noSymbol")}
          </option>
        ))}
      </select>
    </label>
  );
  const negatives = (
    <div className="flex flex-col gap-0.5">
      <span>{t("calc.fmt.negative")}</span>
      <div role="listbox" aria-label={t("calc.fmt.negative")} className="flex flex-col rounded border border-ui-border bg-ui-bg py-1">
        {NEGATIVE_STYLES.map((n) => (
          <NegativeOption key={n} store={store} code={negCode(n)} selected={choice.negative === n} onPick={() => set({ negative: n })} />
        ))}
      </div>
    </div>
  );
  return (
    <Dialog open title={t("calc.fmt.title")} onClose={close}>
      <form
        className="flex w-[34rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void store.applyStyle({ numberFormat: code });
          close();
        }}
      >
        <div className="flex gap-3">
          <div role="listbox" aria-label={t("calc.fmt.category")} className="flex w-32 flex-col rounded border border-ui-border bg-ui-bg py-1">
            {CATEGORIES.map((k) => (
              <button
                key={k.id}
                type="button"
                role="option"
                aria-selected={c === k.id}
                className={`px-2 py-0.5 text-left ${c === k.id ? "bg-ui-active font-medium" : "hover:bg-ui-hover"}`}
                onClick={() => set({ category: k.id, custom: k.id === "custom" ? code : choice.custom })}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="rounded border border-ui-border bg-ui-bg px-2 py-1">
              <div className="text-xs text-ui-muted">{t("calc.fmt.sample")}</div>
              <div data-testid="format-preview" className="min-h-5 whitespace-pre font-mono" style={sample.color ? { color: sample.color } : undefined}>
                {sample.text}
              </div>
            </div>
            {(c === "number" || c === "currency" || c === "accounting" || c === "percentage" || c === "scientific") && decimals}
            {c === "number" && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={choice.thousands} onChange={(e) => set({ thousands: e.target.checked })} />
                {t("calc.fmt.thousands")}
              </label>
            )}
            {(c === "currency" || c === "accounting") && symbols}
            {(c === "number" || c === "currency") && negatives}
            {c === "date" && <CodeList label={t("calc.fmt.type")} codes={DATE_CODES} value={choice.date} onPick={(d) => set({ date: d })} />}
            {c === "time" && <CodeList label={t("calc.fmt.type")} codes={TIME_CODES} value={choice.time} onPick={(d) => set({ time: d })} />}
            {c === "fraction" && (
              <CodeList label={t("calc.fmt.type")} codes={FRACTION_CODES} value={choice.fraction} onPick={(d) => set({ fraction: d })} labels={(code) => t(`calc.fmt.fraction.${FRACTION_CODES.indexOf(code)}`)} />
            )}
            {c === "custom" && (
              <>
                <label className="flex flex-col gap-1">
                  {t("calc.fmt.code")}
                  <input className={`${FIELD} font-mono`} aria-label={t("calc.fmt.code")} value={choice.custom} onChange={(e) => set({ custom: e.target.value })} />
                </label>
                <CodeList label={t("calc.fmt.customList")} codes={customCodes(store.styles())} value={choice.custom} onPick={(d) => set({ custom: d })} />
              </>
            )}
            {c === "general" && <p className="text-xs text-ui-muted">{t("calc.fmt.generalNote")}</p>}
            {c === "text" && <p className="text-xs text-ui-muted">{t("calc.fmt.textNote")}</p>}
            {c === "accounting" && <p className="text-xs text-ui-muted">{t("calc.fmt.accountingNote")}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
