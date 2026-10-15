//! Tests for `IFS`, `SWITCH`, `IFNA`, `XOR`.

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, eval, text};
use crate::value::Value;

#[test]
fn ifs_is_lazy_and_checks_pairs() {
    assert_eq!(text("=IFS(FALSE,\"a\",TRUE,\"b\",1/0,\"c\")"), "b");
    assert_eq!(err("=IFS(FALSE,1,TRUE)"), ErrorKind::NA);
    assert_eq!(err("=IFS(\"x\",1)"), ErrorKind::Value);
    assert_eq!(err("=IFS(#N/A,1)"), ErrorKind::NA);
    assert_eq!(err("=IFS(TRUE)"), ErrorKind::Value);
}

#[test]
fn switch_semantics() {
    assert_eq!(
        text("=SWITCH(\"A\",\"a\",\"low\",\"b\",\"b\",\"d\")"),
        "low"
    );
    assert_eq!(text("=SWITCH(7,1,\"x\",\"d\")"), "d");
    // A number never equals text.
    assert_eq!(err("=SWITCH(1,\"1\",\"x\")"), ErrorKind::NA);
    assert_eq!(err("=SWITCH(#DIV/0!,1,2)"), ErrorKind::Div0);
    // Only the chosen result is evaluated.
    close("=SWITCH(1,1,5,2,1/0)", 5.0);
}

#[test]
fn ifna_and_xor() {
    close("=IFNA(NA(),4)", 4.0);
    assert_eq!(err("=IFNA(1/0,4)"), ErrorKind::Div0);
    assert_eq!(eval("=XOR({TRUE,FALSE,TRUE})"), Value::Bool(false));
    assert_eq!(eval("=XOR(A1:A3)"), Value::Bool(false));
    assert_eq!(eval("=XOR(A1:A3,1)"), Value::Bool(true));
    assert_eq!(err("=XOR(\"a\")"), ErrorKind::Value);
}
