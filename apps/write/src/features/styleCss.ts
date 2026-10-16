// Named styles on the UI side (P8-21): a mirror of `model_text::StyleSheet`'s
// resolution (document defaults → `basedOn` chain; character styles without
// the defaults; a linked style through its character half), the CSS of the
// whole style sheet (installed as one `<style>` element, so a modified style
// re-renders every paragraph that uses it without touching the editor
// document), gallery / Styles pane lists and filters, display names and
// previews.

import type { CSSProperties } from "react";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { FontFace } from "../../../../packages/ui-shared/src/generated/FontFace";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { Style } from "../generated/Style";
import type { StyleKind } from "../generated/StyleKind";
import type { StyleSheet } from "../generated/StyleSheet";
import { applyParagraphPatch } from "../sync/model";
import { colorCss, paragraphBoxCss, TEXTBLOCK_TYPES, TWIPS_PER_PX } from "../sync/schema";
import { styleOf } from "../sync/editorCommands";
import { t } from "../i18n";

// ----- resolution ------------------------------------------------------------------

export const isParagraphKind = (k: StyleKind): boolean => k === "paragraph" || k === "linked";
const family = (k: StyleKind): StyleKind => (k === "linked" ? "paragraph" : k);

export function getStyle(sheet: StyleSheet | null | undefined, id: string | null | undefined): Style | undefined {
  return id ? sheet?.styles.find((s) => s.id === id) : undefined;
}

/** The default style of `kind`'s family (Normal, Default Paragraph Font, …). */
export function defaultStyle(sheet: StyleSheet | null | undefined, kind: StyleKind): Style | undefined {
  return sheet?.styles.find((s) => family(s.kind) === family(kind) && s.isDefault);
}

/** The `basedOn` chain of `id`, root first (cycles and missing parents cut). */
export function styleChain(sheet: StyleSheet | null | undefined, id: string): Style[] {
  const out: Style[] = [];
  let s = getStyle(sheet, id);
  while (s && !out.includes(s)) {
    out.push(s);
    s = getStyle(sheet, s.basedOn);
  }
  return out.reverse();
}

/** Overlays the set fields of `over` onto `base` (like `RunProperties::apply`). */
export function overlayRun(base: RunProperties, over: RunProperties | null | undefined): RunProperties {
  const out: RunProperties = { ...base };
  if (over) for (const [k, v] of Object.entries(over)) if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Effective run formatting of a paragraph style: defaults → chain. */
export function resolveRun(sheet: StyleSheet | null | undefined, id: string): RunProperties {
  let out: RunProperties = { ...(sheet?.defaults.run ?? {}) };
  for (const s of styleChain(sheet, id)) out = overlayRun(out, s.run);
  return out;
}

/** What a character style adds (its chain, no defaults); a linked style through its character half. */
export function resolveCharacter(sheet: StyleSheet | null | undefined, id: string): RunProperties {
  const s = getStyle(sheet, id);
  const cid = s?.kind === "linked" && s.link ? s.link : id;
  let out: RunProperties = {};
  for (const x of styleChain(sheet, cid)) out = overlayRun(out, x.run);
  return out;
}

/** Effective paragraph formatting of a style: defaults → chain (`style` set). */
export function resolveParagraph(sheet: StyleSheet | null | undefined, id: string): ParagraphProperties {
  let out: ParagraphProperties = structuredClone(sheet?.defaults.paragraph ?? {});
  for (const s of styleChain(sheet, id)) out = applyParagraphPatch(out, { ...(s.paragraph ?? {}), style: null });
  return { ...out, style: id };
}

/** The style a textblock node uses (its own, else the default paragraph style). */
export function paragraphStyleId(sheet: StyleSheet | null | undefined, node: PMNode): string {
  const id = styleOf(node);
  return getStyle(sheet, id) ? id : (defaultStyle(sheet, "paragraph")?.id ?? "Normal");
}

// ----- display ---------------------------------------------------------------------

/** Word's built-in style names (lower case, as stored in docx) → catalog keys. */
const BUILTIN_KEYS: Record<string, string> = {
  normal: "write.style.normal",
  title: "write.style.title",
  subtitle: "write.styleName.subtitle",
  "no spacing": "write.styleName.noSpacing",
  quote: "write.styleName.quote",
  "intense quote": "write.styleName.intenseQuote",
  "list paragraph": "write.styleName.listParagraph",
  "subtle emphasis": "write.styleName.subtleEmphasis",
  emphasis: "write.styleName.emphasis",
  "intense emphasis": "write.styleName.intenseEmphasis",
  strong: "write.styleName.strong",
  "subtle reference": "write.styleName.subtleReference",
  "intense reference": "write.styleName.intenseReference",
  "book title": "write.styleName.bookTitle",
  caption: "write.styleName.caption",
  header: "write.styleName.header",
  footer: "write.styleName.footer",
  "footnote text": "write.styleName.footnoteText",
  "footnote reference": "write.styleName.footnoteReference",
  "endnote text": "write.styleName.endnoteText",
  "endnote reference": "write.styleName.endnoteReference",
  hyperlink: "write.styleName.hyperlink",
  "default paragraph font": "write.styleName.defaultParagraphFont",
  "toc heading": "write.styleName.tocHeading",
  "table grid": "write.styleName.tableGrid",
};

/** The name of a built-in style in the UI language ("heading 1" → "Heading 1" / "Überschrift 1"); other names as they are. */
export function displayName(name: string): string {
  const n = name.trim().toLowerCase();
  const key = BUILTIN_KEYS[n];
  if (key) return t(key);
  let m = /^heading ([1-9])$/.exec(n);
  if (m) return t("write.style.heading", { n: Number(m[1]) });
  m = /^toc ([1-9])$/.exec(n);
  if (m) return t("write.styleName.toc", { n: Number(m[1]) });
  const ch = /^(.*) char$/.exec(n);
  if (ch && (BUILTIN_KEYS[ch[1]!] || /^heading [1-9]$/.test(ch[1]!))) return `${displayName(ch[1]!)} ${t("write.styleName.charSuffix")}`;
  return name;
}

export const styleLabel = (s: Style): string => displayName(s.name);

/** Finds a style by its display name or stored name (case-insensitive), e.g. what was typed into the Apply Styles box. */
export function findStyleByName(sheet: StyleSheet | null | undefined, text: string): Style | undefined {
  const q = text.trim().toLowerCase();
  if (!q || !sheet) return undefined;
  return sheet.styles.find((s) => !s.hidden && (s.name.toLowerCase() === q || styleLabel(s).toLowerCase() === q || s.id.toLowerCase() === q));
}

// ----- CSS ---------------------------------------------------------------------------

const THEME_FONTS: Record<string, string> = {
  majorLatin: '"Calibri Light", Calibri, Carlito, "Segoe UI", sans-serif',
  minorLatin: 'Calibri, Carlito, "Segoe UI", sans-serif',
};

export function fontCss(font: FontFace | null | undefined): string | undefined {
  if (!font) return undefined;
  if (font.kind === "named") return `"${font.value.replace(/["\\]/g, "")}"`;
  return THEME_FONTS[font.value] ?? THEME_FONTS.minorLatin;
}

const px = (twips: number) => `${(twips / TWIPS_PER_PX).toFixed(2)}px`;
const ptOf = (twips: number) => `${twips / 20}pt`;

/** CSS declarations of run properties; `full` also states the defaults (paragraph styles override the browser's heading looks). */
export function runCss(r: RunProperties, full: boolean): string[] {
  const css: string[] = [];
  const font = fontCss(r.font);
  if (font) css.push(`font-family: ${font}`);
  if (r.size != null) css.push(`font-size: ${r.size / 100}pt`);
  const color = r.color && r.color.kind !== "auto" ? colorCss(r.color) : undefined;
  if (color) css.push(`color: ${color}`);
  if (r.bold != null || full) css.push(`font-weight: ${r.bold ? 700 : 400}`);
  if (r.italic != null || full) css.push(`font-style: ${r.italic ? "italic" : "normal"}`);
  const deco = [r.underline && r.underline !== "none" ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean);
  if (deco.length) css.push(`text-decoration: ${deco.join(" ")}`);
  else if (r.underline === "none" || r.strike === false) css.push("text-decoration: none");
  if (r.verticalAlign === "superscript" || r.verticalAlign === "subscript") {
    css.push(`vertical-align: ${r.verticalAlign === "superscript" ? "super" : "sub"}`, "font-size: 0.7em");
  }
  const hl = r.highlight && r.highlight.kind !== "auto" ? colorCss(r.highlight) : undefined;
  if (hl) css.push(`background-color: ${hl}`);
  return css;
}

/** CSS declarations of paragraph properties (alignment, spacing, indents, borders, shading). */
export function paragraphCss(p: ParagraphProperties): string[] {
  const css: string[] = [];
  if (p.alignment) css.push(`text-align: ${p.alignment}`);
  const sp = p.spacing;
  if (sp) {
    css.push(`margin-top: ${ptOf(sp.before ?? 0)}`, `margin-bottom: ${ptOf(sp.after ?? 0)}`);
    if (sp.line?.kind === "multiple") css.push(`line-height: ${Math.round(sp.line.value * 1000) / 1000}`);
    else if (sp.line) css.push(`line-height: ${px(sp.line.value)}`);
  }
  const ind = p.indent;
  if (ind) {
    if (ind.left != null) css.push(`margin-left: ${px(ind.left)}`);
    if (ind.right != null) css.push(`margin-right: ${px(ind.right)}`);
    if (ind.firstLine != null) css.push(`text-indent: ${px(ind.firstLine)}`);
    else if (ind.hanging != null) css.push(`text-indent: -${px(ind.hanging)}`);
  }
  if (p.borders || p.shading) css.push(...paragraphBoxCss(p.borders, p.shading, p.indent));
  return css;
}

const attr = (id: string) => id.replace(/["\\]/g, "\\$&");
const SCOPE = ".tiptap-content";

/** Selectors of the paragraphs that use paragraph style `id`. */
export function paragraphSelectors(id: string, isDefault: boolean): string[] {
  const out = [`${SCOPE} p[data-style="${attr(id)}"]`];
  const h = /^Heading([1-6])$/.exec(id);
  if (h) out.push(`${SCOPE} h${h[1]}`);
  if (id === "Title") out.push(`${SCOPE} .doc-title`);
  if (isDefault) out.push(`${SCOPE} p:not([data-style]):not(.doc-title)`);
  return out;
}

/**
 * The CSS of a style sheet: the base font of the editor (default style),
 * one rule per paragraph / linked style (resolved formatting) and one per
 * character style (`span[data-cstyle]`, what it adds). Direct formatting is
 * inline in the editor and wins.
 */
export function styleSheetCss(sheet: StyleSheet | null | undefined): string {
  if (!sheet) return "";
  const rules: string[] = [];
  const def = defaultStyle(sheet, "paragraph");
  if (def) {
    const base = runCss(resolveRun(sheet, def.id), false).filter((d) => /^(font-family|font-size|color)/.test(d));
    if (base.length) rules.push(`${SCOPE} { ${base.join("; ")}; }`);
  }
  for (const s of sheet.styles) {
    if (isParagraphKind(s.kind)) {
      const decl = [...paragraphCss(resolveParagraph(sheet, s.id)), ...runCss(resolveRun(sheet, s.id), true)];
      if (decl.length) rules.push(`${paragraphSelectors(s.id, s.isDefault ?? false).join(", ")} { ${decl.join("; ")}; }`);
    }
    if (s.kind === "character" || s.kind === "linked") {
      const decl = runCss(resolveCharacter(sheet, s.id), false);
      if (decl.length) rules.push(`${SCOPE} span[data-cstyle="${attr(s.id)}"] { ${decl.join("; ")}; }`);
    }
  }
  return rules.join("\n");
}

const STYLE_ELEMENT_ID = "rusuite-write-styles";

/** Installs (or replaces) the style sheet's CSS in the page. */
export function installStyleSheetCss(sheet: StyleSheet | null | undefined, doc: Document | null = typeof document === "undefined" ? null : document): void {
  if (!doc) return;
  let el = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(el);
  }
  const css = styleSheetCss(sheet);
  if (el.textContent !== css) el.textContent = css;
}

/** Inline style of a gallery / pane preview: the style's font, colour and weight, sizes scaled into the item. */
export function previewStyle(sheet: StyleSheet | null | undefined, s: Style, maxPt = 16): CSSProperties {
  const r = isParagraphKind(s.kind) ? resolveRun(sheet, s.id) : overlayRun(resolveRun(sheet, defaultStyle(sheet, "paragraph")?.id ?? "Normal"), resolveCharacter(sheet, s.id));
  const size = r.size != null ? Math.max(8, Math.min(maxPt, r.size / 100)) : 11;
  const deco = [r.underline && r.underline !== "none" ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ");
  const p = isParagraphKind(s.kind) ? resolveParagraph(sheet, s.id) : null;
  return {
    fontFamily: fontCss(r.font),
    fontSize: `${size}pt`,
    color: r.color && r.color.kind !== "auto" ? colorCss(r.color) : undefined,
    fontWeight: r.bold ? 700 : 400,
    fontStyle: r.italic ? "italic" : "normal",
    textDecoration: deco || undefined,
    backgroundColor: r.highlight && r.highlight.kind !== "auto" ? colorCss(r.highlight) : undefined,
    textAlign: p?.alignment === "center" ? "center" : undefined,
    lineHeight: 1.1,
  };
}

// ----- lists --------------------------------------------------------------------------

/** Ids of the styles used in the editor document: paragraph styles (unstyled = the default), character styles; a linked style counts when its character half is used. */
export function stylesInUse(doc: PMNode, sheet: StyleSheet | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string) => out.set(id, (out.get(id) ?? 0) + 1);
  doc.descendants((node) => {
    if (!TEXTBLOCK_TYPES.has(node.type.name)) return true;
    add(paragraphStyleId(sheet, node));
    const chars = new Set<string>();
    node.forEach((child) => {
      const m = child.marks.find((x) => x.type.name === "charStyle");
      if (m?.attrs.id) chars.add(String(m.attrs.id));
    });
    for (const c of chars) {
      add(c);
      const half = getStyle(sheet, c);
      if (half?.link && getStyle(sheet, half.link)?.kind === "linked") add(half.link);
    }
    return false;
  });
  return out;
}

const applicable = (s: Style) => s.kind === "paragraph" || s.kind === "linked" || s.kind === "character";
/** The character half of a linked style (listed through its paragraph style). */
const isLinkedHalf = (sheet: StyleSheet, s: Style) => s.kind === "character" && !!s.link && getStyle(sheet, s.link)?.kind === "linked";
/** Sort priority: `uiPriority`, the default paragraph style first (Word writes none for Normal). */
const priorityOf = (s: Style) => (s.isDefault && isParagraphKind(s.kind) ? 0 : (s.priority ?? 99));
const byPriority = (sheet: StyleSheet) => (a: Style, b: Style) =>
  priorityOf(a) - priorityOf(b) || sheet.styles.indexOf(a) - sheet.styles.indexOf(b);

/**
 * The Styles gallery (Home › Styles): quick styles in Word's order (by
 * priority). Like Word, Heading N (N ≥ 3) appears once Heading N−1 or itself
 * is used; hidden styles never, semi-hidden ones once used.
 */
export function galleryStyles(sheet: StyleSheet | null | undefined, inUse: Map<string, number>): Style[] {
  if (!sheet) return [];
  return sheet.styles
    .filter((s) => applicable(s) && s.quickFormat && !s.hidden && !isLinkedHalf(sheet, s))
    .filter((s) => !s.semiHidden || inUse.has(s.id))
    .filter((s) => headingShown(s, inUse))
    .sort(byPriority(sheet));
}

/** Word shows Heading N (N ≥ 3) once Heading N−1 or itself is used. */
const headingShown = (s: Style, inUse: Map<string, number>): boolean => {
  const h = /^Heading([3-9])$/.exec(s.id);
  return !h || inUse.has(s.id) || inUse.has(`Heading${Number(h[1]) - 1}`);
};

export type StyleFilter = "recommended" | "inUse" | "all";

/** The Styles pane list: Recommended (priority below 99, user styles, styles in use, Heading N as in the gallery; by priority), In use, All (alphabetical). */
export function paneStyles(sheet: StyleSheet | null | undefined, filter: StyleFilter, inUse: Map<string, number>): Style[] {
  if (!sheet) return [];
  const base = sheet.styles.filter((s) => applicable(s) && !s.hidden && !isLinkedHalf(sheet, s));
  const alpha = (a: Style, b: Style) => styleLabel(a).localeCompare(styleLabel(b));
  switch (filter) {
    case "inUse":
      return base.filter((s) => inUse.has(s.id)).sort(alpha);
    case "all":
      return base.sort(alpha);
    default:
      return base
        .filter((s) => inUse.has(s.id) || ((!s.semiHidden || s.custom) && (priorityOf(s) < 99 || s.custom || s.quickFormat) && headingShown(s, inUse)))
        .sort(byPriority(sheet));
  }
}

/** A style id for a new style called `name` (letters and digits, like Word and `StyleSheet::unique_id`). */
export function uniqueStyleId(sheet: StyleSheet | null | undefined, name: string): string {
  const base = [...name].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("") || "Style";
  if (!getStyle(sheet, base)) return base;
  for (let n = 1; ; n++) if (!getStyle(sheet, `${base}${n}`)) return `${base}${n}`;
}
