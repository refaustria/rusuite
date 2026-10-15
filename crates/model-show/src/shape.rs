//! Shapes: auto shapes (incl. text boxes), pictures and groups, with their
//! [`Transform`], [`Fill`] and [`Line`], plus the align/distribute helpers.

use core_model::media::MediaId;
use core_model::units::Emu;
use core_model::{Color, ThemeColorSlot};
use serde::{Deserialize, Serialize};

use crate::layout::PlaceholderKind;
use crate::text::{Alignment, Anchor, Autofit, BodyProps, TextBody, TextParagraph};
use crate::NodeId;

/// Position, size, rotation and flips of a shape (`a:xfrm`).
///
/// For children of a group, `x`/`y` are relative to the group's top-left
/// corner (see [`Shape::absolute_transform`]).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Transform {
    /// Left edge (of the unrotated box).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub x: Emu,
    /// Top edge (of the unrotated box).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub y: Emu,
    /// Width.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub w: Emu,
    /// Height.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub h: Emu,
    /// Clockwise rotation about the box center, in degrees.
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    pub rotation_deg: f64,
    /// Mirrored horizontally.
    #[serde(default, skip_serializing_if = "is_false")]
    pub flip_h: bool,
    /// Mirrored vertically.
    #[serde(default, skip_serializing_if = "is_false")]
    pub flip_v: bool,
}

fn is_zero_f64(v: &f64) -> bool {
    *v == 0.0
}

fn is_false(v: &bool) -> bool {
    !*v
}

impl Transform {
    /// An unrotated, unflipped box.
    pub const fn new(x: Emu, y: Emu, w: Emu, h: Emu) -> Self {
        Self {
            x,
            y,
            w,
            h,
            rotation_deg: 0.0,
            flip_h: false,
            flip_v: false,
        }
    }

    /// Right edge (`x + w`).
    pub const fn right(&self) -> Emu {
        Emu(self.x.0 + self.w.0)
    }

    /// Bottom edge (`y + h`).
    pub const fn bottom(&self) -> Emu {
        Emu(self.y.0 + self.h.0)
    }

    /// The smallest unrotated box containing the boxes of all `shapes`
    /// (rotation and flips are ignored). Zero for an empty slice.
    pub fn bounds_of(shapes: &[Shape]) -> Transform {
        let mut it = shapes.iter().map(|s| s.transform);
        let Some(first) = it.next() else {
            return Transform::default();
        };
        let (mut l, mut t, mut r, mut b) = (first.x, first.y, first.right(), first.bottom());
        for tr in it {
            l = l.min(tr.x);
            t = t.min(tr.y);
            r = r.max(tr.right());
            b = b.max(tr.bottom());
        }
        Transform::new(l, t, Emu(r.0 - l.0), Emu(b.0 - t.0))
    }
}

/// A fill (`a:noFill` / `a:solidFill`).
///
/// Serializes as `{"kind":"none"}` or `{"kind":"solid","value":<Color>}`.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Fill {
    /// Transparent.
    #[default]
    None,
    /// A solid color.
    Solid(#[cfg_attr(feature = "ts", ts(as = "app_common::wire::Color"))] Color),
}

/// Dash style of an outline (`a:prstDash`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum LineDash {
    /// Solid (`solid`).
    #[default]
    Solid,
    /// Dashed (`dash`).
    Dash,
    /// Dotted (`sysDot`).
    Dot,
}

/// The outline of a shape (`a:ln`). No outline is `fill: Fill::None`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Line {
    /// Line color.
    pub fill: Fill,
    /// Line width.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub width: Emu,
    /// Dash style.
    pub dash: LineDash,
}

impl Default for Line {
    /// No outline (1 pt solid once a color is set).
    fn default() -> Self {
        Self {
            fill: Fill::None,
            width: Emu(12_700),
            dash: LineDash::Solid,
        }
    }
}

impl Line {
    /// A solid outline of `color` and `width`.
    pub fn solid(color: Color, width: Emu) -> Self {
        Self {
            fill: Fill::Solid(color),
            width,
            dash: LineDash::Solid,
        }
    }

    /// Whether the outline is invisible.
    pub fn is_none(&self) -> bool {
        self.fill == Fill::None
    }
}

/// Preset geometry of an auto shape (`a:prstGeom/@prst`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Preset {
    /// Rectangle (`rect`); also text boxes and placeholders.
    Rect,
    /// Rounded rectangle (`roundRect`).
    RoundRect,
    /// Ellipse (`ellipse`).
    Ellipse,
    /// Straight line from the top-left to the bottom-right corner of the
    /// box (`line`; flips select the other diagonals).
    Line,
}

/// What a shape is.
///
/// Serializes as `{"kind":"auto","value":{"geometry":…,"text":…}}`,
/// `{"kind":"picture","value":{"media":1}}` or
/// `{"kind":"group","value":{"children":[…]}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ShapeKind {
    /// A preset-geometry shape, optionally holding text (`p:sp`).
    #[serde(rename_all = "camelCase")]
    Auto {
        /// Geometry.
        geometry: Preset,
        /// Text, if the shape has a text body.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<TextBody>,
    },
    /// An image (`p:pic`).
    #[serde(rename_all = "camelCase")]
    Picture {
        /// The image in the presentation's media store.
        #[cfg_attr(feature = "ts", ts(as = "crate::ts::MediaId"))]
        media: MediaId,
    },
    /// A group (`p:grpSp`); children are positioned relative to the group's
    /// top-left corner, at scale 1 (`chOff` = 0, `chExt` = group size).
    #[serde(rename_all = "camelCase")]
    Group {
        /// Children, bottom to top.
        children: Vec<Shape>,
    },
}

/// A shape on a slide (or inside a group).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Shape {
    /// Node id (presentation-unique).
    pub id: NodeId,
    /// Display name (`p:cNvPr/@name`), e.g. `"Rectangle 4"`.
    #[serde(default)]
    pub name: String,
    /// Position and size.
    pub transform: Transform,
    /// Kind and kind-specific content.
    pub kind: ShapeKind,
    /// Fill (ignored for pictures and groups).
    #[serde(default)]
    pub fill: Fill,
    /// Outline (ignored for groups).
    #[serde(default)]
    pub line: Line,
    /// The layout placeholder this shape fills, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<PlaceholderKind>,
}

impl Shape {
    fn new(kind: ShapeKind, transform: Transform) -> Self {
        Self {
            id: NodeId(0),
            name: String::new(),
            transform,
            kind,
            fill: Fill::None,
            line: Line::default(),
            placeholder: None,
        }
    }

    /// A text box: a rectangle without fill and outline whose height grows
    /// with its text (`spAutoFit`), holding `text` (see [`TextBody::plain`]).
    ///
    /// Constructors leave `id` at 0 and `name` empty;
    /// [`crate::Presentation::add_shape`] assigns both.
    pub fn text_box(transform: Transform, text: &str) -> Self {
        let mut body = TextBody::plain(text);
        body.props = BodyProps {
            autofit: Autofit::Resize,
            ..BodyProps::default()
        };
        Self::new(
            ShapeKind::Auto {
                geometry: Preset::Rect,
                text: Some(body),
            },
            transform,
        )
    }

    /// An auto shape with PowerPoint's default style: accent 1 fill with a
    /// darker 1 pt accent 1 outline and an empty, centered text body; lines
    /// get a 0.5 pt accent 1 stroke, no fill and no text.
    pub fn auto(preset: Preset, transform: Transform) -> Self {
        let accent = Color::theme(ThemeColorSlot::Accent1);
        if preset == Preset::Line {
            let mut s = Self::new(
                ShapeKind::Auto {
                    geometry: preset,
                    text: None,
                },
                transform,
            );
            s.line = Line::solid(accent, Emu(6_350));
            return s;
        }
        let mut para = TextParagraph::new();
        para.props.alignment = Some(Alignment::Center);
        let body = TextBody {
            props: BodyProps {
                anchor: Anchor::Middle,
                ..BodyProps::default()
            },
            paragraphs: vec![para],
        };
        let mut s = Self::new(
            ShapeKind::Auto {
                geometry: preset,
                text: Some(body),
            },
            transform,
        );
        s.fill = Fill::Solid(accent);
        s.line = Line::solid(
            Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: -0.5,
            },
            Emu(12_700),
        );
        s
    }

    /// A picture of media item `media`.
    pub fn picture(media: MediaId, transform: Transform) -> Self {
        Self::new(ShapeKind::Picture { media }, transform)
    }

    /// Groups `children` (given in absolute coordinates): the group's box is
    /// their [bounds](Transform::bounds_of) and the children are rebased to
    /// be relative to it. Child order (z-order) is kept.
    pub fn group(mut children: Vec<Shape>) -> Self {
        let bounds = Transform::bounds_of(&children);
        for c in &mut children {
            c.transform.x = Emu(c.transform.x.0 - bounds.x.0);
            c.transform.y = Emu(c.transform.y.0 - bounds.y.0);
        }
        Self::new(ShapeKind::Group { children }, bounds)
    }

    /// The text body of an auto shape.
    pub fn text(&self) -> Option<&TextBody> {
        match &self.kind {
            ShapeKind::Auto { text, .. } => text.as_ref(),
            _ => None,
        }
    }

    /// Mutable access to the text body of an auto shape.
    pub fn text_mut(&mut self) -> Option<&mut TextBody> {
        match &mut self.kind {
            ShapeKind::Auto { text, .. } => text.as_mut(),
            _ => None,
        }
    }

    /// The children of a group (empty for other shapes).
    pub fn children(&self) -> &[Shape] {
        match &self.kind {
            ShapeKind::Group { children } => children,
            _ => &[],
        }
    }

    /// Whether this is a text box (rectangle with text, no fill, no
    /// outline, not a placeholder).
    pub fn is_text_box(&self) -> bool {
        matches!(
            self.kind,
            ShapeKind::Auto {
                geometry: Preset::Rect,
                text: Some(_)
            }
        ) && self.fill == Fill::None
            && self.line.is_none()
            && self.placeholder.is_none()
    }

    /// Gives the shape PowerPoint's default name for its current id (e.g.
    /// `"Rectangle 4"`, see [`default_name`](Self::default_name)) if its
    /// name is empty.
    pub fn fill_default_name(&mut self) {
        if self.name.is_empty() {
            self.name = format!("{} {}", self.default_name(), self.id.0);
        }
    }

    /// The base of PowerPoint's default name for this shape, e.g.
    /// `"Rectangle"` (the full name appends the id: `"Rectangle 4"`).
    pub fn default_name(&self) -> &'static str {
        if let Some(ph) = self.placeholder {
            return match ph {
                PlaceholderKind::Title | PlaceholderKind::CenteredTitle => "Title",
                PlaceholderKind::Subtitle => "Subtitle",
                PlaceholderKind::Body => "Content Placeholder",
            };
        }
        if self.is_text_box() {
            return "TextBox";
        }
        match &self.kind {
            ShapeKind::Auto { geometry, .. } => match geometry {
                Preset::Rect => "Rectangle",
                Preset::RoundRect => "Rounded Rectangle",
                Preset::Ellipse => "Oval",
                Preset::Line => "Straight Connector",
            },
            ShapeKind::Picture { .. } => "Picture",
            ShapeKind::Group { .. } => "Group",
        }
    }

    /// This shape's transform in the coordinate space of the group's
    /// parent, given the group's transform `parent` (for nested groups,
    /// apply level by level from the innermost group outwards).
    ///
    /// The group's flips mirror the child's position (and toggle its
    /// flips), the group's rotation rotates the child's center about the
    /// group's center and adds to the child's rotation.
    pub fn absolute_transform(&self, parent: &Transform) -> Transform {
        let c = &self.transform;
        let mut out = *c;
        out.x = if parent.flip_h {
            Emu(parent.x.0 + parent.w.0 - c.x.0 - c.w.0)
        } else {
            Emu(parent.x.0 + c.x.0)
        };
        out.y = if parent.flip_v {
            Emu(parent.y.0 + parent.h.0 - c.y.0 - c.h.0)
        } else {
            Emu(parent.y.0 + c.y.0)
        };
        out.flip_h = c.flip_h ^ parent.flip_h;
        out.flip_v = c.flip_v ^ parent.flip_v;
        let mut rot = c.rotation_deg;
        if parent.flip_h ^ parent.flip_v {
            rot = -rot;
        }
        if parent.rotation_deg != 0.0 {
            // Rotate the child's center about the group's center.
            let pcx = parent.x.0 as f64 + parent.w.0 as f64 / 2.0;
            let pcy = parent.y.0 as f64 + parent.h.0 as f64 / 2.0;
            let dx = out.x.0 as f64 + c.w.0 as f64 / 2.0 - pcx;
            let dy = out.y.0 as f64 + c.h.0 as f64 / 2.0 - pcy;
            let (sin, cos) = parent.rotation_deg.to_radians().sin_cos();
            let cx = pcx + dx * cos - dy * sin;
            let cy = pcy + dx * sin + dy * cos;
            out.x = Emu((cx - c.w.0 as f64 / 2.0).round() as i64);
            out.y = Emu((cy - c.h.0 as f64 / 2.0).round() as i64);
            rot += parent.rotation_deg;
        }
        out.rotation_deg = normalize_deg(rot);
        out
    }
}

/// Maps an angle to `0.0..360.0`.
fn normalize_deg(deg: f64) -> f64 {
    let r = deg.rem_euclid(360.0);
    if r == 0.0 {
        0.0 // also turns -0.0 into 0.0
    } else {
        r
    }
}

/// How [`align_shapes`] aligns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum AlignMode {
    /// Left edges at the left edge of the target box.
    Left,
    /// Horizontal centers at the target's center.
    CenterH,
    /// Right edges at the target's right edge.
    Right,
    /// Top edges at the target's top edge.
    Top,
    /// Vertical centers at the target's center.
    CenterV,
    /// Bottom edges at the target's bottom edge.
    Bottom,
}

/// Direction of [`distribute`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Axis {
    /// Along x.
    Horizontal,
    /// Along y.
    Vertical,
}

/// Aligns the (unrotated) boxes of `shapes` to `within` – typically the
/// selection's [bounds](Transform::bounds_of), or the slide for a single
/// shape. Only `x` or `y` changes; centers round down to whole EMU.
pub fn align_shapes(shapes: &mut [&mut Shape], mode: AlignMode, within: Transform) {
    for s in shapes.iter_mut() {
        let t = &mut s.transform;
        match mode {
            AlignMode::Left => t.x = within.x,
            AlignMode::CenterH => t.x = Emu(within.x.0 + (within.w.0 - t.w.0).div_euclid(2)),
            AlignMode::Right => t.x = Emu(within.right().0 - t.w.0),
            AlignMode::Top => t.y = within.y,
            AlignMode::CenterV => t.y = Emu(within.y.0 + (within.h.0 - t.h.0).div_euclid(2)),
            AlignMode::Bottom => t.y = Emu(within.bottom().0 - t.h.0),
        }
    }
}

/// Spaces `shapes` evenly along `axis` (as PowerPoint's "Distribute"):
/// ordered by their left (top) edge, the first shape stays, the last one
/// ends at the selection's right (bottom) edge, and the gaps between
/// neighbours are equal (rounded to whole EMU). Fewer than three shapes
/// are left unchanged.
pub fn distribute(shapes: &mut [&mut Shape], axis: Axis) {
    let n = shapes.len();
    if n < 3 {
        return;
    }
    let key = |t: &Transform| match axis {
        Axis::Horizontal => (t.x.0, t.w.0),
        Axis::Vertical => (t.y.0, t.h.0),
    };
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| key(&shapes[i].transform).0);
    let start = key(&shapes[order[0]].transform).0;
    let end = shapes
        .iter()
        .map(|s| {
            let (p, len) = key(&s.transform);
            p + len
        })
        .max()
        .unwrap_or(start);
    let total: i64 = shapes.iter().map(|s| key(&s.transform).1).sum();
    let free = end - start - total;
    let gaps = (n - 1) as i64;
    let mut used = 0;
    for (k, &i) in order.iter().enumerate() {
        let k = k as i64;
        let pos = start + used + (2 * k * free + gaps).div_euclid(2 * gaps);
        let t = &mut shapes[i].transform;
        match axis {
            Axis::Horizontal => t.x = Emu(pos),
            Axis::Vertical => t.y = Emu(pos),
        }
        used += key(t).1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i64, y: i64, w: i64, h: i64) -> Shape {
        Shape::auto(Preset::Rect, Transform::new(Emu(x), Emu(y), Emu(w), Emu(h)))
    }

    fn xs(shapes: &[Shape]) -> Vec<(i64, i64)> {
        shapes
            .iter()
            .map(|s| (s.transform.x.0, s.transform.y.0))
            .collect()
    }

    #[test]
    fn bounds_union() {
        let shapes = [rect(100, 200, 50, 50), rect(0, 300, 10, 10)];
        assert_eq!(
            Transform::bounds_of(&shapes),
            Transform::new(Emu(0), Emu(200), Emu(150), Emu(110))
        );
        assert_eq!(Transform::bounds_of(&[]), Transform::default());
    }

    #[test]
    fn align_reference_values() {
        let mut shapes = vec![rect(100, 100, 200, 100), rect(500, 400, 100, 51)];
        let within = Transform::bounds_of(&shapes); // 100,100 500×351
        let cases = [
            (AlignMode::Left, [(100, 100), (100, 400)]),
            (AlignMode::Right, [(400, 100), (500, 400)]),
            (AlignMode::CenterH, [(250, 100), (300, 400)]),
            (AlignMode::Top, [(100, 100), (500, 100)]),
            (AlignMode::Bottom, [(100, 351), (500, 400)]),
            (AlignMode::CenterV, [(100, 225), (500, 250)]),
        ];
        for (mode, want) in cases {
            let mut work = shapes.clone();
            let mut refs: Vec<&mut Shape> = work.iter_mut().collect();
            align_shapes(&mut refs, mode, within);
            assert_eq!(xs(&work), want, "{mode:?}");
        }
        // a single shape centered on a 16:9 slide
        let slide = Transform::new(Emu(0), Emu(0), Emu(12_192_000), Emu(6_858_000));
        let mut one: Vec<&mut Shape> = shapes.iter_mut().take(1).collect();
        align_shapes(&mut one, AlignMode::CenterH, slide);
        align_shapes(&mut one, AlignMode::CenterV, slide);
        assert_eq!(xs(&shapes[..1]), [(6_095_900, 3_428_950)]);
    }

    #[test]
    fn distribute_reference_values() {
        // unsorted input; widths 100, 50, 200; span 0..1000 → gap 325
        let mut shapes = vec![
            rect(800, 0, 200, 10),
            rect(0, 0, 100, 10),
            rect(300, 0, 50, 10),
        ];
        let mut refs: Vec<&mut Shape> = shapes.iter_mut().collect();
        distribute(&mut refs, Axis::Horizontal);
        assert_eq!(xs(&shapes), [(800, 0), (0, 0), (425, 0)]);

        // vertical, with rounding: span 0..100, heights 10×4 → free 60 / 3
        let mut shapes = vec![
            rect(0, 0, 10, 10),
            rect(0, 5, 10, 10),
            rect(0, 7, 10, 10),
            rect(0, 90, 10, 10),
        ];
        let mut refs: Vec<&mut Shape> = shapes.iter_mut().collect();
        distribute(&mut refs, Axis::Vertical);
        assert_eq!(xs(&shapes), [(0, 0), (0, 30), (0, 60), (0, 90)]);

        // free space not divisible: 0..101, heights 10×3 → 71/2 = 35.5 → rounds
        let mut shapes = vec![rect(0, 0, 10, 10), rect(0, 3, 10, 10), rect(0, 91, 10, 10)];
        let mut refs: Vec<&mut Shape> = shapes.iter_mut().collect();
        distribute(&mut refs, Axis::Vertical);
        assert_eq!(xs(&shapes), [(0, 0), (0, 46), (0, 91)]);

        // two shapes: unchanged
        let mut shapes = vec![rect(0, 0, 10, 10), rect(500, 0, 10, 10)];
        let mut refs: Vec<&mut Shape> = shapes.iter_mut().collect();
        distribute(&mut refs, Axis::Horizontal);
        assert_eq!(xs(&shapes), [(0, 0), (500, 0)]);
    }

    #[test]
    fn group_rebases_children() {
        let g = Shape::group(vec![rect(1000, 2000, 500, 500), rect(3000, 1000, 100, 100)]);
        assert_eq!(
            g.transform,
            Transform::new(Emu(1000), Emu(1000), Emu(2100), Emu(1500))
        );
        assert_eq!(xs(g.children()), [(0, 1000), (2000, 0)]);
        // absolute transforms restore the original positions
        let abs: Vec<_> = g
            .children()
            .iter()
            .map(|c| c.absolute_transform(&g.transform))
            .collect();
        assert_eq!(abs[0], rect(1000, 2000, 500, 500).transform);
        assert_eq!(abs[1], rect(3000, 1000, 100, 100).transform);
    }

    #[test]
    fn absolute_transform_flip_and_rotation() {
        let child = rect(0, 0, 100, 50); // top-left corner of the group
        let mut parent = Transform::new(Emu(1000), Emu(1000), Emu(400), Emu(200));

        parent.flip_h = true;
        let a = child.absolute_transform(&parent);
        assert_eq!(
            (a.x.0, a.y.0, a.flip_h, a.flip_v),
            (1300, 1000, true, false)
        );

        parent.flip_h = false;
        parent.flip_v = true;
        let a = child.absolute_transform(&parent);
        assert_eq!(
            (a.x.0, a.y.0, a.flip_h, a.flip_v),
            (1000, 1150, false, true)
        );

        // 180°: top-left child ends at the bottom-right corner, rotated
        parent.flip_v = false;
        parent.rotation_deg = 180.0;
        let a = child.absolute_transform(&parent);
        assert_eq!((a.x.0, a.y.0, a.w.0, a.h.0), (1300, 1150, 100, 50));
        assert_eq!(a.rotation_deg, 180.0);

        // 90° clockwise about the group center (1200,1100): child center
        // (1050,1025) → (1275,950)
        parent.rotation_deg = 90.0;
        let mut c = child.clone();
        c.transform.rotation_deg = 300.0;
        let a = c.absolute_transform(&parent);
        assert_eq!((a.x.0, a.y.0), (1225, 925));
        assert_eq!(a.rotation_deg, 30.0);

        // nested groups: apply level by level
        let inner = Shape::group(vec![rect(10, 10, 10, 10)]);
        let outer = Shape::group(vec![inner]);
        let mut outer = outer;
        outer.transform.x = Emu(500);
        let inner = &outer.children()[0];
        let leaf = &inner.children()[0];
        let inner_abs = inner.absolute_transform(&outer.transform);
        assert_eq!(leaf.absolute_transform(&inner_abs).x, Emu(500));
    }

    #[test]
    fn constructors_and_names() {
        let t = Transform::new(Emu(0), Emu(0), Emu(10), Emu(10));
        let tb = Shape::text_box(t, "Hi");
        assert!(tb.is_text_box());
        assert_eq!(tb.default_name(), "TextBox");
        assert_eq!(tb.text().unwrap().plain_text(), "Hi");
        assert_eq!(tb.text().unwrap().props.autofit, Autofit::Resize);
        let r = Shape::auto(Preset::Rect, t);
        assert!(!r.is_text_box());
        assert_eq!(r.default_name(), "Rectangle");
        assert_eq!(r.fill, Fill::Solid(Color::theme(ThemeColorSlot::Accent1)));
        let l = Shape::auto(Preset::Line, t);
        assert!(l.text().is_none());
        assert_eq!(l.fill, Fill::None);
        assert_eq!(l.line.width, Emu(6_350));
        assert_eq!(Shape::auto(Preset::Ellipse, t).default_name(), "Oval");
        assert_eq!(Shape::picture(MediaId(1), t).default_name(), "Picture");
        assert_eq!(Shape::group(vec![]).default_name(), "Group");
    }

    #[test]
    fn serde_shape() {
        let s = Shape::picture(
            MediaId(3),
            Transform {
                rotation_deg: 45.0,
                ..Transform::new(Emu(1), Emu(2), Emu(3), Emu(4))
            },
        );
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(
            json,
            r#"{"id":0,"name":"","transform":{"x":1,"y":2,"w":3,"h":4,"rotationDeg":45.0},"kind":{"kind":"picture","value":{"media":3}},"fill":{"kind":"none"},"line":{"fill":{"kind":"none"},"width":12700,"dash":"solid"}}"#
        );
        assert_eq!(serde_json::from_str::<Shape>(&json).unwrap(), s);
    }
}
