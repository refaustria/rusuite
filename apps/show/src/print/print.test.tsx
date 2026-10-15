import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { fixture } from "../test/fixture";
import type { Slide } from "../generated/Slide";
import { renderSlideImages } from "./slideImages";
import { DEFAULT_SHOW_PRINT, buildShowPrintDoc, fitRect, handoutGrid, handoutSlots, printedSlides, showPageSize, slidesPerPage } from "./showPrintDoc";

afterEach(cleanup);

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const WIDE = { width: 12192000, height: 6858000 };
const D = DEFAULT_SHOW_PRINT;
const slide = (id: number, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", shapes: [], ...extra }) as Slide;
const deck = (n: number) => printedSlides(Array.from({ length: n }, (_, i) => slide(i + 1)), false);

describe("print layouts", () => {
  it("page size: the slide for full pages, paper otherwise (auto orientation)", () => {
    expect(showPageSize(D, WIDE)).toEqual({ w: 13.333333333333334, h: 7.5 });
    expect(showPageSize({ ...D, paper: "Letter" }, WIDE)).toEqual({ w: 11, h: 8.5 });
    expect(showPageSize({ ...D, layout: "handout6" }, WIDE).h).toBeCloseTo(297 / 25.4, 3);
    expect(showPageSize({ ...D, layout: "notes", paper: "Letter", orientation: "landscape" }, WIDE)).toEqual({ w: 11, h: 8.5 });
  });
  it("slides per page and handout grids", () => {
    expect(["full", "notes", "handout2", "handout3", "handout4", "handout6"].map((l) => slidesPerPage(l as never))).toEqual([1, 1, 2, 3, 4, 6]);
    expect(handoutGrid(2)).toEqual({ cols: 1, rows: 2 });
    expect(handoutGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(handoutGrid(6)).toEqual({ cols: 2, rows: 3 });
  });
  it("fitRect keeps the aspect ratio, centred", () => {
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, 2)).toEqual({ x: 0, y: 2.5, w: 10, h: 5 });
    expect(fitRect({ x: 1, y: 1, w: 10, h: 2 }, 2)).toEqual({ x: 4, y: 1, w: 4, h: 2 });
  });
  it("handout slots stay inside the page and do not overlap; 3 per page use the left half", () => {
    const page = { w: 8.27, h: 11.69 };
    for (const per of [2, 3, 4, 6]) {
      const slots = handoutSlots(per, page, 16 / 9);
      expect(slots).toHaveLength(per);
      for (const r of slots) {
        expect(r.x).toBeGreaterThanOrEqual(0.5);
        expect(r.x + r.w).toBeLessThanOrEqual(page.w - 0.5);
        expect(r.y + r.h).toBeLessThanOrEqual(page.h - 0.5);
      }
      for (let i = 1; i < slots.length; i++) expect(slots[i]!.y >= slots[i - 1]!.y + slots[i - 1]!.h || slots[i]!.x >= slots[i - 1]!.x + slots[i - 1]!.w).toBe(true);
    }
    expect(Math.max(...handoutSlots(3, page, 16 / 9).map((r) => r.x + r.w))).toBeLessThan(page.w / 2);
  });
  it("hidden slides print only when asked", () => {
    const slides = [slide(1), slide(2, { hidden: true }), slide(3)];
    expect(printedSlides(slides, false).map((s) => s.number)).toEqual([1, 3]);
    expect(printedSlides(slides, true)).toHaveLength(3);
  });
  it("6 slides: 6 full pages, 1 handout page of 6 numbered frames, 2 pages of 4", () => {
    const imgs = Array.from({ length: 6 }, (_, i) => `data:image/png;base64,${i}`);
    expect(buildShowPrintDoc(deck(6), imgs, WIDE, D).pages).toHaveLength(6);
    const h6 = buildShowPrintDoc(deck(6), imgs, WIDE, { ...D, layout: "handout6" });
    expect(h6.pages).toHaveLength(1);
    expect(h6.pages[0]!.match(/<img/g)).toHaveLength(6);
    expect(h6.pages[0]).toContain('class="rs-show-slide rs-frame"');
    expect(h6.pages[0]).toContain(">6</div>");
    expect(buildShowPrintDoc(deck(6), imgs, WIDE, { ...D, layout: "handout4" }).pages).toHaveLength(2);
    expect(buildShowPrintDoc(deck(7), imgs, WIDE, { ...D, layout: "handout3" }).pages[0]).toContain("rs-show-lines");
  });
  it("notes pages: the slide and its notes", () => {
    const doc = buildShowPrintDoc(printedSlides([slide(1, { notes: "Say <hello>" })], false), ["x"], WIDE, { ...D, layout: "notes" });
    expect(doc.pages[0]).toContain("Say &lt;hello&gt;");
    expect(doc.widthIn).toBeLessThan(doc.heightIn);
  });
  it("without fit: the slide at a percentage of its size, centred", () => {
    const doc = buildShowPrintDoc(deck(1), ["x"], WIDE, { ...D, paper: "Letter", fit: false, scale: 50 });
    expect(doc.pages[0]).toContain("width:6.667in;height:3.75in");
  });
});

describe("printing in the app", () => {
  it("renderSlideImages yields one (cached) picture per slide", async () => {
    const pres = fixture();
    const urls = await renderSlideImages(pres, pres.slides, new Map());
    expect(urls).toHaveLength(pres.slides.length);
    expect(await renderSlideImages(pres, pres.slides.slice(0, 1), new Map())).toEqual(urls.slice(0, 1));
  });

  it("Ctrl+P opens File › Print; handouts change the page count; Print prints and the editor stays", async () => {
    const backend = new FakeBackend();
    const print = vi.spyOn(backend, "print");
    const store = new ShowStore(new ShowApi(backend));
    render(<App backend={backend} store={store} />);
    await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const backstage = await screen.findByRole("dialog", { name: "File" });
    await waitFor(() => expect(screen.getByTestId("print-page-count").textContent).toBe("Page 1 of 3"));
    fireEvent.change(within(backstage).getByLabelText("Print layout"), { target: { value: "handout6" } });
    await waitFor(() => expect(screen.getByTestId("print-page-count").textContent).toBe("Page 1 of 1"));
    fireEvent.click(screen.getByTestId("print-button"));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(document.getElementById("rusuite-print-root")!.querySelectorAll(".rs-print-page")).toHaveLength(1);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(document.getElementById("rusuite-print-root")).toBeNull());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(3);
  });
});
