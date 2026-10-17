//! Math and statistics functions.

use crate::ast::Expr;
use crate::functions::{Aggregate, CallContext, FunctionRegistry};
use crate::value::{round_15, Value};

pub mod abs;
pub mod aggregate;
pub mod average;
pub mod averageif;
pub mod averageifs;
pub mod ceiling;
pub mod ceiling_math;
pub mod combin;
pub mod count;
pub mod counta;
pub mod countblank;
pub mod countif;
pub mod countifs;
pub mod criteria;
pub mod even;
pub mod exp;
pub mod fact;
pub mod factdouble;
pub mod floor;
pub mod floor_math;
pub mod gcd;
pub mod int;
pub mod lcm;
pub mod ln;
pub mod log;
pub mod log10;
pub mod matrix;
pub mod max;
pub mod maxifs;
pub mod min;
pub mod mod_;
pub mod mround;
pub mod odd;
pub mod permut;
pub mod pi;
pub mod power;
pub mod product;
pub mod quotient;
pub mod rand;
pub mod randbetween;
pub mod round;
pub mod rounddown;
pub mod roundup;
pub mod sign;
pub mod sqrt;
pub mod sqrtpi;
pub mod subtotal;
pub mod sum;
pub mod sumif;
pub mod sumifs;
pub mod sumproduct;
pub mod sumsq;
pub mod sumx2my2;
#[cfg(test)]
mod tests;
pub mod trig;
pub mod trunc;

/// Registers every math/statistics function.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(aggregate::Aggregate));
    r.register(Box::new(matrix::MMult));
    r.register(Box::new(matrix::MInverse));
    r.register(Box::new(matrix::MDeterm));
    r.register(Box::new(matrix::MUnit));
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
    r.register(Box::new(trunc::Trunc));
    r.register(Box::new(ceiling_math::CeilingMath));
    r.register(Box::new(floor_math::FloorMath));
    r.register(Box::new(floor::Floor));
    r.register(Box::new(mround::Mround));
    r.register(Box::new(exp::Exp));
    r.register(Box::new(ln::Ln));
    r.register(Box::new(log10::Log10));
    r.register(Box::new(log::Log));
    r.register(Box::new(sign::Sign));
    r.register(Box::new(rand::Rand));
    r.register(Box::new(randbetween::RandBetween));
    r.register(Box::new(sumsq::SumSq));
    r.register(Box::new(sqrtpi::SqrtPi));
    r.register(Box::new(fact::Fact));
    r.register(Box::new(factdouble::FactDouble));
    r.register(Box::new(combin::Combin));
    r.register(Box::new(permut::Permut));
    r.register(Box::new(gcd::Gcd));
    r.register(Box::new(lcm::Lcm));
    r.register(Box::new(quotient::Quotient));
    r.register(Box::new(even::Even));
    r.register(Box::new(odd::Odd));
    r.register(Box::new(trig::Sin));
    r.register(Box::new(trig::Cos));
    r.register(Box::new(trig::Tan));
    r.register(Box::new(trig::Asin));
    r.register(Box::new(trig::Acos));
    r.register(Box::new(trig::Atan));
    r.register(Box::new(trig::Atan2));
    r.register(Box::new(trig::Sinh));
    r.register(Box::new(trig::Cosh));
    r.register(Box::new(trig::Tanh));
    r.register(Box::new(trig::Degrees));
    r.register(Box::new(trig::Radians));
    r.register(Box::new(sumx2my2::SumX2My2));
    r.register(Box::new(subtotal::Subtotal));
    r.register(Box::new(sumx2my2::SumX2Py2));
    r.register(Box::new(sumx2my2::SumXMy2));
    r.register(Box::new(countblank::CountBlank));
    r.register(Box::new(sumifs::SumIfs));
    r.register(Box::new(countifs::CountIfs));
    r.register(Box::new(averageifs::AverageIfs));
    r.register(Box::new(averageif::AverageIf));
    r.register(Box::new(maxifs::MaxIfs));
    r.register(Box::new(maxifs::MinIfs));
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
