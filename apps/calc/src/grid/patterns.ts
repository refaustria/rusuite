// Excel's pattern fills (Format Cells › Fill › Pattern Style, P9-C1):
// one 4×4 tile per `patternFill/@patternType`, drawn in the pattern
// colour over the background colour on the canvas, in the Fill tab's
// sample and in print (an SVG data URL).

import type { Color } from "@rusuite/ui-shared";
import type { PatternFill } from "../generated/PatternFill";
import type { PatternType } from "../generated/PatternType";
import { colorCss } from "./style";

/** Excel's Pattern Style list order (after Solid). */
export const PATTERN_TYPES: PatternType[] = [
  "darkGray", "mediumGray", "lightGray", "gray125", "gray0625",
  "darkHorizontal", "darkVertical", "darkDown", "darkUp", "darkGrid", "darkTrellis",
  "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis",
];

export const PATTERN_TILE = 4;

const mod = (n: number) => ((n % 4) + 4) % 4;

/** Whether pixel `(x, y)` of the tile shows the pattern colour. */
export function patternBit(p: PatternType, x: number, y: number): boolean {
  switch (p) {
    case "darkGray":
      return !(x % 2 === 1 && y % 2 === 1);
    case "mediumGray":
      return (x + y) % 2 === 0;
    case "lightGray":
      return x % 2 === 0 && y % 2 === 0;
    case "gray125":
      return y % 2 === 0 && mod(x + (y % 4 === 0 ? 0 : 2)) === 0;
    case "gray0625":
      return x === 0 && y === 0;
    case "darkHorizontal":
      return y < 2;
    case "darkVertical":
      return x < 2;
    case "darkDown":
      return mod(x - y) < 2;
    case "darkUp":
      return mod(x + y) < 2;
    case "darkGrid":
      return (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
    case "darkTrellis":
      return mod(x + y) < 2 || mod(x - y) < 2;
    case "lightHorizontal":
      return y === 0;
    case "lightVertical":
      return x === 0;
    case "lightDown":
      return mod(x - y) === 0;
    case "lightUp":
      return mod(x + y) === 0;
    case "lightGrid":
      return x === 0 || y === 0;
    case "lightTrellis":
      return mod(x + y) === 0 || mod(x - y) === 0;
  }
}

/** Share of pattern-coloured pixels (tests, swatches). */
export function patternCoverage(p: PatternType): number {
  let n = 0;
  for (let y = 0; y < PATTERN_TILE; y++) for (let x = 0; x < PATTERN_TILE; x++) if (patternBit(p, x, y)) n++;
  return n / (PATTERN_TILE * PATTERN_TILE);
}

/** The CSS colours of a pattern fill: automatic = black pattern on white. */
export function patternColors(fill: Pick<PatternFill, "fg" | "bg">): { fg: string; bg: string } {
  return { fg: colorCss((fill.fg ?? undefined) as Color | undefined) ?? "#000000", bg: colorCss((fill.bg ?? undefined) as Color | undefined) ?? "#ffffff" };
}

/** A tile as SVG markup. */
export function patternSvg(p: PatternType, fg: string, bg: string): string {
  let rects = "";
  for (let y = 0; y < PATTERN_TILE; y++) for (let x = 0; x < PATTERN_TILE; x++) if (patternBit(p, x, y)) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PATTERN_TILE}" height="${PATTERN_TILE}" shape-rendering="crispEdges"><rect width="${PATTERN_TILE}" height="${PATTERN_TILE}" fill="${bg}"/><g fill="${fg}">${rects}</g></svg>`;
}

/** CSS background of a pattern fill (Fill tab sample, print). */
export function patternBackground(fill: PatternFill): { backgroundColor: string; backgroundImage: string } {
  const { fg, bg } = patternColors(fill);
  return { backgroundColor: bg, backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(patternSvg(fill.pattern, fg, bg))}")` };
}

const tiles = new Map<string, CanvasPattern | null>();

/** A canvas pattern for `ctx` (cached per pattern and colours; `null` without a canvas). */
export function canvasPattern(ctx: CanvasRenderingContext2D, p: PatternType, fg: string, bg: string): CanvasPattern | null {
  const key = `${p}|${fg}|${bg}`;
  if (tiles.has(key)) return tiles.get(key)!;
  const tile = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const tctx = tile?.getContext("2d");
  let out: CanvasPattern | null = null;
  if (tile && tctx) {
    tile.width = tile.height = PATTERN_TILE;
    tctx.fillStyle = bg;
    tctx.fillRect(0, 0, PATTERN_TILE, PATTERN_TILE);
    tctx.fillStyle = fg;
    for (let y = 0; y < PATTERN_TILE; y++) for (let x = 0; x < PATTERN_TILE; x++) if (patternBit(p, x, y)) tctx.fillRect(x, y, 1, 1);
    out = ctx.createPattern(tile, "repeat");
  }
  tiles.set(key, out);
  return out;
}
