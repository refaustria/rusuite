// Layout › Columns: Word's presets (One, Two, Three, Left, Right), the More
// Columns dialog's math (equal width or per-column widths and spacing,
// line between) and where it applies (this section, this point forward —
// a continuous section break at the caret —, the whole document).

import type { EditorState } from "@tiptap/pm/state";
import type { ColumnWidth } from "../generated/ColumnWidth";
import type { Columns } from "../generated/Columns";
import type { PageSetup } from "../generated/PageSetup";
import type { Section } from "../generated/Section";
import type { WriteCommand } from "../generated/WriteCommand";
import { cursorBlock } from "../sync/editorCommands";
import { nextTempId } from "../sync/SyncPlugin";
import { currentSection } from "./structureCommands";

/** Word's default space between columns: 0.5" (720 twips; Word in cm locales shows 1.25 cm = 709). */
export const DEFAULT_SPACING = 720;

export type ColumnPreset = "one" | "two" | "three" | "left" | "right";

/** Text width of a page (twips). */
export const textWidth = (page: PageSetup | null | undefined): number =>
  page ? page.width - page.margins.left - page.margins.right : 9026;

/** The widths and spacing of `c` for a text width of `content` (equal columns share what the spacing leaves). */
export function columnLayout(c: Columns, content: number): ColumnWidth[] {
  const n = Math.max(1, c.count);
  if (!c.equal && c.widths?.length === n) {
    const total = c.widths.reduce((s, w) => s + w.width + w.space, 0);
    if (total > 0 && total !== content) {
      const k = content / total;
      return c.widths.map((w) => ({ width: Math.round(w.width * k), space: Math.round(w.space * k) }));
    }
    return c.widths.map((w) => ({ ...w }));
  }
  const space = Math.max(0, c.spacing ?? DEFAULT_SPACING);
  const width = Math.max(0, Math.floor((content - space * (n - 1)) / n));
  return Array.from({ length: n }, (_, i) => ({ width, space: i + 1 < n ? space : 0 }));
}

/** The columns of a preset for a text width of `content`; Left / Right: a narrow column (about a third) and a wide one. */
export function presetColumns(preset: ColumnPreset, content: number): Columns {
  if (preset === "one") return { count: 1, equal: true };
  if (preset === "two") return { count: 2, equal: true };
  if (preset === "three") return { count: 3, equal: true };
  const space = DEFAULT_SPACING;
  const narrow = Math.round((content - space) * 0.35);
  const wide = content - space - narrow;
  const widths: ColumnWidth[] =
    preset === "left" ? [{ width: narrow, space }, { width: wide, space: 0 }] : [{ width: wide, space }, { width: narrow, space: 0 }];
  return { count: 2, equal: false, widths };
}

/** Which preset `c` is (null: a custom setting). */
export function presetOf(c: Columns | null | undefined, content: number): ColumnPreset | null {
  const cols = c ?? { count: 1, equal: true };
  if (cols.count <= 1) return "one";
  if (cols.equal || !cols.widths?.length) return cols.count === 2 ? "two" : cols.count === 3 ? "three" : null;
  if (cols.count !== 2) return null;
  const [a, b] = cols.widths;
  if (!a || !b) return null;
  for (const p of ["left", "right"] as const) {
    const w = presetColumns(p, content).widths!;
    if (Math.abs(w[0]!.width - a.width) < 60 && Math.abs(w[1]!.width - b.width) < 60) return p;
  }
  return null;
}

/** The More Columns dialog's values. */
export interface ColumnsForm {
  count: number;
  equal: boolean;
  /** Width and spacing per column (twips); with `equal`, only the first counts. */
  widths: ColumnWidth[];
  separator: boolean;
}

/** The dialog's values for section columns `c`. */
export function columnsForm(c: Columns | null | undefined, content: number): ColumnsForm {
  const cols: Columns = c ?? { count: 1, equal: true };
  return { count: Math.max(1, cols.count), equal: cols.equal !== false, widths: columnLayout(cols, content), separator: !!cols.separator };
}

/** Changing the number of columns in the dialog: equal widths again (Word). */
export function withCount(f: ColumnsForm, count: number, content: number): ColumnsForm {
  const n = Math.min(45, Math.max(1, Math.round(count)));
  const spacing = f.widths[0]?.space || DEFAULT_SPACING;
  return { ...f, count: n, equal: true, widths: columnLayout({ count: n, equal: true, spacing }, content) };
}

/** Editing one column's width or spacing: with equal width all columns follow; the last column absorbs the rest otherwise. */
export function withWidth(f: ColumnsForm, index: number, patch: Partial<ColumnWidth>, content: number): ColumnsForm {
  if (f.equal) {
    const space = patch.space ?? f.widths[0]?.space ?? DEFAULT_SPACING;
    let widths = columnLayout({ count: f.count, equal: true, spacing: space }, content);
    if (patch.width != null && f.count > 1) {
      // A width: the spacing follows.
      const w = Math.max(0, patch.width);
      const sp = Math.max(0, Math.floor((content - w * f.count) / (f.count - 1)));
      widths = widths.map((_x, i) => ({ width: w, space: i + 1 < f.count ? sp : 0 }));
    }
    return { ...f, widths };
  }
  const widths = f.widths.map((w, i) => (i === index ? { ...w, ...patch } : { ...w }));
  const last = widths.length - 1;
  const used = widths.slice(0, last).reduce((s, w) => s + w.width + w.space, 0);
  if (last >= 0) widths[last] = { width: Math.max(0, content - used), space: 0 };
  return { ...f, widths };
}

/** The `Columns` of the dialog's values. */
export function formColumns(f: ColumnsForm): Columns {
  if (f.count <= 1) return f.separator ? { count: 1, equal: true, separator: true } : { count: 1, equal: true };
  const out: Columns = f.equal ? { count: f.count, equal: true, spacing: f.widths[0]?.space ?? DEFAULT_SPACING } : { count: f.count, equal: false, widths: f.widths.map((w, i) => ({ width: w.width, space: i + 1 < f.count ? w.space : 0 })) };
  if (f.separator) out.separator = true;
  return out;
}

export type ColumnsApplyTo = "section" | "forward" | "whole";

/** The commands applying `cols`: to the caret's section, from the caret on (a continuous section break first), or to every section. */
export function columnsCommand(state: EditorState, sections: Section[], cols: Columns, applyTo: ColumnsApplyTo, at = cursorBlockOf(state)): WriteCommand | null {
  if (!sections.length) return null;
  if (applyTo === "whole") {
    const cmds: WriteCommand[] = sections.map((s) => ({ type: "setSection", section: s.id, patch: { columns: cols } }));
    return cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds };
  }
  const sec = currentSection(state, sections);
  if (!sec) return null;
  const set: WriteCommand = { type: "setSection", section: sec.id, patch: { columns: cols } };
  if (applyTo === "section" || !at || at.cell != null) return set;
  // The part before the caret keeps the old columns: it becomes its own section (the break's section takes the old id's settings).
  return {
    type: "compound",
    commands: [
      { type: "splitParagraph", block: at.id, offset: at.offset, newId: nextTempId() },
      { type: "insertSectionBreak", block: at.id, kind: "continuous" },
      set,
    ],
  };
}

function cursorBlockOf(state: EditorState): { id: number; offset: number; cell: number | null } | null {
  return cursorBlock({ state } as Parameters<typeof cursorBlock>[0]);
}

/** Ruler segments (CSS px from the text start) of `cols` for a text width of `content`: [start, end] per column. */
export function rulerSegments(cols: Columns | null | undefined, content: number, twipsPerPx = 15): [number, number][] {
  if (!cols || cols.count <= 1) return [[0, content / twipsPerPx]];
  let x = 0;
  return columnLayout(cols, content).map((c) => {
    const seg: [number, number] = [x / twipsPerPx, (x + c.width) / twipsPerPx];
    x += c.width + c.space;
    return seg;
  });
}
