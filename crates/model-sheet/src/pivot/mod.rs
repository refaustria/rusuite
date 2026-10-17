//! Pivot tables (P8-30): caches, table definitions and Excel's layout
//! rules (see `docs/pivot.md`).
//!
//! A [`PivotCache`] (workbook level, [`Workbook::pivot_caches`]) holds a
//! copy of the source data: the field names, every distinct item of
//! every field ([`CacheField::shared_items`]) and the records. A
//! [`PivotTable`] (sheet level, [`Workbook::pivots`]) arranges the
//! cache's fields on rows, columns, filters (page fields) and values.
//! [`PivotTable::compute`] lays the table out like Excel
//! ([`PivotOutput`]); the workbook writes the result into the sheet as
//! plain cells, which are read-only for direct edits
//! ([`Error::PivotCell`](crate::Error::PivotCell)). Edits of the source do
//! not update the table (as in Excel): the cache becomes
//! [`stale`](PivotCache::stale) until [`Workbook::refresh_pivot`].
//!
//! ```
//! use model_sheet::pivot::{DataField, PivotFields, PivotSource};
//! use model_sheet::{CellCoord, Workbook};
//! use engine_formula::Value;
//!
//! let mut wb = Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! for (r, row) in [["Region", "Sales"], ["East", "10"], ["West", "5"], ["East", "7"]]
//!     .iter()
//!     .enumerate()
//! {
//!     for (c, v) in row.iter().enumerate() {
//!         wb.set_input(CellCoord::new(s, r as u32, c as u32), v).unwrap();
//!     }
//! }
//! let source = PivotSource::range("Sheet1", 0, 0, 3, 1);
//! let fields = PivotFields {
//!     rows: vec![0.into()],
//!     values: vec![DataField::sum(1)],
//!     ..Default::default()
//! };
//! let (id, _) = wb.create_pivot(source, s, 0, 3, fields).unwrap();
//! // D1 "Row Labels" | E1 "Sum of Sales"; East 17, West 5, Grand Total 22.
//! assert_eq!(wb.value(CellCoord::new(s, 1, 4)), Value::Number(17.0));
//! assert_eq!(wb.value(CellCoord::new(s, 3, 4)), Value::Number(22.0));
//! assert_eq!(wb.pivot_at(CellCoord::new(s, 2, 3)).map(|p| p.id), Some(id));
//! ```
//!
//! [`Workbook::pivot_caches`]: crate::Workbook::pivot_caches
//! [`Workbook::pivots`]: crate::Workbook::pivots
//! [`Workbook::refresh_pivot`]: crate::Workbook::refresh_pivot

use std::collections::BTreeSet;

use engine_formula::{ErrorKind, Value};
use serde::{Deserialize, Serialize};

mod book;
mod compute;
#[cfg(test)]
mod tests;

pub use compute::{AxisLine, CellRole, DataEntry, LineKind, PivotCell, PivotOutput, PivotRect};

/// The cells a pivot table operation changed, with their previous content
/// and own style, in first-touch order.
#[derive(Debug, Clone, Default)]
pub struct PivotJournal {
    seen: std::collections::HashSet<engine_formula::CellCoord>,
    pub cells: Vec<(
        engine_formula::CellCoord,
        engine_formula::CellContent,
        crate::StyleId,
    )>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_true(b: &bool) -> bool {
    *b
}

// --- items ---------------------------------------------------------------------

/// A distinct value of a cache field. Text compares ignoring case (as
/// Excel groups `East` and `east`); dates are numbers (their field has a
/// date [`number_format`](CacheField::number_format)).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", content = "v", rename_all = "camelCase")]
pub enum Item {
    /// An empty source cell (shown as `(blank)`).
    Blank,
    Number(f64),
    Text(String),
    Bool(bool),
    /// An error value, as its text (`#N/A`).
    Error(String),
}

/// The identity of an [`Item`] (text folded to lower case).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum ItemKey {
    Blank,
    Number(u64),
    Text(String),
    Bool(bool),
    Error(String),
}

impl Item {
    /// The item of a source cell value (`""` and empty → [`Item::Blank`]).
    pub fn from_value(v: &Value) -> Item {
        match v {
            Value::Empty => Item::Blank,
            Value::Number(n) => Item::Number(*n),
            Value::Text(t) if t.is_empty() => Item::Blank,
            Value::Text(t) => Item::Text(t.clone()),
            Value::Bool(b) => Item::Bool(*b),
            Value::Error(e) => Item::Error(e.to_string()),
            Value::Array(_) => Item::from_value(&v.clone().into_scalar()),
        }
    }

    /// The cell value of the item.
    pub fn to_value(&self) -> Value {
        match self {
            Item::Blank => Value::Empty,
            Item::Number(n) => Value::Number(*n),
            Item::Text(t) => Value::Text(t.clone()),
            Item::Bool(b) => Value::Bool(*b),
            Item::Error(e) => Value::Error(e.parse().unwrap_or(ErrorKind::NA)),
        }
    }

    pub(crate) fn key(&self) -> ItemKey {
        match self {
            Item::Blank => ItemKey::Blank,
            // -0 and 0 are one item.
            Item::Number(n) => ItemKey::Number((*n + 0.0).to_bits()),
            Item::Text(t) => ItemKey::Text(t.to_lowercase()),
            Item::Bool(b) => ItemKey::Bool(*b),
            Item::Error(e) => ItemKey::Error(e.clone()),
        }
    }

    /// The label a pivot table shows: numbers with `number_format`,
    /// `(blank)` for a blank item.
    pub fn label(&self, number_format: Option<&str>) -> String {
        match self {
            Item::Blank => "(blank)".into(),
            Item::Text(t) => t.clone(),
            _ => crate::numfmt::display_value(&self.to_value(), number_format),
        }
    }

    /// Excel's item order for an ascending sort: numbers, text (ignoring
    /// case), booleans, errors, blank last.
    pub fn sort_cmp(&self, other: &Item) -> std::cmp::Ordering {
        fn rank(i: &Item) -> u8 {
            match i {
                Item::Number(_) => 0,
                Item::Text(_) => 1,
                Item::Bool(_) => 2,
                Item::Error(_) => 3,
                Item::Blank => 4,
            }
        }
        match (self, other) {
            (Item::Number(a), Item::Number(b)) => a.total_cmp(b),
            (Item::Text(a), Item::Text(b)) => a
                .to_lowercase()
                .cmp(&b.to_lowercase())
                .then_with(|| a.cmp(b)),
            (Item::Bool(a), Item::Bool(b)) => a.cmp(b),
            (Item::Error(a), Item::Error(b)) => a.cmp(b),
            _ => rank(self).cmp(&rank(other)),
        }
    }
}

// --- cache -----------------------------------------------------------------------

/// Where a cache reads its data: a range whose first row holds the field
/// names (Excel's `worksheetSource ref sheet`), a table or a defined name
/// (`worksheetSource name`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PivotSource {
    /// Inclusive bounds; the sheet by name (renames follow).
    Range {
        sheet: String,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    },
    /// An Excel table (refresh resolves it like a defined name; tables are
    /// not modelled yet).
    Table { name: String },
    /// A defined name for a range.
    Name { name: String },
}

impl PivotSource {
    pub fn range(sheet: &str, r0: u32, c0: u32, r1: u32, c1: u32) -> PivotSource {
        PivotSource::Range {
            sheet: sheet.to_owned(),
            r0: r0.min(r1),
            c0: c0.min(c1),
            r1: r0.max(r1),
            c1: c0.max(c1),
        }
    }
}

/// The kind of values a cache field holds (blanks aside).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    Number,
    #[default]
    Text,
    /// Numbers with a date format.
    Date,
    /// More than one kind (or booleans/errors).
    Mixed,
}

/// One column of the source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheField {
    /// The header text (unique in the cache: duplicates get `2`, `3`, …).
    pub name: String,
    /// Every distinct item in first-seen order; items that disappeared
    /// from the source are kept (Excel's "retain items deleted from the
    /// data source"), so the item indices used by pivot tables stay valid
    /// across refreshes.
    #[serde(default)]
    pub shared_items: Vec<Item>,
    #[serde(default)]
    pub kind: FieldKind,
    #[serde(default, skip_serializing_if = "is_false")]
    pub contains_blank: bool,
    /// The number format of the source cells (item labels, `Date`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

impl CacheField {
    pub fn new(name: &str) -> Self {
        CacheField {
            name: name.to_owned(),
            shared_items: Vec::new(),
            kind: FieldKind::Text,
            contains_blank: false,
            number_format: None,
        }
    }

    /// The index of `item` in [`shared_items`](Self::shared_items).
    pub fn item_index(&self, item: &Item) -> Option<u32> {
        let key = item.key();
        self.shared_items
            .iter()
            .position(|i| i.key() == key)
            .map(|i| i as u32)
    }

    /// The label of shared item `i`.
    pub fn item_label(&self, i: u32) -> String {
        self.shared_items
            .get(i as usize)
            .map_or_else(String::new, |it| it.label(self.number_format.as_deref()))
    }
}

/// Parts of a pivot table or cache the model does not support
/// (calculated fields and items, OLAP, slicers, …): the file's XML,
/// written back verbatim; such pivot tables are read-only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawPivotXml {
    /// Why the part is kept raw (shown as a warning).
    pub reason: String,
    pub xml: String,
    /// The records part of a raw cache definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records: Option<String>,
}

/// A copy of a pivot table's source data (workbook level; pivot tables
/// refer to it by [`id`](Self::id), several tables may share one).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCache {
    /// Unique in the workbook (the file's `cacheId`).
    pub id: u32,
    pub source: PivotSource,
    pub fields: Vec<CacheField>,
    /// The source rows at the last refresh, one item per field.
    #[serde(default)]
    pub records: Vec<Vec<Item>>,
    /// Refresh when the file is opened (Excel's `refreshOnLoad`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub refresh_on_load: bool,
    /// The source changed since the last refresh.
    #[serde(default, skip_serializing_if = "is_false")]
    pub stale: bool,
    /// An unsupported cache definition, kept verbatim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<RawPivotXml>,
}

impl PivotCache {
    /// The field named `name` (ignoring case).
    pub fn field_index(&self, name: &str) -> Option<u32> {
        let lower = name.to_lowercase();
        self.fields
            .iter()
            .position(|f| f.name.to_lowercase() == lower)
            .map(|i| i as u32)
    }

    /// Adds the items of the records that are missing from the shared
    /// items and recomputes kinds and blank flags (after loading).
    pub fn normalize(&mut self) {
        for (i, f) in self.fields.iter_mut().enumerate() {
            let mut seen: std::collections::HashSet<ItemKey> =
                f.shared_items.iter().map(Item::key).collect();
            let (mut num, mut text, mut other, mut blank) = (false, false, false, false);
            for rec in &self.records {
                let Some(item) = rec.get(i) else { continue };
                match item {
                    Item::Blank => blank = true,
                    Item::Number(_) => num = true,
                    Item::Text(_) => text = true,
                    _ => other = true,
                }
                if seen.insert(item.key()) {
                    f.shared_items.push(item.clone());
                }
            }
            if self.records.is_empty() {
                continue;
            }
            let date = f
                .number_format
                .as_deref()
                .is_some_and(crate::numfmt::is_date_format);
            f.kind = match (num, text, other) {
                (true, false, false) if date => FieldKind::Date,
                (true, false, false) => FieldKind::Number,
                (false, true, false) | (false, false, false) => FieldKind::Text,
                _ => FieldKind::Mixed,
            };
            f.contains_blank = blank;
        }
        let n = self.fields.len();
        for rec in &mut self.records {
            rec.resize(n, Item::Blank);
        }
    }
}

// --- table definition ----------------------------------------------------------

/// The order of an axis field's items.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SortOrder {
    /// A–Z (numbers, text, booleans, errors, blank last).
    #[default]
    Ascending,
    Descending,
    /// The listed shared items first, in this order, then the others
    /// ascending (Excel's drag-to-reorder).
    Manual {
        order: Vec<u32>,
    },
}

/// The subtotals of an axis field (shown when a field lies further in).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Subtotals {
    /// One subtotal with each data field's own function.
    #[default]
    Automatic,
    None,
    /// One subtotal line per function (always below/right of the group).
    Custom {
        functions: Vec<AggFunc>,
    },
}

/// Excel's report layouts, per row field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotLayout {
    /// The inner fields share this field's column, indented; subtotals on
    /// the item's row.
    #[default]
    Compact,
    /// The inner fields get their own column; subtotals on the item's row.
    Outline,
    /// Own columns; an item shares the row of its first inner item;
    /// subtotals in a row below the group.
    Tabular,
}

/// A field on the row or column axis.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisField {
    /// Index into [`PivotCache::fields`].
    pub field: u32,
    #[serde(default)]
    pub sort: SortOrder,
    #[serde(default)]
    pub subtotals: Subtotals,
    /// Show items without data (Excel's "Show items with no data").
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_all_items: bool,
    /// Shared items whose inner items are hidden (collapsed `−`/`+`).
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub collapsed_items: BTreeSet<u32>,
    /// Shared items filtered out (unchecked in the field's dropdown):
    /// their records count nowhere.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub hidden_items: BTreeSet<u32>,
    #[serde(default)]
    pub layout: PivotLayout,
    /// Automatic subtotals in a row below the group instead of on the
    /// item's own row (compact and outline forms; Excel's
    /// `subtotalTop="0"`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub subtotal_bottom: bool,
}

impl From<u32> for AxisField {
    fn from(field: u32) -> Self {
        AxisField {
            field,
            ..Default::default()
        }
    }
}

/// What a page field lets through.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PageSelection {
    #[default]
    All,
    /// These shared items only (one = a single item, more = "(Multiple
    /// Items)").
    Items { items: BTreeSet<u32> },
}

/// A filter (page) field above the table.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageField {
    pub field: u32,
    #[serde(default)]
    pub selected: PageSelection,
}

/// How a data field summarizes its values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AggFunc {
    #[default]
    Sum,
    /// Non-empty values (Excel's Count = `COUNTA`).
    Count,
    Average,
    Max,
    Min,
    Product,
    /// Numbers only (Excel's Count Numbers).
    CountNums,
    StdDev,
    StdDevP,
    Var,
    VarP,
}

impl AggFunc {
    /// The word of the default caption (`Sum` in `Sum of Sales`).
    pub fn caption(self) -> &'static str {
        match self {
            AggFunc::Sum => "Sum",
            AggFunc::Count | AggFunc::CountNums => "Count",
            AggFunc::Average => "Average",
            AggFunc::Max => "Max",
            AggFunc::Min => "Min",
            AggFunc::Product => "Product",
            AggFunc::StdDev => "StdDev",
            AggFunc::StdDevP => "StdDevp",
            AggFunc::Var => "Var",
            AggFunc::VarP => "Varp",
        }
    }

    /// The SpreadsheetML name (`subtotal` attribute, `t` of items).
    pub fn xml_name(self) -> &'static str {
        match self {
            AggFunc::Sum => "sum",
            AggFunc::Count => "count",
            AggFunc::Average => "average",
            AggFunc::Max => "max",
            AggFunc::Min => "min",
            AggFunc::Product => "product",
            AggFunc::CountNums => "countNums",
            AggFunc::StdDev => "stdDev",
            AggFunc::StdDevP => "stdDevp",
            AggFunc::Var => "var",
            AggFunc::VarP => "varp",
        }
    }

    pub fn from_xml_name(s: &str) -> Option<AggFunc> {
        Self::ALL.into_iter().find(|f| f.xml_name() == s)
    }

    pub const ALL: [AggFunc; 11] = [
        AggFunc::Sum,
        AggFunc::Count,
        AggFunc::Average,
        AggFunc::Max,
        AggFunc::Min,
        AggFunc::Product,
        AggFunc::CountNums,
        AggFunc::StdDev,
        AggFunc::StdDevP,
        AggFunc::Var,
        AggFunc::VarP,
    ];
}

/// The base item of [`ShowAs::DifferenceFrom`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BaseItem {
    /// A shared item of the base field.
    Item { item: u32 },
    /// The previous visible item.
    Previous,
    /// The next visible item.
    Next,
}

/// Excel's "Show Values As".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShowAs {
    #[default]
    Normal,
    /// % of Grand Total.
    PercentOfTotal,
    /// % of Row Total.
    PercentOfRow,
    /// % of Column Total.
    PercentOfColumn,
    /// % of Parent Row Total.
    PercentOfParent,
    /// Difference From an item of `base_field`.
    DifferenceFrom {
        base_field: u32,
        base_item: BaseItem,
    },
    /// Running Total In `base_field`.
    RunningTotal { base_field: u32 },
    /// Rank Largest to Smallest among the items of `base_field`.
    Rank { base_field: u32 },
}

impl ShowAs {
    /// Results are fractions (formatted `0.00%` by default).
    pub fn is_percent(self) -> bool {
        matches!(
            self,
            ShowAs::PercentOfTotal
                | ShowAs::PercentOfRow
                | ShowAs::PercentOfColumn
                | ShowAs::PercentOfParent
        )
    }
}

/// A field in the values area.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataField {
    pub field: u32,
    /// The caption; `""` = `"<Func> of <field>"`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(default)]
    pub func: AggFunc,
    #[serde(default)]
    pub show_as: ShowAs,
    /// `None` = General (`0.00%` for percentages).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

impl DataField {
    pub fn new(field: u32, func: AggFunc) -> Self {
        DataField {
            field,
            func,
            ..Default::default()
        }
    }

    pub fn sum(field: u32) -> Self {
        Self::new(field, AggFunc::Sum)
    }

    /// The caption shown in the table (`Sum of Sales`).
    pub fn caption(&self, cache: &PivotCache) -> String {
        if !self.name.is_empty() {
            return self.name.clone();
        }
        let field = cache
            .fields
            .get(self.field as usize)
            .map_or("", |f| f.name.as_str());
        format!("{} of {field}", self.func.caption())
    }

    /// The number format of the value cells.
    pub fn effective_format(&self) -> Option<String> {
        self.number_format
            .clone()
            .or_else(|| self.show_as.is_percent().then(|| "0.00%".to_owned()))
    }
}

/// On which axis several data fields are listed (the `Σ Values` field).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValuesAxis {
    Rows,
    #[default]
    Columns,
}

/// Table-wide options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PivotOptions {
    /// Excel's `rowGrandTotals`: a Grand Total *column* on the right (the
    /// total of each row), shown when a field lies on the column axis.
    #[serde(skip_serializing_if = "is_true")]
    pub grand_total_rows: bool,
    /// Excel's `colGrandTotals`: a Grand Total *row* at the bottom (the
    /// total of each column), shown when a field lies on the row axis.
    #[serde(skip_serializing_if = "is_true")]
    pub grand_total_cols: bool,
    /// Pivot style option "Row Headers" (bold row labels).
    #[serde(skip_serializing_if = "is_true")]
    pub row_headers_bold: bool,
    /// Pivot style option "Column Headers".
    #[serde(skip_serializing_if = "is_true")]
    pub col_headers_bold: bool,
    /// Banded rows.
    #[serde(skip_serializing_if = "is_false")]
    pub banded: bool,
    /// Banded columns.
    #[serde(skip_serializing_if = "is_false")]
    pub banded_cols: bool,
    /// The pivot style (`PivotStyleLight16`, Excel's default).
    pub style: String,
    /// Where `Σ Values` goes when there are several data fields.
    pub values_in: ValuesAxis,
    /// Position of `Σ Values` on its axis; `None` = last.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values_position: Option<u32>,
    /// Shown in value cells without data (`""` = empty).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub empty_as: String,
    /// Shown instead of error values; `None` = the error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_as: Option<String>,
    /// Repeat outer item labels on every row (outline/tabular).
    #[serde(skip_serializing_if = "is_false")]
    pub repeat_labels: bool,
    /// The `Row Labels` / `Column Labels` captions (compact form) and
    /// field names (outline/tabular).
    #[serde(skip_serializing_if = "is_true")]
    pub show_field_headers: bool,
    /// Indent per level of compact row labels, in characters.
    pub compact_rows_indent: u8,
}

impl Default for PivotOptions {
    fn default() -> Self {
        PivotOptions {
            grand_total_rows: true,
            grand_total_cols: true,
            row_headers_bold: true,
            col_headers_bold: true,
            banded: false,
            banded_cols: false,
            style: DEFAULT_STYLE.into(),
            values_in: ValuesAxis::Columns,
            values_position: None,
            empty_as: String::new(),
            error_as: None,
            repeat_labels: false,
            show_field_headers: true,
            compact_rows_indent: 1,
        }
    }
}

/// Excel's default pivot style.
pub const DEFAULT_STYLE: &str = "PivotStyleLight16";

/// A pivot table on a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTable {
    /// Unique in the workbook.
    pub id: u32,
    /// `PivotTable1`, … (unique in the workbook).
    pub name: String,
    pub cache_id: u32,
    /// The cells the table occupies (page fields included); the top-left
    /// cell is where it is anchored. Updated whenever it is rendered.
    pub location: PivotRect,
    #[serde(default)]
    pub rows: Vec<AxisField>,
    #[serde(default)]
    pub cols: Vec<AxisField>,
    #[serde(default)]
    pub filters: Vec<PageField>,
    #[serde(default)]
    pub values: Vec<DataField>,
    /// Filters on fields that are on no axis (set by slicers; in the
    /// file: hidden items of a `pivotField` without an axis): only the
    /// selected items pass.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_filters: Vec<PageField>,
    #[serde(default)]
    pub options: PivotOptions,
    /// An unsupported definition, kept verbatim (read-only table).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<RawPivotXml>,
}

/// The fields of a new pivot table (or of [`PivotTable::set_fields`]).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PivotFields {
    pub rows: Vec<AxisField>,
    pub cols: Vec<AxisField>,
    pub values: Vec<DataField>,
    pub filters: Vec<PageField>,
}

impl PivotTable {
    /// An empty table anchored at `(row, col)`.
    pub fn new(id: u32, name: &str, cache_id: u32, row: u32, col: u32) -> Self {
        PivotTable {
            id,
            name: name.to_owned(),
            cache_id,
            location: PivotRect::new(row, col, row, col),
            rows: Vec::new(),
            cols: Vec::new(),
            filters: Vec::new(),
            values: Vec::new(),
            field_filters: Vec::new(),
            options: PivotOptions::default(),
            raw: None,
        }
    }

    pub fn set_fields(&mut self, f: PivotFields) {
        self.rows = f.rows;
        self.cols = f.cols;
        self.values = f.values;
        self.filters = f.filters;
    }

    /// The anchor (top-left cell).
    pub fn anchor(&self) -> (u32, u32) {
        (self.location.r0, self.location.c0)
    }

    /// The axis field of cache field `field` on rows or columns.
    pub fn axis_field(&self, field: u32) -> Option<&AxisField> {
        self.rows
            .iter()
            .chain(&self.cols)
            .find(|a| a.field == field)
    }

    pub fn axis_field_mut(&mut self, field: u32) -> Option<&mut AxisField> {
        self.rows
            .iter_mut()
            .chain(self.cols.iter_mut())
            .find(|a| a.field == field)
    }

    /// Checks the definition against `cache`: fields exist, a field is on
    /// at most one of rows/columns/filters, base fields exist.
    pub fn validate(&self, cache: &PivotCache) -> Result<(), crate::Error> {
        let n = cache.fields.len() as u32;
        let bad = |m: String| Err(crate::Error::InvalidPivot(m));
        let mut used = BTreeSet::new();
        for f in self
            .rows
            .iter()
            .map(|a| a.field)
            .chain(self.cols.iter().map(|a| a.field))
            .chain(self.filters.iter().map(|p| p.field))
        {
            if f >= n {
                return bad(format!("no field {f}"));
            }
            if !used.insert(f) {
                return bad(format!("field {f} is used twice"));
            }
        }
        for f in &self.field_filters {
            if f.field >= n {
                return bad(format!("no field {}", f.field));
            }
        }
        for d in &self.values {
            if d.field >= n {
                return bad(format!("no field {}", d.field));
            }
            if let ShowAs::DifferenceFrom { base_field, .. }
            | ShowAs::RunningTotal { base_field }
            | ShowAs::Rank { base_field } = d.show_as
            {
                if base_field >= n {
                    return bad(format!("no base field {base_field}"));
                }
            }
        }
        if self.name.trim().is_empty() {
            return bad("empty name".into());
        }
        Ok(())
    }

    /// The shared items of `field` in display order (all of them, hidden
    /// ones included), per the axis field's sort.
    pub fn item_order(&self, cache: &PivotCache, field: u32) -> Vec<u32> {
        let Some(cf) = cache.fields.get(field as usize) else {
            return Vec::new();
        };
        let sort = self
            .axis_field(field)
            .map_or(SortOrder::Ascending, |a| a.sort.clone());
        let mut all: Vec<u32> = (0..cf.shared_items.len() as u32).collect();
        let cmp =
            |a: &u32, b: &u32| cf.shared_items[*a as usize].sort_cmp(&cf.shared_items[*b as usize]);
        match sort {
            SortOrder::Ascending => all.sort_by(cmp),
            SortOrder::Descending => {
                all.sort_by(cmp);
                // Blank stays last, as in Excel.
                let blank = all
                    .iter()
                    .position(|&i| cf.shared_items[i as usize] == Item::Blank);
                let b = blank.map(|p| all.remove(p));
                all.reverse();
                all.extend(b);
            }
            SortOrder::Manual { order } => {
                all.sort_by(cmp);
                let mut out: Vec<u32> = Vec::new();
                for i in order {
                    if (i as usize) < cf.shared_items.len() && !out.contains(&i) {
                        out.push(i);
                    }
                }
                let rest: Vec<u32> = all.into_iter().filter(|i| !out.contains(i)).collect();
                out.extend(rest);
                all = out;
            }
        }
        all
    }
}
