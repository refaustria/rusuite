//! P8-4: sorting and AutoFilter in the model.

use core_model::{Color, Rgb};
use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::sortfilter::criterion_matches;
use model_sheet::{
    AutoFilter, CellRange, CellStyle, Criterion, DynamicFilter, Error, Fill, Filter, FilterOp,
    FilterValue, MergeRect, SortKey, SortKind, SortSpec, Workbook,
};

const S: SheetId = SheetId(0);

fn at(r: u32, c: u32) -> CellCoord {
    CellCoord::new(S, r, c)
}

fn set_col(wb: &mut Workbook, col: u32, inputs: &[&str]) {
    for (r, input) in inputs.iter().enumerate() {
        wb.set_input(at(r as u32, col), input).unwrap();
    }
}

fn col_inputs(wb: &Workbook, col: u32, rows: u32) -> Vec<String> {
    (0..rows)
        .map(|r| model_sheet::content_to_input(wb.content(at(r, col))))
        .collect()
}

fn key(col: u32, ascending: bool) -> SortKey {
    SortKey {
        col,
        ascending,
        kind: SortKind::Auto,
    }
}

fn spec(keys: Vec<SortKey>) -> SortSpec {
    SortSpec {
        keys,
        ..Default::default()
    }
}

fn range(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRange {
    CellRange::new(S, r0, c0, r1, c1)
}

#[test]
fn excel_sort_order_matrix() {
    let inputs = [
        "b", "3", "TRUE", "#N/A", "", "1", "A", "FALSE", "a", "#DIV/0!", "-2", "B",
    ];
    // Column B tags each row with its original position.
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &inputs);
    let tags: Vec<String> = (0..inputs.len()).map(|i| format!("r{i}")).collect();
    let tag_refs: Vec<&str> = tags.iter().map(String::as_str).collect();
    set_col(&mut wb, 1, &tag_refs);
    let n = inputs.len() as u32;

    wb.sort_range(range(0, 0, n - 1, 1), &spec(vec![key(0, true)]))
        .unwrap();
    assert_eq!(
        col_inputs(&wb, 0, n),
        ["-2", "1", "3", "A", "a", "b", "B", "FALSE", "TRUE", "#N/A", "#DIV/0!", ""],
        "numbers < text (case-insensitive, stable) < logical < errors (stable) < blanks"
    );
    // The tags moved with their rows.
    assert_eq!(col_inputs(&wb, 1, 3), ["r10", "r5", "r1"]);

    wb.sort_range(range(0, 0, n - 1, 1), &spec(vec![key(0, false)]))
        .unwrap();
    assert_eq!(
        col_inputs(&wb, 0, n),
        ["#N/A", "#DIV/0!", "TRUE", "FALSE", "b", "B", "A", "a", "3", "1", "-2", ""],
        "descending reverses everything but the blanks; ties keep their order"
    );

    let case = SortSpec {
        keys: vec![key(0, true)],
        case_sensitive: true,
        ..Default::default()
    };
    wb.sort_range(range(0, 0, n - 1, 1), &case).unwrap();
    assert_eq!(
        &col_inputs(&wb, 0, n)[3..7],
        ["a", "A", "b", "B"],
        "case-sensitive: lowercase first"
    );
    let state = wb.sort_state(S).unwrap();
    assert_eq!((state.r0, state.r1, state.c0, state.c1), (0, n - 1, 0, 1));
    assert!(state.case_sensitive);
}

#[test]
fn sort_kinds_numbers_and_text() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["'10", "9", "'2", "x"]);
    let numbers = SortSpec {
        keys: vec![SortKey {
            kind: SortKind::Numbers,
            ..key(0, true)
        }],
        ..Default::default()
    };
    wb.sort_range(range(0, 0, 3, 0), &numbers).unwrap();
    assert_eq!(col_inputs(&wb, 0, 4), ["'2", "9", "'10", "x"]);
    let text = SortSpec {
        keys: vec![SortKey {
            kind: SortKind::Text,
            ..key(0, true)
        }],
        ..Default::default()
    };
    wb.sort_range(range(0, 0, 3, 0), &text).unwrap();
    assert_eq!(col_inputs(&wb, 0, 4), ["'10", "'2", "9", "x"]);
    // Auto: numbers before text.
    wb.sort_range(range(0, 0, 3, 0), &spec(vec![key(0, true)]))
        .unwrap();
    assert_eq!(col_inputs(&wb, 0, 4), ["9", "'10", "'2", "x"]);
}

#[test]
fn multi_key_sort_is_stable_with_header() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["Dept", "b", "a", "b", "a", "b"]);
    set_col(&mut wb, 1, &["Score", "2", "5", "2", "1", "9"]);
    set_col(&mut wb, 2, &["Id", "1", "2", "3", "4", "5"]);
    let sort = SortSpec {
        keys: vec![key(0, true), key(1, false)],
        has_header: true,
        case_sensitive: false,
    };
    wb.sort_range(range(0, 0, 5, 2), &sort).unwrap();
    assert_eq!(col_inputs(&wb, 0, 6), ["Dept", "a", "a", "b", "b", "b"]);
    assert_eq!(col_inputs(&wb, 1, 6), ["Score", "5", "1", "9", "2", "2"]);
    // Ids 1 and 3 tie on both keys and keep their order.
    assert_eq!(col_inputs(&wb, 2, 6), ["Id", "2", "4", "5", "1", "3"]);
    assert_eq!(wb.sort_state(S).unwrap().r0, 1);
}

#[test]
fn sort_moves_styles_and_formulas_like_excel() {
    let mut wb = Workbook::new();
    let red = wb.intern_style(&CellStyle {
        fill: Some(Fill::Solid(Color::Rgb(Rgb::new(255, 0, 0)))),
        ..Default::default()
    });
    set_col(&mut wb, 0, &["3", "1", "2"]);
    for r in 0..3 {
        wb.set_input(at(r, 1), &format!("=A{}*10", r + 1)).unwrap();
    }
    wb.set_input(at(0, 2), "=$A$1+A2").unwrap();
    wb.set_style(at(0, 0), red).unwrap();
    wb.set_row_height(S, 0, Some(30.0)).unwrap();
    // Outside the range: references into it are not adjusted.
    wb.set_input(at(5, 0), "=A1").unwrap();

    let recalc = wb
        .sort_range(range(0, 0, 2, 2), &spec(vec![key(0, true)]))
        .unwrap();
    assert_eq!(col_inputs(&wb, 0, 3), ["1", "2", "3"]);
    // Relative references follow the row; `$` parts stay.
    assert_eq!(col_inputs(&wb, 1, 3), ["=A1*10", "=A2*10", "=A3*10"]);
    assert_eq!(wb.value(at(0, 1)), Value::Number(10.0));
    assert_eq!(wb.formula_text(at(2, 2)), Some("=$A$1+A4"));
    // The style moved with the cell; the row height stayed.
    assert_eq!(wb.cell_style_id(at(2, 0)), red);
    assert!(wb.cell_style_id(at(0, 0)).is_default());
    assert_eq!(wb.row_info(S, 0).height, Some(30.0));
    assert_eq!(wb.formula_text(at(5, 0)), Some("=A1"));
    assert_eq!(wb.value(at(5, 0)), Value::Number(1.0));
    assert!(recalc.changed.contains(&at(5, 0)));
}

#[test]
fn sort_skips_hidden_rows_and_rejects_merges() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["4", "3", "2", "1"]);
    wb.set_row_hidden(S, 1, true).unwrap();
    wb.sort_range(range(0, 0, 3, 0), &spec(vec![key(0, true)]))
        .unwrap();
    assert_eq!(col_inputs(&wb, 0, 4), ["1", "3", "2", "4"]);

    wb.add_merge(S, MergeRect::new(2, 0, 2, 1)).unwrap();
    assert_eq!(
        wb.sort_range(range(0, 0, 3, 0), &spec(vec![key(0, true)])),
        Err(Error::CannotSortMerged)
    );
    assert_eq!(
        wb.sort_range(range(0, 0, 3, 0), &spec(vec![key(4, true)])),
        Err(Error::InvalidRange)
    );
    assert_eq!(
        wb.sort_range(range(0, 0, 3, 0), &spec(vec![])),
        Err(Error::InvalidRange)
    );
    // A whole-column sort only touches the used rows.
    let mut wb = Workbook::new();
    set_col(&mut wb, 0, &["b", "", "a"]);
    wb.sort_range(
        range(0, 0, engine_formula::ast::MAX_ROW, 0),
        &spec(vec![key(0, true)]),
    )
    .unwrap();
    assert_eq!(col_inputs(&wb, 0, 3), ["a", "b", ""]);
}

#[test]
fn current_region_is_bounded_by_blank_rows_and_columns() {
    let mut wb = Workbook::new();
    set_col(&mut wb, 1, &["", "h", "1", "2"]);
    set_col(&mut wb, 2, &["", "h2", "", "3"]);
    wb.set_input(at(4, 3), "diag").unwrap(); // touches C4 diagonally
    wb.set_input(at(7, 1), "far").unwrap();
    assert_eq!(wb.current_region(S, 2, 1), range(1, 1, 4, 3));
    assert_eq!(wb.current_region(S, 7, 1), range(7, 1, 7, 1));
    assert_eq!(wb.current_region(S, 9, 9), range(9, 9, 9, 9));
}

fn crit(op: FilterOp, value: &str) -> Criterion {
    Criterion {
        op,
        value: value.into(),
    }
}

#[test]
fn criterion_matrix() {
    let num = Value::Number(45306.0);
    let text = Value::Text("Apple pie".into());
    let blank = Value::Empty;
    let cases: &[(FilterOp, &str, &Value, &str, bool)] = &[
        (FilterOp::Eq, "45306", &num, "2024-01-15", true),
        (FilterOp::Gt, "45000", &num, "2024-01-15", true),
        (FilterOp::Le, "45000", &num, "2024-01-15", false),
        (FilterOp::Ne, "45306", &num, "2024-01-15", false),
        (FilterOp::Ne, "45306", &text, "Apple pie", true),
        (FilterOp::Eq, "2024-01-15", &num, "2024-01-15", true),
        (FilterOp::Eq, "apple*", &text, "Apple pie", true),
        (FilterOp::Eq, "apple?pie", &text, "Apple pie", true),
        (FilterOp::Eq, "apple", &text, "Apple pie", false),
        (FilterOp::Ne, "*pie", &text, "Apple pie", false),
        (FilterOp::Gt, "apple", &text, "Apple pie", true),
        (FilterOp::Lt, "b", &text, "Apple pie", true),
        (FilterOp::Gt, "1", &text, "Apple pie", false),
        (FilterOp::Gt, "a", &num, "2024-01-15", false),
        (FilterOp::Contains, "PLE P", &text, "Apple pie", true),
        (FilterOp::Contains, "*", &text, "Apple pie", false),
        (FilterOp::NotContains, "xyz", &text, "Apple pie", true),
        (FilterOp::NotContains, "pie", &text, "Apple pie", false),
        (FilterOp::BeginsWith, "app", &text, "Apple pie", true),
        (FilterOp::EndsWith, "pie", &text, "Apple pie", true),
        (FilterOp::EndsWith, "app", &text, "Apple pie", false),
        (FilterOp::Contains, "2024", &num, "2024-01-15", true),
        (FilterOp::Contains, "x", &blank, "", false),
        (FilterOp::NotContains, "x", &blank, "", true),
        (FilterOp::Eq, "", &blank, "", true),
        (FilterOp::Ne, "", &text, "Apple pie", true),
    ];
    for &(op, value, cell, display, want) in cases {
        assert_eq!(
            criterion_matches(&crit(op, value), cell, display),
            want,
            "{op:?} {value:?} on {cell:?}"
        );
    }
}

/// Header + 6 rows: A = name, B = amount, C = SUBTOTAL row below.
fn filter_book() -> Workbook {
    let mut wb = Workbook::new();
    set_col(
        &mut wb,
        0,
        &["Name", "apple", "Banana", "cherry", "", "APPLE", "date"],
    );
    set_col(&mut wb, 1, &["Amount", "10", "20", "30", "40", "50", "x"]);
    wb.set_input(at(8, 1), "=SUBTOTAL(9,B2:B7)").unwrap();
    wb.set_input(at(8, 2), "=SUBTOTAL(109,B2:B7)").unwrap();
    wb.set_auto_filter(S, Some(AutoFilter::new(0, 0, 6, 1)))
        .unwrap();
    wb
}

fn hidden_rows(wb: &Workbook) -> Vec<u32> {
    wb.rows(S)
        .filter(|(_, i)| i.hidden)
        .map(|(r, _)| r)
        .collect()
}

#[test]
fn values_filter_hides_rows_and_feeds_subtotal() {
    let mut wb = filter_book();
    wb.set_row_hidden(S, 3, true).unwrap(); // cherry, by hand
    assert_eq!(wb.value(at(8, 1)), Value::Number(150.0));
    assert_eq!(wb.value(at(8, 2)), Value::Number(120.0));

    wb.set_filter_column(
        S,
        0,
        Some(Filter::Values {
            values: vec!["Apple".into(), "".into(), "cherry".into()],
        }),
    )
    .unwrap();
    let change = wb.apply_auto_filter(S).unwrap();
    assert_eq!(change.rows, vec![2, 6]);
    assert!(change.recalc.changed.contains(&at(8, 1)));
    // apple, cherry (hand-hidden stays hidden), blank, APPLE pass.
    assert_eq!(hidden_rows(&wb), vec![2, 3, 6]);
    assert!(wb.row_info(S, 2).filtered && !wb.row_info(S, 3).filtered);
    // 9 skips filtered rows only, 109 hand-hidden ones too.
    assert_eq!(wb.value(at(8, 1)), Value::Number(130.0));
    assert_eq!(wb.value(at(8, 2)), Value::Number(100.0));

    // Re-applying with another filter shows rows again.
    wb.set_filter_column(
        S,
        0,
        Some(Filter::Values {
            values: vec!["banana".into()],
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden_rows(&wb), vec![1, 3, 4, 5, 6]);

    // Removing the column filter shows the filtered rows only.
    wb.set_filter_column(S, 0, None).unwrap();
    let change = wb.apply_auto_filter(S).unwrap();
    assert_eq!(change.rows, vec![1, 4, 5, 6]);
    assert_eq!(hidden_rows(&wb), vec![3]);
    assert_eq!(wb.value(at(8, 1)), Value::Number(150.0));

    assert_eq!(wb.set_filter_column(S, 5, None), Err(Error::InvalidRange));
    let mut plain = Workbook::new();
    assert_eq!(plain.apply_auto_filter(S), Err(Error::NoAutoFilter));
}

#[test]
fn custom_top10_and_dynamic_filters() {
    let mut wb = filter_book();
    let apply = |wb: &mut Workbook, col: u32, filter: Filter| {
        wb.set_auto_filter(S, Some(AutoFilter::new(0, 0, 6, 1)))
            .unwrap();
        wb.set_filter_column(S, col, Some(filter)).unwrap();
        wb.apply_auto_filter(S).unwrap();
        (1..=6)
            .filter(|&r| !wb.row_info(S, r).hidden)
            .collect::<Vec<u32>>()
    };
    let custom = |criteria, and| Filter::Custom { criteria, and };
    assert_eq!(
        apply(
            &mut wb,
            1,
            custom(
                vec![crit(FilterOp::Ge, "20"), crit(FilterOp::Lt, "50")],
                true
            )
        ),
        vec![2, 3, 4]
    );
    assert_eq!(
        apply(
            &mut wb,
            1,
            custom(
                vec![crit(FilterOp::Eq, "10"), crit(FilterOp::Eq, "x")],
                false
            )
        ),
        vec![1, 6]
    );
    assert_eq!(
        apply(
            &mut wb,
            0,
            custom(vec![crit(FilterOp::BeginsWith, "a")], true)
        ),
        vec![1, 5]
    );
    assert_eq!(
        apply(
            &mut wb,
            1,
            Filter::Top10 {
                top: true,
                percent: false,
                value: 2.0
            }
        ),
        vec![4, 5]
    );
    assert_eq!(
        apply(
            &mut wb,
            1,
            Filter::Top10 {
                top: false,
                percent: true,
                value: 40.0
            }
        ),
        vec![1, 2]
    );
    assert_eq!(
        apply(
            &mut wb,
            1,
            Filter::Dynamic {
                filter: DynamicFilter::AboveAverage
            }
        ),
        vec![4, 5]
    );
    assert_eq!(
        apply(
            &mut wb,
            1,
            Filter::Dynamic {
                filter: DynamicFilter::BelowAverage
            }
        ),
        vec![1, 2]
    );
    // Two columns: both must pass.
    wb.set_filter_column(
        S,
        0,
        Some(custom(vec![crit(FilterOp::Contains, "an")], true)),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    assert_eq!(hidden_rows(&wb), vec![1, 3, 4, 5, 6]);
    let shown = wb.show_filtered_rows(S, 0, 6).unwrap();
    assert_eq!(shown.rows, vec![1, 3, 4, 5, 6]);
    assert!(hidden_rows(&wb).is_empty());
}

#[test]
fn filter_values_counts_and_order() {
    let mut wb = Workbook::new();
    set_col(
        &mut wb,
        0,
        &[
            "Head", "pear", "10", "Pear", "", "TRUE", "#N/A", "2", "apple", "10",
        ],
    );
    set_col(
        &mut wb,
        1,
        &["K", "a", "a", "a", "a", "a", "a", "a", "a", "b"],
    );
    wb.set_auto_filter(S, Some(AutoFilter::new(0, 0, 9, 1)))
        .unwrap();
    let fv = |d: &str, count| FilterValue {
        display: d.into(),
        count,
    };
    assert_eq!(
        wb.filter_values(S, 0).unwrap(),
        vec![
            fv("2", 1),
            fv("10", 2),
            fv("apple", 1),
            fv("pear", 2),
            fv("TRUE", 1),
            fv("#N/A", 1),
            fv("", 1),
        ]
    );
    // Rows hidden by another column's filter are left out; rows hidden
    // by this column's own filter are listed.
    wb.set_filter_column(
        S,
        1,
        Some(Filter::Values {
            values: vec!["a".into()],
        }),
    )
    .unwrap();
    wb.set_filter_column(
        S,
        0,
        Some(Filter::Values {
            values: vec!["pear".into()],
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    let values = wb.filter_values(S, 0).unwrap();
    assert_eq!(values[1], fv("10", 1));
    assert_eq!(values.len(), 7);
    assert_eq!(wb.filter_values(S, 1).unwrap(), vec![fv("a", 2)]);
    assert_eq!(wb.filter_values(S, 3), Err(Error::InvalidRange));
}

#[test]
fn structural_edits_move_filter_and_sort_state() {
    let mut wb = filter_book();
    wb.set_filter_column(
        S,
        1,
        Some(Filter::Values {
            values: vec!["10".into()],
        }),
    )
    .unwrap();
    wb.sort_range(range(1, 0, 6, 1), &spec(vec![key(1, true)]))
        .unwrap();
    wb.insert_rows(S, 0, 2).unwrap();
    wb.insert_cols(S, 0, 1).unwrap();
    let af = wb.auto_filter(S).unwrap();
    assert_eq!((af.r0, af.c0, af.r1, af.c1), (2, 1, 8, 2));
    assert_eq!(af.columns[0].col, 2);
    let st = wb.sort_state(S).unwrap();
    assert_eq!(
        (st.r0, st.c0, st.r1, st.c1, st.keys[0].col),
        (3, 1, 8, 2, 2)
    );
    // Deleting the filtered column drops its filter; deleting all rows
    // drops the filter.
    wb.delete_cols(S, 2, 1).unwrap();
    assert!(wb.auto_filter(S).unwrap().columns.is_empty());
    assert!(wb.sort_state(S).is_none());
    wb.delete_rows(S, 0, 20).unwrap();
    assert!(wb.auto_filter(S).is_none());
}

#[test]
fn snapshot_keeps_filter_sort_and_filtered_rows() {
    let mut wb = filter_book();
    wb.set_filter_column(
        S,
        0,
        Some(Filter::Custom {
            criteria: vec![crit(FilterOp::Contains, "an")],
            and: false,
        }),
    )
    .unwrap();
    wb.apply_auto_filter(S).unwrap();
    wb.sort_range(range(1, 0, 6, 1), &spec(vec![key(1, false)]))
        .unwrap();
    let snap = wb.to_snapshot();
    let back = Workbook::from_snapshot(&snap).unwrap();
    assert_eq!(back.to_snapshot(), snap);
    assert_eq!(back.value(at(8, 1)), wb.value(at(8, 1)));
    let json = serde_json::to_value(&snap.sheets[0]).unwrap();
    assert_eq!(json["autoFilter"]["columns"][0]["filter"]["kind"], "custom");
    assert_eq!(json["sortState"]["keys"][0]["ascending"], false);
    assert_eq!(json["rows"][0]["filtered"], true);
    assert_eq!(
        back.value(at(8, 1)),
        Value::Number(20.0),
        "only Banana passes"
    );
}
