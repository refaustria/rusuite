import { describe, expect, it } from "vitest";
import { designFixture, rect } from "../test/fixture";
import { backdropShapes, deckOf, findPlaceholder, levelDefaults, placeholderFor, slideBackground, slideNumberOf, stableDeck, textClass, withDesignShapes } from "./deck";

describe("what slides inherit from the design", () => {
  const pres = designFixture();
  const deck = deckOf(pres);

  it("placeholder lookup like Layout::find: idx, kind, class", () => {
    const two = pres.layouts.find((l) => l.kind === "twoContent")!.placeholders;
    expect(findPlaceholder(two, "body", 2)?.transform.x).toBe(6172200);
    expect(findPlaceholder(two, "body", null)?.idx).toBe(1);
    expect(findPlaceholder(two, "picture", 9)?.kind).toBe("body"); // same class
    expect(findPlaceholder(two, "footer", 99)?.kind).toBe("footer");
    expect(findPlaceholder(two, "subtitle")?.kind).toBe("body");
    expect(textClass("centeredTitle")).toBe("title");
    expect(textClass("slideNumber")).toBe("other");
    const shape = { ...rect(1, 0, 0), placeholder: "title" as const };
    expect(placeholderFor(deck, "titleContent", shape)?.runDefaults.size).toBe(4400);
    expect(placeholderFor(deck, "blank", shape, true)?.kind).toBe("title");
  });

  it("deeper outline levels take the master's body text style", () => {
    const def = pres.layouts[1]!.placeholders[1]!;
    expect(levelDefaults(deck, def, 0).run.size).toBe(2800);
    expect(levelDefaults(deck, def, 1).run.size).toBe(2400);
    expect(levelDefaults(deck, def, 7).run.size).toBe(2000); // repeats the last level
    expect(levelDefaults(deck, def, 1).paragraph.bullet).toEqual({ kind: "char", value: "•" });
  });

  it("background: slide → layout → master; master graphics unless hidden", () => {
    expect(slideBackground(deck, pres.slides[0]!)).toEqual({ kind: "solid", value: { color: "FFFFFF", alpha: 1 } });
    const layouts = pres.layouts.map((l) => (l.kind === "title" ? { ...l, background: { kind: "fill" as const, value: { kind: "solid" as const, value: { kind: "rgb" as const, value: "00FF00" } } } } : l));
    expect(slideBackground({ ...deck, layouts }, pres.slides[0]!)).toEqual({ kind: "solid", value: { color: "00FF00", alpha: 1 } });
    expect(slideBackground(deck, { ...pres.slides[0]!, background: { kind: "fill", value: { kind: "solid", value: { kind: "rgb", value: "123456" } } } })).toEqual({ kind: "solid", value: { color: "123456", alpha: 1 } });
    expect(backdropShapes(deck, pres.slides[0]!).map((s) => s.name)).toEqual(["Accent bar"]);
    expect(backdropShapes(deck, { ...pres.slides[0]!, showMasterShapes: false })).toEqual([]);
    const hidden = pres.layouts.map((l) => ({ ...l, showMasterShapes: false }));
    expect(backdropShapes({ ...deck, layouts: hidden }, pres.slides[0]!)).toEqual([]);
    expect(withDesignShapes(deck, pres.slides)).toHaveLength(pres.slides.length + 1);
  });

  it("slide numbers from the order; the stable deck stays the same object across slide patches", () => {
    expect(slideNumberOf(deck, 7)).toBe(3);
    expect(slideNumberOf({ ...deck, order: undefined }, 7)).toBeNull();
    const a = stableDeck(pres);
    expect(stableDeck({ ...pres, slides: [...pres.slides] })).toBe(a);
    expect(stableDeck({ ...pres, slides: [...pres.slides].reverse() })).not.toBe(a);
  });
});
