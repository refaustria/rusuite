import { describe, expect, it } from "vitest";
import { shade } from "../canvas/SlideView";
import { volumeLevel } from "./PlaybackTab";
import { mediaUrl } from "../present/ShowOverlay";

describe("audio and video", () => {
  it("shows the Volume menu entry of a clip", () => {
    const c = { kind: "video" as const, media: 1, start: "onClick" as const };
    expect(volumeLevel(c)).toBe("high");
    expect(volumeLevel({ ...c, volume: 25000 })).toBe("low");
    expect(volumeLevel({ ...c, volume: 50000 })).toBe("medium");
    expect(volumeLevel({ ...c, muted: true })).toBe("mute");
  });

  it("plays media from blob URLs made from the store's data URLs (cached)", () => {
    const orig = URL.createObjectURL;
    let n = 0;
    URL.createObjectURL = (() => `blob:test/${++n}`) as typeof URL.createObjectURL;
    try {
      const a = mediaUrl("data:video/webm;base64,GkXfow==");
      expect(a).toBe("blob:test/1");
      expect(mediaUrl("data:video/webm;base64,GkXfow==")).toBe(a);
      expect(mediaUrl(undefined)).toBeUndefined();
    } finally {
      URL.createObjectURL = orig;
    }
  });
});

describe("action button icons", () => {
  it("darken or lighten the shape's fill", () => {
    expect(shade("#4472C4", 0.4)).not.toBe("#4472C4");
    expect(shade("#808080", 0.5)).toBe("#404040");
    expect(shade("#808080", -0.5)).toBe("#C0C0C0");
    expect(shade("red", 0.4)).toBe("red");
  });
});
