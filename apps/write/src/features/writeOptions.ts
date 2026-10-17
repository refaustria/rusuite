// File › Options of Write (this browser only, ADR 0009): the ruler's
// measurement unit (Advanced › Show measurements in units of: cm in metric
// locales, inches in en-US, as Word) and the AutoCorrect toggles of
// Proofing › AutoCorrect Options.

export type RulerUnit = "cm" | "in";

export interface AutoCorrectOptions {
  /** "Straight quotes" with “smart quotes”. */
  smartQuotes: boolean;
  /** Hyphens (--) with dash (–, —). */
  dashes: boolean;
  /** Replace text as you type: (c) ©, (r) ®, (tm) ™, ... … */
  replaceText: boolean;
  /** Ordinals (1st) with superscript – off by default (owner rule for this cycle). */
  ordinals: boolean;
}

export interface WriteOptions {
  /** `null`: from the locale. */
  rulerUnit: RulerUnit | null;
  autoCorrect: AutoCorrectOptions;
}

export const DEFAULT_AUTOCORRECT: AutoCorrectOptions = { smartQuotes: true, dashes: true, replaceText: true, ordinals: false };
export const DEFAULT_OPTIONS: WriteOptions = { rulerUnit: null, autoCorrect: DEFAULT_AUTOCORRECT };

const KEY = "rusuite.write.options";

type Store = Pick<Storage, "getItem" | "setItem">;

function storage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved options (defaults for anything missing or unreadable). */
export function loadOptions(s: Store | null = storage()): WriteOptions {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? "{}") as Partial<WriteOptions>;
    const unit = v.rulerUnit === "cm" || v.rulerUnit === "in" ? v.rulerUnit : null;
    const ac = { ...DEFAULT_AUTOCORRECT };
    for (const k of Object.keys(ac) as (keyof AutoCorrectOptions)[]) if (typeof v.autoCorrect?.[k] === "boolean") ac[k] = v.autoCorrect[k];
    return { rulerUnit: unit, autoCorrect: ac };
  } catch {
    return { ...DEFAULT_OPTIONS, autoCorrect: { ...DEFAULT_AUTOCORRECT } };
  }
}

export function saveOptions(o: WriteOptions, s: Store | null = storage()): void {
  try {
    s?.setItem(KEY, JSON.stringify(o));
  } catch {
    // private mode: not remembered
  }
}

/** The unit Word uses for a locale: inches in the US (and Liberia, Myanmar; a bare "en" counts as US), cm elsewhere. */
export function unitForLocale(locale: string | null | undefined): RulerUnit {
  const l = (locale ?? "").toLowerCase();
  return l === "en" || /-(us|lr|mm)$/.test(l) ? "in" : "cm";
}

/** The ruler unit in effect. */
export const rulerUnitOf = (o: WriteOptions, locale: string | null | undefined): RulerUnit => o.rulerUnit ?? unitForLocale(locale);

/** Twips per unit. */
export const TWIPS_PER_UNIT: Record<RulerUnit, number> = { cm: 1440 / 2.54, in: 1440 };
