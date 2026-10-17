// P9-W6 dialogs: Insert › Quick Parts › Field (Word's Field dialog: field
// names, their switches and formats, the field code), Convert Notes
// (References › Footnotes dialog › Convert…) and the note separators
// (Word's Draft view Footnotes pane: separator, continuation separator).

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog, getLocale } from "@rusuite/ui-shared";
import type { FieldKind } from "../generated/FieldKind";
import type { LevelKind } from "../generated/LevelKind";
import type { NoteKind } from "../generated/NoteKind";
import type { NoteSeparator } from "../generated/NoteSeparator";
import type { NoteSeparators } from "../generated/NoteSeparators";
import type { WriteCommand } from "../generated/WriteCommand";
import type { WriteFeatures } from "../features/WriteFeatures";
import { fieldCode } from "../features/fieldsW6";
import { bookmarkList } from "../features/links";
import { paragraphPages } from "../features/references";
import { fieldValue } from "../features/structure";
import { charOffsetOf, type SyncController } from "../sync/SyncPlugin";
import { notesNode } from "../sync/fromPM";
import { useT } from "../i18n";
import { BUTTON, INPUT } from "./dialogs";
import { dateFormats } from "./referenceDialogs";

const LIST = "max-h-64 min-h-40 overflow-auto rounded border border-ui-border bg-ui-bg text-sm";
const ITEM = "block w-full truncate px-2 py-0.5 text-left font-mono text-xs hover:bg-ui-hover";

/** The field names of the dialog (Word's, alphabetical). */
export const FIELD_NAMES = [
  "AUTHOR", "COMMENTS", "DATE", "DOCPROPERTY", "FILENAME", "KEYWORDS", "LASTSAVEDBY", "NOTEREF", "NUMPAGES", "PAGE",
  "PAGEREF", "REF", "SAVEDATE", "SECTIONPAGES", "SEQ", "STYLEREF", "SUBJECT", "TIME", "TITLE",
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** The options the dialog edits (only those of the chosen field apply). */
export interface FieldChoice {
  name: FieldName;
  /** DATE / TIME / SAVEDATE picture (`\@`); empty = the default. */
  picture: string;
  bookmark: string;
  hyperlink: boolean;
  /** REF: `\n`, `\r`, `\w`, `\p`; NOTEREF: `\f` (as `number`). */
  number: boolean;
  relative: boolean;
  full: boolean;
  position: boolean;
  /** SEQ. */
  identifier: string;
  format: LevelKind | "";
  current: boolean;
  hidden: boolean;
  reset: string;
  headingReset: string;
  /** STYLEREF. */
  style: string;
  last: boolean;
  /** DOCPROPERTY. */
  property: string;
}

export const DEFAULT_CHOICE: FieldChoice = {
  name: "PAGE", picture: "", bookmark: "", hyperlink: true, number: false, relative: false, full: false, position: false,
  identifier: "Figure", format: "", current: false, hidden: false, reset: "", headingReset: "", style: "Heading 1", last: false, property: "Company",
};

const int = (s: string): number | undefined => {
  const n = Math.floor(Number(s));
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The field kind of a dialog choice (null while a required argument is missing). */
export function fieldFromChoice(c: FieldChoice): FieldKind | null {
  const pic = c.picture.trim() ? { format: c.picture.trim() } : {};
  switch (c.name) {
    case "PAGE": return { kind: "page" };
    case "NUMPAGES": return { kind: "numPages" };
    case "SECTIONPAGES": return { kind: "sectionPages" };
    case "DATE": return { kind: "date", value: pic };
    case "TIME": return { kind: "time", value: pic };
    case "SAVEDATE": return { kind: "saveDate", value: pic };
    case "FILENAME": return { kind: "fileName" };
    case "AUTHOR": return { kind: "author" };
    case "TITLE": return { kind: "title" };
    case "SUBJECT": return { kind: "subject" };
    case "KEYWORDS": return { kind: "keywords" };
    case "COMMENTS": return { kind: "comments" };
    case "LASTSAVEDBY": return { kind: "lastSavedBy" };
    case "DOCPROPERTY": return c.property.trim() ? { kind: "docProperty", value: { name: c.property.trim() } } : null;
    case "REF": {
      if (!c.bookmark) return null;
      const v: Extract<FieldKind, { kind: "ref" }>["value"] = { bookmark: c.bookmark };
      if (c.hyperlink) v.hyperlink = true;
      if (c.number) v.number = true;
      if (c.relative) v.relative = true;
      if (c.full) v.full = true;
      if (c.position) v.position = true;
      return { kind: "ref", value: v };
    }
    case "PAGEREF": return c.bookmark ? { kind: "pageRef", value: c.hyperlink ? { bookmark: c.bookmark, hyperlink: true } : { bookmark: c.bookmark } } : null;
    case "NOTEREF": {
      if (!c.bookmark) return null;
      const v: Extract<FieldKind, { kind: "noteRef" }>["value"] = { bookmark: c.bookmark };
      if (c.hyperlink) v.hyperlink = true;
      if (c.number) v.formatted = true;
      return { kind: "noteRef", value: v };
    }
    case "SEQ": {
      const id = c.identifier.trim().replace(/\s+/g, "_");
      if (!id) return null;
      const v: Extract<FieldKind, { kind: "seq" }>["value"] = { identifier: id };
      if (c.format) v.format = c.format;
      if (c.current) v.current = true;
      if (c.hidden) v.hidden = true;
      const r = int(c.reset);
      if (r !== undefined) v.reset = r;
      const s = int(c.headingReset);
      if (s !== undefined && s >= 1 && s <= 9) v.headingReset = s;
      return { kind: "seq", value: v };
    }
    case "STYLEREF": {
      if (!c.style.trim()) return null;
      const v: Extract<FieldKind, { kind: "styleRef" }>["value"] = { style: c.style.trim() };
      if (c.last) v.last = true;
      if (c.number) v.number = true;
      return { kind: "styleRef", value: v };
    }
  }
}

const TIME_FORMATS = ["HH:mm", "HH:mm:ss", "h:mm AM/PM", "h:mm:ss AM/PM"];
const SEQ_FORMATS: (LevelKind | "")[] = ["", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"];
const PROPERTIES = ["Company", "Category", "Title", "Subject", "Author", "Keywords", "Comments", "LastSavedBy"];

/** Insert › Quick Parts › Field: choose a field and its options; the field code is shown below. */
export function FieldDialog({ open, bookmarks, styles, onSubmit, onClose }: {
  open: boolean;
  bookmarks: string[];
  /** Paragraph style names (STYLEREF). */
  styles: string[];
  onSubmit: (kind: FieldKind) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [c, setC] = useState<FieldChoice>(DEFAULT_CHOICE);
  useEffect(() => {
    if (open) setC({ ...DEFAULT_CHOICE, bookmark: bookmarks[0] ?? "" });
  }, [open]); // eslint-disable-line
  const set = (patch: Partial<FieldChoice>) => setC((prev) => ({ ...prev, ...patch }));
  const kind = fieldFromChoice(c);
  const check = (key: keyof FieldChoice, label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={!!c[key]} data-testid={`field-sw-${key}`} onChange={(e) => set({ [key]: e.target.checked } as Partial<FieldChoice>)} />
      {label}
    </label>
  );
  const pictures = c.name === "TIME" ? TIME_FORMATS : dateFormats(getLocale());
  return (
    <Dialog open={open} title={t("write.fieldDialog.title")} onClose={onClose}>
      <form
        className="flex w-[34rem] max-w-full flex-col gap-2 text-sm"
        data-testid="field-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (kind) onSubmit(kind);
        }}
      >
        <div className="flex gap-3">
          <div className="flex w-40 flex-col gap-1">
            <span>{t("write.fieldDialog.names")}</span>
            <div className={LIST} role="listbox" aria-label={t("write.fieldDialog.names")}>
              {FIELD_NAMES.map((n) => (
                <button key={n} type="button" role="option" aria-selected={n === c.name} data-testid={`field-name-${n}`} className={`${ITEM} ${n === c.name ? "bg-ui-hover font-semibold" : ""}`} onClick={() => set({ name: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <fieldset className="flex min-w-0 flex-1 flex-col gap-1.5 rounded border border-ui-border p-2" aria-label={t("write.fieldDialog.options")}>
            <legend className="px-1 text-xs text-ui-muted">{t("write.fieldDialog.options")}</legend>
            {(c.name === "DATE" || c.name === "TIME" || c.name === "SAVEDATE") && (
              <>
                <label className="flex flex-col gap-0.5">
                  {t("write.fieldDialog.picture")}
                  <input className={`${INPUT} w-full`} value={c.picture} data-testid="field-picture" onChange={(e) => set({ picture: e.target.value })} />
                </label>
                <select className={`${INPUT} w-full`} aria-label={t("write.fieldDialog.pictures")} value="" onChange={(e) => e.target.value && set({ picture: e.target.value })}>
                  <option value="">{t("write.fieldDialog.pictures")}</option>
                  {pictures.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </>
            )}
            {(c.name === "REF" || c.name === "PAGEREF" || c.name === "NOTEREF") && (
              <>
                <label className="flex flex-col gap-0.5">
                  {t("write.fieldDialog.bookmark")}
                  <select className={`${INPUT} w-full`} value={c.bookmark} data-testid="field-bookmark" onChange={(e) => set({ bookmark: e.target.value })}>
                    {bookmarks.length === 0 && <option value="">{t("write.fieldDialog.noBookmarks")}</option>}
                    {bookmarks.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </label>
                {check("hyperlink", t("write.fieldDialog.swHyperlink"))}
                {c.name === "REF" && (
                  <>
                    {check("number", t("write.fieldDialog.swNumber"))}
                    {check("relative", t("write.fieldDialog.swRelative"))}
                    {check("full", t("write.fieldDialog.swFull"))}
                    {check("position", t("write.fieldDialog.swPosition"))}
                  </>
                )}
                {c.name === "NOTEREF" && check("number", t("write.fieldDialog.swFormatted"))}
              </>
            )}
            {c.name === "SEQ" && (
              <>
                <label className="flex flex-col gap-0.5">
                  {t("write.fieldDialog.identifier")}
                  <input className={`${INPUT} w-full`} value={c.identifier} data-testid="field-identifier" onChange={(e) => set({ identifier: e.target.value })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  {t("write.fieldDialog.format")}
                  <select className={`${INPUT} w-full`} value={c.format} onChange={(e) => set({ format: e.target.value as LevelKind | "" })}>
                    {SEQ_FORMATS.map((f) => (
                      <option key={f || "arabic"} value={f}>{t(`write.fieldDialog.seqFormat.${f || "arabic"}`)}</option>
                    ))}
                  </select>
                </label>
                {check("current", t("write.fieldDialog.swCurrent"))}
                {check("hidden", t("write.fieldDialog.swHidden"))}
                <label className="flex items-center gap-2">
                  {t("write.fieldDialog.reset")}
                  <input className={INPUT} inputMode="numeric" value={c.reset} onChange={(e) => set({ reset: e.target.value })} />
                </label>
                <label className="flex items-center gap-2">
                  {t("write.fieldDialog.headingReset")}
                  <input className={INPUT} inputMode="numeric" value={c.headingReset} onChange={(e) => set({ headingReset: e.target.value })} />
                </label>
              </>
            )}
            {c.name === "STYLEREF" && (
              <>
                <label className="flex flex-col gap-0.5">
                  {t("write.fieldDialog.style")}
                  <select className={`${INPUT} w-full`} value={c.style} data-testid="field-style" onChange={(e) => set({ style: e.target.value })}>
                    {[...new Set([c.style, ...styles])].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                {check("last", t("write.fieldDialog.swLast"))}
                {check("number", t("write.fieldDialog.swParaNumber"))}
              </>
            )}
            {c.name === "DOCPROPERTY" && (
              <label className="flex flex-col gap-0.5">
                {t("write.fieldDialog.property")}
                <select className={`${INPUT} w-full`} value={c.property} onChange={(e) => set({ property: e.target.value })}>
                  {PROPERTIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-ui-muted">{t(`write.fieldDialog.desc.${c.name}`)}</p>
          </fieldset>
        </div>
        <label className="flex flex-col gap-0.5">
          {t("write.fieldDialog.code")}
          <output className="rounded border border-ui-border bg-ui-panel px-2 py-1 font-mono text-xs" data-testid="field-code">
            {kind ? fieldCode(kind) : "—"}
          </output>
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <button type="submit" className={BUTTON} disabled={!kind} data-testid="field-ok">
            {t("common.ok")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ----- Convert Notes ---------------------------------------------------------------------------

export type ConvertChoice = "footToEnd" | "endToFoot" | "swap";

/** The commands of Word's Convert Notes choice (swap converts both ways at once). */
export function convertNotesCommands(choice: ConvertChoice, notes: { id: number; kind: NoteKind }[]): WriteCommand[] {
  if (choice === "footToEnd") return [{ type: "convertNotes", to: "end" }];
  if (choice === "endToFoot") return [{ type: "convertNotes", to: "foot" }];
  const foot = notes.filter((n) => n.kind === "foot").map((n) => n.id);
  const end = notes.filter((n) => n.kind === "end").map((n) => n.id);
  const out: WriteCommand[] = [];
  if (foot.length) out.push({ type: "convertNotes", ids: foot, to: "end" });
  if (end.length) out.push({ type: "convertNotes", ids: end, to: "foot" });
  return out;
}

export function ConvertNotesDialog({ open, notes, onSubmit, onClose }: {
  open: boolean;
  notes: { id: number; kind: NoteKind }[];
  onSubmit: (choice: ConvertChoice) => void;
  onClose: () => void;
}) {
  const t = useT();
  const hasFoot = notes.some((n) => n.kind === "foot");
  const hasEnd = notes.some((n) => n.kind === "end");
  const [choice, setChoice] = useState<ConvertChoice>("footToEnd");
  useEffect(() => {
    if (open) setChoice(hasFoot ? "footToEnd" : "endToFoot");
  }, [open]); // eslint-disable-line
  const opt = (value: ConvertChoice, enabled: boolean) => (
    <label className={`flex items-center gap-2 ${enabled ? "" : "opacity-50"}`}>
      <input type="radio" name="convert" disabled={!enabled} checked={choice === value} data-testid={`convert-${value}`} onChange={() => setChoice(value)} />
      {t(`write.notes.convert.${value}`)}
    </label>
  );
  return (
    <Dialog open={open} title={t("write.notes.convertTitle")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        data-testid="convert-notes-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(choice);
        }}
      >
        {opt("footToEnd", hasFoot)}
        {opt("endToFoot", hasEnd)}
        {opt("swap", hasFoot && hasEnd)}
        <div className="mt-1 flex justify-end gap-2">
          <button type="submit" className={BUTTON} disabled={!notes.length} data-testid="convert-ok">
            {t("common.ok")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ----- separators ------------------------------------------------------------------------------

type SepKey = keyof NoteSeparators;
const SEP_KEYS: SepKey[] = ["footnote", "footnoteContinuation", "endnote", "endnoteContinuation"];

const sepMode = (s: NoteSeparator | undefined): "line" | "none" | "text" => (!s || s.kind === "line" ? "line" : s.value.text ? "text" : "none");

/** The separators as edited: Word's line, none, or own text, per separator. */
export function SeparatorsDialog({ open, value, onSubmit, onClose }: {
  open: boolean;
  value: NoteSeparators;
  onSubmit: (v: NoteSeparators) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState<NoteSeparators>(value);
  useEffect(() => {
    if (open) setV(value);
  }, [open]); // eslint-disable-line
  const setSep = (key: SepKey, sep: NoteSeparator) => setV((prev) => {
    const next = { ...prev };
    if (sep.kind === "line") delete next[key];
    else next[key] = sep;
    return next;
  });
  return (
    <Dialog open={open} title={t("write.notes.separatorsTitle")} onClose={onClose}>
      <form
        className="flex w-[26rem] max-w-full flex-col gap-2 text-sm"
        data-testid="separators-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(v);
        }}
      >
        {SEP_KEYS.map((key) => {
          const mode = sepMode(v[key]);
          const text = v[key]?.kind === "text" ? v[key].value.text : "";
          return (
            <fieldset key={key} className="flex flex-col gap-1 rounded border border-ui-border p-2">
              <legend className="px-1 text-xs">{t(`write.notes.sep.${key}`)}</legend>
              <div className="flex items-center gap-2">
                <select
                  className={`${INPUT} w-32`}
                  aria-label={t(`write.notes.sep.${key}`)}
                  value={mode}
                  data-testid={`sep-${key}`}
                  onChange={(e) => {
                    const m = e.target.value;
                    setSep(key, m === "line" ? { kind: "line" } : { kind: "text", value: { text: m === "text" ? text || "…" : "" } });
                  }}
                >
                  <option value="line">{t("write.notes.sep.line")}</option>
                  <option value="none">{t("write.notes.sep.none")}</option>
                  <option value="text">{t("write.notes.sep.text")}</option>
                </select>
                {mode === "text" && (
                  <input className={`${INPUT} flex-1`} value={text} data-testid={`sep-${key}-text`} aria-label={t("write.notes.sep.text")} onChange={(e) => setSep(key, { kind: "text", value: { text: e.target.value } })} />
                )}
              </div>
            </fieldset>
          );
        })}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className={`${BUTTON} mr-auto`} onClick={() => setV({})}>
            {t("write.notes.sep.reset")}
          </button>
          <button type="submit" className={BUTTON} data-testid="separators-ok">
            {t("common.ok")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ----- wiring ----------------------------------------------------------------------------------

/** The caret as (paragraph id, char offset) and PM position, outside the notes area too. */
function caretPoint(editor: Editor): { block: number; offset: number; pos: number } | null {
  const $p = editor.state.selection.$from;
  const id = $p.parent.attrs.id as number | null;
  if (!$p.parent.isTextblock || id == null || id < 0) return null;
  return { block: id, offset: charOffsetOf($p.parent, $p.parentOffset), pos: $p.pos };
}

export function W6Dialogs({ features, ctl, editor }: { features: WriteFeatures; ctl: SyncController; editor: Editor | null }) {
  const dialog = useSyncExternalStore(features.ui.subscribe, () => features.ui.getState().dialog);
  const notes = useSyncExternalStore(ctl.subscribe, () => ctl.notes);
  const separators = useSyncExternalStore(ctl.subscribe, () => ctl.separators);
  const close = () => {
    features.ui.openDialog(null);
    editor?.commands.focus();
  };
  const run = (cmds: WriteCommand[]) => {
    if (cmds.length) void ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });
  };
  const bookmarks = useMemo(() => (editor && dialog === "field" ? bookmarkList(editor.state.doc, "name", true).map((b) => b.name) : []), [editor, dialog]);
  const styles = useMemo(
    () => (dialog === "field" ? (ctl.styles?.styles ?? []).filter((s) => s.kind === "paragraph" && !s.hidden).map((s) => s.name) : []),
    [ctl, dialog],
  );
  return (
    <>
      <FieldDialog
        open={dialog === "field"}
        bookmarks={bookmarks}
        styles={styles}
        onClose={close}
        onSubmit={(kind) => {
          const at = editor && caretPoint(editor);
          close();
          if (!editor || !at) return;
          const cached = fieldValue(kind, at.pos, editor.state, features.fields) ?? "";
          // Insert, then let the core compute what it can (REF, SEQ, STYLEREF…) for that paragraph.
          run([
            { type: "insertField", block: at.block, offset: at.offset, field: kind, cached },
            { type: "updateFields", values: [], refresh: { pages: paragraphPages(editor.state), blocks: [at.block] } },
          ]);
        }}
      />
      <ConvertNotesDialog
        open={dialog === "convertNotes"}
        notes={notes}
        onClose={close}
        onSubmit={(choice) => {
          run(convertNotesCommands(choice, notes));
          close();
        }}
      />
      <SeparatorsDialog
        open={dialog === "separators"}
        value={separators}
        onClose={close}
        onSubmit={(v) => {
          run([{ type: "setNoteSeparators", separators: v }]);
          close();
        }}
      />
    </>
  );
}

/** The note holding the caret (its id and kind), for Convert to Endnote / Footnote. */
export function noteAtCaret(editor: Editor): { id: number; kind: NoteKind } | null {
  const area = notesNode(editor.state.doc);
  if (!area) return null;
  const $p = editor.state.selection.$from;
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d);
    if (n.type.name === "note") return { id: n.attrs.id as number, kind: n.attrs.kind as NoteKind };
  }
  return null;
}
