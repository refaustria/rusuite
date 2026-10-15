//! Excel edge cases of the statistical functions.

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, eval};
use crate::value::Value;

#[test]
fn median_and_mode() {
    close("=MEDIAN(5,1,3)", 3.0);
    close("=MEDIAN(5,1,3,7)", 4.0);
    // Direct text is coerced, text in arrays is ignored.
    close("=MEDIAN(\"4\",2)", 3.0);
    close("=MEDIAN({1,\"x\",3})", 2.0);
    close("=MODE(3,1,1,3)", 3.0);
    close("=MODE(1,2,3,2,3)", 2.0);
    assert_eq!(err("=MODE(1,2,3)"), ErrorKind::NA);
}

#[test]
fn variance_family() {
    close("=VAR.S(2,4,4,4,5,5,7,9)", 4.571428571428571);
    close("=VAR.P(2,4,4,4,5,5,7,9)", 4.0);
    close("=STDEV.P(2,4,4,4,5,5,7,9)", 2.0);
    close("=STDEV({1,2,3,4})", 1.2909944487358056);
    assert_eq!(err("=STDEV.S(7)"), ErrorKind::Div0);
    assert_eq!(err("=VAR.P({\"a\"})"), ErrorKind::Div0);
}

#[test]
fn large_small_rank() {
    close("=LARGE({3,1,2,5},2)", 3.0);
    close("=SMALL({3,1,2,5},1.2)", 2.0);
    assert_eq!(err("=LARGE({1,2},3)"), ErrorKind::Num);
    // Ties share the best rank; RANK.AVG averages.
    close("=RANK.EQ(3,A1:A3)", 1.0);
    close("=RANK.AVG(3,{3;1;3;2}*1)", 1.5);
    close("=RANK.EQ(3,{3;1;3;2}*1)", 1.0);
}

#[test]
fn percentiles() {
    close("=PERCENTILE.INC({1,2,3,4,5},0.3)", 2.2);
    close("=PERCENTILE.EXC({1,2,3,4,5},0.3)", 1.8);
    close("=QUARTILE({1,2,3,4,5,6,7,8},1)", 2.75);
    close("=QUARTILE.EXC({1,2,3,4,5,6,7,8},1)", 2.25);
    assert_eq!(err("=PERCENTILE.EXC({1,2,3},0.1)"), ErrorKind::Num);
    // Truncation, not rounding, to the requested digits.
    close("=PERCENTRANK({1,2,3,4,5,6,7},3.3)", 0.383);
    close("=PERCENTRANK({1,2,3,4,5,6,7},3.3,2)", 0.38);
    close("=PERCENTRANK({1,2,2,3},2)", 1.0 / 3.0 - 0.000333333333333);
}

#[test]
fn regression() {
    close("=SLOPE({2,4,6,8},{1,2,3,4})", 2.0);
    close("=INTERCEPT({3,5,7,9},{1,2,3,4})", 1.0);
    close("=RSQ({1,2,3,4},{2,1,4,3})", 0.36);
    close("=FORECAST(5,{3,5,7,9},{1,2,3,4})", 11.0);
    close("=CORREL({1,2,3},{2,4,7})", 0.9933992677987828);
    close("=COVARIANCE.S({1,2,3},{2,4,7})", 2.5);
    // Pairs with a non-number are skipped.
    close("=SLOPE({2,\"a\",6,8},{1,2,3,4})", 2.0);
    // TREND: defaults and shapes.
    close("=SUM(TREND({2,4,6}))", 12.0);
    close("=INDEX(TREND({2,4,6},{1,2,3},{4;5}),2,1)", 10.0);
    close("=ROWS(TREND({2,4,6},{1,2,3},{4;5}))", 2.0);
    assert_eq!(err("=TREND({1,2},{1,2,3})"), ErrorKind::Ref);
    assert_eq!(err("=TREND({1,\"a\"})"), ErrorKind::Value);
    assert_eq!(err("=TREND({1,2},{5,5})"), ErrorKind::Num);
}

#[test]
fn means() {
    close("=GEOMEAN(4,9)", 6.0);
    close("=HARMEAN(2,2,2)", 2.0);
    close("=DEVSQ(1,2,3,4)", 5.0);
    close("=AVEDEV(2,4,6)", 4.0 / 3.0);
    assert_eq!(eval("=GEOMEAN(0,1)"), Value::Error(ErrorKind::Num));
}
