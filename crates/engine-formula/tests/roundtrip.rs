//! Property tests: print → parse is the identity on generated ASTs, and
//! parse → print is idempotent on the table formulas.

use engine_formula::ast::{BinaryOp, CellRef, ErrorKind, RangeKind, Reference, UnaryOp};
use engine_formula::{parse, Expr};
use proptest::prelude::*;

mod common;

const NAMES: &[&str] = &["MyName", "Total_Sales", "rate.x", "_tax", "Pi_2"];
const FUNCS: &[&str] = &["SUM", "IF", "INDEX", "VLOOKUP", "_XLFN.XLOOKUP", "LOG10"];
const SHEETS: &[&str] = &["Sheet1", "My Sheet", "it's", "A1", "Data.2024", "Übersicht"];

fn number() -> impl Strategy<Value = f64> {
    prop_oneof![
        (0u32..10_000).prop_map(f64::from),
        (0u32..10_000).prop_map(|n| f64::from(n) / 100.0),
        (0u32..100).prop_map(|n| f64::from(n) * 1e20),
    ]
}

fn text() -> impl Strategy<Value = String> {
    proptest::collection::vec(
        prop_oneof![Just('a'), Just('B'), Just(' '), Just('"'), Just('\'')],
        0..6,
    )
    .prop_map(|v| v.into_iter().collect())
}

fn error_kind() -> impl Strategy<Value = ErrorKind> {
    proptest::sample::select(ErrorKind::ALL.to_vec())
}

fn cellref() -> impl Strategy<Value = CellRef> {
    (
        0u32..=16_383,
        0u32..=1_048_575,
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(|(col, row, col_abs, row_abs)| CellRef {
            col,
            row,
            col_abs,
            row_abs,
        })
}

fn reference() -> impl Strategy<Value = Reference> {
    let kind = prop_oneof![
        cellref().prop_map(RangeKind::Cell),
        (cellref(), cellref()).prop_map(|(a, b)| RangeKind::area(a, b)),
        (0u32..=16_383, 0u32..=16_383, any::<bool>()).prop_map(|(a, b, abs)| RangeKind::Cols {
            start: a.min(b),
            end: a.max(b),
            abs
        }),
        (0u32..=1_048_575, 0u32..=1_048_575, any::<bool>()).prop_map(|(a, b, abs)| {
            RangeKind::Rows {
                start: a.min(b),
                end: a.max(b),
                abs,
            }
        }),
    ];
    let sheet = proptest::option::of(proptest::sample::select(SHEETS).prop_map(String::from));
    (sheet, kind).prop_map(|(sheet, kind)| Reference { sheet, kind })
}

fn constant() -> impl Strategy<Value = Expr> {
    prop_oneof![
        number().prop_map(Expr::Number),
        text().prop_map(Expr::Text),
        any::<bool>().prop_map(Expr::Bool),
        error_kind().prop_map(Expr::Error),
    ]
}

fn array() -> impl Strategy<Value = Expr> {
    let el = prop_oneof![constant(), number().prop_map(|n| Expr::Number(-n))];
    (1usize..4, 1usize..4)
        .prop_flat_map(move |(r, c)| {
            proptest::collection::vec(proptest::collection::vec(el.clone(), c), r)
        })
        .prop_map(Expr::Array)
}

fn leaf() -> impl Strategy<Value = Expr> {
    prop_oneof![
        3 => constant(),
        3 => reference().prop_map(Expr::Reference),
        1 => proptest::sample::select(NAMES).prop_map(|n| Expr::Name(n.into())),
        1 => array(),
    ]
}

fn binary_op() -> impl Strategy<Value = BinaryOp> {
    use BinaryOp::*;
    proptest::sample::select(vec![
        Add, Sub, Mul, Div, Pow, Concat, Eq, Ne, Lt, Le, Gt, Ge,
    ])
}

fn expr() -> impl Strategy<Value = Expr> {
    leaf().prop_recursive(4, 64, 4, |inner| {
        let args = proptest::collection::vec(
            prop_oneof![4 => inner.clone(), 1 => Just(Expr::Missing)],
            0..4,
        )
        // A single omitted argument prints as `F()`, i.e. zero arguments.
        .prop_filter("lone Missing", |a| !(a.len() == 1 && a[0] == Expr::Missing));
        let call = (proptest::sample::select(FUNCS), args).prop_map(|(name, args)| Expr::Call {
            name: name.into(),
            args,
        });
        prop_oneof![
            3 => (binary_op(), inner.clone(), inner.clone()).prop_map(|(op, l, r)| Expr::Binary {
                op,
                lhs: Box::new(l),
                rhs: Box::new(r),
            }),
            2 => (
                proptest::sample::select(vec![UnaryOp::Neg, UnaryOp::Plus, UnaryOp::Percent]),
                inner.clone()
            )
                .prop_map(|(op, e)| Expr::Unary { op, expr: Box::new(e) }),
            2 => call.clone(),
            1 => inner.clone().prop_map(|e| Expr::Unary {
                op: UnaryOp::ImplicitIntersection,
                expr: Box::new(e),
            }),
            // Spilled-range operator on a reference (or a call).
            1 => prop_oneof![reference().prop_map(Expr::Reference), call.clone()].prop_map(|e| {
                Expr::Unary {
                    op: UnaryOp::SpillRange,
                    expr: Box::new(e),
                }
            }),
            // Reference operator: reference or call on the left, call or
            // reference on the right.
            1 => (
                prop_oneof![reference().prop_map(Expr::Reference), call.clone()],
                prop_oneof![call, reference().prop_map(Expr::Reference)],
            )
                .prop_map(|(l, r)| Expr::Binary {
                    op: BinaryOp::Range,
                    lhs: Box::new(l),
                    rhs: Box::new(r),
                }),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn print_then_parse_is_identity(ast in expr()) {
        let printed = ast.to_string();
        prop_assert_eq!(parse(&printed), Ok(ast), "printed: {}", printed);
    }
}

#[test]
fn parse_print_idempotent_on_table() {
    for (input, _) in common::TABLE {
        let once = parse(input).unwrap().to_string();
        let twice = parse(&once).unwrap().to_string();
        assert_eq!(once, twice, "{input}");
    }
}
