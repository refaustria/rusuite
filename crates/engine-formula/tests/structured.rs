//! Structured references to Excel tables (P8-35).

use engine_formula::{
    parse, CellCoord, Engine, ErrorKind, Expr, NameScope, SheetId, StructRef, TableDef, Value,
};

const S: SheetId = SheetId(0);

fn c(row: u32, col: u32) -> CellCoord {
    CellCoord::new(S, row, col)
}

/// Table `T` on A1:D6: header Region | Qty | Unit Price | Total, data
/// rows 2–5, totals row 6 (`SUBTOTAL(109,[Qty])` in B6).
fn table(totals: bool) -> TableDef {
    TableDef {
        name: "T".into(),
        sheet: S,
        r0: 0,
        c0: 0,
        r1: if totals { 5 } else { 4 },
        c1: 3,
        header: true,
        totals,
        columns: ["Region", "Qty", "Unit Price", "Total"]
            .map(String::from)
            .to_vec(),
    }
}

fn engine() -> Engine {
    let mut e = Engine::new();
    e.set_tables(vec![table(true)]);
    let rows = [
        ["Region", "Qty", "Unit Price", "Total"],
        ["East", "3", "2", "=[@Qty]*[@[Unit Price]]"],
        ["West", "5", "1.5", "=[@Qty]*[@[Unit Price]]"],
        ["East", "1", "10", "=[@Qty]*[@[Unit Price]]"],
        ["North", "2", "4", "=[@Qty]*[@[Unit Price]]"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (col, v) in row.iter().enumerate() {
            e.set_input(c(r as u32, col as u32), v).unwrap();
        }
    }
    e.set_input(c(5, 0), "Total").unwrap();
    e.set_input(c(5, 1), "=SUBTOTAL(109,[Qty])").unwrap();
    e
}

fn eval(e: &mut Engine, formula: &str) -> Value {
    let at = c(20, 6);
    e.set_input(at, formula).unwrap();
    e.value(at)
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

fn err(k: ErrorKind) -> Value {
    Value::Error(k)
}

#[test]
fn whole_column_and_case() {
    let mut e = engine();
    assert_eq!(eval(&mut e, "=SUM(T[Qty])"), n(11.0));
    assert_eq!(eval(&mut e, "=SUM(t[qty])"), n(11.0));
    assert_eq!(eval(&mut e, "=SUM(T[Total])"), n(6.0 + 7.5 + 10.0 + 8.0));
    assert_eq!(eval(&mut e, "=COUNTA(T[Region])"), n(4.0));
}

#[test]
fn special_items() {
    let mut e = engine();
    assert_eq!(
        eval(&mut e, "=T[[#Headers],[Qty]]"),
        Value::Text("Qty".into())
    );
    assert_eq!(eval(&mut e, "=T[[#Totals],[Qty]]"), n(11.0));
    assert_eq!(eval(&mut e, "=ROWS(T[#All])"), n(6.0));
    assert_eq!(eval(&mut e, "=ROWS(T[#Data])"), n(4.0));
    assert_eq!(eval(&mut e, "=ROWS(T)"), n(4.0));
    assert_eq!(eval(&mut e, "=COLUMNS(T[#Headers])"), n(4.0));
    assert_eq!(eval(&mut e, "=ROWS(T[[#Headers],[#Data]])"), n(5.0));
    assert_eq!(eval(&mut e, "=ROWS(T[[#Data],[#Totals]])"), n(5.0));
    assert_eq!(eval(&mut e, "=ROWS(T[[#All],[Qty]])"), n(6.0));
    assert_eq!(eval(&mut e, "=COUNTA(T[#Headers])"), n(4.0));
    assert_eq!(eval(&mut e, "=ROWS(T[])"), n(4.0));
}

#[test]
fn missing_parts_are_ref_errors() {
    let mut e = engine();
    assert_eq!(eval(&mut e, "=T[Nope]"), err(ErrorKind::Ref));
    assert_eq!(eval(&mut e, "=Nope[Qty]"), err(ErrorKind::Ref));
    assert_eq!(
        eval(&mut e, "=ROWS(T[[#Headers],[#Totals]])"),
        err(ErrorKind::Ref)
    );
    e.set_tables(vec![table(false)]);
    assert_eq!(
        eval(&mut e, "=SUM(T[[#Totals],[Qty]])"),
        err(ErrorKind::Ref)
    );
    let mut no_header = table(false);
    no_header.header = false;
    e.set_tables(vec![no_header]);
    assert_eq!(eval(&mut e, "=T[[#Headers],[Qty]]"), err(ErrorKind::Ref));
    // Without the header row the data starts in row 1.
    assert_eq!(eval(&mut e, "=ROWS(T)"), n(5.0));
}

#[test]
fn this_row() {
    let mut e = engine();
    assert_eq!(e.value(c(1, 3)), n(6.0));
    assert_eq!(e.value(c(2, 3)), n(7.5));
    // Outside the table, on a data row, `T[@Qty]` is that row's value.
    e.set_input(c(2, 6), "=T[@Qty]").unwrap();
    assert_eq!(e.value(c(2, 6)), n(5.0));
    e.set_input(c(3, 6), "=SUM(T[@[Qty]:[Unit Price]])")
        .unwrap();
    assert_eq!(e.value(c(3, 6)), n(11.0));
    e.set_input(c(4, 6), "=COUNTA(T[@])").unwrap();
    assert_eq!(e.value(c(4, 6)), n(4.0));
    // On the header, the totals row or below the table: #VALUE!.
    e.set_input(c(0, 6), "=T[@Qty]").unwrap();
    assert_eq!(e.value(c(0, 6)), err(ErrorKind::Value));
    e.set_input(c(5, 6), "=T[@Qty]").unwrap();
    assert_eq!(e.value(c(5, 6)), err(ErrorKind::Value));
    e.set_input(c(9, 6), "=T[@Qty]").unwrap();
    assert_eq!(e.value(c(9, 6)), err(ErrorKind::Value));
    // Unqualified outside every table: #REF!.
    e.set_input(c(2, 7), "=[@Qty]").unwrap();
    assert_eq!(e.value(c(2, 7)), err(ErrorKind::Ref));
}

#[test]
fn column_ranges() {
    let mut e = engine();
    assert_eq!(eval(&mut e, "=SUM(T[[Qty]:[Unit Price]])"), n(11.0 + 17.5));
    assert_eq!(eval(&mut e, "=SUM(T[[Unit Price]:[Qty]])"), n(28.5));
    assert_eq!(eval(&mut e, "=COLUMNS(T[[Region]:[Total]])"), n(4.0));
    assert_eq!(eval(&mut e, "=ROWS(T[[#Headers],[Qty]:[Total]])"), n(1.0));
    assert_eq!(eval(&mut e, "=SUM(T[Qty]:T[Unit Price])"), n(28.5));
}

#[test]
fn totals_row_subtotal_and_dependencies() {
    let mut e = engine();
    assert_eq!(e.value(c(5, 1)), n(11.0));
    e.set_input(c(20, 6), "=SUM(T[Qty])").unwrap();
    let r = e.set_input(c(2, 1), "10").unwrap();
    assert!(r.changed.contains(&c(5, 1)));
    assert!(r.changed.contains(&c(20, 6)));
    assert!(r.changed.contains(&c(2, 3)));
    assert_eq!(e.value(c(5, 1)), n(16.0));
    assert_eq!(e.value(c(2, 3)), n(15.0));
    assert_eq!(eval(&mut e, "=SUBTOTAL(101,T[Qty])"), n(4.0));
}

#[test]
fn resizing_updates_results() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[Qty])").unwrap();
    // A row added below the data (the totals row moves down).
    e.set_input(c(5, 1), "7").unwrap();
    let mut t = table(true);
    t.r1 = 6;
    e.set_input(c(6, 1), "=SUBTOTAL(109,[Qty])").unwrap();
    let r = e.set_tables(vec![t]);
    assert!(r.changed.contains(&c(20, 6)));
    assert_eq!(e.value(c(20, 6)), n(18.0));
    assert_eq!(e.value(c(6, 1)), n(18.0));
    // Removing the table: references fail.
    e.set_tables(Vec::new());
    assert_eq!(e.value(c(20, 6)), err(ErrorKind::Ref));
}

#[test]
fn names_and_tables() {
    let mut e = engine();
    // A defined name through a structured reference follows resizes.
    e.set_name("Q", NameScope::Workbook, "=T[Qty]").unwrap();
    assert_eq!(eval(&mut e, "=SUM(Q)"), n(11.0));
    let mut t = table(false);
    t.r1 = 5;
    e.set_input(c(5, 1), "4").unwrap();
    e.set_tables(vec![t]);
    assert_eq!(e.value(c(20, 6)), n(15.0));
    // A table name wins over a defined name of the same spelling.
    e.set_name("T", NameScope::Workbook, "=42").unwrap();
    assert_eq!(eval(&mut e, "=ROWS(T)"), n(5.0));
}

#[test]
fn implicit_intersection_and_spill() {
    let mut e = engine();
    e.set_input(c(2, 6), "=@T[Qty]").unwrap();
    assert_eq!(e.value(c(2, 6)), n(5.0));
    e.set_input(c(10, 8), "=T[Qty]").unwrap();
    assert_eq!(e.value(c(10, 8)), n(3.0));
    assert_eq!(e.value(c(13, 8)), n(2.0));
}

#[test]
fn other_sheets() {
    let mut e = engine();
    let s2 = e.add_sheet("Other").unwrap();
    let at = CellCoord::new(s2, 0, 0);
    e.set_input(at, "=SUM(T[Qty])").unwrap();
    assert_eq!(e.value(at), n(11.0));
    e.table_refs_to_a1("T");
    assert_eq!(e.formula_text(at), Some("=SUM(Sheet1!$B$2:$B$5)"));
    assert_eq!(e.value(at), n(11.0));
}

#[test]
fn renaming_a_table_rewrites_formulas() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[Qty])+ROWS(T)").unwrap();
    e.set_input(c(21, 6), "=SUM(t[[#Totals],[Qty]])").unwrap();
    let r = e.rename_table_refs("T", "Sales");
    assert!(r.changed.contains(&c(20, 6)));
    let mut t = table(true);
    t.name = "Sales".into();
    e.set_tables(vec![t]);
    assert_eq!(
        e.formula_text(c(20, 6)),
        Some("=SUM(Sales[Qty])+ROWS(Sales)")
    );
    assert_eq!(
        e.formula_text(c(21, 6)),
        Some("=SUM(Sales[[#Totals],[Qty]])")
    );
    assert_eq!(e.value(c(20, 6)), n(15.0));
    // Unqualified references are untouched.
    assert_eq!(e.formula_text(c(1, 3)), Some("=[@Qty]*[@[Unit Price]]"));
    assert_eq!(e.value(c(1, 3)), n(6.0));
}

#[test]
fn renaming_a_column_rewrites_formulas() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[Qty])").unwrap();
    e.set_input(c(21, 6), "=SUM(T[[Region]:[Qty]])").unwrap();
    e.set_name("Q", NameScope::Workbook, "=T[Qty]").unwrap();
    e.rename_table_column_refs("T", "qty", "Units");
    let mut t = table(true);
    t.columns[1] = "Units".into();
    e.set_input(c(0, 1), "Units").unwrap();
    e.set_tables(vec![t]);
    assert_eq!(e.formula_text(c(20, 6)), Some("=SUM(T[Units])"));
    assert_eq!(e.formula_text(c(21, 6)), Some("=SUM(T[[Region]:[Units]])"));
    assert_eq!(e.formula_text(c(1, 3)), Some("=[@Units]*[@[Unit Price]]"));
    assert_eq!(e.formula_text(c(5, 1)), Some("=SUBTOTAL(109,[Units])"));
    assert_eq!(
        e.name("Q", NameScope::Workbook).unwrap().formula,
        "T[Units]"
    );
    assert_eq!(e.value(c(20, 6)), n(11.0));
    assert_eq!(e.value(c(2, 3)), n(7.5));
}

#[test]
fn convert_to_range() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[Qty])").unwrap();
    e.set_input(c(21, 6), "=T[[#Headers],[Unit Price]]")
        .unwrap();
    e.table_refs_to_a1("T");
    e.set_tables(Vec::new());
    assert_eq!(e.formula_text(c(20, 6)), Some("=SUM($B$2:$B$5)"));
    assert_eq!(e.formula_text(c(21, 6)), Some("=$C$1"));
    assert_eq!(e.formula_text(c(1, 3)), Some("=$B2*$C2"));
    assert_eq!(e.formula_text(c(5, 1)), Some("=SUBTOTAL(109,$B$2:$B$5)"));
    assert_eq!(e.value(c(3, 3)), n(10.0));
    assert_eq!(e.value(c(20, 6)), n(11.0));
}

#[test]
fn structural_edits_keep_structured_text() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[Qty])").unwrap();
    e.insert_rows(S, 0, 2).unwrap();
    assert_eq!(e.formula_text(c(22, 6)), Some("=SUM(T[Qty])"));
    assert_eq!(e.formula_text(c(3, 3)), Some("=[@Qty]*[@[Unit Price]]"));
    let mut t = table(true);
    t.r0 += 2;
    t.r1 += 2;
    e.set_tables(vec![t]);
    assert_eq!(e.value(c(22, 6)), n(11.0));
    assert_eq!(e.value(c(3, 3)), n(6.0));
    assert_eq!(e.table_at(c(3, 3)).map(|t| t.name.as_str()), Some("T"));
    assert!(e.table_at(c(0, 0)).is_none());
}

fn roundtrip(input: &str, canonical: &str) {
    let ast = parse(input).unwrap_or_else(|e| panic!("{input}: {e}"));
    assert_eq!(ast.to_string(), canonical, "{input}");
    assert_eq!(parse(&ast.to_string()).unwrap(), ast, "{input}");
}

#[test]
fn parse_and_print() {
    for (input, canonical) in [
        ("=T[Qty]", "T[Qty]"),
        ("=T[[Qty]]", "T[Qty]"),
        ("=T[[#Headers],[Qty]]", "T[[#Headers],[Qty]]"),
        ("=t[[#headers], [qty]]", "t[[#Headers],[qty]]"),
        ("=T[#All]", "T[#All]"),
        ("=T[[#Data],[#Totals]]", "T[[#Data],[#Totals]]"),
        ("=T[[#Totals],[#Data]]", "T[[#Data],[#Totals]]"),
        ("=[@Qty]", "[@Qty]"),
        ("=[@[Unit Price]]", "[@[Unit Price]]"),
        ("=T[@]", "T[@]"),
        ("=T[[#This Row],[Qty]]", "T[@Qty]"),
        ("=T[[#this row],[Unit Price]]", "T[@[Unit Price]]"),
        ("=T[#This Row]", "T[@]"),
        ("=T[[Qty]:[Total]]", "T[[Qty]:[Total]]"),
        ("=T[@[Qty]:[Total]]", "T[@[Qty]:[Total]]"),
        (
            "=T[[#Headers],[Qty]:[Total]]",
            "T[[#Headers],[Qty]:[Total]]",
        ),
        ("=T[]", "T[]"),
        ("=SUM(T[Qty],T[Total])*2", "SUM(T[Qty],T[Total])*2"),
        ("=T[a']b]", "T[a']b]"),
        ("=T[[It''s]]", "T[It''s]"),
        ("=@T[Qty]", "@T[Qty]"),
    ] {
        roundtrip(input, canonical);
    }
}

#[test]
fn escaped_column_names() {
    let ast = parse("=T[a'[x']#'']").unwrap();
    let Expr::Structured(s) = &ast else {
        panic!("{ast:?}")
    };
    assert_eq!(s.columns, Some(("a[x]#'".into(), None)));
    assert_eq!(ast.to_string(), "T[a'[x']'#'']");
}

#[test]
fn file_form() {
    let Expr::Structured(s) = parse("=[@[Unit Price]]").unwrap() else {
        panic!()
    };
    let f: StructRef = s.file_form(Some("T"));
    assert_eq!(f.to_string(), "T[[#This Row],[Unit Price]]");
    assert_eq!(f.display_form().to_string(), "T[@[Unit Price]]");
    let Expr::Structured(s) = parse("=T[@]").unwrap() else {
        panic!()
    };
    assert_eq!(s.file_form(None).to_string(), "T[#This Row]");
    let Expr::Structured(s) = parse("=T[Qty]").unwrap() else {
        panic!()
    };
    assert_eq!(s.file_form(Some("X")).to_string(), "T[Qty]");
}

#[test]
fn parse_errors() {
    for bad in [
        "=T[",
        "=T[[#Bogus]]",
        "=T[[#This Row],[#Data]]",
        "=T[[Qty],[#Data]]",
        "=T[[a]:[b]:[c]]",
        "=A1[Qty]",
        "=T[[x]",
    ] {
        assert!(parse(bad).is_err(), "{bad}");
    }
}

/// P9-C2: deleting table columns rewrites references like Excel.
#[test]
fn deleting_a_column_rewrites_references_to_ref() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[Qty])").unwrap();
    e.set_input(c(21, 6), "=SUM(T[Unit Price])+1").unwrap();
    e.set_input(c(22, 6), "=COUNTA(T[[#Headers],[Qty]])")
        .unwrap();
    e.set_name("Q", NameScope::Workbook, "=T[Qty]").unwrap();
    e.delete_table_column_refs("T", &["Qty".into()]);
    assert_eq!(e.formula_text(c(20, 6)), Some("=SUM(#REF!)"));
    assert_eq!(e.formula_text(c(22, 6)), Some("=COUNTA(#REF!)"));
    // The neighbour stays.
    assert_eq!(e.formula_text(c(21, 6)), Some("=SUM(T[Unit Price])+1"));
    // Unqualified `[@Qty]` inside the table, the totals formula and names follow.
    assert_eq!(e.formula_text(c(1, 3)), Some("=#REF!*[@[Unit Price]]"));
    assert_eq!(e.formula_text(c(5, 1)), Some("=SUBTOTAL(109,#REF!)"));
    assert_eq!(e.name("Q", NameScope::Workbook).unwrap().formula, "#REF!");
    assert_eq!(e.value(c(20, 6)), Value::Error(ErrorKind::Ref));
}

#[test]
fn deleting_a_range_end_column_shrinks_the_range() {
    let mut e = engine();
    e.set_input(c(20, 6), "=SUM(T[[Qty]:[Total]])").unwrap();
    e.set_input(c(21, 6), "=SUM(T[[Qty]:[Unit Price]])")
        .unwrap();
    e.set_input(c(22, 6), "=SUM(T[[Region]:[Total]])").unwrap();
    e.set_input(c(23, 6), "=SUM(T[[#All],[Total]:[Qty]])")
        .unwrap();
    e.delete_table_column_refs("T", &["Qty".into()]);
    assert_eq!(
        e.formula_text(c(20, 6)),
        Some("=SUM(T[[Unit Price]:[Total]])")
    );
    assert_eq!(e.formula_text(c(21, 6)), Some("=SUM(T[Unit Price])"));
    // An inner column does not touch the range.
    assert_eq!(e.formula_text(c(22, 6)), Some("=SUM(T[[Region]:[Total]])"));
    assert_eq!(
        e.formula_text(c(23, 6)),
        Some("=SUM(T[[#All],[Total]:[Unit Price]])")
    );
    // Every column of a range gone: #REF!.
    e.delete_table_column_refs("T", &["Unit Price".into(), "Total".into()]);
    assert_eq!(e.formula_text(c(20, 6)), Some("=SUM(#REF!)"));
}

#[test]
fn deleting_columns_of_another_table_leaves_references() {
    let mut e = engine();
    let mut other = table(false);
    other.name = "U".into();
    other.r0 = 10;
    other.r1 = 12;
    e.set_tables(vec![table(true), other]);
    e.set_input(c(20, 6), "=SUM(U[Qty])+SUM(T[Qty])").unwrap();
    e.delete_table_column_refs("T", &["Qty".into()]);
    assert_eq!(e.formula_text(c(20, 6)), Some("=SUM(U[Qty])+SUM(#REF!)"));
    // Unknown table: nothing happens.
    let r = e.delete_table_column_refs("Nope", &["Qty".into()]);
    assert!(r.changed.is_empty());
}
