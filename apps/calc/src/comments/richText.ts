// The note editor's rich text in the DOM: runs → HTML spans (one per
// run, `\n` as text in a `pre-wrap` box) and back, and caret/selection
// offsets in characters.

import { escapeHtml } from "@rusuite/ui-shared";
import { colorCss } from "../grid/style";
import type { NoteRun } from "../generated/NoteRun";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import { normalizeRuns } from "./model";

/** The note font (Excel: Tahoma 9 pt). */
export const NOTE_FONT = { family: "Tahoma, Verdana, Segoe UI, sans-serif", pt: 9 };

/** Inline CSS of a run's font. */
export function runCss(f: RunProperties | undefined): string {
  if (!f) return "";
  const out: string[] = [];
  if (f.bold) out.push("font-weight:bold");
  if (f.italic) out.push("font-style:italic");
  const deco = [f.underline && f.underline !== "none" ? "underline" : "", f.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) out.push(`text-decoration:${deco}`);
  if (f.size) out.push(`font-size:${f.size / 100}pt`);
  const color = colorCss(f.color);
  if (color) out.push(`color:${color}`);
  if (f.font?.kind === "named") out.push(`font-family:'${f.font.value.replace(/'/g, "")}'`);
  return out.join(";");
}

/** HTML of runs: spans with the run fonts (`data-font` keeps the exact properties); for the editor (`editor`), line breaks as `<br>` plus a placeholder `<br>` after a final break so that the empty last line shows. */
export function runsToHtml(runs: readonly NoteRun[], editor = false): string {
  const html = runs
    .map((r) => {
      const font = r.font && Object.keys(r.font).length ? r.font : undefined;
      const attrs = font ? ` style="${runCss(font)}" data-font="${escapeHtml(JSON.stringify(font))}"` : "";
      const text = escapeHtml(r.text);
      return `<span${attrs}>${editor ? text.replace(/\n/g, "<br>") : text}</span>`;
    })
    .join("");
  const last = runs[runs.length - 1]?.text ?? "";
  return editor && last.endsWith("\n") ? `${html}<br data-end="">` : html;
}

/** A line break of the editor (not the placeholder after a final break). */
const isBreak = (n: Node) => (n as HTMLElement).tagName?.toLowerCase() === "br" && !(n as HTMLElement).hasAttribute("data-end");

/** The runs of an edited DOM: text nodes take the font of their nearest `data-font` span; `<br>` and blocks are line breaks. */
export function domToRuns(root: Node): NoteRun[] {
  const out: NoteRun[] = [];
  const fontOf = (n: Node): RunProperties | undefined => {
    for (let p: Node | null = n.parentNode; p && p !== root; p = p.parentNode) {
      const raw = (p as HTMLElement).getAttribute?.("data-font");
      if (raw) {
        try {
          return JSON.parse(raw) as RunProperties;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };
  const push = (text: string, font?: RunProperties) => out.push(font ? { text, font } : { text });
  const walk = (n: Node, first: boolean) => {
    if (n.nodeType === 3) {
      push(n.nodeValue ?? "", fontOf(n));
      return;
    }
    const el = n as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    if (tag === "br") {
      if (isBreak(n)) push("\n", fontOf(n));
      return;
    }
    // A block (Chrome wraps new lines in <div>) starts a line.
    if ((tag === "div" || tag === "p") && !first) push("\n", fontOf(n));
    let i = 0;
    for (const c of Array.from(n.childNodes)) walk(c, i++ === 0 && first);
  };
  let i = 0;
  for (const c of Array.from(root.childNodes)) walk(c, i++ === 0);
  return normalizeRuns(out);
}

/** The characters of the editor in order: text nodes and line breaks (1 character each). */
function pieces(root: Node): (Text | HTMLElement)[] {
  const out: (Text | HTMLElement)[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) out.push(n as Text);
    else if (isBreak(n)) out.push(n as HTMLElement);
    else for (const c of Array.from(n.childNodes)) walk(c);
  };
  walk(root);
  return out;
}

const size = (p: Text | HTMLElement) => (p.nodeType === 3 ? (p.nodeValue ?? "").length : 1);

/** Character offset of the DOM position `(node, offset)` inside `root`: the characters before it. */
function offsetOf(root: Node, node: Node, offset: number): number {
  const before = root.ownerDocument!.createRange();
  before.setStart(root, 0);
  before.setEnd(node, offset);
  let total = 0;
  for (const p of pieces(root)) {
    if (p === node) return total + offset;
    if (before.intersectsNode(p)) total += size(p);
  }
  return total;
}

/** The selection inside `root` as character offsets (`null`: the selection is elsewhere). */
export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return { start: offsetOf(root, r.startContainer, r.startOffset), end: offsetOf(root, r.endContainer, r.endOffset) };
}

/** The DOM position of character offset `pos` (after a line break: the start of the next line). */
function position(root: HTMLElement, pos: number): [Node, number] {
  let left = pos;
  const list = pieces(root);
  for (const p of list) {
    const n = size(p);
    if (p.nodeType === 3 && left <= n) return [p, left];
    if (p.nodeType !== 3) {
      const parent = p.parentNode!;
      const index = Array.from(parent.childNodes).indexOf(p as ChildNode);
      if (left === 0) return [parent, index];
      if (left === 1) return [parent, index + 1];
    }
    left -= n;
  }
  const last = list[list.length - 1];
  if (!last) return [root, 0];
  if (last.nodeType === 3) return [last, size(last)];
  const parent = last.parentNode!;
  return [parent, Array.from(parent.childNodes).indexOf(last as ChildNode) + 1];
}

/** Selects characters `start..end` inside `root`. */
export function setSelection(root: HTMLElement, start: number, end: number): void {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();
  const [sn, so] = position(root, start);
  const [en, eo] = position(root, end);
  range.setStart(sn, so);
  range.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Inserts a line break at the caret (Enter in the note editor). */
export function insertLineBreak(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  const pos = selectionOffsets(root);
  if (!sel || !pos || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  r.insertNode(doc.createElement("br"));
  // A break at the very end needs the placeholder to show its empty line.
  if (!root.querySelector("br[data-end]")) {
    const end = doc.createElement("br");
    end.setAttribute("data-end", "");
    root.appendChild(end);
  }
  const at = Math.min(pos.start, pos.end) + 1;
  setSelection(root, at, at);
}
