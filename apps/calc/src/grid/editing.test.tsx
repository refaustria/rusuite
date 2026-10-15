// Excel-style formula editing through the real components (App + fake core).

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FUNCTIONS } from "../formula/functions";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import { HEADER_H, HEADER_W } from "./render";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(cleanup);

const colGeo = colGeometry(DEFAULT_FORMAT, new Map());
const rowGeo = rowGeometry(DEFAULT_FORMAT, new Map());
/** Client coordinates of a cell's centre (the grid sits at 0,0 in jsdom). */
const at = (row: number, col: number) => ({
  clientX: HEADER_W + colGeo.offset(col) + colGeo.size(col) / 2,
  clientY: HEADER_H + rowGeo.offset(row) + rowGeo.size(row) / 2,
  button: 0,
});

async function setup(sheets?: string[]) {
  const core = new FakeCalcCore(sheets);
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  Object.defineProperty(grid, "clientWidth", { value: 1000 });
  Object.defineProperty(grid, "clientHeight", { value: 600 });
  grid.focus();
  return { core, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const editor = () => screen.getByTestId("cell-editor") as HTMLTextAreaElement;
const bar = () => screen.getByLabelText("Formula bar") as HTMLInputElement;
const address = () => screen.getByTestId("cell-address").textContent;
const functionOptions = () => within(screen.getByRole("listbox", { name: "Functions" })).getAllByRole("option");

/** Types `text` into the field (caret at the end). */
function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  fireEvent.change(el, { target: { value: text } });
}

describe("point mode with the mouse", () => {
  it("=SUM( then a drag over A1:A3, ) and Enter commits the formula", async () => {
    const { core, grid } = await setup();
    fireEvent.mouseDown(grid, at(0, 2));
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: "=" });
    type(editor(), "=SUM(");
    fireEvent.mouseDown(grid, at(0, 0));
    fireEvent.mouseMove(window, at(1, 0));
    fireEvent.mouseMove(window, at(2, 0));
    fireEvent.mouseUp(window);
    expect(editor().value).toBe("=SUM(A1:A3");
    expect(bar().value).toBe("=SUM(A1:A3");
    expect(document.activeElement).toBe(editor());
    type(editor(), "=SUM(A1:A3)");
    await act(async () => {
      fireEvent.keyDown(editor(), { key: "Enter" });
    });
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 2, input: "=SUM(A1:A3)" }]);
    expect(address()).toBe("C2");
  });

  it("clicking a sheet tab, then a cell, inserts a sheet-qualified reference", async () => {
    const { core, grid } = await setup(["Sheet1", "Sheet2"]);
    fireEvent.keyDown(grid, { key: "=" });
    fireEvent.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    expect(document.activeElement).toBe(bar());
    fireEvent.mouseDown(grid, at(1, 1));
    fireEvent.mouseUp(window);
    expect(bar().value).toBe("=Sheet2!B2");
    await act(async () => {
      fireEvent.keyDown(bar(), { key: "Enter" });
    });
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "=Sheet2!B2" }]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  });

  it("clicking another cell outside point mode commits and selects it", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    type(editor(), "=1+2");
    await act(async () => {
      fireEvent.mouseDown(grid, at(3, 1));
    });
    fireEvent.mouseUp(window);
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "=1+2" }]);
    expect(address()).toBe("B4");
    expect(screen.queryByTestId("cell-editor")).toBeNull();
  });
});

describe("enter vs edit mode", () => {
  it("enter mode: arrows point in a formula and commit plain text", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    fireEvent.keyDown(editor(), { key: "ArrowRight" });
    fireEvent.keyDown(editor(), { key: "ArrowDown", shiftKey: true });
    expect(editor().value).toBe("=B1:B2");
    fireEvent.keyDown(editor(), { key: "Escape" });
    fireEvent.keyDown(grid, { key: "x" });
    await act(async () => {
      fireEvent.keyDown(editor(), { key: "ArrowDown" });
    });
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "x" }]);
    expect(address()).toBe("A2");
  });

  it("edit mode (F2): arrows move the caret; F2 in the editor switches to pointing", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "F2" });
    type(editor(), "=1+");
    fireEvent.keyDown(editor(), { key: "ArrowLeft" });
    expect(screen.queryByTestId("cell-editor")).not.toBeNull();
    expect(editor().value).toBe("=1+");
    fireEvent.keyDown(editor(), { key: "F2" });
    fireEvent.keyDown(editor(), { key: "ArrowRight" });
    expect(editor().value).toBe("=1+B1");
    expect(applied(core.log)).toEqual([]);
  });

  it("F4 cycles the anchoring of the reference at the caret", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    type(editor(), "=A1");
    fireEvent.keyDown(editor(), { key: "F4" });
    expect(editor().value).toBe("=$A$1");
    fireEvent.keyDown(editor(), { key: "F4" });
    expect(editor().value).toBe("=A$1");
  });
});

describe("never losing text", () => {
  it("=A1+ and Enter shows the inline error and keeps the text", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    type(editor(), "=A1+");
    await act(async () => {
      fireEvent.keyDown(editor(), { key: "Enter" });
    });
    expect(screen.getByTestId("formula-error").textContent).toBe("Unexpected end of formula – fix or press Esc to discard");
    expect(editor().value).toBe("=A1+");
    expect(address()).toBe("A1");
    expect(applied(core.log)).toEqual([]);
  });

  it("blur (e.g. a toolbar click) does not commit or discard", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    type(editor(), "=SUM(1,");
    const bold = screen.getByRole("toolbar", { name: "Formatting" }).querySelector("button")!;
    bold.focus();
    fireEvent.blur(editor(), { relatedTarget: bold });
    expect(editor().value).toBe("=SUM(1,");
    expect(applied(core.log)).toEqual([]);
  });
});

describe("formula bar parity, colours and autocomplete", () => {
  it("typing in the bar updates the cell editor and the references are coloured in both", async () => {
    await setup();
    fireEvent.focus(bar());
    type(bar(), "=A1+B2+A1");
    expect(editor().value).toBe("=A1+B2+A1");
    const overlays = screen.getAllByTestId("formula-overlay");
    expect(overlays).toHaveLength(2);
    for (const o of overlays) {
      const spans = [...o.querySelectorAll("span")].map((s) => [s.textContent, s.getAttribute("data-ref-color")]);
      expect(spans.map((s) => s[0])).toEqual(["A1", "B2", "A1"]);
      expect(spans[0][1]).toBe(spans[2][1]);
      expect(spans[0][1]).not.toBe(spans[1][1]);
    }
  });

  it("lists functions while typing a name; Tab accepts; the signature tip bolds the current argument", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "=" });
    type(editor(), "=SU");
    const options = functionOptions().map((o) => o.textContent);
    expect(options[0]).toMatch(/^SUBSTITUTE/);
    fireEvent.keyDown(editor(), { key: "ArrowDown" });
    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().value).toBe("=SUM(");
    expect(screen.queryByRole("listbox", { name: "Functions" })).toBeNull();
    expect(screen.getByTestId("signature-tip").textContent).toBe("SUM(number1, [number2], ...)");
    type(editor(), "=SUM(1,");
    expect(screen.getByTestId("signature-tip").querySelector("b")?.textContent).toBe("[number2]");
  });

  it("the fx button opens the function list in the formula bar", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Insert function" }));
    expect(bar().value).toBe("=");
    expect(functionOptions()).toHaveLength(FUNCTIONS.length);
    fireEvent.click(functionOptions()[1]);
    expect(bar().value).toBe(`=${FUNCTIONS[1].name}(`);
  });
});
