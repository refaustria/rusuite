// Names in the UI (pure): validation, scoping, Name Box / Go To targets,
// filters, name spans and colouring, Create from Selection defaults.
import { describe, expect, it } from "vitest";
import type { NameInfo } from "../generated/NameInfo";
import type { SheetInfo } from "../generated/SheetInfo";
import { colorRefs } from "../formula/refs";
import { checkFormula } from "../formula/validate";
import { tokenize } from "../formula/tokenize";
import { guessEdges } from "./controller";
import {
  filterNames, findName, formulaNames, goToTarget, isCellReference, isValidName, nameBoxNames, nameProblem, nameSpans, refersToText, resolveName,
} from "./names";

const sheets: SheetInfo[] = [
  { id: 0, name: "Sheet1" },
  { id: 3, name: "My Data" },
];

const names: NameInfo[] = [
  { name: "Tax", refersTo: "0.2" },
  { name: "Tax", sheet: 3, refersTo: "0.1" },
  { name: "Sales", refersTo: "Sheet1!$B$2:$B$9", range: { sheet: 0, r0: 1, c0: 1, r1: 8, c1: 1 } },
  { name: "Local", sheet: 3, refersTo: "'My Data'!$A$1", range: { sheet: 3, r0: 0, c0: 0, r1: 0, c1: 0 } },
  { name: "Secret", refersTo: "Sheet1!$Z$1", hidden: true, range: { sheet: 0, r0: 0, c0: 25, r1: 0, c1: 25 } },
  { name: "Print_Area", sheet: 0, refersTo: "Sheet1!$A$1:$C$3", builtin: "printArea", range: { sheet: 0, r0: 0, c0: 0, r1: 2, c1: 2 } },
];

describe("name validation", () => {
  it("follows Excel's rules", () => {
    for (const good of ["Tax", "_x", "\\back", "tax.rate", "ABCD1", "Übersicht", "a?b", "Rate2023x"]) expect(nameProblem(good), good).toBeNull();
    expect(nameProblem("")).toBe("calc.names.err.empty");
    expect(nameProblem("a b")).toBe("calc.names.err.space");
    expect(nameProblem("1abc")).toBe("calc.names.err.start");
    expect(nameProblem("x-y")).toBe("calc.names.err.chars");
    expect(nameProblem("TRUE")).toBe("calc.names.err.reserved");
    for (const ref of ["A1", "xfd1048576", "R1C1", "R", "c", "C12", "RC"]) expect(nameProblem(ref), ref).toBe("calc.names.err.reference");
    expect(nameProblem("a".repeat(256))).toBe("calc.names.err.long");
    expect(isValidName("a".repeat(255))).toBe(true);
  });

  it("recognises cell references", () => {
    expect(isCellReference("B7")).toBe(true);
    expect(isCellReference("$A$1")).toBe(true);
    expect(isCellReference("XFE1")).toBe(false);
    expect(isCellReference("A0")).toBe(false);
    expect(isCellReference("Tax")).toBe(false);
  });
});

describe("name lookup", () => {
  it("prefers the sheet's own name, then the workbook's", () => {
    expect(resolveName(names, "tax", 3)?.refersTo).toBe("0.1");
    expect(resolveName(names, "TAX", 0)?.refersTo).toBe("0.2");
    expect(findName(names, "tax", undefined)?.refersTo).toBe("0.2");
    expect(findName(names, "Local", undefined)).toBeUndefined();
  });

  it("lists the Name Box and formula names by sheet", () => {
    expect(nameBoxNames(names, 0).map((n) => n.name)).toEqual(["Print_Area", "Sales"]);
    expect(nameBoxNames(names, 3).map((n) => n.name)).toEqual(["Local", "Sales"]);
    // The sheet's own Tax shadows the workbook's; hidden names are left out.
    expect(formulaNames(names, 3).map((n) => `${n.name}${n.sheet ?? ""}`)).toEqual(["Local3", "Sales", "Tax3"]);
  });
});

describe("Go To targets", () => {
  it("navigates to names and references", () => {
    expect(goToTarget("sales", names, sheets, 0)).toEqual({ sheet: 0, range: { r0: 1, c0: 1, r1: 8, c1: 1 } });
    expect(goToTarget("Local", names, sheets, 3)).toEqual({ sheet: 3, range: { r0: 0, c0: 0, r1: 0, c1: 0 } });
    expect(goToTarget("'My Data'!Local", names, sheets, 0)?.sheet).toBe(3);
    expect(goToTarget("b7", names, sheets, 3)).toEqual({ sheet: 3, range: { r0: 6, c0: 1, r1: 6, c1: 1 } });
    expect(goToTarget("$C$3:A1", names, sheets, 0)).toEqual({ sheet: 0, range: { r0: 0, c0: 0, r1: 2, c1: 2 } });
    expect(goToTarget("'My Data'!D4", names, sheets, 0)).toEqual({ sheet: 3, range: { r0: 3, c0: 3, r1: 3, c1: 3 } });
    expect(goToTarget("B:C", names, sheets, 0)?.range).toEqual({ r0: 0, c0: 1, r1: 1_048_575, c1: 2 });
    expect(goToTarget("3:5", names, sheets, 0)?.range).toEqual({ r0: 2, c0: 0, r1: 4, c1: 16_383 });
  });

  it("refuses what names nothing", () => {
    expect(goToTarget("NewName", names, sheets, 0)).toBeNull();
    expect(goToTarget("Nope!A1", names, sheets, 0)).toBeNull();
    expect(goToTarget("Tax", names, sheets, 0)).toBeNull();
    expect(goToTarget("", names, sheets, 0)).toBeNull();
  });

  it("writes the selection as an absolute reference", () => {
    expect(refersToText("Sheet1", { r0: 0, c0: 0, r1: 4, c1: 1 })).toBe("=Sheet1!$A$1:$B$5");
    expect(refersToText("My Data", { r0: 2, c0: 2, r1: 2, c1: 2 })).toBe("='My Data'!$C$3");
  });
});

describe("Name Manager filter", () => {
  const rows = [
    { name: "a", value: "1" },
    { name: "b", sheet: 0, value: "#REF!" },
    { name: "Print_Area", sheet: 0, value: "{1,2}", builtin: "printArea" },
  ];
  it("filters by scope, errors and kind", () => {
    expect(filterNames(rows, "workbook").map((r) => r.name)).toEqual(["a"]);
    expect(filterNames(rows, "sheet").map((r) => r.name)).toEqual(["b", "Print_Area"]);
    expect(filterNames(rows, "errors").map((r) => r.name)).toEqual(["b"]);
    expect(filterNames(rows, "noErrors").map((r) => r.name)).toEqual(["a", "Print_Area"]);
    expect(filterNames(rows, "defined").map((r) => r.name)).toEqual(["a", "b"]);
    expect(filterNames(rows, "all")).toHaveLength(3);
  });
});

describe("names in formulas", () => {
  it("finds name spans (not calls, references or booleans)", () => {
    expect(nameSpans("=SUM(Sales)*Tax+A1+TRUE+'My Data'!Local+B:B").map((s) => [s.name, s.sheet, s.start, s.end])).toEqual([
      ["Sales", null, 5, 10], ["Tax", null, 12, 15], ["Local", "My Data", 24, 39],
    ]);
  });

  it("lexes and validates names with backslashes, ? and sheet qualifiers", () => {
    expect(tokenize("=\\x.y?+1").tokens[0]).toMatchObject({ kind: "ident", text: "\\x.y?" });
    expect(checkFormula("=Sheet1!Tax*2")).toBeNull();
    expect(checkFormula("='My Data'!Local")).toBeNull();
    expect(checkFormula("=Sheet1!A1:Other!B2")).not.toBeNull();
  });

  it("colours names over the range they refer to, sharing colours with equal references", () => {
    const refs = colorRefs("=SUM(Sales)+Sheet1!B2:B9+A1", undefined, (name) => {
      const n = resolveName(names, name, 0);
      return n?.range ? { sheet: "Sheet1", range: { r0: n.range.r0, c0: n.range.c0, r1: n.range.r1, c1: n.range.c1 } } : null;
    });
    expect(refs.map((r) => [r.name ?? null, r.start, r.end])).toEqual([["Sales", 5, 10], [null, 12, 24], [null, 25, 27]]);
    expect(refs[0]!.color).toBe(refs[1]!.color);
    expect(refs[2]!.color).not.toBe(refs[0]!.color);
  });
});

describe("Create from Selection defaults", () => {
  const kinds: Record<string, string> = { "0,1": "text", "0,2": "text", "1,0": "text", "2,0": "text", "1,1": "number", "1,2": "number", "2,1": "number", "2,2": "number" };
  const cell = (r: number, c: number) => (kinds[`${r},${c}`] ? { kind: kinds[`${r},${c}`]! } : undefined);
  it("guesses a label row and column like Excel", () => {
    expect(guessEdges(cell, { r0: 0, c0: 0, r1: 2, c1: 2 })).toEqual({ top: true, left: true, bottom: false, right: false });
    expect(guessEdges(cell, { r0: 1, c0: 1, r1: 2, c1: 2 })).toEqual({ top: false, left: false, bottom: false, right: false });
    expect(guessEdges(cell, { r0: 0, c0: 1, r1: 2, c1: 1 })).toEqual({ top: true, left: false, bottom: false, right: false });
  });
});
