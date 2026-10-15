// File › Print in Show: layout (full page / notes pages / handouts),
// pages, orientation, paper, frame, scaling and hidden slides, with the
// live preview.

import { useCallback } from "react";
import { PrintCheck, PrintNumber, PrintPanel, PrintSection, PrintSelect, printDocument, usePrintDoc, type PageOrientation, type PaperName, type PrintDoc } from "@rusuite/ui-shared";
import { useShow, type ShowStore } from "../state/store";
import type { ShowBackend } from "../backend";
import { renderSlideImages } from "./slideImages";
import {
  SHOW_LAYOUT_CHOICES, SHOW_ORIENTATION_CHOICES, SHOW_PAPER_CHOICES, buildShowPrintDoc, printedSlides, type ShowPrintLayout, type ShowPrintOptions,
} from "./showPrintDoc";
import { useT } from "../i18n";

/** Builds the print document of the store's presentation. */
export async function buildShowDoc(store: ShowStore, o: ShowPrintOptions): Promise<PrintDoc> {
  const pres = store.getState().pres;
  if (!pres) return { widthIn: 8.27, heightIn: 11.69, css: "", pages: [] };
  const slides = printedSlides(pres.slides, o.hidden);
  const images = await renderSlideImages(pres, slides.map((s) => s.slide), store.media);
  return buildShowPrintDoc(slides, images, pres.slideSize, o);
}

/** Prints a built document, reporting failures. */
export async function printShow(store: ShowStore, backend: ShowBackend, doc: PrintDoc): Promise<void> {
  try {
    await printDocument(doc, backend);
  } catch (e) {
    store.pushError(e);
  }
}

export function ShowPrintPage({ store, backend, options, onChange }: { store: ShowStore; backend: ShowBackend; options: ShowPrintOptions; onChange: (o: ShowPrintOptions) => void }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const { range, layout, paper, orientation, frame, fit, scale, hidden } = options;
  const build = useCallback(
    () => buildShowDoc(store, { range: "", layout, paper, orientation, frame, fit, scale, hidden }),
    // `pres` changes with every edit: the preview follows the presentation.
    [store, pres, layout, paper, orientation, frame, fit, scale, hidden],
  );
  const { doc, busy, error } = usePrintDoc(build);
  const set = <K extends keyof ShowPrintOptions>(k: K, v: ShowPrintOptions[K]) => onChange({ ...options, [k]: v });
  return (
    <PrintPanel
      doc={doc}
      busy={busy}
      error={error}
      range={range}
      onRange={(r) => set("range", r)}
      onPrint={(d) => printShow(store, backend, d)}
      disabledReason={pres && pres.slides.length === 0 ? t("show.print.noSlides") : undefined}
      before={
        <PrintSection title={t("print.settings")}>
          <PrintSelect label={t("show.print.layout")} value={layout} choices={SHOW_LAYOUT_CHOICES} onChange={(v) => set("layout", v as ShowPrintLayout)} />
          <PrintCheck label={t("show.print.hidden")} checked={hidden} onChange={(v) => set("hidden", v)} />
        </PrintSection>
      }
    >
      <PrintSection title={t("print.layoutSection")}>
        <PrintSelect label={t("print.orientation")} value={orientation} choices={SHOW_ORIENTATION_CHOICES} onChange={(v) => set("orientation", v as PageOrientation | "auto")} />
        <PrintSelect label={t("print.paperSize")} value={paper} choices={SHOW_PAPER_CHOICES} onChange={(v) => set("paper", v as PaperName | "slide")} />
        <PrintCheck label={t("show.print.frame")} checked={frame} onChange={(v) => set("frame", v)} />
        <PrintCheck label={t("show.print.fit")} checked={fit} onChange={(v) => set("fit", v)} />
        {!fit && <PrintNumber label={t("print.scale")} value={scale} min={10} max={200} suffix="%" onChange={(v) => set("scale", v)} />}
      </PrintSection>
    </PrintPanel>
  );
}
