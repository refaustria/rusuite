import { describe, expect, it } from "vitest";
import { fitNumber, lineHeightPx, wrapLines, type Measure } from "./textLayout";

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

  it("line height follows the font (15 pt per line at 11 pt)", () => {
    expect(lineHeightPx(FONT)).toBe(20);
    expect(lineHeightPx("bold 18.67px Arial")).toBe(25);
  });
});
