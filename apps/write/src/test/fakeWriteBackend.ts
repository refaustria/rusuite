// In-memory Write backend for tests: implements the request kinds of
// ADR 0007 / `write_core::dispatch_with` on a JS `Document` with the same
// semantics for the commands the UI sends (char offsets in Unicode
// scalars, temporary ids → `idMap`, style `next` on split, list reuse,
// undo/redo). Patches are computed by diffing the body before and after a
// command (a changed table is reported whole).

import { base64ToBytes, bytesToBase64, type OpenedFile, type SaveResult } from "@rusuite/ui-shared";
import type { WriteBackend } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Inline } from "../generated/Inline";
import type { NumberingDef } from "../generated/NumberingDef";
import type { FindQuery } from "../generated/FindQuery";
import type { Paragraph } from "../generated/Paragraph";
import type { Run } from "../generated/Run";
import type { Request } from "../generated/Request";
import type { ResponseBody } from "../generated/ResponseBody";
import type { WriteCommand } from "../generated/WriteCommand";
import type { WritePatch } from "../generated/WritePatch";
import {
  applyParagraphPatch, applyRunPatch, blockKey, inlineLength, mergeRuns, paragraphLength, stableStringify, walkBlocks,
} from "../sync/model";
import template from "./newDocument.json";
import { newAnchor } from "../features/floating";
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

function inheritedStyle(p: Paragraph, offset: number): string | undefined {
  let pos = 0;
  let last: Inline | undefined;
  for (const i of p.inlines) {
    if (pos >= offset) break;
    if (i.kind === "run" && i.value.text) last = i;
    pos += inlineLength(i);
  }
  const r = offset > 0 && last?.kind === "run" ? last : p.inlines.find((i) => i.kind === "run");
  return r?.kind === "run" ? (r.value.style ?? undefined) : undefined;
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
  /** `"tauri"` makes the app behave as on the desktop. */
  kind: "tauri" | "wasm" = "wasm";
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
  async saveFile(): Promise<SaveResult> {
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
    return { type: "document" as const, doc: this.sendable(), envelope: this.envelope(this.emptyPatch()) };
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
        return { type: "document", doc: this.sendable(), envelope: this.envelope(this.emptyPatch()) };
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
      case "blocksWithStyle": {
        const ids: number[] = [];
        const def = this.doc.styles.styles.find((s) => (s.kind === "paragraph" || s.kind === "linked") && s.isDefault)?.id ?? "Normal";
        for (const b of walkBlocks(this.doc.body)) {
          if (b.kind !== "paragraph") continue;
          const ps = b.value.props?.style ?? def;
          if (ps === request.id || b.value.inlines.some((i) => i.kind === "run" && i.value.style === request.id)) ids.push(b.value.id);
        }
        return { type: "blockIds", ids };
      }
      case "find":
        return { type: "findMatches", matches: this.findMatches(request.query), revision: this.revision };
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
    const oldLabels = listLabels(before);
    const newLabels = listLabels(after);
    const labelsOf = (b: Block) => stableStringify([...walkBlocks([b])].map((x) => newLabels.get(x.value.id) ?? null));
    const oldLabelsOf = (b: Block) => stableStringify([...walkBlocks([b])].map((x) => oldLabels.get(x.value.id) ?? null));
    const oldIds = new Map(before.body.map((b) => [b.value.id, b]));
    const newIds = new Set(after.body.map((b) => b.value.id));
    for (const b of before.body) if (!newIds.has(b.value.id)) patch.deleted.push(b.value.id);
    after.body.forEach((b, i) => {
      const old = oldIds.get(b.value.id);
      if (!old) patch.inserted.push({ after: i > 0 ? after.body[i - 1]!.value.id : null, parent: null, block: withLabels(b, newLabels) });
      else if (blockKey(old) !== blockKey(b) || oldLabelsOf(old) !== labelsOf(b)) patch.replaced.push(withLabels(b, newLabels));
    });
    if (JSON.stringify(before.numbering) !== JSON.stringify(after.numbering)) patch.numbering = structuredClone(after.numbering);
    if (stableStringify(before.notes ?? []) !== stableStringify(after.notes ?? [])) patch.notes = structuredClone(after.notes ?? []);
    if (stableStringify(before.sections ?? []) !== stableStringify(after.sections ?? [])) patch.sections = structuredClone(after.sections ?? []);
    if (stableStringify(before.styles) !== stableStringify(after.styles)) patch.styles = structuredClone(after.styles);
    return patch;
  }

  /** The document as sent to the UI (list labels filled in). */
  private sendable(): Document {
    const labels = listLabels(this.doc);
    return { ...structuredClone(this.doc), body: this.doc.body.map((b) => withLabels(b, labels)) };
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
    const f =
      search(this.doc.body) ??
      (this.doc.notes ?? []).map((n) => search(n.blocks)).find((x) => x) ??
      null;
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
    if (b.kind === "toc") return { kind: "toc", value: { ...b.value, id: res(b.value.id) } };
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

  /** Simplified find: text (case, whole words) and direct bold / italic / style constraints. */
  private findMatches(q: FindQuery): { block: number; from: number; to: number }[] {
    const out: { block: number; from: number; to: number }[] = [];
    const f = q.format;
    const okAt = (p: Paragraph, at: number): boolean => {
      if (!f) return true;
      if (f.style && (p.props?.style ?? "Normal") !== f.style) {
        let pos = 0;
        let hit = false;
        for (const i of p.inlines) {
          const len = inlineLength(i);
          if (at >= pos && at < pos + len && i.kind === "run" && i.value.style === f.style) hit = true;
          pos += len;
        }
        if (!hit) return false;
      }
      let pos = 0;
      for (const i of p.inlines) {
        const len = inlineLength(i);
        if (at >= pos && at < pos + len) {
          const props = i.kind === "run" ? (i.value.props ?? {}) : {};
          if (f.run?.bold != null && !!props.bold !== f.run.bold) return false;
          if (f.run?.italic != null && !!props.italic !== f.run.italic) return false;
          return true;
        }
        pos += len;
      }
      return false;
    };
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      const p = b.value;
      const chars = [...p.inlines.map((i) => (i.kind === "run" ? i.value.text : "\uFFFC")).join("")];
      const pat = [...q.text];
      const eq = (a: string, c: string) => (q.matchCase ? a === c : a.toLowerCase() === c.toLowerCase());
      if (!pat.length) {
        let start = -1;
        for (let i = 0; i <= chars.length; i++) {
          const good = i < chars.length && okAt(p, i);
          if (good && start < 0) start = i;
          if (!good && start >= 0) {
            out.push({ block: p.id, from: start, to: i });
            start = -1;
          }
        }
        continue;
      }
      for (let i = 0; i + pat.length <= chars.length; ) {
        const hit = pat.every((c, k) => eq(chars[i + k]!, c)) && pat.every((_c, k) => okAt(p, i + k));
        if (hit) {
          out.push({ block: p.id, from: i, to: i + pat.length });
          i += pat.length;
        } else i++;
      }
    }
    return out;
  }

  private style(id: string) {
    const s = this.doc.styles.styles.find((x) => x.id === id);
    if (!s) throw new Fail("unknown_style", `unknown style "${id}"`);
    return s;
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
        const value: Run = Object.keys(props).length ? { props, text: c.text } : { text: c.text };
        const style = c.props ? c.style : inheritedStyle(p, c.offset);
        if (style) value.style = style;
        p.inlines = mergeRuns([...a, { kind: "run", value }, ...z]);
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
      case "applyCharacterStyle": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        let style = c.style || null;
        if (style) {
          const s = this.style(style);
          if (s.kind === "linked") style = s.link ?? s.id;
          else if (s.kind !== "character") throw new Fail("unknown_style", `not a character style "${style}"`);
        }
        const [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        const changed = mid.map((i): Inline => {
          if (i.kind !== "run") return i;
          const value = { ...i.value };
          if (style) value.style = style;
          else delete value.style;
          return { kind: "run", value };
        });
        p.inlines = mergeRuns([...a, ...changed, ...z]);
        return null;
      }
      case "addStyle":
        if (this.doc.styles.styles.some((s) => s.id === c.style.id)) throw new Fail("invalid_command", "duplicate style id");
        this.doc.styles.styles.push(structuredClone(c.style));
        return null;
      case "updateStyle": {
        const s = this.style(c.id);
        const pt = c.patch;
        if (pt.name) s.name = pt.name;
        if (pt.basedOn != null) s.basedOn = pt.basedOn || null;
        if (pt.next != null) s.next = pt.next || null;
        if (pt.run) s.run = pt.replaceFormatting ? pt.run : { ...(s.run ?? {}), ...pt.run };
        if (pt.paragraph) s.paragraph = pt.replaceFormatting ? pt.paragraph : applyParagraphPatch(s.paragraph, pt.paragraph);
        if (pt.quickFormat != null) s.quickFormat = pt.quickFormat;
        if (pt.autoRedefine != null) s.autoRedefine = pt.autoRedefine;
        return null;
      }
      case "renameStyle":
        this.style(c.id).name = c.name;
        return null;
      case "setDefaultStyle":
        for (const s of this.doc.styles.styles) if ((s.kind === "linked" ? "paragraph" : s.kind) === (c.kind === "linked" ? "paragraph" : c.kind)) s.isDefault = s.id === c.id;
        return null;
      case "deleteStyle": {
        const s = this.style(c.id);
        if (!s.custom) throw new Fail("invalid_command", "built-in styles cannot be deleted");
        this.doc.styles.styles = this.doc.styles.styles.filter((x) => x.id !== c.id);
        for (const b of walkBlocks(this.doc.body)) {
          if (b.kind !== "paragraph") continue;
          if (b.value.props?.style === c.id) {
            b.value.props = { ...b.value.props };
            if (c.replacement && c.replacement !== "Normal") b.value.props.style = c.replacement;
            else delete b.value.props.style;
          }
          for (const i of b.value.inlines) if (i.kind === "run" && i.value.style === c.id) delete i.value.style;
        }
        return null;
      }
      case "updateStyleFromSelection": {
        const s = this.style(c.id);
        const p = this.para(c.block);
        const run = p.inlines.find((i) => i.kind === "run");
        const { style: _st, numbering: _n, sectionEnd: _e, ...direct } = p.props ?? {};
        s.run = { ...(s.run ?? {}), ...(run?.kind === "run" ? (run.value.props ?? {}) : {}) };
        if (s.kind !== "character") {
          s.paragraph = applyParagraphPatch(s.paragraph, direct);
          p.props = { ...(p.props?.numbering ? { numbering: p.props.numbering } : {}), ...(c.id === "Normal" ? {} : { style: c.id }) };
        }
        for (const i of p.inlines) if (i.kind === "run") delete i.value.props;
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
      case "insertTableRow": {
        const t = this.table(c.table);
        if (c.at > t.rows.length) throw new Fail("invalid_command", `row ${c.at} out of range`);
        const model = t.rows[Math.min(Math.max(0, c.at - 1), t.rows.length - 1)]!;
        t.rows.splice(c.at, 0, {
          id: this.alloc(),
          cells: model.cells.map((m) => ({
            id: this.alloc(),
            ...(m.props ? { props: structuredClone(m.props) } : {}),
            blocks: [{ kind: "paragraph", value: { id: this.alloc(), inlines: [] } } as Block],
          })),
        });
        return null;
      }
      case "deleteTableRow": {
        const t = this.table(c.table);
        if (c.at >= t.rows.length || t.rows.length === 1) throw new Fail("invalid_command", `cannot delete row ${c.at}`);
        t.rows.splice(c.at, 1);
        return null;
      }
      case "insertTableCol": {
        const t = this.table(c.table);
        for (const r of t.rows) {
          if (c.at > r.cells.length) throw new Fail("invalid_command", `column ${c.at} out of range`);
          r.cells.splice(c.at, 0, { id: this.alloc(), blocks: [{ kind: "paragraph", value: { id: this.alloc(), inlines: [] } } as Block] });
        }
        const w = t.props?.colWidths;
        if (w?.length) w.splice(c.at, 0, w[Math.min(Math.max(0, c.at - 1), w.length - 1)]!);
        return null;
      }
      case "deleteTableCol": {
        const t = this.table(c.table);
        if (t.rows.some((r) => c.at >= r.cells.length || r.cells.length === 1)) throw new Fail("invalid_command", `cannot delete column ${c.at}`);
        for (const r of t.rows) r.cells.splice(c.at, 1);
        t.props?.colWidths?.splice(c.at, 1);
        return null;
      }
      case "setCellProps": {
        for (const id of c.cells) {
          const cell = this.cell(id);
          const props = { ...(cell.props ?? {}), ...Object.fromEntries(Object.entries(c.patch).filter(([, v]) => v != null)) };
          if (c.patch.shading?.kind === "auto") delete props.shading;
          cell.props = props;
        }
        return null;
      }
      case "setTableProps": {
        const t = this.table(c.table);
        const props = { ...(t.props ?? {}) };
        if (c.patch.colWidths?.length) props.colWidths = [...c.patch.colWidths];
        if (c.patch.borders) props.borders = { ...(props.borders ?? {}), ...c.patch.borders };
        if (c.patch.cellMargins) props.cellMargins = { ...(props.cellMargins ?? {}), ...c.patch.cellMargins };
        if (c.patch.style != null) {
          if (c.patch.style) props.style = c.patch.style;
          else delete props.style;
        }
        for (const k of ["look", "alignment", "indent", "layout"] as const) if (c.patch[k] != null) (props as Record<string, unknown>)[k] = c.patch[k];
        t.props = props;
        return null;
      }
      case "setImageAnchor":
      case "setImageWrap": {
        const p = this.para(c.block);
        const [a, mid, z] = splitInlines(p.inlines, c.offset, c.offset + 1);
        const img = mid[0];
        if (mid.length !== 1 || img?.kind !== "image") throw new Fail("invalid_command", `no image at ${c.offset}`);
        const value = { ...img.value };
        if (c.type === "setImageAnchor") {
          if (c.anchor) value.anchor = c.anchor;
          else delete value.anchor;
        } else if (value.anchor) value.anchor = { ...value.anchor, wrap: c.wrap };
        else value.anchor = newAnchor(c.wrap);
        p.inlines = [...a, { kind: "image", value }, ...z];
        return null;
      }
      case "setRowProps": {
        const t = this.table(c.table);
        for (const r of c.rows) {
          const row = t.rows[r];
          if (!row) throw new Fail("invalid_command", `row ${r} out of range`);
          const props = { ...(row.props ?? {}) };
          if (c.header != null) props.header = c.header;
          if (c.cantSplit != null) props.cantSplit = c.cantSplit;
          if (!props.cantSplit) delete props.cantSplit;
          if (c.height != null) {
            if (c.height.value > 0) props.height = c.height;
            else delete props.height;
          }
          if (!props.header) delete props.header;
          row.props = props;
        }
        return null;
      }
      case "setImageSize":
      case "setImageAlt": {
        const p = this.para(c.block);
        const [a, mid, z] = splitInlines(p.inlines, c.offset, c.offset + 1);
        const img = mid[0];
        if (mid.length !== 1 || img?.kind !== "image") throw new Fail("invalid_command", `no image at ${c.offset}`);
        const value = { ...img.value };
        if (c.type === "setImageSize") {
          value.width = c.width;
          value.height = c.height;
        } else if (c.alt) value.alt = c.alt;
        else delete value.alt;
        p.inlines = [...a, { kind: "image", value }, ...z];
        return null;
      }
      case "clearFormatting": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        const plain = mid.map((i) => (i.kind === "run" ? ({ kind: "run", value: { text: i.value.text } } as Inline) : i));
        p.inlines = mergeRuns([...a, ...plain, ...z]);
        if (c.paragraph && c.keepStyle) p.props = p.props?.style ? { style: p.props.style } : {};
        else if (c.paragraph) delete p.props;
        return null;
      }
      case "setPage": {
        const page = this.doc.page;
        const { orientation, width, height, margins } = c.patch;
        for (const k of ["headerText", "footerText"] as const) {
          const v = c.patch[k];
          if (v != null) {
            if (v) page[k] = v;
            else delete page[k];
          }
        }
        if (orientation && orientation !== page.orientation) {
          [page.width, page.height] = [page.height, page.width];
          page.orientation = orientation;
        }
        if (width != null) page.width = width;
        if (height != null) page.height = height;
        for (const [k, v] of Object.entries(margins ?? {})) if (v != null) (page.margins as Record<string, number>)[k] = v;
        return null;
      }
      case "insertField": {
        const p = this.para(c.block);
        this.range(p, c.offset, c.offset);
        const [a, , z] = splitInlines(p.inlines, c.offset, c.offset);
        p.inlines = [...a, { kind: "field", value: { kind: c.field, cached: c.cached ?? "" } }, ...z];
        return null;
      }
      case "updateFields": {
        for (const [block, offset] of c.values) {
          const [, mid] = splitInlines(this.para(block).inlines, offset, offset + 1);
          if (mid[0]?.kind !== "field") throw new Fail("invalid_command", `no field at ${offset} in block ${block}`);
        }
        for (const [block, offset, text] of c.values) {
          const [, mid] = splitInlines(this.para(block).inlines, offset, offset + 1);
          if (mid[0]?.kind === "field") mid[0].value.cached = text;
        }
        return null;
      }
      case "insertFootnote": {
        const p = this.para(c.block);
        this.range(p, c.offset, c.offset);
        if (!this.doc.body.some((b) => b.value.id === c.block)) throw new Fail("invalid_command", "notes can only be referenced from the body");
        const notes = (this.doc.notes ??= []);
        const id = Math.max(0, ...notes.map((n) => n.id)) + 1;
        const style = c.kind === "end" ? "EndnoteText" : "FootnoteText";
        notes.push({ id, kind: c.kind, blocks: [para(this.alloc(), ` ${c.text}`, style)] });
        const [a, , z] = splitInlines(p.inlines, c.offset, c.offset);
        p.inlines = [...a, { kind: "noteRef", value: { id, kind: c.kind } }, ...z];
        return null;
      }
      case "deleteFootnote": {
        const notes = this.doc.notes ?? [];
        if (!notes.some((n) => n.id === c.id)) throw new Fail("invalid_command", `unknown note ${c.id}`);
        this.doc.notes = notes.filter((n) => n.id !== c.id);
        for (const b of walkBlocks(this.doc.body)) {
          if (b.kind === "paragraph") b.value.inlines = b.value.inlines.filter((i) => !(i.kind === "noteRef" && i.value.id === c.id));
        }
        return null;
      }
      case "replaceNote": {
        const note = (this.doc.notes ?? []).find((n) => n.id === c.id);
        if (!note) throw new Fail("invalid_command", `unknown note ${c.id}`);
        const freed = new Set(walkAll(note.blocks));
        const used = new Set([...this.allIds()].filter((x) => !freed.has(x)));
        note.blocks = c.blocks.map((b) => this.resolveIds(b, idMap, used));
        if (note.blocks[note.blocks.length - 1]?.kind !== "paragraph") note.blocks.push(para(this.alloc()));
        return null;
      }
      case "insertToc": {
        const at = c.after == null ? 0 : this.doc.body.findIndex((b) => b.value.id === c.after) + 1;
        if (c.after != null && at === 0) throw new Fail("unknown_block", `unknown block ${c.after}`);
        const from = c.fromLevel ?? 1;
        const to = c.toLevel ?? 3;
        const id = c.newId != null && c.newId < 0 ? this.alloc() : (c.newId ?? this.alloc());
        if (c.newId != null && c.newId < 0) idMap.push([c.newId, id]);
        const toc: Block = { kind: "toc", value: { id, fromLevel: from, toLevel: to, entries: this.tocEntries(from, to) } };
        if (c.title) (toc.value as { title?: string }).title = c.title;
        this.doc.body.splice(at, 0, toc);
        return null;
      }
      case "updateToc": {
        const b = this.doc.body.find((x) => x.value.id === c.id);
        if (b?.kind !== "toc") throw new Fail("invalid_command", `block ${c.id} is not a table of contents`);
        const pages = new Map(c.pages ?? []);
        b.value.entries = this.tocEntries(b.value.fromLevel, b.value.toLevel).map((e) => (pages.has(e.target) ? { ...e, page: pages.get(e.target)! } : e));
        return null;
      }
      case "restoreNumbering":
        this.doc.numbering = structuredClone(c.numbering);
        return null;
      case "restartList":
      case "continueList": {
        const p = this.para(c.block);
        const n = this.numberingOf(p);
        if (!n) throw new Fail("invalid_command", `block ${c.block} is not numbered`);
        const def = this.doc.numbering.defs.find((d) => d.id === n.numId)!;
        const tail = this.doc.body.slice(this.doc.body.findIndex((b) => b.value.id === c.block)).filter(
          (b): b is Extract<Block, { kind: "paragraph" }> => b.kind === "paragraph" && b.value.props?.numbering?.numId === n.numId,
        );
        let target: number;
        if (c.type === "restartList") {
          target = Math.max(0, ...this.doc.numbering.defs.map((d) => d.id)) + 1;
          this.doc.numbering = { ...this.doc.numbering, defs: [...this.doc.numbering.defs, { ...structuredClone(def), id: target }] };
        } else {
          const idx = this.doc.body.findIndex((b) => b.value.id === c.block);
          const prev = this.doc.body
            .slice(0, idx)
            .reverse()
            .find((b) => b.kind === "paragraph" && b.value.props?.numbering && b.value.props.numbering.numId !== n.numId && b.value.props.numbering.numId !== 0);
          if (!prev || prev.kind !== "paragraph") throw new Fail("invalid_command", "no previous list");
          target = prev.value.props!.numbering!.numId;
        }
        for (const b of tail) b.value.props = { ...b.value.props, numbering: { numId: target, level: b.value.props!.numbering!.level } };
        return null;
      }
      case "insertSectionBreak": {
        const p = this.para(c.block);
        if (!this.doc.body.some((b) => b.value.id === c.block)) throw new Fail("invalid_command", "not a body paragraph");
        const sections = (this.doc.sections ??= [{ id: 1, page: structuredClone(this.doc.page), kind: "nextPage", columns: 1, titlePage: false }]);
        const idx = this.doc.body.findIndex((b) => b.value.id === c.block);
        // The section holding the paragraph: the first section whose end is at or after it.
        const endIdx = (s: { id: number }) => this.doc.body.findIndex((b) => b.kind === "paragraph" && b.value.props?.sectionEnd === s.id);
        let k = sections.findIndex((s) => {
          const e = endIdx(s);
          return e < 0 || e >= idx;
        });
        if (k < 0) k = sections.length - 1;
        const cur = sections[k]!;
        const id = Math.max(...sections.map((s) => s.id)) + 1;
        // The new section ends at `block` (keeping the headers); the old one keeps its end, starts `kind` and inherits them.
        sections.splice(k, 0, { ...structuredClone(cur), id });
        delete cur.headers;
        delete cur.footers;
        cur.kind = c.kind;
        p.props = { ...(p.props ?? {}), sectionEnd: id };
        return null;
      }
      case "setSection": {
        const sec = (this.doc.sections ?? []).find((x) => x.id === c.section);
        if (!sec) throw new Fail("invalid_command", `unknown section ${c.section}`);
        const { page, ...rest } = c.patch;
        for (const [k, v] of Object.entries(rest)) if (v != null) (sec as Record<string, unknown>)[k] = v;
        if (c.patch.pageNumberStart === 0) delete sec.pageNumberStart;
        if (page) {
          if (page.orientation && page.orientation !== sec.page.orientation) {
            [sec.page.width, sec.page.height] = [sec.page.height, sec.page.width];
            sec.page.orientation = page.orientation;
          }
          if (page.width != null) sec.page.width = page.width;
          if (page.height != null) sec.page.height = page.height;
          for (const [k, v] of Object.entries(page.margins ?? {})) if (v != null) (sec.page.margins as Record<string, number>)[k] = v;
          const last = this.doc.sections![this.doc.sections!.length - 1]!;
          if (last === sec) this.doc.page = { ...this.doc.page, width: sec.page.width, height: sec.page.height, orientation: sec.page.orientation, margins: { ...sec.page.margins } };
        }
        return null;
      }
      case "setHeaderFooter": {
        const sec = (this.doc.sections ?? []).find((x) => x.id === c.section);
        if (!sec) throw new Fail("invalid_command", `unknown section ${c.section}`);
        const key = c.footer ? "footers" : "headers";
        const set = { ...(sec[key] ?? {}) };
        if (c.blocks) set[c.slot] = c.blocks.map((b) => this.resolveIds(b, idMap, new Set(this.allIds())));
        else delete set[c.slot];
        sec[key] = set;
        return null;
      }
      default:
        throw new Fail("invalid_command", `fake backend does not implement ${c.type}`);
    }
  }

  /** Every id in use (body, notes, headers and footers). */
  private *allIds(): Generator<number> {
    yield* walkAll(this.doc.body);
    for (const n of this.doc.notes ?? []) yield* walkAll(n.blocks);
    for (const sec of this.doc.sections ?? []) {
      for (const set of [sec.headers, sec.footers]) for (const blocks of Object.values(set ?? {})) yield* walkAll(blocks ?? []);
    }
  }

  /** Headings `from..=to` of the body as TOC entries. */
  private tocEntries(from: number, to: number) {
    const out: { text: string; level: number; target: number }[] = [];
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      const m = /^Heading([1-9])$/.exec(b.value.props?.style ?? "");
      const level = m ? Number(m[1]) : 0;
      const text = b.value.inlines.map((i) => (i.kind === "run" ? i.value.text : "")).join("").trim();
      if (level >= from && level <= to && text) out.push({ text, level, target: b.value.id });
    }
    return out;
  }

  private table(id: number): Extract<Block, { kind: "table" }>["value"] {
    for (const b of walkBlocks(this.doc.body)) if (b.kind === "table" && b.value.id === id) return b.value;
    throw new Fail("unknown_block", `unknown table ${id}`);
  }

  private cell(id: number) {
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "table") continue;
      for (const r of b.value.rows) for (const c of r.cells) if (c.id === id) return c;
    }
    throw new Fail("unknown_block", `unknown cell ${id}`);
  }

  private cellBlocks(cellId: number): Block[] {
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "table") continue;
      for (const r of b.value.rows) for (const c of r.cells) if (c.id === cellId) return c.blocks;
    }
    throw new Fail("unknown_block", `unknown cell ${cellId}`);
  }
}

const para = (id: number, text = "", style?: string): Block => ({
  kind: "paragraph",
  value: { id, ...(style ? { props: { style } } : {}), inlines: text ? [{ kind: "run", value: { text } }] : [] },
});

function formatNumber(n: number, kind: string): string {
  const roman = (x: number) => {
    const t: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let out = "";
    for (const [v, s] of t) while (x >= v) ((out += s), (x -= v));
    return out;
  };
  const letter = (x: number) => String.fromCharCode(97 + ((x - 1) % 26)).repeat(Math.floor((x - 1) / 26) + 1);
  switch (kind) {
    case "lowerRoman": return roman(n);
    case "upperRoman": return roman(n).toUpperCase();
    case "lowerLetter": return letter(n);
    case "upperLetter": return letter(n).toUpperCase();
    case "bullet":
    case "none": return "";
    default: return String(n);
  }
}

/** List labels like `Document::list_numbers` (direct numbering only, default restarts). */
export function listLabels(doc: Document): Map<number, string> {
  const out = new Map<number, string>();
  const counters = new Map<number, number[]>();
  for (const b of walkBlocks(doc.body)) {
    if (b.kind !== "paragraph") continue;
    const n = b.value.props?.numbering;
    if (!n || n.numId === 0) continue;
    const def = doc.numbering.defs.find((d) => d.id === n.numId);
    const level = def?.levels[n.level];
    if (!def || !level) continue;
    const c = counters.get(n.numId) ?? Array(9).fill(0);
    c[n.level] = c[n.level] === 0 ? level.start : c[n.level] + 1;
    for (let k = n.level + 1; k < 9; k++) c[k] = 0;
    counters.set(n.numId, c);
    if (level.kind === "bullet") {
      out.set(b.value.id, level.text);
      continue;
    }
    out.set(
      b.value.id,
      level.text.replace(/%([1-9])/g, (_m, d: string) => {
        const k = Number(d) - 1;
        const lv = def.levels[k];
        const v = c[k] || lv?.start || 1;
        return formatNumber(v, level.legal ? "decimal" : (lv?.kind ?? "decimal"));
      }),
    );
  }
  return out;
}

function withLabels(b: Block, labels: Map<number, string>): Block {
  const copy = structuredClone(b);
  for (const x of walkBlocks([copy])) {
    if (x.kind !== "paragraph") continue;
    const l = labels.get(x.value.id);
    if (l != null) x.value.listLabel = l;
    else delete x.value.listLabel;
  }
  return copy;
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
