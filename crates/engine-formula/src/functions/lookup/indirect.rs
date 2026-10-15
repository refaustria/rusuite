//! `INDIRECT(ref_text, [a1])`.

use crate::ast::{col_to_letters, ErrorKind, Expr};
use crate::eval::{range_value, resolve, Operand};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Parses one R1C1 cell (`R2C3`, `R[-1]C[2]`, `RC`) relative to
/// `(row, col)` (0-based) into A1 text.
fn r1c1_cell(s: &str, row: u32, col: u32) -> Option<String> {
    let rest = s.strip_prefix(['R', 'r'])?;
    let ci = rest.find(['C', 'c'])?;
    let (rp, cp) = (&rest[..ci], &rest[ci + 1..]);
    let part = |p: &str, cur: u32| -> Option<i64> {
        if p.is_empty() {
            Some(i64::from(cur) + 1)
        } else if let Some(inner) = p.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            Some(i64::from(cur) + 1 + inner.parse::<i64>().ok()?)
        } else {
            p.parse::<i64>().ok()
        }
    };
    let r = part(rp, row)?;
    let c = part(cp, col)?;
    if r < 1 || !(1..=16384).contains(&c) {
        return None;
    }
    Some(format!(
        "{}{}",
        col_to_letters(u32::try_from(c - 1).ok()?),
        r
    ))
}

/// Converts an R1C1 reference (optionally sheet-qualified, optionally a
/// `:` range) into A1 text.
fn r1c1_to_a1(text: &str, row: u32, col: u32) -> Option<String> {
    let (sheet, body) = match text.rfind('!') {
        Some(i) => (&text[..=i], &text[i + 1..]),
        None => ("", text),
    };
    let cells: Option<Vec<String>> = body.split(':').map(|p| r1c1_cell(p, row, col)).collect();
    Some(format!("{sheet}{}", cells?.join(":")))
}

fn resolve_text(args: &[Expr], ctx: &CallContext) -> Result<crate::eval::RangeRef, ErrorKind> {
    let text = ctx.text(&args[0])?;
    let a1 = match args.get(1) {
        Some(e) if !ctx.is_missing(e) => ctx.bool(e)?,
        _ => true,
    };
    let text = text.trim();
    let cur = ctx.current();
    let a1_text = if a1 {
        text.to_string()
    } else {
        r1c1_to_a1(text, cur.row, cur.col).ok_or(ErrorKind::Ref)?
    };
    match crate::parse(&format!("={a1_text}")) {
        Ok(Expr::Reference(r)) => resolve(&r, ctx.eval_context()),
        _ => Err(ErrorKind::Ref),
    }
}

fn indirect_ref(args: &[Expr], ctx: &mut CallContext) -> Operand {
    match resolve_text(args, ctx) {
        Ok(r) => Operand::Range(r),
        Err(e) => Operand::Scalar(Value::Error(e)),
    }
}

/// A reference given as text (`"B2"`, `"Sheet2!A1:B3"`), or in R1C1
/// notation when `a1` is FALSE. Text that is not a reference is `#REF!`.
/// Volatile. Usable wherever a reference is expected
/// (`SUM(INDIRECT("A1:A3"))`, `ROW(INDIRECT(..))`).
pub struct Indirect;

impl Function for Indirect {
    fn name(&self) -> &'static str {
        "INDIRECT"
    }
    fn arity(&self) -> Arity {
        Arity::range(1, 2)
    }
    fn is_volatile(&self) -> bool {
        true
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match resolve_text(args, ctx) {
            Ok(r) => range_value(r, ctx.eval_context()),
            Err(e) => Value::Error(e),
        }
    }
    fn call_ref(&self, args: &[Expr], ctx: &mut CallContext) -> Option<Operand> {
        Some(indirect_ref(args, ctx))
    }
}
