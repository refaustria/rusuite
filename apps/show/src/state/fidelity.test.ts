// P8-32 in the store and the pure helpers: media clips in the click
// sequence, picture backgrounds, lock aspect ratio, lastView on save,
// slide size scaling, split cells, table style names, master view levels,
// placeholders and layout names.
import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { clickGroups, clickSteps, sequenceMedia, startedMedia } from "../anim/playback";
import { fillCssBackground, konvaFill, resolveBackground } from "../design/color";
import { deckOf, slideBackground } from "../design/deck";
import { DESIGN_SHAPE_BASE } from "../design/master";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { Slide } from "../generated/Slide";
import type { Table } from "../generated/Table";
import { t } from "../i18n";
import { splitDefaults, splitGridCommand, tableStyleOf } from "../shapes/tables";
import { FakeBackend } from "../test/fakeBackend";
import { body, designFixture, fixture, rect } from "../test/fixture";
import { tableStyleLabel } from "../ui/ShapeTabs";
import { lastViewOf, ShowStore } from "./store";

async function ready(p: Presentation = fixture()) {
  const backend = new FakeBackend(p);
  const store = new ShowStore(new ShowApi(backend));
  await store.init();
  return { store, backend };
}

const last = <T,>(a: T[]): T => a[a.length - 1]!;

const clip = (id: number, start: "onClick" | "automatically" | "inClickSequence"): Shape => ({
  id,
  name: `Video ${id}`,
  transform: { x: 0, y: 0, w: 100, h: 100, rotationDeg: 0 },
  kind: { kind: "media", value: { kind: "video", media: 1, start } },
  fill: { kind: "none" },
  line: { fill: { kind: "none" }, width: 0, dash: "solid" },
});

describe("media clips in the click sequence", () => {
  const slide: Slide = {
    id: 1,
    layout: "blank",
    shapes: [rect(2, 0, 0), clip(3, "inClickSequence"), clip(4, "automatically"), clip(5, "inClickSequence")],
    animations: [{ id: 9, shape: 2, kind: "entrance", effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }],
  };

  it("each 'In Click Sequence' clip is a click step after the animations", () => {
    expect(sequenceMedia(slide)).toEqual([3, 5]);
    expect(clickSteps(slide)).toBe(3);
    const g = clickGroups(slide);
    expect(g.map((x) => x.media ?? null)).toEqual([null, null, 3, 5]);
  });

  it("a clip starts once its step is done; going back stops it", () => {
    expect(startedMedia(slide, 1)).toEqual([]);
    expect(startedMedia(slide, 2)).toEqual([3]);
    expect(startedMedia(slide, 3)).toEqual([3, 5]);
    expect(startedMedia(slide, 0)).toEqual([]);
  });

  it("slides without clips keep their animation steps", () => {
    expect(clickSteps({ animations: slide.animations })).toBe(1);
    expect(clickSteps({ animations: [], shapes: [clip(3, "onClick")] })).toBe(0);
  });
});

describe("picture backgrounds", () => {
  it("resolve to the image with its opacity, tiled or stretched", () => {
    const bg = resolveBackground(undefined, { kind: "picture", value: { media: 4, tile: true, transparency: 0.25 } });
    expect(bg).toEqual({ kind: "picture", value: { media: 4, tile: true, alpha: 0.75 } });
    expect(resolveBackground(undefined, { kind: "picture", value: { media: 4 } })).toEqual({ kind: "picture", value: { media: 4, tile: false, alpha: 1 } });
  });

  it("are drawn as an image, not as a Konva fill or CSS colour", () => {
    const bg = resolveBackground(undefined, { kind: "picture", value: { media: 4 } });
    expect(konvaFill(bg, 10, 10)).toEqual({});
    expect(fillCssBackground(bg)).toBeUndefined();
  });

  it("a slide's picture wins over its layout's and the master's backgrounds", () => {
    const p = designFixture();
    const s = { ...p.slides[0]!, background: { kind: "picture" as const, value: { media: 7, tile: false, transparency: 0 } } };
    expect(slideBackground(deckOf(p), s)).toEqual({ kind: "picture", value: { media: 7, tile: false, alpha: 1 } });
  });

  it("Insert… sends the file as SetBackgroundPicture with the pane's tile and transparency", async () => {
    const { store, backend } = await ready();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "bg.png", { type: "image/png" });
    await store.setBackgroundPictureFile({ kind: "slides", value: [1] }, file, { tile: true, transparency: 0.4 });
    expect(last(backend.commands)).toMatchObject({ type: "setBackgroundPicture", target: { kind: "slides", value: [1] }, contentType: "image/png", tile: true, transparency: 0.4 });
    expect(store.getState().pres!.slides[0]!.background).toMatchObject({ kind: "picture", value: { tile: true } });
  });

  it("files that are not pictures are refused with a message", async () => {
    const { store, backend } = await ready();
    const n = backend.commands.length;
    await store.setBackgroundPictureFile({ kind: "master" }, new File(["x"], "a.txt", { type: "text/plain" }), { tile: false, transparency: 0 });
    expect(backend.commands.length).toBe(n);
    expect(store.getState().info).toBe(t("show.bg.notPicture"));
  });
});

describe("lock aspect ratio", () => {
  it("is the shape's saved flag; the check box sends SetLockAspect", async () => {
    const { store, backend } = await ready();
    const shape = store.getState().pres!.slides[0]!.shapes[0]!;
    expect(store.aspectLocked(shape)).toBe(false);
    await store.setAspectLocked([shape.id], true);
    expect(last(backend.commands)).toEqual({ type: "setLockAspect", shapes: [shape.id], locked: true });
    expect(store.aspectLocked(store.getState().pres!.slides[0]!.shapes[0]!)).toBe(true);
  });

  it("inserted pictures come locked", async () => {
    const { store } = await ready();
    await store.insertPicture("image/png", "iVBORw0KGgo=");
    const pics = store.getState().pres!.slides[0]!.shapes.filter((s) => s.kind.kind === "picture");
    expect(pics.at(-1)!.lockAspect).toBe(true);
  });
});

describe("last view on save", () => {
  it("maps each view to its lastView", () => {
    expect(lastViewOf("normal")).toBe("normal");
    expect(lastViewOf("sorter")).toBe("slideSorter");
    expect(lastViewOf("outline")).toBe("outline");
    expect(lastViewOf("notesPage")).toBe("notesPage");
    expect(lastViewOf("reading")).toBe("reading");
  });

  it("Save stamps the current view (no command, no undo step)", async () => {
    const { store, backend } = await ready();
    store.setView("sorter");
    const n = backend.commands.length;
    await store.save();
    expect(backend.log.find((r) => r.type === "savePptx")).toEqual({ type: "savePptx", lastView: "slideSorter" });
    expect(backend.commands.length).toBe(n);
  });
});

describe("slide size", () => {
  it("with content: the Maximize / Ensure Fit prompt; its answer scales", async () => {
    const { store, backend } = await ready();
    const size = { width: 9144000, height: 6858000 };
    await store.setSlideSize(size);
    expect(store.getState().dialog).toEqual({ kind: "slideScale", size });
    await store.applySlideSize(size, "maximize");
    expect(last(backend.commands)).toEqual({ type: "setSlideSize", size, scale: "maximize" });
    expect(store.getState().dialog).toBeNull();
  });

  it("an empty presentation changes at once", async () => {
    const p = fixture();
    p.slides.forEach((s) => (s.shapes = []));
    const { store, backend } = await ready(p);
    await store.setSlideSize({ width: 9144000, height: 6858000 });
    expect(last(backend.commands)).toEqual({ type: "setSlideSize", size: { width: 9144000, height: 6858000 } });
  });
});

describe("split cells", () => {
  const table = (): Table => ({
    rows: [{ height: 100 }, { height: 100 }],
    cols: [{ width: 100 }, { width: 100 }],
    cells: [
      [{ text: body("a"), rowSpan: 2, colSpan: 2 }, { text: body(""), covered: true }],
      [{ text: body(""), covered: true }, { text: body(""), covered: true }],
    ],
    look: {},
  });

  it("a merged cell starts with its spans; a single cell with 2 columns", () => {
    expect(splitDefaults(table(), 1, 1)).toEqual({ rows: 2, cols: 2 });
    const single: Table = { ...table(), cells: [[{ text: body("") }, { text: body("") }], [{ text: body("") }, { text: body("") }]] };
    expect(splitDefaults(single, 0, 0)).toEqual({ rows: 1, cols: 2 });
    expect(splitGridCommand(5, single, 0, 1, 3, 2)).toEqual({ type: "splitTableCellGrid", shape: 5, row: 0, col: 1, rows: 3, cols: 2 });
    expect(splitGridCommand(5, single, 0, 1, 1, 1)).toBeNull();
  });

  it("merged cells split only by divisors of their spans (from any of their cells)", () => {
    expect(splitGridCommand(5, table(), 1, 1, 2, 1)).toEqual({ type: "splitTableCellGrid", shape: 5, row: 0, col: 0, rows: 2, cols: 1 });
    expect(splitGridCommand(5, table(), 0, 0, 3, 1)).toBeNull();
  });
});

describe("table style names", () => {
  it("built-ins get localized names; pairs name both accents", () => {
    expect(tableStyleLabel(tableStyleOf("{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}")!, t)).toBe("Medium Style 2 – Accent 3");
    expect(tableStyleLabel(tableStyleOf("{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}")!, t)).toBe("Dark Style 2 – Accent 1/Accent 2");
    expect(tableStyleLabel(tableStyleOf("{2D5ABB26-0587-4C30-8999-92F81FD0307C}")!, t)).toBe("No Style, No Grid");
    expect(tableStyleLabel(tableStyleOf("{616DA210-FB5B-4158-B5E0-FEB733F419BA}")!, t)).toBe("Light Style 3");
  });

  it("the presentation's own styles keep their names", () => {
    expect(tableStyleLabel({ id: "{1}", name: "Corporate", whole: {} }, t)).toBe("Corporate");
  });
});

describe("Slide Master view", () => {
  async function inMaster() {
    const r = await ready(designFixture());
    r.store.openMasterView();
    r.store.selectDesignTarget({ kind: "master" });
    return r;
  }

  it("Tab / Shift+Tab step the text level of the selected master body placeholder", async () => {
    const { store } = await inMaster();
    expect(store.stepMasterLevel(1)).toBe(false); // nothing selected
    store.select([DESIGN_SHAPE_BASE + 1]);
    expect(store.stepMasterLevel(1)).toBe(true);
    expect(store.getState().masterLevel).toBe(0);
    store.stepMasterLevel(1);
    expect(store.getState().masterLevel).toBe(1);
    store.stepMasterLevel(-1);
    store.stepMasterLevel(-1);
    expect(store.getState().masterLevel).toBeNull();
  });

  it("with a text level chosen, Home formatting of the master body goes to that level", async () => {
    const { store, backend } = await inMaster();
    store.select([DESIGN_SHAPE_BASE + 1]);
    store.setMasterLevel(6);
    await store.applyRunPatch({ bold: true });
    expect(last(backend.commands)).toEqual({ type: "setMasterTextStyle", which: "body", level: 6, run: { bold: true } });
    expect(store.getState().pres!.master!.textStyles.body[6]!.run?.bold).toBe(true);
  });

  it("Insert Placeholder adds one to the layout and selects it", async () => {
    const { store, backend } = await inMaster();
    store.selectDesignTarget({ kind: "layout", value: "blank" });
    await store.insertPlaceholder("picture");
    expect(last(backend.commands)).toMatchObject({ type: "addPlaceholder", target: { kind: "layout", value: "blank" }, kind: "picture" });
    const n = store.getState().pres!.layouts.find((l) => l.kind === "blank")!.placeholders.length;
    expect(store.getState().selection).toEqual([DESIGN_SHAPE_BASE + n - 1]);
  });

  it("the Title and Footers check boxes add and remove those placeholders", async () => {
    const { store, backend } = await inMaster();
    store.selectDesignTarget({ kind: "layout", value: "titleContent" });
    await store.setLayoutPlaceholders("footers", false);
    expect(last(backend.commands)).toMatchObject({ type: "compound" });
    const kinds = () => store.getState().pres!.layouts.find((l) => l.kind === "titleContent")!.placeholders.map((d) => d.kind);
    expect(kinds()).not.toContain("footer");
    await store.setLayoutPlaceholders("footers", true);
    expect(kinds()).toEqual(expect.arrayContaining(["dateTime", "footer", "slideNumber"]));
  });

  it("Rename: a standard layout shows its new name; a custom one changes its kind", async () => {
    const { store, backend } = await inMaster();
    await store.renameLayout("titleContent", "  Agenda ");
    expect(last(backend.commands)).toEqual({ type: "renameLayout", layout: "titleContent", name: "Agenda" });
    expect(store.getState().pres!.layouts.find((l) => l.kind === "titleContent")!.name).toBe("Agenda");
    await store.addLayout();
    const custom = store.getState().pres!.layouts.at(-1)!.kind;
    await store.renameLayout(custom, "Quote");
    expect(store.getState().masterView).toEqual({ kind: "layout", value: "custom:Quote" });
  });

  it("Delete on a placeholder removes it from the layout", async () => {
    const { store, backend } = await inMaster();
    store.selectDesignTarget({ kind: "layout", value: "titleContent" });
    store.select([DESIGN_SHAPE_BASE]);
    await store.deleteSelection();
    expect(last(backend.commands)).toMatchObject({ type: "removePlaceholder", target: { kind: "layout", value: "titleContent" }, placeholder: "title" });
  });
});
