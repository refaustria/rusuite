// The DOM of the rich Outline View (P9-S3): one block per line (title or
// body paragraph, `data-depth`, indented by depth), one span per run.
// With "Show Text Formatting" the spans carry the runs' bold, italic,
// underline, strikethrough, colour, font and (scaled) size; without it the
// outline is plain text with bold titles, like PowerPoint. Positions map
// between the DOM and the editor's text with the in-place editor's helpers
// (`canvas/richEditor.ts`), which only need one block per paragraph.

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { TextBody } from "../generated/TextBody";
import type { Theme } from "../generated/Theme";
import { resolveColor } from "../design/color";

/** CSS of a run in the outline with Show Text Formatting on. */
export function outlineRunCss(p: RunProperties | undefined, theme: Theme | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!p) return out;
  if (p.bold) out["font-weight"] = "700";
  else if (p.bold === false) out["font-weight"] = "400";
  if (p.italic) out["font-style"] = "italic";
  const deco = [p.underline && p.underline !== "none" ? "underline" : "", p.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) out["text-decoration"] = deco;
  if (p.color && p.color.kind !== "auto") out.color = `#${resolveColor(theme, p.color as Color)}`;
  if (p.size) out["font-size"] = `${Math.max(8, Math.min(28, (p.size / 100) * 0.5))}pt`;
  const font = p.font;
  if (font?.kind === "named") out["font-family"] = `"${font.value}", sans-serif`;
  else if (font?.kind === "theme" && theme) {
    const name = font.value.startsWith("major") ? theme.fonts.majorLatin : theme.fonts.minorLatin;
    if (name) out["font-family"] = `"${name}", sans-serif`;
  }
  return out;
}

/** Indent of a line of `depth` in em. */
export const depthIndent = (depth: number): number => (depth <= 0 ? 0 : 1.25 + (depth - 1) * 1.5);

/** The blocks of an outline document (`props.level` = depth). */
export function buildOutlineDom(doc: Document, body: TextBody, o: { formatting: boolean; theme: Theme | undefined }): HTMLElement[] {
  return body.paragraphs.map((p, i) => {
    const depth = p.props?.level ?? 0;
    const div = doc.createElement("div");
    div.dataset.p = String(i);
    div.dataset.depth = String(depth);
    div.dataset.testid = depth === 0 ? "outline-title" : "outline-line";
    div.style.setProperty("padding-left", `${depthIndent(depth)}em`);
    div.style.setProperty("white-space", "pre-wrap");
    if (depth === 0) div.style.setProperty("font-weight", "600");
    let empty = true;
    for (const r of p.runs) {
      if (!r.text) continue;
      empty = false;
      const span = doc.createElement("span");
      if (o.formatting) for (const [k, v] of Object.entries(outlineRunCss(r.props, o.theme))) span.style.setProperty(k, v);
      if (r.field) span.dataset.field = r.field.kind;
      span.textContent = r.text.replace(/\u000b/g, "\n");
      div.appendChild(span);
    }
    if (empty || /[\n\u000b]$/.test(p.runs[p.runs.length - 1]?.text ?? "")) div.appendChild(doc.createElement("br"));
    return div;
  });
}
