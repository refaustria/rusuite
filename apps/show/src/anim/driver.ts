// Plays click groups on a rendered slide (P8-8, P9-S4): finds each
// animated shape's Konva node (the outer group carrying `shapeId`) and
// moves it frame by frame with `effectFrame` – position, scale, rotation,
// opacity, clips and shaped reveals, colour tints (fill, line, text),
// Desaturate / Darken / Lighten filters, bold and underline; a paragraph
// build animates the text nodes of its paragraphs (`para`). Cancelling
// jumps every animation to its end, so a rebuilt state never sees
// half-played attributes. Each node's original attributes are remembered
// on first touch, so a still state is always applied to the untouched
// node.

import Konva from "konva";
import type { NodeId } from "../generated/NodeId";
import { effectFrame, revealGeometry, type ClickGroup, type FrameAttrs, type NodeBase, type Reveal, type ShapeState, type TimedAnimation } from "./playback";

export function findShapeNode(stage: Konva.Stage, id: NodeId): Konva.Node | undefined {
  return stage.findOne((n: Konva.Node) => n.getAttr("shapeId") === id) ?? undefined;
}

/** The original attributes of a node and of its drawn children. */
interface Orig {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  kids: { node: Konva.Shape; fill: unknown; stroke: unknown; fontStyle?: string; textDecoration?: string; x: number; y: number; visible: boolean }[];
}

const origs = new WeakMap<Konva.Node, Orig>();

function origOf(node: Konva.Node): Orig {
  let o = origs.get(node);
  if (o) return o;
  const kids: Orig["kids"] = [];
  if (node instanceof Konva.Container) {
    node.find((n: Konva.Node) => n instanceof Konva.Shape).forEach((n) => {
      const s = n as Konva.Shape;
      const text = s instanceof Konva.Text;
      kids.push({
        node: s,
        fill: s.fill(),
        stroke: s.stroke(),
        ...(text ? { fontStyle: s.fontStyle(), textDecoration: s.textDecoration() } : {}),
        x: s.x(),
        y: s.y(),
        visible: s.visible(),
      });
    });
  }
  o = { x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY(), opacity: node.opacity(), kids };
  origs.set(node, o);
  return o;
}

function baseOf(node: Konva.Node): NodeBase {
  return { x: node.x(), y: node.y(), width: node.offsetX() * 2, height: node.offsetY() * 2, rotation: node.rotation(), scale: node.scaleX() };
}

function clearClip(node: Konva.Node) {
  node.setAttrs({ clipX: undefined, clipY: undefined, clipWidth: undefined, clipHeight: undefined, clipFunc: undefined });
}

const redraw = (stage: Konva.Stage) => stage.getLayers().forEach((l) => l.batchDraw());

/** `#RRGGBB` → rgb. */
function rgb(c: unknown): [number, number, number] | null {
  if (typeof c !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}

/** `a` blended toward `b` by `t` (0…1); `a` unparsable: `b` from halfway. */
export function mixColor(a: unknown, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!y) return typeof a === "string" ? a : b;
  if (!x) return t >= 0.5 ? b : (a as string);
  const m = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The text and the non-text drawn children of a shape node. */
const isText = (s: Konva.Shape) => s instanceof Konva.Text;

function setColors(o: Orig, target: "fill" | "line" | "font", color: string, t: number) {
  for (const k of o.kids) {
    if (target === "font") {
      if (isText(k.node)) k.node.fill(mixColor(k.fill, color, t));
    } else if (target === "fill") {
      if (!isText(k.node) && typeof k.fill === "string" && k.fill && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(k.fill)) k.node.fill(mixColor(k.fill, color, t));
    } else if (!isText(k.node) && typeof k.stroke === "string" && k.stroke) k.node.stroke(mixColor(k.stroke, color, t));
  }
}

function setFilter(node: Konva.Node, f: FrameAttrs["filter"] | undefined) {
  if (!f || f.t <= 0) {
    if (node.filters()?.length) {
      node.filters([]);
      node.clearCache();
    }
    return;
  }
  if (!node.isCached()) {
    try {
      node.cache();
    } catch {
      return;
    }
  }
  if (f.kind === "gray") {
    node.filters([Konva.Filters.HSL]);
    node.setAttr("saturation", -2 * f.t);
  } else {
    node.filters([Konva.Filters.Brighten]);
    node.setAttr("brightness", (f.kind === "darken" ? -0.3 : 0.3) * f.t);
  }
}

/** A canvas clip function of a reveal in the node's local box. */
function revealClip(r: Reveal, w: number, h: number) {
  const g = revealGeometry(r, w, h);
  return (ctx: Konva.Context): [Path2D, CanvasFillRule] | void => {
    if (typeof Path2D === "undefined") {
      ctx.rect(0, 0, w, h);
      return;
    }
    const p = new Path2D();
    if (g.inverse) p.rect(-w, -h, w * 3, h * 3);
    for (const rc of g.rects) p.rect(rc.x, rc.y, rc.w, rc.h);
    for (const poly of g.polys) {
      poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
    }
    if (g.ellipse) {
      p.moveTo(w / 2 + g.ellipse.rx, h / 2);
      p.ellipse(w / 2, h / 2, Math.max(0.01, g.ellipse.rx), Math.max(0.01, g.ellipse.ry), 0, 0, Math.PI * 2);
    }
    return [p, g.inverse ? "evenodd" : "nonzero"];
  };
}

/** The text nodes of paragraphs `paras` of a shape node. */
function paraKids(o: Orig, paras: readonly number[]) {
  return o.kids.filter((k) => paras.includes(k.node.getAttr("para")));
}

/** Shows / hides, moves, scales, turns and recolours the animated shapes as `states` says (a still state: between clicks, after ←). */
export function applyStates(stage: Konva.Stage, states: Map<NodeId, ShapeState>, slide: { width: number; height: number } = { width: 0, height: 0 }): void {
  for (const [id, s] of states) {
    const node = findShapeNode(stage, id);
    if (!node) continue;
    const o = origOf(node);
    node.visible(s.visible);
    node.setAttrs({
      x: o.x + (s.dx ?? 0) * slide.width,
      y: o.y + (s.dy ?? 0) * slide.height,
      rotation: o.rotation + (s.rotation ?? 0),
      scaleX: o.scaleX * s.scale,
      scaleY: o.scaleY * s.scale,
      opacity: o.opacity * (s.opacity ?? 1),
    });
    clearClip(node);
    const hidden = new Set(s.hiddenParas ?? []);
    for (const k of o.kids) {
      k.node.setAttrs({ fill: k.fill as string, stroke: k.stroke as string, x: k.x, y: k.y, opacity: 1, visible: k.visible && !hidden.has(k.node.getAttr("para")) });
      if (isText(k.node)) {
        const t = k.node as Konva.Text;
        const style = k.fontStyle ?? "normal";
        t.fontStyle(s.bold && !style.includes("bold") ? `${style === "normal" ? "" : `${style} `}bold` : style);
        t.textDecoration(s.underline ? "underline" : (k.textDecoration ?? ""));
      }
    }
    if (s.fill) setColors(o, "fill", s.fill, 1);
    if (s.line) setColors(o, "line", s.line, 1);
    if (s.font) setColors(o, "font", s.font, 1);
    setFilter(node, s.filter ? { kind: s.filter, t: 1 } : undefined);
  }
  redraw(stage);
}

interface Running {
  it: TimedAnimation;
  node: Konva.Node | undefined;
  base: NodeBase | null;
  done: boolean;
}

/** Applies one frame of a run to its node (or its paragraphs). */
function applyFrame(r: Running, f: FrameAttrs) {
  const node = r.node!;
  const b = r.base!;
  const o = origOf(node);
  if (r.it.paras) {
    // a paragraph step: its text moves and fades; shaped reveals fade
    const reveal = f.reveal ? f.reveal.q : f.clip ? Math.min(1, (f.clip.width * f.clip.height) / Math.max(1, b.width * b.height)) : 1;
    const dx = (f.x - b.x) / (b.scale || 1);
    const dy = (f.y - b.y) / (b.scale || 1);
    for (const k of paraKids(o, r.it.paras)) {
      k.node.setAttrs({ visible: k.visible, opacity: f.opacity * reveal, x: k.x + dx, y: k.y + dy });
      if (f.tint?.target === "font") k.node.fill(mixColor(k.fill, f.tint.color, f.tint.t));
    }
    return;
  }
  node.setAttrs({ x: f.x, y: f.y, rotation: f.rotation, opacity: f.opacity * o.opacity, scaleX: f.scaleX ?? f.scale, scaleY: f.scaleY ?? f.scale });
  if (node instanceof Konva.Container) {
    if (f.clip) node.clip(f.clip);
    else if (f.reveal) node.clipFunc(revealClip(f.reveal, b.width, b.height));
  }
  if (f.tint) setColors(o, f.tint.target, f.tint.color, f.tint.t);
  if (f.filter) setFilter(node, f.filter);
  if (f.bold !== undefined || f.underline !== undefined) {
    for (const k of o.kids) {
      if (!isText(k.node)) continue;
      const t = k.node as Konva.Text;
      const style = k.fontStyle ?? "normal";
      if (f.bold) t.fontStyle(style.includes("bold") ? style : `${style === "normal" ? "" : `${style} `}bold`);
      else t.fontStyle(style);
      if (f.underline) t.textDecoration("underline");
    }
  }
}

/**
 * Plays `groups` one after the other, starting after `delayMs`; calls
 * `onDone` at the end (animations repeating until the next click keep
 * going). Returns a cancel function (jumps to the end, without `onDone`).
 */
export function playGroups(
  stage: Konva.Stage,
  groups: ClickGroup[],
  delayMs: number,
  slide: { width: number; height: number },
  onDone: () => void,
): () => void {
  const runs: Running[] = [];
  let offset = delayMs;
  for (const g of groups) {
    for (const it of g.items) {
      if (it.anim.kind === "media") continue;
      runs.push({ it: { ...it, start: it.start + offset, end: it.end + offset }, node: findShapeNode(stage, it.anim.shape), base: null, done: false });
    }
    offset += g.durationMs;
  }
  const t0 = performance.now();
  let raf = 0;
  let over = false;
  let reported = false;

  const start = (r: Running) => {
    if (r.base || !r.node) return;
    const node = r.node;
    r.base = baseOf(node);
    const a = r.it.anim;
    if (a.kind === "entrance") {
      if (r.it.paras) {
        const o = origOf(node);
        for (const k of paraKids(o, r.it.paras)) k.node.visible(k.visible);
        // the shape itself shows with the first paragraph unless it is animated too
        if (!a.build?.animateBackground) node.visible(true);
      } else node.visible(true);
    }
  };

  const finish = (r: Running) => {
    if (r.done) return;
    start(r);
    r.done = true;
    const node = r.node;
    if (!node || !r.base) return;
    applyFrame(r, effectFrame(r.it.anim, 1, r.base, slide));
    if (!r.it.paras && node instanceof Konva.Container) clearClip(node);
    const a = r.it.anim;
    if (a.kind === "exit" && !a.rewind) {
      if (r.it.paras) for (const k of paraKids(origOf(node), r.it.paras)) k.node.visible(false);
      else node.visible(false);
    }
  };

  const tick = (now: number) => {
    const t = now - t0;
    for (const r of runs) {
      if (r.done || t < r.it.start) continue;
      start(r);
      const dur = r.it.end - r.it.start;
      let p = dur > 0 ? (t - r.it.start) / dur : 1;
      if (p >= 1 && r.it.loop && dur > 0) p = p - Math.floor(p);
      else if (p >= 1) {
        finish(r);
        continue;
      }
      if (!r.node || !r.base) continue;
      applyFrame(r, effectFrame(r.it.anim, p, r.base, slide));
    }
    redraw(stage);
    const pending = runs.some((r) => !r.done && !(r.it.loop && t >= r.it.end));
    if (!pending && t >= offset && !reported) {
      reported = true;
      if (!runs.some((r) => r.it.loop && !r.done)) {
        over = true;
        onDone();
        return;
      }
      onDone();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    runs.forEach(finish);
    redraw(stage);
  };
}
