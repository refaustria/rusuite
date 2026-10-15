// In-memory Write backend for tests: implements the request kinds of
// ADR 0007 / `write_core::dispatch_with` on a JS `Document` with the same
// semantics for the commands the UI sends (char offsets in Unicode
// scalars, temporary ids → `idMap`, style `next` on split, list reuse,
// undo/redo). Patches are computed by diffing the body before and after a
// command (a changed table is reported whole).

import { base64ToBytes, bytesToBase64, type OpenedFile } from "@rusuite/ui-shared";
import type { WriteBackend } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Inline } from "../generated/Inline";
import type { NumberingDef } from "../generated/NumberingDef";
import type { Paragraph } from "../generated/Paragraph";
import type { Request } from "../generated/Request";
import type { ResponseBody } from "../generated/ResponseBody";
import type { WriteCommand } from "../generated/WriteCommand";
import type { WritePatch } from "../generated/WritePatch";
import {
  applyParagraphPatch, applyRunPatch, blockKey, inlineLength, mergeRuns, paragraphLength, walkBlocks,
} from "../sync/model";
import template from "./newDocument.json";
import { numberingDef } from "./fixtures";

class Fail extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Snapshot {
  doc: Document;
}

/** Splits `inlines` at char offsets `from`/`to`: [before, middle, after]. */
export function splitInlines(inlines: Inline[], from: number, to: number): [Inline[], Inline[], Inline[]] {
  const parts: [Inline[], Inline[], Inline[]] = [[], [], []];
  let pos = 0;
  for (const inline of inlines) {
    const len = inlineLength(inline);
    if (inline.kind !== "run") {
      parts[pos < from ? 0 : pos < to ? 1 : 2].push(inline);
      pos += len;
      continue;
    }
    const chars = [...inline.value.text];
    const cut = (a: number, b: number) => chars.slice(Math.max(0, a - pos), Math.max(0, b - pos)).join("");
    const pieces = [cut(pos, from), cut(Math.max(pos, from), to), cut(Math.max(pos, to), pos + len)];
    pieces.forEach((text, k) => text && parts[k as 0 | 1 | 2].push({ kind: "run", value: { ...inline.value, text } }));
    pos += len;
  }
  return parts;
}

function inheritedProps(p: Paragraph, offset: number) {
  let pos = 0;
  let last: Inline | undefined;
  for (const i of p.inlines) {
    if (pos >= offset) break;
    if (i.kind === "run" && i.value.text) last = i;
    pos += inlineLength(i);
  }
  if (offset > 0 && last?.kind === "run") return { ...(last.value.props ?? {}) };
  const first = p.inlines.find((i) => i.kind === "run");
  return first?.kind === "run" ? { ...(first.value.props ?? {}) } : {};
}

export class FakeWriteBackend implements WriteBackend {
  readonly kind = "wasm" as const;
  readonly log: Request[] = [];
  doc: Document = structuredClone(template) as unknown as Document;
  revision = 0;
  private savedRevision = 0;
  private nextId = 2;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  name: string | null = null;
  /** Makes the next `apply` fail with this error code. */
  failNext: string | null = null;
  /** Rewrites the next patch before it is returned (tests of mismatches). */
  tamper: ((p: WritePatch) => WritePatch) | null = null;
  /** Answers after this many milliseconds (0 = next microtask). */
  delay = 0;
  /** Reports the next patch with an old revision (tests of stale replies). */
  staleNext = false;

  async ping() {
    return "Rusuite Write fake";
  }
  async openFile(): Promise<OpenedFile | null> {
    return null;
  }
  async saveFile() {
    return false;
  }
  async setTitle() {}
  async print() {}

  async dispatch<T = ResponseBody>(request: Request) {
    this.log.push(structuredClone(request));
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    try {
      return { ok: this.handle(request) as unknown as T };
    } catch (e) {
      if (e instanceof Fail) return { err: { code: e.code, message: e.message } };
      throw e;
    }
  }

  /** Commands sent with `apply`, in order. */
  commands(): WriteCommand[] {
    return this.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
  }

  private envelope(patch: WritePatch) {
    return {
      revision: this.revision,
      patch,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: this.revision !== this.savedRevision,
    };
  }

  private emptyPatch(): WritePatch {
    return { replaced: [], inserted: [], deleted: [], idMap: [], styles: null, numbering: null, page: null, info: null };
  }

  private reset(doc: Document) {
    this.doc = doc;
    this.nextId = Math.max(0, ...[...walkAll(doc.body)].map((n) => n)) + 1;
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.savedRevision = this.revision;
    return { type: "document" as const, doc: structuredClone(this.doc), envelope: this.envelope(this.emptyPatch()) };
  }

  private handle(request: Request): ResponseBody {
    switch (request.type) {
      case "newDocument":
        this.name = null;
        return this.reset(structuredClone(template) as unknown as Document);
      case "load":
        return this.reset(structuredClone(request.document));
      case "openDocx": {
        // The fake "docx" is the base64 of a Document's JSON.
        const doc = JSON.parse(new TextDecoder().decode(base64ToBytes(request.bytesBase64))) as Document;
        const r = this.reset(doc);
        this.name = request.name;
        return { type: "opened", doc: r.doc, warnings: ["fake reader: JSON instead of docx"], envelope: r.envelope };
      }
      case "saveDocx": {
        const base = (this.name ?? "Untitled.docx").replace(/\.docx$/i, "");
        return { type: "saved", bytesBase64: bytesToBase64(new TextEncoder().encode(JSON.stringify(this.doc))), suggestedName: `${base}.docx` };
      }
      case "getDocument":
        return { type: "document", doc: structuredClone(this.doc), envelope: this.envelope(this.emptyPatch()) };
      case "getMedia": {
        const m = this.doc.media.find((x) => x.id === request.id);
        if (!m) throw new Fail("unknown_media", `unknown media ${request.id}`);
        return { type: "media", contentType: m.contentType, bytesBase64: m.data };
      }
      case "recoverySnapshot":
        return {
          type: "recoverySnapshot",
          json: JSON.stringify(this.doc),
          revision: this.revision,
          dirty: this.revision !== this.savedRevision,
          name: this.name,
        };
      case "restoreRecovery": {
        let doc: Document;
        try {
          doc = JSON.parse(request.json) as Document;
        } catch {
          throw new Fail("invalid_snapshot", "not JSON");
        }
        const r = this.reset(doc);
        this.name = request.name ?? null;
        this.savedRevision = -1;
        return { ...r, envelope: this.envelope(this.emptyPatch()) };
      }
      case "documentState":
        return { type: "documentState", dirty: this.revision !== this.savedRevision, revision: this.revision, name: this.name };
      case "markSaved":
        if (request.name) this.name = request.name;
        this.savedRevision = this.revision;
        return { type: "documentState", dirty: false, revision: this.revision, name: this.name };
      case "undo":
      case "redo": {
        const from = request.type === "undo" ? this.undoStack : this.redoStack;
        const to = request.type === "undo" ? this.redoStack : this.undoStack;
        const snap = from.pop();
        if (!snap) return { type: "patch", envelope: this.envelope(this.emptyPatch()) };
        to.push({ doc: structuredClone(this.doc) });
        const before = this.doc;
        this.doc = snap.doc;
        this.revision++;
        return { type: "patch", envelope: this.envelope(this.diff(before, this.doc, [])) };
      }
      case "apply": {
        if (this.failNext) {
          const code = this.failNext;
          this.failNext = null;
          throw new Fail(code, "injected failure");
        }
        const before = structuredClone(this.doc);
        const idMap: [number, number][] = [];
        let info: string | null = null;
        try {
          info = this.exec(request.command, idMap);
        } catch (e) {
          this.doc = before;
          throw e;
        }
        this.undoStack.push({ doc: before });
        this.redoStack = [];
        this.revision++;
        let patch = this.diff(before, this.doc, idMap);
        patch.info = info;
        if (JSON.stringify(before.page) !== JSON.stringify(this.doc.page)) patch.page = this.doc.page;
        if (this.tamper) {
          patch = this.tamper(patch);
          this.tamper = null;
        }
        const envelope = this.envelope(patch);
        if (this.staleNext) {
          this.staleNext = false;
          envelope.revision -= 100;
        }
        return { type: "patch", envelope };
      }
    }
  }

  // ----- patch ---------------------------------------------------------------

  private diff(before: Document, after: Document, idMap: [number, number][]): WritePatch {
    const patch = this.emptyPatch();
    patch.idMap = idMap;
    const oldIds = new Map(before.body.map((b) => [b.value.id, b]));
    const newIds = new Set(after.body.map((b) => b.value.id));
    for (const b of before.body) if (!newIds.has(b.value.id)) patch.deleted.push(b.value.id);
    after.body.forEach((b, i) => {
      const old = oldIds.get(b.value.id);
      if (!old) patch.inserted.push({ after: i > 0 ? after.body[i - 1]!.value.id : null, parent: null, block: structuredClone(b) });
      else if (blockKey(old) !== blockKey(b)) patch.replaced.push(structuredClone(b));
    });
    if (JSON.stringify(before.numbering) !== JSON.stringify(after.numbering)) patch.numbering = structuredClone(after.numbering);
    return patch;
  }

  // ----- commands --------------------------------------------------------------

  private alloc(): number {
    return this.nextId++;
  }

  private find(id: number): { list: Block[]; index: number } {
    const search = (list: Block[]): { list: Block[]; index: number } | null => {
      for (let i = 0; i < list.length; i++) {
        const b = list[i]!;
        if (b.value.id === id) return { list, index: i };
        if (b.kind === "table") {
          for (const r of b.value.rows) for (const c of r.cells) {
            const f = search(c.blocks);
            if (f) return f;
          }
        }
      }
      return null;
    };
    const f = search(this.doc.body);
    if (!f) throw new Fail("unknown_block", `unknown block ${id}`);
    return f;
  }

  private para(id: number): Paragraph {
    const { list, index } = this.find(id);
    const b = list[index]!;
    if (b.kind !== "paragraph") throw new Fail("invalid_command", `block ${id} is not a paragraph`);
    return b.value;
  }

  private range(p: Paragraph, from: number, to: number) {
    const len = paragraphLength(p);
    if (from > to || to > len) throw new Fail("bad_offset", `offset ${from}..${to} out of range 0..=${len} in block ${p.id}`);
  }

  private resolveIds(b: Block, idMap: [number, number][], used: Set<number>): Block {
    const res = (id: number) => {
      if (id < 0) {
        const real = this.alloc();
        idMap.push([id, real]);
        return real;
      }
      if (used.has(id)) throw new Fail("invalid_command", `id ${id} is already in use`);
      this.nextId = Math.max(this.nextId, id + 1);
      return id;
    };
    if (b.kind === "paragraph") return { kind: "paragraph", value: { ...b.value, id: res(b.value.id) } };
    return {
      kind: "table",
      value: {
        ...b.value,
        id: res(b.value.id),
        rows: b.value.rows.map((r) => ({
          ...r,
          id: res(r.id),
          cells: r.cells.map((c) => ({ ...c, id: res(c.id), blocks: c.blocks.map((x) => this.resolveIds(x, idMap, used)) })),
        })),
      },
    };
  }

  private numberingOf(p: Paragraph) {
    const n = p.props?.numbering;
    return n && n.numId !== 0 ? n : null;
  }

  private exec(c: WriteCommand, idMap: [number, number][]): string | null {
    switch (c.type) {
      case "insertText": {
        const p = this.para(c.block);
        this.range(p, c.offset, c.offset);
        if (/[\n\r]/.test(c.text)) throw new Fail("invalid_command", "text must not contain line feeds");
        const props = c.props ?? inheritedProps(p, c.offset);
        const [a, , z] = splitInlines(p.inlines, c.offset, c.offset);
        p.inlines = [...a, { kind: "run", value: Object.keys(props).length ? { props, text: c.text } : { text: c.text } }, ...z];
        return null;
      }
      case "deleteText": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const [a, , z] = splitInlines(p.inlines, c.from, c.to);
        p.inlines = [...a, ...z];
        return null;
      }
      case "replaceText": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        const first = mid[0];
        const props = first?.kind === "run" ? (first.value.props ?? {}) : inheritedProps(p, c.from);
        const run: Inline[] = c.text ? [{ kind: "run", value: Object.keys(props).length ? { props, text: c.text } : { text: c.text } }] : [];
        p.inlines = [...a, ...run, ...z];
        return null;
      }
      case "setRunProps": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        const changed = mid.map((i): Inline => {
          if (i.kind !== "run") return i;
          const props = applyRunPatch(i.value.props, c.patch);
          return { kind: "run", value: Object.keys(props).length ? { props, text: i.value.text } : { text: i.value.text } };
        });
        p.inlines = mergeRuns([...a, ...changed, ...z]);
        return null;
      }
      case "splitParagraph": {
        const { list, index } = this.find(c.block);
        const p = this.para(c.block);
        const len = paragraphLength(p);
        this.range(p, c.offset, c.offset);
        const [a, , z] = splitInlines(p.inlines, c.offset, len);
        const props = structuredClone(p.props ?? {});
        const style = this.doc.styles.styles.find((s) => s.id === (props.style ?? "Normal"));
        if (style?.next && style.next !== style.id) {
          if (style.next === "Normal") delete props.style;
          else props.style = style.next;
        }
        const id = c.newId < 0 ? this.alloc() : c.newId;
        if (c.newId < 0) idMap.push([c.newId, id]);
        p.inlines = a;
        const np: Paragraph = { id, inlines: z };
        if (Object.keys(props).length) np.props = props;
        list.splice(index + 1, 0, { kind: "paragraph", value: np });
        return null;
      }
      case "joinWithPrevious": {
        const { list, index } = this.find(c.block);
        const cur = this.para(c.block);
        const prev = list[index - 1];
        if (index === 0 || prev?.kind !== "paragraph") throw new Fail("invalid_command", "cannot join");
        prev.value.inlines = [...prev.value.inlines, ...cur.inlines];
        list.splice(index, 1);
        return null;
      }
      case "setParagraphProps":
        for (const id of c.blocks) {
          const p = this.para(id);
          p.props = applyParagraphPatch(p.props, c.patch);
        }
        return null;
      case "setStyle":
        if (!this.doc.styles.styles.some((s) => s.id === c.style)) throw new Fail("unknown_style", `unknown paragraph style "${c.style}"`);
        for (const id of c.blocks) {
          const p = this.para(id);
          p.props = { ...(p.props ?? {}) };
          if (c.style === "Normal") delete p.props.style;
          else p.props.style = c.style;
        }
        return null;
      case "applyList": {
        const ps = c.blocks.map((id) => this.para(id));
        let target: number | null = null;
        if (c.kind !== "none") {
          const bullet = c.kind === "bullet";
          const kindOf = (numId: number) => this.doc.numbering.defs.find((d) => d.id === numId)?.levels[0]?.kind;
          const matches = (p: Paragraph | undefined) => {
            const n = p && this.numberingOf(p);
            return n && (kindOf(n.numId) === "bullet") === bullet ? n.numId : null;
          };
          const neighbour = (id: number, delta: number) => {
            const { list, index } = this.find(id);
            const b = list[index + delta];
            return b?.kind === "paragraph" ? b.value : undefined;
          };
          target =
            matches(ps[0]) ??
            matches(neighbour(c.blocks[0]!, -1)) ??
            matches(neighbour(c.blocks[c.blocks.length - 1]!, 1));
          if (target === null) {
            target = Math.max(0, ...this.doc.numbering.defs.map((d) => d.id)) + 1;
            const def: NumberingDef = numberingDef(target, bullet ? ["bullet"] : ["decimal", "lowerLetter", "lowerRoman"]);
            this.doc.numbering = { defs: [...this.doc.numbering.defs, def] };
          }
        }
        for (const p of ps) {
          const props = { ...(p.props ?? {}) };
          if (target === null) delete props.numbering;
          else props.numbering = { numId: target, level: this.numberingOf(p)?.level ?? 0 };
          p.props = props;
        }
        return null;
      }
      case "indentList":
        for (const id of c.blocks) {
          const p = this.para(id);
          const n = this.numberingOf(p);
          if (n) p.props = { ...p.props, numbering: { numId: n.numId, level: Math.max(0, Math.min(8, n.level + c.delta)) } };
        }
        return null;
      case "insertBlocks": {
        const list = c.parent == null ? this.doc.body : this.cellBlocks(c.parent);
        const at = c.after == null ? 0 : list.findIndex((b) => b.value.id === c.after) + 1;
        if (c.after != null && at === 0) throw new Fail("unknown_block", `unknown block ${c.after}`);
        const used = new Set(walkAll(this.doc.body));
        list.splice(at, 0, ...c.blocks.map((b) => this.resolveIds(b, idMap, used)));
        return null;
      }
      case "deleteBlocks":
        for (const id of c.ids) {
          const { list, index } = this.find(id);
          list.splice(index, 1);
        }
        if (!this.doc.body.length) this.doc.body.push({ kind: "paragraph", value: { id: this.alloc(), inlines: [] } });
        return null;
      case "replaceBlocks": {
        const { list, index } = this.find(c.ids[0]!);
        c.ids.forEach((id, k) => {
          if (list[index + k]?.value.id !== id) throw new Fail("invalid_command", "replaced blocks must be consecutive siblings in order");
        });
        const removed = list.splice(index, c.ids.length);
        const freed = new Set(walkAll(removed));
        const used = new Set([...walkAll(this.doc.body)].filter((x) => !freed.has(x)));
        list.splice(index, 0, ...c.blocks.map((b) => this.resolveIds(b, idMap, used)));
        if (!this.doc.body.length) this.doc.body.push({ kind: "paragraph", value: { id: this.alloc(), inlines: [] } });
        return null;
      }
      case "insertImage": {
        const p = this.para(c.block);
        this.range(p, c.offset, c.offset);
        const media = Math.max(0, ...this.doc.media.map((m) => m.id)) + 1;
        this.doc.media.push({ id: media, contentType: c.contentType, data: c.bytesBase64 });
        const [a, , z] = splitInlines(p.inlines, c.offset, c.offset);
        const img: Inline = { kind: "image", value: { media, width: c.width, height: c.height, ...(c.alt ? { alt: c.alt } : {}) } };
        p.inlines = [...a, img, ...z];
        return null;
      }
      case "insertTable": {
        const list = c.parent == null ? this.doc.body : this.cellBlocks(c.parent);
        const at = c.after == null ? 0 : list.findIndex((b) => b.value.id === c.after) + 1;
        const width = Math.floor((this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right) / c.cols);
        const table: Block = {
          kind: "table",
          value: {
            id: this.alloc(),
            props: { colWidths: Array(c.cols).fill(width) },
            rows: Array.from({ length: c.rows }, () => ({
              id: this.alloc(),
              cells: Array.from({ length: c.cols }, () => ({
                id: this.alloc(),
                blocks: [{ kind: "paragraph", value: { id: this.alloc(), inlines: [] } } as Block],
              })),
            })),
          },
        };
        list.splice(at, 0, table);
        if (at === list.length - 1) list.push({ kind: "paragraph", value: { id: this.alloc(), inlines: [] } });
        return null;
      }
      case "findReplace": {
        if (!c.find) throw new Fail("invalid_command", "nothing to find");
        let count = 0;
        const flags = c.matchCase ? "g" : "gi";
        const re = new RegExp(c.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        for (const b of walkBlocks(this.doc.body)) {
          if (b.kind !== "paragraph") continue;
          for (const i of b.value.inlines) {
            if (i.kind !== "run" || (!c.all && count > 0)) continue;
            i.value.text = i.value.text.replace(re, (m) => {
              if (!c.all && count > 0) return m;
              count++;
              return c.replace;
            });
          }
        }
        return `${count} replacement${count === 1 ? "" : "s"}`;
      }
      case "compound": {
        for (const sub of c.commands) this.exec(sub, idMap);
        return null;
      }
      case "setPage": {
        const page = this.doc.page;
        const { orientation, width, height, margins } = c.patch;
        if (orientation && orientation !== page.orientation) {
          [page.width, page.height] = [page.height, page.width];
          page.orientation = orientation;
        }
        if (width != null) page.width = width;
        if (height != null) page.height = height;
        for (const [k, v] of Object.entries(margins ?? {})) if (v != null) (page.margins as Record<string, number>)[k] = v;
        return null;
      }
      default:
        throw new Fail("invalid_command", `fake backend does not implement ${c.type}`);
    }
  }

  private cellBlocks(cellId: number): Block[] {
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "table") continue;
      for (const r of b.value.rows) for (const c of r.cells) if (c.id === cellId) return c.blocks;
    }
    throw new Fail("unknown_block", `unknown cell ${cellId}`);
  }
}

/** Every node id (blocks, rows, cells). */
function* walkAll(blocks: Block[]): Generator<number> {
  for (const b of blocks) {
    yield b.value.id;
    if (b.kind === "table") {
      for (const r of b.value.rows) {
        yield r.id;
        for (const c of r.cells) {
          yield c.id;
          yield* walkAll(c.blocks);
        }
      }
    }
  }
}
