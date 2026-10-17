// Fields round 2 (P9-W6): field instructions as Word shows them (Alt+F9,
// the Insert › Field dialog), the field codes view (Alt+F9 for all fields,
// Shift+F9 for the selection's), Lock / Unlock Fields (Ctrl+F11 /
// Ctrl+Shift+F11) and the page-dependent header fields (STYLEREF,
// SECTIONPAGES) resolved per page for the page chrome.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { FieldKind } from "../generated/FieldKind";
import type { LevelKind } from "../generated/LevelKind";
import type { WriteCommand } from "../generated/WriteCommand";
import { styleOf } from "../sync/editorCommands";
import { TEXTBLOCK_TYPES } from "../sync/schema";

const SEQ_FORMATS: Partial<Record<LevelKind, string>> = {
  upperRoman: "ROMAN",
  lowerRoman: "roman",
  upperLetter: "ALPHABETIC",
  lowerLetter: "alphabetic",
};

const quoted = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

/** The field instruction as written to docx and shown by Alt+F9 (`PAGE`, `DATE \@ "d.M.yyyy"`); mirrors `FieldKind::instruction`. */
export function fieldInstruction(kind: FieldKind): string {
  const pic = (name: string, f?: string) => (f ? `${name} \\@ "${f}"` : name);
  const sw = (parts: [boolean | undefined, string][]) => parts.filter(([on]) => on).map(([, s]) => ` ${s}`).join("");
  switch (kind.kind) {
    case "page": return "PAGE";
    case "numPages": return "NUMPAGES";
    case "sectionPages": return "SECTIONPAGES";
    case "date": return pic("DATE", kind.value.format);
    case "time": return pic("TIME", kind.value.format);
    case "saveDate": return pic("SAVEDATE", kind.value.format);
    case "fileName": return "FILENAME";
    case "author": return "AUTHOR";
    case "title": return "TITLE";
    case "subject": return "SUBJECT";
    case "keywords": return "KEYWORDS";
    case "comments": return "COMMENTS";
    case "lastSavedBy": return "LASTSAVEDBY";
    case "docProperty": return `DOCPROPERTY ${quoted(kind.value.name)}`;
    case "ref": {
      const v = kind.value;
      return `REF ${v.bookmark}${sw([[v.number, "\\n"], [v.relative, "\\r"], [v.full, "\\w"], [v.position, "\\p"], [v.hyperlink, "\\h"]])}`;
    }
    case "pageRef": return `PAGEREF ${kind.value.bookmark}${sw([[kind.value.hyperlink, "\\h"]])}`;
    case "noteRef": return `NOTEREF ${kind.value.bookmark}${sw([[kind.value.formatted, "\\f"], [kind.value.hyperlink, "\\h"]])}`;
    case "seq": {
      const v = kind.value;
      const fmt = (v.format && SEQ_FORMATS[v.format]) || "ARABIC";
      let s = `SEQ ${v.identifier} \\* ${fmt}`;
      if (v.current) s += " \\c";
      if (v.reset != null) s += ` \\r ${v.reset}`;
      if (v.headingReset != null) s += ` \\s ${v.headingReset}`;
      if (v.hidden) s += " \\h";
      return s;
    }
    case "styleRef": return `STYLEREF "${kind.value.style}"${sw([[kind.value.last, "\\l"], [kind.value.number, "\\n"]])}`;
  }
}

/** What Alt+F9 shows for a field: `{ PAGE }`. */
export const fieldCode = (kind: FieldKind): string => `{ ${fieldInstruction(kind)} }`;

// ----- field codes view ----------------------------------------------------------------

interface CodesState {
  /** Alt+F9: every field shows its code. */
  all: boolean;
  /** Shift+F9: fields (positions, mapped through edits) toggled against `all`. */
  toggled: number[];
  deco: DecorationSet;
}

export const fieldCodesKey = new PluginKey<CodesState>("rusuiteFieldCodes");

type CodesMeta = { all: boolean } | { toggle: number[] };

function codeDecorations(doc: PMNode, all: boolean, toggled: number[]): DecorationSet {
  const flip = new Set(toggled);
  const out: Decoration[] = [];
  if (!all && !flip.size) return DecorationSet.empty;
  doc.descendants((n, pos) => {
    if (n.type.name !== "field") return true;
    if (all !== flip.has(pos)) out.push(Decoration.node(pos, pos + 1, { class: "field-show-code", "data-code": fieldCode(n.attrs.kind as FieldKind) }));
    return false;
  });
  return DecorationSet.create(doc, out);
}

/** Positions of the fields between `from` and `to` (the field at the caret when empty). */
export function fieldsIn(doc: PMNode, from: number, to: number): number[] {
  const out: number[] = [];
  const a = Math.max(0, from === to ? from - 1 : from);
  const b = Math.min(doc.content.size, from === to ? to + 1 : to);
  doc.nodesBetween(a, b, (n, pos) => {
    if (n.type.name === "field") out.push(pos);
    return true;
  });
  return out;
}

export function fieldCodesPlugin(): Plugin<CodesState> {
  return new Plugin<CodesState>({
    key: fieldCodesKey,
    state: {
      init: () => ({ all: false, toggled: [], deco: DecorationSet.empty }),
      apply(tr: Transaction, prev: CodesState): CodesState {
        const meta = tr.getMeta(fieldCodesKey) as CodesMeta | undefined;
        let { all, toggled } = prev;
        if (tr.docChanged) toggled = toggled.map((p) => tr.mapping.mapResult(p).pos).filter((p, i, a) => a.indexOf(p) === i && tr.doc.nodeAt(p)?.type.name === "field");
        if (meta && "all" in meta) {
          all = meta.all;
          toggled = [];
        } else if (meta && "toggle" in meta) {
          const set = new Set(toggled);
          // Word: Shift+F9 on several fields shows all their codes (or results) together.
          const show = meta.toggle.some((p) => all === set.has(p));
          for (const p of meta.toggle) {
            const shown = all !== set.has(p);
            if (shown !== show) {
              if (set.has(p)) set.delete(p);
              else set.add(p);
            }
          }
          toggled = [...set];
        }
        if (!meta && !tr.docChanged) return prev;
        return { all, toggled, deco: codeDecorations(tr.doc, all, toggled) };
      },
    },
    props: {
      decorations: (state) => fieldCodesKey.getState(state)?.deco ?? null,
    },
  });
}

/** Whether every field shows its code (Alt+F9). */
export const showsAllCodes = (state: EditorState): boolean => fieldCodesKey.getState(state)?.all ?? false;

/** Alt+F9: toggles the codes of all fields. */
export function toggleAllFieldCodes(state: EditorState): Transaction {
  return state.tr.setMeta(fieldCodesKey, { all: !showsAllCodes(state) } satisfies CodesMeta).setMeta("addToHistory", false);
}

/** Shift+F9: toggles the codes of the selection's fields (null when there are none). */
export function toggleSelectedFieldCodes(state: EditorState): Transaction | null {
  const { from, to } = state.selection;
  const fields = fieldsIn(state.doc, from, to);
  if (!fields.length) return null;
  return state.tr.setMeta(fieldCodesKey, { toggle: fields } satisfies CodesMeta).setMeta("addToHistory", false);
}

// ----- lock -------------------------------------------------------------------------

/** Ctrl+F11 / Ctrl+Shift+F11: `LockFields` for the selection's paragraphs (all with Ctrl+A). */
export function lockFieldsCommand(state: EditorState, locked: boolean, all: boolean): WriteCommand | null {
  if (all) return { type: "lockFields", locked };
  const blocks: number[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isTextblock) {
      const id = n.attrs.id as number | null;
      if (id != null && id > 0) blocks.push(id);
      return false;
    }
    return true;
  });
  return blocks.length ? { type: "lockFields", blocks, locked } : null;
}

// ----- STYLEREF / SECTIONPAGES per page ------------------------------------------------------

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** Whether a textblock is in `style` (its id or name, ignoring spaces and case; `1` = Heading 1). */
export function inStyle(node: PMNode, style: string, names?: (id: string) => string | undefined): boolean {
  const id = styleOf(node);
  const want = /^\d$/.test(style.trim()) ? `heading${style.trim()}` : norm(style);
  return norm(id) === want || (names ? norm(names(id) ?? "") === want : false);
}

/** The text a textblock shows (field results for fields). */
function shown(n: PMNode): string {
  let s = "";
  n.forEach((c) => {
    if (c.isText) s += c.text;
    else if (c.type.name === "field") s += String(c.attrs.cached ?? "");
  });
  return s.trim();
}

/**
 * Word's STYLEREF in a header: the first (`last`: the last) paragraph in
 * `style` on the page `[from, to)`, else the nearest one before the page,
 * else null.
 */
export function styleRefOnPage(doc: PMNode, from: number, to: number, style: string, last: boolean, names?: (id: string) => string | undefined): string | null {
  let before: string | null = null;
  let first: string | null = null;
  let lastOn: string | null = null;
  doc.descendants((n, pos) => {
    if (n.type.name === "notes") return false;
    if (!TEXTBLOCK_TYPES.has(n.type.name)) return true;
    if (inStyle(n, style, names)) {
      const text = shown(n);
      if (pos < from) before = text;
      else if (pos < to) {
        first ??= text;
        lastOn = text;
      }
    }
    return false;
  });
  return (last ? lastOn : first) ?? before;
}
