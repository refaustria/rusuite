import { describe, expect, it } from "vitest";
import { swipeAction, tapAction } from "./TouchShow";

describe("slide show gestures (P10-M5)", () => {
  it("a swipe left goes on, right goes back; short or vertical moves are none", () => {
    expect(swipeAction(-120, 10)).toEqual({ type: "next" });
    expect(swipeAction(120, -20)).toEqual({ type: "prev" });
    expect(swipeAction(-30, 0)).toBeNull();
    expect(swipeAction(-80, 90)).toBeNull();
  });
  it("a tap on the left third goes back, elsewhere on", () => {
    expect(tapAction(50, 900)).toEqual({ type: "prev" });
    expect(tapAction(301, 900)).toEqual({ type: "next", via: "click" });
    expect(tapAction(880, 900)).toEqual({ type: "next", via: "click" });
  });
});
