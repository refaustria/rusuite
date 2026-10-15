//! Shape geometry: the [`Preset`] library (DrawingML `a:prstGeom`), custom
//! geometry (`a:custGeom`), outlines as [`PathCmd`] lists computed from
//! ECMA-376's preset shape definitions, connection sites for connectors,
//! and the three connector geometries.
//!
//! Paths are in EMU (as `f64`) in the shape's own box: `(0, 0)` is the
//! top-left corner of the unrotated, unflipped box and `(w, h)` its
//! bottom-right corner; flips and rotation are applied by the renderer.
//!
//! Arcs follow DrawingML's `a:arcTo`: the arc starts at the current point,
//! which lies on an axis-aligned ellipse with radii `wr`/`hr` at the
//! *visual* angle `start_deg` (0° = right, clockwise, y down), and sweeps
//! `sweep_deg` (positive = clockwise). [`flatten`] turns arcs into cubic
//! Béziers for renderers that only know lines and curves.

use std::collections::BTreeMap;
use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

/// Adjust values of a preset (`a:avLst/a:gd name="adj" fmla="val 16667"`),
/// by guide name. Values are in the preset's units (mostly 1/100000 of
/// the shorter side or of the width/height). Missing names take the
/// preset's default ([`Preset::adjust_defaults`]).
pub type Adjust = BTreeMap<String, i64>;

/// One drawing command of a path, coordinates in EMU.
///
/// Serializes as `{"kind":"moveTo","x":0,"y":0}` etc.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    tag = "kind",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum PathCmd {
    /// Starts a new sub-path at `(x, y)`.
    MoveTo { x: f64, y: f64 },
    /// Straight line to `(x, y)`.
    LineTo { x: f64, y: f64 },
    /// Elliptical arc from the current point (see the module docs).
    ArcTo {
        wr: f64,
        hr: f64,
        start_deg: f64,
        sweep_deg: f64,
    },
    /// Quadratic Bézier with control point `(x1, y1)` to `(x, y)`.
    QuadTo { x1: f64, y1: f64, x: f64, y: f64 },
    /// Cubic Bézier with control points `(x1, y1)`, `(x2, y2)` to `(x, y)`.
    CubicTo {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x: f64,
        y: f64,
    },
    /// Closes the current sub-path.
    Close,
}

/// A path of a shape's outline with its paint flags (`a:path/@fill`,
/// `@stroke`). Most presets have one filled and stroked path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct SubPath {
    /// Filled with the shape's fill.
    pub fill: bool,
    /// Stroked with the shape's outline.
    pub stroke: bool,
    /// Commands in EMU in the shape's box.
    pub commands: Vec<PathCmd>,
}

/// A path of a custom geometry (`a:custGeom/a:pathLst/a:path`): commands in
/// the path's own coordinate space `0..w` × `0..h`, scaled to the shape's
/// box when drawn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct GeomPath {
    /// Width of the path's coordinate space (`a:path/@w`).
    pub w: f64,
    /// Height of the path's coordinate space.
    pub h: f64,
    /// Filled (`@fill` not `none`).
    #[serde(default = "yes")]
    pub fill: bool,
    /// Stroked (`@stroke` not `0`).
    #[serde(default = "yes")]
    pub stroke: bool,
    /// Commands in path coordinates.
    pub commands: Vec<PathCmd>,
}

fn yes() -> bool {
    true
}

/// A connection site of a shape: where a connector may attach, in EMU in
/// the shape's box, and the direction a connector leaves it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Site {
    /// x in the shape's box.
    pub x: f64,
    /// y in the shape's box.
    pub y: f64,
    /// Outward direction (0 = right, 90 = down, 180 = left, 270 = up).
    pub angle_deg: f64,
}

/// Preset geometry of an auto shape (`a:prstGeom/@prst`), or a custom
/// geometry (`a:custGeom`).
///
/// Unit variants serialize as their DrawingML name (`"rect"`,
/// `"wedgeRectCallout"`); a custom geometry as
/// `{"custom":{"paths":[…]}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum Preset {
    /// Rectangle (`rect`); also text boxes and placeholders.
    Rect,
    /// Rounded rectangle (`roundRect`; `adj` = corner radius, 1/100000 of
    /// the shorter side, default 16667, 0–50000).
    RoundRect,
    /// Rectangle with one snipped corner (`snip1Rect`; `adj`).
    Snip1Rect,
    /// Rectangle with the two top corners snipped (`snip2SameRect`;
    /// `adj1` top, `adj2` bottom).
    Snip2SameRect,
    /// Rectangle with one rounded corner (`round1Rect`; `adj`).
    Round1Rect,
    /// Rectangle with the two top corners rounded (`round2SameRect`;
    /// `adj1` top, `adj2` bottom).
    Round2SameRect,
    /// Ellipse (`ellipse`).
    Ellipse,
    /// Isosceles triangle (`triangle`; `adj` = apex position, 1/100000 of
    /// the width, default 50000).
    Triangle,
    /// Right triangle (`rtTriangle`).
    RtTriangle,
    /// Diamond (`diamond`).
    Diamond,
    /// Regular pentagon (`pentagon`; `hf`, `vf` scale factors).
    Pentagon,
    /// Hexagon (`hexagon`; `adj` = side inset, `vf`).
    Hexagon,
    /// Octagon (`octagon`; `adj` = corner cut).
    Octagon,
    /// Parallelogram (`parallelogram`; `adj` = slant).
    Parallelogram,
    /// Trapezoid, wide at the bottom (`trapezoid`; `adj` = inset).
    Trapezoid,
    /// Heart (`heart`).
    Heart,
    /// Cloud (`cloud`).
    Cloud,
    /// Right block arrow (`rightArrow`; `adj1` = shaft thickness, 1/100000
    /// of the height; `adj2` = head length, 1/100000 of the shorter side).
    RightArrow,
    /// Left block arrow (`leftArrow`; as `rightArrow`).
    LeftArrow,
    /// Up block arrow (`upArrow`; `adj1` shaft width, `adj2` head length).
    UpArrow,
    /// Down block arrow (`downArrow`).
    DownArrow,
    /// Left-right block arrow (`leftRightArrow`).
    LeftRightArrow,
    /// Up-down block arrow (`upDownArrow`).
    UpDownArrow,
    /// Chevron (`chevron`; `adj` = point depth).
    Chevron,
    /// Pentagon arrow (`homePlate`; `adj` = point depth).
    HomePlate,
    /// 4-point star (`star4`; `adj` = inner radius, 1/100000 × 2).
    Star4,
    /// 5-point star (`star5`; `adj`, `hf`, `vf`).
    Star5,
    /// 6-point star (`star6`; `adj`, `hf`).
    Star6,
    /// 8-point star (`star8`; `adj`).
    Star8,
    /// Rectangular callout (`wedgeRectCallout`; `adj1`/`adj2` = tail tip
    /// relative to the center, 1/100000 of the width/height).
    WedgeRectCallout,
    /// Rounded rectangular callout (`wedgeRoundRectCallout`; `adj1`,
    /// `adj2` tail tip, `adj3` corner radius).
    WedgeRoundRectCallout,
    /// Oval callout (`wedgeEllipseCallout`; `adj1`/`adj2` tail tip).
    WedgeEllipseCallout,
    /// Flowchart process (`flowChartProcess`).
    FlowChartProcess,
    /// Flowchart decision (`flowChartDecision`).
    FlowChartDecision,
    /// Flowchart terminator (`flowChartTerminator`).
    FlowChartTerminator,
    /// Flowchart document (`flowChartDocument`).
    FlowChartDocument,
    /// Flowchart connector, a circle (`flowChartConnector`).
    FlowChartConnector,
    /// Flowchart data (`flowChartInputOutput`).
    FlowChartInputOutput,
    /// Straight line from the top-left to the bottom-right corner of the
    /// box (`line`; flips select the other diagonals).
    Line,
    /// A custom geometry (`a:custGeom`): its paths, each scaled to the box.
    #[serde(rename_all = "camelCase")]
    Custom {
        /// The paths, bottom to top.
        paths: Vec<GeomPath>,
    },
}

impl Preset {
    /// Every named preset (all but [`Custom`](Self::Custom)), in gallery
    /// order.
    pub const ALL: [Preset; 39] = [
        Preset::Rect,
        Preset::RoundRect,
        Preset::Snip1Rect,
        Preset::Snip2SameRect,
        Preset::Round1Rect,
        Preset::Round2SameRect,
        Preset::Ellipse,
        Preset::Triangle,
        Preset::RtTriangle,
        Preset::Diamond,
        Preset::Pentagon,
        Preset::Hexagon,
        Preset::Octagon,
        Preset::Parallelogram,
        Preset::Trapezoid,
        Preset::Heart,
        Preset::Cloud,
        Preset::RightArrow,
        Preset::LeftArrow,
        Preset::UpArrow,
        Preset::DownArrow,
        Preset::LeftRightArrow,
        Preset::UpDownArrow,
        Preset::Chevron,
        Preset::HomePlate,
        Preset::Star4,
        Preset::Star5,
        Preset::Star6,
        Preset::Star8,
        Preset::WedgeRectCallout,
        Preset::WedgeRoundRectCallout,
        Preset::WedgeEllipseCallout,
        Preset::FlowChartProcess,
        Preset::FlowChartDecision,
        Preset::FlowChartTerminator,
        Preset::FlowChartDocument,
        Preset::FlowChartConnector,
        Preset::FlowChartInputOutput,
        Preset::Line,
    ];

    /// The DrawingML `prst` name (`"custom"` for a custom geometry, which
    /// is written as `a:custGeom`).
    pub fn prst(&self) -> &'static str {
        match self {
            Preset::Rect => "rect",
            Preset::RoundRect => "roundRect",
            Preset::Snip1Rect => "snip1Rect",
            Preset::Snip2SameRect => "snip2SameRect",
            Preset::Round1Rect => "round1Rect",
            Preset::Round2SameRect => "round2SameRect",
            Preset::Ellipse => "ellipse",
            Preset::Triangle => "triangle",
            Preset::RtTriangle => "rtTriangle",
            Preset::Diamond => "diamond",
            Preset::Pentagon => "pentagon",
            Preset::Hexagon => "hexagon",
            Preset::Octagon => "octagon",
            Preset::Parallelogram => "parallelogram",
            Preset::Trapezoid => "trapezoid",
            Preset::Heart => "heart",
            Preset::Cloud => "cloud",
            Preset::RightArrow => "rightArrow",
            Preset::LeftArrow => "leftArrow",
            Preset::UpArrow => "upArrow",
            Preset::DownArrow => "downArrow",
            Preset::LeftRightArrow => "leftRightArrow",
            Preset::UpDownArrow => "upDownArrow",
            Preset::Chevron => "chevron",
            Preset::HomePlate => "homePlate",
            Preset::Star4 => "star4",
            Preset::Star5 => "star5",
            Preset::Star6 => "star6",
            Preset::Star8 => "star8",
            Preset::WedgeRectCallout => "wedgeRectCallout",
            Preset::WedgeRoundRectCallout => "wedgeRoundRectCallout",
            Preset::WedgeEllipseCallout => "wedgeEllipseCallout",
            Preset::FlowChartProcess => "flowChartProcess",
            Preset::FlowChartDecision => "flowChartDecision",
            Preset::FlowChartTerminator => "flowChartTerminator",
            Preset::FlowChartDocument => "flowChartDocument",
            Preset::FlowChartConnector => "flowChartConnector",
            Preset::FlowChartInputOutput => "flowChartInputOutput",
            Preset::Line => "line",
            Preset::Custom { .. } => "custom",
        }
    }

    /// The preset with DrawingML name `prst` (`straightConnector1` is a
    /// line), if we support it.
    pub fn from_prst(prst: &str) -> Option<Preset> {
        if prst == "straightConnector1" {
            return Some(Preset::Line);
        }
        Preset::ALL.into_iter().find(|p| p.prst() == prst)
    }

    /// The adjust values this preset understands, with their defaults
    /// (ECMA-376 `presetShapeDefinitions.xml`).
    pub fn adjust_defaults(&self) -> &'static [(&'static str, i64)] {
        match self {
            Preset::RoundRect | Preset::Snip1Rect | Preset::Round1Rect => &[("adj", 16_667)],
            Preset::Snip2SameRect | Preset::Round2SameRect => &[("adj1", 16_667), ("adj2", 0)],
            Preset::Triangle | Preset::Chevron | Preset::HomePlate => &[("adj", 50_000)],
            Preset::Parallelogram | Preset::Trapezoid => &[("adj", 25_000)],
            Preset::Pentagon => &[("hf", 105_146), ("vf", 110_557)],
            Preset::Hexagon => &[("adj", 25_000), ("vf", 115_470)],
            Preset::Octagon => &[("adj", 29_289)],
            Preset::RightArrow
            | Preset::LeftArrow
            | Preset::UpArrow
            | Preset::DownArrow
            | Preset::LeftRightArrow
            | Preset::UpDownArrow => &[("adj1", 50_000), ("adj2", 50_000)],
            Preset::Star4 => &[("adj", 12_500)],
            Preset::Star5 => &[("adj", 19_098), ("hf", 105_146), ("vf", 110_557)],
            Preset::Star6 => &[("adj", 28_868), ("hf", 115_470)],
            Preset::Star8 => &[("adj", 38_250)],
            Preset::WedgeRectCallout | Preset::WedgeEllipseCallout => {
                &[("adj1", -20_833), ("adj2", 62_500)]
            }
            Preset::WedgeRoundRectCallout => {
                &[("adj1", -20_833), ("adj2", 62_500), ("adj3", 16_667)]
            }
            _ => &[],
        }
    }

    /// PowerPoint's default shape name for this geometry (`"Rounded
    /// Rectangle"`; the full name appends the shape number).
    pub fn default_name(&self) -> &'static str {
        match self {
            Preset::Rect => "Rectangle",
            Preset::RoundRect => "Rounded Rectangle",
            Preset::Snip1Rect => "Snip Single Corner Rectangle",
            Preset::Snip2SameRect => "Snip Same Side Corner Rectangle",
            Preset::Round1Rect => "Round Single Corner Rectangle",
            Preset::Round2SameRect => "Round Same Side Corner Rectangle",
            Preset::Ellipse => "Oval",
            Preset::Triangle => "Isosceles Triangle",
            Preset::RtTriangle => "Right Triangle",
            Preset::Diamond => "Diamond",
            Preset::Pentagon => "Regular Pentagon",
            Preset::Hexagon => "Hexagon",
            Preset::Octagon => "Octagon",
            Preset::Parallelogram => "Parallelogram",
            Preset::Trapezoid => "Trapezoid",
            Preset::Heart => "Heart",
            Preset::Cloud => "Cloud",
            Preset::RightArrow => "Right Arrow",
            Preset::LeftArrow => "Left Arrow",
            Preset::UpArrow => "Up Arrow",
            Preset::DownArrow => "Down Arrow",
            Preset::LeftRightArrow => "Left-Right Arrow",
            Preset::UpDownArrow => "Up-Down Arrow",
            Preset::Chevron => "Chevron",
            Preset::HomePlate => "Pentagon",
            Preset::Star4 => "4-Point Star",
            Preset::Star5 => "5-Point Star",
            Preset::Star6 => "6-Point Star",
            Preset::Star8 => "8-Point Star",
            Preset::WedgeRectCallout => "Rectangular Callout",
            Preset::WedgeRoundRectCallout => "Rounded Rectangular Callout",
            Preset::WedgeEllipseCallout => "Oval Callout",
            Preset::FlowChartProcess => "Flowchart: Process",
            Preset::FlowChartDecision => "Flowchart: Decision",
            Preset::FlowChartTerminator => "Flowchart: Terminator",
            Preset::FlowChartDocument => "Flowchart: Document",
            Preset::FlowChartConnector => "Flowchart: Connector",
            Preset::FlowChartInputOutput => "Flowchart: Data",
            Preset::Line => "Straight Connector",
            Preset::Custom { .. } => "Freeform",
        }
    }

    /// The outline of the shape in a `w` × `h` box: the commands of all
    /// [`paths`](Self::paths) in order.
    pub fn path(&self, w: f64, h: f64, adj: &Adjust) -> Vec<PathCmd> {
        self.paths(w, h, adj)
            .into_iter()
            .flat_map(|p| p.commands)
            .collect()
    }

    /// The paths of the shape in a `w` × `h` box (EMU), computed from the
    /// ECMA-376 preset definition with the adjust values `adj` (missing
    /// ones take the defaults; values are clamped as the definitions pin
    /// them).
    pub fn paths(&self, w: f64, h: f64, adj: &Adjust) -> Vec<SubPath> {
        let g = Guides::new(w, h, adj, self.adjust_defaults());
        let mut b = Builder::new(1.0, 1.0);
        match self {
            Preset::Custom { paths } => {
                return paths
                    .iter()
                    .map(|p| {
                        let sx = if p.w > 0.0 { w / p.w } else { 1.0 };
                        let sy = if p.h > 0.0 { h / p.h } else { 1.0 };
                        let mut b = Builder::new(sx, sy);
                        for c in &p.commands {
                            b.cmd(c);
                        }
                        SubPath {
                            fill: p.fill,
                            stroke: p.stroke,
                            commands: b.cmds,
                        }
                    })
                    .collect();
            }
            Preset::Line => {
                b.m(0.0, 0.0);
                b.l(w, h);
                return vec![SubPath {
                    fill: false,
                    stroke: true,
                    commands: b.cmds,
                }];
            }
            Preset::Rect | Preset::FlowChartProcess => g.rect(&mut b),
            Preset::RoundRect => g.round_rect(&mut b),
            Preset::Snip1Rect => g.snip1_rect(&mut b),
            Preset::Snip2SameRect => g.snip2_same_rect(&mut b),
            Preset::Round1Rect => g.round1_rect(&mut b),
            Preset::Round2SameRect => g.round2_same_rect(&mut b),
            Preset::Ellipse | Preset::FlowChartConnector => g.ellipse(&mut b),
            Preset::Triangle => g.triangle(&mut b),
            Preset::RtTriangle => b.poly(&[(0.0, h), (0.0, 0.0), (w, h)]),
            Preset::Diamond | Preset::FlowChartDecision => {
                b.poly(&[(0.0, h / 2.0), (w / 2.0, 0.0), (w, h / 2.0), (w / 2.0, h)])
            }
            Preset::Pentagon => g.pentagon(&mut b),
            Preset::Hexagon => g.hexagon(&mut b),
            Preset::Octagon => g.octagon(&mut b),
            Preset::Parallelogram => g.parallelogram(&mut b),
            Preset::Trapezoid => g.trapezoid(&mut b),
            Preset::Heart => g.heart(&mut b),
            Preset::Cloud => cloud(&mut b, w, h),
            Preset::RightArrow => g.right_arrow(&mut b),
            Preset::LeftArrow => g.left_arrow(&mut b),
            Preset::UpArrow => g.up_arrow(&mut b),
            Preset::DownArrow => g.down_arrow(&mut b),
            Preset::LeftRightArrow => g.left_right_arrow(&mut b),
            Preset::UpDownArrow => g.up_down_arrow(&mut b),
            Preset::Chevron => g.chevron(&mut b),
            Preset::HomePlate => g.home_plate(&mut b),
            Preset::Star4 => g.star4(&mut b),
            Preset::Star5 => g.star5(&mut b),
            Preset::Star6 => g.star6(&mut b),
            Preset::Star8 => g.star8(&mut b),
            Preset::WedgeRectCallout => g.wedge_rect_callout(&mut b, 0.0),
            Preset::WedgeRoundRectCallout => {
                let r = g.ss * g.adj("adj3") / 100_000.0;
                g.wedge_rect_callout(&mut b, r)
            }
            Preset::WedgeEllipseCallout => g.wedge_ellipse_callout(&mut b),
            Preset::FlowChartTerminator => {
                let mut s = Builder::new(w / 21_600.0, h / 21_600.0);
                s.m(3_475.0, 0.0);
                s.l(18_125.0, 0.0);
                s.a(3_475.0, 10_800.0, 270.0, 180.0);
                s.l(3_475.0, 21_600.0);
                s.a(3_475.0, 10_800.0, 90.0, 180.0);
                s.z();
                b = s;
            }
            Preset::FlowChartDocument => {
                let mut s = Builder::new(w / 21_600.0, h / 21_600.0);
                s.m(0.0, 0.0);
                s.l(21_600.0, 0.0);
                s.l(21_600.0, 17_322.0);
                s.c(10_800.0, 17_322.0, 10_800.0, 23_922.0, 0.0, 20_172.0);
                s.z();
                b = s;
            }
            Preset::FlowChartInputOutput => {
                b.poly(&[(0.0, h), (w / 5.0, 0.0), (w, 0.0), (w * 4.0 / 5.0, h)])
            }
        }
        vec![SubPath {
            fill: true,
            stroke: true,
            commands: b.cmds,
        }]
    }

    /// The connection sites of the shape in a `w` × `h` box, in
    /// PowerPoint's order (the `idx` of `a:stCxn`). Rectangles, flowchart
    /// shapes and most others have four (top, left, bottom, right: the
    /// edge midpoints of the box, or of the slanted sides of
    /// parallelograms, trapezoids and flowchart data), ellipses and
    /// flowchart connectors eight (counter-clockwise from the top),
    /// triangles six. Every shape has its center as the last site.
    pub fn connection_sites(&self, w: f64, h: f64, adj: &Adjust) -> Vec<Site> {
        let site = |x: f64, y: f64, angle_deg: f64| Site { x, y, angle_deg };
        let (hc, vc) = (w / 2.0, h / 2.0);
        let mut out = match self {
            Preset::Ellipse | Preset::FlowChartConnector => {
                let (dx, dy) = (hc * (PI / 4.0).cos(), vc * (PI / 4.0).sin());
                let (il, ir, it, ib) = (hc - dx, hc + dx, vc - dy, vc + dy);
                vec![
                    site(hc, 0.0, 270.0),
                    site(il, it, 270.0),
                    site(0.0, vc, 180.0),
                    site(il, ib, 90.0),
                    site(hc, h, 90.0),
                    site(ir, ib, 90.0),
                    site(w, vc, 0.0),
                    site(ir, it, 270.0),
                ]
            }
            Preset::Triangle => {
                let g = Guides::new(w, h, adj, self.adjust_defaults());
                let a = g.adj("adj").clamp(0.0, 100_000.0);
                let x1 = w * a / 200_000.0;
                let x2 = w * a / 100_000.0;
                vec![
                    site(x2, 0.0, 270.0),
                    site(x1, vc, 180.0),
                    site(0.0, h, 90.0),
                    site(x2, h, 90.0),
                    site(w, h, 90.0),
                    site(x1 + hc, vc, 0.0),
                ]
            }
            Preset::RtTriangle => vec![
                site(0.0, 0.0, 270.0),
                site(0.0, vc, 180.0),
                site(0.0, h, 90.0),
                site(hc, h, 90.0),
                site(w, h, 90.0),
                site(hc, vc, 0.0),
            ],
            Preset::FlowChartDocument => vec![
                site(hc, 0.0, 270.0),
                site(0.0, vc, 180.0),
                site(hc, h * 20_172.0 / 21_600.0, 90.0),
                site(w, vc, 0.0),
            ],
            Preset::FlowChartInputOutput => vec![
                site(w * 3.0 / 5.0, 0.0, 270.0),
                site(w / 10.0, vc, 180.0),
                site(w * 2.0 / 5.0, h, 90.0),
                site(w * 9.0 / 10.0, vc, 0.0),
            ],
            Preset::Parallelogram | Preset::Trapezoid => {
                // the middles of the slanted sides
                let g = Guides::new(w, h, adj, self.adjust_defaults());
                let max = if *self == Preset::Trapezoid {
                    50_000.0
                } else {
                    100_000.0
                };
                let x2 = g.ss * g.pin("adj", 0.0, max * w / g.ss) / 100_000.0;
                vec![
                    site(hc, 0.0, 270.0),
                    site(x2 / 2.0, vc, 180.0),
                    site(hc, h, 90.0),
                    site(w - x2 / 2.0, vc, 0.0),
                ]
            }
            Preset::Line => vec![site(0.0, 0.0, 180.0), site(w, h, 0.0)],
            _ => vec![
                site(hc, 0.0, 270.0),
                site(0.0, vc, 180.0),
                site(hc, h, 90.0),
                site(w, vc, 0.0),
            ],
        };
        out.push(site(hc, vc, 0.0));
        out
    }
}

/// The geometry of a connector (`p:cxnSp`). Elbow and curved connectors
/// come in variants with 1–4 turns (see [`crate::Connector::bends`]);
/// DrawingML numbers them by segments (`bentConnector2` has one turn).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ConnectorKind {
    /// A straight line (`straightConnector1`).
    #[default]
    Straight,
    /// Horizontal and vertical segments (`bentConnector2`…`5`; `adj1`
    /// = position of the first turn, 1/100000 of the width, default
    /// 50000; `adj2`/`adj3` for the later turns).
    Elbow,
    /// Curves through the same turns (`curvedConnector2`…`5`).
    Curved,
}

impl ConnectorKind {
    /// The DrawingML `prst` name for a connector with `turns` turns
    /// (1–4; ignored for straight connectors).
    pub fn prst(self, turns: u8) -> String {
        let n = turns.clamp(1, 4) + 1;
        match self {
            ConnectorKind::Straight => "straightConnector1".into(),
            ConnectorKind::Elbow => format!("bentConnector{n}"),
            ConnectorKind::Curved => format!("curvedConnector{n}"),
        }
    }

    /// Kind and number of turns of a DrawingML connector preset
    /// (`line` and `straightConnector1` are straight, reported with the
    /// default 2 turns).
    pub fn from_prst(prst: &str) -> Option<(ConnectorKind, u8)> {
        if matches!(prst, "line" | "straightConnector1") {
            return Some((ConnectorKind::Straight, 2));
        }
        let (kind, n) = if let Some(n) = prst.strip_prefix("bentConnector") {
            (ConnectorKind::Elbow, n)
        } else {
            (ConnectorKind::Curved, prst.strip_prefix("curvedConnector")?)
        };
        let n: u8 = n.parse().ok().filter(|n| (2..=5).contains(n))?;
        Some((kind, n - 1))
    }

    /// The adjust values of the variant with `turns` turns, with their
    /// defaults.
    pub fn adjust_defaults(self, turns: u8) -> &'static [(&'static str, i64)] {
        const ALL: [(&str, i64); 3] = [("adj1", 50_000), ("adj2", 50_000), ("adj3", 50_000)];
        match (self, turns) {
            (ConnectorKind::Straight, _) | (_, 0..=1) => &[],
            (_, 2) => &ALL[..1],
            (_, 3) => &ALL[..2],
            _ => &ALL,
        }
    }

    /// The corners of the connector's route in its `w` × `h` box, start
    /// and end included.
    fn points(self, turns: u8, w: f64, h: f64, adj: &Adjust) -> Vec<(f64, f64)> {
        let a = |n: &str| adj.get(n).copied().unwrap_or(50_000) as f64 / 100_000.0;
        match (self, turns.clamp(1, 4) + 1) {
            (ConnectorKind::Straight, _) => vec![(0.0, 0.0), (w, h)],
            (_, 2) => vec![(0.0, 0.0), (w, 0.0), (w, h)],
            (_, 3) => {
                let x1 = w * a("adj1");
                vec![(0.0, 0.0), (x1, 0.0), (x1, h), (w, h)]
            }
            (_, 4) => {
                let (x1, y2) = (w * a("adj1"), h * a("adj2"));
                vec![(0.0, 0.0), (x1, 0.0), (x1, y2), (w, y2), (w, h)]
            }
            _ => {
                let (x1, y2, x3) = (w * a("adj1"), h * a("adj2"), w * a("adj3"));
                vec![(0.0, 0.0), (x1, 0.0), (x1, y2), (x3, y2), (x3, h), (w, h)]
            }
        }
    }

    /// The path of a connector with `turns` turns in its `w` × `h` box,
    /// from the top-left (start) to the bottom-right corner (end); flips
    /// and rotation of the connector's transform map it onto the real end
    /// points. Not filled. Elbows are polylines; curved connectors with 1
    /// and 2 turns follow ECMA-376, with 3 and 4 turns they are smoothed
    /// through the elbow's corners.
    pub fn path(self, turns: u8, w: f64, h: f64, adj: &Adjust) -> Vec<PathCmd> {
        let mut b = Builder::new(1.0, 1.0);
        let pts = self.points(turns, w, h, adj);
        b.m(0.0, 0.0);
        match (self, turns.clamp(1, 4) + 1) {
            (ConnectorKind::Straight | ConnectorKind::Elbow, _) => {
                for &(x, y) in &pts[1..] {
                    b.l(x, y);
                }
            }
            (ConnectorKind::Curved, 2) => b.c(w / 2.0, 0.0, w, h / 2.0, w, h),
            (ConnectorKind::Curved, 3) => {
                let x2 = pts[1].0;
                let (x1, x3) = (x2 / 2.0, (w + x2) / 2.0);
                b.c(x1, 0.0, x2, h / 4.0, x2, h / 2.0);
                b.c(x2, h * 3.0 / 4.0, x3, h, w, h);
            }
            (ConnectorKind::Curved, _) => {
                let n = pts.len();
                for i in 1..n - 1 {
                    let (cx, cy) = pts[i];
                    let (nx, ny) = pts[i + 1];
                    let end = if i + 2 == n {
                        (nx, ny)
                    } else {
                        ((cx + nx) / 2.0, (cy + ny) / 2.0)
                    };
                    b.q(cx, cy, end.0, end.1);
                }
            }
        }
        b.cmds
    }
}

// --- path building -------------------------------------------------------------

/// Builds a path in a coordinate space scaled by `sx`/`sy` into EMU,
/// tracking the current point for arcs.
struct Builder {
    sx: f64,
    sy: f64,
    cmds: Vec<PathCmd>,
    /// Current point (unscaled) and sub-path start.
    cur: (f64, f64),
    start: (f64, f64),
}

/// Parametric angle (radians) of the point at visual angle `deg` on an
/// ellipse with radii `wr`/`hr`.
fn param_angle(wr: f64, hr: f64, deg: f64) -> f64 {
    let t = deg.to_radians();
    (wr * t.sin()).atan2(hr * t.cos())
}

/// Visual angle (degrees) of the point at parametric angle `phi`.
fn visual_angle(wr: f64, hr: f64, phi: f64) -> f64 {
    (hr * phi.sin()).atan2(wr * phi.cos()).to_degrees()
}

/// The parametric start angle and signed parametric sweep (radians) of an
/// arc given in visual angles.
fn arc_params(wr: f64, hr: f64, start_deg: f64, sweep_deg: f64) -> (f64, f64) {
    let p1 = param_angle(wr, hr, start_deg);
    if sweep_deg.abs() >= 360.0 {
        return (p1, 2.0 * PI * sweep_deg.signum());
    }
    let p2 = param_angle(wr, hr, start_deg + sweep_deg);
    let mut d = p2 - p1;
    if sweep_deg > 0.0 {
        while d < 0.0 {
            d += 2.0 * PI;
        }
        if d == 0.0 && sweep_deg > 180.0 {
            d = 2.0 * PI;
        }
    } else if sweep_deg < 0.0 {
        while d > 0.0 {
            d -= 2.0 * PI;
        }
    } else {
        d = 0.0;
    }
    (p1, d)
}

impl Builder {
    fn new(sx: f64, sy: f64) -> Self {
        Builder {
            sx,
            sy,
            cmds: Vec::new(),
            cur: (0.0, 0.0),
            start: (0.0, 0.0),
        }
    }

    fn m(&mut self, x: f64, y: f64) {
        self.cur = (x, y);
        self.start = (x, y);
        self.cmds.push(PathCmd::MoveTo {
            x: x * self.sx,
            y: y * self.sy,
        });
    }

    fn l(&mut self, x: f64, y: f64) {
        self.cur = (x, y);
        self.cmds.push(PathCmd::LineTo {
            x: x * self.sx,
            y: y * self.sy,
        });
    }

    fn c(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, x: f64, y: f64) {
        self.cur = (x, y);
        let (sx, sy) = (self.sx, self.sy);
        self.cmds.push(PathCmd::CubicTo {
            x1: x1 * sx,
            y1: y1 * sy,
            x2: x2 * sx,
            y2: y2 * sy,
            x: x * sx,
            y: y * sy,
        });
    }

    fn q(&mut self, x1: f64, y1: f64, x: f64, y: f64) {
        self.cur = (x, y);
        let (sx, sy) = (self.sx, self.sy);
        self.cmds.push(PathCmd::QuadTo {
            x1: x1 * sx,
            y1: y1 * sy,
            x: x * sx,
            y: y * sy,
        });
    }

    /// `a:arcTo` in unscaled coordinates; the emitted arc has scaled radii
    /// and the visual angles of the scaled ellipse.
    fn a(&mut self, wr: f64, hr: f64, start_deg: f64, sweep_deg: f64) {
        let (p1, d) = arc_params(wr, hr, start_deg, sweep_deg);
        let (cx, cy) = (self.cur.0 - wr * p1.cos(), self.cur.1 - hr * p1.sin());
        let p2 = p1 + d;
        self.cur = (cx + wr * p2.cos(), cy + hr * p2.sin());
        let (swr, shr) = (wr * self.sx, hr * self.sy);
        let (start, sweep) = if self.sx == self.sy || swr == 0.0 || shr == 0.0 {
            (start_deg, sweep_deg)
        } else {
            let s = visual_angle(swr, shr, p1);
            let mut e = visual_angle(swr, shr, p2) - s;
            // keep the winding of the parametric sweep
            let turns = (d / (2.0 * PI)).trunc();
            let rem = d - turns * 2.0 * PI;
            if rem > 0.0 {
                while e <= 0.0 {
                    e += 360.0;
                }
            } else if rem < 0.0 {
                while e >= 0.0 {
                    e -= 360.0;
                }
            } else {
                e = 0.0;
            }
            (s, e + turns * 360.0)
        };
        self.cmds.push(PathCmd::ArcTo {
            wr: swr,
            hr: shr,
            start_deg: start,
            sweep_deg: sweep,
        });
    }

    fn z(&mut self) {
        self.cur = self.start;
        self.cmds.push(PathCmd::Close);
    }

    /// A closed polygon.
    fn poly(&mut self, pts: &[(f64, f64)]) {
        for (i, &(x, y)) in pts.iter().enumerate() {
            if i == 0 {
                self.m(x, y);
            } else {
                self.l(x, y);
            }
        }
        self.z();
    }

    /// Replays a command given in unscaled coordinates.
    fn cmd(&mut self, c: &PathCmd) {
        match *c {
            PathCmd::MoveTo { x, y } => self.m(x, y),
            PathCmd::LineTo { x, y } => self.l(x, y),
            PathCmd::ArcTo {
                wr,
                hr,
                start_deg,
                sweep_deg,
            } => self.a(wr, hr, start_deg, sweep_deg),
            PathCmd::QuadTo { x1, y1, x, y } => self.q(x1, y1, x, y),
            PathCmd::CubicTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => self.c(x1, y1, x2, y2, x, y),
            PathCmd::Close => self.z(),
        }
    }
}

/// Replaces every arc by cubic Béziers (at most 90° each), so the path
/// only holds moves, lines, curves and closes.
pub fn flatten(cmds: &[PathCmd]) -> Vec<PathCmd> {
    let mut out = Vec::with_capacity(cmds.len());
    let mut cur = (0.0, 0.0);
    let mut start = (0.0, 0.0);
    for c in cmds {
        match *c {
            PathCmd::MoveTo { x, y } => {
                cur = (x, y);
                start = cur;
                out.push(*c);
            }
            PathCmd::LineTo { x, y }
            | PathCmd::QuadTo { x, y, .. }
            | PathCmd::CubicTo { x, y, .. } => {
                cur = (x, y);
                out.push(*c);
            }
            PathCmd::Close => {
                cur = start;
                out.push(*c);
            }
            PathCmd::ArcTo {
                wr,
                hr,
                start_deg,
                sweep_deg,
            } => {
                let (p1, d) = arc_params(wr, hr, start_deg, sweep_deg);
                let (cx, cy) = (cur.0 - wr * p1.cos(), cur.1 - hr * p1.sin());
                let n = ((d.abs() / (PI / 2.0)).ceil() as usize).max(1);
                let step = d / n as f64;
                let k = 4.0 / 3.0 * (step / 4.0).tan();
                for i in 0..n {
                    let a = p1 + step * i as f64;
                    let b = a + step;
                    let (ca, sa, cb, sb) = (a.cos(), a.sin(), b.cos(), b.sin());
                    let p0 = (cx + wr * ca, cy + hr * sa);
                    let p3 = (cx + wr * cb, cy + hr * sb);
                    out.push(PathCmd::CubicTo {
                        x1: p0.0 - k * wr * sa,
                        y1: p0.1 + k * hr * ca,
                        x2: p3.0 + k * wr * sb,
                        y2: p3.1 - k * hr * cb,
                        x: p3.0,
                        y: p3.1,
                    });
                    cur = p3;
                }
            }
        }
    }
    out
}

/// The bounding box `(min_x, min_y, max_x, max_y)` of the drawn path
/// (curves sampled), or `None` for an empty path.
pub fn path_bounds(cmds: &[PathCmd]) -> Option<(f64, f64, f64, f64)> {
    let mut b: Option<(f64, f64, f64, f64)> = None;
    let mut add = |x: f64, y: f64| {
        b = Some(match b {
            None => (x, y, x, y),
            Some((a, c, d, e)) => (a.min(x), c.min(y), d.max(x), e.max(y)),
        });
    };
    let mut cur = (0.0, 0.0);
    for c in flatten(cmds) {
        match c {
            PathCmd::MoveTo { x, y } | PathCmd::LineTo { x, y } => {
                add(x, y);
                cur = (x, y);
            }
            PathCmd::QuadTo { x1, y1, x, y } => {
                for i in 1..=16 {
                    let t = f64::from(i) / 16.0;
                    let u = 1.0 - t;
                    add(
                        u * u * cur.0 + 2.0 * u * t * x1 + t * t * x,
                        u * u * cur.1 + 2.0 * u * t * y1 + t * t * y,
                    );
                }
                cur = (x, y);
            }
            PathCmd::CubicTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => {
                for i in 1..=32 {
                    let t = f64::from(i) / 32.0;
                    let u = 1.0 - t;
                    let (a, bb, cc, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                    add(
                        a * cur.0 + bb * x1 + cc * x2 + d * x,
                        a * cur.1 + bb * y1 + cc * y2 + d * y,
                    );
                }
                cur = (x, y);
            }
            PathCmd::ArcTo { .. } | PathCmd::Close => {}
        }
    }
    b
}

// --- presets ----------------------------------------------------------------------

/// The ECMA built-in guides of a `w` × `h` box plus the adjust values.
struct Guides<'a> {
    w: f64,
    h: f64,
    ss: f64,
    adj: &'a Adjust,
    defaults: &'static [(&'static str, i64)],
}

impl<'a> Guides<'a> {
    fn new(w: f64, h: f64, adj: &'a Adjust, defaults: &'static [(&'static str, i64)]) -> Self {
        Guides {
            w,
            h,
            ss: w.min(h),
            adj,
            defaults,
        }
    }

    /// Adjust value `name` (or its default).
    fn adj(&self, name: &str) -> f64 {
        self.adj
            .get(name)
            .copied()
            .or_else(|| self.defaults.iter().find(|(n, _)| *n == name).map(|d| d.1))
            .unwrap_or(0) as f64
    }

    /// `pin lo adj hi`.
    fn pin(&self, name: &str, lo: f64, hi: f64) -> f64 {
        self.adj(name).max(lo).min(hi.max(lo))
    }

    fn rect(&self, b: &mut Builder) {
        b.poly(&[(0.0, 0.0), (self.w, 0.0), (self.w, self.h), (0.0, self.h)]);
    }

    fn round_rect(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let x1 = self.ss * self.pin("adj", 0.0, 50_000.0) / 100_000.0;
        b.m(0.0, x1);
        b.a(x1, x1, 180.0, 90.0);
        b.l(w - x1, 0.0);
        b.a(x1, x1, 270.0, 90.0);
        b.l(w, h - x1);
        b.a(x1, x1, 0.0, 90.0);
        b.l(x1, h);
        b.a(x1, x1, 90.0, 90.0);
        b.z();
    }

    fn snip1_rect(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let d = self.ss * self.pin("adj", 0.0, 50_000.0) / 100_000.0;
        b.poly(&[(0.0, 0.0), (w - d, 0.0), (w, d), (w, h), (0.0, h)]);
    }

    fn snip2_same_rect(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let t = self.ss * self.pin("adj1", 0.0, 50_000.0) / 100_000.0;
        let d = self.ss * self.pin("adj2", 0.0, 50_000.0) / 100_000.0;
        b.poly(&[
            (t, 0.0),
            (w - t, 0.0),
            (w, t),
            (w, h - d),
            (w - d, h),
            (d, h),
            (0.0, h - d),
            (0.0, t),
        ]);
    }

    fn round1_rect(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let d = self.ss * self.pin("adj", 0.0, 50_000.0) / 100_000.0;
        b.m(0.0, 0.0);
        b.l(w - d, 0.0);
        b.a(d, d, 270.0, 90.0);
        b.l(w, h);
        b.l(0.0, h);
        b.z();
    }

    fn round2_same_rect(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let t = self.ss * self.pin("adj1", 0.0, 50_000.0) / 100_000.0;
        let d = self.ss * self.pin("adj2", 0.0, 50_000.0) / 100_000.0;
        b.m(t, 0.0);
        b.l(w - t, 0.0);
        b.a(t, t, 270.0, 90.0);
        b.l(w, h - d);
        b.a(d, d, 0.0, 90.0);
        b.l(d, h);
        b.a(d, d, 90.0, 90.0);
        b.l(0.0, t);
        b.a(t, t, 180.0, 90.0);
        b.z();
    }

    fn ellipse(&self, b: &mut Builder) {
        let (wd2, hd2) = (self.w / 2.0, self.h / 2.0);
        b.m(0.0, hd2);
        for st in [180.0, 270.0, 0.0, 90.0] {
            b.a(wd2, hd2, st, 90.0);
        }
        b.z();
    }

    fn triangle(&self, b: &mut Builder) {
        let x2 = self.w * self.pin("adj", 0.0, 100_000.0) / 100_000.0;
        b.poly(&[(0.0, self.h), (x2, 0.0), (self.w, self.h)]);
    }

    fn pentagon(&self, b: &mut Builder) {
        let (hc, vc) = (self.w / 2.0, self.h / 2.0);
        let swd2 = hc * self.adj("hf") / 100_000.0;
        let shd2 = vc * self.adj("vf") / 100_000.0;
        let svc = vc * self.adj("vf") / 100_000.0;
        let (dx1, dy1) = (
            swd2 * 18f64.to_radians().cos(),
            shd2 * 18f64.to_radians().sin(),
        );
        let (dx2, dy2) = (
            swd2 * 306f64.to_radians().cos(),
            shd2 * 306f64.to_radians().sin(),
        );
        let (y1, y2) = (svc - dy1, svc - dy2);
        b.poly(&[
            (hc - dx1, y1),
            (hc, 0.0),
            (hc + dx1, y1),
            (hc + dx2, y2),
            (hc - dx2, y2),
        ]);
    }

    fn hexagon(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let max = 50_000.0 * w / self.ss;
        let x1 = self.ss * self.pin("adj", 0.0, max) / 100_000.0;
        let shd2 = h / 2.0 * self.adj("vf") / 100_000.0;
        let dy1 = shd2 * 60f64.to_radians().sin();
        let vc = h / 2.0;
        b.poly(&[
            (0.0, vc),
            (x1, vc - dy1),
            (w - x1, vc - dy1),
            (w, vc),
            (w - x1, vc + dy1),
            (x1, vc + dy1),
        ]);
    }

    fn octagon(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let x1 = self.ss * self.pin("adj", 0.0, 50_000.0) / 100_000.0;
        b.poly(&[
            (0.0, x1),
            (x1, 0.0),
            (w - x1, 0.0),
            (w, x1),
            (w, h - x1),
            (w - x1, h),
            (x1, h),
            (0.0, h - x1),
        ]);
    }

    fn parallelogram(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let max = 100_000.0 * w / self.ss;
        let x2 = self.ss * self.pin("adj", 0.0, max) / 100_000.0;
        b.poly(&[(0.0, h), (x2, 0.0), (w, 0.0), (w - x2, h)]);
    }

    fn trapezoid(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let max = 50_000.0 * w / self.ss;
        let x2 = self.ss * self.pin("adj", 0.0, max) / 100_000.0;
        b.poly(&[(0.0, h), (x2, 0.0), (w - x2, 0.0), (w, h)]);
    }

    fn heart(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let hc = w / 2.0;
        let (dx1, dx2) = (w * 49.0 / 48.0, w * 10.0 / 48.0);
        let (x1, x2, x3, x4) = (hc - dx1, hc - dx2, hc + dx2, hc + dx1);
        let y1 = -h / 3.0;
        let hd4 = h / 4.0;
        b.m(hc, hd4);
        b.c(x3, y1, x4, hd4, hc, h);
        b.c(x1, hd4, x2, y1, hc, hd4);
        b.z();
    }

    /// Shaft half-thickness `dy1` and head length `dx` of a horizontal
    /// arrow; `heads` is 1 or 2.
    fn h_arrow(&self, heads: f64) -> (f64, f64) {
        let max2 = 100_000.0 / heads * self.w / self.ss;
        let a1 = self.pin("adj1", 0.0, 100_000.0);
        let a2 = self.pin("adj2", 0.0, max2);
        (self.h * a1 / 200_000.0, self.ss * a2 / 100_000.0)
    }

    /// Shaft half-width and head length of a vertical arrow.
    fn v_arrow(&self, heads: f64) -> (f64, f64) {
        let max2 = 100_000.0 / heads * self.h / self.ss;
        let a1 = self.pin("adj1", 0.0, 100_000.0);
        let a2 = self.pin("adj2", 0.0, max2);
        (self.w * a1 / 200_000.0, self.ss * a2 / 100_000.0)
    }

    fn right_arrow(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (dy1, dx) = self.h_arrow(1.0);
        let (vc, x1) = (h / 2.0, w - dx);
        b.poly(&[
            (0.0, vc - dy1),
            (x1, vc - dy1),
            (x1, 0.0),
            (w, vc),
            (x1, h),
            (x1, vc + dy1),
            (0.0, vc + dy1),
        ]);
    }

    fn left_arrow(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (dy1, x2) = self.h_arrow(1.0);
        let vc = h / 2.0;
        b.poly(&[
            (0.0, vc),
            (x2, 0.0),
            (x2, vc - dy1),
            (w, vc - dy1),
            (w, vc + dy1),
            (x2, vc + dy1),
            (x2, h),
        ]);
    }

    fn up_arrow(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (dx1, y2) = self.v_arrow(1.0);
        let hc = w / 2.0;
        b.poly(&[
            (0.0, y2),
            (hc, 0.0),
            (w, y2),
            (hc + dx1, y2),
            (hc + dx1, h),
            (hc - dx1, h),
            (hc - dx1, y2),
        ]);
    }

    fn down_arrow(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (dx1, dy) = self.v_arrow(1.0);
        let (hc, y1) = (w / 2.0, h - dy);
        b.poly(&[
            (0.0, y1),
            (hc - dx1, y1),
            (hc - dx1, 0.0),
            (hc + dx1, 0.0),
            (hc + dx1, y1),
            (w, y1),
            (hc, h),
        ]);
    }

    fn left_right_arrow(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (dy, x2) = self.h_arrow(2.0);
        let (vc, x3) = (h / 2.0, w - x2);
        b.poly(&[
            (0.0, vc),
            (x2, 0.0),
            (x2, vc - dy),
            (x3, vc - dy),
            (x3, 0.0),
            (w, vc),
            (x3, h),
            (x3, vc + dy),
            (x2, vc + dy),
            (x2, h),
        ]);
    }

    fn up_down_arrow(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (dx1, y2) = self.v_arrow(2.0);
        let (hc, y3) = (w / 2.0, h - y2);
        b.poly(&[
            (0.0, y2),
            (hc, 0.0),
            (w, y2),
            (hc + dx1, y2),
            (hc + dx1, y3),
            (w, y3),
            (hc, h),
            (0.0, y3),
            (hc - dx1, y3),
            (hc - dx1, y2),
        ]);
    }

    fn chevron(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let max = 100_000.0 * w / self.ss;
        let x1 = self.ss * self.pin("adj", 0.0, max) / 100_000.0;
        let vc = h / 2.0;
        b.poly(&[
            (0.0, 0.0),
            (w - x1, 0.0),
            (w, vc),
            (w - x1, h),
            (0.0, h),
            (x1, vc),
        ]);
    }

    fn home_plate(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let max = 100_000.0 * w / self.ss;
        let x1 = w - self.ss * self.pin("adj", 0.0, max) / 100_000.0;
        b.poly(&[(0.0, 0.0), (x1, 0.0), (w, h / 2.0), (x1, h), (0.0, h)]);
    }

    fn star4(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (hc, vc) = (w / 2.0, h / 2.0);
        let a = self.pin("adj", 0.0, 50_000.0);
        let (iwd2, ihd2) = (hc * a / 50_000.0, vc * a / 50_000.0);
        let c45 = 45f64.to_radians();
        let (sdx, sdy) = (iwd2 * c45.cos(), ihd2 * c45.sin());
        b.poly(&[
            (0.0, vc),
            (hc - sdx, vc - sdy),
            (hc, 0.0),
            (hc + sdx, vc - sdy),
            (w, vc),
            (hc + sdx, vc + sdy),
            (hc, h),
            (hc - sdx, vc + sdy),
        ]);
    }

    fn star5(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (hc, vc) = (w / 2.0, h / 2.0);
        let a = self.pin("adj", 0.0, 50_000.0);
        let (hf, vf) = (self.adj("hf") / 100_000.0, self.adj("vf") / 100_000.0);
        let (swd2, shd2, svc) = (hc * hf, vc * vf, vc * vf);
        let r = f64::to_radians;
        let (dx1, dx2) = (swd2 * r(18.0).cos(), swd2 * r(306.0).cos());
        let (dy1, dy2) = (shd2 * r(18.0).sin(), shd2 * r(306.0).sin());
        let (x1, x2, x3, x4) = (hc - dx1, hc - dx2, hc + dx2, hc + dx1);
        let (y1, y2) = (svc - dy1, svc - dy2);
        let (iwd2, ihd2) = (swd2 * a / 50_000.0, shd2 * a / 50_000.0);
        let (sdx1, sdx2) = (iwd2 * r(342.0).cos(), iwd2 * r(54.0).cos());
        let (sdy1, sdy2) = (ihd2 * r(54.0).sin(), ihd2 * r(342.0).sin());
        let (sx1, sx2, sx3, sx4) = (hc - sdx1, hc - sdx2, hc + sdx2, hc + sdx1);
        let (sy1, sy2, sy3) = (svc - sdy1, svc - sdy2, svc + ihd2);
        b.poly(&[
            (x1, y1),
            (sx2, sy1),
            (hc, 0.0),
            (sx3, sy1),
            (x4, y1),
            (sx4, sy2),
            (x3, y2),
            (hc, sy3),
            (x2, y2),
            (sx1, sy2),
        ]);
    }

    fn star6(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (hc, vc) = (w / 2.0, h / 2.0);
        let a = self.pin("adj", 0.0, 50_000.0);
        let swd2 = hc * self.adj("hf") / 100_000.0;
        let dx1 = swd2 * 30f64.to_radians().cos();
        let (x1, x2) = (hc - dx1, hc + dx1);
        let hd4 = h / 4.0;
        let y2 = vc + hd4;
        let (iwd2, ihd2) = (swd2 * a / 50_000.0, vc * a / 50_000.0);
        let sdx2 = iwd2 / 2.0;
        let sdy1 = ihd2 * 60f64.to_radians().sin();
        let (sy1, sy2) = (vc - sdy1, vc + sdy1);
        b.poly(&[
            (x1, hd4),
            (hc - sdx2, sy1),
            (hc, 0.0),
            (hc + sdx2, sy1),
            (x2, hd4),
            (hc + iwd2, vc),
            (x2, y2),
            (hc + sdx2, sy2),
            (hc, h),
            (hc - sdx2, sy2),
            (x1, y2),
            (hc - iwd2, vc),
        ]);
    }

    fn star8(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (hc, vc) = (w / 2.0, h / 2.0);
        let a = self.pin("adj", 0.0, 50_000.0);
        let c45 = 45f64.to_radians();
        let (dx1, dy1) = (hc * c45.cos(), vc * c45.sin());
        let (x1, x2, y1, y2) = (hc - dx1, hc + dx1, vc - dy1, vc + dy1);
        let (iwd2, ihd2) = (hc * a / 50_000.0, vc * a / 50_000.0);
        let (sdx1, sdx2) = (iwd2 * 0.923_88, iwd2 * 0.382_68);
        let (sdy1, sdy2) = (ihd2 * 0.923_88, ihd2 * 0.382_68);
        let (sx1, sx2, sx3, sx4) = (hc - sdx1, hc - sdx2, hc + sdx2, hc + sdx1);
        let (sy1, sy2, sy3, sy4) = (vc - sdy1, vc - sdy2, vc + sdy2, vc + sdy1);
        b.poly(&[
            (0.0, vc),
            (sx1, sy2),
            (x1, y1),
            (sx2, sy1),
            (hc, 0.0),
            (sx3, sy1),
            (x2, y1),
            (sx4, sy2),
            (w, vc),
            (sx4, sy3),
            (x2, y2),
            (sx3, sy4),
            (hc, h),
            (sx2, sy4),
            (x1, y2),
            (sx1, sy3),
        ]);
    }

    /// `wedgeRectCallout` (`r` = 0) and `wedgeRoundRectCallout` (corner
    /// radius `r`): the tail leaves the side facing its tip, from the
    /// 2/12–5/12 or 7/12–10/12 stretch of that side.
    fn wedge_rect_callout(&self, b: &mut Builder, r: f64) {
        let (w, h) = (self.w, self.h);
        let (hc, vc) = (w / 2.0, h / 2.0);
        let dx_pos = w * self.adj("adj1") / 100_000.0;
        let dy_pos = h * self.adj("adj2") / 100_000.0;
        let (x_pos, y_pos) = (hc + dx_pos, vc + dy_pos);
        let horizontal = (dx_pos * h).abs() > (dy_pos * w).abs();
        let (xg1, xg2) = if dx_pos > 0.0 {
            (7.0, 10.0)
        } else {
            (2.0, 5.0)
        };
        let (yg1, yg2) = if dy_pos > 0.0 {
            (7.0, 10.0)
        } else {
            (2.0, 5.0)
        };
        let (x1, x2) = (w * xg1 / 12.0, w * xg2 / 12.0);
        let (y1, y2) = (h * yg1 / 12.0, h * yg2 / 12.0);
        let tail_left = horizontal && dx_pos <= 0.0;
        let tail_right = horizontal && dx_pos > 0.0;
        let tail_top = !horizontal && dy_pos <= 0.0;
        let tail_bottom = !horizontal && dy_pos > 0.0;
        let corner = |b: &mut Builder, st: f64| {
            if r > 0.0 {
                b.a(r, r, st, 90.0);
            }
        };
        b.m(0.0, r);
        corner(b, 180.0);
        if tail_top {
            b.l(x1, 0.0);
            b.l(x_pos, y_pos);
            b.l(x2, 0.0);
        }
        b.l(w - r, 0.0);
        corner(b, 270.0);
        if tail_right {
            b.l(w, y1);
            b.l(x_pos, y_pos);
            b.l(w, y2);
        }
        b.l(w, h - r);
        corner(b, 0.0);
        if tail_bottom {
            b.l(x2, h);
            b.l(x_pos, y_pos);
            b.l(x1, h);
        }
        b.l(r, h);
        corner(b, 90.0);
        if tail_left {
            b.l(0.0, y2);
            b.l(x_pos, y_pos);
            b.l(0.0, y1);
        }
        b.z();
    }

    fn wedge_ellipse_callout(&self, b: &mut Builder) {
        let (w, h) = (self.w, self.h);
        let (hc, vc) = (w / 2.0, h / 2.0);
        let dx_pos = w * self.adj("adj1") / 100_000.0;
        let dy_pos = h * self.adj("adj2") / 100_000.0;
        let (x_pos, y_pos) = (hc + dx_pos, vc + dy_pos);
        // the tail's base spans ±11° (parametric) around the tip's direction
        let pang = (dy_pos * w).atan2(dx_pos * h);
        let (st, en) = (pang + 11f64.to_radians(), pang - 11f64.to_radians());
        let (x1, y1) = (hc + hc * st.cos(), vc + vc * st.sin());
        let (x2, y2) = (hc + hc * en.cos(), vc + vc * en.sin());
        let st1 = (y1 - vc).atan2(x1 - hc).to_degrees();
        let en1 = (y2 - vc).atan2(x2 - hc).to_degrees();
        // from the base's end the long way round to its start
        let mut sw = st1 - en1;
        while sw > 0.0 {
            sw -= 360.0;
        }
        b.m(x1, y1);
        b.l(x_pos, y_pos);
        b.l(x2, y2);
        b.a(hc, vc, en1, sw);
        b.z();
    }
}

/// `cloud`: eleven arcs in a 43200 × 43200 path space.
fn cloud(b: &mut Builder, w: f64, h: f64) {
    let mut s = Builder::new(w / 43_200.0, h / 43_200.0);
    const ARCS: [(f64, f64, f64, f64); 11] = [
        (6_753.0, 9_190.0, -11_429_249.0, 7_426_832.0),
        (5_333.0, 7_267.0, -8_646_143.0, 5_396_714.0),
        (4_365.0, 5_945.0, -8_748_475.0, 5_983_381.0),
        (4_857.0, 6_595.0, -7_859_164.0, 7_034_504.0),
        (5_333.0, 7_273.0, -4_722_533.0, 6_541_615.0),
        (6_775.0, 9_220.0, -2_776_035.0, 7_816_140.0),
        (5_785.0, 7_867.0, 37_501.0, 6_842_000.0),
        (6_752.0, 9_215.0, 1_347_096.0, 6_910_353.0),
        (7_720.0, 10_543.0, 3_974_558.0, 4_542_661.0),
        (4_360.0, 5_918.0, -16_496_525.0, 8_804_134.0),
        (4_345.0, 5_945.0, -14_809_710.0, 9_151_131.0),
    ];
    s.m(3_900.0, 14_370.0);
    for (wr, hr, st, sw) in ARCS {
        s.a(wr, hr, st / 60_000.0, sw / 60_000.0);
    }
    s.z();
    *b = s;
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f64 = 1_000_000.0;
    const H: f64 = 600_000.0;

    fn bounds(p: &Preset, w: f64, h: f64) -> (f64, f64, f64, f64) {
        path_bounds(&p.path(w, h, &Adjust::new())).unwrap()
    }

    fn near(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    /// Every vertex (end point) of the flattened path.
    fn points(p: &Preset, adj: &Adjust) -> Vec<(i64, i64)> {
        flatten(&p.path(W, H, adj))
            .iter()
            .filter_map(|c| match *c {
                PathCmd::MoveTo { x, y }
                | PathCmd::LineTo { x, y }
                | PathCmd::CubicTo { x, y, .. } => Some((x.round() as i64, y.round() as i64)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn names_roundtrip_and_serde() {
        for p in Preset::ALL {
            assert_eq!(Preset::from_prst(p.prst()), Some(p.clone()));
            assert_eq!(
                serde_json::to_string(&p).unwrap(),
                format!("\"{}\"", p.prst()),
                "serde name of {p:?}"
            );
        }
        assert_eq!(Preset::from_prst("straightConnector1"), Some(Preset::Line));
        assert_eq!(Preset::from_prst("lightningBolt"), None);
        let c = Preset::Custom {
            paths: vec![GeomPath {
                w: 10.0,
                h: 10.0,
                fill: true,
                stroke: true,
                commands: vec![PathCmd::MoveTo { x: 0.0, y: 0.0 }, PathCmd::Close],
            }],
        };
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(
            json,
            r#"{"custom":{"paths":[{"w":10.0,"h":10.0,"fill":true,"stroke":true,"commands":[{"kind":"moveTo","x":0.0,"y":0.0},{"kind":"close"}]}]}}"#
        );
        assert_eq!(serde_json::from_str::<Preset>(&json).unwrap(), c);
    }

    #[test]
    fn every_preset_fills_its_box() {
        // Shapes whose outline touches all four sides of the box.
        for p in Preset::ALL {
            let (x0, y0, x1, y1) = bounds(&p, W, H);
            // cubic approximations of arcs not split at the quadrants
            // bulge by up to 0.03 % of the radius
            let tol = if p == Preset::WedgeEllipseCallout {
                300.0
            } else {
                2.0
            };
            match p {
                // the tail reaches below the box
                Preset::WedgeRectCallout
                | Preset::WedgeRoundRectCallout
                | Preset::WedgeEllipseCallout => {
                    assert!(near(y1, H * 1.125, tol), "{p:?} {y1}");
                    assert!(near(x0, 0.0, tol) && near(x1, W, tol), "{p:?} {x0} {x1}");
                    assert!(near(y0, 0.0, tol), "{p:?} {y0}");
                }
                // the document's wave stays above the bottom edge
                Preset::FlowChartDocument => {
                    assert!(near(y1, H * 0.987, 1_000.0), "{y1}");
                    assert!(near(x0, 0.0, tol) && near(x1, W, tol) && near(y0, 0.0, tol));
                }
                // ECMA's cloud and heart stay (almost) inside the box
                Preset::Cloud | Preset::Heart => {
                    assert!(x0 >= -W * 0.01 && y0 >= -H * 0.01, "{p:?} {x0} {y0}");
                    assert!(x1 <= W * 1.01 && y1 <= H * 1.01, "{p:?} {x1} {y1}");
                    assert!(x1 - x0 > W * 0.9 && y1 - y0 > H * 0.9, "{p:?}");
                }
                _ => {
                    assert!(near(x0, 0.0, tol) && near(y0, 0.0, tol), "{p:?} {x0} {y0}");
                    assert!(near(x1, W, tol) && near(y1, H, tol), "{p:?} {x1} {y1}");
                }
            }
        }
    }

    #[test]
    fn known_points() {
        let none = Adjust::new();
        // rectangle and diamond corners
        assert_eq!(
            points(&Preset::Rect, &none),
            [(0, 0), (1_000_000, 0), (1_000_000, 600_000), (0, 600_000)]
        );
        assert_eq!(
            points(&Preset::Diamond, &none),
            [
                (0, 300_000),
                (500_000, 0),
                (1_000_000, 300_000),
                (500_000, 600_000)
            ]
        );
        // right arrow: shaft half the height, head ss/2 long
        assert_eq!(
            points(&Preset::RightArrow, &none),
            [
                (0, 150_000),
                (700_000, 150_000),
                (700_000, 0),
                (1_000_000, 300_000),
                (700_000, 600_000),
                (700_000, 450_000),
                (0, 450_000)
            ]
        );
        // adjusted: thin shaft, short head
        let adj: Adjust = [("adj1".into(), 20_000), ("adj2".into(), 10_000)].into();
        assert_eq!(points(&Preset::RightArrow, &adj)[1], (940_000, 240_000));
        // rounded rectangle: default corner radius ss/6
        let pts = points(&Preset::RoundRect, &none);
        assert_eq!(pts[0], (0, 100_002));
        assert_eq!(pts[1], (100_002, 0));
        assert_eq!(pts[2], (899_998, 0));
        assert_eq!(pts[3], (1_000_000, 100_002));
        // corner radius clamps at ss/2
        let big: Adjust = [("adj".into(), 90_000)].into();
        assert_eq!(points(&Preset::RoundRect, &big)[1], (300_000, 0));
        // triangle apex
        assert_eq!(points(&Preset::Triangle, &none)[1], (500_000, 0));
        let left: Adjust = [("adj".into(), 0)].into();
        assert_eq!(points(&Preset::Triangle, &left)[1], (0, 0));
        // hexagon: inset ss/4 at the top
        assert_eq!(points(&Preset::Hexagon, &none)[1], (150_000, 0));
        // chevron notch and point
        let pts = points(&Preset::Chevron, &none);
        assert_eq!(pts[2], (1_000_000, 300_000));
        assert_eq!(pts[5], (300_000, 300_000));
        // regular pentagon: apex at the top center, base on the bottom
        let pts = points(&Preset::Pentagon, &none);
        assert_eq!(pts[1], (500_000, 0));
        assert!(near(pts[3].1 as f64, H, 2.0));
        // 5-point star: top tip, bottom inner point above the base
        let pts = points(&Preset::Star5, &none);
        assert_eq!(pts[2], (500_000, 0));
        assert!(pts[7].1 < 600_000 && pts[7].1 > 300_000);
        // ellipse: arcs flatten to four quarter curves through the quadrants
        assert_eq!(
            points(&Preset::Ellipse, &none),
            [
                (0, 300_000),
                (500_000, 0),
                (1_000_000, 300_000),
                (500_000, 600_000),
                (0, 300_000)
            ]
        );
        // callout tail tip (default bottom-left)
        let tail = points(&Preset::WedgeRectCallout, &none);
        assert!(tail.contains(&(291_670, 675_000)), "{tail:?}");
        // tail to the right when the tip is right of the box
        let right: Adjust = [("adj1".into(), 80_000), ("adj2".into(), 0)].into();
        let pts = points(&Preset::WedgeRectCallout, &right);
        assert!(pts.contains(&(1_300_000, 300_000)), "{pts:?}");
        assert!(pts.contains(&(1_000_000, 100_000)), "{pts:?}");
        // flowchart data: slanted sides at w/5
        assert_eq!(
            points(&Preset::FlowChartInputOutput, &none)[1],
            (200_000, 0)
        );
        // terminator: half-ellipse ends
        let pts = points(&Preset::FlowChartTerminator, &none);
        assert_eq!(pts[0], (160_880, 0));
    }

    #[test]
    fn arcs_and_scaling() {
        // a quarter arc from the left of a circle to its top
        let mut b = Builder::new(1.0, 1.0);
        b.m(0.0, 10.0);
        b.a(10.0, 10.0, 180.0, 90.0);
        assert!(near(b.cur.0, 10.0, 1e-9) && near(b.cur.1, 0.0, 1e-9));
        // the same in a space scaled 2× horizontally becomes an ellipse arc
        let mut s = Builder::new(2.0, 1.0);
        s.m(0.0, 10.0);
        s.a(10.0, 10.0, 180.0, 90.0);
        let PathCmd::ArcTo {
            wr,
            hr,
            start_deg,
            sweep_deg,
        } = s.cmds[1]
        else {
            panic!()
        };
        assert_eq!((wr, hr), (20.0, 10.0));
        assert!(near(start_deg, 180.0, 1e-9) && near(sweep_deg, 90.0, 1e-9));
        let flat = flatten(&s.cmds);
        let PathCmd::CubicTo { x, y, .. } = flat[1] else {
            panic!()
        };
        assert!(near(x, 20.0, 1e-9) && near(y, 0.0, 1e-9));
        // negative sweeps go counter-clockwise
        let mut c = Builder::new(1.0, 1.0);
        c.m(10.0, 0.0);
        c.a(10.0, 10.0, 270.0, -90.0);
        assert!(near(c.cur.0, 0.0, 1e-9) && near(c.cur.1, 10.0, 1e-9));
    }

    #[test]
    fn custom_paths_scale() {
        let p = Preset::Custom {
            paths: vec![GeomPath {
                w: 100.0,
                h: 100.0,
                fill: true,
                stroke: false,
                commands: vec![
                    PathCmd::MoveTo { x: 0.0, y: 0.0 },
                    PathCmd::LineTo { x: 100.0, y: 50.0 },
                    PathCmd::Close,
                ],
            }],
        };
        let paths = p.paths(1_000.0, 2_000.0, &Adjust::new());
        assert!(!paths[0].stroke);
        assert_eq!(
            paths[0].commands[1],
            PathCmd::LineTo {
                x: 1_000.0,
                y: 1_000.0
            }
        );
    }

    #[test]
    fn sites() {
        let none = Adjust::new();
        let s = Preset::Rect.connection_sites(W, H, &none);
        let xy: Vec<_> = s.iter().map(|s| (s.x, s.y, s.angle_deg)).collect();
        assert_eq!(
            xy,
            [
                (500_000.0, 0.0, 270.0),
                (0.0, 300_000.0, 180.0),
                (500_000.0, 600_000.0, 90.0),
                (1_000_000.0, 300_000.0, 0.0),
                (500_000.0, 300_000.0, 0.0)
            ]
        );
        assert_eq!(Preset::Ellipse.connection_sites(W, H, &none).len(), 9);
        assert_eq!(Preset::Triangle.connection_sites(W, H, &none).len(), 7);
        let e = Preset::Ellipse.connection_sites(W, H, &none);
        assert!(near(e[1].x, 500_000.0 - 500_000.0 * 0.5f64.sqrt(), 1e-6));
    }

    #[test]
    fn connector_paths() {
        let none = Adjust::new();
        assert_eq!(
            ConnectorKind::Elbow.path(2, 100.0, 50.0, &none),
            [
                PathCmd::MoveTo { x: 0.0, y: 0.0 },
                PathCmd::LineTo { x: 50.0, y: 0.0 },
                PathCmd::LineTo { x: 50.0, y: 50.0 },
                PathCmd::LineTo { x: 100.0, y: 50.0 }
            ]
        );
        assert_eq!(ConnectorKind::Elbow.path(1, 100.0, 50.0, &none).len(), 3);
        let adj: Adjust = [("adj1".into(), 25_000), ("adj3".into(), 75_000)].into();
        assert_eq!(
            ConnectorKind::Elbow.path(4, 100.0, 50.0, &adj)[3],
            PathCmd::LineTo { x: 75.0, y: 25.0 }
        );
        for n in 1..=4 {
            let (x0, y0, x1, y1) =
                path_bounds(&ConnectorKind::Curved.path(n, 100.0, 50.0, &none)).unwrap();
            assert!(
                x0 >= -1e-9 && y0 >= -1e-9 && x1 <= 100.0 + 1e-9 && y1 <= 50.0 + 1e-9,
                "{n}"
            );
        }
        for (prst, want) in [
            ("line", Some((ConnectorKind::Straight, 2))),
            ("bentConnector2", Some((ConnectorKind::Elbow, 1))),
            ("curvedConnector5", Some((ConnectorKind::Curved, 4))),
            ("bentConnector7", None),
            ("rect", None),
        ] {
            assert_eq!(ConnectorKind::from_prst(prst), want, "{prst}");
            if let Some((k, n)) = want.filter(|(k, _)| *k != ConnectorKind::Straight) {
                assert_eq!(k.prst(n), prst);
            }
        }
        assert_eq!(ConnectorKind::Elbow.adjust_defaults(3).len(), 2);
        let (x0, y0, x1, y1) =
            path_bounds(&ConnectorKind::Curved.path(2, 100.0, 50.0, &none)).unwrap();
        assert_eq!((x0, y0), (0.0, 0.0));
        assert!(near(x1, 100.0, 1e-9) && near(y1, 50.0, 1e-9));
    }
}
