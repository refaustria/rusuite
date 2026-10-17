// UI commands for the document structure (P8-10): footnotes/endnotes,
// fields, tables of contents, section breaks and section page setup.
// (List galleries: listGallery.ts.) All are Rust-first
// commands sent through the `SyncController`; the patches update the editor.

import type { Editor } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { FieldKind } from "../generated/FieldKind";
import type { NoteKind } from "../generated/NoteKind";
import type { Section } from "../generated/Section";
import type { SectionKind } from "../generated/SectionKind";
import type { SectionPatch } from "../generated/SectionPatch";
import type { WriteCommand } from "../generated/WriteCommand";
import { cursorBlock } from "../sync/editorCommands";
import { notesNode } from "../sync/fromPM";
import { findPos, nextTempId, type SyncController } from "../sync/SyncPlugin";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { currentLayout, pageAtPos } from "./pagination";
import { goToNote } from "./structure";
import { paragraphPages } from "./references";

/** Whether the selection is inside the notes area. */
export function inNotes(state: EditorState): boolean {
  const area = notesNode(state.doc);
  return !!area && state.selection.from >= state.doc.content.size - area.nodeSize;
}

/** The caret's paragraph if it is in the body (not a note, header or table cell for notes). */
function bodyCaret(editor: Editor): { id: number; offset: number; cell: number | null } | null {
  if (inNotes(editor.state)) return null;
  return cursorBlock(editor);
}

/** Insert › Footnote / Endnote: a reference at the caret and a new note; the caret moves into the note. */
export async function insertNote(editor: Editor, ctl: SyncController, kind: NoteKind): Promise<boolean> {
  await ctl.idle();
  const at = bodyCaret(editor);
  if (!at) return false;
  const before = new Set(ctl.notes.map((n) => n.id));
  await ctl.run({ type: "insertFootnote", block: at.id, offset: at.offset, text: "", kind });
  const created = ctl.notes.find((n) => !before.has(n.id));
  return created ? goToNote(editor.view, created.id) : false;
}

/** Insert › Field: a field at the caret, its cached result computed now. */
export async function insertField(editor: Editor, ctl: SyncController, field: FieldKind, cached: string): Promise<boolean> {
  await ctl.idle();
  const at = cursorBlock(editor);
  if (!at) return false;
  await ctl.run({ type: "insertField", block: at.id, offset: at.offset, field, cached });
  editor.commands.focus();
  return true;
}

/** Id of the top-level model block before the caret's block (null = start), and the caret block's id. */
function topBlockAtCaret(state: EditorState): { before: number | null; current: number | null; atStart: boolean } {
  const { $from } = state.selection;
  const index = $from.index(0);
  const idOf = (i: number): number | null => {
    if (i < 0) return null;
    let id: number | null = null;
    state.doc.child(i).descendants((n) => {
      if (id !== null) return false;
      if (n.attrs.id != null && (TEXTBLOCK_TYPES.has(n.type.name) || n.type.name === "table" || n.type.name === "toc")) id = n.attrs.id;
      return id === null;
    });
    const top = state.doc.child(i);
    return top.attrs.id ?? id;
  };
  // The last model block of node i (lists hold several).
  const lastIdOf = (i: number): number | null => {
    if (i < 0) return null;
    const top = state.doc.child(i);
    if (top.attrs.id != null) return top.attrs.id;
    let id: number | null = null;
    top.descendants((n) => {
      if (TEXTBLOCK_TYPES.has(n.type.name) && n.attrs.id != null) id = n.attrs.id;
      return n.type.name !== "table";
    });
    return id;
  };
  return { before: lastIdOf(index - 1), current: idOf(index), atStart: $from.parentOffset === 0 };
}

/** References › Table of Contents: inserted before the caret's block when the caret is at its start, else after it. */
export async function insertToc(editor: Editor, ctl: SyncController, toLevel = 3, title: string | null = null): Promise<boolean> {
  await ctl.idle();
  if (inNotes(editor.state)) return false;
  const { before, current, atStart } = topBlockAtCaret(editor.state);
  const after = atStart ? before : current;
  await ctl.run({ type: "insertToc", after, fromLevel: 1, toLevel, title, newId: nextTempId() });
  await withPageNumbers(editor, ctl);
  if (!editor.isDestroyed) editor.commands.focus();
  return true;
}

/** Resolves after the next print-layout pass (or after `ms`). */
export function nextLayout(editor: Editor, ms = 1500): Promise<void> {
  return new Promise((resolve) => {
    const dom = editor.view.dom;
    const done = () => {
      clearTimeout(timer);
      dom.removeEventListener("rusuite-layout", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    dom.addEventListener("rusuite-layout", done);
  });
}

/** Word fills a new table of contents with page numbers at once: the pages once the table is laid out (W-21). */
async function withPageNumbers(editor: Editor, ctl: SyncController): Promise<void> {
  if (editor.isDestroyed || !currentLayout(editor.state)) return;
  await nextLayout(editor);
  if (!editor.isDestroyed && currentLayout(editor.state)) await updateTocs(editor, ctl);
}

/** References › Insert Table of Figures: the captions of `label` (Figure, Table, Equation), placed like a table of contents. */
export async function insertTableOfFigures(editor: Editor, ctl: SyncController, label: string): Promise<boolean> {
  await ctl.idle();
  if (inNotes(editor.state)) return false;
  const { before, current, atStart } = topBlockAtCaret(editor.state);
  const after = atStart ? before : current;
  await ctl.run({ type: "insertToc", after, fromLevel: 1, toLevel: 1, title: null, newId: nextTempId(), caption: label.replace(/\s+/g, "_") });
  await withPageNumbers(editor, ctl);
  if (!editor.isDestroyed) editor.commands.focus();
  return true;
}

/** Page number per heading id from the print-layout pagination (empty in draft view). */
export function headingPages(state: EditorState): [number, number][] {
  const layout = currentLayout(state);
  if (!layout) return [];
  const out: [number, number][] = [];
  state.doc.forEach((top, offset) => {
    if (top.type.name === "notes") return;
    const visit = (n: typeof top, pos: number) => {
      const heading = n.type.name === "heading" || (n.type.name === "paragraph" && /^Heading/.test(String(n.attrs.style ?? "")));
      if (heading && n.attrs.id != null) out.push([n.attrs.id as number, pageAtPos(layout, pos + 1)?.value ?? 1]);
    };
    visit(top, offset);
    top.descendants((n, p) => {
      visit(n, offset + 1 + p);
      return !n.isTextblock;
    });
  });
  return out.filter(([id]) => id > 0);
}

/** References › Update Table: every TOC rebuilt with page numbers from the pagination. */
export async function updateTocs(editor: Editor, ctl: SyncController): Promise<number> {
  await ctl.idle();
  const ids: number[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "toc" && n.attrs.id > 0) ids.push(n.attrs.id);
  });
  if (!ids.length) return 0;
  // Headings and captions (tables of figures) alike.
  const pages = paragraphPages(editor.state);
  const commands: WriteCommand[] = ids.map((id) => ({ type: "updateToc", id, pages }));
  await ctl.run(commands.length === 1 ? commands[0]! : { type: "compound", commands });
  editor.commands.focus();
  return ids.length;
}

// ----- sections ------------------------------------------------------------------------

/** The section holding the caret: the first section ended at or after the caret's top-level block (else the last). */
export function currentSection(state: EditorState, sections: Section[]): Section | null {
  if (!sections.length) return null;
  const index = Math.min(state.selection.$from.index(0), state.doc.childCount - 1);
  const ids = new Set(sections.map((s) => s.id));
  for (let i = index; i < state.doc.childCount; i++) {
    let found: number | null = null;
    const visit = (n: ReturnType<typeof state.doc.child>) => {
      if (found !== null) return false;
      if (n.isTextblock) {
        const end = (n.attrs.extra as { sectionEnd?: number } | null)?.sectionEnd;
        if (end != null && ids.has(end)) found = end;
        return false;
      }
      return true;
    };
    const top = state.doc.child(i);
    if (visit(top)) top.descendants(visit);
    if (found !== null) return sections.find((s) => s.id === found) ?? null;
  }
  return sections[sections.length - 1]!;
}

/** Layout › Breaks › Section break: the caret's paragraph is split and its first half ends the current section. */
export async function insertSectionBreak(editor: Editor, ctl: SyncController, kind: SectionKind): Promise<boolean> {
  await ctl.idle();
  const at = bodyCaret(editor);
  if (!at || at.cell != null) return false;
  const newId = nextTempId();
  await ctl.run({
    type: "compound",
    commands: [
      { type: "splitParagraph", block: at.id, offset: at.offset, newId },
      { type: "insertSectionBreak", block: at.id, kind },
    ],
  });
  // Word: the caret goes to the start of the new section (the paragraph after the break), so Layout commands that
  // follow act on it (W-17).
  caretAfterBlock(editor, at.id);
  editor.commands.focus();
  return true;
}

/** Puts the caret at the start of the text block after the block with id `id` (no-op when there is none). */
export function caretAfterBlock(editor: Editor, id: number): boolean {
  const { doc } = editor.state;
  const pos = findPos(doc, id);
  const node = pos >= 0 ? doc.nodeAt(pos) : null;
  if (!node) return false;
  const after = pos + node.nodeSize;
  if (after >= doc.content.size) return false;
  const sel = TextSelection.findFrom(doc.resolve(after), 1, true);
  if (!sel) return false;
  editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView());
  return true;
}

/** `SetSection` on the caret's section (falls back to `SetPage` without sections). */
export function sectionCommand(state: EditorState, ctl: SyncController, patch: SectionPatch): WriteCommand | null {
  const sec = currentSection(state, ctl.sections);
  if (sec) return { type: "setSection", section: sec.id, patch };
  return patch.page ? { type: "setPage", patch: patch.page } : null;
}

