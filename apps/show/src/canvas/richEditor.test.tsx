// The in-place text editor (P8-45 S-01): the DOM mapper and the editor in the app.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import type { TextBody } from "../generated/TextBody";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { input, replaceAll, select, typeText } from "../test/editor";
import { approxMeasure, layoutText, type LayoutOptions, type RunStyle } from "../text/layout";
import { buildParagraphs, domToOffset, offsetToDom, readDomText, readSelection } from "./richEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const style = (p: { bold?: boolean | null; size?: number | null } | undefined, level = 0): RunStyle => ({
  fontFamily: "Calibri",
  sizePx: ((p?.size ?? (level ? 2400 : 2800)) / 100) * (4 / 3),
  bold: !!p?.bold,
  italic: false,
  underline: false,
  strike: false,
  color: "#112233",
});
const opts = (width = 600, height = 400): LayoutOptions => ({ width, height, measure: approxMeasure, runStyle: style, paragraphProps: (p) => p ?? {} });
const insets = { left: 91440, top: 45720, right: 91440, bottom: 45720 };
const dot = { kind: "char", value: "•" } as const;
const sample = (): TextBody => ({
  props: { anchor: "top", wrap: true, insets, autofit: "none" },
  paragraphs: [
    { props: { bullet: dot }, runs: [{ text: "Plain " }, { text: "bold", props: { bold: true } }] },
    { props: { bullet: dot, level: 1 }, runs: [{ text: "Second" }] },
    { props: { bullet: dot }, runs: [] },
    { props: { bullet: { kind: "autoNum", value: "arabicPeriod" } }, runs: [{ text: "One" }] },
  ],
});

function root(body: TextBody, o = opts()) {
  const el = document.createElement("div");
  el.append(...buildParagraphs(document, body, layoutText(body, o), o));
  document.body.appendChild(el);
  return el;
}

describe("in-place editor DOM", () => {
  it("one block per paragraph with its bullet, level and the layout's indents", () => {
    const body = sample();
    const lay = layoutText(body, opts());
    const el = root(body);
    const ps = [...el.querySelectorAll<HTMLElement>("[data-p]")];
    expect(ps.map((p) => p.dataset.bullet)).toEqual(["•", "•", "•", "1."]);
    expect(ps.map((p) => p.dataset.level)).toEqual(["0", "1", "0", "0"]);
    expect(ps.map((p) => parseFloat(p.style.paddingLeft))).toEqual(lay.paragraphs!.map((m) => m.textX));
    // the text starts where the slide draws it: the text fragment's x = the left inset + the block's padding
    const second = lay.fragments.find((f) => f.text === "Second")!;
    expect(second.x).toBeCloseTo(9.6 + parseFloat(ps[1]!.style.paddingLeft));
    // the bullet hangs: text-indent pulls the first line back to the outline indent
    expect(parseFloat(ps[1]!.style.textIndent)).toBeCloseTo(lay.paragraphs![1]!.indent - lay.paragraphs![1]!.textX);
    expect(ps[1]!.style.getPropertyValue("--bullet-width")).toBe(`${lay.paragraphs![1]!.textX - lay.paragraphs![1]!.indent}px`);
  });

  it("runs keep their own font, size, weight and colour; an empty paragraph keeps its height", () => {
    const el = root(sample());
    const spans = [...el.querySelectorAll<HTMLElement>("span")];
    expect(spans.map((s) => s.textContent)).toEqual(["Plain ", "bold", "Second", "One"]);
    expect(spans[1]!.style.fontWeight).toBe("700");
    expect(spans[0]!.style.fontWeight).toBe("400");
    expect(parseFloat(spans[2]!.style.fontSize)).toBeCloseTo(32);
    expect(spans[0]!.style.color).toBe("rgb(17, 34, 51)");
    const empty = el.querySelectorAll<HTMLElement>("[data-p]")[2]!;
    expect(empty.querySelector("br")).not.toBeNull();
    expect(parseFloat(empty.style.fontSize)).toBeCloseTo(37.33, 1);
    // blocks with text take their line height from their runs only (as the layout does)
    expect(el.querySelector<HTMLElement>("[data-p]")!.style.fontSize).toBe("0px");
  });

  it("line spacing, spacing before / after and the autofit scale come from the layout", () => {
    const body: TextBody = {
      props: { anchor: "top", wrap: true, insets, autofit: "shrink", fontScale: 50000, lineReduction: 20000 },
      paragraphs: [{ props: { lineSpacing: { kind: "percent", value: 150000 }, spacingBefore: { kind: "points", value: 1200 } }, runs: [{ text: "Hi" }] }],
    };
    const el = root(body);
    const p = el.querySelector<HTMLElement>("[data-p]")!;
    expect(Number(p.style.lineHeight)).toBeCloseTo(1.2 * 1.5 * 0.8);
    expect(parseFloat(p.style.paddingTop)).toBeCloseTo(16 * 0.5);
    expect(parseFloat(el.querySelector<HTMLElement>("span")!.style.fontSize)).toBeCloseTo(37.333 * 0.5, 1);
  });

  it("maps every text offset to a DOM position and back", () => {
    const el = root(sample());
    const text = readDomText(el);
    expect(text).toBe("Plain bold\nSecond\n\nOne");
    for (let at = 0; at <= text.length; at++) {
      const pos = offsetToDom(el, at);
      expect(domToOffset(el, pos.node, pos.offset)).toBe(at);
    }
    // positions between the blocks of the root
    expect(domToOffset(el, el, 1)).toBe(11);
    expect(domToOffset(el, el, 4)).toBe(text.length);
  });

  it("reads text the browser put outside the blocks (composition) as paragraphs", () => {
    const el = root(sample());
    el.appendChild(document.createTextNode("あ"));
    expect(readDomText(el)).toBe("Plain bold\nSecond\n\nOne\nあ");
  });
});

// ----- the editor in the app ------------------------------------------------------------

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

async function mount() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
  backend.log.length = 0;
  return { backend, store };
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const paras = () => [...screen.getByTestId("text-overlay").querySelectorAll<HTMLElement>("[data-p]")];
const commands = (b: FakeBackend) => b.log.flatMap((r) => ("command" in r ? [r.command] : [])) as { type: string; body?: TextBody; patch?: unknown }[];

describe("in-place editor in the app", () => {
  it("shows the body placeholder's bullets while editing; Enter adds a bulleted paragraph", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    expect(el.getAttribute("contenteditable")).toBe("true");
    expect(paras().map((p) => p.dataset.bullet)).toEqual(["•", "•"]);
    select(el, "First point\nSecond point".length);
    typeText(el, "\nThird");
    expect(paras().map((p) => [p.dataset.bullet, p.textContent])).toEqual([["•", "First point"], ["•", "Second point"], ["•", "Third"]]);
    expect(store.getState().editing).toMatchObject({ text: "First point\nSecond point\nThird", start: 30, end: 30 });
    fireEvent.keyDown(el, { key: "Escape" });
    await flush();
    const set = commands(backend).find((c) => c.type === "setTextBody")!;
    expect(set.body!.paragraphs.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["First point", "Second point", "Third"]);
  });

  it("Tab makes the caret's paragraph level 2 and the editor shows it indented", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 15);
    const before = parseFloat(paras()[1]!.style.paddingLeft);
    fireEvent.keyDown(el, { key: "Tab" });
    await flush();
    expect(commands(backend).find((c) => c.type === "setParagraphProps")).toMatchObject({ paragraphs: [1], patch: { level: 1 } });
    expect(paras()[1]!.dataset.level).toBe("1");
    expect(parseFloat(paras()[1]!.style.paddingLeft)).toBeGreaterThan(before + 40);
    fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    await flush();
    expect(paras()[1]!.dataset.level).toBe("0");
  });

  it("typed text keeps the formatting of the run before the caret (bold stays bold)", async () => {
    const { backend, store } = await mount();
    const title = store.getState().pres!.slides[1]!.shapes.find((s) => s.id === 5)!;
    if (title.kind.kind === "auto") title.kind.value.text!.paragraphs[0]!.runs = [{ text: "Slide", props: { bold: true } }, { text: " two" }];
    act(() => store.startEdit(5));
    const el = screen.getByTestId("text-overlay");
    expect(el.querySelector("span")!.style.fontWeight).toBe("700");
    select(el, 5);
    typeText(el, "s");
    const spans = [...el.querySelectorAll<HTMLElement>("span")].map((s) => [s.textContent, s.style.fontWeight]);
    expect(spans).toEqual([["Slides", "700"], [" two", "400"]]);
    fireEvent.blur(el);
    await flush();
    const set = commands(backend).filter((c) => c.type === "setTextBody").pop()!;
    expect(set.body!.paragraphs[0]!.runs).toEqual([{ text: "Slides", props: expect.objectContaining({ bold: true }) }, expect.objectContaining({ text: " two" })]);
  });

  it("Backspace and Delete remove characters; across a paragraph border they join paragraphs", async () => {
    const { store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 12); // start of "Second point"
    input(el, "deleteContentBackward");
    expect(store.getState().editing!.text).toBe("First pointSecond point");
    expect(paras()).toHaveLength(1);
    input(el, "deleteContentForward");
    expect(store.getState().editing!.text).toBe("First pointecond point");
  });

  it("paste inserts plain text (lines become paragraphs); Ctrl+Z and Ctrl+Y undo and redo the typing", async () => {
    const { store } = await mount();
    act(() => store.startEdit(5));
    const el = screen.getByTestId("text-overlay");
    select(el, 9);
    const data = { getData: (t: string) => (t === "text/plain" ? " <b>A</b>\r\nB" : "<b>A</b>") };
    fireEvent.paste(el, { clipboardData: data });
    expect(store.getState().editing!.text).toBe("Slide two <b>A</b>\nB");
    expect(paras()).toHaveLength(2);
    fireEvent.keyDown(el, { key: "z", ctrlKey: true });
    expect(store.getState().editing!.text).toBe("Slide two");
    fireEvent.keyDown(el, { key: "y", ctrlKey: true });
    expect(store.getState().editing!.text).toBe("Slide two <b>A</b>\nB");
  });

  it("the selection follows the DOM selection; formatting commands apply to it", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 6, 11);
    expect(store.getState().editing).toMatchObject({ start: 6, end: 11 });
    expect(readSelection(el)).toMatchObject({ start: 6, end: 11 });
    fireEvent.keyDown(el, { key: "i", ctrlKey: true });
    await flush();
    expect(commands(backend).find((c) => c.type === "setRunProps")).toMatchObject({ patch: { italic: true } });
    // the editor still has the selection after the command
    expect(readSelection(el)).toMatchObject({ start: 6, end: 11 });
  });

  it("the editor is drawn at slide size, scaled by the zoom and placed like the shape's text", async () => {
    const { store } = await mount();
    act(() => store.startEdit(6));
    const box = screen.getByTestId("text-overlay-box");
    expect(box.style.transform).toMatch(/^scale\(/);
    expect(parseFloat(box.style.width)).toBeCloseTo(4572000 / 9525, 0);
    const frame = screen.getByTestId("text-overlay-frame");
    expect(frame.style.padding).toBe("4.8px 9.6px");
    expect(frame.style.justifyContent).toBe("flex-start");
  });

  it("vertical text is edited in place, turned like the slide draws it", async () => {
    const { store } = await mount();
    const slide = store.getState().pres!.slides[1]!;
    const shape = slide.shapes.find((s) => s.id === 6)!;
    if (shape.kind.kind === "auto" && shape.kind.value.text) shape.kind.value.text.props.vert = "rotate270";
    act(() => store.startEdit(6));
    const frame = screen.getByTestId("text-overlay-frame");
    expect(frame.dataset.vert).toBe("rotate270");
    expect(frame.style.transform).toContain("rotate(-90deg)");
    // laid out in the swapped box
    expect(parseFloat(frame.style.width)).toBeCloseTo(914400 / 9525, 0);
    expect(parseFloat(frame.style.height)).toBeCloseTo(4572000 / 9525, 0);
  });

  it("an empty text box being typed into keeps the text box's metrics; replacing all text works", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    replaceAll(el, "Only");
    expect(paras().map((p) => p.textContent)).toEqual(["Only"]);
    fireEvent.blur(el);
    await flush();
    expect(commands(backend).find((c) => c.type === "setTextBody")!.body!.paragraphs).toHaveLength(1);
  });
});
