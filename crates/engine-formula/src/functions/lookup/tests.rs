//! Tests for the Phase 8 lookup and reference functions.

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, eval, text};
use crate::value::Value;

#[test]
fn lookup_vector_and_array_forms() {
    close("=LOOKUP(2.5,{1,2,3},{10,20,30})", 20.0);
    close("=LOOKUP(3,{1,2,3;7,8,9})", 9.0);
    close("=LOOKUP(2,{1;2;3},{10;20;30})", 20.0);
    assert_eq!(err("=LOOKUP(0,{1,2,3},{10,20,30})"), ErrorKind::NA);
    assert_eq!(text("=LOOKUP(\"b\",{\"a\",\"c\"},{\"x\",\"y\"})"), "x");
}

#[test]
fn xmatch_modes() {
    close("=XMATCH(2,{3,2,1,2})", 2.0);
    close("=XMATCH(2,{3,2,1,2},0,-1)", 4.0);
    close("=XMATCH(25,{10,20,30},-1)", 2.0);
    close("=XMATCH(25,{10,20,30},1)", 3.0);
    close("=XMATCH(\"b*\",{\"abc\",\"bcd\"},2)", 2.0);
    // Exact mode has no wildcards.
    assert_eq!(err("=XMATCH(\"b*\",{\"abc\",\"bcd\"})"), ErrorKind::NA);
    close("=XMATCH(\"B\",{\"a\",\"b\"})", 2.0);
    assert_eq!(err("=XMATCH(1,{1,2;3,4})"), ErrorKind::Value);
    assert_eq!(err("=XMATCH(1,{1,2},7)"), ErrorKind::Value);
    close("=XMATCH(5,{1,5,5,9},-1,-1)", 3.0);
}

#[test]
fn xlookup_results() {
    close("=XLOOKUP(2,{1,2,3},{10,20,30})", 20.0);
    text_eq("=XLOOKUP(9,{1,2,3},{10,20,30},\"none\")", "none");
    // if_not_found is lazy.
    close("=XLOOKUP(2,{1,2,3},{10,20,30},1/0)", 20.0);
    assert_eq!(err("=XLOOKUP(9,{1,2,3},{10,20,30})"), ErrorKind::NA);
    assert_eq!(err("=XLOOKUP(2,{1,2,3},{10,20})"), ErrorKind::Value);
    close("=XLOOKUP(25,{10,20,30},{1,2,3},,-1)", 2.0);
    close("=XLOOKUP(2,{1;2;3},{1,2;3,4;5,6},,0)+0", 3.0);
    // A 2-D return array gives the row; sum it.
    close("=SUM(XLOOKUP(2,{1;2;3},{1,2;3,4;5,6}))", 7.0);
    // As a reference.
    close("=SUM(A1:XLOOKUP(3,A1:A3,A1:A3))", 4.0);
    close("=ROW(XLOOKUP(3,A1:A3,A1:A3))", 3.0);
}

fn text_eq(f: &str, want: &str) {
    assert_eq!(text(f), want);
}

#[test]
fn indirect_references() {
    close("=INDIRECT(\"A3\")", 3.0);
    close("=INDIRECT(\"S1!A3\")", 3.0);
    close("=INDIRECT(\" $A$3 \")", 3.0);
    close("=SUM(INDIRECT(\"A1:A3\"))", 4.0);
    close("=ROW(INDIRECT(\"B7\"))", 7.0);
    // R1C1 relative to the formula cell J10.
    close("=INDIRECT(\"R3C1\",FALSE)", 3.0);
    close("=INDIRECT(\"R[-7]C[-9]\",FALSE)", 3.0);
    close("=SUM(INDIRECT(\"R1C1:R3C1\",FALSE))", 4.0);
    assert_eq!(err("=INDIRECT(\"nonsense here\")"), ErrorKind::Ref);
    assert_eq!(err("=INDIRECT(\"Nope!A1\")"), ErrorKind::Ref);
    assert_eq!(err("=INDIRECT(\"\")"), ErrorKind::Ref);
    assert_eq!(err("=INDIRECT(C1)"), ErrorKind::Div0);
    assert_eq!(err("=INDIRECT(\"R0C1\",FALSE)"), ErrorKind::Ref);
}

#[test]
fn offset_references() {
    close("=OFFSET(A1,2,0)", 3.0);
    close("=SUM(OFFSET(A1,0,0,3,1))", 4.0);
    close("=ROW(OFFSET(A1,4,0))", 5.0);
    close("=COLUMNS(OFFSET(A1,0,0,1,4))", 4.0);
    close("=SUM(OFFSET(A1:A2,1,0,2))", 3.0);
    assert_eq!(err("=OFFSET(A1,0,-1)"), ErrorKind::Ref);
    assert_eq!(err("=OFFSET(A1,0,0,-1)"), ErrorKind::Ref);
    assert_eq!(err("=OFFSET(5,1,1)"), ErrorKind::Value);
    assert_eq!(err("=OFFSET(A1,1048576,0)"), ErrorKind::Ref);
}

#[test]
fn addresses() {
    assert_eq!(text("=ADDRESS(3,2)"), "$B$3");
    assert_eq!(text("=ADDRESS(3,2,2)"), "B$3");
    assert_eq!(text("=ADDRESS(3,2,3)"), "$B3");
    assert_eq!(text("=ADDRESS(1,16384,4)"), "XFD1");
    assert_eq!(text("=ADDRESS(3,2,1,FALSE)"), "R3C2");
    assert_eq!(text("=ADDRESS(3,2,4,FALSE)"), "R[3]C[2]");
    assert_eq!(text("=ADDRESS(3,2,1,TRUE,\"Data\")"), "Data!$B$3");
    assert_eq!(text("=ADDRESS(3,2,1,TRUE,\"it's\")"), "'it''s'!$B$3");
    assert_eq!(text("=ADDRESS(3,2,1,TRUE,\"2024\")"), "'2024'!$B$3");
    assert_eq!(err("=ADDRESS(1048577,1)"), ErrorKind::Value);
    assert_eq!(err("=ADDRESS(1,16385)"), ErrorKind::Value);
}

#[test]
fn shape_functions() {
    close("=ROWS(A:A)", 1_048_576.0);
    close("=COLUMNS(A1:J1)", 10.0);
    close("=INDEX(TRANSPOSE({1,2,3}),3,1)", 3.0);
    close("=INDEX(TRANSPOSE({1;2;3}),1,2)", 2.0);
    close("=COLUMNS(TRANSPOSE(A1:A3))", 3.0);
    assert_eq!(eval("=TRANSPOSE(A1:C1)"), Value::Number(1.0));
    close("=HYPERLINK(\"u\",5)", 5.0);
    assert_eq!(text("=HYPERLINK(\"u\")"), "u");
}

#[test]
fn volatility_flags() {
    use crate::functions::FunctionRegistry;
    let r = FunctionRegistry::with_builtins();
    for n in ["NOW", "TODAY", "RAND", "RANDBETWEEN", "INDIRECT", "OFFSET"] {
        assert!(r.get(n).unwrap().is_volatile(), "{n}");
    }
    for n in ["SUM", "INDEX", "XLOOKUP", "ROW", "ADDRESS"] {
        assert!(!r.get(n).unwrap().is_volatile(), "{n}");
    }
}
