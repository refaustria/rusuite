//! Text import (Text to Columns, the CSV wizard) and CSV export (P8-35).

use engine_formula::{CellCoord, SheetId, Value};
use model_sheet::textio::{
    convert_field, csv_field, date_serial, decode_text, detect_decimal, detect_separator,
    number_with, parse_date, split_line, split_records, ColumnFormat, CsvOptions, DateOrder,
    Imported, SplitKind, TextEncoding, TextImportOptions,
};
use model_sheet::Workbook;

fn delim(sep: char) -> TextImportOptions {
    TextImportOptions {
        split: SplitKind::by(sep),
        ..Default::default()
    }
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn delimited_splitting() {
    let cases: &[(&str, char, &[&str])] = &[
        ("a;b;c", ';', &["a", "b", "c"]),
        ("a,b,c", ',', &["a", "b", "c"]),
        ("a\tb", '\t', &["a", "b"]),
        ("a b  c", ' ', &["a", "b", "", "c"]),
        ("a|b", '|', &["a", "b"]),
        ("", ';', &[]),
        (";", ';', &["", ""]),
        ("a;", ';', &["a", ""]),
        (";a", ';', &["", "a"]),
        ("\"x;y\";z", ';', &["x;y", "z"]),
        ("\"say \"\"hi\"\"\",b", ',', &["say \"hi\"", "b"]),
        ("a\"b,c", ',', &["a\"b", "c"]),
        ("\"\",x", ',', &["", "x"]),
        ("\"a\"b,c", ',', &["ab", "c"]),
    ];
    for (line, sep, want) in cases {
        assert_eq!(split_line(line, &delim(*sep)), s(want), "{line:?}");
    }
}

#[test]
fn several_delimiters_and_consecutive() {
    let o = TextImportOptions {
        split: SplitKind::Delimited {
            tab: true,
            semicolon: true,
            comma: false,
            space: true,
            other: Some('/'),
            consecutive: true,
        },
        ..Default::default()
    };
    assert_eq!(split_line("a;;b  c\t/d", &o), s(&["a", "b", "c", "d"]));
    let no_merge = TextImportOptions {
        split: SplitKind::by(' '),
        ..Default::default()
    };
    assert_eq!(split_line("a  b", &no_merge), s(&["a", "", "b"]));
    // No qualifier: quotes are kept.
    let raw = TextImportOptions {
        qualifier: None,
        ..delim(',')
    };
    assert_eq!(split_line("\"a,b\"", &raw), s(&["\"a", "b\""]));
    // A single-quote qualifier.
    let single = TextImportOptions {
        qualifier: Some('\''),
        ..delim(',')
    };
    assert_eq!(split_line("'a,b',c", &single), s(&["a,b", "c"]));
}

#[test]
fn records_and_line_breaks() {
    let o = delim(',');
    let recs = split_records("a,b\r\nc,d\n\"multi\nline\",e\rf,g\n", &o);
    assert_eq!(
        recs,
        vec![
            s(&["a", "b"]),
            s(&["c", "d"]),
            s(&["multi\nline", "e"]),
            s(&["f", "g"])
        ]
    );
    assert!(split_records("", &o).is_empty());
    assert_eq!(
        split_records("x\n\ny", &o),
        vec![s(&["x"]), s(&[""]), s(&["y"])]
    );
}

#[test]
fn fixed_width() {
    let o = TextImportOptions {
        split: SplitKind::FixedWidth {
            breaks: vec![5, 3, 3],
        },
        ..Default::default()
    };
    assert_eq!(split_line("abcdefghij", &o), s(&["abc", "de", "fghij"]));
    assert_eq!(split_line("ab", &o), s(&["ab", "", ""]));
    assert_eq!(
        split_records("Jan  10\nFeb 200", &o),
        vec![s(&["Jan", "", "10"]), s(&["Feb", "2", "00"])]
    );
}

#[test]
fn numbers_with_separators() {
    assert_eq!(number_with("1.234,5", ',', '.'), Some(1234.5));
    assert_eq!(number_with("1,234.5", '.', ','), Some(1234.5));
    assert_eq!(number_with("-3", '.', ','), Some(-3.0));
    assert_eq!(number_with("12%", '.', ','), Some(0.12));
    assert_eq!(number_with("(4)", '.', ','), Some(-4.0));
    assert_eq!(number_with("1e3", '.', ','), Some(1000.0));
    assert_eq!(number_with("0,5", ',', '.'), Some(0.5));
    assert_eq!(number_with("1,23", '.', ','), None);
    assert_eq!(number_with("12a", '.', ','), None);
    assert_eq!(number_with("", '.', ','), None);
}

#[test]
fn column_formats() {
    let o = delim(',');
    let general = |f: &str| convert_field(f, ColumnFormat::General, &o);
    assert_eq!(general("12"), Some(Imported::Input("12".into())));
    assert_eq!(general("abc"), Some(Imported::Input("abc".into())));
    assert_eq!(general(""), Some(Imported::Empty));
    assert_eq!(general("=1+1"), Some(Imported::Input("'=1+1".into())));
    assert_eq!(
        convert_field("007", ColumnFormat::Text, &o),
        Some(Imported::Input("'007".into()))
    );
    assert_eq!(convert_field("x", ColumnFormat::Skip, &o), None);
    let date = |f: &str, order| convert_field(f, ColumnFormat::Date { order }, &o);
    assert_eq!(
        date("12/31/2024", DateOrder::Mdy),
        Some(Imported::Date(45657.0))
    );
    assert_eq!(
        date("31.12.2024", DateOrder::Dmy),
        Some(Imported::Date(45657.0))
    );
    assert_eq!(
        date("2024-12-31", DateOrder::Ymd),
        Some(Imported::Date(45657.0))
    );
    assert_eq!(
        date("13/13/2024", DateOrder::Mdy),
        Some(Imported::Input("13/13/2024".into()))
    );
    let de = TextImportOptions {
        decimal: ',',
        thousands: '.',
        ..delim(';')
    };
    assert_eq!(
        convert_field("1.234,5", ColumnFormat::General, &de),
        Some(Imported::Input("1234.5".into()))
    );
}

#[test]
fn dates() {
    assert_eq!(date_serial(1900, 3, 1), Some(61.0));
    assert_eq!(date_serial(2024, 2, 29), Some(45351.0));
    assert_eq!(date_serial(2023, 2, 29), None);
    assert_eq!(
        parse_date("1/2/03", DateOrder::Mdy),
        date_serial(2003, 1, 2)
    );
    assert_eq!(
        parse_date("1/2/95", DateOrder::Dmy),
        date_serial(1995, 2, 1)
    );
    assert_eq!(parse_date("2024/1", DateOrder::Ymd), None);
}

#[test]
fn detection() {
    assert_eq!(detect_separator("a;b;c\n1;2;3"), ';');
    assert_eq!(detect_separator("a,b\n1,2"), ',');
    assert_eq!(detect_separator("a\tb\n1\t2"), '\t');
    assert_eq!(detect_separator("\"x,y\";z\n1;2"), ';');
    assert_eq!(detect_separator("plain"), ',');
    assert_eq!(detect_decimal("Name;Value\nA;1,5\nB;2,25", ';'), ',');
    assert_eq!(detect_decimal("Name;Value\nA;1.5\nB;2.25", ';'), '.');
    assert_eq!(detect_decimal("a,b\n1,5", ','), '.');
}

#[test]
fn decoding() {
    let (t, e) = decode_text(b"\xEF\xBB\xBFa;\xC3\xA4", None);
    assert_eq!((t.as_str(), e), ("a;ä", TextEncoding::Utf8));
    let (t, e) = decode_text(b"caf\xE9 \x80", None);
    assert_eq!((t.as_str(), e), ("café €", TextEncoding::Windows1252));
    let (t, e) = decode_text(&[0xFF, 0xFE, b'h', 0, b'i', 0], None);
    assert_eq!((t.as_str(), e), ("hi", TextEncoding::Utf16Le));
    let (t, e) = decode_text(&[0xFE, 0xFF, 0, b'o', 0, b'k'], None);
    assert_eq!((t.as_str(), e), ("ok", TextEncoding::Utf16Be));
    let (t, _) = decode_text(b"\xE9", Some(TextEncoding::Windows1252));
    assert_eq!(t, "é");
}

#[test]
fn csv_export() {
    let mut wb = Workbook::new();
    let sh = SheetId(0);
    let c = |r, col| CellCoord::new(sh, r, col);
    wb.set_input(c(0, 0), "Name").unwrap();
    wb.set_input(c(0, 1), "Note").unwrap();
    wb.set_input(c(1, 0), "a,b").unwrap();
    wb.set_input(c(1, 1), "say \"hi\"").unwrap();
    wb.set_input(c(2, 0), "=1/4").unwrap();
    wb.set_input(c(2, 2), "TRUE").unwrap();
    wb.set_input(c(3, 1), "line\nbreak").unwrap();
    let style = wb.intern_style(&model_sheet::CellStyle {
        number_format: Some("0.00".into()),
        ..Default::default()
    });
    wb.set_style(c(2, 0), style).unwrap();
    let out = String::from_utf8(wb.to_csv(sh, &CsvOptions::default())).unwrap();
    assert_eq!(
        out,
        "\u{feff}Name,Note,\r\n\"a,b\",\"say \"\"hi\"\"\",\r\n0.25,,TRUE\r\n,\"line\nbreak\",\r\n"
    );
    let semi = CsvOptions {
        separator: ';',
        bom: false,
        quote_all: true,
    };
    let out = String::from_utf8(wb.to_csv(sh, &semi)).unwrap();
    assert!(out.starts_with("\"Name\";\"Note\";\r\n\"a,b\";"), "{out}");
    assert_eq!(csv_field(" pad", &CsvOptions::default()), "\" pad\"");
    assert!(Workbook::new().to_csv(sh, &CsvOptions::default()).len() == 3);
}

#[test]
fn import_into_a_sheet() {
    let mut wb = Workbook::new();
    let sh = SheetId(0);
    let o = TextImportOptions {
        formats: vec![
            ColumnFormat::Text,
            ColumnFormat::General,
            ColumnFormat::Skip,
            ColumnFormat::Date {
                order: DateOrder::Dmy,
            },
        ],
        ..delim(';')
    };
    let recs = split_records("id;n;skip;when\n007;1,5;x;02.01.2024\n", &o);
    let cells = wb.import_records(sh, 2, 1, &recs, &o).unwrap();
    assert_eq!(cells.len(), 6);
    let v = |r, col| wb.value(CellCoord::new(sh, r, col));
    assert_eq!(v(3, 1), Value::Text("007".into()));
    // `1,5` with `.` as decimal is text.
    assert_eq!(v(3, 2), Value::Text("1,5".into()));
    assert_eq!(v(3, 3), Value::Number(date_serial(2024, 1, 2).unwrap()));
    assert_eq!(
        wb.style(CellCoord::new(sh, 3, 3)).number_format.as_deref(),
        Some("m/d/yyyy")
    );
    assert_eq!(v(2, 3), Value::Text("when".into()));
}
