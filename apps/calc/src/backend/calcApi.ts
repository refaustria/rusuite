// Typed wrappers over `Backend.dispatch` (ADR 0002 amendment, ADR 0005 §4).
// Every reply is checked against the `Response` union before use.

import type { Backend } from "@rusuite/ui-shared";
import type { Envelope } from "../../../../packages/ui-shared/src/generated/Envelope";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CellAnnotations } from "../generated/CellAnnotations";
import type { CfRule } from "../generated/CfRule";
import type { Chart } from "../generated/Chart";
import type { ChartObject } from "../generated/ChartObject";
import type { ResolvedChart } from "../generated/ResolvedChart";
import type { DataValidation } from "../generated/DataValidation";
import type { FilterValue } from "../generated/FilterValue";
import type { FoundCell } from "../generated/FoundCell";
import type { NameRow } from "../generated/NameRow";
import type { PivotAt } from "../generated/PivotAt";
import type { PivotInfo } from "../generated/PivotInfo";
import type { PivotRecommendation } from "../generated/PivotRecommendation";
import type { PivotSourceSpec } from "../generated/PivotSourceSpec";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { LineColors } from "../generated/LineColors";
import type { Rect } from "../generated/Rect";
import type { SheetRect } from "../generated/SheetRect";
import type { SheetThreads } from "../generated/SheetThreads";
import type { RegionSnapshot } from "../generated/RegionSnapshot";
import type { Request } from "../generated/Request";
import type { ResponseBody } from "../generated/ResponseBody";
import type { ValidationResult } from "../generated/ValidationResult";
import type { CsvOptions } from "../generated/CsvOptions";
import type { DecodedText } from "../generated/DecodedText";
import type { GoalSeekResult } from "../generated/GoalSeekResult";
import type { Picture } from "../generated/Picture";
import type { TextEncoding } from "../generated/TextEncoding";
import type { TextImportOptions } from "../generated/TextImportOptions";
import type { WorkbookInfo } from "../generated/WorkbookInfo";
import type { ErrorIssue } from "../generated/ErrorIssue";
import type { ErrorRule } from "../generated/ErrorRule";
import type { Evaluation } from "../generated/Evaluation";
import type { WatchCell } from "../generated/WatchCell";
import type { WatchItem } from "../generated/WatchItem";

export type PatchEnvelope = Envelope<CalcPatch>;

/**
 * A failed call. `code` is the backend's `DispatchError.code`, or one of
 * the client-side codes `transport` (the backend threw) and
 * `bad_response` (the reply did not match the `Response` union).
 */
export class CalcApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CalcApiError";
  }
}

type BodyOf<T extends ResponseBody["type"]> = Extract<ResponseBody, { type: T }>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks the shape of a reply and returns its body of the expected type. */
export function parseResponse<T extends ResponseBody["type"]>(raw: unknown, expected: T): BodyOf<T> {
  if (!isObject(raw)) throw new CalcApiError("bad_response", `reply is not an object: ${JSON.stringify(raw)}`);
  const keys = Object.keys(raw);
  if (keys.length === 1 && keys[0] === "err") {
    const err = raw.err;
    if (isObject(err) && typeof err.code === "string" && typeof err.message === "string") {
      throw new CalcApiError(err.code, err.message);
    }
    throw new CalcApiError("bad_response", `malformed error reply: ${JSON.stringify(raw)}`);
  }
  if (keys.length !== 1 || keys[0] !== "ok" || !isObject(raw.ok)) {
    throw new CalcApiError("bad_response", `reply is neither ok nor err: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  const body = raw.ok;
  if (body.type !== expected) {
    throw new CalcApiError("bad_response", `expected a "${expected}" reply, got "${String(body.type)}"`);
  }
  // Required fields per body kind ("object" | "string" | "boolean" | "array").
  const shapes: Record<ResponseBody["type"], Record<string, string>> = {
    patch: { envelope: "object" },
    snapshot: { snapshot: "object" },
    info: { info: "object" },
    snapshotJson: { json: "string" },
    opened: { info: "object", warnings: "array", envelope: "object" },
    saved: { bytesBase64: "string", suggestedName: "string" },
    documentState: { dirty: "boolean", revision: "number" },
    recoverySnapshot: { json: "string", revision: "number", dirty: "boolean" },
    found: { cells: "array" },
    formatted: { text: "string" },
    filterValues: { values: "array" },
    validation: { result: "object" },
    listValues: { values: "array" },
    invalidCells: { cells: "array" },
    lineColors: { colors: "object" },
    sheetRules: { rules: "array", validations: "array" },
    charts: { charts: "array" },
    chartData: { data: "object" },
    // `chart` is null without numeric data.
    recommendedChart: {},
    // `last` may be null (empty sheet): checked by the caller.
    usedRange: {},
    names: { names: "array" },
    // `name` is null when no name has exactly that range.
    nameAt: {},
    trace: { refs: "array" },
    annotations: { annotations: "object" },
    comments: { sheets: "array" },
    pivotInfo: { info: "object" },
    // `pivot` is null outside pivot tables.
    pivotAt: {},
    pivotItems: { items: "array" },
    pivotRecommendations: { items: "array" },
    goalSeek: { result: "object" },
    decoded: { decoded: "object" },
    preview: { rows: "array" },
    pictures: { pictures: "array" },
    errorChecks: { issues: "array" },
    evaluation: { evaluation: "object" },
    watch: { items: "array" },
  };
  for (const [field, kind] of Object.entries(shapes[expected])) {
    const value = body[field];
    const ok =
      kind === "object" ? isObject(value) : kind === "array" ? Array.isArray(value) : typeof value === kind;
    if (!ok) throw new CalcApiError("bad_response", `"${expected}" reply lacks "${field}"`);
  }
  if (expected === "patch" || expected === "opened") {
    const env = body.envelope as Record<string, unknown>;
    if (typeof env.revision !== "number" || !isObject(env.patch)) {
      throw new CalcApiError("bad_response", "patch envelope lacks revision/patch");
    }
  }
  return body as BodyOf<T>;
}

/** The Calc backend: generated `Request` in, generated `ResponseBody` out. */
export type CalcBackend = Backend<Request, ResponseBody>;

/** One method per `Request` kind. */
export class CalcApi {
  constructor(readonly backend: CalcBackend) {}

  /** Requests sent and not answered yet (the store's busy state, e2e `grid.waitIdle()`). */
  pending = 0;
  /** Called whenever `pending` changes. */
  onPending: (() => void) | null = null;

  private async call<T extends ResponseBody["type"]>(request: Request, expected: T): Promise<BodyOf<T>> {
    let raw: unknown;
    this.pending++;
    this.onPending?.();
    try {
      raw = await this.backend.dispatch(request);
    } catch (e) {
      throw new CalcApiError("transport", e instanceof Error ? e.message : String(e));
    } finally {
      this.pending--;
      this.onPending?.();
    }
    return parseResponse(raw, expected);
  }

  async apply(command: CalcCommand): Promise<PatchEnvelope> {
    return (await this.call({ type: "apply", command }, "patch")).envelope;
  }

  async undo(): Promise<PatchEnvelope> {
    return (await this.call({ type: "undo" }, "patch")).envelope;
  }

  async redo(): Promise<PatchEnvelope> {
    return (await this.call({ type: "redo" }, "patch")).envelope;
  }

  async snapshot(sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<RegionSnapshot> {
    return (await this.call({ type: "snapshot", sheet, r0, c0, r1, c1 }, "snapshot")).snapshot;
  }

  async info(): Promise<WorkbookInfo> {
    return (await this.call({ type: "info" }, "info")).info;
  }

  async newDocument(): Promise<WorkbookInfo> {
    return (await this.call({ type: "newDocument" }, "info")).info;
  }

  async loadSnapshotJson(json: string): Promise<WorkbookInfo> {
    return (await this.call({ type: "loadSnapshotJson", json }, "info")).info;
  }

  async saveSnapshotJson(): Promise<string> {
    return (await this.call({ type: "saveSnapshotJson" }, "snapshotJson")).json;
  }

  /** Replaces the document by an `.xlsx` file → info, reader warnings and envelope. */
  openXlsx(bytesBase64: string, name: string): Promise<BodyOf<"opened">> {
    return this.call({ type: "openXlsx", bytesBase64, name }, "opened");
  }

  /** The document as `.xlsx` (base64) plus the file name to offer. */
  /** `activeSheet`: the sheet the saved file opens on. */
  saveXlsx(activeSheet?: number): Promise<BodyOf<"saved">> {
    return this.call({ type: "saveXlsx", activeSheet }, "saved");
  }

  /** Marks the current state saved (after the shell wrote the file). */
  markSaved(name?: string): Promise<BodyOf<"documentState">> {
    return this.call(name === undefined ? { type: "markSaved" } : { type: "markSaved", name }, "documentState");
  }

  /** The whole workbook for crash recovery (P5-3). */
  recoverySnapshot(): Promise<BodyOf<"recoverySnapshot">> {
    return this.call({ type: "recoverySnapshot" }, "recoverySnapshot");
  }

  /** Replaces the workbook by a `recoverySnapshot` JSON (dirty; `name` = file name). */
  async restoreRecovery(json: string, name: string | null): Promise<WorkbookInfo> {
    return (await this.call({ type: "restoreRecovery", json, name: name ?? undefined }, "info")).info;
  }

  documentState(): Promise<BodyOf<"documentState">> {
    return this.call({ type: "documentState" }, "documentState");
  }

  /** Cells whose input or value matches `query` on `sheet` (`null`: all sheets), sheet then row-major order. */
  async findCells(sheet: number | null, query: string, matchCase: boolean, wholeCell: boolean): Promise<FoundCell[]> {
    return (await this.call({ type: "findCells", sheet, query, matchCase, wholeCell }, "found")).cells;
  }

  /** `[row, col]` of the last used cell of `sheet` (content or own style); `null` when empty. */
  async usedRange(sheet: number): Promise<[number, number] | null> {
    const { last } = await this.call({ type: "usedRange", sheet }, "usedRange");
    return Array.isArray(last) ? last : null;
  }

  /** The value list of AutoFilter column `col` (absolute) of `sheet`, for its dropdown. */
  async filterValues(sheet: number, col: number): Promise<FilterValue[]> {
    return (await this.call({ type: "filterValues", sheet, col }, "filterValues")).values;
  }

  /** `value` displayed with the number format `code` (the core's `display_value`). */
  async formatPreview(value: number, code: string): Promise<string> {
    return (await this.call({ type: "formatPreview", value, code }, "formatted")).text;
  }

  /** `value` with the number format `code`: text and the format's colour (`#RRGGBB`, `null` = none). */
  async formatSample(value: number, code: string): Promise<{ text: string; color: string | null }> {
    const r = await this.call({ type: "formatPreview", value, code }, "formatted");
    return { text: r.text, color: r.color ?? null };
  }

  /** Every defined name with its value (workbook names evaluated on `sheet`), for the Name Manager. */
  async names(sheet: number): Promise<NameRow[]> {
    return (await this.call({ type: "names", sheet }, "names")).names;
  }

  /** The name whose range is exactly `rect` on `sheet` (`null`: none). */
  async nameAt(sheet: number, rect: Rect): Promise<string | null> {
    const { name } = await this.call({ type: "nameAt", sheet, rect }, "nameAt");
    return typeof name === "string" ? name : null;
  }

  /** What the formula in the cell reads directly (Trace Precedents). */
  async precedents(sheet: number, row: number, col: number): Promise<SheetRect[]> {
    return (await this.call({ type: "precedents", sheet, row, col }, "trace")).refs;
  }

  /** The formula cells reading the cell (Trace Dependents). */
  async dependents(sheet: number, row: number, col: number): Promise<SheetRect[]> {
    return (await this.call({ type: "dependents", sheet, row, col }, "trace")).refs;
  }

  /** Background error checking of a sheet (P9-C4). */
  async errorChecks(sheet: number, rules: ErrorRule[]): Promise<ErrorIssue[]> {
    return (await this.call({ type: "errorChecks", sheet, rules }, "errorChecks")).issues;
  }

  /** Evaluate Formula's steps for a cell. */
  async evaluateFormula(sheet: number, row: number, col: number): Promise<Evaluation> {
    return (await this.call({ type: "evaluateFormula", sheet, row, col }, "evaluation")).evaluation;
  }

  /** The Watch Window's values. */
  async watchCells(cells: WatchCell[]): Promise<WatchItem[]> {
    return (await this.call({ type: "watchCells", cells }, "watch")).items;
  }

  /** Checks `input` (as typed) against the data validation of the cell, before `setInput`. */
  async validateInput(sheet: number, row: number, col: number, input: string): Promise<ValidationResult> {
    return (await this.call({ type: "validateInput", sheet, row, col, input }, "validation")).result;
  }

  /** The in-cell dropdown values of the cell's list validation (empty without one). */
  async listValues(sheet: number, row: number, col: number): Promise<string[]> {
    return (await this.call({ type: "listValues", sheet, row, col }, "listValues")).values;
  }

  /** The fills, font colours and icons of a column (`columns`: a row) of `range` – the Sort by / Filter by Color choices. */
  async lineColors(sheet: number, range: Rect, line: number, columns = false): Promise<LineColors> {
    return (await this.call({ type: "lineColors", sheet, ...range, line, columns }, "lineColors")).colors;
  }

  /** Circle Invalid Data: the cells of `sheet` whose values fail their validation (single-cell rects, at most 255). */
  async invalidCells(sheet: number): Promise<Rect[]> {
    return (await this.call({ type: "invalidCells", sheet }, "invalidCells")).cells;
  }

  /** The conditional formatting rules (by priority) and data validations of `sheet`. */
  async sheetRules(sheet: number): Promise<{ rules: CfRule[]; validations: DataValidation[] }> {
    const { rules, validations } = await this.call({ type: "sheetRules", sheet }, "sheetRules");
    return { rules, validations };
  }

  /** Every chart of `sheet`, back to front. */
  async sheetCharts(sheet: number): Promise<ChartObject[]> {
    return (await this.call({ type: "sheetCharts", sheet }, "charts")).charts;
  }

  /** The resolved data of chart `id` on `sheet`. */
  async chartData(sheet: number, id: number): Promise<ResolvedChart> {
    return (await this.call({ type: "chartData", sheet, id }, "chartData")).data;
  }

  /** The data `chart` would show on `sheet` (dialog previews). */
  async previewChartData(sheet: number, chart: Chart): Promise<ResolvedChart> {
    return (await this.call({ type: "previewChartData", sheet, chart }, "chartData")).data;
  }

  /** Excel's recommended chart for a range (`null` without numbers). */
  async recommendedChart(sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<Chart | null> {
    const { chart } = await this.call({ type: "recommendedChart", sheet, r0, c0, r1, c1 }, "recommendedChart");
    return chart && typeof chart === "object" ? chart : null;
  }

  /** The notes, threads and hyperlinks intersecting a rectangle, with its `HYPERLINK()` targets. */
  async cellAnnotations(sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<CellAnnotations> {
    return (await this.call({ type: "cellAnnotations", sheet, r0, c0, r1, c1 }, "annotations")).annotations;
  }

  /** The threads of `sheet`, or of every sheet with any (`null`). */
  async allComments(sheet: number | null): Promise<SheetThreads[]> {
    return (await this.call({ type: "allComments", sheet }, "comments")).sheets;
  }

  /** The field list and layout of pivot table `id` (the field pane). */
  async pivotInfo(id: number): Promise<PivotInfo> {
    return (await this.call({ type: "pivotInfo", id }, "pivotInfo")).info;
  }

  /** The pivot table at a cell and the cell's role (`null`: none). */
  async pivotAt(sheet: number, row: number, col: number): Promise<PivotAt | null> {
    const { pivot } = await this.call({ type: "pivotAt", sheet, row, col }, "pivotAt");
    return pivot && typeof pivot === "object" ? pivot : null;
  }

  /** The filter dropdown values of column `col` of table `id`. */
  async tableFilterValues(id: number, col: number): Promise<FilterValue[]> {
    return (await this.call({ type: "tableFilterValues", id, col }, "filterValues")).values;
  }

  /** Goal Seek: the value of the changing cell that makes the set cell `toValue` (nothing changes). */
  async goalSeek(sheet: number, set: { row: number; col: number }, toValue: number, changing: { row: number; col: number }): Promise<GoalSeekResult> {
    return (
      await this.call(
        { type: "goalSeek", sheet, setRow: set.row, setCol: set.col, toValue, changingRow: changing.row, changingCol: changing.col },
        "goalSeek",
      )
    ).result;
  }

  /** Step 1 of the text import wizard: the decoded text and the guessed separators. */
  async decodeText(bytesBase64: string, encoding?: TextEncoding): Promise<DecodedText> {
    return (await this.call({ type: "decodeText", bytesBase64, encoding }, "decoded")).decoded;
  }

  /** The wizard's preview: the first `max` records split with `options`. */
  async splitPreview(text: string, options: TextImportOptions, max: number): Promise<string[][]> {
    return (await this.call({ type: "splitPreview", text, options, max }, "preview")).rows;
  }

  /** Replaces the document by a text file split with `options`. */
  openText(text: string, name: string, options: TextImportOptions): Promise<BodyOf<"opened">> {
    return this.call({ type: "openText", text, name, options }, "opened");
  }

  /** One sheet as CSV (base64) plus the file name to offer. */
  saveCsv(sheet: number, options: CsvOptions): Promise<BodyOf<"saved">> {
    return this.call({ type: "saveCsv", sheet, options }, "saved");
  }

  /** The pictures of `sheet` with their images. */
  async sheetPictures(sheet: number): Promise<Picture[]> {
    return (await this.call({ type: "sheetPictures", sheet }, "pictures")).pictures;
  }

  /** The items of a field of pivot table `id` in display order (filter dropdowns). */
  async pivotItems(id: number, field: number): Promise<PivotItemInfo[]> {
    return (await this.call({ type: "pivotItems", id, field }, "pivotItems")).items;
  }

  /** Recommended PivotTables for a source, best first, with previews. */
  async recommendPivots(source: PivotSourceSpec): Promise<PivotRecommendation[]> {
    return (await this.call({ type: "recommendPivots", source }, "pivotRecommendations")).items;
  }
}
