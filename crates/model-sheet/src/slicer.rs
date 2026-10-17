//! Slicers (Insert › Slicer): a floating panel of buttons, one per
//! distinct value of a table column or a pivot cache field, that filters
//! the table's AutoFilter or the connected pivot tables.
//!
//! As in the file format, a slicer has two parts:
//!
//! * a [`SlicerCache`] (workbook-wide, `xl/slicerCaches/slicerCacheN.xml`):
//!   the source (a table column, or a pivot cache field with the pivot
//!   tables it filters – Report Connections) and, for pivot sources, the
//!   items that are filtered out;
//! * one or more [`Slicer`]s (per sheet, `xl/slicers/slicerN.xml` plus a
//!   drawing anchor): caption, columns, button height, style, position.
//!
//! Table slicers keep their selection in the table's AutoFilter (a value
//! filter on the column), exactly like Excel; clicking items rewrites
//! that filter. Pivot slicers keep the hidden items on the cache and
//! apply them to every connected pivot table: as hidden items of a row /
//! column field, as the selection of a page field, or as a filter on a
//! field that is on no axis ([`PivotTable::field_filters`](crate::PivotTable::field_filters)).

use std::collections::BTreeSet;

use engine_formula::{CellCoord, Recalc, SheetId, StructuralOp, Value};
use serde::{Deserialize, Serialize};

use crate::chart::ChartAnchor;
use crate::pivot::{Item, PageField, PageSelection};
use crate::sortfilter::Filter;
use crate::workbook::Workbook;
use crate::Error;

/// Excel's default slicer style.
pub const DEFAULT_SLICER_STYLE: &str = "SlicerStyleLight1";

/// Excel's default button height (`rowHeight`, EMU: 0.26 in).
pub const DEFAULT_ROW_HEIGHT: i64 = 241_300;

/// Excel's built-in slicer styles: `SlicerStyleLight1`–`6`,
/// `SlicerStyleOther1`–`2`, `SlicerStyleDark1`–`6`.
pub fn is_builtin_slicer_style(name: &str) -> bool {
    let n = |rest: &str, max: u32| {
        rest.parse::<u32>()
            .is_ok_and(|n| (1..=max).contains(&n) && !rest.starts_with('0'))
    };
    if let Some(r) = name.strip_prefix("SlicerStyleLight") {
        return n(r, 6);
    }
    if let Some(r) = name.strip_prefix("SlicerStyleDark") {
        return n(r, 6);
    }
    if let Some(r) = name.strip_prefix("SlicerStyleOther") {
        return n(r, 2);
    }
    false
}

/// What a slicer cache filters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SlicerSource {
    /// Column `column` (a [`TableColumn::id`](crate::TableColumn::id)) of
    /// table `table` (a [`Table::id`](crate::Table::id)).
    Table { table: u32, column: u32 },
    /// Field `field` of pivot cache `cache`, filtering the pivot tables
    /// `pivots` (ids; all on that cache).
    Pivot {
        cache: u32,
        field: u32,
        #[serde(default)]
        pivots: Vec<u32>,
    },
}

/// Item order of a slicer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerSort {
    #[default]
    Ascending,
    Descending,
}

/// A slicer cache (see the module docs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerCache {
    /// Workbook-unique, a valid defined name (`Slicer_Region`); the file
    /// also writes it as a defined name.
    pub name: String,
    /// The column or field name when the slicer was created
    /// (`sourceName`).
    pub source_name: String,
    pub source: SlicerSource,
    /// Pivot sources: the shared items of the field that are filtered
    /// out (empty = everything selected). Table sources keep their
    /// selection in the table's AutoFilter.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub hidden: BTreeSet<u32>,
    #[serde(default, skip_serializing_if = "is_ascending")]
    pub sort: SlicerSort,
}

fn is_ascending(s: &SlicerSort) -> bool {
    *s == SlicerSort::Ascending
}

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

fn one() -> u32 {
    1
}

fn is_one(v: &u32) -> bool {
    *v == 1
}

fn default_height() -> i64 {
    DEFAULT_ROW_HEIGHT
}

fn is_default_height(v: &i64) -> bool {
    *v == DEFAULT_ROW_HEIGHT
}

/// A slicer object on a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slicer {
    /// Workbook-unique, `>= 1` (not stored in the file).
    pub id: u32,
    /// Workbook-unique (`Region`, `Region 1`, …); also the drawing
    /// object's name.
    pub name: String,
    /// The [`SlicerCache::name`] it shows.
    pub cache: String,
    /// The header text.
    pub caption: String,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub show_caption: bool,
    /// Button columns (1–20000).
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub columns: u32,
    /// Button height in EMU.
    #[serde(default = "default_height", skip_serializing_if = "is_default_height")]
    pub row_height: i64,
    /// A built-in slicer style name.
    pub style: String,
    pub anchor: ChartAnchor,
}

/// One button of a slicer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerItem {
    /// The value as displayed (`""` = blank, shown as "(blank)").
    pub name: String,
    pub selected: bool,
    /// Whether rows with this value pass the other filters (else Excel
    /// shows the button dimmed).
    pub has_data: bool,
}

/// The slicer caches and every sheet's slicers (undo snapshots).
pub type SlicerState = (Vec<SlicerCache>, Vec<(SheetId, Vec<Slicer>)>);

/// The text of a pivot cache item as a slicer shows it.
fn item_text(item: &Item, number_format: Option<&str>) -> String {
    match item {
        Item::Blank => String::new(),
        Item::Number(n) => match number_format {
            Some(code) => engine_formula::format_number(*n, code)
                .unwrap_or_else(|| engine_formula::value::format_general(*n)),
            None => engine_formula::value::format_general(*n),
        },
        Item::Text(t) => t.clone(),
        Item::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
        Item::Error(e) => e.clone(),
    }
}

fn fold(s: &str) -> String {
    s.chars().flat_map(char::to_lowercase).collect()
}

impl Workbook {
    /// The slicer caches.
    pub fn slicer_caches(&self) -> &[SlicerCache] {
        &self.slicer_caches
    }

    /// The cache named `name` (any case).
    pub fn slicer_cache(&self, name: &str) -> Option<&SlicerCache> {
        self.slicer_caches
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(name))
    }

    /// The slicers of `sheet`, back to front.
    pub fn slicers(&self, sheet: SheetId) -> &[Slicer] {
        &self.sheet_data(sheet).slicers
    }

    /// Every slicer with its sheet.
    pub fn all_slicers(&self) -> Vec<(SheetId, &Slicer)> {
        self.sheets()
            .into_iter()
            .flat_map(|(s, _)| self.slicers(s).iter().map(move |x| (s, x)))
            .collect()
    }

    /// The slicer with id `id`.
    pub fn slicer(&self, id: u32) -> Option<(SheetId, &Slicer)> {
        self.all_slicers().into_iter().find(|(_, s)| s.id == id)
    }

    /// The caches and slicers (for undo).
    pub fn slicer_state(&self) -> SlicerState {
        (
            self.slicer_caches.clone(),
            self.sheets()
                .into_iter()
                .filter(|(s, _)| !self.slicers(*s).is_empty())
                .map(|(s, _)| (s, self.slicers(s).to_vec()))
                .collect(),
        )
    }

    /// Replaces the caches and every sheet's slicers (validated: unique
    /// valid names, sources that exist, slicers naming known caches;
    /// on error nothing changes).
    pub fn set_slicer_state(&mut self, state: SlicerState) -> Result<(), Error> {
        let (caches, sheets) = state;
        let bad = |m: String| Err(Error::InvalidSlicer(m));
        for (i, c) in caches.iter().enumerate() {
            if !engine_formula::is_valid_name(&c.name) {
                return bad(format!("invalid cache name {:?}", c.name));
            }
            if caches[..i]
                .iter()
                .any(|o| o.name.eq_ignore_ascii_case(&c.name))
            {
                return bad(format!("duplicate cache {:?}", c.name));
            }
            if !self.slicer_source_exists(&c.source) {
                return bad(format!("{}: the source does not exist", c.name));
            }
        }
        let mut ids = BTreeSet::new();
        let mut names: Vec<String> = Vec::new();
        for (sheet, list) in &sheets {
            self.sheet_data(*sheet);
            if self.engine().sheet_name(*sheet).is_none() {
                return Err(Error::UnknownSheet(*sheet));
            }
            for s in list {
                if s.id == 0 || !ids.insert(s.id) {
                    return bad(format!("duplicate slicer id {}", s.id));
                }
                if s.name.trim().is_empty() || names.iter().any(|n| n.eq_ignore_ascii_case(&s.name))
                {
                    return bad(format!("duplicate slicer name {:?}", s.name));
                }
                names.push(s.name.clone());
                if !caches.iter().any(|c| c.name.eq_ignore_ascii_case(&s.cache)) {
                    return bad(format!("{}: unknown cache {:?}", s.name, s.cache));
                }
                if !(1..=20_000).contains(&s.columns) || s.row_height <= 0 {
                    return bad(format!("{}: invalid columns or height", s.name));
                }
            }
        }
        self.slicer_caches = caches;
        let ids: Vec<SheetId> = self.sheets().into_iter().map(|(s, _)| s).collect();
        for s in ids {
            if let Ok(d) = self.sheet_data_mut(s) {
                d.slicers.clear();
            }
        }
        for (sheet, list) in sheets {
            self.sheet_data_mut(sheet)?.slicers = list;
        }
        Ok(())
    }

    fn slicer_source_exists(&self, source: &SlicerSource) -> bool {
        match source {
            SlicerSource::Table { table, column } => self
                .table(*table)
                .is_some_and(|(_, t)| t.columns.iter().any(|c| c.id == *column)),
            SlicerSource::Pivot {
                cache,
                field,
                pivots,
            } => {
                self.pivot_cache(*cache)
                    .is_some_and(|c| (*field as usize) < c.fields.len())
                    && pivots.iter().all(|p| {
                        self.pivot(*p)
                            .is_some_and(|(_, t)| t.cache_id == *cache && t.raw.is_none())
                    })
            }
        }
    }

    /// `Slicer_<name>` made a unique valid name (`Slicer_Unit_Price`,
    /// `Slicer_Region1`, …).
    pub fn fresh_slicer_cache_name(&self, source_name: &str) -> String {
        let mut base: String = source_name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        if base.is_empty() {
            base = "Field".into();
        }
        let base = format!("Slicer_{base}");
        let taken = |n: &str| {
            self.slicer_cache(n).is_some()
                || !engine_formula::is_valid_name(n)
                || self
                    .engine()
                    .names()
                    .iter()
                    .any(|d| d.name.eq_ignore_ascii_case(n))
        };
        if !taken(&base) {
            return base;
        }
        (1u32..)
            .map(|k| format!("{base}{k}"))
            .find(|n| !taken(n))
            .expect("an unused name")
    }

    /// `Region`, else `Region 1`, `Region 2`, … (slicer names).
    pub fn fresh_slicer_name(&self, base: &str) -> String {
        let taken = |n: &str| {
            self.all_slicers()
                .iter()
                .any(|(_, s)| s.name.eq_ignore_ascii_case(n))
        };
        if !taken(base) {
            return base.to_string();
        }
        (1u32..)
            .map(|k| format!("{base} {k}"))
            .find(|n| !taken(n))
            .expect("an unused name")
    }

    /// A fresh slicer id.
    pub fn next_slicer_id(&self) -> u32 {
        self.all_slicers()
            .iter()
            .map(|(_, s)| s.id)
            .max()
            .unwrap_or(0)
            + 1
    }

    /// Insert Slicer: a new cache on `source` and a slicer on `sheet` at
    /// `anchor` (caption = the column / field name). Returns the slicer
    /// id.
    pub fn insert_slicer(
        &mut self,
        sheet: SheetId,
        source: SlicerSource,
        anchor: ChartAnchor,
    ) -> Result<u32, Error> {
        if !self.slicer_source_exists(&source) {
            return Err(Error::InvalidSlicer("the source does not exist".into()));
        }
        let source_name = self.slicer_source_name(&source);
        let cache = SlicerCache {
            name: self.fresh_slicer_cache_name(&source_name),
            source_name: source_name.clone(),
            source,
            hidden: BTreeSet::new(),
            sort: SlicerSort::Ascending,
        };
        let id = self.next_slicer_id();
        let slicer = Slicer {
            id,
            name: self.fresh_slicer_name(&source_name),
            cache: cache.name.clone(),
            caption: source_name,
            show_caption: true,
            columns: 1,
            row_height: DEFAULT_ROW_HEIGHT,
            style: DEFAULT_SLICER_STYLE.into(),
            anchor,
        };
        let (mut caches, mut sheets) = self.slicer_state();
        caches.push(cache);
        match sheets.iter_mut().find(|(s, _)| *s == sheet) {
            Some((_, list)) => list.push(slicer),
            None => sheets.push((sheet, vec![slicer])),
        }
        self.set_slicer_state((caches, sheets))?;
        Ok(id)
    }

    /// The column or field name of a source.
    pub fn slicer_source_name(&self, source: &SlicerSource) -> String {
        match source {
            SlicerSource::Table { table, column } => self
                .table(*table)
                .and_then(|(_, t)| t.columns.iter().find(|c| c.id == *column))
                .map(|c| c.name.clone())
                .unwrap_or_default(),
            SlicerSource::Pivot { cache, field, .. } => self
                .pivot_cache(*cache)
                .and_then(|c| c.fields.get(*field as usize))
                .map(|f| f.name.clone())
                .unwrap_or_default(),
        }
    }

    /// The buttons of cache `name` in display order.
    pub fn slicer_items(&self, name: &str) -> Vec<SlicerItem> {
        let Some(cache) = self.slicer_cache(name) else {
            return Vec::new();
        };
        let mut items = match &cache.source {
            SlicerSource::Table { table, column } => {
                let Some((sheet, t)) = self.table(*table) else {
                    return Vec::new();
                };
                let Some(i) = t.columns.iter().position(|c| c.id == *column) else {
                    return Vec::new();
                };
                self.table_slicer_items(sheet, t.id, t.c0 + i as u32)
            }
            SlicerSource::Pivot {
                cache: id, field, ..
            } => {
                let Some(c) = self.pivot_cache(*id) else {
                    return Vec::new();
                };
                let Some(f) = c.fields.get(*field as usize) else {
                    return Vec::new();
                };
                let probe = crate::PivotTable {
                    rows: vec![crate::pivot::AxisField::from(*field)],
                    ..crate::PivotTable::new(0, "x", *id, 0, 0)
                };
                probe
                    .item_order(c, *field)
                    .into_iter()
                    .map(|i| SlicerItem {
                        name: f
                            .shared_items
                            .get(i as usize)
                            .map(|it| item_text(it, f.number_format.as_deref()))
                            .unwrap_or_default(),
                        selected: !cache.hidden.contains(&i),
                        has_data: true,
                    })
                    .collect()
            }
        };
        if cache.sort == SlicerSort::Descending {
            // Blanks stay last.
            let blanks: Vec<SlicerItem> = items
                .iter()
                .filter(|i| i.name.is_empty())
                .cloned()
                .collect();
            items.retain(|i| !i.name.is_empty());
            items.reverse();
            items.extend(blanks);
        }
        items
    }

    /// Clicks on a slicer: only `selected` (displayed values, any case)
    /// pass; `None` clears the filter (Clear Filter). Table sources set
    /// the column's value filter and apply the table's filters; pivot
    /// sources update the cache and re-render the connected pivot tables.
    pub fn set_slicer_selection(
        &mut self,
        name: &str,
        selected: Option<&[String]>,
    ) -> Result<crate::sortfilter::FilterChange, Error> {
        let cache = self
            .slicer_cache(name)
            .cloned()
            .ok_or_else(|| Error::InvalidSlicer(format!("unknown slicer cache {name:?}")))?;
        let items = self.slicer_items(name);
        let wanted: Option<BTreeSet<String>> =
            selected.map(|s| s.iter().map(|v| fold(v)).collect());
        // Every item selected = no filter.
        let wanted = wanted.filter(|w| items.iter().any(|i| !w.contains(&fold(&i.name))));
        match &cache.source {
            SlicerSource::Table { table, column } => {
                let (sheet, t) = self
                    .table(*table)
                    .map(|(s, t)| (s, t.clone()))
                    .ok_or(Error::UnknownTable(*table))?;
                let i = t
                    .columns
                    .iter()
                    .position(|c| c.id == *column)
                    .ok_or_else(|| Error::InvalidSlicer("the column is gone".into()))?;
                if t.auto_filter.is_none() {
                    // A slicer filters through the table's AutoFilter.
                    let mut tables = self.tables(sheet).to_vec();
                    if let Some(x) = tables.iter_mut().find(|x| x.id == t.id) {
                        x.auto_filter = Some(x.filter_range());
                    }
                    self.set_tables(sheet, tables)?;
                }
                let filter = wanted.map(|w| Filter::Values {
                    values: items
                        .iter()
                        .filter(|i| w.contains(&fold(&i.name)))
                        .map(|i| i.name.clone())
                        .collect(),
                });
                self.set_table_filter_column(sheet, t.id, t.c0 + i as u32, filter)?;
                self.apply_table_filter(sheet, t.id)
            }
            SlicerSource::Pivot { field, pivots, .. } => {
                let order = self.pivot_item_order(&cache.source);
                let hidden: BTreeSet<u32> = match &wanted {
                    None => BTreeSet::new(),
                    Some(w) => order
                        .iter()
                        .zip(&items)
                        .filter(|(_, it)| !w.contains(&fold(&it.name)))
                        .map(|(i, _)| *i)
                        .collect(),
                };
                if let Some(c) = self
                    .slicer_caches
                    .iter_mut()
                    .find(|c| c.name.eq_ignore_ascii_case(name))
                {
                    c.hidden = hidden.clone();
                }
                let mut out = crate::sortfilter::FilterChange::default();
                for p in pivots.clone() {
                    let r = self.filter_pivot_field(p, *field, &hidden)?;
                    out.recalc.changed.extend(r.changed);
                }
                Ok(out)
            }
        }
    }

    /// The shared item indexes of a pivot source in the slicer's order.
    fn pivot_item_order(&self, source: &SlicerSource) -> Vec<u32> {
        let SlicerSource::Pivot { cache, field, .. } = source else {
            return Vec::new();
        };
        let Some(c) = self.pivot_cache(*cache) else {
            return Vec::new();
        };
        let probe = crate::PivotTable {
            rows: vec![crate::pivot::AxisField::from(*field)],
            ..crate::PivotTable::new(0, "x", *cache, 0, 0)
        };
        let mut order = probe.item_order(c, *field);
        let sort = self
            .slicer_caches
            .iter()
            .find(|x| x.source == *source)
            .map(|x| x.sort)
            .unwrap_or_default();
        if sort == SlicerSort::Descending {
            let blank = |i: &u32| {
                matches!(
                    c.fields[*field as usize].shared_items.get(*i as usize),
                    Some(Item::Blank)
                )
            };
            let blanks: Vec<u32> = order.iter().copied().filter(blank).collect();
            order.retain(|i| !blank(i));
            order.reverse();
            order.extend(blanks);
        }
        order
    }

    /// Filters field `field` of pivot table `id` to everything but
    /// `hidden` (shared item indexes) and re-renders it: hidden items of
    /// a row / column field, the selection of a page field, or a field
    /// filter for a field on no axis.
    pub fn filter_pivot_field(
        &mut self,
        id: u32,
        field: u32,
        hidden: &BTreeSet<u32>,
    ) -> Result<Recalc, Error> {
        let (_, t) = self.pivot(id).ok_or(Error::UnknownPivot(id))?;
        let mut def = t.clone();
        let count = self
            .pivot_cache(def.cache_id)
            .and_then(|c| c.fields.get(field as usize))
            .map_or(0, |f| f.shared_items.len() as u32);
        let selected = || PageSelection::Items {
            items: (0..count).filter(|i| !hidden.contains(i)).collect(),
        };
        if let Some(a) = def
            .rows
            .iter_mut()
            .chain(def.cols.iter_mut())
            .find(|a| a.field == field)
        {
            a.hidden_items = hidden.clone();
        } else if let Some(p) = def.filters.iter_mut().find(|p| p.field == field) {
            p.selected = if hidden.is_empty() {
                PageSelection::All
            } else {
                selected()
            };
        } else {
            def.field_filters.retain(|f| f.field != field);
            if !hidden.is_empty() {
                def.field_filters.push(PageField {
                    field,
                    selected: selected(),
                });
            }
        }
        self.update_pivot(id, def)
    }

    /// Report Connections: the pivot tables cache `name` filters. Newly
    /// connected tables get the slicer's filter, disconnected ones lose
    /// it.
    pub fn set_slicer_connections(
        &mut self,
        name: &str,
        pivots: Vec<u32>,
    ) -> Result<Recalc, Error> {
        let cache = self
            .slicer_cache(name)
            .cloned()
            .ok_or_else(|| Error::InvalidSlicer(format!("unknown slicer cache {name:?}")))?;
        let SlicerSource::Pivot {
            cache: pc,
            field,
            pivots: old,
        } = &cache.source
        else {
            return Err(Error::InvalidSlicer(
                "a table slicer has no report connections".into(),
            ));
        };
        let mut pivots = pivots;
        pivots.sort_unstable();
        pivots.dedup();
        let new_source = SlicerSource::Pivot {
            cache: *pc,
            field: *field,
            pivots: pivots.clone(),
        };
        if !self.slicer_source_exists(&new_source) {
            return Err(Error::InvalidSlicer(
                "connect pivot tables of the same cache only".into(),
            ));
        }
        let mut out = Recalc::default();
        for p in old.iter().filter(|p| !pivots.contains(p)) {
            out.changed.extend(
                self.filter_pivot_field(*p, *field, &BTreeSet::new())?
                    .changed,
            );
        }
        for p in pivots.iter().filter(|p| !old.contains(p)) {
            out.changed
                .extend(self.filter_pivot_field(*p, *field, &cache.hidden)?.changed);
        }
        if let Some(c) = self
            .slicer_caches
            .iter_mut()
            .find(|c| c.name.eq_ignore_ascii_case(name))
        {
            c.source = new_source;
        }
        Ok(out)
    }

    /// Removes the caches whose source is gone (a deleted table, column,
    /// pivot cache) and their slicers; drops deleted pivot tables from
    /// the connections. `true` when something changed.
    pub fn prune_slicers(&mut self) -> bool {
        if self.slicer_caches.is_empty() {
            return false;
        }
        let before = self.slicer_state();
        let pivot_ok = |wb: &Workbook, id: u32, cache: u32| {
            wb.pivot(id).is_some_and(|(_, t)| t.cache_id == cache)
        };
        let mut caches = before.0.clone();
        for c in &mut caches {
            if let SlicerSource::Pivot { cache, pivots, .. } = &mut c.source {
                let cache = *cache;
                pivots.retain(|p| pivot_ok(self, *p, cache));
            }
        }
        caches.retain(|c| self.slicer_source_exists(&c.source));
        // A cache no slicer shows any more goes too (a deleted sheet).
        let live: Vec<String> = before
            .1
            .iter()
            .filter(|(s, _)| self.engine().sheet_name(*s).is_some())
            .flat_map(|(_, l)| l.iter().map(|x| x.cache.to_ascii_lowercase()))
            .collect();
        caches.retain(|c| live.contains(&c.name.to_ascii_lowercase()));
        let sheets: Vec<(SheetId, Vec<Slicer>)> = before
            .1
            .iter()
            .filter(|(s, _)| self.engine().sheet_name(*s).is_some())
            .map(|(s, list)| {
                (
                    *s,
                    list.iter()
                        .filter(|x| caches.iter().any(|c| c.name.eq_ignore_ascii_case(&x.cache)))
                        .cloned()
                        .collect(),
                )
            })
            .collect();
        let after = (caches, sheets);
        let changed = {
            let norm = |s: &SlicerState| {
                (
                    s.0.clone(),
                    s.1.iter()
                        .filter(|(_, l)| !l.is_empty())
                        .cloned()
                        .collect::<Vec<_>>(),
                )
            };
            norm(&after) != norm(&before)
        };
        if changed {
            // Valid by construction.
            let _ = self.set_slicer_state(after);
        }
        changed
    }

    /// Moves slicer anchors with a row/column insert or delete.
    pub(crate) fn shift_slicers(&mut self, sheet: SheetId, op: StructuralOp) {
        if let Ok(d) = self.sheet_data_mut(sheet) {
            for s in &mut d.slicers {
                s.anchor.shift(op);
            }
        }
    }

    /// The value of a table slicer's column cell as the slicer shows it.
    pub(crate) fn slicer_text(&self, c: CellCoord) -> String {
        if matches!(self.value(c), Value::Empty) {
            String::new()
        } else {
            self.display_text(c)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::CellOffset;
    use crate::tables::Table;

    fn anchor() -> ChartAnchor {
        ChartAnchor::OneCell {
            from: CellOffset {
                col: 5,
                row: 1,
                col_offset: 0,
                row_offset: 0,
            },
            width: 1_828_800,
            height: 2_524_125,
        }
    }

    /// Region | Qty in A1:B6 as a table.
    fn book() -> (Workbook, u32) {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let rows = [
            ["Region", "Qty"],
            ["East", "1"],
            ["West", "2"],
            ["east", "3"],
            ["North", "4"],
            ["", "5"],
        ];
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                if !v.is_empty() {
                    wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                        .unwrap();
                }
            }
        }
        let t = Table::new(1, "Sales", 0, 0, 5, 1, &["Region".into(), "Qty".into()]);
        wb.set_tables(s, vec![t]).unwrap();
        (wb, 1)
    }

    #[test]
    fn builtin_styles() {
        assert!(is_builtin_slicer_style("SlicerStyleLight1"));
        assert!(is_builtin_slicer_style("SlicerStyleDark6"));
        assert!(is_builtin_slicer_style("SlicerStyleOther2"));
        assert!(!is_builtin_slicer_style("SlicerStyleDark7"));
        assert!(!is_builtin_slicer_style("TableStyleLight1"));
    }

    #[test]
    fn insert_names_and_items() {
        let (mut wb, t) = book();
        let s = SheetId(0);
        let source = SlicerSource::Table {
            table: t,
            column: 1,
        };
        let id = wb.insert_slicer(s, source.clone(), anchor()).unwrap();
        let id2 = wb.insert_slicer(s, source, anchor()).unwrap();
        let slicers = wb.slicers(s);
        assert_eq!((slicers[0].id, slicers[1].id), (id, id2));
        assert_eq!(slicers[0].name, "Region");
        assert_eq!(slicers[1].name, "Region 1");
        assert_eq!(wb.slicer_caches()[0].name, "Slicer_Region");
        assert_eq!(wb.slicer_caches()[1].name, "Slicer_Region1");
        let items = wb.slicer_items("Slicer_Region");
        let names: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["East", "North", "West", ""]);
        assert!(items.iter().all(|i| i.selected && i.has_data));
    }

    #[test]
    fn table_selection_filters_rows_and_clears() {
        let (mut wb, t) = book();
        let s = SheetId(0);
        wb.insert_slicer(
            s,
            SlicerSource::Table {
                table: t,
                column: 1,
            },
            anchor(),
        )
        .unwrap();
        wb.set_slicer_selection("Slicer_Region", Some(&["east".into()]))
            .unwrap();
        let hidden: Vec<u32> = (1..=5).filter(|r| wb.row_info(s, *r).hidden).collect();
        assert_eq!(hidden, [2, 4, 5]);
        let items = wb.slicer_items("Slicer_Region");
        assert_eq!(
            items.iter().map(|i| i.selected).collect::<Vec<_>>(),
            [true, false, false, false]
        );
        // Selecting everything removes the filter.
        let all: Vec<String> = items.iter().map(|i| i.name.clone()).collect();
        wb.set_slicer_selection("Slicer_Region", Some(&all))
            .unwrap();
        assert!((1..=5).all(|r| !wb.row_info(s, r).hidden));
        assert!(wb.tables(s)[0]
            .auto_filter
            .as_ref()
            .unwrap()
            .columns
            .is_empty());
        wb.set_slicer_selection("Slicer_Region", Some(&["West".into(), "".into()]))
            .unwrap();
        let hidden: Vec<u32> = (1..=5).filter(|r| wb.row_info(s, *r).hidden).collect();
        assert_eq!(hidden, [1, 3, 4]);
        wb.set_slicer_selection("Slicer_Region", None).unwrap();
        assert!((1..=5).all(|r| !wb.row_info(s, r).hidden));
    }

    #[test]
    fn other_filters_dim_items() {
        let (mut wb, t) = book();
        let s = SheetId(0);
        wb.insert_slicer(
            s,
            SlicerSource::Table {
                table: t,
                column: 1,
            },
            anchor(),
        )
        .unwrap();
        wb.set_table_filter_column(
            s,
            t,
            1,
            Some(Filter::Values {
                values: vec!["1".into(), "2".into()],
            }),
        )
        .unwrap();
        let items = wb.slicer_items("Slicer_Region");
        let data: Vec<(&str, bool)> = items
            .iter()
            .map(|i| (i.name.as_str(), i.has_data))
            .collect();
        assert_eq!(
            data,
            [
                ("East", true),
                ("North", false),
                ("West", true),
                ("", false)
            ]
        );
    }

    #[test]
    fn pruning_follows_deleted_tables_and_columns() {
        let (mut wb, t) = book();
        let s = SheetId(0);
        wb.insert_slicer(
            s,
            SlicerSource::Table {
                table: t,
                column: 2,
            },
            anchor(),
        )
        .unwrap();
        assert!(!wb.prune_slicers());
        wb.delete_cols(s, 1, 1).unwrap();
        assert!(wb.prune_slicers());
        assert!(wb.slicers(s).is_empty());
        assert!(wb.slicer_caches().is_empty());
    }

    #[test]
    fn validation_and_anchor_shift() {
        let (mut wb, t) = book();
        let s = SheetId(0);
        assert!(wb
            .insert_slicer(
                s,
                SlicerSource::Table {
                    table: t,
                    column: 9
                },
                anchor()
            )
            .is_err());
        wb.insert_slicer(
            s,
            SlicerSource::Table {
                table: t,
                column: 1,
            },
            anchor(),
        )
        .unwrap();
        let mut state = wb.slicer_state();
        state.1[0].1[0].cache = "Nope".into();
        assert!(wb.set_slicer_state(state).is_err());
        wb.insert_rows(s, 0, 2).unwrap();
        match wb.slicers(s)[0].anchor {
            ChartAnchor::OneCell { from, .. } => assert_eq!(from.row, 3),
            _ => panic!(),
        }
    }

    /// Region | Product | Sales in A1:C6 with two pivot tables (Region on
    /// rows, Product on rows) on one cache.
    fn pivots() -> (Workbook, u32, u32, u32) {
        use crate::pivot::{DataField, PivotFields, PivotSource};
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let rows = [
            ["Region", "Product", "Sales"],
            ["East", "Apple", "10"],
            ["East", "Pear", "20"],
            ["West", "Apple", "30"],
            ["North", "Pear", "40"],
            ["West", "Pear", "50"],
        ];
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                wb.set_input(CellCoord::new(s, r as u32, c as u32), v)
                    .unwrap();
            }
        }
        let src = PivotSource::range("Sheet1", 0, 0, 5, 2);
        let f = |rows: u32| PivotFields {
            rows: vec![rows.into()],
            values: vec![DataField::sum(2)],
            ..Default::default()
        };
        let (a, _) = wb.create_pivot(src.clone(), s, 0, 5, f(0)).unwrap();
        let (b, _) = wb.create_pivot(src, s, 0, 9, f(1)).unwrap();
        let cache = wb.pivot(a).unwrap().1.cache_id;
        (wb, cache, a, b)
    }

    fn total(wb: &Workbook, id: u32) -> Value {
        let e = wb.pivot_output(id).unwrap().extent;
        wb.value(CellCoord::new(SheetId(0), e.r1, e.c1))
    }

    #[test]
    fn pivot_slicers_filter_connected_tables() {
        let (mut wb, cache, a, b) = pivots();
        let s = SheetId(0);
        // Region slicer connected to both tables: on rows of A, on no axis of B.
        wb.insert_slicer(
            s,
            SlicerSource::Pivot {
                cache,
                field: 0,
                pivots: vec![a, b],
            },
            anchor(),
        )
        .unwrap();
        let items = wb.slicer_items("Slicer_Region");
        let names: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["East", "North", "West"]);
        assert_eq!(total(&wb, a), Value::Number(150.0));
        wb.set_slicer_selection("Slicer_Region", Some(&["West".into()]))
            .unwrap();
        assert_eq!(total(&wb, a), Value::Number(80.0));
        assert_eq!(total(&wb, b), Value::Number(80.0));
        let tb = &wb.pivot(b).unwrap().1;
        assert_eq!(tb.field_filters.len(), 1);
        assert_eq!(
            wb.slicer_items("Slicer_Region")
                .iter()
                .map(|i| i.selected)
                .collect::<Vec<_>>(),
            [false, false, true]
        );
        // Report Connections: B leaves and loses the filter.
        wb.set_slicer_connections("Slicer_Region", vec![a]).unwrap();
        assert_eq!(total(&wb, b), Value::Number(150.0));
        assert!(wb.pivot(b).unwrap().1.field_filters.is_empty());
        wb.set_slicer_connections("Slicer_Region", vec![a, b])
            .unwrap();
        assert_eq!(total(&wb, b), Value::Number(80.0));
        wb.set_slicer_selection("Slicer_Region", None).unwrap();
        assert_eq!(total(&wb, a), Value::Number(150.0));
        assert_eq!(total(&wb, b), Value::Number(150.0));
        // Deleting a table drops it from the connections.
        wb.delete_pivot(b).unwrap();
        assert!(wb.prune_slicers());
        match &wb.slicer_caches()[0].source {
            SlicerSource::Pivot { pivots, .. } => assert_eq!(pivots, &vec![a]),
            s => panic!("{s:?}"),
        }
    }
}
