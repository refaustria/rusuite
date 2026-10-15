//! Tests for the dynamic array functions (fixture: A1:A3 = 1, "x", 3;
//! B1 = TRUE; B2 = "5"; C1 = #DIV/0!; C2 = #N/A; evaluated in J10).

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, eval_cell, text};
use crate::value::{Array, Value};

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn t(s: &str) -> Value {
    Value::Text(s.into())
}

fn arr(rows: Vec<Vec<Value>>) -> Value {
    Value::Array(Array::from_rows(rows).unwrap())
}

#[test]
fn sequence_shapes_and_errors() {
    assert_eq!(
        eval_cell("=SEQUENCE(3)"),
        arr(vec![vec![n(1.0)], vec![n(2.0)], vec![n(3.0)]])
    );
    assert_eq!(
        eval_cell("=SEQUENCE(2,3,10,-2)"),
        arr(vec![
            vec![n(10.0), n(8.0), n(6.0)],
            vec![n(4.0), n(2.0), n(0.0)]
        ])
    );
    assert_eq!(eval_cell("=SEQUENCE(1)"), n(1.0));
    assert_eq!(
        eval_cell("=SEQUENCE(2.9,,5)"),
        arr(vec![vec![n(5.0)], vec![n(6.0)]])
    );
    close("=SUM(SEQUENCE(4))", 10.0);
    close("=INDEX(SEQUENCE(3,3),2,3)", 6.0);
    assert_eq!(err("=SEQUENCE(0)"), ErrorKind::Calc);
    assert_eq!(err("=SEQUENCE(-1)"), ErrorKind::Value);
    assert_eq!(err("=SEQUENCE(\"a\")"), ErrorKind::Value);
    assert_eq!(err("=SEQUENCE(100000,1000)"), ErrorKind::Num);
}

#[test]
fn randarray_bounds() {
    let Value::Array(a) = eval_cell("=RANDARRAY(4,5,10,20,TRUE)") else {
        panic!("array expected");
    };
    assert_eq!((a.rows(), a.cols()), (4, 5));
    for v in a.values() {
        let Value::Number(x) = v else { panic!("{v:?}") };
        assert!((10.0..=20.0).contains(x) && x.fract() == 0.0, "{x}");
    }
    let Value::Number(x) = eval_cell("=RANDARRAY()") else {
        panic!("number expected");
    };
    assert!((0.0..1.0).contains(&x));
    assert_eq!(err("=RANDARRAY(2,2,5,1)"), ErrorKind::Value);
    assert_eq!(err("=RANDARRAY(2,2,0.5,3,TRUE)"), ErrorKind::Value);
    close("=ROWS(RANDARRAY(7))", 7.0);
}

#[test]
fn sort_orders_by_type_and_keys() {
    assert_eq!(
        eval_cell("=SORT({3;1;2})"),
        arr(vec![vec![n(1.0)], vec![n(2.0)], vec![n(3.0)]])
    );
    assert_eq!(
        eval_cell("=SORT({3;1;2},1,-1)"),
        arr(vec![vec![n(3.0)], vec![n(2.0)], vec![n(1.0)]])
    );
    // Numbers < text < booleans; text case-insensitive.
    assert_eq!(
        eval_cell("=SORT({\"b\";TRUE;2;\"A\"})"),
        arr(vec![
            vec![n(2.0)],
            vec![t("A")],
            vec![t("b")],
            vec![Value::Bool(true)]
        ])
    );
    // By the second column, then the first descending.
    assert_eq!(
        eval_cell("=SORT({1,\"b\";2,\"a\";3,\"b\"},{2,1},{1,-1})"),
        arr(vec![
            vec![n(2.0), t("a")],
            vec![n(3.0), t("b")],
            vec![n(1.0), t("b")]
        ])
    );
    assert_eq!(
        eval_cell("=SORT({3,1,2},1,1,TRUE)"),
        arr(vec![vec![n(1.0), n(2.0), n(3.0)]])
    );
    // Blank cells sort last (and show as 0 when spilled).
    assert_eq!(
        eval_cell("=SORT(A1:A4,1,-1)"),
        arr(vec![vec![t("x")], vec![n(3.0)], vec![n(1.0)], vec![n(0.0)]])
    );
    assert_eq!(err("=SORT({1;2},2)"), ErrorKind::Value);
    assert_eq!(err("=SORT({1;2},1,0)"), ErrorKind::Value);
    assert_eq!(err("=SORT(C1:C2)"), ErrorKind::Div0);
}

#[test]
fn sortby_uses_parallel_keys() {
    assert_eq!(
        eval_cell("=SORTBY({\"a\";\"b\";\"c\"},{3;1;2})"),
        arr(vec![vec![t("b")], vec![t("c")], vec![t("a")]])
    );
    assert_eq!(
        eval_cell("=SORTBY({\"a\";\"b\";\"c\"},{1;2;1},-1,{3;2;1},1)"),
        arr(vec![vec![t("b")], vec![t("c")], vec![t("a")]])
    );
    assert_eq!(
        eval_cell("=SORTBY({\"a\",\"b\"},{2,1})"),
        arr(vec![vec![t("b"), t("a")]])
    );
    assert_eq!(err("=SORTBY({1;2;3},{1;2})"), ErrorKind::Value);
    assert_eq!(err("=SORTBY({1;2},{2;1},2)"), ErrorKind::Value);
}

#[test]
fn filter_rows_and_columns() {
    assert_eq!(
        eval_cell("=FILTER({1;2;3;4},{1;2;3;4}>2)"),
        arr(vec![vec![n(3.0)], vec![n(4.0)]])
    );
    assert_eq!(
        eval_cell("=FILTER({1,2;3,4},{FALSE;TRUE})"),
        arr(vec![vec![n(3.0), n(4.0)]])
    );
    assert_eq!(
        eval_cell("=FILTER({1,2,3},{1,0,1})"),
        arr(vec![vec![n(1.0), n(3.0)]])
    );
    assert_eq!(text("=FILTER({1;2},{0;0},\"none\")"), "none");
    assert_eq!(err("=FILTER({1;2},{0;0})"), ErrorKind::Calc);
    assert_eq!(err("=FILTER({1;2},{1;2;3})"), ErrorKind::Value);
    assert_eq!(err("=FILTER({1;2},{\"a\";1})"), ErrorKind::Value);
    assert_eq!(err("=FILTER(A1:A2,C1:C2)"), ErrorKind::Div0);
}

#[test]
fn unique_rows_columns_once() {
    assert_eq!(
        eval_cell("=UNIQUE({1;2;1;\"a\";\"A\"})"),
        arr(vec![vec![n(1.0)], vec![n(2.0)], vec![t("a")]])
    );
    assert_eq!(
        eval_cell("=UNIQUE({1;2;1;3},,TRUE)"),
        arr(vec![vec![n(2.0)], vec![n(3.0)]])
    );
    assert_eq!(
        eval_cell("=UNIQUE({1,1,2;3,3,4},TRUE)"),
        arr(vec![vec![n(1.0), n(2.0)], vec![n(3.0), n(4.0)]])
    );
    assert_eq!(
        eval_cell("=UNIQUE({1,2;1,2;1,3})"),
        arr(vec![vec![n(1.0), n(2.0)], vec![n(1.0), n(3.0)]])
    );
    assert_eq!(err("=UNIQUE({1;1},,TRUE)"), ErrorKind::Calc);
    // "1" (text) and 1 differ.
    close("=ROWS(UNIQUE({1;\"1\"}))", 2.0);
}

#[test]
fn cell_formulas_keep_arrays() {
    assert_eq!(
        eval_cell("=A1:A3"),
        arr(vec![vec![n(1.0)], vec![t("x")], vec![n(3.0)]])
    );
    assert_eq!(
        eval_cell("=A1:A2*2"),
        arr(vec![vec![n(2.0)], vec![Value::Error(ErrorKind::Value)]])
    );
    // Empty cells show 0; one cell is a scalar; `@` intersects.
    assert_eq!(eval_cell("=A4:A5"), arr(vec![vec![n(0.0)], vec![n(0.0)]]));
    assert_eq!(eval_cell("=A1:A1"), n(1.0));
    assert_eq!(eval_cell("=Z99"), n(0.0));
    assert_eq!(eval_cell("=@A1:A3"), Value::Error(ErrorKind::Value));
    assert_eq!(eval_cell("=@{5,6}"), n(5.0));
    assert_eq!(
        eval_cell("=TRANSPOSE({1;2})"),
        arr(vec![vec![n(1.0), n(2.0)]])
    );
    // No spill information in this provider: `#` gives #REF!.
    assert_eq!(eval_cell("=SUM(A1#)"), Value::Error(ErrorKind::Ref));
}
