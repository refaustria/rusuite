// P9-S1: rich in-place text editing – line breaks (Shift+Enter, `a:br`),
// Ctrl+A, size steps, editor ↔ model round trips.
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
import { input, select, typeText } from "../test/editor";
import { cleanBody, editorText, LINE_BREAK, plainOf, spliceBody } from "../text/editing";
import { approxMeasure, layoutText, type LayoutOptions, type RunStyle } from "../text/layout";
import { buildParagraphs, domToOffset, offsetToDom, readDomText } from "./richEditor";
import { caretSize } from "./TextOverlay";

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
const body = (paragraphs: TextBody["paragraphs"]): TextBody => ({ props: { anchor: "top", wrap: true, insets, autofit: "none" }, paragraphs });
const dot = { kind: "char", value: "•" } as const;

function dom(b: TextBody, o = opts()) {
  const el = document.createElement("div");
  el.append(...buildParagraphs(document, b, layoutText(b, o), o));
  document.body.appendChild(el);
  return el;
}

describe("line breaks (a:br)", () => {
  it("the layout breaks the line at `\\n` and U+000B inside a run, keeping one paragraph", () => {
    for (const br of ["\n", LINE_BREAK]) {
      const lay = layoutText(body([{ runs: [{ text: `one${br}two` }] }]), opts());
      const one = lay.fragments.find((f) => f.text === "one")!;
      const two = lay.fragments.find((f) => f.text === "two")!;
      expect(two.y).toBeGreaterThan(one.y + 30);
      expect(two.x).toBeCloseTo(one.x);
      expect(lay.paragraphs).toHaveLength(1);
    }
  });

  it("an empty line after a trailing break still takes a line of height", () => {
    const one = layoutText(body([{ runs: [{ text: "x" }] }]), opts()).height;
    const two = layoutText(body([{ runs: [{ text: "x\n" }] }]), opts()).height;
    expect(two - one).toBeCloseTo(37.333 * 1.2, 1);
  });

  it("the editor's text shows breaks as U+000B, plain text (clipboard) as `\\n`", () => {
    const b = body([{ runs: [{ text: "a\nb" }] }, { runs: [{ text: "c" }] }]);
    expect(editorText(b)).toBe(`a${LINE_BREAK}b\nc`);
    expect(plainOf(editorText(b))).toBe("a\nb\nc");
  });

  it("Shift+Enter splices a break into the run; the committed body stores it as `\\n`", () => {
    const b = body([{ props: { bullet: dot }, runs: [{ text: "Hello world", props: { bold: true } }] }]);
    const s = spliceBody(b, 5, 5, LINE_BREAK);
    expect(s.paragraphs).toHaveLength(1);
    expect(s.paragraphs[0]!.runs).toEqual([{ text: `Hello${LINE_BREAK} world`, props: { bold: true } }]);
    expect(cleanBody(s).paragraphs[0]!.runs[0]!.text).toBe("Hello\n world");
  });

  it("the editor DOM shows a break as a newline of the run, a trailing break with a <br>; offsets round-trip", () => {
    const el = dom(body([{ runs: [{ text: `ab${LINE_BREAK}` }, { text: "c\nd", props: { bold: true } }] }, { runs: [{ text: `x${LINE_BREAK}` }] }]));
    const spans = [...el.querySelectorAll("span")].map((s) => s.textContent);
    expect(spans).toEqual(["ab\n", "c\nd", "x\n"]);
    expect(el.querySelectorAll("[data-p]")[1]!.querySelector("br")).not.toBeNull();
    const text = readDomText(el);
    expect(text).toBe(`ab${LINE_BREAK}c${LINE_BREAK}d\nx${LINE_BREAK}`);
    for (let at = 0; at <= text.length; at++) {
      const pos = offsetToDom(el, at);
      expect(domToOffset(el, pos.node, pos.offset)).toBe(at);
    }
  });
});

describe("editor ↔ model round trip", () => {
  it("edit → committed model → render equals the editor's view (runs and paragraphs 1:1)", () => {
    const start = body([
      { props: { bullet: dot }, runs: [{ text: "Plain " }, { text: "bold", props: { bold: true } }, { text: " tail" }] },
      { props: { bullet: dot, level: 2 }, runs: [{ text: "Deep", props: { size: 1800 } }] },
    ]);
    let s = spliceBody(start, 10, 10, " more");
    s = spliceBody(s, 3, 3, LINE_BREAK);
    s = spliceBody(s, editorText(s).length, editorText(s).length, "\nnew");
    const committed = cleanBody(s);
    // the model keeps the runs and the paragraph properties (no flattening)
    expect(committed.paragraphs.map((p) => p.runs.map((r) => [r.text, !!r.props?.bold]))).toEqual([
      [["Pla\nin ", false], ["bold more", true], [" tail", false]],
      [["Deep", false]],
      [["new", false]],
    ]);
    expect(committed.paragraphs.map((p) => p.props?.level ?? 0)).toEqual([0, 2, 2]);
    expect(committed.paragraphs[2]!.runs[0]!.props).toEqual({ size: 1800 });
    // the slide's rendering of the model is what the editor showed
    expect(dom(committed).innerHTML).toBe(dom(s).innerHTML);
    expect(editorText(committed)).toBe(editorText(s));
  });

  it("the size Grow / Shrink Font steps from is the caret run's, at its level", () => {
    const b = body([{ runs: [{ text: "ab" }, { text: "cd", props: { size: 4000 } }] }, { props: { level: 1 }, runs: [{ text: "x" }] }]);
    const f = { body: b, options: opts() };
    expect(caretSize(f, 1)).toBe(2800);
    expect(caretSize(f, 3)).toBe(4000);
    expect(caretSize(f, 6)).toBe(2400);
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
const commands = (b: FakeBackend) => b.log.flatMap((r) => ("command" in r ? [r.command] : [])) as { type: string; body?: TextBody; patch?: { size?: number }; shapes?: unknown }[];

describe("rich in-place editor in the app", () => {
  it("Shift+Enter (insertLineBreak) breaks the line inside the paragraph; Enter starts a new one", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 5);
    input(el, "insertLineBreak");
    expect(store.getState().editing!.text).toBe(`First${LINE_BREAK} point\nSecond point`);
    expect(paras()).toHaveLength(2);
    typeText(el, "\nx");
    expect(paras()).toHaveLength(3);
    fireEvent.keyDown(el, { key: "Escape" });
    await flush();
    const set = commands(backend).find((c) => c.type === "setTextBody")!;
    expect(set.body!.paragraphs.map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["First\n", "x point", "Second point"]);
  });

  it("an imported a:br is edited as one character and kept on commit", async () => {
    const { backend, store } = await mount();
    const sh = store.getState().pres!.slides[1]!.shapes.find((s) => s.id === 5)!;
    if (sh.kind.kind === "auto") sh.kind.value.text!.paragraphs[0]!.runs = [{ text: "Slide\ntwo", props: { bold: true } }];
    act(() => store.startEdit(5));
    const el = screen.getByTestId("text-overlay");
    expect(store.getState().editing!.text).toBe(`Slide${LINE_BREAK}two`);
    select(el, 9);
    typeText(el, "!");
    fireEvent.blur(el);
    await flush();
    const set = commands(backend).find((c) => c.type === "setTextBody")!;
    expect(set.body!.paragraphs[0]!.runs).toEqual([{ text: "Slide\ntwo!", props: { bold: true } }]);
  });

  it("Ctrl+A selects the shape's text, not the slide's shapes", async () => {
    const { store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 3);
    fireEvent.keyDown(el, { key: "a", ctrlKey: true });
    expect(store.getState().editing).toMatchObject({ start: 0, end: "First point\nSecond point".length });
    expect(store.getState().selection).toHaveLength(1);
  });

  it("Ctrl+] / Ctrl+[ and Ctrl+Shift+> step the selection's font size", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 0, 5);
    fireEvent.keyDown(el, { key: "]", code: "BracketRight", ctrlKey: true });
    await flush();
    const grow = commands(backend).filter((c) => c.type === "setRunProps");
    expect(grow[0]).toMatchObject({ from: 0, to: 5 });
    const up = grow[0]!.patch!.size!;
    fireEvent.keyDown(el, { key: "[", code: "BracketLeft", ctrlKey: true });
    await flush();
    const down = commands(backend).filter((c) => c.type === "setRunProps").pop()!.patch!.size!;
    expect(down).toBeLessThan(up);
    fireEvent.keyDown(el, { key: ">", code: "Period", ctrlKey: true, shiftKey: true });
    await flush();
    expect(commands(backend).filter((c) => c.type === "setRunProps").pop()!.patch!.size!).toBeGreaterThan(down);
    // z-order is not touched while editing
    expect(commands(backend).some((c) => c.type === "zOrder")).toBe(false);
  });

  it("copy writes line breaks as newlines", async () => {
    const { store } = await mount();
    act(() => store.startEdit(6));
    const el = screen.getByTestId("text-overlay");
    select(el, 5);
    input(el, "insertLineBreak");
    select(el, 0, 8);
    let copied = "";
    fireEvent.copy(el, { clipboardData: { setData: (_: string, v: string) => (copied = v) } });
    expect(copied).toBe("First\n p");
  });
});

// ----- P9-S1 item 2 / 4: autofit text boxes, prompts, white text on filled shapes ----------

import { choiceOf, choiceShape, TEXT_BOX_CLICK_W, TEXT_BOX_LINE_H } from "../shapes/presets";
import { fitSize } from "../text/autofit";
import { fixture } from "../test/fixture";
import { shapeTextOptions } from "./SlideView";
import { stableDeck } from "../design/deck";
import { themePalette } from "../model";

describe("text boxes resize to fit their text", () => {
  it("a click inserts a one-line box that does not wrap, a drag one that wraps; both spAutoFit", () => {
    const tb = choiceOf("textBox")!;
    const click = choiceShape(tb, { x: 0, y: 0, w: TEXT_BOX_CLICK_W, h: TEXT_BOX_LINE_H }, -1, true);
    const drag = choiceShape(tb, { x: 0, y: 0, w: 3000000, h: TEXT_BOX_LINE_H }, -2);
    const props = (s: typeof click) => (s.kind.kind === "auto" ? s.kind.value.text!.props : null);
    expect(props(click)).toMatchObject({ autofit: "resize", wrap: false });
    expect(props(drag)).toMatchObject({ autofit: "resize", wrap: true });
    expect(TEXT_BOX_CLICK_W).toBe(900000); // 2.5 cm
  });

  it("fitSize: a wrapping box grows in height only, a non-wrapping one also in width", () => {
    const pres = fixture();
    const slide = pres.slides[2]!;
    const tb = choiceOf("textBox")!;
    const box = (click: boolean, text: string[]) => {
      const s = choiceShape(tb, { x: 0, y: 0, w: TEXT_BOX_CLICK_W, h: TEXT_BOX_LINE_H }, 50, click);
      if (s.kind.kind === "auto") s.kind.value.text!.paragraphs = text.map((t) => ({ runs: [{ text: t }] }));
      return { s, body: s.kind.kind === "auto" ? s.kind.value.text! : null };
    };
    const short = box(true, ["Hi"]);
    expect(fitSize(pres, slide, short.s, short.body!)!.w).toBe(TEXT_BOX_CLICK_W);
    const long = box(true, ["A rather long line of text that is wider than 2.5 cm"]);
    const fl = fitSize(pres, slide, long.s, long.body!)!;
    expect(fl.w).toBeGreaterThan(TEXT_BOX_CLICK_W * 2);
    const two = box(true, ["One", "Two"]);
    expect(fitSize(pres, slide, two.s, two.body!)!.h).toBeGreaterThan(fitSize(pres, slide, short.s, short.body!)!.h * 1.5);
    const wrapped = box(false, ["A rather long line of text that is wider than 2.5 cm"]);
    const fw = fitSize(pres, slide, wrapped.s, wrapped.body!)!;
    expect(fw.w).toBe(TEXT_BOX_CLICK_W);
    expect(fw.h).toBeGreaterThan(TEXT_BOX_LINE_H * 2);
  });

  it("filled preset shapes draw their text in the style's text colour (white)", () => {
    const pres = fixture();
    const slide = pres.slides[2]!;
    const s = choiceShape(choiceOf("rect")!, { x: 0, y: 0, w: 914400, h: 914400 }, 51);
    expect(s.textColor).toEqual({ kind: "theme", value: { slot: "light1", tint: 0 } });
    const deck = stableDeck(pres);
    const o = shapeTextOptions({ deck, slide, palette: themePalette(pres.theme), asMaster: false, slideNumber: 3 }, s, 96, 96);
    expect(o.runStyle(undefined).color.toUpperCase()).toBe("#FFFFFF");
    expect(o.runStyle({ color: { kind: "rgb", value: "FF0000" } }).color.toUpperCase()).toBe("#FF0000");
  });
});

describe("text boxes and prompts in the app", () => {
  it("a new text box (click) grows while typing; the commit stores the fitted box", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[2]!);
    await act(() => store.insertChoice("textBox", { x: 914400, y: 914400, w: TEXT_BOX_CLICK_W, h: TEXT_BOX_LINE_H, rotationDeg: 0 }));
    await flush();
    const el = screen.getByTestId("text-overlay");
    const box = screen.getByTestId("text-overlay-box");
    const w0 = parseFloat(box.style.width);
    const h0 = parseFloat(box.style.height);
    typeText(el, "A text that is a lot wider than the box");
    expect(parseFloat(screen.getByTestId("text-overlay-box").style.width)).toBeGreaterThan(w0 * 2);
    typeText(el, "\nsecond line");
    expect(parseFloat(screen.getByTestId("text-overlay-box").style.height)).toBeGreaterThan(h0 * 1.5);
    fireEvent.keyDown(el, { key: "Escape" });
    await flush();
    const flat = commands(backend).flatMap((c) => (c.type === "compound" ? (c as unknown as { commands: typeof c[] }).commands : [c]));
    const tr = flat.filter((c) => c.type === "setTransform").pop() as unknown as { shapes: [number, { w: number; h: number }][] };
    expect(tr.shapes[0]![1].w).toBeGreaterThan(TEXT_BOX_CLICK_W * 2);
    expect(tr.shapes[0]![1].h).toBeGreaterThan(TEXT_BOX_LINE_H * 1.5);
  });

  it("a dragged text box keeps the dragged width and starts one line high", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[2]!);
    await act(() => store.insertChoice("textBox", { x: 0, y: 0, w: 3600000, h: 2000000, rotationDeg: 0 }, true));
    const add = commands(backend).find((c) => c.type === "addShape") as unknown as { shape: { transform: { w: number; h: number }; kind: { value: { text: TextBody } } } };
    expect(add.shape.transform).toMatchObject({ w: 3600000, h: TEXT_BOX_LINE_H });
    expect(add.shape.kind.value.text.props).toMatchObject({ autofit: "resize", wrap: true });
    expect(store.getState().editing).not.toBeNull();
  });

  it("an empty placeholder shows its prompt in its formatting while editing, until the first keystroke", async () => {
    const { store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[0]!);
    act(() => store.startEdit(3));
    const prompt = screen.getByTestId("text-overlay-prompt");
    expect(prompt.textContent).toBe("Click to add subtitle");
    const span = prompt.querySelector<HTMLElement>("span")!;
    // the subtitle's layout formatting: 24 pt (32 px), centred
    expect(parseFloat(span.style.fontSize)).toBeCloseTo(32, 0);
    expect(prompt.querySelector<HTMLElement>("[data-p]")!.style.textAlign).toBe("center");
    expect(prompt.getAttribute("aria-hidden")).toBe("true");
    typeText(screen.getByTestId("text-overlay"), "x");
    expect(screen.queryByTestId("text-overlay-prompt")).toBeNull();
  });
});
