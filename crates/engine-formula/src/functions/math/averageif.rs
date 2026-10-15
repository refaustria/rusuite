//! `AVERAGEIF(range, criteria, [average_range])`.

use crate::ast::ErrorKind;
use crate::functions::math::criteria::{at, cells, Criteria};
use crate::functions::Arity;
use crate::value::Value;

function!(
    /// Mean of the numeric cells whose counterpart in `range` satisfies
    /// `criteria` (`average_range` is aligned by its top-left cell); no
    /// numeric match is `#DIV/0!`.
    AverageIf, "AVERAGEIF", Arity::range(2, 3), |args, ctx| {
    let range = ctx.range(&args[0])?;
    let crit = Criteria::parse(&ctx.scalar(&args[1]))?;
    let avg = match args.get(2) {
        Some(a) if !ctx.is_missing(a) => Some(ctx.range(a)?),
        _ => None,
    };
    let (mut total, mut n) = (0.0, 0usize);
    for (r, c, v) in cells(&range) {
        if !crit.matches(&v) {
            continue;
        }
        let target = match &avg {
            Some(s) => at(s, r, c).unwrap_or(Value::Empty),
            None => v,
        };
        match target {
            Value::Number(x) => {
                total += x;
                n += 1;
            }
            Value::Error(e) => return Err(e),
            _ => {}
        }
    }
    if n == 0 {
        return Err(ErrorKind::Div0);
    }
    Ok(Value::number(total / n as f64))
});
