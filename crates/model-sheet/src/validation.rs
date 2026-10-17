//! Data validation (Excel's Data ▸ Data Validation).
//!
//! Every sheet keeps a list of [`DataValidation`]s with pairwise disjoint
//! ranges (a cell has at most one validation, as in Excel). The workbook
//! checks input against them ([`Workbook::validate_input`], called by the
//! UI before it sets a cell; the UI decides what a failed check does
//! according to [`ErrorStyle`]) and lists the values of a list validation
//! for the in-cell dropdown ([`Workbook::list_values`]).
//!
//! Formulas (`f1`, `f2`, custom formulas, list sources) are written for
//! the anchor cell of the validation (see `crate::rules`) and evaluated
//! for the edited cell as if the input were already entered (cells that
//! depend on the edited cell are not recomputed for the check).
//!
//! ```
//! use engine_formula::{CellCoord, CellRect};
//! use model_sheet::{CompareOp, DataValidation, ValidationKind, Workbook};
//!
//! let mut wb = Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! let dv = DataValidation::new(
//!     vec![CellRect { r0: 0, c0: 0, r1: 9, c1: 0 }],
//!     ValidationKind::Whole { op: CompareOp::Between, f1: "1".into(), f2: Some("10".into()) },
//! );
//! wb.set_validation(s, dv).unwrap();
//! let at = CellCoord::new(s, 3, 0);
//! assert!(wb.validate_input(at, "7").unwrap().ok);
//! assert!(!wb.validate_input(at, "7.5").unwrap().ok);
//! assert!(!wb.validate_input(at, "11").unwrap().ok);
//! ```

use engine_formula::engine::parse_input;
use engine_formula::eval::{eval_operand, evaluate, CellProvider, Operand};
use engine_formula::value::{compare, format_general, to_number, to_text};
use engine_formula::{offset_relative, CellContent, CellCoord, CellRect, SheetId, Value};
use serde::{Deserialize, Serialize};

use crate::condfmt::CompareOp;
use crate::rules::{
    anchor, check_formulas, check_ranges, parse_formula, rect_contains, rect_intersection,
    subtract_ranges, truthy, Overlay,
};
use crate::workbook::Workbook;
use crate::{CellRange, Error};

/// The default message of a failed check (Excel's wording).
pub const DEFAULT_ERROR_MESSAGE: &str =
    "This value doesn't match the data validation restrictions defined for this cell.";

/// Where the values of a list validation come from.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ListSource {
    /// A range (`$A$1:$A$9`, `Other!$B:$B`) or other formula without `=`.
    Formula { formula: String },
    /// The values typed into the dialog (`"a,b,c"` in the file).
    Literal { values: Vec<String> },
}

/// What a validation allows.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ValidationKind {
    /// Any value (only shows the input message).
    Any,
    /// One of the list's values (case-insensitive).
    List { source: ListSource },
    /// Integers compared with `f1` (and `f2`).
    Whole {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        f2: Option<String>,
    },
    Decimal {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        f2: Option<String>,
    },
    /// Date serial numbers.
    Date {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        f2: Option<String>,
    },
    /// Time fractions.
    Time {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        f2: Option<String>,
    },
    /// The length of the text (numbers as General text).
    TextLength {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        f2: Option<String>,
    },
    /// A formula that must be true for the edited cell.
    Custom { formula: String },
}

impl ValidationKind {
    fn formulas_mut(&mut self) -> Vec<&mut String> {
        match self {
            ValidationKind::Any => Vec::new(),
            ValidationKind::List { source } => match source {
                ListSource::Formula { formula } => vec![formula],
                ListSource::Literal { .. } => Vec::new(),
            },
            ValidationKind::Whole { f1, f2, .. }
            | ValidationKind::Decimal { f1, f2, .. }
            | ValidationKind::Date { f1, f2, .. }
            | ValidationKind::Time { f1, f2, .. }
            | ValidationKind::TextLength { f1, f2, .. } => {
                std::iter::once(f1).chain(f2.as_mut()).collect()
            }
            ValidationKind::Custom { formula } => vec![formula],
        }
    }

    /// `(op, f1, f2)` of the comparing kinds.
    fn comparison(&self) -> Option<(CompareOp, &String, Option<&String>)> {
        match self {
            ValidationKind::Whole { op, f1, f2 }
            | ValidationKind::Decimal { op, f1, f2 }
            | ValidationKind::Date { op, f1, f2 }
            | ValidationKind::Time { op, f1, f2 }
            | ValidationKind::TextLength { op, f1, f2 } => Some((*op, f1, f2.as_ref())),
            _ => None,
        }
    }
}

/// What the UI does when a check fails: `Stop` rejects the input,
/// `Warning` asks (Yes keeps it), `Information` only informs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorStyle {
    #[default]
    Stop,
    Warning,
    Information,
}

/// A data validation of one sheet.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataValidation {
    pub ranges: Vec<CellRect>,
    pub kind: ValidationKind,
    /// "Ignore blank": an empty input passes.
    pub allow_blank: bool,
    /// Show the in-cell dropdown of a list.
    pub show_dropdown: bool,
    /// Show the input message when the cell is selected.
    pub show_input: bool,
    /// Check input at all (Excel's "Show error alert after invalid data").
    pub show_error: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default)]
    pub error_style: ErrorStyle,
}

impl DataValidation {
    /// A validation with Excel's dialog defaults: ignore blank, dropdown,
    /// input message and error alert on, style `Stop`, no texts.
    pub fn new(ranges: Vec<CellRect>, kind: ValidationKind) -> Self {
        DataValidation {
            ranges,
            kind,
            allow_blank: true,
            show_dropdown: true,
            show_input: true,
            show_error: true,
            input_title: None,
            input_message: None,
            error_title: None,
            error_message: None,
            error_style: ErrorStyle::Stop,
        }
    }

    pub(crate) fn parts_mut(&mut self) -> (&mut Vec<CellRect>, Vec<&mut String>) {
        (&mut self.ranges, self.kind.formulas_mut())
    }

    /// Every formula of the validation (bounds, custom formula, list
    /// source range), without `=`.
    pub fn formulas(&self) -> Vec<String> {
        let mut copy = self.kind.clone();
        copy.formulas_mut().into_iter().map(|f| f.clone()).collect()
    }

    fn check(&mut self) -> Result<(), Error> {
        check_ranges(&mut self.ranges)?;
        check_formulas(self.kind.formulas_mut())?;
        if let Some((op, _, f2)) = self.kind.comparison() {
            if op.needs_two() != f2.is_some() {
                return Err(Error::InvalidRule("wrong number of formulas".into()));
            }
        }
        Ok(())
    }

    fn contains(&self, row: u32, col: u32) -> bool {
        self.ranges.iter().any(|r| rect_contains(r, row, col))
    }
}

/// The outcome of [`Workbook::validate_input`].
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub ok: bool,
    /// Index of the cell's validation in the sheet's list, if it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<u32>,
    /// Set when the check failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_style: Option<ErrorStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The validation's error message, or [`DEFAULT_ERROR_MESSAGE`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Workbook {
    /// The data validations of `sheet`.
    pub fn validations(&self, sheet: SheetId) -> &[DataValidation] {
        &self.sheet_data(sheet).validations
    }

    /// Replaces the validations of `sheet` (loading files, undo). Each is
    /// checked and normalized; on overlaps the later one wins (its ranges
    /// are removed from the earlier ones). On error nothing changes.
    pub fn set_validations(
        &mut self,
        sheet: SheetId,
        validations: Vec<DataValidation>,
    ) -> Result<(), Error> {
        self.sheet_data_mut(sheet)?;
        let mut list: Vec<DataValidation> = Vec::with_capacity(validations.len());
        for mut dv in validations {
            dv.check()?;
            remove_ranges(&mut list, &dv.ranges);
            list.push(dv);
        }
        self.sheet_data_mut(sheet)?.validations = list;
        Ok(())
    }

    /// Sets a validation on its ranges, replacing any validation of those
    /// cells (Excel keeps one per cell).
    pub fn set_validation(
        &mut self,
        sheet: SheetId,
        validation: DataValidation,
    ) -> Result<(), Error> {
        let mut dv = validation;
        dv.check()?;
        let list = &mut self.sheet_data_mut(sheet)?.validations;
        remove_ranges(list, &dv.ranges);
        list.push(dv);
        Ok(())
    }

    /// Removes the validation of every cell of `range` (Excel's "Clear
    /// All"). Returns whether anything changed.
    pub fn remove_validation(&mut self, range: CellRange) -> Result<bool, Error> {
        let cut = CellRect {
            r0: range.r0,
            c0: range.c0,
            r1: range.r1,
            c1: range.c1,
        };
        let list = &mut self.sheet_data_mut(range.sheet)?.validations;
        let before = list.clone();
        remove_ranges(list, &[cut]);
        Ok(*list != before)
    }

    /// The validation of cell `c` with its index.
    pub fn validation_at(&self, c: CellCoord) -> Option<(usize, &DataValidation)> {
        self.validations(c.sheet)
            .iter()
            .enumerate()
            .find(|(_, dv)| dv.contains(c.row, c.col))
    }

    /// The validations intersecting `range` with their indices.
    pub fn validations_in(&self, range: CellRange) -> Vec<(usize, &DataValidation)> {
        let view = CellRect {
            r0: range.r0,
            c0: range.c0,
            r1: range.r1,
            c1: range.c1,
        };
        self.validations(range.sheet)
            .iter()
            .enumerate()
            .filter(|(_, dv)| {
                dv.ranges
                    .iter()
                    .any(|r| rect_intersection(r, &view).is_some())
            })
            .collect()
    }

    /// Checks `input` (as typed: `=` formulas are evaluated, `'` forces
    /// text) against the validation of `c`. A cell without validation, a
    /// validation without error alert and `Any` always pass; an input the
    /// engine cannot parse passes too (setting it reports the error).
    pub fn validate_input(&self, c: CellCoord, input: &str) -> Result<ValidationResult, Error> {
        if self.engine().sheet_name(c.sheet).is_none() {
            return Err(Error::UnknownSheet(c.sheet));
        }
        let Some((index, dv)) = self.validation_at(c) else {
            return Ok(ValidationResult {
                ok: true,
                ..Default::default()
            });
        };
        let pass = ValidationResult {
            ok: true,
            rule: Some(index as u32),
            ..Default::default()
        };
        if !dv.show_error || dv.kind == ValidationKind::Any {
            return Ok(pass);
        }
        let Ok(content) = parse_input(input) else {
            return Ok(pass);
        };
        let engine = self.engine();
        let value = match content {
            CellContent::Empty => Value::Empty,
            CellContent::Value(v) => v,
            // Not produced by input parsing; a computed value like a formula.
            CellContent::Spilled { .. } => engine.value(c).into_scalar(),
            CellContent::Formula { ast, .. } => {
                let ctx = engine.eval_context(engine as &dyn CellProvider, c);
                evaluate(&ast, &ctx).into_scalar()
            }
        };
        let ok = if matches!(value, Value::Empty) {
            dv.allow_blank
        } else {
            self.passes(dv, c, value)
        };
        Ok(if ok {
            pass
        } else {
            ValidationResult {
                ok: false,
                rule: Some(index as u32),
                error_style: Some(dv.error_style),
                title: dv.error_title.clone(),
                message: Some(
                    dv.error_message
                        .clone()
                        .unwrap_or_else(|| DEFAULT_ERROR_MESSAGE.to_owned()),
                ),
            }
        })
    }

    fn passes(&self, dv: &DataValidation, c: CellCoord, value: Value) -> bool {
        let Some((ar, ac)) = anchor(&dv.ranges) else {
            return true;
        };
        let overlay = Overlay {
            engine: self.engine(),
            at: c,
            value: value.clone(),
        };
        let ctx = self.engine().eval_context(&overlay, c);
        let (dr, dc) = (
            i64::from(c.row) - i64::from(ar),
            i64::from(c.col) - i64::from(ac),
        );
        let eval = |text: &str| -> Option<Value> {
            let ast = parse_formula(text).ok()?;
            Some(evaluate(&offset_relative(&ast, dr, dc), &ctx).into_scalar())
        };
        if let ValidationKind::Custom { formula } = &dv.kind {
            return eval(formula).is_some_and(|v| truthy(&v));
        }
        if let ValidationKind::List { .. } = &dv.kind {
            return self
                .list_items(dv, c)
                .iter()
                .any(|item| compare(&value, item) == Ok(std::cmp::Ordering::Equal));
        }
        let Some((op, f1, f2)) = dv.kind.comparison() else {
            return true;
        };
        let subject = match &dv.kind {
            ValidationKind::TextLength { .. } => match to_text(&value) {
                Ok(t) => t.chars().count() as f64,
                Err(_) => return false,
            },
            _ => match value {
                Value::Number(n) => n,
                _ => return false,
            },
        };
        if matches!(dv.kind, ValidationKind::Whole { .. }) && subject.fract() != 0.0 {
            return false;
        }
        let bound = |f: &String| eval(f).and_then(|v| to_number(&v).ok()).map(Value::Number);
        let Some(a) = bound(f1) else { return false };
        let b = match f2 {
            Some(f) => match bound(f) {
                Some(b) => Some(b),
                None => return false,
            },
            None => None,
        };
        op.test(&Value::Number(subject), &a, b.as_ref())
    }

    /// Excel's Data › Data Validation › Circle Invalid Data: the cells of
    /// `sheet` whose current values fail their validation (whatever its
    /// error alert setting), row-major, at most `limit` (Excel circles 255).
    /// Blank cells are never circled.
    pub fn invalid_cells(&self, sheet: SheetId, limit: usize) -> Vec<CellCoord> {
        let Some((mr, mc)) = self.used_range(sheet) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for dv in self.validations(sheet) {
            if dv.kind == ValidationKind::Any {
                continue;
            }
            for r in &dv.ranges {
                for row in r.r0..=r.r1.min(mr) {
                    for col in r.c0..=r.c1.min(mc) {
                        let c = CellCoord::new(sheet, row, col);
                        let v = self.value(c).into_scalar();
                        if !matches!(v, Value::Empty) && !self.passes(dv, c, v) {
                            out.push(c);
                        }
                    }
                }
            }
        }
        out.sort_by_key(|c| (c.row, c.col));
        out.dedup();
        out.truncate(limit);
        out
    }

    /// The values of a list validation for cell `c` with the cells they
    /// come from (`None` for literals and computed arrays).
    fn list_entries(&self, dv: &DataValidation, c: CellCoord) -> Vec<(Value, Option<CellCoord>)> {
        let ValidationKind::List { source } = &dv.kind else {
            return Vec::new();
        };
        let formula = match source {
            ListSource::Literal { values } => {
                return values
                    .iter()
                    .map(|v| {
                        let value = match parse_input(v) {
                            Ok(CellContent::Value(x)) => x,
                            _ => Value::Text(v.clone()),
                        };
                        (value, None)
                    })
                    .collect();
            }
            ListSource::Formula { formula } => formula,
        };
        let (Some((ar, ac)), Ok(ast)) = (anchor(&dv.ranges), parse_formula(formula)) else {
            return Vec::new();
        };
        let ast = offset_relative(
            &ast,
            i64::from(c.row) - i64::from(ar),
            i64::from(c.col) - i64::from(ac),
        );
        let engine = self.engine();
        let ctx = engine.eval_context(engine as &dyn CellProvider, c);
        match eval_operand(&ast, &ctx) {
            Operand::Range(r) => {
                let Some((mr, mc)) = self.used_range(r.sheet) else {
                    return Vec::new();
                };
                let mut out = Vec::new();
                for row in r.r0..=r.r1.min(mr) {
                    for col in r.c0..=r.c1.min(mc) {
                        let at = CellCoord::new(r.sheet, row, col);
                        let v = self.value(at);
                        if !matches!(v, Value::Empty) {
                            out.push((v, Some(at)));
                        }
                    }
                }
                out
            }
            Operand::Scalar(Value::Array(a)) => a
                .values()
                .iter()
                .filter(|v| !matches!(v, Value::Empty))
                .map(|v| (v.clone(), None))
                .collect(),
            Operand::Scalar(Value::Empty) => Vec::new(),
            Operand::Scalar(v) => vec![(v, None)],
        }
    }

    fn list_items(&self, dv: &DataValidation, c: CellCoord) -> Vec<Value> {
        self.list_entries(dv, c)
            .into_iter()
            .map(|(v, _)| v)
            .collect()
    }

    /// The dropdown values of cell `c`'s list validation, as displayed
    /// (cells of a source range with their number format; blank cells are
    /// left out). Empty when `c` has no list validation.
    pub fn list_values(&self, c: CellCoord) -> Vec<String> {
        let Some((_, dv)) = self.validation_at(c) else {
            return Vec::new();
        };
        self.list_entries(dv, c)
            .into_iter()
            .map(|(v, at)| match (at, &v) {
                (Some(at), _) => self.display_text(at),
                (None, Value::Number(n)) => format_general(*n),
                (None, v) => to_text(v).unwrap_or_else(|e| e.to_string()),
            })
            .collect()
    }
}

/// Removes `cut` from every validation of `list` (re-anchoring formulas);
/// validations left without cells disappear.
fn remove_ranges(list: &mut Vec<DataValidation>, cut: &[CellRect]) {
    let mut changed = false;
    list.retain_mut(|dv| {
        cut.iter().all(|r| {
            let (ranges, formulas) = dv.parts_mut();
            subtract_ranges(ranges, formulas, r, &mut changed)
        })
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::RangeRef;

    fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
        CellRect { r0, c0, r1, c1 }
    }

    fn setup() -> (Workbook, SheetId) {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for (r, v) in ["Red", "Green", "", "Blue"].iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, 4), v).unwrap();
        }
        (wb, s)
    }

    fn ok(wb: &Workbook, c: CellCoord, input: &str) -> bool {
        wb.validate_input(c, input).unwrap().ok
    }

    #[test]
    fn lists_from_ranges_and_literals() {
        let (mut wb, s) = setup();
        let list = |source| ValidationKind::List { source };
        wb.set_validation(
            s,
            DataValidation::new(
                vec![rect(0, 0, 9, 0)],
                list(ListSource::Formula {
                    formula: "=$E$1:$E$4".into(),
                }),
            ),
        )
        .unwrap();
        let a2 = CellCoord::new(s, 1, 0);
        assert_eq!(wb.list_values(a2), ["Red", "Green", "Blue"]);
        assert!(ok(&wb, a2, "green"));
        assert!(!ok(&wb, a2, "Yellow"));
        assert!(ok(&wb, a2, ""));
        let r = wb.validate_input(a2, "Yellow").unwrap();
        assert_eq!(r.rule, Some(0));
        assert_eq!(r.error_style, Some(ErrorStyle::Stop));
        assert_eq!(r.message.as_deref(), Some(DEFAULT_ERROR_MESSAGE));
        // Cells without validation pass.
        assert!(ok(&wb, CellCoord::new(s, 0, 1), "anything"));
        assert!(wb.list_values(CellCoord::new(s, 0, 1)).is_empty());

        // A literal list on part of the range replaces it there.
        let mut dv = DataValidation::new(
            vec![rect(0, 0, 1, 0)],
            list(ListSource::Literal {
                values: vec!["1".into(), "two".into()],
            }),
        );
        dv.allow_blank = false;
        dv.error_style = ErrorStyle::Warning;
        dv.error_message = Some("Pick one".into());
        wb.set_validation(s, dv).unwrap();
        assert_eq!(wb.validations(s).len(), 2);
        assert_eq!(wb.validations(s)[0].ranges, vec![rect(2, 0, 9, 0)]);
        // The source formula is absolute: re-anchoring keeps it.
        assert_eq!(
            wb.validations(s)[0].kind,
            list(ListSource::Formula {
                formula: "$E$1:$E$4".into()
            })
        );
        assert_eq!(wb.list_values(a2), ["1", "two"]);
        assert!(ok(&wb, a2, "1") && ok(&wb, a2, "TWO") && ok(&wb, a2, "=0+1"));
        let r = wb.validate_input(a2, "").unwrap();
        assert!(!r.ok);
        assert_eq!(r.error_style, Some(ErrorStyle::Warning));
        assert_eq!(r.message.as_deref(), Some("Pick one"));
        assert_eq!(
            wb.validation_at(CellCoord::new(s, 5, 0)).map(|(i, _)| i),
            Some(0)
        );
        assert_eq!(wb.validations_in(RangeRef::new(s, 0, 0, 0, 0)).len(), 1);

        // Clearing removes cells; structural edits move ranges.
        assert!(wb.remove_validation(RangeRef::new(s, 0, 0, 2, 0)).unwrap());
        assert_eq!(wb.validations(s).len(), 1);
        assert!(!wb
            .remove_validation(RangeRef::new(s, 20, 0, 22, 0))
            .unwrap());
        wb.insert_rows(s, 0, 2).unwrap();
        assert_eq!(wb.validations(s)[0].ranges, vec![rect(5, 0, 11, 0)]);
        assert_eq!(
            wb.validations(s)[0].kind,
            list(ListSource::Formula {
                formula: "$E$3:$E$6".into()
            })
        );
        let snap = wb.to_snapshot();
        let back = Workbook::from_snapshot(&snap).unwrap();
        assert_eq!(back.validations(s), wb.validations(s));
    }

    #[test]
    fn numbers_dates_lengths_and_custom() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = CellCoord::new(s, 1, 1);
        let r = vec![rect(0, 1, 5, 1)];
        let mut set = |kind| {
            wb.set_validations(s, vec![DataValidation::new(r.clone(), kind)])
                .unwrap();
        };
        set(ValidationKind::Decimal {
            op: CompareOp::GreaterThan,
            f1: "0.5".into(),
            f2: None,
        });
        drop(set);
        assert!(ok(&wb, c, "0.75"));
        assert!(!ok(&wb, c, "0.25"));
        assert!(!ok(&wb, c, "abc"));
        assert!(ok(&wb, c, "=1/2+1"));

        wb.set_validations(
            s,
            vec![DataValidation::new(
                r.clone(),
                ValidationKind::TextLength {
                    op: CompareOp::LessThanOrEqual,
                    f1: "3".into(),
                    f2: None,
                },
            )],
        )
        .unwrap();
        assert!(ok(&wb, c, "abc") && ok(&wb, c, "123"));
        assert!(!ok(&wb, c, "abcd"));

        // Custom: no duplicates in the column (refers to the new value).
        wb.set_input(CellCoord::new(s, 0, 1), "x").unwrap();
        wb.set_validations(
            s,
            vec![DataValidation::new(
                r.clone(),
                ValidationKind::Custom {
                    formula: "COUNTIF($B$1:$B$6,B1)=1".into(),
                },
            )],
        )
        .unwrap();
        assert!(!ok(&wb, c, "x"));
        assert!(ok(&wb, c, "y"));

        // Dates with a relative bound in the next column.
        wb.set_input(CellCoord::new(s, 1, 2), "45000").unwrap();
        wb.set_validations(
            s,
            vec![DataValidation::new(
                r.clone(),
                ValidationKind::Date {
                    op: CompareOp::GreaterThanOrEqual,
                    f1: "C1".into(),
                    f2: None,
                },
            )],
        )
        .unwrap();
        assert!(ok(&wb, c, "45001"));
        assert!(!ok(&wb, c, "44999"));

        // No error alert: anything goes.
        let mut dv = DataValidation::new(
            r,
            ValidationKind::Whole {
                op: CompareOp::Between,
                f1: "1".into(),
                f2: Some("2".into()),
            },
        );
        dv.show_error = false;
        wb.set_validations(s, vec![dv.clone()]).unwrap();
        assert!(ok(&wb, c, "99"));
        // Arity is checked.
        dv.kind = ValidationKind::Whole {
            op: CompareOp::Between,
            f1: "1".into(),
            f2: None,
        };
        assert!(matches!(
            wb.set_validation(s, dv),
            Err(Error::InvalidRule(_))
        ));
        assert!(wb
            .validate_input(CellCoord::new(SheetId(9), 0, 0), "1")
            .is_err());
    }

    #[test]
    fn circle_invalid_data() {
        let (mut wb, s) = setup();
        for (r, v) in ["5", "50", "", "x", "7"].iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, 1), v).unwrap();
        }
        wb.set_validation(
            s,
            DataValidation {
                show_error: false,
                ..DataValidation::new(
                    vec![rect(0, 1, 9, 1)],
                    ValidationKind::Whole {
                        op: CompareOp::Between,
                        f1: "1".into(),
                        f2: Some("10".into()),
                    },
                )
            },
        )
        .unwrap();
        // The list in E: Red, Green, Blue; A1 holds "Purple".
        wb.set_input(CellCoord::new(s, 0, 0), "Purple").unwrap();
        wb.set_validation(
            s,
            DataValidation::new(
                vec![rect(0, 0, 0, 0)],
                ValidationKind::List {
                    source: ListSource::Formula {
                        formula: "$E$1:$E$4".into(),
                    },
                },
            ),
        )
        .unwrap();
        let bad: Vec<(u32, u32)> = wb
            .invalid_cells(s, 255)
            .into_iter()
            .map(|c| (c.row, c.col))
            .collect();
        assert_eq!(bad, [(0, 0), (1, 1), (3, 1)]);
        assert_eq!(wb.invalid_cells(s, 1).len(), 1);
        wb.set_input(CellCoord::new(s, 1, 1), "9").unwrap();
        assert_eq!(wb.invalid_cells(s, 255).len(), 2);
    }

    #[test]
    fn list_sources_on_other_sheets_names_and_tables() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let lists = wb.add_sheet("Lists").unwrap();
        for (r, v) in ["Apple", "Pear", "Plum"].iter().enumerate() {
            wb.set_input(CellCoord::new(lists, r as u32 + 1, 0), v)
                .unwrap();
        }
        wb.set_input(CellCoord::new(lists, 0, 0), "Fruit").unwrap();
        wb.define_name(&crate::DefinedName::new(
            "Fruits",
            crate::NameScope::Workbook,
            "Lists!$A$2:$A$4",
        ))
        .unwrap();
        let table = crate::Table::new(1, "Produce", 0, 0, 3, 0, &["Fruit".to_string()]);
        wb.set_tables(lists, vec![table]).unwrap();
        let at = CellCoord::new(s, 0, 0);
        for source in [
            "Lists!$A$2:$A$4",
            "Fruits",
            "Produce[Fruit]",
            "INDIRECT(\"Lists!A2:A4\")",
        ] {
            wb.set_validation(
                s,
                DataValidation::new(
                    vec![rect(0, 0, 0, 0)],
                    ValidationKind::List {
                        source: ListSource::Formula {
                            formula: source.into(),
                        },
                    },
                ),
            )
            .unwrap();
            assert_eq!(wb.list_values(at), ["Apple", "Pear", "Plum"], "{source}");
            assert!(ok(&wb, at, "pear"), "{source}");
            assert!(!ok(&wb, at, "Fig"), "{source}");
        }
    }

    #[test]
    fn custom_formulas_are_relative_to_the_top_left_cell() {
        // B2:B5 must be greater than the cell to its left.
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for r in 1..5 {
            wb.set_input(CellCoord::new(s, r, 0), &(r * 10).to_string())
                .unwrap();
        }
        wb.set_validation(
            s,
            DataValidation::new(
                vec![rect(1, 1, 4, 1)],
                ValidationKind::Custom {
                    formula: "B2>A2".into(),
                },
            ),
        )
        .unwrap();
        assert!(ok(&wb, CellCoord::new(s, 1, 1), "11"));
        assert!(!ok(&wb, CellCoord::new(s, 3, 1), "25"));
        assert!(ok(&wb, CellCoord::new(s, 3, 1), "41"));
        // Ignore blank off: an empty entry fails.
        let mut dv = wb.validations(s)[0].clone();
        dv.allow_blank = false;
        wb.set_validation(s, dv).unwrap();
        assert!(!ok(&wb, CellCoord::new(s, 3, 1), ""));
    }

    #[test]
    fn serde_shape() {
        let dv = DataValidation::new(
            vec![rect(0, 0, 0, 0)],
            ValidationKind::List {
                source: ListSource::Literal {
                    values: vec!["a".into()],
                },
            },
        );
        let json = serde_json::to_value(&dv).unwrap();
        assert_eq!(json["kind"]["type"], "list");
        assert_eq!(json["kind"]["source"]["type"], "literal");
        assert_eq!(json["errorStyle"], "stop");
        assert_eq!(serde_json::from_value::<DataValidation>(json).unwrap(), dv);
    }
}
