// Text layout for the cell canvas (pure, so it is testable without a
// canvas): wrapping, Excel's scientific form and `####` for numbers that do
// not fit and the
// line height of wrapped text.

/** Measures `text` in the canvas font `font`, CSS px. */
export type Measure = (text: string, font: string) => number;

/** Font size in px from a canvas font shorthand (`bold 14.67px "Calibri", …`). */
export function fontSizeOf(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 14.67;
}

/** A canvas-free estimate (average glyph ≈ 0.55 em); the grid passes a real measure. */
export const approxMeasure: Measure = (text, font) => text.length * fontSizeOf(font) * 0.55;

/** Line height of wrapped text: 15 pt per line for 11 pt Calibri, as in Excel. */
export function lineHeightPx(font: string): number {
  return Math.round(fontSizeOf(font) * 1.364);
}

/**
 * Greedy word wrap of `text` into lines no wider than `maxWidth`:
 * explicit `\n` breaks first, then breaks at spaces, and words longer
 * than a line are split by characters.
 */
export function wrapLines(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const out: string[] = [];
  const width = Math.max(1, maxWidth);
  for (const para of text.split("\n")) {
    const words = para.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (measure(candidate, font) <= width) {
        line = candidate;
        continue;
      }
      if (line !== "") out.push(line);
      // The word alone: split when it is wider than a line.
      let rest = word;
      while (rest.length > 1 && measure(rest, font) > width) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n), font) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** The significant digits a displayed number keeps (`0.00012` → 2, `1.23E-05` → 3, `120` → 3). */
export function significantDigits(text: string): number {
  const mant = text.replace(/^-/, "").split("E")[0]!.replace(".", "");
  const digits = mant.replace(/^0+/, "");
  return Math.max(1, digits.length);
}

/** Excel's scientific General form of `n` with at most `digits` decimals: `1.2E+12`, `-5E-07`. */
export function scientific(n: number, digits: number): string {
  const [mant, exp] = n.toExponential(digits).split("e") as [string, string];
  const m = mant.includes(".") ? mant.replace(/\.?0+$/, "") : mant;
  const e = Number(exp);
  return `${m}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

/**
 * The text a number cell shows in `width` px: as is when it fits; a
 * plain decimal loses decimals until it fits; a General number
 * (`general`) then switches to the scientific form (`1.2E+12`) with as
 * many digits as fit; otherwise Excel's `#` fill.
 */
export function fitNumber(display: string, width: number, font: string, measure: Measure, general = false): string {
  if (measure(display, font) <= width) return display;
  const m = /^(-?\d+)\.(\d+)$/.exec(display);
  const n = Number(display);
  let decimal: string | null = null;
  if (m) {
    for (let d = m[2].length - 1; d >= 0; d--) {
      const t = n.toFixed(d);
      // A General number does not round away all its digits (0.00001234 → 1.2E-05, not 0).
      if (general && Number(t) === 0 && n !== 0) break;
      if (measure(t, font) <= width) {
        decimal = t;
        break;
      }
    }
    if (decimal !== null && !general) return decimal;
  }
  if (general && display.trim() !== "" && Number.isFinite(n) && n !== 0) {
    for (let d = 14; d >= 0; d--) {
      const t = scientific(n, d);
      if (measure(t, font) <= width) {
        // General shows whichever form keeps more significant digits (Excel): 3.141593, but 1.23E-05 for 0.0000123456.
        return decimal !== null && significantDigits(decimal) >= significantDigits(t) ? decimal : t;
      }
    }
  }
  if (decimal !== null) return decimal;
  const hash = Math.max(1, measure("#", font));
  return "#".repeat(Math.max(1, Math.floor(width / hash)));
}
