// Syntax check of formula text, a port of the grammar of
// `engine-formula/src/parser.rs` (no AST is built). Used to keep the
// editor open with an inline message instead of sending a formula the
// core would reject; the core's `invalid_formula` reply stays the
// authority (see `CalcStore.commitEdit`).

import { t } from "../i18n";
import { isValidName } from "../names/names";
import { referenceAt } from "./refs";
import { isFormula, tokenize, type LexError, type Tok, type TokKind } from "./tokenize";

const PUNCT: Partial<Record<TokKind, string>> = {
  bang: "!", colon: ":", comma: ",", semicolon: ";", lparen: "(", rparen: ")", lbrace: "{", rbrace: "}", dollar: "$",
  plus: "+", minus: "-", star: "*", slash: "/", caret: "^", amp: "&", eq: "=", ne: "<>", lt: "<", le: "<=", gt: ">", ge: ">=",
  percent: "%", at: "@", hash: "#",
};

function describe(t: Tok): string {
  switch (t.kind) {
    case "number":
      return `number \`${Number(t.text.replace(/\.(?=[eE]|$)/, ""))}\``;
    case "string":
      return "string";
    case "ident":
      return `identifier \`${t.text}\``;
    case "error":
      return `error literal \`${t.text.toUpperCase()}\``;
    case "sheet":
      return `sheet name \`${t.text}\``;
    case "struct":
      return "structured reference";
    default:
      return `\`${PUNCT[t.kind]}\``;
  }
}

const INFIX: Partial<Record<TokKind, number>> = {
  eq: 1, ne: 1, lt: 1, le: 1, gt: 1, ge: 1, amp: 3, plus: 5, minus: 5, star: 7, slash: 7, caret: 9, colon: 15,
};
const BP_PREFIX = 11;
const BP_PERCENT = 13;
const BP_AT = 14;
const BP_SPILL = 17;

class Parser {
  pos = 0;
  constructor(readonly text: string, readonly toks: Tok[]) {}

  peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  here(): number {
    return this.toks[this.pos]?.start ?? this.text.length;
  }

  unexpected(): LexError {
    const t = this.peek();
    return t ? { pos: t.start, message: `unexpected ${describe(t)}` } : { pos: this.text.length, message: "unexpected end of formula" };
  }

  expected(what: string): LexError {
    const e = this.unexpected();
    return { pos: e.pos, message: `expected ${what}, found ${e.message.replace(/^unexpected /, "")}` };
  }

  expect(kind: TokKind, what: string): void {
    if (this.peek()?.kind !== kind) throw this.expected(what);
    this.pos++;
  }

  /** Parses an expression; `true` when it is a spilled range (`…#`, which cannot take another `#`). */
  expr(minBp: number): boolean {
    let spilled = this.prefix();
    for (let t = this.peek(); t; t = this.peek()) {
      if (t.kind === "percent" || t.kind === "hash") {
        if ((t.kind === "percent" ? BP_PERCENT : BP_SPILL) < minBp) break;
        if (t.kind === "hash" && spilled) throw this.unexpected();
        spilled = t.kind === "hash";
        this.pos++;
        continue;
      }
      const lbp = INFIX[t.kind];
      if (lbp === undefined || lbp < minBp) break;
      this.pos++;
      this.expr(lbp + 1);
      spilled = false;
    }
    return spilled;
  }

  prefix(): boolean {
    const k = this.peek()?.kind;
    if (k !== "minus" && k !== "plus" && k !== "at") return this.primary();
    this.pos++;
    this.expr(k === "at" ? BP_AT : BP_PREFIX);
    return false;
  }

  primary(): boolean {
    const t = this.peek();
    if (!t) throw this.unexpected();
    switch (t.kind) {
      case "string":
      case "error":
      case "struct":
        this.pos++;
        return false;
      case "lparen": {
        this.pos++;
        const spilled = this.expr(0);
        this.expect("rparen", "`)`");
        return spilled;
      }
      case "lbrace":
        this.array();
        return false;
      case "sheet": {
        this.pos++;
        this.expect("bang", "`!`");
        let ref: ReturnType<typeof referenceAt> = null;
        let failure: unknown = null;
        try {
          ref = referenceAt(this.text, this.toks, this.pos, t.text, t.start);
        } catch (e) {
          failure = e;
        }
        if (ref) {
          this.pos = ref.nextTok;
          return false;
        }
        // `Sheet1!Tax`: a sheet-level defined name.
        const n = this.peek();
        if (n?.kind === "ident" && this.toks[this.pos + 1]?.kind !== "lparen" && isValidName(n.text)) {
          this.pos++;
          return false;
        }
        if (failure) throw failure;
        throw { pos: this.here(), message: "expected a cell, column or row reference after sheet name" };
      }
      case "ident":
      case "number":
      case "dollar": {
        if (t.kind === "ident" && this.toks[this.pos + 1]?.kind === "lparen") {
          this.pos += 2;
          this.call(t.text.toUpperCase());
          return false;
        }
        const ref = referenceAt(this.text, this.toks, this.pos, null, t.start);
        if (ref) {
          this.pos = ref.nextTok;
          return false;
        }
        if (t.kind === "dollar") throw { pos: this.here(), message: "expected a reference after `$`" };
        this.pos++;
        return false;
      }
      default:
        throw this.unexpected();
    }
  }

  call(name: string): void {
    if (this.peek()?.kind === "rparen") {
      this.pos++;
      return;
    }
    for (;;) {
      const k = this.peek()?.kind;
      if (k !== "comma" && k !== "rparen") this.expr(0);
      const n = this.peek()?.kind;
      if (n === "comma") this.pos++;
      else if (n === "rparen") {
        this.pos++;
        return;
      } else throw this.expected(`\`,\` or \`)\` in call to ${name}`);
    }
  }

  array(): void {
    const start = this.here();
    this.pos++;
    const rows: number[] = [0];
    for (;;) {
      this.arrayElement();
      rows[rows.length - 1]++;
      const k = this.peek()?.kind;
      if (k === "comma") this.pos++;
      else if (k === "semicolon") {
        this.pos++;
        rows.push(0);
      } else if (k === "rbrace") {
        this.pos++;
        break;
      } else throw this.expected("`,`, `;` or `}` in array");
    }
    if (rows.some((n) => n !== rows[0])) throw { pos: start, message: "array rows have different lengths" };
  }

  arrayElement(): void {
    let signed = false;
    const k = this.peek()?.kind;
    if (k === "minus" || k === "plus") {
      this.pos++;
      signed = true;
    }
    const t = this.peek();
    const ok =
      t?.kind === "number" ||
      (!signed && (t?.kind === "string" || t?.kind === "error" || (t?.kind === "ident" && /^(TRUE|FALSE)$/i.test(t.text))));
    if (!ok) throw { pos: this.here(), message: "array elements must be numbers, strings, booleans or error literals" };
    this.pos++;
  }
}

/** The first syntax error of a formula, or `null` (also for non-formula input). */
export function checkFormula(text: string): LexError | null {
  if (!isFormula(text)) return null;
  const { tokens, error } = tokenize(text);
  if (error) return error;
  if (tokens.length === 0) return { pos: text.length, message: "empty formula" };
  const p = new Parser(text, tokens);
  try {
    p.expr(0);
    const t = p.peek();
    if (t) return { pos: t.start, message: `unexpected ${describe(t)} after expression` };
    return null;
  } catch (e) {
    if (e && typeof e === "object" && "pos" in e && "message" in e) return e as LexError;
    throw e;
  }
}

/** The inline message shown for a formula that cannot be committed. */
export function formulaErrorMessage(message: string): string {
  const m = message.replace(/\s+at position \d+$/, "").replace(/^.*parse error:\s*/i, "");
  return t("calc.formulaError", { message: `${m.charAt(0).toUpperCase()}${m.slice(1)}` });
}
