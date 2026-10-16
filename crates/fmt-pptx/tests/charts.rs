//! The charts deck of `examples/charts_deck.rs`: charts are written with
//! their caches and an embedded workbook (valid for `fmt-xlsx`), read back
//! unchanged, and the chart parts and the graphic frame are snapshotted.

mod common;

#[path = "../examples/charts_deck.rs"]
#[allow(dead_code)]
mod charts_deck;

use std::io::Cursor;

use engine_formula::Value;
use fmt_ooxml::{Package, PartName};
use model_sheet::CellCoord;
use model_show::{ChartData, ChartShape, ShapeKind};

fn part(bytes: &[u8], name: &str) -> Vec<u8> {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    pkg.part(&PartName::new(name).unwrap())
        .unwrap_or_else(|| panic!("{name} missing"))
        .data
        .clone()
}

fn text(bytes: &[u8], name: &str) -> String {
    String::from_utf8(part(bytes, name)).unwrap()
}

fn charts(p: &model_show::Presentation) -> Vec<&ChartShape> {
    p.slides
        .iter()
        .flat_map(|s| &s.shapes)
        .filter_map(|s| match &s.kind {
            ShapeKind::Chart(c) => Some(&**c),
            _ => None,
        })
        .collect()
}

#[test]
fn charts_deck_roundtrips() {
    let deck = charts_deck::charts_deck();
    deck.validate().unwrap();
    let bytes = fmt_pptx::write(&deck).unwrap();
    assert_eq!(bytes, fmt_pptx::write(&deck).unwrap(), "deterministic");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    // workbooks we generated ourselves are not kept (they are generated again)
    let read = charts(&back);
    assert_eq!(read.len(), 5);
    assert!(read.iter().all(|c| c.workbook.is_none()));
    common::assert_same("charts deck", &deck, &back);
    // the read deck writes the same file (its workbooks verbatim)
    assert_eq!(fmt_pptx::write(&back).unwrap(), bytes, "fixpoint");

    let pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let ct = |n: &str| {
        pkg.content_type_of(&PartName::new(n).unwrap())
            .map(str::to_owned)
    };
    assert_eq!(
        ct("/ppt/charts/chart1.xml").as_deref(),
        Some(fmt_ooxml::ct::CHART)
    );
    assert_eq!(
        ct("/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx").as_deref(),
        Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    );
    let rels = pkg
        .relationships(&PartName::new("/ppt/charts/chart1.xml").unwrap())
        .unwrap();
    let r = rels.iter().next().unwrap();
    assert!(r.rel_type.ends_with("/package"));
    assert_eq!(r.target, "../embeddings/Microsoft_Excel_Worksheet1.xlsx");
    let slide = pkg
        .relationships(&PartName::new("/ppt/slides/slide2.xml").unwrap())
        .unwrap();
    let targets: Vec<&str> = slide.iter().map(|r| r.target.as_str()).collect();
    assert!(targets.contains(&"../charts/chart2.xml") && targets.contains(&"../charts/chart3.xml"));
}

#[test]
fn embedded_workbooks_are_valid() {
    let deck = charts_deck::charts_deck();
    let bytes = fmt_pptx::write(&deck).unwrap();
    for (n, chart) in charts(&deck).into_iter().enumerate() {
        let xlsx = part(
            &bytes,
            &format!("/ppt/embeddings/Microsoft_Excel_Worksheet{}.xlsx", n + 1),
        );
        let wb = fmt_xlsx::read(&xlsx).unwrap();
        let (sheet, name) = wb.sheets()[0].clone();
        assert_eq!(name, "Sheet1");
        let at = |r: usize, c: usize| wb.value(CellCoord::new(sheet, r as u32, c as u32));
        let d: &ChartData = &chart.data;
        for (i, s) in d.series.iter().enumerate() {
            assert_eq!(at(0, i + 1), Value::Text(s.name.clone()), "chart {n}");
            for (r, v) in s.values.iter().enumerate() {
                let want = v.map_or(Value::Empty, Value::Number);
                assert_eq!(at(r + 1, i + 1), want, "chart {n} {r}");
            }
        }
        for (r, c) in d.categories.iter().enumerate() {
            let got = at(r + 1, 0);
            assert!(
                got == Value::Text(c.clone())
                    || got == Value::Number(c.parse().unwrap_or(f64::NAN)),
                "chart {n}: {got:?} vs {c}"
            );
        }
    }
}

#[test]
fn chart_part_snapshots() {
    let bytes = fmt_pptx::write(&charts_deck::charts_deck()).unwrap();
    insta::assert_snapshot!(
        "sample_chart_xml",
        common::pretty(&text(&bytes, "/ppt/charts/chart1.xml"))
    );
    insta::assert_snapshot!(
        "edited_chart_xml",
        common::pretty(&text(&bytes, "/ppt/charts/chart4.xml"))
    );
    let xml = text(&bytes, "/ppt/slides/slide1.xml");
    let start = xml.find("<p:graphicFrame>").unwrap();
    let end = xml.find("</p:graphicFrame>").unwrap() + "</p:graphicFrame>".len();
    insta::assert_snapshot!("chart_frame_xml", common::pretty(&xml[start..end]));
}

#[test]
fn edited_data_drops_the_file_workbook() {
    let bytes = fmt_pptx::write(&charts_deck::charts_deck()).unwrap();
    let mut back = fmt_pptx::read(&bytes).unwrap();
    let c = back.slides[0]
        .shapes
        .iter_mut()
        .find_map(|s| match &mut s.kind {
            ShapeKind::Chart(c) => Some(c),
            _ => None,
        })
        .unwrap();
    let mut data = c.data.clone();
    data.series[0].values[0] = Some(99.0);
    c.set_data(data);
    assert!(c.workbook.is_none());
    let again = fmt_pptx::write(&back).unwrap();
    let wb = fmt_xlsx::read(&part(
        &again,
        "/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx",
    ))
    .unwrap();
    let sheet = wb.sheets()[0].0;
    assert_eq!(wb.value(CellCoord::new(sheet, 1, 1)), Value::Number(99.0));
    let chart = text(&again, "/ppt/charts/chart1.xml");
    assert!(chart.contains("<c:v>99</c:v>"), "{chart}");
}

#[test]
fn foreign_workbooks_are_kept_verbatim() {
    let bytes = fmt_pptx::write(&charts_deck::charts_deck()).unwrap();
    // the file's workbook has one more cell than we would write
    let name = PartName::new("/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx").unwrap();
    let mut pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let mut wb = fmt_xlsx::read(&pkg.part(&name).unwrap().data).unwrap();
    let sheet = wb.sheets()[0].0;
    wb.set_input(CellCoord::new(sheet, 20, 20), "note").unwrap();
    let foreign = fmt_xlsx::write(&wb).unwrap();
    pkg.part_mut(&name).unwrap().data = foreign.clone();
    let edited = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let back = fmt_pptx::read(&edited).unwrap();
    assert!(charts(&back)[0].workbook.is_some());
    assert!(charts(&back)[1].workbook.is_none());
    let again = fmt_pptx::write(&back).unwrap();
    assert_eq!(part(&again, name.as_str()), foreign);
}
