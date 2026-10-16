// UI commands for the document structure (P8-10): footnotes/endnotes,
// fields, tables of contents, section breaks and section page setup,
// multilevel list presets and list restart/continue. All are Rust-first
// commands sent through the `SyncController`; the patches update the editor.

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { FieldKind } from "../generated/FieldKind";
import type { Level } from "../generated/Level";
import type { LevelKind } from "../generated/LevelKind";
import type { NoteKind } from "../generated/NoteKind";
import type { Numbering } from "../generated/Numbering";
import type { NumberingDef } from "../generated/NumberingDef";
import type { Section } from "../generated/Section";
import type { SectionKind } from "../generated/SectionKind";
import type { SectionPatch } from "../generated/SectionPatch";
import type { WriteCommand } from "../generated/WriteCommand";
import { cursorBlock } from "../sync/editorCommands";
import { notesNode } from "../sync/fromPM";
import { nextTempId, type SyncController } from "../sync/SyncPlugin";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { currentLayout } from "./pagination";
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
  editor.commands.focus();
  return true;
}

/** References › Insert Table of Figures: the captions of `label` (Figure, Table, Equation), placed like a table of contents. */
export async function insertTableOfFigures(editor: Editor, ctl: SyncController, label: string): Promise<boolean> {
  await ctl.idle();
  if (inNotes(editor.state)) return false;
  const { before, current, atStart } = topBlockAtCaret(editor.state);
  const after = atStart ? before : current;
  await ctl.run({ type: "insertToc", after, fromLevel: 1, toLevel: 1, title: null, newId: nextTempId(), caption: label.replace(/\s+/g, "_") });
  editor.commands.focus();
  return true;
}

/** Page number per heading id from the print-layout pagination (empty in draft view). */
export function headingPages(state: EditorState): [number, number][] {
  const layout = currentLayout(state);
  if (!layout) return [];
  const out: [number, number][] = [];
  state.doc.forEach((top, _o, i) => {
    if (top.type.name === "notes") return;
    const page = layout.pages[layout.nodePage[i] ?? 0]?.value ?? 1;
    const visit = (n: typeof top) => {
      const heading = n.type.name === "heading" || (n.type.name === "paragraph" && /^Heading/.test(String(n.attrs.style ?? "")));
      if (heading && n.attrs.id != null) out.push([n.attrs.id as number, page]);
    };
    visit(top);
    top.descendants((n) => {
      visit(n);
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
  editor.commands.focus();
  return true;
}

/** `SetSection` on the caret's section (falls back to `SetPage` without sections). */
export function sectionCommand(state: EditorState, ctl: SyncController, patch: SectionPatch): WriteCommand | null {
  const sec = currentSection(state, ctl.sections);
  if (sec) return { type: "setSection", section: sec.id, patch };
  return patch.page ? { type: "setPage", patch: patch.page } : null;
}

// ----- lists -----------------------------------------------------------------------------

export type MultilevelPreset = "decimal" | "outline" | "legal";

/** The nine levels of a multilevel list preset (Word's gallery: 1/1.1/1.1.1, 1/a/i, legal). */
export function presetLevels(preset: MultilevelPreset): Level[] {
  const kinds: Record<MultilevelPreset, LevelKind[]> = {
    decimal: ["decimal"],
    outline: ["decimal", "lowerLetter", "lowerRoman"],
    legal: ["upperRoman", "decimal"],
  };
  return Array.from({ length: 9 }, (_, i): Level => {
    const k = kinds[preset];
    const kind = preset === "legal" ? (i === 0 ? "upperRoman" : "decimal") : k[i % k.length]!;
    let text: string;
    if (preset === "outline") text = i % 3 === 1 ? `%${i + 1})` : `%${i + 1}.`;
    else {
      const chain = Array.from({ length: i + 1 }, (_, n) => `%${n + 1}`).join(".");
      text = i === 0 ? `${chain}.` : chain;
    }
    const level: Level = { kind, text, start: 1, indent: { left: 432 + 360 * i, hanging: 432 } };
    // Legal numbering: every number in the label is decimal ("1.1" under "I.").
    if (preset === "legal" && i > 0) level.legal = true;
    return level;
  });
}

/** Numbering with a new standalone list of `preset`; returns it and the new id. */
export function withPreset(numbering: Numbering, preset: MultilevelPreset): { numbering: Numbering; id: number } {
  const id = Math.max(0, ...numbering.defs.map((d) => d.id)) + 1;
  const def: NumberingDef = { id, levels: presetLevels(preset) };
  return { numbering: { ...structuredClone(numbering), defs: [...structuredClone(numbering.defs), def] }, id };
}

/** Home › Multilevel list: the selected paragraphs become one new list of `preset` (keeping their levels). */
export async function applyMultilevel(editor: Editor, ctl: SyncController, preset: MultilevelPreset): Promise<boolean> {
  await ctl.idle();
  const { from, to } = editor.state.selection;
  const items: { id: number; level: number }[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!TEXTBLOCK_TYPES.has(node.type.name)) return true;
    const id = node.attrs.id as number | null;
    if (id == null || id < 0) return false;
    // List level: the depth of list nesting.
    const $p = editor.state.doc.resolve(pos);
    let level = 0;
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "bulletList" || $p.node(d).type.name === "orderedList") level++;
    items.push({ id, level: Math.max(0, level - 1) });
    return false;
  });
  if (!items.length) return false;
  const { numbering, id } = withPreset(ctl.numbering, preset);
  const commands: WriteCommand[] = [{ type: "restoreNumbering", numbering }];
  const byLevel = new Map<number, number[]>();
  for (const it of items) byLevel.set(it.level, [...(byLevel.get(it.level) ?? []), it.id]);
  for (const [level, blocks] of byLevel) commands.push({ type: "setParagraphProps", blocks, patch: { numbering: { numId: id, level } } });
  await ctl.run({ type: "compound", commands });
  editor.commands.focus();
  return true;
}

/** The numbered paragraph at the caret (id), or null. */
export function numberedAtCaret(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "listItem") {
      const p = $from.node(d).firstChild;
      return (p?.attrs.id as number | null) ?? null;
    }
  }
  return null;
}
