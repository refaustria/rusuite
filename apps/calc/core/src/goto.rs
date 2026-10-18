//! Home › Find & Select › Go To Special… (Ctrl+G › Special): the cells of
//! the selection (or of the used range when one cell is selected) that
//! match a criterion, as row-major rectangles for a multi-area selection.

use std::collections::BTreeSet;

use engine_formula::{CellContent, CellCoord, Value};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::Rect;
use crate::doc::{CalcDocument, CalcError, Result};
use crate::fill::shift_input;

/// What Go To Special looks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum GoToKind {
    /// Cells with a note or a comment thread.
    Notes,
    /// Constants of the chosen value types.
    Constants,
    /// Formulas whose results have the chosen value types.
    Formulas,
    /// Empty cells inside the used range.
    Blanks,
    /// The current region around the active cell.
    CurrentRegion,
    /// The last cell of the used range.
    LastCell,
    /// The selection without hidden rows and columns.
    VisibleCellsOnly,
    /// Per row, the cells that differ from the active cell's column.
    RowDifferences,
    /// Per column, the cells that differ from the active cell's row.
    ColumnDifferences,
    /// The cells the active cell's formula reads (`all`: over all levels).
    Precedents,
    /// The formula cells reading the active cell (`all`: over all levels).
    Dependents,
    /// Cells with conditional formatting.
    ConditionalFormats,
    /// Cells with data validation.
    DataValidation,
}

/// Value types of [`GoToKind::Constants`] / [`GoToKind::Formulas`]
/// (Excel's four check boxes; all on when absent).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct GoToTypes {
    pub numbers: bool,
    pub text: bool,
    pub logicals: bool,
    pub errors: bool,
}

impl Default for GoToTypes {
    fn default() -> Self {
        GoToTypes {
            numbers: true,
            text: true,
            logicals: true,
            errors: true,
        }
    }
}

impl GoToTypes {
    fn accepts(&self, v: &Value) -> bool {
        match v {
            Value::Number(_) => self.numbers,
            Value::Text(t) => self.text && !t.is_empty(),
            Value::Bool(_) => self.logicals,
            Value::Error(_) => self.errors,
            _ => self.text,
        }
    }
}

/// The most rectangles a reply carries (Excel refuses huge selections too).
pub const MAX_GOTO_AREAS: usize = 10_000;

/// Row-major cells → rectangles: runs per row, merged with the row below
/// when they span the same columns.
pub fn cells_to_rects(cells: &BTreeSet<(u32, u32)>) -> Vec<Rect> {
    // Runs of each row.
    let mut runs: Vec<(u32, u32, u32)> = Vec::new(); // (row, c0, c1)
    for &(r, c) in cells {
        match runs.last_mut() {
            Some((row, _, c1)) if *row == r && *c1 + 1 == c => *c1 = c,
            _ => runs.push((r, c, c)),
        }
    }
    let mut out: Vec<Rect> = Vec::new();
    // Open rectangles by column span, extended while the next row has the same run.
    let mut open: Vec<usize> = Vec::new();
    let mut row_now = None;
    let mut next_open: Vec<usize> = Vec::new();
    for (r, c0, c1) in runs {
        if row_now != Some(r) {
            // A row without runs in between closes everything.
            if row_now.is_some_and(|p: u32| p + 1 != r) {
                next_open.clear();
            }
            open = std::mem::take(&mut next_open);
            row_now = Some(r);
        }
        match open
            .iter()
            .position(|&i| out[i].c0 == c0 && out[i].c1 == c1 && out[i].r1 + 1 == r)
        {
            Some(k) => {
                let i = open.remove(k);
                out[i].r1 = r;
                next_open.push(i);
            }
            None => {
                out.push(Rect {
                    r0: r,
                    c0,
                    r1: r,
                    c1,
                });
                next_open.push(out.len() - 1);
            }
        }
    }
    out.sort_by_key(|r| (r.r0, r.c0));
    out
}

impl CalcDocument {
    /// The `goToSpecial` request: the matching cells of `range` (the
    /// selection; a single cell means the used range) as rectangles,
    /// `(row, col)` being the active cell. Empty when nothing matches
    /// (the UI says "No cells were found.").
    #[allow(clippy::too_many_arguments)]
    pub fn go_to_special(
        &self,
        sheet: u32,
        range: Rect,
        row: u32,
        col: u32,
        kind: GoToKind,
        types: GoToTypes,
        all_levels: bool,
    ) -> Result<Vec<Rect>> {
        let s = self.sheet(sheet)?;
        let wb = self.workbook();
        let used = wb.used_range(s);
        let single = range.r0 == range.r1 && range.c0 == range.c1;
        // The searched area: the selection, or the used range from A1.
        let area = if single {
            match used {
                Some((r1, c1)) => Rect {
                    r0: 0,
                    c0: 0,
                    r1,
                    c1,
                },
                None => return Ok(Vec::new()),
            }
        } else {
            range
        };
        let clip = |r: Rect| -> Option<Rect> {
            let (mr, mc) = used?;
            let out = Rect {
                r0: r.r0,
                c0: r.c0,
                r1: r.r1.min(mr),
                c1: r.c1.min(mc),
            };
            (out.r0 <= out.r1 && out.c0 <= out.c1).then_some(out)
        };
        let inside =
            |r: u32, c: u32| (area.r0..=area.r1).contains(&r) && (area.c0..=area.c1).contains(&c);
        let mut cells: BTreeSet<(u32, u32)> = BTreeSet::new();
        let each = |f: &mut dyn FnMut(u32, u32, &CellContent)| {
            if let Some(a) = clip(area) {
                let cr = model_sheet::CellRange::new(s, a.r0, a.c0, a.r1, a.c1);
                for (c, content, _) in wb.cells_in(cr) {
                    f(c.row, c.col, content);
                }
            }
        };
        match kind {
            GoToKind::Notes => {
                for n in wb.notes(s) {
                    if inside(n.row, n.col) {
                        cells.insert((n.row, n.col));
                    }
                }
                for t in wb.threads(s) {
                    if inside(t.row, t.col) {
                        cells.insert((t.row, t.col));
                    }
                }
            }
            GoToKind::Constants => each(&mut |r, c, content| {
                if let CellContent::Value(v) = content {
                    if types.accepts(v) {
                        cells.insert((r, c));
                    }
                }
            }),
            GoToKind::Formulas => each(&mut |r, c, content| {
                if matches!(content, CellContent::Formula { .. })
                    && types.accepts(&wb.value(CellCoord::new(s, r, c)))
                {
                    cells.insert((r, c));
                }
            }),
            GoToKind::Blanks => {
                let Some(a) = clip(area) else {
                    return Ok(Vec::new());
                };
                if u64::from(a.r1 - a.r0 + 1) * u64::from(a.c1 - a.c0 + 1) > 4_000_000 {
                    return Err(CalcError::InvalidRange);
                }
                for r in a.r0..=a.r1 {
                    for c in a.c0..=a.c1 {
                        if matches!(wb.content(CellCoord::new(s, r, c)), CellContent::Empty) {
                            cells.insert((r, c));
                        }
                    }
                }
            }
            GoToKind::CurrentRegion => {
                let r = wb.current_region(s, row, col);
                return Ok(vec![Rect {
                    r0: r.r0,
                    c0: r.c0,
                    r1: r.r1,
                    c1: r.c1,
                }]);
            }
            GoToKind::LastCell => {
                return Ok(used
                    .map(|(r, c)| {
                        vec![Rect {
                            r0: r,
                            c0: c,
                            r1: r,
                            c1: c,
                        }]
                    })
                    .unwrap_or_default());
            }
            GoToKind::VisibleCellsOnly => {
                // Runs of visible rows × runs of visible columns of the selection.
                let runs = |lo: u32, hi: u32, hidden: &dyn Fn(u32) -> bool| {
                    let mut out: Vec<(u32, u32)> = Vec::new();
                    for i in lo..=hi {
                        if hidden(i) {
                            continue;
                        }
                        match out.last_mut() {
                            Some((_, e)) if *e + 1 == i => *e = i,
                            _ => out.push((i, i)),
                        }
                    }
                    out
                };
                let rows = runs(range.r0, range.r1, &|r| wb.row_info(s, r).hidden);
                let cols = runs(range.c0, range.c1, &|c| wb.col_info(s, c).hidden);
                if rows.len().saturating_mul(cols.len()) > MAX_GOTO_AREAS {
                    return Err(CalcError::InvalidRange);
                }
                return Ok(rows
                    .iter()
                    .flat_map(|&(r0, r1)| cols.iter().map(move |&(c0, c1)| Rect { r0, c0, r1, c1 }))
                    .collect());
            }
            GoToKind::RowDifferences | GoToKind::ColumnDifferences => {
                let rows = kind == GoToKind::RowDifferences;
                let Some(a) = clip(area) else {
                    return Ok(Vec::new());
                };
                let key = |r: u32, c: u32, to: (u32, u32)| -> String {
                    // A formula compares as if it were in the comparison cell (R1C1 sameness).
                    let content = wb.content(CellCoord::new(s, r, c));
                    match content {
                        CellContent::Formula { .. } => {
                            let input = wb
                                .formula_text(CellCoord::new(s, r, c))
                                .unwrap_or_default()
                                .to_owned();
                            format!(
                                "f{}",
                                shift_input(
                                    &input,
                                    i64::from(to.0) - i64::from(r),
                                    i64::from(to.1) - i64::from(c)
                                )
                            )
                        }
                        CellContent::Empty => String::new(),
                        _ => format!("v{:?}", wb.value(CellCoord::new(s, r, c))),
                    }
                };
                for r in a.r0..=a.r1 {
                    for c in a.c0..=a.c1 {
                        let cmp = if rows { (r, col) } else { (row, c) };
                        if cmp == (r, c) {
                            continue;
                        }
                        let here = key(r, c, cmp);
                        let there = key(cmp.0, cmp.1, cmp);
                        if here != there && !(here.is_empty() && there.is_empty()) {
                            cells.insert((r, c));
                        }
                    }
                }
            }
            GoToKind::Precedents | GoToKind::Dependents => {
                let mut seen: BTreeSet<(u32, u32)> = BTreeSet::new();
                let mut todo = vec![(row, col)];
                let engine = wb.engine();
                while let Some((r, c)) = todo.pop() {
                    let at = CellCoord::new(s, r, c);
                    let next: Vec<(u32, u32)> = if kind == GoToKind::Precedents {
                        engine
                            .precedents(at)
                            .into_iter()
                            .filter(|p| p.sheet == s)
                            .flat_map(|p| {
                                let (r1, c1) = (
                                    p.r1.min(p.r0 + 10_000).min(used.map_or(p.r1, |u| u.0)),
                                    p.c1.min(used.map_or(p.c1, |u| u.1)),
                                );
                                (p.r0..=r1).flat_map(move |rr| (p.c0..=c1).map(move |cc| (rr, cc)))
                            })
                            .collect()
                    } else {
                        engine
                            .dependents(at)
                            .into_iter()
                            .filter(|d| d.sheet == s)
                            .map(|d| (d.row, d.col))
                            .collect()
                    };
                    for p in next {
                        if p != (row, col) && seen.insert(p) && all_levels {
                            todo.push(p);
                        }
                    }
                    if seen.len() > 100_000 {
                        return Err(CalcError::InvalidRange);
                    }
                }
                cells = seen;
            }
            GoToKind::ConditionalFormats | GoToKind::DataValidation => {
                let rects: Vec<engine_formula::CellRect> = if kind == GoToKind::ConditionalFormats {
                    wb.cf_rules(s)
                        .iter()
                        .flat_map(|r| r.ranges.iter().copied())
                        .collect()
                } else {
                    wb.validations(s)
                        .iter()
                        .flat_map(|v| v.ranges.iter().copied())
                        .collect()
                };
                // Rule ranges are already rectangles: cut them to the searched area.
                let mut out: Vec<Rect> = Vec::new();
                for r in rects {
                    let (r0, c0) = (r.r0.max(area.r0), r.c0.max(area.c0));
                    let (r1, c1) = (r.r1.min(area.r1), r.c1.min(area.c1));
                    if r0 <= r1 && c0 <= c1 {
                        let rect = Rect { r0, c0, r1, c1 };
                        if !out.contains(&rect) {
                            out.push(rect);
                        }
                    }
                }
                out.sort_by_key(|r| (r.r0, r.c0));
                return Ok(out);
            }
        }
        let rects = cells_to_rects(&cells);
        if rects.len() > MAX_GOTO_AREAS {
            return Err(CalcError::InvalidRange);
        }
        Ok(rects)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_become_row_major_rectangles() {
        let cells: BTreeSet<(u32, u32)> = [(0, 0), (0, 1), (1, 0), (1, 1), (2, 3), (4, 0)]
            .into_iter()
            .collect();
        assert_eq!(
            cells_to_rects(&cells),
            vec![
                Rect {
                    r0: 0,
                    c0: 0,
                    r1: 1,
                    c1: 1
                },
                Rect {
                    r0: 2,
                    c0: 3,
                    r1: 2,
                    c1: 3
                },
                Rect {
                    r0: 4,
                    c0: 0,
                    r1: 4,
                    c1: 0
                },
            ]
        );
        assert!(cells_to_rects(&BTreeSet::new()).is_empty());
    }
}
