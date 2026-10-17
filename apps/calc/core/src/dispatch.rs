//! The JSON entry point both shells call (ADR 0005 §3):
//! [`dispatch`]`(host, request_json) -> response_json`.

use app_common::{DispatchError, Envelope, Host, Revision};
use base64::Engine as _;
use model_sheet::{Workbook, WorkbookSnapshot};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{CalcCommand, Rect};
use crate::doc::CalcDocument;
use crate::patch::{CalcPatch, FoundCell, RegionSnapshot, WorkbookInfo};

/// The document host the shells keep (one per open document).
pub type CalcHost = Host<CalcDocument>;

/// A request from the UI. JSON: `{"type":"apply","command":{...}}`,
/// `{"type":"undo"}`, `{"type":"snapshot","sheet":0,"r0":0,...}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum Request {
    /// Applies a command → `patch`.
    Apply { command: Box<CalcCommand> },
    /// → `patch` (an empty patch with the current revision when there is
    /// nothing to undo).
    Undo,
    /// → `patch` (empty when there is nothing to redo).
    Redo,
    /// → `snapshot`.
    Snapshot {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// → `info`.
    Info,
    /// Replaces the document by an empty workbook → `info`.
    NewDocument,
    /// Replaces the document by a `WorkbookSnapshot` JSON → `info`.
    LoadSnapshotJson { json: String },
    /// → `snapshotJson` with the whole workbook as `WorkbookSnapshot`
    /// JSON (does not mark the document saved).
    SaveSnapshotJson,
    /// Replaces the document by an `.xlsx` file (standard base64 of its
    /// bytes; `name` is the file name shown to the user) → `opened`.
    OpenXlsx { bytes_base64: String, name: String },
    /// Writes the document as `.xlsx` → `saved`. Does NOT mark it saved:
    /// the shell sends `markSaved` once the file was really written.
    /// `activeSheet` (the UI's) becomes the sheet the file opens on.
    SaveXlsx {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        active_sheet: Option<u32>,
        /// Where the UI is scrolled to (the active sheet): saved as the
        /// view's `topLeftCell`s, as Excel does (view state, not undoable).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        scroll: Option<SheetScroll>,
    },
    /// Marks the current state as saved (after the shell wrote the file);
    /// `name` (save as) replaces the document's file name → `documentState`.
    MarkSaved {
        #[serde(default)]
        #[ts(optional)]
        name: Option<String>,
    },
    /// The whole document for crash recovery → `recoverySnapshot`
    /// (changes nothing; the JSON is the input of `restoreRecovery`).
    RecoverySnapshot,
    /// Replaces the document by a `recoverySnapshot` JSON and marks it
    /// dirty (it was never saved); `name` becomes the file name → `info`.
    RestoreRecovery {
        json: String,
        #[serde(default)]
        #[ts(optional)]
        name: Option<String>,
    },
    /// → `documentState`.
    DocumentState,
    /// Cells whose input or displayed value contains `query` (`wholeCell`:
    /// equals it), on `sheet` or (`null`) every sheet → `found`.
    FindCells {
        sheet: Option<u32>,
        query: String,
        match_case: bool,
        whole_cell: bool,
    },
    /// `value` displayed with the number format `code` → `formatted`
    /// (the Format Cells dialog's preview).
    FormatPreview { value: f64, code: String },
    /// The last used cell of `sheet` (content or own style) → `usedRange`.
    UsedRange { sheet: u32 },
    /// The value list of AutoFilter column `col` (absolute) for its
    /// dropdown → `filterValues`.
    FilterValues { sheet: u32, col: u32 },
    /// Checks `input` (as typed) against the data validation of the cell
    /// before the UI sends `setInput` → `validation`. The UI decides by
    /// `errorStyle` whether a failed check rejects (`stop`), asks
    /// (`warning`) or only informs (`information`).
    ValidateInput {
        sheet: u32,
        row: u32,
        col: u32,
        input: String,
    },
    /// The in-cell dropdown values of the cell's list validation →
    /// `listValues` (empty without one).
    ListValues { sheet: u32, row: u32, col: u32 },
    /// Data › Data Validation › Circle Invalid Data: the cells of `sheet`
    /// whose values fail their validation (at most 255) → `invalidCells`.
    InvalidCells { sheet: u32 },
    /// The fills, font colours and icons of line `line` (a column; a row
    /// with `columns`) of the range → `lineColors` (Sort by Color, Filter
    /// by Color).
    LineColors {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
        line: u32,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        columns: bool,
    },
    /// The conditional formatting rules (priority order) and the data
    /// validations of `sheet` (for the manage dialogs) → `sheetRules`.
    SheetRules { sheet: u32 },
    /// The charts of `sheet`, back to front → `charts`.
    SheetCharts { sheet: u32 },
    /// The sparkline groups of `sheet` with the data of every sparkline
    /// → `sparklines`.
    SheetSparklines { sheet: u32 },
    /// The data of chart `id` on `sheet` as the renderer draws it →
    /// `chartData`.
    ChartData { sheet: u32, id: u32 },
    /// The data of a chart not on the sheet (dialog previews; references
    /// without a sheet resolve on `sheet`) → `chartData`.
    PreviewChartData {
        sheet: u32,
        #[ts(as = "crate::wire_chart::Chart")]
        chart: Box<core_model::chart::Chart>,
    },
    /// Excel's recommended chart for the selection (a single cell: its
    /// current region) → `recommendedChart` (`null` without numbers).
    RecommendedChart {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// Every defined name with its value (workbook names evaluated on
    /// `sheet`) for the Name Manager → `names`.
    Names { sheet: u32 },
    /// The name whose range is exactly `rect` on `sheet` (the Name Box
    /// shows it instead of the address) → `nameAt`.
    NameAt { sheet: u32, rect: Rect },
    /// The cells and ranges the formula in the cell reads directly
    /// (Trace Precedents) → `trace`.
    Precedents { sheet: u32, row: u32, col: u32 },
    /// The formula cells reading the cell (Trace Dependents) → `trace`.
    Dependents { sheet: u32, row: u32, col: u32 },
    /// Background error checking of a sheet with the given rules (absent:
    /// Excel's defaults) → `errorChecks` (P9-C4).
    ErrorChecks {
        sheet: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        rules: Option<Vec<crate::audit::ErrorRule>>,
    },
    /// Evaluate Formula of a cell → `evaluation`.
    EvaluateFormula { sheet: u32, row: u32, col: u32 },
    /// The Watch Window's values → `watch`.
    WatchCells { cells: Vec<crate::audit::WatchCell> },
    /// The notes, threads and hyperlinks intersecting the rectangle, plus
    /// the targets of its `HYPERLINK()` cells → `annotations`.
    CellAnnotations {
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// The threads of `sheet` or (`null`) of every sheet that has any
    /// (the Comments pane) → `comments`.
    AllComments { sheet: Option<u32> },
    /// Pivot table `id`: its definition, source and field list (the
    /// PivotTable Fields pane) → `pivotInfo`.
    PivotInfo { id: u32 },
    /// The pivot table containing the cell, if any → `pivotAt`.
    PivotAt { sheet: u32, row: u32, col: u32 },
    /// The items of cache field `field` of pivot table `id` in display
    /// order, with their checked state (filter dropdowns) → `pivotItems`.
    PivotItems { id: u32, field: u32 },
    /// Insert › Recommended PivotTables: candidate layouts for a source
    /// with previews → `pivotRecommendations`.
    RecommendPivots {
        source: crate::pivots::PivotSourceSpec,
    },
    /// The filter dropdown values of column `col` of table `id`.
    TableFilterValues { id: u32, col: u32 },
    /// What-If Analysis › Goal Seek (nothing changes; apply the value
    /// with `setInput`).
    GoalSeek {
        sheet: u32,
        set_row: u32,
        set_col: u32,
        to_value: f64,
        changing_row: u32,
        changing_col: u32,
    },
    /// Step 1 of the text import wizard: decode the bytes (encoding
    /// absent = detect) and guess the separators.
    DecodeText {
        bytes_base64: String,
        #[serde(default)]
        #[ts(optional, as = "Option<crate::wire_tables::TextEncoding>")]
        encoding: Option<model_sheet::textio::TextEncoding>,
    },
    /// The wizard's preview: the first `max` records split with `options`.
    SplitPreview {
        text: String,
        #[ts(as = "crate::wire_tables::TextImportOptions")]
        options: model_sheet::textio::TextImportOptions,
        max: u32,
    },
    /// Opens a text file as a new document (replaces the document).
    OpenText {
        text: String,
        name: String,
        #[ts(as = "crate::wire_tables::TextImportOptions")]
        options: model_sheet::textio::TextImportOptions,
    },
    /// Save As CSV of one sheet.
    SaveCsv {
        sheet: u32,
        #[ts(as = "crate::wire_tables::CsvOptions")]
        options: model_sheet::textio::CsvOptions,
    },
    /// The pictures of a sheet (with their images).
    SheetPictures { sheet: u32 },
    /// Go To Special (Ctrl+G › Special…): the cells of `range` (one cell =
    /// the used range) matching `kind`, `(row, col)` being the active cell
    /// → `areas` (row-major rectangles; empty = "No cells were found.").
    GoToSpecial {
        sheet: u32,
        range: Rect,
        row: u32,
        col: u32,
        kind: crate::goto::GoToKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        types: Option<crate::goto::GoToTypes>,
        /// Precedents / dependents: all levels (else direct only).
        #[serde(default)]
        #[ts(optional)]
        all_levels: Option<bool>,
    },
    /// The fill handle's tip while dragging `src` over `dst` → `fillPreview`
    /// (the text the farthest filled cell would show; `null` for a copied
    /// formula).
    FillPreview {
        sheet: u32,
        src: Rect,
        dst: Rect,
        mode: crate::command::FillMode,
    },
}

/// The scroll position of a sheet's panes (`saveXlsx`): the first row and
/// column of the top-left pane and of the scrolling (bottom-right) pane.
/// With frozen panes only the scrolling pane's position counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetScroll {
    pub sheet: u32,
    pub top_row: u32,
    pub left_col: u32,
    pub pane_row: u32,
    pub pane_col: u32,
}

/// The successful part of a [`Response`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum ResponseBody {
    Patch {
        envelope: Envelope<CalcPatch>,
    },
    Snapshot {
        snapshot: RegionSnapshot,
    },
    Info {
        info: WorkbookInfo,
    },
    SnapshotJson {
        json: String,
    },
    /// The reply to `openXlsx`: the new workbook, the reader's warnings
    /// (dropped or approximated content) and the host state (empty patch,
    /// new revision, clean).
    Opened {
        info: WorkbookInfo,
        warnings: Vec<String>,
        envelope: Box<Envelope<CalcPatch>>,
    },
    /// The reply to `saveXlsx`: the file (standard base64) and the file
    /// name to offer.
    Saved {
        bytes_base64: String,
        suggested_name: String,
    },
    /// The reply to `recoverySnapshot`: the whole workbook (`WorkbookSnapshot`) as JSON plus
    /// the host state it was taken at.
    RecoverySnapshot {
        json: String,
        revision: Revision,
        dirty: bool,
        name: Option<String>,
    },
    /// Host state for the title bar: dirty flag, revision and the file
    /// name (`null` for a new document).
    DocumentState {
        dirty: bool,
        revision: Revision,
        name: Option<String>,
    },
    /// The reply to `findCells`, in sheet order then row-major order.
    Found {
        cells: Vec<FoundCell>,
    },
    /// The reply to `formatPreview`: the text and the format's colour
    /// (`#RRGGBB`, absent = none).
    Formatted {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<String>,
    },
    /// The reply to `goToSpecial`.
    Areas {
        areas: Vec<Rect>,
    },
    /// The reply to `fillPreview`.
    FillPreview {
        text: Option<String>,
    },
    /// The reply to `names`.
    Names {
        names: Vec<crate::names::NameRow>,
    },
    /// The reply to `nameAt`.
    NameAt {
        name: Option<String>,
    },
    /// The reply to `errorChecks`.
    ErrorChecks {
        issues: Vec<crate::audit::ErrorIssue>,
    },
    /// The reply to `evaluateFormula`.
    Evaluation {
        evaluation: crate::audit::Evaluation,
    },
    /// The reply to `watchCells`.
    Watch {
        items: Vec<crate::audit::WatchItem>,
    },
    /// The reply to `precedents` / `dependents`.
    Trace {
        refs: Vec<crate::command::SheetRect>,
    },
    /// The reply to `usedRange`: `[row, col]` of the last used cell,
    /// `null` for an empty sheet.
    UsedRange {
        last: Option<(u32, u32)>,
    },
    /// The reply to `filterValues`: distinct displayed values with their
    /// row counts, ordered like an ascending sort, blanks (`""`) last.
    /// Rows hidden by the other columns' filters are left out.
    FilterValues {
        #[ts(as = "Vec<crate::wire::FilterValue>")]
        values: Vec<model_sheet::FilterValue>,
    },
    /// The reply to `validateInput`.
    Validation {
        #[ts(as = "crate::wire_cf::ValidationResult")]
        result: model_sheet::ValidationResult,
    },
    /// The reply to `listValues`: the values as displayed, in source
    /// order (blank source cells left out).
    ListValues {
        values: Vec<String>,
    },
    /// The reply to `invalidCells`: one single-cell rectangle per cell,
    /// row-major.
    InvalidCells {
        cells: Vec<crate::Rect>,
    },
    /// The reply to `lineColors`.
    LineColors {
        #[ts(as = "crate::wire::LineColors")]
        colors: model_sheet::LineColors,
    },
    /// The reply to `sheetCharts`.
    Charts {
        #[ts(as = "Vec<crate::wire_chart::ChartObject>")]
        charts: Vec<model_sheet::ChartObject>,
    },
    /// The reply to `sheetSparklines`.
    Sparklines {
        groups: Vec<crate::sparklines::SparklineGroupView>,
    },
    /// The reply to `chartData` and `previewChartData`.
    ChartData {
        #[ts(as = "crate::wire_chart::ResolvedChart")]
        data: core_model::chart::ResolvedChart,
        /// Per series: custom error bar amounts and "Value From Cells"
        /// texts (absent when no series has any).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<crate::wire_chart::SeriesExtras>>")]
        extras: Vec<model_sheet::SeriesExtras>,
    },
    /// The reply to `recommendedChart`.
    RecommendedChart {
        #[ts(as = "Option<crate::wire_chart::Chart>")]
        chart: Option<Box<core_model::chart::Chart>>,
    },
    /// The reply to `cellAnnotations`.
    Annotations {
        annotations: crate::annotations::CellAnnotations,
    },
    /// The reply to `allComments`, in sheet order.
    Comments {
        sheets: Vec<crate::annotations::SheetThreads>,
    },
    /// The reply to `pivotInfo`.
    PivotInfo {
        info: Box<crate::pivots::PivotInfo>,
    },
    /// The reply to `pivotAt` (`null`: no pivot table there).
    PivotAt {
        pivot: Option<crate::pivots::PivotAt>,
    },
    /// The reply to `pivotItems`.
    PivotItems {
        items: Vec<crate::pivots::PivotItemInfo>,
    },
    /// The reply to `recommendPivots`.
    PivotRecommendations {
        items: Vec<crate::pivots::PivotRecommendation>,
    },
    /// The reply to `sheetRules`.
    GoalSeek {
        result: crate::datatools::GoalSeekResult,
    },
    Decoded {
        decoded: crate::datatools::DecodedText,
    },
    Preview {
        rows: Vec<Vec<String>>,
    },
    Pictures {
        #[ts(as = "Vec<crate::wire_tables::Picture>")]
        pictures: Vec<model_sheet::Picture>,
    },
    SheetRules {
        #[ts(as = "Vec<crate::wire_cf::CfRule>")]
        rules: Vec<model_sheet::CfRule>,
        #[ts(as = "Vec<crate::wire_cf::DataValidation>")]
        validations: Vec<model_sheet::DataValidation>,
    },
}

/// The reply: `{"ok":{"type":"patch",...}}` or
/// `{"err":{"code":"bad_request","message":"..."}}`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
// One short-lived value per request: its size does not matter.
#[allow(clippy::large_enum_variant)]
pub enum Response {
    Ok(ResponseBody),
    Err(DispatchError),
}

fn handle(host: &mut CalcHost, request: Request) -> Result<ResponseBody, DispatchError> {
    let patch = |env: Option<Envelope<CalcPatch>>, host: &CalcHost| ResponseBody::Patch {
        envelope: env.unwrap_or_else(|| host.envelope(CalcPatch::default())),
    };
    let workbook_info = |host: &CalcHost| WorkbookInfo {
        revision: host.revision(),
        ..host.doc().info()
    };
    let info = |host: &CalcHost| ResponseBody::Info {
        info: workbook_info(host),
    };
    let state = |host: &CalcHost| ResponseBody::DocumentState {
        dirty: host.is_dirty(),
        revision: host.revision(),
        name: host.doc().source_name.clone(),
    };
    Ok(match request {
        Request::Apply { command } => {
            let env = host.apply(*command)?;
            patch(Some(env), host)
        }
        Request::Undo => {
            let env = host.undo()?;
            patch(env, host)
        }
        Request::Redo => {
            let env = host.redo()?;
            patch(env, host)
        }
        Request::Snapshot {
            sheet,
            r0,
            c0,
            r1,
            c1,
        } => ResponseBody::Snapshot {
            snapshot: host.doc().snapshot(sheet, r0, c0, r1, c1)?,
        },
        Request::Info => info(host),
        Request::NewDocument => {
            host.replace(CalcDocument::new());
            info(host)
        }
        Request::LoadSnapshotJson { json } => {
            let snapshot: WorkbookSnapshot = serde_json::from_str(&json)
                .map_err(|e| DispatchError::new("invalid_snapshot", e.to_string()))?;
            let workbook = Workbook::from_snapshot(&snapshot)
                .map_err(|e| DispatchError::from(crate::CalcError::from(e)))?;
            host.replace(CalcDocument::from_workbook(workbook));
            info(host)
        }
        Request::SaveSnapshotJson => ResponseBody::SnapshotJson {
            json: serde_json::to_string(&host.doc().workbook().to_snapshot())
                .map_err(|e| DispatchError::new("internal", e.to_string()))?,
        },
        Request::OpenXlsx { bytes_base64, name } => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_base64.as_bytes())
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            let (doc, warnings) = CalcDocument::open_xlsx(&bytes, &name)?;
            host.replace(doc);
            ResponseBody::Opened {
                info: workbook_info(host),
                warnings,
                envelope: Box::new(host.envelope(CalcPatch::default())),
            }
        }
        Request::SaveXlsx {
            active_sheet,
            scroll,
        } => {
            if let Some(id) = active_sheet {
                let id = model_sheet::SheetId(id);
                host.doc_mut().workbook_mut().set_active_sheet(Some(id));
            }
            if let Some(sc) = scroll {
                host.doc_mut().set_scroll(sc)?;
            }
            let bytes = host.doc().save_xlsx()?;
            ResponseBody::Saved {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                suggested_name: host.doc().suggested_name(),
            }
        }
        Request::MarkSaved { name } => {
            if let Some(name) = name {
                host.doc_mut().source_name = Some(name);
            }
            host.mark_saved();
            state(host)
        }
        Request::RecoverySnapshot => ResponseBody::RecoverySnapshot {
            json: serde_json::to_string(&host.doc().workbook().to_snapshot())
                .map_err(|e| DispatchError::new("internal", e.to_string()))?,
            revision: host.revision(),
            dirty: host.is_dirty(),
            name: host.doc().source_name.clone(),
        },
        Request::RestoreRecovery { json, name } => {
            let snapshot: WorkbookSnapshot = serde_json::from_str(&json)
                .map_err(|e| DispatchError::new("invalid_snapshot", e.to_string()))?;
            let workbook = Workbook::from_snapshot(&snapshot)
                .map_err(|e| DispatchError::from(crate::CalcError::from(e)))?;
            let mut doc = CalcDocument::from_workbook(workbook);
            doc.source_name = name;
            host.replace(doc);
            host.mark_dirty();
            info(host)
        }
        Request::DocumentState => state(host),
        Request::FindCells {
            sheet,
            query,
            match_case,
            whole_cell,
        } => ResponseBody::Found {
            cells: host
                .doc()
                .find_cells(sheet, &query, match_case, whole_cell)?,
        },
        Request::FilterValues { sheet, col } => ResponseBody::FilterValues {
            values: host.doc().filter_values(sheet, col)?,
        },
        Request::ValidateInput {
            sheet,
            row,
            col,
            input,
        } => ResponseBody::Validation {
            result: host.doc().validate_input(sheet, row, col, &input)?,
        },
        Request::ListValues { sheet, row, col } => ResponseBody::ListValues {
            values: host.doc().list_values(sheet, row, col)?,
        },
        Request::InvalidCells { sheet } => ResponseBody::InvalidCells {
            cells: host.doc().invalid_cells(sheet)?,
        },
        Request::LineColors {
            sheet,
            r0,
            c0,
            r1,
            c1,
            line,
            columns,
        } => {
            let range = host.doc().range(sheet, r0, c0, r1, c1)?;
            ResponseBody::LineColors {
                colors: host.doc().workbook().line_colors(range, line, columns),
            }
        }
        Request::SheetRules { sheet } => {
            let (rules, validations) = host.doc().sheet_rules(sheet)?;
            ResponseBody::SheetRules { rules, validations }
        }
        Request::SheetCharts { sheet } => ResponseBody::Charts {
            charts: host.doc().sheet_charts(sheet)?,
        },
        Request::SheetSparklines { sheet } => ResponseBody::Sparklines {
            groups: host.doc().sheet_sparklines(sheet)?,
        },
        Request::ChartData { sheet, id } => {
            let (data, extras) = host.doc().chart_data(sheet, id)?;
            ResponseBody::ChartData { data, extras }
        }
        Request::PreviewChartData { sheet, chart } => {
            let (data, extras) = host.doc().preview_chart_data(sheet, &chart)?;
            ResponseBody::ChartData { data, extras }
        }
        Request::RecommendedChart {
            sheet,
            r0,
            c0,
            r1,
            c1,
        } => ResponseBody::RecommendedChart {
            chart: host
                .doc()
                .recommended_chart(sheet, r0, c0, r1, c1)?
                .map(Box::new),
        },
        Request::UsedRange { sheet } => ResponseBody::UsedRange {
            last: host.doc().used_range(sheet)?,
        },
        Request::FormatPreview { value, code } => {
            let f = model_sheet::numfmt::format_cell(
                &engine_formula::Value::Number(value),
                Some(code.as_str()),
            );
            ResponseBody::Formatted {
                text: f.text,
                color: f.color.map(crate::display::css_color),
            }
        }
        Request::Names { sheet } => ResponseBody::Names {
            names: host.doc().name_rows(sheet)?,
        },
        Request::NameAt { sheet, rect } => ResponseBody::NameAt {
            name: host.doc().name_at(sheet, rect)?,
        },
        Request::ErrorChecks { sheet, rules } => ResponseBody::ErrorChecks {
            issues: host.doc().error_checks(
                sheet,
                rules.as_deref().unwrap_or(&crate::audit::DEFAULT_RULES),
            )?,
        },
        Request::EvaluateFormula { sheet, row, col } => ResponseBody::Evaluation {
            evaluation: host.doc().evaluate_steps(sheet, row, col)?,
        },
        Request::WatchCells { cells } => ResponseBody::Watch {
            items: host.doc().watch_cells(&cells),
        },
        Request::Precedents { sheet, row, col } => ResponseBody::Trace {
            refs: host.doc().precedents(sheet, row, col)?,
        },
        Request::Dependents { sheet, row, col } => ResponseBody::Trace {
            refs: host.doc().dependents(sheet, row, col)?,
        },
        Request::CellAnnotations {
            sheet,
            r0,
            c0,
            r1,
            c1,
        } => ResponseBody::Annotations {
            annotations: host.doc().cell_annotations(sheet, r0, c0, r1, c1)?,
        },
        Request::AllComments { sheet } => ResponseBody::Comments {
            sheets: host.doc().all_comments(sheet)?,
        },
        Request::PivotInfo { id } => ResponseBody::PivotInfo {
            info: Box::new(host.doc().pivot_info(id)?),
        },
        Request::PivotAt { sheet, row, col } => ResponseBody::PivotAt {
            pivot: host.doc().pivot_at(sheet, row, col)?,
        },
        Request::PivotItems { id, field } => ResponseBody::PivotItems {
            items: host.doc().pivot_items(id, field)?,
        },
        Request::RecommendPivots { source } => ResponseBody::PivotRecommendations {
            items: host.doc().recommend_pivots(&source)?,
        },
        Request::TableFilterValues { id, col } => {
            let doc = host.doc();
            let (s, _) = doc.workbook().table(id).ok_or_else(|| {
                DispatchError::from(crate::CalcError::Model(model_sheet::Error::UnknownTable(
                    id,
                )))
            })?;
            ResponseBody::FilterValues {
                values: doc
                    .workbook()
                    .table_filter_values(s, id, col)
                    .map_err(|e| DispatchError::from(crate::CalcError::from(e)))?,
            }
        }
        Request::GoalSeek {
            sheet,
            set_row,
            set_col,
            to_value,
            changing_row,
            changing_col,
        } => ResponseBody::GoalSeek {
            result: host.doc_mut().goal_seek(
                sheet,
                (set_row, set_col),
                to_value,
                (changing_row, changing_col),
            )?,
        },
        Request::DecodeText {
            bytes_base64,
            encoding,
        } => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes_base64.as_bytes())
                .map_err(|e| DispatchError::new("bad_request", format!("invalid base64: {e}")))?;
            ResponseBody::Decoded {
                decoded: crate::datatools::decode_text(&bytes, encoding),
            }
        }
        Request::SplitPreview { text, options, max } => ResponseBody::Preview {
            rows: crate::datatools::split_preview(&text, &options, max as usize),
        },
        Request::OpenText {
            text,
            name,
            options,
        } => {
            let doc = CalcDocument::open_text(&text, &name, &options)?;
            host.replace(doc);
            ResponseBody::Opened {
                info: workbook_info(host),
                warnings: Vec::new(),
                envelope: Box::new(host.envelope(CalcPatch::default())),
            }
        }
        Request::SaveCsv { sheet, options } => {
            let bytes = host.doc().save_csv(sheet, &options)?;
            let stem = host
                .doc()
                .source_name
                .as_deref()
                .map(|n| n.rsplit_once('.').map_or(n, |(s, _)| s).to_owned())
                .unwrap_or_else(|| "Untitled".into());
            ResponseBody::Saved {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                suggested_name: format!("{stem}.csv"),
            }
        }
        Request::SheetPictures { sheet } => ResponseBody::Pictures {
            pictures: host.doc().sheet_pictures(sheet)?,
        },
        Request::GoToSpecial {
            sheet,
            range,
            row,
            col,
            kind,
            types,
            all_levels,
        } => ResponseBody::Areas {
            areas: host.doc().go_to_special(
                sheet,
                range,
                row,
                col,
                kind,
                types.unwrap_or_default(),
                all_levels.unwrap_or(false),
            )?,
        },
        Request::FillPreview {
            sheet,
            src,
            dst,
            mode,
        } => ResponseBody::FillPreview {
            text: host.doc().fill_preview(sheet, src, dst, mode)?,
        },
    })
}

/// Decodes a [`Request`], runs it against `host` and encodes the
/// [`Response`]. Never panics on bad input: undecodable JSON yields a
/// `bad_request` error response.
pub fn dispatch(host: &mut CalcHost, request_json: &str) -> String {
    let response = match serde_json::from_str::<Request>(request_json) {
        Ok(request) => match handle(host, request) {
            Ok(body) => Response::Ok(body),
            Err(e) => Response::Err(e),
        },
        Err(e) => Response::Err(DispatchError::new("bad_request", e.to_string())),
    };
    serde_json::to_string(&response).unwrap_or_else(|e| {
        let message = serde_json::to_string(&e.to_string()).unwrap_or_else(|_| "\"\"".into());
        format!(r#"{{"err":{{"code":"internal","message":{message}}}}}"#)
    })
}
