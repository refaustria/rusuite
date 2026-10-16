//! Excel tables, outlines, page breaks and pictures (P8-35): the openpyxl
//! reference workbook and built workbooks, written and read back.

use std::io::Cursor;

use engine_formula::{CellCoord, SheetId, Value};
use fmt_ooxml::{Package, PartName};
use model_sheet::{
    Axis, CellOffset, ChartAnchor, OutlineProps, OutlineState, Picture, Table, TotalsCell,
    TotalsFunction, Workbook,
};

fn load(name: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/xlsx")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

fn part(xlsx: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    let p = pkg
        .part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("no part {name}"));
    String::from_utf8_lossy(&p.data).into_owned()
}

fn has_part(xlsx: &[u8], name: &str) -> bool {
    let pkg = Package::open(Cursor::new(xlsx)).unwrap();
    pkg.part(&PartName::new(name).unwrap()).is_some()
}

fn pretty(xml: &str) -> String {
    xml.replace("><", ">\n<")
}

fn n(x: f64) -> Value {
    Value::Number(x)
}

#[test]
fn reference_workbook_tables() {
    let bytes = load("provisional-tables.xlsx");
    let (wb, warnings) = fmt_xlsx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let s = wb.sheet_id("Sales").unwrap();
    let c = |r, col| CellCoord::new(s, r, col);
    let tables = wb.tables(s);
    assert_eq!(tables.len(), 2);
    let t = &tables[0];
    assert_eq!(
        (t.name.as_str(), t.r0, t.c0, t.r1, t.c1),
        ("Sales", 0, 0, 6, 4)
    );
    assert!(t.header_row && t.totals_row);
    assert_eq!(t.style, "TableStyleMedium9");
    assert!(t.look.banded_rows && t.look.last_column && !t.look.first_column);
    assert!(t.auto_filter.is_some());
    let names: Vec<&str> = t.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Region", "Qty", "Price", "Amount", "Note"]);
    assert_eq!(
        t.columns[0].totals,
        Some(TotalsCell::Label {
            text: "Total".into()
        })
    );
    assert_eq!(
        t.columns[1].totals,
        Some(TotalsCell::Function {
            function: TotalsFunction::Sum
        })
    );
    assert_eq!(
        t.columns[3].calculated_formula.as_deref(),
        Some("[@Qty]*[@Price]")
    );
    // Formulas show the display form (inside the table without its name) and compute.
    assert_eq!(wb.formula_text(c(1, 3)), Some("=[@Qty]*[@Price]"));
    assert_eq!(wb.formula_text(c(6, 1)), Some("=SUBTOTAL(109,[Qty])"));
    assert_eq!(wb.formula_text(c(1, 6)), Some("=SUM(Sales[Qty])"));
    assert_eq!(wb.value(c(1, 3)), n(7.5));
    assert_eq!(wb.value(c(1, 6)), n(17.0));
    let avg = (7.5 + 7.5 + 10.0 + 8.0 + 3.0) / 5.0;
    assert_eq!(wb.value(c(2, 6)), n(avg));
    assert_eq!(wb.value(c(6, 3)), n(avg));
    assert_eq!(wb.value(c(3, 6)), n(3.0 + 5.0));
    assert_eq!(wb.value(c(4, 6)), n(5.0));
    let small = &tables[1];
    assert_eq!(small.style, "TableStyleLight1");
    assert!(small.look.banded_columns && !small.look.banded_rows);
    assert!(!small.totals_row);
}

#[test]
fn reference_workbook_outline_and_breaks() {
    let bytes = load("provisional-tables.xlsx");
    let wb = fmt_xlsx::read(&bytes).unwrap();
    let s = wb.sheet_id("Outline").unwrap();
    assert_eq!(
        wb.outline_props(s),
        OutlineProps {
            summary_below: false,
            summary_right: true
        }
    );
    assert_eq!(wb.row_info(s, 1).outline_level, 1);
    assert!(wb.row_info(s, 1).collapsed);
    assert_eq!(wb.row_info(s, 2).outline_level, 2);
    assert!(wb.row_info(s, 2).hidden);
    assert_eq!(wb.col_info(s, 2).outline_level, 1);
    assert_eq!(wb.max_outline_level(s, Axis::Rows), 2);
    assert_eq!(wb.page_breaks(s, Axis::Rows), &[10, 20]);
    assert_eq!(wb.page_breaks(s, Axis::Cols), &[4]);
    // Expanding the collapsed group shows rows 3–4.
    assert_eq!(wb.outline_detail(s, Axis::Rows, 1), vec![2, 3]);
}

#[test]
fn reference_workbook_roundtrips() {
    let bytes = load("provisional-tables.xlsx");
    let wb = fmt_xlsx::read(&bytes).unwrap();
    let out = fmt_xlsx::write(&wb).unwrap();
    let (back, warnings) = fmt_xlsx::read_with_warnings(&out).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    // The file form of the formulas: qualified, `#This Row` spelled out.
    let sheet = part(&out, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains("<f>Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]</f>"),
        "{sheet}"
    );
    assert!(sheet.contains("<f>SUM(Sales[Qty])</f>"));
    assert!(sheet.contains("<tableParts count=\"2\">"));
    let table = part(&out, "/xl/tables/table1.xml");
    assert!(table.contains(
        "<calculatedColumnFormula>Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]</calculatedColumnFormula>"
    ));
    let outline = part(&out, "/xl/worksheets/sheet2.xml");
    assert!(outline.contains("<outlinePr summaryBelow=\"0\" summaryRight=\"1\"/>"));
    assert!(outline.contains("outlineLevelRow=\"2\""));
    assert!(outline.contains("<row r=\"2\" outlineLevel=\"1\" collapsed=\"1\""));
    assert!(outline.contains("<brk id=\"10\" max=\"16383\" man=\"1\"/>"));
    let pkg = Package::open(Cursor::new(&out)).unwrap();
    let ct = &pkg
        .part(&PartName::new("/xl/tables/table2.xml").unwrap())
        .unwrap()
        .content_type;
    assert!(ct.ends_with("spreadsheetml.table+xml"), "{ct}");
}

/// A workbook with a table (header, totals, calculated column, filter),
/// unqualified references inside it and a qualified one outside.
fn built() -> Workbook {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let c = |r, col| CellCoord::new(s, r, col);
    let names: Vec<String> = ["Item", "Units", "Unit Price", "Total"]
        .map(String::from)
        .to_vec();
    let mut t = Table::new(3, "Orders", 1, 1, 5, 4, &names);
    t.totals_row = true;
    t.columns[0].totals = Some(TotalsCell::Label { text: "Sum".into() });
    t.columns[3].totals = Some(TotalsCell::Function {
        function: TotalsFunction::Sum,
    });
    t.columns[2].totals = Some(TotalsCell::Custom {
        formula: "MAX([Unit Price])".into(),
    });
    t.columns[3].calculated_formula = Some("[@Units]*[@[Unit Price]]".into());
    t.style = "TableStyleDark3".into();
    t.look.banded_columns = true;
    wb.set_tables(s, vec![t]).unwrap();
    let rows = [
        ["Item", "Units", "Unit Price", "Total"],
        ["Pen", "4", "1.25", "=[@Units]*[@[Unit Price]]"],
        ["Ink", "2", "8", "=[@Units]*[@[Unit Price]]"],
        ["Pad", "10", "0.5", "=[@Units]*[@[Unit Price]]"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (col, v) in row.iter().enumerate() {
            wb.set_input(c(r as u32 + 1, col as u32 + 1), v).unwrap();
        }
    }
    wb.set_input(c(5, 1), "Sum").unwrap();
    wb.set_input(c(5, 3), "=MAX([Unit Price])").unwrap();
    wb.set_input(c(5, 4), "=SUBTOTAL(109,[Total])").unwrap();
    wb.set_input(c(8, 8), "=Orders[[#Totals],[Total]]/ROWS(Orders)")
        .unwrap();
    wb
}

#[test]
fn built_table_roundtrips() {
    let wb = built();
    let s = SheetId(0);
    let c = |r, col| CellCoord::new(s, r, col);
    assert_eq!(wb.value(c(5, 4)), n(5.0 + 16.0 + 5.0));
    assert_eq!(wb.value(c(8, 8)), n(26.0 / 3.0));
    let out = fmt_xlsx::write(&wb).unwrap();
    insta::assert_snapshot!(
        "table_orders_xml",
        pretty(&part(&out, "/xl/tables/table1.xml"))
    );
    let sheet = part(&out, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains("<f>SUBTOTAL(109,Orders[Total])</f>"),
        "{sheet}"
    );
    assert!(
        sheet.contains("<f>Orders[[#Totals],[Total]]/ROWS(Orders)</f>"),
        "{sheet}"
    );
    let (back, warnings) = fmt_xlsx::read_with_warnings(&out).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert_eq!(back.value(c(8, 8)), n(26.0 / 3.0));
    assert_eq!(
        back.formula_text(c(2, 4)),
        Some("=[@Units]*[@[Unit Price]]")
    );
}

#[test]
fn outline_and_breaks_roundtrip() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let plan = wb.group_plan(s, Axis::Rows, 1, 3, false).unwrap();
    wb.set_outline_states(s, Axis::Rows, &plan).unwrap();
    let plan = wb.collapse_plan(s, Axis::Rows, 4, true);
    wb.set_outline_states(s, Axis::Rows, &plan).unwrap();
    wb.set_outline_states(
        s,
        Axis::Cols,
        &[(
            2,
            OutlineState {
                level: 3,
                hidden: false,
                collapsed: false,
            },
        )],
    )
    .unwrap();
    wb.set_page_breaks(s, Axis::Rows, vec![30, 5, 5, 0])
        .unwrap();
    wb.set_page_breaks(s, Axis::Cols, vec![7]).unwrap();
    assert_eq!(wb.page_breaks(s, Axis::Rows), &[5, 30]);
    let out = fmt_xlsx::write(&wb).unwrap();
    let sheet = part(&out, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains("outlineLevelRow=\"1\" outlineLevelCol=\"3\""),
        "{sheet}"
    );
    assert!(sheet.contains("<row r=\"5\" collapsed=\"1\"/>"), "{sheet}");
    assert!(sheet.contains("<col min=\"3\" max=\"3\" width=\"8.43\" outlineLevel=\"3\"/>"));
    let back = fmt_xlsx::read(&out).unwrap();
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    // Inserts move the breaks.
    let mut wb = back;
    wb.insert_rows(s, 0, 2).unwrap();
    assert_eq!(wb.page_breaks(s, Axis::Rows), &[7, 32]);
    // Deleting the row a break starts at removes the break.
    wb.delete_rows(s, 7, 1).unwrap();
    assert_eq!(wb.page_breaks(s, Axis::Rows), &[31]);
}

/// A 1×1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0,
    0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[test]
fn pictures_roundtrip() {
    let mut wb = Workbook::new();
    let s = SheetId(0);
    let at = |col, row| CellOffset {
        col,
        row,
        col_offset: 0,
        row_offset: 0,
    };
    let media = core_model::Media {
        content_type: "image/png".into(),
        data: PNG.to_vec(),
    };
    wb.add_picture(
        s,
        Picture {
            id: 0,
            name: String::new(),
            descr: "Logo".into(),
            anchor: ChartAnchor::TwoCell {
                from: at(1, 1),
                to: at(3, 6),
            },
            media: media.clone(),
        },
    )
    .unwrap();
    wb.add_picture(
        s,
        Picture {
            id: 0,
            name: "Stamp".into(),
            descr: String::new(),
            anchor: ChartAnchor::OneCell {
                from: at(5, 2),
                width: 952_500,
                height: 476_250,
            },
            media,
        },
    )
    .unwrap();
    let out = fmt_xlsx::write(&wb).unwrap();
    assert!(has_part(&out, "/xl/media/image1.png"));
    assert!(has_part(&out, "/xl/media/image2.png"));
    insta::assert_snapshot!(
        "pictures_drawing_xml",
        pretty(&part(&out, "/xl/drawings/drawing1.xml"))
    );
    let (back, warnings) = fmt_xlsx::read_with_warnings(&out).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.to_snapshot(), wb.to_snapshot());
    assert_eq!(back.pictures(s)[0].name, "Picture 1");
    assert_eq!(back.pictures(s)[1].descr, "");
    // Row inserts move a two-cell picture.
    let mut wb = back;
    wb.insert_rows(s, 0, 1).unwrap();
    let ChartAnchor::TwoCell { from, to } = wb.pictures(s)[0].anchor else {
        panic!()
    };
    assert_eq!((from.row, to.row), (2, 7));
}

#[test]
fn tables_survive_libreoffice_style_files() {
    // A table whose part names no columns' formulas and has no style.
    let mut wb = built();
    let s = SheetId(0);
    let mut t = wb.tables(s)[0].clone();
    t.style.clear();
    t.auto_filter = None;
    wb.set_tables(s, vec![t]).unwrap();
    let out = fmt_xlsx::write(&wb).unwrap();
    let table = part(&out, "/xl/tables/table1.xml");
    assert!(!table.contains("name=\"TableStyle") && !table.contains("autoFilter"));
    assert_eq!(
        fmt_xlsx::read(&out).unwrap().to_snapshot(),
        wb.to_snapshot()
    );
}
