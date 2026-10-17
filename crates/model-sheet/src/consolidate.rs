//! Data › Consolidate (P9-C2): combines several source ranges into one
//! table with a summary function, by position or by the labels in the
//! sources' top row and/or left column (Excel's rules: labels match
//! ignoring case, the result lists them in order of first appearance,
//! the corner cell stays empty with both). "Create links to source
//! data" writes formulas (`=SUM(Q1!$B$2,Q2!$B$2)`) instead of values.
//!
//! [`Workbook::consolidate_plan`] only plans: it returns the cells to
//! write, which the document applies (and undoes) like any edit.

use engine_formula::value::format_general;
use engine_formula::{CellCoord, Value};
use serde::{Deserialize, Serialize};

use crate::names::{abs_area, sheet_prefix};
use crate::workbook::Workbook;
use crate::{CellRange, Error};

/// The summary functions of the Consolidate dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsolidateFunction {
    Sum,
    /// Non-empty cells (Excel's Consolidate "Count").
    Count,
    Average,
    Max,
    Min,
    Product,
    /// Numbers only ("Count Numbers").
    CountNums,
    StdDev,
    StdDevP,
    Var,
    VarP,
}

impl ConsolidateFunction {
    /// The worksheet function of linked results.
    pub fn function_name(self) -> &'static str {
        match self {
            ConsolidateFunction::Sum => "SUM",
            ConsolidateFunction::Count => "COUNTA",
            ConsolidateFunction::Average => "AVERAGE",
            ConsolidateFunction::Max => "MAX",
            ConsolidateFunction::Min => "MIN",
            ConsolidateFunction::Product => "PRODUCT",
            ConsolidateFunction::CountNums => "COUNT",
            ConsolidateFunction::StdDev => "STDEV",
            ConsolidateFunction::StdDevP => "STDEVP",
            ConsolidateFunction::Var => "VAR",
            ConsolidateFunction::VarP => "VARP",
        }
    }

    /// The result over the values of one cell position (`None`: empty
    /// result, as Excel leaves cells no source fills).
    pub fn apply(self, values: &[Value]) -> Option<Value> {
        if values.is_empty() {
            return None;
        }
        let nums: Vec<f64> = values
            .iter()
            .filter_map(|v| match v {
                Value::Number(n) => Some(*n),
                Value::Bool(b) => Some(f64::from(u8::from(*b))),
                _ => None,
            })
            .collect();
        let n = nums.len() as f64;
        let mean = || nums.iter().sum::<f64>() / n;
        let var = |pop: bool| {
            let m = mean();
            let ss: f64 = nums.iter().map(|x| (x - m) * (x - m)).sum();
            ss / if pop { n } else { n - 1.0 }
        };
        let err = || Value::Error(engine_formula::ErrorKind::Div0);
        Some(match self {
            ConsolidateFunction::Count => {
                Value::Number(values.iter().filter(|v| !matches!(v, Value::Empty)).count() as f64)
            }
            ConsolidateFunction::CountNums => Value::Number(n),
            _ if nums.is_empty() => match self {
                ConsolidateFunction::Sum | ConsolidateFunction::Product => Value::Number(0.0),
                ConsolidateFunction::Max | ConsolidateFunction::Min => Value::Number(0.0),
                _ => err(),
            },
            ConsolidateFunction::Sum => Value::Number(nums.iter().sum()),
            ConsolidateFunction::Average => Value::Number(mean()),
            ConsolidateFunction::Max => {
                Value::Number(nums.iter().copied().fold(f64::MIN, f64::max))
            }
            ConsolidateFunction::Min => {
                Value::Number(nums.iter().copied().fold(f64::MAX, f64::min))
            }
            ConsolidateFunction::Product => Value::Number(nums.iter().product()),
            ConsolidateFunction::StdDev if n < 2.0 => err(),
            ConsolidateFunction::Var if n < 2.0 => err(),
            ConsolidateFunction::StdDev => Value::Number(var(false).sqrt()),
            ConsolidateFunction::StdDevP => Value::Number(var(true).sqrt()),
            ConsolidateFunction::Var => Value::Number(var(false)),
            ConsolidateFunction::VarP => Value::Number(var(true)),
        })
    }
}

/// What Consolidate does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidateSpec {
    pub function: ConsolidateFunction,
    pub sources: Vec<CellRange>,
    /// Use labels in the top row / left column.
    pub top_row: bool,
    pub left_col: bool,
    /// Formulas linking to the sources instead of values.
    pub links: bool,
}

fn fold(s: &str) -> String {
    s.chars().flat_map(char::to_lowercase).collect()
}

/// Index of `label` in `labels` (case-insensitive), appended when new.
fn slot(labels: &mut Vec<String>, label: &str) -> usize {
    let key = fold(label);
    match labels.iter().position(|l| fold(l) == key) {
        Some(i) => i,
        None => {
            labels.push(label.to_string());
            labels.len() - 1
        }
    }
}

fn input_of(v: &Value) -> String {
    match v {
        Value::Number(n) => format_general(*n),
        Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
        Value::Error(e) => e.to_string(),
        Value::Text(t) => format!("'{t}"),
        _ => String::new(),
    }
}

impl Workbook {
    /// The cells Consolidate writes at `dest` (top-left): `(row, col,
    /// input)` with `""` for cells it clears. Errors: no source, a source
    /// with only labels, links to the destination's own sheet (Excel:
    /// "Links cannot be created …").
    pub fn consolidate_plan(
        &self,
        spec: &ConsolidateSpec,
        dest: CellCoord,
    ) -> Result<Vec<(u32, u32, String)>, Error> {
        if spec.sources.is_empty() {
            return Err(Error::InvalidRange);
        }
        if spec.links && spec.sources.iter().any(|s| s.sheet == dest.sheet) {
            return Err(Error::InvalidRule(
                "links cannot be created when the source and destination are on the same sheet"
                    .into(),
            ));
        }
        let text = |c: CellCoord| match self.value(c) {
            Value::Empty => String::new(),
            _ => self.display_text(c),
        };
        let (dr, dc) = (u32::from(spec.top_row), u32::from(spec.left_col));
        let mut row_labels: Vec<String> = Vec::new();
        let mut col_labels: Vec<String> = Vec::new();
        // Per result position: (source cell, value) of every source.
        let mut cells: std::collections::BTreeMap<(usize, usize), Vec<(CellCoord, Value)>> =
            Default::default();
        let (mut rows, mut cols) = (0usize, 0usize);
        for src in &spec.sources {
            if src.r1 < src.r0 + dr || src.c1 < src.c0 + dc {
                return Err(Error::InvalidRange);
            }
            // The source clipped to its used part (whole columns etc.).
            let (used_r, used_c) = self.used_range(src.sheet).unwrap_or((src.r0, src.c0));
            let (r1, c1) = (
                src.r1.min(used_r.max(src.r0 + dr)),
                src.c1.min(used_c.max(src.c0 + dc)),
            );
            let col_slots: Vec<usize> = (src.c0 + dc..=c1)
                .map(|c| {
                    if spec.top_row {
                        slot(&mut col_labels, &text(CellCoord::new(src.sheet, src.r0, c)))
                    } else {
                        (c - src.c0 - dc) as usize
                    }
                })
                .collect();
            for r in src.r0 + dr..=r1 {
                let ri = if spec.left_col {
                    let label = text(CellCoord::new(src.sheet, r, src.c0));
                    if label.is_empty() {
                        continue;
                    }
                    slot(&mut row_labels, &label)
                } else {
                    (r - src.r0 - dr) as usize
                };
                rows = rows.max(ri + 1);
                for (k, c) in (src.c0 + dc..=c1).enumerate() {
                    let ci = col_slots[k];
                    cols = cols.max(ci + 1);
                    let at = CellCoord::new(src.sheet, r, c);
                    let v = self.value(at);
                    if !matches!(v, Value::Empty) {
                        cells.entry((ri, ci)).or_default().push((at, v));
                    }
                }
            }
        }
        if spec.top_row {
            cols = cols.max(col_labels.len());
        }
        if spec.left_col {
            rows = rows.max(row_labels.len());
        }
        let mut out = Vec::new();
        let (r0, c0) = (dest.row, dest.col);
        if spec.top_row {
            for (i, l) in col_labels.iter().enumerate() {
                out.push((r0, c0 + dc + i as u32, input_of(&Value::Text(l.clone()))));
            }
            if spec.left_col {
                out.push((r0, c0, String::new()));
            }
        }
        if spec.left_col {
            for (i, l) in row_labels.iter().enumerate() {
                out.push((r0 + dr + i as u32, c0, input_of(&Value::Text(l.clone()))));
            }
        }
        let name_of = |s: engine_formula::SheetId| {
            sheet_prefix(self.engine().sheet_name(s).unwrap_or_default())
        };
        for ri in 0..rows {
            for ci in 0..cols {
                let (r, c) = (r0 + dr + ri as u32, c0 + dc + ci as u32);
                let found = cells.get(&(ri, ci));
                let input = match found {
                    None => String::new(),
                    Some(list) if spec.links => {
                        let refs: Vec<String> = list
                            .iter()
                            .map(|(at, _)| {
                                format!(
                                    "{}{}",
                                    name_of(at.sheet),
                                    abs_area(at.row, at.col, at.row, at.col)
                                )
                            })
                            .collect();
                        format!("={}({})", spec.function.function_name(), refs.join(","))
                    }
                    Some(list) => {
                        let values: Vec<Value> = list.iter().map(|(_, v)| v.clone()).collect();
                        spec.function
                            .apply(&values)
                            .map(|v| input_of(&v))
                            .unwrap_or_default()
                    }
                };
                out.push((r, c, input));
            }
        }
        if out
            .iter()
            .any(|(r, c, _)| *r > engine_formula::ast::MAX_ROW || *c > engine_formula::ast::MAX_COL)
        {
            return Err(Error::InvalidRange);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::SheetId;

    fn book() -> Workbook {
        let mut wb = Workbook::new();
        let q1 = SheetId(0);
        wb.rename_sheet(q1, "Q1").unwrap();
        let q2 = wb.add_sheet("Q2").unwrap();
        wb.add_sheet("Total").unwrap();
        let put = |wb: &mut Workbook, s, rows: &[&[&str]]| {
            for (r, row) in rows.iter().enumerate() {
                for (c, v) in row.iter().enumerate() {
                    if !v.is_empty() {
                        wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                            .unwrap();
                    }
                }
            }
        };
        put(
            &mut wb,
            q1,
            &[
                &["", "Units", "Price"],
                &["Pen", "4", "2"],
                &["Ink", "2", "8"],
            ],
        );
        put(
            &mut wb,
            q2,
            &[
                &["", "Price", "Units"],
                &["ink", "10", "1"],
                &["Pad", "1", "5"],
                &["Pen", "3", "6"],
            ],
        );
        wb
    }

    fn src(s: u32, r1: u32) -> CellRange {
        CellRange::new(SheetId(s), 0, 0, r1, 2)
    }

    fn grid(plan: &[(u32, u32, String)]) -> Vec<Vec<String>> {
        let rows = plan.iter().map(|p| p.0).max().unwrap() + 1;
        let cols = plan.iter().map(|p| p.1).max().unwrap() + 1;
        let mut g = vec![vec![String::new(); cols as usize]; rows as usize];
        for (r, c, v) in plan {
            g[*r as usize][*c as usize].clone_from(v);
        }
        g
    }

    #[test]
    fn by_labels_in_top_row_and_left_column() {
        let wb = book();
        let spec = ConsolidateSpec {
            function: ConsolidateFunction::Sum,
            sources: vec![src(0, 2), src(1, 3)],
            top_row: true,
            left_col: true,
            links: false,
        };
        let plan = wb
            .consolidate_plan(&spec, CellCoord::new(SheetId(2), 0, 0))
            .unwrap();
        assert_eq!(
            grid(&plan),
            [
                ["", "'Units", "'Price"],
                ["'Pen", "10", "5"],
                ["'Ink", "3", "18"],
                ["'Pad", "5", "1"],
            ]
        );
    }

    #[test]
    fn by_position_and_other_functions() {
        let wb = book();
        let at = CellCoord::new(SheetId(2), 1, 1);
        let spec = |function| ConsolidateSpec {
            function,
            sources: vec![
                CellRange::new(SheetId(0), 1, 1, 2, 2),
                CellRange::new(SheetId(1), 1, 1, 3, 2),
            ],
            top_row: false,
            left_col: false,
            links: false,
        };
        let plan = wb
            .consolidate_plan(&spec(ConsolidateFunction::Sum), at)
            .unwrap();
        assert_eq!(
            &grid(&plan)[1..],
            [["", "14", "3"], ["", "3", "13"], ["", "3", "6"]]
        );
        let plan = wb
            .consolidate_plan(&spec(ConsolidateFunction::Average), at)
            .unwrap();
        assert_eq!(grid(&plan)[1][1..], ["7", "1.5"]);
        let plan = wb
            .consolidate_plan(&spec(ConsolidateFunction::Count), at)
            .unwrap();
        assert_eq!(grid(&plan)[3][1..], ["1", "1"]);
        let plan = wb
            .consolidate_plan(&spec(ConsolidateFunction::Max), at)
            .unwrap();
        assert_eq!(grid(&plan)[2][1..], ["2", "8"]);
        let plan = wb
            .consolidate_plan(&spec(ConsolidateFunction::StdDev), at)
            .unwrap();
        assert_eq!(grid(&plan)[3][1], "#DIV/0!");
    }

    #[test]
    fn links_write_formulas_on_another_sheet_only() {
        let wb = book();
        let spec = ConsolidateSpec {
            function: ConsolidateFunction::Sum,
            sources: vec![src(0, 2), src(1, 3)],
            top_row: true,
            left_col: true,
            links: true,
        };
        let plan = wb
            .consolidate_plan(&spec, CellCoord::new(SheetId(2), 0, 0))
            .unwrap();
        let g = grid(&plan);
        assert_eq!(g[1][1], "=SUM('Q1'!$B$2,'Q2'!$C$4)");
        assert_eq!(g[3][2], "=SUM('Q2'!$B$3)");
        assert!(wb
            .consolidate_plan(&spec, CellCoord::new(SheetId(0), 9, 0))
            .is_err());
    }

    #[test]
    fn functions_follow_excel() {
        use ConsolidateFunction as F;
        let v = [
            Value::Number(2.0),
            Value::Number(4.0),
            Value::Text("x".into()),
        ];
        assert_eq!(F::Sum.apply(&v), Some(Value::Number(6.0)));
        assert_eq!(F::Count.apply(&v), Some(Value::Number(3.0)));
        assert_eq!(F::CountNums.apply(&v), Some(Value::Number(2.0)));
        assert_eq!(F::Product.apply(&v), Some(Value::Number(8.0)));
        assert_eq!(F::VarP.apply(&v), Some(Value::Number(1.0)));
        assert_eq!(F::Var.apply(&v), Some(Value::Number(2.0)));
        assert_eq!(F::StdDevP.apply(&v), Some(Value::Number(1.0)));
        assert_eq!(F::Min.apply(&v), Some(Value::Number(2.0)));
        assert_eq!(F::Sum.apply(&[]), None);
        assert_eq!(F::Count.function_name(), "COUNTA");
    }
}
