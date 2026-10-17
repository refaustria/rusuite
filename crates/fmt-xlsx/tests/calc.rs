//! P9-C4: `<calcPr>` – calculation mode, `fullCalcOnLoad` and the R1C1
//! reference style survive a roundtrip; a manual-mode file opens in
//! manual mode with every formula calculated.

use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::{CalcMode, CalcSettings, Workbook};

#[test]
fn calc_settings_roundtrip() {
    let mut wb = Workbook::new();
    let c = |r, col| CellCoord::new(SheetId(0), r, col);
    wb.set_input(c(0, 0), "2").unwrap();
    wb.set_input(c(0, 1), "=A1*3").unwrap();
    wb.set_calc_settings(CalcSettings {
        mode: CalcMode::Manual,
        full_calc_on_load: true,
        r1c1: true,
    });
    let bytes = fmt_xlsx::write(&wb).unwrap();
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes.as_slice())).unwrap();
    let book = pkg
        .part(&fmt_ooxml::PartName::new("/xl/workbook.xml").unwrap())
        .map(|p| String::from_utf8(p.data.clone()).unwrap())
        .unwrap();
    assert!(
        book.contains(r#"<calcPr calcMode="manual" fullCalcOnLoad="1" refMode="R1C1"/>"#),
        "{book}"
    );
    let back = fmt_xlsx::read(&bytes).unwrap();
    assert_eq!(back.calc_settings(), wb.calc_settings());
    assert!(back.engine().is_manual());
    assert_eq!(back.value(c(0, 1)), Value::Number(6.0));
    // The default writes only fullCalcOnLoad.
    let plain = fmt_xlsx::write(&Workbook::new()).unwrap();
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(plain.as_slice())).unwrap();
    let book = pkg
        .part(&fmt_ooxml::PartName::new("/xl/workbook.xml").unwrap())
        .map(|p| String::from_utf8(p.data.clone()).unwrap())
        .unwrap();
    assert!(book.contains(r#"<calcPr fullCalcOnLoad="1"/>"#), "{book}");
}
