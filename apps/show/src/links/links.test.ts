import { describe, expect, it } from "vitest";
import { deckOf } from "../design/deck";
import type { Hyperlink } from "../generated/Hyperlink";
import { fixture, textShape } from "../test/fixture";
import { linkAction, linkRegions, safeUrl } from "./regions";
import { actionChoice, normalizeUrl, slideTitle, targetLabel } from "./LinkDialogs";

const next: Hyperlink = { target: { kind: "slide", value: { kind: "next" } } };
const url: Hyperlink = { target: { kind: "url", value: "https://example.com" }, tooltip: "Tip" };

describe("links in the slide show", () => {
  it("a click action covers the shape's box; linked runs their text fragments", () => {
    const p = fixture();
    const tb = textShape(50, ["Go to the site"], { clickAction: next });
    const body = tb.kind.kind === "auto" ? tb.kind.value.text! : null!;
    body.paragraphs[0]!.runs = [{ text: "Go to " }, { text: "the site", hyperlink: url }];
    p.slides[2]!.shapes.push(tb);
    const regions = linkRegions(deckOf(p), p.slides[2]!, {});
    expect(regions).toHaveLength(2);
    const [box, text] = regions;
    expect(box).toMatchObject({ x: 96, y: 96, w: 480, h: 96, text: false, link: next });
    expect(text!.text).toBe(true);
    expect(text!.link).toEqual(url);
    expect(text!.x).toBeGreaterThan(box!.x);
    expect(text!.w).toBeGreaterThan(10);
    // slides without links have none
    expect(linkRegions(deckOf(p), p.slides[0]!, {})).toEqual([]);
  });

  it("maps every target to a show action", () => {
    const ids = [1, 4, 7];
    expect(linkAction(url, ids)).toEqual({ kind: "url", url: "https://example.com" });
    expect(linkAction(next, ids)).toEqual({ kind: "next" });
    expect(linkAction({ target: { kind: "slide", value: { kind: "id", value: 7 } } }, ids)).toEqual({ kind: "goto", index: 2 });
    expect(linkAction({ target: { kind: "slide", value: { kind: "id", value: 99 } } }, ids)).toEqual({ kind: "none" });
    expect(linkAction({ target: { kind: "slide", value: { kind: "lastViewed" } } }, ids)).toEqual({ kind: "back" });
    expect(linkAction({ target: { kind: "slide", value: { kind: "first" } } }, ids)).toEqual({ kind: "first" });
    expect(linkAction({ target: { kind: "slide", value: { kind: "last" } } }, ids)).toEqual({ kind: "last" });
    expect(linkAction({ target: { kind: "slide", value: { kind: "previous" } } }, ids)).toEqual({ kind: "previous" });
    expect(linkAction({ target: { kind: "endShow" } }, ids)).toEqual({ kind: "end" });
    expect(linkAction({ target: { kind: "customShow", value: { id: 2, returnAfter: true } } }, ids)).toEqual({ kind: "customShow", id: 2, returnAfter: true });
  });

  it("only opens harmless URL schemes", () => {
    expect(safeUrl("https://a.example")).toBe(true);
    expect(safeUrl("mailto:x@y.example")).toBe(true);
    expect(safeUrl("javascript:alert(1)")).toBe(false);
    expect(safeUrl("data:text/html,x")).toBe(false);
  });
});

describe("Link and Action dialogs", () => {
  it("normalize typed addresses like PowerPoint", () => {
    expect(normalizeUrl(" www.example.com ")).toBe("https://www.example.com");
    expect(normalizeUrl("team@example.com")).toBe("mailto:team@example.com");
    expect(normalizeUrl("ftp://files.example")).toBe("ftp://files.example");
    expect(normalizeUrl("  ")).toBe("");
  });

  it("name slides by their title placeholder", () => {
    const p = fixture();
    expect(slideTitle(p.slides[1]!)).not.toBeUndefined();
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;
    expect(targetLabel({ kind: "slide", value: { kind: "id", value: 4 } }, p.slides, t)).toContain('"n":2');
    expect(targetLabel({ kind: "slide", value: { kind: "id", value: 404 } }, p.slides, t)).toBe("show.link.missingSlide");
    expect(targetLabel({ kind: "url", value: "https://x" }, p.slides, t)).toBe("https://x");
    expect(targetLabel({ kind: "endShow" }, p.slides, t)).toBe("show.link.endShow");
    expect(targetLabel({ kind: "customShow", value: { id: 1, returnAfter: false } }, p.slides, t, [{ id: 1, name: "Short", slideIds: [] }])).toContain("Short");
    expect(targetLabel(next.target, p.slides, t)).toBe("show.link.next");
  });

  it("show a click action as its Action Settings choice", () => {
    expect(actionChoice(null)).toBe("none");
    expect(actionChoice(next)).toBe("next");
    expect(actionChoice(url)).toBe("url");
    expect(actionChoice({ target: { kind: "endShow" } })).toBe("endShow");
    expect(actionChoice({ target: { kind: "customShow", value: { id: 0, returnAfter: false } } })).toBe("customShow");
    expect(actionChoice({ target: { kind: "slide", value: { kind: "id", value: 3 } } })).toBe("slide");
  });
});
