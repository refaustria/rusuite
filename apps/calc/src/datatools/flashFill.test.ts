// P9-C2: Flash Fill pattern inference – Excel's common cases.
import { describe, expect, it } from "vitest";
import { applyCase, flashFill, inferFormat, inferProgram, runProgram, textInput, tokens, type FlashExample, type FlashRow } from "./flashFill";

const ex = (sources: string[], target: string): FlashExample => ({ sources, target });
const learn = (examples: FlashExample[]) => {
  const p = inferProgram(examples);
  expect(p, "no program").not.toBeNull();
  return (sources: string[]) => runProgram(p!, sources);
};

describe("Flash Fill inference", () => {
  it("first names from one example", () => {
    const f = learn([ex(["Ada Lovelace"], "Ada")]);
    expect(f(["Grace Hopper"])).toBe("Grace");
    expect(f(["Alan Mathison Turing"])).toBe("Alan");
  });
  it("last names count from the end (two examples settle it)", () => {
    const f = learn([ex(["Ada Lovelace"], "Lovelace"), ex(["Alan Mathison Turing"], "Turing")]);
    expect(f(["Grace Brewster Hopper"])).toBe("Hopper");
    expect(f(["Linus Torvalds"])).toBe("Torvalds");
  });
  it("Last, First with a literal separator", () => {
    const f = learn([ex(["Ada Lovelace"], "Lovelace, Ada")]);
    expect(f(["Grace Hopper"])).toBe("Hopper, Grace");
  });
  it("joins two columns with a space", () => {
    const f = learn([ex(["Ada", "Lovelace"], "Ada Lovelace")]);
    expect(f(["Grace", "Hopper"])).toBe("Grace Hopper");
  });
  it("initials with dots", () => {
    const f = learn([ex(["Ada Lovelace"], "A.L."), ex(["Grace Hopper"], "G.H.")]);
    expect(f(["Alan Turing"])).toBe("A.T.");
  });
  it("case changes: UPPER, lower and Proper", () => {
    expect(learn([ex(["ada lovelace"], "ADA LOVELACE")])(["grace hopper"])).toBe("GRACE HOPPER");
    expect(learn([ex(["Ada LOVELACE"], "ada lovelace")])(["Grace HOPPER"])).toBe("grace hopper");
    expect(learn([ex(["ada lovelace"], "Ada Lovelace")])(["grace hopper"])).toBe("Grace Hopper");
  });
  it("the user part of an e-mail address", () => {
    const f = learn([ex(["ada.lovelace@example.org"], "ada.lovelace"), ex(["alan@turing.uk"], "alan")]);
    expect(f(["grace.b.hopper@navy.mil"])).toBe("grace.b.hopper");
  });
  it("the domain of an e-mail address", () => {
    const f = learn([ex(["ada@example.org"], "example.org"), ex(["alan@turing.co.uk"], "turing.co.uk")]);
    expect(f(["grace@navy.mil"])).toBe("navy.mil");
  });
  it("a fixed substring of a code", () => {
    const f = learn([ex(["AB-12345-X"], "12345"), ex(["CD-98765-Y"], "98765")]);
    expect(f(["EF-55555-Z"])).toBe("55555");
  });
  it("reorders a date's parts", () => {
    const f = learn([ex(["10/17/2026"], "17.10.2026"), ex(["1/2/2025"], "2.1.2025")]);
    expect(f(["12/31/1999"])).toBe("31.12.1999");
  });
  it("a city from 'City, Country'", () => {
    const f = learn([ex(["Vienna, Austria"], "Vienna"), ex(["New York, USA"], "New York")]);
    expect(f(["Rio de Janeiro, Brazil"])).toBe("Rio de Janeiro");
  });
  it("finds nothing when the examples contradict each other", () => {
    expect(inferProgram([ex(["Ada Lovelace"], "Ada"), ex(["Grace Hopper"], "Turing")])).toBeNull();
    expect(inferProgram([])).toBeNull();
  });
  it("missing parts give no suggestion", () => {
    const f = learn([ex(["Ada Lovelace"], "Lovelace"), ex(["Grace Hopper"], "Hopper")]);
    expect(f(["Plato"])).toBeNull();
    expect(f([""])).toBeNull();
  });
});

describe("Flash Fill helpers", () => {
  it("cases and tokens", () => {
    expect(applyCase("mARY o'neil-smith", "proper")).toBe("Mary O'neil-Smith");
    expect(tokens("a, b;c", null)).toEqual(["a", "b", "c"]);
    expect(tokens("a,b,,c", ",")).toEqual(["a", "b", "", "c"]);
  });
  it("keeps number-like results as text", () => {
    expect(textInput("0123")).toBe("'0123");
    expect(textInput("17.10.2026")).toBe("'17.10.2026");
    expect(textInput("Ada")).toBe("Ada");
    expect(textInput("=x")).toBe("'=x");
  });
  it("reformats numbers with the core's formatter", async () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const fmt = async (v: number, code: string) => (code === "d mmm yyyy" ? `${v % 28} ${months[v % 12]} 2026` : String(v));
    const p = await inferFormat([{ numbers: [46000], target: `${46000 % 28} ${months[46000 % 12]} 2026` }], fmt);
    expect(p).toEqual({ segs: [{ kind: "format", col: 0, code: "d mmm yyyy" }] });
  });
  it("fills the empty cells below and skips a header row", async () => {
    const rows: FlashRow[] = [
      { row: 0, sources: ["Name"], numbers: [null], target: "First" },
      { row: 1, sources: ["Ada Lovelace"], numbers: [null], target: "Ada" },
      { row: 2, sources: ["Grace Hopper"], numbers: [null], target: "" },
      { row: 3, sources: [""], numbers: [null], target: "" },
      { row: 4, sources: ["Alan Turing"], numbers: [null], target: "" },
    ];
    const r = await flashFill(rows, async () => "");
    expect(r?.cells).toEqual([{ row: 2, input: "Grace" }, { row: 4, input: "Alan" }]);
  });
});
