// Pure helpers of the grid's touch gestures (P10-M3): pinch zoom, double taps, the handle geometry.

/** Hit area of the selection handles and the touch fill handle (CSS px at any zoom). */
export const TOUCH_HANDLE_HIT = 44;
/** Visible diameter of a selection handle. */
export const TOUCH_HANDLE_DOT = 24;
/** The touch fill handle sits this far right of and below the selection's bottom-right corner (its own 44 px target, clear of the end handle). */
export const TOUCH_FILL_OFFSET = 44;
/** A handle dragged this close to the cell area's edge scrolls the grid. */
export const TOUCH_EDGE = 28;
/** Pinch zoom limits (fractions). */
export const PINCH_MIN = 0.5;
export const PINCH_MAX = 2;
/** Two taps closer than this (ms, px) are a double tap. */
export const DOUBLE_TAP_MS = 400;
export const DOUBLE_TAP_SLOP = 24;

/** The zoom a pinch gives: `start` scaled by the distance ratio, clamped to 50 – 200 % and rounded to whole percent. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.round(Math.max(PINCH_MIN, Math.min(PINCH_MAX, z)) * 100) / 100;
}

export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface Tap {
  key: string;
  x: number;
  y: number;
  at: number;
}

/** Whether `tap` completes a double tap with `prev` (same target key, close in time and place). */
export function isDoubleTap(prev: Tap | null, tap: Tap): boolean {
  return !!prev && prev.key === tap.key && tap.at - prev.at <= DOUBLE_TAP_MS && Math.hypot(tap.x - prev.x, tap.y - prev.y) <= DOUBLE_TAP_SLOP;
}

/** Auto-scroll step (px) for a pointer at `pos` in an area `[0, size)`: negative near the start, positive near the end. */
export function edgeScroll(pos: number, size: number, step: number): number {
  if (size <= 2 * TOUCH_EDGE) return 0;
  if (pos < TOUCH_EDGE) return -step;
  if (pos > size - TOUCH_EDGE) return step;
  return 0;
}

/** The caret one token left (`dir` −1) or right (1) of `caret` in a formula: token starts and ends are the stops. */
export function tokenStep(tokens: { start: number; end: number }[], length: number, caret: number, dir: -1 | 1): number {
  const stops = new Set<number>([0, length]);
  for (const t of tokens) {
    stops.add(t.start);
    stops.add(t.end);
  }
  const sorted = [...stops].filter((p) => p >= 0 && p <= length).sort((a, b) => a - b);
  if (dir < 0) return [...sorted].reverse().find((p) => p < caret) ?? 0;
  return sorted.find((p) => p > caret) ?? length;
}
