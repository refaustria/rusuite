// File › Print in Write: pages, orientation, paper, margins and scale
// (default: the document's own page setup), with the live preview.

import { useCallback } from "react";
import { PrintCheck, PrintNumber, PrintPanel, PrintSection, PrintSelect, printDocument, usePrintDoc, type MarginPreset, type PageOrientation, type PaperName, type PrintDoc } from "@rusuite/ui-shared";
import type { Editor } from "@tiptap/react";
import type { PageSetup } from "../generated/PageSetup";
import type { Comment } from "../generated/Comment";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { PageLayout } from "../features/pagination";
import type { FlowProps } from "../features/layout/measure";
import type { WriteBackend } from "../backend";
import { buildWritePrintDoc, WRITE_MARGIN_CHOICES, WRITE_ORIENTATION_CHOICES, WRITE_PAPER_CHOICES, type WritePrintOptions } from "./writePrintDoc";
import { useT } from "../i18n";

export interface WritePrintPageProps {
  editor: Editor;
  page: PageSetup | null;
  backend: WriteBackend;
  options: WritePrintOptions;
  onChange: (o: WritePrintOptions) => void;
  onError: (e: unknown) => void;
  /** The document's comments (Print markup). */
  comments?: Comment[];
  /** The print layout's pages (printed as they are with the document's page setup). */
  layout?: PageLayout | null;
  /** Flow options of a paragraph (other paper / margins / scale paginate again). */
  flow?: (node: PMNode) => FlowProps;
}

/** Prints a built document, reporting failures. */
export async function printWrite(backend: WriteBackend, doc: PrintDoc, onError: (e: unknown) => void): Promise<void> {
  try {
    await printDocument(doc, backend);
  } catch (e) {
    onError(e);
  }
}

export function WritePrintPage({ editor, page, backend, options, onChange, onError, comments = [], layout = null, flow }: WritePrintPageProps) {
  const t = useT();
  const { range, paper, orientation, margins, scale } = options;
  const markup = !!options.markup;
  const build = useCallback(
    async () => buildWritePrintDoc(editor.view.dom as HTMLElement, page, { range: "", paper, orientation, margins, scale, markup }, comments, layout, flow),
    [editor, page, paper, orientation, margins, scale, markup, comments, layout, flow],
  );
  const { doc, busy, error } = usePrintDoc(build);
  const set = <K extends keyof WritePrintOptions>(k: K, v: WritePrintOptions[K]) => onChange({ ...options, [k]: v });
  return (
    <PrintPanel doc={doc} busy={busy} error={error} range={range} onRange={(r) => set("range", r)} onPrint={(d) => printWrite(backend, d, onError)}>
      <PrintSection title={t("print.layoutSection")}>
        <PrintSelect label={t("print.orientation")} value={orientation} choices={WRITE_ORIENTATION_CHOICES} onChange={(v) => set("orientation", v as PageOrientation | "document")} />
        <PrintSelect label={t("print.paperSize")} value={paper} choices={WRITE_PAPER_CHOICES} onChange={(v) => set("paper", v as PaperName | "document")} />
        <PrintSelect label={t("print.margins")} value={margins} choices={WRITE_MARGIN_CHOICES} onChange={(v) => set("margins", v as MarginPreset | "document")} />
        <PrintNumber label={t("print.scale")} value={scale} min={25} max={200} suffix="%" onChange={(v) => set("scale", v)} />
        <PrintCheck label={t("write.print.markup")} checked={markup} disabled={comments.length === 0} onChange={(v) => set("markup", v)} />
      </PrintSection>
      <p className="text-xs text-ui-muted">{t("write.print.hfNote", { page: "{PAGE}" })}</p>
    </PrintPanel>
  );
}
