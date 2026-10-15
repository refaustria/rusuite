import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import type { ShowPatch } from "../generated/ShowPatch";
import { FakeBackend } from "../test/fakeBackend";
import { fixture, rect } from "../test/fixture";
import { applyPatch, ShowStore } from "./store";

const patch = (p: Partial<ShowPatch>): ShowPatch => ({
  slidesOrder: null, slides: [], deletedSlides: [], idMap: [], slideSize: null, info: null, ...p,
});
const env = (revision: number, p: Partial<ShowPatch>) => ({ revision, patch: patch(p), canUndo: true, canRedo: false, dirty: true });

async function ready(backend = new FakeBackend()) {
  const store = new ShowStore(new ShowApi(backend));
  await store.init();
  return { store, backend };
}

describe("applyPatch", () => {
  it("replaces slides by id, adds new ones, removes deleted ones and reorders", () => {
    const p = fixture();
    const changed = { ...p.slides[2]!, shapes: [rect(8, 0, 0)] };
    const added = { id: 50, layout: "blank" as const, shapes: [] };
    const out = applyPatch(p, patch({ slides: [changed, added], deletedSlides: [1], slidesOrder: [50, 7, 4] }));
    expect(out.slides.map((s) => s.id)).toEqual([50, 7, 4]);
    expect(out.slides[1]).toBe(changed);
    expect(out.slides[2]).toBe(p.slides[1]); // untouched slides keep their identity (thumbnail cache)
    expect(p.slides).toHaveLength(3); // pure
    expect(applyPatch(p, patch({ slideSize: { width: 9144000, height: 6858000 } })).slideSize.width).toBe(9144000);
  });
});

describe("ShowStore", () => {
  it("loads the presentation and shows the first slide", async () => {
    const { store, backend } = await ready();
    expect(store.getState().pres?.slides).toHaveLength(3);
    expect(store.getState().current).toBe(1);
    expect(backend.log.map((r) => r.type)).toEqual(["getPresentation", "documentState"]);
  });

  it("rewrites temporary ids in the selection by the id map", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    await store.insert("rect");
    const cmd = backend.commands[0]!;
    expect(cmd).toMatchObject({ type: "addShape", slide: 7, shape: { id: -1, kind: { kind: "auto", value: { geometry: "rect" } } } });
    expect(store.getState().selection).toEqual([100]);
    expect(store.currentSlide()!.shapes.map((s) => s.id)).toEqual([8, 9, 100]);
  });

  it("discards out-of-order revisions", async () => {
    const { store } = await ready();
    expect(store.applyEnvelope(env(5, { slides: [{ id: 7, layout: "blank", shapes: [] }] }))).not.toBeNull();
    expect(store.applyEnvelope(env(4, { slides: [{ id: 7, layout: "blank", shapes: [rect(8, 0, 0)] }] }))).toBeNull();
    expect(store.getState().pres!.slides[2]!.shapes).toEqual([]);
    expect(store.getState().revision).toBe(5);
  });

  it("keeps a valid current slide when slides are deleted, and follows a reorder", async () => {
    const { store } = await ready();
    store.selectSlide(4);
    store.applyEnvelope(env(1, { slidesOrder: [7, 1, 4] }));
    expect(store.getState().current).toBe(4);
    store.applyEnvelope(env(2, { slidesOrder: [7, 1], deletedSlides: [4] }));
    expect(store.getState().current).toBe(1);
  });

  it("adds a slide after the current one and makes it current", async () => {
    const { store, backend } = await ready();
    store.selectSlide(4);
    await store.addSlide("titleContent");
    expect(backend.commands[0]).toEqual({ type: "addSlide", after: 4, layout: "titleContent" });
    expect(store.getState().pres!.slides.map((s) => s.id)).toEqual([1, 4, 100, 7]);
    expect(store.getState().current).toBe(100);
  });

  it("moves slides with MoveSlide", async () => {
    const { store, backend } = await ready();
    await store.moveSlide(7, 0);
    await store.moveSlide(7, 0); // already there: no command
    expect(backend.commands).toEqual([{ type: "moveSlide", id: 7, toIndex: 0 }]);
    expect(store.getState().pres!.slides.map((s) => s.id)).toEqual([7, 1, 4]);
  });

  it("commits the overlay editor as SetTextBody and opens it on new text boxes", async () => {
    const { store, backend } = await ready();
    store.startEdit(2);
    expect(store.getState().editing).toMatchObject({ shape: 2, text: "Welcome to Rusuite Show" });
    store.updateEdit("Hello\nWorld", 11, 11);
    await store.commitEdit();
    expect(backend.commands[0]).toMatchObject({ type: "setTextBody", shape: 2, body: { paragraphs: [{ runs: [{ text: "Hello" }] }, { runs: [{ text: "World" }] }] } });
    expect(store.getState().editing).toBeNull();
    await store.insert("textBox");
    expect(store.getState().editing?.shape).toBe(100);
    await store.commitEdit(); // unchanged: no command
    expect(backend.commands).toHaveLength(2);
  });

  it("applies toolbar formatting to the editor selection in one undo step", async () => {
    const { store, backend } = await ready();
    store.selectSlide(4);
    store.startEdit(6);
    store.updateEdit("First point\nSecond point!", 6, 18);
    await store.applyRunPatch({ bold: true });
    const cmd = backend.commands[0]!;
    expect(cmd.type).toBe("compound");
    expect(cmd.type === "compound" && cmd.commands.map((c) => c.type)).toEqual(["setTextBody", "setRunProps", "setRunProps"]);
    expect(cmd.type === "compound" && cmd.commands[2]).toMatchObject({ paragraph: 1, from: 0, to: 6 });
    expect(store.getState().editing).not.toBeNull();
  });

  it("formats the whole text of selected shapes and toggles bullets", async () => {
    const { store, backend } = await ready();
    store.selectSlide(4);
    store.select([5, 6]);
    await store.applyRunPatch({ italic: true });
    expect(backend.commands[0]).toMatchObject({ type: "compound", commands: [{ shape: 5, paragraph: 0 }, { shape: 6, paragraph: 0 }, { shape: 6, paragraph: 1 }] });
    store.select([6]);
    await store.toggleBullet("bullet"); // body placeholder already has "•" bullets → off
    expect(backend.commands[1]).toEqual({ type: "setParagraphProps", shape: 6, paragraphs: [0, 1], patch: { bullet: { kind: "none" } } });
    await store.setAlignment("center");
    expect(backend.commands[2]).toEqual({ type: "setParagraphProps", shape: 6, paragraphs: [0, 1], patch: { alignment: "center" } });
  });

  it("turns backend errors into toasts", async () => {
    const { store, backend } = await ready();
    backend.failWith = "unknown_shape";
    store.selectSlide(7);
    store.select([8]);
    await store.deleteSelection();
    expect(store.getState().toasts.map((t) => t.message)).toEqual(["fake unknown_shape (unknown_shape)"]);
  });

  it("fetches media of new pictures", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    await store.insertPicture("image/png", "iVBORw0KGgo=");
    await new Promise((r) => setTimeout(r, 0));
    expect(backend.log.some((r) => r.type === "getMedia" && r.id === 1)).toBe(true);
    expect(store.media.get(1)).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(store.getState().selection).toEqual([100]);
  });

  it("disables file IO until the core answers savePptx", async () => {
    const { store } = await ready();
    expect(await store.probeFileIo()).toBe(false);
    expect(store.getState().fileIo).toBe(false);
  });
});
