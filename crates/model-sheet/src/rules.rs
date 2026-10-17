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
    adjust_references_shift, offset_relative, parse, AdjustContext, CellCoord, CellProvider,
    CellRect, CellShift, Engine, Expr, RowHidden, SheetId, StructuralOp, Value,
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

/// Excel's Insert / Delete Cells on a rule range that sticks out of the
/// shifted band: the range is split at the band's edges (the part inside
/// the band follows the cells, the parts beside it stay), so that the
/// rule keeps covering exactly the cells it covered.
pub(crate) fn split_at_band(shift: CellShift, r: &CellRect) -> Vec<CellRect> {
    let Some((lo, hi)) = shift.band else {
        return vec![*r];
    };
    if !shift.touches((r.r0, r.c0, r.r1, r.c1)) {
        return vec![*r];
    }
    let rows = shift.op.is_rows();
    // The perpendicular interval of the rectangle.
    let (p0, p1) = if rows { (r.c0, r.c1) } else { (r.r0, r.r1) };
    if lo <= p0 && p1 <= hi {
        return vec![*r];
    }
    let mut cuts = Vec::with_capacity(3);
    if p0 < lo {
        cuts.push((p0, p1.min(lo - 1)));
    }
    let (a, b) = (p0.max(lo), p1.min(hi));
    if a <= b {
        cuts.push((a, b));
    }
    if p1 > hi {
        cuts.push((p0.max(hi + 1), p1));
    }
    cuts.into_iter()
        .map(|(a, b)| {
            if rows {
                CellRect { c0: a, c1: b, ..*r }
            } else {
                CellRect { r0: a, r1: b, ..*r }
            }
        })
        .collect()
}

/// Moves a rule living on `host` for a row/column insert or delete on
/// `target` (`same` = they are the same sheet): its ranges move, grow or
/// shrink like merges, its formulas like cell formulas (first re-anchored
/// at a cell that survives the edit, so that references to the rule's
/// own cells never become `#REF!`). `false` when no range is left.
pub(crate) fn shift_rule(
    ranges: &mut Vec<CellRect>,
    formulas: Vec<&mut String>,
    shift: impl Into<CellShift>,
    same: bool,
    host: &str,
    target: &str,
) -> bool {
    let shift: CellShift = shift.into();
    let op = shift.op;
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
        let adjusted = adjust_references_shift(&moved, &ctx, shift.band);
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
        .flat_map(|r| split_at_band(shift, r))
        .filter_map(|r| {
            let (r0, c0, r1, c1) = shift.map_rect((r.r0, r.c0, r.r1, r.c1))?;
            Some(CellRect { r0, c0, r1, c1 })
        })
        .collect();
    let (Some(old), Some(now)) = (anchor(ranges), anchor(&new)) else {
        return false;
    };
    // The new anchor's cell before the edit.
    let pre = if op.is_rows() {
        if shift.in_band(now.1) {
            (unmap_index(op, now.0), now.1)
        } else {
            now
        }
    } else if shift.in_band(now.0) {
        (now.0, unmap_index(op, now.1))
    } else {
        now
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

// --- copy, move, sort and rename (P9-C5) ---------------------------------------

/// A conditional formatting rule or a data validation: what copying,
/// moving and sorting cells do to both.
pub(crate) trait RuleLike: Clone + PartialEq {
    fn parts_mut(&mut self) -> (&mut Vec<CellRect>, Vec<&mut String>);
    fn ranges(&self) -> &[CellRect];
    /// The sheet's list of this kind of rule.
    fn list(data: &mut crate::sheet::SheetData) -> &mut Vec<Self>;
    /// New rules go on top of the list (conditional formatting priority).
    const ON_TOP: bool = false;
    /// What identifies the rule in its list (a rule id).
    fn key(&self) -> Option<u32> {
        None
    }
    /// Clears what identifies the rule in its list (id, priority).
    fn clear_identity(&mut self) {}
    /// After edits of the list: fresh ids, priorities.
    fn finish(_list: &mut [Self]) {}
}

impl RuleLike for crate::CfRule {
    fn parts_mut(&mut self) -> (&mut Vec<CellRect>, Vec<&mut String>) {
        crate::CfRule::parts_mut(self)
    }
    fn ranges(&self) -> &[CellRect] {
        &self.ranges
    }
    fn list(data: &mut crate::sheet::SheetData) -> &mut Vec<Self> {
        &mut data.conditional_formats
    }
    const ON_TOP: bool = true;
    fn key(&self) -> Option<u32> {
        Some(self.id)
    }
    fn clear_identity(&mut self) {
        self.id = 0;
        self.priority = 0;
    }
    fn finish(list: &mut [Self]) {
        let mut seen = std::collections::HashSet::new();
        let mut next = list.iter().map(|r| r.id).max().unwrap_or(0);
        for (i, r) in list.iter_mut().enumerate() {
            if r.id == 0 || !seen.insert(r.id) {
                next += 1;
                r.id = next;
                seen.insert(next);
            }
            r.priority = i as u32 + 1;
        }
    }
}

impl RuleLike for crate::DataValidation {
    fn parts_mut(&mut self) -> (&mut Vec<CellRect>, Vec<&mut String>) {
        crate::DataValidation::parts_mut(self)
    }
    fn ranges(&self) -> &[CellRect] {
        &self.ranges
    }
    fn list(data: &mut crate::sheet::SheetData) -> &mut Vec<Self> {
        &mut data.validations
    }
}

/// `r` moved by `(dr, dc)`; `None` when it leaves the sheet.
pub(crate) fn shift_rect(r: &CellRect, dr: i64, dc: i64) -> Option<CellRect> {
    let m = |v: u32, d: i64, max: u32| {
        let x = i64::from(v) + d;
        (0..=i64::from(max)).contains(&x).then_some(x as u32)
    };
    Some(CellRect {
        r0: m(r.r0, dr, MAX_ROW)?,
        c0: m(r.c0, dc, MAX_COL)?,
        r1: m(r.r1, dr, MAX_ROW)?,
        c1: m(r.c1, dc, MAX_COL)?,
    })
}

/// A range list without contained duplicates, with neighbours that form
/// a rectangle merged (`A1`, `A2:A3` → `A1:A3`), sorted by position.
pub(crate) fn coalesce(rects: Vec<CellRect>) -> Vec<CellRect> {
    let mut v = rects;
    loop {
        let mut changed = false;
        'outer: for i in 0..v.len() {
            for j in 0..v.len() {
                if i == j {
                    continue;
                }
                let (a, b) = (v[i], v[j]);
                let contains = a.r0 <= b.r0 && a.c0 <= b.c0 && b.r1 <= a.r1 && b.c1 <= a.c1;
                let stack =
                    a.c0 == b.c0 && a.c1 == b.c1 && b.r0 <= a.r1.saturating_add(1) && a.r0 <= b.r0;
                let side =
                    a.r0 == b.r0 && a.r1 == b.r1 && b.c0 <= a.c1.saturating_add(1) && a.c0 <= b.c0;
                if contains || stack || side {
                    v[i] = CellRect {
                        r0: a.r0.min(b.r0),
                        c0: a.c0.min(b.c0),
                        r1: a.r1.max(b.r1),
                        c1: a.c1.max(b.c1),
                    };
                    v.remove(j);
                    changed = true;
                    break 'outer;
                }
            }
        }
        if !changed {
            v.sort_by_key(|r| (r.c0, r.r0));
            return v;
        }
    }
}

/// `rule` with new ranges (formulas re-anchored).
fn with_ranges<T: RuleLike>(rule: &T, ranges: Vec<CellRect>) -> Option<T> {
    let mut out = rule.clone();
    let (r, f) = out.parts_mut();
    set_ranges(r, f, ranges).then_some(out)
}

/// `a` and `b` merged into one rule (`a`'s identity) when they do the
/// same thing: equal apart from ranges, and equal formulas once both are
/// written for the anchor of the combined ranges.
fn merged<T: RuleLike>(a: &T, b: &T) -> Option<T> {
    let all: Vec<CellRect> = a.ranges().iter().chain(b.ranges()).copied().collect();
    let joined = coalesce(all.clone());
    let at = anchor(&all)?;
    let pin = |r: &T| -> Option<T> {
        let mut x = with_ranges(
            r,
            vec![CellRect {
                r0: at.0,
                c0: at.1,
                r1: at.0,
                c1: at.1,
            }],
        )?;
        x.clear_identity();
        Some(x)
    };
    if pin(a)? != pin(b)? {
        return None;
    }
    with_ranges(a, joined)
}

/// Adds `rule` to `list`, merged into an equivalent rule when there is
/// one (the one at `prefer` first); otherwise inserted at `at` (`None`:
/// the end). Returns the index of the rule that holds it.
fn place<T: RuleLike>(
    list: &mut Vec<T>,
    rule: T,
    prefer: Option<usize>,
    at: Option<usize>,
) -> usize {
    let order = prefer
        .into_iter()
        .chain((0..list.len()).filter(|&i| Some(i) != prefer));
    for i in order.collect::<Vec<_>>() {
        if let Some(m) = list.get(i).and_then(|q| merged(q, &rule)) {
            list[i] = m;
            return i;
        }
    }
    let at = at.unwrap_or(list.len()).min(list.len());
    list.insert(at, rule);
    at
}

/// The parts of every rule of `list` inside `area` (each with the index
/// of its rule): the rule with its ranges cut to the area.
fn parts_in<T: RuleLike>(list: &[T], area: &CellRect) -> Vec<(usize, T)> {
    list.iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let parts: Vec<CellRect> = r
                .ranges()
                .iter()
                .filter_map(|x| rect_intersection(x, area))
                .collect();
            if parts.is_empty() {
                return None;
            }
            Some((i, with_ranges(r, parts)?))
        })
        .collect()
}

/// `list` without the cells of `cut` (rules left without cells vanish).
fn remove_area<T: RuleLike>(list: &mut Vec<T>, cut: &CellRect) {
    let mut changed = false;
    list.retain_mut(|r| {
        let (ranges, formulas) = r.parts_mut();
        subtract_ranges(ranges, formulas, cut, &mut changed)
    });
}

/// What a paste carries along with the cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RulesPaste {
    /// Conditional formatting (Paste, Paste Formats, Format Painter).
    pub cf: bool,
    /// Data validation (Paste, Paste Special › Validation, Format Painter).
    pub validation: bool,
}

impl crate::Workbook {
    /// Copies the conditional formatting and/or validations of `src` to
    /// the block at `origin` on `dst`, repeated `repeats` (rows, columns)
    /// times, as Excel's paste does: the destination block loses its own
    /// rules first; each copied part is written for its new place (rule
    /// formulas move like copied formulas) and joins an equivalent rule of
    /// the destination sheet (the one it came from first) – copying a cell
    /// with a rule next to it extends the rule's range – or becomes a new
    /// rule (conditional formats on top, in their order).
    pub fn copy_rules(
        &mut self,
        src: crate::CellRange,
        dst: SheetId,
        origin: (u32, u32),
        repeats: (u32, u32),
        what: RulesPaste,
    ) -> Result<(), Error> {
        let (h, w) = (src.r1 - src.r0 + 1, src.c1 - src.c0 + 1);
        let area = CellRect {
            r0: src.r0,
            c0: src.c0,
            r1: src.r1,
            c1: src.c1,
        };
        let mut tiles = Vec::new();
        for ti in 0..repeats.0.max(1) {
            for tj in 0..repeats.1.max(1) {
                tiles.push((
                    i64::from(origin.0) + i64::from(ti * h) - i64::from(src.r0),
                    i64::from(origin.1) + i64::from(tj * w) - i64::from(src.c0),
                ));
            }
        }
        let block = CellRect {
            r0: origin.0,
            c0: origin.1,
            r1: (u64::from(origin.0) + u64::from(h) * u64::from(repeats.0.max(1)) - 1)
                .min(u64::from(MAX_ROW)) as u32,
            c1: (u64::from(origin.1) + u64::from(w) * u64::from(repeats.1.max(1)) - 1)
                .min(u64::from(MAX_COL)) as u32,
        };
        self.sheet_data_mut(dst)?;
        if what.cf {
            self.paste_list::<crate::CfRule>(src.sheet, &area, dst, &block, &tiles)?;
        }
        if what.validation {
            self.paste_list::<crate::DataValidation>(src.sheet, &area, dst, &block, &tiles)?;
        }
        Ok(())
    }

    fn paste_list<T: RuleLike + 'static>(
        &mut self,
        from: SheetId,
        area: &CellRect,
        dst: SheetId,
        block: &CellRect,
        tiles: &[(i64, i64)],
    ) -> Result<(), Error> {
        let parts = parts_in(T::list(self.sheet_data_mut(from)?), area);
        let list = T::list(self.sheet_data_mut(dst)?);
        remove_area(list, block);
        let mut top = 0;
        for (dr, dc) in tiles {
            for (_, part) in &parts {
                let ranges: Vec<CellRect> = part
                    .ranges()
                    .iter()
                    .filter_map(|r| shift_rect(r, *dr, *dc))
                    .collect();
                let Some(mut copy) = with_ranges(part, ranges) else {
                    continue;
                };
                copy.clear_identity();
                if T::ON_TOP {
                    if place(list, copy, None, Some(top)) == top {
                        top += 1;
                    }
                } else {
                    place(list, copy, None, None);
                }
            }
        }
        T::finish(list);
        Ok(())
    }

    /// Moves the conditional formatting and validations of `src` with its
    /// cells to `origin` on `dst` (Cut + Paste): the destination block
    /// loses its rules, the moved parts leave their rules and join the
    /// same (or an equivalent) rule at the destination, keeping their
    /// meaning (rule formulas move with the cells).
    pub fn move_rules(
        &mut self,
        src: crate::CellRange,
        dst: SheetId,
        origin: (u32, u32),
    ) -> Result<(), Error> {
        let area = CellRect {
            r0: src.r0,
            c0: src.c0,
            r1: src.r1,
            c1: src.c1,
        };
        let (dr, dc) = (
            i64::from(origin.0) - i64::from(src.r0),
            i64::from(origin.1) - i64::from(src.c0),
        );
        let block = shift_rect(&area, dr, dc).ok_or(Error::InvalidRange)?;
        self.sheet_data_mut(dst)?;
        self.move_list::<crate::CfRule>(src.sheet, &area, dst, &block, (dr, dc))?;
        self.move_list::<crate::DataValidation>(src.sheet, &area, dst, &block, (dr, dc))?;
        Ok(())
    }

    fn move_list<T: RuleLike + 'static>(
        &mut self,
        from: SheetId,
        area: &CellRect,
        dst: SheetId,
        block: &CellRect,
        (dr, dc): (i64, i64),
    ) -> Result<(), Error> {
        let src_list = T::list(self.sheet_data_mut(from)?);
        let parts = parts_in(src_list, area);
        remove_area(src_list, area);
        T::finish(src_list);
        let list = T::list(self.sheet_data_mut(dst)?);
        remove_area(list, block);
        for (i, part) in parts {
            let ranges: Vec<CellRect> = part
                .ranges()
                .iter()
                .filter_map(|r| shift_rect(r, dr, dc))
                .collect();
            let Some(mut moved) = with_ranges(&part, ranges) else {
                continue;
            };
            if from == dst {
                // Back into its own rule when that survived, else in its place.
                let own = part
                    .key()
                    .and_then(|k| list.iter().position(|q| q.key() == Some(k)));
                place(list, moved, own, Some(i));
            } else {
                moved.clear_identity();
                place(list, moved, None, T::ON_TOP.then_some(0));
            }
        }
        T::finish(list);
        Ok(())
    }

    /// Sorting moved the lines `moves` (`(from, to)`, rows; columns for a
    /// left-to-right sort) of the block spanning `span` (columns; rows):
    /// the conditional formatting and validations of the moved cells go
    /// with them.
    pub(crate) fn permute_rule_lines(
        &mut self,
        sheet: SheetId,
        columns: bool,
        span: (u32, u32),
        moves: &[(u32, u32)],
    ) {
        if moves.is_empty() {
            return;
        }
        let Ok(data) = self.sheet_data_mut(sheet) else {
            return;
        };
        permute_list(&mut data.conditional_formats, columns, span, moves);
        permute_list(&mut data.validations, columns, span, moves);
    }

    /// Rewrites the sheet name `from` to `to` in every rule and validation
    /// formula of the workbook (Excel's sheet rename).
    pub(crate) fn rename_rule_refs(&mut self, from: &str, to: &str) {
        for (id, _) in self.sheets() {
            let Ok(data) = self.sheet_data_mut(id) else {
                continue;
            };
            for rule in &mut data.conditional_formats {
                rename_formulas(rule.parts_mut().1, from, to);
            }
            for dv in &mut data.validations {
                rename_formulas(dv.parts_mut().1, from, to);
            }
        }
    }
}

fn rename_formulas(formulas: Vec<&mut String>, from: &str, to: &str) {
    for f in formulas {
        if let Ok(mut ast) = parse_formula(f) {
            if rename_refs(&mut ast, from, to) {
                *f = ast.to_string().trim_start_matches('=').to_owned();
            }
        }
    }
}

fn same_name(a: &str, b: &str) -> bool {
    a.chars()
        .flat_map(char::to_lowercase)
        .eq(b.chars().flat_map(char::to_lowercase))
}

/// Replaces the sheet prefix `from` (case-insensitive) by `to` in every
/// reference and qualified name of `e`; whether anything changed.
fn rename_refs(e: &mut Expr, from: &str, to: &str) -> bool {
    match e {
        Expr::QualifiedName { sheet, .. } if same_name(sheet, from) => {
            *sheet = to.to_owned();
            true
        }
        Expr::Reference(r) => {
            let mut hit = false;
            for s in [&mut r.sheet, &mut r.sheet_last].into_iter().flatten() {
                if same_name(s, from) {
                    *s = to.to_owned();
                    hit = true;
                }
            }
            hit
        }
        Expr::Call { args, .. } => args
            .iter_mut()
            .fold(false, |acc, a| rename_refs(a, from, to) | acc),
        Expr::Unary { expr, .. } => rename_refs(expr, from, to),
        Expr::Binary { lhs, rhs, .. } => rename_refs(lhs, from, to) | rename_refs(rhs, from, to),
        Expr::Array(rows) => rows
            .iter_mut()
            .flatten()
            .fold(false, |acc, a| rename_refs(a, from, to) | acc),
        _ => false,
    }
}

/// The rows (`columns`: columns) of `ranges` that `moves` map, moved; the
/// rest stays. `span` limits the moved band across.
fn permute_ranges(
    ranges: &[CellRect],
    columns: bool,
    span: (u32, u32),
    moves: &[(u32, u32)],
) -> Vec<CellRect> {
    // Work in (line, across) coordinates: lines are rows for a top-to-bottom sort.
    let flip = |r: &CellRect| {
        if columns {
            CellRect {
                r0: r.c0,
                c0: r.r0,
                r1: r.c1,
                c1: r.r1,
            }
        } else {
            *r
        }
    };
    let moved: std::collections::BTreeMap<u32, u32> = moves.iter().copied().collect();
    let mut lines: Vec<u32> = moved.keys().copied().collect();
    lines.sort_unstable();
    // The moved band: runs of moved lines × span.
    let mut bands = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let mut j = i;
        while j + 1 < lines.len() && lines[j + 1] == lines[j] + 1 {
            j += 1;
        }
        bands.push(CellRect {
            r0: lines[i],
            c0: span.0,
            r1: lines[j],
            c1: span.1,
        });
        i = j + 1;
    }
    let flipped: Vec<CellRect> = ranges.iter().map(flip).collect();
    let mut out: Vec<CellRect> = flipped.clone();
    for b in &bands {
        out = out.iter().flat_map(|r| rect_subtract(r, b)).collect();
    }
    // Covered cells inside the band, per across-index, mapped.
    for across in span.0..=span.1 {
        let mut hit: Vec<u32> = lines
            .iter()
            .filter(|&&l| flipped.iter().any(|r| rect_contains(r, l, across)))
            .map(|l| moved[l])
            .collect();
        hit.sort_unstable();
        for l in hit {
            out.push(CellRect {
                r0: l,
                c0: across,
                r1: l,
                c1: across,
            });
        }
    }
    coalesce(out).iter().map(flip).collect()
}

fn permute_list<T: RuleLike>(
    list: &mut [T],
    columns: bool,
    span: (u32, u32),
    moves: &[(u32, u32)],
) {
    for rule in list.iter_mut() {
        let touches = rule.ranges().iter().any(|r| {
            let (l0, l1, a0, a1) = if columns {
                (r.c0, r.c1, r.r0, r.r1)
            } else {
                (r.r0, r.r1, r.c0, r.c1)
            };
            a0 <= span.1 && span.0 <= a1 && moves.iter().any(|(f, _)| (l0..=l1).contains(f))
        });
        if !touches {
            continue;
        }
        let new = permute_ranges(rule.ranges(), columns, span, moves);
        let mut a = coalesce(rule.ranges().to_vec());
        let mut b = new.clone();
        a.sort_by_key(|r| (r.r0, r.c0));
        b.sort_by_key(|r| (r.r0, r.c0));
        if a != b {
            let (ranges, formulas) = rule.parts_mut();
            set_ranges(ranges, formulas, new);
        }
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
    fn insert_cells_split_ranges_at_the_band() {
        // Insert Cells B2:B3, shift down, inside A1:C10.
        let shift = CellShift::new(StructuralOp::InsertRows { at: 1, count: 2 }, 1, 1);
        assert_eq!(
            split_at_band(shift, &rect(0, 0, 9, 2)),
            vec![rect(0, 0, 9, 0), rect(0, 1, 9, 1), rect(0, 2, 9, 2)]
        );
        let mut ranges = vec![rect(0, 0, 9, 2)];
        let mut f = "A1>0".to_string();
        assert!(shift_rule(&mut ranges, vec![&mut f], shift, true, "S", "S"));
        assert_eq!(
            ranges,
            vec![rect(0, 0, 9, 0), rect(0, 1, 11, 1), rect(0, 2, 9, 2)]
        );
        assert_eq!(f, "A1>0");
        // A range above the edit, or one inside the band, is not split.
        assert_eq!(
            split_at_band(shift, &rect(0, 0, 0, 2)),
            vec![rect(0, 0, 0, 2)]
        );
        assert_eq!(
            split_at_band(shift, &rect(3, 1, 5, 1)),
            vec![rect(3, 1, 5, 1)]
        );
        // Delete Cells A1:B1, shift left (band = row 0) on B1:D2.
        let shift = CellShift::new(StructuralOp::DeleteCols { at: 0, count: 2 }, 0, 0);
        let mut ranges = vec![rect(0, 1, 1, 3)];
        assert!(shift_rule(&mut ranges, vec![], shift, true, "S", "S"));
        assert_eq!(ranges, vec![rect(0, 0, 0, 1), rect(1, 1, 1, 3)]);
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

    use crate::{CfKind, CfRule, DataValidation, DxfStyle, ValidationKind, Workbook};
    use engine_formula::RangeRef;

    fn bold_rule(ranges: Vec<CellRect>, formula: &str) -> CfRule {
        CfRule {
            ranges,
            dxf: Some(DxfStyle {
                bold: Some(true),
                ..Default::default()
            }),
            ..CfRule::new(CfKind::Expression {
                formula: formula.into(),
            })
        }
    }

    fn custom_dv(ranges: Vec<CellRect>, formula: &str) -> DataValidation {
        DataValidation::new(
            ranges,
            ValidationKind::Custom {
                formula: formula.into(),
            },
        )
    }

    #[test]
    fn coalesce_merges_neighbours() {
        assert_eq!(
            coalesce(vec![rect(0, 0, 0, 0), rect(1, 0, 2, 0), rect(1, 0, 1, 0)]),
            vec![rect(0, 0, 2, 0)]
        );
        assert_eq!(
            coalesce(vec![rect(0, 1, 3, 1), rect(0, 0, 3, 0), rect(5, 0, 5, 0)]),
            vec![rect(0, 0, 3, 1), rect(5, 0, 5, 0)]
        );
    }

    #[test]
    fn copying_a_cell_extends_its_rule() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 0, 0, 0)], "A1>B1"))
            .unwrap();
        // Copy A1 to A2:A4 (repeated): one rule A1:A4, still relative.
        let what = RulesPaste {
            cf: true,
            validation: true,
        };
        wb.copy_rules(RangeRef::new(s, 0, 0, 0, 0), s, (1, 0), (3, 1), what)
            .unwrap();
        let rules = wb.cf_rules(s);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].ranges, vec![rect(0, 0, 3, 0)]);
        assert_eq!(
            rules[0].kind,
            CfKind::Expression {
                formula: "A1>B1".into()
            }
        );
        // Copy to C1: same rule (formula C1>D1 at C1 = A1>B1 relative).
        wb.copy_rules(RangeRef::new(s, 0, 0, 0, 0), s, (0, 2), (1, 1), what)
            .unwrap();
        assert_eq!(
            wb.cf_rules(s)[0].ranges,
            vec![rect(0, 0, 3, 0), rect(0, 2, 0, 2)]
        );
        // An absolute formula is a different rule at another place.
        wb.add_cf_rule(s, bold_rule(vec![rect(9, 0, 9, 0)], "$A$1>0"))
            .unwrap();
        wb.copy_rules(RangeRef::new(s, 9, 0, 9, 0), s, (10, 0), (1, 1), what)
            .unwrap();
        let abs = wb
            .cf_rules(s)
            .iter()
            .find(|r| {
                r.kind
                    == CfKind::Expression {
                        formula: "$A$1>0".into(),
                    }
            })
            .unwrap();
        assert_eq!(abs.ranges, vec![rect(9, 0, 10, 0)]);
    }

    #[test]
    fn pasting_replaces_the_destination_rules_and_copies_to_other_sheets() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let t = wb.add_sheet("Other").unwrap();
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 0, 0, 0)], "A1>1"))
            .unwrap();
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 1, 5, 1)], "B1<0"))
            .unwrap();
        wb.set_validation(s, custom_dv(vec![rect(0, 0, 0, 0)], "A1<>B1"))
            .unwrap();
        wb.set_validation(t, custom_dv(vec![rect(0, 0, 9, 0)], "LEN(A1)>2"))
            .unwrap();
        let what = RulesPaste {
            cf: true,
            validation: true,
        };
        // A1 over B3 (inside the second rule): B3 leaves it, gets A1's rule.
        wb.copy_rules(RangeRef::new(s, 0, 0, 0, 0), s, (2, 1), (1, 1), what)
            .unwrap();
        let second = wb
            .cf_rules(s)
            .iter()
            .find(|r| {
                r.kind
                    == CfKind::Expression {
                        formula: "B1<0".into(),
                    }
            })
            .unwrap();
        assert_eq!(second.ranges, vec![rect(0, 1, 1, 1), rect(3, 1, 5, 1)]);
        let first = wb
            .cf_rules(s)
            .iter()
            .find(|r| {
                r.kind
                    == CfKind::Expression {
                        formula: "A1>1".into(),
                    }
            })
            .unwrap();
        assert_eq!(first.ranges, vec![rect(0, 0, 0, 0), rect(2, 1, 2, 1)]);
        assert_eq!(
            wb.validations(s)[0].ranges,
            vec![rect(0, 0, 0, 0), rect(2, 1, 2, 1)]
        );
        // To another sheet: a new rule on top, the validation replaces.
        wb.copy_rules(RangeRef::new(s, 0, 0, 0, 0), t, (4, 0), (1, 1), what)
            .unwrap();
        let rules = wb.cf_rules(t);
        assert_eq!(rules.len(), 1);
        assert_eq!((rules[0].id, rules[0].priority), (1, 1));
        assert_eq!(
            rules[0].kind,
            CfKind::Expression {
                formula: "A5>1".into()
            }
        );
        let dvs = wb.validations(t);
        assert_eq!(dvs.len(), 2);
        assert_eq!(dvs[0].ranges, vec![rect(0, 0, 3, 0), rect(5, 0, 9, 0)]);
        assert_eq!(
            dvs[1].kind,
            ValidationKind::Custom {
                formula: "A5<>B5".into()
            }
        );
        // Formats only: no validation.
        wb.copy_rules(
            RangeRef::new(s, 0, 0, 0, 0),
            t,
            (20, 0),
            (1, 1),
            RulesPaste {
                cf: true,
                validation: false,
            },
        )
        .unwrap();
        assert_eq!(wb.validations(t).len(), 2);
        assert_eq!(wb.cf_rules(t)[0].ranges.len(), 2);
    }

    #[test]
    fn cut_and_paste_moves_rules_with_the_cells() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let t = wb.add_sheet("Other").unwrap();
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 0, 4, 0)], "A1>0"))
            .unwrap();
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 3, 0, 3)], "D1=1"))
            .unwrap();
        wb.set_validation(s, custom_dv(vec![rect(0, 0, 4, 0)], "A1>0"))
            .unwrap();
        // Cut A1:A2 to C1: the rule covers C1:C2 and A3:A5, still one rule.
        wb.move_rules(RangeRef::new(s, 0, 0, 1, 0), s, (0, 2))
            .unwrap();
        assert_eq!(wb.cf_rules(s).len(), 2);
        let r = &wb.cf_rules(s)[1];
        assert_eq!(r.ranges, vec![rect(2, 0, 4, 0), rect(0, 2, 1, 2)]);
        assert_eq!(
            r.kind,
            CfKind::Expression {
                formula: "A1>0".into()
            }
        );
        assert_eq!(
            wb.validations(s)[0].ranges,
            vec![rect(2, 0, 4, 0), rect(0, 2, 1, 2)]
        );
        // Cut D1 (a whole rule) to another sheet: it leaves this sheet.
        wb.move_rules(RangeRef::new(s, 0, 3, 0, 3), t, (5, 5))
            .unwrap();
        assert_eq!(wb.cf_rules(s).len(), 1);
        assert_eq!(wb.cf_rules(s)[0].id, 1);
        let moved = &wb.cf_rules(t)[0];
        assert_eq!(moved.ranges, vec![rect(5, 5, 5, 5)]);
        assert_eq!(
            moved.kind,
            CfKind::Expression {
                formula: "F6=1".into()
            }
        );
        // Cut onto cells with rules: they lose theirs.
        wb.move_rules(RangeRef::new(s, 2, 0, 2, 0), s, (0, 2))
            .unwrap();
        let r = &wb.cf_rules(s)[0];
        assert_eq!(r.ranges, vec![rect(3, 0, 4, 0), rect(0, 2, 1, 2)]);
    }

    #[test]
    fn sorting_moves_rules_and_validations_with_their_rows() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for (r, v) in ["3", "1", "2"].iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, 0), v).unwrap();
        }
        // A1 (value 3) has a rule and a validation; after sorting it is A3.
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 0, 0, 0)], "TRUE"))
            .unwrap();
        wb.set_validation(s, custom_dv(vec![rect(0, 0, 0, 0)], "TRUE"))
            .unwrap();
        let spec = crate::SortSpec {
            keys: vec![crate::SortKey {
                col: 0,
                ascending: true,
                kind: crate::SortKind::Auto,
                ..Default::default()
            }],
            ..Default::default()
        };
        wb.sort_range(RangeRef::new(s, 0, 0, 2, 0), &spec).unwrap();
        assert_eq!(wb.cf_rules(s)[0].ranges, vec![rect(2, 0, 2, 0)]);
        assert_eq!(wb.validations(s)[0].ranges, vec![rect(2, 0, 2, 0)]);
        // A rule over the whole column is unchanged.
        let mut ranges = vec![rect(0, 0, 9, 0)];
        assert_eq!(
            permute_ranges(&ranges, false, (0, 0), &[(0, 2), (2, 0)]),
            ranges
        );
        // Left-to-right: columns move.
        ranges = vec![rect(0, 0, 3, 0)];
        assert_eq!(
            permute_ranges(&ranges, true, (0, 1), &[(0, 2), (2, 0)]),
            vec![rect(0, 2, 1, 2), rect(2, 0, 3, 0)]
        );
    }

    #[test]
    fn renaming_a_sheet_rewrites_rule_formulas() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let t = wb.add_sheet("Data").unwrap();
        wb.add_cf_rule(s, bold_rule(vec![rect(0, 0, 0, 0)], "A1>Data!$A$1"))
            .unwrap();
        wb.set_validation(
            s,
            DataValidation::new(
                vec![rect(1, 0, 1, 0)],
                ValidationKind::List {
                    source: crate::ListSource::Formula {
                        formula: "Data!$A$1:$A$3".into(),
                    },
                },
            ),
        )
        .unwrap();
        wb.set_validation(t, custom_dv(vec![rect(0, 0, 0, 0)], "'Data'!B1>0"))
            .unwrap();
        wb.rename_sheet(t, "My Data").unwrap();
        assert_eq!(
            wb.cf_rules(s)[0].kind,
            CfKind::Expression {
                formula: "A1>'My Data'!$A$1".into()
            }
        );
        assert_eq!(
            wb.validations(s)[0].formulas(),
            vec!["'My Data'!$A$1:$A$3".to_string()]
        );
        assert_eq!(
            wb.validations(t)[0].formulas(),
            vec!["'My Data'!B1>0".to_string()]
        );
    }
}
