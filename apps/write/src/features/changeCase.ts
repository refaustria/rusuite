// Home › Font › Change Case (Word): the commands for the selection
// (Rust's `ChangeCase` per paragraph, formatting kept) and the same
// transformation in TypeScript (the test backend; previews).

import type { Editor } from "@tiptap/core";
import type { TextCase } from "../generated/TextCase";
import type { WriteCommand } from "../generated/WriteCommand";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { charOffsetOf } from "../sync/SyncPlugin";

export const TEXT_CASES: TextCase[] = ["sentence", "lower", "upper", "capitalize", "toggle"];

const isLetter = (c: string) => /\p{L}/u.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}']/u.test(c);
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase();

/** Whether the letter at `i` starts a sentence (paragraph start, or `. ! ?` and a space before it). */
function sentenceStart(chars: string[], i: number): boolean {
  let spaced = false;
  for (let j = i - 1; j >= 0; j--) {
    const c = chars[j]!;
    if (/\s/u.test(c)) spaced = true;
    else if (c === "." || c === "!" || c === "?") return spaced;
    else if (!`"'([“‘«„﻿`.includes(c)) return false;
  }
  return true;
}

/** `chars[i]` in `kind` (the whole paragraph's characters give the context). */
export function caseChar(chars: string[], i: number, kind: TextCase): string {
  const c = chars[i]!;
  switch (kind) {
    case "upper":
      return c.toUpperCase();
    case "lower":
      return c.toLowerCase();
    case "toggle":
      return isUpper(c) ? c.toLowerCase() : isLower(c) ? c.toUpperCase() : c;
    case "capitalize":
      return i === 0 || !isWordChar(chars[i - 1]!) ? c.toUpperCase() : c.toLowerCase();
    case "sentence":
      return isLetter(c) && sentenceStart(chars, i) ? c.toUpperCase() : c.toLowerCase();
  }
}

/** The text with positions `from..to` in `kind`. */
export function changeCase(text: string, kind: TextCase, from = 0, to = [...text].length): string {
  const chars = [...text];
  return chars.map((c, i) => (i >= from && i < to ? caseChar(chars, i, kind) : c)).join("");
}

/** Change Case for the selection: one `ChangeCase` per touched paragraph (the word at the caret when empty), or null. */
export function changeCaseCommand(editor: Editor, kind: TextCase): WriteCommand | null {
  const { state } = editor;
  let { from, to } = state.selection;
  if (from === to) {
    // Word changes the word at the caret.
    const $p = state.selection.$from;
    const text = $p.parent.textBetween(0, $p.parent.content.size, undefined, "￼");
    let a = $p.parentOffset;
    let b = $p.parentOffset;
    while (a > 0 && isWordChar(text[a - 1]!)) a--;
    while (b < text.length && isWordChar(text[b]!)) b++;
    if (a === b) {
      // After a sentence's end (`end.|`): the word before the punctuation (Word).
      const m = /([\p{L}\p{N}']+)[^\p{L}\p{N}'\s]*$/u.exec(text.slice(0, $p.parentOffset));
      if (!m) return null;
      a = m.index;
      b = a + m[1]!.length;
    }
    from = $p.start() + a;
    to = $p.start() + b;
  }
  const cmds: WriteCommand[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!TEXTBLOCK_TYPES.has(node.type.name)) return true;
    const id = node.attrs.id as number | null;
    if (id == null || id < 0) return false;
    const start = pos + 1;
    const a = charOffsetOf(node, Math.max(0, from - start));
    const b = charOffsetOf(node, Math.min(node.content.size, to - start));
    if (b > a) cmds.push({ type: "changeCase", block: id, from: a, to: b, case: kind });
    return false;
  });
  if (!cmds.length) return null;
  return cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds };
}
