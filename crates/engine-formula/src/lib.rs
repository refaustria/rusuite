#![forbid(unsafe_code)]
//! Formula engine for Rusuite.
//!
//! This crate currently provides the front end: a [`lexer`], a hand-written
//! Pratt [`parser`] and the typed [`ast`] (with a canonical printer via
//! `Display`). Evaluation and the dependency graph build on [`Expr`].
//!
//! ```
//! let ast = engine_formula::parse("=sum(A1:B2, Sheet2!$C$3)*2").unwrap();
//! assert_eq!(ast.to_string(), "SUM(A1:B2,Sheet2!$C$3)*2");
//! assert_eq!(engine_formula::parse(&ast.to_string()), Ok(ast));
//! ```

pub mod ast;
pub mod graph;
pub mod lexer;
pub mod parser;

pub use ast::Expr;
pub use parser::{parse, ParseError};
