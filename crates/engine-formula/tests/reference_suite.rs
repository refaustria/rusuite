//! Runs the formula reference suite in `testdata/formulas/` (see
//! `docs/formula-suite.md`) against the evaluator.
//!
//! Cases calling a function that `docs/functions.md` lists as planned or
//! implemented but that is not registered are skipped; any other unknown
//! name is evaluated (and yields `#NAME?`). Rows marked
//! `DIFF:` (LibreOffice differs from Excel) are compared against their
//! `[excel=...]` value, or skipped when they have none.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use engine_formula::ast::{CellRef, ErrorKind};
use engine_formula::{
    evaluate, parse, CellCoord, CellProvider, EvalContext, Expr, FunctionRegistry, SheetId, Value,
};

const SHEETS: [&str; 2] = ["Data", "Other"];

fn suite_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/formulas")
}

/// In-memory workbook built from `fixture.tsv`.
#[derive(Default)]
struct Fixture {
    cells: HashMap<(u32, u32, u32), Value>,
}

impl CellProvider for Fixture {
    fn sheet_id(&self, name: &str) -> Option<SheetId> {
        SHEETS
            .iter()
            .position(|s| s.eq_ignore_ascii_case(name))
            .map(|i| SheetId(i as u32))
    }

    fn value(&self, c: CellCoord) -> Value {
        self.cells
            .get(&(c.sheet.0, c.row, c.col))
            .cloned()
            .unwrap_or(Value::Empty)
    }

    fn sheet_span(&self, first: &str, last: &str) -> Option<Vec<String>> {
        let pos = |n: &str| SHEETS.iter().position(|s| s.eq_ignore_ascii_case(n));
        let (a, b) = (pos(first)?, pos(last)?);
        Some(
            SHEETS[a.min(b)..=a.max(b)]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        )
    }

    fn used_range(&self, sheet: SheetId) -> Option<(u32, u32)> {
        self.cells
            .keys()
            .filter(|k| k.0 == sheet.0)
            .fold(None, |acc, &(_, r, c)| {
                let (mr, mc) = acc.unwrap_or((0, 0));
                Some((r.max(mr), c.max(mc)))
            })
    }
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Data lines (not comments, not the header), split on tabs.
fn rows(text: &str) -> impl Iterator<Item = Vec<&str>> {
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .skip(1)
        .map(|l| l.split('\t').collect())
}

/// Function names from the family tables of `docs/functions.md` whose
/// status is `planned` or `implemented` (the Deferred section is ignored).
fn listed_functions() -> Vec<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/functions.md");
    let text = fs::read_to_string(path).expect("docs/functions.md");
    let mut names = Vec::new();
    for line in text.lines() {
        if line.starts_with("## Deferred") {
            break;
        }
        let cells: Vec<&str> = line
            .trim()
            .trim_matches('|')
            .split('|')
            .map(str::trim)
            .collect();
        if !line.trim_start().starts_with('|') || cells.len() < 2 {
            continue;
        }
        let status = cells[cells.len() - 1];
        if status == "planned" || status == "implemented" {
            names.push(cells[0].trim_matches('`').to_ascii_uppercase());
        }
    }
    assert!(names.len() >= 60, "too few functions parsed: {names:?}");
    names
}

fn ctx_at<'a>(fx: &'a Fixture, reg: &'a FunctionRegistry, row: u32) -> EvalContext<'a> {
    EvalContext {
        provider: fx,
        registry: reg,
        current: CellCoord {
            sheet: SheetId(0),
            row,
            // Column L.
            col: 11,
        },
        now: || 46310.5,
    }
}

fn load_fixture(reg: &FunctionRegistry) -> Fixture {
    let text = fs::read_to_string(suite_dir().join("fixture.tsv")).expect("fixture.tsv");
    let mut fx = Fixture::default();
    let mut formulas = Vec::new();
    for cols in rows(&text) {
        let [sheet, cell, ty, value] = cols[..] else {
            panic!("bad fixture row {cols:?}");
        };
        let sheet = fx.sheet_id(sheet).expect("known sheet").0;
        let c = CellRef::parse(cell).expect("fixture cell");
        let key = (sheet, c.row, c.col);
        let v = match ty {
            "number" | "date" => Value::Number(value.parse().expect("fixture number")),
            "text" => Value::Text(unescape(value)),
            "bool" => Value::Bool(value == "TRUE"),
            "empty" => continue,
            "formula" => {
                formulas.push((key, value.to_string()));
                continue;
            }
            other => panic!("unknown fixture type {other}"),
        };
        fx.cells.insert(key, v);
    }
    // Fixture formulas (H1 = 1/0, H2 = NA()) only depend on constants;
    // their results are stored as values.
    for (key, f) in formulas {
        let v = evaluate(
            &parse(&f).expect("fixture formula"),
            &ctx_at(&fx, reg, key.1),
        );
        fx.cells.insert(key, v);
    }
    fx
}

#[derive(Debug, Clone, PartialEq)]
enum Expected {
    Number(f64),
    Text(String),
    Bool(bool),
    Error(ErrorKind),
    AnyNumber,
}

impl fmt::Display for Expected {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expected::Number(n) => write!(f, "number {n}"),
            Expected::Text(s) => write!(f, "text {s:?}"),
            Expected::Bool(b) => write!(f, "bool {b}"),
            Expected::Error(e) => write!(f, "error {e}"),
            Expected::AnyNumber => f.write_str("any number"),
        }
    }
}

fn expected(ty: &str, raw: &str) -> Expected {
    match ty {
        "number" => Expected::Number(raw.parse().expect("expected number")),
        "text" => Expected::Text(unescape(raw)),
        "bool" => Expected::Bool(raw == "TRUE"),
        "error" => Expected::Error(raw.parse().expect("expected error")),
        "number?" => Expected::AnyNumber,
        other => panic!("unknown case type {other}"),
    }
}

/// The `[excel=<value>]` override; its type is inferred (an error literal
/// is an error, otherwise the row's type applies, falling back from `error`
/// to number / bool / text).
fn excel_override(note: &str, ty: &str) -> Option<Expected> {
    let start = note.find("[excel=")? + "[excel=".len();
    let raw = &note[start..start + note[start..].find(']')?];
    if let Ok(e) = raw.parse::<ErrorKind>() {
        return Some(Expected::Error(e));
    }
    Some(if ty == "text" {
        Expected::Text(unescape(raw))
    } else if raw == "TRUE" || raw == "FALSE" {
        Expected::Bool(raw == "TRUE")
    } else if let Ok(n) = raw.parse() {
        Expected::Number(n)
    } else {
        Expected::Text(unescape(raw))
    })
}

fn matches(got: &Value, want: &Expected) -> bool {
    match (got, want) {
        (Value::Number(a), Expected::Number(b)) => (a - b).abs() <= 1e-9 * b.abs().max(1.0),
        (Value::Text(a), Expected::Text(b)) => a == b,
        (Value::Bool(a), Expected::Bool(b)) => a == b,
        (Value::Error(a), Expected::Error(b)) => a == b,
        (Value::Number(_), Expected::AnyNumber) => true,
        _ => false,
    }
}

fn called_functions<'e>(e: &'e Expr, out: &mut Vec<&'e str>) {
    match e {
        Expr::Call { name, args } => {
            out.push(name);
            args.iter().for_each(|a| called_functions(a, out));
        }
        Expr::Unary { expr, .. } => called_functions(expr, out),
        Expr::Binary { lhs, rhs, .. } => {
            called_functions(lhs, out);
            called_functions(rhs, out);
        }
        Expr::Array(rows) => rows.iter().flatten().for_each(|a| called_functions(a, out)),
        _ => {}
    }
}

#[derive(Default, Clone, Copy)]
struct Counts {
    passed: usize,
    failed: usize,
    skipped_unimplemented: usize,
    excel_override: usize,
    skipped_diff: usize,
}

impl Counts {
    fn add(&mut self, o: &Counts) {
        self.passed += o.passed;
        self.failed += o.failed;
        self.skipped_unimplemented += o.skipped_unimplemented;
        self.excel_override += o.excel_override;
        self.skipped_diff += o.skipped_diff;
    }
}

impl fmt::Display for Counts {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "passed={} failed={} skipped_unimplemented={} excel_override={} skipped_diff={}",
            self.passed,
            self.failed,
            self.skipped_unimplemented,
            self.excel_override,
            self.skipped_diff
        )
    }
}

#[test]
fn reference_suite() {
    let reg = FunctionRegistry::with_builtins();
    let known = reg.names();
    let listed = listed_functions();
    let fx = load_fixture(&reg);

    let mut files: Vec<PathBuf> = fs::read_dir(suite_dir())
        .expect("testdata/formulas")
        .map(|e| e.expect("dir entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "tsv"))
        .filter(|p| p.file_name().is_some_and(|n| n != "fixture.tsv"))
        .collect();
    files.sort();
    assert!(files.len() >= 9, "expected the nine case files");

    let mut total = Counts::default();
    let mut failures = Vec::new();
    for path in &files {
        let family = path.file_stem().unwrap().to_string_lossy().into_owned();
        let text = fs::read_to_string(path).expect("case file");
        let mut c = Counts::default();
        for (i, cols) in rows(&text).enumerate() {
            let [formula, ty, raw, note] = cols[..] else {
                panic!("{family}: bad row {cols:?}");
            };
            let ast = match parse(formula) {
                Ok(ast) => ast,
                Err(err) => {
                    c.failed += 1;
                    failures.push(format!("{family}: {formula} -> parse error: {err}"));
                    continue;
                }
            };
            let mut calls = Vec::new();
            called_functions(&ast, &mut calls);
            let unimplemented = |n: &&str| {
                let n = n.to_ascii_uppercase();
                listed.contains(&n) && !known.contains(&n.as_str())
            };
            if calls.iter().any(unimplemented) {
                c.skipped_unimplemented += 1;
                continue;
            }
            let want = if note.contains("DIFF:") {
                match excel_override(note, ty) {
                    Some(w) => {
                        c.excel_override += 1;
                        w
                    }
                    None => {
                        c.skipped_diff += 1;
                        continue;
                    }
                }
            } else {
                expected(ty, raw)
            };
            let got = evaluate(&ast, &ctx_at(&fx, &reg, i as u32));
            if matches(&got, &want) {
                c.passed += 1;
            } else {
                c.failed += 1;
                failures.push(format!(
                    "{family}: {formula} -> expected {want}, got {got:?}"
                ));
            }
        }
        println!("  {family:<10} {c}");
        total.add(&c);
    }
    for f in &failures {
        println!("FAIL {f}");
    }
    println!("reference_suite: {total}");
    assert_eq!(total.failed, 0, "{} failing reference cases", total.failed);
}

#[test]
fn documented_and_registered_functions_agree() {
    let reg = FunctionRegistry::with_builtins();
    let known: Vec<String> = reg.names().iter().map(|n| n.to_string()).collect();
    let mut listed = listed_functions();
    listed.sort();
    // Every function in docs/functions.md is implemented and vice versa.
    assert_eq!(listed, known, "docs/functions.md and the registry differ");
    assert!(known.len() >= 200, "{} functions", known.len());
}
