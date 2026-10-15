// The File › Print page of the backstage (Office layout): Print button,
// the note that copies and the printer are chosen in the system dialog,
// the settings (app-specific ones, page range, orientation, paper,
// margins, scaling …) on the left and the preview on the right.

import { useId, useState, type ReactNode } from "react";
import { FOCUS_RING } from "../Popover";
import { applyPageRange, parsePageRange, type PrintChoice, type PrintDoc } from "../print";
import { RibbonIcon } from "../ribbon/icons";
import { PrintPreview } from "./PrintPreview";
import { useT } from "../i18n/react";

const FIELD = "flex flex-col gap-0.5 text-sm";
const INPUT = `h-7 rounded border border-ui-border bg-ui-bg px-1.5 text-sm text-ui-fg ${FOCUS_RING}`;

/** A labelled select of the print settings. */
export function PrintSelect({ label, value, choices, onChange, disabled }: { label: string; value: string; choices: PrintChoice[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className={FIELD}>
      <span className="text-xs text-ui-muted">{label}</span>
      <select aria-label={label} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A labelled checkbox of the print settings. */
export function PrintCheck({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A labelled number field (committed on change when it parses within `min..max`). */
export function PrintNumber({ label, value, min, max, onChange, suffix, disabled }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean }) {
  return (
    <label className={FIELD}>
      <span className="text-xs text-ui-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          aria-label={label}
          className={`${INPUT} w-20`}
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
        />
        {suffix && <span className="text-xs text-ui-muted">{suffix}</span>}
      </span>
    </label>
  );
}

/** A labelled text field. */
export function PrintText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className={FIELD}>
      <span className="text-xs text-ui-muted">{label}</span>
      <input type="text" aria-label={label} className={INPUT} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A titled group of settings. */
export function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 border-t border-ui-border pt-2">
      <legend className="pr-2 text-xs font-semibold uppercase tracking-wide text-ui-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

export interface PrintPanelProps {
  /** The whole document (all pages); the range is applied here. */
  doc: PrintDoc | null;
  busy?: boolean;
  error?: string | null;
  /** `""` = all pages, else e.g. `1-3,5`. */
  range: string;
  onRange: (range: string) => void;
  /** Prints the document limited to the range (system print dialog). */
  onPrint: (doc: PrintDoc) => Promise<void> | void;
  /** Settings above the page range (Calc: what to print). */
  before?: ReactNode;
  /** Settings below the page range (orientation, paper, margins, scaling, app options). */
  children?: ReactNode;
  /** Disables printing with this reason (e.g. no slides). */
  disabledReason?: string;
}

export function PrintPanel({ doc, busy, error, range, onRange, onPrint, before, children, disabledReason }: PrintPanelProps) {
  const t = useT();
  const [custom, setCustom] = useState(range !== "");
  const [text, setText] = useState(range);
  const [printing, setPrinting] = useState(false);
  const id = useId();
  const total = doc?.pages.length ?? 0;
  const parsed = range === "" ? null : parsePageRange(range, total);
  const rangeError = parsed && "error" in parsed && doc ? parsed.error : null;
  const shown = doc ? applyPageRange(doc, range) : null;
  const blocked = disabledReason ?? (error ? error : rangeError ? rangeError : !shown || shown.pages.length === 0 ? (busy ? t("print.preparing") : t("print.nothing")) : undefined);

  const print = async () => {
    if (!shown || blocked || printing) return;
    setPrinting(true);
    try {
      await onPrint(shown);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-6" data-testid="print-panel">
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-auto pr-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-autofocus
            data-testid="print-button"
            disabled={!!blocked}
            aria-busy={printing || undefined}
            title={blocked ?? t("print.buttonTip")}
            className={`flex h-16 w-20 flex-col items-center justify-center gap-1 rounded border border-ui-border bg-ui-panel text-sm hover:bg-ui-hover disabled:opacity-50 ${FOCUS_RING}`}
            onClick={() => void print()}
          >
            <RibbonIcon name="print" size={24} />
            {t("backstage.print")}
          </button>
          <p className="text-xs text-ui-muted" data-testid="print-os-note">
            {t("print.osNote")}
          </p>
        </div>
        {(error || rangeError || disabledReason) && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="print-error">
            {disabledReason ?? error ?? rangeError}
          </p>
        )}
        {before}
        <PrintSection title={t("print.pages")}>
          <div role="radiogroup" aria-label={t("print.pages")} className="flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-range`}
                checked={!custom}
                onChange={() => {
                  setCustom(false);
                  onRange("");
                }}
              />
              {t("print.allPages")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-range`}
                checked={custom}
                onChange={() => {
                  setCustom(true);
                  onRange(text);
                }}
              />
              {t("print.pages")}
              <input
                type="text"
                aria-label={t("print.pageRange")}
                placeholder={t("print.pageRangeHint")}
                className={`${INPUT} w-32`}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setCustom(true);
                  onRange(e.target.value);
                }}
              />
            </label>
          </div>
        </PrintSection>
        {children}
      </div>
      <PrintPreview doc={shown} busy={busy} />
    </div>
  );
}
