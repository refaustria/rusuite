//! `XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])`.

use crate::ast::{ErrorKind, Expr};
use crate::eval::{Operand, RangeRef};
use crate::functions::lookup::util::{lookup_value, Table};
use crate::functions::lookup::xmatch::{items, locate, modes};
use crate::functions::{Arity, CallContext, Function};
use crate::value::{Array, Value};

/// Found position and orientation, or `None` for "not found".
fn find_position(args: &[Expr], ctx: &CallContext) -> Result<Option<(usize, bool)>, ErrorKind> {
    let needle = ctx.scalar(&args[0]);
    if let Value::Error(e) = needle {
        return Err(e);
    }
    let needle = lookup_value(needle);
    let table = Table::new(ctx.range(&args[1])?);
    let (m, s) = modes(args, ctx, 4)?;
    let (items, vertical) = items(&table)?;
    Ok(locate(&needle, &items, m, s).map(|i| (i, vertical)))
}

/// Pure XLOOKUP is a reference-returning function: `XLOOKUP(..):B9` works.
pub struct XLookup;

impl Function for XLookup {
    fn name(&self) -> &'static str {
        "XLOOKUP"
    }

    fn arity(&self) -> Arity {
        Arity::range(3, 6)
    }

    /// The matching row/column of `return_array` (an array when it spans
    /// several cells; a result of several cells shows its top-left value
    /// until spilling exists). `lookup_array` and `return_array` must have
    /// the same length (`#VALUE!`). No match gives `if_not_found` (lazily
    /// evaluated) or `#N/A`. Match/search modes as in `XMATCH`.
    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let run = || -> Result<Value, ErrorKind> {
            let pos = find_position(args, ctx)?;
            let ret = ctx.range(&args[2])?;
            let Some((i, vertical)) = pos else {
                return match args.get(3) {
                    Some(e) if !ctx.is_missing(e) => Ok(ctx.scalar(e)),
                    _ => Err(ErrorKind::NA),
                };
            };
            let lookup_len = {
                let t = Table::new(ctx.range(&args[1])?);
                if vertical {
                    t.rows
                } else {
                    t.cols
                }
            };
            if (if vertical { ret.rows() } else { ret.cols() }) != lookup_len {
                return Err(ErrorKind::Value);
            }
            let (nr, nc) = if vertical {
                (1, ret.cols())
            } else {
                (ret.rows(), 1)
            };
            let mut data = Vec::with_capacity(nr * nc);
            for r in 0..nr {
                for c in 0..nc {
                    let v = if vertical {
                        ret.get(i, c)
                    } else {
                        ret.get(r, i)
                    };
                    data.push(v.unwrap_or(Value::Empty));
                }
            }
            if data.len() == 1 {
                return Ok(data.remove(0));
            }
            Array::new(nr, nc, data)
                .map(Value::Array)
                .ok_or(ErrorKind::Value)
        };
        match run() {
            Ok(v) => v,
            Err(e) => Value::Error(e),
        }
    }

    fn call_ref(&self, args: &[Expr], ctx: &mut CallContext) -> Option<Operand> {
        let Operand::Range(ret) = ctx.eval_ref(&args[2]) else {
            return None;
        };
        let (i, vertical) = find_position(args, ctx).ok()??;
        let lookup_len = {
            let t = Table::new(ctx.range(&args[1]).ok()?);
            if vertical {
                t.rows
            } else {
                t.cols
            }
        };
        if (if vertical { ret.rows() } else { ret.cols() }) as usize != lookup_len {
            return None;
        }
        let i = u32::try_from(i).ok()?;
        Some(Operand::Range(if vertical {
            RangeRef {
                r0: ret.r0 + i,
                r1: ret.r0 + i,
                ..ret
            }
        } else {
            RangeRef {
                c0: ret.c0 + i,
                c1: ret.c0 + i,
                ..ret
            }
        }))
    }
}
