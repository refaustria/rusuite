// Rendering of the document structure (P8-10): footnote/endnote numbers
// (computed from the order of the references: footnotes 1, 2, 3, endnotes
// i, ii, iii as in Word), the note labels and group separators of the notes
// area, section-break markers ("Section break (Next page)") and the live
// values of fields (page numbers from the print-layout pagination, date and
// time from the clock, the file name from the document name). All of it is
// decorations: the model keeps the cached field results until the UI sends
// `UpdateFields` on save. Clicking a TOC entry goes to its heading;
// double-clicking a reference goes to its note and back.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { FieldKind } from "../generated/FieldKind";
import type { Section } from "../generated/Section";
import type { WriteCommand } from "../generated/WriteCommand";
import { notesNode } from "../sync/fromPM";
import { currentLayout, paginationKey } from "./pagination";
import { charOffsetOf, findPos } from "../sync/SyncPlugin";
import { t } from "../i18n";
import { noteNumbers } from "./numbers";

export { formatNumber, noteNumbers } from "./numbers";

// ----- dates ---------------------------------------------------------------------

/** Formats `d` with a Word date picture (`d`, `dd`, `ddd(d)`, `M`…`MMMM`, `yy(yy)`, `H`, `HH`, `h`, `hh`, `m`, `mm`, `s`, `ss`, `AM/PM`). */
export function formatDateTime(d: Date, picture: string, locale = "en"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = (style: "short" | "long") => new Intl.DateTimeFormat(locale, { month: style }).format(d);
  const weekday = (style: "short" | "long") => new Intl.DateTimeFormat(locale, { weekday: style }).format(d);
  const h12 = d.getHours() % 12 || 12;
  const tokens: [RegExp, () => string][] = [
    [/^yyyy/, () => String(d.getFullYear())],
    [/^yy/, () => pad(d.getFullYear() % 100)],
    [/^MMMM/, () => month("long")],
    [/^MMM/, () => month("short")],
    [/^MM/, () => pad(d.getMonth() + 1)],
    [/^M/, () => String(d.getMonth() + 1)],
    [/^dddd/, () => weekday("long")],
    [/^ddd/, () => weekday("short")],
    [/^dd/, () => pad(d.getDate())],
    [/^d/, () => String(d.getDate())],
    [/^HH/, () => pad(d.getHours())],
    [/^H/, () => String(d.getHours())],
    [/^hh/, () => pad(h12)],
    [/^h/, () => String(h12)],
    [/^mm/, () => pad(d.getMinutes())],
    [/^m/, () => String(d.getMinutes())],
    [/^ss/, () => pad(d.getSeconds())],
    [/^s/, () => String(d.getSeconds())],
    [/^(AM\/PM|am\/pm)/, () => (d.getHours() < 12 ? "AM" : "PM")],
  ];
  let out = "";
  let rest = picture;
  while (rest) {
    const quoted = /^'([^']*)'/.exec(rest);
    if (quoted) {
      out += quoted[1];
      rest = rest.slice(quoted[0].length);
      continue;
    }
    const hit = tokens.find(([re]) => re.test(rest));
    if (hit) {
      const m = hit[0].exec(rest)!;
      out += hit[1]();
      rest = rest.slice(m[0].length);
    } else {
      out += rest[0];
      rest = rest.slice(1);
    }
  }
  return out;
}

// ----- fields ----------------------------------------------------------------------

export interface FieldContext {
  /** Page number text of the page holding document position `pos` (null: unknown, e.g. draft view). */
  pageAt: (pos: number, state: EditorState) => string | null;
  /** Total number of pages (null: unknown). */
  pages: (state: EditorState) => number | null;
  /** The document's file name (null: untitled). */
  fileName: () => string | null;
  now: () => Date;
  locale: () => string;
}

/** The live result of a field, or null to keep showing the cached one. */
export function fieldValue(kind: FieldKind, pos: number, state: EditorState, ctx: FieldContext): string | null {
  switch (kind.kind) {
    case "page":
      return ctx.pageAt(pos, state);
    case "numPages": {
      const n = ctx.pages(state);
      return n == null ? null : String(n);
    }
    case "date":
      return formatDateTime(ctx.now(), kind.value.format ?? "d.M.yyyy", ctx.locale());
    case "time":
      return formatDateTime(ctx.now(), kind.value.format ?? "HH:mm", ctx.locale());
    case "fileName":
      return ctx.fileName();
    case "author":
      return null;
  }
}

/** `UpdateFields` for every field whose live value differs from its cached result, or null. */
export function updateFieldsCommand(state: EditorState, ctx: FieldContext): WriteCommand | null {
  const values: [number, number, string][] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const id = node.attrs.id as number | null;
    if (id == null) return false;
    node.forEach((child, offset) => {
      if (child.type.name !== "field") return;
      const v = fieldValue(child.attrs.kind as FieldKind, pos + 1 + offset, state, ctx);
      if (v != null && v !== child.attrs.cached) values.push([id, charOffsetOf(node, offset), v]);
    });
    return false;
  });
  return values.length ? { type: "updateFields", values } : null;
}

// ----- the plugin --------------------------------------------------------------------

export interface StructureOptions {
  sections: () => Section[];
  fields: FieldContext;
}

export const structureKey = new PluginKey<DecorationSet>("rusuiteStructure");

/** Section kind label: "Section break (Next page)". */
export function sectionBreakLabel(kind: Section["kind"] | undefined): string {
  return t("write.sectionBreak", { kind: t(`write.sectionKind.${kind ?? "nextPage"}`) });
}

function label(cls: string, text: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("span");
  el.className = cls;
  el.contentEditable = "false";
  el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function separator(kind: "foot" | "end"): HTMLElement {
  const el = document.createElement("div");
  el.className = `notes-separator notes-separator-${kind}`;
  el.contentEditable = "false";
  el.textContent = kind === "foot" ? t("write.notes.footnotes") : t("write.notes.endnotes");
  return el;
}

export function buildStructureDecorations(state: EditorState, opts: StructureOptions): DecorationSet {
  const doc = state.doc;
  const decos: Decoration[] = [];
  const numbers = noteNumbers(doc);
  const sections = opts.sections();
  const nextKind = new Map<number, Section["kind"]>();
  sections.forEach((s, i) => nextKind.set(s.id, sections[i + 1]?.kind ?? "nextPage"));
  const area = notesNode(doc);
  const bodyEnd = area ? doc.content.size - area.nodeSize : doc.content.size;
  doc.nodesBetween(0, bodyEnd, (node, pos) => {
    if (node.type.name === "noteRef") {
      decos.push(Decoration.node(pos, pos + 1, { "data-n": numbers.get(node.attrs.id as number) ?? "?" }));
      return false;
    }
    if (node.type.name === "field") {
      const v = fieldValue(node.attrs.kind as FieldKind, pos, state, opts.fields);
      if (v != null && v !== node.attrs.cached) decos.push(Decoration.node(pos, pos + 1, { "data-live": v }));
      return false;
    }
    if (node.isTextblock) {
      const end = (node.attrs.extra as { sectionEnd?: number } | null)?.sectionEnd;
      if (end != null) {
        const kind = nextKind.get(end) ?? "nextPage";
        decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-section-label": sectionBreakLabel(kind), "data-section-next": kind }));
      }
      return node.childCount > 0;
    }
    return true;
  });
  if (area) {
    let pos = bodyEnd + 1;
    let lastKind: string | null = null;
    area.forEach((n) => {
      const kind = n.attrs.kind as "foot" | "end";
      if (kind !== lastKind) {
        decos.push(Decoration.widget(pos, () => separator(kind), { side: -1, key: `sep:${kind}`, ignoreSelection: true }));
        lastKind = kind;
      }
      const num = numbers.get(n.attrs.id as number) ?? "";
      decos.push(Decoration.node(pos, pos + n.nodeSize, { "data-n": num }));
      decos.push(
        Decoration.widget(pos + 1, () => label("note-label", num, { "data-note-id": String(n.attrs.id) }), {
          side: -1,
          key: `label:${n.attrs.id}:${num}`,
          ignoreSelection: true,
        }),
      );
      pos += n.nodeSize;
    });
  }
  return DecorationSet.create(doc, decos);
}

/** Field context from the print-layout pagination of the state, the clock and the document name. */
export function layoutFieldContext(fileName: () => string | null, locale: () => string, now: () => Date = () => new Date()): FieldContext {
  return {
    pageAt: (pos, state) => {
      const layout = currentLayout(state);
      if (!layout) return null;
      const index = state.doc.resolve(Math.min(pos, state.doc.content.size)).index(0);
      return layout.pages[layout.nodePage[index] ?? 0]?.number ?? null;
    },
    pages: (state) => currentLayout(state)?.pages.length ?? null,
    fileName,
    now,
    locale,
  };
}

/** Position of the first reference to note `id` (-1 when none). */
export function refPos(doc: PMNode, id: number): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.type.name === "notes") return false;
    if (n.type.name === "noteRef" && n.attrs.id === id) found = pos;
    return true;
  });
  return found;
}

/** Position of note `id`'s node (-1 when none). */
export function notePos(doc: PMNode, id: number): number {
  const area = notesNode(doc);
  if (!area) return -1;
  let pos = doc.content.size - area.nodeSize + 1;
  let found = -1;
  area.forEach((n) => {
    if (found < 0 && n.attrs.id === id) found = pos;
    pos += n.nodeSize;
  });
  return found;
}

function scrollTo(view: EditorView, pos: number): void {
  try {
    const dom = view.domAtPos(pos).node as HTMLElement;
    const el = dom.nodeType === 1 ? dom : dom.parentElement;
    el?.scrollIntoView?.({ block: "center" });
  } catch {
    // no layout (tests)
  }
}

/** Caret to the end of note `id`'s first paragraph. */
export function goToNote(view: EditorView, id: number): boolean {
  const pos = notePos(view.state.doc, id);
  if (pos < 0) return false;
  const note = view.state.doc.nodeAt(pos)!;
  const first = note.firstChild!;
  const at = pos + 1 + (first.isTextblock ? 1 + first.content.size : 1);
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at))).scrollIntoView());
  view.focus();
  scrollTo(view, at);
  return true;
}

/** Caret right after the reference to note `id`. */
export function goToRef(view: EditorView, id: number): boolean {
  const pos = refPos(view.state.doc, id);
  if (pos < 0) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).scrollIntoView());
  view.focus();
  scrollTo(view, pos);
  return true;
}

/** Caret to the start of the heading with id `id` (TOC entry click). */
export function goToBlock(view: EditorView, id: number): boolean {
  const pos = findPos(view.state.doc, id);
  if (pos < 0) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))).scrollIntoView());
  view.focus();
  scrollTo(view, pos + 1);
  return true;
}

/** Moves the caret after the next (`dir = 1`) or previous reference of `kind`; false when there is none. */
export function goToNextRef(view: EditorView, dir: 1 | -1, kind: "foot" | "end" = "foot"): boolean {
  const { from } = view.state.selection;
  const refs: number[] = [];
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === "notes") return false;
    if (n.type.name === "noteRef" && n.attrs.kind === kind) refs.push(pos);
    return true;
  });
  const target = dir > 0 ? refs.find((p) => p >= from) : [...refs].reverse().find((p) => p + 1 < from);
  if (target === undefined) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target + 1)).scrollIntoView());
  view.focus();
  return true;
}

/** The structure plugin; `refreshStructure(view)` recomputes after sections, name or pagination changed. */
export function structurePlugin(opts: StructureOptions): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: structureKey,
    state: {
      init: (_c, state) => buildStructureDecorations(state, opts),
      apply(tr, prev, _old, state) {
        // Page layout changes (pagination meta) move PAGE / NUMPAGES values.
        if (tr.docChanged || tr.getMeta(structureKey) || tr.getMeta(paginationKey) !== undefined) return buildStructureDecorations(state, opts);
        return prev;
      },
    },
    props: {
      decorations: (state) => structureKey.getState(state) ?? null,
      handleDOMEvents: {
        click: (view, e) => {
          const entry = (e.target as HTMLElement | null)?.closest?.(".toc-entry") as HTMLElement | null;
          if (!entry?.dataset.target) return false;
          e.preventDefault();
          return goToBlock(view, Number(entry.dataset.target));
        },
        dblclick: (view, e) => {
          const target = e.target as HTMLElement | null;
          const ref = target?.closest?.("sup.note-ref") as HTMLElement | null;
          if (ref?.dataset.noteId) {
            e.preventDefault();
            return goToNote(view, Number(ref.dataset.noteId));
          }
          const lbl = target?.closest?.(".note-label, .page-note") as HTMLElement | null;
          if (lbl?.dataset.noteId) {
            e.preventDefault();
            const id = Number(lbl.dataset.noteId);
            return lbl.classList.contains("page-note") ? goToNote(view, id) : goToRef(view, id);
          }
          return false;
        },
      },
    },
  });
}

/** Recomputes the structure decorations (sections, document name or page layout changed). */
export function refreshStructure(view: EditorView | null | undefined): void {
  if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(structureKey, true).setMeta("addToHistory", false));
}
