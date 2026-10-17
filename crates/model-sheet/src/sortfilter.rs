//! Sorting and AutoFilter (Excel's Data ▸ Sort and Data ▸ Filter).
//!
//! # Sort
//!
//! [`Workbook::sort_range`] reorders the rows of a range by one or more
//! [`SortKey`]s, stably, in Excel's order: numbers < text < logical <
//! errors, and blank cells last in both directions (descending reverses
//! everything but the blanks). Text compares case-insensitively; with
//! `case_sensitive`, lowercase sorts before uppercase among otherwise
//! equal texts. Contents and own cell styles move row-wise; row heights,
//! row styles and hidden rows stay where they are, and hidden rows are not
//! moved (as in Excel). A moved formula is adjusted like a copy by its row
//! offset (relative references follow the row, `$` parts stay), so
//! `=A2*B2` stays `=A{own row}*B{own row}`; references from outside the
//! range into it are not adjusted. A range intersecting a merged range is
//! rejected ([`Error::CannotSortMerged`]). The last sort is kept as the
//! sheet's [`SortState`] (written to `.xlsx` as `<sortState>`).
//!
//! # AutoFilter
//!
//! A sheet has at most one [`AutoFilter`]: a range whose first row is the
//! header and whose other rows are filtered by the [`FilterColumn`]s.
//! [`Workbook::apply_auto_filter`] hides every data row failing a column
//! filter (`RowInfo { hidden: true, filtered: true }`) and shows the
//! filtered rows that match again; rows hidden by hand are left alone.
//! Filters are not re-applied on edits (Excel re-applies on "Reapply").

use std::cmp::Ordering;

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::functions::math::criteria::wildcard_match;
use engine_formula::value::{format_general, parse_number_text};
use engine_formula::{offset_relative, CellContent, CellCoord, Recalc, SheetId, Value};
use serde::{Deserialize, Serialize};

use crate::numfmt::display_value;
use crate::sheet::RowInfo;
use crate::style::StyleId;
use crate::workbook::Workbook;
use crate::{CellRange, Error};

fn is_false(b: &bool) -> bool {
    !*b
}

// --- types ---------------------------------------------------------------------

/// How a sort key compares its cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortKind {
    /// By value type (Excel's default).
    #[default]
    Auto,
    /// Text that looks like a number sorts as that number.
    Numbers,
    /// Numbers sort as their General-format text.
    Text,
}

/// One level of a sort: the column (absolute index) and its direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortKey {
    pub col: u32,
    pub ascending: bool,
    #[serde(default, skip_serializing_if = "is_auto")]
    pub kind: SortKind,
}

fn is_auto(k: &SortKind) -> bool {
    *k == SortKind::Auto
}

/// The last sort of a sheet: the sorted rows (header excluded) and keys.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortState {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    pub keys: Vec<SortKey>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub case_sensitive: bool,
}

/// The operator of a custom filter [`Criterion`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
    Contains,
    NotContains,
    BeginsWith,
    EndsWith,
}

/// One condition of a custom filter. `value` is compared numerically
/// with number cells when it is a number, else with the cell's displayed
/// text (case-insensitive; `Eq`/`Ne` accept the wildcards `*`, `?`, `~`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Criterion {
    pub op: FilterOp,
    pub value: String,
}

/// The date/average filters (Excel's dynamic filters).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DynamicFilter {
    AboveAverage,
    BelowAverage,
    Today,
    Yesterday,
    Tomorrow,
}

/// The filter of one column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Filter {
    /// Rows whose displayed text equals one of `values`
    /// (case-insensitive); `""` selects blank cells.
    Values {
        values: Vec<String>,
    },
    /// One or two (or more) conditions, all (`and`) or any of them.
    Custom {
        criteria: Vec<Criterion>,
        #[serde(default)]
        and: bool,
    },
    /// The `value` largest (`top`) or smallest numbers, or `value` percent
    /// of them; ties are included.
    Top10 {
        top: bool,
        percent: bool,
        value: f64,
    },
    Dynamic {
        filter: DynamicFilter,
    },
}

/// A filtered column: `col` is the absolute column index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumn {
    pub col: u32,
    pub filter: Filter,
}

/// A sheet's AutoFilter: the range (header row first) and the filtered
/// columns, sorted by column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFilter {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<FilterColumn>,
}

impl AutoFilter {
    pub fn new(r0: u32, c0: u32, r1: u32, c1: u32) -> Self {
        AutoFilter {
            r0,
            c0,
            r1,
            c1,
            columns: Vec::new(),
        }
    }

    /// The filter of column `col`, if any.
    pub fn column(&self, col: u32) -> Option<&Filter> {
        self.columns
            .iter()
            .find(|c| c.col == col)
            .map(|c| &c.filter)
    }

    pub fn contains_col(&self, col: u32) -> bool {
        (self.c0..=self.c1).contains(&col)
    }

    pub(crate) fn is_valid(&self) -> bool {
        self.r0 <= self.r1
            && self.c0 <= self.c1
            && self.r1 <= MAX_ROW
            && self.c1 <= MAX_COL
            && self.columns.iter().all(|c| self.contains_col(c.col))
    }
}

/// One entry of [`Workbook::filter_values`]: a displayed text (`""` for
/// blanks) and how many rows show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterValue {
    pub display: String,
    pub count: u32,
}

// --- sort order ------------------------------------------------------------------

/// Excel's sort classes; blanks are handled separately.
#[derive(Debug, Clone, PartialEq)]
enum SortValue {
    Number(f64),
    Text(String),
    Bool(bool),
    Error,
    Blank,
}

impl SortValue {
    fn of(v: &Value, kind: SortKind) -> SortValue {
        match v.clone().into_scalar() {
            Value::Empty => SortValue::Blank,
            Value::Number(n) if kind == SortKind::Text => SortValue::Text(format_general(n)),
            Value::Number(n) => SortValue::Number(n),
            Value::Text(t) if kind == SortKind::Numbers => match parse_number_text(&t) {
                Some(n) => SortValue::Number(n),
                None => SortValue::Text(t),
            },
            Value::Text(t) => SortValue::Text(t),
            Value::Bool(b) => SortValue::Bool(b),
            _ => SortValue::Error,
        }
    }

    fn class(&self) -> u8 {
        match self {
            SortValue::Number(_) => 0,
            SortValue::Text(_) => 1,
            SortValue::Bool(_) => 2,
            SortValue::Error => 3,
            SortValue::Blank => 4,
        }
    }
}

/// Case-insensitive text order; with `case_sensitive`, ties are broken
/// with lowercase before uppercase (Excel's case-sensitive sort).
fn compare_text(a: &str, b: &str, case_sensitive: bool) -> Ordering {
    let fold = |s: &str| s.chars().flat_map(char::to_lowercase).collect::<String>();
    fold(a).cmp(&fold(b)).then_with(|| {
        if !case_sensitive {
            return Ordering::Equal;
        }
        for (x, y) in a.chars().zip(b.chars()) {
            match (
                x.is_lowercase() && y.is_uppercase(),
                x.is_uppercase() && y.is_lowercase(),
            ) {
                (true, _) => return Ordering::Less,
                (_, true) => return Ordering::Greater,
                _ => {}
            }
        }
        Ordering::Equal
    })
}

/// Excel's order of two cells for one key (blanks last either way).
fn compare_for_sort(
    a: &SortValue,
    b: &SortValue,
    ascending: bool,
    case_sensitive: bool,
) -> Ordering {
    match (a, b) {
        (SortValue::Blank, SortValue::Blank) => return Ordering::Equal,
        (SortValue::Blank, _) => return Ordering::Greater,
        (_, SortValue::Blank) => return Ordering::Less,
        _ => {}
    }
    let ord = match (a, b) {
        (SortValue::Number(x), SortValue::Number(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (SortValue::Text(x), SortValue::Text(y)) => compare_text(x, y, case_sensitive),
        (SortValue::Bool(x), SortValue::Bool(y)) => x.cmp(y),
        _ => a.class().cmp(&b.class()),
    };
    if ascending {
        ord
    } else {
        ord.reverse()
    }
}

/// The stable sort permutation of `rows` (each a list of key values):
/// `result[i]` is the index of the row that goes to position `i`.
pub fn sort_order(rows: &[Vec<Value>], keys: &[SortKey], case_sensitive: bool) -> Vec<usize> {
    let prepared: Vec<Vec<SortValue>> = rows
        .iter()
        .map(|vals| {
            keys.iter()
                .zip(vals)
                .map(|(k, v)| SortValue::of(v, k.kind))
                .collect()
        })
        .collect();
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_by(|&i, &j| {
        keys.iter()
            .enumerate()
            .map(|(n, k)| {
                compare_for_sort(
                    &prepared[i][n],
                    &prepared[j][n],
                    k.ascending,
                    case_sensitive,
                )
            })
            .find(|o| o.is_ne())
            .unwrap_or(Ordering::Equal)
    });
    order
}

// --- filter matching -------------------------------------------------------------

/// A column filter prepared against the column's values.
enum Matcher<'f> {
    Values(Vec<String>),
    Custom(&'f [Criterion], bool),
    /// Numbers `>= threshold` (top) or `<= threshold`; `None` = none match.
    Threshold(Option<f64>, bool),
    Average(f64, bool),
    Day(f64),
}

fn fold(s: &str) -> String {
    s.chars().flat_map(char::to_lowercase).collect()
}

impl<'f> Matcher<'f> {
    fn new(filter: &'f Filter, numbers: &[f64], today: f64) -> Self {
        match filter {
            Filter::Values { values } => Matcher::Values(values.iter().map(|v| fold(v)).collect()),
            Filter::Custom { criteria, and } => Matcher::Custom(criteria, *and),
            Filter::Top10 {
                top,
                percent,
                value,
            } => {
                let mut sorted = numbers.to_vec();
                sorted.sort_by(|a, b| {
                    let o = a.partial_cmp(b).unwrap_or(Ordering::Equal);
                    if *top {
                        o.reverse()
                    } else {
                        o
                    }
                });
                let n = if *percent {
                    ((sorted.len() as f64) * value / 100.0).floor().max(1.0)
                } else {
                    value.floor()
                };
                let k = if n.is_finite() && n >= 1.0 {
                    (n as usize).min(sorted.len())
                } else {
                    0
                };
                Matcher::Threshold(k.checked_sub(1).map(|i| sorted[i]), *top)
            }
            Filter::Dynamic { filter } => match filter {
                DynamicFilter::AboveAverage | DynamicFilter::BelowAverage => {
                    let avg = if numbers.is_empty() {
                        f64::NAN
                    } else {
                        numbers.iter().sum::<f64>() / numbers.len() as f64
                    };
                    Matcher::Average(avg, *filter == DynamicFilter::AboveAverage)
                }
                DynamicFilter::Today => Matcher::Day(today.floor()),
                DynamicFilter::Yesterday => Matcher::Day(today.floor() - 1.0),
                DynamicFilter::Tomorrow => Matcher::Day(today.floor() + 1.0),
            },
        }
    }

    fn matches(&self, value: &Value, display: &str) -> bool {
        let num = match value {
            Value::Number(n) => Some(*n),
            _ => None,
        };
        match self {
            Matcher::Values(list) => {
                let d = if matches!(value, Value::Empty) {
                    String::new()
                } else {
                    fold(display)
                };
                list.contains(&d)
            }
            Matcher::Custom(criteria, and) => {
                let mut hits = criteria
                    .iter()
                    .map(|c| criterion_matches(c, value, display));
                if criteria.is_empty() {
                    true
                } else if *and {
                    hits.all(|h| h)
                } else {
                    hits.any(|h| h)
                }
            }
            Matcher::Threshold(t, top) => match (num, t) {
                (Some(n), Some(t)) => {
                    if *top {
                        n >= *t
                    } else {
                        n <= *t
                    }
                }
                _ => false,
            },
            Matcher::Average(avg, above) => {
                num.is_some_and(|n| if *above { n > *avg } else { n < *avg })
            }
            Matcher::Day(d) => num.is_some_and(|n| n.floor() == *d),
        }
    }
}

/// Whether a cell satisfies one custom criterion.
pub fn criterion_matches(c: &Criterion, value: &Value, display: &str) -> bool {
    let blank = matches!(value, Value::Empty);
    let text = if blank { "" } else { display };
    let wild = |pattern: String| wildcard_match(&pattern, text);
    // `~` escapes the wildcards in a literal for the contains family.
    let lit = || {
        c.value
            .chars()
            .flat_map(|ch| match ch {
                '*' | '?' | '~' => vec!['~', ch],
                _ => vec![ch],
            })
            .collect::<String>()
    };
    match c.op {
        FilterOp::Contains => !blank && wild(format!("*{}*", lit())),
        FilterOp::NotContains => blank || !wild(format!("*{}*", lit())),
        FilterOp::BeginsWith => !blank && wild(format!("{}*", lit())),
        FilterOp::EndsWith => !blank && wild(format!("*{}", lit())),
        op => {
            let ord = if let Some(x) = parse_number_text(&c.value) {
                match value {
                    Value::Number(n) => n.partial_cmp(&x),
                    _ => None,
                }
            } else {
                match value {
                    Value::Text(_) => Some(fold(text).cmp(&fold(&c.value))),
                    _ => None,
                }
            };
            match op {
                FilterOp::Eq => match parse_number_text(&c.value) {
                    Some(_) => ord == Some(Ordering::Equal),
                    None => wild(c.value.clone()),
                },
                FilterOp::Ne => match parse_number_text(&c.value) {
                    Some(_) => ord != Some(Ordering::Equal),
                    None => !wild(c.value.clone()),
                },
                FilterOp::Gt => ord == Some(Ordering::Greater),
                FilterOp::Ge => matches!(ord, Some(Ordering::Greater | Ordering::Equal)),
                FilterOp::Lt => ord == Some(Ordering::Less),
                _ => matches!(ord, Some(Ordering::Less | Ordering::Equal)),
            }
        }
    }
}

// --- workbook operations ---------------------------------------------------------

/// The sort of [`Workbook::sort_range`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SortSpec {
    pub keys: Vec<SortKey>,
    /// The first row of the range is a header and stays in place.
    pub has_header: bool,
    pub case_sensitive: bool,
}

/// What a filter operation changed.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FilterChange {
    /// Rows whose hidden/filtered state changed, ascending.
    pub rows: Vec<u32>,
    /// The re-evaluated `SUBTOTAL`s.
    pub recalc: Recalc,
}

impl Workbook {
    /// The displayed text of a cell (its value in its number format).
    pub fn display_text(&self, c: CellCoord) -> String {
        let format = self.style(c).number_format.as_deref();
        display_value(&self.value(c), format)
    }

    // --- sort ---------------------------------------------------------------

    /// The last sort of `sheet`.
    pub fn sort_state(&self, sheet: SheetId) -> Option<&SortState> {
        self.sheet_data(sheet).sort_state.as_ref()
    }

    /// Replaces the sort state (loading files, undo); rows are untouched.
    pub fn set_sort_state(
        &mut self,
        sheet: SheetId,
        state: Option<SortState>,
    ) -> Result<(), Error> {
        if let Some(s) = &state {
            let ok = s.r0 <= s.r1
                && s.c0 <= s.c1
                && s.r1 <= MAX_ROW
                && s.c1 <= MAX_COL
                && s.keys.iter().all(|k| (s.c0..=s.c1).contains(&k.col));
            if !ok {
                return Err(Error::InvalidRange);
            }
        }
        self.sheet_data_mut(sheet)?.sort_state = state;
        Ok(())
    }

    /// Sorts the rows of `range` (see the module docs). Rows below the
    /// used range are blank and stay put. Returns the recalculation; every
    /// cell of the range may have changed.
    pub fn sort_range(&mut self, range: CellRange, spec: &SortSpec) -> Result<Recalc, Error> {
        let sheet = range.sheet;
        if range.r0 > range.r1 || range.c0 > range.c1 || range.r1 > MAX_ROW || range.c1 > MAX_COL {
            return Err(Error::InvalidRange);
        }
        if spec.keys.is_empty()
            || spec
                .keys
                .iter()
                .any(|k| !(range.c0..=range.c1).contains(&k.col))
        {
            return Err(Error::InvalidRange);
        }
        self.sheet_data_mut(sheet)?;
        let rect = crate::MergeRect::new(range.r0, range.c0, range.r1, range.c1);
        if self.merges(sheet).iter().any(|m| m.intersects(&rect)) {
            return Err(Error::CannotSortMerged);
        }
        let first = range.r0 + u32::from(spec.has_header);
        let state = SortState {
            r0: first.min(range.r1),
            c0: range.c0,
            r1: range.r1,
            c1: range.c1,
            keys: spec.keys.clone(),
            case_sensitive: spec.case_sensitive,
        };
        let Some((used_row, used_col)) = self.used_range(sheet) else {
            self.sheet_data_mut(sheet)?.sort_state = Some(state);
            return Ok(Recalc::default());
        };
        let last = range.r1.min(used_row);
        let rows: Vec<u32> = if first > last {
            Vec::new()
        } else {
            (first..=last)
                .filter(|&r| !self.row_info(sheet, r).hidden)
                .collect()
        };
        let keyed: Vec<Vec<Value>> = rows
            .iter()
            .map(|&r| {
                spec.keys
                    .iter()
                    .map(|k| self.value(CellCoord::new(sheet, r, k.col)))
                    .collect()
            })
            .collect();
        let order = sort_order(&keyed, &spec.keys, spec.case_sensitive);
        let c1 = range.c1.min(used_col);
        // Read every moved row first: targets overlap sources.
        let mut moves: Vec<(CellCoord, CellContent, StyleId)> = Vec::new();
        for (to, &from) in rows.iter().zip(order.iter().map(|&i| &rows[i])) {
            if *to == from || range.c0 > c1 {
                continue;
            }
            let d = i64::from(*to) - i64::from(from);
            for col in range.c0..=c1 {
                let src = CellCoord::new(sheet, from, col);
                let content = match self.content(src) {
                    CellContent::Formula { ast, .. } => {
                        let ast = offset_relative(ast, d, 0);
                        CellContent::Formula {
                            text: format!("={ast}"),
                            ast,
                        }
                    }
                    other => other.clone(),
                };
                moves.push((
                    CellCoord::new(sheet, *to, col),
                    content,
                    self.cell_style_id(src),
                ));
            }
        }
        self.begin_batch();
        let result = moves.into_iter().try_for_each(|(at, content, style)| {
            self.set_content(at, content)?;
            self.sheet_data_mut(sheet)?
                .set_cell_style(at.row, at.col, style);
            Ok::<_, Error>(())
        });
        let recalc = self.end_batch();
        result?;
        let row_moves: Vec<(u32, u32)> = rows
            .iter()
            .zip(order.iter().map(|&i| rows[i]))
            .filter(|(to, from)| **to != *from)
            .map(|(to, from)| (from, *to))
            .collect();
        self.permute_annotation_rows(sheet, (range.c0, range.c1), &row_moves);
        self.permute_rule_lines(sheet, false, (range.c0, range.c1), &row_moves);
        self.sheet_data_mut(sheet)?.sort_state = Some(state);
        Ok(recalc)
    }

    /// Excel's "current region" around a cell: the smallest rectangle
    /// containing it that is bordered by empty rows and columns (cells
    /// touching it diagonally count). A lone empty cell is its own region.
    pub fn current_region(&self, sheet: SheetId, row: u32, col: u32) -> CellRange {
        let filled = |r: u32, c: u32| {
            !matches!(
                self.content(CellCoord::new(sheet, r, c)),
                CellContent::Empty
            )
        };
        let (mut r0, mut c0, mut r1, mut c1) = (row, col, row, col);
        let Some((used_row, used_col)) = self.engine().used_range(sheet) else {
            return CellRange::new(sheet, row, col, row, col);
        };
        loop {
            let (lo_c, hi_c) = (c0.saturating_sub(1), (c1 + 1).min(used_col));
            let (lo_r, hi_r) = (r0.saturating_sub(1), (r1 + 1).min(used_row));
            let mut grown = false;
            if r0 > 0 && (lo_c..=hi_c).any(|c| filled(r0 - 1, c)) {
                r0 -= 1;
                grown = true;
            }
            if r1 < used_row && (lo_c..=hi_c).any(|c| filled(r1 + 1, c)) {
                r1 += 1;
                grown = true;
            }
            if c0 > 0 && (lo_r..=hi_r).any(|r| filled(r, c0 - 1)) {
                c0 -= 1;
                grown = true;
            }
            if c1 < used_col && (lo_r..=hi_r).any(|r| filled(r, c1 + 1)) {
                c1 += 1;
                grown = true;
            }
            if !grown {
                return CellRange::new(sheet, r0, c0, r1, c1);
            }
        }
    }

    // --- AutoFilter ---------------------------------------------------------

    /// The AutoFilter of `sheet`.
    pub fn auto_filter(&self, sheet: SheetId) -> Option<&AutoFilter> {
        self.sheet_data(sheet).auto_filter.as_ref()
    }

    /// Replaces the AutoFilter without touching any row (loading files,
    /// undo). Column filters must lie inside the range; they are kept
    /// sorted by column, one per column, with the blank entry of a values
    /// filter last.
    pub fn set_auto_filter(
        &mut self,
        sheet: SheetId,
        filter: Option<AutoFilter>,
    ) -> Result<(), Error> {
        let filter = match filter {
            Some(mut f) => {
                if !f.is_valid() {
                    return Err(Error::InvalidRange);
                }
                f.columns.sort_by_key(|c| c.col);
                f.columns.dedup_by_key(|c| c.col);
                // Blanks (`""`) last: the form `.xlsx` gives back.
                for fc in &mut f.columns {
                    if let Filter::Values { values } = &mut fc.filter {
                        values.sort_by_key(String::is_empty);
                    }
                }
                Some(f)
            }
            None => None,
        };
        self.sheet_data_mut(sheet)?.auto_filter = filter;
        Ok(())
    }

    /// Sets (`Some`) or removes the filter of column `col` of the
    /// AutoFilter (rows untouched; see [`apply_auto_filter`](Self::apply_auto_filter)).
    pub fn set_filter_column(
        &mut self,
        sheet: SheetId,
        col: u32,
        filter: Option<Filter>,
    ) -> Result<(), Error> {
        let mut af = self
            .auto_filter(sheet)
            .cloned()
            .ok_or(Error::NoAutoFilter)?;
        if !af.contains_col(col) {
            return Err(Error::InvalidRange);
        }
        af.columns.retain(|c| c.col != col);
        if let Some(filter) = filter {
            af.columns.push(FilterColumn { col, filter });
        }
        self.set_auto_filter(sheet, Some(af))
    }

    /// The data rows of `af` (header excluded) that can matter: up to the
    /// used range, or further down to the last row the filter hid.
    fn data_rows(&self, sheet: SheetId, af: &AutoFilter) -> std::ops::RangeInclusive<u32> {
        let used = self.used_range(sheet).map_or(0, |(r, _)| r);
        let filtered = self
            .rows(sheet)
            .filter(|(_, info)| info.filtered)
            .map(|(r, _)| r)
            .last()
            .unwrap_or(0);
        (af.r0 + 1)..=af.r1.min(used.max(filtered))
    }

    /// Every column filter of `af`, prepared against its column.
    fn matchers<'f>(&self, sheet: SheetId, af: &'f AutoFilter) -> Vec<(u32, Matcher<'f>)> {
        let today = engine_formula::default_now();
        af.columns
            .iter()
            .map(|fc| {
                let numbers: Vec<f64> = self
                    .data_rows(sheet, af)
                    .filter_map(|r| match self.value(CellCoord::new(sheet, r, fc.col)) {
                        Value::Number(n) => Some(n),
                        _ => None,
                    })
                    .collect();
                (fc.col, Matcher::new(&fc.filter, &numbers, today))
            })
            .collect()
    }

    /// Whether `row` passes every matcher except that of `skip_col`.
    fn row_passes(
        &self,
        sheet: SheetId,
        matchers: &[(u32, Matcher)],
        row: u32,
        skip_col: Option<u32>,
    ) -> bool {
        matchers
            .iter()
            .filter(|(col, _)| Some(*col) != skip_col)
            .all(|(col, m)| {
                let c = CellCoord::new(sheet, row, *col);
                m.matches(&self.value(c), &self.display_text(c))
            })
    }

    /// Sets the listed rows' infos in one batch.
    fn set_rows_batch(
        &mut self,
        sheet: SheetId,
        rows: Vec<(u32, RowInfo)>,
    ) -> Result<FilterChange, Error> {
        self.begin_batch();
        let result = rows
            .iter()
            .try_for_each(|&(row, info)| self.set_row_info(sheet, row, info).map(drop));
        let recalc = self.end_batch();
        result?;
        Ok(FilterChange {
            rows: rows.into_iter().map(|(r, _)| r).collect(),
            recalc,
        })
    }

    /// Applies the AutoFilter of `sheet` to its data rows: a row failing
    /// a column filter is hidden as filtered, a filtered row that passes
    /// is shown again; rows hidden by hand stay hidden. Without column
    /// filters this shows every filtered row.
    pub fn apply_auto_filter(&mut self, sheet: SheetId) -> Result<FilterChange, Error> {
        let af = self
            .auto_filter(sheet)
            .cloned()
            .ok_or(Error::NoAutoFilter)?;
        self.apply_filter(sheet, &af)
    }

    /// Sets (`Some`) or removes the filter of column `col` of table `id`'s
    /// AutoFilter (rows untouched; see [`apply_table_filter`](Self::apply_table_filter)).
    pub fn set_table_filter_column(
        &mut self,
        sheet: SheetId,
        id: u32,
        col: u32,
        filter: Option<Filter>,
    ) -> Result<(), Error> {
        let mut tables = self.tables(sheet).to_vec();
        let t = tables
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or(Error::UnknownTable(id))?;
        let af = t.auto_filter.as_mut().ok_or(Error::NoAutoFilter)?;
        if !af.contains_col(col) {
            return Err(Error::InvalidRange);
        }
        af.columns.retain(|c| c.col != col);
        if let Some(filter) = filter {
            af.columns.push(FilterColumn { col, filter });
            af.columns.sort_by_key(|c| c.col);
        }
        self.set_tables(sheet, tables).map(drop)
    }

    /// Applies the AutoFilter of table `id` to its data rows (like
    /// [`apply_auto_filter`](Self::apply_auto_filter)).
    pub fn apply_table_filter(&mut self, sheet: SheetId, id: u32) -> Result<FilterChange, Error> {
        let af = self
            .tables(sheet)
            .iter()
            .find(|t| t.id == id)
            .ok_or(Error::UnknownTable(id))?
            .auto_filter
            .clone()
            .ok_or(Error::NoAutoFilter)?;
        self.apply_filter(sheet, &af)
    }

    /// The buttons of a table slicer on column `col` of table `id`: every
    /// distinct displayed value of the data rows (texts differing in case
    /// are one item; ascending, blanks last); selected = passes the
    /// column's filter; `has_data` = some row with it passes the other
    /// columns' filters.
    pub fn table_slicer_items(
        &self,
        sheet: SheetId,
        id: u32,
        col: u32,
    ) -> Vec<crate::slicer::SlicerItem> {
        let Some(t) = self.tables(sheet).iter().find(|t| t.id == id) else {
            return Vec::new();
        };
        let (d0, d1) = t.data_rows();
        let af = t.auto_filter.clone();
        let matchers = af
            .as_ref()
            .map(|af| self.matchers(sheet, af))
            .unwrap_or_default();
        let used = self.used_range(sheet).map_or(0, |(r, _)| r);
        let own: Vec<&(u32, Matcher)> = matchers.iter().filter(|(c, _)| *c == col).collect();
        let mut entries: Vec<(SortValue, crate::slicer::SlicerItem)> = Vec::new();
        let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for row in d0..=d1.min(used.max(d0)) {
            let c = CellCoord::new(sheet, row, col);
            let value = self.value(c);
            let display = self.slicer_text(c);
            let selected = own
                .iter()
                .all(|(_, m)| m.matches(&value, &self.display_text(c)));
            let has_data = self.row_passes(sheet, &matchers, row, Some(col));
            let key = fold(&display);
            match index.get(&key) {
                Some(&i) => {
                    let e = &mut entries[i].1;
                    e.selected |= selected;
                    e.has_data |= has_data;
                }
                None => {
                    index.insert(key, entries.len());
                    let sort = if display.is_empty() {
                        SortValue::Blank
                    } else {
                        SortValue::of(&value, SortKind::Auto)
                    };
                    entries.push((
                        sort,
                        crate::slicer::SlicerItem {
                            name: display,
                            selected,
                            has_data,
                        },
                    ));
                }
            }
        }
        entries.sort_by(|a, b| {
            compare_for_sort(&a.0, &b.0, true, false)
                .then_with(|| compare_text(&a.1.name, &b.1.name, false))
        });
        entries.into_iter().map(|(_, v)| v).collect()
    }

    /// The filter dropdown values of column `col` of table `id`.
    pub fn table_filter_values(
        &self,
        sheet: SheetId,
        id: u32,
        col: u32,
    ) -> Result<Vec<FilterValue>, Error> {
        let af = self
            .tables(sheet)
            .iter()
            .find(|t| t.id == id)
            .ok_or(Error::UnknownTable(id))?
            .auto_filter
            .clone()
            .ok_or(Error::NoAutoFilter)?;
        self.filter_values_of(sheet, &af, col)
    }

    /// Applies `af` to its data rows (see [`apply_auto_filter`](Self::apply_auto_filter)).
    fn apply_filter(&mut self, sheet: SheetId, af: &AutoFilter) -> Result<FilterChange, Error> {
        let af = af.clone();
        let matchers = self.matchers(sheet, &af);
        let mut updates = Vec::new();
        for row in self.data_rows(sheet, &af) {
            let info = self.row_info(sheet, row);
            let new = if self.row_passes(sheet, &matchers, row, None) {
                RowInfo {
                    hidden: info.hidden && !info.filtered,
                    filtered: false,
                    ..info
                }
            } else if info.hidden && !info.filtered {
                info
            } else {
                RowInfo {
                    hidden: true,
                    filtered: true,
                    ..info
                }
            };
            if new != info {
                updates.push((row, new));
            }
        }
        self.set_rows_batch(sheet, updates)
    }

    /// Shows every row of `r0..=r1` that a filter hid (removing or
    /// replacing an AutoFilter).
    pub fn show_filtered_rows(
        &mut self,
        sheet: SheetId,
        r0: u32,
        r1: u32,
    ) -> Result<FilterChange, Error> {
        let updates: Vec<(u32, RowInfo)> = self
            .rows(sheet)
            .filter(|(r, info)| (r0..=r1).contains(r) && info.filtered)
            .map(|(r, info)| {
                (
                    r,
                    RowInfo {
                        hidden: false,
                        filtered: false,
                        ..info
                    },
                )
            })
            .collect();
        self.set_rows_batch(sheet, updates)
    }

    /// The distinct displayed values of AutoFilter column `col` with their
    /// row counts, for the filter dropdown: rows hidden by the other
    /// columns' filters are left out, rows hidden by this column's filter
    /// are included. Ordered like an ascending sort (numbers, text,
    /// logical, errors), blanks (`""`) last; texts differing only in case
    /// are one entry.
    pub fn filter_values(&self, sheet: SheetId, col: u32) -> Result<Vec<FilterValue>, Error> {
        let af = self.auto_filter(sheet).ok_or(Error::NoAutoFilter)?;
        self.filter_values_of(sheet, af, col)
    }

    fn filter_values_of(
        &self,
        sheet: SheetId,
        af: &AutoFilter,
        col: u32,
    ) -> Result<Vec<FilterValue>, Error> {
        if !af.contains_col(col) {
            return Err(Error::InvalidRange);
        }
        let matchers = self.matchers(sheet, af);
        let used = self.used_range(sheet).map_or(0, |(r, _)| r);
        let mut entries: Vec<(SortValue, FilterValue)> = Vec::new();
        let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for row in (af.r0 + 1)..=af.r1.min(used) {
            if !self.row_passes(sheet, &matchers, row, Some(col)) {
                continue;
            }
            let c = CellCoord::new(sheet, row, col);
            let value = self.value(c);
            let display = if matches!(value, Value::Empty) {
                String::new()
            } else {
                self.display_text(c)
            };
            match index.get(&fold(&display)) {
                Some(&i) => entries[i].1.count += 1,
                None => {
                    index.insert(fold(&display), entries.len());
                    let key = if display.is_empty() {
                        SortValue::Blank
                    } else {
                        SortValue::of(&value, SortKind::Auto)
                    };
                    entries.push((key, FilterValue { display, count: 1 }));
                }
            }
        }
        entries.sort_by(|a, b| {
            compare_for_sort(&a.0, &b.0, true, false)
                .then_with(|| compare_text(&a.1.display, &b.1.display, false))
        });
        Ok(entries.into_iter().map(|(_, v)| v).collect())
    }
}
