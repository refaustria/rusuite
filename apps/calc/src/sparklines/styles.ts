// The 36 styles of the Sparkline Style gallery: a port of
// `model_sheet::sparkline_style` (6 rows × the six accents).

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { SparklineColors } from "../generated/SparklineColors";

type Slot = "dark1" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6";
const ACCENTS: Slot[] = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

const theme = (slot: Slot, tint: number): Color => ({ kind: "theme", value: { slot, tint } });
const BLACK: Color = { kind: "rgb", value: "000000" };

/** Style `n` (1..36) of the gallery. */
export function sparklineStyle(n: number): SparklineColors {
  const s = Math.min(36, Math.max(1, Math.round(n))) - 1;
  const row = Math.floor(s / 6);
  const c = s % 6;
  const a = (tint: number) => theme(ACCENTS[c]!, tint);
  const next = (tint: number) => theme(ACCENTS[(c + 1) % 6]!, tint);
  const rows: [Color, Color, Color, Color, Color][] = [
    [a(-0.5), next(0), a(-0.5), a(0.4), a(0)],
    [a(-0.25), next(0), a(-0.25), a(0.4), a(-0.5)],
    [a(0), next(0), a(-0.25), a(0.4), a(-0.5)],
    [a(0.4), a(-0.5), a(-0.5), a(-0.25), a(-0.5)],
    [a(0), BLACK, BLACK, BLACK, BLACK],
    [theme("dark1", 0.35), a(0), a(0), a(0), a(0)],
  ];
  const [series, negative, markers, ends, extremes] = rows[row]!;
  return { series, negative, axis: BLACK, markers, first: ends, last: ends, high: extremes, low: extremes };
}

/** The gallery style the colours match (`null`: custom colours). */
export function styleOf(colors: SparklineColors | undefined): number | null {
  const key = JSON.stringify(colors ?? sparklineStyle(1));
  for (let n = 1; n <= 36; n++) if (JSON.stringify(sparklineStyle(n)) === key) return n;
  return null;
}
