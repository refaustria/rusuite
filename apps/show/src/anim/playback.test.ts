import { describe, expect, it } from "vitest";
import type { Animation } from "../generated/Animation";
import type { Slide } from "../generated/Slide";
import { newAnimation, newTransition } from "./effects";
import { autoAdvanceDelay, clickGroups, clickSteps, dirVector, effectFrame, hiddenShapes, shapeStates, transitionFrames } from "./playback";

let seq = 100;
const a = (shape: number, extra: Partial<Animation> = {}): Animation => ({ ...newAnimation(shape, "entrance", "fade"), id: seq++, ...extra });
const slideWith = (animations: Animation[], extra: Partial<Slide> = {}): Slide => ({ id: 1, layout: "blank", shapes: [], animations, ...extra });

describe("click groups", () => {
  it("one group per On Click; leading With / After Previous ones play automatically", () => {
    const s = slideWith([a(2, { trigger: "afterPrevious" }), a(3), a(4, { trigger: "withPrevious" }), a(5)]);
    const g = clickGroups(s);
    expect(g.map((x) => x.items.map((i) => i.anim.shape))).toEqual([[2], [3, 4], [5]]);
    expect(clickSteps(s)).toBe(2);
    expect(clickGroups(slideWith([]))).toEqual([{ items: [], durationMs: 0 }]);
    expect(clickSteps({})).toBe(0);
  });

  it("timelines: With Previous starts with the previous one, After Previous when it ends, plus delays", () => {
    const s = slideWith([
      a(2, { durationMs: 500, delayMs: 100 }),
      a(3, { trigger: "withPrevious", durationMs: 1000, delayMs: 200 }),
      a(4, { trigger: "afterPrevious", durationMs: 300, delayMs: 50 }),
      a(5, { trigger: "afterPrevious", effect: "appear", durationMs: 999 }),
    ]);
    const [, g] = clickGroups(s);
    expect(g!.items.map((i) => [i.start, i.end])).toEqual([
      [100, 600],
      [200, 1200],
      [1250, 1550],
      [1550, 1550], // Appear is instant
    ]);
    expect(g!.durationMs).toBe(1550);
  });
});

describe("shape states per step (rebuild for ←)", () => {
  const s = slideWith([
    a(2),
    a(3, { trigger: "withPrevious" }),
    a(2, { kind: "emphasis", effect: "growShrink" }),
    a(2, { kind: "exit", effect: "fade" }),
    a(9, { kind: "exit", effect: "appear", trigger: "withPrevious" }),
  ]);
  it("entrance shapes start hidden, exits hide, Grow/Shrink scales 150 %", () => {
    expect(hiddenShapes(shapeStates(s, 0))).toEqual([2, 3]);
    expect(hiddenShapes(shapeStates(s, 1))).toEqual([2, 3]); // group 0 (automatic) is empty
    expect(hiddenShapes(shapeStates(s, 2))).toEqual([]);
    expect(shapeStates(s, 3).get(2)).toEqual({ visible: true, scale: 1.5 });
    expect(hiddenShapes(shapeStates(s, 4))).toEqual([2, 9]);
    expect(hiddenShapes(shapeStates(s, 99))).toEqual([2, 9]);
  });

  it("a shape whose first animation is an exit or emphasis starts visible", () => {
    const st = shapeStates(slideWith([a(7, { kind: "exit" }), a(8, { kind: "emphasis", effect: "spin" })]), 0);
    expect(st.get(7)?.visible).toBe(true);
    expect(st.get(8)).toEqual({ visible: true, scale: 1 });
  });
});

describe("effect frames", () => {
  const base = { x: 400, y: 300, width: 200, height: 100, rotation: 0, scale: 1 };
  const slide = { width: 1280, height: 720 };
  it("fade and zoom go from nothing to the resting state; exits the other way", () => {
    expect(effectFrame(a(1), 0, base, slide).opacity).toBe(0);
    expect(effectFrame(a(1), 1, base, slide)).toEqual({ opacity: 1, x: 400, y: 300, scale: 1, rotation: 0 });
    expect(effectFrame(a(1, { kind: "exit" }), 1, base, slide).opacity).toBe(0);
    const z = effectFrame(a(1, { effect: "zoom" }), 0, base, slide);
    expect([z.opacity, z.scale]).toEqual([0, 0]);
    expect(effectFrame(a(1, { effect: "appear" }), 0, base, slide).opacity).toBe(0);
    expect(effectFrame(a(1, { effect: "appear" }), 0.01, base, slide).opacity).toBe(1);
  });

  it("fly comes from outside the slide on its side", () => {
    const fromBottom = effectFrame(a(1, { effect: "flyIn" }), 0, base, slide);
    expect([fromBottom.x, fromBottom.y]).toEqual([400, 720 + 50]);
    const fromTopLeft = effectFrame(a(1, { effect: "flyIn", direction: "leftUp" }), 0, base, slide);
    expect([fromTopLeft.x, fromTopLeft.y]).toEqual([-100, -50]);
    const outRight = effectFrame(a(1, { kind: "exit", effect: "flyIn", direction: "right" }), 1, base, slide);
    expect([outRight.x, outRight.y]).toEqual([1280 + 100, 300]);
    expect(effectFrame(a(1, { effect: "flyIn" }), 1, base, slide)).toMatchObject({ x: 400, y: 300 });
    expect(dirVector("rightDown")).toEqual([1, 1]);
    expect(dirVector(undefined)).toEqual([0, 0]);
  });

  it("wipe clips the box from its side", () => {
    expect(effectFrame(a(1, { effect: "wipe" }), 1, base, slide).clip).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    const half = effectFrame(a(1, { effect: "wipe", direction: "left" }), 0.5, base, slide).clip!;
    expect(half.x).toBe(0);
    expect(half.width).toBeCloseTo(150); // ease-out: 75 % in at half time
    const fromBottom = effectFrame(a(1, { effect: "wipe" }), 0, base, slide).clip!;
    expect(fromBottom.y).toBeCloseTo(100, 1);
    expect(fromBottom.height).toBeGreaterThan(0); // never a zero clip (= none)
  });

  it("emphasis: spin one turn, grow to 150 %", () => {
    const spin = a(1, { kind: "emphasis", effect: "spin" });
    expect(effectFrame(spin, 0.5, { ...base, rotation: 10 }, slide).rotation).toBe(190);
    expect(effectFrame(a(1, { kind: "emphasis", effect: "growShrink" }), 1, { ...base, scale: 2 }, slide).scale).toBe(3);
  });
});

describe("transition parameterisation", () => {
  it("fade, push and cover move with the direction of motion", () => {
    expect(transitionFrames(newTransition("fade"))).toMatchObject({ incoming: [{ opacity: 0 }, { opacity: 1 }], outgoing: null, durationMs: 700 });
    const push = transitionFrames({ ...newTransition("push"), direction: "left" });
    expect(push.incoming).toEqual([{ transform: "translate(100%, 0%)" }, { transform: "translate(0%, 0%)" }]);
    expect(push.outgoing).toEqual([{ transform: "translate(0%, 0%)" }, { transform: "translate(-100%, 0%)" }]);
    const cover = transitionFrames({ ...newTransition("cover"), direction: "rightDown" });
    expect(cover.incoming![0]).toEqual({ transform: "translate(-100%, -100%)" });
    expect(cover.outgoing).toBeNull();
    // No direction: the kind's default (left).
    expect(transitionFrames(newTransition("push")).incoming![0]).toEqual({ transform: "translate(100%, 0%)" });
  });

  it("wipe and split clip; In variants close the old slide on top", () => {
    expect(transitionFrames({ ...newTransition("wipe"), direction: "up" }).incoming![0]).toEqual({ clipPath: "inset(100% 0 0 0)" });
    expect(transitionFrames({ ...newTransition("wipe"), direction: "right" }).incoming![0]).toEqual({ clipPath: "inset(0 100% 0 0)" });
    const out = transitionFrames(newTransition("split"));
    expect(out.incoming![0]).toEqual({ clipPath: "inset(50% 0 50% 0)" });
    const vin = transitionFrames({ ...newTransition("split"), direction: "verticalIn" });
    expect(vin).toMatchObject({ incoming: null, outgoingOnTop: true, durationMs: 1500 });
    expect(vin.outgoing![1]).toEqual({ clipPath: "inset(0 50% 0 50%)" });
  });

  it("zoom in grows the new slide, out shrinks the old one; cut, none and 0 ms are instant", () => {
    expect(transitionFrames({ ...newTransition("zoom"), direction: "in" }).incoming![0]).toEqual({ transform: "scale(0.3)", opacity: 0 });
    expect(transitionFrames(newTransition("zoom"))).toMatchObject({ incoming: null, outgoingOnTop: true });
    for (const t of [newTransition("cut"), newTransition("none"), { ...newTransition("fade"), durationMs: 0 }, null, undefined])
      expect(transitionFrames(t)).toEqual({ incoming: null, outgoing: null, outgoingOnTop: false, durationMs: 0 });
  });
});

describe("auto-advance delay", () => {
  it("waits for the After time, but not less than the transition and the step's animations", () => {
    const s = slideWith([a(2, { trigger: "withPrevious", durationMs: 2000 }), a(3, { durationMs: 4000 })], {
      transition: { ...newTransition("fade"), advanceAfterMs: 3000 },
    });
    expect(autoAdvanceDelay(s, 0)).toBe(3000); // 700 + 2000 < 3000
    expect(autoAdvanceDelay(s, 1)).toBe(4000);
    expect(autoAdvanceDelay({ ...s, transition: newTransition("fade") }, 0)).toBeNull();
    expect(autoAdvanceDelay(slideWith([]), 0)).toBeNull();
    expect(autoAdvanceDelay(slideWith([], { transition: { ...newTransition("none"), advanceAfterMs: 0 } }), 0)).toBe(0);
  });
});
