import { describe, expect, it } from "vitest";
import type { DataValidation } from "../generated/DataValidation";
import {
  dateTimeValue, DEFAULT_VALIDATION_FORM, formFromValidation, hasDropdown, inputMessage, serialText, validationAt, validationFromForm,
} from "./validation";

const B2B5 = [{ r0: 1, c0: 1, r1: 4, c1: 1 }];
const dv = (kind: DataValidation["kind"], extra: Partial<DataValidation> = {}): DataValidation => ({
  ranges: B2B5, kind, allowBlank: true, showDropdown: true, showInput: true, showError: true, errorStyle: "stop", ...extra,
});

describe("data validation of a cell", () => {
  it("validationAt finds the covering validation (the last one listed wins)", () => {
    const a = dv({ type: "any" });
    const b = dv({ type: "whole", op: "greaterThan", f1: "0" }, { ranges: [{ r0: 3, c0: 0, r1: 3, c1: 3 }] });
    expect(validationAt([a, b], 1, 1)).toBe(a);
    expect(validationAt([a, b], 3, 1)).toBe(b);
    expect(validationAt([a, b], 0, 0)).toBeUndefined();
  });

  it("the dropdown shows for lists with In-cell dropdown; the input message when it has text", () => {
    expect(hasDropdown(dv({ type: "list", source: { type: "literal", values: ["a"] } }))).toBe(true);
    expect(hasDropdown(dv({ type: "list", source: { type: "literal", values: ["a"] } }, { showDropdown: false }))).toBe(false);
    expect(hasDropdown(dv({ type: "any" }))).toBe(false);
    expect(inputMessage(dv({ type: "any" }, { inputTitle: "Qty", inputMessage: "1 to 9" }))).toEqual({ title: "Qty", message: "1 to 9" });
    expect(inputMessage(dv({ type: "any" }, { inputTitle: "Qty", showInput: false }))).toBeNull();
    expect(inputMessage(dv({ type: "any" }))).toBeNull();
  });
});

describe("Data Validation dialog form", () => {
  it("a list of literals and a list from a range", () => {
    const f = { ...DEFAULT_VALIDATION_FORM, allow: "list" as const, source: "Yes, No ,,Maybe" };
    expect(validationFromForm(f, B2B5)).toEqual({ validation: dv({ type: "list", source: { type: "literal", values: ["Yes", "No", "Maybe"] } }) });
    expect(validationFromForm({ ...f, source: "=$D$1:$D$3", showDropdown: false }, B2B5)).toEqual({
      validation: dv({ type: "list", source: { type: "formula", formula: "$D$1:$D$3" } }, { showDropdown: false }),
    });
    expect(validationFromForm({ ...f, source: " " }, B2B5)).toEqual({ error: "calc.dv.err.source" });
  });

  it("whole numbers between two values, with messages and a warning alert", () => {
    const f = {
      ...DEFAULT_VALIDATION_FORM, allow: "whole" as const, op: "between" as const, f1: "1", f2: "=$C$1",
      inputTitle: "Qty", inputMessage: "1 to C1", errorStyle: "warning" as const, errorTitle: "Oops", errorMessage: "Too many",
    };
    expect(validationFromForm(f, B2B5)).toEqual({
      validation: dv({ type: "whole", op: "between", f1: "1", f2: "$C$1" }, {
        showDropdown: false, errorStyle: "warning", inputTitle: "Qty", inputMessage: "1 to C1", errorTitle: "Oops", errorMessage: "Too many",
      }),
    });
    expect(validationFromForm({ ...f, f2: "" }, B2B5)).toEqual({ error: "calc.dv.err.value" });
    expect(validationFromForm({ ...f, op: "greaterThan", f1: "abc" }, B2B5)).toEqual({ error: "calc.dv.err.value" });
  });

  it("dates and times are stored as serial numbers and shown as dates again", () => {
    expect(dateTimeValue("2024-01-31", "date")).toBe("45322");
    expect(dateTimeValue("31.1.2024", "date")).toBe("45322");
    expect(dateTimeValue("1/31/2024", "date")).toBe("45322");
    expect(dateTimeValue("12:00", "time")).toBe("0.5");
    expect(dateTimeValue("soon", "date")).toBeNull();
    expect(serialText("45322", "date")).toBe("2024-01-31");
    expect(serialText("0.75", "time")).toBe("18:00");
    const f = { ...DEFAULT_VALIDATION_FORM, allow: "date" as const, op: "greaterThan" as const, f1: "2024-01-31" };
    const r = validationFromForm(f, B2B5);
    expect(r).toMatchObject({ validation: { kind: { type: "date", op: "greaterThan", f1: "45322" } } });
    expect("validation" in r && formFromValidation(r.validation!).f1).toBe("2024-01-31");
  });

  it("Any value without an input message removes the validation; with one it is kept", () => {
    expect(validationFromForm(DEFAULT_VALIDATION_FORM, B2B5)).toEqual({ validation: null });
    expect(validationFromForm({ ...DEFAULT_VALIDATION_FORM, inputMessage: "Hello" }, B2B5)).toEqual({
      validation: dv({ type: "any" }, { showDropdown: false, inputMessage: "Hello" }),
    });
  });

  it("custom formulas and the round trip through the form", () => {
    const v = dv({ type: "custom", formula: "ISNUMBER(B2)" }, { showDropdown: false, errorStyle: "information", errorMessage: "Numbers only" });
    const f = formFromValidation(v);
    expect(f).toMatchObject({ allow: "custom", formula: "=ISNUMBER(B2)", errorStyle: "information", errorMessage: "Numbers only" });
    expect(validationFromForm(f, B2B5)).toEqual({ validation: v });
    expect(validationFromForm({ ...f, formula: "=" }, B2B5)).toEqual({ error: "calc.dv.err.formula" });
    const list = dv({ type: "list", source: { type: "literal", values: ["a", "b"] } });
    expect(formFromValidation(list).source).toBe("a,b");
    expect(formFromValidation(undefined)).toEqual(DEFAULT_VALIDATION_FORM);
  });
});
