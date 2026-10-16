// Dialogs of P8-28: Grid and Guides (View, the slide menu: snap objects to
// grid, grid spacing in fractions of a centimetre / inch, display grid,
// display drawing guides, smart guides) and Set Up Slide Show (Slide Show
// tab: loop continuously, without narration / animation, all slides or
// from … to …, advance manually or using timings).

import { useState } from "react";
import { Dialog, useLocale } from "@rusuite/ui-shared";
import { GRID_FRACTIONS, gridEmu, gridLabel, nearestGrid, rulerUnit } from "../canvas/guides";
import { DEFAULT_SHOW_SETTINGS, type ShowStore } from "../state/store";
import { useT } from "../i18n";

const BUTTON = "h-8 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover";
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

export function SetUpShowDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = store.getState().pres;
  const s = pres?.showSettings ?? DEFAULT_SHOW_SETTINGS;
  const count = pres?.slides.length ?? 1;
  const [loop, setLoop] = useState(s.loop);
  const [noNarration, setNoNarration] = useState(s.withoutNarration);
  const [noAnimation, setNoAnimation] = useState(s.withoutAnimation);
  const [all, setAll] = useState(!s.range);
  const [from, setFrom] = useState(s.range?.start ?? 1);
  const [to, setTo] = useState(s.range?.end ?? count);
  const [timings, setTimings] = useState(s.useTimings);
  const close = () => store.closeDialog();
  const clamp = (v: number) => Math.max(1, Math.min(count, Math.round(v) || 1));
  return (
    <Dialog open title={t("show.setup.title")} onClose={close}>
      <form
        className="flex w-96 flex-col gap-2 text-sm"
        data-testid="setup-show-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          const a = clamp(from);
          const b = Math.max(a, clamp(to));
          const settings = { loop, withoutNarration: noNarration, withoutAnimation: noAnimation, useTimings: timings, ...(all ? {} : { range: { start: a, end: b } }) };
          void store.setShowSettings(settings);
        }}
      >
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.options")}</legend>
          <label className={CHECK}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.currentTarget.checked)} />
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
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.slides")}</legend>
          <label className={CHECK}>
            <input type="radio" name="range" checked={all} onChange={() => setAll(true)} />
            {t("show.setup.all")}
          </label>
          <div className="flex items-center gap-2">
            <label className={CHECK}>
              <input type="radio" name="range" checked={!all} onChange={() => setAll(false)} />
              {t("show.setup.from")}
            </label>
            <input type="number" aria-label={t("show.setup.fromSlide")} className="h-8 w-16 rounded border border-ui-border bg-ui-bg px-1" min={1} max={count} value={from} onChange={(e) => { setAll(false); setFrom(e.currentTarget.valueAsNumber); }} />
            {t("show.setup.to")}
            <input type="number" aria-label={t("show.setup.toSlide")} className="h-8 w-16 rounded border border-ui-border bg-ui-bg px-1" min={1} max={count} value={to} onChange={(e) => { setAll(false); setTo(e.currentTarget.valueAsNumber); }} />
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 font-semibold">{t("show.setup.advance")}</legend>
          <label className={CHECK}>
            <input type="radio" name="advance" checked={!timings} onChange={() => setTimings(false)} />
            {t("show.setup.manually")}
          </label>
          <label className={CHECK}>
            <input type="radio" name="advance" checked={timings} onChange={() => setTimings(true)} />
            {t("show.setup.timings")}
          </label>
        </fieldset>
        <p className="text-xs text-ui-muted">{t("show.setup.customNote")}</p>
        <div className="flex justify-end gap-2">
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
