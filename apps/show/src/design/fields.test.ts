import { describe, expect, it } from "vitest";
import { DATE_FORMATS, fieldText, formatDate } from "./fields";

const d = new Date(2026, 9, 16, 14, 5, 9);

describe("date fields in the app's locale", () => {
  it.each([
    [1, "en", "10/16/2026"],
    [1, "de", "16.10.2026"],
    [2, "en", "Friday, October 16, 2026"],
    [2, "de", "Freitag, 16. Oktober 2026"],
    [3, "en", "16 October 2026"],
    [4, "en", "October 16, 2026"],
    [5, "en", "16-Oct-26"],
    [7, "de", "Okt-26"],
    [10, "en", "14:05"],
    [11, "de", "14:05:09"],
  ])("format %i in %s", (n, locale, want) => {
    expect(formatDate(n, d, locale)).toBe(want);
  });

  it("12/13 use a 12-hour clock; 0 and unknown are format 1", () => {
    expect(formatDate(12, d, "en")).toMatch(/^2:05\sPM$/);
    expect(formatDate(13, d, "en")).toMatch(/^2:05:09\sPM$/);
    expect(formatDate(0, d, "en")).toBe("10/16/2026");
    expect(DATE_FORMATS).toHaveLength(13);
  });

  it("field text: the live slide number (‹#› without one), today's date, others keep their text", () => {
    expect(fieldText({ kind: "slideNumber" }, 7, "‹#›")).toBe("7");
    expect(fieldText({ kind: "slideNumber" }, null, "3")).toBe("‹#›");
    expect(fieldText({ kind: "dateTime", value: { format: 5 } }, 1, "", d)).toMatch(/^16-Oct-26$|^16-Okt-26$/);
    expect(fieldText({ kind: "other", value: { type: "datetimeFigureOut" } }, 1, "stored")).toBe("stored");
  });
});
