// The byte layouts shared with notes-core (docs/notes-format.md §2 and §5): persist effects, `.log` record framing
// and the blob list of `export_backup`. All integers little-endian.

/** One storage change queued by the core (`take_persist_effects`). */
export type PersistEffect =
  /** Append one Loro update record to the document's log. */
  | { kind: "append"; notebook: string; doc: string; bytes: Uint8Array }
  /** Replace the document's snapshot and empty its log. */
  | { kind: "replace"; notebook: string; doc: string; bytes: Uint8Array }
  /** Delete the document (snapshot and log). */
  | { kind: "delete"; notebook: string; doc: string }
  /** Store a blob (`doc` = its SHA-256). */
  | { kind: "blob"; notebook: string; doc: string; bytes: Uint8Array };

const KINDS = { 1: "append", 2: "replace", 3: "delete", 4: "blob" } as const;
const CODES = { append: 1, replace: 2, delete: 3, blob: 4 } as const;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/** Decodes `encode_effects` bytes: `count:u32`, then per effect `kind:u8`, `notebook:u16+UTF-8`, `doc:u16+UTF-8`, `bytes:u32+bytes`. */
export function decodeEffects(data: Uint8Array): PersistEffect[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (at + n > data.byteLength) throw new Error("persist effects: truncated");
  };
  const u8 = () => (need(1), data[at++]!);
  const u16 = () => (need(2), (at += 2), view.getUint16(at - 2, true));
  const u32 = () => (need(4), (at += 4), view.getUint32(at - 4, true));
  const bytes = (n: number) => (need(n), (at += n), data.slice(at - n, at));
  const str = () => fromUtf8.decode(bytes(u16()));
  if (data.byteLength === 0) return [];
  const count = u32();
  const out: PersistEffect[] = [];
  for (let i = 0; i < count; i++) {
    const code = u8();
    const kind = KINDS[code as keyof typeof KINDS];
    if (!kind) throw new Error(`persist effects: unknown kind ${code}`);
    const notebook = str();
    const doc = str();
    const body = bytes(u32());
    out.push(kind === "delete" ? { kind, notebook, doc } : { kind, notebook, doc, bytes: body });
  }
  return out;
}

/** The inverse of `decodeEffects` (tests and fakes). */
export function encodeEffects(effects: readonly PersistEffect[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };
  const str = (s: string) => {
    const b = utf8.encode(s);
    const len = new Uint8Array(2);
    new DataView(len.buffer).setUint16(0, b.length, true);
    return [len, b];
  };
  parts.push(u32(effects.length));
  for (const e of effects) {
    const body = e.kind === "delete" ? new Uint8Array() : e.bytes;
    parts.push(Uint8Array.of(CODES[e.kind]), ...str(e.notebook), ...str(e.doc), u32(body.length), body);
  }
  return concat(parts);
}

/** `len:u32` + bytes per record (the `.log` framing; also the blob list of `export_backup`). */
export function frameRecords(records: readonly Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const r of records) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, r.length, true);
    parts.push(len, r);
  }
  return concat(parts);
}

/** Splits framed records; a truncated tail is dropped (the core does the same with a warning). */
export function splitRecords(data: Uint8Array): Uint8Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Uint8Array[] = [];
  let at = 0;
  while (at + 4 <= data.byteLength) {
    const n = view.getUint32(at, true);
    if (at + 4 + n > data.byteLength) break;
    out.push(data.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
