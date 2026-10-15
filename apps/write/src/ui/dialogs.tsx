// Write's dialogs (Word's units: cm for lengths, pt for spacing): row
// height, picture alt text, page setup (custom margins), header & footer,
// paragraph (indents, spacing, line spacing). `WriteDialogs` shows the one
// the UI store asks for and applies the result.

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog } from "@rusuite/ui-shared";
import type { Alignment } from "../generated/Alignment";
import type { Indent } from "../generated/Indent";
import type { LineSpacing } from "../generated/LineSpacing";
import type { PageSetup } from "../generated/PageSetup";
import type { PageSetupPatch } from "../generated/PageSetupPatch";
import type { RowHeight } from "../generated/RowHeight";
import type { Spacing } from "../generated/Spacing";
import { selectedImage, setImageAttrs } from "../features/images";
import { indentAt, selectedTextblocks, setIndent, setSpacing, spacingAt } from "../features/formatting";
import { setRowHeight, tableContext } from "../features/tables";
import type { WriteUi } from "../features/WriteFeatures";
import { setAlignment } from "../sync/editorCommands";
import type { SyncController } from "../sync/SyncPlugin";
import { useT } from "../i18n";

// ----- units ------------------------------------------------------------------------

export const TWIPS_PER_CM = 1440 / 2.54;
/** Twips → cm text with up to 2 decimals. */
export const cm = (twips: number | null | undefined): string => (twips == null ? "" : String(Math.round((twips / TWIPS_PER_CM) * 100) / 100));
/** cm text → twips (`null` when not a number). */
export function fromCm(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(v) ? null : Math.round(v * TWIPS_PER_CM);
}
export const pt = (twips: number | null | undefined): string => (twips == null ? "" : String(Math.round((twips / 20) * 10) / 10));
export function fromPt(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(v) ? null : Math.round(v * 20);
}

const INPUT = "h-7 w-24 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Buttons({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) {
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

export function AltTextDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: string;
  onSubmit: (alt: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [alt, setAlt] = useState(initial);
  useEffect(() => {
    if (open) setAlt(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} title={t("write.altText")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(alt.trim());
        }}
      >
        <p className="text-xs text-ui-muted">{t("write.altTextQuestion")}</p>
        <textarea aria-label={t("write.altText")} className="h-20 w-full rounded border border-ui-border bg-ui-bg p-2 text-sm text-ui-fg" value={alt} onChange={(e) => setAlt(e.target.value)} />
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

export function HeaderFooterDialog({ open, page, focus, onSubmit, onClose }: {
  open: boolean;
  page: PageSetup | null;
  focus: "header" | "footer";
  onSubmit: (texts: { headerText: string; footerText: string }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  useEffect(() => {
    if (!open) return;
    setHeader(page?.headerText ?? "");
    setFooter(page?.footerText ?? "");
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-slot="${focus}"]`)?.focus(), 0);
  }, [open, page, focus]);
  const area = (slot: "header" | "footer", label: string, value: string, set: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <button type="button" className={`${BUTTON} h-6 px-2 text-xs`} onClick={() => set(`${value}{PAGE}`)}>
          {t("write.insertPageNumber")}
        </button>
      </div>
      <textarea aria-label={label} data-slot={slot} className="h-14 w-full rounded border border-ui-border bg-ui-bg p-2 text-sm text-ui-fg" value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );
  return (
    <Dialog open={open} title={t("print.headerFooter")} onClose={onClose}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ headerText: header.replace(/\r/g, ""), footerText: footer.replace(/\r/g, "") });
        }}
      >
        {area("header", t("print.header"), header, setHeader)}
        {area("footer", t("print.footer"), footer, setFooter)}
        <p className="text-xs text-ui-muted">{t("write.hf.note", { page: "{PAGE}" })}</p>
        <Buttons onClose={onClose} />
      </form>
    </Dialog>
  );
}

// ----- paragraph --------------------------------------------------------------------

export interface ParagraphValues {
  alignment: Alignment | null;
  indent: Indent;
  spacing: Spacing;
}

type LineRule = "single" | "1.5" | "double" | "multiple" | "atLeast" | "exact";

export function lineRuleOf(line: LineSpacing | null | undefined): { rule: LineRule; value: string } {
  if (!line) return { rule: "single", value: "1" };
  if (line.kind === "multiple") {
    if (line.value === 1) return { rule: "single", value: "1" };
    if (line.value === 1.5) return { rule: "1.5", value: "1.5" };
    if (line.value === 2) return { rule: "double", value: "2" };
    return { rule: "multiple", value: String(line.value) };
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

export function ParagraphDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: ParagraphValues;
  onSubmit: (v: ParagraphValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [f, setF] = useState({ align: "left", left: "", right: "", first: "", before: "", after: "", rule: "single" as LineRule, at: "1" });
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
          onSubmit({ alignment: f.align as Alignment, indent, spacing: { before: Math.max(0, before!), after: Math.max(0, after!), line: line! } });
        }}
      >
        <Row label={t("fmt.alignment")}>
          <select aria-label={t("fmt.alignment")} className={INPUT} value={f.align} onChange={set("align")}>
            <option value="left">{t("write.left")}</option>
            <option value="center">{t("write.centered")}</option>
            <option value="right">{t("write.right")}</option>
            <option value="justify">{t("write.justified")}</option>
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
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

// ----- wiring -----------------------------------------------------------------------

const EMPTY_PARAGRAPH: ParagraphValues = { alignment: null, indent: {}, spacing: {} };

/** The dialog the UI store asks for, applied to the editor / Rust. */
export function WriteDialogs({ ui, ctl, editor }: { ui: WriteUi; ctl: SyncController; editor: Editor | null }) {
  const { dialog, headerFooterFocus } = useSyncExternalStore(ui.subscribe, ui.getState);
  const page = useSyncExternalStore(ctl.subscribe, () => ctl.page);
  const close = () => {
    ui.openDialog(null);
    editor?.commands.focus();
  };
  // Captured when the dialog opens (the editor does not change while a modal dialog is up).
  const table = useMemo(() => (editor && dialog === "rowHeight" ? tableContext(editor.state) : null), [editor, dialog]);
  const image = useMemo(() => (editor && dialog === "altText" ? selectedImage(editor.state) : null), [editor, dialog]);
  const para = useMemo<ParagraphValues | null>(
    () =>
      editor && dialog === "paragraph"
        ? {
            alignment: (selectedTextblocks(editor)[0]?.[0].attrs.align as Alignment | null) ?? null,
            indent: indentAt(editor),
            spacing: spacingAt(editor),
          }
        : null,
    [editor, dialog],
  );
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
        open={dialog === "altText" && !!image}
        initial={(image?.node.attrs.alt as string | null) ?? ""}
        onClose={close}
        onSubmit={(alt) => {
          if (editor && image) setImageAttrs(editor.view, image.pos, { alt: alt || null });
          close();
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
        page={page}
        focus={headerFooterFocus}
        onClose={close}
        onSubmit={(texts) => {
          void ctl.run({ type: "setPage", patch: texts });
          close();
        }}
      />
      <ParagraphDialog
        open={dialog === "paragraph" && !!para}
        initial={para ?? EMPTY_PARAGRAPH}
        onClose={close}
        onSubmit={(v) => {
          if (editor) {
            if (v.alignment) setAlignment(editor, v.alignment);
            setIndent(editor, v.indent);
            setSpacing(editor, v.spacing);
          }
          close();
        }}
      />
    </>
  );
}
