// Calc's chart state (P8-20): the chart lists and resolved data per sheet
// (from snapshots, `sheetCharts` and `chartData`, refreshed when a patch
// lists the sheet in `chartSheets`, debounced like conditional
// formatting), the selected chart and element, drag previews, the chart
// clipboard, laid-out scenes and the chart commands. It lives on the store
// (`store.charts`) and redraws through the store's version.

import {
  approxTextWidth, basicFormat, CHART_FONT, formatGeneral, layoutChart, sameElement, type ChartElement, type ChartLabels, type ChartScene,
} from "@rusuite/ui-shared";
import type { Chart } from "../generated/Chart";
import type { ChartAnchor } from "../generated/ChartAnchor";
import type { ChartObject } from "../generated/ChartObject";
import type { DataRef } from "../generated/DataRef";
import type { ResolvedChart } from "../generated/ResolvedChart";
import type { Series } from "../generated/Series";
import type { CalcCommand } from "../generated/CalcCommand";
import { normalize } from "../grid/Selection";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";
import { anchorRect, insertRect, rectToAnchor, type PxRect } from "./anchor";
import { applyPreset, canon, presetById } from "./presets";
import { switchRowCol } from "./refs";

export interface ChartSelection {
  sheet: number;
  id: number;
  /** The selected chart element (`null`: the whole chart). */
  element: ChartElement | null;
}

/** A chart as the grid draws it: sheet px rectangle and its scene (`null` while the data loads). */
export interface ChartFrame {
  obj: ChartObject;
  rect: PxRect;
  scene: ChartScene | null;
}

/** An empty clustered column chart (Insert without numbers in the selection, as Excel). */
export function emptyChart(): Chart {
  return { kind: { type: "bar", direction: "column", grouping: "clustered" }, series: [], axes: { cat: {}, val: { majorGridlines: true } }, gapWidth: 219, overlap: -27 };
}

const key = (sheet: number, id: number) => `${sheet}:${id}`;

/** The renderer's texts in the UI language. */
export function chartLabels(): ChartLabels {
  return {
    chartTitle: t("calc.chart.chartTitle"),
    axisTitle: t("calc.chart.axisTitle"),
    unsupported: t("calc.chart.unsupported"),
    trendLinear: t("calc.chart.trend.linearName"),
    trendExponential: t("calc.chart.trend.exponentialName"),
    trendLogarithmic: t("calc.chart.trend.logarithmicName"),
    trendPower: t("calc.chart.trend.powerName"),
    trendPolynomial: t("calc.chart.trend.polynomialName"),
    trendMovingAverage: t("calc.chart.trend.movingAverageName"),
  };
}

export class ChartController {
  private lists = new Map<number, ChartObject[]>();
  private data = new Map<string, ResolvedChart>();
  /** The chart definition (canonical JSON) the cached data was resolved for. */
  private dataFor = new Map<string, string>();
  private stale = new Set<string>();
  private fetching = new Set<string>();
  private listFetching = new Map<number, Promise<ChartObject[]>>();
  private pending = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scenes = new Map<string, { obj: ChartObject; data: ResolvedChart; w: number; h: number; fv: number; lk: string; scene: ChartScene }>();
  private fmtCache = new Map<string, string>();
  private fmtQueue = new Map<string, { value: number; code: string }>();
  private fmtVersion = 0;
  private clip: { chart: Chart; anchor: ChartAnchor; rect: PxRect } | null = null;
  /** Debounce of the refresh after patches with `chartSheets`, ms. */
  refreshDelay = 40;
  selected: ChartSelection | null = null;
  /** The Format pane is open. */
  pane = false;
  /** Inline editing of the chart title / an axis title. */
  textEdit: { element: ChartElement; text: string } | null = null;
  /** Drag preview of the selected chart (sheet px). */
  preview: { id: number; rect: PxRect } | null = null;
  /** Text put on the system clipboard by a chart copy (a paste of it pastes the chart). */
  clipText = "";

  constructor(private readonly store: CalcStore) {}

  private notify(): void {
    this.store.notify();
  }

  /** New document: forget everything. */
  reset(): void {
    this.lists.clear();
    this.data.clear();
    this.dataFor.clear();
    this.stale.clear();
    this.scenes.clear();
    this.listFetching.clear();
    this.selected = null;
    this.textEdit = null;
    this.preview = null;
    this.pane = false;
    this.clip = null;
  }

  // --- lists and data ----------------------------------------------------------------------------

  /** The charts of `sheet` known so far, back to front. */
  list(sheet: number): ChartObject[] {
    return this.lists.get(sheet) ?? [];
  }

  get(sheet: number, id: number): ChartObject | undefined {
    return this.list(sheet).find((c) => c.id === id);
  }

  /** The selected chart object. */
  selectedChart(): ChartObject | undefined {
    const s = this.selected;
    return s ? this.get(s.sheet, s.id) : undefined;
  }

  private setList(sheet: number, charts: ChartObject[]): void {
    this.lists.set(sheet, charts);
    for (const c of charts) {
      const k = key(sheet, c.id);
      if (this.dataFor.has(k) && this.dataFor.get(k) !== canon(c.chart)) this.stale.add(k);
    }
    const ids = new Set(charts.map((c) => c.id));
    if (this.selected?.sheet === sheet && !ids.has(this.selected.id)) {
      this.selected = null;
      this.textEdit = null;
    }
  }

  /** A region snapshot's `charts` (every chart of the sheet). */
  fromSnapshot(sheet: number, charts: ChartObject[]): void {
    const before = this.lists.get(sheet);
    if (before && canon(before) === canon(charts)) return;
    this.setList(sheet, charts);
  }

  /** Fetches the chart list of `sheet` (shared while in flight). */
  refreshList(sheet: number): Promise<ChartObject[]> {
    let p = this.listFetching.get(sheet);
    if (!p) {
      p = this.store.api
        .sheetCharts(sheet)
        .then((charts) => {
          this.setList(sheet, charts);
          this.notify();
          return charts;
        })
        .catch(() => this.list(sheet))
        .finally(() => this.listFetching.delete(sheet));
      this.listFetching.set(sheet, p);
    }
    return p;
  }

  /** The list of `sheet`, fetched when not known yet. */
  async ensureList(sheet: number): Promise<ChartObject[]> {
    return this.lists.has(sheet) ? this.list(sheet) : this.refreshList(sheet);
  }

  /** Patch with `chartSheets`: lists and data of those sheets are refetched (debounced). */
  invalidate(sheets: readonly number[]): void {
    for (const s of sheets) {
      for (const k of this.data.keys()) if (k.startsWith(`${s}:`)) this.stale.add(k);
      this.pending.add(s);
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const sheets = [...this.pending];
      this.pending.clear();
      const active = this.store.getState().activeSheet;
      for (const s of sheets) if (s === active || this.lists.has(s)) void this.refreshList(s);
    }, this.refreshDelay);
  }

  /** A deleted sheet. */
  dropSheet(sheet: number): void {
    this.lists.delete(sheet);
    for (const k of [...this.data.keys()]) if (k.startsWith(`${sheet}:`)) this.data.delete(k);
    if (this.selected?.sheet === sheet) this.selected = null;
  }

  /** The resolved data of a chart (fetched when missing or stale; the old data is kept meanwhile). */
  dataOf(sheet: number, obj: ChartObject): ResolvedChart | undefined {
    const k = key(sheet, obj.id);
    const have = this.data.get(k);
    if ((!have || this.stale.has(k) || this.dataFor.get(k) !== canon(obj.chart)) && !this.fetching.has(k)) void this.fetchData(sheet, obj);
    return have;
  }

  /** Fetches the data of a chart now. */
  async fetchData(sheet: number, obj: ChartObject): Promise<ResolvedChart> {
    const k = key(sheet, obj.id);
    this.fetching.add(k);
    this.stale.delete(k);
    const def = canon(obj.chart);
    let data: ResolvedChart;
    try {
      data = await this.store.api.chartData(sheet, obj.id);
    } catch {
      data = { series: [] };
    }
    this.fetching.delete(k);
    this.data.set(k, data);
    this.dataFor.set(k, def);
    this.notify();
    return data;
  }

  // --- formatting and scenes ---------------------------------------------------------------------

  /** Number formatting with the core's formats: cached, fetched in the background (General and the plain codes at once). */
  format = (value: number, code: string): string => {
    if (!code || code.toLowerCase() === "general") return formatGeneral(value);
    const k = `${code}\u0000${value}`;
    const hit = this.fmtCache.get(k);
    if (hit !== undefined) return hit;
    if (!this.fmtQueue.has(k)) {
      this.fmtQueue.set(k, { value, code });
      if (this.fmtQueue.size === 1) queueMicrotask(() => void this.flushFormats());
    }
    return basicFormat(value, code);
  };

  private async flushFormats(): Promise<void> {
    const batch = [...this.fmtQueue.entries()];
    this.fmtQueue.clear();
    await Promise.all(
      batch.map(async ([k, { value, code }]) => {
        try {
          this.fmtCache.set(k, await this.store.api.formatPreview(value, code));
        } catch {
          this.fmtCache.set(k, basicFormat(value, code));
        }
      }),
    );
    if (this.fmtCache.size > 20_000) this.fmtCache.clear();
    this.fmtVersion++;
    this.notify();
  }

  /** Text measurement for chart labels (the grid's canvas measure). */
  private measure = (text: string, size: number, bold: boolean): number => {
    const m = this.store.measure;
    const w = m(text, `${bold ? "bold " : ""}${size}px ${CHART_FONT}`);
    return Number.isFinite(w) && w > 0 ? w : approxTextWidth(text, size, bold);
  };

  /** The laid-out scene of a chart at `w × h` (memoized; `null` while its data loads). */
  scene(sheet: number, obj: ChartObject, w: number, h: number): ChartScene | null {
    const data = this.dataOf(sheet, obj);
    if (!data) return null;
    const k = key(sheet, obj.id);
    const lk = t("calc.chart.chartTitle");
    const m = this.scenes.get(k);
    if (m && m.obj === obj && m.data === data && m.w === w && m.h === h && m.fv === this.fmtVersion && m.lk === lk) return m.scene;
    const scene = layoutChart(obj.chart, data, w, h, { format: this.format, measure: this.measure, labels: chartLabels() });
    this.scenes.set(k, { obj, data, w, h, fv: this.fmtVersion, lk, scene });
    return scene;
  }

  /** The charts of `sheet` as drawn now (drag preview applied). */
  frames(sheet: number): ChartFrame[] {
    const geo = this.store.geometry(sheet);
    return this.list(sheet).map((obj) => {
      const p = this.preview && this.selected?.sheet === sheet && this.preview.id === obj.id ? this.preview.rect : null;
      const rect = p ?? anchorRect(obj.anchor, geo.col, geo.row);
      const w = Math.max(1, Math.round(rect.w));
      const h = Math.max(1, Math.round(rect.h));
      return { obj, rect, scene: rect.w >= 1 && rect.h >= 1 ? this.scene(sheet, obj, w, h) : null };
    });
  }

  /** The topmost chart frame at sheet px x, y on `sheet`. */
  frameAt(sheet: number, x: number, y: number): ChartFrame | null {
    const list = this.frames(sheet);
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i]!;
      if (x >= f.rect.x && x <= f.rect.x + f.rect.w && y >= f.rect.y && y <= f.rect.y + f.rect.h) return f;
    }
    return null;
  }

  // --- selection ---------------------------------------------------------------------------------

  select(sheet: number, id: number, element: ChartElement | null = null): void {
    this.selected = { sheet, id, element };
    this.textEdit = null;
    this.notify();
  }

  deselect(): void {
    if (!this.selected && !this.textEdit) return;
    this.selected = null;
    this.textEdit = null;
    this.preview = null;
    this.notify();
  }

  /** Esc: from an element up to the chart, then off the chart. */
  escape(): boolean {
    const s = this.selected;
    if (!s) return false;
    if (this.textEdit) this.textEdit = null;
    else if (s.element && s.element.type !== "chartArea") this.selected = { ...s, element: null };
    else this.selected = null;
    this.notify();
    return true;
  }

  /**
   * A click on a chart: selects it (the element under the pointer; a series
   * as a whole first, then the clicked point); a click on the selected
   * title starts editing it inline. Returns whether inline editing started.
   */
  click(sheet: number, id: number, element: ChartElement | null): boolean {
    const cur = this.selected;
    const el = element && element.type !== "chartArea" ? element : null;
    const whole = (e: ChartElement | null): ChartElement | null => (e && (e.type === "series" || e.type === "dataLabels") ? { type: e.type, series: e.series } : e);
    if (!cur || cur.id !== id || cur.sheet !== sheet) {
      this.select(sheet, id, whole(el));
      return false;
    }
    if (el && (el.type === "series" || el.type === "dataLabels") && el.point !== undefined && cur.element?.type === el.type && cur.element.series === el.series) {
      this.select(sheet, id, el);
      return false;
    }
    if (el && sameElement(el, cur.element) && (el.type === "title" || el.type === "axisTitle")) {
      this.startTextEdit(el);
      return true;
    }
    this.select(sheet, id, whole(el));
    return false;
  }

  // --- commands ----------------------------------------------------------------------------------

  private apply(command: CalcCommand): Promise<void> {
    return this.store.apply(command);
  }

  /** Replaces the selected chart's definition. */
  update(chart: Chart): Promise<void> {
    const s = this.selected;
    if (!s) return Promise.resolve();
    return this.apply({ type: "updateChart", sheet: s.sheet, id: s.id, chart });
  }

  /** Edits the selected chart with `fn` (no-op when nothing changes). */
  edit(fn: (c: Chart) => Chart): Promise<void> {
    const obj = this.selectedChart();
    if (!obj) return Promise.resolve();
    const next = fn(obj.chart);
    if (canon(next) === canon(obj.chart)) return Promise.resolve();
    return this.update(next);
  }

  /** Moves/resizes the selected chart to a sheet px rectangle (its anchor kind is kept). */
  setRect(rect: PxRect): Promise<void> {
    const s = this.selected;
    const obj = this.selectedChart();
    if (!s || !obj) return Promise.resolve();
    const geo = this.store.geometry(s.sheet);
    return this.apply({ type: "setChartAnchor", sheet: s.sheet, id: s.id, anchor: rectToAnchor(rect, obj.anchor.type, geo.col, geo.row) });
  }

  /** Deletes the selected chart. */
  async remove(): Promise<void> {
    const s = this.selected;
    if (!s) return;
    this.selected = null;
    this.textEdit = null;
    this.pane = false;
    await this.apply({ type: "removeChart", sheet: s.sheet, id: s.id });
  }

  /** Adds `chart` at `anchor` and selects it. */
  async add(sheet: number, anchor: ChartAnchor, chart: Chart): Promise<boolean> {
    const before = new Set((await this.ensureList(sheet)).map((c) => c.id));
    const revision = this.store.getState().revision;
    await this.apply({ type: "addChart", sheet, anchor, chart });
    if (this.store.getState().revision === revision) return false;
    const list = await this.refreshList(sheet);
    const added = list.filter((c) => !before.has(c.id)).pop();
    if (!added) return false;
    if (this.store.getState().activeSheet === sheet) this.select(sheet, added.id, null);
    return true;
  }

  /** The selection clipped to the used area (as a request range). */
  private selectionRange() {
    const st = this.store.getState();
    const r = normalize(st.selection);
    const used = this.store.usedExtent(st.activeSheet);
    return {
      sheet: st.activeSheet,
      r0: r.r0,
      c0: r.c0,
      r1: Math.max(r.r0, Math.min(r.r1, Math.max(used.lastRow, r.r0))),
      c1: Math.max(r.c0, Math.min(r.c1, Math.max(used.lastCol, r.c0))),
      sel: r,
    };
  }

  /** Excel's recommended chart for the selection (`null` without numbers). */
  async recommended(): Promise<Chart | null> {
    const { sheet, r0, c0, r1, c1 } = this.selectionRange();
    try {
      return await this.store.api.recommendedChart(sheet, r0, c0, r1, c1);
    } catch (e) {
      this.store.pushError(e);
      return null;
    }
  }

  /** The data a chart would show on the active sheet (previews). */
  async previewData(chart: Chart): Promise<ResolvedChart> {
    try {
      return await this.store.api.previewChartData(this.store.getState().activeSheet, chart);
    } catch {
      return { series: [] };
    }
  }

  /** Inserts `chart` right of the selection, selects it and shows Chart Design. */
  async insertChart(chart: Chart): Promise<void> {
    const { sheet, sel } = this.selectionRange();
    const geo = this.store.geometry(sheet);
    const anchor = rectToAnchor(insertRect(sel, geo.col, geo.row), "twoCell", geo.col, geo.row);
    if (await this.add(sheet, anchor, chart)) this.store.requestRibbonTab("chartDesign");
  }

  /** Insert › Charts: a chart of the preset's type from the selection. */
  async insertPreset(presetId: string): Promise<void> {
    const preset = presetById(presetId);
    if (!preset) return;
    if (this.store.getState().edit) await this.store.commitEdit(0, 0);
    const base = (await this.recommended()) ?? emptyChart();
    await this.insertChart(applyPreset(base, preset));
  }

  /** Ctrl+C on a chart. */
  copy(): string {
    const obj = this.selectedChart();
    const s = this.selected;
    if (!obj || !s) return "";
    const geo = this.store.geometry(s.sheet);
    this.clip = { chart: JSON.parse(JSON.stringify(obj.chart)) as Chart, anchor: obj.anchor, rect: anchorRect(obj.anchor, geo.col, geo.row) };
    this.clipText = obj.name ?? `${t("calc.chart.chart")} ${obj.id}`;
    return this.clipText;
  }

  hasClip(): boolean {
    return this.clip !== null;
  }

  forgetClip(): void {
    this.clip = null;
    this.clipText = "";
  }

  /** Ctrl+V of a copied chart: a duplicate at the active cell. */
  async paste(): Promise<void> {
    const c = this.clip;
    if (!c) return;
    const st = this.store.getState();
    const sheet = st.activeSheet;
    const geo = this.store.geometry(sheet);
    const a = this.store.activeAnchor();
    let x = geo.col.offset(a.col);
    let y = geo.row.offset(a.row);
    if (Math.abs(x - c.rect.x) < 1 && Math.abs(y - c.rect.y) < 1) {
      x += 20;
      y += 20;
    }
    await this.add(sheet, rectToAnchor({ x, y, w: c.rect.w, h: c.rect.h }, c.anchor.type, geo.col, geo.row), c.chart);
  }

  /** Move Chart…: to another sheet (same place), or to a new sheet named `newSheet`. */
  async moveTo(target: { sheet: number } | { newSheet: string }): Promise<void> {
    const s = this.selected;
    const obj = this.selectedChart();
    if (!s || !obj) return;
    let sheet: number;
    if ("newSheet" in target) {
      const before = new Set((this.store.getState().info?.sheets ?? []).map((x) => x.id));
      const index = this.store.sheetPosition(s.sheet);
      await this.apply({ type: "addSheet", name: target.newSheet, index });
      const created = (this.store.getState().info?.sheets ?? []).find((x) => !before.has(x.id));
      if (!created) return;
      sheet = created.id;
    } else sheet = target.sheet;
    if (sheet === s.sheet) return;
    const geo = this.store.geometry(s.sheet);
    const rect = "newSheet" in target ? { ...anchorRect(obj.anchor, geo.col, geo.row), x: 0, y: 0 } : anchorRect(obj.anchor, geo.col, geo.row);
    const tgeo = this.store.geometry(sheet);
    const anchor = rectToAnchor(rect, obj.anchor.type, tgeo.col, tgeo.row);
    this.selected = null;
    await this.apply({ type: "compound", commands: [{ type: "addChart", sheet, anchor, chart: obj.chart }, { type: "removeChart", sheet: s.sheet, id: s.id }] });
    this.store.setActiveSheet(sheet);
    const list = await this.refreshList(sheet);
    const last = list[list.length - 1];
    if (last) this.select(sheet, last.id, null);
  }

  /** Select Data: replaces the series and categories. */
  setSeries(series: Series[], categories: DataRef | null): Promise<void> {
    const s = this.selected;
    if (!s) return Promise.resolve();
    return this.apply({ type: "setChartSeries", sheet: s.sheet, id: s.id, series, categories });
  }

  /** Chart Design › Switch Row/Column (a toast when the data cannot be switched). */
  async switchRowCol(): Promise<void> {
    const obj = this.selectedChart();
    if (!obj) return;
    const next = switchRowCol(obj.chart);
    if (!next) {
      this.store.pushError(new Error(t("calc.chart.cannotSwitch")));
      return;
    }
    await this.setSeries(next.series, next.categories);
  }

  // --- inline title editing ----------------------------------------------------------------------

  startTextEdit(element: ChartElement): void {
    const obj = this.selectedChart();
    const s = this.selected;
    if (!obj || !s) return;
    const geo = this.store.geometry(s.sheet);
    const r = anchorRect(obj.anchor, geo.col, geo.row);
    const scene = this.scene(s.sheet, obj, Math.round(r.w), Math.round(r.h));
    let text = "";
    if (element.type === "title") text = scene?.titleText ?? "";
    else if (element.type === "axisTitle") {
      const a = obj.chart.axes[element.axis];
      text = a?.title?.text?.type === "literal" ? a.title.text.text : t("calc.chart.axisTitle");
    }
    this.textEdit = { element, text };
    this.notify();
  }

  /** Commits the inline title text (a literal title). */
  async commitTextEdit(text: string): Promise<void> {
    const e = this.textEdit;
    this.textEdit = null;
    this.notify();
    if (!e) return;
    await this.edit((c) => {
      if (e.element.type === "title") return { ...c, title: { ...(c.title ?? {}), text: { type: "literal", text } } };
      if (e.element.type === "axisTitle") {
        const axis = e.element.axis;
        const a = c.axes[axis] ?? {};
        return { ...c, axes: { ...c.axes, [axis]: { ...a, title: { ...(a.title ?? {}), text: { type: "literal", text } } } } };
      }
      return c;
    });
  }
}
