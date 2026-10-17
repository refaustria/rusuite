//! Pivot tables in the [`Workbook`]: caches, rendering into cells,
//! refresh, and following sheet edits.

use std::collections::{BTreeSet, HashMap, HashSet};

use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{
    CellContent, CellCoord, CellShift, NameScope, PivotData, PivotEntry, PivotItemName, Recalc,
    SheetId, StructuralOp, Value,
};

use super::{
    AxisField, CacheField, DataField, Item, PageField, PageSelection, PivotCache, PivotCell,
    PivotFields, PivotOutput, PivotRect, PivotSource, PivotTable, ShowAs, SortOrder,
};
use crate::style::{CellStyle, StyleId};
use crate::workbook::Workbook;
use crate::Error;

/// A rendered table ready to be written.
struct Render {
    sheet: SheetId,
    id: u32,
    out: PivotOutput,
}

fn bounding(cells: &[(u32, u32)]) -> PivotRect {
    let r0 = cells.iter().map(|c| c.0).min().unwrap_or(0);
    let c0 = cells.iter().map(|c| c.1).min().unwrap_or(0);
    let r1 = cells.iter().map(|c| c.0).max().unwrap_or(0);
    let c1 = cells.iter().map(|c| c.1).max().unwrap_or(0);
    PivotRect::new(r0, c0, r1, c1)
}

/// `name`, else `name2`, `name3`, … not in `used` (lower case).
fn unique_name(name: &str, used: &mut HashSet<String>) -> String {
    let mut candidate = name.to_owned();
    let mut n = 2;
    while used.contains(&candidate.to_lowercase()) {
        candidate = format!("{name}{n}");
        n += 1;
    }
    used.insert(candidate.to_lowercase());
    candidate
}

impl PivotTable {
    /// Maps the cache field indices after a cache change (`map[old] =
    /// new`, `item_maps[old field][old item] = new item`); fields that
    /// disappeared are removed from the table, items that disappeared from
    /// its filters and orders.
    pub(crate) fn remap_fields(&mut self, map: &[Option<u32>], item_maps: &[Vec<Option<u32>>]) {
        let m = |f: u32| map.get(f as usize).copied().flatten();
        let item = |f: u32, i: u32| -> Option<u32> {
            item_maps
                .get(f as usize)?
                .get(i as usize)
                .copied()
                .flatten()
        };
        let items = |f: u32, set: &BTreeSet<u32>| -> BTreeSet<u32> {
            set.iter().filter_map(|i| item(f, *i)).collect()
        };
        // Data fields first: sorts and value filters refer to their positions.
        let mut value_map: Vec<Option<u32>> = Vec::with_capacity(self.values.len());
        let mut kept = 0u32;
        self.values = std::mem::take(&mut self.values)
            .into_iter()
            .filter_map(|d| {
                let Some(field) = m(d.field) else {
                    value_map.push(None);
                    return None;
                };
                value_map.push(Some(kept));
                kept += 1;
                let show_as = match d.show_as.base_field() {
                    Some(base_field) => match m(base_field) {
                        Some(b) => {
                            let s = d.show_as.with_base_field(b);
                            match s.base_item() {
                                Some(super::BaseItem::Item { item: i }) => s.with_base_item(
                                    item(base_field, i).map_or(super::BaseItem::Previous, |item| {
                                        super::BaseItem::Item { item }
                                    }),
                                ),
                                _ => s,
                            }
                        }
                        None => ShowAs::Normal,
                    },
                    None => d.show_as,
                };
                Some(DataField {
                    field,
                    show_as,
                    ..d
                })
            })
            .collect();
        let data = |d: u32| value_map.get(d as usize).copied().flatten();
        let axis = |list: &mut Vec<AxisField>| {
            *list = std::mem::take(list)
                .into_iter()
                .filter_map(|a| {
                    let nf = m(a.field)?;
                    let of = a.field;
                    let sort = match a.sort {
                        SortOrder::ByValue {
                            data: d,
                            descending,
                        } => match data(d) {
                            Some(d) => SortOrder::ByValue {
                                data: d,
                                descending,
                            },
                            None => SortOrder::Ascending,
                        },
                        s => super::group::remap_sort(s, |i| item(of, i)),
                    };
                    let filter = a.filter.and_then(|f| f.remap_data(data));
                    Some(AxisField {
                        collapsed_items: items(of, &a.collapsed_items),
                        hidden_items: items(of, &a.hidden_items),
                        field: nf,
                        sort,
                        filter,
                        ..a
                    })
                })
                .collect();
        };
        axis(&mut self.rows);
        axis(&mut self.cols);
        let pages = |list: Vec<PageField>| -> Vec<PageField> {
            list.into_iter()
                .filter_map(|p| {
                    let nf = m(p.field)?;
                    let selected = match &p.selected {
                        PageSelection::All => PageSelection::All,
                        PageSelection::Items { items: set } => {
                            let s = items(p.field, set);
                            if s.is_empty() && !set.is_empty() {
                                PageSelection::All
                            } else {
                                PageSelection::Items { items: s }
                            }
                        }
                    };
                    Some(PageField {
                        field: nf,
                        selected,
                    })
                })
                .collect()
        };
        self.filters = pages(std::mem::take(&mut self.filters));
        self.field_filters = pages(std::mem::take(&mut self.field_filters));
    }
}

/// A cache rebuilt from a source read (`fields`, `records`) keeping what
/// `old` knew: shared items and groupings of the fields that are still
/// there (by name), then the fields without a source column (level and
/// manual group fields, calculated fields) and the calculated items.
/// Returns the cache with `map` and `item_maps` from `old`.
#[allow(clippy::type_complexity)]
fn rebuild_cache(
    old: &PivotCache,
    id: u32,
    source: PivotSource,
    fields: Vec<CacheField>,
    records: Vec<Vec<Item>>,
) -> (PivotCache, Vec<Option<u32>>, Vec<Vec<Option<u32>>>) {
    let mut map: Vec<Option<u32>> = vec![None; old.fields.len()];
    let mut new_fields = Vec::with_capacity(fields.len());
    for (ni, mut f) in fields.into_iter().enumerate() {
        let oi =
            old.fields.iter().enumerate().position(|(i, of)| {
                of.is_source(i as u32) && of.name.eq_ignore_ascii_case(&f.name)
            });
        if let Some(oi) = oi {
            map[oi] = Some(ni as u32);
            let of = &old.fields[oi];
            f.shared_items = of.shared_items.clone();
            f.group = of.group.clone().map(|mut g| {
                g.base = ni as u32;
                g
            });
        }
        new_fields.push(f);
    }
    for (oi, of) in old.fields.iter().enumerate() {
        if of.is_source(oi as u32) {
            continue;
        }
        let mut f = of.clone();
        if let Some(g) = f.group.as_mut() {
            let Some(b) = map.get(g.base as usize).copied().flatten() else {
                continue;
            };
            g.base = b;
        }
        map[oi] = Some(new_fields.len() as u32);
        new_fields.push(f);
    }
    let n = new_fields.len();
    let mut records = records;
    for r in &mut records {
        r.resize(n, Item::Blank);
    }
    let mut cache = PivotCache {
        id,
        source,
        fields: new_fields,
        records,
        refresh_on_load: old.refresh_on_load,
        stale: false,
        raw: None,
        calculated_items: old
            .calculated_items
            .iter()
            .filter_map(|c| {
                Some(super::CalculatedItem {
                    field: map.get(c.field as usize).copied().flatten()?,
                    ..c.clone()
                })
            })
            .collect(),
    };
    cache.normalize();
    cache.regroup();
    // Items by identity (text ignoring case); groups can change items.
    let item_maps = old
        .fields
        .iter()
        .enumerate()
        .map(|(oi, of)| match map[oi] {
            None => vec![None; of.shared_items.len()],
            Some(nf) => {
                let nitems = &cache.fields[nf as usize].shared_items;
                of.shared_items
                    .iter()
                    .map(|it| {
                        let k = it.key();
                        nitems.iter().position(|x| x.key() == k).map(|p| p as u32)
                    })
                    .collect()
            }
        })
        .collect();
    (cache, map, item_maps)
}

impl Workbook {
    // --- queries --------------------------------------------------------------------

    /// The pivot caches of the workbook.
    pub fn pivot_caches(&self) -> &[PivotCache] {
        &self.pivot_caches
    }

    pub fn pivot_cache(&self, id: u32) -> Option<&PivotCache> {
        self.pivot_caches.iter().find(|c| c.id == id)
    }

    /// The pivot tables of `sheet`.
    pub fn pivots(&self, sheet: SheetId) -> &[PivotTable] {
        &self.sheet_data(sheet).pivots
    }

    /// Pivot table `id` and its sheet.
    pub fn pivot(&self, id: u32) -> Option<(SheetId, &PivotTable)> {
        self.sheets()
            .into_iter()
            .find_map(|(s, _)| self.pivots(s).iter().find(|p| p.id == id).map(|p| (s, p)))
    }

    /// The layout of pivot table `id` as last rendered.
    pub fn pivot_output(&self, id: u32) -> Option<&PivotOutput> {
        let (s, _) = self.pivot(id)?;
        self.sheet_data(s).pivot_outputs.get(&id)
    }

    /// The pivot table that `c` belongs to (its table or page cells).
    pub fn pivot_at(&self, c: CellCoord) -> Option<&PivotTable> {
        let data = self.sheet_data(c.sheet);
        data.pivots.iter().find(|p| {
            p.location.contains(c.row, c.col)
                && data
                    .pivot_outputs
                    .get(&p.id)
                    .map_or(true, |o| o.covers(c.row, c.col))
        })
    }

    /// The pivot cell at `c`: its table id and layout information.
    pub fn pivot_cell(&self, c: CellCoord) -> Option<(u32, &PivotCell)> {
        let data = self.sheet_data(c.sheet);
        data.pivots.iter().find_map(|p| {
            if !p.location.contains(c.row, c.col) {
                return None;
            }
            data.pivot_outputs
                .get(&p.id)?
                .cell(c.row, c.col)
                .map(|cell| (p.id, cell))
        })
    }

    /// The pivot cells of `range` (for snapshots).
    pub fn pivot_cells_in(&self, range: crate::CellRange) -> Vec<(u32, u32)> {
        let data = self.sheet_data(range.sheet);
        let r = PivotRect::new(range.r0, range.c0, range.r1, range.c1);
        let mut out = Vec::new();
        for p in &data.pivots {
            if !p.location.intersects(&r) {
                continue;
            }
            if let Some(o) = data.pivot_outputs.get(&p.id) {
                out.extend(
                    o.cells
                        .iter()
                        .filter(|c| r.contains(c.row, c.col))
                        .map(|c| (c.row, c.col)),
                );
            }
        }
        out
    }

    /// Fails with [`Error::PivotCell`] when `range` holds a cell of a
    /// pivot table (direct edits of pivot cells are refused, as in Excel).
    pub fn check_pivot_edit(&self, range: crate::CellRange) -> Result<(), Error> {
        let data = self.sheet_data(range.sheet);
        let r = PivotRect::new(range.r0, range.c0, range.r1, range.c1);
        for p in &data.pivots {
            if !p.location.intersects(&r) {
                continue;
            }
            let hit = match data.pivot_outputs.get(&p.id) {
                Some(o) => o.cells.iter().any(|c| r.contains(c.row, c.col)),
                None => true,
            };
            if hit {
                return Err(Error::PivotCell);
            }
        }
        Ok(())
    }

    /// Ids of the pivot tables whose cache is stale (the source changed
    /// since the last refresh), in sheet order.
    pub fn stale_pivots(&self) -> Vec<u32> {
        let stale: HashSet<u32> = self
            .pivot_caches
            .iter()
            .filter(|c| c.stale)
            .map(|c| c.id)
            .collect();
        self.sheets()
            .into_iter()
            .flat_map(|(s, _)| self.pivots(s).iter())
            .filter(|p| stale.contains(&p.cache_id))
            .map(|p| p.id)
            .collect()
    }

    /// The range a source denotes now (`None`: its sheet or name is gone).
    pub fn pivot_source_range(&self, source: &PivotSource) -> Option<crate::CellRange> {
        match source {
            PivotSource::Range {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let s = self.sheet_id(sheet)?;
                Some(crate::CellRange::new(s, *r0, *c0, *r1, *c1))
            }
            PivotSource::Table { name } | PivotSource::Name { name } => {
                // A table: its header and data rows.
                if let Some((s, t)) = self.table_by_name(name) {
                    let (_, last) = t.data_rows();
                    return Some(crate::CellRange::new(s, t.r0, t.c0, last, t.c1));
                }
                let def = self.name(name, NameScope::Workbook)?;
                self.name_ranges(&def).into_iter().next()
            }
        }
    }

    /// Reads a source: the field names of its first row and the records
    /// below (whole columns stop at the used range). Fails with
    /// [`Error::InvalidPivot`] for a missing source or an empty header
    /// cell.
    pub fn read_pivot_source(
        &self,
        source: &PivotSource,
    ) -> Result<(Vec<CacheField>, Vec<Vec<Item>>), Error> {
        let bad = |m: &str| Error::InvalidPivot(m.into());
        let range = self
            .pivot_source_range(source)
            .ok_or_else(|| bad("the source range does not exist"))?;
        let (used_r, used_c) = self.used_range(range.sheet).unwrap_or((0, 0));
        let r1 = range.r1.min(used_r.max(range.r0));
        let c1 = range.c1.min(used_c.max(range.c0));
        if u64::from(r1 - range.r0 + 1) * u64::from(c1 - range.c0 + 1) > 4_000_000 {
            return Err(bad("the source range is too large"));
        }
        let mut used = HashSet::new();
        let mut fields = Vec::new();
        for col in range.c0..=c1 {
            let c = CellCoord::new(range.sheet, range.r0, col);
            let fmt = self.style(c).number_format.clone();
            let name = crate::numfmt::display_value(&self.value(c), fmt.as_deref());
            if name.trim().is_empty() {
                return Err(bad("the source needs a name in every header cell"));
            }
            let mut f = CacheField::new(&unique_name(&name, &mut used));
            f.number_format = (range.r0 < r1)
                .then(|| {
                    (range.r0 + 1..=r1)
                        .map(|row| CellCoord::new(range.sheet, row, col))
                        .find(|c| !matches!(self.value(*c), Value::Empty))
                        .and_then(|c| self.style(c).number_format.clone())
                })
                .flatten();
            fields.push(f);
        }
        let records = (range.r0 + 1..=r1)
            .filter(|_| range.r0 < r1)
            .map(|row| {
                (range.c0..=c1)
                    .map(|col| Item::from_value(&self.value(CellCoord::new(range.sheet, row, col))))
                    .collect()
            })
            .collect();
        Ok((fields, records))
    }

    // --- rendering --------------------------------------------------------------------

    pub(crate) fn locate_pivot(&self, id: u32) -> Result<(SheetId, usize), Error> {
        for (s, _) in self.sheets() {
            if let Some(i) = self.pivots(s).iter().position(|p| p.id == id) {
                return Ok((s, i));
            }
        }
        Err(Error::UnknownPivot(id))
    }

    fn compute_pivot(&self, sheet: SheetId, id: u32) -> Result<Render, Error> {
        let table = self
            .pivots(sheet)
            .iter()
            .find(|p| p.id == id)
            .ok_or(Error::UnknownPivot(id))?;
        let cache = self
            .pivot_cache(table.cache_id)
            .ok_or_else(|| Error::InvalidPivot(format!("no cache {}", table.cache_id)))?;
        Ok(Render {
            sheet,
            id,
            out: table.compute(cache)?,
        })
    }

    /// Fails with [`Error::PivotOverlap`] when `r` would overwrite cells
    /// with content that are not cells of the table itself, or another
    /// pivot table.
    fn check_render(&self, r: &Render) -> Result<(), Error> {
        let data = self.sheet_data(r.sheet);
        let own = data.pivot_outputs.get(&r.id);
        let mut conflicts = Vec::new();
        for c in &r.out.cells {
            if own.is_some_and(|o| o.covers(c.row, c.col)) {
                continue;
            }
            let at = CellCoord::new(r.sheet, c.row, c.col);
            let other = data.pivots.iter().any(|p| {
                p.id != r.id
                    && p.location.contains(c.row, c.col)
                    && data
                        .pivot_outputs
                        .get(&p.id)
                        .map_or(true, |o| o.covers(c.row, c.col))
            });
            if other || !matches!(self.content(at), CellContent::Empty) {
                conflicts.push((c.row, c.col));
            }
        }
        if conflicts.is_empty() {
            return Ok(());
        }
        let b = bounding(&conflicts);
        Err(Error::PivotOverlap {
            r0: b.r0,
            c0: b.c0,
            r1: b.r1,
            c1: b.c1,
        })
    }

    /// Records the state of `at` before a pivot operation changes it.
    fn journal(&mut self, at: CellCoord) {
        if self.pivot_journal.is_none() {
            return;
        }
        let content = self.content(at).clone();
        let style = self.cell_style_id(at);
        if let Some(j) = self.pivot_journal.as_mut() {
            if j.seen.insert(at) {
                j.cells.push((at, content, style));
            }
        }
    }

    /// Starts recording the cells that pivot table operations write
    /// (create, update, refresh, move, delete) with their previous state,
    /// for undo. See [`take_pivot_journal`](Self::take_pivot_journal).
    pub fn start_pivot_journal(&mut self) {
        self.pivot_journal = Some(super::PivotJournal::default());
    }

    /// Stops recording and returns the journal.
    pub fn take_pivot_journal(&mut self) -> super::PivotJournal {
        self.pivot_journal.take().unwrap_or_default()
    }

    /// Replaces every pivot cache and table (undo): no cells are written;
    /// the layouts are recomputed. Sheets that are not listed lose their
    /// tables; tables of sheets that do not exist are dropped.
    pub fn restore_pivot_state(
        &mut self,
        caches: Vec<PivotCache>,
        tables: Vec<(SheetId, Vec<PivotTable>)>,
    ) {
        let sheets: Vec<SheetId> = self.sheets().into_iter().map(|(s, _)| s).collect();
        for &s in &sheets {
            if let Ok(d) = self.sheet_data_mut(s) {
                d.pivots.clear();
                d.pivot_outputs.clear();
            }
        }
        self.set_pivot_caches(caches);
        for (s, list) in tables {
            if sheets.contains(&s) {
                if let Ok(d) = self.sheet_data_mut(s) {
                    d.pivots = list;
                }
            }
        }
        for s in sheets {
            self.rebuild_pivot_outputs(s);
        }
    }

    /// The style of a written pivot cell: the cell's own style with the
    /// table's number format and indent.
    fn pivot_style(&mut self, at: CellCoord, cell: &PivotCell) -> StyleId {
        let own = self.cell_style_id(at);
        let mut style: CellStyle = self.styles().get(own).clone();
        style.number_format = cell.number_format.clone();
        style.alignment.indent = (cell.indent > 0).then_some(cell.indent);
        self.intern_style(&style)
    }

    /// Writes `r` (after [`check_render`](Self::check_render)): clears the
    /// cells of the previous layout that the new one does not cover,
    /// writes the new cells, stores the layout and the table's location.
    fn write_render(
        &mut self,
        r: Render,
        old: Option<(SheetId, PivotOutput)>,
    ) -> Result<(), Error> {
        let new_cells: HashSet<(u32, u32)> = r.out.cells.iter().map(|c| (c.row, c.col)).collect();
        if let Some((os, o)) = &old {
            for c in &o.cells {
                if *os == r.sheet && new_cells.contains(&(c.row, c.col)) {
                    continue;
                }
                let at = CellCoord::new(*os, c.row, c.col);
                self.journal(at);
                self.engine_mut().clear(at)?;
                self.set_style(at, StyleId::DEFAULT)?;
            }
        }
        for c in &r.out.cells {
            let at = CellCoord::new(r.sheet, c.row, c.col);
            self.journal(at);
            match &c.value {
                Value::Empty => {
                    if !matches!(self.content(at), CellContent::Empty) {
                        self.engine_mut().clear(at)?;
                    }
                }
                v => {
                    self.engine_mut()
                        .set_content(at, CellContent::Value(v.clone()))?;
                }
            }
            let style = self.pivot_style(at, c);
            self.set_style(at, style)?;
        }
        let extent = r.out.extent;
        let data = self.sheet_data_mut(r.sheet)?;
        if let Some(p) = data.pivots.iter_mut().find(|p| p.id == r.id) {
            p.location = extent;
        }
        data.pivot_outputs.insert(r.id, r.out);
        Ok(())
    }

    /// Renders and writes the tables `ids` (on `sheet`s) in one batch;
    /// nothing is written when one fails.
    pub(crate) fn render_pivots(&mut self, ids: &[(SheetId, u32)]) -> Result<Recalc, Error> {
        let mut renders = Vec::new();
        for &(s, id) in ids {
            let r = self.compute_pivot(s, id)?;
            self.check_render(&r)?;
            renders.push(r);
        }
        self.begin_batch();
        let mut result = Ok(());
        let mut sheets = BTreeSet::new();
        for r in renders {
            sheets.insert(r.sheet);
            let old = self
                .sheet_data(r.sheet)
                .pivot_outputs
                .get(&r.id)
                .cloned()
                .map(|o| (r.sheet, o));
            if let Err(e) = self.write_render(r, old) {
                result = Err(e);
                break;
            }
        }
        for s in sheets {
            self.sync_pivot_engine(s);
        }
        self.sync_pivot_charts();
        let recalc = self.end_batch();
        result.map(|()| recalc)
    }

    /// Recomputes the layout of every pivot table of `sheet` without
    /// writing cells (after loading, undo, structural edits).
    pub fn rebuild_pivot_outputs(&mut self, sheet: SheetId) {
        let ids: Vec<u32> = self.pivots(sheet).iter().map(|p| p.id).collect();
        let mut outs = HashMap::new();
        for id in ids {
            if let Ok(r) = self.compute_pivot(sheet, id) {
                outs.insert(id, r.out);
            }
        }
        if let Ok(data) = self.sheet_data_mut(sheet) {
            for p in &mut data.pivots {
                if let Some(o) = outs.get(&p.id) {
                    p.location = o.extent;
                }
            }
            data.pivot_outputs = outs;
        }
        self.sync_pivot_engine(sheet);
        self.sync_pivot_charts();
    }

    /// Hands the sheet's pivot tables to the engine for `GETPIVOTDATA`.
    fn sync_pivot_engine(&mut self, sheet: SheetId) {
        let mut tables = Vec::new();
        for p in self.pivots(sheet) {
            let (Some(out), Some(cache)) = (
                self.sheet_data(sheet).pivot_outputs.get(&p.id),
                self.pivot_cache(p.cache_id),
            ) else {
                continue;
            };
            let name = |f: u32| {
                cache
                    .fields
                    .get(f as usize)
                    .map_or(String::new(), |f| f.name.clone())
            };
            let item = |f: u32, i: u32| PivotItemName {
                value: cache
                    .fields
                    .get(f as usize)
                    .and_then(|cf| cf.shared_items.get(i as usize))
                    .map_or(Value::Empty, Item::to_value),
                label: cache
                    .fields
                    .get(f as usize)
                    .map_or(String::new(), |cf| cf.item_label(i)),
            };
            let e = out.extent;
            tables.push(PivotData {
                area: (e.r0, e.c0, e.r1, e.c1),
                data_names: p
                    .values
                    .iter()
                    .map(|d| vec![d.caption(cache), name(d.field)])
                    .collect(),
                entries: out
                    .entries
                    .iter()
                    .map(|en| PivotEntry {
                        data: en.data as usize,
                        key: en.key.iter().map(|&(f, i)| (name(f), item(f, i))).collect(),
                        value: out
                            .cell(en.row, en.col)
                            .map_or(Value::Empty, |c| c.value.clone()),
                    })
                    .collect(),
                fixed: p
                    .filters
                    .iter()
                    .filter_map(|pf| match &pf.selected {
                        PageSelection::Items { items } if items.len() == 1 => {
                            let i = *items.iter().next()?;
                            Some((name(pf.field), item(pf.field, i)))
                        }
                        _ => None,
                    })
                    .collect(),
            });
        }
        self.engine_mut().set_pivot_data(sheet, tables);
    }

    // --- editing ---------------------------------------------------------------------

    fn next_pivot_id(&self) -> u32 {
        self.sheets()
            .into_iter()
            .flat_map(|(s, _)| self.pivots(s).iter().map(|p| p.id))
            .max()
            .map_or(1, |m| m + 1)
    }

    fn next_pivot_name(&self) -> String {
        let used: HashSet<String> = self
            .sheets()
            .into_iter()
            .flat_map(|(s, _)| self.pivots(s).iter().map(|p| p.name.to_lowercase()))
            .collect();
        (1u32..)
            .map(|n| format!("PivotTable{n}"))
            .find(|n| !used.contains(&n.to_lowercase()))
            .expect("unbounded")
    }

    /// Creates a cache from `source` (or shares the cache of a table with
    /// the same, up-to-date source, as Excel does) and a pivot table anchored at
    /// `(row, col)` of `sheet` with `fields` (field indices are source
    /// columns, 0 = the first), and writes it. Returns its id. Fails with
    /// [`Error::InvalidPivot`] (bad source or fields) or
    /// [`Error::PivotOverlap`] (cells in the way); nothing changes then.
    pub fn create_pivot(
        &mut self,
        source: PivotSource,
        sheet: SheetId,
        row: u32,
        col: u32,
        fields: PivotFields,
    ) -> Result<(u32, Recalc), Error> {
        if row > MAX_ROW || col > MAX_COL {
            return Err(Error::InvalidRange);
        }
        self.sheet_data_mut(sheet)?;
        // Excel shares the cache of an up-to-date table with the same source.
        let shared = self
            .pivot_caches
            .iter()
            .find(|c| c.source == source && !c.stale && c.raw.is_none())
            .map(|c| c.id);
        let (cache_id, new_cache) = match shared {
            Some(id) => (id, None),
            None => {
                let (cfields, records) = self.read_pivot_source(&source)?;
                let cache_id = self
                    .pivot_caches
                    .iter()
                    .map(|c| c.id)
                    .max()
                    .map_or(1, |m| m + 1);
                let mut cache = PivotCache {
                    id: cache_id,
                    source,
                    fields: cfields,
                    records,
                    refresh_on_load: false,
                    stale: false,
                    raw: None,
                    calculated_items: Vec::new(),
                };
                cache.normalize();
                (cache_id, Some(cache))
            }
        };
        let id = self.next_pivot_id();
        let mut table = PivotTable::new(id, &self.next_pivot_name(), cache_id, row, col);
        table.set_fields(fields);
        match &new_cache {
            Some(c) => table.validate(c)?,
            None => table.validate(self.pivot_cache(cache_id).expect("shared"))?,
        }
        let added = new_cache.is_some();
        if let Some(c) = new_cache {
            self.pivot_caches.push(c);
        }
        self.sheet_data_mut(sheet)?.pivots.push(table);
        match self.render_pivots(&[(sheet, id)]) {
            Ok(recalc) => Ok((id, recalc)),
            Err(e) => {
                self.sheet_data_mut(sheet)?.pivots.retain(|p| p.id != id);
                if added {
                    self.pivot_caches.retain(|c| c.id != cache_id);
                }
                Err(e)
            }
        }
    }

    /// Replaces the definition of pivot table `id` (fields, options,
    /// name; `id`, cache and anchor stay) and rewrites it. On error
    /// nothing changes.
    pub fn update_pivot(&mut self, id: u32, def: PivotTable) -> Result<Recalc, Error> {
        let (s, i) = self.locate_pivot(id)?;
        let old = self.pivots(s)[i].clone();
        if old.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot table is read-only".into()));
        }
        let cache = self
            .pivot_cache(old.cache_id)
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        let mut new = PivotTable {
            id,
            cache_id: old.cache_id,
            location: old.location,
            raw: None,
            ..def
        };
        // A slicer's field filter goes when its field moves onto an axis.
        let on_axis: BTreeSet<u32> = new
            .rows
            .iter()
            .chain(&new.cols)
            .map(|a| a.field)
            .chain(new.filters.iter().map(|p| p.field))
            .collect();
        new.field_filters.retain(|f| !on_axis.contains(&f.field));
        new.validate(cache)?;
        let lower = new.name.to_lowercase();
        if self
            .sheets()
            .into_iter()
            .flat_map(|(s2, _)| self.pivots(s2).iter())
            .any(|p| p.id != id && p.name.to_lowercase() == lower)
        {
            return Err(Error::InvalidPivot(format!(
                "the name {:?} is taken",
                new.name
            )));
        }
        self.sheet_data_mut(s)?.pivots[i] = new;
        match self.render_pivots(&[(s, id)]) {
            Ok(r) => Ok(r),
            Err(e) => {
                self.sheet_data_mut(s)?.pivots[i] = old;
                Err(e)
            }
        }
    }

    /// Re-reads the source of pivot table `id`'s cache and rewrites every
    /// table using that cache (Excel's Refresh). Item indices of kept
    /// items stay; fields that are gone leave the tables. Fails (and
    /// changes nothing) when the source is missing or a table would
    /// overwrite cells ([`Error::PivotOverlap`]).
    pub fn refresh_pivot(&mut self, id: u32) -> Result<Recalc, Error> {
        let (s, i) = self.locate_pivot(id)?;
        let cache_id = self.pivots(s)[i].cache_id;
        self.refresh_cache(cache_id)
    }

    /// Refreshes cache `cache_id` (see [`refresh_pivot`](Self::refresh_pivot)).
    pub fn refresh_cache(&mut self, cache_id: u32) -> Result<Recalc, Error> {
        let ci = self
            .pivot_caches
            .iter()
            .position(|c| c.id == cache_id)
            .ok_or_else(|| Error::InvalidPivot(format!("no cache {cache_id}")))?;
        let old_cache = self.pivot_caches[ci].clone();
        if old_cache.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot cache is read-only".into()));
        }
        let (fields, records) = self.read_pivot_source(&old_cache.source)?;
        let (cache, map, item_maps) = rebuild_cache(
            &old_cache,
            old_cache.id,
            old_cache.source.clone(),
            fields,
            records,
        );
        // The tables of the cache.
        let users: Vec<(SheetId, u32)> = self
            .sheets()
            .into_iter()
            .flat_map(|(s, _)| {
                self.pivots(s)
                    .iter()
                    .filter(|p| p.cache_id == cache_id)
                    .map(move |p| (s, p.id))
                    .collect::<Vec<_>>()
            })
            .collect();
        let old_tables: Vec<(SheetId, Vec<PivotTable>)> = users
            .iter()
            .map(|(s, _)| *s)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|s| (s, self.pivots(s).to_vec()))
            .collect();
        self.pivot_caches[ci] = cache;
        for &(s, id) in &users {
            if let Ok(data) = self.sheet_data_mut(s) {
                if let Some(p) = data.pivots.iter_mut().find(|p| p.id == id) {
                    p.remap_fields(&map, &item_maps);
                }
            }
        }
        match self.render_pivots(&users) {
            Ok(r) => Ok(r),
            Err(e) => {
                self.pivot_caches[ci] = old_cache;
                for (s, tables) in old_tables {
                    if let Ok(data) = self.sheet_data_mut(s) {
                        data.pivots = tables;
                    }
                }
                Err(e)
            }
        }
    }

    /// Change Data Source: pivot table `id` gets a cache of `source`
    /// (shared with another up-to-date table of that source, else new);
    /// its fields follow by name (fields that are gone leave the table),
    /// and it is rewritten. The old cache goes when no table uses it. On
    /// error nothing changes.
    pub fn change_pivot_source(&mut self, id: u32, source: PivotSource) -> Result<Recalc, Error> {
        let (s, i) = self.locate_pivot(id)?;
        let old_table = self.pivots(s)[i].clone();
        let old_cache = self
            .pivot_cache(old_table.cache_id)
            .cloned()
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        if old_cache.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot cache is read-only".into()));
        }
        let old_caches = self.pivot_caches.clone();
        let (fields, records) = self.read_pivot_source(&source)?;
        let cache_id = self.pivot_caches.iter().map(|c| c.id).max().unwrap_or(0) + 1;
        let (mut cache, map, item_maps) =
            rebuild_cache(&old_cache, cache_id, source, fields, records);
        cache.refresh_on_load = false;
        self.pivot_caches.push(cache);
        let mut table = old_table.clone();
        table.cache_id = cache_id;
        table.remap_fields(&map, &item_maps);
        self.sheet_data_mut(s)?.pivots[i] = table;
        // The old cache goes when unused.
        let used = self
            .sheets()
            .into_iter()
            .any(|(sh, _)| self.pivots(sh).iter().any(|p| p.cache_id == old_cache.id));
        if !used {
            self.pivot_caches.retain(|c| c.id != old_cache.id);
        }
        match self.render_pivots(&[(s, id)]) {
            Ok(r) => Ok(r),
            Err(e) => {
                self.pivot_caches = old_caches;
                self.sheet_data_mut(s)?.pivots[i] = old_table;
                Err(e)
            }
        }
    }

    /// Show Details: the field names and the source records behind the
    /// value cell `(row, col)` of pivot table `id` (respecting its page
    /// selections and hidden items).
    pub fn pivot_details(
        &self,
        id: u32,
        row: u32,
        col: u32,
    ) -> Result<(Vec<String>, Vec<Vec<Value>>), Error> {
        let (s, i) = self.locate_pivot(id)?;
        let t = &self.pivots(s)[i];
        let cache = self
            .pivot_cache(t.cache_id)
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        let out = self
            .pivot_output(id)
            .ok_or_else(|| Error::InvalidPivot("not laid out".into()))?;
        let entry = out
            .entries
            .iter()
            .find(|e| e.row == row && e.col == col)
            .ok_or_else(|| Error::InvalidPivot("not a value cell".into()))?;
        if entry
            .key
            .iter()
            .any(|&(f, i)| cache.calculated_item(f, i).is_some())
        {
            return Err(Error::InvalidPivot(
                "cannot show the details of a calculated item".into(),
            ));
        }
        let source: Vec<usize> = cache
            .fields
            .iter()
            .enumerate()
            .filter(|(i, f)| f.is_source(*i as u32))
            .map(|(i, _)| i)
            .collect();
        let names = source
            .iter()
            .map(|&i| cache.fields[i].name.clone())
            .collect();
        let keys: Vec<(Vec<u32>, u32)> = entry
            .key
            .iter()
            .map(|&(f, item)| (cache.record_items(f), item))
            .collect();
        let mut rows = Vec::new();
        for r in t.passing_records(cache) {
            if keys.iter().all(|(idx, item)| idx[r as usize] == *item) {
                let rec = &cache.records[r as usize];
                rows.push(
                    source
                        .iter()
                        .map(|&i| rec.get(i).map_or(Value::Empty, Item::to_value))
                        .collect(),
                );
            }
        }
        Ok((names, rows))
    }

    /// Deletes pivot table `id` and clears its cells (contents and
    /// formats); its cache goes when no other table uses it.
    pub fn delete_pivot(&mut self, id: u32) -> Result<Recalc, Error> {
        let (s, i) = self.locate_pivot(id)?;
        let data = self.sheet_data_mut(s)?;
        let table = data.pivots.remove(i);
        let out = data.pivot_outputs.remove(&id);
        let rect = table.location;
        self.begin_batch();
        let mut result = Ok(());
        let cells: Vec<(u32, u32)> = match &out {
            Some(o) => o.cells.iter().map(|c| (c.row, c.col)).collect(),
            None => (rect.r0..=rect.r1)
                .flat_map(|r| (rect.c0..=rect.c1).map(move |c| (r, c)))
                .collect(),
        };
        for (r, c) in cells {
            let at = CellCoord::new(s, r, c);
            self.journal(at);
            if let Err(e) = self
                .engine_mut()
                .clear(at)
                .map_err(Error::from)
                .and_then(|_| self.set_style(at, StyleId::DEFAULT))
            {
                result = Err(e);
                break;
            }
        }
        self.sync_pivot_engine(s);
        let recalc = self.end_batch();
        let used: HashSet<u32> = self
            .sheets()
            .into_iter()
            .flat_map(|(s2, _)| self.pivots(s2).iter().map(|p| p.cache_id))
            .collect();
        self.pivot_caches.retain(|c| used.contains(&c.id));
        result.map(|()| recalc)
    }

    /// Moves pivot table `id` so that it is anchored at `(row, col)` of
    /// `sheet` (Excel's Move PivotTable). Fails with
    /// [`Error::PivotOverlap`] when cells are in the way.
    pub fn move_pivot(
        &mut self,
        id: u32,
        sheet: SheetId,
        row: u32,
        col: u32,
    ) -> Result<Recalc, Error> {
        if row > MAX_ROW || col > MAX_COL {
            return Err(Error::InvalidRange);
        }
        self.sheet_data_mut(sheet)?;
        let (s, i) = self.locate_pivot(id)?;
        let mut table = self.pivots(s)[i].clone();
        let (r0, c0) = table.anchor();
        let (dr, dc) = (
            i64::from(row) - i64::from(r0),
            i64::from(col) - i64::from(c0),
        );
        let l = table.location;
        let shifted = |v: u32, d: i64, max: u32| (i64::from(v) + d).clamp(0, i64::from(max)) as u32;
        table.location = PivotRect::new(
            row,
            col,
            shifted(l.r1, dr, MAX_ROW),
            shifted(l.c1, dc, MAX_COL),
        );
        let cache = self
            .pivot_cache(table.cache_id)
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        let out = if table.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot table is read-only".into()));
        } else {
            table.compute(cache)?
        };
        // Conflicts: the old cells of the table do not count (same sheet).
        let old_out = self.sheet_data(s).pivot_outputs.get(&id).cloned();
        let render = Render { sheet, id, out };
        {
            let data = self.sheet_data(sheet);
            let mut conflicts = Vec::new();
            for c in &render.out.cells {
                let own = s == sheet && old_out.as_ref().is_some_and(|o| o.covers(c.row, c.col));
                if own {
                    continue;
                }
                let other = data
                    .pivots
                    .iter()
                    .any(|p| p.id != id && p.location.contains(c.row, c.col));
                if other
                    || !matches!(
                        self.content(CellCoord::new(sheet, c.row, c.col)),
                        CellContent::Empty
                    )
                {
                    conflicts.push((c.row, c.col));
                }
            }
            if !conflicts.is_empty() {
                let b = bounding(&conflicts);
                return Err(Error::PivotOverlap {
                    r0: b.r0,
                    c0: b.c0,
                    r1: b.r1,
                    c1: b.c1,
                });
            }
        }
        let data = self.sheet_data_mut(s)?;
        data.pivots.remove(i);
        data.pivot_outputs.remove(&id);
        self.sheet_data_mut(sheet)?.pivots.push(table);
        self.begin_batch();
        let result = self.write_render(render, old_out.map(|o| (s, o)));
        self.sync_pivot_engine(s);
        self.sync_pivot_engine(sheet);
        self.sync_pivot_charts();
        let recalc = self.end_batch();
        result.map(|()| recalc)
    }

    /// A copy of pivot table `id` (same cache and definition, a new id
    /// and name) anchored at `(row, col)` of `sheet`, with page field
    /// `page.0` set to the single item `page.1` (Show Report Filter
    /// Pages). Returns the new id.
    pub fn copy_pivot(
        &mut self,
        id: u32,
        sheet: SheetId,
        row: u32,
        col: u32,
        page: Option<(u32, u32)>,
    ) -> Result<(u32, Recalc), Error> {
        if row > MAX_ROW || col > MAX_COL {
            return Err(Error::InvalidRange);
        }
        self.sheet_data_mut(sheet)?;
        let (s, i) = self.locate_pivot(id)?;
        let mut t = self.pivots(s)[i].clone();
        if t.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot table is read-only".into()));
        }
        if let Some((field, item)) = page {
            let p = t
                .filters
                .iter_mut()
                .find(|p| p.field == field)
                .ok_or_else(|| Error::InvalidPivot("the field is not a filter".into()))?;
            p.selected = PageSelection::Items {
                items: BTreeSet::from([item]),
            };
        }
        let new_id = self.next_pivot_id();
        t.id = new_id;
        t.name = self.next_pivot_name();
        t.location = PivotRect::new(row, col, row, col);
        self.sheet_data_mut(sheet)?.pivots.push(t);
        match self.render_pivots(&[(sheet, new_id)]) {
            Ok(r) => Ok((new_id, r)),
            Err(e) => {
                self.sheet_data_mut(sheet)?
                    .pivots
                    .retain(|p| p.id != new_id);
                Err(e)
            }
        }
    }

    /// Replaces all caches (loading, undo); call
    /// [`set_pivots`](Self::set_pivots) for the tables afterwards.
    pub fn set_pivot_caches(&mut self, caches: Vec<PivotCache>) {
        self.pivot_caches = caches
            .into_iter()
            .map(|mut c| {
                c.normalize();
                c
            })
            .collect();
    }

    /// Replaces the pivot tables of `sheet` without writing cells (the
    /// cells are loaded with the sheet) and computes their layout.
    /// Duplicate ids fail.
    pub fn set_pivots(&mut self, sheet: SheetId, tables: Vec<PivotTable>) -> Result<(), Error> {
        let mut ids: HashSet<u32> = self
            .sheets()
            .into_iter()
            .filter(|(s, _)| *s != sheet)
            .flat_map(|(s, _)| self.pivots(s).iter().map(|p| p.id))
            .collect();
        if tables.iter().any(|t| !ids.insert(t.id)) {
            return Err(Error::InvalidPivot("duplicate pivot table id".into()));
        }
        self.sheet_data_mut(sheet)?.pivots = tables;
        self.rebuild_pivot_outputs(sheet);
        Ok(())
    }

    /// Marks the caches whose source contains one of `cells` stale;
    /// returns whether a cache became stale.
    pub fn mark_pivot_sources_stale(&mut self, cells: &[CellCoord]) -> bool {
        if self.pivot_caches.is_empty() || cells.is_empty() {
            return false;
        }
        let ranges: Vec<Option<crate::CellRange>> = self
            .pivot_caches
            .iter()
            .map(|c| self.pivot_source_range(&c.source))
            .collect();
        let mut changed = false;
        for (cache, range) in self.pivot_caches.iter_mut().zip(ranges) {
            let Some(r) = range else { continue };
            if cache.stale || cache.raw.is_some() {
                continue;
            }
            if cells.iter().any(|c| {
                c.sheet == r.sheet
                    && (r.r0..=r.r1).contains(&c.row)
                    && (r.c0..=r.c1).contains(&c.col)
            }) {
                cache.stale = true;
                changed = true;
            }
        }
        changed
    }

    // --- following sheet edits -------------------------------------------------------

    /// Refuses a row/column insert or delete that cuts through a pivot
    /// table of `sheet` ([`Error::PivotCell`], as Excel does).
    pub(crate) fn check_pivot_structural(
        &self,
        sheet: SheetId,
        op: StructuralOp,
    ) -> Result<(), Error> {
        for p in self.pivots(sheet) {
            let (lo, hi) = if op.is_rows() {
                (p.location.r0, p.location.r1)
            } else {
                (p.location.c0, p.location.c1)
            };
            let (at, count) = op.span();
            if count == 0 {
                continue;
            }
            let cuts = match op {
                StructuralOp::InsertRows { .. } | StructuralOp::InsertCols { .. } => {
                    at > lo && at <= hi
                }
                _ => at <= hi && at + count > lo,
            };
            if cuts {
                return Err(Error::PivotCell);
            }
        }
        Ok(())
    }

    /// After a row/column insert or delete on `sheet`: tables move, the
    /// source ranges on that sheet move and grow (their caches become
    /// stale when the edit touches them).
    pub(crate) fn shift_pivots(&mut self, sheet: SheetId, op: StructuralOp) {
        self.shift_pivot_sources(sheet, op.into());
        if self.pivots(sheet).is_empty() {
            return;
        }
        if let Ok(data) = self.sheet_data_mut(sheet) {
            for p in &mut data.pivots {
                let l = p.location;
                let moved = if op.is_rows() {
                    op.map_interval(l.r0, l.r1)
                        .map(|(r0, r1)| PivotRect::new(r0, l.c0, r1, l.c1))
                } else {
                    op.map_interval(l.c0, l.c1)
                        .map(|(c0, c1)| PivotRect::new(l.r0, c0, l.r1, c1))
                };
                if let Some(m) = moved {
                    p.location = m;
                }
            }
        }
        self.rebuild_pivot_outputs(sheet);
    }

    /// The source ranges on `sheet` follow a row/column insert or delete
    /// or an Insert / Delete Cells (`shift`) like an area reference: they
    /// move, grow or shrink when they lie inside the shifted band; caches
    /// whose source the edit touches become stale (Refresh re-reads them).
    pub(crate) fn shift_pivot_sources(&mut self, sheet: SheetId, shift: CellShift) {
        let Some(name) = self.engine().sheet_name(sheet).map(str::to_owned) else {
            return;
        };
        let op = shift.op;
        for cache in &mut self.pivot_caches {
            if let PivotSource::Range {
                sheet: s,
                r0,
                c0,
                r1,
                c1,
            } = &mut cache.source
            {
                if !s.eq_ignore_ascii_case(&name) {
                    continue;
                }
                let rect = (*r0, *c0, *r1, *c1);
                let (lo, hi) = if op.is_rows() { (*r0, *r1) } else { (*c0, *c1) };
                let (at, count) = op.span();
                let inside = match op {
                    StructuralOp::InsertRows { .. } | StructuralOp::InsertCols { .. } => {
                        at > lo && at <= hi
                    }
                    _ => at <= hi && at + count > lo,
                };
                let (p0, p1) = if op.is_rows() { (*c0, *c1) } else { (*r0, *r1) };
                let perp = match shift.band {
                    None => true,
                    Some((a, b)) => p0 <= b && a <= p1,
                };
                if let Some(m) = shift.map_rect(rect) {
                    (*r0, *c0, *r1, *c1) = m;
                }
                if inside && perp {
                    cache.stale = true;
                }
            }
        }
    }

    /// A sheet was renamed: sources follow.
    pub(crate) fn rename_pivot_sources(&mut self, from: &str, to: &str) {
        for c in &mut self.pivot_caches {
            if let PivotSource::Range { sheet, .. } = &mut c.source {
                if sheet.eq_ignore_ascii_case(from) {
                    *sheet = to.to_owned();
                }
            }
        }
    }

    /// After duplicating a sheet: the copied tables get new ids and names
    /// (they share the caches, as in Excel).
    pub(crate) fn renew_pivot_ids(&mut self, copy: SheetId) {
        let tables = self.pivots(copy).to_vec();
        if tables.is_empty() {
            return;
        }
        if let Ok(data) = self.sheet_data_mut(copy) {
            data.pivots.clear();
            data.pivot_outputs.clear();
        }
        for mut t in tables {
            t.id = self.next_pivot_id();
            t.name = self.next_pivot_name();
            if let Ok(data) = self.sheet_data_mut(copy) {
                data.pivots.push(t);
            }
        }
        self.rebuild_pivot_outputs(copy);
    }

    /// A sheet was removed: GETPIVOTDATA no longer finds its tables.
    pub(crate) fn drop_pivot_engine(&mut self, sheet: SheetId) {
        self.engine_mut().set_pivot_data(sheet, Vec::new());
    }
}
