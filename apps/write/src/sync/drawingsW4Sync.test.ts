// P9-W4: groups and linked text boxes through the sync layer — Group (one
// transaction: the members' paragraphs replaced), typing in a grouped text
// box (SetDrawingProps carries the members), Create Link (two
// SetDrawingProps), all converging with the core.

import { afterEach, describe, expect, it } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { WriteApi } from "../backend";
import type { Anchor } from "../generated/Anchor";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Drawing } from "../generated/Drawing";
import { backendsUnderTest, type TestBackend } from "../test/backends";
import { makeDoc, para } from "../test/fixtures";
import { linkAt } from "../features/drawings/chainCommands";
import { objectsKey, objectsPlugin, groupSelected } from "../features/drawings/objects";
import { fromPM } from "./fromPM";
import { canonBlock, canonDrawing, stableStringify } from "./model";
import { writeExtensions } from "./schema";
import { SyncController, SyncExtension } from "./SyncPlugin";

const BACKENDS = await backendsUnderTest();

let current: { editor: Editor } | null = null;
afterEach(() => {
  current?.editor.destroy();
  current = null;
});

const anchor = (x: number): Anchor => ({
  h: { relativeTo: "column", place: { kind: "offset", value: x } },
  v: { relativeTo: "paragraph", place: { kind: "offset", value: 0 } },
  wrap: "inFront",
  distance: { top: 0, bottom: 0, left: 0, right: 0 },
  allowOverlap: true,
});

const box = (id: number, pid: number, text: string, x: number): Drawing => ({
  id,
  kind: "textBox",
  width: 952500,
  height: 476250,
  preset: "rect",
  anchor: anchor(x),
  text: { blocks: [para(pid, text)] },
});

async function setup(backend: TestBackend, doc: Document) {
  const ctl = new SyncController(new WriteApi(backend));
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...writeExtensions(), SyncExtension(ctl), Extension.create({ name: "objectsTest", addProseMirrorPlugins: () => [objectsPlugin()] })],
  });
  current = { editor };
  await ctl.load(doc);
  return { backend, ctl, editor };
}

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));

async function expectConverged(s: { backend: TestBackend; ctl: SyncController; editor: Editor }) {
  await s.ctl.idle();
  const reply = (await s.backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  expect(canon(fromPM(s.editor.state.doc))).toBe(canon(reply.ok.doc.body));
  return reply.ok.doc;
}

function drawings(editor: Editor): [number, Drawing][] {
  const out: [number, Drawing][] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "drawing") out.push([pos, n.attrs.value as Drawing]);
    return n.type.name !== "drawing";
  });
  return out;
}

describe.each(BACKENDS)("P9-W4 groups and chains against the $name backend", ({ make }) => {
  it("Group, then typing in a grouped text box, converge", async () => {
    const s = await setup(
      make(),
      makeDoc([para(1, [{ kind: "run", value: { text: "Body " } }, { kind: "drawing", value: box(10, 11, "one", 0) }, { kind: "drawing", value: box(12, 13, "two", 952500) }]), para(2, "after")]),
    );
    const [[a], [b]] = drawings(s.editor) as [[number, Drawing], [number, Drawing]];
    s.editor.view.dispatch(s.editor.state.tr.setSelection(NodeSelection.create(s.editor.state.doc, a)).setMeta(objectsKey, { extra: [b] }));
    expect(groupSelected(s.editor.view)).toBe(true);
    const doc = await expectConverged(s);
    const g = drawings(s.editor)[0]![1];
    expect(g.kind).toBe("group");
    expect(g.id).toBeGreaterThan(0);
    expect(g.children!.map((m) => m.id)).toEqual([10, 12]);
    expect(stableStringify(doc.body[0])).toContain('"kind":"group"');
    // The nested editor of the second member writes its text into the group value.
    const [pos, value] = drawings(s.editor)[0]!;
    const next = structuredClone(value);
    const p = next.children![1]!.text!.blocks[0]!;
    if (p.kind === "paragraph") p.value.inlines = [{ kind: "run", value: { text: "two, typed" } }];
    s.editor.view.dispatch(s.editor.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing(next) }));
    const doc2 = await expectConverged(s);
    expect(stableStringify(doc2.body[0])).toContain("two, typed");
  });

  it("Create Link: two SetDrawingProps, the chain converges", async () => {
    const s = await setup(make(), makeDoc([para(1, [{ kind: "drawing", value: box(10, 11, "story", 0) }, { kind: "drawing", value: box(12, 13, "", 952500) }])]));
    const [[a], [b]] = drawings(s.editor) as [[number, Drawing], [number, Drawing]];
    expect(linkAt(s.editor.view, a, b)).toBeNull();
    await expectConverged(s);
    const ds = drawings(s.editor).map(([, d]) => d.chain);
    expect(ds).toEqual([
      { id: 1, seq: 0 },
      { id: 1, seq: 1 },
    ]);
  });
});
