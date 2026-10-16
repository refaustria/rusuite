// P8-26: the note editor's DOM ↔ runs conversion and selection offsets.
import { describe, expect, it } from "vitest";
import { domToRuns, insertLineBreak, runCss, runsToHtml, selectionOffsets, setSelection } from "./richText";

function editor(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("note rich text in the DOM", () => {
  it("renders runs as escaped spans that keep their exact font", () => {
    const html = runsToHtml([{ text: "Ann:", font: { bold: true, size: 1100 } }, { text: "<a & b>" }]);
    expect(html).toBe('<span style="font-weight:bold;font-size:11pt" data-font="{&quot;bold&quot;:true,&quot;size&quot;:1100}">Ann:</span><span>&lt;a &amp; b&gt;</span>');
  });

  it("styles colours, underline and named fonts", () => {
    expect(runCss({ italic: true, underline: "single", strike: true, color: { kind: "rgb", value: "FF0000" }, font: { kind: "named", value: "Arial" } })).toBe(
      "font-style:italic;text-decoration:underline line-through;color:#FF0000;font-family:'Arial'",
    );
    expect(runCss(undefined)).toBe("");
  });

  it("reads the runs back, also after typing into a span", () => {
    const runs = [{ text: "Ann:", font: { bold: true } }, { text: "\nbody" }];
    const el = editor(runsToHtml(runs));
    expect(domToRuns(el)).toEqual(runs);
    el.querySelector("span")!.firstChild!.nodeValue = "Ann Lee:";
    expect(domToRuns(el)).toEqual([{ text: "Ann Lee:", font: { bold: true } }, { text: "\nbody" }]);
    el.remove();
  });

  it("turns <br> and Chrome's line <div>s into line breaks", () => {
    const el = editor("one<br>two<div>three</div>");
    expect(domToRuns(el)).toEqual([{ text: "one\ntwo\nthree" }]);
    el.remove();
  });

  it("maps the selection to character offsets and back", () => {
    const el = editor(runsToHtml([{ text: "abc", font: { bold: true } }, { text: "defg" }]));
    setSelection(el, 2, 5);
    expect(selectionOffsets(el)).toEqual({ start: 2, end: 5 });
    setSelection(el, 7, 7);
    expect(selectionOffsets(el)).toEqual({ start: 7, end: 7 });
    el.remove();
  });

  it("inserts a line break at the caret (Enter)", () => {
    const el = editor(runsToHtml([{ text: "abcd" }], true));
    setSelection(el, 2, 2);
    insertLineBreak(el);
    expect(domToRuns(el)).toEqual([{ text: "ab\ncd" }]);
    expect(selectionOffsets(el)).toEqual({ start: 3, end: 3 });
    el.remove();
  });

  it("the editor shows breaks as <br>, with a placeholder after a final one; the caret goes onto the new line", () => {
    const runs = [{ text: "Ann:", font: { bold: true } }, { text: "\n" }];
    const html = runsToHtml(runs, true);
    expect(html).toBe('<span style="font-weight:bold" data-font="{&quot;bold&quot;:true}">Ann:</span><span><br></span><br data-end="">');
    const el = editor(html);
    expect(domToRuns(el)).toEqual(runs);
    setSelection(el, 5, 5);
    expect(selectionOffsets(el)).toEqual({ start: 5, end: 5 });
    const r = document.getSelection()!.getRangeAt(0);
    // After the <br>, not inside the bold span.
    expect(r.startContainer.nodeName).toBe("SPAN");
    expect(r.startOffset).toBe(1);
    el.remove();
  });

  it("ignores a selection outside the editor", () => {
    const el = editor("x");
    const other = editor("y");
    setSelection(other, 0, 1);
    expect(selectionOffsets(el)).toBeNull();
    el.remove();
    other.remove();
  });
});
