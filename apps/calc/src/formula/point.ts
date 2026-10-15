// Caret analysis of formula text: where a pointed reference goes (Excel's
// "point mode"), which function name is being typed, and which call /
// argument the caret is in.

import { findRefs } from "./refs";
import { isFormula, tokenize, type Tok, type TokKind } from "./tokenize";

export interface Span {
  start: number;
  end: number;
}

/** Tokens after which an operand (a reference, a function) may follow. */
const OPERAND_BEFORE = new Set<TokKind>([
  "plus", "minus", "star", "slash", "caret", "amp", "eq", "ne", "lt", "le", "gt", "ge", "lparen", "comma", "semicolon", "at",
]);

/** Characters that may follow an inserted reference directly. */
const FOLLOW = /^[\s)+\-*/^&=<>,;%:}]$/;

function lastBefore(tokens: Tok[], pos: number): Tok | undefined {
  let prev: Tok | undefined;
  for (const t of tokens) {
    if (t.end > pos) break;
    prev = t;
  }
  return prev;
}

/**
 * Point mode: the span a clicked / arrowed reference replaces when the
 * caret is at `caret`, or `null` when pointing is not possible there. The
 * span is the reference under the caret, or an empty span at the caret
 * after `=`, an operator, `(` or `,`.
 */
export function pointSpan(text: string, caret: number): Span | null {
  if (!isFormula(text) || caret < 1) return null;
  const { tokens, error } = tokenize(text);
  if (error && error.pos < caret) return null;
  const ref = findRefs(text).find((r) => r.start <= caret && caret <= r.end);
  if (ref) return { start: ref.start, end: ref.end };
  if (tokens.some((t) => t.start < caret && caret < t.end)) return null;
  const after = text[caret];
  if (after !== undefined && !FOLLOW.test(after)) return null;
  const prev = lastBefore(tokens, caret);
  if (!prev || OPERAND_BEFORE.has(prev.kind)) return { start: caret, end: caret };
  return null;
}

/** Replaces `span` by `insert`; the caret goes after the insertion. */
export function replaceSpan(text: string, span: Span, insert: string): { text: string; caret: number } {
  return { text: text.slice(0, span.start) + insert + text.slice(span.end), caret: span.start + insert.length };
}

/**
 * The function name being typed: an identifier ending at the caret in an
 * operand position (after `=`, an operator, `(` or `,`) and not already
 * followed by `(`. `null` otherwise.
 */
export function functionPrefix(text: string, caret: number): (Span & { prefix: string }) | null {
  if (!isFormula(text)) return null;
  const { tokens } = tokenize(text);
  const t = tokens.find((x) => x.end === caret && x.kind === "ident");
  if (!t || !/^[A-Za-z_]/.test(t.text)) return null;
  const i = tokens.indexOf(t);
  const prev = tokens[i - 1];
  if (prev && !OPERAND_BEFORE.has(prev.kind)) return null;
  if (tokens[i + 1]?.kind === "lparen") return null;
  return { start: t.start, end: t.end, prefix: t.text };
}

/** The innermost function call around the caret and the 0-based argument the caret is in. */
export function callAt(text: string, caret: number): { name: string; arg: number; start: number } | null {
  if (!isFormula(text)) return null;
  const { tokens } = tokenize(text);
  const stack: { name: string | null; arg: number; start: number }[] = [];
  for (let i = 0; i < tokens.length && tokens[i].end <= caret; i++) {
    const t = tokens[i];
    if (t.kind === "lparen") {
      const prev = tokens[i - 1];
      stack.push({ name: prev?.kind === "ident" ? prev.text.toUpperCase() : null, arg: 0, start: t.start });
    } else if (t.kind === "lbrace") stack.push({ name: null, arg: 0, start: t.start });
    else if (t.kind === "rparen" || t.kind === "rbrace") stack.pop();
    else if (t.kind === "comma" && stack.length) stack[stack.length - 1].arg++;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    if (f.name) return { name: f.name, arg: f.arg, start: f.start };
  }
  return null;
}
