//! Parser table tests, error cases, `references()` and AST snapshots.

use engine_formula::ast::{CellRef, RangeKind, Reference};
use engine_formula::{parse, Expr};

mod common;
use common::TABLE;

#[test]
fn table_prints_canonically() {
    assert!(TABLE.len() >= 40);
    for (input, expected) in TABLE {
        let ast = parse(input).unwrap_or_else(|e| panic!("{input}: {e}"));
        assert_eq!(&ast.to_string(), expected, "input {input}");
        let reparsed = parse(expected).unwrap_or_else(|e| panic!("{expected}: {e}"));
        assert_eq!(reparsed, ast, "reparse of {expected}");
    }
}

#[test]
fn error_cases() {
    // (input, expected error position)
    let cases: &[(&str, usize)] = &[
        ("=1+", 3),
        ("=SUM(", 5),
        ("=A1:", 4),
        ("=XFE1", 1),
        ("=A1048577", 1),
        ("=\"unterminated", 1),
        ("=1 2", 3),
        ("=)", 1),
        ("=", 1),
        ("=(1", 3),
        ("=SUM(1 2)", 7),
        ("={1,2;3}", 1),
        ("={A1}", 2),
        ("=Sheet1!", 8),
        ("=Sheet1!A1:Sheet2!B2", 11),
        ("=$", 1),
        ("=1@2", 2),
        ("=@", 2),
        ("=#", 1),
        ("=A1##", 4),
        ("=#BOGUS!", 1),
    ];
    for (input, pos) in cases {
        let err = parse(input).expect_err(input);
        assert_eq!(err.pos, *pos, "{input}: {err}");
        assert!(!err.message.is_empty());
        let _: &dyn std::error::Error = &err;
    }
}

#[test]
fn references_in_source_order() {
    let ast = parse("=IF(SUM(A1:B2,Data!C3)>0,-$D$4%,INDEX(1:1,E5)&F:G)").unwrap();
    let refs: Vec<String> = ast.references().iter().map(|r| r.to_string()).collect();
    assert_eq!(refs, ["A1:B2", "Data!C3", "$D$4", "1:1", "E5", "F:G"]);
    assert_eq!(
        ast.references()[1],
        &Reference {
            sheet: Some("Data".into()),
            kind: RangeKind::Cell(CellRef::new(2, 2)),
        }
    );
    assert!(parse("=1+2").unwrap().references().is_empty());
}

#[test]
fn snapshots() {
    insta::assert_debug_snapshot!("arith", parse("=-2^2+A1%*3").unwrap());
    insta::assert_debug_snapshot!(
        "call_refs",
        parse("=SUM(A1:B2, Sheet2!$C$3, IF(x,,\"y\"))").unwrap()
    );
    insta::assert_debug_snapshot!(
        "array_range",
        parse("={1,-2;TRUE,#N/A}&A1:INDEX(B:B,2)").unwrap()
    );
}

#[test]
fn spill_and_intersection_operators() {
    use engine_formula::ast::UnaryOp;
    let Expr::Unary { op, expr } = parse("=A1#").unwrap() else {
        panic!("unary expected");
    };
    assert_eq!(op, UnaryOp::SpillRange);
    assert_eq!(expr.to_string(), "A1");
    // `@` covers the whole range: `@A1:B2` is `@(A1:B2)`.
    let Expr::Unary { op, expr } = parse("=@A1:B2").unwrap() else {
        panic!("unary expected");
    };
    assert_eq!(op, UnaryOp::ImplicitIntersection);
    assert_eq!(expr.to_string(), "A1:B2");
    // References inside are found (and adjusted) as usual.
    let refs: Vec<String> = parse("=SUM(A1#)+@B1:B3")
        .unwrap()
        .references()
        .iter()
        .map(|r| r.to_string())
        .collect();
    assert_eq!(refs, ["A1", "B1:B3"]);
}

#[test]
fn leading_equals_is_optional() {
    assert_eq!(parse("1+2"), parse("=1+2"));
    assert!(matches!(parse("=x"), Ok(Expr::Name(_))));
}
