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
}
