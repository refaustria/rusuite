//! Dependency graph between formula cells.
//!
//! [`DependencyGraph`] records, for every formula cell, which cells and
//! ranges it reads (its *precedents*), and answers "these cells changed –
//! which formulas must be recalculated, in which order, and is there a
//! circular reference?". It holds no values and performs no evaluation.
//!
//! # Data layout
//!
//! Per sheet, the reverse edges (precedent → dependent formula) are kept in
//! a [`SheetIndex`]:
//!
//! * single-cell precedents live in a `HashMap<CellCoord, Vec<CellCoord>>`
//!   (exact match, O(1) expected lookup);
//! * range precedents are **never expanded cell by cell** (`=SUM(A:A)` is a
//!   single entry). Ranges spanning at most [`WIDE_BUCKETS`] column buckets
//!   of [`BUCKET_WIDTH`] columns are stored in every bucket they touch; wider
//!   ranges (e.g. whole rows `1:1`) go into one linear `wide` list.
//!
//! Looking up the dependents of a cell therefore costs
//! O(d_cell + r_bucket + r_wide + k log k): the exact cell hits, plus a
//! linear scan of the range entries in the cell's column bucket and of the
//! wide ranges, plus sorting the `k` results. This is fine for typical
//! sheets; a 2-D interval index (R-tree or row/column interval trees) is the
//! natural upgrade if many overlapping ranges in the same columns appear.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::ast::{Expr, RangeKind, Reference, MAX_COL, MAX_ROW};

/// Width (in columns) of one bucket of the range index.
pub const BUCKET_WIDTH: u32 = 64;
/// Ranges touching more than this many column buckets are kept in the
/// per-sheet linear "wide" list instead of being bucketed.
pub const WIDE_BUCKETS: u32 = 16;

/// Identifier of a sheet inside a workbook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SheetId(pub u32);

/// Absolute position of a cell (0-based row/column). Ordering is by sheet,
/// then row, then column; it is used to break ties deterministically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CellCoord {
    pub sheet: SheetId,
    pub row: u32,
    pub col: u32,
}

impl CellCoord {
    pub fn new(sheet: SheetId, row: u32, col: u32) -> Self {
        CellCoord { sheet, row, col }
    }
}

/// Rectangular range on one sheet, inclusive and normalized
/// (`r0 <= r1`, `c0 <= c1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RangeRef {
    pub sheet: SheetId,
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl RangeRef {
    /// Builds a normalized range from two corners in any order.
    pub fn new(sheet: SheetId, r0: u32, c0: u32, r1: u32, c1: u32) -> Self {
        RangeRef {
            sheet,
            r0: r0.min(r1),
            c0: c0.min(c1),
            r1: r0.max(r1),
            c1: c0.max(c1),
        }
    }

    /// True if `cell` lies inside the range.
    pub fn contains(&self, cell: CellCoord) -> bool {
        cell.sheet == self.sheet
            && (self.r0..=self.r1).contains(&cell.row)
            && (self.c0..=self.c1).contains(&cell.col)
    }
}

/// Resolves sheet names used in references (`Sheet2!A1`) to ids.
pub trait SheetResolver {
    fn sheet_id(&self, name: &str) -> Option<SheetId>;
}

/// Something a formula reads.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Precedent {
    Cell(CellCoord),
    Range(RangeRef),
    /// Reference to a sheet name the resolver did not know. Ignored for
    /// ordering; kept so a later sheet rename/insert can re-resolve it.
    Unresolved(String),
}

/// A circular reference.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("circular reference through {} cell(s), starting at {:?}", cells.len(), cells.first())]
pub struct Cycle {
    /// The cells forming one cycle, starting from the smallest coordinate;
    /// each cell references the next one, and the last references the first.
    pub cells: Vec<CellCoord>,
}

/// Reverse edges of one sheet: precedent location → dependent formulas.
#[derive(Debug, Clone, Default)]
struct SheetIndex {
    cells: HashMap<CellCoord, Vec<CellCoord>>,
    buckets: HashMap<u32, Vec<(RangeRef, CellCoord)>>,
    wide: Vec<(RangeRef, CellCoord)>,
}

impl SheetIndex {
    fn bucket_span(r: &RangeRef) -> Option<std::ops::RangeInclusive<u32>> {
        let (b0, b1) = (r.c0 / BUCKET_WIDTH, r.c1 / BUCKET_WIDTH);
        (b1 - b0 < WIDE_BUCKETS).then_some(b0..=b1)
    }

    fn add_range(&mut self, r: RangeRef, dep: CellCoord) {
        match Self::bucket_span(&r) {
            Some(span) => {
                for b in span {
                    self.buckets.entry(b).or_default().push((r, dep));
                }
            }
            None => self.wide.push((r, dep)),
        }
    }

    fn remove_range(&mut self, r: RangeRef, dep: CellCoord) {
        match Self::bucket_span(&r) {
            Some(span) => {
                for b in span {
                    if let Some(list) = self.buckets.get_mut(&b) {
                        list.retain(|e| *e != (r, dep));
                        if list.is_empty() {
                            self.buckets.remove(&b);
                        }
                    }
                }
            }
            None => self.wide.retain(|e| *e != (r, dep)),
        }
    }

    fn add_cell(&mut self, p: CellCoord, dep: CellCoord) {
        self.cells.entry(p).or_default().push(dep);
    }

    fn remove_cell(&mut self, p: CellCoord, dep: CellCoord) {
        if let Some(list) = self.cells.get_mut(&p) {
            list.retain(|d| *d != dep);
            if list.is_empty() {
                self.cells.remove(&p);
            }
        }
    }

    fn collect_dependents(&self, cell: CellCoord, out: &mut Vec<CellCoord>) {
        if let Some(list) = self.cells.get(&cell) {
            out.extend_from_slice(list);
        }
        if let Some(list) = self.buckets.get(&(cell.col / BUCKET_WIDTH)) {
            out.extend(list.iter().filter(|(r, _)| r.contains(cell)).map(|e| e.1));
        }
        out.extend(
            self.wide
                .iter()
                .filter(|(r, _)| r.contains(cell))
                .map(|e| e.1),
        );
    }

    fn is_empty(&self) -> bool {
        self.cells.is_empty() && self.buckets.is_empty() && self.wide.is_empty()
    }
}

/// Dependency graph of all formula cells of a workbook. See the module docs
/// for the data layout and lookup complexity.
#[derive(Debug, Clone, Default)]
pub struct DependencyGraph {
    /// Formula cell → its (deduplicated) precedents in source order.
    formulas: HashMap<CellCoord, Vec<Precedent>>,
    /// Reverse edges, per sheet of the precedent.
    sheets: HashMap<SheetId, SheetIndex>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers or replaces the formula of `cell`, extracting its
    /// precedents via [`Expr::references`]. References without a sheet
    /// prefix resolve to `current_sheet`; unknown sheet names are recorded
    /// as [`Precedent::Unresolved`]. Whole columns/rows become ranges
    /// clipped to [`MAX_ROW`]/[`MAX_COL`].
    pub fn set_formula(
        &mut self,
        cell: CellCoord,
        expr: &Expr,
        resolver: &dyn SheetResolver,
        current_sheet: SheetId,
    ) {
        self.remove_formula(cell);
        let mut precedents: Vec<Precedent> = Vec::new();
        for r in expr.references() {
            let p = resolve(r, resolver, current_sheet);
            if !precedents.contains(&p) {
                precedents.push(p);
            }
        }
        for p in &precedents {
            match p {
                Precedent::Cell(c) => self.sheets.entry(c.sheet).or_default().add_cell(*c, cell),
                Precedent::Range(r) => self.sheets.entry(r.sheet).or_default().add_range(*r, cell),
                Precedent::Unresolved(_) => {}
            }
        }
        self.formulas.insert(cell, precedents);
    }

    /// Removes the formula of `cell` (it became a constant or was cleared).
    /// No-op if `cell` holds no formula.
    pub fn remove_formula(&mut self, cell: CellCoord) {
        let Some(old) = self.formulas.remove(&cell) else {
            return;
        };
        for p in old {
            let sheet = match p {
                Precedent::Cell(c) => c.sheet,
                Precedent::Range(r) => r.sheet,
                Precedent::Unresolved(_) => continue,
            };
            if let Some(idx) = self.sheets.get_mut(&sheet) {
                match p {
                    Precedent::Cell(c) => idx.remove_cell(c, cell),
                    Precedent::Range(r) => idx.remove_range(r, cell),
                    Precedent::Unresolved(_) => {}
                }
                if idx.is_empty() {
                    self.sheets.remove(&sheet);
                }
            }
        }
    }

    pub fn has_formula(&self, cell: CellCoord) -> bool {
        self.formulas.contains_key(&cell)
    }

    /// Precedents of `cell` in source order (deduplicated); empty if `cell`
    /// holds no formula.
    pub fn precedents(&self, cell: CellCoord) -> impl Iterator<Item = &Precedent> {
        self.formulas.get(&cell).into_iter().flatten()
    }

    /// Formula cells that reference `cell` directly or through a range
    /// containing it; sorted and deduplicated.
    pub fn direct_dependents(&self, cell: CellCoord) -> Vec<CellCoord> {
        let mut out = Vec::new();
        if let Some(idx) = self.sheets.get(&cell.sheet) {
            idx.collect_dependents(cell, &mut out);
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// All formula cells that must be recalculated when `changed` change,
    /// transitively, in evaluation order (precedents first, ties broken by
    /// [`CellCoord`] order). Changed cells are included only if they hold
    /// formulas. Cycles outside the affected cells are ignored.
    pub fn recalc_order(&self, changed: &[CellCoord]) -> Result<Vec<CellCoord>, Cycle> {
        let mut affected: HashSet<CellCoord> = HashSet::new();
        let mut stack: Vec<CellCoord> = Vec::new();
        for &c in changed {
            if self.has_formula(c) && affected.insert(c) {
                stack.push(c);
            }
            for d in self.direct_dependents(c) {
                if affected.insert(d) {
                    stack.push(d);
                }
            }
        }
        while let Some(c) = stack.pop() {
            for d in self.direct_dependents(c) {
                if affected.insert(d) {
                    stack.push(d);
                }
            }
        }
        self.order(affected)
    }

    /// Evaluation order of all formula cells (e.g. after opening a file).
    pub fn full_order(&self) -> Result<Vec<CellCoord>, Cycle> {
        self.order(self.formulas.keys().copied().collect())
    }

    pub fn formula_count(&self) -> usize {
        self.formulas.len()
    }

    /// Kahn's algorithm over the subgraph induced by `nodes` (which must be
    /// closed under "dependent of"), using a min-heap for determinism.
    fn order(&self, nodes: HashSet<CellCoord>) -> Result<Vec<CellCoord>, Cycle> {
        let edges: HashMap<CellCoord, Vec<CellCoord>> = nodes
            .iter()
            .map(|&n| (n, self.direct_dependents(n)))
            .collect();
        let mut indeg: HashMap<CellCoord, usize> = nodes.iter().map(|&n| (n, 0)).collect();
        for deps in edges.values() {
            for d in deps {
                *indeg.get_mut(d).expect("node set closed under dependents") += 1;
            }
        }
        let mut heap: BinaryHeap<Reverse<CellCoord>> = indeg
            .iter()
            .filter(|(_, &k)| k == 0)
            .map(|(&n, _)| Reverse(n))
            .collect();
        let mut out = Vec::with_capacity(nodes.len());
        while let Some(Reverse(n)) = heap.pop() {
            out.push(n);
            for d in &edges[&n] {
                let k = indeg.get_mut(d).expect("node in set");
                *k -= 1;
                if *k == 0 {
                    heap.push(Reverse(*d));
                }
            }
        }
        if out.len() == nodes.len() {
            return Ok(out);
        }
        Err(find_cycle(&edges, &indeg))
    }
}

/// Every node left with a positive in-degree after Kahn's algorithm has a
/// predecessor that is also left, so walking predecessors must revisit a
/// node; the revisited stretch is a cycle.
fn find_cycle(
    edges: &HashMap<CellCoord, Vec<CellCoord>>,
    indeg: &HashMap<CellCoord, usize>,
) -> Cycle {
    let left = |c: &CellCoord| indeg[c] > 0;
    let mut preds: HashMap<CellCoord, Vec<CellCoord>> = HashMap::new();
    for (p, deps) in edges.iter().filter(|(p, _)| left(p)) {
        for d in deps.iter().filter(|d| left(d)) {
            preds.entry(*d).or_default().push(*p);
        }
    }
    let start = *indeg
        .iter()
        .filter(|(_, &k)| k > 0)
        .map(|(c, _)| c)
        .min()
        .expect("at least one node left");
    let mut path = vec![start];
    let mut pos: HashMap<CellCoord, usize> = HashMap::from([(start, 0)]);
    let mut cur = start;
    loop {
        cur = *preds[&cur]
            .iter()
            .min()
            .expect("left node has a left predecessor");
        if let Some(&i) = pos.get(&cur) {
            let mut cells = path.split_off(i);
            let min_at = (0..cells.len())
                .min_by_key(|&j| cells[j])
                .expect("non-empty cycle");
            cells.rotate_left(min_at);
            return Cycle { cells };
        }
        pos.insert(cur, path.len());
        path.push(cur);
    }
}

fn resolve(r: &Reference, resolver: &dyn SheetResolver, current: SheetId) -> Precedent {
    let sheet = match &r.sheet {
        None => current,
        Some(name) => match resolver.sheet_id(name) {
            Some(id) => id,
            None => return Precedent::Unresolved(name.clone()),
        },
    };
    match r.kind {
        RangeKind::Cell(c) => Precedent::Cell(CellCoord::new(sheet, c.row, c.col)),
        RangeKind::Area(a, b) => Precedent::Range(RangeRef::new(sheet, a.row, a.col, b.row, b.col)),
        RangeKind::Cols { start, end, .. } => {
            Precedent::Range(RangeRef::new(sheet, 0, start, MAX_ROW, end))
        }
        RangeKind::Rows { start, end, .. } => {
            Precedent::Range(RangeRef::new(sheet, start, 0, end, MAX_COL))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;

    struct NoSheets;
    impl SheetResolver for NoSheets {
        fn sheet_id(&self, _: &str) -> Option<SheetId> {
            None
        }
    }

    const S: SheetId = SheetId(0);

    fn set(g: &mut DependencyGraph, row: u32, col: u32, f: &str) {
        g.set_formula(
            CellCoord::new(S, row, col),
            &parse(f).unwrap(),
            &NoSheets,
            S,
        );
    }

    #[test]
    fn whole_row_goes_to_wide_list_and_column_to_bucket() {
        let mut g = DependencyGraph::new();
        set(&mut g, 0, 0, "=SUM(5:5)");
        set(&mut g, 1, 0, "=SUM(B:C)");
        let idx = &g.sheets[&S];
        assert_eq!(idx.wide.len(), 1);
        assert_eq!(idx.buckets.len(), 1);
        assert_eq!(
            g.direct_dependents(CellCoord::new(S, 4, MAX_COL)),
            vec![CellCoord::new(S, 0, 0)]
        );
        assert_eq!(
            g.direct_dependents(CellCoord::new(S, 4, 1)),
            vec![CellCoord::new(S, 0, 0), CellCoord::new(S, 1, 0)]
        );
    }

    #[test]
    fn range_spanning_buckets_is_found_and_removed_everywhere() {
        let mut g = DependencyGraph::new();
        set(&mut g, 0, 0, "=SUM(B2:CZ9)"); // columns 1..=103, buckets 0 and 1
        assert_eq!(g.sheets[&S].buckets.len(), 2);
        assert_eq!(g.direct_dependents(CellCoord::new(S, 3, 100)).len(), 1);
        g.remove_formula(CellCoord::new(S, 0, 0));
        assert!(g.sheets.is_empty());
    }

    #[test]
    fn duplicate_references_are_deduplicated() {
        let mut g = DependencyGraph::new();
        set(&mut g, 0, 0, "=B1+B1+SUM(C1:C2)+SUM(C1:C2)");
        assert_eq!(g.precedents(CellCoord::new(S, 0, 0)).count(), 2);
        assert_eq!(g.sheets[&S].cells[&CellCoord::new(S, 0, 1)].len(), 1);
        g.remove_formula(CellCoord::new(S, 0, 0));
        assert!(g.sheets.is_empty());
    }

    #[test]
    fn range_ref_contains_and_normalizes() {
        let r = RangeRef::new(S, 5, 5, 1, 2);
        assert_eq!((r.r0, r.c0, r.r1, r.c1), (1, 2, 5, 5));
        assert!(r.contains(CellCoord::new(S, 1, 2)));
        assert!(r.contains(CellCoord::new(S, 5, 5)));
        assert!(!r.contains(CellCoord::new(S, 6, 5)));
        assert!(!r.contains(CellCoord::new(SheetId(1), 1, 2)));
    }
}
