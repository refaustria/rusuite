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
//! every volatile cell (formulas calling `NOW` or `TODAY`), in dependency
//! order. [`Recalc::changed`] lists the re-evaluated formula cells whose
//! value actually changed; the edited cell itself appears there only when
//! it holds a formula (callers know that they changed a constant).
//!
//! Between [`Engine::begin_batch`] and [`Engine::end_batch`] edits only
//! update storage and the graph; the deferred recalculation runs once in
//! `end_batch`. Use it for bulk loads (or load, then [`Engine::recalc_all`]).
//!
//! # Circular references
//!
//! Excel shows 0 plus a warning for a circular reference; the error set
//! of the AST is fixed, so the engine uses `#NUM!` instead: every cell on
//! a cycle gets `Value::Error(ErrorKind::Num)` and [`Recalc::cycle`]
//! carries the cycle so the UI can warn. Cells outside the cycle are still
//! recalculated (dependents of a cycle see the `#NUM!`).
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
//! # Sheet order and removal
//!
//! [`Engine::sheets`] lists the sheets in display order, which
//! [`Engine::move_sheet`] changes without touching ids.
//! [`Engine::remove_sheet`] deletes a sheet as Excel does: every reference
//! to it in the remaining formulas becomes `#REF!` (text and AST), so a
//! later sheet of the same name does not revive them. The removed id stays
//! reserved: [`Engine::add_sheet`] never hands it out again, and only
//! [`Engine::restore_sheet`] (undo) brings it back.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::ast::{ErrorKind, Expr, MAX_COL, MAX_ROW};
use crate::eval::{default_now, evaluate, CellCoord, CellProvider, EvalContext, SheetId};
use crate::functions::FunctionRegistry;
use crate::graph::{Cycle, DependencyGraph, Precedent, SheetResolver};
use crate::parser::{parse, ParseError};
use crate::transform::{adjust_references, AdjustContext, StructuralOp};
use crate::value::{parse_number_text, Value};

/// Functions whose result can change without any input changing; cells
/// calling them are re-evaluated on every recalculation.
const VOLATILE_FUNCTIONS: [&str; 2] = ["NOW", "TODAY"];

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
}

/// Result of an edit or recalculation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Recalc {
    /// Re-evaluated formula cells whose value changed, sorted.
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

fn is_volatile(e: &Expr) -> bool {
    match e {
        Expr::Call { name, args } => {
            VOLATILE_FUNCTIONS
                .iter()
                .any(|v| v.eq_ignore_ascii_case(name))
                || args.iter().any(is_volatile)
        }
        Expr::Unary { expr, .. } => is_volatile(expr),
        Expr::Binary { lhs, rhs, .. } => is_volatile(lhs) || is_volatile(rhs),
        Expr::Array(rows) => rows.iter().flatten().any(is_volatile),
        _ => false,
    }
}

/// Replaces the sheet prefix `from` (case-insensitive) by `to` in every
/// reference of `e`; returns whether anything changed.
fn rename_refs(e: &mut Expr, from: &str, to: &str) -> bool {
    match e {
        Expr::Reference(r) => match &mut r.sheet {
            Some(s) if same_name(s, from) => {
                *s = to.to_string();
                true
            }
            _ => false,
        },
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
/// by `#REF!`; returns whether anything changed.
fn drop_sheet_refs(e: &mut Expr, name: &str) -> bool {
    if let Expr::Reference(r) = e {
        let hit = r.sheet.as_deref().is_some_and(|s| same_name(s, name));
        if hit {
            *e = Expr::Error(ErrorKind::Ref);
        }
        return hit;
    }
    match e {
        Expr::Call { args, .. } => args
            .iter_mut()
            .fold(false, |acc, a| drop_sheet_refs(a, name) | acc),
        Expr::Unary { expr, .. } => drop_sheet_refs(expr, name),
        Expr::Binary { lhs, rhs, .. } => drop_sheet_refs(lhs, name) | drop_sheet_refs(rhs, name),
        Expr::Array(rows) => rows
            .iter_mut()
            .flatten()
            .fold(false, |acc, a| drop_sheet_refs(a, name) | acc),
        _ => false,
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

/// Interprets user input the way a spreadsheet cell editor does.
fn parse_input(input: &str) -> Result<CellContent, ParseError> {
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
        match parse_number_text(input) {
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
        let mut rewritten = Vec::new();
        for (i, s) in self.sheets.iter_mut().enumerate() {
            if i == idx || s.removed {
                continue;
            }
            for (&(row, col), content) in s.cells.iter_mut() {
                let CellContent::Formula { text, ast } = content else {
                    continue;
                };
                if drop_sheet_refs(ast, &name) {
                    *text = format!("={ast}");
                    rewritten.push(CellCoord::new(SheetId(i as u32), row, col));
                }
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
            self.graph
                .set_formula(c, ast, &Names(&self.sheets), c.sheet);
            if is_volatile(ast) {
                self.volatile.insert(c);
            } else {
                self.volatile.remove(&c);
            }
        }
        // 3. Tombstone.
        let s = &mut self.sheets[idx];
        s.cells.clear();
        s.values.clear();
        s.used = None;
        s.removed = true;
        self.order.retain(|&o| o != id);
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
            .map(|(&pos, content)| (pos, content.clone()))
            .collect();
        cells.sort_unstable_by_key(|(pos, _)| *pos);
        let new = self.add_sheet(name)?;
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

    /// Renames a sheet. Formulas referencing it keep working (their ASTs are
    /// updated; their text is not); formulas referencing `new_name` while
    /// no such sheet existed are re-resolved and recalculated.
    pub fn rename_sheet(&mut self, id: SheetId, new_name: &str) -> Result<(), EngineError> {
        let idx = self.sheet_index(id)?;
        if let Some(other) = find_sheet(&self.sheets, new_name) {
            if other != id {
                return Err(EngineError::DuplicateSheet(new_name.to_string()));
            }
        }
        let old = std::mem::replace(&mut self.sheets[idx].name, new_name.to_string());
        if !same_name(&old, new_name) {
            for sheet in &mut self.sheets {
                for content in sheet.cells.values_mut() {
                    if let CellContent::Formula { ast, .. } = content {
                        rename_refs(ast, &old, new_name);
                    }
                }
            }
            self.reresolve(new_name);
        }
        Ok(())
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

    /// Stores `content` in `c` and recalculates. `Value(Empty)` is stored
    /// as `Empty`, `Value(Array)` as its top-left element.
    pub fn set_content(
        &mut self,
        c: CellCoord,
        content: CellContent,
    ) -> Result<Recalc, EngineError> {
        let idx = self.check(c)?;
        let content = match content {
            CellContent::Value(Value::Empty) => CellContent::Empty,
            CellContent::Value(v @ Value::Array(_)) => match v.into_scalar() {
                Value::Empty => CellContent::Empty,
                v => CellContent::Value(v),
            },
            CellContent::Value(Value::Number(n)) => CellContent::Value(Value::number(n)),
            other => other,
        };
        match &content {
            CellContent::Formula { ast, .. } => {
                self.graph
                    .set_formula(c, ast, &Names(&self.sheets), c.sheet);
                if is_volatile(ast) {
                    self.volatile.insert(c);
                } else {
                    self.volatile.remove(&c);
                }
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
        if let Some(pending) = &mut self.pending {
            pending.push(c);
            return Ok(Recalc::default());
        }
        Ok(self.recalc(&[c]))
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
    /// `Empty`, formulas their last computed result (`#NUM!` on a cycle).
    pub fn value(&self, c: CellCoord) -> Value {
        let Some(sheet) = self.sheets.get(c.sheet.0 as usize) else {
            return Value::Empty;
        };
        match sheet.cells.get(&(c.row, c.col)) {
            None | Some(CellContent::Empty) => Value::Empty,
            Some(CellContent::Value(v)) => v.clone(),
            Some(CellContent::Formula { .. }) => sheet
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
        let pending = self.pending.take().unwrap_or_default();
        self.recalc(&pending)
    }

    /// All non-empty contents of `sheet`, in no particular order (empty for
    /// an unknown sheet).
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
    /// rewritten with [`adjust_references`] (its text regenerated from the
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
        self.structural(sheet, StructuralOp::InsertRows { at, count })
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
        self.structural(sheet, StructuralOp::DeleteRows { at, count })
    }

    /// Inserts `count` empty columns before column `at`. See
    /// [`insert_rows`](Self::insert_rows).
    pub fn insert_cols(
        &mut self,
        sheet: SheetId,
        at: u32,
        count: u32,
    ) -> Result<Recalc, EngineError> {
        self.structural(sheet, StructuralOp::InsertCols { at, count })
    }

    /// Deletes columns `at..at + count`. See
    /// [`delete_rows`](Self::delete_rows).
    pub fn delete_cols(
        &mut self,
        sheet: SheetId,
        at: u32,
        count: u32,
    ) -> Result<Recalc, EngineError> {
        self.structural(sheet, StructuralOp::DeleteCols { at, count })
    }

    /// Shared implementation of the row/column insert and delete methods.
    fn structural(&mut self, sheet: SheetId, op: StructuralOp) -> Result<Recalc, EngineError> {
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
                .keys()
                .any(|&(r, c)| op.map_cell(r, c).is_none());
            if u64::from(at) + u64::from(count) > max + 1 || pushed_off {
                return Err(EngineError::InvalidCoord);
            }
        } else if u64::from(at) + u64::from(count) > max + 1 {
            return Err(EngineError::InvalidCoord);
        }

        // 1. Move contents and cached values on the target sheet.
        let coord = |s: SheetId, (row, col): (u32, u32)| CellCoord::new(s, row, col);
        let mut vacated = Vec::new();
        let mut moved_to = Vec::new();
        let mut unregister: HashSet<CellCoord> = HashSet::new();
        let mut register: HashSet<CellCoord> = HashSet::new();
        {
            let s = &mut self.sheets[idx];
            let old_cells = std::mem::take(&mut s.cells);
            let mut old_values = std::mem::take(&mut s.values);
            for (pos, content) in old_cells {
                let new_pos = op.map_cell(pos.0, pos.1);
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
                        register.insert(coord(sheet, new_pos));
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
                let new = adjust_references(ast, &ctx);
                if new != *ast {
                    *text = format!("={new}");
                    *ast = new;
                    let c = coord(SheetId(i as u32), pos);
                    rewritten.push(c);
                    unregister.insert(c);
                    register.insert(c);
                }
            }
        }

        // 3. Re-register the moved and rewritten formulas (all removals
        //    first: a new position may be another formula's old one).
        for c in &unregister {
            self.graph.remove_formula(*c);
            self.volatile.remove(c);
        }
        for &c in &register {
            let Some(CellContent::Formula { ast, .. }) =
                self.sheets[c.sheet.0 as usize].cells.get(&(c.row, c.col))
            else {
                continue;
            };
            self.graph
                .set_formula(c, ast, &Names(&self.sheets), c.sheet);
            if is_volatile(ast) {
                self.volatile.insert(c);
            }
        }

        // 4. Recalculate from every coordinate whose content changed.
        let mut seeds = vacated;
        seeds.extend_from_slice(&moved_to);
        seeds.extend(rewritten);
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
                    self.graph
                        .set_formula(c, ast, &Names(&self.sheets), c.sheet);
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
        let mut changed = Vec::new();
        for c in schedule.order {
            let new = if schedule.cyclic.contains(&c) {
                Value::Error(ErrorKind::Num)
            } else {
                let CellContent::Formula { ast, .. } = self.content(c) else {
                    continue;
                };
                let mut ctx = EvalContext::new(self, &self.registry, c);
                ctx.now = self.now;
                evaluate(ast, &ctx).into_scalar()
            };
            let values = &mut self.sheets[c.sheet.0 as usize].values;
            let old = values.insert((c.row, c.col), new.clone());
            if !old.is_some_and(|o| same_value(&o, &new)) {
                changed.push(c);
            }
        }
        changed.sort_unstable();
        Recalc {
            changed,
            cycle: schedule.cycle,
        }
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
        let p = |s: &str| is_volatile(&parse(s).unwrap());
        assert!(p("=today()"));
        assert!(p("=1+IF(TRUE,{1},NOW())"));
        assert!(!p("=SUM(A1:A3)"));
    }

    #[test]
    fn renames_sheet_prefixes_in_ast() {
        let mut e = parse("=SUM(data!A1:A2,Other!B1)+'Data'!C1").unwrap();
        assert!(rename_refs(&mut e, "DATA", "Facts"));
        assert_eq!(e.to_string(), "SUM(Facts!A1:A2,Other!B1)+Facts!C1");
        assert!(!rename_refs(&mut e, "Data", "X"));
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
