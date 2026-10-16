// P8-26: pure helpers of notes, comments and links – indicators, note box
// layout, rich runs, navigation, link resolution.
import { describe, expect, it, vi } from "vitest";
import type { CellView } from "../generated/CellView";
import type { NameInfo } from "../generated/NameInfo";
import type { SheetInfo } from "../generated/SheetInfo";
import type { Thread } from "../generated/Thread";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import {
  boundsFromRect, connector, DEFAULT_NOTE_BOUNDS, defaultLinkText, drawIndicators, followAction, formatDate, formatRuns, indicators, initialsOf, isoNow, linkAt, linkHref,
  moveBox, newNoteRuns, normalizeRuns, normalizeUrl, noteBoxRect, openExternal, paneThreads, resizeBox, runsHave, runsText, safeHref, stepCell,
} from "./model";

const col = colGeometry(DEFAULT_FORMAT, new Map());
const row = rowGeometry(DEFAULT_FORMAT, new Map());
const view = (r: number, c: number, extra: Partial<CellView>): CellView => ({ row: r, col: c, input: "", display: "", kind: "empty", style: 0, ...extra });
const cells = (...vs: CellView[]) => {
  const m = new Map<number, Map<number, CellView>>();
  for (const v of vs) {
    if (!m.has(v.row)) m.set(v.row, new Map());
    m.get(v.row)!.set(v.col, v);
  }
  return m;
};

describe("indicators", () => {
  it("marks notes red, open threads purple and resolved threads outlined, at the cell's top-right corner", () => {
    const list = indicators(cells(view(1, 1, { note: true }), view(2, 0, { comment: "open" }), view(3, 3, { comment: "resolved", note: true }), view(4, 4, { input: "x" })), col, row, [0, 10], [0, 10]);
    expect(list).toEqual([
      { row: 1, col: 1, x: 128, y: 20, kind: "note" },
      { row: 2, col: 0, x: 64, y: 40, kind: "comment" },
      { row: 3, col: 3, x: 256, y: 60, kind: "resolved" },
    ]);
  });

  it("only lists the visible rows and columns", () => {
    const list = indicators(cells(view(1, 1, { note: true }), view(50, 1, { note: true }), view(1, 40, { note: true })), col, row, [0, 30], [0, 20]);
    expect(list.map((i) => i.row)).toEqual([1]);
  });

  it("draws a filled triangle for a note and strokes a resolved marker", () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === "fillStyle" || k === "strokeStyle" || k === "lineWidth" ? undefined : () => calls.push(String(k))), set: () => true }) as unknown as CanvasRenderingContext2D;
    drawIndicators(ctx, [{ row: 0, col: 0, x: 64, y: 0, kind: "note" }, { row: 1, col: 0, x: 64, y: 20, kind: "resolved" }], 0, 0);
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
  });
});

describe("note boxes", () => {
  it("places the default box 15 px right of and 10 px above the cell's top-right corner, 128 × 74 px", () => {
    expect(noteBoxRect({ row: 2, col: 1 }, col, row)).toEqual({ x: 143, y: 30, w: 128, h: 74 });
  });

  it("uses the note's bounds (points) and clamps to the sheet's top-left", () => {
    expect(noteBoxRect({ row: 0, col: 0, bounds: { x: 0, y: -30, w: 75, h: 45 } }, col, row)).toEqual({ x: 64, y: 0, w: 100, h: 60 });
  });

  it("turns a dragged box back into bounds", () => {
    const rect = noteBoxRect({ row: 4, col: 2, bounds: DEFAULT_NOTE_BOUNDS }, col, row);
    expect(boundsFromRect({ row: 4, col: 2 }, rect, col, row)).toEqual(DEFAULT_NOTE_BOUNDS);
    expect(boundsFromRect({ row: 4, col: 2 }, moveBox(rect, 40, 20), col, row)).toEqual({ ...DEFAULT_NOTE_BOUNDS, x: 41.25, y: 7.5 });
  });

  it("connects the cell corner to the nearest point of the box", () => {
    const box = { x: 143, y: 30, w: 128, h: 74 };
    expect(connector({ row: 2, col: 1 }, box, col, row)).toEqual({ x1: 128, y1: 40, x2: 143, y2: 40 });
  });

  it("moves without leaving the sheet and resizes from each handle with a minimum size", () => {
    const r = { x: 10, y: 10, w: 100, h: 60 };
    expect(moveBox(r, -50, 5)).toEqual({ x: 0, y: 15, w: 100, h: 60 });
    expect(resizeBox(r, "se", 20, 10)).toEqual({ x: 10, y: 10, w: 120, h: 70 });
    expect(resizeBox(r, "nw", 20, 10)).toEqual({ x: 30, y: 20, w: 80, h: 50 });
    expect(resizeBox(r, "e", -500, 0).w).toBe(20);
    expect(resizeBox(r, "n", 0, 500)).toEqual({ x: 10, y: 54, w: 100, h: 16 });
  });
});

describe("rich note text", () => {
  const runs = [{ text: "Ann:", font: { bold: true } }, { text: "\nhello world" }];

  it("joins and normalizes runs", () => {
    expect(runsText(runs)).toBe("Ann:\nhello world");
    expect(normalizeRuns([{ text: "a" }, { text: "" }, { text: "b", font: {} }, { text: "c", font: { italic: true } }])).toEqual([{ text: "ab" }, { text: "c", font: { italic: true } }]);
  });

  it("formats a selection, splitting runs", () => {
    expect(formatRuns(runs, 5, 10, { italic: true })).toEqual([{ text: "Ann:", font: { bold: true } }, { text: "\n" }, { text: "hello", font: { italic: true } }, { text: " world" }]);
  });

  it("formats the whole note when nothing is selected, and un-bolding drops the flag", () => {
    expect(formatRuns(runs, 3, 3, { size: 1200 })).toEqual([{ text: "Ann:", font: { bold: true, size: 1200 } }, { text: "\nhello world", font: { size: 1200 } }]);
    expect(formatRuns(runs, 0, 4, { bold: false })).toEqual([{ text: "Ann:\nhello world" }]);
  });

  it("tells whether a selection is bold", () => {
    expect(runsHave(runs, 0, 4, "bold")).toBe(true);
    expect(runsHave(runs, 0, 6, "bold")).toBe(false);
    expect(runsHave([], 0, 0, "italic")).toBe(false);
  });

  it("starts a new note with the author in bold, as Excel", () => {
    expect(newNoteRuns("Ann Lee")).toEqual([{ text: "Ann Lee:", font: { bold: true } }, { text: "\n" }]);
    expect(newNoteRuns("")).toEqual([]);
  });
});

describe("threads", () => {
  const thread = (r: number, c: number, resolved = false): Thread => ({ id: `${r}:${c}`, row: r, col: c, author: { name: "A" }, date: "", text: "", ...(resolved ? { resolved } : {}) });

  it("derives initials and Excel's local ISO date", () => {
    expect(initialsOf("Ann Marie Lee")).toBe("AL");
    expect(initialsOf("bob")).toBe("B");
    expect(initialsOf("  ")).toBe("?");
    expect(isoNow(new Date(2026, 9, 16, 9, 5, 7))).toBe("2026-10-16T09:05:07.00");
    expect(formatDate("not a date")).toBe("");
    expect(formatDate("2026-10-16T09:05:07.00")).not.toBe("");
  });

  it("steps to the next / previous annotated cell by rows, wrapping around", () => {
    const list = [thread(5, 0), thread(1, 3), thread(1, 1)];
    expect(stepCell(list, { row: 1, col: 1 }, 1)?.id).toBe("1:3");
    expect(stepCell(list, { row: 9, col: 9 }, 1)?.id).toBe("1:1");
    expect(stepCell(list, { row: 1, col: 1 }, -1)?.id).toBe("5:0");
    expect(stepCell([], { row: 0, col: 0 }, 1)).toBeNull();
  });

  it("filters the pane by state, sorted by cell", () => {
    const list = [thread(3, 0, true), thread(1, 0), thread(2, 0)];
    expect(paneThreads(list, "all").map((t) => t.row)).toEqual([1, 2, 3]);
    expect(paneThreads(list, "open").map((t) => t.row)).toEqual([1, 2]);
    expect(paneThreads(list, "resolved").map((t) => t.row)).toEqual([3]);
  });
});

describe("hyperlinks", () => {
  const sheets: SheetInfo[] = [{ id: 0, name: "Sheet1" }, { id: 4, name: "My Data" }];
  const names: NameInfo[] = [{ name: "Totals", refersTo: "'My Data'!$B$2:$B$5", range: { sheet: 4, r0: 1, c0: 1, r1: 4, c1: 1 } }];

  it("finds the link covering a cell", () => {
    const links = [{ r0: 1, c0: 1, r1: 2, c1: 3, target: { kind: "url" as const, url: "u" } }];
    expect(linkAt(links, 2, 3)).toBe(links[0]);
    expect(linkAt(links, 3, 3)).toBeUndefined();
  });

  it("builds hrefs and the default display text", () => {
    expect(linkHref({ kind: "email", address: "a@b.at", subject: "Hi & bye" })).toBe("mailto:a@b.at?subject=Hi%20%26%20bye");
    expect(linkHref({ kind: "location", location: "A1" })).toBeNull();
    expect(defaultLinkText({ kind: "email", address: "a@b.at" })).toBe("mailto:a@b.at");
    expect(defaultLinkText({ kind: "location", location: "Sheet1!A1" })).toBe("Sheet1!A1");
  });

  it("only follows safe schemes and normalizes typed addresses", () => {
    expect(safeHref("https://x.at")).toBe(true);
    expect(safeHref("javascript:alert(1)")).toBe(false);
    expect(safeHref("DATA:text/html,x")).toBe(false);
    expect(normalizeUrl(" www.example.com ")).toBe("http://www.example.com");
    expect(normalizeUrl("me@example.com")).toBe("mailto:me@example.com");
    expect(normalizeUrl("https://x.at/a")).toBe("https://x.at/a");
    expect(normalizeUrl("")).toBe("");
  });

  it("resolves places in the workbook: sheet references and defined names", () => {
    expect(followAction({ kind: "location", location: "'My Data'!C3" }, names, sheets, 0)).toEqual({ kind: "internal", sheet: 4, range: { r0: 2, c0: 2, r1: 2, c1: 2 } });
    expect(followAction({ kind: "location", location: "Totals" }, names, sheets, 0)).toEqual({ kind: "internal", sheet: 4, range: { r0: 1, c0: 1, r1: 4, c1: 1 } });
    expect(followAction({ kind: "location", location: "Nowhere!A1" }, names, sheets, 0)).toBeNull();
    expect(followAction({ kind: "url", url: "https://x.at" }, names, sheets, 0)).toEqual({ kind: "external", href: "https://x.at" });
    expect(followAction({ kind: "url", url: "javascript:void 0" }, names, sheets, 0)).toBeNull();
  });

  it("opens external links with an anchor element, not window.open", () => {
    const open = vi.spyOn(window, "open");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    openExternal("https://example.com/");
    expect(click).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector("a[target=_blank]")).toBeNull();
    click.mockRestore();
    open.mockRestore();
  });
});
