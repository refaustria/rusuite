import { describe, expect, it } from "vitest";
import type { Slide } from "../generated/Slide";
import { selectPrintSlides } from "./showPrintDoc";
import { viewStateOf, windowStateOf } from "../state/store";
import { guideSets, guideTargets } from "../canvas/guides";
import { designFixture, fixture } from "../test/fixture";

const slide = (id: number, hidden = false): Slide => ({ id, layout: "blank", shapes: [], ...(hidden ? { hidden } : {}) });
const deck = { slides: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => slide(n, n === 4)), sections: [{ slideIds: [1, 2, 3] }, { slideIds: [4, 5, 6, 7, 8, 9] }] };
const numbers = (r: ReturnType<typeof selectPrintSlides>) => ("error" in r ? r.error : r.slides.map((s) => s.number));

describe("print ranges by slide number (P9-S3)", () => {
  it("accepts 1-3, 5, 8- and keeps the deck's numbers", () => {
    expect(numbers(selectPrintSlides(deck, { range: "1-3, 5, 8-", hidden: false }))).toEqual([1, 2, 3, 5, 8, 9]);
    expect(numbers(selectPrintSlides(deck, { range: "", hidden: false }))).toEqual([1, 2, 3, 5, 6, 7, 8, 9]);
    // hidden slides print when asked, by their own number
    expect(numbers(selectPrintSlides(deck, { range: "3-4", hidden: true }))).toEqual([3, 4]);
  });

  it("limits to a section; nothing printable or a bad range is an error", () => {
    expect(numbers(selectPrintSlides(deck, { range: "", section: 1, hidden: false }))).toEqual([5, 6, 7, 8, 9]);
    expect(numbers(selectPrintSlides(deck, { range: "1-3", section: 1, hidden: false }))).toEqual("No slides to print in this range.");
    expect("error" in selectPrintSlides(deck, { range: "x", hidden: false })).toBe(true);
    expect("error" in selectPrintSlides(deck, { range: "5-2", hidden: false })).toBe(true);
  });
});

describe("window state saved with the file (P9-S3)", () => {
  it("maps zoom, sorter zoom, pane width and notes to restoredLeft / restoredTop and back", () => {
    const s = viewStateOf({ zoom: 1.25, sorterZoom: 60, sidebarWidth: 280, notesVisible: true }, 1400);
    expect(s).toEqual({ zoom: 125, sorterZoom: 60, restoredLeft: 20000, restoredTop: 94660 });
    const back = windowStateOf({ ...fixture().view!, ...s, guides: [], gridSpacing: 76200, snapToGrid: false, snapToShapes: true, showGrid: false, showGuides: false, showRuler: false, lastView: "normal" } as never, 1400);
    expect(back).toEqual({ zoom: 1.25, sorterZoom: 60, sidebarWidth: 280, notesVisible: true });
    // the defaults: fit, PowerPoint's default pane width, notes hidden
    expect(viewStateOf({ zoom: "fit", sorterZoom: 90, sidebarWidth: 192, notesVisible: false }, 1400)).toEqual({ sorterZoom: 90, restoredLeft: 15620, restoredTop: 100000 });
    expect(windowStateOf(undefined, 1400)).toEqual({ zoom: "fit", sorterZoom: 90, sidebarWidth: 192, notesVisible: false });
  });
});

describe("guides of masters and layouts (P9-S3)", () => {
  it("slides show their layout's and the master's guides; the master view edits the selected one", () => {
    const p = designFixture();
    const g = (pos: number) => ({ orient: "vertical" as const, pos });
    p.view = { ...(p.view ?? ({} as never)), guides: [g(100)] } as never;
    p.master!.guides = [g(200)];
    p.layouts.find((l) => l.kind === "titleContent")!.guides = [g(300)];
    const normal = guideSets(p, null, 4);
    expect(normal.editable.map((x) => x.pos)).toEqual([100]);
    expect(normal.inherited.map((x) => x.pos)).toEqual([300, 200]);
    expect(guideSets(p, { kind: "layout", value: "titleContent" }, 4)).toEqual({ editable: [g(300)], inherited: [g(200)] });
    expect(guideSets(p, { kind: "master" }, 4)).toEqual({ editable: [g(200)], inherited: [] });
    expect(guideTargets({ guides: [g(9525)], showGuides: true }, [g(19050)]).xs).toEqual([1, 2]);
  });
});
