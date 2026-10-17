import { describe, expect, it } from "vitest";
import { nextSlideTimer, pauseTimer, resetTimer, resumeTimer, slideElapsed, startTimer, toggleTimer, totalElapsed } from "./timer";
import { formatElapsed } from "./PresenterConsole";

describe("presenter view timers (P9-S5)", () => {
  it("total and slide time run together; a new slide restarts the slide time", () => {
    let t = startTimer(1000);
    expect(totalElapsed(t, 6000)).toBe(5000);
    expect(slideElapsed(t, 6000)).toBe(5000);
    t = nextSlideTimer(t, 6000);
    expect(totalElapsed(t, 9000)).toBe(8000);
    expect(slideElapsed(t, 9000)).toBe(3000);
  });

  it("a pause stops both times; resume does not count it", () => {
    let t = startTimer(0);
    t = pauseTimer(t, 10_000);
    expect(totalElapsed(t, 70_000)).toBe(10_000);
    expect(slideElapsed(t, 70_000)).toBe(10_000);
    expect(pauseTimer(t, 80_000)).toBe(t); // already paused
    t = resumeTimer(t, 70_000);
    expect(totalElapsed(t, 75_000)).toBe(15_000);
    expect(slideElapsed(t, 75_000)).toBe(15_000);
    expect(resumeTimer(t, 76_000)).toBe(t); // running
    t = toggleTimer(t, 75_000);
    expect(t.pausedAt).toBe(75_000);
    expect(toggleTimer(t, 76_000).pausedAt).toBeNull();
  });

  it("a slide change while paused keeps the pause and the total; reset starts at 0 keeping the paused state", () => {
    let t = pauseTimer(startTimer(0), 5000);
    t = nextSlideTimer(t, 8000);
    expect(t.pausedAt).toBe(8000);
    expect(totalElapsed(t, 9000)).toBe(5000);
    expect(slideElapsed(t, 9000)).toBe(0);
    t = resumeTimer(t, 10_000);
    expect(slideElapsed(t, 12_000)).toBe(2000);
    expect(totalElapsed(t, 12_000)).toBe(7000);
    const r = resetTimer(t, 20_000);
    expect(totalElapsed(r, 21_000)).toBe(1000);
    expect(resetTimer(pauseTimer(t, 13_000), 20_000).pausedAt).toBe(20_000);
  });

  it("formats like PowerPoint (mm:ss below an hour)", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_400)).toBe("01:05");
    expect(formatElapsed(3_726_000)).toBe("1:02:06");
    expect(formatElapsed(-5)).toBe("00:00");
  });
});
