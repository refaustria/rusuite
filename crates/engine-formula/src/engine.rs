//! The [`Engine`] façade: cell storage, dependency graph, function registry
//! and incremental recalculation in one object.
//!
//! ```
//! use engine_formula::{CellCoord, Engine, Value};
//!
//! let mut e = Engine::new();
//! let s = e.sheet_id("Sheet1").unwrap();
//! let a1 = CellCoord::new(s, 0, 0);
//! let a2 = CellCoord::new(s, 1, 0);
//! e.set_input(a1, "20").unwrap();
//! e.set_input(a2, "=A1*2+1").unwrap();
//! assert_eq!(e.value(a2), Value::Number(41.0));
//! let recalc = e.set_input(a1, "1").unwrap();
//! assert_eq!(recalc.changed, vec![a2]);
//! assert_eq!(e.value(a2), Value::Number(3.0));
//! ```
//!
//! # Storage
//!
//! Per sheet, contents live in a sparse `HashMap<(row, col), CellContent>`
//! and computed formula results in a second map of the same shape. The
//! value of a constant is the constant itself; a formula's value is read
//! from the result cache. Sheet ids are indices into the sheet list and
//! are never reused.
//!
//! The used range of a sheet (max row and max column of non-empty
//! content, formulas included) is maintained incrementally: growing is
//! O(1); clearing a cell that lies on the current bound rescans the sheet.
//!
//! # Recalculation
//!
//! Every `set_*` call updates the dependency graph and re-evaluates the
//! edited cell (if it holds a formula), every transitive dependent and
//! every volatile cell (formulas calling a function whose
//! `Function::is_volatile` is true, such as `NOW`, `TODAY`, `RAND`,
//! `INDIRECT`, `OFFSET`), in dependency order. [`Recalc::changed`] lists the re-evaluated formula cells whose
//! value actually changed; the edited cell itself appears there only when
//! it holds a formula (callers know that they changed a constant).
//! `INDIRECT` and `OFFSET` read cells the dependency graph does not know
//! about; after a pass in which cells changed behind the first volatile
//! cell, the volatile cells and their dependents are evaluated again (at
//! most three more times), so they see the recalculated values.
//!
//! # Dynamic arrays
//!
//! Formulas are evaluated with Excel 365 semantics
//! ([`evaluate_formula`]): a result of more than one cell *spills* into
//! the range anchored at the formula cell. The anchor's value is the
//! top-left element; the other cells of the range hold
//! [`CellContent::Spilled`] and the element as their value. When a target
//! cell is not empty (or the range leaves the sheet) nothing is written
//! and the anchor shows `#SPILL!`; it spills again once the obstacle is
//! cleared. Editing a spilled cell makes it an obstacle; clearing one is a
//! no-op. Formulas reading spilled cells depend on the anchor (see
//! [`DependencyGraph::set_spill`]); [`Recalc::changed`] lists spilled
//! cells whose value changed and cells whose spill was removed.
//! Row/column inserts and deletes drop every spill of the sheet and
//! re-evaluate the (moved) anchors, which spill again.
//!
//! Between [`Engine::begin_batch`] and [`Engine::end_batch`] edits only
//! update storage and the graph; the deferred recalculation runs once in
//! `end_batch`. Use it for bulk loads (or load, then [`Engine::recalc_all`]).
//!
//! # Circular references
//!
//! As Excel with iterative calculation off: every cell on a cycle gets
//! `0` and [`Recalc::cycle`] carries the cycle so the UI can warn
//! ([`Engine::cycle_through`] tells later whether it still exists). Cells
//! outside the cycle are still recalculated (dependents of a cycle see the
//! `0`).
//!
//! # Sheet names
//!
//! References are resolved by name at evaluation time and by [`SheetId`]
//! in the graph. [`Engine::rename_sheet`] rewrites the sheet name inside
//! the stored ASTs so formulas keep pointing at the renamed sheet; the
//! stored formula *text* is not rewritten yet. References to a sheet that
//! does not exist evaluate to `#REF!` and start working once a sheet of
//! that name is added (or another sheet is renamed to it).
//!
//! # Defined names
//!
//! [`Engine::set_name`] and friends keep a list of [`NameEntry`]s (a
//! name, a [`NameScope`], the definition). Formulas resolve an identifier
//! through [`CellProvider::defined_name`]: the formula's sheet's own name
//! first, then the workbook's (`Sheet1!Name` asks that sheet). For the
//! dependency graph and the volatility check a formula is registered with
//! its names expanded to their definitions, so cells read through a name
//! are edges; changing, adding or removing a name re-registers and
//! recalculates every formula that uses it (directly or through other
//! names). Definitions follow row/column inserts and deletes (a
//! sheet-level name's unqualified references follow its sheet) and sheet
//! renames; removing a sheet removes its own names and turns references
//! to it into `#REF!`; duplicating a sheet copies its names.
//!
//! # Sheet order and removal
//!
//! [`Engine::sheets`] lists the sheets in display order, which
//! [`Engine::move_sheet`] changes without touching ids.
//! [`Engine::remove_sheet`] deletes a sheet as Excel does: every reference
//! to it in the remaining formulas becomes `#REF!` (text and AST), so a
//! later sheet of the same name does not revive them. The removed id stays
//! reserved: [`Engine::add_sheet`] never hands it out again, and only
//! [`Engine::restore_sheet`] (undo) brings it back.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::ast::{is_valid_name, ErrorKind, Expr, MAX_COL, MAX_ROW};
use crate::eval::{
    default_now, evaluate_formula, name_definition_at, CellCoord, CellProvider, EvalContext,
    RangeRef, RowHidden, SheetId,
};
use crate::functions::FunctionRegistry;
use crate::graph::{Cycle, DependencyGraph, Precedent, SheetResolver};
use crate::parser::{parse, ParseError};
use crate::structured::{StructRef, TableDef};
use crate::transform::{adjust_references_shift, AdjustContext, CellShift, StructuralOp};
use crate::value::{parse_number_text, Value};

/// What a cell holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub enum CellContent {
    #[default]
    Empty,
    /// A constant: `Number`, `Text`, `Bool` or `Error` (never `Empty` or
    /// `Array`; [`Engine::set_content`] normalizes those).
    Value(Value),
    /// A formula as typed (`text`, including the leading `=`) and parsed.
    Formula { text: String, ast: Expr },
    /// Part of the spill range of the array formula in `anchor` (never the
    /// anchor itself). Written by the engine only: [`Engine::set_content`]
    /// treats it as `Empty`.
    Spilled { anchor: CellCoord },
}

/// The array result of a formula cell that has more than one cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Spill {
    /// Size of the array (and of the spill range when not blocked).
    pub rows: u32,
    pub cols: u32,
    /// The target range is not empty or leaves the sheet: nothing is
    /// spilled and the anchor shows `#SPILL!`.
    pub blocked: bool,
}

/// Follow-up passes for spill changes (a spill range that grew, cells a
/// spill freed) after the main recalculation pass.
const MAX_SPILL_PASSES: usize = 16;

/// Result of an edit or recalculation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Recalc {
    /// Re-evaluated formula cells whose value changed, plus spilled cells
    /// whose value changed and cells whose spill was removed; sorted.
    pub changed: Vec<CellCoord>,
    /// A circular reference among the re-evaluated cells, if any.
    pub cycle: Option<Cycle>,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EngineError {
    #[error("invalid formula: {0}")]
    Parse(#[from] ParseError),
    #[error("a sheet named `{0}` already exists")]
    DuplicateSheet(String),
    #[error("unknown sheet {0:?}")]
    UnknownSheet(SheetId),
    #[error("cell coordinate out of range")]
    InvalidCoord,
    #[error("a workbook needs at least one sheet")]
    LastSheet,
    #[error("sheet position {0} out of range")]
    InvalidSheetIndex(usize),
    /// Not a valid defined name (see [`is_valid_name`]).
    #[error("`{0}` is not a valid name")]
    InvalidName(String),
    /// A name of that spelling (any case) exists in the scope.
    #[error("a name `{0}` already exists in this scope")]
    DuplicateName(String),
    #[error("unknown name `{0}`")]
    UnknownName(String),
}

/// Where a defined name is visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum NameScope {
    Workbook,
    /// A sheet-level name: it wins over a workbook name of the same
    /// spelling on its sheet and is reached as `Sheet1!Name` elsewhere.
    Sheet(SheetId),
}

/// A defined name: a range (`Sheet1!$A$1:$B$5`), a constant (`0.19`) or a
/// formula (`OFFSET(...)`), evaluated where it is used.
#[derive(Debug, Clone, PartialEq)]
pub struct NameEntry {
    pub name: String,
    pub scope: NameScope,
    /// The definition without the leading `=` (regenerated from the AST
    /// when a structural edit or a sheet rename/delete rewrites it).
    pub formula: String,
    pub ast: Expr,
}

static EMPTY: CellContent = CellContent::Empty;

#[derive(Debug, Default)]
struct Sheet {
    name: String,
    cells: HashMap<(u32, u32), CellContent>,
    /// Computed values of formula cells.
    values: HashMap<(u32, u32), Value>,
    /// `(max_row, max_col)` of non-empty content.
    used: Option<(u32, u32)>,
    /// Deleted: empty, invisible to name lookups, id reserved.
    removed: bool,
    /// Hidden rows (absent = visible), for `SUBTOTAL`.
    hidden_rows: BTreeMap<u32, RowHidden>,
    /// Formula cells with an array result of more than one cell.
    arrays: HashMap<(u32, u32), Spill>,
}

impl Sheet {
    fn new(name: &str) -> Self {
        Sheet {
            name: name.to_string(),
            ..Sheet::default()
        }
    }

    fn grow_used(&mut self, row: u32, col: u32) {
        let (r, c) = self.used.unwrap_or((row, col));
        self.used = Some((r.max(row), c.max(col)));
    }

    fn shrink_used(&mut self, row: u32, col: u32) {
        if matches!(self.used, Some((r, c)) if r == row || c == col) {
            self.used = self.cells.keys().fold(None, |acc, &(r, c)| match acc {
                None => Some((r, c)),
                Some((mr, mc)) => Some((mr.max(r), mc.max(c))),
            });
        }
    }

    /// Whether a cell of the `rows × cols` range at `anchor` other than
    /// the anchor holds anything but `anchor`'s own spill.
    fn obstructed(&self, anchor: CellCoord, rows: u32, cols: u32) -> bool {
        let blocks = |pos: &(u32, u32), content: &CellContent| {
            *pos != (anchor.row, anchor.col)
                && !matches!(content, CellContent::Spilled { anchor: a } if *a == anchor)
        };
        let area = u64::from(rows) * u64::from(cols);
        if area <= self.cells.len() as u64 {
            (anchor.row..anchor.row + rows).any(|r| {
                (anchor.col..anchor.col + cols)
                    .any(|c| self.cells.get(&(r, c)).is_some_and(|x| blocks(&(r, c), x)))
            })
        } else {
            self.cells.iter().any(|(pos, content)| {
                (anchor.row..anchor.row + rows).contains(&pos.0)
                    && (anchor.col..anchor.col + cols).contains(&pos.1)
                    && blocks(pos, content)
            })
        }
    }

    /// Empties the cells spilled from `anchor` within its `rows × cols`
    /// range, except those inside the top-left `keep` (rows, cols).
    /// Returns the freed cells.
    fn free_spill(
        &mut self,
        anchor: CellCoord,
        rows: u32,
        cols: u32,
        keep: Option<(u32, u32)>,
    ) -> Vec<CellCoord> {
        let mut freed = Vec::new();
        for r in 0..rows {
            for c in 0..cols {
                if keep.is_some_and(|(kr, kc)| r < kr && c < kc) || (r, c) == (0, 0) {
                    continue;
                }
                let pos = (anchor.row + r, anchor.col + c);
                if matches!(self.cells.get(&pos), Some(CellContent::Spilled { anchor: a }) if *a == anchor)
                {
                    self.cells.remove(&pos);
                    self.values.remove(&pos);
                    freed.push(CellCoord::new(anchor.sheet, pos.0, pos.1));
                }
            }
        }
        if let Some((ur, uc)) = self.used {
            if freed.iter().any(|f| f.row == ur || f.col == uc) {
                self.shrink_used(ur, uc);
            }
        }
        freed
    }

    /// Blocked anchors whose array would cover one of `cells`.
    fn blocked_over(&self, cells: &[CellCoord]) -> Vec<CellCoord> {
        if cells.is_empty() {
            return Vec::new();
        }
        self.arrays
            .iter()
            .filter(|(_, s)| s.blocked)
            .filter(|(&(r, c), s)| {
                cells.iter().any(|x| {
                    (r..r.saturating_add(s.rows)).contains(&x.row)
                        && (c..c.saturating_add(s.cols)).contains(&x.col)
                })
            })
            .map(|(&(r, c), _)| CellCoord::new(cells[0].sheet, r, c))
            .collect()
    }
}

/// Case-insensitive (Unicode lowercase) sheet name comparison.
fn same_name(a: &str, b: &str) -> bool {
    a.chars()
        .flat_map(char::to_lowercase)
        .eq(b.chars().flat_map(char::to_lowercase))
}

fn find_sheet(sheets: &[Sheet], name: &str) -> Option<SheetId> {
    sheets
        .iter()
        .position(|s| !s.removed && same_name(&s.name, name))
        .map(|i| SheetId(i as u32))
}

/// Sheet-name resolver over the sheet list (borrowed separately from the
/// graph so both can be used at once).
struct Names<'a>(&'a [Sheet]);

impl SheetResolver for Names<'_> {
    fn sheet_id(&self, name: &str) -> Option<SheetId> {
        find_sheet(self.0, name)
    }
}

/// Whether `e` calls a function whose [`Function::reads_row_visibility`]
/// flag is set.
fn reads_row_visibility(e: &Expr, registry: &FunctionRegistry) -> bool {
    match e {
        Expr::Call { name, args } => {
            registry.get(name).is_some_and(|f| f.reads_row_visibility())
                || args.iter().any(|a| reads_row_visibility(a, registry))
        }
        Expr::Unary { expr, .. } => reads_row_visibility(expr, registry),
        Expr::Binary { lhs, rhs, .. } => {
            reads_row_visibility(lhs, registry) || reads_row_visibility(rhs, registry)
        }
        Expr::Array(rows) => rows
            .iter()
            .flatten()
            .any(|a| reads_row_visibility(a, registry)),
        _ => false,
    }
}

/// Whether `e` calls a function whose [`Function::is_volatile`] flag is
/// set (such as `NOW`, `RAND` or `INDIRECT`); those cells are re-evaluated
/// on every recalculation.
fn is_volatile(e: &Expr, registry: &FunctionRegistry) -> bool {
    match e {
        Expr::Call { name, args } => {
            registry.get(name).is_some_and(|f| f.is_volatile())
                || args.iter().any(|a| is_volatile(a, registry))
        }
        Expr::Unary { expr, .. } => is_volatile(expr, registry),
        Expr::Binary { lhs, rhs, .. } => is_volatile(lhs, registry) || is_volatile(rhs, registry),
        Expr::Array(rows) => rows.iter().flatten().any(|a| is_volatile(a, registry)),
        _ => false,
    }
}

/// Replaces the sheet prefix `from` (case-insensitive) by `to` in every
/// reference of `e`; returns whether anything changed.
fn rename_refs(e: &mut Expr, from: &str, to: &str) -> bool {
    match e {
        Expr::QualifiedName { sheet, .. } if same_name(sheet, from) => {
            *sheet = to.to_string();
            true
        }
        Expr::Reference(r) => {
            let mut hit = false;
            for s in [&mut r.sheet, &mut r.sheet_last].into_iter().flatten() {
                if same_name(s, from) {
                    *s = to.to_string();
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

/// Replaces every reference prefixed with sheet `name` (case-insensitive)
/// by `#REF!`; returns whether anything changed. A 3-D reference whose
/// span starts or ends at the sheet shrinks to the neighbouring sheet of
/// the span (`order`: the live sheet names in display order, the deleted
/// one included), as in Excel.
fn drop_sheet_refs(e: &mut Expr, name: &str, order: &[String]) -> bool {
    if let Expr::Reference(r) = e {
        if r.is_3d() {
            let first = r.sheet.clone().unwrap_or_default();
            let last = r.sheet_last.clone().unwrap_or_default();
            let pos = |n: &str| order.iter().position(|o| same_name(o, n));
            let (Some(a), Some(b)) = (pos(&first), pos(&last)) else {
                return false;
            };
            let (a, b) = (a.min(b), a.max(b));
            let span: Vec<&String> = order[a..=b]
                .iter()
                .filter(|n| !same_name(n, name))
                .collect();
            let ends_at = same_name(&first, name) || same_name(&last, name);
            if !ends_at {
                return false;
            }
            match span.as_slice() {
                [] => *e = Expr::Error(ErrorKind::Ref),
                [only] => {
                    r.sheet = Some((*only).clone());
                    r.sheet_last = None;
                }
                [lo, .., hi] => {
                    r.sheet = Some((*lo).clone());
                    r.sheet_last = Some((*hi).clone());
                }
            }
            return true;
        }
    }
    let hit = match e {
        Expr::Reference(r) => r.sheet.as_deref().is_some_and(|s| same_name(s, name)),
        Expr::QualifiedName { sheet, .. } => same_name(sheet, name),
        _ => false,
    };
    if hit {
        *e = Expr::Error(ErrorKind::Ref);
        return true;
    }
    if matches!(e, Expr::Reference(_) | Expr::QualifiedName { .. }) {
        return false;
    }
    match e {
        Expr::Call { args, .. } => args
            .iter_mut()
            .fold(false, |acc, a| drop_sheet_refs(a, name, order) | acc),
        Expr::Unary { expr, .. } => drop_sheet_refs(expr, name, order),
        Expr::Binary { lhs, rhs, .. } => {
            drop_sheet_refs(lhs, name, order) | drop_sheet_refs(rhs, name, order)
        }
        Expr::Array(rows) => rows
            .iter_mut()
            .flatten()
            .fold(false, |acc, a| drop_sheet_refs(a, name, order) | acc),
        _ => false,
    }
}

/// Rebuilds `e`: `f` returns `Some(replacement)` for the nodes it
/// rewrites (their children are not visited), `None` to descend.
pub fn map_expr(e: &Expr, f: &dyn Fn(&Expr) -> Option<Expr>) -> Expr {
    if let Some(x) = f(e) {
        return x;
    }
    match e {
        Expr::Call { name, args } => Expr::Call {
            name: name.clone(),
            args: args.iter().map(|a| map_expr(a, f)).collect(),
        },
        Expr::Unary { op, expr } => Expr::Unary {
            op: *op,
            expr: Box::new(map_expr(expr, f)),
        },
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(map_expr(lhs, f)),
            rhs: Box::new(map_expr(rhs, f)),
        },
        Expr::Array(rows) => Expr::Array(
            rows.iter()
                .map(|r| r.iter().map(|x| map_expr(x, f)).collect())
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Whether `e` uses a defined name (any name, any qualifier).
fn uses_names(e: &Expr) -> bool {
    match e {
        Expr::Name(_) | Expr::QualifiedName { .. } | Expr::Structured(_) => true,
        Expr::Call { args, .. } => args.iter().any(uses_names),
        Expr::Unary { expr, .. } => uses_names(expr),
        Expr::Binary { lhs, rhs, .. } => uses_names(lhs) || uses_names(rhs),
        Expr::Array(rows) => rows.iter().flatten().any(uses_names),
        _ => false,
    }
}

/// Whether `e` uses one of `names` (lower-case spellings).
fn mentions(e: &Expr, names: &HashSet<String>) -> bool {
    match e {
        Expr::Name(n) | Expr::QualifiedName { name: n, .. } => names.contains(&n.to_lowercase()),
        // A call of a named lambda (`=Twice(4)`).
        Expr::Call { name, args } => {
            names.contains(&name.to_lowercase()) || args.iter().any(|a| mentions(a, names))
        }
        Expr::Unary { expr, .. } => mentions(expr, names),
        Expr::Binary { lhs, rhs, .. } => mentions(lhs, names) || mentions(rhs, names),
        Expr::Array(rows) => rows.iter().flatten().any(|a| mentions(a, names)),
        _ => false,
    }
}

/// Whether `e` uses a structured reference or one of the table `names`
/// (lower case) as a plain name.
fn uses_tables(e: &Expr, names: &HashSet<String>) -> bool {
    match e {
        Expr::Structured(_) => true,
        Expr::Name(n) => names.contains(&n.to_lowercase()),
        Expr::Call { args, .. } => args.iter().any(|a| uses_tables(a, names)),
        Expr::Unary { expr, .. } => uses_tables(expr, names),
        Expr::Binary { lhs, rhs, .. } => uses_tables(lhs, names) || uses_tables(rhs, names),
        Expr::Array(rows) => rows.iter().flatten().any(|a| uses_tables(a, names)),
        _ => false,
    }
}

/// The definition of `name` seen from `sheet` (its own names first).
fn lookup_name<'a>(names: &'a [NameEntry], name: &str, sheet: SheetId) -> Option<&'a NameEntry> {
    names
        .iter()
        .find(|n| n.scope == NameScope::Sheet(sheet) && same_name(&n.name, name))
        .or_else(|| {
            names
                .iter()
                .find(|n| n.scope == NameScope::Workbook && same_name(&n.name, name))
        })
}

/// `e` with every defined name replaced by its definition as used in
/// `at` (recursively; unknown names become `#NAME?`): the dependency
/// graph and the volatility check see what the name reads.
fn expand_names(
    e: &Expr,
    names: &[NameEntry],
    tables: &[TableDef],
    sheets: &[Sheet],
    at: CellCoord,
    depth: u32,
) -> Expr {
    // A structured reference (or a table name) as the cells it means.
    let table_cells = |s: &StructRef| -> Option<Expr> {
        let t = crate::structured::table_for(tables, s, at)?;
        Some(match t.resolve(s, at) {
            Ok(r) => Expr::Reference(crate::ast::Reference::on(
                Some(sheets[t.sheet.0 as usize].name.clone()),
                crate::ast::RangeKind::area(
                    crate::ast::CellRef {
                        col: r.c0,
                        row: r.r0,
                        col_abs: true,
                        row_abs: true,
                    },
                    crate::ast::CellRef {
                        col: r.c1,
                        row: r.r1,
                        col_abs: true,
                        row_abs: true,
                    },
                ),
            )),
            Err(e) => Expr::Error(e),
        })
    };
    map_expr(e, &|x| {
        let (name, sheet) = match x {
            Expr::Structured(s) => {
                return Some(table_cells(s).unwrap_or(Expr::Error(ErrorKind::Ref)));
            }
            Expr::Name(n) => {
                if let Some(t) = table_cells(&StructRef {
                    table: Some(n.clone()),
                    items: Vec::new(),
                    columns: None,
                    keyword_form: false,
                }) {
                    return Some(t);
                }
                (n, Some(at.sheet))
            }
            Expr::QualifiedName { sheet, name } => (name, find_sheet(sheets, sheet)),
            _ => return None,
        };
        let def = sheet.and_then(|s| lookup_name(names, name, s));
        Some(match def {
            Some(d) if depth < 32 => {
                let d = name_definition_at(&d.ast, at);
                expand_names(&d, names, tables, sheets, at, depth + 1)
            }
            _ => Expr::Error(ErrorKind::Name),
        })
    })
}

/// Registers the formula of `c` in the graph (with its names expanded)
/// and records whether it is volatile.
#[allow(clippy::too_many_arguments)]
fn register(
    graph: &mut DependencyGraph,
    volatile: &mut HashSet<CellCoord>,
    sheets: &[Sheet],
    order: &[SheetId],
    names: &[NameEntry],
    tables: &[TableDef],
    registry: &FunctionRegistry,
    c: CellCoord,
    ast: &Expr,
) {
    let mut expanded = None;
    if uses_names(ast) {
        expanded = Some(expand_names(ast, names, tables, sheets, c, 0));
    }
    if uses_3d(expanded.as_ref().unwrap_or(ast)) {
        expanded = Some(expand_3d(expanded.as_ref().unwrap_or(ast), sheets, order));
    }
    let e = expanded.as_ref().unwrap_or(ast);
    graph.set_formula(c, e, &Names(sheets), c.sheet);
    if is_volatile(e, registry) {
        volatile.insert(c);
    } else {
        volatile.remove(&c);
    }
}

/// Whether `e` holds a 3-D reference (`Sheet1:Sheet3!A1`).
fn uses_3d(e: &Expr) -> bool {
    e.references().iter().any(|r| r.is_3d())
}

/// The sheet names of the span `first..=last` in display order (either
/// end first); `None` when either sheet does not exist.
fn span_names(sheets: &[Sheet], order: &[SheetId], first: &str, last: &str) -> Option<Vec<String>> {
    let pos = |name: &str| {
        let id = find_sheet(sheets, name)?;
        order.iter().position(|&o| o == id)
    };
    let (a, b) = (pos(first)?, pos(last)?);
    let (a, b) = (a.min(b), a.max(b));
    Some(
        order[a..=b]
            .iter()
            .map(|id| sheets[id.0 as usize].name.clone())
            .collect(),
    )
}

/// `e` with every 3-D reference replaced by a union of its per-sheet
/// references (for the dependency graph: such a formula reads every
/// sheet of the span).
fn expand_3d(e: &Expr, sheets: &[Sheet], order: &[SheetId]) -> Expr {
    map_expr(e, &|x| {
        let Expr::Reference(r) = x else {
            return None;
        };
        if !r.is_3d() {
            return None;
        }
        let first = r.sheet.as_deref().unwrap_or_default();
        let last = r.sheet_last.as_deref().unwrap_or_default();
        Some(match span_names(sheets, order, first, last) {
            Some(names) => Expr::Call {
                name: UNION_CALL.to_string(),
                args: names
                    .into_iter()
                    .map(|n| Expr::Reference(crate::ast::Reference::on(Some(n), r.kind)))
                    .collect(),
            },
            // Unresolved: keep the first sheet so a later sheet of that
            // name is picked up.
            None => Expr::Reference(crate::ast::Reference::on(r.sheet.clone(), r.kind)),
        })
    })
}

/// The call a name's top-level union `A1:B2,D1:D9` (Excel's reference
/// union, used by print titles and multi-area print ranges) is stored
/// as; it is not a function, so evaluating it gives `#NAME?`, but its
/// references are tracked and adjusted like any other.
pub const UNION_CALL: &str = "_XLUNION";

/// Splits `text` at commas outside quotes, brackets and parentheses.
fn split_top_level(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut depth, mut quote, mut start) = (0i32, None::<char>, 0);
    for (i, c) in text.char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '(' | '{') => depth += 1,
            (None, ')' | '}') => depth -= 1,
            (None, ',') if depth == 0 => {
                out.push(&text[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&text[start..]);
    out
}

/// Parses a name's definition; a top-level union becomes [`UNION_CALL`].
fn parse_name_formula(body: &str) -> Result<Expr, ParseError> {
    match parse(body) {
        Ok(ast) => Ok(ast),
        Err(e) => {
            let parts = split_top_level(body);
            if parts.len() < 2 {
                return Err(e);
            }
            let args = parts
                .iter()
                .map(|p| parse(p.trim()))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| e)?;
            Ok(Expr::Call {
                name: UNION_CALL.to_string(),
                args,
            })
        }
    }
}

/// The text of a name's definition (a union as `A,B`).
fn name_formula_text(ast: &Expr) -> String {
    match ast {
        Expr::Call { name, args } if name == UNION_CALL => args
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(","),
        e => e.to_string(),
    }
}

/// Value equality with numbers compared by bit pattern (so `0` vs `-0`
/// counts as a change).
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.to_bits() == y.to_bits(),
        _ => a == b,
    }
}

/// Interprets user input the way a spreadsheet cell editor does (what
/// [`Engine::set_input`] stores).
pub fn parse_input(input: &str) -> Result<CellContent, ParseError> {
    if input.is_empty() {
        return Ok(CellContent::Empty);
    }
    if let Some(text) = input.strip_prefix('\'') {
        return Ok(CellContent::Value(Value::Text(text.to_string())));
    }
    if input.starts_with('=') {
        let ast = parse(input)?;
        return Ok(CellContent::Formula {
            text: input.to_string(),
            ast,
        });
    }
    let value = if input.eq_ignore_ascii_case("TRUE") {
        Value::Bool(true)
    } else if input.eq_ignore_ascii_case("FALSE") {
        Value::Bool(false)
    } else if let Ok(k) = input.parse::<ErrorKind>() {
        Value::Error(k)
    } else if input.trim() == input {
        // Surrounding whitespace keeps the input text (as in Excel).
        // Numbers, percentages, currencies, fractions, dates and times
        // (`crate::entry`); the format Excel gives them is the caller's.
        match parse_number_text(input).or_else(|| crate::entry::recognize(input).map(|e| e.value)) {
            Some(n) => Value::Number(n),
            None => Value::Text(input.to_string()),
        }
    } else {
        Value::Text(input.to_string())
    };
    Ok(CellContent::Value(value))
}

/// Workbook-level formula engine. See the module docs.
pub struct Engine {
    /// Indexed by `SheetId.0` (removed sheets stay as tombstones).
    sheets: Vec<Sheet>,
    /// The live sheets in display order.
    order: Vec<SheetId>,
    graph: DependencyGraph,
    registry: FunctionRegistry,
    volatile: HashSet<CellCoord>,
    now: fn() -> f64,
    /// `Some` while a batch is open: the edited cells awaiting recalculation.
    pending: Option<Vec<CellCoord>>,
    /// Spilled cells emptied outside a recalculation pass (an anchor was
    /// overwritten or rows moved), reported by the next [`Recalc`].
    freed: Vec<CellCoord>,
    /// A row's visibility changed inside the open batch: `end_batch`
    /// re-evaluates the cells reading row visibility.
    visibility_dirty: bool,
    /// Defined names in definition order.
    names: Vec<NameEntry>,
    /// The pivot tables `GETPIVOTDATA` reads, by sheet.
    pivots: crate::pivot::PivotRegistry,
    /// The Excel tables structured references resolve against.
    tables: Vec<TableDef>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    /// An engine with the built-in functions and one sheet `Sheet1`.
    pub fn new() -> Self {
        Self::with_registry(FunctionRegistry::with_builtins())
    }

    /// An engine with a custom function registry and one sheet `Sheet1`.
    pub fn with_registry(registry: FunctionRegistry) -> Self {
        Engine {
            sheets: vec![Sheet::new("Sheet1")],
            order: vec![SheetId(0)],
            graph: DependencyGraph::new(),
            registry,
            volatile: HashSet::new(),
            now: default_now,
            pending: None,
            freed: Vec::new(),
            visibility_dirty: false,
            names: Vec::new(),
            pivots: Default::default(),
            tables: Vec::new(),
        }
    }

    /// Appends a sheet. Formulas that referenced `name` before it existed
    /// are re-resolved and recalculated.
    pub fn add_sheet(&mut self, name: &str) -> Result<SheetId, EngineError> {
        if find_sheet(&self.sheets, name).is_some() {
            return Err(EngineError::DuplicateSheet(name.to_string()));
        }
        let id = SheetId(self.sheets.len() as u32);
        self.sheets.push(Sheet::new(name));
        self.order.push(id);
        self.reresolve(name);
        self.refresh_3d();
        Ok(id)
    }

    /// Deletes a sheet (Excel's "Delete sheet"): its contents are dropped,
    /// every reference to it in the other sheets' formulas becomes `#REF!`
    /// (the formula text is regenerated from the rewritten AST) and the
    /// affected formulas are recalculated (deferred inside a batch). The id
    /// is never handed out again (see [`restore_sheet`](Self::restore_sheet)).
    ///
    /// [`Recalc::changed`] lists every rewritten formula and every
    /// re-evaluated formula whose value changed. Fails with
    /// [`EngineError::LastSheet`] for the only remaining sheet.
    pub fn remove_sheet(&mut self, id: SheetId) -> Result<Recalc, EngineError> {
        let idx = self.sheet_index(id)?;
        if self.order.len() == 1 {
            return Err(EngineError::LastSheet);
        }
        // 1. Rewrite references to the sheet on the remaining sheets.
        let name = self.sheets[idx].name.clone();
        let order_names: Vec<String> = self.sheets().map(|(_, n)| n.to_string()).collect();
        let mut rewritten = Vec::new();
        for (i, s) in self.sheets.iter_mut().enumerate() {
            if i == idx || s.removed {
                continue;
            }
            for (&(row, col), content) in s.cells.iter_mut() {
                let CellContent::Formula { text, ast } = content else {
                    continue;
                };
                if drop_sheet_refs(ast, &name, &order_names) {
                    *text = format!("={ast}");
                    rewritten.push(CellCoord::new(SheetId(i as u32), row, col));
                }
            }
        }
        // Names: the sheet's own names go; references to the sheet in the
        // others become `#REF!`; formulas using either are re-registered.
        let mut changed_names: Vec<String> = Vec::new();
        self.names.retain(|n| {
            let local = n.scope == NameScope::Sheet(id);
            if local {
                changed_names.push(n.name.clone());
            }
            !local
        });
        for n in &mut self.names {
            if drop_sheet_refs(&mut n.ast, &name, &order_names) {
                n.formula = name_formula_text(&n.ast);
                changed_names.push(n.name.clone());
            }
        }
        for c in self.name_users(&changed_names) {
            if c.sheet != id && !rewritten.contains(&c) {
                rewritten.push(c);
            }
        }
        // 2. Drop the sheet's own formulas and edges, then re-register the
        //    rewritten ones (they no longer point at the sheet).
        for c in self.graph.remove_sheet(id) {
            self.volatile.remove(&c);
        }
        for &c in &rewritten {
            let Some(CellContent::Formula { ast, .. }) =
                self.sheets[c.sheet.0 as usize].cells.get(&(c.row, c.col))
            else {
                continue;
            };
            register(
                &mut self.graph,
                &mut self.volatile,
                &self.sheets,
                &self.order,
                &self.names,
                &self.tables,
                &self.registry,
                c,
                ast,
            );
        }
        // 3. Tombstone.
        let s = &mut self.sheets[idx];
        s.cells.clear();
        s.values.clear();
        s.arrays.clear();
        s.used = None;
        s.hidden_rows.clear();
        s.removed = true;
        self.freed.retain(|c| c.sheet != id);
        self.order.retain(|&o| o != id);
        for c in self.reregister_3d() {
            if !rewritten.contains(&c) {
                rewritten.push(c);
            }
        }
        if let Some(pending) = &mut self.pending {
            pending.extend(rewritten.iter().copied());
            rewritten.sort_unstable();
            return Ok(Recalc {
                changed: rewritten,
                cycle: None,
            });
        }
        let mut recalc = self.recalc(&rewritten);
        recalc.changed.extend(rewritten);
        recalc.changed.sort_unstable();
        recalc.changed.dedup();
        Ok(recalc)
    }

    /// Brings back a sheet removed by [`remove_sheet`](Self::remove_sheet)
    /// (undo): empty, named `name`, at position `index` of the sheet order.
    /// Formulas referencing `name` while no such sheet existed are
    /// re-resolved, as by [`add_sheet`](Self::add_sheet). Fails with
    /// [`EngineError::UnknownSheet`] unless `id` is a removed sheet.
    pub fn restore_sheet(
        &mut self,
        id: SheetId,
        name: &str,
        index: usize,
    ) -> Result<(), EngineError> {
        let idx = id.0 as usize;
        if !self.sheets.get(idx).is_some_and(|s| s.removed) {
            return Err(EngineError::UnknownSheet(id));
        }
        if index > self.order.len() {
            return Err(EngineError::InvalidSheetIndex(index));
        }
        if find_sheet(&self.sheets, name).is_some() {
            return Err(EngineError::DuplicateSheet(name.to_string()));
        }
        self.sheets[idx] = Sheet::new(name);
        self.order.insert(index, id);
        self.reresolve(name);
        self.refresh_3d();
        Ok(())
    }

    /// Moves a sheet to position `index` of the sheet order (0 = first).
    pub fn move_sheet(&mut self, id: SheetId, index: usize) -> Result<(), EngineError> {
        self.sheet_index(id)?;
        if index >= self.order.len() {
            return Err(EngineError::InvalidSheetIndex(index));
        }
        self.order.retain(|&o| o != id);
        self.order.insert(index, id);
        self.refresh_3d();
        Ok(())
    }

    /// Position of a live sheet in the sheet order.
    pub fn sheet_position(&self, id: SheetId) -> Option<usize> {
        self.order.iter().position(|&o| o == id)
    }

    /// Copies sheet `id` to a new sheet `name`, placed right after it:
    /// constants and formulas, with the formulas' references to the
    /// source sheet itself (`Sheet1!A1` on `Sheet1`) pointing at the copy,
    /// as in Excel; unprefixed references stay local anyway. The copy is
    /// evaluated (deferred inside a batch). Returns the new id and the
    /// recalculation.
    pub fn duplicate_sheet(
        &mut self,
        id: SheetId,
        name: &str,
    ) -> Result<(SheetId, Recalc), EngineError> {
        let idx = self.sheet_index(id)?;
        let at = self.sheet_position(id).map_or(self.order.len(), |p| p + 1);
        let source = self.sheets[idx].name.clone();
        let mut cells: Vec<((u32, u32), CellContent)> = self.sheets[idx]
            .cells
            .iter()
            .filter(|(_, content)| !matches!(content, CellContent::Spilled { .. }))
            .map(|(&pos, content)| (pos, content.clone()))
            .collect();
        cells.sort_unstable_by_key(|(pos, _)| *pos);
        let hidden_rows = self.sheets[idx].hidden_rows.clone();
        let new = self.add_sheet(name)?;
        self.sheets[new.0 as usize].hidden_rows = hidden_rows;
        // The source's own names are copied to the new sheet (as Excel).
        let copies: Vec<NameEntry> = self
            .names
            .iter()
            .filter(|n| n.scope == NameScope::Sheet(id))
            .map(|n| {
                let mut ast = n.ast.clone();
                rename_refs(&mut ast, &source, name);
                NameEntry {
                    name: n.name.clone(),
                    scope: NameScope::Sheet(new),
                    formula: name_formula_text(&ast),
                    ast,
                }
            })
            .collect();
        self.names.extend(copies);
        self.order.pop();
        self.order.insert(at, new);
        for (_, content) in &mut cells {
            if let CellContent::Formula { text, ast } = content {
                if rename_refs(ast, &source, name) {
                    *text = format!("={ast}");
                }
            }
        }
        let own_batch = self.pending.is_none();
        self.begin_batch();
        let mut copied = Ok(Recalc::default());
        for ((row, col), content) in cells {
            copied = self.set_content(CellCoord::new(new, row, col), content);
            if copied.is_err() {
                break;
            }
        }
        let recalc = if own_batch {
            self.end_batch()
        } else {
            Recalc::default()
        };
        copied?;
        Ok((new, recalc))
    }

    /// Renames a sheet. Formulas referencing it keep working: their ASTs
    /// and their text are rewritten (`=Sheet2!A1` → `='Data 2'!A1`, as in
    /// Excel); formulas referencing `new_name` while no such sheet existed
    /// are re-resolved and recalculated. Returns the rewritten formula
    /// cells.
    pub fn rename_sheet(
        &mut self,
        id: SheetId,
        new_name: &str,
    ) -> Result<Vec<CellCoord>, EngineError> {
        let idx = self.sheet_index(id)?;
        if let Some(other) = find_sheet(&self.sheets, new_name) {
            if other != id {
                return Err(EngineError::DuplicateSheet(new_name.to_string()));
            }
        }
        let old = std::mem::replace(&mut self.sheets[idx].name, new_name.to_string());
        let mut rewritten = Vec::new();
        if !same_name(&old, new_name) {
            for (i, sheet) in self.sheets.iter_mut().enumerate() {
                for (&(row, col), content) in sheet.cells.iter_mut() {
                    if let CellContent::Formula { text, ast } = content {
                        if rename_refs(ast, &old, new_name) {
                            *text = format!("={ast}");
                            rewritten.push(CellCoord::new(SheetId(i as u32), row, col));
                        }
                    }
                }
            }
            for n in &mut self.names {
                if rename_refs(&mut n.ast, &old, new_name) {
                    n.formula = name_formula_text(&n.ast);
                }
            }
            self.reresolve(new_name);
        }
        rewritten.sort_unstable();
        Ok(rewritten)
    }

    pub fn sheet_id(&self, name: &str) -> Option<SheetId> {
        find_sheet(&self.sheets, name)
    }

    /// The name of a live sheet (`None` for unknown and removed sheets).
    pub fn sheet_name(&self, id: SheetId) -> Option<&str> {
        self.sheets
            .get(id.0 as usize)
            .filter(|s| !s.removed)
            .map(|s| s.name.as_str())
    }

    /// All live sheets in display order.
    pub fn sheets(&self) -> impl Iterator<Item = (SheetId, &str)> {
        self.order
            .iter()
            .map(|&id| (id, self.sheets[id.0 as usize].name.as_str()))
    }

    /// Sets a cell from user input: `""` → empty; a leading `'` forces text
    /// (`'0123`); a leading `=` is a formula (a parse error is returned and
    /// the cell is left unchanged); `TRUE`/`FALSE` (any case) → Bool; an
    /// error literal (`#N/A`) → Error; a number (`12`, `1e3`, `1,000`,
    /// `$5`, `50%`) without surrounding whitespace → Number; anything else
    /// is text.
    pub fn set_input(&mut self, c: CellCoord, input: &str) -> Result<Recalc, EngineError> {
        self.check(c)?;
        let content = parse_input(input)?;
        self.set_content(c, content)
    }

    /// Stores `content` in `c` and recalculates. `Value(Empty)` and
    /// `Spilled` are stored as `Empty`, `Value(Array)` as its top-left
    /// element.
    ///
    /// Spilled cells: storing `Empty` in one is a no-op (the spill stays);
    /// anything else makes the cell an obstacle and its anchor shows
    /// `#SPILL!`. Replacing an anchor by a constant (or `Empty`) removes
    /// its spill.
    pub fn set_content(
        &mut self,
        c: CellCoord,
        content: CellContent,
    ) -> Result<Recalc, EngineError> {
        let idx = self.check(c)?;
        let content = match content {
            CellContent::Value(Value::Empty) | CellContent::Spilled { .. } => CellContent::Empty,
            CellContent::Value(v @ Value::Array(_)) => match v.into_scalar() {
                Value::Empty => CellContent::Empty,
                v => CellContent::Value(v),
            },
            CellContent::Value(Value::Number(n)) => CellContent::Value(Value::number(n)),
            other => other,
        };
        let mut seeds = vec![c];
        let pos = (c.row, c.col);
        if let Some(CellContent::Spilled { anchor }) = self.sheets[idx].cells.get(&pos) {
            if content == CellContent::Empty {
                return Ok(Recalc::default());
            }
            // An obstacle now: the anchor re-evaluates to `#SPILL!`.
            seeds.push(*anchor);
            let s = &mut self.sheets[idx];
            s.cells.remove(&pos);
            s.values.remove(&pos);
        }
        if !matches!(content, CellContent::Formula { .. }) {
            seeds.extend(self.clear_spill(c));
        }
        match &content {
            CellContent::Formula { ast, .. } => {
                register(
                    &mut self.graph,
                    &mut self.volatile,
                    &self.sheets,
                    &self.order,
                    &self.names,
                    &self.tables,
                    &self.registry,
                    c,
                    ast,
                );
            }
            _ => {
                self.graph.remove_formula(c);
                self.volatile.remove(&c);
                self.sheets[idx].values.remove(&(c.row, c.col));
            }
        }
        let sheet = &mut self.sheets[idx];
        if let CellContent::Empty = content {
            if sheet.cells.remove(&(c.row, c.col)).is_some() {
                sheet.shrink_used(c.row, c.col);
            }
        } else {
            sheet.cells.insert((c.row, c.col), content);
            sheet.grow_used(c.row, c.col);
        }
        // Arrays blocked by this cell (or by a freed one) try again.
        seeds.extend(sheet.blocked_over(&seeds));
        if let Some(pending) = &mut self.pending {
            pending.extend(seeds);
            return Ok(Recalc::default());
        }
        Ok(self.recalc(&seeds))
    }

    /// Removes the array state of the formula in `anchor` and empties its
    /// spilled cells, which are returned (and reported by the next
    /// [`Recalc`]).
    fn clear_spill(&mut self, anchor: CellCoord) -> Vec<CellCoord> {
        self.graph.set_spill(anchor, None);
        let s = &mut self.sheets[anchor.sheet.0 as usize];
        let freed = match s.arrays.remove(&(anchor.row, anchor.col)) {
            Some(spill) if !spill.blocked => s.free_spill(anchor, spill.rows, spill.cols, None),
            _ => Vec::new(),
        };
        self.freed.extend(freed.iter().copied());
        freed
    }

    /// The array state of the formula in `anchor`, if its result has more
    /// than one cell.
    pub fn spill(&self, anchor: CellCoord) -> Option<Spill> {
        self.sheets
            .get(anchor.sheet.0 as usize)
            .and_then(|s| s.arrays.get(&(anchor.row, anchor.col)))
            .copied()
    }

    /// The range the formula in `anchor` spills into (anchor included);
    /// `None` unless it spills (blocked arrays do not).
    pub fn spill_range(&self, anchor: CellCoord) -> Option<RangeRef> {
        let s = self.spill(anchor).filter(|s| !s.blocked)?;
        Some(RangeRef::new(
            anchor.sheet,
            anchor.row,
            anchor.col,
            anchor.row + s.rows - 1,
            anchor.col + s.cols - 1,
        ))
    }

    /// The anchor of a spilled cell (`None` for every other cell, anchors
    /// included).
    pub fn spill_anchor(&self, c: CellCoord) -> Option<CellCoord> {
        match self.content(c) {
            CellContent::Spilled { anchor } => Some(*anchor),
            _ => None,
        }
    }

    /// Every array formula of `sheet` with its state, sorted by anchor.
    pub fn spills(&self, sheet: SheetId) -> Vec<(CellCoord, Spill)> {
        let mut out: Vec<(CellCoord, Spill)> = self
            .sheets
            .get(sheet.0 as usize)
            .into_iter()
            .flat_map(|s| s.arrays.iter())
            .map(|(&(r, c), &spill)| (CellCoord::new(sheet, r, c), spill))
            .collect();
        out.sort_unstable_by_key(|(c, _)| *c);
        out
    }

    /// Empties a cell.
    pub fn clear(&mut self, c: CellCoord) -> Result<Recalc, EngineError> {
        self.set_content(c, CellContent::Empty)
    }

    /// The content of `c` (`Empty` for blank cells and unknown sheets).
    pub fn content(&self, c: CellCoord) -> &CellContent {
        self.sheets
            .get(c.sheet.0 as usize)
            .and_then(|s| s.cells.get(&(c.row, c.col)))
            .unwrap_or(&EMPTY)
    }

    /// The computed value of `c`: constants return themselves, blank cells
    /// `Empty`, formulas their last computed result (`0` on a cycle).
    pub fn value(&self, c: CellCoord) -> Value {
        let Some(sheet) = self.sheets.get(c.sheet.0 as usize) else {
            return Value::Empty;
        };
        match sheet.cells.get(&(c.row, c.col)) {
            None | Some(CellContent::Empty) => Value::Empty,
            Some(CellContent::Value(v)) => v.clone(),
            Some(CellContent::Formula { .. } | CellContent::Spilled { .. }) => sheet
                .values
                .get(&(c.row, c.col))
                .cloned()
                .unwrap_or(Value::Empty),
        }
    }

    /// The formula text of `c` as stored, if it holds a formula.
    pub fn formula_text(&self, c: CellCoord) -> Option<&str> {
        match self.content(c) {
            CellContent::Formula { text, .. } => Some(text),
            _ => None,
        }
    }

    /// Re-evaluates every formula (e.g. after a bulk load).
    pub fn recalc_all(&mut self) -> Recalc {
        let schedule = self.graph.full_schedule();
        self.run(schedule)
    }

    /// `(max_row, max_col)` of non-empty content, `None` for an empty or
    /// unknown sheet.
    pub fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
        self.sheets.get(sheet.0 as usize).and_then(|s| s.used)
    }

    /// An evaluation context for an expression that is not stored in a
    /// cell (conditional formatting and data validation rules): values come
    /// from `provider` (usually `self`, or an overlay of it), `at` is the
    /// current cell, and this engine's functions and clock are used.
    pub fn eval_context<'a>(
        &'a self,
        provider: &'a dyn CellProvider,
        at: CellCoord,
    ) -> EvalContext<'a> {
        let mut ctx = EvalContext::new(provider, &self.registry, at);
        ctx.now = self.now;
        ctx
    }

    /// Replaces the clock used by `NOW`/`TODAY` (Excel serial date-time).
    pub fn set_now(&mut self, now: fn() -> f64) {
        self.now = now;
    }

    /// Defers recalculation: until [`end_batch`](Self::end_batch), `set_*`
    /// only update storage and the dependency graph and return an empty
    /// [`Recalc`]; values read in between may be stale. Calling it while a
    /// batch is open has no effect (batches do not nest).
    pub fn begin_batch(&mut self) {
        self.pending.get_or_insert_with(Vec::new);
    }

    /// Closes the batch and recalculates everything affected by the edits
    /// made during it. Without an open batch this only recalculates the
    /// volatile cells.
    pub fn end_batch(&mut self) -> Recalc {
        let mut pending = self.pending.take().unwrap_or_default();
        if std::mem::take(&mut self.visibility_dirty) {
            pending.extend(self.row_visibility_cells());
        }
        self.recalc(&pending)
    }

    /// Replaces the pivot tables of `sheet` that `GETPIVOTDATA` reads (the
    /// document model calls it whenever it renders a pivot table; the
    /// function is volatile, so the next recalculation sees them).
    pub fn set_pivot_data(&mut self, sheet: SheetId, tables: Vec<crate::PivotData>) {
        if tables.is_empty() {
            self.pivots.remove(&sheet);
        } else {
            self.pivots.insert(sheet, tables);
        }
    }

    /// The pivot tables of `sheet` (see [`set_pivot_data`](Self::set_pivot_data)).
    pub fn pivot_data(&self, sheet: SheetId) -> &[crate::PivotData] {
        self.pivots.get(&sheet).map_or(&[], Vec::as_slice)
    }

    /// Whether row `row` of `sheet` is hidden (see [`RowHidden`]).
    pub fn row_hidden(&self, sheet: SheetId, row: u32) -> RowHidden {
        self.sheets
            .get(sheet.0 as usize)
            .and_then(|s| s.hidden_rows.get(&row))
            .copied()
            .unwrap_or_default()
    }

    /// Records the visibility of a row (the engine stores no other row
    /// properties; the document model keeps it in sync). When it changes,
    /// every formula calling a function that reads row visibility
    /// (`SUBTOTAL`) is re-evaluated (deferred inside a batch). Rows move
    /// with row inserts and deletes.
    pub fn set_row_hidden(
        &mut self,
        sheet: SheetId,
        row: u32,
        state: RowHidden,
    ) -> Result<Recalc, EngineError> {
        let idx = self.check(CellCoord::new(sheet, row, 0))?;
        let rows = &mut self.sheets[idx].hidden_rows;
        let old = if state == RowHidden::Visible {
            rows.remove(&row)
        } else {
            rows.insert(row, state)
        };
        if old.unwrap_or_default() == state {
            return Ok(Recalc::default());
        }
        if self.pending.is_some() {
            self.visibility_dirty = true;
            return Ok(Recalc::default());
        }
        let seeds = self.row_visibility_cells();
        Ok(self.recalc(&seeds))
    }

    /// Every formula cell calling a function that reads row visibility.
    fn row_visibility_cells(&self) -> Vec<CellCoord> {
        let mut out = Vec::new();
        for (i, s) in self.sheets.iter().enumerate() {
            for (&(row, col), content) in &s.cells {
                if let CellContent::Formula { ast, .. } = content {
                    if reads_row_visibility(ast, &self.registry) {
                        out.push(CellCoord::new(SheetId(i as u32), row, col));
                    }
                }
            }
        }
        out
    }

    /// All non-empty contents of `sheet` (spilled cells included, see
    /// [`value`](Self::value) for what they show), in no particular order
    /// (empty for an unknown sheet).
    pub fn cells(&self, sheet: SheetId) -> impl Iterator<Item = (CellCoord, &CellContent)> {
        self.sheets
            .get(sheet.0 as usize)
            .into_iter()
            .flat_map(move |s| {
                s.cells
                    .iter()
                    .map(move |(&(row, col), content)| (CellCoord::new(sheet, row, col), content))
            })
    }

    /// Inserts `count` empty rows before row `at` (0-based) of `sheet`.
    ///
    /// Cells at or below `at` move down; every formula of the workbook is
    /// rewritten with [`adjust_references`](crate::adjust_references) (its text regenerated from the
    /// new AST). [`Recalc::changed`] lists the vacated and the new
    /// positions of every moved cell, every formula whose text was
    /// rewritten (on any sheet) and every re-evaluated formula whose value
    /// changed. Inside a batch the recalculation is deferred as for
    /// `set_*`. Fails with [`EngineError::InvalidCoord`] if `at` is
    /// past the last row or non-empty cells would be pushed off the sheet.
    /// `count == 0` is a no-op.
    ///
    /// Cost: O(cells of `sheet` + formulas of the workbook) for moving and
    /// rewriting; only the moved/rewritten formulas are re-registered in
    /// the dependency graph, and recalculation is incremental, seeded with
    /// every coordinate whose content changed.
    pub fn insert_rows(
        &mut self,
        sheet: SheetId,
        at: u32,
        count: u32,
    ) -> Result<Recalc, EngineError> {
        self.structural(sheet, StructuralOp::InsertRows { at, count }.into())
    }

    /// Deletes rows `at..at + count` of `sheet`; cells below move up and
    /// references into the deleted rows become `#REF!` (ranges shrink).
    /// Fails with [`EngineError::InvalidCoord`] if the span extends past
    /// the last row. See [`insert_rows`](Self::insert_rows).
    pub fn delete_rows(
        &mut self,
        sheet: SheetId,
        at: u32,
        count: u32,
    ) -> Result<Recalc, EngineError> {
        self.structural(sheet, StructuralOp::DeleteRows { at, count }.into())
    }

    /// Inserts `count` empty columns before column `at`. See
    /// [`insert_rows`](Self::insert_rows).
    pub fn insert_cols(
        &mut self,
        sheet: SheetId,
        at: u32,
        count: u32,
    ) -> Result<Recalc, EngineError> {
        self.structural(sheet, StructuralOp::InsertCols { at, count }.into())
    }

    /// Deletes columns `at..at + count`. See
    /// [`delete_rows`](Self::delete_rows).
    pub fn delete_cols(
        &mut self,
        sheet: SheetId,
        at: u32,
        count: u32,
    ) -> Result<Recalc, EngineError> {
        self.structural(sheet, StructuralOp::DeleteCols { at, count }.into())
    }

    /// Excel's Insert / Delete Cells with a shift: `op` restricted to the
    /// band `lo..=hi` of the other axis (see [`CellShift`]). Contents of
    /// the band move; references follow with
    /// [`adjust_references_shift`]. Same errors and cost as
    /// [`insert_rows`](Self::insert_rows).
    pub fn shift_cells(
        &mut self,
        sheet: SheetId,
        op: StructuralOp,
        lo: u32,
        hi: u32,
    ) -> Result<Recalc, EngineError> {
        let band_max = if op.is_rows() { MAX_COL } else { MAX_ROW };
        if lo.max(hi) > band_max {
            return Err(EngineError::InvalidCoord);
        }
        self.structural(sheet, CellShift::new(op, lo, hi))
    }

    // --- tables -----------------------------------------------------------

    /// The Excel tables structured references resolve against.
    pub fn tables(&self) -> &[TableDef] {
        &self.tables
    }

    /// The table named `name` (case-insensitive).
    pub fn table(&self, name: &str) -> Option<&TableDef> {
        crate::structured::find_table(&self.tables, name)
    }

    /// The table whose range holds `c`.
    pub fn table_at(&self, c: CellCoord) -> Option<&TableDef> {
        self.tables.iter().find(|t| t.contains(c))
    }

    /// Replaces the tables (the document model keeps them). Every formula
    /// with a structured reference, a table name or a name defined
    /// through one is re-registered and recalculated (deferred inside a
    /// batch).
    pub fn set_tables(&mut self, tables: Vec<TableDef>) -> Recalc {
        if tables == self.tables {
            return Recalc::default();
        }
        let names: HashSet<String> = self
            .tables
            .iter()
            .chain(&tables)
            .map(|t| t.name.to_lowercase())
            .collect();
        self.tables = tables;
        let users = self.table_users(&names);
        self.reregister(users)
    }

    /// Formula cells using a structured reference, one of the table
    /// `names` (lower case) or a defined name that does, sorted.
    fn table_users(&self, names: &HashSet<String>) -> Vec<CellCoord> {
        let via: Vec<String> = self
            .names
            .iter()
            .filter(|n| uses_tables(&n.ast, names))
            .map(|n| n.name.clone())
            .collect();
        let mut out = self.name_users(&via);
        for (i, sheet) in self.sheets.iter().enumerate() {
            for (&(row, col), content) in &sheet.cells {
                if let CellContent::Formula { ast, .. } = content {
                    if uses_tables(ast, names) {
                        out.push(CellCoord::new(SheetId(i as u32), row, col));
                    }
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// Re-registers the formulas of `cells` and recalculates them.
    fn reregister(&mut self, cells: Vec<CellCoord>) -> Recalc {
        for &c in &cells {
            let Some(CellContent::Formula { ast, .. }) =
                self.sheets[c.sheet.0 as usize].cells.get(&(c.row, c.col))
            else {
                continue;
            };
            register(
                &mut self.graph,
                &mut self.volatile,
                &self.sheets,
                &self.order,
                &self.names,
                &self.tables,
                &self.registry,
                c,
                ast,
            );
        }
        match &mut self.pending {
            Some(pending) => {
                pending.extend(cells);
                Recalc::default()
            }
            None => {
                let mut r = self.recalc(&cells);
                r.changed.extend(cells);
                r.changed.sort_unstable();
                r.changed.dedup();
                r
            }
        }
    }

    /// Rewrites every formula (cells and defined names) with `f(node,
    /// formula cell)`: `Some(replacement)` for the nodes it rewrites.
    /// Names are rewritten as seen from `A1` of their sheet (workbook
    /// names: of the first sheet). The rewritten cells' text is
    /// regenerated; they and the users of rewritten names are
    /// re-registered and recalculated. Returns that recalculation
    /// (`changed` lists the rewritten cells).
    fn rewrite_formulas(
        &mut self,
        only: Option<SheetId>,
        f: &dyn Fn(&Expr, CellCoord) -> Option<Expr>,
    ) -> Recalc {
        let mut rewritten = Vec::new();
        for (i, sheet) in self.sheets.iter_mut().enumerate() {
            if only.is_some_and(|o| o.0 as usize != i) {
                continue;
            }
            for (&(row, col), content) in sheet.cells.iter_mut() {
                let CellContent::Formula { text, ast } = content else {
                    continue;
                };
                let at = CellCoord::new(SheetId(i as u32), row, col);
                let new = map_expr(ast, &|x| f(x, at));
                if new != *ast {
                    *text = format!("={new}");
                    *ast = new;
                    rewritten.push(at);
                }
            }
        }
        let first = self.order.first().copied().unwrap_or(SheetId(0));
        let mut changed_names = Vec::new();
        for n in self.names.iter_mut().filter(|_| only.is_none()) {
            let host = match n.scope {
                NameScope::Sheet(id) => id,
                NameScope::Workbook => first,
            };
            let at = CellCoord::new(host, 0, 0);
            let new = map_expr(&n.ast, &|x| f(x, at));
            if new != n.ast {
                n.formula = name_formula_text(&new);
                n.ast = new;
                changed_names.push(n.name.clone());
            }
        }
        let mut cells = rewritten;
        cells.extend(self.name_users(&changed_names));
        cells.sort_unstable();
        cells.dedup();
        self.reregister(cells)
    }

    /// A table was renamed from `old` to `new`: structured references
    /// and plain uses of the name follow (call before
    /// [`set_tables`](Self::set_tables) with the renamed table).
    pub fn rename_table_refs(&mut self, old: &str, new: &str) -> Recalc {
        self.rename_table_refs_in(None, old, new)
    }

    /// [`rename_table_refs`](Self::rename_table_refs) for the formulas of
    /// one sheet only (`None`: every formula and name).
    pub fn rename_table_refs_in(&mut self, only: Option<SheetId>, old: &str, new: &str) -> Recalc {
        let f = crate::structured::rename_table_rewrite(old, new);
        self.rewrite_formulas(only, &f)
    }

    /// Column `old` of table `table` was renamed to `new`: structured
    /// references to it follow (call before [`set_tables`](Self::set_tables)).
    pub fn rename_table_column_refs(&mut self, table: &str, old: &str, new: &str) -> Recalc {
        let Some(def) = self.table(table).cloned() else {
            return Recalc::default();
        };
        let f = crate::structured::rename_column_rewrite(&def, old, new);
        self.rewrite_formulas(None, &f)
    }

    /// The columns `deleted` of table `table` are about to be deleted:
    /// references to them become `#REF!` and column ranges shrink (see
    /// [`delete_columns_rewrite`](crate::structured::delete_columns_rewrite);
    /// call before [`set_tables`](Self::set_tables) with the smaller table).
    pub fn delete_table_column_refs(&mut self, table: &str, deleted: &[String]) -> Recalc {
        let Some(def) = self.table(table).cloned() else {
            return Recalc::default();
        };
        let f = crate::structured::delete_columns_rewrite(&def, deleted);
        self.rewrite_formulas(None, &f)
    }

    /// Rewrites every cell formula and defined name with `f` (see
    /// [`ExprRewrite`](crate::structured::ExprRewrite)); the rewritten
    /// cells are re-registered and recalculated.
    pub fn rewrite_formulas_with(&mut self, f: &crate::structured::ExprRewrite<'_>) -> Recalc {
        self.rewrite_formulas(None, f)
    }

    /// Convert to Range: every structured reference to `table` (and its
    /// plain name) becomes an A1 reference to the cells it means (`$C$2:$C$9`;
    /// "this row" `$C2`), sheet-qualified outside the table's sheet.
    pub fn table_refs_to_a1(&mut self, table: &str) -> Recalc {
        let Some(def) = self.table(table).cloned() else {
            return Recalc::default();
        };
        let sheet_name = self.sheets[def.sheet.0 as usize].name.clone();
        self.rewrite_formulas(None, &|x, at| {
            let s = match x {
                Expr::Structured(s) => {
                    let ours = match &s.table {
                        Some(t) => same_name(t, &def.name),
                        None => def.contains(at),
                    };
                    if !ours {
                        return None;
                    }
                    s.clone()
                }
                Expr::Name(n) if same_name(n, &def.name) => StructRef {
                    table: Some(n.clone()),
                    items: Vec::new(),
                    columns: None,
                    keyword_form: false,
                },
                _ => return None,
            };
            Some(match def.resolve(&s, at) {
                Ok(r) => {
                    let this_row = s.is_this_row();
                    let cell = |row: u32, col: u32| crate::ast::CellRef {
                        col,
                        row,
                        col_abs: true,
                        row_abs: !this_row,
                    };
                    let kind = if (r.r0, r.c0) == (r.r1, r.c1) {
                        crate::ast::RangeKind::Cell(cell(r.r0, r.c0))
                    } else {
                        crate::ast::RangeKind::area(cell(r.r0, r.c0), cell(r.r1, r.c1))
                    };
                    Expr::Reference(crate::ast::Reference::on(
                        (at.sheet != def.sheet).then(|| sheet_name.clone()),
                        kind,
                    ))
                }
                Err(e) => Expr::Error(e),
            })
        })
    }

    // --- defined names ----------------------------------------------------

    /// The defined names in definition order.
    pub fn names(&self) -> &[NameEntry] {
        &self.names
    }

    /// The name `name` (case-insensitive) of exactly `scope`.
    pub fn name(&self, name: &str, scope: NameScope) -> Option<&NameEntry> {
        self.names
            .iter()
            .find(|n| n.scope == scope && same_name(&n.name, name))
    }

    /// The name `name` as a formula on `sheet` sees it (the sheet's own
    /// name first, then the workbook's).
    pub fn resolve_name(&self, name: &str, sheet: SheetId) -> Option<&NameEntry> {
        lookup_name(&self.names, name, sheet)
    }

    fn check_name(&self, name: &str, scope: NameScope) -> Result<(), EngineError> {
        if !is_valid_name(name) {
            return Err(EngineError::InvalidName(name.to_string()));
        }
        if let NameScope::Sheet(id) = scope {
            self.sheet_index(id)?;
        }
        Ok(())
    }

    /// Defines (or redefines) `name` in `scope` as `refers_to` (a formula,
    /// with or without the leading `=`). Every formula using the name –
    /// directly or through other names – is re-registered and
    /// recalculated (deferred inside a batch). Fails for an invalid name,
    /// an unknown sheet scope or a formula that does not parse.
    pub fn set_name(
        &mut self,
        name: &str,
        scope: NameScope,
        refers_to: &str,
    ) -> Result<Recalc, EngineError> {
        self.check_name(name, scope)?;
        let entry = Self::name_entry(name, scope, refers_to)?;
        match self
            .names
            .iter_mut()
            .find(|n| n.scope == scope && same_name(&n.name, name))
        {
            Some(slot) => *slot = entry,
            None => self.names.push(entry),
        }
        Ok(self.names_changed(&[name.to_string()]))
    }

    /// Replaces the name `old` (in `old_scope`) by `name` in `scope`,
    /// keeping its position in the list (the Name Manager's Edit). Fails
    /// with [`EngineError::DuplicateName`] when the new spelling exists
    /// in the new scope (other than the edited name itself).
    pub fn update_name(
        &mut self,
        old: &str,
        old_scope: NameScope,
        name: &str,
        scope: NameScope,
        refers_to: &str,
    ) -> Result<Recalc, EngineError> {
        self.check_name(name, scope)?;
        let pos = self
            .names
            .iter()
            .position(|n| n.scope == old_scope && same_name(&n.name, old))
            .ok_or_else(|| EngineError::UnknownName(old.to_string()))?;
        let clash = self
            .names
            .iter()
            .enumerate()
            .any(|(i, n)| i != pos && n.scope == scope && same_name(&n.name, name));
        if clash {
            return Err(EngineError::DuplicateName(name.to_string()));
        }
        self.names[pos] = Self::name_entry(name, scope, refers_to)?;
        Ok(self.names_changed(&[old.to_string(), name.to_string()]))
    }

    /// Inserts a name at position `index` of the list (undo of a delete);
    /// fails with [`EngineError::DuplicateName`] if it exists.
    pub fn insert_name(
        &mut self,
        index: usize,
        name: &str,
        scope: NameScope,
        refers_to: &str,
    ) -> Result<Recalc, EngineError> {
        self.check_name(name, scope)?;
        if self.name(name, scope).is_some() {
            return Err(EngineError::DuplicateName(name.to_string()));
        }
        let entry = Self::name_entry(name, scope, refers_to)?;
        let at = index.min(self.names.len());
        self.names.insert(at, entry);
        Ok(self.names_changed(&[name.to_string()]))
    }

    /// Deletes a name; formulas using it show `#NAME?`.
    pub fn remove_name(&mut self, name: &str, scope: NameScope) -> Result<Recalc, EngineError> {
        let pos = self
            .names
            .iter()
            .position(|n| n.scope == scope && same_name(&n.name, name))
            .ok_or_else(|| EngineError::UnknownName(name.to_string()))?;
        let removed = self.names.remove(pos);
        Ok(self.names_changed(&[removed.name]))
    }

    /// Replaces every name (undo of edits that rewrote several names);
    /// entries are `(name, scope, formula)` and must be valid.
    pub fn replace_names(
        &mut self,
        names: &[(String, NameScope, String)],
    ) -> Result<Recalc, EngineError> {
        let mut entries = Vec::with_capacity(names.len());
        for (name, scope, formula) in names {
            self.check_name(name, *scope)?;
            entries.push(Self::name_entry(name, *scope, formula)?);
        }
        let mut changed: Vec<String> = self.names.iter().map(|n| n.name.clone()).collect();
        changed.extend(entries.iter().map(|n| n.name.clone()));
        self.names = entries;
        Ok(self.names_changed(&changed))
    }

    fn name_entry(name: &str, scope: NameScope, refers_to: &str) -> Result<NameEntry, EngineError> {
        let body = refers_to.strip_prefix('=').unwrap_or(refers_to).trim();
        let ast = parse_name_formula(body)?;
        Ok(NameEntry {
            name: name.to_string(),
            scope,
            formula: name_formula_text(&ast),
            ast,
        })
    }

    /// The value of a name's definition evaluated at `at` (a range gives
    /// the array of its cells, as the Name Manager shows it).
    pub fn name_value(&self, entry: &NameEntry, at: CellCoord) -> Value {
        let mut ctx = EvalContext::new(self, &self.registry, at);
        ctx.now = self.now;
        let def = name_definition_at(&entry.ast, at);
        evaluate_formula(&def, &ctx)
    }

    /// The range a name refers to as used on `sheet` (`None` unless its
    /// definition is a single reference to an existing sheet).
    pub fn name_range(&self, entry: &NameEntry, sheet: SheetId) -> Option<RangeRef> {
        let Expr::Reference(r) = &entry.ast else {
            return None;
        };
        let ctx = EvalContext::new(self, &self.registry, CellCoord::new(sheet, 0, 0));
        crate::eval::resolve(r, &ctx).ok()
    }

    /// Every formula cell using one of `changed` (directly or through
    /// other names), sorted.
    fn name_users(&self, changed: &[String]) -> Vec<CellCoord> {
        if changed.is_empty() {
            return Vec::new();
        }
        let mut set: HashSet<String> = changed.iter().map(|n| n.to_lowercase()).collect();
        loop {
            let before = set.len();
            for n in &self.names {
                if mentions(&n.ast, &set) {
                    set.insert(n.name.to_lowercase());
                }
            }
            if set.len() == before {
                break;
            }
        }
        let mut out = Vec::new();
        for (i, sheet) in self.sheets.iter().enumerate() {
            for (&(row, col), content) in &sheet.cells {
                if let CellContent::Formula { ast, .. } = content {
                    if mentions(ast, &set) {
                        out.push(CellCoord::new(SheetId(i as u32), row, col));
                    }
                }
            }
        }
        out.sort_unstable();
        out
    }

    /// Re-registers and recalculates the users of the changed names.
    fn names_changed(&mut self, changed: &[String]) -> Recalc {
        let users = self.name_users(changed);
        for &c in &users {
            let Some(CellContent::Formula { ast, .. }) =
                self.sheets[c.sheet.0 as usize].cells.get(&(c.row, c.col))
            else {
                continue;
            };
            register(
                &mut self.graph,
                &mut self.volatile,
                &self.sheets,
                &self.order,
                &self.names,
                &self.tables,
                &self.registry,
                c,
                ast,
            );
        }
        match &mut self.pending {
            Some(pending) => {
                pending.extend(users);
                Recalc::default()
            }
            None => {
                let mut r = self.recalc(&users);
                r.changed.extend(users);
                r.changed.sort_unstable();
                r.changed.dedup();
                r
            }
        }
    }

    /// Rewrites every name's definition with `f(ast, host sheet name)`
    /// (the host is the scope sheet; `""` for workbook names, whose
    /// unqualified references follow no sheet). Returns the changed names.
    fn adjust_names(&mut self, f: &dyn Fn(&Expr, &str) -> Expr) -> Vec<String> {
        let mut changed = Vec::new();
        for i in 0..self.names.len() {
            let host = match self.names[i].scope {
                NameScope::Sheet(id) => self.sheets[id.0 as usize].name.clone(),
                NameScope::Workbook => String::new(),
            };
            let new = f(&self.names[i].ast, &host);
            let n = &mut self.names[i];
            if new != n.ast {
                n.formula = name_formula_text(&new);
                n.ast = new;
                changed.push(n.name.clone());
            }
        }
        changed
    }

    /// What the formula in `c` reads directly (cells and ranges, through
    /// its names; references to unknown sheets are left out), in source
    /// order; empty for a cell without formula. Formula Auditing's
    /// "Trace Precedents".
    pub fn precedents(&self, c: CellCoord) -> Vec<RangeRef> {
        self.graph
            .precedents(c)
            .filter_map(|p| match p {
                Precedent::Cell(x) => Some(RangeRef::new(x.sheet, x.row, x.col, x.row, x.col)),
                Precedent::Range(r) => Some(*r),
                Precedent::Unresolved(_) => None,
            })
            .collect()
    }

    /// A circular reference that `cells` (or their dependents) take part
    /// in, if any – whether a cycle reported by [`Recalc::cycle`] still
    /// exists. Cost: the dependents of `cells`.
    pub fn cycle_through(&self, cells: &[CellCoord]) -> Option<Cycle> {
        self.graph.recalc_schedule(cells).cycle
    }

    /// The formula cells reading `c` directly (sorted). "Trace Dependents".
    pub fn dependents(&self, c: CellCoord) -> Vec<CellCoord> {
        self.graph.direct_dependents(c)
    }

    /// Shared implementation of the row/column insert and delete methods.
    fn structural(&mut self, sheet: SheetId, shift: CellShift) -> Result<Recalc, EngineError> {
        let op = shift.op;
        let band = shift.band;
        let idx = self.sheet_index(sheet)?;
        let (at, count) = op.span();
        let max = u64::from(op.max_index());
        if u64::from(at) > max {
            return Err(EngineError::InvalidCoord);
        }
        if count == 0 {
            return Ok(Recalc::default());
        }
        if op.is_insert() {
            let pushed_off = self.sheets[idx]
                .cells
                .iter()
                .filter(|(_, x)| !matches!(x, CellContent::Spilled { .. }))
                .any(|(&(r, c), _)| shift.map_cell(r, c).is_none());
            if u64::from(at) + u64::from(count) > max + 1 || pushed_off {
                return Err(EngineError::InvalidCoord);
            }
        } else if u64::from(at) + u64::from(count) > max + 1 {
            return Err(EngineError::InvalidCoord);
        }

        // 0. Drop the spills of the sheet; the moved anchors spill again.
        let coord = |s: SheetId, (row, col): (u32, u32)| CellCoord::new(s, row, col);
        let anchors: Vec<(u32, u32)> = self.sheets[idx].arrays.keys().copied().collect();
        let mut freed = Vec::new();
        for &a in &anchors {
            freed.extend(self.clear_spill(coord(sheet, a)));
        }

        // 1. Move contents and cached values on the target sheet.
        let mut vacated = Vec::new();
        let mut moved_to = Vec::new();
        let mut unregister: HashSet<CellCoord> = HashSet::new();
        let mut register_cells: HashSet<CellCoord> = HashSet::new();
        {
            let s = &mut self.sheets[idx];
            let old_cells = std::mem::take(&mut s.cells);
            let mut old_values = std::mem::take(&mut s.values);
            for (pos, content) in old_cells {
                let new_pos = shift.map_cell(pos.0, pos.1);
                let is_formula = matches!(content, CellContent::Formula { .. });
                if new_pos != Some(pos) {
                    vacated.push(coord(sheet, pos));
                    if is_formula {
                        unregister.insert(coord(sheet, pos));
                    }
                }
                let Some(new_pos) = new_pos else {
                    continue;
                };
                if new_pos != pos {
                    moved_to.push(coord(sheet, new_pos));
                    if is_formula {
                        register_cells.insert(coord(sheet, new_pos));
                    }
                }
                if let Some(v) = old_values.remove(&pos) {
                    s.values.insert(new_pos, v);
                }
                s.cells.insert(new_pos, content);
            }
            s.used = s.cells.keys().fold(None, |acc, &(r, c)| match acc {
                None => Some((r, c)),
                Some((mr, mc)) => Some((mr.max(r), mc.max(c))),
            });
            if op.is_rows() && band.is_none() {
                s.hidden_rows = std::mem::take(&mut s.hidden_rows)
                    .into_iter()
                    .filter_map(|(r, h)| op.map_index(r).map(|r| (r, h)))
                    .collect();
            }
        }

        // 2. Rewrite every formula of the workbook.
        let target = self.sheets[idx].name.clone();
        let mut rewritten = Vec::new();
        for (i, s) in self.sheets.iter_mut().enumerate() {
            let ctx = AdjustContext {
                host_sheet: &s.name,
                target_sheet: &target,
                op,
            };
            for (&pos, content) in s.cells.iter_mut() {
                let CellContent::Formula { text, ast } = content else {
                    continue;
                };
                let new = adjust_references_shift(ast, &ctx, band);
                if new != *ast {
                    *text = format!("={new}");
                    *ast = new;
                    let c = coord(SheetId(i as u32), pos);
                    rewritten.push(c);
                    unregister.insert(c);
                    register_cells.insert(c);
                }
            }
        }

        // 3. Re-register the moved and rewritten formulas (all removals
        //    first: a new position may be another formula's old one).
        for c in &unregister {
            self.graph.remove_formula(*c);
            self.volatile.remove(c);
        }
        // Names on the edited sheet follow the edit; formulas using a
        // changed name get new edges.
        let changed_names = self.adjust_names(&|ast: &Expr, host: &str| {
            adjust_references_shift(
                ast,
                &AdjustContext {
                    host_sheet: host,
                    target_sheet: &target,
                    op,
                },
                band,
            )
        });
        let users = self.name_users(&changed_names);
        rewritten.extend(users.iter().copied());
        register_cells.extend(users);
        for &c in &register_cells {
            let Some(CellContent::Formula { ast, .. }) =
                self.sheets[c.sheet.0 as usize].cells.get(&(c.row, c.col))
            else {
                continue;
            };
            register(
                &mut self.graph,
                &mut self.volatile,
                &self.sheets,
                &self.order,
                &self.names,
                &self.tables,
                &self.registry,
                c,
                ast,
            );
        }

        // 4. Recalculate from every coordinate whose content changed.
        let mut seeds = vacated;
        seeds.extend_from_slice(&moved_to);
        seeds.extend(rewritten);
        seeds.extend(freed);
        seeds.extend(
            anchors
                .iter()
                .filter_map(|&(r, c)| shift.map_cell(r, c))
                .map(|p| coord(sheet, p)),
        );
        let mut changed = moved_to;
        let mut cycle = None;
        match &mut self.pending {
            Some(pending) => pending.extend(seeds.iter().copied()),
            None => {
                let r = self.recalc(&seeds);
                changed.extend(r.changed);
                cycle = r.cycle;
            }
        }
        changed.extend(seeds);
        changed.sort_unstable();
        changed.dedup();
        Ok(Recalc { changed, cycle })
    }

    fn sheet_index(&self, id: SheetId) -> Result<usize, EngineError> {
        let idx = id.0 as usize;
        if self.sheets.get(idx).is_some_and(|s| !s.removed) {
            Ok(idx)
        } else {
            Err(EngineError::UnknownSheet(id))
        }
    }

    fn check(&self, c: CellCoord) -> Result<usize, EngineError> {
        let idx = self.sheet_index(c.sheet)?;
        if c.row > MAX_ROW || c.col > MAX_COL {
            return Err(EngineError::InvalidCoord);
        }
        Ok(idx)
    }

    /// Re-registers the formulas holding a 3-D reference (their span may
    /// have changed with the sheet order); returns them.
    fn reregister_3d(&mut self) -> Vec<CellCoord> {
        let mut cells = Vec::new();
        for (i, sheet) in self.sheets.iter().enumerate() {
            for (&(row, col), content) in &sheet.cells {
                if let CellContent::Formula { ast, .. } = content {
                    if uses_3d(ast) {
                        cells.push(CellCoord::new(SheetId(i as u32), row, col));
                    }
                }
            }
        }
        for &c in &cells {
            let Some(CellContent::Formula { ast, .. }) =
                self.sheets[c.sheet.0 as usize].cells.get(&(c.row, c.col))
            else {
                continue;
            };
            register(
                &mut self.graph,
                &mut self.volatile,
                &self.sheets,
                &self.order,
                &self.names,
                &self.tables,
                &self.registry,
                c,
                ast,
            );
        }
        cells
    }

    /// [`reregister_3d`](Self::reregister_3d) and recalculates the cells
    /// (deferred inside a batch).
    fn refresh_3d(&mut self) {
        let cells = self.reregister_3d();
        if cells.is_empty() {
            return;
        }
        match &mut self.pending {
            Some(pending) => pending.extend(cells),
            None => {
                self.recalc(&cells);
            }
        }
    }

    /// Re-registers formulas holding an unresolved reference to `name` and
    /// recalculates them (unless a batch is open).
    fn reresolve(&mut self, name: &str) {
        let mut cells = Vec::new();
        for (i, sheet) in self.sheets.iter().enumerate() {
            for (&(row, col), content) in &sheet.cells {
                let CellContent::Formula { ast, .. } = content else {
                    continue;
                };
                let c = CellCoord::new(SheetId(i as u32), row, col);
                let unresolved = self
                    .graph
                    .precedents(c)
                    .any(|p| matches!(p, Precedent::Unresolved(n) if same_name(n, name)));
                if unresolved {
                    register(
                        &mut self.graph,
                        &mut self.volatile,
                        &self.sheets,
                        &self.order,
                        &self.names,
                        &self.tables,
                        &self.registry,
                        c,
                        ast,
                    );
                    cells.push(c);
                }
            }
        }
        if cells.is_empty() {
            return;
        }
        match &mut self.pending {
            Some(pending) => pending.extend(cells),
            None => {
                self.recalc(&cells);
            }
        }
    }

    /// Recalculates `seeds`, their dependents and the volatile cells.
    fn recalc(&mut self, seeds: &[CellCoord]) -> Recalc {
        let mut changed: Vec<CellCoord> = seeds.to_vec();
        changed.extend(self.volatile.iter().copied());
        let schedule = self.graph.recalc_schedule(&changed);
        self.run(schedule)
    }

    fn run(&mut self, schedule: crate::graph::Schedule) -> Recalc {
        let mut changed = std::mem::take(&mut self.freed);
        let mut cycle = schedule.cycle.clone();
        let mut followups = Vec::new();
        // Cells found on a cycle stay `#NUM!` for the whole run (a spill
        // read by its own anchor is a cycle only while it spills).
        let mut cyclic = schedule.cyclic.clone();
        let mut pass = self.eval_schedule(&schedule, &cyclic, &mut changed, &mut followups);
        let mut volatile_rounds = 0;
        for _ in 0..MAX_SPILL_PASSES {
            // Spill ranges that grew (their new cells' readers were not
            // scheduled) and cells freed by a spill (arrays blocked by them
            // may fit now).
            if !followups.is_empty() {
                let seeds = std::mem::take(&mut followups);
                let again = self.graph.recalc_schedule(&seeds);
                if cycle.is_none() {
                    cycle = again.cycle.clone();
                }
                cyclic.extend(again.cyclic.iter().copied());
                pass = self.eval_schedule(&again, &cyclic, &mut changed, &mut followups);
                continue;
            }
            // Volatile cells that read other cells dynamically (`INDIRECT`,
            // `OFFSET`) have no dependency edges to them, so the schedule
            // may have evaluated them before a cell they read was
            // recalculated. While a cell changed after the first volatile
            // cell was evaluated, evaluate the volatile cells and their
            // dependents again (at most three times).
            let (Some(first_volatile), Some(last_change)) = pass else {
                break;
            };
            if last_change <= first_volatile || volatile_rounds == 3 {
                break;
            }
            volatile_rounds += 1;
            let seeds: Vec<CellCoord> = self.volatile.iter().copied().collect();
            let again = self.graph.recalc_schedule(&seeds);
            cyclic.extend(again.cyclic.iter().copied());
            pass = self.eval_schedule(&again, &cyclic, &mut changed, &mut followups);
        }
        changed.sort_unstable();
        changed.dedup();
        Recalc { changed, cycle }
    }

    /// Evaluates the cells of `schedule` in order, appending the cells
    /// whose value changed to `changed`. Returns the position of the first
    /// volatile cell and of the last changed cell within the schedule.
    fn eval_schedule(
        &mut self,
        schedule: &crate::graph::Schedule,
        cyclic: &HashSet<CellCoord>,
        changed: &mut Vec<CellCoord>,
        followups: &mut Vec<CellCoord>,
    ) -> (Option<usize>, Option<usize>) {
        let (mut first_volatile, mut last_change) = (None, None);
        for (i, &c) in schedule.order.iter().enumerate() {
            let result = if cyclic.contains(&c) {
                Value::Number(0.0)
            } else {
                let CellContent::Formula { ast, .. } = self.content(c) else {
                    continue;
                };
                let mut ctx = EvalContext::new(self, &self.registry, c);
                ctx.now = self.now;
                evaluate_formula(ast, &ctx)
            };
            let new = self.store_result(c, result, changed, followups);
            if first_volatile.is_none() && self.volatile.contains(&c) {
                first_volatile = Some(i);
            }
            let values = &mut self.sheets[c.sheet.0 as usize].values;
            let old = values.insert((c.row, c.col), new.clone());
            if !old.is_some_and(|o| same_value(&o, &new)) {
                changed.push(c);
                last_change = Some(i);
            }
        }
        (first_volatile, last_change)
    }

    /// Spills an array result of the formula in `c` (or removes its old
    /// spill for a scalar result) and returns the anchor's own value.
    /// Spilled cells whose value changed and freed cells go to `changed`;
    /// cells whose readers must be (re-)evaluated go to `followups`.
    fn store_result(
        &mut self,
        c: CellCoord,
        result: Value,
        changed: &mut Vec<CellCoord>,
        followups: &mut Vec<CellCoord>,
    ) -> Value {
        let idx = c.sheet.0 as usize;
        let key = (c.row, c.col);
        let old = self.sheets[idx].arrays.get(&key).copied();
        let Value::Array(a) = result else {
            if old.is_some() {
                let freed = self.clear_spill(c);
                self.freed.clear();
                followups.extend(self.sheets[idx].blocked_over(&freed));
                followups.extend_from_slice(&freed);
                changed.extend(freed);
            }
            return result;
        };
        let rows = u32::try_from(a.rows()).unwrap_or(u32::MAX);
        let cols = u32::try_from(a.cols()).unwrap_or(u32::MAX);
        let fits = u64::from(c.row) + u64::from(rows) <= u64::from(MAX_ROW) + 1
            && u64::from(c.col) + u64::from(cols) <= u64::from(MAX_COL) + 1;
        let sheet = &mut self.sheets[idx];
        let blocked = !fits || sheet.obstructed(c, rows, cols);
        let keep = (!blocked).then_some((rows, cols));
        let freed = match old {
            Some(o) if !o.blocked => sheet.free_spill(c, o.rows, o.cols, keep),
            _ => Vec::new(),
        };
        followups.extend(sheet.blocked_over(&freed));
        followups.extend_from_slice(&freed);
        changed.extend(freed);
        sheet.arrays.insert(
            key,
            Spill {
                rows,
                cols,
                blocked,
            },
        );
        if blocked {
            self.graph.set_spill(c, None);
            return Value::Error(ErrorKind::Spill);
        }
        for (i, v) in a.values().iter().enumerate().skip(1) {
            let (r, col) = ((i / a.cols()) as u32, (i % a.cols()) as u32);
            let pos = (c.row + r, c.col + col);
            let at = CellCoord::new(c.sheet, pos.0, pos.1);
            let newly = !matches!(sheet.cells.get(&pos), Some(CellContent::Spilled { .. }));
            if newly {
                sheet.cells.insert(pos, CellContent::Spilled { anchor: c });
                // Readers of a newly covered cell were not scheduled.
                followups.push(at);
            }
            let old_value = sheet.values.insert(pos, v.clone());
            if newly || !old_value.is_some_and(|o| same_value(&o, v)) {
                changed.push(at);
            }
        }
        sheet.grow_used(c.row + rows - 1, c.col + cols - 1);
        self.graph.set_spill(
            c,
            Some(RangeRef::new(
                c.sheet,
                c.row,
                c.col,
                c.row + rows - 1,
                c.col + cols - 1,
            )),
        );
        a.top_left()
    }
}

impl CellProvider for Engine {
    fn sheet_id(&self, name: &str) -> Option<SheetId> {
        find_sheet(&self.sheets, name)
    }

    fn value(&self, c: CellCoord) -> Value {
        Engine::value(self, c)
    }

    fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
        Engine::used_range(self, sheet)
    }

    fn row_hidden(&self, sheet: SheetId, row: u32) -> RowHidden {
        Engine::row_hidden(self, sheet, row)
    }

    fn is_subtotal_cell(&self, c: CellCoord) -> bool {
        matches!(self.content(c), CellContent::Formula { ast, .. } if reads_row_visibility(ast, &self.registry))
    }

    fn defined_name(&self, name: &str, sheet: SheetId) -> Option<&Expr> {
        lookup_name(&self.names, name, sheet).map(|n| &n.ast)
    }

    fn structured_ref(&self, s: &StructRef, at: CellCoord) -> Option<Result<RangeRef, ErrorKind>> {
        crate::structured::table_for(&self.tables, s, at).map(|t| t.resolve(s, at))
    }

    fn pivot_data(
        &self,
        at: CellCoord,
        data_field: &str,
        pairs: &[(String, Value)],
    ) -> Option<Value> {
        crate::pivot::find_pivot_value(Engine::pivot_data(self, at.sheet), at, data_field, pairs)
    }

    fn sheet_span(&self, first: &str, last: &str) -> Option<Vec<String>> {
        span_names(&self.sheets, &self.order, first, last)
    }

    fn spill_extent(&self, c: CellCoord) -> Option<(u32, u32)> {
        match self.content(c) {
            CellContent::Formula { .. } => match self.spill(c) {
                Some(s) if s.blocked => None,
                Some(s) => Some((s.rows, s.cols)),
                None => Some((1, 1)),
            },
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(input: &str) -> CellContent {
        parse_input(input).unwrap()
    }

    fn val(x: Value) -> CellContent {
        CellContent::Value(x)
    }

    #[test]
    fn row_visibility_recalculates_subtotals() {
        let mut e = Engine::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        for r in 0..4 {
            e.set_input(c(r, 0), &(r + 1).to_string()).unwrap();
        }
        e.set_input(c(5, 0), "=SUBTOTAL(9,A1:A4)").unwrap();
        e.set_input(c(5, 1), "=SUBTOTAL(109,A1:A4)").unwrap();
        e.set_input(c(5, 2), "=SUM(A1:A4)").unwrap();
        let recalc = e.set_row_hidden(s, 1, RowHidden::Manual).unwrap();
        assert_eq!(recalc.changed, vec![c(5, 1)]);
        assert_eq!(e.value(c(5, 0)), Value::Number(10.0));
        assert_eq!(e.value(c(5, 1)), Value::Number(8.0));
        // Unchanged state: nothing to do.
        assert!(e
            .set_row_hidden(s, 1, RowHidden::Manual)
            .unwrap()
            .changed
            .is_empty());
        e.begin_batch();
        e.set_row_hidden(s, 2, RowHidden::Filtered).unwrap();
        let recalc = e.end_batch();
        assert_eq!(recalc.changed, vec![c(5, 0), c(5, 1)]);
        assert_eq!(e.value(c(5, 0)), Value::Number(7.0));
        // Hidden rows move with inserts and deletes, and are copied.
        e.insert_rows(s, 0, 1).unwrap();
        assert_eq!(e.row_hidden(s, 2), RowHidden::Manual);
        assert_eq!(e.row_hidden(s, 3), RowHidden::Filtered);
        assert_eq!(e.row_hidden(s, 1), RowHidden::Visible);
        assert_eq!(e.value(c(6, 1)), Value::Number(5.0));
        let (copy, _) = e.duplicate_sheet(s, "Copy").unwrap();
        assert_eq!(e.row_hidden(copy, 3), RowHidden::Filtered);
        e.delete_rows(s, 2, 1).unwrap();
        assert_eq!(e.row_hidden(s, 2), RowHidden::Filtered);
        assert_eq!(e.value(c(5, 1)), Value::Number(5.0));
        assert!(e.is_subtotal_cell(c(5, 1)));
        assert!(!e.is_subtotal_cell(c(5, 2)));
        assert!(e.set_row_hidden(s, MAX_ROW + 1, RowHidden::Manual).is_err());
    }

    #[test]
    fn input_rules() {
        assert_eq!(v(""), CellContent::Empty);
        assert_eq!(v("TRUE"), val(Value::Bool(true)));
        assert_eq!(v("fAlSe"), val(Value::Bool(false)));
        assert_eq!(v("12"), val(Value::Number(12.0)));
        assert_eq!(v("-1.5e3"), val(Value::Number(-1500.0)));
        assert_eq!(v("50%"), val(Value::Number(0.5)));
        assert_eq!(v(" 12"), val(Value::Text(" 12".into())));
        assert_eq!(v("#div/0!"), val(Value::Error(ErrorKind::Div0)));
        assert_eq!(v("'=1"), val(Value::Text("=1".into())));
        assert_eq!(v("'"), val(Value::Text(String::new())));
        assert_eq!(v("abc"), val(Value::Text("abc".into())));
        assert!(parse_input("=").is_err());
        assert!(matches!(v("=1"), CellContent::Formula { text, .. } if text == "=1"));
    }

    #[test]
    fn volatile_detection() {
        let p = |s: &str| is_volatile(&parse(s).unwrap(), &FunctionRegistry::with_builtins());
        assert!(p("=today()"));
        assert!(p("=1+IF(TRUE,{1},NOW())"));
        assert!(!p("=SUM(A1:A3)"));
        assert!(p("=RAND()"));
        assert!(p("=SUM(INDIRECT(\"A1\"))"));
        assert!(p("=OFFSET(A1,1,1)"));
        assert!(!p("=ROW(A1)"));
    }

    #[test]
    fn renames_sheet_prefixes_in_ast() {
        let mut e = parse("=SUM(data!A1:A2,Other!B1)+'Data'!C1").unwrap();
        assert!(rename_refs(&mut e, "DATA", "Facts"));
        assert_eq!(e.to_string(), "SUM(Facts!A1:A2,Other!B1)+Facts!C1");
        assert!(!rename_refs(&mut e, "Data", "X"));
    }

    #[test]
    fn rename_sheet_rewrites_formula_text() {
        // P8-39 (C-18): the text follows the AST, so the formula bar, copies
        // and the saved file name the new sheet.
        let mut e = Engine::new();
        let other = e.add_sheet("Sheet2").unwrap();
        let a1 = CellCoord::new(SheetId(0), 0, 0);
        e.set_input(CellCoord::new(other, 0, 0), "42").unwrap();
        e.set_input(a1, "=Sheet2!A1+1").unwrap();
        e.set_input(CellCoord::new(SheetId(0), 1, 0), "=A1")
            .unwrap();
        assert_eq!(e.rename_sheet(other, "Data 2").unwrap(), vec![a1]);
        assert_eq!(e.formula_text(a1), Some("='Data 2'!A1+1"));
        assert_eq!(e.value(a1), Value::Number(43.0));
        assert_eq!(e.rename_sheet(other, "Data 2").unwrap(), vec![]);
    }

    #[test]
    fn used_range_grows_and_shrinks() {
        let mut e = Engine::new();
        let s = SheetId(0);
        assert_eq!(e.used_range(s), None);
        e.set_input(CellCoord::new(s, 4, 1), "x").unwrap();
        e.set_input(CellCoord::new(s, 2, 7), "=1").unwrap();
        assert_eq!(e.used_range(s), Some((4, 7)));
        e.clear(CellCoord::new(s, 2, 7)).unwrap();
        assert_eq!(e.used_range(s), Some((4, 1)));
        e.clear(CellCoord::new(s, 4, 1)).unwrap();
        assert_eq!(e.used_range(s), None);
    }

    #[test]
    fn invalid_targets() {
        let mut e = Engine::new();
        assert_eq!(
            e.set_input(CellCoord::new(SheetId(3), 0, 0), "1"),
            Err(EngineError::UnknownSheet(SheetId(3)))
        );
        assert_eq!(
            e.set_input(CellCoord::new(SheetId(0), MAX_ROW + 1, 0), "1"),
            Err(EngineError::InvalidCoord)
        );
        assert_eq!(
            e.add_sheet("sheet1"),
            Err(EngineError::DuplicateSheet("sheet1".into()))
        );
        assert_eq!(
            e.rename_sheet(SheetId(9), "x"),
            Err(EngineError::UnknownSheet(SheetId(9)))
        );
    }

    fn names(e: &Engine) -> Vec<&str> {
        e.sheets().map(|(_, n)| n).collect()
    }

    #[test]
    fn removing_a_sheet_turns_references_into_ref_errors() {
        let mut e = Engine::new();
        let s1 = SheetId(0);
        let data = e.add_sheet("Data").unwrap();
        let c = |s, r, col| CellCoord::new(s, r, col);
        e.set_input(c(data, 0, 0), "10").unwrap();
        e.set_input(c(s1, 2, 0), "5").unwrap();
        e.set_input(c(data, 0, 1), "=A1+Sheet1!A3").unwrap();
        e.set_input(c(s1, 0, 0), "=data!A1*2").unwrap();
        e.set_input(c(s1, 1, 0), "=SUM('Data'!A1:A3)+A3").unwrap();
        e.set_input(c(s1, 3, 0), "=IFERROR(Data!A1,0)+NOW()*0")
            .unwrap();
        assert_eq!(e.value(c(s1, 0, 0)), Value::Number(20.0));

        let r = e.remove_sheet(data).unwrap();
        assert_eq!(r.changed, vec![c(s1, 0, 0), c(s1, 1, 0), c(s1, 3, 0)]);
        assert_eq!(e.formula_text(c(s1, 0, 0)), Some("=#REF!*2"));
        assert_eq!(e.formula_text(c(s1, 1, 0)), Some("=SUM(#REF!)+A3"));
        assert_eq!(e.value(c(s1, 0, 0)), Value::Error(ErrorKind::Ref));
        assert_eq!(e.value(c(s1, 1, 0)), Value::Error(ErrorKind::Ref));
        assert_eq!(e.value(c(s1, 3, 0)), Value::Number(0.0));
        assert_eq!(names(&e), ["Sheet1"]);
        assert_eq!(e.sheet_id("Data"), None);
        assert_eq!(e.sheet_name(data), None);
        assert_eq!(e.content(c(data, 0, 0)), &CellContent::Empty);
        assert_eq!(e.used_range(data), None);
        assert_eq!(
            e.set_input(c(data, 0, 0), "1"),
            Err(EngineError::UnknownSheet(data))
        );
        // Editing the cell the removed formula read: no stale edges.
        e.set_input(c(s1, 2, 0), "6").unwrap();
        // A new sheet of the same name gets a fresh id and revives nothing.
        let again = e.add_sheet("Data").unwrap();
        assert_eq!(again, SheetId(2));
        e.set_input(c(again, 0, 0), "1").unwrap();
        assert_eq!(e.value(c(s1, 0, 0)), Value::Error(ErrorKind::Ref));
        e.remove_sheet(again).unwrap();
        assert_eq!(e.remove_sheet(s1), Err(EngineError::LastSheet));
        assert_eq!(e.remove_sheet(data), Err(EngineError::UnknownSheet(data)));
    }

    #[test]
    fn remove_inside_a_batch_defers_recalc() {
        let mut e = Engine::new();
        let b = e.add_sheet("B").unwrap();
        let a1 = CellCoord::new(SheetId(0), 0, 0);
        e.set_input(CellCoord::new(b, 0, 0), "3").unwrap();
        e.set_input(a1, "=B!A1").unwrap();
        e.begin_batch();
        assert_eq!(e.remove_sheet(b).unwrap().changed, vec![a1]);
        assert_eq!(e.end_batch().changed, vec![a1]);
        assert_eq!(e.value(a1), Value::Error(ErrorKind::Ref));
    }

    #[test]
    fn restore_and_move_keep_ids() {
        let mut e = Engine::new();
        let b = e.add_sheet("B").unwrap();
        let c = e.add_sheet("C").unwrap();
        let a1 = CellCoord::new(SheetId(0), 0, 0);
        e.set_input(a1, "=D!A1").unwrap(); // unknown sheet: #REF! for now
        e.move_sheet(c, 0).unwrap();
        assert_eq!(names(&e), ["C", "Sheet1", "B"]);
        assert_eq!(e.sheet_position(b), Some(2));
        assert_eq!(e.move_sheet(c, 3), Err(EngineError::InvalidSheetIndex(3)));
        e.remove_sheet(b).unwrap();
        assert_eq!(e.sheet_position(b), None);
        assert_eq!(
            e.restore_sheet(c, "X", 0),
            Err(EngineError::UnknownSheet(c))
        );
        assert_eq!(
            e.restore_sheet(b, "c", 0),
            Err(EngineError::DuplicateSheet("c".into()))
        );
        assert_eq!(
            e.restore_sheet(b, "B", 3),
            Err(EngineError::InvalidSheetIndex(3))
        );
        e.restore_sheet(b, "D", 1).unwrap();
        assert_eq!(names(&e), ["C", "D", "Sheet1"]);
        assert_eq!(e.sheet_id("d"), Some(b));
        e.set_input(CellCoord::new(b, 0, 0), "7").unwrap();
        assert_eq!(e.value(a1), Value::Number(7.0));
    }

    #[test]
    fn duplicate_copies_contents_and_keeps_self_references_local() {
        let mut e = Engine::new();
        let s1 = SheetId(0);
        let other = e.add_sheet("Other").unwrap();
        let c = |s, r, col| CellCoord::new(s, r, col);
        e.set_input(c(other, 0, 0), "100").unwrap();
        e.set_input(c(s1, 0, 0), "2").unwrap();
        e.set_input(c(s1, 0, 1), "=A1*Sheet1!A1").unwrap();
        e.set_input(c(s1, 0, 2), "=Other!A1+B1").unwrap();
        e.set_input(c(s1, 0, 3), "text").unwrap();
        let (copy, _) = e.duplicate_sheet(s1, "Sheet1 (2)").unwrap();
        assert_eq!(names(&e), ["Sheet1", "Sheet1 (2)", "Other"]);
        assert_eq!(e.formula_text(c(copy, 0, 1)), Some("=A1*'Sheet1 (2)'!A1"));
        assert_eq!(e.formula_text(c(copy, 0, 2)), Some("=Other!A1+B1"));
        assert_eq!(e.value(c(copy, 0, 2)), Value::Number(104.0));
        assert_eq!(e.value(c(copy, 0, 3)), Value::Text("text".into()));
        // The copy is independent of its source.
        let r = e.set_input(c(copy, 0, 0), "3").unwrap();
        assert_eq!(r.changed, vec![c(copy, 0, 1), c(copy, 0, 2)]);
        assert_eq!(e.value(c(s1, 0, 2)), Value::Number(104.0));
        assert_eq!(e.value(c(copy, 0, 2)), Value::Number(109.0));
        assert_eq!(
            e.duplicate_sheet(s1, "other"),
            Err(EngineError::DuplicateSheet("other".into()))
        );
    }
}
