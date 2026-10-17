// Word's "Words only" underline (`w:u w:val="words"`, Ctrl+Shift+W): CSS
// cannot leave the spaces of an underlined span out, so the underline mark
// of kind "words" draws nothing itself (`u[data-u="words"]` in styles.css)
// and this plugin underlines the words in it with inline decorations.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const wordsUnderlineKey = new PluginKey<DecorationSet>("rusuiteWordsUnderline");

/** The `[from, to)` ranges of the words (no whitespace) of the text nodes with a "words" underline in `doc` (between `from` and `to`). */
export function wordsUnderlineRanges(doc: PMNode, from = 0, to = doc.content.size): [number, number][] {
  const out: [number, number][] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    if (!node.marks.some((m) => m.type.name === "underline" && m.attrs.kind === "words")) return false;
    const re = /\S+/gu;
    for (let m = re.exec(node.text!); m; m = re.exec(node.text!)) out.push([pos + m.index, pos + m.index + m[0].length]);
    return false;
  });
  return out;
}

const deco = (ranges: [number, number][]) => ranges.map(([a, b]) => Decoration.inline(a, b, { class: "u-word" }));

function build(doc: PMNode): DecorationSet {
  const ranges = wordsUnderlineRanges(doc);
  return ranges.length ? DecorationSet.create(doc, deco(ranges)) : DecorationSet.empty;
}

/** Recomputes the decorations of the textblocks a transaction changed (the rest is mapped). */
function update(tr: Transaction, old: DecorationSet): DecorationSet {
  let set = old.map(tr.mapping, tr.doc);
  const doc = tr.doc;
  let lo = Infinity;
  let hi = -Infinity;
  tr.mapping.maps.forEach((map, i) => {
    map.forEach((_a, _b, start, end) => {
      const rest = tr.mapping.slice(i + 1);
      lo = Math.min(lo, rest.map(start, -1));
      hi = Math.max(hi, rest.map(end, 1));
    });
  });
  // Mark-only steps (AddMark / RemoveMark) have empty maps: take the whole document then.
  if (lo > hi) return build(doc);
  const a = doc.resolve(Math.max(0, Math.min(lo, doc.content.size)));
  const b = doc.resolve(Math.max(0, Math.min(hi, doc.content.size)));
  const from = a.depth > 0 ? a.before(1) : 0;
  const to = b.depth > 0 ? b.after(1) : doc.content.size;
  set = set.remove(set.find(from, to));
  const ranges = wordsUnderlineRanges(doc, from, to);
  return ranges.length ? set.add(doc, deco(ranges)) : set;
}

export function wordsUnderlinePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: wordsUnderlineKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? update(tr, old) : old),
    },
    props: {
      decorations: (state) => wordsUnderlineKey.getState(state),
    },
  });
}
