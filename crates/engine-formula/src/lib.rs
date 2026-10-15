#![forbid(unsafe_code)]
//! Formula engine for Rusuite.
//!
//! Front end: a [`lexer`], a hand-written Pratt [`parser`] and the typed
//! [`ast`] (with a canonical printer via `Display`). Back end: the
//! [`value`] system with Excel coercions, the [`eval`]uator and the
//! pluggable [`functions`] registry.
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
pub mod eval;
pub mod functions;
pub mod lexer;
pub mod parser;
pub mod value;

pub use ast::{ErrorKind, Expr};
pub use eval::{evaluate, CellCoord, CellProvider, EvalContext, Operand, RangeRef, SheetId};
pub use functions::{Arity, CallContext, Function, FunctionRegistry};
pub use parser::{parse, ParseError};
pub use value::{Array, Value};
