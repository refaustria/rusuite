// The desktop adapter (P11-N7) against a fake `invoke`: the command names, the raw-body framing and the reply
// decoding of `apps/notes/src-tauri/src/lib.rs`.

import { describe, expect, it } from "vitest";
import { CoreError } from "../backend";
import { encodeEffects, frameRecords, type PersistEffect } from "../effects";
import { inviteHashOf } from "../ui/dialogs";
import { frameArgs, metaFromJson, metaToJson, TauriDesktop, TauriNotesBackend, TauriNotesStore, toBytes, type Invoke } from "./backend";
import { checklistNode, taskLines } from "../ai/notesAi";

type Call = { cmd: string; args: unknown };

function fake(reply: (cmd: string, args: unknown) => unknown): { invoke: Invoke; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      return reply(cmd, args);
    },
  };
}

/** Splits a raw body back into its JSON arguments and payload. */
function unframe(body: unknown): { args: unknown; payload: Uint8Array } {
  const b = body as Uint8Array;
  const len = new DataView(b.buffer, b.byteOffset).getUint32(0, true);
  return { args: JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + len))), payload: b.subarray(4 + len) };
}

const rec = (b: Uint8Array) => frameRecords([b]);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
};
const buf = (b: Uint8Array) => b.slice().buffer;

describe("raw bodies", () => {
  it("frames JSON arguments and a payload", () => {
    const { args, payload } = unframe(frameArgs({ doc: "d1" }, new Uint8Array([7, 8])));
    expect(args).toEqual({ doc: "d1" });
    expect([...payload]).toEqual([7, 8]);
  });

  it("reads byte replies as ArrayBuffer, Uint8Array or a number array", () => {
    expect([...toBytes(new Uint8Array([1]).buffer)]).toEqual([1]);
    expect([...toBytes(new Uint8Array([2]))]).toEqual([2]);
    expect([...toBytes([3])]).toEqual([3]);
    expect(() => toBytes("x")).toThrow();
  });
});

describe("TauriNotesBackend", () => {
  it("dispatches the request as JSON and parses the reply", async () => {
    const f = fake(() => JSON.stringify({ ok: { type: "notebooks", notebooks: [] } }));
    const b = new TauriNotesBackend(f.invoke);
    const r = await b.dispatch({ type: "listNotebooks" });
    expect(r).toEqual({ ok: { type: "notebooks", notebooks: [] } });
    expect(f.calls[0]).toEqual({ cmd: "dispatch", args: { request: JSON.stringify({ type: "listNotebooks" }) } });
  });

  it("sends a stored document as snapshot pair + log", async () => {
    const f = fake(() => JSON.stringify({ ok: { type: "loaded", warnings: [] } }));
    await new TauriNotesBackend(f.invoke).loadDoc("nb", "doc", new Uint8Array([1, 2]), new Uint8Array([9]));
    const { args, payload } = unframe(f.calls[0]!.args);
    expect(f.calls[0]!.cmd).toBe("load_doc");
    expect(args).toEqual({ notebook: "nb", doc: "doc" });
    expect([...payload]).toEqual([2, 0, 0, 0, 1, 2, 9]);
  });

  it("decodes persist effects and byte replies", async () => {
    const effects: PersistEffect[] = [{ kind: "append", notebook: "nb", doc: "d", bytes: new Uint8Array([5]) }];
    const f = fake((cmd) => (cmd === "take_persist_effects" ? buf(encodeEffects(effects)) : buf(new Uint8Array([4, 2]))));
    const b = new TauriNotesBackend(f.invoke);
    expect(await b.takePersistEffects()).toEqual(effects);
    expect([...(await b.versionVector("d"))]).toEqual([4, 2]);
    expect(f.calls[1]).toEqual({ cmd: "version_vector", args: { doc: "d" } });
  });

  it("turns a core error reply into a CoreError", async () => {
    const f = fake(() => {
      throw JSON.stringify({ err: { code: "notFound", message: "no such doc" } });
    });
    await expect(new TauriNotesBackend(f.invoke).exportUpdates("d", new Uint8Array())).rejects.toEqual(new CoreError("notFound", "no such doc"));
  });

  it("converts natively (no module to load)", async () => {
    const f = fake(() => buf(new Uint8Array([1])));
    const b = new TauriNotesBackend(f.invoke);
    expect(b.converter.loaded).toBe(true);
    await b.converter.pasteHtml("<p>x</p>");
    await b.converter.exportFile("markdown" as never, { kind: "page" } as never, new Uint8Array([3]));
    expect(f.calls[0]).toEqual({ cmd: "convert_paste_html", args: { request: JSON.stringify({ html: "<p>x</p>" }) } });
    const ex = unframe(f.calls[1]!.args);
    expect(f.calls[1]!.cmd).toBe("convert_export");
    expect(ex.args).toEqual({ request: JSON.stringify({ format: "markdown", source: { kind: "page" } }) });
    expect([...ex.payload]).toEqual([3]);
  });

  it("opens a backup through the native dialog (empty reply: cancelled)", async () => {
    const name = new TextEncoder().encode(JSON.stringify({ name: "a.rnotes" }));
    let cancelled = false;
    const f = fake(() => buf(cancelled ? new Uint8Array() : cat(rec(name), new Uint8Array([8, 9]))));
    const b = new TauriNotesBackend(f.invoke);
    const got = await b.openFile();
    expect(got?.name).toBe("a.rnotes");
    expect([...got!.bytes]).toEqual([8, 9]);
    expect((unframe(f.calls[0]!.args).args as { filters: unknown }).filters).toEqual([{ name: expect.any(String), extensions: ["rnotes"] }]);
    cancelled = true;
    expect(await b.openFile()).toBeNull();
  });

  it("saves through the native dialog", async () => {
    const f = fake(() => null);
    expect(await new TauriNotesBackend(f.invoke).saveFile("nb.rnotes", new Uint8Array([1]))).toBe(false);
    expect((unframe(f.calls[0]!.args).args as { suggestedName: string }).suggestedName).toBe("nb.rnotes");
  });
});

describe("TauriNotesStore", () => {
  it("writes effects into the folders", async () => {
    const f = fake(() => null);
    const effects: PersistEffect[] = [{ kind: "delete", notebook: "nb", doc: "d" }];
    const s = new TauriNotesStore(f.invoke);
    await s.apply([]);
    expect(f.calls).toHaveLength(0);
    await s.apply(effects);
    expect(f.calls[0]!.cmd).toBe("store_apply");
    expect([...unframe(f.calls[0]!.args).payload]).toEqual([...encodeEffects(effects)]);
  });

  it("loads a notebook's documents and its warnings", async () => {
    const head = new TextEncoder().encode(JSON.stringify({ docs: ["nb", "p1"], warnings: [{ doc: "p1", kind: "truncatedLog" }] }));
    const log = frameRecords([new Uint8Array([1]), new Uint8Array([2, 3])]);
    const body = cat(rec(head), rec(new Uint8Array([10])), rec(new Uint8Array()), rec(new Uint8Array([11])), rec(log));
    const s = new TauriNotesStore(fake(() => buf(body)).invoke);
    const docs = await s.loadNotebook("nb");
    expect(docs.map((d) => [d.doc, [...d.snapshot], d.records])).toEqual([
      ["nb", [10], 0],
      ["p1", [11], 2],
    ]);
    expect([...docs[1]!.log]).toEqual([...log]);
    expect(s.takeWarnings()).toEqual([{ doc: "p1", kind: "truncatedLog" }]);
    expect(s.takeWarnings()).toEqual([]);
  });

  it("returns blobs and a missing blob as undefined", async () => {
    const f = fake((cmd) => buf(cmd === "store_blobs" ? frameRecords([new Uint8Array([1]), new Uint8Array([2])]) : new Uint8Array()));
    const s = new TauriNotesStore(f.invoke);
    expect((await s.blobs("nb")).map((b) => [...b])).toEqual([[1], [2]]);
    expect(await s.getBlob("nb", "ab")).toBeUndefined();
    expect(f.calls[1]).toEqual({ cmd: "store_get_blob", args: { notebook: "nb", sha: "ab" } });
  });

  it("keeps meta as JSON with bytes and the device keys in the keyring commands", async () => {
    const meta = new Map<string, string>();
    let keys = new Uint8Array();
    const f = fake((cmd, args) => {
      const a = args as { key: string; json: string | null };
      if (cmd === "meta_set") (a.json === null ? meta.delete(a.key) : meta.set(a.key, a.json), null);
      if (cmd === "meta_get") return meta.get(a.key) ?? null;
      if (cmd === "device_keys_set") keys = unframe(args).payload.slice();
      if (cmd === "device_keys_get") return buf(keys);
      return { inFile: false };
    });
    const s = new TauriNotesStore(f.invoke);
    expect(await s.getMeta("sync:deviceKeys")).toBeUndefined();
    await s.setMeta("sync:deviceKeys", new Uint8Array([1, 2, 3]));
    expect([...((await s.getMeta<Uint8Array>("sync:deviceKeys")) ?? [])]).toEqual([1, 2, 3]);
    expect(meta.has("sync:deviceKeys")).toBe(false);
    await s.setMeta("sync:state:nb", { seq: 3, book: new Uint8Array([9]) });
    expect(await s.getMeta("sync:state:nb")).toEqual({ seq: 3, book: new Uint8Array([9]) });
    await s.setMeta("sync:state:nb", null);
    expect(await s.getMeta("sync:state:nb")).toBeUndefined();
  });

  it("forgets folders instead of deleting them", async () => {
    const f = fake(() => null);
    const s = new TauriNotesStore(f.invoke);
    await s.deleteNotebook("nb");
    await s.clearAll();
    expect(f.calls.map((c) => c.cmd)).toEqual(["store_forget", "store_clear"]);
  });
});

describe("meta JSON", () => {
  it("round-trips nested bytes and leaves other objects alone", () => {
    const v = { a: [new Uint8Array([1, 255])], b: { $bytes: 1 }, c: "x" };
    expect(metaFromJson(metaToJson(v))).toEqual(v);
  });
});

describe("TauriDesktop", () => {
  it("passes the relay setting and hands back the shell's refusal", async () => {
    const f = fake((cmd) => {
      if (cmd === "relay_set") throw "the relay must use https";
      return null;
    });
    await expect(new TauriDesktop(f.invoke).setRelay("http://example.org", false)).rejects.toBe("the relay must use https");
    expect(f.calls[0]).toEqual({ cmd: "relay_set", args: { url: "http://example.org", allowHttp: false } });
  });

  it("opens folders through the shell", async () => {
    const f = fake((cmd) => (cmd === "notebook_open_recent" ? { id: "nb", name: "N", path: "/x" } : true));
    const d = new TauriDesktop(f.invoke);
    expect(await d.pickLocation()).toBe(true);
    expect(await d.openRecent("/x")).toEqual({ id: "nb", name: "N", path: "/x" });
    expect(f.calls.map((c) => c.cmd)).toEqual(["notebook_pick_location", "notebook_open_recent"]);
  });
});

describe("Join with link", () => {
  it("takes the invite part of a pasted link", () => {
    expect(inviteHashOf("https://rusuit.es/notes/#i=abc_DEF-1&n=Ana")).toBe("#i=abc_DEF-1&n=Ana");
    expect(inviteHashOf("  abc123 ")).toBe("#i=abc123");
    expect(inviteHashOf("https://rusuit.es/notes/#page=x")).toBeNull();
    expect(inviteHashOf("")).toBeNull();
  });
});

describe("AI: extract tasks", () => {
  it("cleans task lines and builds an open checklist", () => {
    expect(taskLines("- Call Ana\n2. [ ] Book room\n\n* [x] Send notes")).toEqual(["Call Ana", "Book room", "Send notes"]);
    expect(checklistNode(["A"])).toEqual({
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }],
    });
  });
});
