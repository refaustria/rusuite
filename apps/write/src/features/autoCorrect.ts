// AutoCorrect as you type (Word's defaults; Options › Proofing ›
// AutoCorrect Options toggles them): straight quotes become smart quotes
// (German „…“ / ‚…‘ in a German UI, “…” / ‘…’ otherwise), " -- " becomes an
// en dash and "word--word" an em dash when the next space is typed, (c) (r)
// (tm) become © ® ™ and "..." an ellipsis at once; ordinals (1st, 2nd …) get
// a superscript suffix only when that option is on (off by default). The
// replacement is part of the typing transaction (one Rust command, one
// undo step).

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { AutoCorrectOptions } from "./writeOptions";

export const autoCorrectKey = new PluginKey("rusuiteAutoCorrect");

/** The quote characters for a language: [open double, close double, open single, close single]. */
export function quotesFor(lang: string | null | undefined): [string, string, string, string] {
  const l = (lang ?? "").toLowerCase();
  if (l.startsWith("de")) return ["„", "“", "‚", "‘"];
  return ["“", "”", "‘", "’"];
}

/** Whether a quote typed after `before` opens (start, space, opening bracket or dash before it). */
export const opensQuote = (before: string): boolean => before === "" || /[\s([{–— "'„“‚‘-]$/.test(before);

/** The smart quote for `ch` (`"` or `'`) typed after `before`; an apostrophe inside a word closes. */
export function smartQuote(ch: string, before: string, lang: string | null | undefined): string {
  const [od, cd, os, cs] = quotesFor(lang);
  const open = opensQuote(before);
  if (ch === '"') return open ? od : cd;
  // English apostrophe and closing single quote are the same character.
  return open ? os : lang?.toLowerCase().startsWith("de") ? "’" : cs;
}

const REPLACE: [string, string][] = [
  ["(c)", "©"],
  ["(r)", "®"],
  ["(tm)", "™"],
  ["...", "…"],
];

export interface Correction {
  /** Characters before the typed text to replace (0: none). */
  remove: number;
  /** The text inserted instead of the typed text and the removed characters. */
  text: string;
  /** Superscript this many characters at the end of the inserted text (ordinals). */
  superscript?: number;
}

/**
 * What typing `text` after `before` (the paragraph's text up to the caret) turns into, or null for no change.
 * Pure: the plugin applies it.
 */
export function correction(before: string, text: string, o: AutoCorrectOptions, lang: string | null | undefined): Correction | null {
  if (text.length !== 1) return null;
  if (o.smartQuotes && (text === '"' || text === "'")) return { remove: 0, text: smartQuote(text, before, lang) };
  if (o.replaceText) {
    const s = (before + text).toLowerCase();
    for (const [from, to] of REPLACE) {
      if (s.endsWith(from)) return { remove: from.length - 1, text: to };
    }
  }
  if (/\s/.test(text)) {
    if (o.dashes) {
      // "word -- word" → en dash; "word--word" → em dash (Word applies both when the word after them ends).
      const en = /\S -- (\S+)$/.exec(before);
      if (en) {
        const word = en[1]!;
        return { remove: word.length + 3, text: `– ${word}${text}` };
      }
      const em = /(\w)--(\w+)$/.exec(before);
      if (em) {
        const word = em[2]!;
        return { remove: word.length + 2, text: `—${word}${text}` };
      }
    }
    if (o.ordinals) {
      const m = /(?:^|\s)(\d*(?:1st|2nd|3rd|[04-9]th|1[123]th))$/.exec(before);
      if (m) {
        const word = m[1]!;
        return { remove: word.length, text: `${word}${text}`, superscript: 2 };
      }
    }
  }
  return null;
}

/** The plugin: corrections of typed text (not in code or while composing). */
export function autoCorrectPlugin(options: () => AutoCorrectOptions, lang: () => string): Plugin {
  return new Plugin({
    key: autoCorrectKey,
    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (view.composing) return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
        const c = correction(before, text, options(), lang());
        if (!c) return false;
        const start = from - c.remove;
        if (start < $from.start()) return false;
        const marks = view.state.storedMarks ?? $from.marks();
        const tr = view.state.tr.replaceWith(start, to, view.state.schema.text(c.text, marks));
        if (c.superscript) {
          // The ordinal's suffix (the two letters before the typed space).
          const sup = view.state.schema.marks.superscript;
          const end = start + c.text.length - text.length;
          if (sup) tr.addMark(end - 2, end, sup.create());
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}
