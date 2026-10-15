// File › Print in Write: pages, orientation, paper, margins and scale
// (default: the document's own page setup), with the live preview.

import { useCallback } from "react";
import { PrintNumber, PrintPanel, PrintSection, PrintSelect, printDocument, usePrintDoc, type MarginPreset, type PageOrientation, type PaperName, type PrintDoc } from "@rusuite/ui-shared";
import type { Editor } from "@tiptap/react";
import type { PageSetup } from "../generated/PageSetup";
import type { WriteBackend } from "../backend";
import { buildWritePrintDoc, WRITE_MARGIN_CHOICES, WRITE_ORIENTATION_CHOICES, WRITE_PAPER_CHOICES, type WritePrintOptions } from "./writePrintDoc";

export interface WritePrintPageProps {
  editor: Editor;
  page: PageSetup | null;
  backend: WriteBackend;
  options: WritePrintOptions;
  onChange: (o: WritePrintOptions) => void;
  onError: (e: unknown) => void;
}

/** Prints a built document, reporting failures. */
export async function printWrite(backend: WriteBackend, doc: PrintDoc, onError: (e: unknown) => void): Promise<void> {
  try {
    await printDocument(doc, backend);
  } catch (e) {
    onError(e);
  }
}

export function WritePrintPage({ editor, page, backend, options, onChange, onError }: WritePrintPageProps) {
  const { range, paper, orientation, margins, scale } = options;
  const build = useCallback(
    async () => buildWritePrintDoc(editor.view.dom as HTMLElement, page, { range: "", paper, orientation, margins, scale }),
    [editor, page, paper, orientation, margins, scale],
  );
  const { doc, busy, error } = usePrintDoc(build);
  const set = <K extends keyof WritePrintOptions>(k: K, v: WritePrintOptions[K]) => onChange({ ...options, [k]: v });
  return (
    <PrintPanel doc={doc} busy={busy} error={error} range={range} onRange={(r) => set("range", r)} onPrint={(d) => printWrite(backend, d, onError)}>
      <PrintSection title="Layout">
        <PrintSelect label="Orientation" value={orientation} choices={WRITE_ORIENTATION_CHOICES} onChange={(v) => set("orientation", v as PageOrientation | "document")} />
        <PrintSelect label="Paper size" value={paper} choices={WRITE_PAPER_CHOICES} onChange={(v) => set("paper", v as PaperName | "document")} />
        <PrintSelect label="Margins" value={margins} choices={WRITE_MARGIN_CHOICES} onChange={(v) => set("margins", v as MarginPreset | "document")} />
        <PrintNumber label="Scale" value={scale} min={25} max={200} suffix="%" onChange={(v) => set("scale", v)} />
      </PrintSection>
      <p className="text-xs text-ui-muted">Headers and footers print as set in Insert › Header / Footer; {"{PAGE}"} becomes the page number.</p>
    </PrintPanel>
  );
}
