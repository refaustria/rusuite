// P8-37: Show's AI context and the slides an outline adds (one compound command with explicit new ids, matching
// the shapes `addSlide` creates for the layout).
import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { designFixture, fixture } from "../test/fixture";
import { ShowStore } from "../state/store";
import type { ShowCommand } from "../generated/ShowCommand";
import { maxId, newSlideShapes, outlineCommands, showAiAdapter } from "./showAi";

describe("Show AI", () => {
  it("the new slide's shapes: layout placeholders, then the enabled header/footer ones", () => {
    const pres = fixture();
    expect(newSlideShapes(pres, "titleContent")).toEqual(["title", "body"]);
    pres.master = { ...pres.master!, headerFooter: { footer: "ACME", slideNumber: true } };
    expect(newSlideShapes(pres, "titleContent")).toEqual(["title", "body", "footer", "slideNumber"]);
    pres.master.headerFooter.notOnTitle = true;
    expect(newSlideShapes(pres, "title")).toEqual(["centeredTitle", "subtitle"]);
    expect(newSlideShapes(pres, "comparison")).toBeNull();
  });

  it("an outline becomes one compound: addSlide with fresh ids, title and bullets, notes", () => {
    const pres = fixture();
    const max = maxId(pres);
    const cmd = outlineCommands(pres, pres.slides[0]!.id, [
      { title: "Why", bullets: ["A", "B"], notes: "Say why." },
      { title: "How", bullets: [], notes: "" },
    ]) as Extract<ShowCommand, { type: "compound" }>;
    expect(cmd.type).toBe("compound");
    const types = cmd.commands.map((c) => c.type);
    expect(types).toEqual(["addSlide", "setTextBody", "setTextBody", "setNotes", "addSlide", "setTextBody"]);
    const add1 = cmd.commands[0] as Extract<ShowCommand, { type: "addSlide" }>;
    expect(add1.after).toBe(pres.slides[0]!.id);
    expect(add1.newIds).toEqual([max + 1, max + 2, max + 3]);
    expect(cmd.commands[1]).toMatchObject({ shape: max + 2, body: { paragraphs: [{ runs: [{ text: "Why" }] }] } });
    expect(cmd.commands[2]).toMatchObject({ shape: max + 3, body: { paragraphs: [{ runs: [{ text: "A" }] }, { runs: [{ text: "B" }] }] } });
    expect(cmd.commands[3]).toEqual({ type: "setNotes", slide: max + 1, notes: "Say why." });
    expect((cmd.commands[4] as Extract<ShowCommand, { type: "addSlide" }>).after).toBe(max + 1);
  });

  it("context: the current slide's text and notes; the deck's outline only on request; layouts listed", async () => {
    const store = new ShowStore(new ShowApi(new FakeBackend(designFixture())));
    await store.init();
    const ai = showAiAdapter(store);
    const slides = store.getState().pres!.slides;
    store.selectSlide(slides[1]!.id);
    expect(ai.selectionLabel()).toBe(`slide 2 of ${slides.length}`);
    const ctx = await ai.context(false);
    expect(ctx.facts?.[0]).toMatch(/^Current slide: 2 of \d+, layout /);
    expect(ctx.facts?.[1]).toContain("titleContent");
    expect(ctx.document).toBeUndefined();
    expect((await ai.context(true)).document).toContain("Slide 1:");
    expect(ai.actions().map((a) => a.id)).toEqual(["outline", "notes", "rewrite", "layout"]);
  });
});
