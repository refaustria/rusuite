//! Pivot tables round 2 (P9-C3): grouped fields (dates by levels,
//! numbers, manual groups), calculated fields and items, label / value /
//! top filters, sorting by value, Distinct Count, the Show Values As
//! modes, blank rows and PivotCharts – written parts, round trips and the
//! reference workbook.

use std::io::Cursor;

use core_model::chart::{BarDirection, Chart, ChartKind, Grouping};
use engine_formula::{CellCoord, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::pivot::{
    AggFunc, BaseItem, DataField, DateGroupBy, GroupKind, GroupSpec, Item, LabelOp, PivotFields,
    PivotFilter, PivotSource, ShowAs, SortOrder, TopBy,
};
use model_sheet::{CellOffset, CellStyle, ChartAnchor, ChartObject, SheetId, Workbook};

const DATA: [[&str; 5]; 9] = [
    ["Date", "Region", "Product", "Sales", "Units"],
    ["45306", "East", "Apple", "10", "1"],
    ["45325", "East", "Pear", "20", "2"],
    ["45342", "West", "Apple", "30", "3"],
    ["45393", "West", "Pear", "40", "4"],
    ["45662", "North", "Apple", "50", "5"],
    ["45725", "East", "Apple", "60", "6"],
    ["45746", "North", "Pear", "70", "7"],
    ["45852", "South", "Pear", "5", "8"],
];

const DATE: u32 = 0;
const REGION: u32 = 1;
const PRODUCT: u32 = 2;
const SALES: u32 = 3;
const UNITS: u32 = 4;

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let p = pkg
        .part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"));
    String::from_utf8(p.data.clone()).unwrap()
}

/// `Data` and `Pivot` with three tables of one cache and a PivotChart:
/// A3 years / months with Distinct Count and a calculated field, blank
/// rows; H3 regions (top 2 by value, sorted by value) × products (label
/// filter, calculated item) as % of Apple; H16 a manual group × units
/// grouped by 4.
pub fn c3_sample() -> Workbook {
    let mut wb = Workbook::new();
    let data = SheetId(0);
    wb.rename_sheet(data, "Data").unwrap();
    let date = wb.intern_style(&CellStyle {
        number_format: Some("m/d/yyyy".into()),
        ..Default::default()
    });
    for (r, row) in DATA.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(data, r as u32, c as u32), v)
                .unwrap();
        }
        if r > 0 {
            wb.set_style(CellCoord::new(data, r as u32, 0), date)
                .unwrap();
        }
    }
    let s = wb.add_sheet("Pivot").unwrap();
    let source = PivotSource::range("Data", 0, 0, 8, 4);
    let (t1, _) = wb
        .create_pivot(
            source.clone(),
            s,
            2,
            0,
            PivotFields {
                rows: vec![DATE.into()],
                values: vec![
                    DataField::sum(SALES),
                    DataField::new(REGION, AggFunc::DistinctCount),
                ],
                ..Default::default()
            },
        )
        .unwrap();
    wb.group_pivot_field(
        t1,
        DATE,
        GroupSpec::Date {
            by: vec![DateGroupBy::Months, DateGroupBy::Years],
            start: None,
            end: None,
            days: None,
        },
    )
    .unwrap();
    wb.set_calculated_field(t1, None, "Bonus", Some("Sales*0.1"))
        .unwrap();
    let mut def = wb.pivot(t1).unwrap().1.clone();
    def.rows[0].insert_blank_row = true;
    wb.update_pivot(t1, def).unwrap();

    let (t2, _) = wb
        .create_pivot(
            source.clone(),
            s,
            2,
            7,
            PivotFields {
                rows: vec![REGION.into()],
                cols: vec![PRODUCT.into()],
                values: vec![DataField::sum(SALES)],
                ..Default::default()
            },
        )
        .unwrap();
    wb.set_calculated_item(t2, PRODUCT, None, "Both", Some("Apple+Pear"))
        .unwrap();
    let mut def = wb.pivot(t2).unwrap().1.clone();
    def.rows[0].filter = Some(PivotFilter::Top {
        data: 0,
        bottom: false,
        count: 2.0,
        by: TopBy::Items,
    });
    def.rows[0].sort = SortOrder::ByValue {
        data: 0,
        descending: true,
    };
    def.cols[0].filter = Some(PivotFilter::Label {
        op: LabelOp::NotBeginsWith,
        value: "x".into(),
        value2: String::new(),
    });
    def.values[0].show_as = ShowAs::PercentOf {
        base_field: PRODUCT,
        base_item: BaseItem::Item { item: 0 },
    };
    wb.update_pivot(t2, def).unwrap();

    let (t3, _) = wb
        .create_pivot(
            source,
            s,
            15,
            7,
            PivotFields {
                rows: vec![REGION.into()],
                cols: vec![UNITS.into()],
                values: vec![DataField::sum(SALES)],
                ..Default::default()
            },
        )
        .unwrap();
    let c = wb.pivot_cache(wb.pivot(t3).unwrap().1.cache_id).unwrap();
    let item = |l: &str| {
        c.fields[REGION as usize]
            .item_index(&Item::Text(l.into()))
            .unwrap()
    };
    let (east, west) = (item("East"), item("West"));
    wb.group_pivot_field(
        t3,
        REGION,
        GroupSpec::Items {
            items: vec![east, west],
        },
    )
    .unwrap();
    wb.group_pivot_field(
        t3,
        UNITS,
        GroupSpec::Number {
            start: Some(0.0),
            end: Some(8.0),
            interval: 4.0,
        },
    )
    .unwrap();
    wb.add_chart(
        s,
        ChartObject {
            id: 0,
            name: String::new(),
            anchor: ChartAnchor::TwoCell {
                from: CellOffset {
                    col: 0,
                    row: 30,
                    ..Default::default()
                },
                to: CellOffset {
                    col: 6,
                    row: 45,
                    ..Default::default()
                },
            },
            chart: Chart::new(ChartKind::Bar {
                direction: BarDirection::Column,
                grouping: Grouping::Clustered,
            }),
            pivot: Some(t1),
        },
    )
    .unwrap();
    wb
}

#[test]
fn dump_c3_sample() {
    if let Ok(dir) = std::env::var("RUSUITE_PIVOT_DUMP") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::write(dir.join("c3.xlsx"), fmt_xlsx::write(&c3_sample()).unwrap()).unwrap();
    }
}

#[test]
fn written_parts_have_the_new_elements() {
    let wb = c3_sample();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let def = part(&bytes, "/xl/pivotCache/pivotCacheDefinition1.xml");
    for want in [
        r#"<fieldGroup par="5" base="0"><rangePr groupBy="months" startDate="2024-01-15T00:00:00" endDate="2025-07-14T00:00:00"/><groupItems count="14"><s v="&lt;1/15/2024"/><s v="Jan"/>"#,
        r#"<cacheField name="Years" numFmtId="0" databaseField="0"><fieldGroup base="0"><rangePr groupBy="years""#,
        r#"<cacheField name="Bonus" numFmtId="0" formula="Sales*0.1" databaseField="0"/>"#,
        r#"<discretePr count="4">"#,
        r#"<s v="Group1"/>"#,
        r#"<rangePr autoStart="0" autoEnd="0" startNum="0" endNum="8" groupInterval="4"/>"#,
        r#"<calculatedItems count="1"><calculatedItem formula="Apple+Pear"><pivotArea cacheIndex="1" outline="0" fieldPosition="0"><references count="1"><reference field="2" count="1"><x v="2"/></reference>"#,
    ] {
        assert!(def.contains(want), "{want}\n{def}");
    }
    // Records: the source columns only, dates as dates.
    let rec = part(&bytes, "/xl/pivotCache/pivotCacheRecords1.xml");
    assert!(
        rec.contains(r#"<r><d v="2024-01-15T00:00:00"/><x/><x/><n v="10"/><n v="1"/></r>"#),
        "{rec}"
    );
    let t1 = part(&bytes, "/xl/pivotTables/pivotTable1.xml");
    assert!(t1.contains(r#"insertBlankRow="1""#), "{t1}");
    assert!(t1.contains(r#"<i t="blank">"#), "{t1}");
    assert!(t1.contains(r#"<rs:dataField distinctCount="1"/>"#), "{t1}");
    assert!(t1.contains(r#"dragToRow="0""#), "{t1}");
    let t2 = part(&bytes, "/xl/pivotTables/pivotTable2.xml");
    for want in [
        r#"<filter fld="1" iMeasureFld="0" type="count" evalOrder="-1" id="1"><autoFilter ref="A1"><filterColumn colId="0"><top10 val="2" filterVal="2"/>"#,
        r#"<filter fld="2" type="captionNotBeginsWith" evalOrder="-1" id="2" stringValue1="x">"#,
        r#"<autoSortScope><pivotArea dataOnly="0" outline="0" fieldPosition="0"><references count="1"><reference field="4294967294" count="1" selected="0"><x v="0"/>"#,
        r#"showDataAs="percent" baseField="2" baseItem="0""#,
        r#"<item f="1" x="2"/>"#,
    ] {
        assert!(t2.contains(want), "{want}\n{t2}");
    }
    let chart = part(&bytes, "/xl/charts/chart1.xml");
    assert!(
        chart.contains("<c:pivotSource><c:name>Pivot!PivotTable1</c:name><c:fmtId val=\"0\"/></c:pivotSource><c:chart>"),
        "{chart}"
    );
    assert!(chart.contains("<c:pivotFmts>"), "{chart}");
}

#[test]
fn roundtrip_keeps_every_new_part() {
    let wb = c3_sample();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.pivot_caches(), wb.pivot_caches());
    let s = back.sheet_id("Pivot").unwrap();
    assert_eq!(back.pivots(s), wb.pivots(s));
    assert_eq!(back.charts(s), wb.charts(s));
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    // Written twice, the same.
    assert_eq!(fmt_xlsx::write(&back).unwrap(), bytes);
}

#[test]
fn every_show_as_mode_and_filter_roundtrips() {
    let mut wb = c3_sample();
    let s = wb.sheet_id("Pivot").unwrap();
    let id = wb.pivots(s)[1].id;
    let modes = [
        ShowAs::PercentOfParentColumn,
        ShowAs::PercentOfParentTotal { base_field: REGION },
        ShowAs::PercentDifferenceFrom {
            base_field: PRODUCT,
            base_item: BaseItem::Previous,
        },
        ShowAs::PercentRunningTotal { base_field: REGION },
        ShowAs::RankAscending { base_field: REGION },
        ShowAs::Index,
    ];
    let filters = [
        PivotFilter::Label {
            op: LabelOp::Between,
            value: "a".into(),
            value2: "q".into(),
        },
        PivotFilter::Value {
            op: model_sheet::pivot::ValueOp::GreaterOrEqual,
            data: 0,
            value: 30.0,
            value2: 0.0,
        },
        PivotFilter::Value {
            op: model_sheet::pivot::ValueOp::NotBetween,
            data: 0,
            value: 10.0,
            value2: 60.0,
        },
        PivotFilter::Top {
            data: 0,
            bottom: true,
            count: 40.0,
            by: TopBy::Percent,
        },
        PivotFilter::Top {
            data: 0,
            bottom: false,
            count: 100.0,
            by: TopBy::Sum,
        },
    ];
    for (k, show) in modes.iter().enumerate() {
        let mut def = wb.pivot(id).unwrap().1.clone();
        def.values[0].show_as = *show;
        def.rows[0].filter = Some(filters[k % filters.len()].clone());
        wb.update_pivot(id, def).unwrap();
        let back = fmt_xlsx::read(&fmt_xlsx::write(&wb).unwrap()).unwrap();
        let t = &back.pivots(s)[1];
        assert_eq!(t.values[0].show_as, *show);
        assert_eq!(t.rows[0].filter, Some(filters[k % filters.len()].clone()));
    }
    // A date filter on the date field of the first table.
    let id1 = wb.pivots(s)[0].id;
    let mut def = wb.pivot(id1).unwrap().1.clone();
    def.rows[1].filter = Some(PivotFilter::Date {
        op: model_sheet::pivot::DateOp::After,
        value: 45400.0,
        value2: 0.0,
    });
    wb.update_pivot(id1, def).unwrap();
    let back = fmt_xlsx::read(&fmt_xlsx::write(&wb).unwrap()).unwrap();
    assert_eq!(
        back.pivots(s)[0].rows[1].filter,
        wb.pivots(s)[0].rows[1].filter
    );
}

fn reference(name: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

#[test]
fn reference_workbook_has_every_feature() {
    let (wb, warnings) =
        fmt_xlsx::read_with_warnings(&reference("provisional-pivot-c3.xlsx")).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = wb.sheet_id("Pivot").unwrap();
    let tables = wb.pivots(s);
    assert_eq!(tables.len(), 3);
    let c = wb.pivot_cache(tables[0].cache_id).unwrap();
    // Grouping: months on Date, the Years level field, a manual group
    // field and units in bins of 4.
    assert!(matches!(
        c.fields[DATE as usize].group.as_ref().map(|g| &g.kind),
        Some(GroupKind::Date {
            by: DateGroupBy::Months,
            ..
        })
    ));
    let years = c.field_index("Years").unwrap();
    assert!(matches!(
        c.fields[years as usize].group.as_ref().map(|g| &g.kind),
        Some(GroupKind::Date {
            by: DateGroupBy::Years,
            ..
        })
    ));
    let region2 = c.field_index("Region2").unwrap();
    assert!(matches!(
        c.fields[region2 as usize].group.as_ref().map(|g| &g.kind),
        Some(GroupKind::Items { .. })
    ));
    assert!(matches!(
        c.fields[UNITS as usize].group.as_ref().map(|g| &g.kind),
        Some(GroupKind::Number { .. })
    ));
    // Calculated field and item.
    let bonus = c.field_index("Bonus").unwrap();
    assert_eq!(
        c.fields[bonus as usize].formula.as_deref(),
        Some("Sales*0.1")
    );
    assert_eq!(c.calculated_items.len(), 1);
    // Table 1: blank rows, Distinct Count, the calculated field.
    let t1 = &tables[0];
    assert!(t1.rows[0].insert_blank_row);
    assert!(t1.values.iter().any(|d| d.func == AggFunc::DistinctCount));
    assert!(t1.values.iter().any(|d| d.field == bonus));
    // Table 2: top 2 by value, sorted by value, a label filter, % of Apple.
    let t2 = &tables[1];
    assert!(matches!(t2.rows[0].filter, Some(PivotFilter::Top { .. })));
    assert!(matches!(
        t2.rows[0].sort,
        SortOrder::ByValue {
            descending: true,
            ..
        }
    ));
    assert!(matches!(t2.cols[0].filter, Some(PivotFilter::Label { .. })));
    assert!(matches!(t2.values[0].show_as, ShowAs::PercentOf { .. }));
    // The cells match a recomputation.
    let out = wb.pivot_output(t1.id).unwrap();
    for cell in &out.cells {
        let v = wb.value(CellCoord::new(s, cell.row, cell.col));
        assert_eq!(v, cell.value, "{}:{}", cell.row, cell.col);
    }
    assert_eq!(
        wb.value(CellCoord::new(s, 3, 0)),
        Value::Text("2024".into())
    );
    // The PivotChart is bound to table 1.
    let chart = &wb.charts(s)[0];
    assert_eq!(chart.pivot, Some(t1.id));
    assert!(!chart.chart.series.is_empty());
}
