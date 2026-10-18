// The name dialogs (P8-23): Name Manager (list with value, refers to,
// scope and comment; New / Edit / Delete; Filter; refers-to edited in
// place with the range picker), New / Edit Name, Create Names from
// Selection and Go To.

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { NameEdges } from "../generated/NameEdges";
import type { NameRow } from "../generated/NameRow";
import { normalize } from "../grid/Selection";
import { PickBar, RangeField, type Picker } from "../charts/ChartDialogs";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { guessEdges } from "./controller";
import { filterNames, nameProblem, type NameFilter } from "./names";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

function close(store: CalcStore): void {
  store.closeDialog();
  store.focusGrid();
}

/** The scope label of a name: the sheet's name, or "Workbook". */
export function scopeLabel(store: CalcStore, sheet: number | undefined, workbook: string): string {
  if (sheet === undefined) return workbook;
  return store.getState().info?.sheets.find((s) => s.id === sheet)?.name ?? workbook;
}

export function NameManagerDialog({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const names = useCalc(store, (s) => s.info?.names);
  const [filter, setFilter] = useState<NameFilter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [refers, setRefers] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  useEffect(() => {
    void store.names.loadRows();
  }, [store, names]);
  const rows = filterNames(store.names.rows, filter);
  const key = (r: NameRow) => `${r.sheet ?? ""}|${r.name}`;
  const current = rows.find((r) => key(r) === picked) ?? null;
  useEffect(() => setRefers(null), [picked]);
  const workbook = t("calc.names.workbook");

  const commitRefers = async () => {
    if (!current || refers === null || refers === `=${current.refersTo}`) return;
    const ok = await store.names.update(current.name, current.sheet, { ...stripRow(current), refersTo: refers.replace(/^=/, "") });
    if (ok) setRefers(null);
  };

  if (picker) {
    return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  }
  return (
    <Dialog open title={t("calc.names.manager")} onClose={() => close(store)}>
      <div className="flex w-[44rem] flex-col gap-2 text-sm" data-testid="name-manager">
        <div className="flex items-center gap-2">
          <button type="button" className={BTN} onClick={() => store.openDialog({ kind: "defineName", back: true })}>
            {t("calc.names.new")}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!current}
            onClick={() => current && store.openDialog({ kind: "defineName", edit: { name: current.name, ...(current.sheet === undefined ? {} : { sheet: current.sheet }) }, back: true })}
          >
            {t("calc.names.edit")}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={!current}
            onClick={() => {
              if (current) void store.names.remove(current.name, current.sheet).then(() => setPicked(null));
            }}
          >
            {t("cmd.delete")}
          </button>
          <span className="flex-1" />
          <label className="flex items-center gap-1">
            <span className="text-xs">{t("calc.names.filter")}</span>
            <select className={FIELD} aria-label={t("calc.names.filter")} value={filter} onChange={(e) => setFilter(e.target.value as NameFilter)}>
              <option value="all">{t("calc.names.filter.all")}</option>
              <option value="workbook">{t("calc.names.filter.workbook")}</option>
              <option value="sheet">{t("calc.names.filter.sheet")}</option>
              <option value="errors">{t("calc.names.filter.errors")}</option>
              <option value="noErrors">{t("calc.names.filter.noErrors")}</option>
              <option value="defined">{t("calc.names.filter.defined")}</option>
            </select>
          </label>
        </div>
        <div className="max-h-72 overflow-auto rounded border border-ui-border bg-ui-bg">
          <table className="w-full border-collapse text-left text-xs" aria-label={t("calc.names.list")}>
            <thead className="sticky top-0 bg-ui-panel">
              <tr>
                <th className="px-2 py-1">{t("calc.names.name")}</th>
                <th className="px-2 py-1">{t("calc.names.value")}</th>
                <th className="px-2 py-1">{t("calc.names.refersTo")}</th>
                <th className="px-2 py-1">{t("calc.names.scope")}</th>
                <th className="px-2 py-1">{t("calc.names.comment")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={key(r)}
                  aria-selected={key(r) === picked}
                  data-testid="name-row"
                  className={`cursor-default ${key(r) === picked ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                  onClick={() => setPicked(key(r))}
                  onDoubleClick={() => store.openDialog({ kind: "defineName", edit: { name: r.name, ...(r.sheet === undefined ? {} : { sheet: r.sheet }) }, back: true })}
                >
                  <td className="px-2 py-0.5 font-mono">{r.name}</td>
                  <td className="max-w-40 truncate px-2 py-0.5 font-mono" title={r.value}>
                    {r.value}
                  </td>
                  <td className="max-w-48 truncate px-2 py-0.5 font-mono" title={`=${r.refersTo}`}>
                    ={r.refersTo}
                  </td>
                  <td className="px-2 py-0.5">{scopeLabel(store, r.sheet, workbook)}</td>
                  <td className="max-w-40 truncate px-2 py-0.5">{r.comment ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-ui-muted">
                    {t("calc.names.none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <RangeField
              label={t("calc.names.refersTo")}
              testId="manager-refers-to"
              value={refers ?? (current ? `=${current.refersTo}` : "")}
              onChange={(v) => setRefers(v)}
              onPick={(p) => setPicker({ ...p, set: (v) => setRefers(v) })}
            />
          </div>
          <button type="button" className={BTN} aria-label={t("calc.names.applyRefersTo")} title={t("calc.names.applyRefersTo")} disabled={!current || refers === null} onClick={() => void commitRefers()}>
            ✓
          </button>
          <button type="button" className={BTN} aria-label={t("calc.names.cancelRefersTo")} title={t("calc.names.cancelRefersTo")} disabled={refers === null} onClick={() => setRefers(null)}>
            ✕
          </button>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              void commitRefers().then(() => close(store));
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function stripRow(r: NameRow) {
  return {
    name: r.name,
    refersTo: r.refersTo,
    ...(r.sheet === undefined ? {} : { sheet: r.sheet }),
    ...(r.comment ? { comment: r.comment } : {}),
    ...(r.hidden ? { hidden: true } : {}),
    ...(r.builtin ? { builtin: r.builtin } : {}),
  };
}

/** New Name / Edit Name. */
export function DefineNameDialog({ store, edit, back }: { store: CalcStore; edit?: { name: string; sheet?: number }; back?: boolean }) {
  const t = useT();
  const existing = edit ? store.names.list().find((n) => n.sheet === edit.sheet && n.name.toLowerCase() === edit.name.toLowerCase()) : undefined;
  const st = store.getState();
  const [name, setName] = useState(existing?.name ?? suggestedName(store));
  const [scope, setScope] = useState<number | undefined>(existing ? existing.sheet : undefined);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [refers, setRefers] = useState(existing ? `=${existing.refersTo}` : store.names.selectionRefersTo());
  const [picker, setPicker] = useState<Picker | null>(null);
  const sheets = st.info?.sheets ?? [];
  const problem = nameProblem(name.trim());
  const duplicate = !problem && store.names.exists(name.trim(), scope, edit && { name: edit.name, sheet: edit.sheet });
  const message = problem ? t(problem) : duplicate ? t("calc.names.err.duplicate") : null;
  const finish = () => {
    if (back) store.openDialog({ kind: "nameManager" });
    else close(store);
  };
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  return (
    <Dialog open title={edit ? t("calc.names.editTitle") : t("calc.names.newTitle")} onClose={finish}>
      <form
        className="flex w-[26rem] flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (message || refers.trim() === "" || refers.trim() === "=") return;
          const def = {
            name: name.trim(),
            refersTo: refers.trim().replace(/^=/, ""),
            ...(scope === undefined ? {} : { sheet: scope }),
            ...(comment.trim() ? { comment: comment.trim() } : {}),
            ...(existing?.hidden ? { hidden: true } : {}),
            ...(existing?.builtin ? { builtin: existing.builtin } : {}),
          };
          const done = edit ? store.names.update(edit.name, edit.sheet, def) : store.names.define(def);
          void done.then((ok) => ok && finish());
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.names.name")}</span>
          <input className={FIELD} aria-label={t("calc.names.name")} aria-invalid={!!message} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {message && (
          <p role="alert" className="text-xs text-red-600">
            {message}
          </p>
        )}
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.names.scope")}</span>
          <select className={FIELD} aria-label={t("calc.names.scope")} value={scope === undefined ? "" : String(scope)} onChange={(e) => setScope(e.target.value === "" ? undefined : Number(e.target.value))}>
            <option value="">{t("calc.names.workbook")}</option>
            {sheets.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.names.comment")}</span>
          <textarea className="h-14 rounded border border-ui-border bg-ui-bg px-2 py-1 text-sm" aria-label={t("calc.names.comment")} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <RangeField label={t("calc.names.refersTo")} testId="name-refers-to" value={refers} onChange={setRefers} onPick={(p) => setPicker({ ...p, set: setRefers })} />
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={finish}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={!!message}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Excel's New Name default: the text of the active cell, or of the cell left of / above it. */
export function suggestedName(store: CalcStore): string {
  const st = store.getState();
  const cache = store.cache(st.activeSheet);
  const a = store.activeAnchor();
  const text = (row: number, col: number) => {
    const c = cache.cells.get(row)?.get(col);
    return c?.kind === "text" ? c.display.trim().replace(/\s+/g, "_") : "";
  };
  for (const s of [text(a.row, a.col), a.col > 0 ? text(a.row, a.col - 1) : "", a.row > 0 ? text(a.row - 1, a.col) : ""]) {
    if (s && !nameProblem(s)) return s;
  }
  return "";
}

/** Create Names from Selection. */
export function CreateNamesDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const initial = useMemo(() => {
    const st = store.getState();
    const cache = store.cache(st.activeSheet);
    return guessEdges((r, c) => cache.cells.get(r)?.get(c), normalize(st.selection));
  }, [store]);
  const [edges, setEdges] = useState<NameEdges>(initial);
  const none = !edges.top && !edges.left && !edges.bottom && !edges.right;
  const box = (k: keyof NameEdges, label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={edges[k]} onChange={(e) => setEdges({ ...edges, [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <Dialog open title={t("calc.names.createTitle")} onClose={() => close(store)}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (none) return;
          void store.names.createFromSelection(edges).then((ok) => ok && close(store));
        }}
      >
        <p className="text-xs">{t("calc.names.createIn")}</p>
        {box("top", t("calc.names.topRow"))}
        {box("left", t("calc.names.leftCol"))}
        {box("bottom", t("calc.names.bottomRow"))}
        {box("right", t("calc.names.rightCol"))}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={() => close(store)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={none}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Go To (Ctrl+G / F5): a list of names, a reference field. */
export function GoToDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const names = store.names.boxNames();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const go = (v: string) => {
    if (store.names.goTo(v)) close(store);
    else setBad(true);
  };
  return (
    <Dialog open title={t("calc.goTo.title")} onClose={() => close(store)}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          go(text);
        }}
      >
        <div role="listbox" aria-label={t("calc.goTo.list")} className="flex h-40 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
          {names.map((n) => (
            <button
              key={`${n.sheet ?? ""}:${n.name}`}
              type="button"
              role="option"
              aria-selected={text === n.name}
              className={`px-2 py-0.5 text-left font-mono ${text === n.name ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => setText(n.name)}
              onDoubleClick={() => go(n.name)}
            >
              {n.name}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.goTo.reference")}</span>
          <input
            className={FIELD}
            aria-label={t("calc.goTo.reference")}
            aria-invalid={bad}
            value={text}
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              setBad(false);
            }}
          />
        </label>
        {bad && (
          <p role="alert" className="text-xs text-red-600">
            {t("calc.goTo.invalid")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={`${BTN} mr-auto`} onClick={() => store.openDialog({ kind: "goToSpecial" })}>
            {t("calc.goToSpecial.button")}
          </button>
          <button type="button" className={BTN} onClick={() => close(store)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN} disabled={text.trim() === ""}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
