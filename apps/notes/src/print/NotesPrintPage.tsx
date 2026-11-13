// File › Print in Notes: this page or the whole section, paper, orientation, margins, with the live preview;
// File › Export PDF uses the same settings (without a dialog where the shell renders PDFs, else the print dialog
// with "Save as PDF").

import { useCallback, useState } from "react";
import {
  capabilitiesOf, exportPdfOrPrint, getLocale, MARGIN_CHOICES, ORIENTATION_CHOICES, PAPER_CHOICES, pdfFileName, PrintPanel, PrintSection, PrintSelect, printDocument, usePrintDoc,
  applyPageRange, exportPdfDocument, type MarginPreset, type PageOrientation, type PaperName, type PrintDoc,
} from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { findNode, flatPages, sectionOf } from "../tree";
import { imageBlobs, renderContent } from "../render";
import { makeEditorEnv } from "../ui/editorEnv";
import { useNotes } from "../ui/hooks";
import { t, useT } from "../i18n";
import { buildNotesPrintDoc, DEFAULT_PRINT, type NotesPrintOptions, type PrintPage } from "./notesPrint";

/** The print settings of this session (Print page and Export PDF share them). */
let current: NotesPrintOptions = DEFAULT_PRINT;

function formatDate(ms: number): string {
  const d = new Date(ms);
  const locale = getLocale();
  return `${d.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}  ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

/** The pages to print: the open page, or every page of its section in list order. */
async function printPages(ctl: NotesController, what: NotesPrintOptions["what"]): Promise<PrintPage[]> {
  const s = ctl.getState();
  const tree = ctl.tree();
  const page = findNode(tree, s.page);
  if (!page?.pageDoc) return [];
  const nodes = what === "section" ? flatPages(sectionOf(tree, page.id)).map((f) => f.node) : [page];
  const env = makeEditorEnv(ctl);
  const out: PrintPage[] = [];
  for (const n of nodes) {
    if (!n.pageDoc) continue;
    const json = await ctl.pageContent(n.pageDoc);
    const urls = new Map(await Promise.all(imageBlobs(json).map(async (b) => [b, await ctl.blobUrl(b)] as const)));
    out.push({ title: n.title || t("notes.untitled"), date: formatDate(n.created), content: renderContent(json, { env, urls }) });
  }
  return out;
}

async function build(ctl: NotesController, o: NotesPrintOptions): Promise<PrintDoc> {
  return buildNotesPrintDoc(await printPages(ctl, o.what), o);
}

function docName(ctl: NotesController): string {
  const s = ctl.getState();
  const tree = ctl.tree();
  const page = findNode(tree, s.page);
  const name = current.what === "section" && page ? sectionOf(tree, page.id)?.title : page?.title;
  return pdfFileName(name || t("notes.untitled"));
}

/** File › Export PDF… with the current print settings. */
export async function exportNotesPdf(ctl: NotesController): Promise<void> {
  try {
    const doc = applyPageRange(await build(ctl, current), current.range);
    await exportPdfOrPrint(doc, docName(ctl), ctl.backend);
  } catch (e) {
    ctl.fail(e);
  }
}

export function NotesPrintPage({ ctl }: { ctl: NotesController }) {
  const tr = useT();
  const [o, setO] = useState<NotesPrintOptions>(current);
  const page = useNotes(ctl, (s) => s.page);
  const set = <K extends keyof NotesPrintOptions>(k: K, v: NotesPrintOptions[K]) => {
    current = { ...o, [k]: v };
    setO(current);
  };
  const buildDoc = useCallback(() => build(ctl, o), [ctl, o, page]);
  const { doc, busy, error } = usePrintDoc(buildDoc);
  const run = async (d: PrintDoc, mode: "print" | "pdf") => {
    try {
      if (mode === "print") await printDocument(d, ctl.backend);
      else await exportPdfDocument(d, docName(ctl), ctl.backend);
    } catch (e) {
      ctl.fail(e);
    }
  };
  return (
    <PrintPanel
      doc={doc}
      busy={busy}
      error={error}
      range={o.range}
      onRange={(r) => set("range", r)}
      onPrint={(d) => run(d, "print")}
      onExportPdf={capabilitiesOf(ctl.backend).pdf ? (d) => run(d, "pdf") : undefined}
      disabledReason={page ? undefined : tr("notes.print.noPage")}
      before={
        <PrintSection title={tr("notes.print.what")}>
          <PrintSelect
            label={tr("notes.print.what")}
            value={o.what}
            choices={[
              { value: "page", label: tr("notes.print.thisPage") },
              { value: "section", label: tr("notes.print.section") },
            ]}
            onChange={(v) => set("what", v as NotesPrintOptions["what"])}
          />
        </PrintSection>
      }
    >
      <PrintSection title={tr("print.layoutSection")}>
        <PrintSelect label={tr("print.orientation")} value={o.orientation} choices={ORIENTATION_CHOICES} onChange={(v) => set("orientation", v as PageOrientation)} />
        <PrintSelect label={tr("print.paperSize")} value={o.paper} choices={PAPER_CHOICES} onChange={(v) => set("paper", v as PaperName)} />
        <PrintSelect label={tr("print.margins")} value={o.margins} choices={MARGIN_CHOICES} onChange={(v) => set("margins", v as MarginPreset)} />
      </PrintSection>
    </PrintPanel>
  );
}
