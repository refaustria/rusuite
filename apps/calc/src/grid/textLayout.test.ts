import { describe, expect, it } from "vitest";
import { fitNumber, lineHeightPx, scientific, wrapLines, type Measure } from "./textLayout";

/** 7 px per character, any font. */
const m7: Measure = (t) => t.length * 7;
const FONT = '14.67px "Calibri"';

describe("text layout", () => {
  it("wraps at spaces, honours explicit line breaks and splits long words", () => {
    expect(wrapLines("one two three", 56, FONT, m7)).toEqual(["one two", "three"]);
    expect(wrapLines("a\nb c", 100, FONT, m7)).toEqual(["a", "b c"]);
    expect(wrapLines("abcdefghij", 28, FONT, m7)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapLines("", 50, FONT, m7)).toEqual([""]);
  });

  it("numbers that do not fit lose decimals, then become ####", () => {
    expect(fitNumber("123", 58, FONT, m7)).toBe("123");
    expect(fitNumber("3.14159265", 42, FONT, m7)).toBe("3.1416");
    expect(fitNumber("1234567890", 42, FONT, m7)).toBe("######");
    expect(fitNumber("1,234.50", 21, FONT, m7)).toBe("###");
  });

  it("General numbers that do not fit switch to the scientific form before ####", () => {
    expect(scientific(1234567890123, 1)).toBe("1.2E+12");
    expect(scientific(1200000000000, 5)).toBe("1.2E+12");
    expect(scientific(-0.000001234, 2)).toBe("-1.23E-06");
    expect(scientific(5e100, 0)).toBe("5E+100");
    // 49 px = 7 characters at 7 px each.
    expect(fitNumber("1234567890123", 49, FONT, m7, true)).toBe("1.2E+12");
    expect(fitNumber("1234567890123", 63, FONT, m7, true)).toBe("1.235E+12");
    expect(fitNumber("1234567890123", 35, FONT, m7, true)).toBe("1E+12");
    expect(fitNumber("-1234567890123", 49, FONT, m7, true)).toBe("-1E+12");
    expect(fitNumber("1234567890123", 28, FONT, m7, true)).toBe("####");
    expect(fitNumber("1.23457E+20", 49, FONT, m7, true)).toBe("1.2E+20");
    expect(fitNumber("1234567.891", 49, FONT, m7, true)).toBe("1234568");
    expect(fitNumber("1234567.891", 42, FONT, m7, true)).toBe("1E+06");
    expect(fitNumber("0.0000123456", 42, FONT, m7, true)).toBe("1E-05");
    // Not General (a "0" format): no scientific form.
    expect(fitNumber("1234567890123", 49, FONT, m7)).toBe("#######");
  });

  it("line height follows the font (15 pt per line at 11 pt)", () => {
    expect(lineHeightPx(FONT)).toBe(20);
    expect(lineHeightPx("bold 18.67px Arial")).toBe(25);
  });
});
