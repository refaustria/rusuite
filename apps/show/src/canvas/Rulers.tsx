// View › Ruler (P8-28): a horizontal ruler above and a vertical one left of
// the slide, in inches or centimetres by UI language, counted from the
// slide centre like PowerPoint's, with a marker at the pointer's position.

import type { SlideSize } from "../generated/SlideSize";
import { formatNumber } from "@rusuite/ui-shared";
import { rulerTicks, type RulerUnit } from "./guides";
import { useT } from "../i18n";

/** Thickness of a ruler in CSS px. */
export const RULER_PX = 20;

function Ruler({ length, scale, unit, along, cursor }: { length: number; scale: number; unit: RulerUnit; along: "x" | "y"; cursor: number | null }) {
  const t = useT();
  const ticks = rulerTicks(length, unit);
  const px = (length / 9525) * scale;
  const h = along === "x";
  const tickLen = (k: string) => (k === "major" ? 8 : k === "half" ? 5 : 3);
  return (
    <svg
      role="img"
      aria-label={h ? t("show.ruler.horizontal") : t("show.ruler.vertical")}
      data-testid={h ? "ruler-h" : "ruler-v"}
      width={h ? px : RULER_PX}
      height={h ? RULER_PX : px}
      className="block bg-ui-panel text-ui-muted"
    >
      {ticks.map((k, i) => {
        const at = k.at * scale;
        const l = tickLen(k.kind);
        return h ? (
          <g key={i}>
            <line x1={at} x2={at} y1={RULER_PX - l} y2={RULER_PX} stroke="currentColor" strokeWidth={1} />
            {k.label !== undefined && (
              <text x={at} y={9} fontSize={9} textAnchor="middle" fill="currentColor">
                {k.label}
              </text>
            )}
          </g>
        ) : (
          <g key={i}>
            <line y1={at} y2={at} x1={RULER_PX - l} x2={RULER_PX} stroke="currentColor" strokeWidth={1} />
            {k.label !== undefined && (
              <text x={8} y={at + 3} fontSize={9} textAnchor="middle" fill="currentColor">
                {k.label}
              </text>
            )}
          </g>
        );
      })}
      {cursor !== null && (h ? <line data-testid="ruler-cursor" x1={cursor * scale} x2={cursor * scale} y1={0} y2={RULER_PX} stroke="#c2410c" /> : <line data-testid="ruler-cursor" y1={cursor * scale} y2={cursor * scale} x1={0} x2={RULER_PX} stroke="#c2410c" />)}
    </svg>
  );
}

/** Both rulers around the stage: `children` is the stage (its size = the slide at `scale`). */
export function RulerFrame({
  size, scale, unit, cursor, children,
}: { size: SlideSize; scale: number; unit: RulerUnit; cursor: { x: number; y: number } | null; children: React.ReactNode }) {
  const t = useT();
  const pos = cursor ? `${formatNumber(cursor.x / (unit === "cm" ? 37.795 : 96), { maximumFractionDigits: 2 })} × ${formatNumber(cursor.y / (unit === "cm" ? 37.795 : 96), { maximumFractionDigits: 2 })} ${unit}` : "";
  return (
    <div className="grid" style={{ gridTemplateColumns: `${RULER_PX}px auto`, gridTemplateRows: `${RULER_PX}px auto` }} data-testid="ruler-frame">
      <span className="bg-ui-panel" title={t("show.ruler.position")} data-testid="ruler-position" aria-label={pos || undefined} />
      <Ruler length={size.width} scale={scale} unit={unit} along="x" cursor={cursor?.x ?? null} />
      <Ruler length={size.height} scale={scale} unit={unit} along="y" cursor={cursor?.y ?? null} />
      <div>{children}</div>
    </div>
  );
}
