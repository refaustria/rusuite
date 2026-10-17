//! [`PivotTable::compute`]: Excel's pivot table layout (see
//! `docs/pivot.md` for the rules).

use std::cell::RefCell;
use std::collections::HashMap;

use engine_formula::{ErrorKind, Value};
use serde::{Deserialize, Serialize};

use super::{
    AggFunc, AxisField, BaseItem, Item, PageSelection, PivotCache, PivotLayout, PivotTable, ShowAs,
    Subtotals, ValuesAxis,
};
use crate::Error;

/// Largest number of cells a pivot table may occupy.
const MAX_CELLS: usize = 2_000_000;

/// An inclusive cell rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRect {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl PivotRect {
    pub fn new(r0: u32, c0: u32, r1: u32, c1: u32) -> Self {
        PivotRect { r0, c0, r1, c1 }
    }

    pub fn contains(&self, row: u32, col: u32) -> bool {
        (self.r0..=self.r1).contains(&row) && (self.c0..=self.c1).contains(&col)
    }

    pub fn intersects(&self, o: &PivotRect) -> bool {
        self.r0 <= o.r1 && o.r0 <= self.r1 && self.c0 <= o.c1 && o.c0 <= self.c1
    }

    pub fn rows(&self) -> u32 {
        self.r1 - self.r0 + 1
    }

    pub fn cols(&self) -> u32 {
        self.c1 - self.c0 + 1
    }
}

/// What a cell of a pivot table is (the UI draws headers, expand buttons
/// and total rows from it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CellRole {
    /// `Row Labels`, `Column Labels`, a data caption or a field name.
    Header,
    /// An item of a row field (or a data caption on the row axis).
    RowLabel,
    /// An item of a column field (or a data caption on the column axis).
    ColLabel,
    Value,
    /// A subtotal value or label (also the values on a parent item's row).
    Subtotal,
    /// A grand total value or label.
    GrandTotal,
    /// The selection of a page field (`(All)`, an item, `(Multiple Items)`).
    Page,
    /// A cell of the table without content.
    Blank,
}

/// One cell of a [`PivotOutput`] (absolute sheet coordinates).
#[derive(Debug, Clone, PartialEq)]
pub struct PivotCell {
    pub row: u32,
    pub col: u32,
    pub value: Value,
    pub kind: CellRole,
    /// The axis depth of a label or value line (0 = outermost).
    pub level: u8,
    /// For labels of items that have inner items: whether collapsed.
    pub collapsed: Option<bool>,
    /// The cache field of a label, field header or page cell.
    pub field: Option<u32>,
    /// The shared item of a label.
    pub item: Option<u32>,
    pub number_format: Option<String>,
    /// Indent of a compact row label (characters).
    pub indent: u8,
}

/// The kind of an axis line (SpreadsheetML `rowItems`/`colItems` `t`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Data,
    /// An automatic subtotal (`t="default"`).
    Default,
    /// A custom subtotal (`t="sum"`, …).
    Func(AggFunc),
    Grand,
}

/// One line (row or column) of the body, as SpreadsheetML lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct AxisLine {
    pub kind: LineKind,
    /// Per axis depth: the item's position in the field's display order
    /// ([`PivotTable::item_order`]), or the data field index for `Σ Values`.
    pub items: Vec<u32>,
    /// The data field of the line (`i`).
    pub data: u32,
}

/// A value cell that `GETPIVOTDATA` can address.
#[derive(Debug, Clone, PartialEq)]
pub struct DataEntry {
    pub data: u32,
    /// `(cache field, shared item)` pairs of the row and column.
    pub key: Vec<(u32, u32)>,
    pub row: u32,
    pub col: u32,
}

/// The laid-out table.
#[derive(Debug, Clone, Default)]
pub struct PivotOutput {
    /// Row-major.
    pub cells: Vec<PivotCell>,
    /// Everything, page fields included.
    pub extent: PivotRect,
    /// The table without the page fields (SpreadsheetML `location ref`).
    pub table: PivotRect,
    /// Rows above the first data row / columns left of the first data
    /// column (`firstDataRow` / `firstDataCol`).
    pub header_rows: u32,
    pub label_cols: u32,
    /// `firstHeaderRow`.
    pub first_header_row: u32,
    /// The axis fields as SpreadsheetML lists them: cache field index,
    /// `-2` for `Σ Values`.
    pub row_fields: Vec<i32>,
    pub col_fields: Vec<i32>,
    pub row_items: Vec<AxisLine>,
    pub col_items: Vec<AxisLine>,
    pub entries: Vec<DataEntry>,
    index: HashMap<(u32, u32), usize>,
}

impl PivotOutput {
    /// The cell at `(row, col)`.
    pub fn cell(&self, row: u32, col: u32) -> Option<&PivotCell> {
        self.index.get(&(row, col)).map(|&i| &self.cells[i])
    }

    /// Whether `(row, col)` belongs to the table (page cells included).
    pub fn covers(&self, row: u32, col: u32) -> bool {
        self.index.contains_key(&(row, col))
    }

    fn finish(mut self) -> Self {
        self.cells.sort_by_key(|c| (c.row, c.col));
        self.index = self
            .cells
            .iter()
            .enumerate()
            .map(|(i, c)| ((c.row, c.col), i))
            .collect();
        self
    }
}

// --- internals -------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Entry {
    /// Index into the axis' field list.
    Field(usize),
    Values,
}

#[derive(Debug, Clone)]
struct Label {
    /// Column offset (rows axis) or header row (columns axis).
    off: u32,
    value: Value,
    kind: CellRole,
    level: u8,
    collapsed: Option<bool>,
    field: Option<u32>,
    item: Option<u32>,
    fmt: Option<String>,
    indent: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LK {
    Leaf,
    /// A parent item's own line with its subtotal values.
    ParentTop,
    /// A parent item's own line without values.
    ParentBlank,
    Subtotal,
    Grand,
}

#[derive(Debug, Clone)]
struct Line {
    key: Vec<(u32, u32)>,
    data: Option<u32>,
    func: Option<AggFunc>,
    kind: LK,
    recs: Vec<u32>,
    labels: Vec<Label>,
    path: Vec<u32>,
    lkind: LineKind,
}

struct Plan<'a> {
    entries: Vec<Entry>,
    fields: &'a [AxisField],
    rows: bool,
    offs: Vec<u32>,
    indents: Vec<u8>,
    layouts: Vec<PivotLayout>,
    /// A field entry lies deeper than this depth.
    deeper_field: Vec<bool>,
    /// `Σ Values` lies deeper than this depth.
    deeper_values: Vec<bool>,
}

type AggKey = (Vec<(u32, u32)>, u32, AggFunc);

struct Ctx<'a> {
    t: &'a PivotTable,
    c: &'a PivotCache,
    /// Per cache field, per record: the shared item index.
    idx: Vec<Vec<u32>>,
    /// The records that pass the filters.
    recs: Vec<u32>,
    /// Per cache field: display order and position of each item in it.
    order: HashMap<u32, (Vec<u32>, Vec<u32>)>,
    memo: RefCell<HashMap<AggKey, Value>>,
}

fn intersect(a: &[u32], b: &[u32]) -> Vec<u32> {
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::new();
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[i]);
                i += 1;
                j += 1;
            }
        }
    }
    out
}

/// Excel's summary of `items` (blank items are no data; no data at all →
/// `Empty`).
pub(crate) fn aggregate<'i>(items: impl Iterator<Item = &'i Item>, func: AggFunc) -> Value {
    let mut nums: Vec<f64> = Vec::new();
    let mut non_blank = 0u32;
    let mut error: Option<String> = None;
    for it in items {
        match it {
            Item::Blank => continue,
            Item::Number(n) => nums.push(*n),
            Item::Error(e) => {
                error.get_or_insert_with(|| e.clone());
            }
            Item::Text(_) | Item::Bool(_) => {}
        }
        non_blank += 1;
    }
    if non_blank == 0 {
        return Value::Empty;
    }
    match func {
        AggFunc::Count => return Value::Number(f64::from(non_blank)),
        AggFunc::CountNums => return Value::Number(nums.len() as f64),
        _ => {}
    }
    if let Some(e) = error {
        return Item::Error(e).to_value();
    }
    let n = nums.len() as f64;
    let mean = || nums.iter().sum::<f64>() / n;
    let ss = || {
        let m = mean();
        nums.iter().map(|x| (x - m) * (x - m)).sum::<f64>()
    };
    let div0 = Value::Error(ErrorKind::Div0);
    match func {
        AggFunc::Sum => Value::number(nums.iter().sum()),
        AggFunc::Average if nums.is_empty() => div0,
        AggFunc::Average => Value::number(mean()),
        AggFunc::Max => Value::number(nums.iter().copied().reduce(f64::max).unwrap_or(0.0)),
        AggFunc::Min => Value::number(nums.iter().copied().reduce(f64::min).unwrap_or(0.0)),
        AggFunc::Product if nums.is_empty() => Value::Number(0.0),
        AggFunc::Product => Value::number(nums.iter().product()),
        AggFunc::Var | AggFunc::StdDev if nums.len() < 2 => div0,
        AggFunc::VarP | AggFunc::StdDevP if nums.is_empty() => div0,
        AggFunc::Var => Value::number(ss() / (n - 1.0)),
        AggFunc::VarP => Value::number(ss() / n),
        AggFunc::StdDev => Value::number((ss() / (n - 1.0)).sqrt()),
        AggFunc::StdDevP => Value::number((ss() / n).sqrt()),
        AggFunc::Count | AggFunc::CountNums => unreachable!("handled above"),
    }
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(*n),
        _ => None,
    }
}

fn ratio(a: &Value, b: &Value) -> Value {
    match (a, b) {
        (Value::Empty, _) => Value::Empty,
        (Value::Error(e), _) | (_, Value::Error(e)) => Value::Error(*e),
        (Value::Number(x), Value::Number(y)) if *y != 0.0 => Value::number(x / y),
        _ => Value::Error(ErrorKind::Div0),
    }
}

impl<'a> Ctx<'a> {
    fn new(t: &'a PivotTable, c: &'a PivotCache) -> Self {
        let idx: Vec<Vec<u32>> = c
            .fields
            .iter()
            .enumerate()
            .map(|(f, cf)| {
                let map: HashMap<super::ItemKey, u32> = cf
                    .shared_items
                    .iter()
                    .enumerate()
                    .map(|(i, it)| (it.key(), i as u32))
                    .collect();
                c.records
                    .iter()
                    .map(|r| {
                        r.get(f)
                            .and_then(|it| map.get(&it.key()).copied())
                            .unwrap_or(u32::MAX)
                    })
                    .collect()
            })
            .collect();
        let mut order = HashMap::new();
        for a in t.rows.iter().chain(&t.cols) {
            let o = t.item_order(c, a.field);
            let mut pos = vec![0u32; o.len()];
            for (p, &i) in o.iter().enumerate() {
                pos[i as usize] = p as u32;
            }
            order.insert(a.field, (o, pos));
        }
        // Base fields of show-as need an order too.
        for d in &t.values {
            if let ShowAs::DifferenceFrom { base_field, .. }
            | ShowAs::RunningTotal { base_field }
            | ShowAs::Rank { base_field } = d.show_as
            {
                order.entry(base_field).or_insert_with(|| {
                    let o = t.item_order(c, base_field);
                    let mut pos = vec![0u32; o.len()];
                    for (p, &i) in o.iter().enumerate() {
                        pos[i as usize] = p as u32;
                    }
                    (o, pos)
                });
            }
        }
        let field_ok = |f: u32, r: usize, keep: &dyn Fn(u32) -> bool| {
            idx.get(f as usize)
                .and_then(|v| v.get(r))
                .is_some_and(|&i| keep(i))
        };
        let recs = (0..c.records.len())
            .filter(|&r| {
                t.filters
                    .iter()
                    .chain(&t.field_filters)
                    .all(|p| match &p.selected {
                        PageSelection::All => true,
                        PageSelection::Items { items } => {
                            field_ok(p.field, r, &|i| items.contains(&i))
                        }
                    })
                    && t.rows.iter().chain(&t.cols).all(|a| {
                        a.hidden_items.is_empty()
                            || field_ok(a.field, r, &|i| !a.hidden_items.contains(&i))
                    })
            })
            .map(|r| r as u32)
            .collect();
        Ctx {
            t,
            c,
            idx,
            recs,
            order,
            memo: RefCell::new(HashMap::new()),
        }
    }

    fn item_of(&self, field: u32, rec: u32) -> u32 {
        self.idx[field as usize][rec as usize]
    }

    fn agg(&self, recs: &[u32], d: u32, func: AggFunc) -> Value {
        let field = self.t.values[d as usize].field as usize;
        aggregate(
            recs.iter()
                .filter_map(|&r| self.c.records.get(r as usize)?.get(field)),
            func,
        )
    }

    /// The summary of the records matching `key`.
    fn agg_key(&self, key: &[(u32, u32)], d: u32, func: AggFunc) -> Value {
        let mut sorted = key.to_vec();
        sorted.sort_unstable();
        let k = (sorted, d, func);
        if let Some(v) = self.memo.borrow().get(&k) {
            return v.clone();
        }
        let recs: Vec<u32> = self
            .recs
            .iter()
            .copied()
            .filter(|&r| key.iter().all(|&(f, i)| self.item_of(f, r) == i))
            .collect();
        let v = self.agg(&recs, d, func);
        self.memo.borrow_mut().insert(k, v.clone());
        v
    }

    /// The visible items of `field` (in the filtered records), in order.
    fn visible_items(&self, field: u32) -> Vec<u32> {
        let mut present = vec![false; self.c.fields[field as usize].shared_items.len()];
        for &r in &self.recs {
            if let Some(p) = present.get_mut(self.item_of(field, r) as usize) {
                *p = true;
            }
        }
        self.order
            .get(&field)
            .map(|(o, _)| o.iter().copied().filter(|&i| present[i as usize]).collect())
            .unwrap_or_default()
    }

    /// The children of a node: `(item or data index, records)`.
    fn children(&self, plan: &Plan, depth: usize, recs: &[u32]) -> Vec<(u32, Vec<u32>)> {
        match plan.entries[depth] {
            Entry::Values => (0..self.t.values.len() as u32)
                .map(|d| (d, recs.to_vec()))
                .collect(),
            Entry::Field(ai) => {
                let a = &plan.fields[ai];
                let mut groups: HashMap<u32, Vec<u32>> = HashMap::new();
                for &r in recs {
                    groups.entry(self.item_of(a.field, r)).or_default().push(r);
                }
                let Some((order, _)) = self.order.get(&a.field) else {
                    return Vec::new();
                };
                order
                    .iter()
                    .filter(|i| !a.hidden_items.contains(i))
                    .filter_map(|&i| match groups.remove(&i) {
                        Some(g) => Some((i, g)),
                        None if a.show_all_items => Some((i, Vec::new())),
                        None => None,
                    })
                    .collect()
            }
        }
    }

    fn caption(&self, d: u32) -> String {
        self.t.values[d as usize].caption(self.c)
    }

    fn field_name(&self, f: u32) -> String {
        self.c.fields[f as usize].name.clone()
    }

    #[allow(clippy::too_many_arguments)]
    fn build(
        &self,
        plan: &Plan,
        depth: usize,
        key: &mut Vec<(u32, u32)>,
        data: Option<u32>,
        path: &mut Vec<u32>,
        recs: &[u32],
        out: &mut Vec<Line>,
    ) {
        let last = depth + 1 == plan.entries.len();
        let role = if plan.rows {
            CellRole::RowLabel
        } else {
            CellRole::ColLabel
        };
        for (item, crecs) in self.children(plan, depth, recs) {
            let (label, collapsed, data, field_ref) = match plan.entries[depth] {
                Entry::Values => {
                    path.push(item);
                    let label = Label {
                        off: plan.offs[depth],
                        value: Value::Text(self.caption(item)),
                        kind: role,
                        level: depth as u8,
                        collapsed: None,
                        field: None,
                        item: Some(item),
                        fmt: None,
                        indent: plan.indents[depth],
                    };
                    (label, false, Some(item), None)
                }
                Entry::Field(ai) => {
                    let a = &plan.fields[ai];
                    let cf = &self.c.fields[a.field as usize];
                    let it = &cf.shared_items[item as usize];
                    key.push((a.field, item));
                    path.push(self.order[&a.field].1[item as usize]);
                    let collapsed = plan.deeper_field[depth] && a.collapsed_items.contains(&item);
                    let label = Label {
                        off: plan.offs[depth],
                        value: match it {
                            Item::Blank => Value::Text("(blank)".into()),
                            _ => it.to_value(),
                        },
                        kind: role,
                        level: depth as u8,
                        collapsed: plan.deeper_field[depth].then_some(collapsed),
                        field: Some(a.field),
                        item: Some(item),
                        fmt: matches!(it, Item::Number(_))
                            .then(|| cf.number_format.clone())
                            .flatten(),
                        indent: plan.indents[depth],
                    };
                    (label, collapsed, data, Some(a))
                }
            };
            if last || collapsed {
                out.push(Line {
                    key: key.clone(),
                    data,
                    func: None,
                    kind: LK::Leaf,
                    recs: crecs,
                    labels: vec![label],
                    path: path.clone(),
                    lkind: LineKind::Data,
                });
            } else {
                let layout = plan.layouts[depth];
                let subtotals = field_ref.map_or(&Subtotals::None, |a| &a.subtotals);
                let has_sub = plan.deeper_field[depth] && *subtotals != Subtotals::None;
                let auto = *subtotals == Subtotals::Automatic;
                let bottom = field_ref.is_some_and(|a| a.subtotal_bottom);
                let sub_top = layout != PivotLayout::Tabular
                    && auto
                    && has_sub
                    && !bottom
                    && !plan.deeper_values[depth];
                if layout != PivotLayout::Tabular {
                    out.push(Line {
                        key: key.clone(),
                        data,
                        func: None,
                        kind: if sub_top {
                            LK::ParentTop
                        } else {
                            LK::ParentBlank
                        },
                        recs: crecs.clone(),
                        labels: vec![label.clone()],
                        path: path.clone(),
                        lkind: LineKind::Data,
                    });
                }
                let start = out.len();
                self.build(plan, depth + 1, key, data, path, &crecs, out);
                if layout == PivotLayout::Tabular {
                    match out.get_mut(start) {
                        Some(first) => first.labels.insert(0, label.clone()),
                        None => out.push(Line {
                            key: key.clone(),
                            data,
                            func: None,
                            kind: LK::ParentBlank,
                            recs: crecs.clone(),
                            labels: vec![label.clone()],
                            path: path.clone(),
                            lkind: LineKind::Data,
                        }),
                    }
                }
                if plan.rows && self.t.options.repeat_labels && layout != PivotLayout::Compact {
                    for l in &mut out[start..] {
                        if l.kind != LK::Subtotal && !l.labels.iter().any(|x| x.off == label.off) {
                            l.labels.insert(0, label.clone());
                        }
                    }
                }
                if has_sub && (!auto || !sub_top) {
                    let funcs: Vec<Option<AggFunc>> = match subtotals {
                        Subtotals::Custom { functions } => {
                            functions.iter().copied().map(Some).collect()
                        }
                        _ => vec![None],
                    };
                    let datas: Vec<Option<u32>> = if plan.deeper_values[depth] {
                        (0..self.t.values.len() as u32).map(Some).collect()
                    } else {
                        vec![data]
                    };
                    let text = crate::numfmt::display_value(&label.value, label.fmt.as_deref());
                    for func in &funcs {
                        for d in &datas {
                            let caption = match (func, plan.deeper_values[depth]) {
                                (None, false) => format!("{text} Total"),
                                (Some(f), false) => format!("{text} {}", f.caption()),
                                (None, true) => format!("{text} {}", self.caption(d.unwrap_or(0))),
                                (Some(f), true) => format!(
                                    "{text} {} of {}",
                                    f.caption(),
                                    self.field_name(self.t.values[d.unwrap_or(0) as usize].field)
                                ),
                            };
                            out.push(Line {
                                key: key.clone(),
                                data: *d,
                                func: *func,
                                kind: LK::Subtotal,
                                recs: crecs.clone(),
                                labels: vec![Label {
                                    value: Value::Text(caption),
                                    kind: CellRole::Subtotal,
                                    collapsed: None,
                                    fmt: None,
                                    ..label.clone()
                                }],
                                path: path.clone(),
                                lkind: func.map_or(LineKind::Default, LineKind::Func),
                            });
                        }
                    }
                }
            }
            path.pop();
            if matches!(plan.entries[depth], Entry::Field(_)) {
                key.pop();
            }
        }
    }

    /// The lines of an axis, grand totals included.
    fn lines(&self, plan: &Plan, grand: bool) -> Vec<Line> {
        let mut out = Vec::new();
        if plan.entries.is_empty() {
            out.push(Line {
                key: Vec::new(),
                data: None,
                func: None,
                kind: LK::Leaf,
                recs: self.recs.clone(),
                labels: Vec::new(),
                path: Vec::new(),
                lkind: LineKind::Data,
            });
            return out;
        }
        self.build(
            plan,
            0,
            &mut Vec::new(),
            None,
            &mut Vec::new(),
            &self.recs,
            &mut out,
        );
        let has_field = plan.entries.iter().any(|e| matches!(e, Entry::Field(_)));
        if grand && has_field {
            let values = plan.entries.contains(&Entry::Values);
            let datas: Vec<Option<u32>> = if values {
                (0..self.t.values.len() as u32).map(Some).collect()
            } else {
                vec![None]
            };
            let off = if plan.rows { 0 } else { plan.offs[0] };
            for d in datas {
                let text = match d {
                    Some(d) => format!("Total {}", self.caption(d)),
                    None => "Grand Total".into(),
                };
                out.push(Line {
                    key: Vec::new(),
                    data: d,
                    func: None,
                    kind: LK::Grand,
                    recs: self.recs.clone(),
                    labels: vec![Label {
                        off,
                        value: Value::Text(text),
                        kind: CellRole::GrandTotal,
                        level: 0,
                        collapsed: None,
                        field: None,
                        item: None,
                        fmt: None,
                        indent: 0,
                    }],
                    path: vec![d.unwrap_or(0)],
                    lkind: LineKind::Grand,
                });
            }
        }
        out
    }

    /// The value of a body cell, after show-as.
    fn value(&self, row: &Line, col: &Line) -> Option<(Value, CellRole, u32, Option<AggFunc>)> {
        if self.t.values.is_empty() || row.kind == LK::ParentBlank || col.kind == LK::ParentBlank {
            return None;
        }
        let d = row.data.or(col.data).unwrap_or(0);
        let df = &self.t.values[d as usize];
        let custom = row.func.or(col.func);
        let func = custom.unwrap_or(df.func);
        let role = if row.kind == LK::Grand || col.kind == LK::Grand {
            CellRole::GrandTotal
        } else if matches!(row.kind, LK::Subtotal | LK::ParentTop)
            || matches!(col.kind, LK::Subtotal | LK::ParentTop)
        {
            CellRole::Subtotal
        } else {
            CellRole::Value
        };
        let recs = intersect(&row.recs, &col.recs);
        let raw = self.agg(&recs, d, func);
        let key: Vec<(u32, u32)> = row.key.iter().chain(&col.key).copied().collect();
        let v = match df.show_as {
            ShowAs::Normal => raw,
            ShowAs::PercentOfTotal => ratio(&raw, &self.agg_key(&[], d, func)),
            ShowAs::PercentOfRow => ratio(&raw, &self.agg_key(&row.key, d, func)),
            ShowAs::PercentOfColumn => ratio(&raw, &self.agg_key(&col.key, d, func)),
            ShowAs::PercentOfParent => {
                let mut parent = row.key.clone();
                if parent.pop().is_none() {
                    ratio(&raw, &raw)
                } else {
                    parent.extend(&col.key);
                    ratio(&raw, &self.agg_key(&parent, d, func))
                }
            }
            ShowAs::DifferenceFrom {
                base_field,
                base_item,
            } => self.difference(&raw, &key, d, func, base_field, base_item),
            ShowAs::RunningTotal { base_field } => self.running(&raw, &key, d, func, base_field),
            ShowAs::Rank { base_field } => self.rank(&raw, &key, d, func, base_field),
        };
        Some((v, role, d, custom))
    }

    fn with_item(key: &[(u32, u32)], field: u32, item: u32) -> Vec<(u32, u32)> {
        key.iter()
            .map(|&(f, i)| if f == field { (f, item) } else { (f, i) })
            .collect()
    }

    fn difference(
        &self,
        raw: &Value,
        key: &[(u32, u32)],
        d: u32,
        func: AggFunc,
        base: u32,
        base_item: BaseItem,
    ) -> Value {
        let Some(&(_, cur)) = key.iter().find(|(f, _)| *f == base) else {
            return Value::Empty;
        };
        let visible = self.visible_items(base);
        let pos = visible.iter().position(|&i| i == cur);
        let target = match base_item {
            BaseItem::Item { item } => Some(item),
            BaseItem::Previous => pos.and_then(|p| p.checked_sub(1)).map(|p| visible[p]),
            BaseItem::Next => pos.and_then(|p| visible.get(p + 1).copied()),
        };
        let Some(target) = target.filter(|&t| t != cur) else {
            return Value::Empty;
        };
        let other = self.agg_key(&Self::with_item(key, base, target), d, func);
        match (raw, &other) {
            (Value::Empty, _) => Value::Empty,
            (Value::Error(e), _) | (_, Value::Error(e)) => Value::Error(*e),
            (Value::Number(a), b) => Value::number(a - num(b).unwrap_or(0.0)),
            _ => Value::Empty,
        }
    }

    fn running(&self, raw: &Value, key: &[(u32, u32)], d: u32, func: AggFunc, base: u32) -> Value {
        let Some(&(_, cur)) = key.iter().find(|(f, _)| *f == base) else {
            return Value::Empty;
        };
        if matches!(raw, Value::Empty) {
            return Value::Empty;
        }
        let mut total = 0.0;
        for i in self.visible_items(base) {
            match self.agg_key(&Self::with_item(key, base, i), d, func) {
                Value::Error(e) => return Value::Error(e),
                Value::Number(n) => total += n,
                _ => {}
            }
            if i == cur {
                break;
            }
        }
        Value::number(total)
    }

    fn rank(&self, raw: &Value, key: &[(u32, u32)], d: u32, func: AggFunc, base: u32) -> Value {
        if !key.iter().any(|(f, _)| *f == base) {
            return Value::Empty;
        }
        let Some(x) = num(raw) else {
            return raw.clone();
        };
        let higher = self
            .visible_items(base)
            .into_iter()
            .filter_map(|i| num(&self.agg_key(&Self::with_item(key, base, i), d, func)))
            .filter(|&y| y > x)
            .count();
        Value::Number(higher as f64 + 1.0)
    }
}

/// The axis entries: fields in order, `Σ Values` inserted when there are
/// several data fields on this axis.
fn entries(fields: &[AxisField], t: &PivotTable, axis: ValuesAxis) -> Vec<Entry> {
    let mut e: Vec<Entry> = (0..fields.len()).map(Entry::Field).collect();
    if t.values.len() >= 2 && t.options.values_in == axis {
        let at = t
            .options
            .values_position
            .map_or(e.len(), |p| (p as usize).min(e.len()));
        e.insert(at, Entry::Values);
    }
    e
}

fn plan<'a>(t: &'a PivotTable, rows: bool, caption_row: bool) -> Plan<'a> {
    let fields: &[AxisField] = if rows { &t.rows } else { &t.cols };
    let entries = entries(
        fields,
        t,
        if rows {
            ValuesAxis::Rows
        } else {
            ValuesAxis::Columns
        },
    );
    let n = entries.len();
    let mut layouts = Vec::with_capacity(n);
    for (d, e) in entries.iter().enumerate() {
        let l = if !rows {
            PivotLayout::Tabular
        } else {
            match e {
                Entry::Field(i) => fields[*i].layout,
                Entry::Values if d > 0 => layouts[d - 1],
                Entry::Values => PivotLayout::Compact,
            }
        };
        layouts.push(l);
    }
    let mut offs = Vec::with_capacity(n);
    let mut indents = Vec::with_capacity(n);
    for d in 0..n {
        if !rows {
            offs.push(u32::from(caption_row) + d as u32);
            indents.push(0);
        } else if d == 0 {
            offs.push(0);
            indents.push(0);
        } else if layouts[d - 1] == PivotLayout::Compact {
            offs.push(offs[d - 1]);
            indents.push(indents[d - 1] + 1);
        } else {
            offs.push(offs[d - 1] + 1);
            indents.push(0);
        }
    }
    let indents = indents
        .into_iter()
        .map(|i: u8| i.saturating_mul(t.options.compact_rows_indent))
        .collect();
    let deeper_field = (0..n)
        .map(|d| {
            entries[d + 1..]
                .iter()
                .any(|e| matches!(e, Entry::Field(_)))
        })
        .collect();
    let deeper_values = (0..n)
        .map(|d| entries[d + 1..].contains(&Entry::Values))
        .collect();
    Plan {
        entries,
        fields,
        rows,
        offs,
        indents,
        layouts,
        deeper_field,
        deeper_values,
    }
}

struct Grid {
    cells: Vec<PivotCell>,
    taken: HashMap<(u32, u32), usize>,
}

impl Grid {
    fn put(&mut self, cell: PivotCell) {
        if let std::collections::hash_map::Entry::Vacant(v) = self.taken.entry((cell.row, cell.col))
        {
            v.insert(self.cells.len());
            self.cells.push(cell);
        }
    }

    fn simple(&mut self, row: u32, col: u32, value: Value, kind: CellRole, field: Option<u32>) {
        self.put(PivotCell {
            row,
            col,
            value,
            kind,
            level: 0,
            collapsed: None,
            field,
            item: None,
            number_format: None,
            indent: 0,
        });
    }
}

fn axis_items(lines: &[Line]) -> Vec<AxisLine> {
    lines
        .iter()
        .map(|l| AxisLine {
            kind: l.lkind,
            items: l.path.clone(),
            data: l.data.unwrap_or(0),
        })
        .collect()
}

fn axis_fields(entries: &[Entry], fields: &[AxisField]) -> Vec<i32> {
    entries
        .iter()
        .map(|e| match e {
            Entry::Field(i) => fields[*i].field as i32,
            Entry::Values => -2,
        })
        .collect()
}

impl PivotTable {
    /// Lays the table out at its anchor ([`location`](Self::location)'s
    /// top-left cell) from `cache`. Fails with
    /// [`Error::InvalidPivot`] for a definition that does not fit the
    /// cache or a table larger than two million cells.
    pub fn compute(&self, cache: &PivotCache) -> Result<PivotOutput, Error> {
        let (ar, ac) = self.anchor();
        if self.raw.is_some() {
            // Read-only: the stored cells stay, the area is the table's.
            let mut g = Grid {
                cells: Vec::new(),
                taken: HashMap::new(),
            };
            let l = self.location;
            for r in l.r0..=l.r1 {
                for c in l.c0..=l.c1 {
                    g.simple(r, c, Value::Empty, CellRole::Blank, None);
                }
            }
            return Ok(PivotOutput {
                cells: g.cells,
                extent: l,
                table: l,
                ..Default::default()
            }
            .finish());
        }
        self.validate(cache)?;
        let ctx = Ctx::new(self, cache);
        let o = &self.options;
        let caption_row = !self.cols.is_empty();
        let rp = plan(self, true, caption_row);
        let cp = plan(self, false, caption_row);
        let mut g = Grid {
            cells: Vec::new(),
            taken: HashMap::new(),
        };
        // Page fields above the table, then a blank row.
        let pages = self.filters.len() as u32;
        for (i, p) in self.filters.iter().enumerate() {
            let row = ar + i as u32;
            let cf = &cache.fields[p.field as usize];
            g.simple(
                row,
                ac,
                Value::Text(cf.name.clone()),
                CellRole::Header,
                Some(p.field),
            );
            let text = match &p.selected {
                PageSelection::All => "(All)".to_owned(),
                PageSelection::Items { items } if items.len() == 1 => {
                    cf.item_label(*items.iter().next().expect("one"))
                }
                PageSelection::Items { .. } => "(Multiple Items)".to_owned(),
            };
            g.simple(
                row,
                ac + 1,
                Value::Text(text),
                CellRole::Page,
                Some(p.field),
            );
        }
        let tr = ar + if pages > 0 { pages + 1 } else { 0 };
        let tc = ac;
        let empty = self.rows.is_empty()
            && self.cols.is_empty()
            && self.values.is_empty()
            && self.filters.is_empty();
        if empty {
            // Excel's placeholder area (A3:C20 for a table at A3).
            for r in 0..18 {
                for c in 0..3 {
                    g.simple(tr + r, tc + c, Value::Empty, CellRole::Blank, None);
                }
            }
            let table = PivotRect::new(tr, tc, tr + 17, tc + 2);
            return Ok(PivotOutput {
                cells: g.cells,
                extent: PivotRect::new(ar, ac, table.r1, table.c1),
                table,
                header_rows: 1,
                label_cols: 1,
                first_header_row: 1,
                ..Default::default()
            }
            .finish());
        }
        let row_lines = ctx.lines(&rp, o.grand_total_cols);
        let mut col_lines = ctx.lines(&cp, o.grand_total_rows);
        if cp.entries.is_empty() && self.values.is_empty() {
            col_lines.clear();
        }
        let header_rows = if caption_row {
            1 + cp.entries.len() as u32
        } else {
            1
        };
        let label_cols = if !rp.entries.is_empty() {
            rp.offs.last().copied().unwrap_or(0) + 1
        } else {
            u32::from(caption_row)
        };
        let width = (label_cols + col_lines.len() as u32).max(1);
        let height = header_rows + row_lines.len() as u32;
        if u64::from(width) * u64::from(height) > MAX_CELLS as u64 {
            return Err(Error::InvalidPivot("the pivot table is too large".into()));
        }
        let last_row = u64::from(tr) + u64::from(height) - 1;
        let last_col = u64::from(tc) + u64::from(width) - 1;
        if last_row > u64::from(engine_formula::ast::MAX_ROW)
            || last_col > u64::from(engine_formula::ast::MAX_COL)
        {
            return Err(Error::InvalidPivot(
                "the pivot table does not fit on the sheet".into(),
            ));
        }
        let compact = self
            .rows
            .first()
            .map_or(true, |a| a.layout == PivotLayout::Compact);
        let single_caption = (self.values.len() == 1).then(|| self.values[0].caption(cache));
        // Captions.
        let data_col = tc + label_cols;
        if caption_row {
            if let Some(c) = &single_caption {
                g.simple(tr, tc, Value::Text(c.clone()), CellRole::Header, None);
            }
            if o.show_field_headers {
                if compact {
                    g.simple(
                        tr,
                        data_col,
                        Value::Text("Column Labels".into()),
                        CellRole::Header,
                        None,
                    );
                } else {
                    for (i, e) in cp.entries.iter().enumerate() {
                        let (text, field) = match e {
                            Entry::Field(k) => {
                                let f = self.cols[*k].field;
                                (ctx.field_name(f), Some(f))
                            }
                            Entry::Values => ("Values".to_owned(), None),
                        };
                        g.simple(
                            tr,
                            data_col + i as u32,
                            Value::Text(text),
                            CellRole::Header,
                            field,
                        );
                    }
                }
            }
        } else if cp.entries.is_empty() && !col_lines.is_empty() {
            let text = if rp.entries.contains(&Entry::Values) {
                Value::Empty
            } else {
                Value::Text(single_caption.clone().unwrap_or_default())
            };
            let kind = if matches!(text, Value::Empty) {
                CellRole::Blank
            } else {
                CellRole::Header
            };
            g.simple(tr, data_col, text, kind, None);
        }
        let header_row = tr + header_rows - 1;
        if o.show_field_headers && !rp.entries.is_empty() {
            if compact {
                g.simple(
                    header_row,
                    tc,
                    Value::Text("Row Labels".into()),
                    CellRole::Header,
                    None,
                );
            } else {
                for (d, e) in rp.entries.iter().enumerate() {
                    let (text, field) = match e {
                        Entry::Field(k) => {
                            let f = self.rows[*k].field;
                            (ctx.field_name(f), Some(f))
                        }
                        Entry::Values => ("Values".to_owned(), None),
                    };
                    g.simple(
                        header_row,
                        tc + rp.offs[d],
                        Value::Text(text),
                        CellRole::Header,
                        field,
                    );
                }
            }
        }
        // Column labels.
        for (j, l) in col_lines.iter().enumerate() {
            for lab in &l.labels {
                g.put(PivotCell {
                    row: tr + lab.off,
                    col: data_col + j as u32,
                    value: lab.value.clone(),
                    kind: lab.kind,
                    level: lab.level,
                    collapsed: lab.collapsed,
                    field: lab.field,
                    item: lab.item,
                    number_format: lab.fmt.clone(),
                    indent: 0,
                });
            }
        }
        // Body.
        let mut entries = Vec::new();
        for (i, rl) in row_lines.iter().enumerate() {
            let row = tr + header_rows + i as u32;
            for lab in &rl.labels {
                g.put(PivotCell {
                    row,
                    col: tc + lab.off,
                    value: lab.value.clone(),
                    kind: lab.kind,
                    level: lab.level,
                    collapsed: lab.collapsed,
                    field: lab.field,
                    item: lab.item,
                    number_format: lab.fmt.clone(),
                    indent: lab.indent,
                });
            }
            for (j, cl) in col_lines.iter().enumerate() {
                let col = data_col + j as u32;
                let level = rl.labels.last().map_or(0, |l| l.level);
                match ctx.value(rl, cl) {
                    None => g.put(PivotCell {
                        row,
                        col,
                        value: Value::Empty,
                        kind: CellRole::Blank,
                        level,
                        collapsed: None,
                        field: None,
                        item: None,
                        number_format: None,
                        indent: 0,
                    }),
                    Some((v, kind, d, custom)) => {
                        if custom.is_none() && !matches!(v, Value::Empty) {
                            entries.push(DataEntry {
                                data: d,
                                key: rl.key.iter().chain(&cl.key).copied().collect(),
                                row,
                                col,
                            });
                        }
                        let df = &self.values[d as usize];
                        let shown = match v {
                            Value::Empty if !o.empty_as.is_empty() => {
                                Value::Text(o.empty_as.clone())
                            }
                            Value::Error(_) if o.error_as.is_some() => {
                                Value::Text(o.error_as.clone().unwrap_or_default())
                            }
                            v => v,
                        };
                        let fmt = match df.show_as {
                            ShowAs::Rank { .. } => None,
                            _ => df.effective_format(),
                        };
                        g.put(PivotCell {
                            row,
                            col,
                            value: shown,
                            kind,
                            level,
                            collapsed: None,
                            field: None,
                            item: None,
                            number_format: fmt,
                            indent: 0,
                        });
                    }
                }
            }
        }
        let table = PivotRect::new(tr, tc, tr + height - 1, tc + width - 1);
        for r in table.r0..=table.r1 {
            for c in table.c0..=table.c1 {
                g.simple(r, c, Value::Empty, CellRole::Blank, None);
            }
        }
        let extent = PivotRect::new(
            ar,
            ac,
            table.r1,
            table.c1.max(if pages > 0 { ac + 1 } else { ac }),
        );
        let first_header_row = if caption_row || cp.entries.is_empty() {
            1
        } else {
            0
        };
        Ok(PivotOutput {
            cells: g.cells,
            extent,
            table,
            header_rows,
            label_cols,
            first_header_row,
            row_fields: axis_fields(&rp.entries, &self.rows),
            col_fields: axis_fields(&cp.entries, &self.cols),
            row_items: axis_items(&row_lines),
            col_items: axis_items(&col_lines),
            entries,
            index: HashMap::new(),
        }
        .finish())
    }
}
