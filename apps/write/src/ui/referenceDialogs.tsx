// P8-27 dialogs: Insert Hyperlink (Ctrl+K), Bookmark, Go To (Ctrl+G /
// F5), Insert Caption, Cross-reference, Columns (More Columns…), Symbol
// (More Symbols…, Special Characters) and Date and Time. `ReferenceDialogs`
// shows the one the UI store asks for and sends its Rust commands.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog, getLocale } from "@rusuite/ui-shared";
import type { Columns } from "../generated/Columns";
import type { Hyperlink } from "../generated/Hyperlink";
import type { LinkTarget } from "../generated/LinkTarget";
import type { RefShow } from "../generated/RefShow";
import type { WriteCommand } from "../generated/WriteCommand";
import type { WriteUi } from "../features/WriteFeatures";
import { nextTempId, type SyncController } from "../sync/SyncPlugin";
import {
  addBookmarkCommand, addressOf, bookmarkList, freshRefName, goToBookmark, goToPos, headingsOf, hyperlinkCommand, linkDialogInit, pageStart,
  parseAddress, validBookmarkName, type LinkDialogInit,
} from "../features/links";
import {
  captionCommand, captionLabels, captionPreview, crossRefCommand, refItems, showOptions, type RefItem, type RefType,
} from "../features/references";
import {
  columnsCommand, columnsForm, formColumns, presetColumns, textWidth, withCount, withWidth, type ColumnPreset, type ColumnsApplyTo, type ColumnsForm,
} from "../features/columns";
import {
  charCode, fromCharCode, gallerySymbols, recentSymbols, rememberSymbol, searchSymbols, SPECIAL_CHARACTERS, specialGlyph, subsetOf, symbolName,
  SYMBOL_SUBSETS,
} from "../features/symbols";
import { currentSection } from "../features/structureCommands";
import { formatDateTime } from "../features/structure";
import { BUTTON, cm, fromCm, INPUT } from "./dialogs";
import { useT } from "../i18n";
import { NoteDialog, noteDialogCommands, type NoteDialogValues } from "./noteDialog";
import { insertNote } from "../features/structureCommands";

const WEB_PLACEHOLDER = "https://"; // i18n-ignore
const MAIL_PLACEHOLDER = "mailto:"; // i18n-ignore
const LIST = "max-h-48 min-h-24 overflow-auto rounded border border-ui-border bg-ui-bg text-sm";
const ITEM = "block w-full truncate px-2 py-1 text-left hover:bg-ui-hover";

// ----- hyperlink ----------------------------------------------------------------------------

export type LinkKind = "web" | "place" | "email";

/** The Insert Hyperlink dialog's values. */
export interface LinkValues {
  kind: LinkKind;
  text: string;
  address: string;
  /** "Place in this document": a bookmark name, `_top`, or `heading:<id>`. */
  place: string;
  email: string;
  subject: string;
  tooltip: string;
}

/** The dialog's start values for `init`. */
export function linkValues(init: LinkDialogInit | null): LinkValues {
  const v: LinkValues = { kind: "web", text: init?.text ?? "", address: "", place: "", email: "", subject: "", tooltip: init?.link?.tooltip ?? "" };
  const t = init?.link?.target;
  if (t?.kind === "url") v.address = t.value;
  else if (t?.kind === "bookmark") {
    v.kind = "place";
    v.place = t.value;
  } else if (t?.kind === "email") {
    v.kind = "email";
    v.email = t.value.address;
    v.subject = t.value.subject ?? "";
  }
  return v;
}

/** The link of the dialog's values (null when the address is missing). A heading gets a hidden bookmark: `bookmark` names it. */
export function linkOfValues(v: LinkValues, headingBookmark: string | null): Hyperlink | null {
  let target: LinkTarget | null = null;
  if (v.kind === "web") target = parseAddress(v.address);
  else if (v.kind === "email") target = v.email.trim() ? { kind: "email", value: v.subject.trim() ? { address: v.email.trim().replace(/^mailto:/i, ""), subject: v.subject.trim() } : { address: v.email.trim().replace(/^mailto:/i, "") } } : null;
  else if (v.place.startsWith("heading:")) target = headingBookmark ? { kind: "bookmark", value: headingBookmark } : null;
  else if (v.place) target = { kind: "bookmark", value: v.place };
  if (!target) return null;
  return v.tooltip.trim() ? { target, tooltip: v.tooltip.trim() } : { target };
}

export function LinkDialog({ open, init, places, onSubmit, onRemove, onClose }: {
  open: boolean;
  init: LinkDialogInit | null;
  /** Headings and bookmarks of the document. */
  places: { headings: { id: number; text: string; level: number }[]; bookmarks: string[] };
  onSubmit: (v: LinkValues) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState<LinkValues>(() => linkValues(init));
  useEffect(() => {
    if (open) setV(linkValues(init));
  }, [open, init]);
  const set = (patch: Partial<LinkValues>) => setV((cur) => ({ ...cur, ...patch }));
  const valid = linkOfValues(v, "x") !== null;
  const kinds: [LinkKind, string][] = [
    ["web", t("write.link.web")],
    ["place", t("write.link.place")],
    ["email", t("write.link.email")],
  ];
  return (
    <Dialog open={open} title={t("write.link.title")} onClose={onClose}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-2 text-sm"
        data-testid="link-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(v);
        }}
      >
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0">{t("write.link.text")}</span>
          <input
            aria-label={t("write.link.text")}
            className={`${INPUT} w-full`}
            value={v.text}
            disabled={init?.textFixed}
            placeholder={init?.textFixed ? t("write.link.selection") : ""}
            onChange={(e) => set({ text: e.target.value })}
          />
        </label>
        <div className="flex gap-3" role="radiogroup" aria-label={t("write.link.linkTo")}>
          <span className="w-28 shrink-0">{t("write.link.linkTo")}</span>
          {kinds.map(([k, label]) => (
            <label key={k} className="flex items-center gap-1">
              <input type="radio" name="link-kind" checked={v.kind === k} onChange={() => set({ kind: k })} />
              {label}
            </label>
          ))}
        </div>
        {v.kind === "web" && (
          <label className="flex items-center gap-2">
            <span className="w-28 shrink-0">{t("write.link.address")}</span>
            <input aria-label={t("write.link.address")} data-autofocus className={`${INPUT} w-full`} value={v.address} placeholder={WEB_PLACEHOLDER} onChange={(e) => set({ address: e.target.value })} />
          </label>
        )}
        {v.kind === "place" && (
          <div className="flex flex-col gap-1">
            <span>{t("write.link.selectPlace")}</span>
            <div className={LIST} role="listbox" aria-label={t("write.link.selectPlace")}>
              {(
                [
                  ["_top", t("write.link.top"), 0],
                  ...places.headings.map((h) => [`heading:${h.id}`, h.text, h.level] as const),
                  ...places.bookmarks.map((b) => [b, b, 0] as const),
                ] as (readonly [string, string, number])[]
              ).map(([value, label, level], i) => {
                const header = i === 1 && places.headings.length ? t("write.link.headings") : i === 1 + places.headings.length && places.bookmarks.length ? t("write.link.bookmarks") : null;
                return (
                  <div key={value}>
                    {header && <div className="px-2 pt-1 text-xs font-semibold text-ui-muted">{header}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={v.place === value}
                      className={`${ITEM} ${v.place === value ? "bg-ui-hover font-medium" : ""}`}
                      style={{ paddingLeft: `${0.5 + Math.max(0, level - 1)}rem` }}
                      onClick={() => set({ place: value })}
                    >
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {v.kind === "email" && (
          <>
            <label className="flex items-center gap-2">
              <span className="w-28 shrink-0">{t("write.link.emailAddress")}</span>
              <input aria-label={t("write.link.emailAddress")} className={`${INPUT} w-full`} value={v.email} placeholder={MAIL_PLACEHOLDER} onChange={(e) => set({ email: e.target.value })} />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-28 shrink-0">{t("write.link.subject")}</span>
              <input aria-label={t("write.link.subject")} className={`${INPUT} w-full`} value={v.subject} onChange={(e) => set({ subject: e.target.value })} />
            </label>
          </>
        )}
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0">{t("write.link.screenTip")}</span>
          <input aria-label={t("write.link.screenTip")} className={`${INPUT} w-full`} value={v.tooltip} onChange={(e) => set({ tooltip: e.target.value })} />
        </label>
        <div className="mt-2 flex justify-between gap-2">
          <button type="button" className={BUTTON} disabled={!init?.link} onClick={onRemove}>
            {t("write.link.remove")}
          </button>
          <div className="flex gap-2">
            <button type="submit" className={BUTTON} disabled={!valid} data-testid="link-ok">
              {t("common.ok")}
            </button>
            <button type="button" className={BUTTON} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** The commands of the hyperlink dialog: a hidden bookmark for a heading target first, then `SetHyperlink`. */
export function linkCommands(init: LinkDialogInit, v: LinkValues, headingText: (id: number) => number, refName: string): WriteCommand[] {
  const heading = v.kind === "place" && v.place.startsWith("heading:") ? Number(v.place.slice(8)) : null;
  const link = linkOfValues(v, heading != null ? refName : null);
  if (!link) return [];
  const out: WriteCommand[] = [hyperlinkCommand(init, link, v.text)];
  if (heading != null) {
    const len = headingText(heading);
    out.push({ type: "addBookmark", name: refName, start: { block: heading, offset: 0 }, end: { block: heading, offset: len } });
  }
  return out;
}

// ----- bookmark -----------------------------------------------------------------------------

export function BookmarkDialog({ open, editor, onAdd, onDelete, onClose }: {
  open: boolean;
  editor: Editor | null;
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [sort, setSort] = useState<"name" | "location">("name");
  const [hidden, setHidden] = useState(false);
  const [, setTick] = useState(0);
  const list = editor && open ? bookmarkList(editor.state.doc, sort, hidden) : [];
  useEffect(() => {
    if (!open || !editor) return;
    setName("");
    const refresh = () => setTick((n) => n + 1);
    editor.on("transaction", refresh);
    return () => void editor.off("transaction", refresh);
  }, [open, editor]);
  const exists = list.some((b) => b.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <Dialog open={open} title={t("write.bookmark.title")} onClose={onClose}>
      <div className="flex w-80 flex-col gap-2 text-sm" data-testid="bookmark-dialog">
        <label className="flex flex-col gap-1">
          <span>{t("write.bookmark.name")}</span>
          <input
            aria-label={t("write.bookmark.name")}
            className={`${INPUT} w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && validBookmarkName(name.trim())) {
                e.preventDefault();
                onAdd(name.trim());
              }
            }}
          />
        </label>
        {name.trim() && !validBookmarkName(name.trim()) && <p className="text-xs text-amber-700">{t("write.bookmark.invalid")}</p>}
        <div className={LIST} role="listbox" aria-label={t("write.bookmark.list")}>
          {list.map((b) => (
            <button key={b.id} type="button" role="option" aria-selected={b.name === name} className={`${ITEM} ${b.name === name ? "bg-ui-hover font-medium" : ""}`} onClick={() => setName(b.name)}>
              {b.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span>{t("write.bookmark.sortBy")}</span>
          <label className="flex items-center gap-1">
            <input type="radio" name="bm-sort" checked={sort === "name"} onChange={() => setSort("name")} />
            {t("write.bookmark.byName")}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="bm-sort" checked={sort === "location"} onChange={() => setSort("location")} />
            {t("write.bookmark.byLocation")}
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {t("write.bookmark.hidden")}
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className={BUTTON} disabled={!validBookmarkName(name.trim())} onClick={() => onAdd(name.trim())}>
            {t("write.bookmark.add")}
          </button>
          <button type="button" className={BUTTON} disabled={!exists} onClick={() => onDelete(name.trim())}>
            {t("write.bookmark.delete")}
          </button>
          <button type="button" className={BUTTON} disabled={!exists} onClick={() => editor && goToBookmark(editor.view, name.trim())}>
            {t("write.bookmark.goTo")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ----- go to ---------------------------------------------------------------------------------

export function GoToDialog({ open, editor, pages, onClose }: { open: boolean; editor: Editor | null; pages: number; onClose: () => void }) {
  const t = useT();
  const [what, setWhat] = useState<"page" | "bookmark" | "heading">("page");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
    }
  }, [open]);
  const doc = editor?.state.doc;
  const bookmarks = useMemo(() => (open && doc ? bookmarkList(doc, "name", false) : []), [open, doc]);
  const headings = useMemo(() => (open && doc ? headingsOf(doc) : []), [open, doc]);
  const go = () => {
    if (!editor) return;
    if (what === "page") {
      const n = Number(value.trim() || "1");
      const pos = Number.isInteger(n) && n >= 1 ? pageStart(editor.state, n) : null;
      if (pos == null) return setError(t("write.goTo.noPage", { n: value || "1", pages }));
      goToPos(editor.view, pos);
    } else if (what === "bookmark") {
      if (!goToBookmark(editor.view, value)) return setError(t("write.goTo.noBookmark"));
    } else {
      const h = headings.find((x) => String(x.id) === value) ?? headings[0];
      if (!h) return setError(t("write.goTo.noHeading"));
      goToPos(editor.view, h.pos + 1);
    }
    onClose();
  };
  return (
    <Dialog open={open} title={t("write.goTo.title")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        data-testid="goto-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label className="flex items-center justify-between gap-2">
          <span>{t("write.goTo.what")}</span>
          <select
            aria-label={t("write.goTo.what")}
            className={`${INPUT} w-40`}
            value={what}
            onChange={(e) => {
              setWhat(e.target.value as typeof what);
              setValue("");
              setError(null);
            }}
          >
            <option value="page">{t("write.goTo.page")}</option>
            <option value="bookmark">{t("write.goTo.bookmark")}</option>
            <option value="heading">{t("write.goTo.heading")}</option>
          </select>
        </label>
        {what === "page" && (
          <label className="flex items-center justify-between gap-2">
            <span>{t("write.goTo.pageNumber")}</span>
            <input aria-label={t("write.goTo.pageNumber")} className={`${INPUT} w-40`} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        {what === "bookmark" && (
          <label className="flex items-center justify-between gap-2">
            <span>{t("write.goTo.bookmarkName")}</span>
            <select aria-label={t("write.goTo.bookmarkName")} className={`${INPUT} w-40`} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="" />
              {bookmarks.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {what === "heading" && (
          <label className="flex items-center justify-between gap-2">
            <span>{t("write.goTo.headingName")}</span>
            <select aria-label={t("write.goTo.headingName")} className={`${INPUT} w-40`} value={value} onChange={(e) => setValue(e.target.value)}>
              {headings.map((h) => (
                <option key={h.id} value={String(h.id)}>
                  {" ".repeat((h.level - 1) * 2)}
                  {h.text}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="text-xs text-amber-700" role="alert">
            {error}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="submit" className={BUTTON}>
            {t("write.goTo.go")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ----- caption -------------------------------------------------------------------------------

export function CaptionDialog({ open, editor, onSubmit, onClose }: {
  open: boolean;
  editor: Editor | null;
  onSubmit: (label: string, below: boolean, text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState("Figure");
  const [below, setBelow] = useState(true);
  const [text, setText] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setText("");
    setNewLabel(null);
  }, [open]);
  const labels = editor ? captionLabels(editor.state.doc, added) : [];
  const prefix = editor ? captionPreview(editor.state, label, below) : label;
  return (
    <Dialog open={open} title={t("write.caption.title")} onClose={onClose}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        data-testid="caption-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(label, below, text);
        }}
      >
        <label className="flex flex-col gap-1">
          <span>{t("write.caption.caption")}</span>
          <span className="flex items-center gap-1 rounded border border-ui-border bg-ui-bg px-2">
            <span className="whitespace-nowrap text-ui-muted" data-testid="caption-prefix">
              {prefix}
            </span>
            <input aria-label={t("write.caption.caption")} data-autofocus className="h-7 w-full bg-transparent text-sm text-ui-fg outline-none" value={text} onChange={(e) => setText(e.target.value)} />
          </span>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>{t("write.caption.label")}</span>
          <select aria-label={t("write.caption.label")} className={`${INPUT} w-48`} value={label} onChange={(e) => setLabel(e.target.value)}>
            {labels.map((l) => (
              <option key={l} value={l}>
                {CAPTION_LABEL_KEYS[l] ? t(CAPTION_LABEL_KEYS[l]!) : l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>{t("write.caption.position")}</span>
          <select aria-label={t("write.caption.position")} className={`${INPUT} w-48`} value={below ? "below" : "above"} onChange={(e) => setBelow(e.target.value === "below")}>
            <option value="above">{t("write.caption.above")}</option>
            <option value="below">{t("write.caption.below")}</option>
          </select>
        </label>
        {newLabel !== null ? (
          <span className="flex items-center gap-2">
            <input aria-label={t("write.caption.newLabel")} className={`${INPUT} w-full`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <button
              type="button"
              className={BUTTON}
              disabled={!newLabel.trim()}
              onClick={() => {
                const l = newLabel.trim();
                setAdded((a) => [...a, l]);
                setLabel(l);
                setNewLabel(null);
              }}
            >
              {t("common.ok")}
            </button>
          </span>
        ) : (
          <button type="button" className={`${BUTTON} self-start`} onClick={() => setNewLabel("")}>
            {t("write.caption.newLabelDots")}
          </button>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="submit" className={BUTTON} data-testid="caption-ok">
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

/** Built-in labels are shown translated (the SEQ identifier stays English, as Word writes it). */
const CAPTION_LABEL_KEYS: Record<string, string> = { Figure: "write.caption.figure", Table: "write.caption.table", Equation: "write.caption.equation" };

// ----- cross-reference ----------------------------------------------------------------------

const SHOW_KEYS: Record<RefShow, string> = {
  text: "write.xref.showText",
  page: "write.xref.showPage",
  number: "write.xref.showNumber",
  noteFormatted: "write.xref.showNoteFormatted",
};

export function CrossReferenceDialog({ open, editor, onInsert, onClose }: {
  open: boolean;
  editor: Editor | null;
  onInsert: (type: RefType, item: RefItem, show: RefShow, hyperlink: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [type, setType] = useState<RefType>("heading");
  const [show, setShow] = useState<RefShow>("text");
  const [hyperlink, setHyperlink] = useState(true);
  const [selected, setSelected] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open || !editor) return;
    const refresh = () => setTick((n) => n + 1);
    editor.on("transaction", refresh);
    return () => void editor.off("transaction", refresh);
  }, [open, editor]);
  const doc = editor?.state.doc;
  const labels = doc ? captionLabels(doc) : [];
  const types: [RefType, string][] = [
    ["numbered", t("write.xref.numbered")],
    ["heading", t("write.xref.heading")],
    ["bookmark", t("write.xref.bookmark")],
    ["footnote", t("write.xref.footnote")],
    ["endnote", t("write.xref.endnote")],
    ...labels.map((l) => [`caption:${l}` as RefType, CAPTION_LABEL_KEYS[l] ? t(CAPTION_LABEL_KEYS[l]!) : l] as [RefType, string]),
  ];
  const items = open && doc ? refItems(doc, type) : [];
  const options = showOptions(type);
  const item = items[selected] ?? null;
  const showLabel = (s: RefShow) =>
    type.startsWith("caption:") ? t(s === "text" ? "write.xref.captionEntire" : s === "number" ? "write.xref.captionLabel" : SHOW_KEYS[s]) : type === "footnote" || type === "endnote" ? t(s === "number" ? "write.xref.noteNumber" : SHOW_KEYS[s]) : t(SHOW_KEYS[s]);
  return (
    <Dialog open={open} title={t("write.xref.title")} onClose={onClose}>
      <div className="flex w-[28rem] max-w-full flex-col gap-2 text-sm" data-testid="xref-dialog">
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span>{t("write.xref.type")}</span>
            <select
              aria-label={t("write.xref.type")}
              className={`${INPUT} w-full`}
              value={type}
              onChange={(e) => {
                const next = e.target.value as RefType;
                setType(next);
                setSelected(0);
                if (!showOptions(next).includes(show)) setShow(showOptions(next)[0]!);
              }}
            >
              {types.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span>{t("write.xref.insertTo")}</span>
            <select aria-label={t("write.xref.insertTo")} className={`${INPUT} w-full`} value={show} onChange={(e) => setShow(e.target.value as RefShow)}>
              {options.map((s) => (
                <option key={s} value={s}>
                  {showLabel(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hyperlink} onChange={(e) => setHyperlink(e.target.checked)} />
          {t("write.xref.asLink")}
        </label>
        <span>{t("write.xref.forWhich")}</span>
        <div className={LIST} role="listbox" aria-label={t("write.xref.forWhich")}>
          {items.length === 0 && <p className="px-2 py-1 text-ui-muted">{t("write.xref.none")}</p>}
          {items.map((it, i) => (
            <button key={`${i}:${it.label}`} type="button" role="option" aria-selected={i === selected} className={`${ITEM} ${i === selected ? "bg-ui-hover font-medium" : ""}`} onClick={() => setSelected(i)}>
              {it.label}
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className={BUTTON} disabled={!item} data-testid="xref-insert" onClick={() => item && onInsert(type, item, show, hyperlink)}>
            {t("write.xref.insert")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ----- columns --------------------------------------------------------------------------------

export function ColumnsDialog({ open, initial, content, onSubmit, onClose }: {
  open: boolean;
  initial: Columns | null;
  /** Text width of the section (twips). */
  content: number;
  onSubmit: (cols: Columns, applyTo: ColumnsApplyTo) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [f, setF] = useState<ColumnsForm>(() => columnsForm(initial, content));
  const [applyTo, setApplyTo] = useState<ColumnsApplyTo>("section");
  const [count, setCount] = useState("1");
  useEffect(() => {
    if (!open) return;
    const v = columnsForm(initial, content);
    setF(v);
    setCount(String(v.count));
    setApplyTo("section");
  }, [open, initial, content]);
  const presets: [ColumnPreset, string][] = [
    ["one", t("write.columns.one")],
    ["two", t("write.columns.two")],
    ["three", t("write.columns.three")],
    ["left", t("write.columns.left")],
    ["right", t("write.columns.right")],
  ];
  const pick = (p: ColumnPreset) => {
    const v = columnsForm(presetColumns(p, content), content);
    setF({ ...v, separator: f.separator });
    setCount(String(v.count));
  };
  return (
    <Dialog open={open} title={t("write.columns.title")} onClose={onClose}>
      <form
        className="flex w-[26rem] max-w-full flex-col gap-2 text-sm"
        data-testid="columns-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(formColumns(f), applyTo);
        }}
      >
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("write.columns.presets")}>
          {presets.map(([p, label]) => (
            <button key={p} type="button" className={BUTTON} onClick={() => pick(p)}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center justify-between gap-2">
          <span>{t("write.columns.number")}</span>
          <input
            aria-label={t("write.columns.number")}
            className={`${INPUT} w-20`}
            type="number"
            min={1}
            max={45}
            value={count}
            onChange={(e) => {
              setCount(e.target.value);
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 45) setF(withCount(f, n, content));
            }}
          />
        </label>
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs text-ui-muted">
              <th className="font-normal">{t("write.columns.col")}</th>
              <th className="font-normal">{t("write.columns.width")}</th>
              <th className="font-normal">{t("write.columns.spacing")}</th>
            </tr>
          </thead>
          <tbody>
            {f.widths.map((w, i) => {
              const disabled = f.equal && i > 0;
              return (
                <tr key={i}>
                  <td>{i + 1}:</td>
                  <td>
                    <CmField label={t("write.columns.widthOf", { n: i + 1 })} value={w.width} disabled={disabled} onCommit={(v) => setF(withWidth(f, i, { width: v }, content))} />
                  </td>
                  <td>
                    {i + 1 < f.count && <CmField label={t("write.columns.spacingOf", { n: i + 1 })} value={w.space} disabled={disabled} onCommit={(v) => setF(withWidth(f, i, { space: v }, content))} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.equal} disabled={f.count <= 1} onChange={(e) => setF({ ...f, equal: e.target.checked, widths: e.target.checked ? withCount(f, f.count, content).widths : f.widths })} />
          {t("write.columns.equal")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.separator} disabled={f.count <= 1} onChange={(e) => setF({ ...f, separator: e.target.checked })} />
          {t("write.columns.line")}
        </label>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2">
            <span>{t("write.columns.applyTo")}</span>
            <select aria-label={t("write.columns.applyTo")} className={`${INPUT} w-44`} value={applyTo} onChange={(e) => setApplyTo(e.target.value as ColumnsApplyTo)}>
              <option value="section">{t("write.columns.thisSection")}</option>
              <option value="forward">{t("write.columns.forward")}</option>
              <option value="whole">{t("write.columns.whole")}</option>
            </select>
          </label>
          <ColumnsPreview f={f} />
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <button type="submit" className={BUTTON} data-testid="columns-ok">
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

function CmField({ label, value, disabled, onCommit }: { label: string; value: number; disabled?: boolean; onCommit: (twips: number) => void }) {
  const [text, setText] = useState(cm(value));
  useEffect(() => setText(cm(value)), [value]);
  const commit = () => {
    const v = fromCm(text);
    if (v != null && v >= 0) onCommit(v);
    else setText(cm(value));
  };
  return (
    <input
      aria-label={label}
      className={`${INPUT} w-24`}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** A small page with the columns as grey bars. */
function ColumnsPreview({ f }: { f: ColumnsForm }) {
  const total = f.widths.reduce((s, w) => s + w.width + w.space, 0) || 1;
  let x = 0;
  return (
    <svg width="64" height="80" viewBox="0 0 64 80" aria-hidden="true" className="rounded border border-ui-border bg-white">
      {f.widths.map((w, i) => {
        const left = 6 + (x / total) * 52;
        const width = (w.width / total) * 52;
        x += w.width + w.space;
        return (
          <g key={i}>
            {Array.from({ length: 9 }, (_, k) => (
              <rect key={k} x={left} y={8 + k * 7} width={width} height={3} fill="#9ca3af" />
            ))}
            {f.separator && i + 1 < f.widths.length && <line x1={left + width + (w.space / total) * 26} x2={left + width + (w.space / total) * 26} y1={6} y2={74} stroke="#555" strokeWidth={0.5} />}
          </g>
        );
      })}
    </svg>
  );
}

// ----- symbol -----------------------------------------------------------------------------------

export function SymbolDialog({ open, tab, onTab, onInsert, onClose }: {
  open: boolean;
  tab: "symbols" | "special";
  onTab: (tab: "symbols" | "special") => void;
  onInsert: (ch: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [subset, setSubset] = useState(SYMBOL_SUBSETS[1]!.id);
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [special, setSpecial] = useState(0);
  useEffect(() => {
    if (!open) return;
    setRecent(recentSymbols());
    setQuery("");
  }, [open]);
  const chars = query.trim() ? searchSymbols(query) : (SYMBOL_SUBSETS.find((s) => s.id === subset)?.chars ?? []);
  const select = (ch: string) => {
    setSelected(ch);
    setCode(charCode(ch));
    const s = subsetOf(ch);
    if (s && !query.trim()) setSubset(s.id);
  };
  const insert = (ch: string) => {
    setRecent(rememberSymbol(ch));
    onInsert(ch);
  };
  return (
    <Dialog open={open} title={t("write.symbol.title")} onClose={onClose}>
      <div className="flex w-[34rem] max-w-full flex-col gap-2 text-sm" data-testid="symbol-dialog">
        <div className="flex gap-2 border-b border-ui-border" role="tablist">
          {(["symbols", "special"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`px-3 py-1 ${tab === k ? "border-b-2 border-ui-focus font-medium" : ""}`} onClick={() => onTab(k)}>
              {t(k === "symbols" ? "write.symbol.tabSymbols" : "write.symbol.tabSpecial")}
            </button>
          ))}
        </div>
        {tab === "symbols" ? (
          <>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span>{t("write.symbol.subset")}</span>
                <select aria-label={t("write.symbol.subset")} className={`${INPUT} w-48`} value={subset} disabled={!!query.trim()} onChange={(e) => setSubset(e.target.value)}>
                  {SYMBOL_SUBSETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t(s.label)}
                    </option>
                  ))}
                </select>
              </label>
              <input aria-label={t("write.symbol.search")} placeholder={t("write.symbol.search")} className={`${INPUT} w-full`} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="grid max-h-56 grid-cols-[repeat(16,minmax(0,1fr))] overflow-auto rounded border border-ui-border bg-ui-bg" role="grid" aria-label={t("write.symbol.grid")} data-testid="symbol-grid">
              {chars.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  title={`${symbolName(ch)} (U+${charCode(ch)})`}
                  aria-label={symbolName(ch) || `U+${charCode(ch)}`}
                  aria-pressed={ch === selected}
                  className={`flex h-8 min-w-8 items-center justify-center border-b border-r border-ui-border text-base hover:bg-ui-hover ${ch === selected ? "bg-ui-focus text-white" : ""}`}
                  onClick={() => select(ch)}
                  onDoubleClick={() => insert(ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-ui-muted">{t("write.symbol.recent")}</span>
              {recent.map((ch) => (
                <button key={ch} type="button" className="flex h-8 w-8 items-center justify-center rounded border border-ui-border hover:bg-ui-hover" title={symbolName(ch)} onClick={() => select(ch)}>
                  {ch}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ui-muted" data-testid="symbol-name">
                {selected ? symbolName(selected) || "—" : ""}
              </span>
              <label className="flex items-center gap-1">
                <span>{t("write.symbol.code")}</span>
                <input
                  aria-label={t("write.symbol.code")}
                  className={`${INPUT} w-20`}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    const ch = fromCharCode(e.target.value);
                    if (ch) {
                      setSelected(ch);
                      const s = subsetOf(ch);
                      if (s) setSubset(s.id);
                    }
                  }}
                />
              </label>
            </div>
          </>
        ) : (
          <div className={LIST} role="listbox" aria-label={t("write.symbol.tabSpecial")}>
            {SPECIAL_CHARACTERS.map((c, i) => (
              <button
                key={c.label}
                type="button"
                role="option"
                aria-selected={i === special}
                className={`grid w-full grid-cols-[2rem_1fr_9rem] gap-2 px-2 py-1 text-left hover:bg-ui-hover ${i === special ? "bg-ui-hover font-medium" : ""}`}
                onClick={() => setSpecial(i)}
                onDoubleClick={() => insert(c.ch)}
              >
                <span className="text-center">{specialGlyph(c.ch)}</span>
                <span>{t(c.label)}</span>
                <span className="text-xs text-ui-muted">{c.shortcut ?? ""}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className={BUTTON}
            data-testid="symbol-insert"
            disabled={tab === "symbols" && !selected}
            onClick={() => insert(tab === "symbols" ? selected! : SPECIAL_CHARACTERS[special]!.ch)}
          >
            {t("write.symbol.insert")}
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The gallery under Insert › Symbol: 20 recent / common symbols. */
export function symbolGallery(): string[] {
  return gallerySymbols(recentSymbols());
}

// ----- date and time -----------------------------------------------------------------------

/** Word's Date and Time formats per UI language. */
export function dateFormats(locale: string): string[] {
  if (locale.startsWith("de")) {
    return ["dd.MM.yyyy", "dddd, d. MMMM yyyy", "d. MMMM yyyy", "dd.MM.yy", "yyyy-MM-dd", "d. MMM. yy", "dd.MM.yyyy HH:mm", "dd.MM.yyyy HH:mm:ss", "HH:mm", "HH:mm:ss", "MMMM yy", "MMM. yy"];
  }
  return ["M/d/yyyy", "dddd, MMMM d, yyyy", "MMMM d, yyyy", "M/d/yy", "yyyy-MM-dd", "d-MMM-yy", "M.d.yyyy", "MMM. d, yy", "d MMMM yyyy", "MMMM yy", "MMM-yy", "M/d/yyyy h:mm AM/PM", "M/d/yyyy h:mm:ss AM/PM", "h:mm AM/PM", "h:mm:ss AM/PM", "HH:mm", "HH:mm:ss"];
}

/** A format that shows only the time (TIME field instead of DATE). */
export const isTimeFormat = (f: string): boolean => !/[dMy]/.test(f);

/** Insert › Date & Time: a DATE / TIME field with the format ("update automatically") or the text itself. */
export function dateTimeCommand(at: { block: number; offset: number }, format: string, auto: boolean, now: Date, locale: string): WriteCommand {
  const text = formatDateTime(now, format, locale);
  if (!auto) return { type: "insertText", block: at.block, offset: at.offset, text };
  const field = isTimeFormat(format) ? ({ kind: "time", value: { format } } as const) : ({ kind: "date", value: { format } } as const);
  return { type: "insertField", block: at.block, offset: at.offset, field, cached: text };
}

export function DateTimeDialog({ open, onSubmit, onClose }: { open: boolean; onSubmit: (format: string, auto: boolean) => void; onClose: () => void }) {
  const t = useT();
  const locale = getLocale();
  const formats = dateFormats(locale);
  const [format, setFormat] = useState(formats[0]!);
  const [auto, setAuto] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    setFormat(dateFormats(getLocale())[0]!);
  }, [open]);
  return (
    <Dialog open={open} title={t("write.dateTime.title")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        data-testid="datetime-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(format, auto);
        }}
      >
        <span>{t("write.dateTime.formats")}</span>
        <div className={LIST} role="listbox" aria-label={t("write.dateTime.formats")}>
          {formats.map((f) => (
            <button key={f} type="button" role="option" aria-selected={f === format} className={`${ITEM} ${f === format ? "bg-ui-hover font-medium" : ""}`} onClick={() => setFormat(f)} onDoubleClick={() => onSubmit(f, auto)}>
              {formatDateTime(now, f, locale)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          {t("write.dateTime.auto")}
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <button type="submit" className={BUTTON}>
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

/** The P8-27 dialog the UI store asks for, applied to Rust. */
export function ReferenceDialogs({ ui, ctl, editor }: { ui: WriteUi; ctl: SyncController; editor: Editor | null }) {
  const { dialog, pages, symbolTab } = useSyncExternalStore(ui.subscribe, ui.getState);
  const sections = useSyncExternalStore(ctl.subscribe, () => ctl.sections);
  const settings = useSyncExternalStore(ctl.subscribe, () => ctl.settings);
  const close = () => {
    ui.openDialog(null);
    editor?.commands.focus();
  };
  const run = (cmds: WriteCommand[]) => {
    if (cmds.length) void ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });
  };
  // Captured when the dialog opens.
  const linkInit = useMemo(() => (editor && dialog === "link" ? linkDialogInit(editor.state) : null), [editor, dialog]);
  const places = useMemo(
    () =>
      editor && dialog === "link"
        ? { headings: headingsOf(editor.state.doc).filter((h) => h.id > 0 && h.text.trim()), bookmarks: bookmarkList(editor.state.doc, "name", false).map((b) => b.name) }
        : { headings: [], bookmarks: [] },
    [editor, dialog],
  );
  const section = useMemo(() => (editor && (dialog === "columns" || dialog === "notes") ? currentSection(editor.state, sections) : null), [editor, dialog, sections]);
  const applyNotes = async (v: NoteDialogValues) => {
    const cmds = noteDialogCommands(v, sections, section, settings);
    if (cmds.length) await ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });
  };
  const caret = () => {
    const sel = editor?.state.selection;
    const p = sel?.$from.parent;
    if (!editor || !p?.isTextblock || p.attrs.id == null || p.attrs.id < 0) return null;
    const point = { block: p.attrs.id as number, offset: 0 };
    let pm = 0;
    p.forEach((child) => {
      if (pm >= sel!.$from.parentOffset) return;
      point.offset += child.isText ? [...child.text!.slice(0, sel!.$from.parentOffset - pm)].length : 1;
      pm += child.nodeSize;
    });
    return point;
  };
  return (
    <>
      <LinkDialog
        open={dialog === "link"}
        init={linkInit}
        places={places}
        onClose={close}
        onRemove={() => {
          if (linkInit?.link && linkInit.picture) run([{ type: "setImageLink", block: linkInit.block, offset: linkInit.from, link: null }]);
          else if (linkInit?.link) run([{ type: "removeHyperlink", block: linkInit.block, from: linkInit.from, to: linkInit.to }]);
          close();
        }}
        onSubmit={(v) => {
          if (editor && linkInit) {
            const lengthOf = (id: number) => {
              let n = 0;
              editor.state.doc.descendants((node) => {
                if (node.isTextblock && node.attrs.id === id) {
                  node.forEach((c) => (n += c.isText ? [...c.text!].length : 1));
                  return false;
                }
                return true;
              });
              return n;
            };
            run(linkCommands(linkInit, v, lengthOf, freshRefName(editor.state.doc)));
          }
          close();
        }}
      />
      <BookmarkDialog
        open={dialog === "bookmark"}
        editor={editor}
        onClose={close}
        onAdd={(name) => {
          const cmd = editor && addBookmarkCommand(editor.state, name);
          if (cmd) run([cmd]);
          close();
        }}
        onDelete={(name) => run([{ type: "deleteBookmark", name }])}
      />
      <GoToDialog open={dialog === "goTo"} editor={editor} pages={pages} onClose={() => ui.openDialog(null)} />
      <CaptionDialog
        open={dialog === "caption"}
        editor={editor}
        onClose={close}
        onSubmit={(label, below, text) => {
          const cmd = editor && captionCommand(editor.state, label, below, text, nextTempId());
          if (cmd) run([cmd]);
          close();
        }}
      />
      <CrossReferenceDialog
        open={dialog === "crossRef"}
        editor={editor}
        onClose={close}
        onInsert={(type, item, show, hyperlink) => {
          const cmd = editor && crossRefCommand(editor.state, type, item, show, hyperlink);
          if (cmd) run([cmd]);
        }}
      />
      <ColumnsDialog
        open={dialog === "columns"}
        initial={section?.columns ?? null}
        content={textWidth(section?.page ?? ctl.page)}
        onClose={close}
        onSubmit={(cols, applyTo) => {
          const cmd = editor && columnsCommand(editor.state, sections, cols, applyTo);
          if (cmd) run([cmd]);
          close();
        }}
      />
      <NoteDialog
        open={dialog === "notes"}
        section={section}
        settings={settings}
        onClose={close}
        onApply={(v) => {
          void applyNotes(v);
          close();
        }}
        onInsert={(v) => {
          ui.openDialog(null);
          void applyNotes(v).then(() => editor && insertNote(editor, ctl, v.kind));
        }}
      />
      <SymbolDialog
        open={dialog === "symbol"}
        tab={symbolTab}
        onTab={(tab) => ui.set({ symbolTab: tab })}
        onClose={close}
        onInsert={(ch) => editor?.chain().focus().insertContent(ch).run()}
      />
      <DateTimeDialog
        open={dialog === "dateTime"}
        onClose={close}
        onSubmit={(format, auto) => {
          const at = caret();
          if (at) run([dateTimeCommand(at, format, auto, new Date(), getLocale())]);
          close();
        }}
      />
    </>
  );
}

export { addressOf };
