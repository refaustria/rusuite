//! Orthogonal routing of elbow connectors between two glued ends:
//! PowerPoint's routes with one to four turns, detouring around the
//! attached shapes' boxes when the sites face away from each other.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::connector::Point;

/// An axis-aligned box `(left, top, right, bottom)` in EMU.
pub type Bounds = (f64, f64, f64, f64);

/// How far detours keep away from a shape's box (0.25").
pub const DETOUR_MARGIN: f64 = 228_600.0;

/// Cost of one turn: routes with fewer turns always win.
const TURN: f64 = 1.0e12;

#[derive(Clone, Copy, PartialEq)]
struct State {
    cost: f64,
    node: usize,
    dir: usize,
}

impl Eq for State {}

impl Ord for State {
    fn cmp(&self, o: &Self) -> Ordering {
        o.cost
            .partial_cmp(&self.cost)
            .unwrap_or(Ordering::Equal)
            .then_with(|| o.node.cmp(&self.node))
    }
}

impl PartialOrd for State {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// The four axis directions: right, down, left, up (the order of the
/// connection-site angles 0°, 90°, 180°, 270°).
const DIRS: [(f64, f64); 4] = [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)];

/// The axis direction closest to angle `deg` (0 = right, 90 = down).
pub fn axis_dir(deg: f64) -> usize {
    ((deg.rem_euclid(360.0) + 45.0) / 90.0).floor() as usize % 4
}

fn crosses(a: Point, b: Point, r: Bounds) -> bool {
    let eps = 1.0;
    let (l, t, rr, bb) = (r.0 + eps, r.1 + eps, r.2 - eps, r.3 - eps);
    if l >= rr || t >= bb {
        return false;
    }
    let (x0, x1) = (a.0.min(b.0), a.0.max(b.0));
    let (y0, y1) = (a.1.min(b.1), a.1.max(b.1));
    x0 < rr && x1 > l && y0 < bb && y1 > t
}

/// The corners of the route from `start` (leaving in direction
/// `start_dir`, an index of [`DIRS`]) to `end` (entered against
/// `end_dir`, the site's outward direction), start and end included, with
/// as few turns as possible (at most four) and then as short as possible,
/// not passing through `obstacles`. `None` when no such route exists.
pub fn route(
    start: Point,
    start_dir: usize,
    end: Point,
    end_dir: usize,
    obstacles: &[Bounds],
) -> Option<Vec<Point>> {
    let m = DETOUR_MARGIN;
    let (sd, ed) = (DIRS[start_dir % 4], DIRS[end_dir % 4]);
    // candidate lines: the ends, stubs leaving the sites, lines around the
    // boxes and, in a gap between the two boxes, only its middle (as
    // PowerPoint runs connectors there)
    let mut gaps_x: Vec<(f64, f64)> = Vec::new();
    let mut gaps_y: Vec<(f64, f64)> = Vec::new();
    let mut xs = vec![start.0, end.0, (start.0 + end.0) / 2.0];
    let mut ys = vec![start.1, end.1, (start.1 + end.1) / 2.0];
    if obstacles.len() == 2 {
        let (a, b) = (obstacles[0], obstacles[1]);
        for (lo, hi) in [(a.2, b.0), (b.2, a.0)] {
            if hi > lo {
                gaps_x.push((lo, hi));
                xs.push((lo + hi) / 2.0);
            }
        }
        for (lo, hi) in [(a.3, b.1), (b.3, a.1)] {
            if hi > lo {
                gaps_y.push((lo, hi));
                ys.push((lo + hi) / 2.0);
            }
        }
    }
    let in_gap = |v: f64, gaps: &[(f64, f64)]| gaps.iter().any(|&(lo, hi)| v > lo && v < hi);
    let mut extra_x = vec![start.0 + sd.0 * m, end.0 + ed.0 * m];
    let mut extra_y = vec![start.1 + sd.1 * m, end.1 + ed.1 * m];
    for b in obstacles {
        extra_x.extend([b.0 - m, b.2 + m]);
        extra_y.extend([b.1 - m, b.3 + m]);
    }
    xs.extend(extra_x.into_iter().filter(|&v| !in_gap(v, &gaps_x)));
    ys.extend(extra_y.into_iter().filter(|&v| !in_gap(v, &gaps_y)));
    let dedup = |v: &mut Vec<f64>| {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
        v.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    };
    dedup(&mut xs);
    dedup(&mut ys);
    let (nx, ny) = (xs.len(), ys.len());
    let find = |v: &[f64], x: f64| v.iter().position(|&c| (c - x).abs() < 0.5);
    let (sx, sy) = (find(&xs, start.0)?, find(&ys, start.1)?);
    let (ex, ey) = (find(&xs, end.0)?, find(&ys, end.1)?);
    let node = |ix: usize, iy: usize| iy * nx + ix;
    let pos = |n: usize| (xs[n % nx], ys[n / nx]);
    let n_nodes = nx * ny;
    let goal = node(ex, ey);
    let arrive = (end_dir + 2) % 4;
    let mut best = vec![f64::INFINITY; n_nodes * 4];
    let mut prev = vec![usize::MAX; n_nodes * 4];
    let mut heap = BinaryHeap::new();
    let s = node(sx, sy);
    best[s * 4 + start_dir] = 0.0;
    heap.push(State {
        cost: 0.0,
        node: s,
        dir: start_dir,
    });
    let step = |n: usize, d: usize| -> Option<usize> {
        let (ix, iy) = (n % nx, n / nx);
        match d {
            0 if ix + 1 < nx => Some(node(ix + 1, iy)),
            1 if iy + 1 < ny => Some(node(ix, iy + 1)),
            2 if ix > 0 => Some(node(ix - 1, iy)),
            3 if iy > 0 => Some(node(ix, iy - 1)),
            _ => None,
        }
    };
    let mut found = None;
    while let Some(State { cost, node: n, dir }) = heap.pop() {
        if cost > best[n * 4 + dir] {
            continue;
        }
        if n == goal && dir == arrive {
            found = Some(n * 4 + dir);
            break;
        }
        for d in 0..4 {
            if d == (dir + 2) % 4 || (n == s && d != start_dir) {
                continue;
            }
            let Some(next) = step(n, d) else { continue };
            let (a, b) = (pos(n), pos(next));
            if obstacles.iter().any(|r| crosses(a, b, *r)) {
                continue;
            }
            let len = (b.0 - a.0).abs() + (b.1 - a.1).abs();
            let c = cost + len + if d == dir { 0.0 } else { TURN };
            let k = next * 4 + d;
            if c < best[k] {
                best[k] = c;
                prev[k] = n * 4 + dir;
                heap.push(State {
                    cost: c,
                    node: next,
                    dir: d,
                });
            }
        }
    }
    let mut k = found?;
    let mut pts = vec![pos(k / 4)];
    while prev[k] != usize::MAX {
        k = prev[k];
        pts.push(pos(k / 4));
    }
    pts.reverse();
    // keep the corners only
    let mut out: Vec<Point> = Vec::new();
    for p in pts {
        if out
            .last()
            .is_some_and(|q| (q.0 - p.0).abs() < 0.5 && (q.1 - p.1).abs() < 0.5)
        {
            continue;
        }
        if out.len() >= 2 {
            let (a, b) = (out[out.len() - 2], out[out.len() - 1]);
            let collinear = ((a.0 - b.0).abs() < 0.5 && (b.0 - p.0).abs() < 0.5)
                || ((a.1 - b.1).abs() < 0.5 && (b.1 - p.1).abs() < 0.5);
            if collinear {
                out.pop();
            }
        }
        out.push(p);
    }
    (out.len() <= 6).then_some(out)
}
