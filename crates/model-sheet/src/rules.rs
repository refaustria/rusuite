//! Helpers shared by conditional formatting ([`crate::condfmt`]) and data
//! validation ([`crate::validation`]): range lists, rule formulas written
//! relative to an anchor cell, and how both follow structural edits.
//!
//! # Rule formulas
//!
//! A rule formula is stored as text without the leading `=` and is
//! written for the **anchor** cell of the rule: the top-left corner of the
//! bounding box of its ranges (what Excel and LibreOffice use as the base
//! address). For another cell of the ranges it is shifted like a copy
//! ([`offset_relative`]): relative parts move, `$` parts stay. When the
//! ranges change so that the anchor moves, the formulas are re-anchored
//! (shifted by the anchor's move) so that every cell keeps its meaning.

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{
    adjust_references, offset_relative, parse, AdjustContext, CellCoord, CellProvider, CellRect,
    Engine, Expr, RowHidden, SheetId, StructuralOp, Value,
};

use crate::Error;

/// Whether `r` is a valid rectangle inside the sheet.
pub(crate) fn rect_ok(r: &CellRect) -> bool {
    r.r0 <= r.r1 && r.c0 <= r.c1 && r.r1 <= MAX_ROW && r.c1 <= MAX_COL
}

pub(crate) fn rect_contains(r: &CellRect, row: u32, col: u32) -> bool {
    (r.r0..=r.r1).contains(&row) && (r.c0..=r.c1).contains(&col)
}

pub(crate) fn rect_intersection(a: &CellRect, b: &CellRect) -> Option<CellRect> {
    let r = CellRect {
        r0: a.r0.max(b.r0),
        c0: a.c0.max(b.c0),
        r1: a.r1.min(b.r1),
        c1: a.c1.min(b.c1),
    };
    (r.r0 <= r.r1 && r.c0 <= r.c1).then_some(r)
}

/// `r` minus `cut`: up to four rectangles (above, below, left, right).
pub(crate) fn rect_subtract(r: &CellRect, cut: &CellRect) -> Vec<CellRect> {
    let Some(i) = rect_intersection(r, cut) else {
        return vec![*r];
    };
    let mut out = Vec::new();
    if r.r0 < i.r0 {
        out.push(CellRect { r1: i.r0 - 1, ..*r });
    }
    if i.r1 < r.r1 {
        out.push(CellRect { r0: i.r1 + 1, ..*r });
    }
    if r.c0 < i.c0 {
        out.push(CellRect {
            r0: i.r0,
            r1: i.r1,
            c1: i.c0 - 1,
            ..*r
        });
    }
    if i.c1 < r.c1 {
        out.push(CellRect {
            r0: i.r0,
            r1: i.r1,
            c0: i.c1 + 1,
            ..*r
        });
    }
    out
}

/// The anchor of a range list: the top-left corner of its bounding box.
pub(crate) fn anchor(ranges: &[CellRect]) -> Option<(u32, u32)> {
    let r = ranges.iter().map(|r| r.r0).min()?;
    let c = ranges.iter().map(|r| r.c0).min()?;
    Some((r, c))
}

/// Normalizes and checks a range list (non-empty, every rectangle inside
/// the sheet; `r0 > r1` / `c0 > c1` are swapped).
pub(crate) fn check_ranges(ranges: &mut [CellRect]) -> Result<(), Error> {
    if ranges.is_empty() {
        return Err(Error::InvalidRule("a rule needs at least one range".into()));
    }
    for r in ranges.iter_mut() {
        *r = CellRect {
            r0: r.r0.min(r.r1),
            c0: r.c0.min(r.c1),
            r1: r.r0.max(r.r1),
            c1: r.c0.max(r.c1),
        };
        if !rect_ok(r) {
            return Err(Error::InvalidRange);
        }
    }
    Ok(())
}

/// Strips a leading `=` and surrounding whitespace.
pub(crate) fn normalize_formula(text: &str) -> String {
    let t = text.trim();
    t.strip_prefix('=').unwrap_or(t).trim().to_owned()
}

/// Parses rule formula text (with or without the leading `=`).
pub(crate) fn parse_formula(text: &str) -> Result<Expr, Error> {
    let t = text.trim();
    let t = t.strip_prefix('=').unwrap_or(t);
    parse(&format!("={t}")).map_err(|e| Error::InvalidRule(format!("formula {text:?}: {e}")))
}

/// Normalizes and parses every formula of a rule.
pub(crate) fn check_formulas(formulas: Vec<&mut String>) -> Result<(), Error> {
    for f in formulas {
        *f = normalize_formula(f);
        parse_formula(f)?;
    }
    Ok(())
}

/// `text` shifted by `(dr, dc)` like a copy; unparsable text is kept.
pub(crate) fn shift_formula(text: &str, dr: i64, dc: i64) -> String {
    if dr == 0 && dc == 0 {
        return text.to_owned();
    }
    match parse_formula(text) {
        Ok(ast) => offset_relative(&ast, dr, dc).to_string(),
        Err(_) => text.to_owned(),
    }
}

/// Replaces the ranges of a rule, re-anchoring its formulas when the
/// anchor moves. `false` (and nothing changed) when `new` is empty.
pub(crate) fn set_ranges(
    ranges: &mut Vec<CellRect>,
    formulas: Vec<&mut String>,
    new: Vec<CellRect>,
) -> bool {
    let (Some(old), Some(now)) = (anchor(ranges), anchor(&new)) else {
        return false;
    };
    let (dr, dc) = (
        i64::from(now.0) - i64::from(old.0),
        i64::from(now.1) - i64::from(old.1),
    );
    for f in formulas {
        *f = shift_formula(f, dr, dc);
    }
    *ranges = new;
    true
}

/// `ranges` minus `cut` (re-anchoring the formulas); `false` when nothing
/// is left. `changed` is set when `cut` intersected the ranges.
pub(crate) fn subtract_ranges(
    ranges: &mut Vec<CellRect>,
    formulas: Vec<&mut String>,
    cut: &CellRect,
    changed: &mut bool,
) -> bool {
    if !ranges.iter().any(|r| rect_intersection(r, cut).is_some()) {
        return true;
    }
    *changed = true;
    let new: Vec<CellRect> = ranges.iter().flat_map(|r| rect_subtract(r, cut)).collect();
    set_ranges(ranges, formulas, new)
}

/// The index `j` after `op` maps back to before it (`j` is never inside
/// an inserted block when it is the anchor of mapped ranges).
fn unmap_index(op: StructuralOp, j: u32) -> u32 {
    let (at, count) = op.span();
    if j < at {
        j
    } else if op.is_insert() {
        j.saturating_sub(count)
    } else {
        j.saturating_add(count)
    }
}

/// Moves a rule living on `host` for a row/column insert or delete on
/// `target` (`same` = they are the same sheet): its ranges move, grow or
/// shrink like merges, its formulas like cell formulas (first re-anchored
/// at a cell that survives the edit, so that references to the rule's
/// own cells never become `#REF!`). `false` when no range is left.
pub(crate) fn shift_rule(
    ranges: &mut Vec<CellRect>,
    formulas: Vec<&mut String>,
    op: StructuralOp,
    same: bool,
    host: &str,
    target: &str,
) -> bool {
    let ctx = AdjustContext {
        host_sheet: host,
        target_sheet: target,
        op,
    };
    let adjust = |text: &str, dr: i64, dc: i64| -> String {
        let Ok(ast) = parse_formula(text) else {
            return text.to_owned();
        };
        let moved = offset_relative(&ast, dr, dc);
        let adjusted = adjust_references(&moved, &ctx);
        if adjusted == ast {
            text.to_owned()
        } else {
            adjusted.to_string()
        }
    };
    if !same {
        for f in formulas {
            *f = adjust(f, 0, 0);
        }
        return true;
    }
    let new: Vec<CellRect> = ranges
        .iter()
        .filter_map(|r| {
            if op.is_rows() {
                let (r0, r1) = op.map_interval(r.r0, r.r1)?;
                Some(CellRect { r0, r1, ..*r })
            } else {
                let (c0, c1) = op.map_interval(r.c0, r.c1)?;
                Some(CellRect { c0, c1, ..*r })
            }
        })
        .collect();
    let (Some(old), Some(now)) = (anchor(ranges), anchor(&new)) else {
        return false;
    };
    // The new anchor's cell before the edit.
    let pre = if op.is_rows() {
        (unmap_index(op, now.0), now.1)
    } else {
        (now.0, unmap_index(op, now.1))
    };
    let (dr, dc) = (
        i64::from(pre.0) - i64::from(old.0),
        i64::from(pre.1) - i64::from(old.1),
    );
    for f in formulas {
        *f = adjust(f, dr, dc);
    }
    *ranges = new;
    true
}

/// The engine's values with one cell replaced: evaluates validation
/// formulas as if the input were already entered.
pub(crate) struct Overlay<'a> {
    pub engine: &'a Engine,
    pub at: CellCoord,
    pub value: Value,
}

impl CellProvider for Overlay<'_> {
    fn sheet_id(&self, name: &str) -> Option<SheetId> {
        self.engine.sheet_id(name)
    }

    fn value(&self, c: CellCoord) -> Value {
        if c == self.at {
            self.value.clone()
        } else {
            self.engine.value(c)
        }
    }

    fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
        let used = CellProvider::used_range(self.engine, sheet);
        if sheet != self.at.sheet {
            return used;
        }
        let here = (self.at.row, self.at.col);
        Some(used.map_or(here, |(r, c)| (r.max(here.0), c.max(here.1))))
    }

    fn row_hidden(&self, sheet: SheetId, row: u32) -> RowHidden {
        CellProvider::row_hidden(self.engine, sheet, row)
    }

    fn is_subtotal_cell(&self, c: CellCoord) -> bool {
        c != self.at && CellProvider::is_subtotal_cell(self.engine, c)
    }
}

/// Excel's truth value of a rule formula result: `TRUE` or a non-zero
/// number (text, blanks and errors are false).
pub(crate) fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => *n != 0.0,
        Value::Array(_) => truthy(&v.clone().into_scalar()),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
        CellRect { r0, c0, r1, c1 }
    }

    #[test]
    fn subtract_splits_into_four() {
        let r = rect(0, 0, 9, 9);
        let parts = rect_subtract(&r, &rect(3, 3, 5, 5));
        assert_eq!(
            parts,
            vec![
                rect(0, 0, 2, 9),
                rect(6, 0, 9, 9),
                rect(3, 0, 5, 2),
                rect(3, 6, 5, 9)
            ]
        );
        let cells: u32 = parts
            .iter()
            .map(|p| (p.r1 - p.r0 + 1) * (p.c1 - p.c0 + 1))
            .sum();
        assert_eq!(cells, 100 - 9);
        assert_eq!(rect_subtract(&r, &rect(20, 20, 30, 30)), vec![r]);
        assert!(rect_subtract(&r, &rect(0, 0, 20, 20)).is_empty());
    }

    #[test]
    fn reanchoring_keeps_meaning() {
        let mut ranges = vec![rect(0, 0, 9, 0)];
        let mut f = "A1>$B$1".to_string();
        let mut changed = false;
        assert!(subtract_ranges(
            &mut ranges,
            vec![&mut f],
            &rect(0, 0, 1, 0),
            &mut changed
        ));
        assert!(changed);
        assert_eq!(ranges, vec![rect(2, 0, 9, 0)]);
        assert_eq!(f, "A3>$B$1");
    }

    #[test]
    fn deleting_the_anchor_row_keeps_self_references() {
        let op = StructuralOp::DeleteRows { at: 4, count: 2 };
        let mut ranges = vec![rect(4, 0, 9, 0)];
        let mut f = "A5>B$1".to_string();
        assert!(shift_rule(&mut ranges, vec![&mut f], op, true, "S", "S"));
        assert_eq!(ranges, vec![rect(4, 0, 7, 0)]);
        assert_eq!(f, "A5>B$1");
        // Inserting above moves range and references.
        let op = StructuralOp::InsertRows { at: 0, count: 2 };
        assert!(shift_rule(&mut ranges, vec![&mut f], op, true, "S", "S"));
        assert_eq!(ranges, vec![rect(6, 0, 9, 0)]);
        assert_eq!(f, "A7>B$3");
        // Inserting a column between A and B moves the neighbour reference.
        let op = StructuralOp::InsertCols { at: 1, count: 1 };
        assert!(shift_rule(&mut ranges, vec![&mut f], op, true, "S", "S"));
        assert_eq!(f, "A7>C$3");
        // A different sheet: only references to it move.
        let mut g = "Other!A1+A1".to_string();
        let op = StructuralOp::InsertRows { at: 0, count: 1 };
        assert!(shift_rule(
            &mut ranges,
            vec![&mut g],
            op,
            false,
            "S",
            "Other"
        ));
        assert_eq!(g, "Other!A2+A1");
        // Deleting every row of the rule removes it.
        let op = StructuralOp::DeleteRows { at: 0, count: 100 };
        assert!(!shift_rule(&mut ranges, vec![&mut f], op, true, "S", "S"));
    }
}
