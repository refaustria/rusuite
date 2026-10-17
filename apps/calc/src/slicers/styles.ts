// Excel's built-in slicer styles (P9-C2): Light 1–6 and Dark 1–6 on the
// accent colours 1–6, Other 1–2 neutral. The colours of the frame, the
// caption and the buttons (selected, with data, without data).

import { applyTint, OFFICE_THEME } from "@rusuite/ui-shared";

export interface SlicerColors {
  frame: string;
  background: string;
  caption: string;
  /** Selected button. */
  on: string;
  onText: string;
  /** Unselected button with data. */
  off: string;
  offText: string;
  /** Text of buttons without data. */
  noData: string;
  border: string;
}

export const DEFAULT_SLICER_STYLE = "SlicerStyleLight1";

/** Every built-in style in the gallery's order. */
export const SLICER_STYLES: string[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => `SlicerStyleLight${n}`),
  "SlicerStyleOther1",
  "SlicerStyleOther2",
  ...[1, 2, 3, 4, 5, 6].map((n) => `SlicerStyleDark${n}`),
];

const ACCENTS = [OFFICE_THEME.accent1, OFFICE_THEME.accent2, OFFICE_THEME.accent3, OFFICE_THEME.accent4, OFFICE_THEME.accent5, OFFICE_THEME.accent6];
const hex = (h: string) => `#${h.toUpperCase()}`;

/** `Light 1`, `Other 2`, `Dark 6` (`null` for unknown names). */
export function slicerStyleNumber(id: string): { family: "light" | "other" | "dark"; n: number } | null {
  const m = /^SlicerStyle(Light|Other|Dark)([1-6])$/.exec(id);
  if (!m) return null;
  const family = m[1]!.toLowerCase() as "light" | "other" | "dark";
  const n = Number(m[2]);
  return family === "other" && n > 2 ? null : { family, n };
}

/** The colours of a style (unknown names: Light 1). */
export function slicerColors(id: string): SlicerColors {
  const s = slicerStyleNumber(id) ?? { family: "light" as const, n: 1 };
  if (s.family === "other") {
    return s.n === 1
      ? { frame: "#BFBFBF", background: "#FFFFFF", caption: "#000000", on: "#D9D9D9", onText: "#000000", off: "#FFFFFF", offText: "#000000", noData: "#A6A6A6", border: "#BFBFBF" }
      : { frame: "#7F7F7F", background: "#F2F2F2", caption: "#000000", on: "#7F7F7F", onText: "#FFFFFF", off: "#FFFFFF", offText: "#000000", noData: "#A6A6A6", border: "#7F7F7F" };
  }
  const a = ACCENTS[s.n - 1]!;
  if (s.family === "light") {
    return {
      frame: hex(applyTint(a, 0.4)), background: "#FFFFFF", caption: "#000000",
      on: hex(applyTint(a, 0.6)), onText: "#000000", off: "#FFFFFF", offText: "#000000", noData: "#A6A6A6", border: hex(applyTint(a, 0.4)),
    };
  }
  return {
    frame: hex(a), background: hex(applyTint(a, 0.8)), caption: "#000000",
    on: hex(a), onText: "#FFFFFF", off: hex(applyTint(a, 0.6)), offText: "#000000", noData: "#7F7F7F", border: hex(a),
  };
}
