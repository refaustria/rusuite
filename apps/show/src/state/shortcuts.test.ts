import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { shortcutFor } from "./shortcuts";
import { ShowStore } from "./store";

describe("shortcuts", () => {
  it("maps keys to actions", () => {
    expect(shortcutFor({ key: "Delete" })).toEqual({ kind: "delete" });
    expect(shortcutFor({ key: "ArrowLeft" })).toEqual({ kind: "nudge", dx: -1, dy: 0 });
    expect(shortcutFor({ key: "ArrowDown", shiftKey: true })).toEqual({ kind: "nudge", dx: 0, dy: 10 });
    expect(shortcutFor({ key: "d", ctrlKey: true })).toEqual({ kind: "duplicate" });
    expect(shortcutFor({ key: "G", ctrlKey: true, shiftKey: true })).toEqual({ kind: "ungroup" });
    expect(shortcutFor({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true })).toEqual({ kind: "zOrder", op: "bringToFront" });
    expect(shortcutFor({ key: "[", code: "BracketLeft", metaKey: true })).toEqual({ kind: "zOrder", op: "sendBackward" });
    expect(shortcutFor({ key: "z", ctrlKey: true, shiftKey: true })).toEqual({ kind: "redo" });
    expect(shortcutFor({ key: "x" })).toBeNull();
    expect(shortcutFor({ key: "d", ctrlKey: true, altKey: true })).toBeNull();
  });

  it("turns shortcuts into commands", async () => {
    const backend = new FakeBackend();
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    store.selectSlide(7);
    store.select([8, 9]);
    const press = async (k: Parameters<typeof shortcutFor>[0]) => {
      store.shortcut(shortcutFor(k)!);
      await new Promise((r) => setTimeout(r, 0));
    };
    await press({ key: "ArrowRight", shiftKey: true });
    await press({ key: "g", ctrlKey: true });
    await press({ key: "]", code: "BracketRight", ctrlKey: true });
    const [nudge, group, z] = backend.commands;
    expect(nudge).toMatchObject({ type: "setTransform", shapes: [[8, { x: 914400 + 95250 }], [9, { x: 6096000 + 95250 }]] });
    expect(group).toEqual({ type: "group", shapes: [8, 9], newId: -1 });
    // The fake core does not group, so the temp id stays unmapped and the selection empties.
    expect(z).toBeUndefined();
    store.select([8]);
    await press({ key: "d", ctrlKey: true });
    await press({ key: "Delete" });
    expect(backend.commands.slice(2).map((c) => c.type)).toEqual(["addShape", "deleteShapes"]);
    expect(backend.commands[3]).toEqual({ type: "deleteShapes", ids: [100] });
  });
});
