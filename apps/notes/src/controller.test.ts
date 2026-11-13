// The controller against the real core (src-wasm/pkg) and the in-memory store: first start, persistence through
// the store, structure edits, the backup round trip, cross-notebook moves and Remove local data.

import { beforeAll, describe, expect, it } from "vitest";
import { WebNotesBackend, type NotesWasmModule } from "./backend";
import { NotesController } from "./controller";
import { MemoryNotesStore } from "./store";
import { allPages, allSections, findNode, flatPages } from "./tree";
import { coreAvailable, loadCore } from "./test/core";
import type { TreeNode } from "./generated/TreeNode";
import { genesisTextId } from "./editor/mirror";

let core: NotesWasmModule;
let clock = 1_700_000_000_000;
const now = () => (clock += 1000);

function make(store = new MemoryNotesStore()) {
  return { ctl: new NotesController(new WebNotesBackend(core), store, now), store };
}

const shape = (tree: TreeNode[]): unknown => tree.map((n) => ({ kind: n.kind, title: n.title, pageDoc: n.pageDoc, children: shape(n.children) }));

describe.runIf(coreAvailable)("NotesController (real core)", () => {
  beforeAll(async () => {
    core = await loadCore();
  });

  it("first start creates My notebook › Quick notes › welcome page and stores it", async () => {
    const { ctl, store } = make();
    await ctl.start();
    await ctl.idle();
    const s = ctl.getState();
    expect(s.phase).toBe("ready");
    expect(s.notebooks.map((n) => n.summary.info.name)).toEqual(["My notebook"]);
    const tree = ctl.tree();
    expect(allSections(tree).map((x) => x.title)).toEqual(["Quick notes"]);
    expect(allPages(tree).map((p) => p.title)).toEqual(["Welcome to Rusuite Notes"]);
    expect(s.mirror?.hasGenesis()).toBe(true);
    expect(s.known.map((k) => k.name)).toEqual(["My notebook"]);
    expect(store.docs.size).toBeGreaterThanOrEqual(2);
    // Search sees the welcome text: it reached the core.
    const hits = JSON.parse(core.dispatch(JSON.stringify({ type: "search", query: "sub-pages" }))).ok.hits;
    expect(hits.length).toBeGreaterThan(0);
    // Leave the core clean for the next test (one host per file).
    await ctl.clearLocalData();
    expect(store.docs.size).toBe(0);
    expect(ctl.getState().notebooks).toEqual([]);
  });

  it("structure edits persist: a second controller over the same store sees them (after the first closes)", async () => {
    const { ctl, store } = make();
    await ctl.start();
    await ctl.createSection("Projects");
    await ctl.createPage();
    const sec = ctl.getState().section!;
    await ctl.rename(ctl.getState().page!, "Plan");
    await ctl.createPage();
    const sub = ctl.getState().page!;
    await ctl.rename(sub, "Detail");
    await ctl.indentPage(sub);
    await ctl.idle();
    const flat = flatPages(findNode(ctl.tree(), sec));
    expect(flat.map((f) => `${f.node.title}:${f.level}`)).toEqual([":0", "Plan:0", "Detail:1"]);
    const before = shape(ctl.tree());
    const nb = ctl.getState().notebook!;
    await ctl.closeNotebook(nb);

    const second = make(store).ctl;
    await second.openKnown(nb);
    expect(shape(second.tree(nb))).toEqual(before);
    await second.clearLocalData();
  });

  it("delete → recycle bin → restore; undo/redo of a structural edit", async () => {
    const { ctl } = make();
    await ctl.start();
    await ctl.createPage();
    const page = ctl.getState().page!;
    await ctl.rename(page, "Doomed");
    await ctl.deleteNode(page);
    expect(findNode(ctl.tree(), page)).toBeNull();
    await ctl.showRecycleBin(true);
    expect(ctl.getState().recycle.map((e) => e.node.title)).toEqual(["Doomed"]);
    await ctl.restore(page);
    expect(findNode(ctl.tree(), page)?.title).toBe("Doomed");
    await ctl.showRecycleBin(false);
    await ctl.undoStructure(); // the restore
    expect(findNode(ctl.tree(), page)).toBeNull();
    await ctl.redoStructure();
    expect(findNode(ctl.tree(), page)?.title).toBe("Doomed");
    await ctl.clearLocalData();
  });

  it("backup round trip: export, remove local data, import → identical tree and page text", async () => {
    const { ctl, store } = make();
    await ctl.start();
    const id = ctl.getState().notebook!;
    await ctl.createSection("Second");
    await ctl.idle();
    const before = shape(ctl.tree(id));
    const backup = (await ctl.exportBackup(id))!;
    expect(backup.name).toBe("My notebook.rnotes");
    expect(backup.bytes[0]).toBe(0x50); // "PK"
    await ctl.clearLocalData();
    expect(store.docs.size).toBe(0);
    await ctl.importBackup(backup.bytes);
    await ctl.idle();
    expect(shape(ctl.tree(id))).toEqual(before);
    expect(store.docs.size).toBeGreaterThan(0);
    // The welcome page's text came back.
    const welcome = allPages(ctl.tree(id)).find((p) => p.title === "Welcome to Rusuite Notes")!;
    const hits = JSON.parse(core.dispatch(JSON.stringify({ type: "search", query: "sub-pages" }))).ok.hits as { docId: string }[];
    expect(hits.map((h) => h.docId)).toContain(welcome.pageDoc);
    // Importing it again while it is open is refused with a message.
    await ctl.importBackup(backup.bytes);
    expect(ctl.getState().error).toMatch(/already open/);
    await ctl.clearLocalData();
  });

  it("moves a page with its sub-page to another notebook (copy, then the original to the recycle bin)", async () => {
    const { ctl } = make();
    await ctl.start();
    const src = ctl.getState().notebook!;
    await ctl.createPage();
    const parent = ctl.getState().page!;
    await ctl.rename(parent, "Travel");
    const m = ctl.getState().mirror!;
    (m.doc.getContainerById(genesisTextId(m.doc) as never) as unknown as { insert(i: number, s: string): void }).insert(0, "Lisbon in May");
    m.doc.commit();
    await m.settle();
    await ctl.createPage({ sub: true });
    await ctl.rename(ctl.getState().page!, "Packing");
    await ctl.createNotebook("Other");
    const dst = ctl.getState().notebook!;
    const dstSection = allSections(ctl.tree(dst))[0]!.id;
    await ctl.selectNotebook(src);
    await ctl.movePageToNotebook(parent, dst, dstSection);
    await ctl.idle();
    expect(ctl.getState().notebook).toBe(dst);
    const flat = flatPages(findNode(ctl.tree(dst), dstSection));
    expect(flat.map((f) => `${f.node.title}:${f.level}`)).toEqual([":0", "Travel:0", "Packing:1"]);
    expect(findNode(ctl.tree(src), parent)).toBeNull();
    const copy = flat[1]!.node.pageDoc!;
    const hits = JSON.parse(core.dispatch(JSON.stringify({ type: "search", query: "Lisbon" }))).ok.hits as { docId: string }[];
    expect(hits.map((h) => h.docId)).toContain(copy);
    await ctl.clearLocalData();
  });

  it("tasks: listed once, ticked from the tasks view through a mirror of a closed page; tags; purge one entry; blobs", async () => {
    const { ctl, store } = make();
    await ctl.start();
    // The welcome page has a check list; its first item, ticked from the tasks view while another page is open.
    const welcome = ctl.getState().opened!.docId;
    await ctl.createPage();
    await ctl.showTasks(true);
    const open = ctl.getState().tasks.filter((x) => x.docId === welcome);
    expect(open.length).toBe(4);
    expect(new Set(open.map((x) => x.path.join("/"))).size).toBe(4);
    const first = open.find((x) => !x.checked)!;
    await ctl.setTaskChecked(first, true);
    expect(ctl.getState().tasks.find((x) => x.docId === welcome && x.path.join() === first.path.join())?.checked).toBe(true);
    // Custom tags.
    const id = (await ctl.addTag("Waiting", "customToDo", "clock", "#D13438"))!;
    expect(ctl.tagDefs().find((x) => x.id === id)).toMatchObject({ label: "Waiting", kind: "customToDo", icon: "clock" });
    await ctl.updateTag(id, { label: "Blocked" });
    expect(ctl.tagDefs().find((x) => x.id === id)?.label).toBe("Blocked");
    // Purge one recycle-bin entry.
    const a = ctl.getState().page!;
    await ctl.createPage();
    const b = ctl.getState().page!;
    await ctl.deleteNode(a);
    await ctl.deleteNode(b);
    await ctl.showRecycleBin(true);
    expect(ctl.getState().recycle.length).toBe(2);
    await ctl.purgeNode(a);
    expect(ctl.getState().recycle.map((e) => e.node.id)).toEqual([b]);
    // Blobs go through the core's Blob effect into the store.
    const sha = (await ctl.storeBlob(new Uint8Array([1, 2, 3])))!;
    await ctl.idle();
    expect(await store.getBlob(ctl.getState().notebook!, sha)).toEqual(new Uint8Array([1, 2, 3]));
    await ctl.clearLocalData();
  });
});
