import { describe, expect, it } from "vitest";
import { choiceLabel, loadScreenChoice, pickScreen, saveScreenChoice, type ScreenInfo } from "./screens";
import { popupFeatures } from "./sync";

const A: ScreenInfo = { id: "0", label: "Built-in", primary: true, x: 0, y: 0, width: 1440, height: 900 };
const B: ScreenInfo = { id: "1", label: "Projector", primary: false, x: 1440, y: 0, width: 1920, height: 1080 };
const C: ScreenInfo = { id: "2", label: "TV", primary: false, x: -1920, y: 0, width: 1920, height: 1080 };

describe("Slide Show › Monitor (P9-S5)", () => {
  it("Automatic: a screen the presenter is not on; with one screen a window", () => {
    expect(pickScreen([A, B], "auto", { x: 100, y: 100 })).toBe(B);
    expect(pickScreen([A, B], "auto", { x: 1500, y: 100 })).toBe(A);
    expect(pickScreen([A, B, C], "auto", null)).toBe(B); // presenter assumed on the primary
    expect(pickScreen([A], "auto", { x: 1, y: 1 })).toBeNull();
    expect(pickScreen([], "1", null)).toBeNull();
  });

  it("a chosen screen, the primary one; a screen that went away is Automatic", () => {
    expect(pickScreen([A, B, C], "2", { x: 1, y: 1 })).toBe(C);
    expect(pickScreen([B, A], "primary", { x: 1, y: 1 })).toBe(A);
    expect(pickScreen([A], "primary", { x: 1, y: 1 })).toBe(A);
    expect(pickScreen([A, B], "9", { x: 1, y: 1 })).toBe(B);
  });

  it("is remembered; labels; the popup opens on the chosen screen", () => {
    saveScreenChoice("1");
    expect(loadScreenChoice()).toBe("1");
    saveScreenChoice("auto");
    expect(loadScreenChoice()).toBe("auto");
    const t = (k: string) => k;
    expect(choiceLabel("auto", [A, B], t)).toBe("show.monitor.auto");
    expect(choiceLabel("1", [A, B], t)).toBe("Projector");
    expect(choiceLabel("primary", [A, B], t)).toBe("show.monitor.primary");
    expect(popupFeatures(B, 1440)).toBe("popup,left=1440,top=0,width=1920,height=1080");
    expect(popupFeatures(null, 1440)).toBe("popup,width=720,height=405");
    expect(popupFeatures(null, 800)).toBe("popup,width=640,height=360");
  });
});
