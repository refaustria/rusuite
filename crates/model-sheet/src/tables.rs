//! Excel tables (ListObjects): a named range with a header row, an
//! optional totals row, named columns (with calculated column formulas
//! and totals functions), a table style with its options and an
//! AutoFilter. The cells stay ordinary cells (header cells hold the
//! column names); the tables are registered with the engine
//! ([`Engine::set_tables`](engine_formula::Engine::set_tables)) so that
//! structured references resolve.
//!
//! Excel's rules kept here: table names are workbook-wide, unique (also
//! against defined names, ignoring case) and valid names; column names
//! are unique within a table; a table has at least one data row; tables
//! on a sheet do not overlap. Row/column inserts inside a table grow it
//! (new columns get `Column<n>` names), deletes shrink it (a table whose
//! data rows are all deleted disappears).

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::structured::ExprRewrite;
use engine_formula::{CellCoord, Recalc, SheetId, StructRef, StructuralOp, TableDef};
use serde::{Deserialize, Serialize};

use crate::sortfilter::AutoFilter;
use crate::workbook::Workbook;
use crate::Error;

fn is_false(b: &bool) -> bool {
    !*b
}

/// The default table style (Excel's "Blue, Table Style Medium 2").
pub const DEFAULT_TABLE_STYLE: &str = "TableStyleMedium2";

/// A totals row function (the dropdown of a totals cell).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TotalsFunction {
    Average,
    Count,
    CountNums,
    Max,
    Min,
    StdDev,
    Sum,
    Var,
}

impl TotalsFunction {
    pub const ALL: [TotalsFunction; 8] = [
        TotalsFunction::Average,
        TotalsFunction::Count,
        TotalsFunction::CountNums,
        TotalsFunction::Max,
        TotalsFunction::Min,
        TotalsFunction::StdDev,
        TotalsFunction::Sum,
        TotalsFunction::Var,
    ];

    /// The `SUBTOTAL` function number Excel writes (the 100s ignore
    /// hidden rows).
    pub fn subtotal_code(self) -> u32 {
        match self {
            TotalsFunction::Average => 101,
            TotalsFunction::CountNums => 102,
            TotalsFunction::Count => 103,
            TotalsFunction::Max => 104,
            TotalsFunction::Min => 105,
            TotalsFunction::StdDev => 107,
            TotalsFunction::Sum => 109,
            TotalsFunction::Var => 110,
        }
    }

    /// `totalsRowFunction` in the file.
    pub fn file_name(self) -> &'static str {
        match self {
            TotalsFunction::Average => "average",
            TotalsFunction::Count => "count",
            TotalsFunction::CountNums => "countNums",
            TotalsFunction::Max => "max",
            TotalsFunction::Min => "min",
            TotalsFunction::StdDev => "stdDev",
            TotalsFunction::Sum => "sum",
            TotalsFunction::Var => "var",
        }
    }

    pub fn from_file_name(s: &str) -> Option<TotalsFunction> {
        Self::ALL.into_iter().find(|f| f.file_name() == s)
    }

    /// The function of a `SUBTOTAL` code (`None` for others).
    pub fn from_code(code: u32) -> Option<TotalsFunction> {
        Self::ALL.into_iter().find(|f| f.subtotal_code() == code)
    }

    /// The totals cell formula for column `column` (`=SUBTOTAL(109,[Qty])`).
    pub fn formula(self, column: &str) -> String {
        format!(
            "=SUBTOTAL({},{})",
            self.subtotal_code(),
            StructRef::column(None, column)
        )
    }
}

/// What the totals row shows under a column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TotalsCell {
    /// A function from the dropdown.
    Function { function: TotalsFunction },
    /// A text label (`Total`).
    Label { text: String },
    /// Another formula (without `=`).
    Custom { formula: String },
}

/// One column of a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    /// Unique within the table, `>= 1`.
    pub id: u32,
    /// The header text.
    pub name: String,
    /// The formula every data cell of the column holds (without `=`,
    /// display form); new rows inherit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculated_formula: Option<String>,
    /// The totals row cell of the column (kept while the totals row is
    /// off, as Excel does).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals: Option<TotalsCell>,
}

impl TableColumn {
    pub fn new(id: u32, name: &str) -> Self {
        TableColumn {
            id,
            name: name.to_string(),
            calculated_formula: None,
            totals: None,
        }
    }
}

/// The Table Style Options of the Table Design tab (the header and
/// totals rows and the filter button are on the [`Table`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TableLook {
    pub first_column: bool,
    pub last_column: bool,
    pub banded_rows: bool,
    pub banded_columns: bool,
}

impl Default for TableLook {
    fn default() -> Self {
        TableLook {
            first_column: false,
            last_column: false,
            banded_rows: true,
            banded_columns: false,
        }
    }
}

/// An Excel table. See the module docs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    /// Workbook-wide unique, `>= 1`.
    pub id: u32,
    /// The table name (Excel's `displayName`).
    pub name: String,
    /// The whole range, header and totals rows included (inclusive).
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    /// Row `r0` is the header row.
    pub header_row: bool,
    /// Row `r1` is the totals row.
    #[serde(default, skip_serializing_if = "is_false")]
    pub totals_row: bool,
    /// One per column `c0..=c1`.
    pub columns: Vec<TableColumn>,
    /// Built-in style name (`TableStyleMedium2`); empty = none.
    pub style: String,
    #[serde(default)]
    pub look: TableLook,
    /// The filter buttons (and filters) of the header; `None` = no
    /// buttons. Its range is the header and data rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter: Option<AutoFilter>,
}

impl Table {
    /// A new table on `r0..=r1 × c0..=c1` with `names` as its columns,
    /// the default style, banded rows and filter buttons.
    pub fn new(id: u32, name: &str, r0: u32, c0: u32, r1: u32, c1: u32, names: &[String]) -> Self {
        let mut t = Table {
            id,
            name: name.to_string(),
            r0,
            c0,
            r1,
            c1,
            header_row: true,
            totals_row: false,
            columns: names
                .iter()
                .enumerate()
                .map(|(i, n)| TableColumn::new(i as u32 + 1, n))
                .collect(),
            style: DEFAULT_TABLE_STYLE.to_string(),
            look: TableLook::default(),
            auto_filter: None,
        };
        t.auto_filter = Some(t.filter_range());
        t
    }

    /// First and last data row.
    pub fn data_rows(&self) -> (u32, u32) {
        (
            self.r0 + u32::from(self.header_row),
            self.r1.saturating_sub(u32::from(self.totals_row)),
        )
    }

    pub fn header_index(&self) -> Option<u32> {
        self.header_row.then_some(self.r0)
    }

    pub fn totals_index(&self) -> Option<u32> {
        self.totals_row.then_some(self.r1)
    }

    pub fn contains(&self, row: u32, col: u32) -> bool {
        (self.r0..=self.r1).contains(&row) && (self.c0..=self.c1).contains(&col)
    }

    pub fn intersects(&self, r0: u32, c0: u32, r1: u32, c1: u32) -> bool {
        self.r0 <= r1 && r0 <= self.r1 && self.c0 <= c1 && c0 <= self.c1
    }

    /// The column at sheet column `col`.
    pub fn column_at(&self, col: u32) -> Option<&TableColumn> {
        col.checked_sub(self.c0)
            .and_then(|i| self.columns.get(i as usize))
    }

    /// The sheet column of the column named `name` (any case).
    pub fn column_index(&self, name: &str) -> Option<u32> {
        let lower = name.to_lowercase();
        self.columns
            .iter()
            .position(|c| c.name.to_lowercase() == lower)
            .map(|i| self.c0 + i as u32)
    }

    /// The AutoFilter range: header (or first data row) to the last data
    /// row, keeping the column filters that still fit.
    pub fn filter_range(&self) -> AutoFilter {
        let (_, last) = self.data_rows();
        let mut af = AutoFilter::new(self.r0, self.c0, last, self.c1);
        if let Some(old) = &self.auto_filter {
            af.columns = old
                .columns
                .iter()
                .filter(|c| (self.c0..=self.c1).contains(&c.col))
                .cloned()
                .collect();
        }
        af
    }

    /// The engine's view of the table.
    pub fn def(&self, sheet: SheetId) -> TableDef {
        TableDef {
            name: self.name.clone(),
            sheet,
            r0: self.r0,
            c0: self.c0,
            r1: self.r1,
            c1: self.c1,
            header: self.header_row,
            totals: self.totals_row,
            columns: self.columns.iter().map(|c| c.name.clone()).collect(),
        }
    }

    fn next_column_id(&self) -> u32 {
        self.columns.iter().map(|c| c.id).max().unwrap_or(0) + 1
    }

    /// `base` made unique among the column names (`Qty2`, `Qty3`, …).
    pub fn unique_column_name(&self, base: &str, except: Option<usize>) -> String {
        let taken = |n: &str| {
            self.columns
                .iter()
                .enumerate()
                .any(|(i, c)| Some(i) != except && c.name.eq_ignore_ascii_case(n))
        };
        unique_name(base, taken)
    }

    fn check(&self) -> Result<(), Error> {
        let bad = |m: String| Err(Error::InvalidTable(m));
        if self.id == 0 {
            return bad("id 0".into());
        }
        if !engine_formula::is_valid_name(&self.name) {
            return bad(format!("invalid name {:?}", self.name));
        }
        if self.r0 > self.r1 || self.c0 > self.c1 || self.r1 > MAX_ROW || self.c1 > MAX_COL {
            return bad("invalid range".into());
        }
        if self.columns.len() as u64 != u64::from(self.c1 - self.c0) + 1 {
            return bad("one column per range column".into());
        }
        let rows = self.r1 - self.r0 + 1;
        if rows < 1 + u32::from(self.header_row) + u32::from(self.totals_row) {
            return bad("a table needs a data row".into());
        }
        for (i, c) in self.columns.iter().enumerate() {
            if c.name.is_empty() {
                return bad(format!("column {} has no name", i + 1));
            }
            if self.columns[..i]
                .iter()
                .any(|d| d.name.to_lowercase() == c.name.to_lowercase())
            {
                return bad(format!("duplicate column {:?}", c.name));
            }
        }
        Ok(())
    }
}

/// `base`, else `base2`, `base3`, … whichever `taken` does not reject.
pub fn unique_name(base: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(base) {
        return base.to_string();
    }
    (2u32..)
        .map(|n| format!("{base}{n}"))
        .find(|n| !taken(n))
        .expect("an unused name")
}

impl Workbook {
    /// The tables of `sheet`.
    pub fn tables(&self, sheet: SheetId) -> &[Table] {
        &self.sheet_data(sheet).tables
    }

    /// Every table of the workbook with its sheet, in sheet order.
    pub fn all_tables(&self) -> Vec<(SheetId, &Table)> {
        self.engine()
            .sheets()
            .flat_map(|(id, _)| self.tables(id).iter().map(move |t| (id, t)))
            .collect()
    }

    /// The table with id `id`.
    pub fn table(&self, id: u32) -> Option<(SheetId, &Table)> {
        self.all_tables().into_iter().find(|(_, t)| t.id == id)
    }

    /// The table named `name` (any case).
    pub fn table_by_name(&self, name: &str) -> Option<(SheetId, &Table)> {
        self.all_tables()
            .into_iter()
            .find(|(_, t)| t.name.eq_ignore_ascii_case(name))
    }

    /// The table whose range holds `c`.
    pub fn table_at(&self, c: CellCoord) -> Option<&Table> {
        self.tables(c.sheet)
            .iter()
            .find(|t| t.contains(c.row, c.col))
    }

    /// A fresh table id.
    pub fn next_table_id(&self) -> u32 {
        self.all_tables()
            .iter()
            .map(|(_, t)| t.id)
            .max()
            .unwrap_or(0)
            + 1
    }

    /// `Table1`, `Table2`, …: the first name no table or defined name
    /// uses.
    pub fn fresh_table_name(&self) -> String {
        (1u32..)
            .map(|n| format!("Table{n}"))
            .find(|n| self.check_table_name(n, None).is_ok())
            .expect("an unused name")
    }

    /// Whether `name` can name a table (`except`: the table being
    /// renamed): a valid name, used by no other table and no defined
    /// name.
    pub fn check_table_name(&self, name: &str, except: Option<u32>) -> Result<(), Error> {
        if !engine_formula::is_valid_name(name) {
            return Err(Error::InvalidTable(format!("invalid name {name:?}")));
        }
        let clash = self
            .all_tables()
            .iter()
            .any(|(_, t)| Some(t.id) != except && t.name.eq_ignore_ascii_case(name))
            || self
                .engine()
                .names()
                .iter()
                .any(|n| n.name.eq_ignore_ascii_case(name));
        if clash {
            return Err(Error::InvalidTable(format!("the name {name:?} is taken")));
        }
        Ok(())
    }

    /// Replaces the tables of `sheet` (validated: see the module docs;
    /// on error nothing changes) and re-registers the structured
    /// references (the result lists the formulas that changed).
    pub fn set_tables(&mut self, sheet: SheetId, tables: Vec<Table>) -> Result<Recalc, Error> {
        self.sheet_data_mut(sheet)?;
        for (i, t) in tables.iter().enumerate() {
            t.check()?;
            if tables[..i]
                .iter()
                .any(|o| o.intersects(t.r0, t.c0, t.r1, t.c1))
            {
                return Err(Error::InvalidTable(format!(
                    "{} overlaps another table",
                    t.name
                )));
            }
            let clash = |o: &Table| o.id == t.id || o.name.eq_ignore_ascii_case(&t.name);
            if tables[..i].iter().any(clash)
                || self
                    .all_tables()
                    .iter()
                    .any(|(s, o)| *s != sheet && clash(o))
            {
                return Err(Error::InvalidTable(format!(
                    "duplicate table {:?} / id {}",
                    t.name, t.id
                )));
            }
        }
        let mut tables = tables;
        for t in &mut tables {
            if t.auto_filter.is_some() {
                t.auto_filter = Some(t.filter_range());
            }
        }
        self.sheet_data_mut(sheet)?.tables = tables;
        Ok(self.sync_tables())
    }

    /// Hands the current tables to the engine.
    pub(crate) fn sync_tables(&mut self) -> Recalc {
        let defs: Vec<TableDef> = self
            .all_tables()
            .into_iter()
            .map(|(s, t)| t.def(s))
            .collect();
        self.engine_mut().set_tables(defs)
    }

    /// Before a column delete on `sheet`: references to the table
    /// columns it removes become `#REF!` (see
    /// [`delete_table_column_refs`](Self::delete_table_column_refs)).
    pub(crate) fn table_refs_before_delete(&mut self, sheet: SheetId, op: StructuralOp) -> Recalc {
        if op.is_rows() || op.is_insert() {
            return Recalc::default();
        }
        let gone: Vec<(String, Vec<String>)> = self
            .tables(sheet)
            .iter()
            .map(|t| {
                let cols = t
                    .columns
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| op.map_index(t.c0 + *i as u32).is_none())
                    .map(|(_, c)| c.name.clone())
                    .collect();
                (t.name.clone(), cols)
            })
            .collect();
        let mut out = Recalc::default();
        for (table, cols) in gone {
            out.changed
                .extend(self.delete_table_column_refs(&table, &cols).changed);
        }
        out
    }

    /// Moves, grows and shrinks the tables of `sheet` with a row/column
    /// insert or delete (see the module docs). New columns' header cells
    /// get their names. Returns the recalculation of the structured
    /// references.
    pub(crate) fn shift_tables(&mut self, sheet: SheetId, op: StructuralOp) -> Recalc {
        let Ok(data) = self.sheet_data_mut(sheet) else {
            return Recalc::default();
        };
        if data.tables.is_empty() {
            return Recalc::default();
        }
        let mut headers: Vec<(u32, u32, String)> = Vec::new();
        let tables = std::mem::take(&mut data.tables)
            .into_iter()
            .filter_map(|mut t| {
                if op.is_rows() {
                    let header = t.header_row;
                    let (h, d, tot) = (t.r0, t.data_rows(), t.r1);
                    let gone = |r: u32| op.map_index(r).is_none();
                    let (r0, r1) = op.map_interval(t.r0, t.r1)?;
                    // Data rows left?
                    op.map_interval(d.0, d.1)?;
                    t.header_row = header && !gone(h);
                    t.totals_row = t.totals_row && !gone(tot);
                    t.r0 = r0;
                    t.r1 = r1;
                } else {
                    let (at, count) = op.span();
                    if op.is_insert() {
                        if at <= t.c0 {
                            t.c0 += count;
                            t.c1 += count;
                        } else if at <= t.c1 {
                            let pos = (at - t.c0) as usize;
                            for k in 0..count {
                                let id = t.next_column_id();
                                let name = t.unique_column_name(&format!("Column{id}"), None);
                                t.columns
                                    .insert(pos + k as usize, TableColumn::new(id, &name));
                                if t.header_row {
                                    headers.push((t.r0, at + k, name));
                                }
                            }
                            t.c1 += count;
                        }
                    } else {
                        let keep: Vec<TableColumn> = t
                            .columns
                            .iter()
                            .enumerate()
                            .filter(|(i, _)| op.map_index(t.c0 + *i as u32).is_some())
                            .map(|(_, c)| c.clone())
                            .collect();
                        let (c0, c1) = op.map_interval(t.c0, t.c1)?;
                        if keep.is_empty() {
                            return None;
                        }
                        t.columns = keep;
                        t.c0 = c0;
                        t.c1 = c1;
                    }
                    if let Some(af) = t.auto_filter.as_mut() {
                        af.columns = std::mem::take(&mut af.columns)
                            .into_iter()
                            .filter_map(|mut fc| {
                                fc.col = op.map_index(fc.col)?;
                                Some(fc)
                            })
                            .collect();
                    }
                }
                if t.auto_filter.is_some() {
                    t.auto_filter = Some(t.filter_range());
                }
                // A header-less table may have become too short.
                let rows = t.r1 - t.r0 + 1;
                (rows > u32::from(t.header_row) + u32::from(t.totals_row)).then_some(t)
            })
            .collect();
        if let Ok(data) = self.sheet_data_mut(sheet) {
            data.tables = tables;
        }
        for (row, col, name) in headers {
            let _ = self.set_input(CellCoord::new(sheet, row, col), &header_input(&name));
        }
        self.sync_tables()
    }

    /// Copies the tables of `from` to the new sheet `to` (Duplicate
    /// Sheet) under new names and ids; formulas on `to` that name the
    /// originals follow the copies.
    pub(crate) fn copy_tables(&mut self, from: SheetId, to: SheetId) {
        let originals = self.tables(from).to_vec();
        if originals.is_empty() {
            return;
        }
        if let Ok(d) = self.sheet_data_mut(to) {
            d.tables.clear();
        }
        let mut copies = Vec::new();
        for t in originals {
            let id = self
                .next_table_id()
                .max(copies.iter().map(|c: &Table| c.id + 1).max().unwrap_or(0));
            // `Table3` copies as the next free `Table<n>`, `Sales` as `Sales2`.
            let numbered = t
                .name
                .strip_prefix("Table")
                .is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()));
            let taken = |n: &str| {
                self.check_table_name(n, None).is_err()
                    || copies
                        .iter()
                        .any(|c: &Table| c.name.eq_ignore_ascii_case(n))
            };
            let name = if numbered {
                (1u32..)
                    .map(|k| format!("Table{k}"))
                    .find(|n| !taken(n))
                    .expect("an unused name")
            } else {
                unique_name(&t.name, taken)
            };
            self.engine_mut()
                .rename_table_refs_in(Some(to), &t.name, &name);
            copies.push(Table { id, name, ..t });
        }
        if let Ok(d) = self.sheet_data_mut(to) {
            d.tables = copies;
        }
        self.sync_tables();
    }
}

impl Workbook {
    /// Rewrites structured references wherever formulas live: cells and
    /// defined names (the engine), conditional formatting and data
    /// validation formulas (at their rule's anchor cell) and the tables'
    /// calculated column and custom totals formulas. Returns the cells'
    /// recalculation.
    pub fn rewrite_table_refs(&mut self, f: &ExprRewrite<'_>) -> Recalc {
        let recalc = self.engine_mut().rewrite_formulas_with(f);
        let map = |text: &mut String, at: CellCoord| {
            if let Ok(ast) = crate::rules::parse_formula(text) {
                let new = engine_formula::engine::map_expr(&ast, &|x| f(x, at));
                if new != ast {
                    *text = new.to_string();
                }
            }
        };
        let sheets: Vec<SheetId> = self.engine().sheets().map(|(id, _)| id).collect();
        for sheet in sheets {
            let Ok(data) = self.sheet_data_mut(sheet) else {
                continue;
            };
            for rule in &mut data.conditional_formats {
                let (ranges, formulas) = rule.parts_mut();
                let Some((r, c)) = crate::rules::anchor(ranges) else {
                    continue;
                };
                for text in formulas {
                    map(text, CellCoord::new(sheet, r, c));
                }
            }
            for v in &mut data.validations {
                let (ranges, formulas) = v.parts_mut();
                let Some((r, c)) = crate::rules::anchor(ranges) else {
                    continue;
                };
                for text in formulas {
                    map(text, CellCoord::new(sheet, r, c));
                }
            }
            for t in &mut data.tables {
                let (d0, _) = t.data_rows();
                let (c0, r1) = (t.c0, t.r1);
                for (i, col) in t.columns.iter_mut().enumerate() {
                    let x = c0 + i as u32;
                    if let Some(text) = col.calculated_formula.as_mut() {
                        map(text, CellCoord::new(sheet, d0, x));
                    }
                    if let Some(TotalsCell::Custom { formula }) = col.totals.as_mut() {
                        map(formula, CellCoord::new(sheet, r1, x));
                    }
                }
            }
        }
        recalc
    }

    /// Table `old` is renamed to `new`: every reference follows (see
    /// [`rewrite_table_refs`](Self::rewrite_table_refs); call before
    /// [`set_tables`](Self::set_tables) with the renamed table).
    pub fn rename_table_refs(&mut self, old: &str, new: &str) -> Recalc {
        let f = engine_formula::structured::rename_table_rewrite(old, new);
        self.rewrite_table_refs(&f)
    }

    /// Column `old` of the table named `table` is renamed to `new`.
    pub fn rename_table_column_refs(&mut self, table: &str, old: &str, new: &str) -> Recalc {
        let Some(def) = self.engine().table(table).cloned() else {
            return Recalc::default();
        };
        let f = engine_formula::structured::rename_column_rewrite(&def, old, new);
        self.rewrite_table_refs(&f)
    }

    /// The columns `deleted` of the table named `table` are about to go:
    /// references to them become `#REF!`, column ranges shrink (Excel;
    /// see [`delete_columns_rewrite`](engine_formula::structured::delete_columns_rewrite)).
    pub fn delete_table_column_refs(&mut self, table: &str, deleted: &[String]) -> Recalc {
        if deleted.is_empty() {
            return Recalc::default();
        }
        let Some(def) = self.engine().table(table).cloned() else {
            return Recalc::default();
        };
        let f = engine_formula::structured::delete_columns_rewrite(&def, deleted);
        self.rewrite_table_refs(&f)
    }
}

/// The input that puts `name` into a header cell as text.
pub fn header_input(name: &str) -> String {
    let content = engine_formula::engine::parse_input(name);
    match content {
        Ok(engine_formula::CellContent::Value(engine_formula::Value::Text(t))) if t == name => {
            name.to_string()
        }
        _ => format!("'{name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(n: &[&str]) -> Vec<String> {
        n.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn validation() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let t = Table::new(1, "Sales", 0, 0, 3, 1, &names(&["A", "B"]));
        wb.set_tables(s, vec![t.clone()]).unwrap();
        assert_eq!(wb.table_at(CellCoord::new(s, 2, 1)).unwrap().name, "Sales");
        let bad = |t: Table| matches!(wb.clone_check(s, t), Err(Error::InvalidTable(_)));
        assert!(bad(Table::new(2, "A1", 5, 0, 7, 0, &names(&["x"]))));
        assert!(bad(Table::new(2, "X", 5, 0, 7, 0, &names(&["x", "y"]))));
        assert!(bad(Table::new(2, "X", 5, 0, 7, 1, &names(&["x", "X"]))));
        assert!(bad(Table::new(2, "X", 5, 0, 5, 0, &names(&["x"]))));
        assert!(bad(Table::new(2, "X", 2, 1, 6, 1, &names(&["x"]))));
        assert!(bad(Table::new(2, "sales", 8, 0, 9, 0, &names(&["x"]))));
        assert!(!bad(Table::new(2, "X", 5, 0, 6, 0, &names(&["x"]))));
        assert_eq!(wb.fresh_table_name(), "Table1");
        assert_eq!(wb.next_table_id(), 2);
        assert!(wb.check_table_name("sales", Some(1)).is_ok());
        assert!(wb.check_table_name("sales", None).is_err());
    }

    impl Workbook {
        fn clone_check(&self, s: SheetId, t: Table) -> Result<Recalc, Error> {
            let mut wb = Workbook::from_snapshot(&self.to_snapshot())?;
            let mut all = wb.tables(s).to_vec();
            all.push(t);
            wb.set_tables(s, all)
        }
    }

    #[test]
    fn totals_formulas() {
        assert_eq!(TotalsFunction::Sum.formula("Qty"), "=SUBTOTAL(109,[Qty])");
        assert_eq!(
            TotalsFunction::Average.formula("Unit Price"),
            "=SUBTOTAL(101,[Unit Price])"
        );
        for f in TotalsFunction::ALL {
            assert_eq!(TotalsFunction::from_file_name(f.file_name()), Some(f));
            assert_eq!(TotalsFunction::from_code(f.subtotal_code()), Some(f));
        }
        assert_eq!(header_input("12"), "'12");
        assert_eq!(header_input("Qty"), "Qty");
    }

    #[test]
    fn structural_edits_grow_and_shrink() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        for (r, row) in [["A", "B"], ["1", "2"], ["3", "4"]].iter().enumerate() {
            for (col, v) in row.iter().enumerate() {
                wb.set_input(c(r as u32, col as u32), v).unwrap();
            }
        }
        let t = Table::new(1, "T", 0, 0, 2, 1, &names(&["A", "B"]));
        wb.set_tables(s, vec![t]).unwrap();
        wb.set_input(c(5, 5), "=SUM(T[B])").unwrap();
        assert_eq!(wb.value(c(5, 5)), engine_formula::Value::Number(6.0));
        wb.insert_rows(s, 2, 1).unwrap();
        let t = &wb.tables(s)[0];
        assert_eq!((t.r0, t.r1), (0, 3));
        wb.set_input(c(2, 1), "10").unwrap();
        assert_eq!(wb.value(c(6, 5)), engine_formula::Value::Number(16.0));
        wb.insert_cols(s, 1, 1).unwrap();
        let t = &wb.tables(s)[0];
        assert_eq!((t.c0, t.c1), (0, 2));
        assert_eq!(t.columns[1].name, "Column3");
        assert_eq!(
            wb.value(c(0, 1)),
            engine_formula::Value::Text("Column3".into())
        );
        assert_eq!(wb.formula_text(c(6, 6)), Some("=SUM(T[B])"));
        assert_eq!(wb.value(c(6, 6)), engine_formula::Value::Number(16.0));
        wb.delete_cols(s, 2, 1).unwrap();
        assert_eq!(wb.tables(s)[0].columns.len(), 2);
        assert_eq!(
            wb.value(c(6, 5)),
            engine_formula::Value::Error(engine_formula::ErrorKind::Ref)
        );
        // Deleting every data row removes the table.
        wb.delete_rows(s, 1, 3).unwrap();
        assert!(wb.tables(s).is_empty());
    }
}
