// Transitions and animations in the UI (P8-8, P9-S4): the rules of
// `crates/model-show/src/anim.rs` for menus (which directions, options and
// defaults a kind or effect has – read from `generated/animInfo.json`,
// which the core writes from the Rust tables), the labels PowerPoint uses,
// the commands the Transitions / Animations tabs send, the click-step
// numbering shown in the Animation pane and the badges on the stage, Move
// Earlier / Later with PowerPoint's click-step semantics and the
// Animation Painter.

import info from "../generated/animInfo.json";
import type { Animation } from "../generated/Animation";
import type { AnimationKind } from "../generated/AnimationKind";
import type { AnimationPatch } from "../generated/AnimationPatch";
import type { Direction } from "../generated/Direction";
import type { Effect } from "../generated/Effect";
import type { NodeId } from "../generated/NodeId";
import type { Slide } from "../generated/Slide";
import type { StartOn } from "../generated/StartOn";
import type { Transition } from "../generated/Transition";
import type { TransitionKind } from "../generated/TransitionKind";
import type { TransitionOption } from "../generated/TransitionOption";
import type { Trigger } from "../generated/Trigger";

interface EffectInfo {
  class: AnimationKind;
  directions: Direction[];
  defaultDirection: Direction | null;
  defaultDurationMs: number;
  defaultAmount: number | null;
  defaultColor: string | null;
  paths: Record<string, string>;
}

interface TransitionInfo {
  directions: Direction[];
  defaultDirection: Direction | null;
  galleryDirection: Direction | null;
  options: TransitionOption[];
  defaultOption: TransitionOption | null;
  defaultDurationMs: number;
  extension: boolean;
}

const EFFECT_INFO = info.effects as unknown as Record<Effect, EffectInfo>;
const TRANSITION_INFO = info.transitions as unknown as Record<TransitionKind, TransitionInfo>;

// ----- transitions ------------------------------------------------------------------------

/** Every transition kind, in menu order (`TransitionKind::ALL`). */
export const TRANSITION_KINDS: readonly TransitionKind[] = info.transitionOrder as TransitionKind[];

/** The gallery's sections (PowerPoint: Subtle, Exciting). */
export const TRANSITION_GROUPS: readonly { id: "subtle" | "exciting"; kinds: TransitionKind[] }[] = [
  { id: "subtle", kinds: ["none", "morph", "fade", "push", "wipe", "split", "reveal", "cut", "cover", "shred", "zoom"] },
  {
    id: "exciting",
    kinds: ["fallOver", "drape", "curtains", "wind", "prestige", "fracture", "crush", "peelOff", "pageCurl", "airplane", "origami", "honeycomb", "glitter", "vortex", "ripple", "switch", "flip", "gallery", "cube", "doors", "box"],
  },
];

/** PowerPoint's default duration of a transition, in ms (`TransitionKind::default_duration_ms`). */
export const transitionDefaultDuration = (kind: TransitionKind): number => TRANSITION_INFO[kind].defaultDurationMs;

/** The directions a transition kind accepts (`TransitionKind::directions`). */
export const transitionDirections = (kind: TransitionKind): readonly Direction[] => TRANSITION_INFO[kind].directions;

/** The direction used when a transition has none (`TransitionKind::default_direction`). */
export const transitionDefaultDirection = (kind: TransitionKind): Direction | undefined => TRANSITION_INFO[kind].defaultDirection ?? undefined;

/** The options (variants) a kind accepts (`TransitionKind::options`). */
export const transitionOptions = (kind: TransitionKind): readonly TransitionOption[] => TRANSITION_INFO[kind].options;

/** A PowerPoint 2010+ transition (written in `mc:AlternateContent` with a fade fallback). */
export const isExtensionTransition = (kind: TransitionKind): boolean => TRANSITION_INFO[kind].extension;

/** A transition with PowerPoint's defaults (`Transition::new`). */
export function newTransition(kind: TransitionKind): Transition {
  return { kind, durationMs: transitionDefaultDuration(kind), advanceOnClick: true };
}

/**
 * The direction PowerPoint picks when a transition is chosen in the
 * gallery, where it differs from the file format's default
 * (`TransitionKind::gallery_direction`; P8-45 S-17): Push "From Bottom"
 * (`dir="u"`), Split "Vertical Out", Zoom "In", Switch and Flip "Right";
 * the others start with the format's default (not written).
 */
export function transitionGalleryDirection(kind: TransitionKind): Direction | undefined {
  const t = TRANSITION_INFO[kind];
  return t.galleryDirection && t.galleryDirection !== t.defaultDirection ? t.galleryDirection : undefined;
}

export const effectiveTransitionDirection = (t: Transition): Direction | undefined => t.direction ?? transitionDefaultDirection(t.kind);
export const effectiveTransitionOption = (t: Transition): TransitionOption | undefined => t.option ?? TRANSITION_INFO[t.kind].defaultOption ?? undefined;

/** Equivalent to no transition (`Transition::is_noop`). */
export const isNoopTransition = (t: Transition): boolean => t.kind === "none" && t.advanceOnClick && t.advanceAfterMs === undefined && !t.sound;

/** What the Transitions tab changes. */
export type TransitionChange =
  | { kind: TransitionKind }
  | { direction: Direction }
  | { option: TransitionOption }
  | { durationMs: number }
  | { advanceOnClick: boolean }
  | { advanceAfterMs: number | null };

/** PowerPoint's limits of the Duration and Delay spinners (`Animation::MIN_DURATION_MS`, `MAX_TIME_MS`): 0.01–59 s and 0–59 s, arrows in steps of 0.25 s. */
export const MIN_DURATION_MS = 10;
export const MAX_TIME_MS = 59_000;
export const SPIN_STEP_MS = 250;

/**
 * The slide's transition after a change from the Transitions tab
 * (`null` = none). A new kind gets its default duration and PowerPoint's
 * gallery direction (`transitionGalleryDirection`), keeping the advance
 * settings and the sound; a direction or option the kind does not accept
 * is ignored. Durations stay within PowerPoint's 0–59 s.
 */
export function changeTransition(current: Transition | undefined, change: TransitionChange): Transition | null {
  const base = current ?? newTransition("none");
  let next: Transition;
  if ("kind" in change) {
    next = { ...newTransition(change.kind), advanceOnClick: base.advanceOnClick };
    const dir = transitionGalleryDirection(change.kind);
    if (dir) next.direction = dir;
    if (base.advanceAfterMs !== undefined) next.advanceAfterMs = base.advanceAfterMs;
    if (base.sound) next.sound = base.sound;
  } else if ("direction" in change) {
    if (!transitionDirections(base.kind).includes(change.direction)) return current ?? null;
    next = { ...base, direction: change.direction };
  } else if ("option" in change) {
    if (!transitionOptions(base.kind).includes(change.option)) return current ?? null;
    next = { ...base, option: change.option };
  } else if ("durationMs" in change) {
    next = { ...base, durationMs: Math.min(MAX_TIME_MS, clampMs(change.durationMs)) };
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

/** A Duration spinner value within PowerPoint's limits. */
export const clampDuration = (ms: number): number => Math.min(MAX_TIME_MS, Math.max(MIN_DURATION_MS, clampMs(ms)));
/** A Delay spinner value within PowerPoint's limits. */
export const clampDelay = (ms: number): number => Math.min(MAX_TIME_MS, clampMs(ms));

/** The spinner's next value: up / down to the next multiple of 0.25 s (PowerPoint's arrows), within `[min, max]`. */
export function spinMs(ms: number, up: boolean, min: number, max = MAX_TIME_MS): number {
  const q = up ? Math.floor(ms / SPIN_STEP_MS + 1e-9) + 1 : Math.ceil(ms / SPIN_STEP_MS - 1e-9) - 1;
  return Math.min(max, Math.max(min, q * SPIN_STEP_MS));
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

/** Every effect (`Effect::ALL`). */
export const EFFECTS: readonly Effect[] = info.effectOrder as Effect[];
/** The kinds the animation gallery shows (media commands come from the Playback tab and the Timing dialog). */
export const ANIMATION_KINDS: readonly AnimationKind[] = ["entrance", "emphasis", "exit", "path"];
export const TRIGGERS: readonly Trigger[] = ["onClick", "withPrevious", "afterPrevious"];

/** The kind of animation an effect belongs to (entrance effects are also exit effects). */
export const effectClass = (effect: Effect): AnimationKind => EFFECT_INFO[effect].class;

/** Whether `effect` exists for animations of `kind` (`Effect::supports`). */
export function effectSupports(effect: Effect, kind: AnimationKind): boolean {
  const c = effectClass(effect);
  return c === "entrance" ? kind === "entrance" || kind === "exit" : c === kind;
}

/** The Shape effects: one gallery item ("Shape"), the shape chosen in Effect Options. */
export const SHAPE_EFFECTS: readonly Effect[] = ["circle", "box", "diamond", "plus"];

/** The effects of a kind, in gallery order (the Shape effects as one item, `circle`). */
export const effectsOf = (kind: AnimationKind): Effect[] => EFFECTS.filter((e) => effectSupports(e, kind) && (e === "circle" || !SHAPE_EFFECTS.includes(e)));

/** The directions an effect accepts (`Effect::directions`). */
export const effectDirections = (effect: Effect): readonly Direction[] => EFFECT_INFO[effect].directions;

export const effectDefaultDirection = (effect: Effect): Direction | undefined => EFFECT_INFO[effect].defaultDirection ?? undefined;

/** PowerPoint's default duration in ms (`Effect::default_duration_ms`). */
export const effectDefaultDuration = (effect: Effect): number => EFFECT_INFO[effect].defaultDurationMs;

/** The amount used when an animation has none (`Effect::default_amount`): Wheel spokes, Spin degrees, Grow/Shrink and Transparency percent. */
export const effectDefaultAmount = (effect: Effect): number | undefined => EFFECT_INFO[effect].defaultAmount ?? undefined;

/** Whether the effect takes a colour (`Effect::has_color`), and its default (`RRGGBB`). */
export const effectHasColor = (effect: Effect): boolean => EFFECT_INFO[effect].defaultColor !== null;
export const effectDefaultColor = (effect: Effect): string | undefined => EFFECT_INFO[effect].defaultColor ?? undefined;

export const isPathEffect = (effect: Effect): boolean => effectClass(effect) === "path";

/** The default motion path of a path preset in a direction (`motion::default_path`). */
export function defaultPath(effect: Effect, direction?: Direction): string | undefined {
  const p = EFFECT_INFO[effect].paths;
  return p[direction ?? effectDefaultDirection(effect) ?? "default"] ?? p.default;
}

export const effectiveAnimationDirection = (a: Animation): Direction | undefined => a.direction ?? effectDefaultDirection(a.effect);
export const effectiveAmount = (a: Animation): number | undefined => a.amount ?? effectDefaultAmount(a.effect);
export const effectiveColor = (a: Animation): string | undefined => a.color ?? effectDefaultColor(a.effect);
/** The motion path an animation follows (`Animation::effective_path`). */
export const effectivePath = (a: Animation): string | undefined => a.path ?? defaultPath(a.effect, effectiveAnimationDirection(a));

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
  const opt = (k: "amount" | "color" | "path" | "repeat" | "build" | "iterate" | "startOn", drop: boolean) => {
    const v = patch[k];
    if (v === null) delete out[k];
    else if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    else if (drop) delete out[k];
  };
  opt("amount", effectDefaultAmount(out.effect) === undefined);
  opt("color", !effectHasColor(out.effect));
  opt("path", patch.effect !== undefined && out.effect !== "pathCustom");
  opt("repeat", false);
  opt("build", false);
  opt("iterate", false);
  opt("startOn", false);
  if (patch.autoReverse !== undefined) {
    if (patch.autoReverse) out.autoReverse = true;
    else delete out.autoReverse;
  }
  if (patch.rewind !== undefined) {
    if (patch.rewind) out.rewind = true;
    else delete out.rewind;
  }
  return out;
}

/** The animations of the click sequence (not started by a trigger). */
export const mainSequence = (animations: readonly Animation[]): Animation[] => animations.filter((a) => !a.startOn);

/** Whether two triggers are the same. */
export const sameStartOn = (a: StartOn | undefined, b: StartOn | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The number PowerPoint shows next to each animation (pane and stage
 * badges): every On Click animation starts a new number, With / After
 * Previous ones share the number of the step they belong to; animations
 * before the first On Click one play automatically and get 0. Triggered
 * animations count within their trigger's sequence.
 */
export function clickNumbers(animations: readonly Animation[]): number[] {
  const counters = new Map<string, number>();
  return animations.map((a) => {
    const key = JSON.stringify(a.startOn ?? null);
    let n = counters.get(key) ?? 0;
    if (a.trigger === "onClick") n++;
    counters.set(key, n);
    return n;
  });
}

/** The numbers of each animated shape's animations, for the stage badges (in play order; triggered ones flagged). */
export function badgesByShape(animations: readonly Animation[]): Map<NodeId, { id: NodeId; n: number; trigger?: boolean }[]> {
  const nums = clickNumbers(animations);
  const out = new Map<NodeId, { id: NodeId; n: number; trigger?: boolean }[]>();
  animations.forEach((a, i) => {
    const list = out.get(a.shape) ?? [];
    const trigger = !!a.startOn;
    if (!list.some((b) => b.n === nums[i] && !!b.trigger === trigger)) list.push(trigger ? { id: a.id, n: nums[i]!, trigger } : { id: a.id, n: nums[i]! });
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

/**
 * Move Earlier (`delta` −1) / Move Later (+1) of animation `id`, as
 * PowerPoint does it in its sequence (the click sequence, or its
 * trigger's): a With / After Previous animation swaps places with its
 * neighbour row and keeps its Start, so it joins the step it lands in; an
 * On Click animation moves with the With / After Previous animations of
 * its step, past the whole neighbouring step. Returns the new order of
 * every id of the slide (`null`: it is already first / last).
 */
export function moveOrder(animations: readonly Animation[], id: NodeId, delta: -1 | 1): NodeId[] | null {
  const i = animations.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const me = animations[i]!;
  // the slots of this animation's sequence, in order
  const seq = animations.map((a, k) => (sameStartOn(a.startOn, me.startOn) ? k : -1)).filter((k) => k >= 0);
  const pos = seq.indexOf(i);
  /** The slots of the step starting at sequence position `p` (just `p` unless it is On Click). */
  const stepAt = (p: number): number[] => {
    const out = [seq[p]!];
    if (animations[seq[p]!]!.trigger !== "onClick") return out;
    for (let q = p + 1; q < seq.length && animations[seq[q]!]!.trigger !== "onClick"; q++) out.push(seq[q]!);
    return out;
  };
  /** The slots of the step ending right before sequence position `p`. */
  const stepBefore = (p: number): number[] => {
    let q = p - 1;
    while (q > 0 && animations[seq[q]!]!.trigger !== "onClick") q--;
    return seq.slice(q, p);
  };
  const step = me.trigger === "onClick";
  const mine = step ? stepAt(pos) : [i];
  let order: number[];
  if (delta < 0) {
    if (pos === 0) return null;
    const other = step ? stepBefore(pos) : [seq[pos - 1]!];
    order = [...seq.slice(0, pos - other.length), ...mine, ...other, ...seq.slice(pos + mine.length)];
  } else {
    const end = pos + mine.length;
    if (end >= seq.length) return null;
    const other = step ? stepAt(end) : [seq[end]!];
    order = [...seq.slice(0, pos), ...other, ...mine, ...seq.slice(end + other.length)];
  }
  // the reordered sequence back into its slots
  const out = animations.map((a) => a.id);
  seq.forEach((slot, k) => (out[slot] = animations[order[k]!]!.id));
  return out;
}

/**
 * Animation Painter: the animations of `source` (its whole animation set,
 * in order) for `target` – new animations (id 0) appended at the end, the
 * target's old ones removed (PowerPoint replaces the target's effects).
 * A trigger by the source itself becomes a trigger by the target; text
 * builds are kept only when the target has text; media commands are not
 * painted.
 */
export function paintedAnimations(animations: readonly Animation[], source: NodeId, target: NodeId, targetHasText: boolean): { remove: NodeId[]; add: Animation[] } {
  const remove = animations.filter((a) => a.shape === target).map((a) => a.id);
  const add = animations
    .filter((a) => a.shape === source && a.kind !== "media")
    .map((a) => {
      const copy: Animation = { ...a, id: 0, shape: target };
      if (a.startOn?.kind === "click" && a.startOn.value === source) copy.startOn = { kind: "click", value: target };
      if (!targetHasText) {
        delete copy.build;
        delete copy.iterate;
      }
      return copy;
    });
  return { remove, add };
}

/** Whether a slide shows the star in the slide sorter (a transition or animations, like PowerPoint). */
export const hasEffects = (slide: Slide): boolean => !!slide.transition || (slide.animations?.length ?? 0) > 0;

// ----- labels -----------------------------------------------------------------------------

/** i18n key of a transition kind. */
export const transitionKey = (k: TransitionKind) => `show.trans.${k}`;
export const transitionOptionKey = (o: TransitionOption) => `show.transOpt.${o}`;

/** i18n key of an effect for a kind (exit: Disappear / Fly Out / Float Out / Shrink & Turn). */
export function effectKey(effect: Effect, kind: AnimationKind): string {
  if (kind === "exit" && effect === "appear") return "show.fx.disappear";
  if (kind === "exit" && effect === "flyIn") return "show.fx.flyOut";
  if (kind === "exit" && effect === "float") return "show.fx.floatOut";
  if (kind === "exit" && effect === "growTurn") return "show.fx.shrinkTurn";
  return `show.fx.${effect}`;
}

/** i18n key of a gallery item (the Shape effects share "Shape"). */
export const galleryKey = (effect: Effect, kind: AnimationKind): string => (SHAPE_EFFECTS.includes(effect) ? "show.fx.shape" : effectKey(effect, kind));

export const triggerKey = (t: Trigger) => `show.trigger.${t}`;

/** Direction names of PowerPoint's Effect Options for a transition: the side the new slide comes from; Switch and Flip name the side they turn to. */
export function transitionDirectionKey(d: Direction, kind?: TransitionKind): string {
  if ((kind === "switch" || kind === "flip") && (d === "left" || d === "right")) return `show.dir.${d}`;
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

/** Direction names for an animation: the side of the shape it comes from (entrance) or goes to (exit); Float Up / Down; the way a motion path goes. */
export function animationDirectionKey(d: Direction, kind: AnimationKind, effect?: Effect): string {
  if (effect === "float") return d === "down" ? "show.dir.floatDown" : "show.dir.floatUp";
  if (kind === "path") return `show.dir.path.${d}`;
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
  const s = side[d];
  if (!s) return `show.dir.${d}`;
  return `show.dir.${kind === "exit" ? "to" : "from"}${s}`;
}
