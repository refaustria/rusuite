// File › Print in Calc: what to print, pages, orientation, paper,
// margins, scaling, gridlines/headings, repeated rows, header and footer,
// with the live preview.

import { useCallback } from "react";
import {
  ORIENTATION_CHOICES, PAPER_CHOICES, PrintCheck, PrintNumber, PrintPanel, PrintSection, PrintSelect, PrintText, printDocument, usePrintDoc,
  type HeaderFooterSlots, type PageOrientation, type PaperName, type PrintDoc,
} from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { buildCalcPrintDoc } from "./calcPrintDoc";
import { CALC_MARGIN_CHOICES, CALC_SCALE_CHOICES, CALC_WHAT_CHOICES, type CalcMarginPreset, type CalcPrintOptions, type CalcPrintWhat, type CalcScaleMode } from "./layout";

/** Prints with the given settings (File › Export PDF… and the Print button). */
export async function printCalc(store: CalcStore, doc: PrintDoc): Promise<void> {
  try {
    await printDocument(doc, store.api.backend);
  } catch (e) {
    store.pushError(e);
  }
}

function SlotsEditor({ label, value, onChange }: { label: string; value: HeaderFooterSlots; onChange: (v: HeaderFooterSlots) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {(["left", "center", "right"] as const).map((k) => (
        <PrintText key={k} label={`${label} ${k}`} value={value[k]} placeholder={k === "center" && label === "Footer" ? "Page &P of &N" : ""} onChange={(t) => onChange({ ...value, [k]: t })} />
      ))}
    </div>
  );
}

export function CalcPrintPage({ store, options, onChange }: { store: CalcStore; options: CalcPrintOptions; onChange: (o: CalcPrintOptions) => void }) {
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
      before={
        <PrintSection title="Settings">
          <PrintSelect label="What to print" value={options.what} choices={CALC_WHAT_CHOICES} onChange={(v) => set("what", v as CalcPrintWhat)} />
        </PrintSection>
      }
    >
      <PrintSection title="Layout">
        <PrintSelect label="Orientation" value={options.orientation} choices={ORIENTATION_CHOICES} onChange={(v) => set("orientation", v as PageOrientation)} />
        <PrintSelect label="Paper size" value={options.paper} choices={PAPER_CHOICES} onChange={(v) => set("paper", v as PaperName)} />
        <PrintSelect label="Margins" value={options.margins} choices={CALC_MARGIN_CHOICES} onChange={(v) => set("margins", v as CalcMarginPreset)} />
        <PrintSelect label="Scaling" value={options.scale} choices={CALC_SCALE_CHOICES} onChange={(v) => set("scale", v as CalcScaleMode)} />
        {options.scale === "custom" && <PrintNumber label="Scale" value={options.percent} min={10} max={400} suffix="%" onChange={(v) => set("percent", v)} />}
      </PrintSection>
      <PrintSection title="Sheet options">
        <PrintCheck label="Gridlines" checked={options.gridlines} onChange={(v) => set("gridlines", v)} />
        <PrintCheck label="Row and column headings" checked={options.headings} onChange={(v) => set("headings", v)} />
        <PrintNumber label="Rows to repeat at top" value={options.repeatRows} min={0} max={50} onChange={(v) => set("repeatRows", v)} />
      </PrintSection>
      <PrintSection title="Header and footer">
        <p className="text-xs text-ui-muted">&amp;P page, &amp;N pages, &amp;D date, &amp;T time, &amp;A sheet, &amp;F file</p>
        <SlotsEditor label="Header" value={options.header} onChange={(v) => set("header", v)} />
        <SlotsEditor label="Footer" value={options.footer} onChange={(v) => set("footer", v)} />
      </PrintSection>
    </PrintPanel>
  );
}
