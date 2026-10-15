// Data validation on the client (pure): the validation of a cell, and
// Excel's Data Validation dialog (Settings / Input Message / Error Alert)
// as a form model converted to and from `DataValidation`.

import type { CompareOp } from "../generated/CompareOp";
import type { DataValidation } from "../generated/DataValidation";
import type { ErrorStyle } from "../generated/ErrorStyle";
import type { Rect } from "../generated/Rect";
import type { ValidationKind } from "../generated/ValidationKind";

/** The validation covering a cell (Excel keeps one per cell; the last listed wins). */
export function validationAt(list: readonly DataValidation[], row: number, col: number): DataValidation | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i]!;
    if (v.ranges.some((r) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1)) return v;
  }
  return undefined;
}

/** A cell shows the in-cell dropdown: a list validation with "In-cell dropdown" on. */
export const hasDropdown = (v: DataValidation | undefined): boolean => !!v && v.kind.type === "list" && v.showDropdown;

/** The input message of a selected cell (`null`: none to show). */
export function inputMessage(v: DataValidation | undefined): { title: string; message: string } | null {
  if (!v || !v.showInput) return null;
  const title = v.inputTitle ?? "";
  const message = v.inputMessage ?? "";
  return title === "" && message === "" ? null : { title, message };
}

export type AllowKind = ValidationKind["type"];
export const ALLOW_KINDS: AllowKind[] = ["any", "whole", "decimal", "list", "date", "time", "textLength", "custom"];
export const VALIDATION_OPS: CompareOp[] = ["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"];
export const ERROR_STYLES: ErrorStyle[] = ["stop", "warning", "information"];

export interface ValidationForm {
  allow: AllowKind;
  op: CompareOp;
  /** Minimum / value, and maximum (between), as typed. */
  f1: string;
  f2: string;
  /** List source: `a,b,c` or `=$A$1:$A$5`. */
  source: string;
  /** Custom formula (with or without `=`). */
  formula: string;
  allowBlank: boolean;
  showDropdown: boolean;
  showInput: boolean;
  inputTitle: string;
  inputMessage: string;
  showError: boolean;
  errorStyle: ErrorStyle;
  errorTitle: string;
  errorMessage: string;
}

/** Excel's defaults for cells without validation. */
export const DEFAULT_VALIDATION_FORM: ValidationForm = {
  allow: "any", op: "between", f1: "", f2: "", source: "", formula: "",
  allowBlank: true, showDropdown: true, showInput: true, inputTitle: "", inputMessage: "",
  showError: true, errorStyle: "stop", errorTitle: "", errorMessage: "",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Days since 1899-12-30 (Excel's serial) of a UTC date. */
const serialOf = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;

/**
 * A typed date or time as the serial number the core compares with
 * (`2024-01-31`, `31.1.2024`, `1/31/2024`, `13:30`, `13:30:15`); other
 * input (numbers, `=` formulas) is kept. `null` when it is not a date/time.
 */
export function dateTimeValue(input: string, kind: "date" | "time"): string | null {
  const s = input.trim();
  if (s.startsWith("=") || (s !== "" && Number.isFinite(Number(s)))) return s;
  if (kind === "time") {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!m) return null;
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
    return String(Math.round((secs / 86_400) * 1e10) / 1e10);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return String(serialOf(Number(m[1]), Number(m[2]), Number(m[3])));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return String(serialOf(Number(m[3]), Number(m[2]), Number(m[1])));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return String(serialOf(Number(m[3]), Number(m[1]), Number(m[2])));
  return null;
}

/** A serial as the dialog shows it again (ISO date / `hh:mm`). */
export function serialText(value: string, kind: "date" | "time"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `=${value}`;
  if (kind === "time") {
    const secs = Math.round((n % 1) * 86_400);
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}${secs % 60 ? `:${pad(secs % 60)}` : ""}`;
  }
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A criterion field for the other kinds: a number, or a formula shown with `=`. */
const shownValue = (v: string) => (v === "" || Number.isFinite(Number(v)) ? v : `=${v}`);

/** The dialog's form for a cell's validation (defaults without one). */
export function formFromValidation(v: DataValidation | undefined): ValidationForm {
  if (!v) return { ...DEFAULT_VALIDATION_FORM };
  const f: ValidationForm = {
    ...DEFAULT_VALIDATION_FORM,
    allow: v.kind.type,
    allowBlank: v.allowBlank,
    showDropdown: v.showDropdown,
    showInput: v.showInput,
    inputTitle: v.inputTitle ?? "",
    inputMessage: v.inputMessage ?? "",
    showError: v.showError,
    errorStyle: v.errorStyle,
    errorTitle: v.errorTitle ?? "",
    errorMessage: v.errorMessage ?? "",
  };
  const k = v.kind;
  if (k.type === "list") f.source = k.source.type === "literal" ? k.source.values.join(",") : `=${k.source.formula}`;
  else if (k.type === "custom") f.formula = `=${k.formula}`;
  else if (k.type !== "any") {
    const show = k.type === "date" || k.type === "time" ? (x: string) => serialText(x, k.type as "date" | "time") : shownValue;
    Object.assign(f, { op: k.op, f1: show(k.f1), f2: k.f2 !== undefined ? show(k.f2) : "" });
  }
  return f;
}

const needsTwo = (op: CompareOp) => op === "between" || op === "notBetween";
const opt = (s: string) => (s.trim() === "" ? {} : null);

/**
 * The validation of the form over `ranges`, or the catalog key of the
 * problem (`calc.dv.err.*`). `null` validation: "Any value" without an
 * input message – OK then removes the validation.
 */
export function validationFromForm(f: ValidationForm, ranges: Rect[]): { validation: DataValidation | null } | { error: string } {
  let kind: ValidationKind;
  switch (f.allow) {
    case "any":
      kind = { type: "any" };
      break;
    case "list": {
      const src = f.source.trim();
      if (src === "") return { error: "calc.dv.err.source" };
      if (src.startsWith("=")) {
        const formula = src.slice(1).trim();
        if (formula === "") return { error: "calc.dv.err.source" };
        kind = { type: "list", source: { type: "formula", formula } };
      } else {
        const values = src.split(",").map((x) => x.trim()).filter((x) => x !== "");
        if (values.length === 0) return { error: "calc.dv.err.source" };
        kind = { type: "list", source: { type: "literal", values } };
      }
      break;
    }
    case "custom": {
      const formula = f.formula.trim().replace(/^=/, "").trim();
      if (formula === "") return { error: "calc.dv.err.formula" };
      kind = { type: "custom", formula };
      break;
    }
    default: {
      const conv = (x: string): string | null => {
        const s = x.trim();
        if (s === "") return null;
        if (f.allow === "date" || f.allow === "time") return dateTimeValue(s, f.allow)?.replace(/^=/, "") ?? null;
        if (s.startsWith("=")) return s.slice(1).trim() || null;
        return Number.isFinite(Number(s)) ? s : null;
      };
      const f1 = conv(f.f1);
      if (f1 === null) return { error: "calc.dv.err.value" };
      if (needsTwo(f.op)) {
        const f2 = conv(f.f2);
        if (f2 === null) return { error: "calc.dv.err.value" };
        kind = { type: f.allow, op: f.op, f1, f2 };
      } else kind = { type: f.allow, op: f.op, f1 };
    }
  }
  const text = (s: string) => (s.trim() === "" ? undefined : s);
  if (kind.type === "any" && opt(f.inputTitle) && opt(f.inputMessage)) return { validation: null };
  const v: DataValidation = {
    ranges: ranges.map((r) => ({ ...r })),
    kind,
    allowBlank: f.allowBlank,
    showDropdown: kind.type === "list" ? f.showDropdown : false,
    showInput: f.showInput,
    showError: f.showError,
    errorStyle: f.errorStyle,
  };
  const extra = { inputTitle: text(f.inputTitle), inputMessage: text(f.inputMessage), errorTitle: text(f.errorTitle), errorMessage: text(f.errorMessage) };
  for (const [k, x] of Object.entries(extra)) if (x !== undefined) (v as Record<string, unknown>)[k] = x;
  return { validation: v };
}
