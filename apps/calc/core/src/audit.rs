//! Formula Auditing (P9-C4): Excel's background error checking rules,
//! Evaluate Formula's steps and the Watch Window's values.

use engine_formula::ast::{BinaryOp, Expr, UnaryOp};
use engine_formula::{evaluate_formula, CellContent, CellCoord, Operand, Value};
use model_sheet::SheetId;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{CalcCommand, Rect};
use crate::display::display_value;
use crate::doc::{CalcApplied, CalcDocument, Result};

/// An error checking rule (File › Options › Formulas › Error checking rules).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum ErrorRule {
    /// Cells containing formulas that result in an error.
    ErrorValue,
    /// Formulas inconsistent with other formulas in the region.
    InconsistentFormula,
    /// Numbers formatted as text or preceded by an apostrophe.
    NumberAsText,
    /// Formulas referring to empty cells (off by default in Excel).
    EmptyCellRefs,
    /// Unlocked cells containing formulas.
    UnlockedFormula,
}

/// Excel's default rule set (every rule but "formulas referring to empty
/// cells").
pub const DEFAULT_RULES: [ErrorRule; 4] = [
    ErrorRule::ErrorValue,
    ErrorRule::InconsistentFormula,
    ErrorRule::NumberAsText,
    ErrorRule::UnlockedFormula,
];

/// A cell an error checking rule flags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct ErrorIssue {
    pub row: u32,
    pub col: u32,
    pub rule: ErrorRule,
    /// Inconsistent formula: the formula its neighbours suggest
    /// (`=SUM(B1:B3)` for `Copy Formula from Above`); absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub suggestion: Option<String>,
}

/// One step of Evaluate Formula: the formula as far as evaluated, the
/// part evaluated next (underlined) and its value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct EvalStep {
    /// The formula with the parts evaluated so far replaced by their
    /// values (leading `=`).
    pub text: String,
    /// UTF-16 offsets `[start, end)` of the part evaluated next.
    pub start: u32,
    pub end: u32,
    /// Its value as Evaluate Formula shows it (`"text"`, `{1,2}`, `TRUE`).
    pub value: String,
    /// A reference to one cell holding a formula: Step In shows that
    /// cell's evaluation. Absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub step_in: Option<crate::command::SheetRect>,
}

/// Evaluate Formula of one cell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Evaluation {
    /// The formula (`=…`); empty when the cell holds no formula.
    pub formula: String,
    pub steps: Vec<EvalStep>,
    /// The result as the last step shows it.
    pub result: String,
}

/// A watched cell (Watch Window).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct WatchCell {
    pub sheet: u32,
    pub row: u32,
    pub col: u32,
}

/// A Watch Window row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct WatchItem {
    pub sheet: u32,
    pub row: u32,
    pub col: u32,
    /// The sheet's name (absent: the sheet was deleted).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sheet_name: Option<String>,
    /// A defined name referring to exactly this cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    pub value: String,
    /// The formula (`=…`), absent for constants.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub formula: Option<String>,
}

/// Evaluate Formula's text of a value.
fn value_text(v: &Value) -> String {
    match v {
        Value::Text(t) => format!("\"{}\"", t.replace('"', "\"\"")),
        Value::Empty => "0".into(),
        Value::Array(a) => {
            let mut out = String::from("{");
            for r in 0..a.rows() {
                if r > 0 {
                    out.push(';');
                }
                for c in 0..a.cols() {
                    if c > 0 {
                        out.push(',');
                    }
                    out.push_str(&value_text(a.get(r, c).unwrap_or(&Value::Empty)));
                }
            }
            out.push('}');
            out
        }
        v => display_value(v, None),
    }
}

/// A value as a literal expression (Evaluate Formula substitutes it).
fn value_expr(v: &Value) -> Expr {
    match v {
        Value::Number(n) => Expr::Number(*n),
        Value::Text(t) => Expr::Text(t.clone()),
        Value::Bool(b) => Expr::Bool(*b),
        Value::Error(e) => Expr::Error(*e),
        Value::Empty => Expr::Number(0.0),
        Value::Array(a) => Expr::Array(
            (0..a.rows())
                .map(|r| {
                    (0..a.cols())
                        .map(|c| match a.get(r, c) {
                            Some(Value::Array(_)) | None => Expr::Number(0.0),
                            Some(x) => value_expr(x),
                        })
                        .collect()
                })
                .collect(),
        ),
    }
}

/// The children of a node in evaluation order (`None`: a node evaluated
/// as a whole, its children are not separate steps).
fn children(e: &Expr) -> Vec<&Expr> {
    match e {
        // LET/LAMBDA bodies need their names: one step.
        Expr::Call { name, .. } if matches!(name.as_str(), "LET" | "LAMBDA") => Vec::new(),
        Expr::Call { args, .. } => args.iter().collect(),
        Expr::Unary { expr, .. } => vec![expr],
        Expr::Binary { lhs, rhs, .. } => vec![lhs, rhs],
        _ => Vec::new(),
    }
}

fn child_mut(e: &mut Expr, i: usize) -> &mut Expr {
    match e {
        Expr::Call { args, .. } => &mut args[i],
        Expr::Unary { expr, .. } => expr,
        Expr::Binary { lhs, rhs, .. } => {
            if i == 0 {
                lhs
            } else {
                rhs
            }
        }
        _ => unreachable!("leaf has no children"),
    }
}

fn node_mut<'a>(e: &'a mut Expr, path: &[usize]) -> &'a mut Expr {
    path.iter().fold(e, |e, &i| child_mut(e, i))
}

/// Whether a node is its own Evaluate Formula step under `parent`.
fn is_step(e: &Expr, parent: Option<&Expr>) -> bool {
    let reference = matches!(
        e,
        Expr::Reference(_) | Expr::Name(_) | Expr::QualifiedName { .. } | Expr::Structured(_)
    );
    match e {
        Expr::Number(_) | Expr::Text(_) | Expr::Bool(_) | Expr::Error(_) | Expr::Missing => false,
        Expr::Array(_) => false,
        _ if reference => match parent {
            // References inside functions and reference operators are read
            // by them (`SUM(A1:A3)` is one step).
            Some(Expr::Call { .. }) => false,
            Some(Expr::Binary { op, .. }) if op.is_reference_op() => false,
            Some(Expr::Unary {
                op: UnaryOp::SpillRange | UnaryOp::ImplicitIntersection,
                ..
            }) => false,
            _ => true,
        },
        Expr::Binary { op, .. } if *op == BinaryOp::Range => {
            !matches!(parent, Some(Expr::Call { .. }) | Some(Expr::Binary { .. }))
        }
        _ => true,
    }
}

fn collect_steps(
    e: &Expr,
    parent: Option<&Expr>,
    path: &mut Vec<usize>,
    out: &mut Vec<(Vec<usize>, Expr)>,
) {
    for (i, c) in children(e).into_iter().enumerate() {
        path.push(i);
        collect_steps(c, Some(e), path, out);
        path.pop();
    }
    if is_step(e, parent) {
        out.push((path.clone(), e.clone()));
    }
}

/// UTF-16 length of a string.
fn u16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

const PLACEHOLDER: &str = "\u{1}\u{2}";

impl CalcDocument {
    /// Background error checking of `sheet` with the given rules: the
    /// flagged cells in row-major order.
    pub fn error_checks(&self, sheet: u32, rules: &[ErrorRule]) -> Result<Vec<ErrorIssue>> {
        let s = self.sheet(sheet)?;
        let wb = self.workbook();
        let engine = wb.engine();
        let on = |r: ErrorRule| rules.contains(&r);
        let mut cells: Vec<(CellCoord, &CellContent)> = engine.cells(s).collect();
        cells.sort_by_key(|(c, _)| (c.row, c.col));
        let r1c1 = |c: CellCoord| match engine.content(c) {
            CellContent::Formula { ast, .. } => Some(ast.to_r1c1(c.row, c.col)),
            _ => None,
        };
        let mut out = Vec::new();
        for (c, content) in cells {
            let mut push = |rule: ErrorRule, suggestion: Option<String>| {
                out.push(ErrorIssue {
                    row: c.row,
                    col: c.col,
                    rule,
                    suggestion,
                })
            };
            match content {
                CellContent::Formula { ast, .. } => {
                    if on(ErrorRule::ErrorValue) && wb.value(c).is_error() {
                        push(ErrorRule::ErrorValue, None);
                        continue;
                    }
                    if on(ErrorRule::InconsistentFormula) {
                        let mine = ast.to_r1c1(c.row, c.col);
                        let near = |dr: i64, dc: i64| {
                            let row = u32::try_from(i64::from(c.row) + dr).ok()?;
                            let col = u32::try_from(i64::from(c.col) + dc).ok()?;
                            r1c1(CellCoord::new(s, row, col))
                        };
                        let pairs = [((-1, 0), (1, 0)), ((0, -1), (0, 1))];
                        let hit = pairs.iter().find_map(|&((a, b), (x, y))| {
                            let (p, q) = (near(a, b)?, near(x, y)?);
                            (p == q && p != mine).then_some(p)
                        });
                        if let Some(pattern) = hit {
                            let suggestion = engine_formula::r1c1::parse_r1c1(
                                &format!("={pattern}"),
                                c.row,
                                c.col,
                            )
                            .ok()
                            .map(|e| format!("={e}"));
                            push(ErrorRule::InconsistentFormula, suggestion);
                            continue;
                        }
                    }
                    if on(ErrorRule::UnlockedFormula)
                        && wb.style(c).protection.locked == Some(false)
                    {
                        push(ErrorRule::UnlockedFormula, None);
                        continue;
                    }
                    if on(ErrorRule::EmptyCellRefs) {
                        let empty = ast.references().iter().any(|r| {
                            let engine_formula::ast::RangeKind::Cell(cell) = r.kind else {
                                return false;
                            };
                            let target = match &r.sheet {
                                None => Some(s),
                                Some(n) if !r.is_3d() => engine.sheet_id(n),
                                Some(_) => None,
                            };
                            target.is_some_and(|t| {
                                matches!(
                                    engine.content(CellCoord::new(t, cell.row, cell.col)),
                                    CellContent::Empty
                                )
                            })
                        });
                        if empty {
                            push(ErrorRule::EmptyCellRefs, None);
                        }
                    }
                }
                CellContent::Value(Value::Text(t))
                    if on(ErrorRule::NumberAsText) && number_in_text(t).is_some() =>
                {
                    push(ErrorRule::NumberAsText, None);
                }
                _ => {}
            }
        }
        Ok(out)
    }

    /// The Watch Window's rows.
    pub fn watch_cells(&self, cells: &[WatchCell]) -> Vec<WatchItem> {
        let wb = self.workbook();
        let engine = wb.engine();
        cells
            .iter()
            .map(|w| {
                let id = SheetId(w.sheet);
                let sheet_name = engine.sheet_name(id).map(str::to_string);
                if sheet_name.is_none() {
                    return WatchItem {
                        sheet: w.sheet,
                        row: w.row,
                        col: w.col,
                        sheet_name,
                        name: None,
                        value: "#REF!".into(),
                        formula: None,
                    };
                }
                let c = CellCoord::new(id, w.row, w.col);
                let value = display_value(&wb.value(c), wb.style(c).number_format.as_deref());
                let name = self.name_infos().into_iter().find_map(|n| {
                    let r = n.range?;
                    (r.sheet == w.sheet && (r.r0, r.c0, r.r1, r.c1) == (w.row, w.col, w.row, w.col))
                        .then_some(n.def.name)
                });
                WatchItem {
                    sheet: w.sheet,
                    row: w.row,
                    col: w.col,
                    sheet_name,
                    name,
                    value,
                    formula: engine.formula_text(c).map(str::to_string),
                }
            })
            .collect()
    }

    /// Evaluate Formula of one cell: the steps in Excel's order (inner
    /// parts first; references read by a function belong to the
    /// function's step) and the result.
    pub fn evaluate_steps(&self, sheet: u32, row: u32, col: u32) -> Result<Evaluation> {
        let s = self.sheet(sheet)?;
        let wb = self.workbook();
        let engine = wb.engine();
        let at = CellCoord::new(s, row, col);
        let CellContent::Formula { ast, .. } = engine.content(at) else {
            return Ok(Evaluation {
                formula: String::new(),
                steps: Vec::new(),
                result: value_text(&wb.value(at)),
            });
        };
        let ctx = engine.eval_context(engine, at);
        let mut order = Vec::new();
        collect_steps(ast, None, &mut Vec::new(), &mut order);
        let mut tree = ast.clone();
        let mut steps = Vec::new();
        for (path, original) in order {
            let full = format!("={tree}");
            let node = node_mut(&mut tree, &path);
            let saved = std::mem::replace(node, Expr::Name(PLACEHOLDER.into()));
            let marked = format!("={tree}");
            let node = node_mut(&mut tree, &path);
            *node = saved;
            let Some(byte_at) = marked.find(PLACEHOLDER) else {
                continue;
            };
            let node_len = full.len() + PLACEHOLDER.len() - marked.len();
            let start = u16_len(&full[..byte_at]);
            let end = start + u16_len(&full[byte_at..byte_at + node_len]);
            let value = match engine_formula::eval::eval_array(&original, &ctx) {
                Operand::Range(r) if r.is_single_cell() => {
                    wb.value(CellCoord::new(r.sheet, r.r0, r.c0))
                }
                Operand::Range(r) => {
                    evaluate_formula(&Expr::Reference(range_ref_expr(engine, r)), &ctx)
                }
                Operand::Scalar(Value::Array(a)) if a.rows() * a.cols() == 1 => a.top_left(),
                Operand::Scalar(v) => v,
            };
            let step_in = match &original {
                Expr::Reference(r) if !r.is_3d() => {
                    let target = match &r.sheet {
                        None => Some(s),
                        Some(n) => engine.sheet_id(n),
                    };
                    match (target, r.kind) {
                        (Some(t), engine_formula::ast::RangeKind::Cell(cell)) => {
                            let c = CellCoord::new(t, cell.row, cell.col);
                            engine.formula_text(c).map(|_| crate::command::SheetRect {
                                sheet: t.0,
                                r0: c.row,
                                c0: c.col,
                                r1: c.row,
                                c1: c.col,
                            })
                        }
                        _ => None,
                    }
                }
                _ => None,
            };
            steps.push(EvalStep {
                text: full,
                start,
                end,
                value: value_text(&value),
                step_in,
            });
            *node_mut(&mut tree, &path) = value_expr(&value);
        }
        Ok(Evaluation {
            formula: format!("={ast}"),
            steps,
            result: value_text(&wb.value(at)),
        })
    }

    /// Error Checking's Convert to Number: text cells holding numbers
    /// become numbers (their number format is kept).
    pub(crate) fn convert_to_number(&mut self, sheet: u32, cells: &[Rect]) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let mut inverses = Vec::new();
        let mut edited = Vec::new();
        let mut changed = Vec::new();
        for r in cells {
            for row in r.r0..=r.r1 {
                for col in r.c0..=r.c1 {
                    let c = CellCoord::new(s, row, col);
                    let CellContent::Value(Value::Text(t)) = self.workbook().content(c).clone()
                    else {
                        continue;
                    };
                    let Some(n) = number_in_text(&t) else {
                        continue;
                    };
                    let recalc = self
                        .workbook_mut()
                        .engine_mut()
                        .set_content(c, CellContent::Value(Value::Number(n)))?;
                    changed.extend(recalc.changed);
                    edited.push(c);
                    inverses.push(CalcCommand::SetInput {
                        sheet,
                        row,
                        col,
                        input: format!("'{t}"),
                    });
                }
            }
        }
        let recalc = model_sheet::Recalc {
            changed,
            cycle: None,
        };
        Ok(app_common::Applied {
            patch: self.content_patch(edited, &recalc),
            inverse: Some(CalcCommand::Compound { commands: inverses }),
        })
    }
}

/// The number a text cell holds, as Excel's "Number Stored as Text"
/// sees it (surrounding spaces allowed).
fn number_in_text(t: &str) -> Option<f64> {
    let s = t.trim();
    if s.is_empty() {
        return None;
    }
    engine_formula::value::parse_number_text(s)
}

/// A range as an absolute reference expression on its sheet.
fn range_ref_expr(
    engine: &engine_formula::Engine,
    r: engine_formula::RangeRef,
) -> engine_formula::ast::Reference {
    use engine_formula::ast::{CellRef, RangeKind, Reference};
    let cell = |row, col| CellRef {
        col,
        row,
        col_abs: true,
        row_abs: true,
    };
    Reference::on(
        engine.sheet_name(r.sheet).map(str::to_string),
        RangeKind::area(cell(r.r0, r.c0), cell(r.r1, r.c1)),
    )
}
