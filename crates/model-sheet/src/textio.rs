//! Text import and export: Excel's Text Import Wizard / Text to Columns
//! (delimited or fixed width, text qualifier, column data formats,
//! decimal and thousands separators) and Save As CSV. Pure functions on
//! strings; [`Workbook::import_rows`] and [`Workbook::to_csv`] apply them
//! to a sheet.

use engine_formula::{CellCoord, SheetId, Value};
use serde::{Deserialize, Serialize};

use crate::workbook::Workbook;
use crate::Error;

/// How lines are cut into fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SplitKind {
    /// Fields separated by any of the chosen characters.
    Delimited {
        #[serde(default)]
        tab: bool,
        #[serde(default)]
        semicolon: bool,
        #[serde(default)]
        comma: bool,
        #[serde(default)]
        space: bool,
        /// "Other:" (one character).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        other: Option<char>,
        /// "Treat consecutive delimiters as one".
        #[serde(default)]
        consecutive: bool,
    },
    /// Fields start at the given character positions (ascending, > 0).
    FixedWidth { breaks: Vec<u32> },
}

impl SplitKind {
    /// Comma-separated (CSV).
    pub fn comma() -> Self {
        SplitKind::Delimited {
            tab: false,
            semicolon: false,
            comma: true,
            space: false,
            other: None,
            consecutive: false,
        }
    }

    /// Delimited by one character.
    pub fn by(sep: char) -> Self {
        let mut s = SplitKind::Delimited {
            tab: sep == '\t',
            semicolon: sep == ';',
            comma: sep == ',',
            space: sep == ' ',
            other: None,
            consecutive: false,
        };
        if !matches!(sep, '\t' | ';' | ',' | ' ') {
            if let SplitKind::Delimited { other, .. } = &mut s {
                *other = Some(sep);
            }
        }
        s
    }

    fn is_delimiter(&self, c: char) -> bool {
        match self {
            SplitKind::Delimited {
                tab,
                semicolon,
                comma,
                space,
                other,
                ..
            } => {
                (*tab && c == '\t')
                    || (*semicolon && c == ';')
                    || (*comma && c == ',')
                    || (*space && c == ' ')
                    || *other == Some(c)
            }
            SplitKind::FixedWidth { .. } => false,
        }
    }
}

/// The order of day, month and year in a "Date" column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DateOrder {
    Mdy,
    Dmy,
    Ymd,
}

/// Column data format of the wizard's step 3.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ColumnFormat {
    /// Numbers become numbers, dates dates, the rest text.
    #[default]
    General,
    /// Kept as text.
    Text,
    /// A date in the given order.
    Date { order: DateOrder },
    /// "Do not import column (skip)".
    Skip,
}

/// Everything the wizard asks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextImportOptions {
    pub split: SplitKind,
    /// The text qualifier (`"` by default; `None` = {none}).
    #[serde(default = "default_qualifier")]
    pub qualifier: Option<char>,
    /// Formats of the fields by position; missing ones are General.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub formats: Vec<ColumnFormat>,
    /// Decimal separator of General numbers (`.`).
    #[serde(default = "default_decimal")]
    pub decimal: char,
    /// Thousands separator of General numbers (`,`).
    #[serde(default = "default_thousands")]
    pub thousands: char,
}

fn default_qualifier() -> Option<char> {
    Some('"')
}
fn default_decimal() -> char {
    '.'
}
fn default_thousands() -> char {
    ','
}

impl Default for TextImportOptions {
    fn default() -> Self {
        TextImportOptions {
            split: SplitKind::by('\t'),
            qualifier: Some('"'),
            formats: Vec::new(),
            decimal: '.',
            thousands: ',',
        }
    }
}

impl TextImportOptions {
    fn format(&self, i: usize) -> ColumnFormat {
        self.formats.get(i).copied().unwrap_or_default()
    }
}

/// Splits one line (no line breaks) into fields.
pub fn split_line(line: &str, opts: &TextImportOptions) -> Vec<String> {
    split_records(line, opts)
        .into_iter()
        .next()
        .unwrap_or_default()
}

/// Splits `text` into records of fields. Delimited text honours the text
/// qualifier (a doubled qualifier inside is one; a qualified field may
/// span lines). Line breaks are `\r\n`, `\n` or `\r`; a final empty line
/// is not a record.
pub fn split_records(text: &str, opts: &TextImportOptions) -> Vec<Vec<String>> {
    match &opts.split {
        SplitKind::FixedWidth { breaks } => lines(text).map(|l| split_fixed(l, breaks)).collect(),
        split @ SplitKind::Delimited { consecutive, .. } => {
            split_delimited(text, split, opts.qualifier, *consecutive)
        }
    }
}

fn lines(text: &str) -> impl Iterator<Item = &str> {
    let text = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .or_else(|| text.strip_suffix('\r'))
        .unwrap_or(text);
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let s = rest?;
        match s.find(['\r', '\n']) {
            Some(i) => {
                let skip = if s[i..].starts_with("\r\n") { 2 } else { 1 };
                rest = Some(&s[i + skip..]);
                Some(&s[..i])
            }
            None => {
                rest = None;
                Some(s)
            }
        }
    })
    .filter(|_| !text.is_empty())
}

fn split_fixed(line: &str, breaks: &[u32]) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut cuts: Vec<usize> = breaks
        .iter()
        .map(|&b| b as usize)
        .filter(|&b| b > 0)
        .collect();
    cuts.sort_unstable();
    cuts.dedup();
    let mut out = Vec::new();
    let mut start = 0;
    for cut in cuts.into_iter().chain(std::iter::once(usize::MAX)) {
        let end = cut.min(chars.len());
        let field: String = chars
            .get(start.min(chars.len())..end)
            .unwrap_or(&[])
            .iter()
            .collect();
        out.push(field.trim().to_string());
        start = end;
        if cut == usize::MAX {
            break;
        }
    }
    out
}

fn split_delimited(
    text: &str,
    split: &SplitKind,
    qualifier: Option<char>,
    consecutive: bool,
) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record: Vec<String> = Vec::new();
    let mut field = String::new();
    // A field that started with the qualifier, and whether we are inside it.
    let mut quoted = false;
    let mut in_quotes = false;
    // The previous character closed a field (for consecutive delimiters).
    let mut after_delim = false;
    let mut chars = text.chars().peekable();
    let mut any = false;
    while let Some(c) = chars.next() {
        any = true;
        if in_quotes {
            if Some(c) == qualifier {
                if chars.peek() == Some(&c) {
                    field.push(c);
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        if Some(c) == qualifier && field.is_empty() && !quoted {
            quoted = true;
            in_quotes = true;
            after_delim = false;
            continue;
        }
        if split.is_delimiter(c) {
            if consecutive && after_delim {
                continue;
            }
            record.push(std::mem::take(&mut field));
            quoted = false;
            after_delim = true;
            continue;
        }
        if c == '\r' || c == '\n' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            record.push(std::mem::take(&mut field));
            records.push(std::mem::take(&mut record));
            quoted = false;
            after_delim = false;
            any = false;
            continue;
        }
        field.push(c);
        after_delim = false;
    }
    if any || !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    records
}

/// What a field becomes in a cell.
#[derive(Debug, Clone, PartialEq)]
pub enum Imported {
    /// Leave the cell empty.
    Empty,
    /// User input for [`Workbook::set_input`] (numbers in en-US form,
    /// text with a leading `'` when it would read as something else).
    Input(String),
    /// A date serial (formatted with a date format).
    Date(f64),
}

/// Converts one field with its column format (`None` for a skipped
/// column).
pub fn convert_field(
    field: &str,
    format: ColumnFormat,
    opts: &TextImportOptions,
) -> Option<Imported> {
    Some(match format {
        ColumnFormat::Skip => return None,
        _ if field.is_empty() => Imported::Empty,
        ColumnFormat::Text => Imported::Input(format!("'{field}")),
        ColumnFormat::Date { order } => match parse_date(field, order) {
            Some(serial) => Imported::Date(serial),
            None => Imported::Input(general_input(field, opts)),
        },
        ColumnFormat::General => match number_with(field.trim(), opts.decimal, opts.thousands) {
            Some(n) if opts.decimal != '.' => Imported::Input(format!("{n}")),
            _ => Imported::Input(general_input(field, opts)),
        },
    })
}

/// The input of a General field: numbers with the chosen separators are
/// rewritten in en-US form; formulas are kept as text (`'=`), as the
/// wizard does.
fn general_input(field: &str, opts: &TextImportOptions) -> String {
    if field.starts_with('=') {
        return format!("'{field}");
    }
    if let Some(n) = number_with(field.trim(), opts.decimal, opts.thousands) {
        let pct = field.trim().ends_with('%');
        return if pct {
            format!("{}%", n * 100.0)
        } else {
            format!("{n}")
        };
    }
    field.to_string()
}

/// A number written with `decimal`/`thousands` separators (`1.234,5`,
/// `-3`, `12%`, `(4)`), `None` otherwise.
pub fn number_with(s: &str, decimal: char, thousands: char) -> Option<f64> {
    let (s, neg_paren) = match s.strip_prefix('(').and_then(|r| r.strip_suffix(')')) {
        Some(inner) => (inner, true),
        None => (s, false),
    };
    let (s, pct) = match s.strip_suffix('%') {
        Some(r) => (r.trim_end(), true),
        None => (s, false),
    };
    let (s, neg) = match s.strip_prefix('-') {
        Some(r) => (r, true),
        None => (s.strip_prefix('+').unwrap_or(s), false),
    };
    if s.is_empty() || !s.starts_with(|c: char| c.is_ascii_digit() || c == decimal) {
        return None;
    }
    let mut out = String::with_capacity(s.len());
    let mut seen_decimal = false;
    let mut seen_exp = false;
    let mut group_digits: Option<usize> = None;
    for c in s.chars() {
        if c.is_ascii_digit() {
            out.push(c);
            if let Some(n) = group_digits.as_mut() {
                *n += 1;
            }
        } else if c == decimal && !seen_decimal && !seen_exp {
            if group_digits.is_some_and(|n| n != 3) {
                return None;
            }
            group_digits = None;
            seen_decimal = true;
            out.push('.');
        } else if c == thousands && !seen_decimal && !seen_exp && thousands != decimal {
            if group_digits.is_some_and(|n| n != 3) || out.is_empty() {
                return None;
            }
            group_digits = Some(0);
        } else if (c == 'e' || c == 'E') && !seen_exp && !out.is_empty() {
            seen_exp = true;
            out.push('e');
        } else if (c == '+' || c == '-') && out.ends_with('e') {
            out.push(c);
        } else {
            return None;
        }
    }
    if group_digits.is_some_and(|n| n != 3) {
        return None;
    }
    let n: f64 = out.parse().ok()?;
    let n = if neg || neg_paren { -n } else { n };
    Some(if pct { n / 100.0 } else { n })
}

/// Days from 1899-12-30 (Excel's serial 0) to `y-m-d`; `None` when the
/// date does not exist or lies before 1900-03-01 (Excel's fictitious
/// 1900-02-29 is not produced).
pub fn date_serial(y: i32, m: u32, d: u32) -> Option<f64> {
    if !(1..=12).contains(&m) || d == 0 || !(1900..=9999).contains(&y) {
        return None;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if d > days[m as usize - 1] {
        return None;
    }
    // Days since 1970-01-01 (civil algorithm), then shift.
    let (yy, mm) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy as i32;
    let unix = era * 146_097 + doe - 719_468;
    let serial = f64::from(unix) + 25_569.0;
    // Excel's serials before 1900-03-01 count the fake leap day.
    (serial >= 61.0).then_some(serial)
}

/// A date field in `order` (`/`, `-`, `.` or space separated; two-digit
/// years 00–29 → 20xx, 30–99 → 19xx).
pub fn parse_date(s: &str, order: DateOrder) -> Option<f64> {
    let parts: Vec<&str> = s
        .trim()
        .split(['/', '-', '.', ' '])
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() != 3 {
        return None;
    }
    let n = |p: &str| p.parse::<u32>().ok();
    let (y, m, d) = match order {
        DateOrder::Mdy => (parts[2], n(parts[0])?, n(parts[1])?),
        DateOrder::Dmy => (parts[2], n(parts[1])?, n(parts[0])?),
        DateOrder::Ymd => (parts[0], n(parts[1])?, n(parts[2])?),
    };
    let year: i32 = y.parse().ok()?;
    let year = match (y.len(), year) {
        (1 | 2, 0..=29) => 2000 + year,
        (1 | 2, _) => 1900 + year,
        _ => year,
    };
    date_serial(year, m, d)
}

/// The separator a CSV sample most likely uses (`,`, `;`, tab or `|`):
/// the candidate occurring (outside quotes) the same non-zero number of
/// times on the most lines; `,` when nothing fits.
pub fn detect_separator(sample: &str) -> char {
    let candidates = [',', ';', '\t', '|'];
    let lines: Vec<&str> = lines(sample).take(20).collect();
    let mut best = (',', 0usize);
    for &c in &candidates {
        let counts: Vec<usize> = lines.iter().map(|l| count_outside_quotes(l, c)).collect();
        let first = counts.first().copied().unwrap_or(0);
        if first == 0 {
            continue;
        }
        let score = counts.iter().filter(|&&n| n == first).count() * 1000 + first;
        if score > best.1 {
            best = (c, score);
        }
    }
    best.0
}

fn count_outside_quotes(line: &str, c: char) -> usize {
    let mut inside = false;
    line.chars()
        .filter(|&x| {
            if x == '"' {
                inside = !inside;
            }
            !inside && x == c
        })
        .count()
}

/// The decimal separator numbers in the sample use: `,` when fields like
/// `1,5` or `1.234,56` appear (and the separator is not `,`), else `.`.
pub fn detect_decimal(sample: &str, separator: char) -> char {
    if separator == ',' {
        return '.';
    }
    let opts = TextImportOptions {
        split: SplitKind::by(separator),
        ..Default::default()
    };
    let (mut comma, mut dot) = (0, 0);
    for rec in split_records(sample, &opts).into_iter().take(50) {
        for f in rec {
            let f = f.trim();
            let digits_around = |sep: char| {
                f.rsplit_once(sep).is_some_and(|(a, b)| {
                    !a.is_empty()
                        && a.chars()
                            .all(|c| c.is_ascii_digit() || c == '.' || c == '-')
                        && !b.is_empty()
                        && b.chars().all(|c| c.is_ascii_digit())
                        && b.len() != 3
                })
            };
            if digits_around(',') {
                comma += 1;
            } else if digits_around('.') {
                dot += 1;
            }
        }
    }
    if comma > dot {
        ','
    } else {
        '.'
    }
}

/// A text encoding of the import wizard ("File origin").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextEncoding {
    Utf8,
    Windows1252,
    Utf16Le,
    Utf16Be,
}

/// The characters 0x80–0x9F of Windows-1252 (the rest is Latin-1).
const CP1252: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

/// Decodes `bytes` as `encoding`, or (`None`) detects it: a byte order
/// mark, else valid UTF-8, else Windows-1252. A BOM is dropped.
pub fn decode_text(bytes: &[u8], encoding: Option<TextEncoding>) -> (String, TextEncoding) {
    let detected = match encoding {
        Some(e) => e,
        None if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) => TextEncoding::Utf8,
        None if bytes.starts_with(&[0xFF, 0xFE]) => TextEncoding::Utf16Le,
        None if bytes.starts_with(&[0xFE, 0xFF]) => TextEncoding::Utf16Be,
        None if std::str::from_utf8(bytes).is_ok() => TextEncoding::Utf8,
        None => TextEncoding::Windows1252,
    };
    let text = match detected {
        TextEncoding::Utf8 => {
            let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
            String::from_utf8_lossy(b).into_owned()
        }
        TextEncoding::Windows1252 => bytes
            .iter()
            .map(|&b| match b {
                0x80..=0x9F => CP1252[(b - 0x80) as usize],
                _ => char::from(b),
            })
            .collect(),
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            let le = detected == TextEncoding::Utf16Le;
            let bom: &[u8] = if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] };
            let b = bytes.strip_prefix(bom).unwrap_or(bytes);
            let units = b.chunks_exact(2).map(|p| {
                if le {
                    u16::from_le_bytes([p[0], p[1]])
                } else {
                    u16::from_be_bytes([p[0], p[1]])
                }
            });
            char::decode_utf16(units)
                .map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER))
                .collect()
        }
    };
    (text, detected)
}

/// Save As CSV options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    /// Field separator (`,`).
    pub separator: char,
    /// Write a UTF-8 byte order mark ("CSV UTF-8").
    #[serde(default)]
    pub bom: bool,
    /// Quote every field, not only those that need it.
    #[serde(default)]
    pub quote_all: bool,
}

impl Default for CsvOptions {
    fn default() -> Self {
        CsvOptions {
            separator: ',',
            bom: true,
            quote_all: false,
        }
    }
}

/// One CSV field: quoted when it holds the separator, a quote or a line
/// break (or always with `quote_all`), quotes doubled.
pub fn csv_field(text: &str, opts: &CsvOptions) -> String {
    let needs = opts.quote_all
        || text.contains(opts.separator)
        || text.contains(['"', '\n', '\r'])
        || text.starts_with(' ')
        || text.ends_with(' ');
    if needs {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

impl Workbook {
    /// The sheet as CSV (what Excel writes: the displayed text of every
    /// cell of the used range, CRLF line ends).
    pub fn to_csv(&self, sheet: SheetId, opts: &CsvOptions) -> Vec<u8> {
        let mut out = String::new();
        if let Some((r1, c1)) = self.used_range(sheet) {
            for row in 0..=r1 {
                let fields: Vec<String> = (0..=c1)
                    .map(|col| {
                        let c = CellCoord::new(sheet, row, col);
                        match self.value(c) {
                            Value::Empty => String::new(),
                            _ => csv_field(&self.display_text(c), opts),
                        }
                    })
                    .collect();
                out.push_str(&fields.join(&opts.separator.to_string()));
                out.push_str("\r\n");
            }
        }
        let mut bytes = Vec::with_capacity(out.len() + 3);
        if opts.bom {
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        bytes.extend_from_slice(out.as_bytes());
        bytes
    }

    /// Writes imported records with their formats at `(row, col)` of
    /// `sheet` (skipped columns leave no gap). Returns the written cells.
    pub fn import_records(
        &mut self,
        sheet: SheetId,
        row: u32,
        col: u32,
        records: &[Vec<String>],
        opts: &TextImportOptions,
    ) -> Result<Vec<CellCoord>, Error> {
        let plan = import_plan(records, opts);
        let mut written = Vec::new();
        let date_style = self.intern_style(&crate::CellStyle {
            number_format: Some("m/d/yyyy".into()),
            ..Default::default()
        });
        for (dr, dc, v) in plan {
            let c = CellCoord::new(sheet, row + dr, col + dc);
            match v {
                Imported::Empty => {
                    self.clear(c)?;
                }
                Imported::Input(s) => {
                    self.set_input(c, &s)?;
                }
                Imported::Date(n) => {
                    self.set_content(c, engine_formula::CellContent::Value(Value::Number(n)))?;
                    self.set_style(c, date_style)?;
                }
            }
            written.push(c);
        }
        Ok(written)
    }
}

/// `(row offset, column offset, value)` of every imported field.
pub fn import_plan(records: &[Vec<String>], opts: &TextImportOptions) -> Vec<(u32, u32, Imported)> {
    let mut out = Vec::new();
    for (r, rec) in records.iter().enumerate() {
        let mut dc = 0u32;
        for (i, field) in rec.iter().enumerate() {
            if let Some(v) = convert_field(field, opts.format(i), opts) {
                out.push((r as u32, dc, v));
                dc += 1;
            }
        }
    }
    out
}
