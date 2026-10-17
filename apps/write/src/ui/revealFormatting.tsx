// Word's Reveal Formatting pane (Shift+F1): the formatting in effect at the
// selection start – Font, Paragraph and Section – with, on request
// ("Distinguish style source"), where each value comes from: direct
// formatting, the character style, a style of the paragraph's `basedOn`
// chain or the document defaults.

import { useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { PageSetup } from "../generated/PageSetup";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { StyleSheet } from "../generated/StyleSheet";
import { fontName, resolvedRunAt } from "../features/fontBox";
import { currentSection } from "../features/structureCommands";
import { getStyle, paragraphStyleId, resolveCharacter, resolveParagraph, styleChain, styleLabel } from "../features/styleCss";
import type { WriteFeatures } from "../features/WriteFeatures";
import { paragraphPropsFromPM, propsFromMarks, styleFromMarks } from "../sync/fromPM";
import type { RunProperties } from "../sync/model";
import { colorCss, TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { useThrottledEditorState } from "./useThrottledEditorState";
import { cm, pt } from "./dialogs";
import { t as tr, useT } from "../i18n";

/** One line of the pane: what, its value, and where it comes from (`direct`, `defaults` or a style's name). */
export interface RevealItem {
  key: string;
  label: string;
  value: string;
  source: string;
}

export interface RevealSection {
  id: "font" | "paragraph" | "section";
  items: RevealItem[];
}

function caretParagraph(state: EditorState): PMNode | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) if (TEXTBLOCK_TYPES.has($from.node(d).type.name)) return $from.node(d);
  return null;
}

/** Where run property `key` comes from: direct, the character style, the nearest style of the paragraph chain defining it, or the defaults. */
function runSource(sheet: StyleSheet | null | undefined, key: keyof RunProperties, direct: RunProperties, charStyle: string | undefined, paraStyle: string): string {
  if (direct[key] != null) return "direct";
  if (charStyle && resolveCharacter(sheet, charStyle)[key] != null) {
    const s = getStyle(sheet, charStyle);
    return s ? styleLabel(s) : charStyle;
  }
  for (const s of [...styleChain(sheet, paraStyle)].reverse()) if (s.run?.[key] != null) return styleLabel(s);
  return "defaults";
}

function paragraphSource(sheet: StyleSheet | null | undefined, key: keyof ParagraphProperties, direct: ParagraphProperties, paraStyle: string): string {
  if (direct[key] != null) return "direct";
  for (const s of [...styleChain(sheet, paraStyle)].reverse()) if (s.paragraph?.[key] != null) return styleLabel(s);
  return "defaults";
}

const yes = () => tr("write.styles.yes");

/** The pane's content for the selection start of `state`. */
export function revealFormatting(state: EditorState, sheet: StyleSheet | null | undefined, page: PageSetup | null): RevealSection[] {
  const para = caretParagraph(state);
  const paraStyle = para ? paragraphStyleId(sheet, para) : "Normal";
  const { $from } = state.selection;
  const marks = state.storedMarks ?? ($from.parentOffset > 0 ? $from.marks() : ($from.nodeAfter?.marks ?? $from.marks()));
  const direct = propsFromMarks(marks);
  const charStyle = styleFromMarks(marks);
  const r = resolvedRunAt(state, sheet);
  const font: RevealItem[] = [];
  const add = (list: RevealItem[], key: string, label: string, value: string, source: string) => list.push({ key, label, value, source });
  const run = (key: keyof RunProperties, label: string, value: string) => add(font, key, label, value, runSource(sheet, key, direct, charStyle, paraStyle));
  run("font", tr("write.styles.font"), fontName(r.font) ?? "Calibri");
  run("size", tr("write.reveal.size"), `${(r.size ?? 1000) / 100} pt`);
  if (r.bold) run("bold", tr("fmt.bold"), yes());
  if (r.italic) run("italic", tr("fmt.italic"), yes());
  if (r.underline && r.underline !== "none") run("underline", tr("fmt.underline"), tr(`write.underline.${r.underline}`));
  if (r.color && r.color.kind !== "auto") run("color", tr("write.fontColor"), colorCss(r.color) ?? "");
  if (r.highlight && r.highlight.kind !== "auto") run("highlight", tr("write.highlight"), colorCss(r.highlight) ?? "");
  for (const fx of ["strike", "doubleStrike", "smallCaps", "allCaps", "hidden", "outline", "shadow", "emboss", "imprint"] as const) {
    if (r[fx]) run(fx, tr(`write.font.fx.${fx}`), yes());
  }
  if (r.verticalAlign === "superscript" || r.verticalAlign === "subscript") run("verticalAlign", tr(`write.font.fx.${r.verticalAlign}`), yes());
  if (r.charSpacing) run("charSpacing", tr("write.font.spacing"), `${tr(r.charSpacing > 0 ? "write.font.expanded" : "write.font.condensed")} ${Math.abs(r.charSpacing) / 20} pt`);
  if (r.scale && r.scale !== 100) run("scale", tr("write.font.scale"), `${r.scale} %`);
  if (r.position) run("position", tr("write.font.position"), `${tr(r.position > 0 ? "write.font.raised" : "write.font.lowered")} ${Math.abs(r.position) / 2} pt`);
  if (r.kerning) run("kerning", tr("write.font.kerning"), `${r.kerning / 2} pt`);

  const paragraph: RevealItem[] = [];
  const pd: ParagraphProperties = para ? paragraphPropsFromPM(para) : {};
  const style = getStyle(sheet, paraStyle);
  add(paragraph, "style", tr("write.reveal.style"), style ? styleLabel(style) : paraStyle, pd.style ? "direct" : "defaults");
  const eff: ParagraphProperties = { ...resolveParagraph(sheet, paraStyle) };
  for (const [k, v] of Object.entries(pd)) if (v != null && k !== "style") (eff as Record<string, unknown>)[k] = k === "indent" || k === "spacing" ? { ...((eff as Record<string, unknown>)[k] as object), ...(v as object) } : v;
  const p = (key: keyof ParagraphProperties, label: string, value: string) => add(paragraph, key, label, value, paragraphSource(sheet, key, pd, paraStyle));
  p("alignment", tr("write.reveal.alignment"), tr(`write.styles.align.${eff.alignment ?? "left"}`));
  const ind = eff.indent ?? {};
  const first = ind.firstLine ? `${tr("write.reveal.firstLine")} ${cm(ind.firstLine)} cm` : ind.hanging ? `${tr("write.reveal.hanging")} ${cm(ind.hanging)} cm` : "";
  p("indent", tr("write.reveal.indentation"), [`${tr("write.reveal.left")} ${cm(ind.left ?? 0)} cm`, `${tr("write.reveal.right")} ${cm(ind.right ?? 0)} cm`, first].filter(Boolean).join(", "));
  const sp = eff.spacing ?? {};
  const line = sp.line ? (sp.line.kind === "multiple" ? `${Math.round(sp.line.value * 100) / 100} ${tr("write.reveal.lines")}` : `${tr(sp.line.kind === "exact" ? "write.reveal.exactly" : "write.reveal.atLeast")} ${pt(sp.line.value)} pt`) : `1 ${tr("write.reveal.lines")}`;
  p("spacing", tr("write.reveal.spacing"), `${tr("write.styles.spaceBefore")} ${pt(sp.before ?? 0)} pt, ${tr("write.styles.spaceAfter")} ${pt(sp.after ?? 0)} pt, ${line}`);
  if (eff.outlineLevel != null && eff.outlineLevel < 9) p("outlineLevel", tr("write.outlineLevel"), tr("write.outlineLevelN", { n: eff.outlineLevel + 1 }));
  if (eff.keepNext) p("keepNext", tr("write.reveal.keepNext"), yes());
  if (eff.numbering && eff.numbering.numId) p("numbering", tr("write.styles.numbering"), tr("write.styles.levelN", { n: eff.numbering.level + 1 }));

  const section: RevealItem[] = [];
  if (page) {
    const m = page.margins;
    add(section, "margins", tr("write.reveal.margins"), `${tr("write.reveal.left")} ${cm(m.left)} cm, ${tr("write.reveal.right")} ${cm(m.right)} cm, ${tr("write.reveal.top")} ${cm(m.top)} cm, ${tr("write.reveal.bottom")} ${cm(m.bottom)} cm`, "direct");
    add(section, "paper", tr("write.reveal.paper"), `${cm(page.width)} × ${cm(page.height)} cm`, "direct");
    add(section, "orientation", tr("print.orientation"), tr(page.orientation === "landscape" ? "print.landscape" : "print.portrait"), "direct");
  }
  return [
    { id: "font", items: font },
    { id: "paragraph", items: paragraph },
    { id: "section", items: section },
  ];
}

/** The source as shown ("Direct formatting", "Heading 1", "Document defaults"). */
export function sourceLabel(source: string): string {
  return source === "direct" ? tr("write.reveal.direct") : source === "defaults" ? tr("write.reveal.defaults") : source;
}

export function RevealFormattingPane({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = features.ui;
  const open = useSyncExternalStore(ui.subscribe, () => ui.getState().revealFormatting);
  const distinguish = useSyncExternalStore(ui.subscribe, () => ui.getState().revealSource);
  // Follows the editor state (throttled); the content is computed only while the pane is shown.
  const state = useThrottledEditorState({ editor, selector: ({ editor: e }) => e.state });
  const styles = useSyncExternalStore(ctl.subscribe, () => ctl.styles);
  if (!open) return null;
  const sections = revealFormatting(state, styles, currentSection(state, ctl.sections)?.page ?? ctl.page);
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-ui-border bg-ui-panel text-sm text-ui-fg" role="complementary" aria-label={t("write.reveal.title")} data-testid="reveal-formatting">
      <div className="flex items-center justify-between border-b border-ui-border px-2 py-1">
        <span className="font-medium">{t("write.reveal.title")}</span>
        <button type="button" className="h-8 min-w-8 rounded border border-ui-border bg-ui-bg px-2 text-xs hover:bg-ui-hover" aria-label={t("common.close")} onClick={() => ui.set({ revealFormatting: false })}>
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {sections.map((s) => (
          <section key={s.id} aria-label={t(`write.reveal.${s.id}`)} className="mb-2" data-testid={`reveal-${s.id}`}>
            <h3 className="mb-0.5 text-xs font-semibold uppercase text-ui-muted">{t(`write.reveal.${s.id}`)}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
              {s.items.map((i) => (
                <div key={i.key} className="contents" data-testid={`reveal-item-${i.key}`}>
                  <dt className="text-ui-muted">{i.label}</dt>
                  <dd>
                    {i.value}
                    {distinguish && <span className="block text-[11px] text-ui-muted">{sourceLabel(i.source)}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <label className="flex items-center gap-1 border-t border-ui-border p-2 text-xs">
        <input type="checkbox" checked={distinguish} onChange={(e) => ui.set({ revealSource: e.target.checked })} /> {t("write.reveal.distinguish")}
      </label>
    </aside>
  );
}
