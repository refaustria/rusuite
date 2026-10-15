//! `MATCH(value, range, [match_type=1])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::{find, lookup_value, Mode, Table};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Position of a value in a one-dimensional range: type 0 exact (with
/// wildcards), 1 largest <= (ascending), -1 smallest >= (descending).
pub struct Match;

impl Function for Match {
    fn name(&self) -> &'static str {
        "MATCH"
    }

    fn arity(&self) -> Arity {
        Arity::range(2, 3)
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        match run(args, ctx) {
            Ok(v) => v,
            Err(e) => Value::Error(e),
        }
    }
}

fn run(args: &[Expr], ctx: &CallContext) -> Result<Value, ErrorKind> {
    let lookup = ctx.scalar(&args[0]);
    if let Value::Error(e) = lookup {
        return Err(e);
    }
    let table = Table::new(ctx.range(&args[1])?);
    let kind = match args.get(2) {
        Some(e) if !ctx.is_missing(e) => ctx.number(e)?.trunc(),
        _ => 1.0,
    };
    let mode = if kind > 0.0 {
        Mode::Asc
    } else if kind < 0.0 {
        Mode::Desc
    } else {
        Mode::Exact
    };
    if table.rows > 1 && table.cols > 1 {
        return Err(ErrorKind::NA);
    }
    let pos = if table.cols == 1 {
        find(
            &lookup_value(lookup),
            table.used_rows,
            |i| table.get(i, 0),
            mode,
        )
    } else {
        find(
            &lookup_value(lookup),
            table.used_cols,
            |i| table.get(0, i),
            mode,
        )
    };
    pos.map(|p| Value::Number((p + 1) as f64))
        .ok_or(ErrorKind::NA)
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn match_types() {
        assert_eq!(eval("=MATCH(3,{1,2,3,5},0)"), Value::Number(3.0));
        assert_eq!(eval("=MATCH(4,{1,2,3,5})"), Value::Number(3.0));
        assert_eq!(eval("=MATCH(4,{1,2,3,5},1)"), Value::Number(3.0));
        assert_eq!(eval("=MATCH(4,{9;5;3;1},-1)"), Value::Number(2.0));
        assert_eq!(eval("=MATCH(\"X*\",A1:A3,0)"), Value::Number(2.0));
        assert_eq!(eval("=MATCH(\"X\",A1:A3,0)"), Value::Number(2.0));
        assert_eq!(eval("=MATCH(TRUE,B1:B2,0)"), Value::Number(1.0));
    }

    #[test]
    fn not_found() {
        assert_eq!(eval("=MATCH(0,{1,2,3},1)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=MATCH(9,{1,2,3},0)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=MATCH(\"5\",A1:A3,0)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=MATCH(1,A1:B3,0)"), Value::Error(ErrorKind::NA));
        assert_eq!(
            eval("=MATCH(\"a~*\",{\"a*\",\"ab\"},0)"),
            Value::Number(1.0)
        );
        assert_eq!(
            eval("=MATCH(\"a*c\",{\"abd\",\"ABXC\"},0)"),
            Value::Number(2.0)
        );
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(eval("=MATCH(C1,A1:A3,0)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=MATCH(1,A1:A3,C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=MATCH(1,#DIV/0!)"), Value::Error(ErrorKind::Div0));
    }
}
