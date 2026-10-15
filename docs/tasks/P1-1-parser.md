# Task P1-1 – `engine-formula`: lexer, Pratt parser, AST, printer

Branch: `p1/parser` (worktree `/home/bojan/rusuite-wt/p1-parser`). In scope: `crates/engine-formula/**` only (plus `Cargo.lock`). No evaluation, no dependency graph, no functions – those are later tasks that build on YOUR AST, so the AST shape is the deliverable that matters most.

## Goal
`engine_formula::parse("=SUM(A1:B2, Sheet2!$C$3)*2")` returns a typed AST; `ast.to_string()` prints a canonical Excel formula; parsing the printed text yields an equal AST (property-tested). Syntax = Excel en-US: comma argument separator, dot decimal, `TRUE`/`FALSE`, error literals.

## Modules (public): `ast`, `lexer`, `parser`; re-export `parse`, `Expr`, `ParseError` from lib.rs

### `ast`
```rust
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    Error(ErrorKind),                 // literal like #DIV/0!
    Reference(Reference),
    Name(String),                     // named range / unknown identifier (evaluates to #NAME? later)
    Array(Vec<Vec<Expr>>),            // {1,2;3,4}; rows of constants only (Number/Text/Bool/Error)
    Call { name: String, args: Vec<Expr> },   // name stored UPPERCASE
    Missing,                          // omitted argument: IF(A1,,"x")
    Unary { op: UnaryOp, expr: Box<Expr> },   // Neg, Plus, Percent (postfix)
    Binary { op: BinaryOp, lhs: Box<Expr>, rhs: Box<Expr> },
}
pub enum BinaryOp { Add, Sub, Mul, Div, Pow, Concat, Eq, Ne, Lt, Le, Gt, Ge, Range /* A1:INDEX(...) – reference operator between two non-literal refs */ }
pub enum ErrorKind { Null, Div0, Value, Ref, Name, Num, NA }   // #NULL! #DIV/0! #VALUE! #REF! #NAME? #NUM! #N/A ; Display prints Excel text; FromStr parses it
pub struct CellRef { pub col: u32, pub row: u32, pub col_abs: bool, pub row_abs: bool }   // 0-based col/row
pub enum RangeKind { Cell(CellRef), Area(CellRef, CellRef), Cols { start: u32, end: u32, abs: bool }, Rows { start: u32, end: u32, abs: bool } }
pub struct Reference { pub sheet: Option<String>, pub kind: RangeKind }
```
- `Expr` derives `Debug, Clone, PartialEq`; `Expr::references(&self) -> Vec<&Reference>` (recursive, in source order); `Display` for `Expr` prints the canonical formula WITHOUT the leading `=` (minimal parentheses, derived from precedence/associativity; uppercase function names; `$` where absolute; sheet names quoted only when needed: anything that is not `[A-Za-z_][A-Za-z0-9_.]*` or that would parse as a cell ref gets `'...'` with `'` doubled).
- `Area` is stored normalized (top-left, bottom-right) – `B2:A1` prints as `A1:B2`.
- Limits: col ≤ 16383 (XFD), row ≤ 1048575; an out-of-range literal is a `ParseError`.
- Helpers in `ast`: `col_to_letters(u32) -> String`, `letters_to_col(&str) -> Option<u32>` (case-insensitive), `CellRef::parse("$A$1")`, `CellRef::to_a1()`.
- `Number` holds f64; `-5` lexes as `Unary(Neg, Number(5))` (do NOT fold); printer prints `-5`.

### `lexer`
Tokens with byte spans: Number (incl. `1e3`, `.5`, `1.`), String (`"a""b"` → `a"b`), Ident (letters/digits/`_`/`.`; cell refs and TRUE/FALSE/function names are all Ident at lex time), Error literal, SheetName (quoted `'Sheet one'` → unquoted; or the Ident before `!`), `!`, `:`, `,`, `;`, `(`, `)`, `{`, `}`, `$`, operators (`+ - * / ^ & = <> < <= > >= %`). Whitespace is skipped (intersection operator is out of scope → ROADMAP). Leading `=` is stripped by `parse`.

### `parser` – Pratt
Precedence low→high (Excel): comparison (`= <> < <= > >=`, left) < `&` (left) < `+ -` (left) < `* /` (left) < `^` (LEFT-associative in Excel: `2^3^2 = 64`) < unary `-`/`+` (prefix; binds tighter than `^`: `-2^2 = 4`) < `%` (postfix) < `:` reference operator. Distinguish `A1:B2` (lexed refs → `RangeKind::Area`) from `A1:INDEX(..)` (→ `Binary{Range}`). `Sheet1!A1:B2` has one sheet prefix for the whole area; `Sheet1!A1:Sheet1!B2` also accepted. `A:C` and `2:4` are Cols/Rows ranges. An Ident that is not a cell ref, not a bool, and not followed by `(` is `Name`. Function call with empty argument slots → `Missing`.
`ParseError { pos: usize, message: String }` with `Display`; implement `std::error::Error`.

## Tests (required)
- Lexer unit tests (numbers, strings with escaped quotes, sheet names with `''`, error literals, all operators, span correctness).
- Parser table test: ≥ 40 formulas with their expected canonical print, including: `=1+2*3`, `=(1+2)*3`, `=-2^2` (prints `-2^2`), `=2^-2`, `=2^3^2`, `=1<>2`, `="a"&"b"`, `=50%`, `=A1`, `=$A$1`, `=a1` (prints `A1`), `=Sheet2!A1`, `='My Sheet'!A1:B2`, `=B2:A1` (prints `A1:B2`), `=A:A`, `=1:1`, `=SUM(A1:A3,B1)`, `=IF(A1,,"x")`, `=sum(1)` (prints `SUM(1)`), `={1,2;3,4}`, `=#DIV/0!`, `=TRUE`, `=MyName`, `=A1:INDEX(B1:B9,3)`, `=--1`, `=1e3` (prints `1000`), `=.5`, `="He said ""hi"""`, `=(A1)` (prints `A1`), `=1-(2-3)` (parens kept), `=(1-2)-3` (prints `1-2-3`), `=2*(3+4)`, `=-(1+2)`, `=(-1)^2` (parens kept), `=1&2=3` (prints `1&2=3`), `=(1=2)&3`.
- Error cases: `=1+`, `=SUM(`, `=A1:`, `=XFE1` (col out of range), `="unterminated`, `=1 2` (two expressions), `=)`; each returns `ParseError` with a sensible position.
- `references()` returns refs in order for a nested formula.
- proptest (`proptest` is a workspace dep): a generator for random `Expr` trees (depth ≤ 4, numbers finite & printed-roundtrippable – restrict to small integers and simple decimals; identifiers from a fixed list; strings from a small alphabet including `"`); property `parse(&ast.to_string()) == Ok(ast)` AND `parse(&parse(s).to_string())` idempotent for the table formulas. 256 cases minimum.
- `insta` snapshot of the `Debug` AST for 3 representative formulas.

## Dependencies
`thiserror` (add to crate), `proptest` + `insta` as dev-deps (workspace). Nothing else – no parser-combinator crates; hand-written Pratt parser.
