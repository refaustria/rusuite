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
    expect(clickAction(700, 1000)).toEqual({ type: "next" });
    expect(clickAction(300, 1000)).toEqual({ type: "prev" });
  });
});
