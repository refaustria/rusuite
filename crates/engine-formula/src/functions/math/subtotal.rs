//! `SUBTOTAL(function_num, ref1, [ref2], ...)`.

use crate::ast::{ErrorKind, Expr};
use crate::eval::{CellCoord, Operand, RowHidden};
use crate::functions::statistical::{mean, sum_sq_dev};
use crate::functions::{Arity, CallContext, Function};
use crate::value::{to_number, Value};

/// Aggregates the cells of its references with the function selected by
/// `function_num`: 1 `AVERAGE`, 2 `COUNT`, 3 `COUNTA`, 4 `MAX`, 5 `MIN`,
/// 6 `PRODUCT`, 7 `STDEV`, 8 `STDEVP`, 9 `SUM`, 10 `VAR`, 11 `VARP`.
/// Rows hidden by a filter are always skipped; 101–111 also skip rows
/// hidden by hand. Cells that hold a `SUBTOTAL` themselves are skipped
/// (no double counting). Hidden columns are not skipped (as in Excel).
/// Every argument after the first must be a reference (`#VALUE!`
/// otherwise); an error in the cells is the result, except for COUNT and
/// COUNTA.
pub struct Subtotal;

impl Function for Subtotal {
    fn name(&self) -> &'static str {
        "SUBTOTAL"
    }

    fn arity(&self) -> Arity {
        Arity::range(2, 255)
    }

    fn reads_row_visibility(&self) -> bool {
        true
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let num = match ctx.scalar(&args[0]) {
            Value::Error(e) => return Value::Error(e),
            v => match to_number(&v) {
                Ok(n) => n.trunc(),
                Err(e) => return Value::Error(e),
            },
        };
        let (kind, skip_manual) = match num as i64 {
            n @ 1..=11 => (n, false),
            n @ 101..=111 => (n - 100, true),
            _ => return Value::Error(ErrorKind::Value),
        };
        let provider = ctx.eval_context().provider;
        let mut numbers = Vec::new();
        let mut non_empty = 0u32;
        let mut first_error = None;
        for arg in &args[1..] {
            let range = match ctx.eval_ref(arg) {
                Operand::Range(r) => r,
                Operand::Scalar(Value::Error(e)) => return Value::Error(e),
                Operand::Scalar(_) => return Value::Error(ErrorKind::Value),
            };
            let Some(r) = range.clipped(provider) else {
                continue;
            };
            for row in r.r0..=r.r1 {
                match provider.row_hidden(r.sheet, row) {
                    RowHidden::Filtered => continue,
                    RowHidden::Manual if skip_manual => continue,
                    _ => {}
                }
                for col in r.c0..=r.c1 {
                    let c = CellCoord::new(r.sheet, row, col);
                    let v = provider.value(c);
                    if matches!(v, Value::Empty) || provider.is_subtotal_cell(c) {
                        continue;
                    }
                    non_empty += 1;
                    match v {
                        Value::Number(n) => numbers.push(n),
                        Value::Error(e) => {
                            first_error.get_or_insert(e);
                        }
                        _ => {}
                    }
                }
            }
        }
        if let (Some(e), false) = (first_error, matches!(kind, 2 | 3)) {
            return Value::Error(e);
        }
        let n = numbers.len();
        let div0 = Value::Error(ErrorKind::Div0);
        match kind {
            1 if n == 0 => div0,
            1 => Value::number(mean(&numbers)),
            2 => Value::Number(n as f64),
            3 => Value::Number(f64::from(non_empty)),
            4 => Value::number(numbers.iter().copied().reduce(f64::max).unwrap_or(0.0)),
            5 => Value::number(numbers.iter().copied().reduce(f64::min).unwrap_or(0.0)),
            6 if n == 0 => Value::Number(0.0),
            6 => Value::number(numbers.iter().product()),
            7 | 10 if n < 2 => div0,
            8 | 11 if n < 1 => div0,
            7 => Value::number((sum_sq_dev(&numbers) / (n - 1) as f64).sqrt()),
            8 => Value::number((sum_sq_dev(&numbers) / n as f64).sqrt()),
            10 => Value::number(sum_sq_dev(&numbers) / (n - 1) as f64),
            11 => Value::number(sum_sq_dev(&numbers) / n as f64),
            _ => Value::number(numbers.iter().sum()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::ast::ErrorKind;
    use crate::eval::{evaluate, CellCoord, CellProvider, EvalContext, RowHidden, SheetId};
    use crate::functions::test_support::eval;
    use crate::functions::FunctionRegistry;
    use crate::value::Value;

    /// A1:A6 = 1..6 with row 2 hidden by hand and row 4 by a filter;
    /// A7 = SUBTOTAL formula (flagged as such); B1 = "x", B2 = #N/A.
    struct Hidden(HashMap<(u32, u32), Value>);

    impl CellProvider for Hidden {
        fn sheet_id(&self, name: &str) -> Option<SheetId> {
            name.eq_ignore_ascii_case("S1").then_some(SheetId(0))
        }
        fn value(&self, c: CellCoord) -> Value {
            self.0.get(&(c.row, c.col)).cloned().unwrap_or(Value::Empty)
        }
        fn used_range(&self, _: SheetId) -> Option<(u32, u32)> {
            Some((6, 1))
        }
        fn row_hidden(&self, _: SheetId, row: u32) -> RowHidden {
            match row {
                1 => RowHidden::Manual,
                3 => RowHidden::Filtered,
                _ => RowHidden::Visible,
            }
        }
        fn is_subtotal_cell(&self, c: CellCoord) -> bool {
            (c.row, c.col) == (6, 0)
        }
    }

    fn hidden(formula: &str) -> Value {
        let mut cells: HashMap<(u32, u32), Value> = (0..6)
            .map(|r| ((r, 0), Value::Number(f64::from(r + 1))))
            .collect();
        cells.insert((6, 0), Value::Number(1000.0));
        cells.insert((0, 1), Value::Text("x".into()));
        cells.insert((1, 1), Value::Error(ErrorKind::NA));
        let grid = Hidden(cells);
        let registry = FunctionRegistry::with_builtins();
        let ctx = EvalContext::new(&grid, &registry, CellCoord::new(SheetId(0), 9, 9));
        evaluate(&crate::parse(formula).unwrap(), &ctx)
    }

    #[test]
    fn hidden_rows_and_nested_subtotals() {
        // Visible: 1, 3, 5, 6 (+2 hand-hidden, 4 filtered; A7 nested).
        assert_eq!(hidden("=SUBTOTAL(9,A1:A7)"), Value::Number(17.0));
        assert_eq!(hidden("=SUBTOTAL(109,A1:A7)"), Value::Number(15.0));
        assert_eq!(hidden("=SUBTOTAL(2,A1:A7)"), Value::Number(5.0));
        assert_eq!(hidden("=SUBTOTAL(102,A:A)"), Value::Number(4.0));
        assert_eq!(hidden("=SUBTOTAL(4,A1:A7)"), Value::Number(6.0));
        assert_eq!(hidden("=SUBTOTAL(105,A2:A2)"), Value::Number(0.0));
        // B2 (#N/A) sits in the hand-hidden row.
        assert_eq!(hidden("=SUBTOTAL(9,B1:B2)"), Value::Error(ErrorKind::NA));
        assert_eq!(hidden("=SUBTOTAL(109,B1:B2)"), Value::Number(0.0));
        assert_eq!(hidden("=SUBTOTAL(3,A1:B7)"), Value::Number(7.0));
        assert_eq!(hidden("=SUBTOTAL(103,A1:B7)"), Value::Number(5.0));
    }

    #[test]
    fn every_function_number() {
        // A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5"; C1 = #DIV/0!.
        let cases = [
            (1, 2.0),
            (2, 2.0),
            (3, 5.0),
            (4, 3.0),
            (5, 1.0),
            (6, 3.0),
            (7, 2f64.sqrt()),
            (8, 1.0),
            (9, 4.0),
            (10, 2.0),
            (11, 1.0),
        ];
        for (n, want) in cases {
            assert_eq!(
                eval(&format!("=SUBTOTAL({n},A1:A3,B1:B2)")),
                Value::Number(want),
                "{n}"
            );
            assert_eq!(
                eval(&format!("=SUBTOTAL({},A1:A3,B1:B2)", n + 100)),
                Value::Number(want),
                "{}",
                n + 100
            );
        }
    }

    #[test]
    fn errors_and_bad_arguments() {
        assert_eq!(eval("=SUBTOTAL(9,A1:C1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=SUBTOTAL(2,A1:C1)"), Value::Number(1.0));
        assert_eq!(eval("=SUBTOTAL(3,A1:C1)"), Value::Number(3.0));
        assert_eq!(eval("=SUBTOTAL(12,A1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=SUBTOTAL(0,A1)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=SUBTOTAL(9.7,A1:A3)"), Value::Number(4.0));
        assert_eq!(eval("=SUBTOTAL(9,{1,2})"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=SUBTOTAL(9,5)"), Value::Error(ErrorKind::Value));
        assert_eq!(eval("=SUBTOTAL(#N/A,A1)"), Value::Error(ErrorKind::NA));
        assert_eq!(eval("=SUBTOTAL(1,B1:B2)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=SUBTOTAL(7,A1)"), Value::Error(ErrorKind::Div0));
        assert_eq!(eval("=SUBTOTAL(6,B1:B2)"), Value::Number(0.0));
    }
}
