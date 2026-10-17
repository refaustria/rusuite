//! Dynamic array formulas in SpreadsheetML (Excel 365).
//!
//! * A formula whose result spills (or would spill: `#SPILL!`), and every
//!   formula that legacy Excel would evaluate with implicit intersection,
//!   is written as `<c cm="1"><f t="array" ref="A1:A3">`: `cm` points at
//!   the `XLDAPR` cell-metadata record of `xl/metadata.xml`
//!   ([`metadata_xml`]), which marks the array formula as dynamic. The
//!   spilled cells are written as plain values, as Excel does.
//! * In formula text, `A1#` is stored as `_xlfn.ANCHORARRAY(A1)` and `@x`
//!   as `_xlfn.SINGLE(x)`.
//! * On read, `t="array"` formulas (dynamic or legacy CSE arrays) spill
//!   and the cells of their `ref` range are not loaded; plain formulas get
//!   `@` where legacy Excel applied implicit intersection
//!   ([`legacy_intersection`]).

use engine_formula::ast::{BinaryOp, Expr, RangeKind, UnaryOp};

use crate::xml::XmlOut;

/// Content type of `xl/metadata.xml`.
pub(crate) const METADATA_CT: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml";
/// Relationship type workbook → `xl/metadata.xml`.
pub(crate) const METADATA_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata";

/// Functions whose result is an array: in a plain (legacy) formula their
/// value is implicitly intersected.
const ARRAY_FUNCTIONS: &[&str] = &[
    "BYCOL",
    "BYROW",
    "CHOOSECOLS",
    "CHOOSEROWS",
    "DROP",
    "EXPAND",
    "FILTER",
    "HSTACK",
    "MAKEARRAY",
    "MAP",
    "MINVERSE",
    "MMULT",
    "MUNIT",
    "RANDARRAY",
    "SCAN",
    "SEQUENCE",
    "SORT",
    "SORTBY",
    "TAKE",
    "TOCOL",
    "TOROW",
    "TRANSPOSE",
    "UNIQUE",
    "VSTACK",
    "WRAPCOLS",
    "WRAPROWS",
];

/// `xl/metadata.xml` with the single dynamic-array record (`cm="1"`), as
/// Excel writes it.
pub(crate) fn metadata_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "metadata",
        &[
            ("xmlns", crate::styles::MAIN_NS),
            (
                "xmlns:xda",
                "http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray",
            ),
        ],
    );
    x.start("metadataTypes", &[("count", "1")]);
    x.empty(
        "metadataType",
        &[
            ("name", "XLDAPR"),
            ("minSupportedVersion", "120000"),
            ("copy", "1"),
            ("pasteAll", "1"),
            ("pasteValues", "1"),
            ("merge", "1"),
            ("splitFirst", "1"),
            ("rowColShift", "1"),
            ("clearFormats", "1"),
            ("clearComments", "1"),
            ("assign", "1"),
            ("coerce", "1"),
            ("cellMeta", "1"),
        ],
    );
    x.end("metadataTypes");
    x.start("futureMetadata", &[("name", "XLDAPR"), ("count", "1")]);
    x.start("bk", &[]);
    x.start("extLst", &[]);
    x.start("ext", &[("uri", "{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}")]);
    x.empty(
        "xda:dynamicArrayProperties",
        &[("fDynamic", "1"), ("fCollapsed", "0")],
    );
    x.end("ext");
    x.end("extLst");
    x.end("bk");
    x.end("futureMetadata");
    x.start("cellMetadata", &[("count", "1")]);
    x.start("bk", &[]);
    x.empty("rc", &[("t", "1"), ("v", "0")]);
    x.end("bk");
    x.end("cellMetadata");
    x.end("metadata");
    x.finish()
}

fn rebuild(e: &Expr, f: &impl Fn(&Expr, &dyn Fn(&Expr) -> Expr) -> Option<Expr>) -> Expr {
    let recurse = |x: &Expr| rebuild(x, f);
    if let Some(out) = f(e, &recurse) {
        return out;
    }
    match e {
        Expr::Call { name, args } => Expr::Call {
            name: name.clone(),
            args: args.iter().map(recurse).collect(),
        },
        Expr::Unary { op, expr } => Expr::Unary {
            op: *op,
            expr: Box::new(recurse(expr)),
        },
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(recurse(lhs)),
            rhs: Box::new(recurse(rhs)),
        },
        other => other.clone(),
    }
}

fn contains_dynamic_ops(e: &Expr) -> bool {
    match e {
        Expr::Unary {
            op: UnaryOp::SpillRange | UnaryOp::ImplicitIntersection,
            ..
        } => true,
        Expr::Unary { expr, .. } => contains_dynamic_ops(expr),
        Expr::Binary { lhs, rhs, .. } => contains_dynamic_ops(lhs) || contains_dynamic_ops(rhs),
        Expr::Call { args, .. } => args.iter().any(contains_dynamic_ops),
        _ => false,
    }
}

fn uses_lambda_names(e: &Expr) -> bool {
    match e {
        Expr::Call { name, args } => {
            name == "LET" || name == "LAMBDA" || args.iter().any(uses_lambda_names)
        }
        Expr::Unary { expr, .. } => uses_lambda_names(expr),
        Expr::Binary { lhs, rhs, .. } => uses_lambda_names(lhs) || uses_lambda_names(rhs),
        _ => false,
    }
}

/// `e` with `LET` names and `LAMBDA` parameters (and their uses) written
/// with the `_xlpm.` prefix Excel stores: `LET(_xlpm.x,1,_xlpm.x+1)`.
pub(crate) fn xlpm_prefixes(e: &Expr) -> Expr {
    fn walk(e: &Expr, scope: &mut Vec<String>) -> Expr {
        let bound = |n: &str, scope: &[String]| scope.iter().any(|s| s.eq_ignore_ascii_case(n));
        let pm = |n: &str| format!("_xlpm.{n}");
        match e {
            Expr::Name(n) if bound(n, scope) => Expr::Name(pm(n)),
            Expr::Call { name, args } if name == "LET" && args.len() >= 3 => {
                let depth = scope.len();
                let mut out = Vec::with_capacity(args.len());
                let last = args.len() - 1;
                for (i, a) in args.iter().enumerate() {
                    match a {
                        Expr::Name(n) if i < last && i % 2 == 0 => {
                            scope.push(n.clone());
                            out.push(Expr::Name(pm(n)));
                        }
                        a => out.push(walk(a, scope)),
                    }
                }
                scope.truncate(depth);
                Expr::Call {
                    name: name.clone(),
                    args: out,
                }
            }
            Expr::Call { name, args } if name == "LAMBDA" && !args.is_empty() => {
                let depth = scope.len();
                let last = args.len() - 1;
                let mut out: Vec<Expr> = args[..last]
                    .iter()
                    .map(|p| match p {
                        Expr::Name(n) => {
                            scope.push(n.clone());
                            Expr::Name(pm(n))
                        }
                        p => p.clone(),
                    })
                    .collect();
                out.push(walk(&args[last], scope));
                scope.truncate(depth);
                Expr::Call {
                    name: name.clone(),
                    args: out,
                }
            }
            Expr::Call { name, args } => Expr::Call {
                // A call of a bound lambda keeps the name's own spelling.
                name: match scope.iter().rev().find(|s| s.eq_ignore_ascii_case(name)) {
                    Some(s) => pm(s),
                    None => name.clone(),
                },
                args: args.iter().map(|a| walk(a, scope)).collect(),
            },
            Expr::Unary { op, expr } => Expr::Unary {
                op: *op,
                expr: Box::new(walk(expr, scope)),
            },
            Expr::Binary { op, lhs, rhs } => Expr::Binary {
                op: *op,
                lhs: Box::new(walk(lhs, scope)),
                rhs: Box::new(walk(rhs, scope)),
            },
            other => other.clone(),
        }
    }
    walk(e, &mut Vec::new())
}

/// A defined name's definition as stored: `LET` names and `LAMBDA`
/// parameters with `_xlpm.` (named lambdas); other text unchanged.
pub(crate) fn name_file_text(text: &str) -> String {
    match engine_formula::parse(text) {
        Ok(e) if uses_lambda_names(&e) => xlpm_prefixes(&e).to_string(),
        _ => text.to_string(),
    }
}

/// The file form of a formula using `#` or `@`, `LET` or `LAMBDA`
/// (`None` when it uses none of them): the operators become
/// `_xlfn.ANCHORARRAY` / `_xlfn.SINGLE` calls, names get `_xlpm.`.
pub(crate) fn to_file_ast(e: &Expr) -> Option<Expr> {
    let lambda = uses_lambda_names(e);
    if !contains_dynamic_ops(e) && !lambda {
        return None;
    }
    let e = if lambda { &xlpm_prefixes(e) } else { e };
    Some(rebuild(e, &|e, recurse| match e {
        Expr::Unary {
            op: op @ (UnaryOp::SpillRange | UnaryOp::ImplicitIntersection),
            expr,
        } => Some(Expr::Call {
            name: if *op == UnaryOp::SpillRange {
                "_xlfn.ANCHORARRAY"
            } else {
                "_xlfn.SINGLE"
            }
            .into(),
            args: vec![recurse(expr)],
        }),
        _ => None,
    }))
}

/// The engine form of a formula read from a file (prefixes already
/// stripped): `ANCHORARRAY(x)` → `x#`, `SINGLE(x)` → `@x`.
pub(crate) fn from_file_ast(e: &Expr) -> Expr {
    rebuild(e, &|e, recurse| match e {
        Expr::Call { name, args } if args.len() == 1 => {
            let op = match name.as_str() {
                "ANCHORARRAY" => UnaryOp::SpillRange,
                "SINGLE" => UnaryOp::ImplicitIntersection,
                _ => return None,
            };
            Some(Expr::Unary {
                op,
                expr: Box::new(recurse(&args[0])),
            })
        }
        _ => None,
    })
}

/// Whether a structured reference always means one cell: this row of
/// one column, or the header or totals cell of one column.
fn single_cell(s: &engine_formula::StructRef) -> bool {
    use engine_formula::TableItem as I;
    let one_col = matches!(&s.columns, Some((_, None)));
    s.is_this_row() && one_col
        || one_col && matches!(s.items.as_slice(), [I::Headers] | [I::Totals])
}

fn at(e: Expr) -> Expr {
    Expr::Unary {
        op: UnaryOp::ImplicitIntersection,
        expr: Box::new(e),
    }
}

/// A plain (legacy) formula with `@` where Excel before dynamic arrays
/// intersected implicitly: on multi-cell references, range expressions,
/// multi-element array constants and array functions in value position
/// (the formula itself and operands of operators; function arguments keep
/// their own semantics).
pub(crate) fn legacy_intersection(e: &Expr) -> Expr {
    match e {
        Expr::Reference(r) => match r.kind {
            RangeKind::Cell(_) => e.clone(),
            RangeKind::Area(a, b) if a.row == b.row && a.col == b.col => e.clone(),
            _ => at(e.clone()),
        },
        Expr::Binary {
            op: BinaryOp::Range,
            ..
        } => at(e.clone()),
        Expr::Array(rows) if rows.len() * rows.first().map_or(0, Vec::len) > 1 => at(e.clone()),
        Expr::Structured(s) if !single_cell(s) => at(e.clone()),
        Expr::Call { name, .. } if ARRAY_FUNCTIONS.contains(&name.as_str()) => at(e.clone()),
        // A scalar argument of a lifted function (`LEN(A1:A3)` in legacy
        // Excel is `LEN(@A1:A3)`).
        Expr::Call { name, args } => match engine_formula::functions::lift::lift_spec(name) {
            Some(spec) => Expr::Call {
                name: name.clone(),
                args: args
                    .iter()
                    .enumerate()
                    .map(|(i, a)| {
                        let lifted = spec.lifts(i)
                            || spec == engine_formula::functions::lift::Lift::Selector;
                        if lifted {
                            legacy_intersection(a)
                        } else {
                            a.clone()
                        }
                    })
                    .collect(),
            },
            None => e.clone(),
        },
        Expr::Unary { op, expr } if op.is_arithmetic() => Expr::Unary {
            op: *op,
            expr: Box::new(legacy_intersection(expr)),
        },
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(legacy_intersection(lhs)),
            rhs: Box::new(legacy_intersection(rhs)),
        },
        _ => e.clone(),
    }
}

/// Whether a formula must be stored as a dynamic array formula even when
/// its result is a single value (legacy Excel would read it differently).
pub(crate) fn needs_dynamic(e: &Expr) -> bool {
    legacy_intersection(e) != *e
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::parse;

    fn p(s: &str) -> Expr {
        parse(s).unwrap()
    }

    #[test]
    fn operators_become_functions_and_back() {
        let file = to_file_ast(&p("=SUM(A1#)+@B1:B3")).unwrap();
        assert_eq!(
            file.to_string(),
            "SUM(_xlfn.ANCHORARRAY(A1))+_xlfn.SINGLE(B1:B3)"
        );
        let back = p(&crate::xlfn::strip_xlfn_prefixes(&file.to_string()));
        assert_eq!(from_file_ast(&back), p("=SUM(A1#)+@B1:B3"));
        assert_eq!(to_file_ast(&p("=SUM(A1:A3)")), None);
        assert_eq!(from_file_ast(&p("=SINGLE(1,2)")), p("=SINGLE(1,2)"));
    }

    #[test]
    fn lambda_names_get_the_xlpm_prefix() {
        let f = |s: &str| to_file_ast(&p(s)).map(|e| e.to_string());
        assert_eq!(
            f("=LET(x,A1,y,x*2,x+y)").as_deref(),
            Some("LET(_xlpm.x,A1,_xlpm.y,_xlpm.x*2,_xlpm.x+_xlpm.y)")
        );
        assert_eq!(
            f("=MAP(A1:A3,LAMBDA(v,v+x))").as_deref(),
            Some("MAP(A1:A3,LAMBDA(_xlpm.v,_xlpm.v+x))")
        );
        assert_eq!(
            f("=LET(g,LAMBDA(a,a*2),g(3))").as_deref(),
            Some("LET(_xlpm.g,LAMBDA(_xlpm.a,_xlpm.a*2),_xlpm.g(3))")
        );
        let back = crate::xlfn::strip_xlfn_prefixes(&crate::xlfn::add_xlfn_prefixes(
            &f("=LET(x,1,x+1)").unwrap(),
        ));
        assert_eq!(p(&format!("={back}")), p("=LET(x,1,x+1)"));
    }

    #[test]
    fn legacy_formulas_get_implicit_intersection() {
        let l = |s: &str| legacy_intersection(&p(s)).to_string();
        assert_eq!(l("=A1:A3"), "@A1:A3");
        assert_eq!(l("=A1:A3*2+B1"), "@A1:A3*2+B1");
        assert_eq!(l("=-C:C"), "-@C:C");
        assert_eq!(l("=SUM(A1:A3)"), "SUM(A1:A3)");
        assert_eq!(l("=A1:A1"), "A1:A1");
        assert_eq!(l("={1,2}&\"x\""), "@{1,2}&\"x\"");
        assert_eq!(l("=TRANSPOSE(A1:B1)"), "@TRANSPOSE(A1:B1)");
        assert_eq!(l("=A1:INDEX(B:B,2)"), "@A1:INDEX(B:B,2)");
        assert!(needs_dynamic(&p("=SEQUENCE(3)")));
        assert_eq!(l("=LEN(A1:A3)"), "LEN(@A1:A3)");
        assert_eq!(l("=IF(A1>0,B1:B3,1)"), "IF(A1>0,@B1:B3,1)");
        assert_eq!(
            l("=VLOOKUP(A1:A3,B1:C9,2,FALSE)"),
            "VLOOKUP(@A1:A3,B1:C9,2,FALSE)"
        );
        assert_eq!(l("=VSTACK(A1:A2,B1:B2)"), "@VSTACK(A1:A2,B1:B2)");
        assert!(!needs_dynamic(&p("=LEN(A1)")));
        // IF returns the array of its branch (Excel 365).
        assert!(needs_dynamic(&p("=IF(A1,B1:B3,0)")));
    }

    #[test]
    fn metadata_part_is_well_formed() {
        let xml = String::from_utf8(metadata_xml()).unwrap();
        assert!(xml.contains("<metadataType name=\"XLDAPR\""));
        assert!(xml.contains("<rc t=\"1\" v=\"0\"/>"));
        let mut r = quick_xml::Reader::from_str(&xml);
        while !matches!(r.read_event().unwrap(), quick_xml::events::Event::Eof) {}
    }
}
