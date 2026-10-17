// P9-S4: effect galleries → commands, Move Earlier / Later semantics, the
// Animation Painter, spinners, motion paths, paragraph builds, triggers,
// media commands, the new effect frames and transitions, the back rule.

import { describe, expect, it } from "vitest";
import type { Animation } from "../generated/Animation";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import {
  applyAnimationPatch, changeTransition, clampDelay, clampDuration, clickNumbers, defaultPath, effectiveAmount, effectiveColor, effectivePath,
  effectsOf, moveOrder, newAnimation, newTransition, paintedAnimations, spinMs, transitionGalleryDirection, transitionOptions,
} from "./effects";
import { drawnPath, formatPath, moveVertex, parsePath, pathEnd, pointAt, reversePath, vertices } from "./motion";
import {
  buildSteps, clickGroups, clickSteps, effectFrame, firedGroups, mediaCommands, passProgress, playDuration, playsTransition, revealGeometry, shapeStates,
  startOnKey, transitionFrames, triggerSequences,
} from "./playback";
import { mixColor } from "./driver";
import { timingPatch, trimOf, clockToMs, msToClock } from "../ui/AnimDialogs";
import { addBookmark } from "../media/PlaybackTab";
import { fadeVolume, passedBookmarks } from "../present/ShowOverlay";

let seq = 500;
const anim = (shape: number, extra: Partial<Animation> = {}): Animation => ({ ...newAnimation(shape, "entrance", "fade"), id: seq++, ...extra });

const textShape = (id: number, paras: [number, string][]): Shape => ({
  id,
  name: `Text ${id}`,
  transform: { x: 0, y: 0, w: 914400, h: 914400 },
  kind: {
    kind: "auto",
    value: {
      geometry: "rect",
      text: {
        props: { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" },
        paragraphs: paras.map(([level, text]) => ({ props: { level }, runs: [{ text }] })),
      },
    },
  },
} as unknown as Shape);

const clipShape = (id: number): Shape => ({
  id,
  name: "Video",
  transform: { x: 0, y: 0, w: 914400, h: 914400 },
  kind: { kind: "media", value: { kind: "video", media: 1, start: "inClickSequence" } },
} as unknown as Shape);

const slideOf = (animations: Animation[], shapes: Shape[] = []): Slide => ({ id: 1, layout: "blank", shapes, animations });

describe("galleries and commands", () => {
  it("every gallery effect of a kind makes a valid new animation with PowerPoint's defaults", () => {
    for (const kind of ["entrance", "emphasis", "exit", "path"] as const)
      for (const e of effectsOf(kind)) {
        const a = newAnimation(7, kind, e);
        expect(a.durationMs).toBeGreaterThanOrEqual(0);
        if (kind === "path") expect(e === "pathCustom" || !!effectivePath(a)).toBe(true);
      }
    expect(newAnimation(7, "entrance", "float").durationMs).toBe(1000);
    expect(effectiveAmount(newAnimation(7, "emphasis", "spin"))).toBe(360);
    expect(effectiveColor(newAnimation(7, "emphasis", "fontColor"))).toBe("FF0000");
    expect(defaultPath("pathLines", "right")).toBe("M 0 0 L 0.25 0 E");
  });

  it("a patch drops the options the new effect does not take (like AnimationPatch::apply_to)", () => {
    const t = anim(3, { kind: "emphasis", effect: "transparency", amount: 80 });
    expect(applyAnimationPatch(t, { effect: "fontColor" })).not.toHaveProperty("amount");
    const p = anim(3, { kind: "path", effect: "pathLines", path: "M 0 0 L 1 1 E" });
    expect(applyAnimationPatch(p, { effect: "pathArcs" })).not.toHaveProperty("path");
    expect(applyAnimationPatch(p, { build: { level: 1 }, repeat: { kind: "untilNextClick" }, autoReverse: true })).toMatchObject({
      build: { level: 1 },
      repeat: { kind: "untilNextClick" },
      autoReverse: true,
    });
    expect(applyAnimationPatch({ ...p, startOn: { kind: "click", value: 4 } }, { startOn: null })).not.toHaveProperty("startOn");
  });

  it("transitions: options, gallery picks of the new kinds, the sound kept on a new kind", () => {
    expect(transitionOptions("glitter")).toEqual(["diamonds", "hexagons"]);
    expect(transitionGalleryDirection("switch")).toBe("right");
    expect(transitionGalleryDirection("cube")).toBeUndefined();
    const withSound = { ...newTransition("fade"), sound: { kind: "stopPrevious" as const } };
    expect(changeTransition(withSound, { kind: "cube" })).toMatchObject({ kind: "cube", durationMs: 1000, sound: { kind: "stopPrevious" } });
    expect(changeTransition(newTransition("glitter"), { option: "hexagons" })?.option).toBe("hexagons");
    expect(changeTransition(newTransition("fade"), { option: "hexagons" })).toEqual(newTransition("fade"));
    expect(changeTransition(newTransition("fade"), { durationMs: 99_000 })?.durationMs).toBe(59_000);
    // a sound alone is a transition
    expect(changeTransition(withSound, { kind: "none" })).toMatchObject({ kind: "none", sound: { kind: "stopPrevious" } });
  });

  it("spinners keep PowerPoint's limits and step by 0.25 s", () => {
    expect(clampDuration(0)).toBe(10);
    expect(clampDuration(70_000)).toBe(59_000);
    expect(clampDelay(-5)).toBe(0);
    expect(spinMs(500, true, 10)).toBe(750);
    expect(spinMs(600, true, 10)).toBe(750);
    expect(spinMs(600, false, 10)).toBe(500);
    expect(spinMs(250, false, 10)).toBe(10);
    expect(spinMs(58_900, true, 10)).toBe(59_000);
  });
});

describe("Move Earlier / Later and the Animation Painter", () => {
  it("With / After Previous rows swap with their neighbour and keep their Start", () => {
    const a = anim(1);
    const b = anim(2, { trigger: "withPrevious" });
    const c = anim(3);
    const list = [a, b, c];
    expect(moveOrder(list, b.id, -1)).toEqual([b.id, a.id, c.id]);
    expect(moveOrder(list, b.id, 1)).toEqual([a.id, c.id, b.id]);
    expect(moveOrder(list, a.id, -1)).toBeNull();
  });

  it("an On Click row moves its whole step past the neighbouring step", () => {
    const a = anim(1);
    const a2 = anim(2, { trigger: "afterPrevious" });
    const b = anim(3);
    const b2 = anim(4, { trigger: "withPrevious" });
    const c = anim(5);
    const list = [a, a2, b, b2, c];
    expect(moveOrder(list, b.id, -1)).toEqual([b.id, b2.id, a.id, a2.id, c.id]);
    expect(moveOrder(list, a.id, 1)).toEqual([b.id, b2.id, a.id, a2.id, c.id]);
    expect(moveOrder(list, c.id, 1)).toBeNull();
    // the result of the click numbers: the step moved, its members came along
    const moved = moveOrder(list, b.id, -1)!.map((id) => list.find((x) => x.id === id)!);
    expect(clickNumbers(moved)).toEqual([1, 1, 2, 2, 3]);
  });

  it("triggered animations move only within their trigger's sequence", () => {
    const a = anim(1);
    const t1 = anim(2, { startOn: { kind: "click", value: 9 } });
    const t2 = anim(3, { startOn: { kind: "click", value: 9 } });
    const b = anim(4);
    const list = [a, b, t1, t2];
    expect(moveOrder(list, t2.id, -1)).toEqual([a.id, b.id, t2.id, t1.id]);
    expect(moveOrder(list, t1.id, -1)).toBeNull();
    expect(moveOrder(list, b.id, 1)).toBeNull();
    expect(clickNumbers(list)).toEqual([1, 2, 1, 2]);
  });

  it("the painter copies the source's set onto the target, replacing the target's", () => {
    const src = [anim(1, { effect: "flyIn", build: { level: 1 } }), anim(1, { kind: "emphasis", effect: "spin", startOn: { kind: "click", value: 1 } })];
    const old = anim(2, { effect: "wipe" });
    const plan = paintedAnimations([...src, old], 1, 2, false);
    expect(plan.remove).toEqual([old.id]);
    expect(plan.add.map((a) => [a.id, a.shape, a.effect])).toEqual([
      [0, 2, "flyIn"],
      [0, 2, "spin"],
    ]);
    expect(plan.add[0]).not.toHaveProperty("build");
    expect(plan.add[1]!.startOn).toEqual({ kind: "click", value: 2 });
    expect(paintedAnimations(src, 1, 3, true).add[0]!.build).toEqual({ level: 1 });
  });
});

describe("motion paths", () => {
  it("parses PowerPoint's paths and writes them back", () => {
    const p = parsePath("M -4.16667E-6 -4.07407E-6 L 0.21823 0.28704 E")!;
    expect(p).toHaveLength(2);
    expect(formatPath(p)).toBe("M 0 0 L 0.21823 0.28704 E");
    expect(parsePath("m 0.1,0.1 l 0.1 0 0 0.1")).toEqual([
      { c: "M", x: 0.1, y: 0.1 },
      { c: "L", x: 0.2, y: 0.1 },
      { c: "L", x: 0.2, y: 0.2 },
    ]);
    for (const bad of ["", "L 0 0", "M 0", "M 0 0 Q 1 1", "M a b"]) expect(parsePath(bad), bad).toBeNull();
  });

  it("points along the path by length, its end, vertices, reverse", () => {
    const p = parsePath("M 0 0 L 0.2 0 L 0.2 0.2 E")!;
    expect(pointAt(p, 0.5)).toEqual({ x: 0.2, y: 0 });
    expect(pathEnd(p)).toEqual({ x: 0.2, y: 0.2 });
    expect(vertices(p).map((v) => v.index)).toEqual([0, 1, 2]);
    const moved = moveVertex(p, 2, 0.1, 0);
    expect(pathEnd(moved)).toEqual({ x: 0.30000000000000004, y: 0.2 });
    expect(formatPath(reversePath(p))).toBe("M 0 0 L 0 -0.2 L -0.2 -0.2 E");
    const c = parsePath("M 0 0 C 0 0.1 0.1 0.1 0.1 0 E")!;
    expect(formatPath(moveVertex(c, 1, 0.1, 0))).toBe("M 0 0 C 0 0.1 0.2 0.1 0.2 0 E");
  });

  it("a drawn Custom Path starts at 0 0 in slide fractions", () => {
    const pts = [{ x: 100, y: 100 }, { x: 101, y: 100 }, { x: 228, y: 172 }, { x: 356, y: 244 }];
    expect(drawnPath(pts, { width: 1280, height: 720 })).toBe("M 0 0 L 0.1 0.1 L 0.2 0.2 E");
    expect(drawnPath([{ x: 1, y: 1 }], { width: 10, height: 10 })).toBeNull();
  });
});

describe("paragraph builds, triggers and media in the show", () => {
  const body = textShape(5, [[0, "One"], [1, "Detail"], [0, ""], [0, "Two"]]);

  it("builds by 1st level paragraphs: one click per step, empty paragraphs skipped, reverse order", () => {
    expect(buildSteps([{ level: 0, text: "a" }, { level: 1, text: "b" }, { level: 0, text: "" }, { level: 0, text: "c" }], { level: 1 })).toEqual([[0, 1], [3]]);
    expect(buildSteps([{ level: 0, text: "a" }, { level: 1, text: "b" }], { level: 2 })).toEqual([[0], [1]]);
    expect(buildSteps([{ level: 0, text: "a" }, { level: 1, text: "b" }], { level: 0 })).toEqual([[0, 1]]);
    expect(buildSteps([{ level: 0, text: "a" }, { level: 0, text: "b" }], { level: 1, reverse: true })).toEqual([[1], [0]]);
    const s = slideOf([anim(5, { effect: "float", build: { level: 1 } })], [body]);
    expect(clickSteps(s)).toBe(2);
    expect(clickGroups(s)[1]!.items[0]!.paras).toEqual([0, 1]);
    expect(shapeStates(s, 0).get(5)).toMatchObject({ visible: true, hiddenParas: [0, 1, 3] });
    expect(shapeStates(s, 2).get(5)?.hiddenParas).toEqual([3]);
    expect(shapeStates(s, 3).get(5)?.hiddenParas).toBeUndefined();
  });

  it("an attached shape hides the shape too; After Previous builds play on their own", () => {
    const s = slideOf([anim(5, { trigger: "afterPrevious", build: { level: 1, animateBackground: true } })], [body]);
    expect(clickSteps(s)).toBe(0);
    expect(shapeStates(s, 0).get(5)?.visible).toBe(false);
    expect(clickGroups(s)[0]!.items.map((i) => [i.bg ?? false, i.paras ?? null])).toEqual([
      [true, null],
      [false, [0, 1]],
      [false, [3]],
    ]);
  });

  it("triggered animations leave the click sequence; each fire plays the trigger's next step", () => {
    const t = anim(6, { kind: "emphasis", effect: "spin", startOn: { kind: "click", value: 5 } });
    const t2 = anim(6, { kind: "exit", effect: "fade", startOn: { kind: "click", value: 5 } });
    const s = slideOf([anim(5), t, t2], [body]);
    expect(clickSteps(s)).toBe(1);
    const seqs = triggerSequences(s);
    expect(seqs.map((x) => [x.key, x.groups.length])).toEqual([["click:5", 2]]);
    expect(startOnKey({ kind: "bookmark", value: { shape: 3, name: "B 1" } })).toBe("bmk:3:B 1");
    expect(firedGroups(s, ["click:5"])).toHaveLength(1);
    expect(shapeStates(s, 1, ["click:5", "click:5"]).get(6)).toMatchObject({ visible: false, rotation: 360 });
  });

  it("media commands: In Click Sequence plays, Pause toggles, Stop stops", () => {
    const clip = clipShape(9);
    const s = slideOf([anim(9, { kind: "media", effect: "mediaPause", trigger: "onClick" }), anim(9, { kind: "media", effect: "mediaStop" })], [clip]);
    // steps: pause, stop, then the clip's own click step
    expect(clickSteps(s)).toBe(3);
    expect(mediaCommands(s, 1).get(9)).toBe("pause");
    expect(mediaCommands(s, 2).get(9)).toBe("stop");
    expect(mediaCommands(s, 3).get(9)).toBe("play");
  });
});

describe("effect frames and timing", () => {
  const base = { x: 400, y: 300, width: 200, height: 100, rotation: 0, scale: 1 };
  const slide = { width: 1280, height: 720 };

  it("auto-reverse and repeats fold into one pass; the timeline grows with them", () => {
    const a = anim(1, { kind: "emphasis", effect: "spin", autoReverse: true, repeat: { kind: "times", value: 2000 } });
    expect(playDuration({ ...a, durationMs: 1000 })).toBe(4000);
    expect(passProgress(a, 0.125)).toBeCloseTo(0.5);
    expect(passProgress(a, 0.25)).toBeCloseTo(1);
    expect(passProgress(a, 0.5)).toBeCloseTo(0);
    expect(playDuration(anim(1, { iterate: { unit: "letter", delayPct: 10000 }, durationMs: 1000 }), 11)).toBe(2000);
  });

  it("entrances: float rises, grow & turn turns, zoom from the slide centre, shapes reveal", () => {
    expect(effectFrame(anim(1, { effect: "float" }), 0, base, slide)).toMatchObject({ opacity: 0, y: 300 + 72 });
    expect(effectFrame(anim(1, { effect: "growTurn" }), 0, base, slide)).toMatchObject({ scale: 0, rotation: -90 });
    expect(effectFrame(anim(1, { effect: "zoom", direction: "slideCenter" }), 0, base, slide)).toMatchObject({ x: 640, y: 360 });
    expect(effectFrame(anim(1, { effect: "circle", direction: "out" }), 1, base, slide).reveal).toMatchObject({ shape: "circle", q: 1, inward: false });
    expect(effectFrame(anim(1, { effect: "split" }), 0.5, base, slide).reveal?.shape).toBe("split");
    expect(effectFrame(anim(1, { effect: "wheel", amount: 4 }), 0.5, base, slide).reveal?.spokes).toBe(4);
    expect(effectFrame(anim(1, { kind: "exit", effect: "bounce" }), 1, base, slide).opacity).toBe(0);
  });

  it("emphasis: colours tint, transparency fades, motion paths move by slide fractions", () => {
    expect(effectFrame(anim(1, { kind: "emphasis", effect: "fillColor", color: "00B050" }), 0.5, base, slide).tint).toEqual({ target: "fill", color: "#00B050", t: 0.5 });
    expect(effectFrame(anim(1, { kind: "emphasis", effect: "transparency", amount: 50 }), 1, base, slide).opacity).toBe(0.5);
    expect(effectFrame(anim(1, { kind: "emphasis", effect: "desaturate" }), 1, base, slide).filter).toEqual({ kind: "gray", t: 1 });
    const path = anim(1, { kind: "path", effect: "pathLines", direction: "right" });
    expect(effectFrame(path, 1, base, slide)).toMatchObject({ x: 400 + 320, y: 300 });
    expect(shapeStates(slideOf([path]), 2).get(1)).toMatchObject({ dx: 0.25, dy: 0 });
    expect(mixColor("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  it("reveal masks: box out grows from the centre; random bars show more bars over time", () => {
    const g = revealGeometry({ shape: "box", q: 0.5 }, 200, 100);
    expect(g.rects[0]).toEqual({ x: 50, y: 25, w: 100, h: 50 });
    expect(g.inverse).toBe(false);
    expect(revealGeometry({ shape: "box", q: 0.5, inward: true }, 200, 100).inverse).toBe(true);
    expect(revealGeometry({ shape: "bars", q: 0.5 }, 200, 100).rects).toHaveLength(12);
  });
});

describe("transitions in the show", () => {
  it("the PowerPoint 2010+ kinds have keyframes; Morph plays as a fade", () => {
    for (const kind of ["vortex", "ripple", "honeycomb", "glitter", "shred", "switch", "flip", "gallery", "cube", "doors", "box", "reveal", "fallOver", "drape", "curtains", "wind", "prestige", "fracture", "crush", "peelOff", "pageCurl", "airplane", "origami"] as const) {
      const f = transitionFrames(newTransition(kind));
      expect(f.durationMs, kind).toBeGreaterThan(0);
      expect(f.incoming ?? f.outgoing, kind).not.toBeNull();
    }
    expect(transitionFrames(newTransition("morph")).incoming).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(transitionFrames({ ...newTransition("cube"), direction: "up" }).stage).toEqual({ background: "#000" });
  });

  it("only forward moves play the target's transition (Next, a jump to a later slide); back and jumps back do not", () => {
    expect(playsTransition(0, 1)).toBe(true);
    expect(playsTransition(1, 4)).toBe(true);
    expect(playsTransition(3, 2)).toBe(false);
    expect(playsTransition(-1, 0)).toBe(false);
  });
});

describe("dialogs and the Playback tab", () => {
  it("the Timing dialog sends only what changed, within the limits", () => {
    const a = anim(1);
    expect(timingPatch(a, { trigger: a.trigger, delayMs: 0, durationMs: 500, repeat: null, rewind: false, autoReverse: false, startOn: null, build: null, iterate: null })).toEqual({});
    expect(
      timingPatch(a, { trigger: "afterPrevious", delayMs: 99_000, durationMs: 1, repeat: { kind: "untilNextClick" }, rewind: true, autoReverse: false, startOn: { kind: "click", value: 4 }, build: { level: 2, reverse: true }, iterate: { unit: "word", delayPct: 20000 } }),
    ).toEqual({
      trigger: "afterPrevious",
      delayMs: 59_000,
      durationMs: 10,
      repeat: { kind: "untilNextClick" },
      rewind: true,
      startOn: { kind: "click", value: 4 },
      build: { level: 2, reverse: true },
      iterate: { unit: "word", delayPct: 20000 },
    });
  });

  it("Trim: times, the trim of start / end, invalid ranges", () => {
    expect(msToClock(83_250)).toBe("01:23.250");
    expect(clockToMs("01:23.25")).toBe(83_250);
    expect(clockToMs("2,5")).toBe(2500);
    expect(clockToMs("x")).toBeNull();
    expect(trimOf(800, 2000, 3000)).toEqual({ trimStartMs: 800, trimEndMs: 1000 });
    expect(trimOf(2000, 2000, 3000)).toBeNull();
    expect(trimOf(0, 5000, 3000)).toEqual({ trimStartMs: 0, trimEndMs: 0 });
  });

  it("bookmarks: the next free name, one per time, in time order; passed bookmarks fire once", () => {
    const list = addBookmark({ bookmarks: [{ name: "Bookmark 1", timeMs: 2000 }] }, 500);
    expect(list).toEqual([
      { name: "Bookmark 2", timeMs: 500 },
      { name: "Bookmark 1", timeMs: 2000 },
    ]);
    expect(addBookmark({ bookmarks: list }, 500)).toEqual(list);
    expect(passedBookmarks({ bookmarks: list }, 0.4, 0.6)).toEqual(["Bookmark 2"]);
    expect(passedBookmarks({ bookmarks: list }, 0.6, 0.4)).toEqual([]);
  });

  it("fades ramp the volume in after the trimmed start and out before the trimmed end", () => {
    const c = { volume: 100000, fadeInMs: 1000, fadeOutMs: 1000, trimStartMs: 500, trimEndMs: 500 };
    expect(fadeVolume(c, 0.5, 10)).toBe(0);
    expect(fadeVolume(c, 1, 10)).toBeCloseTo(0.5);
    expect(fadeVolume(c, 5, 10)).toBe(1);
    expect(fadeVolume(c, 9, 10)).toBeCloseTo(0.5);
    expect(fadeVolume({ volume: 50000 }, 3, NaN)).toBe(0.5);
  });
});
