//! Excel tables in formulas: structured references (`Table1[Sales]`,
//! `[@Qty]`, `Table1[[#Headers],[Q1]:[Q3]]`).
//!
//! The parser turns a reference into an [`Expr::Structured`] holding a
//! [`StructRef`]; the document model registers its tables with the engine
//! ([`Engine::set_tables`](crate::Engine::set_tables)) as [`TableDef`]s,
//! and [`TableDef::resolve`] turns a reference into the cells it means at
//! the formula's cell. Table names are workbook-wide and resolve before
//! defined names (`=SUM(Table1)` is the table's data).
//!
//! Printing (`Display`) uses Excel's display form: `[@Qty]` for "this
//! row", inner brackets only where a column name needs them
//! (`[@[Unit Price]]`). The file form (`Table1[[#This Row],[Qty]]`,
//! always qualified) is [`StructRef::file_form`].

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::ast::ErrorKind;
use crate::eval::{CellCoord, RangeRef, SheetId};
use crate::parser::ParseError;

/// A special item specifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TableItem {
    /// `[#All]`: header, data and totals.
    All,
    /// `[#Headers]`.
    Headers,
    /// `[#Data]` (the default).
    Data,
    /// `[#Totals]`.
    Totals,
    /// `[#This Row]` / `@`: the formula's row of the data.
    ThisRow,
}

impl TableItem {
    pub const ALL: [TableItem; 5] = [
        TableItem::All,
        TableItem::Headers,
        TableItem::Data,
        TableItem::Totals,
        TableItem::ThisRow,
    ];

    /// The keyword as Excel writes it (`#This Row`).
    pub fn keyword(self) -> &'static str {
        match self {
            TableItem::All => "#All",
            TableItem::Headers => "#Headers",
            TableItem::Data => "#Data",
            TableItem::Totals => "#Totals",
            TableItem::ThisRow => "#This Row",
        }
    }

    fn from_keyword(s: &str) -> Option<TableItem> {
        let norm: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
        Self::ALL
            .into_iter()
            .find(|k| k.keyword().eq_ignore_ascii_case(&norm))
    }
}

/// A structured reference.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StructRef {
    /// The table (as written); `None` = the table holding the formula.
    pub table: Option<String>,
    /// Special items in [`TableItem`] order, without duplicates; empty =
    /// the data rows.
    pub items: Vec<TableItem>,
    /// One column (`first`, `None`) or a column range (`[Q1]:[Q3]`);
    /// `None` = every column.
    pub columns: Option<(String, Option<String>)>,
    /// Printed in the file form: `[#This Row]` instead of `@`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub keyword_form: bool,
}

impl StructRef {
    /// `Table1[Column]`.
    pub fn column(table: Option<&str>, column: &str) -> Self {
        StructRef {
            table: table.map(str::to_string),
            items: Vec::new(),
            columns: Some((column.to_string(), None)),
            keyword_form: false,
        }
    }

    /// Whether the reference means the formula's own row (`@`).
    pub fn is_this_row(&self) -> bool {
        self.items.contains(&TableItem::ThisRow)
    }

    /// The file form: qualified with `table` when unqualified, `#This
    /// Row` as a keyword.
    pub fn file_form(&self, table: Option<&str>) -> StructRef {
        StructRef {
            table: self.table.clone().or_else(|| table.map(str::to_string)),
            keyword_form: true,
            ..self.clone()
        }
    }

    /// The display form (`@`).
    pub fn display_form(&self) -> StructRef {
        StructRef {
            keyword_form: false,
            ..self.clone()
        }
    }

    fn normalize(&mut self) {
        self.items.sort_unstable();
        self.items.dedup();
        if self.items.contains(&TableItem::All) {
            self.items = vec![TableItem::All];
        }
    }

    /// Parses the bracket part (`[...]`, outer brackets included) after
    /// an optional table name. `pos` is the bracket's byte offset (for
    /// errors).
    pub fn parse(table: Option<&str>, body: &str, pos: usize) -> Result<StructRef, ParseError> {
        let err = |m: &str| ParseError::new(pos, format!("invalid structured reference: {m}"));
        let inner = body
            .strip_prefix('[')
            .and_then(|b| b.strip_suffix(']'))
            .ok_or_else(|| err("expected `[...]`"))?;
        let mut out = StructRef {
            table: table.map(str::to_string),
            items: Vec::new(),
            columns: None,
            keyword_form: false,
        };
        let trimmed = inner.trim();
        if trimmed.is_empty() {
            return Ok(out);
        }
        if let Some(rest) = trimmed.strip_prefix('@') {
            // `[@]`, `[@Col]`, `[@[Col]]`, `[@[A]:[B]]`.
            out.items.push(TableItem::ThisRow);
            let rest = rest.trim();
            if rest.is_empty() {
                return Ok(out);
            }
            if rest.starts_with('[') {
                let parts = split_parts(rest).ok_or_else(|| err("unbalanced brackets"))?;
                out.columns = Some(column_spec(&parts).ok_or_else(|| err("bad column"))?);
            } else {
                out.columns = Some((unescape(rest), None));
            }
            return Ok(out);
        }
        if !trimmed.starts_with('[') {
            // `[#Totals]` or `[Column]`.
            if trimmed.starts_with('#') {
                let item = TableItem::from_keyword(trimmed).ok_or_else(|| err("unknown item"))?;
                out.items.push(item);
            } else {
                out.columns = Some((unescape(inner), None));
            }
            return Ok(out);
        }
        // A list of `[#Item]`s and `[Column]`s, the last ones possibly a
        // range `[A]:[B]`.
        let parts = split_parts(trimmed).ok_or_else(|| err("unbalanced brackets"))?;
        let mut cols: Vec<Part> = Vec::new();
        for p in parts {
            match &p {
                Part::Name(n) if n.trim_start().starts_with('#') => {
                    if !cols.is_empty() {
                        return Err(err("items must come before columns"));
                    }
                    let item =
                        TableItem::from_keyword(n.trim()).ok_or_else(|| err("unknown item"))?;
                    out.items.push(item);
                }
                _ => cols.push(p),
            }
        }
        if !cols.is_empty() {
            out.columns = Some(column_spec(&cols).ok_or_else(|| err("bad column"))?);
        }
        if out.items.contains(&TableItem::ThisRow) && out.items.len() > 1 {
            return Err(err("#This Row cannot be combined"));
        }
        out.normalize();
        Ok(out)
    }
}

/// One element of a bracket list: `[name]`, a `,` or a `:`.
#[derive(Debug, Clone, PartialEq)]
enum Part {
    Name(String),
    Colon,
}

/// Splits `[a],[b]:[c]` into names and colons (commas dropped).
fn split_parts(s: &str) -> Option<Vec<Part>> {
    let mut out = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '[' => {
                let mut name = String::new();
                loop {
                    match chars.next()? {
                        '\'' => name.push(chars.next()?),
                        ']' => break,
                        '[' => return None,
                        c => name.push(c),
                    }
                }
                out.push(Part::Name(name));
            }
            ':' => out.push(Part::Colon),
            ',' => {}
            c if c.is_whitespace() => {}
            _ => return None,
        }
    }
    Some(out)
}

/// `[A]` or `[A]:[B]`.
fn column_spec(parts: &[Part]) -> Option<(String, Option<String>)> {
    match parts {
        [Part::Name(a)] if !a.starts_with('#') => Some((a.clone(), None)),
        [Part::Name(a), Part::Colon, Part::Name(b)]
            if !a.starts_with('#') && !b.starts_with('#') =>
        {
            Some((a.clone(), Some(b.clone())))
        }
        _ => None,
    }
}

/// Removes the `'` escapes of a column name written without inner
/// brackets.
fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\'' {
            if let Some(n) = chars.next() {
                out.push(n);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// A column name with `[`, `]`, `#` and `'` escaped by `'`.
fn escape(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if matches!(c, '[' | ']' | '#' | '\'') {
            out.push('\'');
        }
        out.push(c);
    }
    out
}

/// Whether a column name needs inner brackets after `@` or on its own.
fn needs_brackets(name: &str) -> bool {
    name.is_empty()
        || name
            .chars()
            .any(|c| !(c.is_alphanumeric() || c == '_' || c == '.' || c == '\\' || c == '?'))
        || name.starts_with(|c: char| c.is_ascii_digit())
}

impl fmt::Display for StructRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(t) = &self.table {
            f.write_str(t)?;
        }
        let col = |c: &str| format!("[{}]", escape(c));
        let cols = self.columns.as_ref().map(|(a, b)| match b {
            Some(b) => format!("{}:{}", col(a), col(b)),
            None => col(a),
        });
        if self.is_this_row() && !self.keyword_form {
            f.write_str("[@")?;
            match &self.columns {
                None => {}
                Some((a, None)) if !needs_brackets(a) => f.write_str(&escape(a))?,
                Some(_) => f.write_str(cols.as_deref().unwrap_or_default())?,
            }
            return f.write_str("]");
        }
        let items: Vec<String> = self
            .items
            .iter()
            .map(|i| format!("[{}]", i.keyword()))
            .collect();
        match (items.len(), &self.columns) {
            (0, None) => f.write_str("[]"),
            (0, Some((a, None))) => write!(f, "[{}]", escape(a)),
            (1, None) => write!(f, "[{}]", self.items[0].keyword()),
            _ => {
                let mut parts = items;
                parts.extend(cols);
                write!(f, "[{}]", parts.join(","))
            }
        }
    }
}

/// A table as formulas see it: its range (header and totals rows
/// included) and column names in order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableDef {
    pub name: String,
    pub sheet: SheetId,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    pub header: bool,
    pub totals: bool,
    /// One per column `c0..=c1`.
    pub columns: Vec<String>,
}

impl TableDef {
    /// First and last data row (`None` when the table has none).
    pub fn data_rows(&self) -> Option<(u32, u32)> {
        let a = self.r0 + u32::from(self.header);
        let b = self.r1.checked_sub(u32::from(self.totals))?;
        (a <= b).then_some((a, b))
    }

    pub fn contains(&self, c: CellCoord) -> bool {
        c.sheet == self.sheet
            && (self.r0..=self.r1).contains(&c.row)
            && (self.c0..=self.c1).contains(&c.col)
    }

    /// The absolute column of `name` (case-insensitive).
    pub fn column_index(&self, name: &str) -> Option<u32> {
        let lower = name.to_lowercase();
        self.columns
            .iter()
            .position(|c| c.to_lowercase() == lower)
            .map(|i| self.c0 + i as u32)
    }

    /// The cells `s` means in a formula at `at` (`#REF!` for an unknown
    /// column or a missing header/totals row, `#VALUE!` for "this row"
    /// outside the data rows).
    pub fn resolve(&self, s: &StructRef, at: CellCoord) -> Result<RangeRef, ErrorKind> {
        let (c0, c1) = match &s.columns {
            None => (self.c0, self.c1),
            Some((a, b)) => {
                let a = self.column_index(a).ok_or(ErrorKind::Ref)?;
                let b = match b {
                    Some(b) => self.column_index(b).ok_or(ErrorKind::Ref)?,
                    None => a,
                };
                (a.min(b), a.max(b))
            }
        };
        let range = |r0: u32, r1: u32| RangeRef::new(self.sheet, r0, c0, r1, c1);
        if s.is_this_row() {
            let (d0, d1) = self.data_rows().ok_or(ErrorKind::Value)?;
            if at.sheet != self.sheet || !(d0..=d1).contains(&at.row) {
                return Err(ErrorKind::Value);
            }
            return Ok(range(at.row, at.row));
        }
        if s.items.contains(&TableItem::All) {
            return Ok(range(self.r0, self.r1));
        }
        let has = |i| s.items.contains(&i);
        let data = s.items.is_empty() || has(TableItem::Data);
        let header = has(TableItem::Headers);
        let totals = has(TableItem::Totals);
        if (header && !self.header) || (totals && !self.totals) {
            return Err(ErrorKind::Ref);
        }
        if header && totals && !data {
            return Err(ErrorKind::Ref);
        }
        let data_rows = self.data_rows();
        let top = if header {
            self.r0
        } else if data {
            data_rows.ok_or(ErrorKind::Ref)?.0
        } else {
            self.r1
        };
        let bottom = if totals {
            self.r1
        } else if data {
            data_rows.ok_or(ErrorKind::Ref)?.1
        } else {
            self.r0
        };
        Ok(range(top, bottom))
    }
}

/// The table `s` refers to from `at` among `tables`.
pub fn table_for<'a>(tables: &'a [TableDef], s: &StructRef, at: CellCoord) -> Option<&'a TableDef> {
    match &s.table {
        Some(name) => find_table(tables, name),
        None => tables.iter().find(|t| t.contains(at)),
    }
}

/// The table named `name` (case-insensitive).
pub fn find_table<'a>(tables: &'a [TableDef], name: &str) -> Option<&'a TableDef> {
    let lower = name.to_lowercase();
    tables.iter().find(|t| t.name.to_lowercase() == lower)
}
