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

pub use crate::coord::*;

/// Width (in columns) of one bucket of the range index.
pub const BUCKET_WIDTH: u32 = 64;
/// Ranges touching more than this many column buckets are kept in the
/// per-sheet linear "wide" list instead of being bucketed.
pub const WIDE_BUCKETS: u32 = 16;

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

/// Evaluation plan that tolerates circular references (see
/// [`DependencyGraph::recalc_schedule`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Schedule {
    /// The affected formula cells. Every cell that is not in `cyclic` comes
    /// after all of its affected precedents; the cells of one cycle are
    /// adjacent and sorted. Without a cycle this equals
    /// [`DependencyGraph::recalc_order`].
    pub order: Vec<CellCoord>,
    /// Cells lying on a circular reference.
    pub cyclic: HashSet<CellCoord>,
    /// The cycle [`DependencyGraph::recalc_order`] would report, if any.
    pub cycle: Option<Cycle>,
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
        self.order(&self.affected(changed))
    }

    /// Evaluation order of all formula cells (e.g. after opening a file).
    pub fn full_order(&self) -> Result<Vec<CellCoord>, Cycle> {
        self.order(&self.formulas.keys().copied().collect())
    }

    /// Like [`recalc_order`](Self::recalc_order), but a circular reference
    /// does not abort the ordering: see [`Schedule`].
    pub fn recalc_schedule(&self, changed: &[CellCoord]) -> Schedule {
        self.schedule(&self.affected(changed))
    }

    /// Like [`full_order`](Self::full_order), tolerating cycles.
    pub fn full_schedule(&self) -> Schedule {
        self.schedule(&self.formulas.keys().copied().collect())
    }

    /// Formula cells among `changed` plus all their transitive dependents.
    fn affected(&self, changed: &[CellCoord]) -> HashSet<CellCoord> {
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
        affected
    }

    /// Kahn's order when acyclic (the common, cheap case); otherwise a
    /// topological order of the strongly connected components.
    fn schedule(&self, nodes: &HashSet<CellCoord>) -> Schedule {
        match self.order(nodes) {
            Ok(order) => Schedule {
                order,
                ..Schedule::default()
            },
            Err(cycle) => {
                let (order, cyclic) = self.component_order(nodes);
                Schedule {
                    order,
                    cyclic,
                    cycle: Some(cycle),
                }
            }
        }
    }

    /// Orders the strongly connected components of the subgraph induced by
    /// `nodes` (closed under "dependent of") topologically, ties broken by
    /// the smallest cell of a component; cells inside a component are
    /// sorted. Returns the order and the set of cells on a cycle
    /// (components with more than one cell, or a cell referencing itself).
    fn component_order(&self, nodes: &HashSet<CellCoord>) -> (Vec<CellCoord>, HashSet<CellCoord>) {
        let edges: HashMap<CellCoord, Vec<CellCoord>> = nodes
            .iter()
            .map(|&n| (n, self.direct_dependents(n)))
            .collect();
        let mut sorted: Vec<CellCoord> = nodes.iter().copied().collect();
        sorted.sort_unstable();
        let comp = strongly_connected(&sorted, &edges);
        let count = comp.values().max().map_or(0, |&m| m + 1);
        let mut members: Vec<Vec<CellCoord>> = vec![Vec::new(); count];
        for &n in &sorted {
            members[comp[&n]].push(n);
        }
        let mut succ: Vec<HashSet<usize>> = vec![HashSet::new(); count];
        let mut indeg = vec![0usize; count];
        let mut cyclic = HashSet::new();
        for (&n, deps) in &edges {
            for d in deps {
                let (a, b) = (comp[&n], comp[d]);
                if a != b {
                    if succ[a].insert(b) {
                        indeg[b] += 1;
                    }
                } else if n == *d {
                    cyclic.insert(n);
                }
            }
        }
        for m in members.iter().filter(|m| m.len() > 1) {
            cyclic.extend(m.iter().copied());
        }
        let mut heap: BinaryHeap<Reverse<(CellCoord, usize)>> = (0..count)
            .filter(|&i| indeg[i] == 0)
            .map(|i| Reverse((members[i][0], i)))
            .collect();
        let mut out = Vec::with_capacity(nodes.len());
        while let Some(Reverse((_, i))) = heap.pop() {
            out.extend_from_slice(&members[i]);
            for &j in &succ[i] {
                indeg[j] -= 1;
                if indeg[j] == 0 {
                    heap.push(Reverse((members[j][0], j)));
                }
            }
        }
        (out, cyclic)
    }

    pub fn formula_count(&self) -> usize {
        self.formulas.len()
    }

    /// Kahn's algorithm over the subgraph induced by `nodes` (which must be
    /// closed under "dependent of"), using a min-heap for determinism.
    fn order(&self, nodes: &HashSet<CellCoord>) -> Result<Vec<CellCoord>, Cycle> {
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

/// Iterative Tarjan: maps every node to the index of its strongly
/// connected component. `edges` must contain every node of `nodes`.
fn strongly_connected(
    nodes: &[CellCoord],
    edges: &HashMap<CellCoord, Vec<CellCoord>>,
) -> HashMap<CellCoord, usize> {
    let mut index: HashMap<CellCoord, usize> = HashMap::with_capacity(nodes.len());
    let mut low: HashMap<CellCoord, usize> = HashMap::with_capacity(nodes.len());
    let mut on_stack: HashSet<CellCoord> = HashSet::new();
    let mut stack: Vec<CellCoord> = Vec::new();
    let mut comp: HashMap<CellCoord, usize> = HashMap::with_capacity(nodes.len());
    let mut next = 0;
    let mut components = 0;
    for &root in nodes {
        if index.contains_key(&root) {
            continue;
        }
        index.insert(root, next);
        low.insert(root, next);
        next += 1;
        stack.push(root);
        on_stack.insert(root);
        let mut call: Vec<(CellCoord, usize)> = vec![(root, 0)];
        while let Some(frame) = call.last_mut() {
            let v = frame.0;
            if let Some(&w) = edges[&v].get(frame.1) {
                frame.1 += 1;
                if let std::collections::hash_map::Entry::Vacant(slot) = index.entry(w) {
                    slot.insert(next);
                    low.insert(w, next);
                    next += 1;
                    stack.push(w);
                    on_stack.insert(w);
                    call.push((w, 0));
                } else if on_stack.contains(&w) {
                    let lw = index[&w].min(low[&v]);
                    low.insert(v, lw);
                }
                continue;
            }
            call.pop();
            if let Some(&(u, _)) = call.last() {
                let lu = low[&u].min(low[&v]);
                low.insert(u, lu);
            }
            if low[&v] == index[&v] {
                loop {
                    let w = stack.pop().expect("v is on the stack");
                    on_stack.remove(&w);
                    comp.insert(w, components);
                    if w == v {
                        break;
                    }
                }
                components += 1;
            }
        }
    }
    comp
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
    fn schedule_orders_around_cycles() {
        let mut g = DependencyGraph::new();
        let c = |row, col| CellCoord::new(S, row, col);
        set(&mut g, 0, 0, "=B1"); // A1 -> B1 -> A1 (cycle)
        set(&mut g, 0, 1, "=A1+Z1");
        set(&mut g, 0, 2, "=A1"); // C1 depends on the cycle
        set(&mut g, 0, 3, "=Z1"); // D1 outside
        set(&mut g, 0, 4, "=E1"); // E1 references itself
        assert!(g.recalc_order(&[c(0, 25)]).is_err());
        let s = g.recalc_schedule(&[c(0, 25)]);
        assert_eq!(s.order, vec![c(0, 0), c(0, 1), c(0, 2), c(0, 3)]);
        assert_eq!(s.cyclic, HashSet::from([c(0, 0), c(0, 1)]));
        assert_eq!(s.cycle.unwrap().cells, vec![c(0, 0), c(0, 1)]);
        let full = g.full_schedule();
        assert_eq!(full.order.len(), 5);
        assert!(full.cyclic.contains(&c(0, 4)));
        let ok = g.recalc_schedule(&[c(0, 3)]);
        assert_eq!((ok.order, ok.cycle), (vec![c(0, 3)], None));
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
