// Typed wrappers over `Backend.dispatch` (ADR 0002 amendment, ADR 0005 §4).
// Every reply is checked against the `Response` union before use.

import type { Backend } from "@rusuite/ui-shared";
import type { Envelope } from "../../../../packages/ui-shared/src/generated/Envelope";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CfRule } from "../generated/CfRule";
import type { Chart } from "../generated/Chart";
import type { ChartObject } from "../generated/ChartObject";
import type { ResolvedChart } from "../generated/ResolvedChart";
import type { DataValidation } from "../generated/DataValidation";
import type { FilterValue } from "../generated/FilterValue";
import type { FoundCell } from "../generated/FoundCell";
import type { RegionSnapshot } from "../generated/RegionSnapshot";
import type { Request } from "../generated/Request";
import type { ResponseBody } from "../generated/ResponseBody";
import type { ValidationResult } from "../generated/ValidationResult";
import type { WorkbookInfo } from "../generated/WorkbookInfo";

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
    sheetRules: { rules: "array", validations: "array" },
    charts: { charts: "array" },
    chartData: { data: "object" },
    // `chart` is null without numeric data.
    recommendedChart: {},
    // `last` may be null (empty sheet): checked by the caller.
    usedRange: {},
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

  private async call<T extends ResponseBody["type"]>(request: Request, expected: T): Promise<BodyOf<T>> {
    let raw: unknown;
    try {
      raw = await this.backend.dispatch(request);
    } catch (e) {
      throw new CalcApiError("transport", e instanceof Error ? e.message : String(e));
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
  saveXlsx(): Promise<BodyOf<"saved">> {
    return this.call({ type: "saveXlsx" }, "saved");
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

  /** Checks `input` (as typed) against the data validation of the cell, before `setInput`. */
  async validateInput(sheet: number, row: number, col: number, input: string): Promise<ValidationResult> {
    return (await this.call({ type: "validateInput", sheet, row, col, input }, "validation")).result;
  }

  /** The in-cell dropdown values of the cell's list validation (empty without one). */
  async listValues(sheet: number, row: number, col: number): Promise<string[]> {
    return (await this.call({ type: "listValues", sheet, row, col }, "listValues")).values;
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
}
