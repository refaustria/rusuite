// Formula tokenizer mirroring `engine-formula/src/lexer.rs` (Excel en-US
// syntax). Unlike the Rust lexer it never throws: lexing stops at the
// first error, which is reported next to the tokens read so far, so a
// half-typed formula can still be coloured and analysed.

export type TokKind =
  | "number" | "string" | "ident" | "error" | "sheet"
  | "bang" | "colon" | "comma" | "semicolon" | "lparen" | "rparen" | "lbrace" | "rbrace" | "dollar"
  | "plus" | "minus" | "star" | "slash" | "caret" | "amp"
  | "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "percent"
  /** `@` (implicit intersection). */
  | "at"
  /** `#` that does not start an error literal: the spilled-range operator (`A1#`). */
  | "hash"
  /** A structured reference: an optional table name and a balanced `[...]` (`Table1[Qty]`, `[@Qty]`). */
  | "struct";

export interface Tok {
  kind: TokKind;
  /** `[start, end)` into the formula text (the leading `=` included). */
  start: number;
  end: number;
  /** Source text of the token (sheet names: unquoted and unescaped). */
  text: string;
}

export interface LexError {
  pos: number;
  message: string;
}

export interface Lexed {
  tokens: Tok[];
  error: LexError | null;
}

/** Excel error literals, as in `ErrorKind::ALL`. */
export const ERROR_LITERALS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!"];

const SIMPLE: Record<string, TokKind> = {
  "!": "bang", ":": "colon", ",": "comma", ";": "semicolon", "(": "lparen", ")": "rparen",
  "{": "lbrace", "}": "rbrace", "$": "dollar", "+": "plus", "-": "minus", "*": "star", "/": "slash",
  "^": "caret", "&": "amp", "%": "percent", "=": "eq", "@": "at",
};

export const isIdentStart = (c: string) => /^[\p{L}_\\]$/u.test(c);
/** Defined names may also contain backslashes and `?`. */
export const isIdentContinue = (c: string) => /^[\p{L}\p{N}_.\\?]$/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/** `true` when the input is a formula (starts with `=`). */
export const isFormula = (text: string) => text.startsWith("=");

/** The end (exclusive) of the bracket group opening at `start` (`'` escapes a character); `-1` when unterminated. */
export function bracketEnd(text: string, start: number): number {
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (c === "'") {
      j++;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/**
 * Tokenizes `text`. A leading `=` is skipped; spans are offsets into
 * `text` itself. Whitespace produces no tokens.
 */
export function tokenize(text: string): Lexed {
  const tokens: Tok[] = [];
  let i = text.startsWith("=") ? 1 : 0;
  const push = (kind: TokKind, start: number, end: number, value = text.slice(start, end)) => {
    tokens.push({ kind, start, end, text: value });
    i = end;
  };
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const c = String.fromCodePoint(cp);
    if (/^\s$/u.test(c)) {
      i += c.length;
      continue;
    }
    const start = i;
    const next = text[i + 1];
    if (c === "<") {
      if (next === ">") push("ne", start, start + 2);
      else if (next === "=") push("le", start, start + 2);
      else push("lt", start, start + 1);
    } else if (c === ">") {
      if (next === "=") push("ge", start, start + 2);
      else push("gt", start, start + 1);
    } else if (c === "[") {
      const end = bracketEnd(text, start);
      if (end < 0) return { tokens, error: { pos: start, message: "unterminated structured reference" } };
      push("struct", start, end);
    } else if (SIMPLE[c]) {
      push(SIMPLE[c], start, start + 1);
    } else if (c === '"') {
      let j = start + 1;
      let out = "";
      let closed = false;
      while (j < text.length) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        out += text[j++];
      }
      if (!closed) return { tokens, error: { pos: start, message: "unterminated string literal" } };
      push("string", start, j, out);
    } else if (c === "'") {
      let j = start + 1;
      let out = "";
      let end = -1;
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            out += "'";
            j += 2;
            continue;
          }
          end = j + 1;
          break;
        }
        out += text[j++];
      }
      if (end < 0) return { tokens, error: { pos: start, message: "unterminated quoted sheet name" } };
      if (out === "") return { tokens, error: { pos: start, message: "empty sheet name" } };
      if (text[end] !== "!") return { tokens, error: { pos: end, message: "expected `!` after quoted sheet name" } };
      push("sheet", start, end, out);
    } else if (c === "#") {
      const rest = text.slice(start).toUpperCase();
      const lit = ERROR_LITERALS.find((e) => rest.startsWith(e));
      // Not an error literal: the spilled-range operator.
      if (lit) push("error", start, start + lit.length);
      else push("hash", start, start + 1);
    } else if (isDigit(c) || (c === "." && isDigit(next))) {
      let j = start;
      while (isDigit(text[j])) j++;
      if (text[j] === ".") {
        j++;
        while (isDigit(text[j])) j++;
      }
      if (text[j] === "e" || text[j] === "E") {
        let k = j + 1;
        if (text[k] === "+" || text[k] === "-") k++;
        if (isDigit(text[k])) {
          j = k;
          while (isDigit(text[j])) j++;
        }
      }
      const n = Number(text.slice(start, j).replace(/\.(?=[eE]|$)/, ""));
      if (!Number.isFinite(n)) return { tokens, error: { pos: start, message: `number out of range \`${text.slice(start, j)}\`` } };
      push("number", start, j);
    } else if (isIdentStart(c)) {
      let j = start + c.length;
      while (j < text.length) {
        const d = String.fromCodePoint(text.codePointAt(j)!);
        if (!isIdentContinue(d)) break;
        j += d.length;
      }
      if (text[j] === "[") {
        const end = bracketEnd(text, j);
        if (end < 0) return { tokens, error: { pos: j, message: "unterminated structured reference" } };
        push("struct", start, end);
        continue;
      }
      push(text[j] === "!" ? "sheet" : "ident", start, j);
    } else {
      return { tokens, error: { pos: start, message: `unexpected character \`${c}\`` } };
    }
  }
  return { tokens, error: null };
}
