// Write's dialogs (Word's units: cm for lengths, pt for spacing): row
// height, picture alt text, page setup (custom margins), header & footer,
// paragraph (indents, spacing, line spacing). `WriteDialogs` shows the one
// the UI store asks for and applies the result.

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog } from "@rusuite/ui-shared";
import type { Alignment } from "../generated/Alignment";
import type { Block } from "../generated/Block";
import type { HeaderFooterSet } from "../generated/HeaderFooterSet";
import type { HeaderSlot } from "../generated/HeaderSlot";
import type { Inline } from "../generated/Inline";
import type { LevelKind } from "../generated/LevelKind";
import type { Section } from "../generated/Section";
import type { WriteCommand } from "../generated/WriteCommand";
import type { Indent } from "../generated/Indent";
import type { LineSpacing } from "../generated/LineSpacing";
import type { PageSetup } from "../generated/PageSetup";
import type { PageSetupPatch } from "../generated/PageSetupPatch";
import type { RowHeight } from "../generated/RowHeight";
import type { Spacing } from "../generated/Spacing";
import { selectedImage, setImageAttrs } from "../features/images";
import { indentAt, selectedTextblocks, setIndent, setSpacing, spacingAt } from "../features/formatting";
import {
  setCellMargins, setRowHeight, splitCellCommand, splitRowsValid, tableContext,
} from "../features/tables";
import {
  bordersShadingCommand, paragraphBorders, paragraphShading, selectedParagraphs, tabsDialogCommand, tabsOf, type BordersShadingValues,
} from "../features/paragraphFormat";
import { BordersShadingDialog, CellMarginsDialog, SplitCellsDialog, TabsDialog } from "./formatDialogs";
import { Tables2Dialogs } from "./tables2Dialogs";
import { WriteOptionsDialog } from "./optionsDialog";
import type { WriteUi } from "../features/WriteFeatures";
import { setAlignment } from "../sync/editorCommands";
import { nextTempId, type SyncController } from "../sync/SyncPlugin";
import { blocksText, sectionHf } from "../features/pagination";
import { currentSection } from "../features/structureCommands";
import { useT } from "../i18n";
import { selectedDrawing, setDrawingValue } from "../features/drawings/drawings";
import { applyRunPatch, formatTarget, runPatchBetween } from "../features/runFormat";
import { runPropsAt } from "../sync/editorCommands";
import { FontDialog } from "./styleDialogs";
import { paragraphStyleId, resolveParagraph } from "../features/styleCss";
import { fontBoxValue } from "../features/fontBox";

// ----- units ------------------------------------------------------------------------

export const TWIPS_PER_CM = 1440 / 2.54;
/** Twips → cm text with up to 2 decimals. */
export const cm = (twips: number | null | undefined): string => (twips == null ? "" : String(Math.round((twips / TWIPS_PER_CM) * 100) / 100));
/** cm text → twips (`null` when not a number). */

/**
 * Focuses `editor` synchronously (Tiptap's `focus` command waits for an animation frame): a dialog's OK/Cancel puts
 * the caret back before the dialog closes, so the next shortcut (Ctrl+D after the Paragraph dialog) reaches the
 * editor's keymap and the Dialog does not send the focus back to the ribbon button that opened it (P9-Q1).
 */
export function focusNow(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.focus();
  editor.commands.scrollIntoView();
}
export function fromCm(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(v) ? null : Math.round(v * TWIPS_PER_CM);
}
export const pt = (twips: number | null | undefined): string => (twips == null ? "" : String(Math.round((twips / 20) * 10) / 10));
export function fromPt(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(v) ? null : Math.round(v * 20);
}

export const INPUT = "h-7 w-24 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
export const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40";

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Buttons({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="mt-2 flex justify-end gap-2">
      <button type="submit" className={BUTTON} disabled={disabled}>
        {t("common.ok")}
      </button>
      <button type="button" className={BUTTON} onClick={onClose}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

// ----- row height -------------------------------------------------------------------

export function RowHeightDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: RowHeight | null | undefined;
  onSubmit: (h: RowHeight | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const [rule, setRule] = useState<"auto" | RowHeight["rule"]>("atLeast");
  useEffect(() => {
    if (!open) return;
    setValue(initial ? cm(initial.value) : "1");
    setRule(initial ? initial.rule : "auto");
  }, [open, initial]);
  const twips = fromCm(value);
  return (
    <Dialog open={open} title={t("write.rowHeight")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(rule === "auto" || twips == null ? null : { value: twips, rule });
        }}
      >
        <Row label={t("write.heightCm")}>
          <input aria-label={t("write.heightCm")} className={INPUT} value={value} disabled={rule === "auto"} onChange={(e) => setValue(e.target.value)} />
        </Row>
        <Row label={t("write.rowHeightIs")}>
          <select aria-label={t("write.rowHeightIs")} className={INPUT} value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
            <option value="auto">{t("write.auto")}</option>
            <option value="atLeast">{t("write.atLeast")}</option>
            <option value="exact">{t("write.exactly")}</option>
          </select>
        </Row>
        <Buttons onClose={onClose} disabled={rule !== "auto" && (twips == null || twips <= 0)} />
      </form>
    </Dialog>
  );
}

// ----- alt text ---------------------------------------------------------------------

export function AltTextDialog({ open, initial, decorative: decorativeInitial = false, onSubmit, onClose }: {
  open: boolean;
  initial: string;
  /** Mark as decorative (Word's Alt Text pane): screen readers skip the object; its description is not used. */
  decorative?: boolean;
  onSubmit: (alt: string, decorative: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [alt, setAlt] = useState(initial);
  const [decorative, setDecorative] = useState(decorativeInitial);
  useEffect(() => {
    if (open) {
      setAlt(initial);
      setDecorative(decorativeInitial);
    }
  }, [open, initial, decorativeInitial]);
  return (
    <Dialog open={open} title={t("write.altText")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(decorative ? "" : alt.trim(), decorative);
        }}
      >
        <p className="text-xs text-ui-muted">{t("write.altTextQuestion")}</p>
        <textarea aria-label={t("write.altText")} disabled={decorative} className="h-20 w-full rounded border border-ui-border bg-ui-bg p-2 text-sm text-ui-fg disabled:opacity-50" value={alt} onChange={(e) => setAlt(e.target.value)} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={decorative} onChange={(e) => setDecorative(e.target.checked)} />
          {t("write.markDecorative")}
        </label>
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- page setup -------------------------------------------------------------------

export function PageSetupDialog({ open, page, onSubmit, onClose }: {
  open: boolean;
  page: PageSetup | null;
  onSubmit: (patch: PageSetupPatch) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [m, setM] = useState({ top: "", bottom: "", left: "", right: "" });
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  useEffect(() => {
    if (!open) return;
    const pm = page?.margins;
    setM({ top: cm(pm?.top ?? 1440), bottom: cm(pm?.bottom ?? 1440), left: cm(pm?.left ?? 1440), right: cm(pm?.right ?? 1440) });
    setOrientation(page?.orientation ?? "portrait");
  }, [open, page]);
  const parsed = { top: fromCm(m.top), bottom: fromCm(m.bottom), left: fromCm(m.left), right: fromCm(m.right) };
  const valid = Object.values(parsed).every((v) => v != null && v >= 0);
  const field = (k: keyof typeof m, label: string) => (
    <Row label={label}>
      <input aria-label={label} className={INPUT} value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
    </Row>
  );
  return (
    <Dialog open={open} title={t("write.pageSetup")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit({ orientation, margins: { top: parsed.top!, bottom: parsed.bottom!, left: parsed.left!, right: parsed.right! } });
        }}
      >
        <p className="font-medium">{t("print.margins")}</p>
        {field("top", t("write.topCm"))}
        {field("bottom", t("write.bottomCm"))}
        {field("left", t("write.leftCm"))}
        {field("right", t("write.rightCm"))}
        <Row label={t("print.orientation")}>
          <select aria-label={t("print.orientation")} className={INPUT} value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
            <option value="portrait">{t("print.portrait")}</option>
            <option value="landscape">{t("print.landscape")}</option>
          </select>
        </Row>
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

// ----- header & footer --------------------------------------------------------------

/** The texts of the header/footer dialog: default, first-page and even-page header and footer. */
export interface HeaderFooterTexts {
  header: string;
  footer: string;
  firstHeader: string;
  firstFooter: string;
  evenHeader: string;
  evenFooter: string;
  /** Different first page (`titlePage`). */
  differentFirst: boolean;
  /** Different odd & even pages. */
  differentOddEven: boolean;
}

export const EMPTY_HF: HeaderFooterTexts = {
  header: "", footer: "", firstHeader: "", firstFooter: "", evenHeader: "", evenFooter: "", differentFirst: false, differentOddEven: false,
};

export function HeaderFooterDialog({ open, initial, focus, onSubmit, onClose }: {
  open: boolean;
  initial: HeaderFooterTexts;
  focus: "header" | "footer";
  onSubmit: (texts: HeaderFooterTexts) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState<HeaderFooterTexts>(initial);
  useEffect(() => {
    if (!open) return;
    setV(initial);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-slot="${focus}"]`)?.focus(), 0);
  }, [open, initial, focus]);
  const set = (k: keyof HeaderFooterTexts) => (value: string | boolean) => setV((cur) => ({ ...cur, [k]: value }));
  const area = (slot: keyof HeaderFooterTexts, label: string) => {
    const value = v[slot] as string;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span>{label}</span>
          <button type="button" className={`${BUTTON} h-6 px-2 text-xs`} onClick={() => set(slot)(`${value}{PAGE}`)}>
            {t("write.insertPageNumber")}
          </button>
        </div>
        <textarea aria-label={label} data-slot={slot} className="h-12 w-full rounded border border-ui-border bg-ui-bg p-2 text-sm text-ui-fg" value={value} onChange={(e) => set(slot)(e.target.value)} />
      </div>
    );
  };
  const check = (k: "differentFirst" | "differentOddEven", label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" aria-label={label} checked={v[k]} onChange={(e) => set(k)(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  return (
    <Dialog open={open} title={t("print.headerFooter")} onClose={onClose}>
      <form
        className="flex max-h-[70vh] w-96 flex-col gap-2 overflow-auto text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = (x: string) => x.replace(/\r/g, "");
          onSubmit({
            ...v,
            header: clean(v.header), footer: clean(v.footer), firstHeader: clean(v.firstHeader), firstFooter: clean(v.firstFooter),
            evenHeader: clean(v.evenHeader), evenFooter: clean(v.evenFooter),
          });
        }}
      >
        <div className="flex gap-4">
          {check("differentFirst", t("write.hf.differentFirst"))}
          {check("differentOddEven", t("write.hf.differentOddEven"))}
        </div>
        {area("header", v.differentOddEven ? t("write.hf.oddHeader") : t("print.header"))}
        {area("footer", v.differentOddEven ? t("write.hf.oddFooter") : t("print.footer"))}
        {v.differentFirst && area("firstHeader", t("write.hf.firstHeader"))}
        {v.differentFirst && area("firstFooter", t("write.hf.firstFooter"))}
        {v.differentOddEven && area("evenHeader", t("write.hf.evenHeader"))}
        {v.differentOddEven && area("evenFooter", t("write.hf.evenFooter"))}
        <p className="text-xs text-ui-muted">{t("write.hf.note", { page: "{PAGE}" })}</p>
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- page numbers -----------------------------------------------------------------

export const PAGE_NUMBER_FORMATS: { id: LevelKind; sample: string }[] = [
  { id: "decimal", sample: "1, 2, 3" },
  { id: "lowerRoman", sample: "i, ii, iii" },
  { id: "upperRoman", sample: "I, II, III" },
  { id: "lowerLetter", sample: "a, b, c" },
  { id: "upperLetter", sample: "A, B, C" },
];

export function PageNumbersDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: { format: LevelKind; start: number | null };
  onSubmit: (v: { format: LevelKind; start: number | null }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [format, setFormat] = useState<LevelKind>("decimal");
  const [restart, setRestart] = useState(false);
  const [start, setStart] = useState("1");
  useEffect(() => {
    if (!open) return;
    setFormat(initial.format);
    setRestart(initial.start != null);
    setStart(String(initial.start ?? 1));
  }, [open, initial]);
  const n = Number(start);
  const valid = !restart || (Number.isInteger(n) && n >= 1);
  return (
    <Dialog open={open} title={t("write.formatPageNumbers")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ format, start: restart ? n : null });
        }}
      >
        <Row label={t("write.pageNumberFormat")}>
          <select aria-label={t("write.pageNumberFormat")} className={INPUT} value={format} onChange={(e) => setFormat(e.target.value as LevelKind)}>
            {PAGE_NUMBER_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.sample}
              </option>
            ))}
          </select>
        </Row>
        <label className="flex items-center gap-2">
          <input type="radio" name="pn-start" checked={!restart} onChange={() => setRestart(false)} />
          <span>{t("write.pageNumberContinue")}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="pn-start" checked={restart} onChange={() => setRestart(true)} />
          <span>{t("write.pageNumberStartAt")}</span>
          <input aria-label={t("write.pageNumberStartAt")} className={`${INPUT} w-16`} value={start} disabled={!restart} onChange={(e) => setStart(e.target.value)} />
        </label>
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

/** Header/footer text → blocks (one paragraph per line, `{PAGE}` as a page field); `null` for an empty text. */
export function hfBlocks(text: string): Block[] | null {
  if (!text.trim()) return null;
  return text.split("\n").map((line) => {
    const inlines: Inline[] = [];
    line.split("{PAGE}").forEach((part, i) => {
      if (i > 0) inlines.push({ kind: "field", value: { kind: { kind: "page" }, cached: "1" } });
      if (part) inlines.push({ kind: "run", value: { text: part } });
    });
    return { kind: "paragraph", value: { id: nextTempId(), inlines } } as Block;
  });
}

/** The dialog's texts for section `index` (inherited slots included). */
export function headerFooterTexts(sections: Section[], index: number, page: PageSetup | null): HeaderFooterTexts {
  if (!sections.length) return { ...EMPTY_HF, header: page?.headerText ?? "", footer: page?.footerText ?? "" };
  const text = (footer: boolean, slot: keyof HeaderFooterSet) => blocksText(sectionHf(sections, index, footer, slot));
  const sec = sections[index]!;
  const differentOddEven = sections.some((s) => s.headers?.even != null || s.footers?.even != null);
  return {
    header: text(false, "default"),
    footer: text(true, "default"),
    firstHeader: sec.titlePage ? text(false, "first") : "",
    firstFooter: sec.titlePage ? text(true, "first") : "",
    evenHeader: differentOddEven ? text(false, "even") : "",
    evenFooter: differentOddEven ? text(true, "even") : "",
    differentFirst: sec.titlePage,
    differentOddEven,
  };
}

/** Commands turning `before` into `after` for section `id`: `titlePage` and the changed slots as blocks. */
export function headerFooterCommands(id: number, before: HeaderFooterTexts, after: HeaderFooterTexts): WriteCommand[] {
  const out: WriteCommand[] = [];
  if (after.differentFirst !== before.differentFirst) out.push({ type: "setSection", section: id, patch: { titlePage: after.differentFirst } });
  const slot = (footer: boolean, s: HeaderSlot, key: keyof HeaderFooterTexts, enabled: boolean) => {
    const was = before[key] as string;
    const now = enabled ? (after[key] as string) : "";
    if (now !== was || (!enabled && was)) out.push({ type: "setHeaderFooter", section: id, footer, slot: s, blocks: hfBlocks(now) });
  };
  slot(false, "default", "header", true);
  slot(true, "default", "footer", true);
  slot(false, "first", "firstHeader", after.differentFirst);
  slot(true, "first", "firstFooter", after.differentFirst);
  slot(false, "even", "evenHeader", after.differentOddEven);
  slot(true, "even", "evenFooter", after.differentOddEven);
  return out;
}

// ----- paragraph --------------------------------------------------------------------

export interface ParagraphValues {
  alignment: Alignment | null;
  indent: Indent;
  spacing: Spacing;
  /** Line and Page Breaks (effective values: style chain + direct). */
  flow?: FlowValues;
  /** Outline level in effect (`w:outlineLvl`: 0 = Level 1 … 8 = Level 9, 9 = Body Text). */
  outlineLevel?: number;
}

/** The Line and Page Breaks tab (Word's Pagination and Formatting exceptions). */
export interface FlowValues {
  widowControl: boolean;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  suppressLineNumbers: boolean;
  suppressAutoHyphens: boolean;
}

export const FLOW_KEYS: (keyof FlowValues)[] = ["widowControl", "keepNext", "keepLines", "pageBreakBefore", "suppressLineNumbers", "suppressAutoHyphens"];

/** The flow values of the resolved paragraph properties `p` (Word's defaults: widow control on, the rest off). */
export function flowValues(p: Partial<Record<keyof FlowValues, boolean | null | undefined>>): FlowValues {
  return {
    widowControl: p.widowControl ?? true,
    keepNext: !!p.keepNext,
    keepLines: !!p.keepLines,
    pageBreakBefore: !!p.pageBreakBefore,
    suppressLineNumbers: !!p.suppressLineNumbers,
    suppressAutoHyphens: !!p.suppressAutoHyphens,
  };
}

/** The direct properties changed between `before` and `after` (what `SetParagraphProps` gets). */
export function flowPatch(before: FlowValues, after: FlowValues): Partial<FlowValues> {
  const out: Partial<FlowValues> = {};
  for (const k of FLOW_KEYS) if (before[k] !== after[k]) out[k] = after[k];
  return out;
}

type LineRule = "single" | "1.5" | "double" | "multiple" | "atLeast" | "exact";

export function lineRuleOf(line: LineSpacing | null | undefined): { rule: LineRule; value: string } {
  if (!line) return { rule: "single", value: "1" };
  if (line.kind === "multiple") {
    if (line.value === 1) return { rule: "single", value: "1" };
    if (line.value === 1.5) return { rule: "1.5", value: "1.5" };
    if (line.value === 2) return { rule: "double", value: "2" };
    // Word shows two decimals (259 / 240 = 1.08 lines).
    return { rule: "multiple", value: String(Math.round(line.value * 100) / 100) };
  }
  return { rule: line.kind === "exact" ? "exact" : "atLeast", value: pt(line.value) };
}

export function lineSpacingOf(rule: LineRule, value: string): LineSpacing | null {
  switch (rule) {
    case "single":
      return { kind: "multiple", value: 1 };
    case "1.5":
      return { kind: "multiple", value: 1.5 };
    case "double":
      return { kind: "multiple", value: 2 };
    case "multiple": {
      const v = Number(value.replace(",", "."));
      return Number.isFinite(v) && v > 0 ? { kind: "multiple", value: v } : null;
    }
    default: {
      const t = fromPt(value);
      return t != null && t > 0 ? { kind: rule, value: t } : null;
    }
  }
}

export function ParagraphDialog({ open, initial, tab = "indents", onTab, onSubmit, onClose }: {
  open: boolean;
  initial: ParagraphValues;
  tab?: "indents" | "breaks";
  onTab?: (tab: "indents" | "breaks") => void;
  onSubmit: (v: ParagraphValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [f, setF] = useState({ align: "left", left: "", right: "", first: "", before: "", after: "", rule: "single" as LineRule, at: "1" });
  const [flow, setFlow] = useState<FlowValues>(flowValues({}));
  const [outline, setOutline] = useState(9);
  useEffect(() => {
    if (!open) return;
    setFlow(initial.flow ?? flowValues({}));
    setOutline(initial.outlineLevel ?? 9);
  }, [open, initial]);
  useEffect(() => {
    if (!open) return;
    const l = lineRuleOf(initial.spacing.line);
    setF({
      align: initial.alignment ?? "left",
      left: cm(initial.indent.left ?? 0),
      right: cm(initial.indent.right ?? 0),
      first: cm(initial.indent.firstLine ?? (initial.indent.hanging != null ? -initial.indent.hanging : 0)),
      before: pt(initial.spacing.before ?? 0),
      after: pt(initial.spacing.after ?? 0),
      rule: l.rule,
      at: l.value,
    });
  }, [open, initial]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const line = lineSpacingOf(f.rule, f.at);
  const nums = [fromCm(f.left), fromCm(f.right), fromCm(f.first), fromPt(f.before), fromPt(f.after)];
  const valid = line != null && nums.every((n) => n != null);
  return (
    <Dialog open={open} title={t("group.paragraph")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const [left, right, first, before, after] = nums as number[];
          const indent: Indent = first! >= 0 ? { left: left!, right: right!, firstLine: first!, hanging: null } : { left: left!, right: right!, firstLine: null, hanging: -first! };
          onSubmit({ alignment: f.align as Alignment, indent, spacing: { before: Math.max(0, before!), after: Math.max(0, after!), line: line! }, flow, outlineLevel: outline });
        }}
      >
        <div className="flex gap-2 border-b border-ui-border" role="tablist">
          {(["indents", "breaks"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`px-2 py-1 text-xs ${tab === k ? "border-b-2 border-ui-focus font-medium" : ""}`} onClick={() => onTab?.(k)}>
              {t(k === "indents" ? "write.para.tabIndents" : "write.para.tabBreaks")}
            </button>
          ))}
        </div>
        {tab === "breaks" ? (
          <div className="flex flex-col gap-1" data-testid="paragraph-breaks">
            <p className="font-medium">{t("write.para.pagination")}</p>
            {(["widowControl", "keepNext", "keepLines", "pageBreakBefore"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" aria-label={t(`write.para.${k}`)} checked={flow[k]} onChange={(e) => setFlow({ ...flow, [k]: e.target.checked })} />
                {t(`write.para.${k}`)}
              </label>
            ))}
            <p className="mt-1 font-medium">{t("write.para.exceptions")}</p>
            {(["suppressLineNumbers", "suppressAutoHyphens"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" aria-label={t(`write.para.${k}`)} checked={flow[k]} onChange={(e) => setFlow({ ...flow, [k]: e.target.checked })} />
                {t(`write.para.${k}`)}
              </label>
            ))}
          </div>
        ) : (
          <>
        <Row label={t("fmt.alignment")}>
          <select aria-label={t("fmt.alignment")} className={INPUT} value={f.align} onChange={set("align")}>
            <option value="left">{t("write.left")}</option>
            <option value="center">{t("write.centered")}</option>
            <option value="right">{t("write.right")}</option>
            <option value="justify">{t("write.justified")}</option>
          </select>
        </Row>
        <Row label={t("write.outlineLevel")}>
          <select aria-label={t("write.outlineLevel")} className={INPUT} value={outline} onChange={(e) => setOutline(Number(e.target.value))}>
            <option value={9}>{t("write.bodyText")}</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {t("write.outlineLevelN", { n: n + 1 })}
              </option>
            ))}
          </select>
        </Row>
        <p className="font-medium">{t("write.indentation")}</p>
        <Row label={t("write.leftCm")}>
          <input aria-label={t("write.leftCm")} className={INPUT} value={f.left} onChange={set("left")} />
        </Row>
        <Row label={t("write.rightCm")}>
          <input aria-label={t("write.rightCm")} className={INPUT} value={f.right} onChange={set("right")} />
        </Row>
        <Row label={t("write.firstLine")}>
          <input aria-label={t("write.firstLineCm")} className={INPUT} value={f.first} onChange={set("first")} />
        </Row>
        <p className="font-medium">{t("write.spacing")}</p>
        <Row label={t("write.beforePt")}>
          <input aria-label={t("write.beforePt")} className={INPUT} value={f.before} onChange={set("before")} />
        </Row>
        <Row label={t("write.afterPt")}>
          <input aria-label={t("write.afterPt")} className={INPUT} value={f.after} onChange={set("after")} />
        </Row>
        <Row label={t("write.lineSpacing")}>
          <select aria-label={t("write.lineSpacing")} className={INPUT} value={f.rule} onChange={set("rule")}>
            <option value="single">{t("write.single")}</option>
            <option value="1.5">{t("write.lines15")}</option>
            <option value="double">{t("write.double")}</option>
            <option value="multiple">{t("write.multiple")}</option>
            <option value="atLeast">{t("write.atLeast")}</option>
            <option value="exact">{t("write.exactly")}</option>
          </select>
        </Row>
        {(f.rule === "multiple" || f.rule === "atLeast" || f.rule === "exact") && (
          <Row label={f.rule === "multiple" ? t("write.para.atLines") : t("write.para.atPt")}>
            <input aria-label={t("write.para.at")} className={INPUT} value={f.at} onChange={set("at")} />
          </Row>
        )}
          </>
        )}
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

const defined = <T extends object>(o: T | null | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null)) as Partial<T>;

/**
 * The Paragraph dialog's values for the caret's paragraph as Word shows them: in effect (the style chain, then the
 * direct formatting), not only the direct formatting (W-23).
 */
export function paragraphValuesAt(editor: Editor, ctl: SyncController): ParagraphValues {
  return { ...paragraphInEffect(editor, ctl), flow: flowAt(editor, ctl), outlineLevel: outlineLevelAt(editor, ctl) };
}

/** The outline level in effect at the caret's paragraph (direct, else its style's; 9 = Body Text). */
export function outlineLevelAt(editor: Editor, ctl: SyncController): number {
  const node = selectedTextblocks(editor)[0]?.[0];
  if (!node) return 9;
  const direct = (node.attrs.extra as { outlineLevel?: number } | null)?.outlineLevel;
  return direct ?? resolveParagraph(ctl.styles, paragraphStyleId(ctl.styles, node)).outlineLevel ?? 9;
}

/** Sets the outline level of the selected paragraphs as direct formatting (their `extra`; the mapper sends `SetParagraphProps`). */
export function setOutlineLevel(editor: Editor, level: number): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, extra: { ...(node.attrs.extra ?? {}), outlineLevel: Math.max(0, Math.min(9, level)) } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Alignment, indents and spacing in effect at the caret's paragraph (style chain + direct formatting). */
export function paragraphInEffect(editor: Editor, ctl: SyncController): Omit<ParagraphValues, "flow"> {
  const node = selectedTextblocks(editor)[0]?.[0];
  const style = node ? resolveParagraph(ctl.styles, paragraphStyleId(ctl.styles, node)) : {};
  const direct = defined(indentAt(editor));
  const ownFirst = direct.firstLine != null || direct.hanging != null;
  const indent: Indent = { ...defined(style.indent), ...direct };
  if (ownFirst) {
    indent.firstLine = direct.firstLine ?? null;
    indent.hanging = direct.hanging ?? null;
  }
  return {
    alignment: (node?.attrs.align as Alignment | null) ?? style.alignment ?? null,
    indent,
    spacing: { ...defined(style.spacing), ...defined(spacingAt(editor)) },
  };
}

/** The fields of the Paragraph dialog that changed (compared as shown: cm to 0.01, pt to 0.1). */
export function paragraphValuesPatch(before: ParagraphValues, after: ParagraphValues): { alignment?: Alignment; indent?: Partial<Indent>; spacing?: Partial<Spacing> } {
  const out: { alignment?: Alignment; indent?: Partial<Indent>; spacing?: Partial<Spacing> } = {};
  if (after.alignment && after.alignment !== (before.alignment ?? "left")) out.alignment = after.alignment;
  const first = (i: Indent) => i.firstLine ?? (i.hanging != null ? -i.hanging : 0);
  const ind: Partial<Indent> = {};
  if (cm(after.indent.left ?? 0) !== cm(before.indent.left ?? 0)) ind.left = after.indent.left;
  if (cm(after.indent.right ?? 0) !== cm(before.indent.right ?? 0)) ind.right = after.indent.right;
  if (cm(first(after.indent)) !== cm(first(before.indent))) {
    ind.firstLine = after.indent.firstLine ?? null;
    ind.hanging = after.indent.hanging ?? null;
  }
  if (Object.keys(ind).length) out.indent = ind;
  const sp: Partial<Spacing> = {};
  if (pt(after.spacing.before ?? 0) !== pt(before.spacing.before ?? 0)) sp.before = after.spacing.before;
  if (pt(after.spacing.after ?? 0) !== pt(before.spacing.after ?? 0)) sp.after = after.spacing.after;
  const shown = (l: LineSpacing | null | undefined) => {
    const r = lineRuleOf(l);
    return `${r.rule}:${r.value}`;
  };
  if (shown(after.spacing.line) !== shown(before.spacing.line)) sp.line = after.spacing.line;
  if (Object.keys(sp).length) out.spacing = sp;
  return out;
}

/** The flow values of the caret's paragraph: its style chain, then its direct formatting. */
export function flowAt(editor: Editor, ctl: SyncController): FlowValues {
  const node = selectedTextblocks(editor)[0]?.[0];
  if (!node) return flowValues({});
  const style = resolveParagraph(ctl.styles, paragraphStyleId(ctl.styles, node));
  const direct = (node.attrs.extra ?? {}) as Partial<Record<keyof FlowValues, boolean>>;
  const merged: Partial<Record<keyof FlowValues, boolean | null | undefined>> = {};
  for (const k of FLOW_KEYS) merged[k] = direct[k] ?? style[k];
  return flowValues(merged);
}

/** Sets flow options as direct formatting of the selected paragraphs (their `extra`; the mapper sends `SetParagraphProps`). */
export function setFlow(editor: Editor, patch: Partial<FlowValues>): boolean {
  if (!Object.keys(patch).length) return false;
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, extra: { ...(node.attrs.extra ?? {}), ...patch } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

// ----- wiring -----------------------------------------------------------------------

const EMPTY_PARAGRAPH: ParagraphValues = { alignment: null, indent: {}, spacing: {} };

/** The dialog the UI store asks for, applied to the editor / Rust. */
export function WriteDialogs({ ui, ctl, editor }: { ui: WriteUi; ctl: SyncController; editor: Editor | null }) {
  const { dialog, headerFooterFocus, paragraphTab } = useSyncExternalStore(ui.subscribe, ui.getState);
  const page = useSyncExternalStore(ctl.subscribe, () => ctl.page);
  const sections = useSyncExternalStore(ctl.subscribe, () => ctl.sections);
  // The caret's section, captured when a section dialog opens.
  const secIndex = useMemo(() => {
    if (!editor || (dialog !== "headerFooter" && dialog !== "pageNumbers")) return -1;
    const sec = currentSection(editor.state, sections);
    return sec ? sections.indexOf(sec) : -1;
  }, [editor, dialog, sections]);
  const hfInitial = useMemo(() => (dialog === "headerFooter" ? headerFooterTexts(sections, Math.max(0, secIndex), page) : EMPTY_HF), [dialog, sections, secIndex, page]);
  const pnInitial = useMemo(() => {
    const sec = sections[secIndex];
    return { format: sec?.pageNumberFormat ?? ("decimal" as LevelKind), start: sec?.pageNumberStart ?? null };
  }, [sections, secIndex]);
  const close = () => {
    ui.openDialog(null);
    if (editor) focusNow(editor);
  };
  // Captured when the dialog opens (the editor does not change while a modal dialog is up).
  const table = useMemo(
    () => (editor && (dialog === "rowHeight" || dialog === "splitCells" || dialog === "cellMargins") ? tableContext(editor.state) : null),
    [editor, dialog],
  );
  const paras = useMemo(() => (editor && (dialog === "bordersShading" || dialog === "tabs") ? selectedParagraphs(editor.state) : []), [editor, dialog]);
  const bsInitial = useMemo<BordersShadingValues>(
    () => ({ borders: paras[0] ? paragraphBorders(paras[0]) : {}, shading: paras[0] ? paragraphShading(paras[0]) : null }),
    [paras],
  );
  const tabsInitial = useMemo(() => (paras[0] ? tabsOf(ctl.styles, paras[0]) : []), [paras, ctl]);
  const image = useMemo(() => (editor && dialog === "altText" ? selectedImage(editor.state) : null), [editor, dialog]);
  const drawing = useMemo(() => (editor && dialog === "altText" ? selectedDrawing(editor.state) : null), [editor, dialog]);
  // Font… (Ctrl+D): the formatting at the selection of the editor with the caret (a text box's, else the main one).
  const fontTarget = useMemo(() => (editor && dialog === "font" ? formatTarget(editor) : null), [editor, dialog]);
  // The font and size in effect (style chain, theme fonts) like Word's dialog, then the direct formatting (W-25).
  const fontInitial = useMemo(() => {
    if (!fontTarget) return {};
    const direct = runPropsAt(fontTarget);
    const shown = fontBoxValue(fontTarget.state, ctl.styles);
    return { ...direct, font: direct.font ?? shown.font, size: direct.size ?? shown.size };
  }, [fontTarget, ctl]);
  const para = useMemo<ParagraphValues | null>(() => (editor && dialog === "paragraph" ? paragraphValuesAt(editor, ctl) : null), [editor, dialog]);
  return (
    <>
      <RowHeightDialog
        open={dialog === "rowHeight" && !!table}
        initial={table?.rowProps.height}
        onClose={close}
        onSubmit={(h) => {
          if (table) void ctl.run(setRowHeight(table, h));
          close();
        }}
      />
      <AltTextDialog
        open={dialog === "altText" && (!!image || !!drawing)}
        initial={(image?.node.attrs.alt as string | null) ?? drawing?.value.alt ?? ""}
        decorative={image ? !!image.node.attrs.decorative : !!drawing?.value.decorative}
        onClose={close}
        onSubmit={(alt, decorative) => {
          if (editor && image) setImageAttrs(editor.view, image.pos, { alt: alt || null, decorative });
          else if (editor && drawing) {
            const d = { ...drawing.value };
            if (alt) d.alt = alt;
            else delete d.alt;
            if (decorative) d.decorative = true;
            else delete d.decorative;
            setDrawingValue(editor.view, drawing.pos, d, true, drawing.path);
          }
          close();
        }}
      />
      <FontDialog
        open={dialog === "font"}
        initial={fontInitial}
        onClose={close}
        onSubmit={(run) => {
          const target = fontTarget;
          ui.openDialog(null);
          if (!target) return;
          const patch = runPatchBetween(fontInitial, { ...fontInitial, ...run });
          if (Object.keys(patch).length) applyRunPatch(target, patch);
          focusNow(target);
        }}
      />
      <PageSetupDialog
        open={dialog === "pageSetup"}
        page={page}
        onClose={close}
        onSubmit={(patch) => {
          void ctl.run({ type: "setPage", patch });
          close();
        }}
      />
      <HeaderFooterDialog
        open={dialog === "headerFooter"}
        initial={hfInitial}
        focus={headerFooterFocus}
        onClose={close}
        onSubmit={(texts) => {
          const sec = sections[secIndex];
          if (!sec) void ctl.run({ type: "setPage", patch: { headerText: texts.header, footerText: texts.footer } });
          else {
            const cmds = headerFooterCommands(sec.id, hfInitial, texts);
            if (cmds.length) void ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });
          }
          close();
        }}
      />
      <PageNumbersDialog
        open={dialog === "pageNumbers"}
        initial={pnInitial}
        onClose={close}
        onSubmit={(v) => {
          const sec = sections[secIndex];
          if (sec) void ctl.run({ type: "setSection", section: sec.id, patch: { pageNumberFormat: v.format, pageNumberStart: v.start ?? 0 } });
          close();
        }}
      />
      <SplitCellsDialog
        open={dialog === "splitCells" && !!table}
        rowsValid={(r) => (table ? splitRowsValid(table, r) : false)}
        onClose={close}
        onSubmit={(rows, cols) => {
          const cmd = table && splitCellCommand(table, rows, cols);
          if (cmd) void ctl.run(cmd);
          close();
        }}
      />
      <CellMarginsDialog
        open={dialog === "cellMargins" && !!table}
        initial={table?.props.cellMargins}
        onClose={close}
        onSubmit={(m) => {
          if (table) void ctl.run(setCellMargins(table, m));
          close();
        }}
      />
      <Tables2Dialogs ui={ui} ctl={ctl} editor={editor} />
      <WriteOptionsDialog ui={ui} />
      <BordersShadingDialog
        open={dialog === "bordersShading" && paras.length > 0}
        initial={bsInitial}
        onClose={close}
        onSubmit={(v) => {
          const cmd = bordersShadingCommand(paras, v);
          if (cmd) void ctl.run(cmd);
          close();
        }}
      />
      <TabsDialog
        open={dialog === "tabs" && paras.length > 0}
        initial={tabsInitial}
        onClose={close}
        onSubmit={(stops) => {
          const cmd = tabsDialogCommand(paras, tabsInitial, stops);
          if (cmd) void ctl.run(cmd);
          close();
        }}
      />
      <ParagraphDialog
        open={dialog === "paragraph" && !!para}
        initial={para ?? EMPTY_PARAGRAPH}
        tab={paragraphTab}
        onTab={(tab) => ui.set({ paragraphTab: tab })}
        onClose={close}
        onSubmit={(v) => {
          if (editor && para) {
            // Only what the user changed becomes direct formatting (W-23).
            const d = paragraphValuesPatch(para, v);
            if (d.alignment) setAlignment(editor, d.alignment);
            if (d.indent) setIndent(editor, d.indent);
            if (d.spacing) setSpacing(editor, d.spacing);
            if (v.flow && para.flow) setFlow(editor, flowPatch(para.flow, v.flow));
            if (v.outlineLevel != null && v.outlineLevel !== (para.outlineLevel ?? 9)) setOutlineLevel(editor, v.outlineLevel);
          }
          close();
        }}
      />
    </>
  );
}
