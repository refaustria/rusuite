// The sync engine's state machine against a scripted relay (fake socket) and fake crypto (envelopes as JSON):
// subscribe order, catch-up, the outbox across reconnects, epoch changes, compaction, joining and removal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoroDoc, VersionVector, type PeerID } from "loro-crdt";
import { NOTEBOOK_DOC, type RelayEvent, type ShareStatus, type SyncCrypto } from "./crypto";
import { BACKOFF_MS, COMPACT_AFTER, SEND_PER_SEC, UPDATE_PART_BYTES, emptyState, NotebookSync, type EngineState, type SocketLike, type SyncDocHost } from "./engine";

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

interface FakeEnv {
  kind: string;
  doc: string;
  covers: number;
  epoch: number;
  data: string;
  sha?: string;
}

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(data: Uint8Array) {
    this.sent.push(JSON.parse(dec.decode(data)) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
  }
  /** The relay sends an event (and the decrypted payload the fake crypto hands out). */
  push(ev: RelayEvent, payload?: Uint8Array) {
    this.readyState = 1;
    this.onmessage?.({ data: enc.encode(JSON.stringify({ ev, payload: payload ? b64(payload) : null })) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  of(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

function fakeCrypto(status: () => ShareStatus) {
  let payload = new Uint8Array();
  let epoch = 0;
  const reencrypted: number[] = [];
  const c: SyncCrypto & { setEpoch(e: number): void; reencrypted: number[] } = {
    reencrypted,
    setEpoch: (e) => (epoch = e),
    deviceCreate: () => new Uint8Array(),
    deviceLoad: () => "dev",
    bookLoad: () => status(),
    bookSave: () => new Uint8Array([1]),
    bookForget: () => undefined,
    setLocalId: () => undefined,
    shareCreate: () => ({ notebook: "nb-hex", genesis: new Uint8Array() }),
    joinStart: () => ({ notebook: "nb-hex", role: "edit", expiresAt: 0 }),
    joinRequest: (_nb, name) => enc.encode(JSON.stringify({ kind: "join", doc: "", covers: 0, epoch, data: name })),
    status: () => ({ ...status(), epoch }),
    docId: (_nb, doc) => (doc === "nb" ? NOTEBOOK_DOC : `hex-${doc}`),
    blobDocId: (_nb, sha) => `blob-${sha}`,
    subscribe: (_nb, docs) => enc.encode(JSON.stringify({ type: "subscribe", docs })),
    publish: (tag, env) => enc.encode(JSON.stringify({ type: "publish", tag, env: JSON.parse(dec.decode(env)) })),
    fetchBlob: (_nb, sha) => enc.encode(JSON.stringify({ type: "fetchBlob", sha })),
    stopSharing: () => enc.encode(JSON.stringify({ type: "stop" })),
    sealDoc: (_nb, doc, covers, data) => enc.encode(JSON.stringify({ kind: covers ? "snapshot" : "update", doc, covers, epoch, data: b64(data) } satisfies FakeEnv)),
    sealBlob: (_nb, sha, data) => enc.encode(JSON.stringify({ kind: "blob", doc: "", covers: 0, epoch, data: b64(data), sha } satisfies FakeEnv)),
    sealPresence: (_nb, data) => enc.encode(JSON.stringify({ kind: "presence", doc: "", covers: 0, epoch, data: b64(data) })),
    reencrypt: (_nb, env) => {
      const e = JSON.parse(dec.decode(env)) as FakeEnv;
      reencrypted.push(e.epoch);
      return enc.encode(JSON.stringify({ ...e, epoch }));
    },
    envelopeEpoch: (env) => (JSON.parse(dec.decode(env)) as FakeEnv).epoch,
    inviteCreate: () => ({ fragment: "f", inviteId: "i", expiresAt: 0 }),
    admit: () => [enc.encode(JSON.stringify({ kind: "members", doc: "", covers: 0, epoch, data: "" }))],
    decline: () => undefined,
    remove: () => [],
    setRole: () => new Uint8Array(),
    handle: (_nb, frame) => {
      const m = JSON.parse(dec.decode(frame)) as { ev: RelayEvent; payload: string | null };
      payload = m.payload ? unb64(m.payload) : new Uint8Array();
      return m.ev;
    },
    takePayload: () => payload,
  };
  return c;
}

/** Real Loro docs behind the host: `nb` (the notebook doc) and pages. */
function fakeHost(docs: Record<string, LoroDoc>, opts: { has?: boolean } = {}) {
  let has = opts.has ?? true;
  const imported: { doc: string; bytes: Uint8Array }[] = [];
  const adopted: Uint8Array[][] = [];
  const host: SyncDocHost & { imported: typeof imported; adopted: typeof adopted } = {
    imported,
    adopted,
    localDocs: () => (has ? Object.keys(docs) : []),
    priorityDocs: () => (has ? ["pg1"] : []),
    hasNotebook: () => has,
    versionVector: async (d) => docs[d]!.oplogVersion().encode(),
    exportSince: async (d, vv) => docs[d]!.export(vv.length ? { mode: "update", from: VersionVector.decode(vv) } : { mode: "update" }),
    // Like the core's `export_update_chunks`: per peer counter ranges, halved until a part fits.
    exportChunks: async (d, vv, max) => {
      const doc = docs[d]!;
      const from = vv.length ? VersionVector.decode(vv) : new VersionVector(null);
      const all = doc.export({ mode: "update", from });
      if (all.length <= max) return [all];
      const out: Uint8Array[] = [];
      const part = (peer: PeerID, a: number, b: number) => doc.export({ mode: "updates-in-range", spans: [{ id: { peer, counter: a }, len: b - a }] });
      const split = (peer: PeerID, a: number, b: number) => {
        const bytes = part(peer, a, b);
        if (bytes.length <= max || b - a <= 1) out.push(bytes);
        else {
          const m = Math.floor((a + b) / 2);
          split(peer, a, m);
          split(peer, m, b);
        }
      };
      for (const [peer, end] of doc.oplogVersion().toJSON()) {
        const start = from.get(peer) ?? 0;
        if (end > start) split(peer, start, end);
      }
      return out;
    },
    importRemote: async (_l, d, bytes) => {
      imported.push({ doc: d, bytes });
      (docs[d] ??= new LoroDoc()).import(bytes);
    },
    adoptNotebook: async (_l, updates) => {
      adopted.push(updates);
      for (const u of updates) docs.nb!.import(u);
      has = true;
    },
    readBlob: async (_l, sha) => (sha === "s1" ? new Uint8Array([9]) : undefined),
    blobIds: async () => [],
    storeBlob: async () => undefined,
    displayName: () => "Ben",
  };
  return host;
}

const member: ShareStatus = { notebook: "nb-hex", localId: "nb", member: true, role: "edit", members: [{ device: "b", name: "Me", role: "edit", me: true }] };

function edit(doc: LoroDoc, text: string) {
  doc.getText("t").insert(0, text);
  doc.commit();
}

async function settle(e: NotebookSync) {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(40);
    await e.idle();
  }
}

describe("NotebookSync", () => {
  let sockets: FakeSocket[];
  let saved: EngineState[];
  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    saved = [];
  });
  afterEach(() => vi.useRealTimers());

  function make(status: ShareStatus = member, docs: Record<string, LoroDoc> = { nb: new LoroDoc(), pg1: new LoroDoc(), pg2: new LoroDoc() }, state = emptyState("nb"), hostOpts = {}) {
    let st = status;
    const crypto = fakeCrypto(() => st);
    const host = fakeHost(docs, hostOpts);
    const listener = { removed: vi.fn(), adopted: vi.fn(), joinRequest: vi.fn(), status: vi.fn() };
    const e = new NotebookSync(
      "nb-hex",
      crypto,
      state,
      host,
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      async (s) => void saved.push(s),
      listener,
      () => Date.now(),
    );
    return { e, crypto, host, docs, listener, setStatus: (s: ShareStatus) => (st = s) };
  }

  it("subscribes the notebook doc and the open page first, then the rest; catch-up imports and advances markers", async () => {
    const { e, host, docs } = make();
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    expect(ws.of("subscribe")[0]!.docs).toEqual([
      [NOTEBOOK_DOC, 0],
      ["hex-pg1", 0],
    ]);
    ws.push({ type: "subscribed", docs: [[NOTEBOOK_DOC, 2], ["hex-pg9", 1]], newJoins: [] });
    const remote = new LoroDoc();
    edit(remote, "hello");
    ws.push({ type: "deliver", doc: NOTEBOOK_DOC, seq: 2, kind: "update", target: "notebook", id: "nb", author: "a" }, remote.export({ mode: "update" }));
    ws.push({ type: "caughtUp", doc: NOTEBOOK_DOC, last: 2 });
    await settle(e);
    expect(host.imported.map((i) => i.doc)).toEqual(["nb"]);
    expect(docs.nb!.getText("t").toString()).toBe("hello");
    expect(e.state.markers[NOTEBOOK_DOC]).toBe(2);
    // The rest: the relay's directory and the local tree, never twice.
    const rest = ws.of("subscribe")[1]!.docs as [string, number][];
    expect(rest.map(([d]) => d).sort()).toEqual(["hex-pg2", "hex-pg9"]);
    // The remote operations are known: nothing goes back.
    expect(ws.of("publish").filter((p) => (p.env as FakeEnv).doc === "nb")).toEqual([]);
  });

  it("queues local changes offline and publishes them after reconnecting; Accepted empties the outbox", async () => {
    const { e, docs } = make();
    e.start();
    sockets[0]!.push({ type: "challenge" });
    sockets[0]!.push({ type: "subscribed", docs: [], newJoins: [] });
    sockets[0]!.push({ type: "caughtUp", doc: NOTEBOOK_DOC, last: 0 });
    await settle(e);
    const first = sockets[0]!.of("publish").length;
    sockets[0]!.drop();
    expect(e.phase).toBe("offline");
    edit(docs.pg1!, "offline text");
    e.localChanged(["pg1"]);
    await settle(e);
    expect(e.state.outbox.filter((o) => o.doc === "hex-pg1")).toHaveLength(1);
    expect(sockets[0]!.of("publish")).toHaveLength(first);
    // Backoff, then a new connection that flushes the outbox.
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]!);
    const ws = sockets[1]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    await settle(e);
    const pub = ws.of("publish").find((p) => (p.env as FakeEnv).doc === "pg1")!;
    expect(pub).toBeTruthy();
    const check = new LoroDoc();
    check.import(unb64((pub.env as FakeEnv).data));
    expect(check.getText("t").toString()).toBe("offline text");
    ws.push({ type: "accepted", tag: pub.tag as number, seq: 7 });
    for (const o of [...e.state.outbox]) ws.push({ type: "accepted", tag: o.tag, seq: 1 });
    for (let i = 0; i < 3; i++) {
      for (const sub of ws.of("subscribe")) for (const [d] of sub.docs as [string, number][]) ws.push({ type: "caughtUp", doc: d, last: 0 });
      await settle(e);
    }
    expect(e.state.outbox).toEqual([]);
    expect(e.state.markers["hex-pg1"]).toBe(7);
    expect(e.phase).toBe("synced");
    // Unchanged docs are not sent again.
    e.localChanged(["pg1"]);
    await settle(e);
    expect(ws.of("publish").filter((p) => (p.env as FakeEnv).doc === "pg1")).toHaveLength(1);
    expect(saved.length).toBeGreaterThan(0);
  });

  it("a first share of a page over 3 MB goes out in parts below the relay's limit; together they are the page", async () => {
    const { e, docs } = make();
    const big = docs.pg1!;
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let i = 0; i < 40; i++) {
      const chunk = Array.from({ length: 90_000 }, () => String.fromCharCode(33 + (rnd() % 90))).join("");
      big.getText("t").insert(big.getText("t").length, chunk);
      big.commit();
    }
    expect(big.export({ mode: "update" }).length).toBeGreaterThan(3 * 1024 * 1024);
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    await settle(e);
    const parts = ws.of("publish").filter((p) => (p.env as FakeEnv).doc === "pg1");
    expect(parts.length).toBeGreaterThanOrEqual(7);
    const fresh = new LoroDoc();
    for (const p of [...parts].reverse()) {
      const bytes = unb64((p.env as FakeEnv).data);
      expect(bytes.length).toBeLessThanOrEqual(UPDATE_PART_BYTES);
      fresh.import(bytes);
    }
    expect(fresh.getText("t").toString()).toBe(big.getText("t").toString());
    // Each part is its own outbox entry (acknowledged one by one).
    expect(new Set(parts.map((p) => p.tag)).size).toBe(parts.length);
  });

  it("a first share of many pages stays under the relay's rate; a refused subscription is sent again (P11-X1)", async () => {
    const docs: Record<string, LoroDoc> = { nb: new LoroDoc() };
    for (let i = 0; i < 150; i++) {
      const d = new LoroDoc();
      edit(d, `page ${i}`);
      docs[`pg${i}`] = d;
    }
    const { e } = make(member, docs);
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    ws.push({ type: "caughtUp", doc: NOTEBOOK_DOC, last: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await e.idle();
    // Never more than the budget plus the refill in any second.
    let last = 0;
    for (let t = 0; t < 10; t++) {
      const now = ws.sent.length;
      // The relay allows 50 a second per connection.
      expect(now - last).toBeLessThanOrEqual(Math.min(50, SEND_PER_SEC + 1));
      last = now;
      await vi.advanceTimersByTimeAsync(1000);
      await e.idle();
    }
    const pages = new Set(ws.of("publish").map((p) => (p.env as FakeEnv).doc));
    expect(pages.size).toBe(151);
    expect(e.phase).toBe("syncing");
    // The relay refused one request over its rate: what is still catching up is subscribed again.
    const subs = ws.of("subscribe").length;
    ws.push({ type: "error", code: "RateLimited" });
    await vi.advanceTimersByTimeAsync(1100);
    const again = ws.of("subscribe").slice(subs).flatMap((m) => (m.docs as [string, number][]).map(([d]) => d));
    expect(again.length).toBeGreaterThanOrEqual(150);
    for (const o of [...e.state.outbox]) ws.push({ type: "accepted", tag: o.tag, seq: 1 });
    for (const d of new Set(again)) ws.push({ type: "caughtUp", doc: d, last: 0 });
    await settle(e);
    expect(e.phase).toBe("synced");
  });

  it("re-encrypts queued envelopes on an epoch change and on StaleEpoch", async () => {
    const { e, crypto, docs } = make();
    e.start();
    edit(docs.pg1!, "x");
    e.localChanged(["pg1"]);
    await settle(e);
    expect(e.state.outbox.map((o) => crypto.envelopeEpoch(o.env))).toEqual([0]);
    crypto.setEpoch(1);
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "keys", epoch: 1 });
    expect(crypto.reencrypted).toEqual([0]);
    expect(e.state.outbox.every((o) => crypto.envelopeEpoch(o.env) === 1)).toBe(true);
    // StaleEpoch for something sealed before: re-encrypted again only if older; resent.
    const tag = e.state.outbox[0]!.tag;
    ws.push({ type: "rejected", tag, code: "StaleEpoch" });
    expect(ws.of("publish").filter((p) => p.tag === tag).length).toBeGreaterThan(0);
  });

  it("uploads a full snapshot when the log exceeds the limit and this device is the lowest online editor", async () => {
    const { e, docs } = make();
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    const remote = new LoroDoc();
    edit(remote, "abc");
    ws.push({ type: "deliver", doc: "hex-pg1", seq: COMPACT_AFTER + 1, kind: "update", target: "page", id: "pg1", author: "a" }, remote.export({ mode: "update" }));
    await settle(e);
    const snap = ws.of("publish").find((p) => (p.env as FakeEnv).kind === "snapshot")!;
    expect(snap).toBeTruthy();
    expect((snap.env as FakeEnv).covers).toBe(COMPACT_AFTER + 1);
    const full = new LoroDoc();
    full.import(unb64((snap.env as FakeEnv).data));
    expect(full.getText("t").toString()).toBe(docs.pg1!.getText("t").toString());
    ws.push({ type: "accepted", tag: snap.tag as number, seq: COMPACT_AFTER + 1 });
    await settle(e);
    expect(e.state.snapshots["hex-pg1"]).toBe(COMPACT_AFTER + 1);
  });

  it("leaves compaction to an online editor with a lower device id", async () => {
    const st: ShareStatus = { ...member, members: [{ device: "b", name: "Me", role: "edit", me: true }, { device: "a", name: "Ann", role: "owner", me: false }] };
    const { e } = make(st);
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    ws.push({ type: "presence", author: "a" }, presencePayload("pg1"));
    const remote = new LoroDoc();
    edit(remote, "abc");
    ws.push({ type: "deliver", doc: "hex-pg1", seq: COMPACT_AFTER + 5, kind: "update", target: "page", id: "pg1", author: "a" }, remote.export({ mode: "update" }));
    await settle(e);
    expect(ws.of("publish").some((p) => (p.env as FakeEnv).kind === "snapshot")).toBe(false);
    expect(e.peers.get("a")?.page).toBe("pg1");
  });

  it("joining: sends one join request while pending, buffers the notebook until caught up, then adopts it", async () => {
    const joining: ShareStatus = { notebook: "nb-hex", localId: "", member: false, joining: true };
    const docs = { nb: new LoroDoc(), pg1: new LoroDoc() };
    const { e, host, listener, setStatus } = make(joining, docs, emptyState(""), { has: false });
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    expect(ws.of("subscribe")[0]!.docs).toEqual([]);
    ws.push({ type: "pending", requested: false });
    const join = ws.of("publish").filter((p) => (p.env as FakeEnv).kind === "join");
    expect(join).toHaveLength(1);
    expect((join[0]!.env as FakeEnv).data).toBe("Ben");
    expect(e.phase).toBe("waiting");
    ws.push({ type: "accepted", tag: join[0]!.tag as number, seq: 0 });
    expect(e.state.requested).toBe(true);
    // Admitted: subscribe again, now as a member.
    setStatus({ ...member, localId: "" });
    ws.push({ type: "admitted" });
    expect(ws.of("subscribe").at(-1)!.docs).toEqual([[NOTEBOOK_DOC, 0]]);
    ws.push({ type: "subscribed", docs: [[NOTEBOOK_DOC, 1]], newJoins: [] });
    const owner = new LoroDoc();
    edit(owner, "shared notebook");
    ws.push({ type: "deliver", doc: NOTEBOOK_DOC, seq: 1, kind: "update", target: "notebook", id: "nb", author: "a" }, owner.export({ mode: "update" }));
    await settle(e);
    expect(host.adopted).toEqual([]);
    ws.push({ type: "caughtUp", doc: NOTEBOOK_DOC, last: 1 });
    await settle(e);
    expect(host.adopted).toHaveLength(1);
    expect(e.localId).toBe("nb");
    expect(listener.adopted).toHaveBeenCalledWith("nb");
    expect(docs.nb.getText("t").toString()).toBe("shared notebook");
  });

  it("deliveries that came before the key wrap are fetched again once the key is there", async () => {
    const joining: ShareStatus = { notebook: "nb-hex", localId: "", member: false, joining: true };
    const docs = { nb: new LoroDoc(), pg1: new LoroDoc() };
    const { e, host, setStatus } = make(joining, docs, emptyState(""), { has: false });
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    setStatus({ ...member, localId: "", hasKey: false });
    ws.push({ type: "admitted" });
    ws.push({ type: "subscribed", docs: [[NOTEBOOK_DOC, 3]], newJoins: [] });
    for (const seq of [1, 2, 3]) ws.push({ type: "dropped", doc: NOTEBOOK_DOC, seq, reason: "no key for epoch 0" });
    ws.push({ type: "caughtUp", doc: NOTEBOOK_DOC, last: 3 });
    await settle(e);
    expect(host.adopted).toEqual([]);
    const subs = ws.of("subscribe").length;
    setStatus({ ...member, localId: "", hasKey: true });
    ws.push({ type: "keys", epoch: 0 });
    await settle(e);
    expect(ws.of("subscribe")).toHaveLength(subs + 1);
    expect(ws.of("subscribe").at(-1)!.docs).toEqual([[NOTEBOOK_DOC, 0]]);
    const owner = new LoroDoc();
    edit(owner, "now readable");
    ws.push({ type: "deliver", doc: NOTEBOOK_DOC, seq: 1, kind: "update", target: "notebook", id: "nb", author: "a" }, owner.export({ mode: "update" }));
    ws.push({ type: "caughtUp", doc: NOTEBOOK_DOC, last: 3 });
    await settle(e);
    expect(host.adopted).toHaveLength(1);
    expect(docs.nb.getText("t").toString()).toBe("now readable");
  });

  it("a removed device stops: banner state, no reconnect, edits stay local", async () => {
    const { e, listener, docs } = make();
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    ws.push({ type: "revoked" });
    expect(e.phase).toBe("removed");
    expect(listener.removed).toHaveBeenCalled();
    edit(docs.pg1!, "after removal");
    e.localChanged(["pg1"]);
    await settle(e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(e.state.removed).toBe(true);
    expect(ws.of("publish")).toEqual([]);
  });

  it("read-only members never send document changes", async () => {
    const { e, docs } = make({ ...member, role: "read" });
    e.start();
    const ws = sockets[0]!;
    ws.push({ type: "challenge" });
    ws.push({ type: "subscribed", docs: [], newJoins: [] });
    edit(docs.pg1!, "x");
    e.localChanged(["pg1"]);
    await settle(e);
    expect(ws.of("publish")).toEqual([]);
  });
});

function presencePayload(page: string): Uint8Array {
  const json = enc.encode(JSON.stringify({ page }));
  const out = new Uint8Array(8 + json.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  new DataView(out.buffer).setUint32(4 + json.length, 0, true);
  return out;
}
