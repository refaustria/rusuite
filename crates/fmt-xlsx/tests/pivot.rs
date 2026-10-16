//! Pivot tables (P8-30): written parts (snapshots), round trips, raw
//! (unsupported) definitions, refresh on load and the reference
//! workbooks.

use std::collections::BTreeSet;
use std::io::Cursor;

use engine_formula::{CellCoord, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::pivot::{
    AggFunc, BaseItem, DataField, PageField, PageSelection, PivotFields, PivotLayout, PivotSource,
    ShowAs, SortOrder, Subtotals, ValuesAxis,
};
use model_sheet::{CellStyle, SheetId, Workbook};

const SALES: [[&str; 5]; 7] = [
    ["Region", "Product", "Qtr", "Sales", "Units"],
    ["East", "Apple", "Q1", "10", "1"],
    ["East", "Pear", "Q1", "20", "2"],
    ["East", "Apple", "Q2", "30", "3"],
    ["West", "Apple", "Q1", "40", "4"],
    ["West", "Pear", "Q2", "50", "5"],
    ["North", "Pear", "Q2", "60", "6"],
];

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let p = pkg
        .part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"));
    String::from_utf8(p.data.clone()).unwrap()
}

fn rels(xlsx: &[u8], source: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let r = pkg
        .relationships(&PartName::new(source).unwrap())
        .unwrap_or_else(|| panic!("no rels of {source}"));
    String::from_utf8(r.to_xml()).unwrap()
}

fn pretty(xml: &str) -> String {
    xml.replace("><", ">\n<")
}

/// `Data` with the sales table, `Report` with a crosstab (A3) and a
/// tabular table with a page field, two values and show-as (A12).
pub fn sample() -> Workbook {
    let mut wb = Workbook::new();
    let data = SheetId(0);
    wb.rename_sheet(data, "Data").unwrap();
    for (r, row) in SALES.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(data, r as u32, c as u32), v)
                .unwrap();
        }
    }
    let report = wb.add_sheet("Report").unwrap();
    let source = PivotSource::range("Data", 0, 0, 6, 4);
    let (_, _) = wb
        .create_pivot(
            source.clone(),
            report,
            2,
            0,
            PivotFields {
                rows: vec![0.into()],
                cols: vec![2.into()],
                values: vec![DataField::sum(3)],
                ..Default::default()
            },
        )
        .unwrap();
    let (id, _) = wb
        .create_pivot(
            source,
            report,
            11,
            0,
            PivotFields {
                rows: vec![0.into(), 1.into()],
                values: vec![
                    DataField {
                        number_format: Some("#,##0.00".into()),
                        ..DataField::sum(3)
                    },
                    DataField {
                        show_as: ShowAs::PercentOfParent,
                        ..DataField::new(4, AggFunc::Sum)
                    },
                ],
                filters: vec![PageField {
                    field: 2,
                    selected: PageSelection::Items {
                        items: BTreeSet::from([1]), // Q2
                    },
                }],
                ..Default::default()
            },
        )
        .unwrap();
    let mut def = wb.pivot(id).unwrap().1.clone();
    for a in &mut def.rows {
        a.layout = PivotLayout::Tabular;
    }
    def.rows[0].sort = SortOrder::Descending;
    def.options.banded = true;
    def.name = "Q2 by region".into();
    wb.update_pivot(id, def).unwrap();
    wb
}

/// The two reference layouts of `scripts/testdata-src/xlsx/pivot.py`:
/// `Data` + `Pivot` with a crosstab at A3 (`basic`) or a tabular table
/// with a page field and two values at A1 (`tabular`).
fn reference_layout(tabular: bool) -> Workbook {
    let mut wb = Workbook::new();
    let data = SheetId(0);
    wb.rename_sheet(data, "Data").unwrap();
    for (r, row) in SALES.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            wb.set_input(CellCoord::new(data, r as u32, c as u32), v)
                .unwrap();
        }
    }
    let pivot = wb.add_sheet("Pivot").unwrap();
    let source = PivotSource::range("Data", 0, 0, 6, 4);
    let fields = if tabular {
        PivotFields {
            rows: vec![0.into(), 1.into()],
            values: vec![DataField::sum(3), DataField::new(4, AggFunc::Count)],
            filters: vec![PageField {
                field: 2,
                selected: PageSelection::Items {
                    items: BTreeSet::from([1]),
                },
            }],
            ..Default::default()
        }
    } else {
        PivotFields {
            rows: vec![0.into()],
            cols: vec![2.into()],
            values: vec![DataField::sum(3)],
            ..Default::default()
        }
    };
    let (id, _) = wb
        .create_pivot(source, pivot, if tabular { 0 } else { 2 }, 0, fields)
        .unwrap();
    if tabular {
        let mut def = wb.pivot(id).unwrap().1.clone();
        for a in &mut def.rows {
            a.layout = PivotLayout::Tabular;
        }
        wb.update_pivot(id, def).unwrap();
    }
    wb
}

/// Writes the sample and the reference layouts into the directory
/// `$RUSUITE_PIVOT_DUMP` when set (`sample.xlsx`, `basic.xlsx`,
/// `tabular.xlsx`): the source of the parts in
/// `scripts/testdata-src/xlsx/pivot.py` and of the LibreOffice check in
/// `docs/pivot.md`.
#[test]
fn dump_sample() {
    if let Ok(dir) = std::env::var("RUSUITE_PIVOT_DUMP") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::write(dir.join("sample.xlsx"), fmt_xlsx::write(&sample()).unwrap()).unwrap();
        for (name, t) in [("basic.xlsx", false), ("tabular.xlsx", true)] {
            let wb = reference_layout(t);
            std::fs::write(dir.join(name), fmt_xlsx::write(&wb).unwrap()).unwrap();
        }
    }
}

#[test]
fn written_parts() {
    let wb = sample();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    insta::assert_snapshot!(
        "pivot_cache_definition",
        pretty(&part(&bytes, "/xl/pivotCache/pivotCacheDefinition1.xml"))
    );
    insta::assert_snapshot!(
        "pivot_cache_records",
        pretty(&part(&bytes, "/xl/pivotCache/pivotCacheRecords1.xml"))
    );
    insta::assert_snapshot!(
        "pivot_table_crosstab",
        pretty(&part(&bytes, "/xl/pivotTables/pivotTable1.xml"))
    );
    insta::assert_snapshot!(
        "pivot_table_tabular",
        pretty(&part(&bytes, "/xl/pivotTables/pivotTable2.xml"))
    );
    let book = part(&bytes, "/xl/workbook.xml");
    assert!(
        book.contains(r#"<pivotCaches><pivotCache cacheId="1" r:id="rId"#),
        "{book}"
    );
    // The second table shares the first cache: one cache part.
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    assert!(pkg
        .part(&PartName::new("/xl/pivotCache/pivotCacheDefinition2.xml").unwrap())
        .is_none());
    let sheet_rels = rels(&bytes, "/xl/worksheets/sheet2.xml");
    assert_eq!(sheet_rels.matches("relationships/pivotTable\"").count(), 2);
    assert!(rels(&bytes, "/xl/pivotTables/pivotTable2.xml")
        .contains("../pivotCache/pivotCacheDefinition1.xml"));
    assert!(
        rels(&bytes, "/xl/pivotCache/pivotCacheDefinition1.xml").contains("pivotCacheRecords1.xml")
    );
}

#[test]
fn roundtrip_keeps_definitions_and_cells() {
    let wb = sample();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.pivot_caches(), wb.pivot_caches());
    let report = back.sheet_id("Report").unwrap();
    assert_eq!(back.pivots(report), wb.pivots(report));
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    // Written again: the same parts.
    let again = fmt_xlsx::write(&back).unwrap();
    for p in [
        "/xl/pivotCache/pivotCacheDefinition1.xml",
        "/xl/pivotCache/pivotCacheRecords1.xml",
        "/xl/pivotTables/pivotTable1.xml",
        "/xl/pivotTables/pivotTable2.xml",
    ] {
        assert_eq!(part(&again, p), part(&bytes, p), "{p}");
    }
}

#[test]
fn every_option_roundtrips() {
    let mut wb = sample();
    let report = wb.sheet_id("Report").unwrap();
    let id = wb.pivots(report)[0].id;
    wb.move_pivot(id + 1, report, 60, 2).unwrap();
    let mut def = wb.pivot(id).unwrap().1.clone();
    def.rows[0].subtotals = Subtotals::Custom {
        functions: vec![AggFunc::Average, AggFunc::Count, AggFunc::VarP],
    };
    def.rows[0].hidden_items = BTreeSet::from([2]);
    def.rows[0].show_all_items = true;
    def.rows.push(1.into());
    def.rows[0].collapsed_items = BTreeSet::from([1]);
    def.rows[1].sort = SortOrder::Manual { order: vec![1, 0] };
    def.rows[1].layout = PivotLayout::Outline;
    def.cols[0].subtotals = Subtotals::None;
    def.values = vec![
        DataField {
            show_as: ShowAs::DifferenceFrom {
                base_field: 2,
                base_item: BaseItem::Previous,
            },
            ..DataField::sum(3)
        },
        DataField {
            name: "Units ranked".into(),
            show_as: ShowAs::Rank { base_field: 0 },
            ..DataField::new(4, AggFunc::Max)
        },
        DataField {
            show_as: ShowAs::DifferenceFrom {
                base_field: 0,
                base_item: BaseItem::Item { item: 0 },
            },
            ..DataField::new(3, AggFunc::Count)
        },
        DataField {
            show_as: ShowAs::RunningTotal { base_field: 0 },
            ..DataField::new(3, AggFunc::StdDevP)
        },
    ];
    def.options.values_in = ValuesAxis::Rows;
    def.options.grand_total_rows = false;
    def.options.empty_as = "-".into();
    def.options.error_as = Some("err".into());
    def.options.style = "PivotStyleMedium9".into();
    def.options.row_headers_bold = false;
    def.options.show_field_headers = false;
    def.options.compact_rows_indent = 2;
    def.options.repeat_labels = true;
    wb.update_pivot(id, def).unwrap();
    let mut def = wb.pivot(id + 1).unwrap().1.clone();
    def.filters[0].selected = PageSelection::Items {
        items: BTreeSet::from([0, 1]),
    };
    def.options.values_position = Some(1);
    def.options.values_in = ValuesAxis::Rows;
    wb.update_pivot(id + 1, def).unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    // Every item selected reads back as "(All)" (nothing hidden).
    let mut want = wb.pivots(report).to_vec();
    want[1].filters[0].selected = PageSelection::All;
    assert_eq!(back.pivots(report), want.as_slice());
    let mut snap = wb.to_snapshot();
    snap.sheets[1].pivots = want;
    assert_eq!(back.to_snapshot(), snap);
}

#[test]
fn dates_and_numbers_in_the_cache() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let date = wb.intern_style(&CellStyle {
        number_format: Some("yyyy-mm-dd".into()),
        ..Default::default()
    });
    for (r, (d, n, v)) in [
        ("Day", "Year", "V"),
        ("45306", "2024", "1.5"),
        ("45301", "2023", "2"),
    ]
    .iter()
    .enumerate()
    {
        for (c, x) in [d, n, v].iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, c as u32), x)
                .unwrap();
        }
        if r > 0 {
            wb.set_style(CellCoord::new(s, r as u32, 0), date).unwrap();
        }
    }
    wb.create_pivot(
        PivotSource::range("Sheet1", 0, 0, 2, 2),
        s,
        0,
        5,
        PivotFields {
            rows: vec![0.into()],
            cols: vec![1.into()],
            values: vec![DataField::sum(2)],
            ..Default::default()
        },
    )
    .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let def = part(&bytes, "/xl/pivotCache/pivotCacheDefinition1.xml");
    assert!(def.contains(r#"<d v="2024-01-15T00:00:00"/>"#), "{def}");
    assert!(def.contains(r#"minDate="2024-01-10T00:00:00""#), "{def}");
    assert!(def.contains(r#"<n v="2024"/>"#), "{def}");
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.pivot_caches(), wb.pivot_caches());
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
}

#[test]
fn unsupported_definitions_stay_raw() {
    let wb = sample();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    // A calculated item in the second table.
    let mut pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let name = PartName::new("/xl/pivotTables/pivotTable2.xml").unwrap();
    let xml = String::from_utf8(pkg.part(&name).unwrap().data.clone()).unwrap();
    let xml = xml.replace(
        "<pivotTableStyleInfo",
        "<calculatedItems count=\"1\"><calculatedItem formula=\"1\"/></calculatedItems><pivotTableStyleInfo",
    );
    let ct = pkg.content_type_of(&name).unwrap().to_owned();
    pkg.insert_part(name, ct, xml.clone().into_bytes());
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("calculated items"), "{warnings:?}");
    let report = back.sheet_id("Report").unwrap();
    let t = back.pivots(report)[1].clone();
    assert!(t.raw.is_some());
    // The cells stay, the table is read-only, and the XML is re-emitted.
    assert_eq!(
        back.value(CellCoord::new(report, 13, 0)),
        wb.value(CellCoord::new(report, 13, 0))
    );
    assert!(back.pivot_at(CellCoord::new(report, 13, 0)).is_some());
    let mut copy = back;
    assert!(copy.update_pivot(t.id, t.clone()).is_err());
    let again = fmt_xlsx::write(&copy).unwrap();
    assert_eq!(part(&again, "/xl/pivotTables/pivotTable2.xml"), xml);
}

#[test]
fn refresh_on_load_recomputes() {
    let mut wb = sample();
    let mut snap = wb.to_snapshot();
    snap.pivot_caches[0].refresh_on_load = true;
    wb = Workbook::from_snapshot(&snap).unwrap();
    // The source changes, the stored cells do not.
    wb.set_input(CellCoord::new(SheetId(0), 1, 3), "1000")
        .unwrap();
    let bytes = fmt_xlsx::write(&wb).unwrap();
    assert!(
        part(&bytes, "/xl/pivotCache/pivotCacheDefinition1.xml").contains("refreshOnLoad=\"1\"")
    );
    let back = fmt_xlsx::read(&bytes).unwrap();
    let report = back.sheet_id("Report").unwrap();
    // Crosstab at A3: East / Q1 = 1000 + 20.
    assert_eq!(
        back.value(CellCoord::new(report, 4, 1)),
        Value::Number(1020.0)
    );
}

fn reference(name: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

#[test]
fn reference_workbooks() {
    let (wb, warnings) =
        fmt_xlsx::read_with_warnings(&reference("provisional-pivot-basic.xlsx")).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = wb.sheet_id("Pivot").unwrap();
    let t = &wb.pivots(s)[0];
    assert_eq!(t.rows.len(), 1);
    assert_eq!(t.cols.len(), 1);
    let at = |r, c| wb.value(CellCoord::new(s, r, c));
    assert_eq!(at(2, 0), Value::Text("Sum of Sales".into()));
    assert_eq!(at(7, 3), Value::Number(210.0));
    assert!(wb.pivot_cell(CellCoord::new(s, 3, 1)).is_some());
    let (wb, warnings) =
        fmt_xlsx::read_with_warnings(&reference("provisional-pivot-tabular.xlsx")).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = wb.sheet_id("Pivot").unwrap();
    let t = &wb.pivots(s)[0];
    assert_eq!(t.rows[0].layout, PivotLayout::Tabular);
    assert_eq!(t.filters.len(), 1);
    assert_eq!(t.values.len(), 2);
    assert_eq!(wb.value(CellCoord::new(s, 0, 1)), Value::Text("Q2".into()));
}
