// Playback of a slide's animations and of slide transitions (P8-8), as
// pure functions: the click groups of a slide with their timelines, the
// shapes' visibility / scale after a number of groups (so ← can rebuild
// the state of any step), the attributes of an animated shape at a moment
// of its effect, the CSS keyframes of a transition and the auto-advance
// delay. `present/AnimatedSlide.tsx` drives the Konva nodes with these.

import type { Animation } from "../generated/Animation";
import type { Direction } from "../generated/Direction";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import type { Transition } from "../generated/Transition";
import { effectiveAnimationDirection, effectiveTransitionDirection } from "./effects";

/** One animation on its group's timeline (ms from the group's start). */
export interface TimedAnimation {
  anim: Animation;
  start: number;
  end: number;
}

/** Animations that start together on one click (or automatically: group 0). */
export interface ClickGroup {
  items: TimedAnimation[];
  /** When the last animation of the group ends. */
  durationMs: number;
  /** A media clip this click starts (clips "In Click Sequence": one click each, after the animations). */
  media?: NodeId;
}

/** The audio / video shapes of a slide that start "In Click Sequence", in z-order (as the core writes them into the timing). */
export function sequenceMedia(slide: Pick<Slide, "shapes">): NodeId[] {
  return (slide.shapes ?? []).filter((s) => s.kind.kind === "media" && s.kind.value.start === "inClickSequence").map((s) => s.id);
}

/** The effective duration of an animation (Appear is instant). */
export const animDuration = (a: Animation): number => (a.effect === "appear" ? 0 : a.durationMs);

/**
 * The groups of a slide: `[0]` holds the animations before the first On
 * Click one (they play when the slide appears; often empty), then one
 * group per On Click animation with the With / After Previous ones that
 * follow it. With Previous starts with the previous animation, After
 * Previous when it ends; each adds its own delay.
 */
export function clickGroups(slide: Pick<Slide, "animations"> & Partial<Pick<Slide, "shapes">>): ClickGroup[] {
  const groups: ClickGroup[] = [{ items: [], durationMs: 0 }];
  let prevTrigger = 0;
  let prevEnd = 0;
  for (const a of slide.animations ?? []) {
    if (a.trigger === "onClick") {
      groups.push({ items: [], durationMs: 0 });
      prevTrigger = 0;
      prevEnd = 0;
    }
    const g = groups[groups.length - 1]!;
    const trigger = a.trigger === "afterPrevious" ? prevEnd : a.trigger === "withPrevious" ? prevTrigger : 0;
    const start = trigger + a.delayMs;
    const end = start + animDuration(a);
    g.items.push({ anim: a, start, end });
    g.durationMs = Math.max(g.durationMs, end);
    prevTrigger = trigger;
    prevEnd = end;
  }
  for (const media of sequenceMedia({ shapes: slide.shapes ?? [] })) groups.push({ items: [], durationMs: 0, media });
  return groups;
}

/** Click steps of a slide: the On Click animations, then one per clip "In Click Sequence". */
export const clickSteps = (slide: Pick<Slide, "animations"> & Partial<Pick<Slide, "shapes">>): number =>
  (slide.animations ?? []).filter((a) => a.trigger === "onClick").length + sequenceMedia({ shapes: slide.shapes ?? [] }).length;

/** The clips "In Click Sequence" whose click has come once `step` click steps are done. */
export function startedMedia(slide: Pick<Slide, "animations" | "shapes">, step: number): NodeId[] {
  return clickGroups(slide)
    .slice(1, step + 1)
    .flatMap((g) => (g.media !== undefined ? [g.media] : []));
}

/** What animations changed on a shape. */
export interface ShapeState {
  visible: boolean;
  /** Scale from Grow/Shrink (1 = unchanged). */
  scale: number;
}

/**
 * The animated shapes' state once the first `groupsDone` groups have
 * played (0 = the slide before anything). A shape whose first animation is
 * an entrance starts hidden; entrances show, exits hide, Grow/Shrink
 * scales by 150 %.
 */
export function shapeStates(slide: Pick<Slide, "animations">, groupsDone: number): Map<NodeId, ShapeState> {
  const out = new Map<NodeId, ShapeState>();
  for (const a of slide.animations ?? []) if (!out.has(a.shape)) out.set(a.shape, { visible: a.kind !== "entrance", scale: 1 });
  clickGroups(slide)
    .slice(0, Math.max(0, groupsDone))
    .forEach((g) => g.items.forEach(({ anim }) => applyEnd(out, anim)));
  return out;
}

function applyEnd(states: Map<NodeId, ShapeState>, a: Animation) {
  const s = states.get(a.shape)!;
  if (a.kind === "entrance") s.visible = true;
  else if (a.kind === "exit") s.visible = false;
  else if (a.effect === "growShrink") s.scale *= 1.5;
}

/** The hidden shapes of a state (sorted; the show's `data-hidden-shapes`). */
export const hiddenShapes = (states: Map<NodeId, ShapeState>): NodeId[] =>
  [...states].filter(([, s]) => !s.visible).map(([id]) => id).sort((a, b) => a - b);

// ----- one effect frame ---------------------------------------------------------------------

/** A shape node's resting attributes (slide px; position = box centre). */
export interface NodeBase {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

export interface FrameAttrs {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Clip in the node's local box (wipe); absent = none. */
  clip?: { x: number; y: number; width: number; height: number };
}

const UNIT: Record<string, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
  leftUp: [-1, -1],
  rightUp: [1, -1],
  leftDown: [-1, 1],
  rightDown: [1, 1],
};

/** Unit vector of a direction (`down` = +y); `[0, 0]` for the others. */
export const dirVector = (d: Direction | undefined): [number, number] => (d && UNIT[d]) || [0, 0];

const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const clamp01 = (p: number) => Math.max(0, Math.min(1, p));

/**
 * The attributes of `a`'s shape at progress `p` (0…1) of the effect.
 * Entrance effects go from the effect's start to the resting state, exit
 * effects the other way; emphasis spins (one turn) or grows to 150 %.
 * Fly comes from (goes to) outside the slide on the effect's side; wipe
 * reveals from that side.
 */
export function effectFrame(a: Animation, p: number, base: NodeBase, slide: { width: number; height: number }): FrameAttrs {
  p = clamp01(p);
  const rest: FrameAttrs = { opacity: 1, x: base.x, y: base.y, scale: base.scale, rotation: base.rotation };
  if (a.kind === "emphasis") {
    if (a.effect === "spin") return { ...rest, rotation: base.rotation + 360 * p };
    if (a.effect === "growShrink") return { ...rest, scale: base.scale * (1 + 0.5 * p) };
    return rest;
  }
  // q: how far the shape is "in" (1 = resting).
  const q = a.kind === "entrance" ? easeOut(p) : 1 - easeOut(p);
  switch (a.effect) {
    case "appear":
      return { ...rest, opacity: (a.kind === "entrance" ? p > 0 : p < 1) ? 1 : 0 };
    case "fade":
      return { ...rest, opacity: q };
    case "zoom":
      return { ...rest, opacity: q, scale: base.scale * q };
    case "flyIn": {
      const [dx, dy] = dirVector(effectiveAnimationDirection(a));
      const fx = dx > 0 ? slide.width + base.width / 2 : dx < 0 ? -base.width / 2 : base.x;
      const fy = dy > 0 ? slide.height + base.height / 2 : dy < 0 ? -base.height / 2 : base.y;
      return { ...rest, x: fx + (base.x - fx) * q, y: fy + (base.y - fy) * q };
    }
    case "wipe": {
      const [dx, dy] = dirVector(effectiveAnimationDirection(a));
      const w = base.width;
      const h = base.height;
      // At least a hair of the box, so Konva keeps clipping (a zero clip means "no clip").
      const k = Math.max(q, 0.0001);
      const clip =
        dy > 0 ? { x: 0, y: h * (1 - k), width: w, height: h * k }
        : dy < 0 ? { x: 0, y: 0, width: w, height: h * k }
        : dx > 0 ? { x: w * (1 - k), y: 0, width: w * k, height: h }
        : { x: 0, y: 0, width: w * k, height: h };
      return { ...rest, clip };
    }
    default:
      return rest;
  }
}

// ----- transitions --------------------------------------------------------------------------

export interface TransitionFrames {
  /** Keyframes of the new slide (`null` = it just sits there). */
  incoming: Keyframe[] | null;
  /** Keyframes of the old slide (`null` = it does not move). */
  outgoing: Keyframe[] | null;
  /** The old slide is drawn over the new one. */
  outgoingOnTop: boolean;
  durationMs: number;
}

const pct = (v: number) => `${v * 100}%`;
const NONE: TransitionFrames = { incoming: null, outgoing: null, outgoingOnTop: false, durationMs: 0 };

/**
 * The Web Animations keyframes of a transition between two slide pictures
 * of the same size. Directions are the motion's (`left`: the new slide
 * moves toward the left, coming from the right).
 */
export function transitionFrames(t: Transition | undefined | null): TransitionFrames {
  if (!t || t.durationMs <= 0) return NONE;
  const d = effectiveTransitionDirection(t);
  const [vx, vy] = dirVector(d);
  const durationMs = t.durationMs;
  const at = (x: number, y: number) => `translate(${pct(x)}, ${pct(y)})`;
  switch (t.kind) {
    case "fade":
      return { incoming: [{ opacity: 0 }, { opacity: 1 }], outgoing: null, outgoingOnTop: false, durationMs };
    case "push":
      return {
        incoming: [{ transform: at(-vx, -vy) }, { transform: at(0, 0) }],
        outgoing: [{ transform: at(0, 0) }, { transform: at(vx, vy) }],
        outgoingOnTop: false,
        durationMs,
      };
    case "cover":
      return { incoming: [{ transform: at(-vx, -vy) }, { transform: at(0, 0) }], outgoing: null, outgoingOnTop: false, durationMs };
    case "wipe": {
      // The edge moves in the direction: `left` reveals the new slide from the right edge.
      const from = vx < 0 ? "inset(0 0 0 100%)" : vx > 0 ? "inset(0 100% 0 0)" : vy < 0 ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
      return { incoming: [{ clipPath: from }, { clipPath: "inset(0 0 0 0)" }], outgoing: null, outgoingOnTop: false, durationMs };
    }
    case "split": {
      const horizontal = d === "horizontalOut" || d === "horizontalIn";
      const closed = horizontal ? "inset(50% 0 50% 0)" : "inset(0 50% 0 50%)";
      const open = "inset(0 0 0 0)";
      return d === "horizontalIn" || d === "verticalIn"
        ? { incoming: null, outgoing: [{ clipPath: open }, { clipPath: closed }], outgoingOnTop: true, durationMs }
        : { incoming: [{ clipPath: closed }, { clipPath: open }], outgoing: null, outgoingOnTop: false, durationMs };
    }
    case "zoom":
      return d === "in"
        ? { incoming: [{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], outgoing: null, outgoingOnTop: false, durationMs }
        : { incoming: null, outgoing: [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.3)", opacity: 0 }], outgoingOnTop: true, durationMs };
    default:
      // None and Cut: an instant switch.
      return NONE;
  }
}

/**
 * How long after arriving at click step `step` of `slide` the show moves on
 * by itself (`null` = it waits for a click): the transition's "After"
 * time, but never before the step's animations (and, on arrival, the
 * transition) have finished.
 */
export function autoAdvanceDelay(slide: Slide, step: number): number | null {
  const after = slide.transition?.advanceAfterMs;
  if (after === undefined) return null;
  const groups = clickGroups(slide);
  const playing = step === 0 ? (slide.transition?.durationMs ?? 0) + groups[0]!.durationMs : (groups[step]?.durationMs ?? 0);
  return Math.max(after, playing);
}
