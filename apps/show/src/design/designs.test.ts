// Further designs and theme files (P9-S5): Keep source formatting sends
// the source's designs, slides of a further design draw with it, Browse
// for Themes / Save Current Theme.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { designFixture, fixture, master } from "../test/fixture";
import { ShowStore, applyPatch } from "../state/store";
import { reusePayload } from "../state/rich";
import { deckFor, deckOf, allDesignShapes } from "./deck";
import { exportFile, isThemeFile, thmxName } from "./themeFile";
import type { Design } from "../generated/Design";
import type { Presentation } from "../generated/Presentation";

afterEach(() => vi.restoreAllMocks());

function harbor(id: number): Design {
  const m = master();
  return {
    id,
    master: { ...m, name: "Harbor", background: { kind: "fill", value: { kind: "solid", value: { kind: "rgb", value: "1B2A3A" } } } },
    layouts: fixture().layouts,
    theme: { ...fixture().theme, name: "Harbor" },
  };
}

/** A source deck whose slide 7 uses a further design with a picture on its master. */
function source(): Presentation {
  const p = designFixture();
  const d = harbor(3);
  d.master.shapes = [{ ...d.master.shapes![0]!, id: 950, kind: { kind: "picture", value: { media: 9 } } }];
  p.designs = [d];
  p.slides[2]!.design = 3;
  p.media = [{ id: 9, contentType: "image/png", data: "AA==" }, { id: 10, contentType: "image/png", data: "AQ==" }];
  return p;
}

describe("Reuse Slides › Keep source formatting (P9-S5)", () => {
  it("sends the designs the slides use (the main one as id 0) with their media", () => {
    const src = source();
    const keep = reusePayload(src, [1, 7], true);
    expect(keep.designs.map((d) => d.id)).toEqual([0, 3]);
    expect(keep.designs[0]!.layouts).toBe(src.layouts);
    expect(keep.media.map((m) => m.id)).toEqual([9]);
    // a slide of a further design brings no main-design layout
    expect(reusePayload(src, [7], true).layouts).toEqual([]);
    expect(reusePayload(src, [7], true).designs.map((d) => d.id)).toEqual([3]);
    // without Keep source formatting no designs go along
    expect(reusePayload(src, [1, 7]).designs).toEqual([]);
  });

  it("the store sends them and keeps the further designs of the patch", async () => {
    const backend = new FakeBackend();
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    backend.peek = source();
    await store.peekReuse({ name: "harbor.pptx", bytesBase64: "AA==" });
    await store.reuseSlides([7], true);
    const cmd = backend.commands.at(-1)!;
    expect(cmd).toMatchObject({ type: "insertSlides", keepSourceFormatting: true });
    expect(cmd.type === "insertSlides" && cmd.designs?.map((d) => d.id)).toEqual([3]);
    const pres = store.getState().pres!;
    expect(pres.designs).toHaveLength(1);
    expect(pres.slides.filter((s) => s.design === pres.designs![0]!.id)).toHaveLength(1);
    // the same design again: shared
    await store.reuseSlides([7], true);
    expect(store.getState().pres!.designs).toHaveLength(1);
  });
});

describe("slides of a further design", () => {
  it("see its master, layouts and theme; the main deck stays", () => {
    const p = designFixture();
    p.designs = [harbor(2)];
    const deck = deckOf(p);
    expect(deckFor(deck, p.slides[0]!)).toBe(deck);
    const d = deckFor(deck, { design: 2 });
    expect(d.master?.name).toBe("Harbor");
    expect(d.theme.name).toBe("Harbor");
    expect(d.order).toBe(deck.order);
    // an unknown design: the main one
    expect(deckFor(deck, { design: 9 })).toBe(deck);
    // their design shapes get outlines too
    expect(allDesignShapes(deck)).toHaveLength((p.master!.shapes?.length ?? 0) + (harbor(2).master.shapes?.length ?? 0));
  });

  it("a patch replaces the designs", () => {
    const p = designFixture();
    const out = applyPatch(p, { slides: [], deletedSlides: [], idMap: [], slidesOrder: null, slideSize: null, info: null, designs: [harbor(1)] });
    expect(out.designs?.[0]?.master.name).toBe("Harbor");
  });
});

describe("Browse for Themes / Save Current Theme", () => {
  it("imports a theme file as one command; saves the theme as a download named .thmx", async () => {
    const backend = new FakeBackend();
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    await store.importDesign({ name: "Harbor.thmx", bytesBase64: "UEsDBA==" });
    expect(backend.commands.at(-1)).toEqual({ type: "importDesign", bytesBase64: "UEsDBA==" });
    expect(store.getState().pres!.theme.name).toBe("Imported");
    const created: string[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download);
    });
    await store.saveTheme();
    expect(click).toHaveBeenCalled();
    expect(created).toEqual(["Imported.thmx"]);
  });

  it("file names and types", async () => {
    expect(thmxName("Harbor.thmx")).toBe("Harbor.thmx");
    expect(thmxName("A/B: c")).toBe("A-B- c.thmx");
    expect(thmxName("")).toBe("Theme.thmx");
    expect(isThemeFile("x.THMX")).toBe(true);
    expect(isThemeFile("x.potx")).toBe(true);
    expect(isThemeFile("x.docx")).toBe(false);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:y") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await expect(exportFile("T.thmx", "AA==", "Office Theme", "thmx")).resolves.toBe(true);
  });
});
