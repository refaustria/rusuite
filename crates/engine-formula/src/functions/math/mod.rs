//! Math and statistics functions.

use crate::ast::Expr;
use crate::functions::{Aggregate, CallContext, FunctionRegistry};
use crate::value::{round_15, Value};

pub mod abs;
pub mod average;
pub mod ceiling;
pub mod count;
pub mod counta;
pub mod countif;
pub mod criteria;
pub mod int;
pub mod max;
pub mod min;
pub mod mod_;
pub mod pi;
pub mod power;
pub mod product;
pub mod round;
pub mod rounddown;
pub mod roundup;
pub mod sqrt;
pub mod sum;
pub mod sumif;
pub mod sumproduct;

/// Registers every math/statistics function.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(sum::Sum));
    r.register(Box::new(average::Average));
    r.register(Box::new(min::Min));
    r.register(Box::new(max::Max));
    r.register(Box::new(count::Count));
    r.register(Box::new(counta::CountA));
    r.register(Box::new(round::Round));
    r.register(Box::new(roundup::RoundUp));
    r.register(Box::new(rounddown::RoundDown));
    r.register(Box::new(int::Int));
    r.register(Box::new(mod_::Mod));
    r.register(Box::new(abs::Abs));
    r.register(Box::new(sqrt::Sqrt));
    r.register(Box::new(power::Power));
    r.register(Box::new(pi::Pi));
    r.register(Box::new(product::Product));
    r.register(Box::new(sumif::SumIf));
    r.register(Box::new(countif::CountIf));
    r.register(Box::new(sumproduct::SumProduct));
    r.register(Box::new(ceiling::Ceiling));
}

/// Collects the numbers of `args` under [`Aggregate::Numbers`]; the first
/// error is returned as `Err`.
pub(crate) fn numbers(args: &[Expr], ctx: &CallContext) -> Result<Vec<f64>, Value> {
    let mut out = Vec::new();
    for v in ctx.aggregate(args, Aggregate::Numbers) {
        match v {
            Value::Number(n) => out.push(n),
            Value::Error(e) => return Err(Value::Error(e)),
            _ => {}
        }
    }
    Ok(out)
}

/// One scalar number argument mapped through `f`.
pub(crate) fn map1(args: &[Expr], ctx: &CallContext, f: impl Fn(f64) -> Value) -> Value {
    match ctx.number(&args[0]) {
        Ok(x) => f(x),
        Err(e) => Value::Error(e),
    }
}

/// Two scalar number arguments (left to right) mapped through `f`.
pub(crate) fn map2(args: &[Expr], ctx: &CallContext, f: impl Fn(f64, f64) -> Value) -> Value {
    let x = match ctx.number(&args[0]) {
        Ok(x) => x,
        Err(e) => return Value::Error(e),
    };
    match ctx.number(&args[1]) {
        Ok(y) => f(x, y),
        Err(e) => Value::Error(e),
    }
}

/// How [`round_digits`] resolves the discarded part.
#[derive(Clone, Copy)]
pub(crate) enum Rounding {
    Nearest,
    Up,
    Down,
}

/// Rounds `x` to `digits` decimals (negative: left of the decimal point;
/// `digits` is truncated toward zero). The scaled value is first rounded
/// to 15 significant digits so that `ROUND(2.675,2)` gives 2.68 as in Excel.
pub(crate) fn round_digits(x: f64, digits: f64, mode: Rounding) -> f64 {
    let d = digits.trunc();
    if d > 300.0 {
        return x;
    }
    if d < -300.0 {
        return 0.0;
    }
    let p = 10f64.powi(d.abs() as i32);
    let scaled = if d >= 0.0 { x * p } else { x / p };
    let s = round_15(scaled);
    let r = match mode {
        Rounding::Nearest => s.abs().floor() + if s.abs().fract() >= 0.5 { 1.0 } else { 0.0 },
        Rounding::Up => s.abs().ceil(),
        Rounding::Down => s.abs().floor(),
    } * s.signum();
    let out = if d >= 0.0 { r / p } else { r * p };
    if out == 0.0 {
        0.0
    } else {
        round_15(out)
    }
}
