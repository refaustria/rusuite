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

// --- P9-C4: array shaping functions ---------------------------------------

fn nums(rows: &[&[f64]]) -> Value {
    arr(rows
        .iter()
        .map(|r| r.iter().map(|&x| n(x)).collect())
        .collect())
}

#[test]
fn take_and_drop() {
    let a = "{1,2,3;4,5,6;7,8,9}";
    assert_eq!(
        eval_cell(&format!("=TAKE({a},2)")),
        nums(&[&[1., 2., 3.], &[4., 5., 6.]])
    );
    assert_eq!(eval_cell(&format!("=TAKE({a},-1)")), nums(&[&[7., 8., 9.]]));
    assert_eq!(
        eval_cell(&format!("=TAKE({a},,2)")),
        nums(&[&[1., 2.], &[4., 5.], &[7., 8.]])
    );
    assert_eq!(
        eval_cell(&format!("=TAKE({a},-2,-1)")),
        nums(&[&[6.], &[9.]])
    );
    assert_eq!(
        eval_cell(&format!("=TAKE({a},99)")),
        eval_cell(&format!("={a}"))
    );
    assert_eq!(err(&format!("=TAKE({a},0)")), ErrorKind::Calc);
    assert_eq!(
        eval_cell(&format!("=DROP({a},1,1)")),
        nums(&[&[5., 6.], &[8., 9.]])
    );
    assert_eq!(eval_cell(&format!("=DROP({a},-2)")), nums(&[&[1., 2., 3.]]));
    assert_eq!(err(&format!("=DROP({a},3)")), ErrorKind::Calc);
    assert_eq!(eval_cell("=TAKE(A1:A3,1)"), n(1.0));
}

#[test]
fn stacking() {
    assert_eq!(
        eval_cell("=VSTACK({1,2},{3,4})"),
        nums(&[&[1., 2.], &[3., 4.]])
    );
    assert_eq!(
        eval_cell("=VSTACK({1,2},3)"),
        arr(vec![
            vec![n(1.0), n(2.0)],
            vec![n(3.0), Value::Error(ErrorKind::NA)]
        ])
    );
    assert_eq!(
        eval_cell("=HSTACK({1;2},{3;4})"),
        nums(&[&[1., 3.], &[2., 4.]])
    );
    assert_eq!(
        eval_cell("=HSTACK(1,{2;3})"),
        arr(vec![
            vec![n(1.0), n(2.0)],
            vec![Value::Error(ErrorKind::NA), n(3.0)]
        ])
    );
    assert_eq!(
        eval_cell("=VSTACK(A1:A2,B1:B2)"),
        arr(vec![
            vec![n(1.0)],
            vec![t("x")],
            vec![Value::Bool(true)],
            vec![t("5")]
        ])
    );
}

#[test]
fn choosing_rows_and_columns() {
    let a = "{1,2,3;4,5,6}";
    assert_eq!(
        eval_cell(&format!("=CHOOSECOLS({a},3,1)")),
        nums(&[&[3., 1.], &[6., 4.]])
    );
    assert_eq!(
        eval_cell(&format!("=CHOOSECOLS({a},-1)")),
        nums(&[&[3.], &[6.]])
    );
    assert_eq!(
        eval_cell(&format!("=CHOOSEROWS({a},{{2,1}})")),
        nums(&[&[4., 5., 6.], &[1., 2., 3.]])
    );
    assert_eq!(err(&format!("=CHOOSECOLS({a},0)")), ErrorKind::Value);
    assert_eq!(err(&format!("=CHOOSEROWS({a},3)")), ErrorKind::Value);
}

#[test]
fn expand_tocol_and_wrap() {
    assert_eq!(
        eval_cell("=EXPAND({1,2},2,3,0)"),
        nums(&[&[1., 2., 0.], &[0., 0., 0.]])
    );
    assert_eq!(
        eval_cell("=EXPAND({1},2)"),
        arr(vec![vec![n(1.0)], vec![Value::Error(ErrorKind::NA)]])
    );
    assert_eq!(err("=EXPAND({1,2;3,4},1)"), ErrorKind::Value);
    assert_eq!(
        eval_cell("=TOCOL({1,2;3,4})"),
        nums(&[&[1.], &[2.], &[3.], &[4.]])
    );
    assert_eq!(
        eval_cell("=TOCOL({1,2;3,4},0,TRUE)"),
        nums(&[&[1.], &[3.], &[2.], &[4.]])
    );
    assert_eq!(eval_cell("=TOROW(C1:C3,3)"), err_or_calc());
    assert_eq!(
        eval_cell("=TOROW(A1:A3,2)"),
        arr(vec![vec![n(1.0), t("x"), n(3.0)]])
    );
    assert_eq!(
        eval_cell("=TOCOL(A1:C2,3)"),
        arr(vec![
            vec![n(1.0)],
            vec![Value::Bool(true)],
            vec![t("x")],
            vec![t("5")]
        ])
    );
    assert_eq!(
        eval_cell("=WRAPROWS({1,2,3,4,5},2)"),
        arr(vec![
            vec![n(1.0), n(2.0)],
            vec![n(3.0), n(4.0)],
            vec![n(5.0), Value::Error(ErrorKind::NA)]
        ])
    );
    assert_eq!(
        eval_cell("=WRAPCOLS({1,2,3,4},2,0)"),
        nums(&[&[1., 3.], &[2., 4.]])
    );
    assert_eq!(err("=WRAPROWS({1,2;3,4},2)"), ErrorKind::Value);
    assert_eq!(err("=WRAPROWS({1,2},0)"), ErrorKind::Num);
}

fn err_or_calc() -> Value {
    Value::Error(ErrorKind::Calc)
}

#[test]
fn unique_by_column() {
    assert_eq!(
        eval_cell("=UNIQUE({1,2,1;3,4,3},TRUE)"),
        nums(&[&[1., 2.], &[3., 4.]])
    );
    close("=COLUMNS(UNIQUE({1,1,2},TRUE))", 2.0);
}

#[test]
fn scalar_functions_lift_over_arrays() {
    assert_eq!(
        eval_cell("=LEN({\"ab\";\"c\";\"\"})"),
        nums(&[&[2.], &[1.], &[0.]])
    );
    assert_eq!(eval_cell("=LEN(A1:A3)"), nums(&[&[1.], &[1.], &[1.]]));
    assert_eq!(eval_cell("=ROUND({1.25,2.35},1)"), nums(&[&[1.3, 2.4]]));
    assert_eq!(eval_cell("=ROUND(1.2345,{1;2})"), nums(&[&[1.2], &[1.23]]));
    assert_eq!(
        eval_cell("=LEFT({\"abc\",\"de\"},{1;2})"),
        arr(vec![vec![t("a"), t("d")], vec![t("ab"), t("de")]])
    );
    assert_eq!(
        eval_cell("=IF({1,0,1},\"y\",\"n\")"),
        arr(vec![vec![t("y"), t("n"), t("y")]])
    );
    assert_eq!(
        eval_cell("=IF(A1:A3=1,10,{1;2;3})"),
        nums(&[&[10.], &[2.], &[3.]])
    );
    assert_eq!(eval_cell("=IFERROR(1/{1,0},-1)"), nums(&[&[1., -1.]]));
    assert_eq!(
        eval_cell("=ISNUMBER(A1:A3)"),
        arr(vec![
            vec![Value::Bool(true)],
            vec![Value::Bool(false)],
            vec![Value::Bool(true)]
        ])
    );
    assert_eq!(eval_cell("=MATCH({3,1},{1,2,3},0)"), nums(&[&[3., 1.]]));
    // Inside functions taking arrays.
    close("=SUM(LEN({\"ab\",\"c\"}))", 3.0);
    close("=SUMPRODUCT(LEN({\"ab\",\"c\"}))", 3.0);
    // A scalar call is unchanged.
    assert_eq!(text("=LEFT(\"abc\",2)"), "ab");
    // Mismatched sizes: #N/A outside the shorter array.
    assert_eq!(
        eval_cell("=POWER({1,2,3},{2,3})"),
        arr(vec![vec![n(1.0), n(8.0), Value::Error(ErrorKind::NA)]])
    );
}

#[test]
fn matrix_functions() {
    assert_eq!(
        eval_cell("=MMULT({1,2;3,4},{5;6})"),
        nums(&[&[17.], &[39.]])
    );
    assert_eq!(err("=MMULT({1,2},{1,2})"), ErrorKind::Value);
    assert_eq!(err("=MMULT({1,\"a\"},{1;2})"), ErrorKind::Value);
    close("=MDETERM({1,2;3,4})", -2.0);
    close("=MDETERM({2,0,0;0,3,0;0,0,4})", 24.0);
    close("=MDETERM({1,2;2,4})", 0.0);
    assert_eq!(err("=MDETERM({1,2,3})"), ErrorKind::Value);
    close("=INDEX(MINVERSE({4,7;2,6}),1,1)", 0.6);
    close("=INDEX(MINVERSE({4,7;2,6}),1,2)", -0.7);
    close("=INDEX(MINVERSE({4,7;2,6}),2,1)", -0.2);
    assert_eq!(err("=MINVERSE({1,2;2,4})"), ErrorKind::Num);
    close("=INDEX(MMULT(MINVERSE({2,1;1,3}),{2,1;1,3}),2,2)", 1.0);
    assert_eq!(eval_cell("=MUNIT(2)"), nums(&[&[1., 0.], &[0., 1.]]));
    assert_eq!(err("=MUNIT(0)"), ErrorKind::Value);
}

#[test]
fn aggregate_functions_and_options() {
    // A1:A3 = 1, "x", 3; C1:C2 = #DIV/0!, #N/A.
    close("=AGGREGATE(9,4,A1:A3)", 4.0);
    close("=AGGREGATE(1,0,A1:A3)", 2.0);
    close("=AGGREGATE(2,0,A1:C3)", 2.0);
    close("=AGGREGATE(3,0,A1:A3)", 3.0);
    close("=AGGREGATE(4,6,A1:C3)", 3.0);
    assert_eq!(err("=AGGREGATE(4,4,A1:C3)"), ErrorKind::Div0);
    close("=AGGREGATE(9,6,A1:C3)", 4.0);
    close("=AGGREGATE(14,6,A1:C3,1)", 3.0);
    close("=AGGREGATE(15,6,{5,1,#N/A,3},2)", 3.0);
    close("=AGGREGATE(16,0,{1,2,3,4},0.5)", 2.5);
    close("=AGGREGATE(17,0,{1,2,3,4},1)", 1.75);
    close("=AGGREGATE(12,0,A1:A3)", 2.0);
    assert_eq!(err("=AGGREGATE(13,0,A1:A3)"), ErrorKind::NA);
    close("=AGGREGATE(16,0,{1,2,3,4},1)", 4.0);
    assert_eq!(err("=AGGREGATE(20,0,A1:A3)"), ErrorKind::Value);
    assert_eq!(err("=AGGREGATE(9,8,A1:A3)"), ErrorKind::Value);
    assert_eq!(err("=AGGREGATE(9,0,{1,2})"), ErrorKind::Value);
    assert_eq!(err("=AGGREGATE(14,0,A1:A3,5)"), ErrorKind::Num);
}
