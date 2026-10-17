// Footnote and endnote numbers like Word (P9-W2): per section number format,
// start and restart (`w:footnotePr` / `w:endnotePr` in `w:sectPr`:
// `w:numFmt`, `w:numStart`, `w:numRestart` = continuous, each section or each
// page). Defaults: footnotes 1, 2, 3 …, endnotes i, ii, iii … running through
// the document. "Restart each page" needs the page of every reference: the
// print layout's (`pageOf`); without one (draft view) the numbers run on.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { NoteNumbering } from "../generated/NoteNumbering";
import type { Section } from "../generated/Section";
import { formatNumber } from "./numbers";

type Kind = "foot" | "end";

/** The numbering of `kind` notes in section `s` (the section's own, else the defaults). */
export function sectionNoteNumbering(s: Section | undefined, kind: Kind): NoteNumbering {
  return (kind === "foot" ? s?.footnoteNumbering : s?.endnoteNumbering) ?? {};
}

/** The effective number format of `kind` notes in a numbering. */
export function noteFormat(n: NoteNumbering, kind: Kind): NonNullable<NoteNumbering["format"]> {
  return n.format ?? (kind === "foot" ? "decimal" : "lowerRoman");
}

/** Section index of every top-level node (a section-end paragraph closes its section). */
function sectionIndexOf(doc: PMNode, sections: readonly Section[]): number[] {
  const index = new Map(sections.map((s, i) => [s.id, i]));
  const out: number[] = [];
  let cur = 0;
  doc.forEach((n) => {
    out.push(cur);
    const visit = (x: PMNode): boolean => {
      if (x.isTextblock) {
        const end = (x.attrs.extra as { sectionEnd?: number } | null)?.sectionEnd;
        const i = end != null ? index.get(end) : undefined;
        if (i !== undefined) cur = Math.min(sections.length - 1, i + 1);
        return false;
      }
      return true;
    };
    if (visit(n)) n.descendants(visit);
  });
  return out;
}

/**
 * Note id → the number shown, in the order of the first reference in the
 * body. `pageOf(pos)` gives the page index of a reference (for "restart
 * each page").
 */
export function noteLabels(doc: PMNode, sections: readonly Section[] = [], pageOf?: (pos: number) => number | null): Map<number, string> {
  const out = new Map<number, string>();
  // No notes area: no notes (and no walk through a long document).
  if (doc.lastChild?.type.name !== "notes") return out;
  const sectionOf = sectionIndexOf(doc, sections);
  const state: Record<Kind, { n: number; section: number; page: number | null; started: boolean }> = {
    foot: { n: 0, section: -1, page: null, started: false },
    end: { n: 0, section: -1, page: null, started: false },
  };
  doc.forEach((top, offset, index) => {
    if (top.type.name === "notes") return;
    const section = sectionOf[index] ?? 0;
    top.descendants((node, rel) => {
      if (node.type.name !== "noteRef") return true;
      const id = node.attrs.id as number;
      if (out.has(id)) return false;
      const kind: Kind = node.attrs.kind === "end" ? "end" : "foot";
      const st = state[kind];
      const cfg = sectionNoteNumbering(sections[section], kind);
      const start = Math.max(1, cfg.start ?? 1);
      const restart = cfg.restart ?? "continuous";
      const page = restart === "eachPage" && pageOf ? pageOf(offset + 1 + rel) : null;
      if (!st.started) st.n = start - 1;
      else if (section !== st.section && restart === "eachSection") st.n = start - 1;
      else if (restart === "eachPage" && page != null && page !== st.page) st.n = start - 1;
      st.started = true;
      st.section = section;
      st.page = page;
      out.set(id, formatNumber(++st.n, noteFormat(cfg, kind)));
      return false;
    });
  });
  return out;
}

/** Section index per endnote (the section of its first reference), in reference order per section. */
export function endnoteSections(doc: PMNode, sections: readonly Section[]): { section: number; ids: number[] }[] {
  const sectionOf = sectionIndexOf(doc, sections);
  const groups = new Map<number, number[]>();
  const seen = new Set<number>();
  doc.forEach((top, _o, index) => {
    if (top.type.name === "notes") return;
    top.descendants((node) => {
      if (node.type.name !== "noteRef") return true;
      const id = node.attrs.id as number;
      if (node.attrs.kind !== "end" || seen.has(id)) return false;
      seen.add(id);
      const s = sectionOf[index] ?? 0;
      groups.set(s, [...(groups.get(s) ?? []), id]);
      return false;
    });
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([section, ids]) => ({ section, ids }));
}
