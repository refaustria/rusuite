// The DOM of the in-place text editor (P8-45 S-01). The editor is a
// `contenteditable` whose content is rebuilt from the session's rich body
// after every edit: one block per paragraph, one span per run, styled
// with the numbers of the slide's own layout (`text/layout.ts`
// `ParagraphMetrics` and the resolved `RunStyle`s) – same fonts, sizes,
// colours, bullets (CSS `::before` from `data-bullet`, so the caret
// never enters them), indents, spacing, line heights and autofit scale,
// so the text does not move when editing starts or ends. Positions map
// between the DOM and the session's plain text (paragraphs joined by
// `\n`, UTF-16 offsets).

import type { TextBody } from "../generated/TextBody";
import { linkStyle, type LayoutOptions, type ParagraphMetrics, type RunStyle, type TextLayout } from "../text/layout";

/** The CSS of a run style at `scale` (autofit) as inline style properties. */
export function runCss(s: RunStyle, scale: number): Record<string, string> {
  const size = s.sizePx * scale;
  const out: Record<string, string> = {
    "font-family": s.fontFamily,
    "font-size": `${s.verticalAlign ? size * 0.65 : size}px`,
    "font-weight": s.bold ? "700" : "400",
    "font-style": s.italic ? "italic" : "normal",
    color: s.color,
  };
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) out["text-decoration"] = deco;
  if (s.highlight) out["background-color"] = s.highlight;
  // the layout raises superscript by 0.35 and lowers subscript by 0.12 of the line's font
  if (s.verticalAlign === "superscript") out["vertical-align"] = `${size * 0.35}px`;
  if (s.verticalAlign === "subscript") out["vertical-align"] = `${-size * 0.12}px`;
  return out;
}

/** The CSS `line-height` of a paragraph. */
export function lineHeightCss(m: ParagraphMetrics): string {
  return m.lineHeight.kind === "fixed" ? `${m.lineHeight.px}px` : String(m.lineHeight.value);
}

/** The inline CSS of a paragraph block (`empty`: it has no text, so it takes its first run's font for its height). */
export function paragraphCss(m: ParagraphMetrics, scale: number, empty: boolean): Record<string, string> {
  const out: Record<string, string> = {
    "padding-left": `${m.textX}px`,
    "padding-top": `${m.spaceBefore}px`,
    "padding-bottom": `${m.spaceAfter}px`,
    "line-height": lineHeightCss(m),
    "text-align": m.alignment,
    // the line box is as high as the line's largest run (the layout's rule); an empty paragraph as its first run
    ...(empty ? runCss(m.bulletStyle, scale) : { "font-size": "0px" }),
  };
  if (m.label !== null) {
    out["text-indent"] = `${m.indent - m.textX}px`;
    out["--bullet-width"] = `${m.textX - m.indent}px`;
    out["--bullet-font"] = `${m.bulletStyle.italic ? "italic " : ""}${m.bulletStyle.bold ? "700 " : ""}${m.baseSize}px ${m.bulletStyle.fontFamily}`;
    out["--bullet-color"] = m.bulletStyle.color;
  }
  return out;
}

const setCss = (el: HTMLElement, css: Record<string, string>) => {
  for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
};

/**
 * Builds the editor's paragraphs for `body` laid out as `layout` (whose
 * `paragraphs` metrics it needs) with the run styles of `o`.
 */
export function buildParagraphs(doc: Document, body: TextBody, layout: TextLayout, o: Pick<LayoutOptions, "runStyle" | "linkColor">): HTMLElement[] {
  const scale = layout.scale || 1;
  return body.paragraphs.map((p, i) => {
    const m = layout.paragraphs?.[i];
    const div = doc.createElement("div");
    div.dataset.p = String(i);
    const level = m?.level ?? p.props?.level ?? 0;
    div.dataset.level = String(level);
    const empty = p.runs.every((r) => r.text.length === 0);
    if (m) {
      setCss(div, paragraphCss(m, scale, empty));
      if (m.label !== null) div.dataset.bullet = m.label;
    }
    for (const r of p.runs) {
      if (!r.text) continue;
      let s = o.runStyle(r.props, level);
      if (r.hyperlink) s = linkStyle(s, r.hyperlink, o.linkColor);
      const span = doc.createElement("span");
      setCss(span, runCss(s, scale));
      if (m) span.style.setProperty("line-height", lineHeightCss(m));
      if (r.field) span.dataset.field = r.field.kind;
      span.textContent = r.text;
      div.appendChild(span);
    }
    if (empty) div.appendChild(doc.createElement("br"));
    return div;
  });
}

/** The paragraph blocks of the editor root. */
const blocks = (root: HTMLElement): HTMLElement[] => Array.from(root.children).filter((c): c is HTMLElement => c.tagName === "DIV" || c.tagName === "P");

/** The text the editor shows: its paragraphs' text joined by `\n` (stray text of the browser counts as paragraphs). */
export function readDomText(root: HTMLElement): string {
  const out: string[] = [];
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === 3) {
      if (n.textContent) out.push(n.textContent);
    } else if (n.nodeType === 1 && (n as HTMLElement).tagName !== "BR") out.push(n.textContent ?? "");
  }
  return out.length ? out.join("\n") : "";
}

/** The plain-text offset of the DOM position (`node`, `offset`) inside `root`. */
export function domToOffset(root: HTMLElement, node: Node, offset: number): number {
  const paras = blocks(root);
  const start = (i: number) => paras.slice(0, i).reduce((s, p) => s + (p.textContent?.length ?? 0) + 1, 0);
  if (node === root) {
    // a position between the root's children
    const before = Array.from(root.childNodes).slice(0, offset).filter((c) => paras.includes(c as HTMLElement)).length;
    if (before >= paras.length) return Math.max(0, start(paras.length) - 1);
    return start(before);
  }
  let p: Node | null = node;
  while (p && p.parentNode !== root) p = p.parentNode;
  const i = p ? paras.indexOf(p as HTMLElement) : -1;
  if (!p || i < 0) return 0;
  const range = root.ownerDocument.createRange();
  range.setStart(p, 0);
  range.setEnd(node, offset);
  return start(i) + range.toString().length;
}

/** The DOM position of plain-text offset `at` (the end of the run before it at run borders). */
export function offsetToDom(root: HTMLElement, at: number): { node: Node; offset: number } {
  const paras = blocks(root);
  let rest = Math.max(0, at);
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]!;
    const len = p.textContent?.length ?? 0;
    if (rest > len && i < paras.length - 1) {
      rest -= len + 1;
      continue;
    }
    rest = Math.min(rest, len);
    const walker = root.ownerDocument.createTreeWalker(p, 4 /* NodeFilter.SHOW_TEXT */);
    let t = walker.nextNode();
    while (t) {
      const n = t.textContent?.length ?? 0;
      if (rest <= n) return { node: t, offset: rest };
      rest -= n;
      t = walker.nextNode();
    }
    return { node: p, offset: 0 };
  }
  return { node: root, offset: 0 };
}

/** The editor's selection as plain-text offsets (`null` when it is outside `root`). */
export function readSelection(root: HTMLElement): { start: number; end: number; backward: boolean } | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const a = domToOffset(root, sel.anchorNode, sel.anchorOffset);
  const f = domToOffset(root, sel.focusNode, sel.focusOffset);
  return { start: Math.min(a, f), end: Math.max(a, f), backward: f < a };
}

/** Selects plain-text offsets `start`…`end` in the editor. */
export function writeSelection(root: HTMLElement, start: number, end: number, backward = false): void {
  const sel = root.ownerDocument.getSelection();
  if (!sel) return;
  const a = offsetToDom(root, backward ? end : start);
  const f = offsetToDom(root, backward ? start : end);
  try {
    sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  } catch {
    // a node of an older DOM (rebuilt meanwhile)
  }
}
