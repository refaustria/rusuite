//! Outlines (Data › Group / Ungroup / Subtotal): every row and column has
//! an outline level 0–7 ([`RowInfo::outline_level`](crate::RowInfo)) and
//! a summary row/column may be marked `collapsed`. A *group* at level `k`
//! is a maximal run of lines with level `>= k`; its summary line is the
//! line right after the run (summary below / right, Excel's default) or
//! right before it. Collapsing hides the run; expanding shows the lines
//! of the next level, nested collapsed groups staying collapsed. The
//! level buttons `1..=8` show the lines whose level is below the button.
//!
//! The functions here only plan: they return the [`OutlineState`]s to
//! set, which the document applies (and undoes) like any row/column
//! change.

use std::collections::BTreeSet;

use engine_formula::SheetId;
use serde::{Deserialize, Serialize};

use crate::workbook::Workbook;
use crate::Error;

/// The deepest outline level (Excel: 7, shown as the buttons 1–8).
pub const MAX_OUTLINE_LEVEL: u8 = 7;

/// Where the summary lines of the outline sit (`sheetPr/outlinePr`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OutlineProps {
    /// Summary rows below their detail (else above).
    pub summary_below: bool,
    /// Summary columns right of their detail (else left).
    pub summary_right: bool,
}

impl Default for OutlineProps {
    fn default() -> Self {
        OutlineProps {
            summary_below: true,
            summary_right: true,
        }
    }
}

impl OutlineProps {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// Rows or columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Axis {
    Rows,
    Cols,
}

/// The outline states to set: `(line, state)`.
pub type OutlinePlan = Vec<(u32, OutlineState)>;

/// The outline part of a row's or column's properties.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OutlineState {
    pub level: u8,
    pub hidden: bool,
    pub collapsed: bool,
}

impl Workbook {
    pub fn outline_props(&self, sheet: SheetId) -> OutlineProps {
        self.sheet_data(sheet).outline
    }

    pub fn set_outline_props(&mut self, sheet: SheetId, props: OutlineProps) -> Result<(), Error> {
        self.sheet_data_mut(sheet)?.outline = props;
        Ok(())
    }

    /// The outline state of line `i`.
    pub fn outline_state(&self, sheet: SheetId, axis: Axis, i: u32) -> OutlineState {
        match axis {
            Axis::Rows => {
                let r = self.row_info(sheet, i);
                OutlineState {
                    level: r.outline_level,
                    hidden: r.hidden,
                    collapsed: r.collapsed,
                }
            }
            Axis::Cols => {
                let c = self.col_info(sheet, i);
                OutlineState {
                    level: c.outline_level,
                    hidden: c.hidden,
                    collapsed: c.collapsed,
                }
            }
        }
    }

    /// The deepest level used on `axis` (0 = no outline).
    pub fn max_outline_level(&self, sheet: SheetId, axis: Axis) -> u8 {
        match axis {
            Axis::Rows => self.rows(sheet).map(|(_, r)| r.outline_level).max(),
            Axis::Cols => self.cols(sheet).map(|(_, c)| c.outline_level).max(),
        }
        .unwrap_or(0)
    }

    /// The lines with a level > 0 or a collapsed mark, ascending.
    fn outlined(&self, sheet: SheetId, axis: Axis) -> Vec<u32> {
        match axis {
            Axis::Rows => self
                .rows(sheet)
                .filter(|(_, r)| r.outline_level > 0 || r.collapsed)
                .map(|(i, _)| i)
                .collect(),
            Axis::Cols => self
                .cols(sheet)
                .filter(|(_, c)| c.outline_level > 0 || c.collapsed)
                .map(|(i, _)| i)
                .collect(),
        }
    }

    fn summary_after(&self, sheet: SheetId, axis: Axis) -> bool {
        let p = self.outline_props(sheet);
        match axis {
            Axis::Rows => p.summary_below,
            Axis::Cols => p.summary_right,
        }
    }

    /// Group (`ungroup` false) or Ungroup lines `i0..=i1`: one level more
    /// (at most [`MAX_OUTLINE_LEVEL`]) or less. A summary line left
    /// without a group loses its collapsed mark.
    pub fn group_plan(
        &self,
        sheet: SheetId,
        axis: Axis,
        i0: u32,
        i1: u32,
        ungroup: bool,
    ) -> Result<Vec<(u32, OutlineState)>, Error> {
        if i0 > i1 {
            return Err(Error::InvalidRange);
        }
        let mut out = Vec::new();
        for i in i0..=i1 {
            let mut s = self.outline_state(sheet, axis, i);
            if ungroup {
                if s.level == 0 {
                    continue;
                }
                s.level -= 1;
            } else {
                if s.level >= MAX_OUTLINE_LEVEL {
                    return Err(Error::InvalidRange);
                }
                s.level += 1;
            }
            out.push((i, s));
        }
        if ungroup {
            // Summary lines next to the range whose group vanished.
            let after = self.summary_after(sheet, axis);
            let summary = if after {
                i1.checked_add(1)
            } else {
                i0.checked_sub(1)
            };
            if let Some(j) = summary {
                let s = self.outline_state(sheet, axis, j);
                let neighbour = if after { i1 } else { i0 };
                let still = out
                    .iter()
                    .find(|(i, _)| *i == neighbour)
                    .is_some_and(|(_, n)| n.level > s.level);
                if s.collapsed && !still {
                    out.push((
                        j,
                        OutlineState {
                            collapsed: false,
                            ..s
                        },
                    ));
                }
            }
        }
        Ok(out)
    }

    /// The detail lines of the group summarized by line `summary` (empty
    /// when it summarizes nothing).
    pub fn outline_detail(&self, sheet: SheetId, axis: Axis, summary: u32) -> Vec<u32> {
        let level = self.outline_state(sheet, axis, summary).level;
        let deeper = |i: u32| self.outline_state(sheet, axis, i).level > level;
        let mut out = Vec::new();
        if self.summary_after(sheet, axis) {
            let mut i = summary;
            while i > 0 && deeper(i - 1) {
                i -= 1;
                out.push(i);
            }
            out.reverse();
        } else {
            let mut i = summary;
            while i < u32::MAX && deeper(i + 1) {
                i += 1;
                out.push(i);
            }
        }
        out
    }

    /// The summary line of the level-`k` group holding line `i` (`None`
    /// when `i` is in no such group).
    fn summary_of(&self, sheet: SheetId, axis: Axis, i: u32, k: u8) -> Option<u32> {
        if self.outline_state(sheet, axis, i).level < k {
            return None;
        }
        let at_least = |j: u32| self.outline_state(sheet, axis, j).level >= k;
        let mut j = i;
        if self.summary_after(sheet, axis) {
            while j < u32::MAX && at_least(j + 1) {
                j += 1;
            }
            j.checked_add(1)
        } else {
            while j > 0 && at_least(j - 1) {
                j -= 1;
            }
            j.checked_sub(1)
        }
    }

    /// Collapse (`−`) or expand (`+`) the group summarized by `summary`.
    pub fn collapse_plan(
        &self,
        sheet: SheetId,
        axis: Axis,
        summary: u32,
        collapse: bool,
    ) -> Vec<(u32, OutlineState)> {
        let detail = self.outline_detail(sheet, axis, summary);
        if detail.is_empty() {
            return Vec::new();
        }
        let base = self.outline_state(sheet, axis, summary);
        let mut out = vec![(
            summary,
            OutlineState {
                collapsed: collapse,
                ..base
            },
        )];
        for &i in &detail {
            let s = self.outline_state(sheet, axis, i);
            let hidden = collapse
                || ((base.level + 2)..=s.level).any(|k| {
                    self.summary_of(sheet, axis, i, k)
                        .is_some_and(|j| self.outline_state(sheet, axis, j).collapsed)
                });
            if hidden != s.hidden {
                out.push((i, OutlineState { hidden, ..s }));
            }
        }
        out
    }

    /// The level button `button` (1 = only the top level): lines of level
    /// `>= button` are hidden, the others shown; summary lines of hidden
    /// groups are marked collapsed.
    pub fn level_plan(&self, sheet: SheetId, axis: Axis, button: u8) -> Vec<(u32, OutlineState)> {
        let mut lines = self.outlined(sheet, axis);
        // Summary lines (level 0) next to the groups.
        let after = self.summary_after(sheet, axis);
        let extra: Vec<u32> = lines
            .iter()
            .filter_map(|&i| {
                if after {
                    i.checked_add(1)
                } else {
                    i.checked_sub(1)
                }
            })
            .collect();
        lines.extend(extra);
        lines.sort_unstable();
        lines.dedup();
        let mut out = Vec::new();
        for i in lines {
            let s = self.outline_state(sheet, axis, i);
            let hidden = s.level >= button;
            let next = if after {
                i.checked_sub(1)
            } else {
                i.checked_add(1)
            };
            let detail_level = next.map_or(0, |j| self.outline_state(sheet, axis, j).level);
            let collapsed = detail_level > s.level && detail_level >= button;
            let n = OutlineState {
                level: s.level,
                hidden,
                collapsed,
            };
            if n != s {
                out.push((i, n));
            }
        }
        out
    }

    /// Clear Outline: every level back to 0 and every line shown that a
    /// collapsed group hid.
    pub fn clear_outline_plan(&self, sheet: SheetId, axis: Axis) -> Vec<(u32, OutlineState)> {
        self.outlined(sheet, axis)
            .into_iter()
            .map(|i| {
                let s = self.outline_state(sheet, axis, i);
                (
                    i,
                    OutlineState {
                        level: 0,
                        hidden: s.hidden && s.level == 0,
                        collapsed: false,
                    },
                )
            })
            .collect()
    }

    /// Applies outline states directly (loading files, tests).
    pub fn set_outline_states(
        &mut self,
        sheet: SheetId,
        axis: Axis,
        states: &[(u32, OutlineState)],
    ) -> Result<(), Error> {
        for &(i, s) in states {
            match axis {
                Axis::Rows => {
                    let info = crate::RowInfo {
                        outline_level: s.level.min(MAX_OUTLINE_LEVEL),
                        hidden: s.hidden,
                        collapsed: s.collapsed,
                        ..self.row_info(sheet, i)
                    };
                    self.set_row_info(sheet, i, info)?;
                }
                Axis::Cols => {
                    let info = crate::ColInfo {
                        outline_level: s.level.min(MAX_OUTLINE_LEVEL),
                        hidden: s.hidden,
                        collapsed: s.collapsed,
                        ..self.col_info(sheet, i)
                    };
                    self.set_col_info(sheet, i, info)?;
                }
            }
        }
        Ok(())
    }
}

/// The lines (rows or columns) a formula at `at` sums up on `axis`
/// (Excel's Auto Outline): the same-sheet references in its own column
/// (rows) or row (columns), as `(first, last)` line indexes.
fn referenced_lines(
    e: &engine_formula::Expr,
    own_sheet: &str,
    at: (u32, u32),
    axis: Axis,
    out: &mut Vec<(u32, u32)>,
) {
    use engine_formula::ast::RangeKind;
    use engine_formula::Expr;
    match e {
        Expr::Reference(r) => {
            if r.sheet
                .as_deref()
                .is_some_and(|s| !s.eq_ignore_ascii_case(own_sheet))
            {
                return;
            }
            let (row, col) = at;
            let span = match &r.kind {
                RangeKind::Cell(c) => Some(((c.row, c.col), (c.row, c.col))),
                RangeKind::Area(a, b) => Some((
                    (a.row.min(b.row), a.col.min(b.col)),
                    (a.row.max(b.row), a.col.max(b.col)),
                )),
                _ => None,
            };
            let Some(((r0, c0), (r1, c1))) = span else {
                return;
            };
            match axis {
                Axis::Rows if (c0..=c1).contains(&col) && c0 == c1 => out.push((r0, r1)),
                Axis::Cols if (r0..=r1).contains(&row) && r0 == r1 => out.push((c0, c1)),
                _ => {}
            }
        }
        Expr::Call { args, .. } => args
            .iter()
            .for_each(|a| referenced_lines(a, own_sheet, at, axis, out)),
        Expr::Unary { expr, .. } => referenced_lines(expr, own_sheet, at, axis, out),
        Expr::Binary { lhs, rhs, .. } => {
            referenced_lines(lhs, own_sheet, at, axis, out);
            referenced_lines(rhs, own_sheet, at, axis, out);
        }
        _ => {}
    }
}

impl Workbook {
    /// Data › Group › Auto Outline on `range` (Excel): a row whose
    /// formulas refer to the rows right above it in their own column
    /// (summary rows below, else right below it) is a summary row and
    /// those rows its detail; columns alike with references in their own
    /// row (summary columns right, else left). Nested summaries nest the
    /// groups (at most 7 levels). The outline inside `range` is replaced;
    /// returns the plans for rows and columns (empty when no formula
    /// summarizes anything).
    pub fn auto_outline_plan(&self, range: crate::CellRange) -> (OutlinePlan, OutlinePlan) {
        let sheet = range.sheet;
        let own = self
            .engine()
            .sheet_name(sheet)
            .unwrap_or_default()
            .to_string();
        let props = self.outline_props(sheet);
        let mut plans = Vec::new();
        for axis in [Axis::Rows, Axis::Cols] {
            let after = match axis {
                Axis::Rows => props.summary_below,
                Axis::Cols => props.summary_right,
            };
            let (lo, hi) = match axis {
                Axis::Rows => (range.r0, range.r1),
                Axis::Cols => (range.c0, range.c1),
            };
            // Per summary line: its detail span.
            let mut spans: std::collections::BTreeMap<u32, (u32, u32)> = Default::default();
            for (c, content) in self.engine().cells(sheet) {
                let engine_formula::CellContent::Formula { ast, .. } = content else {
                    continue;
                };
                if !(range.r0..=range.r1).contains(&c.row)
                    || !(range.c0..=range.c1).contains(&c.col)
                {
                    continue;
                }
                let line = match axis {
                    Axis::Rows => c.row,
                    Axis::Cols => c.col,
                };
                let mut refs = Vec::new();
                referenced_lines(ast, &own, (c.row, c.col), axis, &mut refs);
                let detail = if after {
                    let below: Vec<&(u32, u32)> = refs.iter().filter(|(_, b)| *b < line).collect();
                    let last = below.iter().map(|(_, b)| *b).max();
                    let first = below.iter().map(|(a, _)| *a).min();
                    match (first, last) {
                        (Some(f), Some(l)) if l + 1 == line && f >= lo => Some((f, l)),
                        _ => None,
                    }
                } else {
                    let above: Vec<&(u32, u32)> = refs.iter().filter(|(a, _)| *a > line).collect();
                    let first = above.iter().map(|(a, _)| *a).min();
                    let last = above.iter().map(|(_, b)| *b).max();
                    match (first, last) {
                        (Some(f), Some(l)) if f == line + 1 && l <= hi => Some((f, l)),
                        _ => None,
                    }
                };
                if let Some((f, l)) = detail {
                    let e = spans.entry(line).or_insert((f, l));
                    *e = (e.0.min(f), e.1.max(l));
                }
            }
            // A summary of summaries also covers their detail (`=B5+B9`
            // under two subtotals groups everything above it).
            let keys: Vec<u32> = if after {
                spans.keys().copied().collect()
            } else {
                spans.keys().rev().copied().collect()
            };
            for line in keys {
                let (mut f, mut l) = spans[&line];
                loop {
                    let edge = if after { f } else { l };
                    match spans.get(&edge) {
                        Some(&(f2, l2)) if (after && f2 < f) || (!after && l2 > l) => {
                            f = f.min(f2);
                            l = l.max(l2);
                        }
                        _ => break,
                    }
                }
                spans.insert(line, (f, l));
            }
            let mut levels: std::collections::BTreeMap<u32, u8> = Default::default();
            for (f, l) in spans.values() {
                for i in *f..=*l {
                    let v = levels.entry(i).or_insert(0);
                    *v = (*v + 1).min(MAX_OUTLINE_LEVEL);
                }
            }
            let mut plan = Vec::new();
            if !spans.is_empty() {
                let mut lines: BTreeSet<u32> = levels.keys().copied().collect();
                lines.extend(
                    self.outlined(sheet, axis)
                        .into_iter()
                        .filter(|i| (lo..=hi).contains(i)),
                );
                for i in lines {
                    let old = self.outline_state(sheet, axis, i);
                    let level = levels.get(&i).copied().unwrap_or(0);
                    let new = OutlineState {
                        level,
                        // Lines a collapsed group hid come back.
                        hidden: old.hidden && old.level == 0,
                        collapsed: false,
                    };
                    if new != old {
                        plan.push((i, new));
                    }
                }
            }
            plans.push(plan);
        }
        let cols = plans.pop().unwrap_or_default();
        let rows = plans.pop().unwrap_or_default();
        (rows, cols)
    }
}

impl Workbook {
    /// The manual page breaks of `sheet` on `axis`: a page starts before
    /// each of these rows / columns (ascending, > 0).
    pub fn page_breaks(&self, sheet: SheetId, axis: Axis) -> &[u32] {
        let d = self.sheet_data(sheet);
        match axis {
            Axis::Rows => &d.row_breaks,
            Axis::Cols => &d.col_breaks,
        }
    }

    /// Replaces the manual page breaks (sorted, deduplicated, 0 and
    /// indices outside the sheet dropped).
    pub fn set_page_breaks(
        &mut self,
        sheet: SheetId,
        axis: Axis,
        breaks: Vec<u32>,
    ) -> Result<(), Error> {
        let max = match axis {
            Axis::Rows => engine_formula::ast::MAX_ROW,
            Axis::Cols => engine_formula::ast::MAX_COL,
        };
        let mut b: Vec<u32> = breaks.into_iter().filter(|&i| i > 0 && i <= max).collect();
        b.sort_unstable();
        b.dedup();
        let d = self.sheet_data_mut(sheet)?;
        match axis {
            Axis::Rows => d.row_breaks = b,
            Axis::Cols => d.col_breaks = b,
        }
        Ok(())
    }

    /// Page breaks follow row/column inserts and deletes.
    pub(crate) fn shift_page_breaks(&mut self, sheet: SheetId, op: engine_formula::StructuralOp) {
        let Ok(d) = self.sheet_data_mut(sheet) else {
            return;
        };
        let list = if op.is_rows() {
            &mut d.row_breaks
        } else {
            &mut d.col_breaks
        };
        let mut moved: Vec<u32> = list
            .iter()
            .filter_map(|&i| op.map_index(i))
            .filter(|&i| i > 0)
            .collect();
        moved.dedup();
        *list = moved;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(wb: &mut Workbook, plan: Vec<(u32, OutlineState)>) {
        wb.set_outline_states(SheetId(0), Axis::Rows, &plan)
            .unwrap();
    }

    fn hidden(wb: &Workbook) -> Vec<u32> {
        wb.rows(SheetId(0))
            .filter(|(_, r)| r.hidden)
            .map(|(i, _)| i)
            .collect()
    }

    #[test]
    fn group_collapse_expand() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        // Rows 2–5 (1-based) grouped, 3–4 grouped again; summary row 6.
        let p = wb.group_plan(s, Axis::Rows, 1, 4, false).unwrap();
        apply(&mut wb, p);
        let p = wb.group_plan(s, Axis::Rows, 2, 3, false).unwrap();
        apply(&mut wb, p);
        assert_eq!(wb.max_outline_level(s, Axis::Rows), 2);
        assert_eq!(wb.outline_detail(s, Axis::Rows, 5), vec![1, 2, 3, 4]);
        assert_eq!(wb.outline_detail(s, Axis::Rows, 4), vec![2, 3]);
        // Collapse the inner group, then the outer one, expand the outer.
        let p = wb.collapse_plan(s, Axis::Rows, 4, true);
        apply(&mut wb, p);
        assert_eq!(hidden(&wb), vec![2, 3]);
        assert!(wb.row_info(s, 4).collapsed);
        let p = wb.collapse_plan(s, Axis::Rows, 5, true);
        apply(&mut wb, p);
        assert_eq!(hidden(&wb), vec![1, 2, 3, 4]);
        let p = wb.collapse_plan(s, Axis::Rows, 5, false);
        apply(&mut wb, p);
        assert_eq!(hidden(&wb), vec![2, 3], "the inner group stays collapsed");
        // Level 1 hides everything grouped; level 3 shows everything.
        let p = wb.level_plan(s, Axis::Rows, 1);
        apply(&mut wb, p);
        assert_eq!(hidden(&wb), vec![1, 2, 3, 4]);
        assert!(wb.row_info(s, 5).collapsed);
        let p = wb.level_plan(s, Axis::Rows, 3);
        apply(&mut wb, p);
        assert!(hidden(&wb).is_empty());
        assert!(!wb.row_info(s, 4).collapsed && !wb.row_info(s, 5).collapsed);
        // Ungroup the inner rows and clear.
        let p = wb.group_plan(s, Axis::Rows, 2, 3, true).unwrap();
        apply(&mut wb, p);
        assert_eq!(wb.max_outline_level(s, Axis::Rows), 1);
        let p = wb.clear_outline_plan(s, Axis::Rows);
        apply(&mut wb, p);
        assert_eq!(wb.max_outline_level(s, Axis::Rows), 0);
        assert_eq!(wb.rows(s).count(), 0);
    }

    #[test]
    fn summary_above_and_limits() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.set_outline_props(
            s,
            OutlineProps {
                summary_below: false,
                summary_right: true,
            },
        )
        .unwrap();
        let p = wb.group_plan(s, Axis::Rows, 3, 5, false).unwrap();
        apply(&mut wb, p);
        assert_eq!(wb.outline_detail(s, Axis::Rows, 2), vec![3, 4, 5]);
        let p = wb.collapse_plan(s, Axis::Rows, 2, true);
        apply(&mut wb, p);
        assert_eq!(hidden(&wb), vec![3, 4, 5]);
        for _ in 0..6 {
            let p = wb.group_plan(s, Axis::Rows, 3, 3, false).unwrap();
            apply(&mut wb, p);
        }
        assert_eq!(wb.row_info(s, 3).outline_level, 7);
        assert!(wb.group_plan(s, Axis::Rows, 3, 3, false).is_err());
        assert!(wb.collapse_plan(s, Axis::Rows, 9, true).is_empty());
    }

    fn put(wb: &mut Workbook, cells: &[(u32, u32, &str)]) {
        for &(r, c, v) in cells {
            wb.set_input(engine_formula::CellCoord::new(SheetId(0), r, c), v)
                .unwrap();
        }
    }

    fn levels(plan: &[(u32, OutlineState)]) -> Vec<(u32, u8)> {
        plan.iter().map(|(i, s)| (*i, s.level)).collect()
    }

    #[test]
    fn auto_outline_groups_rows_under_sum_rows() {
        let mut wb = Workbook::new();
        // East 2–4 (subtotal row 5), West 6–7 (subtotal row 8), grand total 9.
        put(
            &mut wb,
            &[
                (1, 1, "1"),
                (2, 1, "2"),
                (3, 1, "3"),
                (4, 1, "=SUM(B2:B4)"),
                (5, 1, "4"),
                (6, 1, "5"),
                (7, 1, "=SUM(B6:B7)"),
                (8, 1, "=SUBTOTAL(9,B2:B8)"),
            ],
        );
        let range = crate::CellRange::new(SheetId(0), 0, 0, 8, 1);
        let (rows, cols) = wb.auto_outline_plan(range);
        assert!(cols.is_empty());
        assert_eq!(
            levels(&rows),
            [(1, 2), (2, 2), (3, 2), (4, 1), (5, 2), (6, 2), (7, 1)]
        );
    }

    #[test]
    fn auto_outline_columns_and_summary_above() {
        let mut wb = Workbook::new();
        // Q1–Q3 in B–D, total in E; and a summary row above its detail.
        put(
            &mut wb,
            &[(0, 1, "1"), (0, 2, "2"), (0, 3, "3"), (0, 4, "=B1+C1+D1")],
        );
        let (rows, cols) = wb.auto_outline_plan(crate::CellRange::new(SheetId(0), 0, 0, 0, 4));
        assert!(rows.is_empty());
        assert_eq!(levels(&cols), [(1, 1), (2, 1), (3, 1)]);
        let mut wb = Workbook::new();
        wb.set_outline_props(
            SheetId(0),
            OutlineProps {
                summary_below: false,
                summary_right: true,
            },
        )
        .unwrap();
        put(
            &mut wb,
            &[(1, 1, "=SUM(B3:B5)"), (2, 1, "1"), (3, 1, "2"), (4, 1, "3")],
        );
        let (rows, _) = wb.auto_outline_plan(crate::CellRange::new(SheetId(0), 0, 0, 4, 1));
        assert_eq!(levels(&rows), [(2, 1), (3, 1), (4, 1)]);
        // Summary-below formulas do not count then.
        let mut wb = Workbook::new();
        wb.set_outline_props(
            SheetId(0),
            OutlineProps {
                summary_below: false,
                summary_right: true,
            },
        )
        .unwrap();
        put(&mut wb, &[(1, 1, "1"), (2, 1, "2"), (3, 1, "=SUM(B2:B3)")]);
        assert!(wb
            .auto_outline_plan(crate::CellRange::new(SheetId(0), 0, 0, 3, 1))
            .0
            .is_empty());
    }

    #[test]
    fn auto_outline_ignores_other_references_and_replaces_groups() {
        let mut wb = Workbook::new();
        // Not adjacent, another column, another sheet: no summary.
        wb.add_sheet("Other").unwrap();
        put(
            &mut wb,
            &[
                (1, 1, "1"),
                (2, 1, "2"),
                (4, 1, "=SUM(B2:B3)"),
                (5, 1, "=SUM(A2:A5)"),
                (6, 1, "=SUM(Other!B2:B6)"),
            ],
        );
        let range = crate::CellRange::new(SheetId(0), 0, 0, 6, 1);
        assert!(wb.auto_outline_plan(range).0.is_empty());
        // An old group in the range is replaced.
        put(&mut wb, &[(3, 1, "3"), (4, 1, "=SUM(B2:B4)")]);
        let p = wb.group_plan(SheetId(0), Axis::Rows, 5, 6, false).unwrap();
        apply(&mut wb, p);
        let (rows, _) = wb.auto_outline_plan(range);
        assert_eq!(levels(&rows), [(1, 1), (2, 1), (3, 1), (5, 0), (6, 0)]);
    }
}
