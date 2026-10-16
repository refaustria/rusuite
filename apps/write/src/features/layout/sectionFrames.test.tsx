// P8-46 (W-18): mixed portrait / landscape sections in print layout.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import type { PageSetup } from "../../generated/PageSetup";
import type { Section } from "../../generated/Section";
import { makeDoc, para } from "../../test/fixtures";
import { makeEditor } from "../../test/harness";
import { PageFrame } from "../../ui/PageFrame";
import { sheetLeft } from "../../ui/PageChrome";
import { sectionShifts } from "../sectionWidths";
import type { PageLayout, SheetView } from "../pagination";
import { pageGeometry } from "../pagination";
import { blockShiftCss, sectionFrames } from "./sectionFrames";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  cleanup();
});

const margins = { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 };
const portrait: PageSetup = { width: 11906, height: 16838, margins, orientation: "portrait" };
const landscape: PageSetup = { width: 16838, height: 11906, margins, orientation: "landscape" };
const section = (id: number, page: PageSetup): Section => ({ id, page, kind: "nextPage", titlePage: false });
const px = (tw: number) => tw / 15;

describe("sectionFrames", () => {
  it("one page size: the frame is the page, nothing moves", () => {
    const f = sectionFrames([section(1, portrait), section(2, portrait)], portrait);
    expect(f.width).toBeCloseTo(px(11906));
    expect(f.mixed).toBe(false);
    expect(f.padLeft).toBeCloseTo(96);
    expect(f.sections.map((s) => [s.x, s.dx, s.extra])).toEqual([[0, 0, 0], [0, 0, 0]]);
  });

  it("portrait then landscape: the frame is the landscape width, the portrait sheet centred", () => {
    const f = sectionFrames([section(1, portrait), section(2, landscape)], portrait);
    const pw = px(11906);
    const lw = px(16838);
    expect(f.width).toBeCloseTo(lw);
    expect(f.mixed).toBe(true);
    expect(f.sections[0]!.x).toBeCloseTo((lw - pw) / 2);
    expect(f.sections[1]!.x).toBe(0);
    // The editor column is the portrait text column, centred.
    expect(f.padLeft).toBeCloseTo((lw - pw) / 2 + 96);
    expect(f.padLeft + (pw - 192) + f.padRight).toBeCloseTo(lw);
    // The landscape text column starts 96 px into its sheet and is wider by the width difference.
    expect(f.sections[1]!.textLeft).toBeCloseTo(96);
    expect(f.sections[1]!.dx).toBeCloseTo(96 - f.padLeft);
    expect(f.sections[1]!.extra).toBeCloseTo(lw - pw);
    expect(f.sheetX(pw)).toBeCloseTo((lw - pw) / 2);
  });

  it("landscape first: the portrait section after it is the narrower, centred one", () => {
    const f = sectionFrames([section(1, landscape), section(2, portrait)], landscape);
    expect(f.sections[0]!.x).toBe(0);
    expect(f.sections[1]!.x).toBeGreaterThan(0);
    expect(f.sections[1]!.dx).toBeCloseTo(f.sections[1]!.x);
    expect(f.sections[1]!.extra).toBeLessThan(0);
  });

  it("no sections: the document's page setup", () => {
    const f = sectionFrames([], landscape);
    expect(f.width).toBeCloseTo(px(16838));
    expect(f.sections).toHaveLength(1);
  });
});

describe("blockShiftCss", () => {
  it("a paragraph moves and widens with its margins (indents kept)", () => {
    expect(blockShiftCss("text", { dx: -100, extra: 300 }, { left: 48, right: 0 })).toBe("margin-left: -52.00px; margin-right: -200.00px");
  });

  it("a table moves (centred tables by half the extra width)", () => {
    expect(blockShiftCss("table", { dx: -100, extra: 300 })).toBe("position: relative; left: -100.00px");
    expect(blockShiftCss("table", { dx: -100, extra: 300 }, undefined, "center")).toBe("position: relative; left: 50.00px");
    expect(blockShiftCss("table", { dx: -100, extra: 300 }, undefined, "right")).toBe("position: relative; left: 200.00px");
  });

  it("nothing for blocks already in place", () => {
    expect(blockShiftCss("other", { dx: 0, extra: 0 })).toBeNull();
  });
});

describe("sectionShifts (the editor decorations)", () => {
  it("only the landscape section's blocks move", () => {
    const doc = makeDoc([para(1, "portrait", { sectionEnd: 1 }), para(2, "landscape a"), para(3, "landscape b", { sectionEnd: 2 })]);
    const sections = [section(1, portrait), section(2, landscape)];
    doc.sections = sections;
    editor = makeEditor(doc);
    const shifts = sectionShifts(editor.state.doc, sections, portrait, null);
    const ids = shifts.map(([pos]) => editor!.state.doc.nodeAt(pos)!.attrs.id);
    expect(ids).toEqual([2, 3]);
    expect(shifts[0]![1]).toMatch(/^margin-left: -\d+\.\d+px; margin-right: -\d+\.\d+px$/);
  });

  it("one section: nothing", () => {
    editor = makeEditor(makeDoc([para(1, "a")]));
    expect(sectionShifts(editor.state.doc, [section(1, portrait)], portrait, null)).toEqual([]);
  });
});

describe("PageFrame with mixed page widths", () => {
  const sheet = (index: number, page: PageSetup, top: number): SheetView => {
    const geo = pageGeometry(page);
    return { index, top, height: geo.height, bodyTop: top + 96, bodyBottom: top + geo.height - 96, contentEnd: top + 200, geo, header: "", footer: "", notesTop: top + geo.height - 96, notes: [] };
  };
  const layout = (sheets: SheetView[]): PageLayout => ({
    pages: sheets.map((_s, i) => ({ section: i, first: true, value: i + 1, number: String(i + 1) })),
    nodePage: [], pageStarts: [], firstHeader: "", lastFooter: "", sheets, origin: 96, height: 3000, gap: 16, hide: false,
  });

  it("each sheet has its own width, centred; the frame scrolls as wide as the widest page", () => {
    const sections = [section(1, portrait), section(2, landscape)];
    const l = layout([sheet(0, portrait, 0), sheet(1, landscape, pageGeometry(portrait).height + 16)]);
    render(
      <PageFrame page={portrait} view="print" pages={2} layout={l} onEditHeaderFooter={() => undefined} sections={sections}>
        <div />
      </PageFrame>,
    );
    const frame = screen.getByTestId("write-page");
    expect(frame.className).toContain("write-mixed");
    expect(parseFloat(frame.style.width)).toBeCloseTo(px(16838));
    const sheets = [...frame.querySelectorAll<HTMLElement>(".page-sheet")];
    expect(sheets.map((s) => Math.round(parseFloat(s.style.width)))).toEqual([Math.round(px(11906)), Math.round(px(16838))]);
    expect(parseFloat(sheets[0]!.style.left)).toBeCloseTo(sheetLeft(px(16838), px(11906)));
    expect(screen.getByTestId("page-chrome").dataset.sheets).toBe(`${Math.round((px(16838) - px(11906)) / 2)},${Math.round(px(11906))};0,${Math.round(px(16838))}`);
    // The covers of the portrait sheet stay on that sheet.
    const cover = frame.querySelector<HTMLElement>(".page-cover")!;
    expect(parseFloat(cover.style.width)).toBeCloseTo(px(11906));
  });

  it("one page size: the plain white frame as before", () => {
    const l = layout([sheet(0, portrait, 0)]);
    render(
      <PageFrame page={portrait} view="print" pages={1} layout={l} onEditHeaderFooter={() => undefined} sections={[section(1, portrait)]}>
        <div />
      </PageFrame>,
    );
    const frame = screen.getByTestId("write-page");
    expect(frame.className).not.toContain("write-mixed");
    expect(frame.querySelector(".page-sheet")).toBeNull();
    expect(parseFloat(frame.style.width)).toBeCloseTo(px(11906));
  });
});
