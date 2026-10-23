// File › Print in Calc: what to print, pages, orientation, paper,
// margins, scaling, gridlines/headings, repeated rows, header and footer,
// with the live preview.

import { useCallback } from "react";
import {
  ORIENTATION_CHOICES, PAPER_CHOICES, PrintCheck, PrintNumber, PrintPanel, PrintSection, PrintSelect, PrintText, capabilitiesOf, exportPdfDocument, exportPdfOrPrint, pdfFileName, printDocument, usePrintDoc,
  type HeaderFooterSlots, type PageOrientation, type PaperName, type PrintDoc,
} from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { useT } from "../i18n";
import { buildCalcPrintDoc } from "./calcPrintDoc";
import { CALC_COMMENTS_CHOICES, CALC_MARGIN_CHOICES, CALC_SCALE_CHOICES, CALC_WHAT_CHOICES, type CalcCommentsMode, type CalcMarginPreset, type CalcPrintOptions, type CalcPrintWhat, type CalcScaleMode } from "./layout";

/**
 * Prints with the given settings: the Print button (`print`), File › Export PDF… (`pdf`: without a dialog where the
 * backend renders PDFs, else the print dialog) and Share as PDF (`share`, P10-M6).
 */
export async function printCalc(store: CalcStore, doc: PrintDoc, mode: "print" | "pdf" | "share" = "print"): Promise<void> {
  const backend = store.api.backend;
  const name = pdfFileName(store.getState().name ?? "");
  try {
    if (mode === "print") await printDocument(doc, backend);
    else if (mode === "pdf") await exportPdfOrPrint(doc, name, backend);
    else await exportPdfDocument(doc, name, backend, "share");
  } catch (e) {
    store.pushError(e);
  }
}

function SlotsEditor({ label, value, onChange, footer }: { label: string; value: HeaderFooterSlots; onChange: (v: HeaderFooterSlots) => void; footer?: boolean }) {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-1">
      {(["left", "center", "right"] as const).map((k) => (
        <PrintText key={k} label={`${label} ${t(`print.slot.${k}`)}`} value={value[k]} placeholder={k === "center" && footer ? t("calc.print.footerHint") : ""} onChange={(v) => onChange({ ...value, [k]: v })} />
      ))}
    </div>
  );
}

export function CalcPrintPage({ store, options, onChange }: { store: CalcStore; options: CalcPrintOptions; onChange: (o: CalcPrintOptions) => void }) {
  const t = useT();
  const { range, ...layout } = options;
  const key = JSON.stringify(layout);
  // Rebuilt when the layout options change; the range only filters the pages.
  const build = useCallback(() => buildCalcPrintDoc(store, { ...options, range: "" }), [store, key]);
  const { doc, busy, error } = usePrintDoc(build);
  const set = <K extends keyof CalcPrintOptions>(k: K, v: CalcPrintOptions[K]) => onChange({ ...options, [k]: v });
  return (
    <PrintPanel
      doc={doc}
      busy={busy}
      error={error}
      range={range}
      onRange={(r) => set("range", r)}
      onPrint={(d) => printCalc(store, d)}
      onExportPdf={capabilitiesOf(store.api.backend).pdf ? (d) => printCalc(store, d, "pdf") : undefined}
      before={
        <PrintSection title={t("print.settings")}>
          <PrintSelect label={t("print.whatToPrint")} value={options.what} choices={CALC_WHAT_CHOICES} onChange={(v) => set("what", v as CalcPrintWhat)} />
        </PrintSection>
      }
    >
      <PrintSection title={t("print.layoutSection")}>
        <PrintSelect label={t("print.orientation")} value={options.orientation} choices={ORIENTATION_CHOICES} onChange={(v) => set("orientation", v as PageOrientation)} />
        <PrintSelect label={t("print.paperSize")} value={options.paper} choices={PAPER_CHOICES} onChange={(v) => set("paper", v as PaperName)} />
        <PrintSelect label={t("print.margins")} value={options.margins} choices={CALC_MARGIN_CHOICES} onChange={(v) => set("margins", v as CalcMarginPreset)} />
        <PrintSelect label={t("calc.print.scaling")} value={options.scale} choices={CALC_SCALE_CHOICES} onChange={(v) => set("scale", v as CalcScaleMode)} />
        {options.scale === "custom" && <PrintNumber label={t("calc.print.scale")} value={options.percent} min={10} max={400} suffix="%" onChange={(v) => set("percent", v)} />}
      </PrintSection>
      <PrintSection title={t("calc.print.sheetOptions")}>
        <PrintCheck label={t("calc.gridlines")} checked={options.gridlines} onChange={(v) => set("gridlines", v)} />
        <PrintCheck label={t("calc.print.headings")} checked={options.headings} onChange={(v) => set("headings", v)} />
        <PrintNumber label={t("calc.print.repeatRows")} value={options.repeatRows} min={0} max={50} onChange={(v) => set("repeatRows", v)} />
        <PrintSelect label={t("calc.print.comments")} value={options.comments ?? "none"} choices={CALC_COMMENTS_CHOICES} onChange={(v) => set("comments", v as CalcCommentsMode)} />
      </PrintSection>
      <PrintSection title={t("print.headerFooter")}>
        <p className="text-xs text-ui-muted">{t("calc.print.tokens")}</p>
        <SlotsEditor label={t("print.header")} value={options.header} onChange={(v) => set("header", v)} />
        <SlotsEditor footer label={t("print.footer")} value={options.footer} onChange={(v) => set("footer", v)} />
      </PrintSection>
    </PrintPanel>
  );
}
