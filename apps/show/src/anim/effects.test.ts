import { describe, expect, it } from "vitest";
import type { Animation } from "../generated/Animation";
import en from "../locales/en.json";
import de from "../locales/de.json";
import {
  ANIMATION_KINDS, EFFECTS, TRANSITION_KINDS, animationDirectionKey, animationError, applyAnimationPatch, badgesByShape, changeTransition,
  clickNumbers, effectDefaultDirection, effectDirections, effectKey, effectPatch, effectSupports, effectsOf, hasEffects, msToMmss,
  msToSeconds, newAnimation, newTransition, parseMmss, reorderTarget, secondsToMs, transitionDefaultDirection, transitionDefaultDuration, transitionGalleryDirection, effectiveTransitionDirection,
  transitionDirectionKey, transitionDirections, transitionKey, triggerKey, TRIGGERS, galleryKey, transitionOptions, transitionOptionKey,
} from "./effects";

const anim = (id: number, shape: number, trigger: Animation["trigger"] = "onClick", extra: Partial<Animation> = {}): Animation => ({
  ...newAnimation(shape, "entrance", "fade"),
  id,
  trigger,
  ...extra,
});

describe("transition rules (mirror of anim.rs)", () => {
  it("default directions are among the kind's directions; kinds without directions have none", () => {
    for (const k of TRANSITION_KINDS) {
      const d = transitionDefaultDirection(k);
      if (d) expect(transitionDirections(k)).toContain(d);
      else expect(transitionDirections(k)).toEqual([]);
    }
    expect(transitionDirections("push")).toEqual(["left", "up", "right", "down"]);
    expect(transitionDirections("cover")).toHaveLength(8);
    expect(transitionDirections("split")).toEqual(["horizontalOut", "horizontalIn", "verticalOut", "verticalIn"]);
    expect(transitionDirections("zoom")).toEqual(["in", "out"]);
  });

  it("PowerPoint's default durations", () => {
    const ecma = ["none", "fade", "push", "wipe", "cover", "split", "cut", "zoom"] as const;
    expect(ecma.map(transitionDefaultDuration)).toEqual([0, 700, 1000, 1000, 1000, 1500, 0, 500]);
    // PowerPoint 2010+ kinds (P9-S4)
    expect(transitionDefaultDuration("vortex")).toBe(3000);
    expect(transitionDefaultDuration("cube")).toBe(1000);
    expect(TRANSITION_KINDS).toHaveLength(32);
    expect(newTransition("fade")).toEqual({ kind: "fade", durationMs: 700, advanceOnClick: true });
  });

  it("a new kind resets duration and direction but keeps the advance settings", () => {
    const push = { ...newTransition("push"), direction: "up" as const, durationMs: 2500, advanceOnClick: false, advanceAfterMs: 3000 };
    expect(changeTransition(push, { kind: "fade" })).toEqual({ kind: "fade", durationMs: 700, advanceOnClick: false, advanceAfterMs: 3000 });
    expect(changeTransition(undefined, { kind: "split" })).toEqual({ kind: "split", durationMs: 1500, advanceOnClick: true, direction: "verticalOut" });
  });

  it("a transition chosen in the gallery starts with PowerPoint's Effect Options (P8-45 S-17)", () => {
    expect(changeTransition(undefined, { kind: "push" })?.direction).toBe("up"); // From Bottom
    expect(changeTransition(undefined, { kind: "split" })?.direction).toBe("verticalOut");
    expect(changeTransition(undefined, { kind: "zoom" })?.direction).toBe("in");
    // Wipe and Cover start From Right: the format's default, not written
    expect(changeTransition(undefined, { kind: "wipe" })?.direction).toBeUndefined();
    expect(changeTransition(undefined, { kind: "cover" })?.direction).toBeUndefined();
    expect(changeTransition(undefined, { kind: "fade" })?.direction).toBeUndefined();
    for (const k of ["push", "split", "zoom"] as const) {
      const d = transitionGalleryDirection(k)!;
      expect(transitionDirections(k)).toContain(d);
      expect(effectiveTransitionDirection(changeTransition(undefined, { kind: k })!)).toBe(d);
    }
    // the file format's default for a transition without a direction is unchanged (reading files)
    expect(transitionDefaultDirection("push")).toBe("left");
  });

  it("a direction the kind does not accept is ignored", () => {
    const push = newTransition("push");
    expect(changeTransition(push, { direction: "leftUp" })).toBe(push);
    expect(changeTransition(push, { direction: "down" })).toEqual({ ...push, direction: "down" });
    expect(changeTransition(newTransition("cover"), { direction: "leftUp" })?.direction).toBe("leftUp");
    expect(changeTransition(undefined, { direction: "left" })).toBeNull();
  });

  it("no effect + advance on click only is no transition; timings make one", () => {
    expect(changeTransition(newTransition("fade"), { kind: "none" })).toBeNull();
    const t = changeTransition(undefined, { advanceAfterMs: 5000 });
    expect(t).toEqual({ kind: "none", durationMs: 0, advanceOnClick: true, advanceAfterMs: 5000 });
    expect(changeTransition(t!, { advanceAfterMs: null })).toBeNull();
    expect(changeTransition(undefined, { advanceOnClick: false })).toMatchObject({ kind: "none", advanceOnClick: false });
    expect(changeTransition(newTransition("fade"), { durationMs: -5 })?.durationMs).toBe(0);
    expect(changeTransition(newTransition("fade"), { durationMs: 1234.4 })?.durationMs).toBe(1234);
  });
});

describe("animation rules (mirror of anim.rs)", () => {
  it("emphasis effects only for emphasis, the others only for entrance and exit", () => {
    // PowerPoint's galleries (P9-S4); the Shape effects are one item (circle)
    const entrance = ["appear", "fade", "flyIn", "float", "split", "wipe", "circle", "wheel", "randomBars", "growTurn", "zoom", "swivel", "bounce"];
    expect(effectsOf("entrance")).toEqual(entrance);
    expect(effectsOf("exit")).toEqual(entrance);
    expect(effectsOf("emphasis")).toEqual([
      "pulse", "colorPulse", "teeter", "spin", "growShrink", "desaturate", "darken", "lighten", "transparency",
      "objectColor", "lineColor", "fillColor", "brushColor", "fontColor", "underline", "boldFlash", "boldReveal", "wave",
    ]);
    expect(effectsOf("path")).toEqual(["pathLines", "pathArcs", "pathTurns", "pathShapes", "pathLoops", "pathCustom"]);
    for (const e of EFFECTS) for (const k of ANIMATION_KINDS) expect(animationError({ kind: k, effect: e }) === null).toBe(effectSupports(e, k));
  });

  it("directions: fly 8, wipe 4 (no diagonals), the rest none; defaults fit", () => {
    expect(effectDirections("flyIn")).toHaveLength(8);
    expect(effectDirections("wipe")).toEqual(["down", "left", "right", "up"]);
    for (const e of EFFECTS) {
      const d = effectDefaultDirection(e);
      if (d) expect(effectDirections(e)).toContain(d);
    }
    expect(animationError({ kind: "exit", effect: "wipe", direction: "leftUp" })).toMatch(/direction/);
    expect(animationError({ kind: "exit", effect: "wipe", direction: "up" })).toBeNull();
    expect(animationError({ kind: "entrance", effect: "fade", direction: "up" })).toMatch(/direction/);
  });

  it("the gallery patch: new default duration, direction reset when it does not fit", () => {
    const fly = { ...anim(5, 2), effect: "flyIn" as const, direction: "leftUp" as const, durationMs: 900 };
    expect(effectPatch(fly, "entrance", "wipe")).toEqual({ kind: "entrance", effect: "wipe", durationMs: 500, direction: null });
    expect(effectPatch(fly, "exit", "flyIn")).toEqual({ kind: "exit", effect: "flyIn" });
    expect(effectPatch(fly, "emphasis", "spin")).toMatchObject({ durationMs: 2000, direction: null });
    const patched = applyAnimationPatch(fly, effectPatch(fly, "entrance", "wipe"));
    expect(patched).toMatchObject({ effect: "wipe", durationMs: 500 });
    expect(patched.direction).toBeUndefined();
    expect(applyAnimationPatch(fly, { delayMs: 250, trigger: "afterPrevious" })).toMatchObject({ delayMs: 250, trigger: "afterPrevious", direction: "leftUp" });
  });
});

describe("click numbers, badges, reorder", () => {
  it("On Click starts a number, With / After Previous share it, leading ones are 0", () => {
    const list = [anim(1, 2, "withPrevious"), anim(2, 3), anim(3, 4, "withPrevious"), anim(4, 5, "afterPrevious"), anim(5, 2)];
    expect(clickNumbers(list)).toEqual([0, 1, 1, 1, 2]);
    const badges = badgesByShape(list);
    expect(badges.get(2)).toEqual([{ id: 1, n: 0 }, { id: 5, n: 2 }]);
    expect(badges.get(4)).toEqual([{ id: 3, n: 1 }]);
    // Two animations of one shape in the same step: one badge.
    expect(badgesByShape([anim(1, 9), anim(2, 9, "withPrevious")]).get(9)).toEqual([{ id: 1, n: 1 }]);
  });

  it("drop positions become reorderAnimation indices", () => {
    expect(reorderTarget(0, 3, 3)).toBe(2); // first row after the last
    expect(reorderTarget(2, 0, 3)).toBe(0); // last row to the top
    expect(reorderTarget(1, 1, 3)).toBeNull(); // onto itself
    expect(reorderTarget(1, 2, 3)).toBeNull(); // just after itself
    expect(reorderTarget(0, 2, 3)).toBe(1);
    expect(reorderTarget(3, 0, 3)).toBeNull();
    expect(reorderTarget(0, 5, 3)).toBeNull();
  });

  it("the sorter star: a transition or animations", () => {
    expect(hasEffects({ id: 1, layout: "blank", shapes: [] })).toBe(false);
    expect(hasEffects({ id: 1, layout: "blank", shapes: [], transition: newTransition("cut") })).toBe(true);
    expect(hasEffects({ id: 1, layout: "blank", shapes: [], animations: [anim(2, 3)] })).toBe(true);
  });
});

describe("fields", () => {
  it("seconds", () => {
    expect(msToSeconds(700)).toBe("0.7");
    expect(msToSeconds(1250)).toBe("1.25");
    expect(secondsToMs("1,5")).toBe(1500);
    expect(secondsToMs(" 2 ")).toBe(2000);
    expect(secondsToMs("")).toBeNull();
    expect(secondsToMs("-1")).toBeNull();
    expect(secondsToMs("abc")).toBeNull();
  });

  it("mm:ss of the After field", () => {
    expect(msToMmss(0)).toBe("00:00.00");
    expect(msToMmss(5000)).toBe("00:05.00");
    expect(msToMmss(83_500)).toBe("01:23.50");
    expect(parseMmss("01:23.5")).toBe(83_500);
    expect(parseMmss("00:05")).toBe(5000);
    expect(parseMmss("7")).toBe(7000);
    expect(parseMmss("2,5")).toBe(2500);
    expect(parseMmss("1:2:3")).toBeNull();
    expect(parseMmss("x")).toBeNull();
  });
});

describe("labels", () => {
  it("every menu label exists in both catalogs", () => {
    const keys = new Set<string>();
    for (const k of TRANSITION_KINDS) {
      keys.add(transitionKey(k));
      transitionDirections(k).forEach((d) => keys.add(transitionDirectionKey(d, k)));
      transitionOptions(k).forEach((o) => keys.add(transitionOptionKey(o)));
    }
    for (const kind of ANIMATION_KINDS)
      for (const e of effectsOf(kind)) {
        keys.add(effectKey(e, kind));
        effectDirections(e).forEach((d) => keys.add(animationDirectionKey(d, kind, e)));
        keys.add(galleryKey(e, kind));
      }
    TRIGGERS.forEach((t) => keys.add(triggerKey(t)));
    for (const k of keys) {
      expect(en, k).toHaveProperty([k]);
      expect(de, k).toHaveProperty([k]);
    }
    expect(effectKey("appear", "exit")).toBe("show.fx.disappear");
    expect(effectKey("flyIn", "exit")).toBe("show.fx.flyOut");
    // The transition menu names the side the slide comes from; animations the side of the shape.
    expect((en as Record<string, string>)[transitionDirectionKey("left")]).toBe("From Right");
    expect((en as Record<string, string>)[animationDirectionKey("down", "entrance")]).toBe("From Bottom");
    expect((en as Record<string, string>)[animationDirectionKey("leftUp", "exit")]).toBe("To Top-Left");
  });
});
