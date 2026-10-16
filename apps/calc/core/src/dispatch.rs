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
    SaveXlsx,
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
    /// The conditional formatting rules (priority order) and the data
    /// validations of `sheet` (for the manage dialogs) → `sheetRules`.
    SheetRules { sheet: u32 },
    /// The charts of `sheet`, back to front → `charts`.
    SheetCharts { sheet: u32 },
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
    /// The reply to `names`.
    Names {
        names: Vec<crate::names::NameRow>,
    },
    /// The reply to `nameAt`.
    NameAt {
        name: Option<String>,
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
    /// The reply to `sheetCharts`.
    Charts {
        #[ts(as = "Vec<crate::wire_chart::ChartObject>")]
        charts: Vec<model_sheet::ChartObject>,
    },
    /// The reply to `chartData` and `previewChartData`.
    ChartData {
        #[ts(as = "crate::wire_chart::ResolvedChart")]
        data: core_model::chart::ResolvedChart,
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
        Request::SaveXlsx => {
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
        Request::SheetRules { sheet } => {
            let (rules, validations) = host.doc().sheet_rules(sheet)?;
            ResponseBody::SheetRules { rules, validations }
        }
        Request::SheetCharts { sheet } => ResponseBody::Charts {
            charts: host.doc().sheet_charts(sheet)?,
        },
        Request::ChartData { sheet, id } => ResponseBody::ChartData {
            data: host.doc().chart_data(sheet, id)?,
        },
        Request::PreviewChartData { sheet, chart } => ResponseBody::ChartData {
            data: host.doc().preview_chart_data(sheet, &chart)?,
        },
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
