// File › Import… / Export… of Notes (P11-N6b): the format choices, the progress card while the converters work and
// the import result (counts and the converters' warnings per file). The converters are a second wasm module that
// loads on first use (src/convert/loader.ts).

import { useState } from "react";
import { Dialog, FOCUS_RING, getLocale, i18n, readerWarningText, type Locale, type ReaderWarningLike } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { IMPORT_ACCEPT } from "../convert/formats";
import type { ExportFormat } from "../generated/ExportFormat";
import type { ImportKind } from "../generated/ImportKind";
import { pickFiles } from "../insert";
import { exportNotesPdf } from "../print/NotesPrintPage";
import { findNode, sectionOf } from "../tree";
import { useT } from "../i18n";
import { useNotes } from "./hooks";

const BUTTON = `rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover disabled:opacity-50 ${FOCUS_RING}`;
const PRIMARY = `rounded bg-[var(--notes-accent)] px-3 py-1 text-sm text-white hover:brightness-110 disabled:opacity-50 ${FOCUS_RING}`;
const ROW = `flex w-full items-start gap-3 rounded border border-ui-border px-3 py-2 text-left text-sm hover:bg-ui-hover disabled:opacity-50 ${FOCUS_RING}`;

/** Reads picked or dropped files and imports them. */
export async function importFileList(ctl: NotesController, files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  const read = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  await ctl.importFiles(read);
}

const KINDS: { kind: ImportKind; label: string; hint: string }[] = [
  { kind: "oneNote", label: "notes.import.oneNote", hint: "notes.import.oneNoteHint" },
  { kind: "markdown", label: "notes.import.markdown", hint: "notes.import.pagesHint" },
  { kind: "html", label: "notes.import.html", hint: "notes.import.pagesHint" },
  { kind: "docx", label: "notes.import.docx", hint: "notes.import.pagesHint" },
];

export function ImportDialog({ ctl, onClose }: { ctl: NotesController; onClose: () => void }) {
  const t = useT();
  const notebook = useNotes(ctl, (s) => s.notebook);
  const pick = async (kind: ImportKind) => {
    onClose();
    await importFileList(ctl, await pickFiles(IMPORT_ACCEPT[kind], true));
  };
  return (
    <Dialog open title={t("notes.import.title")} onClose={onClose}>
      <div className="flex w-[26rem] max-w-full flex-col gap-2 text-sm" data-testid="import-dialog">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={ROW}
            data-testid={`import-${k.kind}`}
            disabled={k.kind !== "oneNote" && !notebook}
            onClick={() => void pick(k.kind)}
          >
            <span className="flex flex-col">
              <span className="font-medium">{t(k.label)}</span>
              <span className="text-xs text-ui-muted">{t(k.hint)}</span>
            </span>
          </button>
        ))}
        <p className="text-xs text-ui-muted">{t("notes.import.dropHint")}</p>
        <div className="flex justify-end">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("notes.cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

type Scope = "page" | "section";
type Format = ExportFormat | "pdf";

/** File › Export…, the page and section context menus (`node`: the page or section the menu was opened on). */
export function ExportDialog({ ctl, scope: initial, node, onClose }: { ctl: NotesController; scope: Scope; node?: string; onClose: () => void }) {
  const t = useT();
  const tree = useNotes(ctl, (s) => s.notebooks.find((n) => n.summary.id === s.notebook)?.tree ?? []);
  const openPage = useNotes(ctl, (s) => s.page);
  const current = useNotes(ctl, (s) => s.section);
  const target = node ? findNode(tree, node) : null;
  const page = target?.kind === "page" ? target.id : target ? null : openPage;
  const section = target?.kind === "section" ? target.id : (page && sectionOf(tree, page)?.id) || (target ? null : current);
  const [scope, setScope] = useState<Scope>(initial === "page" && !page ? "section" : initial);
  const [format, setFormat] = useState<Format>("md");
  const sectionTitle = section ? findNode(tree, section)?.title : undefined;
  const pageTitle = page ? findNode(tree, page)?.title : undefined;
  const run = async () => {
    onClose();
    if (format === "pdf") {
      // The print path prints the open page or its section.
      if (scope === "page" && page && page !== openPage) await ctl.selectPage(page);
      if (scope === "section" && section && section !== current) await ctl.selectSection(section);
      await exportNotesPdf(ctl, scope);
      return;
    }
    await ctl.exportTo(format, scope === "section" ? { section: section! } : { page: page! });
  };
  const formats: { value: Format; label: string }[] = [
    { value: "md", label: t(scope === "section" ? "notes.export.mdZip" : "notes.export.md") },
    { value: "html", label: t("notes.export.html") },
    { value: "docx", label: t("notes.export.docx") },
    { value: "pdf", label: t("notes.export.pdf") },
  ];
  const ready = scope === "page" ? !!page : !!section;
  return (
    <Dialog open title={t("notes.export.title")} onClose={onClose}>
      <div className="flex w-[24rem] max-w-full flex-col gap-3 text-sm" data-testid="export-dialog">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{t("notes.export.what")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="export-scope" checked={scope === "page"} disabled={!page} onChange={() => setScope("page")} data-testid="export-scope-page" />
            <span className="truncate">{t("notes.export.thisPage", { title: pageTitle || t("notes.untitled") })}</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="export-scope" checked={scope === "section"} disabled={!section} onChange={() => setScope("section")} data-testid="export-scope-section" />
            <span className="truncate">{t("notes.export.thisSection", { title: sectionTitle || t("notes.untitled") })}</span>
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{t("notes.export.format")}</legend>
          {formats.map((f) => (
            <label key={f.value} className="flex items-center gap-2">
              <input type="radio" name="export-format" checked={format === f.value} onChange={() => setFormat(f.value)} data-testid={`export-format-${f.value}`} />
              {f.label}
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("notes.cancel")}
          </button>
          <button type="button" className={PRIMARY} disabled={!ready} data-testid="export-run" onClick={() => void run()}>
            {t("notes.export.run")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * A converter warning in the UI language: `notes.convertWarning.<code>` of this catalog with the warning's params
 * (the `notes.*`, `onenote.*` and `docx.*` codes of `notes-convert`), else the shared `reader.<code>` message of
 * the Word reader's own codes, else the English `text`; repeats get ` (N×)` (`notes.convertWarning.count`).
 */
export function convertWarningText(w: ReaderWarningLike, locale: Locale = getLocale()): string {
  const key = w.code ? `notes.convertWarning.${w.code}` : null;
  const count = w.count ?? 1;
  if (key && i18n.has(locale, key)) {
    const text = i18n.translate(locale, key, w.params);
    return count > 1 ? i18n.translate(locale, "notes.convertWarning.count", { text, count }) : text;
  }
  return readerWarningText(w, locale);
}

/** The result of an import: counts, warnings per file, "Open". */
export function ImportResultDialog({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const r = useNotes(ctl, (s) => s.importResult);
  if (!r) return null;
  const close = () => ctl.dismissImportResult();
  const failed = r.files.filter((f) => f.error);
  const counts = [
    r.notebooks ? t("notes.import.count.notebooks", { count: r.notebooks }) : null,
    r.sections ? t("notes.import.count.sections", { count: r.sections }) : null,
    t("notes.import.count.pages", { count: r.pages }),
    r.images ? t("notes.import.count.images", { count: r.images }) : null,
    r.attachments ? t("notes.import.count.files", { count: r.attachments }) : null,
  ].filter(Boolean);
  const openLabel = r.open?.kind === "notebook" ? "notes.import.openNotebook" : r.open?.kind === "section" ? "notes.import.openSection" : "notes.import.openPage";
  const withWarnings = r.files.filter((f) => f.warnings.length > 0 || f.error);
  return (
    <Dialog open title={t(failed.length === r.files.length ? "notes.import.failedTitle" : "notes.import.doneTitle")} onClose={close}>
      <div className="flex w-[28rem] max-w-full flex-col gap-3 text-sm" data-testid="import-result">
        {failed.length < r.files.length && <p data-testid="import-counts">{counts.join(" · ")}</p>}
        {withWarnings.length > 0 && (
          <div className="max-h-64 overflow-auto rounded border border-ui-border p-2" data-testid="import-warnings">
            {withWarnings.map((f) => (
              <details key={f.name} open={withWarnings.length === 1 || !!f.error} className="py-1">
                <summary className="cursor-pointer font-medium">
                  {f.name}
                  {!f.error && <span className="ml-2 text-xs font-normal text-ui-muted">{t("notes.import.warnings", { count: f.warnings.reduce((n, w) => n + w.count, 0) })}</span>}
                </summary>
                <ul className="ml-4 list-disc text-xs">
                  {f.error && (
                    <li className="text-red-700 dark:text-red-400" data-testid="import-error">
                      {f.error}
                    </li>
                  )}
                  {f.warnings.map((w, i) => (
                    <li key={i}>{convertWarningText(w)}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close} data-testid="import-close">
            {t("notes.close")}
          </button>
          {r.open && (
            <button type="button" className={PRIMARY} data-testid="import-open" onClick={() => void ctl.openImported()}>
              {t(openLabel)}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** The progress card of a long command (loading the converters, importing, exporting). */
export function BusyCard({ ctl }: { ctl: NotesController }) {
  const busy = useNotes(ctl, (s) => s.busy);
  if (!busy) return null;
  const pct = busy.total > 0 ? Math.round((busy.done / busy.total) * 100) : null;
  return (
    <div role="status" aria-live="polite" data-testid="notes-busy" className="fixed bottom-10 left-1/2 z-50 flex w-80 max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-2 rounded-lg border border-ui-border bg-ui-panel px-4 py-3 text-sm shadow-lg">
      <span className="truncate">{busy.label}</span>
      <div className="h-1.5 overflow-hidden rounded bg-ui-hover" aria-hidden="true">
        {pct === null ? (
          <div className="h-full w-1/3 animate-pulse rounded bg-[var(--notes-accent)]" />
        ) : (
          <div className="h-full rounded bg-[var(--notes-accent)] transition-[width]" style={{ width: `${Math.max(pct, 4)}%` }} />
        )}
      </div>
    </div>
  );
}
