import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { activeArg, applyFunction, matchFunctions, signatureArgs, FUNCTIONS } from "./functions";
import { callAt, functionPrefix, pointSpan, replaceSpan } from "./point";
import { colorRefs, cycleAnchor, findRefs, rangeText, REF_COLORS } from "./refs";
import { tokenize } from "./tokenize";
import { checkFormula, formulaErrorMessage } from "./validate";

const refTexts = (f: string) => findRefs(f).map((r) => f.slice(r.start, r.end));

describe("tokenizer", () => {
  it("lexes like the core's lexer, with spans into the full text", () => {
    const { tokens, error } = tokenize(`=SUM( A1 ,"x""y")<>'a b'!B2`);
    expect(error).toBeNull();
    expect(tokens.map((t) => [t.kind, t.start, t.end])).toEqual([
      ["ident", 1, 4], ["lparen", 4, 5], ["ident", 6, 8], ["comma", 9, 10], ["string", 10, 16], ["rparen", 16, 17],
      ["ne", 17, 19], ["sheet", 19, 24], ["bang", 24, 25], ["ident", 25, 27],
    ]);
    expect(tokens[7].text).toBe("a b");
  });

  it("stops at a lexing error but keeps the tokens before it", () => {
    const { tokens, error } = tokenize(`=A1&"abc`);
    expect(tokens.map((t) => t.kind)).toEqual(["ident", "amp"]);
    expect(error).toEqual({ pos: 4, message: "unterminated string literal" });
  });
});

describe("references", () => {
  it("finds cells, areas, columns, rows and sheet-qualified references", () => {
    expect(refTexts("=A1+$B$2*C$3-$D4")).toEqual(["A1", "$B$2", "C$3", "$D4"]);
    expect(refTexts("=SUM(A1:B3,A:C,2:4)")).toEqual(["A1:B3", "A:C", "2:4"]);
    expect(refTexts("=Sheet2!A1+'My Sheet'!B2:C3+Data!A1:Data!B2")).toEqual(["Sheet2!A1", "'My Sheet'!B2:C3", "Data!A1:Data!B2"]);
    const [r] = findRefs("='My Sheet'!B2:C3");
    expect(r.sheet).toBe("My Sheet");
    expect(r.range).toEqual({ r0: 1, c0: 1, r1: 2, c1: 2 });
  });

  it("ignores function names, strings, long identifiers and bare columns", () => {
    expect(refTexts(`=LOG10(1)+"A1"&ABCD1+A+TRUE+SUM(1)`)).toEqual([]);
  });

  it("colours references in Excel's palette order; equal references share a colour", () => {
    const refs = colorRefs("=A1+B2+a1+Sheet2!A1");
    expect(refs.map((r) => r.color)).toEqual([REF_COLORS[0], REF_COLORS[1], REF_COLORS[0], REF_COLORS[2]]);
  });

  it("writes range text for cells, areas, whole columns and rows", () => {
    expect(rangeText({ r0: 0, c0: 0, r1: 0, c1: 0 })).toBe("A1");
    expect(rangeText({ r0: 0, c0: 0, r1: 2, c1: 1 })).toBe("A1:B3");
    expect(rangeText({ r0: 0, c0: 2, r1: 1_048_575, c1: 3 })).toBe("C:D");
    expect(rangeText({ r0: 4, c0: 0, r1: 4, c1: 16_383 })).toBe("5:5");
  });
});

describe("F4 anchoring", () => {
  it("cycles A1 → $A$1 → A$1 → $A1 → A1", () => {
    let text = "=A1+1";
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = cycleAnchor(text, 3)!;
      text = r.text;
      seen.push(text);
    }
    expect(seen).toEqual(["=$A$1+1", "=A$1+1", "=$A1+1", "=A1+1"]);
  });

  it("anchors both corners of a range and keeps the sheet prefix; the caret goes after the reference", () => {
    expect(cycleAnchor("=SUM(Data!A1:B2)", 15)).toEqual({ text: "=SUM(Data!$A$1:$B$2)", caret: 19 });
    expect(cycleAnchor("=A:C", 2)?.text).toBe("=$A:$C");
    expect(cycleAnchor("=1+2", 2)).toBeNull();
  });
});

describe("point mode detection", () => {
  it("allows pointing after =, an operator, ( and ,", () => {
    expect(pointSpan("=", 1)).toEqual({ start: 1, end: 1 });
    expect(pointSpan("=A1+", 4)).toEqual({ start: 4, end: 4 });
    expect(pointSpan("=SUM(", 5)).toEqual({ start: 5, end: 5 });
    expect(pointSpan("=SUM(A1, ", 9)).toEqual({ start: 9, end: 9 });
    expect(pointSpan("=SUM()", 5)).toEqual({ start: 5, end: 5 });
  });

  it("replaces the reference under the caret", () => {
    expect(pointSpan("=A1+B22", 7)).toEqual({ start: 4, end: 7 });
    expect(pointSpan("=A1+B22", 1)).toEqual({ start: 1, end: 3 });
    expect(pointSpan("=SUM(Sheet2!A1:B2)", 15)).toEqual({ start: 5, end: 17 });
  });

  it("does not point after an operand, inside names or strings, or outside formulas", () => {
    expect(pointSpan("=1", 2)).toBeNull();
    expect(pointSpan("=SUM", 4)).toBeNull();
    expect(pointSpan("=SU+M", 3)).toBeNull();
    expect(pointSpan(`="a+`, 4)).toBeNull();
    expect(pointSpan("=+X", 2)).toBeNull();
    expect(pointSpan("A1+", 3)).toBeNull();
  });

  it("inserts a reference at the span", () => {
    expect(replaceSpan("=SUM()", { start: 5, end: 5 }, "A1:A3")).toEqual({ text: "=SUM(A1:A3)", caret: 10 });
    expect(replaceSpan("=A1+B2", { start: 4, end: 6 }, "C3")).toEqual({ text: "=A1+C3", caret: 6 });
  });
});

describe("function autocomplete and signatures", () => {
  it("ships the documented functions", () => {
    expect(FUNCTIONS.length).toBeGreaterThanOrEqual(200);
    const doc = readFileSync(resolve(__dirname, "../../../../docs/functions.md"), "utf8");
    const documented = [...doc.matchAll(/^\| `([A-Z][A-Z0-9.]*)` \| `/gm)].map((m) => m[1]);
    expect(documented.length).toBe(FUNCTIONS.length);
    const names = new Set(FUNCTIONS.map((f) => f.name));
    expect(documented.filter((n) => !names.has(n))).toEqual([]);
    expect(FUNCTIONS.find((f) => f.name === "SUM")?.signature).toBe("SUM(number1, [number2], ...)");
  });

  it("lists the functions matching the typed prefix at a function position", () => {
    expect(functionPrefix("=1+co", 5)).toEqual({ start: 3, end: 5, prefix: "co" });
    expect(matchFunctions("co").map((f) => f.name)).toEqual(FUNCTIONS.map((x) => x.name).filter((n) => n.startsWith("CO")));
    expect(matchFunctions("A1")).toEqual([]);
    expect(functionPrefix("=SUM(", 5)).toBeNull();
    expect(functionPrefix("=A1 SU", 6)).toBeNull();
    expect(functionPrefix("SU", 2)).toBeNull();
  });

  it("accepting a function writes NAME( and puts the caret inside", () => {
    expect(applyFunction("=su", { start: 1, end: 3 }, "SUM")).toEqual({ text: "=SUM(", caret: 5 });
    expect(applyFunction("=1+ro(2)", { start: 3, end: 5 }, "ROUND")).toEqual({ text: "=1+ROUND(2)", caret: 9 });
  });

  it("finds the call and argument around the caret and the argument to emphasise", () => {
    expect(callAt("=SUM(A1,", 8)).toEqual({ name: "SUM", arg: 1, start: 4 });
    expect(callAt("=IF(SUM(1,2),", 13)?.name).toBe("IF");
    expect(callAt("=IF(SUM(1,2", 11)).toMatchObject({ name: "SUM", arg: 1 });
    expect(callAt("=IF((1,", 7)).toMatchObject({ name: "IF", arg: 0 });
    expect(callAt("=1+2", 4)).toBeNull();
    const sum = signatureArgs("SUM(number1, [number2], ...)");
    expect(sum).toEqual(["number1", "[number2]", "..."]);
    expect([0, 1, 5].map((i) => activeArg(sum, i))).toEqual([0, 1, 2]);
    expect(activeArg(signatureArgs("ROUND(number, digits)"), 2)).toBe(-1);
    expect(signatureArgs("PI()")).toEqual([]);
  });
});

describe("syntax check", () => {
  it("rejects incomplete formulas with the core's messages", () => {
    expect(checkFormula("=A1+")).toEqual({ pos: 4, message: "unexpected end of formula" });
    expect(checkFormula("=SUM(")?.message).toBe("unexpected end of formula");
    expect(checkFormula("=SUM(1")?.message).toBe("expected `,` or `)` in call to SUM, found end of formula");
    expect(checkFormula("=(1")?.message).toBe("expected `)`, found end of formula");
    expect(checkFormula("=1 2")?.message).toBe("unexpected number `2` after expression");
    expect(checkFormula("=")?.message).toBe("empty formula");
    expect(checkFormula("=XFE1")?.message).toBe("column `XFE` out of range");
    expect(checkFormula("=Sheet1!A1:Sheet2!B2")?.message).toBe("ranges spanning different sheets are not supported");
    expect(checkFormula("={1,2;3}")?.message).toBe("array rows have different lengths");
    expect(checkFormula("=A1 1")?.message).toBe("the intersection operator needs references on both sides");
    expect(checkFormula("=SUM((1,2))")?.message).toBe("the union operator needs references on both sides");
  });

  it("accepts the reference operators and 3-D references (P9-C4)", () => {
    for (const f of ["=A1:B5 B3:C7", "=SUM(A1:C3  B2:D4)", "=SUM((A1,B2:B3,C4))", "=SUM(Sheet1:Sheet3!A1)", "='Jan 1:Mar 3'!B2", "=COUNT((A1:A3 A2:B2,C1))", "=SUM($A:C)+SUM(2:$4)", "=LAMBDA(x,x+1)(2)", "=LET(x,A1:A3,SUM(x*2))"]) {
      expect(checkFormula(f), f).toBeNull();
    }
  });

  it("accepts valid formulas and non-formula input", () => {
    for (const f of ["=1+2", "=SUM(A1:B3)", "=-2^2%", "=IF(,,)", "={1,-2;\"a\",TRUE}", "=Data!$A$1", "=A:A", "=foo", "=ABCD1+1", "hello", ""]) {
      expect(checkFormula(f), f).toBeNull();
    }
  });

  it("accepts every formula of the formula suite (agrees with the core's parser)", () => {
    const files = import.meta.glob<string>("../../../../testdata/formulas/*.tsv", { query: "?raw", import: "default", eager: true });
    const formulas = Object.values(files)
      .flatMap((text) => text.split("\n"))
      .map((l) => l.split("\t")[0])
      .filter((f) => f.startsWith("="));
    expect(formulas.length).toBeGreaterThan(500);
    expect(formulas.filter((f) => checkFormula(f) !== null)).toEqual([]);
  });

  it("formats the inline message", () => {
    expect(formulaErrorMessage("unexpected end of formula at position 4")).toBe("Unexpected end of formula – fix or press Esc to discard");
  });
});

describe("dynamic arrays: `#`, `@`, #SPILL!, #CALC!", () => {
  it("lexes `#` after a reference as the spilled-range operator and `@` as implicit intersection", () => {
    const { tokens, error } = tokenize("=A1#+@B1:B3");
    expect(error).toBeNull();
    expect(tokens.map((t) => t.kind)).toEqual(["ident", "hash", "plus", "at", "ident", "colon", "ident"]);
    expect(tokenize("=#FOO").tokens.map((t) => t.kind)).toEqual(["hash", "ident"]);
  });

  it("lexes #SPILL! and #CALC! as error literals (any case)", () => {
    expect(tokenize("=#SPILL!+#calc!").tokens.map((t) => [t.kind, t.text])).toEqual([
      ["error", "#SPILL!"], ["plus", "+"], ["error", "#calc!"],
    ]);
  });

  it("accepts the new syntax like the core's parser", () => {
    for (const f of ["=A1#", "=SUM(A1#)", "=@A1:A3", "=-@A1", "=Sheet2!B2#*2", "=(A1)#", "=A1#%", "=IF(ISERROR(A1#),#SPILL!,#CALC!)", "=@SORT(A1:A9)"]) {
      expect(checkFormula(f), f).toBeNull();
    }
  });

  it("rejects a double `#`, a bare `#` and a dangling `@` with the core's messages", () => {
    expect(checkFormula("=A1##")).toEqual({ pos: 4, message: "unexpected `#`" });
    expect(checkFormula("=(A1#)#")?.message).toBe("unexpected `#`");
    expect(checkFormula("=#")?.message).toBe("unexpected `#`");
    expect(checkFormula("=@")?.message).toBe("unexpected end of formula");
    expect(checkFormula("=1@")?.message).toBe("unexpected `@` after expression");
  });

  it("colours `A1#` as the whole spill range; equal spill references share a colour", () => {
    expect(refTexts("=SUM(A1#)+$B$2#+A1")).toEqual(["A1#", "$B$2#", "A1"]);
    const refs = colorRefs("=SUM(A1#)+A1#+A1", (r) => (r.a.kind === "cell" && r.a.row === 0 ? { r0: 0, c0: 0, r1: 2, c1: 0 } : null));
    expect(refs.map((r) => [r.spill ?? false, r.range])).toEqual([
      [true, { r0: 0, c0: 0, r1: 2, c1: 0 }], [true, { r0: 0, c0: 0, r1: 2, c1: 0 }], [false, { r0: 0, c0: 0, r1: 0, c1: 0 }],
    ]);
    expect(refs.map((r) => r.color)).toEqual([REF_COLORS[0], REF_COLORS[0], REF_COLORS[1]]);
    // Unresolved (no array formula there): the cell alone.
    expect(colorRefs("=C3#")[0].range).toEqual({ r0: 2, c0: 2, r1: 2, c1: 2 });
  });

  it("F4 keeps the `#`; pointing replaces the whole `A1#`", () => {
    expect(cycleAnchor("=SUM(A1#)", 7)).toEqual({ text: "=SUM($A$1#)", caret: 10 });
    expect(pointSpan("=SUM(A1#)", 8)).toEqual({ start: 5, end: 8 });
    expect(pointSpan("=@", 2)).toEqual({ start: 2, end: 2 });
  });

  it("autocomplete lists the array functions, also after `@`", () => {
    const names = FUNCTIONS.map((f) => f.name);
    for (const n of ["SORT", "SORTBY", "FILTER", "UNIQUE", "SEQUENCE", "RANDARRAY"]) expect(names, n).toContain(n);
    expect(matchFunctions("so").map((f) => f.name)).toEqual(expect.arrayContaining(["SORT", "SORTBY"]));
    expect(matchFunctions("seq").map((f) => f.name)).toEqual(["SEQUENCE"]);
    expect(functionPrefix("=@un", 4)).toEqual({ start: 2, end: 4, prefix: "un" });
  });
});
