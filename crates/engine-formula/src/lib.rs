#![forbid(unsafe_code)]
//! Formula engine for Rusuite.
//!
//! Front end: a [`lexer`], a hand-written Pratt [`parser`] and the typed
//! [`ast`] (with a canonical printer via `Display`). Back end: the
//! [`value`] system with Excel coercions, the [`eval`]uator and the
//! pluggable [`functions`] registry. The [`graph`] orders recalculation;
//! the [`engine`] ties storage, graph and evaluator together into one
//! workbook-level [`Engine`]. [`transform`] rewrites references for
//! row/column inserts and deletes and for copy/paste.
//!
//! ```
//! let ast = engine_formula::parse("=sum(A1:B2, Sheet2!$C$3)*2").unwrap();
//! assert_eq!(ast.to_string(), "SUM(A1:B2,Sheet2!$C$3)*2");
//! assert_eq!(engine_formula::parse(&ast.to_string()), Ok(ast));
//! ```
//!
//! Evaluating against a [`CellProvider`]:
//!
//! ```
//! use engine_formula::{evaluate, parse, CellCoord, CellProvider, EvalContext,
//!     FunctionRegistry, SheetId, Value};
//!
//! struct OneSheet;
//! impl CellProvider for OneSheet {
//!     fn sheet_id(&self, name: &str) -> Option<SheetId> {
//!         name.eq_ignore_ascii_case("Sheet1").then_some(SheetId(0))
//!     }
//!     fn value(&self, c: CellCoord) -> Value {
//!         if (c.row, c.col) == (0, 0) { Value::Number(20.0) } else { Value::Empty }
//!     }
//!     fn used_range(&self, _: SheetId) -> Option<(u32, u32)> { Some((0, 0)) }
//! }
//!
//! let registry = FunctionRegistry::with_builtins();
//! let here = CellCoord { sheet: SheetId(0), row: 0, col: 1 };
//! let ctx = EvalContext::new(&OneSheet, &registry, here);
//! let v = evaluate(&parse("=SUM(A1, 1)&\"!\"").unwrap(), &ctx);
//! assert_eq!(v, Value::Text("21!".into()));
//! ```

pub mod ast;
pub mod coord;
pub mod engine;
pub mod entry;
pub mod eval;
pub mod functions;
pub mod graph;
pub mod lexer;
pub mod numfmt;
pub mod parser;
pub mod pivot;
pub mod r1c1;
pub mod structured;
pub mod transform;
pub mod value;

pub use ast::{is_valid_name, ErrorKind, Expr};
pub use engine::{CellContent, Engine, EngineError, NameEntry, NameScope, Recalc, Spill};
pub use eval::{
    default_now, evaluate, evaluate_formula, set_default_clock, system_now, CellCoord,
    CellProvider, EvalContext, Operand, RangeRef, RowHidden, SheetId,
};
pub use functions::{Arity, CallContext, Function, FunctionRegistry};
pub use graph::Cycle;
pub use lexer::Span;
pub use parser::{parse, parse_with_spans, ParseError, SpanTree};
pub use pivot::{find_pivot_value, PivotData, PivotEntry, PivotItemName};
pub use structured::{StructRef, TableDef, TableItem};
pub use transform::{
    adjust_references, adjust_references_for_move, adjust_references_shift, offset_relative,
    AdjustContext, CellRect, CellShift, MoveContext, StructuralOp,
};
pub use value::{Array, Value};

/// Formats `n` with an Excel number format code (see [`numfmt`]); `None`
/// when the code cannot format it (e.g. a negative date).
pub fn format_number(n: f64, code: &str) -> Option<String> {
    numfmt::format_number(n, code).ok()
}
