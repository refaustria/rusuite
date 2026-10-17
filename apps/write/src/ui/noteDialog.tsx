// References › Footnote and Endnote… (P9-W2): Word's dialog for the notes'
// location (footnotes at the bottom of the page; endnotes at the end of the
// document or of each section, `w:endnotePr/w:pos`) and their format per
// section (number format, start, restart: `w:numFmt`, `w:numStart`,
// `w:numRestart`), applied to the whole document or the caret's section.
// Insert applies the settings and inserts a note of the chosen kind.

import { useEffect, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { DocumentSettings } from "../generated/DocumentSettings";
import type { LevelKind } from "../generated/LevelKind";
import type { NoteNumbering } from "../generated/NoteNumbering";
import type { NoteRestart } from "../generated/NoteRestart";
import type { Section } from "../generated/Section";
import type { WriteCommand } from "../generated/WriteCommand";
import { formatNumber } from "../features/numbers";
import { noteFormat, sectionNoteNumbering } from "../features/noteNumbering";
import { useT } from "../i18n";
import { BUTTON, INPUT } from "./dialogs";

export type NoteKindChoice = "foot" | "end";

export interface NoteDialogValues {
  kind: NoteKindChoice;
  /** Endnotes at the end of each section (else of the document). */
  endAtSection: boolean;
  format: LevelKind;
  start: number;
  restart: NoteRestart;
  applyTo: "whole" | "section";
}

/** The number formats the dialog offers (Word's list without symbols). */
export const NOTE_FORMATS: LevelKind[] = ["decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"];

/** The dialog's values for `kind` notes of `section`. */
export function noteDialogValues(kind: NoteKindChoice, section: Section | null, settings: DocumentSettings): NoteDialogValues {
  const n = sectionNoteNumbering(section ?? undefined, kind);
  return {
    kind,
    endAtSection: !!settings.endnotesAtSectionEnd,
    format: noteFormat(n, kind),
    start: n.start ?? 1,
    restart: n.restart ?? "continuous",
    applyTo: "whole",
  };
}

/** The numbering the values describe (defaults left out, so a default numbering removes the section's own). */
export function numberingOf(v: Pick<NoteDialogValues, "kind" | "format" | "start" | "restart">): NoteNumbering {
  const out: NoteNumbering = {};
  if (v.format !== (v.kind === "foot" ? "decimal" : "lowerRoman")) out.format = v.format;
  if (v.start > 1) out.start = v.start;
  // Endnotes can not restart per page (Word offers continuous and each section).
  const restart = v.kind === "end" && v.restart === "eachPage" ? "continuous" : v.restart;
  if (restart !== "continuous") out.restart = restart;
  return out;
}

/** The commands of Apply: the endnote position (a document setting) and the numbering of the target sections. */
export function noteDialogCommands(v: NoteDialogValues, sections: Section[], current: Section | null, settings: DocumentSettings): WriteCommand[] {
  const cmds: WriteCommand[] = [];
  if (v.kind === "end" && !!settings.endnotesAtSectionEnd !== v.endAtSection) cmds.push({ type: "setSettings", settings: { ...settings, endnotesAtSectionEnd: v.endAtSection } });
  const numbering = numberingOf(v);
  const targets = v.applyTo === "whole" || !current ? sections : [current];
  for (const s of targets) {
    const old = sectionNoteNumbering(s, v.kind);
    if (JSON.stringify(old) === JSON.stringify(numbering)) continue;
    cmds.push({ type: "setSection", section: s.id, patch: v.kind === "foot" ? { footnoteNumbering: numbering } : { endnoteNumbering: numbering } });
  }
  return cmds;
}

export function NoteDialog({ open, section, settings, onApply, onInsert, onClose, onConvert, onSeparators }: {
  open: boolean;
  /** Word's Convert… (Convert Notes dialog). */
  onConvert?: () => void;
  /** The separators (Word's Draft view Footnotes pane). */
  onSeparators?: () => void;
  /** The caret's section. */
  section: Section | null;
  settings: DocumentSettings;
  onApply: (v: NoteDialogValues) => void;
  onInsert: (v: NoteDialogValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState<NoteDialogValues>(() => noteDialogValues("foot", section, settings));
  const [start, setStart] = useState("1");
  useEffect(() => {
    if (!open) return;
    const init = noteDialogValues("foot", section, settings);
    setV(init);
    setStart(String(init.start));
    // Read once per opening: the values of the caret's section at that moment.
  }, [open]); // eslint-disable-line
  const kind = (k: NoteKindChoice) => {
    const next = { ...noteDialogValues(k, section, settings), applyTo: v.applyTo };
    setV(next);
    setStart(String(next.start));
  };
  const values = (): NoteDialogValues => ({ ...v, start: Math.max(1, Math.floor(Number(start)) || 1) });
  const sample = (f: LevelKind) => `${[1, 2, 3].map((n) => formatNumber(n, f)).join(", ")}, …`;
  return (
    <Dialog open={open} title={t("write.noteDialog.title")} onClose={onClose}>
      <form
        className="flex w-[24rem] max-w-full flex-col gap-2 text-sm"
        data-testid="note-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(values());
        }}
      >
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs text-ui-muted">{t("write.noteDialog.location")}</legend>
          <label className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <input type="radio" name="note-kind" checked={v.kind === "foot"} onChange={() => kind("foot")} />
              {t("write.noteDialog.footnotes")}
            </span>
            <select aria-label={t("write.noteDialog.footnotes")} className={`${INPUT} w-44`} disabled={v.kind !== "foot"} value="page" onChange={() => undefined}>
              <option value="page">{t("write.noteDialog.bottomOfPage")}</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <input type="radio" name="note-kind" checked={v.kind === "end"} onChange={() => kind("end")} />
              {t("write.noteDialog.endnotes")}
            </span>
            <select
              aria-label={t("write.noteDialog.endnotes")}
              data-testid="note-dialog-end-position"
              className={`${INPUT} w-44`}
              disabled={v.kind !== "end"}
              value={v.endAtSection ? "section" : "document"}
              onChange={(e) => setV({ ...v, endAtSection: e.target.value === "section" })}
            >
              <option value="document">{t("write.noteDialog.endOfDocument")}</option>
              <option value="section">{t("write.noteDialog.endOfSection")}</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs text-ui-muted">{t("write.noteDialog.format")}</legend>
          <label className="flex items-center justify-between gap-2">
            <span>{t("write.noteDialog.numberFormat")}</span>
            <select aria-label={t("write.noteDialog.numberFormat")} data-testid="note-dialog-format" className={`${INPUT} w-44`} value={v.format} onChange={(e) => setV({ ...v, format: e.target.value as LevelKind })}>
              {NOTE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {sample(f)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>{t("write.noteDialog.startAt")}</span>
            <input aria-label={t("write.noteDialog.startAt")} className={`${INPUT} w-20`} type="number" min={1} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>{t("write.noteDialog.numbering")}</span>
            <select aria-label={t("write.noteDialog.numbering")} data-testid="note-dialog-restart" className={`${INPUT} w-56`} value={v.restart} onChange={(e) => setV({ ...v, restart: e.target.value as NoteRestart })}>
              <option value="continuous">{t("write.noteDialog.continuous")}</option>
              <option value="eachSection">{t("write.noteDialog.eachSection")}</option>
              {v.kind === "foot" && <option value="eachPage">{t("write.noteDialog.eachPage")}</option>}
            </select>
          </label>
        </fieldset>
        <label className="flex items-center justify-between gap-2">
          <span>{t("write.noteDialog.applyTo")}</span>
          <select aria-label={t("write.noteDialog.applyTo")} className={`${INPUT} w-44`} value={v.applyTo} onChange={(e) => setV({ ...v, applyTo: e.target.value as NoteDialogValues["applyTo"] })}>
            <option value="whole">{t("write.noteDialog.whole")}</option>
            <option value="section">{t("write.noteDialog.section")}</option>
          </select>
        </label>
        <div className="mt-1 flex justify-end gap-2">
          {onConvert && (
            <button type="button" className={`${BUTTON} mr-auto`} data-testid="note-dialog-convert" onClick={onConvert}>
              {t("write.notes.convertButton")}
            </button>
          )}
          {onSeparators && (
            <button type="button" className={BUTTON} data-testid="note-dialog-separators" onClick={onSeparators}>
              {t("write.notes.separators")}
            </button>
          )}
          <button type="submit" className={BUTTON} data-testid="note-dialog-insert">
            {t("write.noteDialog.insert")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className={BUTTON} data-testid="note-dialog-apply" onClick={() => onApply(values())}>
            {t("write.noteDialog.apply")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
