// Transitions and animations in the UI (P8-8): the rules of
// `crates/model-show/src/anim.rs` mirrored for menus (which directions a
// kind or effect accepts, defaults), the labels PowerPoint uses, the
// commands the Transitions / Animations tabs send, and the click-step
// numbering shown in the Animation pane and the badges on the stage.

import type { Animation } from "../generated/Animation";
import type { AnimationKind } from "../generated/AnimationKind";
import type { AnimationPatch } from "../generated/AnimationPatch";
import type { Direction } from "../generated/Direction";
import type { Effect } from "../generated/Effect";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import type { Transition } from "../generated/Transition";
import type { TransitionKind } from "../generated/TransitionKind";
import type { Trigger } from "../generated/Trigger";

// ----- transitions ------------------------------------------------------------------------

/** Every transition kind, in menu order (`TransitionKind::ALL`). */
export const TRANSITION_KINDS: readonly TransitionKind[] = ["none", "fade", "push", "wipe", "cover", "split", "cut", "zoom"];

/** PowerPoint's default duration of a transition, in ms (`TransitionKind::default_duration_ms`). */
export function transitionDefaultDuration(kind: TransitionKind): number {
  switch (kind) {
    case "none":
    case "cut":
      return 0;
    case "fade":
      return 700;
    case "push":
    case "wipe":
    case "cover":
      return 1000;
    case "split":
      return 1500;
    case "zoom":
      return 500;
  }
}

/** The directions a transition kind accepts (`TransitionKind::directions`). */
export function transitionDirections(kind: TransitionKind): readonly Direction[] {
  switch (kind) {
    case "push":
    case "wipe":
      return ["left", "up", "right", "down"];
    case "cover":
      return ["left", "up", "right", "down", "leftUp", "rightUp", "leftDown", "rightDown"];
    case "split":
      return ["horizontalOut", "horizontalIn", "verticalOut", "verticalIn"];
    case "zoom":
      return ["in", "out"];
    default:
      return [];
  }
}

/** The direction used when a transition has none (`TransitionKind::default_direction`). */
export function transitionDefaultDirection(kind: TransitionKind): Direction | undefined {
  switch (kind) {
    case "push":
    case "wipe":
    case "cover":
      return "left";
    case "split":
      return "horizontalOut";
    case "zoom":
      return "out";
    default:
      return undefined;
  }
}

/** A transition with PowerPoint's defaults (`Transition::new`). */
export function newTransition(kind: TransitionKind): Transition {
  return { kind, durationMs: transitionDefaultDuration(kind), advanceOnClick: true };
}

export const effectiveTransitionDirection = (t: Transition): Direction | undefined => t.direction ?? transitionDefaultDirection(t.kind);

/** Equivalent to no transition (`Transition::is_noop`). */
export const isNoopTransition = (t: Transition): boolean => t.kind === "none" && t.advanceOnClick && t.advanceAfterMs === undefined;

/** What the Transitions tab changes. */
export type TransitionChange =
  | { kind: TransitionKind }
  | { direction: Direction }
  | { durationMs: number }
  | { advanceOnClick: boolean }
  | { advanceAfterMs: number | null };

/**
 * The slide's transition after a change from the Transitions tab
 * (`null` = none). A new kind gets its default duration and direction
 * (PowerPoint), keeping the advance settings; a direction the kind does
 * not accept is ignored.
 */
export function changeTransition(current: Transition | undefined, change: TransitionChange): Transition | null {
  const base = current ?? newTransition("none");
  let next: Transition;
  if ("kind" in change) {
    next = { ...newTransition(change.kind), advanceOnClick: base.advanceOnClick };
    if (base.advanceAfterMs !== undefined) next.advanceAfterMs = base.advanceAfterMs;
  } else if ("direction" in change) {
    if (!transitionDirections(base.kind).includes(change.direction)) return current ?? null;
    next = { ...base, direction: change.direction };
  } else if ("durationMs" in change) {
    next = { ...base, durationMs: clampMs(change.durationMs) };
  } else if ("advanceOnClick" in change) {
    next = { ...base, advanceOnClick: change.advanceOnClick };
  } else {
    next = { ...base };
    if (change.advanceAfterMs === null) delete next.advanceAfterMs;
    else next.advanceAfterMs = clampMs(change.advanceAfterMs);
  }
  return isNoopTransition(next) ? null : next;
}

/** Milliseconds as a whole, non-negative `u32`. */
export function clampMs(ms: number): number {
  return Number.isFinite(ms) ? Math.min(0xffffffff, Math.max(0, Math.round(ms))) : 0;
}

/** Seconds as shown in the Duration / Delay fields (`1.25`). */
export const msToSeconds = (ms: number): string => String(Math.round(ms / 10) / 100);

/** A seconds field's text in ms (`null` = not a number). Accepts a decimal comma. */
export function secondsToMs(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(v) && v >= 0 ? clampMs(v * 1000) : null;
}

/** `mm:ss.ss` of the Advance "After" field (PowerPoint shows `00:05.00`). */
export function msToMmss(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Parses `mm:ss`, `mm:ss.ss` or plain seconds into ms (`null` = invalid). */
export function parseMmss(text: string): number | null {
  const s = text.trim().replace(",", ".");
  const m = /^(?:(\d+):)?(\d+(?:\.\d*)?)$/.exec(s);
  if (!m) return null;
  return clampMs((Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000);
}

// ----- animations -------------------------------------------------------------------------

export const EFFECTS: readonly Effect[] = ["appear", "fade", "flyIn", "wipe", "zoom", "spin", "growShrink"];
export const ANIMATION_KINDS: readonly AnimationKind[] = ["entrance", "emphasis", "exit"];
export const TRIGGERS: readonly Trigger[] = ["onClick", "withPrevious", "afterPrevious"];

/** Whether `effect` exists for animations of `kind` (`Effect::supports`). */
export const effectSupports = (effect: Effect, kind: AnimationKind): boolean =>
  effect === "spin" || effect === "growShrink" ? kind === "emphasis" : kind !== "emphasis";

/** The effects of a kind, in menu order (the gallery's sections). */
export const effectsOf = (kind: AnimationKind): Effect[] => EFFECTS.filter((e) => effectSupports(e, kind));

/** The directions an effect accepts (`Effect::directions`). */
export function effectDirections(effect: Effect): readonly Direction[] {
  if (effect === "flyIn") return ["down", "left", "right", "up", "leftDown", "rightDown", "leftUp", "rightUp"];
  if (effect === "wipe") return ["down", "left", "right", "up"];
  return [];
}

export const effectDefaultDirection = (effect: Effect): Direction | undefined =>
  effect === "flyIn" || effect === "wipe" ? "down" : undefined;

/** PowerPoint's default duration in ms (`Effect::default_duration_ms`). */
export function effectDefaultDuration(effect: Effect): number {
  if (effect === "appear") return 0;
  if (effect === "spin" || effect === "growShrink") return 2000;
  return 500;
}

export const effectiveAnimationDirection = (a: Animation): Direction | undefined => a.direction ?? effectDefaultDirection(a.effect);

/** A new on-click animation of `shape` (`Animation::new`; id 0, the core assigns one). */
export function newAnimation(shape: NodeId, kind: AnimationKind, effect: Effect): Animation {
  return { id: 0, shape, kind, effect, trigger: "onClick", durationMs: effectDefaultDuration(effect), delayMs: 0 };
}

/** Checks effect, kind and direction (`Animation::validate`); `null` = fine. */
export function animationError(a: Pick<Animation, "kind" | "effect" | "direction">): string | null {
  if (!effectSupports(a.effect, a.kind)) return `effect ${a.effect} is not available for ${a.kind} animations`;
  if (a.direction && !effectDirections(a.effect).includes(a.direction)) return `direction ${a.direction} does not apply to effect ${a.effect}`;
  return null;
}

/**
 * The patch that turns `a` into `kind`/`effect` (the gallery applied to an
 * animated shape): the effect's default duration, and the direction reset
 * when it does not fit the new effect.
 */
export function effectPatch(a: Animation, kind: AnimationKind, effect: Effect): AnimationPatch {
  const patch: AnimationPatch = { kind, effect };
  if (a.effect !== effect) patch.durationMs = effectDefaultDuration(effect);
  if (a.direction && !effectDirections(effect).includes(a.direction)) patch.direction = null;
  return patch;
}

/** The value of `patch` applied to `a` (`AnimationPatch::apply_to`). */
export function applyAnimationPatch(a: Animation, patch: AnimationPatch): Animation {
  const out: Animation = { ...a };
  if (patch.kind !== undefined) out.kind = patch.kind;
  if (patch.effect !== undefined) out.effect = patch.effect;
  if (patch.trigger !== undefined) out.trigger = patch.trigger;
  if (patch.durationMs !== undefined) out.durationMs = patch.durationMs;
  if (patch.delayMs !== undefined) out.delayMs = patch.delayMs;
  if (patch.direction === null) delete out.direction;
  else if (patch.direction !== undefined) out.direction = patch.direction;
  else if (patch.effect !== undefined && out.direction && !effectDirections(out.effect).includes(out.direction)) delete out.direction;
  return out;
}

/**
 * The number PowerPoint shows next to each animation (pane and stage
 * badges): every On Click animation starts a new number, With / After
 * Previous ones share the number of the step they belong to; animations
 * before the first On Click one play automatically and get 0.
 */
export function clickNumbers(animations: readonly Animation[]): number[] {
  let n = 0;
  return animations.map((a) => (a.trigger === "onClick" ? ++n : n));
}

/** The numbers of each animated shape's animations, for the stage badges (in play order). */
export function badgesByShape(animations: readonly Animation[]): Map<NodeId, { id: NodeId; n: number }[]> {
  const nums = clickNumbers(animations);
  const out = new Map<NodeId, { id: NodeId; n: number }[]>();
  animations.forEach((a, i) => {
    const list = out.get(a.shape) ?? [];
    if (!list.some((b) => b.n === nums[i])) list.push({ id: a.id, n: nums[i]! });
    out.set(a.shape, list);
  });
  return out;
}

/**
 * The `index` of `reorderAnimation` when the pane row `from` is dropped
 * before row `before` (`length` = after the last); `null` = no move.
 */
export function reorderTarget(from: number, before: number, length: number): number | null {
  if (from < 0 || from >= length || before < 0 || before > length) return null;
  const to = before > from ? before - 1 : before;
  return to === from ? null : to;
}

/** Whether a slide shows the star in the slide sorter (a transition or animations, like PowerPoint). */
export const hasEffects = (slide: Slide): boolean => !!slide.transition || (slide.animations?.length ?? 0) > 0;

// ----- labels -----------------------------------------------------------------------------

/** i18n key of a transition kind. */
export const transitionKey = (k: TransitionKind) => `show.trans.${k}`;

/** i18n key of an effect for a kind (exit: Disappear / Fly Out). */
export function effectKey(effect: Effect, kind: AnimationKind): string {
  if (kind === "exit" && effect === "appear") return "show.fx.disappear";
  if (kind === "exit" && effect === "flyIn") return "show.fx.flyOut";
  return `show.fx.${effect}`;
}

export const triggerKey = (t: Trigger) => `show.trigger.${t}`;

/** Direction names of PowerPoint's Effect Options for a transition (the menu names the side it comes from). */
export function transitionDirectionKey(d: Direction): string {
  const from: Partial<Record<Direction, string>> = {
    left: "fromRight",
    right: "fromLeft",
    up: "fromBottom",
    down: "fromTop",
    leftUp: "fromBottomRight",
    rightUp: "fromBottomLeft",
    leftDown: "fromTopRight",
    rightDown: "fromTopLeft",
  };
  return `show.dir.${from[d] ?? d}`;
}

/** Direction names for an animation: the side of the shape it comes from (entrance) or goes to (exit). */
export function animationDirectionKey(d: Direction, kind: AnimationKind): string {
  const side: Partial<Record<Direction, string>> = {
    down: "Bottom",
    up: "Top",
    left: "Left",
    right: "Right",
    leftDown: "BottomLeft",
    rightDown: "BottomRight",
    leftUp: "TopLeft",
    rightUp: "TopRight",
  };
  return `show.dir.${kind === "exit" ? "to" : "from"}${side[d] ?? ""}`;
}
