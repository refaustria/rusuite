// Dialogs of P8-22: Insert › Header & Footer (Slide tab → `SetHeaderFooter`,
// Notes and Handouts tab → the print options' page header / footer),
// Design › Slide Size › Custom Slide Size… and Rename Section.

import { useState, type ReactNode } from "react";
import { Dialog, formatNumber } from "@rusuite/ui-shared";
import { DATE_FORMATS, formatDate } from "../design/fields";
import { DEFAULT_HF, hfValuesOf, type HfValues } from "../design/hf";
import type { NotesHf, ShowPrintOptions } from "../print/showPrintDoc";
import { DEFAULT_NOTES_HF } from "../print/showPrintDoc";
import { useShow, type ShowStore } from "../state/store";
import { useT } from "../i18n";

const INPUT = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg disabled:opacity-50";
const BUTTON = "h-8 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover";

function Check({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
        {label}
      </label>
      {children && <div className="ml-6 flex flex-col gap-1">{children}</div>}
    </div>
  );
}

/** The date / time format list (today in each format, in the app's locale). */
function DateFormatSelect({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (n: number) => void }) {
  const now = new Date();
  return (
    <select aria-label={label} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.currentTarget.value))}>
      {DATE_FORMATS.map((n) => (
        <option key={n} value={n}>
          {formatDate(n, now)}
        </option>
      ))}
    </select>
  );
}

export function HeaderFooterDialog({ store, tab: initialTab = "slide", print, onPrint }: {
  store: ShowStore;
  tab?: "slide" | "notes";
  print?: ShowPrintOptions;
  onPrint?: (o: ShowPrintOptions) => void;
}) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const [tab, setTab] = useState<"slide" | "notes">(initialTab);
  const [v, setV] = useState<HfValues>(() => (pres ? hfValuesOf(pres, current) : DEFAULT_HF));
  const [notes, setNotes] = useState<NotesHf>(() => print?.notesHf ?? DEFAULT_NOTES_HF);
  const set = <K extends keyof HfValues>(k: K, val: HfValues[K]) => setV({ ...v, [k]: val });
  const setN = <K extends keyof NotesHf>(k: K, val: NotesHf[K]) => setNotes({ ...notes, [k]: val });
  const close = () => store.closeDialog();
  const apply = (all: boolean) => {
    close();
    if (tab === "notes") {
      if (print && onPrint) onPrint({ ...print, notesHf: notes });
      return;
    }
    void store.setHeaderFooter(v, all);
  };
  const tabBtn = (id: "slide" | "notes", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`h-8 rounded-t border border-b-0 border-ui-border px-3 ${tab === id ? "bg-ui-bg font-medium" : "bg-ui-panel"}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );
  return (
    <Dialog open title={t("show.hf.title")} onClose={close}>
      <div className="flex w-[26rem] flex-col gap-3 text-sm" data-testid="hf-dialog">
        <div role="tablist" className="flex gap-1 border-b border-ui-border">
          {tabBtn("slide", t("show.hf.slideTab"))}
          {tabBtn("notes", t("show.hf.notesTab"))}
        </div>
        {tab === "slide" ? (
          <div role="tabpanel" className="flex flex-col gap-2">
            <span className="font-medium">{t("show.hf.include")}</span>
            <Check label={t("show.hf.dateTime")} checked={v.dateOn} onChange={(x) => set("dateOn", x)}>
              <label className="flex items-center gap-2">
                <input type="radio" name="hf-date" disabled={!v.dateOn} checked={v.auto} onChange={() => set("auto", true)} />
                {t("show.hf.auto")}
              </label>
              <DateFormatSelect label={t("show.hf.format")} value={v.format} disabled={!v.dateOn || !v.auto} onChange={(n) => set("format", n)} />
              <label className="flex items-center gap-2">
                <input type="radio" name="hf-date" disabled={!v.dateOn} checked={!v.auto} onChange={() => set("auto", false)} />
                {t("show.hf.fixed")}
              </label>
              <input aria-label={t("show.hf.fixedText")} className={INPUT} disabled={!v.dateOn || v.auto} value={v.fixed} onChange={(e) => set("fixed", e.currentTarget.value)} />
            </Check>
            <Check label={t("show.hf.slideNumber")} checked={v.slideNumber} onChange={(x) => set("slideNumber", x)} />
            <Check label={t("show.hf.footer")} checked={v.footerOn} onChange={(x) => set("footerOn", x)}>
              <input aria-label={t("show.hf.footerText")} className={INPUT} disabled={!v.footerOn} value={v.footer} onChange={(e) => set("footer", e.currentTarget.value)} />
            </Check>
            <Check label={t("show.hf.notOnTitle")} checked={v.notOnTitle} onChange={(x) => set("notOnTitle", x)} />
          </div>
        ) : (
          <div role="tabpanel" className="flex flex-col gap-2">
            <span className="font-medium">{t("show.hf.includePages")}</span>
            <Check label={t("show.hf.dateTime")} checked={notes.date !== "off"} onChange={(x) => setN("date", x ? 1 : "off")}>
              <DateFormatSelect label={t("show.hf.format")} value={notes.date === "off" ? 1 : notes.date} disabled={notes.date === "off"} onChange={(n) => setN("date", n)} />
            </Check>
            <Check label={t("show.hf.header")} checked={notes.header !== null} onChange={(x) => setN("header", x ? "" : null)}>
              <input aria-label={t("show.hf.headerText")} className={INPUT} disabled={notes.header === null} value={notes.header ?? ""} onChange={(e) => setN("header", e.currentTarget.value)} />
            </Check>
            <Check label={t("show.hf.pageNumber")} checked={notes.pageNumber} onChange={(x) => setN("pageNumber", x)} />
            <Check label={t("show.hf.footer")} checked={notes.footer !== null} onChange={(x) => setN("footer", x ? "" : null)}>
              <input aria-label={t("show.hf.footerText")} className={INPUT} disabled={notes.footer === null} value={notes.footer ?? ""} onChange={(e) => setN("footer", e.currentTarget.value)} />
            </Check>
            <p className="text-xs text-ui-muted">{t("show.hf.notesHint")}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {tab === "slide" && (
            <button type="button" className={BUTTON} onClick={() => apply(false)}>
              {t("show.hf.apply")}
            </button>
          )}
          <button type="button" className={BUTTON} onClick={() => apply(true)}>
            {t("show.applyAll")}
          </button>
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const EMU_PER_CM = 360000;

/** Design › Slide Size › Custom Slide Size…: width and height in cm (the slide shapes stay as they are). */
export function SlideSizeDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const [w, setW] = useState(() => (pres?.slideSize.width ?? 12192000) / EMU_PER_CM);
  const [h, setH] = useState(() => (pres?.slideSize.height ?? 6858000) / EMU_PER_CM);
  const close = () => store.closeDialog();
  const ok = w >= 2.54 && w <= 142.24 && h >= 2.54 && h <= 142.24;
  const num = (label: string, value: number, on: (v: number) => void) => (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" aria-label={label} className={`${INPUT} w-24`} step={0.01} min={2.54} max={142.24} value={Number(value.toFixed(2))} onChange={(e) => Number.isFinite(e.currentTarget.valueAsNumber) && on(e.currentTarget.valueAsNumber)} />
        cm
      </span>
    </label>
  );
  return (
    <Dialog open title={t("show.size.customTitle")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          close();
          void store.setSlideSize({ width: Math.round(w * EMU_PER_CM), height: Math.round(h * EMU_PER_CM) });
        }}
      >
        {num(t("show.size.width"), w, setW)}
        {num(t("show.size.height"), h, setH)}
        <p className="text-xs text-ui-muted">{t("show.size.hint", { min: formatNumber(2.54), max: formatNumber(142.24) })}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={!ok}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Rename Section (also right after Add Section, like PowerPoint). */
export function RenameSectionDialog({ store, index }: { store: ShowStore; index: number }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const [name, setName] = useState(() => pres?.sections?.[index]?.name ?? "");
  const close = () => store.closeDialog();
  return (
    <Dialog open title={t("show.section.renameTitle")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.renameSection(index, name);
        }}
      >
        <label className="flex flex-col gap-1">
          <span>{t("show.section.name")}</span>
          <input aria-label={t("show.section.name")} className={INPUT} value={name} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={!name.trim()}>
            {t("show.section.rename")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
