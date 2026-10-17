//! P9-C3 tests: grouping, calculated fields and items, filters, sorting
//! by value, the new aggregations and show-as modes, blank rows, details,
//! filter pages, recommendations and pivot charts (Excel's results for
//! the same data).

use std::collections::BTreeSet;

use core_model::chart::{BarDirection, Chart, ChartKind, ChartValue, DataRef, Grouping};
use engine_formula::{CellCoord, SheetId, Value};

use super::*;
use crate::Workbook;

const DATA: [[&str; 5]; 9] = [
    ["Date", "Region", "Product", "Sales", "Units"],
    ["2024-01-15", "East", "Apple", "10", "1"],
    ["2024-02-03", "East", "Pear", "20", "2"],
    ["2024-02-20", "West", "Apple", "30", "3"],
    ["2024-04-11", "West", "Pear", "40", "4"],
    ["2025-01-05", "North", "Apple", "50", "5"],
    ["2025-03-09", "East", "Apple", "60", "6"],
    ["2025-03-30", "North", "Pear", "70", "7"],
    ["2025-07-14", "South", "Pear", "5", "8"],
];

const DATE: u32 = 0;
const REGION: u32 = 1;
const PRODUCT: u32 = 2;
const SALES: u32 = 3;

fn book() -> (Workbook, SheetId) {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    for (r, row) in DATA.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                .unwrap();
        }
    }
    let date = wb.intern_style(&crate::CellStyle {
        number_format: Some("m/d/yyyy".into()),
        ..Default::default()
    });
    for r in 1..DATA.len() as u32 {
        wb.set_style(CellCoord::new(s, r, 0), date).unwrap();
    }
    (wb, s)
}

fn fields(rows: &[u32], cols: &[u32], values: Vec<DataField>) -> PivotFields {
    PivotFields {
        rows: rows.iter().map(|&f| f.into()).collect(),
        cols: cols.iter().map(|&f| f.into()).collect(),
        values,
        filters: Vec::new(),
    }
}

/// A table at H1 over the data.
fn pivot(f: PivotFields) -> (Workbook, SheetId, u32) {
    let (mut wb, s) = book();
    let (id, _) = wb
        .create_pivot(PivotSource::range("Sheet1", 0, 0, 8, 4), s, 0, 7, f)
        .unwrap();
    (wb, s, id)
}

fn edit(wb: &mut Workbook, id: u32, f: impl FnOnce(&mut PivotTable)) {
    let mut def = wb.pivot(id).unwrap().1.clone();
    f(&mut def);
    wb.update_pivot(id, def).unwrap();
}

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

fn cache(wb: &Workbook, id: u32) -> &PivotCache {
    let t = wb.pivot(id).unwrap().1;
    wb.pivot_cache(t.cache_id).unwrap()
}

fn by_sales_per_region() -> (Workbook, SheetId, u32) {
    pivot(fields(&[REGION], &[], vec![DataField::sum(SALES)]))
}

fn dates(by: Vec<DateGroupBy>, days: Option<u32>) -> GroupSpec {
    GroupSpec::Date {
        by,
        start: None,
        end: None,
        days,
    }
}

fn item(wb: &Workbook, id: u32, field: u32, label: &str) -> u32 {
    cache(wb, id).fields[field as usize]
        .item_index(&Item::Text(label.into()))
        .unwrap()
}

// --- grouping ----------------------------------------------------------------------------

#[test]
fn group_dates_by_months_and_years() {
    let (mut wb, s, id) = pivot(fields(&[DATE], &[], vec![DataField::sum(SALES)]));
    assert_eq!(cache(&wb, id).fields[DATE as usize].kind, FieldKind::Date);
    wb.group_pivot_field(
        id,
        DATE,
        dates(vec![DateGroupBy::Months, DateGroupBy::Years], None),
    )
    .unwrap();
    let c = cache(&wb, id);
    assert_eq!(c.fields.len(), 6);
    assert_eq!(c.fields[5].name, "Years");
    assert!(!c.fields[5].is_source(5));
    let t = wb.pivot(id).unwrap().1;
    assert_eq!(
        t.rows.iter().map(|a| a.field).collect::<Vec<_>>(),
        [5, DATE]
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["2024", "100"],
            &["Jan", "10"],
            &["Feb", "50"],
            &["Apr", "40"],
            &["2025", "185"],
            &["Jan", "50"],
            &["Mar", "130"],
            &["Jul", "5"],
            &["Grand Total", "285"],
        ],
    );
    // Ungroup: the dates come back, Years goes.
    wb.ungroup_pivot_field(id, DATE, None).unwrap();
    let c = cache(&wb, id);
    assert_eq!(c.fields.len(), 5);
    assert!(c.fields[DATE as usize].group.is_none());
    assert_eq!(c.fields[DATE as usize].shared_items.len(), 8);
    assert_eq!(wb.pivot(id).unwrap().1.rows.len(), 1);
}

#[test]
fn group_dates_by_quarters_and_days() {
    let (mut wb, s, id) = pivot(fields(&[DATE], &[], vec![DataField::sum(SALES)]));
    wb.group_pivot_field(id, DATE, dates(vec![DateGroupBy::Quarters], None))
        .unwrap();
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["Qtr1", "240"],
            &["Qtr2", "40"],
            &["Qtr3", "5"],
            &["Grand Total", "285"],
        ],
    );
    // Days by 400 (grouping again replaces the grouping).
    wb.group_pivot_field(id, DATE, dates(vec![DateGroupBy::Days], Some(400)))
        .unwrap();
    let got = shown(&wb, s, id);
    assert_eq!(got[1], ["1/15/2024 - 2/17/2025", "150"]);
    assert_eq!(got[2], ["2/18/2025 - 3/24/2026", "135"]);
}

#[test]
fn group_numbers_by_interval() {
    let (mut wb, s, id) = pivot(fields(
        &[SALES],
        &[],
        vec![DataField::new(SALES, AggFunc::Count)],
    ));
    wb.group_pivot_field(
        id,
        SALES,
        GroupSpec::Number {
            start: Some(0.0),
            end: Some(59.0),
            interval: 20.0,
        },
    )
    .unwrap();
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Count of Sales"],
            &["0-19", "2"],
            &["20-39", "2"],
            &["40-59", "2"],
            &[">59", "2"],
            &["Grand Total", "8"],
        ],
    );
    let zero = GroupSpec::Number {
        start: None,
        end: None,
        interval: 0.0,
    };
    assert!(wb.group_pivot_field(id, SALES, zero).is_err());
    // Text cannot be grouped by numbers.
    let ten = GroupSpec::Number {
        start: None,
        end: None,
        interval: 10.0,
    };
    edit(&mut wb, id, |t| t.rows = vec![REGION.into()]);
    assert!(wb.group_pivot_field(id, REGION, ten).is_err());
}

#[test]
fn manual_groups_make_a_new_field() {
    let (mut wb, s, id) = by_sales_per_region();
    let (east, west) = (item(&wb, id, REGION, "East"), item(&wb, id, REGION, "West"));
    wb.group_pivot_field(
        id,
        REGION,
        GroupSpec::Items {
            items: vec![east, west],
        },
    )
    .unwrap();
    assert_eq!(cache(&wb, id).fields[5].name, "Region2");
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["Group1", "160"],
            &["East", "90"],
            &["West", "70"],
            &["North", "120"],
            &["North", "120"],
            &["South", "5"],
            &["South", "5"],
            &["Grand Total", "285"],
        ],
    );
    // Ungrouping Group1 makes its members their own items again.
    let g1 = item(&wb, id, 5, "Group1");
    wb.ungroup_pivot_field(id, 5, Some(&[g1])).unwrap();
    let labels: Vec<String> = cache(&wb, id).fields[5]
        .shared_items
        .iter()
        .map(|i| i.label(None))
        .collect();
    assert_eq!(labels, ["East", "West", "North", "South"]);
    // Ungrouping the field removes it.
    wb.ungroup_pivot_field(id, 5, None).unwrap();
    assert_eq!(cache(&wb, id).fields.len(), 5);
    assert_eq!(wb.pivot(id).unwrap().1.rows.len(), 1);
}

#[test]
fn groups_follow_a_refresh() {
    let (mut wb, s, id) = pivot(fields(&[DATE], &[], vec![DataField::sum(SALES)]));
    wb.group_pivot_field(id, DATE, dates(vec![DateGroupBy::Years], None))
        .unwrap();
    wb.set_input(CellCoord::new(s, 8, 0), "46143").unwrap(); // 2026-05-01
    wb.refresh_pivot(id).unwrap();
    let got = shown(&wb, s, id);
    assert_eq!(got[3], ["2026", "5"]);
    assert_eq!(got.last().unwrap(), &["Grand Total", "285"]);
}

// --- calculated fields and items ---------------------------------------------------------

#[test]
fn calculated_field_uses_the_sums() {
    let (mut wb, s, id) = by_sales_per_region();
    wb.set_calculated_field(id, None, "Price", Some("=Sales/Units"))
        .unwrap();
    assert_eq!(
        cache(&wb, id).fields[5].formula.as_deref(),
        Some("Sales/Units")
    );
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales", "Sum of Price"],
            &["East", "90", "10"],
            &["North", "120", "10"],
            &["South", "5", "0.625"],
            &["West", "70", "10"],
            &["Grand Total", "285", "7.916666667"],
        ],
    );
    // Rename and new formula; then delete.
    wb.set_calculated_field(id, Some(5), "Bonus", Some("Sales*0.1"))
        .unwrap();
    assert_eq!(shown(&wb, s, id)[1], ["East", "90", "9"]);
    wb.set_calculated_field(id, Some(5), "", None).unwrap();
    assert_eq!(cache(&wb, id).fields.len(), 5);
    assert_eq!(wb.pivot(id).unwrap().1.values.len(), 1);
}

#[test]
fn calculated_field_errors() {
    let (mut wb, _s, id) = by_sales_per_region();
    assert!(wb
        .set_calculated_field(id, None, "Sales", Some("Units*2"))
        .is_err());
    assert!(wb
        .set_calculated_field(id, None, "X", Some("Units*"))
        .is_err());
    // A calculated field cannot go on rows.
    wb.set_calculated_field(id, None, "X", Some("Units*2"))
        .unwrap();
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.rows.push(5.into());
    assert!(wb.update_pivot(id, def).is_err());
}

#[test]
fn calculated_item_over_items() {
    let (mut wb, s, id) = by_sales_per_region();
    wb.set_calculated_item(id, REGION, None, "East+West", Some("East+West"))
        .unwrap();
    let got = shown(&wb, s, id);
    // Sorted among the items; the totals are the records'.
    assert!(got.contains(&vec!["East+West".to_owned(), "160".to_owned()]));
    assert_eq!(got.last().unwrap(), &["Grand Total", "285"]);
    // With a column field the item is computed per column.
    edit(&mut wb, id, |t| t.cols = vec![PRODUCT.into()]);
    let got = shown(&wb, s, id);
    let row = got.iter().find(|r| r[0] == "East+West").unwrap();
    assert_eq!(row[1..], ["100", "60", "160"]);
    let it = item(&wb, id, REGION, "East+West");
    wb.set_calculated_item(id, REGION, Some(it), "", None)
        .unwrap();
    assert!(cache(&wb, id).calculated_items.is_empty());
    assert!(!shown(&wb, s, id).iter().any(|r| r[0] == "East+West"));
}

// --- filters and sorting -----------------------------------------------------------------

fn label(op: LabelOp, value: &str, value2: &str) -> Option<PivotFilter> {
    Some(PivotFilter::Label {
        op,
        value: value.into(),
        value2: value2.into(),
    })
}

#[test]
fn label_filters() {
    let (mut wb, s, id) = by_sales_per_region();
    edit(&mut wb, id, |t| {
        t.rows[0].filter = label(LabelOp::Contains, "st", "")
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "90"],
            &["West", "70"],
            &["Grand Total", "160"],
        ],
    );
    edit(&mut wb, id, |t| {
        t.rows[0].filter = label(LabelOp::Between, "n", "t")
    });
    let got = shown(&wb, s, id);
    assert_eq!(got[1][0], "North");
    assert_eq!(got[2][0], "South");
    assert_eq!(got.len(), 4);
    edit(&mut wb, id, |t| {
        t.rows[0].filter = label(LabelOp::BeginsWith, "W", "")
    });
    assert_eq!(shown(&wb, s, id).len(), 3);
}

#[test]
fn date_filter_between() {
    let (mut wb, s, id) = pivot(fields(&[DATE], &[], vec![DataField::sum(SALES)]));
    edit(&mut wb, id, |t| {
        t.rows[0].filter = Some(PivotFilter::Date {
            op: DateOp::Between,
            value: 45323.0,  // 2024-02-01
            value2: 45351.0, // 2024-02-29
        })
    });
    let got = shown(&wb, s, id);
    assert_eq!(got.len(), 4);
    assert_eq!(got.last().unwrap()[1], "50");
}

#[test]
fn value_filters() {
    let (mut wb, s, id) = by_sales_per_region();
    let value = |op, value, value2| {
        Some(PivotFilter::Value {
            op,
            data: 0,
            value,
            value2,
        })
    };
    edit(&mut wb, id, |t| {
        t.rows[0].filter = value(ValueOp::Greater, 80.0, 0.0)
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "90"],
            &["North", "120"],
            &["Grand Total", "210"],
        ],
    );
    edit(&mut wb, id, |t| {
        t.rows[0].filter = value(ValueOp::Between, 5.0, 70.0)
    });
    assert_eq!(shown(&wb, s, id).last().unwrap()[1], "75");
    edit(&mut wb, id, |t| {
        t.rows[0].filter = value(ValueOp::LessOrEqual, 70.0, 0.0)
    });
    assert_eq!(shown(&wb, s, id).last().unwrap()[1], "75");
}

#[test]
fn top_ten_items_percent_and_sum() {
    let (mut wb, s, id) = by_sales_per_region();
    let top = |count, by, bottom| {
        Some(PivotFilter::Top {
            data: 0,
            bottom,
            count,
            by,
        })
    };
    edit(&mut wb, id, |t| {
        t.rows[0].filter = top(2.0, TopBy::Items, false)
    });
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Sum of Sales"],
            &["East", "90"],
            &["North", "120"],
            &["Grand Total", "210"],
        ],
    );
    edit(&mut wb, id, |t| {
        t.rows[0].filter = top(1.0, TopBy::Items, true)
    });
    assert_eq!(shown(&wb, s, id)[1], ["South", "5"]);
    // 50 % of 285: North 120, then East 90 crosses it.
    edit(&mut wb, id, |t| {
        t.rows[0].filter = top(50.0, TopBy::Percent, false)
    });
    assert_eq!(shown(&wb, s, id).last().unwrap()[1], "210");
    edit(&mut wb, id, |t| {
        t.rows[0].filter = top(100.0, TopBy::Sum, false)
    });
    assert_eq!(shown(&wb, s, id).last().unwrap()[1], "120");
}

#[test]
fn value_filter_on_an_inner_field_is_per_parent() {
    let (mut wb, s, id) = pivot(fields(&[REGION, PRODUCT], &[], vec![DataField::sum(SALES)]));
    edit(&mut wb, id, |t| {
        t.rows[1].filter = Some(PivotFilter::Top {
            data: 0,
            bottom: false,
            count: 1.0,
            by: TopBy::Items,
        })
    });
    let got = shown(&wb, s, id);
    let east = got.iter().position(|r| r[0] == "East").unwrap();
    assert_eq!(got[east], ["East", "70"]);
    assert_eq!(got[east + 1], ["Apple", "70"]);
    assert_eq!(got.last().unwrap()[1], "185");
}

#[test]
fn sort_by_value() {
    let (mut wb, s, id) = by_sales_per_region();
    let order = |wb: &Workbook| -> Vec<String> {
        shown(wb, s, id)[1..5]
            .iter()
            .map(|r| r[0].clone())
            .collect()
    };
    edit(&mut wb, id, |t| {
        t.rows[0].sort = SortOrder::ByValue {
            data: 0,
            descending: true,
        }
    });
    assert_eq!(order(&wb), ["North", "East", "West", "South"]);
    edit(&mut wb, id, |t| {
        t.rows[0].sort = SortOrder::ByValue {
            data: 0,
            descending: false,
        }
    });
    assert_eq!(order(&wb), ["South", "West", "East", "North"]);
    // A sort by a data field that does not exist is refused.
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.rows[0].sort = SortOrder::ByValue {
        data: 3,
        descending: true,
    };
    assert!(wb.update_pivot(id, def).is_err());
}

// --- aggregation and show values as -----------------------------------------------------

#[test]
fn distinct_count() {
    let (wb, s, id) = pivot(fields(
        &[PRODUCT],
        &[],
        vec![DataField::new(REGION, AggFunc::DistinctCount)],
    ));
    expect(
        &wb,
        s,
        id,
        &[
            &["Row Labels", "Distinct Count of Region"],
            &["Apple", "3"],
            &["Pear", "4"],
            &["Grand Total", "4"],
        ],
    );
}

/// Rows Region (East, North, South, West) × columns Apple, Pear.
fn show(show_as: ShowAs) -> Vec<Vec<String>> {
    let (mut wb, s, id) = pivot(fields(&[REGION], &[PRODUCT], vec![DataField::sum(SALES)]));
    edit(&mut wb, id, |t| t.values[0].show_as = show_as);
    shown(&wb, s, id)
}

#[test]
fn show_as_percent_modes() {
    let g = show(ShowAs::PercentOfTotal);
    assert_eq!(g[2], ["East", "24.56%", "7.02%", "31.58%"]);
    let p = show(ShowAs::PercentOfParentColumn);
    assert_eq!(p[2][1], "77.78%");
    // Apple is item 0 of Product.
    let apple = BaseItem::Item { item: 0 };
    let of = show(ShowAs::PercentOf {
        base_field: PRODUCT,
        base_item: apple,
    });
    assert_eq!(of[2], ["East", "100.00%", "28.57%", ""]);
    let diff = show(ShowAs::PercentDifferenceFrom {
        base_field: PRODUCT,
        base_item: apple,
    });
    assert_eq!(diff[2], ["East", "", "-71.43%", ""]);
    let run = show(ShowAs::PercentRunningTotal { base_field: REGION });
    assert_eq!(run[2][1], "46.67%");
    assert_eq!(run[5][1], "100.00%");
}

#[test]
fn show_as_rank_ascending_and_index() {
    // Apple: East 70, North 50, South -, West 30.
    let r = show(ShowAs::RankAscending { base_field: REGION });
    assert_eq!(r[2][1], "3");
    assert_eq!(r[5][1], "1");
    // East / Apple: 70 × 285 / (90 × 150).
    let i = show(ShowAs::Index);
    assert_eq!(i[2][1], "1.477777778");
}

#[test]
fn show_as_parent_total() {
    let (mut wb, s, id) = pivot(fields(&[REGION, PRODUCT], &[], vec![DataField::sum(SALES)]));
    edit(&mut wb, id, |t| {
        t.values[0].show_as = ShowAs::PercentOfParentTotal { base_field: REGION }
    });
    let got = shown(&wb, s, id);
    let east = got.iter().position(|r| r[0] == "East").unwrap();
    assert_eq!(got[east][1], "100.00%");
    assert_eq!(got[east + 1], ["Apple", "77.78%"]);
}

// --- layout and tools --------------------------------------------------------------------

#[test]
fn blank_rows_after_items() {
    let (mut wb, s, id) = pivot(fields(&[REGION, PRODUCT], &[], vec![DataField::sum(SALES)]));
    edit(&mut wb, id, |t| t.rows[0].insert_blank_row = true);
    let got = shown(&wb, s, id);
    let east = got.iter().position(|r| r[0] == "East").unwrap();
    assert_eq!(got[east + 3], ["", ""]);
    assert_eq!(got[east + 4][0], "North");
    let out = wb.pivot_output(id).unwrap();
    assert!(out.row_items.iter().any(|l| l.kind == LineKind::Blank));
}

#[test]
fn show_details_respects_groups() {
    let (mut wb, _s, id) = pivot(fields(&[DATE], &[], vec![DataField::sum(SALES)]));
    wb.group_pivot_field(id, DATE, dates(vec![DateGroupBy::Years], None))
        .unwrap();
    let t = wb.pivot_output(id).unwrap().table;
    // The 2025 row.
    let (names, rows) = wb.pivot_details(id, t.r0 + 2, t.c0 + 1).unwrap();
    assert_eq!(names, ["Date", "Region", "Product", "Sales", "Units"]);
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0][1], Value::Text("North".into()));
}

#[test]
fn copy_for_report_filter_pages() {
    let (mut wb, _s, id) = pivot(PivotFields {
        filters: vec![PageField {
            field: REGION,
            selected: PageSelection::All,
        }],
        ..fields(&[PRODUCT], &[], vec![DataField::sum(SALES)])
    });
    let s2 = wb.add_sheet("East").unwrap();
    let east = item(&wb, id, REGION, "East");
    let (copy, _) = wb.copy_pivot(id, s2, 0, 0, Some((REGION, east))).unwrap();
    assert_ne!(copy, id);
    let got = shown(&wb, s2, copy);
    assert_eq!(got[0], ["Region", "East"]);
    assert_eq!(got.last().unwrap()[1], "90");
    assert_eq!(
        wb.pivot(copy).unwrap().1.cache_id,
        wb.pivot(id).unwrap().1.cache_id
    );
}

#[test]
fn recommendations_rank_categories_and_measures() {
    let (wb, _s) = book();
    let source = PivotSource::range("Sheet1", 0, 0, 8, 4);
    let (fields_, records) = wb.read_pivot_source(&source).unwrap();
    let mut c = PivotCache {
        id: 1,
        source,
        fields: fields_,
        records,
        refresh_on_load: false,
        stale: false,
        raw: None,
        calculated_items: Vec::new(),
    };
    c.normalize();
    let recs = recommend_pivots(&c);
    assert_eq!(recs[0].title, "Sum of Sales by Region");
    assert!(recs.iter().any(|r| r.title == "Sum of Sales by Product"));
    assert!(recs.iter().all(|r| !r.title.contains("by Date")));
    let preview = recommendation_preview(&c, &recs[0].fields, 3);
    assert_eq!(preview[0], ["Row Labels", "Sum of Sales"]);
    assert_eq!(preview.len(), 3);
}

#[test]
fn pivot_chart_series_follow_the_table() {
    let (mut wb, s, id) = pivot(fields(&[REGION], &[PRODUCT], vec![DataField::sum(SALES)]));
    let data = wb.pivot_chart_data(id).unwrap();
    assert_eq!(data.series.len(), 2);
    assert_eq!(
        data.categories,
        Some(DataRef::reference("Sheet1!$H$3:$H$6"))
    );
    assert_eq!(data.series[0].1, DataRef::reference("Sheet1!$I$3:$I$6"));
    let chart = crate::ChartObject {
        id: 0,
        name: String::new(),
        anchor: crate::ChartAnchor::TwoCell {
            from: crate::CellOffset::default(),
            to: crate::CellOffset {
                col: 5,
                row: 10,
                ..Default::default()
            },
        },
        chart: Chart::new(ChartKind::Bar {
            direction: BarDirection::Column,
            grouping: Grouping::Clustered,
        }),
        pivot: Some(id),
    };
    let cid = wb.add_chart(s, chart).unwrap();
    assert_eq!(wb.chart(s, cid).unwrap().chart.series.len(), 2);
    // Filtering the table changes the series.
    edit(&mut wb, id, |t| {
        t.cols[0].hidden_items = BTreeSet::from([1])
    });
    assert_eq!(wb.chart(s, cid).unwrap().chart.series.len(), 1);
    // Two row fields: the leaf rows are not contiguous, values are literal.
    edit(&mut wb, id, |t| {
        t.cols.clear();
        t.rows.push(PRODUCT.into());
    });
    let ch = &wb.chart(s, cid).unwrap().chart;
    match ch.categories.as_ref().unwrap() {
        DataRef::Literal { values } => {
            assert_eq!(values[0], ChartValue::Text("East - Apple".into()))
        }
        other => panic!("{other:?}"),
    }
    match &ch.series[0].values {
        DataRef::Literal { values } => assert_eq!(values[0], ChartValue::Number(70.0)),
        other => panic!("{other:?}"),
    }
}

#[test]
fn new_model_parts_serde_roundtrip() {
    let f = PivotFilter::Top {
        data: 1,
        bottom: true,
        count: 5.0,
        by: TopBy::Percent,
    };
    let json = serde_json::to_string(&f).unwrap();
    assert_eq!(serde_json::from_str::<PivotFilter>(&json).unwrap(), f);
    let g = FieldGroup {
        base: 2,
        kind: GroupKind::Date {
            by: DateGroupBy::Months,
            start: 1.0,
            end: 2.0,
            interval: 1,
            auto_start: true,
            auto_end: false,
        },
    };
    let json = serde_json::to_value(&g).unwrap();
    assert_eq!(json["kind"], "date");
    assert_eq!(json["base"], 2);
    assert_eq!(serde_json::from_value::<FieldGroup>(json).unwrap(), g);
    let sort = SortOrder::ByValue {
        data: 0,
        descending: true,
    };
    assert_eq!(serde_json::to_value(sort).unwrap()["kind"], "byValue");
}
