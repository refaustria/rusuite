//! ECMA-376 preset shape definitions as data and their evaluation:
//! guides, paths, adjust handles (`a:ahLst`), connection sites
//! (`a:cxnLst`) and the text rectangle (`a:rect`).
//!
//! `defs.txt` holds the presets of `names.txt`, converted from
//! `presetShapeDefinitions.xml` of ECMA-376 Part 1 (the electronic
//! addendum; also shipped in LibreOffice's sources as
//! `oox/source/drawingml/customshapes/presetShapeDefinitions.xml`) by
//! `python3 -I gen.py presetShapeDefinitions.xml names.txt > defs.txt`.
//! To support another preset: add its name to `names.txt`, regenerate,
//! and add a variant to [`crate::Preset`].
//!
//! Line format (one item per line, tokens separated by single spaces;
//! operands are numbers or guide names):
//!
//! | Line | Meaning |
//! |---|---|
//! | `@name` | starts the preset `name` |
//! | `v name value` | adjust value with its default (`a:avLst`) |
//! | `g name op args…` | guide (`a:gdLst/a:gd fmla`) |
//! | `h refX minX maxX refY minY maxY x y` | `a:ahXY` (`-` = absent) |
//! | `p refR minR maxR refAng minAng maxAng x y` | `a:ahPolar` |
//! | `c ang x y` | connection site (`a:cxn`) |
//! | `r l t r b` | text rectangle |
//! | `P w h fill stroke` | a path (`w`/`h` 0 = the shape's box; fill `n` normal, `0` none, `d`/`dl` darken(Less), `l`/`ll` lighten(Less); stroke `1`/`0`) |
//! | `M x y`, `L x y`, `A wR hR stAng swAng`, `Q x1 y1 x y`, `C x1 y1 x2 y2 x y`, `Z` | path commands |

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::geometry::{Adjust, Builder, Site, SubPath};

static DATA: &str = include_str!("defs.txt");

/// One preset definition; every string is a slice of [`DATA`].
#[derive(Debug, Default)]
pub(crate) struct Def {
    pub(crate) av: Vec<(&'static str, i64)>,
    gd: Vec<(&'static str, Vec<&'static str>)>,
    ah: Vec<Ah>,
    cxn: Vec<[&'static str; 3]>,
    rect: Option<[&'static str; 4]>,
    paths: Vec<PathDef>,
}

#[derive(Debug)]
struct Ah {
    polar: bool,
    /// x: refX minX maxX (polar: refR minR maxR); y: refY … (polar: refAng …).
    a: [&'static str; 3],
    b: [&'static str; 3],
    pos: [&'static str; 2],
}

#[derive(Debug)]
struct PathDef {
    w: f64,
    h: f64,
    fill: &'static str,
    stroke: bool,
    cmds: Vec<(char, Vec<&'static str>)>,
}

fn defs() -> &'static HashMap<&'static str, Def> {
    static DEFS: OnceLock<HashMap<&'static str, Def>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let mut out = HashMap::new();
        let mut name = "";
        let mut cur = Def::default();
        for line in DATA.lines() {
            if let Some(n) = line.strip_prefix('@') {
                if !name.is_empty() {
                    out.insert(name, std::mem::take(&mut cur));
                }
                name = n;
                continue;
            }
            let mut it = line.split_whitespace();
            let tag = it.next().unwrap_or("");
            let t: Vec<&'static str> = it.collect();
            match tag {
                "v" => cur.av.push((t[0], t[1].parse().unwrap_or(0))),
                "g" => cur.gd.push((t[0], t[1..].to_vec())),
                "h" | "p" => cur.ah.push(Ah {
                    polar: tag == "p",
                    a: [t[0], t[1], t[2]],
                    b: [t[3], t[4], t[5]],
                    pos: [t[6], t[7]],
                }),
                "c" => cur.cxn.push([t[0], t[1], t[2]]),
                "r" => cur.rect = Some([t[0], t[1], t[2], t[3]]),
                "P" => cur.paths.push(PathDef {
                    w: t[0].parse().unwrap_or(0.0),
                    h: t[1].parse().unwrap_or(0.0),
                    fill: t[2],
                    stroke: t[3] == "1",
                    cmds: Vec::new(),
                }),
                "" => {}
                c => {
                    if let Some(p) = cur.paths.last_mut() {
                        p.cmds.push((c.chars().next().unwrap_or('Z'), t));
                    }
                }
            }
        }
        if !name.is_empty() {
            out.insert(name, cur);
        }
        out
    })
}

/// The definition of preset `prst`, if the data has it.
pub(crate) fn def(prst: &str) -> Option<&'static Def> {
    defs().get(prst)
}

/// A built-in guide of a `w` × `h` box (ECMA-376 §20.1.9.11).
fn builtin(name: &str, w: f64, h: f64) -> Option<f64> {
    let ss = w.min(h);
    Some(match name {
        "w" | "r" => w,
        "h" | "b" => h,
        "l" | "t" => 0.0,
        "hc" => w / 2.0,
        "vc" => h / 2.0,
        "ss" => ss,
        "ls" => w.max(h),
        "cd2" => 10_800_000.0,
        "cd4" => 5_400_000.0,
        "cd8" => 2_700_000.0,
        "3cd4" => 16_200_000.0,
        "3cd8" => 8_100_000.0,
        "5cd8" => 13_500_000.0,
        "7cd8" => 18_900_000.0,
        _ => {
            let (base, n) = [("wd", w), ("hd", h), ("ssd", ss)]
                .into_iter()
                .find_map(|(p, base)| name.strip_prefix(p).map(|n| (base, n)))?;
            let n: f64 = n.parse().ok()?;
            base / n
        }
    })
}

/// Evaluates guide formula `op args` (angles in 60000ths of a degree).
pub(crate) fn formula(op: &str, args: &[f64]) -> f64 {
    let a = |i: usize| args.get(i).copied().unwrap_or(0.0);
    let rad = |v: f64| (v / 60_000.0).to_radians();
    let deg = |r: f64| r.to_degrees() * 60_000.0;
    let div = |n: f64, d: f64| if d == 0.0 { 0.0 } else { n / d };
    match op {
        "val" => a(0),
        "*/" => div(a(0) * a(1), a(2)),
        "+-" => a(0) + a(1) - a(2),
        "+/" => div(a(0) + a(1), a(2)),
        "?:" => {
            if a(0) > 0.0 {
                a(1)
            } else {
                a(2)
            }
        }
        "abs" => a(0).abs(),
        "at2" => deg(a(1).atan2(a(0))),
        "cat2" => a(0) * a(2).atan2(a(1)).cos(),
        "sat2" => a(0) * a(2).atan2(a(1)).sin(),
        "cos" => a(0) * rad(a(1)).cos(),
        "sin" => a(0) * rad(a(1)).sin(),
        "tan" => a(0) * rad(a(1)).tan(),
        "max" => a(0).max(a(1)),
        "min" => a(0).min(a(1)),
        "mod" => (a(0) * a(0) + a(1) * a(1) + a(2) * a(2)).sqrt(),
        "pin" => {
            if a(1) < a(0) {
                a(0)
            } else if a(1) > a(2) {
                a(2)
            } else {
                a(1)
            }
        }
        "sqrt" => a(0).max(0.0).sqrt(),
        _ => 0.0,
    }
}

/// The guide values of a definition for one box and set of adjust values.
pub(crate) struct Eval {
    vars: HashMap<&'static str, f64>,
    w: f64,
    h: f64,
}

impl Eval {
    pub(crate) fn new(d: &Def, w: f64, h: f64, adj: &Adjust) -> Eval {
        let mut e = Eval {
            vars: HashMap::with_capacity(d.av.len() + d.gd.len()),
            w,
            h,
        };
        for (name, v) in &d.av {
            let v = adj.get(*name).copied().unwrap_or(*v);
            e.vars.insert(name, v as f64);
        }
        for (name, f) in &d.gd {
            let args: Vec<f64> = f[1..].iter().map(|t| e.val(t)).collect();
            let v = formula(f[0], &args);
            e.vars.insert(name, v);
        }
        e
    }

    /// An operand: a number, a guide or a built-in (unknown → 0).
    pub(crate) fn val(&self, t: &str) -> f64 {
        if let Some(v) = self.vars.get(t) {
            return *v;
        }
        if let Ok(v) = t.parse::<f64>() {
            return v;
        }
        builtin(t, self.w, self.h).unwrap_or(0.0)
    }
}

/// The paths of definition `d` in a `w` × `h` box.
pub(crate) fn paths(d: &Def, w: f64, h: f64, adj: &Adjust) -> Vec<SubPath> {
    let e = Eval::new(d, w, h, adj);
    d.paths
        .iter()
        .map(|p| {
            let sx = if p.w > 0.0 { w / p.w } else { 1.0 };
            let sy = if p.h > 0.0 { h / p.h } else { 1.0 };
            let mut b = Builder::new(sx, sy);
            for (c, t) in &p.cmds {
                let v = |i: usize| t.get(i).map(|s| e.val(s)).unwrap_or(0.0);
                match c {
                    'M' => b.m(v(0), v(1)),
                    'L' => b.l(v(0), v(1)),
                    'A' => b.a(v(0), v(1), v(2) / 60_000.0, v(3) / 60_000.0),
                    'Q' => b.q(v(0), v(1), v(2), v(3)),
                    'C' => b.c(v(0), v(1), v(2), v(3), v(4), v(5)),
                    _ => b.z(),
                }
            }
            let darken = match p.fill {
                "d" => 0.4,
                "dl" => 0.2,
                "l" => -0.4,
                "ll" => -0.2,
                _ => 0.0,
            };
            SubPath {
                fill: p.fill != "0",
                stroke: p.stroke,
                commands: b.cmds,
                darken,
            }
        })
        .collect()
}

/// The connection sites of `d` (without the centre).
pub(crate) fn sites(d: &Def, w: f64, h: f64, adj: &Adjust) -> Vec<Site> {
    let e = Eval::new(d, w, h, adj);
    d.cxn
        .iter()
        .map(|[ang, x, y]| Site {
            x: e.val(x),
            y: e.val(y),
            angle_deg: (e.val(ang) / 60_000.0).rem_euclid(360.0),
        })
        .collect()
}

/// The text rectangle `(l, t, r, b)` of `d` (none given: the box).
pub(crate) fn text_rect(d: &Def, w: f64, h: f64, adj: &Adjust) -> [f64; 4] {
    match &d.rect {
        None => [0.0, 0.0, w, h],
        Some(r) => {
            let e = Eval::new(d, w, h, adj);
            [e.val(r[0]), e.val(r[1]), e.val(r[2]), e.val(r[3])]
        }
    }
}

/// Samples of a handle axis over its range.
const SAMPLES: usize = 24;

/// One coordinate of an adjust handle driven by an adjust value:
/// `coordinate ≈ base + k · value`, the value kept in `min..=max`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Axis {
    pub(crate) adj: &'static str,
    pub(crate) base: f64,
    pub(crate) k: f64,
    pub(crate) min: f64,
    pub(crate) max: f64,
    /// `(value, coordinate)` along the range, ascending by value.
    pub(crate) samples: Vec<(f64, f64)>,
}

/// An adjust handle at `(x, y)`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RawHandle {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) polar: bool,
    /// x (polar: the distance from the centre).
    pub(crate) a: Option<Axis>,
    /// y (polar: the angle in 60000ths of a degree, clockwise from the
    /// right, around the centre).
    pub(crate) b: Option<Axis>,
}

/// The adjust handles of `d` in a `w` × `h` box with `adj`.
pub(crate) fn handles(d: &Def, w: f64, h: f64, adj: &Adjust) -> Vec<RawHandle> {
    let e = Eval::new(d, w, h, adj);
    let (cx, cy) = (w / 2.0, h / 2.0);
    d.ah.iter()
        .map(|ah| {
            let pos_at = |name: &'static str, v: f64| -> (f64, f64) {
                let mut a2 = adj.clone();
                a2.insert(name.to_owned(), v.round() as i64);
                let e2 = Eval::new(d, w, h, &a2);
                (e2.val(ah.pos[0]), e2.val(ah.pos[1]))
            };
            let axis = |spec: &[&'static str; 3], coord: &dyn Fn((f64, f64)) -> f64| {
                if spec[0] == "-" {
                    return None;
                }
                let min = if spec[1] == "-" {
                    -2.0e9
                } else {
                    e.val(spec[1])
                };
                let max = if spec[2] == "-" {
                    2.0e9
                } else {
                    e.val(spec[2])
                };
                let (min, max) = (min.min(max), max.max(min));
                // the coordinate sampled over the range (huge ranges near
                // 0) and at the current value; base/k = the secant through
                // the samples next to the current value
                let lo = min.max(-200_000.0);
                let hi = max.min(200_000.0).max(lo);
                let cur = e.val(spec[0]).clamp(min, max);
                let mut values: Vec<f64> = (0..=SAMPLES)
                    .map(|i| lo + (hi - lo) * i as f64 / SAMPLES as f64)
                    .collect();
                values.push(cur);
                values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                values.dedup_by(|a, b| (*a - *b).abs() < 0.5);
                let samples: Vec<(f64, f64)> = values
                    .iter()
                    .map(|&v| (v, coord(pos_at(spec[0], v))))
                    .collect();
                let i = samples
                    .iter()
                    .position(|s| (s.0 - cur).abs() < 0.5)
                    .unwrap_or(0);
                let (a, b) = match (i.checked_sub(1), samples.get(i + 1)) {
                    (_, Some(&n)) => (samples[i], n),
                    (Some(p), None) => (samples[p], samples[i]),
                    (None, None) => (samples[i], samples[i]),
                };
                let k = if (b.0 - a.0).abs() > 1e-9 {
                    (b.1 - a.1) / (b.0 - a.0)
                } else {
                    0.0
                };
                Some(Axis {
                    adj: spec[0],
                    base: a.1 - k * a.0,
                    k,
                    min,
                    max,
                    samples,
                })
            };
            let (x, y) = (e.val(ah.pos[0]), e.val(ah.pos[1]));
            if ah.polar {
                let dist = move |(px, py): (f64, f64)| (px - cx).hypot(py - cy);
                let r = axis(&ah.a, &dist);
                let ang = (ah.b[0] != "-").then(|| {
                    let min = if ah.b[1] == "-" { 0.0 } else { e.val(ah.b[1]) };
                    let max = if ah.b[2] == "-" {
                        21_599_999.0
                    } else {
                        e.val(ah.b[2])
                    };
                    Axis {
                        adj: ah.b[0],
                        base: 0.0,
                        k: 1.0,
                        min,
                        max,
                        samples: Vec::new(),
                    }
                });
                RawHandle {
                    x,
                    y,
                    polar: true,
                    a: r,
                    b: ang,
                }
            } else {
                RawHandle {
                    x,
                    y,
                    polar: false,
                    a: axis(&ah.a, &|p| p.0),
                    b: axis(&ah.b, &|p| p.1),
                }
            }
        })
        .collect()
}
