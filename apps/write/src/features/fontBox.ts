// What Home › Font shows: the font and size in effect at the caret, as
// Word resolves them — direct formatting, then the character style, then
// the paragraph style chain, then the document defaults; theme fonts by
// their Office theme names (+Headings = Calibri Light, +Body = Calibri).

import type { EditorState } from "@tiptap/pm/state";
import type { FontFace } from "../../../../packages/ui-shared/src/generated/FontFace";
import type { StyleSheet } from "../generated/StyleSheet";
import { propsFromMarks, styleFromMarks } from "../sync/fromPM";
import type { RunProperties } from "../sync/model";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { overlayRun, paragraphStyleId, resolveCharacter, resolveRun } from "./styleCss";

/** Font names of the Office theme's font slots. */
export const THEME_FONT_NAMES: Record<string, string> = {
  majorLatin: "Calibri Light",
  minorLatin: "Calibri",
  majorEastAsian: "Calibri Light",
  minorEastAsian: "Calibri",
  majorComplexScript: "Times New Roman",
  minorComplexScript: "Arial",
};

/** The font name of `f` (theme fonts by their theme name). */
export function fontName(f: FontFace | null | undefined): string | null {
  if (!f) return null;
  return f.kind === "named" ? f.value : (THEME_FONT_NAMES[f.value] ?? "Calibri");
}

/** The effective run formatting at the caret (or the stored marks), resolved through the styles. */
export function resolvedRunAt(state: EditorState, sheet: StyleSheet | null | undefined): RunProperties {
  const { $from } = state.selection;
  let para = null;
  for (let d = $from.depth; d >= 0; d--) {
    if (TEXTBLOCK_TYPES.has($from.node(d).type.name)) {
      para = $from.node(d);
      break;
    }
  }
  // The marks of the text before the caret (Word shows what typing would use), else after it.
  const marks = state.storedMarks ?? ($from.parentOffset > 0 ? $from.marks() : ($from.nodeAfter?.marks ?? $from.marks()));
  let out: RunProperties = para ? resolveRun(sheet, paragraphStyleId(sheet, para)) : { ...(sheet?.defaults.run ?? {}) };
  const cs = styleFromMarks(marks);
  if (cs) out = overlayRun(out, resolveCharacter(sheet, cs));
  return overlayRun(out, propsFromMarks(marks));
}

/** The font box value: a named font (theme fonts resolved) and the size (hundredths of a point; Word's 10 pt fallback). */
export function fontBoxValue(state: EditorState, sheet: StyleSheet | null | undefined): { font: FontFace; size: number } {
  const r = resolvedRunAt(state, sheet);
  return { font: { kind: "named", value: fontName(r.font) ?? "Calibri" }, size: r.size ?? 1000 };
}
