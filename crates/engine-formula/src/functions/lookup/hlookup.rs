//! `HLOOKUP(value, table, row_index, [range_lookup=TRUE])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::{find, index_arg, lookup_value, Mode, Table};
use crate::functions::{Arity, CallContext, Function};
use crate::value::Value;

/// Searches the first row of `table`; mirror of `VLOOKUP`.
pub struct Hlookup;

impl Function for Hlookup {
    fn name(&self) -> &'static str {
        "HLOOKUP"
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
    let row = ctx.number(&args[2])?.trunc();
    let approx = match args.get(3) {
        Some(e) if !ctx.is_missing(e) => ctx.bool(e)?,
        _ => true,
    };
    if row < 1.0 {
        return Err(ErrorKind::Value);
    }
    let row = index_arg(row)?;
    if row > table.rows {
        return Err(ErrorKind::Ref);
    }
    let mode = if approx { Mode::Asc } else { Mode::Exact };
    let pos = find(
        &lookup_value(lookup),
        table.used_cols,
        |i| table.get(0, i),
        mode,
    )
    .ok_or(ErrorKind::NA)?;
    Ok(table.get(row - 1, pos))
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    const T: &str = "{1,2,4;\"a\",\"b\",\"d\"}";

    #[test]
    fn exact_and_approx() {
        assert_eq!(
            eval(&format!("=HLOOKUP(2,{T},2,FALSE)")),
            Value::Text("b".into())
        );
        assert_eq!(eval(&format!("=HLOOKUP(3,{T},2)")), Value::Text("b".into()));
        assert_eq!(
            eval(&format!("=HLOOKUP(5,{T},2,TRUE)")),
            Value::Text("d".into())
        );
        assert_eq!(eval("=HLOOKUP(1,A1:C3,1,FALSE)"), Value::Number(1.0));
    }

    #[test]
    fn edges() {
        assert_eq!(
            eval(&format!("=HLOOKUP(0,{T},2)")),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(
            eval(&format!("=HLOOKUP(1,{T},0,FALSE)")),
            Value::Error(ErrorKind::Value)
        );
        assert_eq!(
            eval(&format!("=HLOOKUP(1,{T},3,FALSE)")),
            Value::Error(ErrorKind::Ref)
        );
        assert_eq!(
            eval(&format!("=HLOOKUP(7,{T},2,FALSE)")),
            Value::Error(ErrorKind::NA)
        );
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(
            eval("=HLOOKUP(C1,A1:C3,2,FALSE)"),
            Value::Error(ErrorKind::Div0)
        );
        assert_eq!(
            eval("=HLOOKUP(1,A1:C3,C2,FALSE)"),
            Value::Error(ErrorKind::NA)
        );
        assert_eq!(
            eval("=HLOOKUP(1,A1:C3,2,C1)"),
            Value::Error(ErrorKind::Div0)
        );
    }
}
