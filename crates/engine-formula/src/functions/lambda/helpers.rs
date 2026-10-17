//! The lambda helper functions: `MAP`, `REDUCE`, `SCAN`, `BYROW`, `BYCOL`
//! and `MAKEARRAY`. Their last argument is a lambda (`LAMBDA(...)`, a
//! `LET` name or a defined name); anything else is `#VALUE!`. A lambda
//! returning an array where one value is expected gives `#CALC!`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::array::{cell_count, size_arg, Grid};
use crate::functions::lambda::{call_values, lambda_of, LambdaFn};
use crate::functions::{Arity, CallContext, Function};
use crate::value::{Array, Value};

fn lambda_arg(ctx: &CallContext, e: &Expr) -> Result<std::rc::Rc<LambdaFn>, ErrorKind> {
    lambda_of(e, ctx.eval_context()).ok_or(ErrorKind::Value)
}

/// One value of a lambda result (an array of more than one cell is
/// `#CALC!`).
fn single(v: Value) -> Value {
    match v {
        Value::Array(a) if a.rows() * a.cols() > 1 => Value::Error(ErrorKind::Calc),
        v => v.into_scalar(),
    }
}

/// A row or column of a grid as a lambda argument.
fn line(values: Vec<Value>, row: bool) -> Value {
    let n = values.len();
    if n == 1 {
        return values.into_iter().next().unwrap_or(Value::Empty);
    }
    let (r, c) = if row { (1, n) } else { (n, 1) };
    Array::new(r, c, values).map_or(Value::Error(ErrorKind::Value), Value::Array)
}

fn grid_value(rows: usize, cols: usize, data: Vec<Value>) -> Result<Value, ErrorKind> {
    Grid { rows, cols, data }.into_value()
}

/// `MAP(array1, [array2, ...], lambda)`: the lambda applied to the
/// elements at each position (the arrays must have the same size; a
/// single value is used at every position).
pub struct Map;

impl Function for Map {
    fn name(&self) -> &'static str {
        "MAP"
    }
    fn arity(&self) -> Arity {
        Arity::range(2, 254)
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let run = || -> Result<Value, ErrorKind> {
            let (f, arrays) = args.split_last().expect("two arguments");
            let f = lambda_arg(ctx, f)?;
            let grids = arrays
                .iter()
                .map(|a| Grid::of(ctx, a))
                .collect::<Result<Vec<_>, _>>()?;
            let (rows, cols) = grids
                .iter()
                .filter(|g| g.rows * g.cols > 1)
                .map(|g| (g.rows, g.cols))
                .next()
                .unwrap_or((1, 1));
            if grids
                .iter()
                .any(|g| g.rows * g.cols > 1 && (g.rows, g.cols) != (rows, cols))
            {
                return Err(ErrorKind::Value);
            }
            let mut out = Vec::with_capacity(rows * cols);
            for r in 0..rows {
                for c in 0..cols {
                    let values = grids
                        .iter()
                        .map(|g| {
                            if g.rows * g.cols == 1 {
                                g.data[0].clone()
                            } else {
                                g.get(r, c).clone()
                            }
                        })
                        .collect();
                    out.push(single(call_values(&f, values, ctx.eval_context())));
                }
            }
            grid_value(rows, cols, out)
        };
        run().unwrap_or_else(Value::Error)
    }
}

/// `REDUCE([initial_value], array, lambda(accumulator, value))`: the
/// accumulated result (it may be an array: `REDUCE(,A1:A3,LAMBDA(a,v,VSTACK(a,v)))`).
pub struct Reduce;

impl Function for Reduce {
    fn name(&self) -> &'static str {
        "REDUCE"
    }
    fn arity(&self) -> Arity {
        Arity::exact(3)
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let run = || -> Result<Value, ErrorKind> {
            let f = lambda_arg(ctx, &args[2])?;
            let mut acc = if ctx.is_missing(&args[0]) {
                Value::Empty
            } else {
                crate::functions::lambda::operand_value(
                    ctx.eval_array(&args[0]),
                    ctx.eval_context(),
                )
            };
            let g = Grid::of(ctx, &args[1])?;
            for v in g.data {
                acc = call_values(&f, vec![acc, v], ctx.eval_context());
            }
            Ok(acc)
        };
        run().unwrap_or_else(Value::Error)
    }
}

/// `SCAN([initial_value], array, lambda(accumulator, value))`: every
/// intermediate accumulator, in the shape of `array`.
pub struct Scan;

impl Function for Scan {
    fn name(&self) -> &'static str {
        "SCAN"
    }
    fn arity(&self) -> Arity {
        Arity::exact(3)
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let run = || -> Result<Value, ErrorKind> {
            let f = lambda_arg(ctx, &args[2])?;
            let mut acc = if ctx.is_missing(&args[0]) {
                Value::Empty
            } else {
                ctx.scalar(&args[0])
            };
            let g = Grid::of(ctx, &args[1])?;
            let mut out = Vec::with_capacity(g.data.len());
            for v in g.data {
                acc = single(call_values(&f, vec![acc, v], ctx.eval_context()));
                out.push(acc.clone());
            }
            grid_value(g.rows, g.cols, out)
        };
        run().unwrap_or_else(Value::Error)
    }
}

/// `BYROW(array, lambda(row))` / `BYCOL(array, lambda(column))`.
fn by_line(args: &[Expr], ctx: &CallContext, rows: bool) -> Result<Value, ErrorKind> {
    let f = lambda_arg(ctx, &args[1])?;
    let g = Grid::of(ctx, &args[0])?;
    let n = if rows { g.rows } else { g.cols };
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let values = if rows {
            g.row(i).to_vec()
        } else {
            (0..g.rows).map(|r| g.get(r, i).clone()).collect()
        };
        out.push(single(call_values(
            &f,
            vec![line(values, rows)],
            ctx.eval_context(),
        )));
    }
    if rows {
        grid_value(n, 1, out)
    } else {
        grid_value(1, n, out)
    }
}

/// `BYROW(array, lambda(row))`: one result per row (a column).
pub struct ByRow;

impl Function for ByRow {
    fn name(&self) -> &'static str {
        "BYROW"
    }
    fn arity(&self) -> Arity {
        Arity::exact(2)
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        by_line(args, ctx, true).unwrap_or_else(Value::Error)
    }
}

/// `BYCOL(array, lambda(column))`: one result per column (a row).
pub struct ByCol;

impl Function for ByCol {
    fn name(&self) -> &'static str {
        "BYCOL"
    }
    fn arity(&self) -> Arity {
        Arity::exact(2)
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        by_line(args, ctx, false).unwrap_or_else(Value::Error)
    }
}

/// `MAKEARRAY(rows, columns, lambda(row, column))`: the lambda of each
/// 1-based position. Sizes as `SEQUENCE` (zero or negative `#VALUE!`).
pub struct MakeArray;

impl Function for MakeArray {
    fn name(&self) -> &'static str {
        "MAKEARRAY"
    }
    fn arity(&self) -> Arity {
        Arity::exact(3)
    }
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let run = || -> Result<Value, ErrorKind> {
            let rows = size_arg(ctx.number(&args[0])?).map_err(|_| ErrorKind::Value)?;
            let cols = size_arg(ctx.number(&args[1])?).map_err(|_| ErrorKind::Value)?;
            cell_count(rows, cols)?;
            let f = lambda_arg(ctx, &args[2])?;
            let mut out = Vec::with_capacity(rows * cols);
            for r in 0..rows {
                for c in 0..cols {
                    let v = call_values(
                        &f,
                        vec![Value::Number((r + 1) as f64), Value::Number((c + 1) as f64)],
                        ctx.eval_context(),
                    );
                    out.push(single(v));
                }
            }
            grid_value(rows, cols, out)
        };
        run().unwrap_or_else(Value::Error)
    }
}
