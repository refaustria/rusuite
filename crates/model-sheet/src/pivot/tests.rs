//! Layout and computation rules against hand-verified tables (Excel's
//! results for the same data), the workbook integration and
//! `GETPIVOTDATA`.

use std::collections::BTreeSet;

use engine_formula::{CellCoord, ErrorKind, SheetId, Value};

use super::*;
use crate::Workbook;

const SALES: [[&str; 5]; 7] = [
    ["Region", "Product", "Qtr", "Sales", "Units"],
    ["East", "Apple", "Q1", "10", "1"],
    ["East", "Pear", "Q1", "20", "2"],
    ["East", "Apple", "Q2", "30", "3"],
    ["West", "Apple", "Q1", "40", "4"],
    ["West", "Pear", "Q2", "50", "5"],
    ["North", "Pear", "Q2", "60", "6"],
];

const REGION: u32 = 0;
const PRODUCT: u32 = 1;
const QTR: u32 = 2;
const SALES_F: u32 = 3;
const UNITS: u32 = 4;

fn book(data: &[&[&str]]) -> (Workbook, SheetId) {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    for (r, row) in data.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                .unwrap();
        }
    }
    (wb, s)
}

fn sales() -> (Workbook, SheetId) {
    let rows: Vec<&[&str]> = SALES.iter().map(|r| r.as_slice()).collect();
    book(&rows)
}

fn source(rows: u32, cols: u32) -> PivotSource {
    PivotSource::range("Sheet1", 0, 0, rows - 1, cols - 1)
}

/// A pivot table at H1 over the sales data, adjusted by `f`.
fn pivot(fields: PivotFields, f: impl FnOnce(&mut PivotTable)) -> (Workbook, SheetId, u32) {
    let (mut wb, s) = sales();
    let (id, _) = wb.create_pivot(source(7, 5), s, 0, 7, fields).unwrap();
    let mut def = wb.pivot(id).unwrap().1.clone();
    f(&mut def);
    wb.update_pivot(id, def).unwrap();
    (wb, s, id)
}

fn rows(list: &[u32]) -> Vec<AxisField> {
    list.iter().map(|&f| f.into()).collect()
}

/// The table as displayed (page fields included), row by row.
fn shown(wb: &Workbook, s: SheetId, id: u32) -> Vec<Vec<String>> {
    let e = wb.pivot_output(id).unwrap().extent;
    (e.r0..=e.r1)
        .map(|r| {
            (e.c0..=e.c1)
                .map(|c| {
                    let at = CellCoord::new(s, r, c);
                    crate::numfmt::display_value(
                        &wb.value(at),
                        wb.style(at).number_format.as_deref(),
                    )
                })
                .collect()
        })
        .collect()
}

fn expect(wb: &Workbook, s: SheetId, id: u32, want: &[&[&str]]) {
    let got = shown(wb, s, id);
    let want: Vec<Vec<String>> = want
        .iter()
        .map(|r| r.iter().map(|c| c.to_string()).collect())
        .collect();
    assert_eq!(got, want, "\n got: {got:#?}");
}

fn value_at(wb: &Workbook, s: SheetId, r: u32, c: u32) -> Value {
    wb.value(CellCoord::new(s, r, c))
}

fn kind_at(wb: &Workbook, s: SheetId, r: u32, c: u32) -> CellRole {
    wb.pivot_cell(CellCoord::new(s, r, c)).unwrap().1.kind
}

fn sum_by(fields: &[u32]) -> PivotFields {
    PivotFields {
        rows: rows(fields),
        values: vec![DataField::sum(SALES_F)],
        ..Default::default()
    }
}

fn sum_by_fields(rows_: &[u32], value: u32) -> PivotFields {
    PivotFields {
        rows: rows(rows_),
        values: vec![DataField::sum(value)],
        ..Default::default()
    }
}

// --- layout -------------------------------------------------------------------------

#[test]
fn one_row_field() {
    let (wb, s, id) = pivot(sum_by(&[REGION]), |_| {});
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["North", "60"],
            &["West", "90"],
            &["Grand Total", "210"],
        ],
    );
    assert_eq!(kind_at(&wb, s, 0, 7), CellRole::Header);
    assert_eq!(kind_at(&wb, s, 1, 7), CellRole::RowLabel);
    assert_eq!(kind_at(&wb, s, 1, 8), CellRole::Value);
    assert_eq!(kind_at(&wb, s, 4, 7), CellRole::GrandTotal);
    assert_eq!(kind_at(&wb, s, 4, 8), CellRole::GrandTotal);
    let out = wb.pivot_output(id).unwrap();
    assert_eq!(out.table, PivotRect::new(0, 7, 4, 8));
    assert_eq!(
        (out.header_rows, out.label_cols, out.first_header_row),
        (1, 1, 1)
    );
}

#[test]
fn nested_rows_compact_subtotals_on_top() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |_| {});
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["Apple", "40"],
            &["Pear", "20"],
            &["North", "60"],
            &["Pear", "60"],
            &["West", "90"],
            &["Apple", "40"],
            &["Pear", "50"],
            &["Grand Total", "210"],
        ],
    );
    let east = wb.pivot_cell(CellCoord::new(s, 1, 7)).unwrap().1;
    assert_eq!(
        (east.level, east.collapsed, east.indent),
        (0, Some(false), 0)
    );
    let apple = wb.pivot_cell(CellCoord::new(s, 2, 7)).unwrap().1;
    assert_eq!((apple.level, apple.collapsed, apple.indent), (1, None, 1));
    assert_eq!(wb.style(CellCoord::new(s, 2, 7)).alignment.indent, Some(1));
    assert_eq!(kind_at(&wb, s, 1, 8), CellRole::Subtotal);
    assert_eq!(kind_at(&wb, s, 2, 8), CellRole::Value);
}

#[test]
fn crosstab_with_column_field() {
    let (wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Sum of Sales", "Column Labels", "", ""],
            &["Row Labels", "Q1", "Q2", "Grand Total"],
            &["East", "30", "30", "60"],
            &["North", "", "60", "60"],
            &["West", "40", "50", "90"],
            &["Grand Total", "70", "140", "210"],
        ],
    );
    assert_eq!(kind_at(&wb, s, 1, 8), CellRole::ColLabel);
    assert_eq!(kind_at(&wb, s, 3, 8), CellRole::Value);
    assert_eq!(value_at(&wb, s, 3, 8), Value::Empty);
    let out = wb.pivot_output(id).unwrap();
    assert_eq!(
        (out.header_rows, out.label_cols, out.first_header_row),
        (2, 1, 1)
    );
}

#[test]
fn several_values_on_columns() {
    let (wb, s, id) = pivot(
        PivotFields {
            rows: rows(&[REGION]),
            values: vec![DataField::sum(SALES_F), DataField::sum(UNITS)],
            ..Default::default()
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales", "Sum of Units"],
            &["East", "60", "6"],
            &["North", "60", "6"],
            &["West", "90", "9"],
            &["Grand Total", "210", "21"],
        ],
    );
    let out = wb.pivot_output(id).unwrap();
    assert_eq!(out.col_fields, vec![-2]);
    assert_eq!(out.first_header_row, 0);
}

#[test]
fn several_values_with_column_field() {
    let (wb, s, id) = pivot(
        PivotFields {
            rows: rows(&[REGION]),
            cols: rows(&[QTR]),
            values: vec![DataField::sum(SALES_F), DataField::sum(UNITS)],
            ..Default::default()
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["", "Column Labels", "", "", "", "", ""],
            &[
                "",
                "Q1",
                "",
                "Q2",
                "",
                "Total Sum of Sales",
                "Total Sum of Units",
            ],
            &[
                "Row Labels",
                "Sum of Sales",
                "Sum of Units",
                "Sum of Sales",
                "Sum of Units",
                "",
                "",
            ],
            &["East", "30", "3", "30", "3", "60", "6"],
            &["North", "", "", "60", "6", "60", "6"],
            &["West", "40", "4", "50", "5", "90", "9"],
            &["Grand Total", "70", "7", "140", "14", "210", "21"],
        ],
    );
}

#[test]
fn several_values_on_rows() {
    let (wb, s, id) = pivot(
        PivotFields {
            rows: rows(&[REGION]),
            values: vec![DataField::sum(SALES_F), DataField::sum(UNITS)],
            ..Default::default()
        },
        |t| t.options.values_in = ValuesAxis::Rows,
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", ""],
            &["East", ""],
            &["Sum of Sales", "60"],
            &["Sum of Units", "6"],
            &["North", ""],
            &["Sum of Sales", "60"],
            &["Sum of Units", "6"],
            &["West", ""],
            &["Sum of Sales", "90"],
            &["Sum of Units", "9"],
            &["Total Sum of Sales", "210"],
            &["Total Sum of Units", "21"],
        ],
    );
    assert_eq!(wb.pivot_output(id).unwrap().row_fields, vec![0, -2]);
}

#[test]
fn every_aggregate() {
    // East 10, 20, 30; North 60; West 40, 50; all six values.
    let cases: [(AggFunc, [f64; 4]); 9] = [
        (AggFunc::Count, [3.0, 1.0, 2.0, 6.0]),
        (AggFunc::Average, [20.0, 60.0, 45.0, 35.0]),
        (AggFunc::Max, [30.0, 60.0, 50.0, 60.0]),
        (AggFunc::Min, [10.0, 60.0, 40.0, 10.0]),
        (AggFunc::Product, [6000.0, 60.0, 2000.0, 720_000_000.0]),
        (AggFunc::CountNums, [3.0, 1.0, 2.0, 6.0]),
        (AggFunc::StdDevP, [8.164_965_809, 0.0, 5.0, 17.078_251_277]),
        (AggFunc::VarP, [66.666_666_667, 0.0, 25.0, 291.666_666_667]),
        (AggFunc::Var, [100.0, f64::NAN, 50.0, 350.0]),
    ];
    for (func, want) in cases {
        let (wb, s, _) = pivot(
            PivotFields {
                rows: rows(&[REGION]),
                values: vec![DataField::new(SALES_F, func)],
                ..Default::default()
            },
            |_| {},
        );
        for (i, w) in want.iter().enumerate() {
            let v = value_at(&wb, s, 1 + i as u32, 8);
            if w.is_nan() {
                assert_eq!(v, Value::Error(ErrorKind::Div0), "{func:?} row {i}");
            } else {
                let Value::Number(n) = v else {
                    panic!("{func:?} row {i}: {v:?}")
                };
                assert!((n - w).abs() < 1e-6, "{func:?} row {i}: {n} vs {w}");
            }
        }
        assert_eq!(
            value_at(&wb, s, 0, 8),
            Value::Text(format!("{} of Sales", func.caption())),
            "{func:?}"
        );
    }
    // StdDev: North has a single value.
    let (wb, s, _) = pivot(
        PivotFields {
            rows: rows(&[REGION]),
            values: vec![DataField::new(SALES_F, AggFunc::StdDev)],
            ..Default::default()
        },
        |_| {},
    );
    assert_eq!(value_at(&wb, s, 1, 8), Value::Number(10.0));
    assert_eq!(value_at(&wb, s, 2, 8), Value::Error(ErrorKind::Div0));
    let Value::Number(n) = value_at(&wb, s, 4, 8) else {
        panic!()
    };
    assert!((n - 18.708_286_934).abs() < 1e-6);
}

#[test]
fn count_of_a_text_field() {
    let (wb, s, id) = pivot(
        PivotFields {
            rows: rows(&[REGION]),
            values: vec![DataField::new(PRODUCT, AggFunc::Count)],
            ..Default::default()
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Count of Product"],
            &["East", "3"],
            &["North", "1"],
            &["West", "2"],
            &["Grand Total", "6"],
        ],
    );
}

fn show(show_as: ShowAs, cols: &[u32], rows_: &[u32]) -> (Workbook, SheetId, u32) {
    pivot(
        PivotFields {
            rows: rows(rows_),
            cols: rows(cols),
            values: vec![DataField {
                show_as,
                ..DataField::sum(SALES_F)
            }],
            ..Default::default()
        },
        |_| {},
    )
}

#[test]
fn percent_of_total() {
    let (wb, s, id) = show(ShowAs::PercentOfTotal, &[], &[REGION]);
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "28.57%"],
            &["North", "28.57%"],
            &["West", "42.86%"],
            &["Grand Total", "100.00%"],
        ],
    );
}

#[test]
fn percent_of_row() {
    let (wb, s, id) = show(ShowAs::PercentOfRow, &[QTR], &[REGION]);
    expect(
        &wb,
        s,
        id,
        &[
            &["Sum of Sales", "Column Labels", "", ""],
            &["Row Labels", "Q1", "Q2", "Grand Total"],
            &["East", "50.00%", "50.00%", "100.00%"],
            &["North", "", "100.00%", "100.00%"],
            &["West", "44.44%", "55.56%", "100.00%"],
            &["Grand Total", "33.33%", "66.67%", "100.00%"],
        ],
    );
}

#[test]
fn percent_of_column() {
    let (wb, s, id) = show(ShowAs::PercentOfColumn, &[QTR], &[REGION]);
    expect(
        &wb,
        s,
        id,
        &[
            &["Sum of Sales", "Column Labels", "", ""],
            &["Row Labels", "Q1", "Q2", "Grand Total"],
            &["East", "42.86%", "21.43%", "28.57%"],
            &["North", "", "42.86%", "28.57%"],
            &["West", "57.14%", "35.71%", "42.86%"],
            &["Grand Total", "100.00%", "100.00%", "100.00%"],
        ],
    );
}

#[test]
fn percent_of_parent_row() {
    let (wb, s, id) = show(ShowAs::PercentOfParent, &[], &[REGION, PRODUCT]);
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "28.57%"],
            &["Apple", "66.67%"],
            &["Pear", "33.33%"],
            &["North", "28.57%"],
            &["Pear", "100.00%"],
            &["West", "42.86%"],
            &["Apple", "44.44%"],
            &["Pear", "55.56%"],
            &["Grand Total", "100.00%"],
        ],
    );
}

#[test]
fn difference_from_previous() {
    let (wb, s, id) = show(
        ShowAs::DifferenceFrom {
            base_field: QTR,
            base_item: BaseItem::Previous,
        },
        &[QTR],
        &[REGION],
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Sum of Sales", "Column Labels", "", ""],
            &["Row Labels", "Q1", "Q2", "Grand Total"],
            &["East", "", "0", ""],
            &["North", "", "60", ""],
            &["West", "", "10", ""],
            &["Grand Total", "", "70", ""],
        ],
    );
}

#[test]
fn difference_from_an_item() {
    // Shared items in first-seen order: East 0, West 1, North 2.
    let (wb, s, id) = show(
        ShowAs::DifferenceFrom {
            base_field: REGION,
            base_item: BaseItem::Item { item: 0 },
        },
        &[],
        &[REGION],
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", ""],
            &["North", "0"],
            &["West", "30"],
            &["Grand Total", ""],
        ],
    );
}

#[test]
fn running_total_and_rank() {
    let (wb, s, id) = show(ShowAs::RunningTotal { base_field: REGION }, &[], &[REGION]);
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["North", "120"],
            &["West", "210"],
            &["Grand Total", ""],
        ],
    );
    let (wb, s, id) = show(ShowAs::Rank { base_field: REGION }, &[], &[REGION]);
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "2"],
            &["North", "2"],
            &["West", "1"],
            &["Grand Total", ""],
        ],
    );
}

#[test]
fn subtotals_off() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        t.rows[0].subtotals = Subtotals::None;
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", ""],
            &["Apple", "40"],
            &["Pear", "20"],
            &["North", ""],
            &["Pear", "60"],
            &["West", ""],
            &["Apple", "40"],
            &["Pear", "50"],
            &["Grand Total", "210"],
        ],
    );
    assert_eq!(kind_at(&wb, s, 1, 8), CellRole::Blank);
}

#[test]
fn custom_subtotals_below() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        t.rows[0].subtotals = Subtotals::Custom {
            functions: vec![AggFunc::Sum, AggFunc::Count],
        };
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", ""],
            &["Apple", "40"],
            &["Pear", "20"],
            &["East Sum", "60"],
            &["East Count", "3"],
            &["North", ""],
            &["Pear", "60"],
            &["North Sum", "60"],
            &["North Count", "1"],
            &["West", ""],
            &["Apple", "40"],
            &["Pear", "50"],
            &["West Sum", "90"],
            &["West Count", "2"],
            &["Grand Total", "210"],
        ],
    );
}

#[test]
fn tabular_form_subtotals_below() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        for a in &mut t.rows {
            a.layout = PivotLayout::Tabular;
        }
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Region", "Product", "Sum of Sales"],
            &["East", "Apple", "40"],
            &["", "Pear", "20"],
            &["East Total", "", "60"],
            &["North", "Pear", "60"],
            &["North Total", "", "60"],
            &["West", "Apple", "40"],
            &["", "Pear", "50"],
            &["West Total", "", "90"],
            &["Grand Total", "", "210"],
        ],
    );
    assert_eq!(kind_at(&wb, s, 3, 7), CellRole::Subtotal);
    assert_eq!(kind_at(&wb, s, 3, 9), CellRole::Subtotal);
    assert_eq!(wb.pivot_output(id).unwrap().label_cols, 2);
}

#[test]
fn tabular_form_with_repeated_labels() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        for a in &mut t.rows {
            a.layout = PivotLayout::Tabular;
            a.subtotals = Subtotals::None;
        }
        t.options.repeat_labels = true;
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Region", "Product", "Sum of Sales"],
            &["East", "Apple", "40"],
            &["East", "Pear", "20"],
            &["North", "Pear", "60"],
            &["West", "Apple", "40"],
            &["West", "Pear", "50"],
            &["Grand Total", "", "210"],
        ],
    );
}

#[test]
fn outline_form_subtotals_on_top() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        for a in &mut t.rows {
            a.layout = PivotLayout::Outline;
        }
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Region", "Product", "Sum of Sales"],
            &["East", "", "60"],
            &["", "Apple", "40"],
            &["", "Pear", "20"],
            &["North", "", "60"],
            &["", "Pear", "60"],
            &["West", "", "90"],
            &["", "Apple", "40"],
            &["", "Pear", "50"],
            &["Grand Total", "", "210"],
        ],
    );
}

#[test]
fn grand_totals_off() {
    let (wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |t| {
            t.options.grand_total_rows = false;
            t.options.grand_total_cols = false;
        },
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Sum of Sales", "Column Labels", ""],
            &["Row Labels", "Q1", "Q2"],
            &["East", "30", "30"],
            &["North", "", "60"],
            &["West", "40", "50"],
        ],
    );
    // Only the column grand totals (the bottom row) off.
    let (wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |t| t.options.grand_total_cols = false,
    );
    let got = shown(&wb, s, id);
    assert_eq!(got.len(), 5);
    assert_eq!(got[1][3], "Grand Total");
}

#[test]
fn page_filter_single_item() {
    // Shared items in first-seen order: East 0, West 1, North 2.
    let (wb, s, id) = pivot(
        PivotFields {
            filters: vec![PageField {
                field: REGION,
                selected: PageSelection::Items {
                    items: BTreeSet::from([0]),
                },
            }],
            ..sum_by(&[PRODUCT])
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Region", "East"],
            &["", ""],
            &["Row Labels", "Sum of Sales"],
            &["Apple", "40"],
            &["Pear", "20"],
            &["Grand Total", "60"],
        ],
    );
    assert_eq!(kind_at(&wb, s, 0, 8), CellRole::Page);
    // The blank row between filters and table is not part of the table.
    assert!(wb.pivot_cell(CellCoord::new(s, 1, 7)).is_none());
    let out = wb.pivot_output(id).unwrap();
    assert_eq!(out.table, PivotRect::new(2, 7, 5, 8));
}

#[test]
fn page_filter_multiple_items() {
    let (wb, s, id) = pivot(sum_by(&[PRODUCT]), |t| {
        t.filters = vec![PageField {
            field: REGION,
            selected: PageSelection::Items {
                items: BTreeSet::from([0, 1]), // East, West
            },
        }];
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Region", "(Multiple Items)"],
            &["", ""],
            &["Row Labels", "Sum of Sales"],
            &["Apple", "80"],
            &["Pear", "70"],
            &["Grand Total", "150"],
        ],
    );
}

#[test]
fn sorting_descending_and_manual() {
    let (wb, s, id) = pivot(sum_by(&[REGION]), |t| {
        t.rows[0].sort = SortOrder::Descending
    });
    let labels: Vec<String> = shown(&wb, s, id).iter().map(|r| r[0].clone()).collect();
    assert_eq!(
        labels,
        ["Row Labels", "West", "North", "East", "Grand Total"]
    );
    let (wb, s, id) = pivot(sum_by(&[REGION]), |t| {
        t.rows[0].sort = SortOrder::Manual { order: vec![2] }
    });
    let labels: Vec<String> = shown(&wb, s, id).iter().map(|r| r[0].clone()).collect();
    assert_eq!(
        labels,
        ["Row Labels", "North", "East", "West", "Grand Total"]
    );
}

#[test]
fn collapsed_item() {
    let (wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        t.rows[0].collapsed_items = BTreeSet::from([0]); // East
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["North", "60"],
            &["Pear", "60"],
            &["West", "90"],
            &["Apple", "40"],
            &["Pear", "50"],
            &["Grand Total", "210"],
        ],
    );
    let east = wb.pivot_cell(CellCoord::new(s, 1, 7)).unwrap().1;
    assert_eq!(east.collapsed, Some(true));
    assert_eq!(kind_at(&wb, s, 1, 8), CellRole::Value);
}

#[test]
fn hidden_item_drops_its_records() {
    let (wb, s, id) = pivot(sum_by(&[REGION]), |t| {
        t.rows[0].hidden_items = BTreeSet::from([2]); // North
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["West", "90"],
            &["Grand Total", "150"],
        ],
    );
}

#[test]
fn nested_column_fields_without_rows() {
    let (wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[REGION, PRODUCT]),
            values: vec![DataField::sum(SALES_F)],
            ..Default::default()
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[
            &[
                "Sum of Sales",
                "Column Labels",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ],
            &[
                "",
                "East",
                "",
                "East Total",
                "North",
                "North Total",
                "West",
                "",
                "West Total",
                "Grand Total",
            ],
            &["", "Apple", "Pear", "", "Pear", "", "Apple", "Pear", "", ""],
            &["", "40", "20", "60", "60", "60", "40", "50", "90", "210"],
        ],
    );
}

#[test]
fn values_only() {
    let (wb, s, id) = pivot(
        PivotFields {
            values: vec![DataField::sum(SALES_F)],
            ..Default::default()
        },
        |_| {},
    );
    expect(&wb, s, id, &[&["Sum of Sales"], &["210"]]);
    let (wb, s, id) = pivot(
        PivotFields {
            values: vec![DataField::sum(SALES_F), DataField::new(UNITS, AggFunc::Max)],
            ..Default::default()
        },
        |_| {},
    );
    expect(
        &wb,
        s,
        id,
        &[&["Sum of Sales", "Max of Units"], &["210", "6"]],
    );
}

#[test]
fn empty_cells_and_errors_shown_as() {
    let (wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |t| t.options.empty_as = "-".into(),
    );
    assert_eq!(shown(&wb, s, id)[3][1], "-");
    let (mut wb, s) = book(&[&["K", "V"], &["a", "1"], &["a", "=1/0"], &["b", "2"]]);
    let (id, _) = wb
        .create_pivot(source(4, 2), s, 0, 4, sum_by_fields(&[0], 1))
        .unwrap();
    assert_eq!(value_at(&wb, s, 1, 5), Value::Error(ErrorKind::Div0));
    assert_eq!(value_at(&wb, s, 2, 5), Value::Number(2.0));
    assert_eq!(value_at(&wb, s, 3, 5), Value::Error(ErrorKind::Div0));
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.options.error_as = Some("n/a".into());
    wb.update_pivot(id, def).unwrap();
    assert_eq!(value_at(&wb, s, 1, 5), Value::Text("n/a".into()));
}

#[test]
fn blank_items_and_show_all_items() {
    let (mut wb, s) = book(&[
        &["Region", "Product", "Sales"],
        &["East", "Apple", "1"],
        &["", "Pear", "2"],
        &["West", "", "4"],
        &["East", "Pear", "8"],
    ]);
    let (id, _) = wb
        .create_pivot(source(5, 3), s, 0, 4, sum_by_fields(&[0], 2))
        .unwrap();
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "9"],
            &["West", "4"],
            &["(blank)", "2"],
            &["Grand Total", "15"],
        ],
    );
    // Show items with no data: every product under every region.
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.rows = vec![0.into(), 1.into()];
    def.rows[1].show_all_items = true;
    wb.update_pivot(id, def).unwrap();
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "9"],
            &["Apple", "1"],
            &["Pear", "8"],
            &["(blank)", ""],
            &["West", "4"],
            &["Apple", ""],
            &["Pear", ""],
            &["(blank)", "4"],
            &["(blank)", "2"],
            &["Apple", ""],
            &["Pear", "2"],
            &["(blank)", ""],
            &["Grand Total", "15"],
        ],
    );
}

#[test]
fn dates_and_numbers_as_items() {
    let (mut wb, s) = book(&[
        &["Day", "Year", "Amount"],
        &["45306", "2024", "5"],
        &["45301", "2023", "7"],
    ]);
    let date = wb.intern_style(&crate::CellStyle {
        number_format: Some("yyyy-mm-dd".into()),
        ..Default::default()
    });
    wb.set_style(CellCoord::new(s, 1, 0), date).unwrap();
    wb.set_style(CellCoord::new(s, 2, 0), date).unwrap();
    let (id, _) = wb
        .create_pivot(source(3, 3), s, 0, 4, sum_by_fields(&[0], 2))
        .unwrap();
    assert_eq!(wb.pivot_cache(1).unwrap().fields[0].kind, FieldKind::Date);
    assert_eq!(wb.pivot_cache(1).unwrap().fields[1].kind, FieldKind::Number);
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Amount"],
            &["2024-01-10", "7"],
            &["2024-01-15", "5"],
            &["Grand Total", "12"],
        ],
    );
    // A label stays a number (with the date format).
    assert!(matches!(value_at(&wb, s, 1, 4), Value::Number(_)));
}

#[test]
fn values_on_rows_with_subtotals_below() {
    let (wb, s, id) = pivot(
        PivotFields {
            rows: rows(&[REGION, PRODUCT]),
            values: vec![DataField::sum(SALES_F), DataField::new(UNITS, AggFunc::Max)],
            ..Default::default()
        },
        |t| {
            t.options.values_in = ValuesAxis::Rows;
            t.options.grand_total_cols = false;
            t.rows[0].hidden_items = BTreeSet::from([0, 1]); // North only
        },
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", ""],
            &["North", ""],
            &["Pear", ""],
            &["Sum of Sales", "60"],
            &["Max of Units", "6"],
            &["North Sum of Sales", "60"],
            &["North Max of Units", "6"],
        ],
    );
}

#[test]
fn empty_pivot_reserves_an_area() {
    let (wb, s, id) = pivot(PivotFields::default(), |_| {});
    let out = wb.pivot_output(id).unwrap();
    assert_eq!(out.table, PivotRect::new(0, 7, 17, 9));
    assert!(wb.pivot_at(CellCoord::new(s, 17, 9)).is_some());
}

// --- workbook integration --------------------------------------------------------------

#[test]
fn pivot_cells_are_read_only_and_overlap_is_refused() {
    let (mut wb, s, id) = pivot(sum_by(&[REGION]), |_| {});
    let r = |r0, c0, r1, c1| crate::CellRange::new(s, r0, c0, r1, c1);
    assert_eq!(
        wb.check_pivot_edit(r(2, 8, 2, 8)),
        Err(crate::Error::PivotCell)
    );
    assert_eq!(wb.check_pivot_edit(r(0, 0, 9, 6)), Ok(()));
    // Something in the way of a bigger layout.
    wb.set_input(CellCoord::new(s, 0, 10), "x").unwrap();
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.cols = rows(&[QTR]);
    assert_eq!(
        wb.update_pivot(id, def),
        Err(crate::Error::PivotOverlap {
            r0: 0,
            c0: 10,
            r1: 0,
            c1: 10
        })
    );
    // Nothing changed.
    assert_eq!(wb.pivot(id).unwrap().1.cols, vec![]);
    assert_eq!(value_at(&wb, s, 4, 8), Value::Number(210.0));
    // Creating over data fails too.
    assert!(matches!(
        wb.create_pivot(source(7, 5), s, 0, 0, sum_by(&[REGION])),
        Err(crate::Error::PivotOverlap { .. })
    ));
    assert_eq!(wb.pivot_caches().len(), 1);
}

#[test]
fn refresh_reads_the_source_again() {
    let (mut wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        t.rows[0].collapsed_items = BTreeSet::from([1]); // West
    });
    assert!(!wb.mark_pivot_sources_stale(&[CellCoord::new(s, 0, 7)]));
    wb.set_input(CellCoord::new(s, 6, 3), "100").unwrap();
    assert!(wb.mark_pivot_sources_stale(&[CellCoord::new(s, 6, 3)]));
    assert_eq!(wb.stale_pivots(), vec![id]);
    // Not refreshed yet (as in Excel).
    assert_eq!(value_at(&wb, s, 4, 8), Value::Number(60.0));
    wb.refresh_pivot(id).unwrap();
    assert!(wb.stale_pivots().is_empty());
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["Apple", "40"],
            &["Pear", "20"],
            &["North", "100"],
            &["Pear", "100"],
            &["West", "90"],
            &["Grand Total", "250"],
        ],
    );
    // A shrinking table clears the cells it no longer covers.
    for c in 0..5 {
        wb.clear(CellCoord::new(s, 6, c)).unwrap();
    }
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.rows.truncate(1);
    wb.update_pivot(id, def).unwrap();
    // The cache still has the old North record until refreshed.
    assert_eq!(shown(&wb, s, id).len(), 5);
    wb.pivot_caches[0].source = PivotSource::range("Sheet1", 0, 0, 5, 4);
    wb.refresh_pivot(id).unwrap();
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "60"],
            &["West", "90"],
            &["Grand Total", "150"],
        ],
    );
    assert_eq!(value_at(&wb, s, 4, 7), Value::Empty);
    assert_eq!(value_at(&wb, s, 4, 8), Value::Empty);
    // The retained item North keeps its index.
    let cache = wb.pivot_cache(1).unwrap();
    assert_eq!(
        cache.fields[0].item_index(&Item::Text("North".into())),
        Some(2)
    );
}

#[test]
fn refresh_drops_fields_that_are_gone() {
    let (mut wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |_| {},
    );
    wb.set_input(CellCoord::new(s, 0, 2), "Quarter").unwrap();
    wb.refresh_pivot(id).unwrap();
    let t = wb.pivot(id).unwrap().1;
    assert!(t.cols.is_empty());
    assert_eq!(wb.pivot_cache(1).unwrap().fields[2].name, "Quarter");
    assert_eq!(shown(&wb, s, id)[0], ["Row Labels", "Sum of Sales"]);
}

#[test]
fn structural_edits_move_tables_and_sources() {
    let (mut wb, s, id) = pivot(sum_by(&[REGION]), |_| {});
    // Through the table: refused.
    assert_eq!(wb.insert_rows(s, 2, 1), Err(crate::Error::PivotCell));
    assert_eq!(wb.delete_rows(s, 4, 1), Err(crate::Error::PivotCell));
    // Above: everything moves.
    wb.insert_rows(s, 0, 2).unwrap();
    let t = wb.pivot(id).unwrap().1;
    assert_eq!(t.location, PivotRect::new(2, 7, 6, 8));
    assert_eq!(value_at(&wb, s, 6, 8), Value::Number(210.0));
    assert_eq!(
        wb.pivot_cache(1).unwrap().source,
        PivotSource::range("Sheet1", 2, 0, 8, 4)
    );
    assert!(wb.stale_pivots().is_empty());
    assert_eq!(kind_at(&wb, s, 6, 7), CellRole::GrandTotal);
    // Inside the source columns: it grows and goes stale.
    wb.insert_cols(s, 1, 1).unwrap();
    assert_eq!(
        wb.pivot_cache(1).unwrap().source,
        PivotSource::range("Sheet1", 2, 0, 8, 5)
    );
    assert_eq!(wb.stale_pivots(), vec![id]);
    assert_eq!(wb.pivot(id).unwrap().1.location, PivotRect::new(2, 8, 6, 9));
}

#[test]
fn delete_and_move() {
    let (mut wb, s, id) = pivot(sum_by(&[REGION]), |_| {});
    let other = wb.add_sheet("Other").unwrap();
    wb.move_pivot(id, other, 2, 1).unwrap();
    assert_eq!(value_at(&wb, s, 4, 8), Value::Empty);
    assert_eq!(value_at(&wb, other, 6, 2), Value::Number(210.0));
    assert!(wb.pivots(s).is_empty());
    assert_eq!(wb.pivot(id).unwrap().0, other);
    // Overlapping its own old place is fine.
    wb.move_pivot(id, other, 3, 2).unwrap();
    assert_eq!(value_at(&wb, other, 7, 3), Value::Number(210.0));
    assert_eq!(value_at(&wb, other, 2, 1), Value::Empty);
    wb.delete_pivot(id).unwrap();
    assert!(wb.pivots(other).is_empty());
    assert!(wb.pivot_caches().is_empty());
    assert_eq!(wb.used_range(other), None);
}

#[test]
fn snapshot_roundtrip_and_duplicate_sheet() {
    let (mut wb, s, id) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |t| t.options.banded = true,
    );
    wb.set_input(
        CellCoord::new(s, 10, 0),
        "=GETPIVOTDATA(\"Sales\",H1,\"Region\",\"West\")",
    )
    .unwrap();
    let snap = wb.to_snapshot();
    let json = serde_json::to_string(&snap).unwrap();
    let back = Workbook::from_snapshot(&serde_json::from_str(&json).unwrap()).unwrap();
    assert_eq!(back.to_snapshot(), snap);
    assert_eq!(back.value(CellCoord::new(s, 10, 0)), Value::Number(90.0));
    assert!(back.pivot_cell(CellCoord::new(s, 2, 7)).is_some());
    let (copy, _) = wb.duplicate_sheet(s, "Copy").unwrap();
    let t = &wb.pivots(copy)[0];
    assert_ne!(t.id, id);
    assert_eq!(t.name, "PivotTable2");
    assert_eq!(t.cache_id, 1);
    assert!(wb.pivot_cell(CellCoord::new(copy, 2, 7)).is_some());
}

// --- GETPIVOTDATA ---------------------------------------------------------------------

fn gpd(wb: &mut Workbook, s: SheetId, formula: &str) -> Value {
    let at = CellCoord::new(s, 20, 0);
    wb.set_input(at, formula).unwrap();
    wb.value(at)
}

#[test]
fn getpivotdata_reference_cases() {
    let (mut wb, s, _) = pivot(
        PivotFields {
            cols: rows(&[QTR]),
            ..sum_by(&[REGION])
        },
        |_| {},
    );
    let n = Value::Number;
    let r = Value::Error(ErrorKind::Ref);
    let cases: [(&str, Value); 14] = [
        (r#"=GETPIVOTDATA("Sales",H1)"#, n(210.0)),
        (r#"=GETPIVOTDATA("Sum of Sales",$H$1)"#, n(210.0)),
        (r#"=GETPIVOTDATA("Sales",H1,"Region","East")"#, n(60.0)),
        (r#"=GETPIVOTDATA("sales",H1,"region","east")"#, n(60.0)),
        (
            r#"=GETPIVOTDATA("Sales",H1,"Region","West","Qtr","Q2")"#,
            n(50.0),
        ),
        (
            r#"=GETPIVOTDATA("Sales",H1,"Qtr","Q2","Region","West")"#,
            n(50.0),
        ),
        (r#"=GETPIVOTDATA("Sales",H1,"Qtr","Q1")"#, n(70.0)),
        (r#"=GETPIVOTDATA("Sales",K6,"Region","East")"#, n(60.0)),
        (
            r#"=GETPIVOTDATA("Sales",H1,"Region","North","Qtr","Q1")"#,
            r.clone(),
        ),
        (r#"=GETPIVOTDATA("Sales",H1,"Region","South")"#, r.clone()),
        (r#"=GETPIVOTDATA("Units",H1)"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales",A1)"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales",H1,"Region")"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales",H1,"Product","Apple")"#, r.clone()),
    ];
    for (f, want) in cases {
        assert_eq!(gpd(&mut wb, s, f), want, "{f}");
    }
}

#[test]
fn getpivotdata_follows_visibility() {
    let (mut wb, s, id) = pivot(sum_by(&[REGION, PRODUCT]), |t| {
        t.rows[0].subtotals = Subtotals::None;
        t.options.grand_total_cols = false;
    });
    let r = Value::Error(ErrorKind::Ref);
    assert_eq!(gpd(&mut wb, s, r#"=GETPIVOTDATA("Sales",H1)"#), r);
    assert_eq!(
        gpd(&mut wb, s, r#"=GETPIVOTDATA("Sales",H1,"Region","East")"#),
        r
    );
    assert_eq!(
        gpd(
            &mut wb,
            s,
            r#"=GETPIVOTDATA("Sales",H1,"Region","East","Product","Apple")"#
        ),
        Value::Number(40.0)
    );
    // After a refresh the formula sees the new value (volatile).
    let at = CellCoord::new(s, 20, 0);
    wb.set_input(
        at,
        r#"=GETPIVOTDATA("Sales",H1,"Region","West","Product","Pear")"#,
    )
    .unwrap();
    assert_eq!(wb.value(at), Value::Number(50.0));
    wb.set_input(CellCoord::new(s, 5, 3), "55").unwrap();
    wb.refresh_pivot(id).unwrap();
    assert_eq!(wb.value(at), Value::Number(55.0));
}

#[test]
fn getpivotdata_page_fields_and_number_items() {
    let (mut wb, s) = book(&[
        &["Year", "Region", "Sales"],
        &["2024", "East", "5"],
        &["2023", "East", "7"],
        &["2024", "West", "11"],
    ]);
    wb.create_pivot(
        source(4, 3),
        s,
        0,
        5,
        PivotFields {
            filters: vec![PageField {
                field: 1,
                selected: PageSelection::Items {
                    items: BTreeSet::from([0]), // East
                },
            }],
            ..sum_by_fields(&[0], 2)
        },
    )
    .unwrap();
    let n = Value::Number;
    let r = Value::Error(ErrorKind::Ref);
    let cases: [(&str, Value); 5] = [
        (r#"=GETPIVOTDATA("Sales",F3,"Year",2024)"#, n(5.0)),
        (r#"=GETPIVOTDATA("Sales",F3,"Year","2024")"#, n(5.0)),
        (
            r#"=GETPIVOTDATA("Sales",F1,"Region","East","Year",2023)"#,
            n(7.0),
        ),
        (r#"=GETPIVOTDATA("Sales",F3,"Region","West")"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales",F3,"Region","East")"#, n(12.0)),
    ];
    for (f, want) in cases {
        assert_eq!(gpd(&mut wb, s, f), want, "{f}");
    }
}
