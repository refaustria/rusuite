// Dialogs of P8-28: Grid and Guides (View, the slide menu: snap objects to
// grid, grid spacing in fractions of a centimetre / inch, display grid,
// display drawing guides, smart guides) and Set Up Slide Show (Slide Show
// tab: loop continuously, without narration / animation, all slides or
// from … to …, advance manually or using timings).

import { useState } from "react";
import { Dialog, useLocale } from "@rusuite/ui-shared";
import { GRID_FRACTIONS, gridEmu, gridLabel, nearestGrid, rulerUnit } from "../canvas/guides";
import { DEFAULT_SHOW_SETTINGS, useShow, type ShowStore } from "../state/store";
import type { CustomShow } from "../generated/CustomShow";
import type { NodeId } from "../generated/NodeId";
import type { ShowSettings } from "../generated/ShowSettings";
import type { ShowType } from "../generated/ShowType";
import { slideTitle } from "../links/LinkDialogs";
import { useT } from "../i18n";

const BUTTON = "h-8 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover disabled:opacity-40";
const CHECK = "flex min-h-8 items-center gap-2";

export function GridGuidesDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const locale = useLocale();
  const unit = rulerUnit(locale);
  const v = store.viewProps();
  const [snap, setSnap] = useState(v.snapToGrid);
  const [spacing, setSpacing] = useState(() => {
    const f = nearestGrid(v.gridSpacing, unit);
    return Math.abs(gridEmu(f, unit) - v.gridSpacing) < 2 ? gridEmu(f, unit) : v.gridSpacing;
  });
  const [grid, setGrid] = useState(v.showGrid);
  const [guides, setGuides] = useState(v.showGuides);
  const [smart, setSmart] = useState(v.snapToShapes);
  const close = () => store.closeDialog();
  const choices = GRID_FRACTIONS.map((f) => ({ emu: gridEmu(f, unit), label: gridLabel(f, unit) }));
  const known = choices.some((c) => c.emu === spacing);
  return (
    <Dialog open title={t("show.gridDlg.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        data-testid="grid-guides-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          const showGuides = guides;
          void (async () => {
            if (showGuides && !v.showGuides) await store.toggleGuides(true);
            await store.updateView({ snapToGrid: snap, gridSpacing: spacing, showGrid: grid, showGuides, snapToShapes: smart });
          })();
        }}
      >
        <h3 className="font-semibold">{t("show.gridDlg.snap")}</h3>
        <label className={CHECK}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.currentTarget.checked)} />
          {t("show.gridDlg.snapToGrid")}
        </label>
        <h3 className="mt-1 font-semibold">{t("show.gridDlg.grid")}</h3>
        <label className="flex items-center justify-between gap-3">
          {t("show.gridDlg.spacing")}
          <select aria-label={t("show.gridDlg.spacing")} className="h-8 rounded border border-ui-border bg-ui-bg" value={String(spacing)} onChange={(e) => setSpacing(Number(e.currentTarget.value))} data-testid="grid-spacing">
            {!known && <option value={String(spacing)}>{t("show.gridDlg.custom")}</option>}
            {choices.map((c) => (
              <option key={c.emu} value={String(c.emu)}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={CHECK}>
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.currentTarget.checked)} />
          {t("show.gridDlg.displayGrid")}
        </label>
        <h3 className="mt-1 font-semibold">{t("show.gridDlg.guides")}</h3>
        <label className={CHECK}>
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.currentTarget.checked)} />
          {t("show.gridDlg.displayGuides")}
        </label>
        <label className={CHECK}>
          <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.currentTarget.checked)} />
          {t("show.gridDlg.smartGuides")}
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Set Up Slide Show (PowerPoint's dialog): show type, options with the pen colour, the slides (all, a range or a custom show), advance. */
export function SetUpShowDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = store.getState().pres;
  const s = pres?.showSettings ?? DEFAULT_SHOW_SETTINGS;
  const count = pres?.slides.length ?? 1;
  const shows = pres?.customShows ?? [];
  const [type, setType] = useState<ShowType>(s.showType ?? "speaker");
  const [scrollbar, setScrollbar] = useState(s.showScrollbar);
  const [loop, setLoop] = useState(s.loop);
  const [noNarration, setNoNarration] = useState(s.withoutNarration);
  const [noAnimation, setNoAnimation] = useState(s.withoutAnimation);
  const [pen, setPen] = useState(`#${s.penColor ?? "FF0000"}`);
  const [slides, setSlides] = useState<"all" | "range" | "custom">(s.customShow !== undefined && shows.some((c) => c.id === s.customShow) ? "custom" : s.range ? "range" : "all");
  const [from, setFrom] = useState(s.range?.start ?? 1);
  const [to, setTo] = useState(s.range?.end ?? count);
  const [custom, setCustom] = useState<number | null>(s.customShow ?? shows[0]?.id ?? null);
  const [timings, setTimings] = useState(s.useTimings);
  const close = () => store.closeDialog();
  const clamp = (v: number) => Math.max(1, Math.min(count, Math.round(v) || 1));
  const kiosk = type === "kiosk";
  return (
    <Dialog open title={t("show.setup.title")} onClose={close}>
      <form
        className="grid w-[34rem] grid-cols-2 gap-2 text-sm"
        data-testid="setup-show-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          const a = clamp(from);
          const b = Math.max(a, clamp(to));
          const penColor = pen.replace(/^#/, "").toUpperCase();
          const settings: ShowSettings = {
            loop: loop || kiosk,
            withoutNarration: noNarration,
            withoutAnimation: noAnimation,
            useTimings: timings || kiosk,
            showScrollbar: scrollbar,
            showMediaControls: s.showMediaControls ?? true,
            ...(type === "speaker" ? {} : { showType: type }),
            ...(slides === "range" ? { range: { start: a, end: b } } : {}),
            ...(slides === "custom" && custom !== null ? { customShow: custom } : {}),
            ...(penColor === "FF0000" ? {} : { penColor }),
          };
          void store.setShowSettings(settings);
        }}
      >
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.type")}</legend>
          {(["speaker", "window", "kiosk"] as const).map((k) => (
            <label key={k} className={CHECK}>
              <input type="radio" name="type" checked={type === k} onChange={() => setType(k)} />
              {t(`show.setup.type.${k}`)}
            </label>
          ))}
          <label className={`${CHECK} pl-5`}>
            <input type="checkbox" disabled={type !== "window"} checked={scrollbar} onChange={(e) => setScrollbar(e.currentTarget.checked)} />
            {t("show.setup.scrollbar")}
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.slides")}</legend>
          <label className={CHECK}>
            <input type="radio" name="range" checked={slides === "all"} onChange={() => setSlides("all")} />
            {t("show.setup.all")}
          </label>
          <div className="flex items-center gap-2">
            <label className={CHECK}>
              <input type="radio" name="range" checked={slides === "range"} onChange={() => setSlides("range")} />
              {t("show.setup.from")}
            </label>
            <input type="number" aria-label={t("show.setup.fromSlide")} className="h-8 w-14 rounded border border-ui-border bg-ui-bg px-1" min={1} max={count} value={from} onChange={(e) => { setSlides("range"); setFrom(e.currentTarget.valueAsNumber); }} />
            {t("show.setup.to")}
            <input type="number" aria-label={t("show.setup.toSlide")} className="h-8 w-14 rounded border border-ui-border bg-ui-bg px-1" min={1} max={count} value={to} onChange={(e) => { setSlides("range"); setTo(e.currentTarget.valueAsNumber); }} />
          </div>
          <label className={CHECK}>
            <input type="radio" name="range" disabled={!shows.length} checked={slides === "custom"} onChange={() => setSlides("custom")} />
            {t("show.setup.customShow")}
          </label>
          <select
            aria-label={t("show.setup.customShow")}
            className="h-8 rounded border border-ui-border bg-ui-bg px-1"
            disabled={!shows.length}
            value={custom ?? ""}
            onChange={(e) => {
              setSlides("custom");
              setCustom(Number(e.currentTarget.value));
            }}
          >
            {shows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.options")}</legend>
          <label className={CHECK}>
            <input type="checkbox" disabled={kiosk} checked={loop || kiosk} onChange={(e) => setLoop(e.currentTarget.checked)} />
            {t("show.setup.loop")}
          </label>
          <label className={CHECK}>
            <input type="checkbox" checked={noNarration} onChange={(e) => setNoNarration(e.currentTarget.checked)} />
            {t("show.setup.noNarration")}
          </label>
          <label className={CHECK}>
            <input type="checkbox" checked={noAnimation} onChange={(e) => setNoAnimation(e.currentTarget.checked)} />
            {t("show.setup.noAnimation")}
          </label>
          <label className={CHECK}>
            {t("show.setup.penColor")}
            <input type="color" aria-label={t("show.setup.penColor")} className="h-7 w-10" value={pen} onChange={(e) => setPen(e.currentTarget.value)} />
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.advance")}</legend>
          <label className={CHECK}>
            <input type="radio" name="advance" disabled={kiosk} checked={!timings && !kiosk} onChange={() => setTimings(false)} />
            {t("show.setup.manually")}
          </label>
          <label className={CHECK}>
            <input type="radio" name="advance" checked={timings || kiosk} onChange={() => setTimings(true)} />
            {t("show.setup.timings")}
          </label>
        </fieldset>
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Moves item `i` of `list` by `d` (−1 up, +1 down). */
export function moveItem<T>(list: readonly T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** A name for a new custom show not used yet ("Custom Show 1", 2 …). */
export function freshShowName(shows: readonly CustomShow[], base: string): string {
  const used = new Set(shows.map((c) => c.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** A free custom show id (the smallest not used). */
export function freshShowId(shows: readonly CustomShow[]): number {
  const used = new Set(shows.map((c) => c.id));
  let id = 0;
  while (used.has(id)) id++;
  return id;
}

/** Define Custom Show: the name, the presentation's slides on the left (several selectable), the show's slides on the right (Add, Remove, Up, Down). */
function DefineCustomShow({ store, show, others, onDone }: { store: ShowStore; show: CustomShow; others: readonly CustomShow[]; onDone: (show: CustomShow | null) => void }) {
  const t = useT();
  const slides = store.getState().pres?.slides ?? [];
  const [name, setName] = useState(show.name);
  const [list, setList] = useState<NodeId[]>(show.slideIds);
  const [picked, setPicked] = useState<NodeId[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const number = (id: NodeId) => slides.findIndex((s) => s.id === id) + 1;
  const label = (id: NodeId) => {
    const s = slides.find((x) => x.id === id);
    const title = s ? slideTitle(s) : "";
    return `${number(id)}. ${title || t("show.slideN", { n: number(id) })}`;
  };
  const taken = others.some((c) => c.id !== show.id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ok = name.trim() !== "" && !taken;
  return (
    <div className="flex flex-col gap-2" data-testid="define-custom-show">
      <label className="flex items-center gap-2">
        {t("show.custom.name")}
        <input className="h-8 flex-1 rounded border border-ui-border bg-ui-bg px-2" aria-label={t("show.custom.name")} autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      {taken && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{t("show.custom.nameTaken")}</p>}
      <div className="flex gap-2">
        <div className="flex w-56 flex-col gap-1">
          <span className="text-xs text-ui-muted">{t("show.custom.inPresentation")}</span>
          <ul role="listbox" aria-multiselectable="true" aria-label={t("show.custom.inPresentation")} className="h-56 overflow-y-auto rounded border border-ui-border">
            {slides.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 px-2 py-0.5 hover:bg-ui-hover">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                  <span className="truncate">{label(s.id)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-center gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={!picked.length}
            onClick={() => {
              // in presentation order, after the selected one (else at the end)
              const add = slides.filter((s) => picked.includes(s.id)).map((s) => s.id);
              const i = at === null ? list.length : at + 1;
              setList([...list.slice(0, i), ...add, ...list.slice(i)]);
              setPicked([]);
            }}
          >
            {t("show.custom.add")}
          </button>
        </div>
        <div className="flex w-56 flex-col gap-1">
          <span className="text-xs text-ui-muted">{t("show.custom.inShow")}</span>
          <ul role="listbox" aria-label={t("show.custom.inShow")} className="h-56 overflow-y-auto rounded border border-ui-border" data-testid="custom-show-slides">
            {list.map((id, i) => (
              <li key={`${i}:${id}`}>
                <button type="button" role="option" aria-selected={at === i} className={`w-full truncate px-2 py-0.5 text-left ${at === i ? "bg-ui-hover font-medium" : "hover:bg-ui-hover"}`} onClick={() => setAt(i)}>
                  {`${i + 1}. ${label(id).replace(/^\d+\. /, "")}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-center gap-1">
          <button type="button" className={BUTTON} aria-label={t("show.custom.up")} disabled={at === null || at === 0} onClick={() => { if (at !== null) { setList(moveItem(list, at, -1)); setAt(at - 1); } }}>↑</button>
          <button type="button" className={BUTTON} aria-label={t("show.custom.remove")} disabled={at === null} onClick={() => { if (at !== null) { setList(list.filter((_, i) => i !== at)); setAt(null); } }}>✕</button>
          <button type="button" className={BUTTON} aria-label={t("show.custom.down")} disabled={at === null || at >= list.length - 1} onClick={() => { if (at !== null) { setList(moveItem(list, at, 1)); setAt(at + 1); } }}>↓</button>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={() => onDone(null)}>
          {t("common.cancel")}
        </button>
        <button type="button" className={BUTTON} disabled={!ok} onClick={() => onDone({ id: show.id, name: name.trim(), slideIds: list })}>
          {t("common.ok")}
        </button>
      </div>
    </div>
  );
}

/** Slide Show › Custom Slide Show › Custom Shows…: the list with New, Edit, Remove, Copy and Show. */
export function CustomShowsDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const shows = pres?.customShows ?? [];
  const [sel, setSel] = useState<number | null>(shows[0]?.id ?? null);
  const [editing, setEditing] = useState<CustomShow | null>(null);
  const close = () => store.closeDialog();
  const current = shows.find((c) => c.id === sel) ?? null;
  return (
    <Dialog open title={editing ? t("show.custom.defineTitle") : t("show.custom.title")} onClose={close}>
      <div className="flex flex-col gap-2 text-sm" data-testid="custom-shows-dialog">
        {editing ? (
          <DefineCustomShow
            store={store}
            show={editing}
            others={shows}
            onDone={(show) => {
              setEditing(null);
              if (!show) return;
              const next = shows.some((c) => c.id === show.id) ? shows.map((c) => (c.id === show.id ? show : c)) : [...shows, show];
              setSel(show.id);
              void store.setCustomShows(next);
            }}
          />
        ) : (
          <div className="flex gap-2">
            <ul role="listbox" aria-label={t("show.custom.shows")} className="h-48 w-64 overflow-y-auto rounded border border-ui-border" data-testid="custom-show-list">
              {shows.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={sel === c.id} className={`w-full truncate px-2 py-1 text-left ${sel === c.id ? "bg-ui-hover font-medium" : "hover:bg-ui-hover"}`} onClick={() => setSel(c.id)} onDoubleClick={() => setEditing(c)}>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex w-28 flex-col gap-1">
              <button type="button" className={BUTTON} onClick={() => setEditing({ id: freshShowId(shows), name: freshShowName(shows, t("show.custom.defaultName")), slideIds: [] })}>
                {t("show.custom.new")}
              </button>
              <button type="button" className={BUTTON} disabled={!current} onClick={() => current && setEditing(current)}>
                {t("show.custom.edit")}
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={!current}
                onClick={() => {
                  if (!current) return;
                  const rest = shows.filter((c) => c.id !== current.id);
                  setSel(rest[0]?.id ?? null);
                  void store.setCustomShows(rest);
                }}
              >
                {t("show.custom.removeShow")}
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={!current}
                onClick={() => {
                  if (!current) return;
                  const copy: CustomShow = { id: freshShowId(shows), name: freshShowName(shows, t("show.custom.copyOf", { name: current.name })), slideIds: [...current.slideIds] };
                  setSel(copy.id);
                  void store.setCustomShows([...shows, copy]);
                }}
              >
                {t("show.custom.copy")}
              </button>
              <span className="flex-1" />
              <button
                type="button"
                className={BUTTON}
                disabled={!current?.slideIds.length}
                onClick={() => {
                  if (!current) return;
                  close();
                  store.requestShow({ customShow: current.id });
                }}
              >
                {t("show.custom.show")}
              </button>
              <button type="button" className={BUTTON} onClick={close}>
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
