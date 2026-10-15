//! [`WorkbookSnapshot`]: the serializable form of a [`Workbook`], shared
//! by serde, the IPC layer and `fmt-xlsx`.

use engine_formula::{CellContent, CellCoord, ErrorKind, RangeRef, SheetId, Value};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::condfmt::CfRule;
use crate::sheet::{ColInfo, MergeRect, RowInfo, SheetFormat, SheetView};
use crate::sortfilter::{AutoFilter, SortState};
use crate::style::{CellStyle, StyleId, StyleTable};
use crate::validation::DataValidation;
use crate::workbook::Workbook;
use crate::Error;

/// A whole workbook: sheets in order plus the style table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSnapshot {
    pub sheets: Vec<SheetSnapshot>,
    /// Indexed by [`StyleId`]; entry 0 is the default style. On load,
    /// duplicates are merged and ids remapped.
    pub styles: Vec<CellStyle>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSnapshot {
    pub name: String,
    /// Sparse, row-major: cells with content or an own style.
    #[serde(default)]
    pub cells: Vec<CellSnapshot>,
    #[serde(default)]
    pub cols: Vec<ColSnapshot>,
    #[serde(default)]
    pub rows: Vec<RowSnapshot>,
    #[serde(default)]
    pub format: SheetFormat,
    /// Colour of the sheet tab; absent = default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<core_model::Color>,
    /// Frozen panes, zoom, gridlines, headings; absent = defaults.
    #[serde(default, skip_serializing_if = "SheetView::is_default")]
    pub view: SheetView,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    /// Excel's `veryHidden` (only meaningful with `hidden`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub very_hidden: bool,
    /// Merged ranges, sorted by top-left cell.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merges: Vec<MergeRect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter: Option<AutoFilter>,
    /// The last sort.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<SortState>,
    /// Conditional formatting rules in priority order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_formats: Vec<CfRule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validations: Vec<DataValidation>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellSnapshot {
    pub row: u32,
    pub col: u32,
    /// Formula text (with `=`) or the constant as it would be typed
    /// (re-parsed with [`Workbook::set_input`]; text that would parse as
    /// something else gets a leading `'`). Empty for style-only cells.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub input: String,
    #[serde(default, skip_serializing_if = "is_default_style")]
    pub style: StyleId,
}

fn is_default_style(id: &StyleId) -> bool {
    id.is_default()
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColSnapshot {
    pub col: u32,
    #[serde(flatten)]
    pub info: ColInfo,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowSnapshot {
    pub row: u32,
    #[serde(flatten)]
    pub info: RowInfo,
}

/// The input text that makes [`Workbook::set_input`] reproduce `content`
/// (`""` for a spilled cell: the engine recreates it from its anchor).
pub fn content_to_input(content: &CellContent) -> String {
    match content {
        CellContent::Empty | CellContent::Spilled { .. } => String::new(),
        CellContent::Formula { text, .. } => text.clone(),
        CellContent::Value(v) => match v {
            // `f64` Display is the shortest exact round-trip form.
            Value::Number(n) => format!("{n}"),
            Value::Text(t) if text_needs_quote(t) => format!("'{t}"),
            Value::Text(t) => t.clone(),
            Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
            Value::Error(e) => e.to_string(),
            // Never stored by the engine.
            Value::Empty | Value::Array(_) => String::new(),
        },
    }
}

/// Whether `set_input(t)` would *not* yield `Text(t)`.
fn text_needs_quote(t: &str) -> bool {
    t.is_empty()
        || t.starts_with(['=', '\''])
        || t.eq_ignore_ascii_case("TRUE")
        || t.eq_ignore_ascii_case("FALSE")
        || t.parse::<ErrorKind>().is_ok()
        || (t.trim() == t && engine_formula::value::parse_number_text(t).is_some())
}

impl Workbook {
    /// The snapshot of the whole workbook.
    pub fn to_snapshot(&self) -> WorkbookSnapshot {
        let sheets = self
            .engine()
            .sheets()
            .map(|(id, name)| self.sheet_snapshot(id, name))
            .collect();
        WorkbookSnapshot {
            sheets,
            styles: self.styles().iter().map(|(_, s)| s.clone()).collect(),
        }
    }

    fn sheet_snapshot(&self, id: SheetId, name: &str) -> SheetSnapshot {
        let all = RangeRef::new(
            id,
            0,
            0,
            engine_formula::ast::MAX_ROW,
            engine_formula::ast::MAX_COL,
        );
        SheetSnapshot {
            name: name.to_string(),
            cells: self
                .cells_in(all)
                .map(|(c, content, style)| CellSnapshot {
                    row: c.row,
                    col: c.col,
                    input: content_to_input(content),
                    style,
                })
                .collect(),
            cols: self
                .cols(id)
                .map(|(col, info)| ColSnapshot { col, info })
                .collect(),
            rows: self
                .rows(id)
                .map(|(row, info)| RowSnapshot { row, info })
                .collect(),
            format: self.sheet_format(id),
            tab_color: self.tab_color(id),
            view: self.sheet_view(id),
            hidden: self.is_sheet_hidden(id),
            very_hidden: self.is_sheet_very_hidden(id),
            merges: self.merges(id).to_vec(),
            auto_filter: self.auto_filter(id).cloned(),
            sort_state: self.sort_state(id).cloned(),
            conditional_formats: self.cf_rules(id).to_vec(),
            validations: self.validations(id).to_vec(),
        }
    }

    /// Builds a workbook from a snapshot: contents are loaded in one engine
    /// batch, whose `end_batch` evaluates every loaded formula. A snapshot
    /// whose sheets are all hidden keeps its last sheet shown.
    pub fn from_snapshot(snapshot: &WorkbookSnapshot) -> Result<Workbook, Error> {
        if snapshot.sheets.is_empty() {
            return Err(Error::InvalidSnapshot(
                "a workbook needs at least one sheet".into(),
            ));
        }
        let mut wb = Workbook::new();
        let (table, remap) = StyleTable::from_list(&snapshot.styles);
        for (id, style) in table.iter() {
            let interned = wb.intern_style(style);
            debug_assert_eq!(interned, id);
        }
        let style = |id: StyleId| {
            remap
                .get(id.0 as usize)
                .copied()
                .ok_or(Error::UnknownStyle(id))
        };
        let map_opt = |id: Option<StyleId>| id.map(style).transpose();
        let mut ids = Vec::with_capacity(snapshot.sheets.len());
        for (i, sheet) in snapshot.sheets.iter().enumerate() {
            if i == 0 {
                wb.rename_sheet(SheetId(0), &sheet.name)?;
                ids.push(SheetId(0));
            } else {
                ids.push(wb.add_sheet(&sheet.name)?);
            }
        }
        wb.begin_batch();
        let loaded = (|| -> Result<(), Error> {
            for (sheet, &id) in snapshot.sheets.iter().zip(&ids) {
                wb.set_sheet_format(id, sheet.format)?;
                wb.set_tab_color(id, sheet.tab_color)?;
                wb.set_sheet_view(id, sheet.view)?;
                wb.set_merges(id, sheet.merges.clone())?;
                wb.set_auto_filter(id, sheet.auto_filter.clone())?;
                wb.set_sort_state(id, sheet.sort_state.clone())?;
                wb.set_cf_rules(id, sheet.conditional_formats.clone())?;
                wb.set_validations(id, sheet.validations.clone())?;
                for col in &sheet.cols {
                    let info = ColInfo {
                        style: map_opt(col.info.style)?,
                        ..col.info
                    };
                    wb.set_col_info(id, col.col, info)?;
                }
                for row in &sheet.rows {
                    let info = RowInfo {
                        style: map_opt(row.info.style)?,
                        ..row.info
                    };
                    wb.set_row_info(id, row.row, info)?;
                }
                for cell in &sheet.cells {
                    let c = CellCoord::new(id, cell.row, cell.col);
                    if !cell.input.is_empty() {
                        wb.set_input(c, &cell.input)?;
                    }
                    wb.set_style(c, style(cell.style)?)?;
                }
            }
            Ok(())
        })();
        wb.end_batch();
        loaded?;
        // Visibility last: hiding needs another visible sheet.
        for (sheet, &id) in snapshot.sheets.iter().zip(&ids) {
            if sheet.hidden {
                // Fails only for the last visible sheet, which stays shown.
                let _ = wb.set_sheet_visibility(id, true, sheet.very_hidden);
            }
        }
        Ok(wb)
    }
}

impl Serialize for Workbook {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_snapshot().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Workbook {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let snapshot = WorkbookSnapshot::deserialize(deserializer)?;
        Workbook::from_snapshot(&snapshot).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_roundtrip_through_input() {
        let values = [
            Value::Number(0.1 + 0.2),
            Value::Number(1e300),
            Value::Number(-1.5e-300),
            Value::Number(42.0),
            Value::Text("12".into()),
            Value::Text("=A1".into()),
            Value::Text("'x".into()),
            Value::Text("true".into()),
            Value::Text("#N/A".into()),
            Value::Text("50%".into()),
            Value::Text(" 12".into()),
            Value::Text(String::new()),
            Value::Text("hello".into()),
            Value::Bool(false),
            Value::Error(ErrorKind::Div0),
        ];
        let mut wb = Workbook::new();
        let c = CellCoord::new(SheetId(0), 0, 0);
        for v in values {
            let content = CellContent::Value(v);
            wb.set_input(c, &content_to_input(&content)).unwrap();
            assert_eq!(wb.content(c), &content);
        }
    }
}
