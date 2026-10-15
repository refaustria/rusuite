import { describe, expect, it } from "vitest";
import { clickAction, initialShow, keyAction, reduceShow, type ShowAction, type ShowState } from "./showState";

/** Runs `actions` from `s`; `"exit"` once the show ended. */
function run(s: ShowState | "exit", ...actions: ShowAction[]): ShowState | "exit" {
  for (const a of actions) if (s !== "exit") s = reduceShow(s, a);
  return s;
}
const keys = (...ks: string[]) => ks.map((k) => keyAction(k)!);

describe("slide show state", () => {
  it("steps through the slides, then the end slide, then exits", () => {
    let s = initialShow(3);
    s = run(s, { type: "next" }) as ShowState;
    expect(s.index).toBe(1);
    s = run(s, { type: "next" }, { type: "next" }) as ShowState;
    expect(s).toMatchObject({ index: 2, ended: true });
    expect(run(s, { type: "prev" })).toMatchObject({ index: 2, ended: false });
    expect(run(s, { type: "next" })).toBe("exit");
    expect(run(initialShow(3, 0), { type: "prev" })).toMatchObject({ index: 0 });
    expect(run(initialShow(3, 1), { type: "last" })).toMatchObject({ index: 2, ended: false });
    expect(run(initialShow(3, 2), { type: "first" })).toMatchObject({ index: 0 });
    expect(run(initialShow(3), { type: "goto", index: 9 })).toMatchObject({ index: 2 });
    expect(initialShow(3, 7).index).toBe(2);
  });

  it("blanks black or white; a second press or a step brings the slide back", () => {
    const s = initialShow(3, 1);
    expect(run(s, ...keys("b"))).toMatchObject({ blank: "black", index: 1 });
    expect(run(s, ...keys("b", "B"))).toMatchObject({ blank: "none" });
    expect(run(s, ...keys("W"))).toMatchObject({ blank: "white" });
    expect(run(s, ...keys("b", "w"))).toMatchObject({ blank: "white" });
    // A step on a blank screen only unblanks.
    expect(run(s, ...keys("b", "ArrowRight"))).toMatchObject({ blank: "none", index: 1 });
    expect(run(s, ...keys("w", "ArrowLeft"))).toMatchObject({ blank: "none", index: 1 });
  });

  it("number + Enter jumps to a slide; Enter alone steps", () => {
    const s = initialShow(12);
    expect(run(s, ...keys("1", "0", "Enter"))).toMatchObject({ index: 9, typed: "" });
    expect(run(s, ...keys("9", "9", "Enter"))).toMatchObject({ index: 11 });
    expect(run(s, ...keys("0", "Enter"))).toMatchObject({ index: 0 });
    expect(run(s, ...keys("Enter"))).toMatchObject({ index: 1 });
    // Another key forgets the typed number.
    expect(run(s, ...keys("5", "ArrowRight", "Enter"))).toMatchObject({ index: 2 });
    expect(run(s, ...keys("3", "b", "Enter"))).toMatchObject({ index: 0, blank: "none" });
  });

  it("maps keys and clicks", () => {
    expect(keyAction("Escape")).toEqual({ type: "exit" });
    expect(run(initialShow(3), ...keys("Escape"))).toBe("exit");
    for (const k of ["ArrowRight", "ArrowDown", "PageDown", " ", "n"]) expect(keyAction(k)).toEqual({ type: "next" });
    for (const k of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"]) expect(keyAction(k)).toEqual({ type: "prev" });
    expect(keyAction("Home")).toEqual({ type: "first" });
    expect(keyAction("End")).toEqual({ type: "last" });
    expect(keyAction("7")).toEqual({ type: "digit", digit: "7" });
    expect(keyAction("x")).toBeNull();
    expect(keyAction("F5")).toBeNull();
    expect(clickAction(700, 1000)).toEqual({ type: "next", via: "click" });
    expect(clickAction(300, 1000)).toEqual({ type: "prev" });
  });
});

describe("click steps (animations)", () => {
  const meta = { steps: [0, 2, 1], clickAdvance: [true, true, true] };
  it("each next plays the slide's next click step before moving on", () => {
    let s = initialShow(3, 0, meta);
    s = run(s, { type: "next" }) as ShowState;
    expect(s).toMatchObject({ index: 1, step: 0 });
    s = run(s, { type: "next" }) as ShowState;
    expect(s).toMatchObject({ index: 1, step: 1 });
    s = run(s, ...keys(" ", "ArrowRight")) as ShowState;
    expect(s).toMatchObject({ index: 2, step: 0 });
    s = run(s, { type: "next" }, { type: "next" }) as ShowState;
    expect(s).toMatchObject({ index: 2, step: 1, ended: true });
  });

  it("← goes back one step, then to the previous slide with all its steps done", () => {
    const s = initialShow(3, 2, meta);
    expect(run(s, { type: "prev" })).toMatchObject({ index: 1, step: 2 });
    expect(run(s, { type: "prev" }, { type: "prev" })).toMatchObject({ index: 1, step: 1 });
    expect(run(s, { type: "prev" }, { type: "prev" }, { type: "prev" }, { type: "prev" })).toMatchObject({ index: 0, step: 0 });
    expect(run(initialShow(3, 0, meta), { type: "prev" })).toMatchObject({ index: 0, step: 0 });
  });

  it("jumps start the slide at step 0", () => {
    const at = run(initialShow(3, 1, meta), { type: "next" }) as ShowState;
    expect(at.step).toBe(1);
    expect(run(at, { type: "goto", index: 1 })).toMatchObject({ index: 1, step: 0 });
    expect(run(at, { type: "first" })).toMatchObject({ step: 0 });
    expect(run(at, { type: "last" })).toMatchObject({ index: 2, step: 0 });
    expect(run(at, ...keys("2", "Enter"))).toMatchObject({ index: 1, step: 0 });
  });

  it("On mouse click off: a click plays steps but does not leave the slide; keys and the timer do", () => {
    const s = initialShow(2, 0, { steps: [1, 0], clickAdvance: [false, true] });
    const click = clickAction(900, 1000);
    const a = run(s, click) as ShowState;
    expect(a).toMatchObject({ index: 0, step: 1 });
    expect(run(a, click)).toBe(a);
    expect(run(a, { type: "next" })).toMatchObject({ index: 1 });
    expect(run(a, { type: "next", via: "timer" })).toMatchObject({ index: 1 });
  });

  it("S stops and restarts the automatic advance; the timer never ends the show", () => {
    expect(keyAction("s")).toEqual({ type: "toggleAuto" });
    const s = run(initialShow(2), ...keys("S")) as ShowState;
    expect(s.autoStopped).toBe(true);
    expect(run(s, ...keys("s"))).toMatchObject({ autoStopped: false });
    const ended = run(initialShow(1), { type: "next" }) as ShowState;
    expect(ended.ended).toBe(true);
    expect(run(ended, { type: "next", via: "timer" })).toBe(ended);
  });
});
