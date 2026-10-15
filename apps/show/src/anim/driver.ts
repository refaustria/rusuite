// Plays click groups on a rendered slide (P8-8): finds each animated
// shape's Konva node (the outer group carrying `shapeId`) and moves it
// frame by frame with `effectFrame`; the emphasis effects (Spin,
// Grow/Shrink) run as Konva tweens. Cancelling jumps every animation to
// its end, so a rebuilt state never sees half-played attributes.

import Konva from "konva";
import type { NodeId } from "../generated/NodeId";
import { effectFrame, type ClickGroup, type NodeBase, type ShapeState, type TimedAnimation } from "./playback";

export function findShapeNode(stage: Konva.Stage, id: NodeId): Konva.Node | undefined {
  return stage.findOne((n: Konva.Node) => n.getAttr("shapeId") === id) ?? undefined;
}

function baseOf(node: Konva.Node): NodeBase {
  return { x: node.x(), y: node.y(), width: node.offsetX() * 2, height: node.offsetY() * 2, rotation: node.rotation(), scale: node.scaleX() };
}

function clearClip(node: Konva.Node) {
  node.setAttrs({ clipX: undefined, clipY: undefined, clipWidth: undefined, clipHeight: undefined });
}

const redraw = (stage: Konva.Stage) => stage.getLayers().forEach((l) => l.batchDraw());

/** Shows / hides and scales the animated shapes as `states` says (a still state: between clicks, after ←). */
export function applyStates(stage: Konva.Stage, states: Map<NodeId, ShapeState>): void {
  for (const [id, s] of states) {
    const node = findShapeNode(stage, id);
    if (!node) continue;
    node.visible(s.visible);
    node.opacity(1);
    node.scale({ x: s.scale, y: s.scale });
    clearClip(node);
  }
  redraw(stage);
}

interface Running {
  it: TimedAnimation;
  node: Konva.Node | undefined;
  base: NodeBase | null;
  tween: Konva.Tween | null;
  done: boolean;
}

/**
 * Plays `groups` one after the other, starting after `delayMs`; calls
 * `onDone` at the end. Returns a cancel function (jumps to the end, without
 * `onDone`).
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
    for (const it of g.items) runs.push({ it: { ...it, start: it.start + offset, end: it.end + offset }, node: findShapeNode(stage, it.anim.shape), base: null, tween: null, done: false });
    offset += g.durationMs;
  }
  const t0 = performance.now();
  let raf = 0;
  let over = false;

  const start = (r: Running) => {
    if (r.base || !r.node) return;
    const node = r.node;
    r.base = baseOf(node);
    const a = r.it.anim;
    if (a.kind === "entrance") node.visible(true);
    const seconds = Math.max(0.001, (r.it.end - r.it.start) / 1000);
    if (a.effect === "spin") r.tween = new Konva.Tween({ node, duration: seconds, rotation: r.base.rotation + 360 });
    else if (a.effect === "growShrink") r.tween = new Konva.Tween({ node, duration: seconds, scaleX: r.base.scale * 1.5, scaleY: r.base.scale * 1.5, easing: Konva.Easings.EaseOut });
    r.tween?.play();
  };

  const finish = (r: Running) => {
    if (r.done) return;
    start(r);
    r.done = true;
    r.tween?.destroy();
    const node = r.node;
    const b = r.base;
    if (!node || !b) return;
    const a = r.it.anim;
    const scale = a.effect === "growShrink" ? b.scale * 1.5 : b.scale;
    node.setAttrs({ x: b.x, y: b.y, rotation: b.rotation, opacity: 1, scaleX: scale, scaleY: scale });
    clearClip(node);
    if (a.kind === "exit") node.visible(false);
  };

  const tick = (now: number) => {
    const t = now - t0;
    for (const r of runs) {
      if (r.done || t < r.it.start) continue;
      start(r);
      const dur = r.it.end - r.it.start;
      const p = dur > 0 ? (t - r.it.start) / dur : 1;
      if (p >= 1) {
        finish(r);
        continue;
      }
      if (r.tween || !r.node || !r.base) continue;
      const f = effectFrame(r.it.anim, p, r.base, slide);
      r.node.setAttrs({ x: f.x, y: f.y, rotation: f.rotation, opacity: f.opacity, scaleX: f.scale, scaleY: f.scale });
      if (f.clip && r.node instanceof Konva.Container) r.node.clip(f.clip);
    }
    redraw(stage);
    if (runs.every((r) => r.done) && t >= offset) {
      over = true;
      onDone();
      return;
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
