//! `VLOOKUP(value, table, col_index, [range_lookup=TRUE])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::{find, index_arg, lookup_value, Mode, Table};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Searches the first column of `table`; approximate (sorted) match by
/// default, exact match with wildcards for `FALSE`.
pub struct Vlookup;

impl Function for Vlookup {
    fn name(&self) -> &'static str {
        "VLOOKUP"
    }

    fn arity(&self) -> Arity {
        Arity::range(3, 4)
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
    let col = ctx.number(&args[2])?.trunc();
    let approx = match args.get(3) {
        Some(e) if !ctx.is_missing(e) => ctx.bool(e)?,
        _ => true,
    };
    if col < 1.0 {
        return Err(ErrorKind::Value);
    }
    let col = index_arg(col)?;
    if col > table.cols {
        return Err(ErrorKind::Ref);
    }
    let mode = if approx { Mode::Asc } else { Mode::Exact };
    let pos = find(
        &lookup_value(lookup),
        table.used_rows,
        |i| table.get(i, 0),
        mode,
    )
    .ok_or(ErrorKind::NA)?;
    Ok(table.get(pos, col - 1))
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    const T: &str = "{1,\"a\";2,\"b\";4,\"d\"}";

    #[test]
    fn exact_and_approx() {
        assert_eq!(
            eval(&format!("=VLOOKUP(2,{T},2,FALSE)")),
            Value::Text("b".into())
        );
        assert_eq!(eval(&format!("=VLOOKUP(3,{T},2)")), Value::Text("b".into()));
        assert_eq!(
            eval(&format!("=VLOOKUP(9,{T},2,TRUE)")),
            Value::Text("d".into())
        );
        assert_eq!(
            eval("=VLOOKUP(\"Z\",A1:B3,2,FALSE)"),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(
            eval("=VLOOKUP(\"Z\",A1:B3,2,0)&\"\""),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(
            eval("=VLOOKUP(\"X\",A1:B3,2,FALSE)"),
            Value::Text("5".into())
        );
        assert_eq!(
            eval("=VLOOKUP(\"?\",A1:B3,1,FALSE)"),
            Value::Text("x".into())
        );
    }

    #[test]
    fn edges() {
        assert_eq!(
            eval(&format!("=VLOOKUP(0,{T},2)")),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(
            eval(&format!("=VLOOKUP(1,{T},0,FALSE)")),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(
            eval(&format!("=VLOOKUP(1,{T},3,FALSE)")),
            Value::Error(ErrorKind::Ref)
        );
        assert_eq!(
            eval("=VLOOKUP(\"3\",A1:A3,1,FALSE)"),
            Value::Error(ErrorKind::NA)
        );
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(
            eval("=VLOOKUP(C1,A1:B3,2,FALSE)"),
            Value::Error(ErrorKind::Div0)
        );
        assert_eq!(
            eval("=VLOOKUP(1,C1:C2,1,FALSE)"),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(eval("=VLOOKUP(1,A1:B3,C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=VLOOKUP(1,#N/A,1)"), Value::Error(ErrorKind::NA));
    }
}
