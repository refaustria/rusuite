// In-memory Write backend for tests: implements the request kinds of
// ADR 0007 / `write_core::dispatch_with` on a JS `Document` with the same
// semantics for the commands the UI sends (char offsets in Unicode
// scalars, temporary ids → `idMap`, style `next` on split, list reuse,
// undo/redo). Patches are computed by diffing the body before and after a
// command (a changed table is reported whole).

import { base64ToBytes, bytesToBase64, type OpenedFile, type SaveResult } from "@rusuite/ui-shared";
import type { WriteBackend } from "../backend";
import type { Block } from "../generated/Block";
import type { Comment } from "../generated/Comment";
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
import type { ReaderWarning } from "../generated/ReaderWarning";
import { newAnchor } from "../features/floating";
import { numberingDef } from "./fixtures";
import { caseChar } from "../features/changeCase";
import { MULTILEVEL_PRESETS, PRESET_FORMATS } from "../features/listGallery";
import type { Level } from "../generated/Level";
import type { ListPreset } from "../generated/ListPreset";

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

const markerOf = (i: Inline): { id: number; start: boolean } | null =>
  i.kind === "commentStart" ? { id: i.value.id, start: true } : i.kind === "commentEnd" ? { id: i.value.id, start: false } : null;

/** A comment or bookmark marker: `"c:id"` / `"b:id"` and whether it is a start. */
const rangeMarkerOf = (i: Inline): { key: string; start: boolean } | null => {
  const c = markerOf(i);
  if (c) return { key: `c:${c.id}`, start: c.start };
  if (i.kind === "bookmarkStart") return { key: `b:${i.value.id}`, start: true };
  if (i.kind === "bookmarkEnd") return { key: `b:${i.value.id}`, start: false };
  return null;
};

/** `write_core`'s `replace_keeping_markers`: lone comment and bookmark markers of `mid` stay (ends before `fresh`, starts after it). */
export function keepMarkers(mid: Inline[], fresh: Inline[]): Inline[] {
  const ms = mid.map(rangeMarkerOf).filter((m): m is { key: string; start: boolean } => !!m);
  const starts = new Set(ms.filter((m) => m.start).map((m) => m.key));
  const ends = new Set(ms.filter((m) => !m.start).map((m) => m.key));
  const keptEnds = mid.filter((i) => {
    const m = rangeMarkerOf(i);
    return m && !m.start && !starts.has(m.key);
  });
  const keptStarts = mid.filter((i) => {
    const m = rangeMarkerOf(i);
    return m && m.start && !ends.has(m.key);
  });
  return [...keptEnds, ...fresh, ...keptStarts];
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
  /** `setUser`. */
  user: { name: string; initials: string } | null = null;
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
        return { type: "opened", doc: r.doc, warnings: structuredClone(this.openWarnings), envelope: r.envelope };
      }
      case "saveDocx": {
        if (request.modified || request.user || request.pages != null) {
          const p = { ...(this.doc.properties ?? {}) };
          if (request.modified) {
            p.modified = request.modified;
            p.created ??= request.modified;
          }
          if (request.user) {
            p.lastModifiedBy = request.user;
            p.author ??= request.user;
          }
          if (request.pages != null) p.pages = request.pages;
          p.revision = (p.revision ?? 0) + 1;
          this.doc.properties = p;
        }
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
      case "setUser": {
        const n = request.name.trim();
        const ini = request.initials?.trim() || initialsOf(n);
        this.user = n ? { name: n, initials: ini } : null;
        return { type: "documentState", dirty: this.revision !== this.savedRevision, revision: this.revision, name: this.name };
      }
      case "shapePaths":
        return {
          type: "shapePaths",
          shapes: request.queries.map((q) => ({
            paths: [
              {
                d: q.preset === "ellipse"
                  ? `M0 ${q.h / 2} C0 0 ${q.w} 0 ${q.w} ${q.h / 2} C${q.w} ${q.h} 0 ${q.h} 0 ${q.h / 2} Z`
                  : `M0 0 L${q.w} 0 L${q.w} ${q.h} L0 ${q.h} Z`,
                fill: true,
                stroke: true,
              },
            ],
            defaults: (q.preset === "roundRect" ? { adj: 16667 } : {}) as Record<string, number>,
          })),
        };
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
          this.fixComments();
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
    if (stableStringify(before.comments ?? []) !== stableStringify(after.comments ?? [])) patch.comments = structuredClone(after.comments ?? []);
    if (stableStringify(before.properties ?? {}) !== stableStringify(after.properties ?? {})) patch.properties = structuredClone(after.properties ?? {});
    if (stableStringify(before.settings ?? {}) !== stableStringify(after.settings ?? {})) patch.settings = structuredClone(after.settings ?? {});
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
        if (b.kind === "paragraph") {
          for (const inl of b.value.inlines) {
            if (inl.kind !== "drawing" || !inl.value.text) continue;
            const f = search(inl.value.text.blocks);
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

  /** What `openDocx` reports (tests set real reader codes). */
  openWarnings: ReaderWarning[] = [{ code: "fake.json", params: {}, text: "fake reader: JSON instead of docx", count: 1 }];

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
        if (c.link) value.link = c.link;
        p.inlines = mergeRuns([...a, { kind: "run", value }, ...z]);
        return null;
      }
      case "deleteText": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        p.inlines = [...a, ...keepMarkers(mid, []), ...z];
        return null;
      }
      case "replaceText": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        const first = mid[0];
        const props = first?.kind === "run" ? (first.value.props ?? {}) : inheritedProps(p, c.from);
        const run: Inline[] = c.text ? [{ kind: "run", value: Object.keys(props).length ? { props, text: c.text } : { text: c.text } }] : [];
        p.inlines = [...a, ...keepMarkers(mid, run), ...z];
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
        // Word (W-03): Normal paragraphs that become list items get List Paragraph.
        const listStyle = true;
        for (const p of ps) {
          const props = { ...(p.props ?? {}) };
          if (target === null) delete props.numbering;
          else {
            if (listStyle && !this.numberingOf(p) && (!props.style || props.style === "Normal")) props.style = "ListParagraph";
            props.numbering = { numId: target, level: this.numberingOf(p)?.level ?? 0 };
          }
          p.props = props;
        }
        return null;
      }
      case "listBackspace": {
        const p = this.para(c.block);
        const n = this.numberingOf(p);
        if (!n) throw new Fail("invalid_command", "not a list item");
        const level = this.doc.numbering.defs.find((d) => d.id === n.numId)?.levels[n.level];
        const left = p.props?.indent?.left ?? level?.indent?.left ?? 0;
        const props = { ...(p.props ?? {}) };
        delete props.numbering;
        props.indent = { ...(props.indent ?? {}), left, firstLine: 0, hanging: undefined };
        delete props.indent.hanging;
        p.props = props;
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
      case "addStyle": {
        if (this.doc.styles.styles.some((s) => s.id === c.style.id)) throw new Fail("invalid_command", "duplicate style id");
        const st = structuredClone(c.style);
        this.doc.styles.styles.push(st);
        // A linked style gets its character half (Rust's AddStyle).
        if (st.kind === "linked") {
          const charId = st.link ?? `${st.id}Char`;
          st.link = charId;
          if (!this.doc.styles.styles.some((s) => s.id === charId)) {
            this.doc.styles.styles.push({ id: charId, name: `${st.name} Char`, kind: "character", link: st.id, custom: true, basedOn: "DefaultParagraphFont", ...(st.run ? { run: structuredClone(st.run) } : {}) } as never);
          }
        }
        return null;
      }
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
          // Grid column `at`; a cell spanning across it grows (Word).
          let start = 0;
          let index = r.cells.length;
          let grow: number | null = null;
          for (let i = 0; i < r.cells.length; i++) {
            const span = Math.max(1, r.cells[i]!.gridSpan ?? 1);
            if (start === c.at) {
              index = i;
              break;
            }
            if (start < c.at && c.at < start + span) {
              grow = i;
              break;
            }
            start += span;
          }
          if (grow == null && index === r.cells.length && start < c.at) throw new Fail("invalid_command", `column ${c.at} out of range`);
          if (grow != null) r.cells[grow]!.gridSpan = Math.max(1, r.cells[grow]!.gridSpan ?? 1) + 1;
          else r.cells.splice(index, 0, { id: this.alloc(), blocks: [{ kind: "paragraph", value: { id: this.alloc(), inlines: [] } } as Block] });
        }
        const w = t.props?.colWidths;
        if (w?.length) w.splice(c.at, 0, w[Math.min(Math.max(0, c.at - 1), w.length - 1)]!);
        return null;
      }
      case "deleteTableCol": {
        const t = this.table(c.table);
        const cols = Math.max(...t.rows.map((r) => r.cells.reduce((n, x) => n + Math.max(1, x.gridSpan ?? 1), 0)));
        if (c.at >= cols || cols <= 1) throw new Fail("invalid_command", `cannot delete column ${c.at}`);
        for (const r of t.rows) {
          let start = 0;
          for (let i = 0; i < r.cells.length; i++) {
            const span = Math.max(1, r.cells[i]!.gridSpan ?? 1);
            if (c.at >= start && c.at < start + span) {
              if (span > 1) r.cells[i]!.gridSpan = span - 1;
              else r.cells.splice(i, 1);
              break;
            }
            start += span;
          }
        }
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
        if (c.refresh) {
          // Sequence numbers in document order (the rest stays: the fake does not compute references).
          const counters = new Map<string, number>();
          for (const b of walkBlocks(this.doc.body)) {
            if (b.kind !== "paragraph") continue;
            for (const i of b.value.inlines) {
              if (i.kind !== "field" || i.value.kind.kind !== "seq") continue;
              const k = i.value.kind.value.identifier.toLowerCase();
              counters.set(k, (counters.get(k) ?? 0) + 1);
              i.value.cached = String(counters.get(k));
            }
          }
          for (const sec of [this.doc]) {
            for (const b of walkBlocks(sec.body)) {
              if (b.kind !== "paragraph") continue;
              for (const i of b.value.inlines) {
                if (i.kind !== "field") continue;
                const k = i.value.kind;
                if (k.kind === "title" && this.doc.properties?.title) i.value.cached = this.doc.properties.title;
                if (k.kind === "pageRef") {
                  const start = this.bookmarkStart(k.value.bookmark);
                  const page = start == null ? undefined : c.refresh.pages.find(([id]) => id === start)?.[1];
                  if (page != null) i.value.cached = String(page);
                }
              }
            }
          }
        }
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
      case "setHyperlink":
      case "removeHyperlink": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const link = c.type === "setHyperlink" ? c.link : null;
        let [a, mid, z] = splitInlines(p.inlines, c.from, c.to);
        if (c.type === "setHyperlink" && c.text) {
          const first = mid.find((i) => i.kind === "run");
          mid = [{ kind: "run", value: { ...(first?.kind === "run" ? first.value : {}), text: c.text } }];
        }
        if (c.type === "setHyperlink" && !mid.length) throw new Fail("invalid_command", "nothing to link");
        mid = mid.map((i) => {
          if (i.kind !== "run") return i;
          const v: Run = { ...i.value };
          if (link) {
            v.link = link;
            v.style ??= "Hyperlink";
          } else {
            delete v.link;
            if (v.style === "Hyperlink") delete v.style;
          }
          return { kind: "run", value: v };
        });
        p.inlines = mergeRuns([...a, ...mid, ...z]);
        return null;
      }
      case "addBookmark": {
        if (!/^[\p{L}_][\p{L}\p{N}_]{0,39}$/u.test(c.name)) throw new Fail("invalid_command", `invalid bookmark name "${c.name}"`);
        this.removeBookmark(c.name);
        const id = this.nextBookmarkId();
        const e = this.para(c.end.block);
        const [ea, , ez] = splitInlines(e.inlines, c.end.offset, c.end.offset);
        e.inlines = [...ea, { kind: "bookmarkEnd", value: { id } }, ...ez];
        const sp = this.para(c.start.block);
        const [sa, , sz] = splitInlines(sp.inlines, c.start.offset, c.start.offset);
        sp.inlines = [...sa, { kind: "bookmarkStart", value: { id, name: c.name } }, ...sz];
        return null;
      }
      case "deleteBookmark":
        if (!this.removeBookmark(c.name)) throw new Fail("invalid_command", `no bookmark "${c.name}"`);
        return null;
      case "insertCrossReference": {
        const p = this.para(c.block);
        this.range(p, c.offset, c.offset);
        let name: string;
        if (c.target.kind === "bookmark") name = c.target.value;
        else if (c.target.kind === "paragraph" || c.target.kind === "captionLabel") {
          const t = this.para(c.target.value);
          name = `_Ref${String(100000000 + this.nextBookmarkId()).padStart(9, "0")}`;
          const id = this.nextBookmarkId();
          t.inlines = [{ kind: "bookmarkStart", value: { id, name } }, ...t.inlines, { kind: "bookmarkEnd", value: { id } }];
        } else throw new Fail("invalid_command", "fake: notes are not supported");
        const kind =
          c.show === "page" ? ({ kind: "pageRef", value: { bookmark: name, hyperlink: c.hyperlink } } as const) : ({ kind: "ref", value: { bookmark: name, hyperlink: c.hyperlink } } as const);
        const target = this.bookmarkText(name);
        const cached = c.show === "page" ? String(c.page ?? 1) : target;
        const shift = c.target.kind !== "bookmark" && c.target.value === c.block ? 1 : 0;
        const [a, , z] = splitInlines(p.inlines, c.offset + shift, c.offset + shift);
        p.inlines = [...a, { kind: "field", value: { kind, cached } }, ...z];
        return null;
      }
      case "insertCaption": {
        const { list, index } = this.find(c.anchor);
        const id = c.newId != null && c.newId < 0 ? this.alloc() : (c.newId ?? this.alloc());
        if (c.newId != null && c.newId < 0) idMap.push([c.newId, id]);
        const identifier = c.label.trim().replace(/\s+/g, "_");
        const inlines: Inline[] = [
          { kind: "run", value: { text: `${c.label.trim()} ` } },
          { kind: "field", value: { kind: { kind: "seq", value: { identifier } }, cached: "1" } },
        ];
        if (c.text) inlines.push({ kind: "run", value: { text: c.text } });
        list.splice(index + (c.below ? 1 : 0), 0, { kind: "paragraph", value: { id, props: { style: "Caption" }, inlines } });
        this.exec({ type: "updateFields", values: [], refresh: { pages: [] } }, idMap);
        return null;
      }
      case "setProperties": {
        const props = { ...(this.doc.properties ?? {}) } as Record<string, unknown>;
        for (const [k, v] of Object.entries(c.patch)) {
          if (v == null) continue;
          if (typeof v === "string" && !v.trim()) delete props[k];
          else props[k] = v;
        }
        this.doc.properties = props;
        return null;
      }
      case "restoreProperties":
        this.doc.properties = structuredClone(c.properties);
        return null;
      case "setSettings":
        this.doc.settings = structuredClone(c.settings);
        return null;
      case "insertToc": {
        const at = c.after == null ? 0 : this.doc.body.findIndex((b) => b.value.id === c.after) + 1;
        if (c.after != null && at === 0) throw new Fail("unknown_block", `unknown block ${c.after}`);
        const from = c.fromLevel ?? 1;
        const to = c.toLevel ?? 3;
        const id = c.newId != null && c.newId < 0 ? this.alloc() : (c.newId ?? this.alloc());
        if (c.newId != null && c.newId < 0) idMap.push([c.newId, id]);
        const toc: Block = { kind: "toc", value: { id, fromLevel: from, toLevel: to, entries: c.caption ? this.captionEntries(c.caption) : this.tocEntries(from, to) } };
        if (c.title) (toc.value as { title?: string }).title = c.title;
        if (c.caption) (toc.value as { caption?: string }).caption = c.caption;
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
        const sections = (this.doc.sections ??= [{ id: 1, page: structuredClone(this.doc.page), kind: "nextPage", titlePage: false }]);
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
      case "addComment": {
        const sp = this.para(c.start.block);
        const ep = this.para(c.end.block);
        this.range(sp, c.start.offset, c.start.offset);
        this.range(ep, c.end.offset, c.end.offset);
        const order = [...walkBlocks(this.doc.body)].filter((b) => b.kind === "paragraph").map((b) => b.value.id);
        const key = (b: number, o: number) => order.indexOf(b) * 1e6 + o;
        if (order.indexOf(c.start.block) < 0 || order.indexOf(c.end.block) < 0) throw new Fail("invalid_command", "comments can only be added to the body");
        if (key(c.start.block, c.start.offset) > key(c.end.block, c.end.offset)) throw new Fail("invalid_command", "the comment's start is after its end");
        const comments = (this.doc.comments ??= []);
        const id = Math.max(0, ...comments.map((x) => x.id)) + 1;
        const insert = (p: Paragraph, at: number, inline: Inline) => {
          const [a, , z] = splitInlines(p.inlines, at, at);
          p.inlines = [...a, inline, ...z];
        };
        insert(ep, c.end.offset, { kind: "commentEnd", value: { id } });
        insert(sp, c.start.offset, { kind: "commentStart", value: { id } });
        comments.push(this.newComment(id, c.text, c.author, c.initials, c.date));
        return null;
      }
      case "replyComment": {
        const parent = this.comment(c.parent);
        const root = parent.parent ?? parent.id;
        const comments = this.doc.comments!;
        const id = Math.max(0, ...comments.map((x) => x.id)) + 1;
        const reply = this.newComment(id, c.text, c.author, c.initials, c.date);
        reply.parent = root;
        if (this.comment(root).resolved) reply.resolved = true;
        const last = comments.map((x) => x.id === root || x.parent === root).lastIndexOf(true);
        comments.splice(last + 1, 0, reply);
        return null;
      }
      case "editComment": {
        const cm = this.comment(c.id);
        cm.content = c.text.split("\n").map((line) => para(this.alloc(), line, "CommentText"));
        return null;
      }
      case "deleteComment": {
        const cm = this.comment(c.id);
        if (cm.parent != null) this.doc.comments = this.doc.comments!.filter((x) => x.id !== c.id);
        else this.deleteThreads([cm.id]);
        return null;
      }
      case "deleteAllComments": {
        const roots = (this.doc.comments ?? []).filter((x) => x.parent == null && (!c.resolvedOnly || x.resolved)).map((x) => x.id);
        this.deleteThreads(roots);
        return null;
      }
      case "resolveComment":
      case "reopenComment": {
        const cm = this.comment(c.id);
        const root = cm.parent ?? cm.id;
        for (const x of this.doc.comments!) {
          if (x.id !== root && x.parent !== root) continue;
          if (c.type === "resolveComment") x.resolved = true;
          else delete x.resolved;
        }
        return null;
      }
      case "insertDrawing": {
        const p = this.para(c.block);
        this.range(p, c.offset, c.offset);
        const [a, , z] = splitInlines(p.inlines, c.offset, c.offset);
        const id = this.alloc();
        const para: Paragraph = { id: this.alloc(), inlines: c.text ? [{ kind: "run", value: { text: c.text } }] : [] };
        const theme = (slot: string, tint = 0) => ({ kind: "theme", value: { slot, tint } }) as never;
        const d: Extract<Inline, { kind: "drawing" }>["value"] =
          c.kind === "textBox"
            ? {
                id, kind: "textBox", width: c.width, height: c.height, preset: "rect",
                fill: { kind: "solid", value: { kind: "rgb", value: "FFFFFF" } }, line: { fill: { kind: "solid", value: { kind: "rgb", value: "000000" } }, width: 9525 },
                text: { blocks: [{ kind: "paragraph", value: para }] },
              }
            : {
                id, width: c.width, height: c.height, preset: c.preset,
                fill: { kind: "solid", value: theme("accent1") }, line: { fill: { kind: "solid", value: theme("accent1", -0.5) }, width: 12700 },
                textColor: theme("light1"),
                text: { blocks: [{ kind: "paragraph", value: { ...para, props: { alignment: "center" } } }], verticalAlign: "center" },
              };
        if (c.anchor) d.anchor = c.anchor;
        p.inlines = [...a, { kind: "drawing", value: d }, ...z];
        return null;
      }
      case "setDrawingProps":
      case "setDrawingText": {
        const p = this.para(c.block);
        const [a, mid, z] = splitInlines(p.inlines, c.offset, c.offset + 1);
        const cur = mid[0];
        if (mid.length !== 1 || cur?.kind !== "drawing") throw new Fail("invalid_command", `no drawing at ${c.offset}`);
        let d = structuredClone(cur.value);
        if (c.type === "setDrawingProps") {
          const old = d;
          d = { ...structuredClone(c.drawing), id: old.id };
          if (!c.drawing.text) delete d.text;
          else d.text = { ...c.drawing.text, blocks: old.text ? old.text.blocks : [{ kind: "paragraph", value: { id: this.alloc(), inlines: [] } }] };
        } else if (c.blocks == null) {
          if (d.kind === "textBox") throw new Fail("invalid_command", "a text box keeps its text");
          delete d.text;
        } else {
          const used = new Set([...this.allIds()]);
          for (const b of walkBlocks(d.text?.blocks ?? [])) used.delete(b.value.id);
          const blocks = c.blocks.map((b) => this.resolveIds(b, idMap, used));
          d.text = { ...(d.text ?? { verticalAlign: "center" }), blocks };
        }
        p.inlines = [...a, { kind: "drawing", value: d }, ...z];
        return null;
      }
      case "setImageFormat":
      case "setImageLink": {
        const p = this.para(c.block);
        const [a, mid, z] = splitInlines(p.inlines, c.offset, c.offset + 1);
        const img = mid[0];
        if (mid.length !== 1 || img?.kind !== "image") throw new Fail("invalid_command", `no image at ${c.offset}`);
        const value = { ...img.value };
        if (c.type === "setImageFormat") {
          if (Object.keys(c.format).length) value.format = c.format;
          else delete value.format;
        } else if (c.link) value.link = c.link;
        else delete value.link;
        p.inlines = [...a, { kind: "image", value }, ...z];
        return null;
      }
      case "changeCase": {
        const p = this.para(c.block);
        this.range(p, c.from, c.to);
        const chars = [...p.inlines.map((i) => (i.kind === "run" ? i.value.text : "\uFFFC")).join("")];
        let pos = 0;
        p.inlines = p.inlines.map((i) => {
          if (i.kind !== "run") {
            pos++;
            return i;
          }
          const text = [...i.value.text].map((ch) => {
            const out = pos >= c.from && pos < c.to ? caseChar(chars, pos, c.case) : ch;
            pos++;
            return out;
          }).join("");
          return { kind: "run", value: { ...i.value, text } };
        });
        return null;
      }
      case "applyNumbering": {
        if (!c.items.length) throw new Fail("invalid_command", "no paragraphs");
        const [first, at] = c.items[0]!;
        let levels: Level[];
        if (c.levels?.length) levels = c.levels;
        else if (c.preset && fakeMultilevel(c.preset)) levels = fakeMultilevel(c.preset)!;
        else {
          const format = c.format ?? (c.preset ? fakeFormat(c.preset, at) : null);
          if (!format) throw new Fail("invalid_command", "no levels, preset or format");
          const cur = this.numberingOf(this.para(first));
          const base = cur ? this.doc.numbering.defs.find((d) => d.id === cur.numId)?.levels : null;
          levels = structuredClone(base ?? numberingDef(0, format.kind === "bullet" ? ["bullet"] : ["decimal", "lowerLetter", "lowerRoman"]).levels);
          levels[at] = { ...format, indent: format.indent ?? levels[at]?.indent ?? null };
        }
        const numId = Math.max(0, ...this.doc.numbering.defs.map((d) => d.id)) + 1;
        this.doc.numbering.defs.push({ id: numId, levels });
        const linked = new Map<number, string>();
        levels.forEach((l, i) => {
          const st = l.style ? this.doc.styles.styles.find((x) => x.id === l.style) : null;
          if (st) {
            linked.set(i, st.id);
            st.paragraph = { ...(st.paragraph ?? {}), numbering: { numId, level: i } };
          }
        });
        const linkedStyles = new Set(linked.values());
        for (const [id, level] of c.items) {
          const p = this.para(id);
          const style = p.props?.style ?? null;
          if ((style && linkedStyles.has(style)) || linked.has(level)) {
            const { numbering: _n, ...rest } = p.props ?? {};
            p.props = { ...rest, style: style && linkedStyles.has(style) ? style : linked.get(level)! };
            continue;
          }
          p.props = { ...(p.props ?? {}), numbering: { numId, level } };
        }
        return null;
      }
      default:
        throw new Fail("invalid_command", `fake backend does not implement ${c.type}`);
    }
  }

  private comment(id: number): Comment {
    const c = (this.doc.comments ?? []).find((x) => x.id === id);
    if (!c) throw new Fail("invalid_command", `unknown comment ${id}`);
    return c;
  }

  private newComment(id: number, text: string, author?: string, initials?: string, date?: string): Comment {
    const name = author?.trim() || this.user?.name || "Author";
    const ini = initials?.trim() || (this.user && this.user.name === name ? this.user.initials : initialsOf(name));
    const c: Comment = { id, author: name, content: text.split("\n").map((line) => para(this.alloc(), line, "CommentText")) };
    if (ini) c.initials = ini;
    if (date) c.date = date;
    return c;
  }

  private deleteThreads(roots: number[]): void {
    const doomed = new Set(roots);
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind === "paragraph") b.value.inlines = b.value.inlines.filter((i) => !(markerOf(i) && doomed.has(markerOf(i)!.id)));
    }
    this.doc.comments = (this.doc.comments ?? []).filter((x) => !doomed.has(x.parent ?? x.id));
  }

  /** `Document::fix_comments`, simplified: threads without markers go, markers of unknown comments go. */
  private fixComments(): void {
    const comments = this.doc.comments ?? [];
    if (!comments.length) return;
    const roots = new Set(comments.filter((x) => x.parent == null).map((x) => x.id));
    const anchored = new Set<number>();
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      b.value.inlines = b.value.inlines.filter((i) => {
        const m = markerOf(i);
        if (!m) return true;
        if (!roots.has(m.id)) return false;
        anchored.add(m.id);
        return true;
      });
    }
    this.doc.comments = comments.filter((x) => anchored.has(x.parent ?? x.id));
  }

  /** Every id in use (body, notes, headers and footers). */
  private *allIds(): Generator<number> {
    yield* walkAll(this.doc.body);
    for (const n of this.doc.notes ?? []) yield* walkAll(n.blocks);
    for (const sec of this.doc.sections ?? []) {
      for (const set of [sec.headers, sec.footers]) for (const blocks of Object.values(set ?? {})) yield* walkAll(blocks ?? []);
    }
  }

  /** Bookmark `name`'s start paragraph. */
  private bookmarkStart(name: string): number | null {
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      if (b.value.inlines.some((i) => i.kind === "bookmarkStart" && i.value.name.toLowerCase() === name.toLowerCase())) return b.value.id;
    }
    return null;
  }

  /** The text between bookmark `name`'s markers (one paragraph). */
  private bookmarkText(name: string): string {
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      let inside = false;
      let out = "";
      for (const i of b.value.inlines) {
        if (i.kind === "bookmarkStart" && i.value.name.toLowerCase() === name.toLowerCase()) inside = true;
        else if (inside && i.kind === "bookmarkEnd") return out.trim();
        else if (inside && i.kind === "run") out += i.value.text;
        else if (inside && i.kind === "field") out += i.value.cached;
      }
      if (inside) return out.trim();
    }
    return "Error! Reference source not found.";
  }

  private nextBookmarkId(): number {
    let max = 0;
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      for (const i of b.value.inlines) if (i.kind === "bookmarkStart" || i.kind === "bookmarkEnd") max = Math.max(max, i.value.id);
    }
    return max + 1;
  }

  /** Removes bookmark `name`'s markers; whether there was one. */
  private removeBookmark(name: string): boolean {
    let id: number | null = null;
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      for (const i of b.value.inlines) if (i.kind === "bookmarkStart" && i.value.name.toLowerCase() === name.toLowerCase()) id = i.value.id;
    }
    if (id == null) return false;
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      b.value.inlines = b.value.inlines.filter((i) => !((i.kind === "bookmarkStart" || i.kind === "bookmarkEnd") && i.value.id === id));
    }
    return true;
  }

  /** Caption paragraphs of sequence `id` as table-of-figures entries. */
  private captionEntries(id: string) {
    const out: { text: string; level: number; target: number }[] = [];
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      if (!b.value.inlines.some((i) => i.kind === "field" && i.value.kind.kind === "seq" && i.value.kind.value.identifier.toLowerCase() === id.toLowerCase())) continue;
      const text = b.value.inlines.map((i) => (i.kind === "run" ? i.value.text : i.kind === "field" ? i.value.cached : "")).join("").trim();
      out.push({ text, level: 1, target: b.value.id });
    }
    return out;
  }

  /** Headings `from..=to` of the body as TOC entries. */
  private tocEntries(from: number, to: number) {
    const out: { text: string; level: number; target: number }[] = [];
    const labels = listLabels(this.doc);
    for (const b of walkBlocks(this.doc.body)) {
      if (b.kind !== "paragraph") continue;
      const m = /^Heading([1-9])$/.exec(b.value.props?.style ?? "");
      const level = m ? Number(m[1]) : 0;
      let text = b.value.inlines.map((i) => (i.kind === "run" ? i.value.text : "")).join("").trim();
      const label = labels.get(b.value.id);
      if (text && label && /[\p{L}\p{N}]/u.test(label)) text = `${label.trim()} ${text}`;
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

/** Word's initials of a name. */
const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0]!.toUpperCase())
    .join("");

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

/** The single-level presets of `ListPreset::level_format` (fake: kind and template). */
function fakeFormat(preset: ListPreset, at: number): Level | null {
  const f = PRESET_FORMATS[preset];
  if (!f) return null;
  return { kind: f.kind, text: f.kind === "bullet" ? f.text : f.text.replace("%1", `%${at + 1}`), start: 1 };
}

/** The multilevel presets (fake: chains like `1`, `1.1`; the heading presets linked to Heading 1–9). */
function fakeMultilevel(preset: ListPreset): Level[] | null {
  if (!MULTILEVEL_PRESETS.includes(preset)) return null;
  const heading = ["articleSection", "headingDecimal", "headingOutline", "headingChapter"].includes(preset);
  return Array.from({ length: 9 }, (_, i) => {
    const chain = Array.from({ length: i + 1 }, (_x, n) => `%${n + 1}`).join(".");
    const level: Level = { kind: "decimal", text: heading ? chain : `${chain}.`, start: 1, indent: { left: 432 + 144 * i, hanging: 432 + 144 * i } };
    if (heading) level.style = `Heading${i + 1}`;
    return level;
  });
}

/** List labels like `Document::list_numbers` (direct or style numbering, default restarts). */
export function listLabels(doc: Document): Map<number, string> {
  const out = new Map<number, string>();
  const counters = new Map<number, number[]>();
  for (const b of walkBlocks(doc.body)) {
    if (b.kind !== "paragraph") continue;
    const n = b.value.props?.numbering ?? doc.styles.styles.find((s) => s.id === (b.value.props?.style ?? "Normal"))?.paragraph?.numbering;
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
    } else if (b.kind === "paragraph") {
      for (const i of b.value.inlines) {
        if (i.kind !== "drawing") continue;
        yield i.value.id;
        yield* walkAll(i.value.text?.blocks ?? []);
      }
    }
  }
}
