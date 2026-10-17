// Playback of a slide's animations and of slide transitions (P8-8,
// P9-S4), as pure functions: the click groups of a slide with their
// timelines (text built by paragraphs expanded into its steps, triggered
// animations in sequences of their own), the shapes' state after a number
// of groups (so ← can rebuild the state of any step), the attributes of an
// animated shape at a moment of its effect, the media commands that have
// run, the CSS keyframes of a transition and the auto-advance delay.
// `present/AnimatedSlide.tsx` drives the Konva nodes with these.

import type { Animation } from "../generated/Animation";
import type { Direction } from "../generated/Direction";
import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { StartOn } from "../generated/StartOn";
import type { Transition } from "../generated/Transition";
import { findShape } from "../model";
import { effectiveAmount, effectiveAnimationDirection, effectiveColor, effectivePath, effectiveTransitionDirection, effectiveTransitionOption } from "./effects";
import { parsePath, pathEnd, pointAt } from "./motion";

/** One animation on its group's timeline (ms from the group's start). */
export interface TimedAnimation {
  anim: Animation;
  start: number;
  end: number;
  /** A step of a paragraph build: its paragraphs (absent: the whole shape). */
  paras?: number[];
  /** The attached shape of a paragraph build ("Animate attached shape"). */
  bg?: boolean;
  /** Repeats until the slide moves on ("Until Next Click" / "Until End of Slide"): keeps playing after `end`. */
  loop?: boolean;
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

/** The text of a shape's paragraphs (`null`: the shape has no text). */
function paragraphsOf(shapes: readonly Shape[] | undefined, id: NodeId): { level: number; text: string }[] | null {
  const hit = findShape([...(shapes ?? [])], id);
  const k = hit?.shape.kind;
  const body = k?.kind === "auto" ? k.value.text : undefined;
  if (!body) return null;
  return body.paragraphs.map((p) => ({ level: p.props?.level ?? 0, text: p.runs.map((r) => r.text).join("") }));
}

/** The paragraph steps of a paragraph build (`build_steps` of fmt-pptx): each step's paragraph indices, in play order. */
export function buildSteps(paragraphs: readonly { level: number; text: string }[], build: NonNullable<Animation["build"]>): number[][] {
  const steps: number[][] = [];
  paragraphs.forEach((p, i) => {
    if (p.text === "") return;
    const starts = build.level > 0 && p.level < build.level;
    const last = steps[steps.length - 1];
    if (last && !starts) last.push(i);
    else steps.push([i]);
  });
  return build.reverse ? steps.reverse() : steps;
}

/** One played instance of an animation: the whole shape, a paragraph step, or the attached shape. */
interface Inst {
  anim: Animation;
  trigger: Animation["trigger"];
  paras?: number[];
  bg?: boolean;
}

/** The instances of an animation (one per paragraph step for paragraph builds; the same triggers as fmt-pptx writes). */
function instances(a: Animation, shapes: readonly Shape[] | undefined): Inst[] {
  const paras = a.build ? paragraphsOf(shapes, a.shape) : null;
  const steps = a.build && paras ? buildSteps(paras, a.build) : [];
  if (!a.build || !steps.length) return [{ anim: a, trigger: a.trigger }];
  const out: Inst[] = [];
  if (a.build.animateBackground) out.push({ anim: a, trigger: a.trigger, bg: true });
  steps.forEach((step, si) => {
    const trigger = out.length === 0 ? a.trigger : si === 0 ? "withPrevious" : a.trigger === "onClick" ? "onClick" : "afterPrevious";
    out.push({ anim: a, trigger, paras: step });
  });
  return out;
}

/** The number of letters / words of a shape's text (By Letter / By Word). */
function iterateCount(a: Animation, shapes: readonly Shape[] | undefined): number {
  if (!a.iterate) return 1;
  const text = (paragraphsOf(shapes, a.shape) ?? []).map((p) => p.text).join(" ");
  const n = a.iterate.unit === "letter" ? text.replace(/\s/g, "").length : text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, n);
}

/** One pass of an effect (Appear and media commands are instant). */
export const animDuration = (a: Animation): number => (a.effect === "appear" || a.kind === "media" ? 0 : a.durationMs);

/**
 * How long an animation plays on its timeline: one pass, twice with
 * auto-reverse, times the repeat count; By Letter / By Word adds the
 * delay between the `count` letters or words.
 */
export function playDuration(a: Animation, count = 1): number {
  let d = animDuration(a);
  if (a.iterate && count > 1) d += (count - 1) * d * (a.iterate.delayPct / 100000);
  if (a.autoReverse) d *= 2;
  if (a.repeat?.kind === "times") d = (d * a.repeat.value) / 1000;
  return Math.round(d);
}

function groupsOf(insts: Inst[], shapes: readonly Shape[] | undefined): ClickGroup[] {
  const groups: ClickGroup[] = [{ items: [], durationMs: 0 }];
  let prevTrigger = 0;
  let prevEnd = 0;
  for (const it of insts) {
    const a = it.anim;
    if (it.trigger === "onClick") {
      groups.push({ items: [], durationMs: 0 });
      prevTrigger = 0;
      prevEnd = 0;
    }
    const g = groups[groups.length - 1]!;
    const trigger = it.trigger === "afterPrevious" ? prevEnd : it.trigger === "withPrevious" ? prevTrigger : 0;
    const start = trigger + a.delayMs;
    const end = start + playDuration(a, iterateCount(a, shapes));
    const item: TimedAnimation = { anim: a, start, end };
    if (it.paras) item.paras = it.paras;
    if (it.bg) item.bg = true;
    if (a.repeat && a.repeat.kind !== "times") item.loop = true;
    g.items.push(item);
    g.durationMs = Math.max(g.durationMs, end);
    prevTrigger = trigger;
    prevEnd = end;
  }
  return groups;
}

/**
 * The groups of a slide's click sequence: `[0]` holds the animations
 * before the first On Click one (they play when the slide appears; often
 * empty), then one group per On Click step with the With / After Previous
 * ones that follow it (a paragraph build gives a step per paragraph
 * step). With Previous starts with the previous animation, After Previous
 * when it ends; each adds its own delay. Triggered animations are not
 * part of it (`triggerSequences`).
 */
export function clickGroups(slide: Pick<Slide, "animations"> & Partial<Pick<Slide, "shapes">>): ClickGroup[] {
  const insts = (slide.animations ?? []).filter((a) => !a.startOn).flatMap((a) => instances(a, slide.shapes));
  const groups = groupsOf(insts, slide.shapes);
  for (const media of sequenceMedia({ shapes: slide.shapes ?? [] })) groups.push({ items: [], durationMs: 0, media });
  return groups;
}

/** A trigger's sequence: its key (for the show state), what triggers it and its click groups (each click on the trigger plays the next). */
export interface TriggerSequence {
  key: string;
  startOn: StartOn;
  /** Without the empty automatic group 0. */
  groups: ClickGroup[];
}

export const startOnKey = (s: StartOn): string => (s.kind === "click" ? `click:${s.value}` : `bmk:${s.value.shape}:${s.value.name}`);

/** The interactive sequences of a slide, in order of first appearance. */
export function triggerSequences(slide: Pick<Slide, "animations"> & Partial<Pick<Slide, "shapes">>): TriggerSequence[] {
  const out: TriggerSequence[] = [];
  const byKey = new Map<string, { startOn: StartOn; insts: Inst[] }>();
  for (const a of slide.animations ?? []) {
    if (!a.startOn) continue;
    const key = startOnKey(a.startOn);
    let e = byKey.get(key);
    if (!e) {
      e = { startOn: a.startOn, insts: [] };
      byKey.set(key, e);
    }
    e.insts.push(...instances(a, slide.shapes));
  }
  for (const [key, e] of byKey) {
    // the first effect of a trigger plays on the trigger's click
    if (e.insts[0]) e.insts[0] = { ...e.insts[0], trigger: "onClick" };
    out.push({ key, startOn: e.startOn, groups: groupsOf(e.insts, slide.shapes).slice(1) });
  }
  return out;
}

/** The group a fire of trigger `key` plays, given how often it fired before (`null`: none – its sequence played through). */
export function triggerGroup(slide: Pick<Slide, "animations" | "shapes">, key: string, firedBefore: number): ClickGroup | null {
  const seq = triggerSequences(slide).find((s) => s.key === key);
  return seq?.groups[firedBefore] ?? null;
}

/** Click steps of a slide: the On Click steps, then one per clip "In Click Sequence". */
export const clickSteps = (slide: Pick<Slide, "animations"> & Partial<Pick<Slide, "shapes">>): number => clickGroups(slide).length - 1;

/** The clips "In Click Sequence" whose click has come once `step` click steps are done. */
export function startedMedia(slide: Pick<Slide, "animations" | "shapes">, step: number): NodeId[] {
  return clickGroups(slide)
    .slice(1, step + 1)
    .flatMap((g) => (g.media !== undefined ? [g.media] : []));
}

/**
 * The media commands of the click sequence and the fired triggers that
 * have run once `step` steps are done: each clip's last command (`play`
 * for a clip whose In Click Sequence step came).
 */
export function mediaCommands(slide: Pick<Slide, "animations" | "shapes">, step: number, fired: readonly string[] = []): Map<NodeId, "play" | "pause" | "stop"> {
  const out = new Map<NodeId, "play" | "pause" | "stop">();
  const apply = (g: ClickGroup) => {
    if (g.media !== undefined) out.set(g.media, "play");
    for (const it of g.items) {
      if (it.anim.kind !== "media") continue;
      const cmd = it.anim.effect === "mediaPause" ? "pause" : it.anim.effect === "mediaStop" ? "stop" : "play";
      // Pause toggles
      out.set(it.anim.shape, cmd === "pause" && out.get(it.anim.shape) === "pause" ? "play" : cmd);
    }
  };
  clickGroups(slide).slice(0, step + 1).forEach(apply);
  firedGroups(slide, fired).forEach(apply);
  return out;
}

/** The groups the fired triggers played, in order. */
export function firedGroups(slide: Pick<Slide, "animations" | "shapes">, fired: readonly string[]): ClickGroup[] {
  const seqs = new Map(triggerSequences(slide).map((s) => [s.key, s]));
  const counts = new Map<string, number>();
  const out: ClickGroup[] = [];
  for (const key of fired) {
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const g = seqs.get(key)?.groups[n];
    if (g) out.push(g);
  }
  return out;
}

/** What animations changed on a shape (the still state between steps). */
export interface ShapeState {
  visible: boolean;
  /** Scale from Grow/Shrink (1 = unchanged). */
  scale: number;
  /** Degrees added by Spin. */
  rotation?: number;
  /** Opacity from Transparency (1 = unchanged). */
  opacity?: number;
  /** Offset from motion paths, in slide fractions. */
  dx?: number;
  dy?: number;
  /** Colours set by Fill / Object / Line / Font / Brush Color (`#RRGGBB`). */
  fill?: string;
  line?: string;
  font?: string;
  /** Desaturate / Darken / Lighten. */
  filter?: "gray" | "darken" | "lighten";
  bold?: boolean;
  underline?: boolean;
  /** Paragraphs hidden by paragraph builds (entrances to come, exits done). */
  hiddenParas?: number[];
}

/**
 * The animated shapes' state once the first `groupsDone` groups of the
 * click sequence have played (0 = the slide before anything), then the
 * groups of the `fired` triggers. A shape whose first animation is an
 * entrance starts hidden (a paragraph build hides its paragraphs; the
 * shape too with "Animate attached shape"); entrances show, exits hide,
 * emphasis effects keep their end (unless auto-reversed or rewound),
 * motion paths leave the shape at their end.
 */
export function shapeStates(slide: Pick<Slide, "animations"> & Partial<Pick<Slide, "shapes">>, groupsDone: number, fired: readonly string[] = []): Map<NodeId, ShapeState> {
  const out = new Map<NodeId, ShapeState>();
  for (const a of slide.animations ?? []) {
    if (out.has(a.shape)) continue;
    const s: ShapeState = { visible: a.kind !== "entrance", scale: 1 };
    if (a.kind === "entrance" && a.build) {
      const paras = paragraphsOf(slide.shapes, a.shape);
      const steps = paras ? buildSteps(paras, a.build) : [];
      if (steps.length) {
        s.visible = !a.build.animateBackground;
        s.hiddenParas = steps.flat().sort((x, y) => x - y);
      }
    }
    out.set(a.shape, s);
  }
  const groups = clickGroups(slide).slice(0, Math.max(0, groupsDone));
  groups.forEach((g) => g.items.forEach((it) => applyEnd(out, it)));
  if (groupsDone > 0) firedGroups({ animations: slide.animations ?? [], shapes: slide.shapes ?? [] }, fired).forEach((g) => g.items.forEach((it) => applyEnd(out, it)));
  return out;
}

function applyEnd(states: Map<NodeId, ShapeState>, it: TimedAnimation) {
  const a = it.anim;
  const s = states.get(a.shape);
  if (!s) return;
  const undo = !!a.rewind;
  const hidePara = (on: boolean) => {
    const set = new Set(s.hiddenParas ?? []);
    for (const p of it.paras ?? []) on ? set.add(p) : set.delete(p);
    s.hiddenParas = [...set].sort((x, y) => x - y);
    if (!s.hiddenParas.length) delete s.hiddenParas;
  };
  if (a.kind === "entrance") {
    if (it.paras) hidePara(undo);
    else s.visible = !undo;
    return;
  }
  if (a.kind === "exit") {
    if (it.paras) hidePara(!undo);
    else s.visible = undo;
    return;
  }
  if (undo || a.autoReverse || a.kind === "media") return;
  if (a.kind === "path") {
    const cmds = parsePath(effectivePath(a) ?? "") ?? [];
    const end = pathEnd(cmds);
    s.dx = (s.dx ?? 0) + end.x;
    s.dy = (s.dy ?? 0) + end.y;
    return;
  }
  const color = `#${effectiveColor(a) ?? "FF0000"}`;
  switch (a.effect) {
    case "growShrink":
      s.scale *= (effectiveAmount(a) ?? 150) / 100;
      break;
    case "spin":
      s.rotation = (s.rotation ?? 0) + (effectiveAmount(a) ?? 360);
      break;
    case "transparency":
      s.opacity = 1 - (effectiveAmount(a) ?? 50) / 100;
      break;
    case "fillColor":
    case "objectColor":
      s.fill = color;
      break;
    case "lineColor":
      s.line = color;
      break;
    case "fontColor":
    case "brushColor":
      s.font = color;
      break;
    case "desaturate":
      s.filter = "gray";
      break;
    case "darken":
      s.filter = "darken";
      break;
    case "lighten":
      s.filter = "lighten";
      break;
    case "boldReveal":
      s.bold = true;
      break;
    case "underline":
      s.underline = true;
      break;
    default:
      break;
  }
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

/** A reveal mask in the node's local box (the Shape, Wheel, Random Bars, Split effects). */
export interface Reveal {
  shape: "circle" | "box" | "diamond" | "plus" | "wheel" | "bars" | "split";
  /** How far the reveal is (0 = nothing shown, 1 = all). */
  q: number;
  /** Shapes / Split: from the edges inward (`true`) or from the centre outward. */
  inward?: boolean;
  /** Bars and Split: vertical. */
  vertical?: boolean;
  /** Wheel: spokes. */
  spokes?: number;
}

export interface FrameAttrs {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Horizontal / vertical squeeze (Swivel). */
  scaleX?: number;
  scaleY?: number;
  /** Clip in the node's local box (wipe); absent = none. */
  clip?: { x: number; y: number; width: number; height: number };
  /** A shaped reveal; absent = none. */
  reveal?: Reveal;
  /** A colour blended over the fill, line or text (0…1). */
  tint?: { target: "fill" | "line" | "font"; color: string; t: number };
  /** Desaturate (gray) / Darken / Lighten amount (0…1). */
  filter?: { kind: "gray" | "darken" | "lighten"; t: number };
  bold?: boolean;
  underline?: boolean;
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

/** The pass progress of `p` (0…1 of the whole play): repeats and auto-reverse fold it into one pass. */
export function passProgress(a: Animation, p: number): number {
  let q = clamp01(p);
  const times = a.repeat?.kind === "times" ? a.repeat.value / 1000 : 1;
  if (times !== 1) {
    const t = q * times;
    q = t >= times ? 1 : t - Math.floor(t);
    if (t >= times) q = 1;
  }
  if (a.autoReverse) q = q < 0.5 ? q * 2 : 2 - q * 2;
  return q;
}

/** A bounce: falls in and bounces twice (0 = up, 1 = resting). */
function bounceEase(p: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

/**
 * The attributes of `a`'s shape at progress `p` (0…1) of its play.
 * Entrance effects go from the effect's start to the resting state, exit
 * effects the other way; emphasis effects and motion paths change the
 * resting state (`docs/ui.md` lists how each preset is drawn).
 */
export function effectFrame(a: Animation, p: number, base: NodeBase, slide: { width: number; height: number }): FrameAttrs {
  const raw = clamp01(p);
  p = passProgress(a, raw);
  const rest: FrameAttrs = { opacity: 1, x: base.x, y: base.y, scale: base.scale, rotation: base.rotation };
  if (a.kind === "media") return rest;
  if (a.kind === "path") {
    const cmds = parsePath(effectivePath(a) ?? "") ?? [];
    const pt = pointAt(cmds, p);
    return { ...rest, x: base.x + pt.x * slide.width, y: base.y + pt.y * slide.height };
  }
  if (a.kind === "emphasis") {
    const color = `#${effectiveColor(a) ?? "FF0000"}`;
    const wave = Math.sin(Math.PI * p);
    switch (a.effect) {
      case "spin":
        return { ...rest, rotation: base.rotation + (effectiveAmount(a) ?? 360) * p };
      case "growShrink":
        return { ...rest, scale: base.scale * (1 + ((effectiveAmount(a) ?? 150) / 100 - 1) * p) };
      case "pulse":
        return { ...rest, scale: base.scale * (1 + 0.05 * wave) };
      case "colorPulse":
        return { ...rest, tint: { target: "fill", color, t: wave } };
      case "teeter":
        return { ...rest, rotation: base.rotation + 4 * Math.sin(Math.PI * 4 * p) * (p < 1 ? 1 : 0) };
      case "transparency":
        return { ...rest, opacity: 1 - ((effectiveAmount(a) ?? 50) / 100) * p };
      case "desaturate":
        return { ...rest, filter: { kind: "gray", t: p } };
      case "darken":
        return { ...rest, filter: { kind: "darken", t: p } };
      case "lighten":
        return { ...rest, filter: { kind: "lighten", t: p } };
      case "fillColor":
      case "objectColor":
        return { ...rest, tint: { target: "fill", color, t: p } };
      case "lineColor":
        return { ...rest, tint: { target: "line", color, t: p } };
      case "fontColor":
      case "brushColor":
        return { ...rest, tint: { target: "font", color, t: p } };
      case "underline":
        return p > 0 ? { ...rest, underline: true } : rest;
      case "boldFlash":
        return p > 0 && p < 1 ? { ...rest, bold: true } : rest;
      case "boldReveal":
        return p > 0 ? { ...rest, bold: true } : rest;
      case "wave":
        return { ...rest, y: base.y - wave * 0.05 * slide.height };
      default:
        return rest;
    }
  }
  // q: how far the shape is "in" (1 = resting).
  const entr = a.kind === "entrance";
  const q = entr ? easeOut(p) : 1 - easeOut(p);
  const dir = effectiveAnimationDirection(a);
  switch (a.effect) {
    case "appear":
      return { ...rest, opacity: (entr ? p > 0 : p < 1) ? 1 : 0 };
    case "fade":
      return { ...rest, opacity: q };
    case "zoom": {
      if (dir === "slideCenter") {
        const cx = slide.width / 2;
        const cy = slide.height / 2;
        return { ...rest, opacity: q, scale: base.scale * q, x: cx + (base.x - cx) * q, y: cy + (base.y - cy) * q };
      }
      return { ...rest, opacity: q, scale: base.scale * q };
    }
    case "flyIn": {
      const [dx, dy] = dirVector(dir);
      const fx = dx > 0 ? slide.width + base.width / 2 : dx < 0 ? -base.width / 2 : base.x;
      const fy = dy > 0 ? slide.height + base.height / 2 : dy < 0 ? -base.height / 2 : base.y;
      return { ...rest, x: fx + (base.x - fx) * q, y: fy + (base.y - fy) * q };
    }
    case "float": {
      // Float Up comes from below and leaves upward
      const sign = (dir === "down") === entr ? -1 : 1;
      return { ...rest, opacity: q, y: base.y + sign * (1 - q) * 0.1 * slide.height };
    }
    case "wipe": {
      const [dx, dy] = dirVector(dir);
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
    case "split":
      return { ...rest, reveal: { shape: "split", q, vertical: dir === "verticalIn" || dir === "verticalOut" || dir === undefined, inward: dir === "verticalIn" || dir === "horizontalIn" } };
    case "circle":
    case "box":
    case "diamond":
    case "plus":
      return { ...rest, reveal: { shape: a.effect, q, inward: dir === "in" } };
    case "wheel":
      return { ...rest, reveal: { shape: "wheel", q, spokes: effectiveAmount(a) ?? 1 } };
    case "randomBars":
      return { ...rest, reveal: { shape: "bars", q, vertical: dir === "vertical" } };
    case "growTurn":
      return { ...rest, opacity: q, scale: base.scale * q, rotation: base.rotation - 90 * (1 - q) };
    case "swivel": {
      const turn = Math.cos((1 - q) * Math.PI * 3) * q;
      return dir === "vertical" ? { ...rest, opacity: Math.min(1, q * 2), scaleY: base.scale * turn } : { ...rest, opacity: Math.min(1, q * 2), scaleX: base.scale * turn };
    }
    case "bounce": {
      const b = entr ? bounceEase(p) : 1 - bounceEase(p);
      return { ...rest, opacity: Math.min(1, (entr ? p : 1 - p) * 4), y: base.y - (1 - b) * 0.25 * slide.height };
    }
    default:
      return rest;
  }
}

/** Deterministic order of the 24 bars of Random Bars (the same every time, like a seeded shuffle). */
export const BAR_ORDER: readonly number[] = (() => {
  const out = Array.from({ length: 24 }, (_, i) => i);
  let s = 7;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
})();

/**
 * The reveal mask as rectangles and polygons in the node's local box
 * (`w × h`), for a canvas clip path; `inverse`: the mask is everything but
 * the polygons (the In variants open from the edges).
 */
export function revealGeometry(r: Reveal, w: number, h: number): { rects: { x: number; y: number; w: number; h: number }[]; polys: [number, number][][]; ellipse?: { rx: number; ry: number }; inverse: boolean } {
  const q = Math.max(0.0001, r.q);
  const cx = w / 2;
  const cy = h / 2;
  switch (r.shape) {
    case "split": {
      if (r.inward) {
        // two bands from the edges toward the centre line
        return r.vertical
          ? { rects: [{ x: 0, y: 0, w: (w / 2) * q, h }, { x: w - (w / 2) * q, y: 0, w: (w / 2) * q, h }], polys: [], inverse: false }
          : { rects: [{ x: 0, y: 0, w, h: (h / 2) * q }, { x: 0, y: h - (h / 2) * q, w, h: (h / 2) * q }], polys: [], inverse: false };
      }
      return r.vertical ? { rects: [{ x: cx - (w / 2) * q, y: 0, w: w * q, h }], polys: [], inverse: false } : { rects: [{ x: 0, y: cy - (h / 2) * q, w, h: h * q }], polys: [], inverse: false };
    }
    case "bars": {
      const n = BAR_ORDER.length;
      const shown = BAR_ORDER.slice(0, Math.ceil(q * n));
      const rects = shown.map((i) => (r.vertical ? { x: (w / n) * i, y: 0, w: w / n + 0.5, h } : { x: 0, y: (h / n) * i, w, h: h / n + 0.5 }));
      return { rects, polys: [], inverse: false };
    }
    case "wheel": {
      const n = Math.max(1, r.spokes ?? 1);
      const R = Math.hypot(w, h);
      const polys: [number, number][][] = [];
      for (let k = 0; k < n; k++) {
        const a0 = -Math.PI / 2 + (k * 2 * Math.PI) / n;
        const a1 = a0 + ((2 * Math.PI) / n) * q;
        const pts: [number, number][] = [[cx, cy]];
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
          const t = a0 + ((a1 - a0) * i) / steps;
          pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]);
        }
        polys.push(pts);
      }
      return { rects: [], polys, inverse: false };
    }
    default: {
      // shapes: Out grows from the centre; In closes from the edges (the hole shrinks)
      const k = r.inward ? 1 - q : q;
      const s = r.shape === "circle" ? Math.SQRT2 : r.shape === "diamond" ? 2 : r.shape === "plus" ? 1.5 : 1;
      const rx = (w / 2) * k * s;
      const ry = (h / 2) * k * s;
      if (r.shape === "circle") return { rects: [], polys: [], ellipse: { rx, ry }, inverse: !!r.inward };
      if (r.shape === "box") return { rects: [{ x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }], polys: [], inverse: !!r.inward };
      if (r.shape === "diamond") return { rects: [], polys: [[[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]]], inverse: !!r.inward };
      const t = 1 / 3;
      return {
        rects: [
          { x: cx - rx, y: cy - ry * t, w: rx * 2, h: ry * 2 * t },
          { x: cx - rx * t, y: cy - ry, w: rx * 2 * t, h: ry * 2 },
        ],
        polys: [],
        inverse: !!r.inward,
      };
    }
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
  /** CSS of the container while the transition plays (3D perspective, a black backdrop). */
  stage?: Record<string, string>;
}

const pct = (v: number) => `${v * 100}%`;
const NONE: TransitionFrames = { incoming: null, outgoing: null, outgoingOnTop: false, durationMs: 0 };

/**
 * The Web Animations keyframes of a transition between two slide pictures
 * of the same size. Directions are the motion's (`left`: the new slide
 * moves toward the left, coming from the right). The PowerPoint 2010+
 * effects are approximated with transforms, clip paths and filters
 * (`docs/ui.md` lists each).
 */
export function transitionFrames(t: Transition | undefined | null): TransitionFrames {
  if (!t || t.durationMs <= 0) return NONE;
  const d = effectiveTransitionDirection(t);
  const opt = effectiveTransitionOption(t);
  const [vx, vy] = dirVector(d);
  const durationMs = t.durationMs;
  const at = (x: number, y: number) => `translate(${pct(x)}, ${pct(y)})`;
  const both = (incoming: Keyframe[] | null, outgoing: Keyframe[] | null, outgoingOnTop = false, stage?: Record<string, string>): TransitionFrames =>
    stage ? { incoming, outgoing, outgoingOnTop, durationMs, stage } : { incoming, outgoing, outgoingOnTop, durationMs };
  const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  const fadeOut: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
  const persp = { perspective: "1600px" };
  const sign = vx < 0 || vy < 0 ? 1 : -1; // `left` / `up`: the new slide comes from the right / bottom
  const lr = d === "right" ? -1 : 1;
  switch (t.kind) {
    case "fade":
    case "morph":
      return both(fadeIn, null);
    case "push":
      return both([{ transform: at(-vx, -vy) }, { transform: at(0, 0) }], [{ transform: at(0, 0) }, { transform: at(vx, vy) }]);
    case "cover":
      return both([{ transform: at(-vx, -vy) }, { transform: at(0, 0) }], null);
    case "wipe": {
      // The edge moves in the direction: `left` reveals the new slide from the right edge.
      const from = vx < 0 ? "inset(0 0 0 100%)" : vx > 0 ? "inset(0 100% 0 0)" : vy < 0 ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
      return both([{ clipPath: from }, { clipPath: "inset(0 0 0 0)" }], null);
    }
    case "split": {
      const horizontal = d === "horizontalOut" || d === "horizontalIn";
      const closed = horizontal ? "inset(50% 0 50% 0)" : "inset(0 50% 0 50%)";
      const open = "inset(0 0 0 0)";
      return d === "horizontalIn" || d === "verticalIn" ? both(null, [{ clipPath: open }, { clipPath: closed }], true) : both([{ clipPath: closed }, { clipPath: open }], null);
    }
    case "zoom":
      return d === "in"
        ? both([{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], null)
        : both(null, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.3)", opacity: 0 }], true);
    case "reveal":
      // the old slide slides off, the new one fades in under it (through black: the old one darkens first)
      return opt === "throughBlack"
        ? both([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], [{ transform: at(0, 0), filter: "brightness(1)" }, { transform: at(-lr * 0.3, 0), filter: "brightness(0)" }], true, { background: "#000" })
        : both(fadeIn, [{ transform: at(0, 0), opacity: 1 }, { transform: at(-lr * 0.3, 0), opacity: 0 }], true);
    case "shred":
      return both(
        [{ clipPath: d === "out" ? "circle(0% at 50% 50%)" : "inset(0 0 0 0)", opacity: d === "out" ? 1 : 0 }, { clipPath: d === "out" ? "circle(75% at 50% 50%)" : "inset(0 0 0 0)", opacity: 1 }],
        [{ filter: "blur(0px)", opacity: 1 }, { filter: opt === "particles" ? "blur(6px) contrast(3)" : "blur(2px)", opacity: 0, transform: "scaleY(0.6)" }],
        d !== "out",
      );
    case "fallOver":
      return both(null, [{ transform: "perspective(1600px) rotateX(0deg)", transformOrigin: `${lr > 0 ? "0%" : "100%"} 100%` }, { transform: `perspective(1600px) rotateX(-90deg) rotateZ(${lr * 8}deg)`, transformOrigin: `${lr > 0 ? "0%" : "100%"} 100%`, opacity: 0.6 }], true);
    case "drape":
      return both(null, [{ clipPath: "inset(0 0 0 0)", transform: "skewY(0deg)" }, { clipPath: lr > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)", transform: `skewY(${lr * 6}deg)` }], true);
    case "curtains":
      return both(null, [{ clipPath: "polygon(0 0, 50% 0, 50% 100%, 0 100%, 0 0, 100% 0, 100% 100%, 50% 100%, 50% 0)" }, { clipPath: "polygon(0 0, 0 0, 0 100%, 0 100%, 0 0, 100% 0, 100% 100%, 100% 100%, 100% 0)" }], true);
    case "wind":
      return both([{ transform: at(lr * 0.1, 0), opacity: 0 }, { transform: at(0, 0), opacity: 1 }], [{ transform: "translate(0, 0) skewX(0deg)", opacity: 1 }, { transform: `translate(${-lr * 60}%, -10%) skewX(${lr * 20}deg)`, opacity: 0 }], true);
    case "prestige":
      return both([{ transform: "perspective(1600px) rotateX(20deg) scale(0.8)", opacity: 0 }, { transform: "perspective(1600px) rotateX(0deg) scale(1)", opacity: 1 }], [{ transform: "perspective(1600px) rotateX(0deg)", opacity: 1 }, { transform: "perspective(1600px) rotateX(-60deg) translateY(30%)", opacity: 0 }], true);
    case "fracture":
      return both(fadeIn, [{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)", filter: "contrast(1)" }, { clipPath: "polygon(20% 30%, 60% 10%, 80% 70%, 30% 90%)", filter: "contrast(1.6)", opacity: 0, transform: "scale(1.2)" }], true);
    case "crush":
      return both(fadeIn, [{ transform: "scale(1)", filter: "contrast(1)" }, { transform: "scale(0.05) rotate(25deg)", filter: "contrast(2)", opacity: 0 }], true);
    case "peelOff":
      return both(null, [{ transform: "perspective(1600px) rotateY(0deg) translateX(0)", transformOrigin: `${lr > 0 ? "100%" : "0%"} 0%` }, { transform: `perspective(1600px) rotateY(${-lr * 100}deg) translateX(${-lr * 20}%)`, transformOrigin: `${lr > 0 ? "100%" : "0%"} 0%`, opacity: 0 }], true);
    case "pageCurl": {
      const origin = opt === "single" ? `${lr > 0 ? "100%" : "0%"} 100%` : `${lr > 0 ? "100%" : "0%"} 50%`;
      return both(null, [{ transform: "perspective(1600px) rotateY(0deg)", transformOrigin: origin }, { transform: `perspective(1600px) rotateY(${-lr * 120}deg)`, transformOrigin: origin, opacity: 0.2 }], true);
    }
    case "airplane":
      return both(fadeIn, [{ transform: "translate(0,0) rotate(0deg) scale(1)" }, { transform: `translate(${-lr * 120}%, -80%) rotate(${-lr * 25}deg) scale(0.2)`, opacity: 0 }], true);
    case "origami":
      return both(fadeIn, [{ transform: "perspective(1600px) rotateY(0deg) scale(1)" }, { transform: `perspective(1600px) rotateY(${lr * 90}deg) scale(0.3)`, opacity: 0 }], true);
    case "honeycomb":
      return both([{ clipPath: "polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%, 50% 50%, 50% 50%)" }, { clipPath: "polygon(25% -50%, 75% -50%, 150% 50%, 75% 150%, 25% 150%, -50% 50%)" }], [{ transform: "scale(1)" }, { transform: "scale(1.1)", opacity: 0.4 }]);
    case "glitter":
      return both([{ opacity: 0, filter: opt === "hexagons" ? "saturate(0) contrast(4)" : "contrast(4)", transform: at(-vx * 0.05, -vy * 0.05) }, { opacity: 1, filter: "none", transform: at(0, 0) }], fadeOut);
    case "vortex":
      return both([{ opacity: 0, transform: "rotate(-30deg) scale(1.6)", filter: "blur(8px)" }, { opacity: 1, transform: "rotate(0) scale(1)", filter: "blur(0)" }], [{ transform: "rotate(0) scale(1)", opacity: 1 }, { transform: `rotate(${sign * 90}deg) scale(0.2)`, opacity: 0 }], true);
    case "ripple":
      return both([{ clipPath: "circle(0% at 50% 50%)", filter: "blur(4px)" }, { clipPath: "circle(75% at 50% 50%)", filter: "blur(0)" }], null);
    case "switch":
      return both([{ transform: `perspective(1600px) translateX(${lr * 30}%) rotateY(${-lr * 50}deg)`, opacity: 0.4 }, { transform: "perspective(1600px) translateX(0) rotateY(0)", opacity: 1 }], [{ transform: "perspective(1600px) translateX(0) rotateY(0)" }, { transform: `perspective(1600px) translateX(${-lr * 30}%) rotateY(${lr * 50}deg)`, opacity: 0.4 }], false, persp);
    case "flip":
      return both([{ transform: `perspective(1600px) rotateY(${-lr * 180}deg)`, backfaceVisibility: "hidden" }, { transform: "perspective(1600px) rotateY(0deg)", backfaceVisibility: "hidden" }], [{ transform: "perspective(1600px) rotateY(0deg)", backfaceVisibility: "hidden" }, { transform: `perspective(1600px) rotateY(${lr * 180}deg)`, backfaceVisibility: "hidden" }], true, persp);
    case "gallery":
      return both([{ transform: `translateX(${lr * 100}%) scale(0.8)` }, { transform: `translateX(${lr * 50}%) scale(0.8)`, offset: 0.4 }, { transform: "translateX(0) scale(1)" }], [{ transform: "translateX(0) scale(1)" }, { transform: `translateX(${-lr * 50}%) scale(0.8)`, offset: 0.6 }, { transform: `translateX(${-lr * 100}%) scale(0.8)` }], false, { background: "#000" });
    case "cube":
    case "box": {
      // the new face turns in from the side the motion comes from
      const axis = vy !== 0 ? "X" : "Y";
      const s = (vy !== 0 ? -vy : vx) * (t.kind === "box" ? -1 : 1);
      const origin = (side: number) => (axis === "Y" ? `${side > 0 ? "0%" : "100%"} 50%` : `50% ${side > 0 ? "0%" : "100%"}`);
      return both(
        [{ transform: `perspective(1600px) rotate${axis}(${s * 90}deg)`, transformOrigin: origin(-s) }, { transform: `perspective(1600px) rotate${axis}(0deg)`, transformOrigin: origin(-s) }],
        [{ transform: `perspective(1600px) rotate${axis}(0deg)`, transformOrigin: origin(s) }, { transform: `perspective(1600px) rotate${axis}(${-s * 90}deg)`, transformOrigin: origin(s) }],
        true,
        { background: "#000" },
      );
    }
    case "doors": {
      const horizontal = d === "horizontal";
      return both(
        [{ transform: "scale(0.8)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
        [
          { clipPath: "inset(0 0 0 0)", transform: "perspective(1600px) rotateY(0)" },
          { clipPath: horizontal ? "inset(50% 0 50% 0)" : "inset(0 50% 0 50%)", transform: horizontal ? "perspective(1600px) rotateX(80deg)" : "perspective(1600px) rotateY(80deg)" },
        ],
        true,
        { background: "#000" },
      );
    }
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

/** Whether moving from slide `from` to slide `to` plays `to`'s transition: only forward (Next, or a jump to a later slide); going back or jumping back shows the slide at once (PowerPoint). */
export const playsTransition = (from: number, to: number): boolean => from >= 0 && to > from;
