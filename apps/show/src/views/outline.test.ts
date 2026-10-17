import { describe, expect, it } from "vitest";
import { fixture, textShape } from "../test/fixture";
import type { Presentation } from "../generated/Presentation";
import type { TextBody } from "../generated/TextBody";
import {
  bodyFromLines, bodyWithLines, docLines, lineTarget, linesDoc, linesInRange, linesPlan, moveLines, outlineOf, outlineText,
  retextRuns, shiftDepth, slideLines, splitSlides, textLines, titleFromLine, toggleRange, type OutlineLine,
} from "./outline";
import { buildOutlineDom, outlineRunCss } from "./outlineDom";
import { editorText, spliceBody } from "../text/editing";

const pres = (): Presentation => fixture();

/** The fixture with "First point" of slide two split into a normal and a bold red run. */
function rich(): Presentation {
  const p = pres();
  const body = p.slides[1]!.shapes[1]!;
  if (body.kind.kind === "auto") body.kind.value.text!.paragraphs[0]!.runs = [{ text: "First " }, { text: "point", props: { bold: true, color: { kind: "rgb", value: "FF0000" } } }];
  return p;
}

const plan = (p: Presentation, id: number, text: string) => linesPlan(p, id, textLines(text, slideLines(p.slides.find((s) => s.id === id)!)));

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
    expect(slideLines(p.slides[1]!).map((l) => l.depth)).toEqual([0, 1, 2]);
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

  it("plans SetTextBody for a changed title and body, nothing for unchanged lines", () => {
    const p = pres();
    const pl = plan(p, 4, "Slide 2!\n\tFirst point\n\tAnother");
    expect(pl.deleteSlide).toBeNull();
    expect(pl.newSlides).toBeNull();
    expect(pl.commands.map((c) => c.type === "setTextBody" && c.shape)).toEqual([5, 6]);
    expect(linesPlan(p, 4, slideLines(p.slides[1]!)).commands).toEqual([]);
  });

  it("a promoted body line becomes a new slide after this one", () => {
    const pl = plan(pres(), 4, "Slide two\n\tFirst point\nThird\n\tx");
    expect(pl.newSlides?.after).toBe(4);
    expect(pl.newSlides?.slides.map((s) => [s.title.runs[0]?.text, s.body.map((b) => [b.depth, b.runs[0]?.text])])).toEqual([["Third", [[1, "x"]]]]);
    expect(pl.commands.map((c) => c.type === "setTextBody" && c.shape)).toEqual([6]);
  });

  it("a demoted title joins the previous slide's body and the slide goes", () => {
    const p = pres();
    p.slides[0]!.shapes[1] = textShape(3, ["Sub"], { placeholder: "subtitle" });
    const pl = plan(p, 4, "\tSlide two\n\t\tFirst point");
    expect(pl.deleteSlide).toBe(4);
    const c = pl.commands[0]!;
    expect(c.type === "setTextBody" && c.shape).toBe(3);
    expect(c.type === "setTextBody" && c.body.paragraphs.map((x) => [x.props?.level ?? 0, x.runs[0]?.text])).toEqual([[0, "Sub"], [0, "Slide two"], [1, "First point"]]);
  });
});

describe("rich outline (P9-S3)", () => {
  it("keeps the runs' formatting when a line is edited", () => {
    const p = rich();
    const lines = slideLines(p.slides[1]!);
    expect(lines[1]!.runs.map((r) => r.text)).toEqual(["First ", "point"]);
    // typed in the bold run: the new text is bold too, "First " stays plain
    const runs = retextRuns(lines[1]!.runs, "First points!");
    expect(runs).toEqual([{ text: "First " }, { text: "points!", props: { bold: true, color: { kind: "rgb", value: "FF0000" } } }]);
    // a change at the start takes the first run's formatting
    expect(retextRuns(lines[1]!.runs, "The First point")[0]).toEqual({ text: "The First " });
    const pl = linesPlan(p, 4, [lines[0]!, { ...lines[1]!, runs }, lines[2]!]);
    const c = pl.commands[0]!;
    expect(c.type === "setTextBody" && c.body.paragraphs[0]!.runs[1]!.props?.bold).toBe(true);
  });

  it("the editor document carries the depth in the paragraph level and back", () => {
    const lines = slideLines(rich().slides[1]!);
    const doc = linesDoc(lines);
    expect(doc.paragraphs.map((x) => x.props?.level)).toEqual([0, 1, 1]);
    expect(docLines(doc)).toEqual(lines);
    // Enter in a body line: the new line has the same depth
    const split = spliceBody(doc, editorText(doc).indexOf("point") + 5, editorText(doc).indexOf("point") + 5, "\nNext");
    expect(docLines(split).map((l) => [l.depth, l.runs.map((r) => r.text).join("")])).toEqual([[0, "Slide two"], [1, "First point"], [1, "Next"], [1, "Second point"]]);
  });

  it("Tab / Shift+Tab change the depth of the selected lines within 0…9", () => {
    const lines: OutlineLine[] = [{ depth: 0, runs: [{ text: "T" }] }, { depth: 1, runs: [{ text: "a" }] }, { depth: 9, runs: [{ text: "b" }] }];
    expect(shiftDepth(lines, 1, 2, true).map((l) => l.depth)).toEqual([0, 2, 9]);
    expect(shiftDepth(lines, 0, 1, false).map((l) => l.depth)).toEqual([0, 0, 9]);
    // promoted to depth 0: a new slide
    expect(splitSlides(shiftDepth(lines, 1, 1, false)).slides).toHaveLength(2);
    expect(splitSlides(shiftDepth(lines, 0, 0, true)).joinsPrevious).toBe(true);
  });

  it("finds the lines a selection touches", () => {
    const doc = linesDoc(slideLines(pres().slides[1]!));
    // "Slide two\nFirst point\nSecond point"
    expect(linesInRange(doc, 0, 0)).toEqual({ first: 0, last: 0 });
    expect(linesInRange(doc, 12, 12)).toEqual({ first: 1, last: 1 });
    expect(linesInRange(doc, 3, 25)).toEqual({ first: 0, last: 2 });
  });

  it("Ctrl+B toggles bold over a range, off when all of it is bold", () => {
    const doc = linesDoc(slideLines(pres().slides[1]!));
    const on = toggleRange(doc, 10, 15, "bold"); // "First"
    expect(on.paragraphs[1]!.runs).toEqual([{ text: "First", props: { bold: true } }, { text: " point" }]);
    const off = toggleRange(on, 10, 15, "bold");
    expect(off.paragraphs[1]!.runs).toEqual([{ text: "First point" }]);
    const u = toggleRange(doc, 0, 5, "underline");
    expect(u.paragraphs[0]!.runs[0]!.props?.underline).toBe("single");
    expect(toggleRange(doc, 3, 3, "italic")).toBe(doc);
  });

  it("moves lines up and down (Alt+Shift+↑ / ↓)", () => {
    expect(moveLines([1, 2, 3, 4], 1, 2, 1)).toEqual([1, 4, 2, 3]);
    expect(moveLines([1, 2, 3], 1, 1, -1)).toEqual([2, 1, 3]);
    expect(moveLines([1, 2, 3], 0, 0, -1)).toBeNull();
    expect(moveLines([1, 2, 3], 2, 2, 1)).toBeNull();
  });

  it("maps the caret to the slide a line ended up on", () => {
    const lines: OutlineLine[] = [{ depth: 0, runs: [] }, { depth: 1, runs: [] }, { depth: 0, runs: [] }, { depth: 1, runs: [] }];
    expect(lineTarget(lines, [4, 10], { paragraph: 3, offset: 2 }, 0)).toEqual({ slide: 10, line: 1, offset: 2 });
    expect(lineTarget(lines, [4, 10], { paragraph: 1, offset: 0 }, 0)).toEqual({ slide: 4, line: 1, offset: 0 });
    // a demoted title: its lines continue the previous slide (3 lines)
    const joined: OutlineLine[] = [{ depth: 1, runs: [] }, { depth: 2, runs: [] }];
    expect(lineTarget(joined, [1], { paragraph: 1, offset: 4 }, 3)).toEqual({ slide: 1, line: 4, offset: 4 });
  });

  it("titles keep their body when unchanged and take one paragraph when edited", () => {
    const old: TextBody = { props: { anchor: "bottom", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" }, paragraphs: [{ runs: [{ text: "A" }] }, { runs: [{ text: "B" }] }] };
    expect(titleFromLine(old, { depth: 0, runs: [{ text: "A B" }] })).toBe(old);
    expect(titleFromLine(old, { depth: 0, runs: [{ text: "A, B" }] }).paragraphs).toEqual([{ runs: [{ text: "A, B" }] }]);
    const body = bodyFromLines(null, [{ depth: 3, runs: [{ text: "deep" }], props: { alignment: "center" } }]);
    expect(body.paragraphs[0]!.props).toEqual({ alignment: "center", level: 2 });
  });

  it("builds the DOM with or without the text formatting", () => {
    const doc = linesDoc(slideLines(rich().slides[1]!));
    const plain = buildOutlineDom(document, doc, { formatting: false, theme: undefined });
    expect(plain.map((d) => d.dataset.depth)).toEqual(["0", "1", "1"]);
    expect(plain[1]!.querySelectorAll("span")[1]!.style.fontWeight).toBe("");
    const shown = buildOutlineDom(document, doc, { formatting: true, theme: undefined });
    const bold = shown[1]!.querySelectorAll("span")[1]!;
    expect(bold.style.fontWeight).toBe("700");
    expect(bold.style.color).toBe("rgb(255, 0, 0)");
    expect(outlineRunCss({ italic: true, size: 4400, underline: "single" }, undefined)).toMatchObject({ "font-style": "italic", "text-decoration": "underline", "font-size": "22pt" });
  });
});
