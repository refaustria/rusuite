//! Connectors (`p:cxnSp`): straight, elbow and curved lines whose ends may
//! be attached to connection sites of other shapes, with arrowheads, plus
//! the geometry that reroutes them when attached shapes move.

use core_model::units::Emu;
use serde::{Deserialize, Serialize};

use crate::geometry::{Adjust, ConnectorKind};
use crate::shape::{Shape, ShapeKind, Transform};
use crate::slide::Slide;
use crate::NodeId;

/// An attachment of a connector end to connection site `site` of shape
/// `shape` (`a:stCxn`/`a:endCxn`; the site index is the `idx` of
/// [`crate::Preset::connection_sites`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Attach {
    /// The shape the end is glued to (on the same slide).
    pub shape: NodeId,
    /// Its connection site.
    pub site: u32,
}

/// Arrowhead shape (`a:headEnd/@type`, `a:tailEnd/@type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ArrowKind {
    /// No arrowhead (`none`).
    #[default]
    None,
    /// Filled triangle (`triangle`).
    Triangle,
    /// Stealth arrow (`stealth`).
    Stealth,
    /// Diamond (`diamond`).
    Diamond,
    /// Oval (`oval`).
    Oval,
    /// Open arrow (`arrow`).
    Arrow,
}

/// Arrowhead width or length (`@w`, `@len`: `sm`, `med`, `lg`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ArrowSize {
    /// `sm` (2× the line width).
    Small,
    /// `med` (3×).
    #[default]
    Medium,
    /// `lg` (5×).
    Large,
}

/// One end of a line: arrowhead kind and size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ArrowEnd {
    /// Arrowhead shape.
    pub kind: ArrowKind,
    /// Width.
    pub width: ArrowSize,
    /// Length.
    pub length: ArrowSize,
}

impl ArrowEnd {
    /// A medium arrowhead of `kind`.
    pub fn new(kind: ArrowKind) -> Self {
        Self {
            kind,
            ..Self::default()
        }
    }

    /// Whether there is no arrowhead.
    pub fn is_none(&self) -> bool {
        self.kind == ArrowKind::None
    }
}

/// A connector: the line goes from the start (top-left corner of the
/// unflipped box; `a:headEnd`) to the end (bottom-right; `a:tailEnd`);
/// the shape's flips and rotation place the ends (see
/// [`Transform::line_ends`]). Drawn with the shape's outline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Connector {
    /// Geometry.
    #[serde(default)]
    pub kind: ConnectorKind,
    /// Number of turns of an elbow or curved connector, 1–4
    /// (`bentConnector2` … `bentConnector5`); default 2. Rerouting picks
    /// 1 for sites at right angles and 2 otherwise.
    #[serde(default = "two_bends", skip_serializing_if = "is_two")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u8>"))]
    pub bends: u8,
    /// Shape the start is attached to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub start: Option<Attach>,
    /// Shape the end is attached to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub end: Option<Attach>,
    /// Arrowhead at the start (`a:headEnd`).
    #[serde(default, skip_serializing_if = "ArrowEnd::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ArrowEnd>"))]
    pub head: ArrowEnd,
    /// Arrowhead at the end (`a:tailEnd`).
    #[serde(default, skip_serializing_if = "ArrowEnd::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ArrowEnd>"))]
    pub tail: ArrowEnd,
    /// Adjust values of the geometry (`adj1` of elbow and curved
    /// connectors: where the middle segment runs).
    #[serde(default, skip_serializing_if = "Adjust::is_empty")]
    #[cfg_attr(
        feature = "ts",
        ts(optional, as = "Option<std::collections::HashMap<String, f64>>")
    )]
    pub adjust: Adjust,
}

fn two_bends() -> u8 {
    2
}

fn is_two(v: &u8) -> bool {
    *v == 2
}

impl Default for Connector {
    fn default() -> Self {
        Self::new(ConnectorKind::Straight)
    }
}

impl Connector {
    /// An unattached connector of `kind` without arrowheads (elbows and
    /// curves with two turns).
    pub fn new(kind: ConnectorKind) -> Self {
        Self {
            kind,
            bends: 2,
            start: None,
            end: None,
            head: ArrowEnd::default(),
            tail: ArrowEnd::default(),
            adjust: Adjust::new(),
        }
    }

    /// The DrawingML preset name (`bentConnector3` for an elbow with two
    /// turns).
    pub fn prst(&self) -> String {
        self.kind.prst(self.bends)
    }

    /// The connector's path in a `w` × `h` box (see
    /// [`ConnectorKind::path`]).
    pub fn path(&self, w: f64, h: f64) -> Vec<crate::PathCmd> {
        self.kind.path(self.bends, w, h, &self.adjust)
    }

    /// The attachments (start, end) that are set.
    pub fn attachments(&self) -> impl Iterator<Item = &Attach> {
        self.start.iter().chain(self.end.iter())
    }
}

/// A point in EMU.
pub type Point = (f64, f64);

impl Transform {
    /// Maps a point of the box's own space (`0..w` × `0..h`, unflipped,
    /// unrotated) to the parent's space: flips mirror it inside the box,
    /// then it is rotated about the box center.
    pub fn map_local(&self, x: f64, y: f64) -> Point {
        let (w, h) = (self.w.0 as f64, self.h.0 as f64);
        let fx = if self.flip_h { w - x } else { x };
        let fy = if self.flip_v { h - y } else { y };
        let (dx, dy) = (fx - w / 2.0, fy - h / 2.0);
        let (sin, cos) = self.rotation_deg.to_radians().sin_cos();
        (
            self.x.0 as f64 + w / 2.0 + dx * cos - dy * sin,
            self.y.0 as f64 + h / 2.0 + dx * sin + dy * cos,
        )
    }

    /// Start and end of a line or connector drawn in this box (from the
    /// box's top-left to its bottom-right corner before flips and
    /// rotation).
    pub fn line_ends(&self) -> (Point, Point) {
        (
            self.map_local(0.0, 0.0),
            self.map_local(self.w.0 as f64, self.h.0 as f64),
        )
    }

    /// The box of a connector from `start` to `end`. With `vertical_first`
    /// (elbow and curved connectors leaving a top or bottom site) the box
    /// is rotated by 90° so that the connector's first segment runs
    /// vertically, as PowerPoint stores such connectors.
    pub fn from_line_ends(start: Point, end: Point, vertical_first: bool) -> Transform {
        let (dx, dy) = (end.0 - start.0, end.1 - start.1);
        let r = |v: f64| Emu(v.round() as i64);
        if !vertical_first {
            return Transform {
                x: r(start.0.min(end.0)),
                y: r(start.1.min(end.1)),
                w: r(dx.abs()),
                h: r(dy.abs()),
                rotation_deg: 0.0,
                flip_h: dx < 0.0,
                flip_v: dy < 0.0,
            };
        }
        let (cx, cy) = ((start.0 + end.0) / 2.0, (start.1 + end.1) / 2.0);
        let (w, h) = (dy.abs(), dx.abs());
        Transform {
            x: r(cx - w / 2.0),
            y: r(cy - h / 2.0),
            w: r(w),
            h: r(h),
            rotation_deg: 90.0,
            flip_h: dy < 0.0,
            flip_v: dx > 0.0,
        }
    }
}

impl Transform {
    /// The inverse of [`map_local`](Self::map_local): a point of the
    /// parent's space in the box's own space.
    pub fn to_local(&self, x: f64, y: f64) -> Point {
        let (w, h) = (self.w.0 as f64, self.h.0 as f64);
        let (cx, cy) = (self.x.0 as f64 + w / 2.0, self.y.0 as f64 + h / 2.0);
        let (dx, dy) = (x - cx, y - cy);
        let (sin, cos) = self.rotation_deg.to_radians().sin_cos();
        let (rx, ry) = (dx * cos + dy * sin, -dx * sin + dy * cos);
        let (fx, fy) = (rx + w / 2.0, ry + h / 2.0);
        (
            if self.flip_h { w - fx } else { fx },
            if self.flip_v { h - fy } else { fy },
        )
    }

    /// The axis-aligned bounds `(left, top, right, bottom)` of the box
    /// after rotation.
    pub fn bounds(&self) -> crate::route::Bounds {
        let (w, h) = (self.w.0 as f64, self.h.0 as f64);
        let pts = [
            self.map_local(0.0, 0.0),
            self.map_local(w, 0.0),
            self.map_local(w, h),
            self.map_local(0.0, h),
        ];
        let mut b = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for (x, y) in pts {
            b = (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y));
        }
        b
    }
}

/// Where a ray from `p` in axis direction `dir` (index of 0°, 90°, 180°,
/// 270°) leaves `b` (`p` itself when it is not inside).
fn exit_point(p: Point, dir: usize, b: crate::route::Bounds) -> Point {
    let inside = p.0 > b.0 + 0.5 && p.0 < b.2 - 0.5 && p.1 > b.1 + 0.5 && p.1 < b.3 - 0.5;
    if !inside {
        return p;
    }
    match dir {
        0 => (b.2, p.1),
        1 => (p.0, b.3),
        2 => (b.0, p.1),
        _ => (p.0, b.1),
    }
}

/// The elbow route between two glued ends (corners in slide space, start
/// and end included; see [`crate::route::route`]), as the connector's box,
/// number of turns and adjust values; `None` when the route does not fit
/// the `bentConnector` geometries (or is straight).
fn routed(
    start: Point,
    start_dir: f64,
    start_box: crate::route::Bounds,
    end: Point,
    end_dir: f64,
    end_box: crate::route::Bounds,
    origin: Point,
) -> Option<(Transform, u8, Adjust)> {
    use crate::route::{axis_dir, route};
    let (sd, ed) = (axis_dir(start_dir), axis_dir(end_dir));
    let s1 = exit_point(start, sd, start_box);
    let e1 = exit_point(end, ed, end_box);
    let mid = route(s1, sd, e1, ed, &[start_box, end_box])?;
    let mut pts: Vec<Point> = vec![start];
    pts.extend(mid);
    pts.push(end);
    let near = |a: Point, b: Point| (a.0 - b.0).abs() < 0.5 && (a.1 - b.1).abs() < 0.5;
    let mut corners: Vec<Point> = Vec::new();
    for p in pts {
        if corners.last().is_some_and(|q| near(*q, p)) {
            continue;
        }
        if corners.len() >= 2 {
            let (a, b) = (corners[corners.len() - 2], corners[corners.len() - 1]);
            let same_x = (a.0 - b.0).abs() < 0.5 && (b.0 - p.0).abs() < 0.5;
            let same_y = (a.1 - b.1).abs() < 0.5 && (b.1 - p.1).abs() < 0.5;
            if same_x || same_y {
                corners.pop();
            }
        }
        corners.push(p);
    }
    let turns = corners.len().checked_sub(2)?;
    if !(1..=4).contains(&turns) {
        return None;
    }
    let vertical = (corners[0].0 - corners[1].0).abs() < 0.5;
    let rel = |p: Point| (p.0 - origin.0, p.1 - origin.1);
    let t = Transform::from_line_ends(rel(start), rel(end), vertical);
    let (w, h) = (t.w.0 as f64, t.h.0 as f64);
    let local: Vec<Point> = corners
        .iter()
        .map(|&p| {
            let (x, y) = rel(p);
            t.to_local(x, y)
        })
        .collect();
    let frac = |v: f64, size: f64| -> Option<i64> {
        if size < 1.0 {
            // a detour in a box without width (or height) cannot be stored
            return (v.abs() < 1.0).then_some(50_000);
        }
        Some((v / size * 100_000.0).round() as i64)
    };
    let mut adj = Adjust::new();
    let mut set = |name: &str, v: i64| {
        if v != 50_000 {
            adj.insert(name.to_owned(), v);
        }
    };
    match turns {
        2 => set("adj1", frac(local[1].0, w)?),
        3 => {
            set("adj1", frac(local[1].0, w)?);
            set("adj2", frac(local[2].1, h)?);
        }
        4 => {
            set("adj1", frac(local[1].0, w)?);
            set("adj2", frac(local[2].1, h)?);
            set("adj3", frac(local[3].0, w)?);
        }
        _ => {}
    }
    // the stored geometry must give the route back
    let model = ConnectorKind::Elbow.points(turns as u8, w, h, &adj);
    let fits = model.len() == local.len()
        && model
            .iter()
            .zip(&local)
            .all(|(a, b)| (a.0 - b.0).abs() < 50.0 && (a.1 - b.1).abs() < 50.0);
    fits.then_some((t, turns as u8, adj))
}

impl Shape {
    /// The connection sites of the shape in its own box (rectangle sites
    /// for pictures and tables; none for groups and connectors).
    pub fn connection_sites(&self) -> Vec<crate::geometry::Site> {
        let (w, h) = (self.transform.w.0 as f64, self.transform.h.0 as f64);
        match &self.kind {
            ShapeKind::Auto {
                geometry, adjust, ..
            } => geometry.connection_sites(w, h, adjust),
            ShapeKind::Picture { .. }
            | ShapeKind::Table(_)
            | ShapeKind::Chart(_)
            | ShapeKind::Media(_) => crate::Preset::Rect.connection_sites(w, h, &Adjust::new()),
            ShapeKind::Group { .. } | ShapeKind::Connector(_) => Vec::new(),
        }
    }

    /// The connector data of a connector shape.
    pub fn connector(&self) -> Option<&Connector> {
        match &self.kind {
            ShapeKind::Connector(c) => Some(c),
            _ => None,
        }
    }
}

/// Absolute transforms of the groups enclosing shape `id` (outermost
/// first), if the shape is in `shapes`.
fn ancestors(shapes: &[Shape], id: NodeId, chain: &mut Vec<Transform>) -> bool {
    for s in shapes {
        if s.id == id {
            return true;
        }
        if let ShapeKind::Group { children } = &s.kind {
            let abs = match chain.last() {
                Some(p) => s.absolute_transform(p),
                None => s.transform,
            };
            chain.push(abs);
            if ancestors(children, id, chain) {
                return true;
            }
            chain.pop();
        }
    }
    false
}

impl Slide {
    /// The transform of shape `id` in slide coordinates (group transforms
    /// folded in, see [`Shape::absolute_transform`]).
    pub fn absolute_transform(&self, id: NodeId) -> Option<Transform> {
        let mut chain = Vec::new();
        if !ancestors(&self.shapes, id, &mut chain) {
            return None;
        }
        let shape = self.find_shape(id)?;
        Some(match chain.last() {
            Some(parent) => shape.absolute_transform(parent),
            None => shape.transform,
        })
    }

    /// Slide position and outward direction (degrees) of connection site
    /// `site` of shape `id`; a site index past the shape's sites means its
    /// center.
    pub fn site_position(&self, id: NodeId, site: u32) -> Option<(Point, f64)> {
        let shape = self.find_shape(id)?;
        let sites = shape.connection_sites();
        let s = sites.get(site as usize).or(sites.last())?;
        let t = self.absolute_transform(id)?;
        let p = t.map_local(s.x, s.y);
        // the direction follows flips and rotation
        let (mut ay, mut ax) = s.angle_deg.to_radians().sin_cos();
        if t.flip_h {
            ax = -ax;
        }
        if t.flip_v {
            ay = -ay;
        }
        let rot = t.rotation_deg.to_radians();
        let (sin, cos) = rot.sin_cos();
        let (rx, ry) = (ax * cos - ay * sin, ax * sin + ay * cos);
        Some((p, ry.atan2(rx).to_degrees()))
    }

    /// Clears attachments to shapes that are not on the slide, to groups,
    /// to connectors and to the connector itself. Returns the connectors
    /// that changed.
    pub fn detach_missing(&mut self) -> Vec<NodeId> {
        let valid = |slide: &Slide, me: NodeId, a: &Attach| {
            a.shape != me
                && slide.find_shape(a.shape).is_some_and(|s| {
                    !matches!(s.kind, ShapeKind::Group { .. } | ShapeKind::Connector(_))
                })
        };
        let mut changed = Vec::new();
        for id in self.connector_ids() {
            let Some(c) = self.find_shape(id).and_then(Shape::connector) else {
                continue;
            };
            let start = c.start.filter(|a| valid(self, id, a));
            let end = c.end.filter(|a| valid(self, id, a));
            if start != c.start || end != c.end {
                if let Some(ShapeKind::Connector(c)) = self.find_shape_mut(id).map(|s| &mut s.kind)
                {
                    c.start = start;
                    c.end = end;
                }
                changed.push(id);
            }
        }
        changed
    }

    /// Ids of all connectors on the slide (also inside groups).
    pub fn connector_ids(&self) -> Vec<NodeId> {
        fn walk(shapes: &[Shape], out: &mut Vec<NodeId>) {
            for s in shapes {
                match &s.kind {
                    ShapeKind::Connector(_) => out.push(s.id),
                    ShapeKind::Group { children } => walk(children, out),
                    _ => {}
                }
            }
        }
        let mut out = Vec::new();
        walk(&self.shapes, &mut out);
        out
    }

    /// Moves the attached ends of connector `id` onto their connection
    /// sites (unattached ends stay). Elbow and curved connectors leaving a
    /// top or bottom site start vertically; between sites at right angles
    /// they turn once, otherwise twice (and lose adjust values of another
    /// route). Connectors inside rotated or flipped groups are left alone.
    /// Returns whether the connector changed.
    pub fn reroute_connector(&mut self, id: NodeId) -> bool {
        let Some(shape) = self.find_shape(id) else {
            return false;
        };
        let Some(c) = shape.connector().cloned() else {
            return false;
        };
        if c.start.is_none() && c.end.is_none() {
            return false;
        }
        let mut chain = Vec::new();
        ancestors(&self.shapes, id, &mut chain);
        let (ox, oy) = match chain.last() {
            None => (0.0, 0.0),
            Some(p) if p.rotation_deg == 0.0 && !p.flip_h && !p.flip_v => {
                (p.x.0 as f64, p.y.0 as f64)
            }
            Some(_) => return false,
        };
        let old = shape.transform;
        let (s0, e0) = old.line_ends();
        let at = |a: Option<Attach>| a.and_then(|a| self.site_position(a.shape, a.site));
        let (start, start_dir) = match at(c.start) {
            Some((p, d)) => (p, Some(d)),
            None => ((s0.0 + ox, s0.1 + oy), None),
        };
        let (end, end_dir) = match at(c.end) {
            Some((p, d)) => (p, Some(d)),
            None => ((e0.0 + ox, e0.1 + oy), None),
        };
        // both ends glued: PowerPoint's elbow routes with up to four turns,
        // around the shapes' boxes
        if c.kind != ConnectorKind::Straight {
            let boxes = (
                c.start.and_then(|a| self.absolute_transform(a.shape)),
                c.end.and_then(|a| self.absolute_transform(a.shape)),
            );
            if let ((Some(sb), Some(eb)), Some(sd), Some(ed)) = (boxes, start_dir, end_dir) {
                if let Some((t, bends, adjust)) =
                    routed(start, sd, sb.bounds(), end, ed, eb.bounds(), (ox, oy))
                {
                    if t == old && bends == c.bends && adjust == c.adjust {
                        return false;
                    }
                    if let Some(s) = self.find_shape_mut(id) {
                        s.transform = t;
                        if let ShapeKind::Connector(c) = &mut s.kind {
                            c.bends = bends;
                            c.adjust = adjust;
                        }
                    }
                    return true;
                }
            }
        }
        let is_vertical = |d: f64| d.to_radians().sin().abs() > d.to_radians().cos().abs();
        // perpendicular sites: one turn (L); otherwise two (Z)
        let (vertical, bends) = match (c.kind, start_dir.map(is_vertical), end_dir.map(is_vertical))
        {
            (ConnectorKind::Straight, ..) => (false, c.bends),
            (_, Some(a), Some(b)) if a != b => (a, 1),
            (_, Some(a), _) | (_, None, Some(a)) => (a, 2),
            (_, None, None) => (false, c.bends),
        };
        let t = Transform::from_line_ends(
            (start.0 - ox, start.1 - oy),
            (end.0 - ox, end.1 - oy),
            vertical,
        );
        if t == old && bends == c.bends {
            return false;
        }
        if let Some(s) = self.find_shape_mut(id) {
            s.transform = t;
            if let ShapeKind::Connector(c) = &mut s.kind {
                if c.bends != bends {
                    // the turns of the old route do not fit the new one
                    c.bends = bends;
                    c.adjust.clear();
                }
            }
        }
        true
    }

    /// Reroutes every attached connector of the slide (after dropping
    /// attachments to missing shapes). Returns the connectors that moved
    /// or lost an attachment.
    pub fn reroute_connectors(&mut self) -> Vec<NodeId> {
        let mut changed = self.detach_missing();
        for id in self.connector_ids() {
            if self.reroute_connector(id) && !changed.contains(&id) {
                changed.push(id);
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LayoutKind, Preset};

    fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
        Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
    }

    fn rect(id: u64, t: Transform) -> Shape {
        let mut s = Shape::auto(Preset::Rect, t);
        s.id = NodeId(id);
        s
    }

    fn conn(id: u64, kind: ConnectorKind, start: Option<Attach>, end: Option<Attach>) -> Shape {
        let mut c = Connector::new(kind);
        c.start = start;
        c.end = end;
        let mut s = Shape::connector_shape(c, tr(0, 0, 10, 10));
        s.id = NodeId(id);
        s
    }

    fn at(shape: u64, site: u32) -> Option<Attach> {
        Some(Attach {
            shape: NodeId(shape),
            site,
        })
    }

    #[test]
    fn ends_follow_flips_and_rotation() {
        let mut t = tr(100, 200, 300, 100);
        assert_eq!(t.line_ends(), ((100.0, 200.0), (400.0, 300.0)));
        t.flip_h = true;
        assert_eq!(t.line_ends(), ((400.0, 200.0), (100.0, 300.0)));
        for (s, e, v) in [
            ((0.0, 0.0), (100.0, 200.0), false),
            ((100.0, 0.0), (0.0, 200.0), true),
            ((0.0, 200.0), (100.0, 0.0), true),
            ((100.0, 200.0), (0.0, 0.0), true),
            ((30.0, 40.0), (130.0, 60.0), false),
        ] {
            let t = Transform::from_line_ends(s, e, v);
            let (a, b) = t.line_ends();
            let close = |p: Point, q: Point| (p.0 - q.0).abs() < 1e-6 && (p.1 - q.1).abs() < 1e-6;
            assert!(
                close(a, s) && close(b, e),
                "{s:?}→{e:?} vertical {v}: {t:?}"
            );
        }
    }

    #[test]
    fn reroute_after_move() {
        let mut slide = Slide::new(NodeId(1), LayoutKind::Blank);
        slide.shapes = vec![
            rect(2, tr(0, 0, 100, 100)),
            rect(3, tr(300, 300, 100, 100)),
            // right side of 2 → left side of 3
            conn(4, ConnectorKind::Elbow, at(2, 3), at(3, 1)),
            // bottom of 2 → top of 3: vertical first
            conn(5, ConnectorKind::Elbow, at(2, 2), at(3, 0)),
        ];
        let changed = slide.reroute_connectors();
        assert_eq!(changed, [NodeId(4), NodeId(5)]);
        let t4 = slide.find_shape(NodeId(4)).unwrap().transform;
        assert_eq!(t4, tr(100, 50, 200, 300));
        let t5 = slide.find_shape(NodeId(5)).unwrap().transform;
        assert_eq!(t5.rotation_deg, 90.0);
        let (s, e) = t5.line_ends();
        assert!(
            (s.0 - 50.0).abs() < 1e-6 && (s.1 - 100.0).abs() < 1e-6,
            "{s:?}"
        );
        assert!(
            (e.0 - 350.0).abs() < 1e-6 && (e.1 - 300.0).abs() < 1e-6,
            "{e:?}"
        );
        // nothing moved: no change
        assert!(slide.reroute_connectors().is_empty());
        // sites at right angles: one turn, vertical first
        slide
            .shapes
            .push(conn(6, ConnectorKind::Elbow, at(2, 2), at(3, 1)));
        assert!(slide.reroute_connector(NodeId(6)));
        let s6 = slide.find_shape(NodeId(6)).unwrap();
        assert_eq!(s6.connector().unwrap().bends, 1);
        assert_eq!(s6.connector().unwrap().prst(), "bentConnector2");
        assert_eq!(s6.transform.rotation_deg, 90.0);
        let (s, e) = s6.transform.line_ends();
        assert!(
            (s.0 - 50.0).abs() < 1e-6 && (s.1 - 100.0).abs() < 1e-6,
            "{s:?}"
        );
        assert!(
            (e.0 - 300.0).abs() < 1e-6 && (e.1 - 350.0).abs() < 1e-6,
            "{e:?}"
        );
        slide.shapes.pop();
        // move shape 3 left of 2: the connector follows (flipped)
        slide.find_shape_mut(NodeId(3)).unwrap().transform = tr(-500, 0, 100, 100);
        assert!(slide.reroute_connector(NodeId(4)));
        let (s, e) = slide.find_shape(NodeId(4)).unwrap().transform.line_ends();
        assert_eq!((s, e), ((100.0, 50.0), (-500.0, 50.0)));
        // rotated target: site 3 (right) of a 90° rotated square is at the bottom
        slide
            .find_shape_mut(NodeId(3))
            .unwrap()
            .transform
            .rotation_deg = 90.0;
        let (p, dir) = slide.site_position(NodeId(3), 3).unwrap();
        assert!(
            (p.0 + 450.0).abs() < 1e-6 && (p.1 - 100.0).abs() < 1e-6,
            "{p:?}"
        );
        assert!((dir - 90.0).abs() < 1e-6, "{dir}");
        // deleting a target detaches the end; the end stays where it was
        slide.shapes.remove(1);
        assert_eq!(slide.detach_missing(), [NodeId(4), NodeId(5)]);
        let c = slide.find_shape(NodeId(4)).unwrap().connector().unwrap();
        assert_eq!((c.start, c.end), (at(2, 3), None));
    }

    /// The corners of a connector's route in slide space.
    fn route_of(slide: &Slide, id: u64) -> Vec<(i64, i64)> {
        let s = slide.find_shape(NodeId(id)).unwrap();
        let c = s.connector().unwrap();
        let (w, h) = (s.transform.w.0 as f64, s.transform.h.0 as f64);
        ConnectorKind::Elbow
            .points(c.bends, w, h, &c.adjust)
            .into_iter()
            .map(|(x, y)| {
                let p = s.transform.map_local(x, y);
                (p.0.round() as i64, p.1.round() as i64)
            })
            .collect()
    }

    #[test]
    fn detours_with_three_and_four_turns() {
        const M: i64 = crate::route::DETOUR_MARGIN as i64;
        let mut slide = Slide::new(NodeId(1), LayoutKind::Blank);
        slide.shapes = vec![
            rect(2, tr(1_000_000, 0, 1_000_000, 1_000_000)),
            rect(3, tr(0, 2_000_000, 1_000_000, 1_000_000)),
            // right of 2 → top of 3 (below left): right, down, left, down
            conn(4, ConnectorKind::Elbow, at(2, 3), at(3, 0)),
            // right of 2 → left of 3 (behind it): around both boxes
            conn(5, ConnectorKind::Elbow, at(2, 3), at(3, 1)),
            // right of 2 → right of 3: a U around the right
            conn(6, ConnectorKind::Elbow, at(2, 3), at(3, 3)),
        ];
        slide.reroute_connectors();
        let r4 = route_of(&slide, 4);
        assert_eq!(
            slide
                .find_shape(NodeId(4))
                .unwrap()
                .connector()
                .unwrap()
                .bends,
            3
        );
        assert_eq!(r4.first(), Some(&(2_000_000, 500_000)));
        assert_eq!(r4.last(), Some(&(500_000, 2_000_000)));
        // adjust values are integers: corners are exact to a few EMU
        let close = |a: i64, b: i64| (a - b).abs() <= 20;
        assert!(
            close(r4[1].0, 2_000_000 + M) && r4[1].1 == 500_000,
            "{r4:?}"
        );
        // the horizontal run passes between the boxes
        assert!(close(r4[2].1, 1_500_000), "{r4:?}");
        let r5 = route_of(&slide, 5);
        assert_eq!(
            slide
                .find_shape(NodeId(5))
                .unwrap()
                .connector()
                .unwrap()
                .bends,
            4
        );
        assert_eq!(r5.len(), 6);
        assert!(close(r5[1].0, 2_000_000 + M), "{r5:?}");
        assert!(close(r5[4].0, -M), "enters 3 from the left: {r5:?}");
        assert_eq!(r5.last(), Some(&(0, 2_500_000)));
        let c6 = slide.find_shape(NodeId(6)).unwrap().connector().unwrap();
        assert_eq!(c6.bends, 2);
        // the box runs from 2 to 3 (flipped): the run lies outside it
        assert!(
            !(0..=100_000).contains(&c6.adjust["adj1"]),
            "{:?}",
            c6.adjust
        );
        let r6 = route_of(&slide, 6);
        assert!(
            close(r6[1].0, 2_000_000 + M) && close(r6[2].0, 2_000_000 + M),
            "{r6:?}"
        );
        // nothing moved: stable
        assert!(slide.reroute_connectors().is_empty());
        // every route avoids the boxes' insides
        for id in [4, 5, 6] {
            let r = route_of(&slide, id);
            for w in r.windows(2) {
                for b in [
                    (1_000_000, 0, 2_000_000, 1_000_000),
                    (0, 2_000_000, 1_000_000, 3_000_000),
                ] {
                    let (x0, x1) = (w[0].0.min(w[1].0), w[0].0.max(w[1].0));
                    let (y0, y1) = (w[0].1.min(w[1].1), w[0].1.max(w[1].1));
                    assert!(
                        !(x0 < b.2 - 1 && x1 > b.0 + 1 && y0 < b.3 - 1 && y1 > b.1 + 1),
                        "connector {id} crosses {b:?}: {r:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn connectors_in_groups() {
        let mut slide = Slide::new(NodeId(1), LayoutKind::Blank);
        let mut g = Shape::group(vec![
            rect(2, tr(1000, 1000, 100, 100)),
            conn(3, ConnectorKind::Straight, at(2, 2), None),
        ]);
        g.id = NodeId(9);
        g.transform.x = Emu(500);
        g.transform.y = Emu(500);
        slide.shapes = vec![g, rect(4, tr(0, 0, 10, 10))];
        // the connector's end stays, its start goes to the bottom of 2
        // (1550, 1600 on the slide), in group coordinates
        assert!(slide.reroute_connector(NodeId(3)));
        let t = slide.find_shape(NodeId(3)).unwrap().transform;
        assert_eq!(t.line_ends(), ((1050.0, 1100.0), (10.0, 10.0)));
        // attachments to groups or to itself are invalid
        if let ShapeKind::Connector(c) = &mut slide.find_shape_mut(NodeId(3)).unwrap().kind {
            c.start = at(9, 0);
            c.end = at(3, 0);
        }
        assert_eq!(slide.detach_missing(), [NodeId(3)]);
    }
}
