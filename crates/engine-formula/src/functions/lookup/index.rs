//! `INDEX(array, row, [col])`.

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::{index_numbers, select, Table};
use crate::functions::{Arity, CallContext, Function};
use crate::value::{Array, Value};

/// Element, row or column of a range/array. An index of 0 returns the
/// whole row/column as an array. Used as a reference (`A1:INDEX(..)`) is
/// not supported; `ROW`/`COLUMN` accept a direct `INDEX` call though.
pub struct Index;

impl Function for Index {
    fn name(&self) -> &'static str {
        "INDEX"
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
    let table = Table::new(ctx.range(&args[0])?);
    let (row, col) = index_numbers(args, ctx)?;
    let s = select(table.rows, table.cols, row, col)?;
    // Whole-column/row ranges only materialise their used part.
    let nr = s.nr.min(table.used_rows.max(1)).max(1);
    let nc = s.nc.min(table.used_cols.max(1)).max(1);
    let (nr, nc) = (
        if s.nr == 1 { 1 } else { nr },
        if s.nc == 1 { 1 } else { nc },
    );
    if nr == 1 && nc == 1 {
        return Ok(table.get(s.r0, s.c0));
    }
    let mut data = Vec::with_capacity(nr * nc);
    for r in 0..nr {
        for c in 0..nc {
            data.push(table.get(s.r0 + r, s.c0 + c));
        }
    }
    Array::new(nr, nc, data)
        .map(Value::Array)
        .ok_or(ErrorKind::Value)
}

#[cfg(test)]
mod tests {
    use crate::ast::ErrorKind;
    use crate::functions::test_support::eval;
    use crate::value::Value;

    #[test]
    fn elements() {
        assert_eq!(eval("=INDEX(A1:A3,3)"), Value::Number(3.0));
        assert_eq!(eval("=INDEX(A1:B2,2,2)"), Value::Text("5".into()));
        assert_eq!(eval("=INDEX(A1:C1,2)"), Value::Bool(true));
        assert_eq!(eval("=INDEX({1,2;3,4},2,1)"), Value::Number(3.0));
        assert_eq!(eval("=INDEX(A1:A3,2.9)"), Value::Text("x".into()));
        assert_eq!(eval("=INDEX(A1:B3,3,2)"), Value::Number(0.0));
    }

    #[test]
    fn whole_row_column() {
        assert_eq!(eval("=SUM(INDEX({1,2;3,4},0,2))"), Value::Number(6.0));
        assert_eq!(eval("=SUM(INDEX({1,2;3,4},2,0))"), Value::Number(7.0));
        assert_eq!(eval("=SUM(INDEX({1,2;3,4},2))"), Value::Number(7.0));
        assert_eq!(eval("=SUM(INDEX({1,2;3,4},0,0))"), Value::Number(10.0));
        assert_eq!(eval("=INDEX({1,2;3,4},,2)"), Value::Number(2.0));
    }

    #[test]
    fn errors() {
        assert_eq!(eval("=INDEX(A1:A3,4)"), Value::Error(ErrorKind::Ref));
        assert_eq!(eval("=INDEX(A1:B3,1,3)"), Value::Error(ErrorKind::Ref));
        assert_eq!(eval("=INDEX(A1:A3,-1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=INDEX(C1:C2,1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=INDEX(A1:A3,C2)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=INDEX(#N/A,1)"), Value::Error(ErrorKind::NA));
    }
}
