//! Tests for the Phase 8 math functions (the reference suite covers the
//! LibreOffice-comparable cases; these pin Excel-specific edge cases).

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, eval, num};
use crate::value::Value;

#[test]
fn rounding_family() {
    close("=TRUNC(-3.999,1)", -3.9);
    close("=CEILING.MATH(-0.5)", 0.0);
    close("=CEILING.MATH(-0.5,1,1)", -1.0);
    close("=FLOOR.MATH(-0.5)", -1.0);
    close("=FLOOR.MATH(-0.5,1,1)", 0.0);
    close("=FLOOR(1.234,0.01)", 1.23);
    assert_eq!(err("=FLOOR(1,0)"), ErrorKind::Div0);
    assert_eq!(eval("=FLOOR(0,0)"), Value::Number(0.0));
    close("=MROUND(-2.5,-1)", -3.0);
    assert_eq!(err("=MROUND(-2.5,1)"), ErrorKind::Num);
    close("=MROUND(2.5,1)", 3.0);
    close("=MROUND(1.3,0.2)", 1.4);
}

#[test]
fn logs_and_powers() {
    close("=LOG(1000,10)", 3.0);
    close("=LOG(0.5,2)", -1.0);
    assert_eq!(err("=LOG(2,0)"), ErrorKind::Num);
    close("=EXP(LN(7))", 7.0);
    close("=SIGN(-0.0001)", -1.0);
    assert_eq!(err("=EXP(1000)"), ErrorKind::Num);
}

#[test]
fn integer_functions() {
    close("=FACT(170)", 7.257415615307994e306);
    close("=FACTDOUBLE(8)", 384.0);
    close("=COMBIN(52,5)", 2_598_960.0);
    close("=PERMUT(10,3)", 720.0);
    close("=GCD(12,18,24)", 6.0);
    close("=GCD(0,0)", 0.0);
    close("=LCM(2,3,4)", 12.0);
    close("=QUOTIENT(-7,2)", -3.0);
    close("=EVEN(-1.1)", -2.0);
    close("=ODD(-1.1)", -3.0);
    close("=ODD(1)", 1.0);
    assert_eq!(err("=LCM(1E15,1E15-1)"), ErrorKind::Num);
}

#[test]
fn random_numbers_are_in_range() {
    for _ in 0..200 {
        let r = num("=RAND()");
        assert!((0.0..1.0).contains(&r));
        let b = num("=RANDBETWEEN(-3,3)");
        assert!((-3.0..=3.0).contains(&b) && b.fract() == 0.0);
    }
    // Bounds are rounded inward.
    let r = num("=RANDBETWEEN(1.2,2.8)");
    assert_eq!(r, 2.0);
    assert_ne!(num("=RAND()"), num("=RAND()"));
}

#[test]
fn trig_values() {
    close("=ATAN2(-1,1)", 3.0 * std::f64::consts::FRAC_PI_4);
    close("=DEGREES(ATAN2(1,1))", 45.0);
    close("=COS(RADIANS(60))", 0.5);
    close("=TANH(1)", 0.7615941559557649);
}

#[test]
fn conditional_aggregates() {
    // A1:A3 = 1, "x", 3; B1 = TRUE; B2 = "5".
    close("=SUMIFS(A1:A3,A1:A3,\">0\")", 4.0);
    close("=COUNTIFS(A1:A3,\">0\",A1:A3,\"<3\")", 1.0);
    close("=AVERAGEIFS(A1:A3,A1:A3,\">=1\")", 2.0);
    close("=MAXIFS(A1:A3,A1:A3,\"<3\")", 1.0);
    close("=MINIFS(A1:A3,A1:A3,\">1\")", 3.0);
    close("=MAXIFS(A1:A3,A1:A3,\">100\")", 0.0);
    assert_eq!(err("=AVERAGEIFS(A1:A3,A1:A3,\">100\")"), ErrorKind::Div0);
    assert_eq!(err("=SUMIFS(A1:A3,A1:A2,\">0\")"), ErrorKind::Value);
    assert_eq!(err("=COUNTIFS(A1:A3)"), ErrorKind::Value);
    // An error in a matching sum cell propagates, in a non-matching one not.
    assert_eq!(err("=SUMIFS(C1:C2,C1:C2,\"#N/A\")"), ErrorKind::NA);
    close("=SUMIFS(A1:A3,B1:B3,TRUE)", 1.0);
    close("=COUNTBLANK(A1:A5)", 2.0);
    close("=COUNTBLANK(A:A)", 1_048_573.0);
    close("=AVERAGEIF(A1:A3,\">1\",A1:A3)", 3.0);
}

#[test]
fn sum_of_squares() {
    close("=SUMSQ(1,2,3)", 14.0);
    close("=SUMSQ({1,\"a\",2})", 5.0);
    close("=SUMXMY2({1,2,3},{3,2,1})", 8.0);
    assert_eq!(err("=SUMX2MY2({1,2},{1,2,3})"), ErrorKind::NA);
}
