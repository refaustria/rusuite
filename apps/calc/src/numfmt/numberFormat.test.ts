// Format Cells › Number helpers (pure): categories → codes and back, the
// ribbon's quick formats, Increase / Decrease Decimal on every family.
import { describe, expect, it } from "vitest";
import {
  accountingCode, buildCode, BUILTIN_CODES, CATEGORIES, changeDecimals, customCodes, shownDecimals, DEFAULT_CHOICE, FRACTION_CODES, parseCode, QUICK_FORMATS, quickCode,
  quickOf, type FormatChoice,
} from "../numberFormat";

const choice = (p: Partial<FormatChoice>): FormatChoice => ({ ...DEFAULT_CHOICE, ...p });

describe("dialog categories", () => {
  it("offers Excel's categories (Special omitted)", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["general", "number", "currency", "accounting", "date", "time", "percentage", "fraction", "scientific", "text", "custom"]);
  });

  it("builds the code of every category", () => {
    expect(buildCode(choice({ category: "number", decimals: 1, negative: "red" }))).toBe("0.0;[Red]0.0");
    expect(buildCode(choice({ category: "number", decimals: 2, thousands: true, negative: "paren" }))).toBe("#,##0.00_);(#,##0.00)");
    expect(buildCode(choice({ category: "number", decimals: 0, negative: "redParen" }))).toBe("0_);[Red](0)");
    expect(buildCode(choice({ category: "currency", symbol: "$", decimals: 2, negative: "red" }))).toBe("$#,##0.00;[Red]$#,##0.00");
    expect(buildCode(choice({ category: "currency", symbol: "¥", decimals: 0 }))).toBe('"¥"#,##0');
    expect(buildCode(choice({ category: "accounting", symbol: "$", decimals: 2 }))).toBe('_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)');
    expect(buildCode(choice({ category: "accounting", symbol: "€", decimals: 0 }))).toBe('_-* #,##0 "€"_-;-* #,##0 "€"_-;_-* "-" "€"_-;_-@_-');
    expect(buildCode(choice({ category: "scientific", decimals: 3 }))).toBe("0.000E+00");
    expect(buildCode(choice({ category: "fraction", fraction: "# ?/8" }))).toBe("# ?/8");
    expect(buildCode(choice({ category: "custom", custom: "  " }))).toBe("General");
  });

  it("the accounting codes equal Excel's built-ins 42 and 44", () => {
    expect(BUILTIN_CODES).toContain(accountingCode("$", 2));
    expect(BUILTIN_CODES).toContain(accountingCode("", 2));
    expect(BUILTIN_CODES).toContain(accountingCode("$", 0));
  });

  it("parses every built code back to its choice", () => {
    const cases: Partial<FormatChoice>[] = [
      { category: "number", decimals: 3, thousands: true, negative: "redParen" },
      { category: "currency", symbol: "£", decimals: 1, negative: "paren" },
      { category: "currency", symbol: "€", decimals: 2, negative: "red" },
      { category: "accounting", symbol: "¥", decimals: 1 },
      { category: "accounting", symbol: "", decimals: 2 },
      { category: "scientific", decimals: 0 },
      { category: "percentage", decimals: 4 },
      ...FRACTION_CODES.map((fraction) => ({ category: "fraction" as const, fraction })),
      { category: "date", date: "[$-407]dddd, d. mmmm yyyy" },
      { category: "time", time: "mm:ss.0" },
    ];
    for (const p of cases) {
      const code = buildCode(choice(p));
      expect(parseCode(code)).toMatchObject(p);
      expect(buildCode(parseCode(code))).toBe(code);
    }
    expect(parseCode("0.0;[Blue]-0.0").category).toBe("custom");
  });

  it("lists the built-in codes and the workbook's own in Custom", () => {
    const list = customCodes([{}, { numberFormat: "0.000" }, { numberFormat: "[Red][<0]-0.0;0.0" }, { numberFormat: "0.000" }, { numberFormat: "0%" }]);
    expect(list.slice(0, BUILTIN_CODES.length)).toEqual(BUILTIN_CODES);
    expect(list.slice(BUILTIN_CODES.length)).toEqual(["0.000", "[Red][<0]-0.0;0.0"]);
  });
});

describe("ribbon number format box", () => {
  it("has Excel's eleven entries with locale codes", () => {
    expect(QUICK_FORMATS).toHaveLength(11);
    expect(quickCode("currency", "$", false)).toBe("$#,##0.00");
    expect(quickCode("currency", "€", true)).toBe('#,##0.00 "€"');
    expect(quickCode("shortDate", "€", true)).toBe("dd.mm.yyyy");
    expect(quickCode("longDate", "$", false)).toBe("dddd, mmmm d, yyyy");
    expect(quickOf("0.00%", "$", false)).toBe("percentage");
    expect(quickOf(null, "$", false)).toBe("general");
    expect(quickOf("0.000", "$", false)).toBeNull();
    expect(quickOf("0%", "$", false)).toBe("percentage");
    for (const q of QUICK_FORMATS) expect(quickOf(quickCode(q, "€", true), "€", true)).toBe(q);
  });
});

describe("Increase / Decrease Decimal", () => {
  it("starts a General cell from the decimals it shows (P8-39 C-06)", () => {
    expect(shownDecimals("3.14159")).toBe(5);
    expect(shownDecimals("1.23E+11")).toBe(0);
    expect(shownDecimals("42")).toBe(0);
    expect(changeDecimals("General", 1, 5)).toBe("0.000000");
    expect(changeDecimals("General", -1, 5)).toBe("0.0000");
    expect(changeDecimals("General", 1, 0)).toBe("0.0");
  });

  it("works on every family with digits", () => {
    expect(changeDecimals("0.00E+00", 1)).toBe("0.000E+00");
    expect(changeDecimals("0E+00", 1)).toBe("0.0E+00");
    expect(changeDecimals("##0.0E+0", -1)).toBe("##0E+0");
    expect(changeDecimals("$#,##0.00;[Red]$#,##0.00", 1)).toBe("$#,##0.000;[Red]$#,##0.000");
    expect(changeDecimals('#,##0.00 "€"', -1)).toBe('#,##0.0 "€"');
    expect(changeDecimals(accountingCode("$", 2), 1)).toBe(accountingCode("$", 3));
    expect(changeDecimals(accountingCode("€", 2), -1)).toBe(accountingCode("€", 1));
    expect(changeDecimals('0.0 "pcs.0"', 1)).toBe('0.00 "pcs.0"');
  });

  it("leaves dates, times, fractions and text alone", () => {
    for (const code of ["yyyy-mm-dd", "h:mm:ss", "# ?/?", "@", "[h]:mm"]) expect(changeDecimals(code, 1)).toBe(code);
  });
});
