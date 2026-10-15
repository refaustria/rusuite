// P6-5: clipboard, slide operations, notes, alt text, format dialog, text polish.
import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { rect, textShape } from "../test/fixture";
import {
  DUPLICATE_OFFSET_EMU, FONT_SIZES, formatCommands, formatValuesOf, lineSpacingCommand, lineSpacingOf, pasteOffset,
  slideDropIndex, stepFontSize,
} from "./commands";
import { shortcutFor } from "./shortcuts";
import { ShowStore } from "./store";

const last = <T,>(a: T[]): T => a[a.length - 1]!;

async function ready() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  await store.init();
  return { store, backend };
}

describe("pure helpers", () => {
  it("paste offset: one step further per paste on the same slide, in place elsewhere", () => {
    expect(pasteOffset(true, 1)).toBe(DUPLICATE_OFFSET_EMU);
    expect(pasteOffset(true, 3)).toBe(3 * DUPLICATE_OFFSET_EMU);
    expect(pasteOffset(false, 5)).toBe(0);
  });

  it("slide drop index from the insertion gap", () => {
    expect(slideDropIndex(0, 2, true)).toBe(2); // first slide dropped below the third
    expect(slideDropIndex(0, 2, false)).toBe(1); // … above the third
    expect(slideDropIndex(3, 0, false)).toBe(0);
    expect(slideDropIndex(3, 0, true)).toBe(1);
    expect(slideDropIndex(1, 1, false)).toBeNull(); // onto itself
    expect(slideDropIndex(1, 0, true)).toBeNull(); // the gap right above it
    expect(slideDropIndex(1, 2, false)).toBeNull(); // the gap right below it
  });

  it("font size steps follow PowerPoint's list", () => {
    expect(stepFontSize(1800, 1)).toBe(2000);
    expect(stepFontSize(1800, -1)).toBe(1600);
    expect(stepFontSize(1100, -1)).toBe(1050);
    expect(stepFontSize(1300, 1)).toBe(1400); // between steps
    expect(stepFontSize(1300, -1)).toBe(1200);
    expect(stepFontSize(9600, 1)).toBe(10000); // past the list: by tens
    expect(stepFontSize(800, -1)).toBe(700);
    expect(FONT_SIZES[0]).toBe(8);
  });

  it("line spacing commands and values", () => {
    expect(lineSpacingCommand(5, [0, 1], 1.5)).toEqual({
      type: "setParagraphProps", shape: 5, paragraphs: [0, 1], patch: { lineSpacing: { kind: "percent", value: 150000 } },
    });
    expect(lineSpacingOf({ kind: "percent", value: 115000 })).toBe(1.15);
    expect(lineSpacingOf({ kind: "points", value: 1200 })).toBeNull();
    expect(lineSpacingOf(undefined)).toBeNull();
  });

  it("format values of a shape (cm, pt)", () => {
    const v = formatValuesOf(rect(8, 360000, 720000));
    expect(v).toMatchObject({ x: 1, y: 2, w: 5.08, h: 3.81, rotation: 0, lineWidthPt: 1, dash: "solid", line: null, anchor: "top" });
    expect(v.fill).toEqual({ kind: "rgb", value: "4472C4" });
    expect(v.insets).toEqual({ left: 0.25, top: 0.13, right: 0.25, bottom: 0.13 });
  });

  it("format commands: only what changed", () => {
    const s = rect(8, 0, 0);
    const before = formatValuesOf(s);
    expect(formatCommands([s], before, before)).toEqual([]);
    const cmds = formatCommands([s], before, { ...before, fill: null, line: { kind: "rgb", value: "FF0000" }, lineWidthPt: 2, dash: "dash" });
    expect(cmds).toEqual([
      { type: "setShapeStyle", shapes: [8], fill: null, line: { fill: { kind: "solid", value: { kind: "rgb", value: "FF0000" } }, width: 25400, dash: "dash" } },
    ]);
  });

  it("format commands: size, position and rotation of one shape", () => {
    const s = rect(8, 0, 0);
    const before = formatValuesOf(s);
    const [cmd] = formatCommands([s], before, { ...before, x: 2, w: 10, rotation: 370 });
    expect(cmd).toEqual({ type: "setTransform", shapes: [[8, { ...s.transform, x: 720000, w: 3600000, rotationDeg: 10 }]] });
    // two shapes: no transform
    expect(formatCommands([s, rect(9, 0, 0)], before, { ...before, x: 2 })).toEqual([]);
  });

  it("format commands: text anchor and margins replace the body properties", () => {
    const s = textShape(2, ["Hi"]);
    const before = formatValuesOf(s);
    const [cmd] = formatCommands([s], before, { ...before, anchor: "bottom", insets: { ...before.insets, left: 1 } });
    expect(cmd!.type).toBe("setTextBody");
    if (cmd!.type !== "setTextBody") return;
    expect(cmd.body.props).toEqual({ anchor: "bottom", wrap: true, insets: { left: 360000, top: 46800, right: 90000, bottom: 46800 }, autofit: "none" });
    expect(cmd.body.paragraphs).toEqual(s.kind.kind === "auto" ? s.kind.value.text!.paragraphs : []);
  });

  it("Ctrl+C / X / V map to the clipboard actions", () => {
    expect(shortcutFor({ key: "c", ctrlKey: true })).toEqual({ kind: "copy" });
    expect(shortcutFor({ key: "x", metaKey: true })).toEqual({ kind: "cut" });
    expect(shortcutFor({ key: "v", ctrlKey: true })).toEqual({ kind: "paste" });
    expect(shortcutFor({ key: "V", ctrlKey: true, shiftKey: true })).toBeNull();
  });
});

describe("store: clipboard", () => {
  it("pastes copies with new ids, one offset further per paste on the same slide", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    store.select([8]);
    expect(store.copy()).toBe(true);
    expect(store.getState().clipboard).toBe("shapes");
    await store.paste();
    await store.paste();
    const adds = backend.commands.filter((c) => c.type === "addShape");
    expect(adds).toHaveLength(2);
    const xs = adds.map((c) => (c.type === "addShape" ? c.shape.transform.x : 0));
    expect(xs).toEqual([914400 + DUPLICATE_OFFSET_EMU, 914400 + 2 * DUPLICATE_OFFSET_EMU]);
    expect(adds.every((c) => c.type === "addShape" && c.shape.id < 0 && c.shape.name === "")).toBe(true);
    // the pasted shape is selected (temp id mapped to the real one)
    expect(store.getState().selection).toHaveLength(1);
    expect(store.getState().selection[0]).toBeGreaterThanOrEqual(100);
  });

  it("pastes onto another slide in place; cut deletes", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    store.select([9]);
    await store.cut();
    expect(last(backend.commands)).toEqual({ type: "deleteShapes", ids: [9] });
    store.selectSlide(4);
    await store.paste();
    const add = last(backend.commands)!;
    expect(add).toMatchObject({ type: "addShape", slide: 4, shape: { transform: { x: 6096000, y: 2743200 } } });
  });

  it("copy does nothing while editing text (the textarea keeps the native clipboard)", async () => {
    const { store } = await ready();
    store.startEdit(2);
    expect(store.copy()).toBe(false);
    expect(store.shortcut({ kind: "paste" })).toBe(false);
  });

  it("slides: copy and paste after the current slide", async () => {
    const { store, backend } = await ready();
    store.copySlides([1]);
    store.selectSlide(7);
    await store.paste();
    expect(backend.commands.map((c) => c.type)).toEqual(["duplicateSlide", "moveSlide"]);
    expect(backend.commands[1]).toMatchObject({ type: "moveSlide", toIndex: 3 });
    const ids = store.getState().pres!.slides.map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual([1, 4, 7]);
    expect(store.getState().current).toBe(ids[3]);
  });

  it("slides: pasting right after the copied slide needs no move", async () => {
    const { store, backend } = await ready();
    store.copySlides([4]);
    store.selectSlide(4);
    await store.paste();
    expect(backend.commands.map((c) => c.type)).toEqual(["duplicateSlide"]);
  });
});

describe("store: slides, notes, alt text, text polish", () => {
  it("layout change, hide/show, background for one or all slides", async () => {
    const { store, backend } = await ready();
    await store.setSlideLayout("blank");
    expect(last(backend.commands)).toEqual({ type: "setSlideLayout", slide: 1, layout: "blank" });
    await store.toggleHidden([4, 7]);
    expect(last(backend.commands)).toEqual({ type: "setSlidesHidden", slides: [4, 7], hidden: true });
    await store.toggleHidden([4]);
    expect(last(backend.commands)).toEqual({ type: "setSlidesHidden", slides: [4], hidden: false });
    await store.setBackground({ kind: "rgb", value: "FFEEDD" }, true);
    const bg = last(backend.commands)!;
    expect(bg.type === "compound" && bg.commands.map((c) => c.type === "setSlideBackground" && c.slide)).toEqual([1, 4, 7]);
    await store.setBackground(null);
    expect(last(backend.commands)).toEqual({ type: "setSlideBackground", slide: 1, fill: null });
  });

  it("notes: sends SetNotes only when changed; empty clears", async () => {
    const { store, backend } = await ready();
    await store.setNotes(1, "");
    expect(backend.commands).toHaveLength(0);
    await store.setNotes(1, "Hello");
    expect(last(backend.commands)).toEqual({ type: "setNotes", slide: 1, notes: "Hello" });
    expect(store.getState().pres!.slides[0]!.notes).toBe("Hello");
    await store.setNotes(1, "");
    expect(last(backend.commands)).toEqual({ type: "setNotes", slide: 1, notes: null });
  });

  it("alt text and the picture commands", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    await store.setAltText(8, "Blue box");
    expect(last(backend.commands)).toEqual({ type: "setAltText", shape: 8, alt: "Blue box" });
    await store.setAltText(8, "Blue box");
    expect(backend.commands).toHaveLength(1);
    store.select([8]);
    await store.resetPictureSize(); // not a picture: nothing
    expect(backend.commands).toHaveLength(1);
    await store.replacePicture(8, "image/png", "AAAA");
    expect(last(backend.commands)).toEqual({ type: "replacePicture", shape: 8, contentType: "image/png", bytesBase64: "AAAA" });
  });

  it("format dialog: one compound command for the selection", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    store.select([8, 9]);
    const before = formatValuesOf(store.selectedShapes()[0]!);
    await store.applyFormat(before, { ...before, fill: null });
    expect(last(backend.commands)).toEqual({ type: "setShapeStyle", shapes: [8, 9], fill: null });
  });

  it("grow font and line spacing apply to the selected text shapes", async () => {
    const { store, backend } = await ready();
    store.selectSlide(4);
    store.select([6]);
    await store.stepFont(1, 2800);
    expect(last(backend.commands)).toMatchObject({ type: "compound" });
    const c = last(backend.commands)!;
    expect(c.type === "compound" && c.commands.every((x) => x.type === "setRunProps" && x.patch.size === 3200)).toBe(true);
    await store.setLineSpacing(2);
    expect(last(backend.commands)).toEqual({ type: "setParagraphProps", shape: 6, paragraphs: [0, 1], patch: { lineSpacing: { kind: "percent", value: 200000 } } });
  });

  it("Tab in the editor indents the caret's paragraph", async () => {
    const { store, backend } = await ready();
    store.selectSlide(4);
    store.startEdit(6);
    const text = store.getState().editing!.text;
    store.updateEdit(text, text.length, text.length);
    await store.indent(1);
    expect(last(backend.commands)).toEqual({ type: "setParagraphProps", shape: 6, paragraphs: [1], patch: { level: 1 } });
  });

  it("dialogs open and close through the store", async () => {
    const { store } = await ready();
    store.openDialog({ kind: "alt", shape: 2 });
    expect(store.getState().dialog).toEqual({ kind: "alt", shape: 2 });
    store.closeDialog();
    expect(store.getState().dialog).toBeNull();
    store.toggleNotes();
    expect(store.getState().notesVisible).toBe(true);
  });

  it("double-click on a group's child edits the child (the group stays selected)", async () => {
    const pres = (await import("../test/fixture")).fixture();
    const child = textShape(31, ["inside"]);
    pres.slides[2]!.shapes.push({
      id: 30, name: "Group 30", transform: { x: 0, y: 0, w: 4572000, h: 914400 }, kind: { kind: "group", value: { children: [child] } },
      fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
    });
    const backend = new FakeBackend(pres);
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    store.selectSlide(7);
    store.startEdit(31);
    expect(store.getState().editing).toMatchObject({ shape: 31, text: "inside" });
    expect(store.getState().selection).toEqual([30]);
    store.updateEdit("inside!", 7, 7);
    await store.commitEdit();
    expect(last(backend.commands)).toMatchObject({ type: "setTextBody", shape: 31 });
  });
});
