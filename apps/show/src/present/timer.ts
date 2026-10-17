// The presenter view's timers (P9-S5), pure: the total time of the show
// and the time on the current slide, both pausable (PowerPoint's Pause
// / Resume timer), resettable, the slide time restarting on every slide
// change. Times are `Date.now()` milliseconds.

export interface ShowTimer {
  /** When the show (or the last reset) started. */
  start: number;
  /** When the current slide was entered (or the slide time was reset). */
  slideStart: number;
  /** Paused since (`null` = running). */
  pausedAt: number | null;
  /** Paused time since `start`. */
  pausedMs: number;
  /** Paused time since `slideStart`. */
  slidePausedMs: number;
}

/** A running timer started at `now`. */
export const startTimer = (now: number): ShowTimer => ({ start: now, slideStart: now, pausedAt: null, pausedMs: 0, slidePausedMs: 0 });

/** The time paused so far, counting a pause still going on. */
const pausing = (t: ShowTimer, now: number) => (t.pausedAt === null ? 0 : Math.max(0, now - t.pausedAt));

/** Total time of the show (without pauses). */
export const totalElapsed = (t: ShowTimer, now: number): number => Math.max(0, now - t.start - t.pausedMs - pausing(t, now));

/** Time on the current slide (without pauses). */
export const slideElapsed = (t: ShowTimer, now: number): number => Math.max(0, now - t.slideStart - t.slidePausedMs - pausing(t, now));

/** Pauses (no-op when paused). */
export const pauseTimer = (t: ShowTimer, now: number): ShowTimer => (t.pausedAt === null ? { ...t, pausedAt: now } : t);

/** Resumes (no-op when running): the pause does not count. */
export function resumeTimer(t: ShowTimer, now: number): ShowTimer {
  if (t.pausedAt === null) return t;
  const p = pausing(t, now);
  return { ...t, pausedAt: null, pausedMs: t.pausedMs + p, slidePausedMs: t.slidePausedMs + p };
}

/** Pause ↔ resume. */
export const toggleTimer = (t: ShowTimer, now: number): ShowTimer => (t.pausedAt === null ? pauseTimer(t, now) : resumeTimer(t, now));

/** A new slide: its time starts at 0 (still paused when paused). */
export const nextSlideTimer = (t: ShowTimer, now: number): ShowTimer => ({ ...t, slideStart: now, slidePausedMs: 0, pausedAt: t.pausedAt === null ? null : now, pausedMs: t.pausedMs + pausing(t, now) });

/** Reset: both times start again at 0, keeping the paused state. */
export const resetTimer = (t: ShowTimer, now: number): ShowTimer => ({ ...startTimer(now), pausedAt: t.pausedAt === null ? null : now });
