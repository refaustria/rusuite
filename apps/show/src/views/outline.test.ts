import { describe, expect, it } from "vitest";
import { fixture, textShape } from "../test/fixture";
import type { Presentation } from "../generated/Presentation";
import { bodyWithLines, outlineOf, outlinePlan, outlineSlide, outlineText, parseOutline, shiftLines } from "./outline";

const pres = (): Presentation => fixture();

describe("outline mapping", () => {
  it("reads titles and body paragraphs with levels", () => {
    const p = pres();
    const body = p.slides[1]!.shapes[1]!;
    if (body.kind.kind === "auto") body.kind.value.text!.paragraphs[1]!.props = { level: 1 };
    const o = outlineOf(p);
    expect(o.map((s) => s.title)).toEqual(["Welcome to Rusuite Show", "Slide two", ""]);
    expect(o[1]!.body).toEqual([{ level: 0, text: "First point" }, { level: 1, text: "Second point" }]);
    expect(o[0]!.body).toEqual([]); // an empty subtitle is no line
    expect(o[2]!.titleShape).toBeNull();
    expect(outlineText(o[1]!)).toBe("Slide two\n\tFirst point\n\t\tSecond point");
  });

  it("parses lines: indented lines are body paragraphs, unindented ones start slides", () => {
    expect(parseOutline("A\n\tb\n\t\tc\nD")).toEqual({
      slides: [{ title: "A", body: [{ level: 0, text: "b" }, { level: 1, text: "c" }] }, { title: "D", body: [] }],
      joinsPrevious: false,
    });
    expect(parseOutline("\tA\n\tb").joinsPrevious).toBe(true);
    expect(parseOutline("").slides).toEqual([{ title: "", body: [] }]);
  });

  it("writes edited text back with the old formatting and the new levels", () => {
    const p = pres();
    const kind = p.slides[1]!.shapes[1]!.kind;
    const old = kind.kind === "auto" ? kind.value.text! : null;
    const b = bodyWithLines(old, [{ level: 0, text: "First point" }, { level: 2, text: "New" }]);
    expect(b.paragraphs[0]).toBe(old!.paragraphs[0]);
    expect(b.paragraphs[1]!.props?.level).toBe(2);
    expect(b.paragraphs[1]!.runs[0]!.text).toBe("New");
  });

  it("plans SetTextBody for a changed title and body", () => {
    const p = pres();
    const plan = outlinePlan(p, 4, "Slide 2!\n\tFirst point\n\tAnother");
    expect(plan.deleteSlide).toBeNull();
    expect(plan.newSlides).toBeNull();
    expect(plan.commands.map((c) => c.type === "setTextBody" && c.shape)).toEqual([5, 6]);
    expect(outlinePlan(p, 4, outlineText(outlineSlide(p.slides[1]!))).commands).toEqual([]);
  });

  it("a promoted body line becomes a new slide after this one", () => {
    const plan = outlinePlan(pres(), 4, "Slide two\n\tFirst point\nThird\n\tx");
    expect(plan.newSlides).toEqual({ after: 4, slides: [{ title: "Third", body: [{ level: 0, text: "x" }] }] });
    expect(plan.commands.map((c) => c.type === "setTextBody" && c.shape)).toEqual([6]);
  });

  it("a demoted title joins the previous slide's body and the slide goes", () => {
    const p = pres();
    p.slides[0]!.shapes[1] = textShape(3, ["Sub"], { placeholder: "subtitle" });
    const plan = outlinePlan(p, 4, "\tSlide two\n\t\tFirst point");
    expect(plan.deleteSlide).toBe(4);
    const c = plan.commands[0]!;
    expect(c.type === "setTextBody" && c.shape).toBe(3);
    expect(c.type === "setTextBody" && c.body.paragraphs.map((x) => [x.props?.level ?? 0, x.runs[0]?.text])).toEqual([[0, "Sub"], [0, "Slide two"], [1, "First point"]]);
  });

  it("Tab / Shift+Tab add or remove a leading tab on the selected lines", () => {
    expect(shiftLines("A\n\tb\nc", 3, 3, true)).toEqual({ text: "A\n\t\tb\nc", start: 4, end: 4 });
    expect(shiftLines("A\n\tb\nc", 3, 3, false)).toEqual({ text: "A\nb\nc", start: 2, end: 2 });
    expect(shiftLines("A\nb", 0, 3, true).text).toBe("\tA\n\tb");
    expect(shiftLines("A", 1, 1, false).text).toBe("A");
  });
});
