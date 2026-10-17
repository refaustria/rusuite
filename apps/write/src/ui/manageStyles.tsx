// Word's Manage Styles dialog (Styles pane › Manage Styles): Edit (the
// styles sorted alphabetically / as recommended / by font / by type, shown
// recommended / in use / all; Modify…, Delete, New Style…), Recommend
// (Show, Hide until used, Hide, Assign value: `uiPriority`) and Set
// Defaults (font, size and paragraph spacing of the document defaults:
// `SetStyleDefaults` → docx `w:docDefaults`).

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog, FONT_FAMILIES, FONT_SIZES } from "@rusuite/ui-shared";
import type { FontFace } from "../../../../packages/ui-shared/src/generated/FontFace";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { LineSpacing } from "../generated/LineSpacing";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { Style } from "../generated/Style";
import type { StyleSheet } from "../generated/StyleSheet";
import type { WriteCommand } from "../generated/WriteCommand";
import { fontName } from "../features/fontBox";
import {
  applicable, defaultStyle, headingShown, isLinkedHalf, isParagraphKind, previewStyle, priorityOf, resolveCharacter, resolveRun,
  styleLabel, stylesInUse, type StyleFilter,
} from "../features/styleCss";
import type { WriteFeatures } from "../features/WriteFeatures";
import type { SyncController } from "../sync/SyncPlugin";
import { useT } from "../i18n";
import { BUTTON, INPUT } from "./dialogs";

export type StyleSort = "alphabetical" | "recommended" | "font" | "basedOn" | "type";
export const STYLE_SORTS: StyleSort[] = ["alphabetical", "recommended", "font", "basedOn", "type"];

/** The font a style shows in (its resolved font; theme fonts by name). */
export function styleFont(sheet: StyleSheet | null | undefined, s: Style): string {
  const r = isParagraphKind(s.kind) ? resolveRun(sheet, s.id) : { ...resolveRun(sheet, defaultStyle(sheet, "paragraph")?.id ?? "Normal"), ...resolveCharacter(sheet, s.id) };
  return fontName(r.font) ?? "Calibri";
}

/**
 * The Edit tab's list: the applicable styles (the character halves of linked styles left out), filtered like the
 * Styles pane (Recommended / In use / All – All includes hidden styles, as in Word) and sorted.
 */
export function manageStylesList(sheet: StyleSheet | null | undefined, filter: StyleFilter, sort: StyleSort, inUse: Map<string, number>): Style[] {
  if (!sheet) return [];
  let list = sheet.styles.filter((s) => applicable(s) && !isLinkedHalf(sheet, s));
  if (filter === "inUse") list = list.filter((s) => inUse.has(s.id));
  else if (filter === "recommended") {
    list = list.filter((s) => !s.hidden && (inUse.has(s.id) || ((!s.semiHidden || s.custom) && (priorityOf(s) < 99 || s.custom || s.quickFormat) && headingShown(s, inUse))));
  }
  const name = (a: Style, b: Style) => styleLabel(a).localeCompare(styleLabel(b));
  const order = (a: Style, b: Style) => sheet.styles.indexOf(a) - sheet.styles.indexOf(b);
  const kindRank = (s: Style) => ({ paragraph: 0, linked: 1, character: 2, table: 3, numbering: 4 })[s.kind] ?? 5;
  const cmp: Record<StyleSort, (a: Style, b: Style) => number> = {
    alphabetical: name,
    recommended: (a, b) => priorityOf(a) - priorityOf(b) || order(a, b),
    font: (a, b) => styleFont(sheet, a).localeCompare(styleFont(sheet, b)) || name(a, b),
    basedOn: (a, b) => (a.basedOn ?? "").localeCompare(b.basedOn ?? "") || name(a, b),
    type: (a, b) => kindRank(a) - kindRank(b) || name(a, b),
  };
  return [...list].sort(cmp[sort]);
}

/** Word's Recommend tab states. */
export type Visibility = "show" | "hideUntilUsed" | "hide";

export function visibilityOf(s: Style): Visibility {
  return s.hidden ? "hide" : s.semiHidden ? "hideUntilUsed" : "show";
}

/** `UpdateStyle` for a Recommend tab button. */
export function visibilityCommand(id: string, v: Visibility): WriteCommand {
  const patch = v === "show" ? { hidden: false, semiHidden: false } : v === "hide" ? { hidden: true } : { hidden: false, semiHidden: true };
  return { type: "updateStyle", id, patch };
}

/** `UpdateStyle` assigning a sort priority (Word's "Assign value": `w:uiPriority`, 0–99). */
export function priorityCommand(id: string, value: number): WriteCommand | null {
  if (!Number.isFinite(value) || value < 0 || value > 99) return null;
  return { type: "updateStyle", id, patch: { priority: Math.round(value) } };
}

/** What the Set Defaults tab edits. */
export interface DefaultsForm {
  font: string;
  size: string;
  before: string;
  after: string;
  line: string;
}

const ptOf = (tw: number | null | undefined) => (tw == null ? "0" : String(Math.round((tw / 20) * 10) / 10));
const lineOf = (l: LineSpacing | null | undefined) => (l?.kind === "multiple" ? String(Math.round(l.value * 100) / 100) : "1");

export function defaultsForm(sheet: StyleSheet | null | undefined): DefaultsForm {
  const r = sheet?.defaults.run ?? {};
  const sp = sheet?.defaults.paragraph?.spacing;
  return {
    font: r.font?.kind === "named" ? r.font.value : r.font?.kind === "theme" ? (r.font.value === "majorLatin" ? "+major" : "+minor") : "+minor",
    size: r.size != null ? String(r.size / 100) : "10",
    before: ptOf(sp?.before),
    after: ptOf(sp?.after),
    line: lineOf(sp?.line),
  };
}

const num = (s: string): number | null => {
  const v = Number(s.trim().replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/** `SetStyleDefaults` for the changed fields of the Set Defaults tab, or null. */
export function setDefaultsCommand(before: DefaultsForm, after: DefaultsForm): WriteCommand | null {
  const run: RunProperties = {};
  if (after.font !== before.font) {
    run.font = (after.font === "+major" ? { kind: "theme", value: "majorLatin" } : after.font === "+minor" ? { kind: "theme", value: "minorLatin" } : { kind: "named", value: after.font }) as FontFace;
  }
  const size = num(after.size);
  if (after.size !== before.size && size != null && size >= 1 && size <= 1638) run.size = Math.round(size * 100);
  const spacing: NonNullable<ParagraphProperties["spacing"]> = {};
  const b = num(after.before);
  const a = num(after.after);
  const l = num(after.line);
  if (after.before !== before.before && b != null && b >= 0) spacing.before = Math.round(b * 20);
  if (after.after !== before.after && a != null && a >= 0) spacing.after = Math.round(a * 20);
  if (after.line !== before.line && l != null && l > 0) spacing.line = { kind: "multiple", value: l };
  const cmd: Extract<WriteCommand, { type: "setStyleDefaults" }> = { type: "setStyleDefaults" };
  if (Object.keys(run).length) cmd.run = run;
  if (Object.keys(spacing).length) cmd.paragraph = { spacing };
  return cmd.run || cmd.paragraph ? cmd : null;
}

type Tab = "edit" | "recommend" | "defaults";

export function ManageStylesDialog({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = features.ui;
  const open = useSyncExternalStore(ui.subscribe, () => ui.getState().dialog === "manageStyles");
  const sheet = useSyncExternalStore(ctl.subscribe, () => ctl.styles);
  const [tab, setTab] = useState<Tab>("edit");
  const [sort, setSort] = useState<StyleSort>("recommended");
  const [filter, setFilter] = useState<StyleFilter>("recommended");
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<DefaultsForm>(() => defaultsForm(sheet));
  const [priority, setPriority] = useState("");
  const inUse = useMemo(() => (open ? stylesInUse(editor.state.doc, sheet) : new Map<string, number>()), [open, editor, sheet]);
  const list = useMemo(() => manageStylesList(sheet, tab === "edit" ? filter : "all", tab === "edit" ? sort : "recommended", inUse), [sheet, filter, sort, tab, inUse]);
  useEffect(() => {
    if (!open) return;
    setTab("edit");
    setForm(defaultsForm(ctl.styles));
    setSelected(null);
  }, [open, ctl]);
  const sel = list.find((s) => s.id === selected) ?? list[0] ?? null;
  useEffect(() => setPriority(sel?.priority != null ? String(sel.priority) : ""), [sel?.id, sel?.priority]);
  const close = () => ui.openDialog(null);
  const run = (cmd: WriteCommand | null) => {
    if (cmd) void ctl.run(cmd);
  };
  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`h-7 rounded border px-2 text-sm ${tab === id ? "border-ui-focus bg-ui-active" : "border-ui-border bg-ui-bg hover:bg-ui-hover"}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );
  const visLabel = (s: Style) => (visibilityOf(s) === "show" ? "" : ` (${t(`write.manage.vis.${visibilityOf(s)}`)})`);
  return (
    <Dialog open={open} title={t("write.manage.title")} onClose={close}>
      <div className="flex w-[30rem] max-w-full flex-col gap-2 text-sm" data-testid="manage-styles">
        <div role="tablist" className="flex gap-1">
          {tabBtn("edit", t("write.manage.tab.edit"))}
          {tabBtn("recommend", t("write.manage.tab.recommend"))}
          {tabBtn("defaults", t("write.manage.tab.defaults"))}
        </div>
        {tab !== "defaults" && (
          <>
            {tab === "edit" && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  {t("write.manage.sort")}
                  <select aria-label={t("write.manage.sort")} className={`${INPUT} w-40`} value={sort} onChange={(e) => setSort(e.target.value as StyleSort)}>
                    {STYLE_SORTS.map((x) => (
                      <option key={x} value={x}>
                        {t(`write.manage.sort.${x}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  {t("write.styles.show")}
                  <select aria-label={t("write.styles.show")} className={`${INPUT} w-36`} value={filter} onChange={(e) => setFilter(e.target.value as StyleFilter)}>
                    <option value="recommended">{t("write.styles.filter.recommended")}</option>
                    <option value="inUse">{t("write.styles.filter.inUse")}</option>
                    <option value="all">{t("write.styles.filter.all")}</option>
                  </select>
                </label>
              </div>
            )}
            <div className="h-56 overflow-auto rounded border border-ui-border bg-ui-bg p-1" role="listbox" aria-label={t("write.manage.list")}>
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={sel?.id === s.id}
                  data-style-id={s.id}
                  className={`flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left ${sel?.id === s.id ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                  onClick={() => setSelected(s.id)}
                  onDoubleClick={() => {
                    if (tab !== "edit") return;
                    close();
                    ui.set({ styleDialog: { mode: "modify", id: s.id } });
                  }}
                >
                  <span className="truncate" style={tab === "edit" ? previewStyle(sheet, s, 12) : undefined}>
                    {tab === "recommend" ? `${s.priority ?? 99} ` : ""}
                    {styleLabel(s)}
                    {visLabel(s)}
                  </span>
                  {tab === "edit" && sort === "font" && <span className="shrink-0 text-xs text-ui-muted">{styleFont(sheet, s)}</span>}
                </button>
              ))}
            </div>
            {tab === "edit" ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  disabled={!sel}
                  onClick={() => {
                    if (!sel) return;
                    close();
                    ui.set({ styleDialog: { mode: "modify", id: sel.id } });
                  }}
                >
                  {t("write.styles.modifyDots")}
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={!sel || !sel.custom}
                  onClick={() => {
                    if (!sel) return;
                    close();
                    ui.set({ styleDialog: { mode: "delete", id: sel.id } });
                  }}
                >
                  {t("write.manage.delete")}
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    close();
                    ui.set({ styleDialog: { mode: "new", basedOn: sel && isParagraphKind(sel.kind) ? sel.id : "Normal" } });
                  }}
                >
                  {t("write.styles.newStyle")}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {(["show", "hideUntilUsed", "hide"] as Visibility[]).map((v) => (
                  <button key={v} type="button" className={BUTTON} disabled={!sel} aria-pressed={!!sel && visibilityOf(sel) === v} onClick={() => sel && run(visibilityCommand(sel.id, v))}>
                    {t(`write.manage.vis.${v}`)}
                  </button>
                ))}
                <label className="flex items-center gap-1">
                  {t("write.manage.priority")}
                  <input aria-label={t("write.manage.priority")} className={`${INPUT} w-14`} value={priority} onChange={(e) => setPriority(e.target.value)} />
                </label>
                <button type="button" className={BUTTON} disabled={!sel} onClick={() => sel && run(priorityCommand(sel.id, Number(priority)))}>
                  {t("write.manage.assign")}
                </button>
              </div>
            )}
          </>
        )}
        {tab === "defaults" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(setDefaultsCommand(defaultsForm(sheet), form));
              close();
            }}
          >
            <label className="flex items-center justify-between gap-2">
              {t("write.styles.font")}
              <select aria-label={t("write.styles.font")} className={`${INPUT} w-48`} value={form.font} onChange={(e) => setForm({ ...form, font: e.target.value })}>
                <option value="+minor">{t("write.styles.bodyFont")}</option>
                <option value="+major">{t("write.styles.headingsFont")}</option>
                {(FONT_FAMILIES.includes(form.font) || form.font.startsWith("+") ? FONT_FAMILIES : [form.font, ...FONT_FAMILIES]).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2">
              {t("write.styles.sizePt")}
              <input aria-label={t("write.styles.sizePt")} className={INPUT} list="manage-sizes" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
            </label>
            <datalist id="manage-sizes">
              {FONT_SIZES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <label className="flex items-center justify-between gap-2">
              {t("write.styles.spaceBeforePt")}
              <input aria-label={t("write.styles.spaceBeforePt")} className={INPUT} value={form.before} onChange={(e) => setForm({ ...form, before: e.target.value })} />
            </label>
            <label className="flex items-center justify-between gap-2">
              {t("write.styles.spaceAfterPt")}
              <input aria-label={t("write.styles.spaceAfterPt")} className={INPUT} value={form.after} onChange={(e) => setForm({ ...form, after: e.target.value })} />
            </label>
            <label className="flex items-center justify-between gap-2">
              {t("write.manage.lineMultiple")}
              <input aria-label={t("write.manage.lineMultiple")} className={INPUT} value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} />
            </label>
            <p className="text-xs text-ui-muted">{t("write.manage.defaultsHint")}</p>
            <div className="flex justify-end gap-2">
              <button type="submit" className={BUTTON}>
                {t("common.ok")}
              </button>
              <button type="button" className={BUTTON} onClick={close}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
        {tab !== "defaults" && (
          <div className="flex justify-end">
            <button type="button" className={BUTTON} onClick={close}>
              {t("common.close")}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
