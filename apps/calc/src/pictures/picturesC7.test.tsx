// P9-C7: pictures round 2 — crop math, Picture Format tab, paste, print; Page Break Preview with the print settings.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Picture } from "../generated/Picture";
import type { Request } from "../generated/Request";
import type { CalcStore } from "../state/store";
import { cropFor, cropSource } from "./controller";
import { pictureHtml } from "../print/calcPrintDoc";
import { previewBreaks } from "../datatools/pageBreaks";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import { DEFAULT_CALC_PRINT } from "../print/layout";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

describe("crop math", () => {
  it("dragging the left handle 20 px into a 100 px frame crops 20 % of the image", () => {
    const start = { x: 0, y: 0, w: 100, h: 50 };
    expect(cropFor(start, { x: 20, y: 0, w: 80, h: 50 }, undefined)).toEqual({ left: 20000, top: 0, right: 0, bottom: 0 });
    // Already cropped 50 %: the frame shows half the image, so 10 px are 5 % of it.
    expect(cropFor(start, { x: 0, y: 0, w: 90, h: 50 }, { left: 50000, top: 0, right: 0, bottom: 0 })).toEqual({ left: 50000, top: 0, right: 5000, bottom: 0 });
    // Dragging outwards uncovers the cropped part (and adds space beyond it).
    expect(cropFor(start, { x: -10, y: 0, w: 110, h: 50 }, { left: 20000, top: 0, right: 0, bottom: 0 }).left).toBe(12000);
  });
  it("the source rectangle skips the cropped parts; added space is not read from the image", () => {
    expect(cropSource({ left: 25000, top: 10000, right: 25000, bottom: 0 }, 200, 100)).toEqual({ sx: 50, sy: 10, sw: 100, sh: 90 });
    expect(cropSource({ left: -10000, top: 0, right: 0, bottom: 0 }, 200, 100)).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100 });
  });
});

describe("print and Page Break Preview", () => {
  it("a picture prints cropped, transparent and with its border", () => {
    const pic: Picture = {
      id: 1, name: "P", descr: "Logo", anchor: { type: "absolute", x: 0, y: 0, width: 0, height: 0 }, media: { contentType: "image/png", data: "AAAA" },
      crop: { left: 50000, top: 0, right: 0, bottom: 0 }, transparency: 40, line: { color: { kind: "rgb", value: "FF0000" }, width: 19050 },
    };
    const html = pictureHtml(pic, 100, 50);
    expect(html).toContain('alt="Logo"');
    expect(html).toContain("left:-100.00px;top:0.00px;width:200.00px;height:50.00px;opacity:0.6");
    expect(html).toContain("box-shadow:inset 0 0 0 2px #FF0000");
  });
  it("landscape paper moves the automatic breaks like the print preview", () => {
    const col = colGeometry(DEFAULT_FORMAT, new Map());
    const row = rowGeometry(DEFAULT_FORMAT, new Map());
    const portrait = previewBreaks(col, row, 120, 20, [], []);
    const landscape = previewBreaks(col, row, 120, 20, [], [], { ...DEFAULT_CALC_PRINT, orientation: "landscape" });
    expect(portrait.filter((l) => l.axis === "rows")[0]!.index).toBe(48);
    expect(landscape.filter((l) => l.axis === "rows")[0]!.index).toBeLessThan(48);
    expect(landscape.filter((l) => l.axis === "cols")[0]!.index).toBeGreaterThan(portrait.filter((l) => l.axis === "cols")[0]!.index);
    // A manual break is kept and marked.
    expect(previewBreaks(col, row, 120, 3, [10], []).find((l) => l.index === 10)).toEqual({ axis: "rows", index: 10, manual: true });
  });
});

describe("Picture Format tab", () => {
  it("a selected picture shows the tab: Properties, z-order, transparency, border and alt text send their commands", async () => {
    const core = new FakeCalcCore();
    render(<App backend={new FakeBackend(core)} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
    const pic = (n: number) => ({ id: 0, name: "", descr: `p${n}`, anchor: { type: "oneCell" as const, from: { col: n, row: n, colOffset: 0, rowOffset: 0 }, width: 952500, height: 476250 }, media: { contentType: "image/png", data: "AAAA" } });
    await store.apply({ type: "addPicture", sheet: 0, picture: pic(1) });
    await store.apply({ type: "addPicture", sheet: 0, picture: pic(4) });
    await store.pictures.ensure(0);
    store.pictures.select(0, 1);
    core.log.length = 0;
    fireEvent.click(await screen.findByRole("tab", { name: "Picture Format" }));
    const menu = async (button: string, item: string) => {
      fireEvent.click(screen.getByRole("button", { name: button }));
      const m = within(await screen.findByRole("menu", { name: button }));
      fireEvent.click(m.queryByRole("menuitemradio", { name: item }) ?? m.getByRole("menuitem", { name: item }));
    };
    await menu("Properties", "Don't move or size with cells");
    await menu("Bring Forward", "Bring to Front");
    await menu("Transparency", "Transparency 30 %");
    await menu("Picture Border", "Dark Red");
    await waitFor(() => expect(applied(core.log)).toHaveLength(4));
    expect(applied(core.log)).toEqual([
      { type: "setPictureFormat", sheet: 0, id: 1, format: { placement: "fixed" } },
      { type: "reorderPicture", sheet: 0, id: 1, to: "front" },
      { type: "setPictureFormat", sheet: 0, id: 1, format: { transparency: 30 } },
      { type: "setPictureFormat", sheet: 0, id: 1, format: { line: { color: { kind: "rgb", value: "C00000" }, width: 9525 } } },
    ]);
    await waitFor(() => expect(store.pictures.of(0).map((p) => p.id)).toEqual([2, 1]));
    fireEvent.click(screen.getByRole("button", { name: "Alt Text" }));
    const dlg = await screen.findByRole("dialog", { name: "Alt Text" });
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "Company logo" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log).at(-1)).toEqual({ type: "setPictureFormat", sheet: 0, id: 1, format: { descr: "Company logo" } }));
    // Crop toggles crop mode.
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    expect(store.pictures.cropping).toBe(true);
  });
});
