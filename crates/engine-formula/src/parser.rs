//! Hand-written Pratt parser producing [`Expr`].
//!
//! Precedence, low to high: comparison < `&` < `+ -` < `* /` < `^` (left
//! associative) < prefix `- +` < postfix `%` < prefix `@` (implicit
//! intersection) < space (intersection operator) < `:` (reference
//! operator) < postfix `#` (spilled range). The union operator `,` is
//! only recognised inside parentheses (`SUM((A1,B2))`).

use thiserror::Error;

use crate::ast::{
    is_valid_name, letters_to_col, parse_row, BinaryOp, CellRef, Expr, RangeKind, Reference,
    UnaryOp, MAX_COL,
};
use crate::lexer::{tokenize, Span, Token, TokenKind};

/// A lexing or parsing failure at byte offset `pos` of the input.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{message} at position {pos}")]
pub struct ParseError {
    pub pos: usize,
    pub message: String,
}

impl ParseError {
    pub fn new(pos: usize, message: impl Into<String>) -> Self {
        ParseError {
            pos,
            message: message.into(),
        }
    }
}

/// Parses a formula (with or without the leading `=`). Error positions are
/// byte offsets into `formula` as given.
pub fn parse(formula: &str) -> Result<Expr, ParseError> {
    parse_with_spans(formula).map(|(e, _)| e)
}

/// The source span of every node of a parsed formula, in the shape of the
/// [`Expr`] tree: `children` follow the expression's children in order
/// (the arguments of a call, the operand(s) of an operator, the elements
/// of an array constant row by row). Spans are byte offsets into the
/// formula text as given (the leading `=` included); parentheses around a
/// node are part of its span.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SpanTree {
    pub span: Span,
    pub children: Vec<SpanTree>,
}

impl SpanTree {
    fn shift(&mut self, by: usize) {
        self.span.start += by;
        self.span.end += by;
        for c in &mut self.children {
            c.shift(by);
        }
    }
}

/// [`parse`] that also returns the [`SpanTree`] of the expression, for
/// inline diagnostics and step-wise evaluation.
pub fn parse_with_spans(formula: &str) -> Result<(Expr, SpanTree), ParseError> {
    let (body, offset) = match formula.strip_prefix('=') {
        Some(rest) => (rest, 1),
        None => (formula, 0),
    };
    let (e, mut tree) = parse_body(body).map_err(|mut e| {
        e.pos += offset;
        e
    })?;
    tree.shift(offset);
    Ok((e, tree))
}

fn parse_body(src: &str) -> Result<(Expr, SpanTree), ParseError> {
    let tokens = tokenize(src)?;
    if tokens.is_empty() {
        return Err(ParseError::new(0, "empty formula"));
    }
    let mut p = Parser {
        src,
        tokens,
        pos: 0,
        trees: Vec::new(),
    };
    let expr = p.expr(0)?;
    if let Some(t) = p.tokens.get(p.pos) {
        return Err(ParseError::new(
            t.span.start,
            format!("unexpected {} after expression", describe(&t.kind)),
        ));
    }
    let tree = p.trees.pop().expect("one tree per parsed expression");
    debug_assert!(p.trees.is_empty());
    Ok((expr, tree))
}

// Binding powers.
const BP_PREFIX: u8 = 11;
const BP_PERCENT: u8 = 13;
/// `@` takes everything up to the reference operator: `@A1:B2` is
/// `@(A1:B2)`.
const BP_AT: u8 = 14;
/// The intersection operator (whitespace between two references).
const BP_ISECT: u8 = 14;
const BP_SPILL: u8 = 17;

/// Whether `e` can stand for a reference (an operand of the reference
/// operators): a reference, a name, a reference-valued operator or a
/// function call (`INDEX`, `OFFSET`, ... may return references).
fn ref_like(e: &Expr) -> bool {
    match e {
        Expr::Reference(_)
        | Expr::Name(_)
        | Expr::QualifiedName { .. }
        | Expr::Structured(_)
        | Expr::Call { .. } => true,
        Expr::Binary { op, .. } => op.is_reference_op(),
        Expr::Unary {
            op: UnaryOp::SpillRange,
            ..
        } => true,
        _ => false,
    }
}

/// Whether a token can start an operand of the intersection operator.
fn starts_ref_operand(kind: &TokenKind) -> bool {
    matches!(
        kind,
        TokenKind::Ident(_)
            | TokenKind::SheetName(_)
            | TokenKind::Dollar
            | TokenKind::LParen
            | TokenKind::Number(_)
            | TokenKind::Structured { .. }
    )
}

fn infix(kind: &TokenKind) -> Option<(BinaryOp, u8, u8)> {
    let op = match kind {
        TokenKind::Eq => BinaryOp::Eq,
        TokenKind::Ne => BinaryOp::Ne,
        TokenKind::Lt => BinaryOp::Lt,
        TokenKind::Le => BinaryOp::Le,
        TokenKind::Gt => BinaryOp::Gt,
        TokenKind::Ge => BinaryOp::Ge,
        TokenKind::Amp => BinaryOp::Concat,
        TokenKind::Plus => BinaryOp::Add,
        TokenKind::Minus => BinaryOp::Sub,
        TokenKind::Star => BinaryOp::Mul,
        TokenKind::Slash => BinaryOp::Div,
        TokenKind::Caret => BinaryOp::Pow,
        TokenKind::Colon => BinaryOp::Range,
        _ => return None,
    };
    let lbp = match op {
        BinaryOp::Concat => 3,
        BinaryOp::Add | BinaryOp::Sub => 5,
        BinaryOp::Mul | BinaryOp::Div => 7,
        BinaryOp::Pow => 9,
        BinaryOp::Range => 15,
        _ => 1, // comparisons
    };
    // All left-associative (including `^`, as in Excel).
    Some((op, lbp, lbp + 1))
}

fn describe(kind: &TokenKind) -> String {
    match kind {
        TokenKind::Number(n) => format!("number `{n}`"),
        TokenKind::String(_) => "string".into(),
        TokenKind::Ident(s) => format!("identifier `{s}`"),
        TokenKind::Error(e) => format!("error literal `{e}`"),
        TokenKind::SheetName(s) => format!("sheet name `{s}`"),
        TokenKind::Structured { .. } => "structured reference".into(),
        other => {
            let s = match other {
                TokenKind::Bang => "!",
                TokenKind::Colon => ":",
                TokenKind::Comma => ",",
                TokenKind::Semicolon => ";",
                TokenKind::LParen => "(",
                TokenKind::RParen => ")",
                TokenKind::LBrace => "{",
                TokenKind::RBrace => "}",
                TokenKind::Dollar => "$",
                TokenKind::Plus => "+",
                TokenKind::Minus => "-",
                TokenKind::Star => "*",
                TokenKind::Slash => "/",
                TokenKind::Caret => "^",
                TokenKind::Amp => "&",
                TokenKind::Eq => "=",
                TokenKind::Ne => "<>",
                TokenKind::Lt => "<",
                TokenKind::Le => "<=",
                TokenKind::Gt => ">",
                TokenKind::Ge => ">=",
                TokenKind::Percent => "%",
                TokenKind::At => "@",
                TokenKind::Hash => "#",
                _ => unreachable!("handled above"),
            };
            format!("`{s}`")
        }
    }
}

/// One side of a reference: a cell, a column or a row. Columns and rows are
/// kept as text until they are known to be part of `A:C` / `2:4`.
enum Atom<'a> {
    Cell(CellRef),
    Col { letters: &'a str, abs: bool },
    Row { digits: &'a str, abs: bool },
}

struct Parser<'a> {
    src: &'a str,
    tokens: Vec<Token>,
    pos: usize,
    /// Span trees of the nodes built so far whose parent is not built yet.
    trees: Vec<SpanTree>,
}

impl<'a> Parser<'a> {
    /// Records a node built from the last `children` trees, starting at
    /// `start` (or its first child) and ending after the last consumed token.
    fn node(&mut self, start: usize, children: usize) {
        let end = self
            .pos
            .checked_sub(1)
            .map_or(start, |i| self.tokens[i].span.end);
        let children = self.trees.split_off(self.trees.len() - children);
        let start = children.first().map_or(start, |c| c.span.start.min(start));
        self.trees.push(SpanTree {
            span: Span { start, end },
            children,
        });
    }

    /// An omitted argument: an empty span at the current position.
    fn missing(&mut self) {
        let at = self.here();
        self.trees.push(SpanTree {
            span: Span { start: at, end: at },
            children: Vec::new(),
        });
    }

    fn peek(&self) -> Option<&TokenKind> {
        self.tokens.get(self.pos).map(|t| &t.kind)
    }

    fn peek_at(&self, i: usize) -> Option<&TokenKind> {
        self.tokens.get(i).map(|t| &t.kind)
    }

    /// Byte offset of the current token, or end of input.
    fn here(&self) -> usize {
        self.tokens
            .get(self.pos)
            .map_or(self.src.len(), |t| t.span.start)
    }

    fn adjacent(&self, i: usize) -> bool {
        i > 0 && i < self.tokens.len() && self.tokens[i - 1].span.end == self.tokens[i].span.start
    }

    fn text(&self, i: usize) -> &'a str {
        let s = self.tokens[i].span;
        &self.src[s.start..s.end]
    }

    fn unexpected(&self) -> ParseError {
        match self.tokens.get(self.pos) {
            Some(t) => ParseError::new(t.span.start, format!("unexpected {}", describe(&t.kind))),
            None => ParseError::new(self.src.len(), "unexpected end of formula"),
        }
    }

    fn expect(&mut self, kind: &TokenKind, what: &str) -> Result<(), ParseError> {
        if self.peek() == Some(kind) {
            self.pos += 1;
            Ok(())
        } else {
            let mut e = self.unexpected();
            e.message = format!(
                "expected {what}, found {}",
                e.message.trim_start_matches("unexpected ")
            );
            Err(e)
        }
    }

    fn expr(&mut self, min_bp: u8) -> Result<Expr, ParseError> {
        let mut lhs = self.prefix()?;
        while let Some(kind) = self.peek() {
            let postfix = match kind {
                TokenKind::Percent => Some((UnaryOp::Percent, BP_PERCENT)),
                TokenKind::Hash => Some((UnaryOp::SpillRange, BP_SPILL)),
                _ => None,
            };
            if let Some((op, bp)) = postfix {
                if bp < min_bp {
                    break;
                }
                if op == UnaryOp::SpillRange
                    && matches!(
                        lhs,
                        Expr::Unary {
                            op: UnaryOp::SpillRange,
                            ..
                        }
                    )
                {
                    return Err(self.unexpected());
                }
                self.pos += 1;
                self.node(usize::MAX, 1);
                lhs = Expr::Unary {
                    op,
                    expr: Box::new(lhs),
                };
                continue;
            }
            // `A1:B5 B3:C7`: whitespace between two references.
            if starts_ref_operand(kind) && !self.adjacent(self.pos) && ref_like(&lhs) {
                if BP_ISECT < min_bp {
                    break;
                }
                let at = self.here();
                let rhs = self.expr(BP_ISECT + 1)?;
                if !ref_like(&rhs) {
                    return Err(ParseError::new(
                        at,
                        "the intersection operator needs references on both sides",
                    ));
                }
                self.node(usize::MAX, 2);
                lhs = Expr::Binary {
                    op: BinaryOp::Intersect,
                    lhs: Box::new(lhs),
                    rhs: Box::new(rhs),
                };
                continue;
            }
            let Some((op, lbp, rbp)) = infix(kind) else {
                break;
            };
            if lbp < min_bp {
                break;
            }
            self.pos += 1;
            let rhs = self.expr(rbp)?;
            self.node(usize::MAX, 2);
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
            };
        }
        Ok(lhs)
    }

    fn prefix(&mut self) -> Result<Expr, ParseError> {
        let (op, bp) = match self.peek() {
            Some(TokenKind::Minus) => (UnaryOp::Neg, BP_PREFIX),
            Some(TokenKind::Plus) => (UnaryOp::Plus, BP_PREFIX),
            Some(TokenKind::At) => (UnaryOp::ImplicitIntersection, BP_AT),
            _ => return self.primary(),
        };
        let start = self.here();
        self.pos += 1;
        let expr = self.expr(bp)?;
        self.node(start, 1);
        Ok(Expr::Unary {
            op,
            expr: Box::new(expr),
        })
    }

    fn primary(&mut self) -> Result<Expr, ParseError> {
        let Some(kind) = self.peek().cloned() else {
            return Err(self.unexpected());
        };
        let start = self.here();
        match kind {
            TokenKind::String(s) => {
                self.pos += 1;
                self.node(start, 0);
                Ok(Expr::Text(s))
            }
            TokenKind::Error(e) => {
                self.pos += 1;
                self.node(start, 0);
                Ok(Expr::Error(e))
            }
            TokenKind::LParen => {
                self.pos += 1;
                let mut e = self.expr(0)?;
                // `(A1:A3,C1)`: the union operator.
                while self.peek() == Some(&TokenKind::Comma) {
                    let at = self.here();
                    self.pos += 1;
                    let rhs = self.expr(0)?;
                    if !ref_like(&e) || !ref_like(&rhs) {
                        return Err(ParseError::new(
                            at,
                            "the union operator needs references on both sides",
                        ));
                    }
                    self.node(usize::MAX, 2);
                    e = Expr::Binary {
                        op: BinaryOp::Union,
                        lhs: Box::new(e),
                        rhs: Box::new(rhs),
                    };
                }
                self.expect(&TokenKind::RParen, "`)`")?;
                // The parentheses belong to the node's span.
                let end = self.tokens[self.pos - 1].span.end;
                if let Some(t) = self.trees.last_mut() {
                    t.span = Span { start, end };
                }
                Ok(e)
            }
            TokenKind::LBrace => self.array(),
            TokenKind::Structured { table, body } => {
                let pos = self.here();
                self.pos += 1;
                if table.as_deref().is_some_and(|t| !is_valid_name(t)) {
                    return Err(ParseError::new(pos, "invalid table name"));
                }
                self.node(start, 0);
                Ok(Expr::Structured(crate::structured::StructRef::parse(
                    table.as_deref(),
                    &body,
                    pos,
                )?))
            }
            TokenKind::SheetName(sheet) => {
                let at = self.here();
                self.pos += 1;
                self.expect(&TokenKind::Bang, "`!`")?;
                // `Sheet1:Sheet3!A1`: a 3-D reference.
                if let Some((first, last)) = sheet.split_once(':') {
                    if first.is_empty() || last.is_empty() {
                        return Err(ParseError::new(at, "empty sheet name"));
                    }
                    return match self.reference(Some(first.to_string()))? {
                        Some(Expr::Reference(mut r)) => {
                            if !first.eq_ignore_ascii_case(last) {
                                r.sheet_last = Some(last.to_string());
                            }
                            self.node(start, 0);
                            Ok(Expr::Reference(r))
                        }
                        _ => Err(ParseError::new(
                            self.here(),
                            "expected a cell, column or row reference after sheet name",
                        )),
                    };
                }
                let reference = self.reference(Some(sheet.clone()));
                if let Ok(Some(e)) = reference {
                    self.node(start, 0);
                    return Ok(e);
                }
                // `Sheet1!Tax`: a sheet-level defined name.
                if let Some(TokenKind::Ident(name)) = self.peek().cloned() {
                    if self.peek_at(self.pos + 1) != Some(&TokenKind::LParen)
                        && is_valid_name(&name)
                    {
                        self.pos += 1;
                        self.node(start, 0);
                        return Ok(Expr::QualifiedName { sheet, name });
                    }
                }
                match reference? {
                    Some(e) => {
                        self.node(start, 0);
                        Ok(e)
                    }
                    None => Err(ParseError::new(
                        self.here(),
                        "expected a cell, column or row reference after sheet name",
                    )),
                }
            }
            TokenKind::Ident(name) if self.peek_at(self.pos + 1) == Some(&TokenKind::LParen) => {
                self.pos += 2;
                let call = self.call(name.to_ascii_uppercase())?;
                let Expr::Call { args, .. } = &call else {
                    unreachable!("call() builds a call");
                };
                let n = args.len();
                self.node(start, n);
                Ok(call)
            }
            TokenKind::Ident(_) | TokenKind::Number(_) | TokenKind::Dollar => {
                if let Some(e) = self.reference(None)? {
                    self.node(start, 0);
                    return Ok(e);
                }
                match kind {
                    TokenKind::Number(n) => {
                        self.pos += 1;
                        self.node(start, 0);
                        Ok(Expr::Number(n))
                    }
                    TokenKind::Ident(name) => {
                        self.pos += 1;
                        self.node(start, 0);
                        if name.eq_ignore_ascii_case("TRUE") {
                            Ok(Expr::Bool(true))
                        } else if name.eq_ignore_ascii_case("FALSE") {
                            Ok(Expr::Bool(false))
                        } else {
                            Ok(Expr::Name(name))
                        }
                    }
                    _ => Err(ParseError::new(
                        self.here(),
                        "expected a reference after `$`",
                    )),
                }
            }
            _ => Err(self.unexpected()),
        }
    }

    /// Function call; the name and `(` are already consumed.
    fn call(&mut self, name: String) -> Result<Expr, ParseError> {
        let mut args = Vec::new();
        if self.peek() == Some(&TokenKind::RParen) {
            self.pos += 1;
            return Ok(Expr::Call { name, args });
        }
        loop {
            match self.peek() {
                Some(TokenKind::Comma | TokenKind::RParen) => {
                    self.missing();
                    args.push(Expr::Missing);
                }
                _ => args.push(self.expr(0)?),
            }
            match self.peek() {
                Some(TokenKind::Comma) => self.pos += 1,
                Some(TokenKind::RParen) => {
                    self.pos += 1;
                    return Ok(Expr::Call { name, args });
                }
                _ => {
                    let mut e = self.unexpected();
                    e.message = format!(
                        "expected `,` or `)` in call to {name}, found {}",
                        e.message.trim_start_matches("unexpected ")
                    );
                    return Err(e);
                }
            }
        }
    }

    /// Array constant `{1,2;3,4}`; the current token is `{`.
    fn array(&mut self) -> Result<Expr, ParseError> {
        let start = self.here();
        self.pos += 1;
        let mut rows: Vec<Vec<Expr>> = vec![Vec::new()];
        loop {
            let el = self.array_element()?;
            rows.last_mut().expect("non-empty").push(el);
            match self.peek() {
                Some(TokenKind::Comma) => self.pos += 1,
                Some(TokenKind::Semicolon) => {
                    self.pos += 1;
                    rows.push(Vec::new());
                }
                Some(TokenKind::RBrace) => {
                    self.pos += 1;
                    break;
                }
                _ => {
                    let mut e = self.unexpected();
                    e.message = format!(
                        "expected `,`, `;` or `}}` in array, found {}",
                        e.message.trim_start_matches("unexpected ")
                    );
                    return Err(e);
                }
            }
        }
        if rows.iter().any(|r| r.len() != rows[0].len()) {
            return Err(ParseError::new(start, "array rows have different lengths"));
        }
        let n = rows.iter().map(Vec::len).sum();
        self.node(start, n);
        Ok(Expr::Array(rows))
    }

    /// Array element: number (optionally signed; the sign is folded),
    /// string, boolean or error literal.
    fn array_element(&mut self) -> Result<Expr, ParseError> {
        let start = self.here();
        let sign = match self.peek() {
            Some(TokenKind::Minus) => {
                self.pos += 1;
                Some(-1.0)
            }
            Some(TokenKind::Plus) => {
                self.pos += 1;
                Some(1.0)
            }
            _ => None,
        };
        let el = match (self.peek(), sign) {
            (Some(TokenKind::Number(n)), _) => Expr::Number(n * sign.unwrap_or(1.0)),
            (Some(TokenKind::String(s)), None) => Expr::Text(s.clone()),
            (Some(TokenKind::Error(e)), None) => Expr::Error(*e),
            (Some(TokenKind::Ident(s)), None) if s.eq_ignore_ascii_case("TRUE") => Expr::Bool(true),
            (Some(TokenKind::Ident(s)), None) if s.eq_ignore_ascii_case("FALSE") => {
                Expr::Bool(false)
            }
            _ => {
                return Err(ParseError::new(
                    self.here(),
                    "array elements must be numbers, strings, booleans or error literals",
                ))
            }
        };
        self.pos += 1;
        self.node(start, 0);
        Ok(el)
    }

    /// Tries to read a cell/column/row atom starting at token `i`
    /// (optionally `$`-prefixed). Returns the atom and the next token index.
    fn atom(&self, i: usize) -> Result<Option<(Atom<'a>, usize)>, ParseError> {
        let mut j = i;
        let first_abs = self.peek_at(j) == Some(&TokenKind::Dollar);
        if first_abs {
            j += 1;
            if !self.adjacent(j) {
                return Ok(None);
            }
        }
        match self.peek_at(j) {
            Some(TokenKind::Ident(_)) => {
                let text = self.text(j);
                let pos = self.tokens[j].span.start;
                let n_letters = text.bytes().take_while(u8::is_ascii_alphabetic).count();
                let (letters, rest) = text.split_at(n_letters);
                if letters.is_empty() || letters.len() > 3 {
                    return Ok(None);
                }
                if rest.is_empty() {
                    // `A$1` or a bare column `A`.
                    if self.peek_at(j + 1) == Some(&TokenKind::Dollar)
                        && self.adjacent(j + 1)
                        && matches!(self.peek_at(j + 2), Some(TokenKind::Number(_)))
                        && self.adjacent(j + 2)
                        && self.text(j + 2).bytes().all(|b| b.is_ascii_digit())
                    {
                        let cell = self.cell(letters, self.text(j + 2), first_abs, true, pos)?;
                        return Ok(Some((Atom::Cell(cell), j + 3)));
                    }
                    if self.peek_at(j + 1) == Some(&TokenKind::LParen) {
                        return Ok(None);
                    }
                    return Ok(Some((
                        Atom::Col {
                            letters,
                            abs: first_abs,
                        },
                        j + 1,
                    )));
                }
                if !rest.bytes().all(|b| b.is_ascii_digit())
                    || self.peek_at(j + 1) == Some(&TokenKind::LParen)
                {
                    return Ok(None);
                }
                let cell = self.cell(letters, rest, first_abs, false, pos)?;
                Ok(Some((Atom::Cell(cell), j + 1)))
            }
            Some(TokenKind::Number(_)) if self.text(j).bytes().all(|b| b.is_ascii_digit()) => {
                Ok(Some((
                    Atom::Row {
                        digits: self.text(j),
                        abs: first_abs,
                    },
                    j + 1,
                )))
            }
            _ => Ok(None),
        }
    }

    fn cell(
        &self,
        letters: &str,
        digits: &str,
        col_abs: bool,
        row_abs: bool,
        pos: usize,
    ) -> Result<CellRef, ParseError> {
        let col = letters_to_col(letters)
            .filter(|&c| c <= MAX_COL)
            .ok_or_else(|| ParseError::new(pos, format!("column `{letters}` out of range")))?;
        let row = parse_row(digits)
            .ok_or_else(|| ParseError::new(pos, format!("row `{digits}` out of range")))?;
        Ok(CellRef {
            col,
            row,
            col_abs,
            row_abs,
        })
    }

    /// After `:` at token `i`, finds the second atom, accepting a repeated
    /// sheet prefix (`Sheet1!A1:Sheet1!B2`). Returns `None` if the right
    /// side is not a plain atom.
    fn second_atom(
        &self,
        i: usize,
        sheet: &Option<String>,
    ) -> Result<Option<(Atom<'a>, usize)>, ParseError> {
        let mut j = i;
        if let Some(TokenKind::SheetName(s2)) = self.peek_at(j) {
            match sheet {
                Some(s1) if s1.eq_ignore_ascii_case(s2) => {}
                Some(_) => {
                    return Err(ParseError::new(
                        self.tokens[j].span.start,
                        "ranges spanning different sheets are not supported",
                    ))
                }
                None => return Ok(None),
            }
            if self.peek_at(j + 1) != Some(&TokenKind::Bang) {
                return Ok(None);
            }
            j += 2;
        }
        self.atom(j)
    }

    /// Parses a reference at the current position. Returns `Ok(None)` (and
    /// consumes nothing) if the tokens do not form a reference and no sheet
    /// prefix was given.
    fn reference(&mut self, sheet: Option<String>) -> Result<Option<Expr>, ParseError> {
        let start = self.here();
        let Some((first, next)) = self.atom(self.pos)? else {
            return Ok(None);
        };
        let colon = self.peek_at(next) == Some(&TokenKind::Colon);
        let second = if colon {
            self.second_atom(next + 1, &sheet)?
        } else {
            None
        };
        let (kind, end) = match (first, second) {
            (Atom::Cell(a), Some((Atom::Cell(b), end))) => (RangeKind::area(a, b), end),
            (Atom::Cell(a), _) => (RangeKind::Cell(a), next),
            (
                Atom::Col {
                    letters: l1,
                    abs: a1,
                },
                Some((
                    Atom::Col {
                        letters: l2,
                        abs: a2,
                    },
                    end,
                )),
            ) => {
                let col = |l: &str, i: usize| {
                    letters_to_col(l).filter(|&c| c <= MAX_COL).ok_or_else(|| {
                        ParseError::new(
                            self.tokens[i].span.start,
                            format!("column `{l}` out of range"),
                        )
                    })
                };
                let c1 = col(l1, self.pos)?;
                let c2 = col(l2, end - 1)?;
                let ((start, start_abs), (stop, end_abs)) = if c1 <= c2 {
                    ((c1, a1), (c2, a2))
                } else {
                    ((c2, a2), (c1, a1))
                };
                (
                    RangeKind::Cols {
                        start,
                        end: stop,
                        start_abs,
                        end_abs,
                    },
                    end,
                )
            }
            (
                Atom::Row {
                    digits: d1,
                    abs: a1,
                },
                Some((
                    Atom::Row {
                        digits: d2,
                        abs: a2,
                    },
                    end,
                )),
            ) => {
                let row = |d: &str, i: usize| {
                    parse_row(d).ok_or_else(|| {
                        ParseError::new(
                            self.tokens[i].span.start,
                            format!("row `{d}` out of range"),
                        )
                    })
                };
                let r1 = row(d1, self.pos)?;
                let r2 = row(d2, end - 1)?;
                let ((start, start_abs), (stop, end_abs)) = if r1 <= r2 {
                    ((r1, a1), (r2, a2))
                } else {
                    ((r2, a2), (r1, a1))
                };
                (
                    RangeKind::Rows {
                        start,
                        end: stop,
                        start_abs,
                        end_abs,
                    },
                    end,
                )
            }
            // A column or row on its own is not a reference.
            _ => {
                return if sheet.is_some() {
                    Err(ParseError::new(
                        start,
                        "expected a cell, column or row reference",
                    ))
                } else {
                    Ok(None)
                };
            }
        };
        self.pos = end;
        Ok(Some(Expr::Reference(Reference::on(sheet, kind))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(s: &str) -> Expr {
        Expr::Reference(Reference::local(RangeKind::Cell(
            CellRef::parse(s).unwrap(),
        )))
    }

    #[test]
    fn precedence_structure() {
        // -2^2 = (-2)^2
        assert_eq!(
            parse("=-2^2").unwrap(),
            Expr::Binary {
                op: BinaryOp::Pow,
                lhs: Box::new(Expr::Unary {
                    op: UnaryOp::Neg,
                    expr: Box::new(Expr::Number(2.0))
                }),
                rhs: Box::new(Expr::Number(2.0)),
            }
        );
        // 2^3^2 = (2^3)^2
        let Expr::Binary { op, lhs, .. } = parse("2^3^2").unwrap() else {
            panic!()
        };
        assert_eq!(op, BinaryOp::Pow);
        assert!(matches!(
            *lhs,
            Expr::Binary {
                op: BinaryOp::Pow,
                ..
            }
        ));
    }

    #[test]
    fn mixed_absolute_cells() {
        assert_eq!(parse("A$1").unwrap(), cell("A$1"));
        assert_eq!(parse("$A1").unwrap(), cell("$A1"));
        assert_eq!(parse("$a$1").unwrap(), cell("$A$1"));
    }

    #[test]
    fn functions_that_look_like_cells() {
        assert_eq!(
            parse("LOG10(100)").unwrap(),
            Expr::Call {
                name: "LOG10".into(),
                args: vec![Expr::Number(100.0)]
            }
        );
        assert_eq!(
            parse("true()").unwrap(),
            Expr::Call {
                name: "TRUE".into(),
                args: vec![]
            }
        );
    }

    #[test]
    fn long_letter_idents_are_names() {
        assert_eq!(parse("ABCD1").unwrap(), Expr::Name("ABCD1".into()));
        assert_eq!(parse("abc").unwrap(), Expr::Name("abc".into()));
        assert_eq!(parse("\\x.y?").unwrap(), Expr::Name("\\x.y?".into()));
    }

    #[test]
    fn sheet_qualified_names() {
        let q = |sheet: &str, name: &str| Expr::QualifiedName {
            sheet: sheet.into(),
            name: name.into(),
        };
        assert_eq!(parse("Sheet1!Tax").unwrap(), q("Sheet1", "Tax"));
        assert_eq!(parse("'My Sheet'!Rate").unwrap(), q("My Sheet", "Rate"));
        assert_eq!(parse("Sheet1!ABC").unwrap(), q("Sheet1", "ABC"));
        assert_eq!(
            parse("'My Sheet'!Rate").unwrap().to_string(),
            "'My Sheet'!Rate"
        );
        // Cell references still win.
        assert!(matches!(parse("Sheet1!A1").unwrap(), Expr::Reference(_)));
        assert!(parse("Sheet1!A1:Other!B2").is_err());
    }

    #[test]
    fn span_trees_follow_the_ast() {
        let text = "=SUM(A1, 2*Sheet2!B1,,{1,2})+(C1)%";
        let (ast, tree) = parse_with_spans(text).unwrap();
        let at = |t: &SpanTree| &text[t.span.start..t.span.end];
        // Binary(+): SUM(...) and Percent(C1).
        assert_eq!(at(&tree), "SUM(A1, 2*Sheet2!B1,,{1,2})+(C1)%");
        let sum = &tree.children[0];
        assert_eq!(at(sum), "SUM(A1, 2*Sheet2!B1,,{1,2})");
        assert_eq!(sum.children.len(), 4);
        assert_eq!(at(&sum.children[0]), "A1");
        assert_eq!(at(&sum.children[1]), "2*Sheet2!B1");
        assert_eq!(at(&sum.children[1].children[1]), "Sheet2!B1");
        assert_eq!(sum.children[2].span.start, sum.children[2].span.end);
        assert_eq!(at(&sum.children[3]), "{1,2}");
        assert_eq!(sum.children[3].children.len(), 2);
        assert_eq!(at(&tree.children[1]), "(C1)%");
        assert_eq!(at(&tree.children[1].children[0]), "(C1)");
        assert!(matches!(
            ast,
            Expr::Binary {
                op: BinaryOp::Add,
                ..
            }
        ));
        let (_, t) = parse_with_spans("=-A1:B2 B1").unwrap();
        assert_eq!(t.children[0].children.len(), 2);
    }

    #[test]
    fn error_display() {
        let e = parse("=1+").unwrap_err();
        assert_eq!(e.to_string(), "unexpected end of formula at position 3");
    }
}
