// Design › Document Formatting (Word): the Style Sets gallery (the core's
// built-in sets plus the user's own, "Save as a New Style Set"), "Set as
// Default" (new blank documents start with the set) and Paragraph
// Spacing (the spacing of the document defaults). The user's sets and the
// default live in this browser / app only (ADR 0009); what a set does to a
// document is stored in it as ordinary style definitions.

import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { StyleSet } from "../generated/StyleSet";
import type { StyleSheet } from "../generated/StyleSheet";
import type { WriteCommand } from "../generated/WriteCommand";

const CUSTOM_KEY = "rusuite.write.styleSets";
const DEFAULT_KEY = "rusuite.write.defaultStyleSet";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The user's saved style sets ("Save as a New Style Set"). */
export function loadCustomSets(): StyleSet[] {
  try {
    const raw = storage()?.getItem(CUSTOM_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list.filter((s) => s && typeof s.id === "string" && Array.isArray(s.styles)) as StyleSet[]) : [];
  } catch {
    return [];
  }
}

/** Saves `set` under its id (a set with the same name is replaced). */
export function saveCustomSet(set: StyleSet): StyleSet[] {
  const list = [...loadCustomSets().filter((s) => s.id !== set.id), set];
  storage()?.setItem(CUSTOM_KEY, JSON.stringify(list));
  return list;
}

/** Design › Set as Default: the set new blank documents start with (`null` clears it). */
export function saveDefaultSet(set: StyleSet | null): void {
  const s = storage();
  if (!s) return;
  if (set) s.setItem(DEFAULT_KEY, JSON.stringify(set));
  else s.removeItem(DEFAULT_KEY);
}

export function loadDefaultSet(): StyleSet | null {
  try {
    const raw = storage()?.getItem(DEFAULT_KEY);
    const set = raw ? (JSON.parse(raw) as StyleSet) : null;
    return set && typeof set.id === "string" && Array.isArray(set.styles) ? set : null;
  } catch {
    return null;
  }
}

/** `sheet` with `set` applied (the core's `StyleSheet::apply_style_set`, for previews and the current-set check). */
export function withStyleSet(sheet: StyleSheet, set: StyleSet): StyleSheet {
  const out = structuredClone(sheet);
  out.defaults = structuredClone(set.defaults);
  for (const e of set.styles) {
    const st = out.styles.find((s) => s.id === e.id);
    if (!st) continue;
    st.paragraph = structuredClone(e.paragraph ?? {});
    st.run = structuredClone(e.run ?? {});
  }
  return out;
}

const canon = (v: unknown): string => JSON.stringify(v ?? {}, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y != null).sort(([a], [b]) => a.localeCompare(b))) : x));

/** The id of the set the document's styles match (Word highlights it in the gallery), or null. */
export function currentSetId(sheet: StyleSheet | null | undefined, sets: StyleSet[]): string | null {
  if (!sheet) return null;
  for (const set of sets) {
    if (canon(set.defaults) !== canon(sheet.defaults)) continue;
    const same = set.styles.every((e) => {
      const st = sheet.styles.find((s) => s.id === e.id);
      return !st || (canon(st.paragraph) === canon(e.paragraph) && canon(st.run) === canon(e.run));
    });
    if (same) return set.id;
  }
  return null;
}

/** `ApplyStyleSet`. */
export const applyStyleSetCommand = (set: StyleSet): WriteCommand => ({ type: "applyStyleSet", set });

/** Word's Design › Paragraph Spacing presets: space before / after (twips) and line spacing (multiple). */
export const PARAGRAPH_SPACING = [
  { id: "none", before: 0, after: 0, line: 1 },
  { id: "compact", before: 0, after: 80, line: 1 },
  { id: "tight", before: 0, after: 120, line: 1.15 },
  { id: "open", before: 0, after: 200, line: 1.15 },
  { id: "relaxed", before: 0, after: 120, line: 1.5 },
  { id: "double", before: 0, after: 160, line: 2 },
] as const;
export type ParagraphSpacingId = (typeof PARAGRAPH_SPACING)[number]["id"];

/** `SetStyleDefaults` for a Paragraph Spacing preset. */
export function paragraphSpacingCommand(id: ParagraphSpacingId): WriteCommand | null {
  const p = PARAGRAPH_SPACING.find((x) => x.id === id);
  if (!p) return null;
  const paragraph: ParagraphProperties = { spacing: { before: p.before, after: p.after, line: { kind: "multiple", value: p.line } } };
  return { type: "setStyleDefaults", paragraph };
}

/** The preset the document defaults match, or null. */
export function currentParagraphSpacing(sheet: StyleSheet | null | undefined): ParagraphSpacingId | null {
  const sp = sheet?.defaults.paragraph?.spacing;
  const line = sp?.line?.kind === "multiple" ? sp.line.value : null;
  const hit = PARAGRAPH_SPACING.find((p) => (sp?.before ?? 0) === p.before && (sp?.after ?? 0) === p.after && line != null && Math.abs(line - p.line) < 0.01);
  return hit?.id ?? null;
}
