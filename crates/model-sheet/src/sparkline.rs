//! Sparklines (P9-C6): tiny charts drawn inside cells, in groups that
//! share their formatting (Excel 2010's `x14:sparklineGroups`).
//!
//! A [`SparklineGroup`] holds the type (line, column, win/loss), the
//! highlighted points, the colours, the axis options and its
//! [`Sparkline`]s: one per location cell, each with a data reference
//! (formula text without `=`, one row or column, e.g. `Sheet1!B2:G2`).
//! Data references follow row/column inserts and deletes and sheet
//! renames like chart references; locations move with their cells, and a
//! sparkline whose location cell is deleted is removed (a group without
//! sparklines too). A cell holds at most one sparkline.

use core_model::{Color, ThemeColorSlot};
use engine_formula::ast::{RangeKind, MAX_COL, MAX_ROW};
use engine_formula::{
    adjust_references_shift, parse, AdjustContext, CellCoord, CellShift, Expr, SheetId, Value,
};
use serde::{Deserialize, Serialize};

use crate::workbook::Workbook;
use crate::Error;

fn is_false(b: &bool) -> bool {
    !*b
}

/// The sparkline type (`x14:sparklineGroup/@type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SparklineKind {
    #[default]
    Line,
    Column,
    /// Win/loss (`stacked` in the file): every positive value is an equal
    /// bar up, every negative one down.
    WinLoss,
}

/// How the vertical axis bound of a group is chosen
/// (`minAxisType`/`maxAxisType`).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SparklineAxis {
    /// Automatic for each sparkline (its own minimum / maximum).
    #[default]
    Individual,
    /// The same for all sparklines of the group.
    Group,
    /// A fixed value.
    Custom { value: f64 },
}

impl SparklineAxis {
    fn is_individual(&self) -> bool {
        *self == SparklineAxis::Individual
    }
}

/// How empty cells are shown (`displayEmptyCellsAs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SparklineEmpty {
    #[default]
    Gap,
    Zero,
    /// Connect the data points with a line (line sparklines).
    Span,
}

impl SparklineEmpty {
    fn is_gap(&self) -> bool {
        *self == SparklineEmpty::Gap
    }
}

/// One sparkline: the cell it is drawn in and its data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sparkline {
    /// 0-based location cell.
    pub row: u32,
    pub col: u32,
    /// The data: a reference without `=` (one row or column; `#REF!`
    /// after its cells were deleted).
    pub data: String,
}

/// The colours of a group (`x14:colorSeries` and friends).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineColors {
    pub series: Color,
    pub negative: Color,
    pub axis: Color,
    pub markers: Color,
    pub first: Color,
    pub last: Color,
    pub high: Color,
    pub low: Color,
}

/// The 36 styles of Excel's Sparkline Style gallery (6 rows × the six
/// accents), Rusuite's reading of Office 2010's gallery: row 1 darker
/// 50 %, row 2 darker 25 %, row 3 the accent, row 4 lighter 40 % with dark
/// highlights, row 5 the accent with black highlights, row 6 shades of the
/// text colour with the accent highlights (see `docs/charts.md`).
pub fn sparkline_style(style: u8) -> SparklineColors {
    let s = style.clamp(1, 36) - 1;
    let (row, col) = (s / 6, usize::from(s % 6));
    const ACCENTS: [ThemeColorSlot; 6] = [
        ThemeColorSlot::Accent1,
        ThemeColorSlot::Accent2,
        ThemeColorSlot::Accent3,
        ThemeColorSlot::Accent4,
        ThemeColorSlot::Accent5,
        ThemeColorSlot::Accent6,
    ];
    let a = |tint: f64| Color::Theme {
        slot: ACCENTS[col],
        tint,
    };
    let next = |tint: f64| Color::Theme {
        slot: ACCENTS[(col + 1) % 6],
        tint,
    };
    let dark = |tint: f64| Color::Theme {
        slot: ThemeColorSlot::Dark1,
        tint,
    };
    let black = Color::Rgb(core_model::Rgb::new(0, 0, 0));
    let (series, negative, markers, ends, extremes) = match row {
        0 => (a(-0.5), next(0.0), a(-0.5), a(0.4), a(0.0)),
        1 => (a(-0.25), next(0.0), a(-0.25), a(0.4), a(-0.5)),
        2 => (a(0.0), next(0.0), a(-0.25), a(0.4), a(-0.5)),
        3 => (a(0.4), a(-0.5), a(-0.5), a(-0.25), a(-0.5)),
        4 => (a(0.0), black, black, black, black),
        _ => (dark(0.35), a(0.0), a(0.0), a(0.0), a(0.0)),
    };
    SparklineColors {
        series,
        negative,
        axis: black,
        markers,
        first: ends,
        last: ends,
        high: extremes,
        low: extremes,
    }
}

impl Default for SparklineColors {
    /// Excel's default style ("Accent 1, Darker 50%").
    fn default() -> Self {
        sparkline_style(1)
    }
}

fn default_weight() -> f64 {
    0.75
}

fn is_default_weight(w: &f64) -> bool {
    *w == 0.75
}

/// A group of sparklines sharing their formatting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineGroup {
    #[serde(default)]
    pub kind: SparklineKind,
    pub sparklines: Vec<Sparkline>,
    #[serde(default)]
    pub colors: SparklineColors,
    /// Highlighted points.
    #[serde(default, skip_serializing_if = "is_false")]
    pub high: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub low: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub first: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub last: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub negative: bool,
    /// Markers on every point (line sparklines).
    #[serde(default, skip_serializing_if = "is_false")]
    pub markers: bool,
    /// The horizontal axis at zero (`displayXAxis`; drawn only when the
    /// data crosses zero).
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_axis: bool,
    /// Plot data right to left.
    #[serde(default, skip_serializing_if = "is_false")]
    pub right_to_left: bool,
    #[serde(default, skip_serializing_if = "SparklineAxis::is_individual")]
    pub min_axis: SparklineAxis,
    #[serde(default, skip_serializing_if = "SparklineAxis::is_individual")]
    pub max_axis: SparklineAxis,
    /// Date axis: the dates of the points (a reference as long as the
    /// data), spacing the points by date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_range: Option<String>,
    /// Line weight in points (line sparklines).
    #[serde(default = "default_weight", skip_serializing_if = "is_default_weight")]
    pub line_weight: f64,
    #[serde(default, skip_serializing_if = "SparklineEmpty::is_gap")]
    pub empty_cells: SparklineEmpty,
    /// Show data in hidden rows and columns.
    #[serde(default, skip_serializing_if = "is_false")]
    pub display_hidden: bool,
}

impl SparklineGroup {
    /// A group of `kind` with Excel's defaults.
    pub fn new(kind: SparklineKind, sparklines: Vec<Sparkline>) -> Self {
        SparklineGroup {
            kind,
            sparklines,
            colors: SparklineColors::default(),
            high: false,
            low: false,
            first: false,
            last: false,
            negative: false,
            markers: false,
            show_axis: false,
            right_to_left: false,
            min_axis: SparklineAxis::Individual,
            max_axis: SparklineAxis::Individual,
            date_range: None,
            line_weight: 0.75,
            empty_cells: SparklineEmpty::Gap,
            display_hidden: false,
        }
    }

    /// Every reference formula of the group (data and date range).
    fn formulas_mut(&mut self) -> Vec<&mut String> {
        let mut out: Vec<&mut String> = self.sparklines.iter_mut().map(|s| &mut s.data).collect();
        if let Some(d) = self.date_range.as_mut() {
            out.push(d);
        }
        out
    }

    fn formulas(&self) -> Vec<&str> {
        let mut out: Vec<&str> = self.sparklines.iter().map(|s| s.data.as_str()).collect();
        out.extend(self.date_range.as_deref());
        out
    }
}

/// The resolved values of one sparkline (for the renderer).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineData {
    /// One entry per data cell (hidden cells left out unless the group
    /// shows them); `None` = empty, text or an error.
    pub values: Vec<Option<f64>>,
    /// The dates of the date range, as many as `values`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dates: Option<Vec<Option<f64>>>,
}

fn parse_ref(formula: &str) -> Option<Expr> {
    let f = formula.trim();
    let f = f.strip_prefix('=').unwrap_or(f);
    parse(&format!("={f}")).ok()
}

/// Checks a group before it is stored.
fn check_group(g: &SparklineGroup) -> Result<(), Error> {
    let bad = |m: String| Err(Error::InvalidRule(format!("sparkline: {m}")));
    if g.sparklines.is_empty() {
        return bad("a group without sparklines".into());
    }
    for s in &g.sparklines {
        if s.row > MAX_ROW || s.col > MAX_COL {
            return bad("location outside the sheet".into());
        }
        if parse_ref(&s.data).is_none() {
            return bad(format!("data {:?}", s.data));
        }
    }
    if let Some(d) = &g.date_range {
        if parse_ref(d).is_none() {
            return bad(format!("date range {d:?}"));
        }
    }
    if !(g.line_weight.is_finite() && (0.0..=1584.0).contains(&g.line_weight)) {
        return bad("line weight".into());
    }
    Ok(())
}

impl Workbook {
    /// The sparkline groups of `sheet`.
    pub fn sparkline_groups(&self, sheet: SheetId) -> &[SparklineGroup] {
        &self.sheet_data(sheet).sparklines
    }

    /// Replaces the sparkline groups of `sheet`; returns the old ones.
    /// A location used twice keeps the later sparkline (Excel: one per
    /// cell); invalid groups fail and change nothing.
    pub fn set_sparkline_groups(
        &mut self,
        sheet: SheetId,
        groups: Vec<SparklineGroup>,
    ) -> Result<Vec<SparklineGroup>, Error> {
        self.sheet_data_mut(sheet)?;
        for g in &groups {
            check_group(g)?;
        }
        let mut seen = std::collections::HashSet::new();
        let mut groups = groups;
        for g in groups.iter_mut().rev() {
            let mut keep: Vec<Sparkline> = Vec::new();
            for s in g.sparklines.drain(..).rev() {
                if seen.insert((s.row, s.col)) {
                    keep.push(s);
                }
            }
            keep.reverse();
            g.sparklines = keep;
        }
        groups.retain(|g| !g.sparklines.is_empty());
        Ok(std::mem::replace(
            &mut self.sheet_data_mut(sheet)?.sparklines,
            groups,
        ))
    }

    /// The group and sparkline at a location cell.
    pub fn sparkline_at(&self, sheet: SheetId, row: u32, col: u32) -> Option<(usize, usize)> {
        self.sparkline_groups(sheet)
            .iter()
            .enumerate()
            .find_map(|(gi, g)| {
                g.sparklines
                    .iter()
                    .position(|s| s.row == row && s.col == col)
                    .map(|si| (gi, si))
            })
    }

    /// The numbers of a sparkline reference (row-major), host `sheet` for
    /// references without a sheet name; `None` when it does not resolve.
    fn sparkline_values(
        &self,
        formula: &str,
        host: SheetId,
        hidden: bool,
    ) -> Option<Vec<Option<f64>>> {
        let Expr::Reference(r) = parse_ref(formula)? else {
            return None;
        };
        let sheet = match &r.sheet {
            Some(name) => self.sheet_id(name)?,
            None => host,
        };
        self.engine().sheet_name(sheet)?;
        let used = self.used_range(sheet).unwrap_or((0, 0));
        let (r0, c0, r1, c1) = match r.kind {
            RangeKind::Cell(c) => (c.row, c.col, c.row, c.col),
            RangeKind::Area(a, b) => (a.row, a.col, b.row, b.col),
            RangeKind::Cols { start, end, .. } => (0, start, used.0, end),
            RangeKind::Rows { start, end, .. } => (start, 0, end, used.1),
        };
        let (r1, c1) = (r1.min(used.0.max(r0)), c1.min(used.1.max(c0)));
        if (u64::from(r1 - r0) + 1) * (u64::from(c1 - c0) + 1) > 1 << 16 {
            return None;
        }
        let mut out = Vec::new();
        for row in r0..=r1 {
            if !hidden && self.row_info(sheet, row).hidden {
                continue;
            }
            for col in c0..=c1 {
                if !hidden && self.col_info(sheet, col).hidden {
                    continue;
                }
                out.push(match self.value(CellCoord::new(sheet, row, col)) {
                    Value::Number(n) => Some(n),
                    Value::Bool(b) => Some(f64::from(u8::from(b))),
                    _ => None,
                });
            }
        }
        Some(out)
    }

    /// The data of every sparkline of group `group` on `sheet`, in order.
    pub fn sparkline_data(&self, sheet: SheetId, group: &SparklineGroup) -> Vec<SparklineData> {
        let hidden = group.display_hidden;
        let dates = group
            .date_range
            .as_deref()
            .and_then(|d| self.sparkline_values(d, sheet, hidden));
        group
            .sparklines
            .iter()
            .map(|s| {
                let values = self
                    .sparkline_values(&s.data, sheet, hidden)
                    .unwrap_or_default();
                let dates = dates.clone().map(|mut d| {
                    d.resize(values.len(), None);
                    d
                });
                SparklineData { values, dates }
            })
            .collect()
    }

    /// After a row/column insert or delete on `sheet`: moves its
    /// sparklines (deleted locations drop them) and adjusts every
    /// sparkline reference to it.
    pub(crate) fn shift_sparklines(&mut self, sheet: SheetId, shift: CellShift) {
        let op = shift.op;
        let names = self.sheets();
        let Some(target) = names
            .iter()
            .find(|(id, _)| *id == sheet)
            .map(|(_, n)| n.clone())
        else {
            return;
        };
        for (id, host) in &names {
            let Ok(data) = self.sheet_data_mut(*id) else {
                continue;
            };
            if data.sparklines.is_empty() {
                continue;
            }
            let ctx = AdjustContext {
                host_sheet: host,
                target_sheet: &target,
                op,
            };
            for g in &mut data.sparklines {
                if *id == sheet {
                    g.sparklines.retain_mut(|s| {
                        let (idx, other) = if op.is_rows() {
                            (s.row, s.col)
                        } else {
                            (s.col, s.row)
                        };
                        if !shift.in_band(other) {
                            return true;
                        }
                        match op.map_index(idx) {
                            Some(j) => {
                                if op.is_rows() {
                                    s.row = j;
                                } else {
                                    s.col = j;
                                }
                                true
                            }
                            None => false,
                        }
                    });
                }
                for f in g.formulas_mut() {
                    let Some(ast) = parse_ref(f) else { continue };
                    let adjusted = adjust_references_shift(&ast, &ctx, shift.band);
                    if adjusted != ast {
                        *f = adjusted.to_string().trim_start_matches('=').to_owned();
                    }
                }
            }
            data.sparklines.retain(|g| !g.sparklines.is_empty());
        }
    }

    /// After renaming sheet `from` to `to`: sparkline references follow
    /// (on every sheet, or only on `only`).
    pub(crate) fn rename_sparkline_refs(&mut self, only: Option<SheetId>, from: &str, to: &str) {
        for (id, _) in self.sheets() {
            if only.is_some_and(|o| o != id) {
                continue;
            }
            let Ok(data) = self.sheet_data_mut(id) else {
                continue;
            };
            for g in &mut data.sparklines {
                for f in g.formulas_mut() {
                    if let Some(new) = crate::chart::renamed(f, from, to) {
                        *f = new;
                    }
                }
            }
        }
    }

    /// Before sheet `gone` is removed: sparkline references to it on the
    /// other sheets become `#REF!` (as formulas do).
    pub(crate) fn break_sparkline_refs(&mut self, gone: SheetId) {
        let Some(name) = self.engine().sheet_name(gone).map(str::to_lowercase) else {
            return;
        };
        for (id, _) in self.sheets() {
            if id == gone {
                continue;
            }
            let Ok(data) = self.sheet_data_mut(id) else {
                continue;
            };
            for g in &mut data.sparklines {
                for f in g.formulas_mut() {
                    if crate::chart::refers_to_sheet(f, &name) {
                        *f = "#REF!".into();
                    }
                }
            }
        }
    }

    /// The sheets whose sparklines read a cell of `cells`.
    pub fn sheets_with_sparklines_on(&self, cells: &[CellCoord]) -> Vec<SheetId> {
        let mut out = Vec::new();
        if cells.is_empty() {
            return out;
        }
        for (host, _) in self.sheets() {
            let hit = self.sparkline_groups(host).iter().any(|g| {
                g.formulas().into_iter().any(|f| {
                    let Some(Expr::Reference(r)) = parse_ref(f) else {
                        return false;
                    };
                    let Some(sheet) = r.sheet.as_deref().map_or(Some(host), |n| self.sheet_id(n))
                    else {
                        return false;
                    };
                    let (r0, c0, r1, c1) = match r.kind {
                        RangeKind::Cell(c) => (c.row, c.col, c.row, c.col),
                        RangeKind::Area(a, b) => (a.row, a.col, b.row, b.col),
                        RangeKind::Cols { start, end, .. } => (0, start, MAX_ROW, end),
                        RangeKind::Rows { start, end, .. } => (start, 0, end, MAX_COL),
                    };
                    cells.iter().any(|c| {
                        c.sheet == sheet && (r0..=r1).contains(&c.row) && (c0..=c1).contains(&c.col)
                    })
                })
            });
            if hit {
                out.push(host);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book() -> (Workbook, SheetId) {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for (r, row) in [["1", "-2", "", "4"], ["5", "x", "7", "8"]]
            .iter()
            .enumerate()
        {
            for (c, v) in row.iter().enumerate() {
                wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                    .unwrap();
            }
        }
        (wb, s)
    }

    fn group() -> SparklineGroup {
        SparklineGroup::new(
            SparklineKind::Line,
            vec![
                Sparkline {
                    row: 0,
                    col: 5,
                    data: "Sheet1!A1:D1".into(),
                },
                Sparkline {
                    row: 1,
                    col: 5,
                    data: "Sheet1!A2:D2".into(),
                },
            ],
        )
    }

    #[test]
    fn values_resolve_and_hidden_cells_are_skipped() {
        let (mut wb, s) = book();
        wb.set_sparkline_groups(s, vec![group()]).unwrap();
        let g = &wb.sparkline_groups(s)[0];
        let d = wb.sparkline_data(s, g);
        assert_eq!(d[0].values, [Some(1.0), Some(-2.0), None, Some(4.0)]);
        assert_eq!(d[1].values, [Some(5.0), None, Some(7.0), Some(8.0)]);
        wb.set_col_hidden(s, 1, true).unwrap();
        let g = wb.sparkline_groups(s)[0].clone();
        assert_eq!(wb.sparkline_data(s, &g)[0].values.len(), 3);
        let mut shown = g.clone();
        shown.display_hidden = true;
        assert_eq!(wb.sparkline_data(s, &shown)[0].values.len(), 4);
        assert_eq!(wb.sparkline_at(s, 1, 5), Some((0, 1)));
        assert_eq!(
            wb.sheets_with_sparklines_on(&[CellCoord::new(s, 1, 2)]),
            vec![s]
        );
    }

    #[test]
    fn one_sparkline_per_cell_and_validation() {
        let (mut wb, s) = book();
        let mut g2 = SparklineGroup::new(
            SparklineKind::Column,
            vec![Sparkline {
                row: 0,
                col: 5,
                data: "Sheet1!A2:D2".into(),
            }],
        );
        wb.set_sparkline_groups(s, vec![group(), g2.clone()])
            .unwrap();
        let groups = wb.sparkline_groups(s);
        assert_eq!(groups[0].sparklines.len(), 1);
        assert_eq!(groups[1].sparklines[0].data, "Sheet1!A2:D2");
        g2.sparklines[0].data = "Sheet1!A1:".into();
        assert!(wb.set_sparkline_groups(s, vec![g2]).is_err());
        assert!(wb
            .set_sparkline_groups(s, vec![SparklineGroup::new(SparklineKind::Line, vec![])])
            .is_err());
    }

    #[test]
    fn sparklines_follow_rows_columns_and_renames() {
        let (mut wb, s) = book();
        wb.set_sparkline_groups(s, vec![group()]).unwrap();
        wb.insert_rows(s, 0, 1).unwrap();
        let g = &wb.sparkline_groups(s)[0];
        assert_eq!((g.sparklines[0].row, g.sparklines[0].col), (1, 5));
        assert_eq!(g.sparklines[0].data, "Sheet1!A2:D2");
        wb.insert_cols(s, 0, 2).unwrap();
        let g = &wb.sparkline_groups(s)[0];
        assert_eq!(g.sparklines[1].col, 7);
        assert_eq!(g.sparklines[1].data, "Sheet1!C3:F3");
        // Deleting a location row removes its sparkline; the data shrinks.
        wb.delete_rows(s, 1, 1).unwrap();
        let g = &wb.sparkline_groups(s)[0];
        assert_eq!(g.sparklines.len(), 1);
        assert_eq!(g.sparklines[0].row, 1);
        wb.delete_cols(s, 3, 1).unwrap();
        assert_eq!(wb.sparkline_groups(s)[0].sparklines[0].data, "Sheet1!C2:E2");
        wb.rename_sheet(s, "Data 1").unwrap();
        assert_eq!(
            wb.sparkline_groups(s)[0].sparklines[0].data,
            "'Data 1'!C2:E2"
        );
        // The whole data deleted: #REF!.
        wb.delete_cols(s, 2, 3).unwrap();
        assert_eq!(wb.sparkline_groups(s)[0].sparklines[0].data, "#REF!");
        // The last location gone: the group goes.
        wb.delete_rows(s, 1, 1).unwrap();
        assert!(wb.sparkline_groups(s).is_empty());
    }

    #[test]
    fn deleted_source_sheet_breaks_references() {
        let (mut wb, s) = book();
        let other = wb.add_sheet("Other").unwrap();
        let mut g = group();
        for sp in &mut g.sparklines {
            sp.data = sp.data.replace("Sheet1", "Other");
        }
        wb.set_sparkline_groups(s, vec![g]).unwrap();
        wb.remove_sheet(other).unwrap();
        assert!(wb.sparkline_groups(s)[0]
            .sparklines
            .iter()
            .all(|x| x.data == "#REF!"));
    }

    #[test]
    fn styles_and_serde_defaults() {
        let a = sparkline_style(1);
        assert_eq!(
            a.series,
            Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: -0.5
            }
        );
        assert_eq!(
            sparkline_style(8).series,
            Color::Theme {
                slot: ThemeColorSlot::Accent2,
                tint: -0.25
            }
        );
        assert_eq!(sparkline_style(0), sparkline_style(1));
        assert_eq!(sparkline_style(99), sparkline_style(36));
        let json = serde_json::to_value(group()).unwrap();
        assert!(json.get("lineWeight").is_none() && json.get("minAxis").is_none());
        let back: SparklineGroup = serde_json::from_value(json).unwrap();
        assert_eq!(back, group());
    }
}
