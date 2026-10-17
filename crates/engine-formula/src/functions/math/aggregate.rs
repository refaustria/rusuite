//! `AGGREGATE(function_num, options, ref1, [ref2], ...)` and the array
//! form `AGGREGATE(function_num, options, array, k)`.

use crate::ast::{ErrorKind, Expr};
use crate::eval::{CellCoord, Operand, RowHidden};
use crate::functions::statistical::percentile::{exc, inc};
use crate::functions::statistical::{mean, sorted, sum_sq_dev};
use crate::functions::{Arity, CallContext, Function};
use crate::value::{to_number, Value};

/// One of the 19 functions with the options: 0 skips nested `SUBTOTAL`
/// and `AGGREGATE` cells, 1 also hidden rows, 2 also error values, 3
/// all three, 4 nothing, 5 hidden rows, 6 error values, 7 hidden rows
/// and error values (default 0). Functions: 1 `AVERAGE`, 2 `COUNT`,
/// 3 `COUNTA`, 4 `MAX`, 5 `MIN`, 6 `PRODUCT`, 7 `STDEV.S`, 8 `STDEV.P`,
/// 9 `SUM`, 10 `VAR.S`, 11 `VAR.P`, 12 `MEDIAN`, 13 `MODE.SNGL`; with a
/// `k` argument 14 `LARGE`, 15 `SMALL`, 16 `PERCENTILE.INC`,
/// 17 `QUARTILE.INC`, 18 `PERCENTILE.EXC`, 19 `QUARTILE.EXC` (their
/// data may be an array; hidden rows and nested aggregates only apply to
/// references). Text and booleans in the data are ignored (`COUNTA`
/// counts them). Stored as `_xlfn.AGGREGATE`.
pub struct Aggregate;

/// What the data scan collected.
#[derive(Default)]
struct Collected {
    numbers: Vec<f64>,
    non_empty: u32,
    error: Option<ErrorKind>,
}

impl Function for Aggregate {
    fn name(&self) -> &'static str {
        "AGGREGATE"
    }

    fn arity(&self) -> Arity {
        Arity::range(3, 255)
    }

    fn reads_row_visibility(&self) -> bool {
        true
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        self.run(args, ctx).unwrap_or_else(Value::Error)
    }
}

fn int_arg(ctx: &CallContext, e: &Expr, default: f64) -> Result<i64, ErrorKind> {
    if ctx.is_missing(e) {
        return Ok(default as i64);
    }
    match ctx.scalar(e) {
        Value::Error(k) => Err(k),
        v => Ok(to_number(&v)?.trunc() as i64),
    }
}

impl Aggregate {
    fn run(&self, args: &[Expr], ctx: &CallContext) -> Result<Value, ErrorKind> {
        let func = int_arg(ctx, &args[0], 0.0)?;
        let options = int_arg(ctx, &args[1], 0.0)?;
        if !(1..=19).contains(&func) || !(0..=7).contains(&options) {
            return Err(ErrorKind::Value);
        }
        let skip_nested = options <= 3;
        let skip_hidden = matches!(options, 1 | 3 | 5 | 7);
        let skip_errors = matches!(options, 2 | 3 | 6 | 7);
        let with_k = func >= 14;
        if with_k && args.len() != 4 {
            return Err(ErrorKind::Value);
        }
        let data_args = if with_k { &args[2..3] } else { &args[2..] };
        let mut got = Collected::default();
        let provider = ctx.eval_context().provider;
        let take = |v: Value, got: &mut Collected| match v {
            Value::Empty => {}
            Value::Number(n) => {
                got.non_empty += 1;
                got.numbers.push(n);
            }
            Value::Error(e) => {
                if !skip_errors {
                    got.error.get_or_insert(e);
                }
            }
            _ => got.non_empty += 1,
        };
        for a in data_args {
            if ctx.is_missing(a) {
                continue;
            }
            match ctx.eval_array(a) {
                Operand::Range(range) => {
                    let Some(r) = range.clipped(provider) else {
                        continue;
                    };
                    for row in r.r0..=r.r1 {
                        if skip_hidden && provider.row_hidden(r.sheet, row) != RowHidden::Visible {
                            continue;
                        }
                        for col in r.c0..=r.c1 {
                            let c = CellCoord::new(r.sheet, row, col);
                            if skip_nested && provider.is_subtotal_cell(c) {
                                continue;
                            }
                            take(provider.value(c), &mut got);
                        }
                    }
                }
                Operand::Scalar(Value::Array(arr)) => {
                    if !with_k {
                        return Err(ErrorKind::Value);
                    }
                    for v in arr.values() {
                        take(v.clone(), &mut got);
                    }
                }
                Operand::Scalar(v) => {
                    if !with_k {
                        // The reference form takes references only.
                        return Err(match v {
                            Value::Error(e) => e,
                            _ => ErrorKind::Value,
                        });
                    }
                    take(v, &mut got);
                }
            }
        }
        if let Some(e) = got.error {
            if !matches!(func, 2 | 3) {
                return Err(e);
            }
        }
        let v = &got.numbers;
        let n = v.len();
        let div0 = ErrorKind::Div0;
        let x = match func {
            1 if n == 0 => return Err(div0),
            1 => mean(v),
            2 => n as f64,
            3 => f64::from(got.non_empty),
            4 => v.iter().copied().reduce(f64::max).unwrap_or(0.0),
            5 => v.iter().copied().reduce(f64::min).unwrap_or(0.0),
            6 if n == 0 => 0.0,
            6 => v.iter().product(),
            7 | 10 if n < 2 => return Err(div0),
            8 | 11 if n < 1 => return Err(div0),
            7 => (sum_sq_dev(v) / (n - 1) as f64).sqrt(),
            8 => (sum_sq_dev(v) / n as f64).sqrt(),
            9 => v.iter().sum(),
            10 => sum_sq_dev(v) / (n - 1) as f64,
            11 => sum_sq_dev(v) / n as f64,
            12 if n == 0 => return Err(ErrorKind::Num),
            12 => {
                let s = sorted(v);
                if n % 2 == 1 {
                    s[n / 2]
                } else {
                    (s[n / 2 - 1] + s[n / 2]) / 2.0
                }
            }
            13 => mode(v)?,
            _ => {
                let k = ctx.number(&args[3])?;
                match func {
                    14 | 15 => {
                        let k = k.ceil();
                        if k < 1.0 || k > n as f64 {
                            return Err(ErrorKind::Num);
                        }
                        let s = sorted(v);
                        let i = k as usize - 1;
                        if func == 14 {
                            s[n - 1 - i]
                        } else {
                            s[i]
                        }
                    }
                    16 => inc(v, k)?,
                    17 => quartile(v, k, false)?,
                    18 => exc(v, k)?,
                    _ => quartile(v, k, true)?,
                }
            }
        };
        Ok(Value::number(x))
    }
}

/// `QUARTILE.INC` (`quart` 0..=4) / `QUARTILE.EXC` (1..=3).
fn quartile(v: &[f64], quart: f64, exclusive: bool) -> Result<f64, ErrorKind> {
    let q = quart.trunc();
    let ok = if exclusive {
        (1.0..=3.0).contains(&q)
    } else {
        (0.0..=4.0).contains(&q)
    };
    if !ok {
        return Err(ErrorKind::Num);
    }
    if exclusive {
        exc(v, q / 4.0)
    } else {
        inc(v, q / 4.0)
    }
}

/// The most frequent number (the first one on ties); none repeated `#N/A`.
fn mode(v: &[f64]) -> Result<f64, ErrorKind> {
    let mut best: Option<(f64, usize)> = None;
    for (i, x) in v.iter().enumerate() {
        let count = v[i..].iter().filter(|y| *y == x).count();
        if v[..i].contains(x) {
            continue;
        }
        if count > 1 && best.map_or(true, |(_, c)| count > c) {
            best = Some((*x, count));
        }
    }
    best.map(|(x, _)| x).ok_or(ErrorKind::NA)
}
