// Calc's AI actions (P8-37): Formula from description (validated with the formula parser before it goes into the
// active cell), Explain this formula, Transform range (a 2-D array of cell inputs for a destination range, previewed
// before it is applied as one undo step), Chart suggestion (a chart type and data range → the normal chart insert).
//
// Context: the selected cells (values as TSV, formulas listed separately), the active cell and its formula, and the
// sheet names; the whole workbook's used ranges only with "Include whole document".

import { useState } from "react";
import {
  AiError, EXPLAIN_CHART_TASK, FORMULA_TOOL, RANGE_TOOL, block, chartDataTable, chartImage, chartTool, paragraphsOf, parseChart, parseFormula, parseRange, plainText,
  type AiAction, type AiAppAdapter, type AiApply, type AiImage, type ChartResult, type DocContext, type FormulaResult, type RangeResult,
} from "@rusuite/ui-shared";
import type { ChartObject } from "../generated/ChartObject";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";
import type { CalcCommand } from "../generated/CalcCommand";
import { cellAddress, colName, sheetPrefix } from "../grid/address";
import { LAST_COL, LAST_ROW, normalize, type Range } from "../grid/Selection";
import { checkFormula, formulaErrorMessage } from "../formula/validate";
import { isFormula } from "../formula/tokenize";
import { parseRange as parseA1 } from "../charts/refs";
import { CHART_PRESETS, presetById } from "../charts/presets";

/** Cells read for the context at most (the rest is described, not sent). */
export const MAX_CONTEXT_CELLS = 5_000;
const MAX_FORMULAS = 300;

export interface CalcAnchor {
  sheet: number;
  row: number;
  col: number;
  range: Range;
  /** The selected chart when the request started. */
  chart?: number;
}

/** The cell a chart's note goes to: under its top-left corner (absolute charts: the active cell). */
export function chartNoteCell(obj: ChartObject): { row: number; col: number } | null {
  return obj.anchor.type === "absolute" ? null : { row: obj.anchor.from.row, col: obj.anchor.from.col };
}

export const rangeAddress = (r: Range) =>
  r.r0 === r.r1 && r.c0 === r.c1 ? cellAddress(r.r0, r.c0) : `${cellAddress(r.r0, r.c0)}:${cellAddress(r.r1, r.c1)}`;

/** A1 text → range (`B2`, `B2:D9`, `$B$2`); `null` when invalid. */
export function parseAddress(text: string): Range | null {
  const r = parseA1(text.trim());
  if (!r || r.r1 > LAST_ROW || r.c1 > LAST_COL) return null;
  return { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 };
}

function sheetName(store: CalcStore, sheet = store.getState().activeSheet): string {
  return store.getState().info?.sheets.find((s) => s.id === sheet)?.name ?? `Sheet${sheet + 1}`;
}

/** The selection clipped to the used area (at least the active cell). */
function selRange(store: CalcStore): Range {
  const st = store.getState();
  const r = normalize(st.selection);
  const used = store.usedExtent(st.activeSheet);
  return { r0: r.r0, c0: r.c0, r1: Math.max(r.r0, Math.min(r.r1, used.lastRow)), c1: Math.max(r.c0, Math.min(r.c1, used.lastCol)) };
}

/** Values of `r` as TSV (display text) and its formulas (`B3: =SUM(B1:B2)`), at most `MAX_CONTEXT_CELLS`. */
export async function rangeText(store: CalcStore, sheet: number, r: Range): Promise<{ tsv: string; formulas: string[]; cut: boolean }> {
  const cols = r.c1 - r.c0 + 1;
  const rows = Math.max(1, Math.min(r.r1 - r.r0 + 1, Math.floor(MAX_CONTEXT_CELLS / cols)));
  const r1 = r.r0 + rows - 1;
  const c1 = r.c0 + Math.min(cols, MAX_CONTEXT_CELLS) - 1;
  await store.ensureRegion(sheet, r.r0, r.c0, r1, c1);
  const cells = store.cache(sheet).cells;
  const lines: string[] = [];
  const formulas: string[] = [];
  for (let row = r.r0; row <= r1; row++) {
    const line: string[] = [];
    for (let col = r.c0; col <= c1; col++) {
      const c = cells.get(row)?.get(col);
      line.push((c?.display ?? "").replace(/[\t\n]/g, " "));
      if (c && isFormula(c.input) && formulas.length < MAX_FORMULAS) formulas.push(`${cellAddress(row, col)}: ${c.input}`);
    }
    lines.push(line.join("\t"));
  }
  return { tsv: lines.join("\n"), formulas, cut: r1 < r.r1 || c1 < r.c1 };
}

/** The formula of the active cell (`null`: none). */
function activeFormula(store: CalcStore): string | null {
  const input = store.activeCell()?.input ?? "";
  return isFormula(input) ? input : null;
}

/** Commands writing `values` from (row, col) as one undo step. */
export function writeCommands(sheet: number, row: number, col: number, values: string[][]): CalcCommand[] {
  const commands: CalcCommand[] = [];
  values.forEach((line, dr) => line.forEach((input, dc) => commands.push({ type: "setInput", sheet, row: row + dr, col: col + dc, input })));
  return commands;
}

/** Invalid formulas among `values` (address → message). */
export function invalidFormulas(values: string[][], row: number, col: number): string[] {
  const out: string[] = [];
  values.forEach((line, dr) =>
    line.forEach((input, dc) => {
      const err = isFormula(input) ? checkFormula(input) : null;
      if (err) out.push(`${cellAddress(row + dr, col + dc)}: ${err.message}`);
    }),
  );
  return out;
}

function TransformPreview({ store, value }: { store: CalcStore; value: RangeResult & { dest: { text: string } } }) {
  const [dest, setDest] = useState(value.dest.text);
  const rows = value.values.length;
  const cols = Math.max(...value.values.map((r) => r.length));
  const ok = parseAddress(dest) !== null;
  return (
    <div className="flex flex-col gap-1.5">
      {value.explanation && <p>{value.explanation}</p>}
      <div className="max-h-48 overflow-auto rounded bg-ui-bg">
        <table className="text-xs" data-testid="ai-range-preview">
          <tbody>
            {value.values.slice(0, 15).map((row, r) => (
              <tr key={r}>
                {row.slice(0, 10).map((c, i) => (
                  <td key={i} className="border border-ui-border px-1">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ui-muted">{t("ai.calc.size", { rows, cols })}</p>
      <label className="flex items-center gap-1 text-xs">
        {t("ai.calc.destination")}
        <input
          className="h-7 w-24 rounded border border-ui-border bg-ui-bg px-1 text-xs"
          value={dest}
          aria-invalid={!ok}
          onChange={(e) => {
            setDest(e.target.value);
            value.dest.text = e.target.value;
          }}
        />
        <button
          type="button"
          className="h-7 rounded border border-ui-border px-2 hover:bg-ui-hover"
          onClick={() => {
            const a = rangeAddress(normalize(store.getState().selection));
            setDest(a);
            value.dest.text = a;
          }}
        >
          {t("ai.calc.useSelection")}
        </button>
      </label>
    </div>
  );
}

export function calcAiAdapter(store: CalcStore): AiAppAdapter {
  const presetIds = CHART_PRESETS.map((p) => p.id);
  const anchorOf = (turn: { anchor?: unknown }) => turn.anchor as CalcAnchor | undefined;

  const insertText: AiApply<string> = {
    label: t("ai.calc.insertText"),
    run: async (text, turn) => {
      const a = anchorOf(turn);
      const st = store.getState();
      const sheet = a?.sheet ?? st.activeSheet;
      const { row, col } = a ?? store.activeAnchor();
      const input = text.trim().replace(/\s*\n\s*/g, " ");
      if (!(await store.applyChecked({ type: "setInput", sheet, row, col, input: isFormula(input) ? `'${input}` : input }))) throw new Error(t("ai.calc.notApplied"));
      return t("ai.calc.insertedAt", { cell: cellAddress(row, col) });
    },
  };

  // --- Explain this chart (P9-A1): the chart drawn as a PNG plus its data table ---
  const selectedChart = () => {
    const sel = store.charts.selected;
    const obj = store.charts.selectedChart();
    return sel && obj ? { sheet: sel.sheet, obj } : null;
  };
  const chartAttachment = async (): Promise<{ images: AiImage[]; text: string }> => {
    const c = selectedChart();
    if (!c) throw new Error(t("ai.calc.noChart"));
    const data = await store.charts.fetchData(c.sheet, c.obj);
    const frame = store.charts.frames(c.sheet).find((f) => f.obj.id === c.obj.id);
    const w = Math.max(1, Math.round(frame?.rect.w ?? 480));
    const h = Math.max(1, Math.round(frame?.rect.h ?? 288));
    const scene = store.charts.scene(c.sheet, c.obj, w, h);
    if (!scene) throw new Error(t("ai.calc.noChart"));
    const label = c.obj.name || t("ai.calc.chartLabel");
    return { images: [chartImage(scene, w, h, label)], text: block("chart_data", chartDataTable(data)) };
  };
  const insertNote: AiApply<string> = {
    label: t("ai.calc.insertNote"),
    run: async (text, turn) => {
      const a = anchorOf(turn);
      const sheet = a?.sheet ?? store.getState().activeSheet;
      const obj = a?.chart !== undefined ? store.charts.get(sheet, a.chart) : undefined;
      const at = (obj && chartNoteCell(obj)) ?? (a ? { row: a.row, col: a.col } : store.activeAnchor());
      const note = paragraphsOf(plainText(text)).join("\n");
      if (!note || !(await store.applyChecked({ type: "setNote", sheet, row: at.row, col: at.col, text: [{ text: note }] }))) throw new Error(t("ai.calc.notApplied"));
      return t("ai.calc.noteInserted", { cell: cellAddress(at.row, at.col) });
    },
  };
  const explainChart: AiAction<string> = {
    id: "explainChart",
    label: t("ai.calc.explainChart"),
    unavailable: () => (selectedChart() ? null : t("ai.calc.noChart")),
    task: () => EXPLAIN_CHART_TASK,
    attachments: chartAttachment,
    apply: [insertNote],
  };

  const formula: AiAction<FormulaResult & { error: string | null }> = {
    id: "formula",
    label: t("ai.calc.formula"),
    input: { placeholder: t("ai.calc.formulaPlaceholder"), required: true },
    // Formulas need some thought (references, nesting); at least medium reasoning.
    effort: "medium",
    task: (what, ctx) =>
      `Write a formula for the active cell (${ctx.facts?.[0] ?? ""}) that does this: ${what}. Use the cells of the context where they fit.`,
    tool: FORMULA_TOOL,
    parse: (raw) => {
      const r = parseFormula(raw);
      const err = checkFormula(r.formula);
      return { ...r, error: err ? formulaErrorMessage(err.message) : null };
    },
    preview: (v) => (
      <div className="flex flex-col gap-1">
        <code className="break-all rounded bg-ui-bg px-1.5 py-1 text-xs" data-testid="ai-formula">
          {v.formula}
        </code>
        {v.explanation && <p data-testid="ai-explanation">{v.explanation}</p>}
        {v.error && <p className="text-xs text-red-700 dark:text-red-400">{v.error}</p>}
      </div>
    ),
    apply: [
      {
        label: t("ai.calc.insertFormula"),
        disabled: (v) => v.error,
        run: async (v, turn) => {
          const a = anchorOf(turn) ?? { sheet: store.getState().activeSheet, ...store.activeAnchor() };
          if (store.getState().edit) store.cancelEdit();
          if (!(await store.applyChecked({ type: "setInput", sheet: a.sheet, row: a.row, col: a.col, input: v.formula }))) throw new Error(t("ai.calc.notApplied"));
          return t("ai.calc.insertedAt", { cell: cellAddress(a.row, a.col) });
        },
      },
    ],
  };

  const explain: AiAction<string> = {
    id: "explain",
    label: t("ai.calc.explain"),
    unavailable: () => (activeFormula(store) ? null : t("ai.calc.noFormula")),
    task: () => "Explain the formula of the active cell in plain words: what it calculates and how. Be brief (a few sentences); no Markdown.",
    apply: [],
  };

  const transform: AiAction<RangeResult & { dest: { text: string } }> = {
    id: "transform",
    label: t("ai.calc.transform"),
    needsSelection: true,
    input: { placeholder: t("ai.calc.transformPlaceholder"), required: true },
    effort: "medium",
    task: (what) =>
      `Transform the selected cells as follows: ${what}. Return the resulting cells (all rows and columns of the result, top-left first). Keep cells you do not change.`,
    tool: RANGE_TOOL,
    parse: (raw) => ({ ...parseRange(raw), dest: { text: "" } }),
    preview: (v) => <TransformPreview store={store} value={v} />,
    apply: [
      {
        label: t("ai.calc.applyRange"),
        run: async (v, turn) => {
          const a = anchorOf(turn);
          const sheet = store.getState().activeSheet;
          const dest = parseAddress(v.dest.text || (a ? rangeAddress(a.range) : "")) ?? (a ? a.range : null);
          if (!dest) throw new Error(t("ai.calc.badDestination"));
          const bad = invalidFormulas(v.values, dest.r0, dest.c0);
          if (bad.length) throw new AiError("badResponse", t("ai.calc.badFormulas", { list: bad.slice(0, 3).join("; ") }));
          const rows = v.values.length;
          const cols = Math.max(...v.values.map((r) => r.length));
          if (dest.r0 + rows - 1 > LAST_ROW || dest.c0 + cols - 1 > LAST_COL) throw new Error(t("calc.pasteTooBig"));
          if (store.getState().edit) store.cancelEdit();
          if (!(await store.applyChecked({ type: "compound", commands: writeCommands(sheet, dest.r0, dest.c0, v.values) }))) throw new Error(t("ai.calc.notApplied"));
          store.select({ anchor: { row: dest.r0, col: dest.c0 }, focus: { row: dest.r0 + rows - 1, col: dest.c0 + cols - 1 } });
          return t("ai.calc.applied", { range: rangeAddress({ r0: dest.r0, c0: dest.c0, r1: dest.r0 + rows - 1, c1: dest.c0 + cols - 1 }) });
        },
      },
    ],
  };

  const chart: AiAction<ChartResult> = {
    id: "chart",
    label: t("ai.calc.chart"),
    needsSelection: true,
    task: () => "Suggest the chart that shows the selected data best: a chart type and the data range (with headers).",
    tool: chartTool(presetIds),
    parse: (raw) => parseChart(raw, presetIds),
    preview: (v) => {
      const p = presetById(v.preset);
      return (
        <div className="flex flex-col gap-1">
          <p className="font-medium" data-testid="ai-chart">
            {t("ai.calc.chartOf", { kind: p ? t(p.label) : v.preset, range: v.range })}
          </p>
          {v.title && <p className="text-xs">{v.title}</p>}
          {v.reason && <p className="text-xs text-ui-muted">{v.reason}</p>}
        </div>
      );
    },
    apply: [
      {
        label: t("ai.calc.insertChart"),
        run: async (v) => {
          const r = parseAddress(v.range);
          if (!r) throw new Error(t("ai.calc.badDestination"));
          if (store.getState().edit) store.cancelEdit();
          store.select({ anchor: { row: r.r0, col: r.c0 }, focus: { row: r.r1, col: r.c1 } });
          await store.charts.insertPreset(v.preset);
          return t("ai.calc.chartInserted");
        },
      },
    ],
  };

  return {
    app: "calc",
    textApply: [insertText],
    anchor: () => {
      const st = store.getState();
      const chart = selectedChart();
      return { sheet: st.activeSheet, ...store.activeAnchor(), range: normalize(st.selection), ...(chart ? { chart: chart.obj.id } : {}) } satisfies CalcAnchor;
    },
    subscribe: (fn) => store.subscribe(fn),
    hasSelection: () => {
      const r = selRange(store);
      const cells = store.cache(store.getState().activeSheet).cells;
      for (let row = r.r0; row <= Math.min(r.r1, r.r0 + 200); row++) {
        const line = cells.get(row);
        if (!line) continue;
        for (let col = r.c0; col <= r.c1; col++) if (line.get(col)?.input) return true;
      }
      return false;
    },
    selectionLabel: () => {
      const r = normalize(store.getState().selection);
      return `${sheetPrefix(sheetName(store))}${rangeAddress(r)}`;
    },
    documentSize: () =>
      (store.getState().info?.sheets ?? []).reduce((n, s) => {
        const u = store.usedExtent(s.id);
        return n + (u.lastRow + 1) * (u.lastCol + 1) * 6;
      }, 0),
    context: async (includeDocument): Promise<DocContext> => {
      const st = store.getState();
      const sheet = st.activeSheet;
      const sel = normalize(st.selection);
      const r = selRange(store);
      const { tsv, formulas, cut } = await rangeText(store, sheet, r);
      const anchor = store.activeAnchor();
      const af = activeFormula(store);
      const sheets = (st.info?.sheets ?? []).filter((s) => !s.hidden && !s.veryHidden);
      const facts = [
        `Active cell: ${sheetPrefix(sheetName(store))}${cellAddress(anchor.row, anchor.col)}${af ? `, formula ${af}` : ""}`,
        `Selection: ${rangeAddress(sel)} (the selection text below starts at ${cellAddress(r.r0, r.c0)}; columns ${colName(r.c0)}–${colName(r.c1)}, tab-separated${cut ? ", cut off" : ""})`,
        formulas.length ? `Formulas in the selection:\n${formulas.join("\n")}` : "",
      ].filter(Boolean);
      let document: string | undefined;
      if (includeDocument) {
        const parts: string[] = [];
        for (const s of sheets) {
          const u = store.usedExtent(s.id);
          if (u.lastRow < 0 || u.lastCol < 0) continue;
          const d = await rangeText(store, s.id, { r0: 0, c0: 0, r1: u.lastRow, c1: u.lastCol });
          parts.push(`Sheet ${s.name} (A1:${cellAddress(u.lastRow, u.lastCol)}${d.cut ? ", cut off" : ""}):\n${d.tsv}${d.formulas.length ? `\nFormulas:\n${d.formulas.join("\n")}` : ""}`);
        }
        document = parts.join("\n\n");
      }
      return {
        app: "calc",
        title: st.name ?? t("doc.untitled"),
        description: `Spreadsheet workbook with ${sheets.length} sheet(s): ${sheets.map((s) => s.name).join(", ")}. Active sheet: ${sheetName(store)}.`,
        selectionLabel: `${sheetPrefix(sheetName(store))}${rangeAddress(sel)}`,
        selection: tsv,
        facts,
        ...(document !== undefined ? { document } : {}),
      };
    },
    actions: () => [formula, explain, transform, chart, explainChart] as AiAction<unknown>[],
  };
}
