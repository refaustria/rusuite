// P11-N4: Notes canvas pages and ink – Free canvas toggle, click-to-type boxes, moving/resizing boxes (grid, undo),
// pen (pressure) / highlighter / eraser / lasso (move, recolour, delete), back to a flowing page, an imported
// OneNote page with ink, print, 2 000 strokes pan/zoom frame times, the 412 px layout. `NOTES_SHOTS=<dir>` saves
// screenshots.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileCommand, testdata, trackErrors } from "../support/common";

const shots = process.env.NOTES_SHOTS;

interface CanvasJson {
  canvas: { id: string; kind: string; x: number; y: number; w: number; h: number; blob?: string }[];
  ink: { id: string; tool: string; color: string; width: number; points: number[] }[];
  meta: { canvas?: boolean };
}

async function openNotes(page: Page) {
  await page.goto("notes/");
  await expect(page.getByTestId("page-editor")).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
}

async function newPage(page: Page, title: string) {
  await page.getByTestId("new-page").click();
  const t = page.getByTestId("page-title");
  await expect(t).toHaveValue("");
  await t.fill(title);
  await t.press("Enter");
}

async function saved(page: Page) {
  await page.evaluate(() => (window as unknown as { __rusuiteNotes: { idle(): Promise<void> } }).__rusuiteNotes.idle());
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
}

/** The open page's canvas data, read from the editor's Loro mirror. */
const data = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __rusuiteNotes: { getState(): { mirror: { doc: { toJSON(): Record<string, unknown> } } } } }).__rusuiteNotes.getState().mirror;
    const j = m.doc.toJSON() as Partial<CanvasJson>;
    return { canvas: j.canvas ?? [], ink: j.ink ?? [], meta: j.meta ?? {} } as CanvasJson;
  });

const drawTab = (page: Page) => page.getByRole("tab", { name: "Draw", exact: true }).click();
const surface = (page: Page) => page.getByTestId("canvas-surface");
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function toCanvas(page: Page) {
  await drawTab(page);
  await page.getByRole("button", { name: "Free canvas", exact: true }).click();
  await expect(surface(page)).toBeVisible();
}

async function origin(page: Page) {
  const b = await surface(page).boundingBox();
  return { x: b!.x, y: b!.y };
}

/** A mouse stroke through surface points (px at 100 %). */
async function stroke(page: Page, pts: Array<[number, number]>) {
  const o = await origin(page);
  await page.mouse.move(o.x + pts[0]![0], o.y + pts[0]![1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(o.x + x, o.y + y, { steps: 5 });
  await page.mouse.up();
}

/** Pen input with pressure (synthetic pointer events – the mouse has none). */
async function penStroke(page: Page, pts: Array<[number, number, number]>, pointerType = "pen") {
  const o = await origin(page);
  await page.evaluate(
    ({ pts, o, pointerType }) => {
      const el = document.querySelector('[data-testid="canvas-tool-layer"]')!;
      const fire = (type: string, [x, y, p]: [number, number, number]) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType, isPrimary: true, clientX: o.x + x, clientY: o.y + y, pressure: p, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1 }));
      fire("pointerdown", pts[0]!);
      for (const p of pts.slice(1)) fire("pointermove", p);
      fire("pointerup", pts[pts.length - 1]!);
    },
    { pts, o, pointerType },
  );
}

const wave = (x0: number, y0: number, n = 12, dx = 15, amp = 12): Array<[number, number]> => Array.from({ length: n }, (_, i) => [x0 + i * dx, y0 + Math.sin(i / 1.5) * amp]);

/** Ctrl+Z on the canvas (not in a text box). */
async function undoOnCanvas(page: Page) {
  await page.getByTestId("canvas-scroll").focus();
  await page.keyboard.press("Control+z");
}

test.describe("Notes canvas pages and ink (P11-N4)", () => {
  test("Free canvas: content becomes a box; click creates a box; move by the bar (8 px grid); resize; undo per step; reload", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Sketch");
    await page.keyboard.type("Intro text on the page");
    await toCanvas(page);
    let d = await data(page);
    expect(d.meta.canvas).toBe(true);
    expect(d.canvas).toHaveLength(1);
    expect(d.canvas[0]).toMatchObject({ kind: "text", x: 0, y: 0 });
    const intro = page.getByTestId("page-editor").locator("p", { hasText: "Intro text" });
    await expect(intro).toHaveAttribute("data-canvas-box", d.canvas[0]!.id);

    // Click on empty space: a new box with the caret in it (OneNote).
    const o = await origin(page);
    await page.mouse.click(o.x + 421, o.y + 250);
    await page.keyboard.type("Second box");
    d = await data(page);
    expect(d.canvas).toHaveLength(2);
    const second = d.canvas[1]!;
    // Snapped to the 8 px grid: px = pt × 4/3.
    expect(((second.x * 4) / 3) % 8).toBeCloseTo(0, 5);
    expect(((second.y * 4) / 3) % 8).toBeCloseTo(0, 5);
    const block = page.getByTestId("page-editor").locator("p", { hasText: "Second box" });
    await expect(block).toHaveAttribute("data-canvas-box", second.id);
    const b0 = (await block.boundingBox())!;
    expect(Math.abs(b0.x - (o.x + 421))).toBeLessThan(20);

    // Move by the top bar: one undo step, on the grid.
    await block.hover();
    const bar = page.locator(`[data-testid="canvas-box"][data-box="${second.id}"] [data-testid="canvas-box-bar"]`);
    await expect(bar).toBeVisible();
    const bb = (await bar.boundingBox())!;
    await page.mouse.move(bb.x + 20, bb.y + 5);
    await page.mouse.down();
    await page.mouse.move(bb.x + 70, bb.y + 40, { steps: 6 });
    await page.mouse.move(bb.x + 123, bb.y + 85, { steps: 6 });
    await page.mouse.up();
    d = await data(page);
    const moved = d.canvas.find((c) => c.id === second.id)!;
    expect(((moved.x * 4) / 3) % 8).toBeCloseTo(0, 5);
    expect(((moved.x - second.x) * 4) / 3).toBeCloseTo(104, 0);
    expect(((moved.y - second.y) * 4) / 3).toBeCloseTo(80, 0);
    await expect.poll(async () => (await block.boundingBox())!.x - b0.x).toBeCloseTo(104, 0);

    // Resize the width by the right edge.
    await block.hover();
    const handle = page.locator(`[data-testid="canvas-box"][data-box="${second.id}"] [data-testid="canvas-box-resize"]`);
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + 4, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 84, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    d = await data(page);
    const resized = d.canvas.find((c) => c.id === second.id)!;
    expect(((resized.w - moved.w) * 4) / 3).toBeCloseTo(80, 0);

    // Undo: the resize, then the move (each one step).
    await undoOnCanvas(page);
    await expect.poll(async () => (await data(page)).canvas.find((c) => c.id === second.id)!.w).toBeCloseTo(moved.w, 3);
    await undoOnCanvas(page);
    await expect.poll(async () => (await data(page)).canvas.find((c) => c.id === second.id)!.x).toBeCloseTo(second.x, 3);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await data(page)).canvas.find((c) => c.id === second.id)!.x).toBeCloseTo(moved.x, 3);

    // Clicking around leaves no empty boxes behind.
    await page.mouse.click(o.x + 700, o.y + 500);
    await page.mouse.click(o.x + 760, o.y + 560);
    expect((await data(page)).canvas).toHaveLength(3);

    await saved(page);
    await page.reload();
    await expect(surface(page)).toBeVisible();
    await expect(page.getByTestId("page-editor").locator("p", { hasText: "Second box" })).toHaveAttribute("data-canvas-box", second.id);
    if (shots) await page.screenshot({ path: path.join(shots, "P11-N4-canvas-boxes.png") });
    errors.expectNone();
  });

  test("ink: pen with pressure and coalesced points, highlighter under text, stroke eraser, one undo step per stroke", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Ink");
    await page.keyboard.type("Text under the highlighter");
    await toCanvas(page);
    await tool(page, "Pen").click();
    await expect(page.getByTestId("canvas-tool-layer")).toBeVisible();
    await stroke(page, wave(40, 200));
    await stroke(page, wave(40, 260));
    // A pen with pressure: stored 0–255.
    await penStroke(page, Array.from({ length: 15 }, (_, i) => [300 + i * 10, 220 + (i % 3) * 6, 0.2 + i * 0.05] as [number, number, number]));
    let d = await data(page);
    expect(d.ink).toHaveLength(3);
    expect(d.ink.every((s) => s.tool === "pen" && s.points.every(Number.isInteger) && s.points.length % 3 === 0)).toBe(true);
    const pressures = d.ink[2]!.points.filter((_, i) => i % 3 === 2);
    expect(pressures[0]).toBe(51);
    expect(Math.max(...pressures)).toBeGreaterThan(200);
    // Simplified (RDP ε 0.5 px): a straight run keeps few points.
    await stroke(page, [
      [40, 330],
      [240, 330],
    ]);
    d = await data(page);
    expect(d.ink[3]!.points.length / 3).toBeLessThanOrEqual(3);
    await expect(page.getByTestId("ink-layer-pen").getByTestId("ink-stroke")).toHaveCount(4);

    // Highlighter across the text: below the text layer.
    await tool(page, "Highlighter").click();
    const textBox = (await page.getByTestId("page-editor").locator("p").first().boundingBox())!;
    const o = await origin(page);
    await stroke(page, [
      [textBox.x - o.x, textBox.y - o.y + textBox.height / 2],
      [textBox.x - o.x + 180, textBox.y - o.y + textBox.height / 2],
    ]);
    d = await data(page);
    expect(d.ink[4]).toMatchObject({ tool: "highlighter", width: 120 });
    const z = await page.evaluate(() => {
      const zi = (s: string) => Number(getComputedStyle(document.querySelector(s)!).zIndex);
      return { hl: zi('[data-testid="ink-layer-highlighter"]'), text: zi(".ProseMirror > p"), pen: zi('[data-testid="ink-layer-pen"]') };
    });
    expect(z.hl).toBeLessThan(z.text);
    expect(z.pen).toBeGreaterThan(z.text);
    if (shots) await page.screenshot({ path: path.join(shots, "P11-N4-highlighter.png") });

    // Undo removes the last stroke only, redo brings it back.
    await undoOnCanvas(page);
    await expect.poll(async () => (await data(page)).ink.length).toBe(4);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await data(page)).ink.length).toBe(5);

    // Stroke eraser: across the first wave.
    await tool(page, "Eraser").click();
    await stroke(page, [
      [100, 170],
      [100, 230],
    ]);
    d = await data(page);
    expect(d.ink).toHaveLength(4);
    expect(d.ink.some((s) => s.points[1] === Math.round((200 * 7.5) / 1))).toBe(false);
    await undoOnCanvas(page);
    await expect.poll(async () => (await data(page)).ink.length).toBe(5);
    await tool(page, "Type").click();
    if (shots) await page.screenshot({ path: path.join(shots, "P11-N4-canvas-ink.png") });
    await saved(page);
    await page.reload();
    await expect(page.getByTestId("ink-layer-pen").getByTestId("ink-stroke")).toHaveCount(4);
    errors.expectNone();
  });

  test("lasso: selects strokes and a box, moves them, recolours, deletes", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Lasso");
    await toCanvas(page);
    await tool(page, "Type").click();
    const o = await origin(page);
    await page.mouse.click(o.x + 104, o.y + 300);
    await page.keyboard.type("Boxed words");
    await tool(page, "Pen").click();
    await stroke(page, wave(100, 380));
    await stroke(page, wave(120, 420));
    await stroke(page, wave(600, 600));
    await tool(page, "Lasso select").click();
    await stroke(page, [
      [60, 270],
      [360, 270],
      [360, 470],
      [60, 470],
      [60, 272],
    ]);
    const sel = page.getByTestId("canvas-selection");
    await expect(sel).toHaveAttribute("data-items", "1");
    await expect(sel).toHaveAttribute("data-strokes", "2");
    if (shots) await page.screenshot({ path: path.join(shots, "P11-N4-lasso.png") });
    const before = await data(page);
    // Drag the selection: strokes and the box move together.
    const sb = (await sel.boundingBox())!;
    await page.mouse.move(sb.x + 50, sb.y + 50);
    await page.mouse.down();
    await page.mouse.move(sb.x + 90, sb.y + 74, { steps: 6 });
    await page.mouse.up();
    const after = await data(page);
    const dxTenths = after.ink[0]!.points[0]! - before.ink[0]!.points[0]!;
    expect(dxTenths).toBe(300); // 40 px = 30 pt
    expect(after.ink[2]!.points).toEqual(before.ink[2]!.points);
    expect(((after.canvas[0]!.x - before.canvas[0]!.x) * 4) / 3).toBeCloseTo(40, 0);
    // Recolour, then delete.
    await page.getByRole("button", { name: "Recolour", exact: true }).click();
    await page.getByRole("menuitem", { name: "Red" }).click();
    const rec = await data(page);
    expect(rec.ink.slice(0, 2).map((s) => s.color)).toEqual(["#E81123", "#E81123"]);
    expect(rec.ink[2]!.color).toBe("#000000");
    await expect(page.getByTestId("page-editor").locator('span[style*="color"]')).toHaveText("Boxed words");
    await page.getByTestId("canvas-scroll").focus();
    await page.keyboard.press("Delete");
    const del = await data(page);
    expect(del.ink).toHaveLength(1);
    expect(del.canvas).toHaveLength(0);
    errors.expectNone();
  });

  test("back to a flowing page: boxes in reading order, drawings hidden with a notice; on again shows them", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Flow");
    await toCanvas(page);
    const o = await origin(page);
    await page.mouse.click(o.x + 400, o.y + 100);
    await page.keyboard.type("Right");
    await page.mouse.click(o.x + 20, o.y + 100);
    await page.keyboard.type("Left");
    await page.mouse.click(o.x + 20, o.y + 400);
    await page.keyboard.type("Bottom");
    await tool(page, "Pen").click();
    await stroke(page, wave(100, 300));
    await page.getByRole("button", { name: "Free canvas", exact: true }).click();
    await expect(surface(page)).toHaveCount(0);
    const texts = await page.getByTestId("page-editor").locator("p").allTextContents();
    expect(texts.filter(Boolean)).toEqual(["Left", "Right", "Bottom"]);
    await expect(page.getByTestId("ink-hidden")).toBeVisible();
    const d = await data(page);
    expect(d.meta.canvas).toBe(false);
    expect(d.ink).toHaveLength(1);
    expect(d.canvas).toHaveLength(0);
    expect(await page.getByTestId("page-editor").locator("[data-canvas-item]").count()).toBe(0);
    await page.getByRole("button", { name: "Free canvas", exact: true }).click();
    await expect(page.getByTestId("ink-layer-pen").getByTestId("ink-stroke")).toHaveCount(1);
    errors.expectNone();
  });

  test("imported OneNote page (handwriting_recognition.one): positions and ink render", async ({ page }) => {
    const errors = trackErrors(page);
    await openNotes(page);
    const b64 = fs.readFileSync(testdata("onenote/handwriting_recognition.one")).toString("base64");
    // Through the converter module (P11-N6b) and the core's apply_import, without the import UI.
    const pages = await page.evaluate(async (b64) => {
      type Ctl = {
        getState(): { notebook: string };
        backend: {
          converter: { importFile(r: object, b: Uint8Array): Promise<Uint8Array> };
          applyImport(r: object, frame: Uint8Array): Promise<{ ok?: { pages: { docId: string }[] }; err?: { message: string } }>;
        };
        pump(): Promise<void>;
        refreshNotebook(id: string): Promise<void>;
      };
      const ctl = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
      const nb = ctl.getState().notebook;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const frame = await ctl.backend.converter.importFile({ kind: "oneNote", fileName: "handwriting_recognition.one", seed: 7 }, bin);
      const r = await ctl.backend.applyImport({ type: "importOneNote", fileName: "handwriting_recognition.one", notebook: nb, now: Date.now() }, frame);
      if (!r.ok) throw new Error(r.err?.message);
      await ctl.pump();
      await ctl.refreshNotebook(nb);
      return r.ok.pages.map((p) => p.docId);
    }, b64);
    expect(pages.length).toBeGreaterThan(0);
    let shown = 0;
    for (const docId of pages) {
      await page.evaluate((id) => (window as unknown as { __rusuiteNotes: { openPageByDoc(id: string): Promise<boolean> } }).__rusuiteNotes.openPageByDoc(id), docId);
      await expect(page.getByTestId("page")).toHaveAttribute("data-doc", docId);
      const d = await data(page);
      if (!d.meta.canvas) continue;
      await expect(surface(page)).toBeVisible();
      await expect(page.getByTestId("ink-stroke")).toHaveCount(d.ink.length);
      // Every text item's blocks sit at the item's position.
      for (const it of d.canvas.filter((c) => c.kind === "text")) {
        const blk = page.locator(`.ProseMirror > [data-canvas-box="${it.id}"]`).first();
        if ((await blk.count()) === 0) continue;
        const left = await blk.evaluate((el) => parseFloat((el as HTMLElement).style.left));
        expect(left).toBeCloseTo((it.x * 4) / 3, 2);
      }
      shown += d.ink.length;
      if (shown && shots) await page.screenshot({ path: path.join(shots, "P11-N4-onenote.png") });
    }
    expect(shown).toBeGreaterThanOrEqual(20);
    errors.expectNone();
  });

  test("print: the canvas bounding box scaled to the page width", async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => {
      (window as unknown as { __print: unknown }).__print = null;
      window.print = () => {
        const root = document.getElementById("rusuite-print-root");
        const surf = root?.querySelector<HTMLElement>(".notes-canvas-surface");
        (window as unknown as { __print: unknown }).__print = {
          pages: root?.querySelectorAll(".rs-print-page").length ?? 0,
          strokes: root?.querySelectorAll(".rs-print-page")[0]?.querySelectorAll("path").length ?? 0,
          text: root?.textContent ?? "",
          transform: surf?.style.transform ?? "",
          editable: root?.querySelectorAll("[contenteditable]").length ?? 0,
        };
      };
    });
    await openNotes(page);
    await newPage(page, "Wide drawing");
    await toCanvas(page);
    await tool(page, "Pen").click();
    await stroke(page, wave(20, 200, 25, 40, 20)); // ~980 px wide: wider than A4's printable 698 px
    await tool(page, "Type").click();
    // File › Export PDF (the web: the print dialog) prints a canvas page as drawn (P11-N3 took over Draw › Print canvas).
    await fileCommand(page, /^Export PDF/);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __print: unknown }).__print)).not.toBeNull();
    const p = (await page.evaluate(() => (window as unknown as { __print: { pages: number; strokes: number; text: string; transform: string; editable: number } }).__print))!;
    expect(p.pages).toBe(1);
    expect(p.strokes).toBe(1);
    expect(p.text).toContain("Wide drawing");
    expect(p.editable).toBe(0);
    const scale = Number(/scale\(([\d.]+)\)/.exec(p.transform)![1]);
    expect(scale).toBeGreaterThan(0.6);
    expect(scale).toBeLessThan(0.8);
    errors.expectNone();
  });

  test("2 000 strokes: pan and zoom frame times", async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    await openNotes(page);
    await newPage(page, "Many strokes");
    await toCanvas(page);
    await page.evaluate(() => {
      type Doc = { getList(n: string): { length: number; insertContainer(i: number, c: unknown): { set(k: string, v: unknown): void } }; getMap(n: string): object; commit(): void };
      const doc = (window as unknown as { __rusuiteNotes: { getState(): { mirror: { doc: Doc } } } }).__rusuiteNotes.getState().mirror.doc;
      const LoroMap = (doc.getMap("meta") as { constructor: new () => unknown }).constructor;
      const ink = doc.getList("ink");
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 2000; i++) {
        const x0 = rnd() * 2400;
        const y0 = rnd() * 2400;
        const pts: number[] = [];
        for (let k = 0; k < 40; k++) pts.push(Math.round((x0 + k * 3) * 7.5), Math.round((y0 + Math.sin(k / 4) * 20) * 7.5), 128);
        const m = ink.insertContainer(ink.length, new LoroMap());
        m.set("id", `s-perf-${i}`);
        m.set("tool", i % 10 === 0 ? "highlighter" : "pen");
        m.set("color", "#2B579A");
        m.set("width", 20);
        m.set("points", pts);
      }
      doc.commit();
    });
    await expect(page.getByTestId("ink-stroke")).toHaveCount(2000);
    const measure = (mode: "pan" | "zoom") =>
      page.evaluate(async (mode) => {
        const el = document.querySelector<HTMLElement>('[data-testid="canvas-scroll"]')!;
        const frames: number[] = [];
        let last = performance.now();
        const r = el.getBoundingClientRect();
        for (let i = 0; i < 90; i++) {
          if (mode === "pan") {
            el.scrollTop += 24;
            el.scrollLeft += 12;
          } else {
            el.dispatchEvent(new WheelEvent("wheel", { deltaY: i < 45 ? -40 : 40, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
          }
          await new Promise((res) => requestAnimationFrame(() => res(null)));
          const now = performance.now();
          frames.push(now - last);
          last = now;
        }
        frames.sort((a, b) => a - b);
        const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
        return { fps: Math.round(1000 / avg), p95: Math.round(frames[Math.floor(frames.length * 0.95)]! * 10) / 10 };
      }, mode);
    const pan = await measure("pan");
    const zoom = await measure("zoom");
    info.annotations.push({ type: "perf", description: `2000 strokes – pan ${pan.fps} fps (p95 ${pan.p95} ms), zoom ${zoom.fps} fps (p95 ${zoom.p95} ms)` });
    console.log(`P11-N4 perf: 2000 strokes – pan ${pan.fps} fps (p95 ${pan.p95} ms), zoom ${zoom.fps} fps (p95 ${zoom.p95} ms)`);
    // Alone on a mid laptop both stay near 60 fps; the floor leaves room for a fully loaded parallel suite.
    expect(pan.fps).toBeGreaterThanOrEqual(20);
    expect(zoom.fps).toBeGreaterThanOrEqual(15);
    errors.expectNone();
  });

  test.describe("412 px", () => {
    test.use({ viewport: { width: 412, height: 915 }, hasTouch: true });
    test("a canvas page is viewable and pannable; touch draws", async ({ page }) => {
      const errors = trackErrors(page);
      await openNotes(page);
      // The compact command bar has the same tabs.
      await page.getByTestId("command-tabs").getByRole("tab", { name: "Draw" }).click();
      await page.getByTestId("command-panel").getByRole("button", { name: "Free canvas" }).click();
      await expect(surface(page)).toBeVisible();
      const scroll = page.getByTestId("canvas-scroll");
      const dims = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(dims.sw).toBeGreaterThan(dims.cw);
      await scroll.evaluate((el) => (el.scrollLeft = 200));
      expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // Touch draws with the pen.
      await page.getByTestId("command-panel").getByRole("button", { name: "Pen", exact: true }).click();
      await scroll.evaluate((el) => (el.scrollLeft = 0));
      await penStroke(page, Array.from({ length: 10 }, (_, i) => [60 + i * 12, 520 + (i % 2) * 8, 0] as [number, number, number]), "touch");
      await expect.poll(async () => (await data(page)).ink.length).toBe(1);
      await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
      if (shots) await page.screenshot({ path: path.join(shots, "P11-N4-compact.png") });
      errors.expectNone();
    });
  });
});
