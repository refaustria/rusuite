//! Tests for the Phase 8 information functions.

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, eval, text};
use crate::value::Value;

#[test]
fn predicates() {
    assert_eq!(eval("=ISLOGICAL(B1)"), Value::Bool(true));
    assert_eq!(eval("=ISLOGICAL(B2)"), Value::Bool(false));
    assert_eq!(eval("=ISEVEN(2.9)"), Value::Bool(true));
    assert_eq!(eval("=ISODD(-3)"), Value::Bool(true));
    assert_eq!(err("=ISEVEN(TRUE)"), ErrorKind::Value);
    assert_eq!(eval("=ISERR(C2)"), Value::Bool(false));
    assert_eq!(eval("=ISERR(C1)"), Value::Bool(true));
    assert_eq!(eval("=ISNONTEXT(A2)"), Value::Bool(false));
    assert_eq!(eval("=ISREF(Z9)"), Value::Bool(true));
    assert_eq!(eval("=ISREF(INDEX(A1:A3,1))"), Value::Bool(true));
    assert_eq!(eval("=ISREF(SUM(1))"), Value::Bool(false));
}

#[test]
fn conversions() {
    close("=N(B1)", 1.0);
    close("=N(\"5\")", 0.0);
    assert_eq!(text("=T(A2)"), "x");
    assert_eq!(text("=T(A1)"), "");
    assert_eq!(err("=T(C1)"), ErrorKind::Div0);
}

#[test]
fn type_codes() {
    close("=TYPE(A1)", 1.0);
    close("=TYPE(A2)", 2.0);
    close("=TYPE(B1)", 4.0);
    close("=TYPE(C1)", 16.0);
    close("=TYPE(Z9)", 1.0);
    close("=TYPE(A1:A3)", 64.0);
    close("=TYPE({1,2})", 64.0);
}

#[test]
fn cell_info() {
    assert_eq!(text("=CELL(\"address\",B2)"), "$B$2");
    close("=CELL(\"row\",C7)", 7.0);
    // Default reference is the formula cell J10.
    close("=CELL(\"col\")", 10.0);
    assert_eq!(text("=CELL(\"type\",A2)"), "l");
    assert_eq!(text("=CELL(\"type\",Z9)"), "b");
    assert_eq!(err("=CELL(\"nonsense\",A1)"), ErrorKind::Value);
}
