//! Tests for the Phase 8 text functions.

use crate::ast::ErrorKind;
use crate::functions::test_support::{close, err, text};

#[test]
fn search_and_replace() {
    close("=SEARCH(\"B\",\"abc\")", 2.0);
    close("=SEARCH(\"~*\",\"a*b\")", 2.0);
    close("=SEARCH(\"*\",\"abc\")", 1.0);
    close("=SEARCH(\"\",\"abc\",2)", 2.0);
    assert_eq!(err("=SEARCH(\"a\",\"abc\",5)"), ErrorKind::Value);
    assert_eq!(text("=REPLACE(\"abcdef\",2,100,\"-\")"), "a-");
    assert_eq!(text("=REPLACE(\"abc\",2,0,\"XY\")"), "aXYbc");
}

#[test]
fn case_and_codes() {
    assert_eq!(text("=PROPER(\"mIxEd cASE-text\")"), "Mixed Case-Text");
    close("=CODE(CHAR(200))", 200.0);
    assert_eq!(text("=CHAR(128)"), "\u{20AC}");
    close("=CODE(\"\u{20AC}\")", 128.0);
    close("=CODE(\"\u{4E2D}\")", 63.0);
    close("=UNICODE(\"\u{1F600}\")", 128_512.0);
    assert_eq!(text("=UNICHAR(128512)"), "\u{1F600}");
    assert_eq!(err("=UNICHAR(55296)"), ErrorKind::Value);
    assert_eq!(text("=CLEAN(\"a\"&CHAR(1)&CHAR(31)&\"b\")"), "ab");
}

#[test]
fn numbers_from_text() {
    close("=NUMBERVALUE(\"3.5\")", 3.5);
    close("=NUMBERVALUE(\"1 234,5\",\",\",\" \")", 1234.5);
    assert_eq!(err("=NUMBERVALUE(\"(1\")"), ErrorKind::Value);
    close("=NUMBERVALUE(\"-1.5e2\")", -150.0);
}
