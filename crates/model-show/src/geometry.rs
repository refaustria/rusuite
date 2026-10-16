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
    /// The fill is darkened by this fraction of its lightness (DrawingML
    /// `fill="darken"` = 0.4, `"darkenLess"` = 0.2) or, when negative,
    /// lightened (`"lighten"` = −0.4, `"lightenLess"` = −0.2); 0 = the
    /// shape's fill (action button icons).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<f64>"))]
    pub darken: f64,
}

fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

impl SubPath {
    /// A filled and stroked path.
    pub fn filled(commands: Vec<PathCmd>) -> Self {
        SubPath {
            fill: true,
            stroke: true,
            commands,
            darken: 0.0,
        }
    }

    /// A stroked path without fill.
    pub fn stroked(commands: Vec<PathCmd>) -> Self {
        SubPath {
            fill: false,
            stroke: true,
            commands,
            darken: 0.0,
        }
    }
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

/// One coordinate of an adjust handle driven by an adjust value: near
/// the current value the coordinate is `base + k · value` (for the angle of a polar handle:
/// the value is the angle itself, `base` 0 and `k` 1, in 60000ths of a
/// degree clockwise from the right around the box centre); the value is
/// kept in `min..=max`; `samples` give the coordinate over the range.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct HandleAxis {
    /// The adjust value (`adj`, `adj1`, …).
    pub adj: String,
    /// Coordinate at value 0.
    pub base: f64,
    /// Change of the coordinate per unit of the value.
    pub k: f64,
    /// Smallest value.
    pub min: f64,
    /// Largest value.
    pub max: f64,
    /// `[value, coordinate]` pairs along the range (ascending values; the
    /// current value included; empty for angles): a drag inverts this
    /// piecewise-linear curve, which is exact where the definition pins
    /// or bends the handle's path. Huge ranges are sampled near 0 and
    /// extrapolated with `base`/`k`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<[f64; 2]>>"))]
    pub samples: Vec<[f64; 2]>,
}

/// An adjust handle of a preset (`a:ahXY` / `a:ahPolar`), PowerPoint's
/// yellow diamond, in the shape's box (EMU, unflipped, unrotated).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct AdjustHandle {
    /// Where the handle sits for the current adjust values.
    pub x: f64,
    /// Where the handle sits.
    pub y: f64,
    /// A polar handle: `x_axis` is the distance from the box centre,
    /// `y_axis` the angle around it.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub polar: bool,
    /// What a horizontal drag changes (polar: the radius).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub x_axis: Option<HandleAxis>,
    /// What a vertical drag changes (polar: the angle).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub y_axis: Option<HandleAxis>,
}

fn is_false(v: &bool) -> bool {
    !*v
}

/// The text rectangle of a preset (`a:rect`) in the shape's box.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TextRect {
    /// Left edge.
    pub l: f64,
    /// Top edge.
    pub t: f64,
    /// Right edge.
    pub r: f64,
    /// Bottom edge.
    pub b: f64,
}

/// Counts the identifiers given to it.
macro_rules! count {
    () => { 0usize };
    ($head:ident $($tail:ident)*) => { 1usize + count!($($tail)*) };
}

/// Declares [`Preset`] with its named variants, their DrawingML names and
/// PowerPoint's default shape names.
macro_rules! presets {
    ($( $(#[$doc:meta])* $v:ident = $prst:literal, $name:literal; )*) => {
        /// Preset geometry of an auto shape (`a:prstGeom/@prst`), or a
        /// custom geometry (`a:custGeom`). Outlines, adjust values and
        /// their handles, connection sites and text rectangles follow
        /// ECMA-376's preset shape definitions (see [`crate::presets`]).
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
            $( $(#[$doc])* $v, )*
            /// A custom geometry (`a:custGeom`): its paths, each scaled to the box.
            #[serde(rename_all = "camelCase")]
            Custom {
                /// The paths, bottom to top.
                paths: Vec<GeomPath>,
            },
        }

        impl Preset {
            /// Every named preset (all but [`Custom`](Self::Custom)), in
            /// declaration order.
            pub const ALL: [Preset; count!($($v)*)] = [ $( Preset::$v, )* ];

            /// The DrawingML `prst` name (`"custom"` for a custom geometry,
            /// which is written as `a:custGeom`).
            pub fn prst(&self) -> &'static str {
                match self {
                    $( Preset::$v => $prst, )*
                    Preset::Custom { .. } => "custom",
                }
            }

            /// PowerPoint's default shape name for this geometry
            /// (`"Rounded Rectangle"`; the full name appends the shape
            /// number).
            pub fn default_name(&self) -> &'static str {
                match self {
                    $( Preset::$v => $name, )*
                    Preset::Custom { .. } => "Freeform",
                }
            }
        }
    };
}

presets! {
    /// Rectangle (`rect`); also text boxes and placeholders.
    Rect = "rect", "Rectangle";
    /// Rounded rectangle (`roundRect`; `adj` = corner radius, 1/100000 of the shorter side).
    RoundRect = "roundRect", "Rounded Rectangle";
    /// Rectangle with one snipped corner (`snip1Rect`).
    Snip1Rect = "snip1Rect", "Snip Single Corner Rectangle";
    /// Rectangle with the two top corners snipped (`snip2SameRect`).
    Snip2SameRect = "snip2SameRect", "Snip Same Side Corner Rectangle";
    /// Rectangle with one rounded corner (`round1Rect`).
    Round1Rect = "round1Rect", "Round Single Corner Rectangle";
    /// Rectangle with the two top corners rounded (`round2SameRect`).
    Round2SameRect = "round2SameRect", "Round Same Side Corner Rectangle";
    /// Ellipse (`ellipse`).
    Ellipse = "ellipse", "Oval";
    /// Isosceles triangle (`triangle`; `adj` = apex position).
    Triangle = "triangle", "Isosceles Triangle";
    /// Right triangle (`rtTriangle`).
    RtTriangle = "rtTriangle", "Right Triangle";
    /// Diamond (`diamond`).
    Diamond = "diamond", "Diamond";
    /// Regular pentagon (`pentagon`).
    Pentagon = "pentagon", "Regular Pentagon";
    /// Hexagon (`hexagon`).
    Hexagon = "hexagon", "Hexagon";
    /// Octagon (`octagon`).
    Octagon = "octagon", "Octagon";
    /// Parallelogram (`parallelogram`).
    Parallelogram = "parallelogram", "Parallelogram";
    /// Trapezoid, wide at the bottom (`trapezoid`).
    Trapezoid = "trapezoid", "Trapezoid";
    /// Heart (`heart`).
    Heart = "heart", "Heart";
    /// Cloud (`cloud`; the inner arcs are a stroke-only path).
    Cloud = "cloud", "Cloud";
    /// Right block arrow (`rightArrow`).
    RightArrow = "rightArrow", "Right Arrow";
    /// Left block arrow (`leftArrow`).
    LeftArrow = "leftArrow", "Left Arrow";
    /// Up block arrow (`upArrow`).
    UpArrow = "upArrow", "Up Arrow";
    /// Down block arrow (`downArrow`).
    DownArrow = "downArrow", "Down Arrow";
    /// Left-right block arrow (`leftRightArrow`).
    LeftRightArrow = "leftRightArrow", "Left-Right Arrow";
    /// Up-down block arrow (`upDownArrow`).
    UpDownArrow = "upDownArrow", "Up-Down Arrow";
    /// Chevron (`chevron`).
    Chevron = "chevron", "Chevron";
    /// Pentagon arrow (`homePlate`).
    HomePlate = "homePlate", "Pentagon";
    /// 4-point star (`star4`).
    Star4 = "star4", "4-Point Star";
    /// 5-point star (`star5`).
    Star5 = "star5", "5-Point Star";
    /// 6-point star (`star6`).
    Star6 = "star6", "6-Point Star";
    /// 8-point star (`star8`).
    Star8 = "star8", "8-Point Star";
    /// Rectangular callout (`wedgeRectCallout`; `adj1`/`adj2` = tail tip).
    WedgeRectCallout = "wedgeRectCallout", "Rectangular Callout";
    /// Rounded rectangular callout (`wedgeRoundRectCallout`).
    WedgeRoundRectCallout = "wedgeRoundRectCallout", "Rounded Rectangular Callout";
    /// Oval callout (`wedgeEllipseCallout`).
    WedgeEllipseCallout = "wedgeEllipseCallout", "Oval Callout";
    /// Flowchart process (`flowChartProcess`).
    FlowChartProcess = "flowChartProcess", "Flowchart: Process";
    /// Flowchart decision (`flowChartDecision`).
    FlowChartDecision = "flowChartDecision", "Flowchart: Decision";
    /// Flowchart terminator (`flowChartTerminator`).
    FlowChartTerminator = "flowChartTerminator", "Flowchart: Terminator";
    /// Flowchart document (`flowChartDocument`).
    FlowChartDocument = "flowChartDocument", "Flowchart: Document";
    /// Flowchart connector, a circle (`flowChartConnector`).
    FlowChartConnector = "flowChartConnector", "Flowchart: Connector";
    /// Flowchart data (`flowChartInputOutput`).
    FlowChartInputOutput = "flowChartInputOutput", "Flowchart: Data";
    /// Straight line from the top-left to the bottom-right corner of the box (`line`; flips select the other diagonals).
    Line = "line", "Straight Connector";
    /// Action button (`actionButtonBlank`).
    ActionButtonBlank = "actionButtonBlank", "Action Button: Blank";
    /// Action button (`actionButtonHome`).
    ActionButtonHome = "actionButtonHome", "Action Button: Go Home";
    /// Action button (`actionButtonHelp`).
    ActionButtonHelp = "actionButtonHelp", "Action Button: Help";
    /// Action button (`actionButtonInformation`).
    ActionButtonInformation = "actionButtonInformation", "Action Button: Get Information";
    /// Action button (`actionButtonBackPrevious`).
    ActionButtonBackPrevious = "actionButtonBackPrevious", "Action Button: Go Back or Previous";
    /// Action button (`actionButtonForwardNext`).
    ActionButtonForwardNext = "actionButtonForwardNext", "Action Button: Go Forward or Next";
    /// Action button (`actionButtonBeginning`).
    ActionButtonBeginning = "actionButtonBeginning", "Action Button: Go to Beginning";
    /// Action button (`actionButtonEnd`).
    ActionButtonEnd = "actionButtonEnd", "Action Button: Go to End";
    /// Action button (`actionButtonReturn`).
    ActionButtonReturn = "actionButtonReturn", "Action Button: Return";
    /// Action button (`actionButtonDocument`).
    ActionButtonDocument = "actionButtonDocument", "Action Button: Document";
    /// Action button (`actionButtonSound`).
    ActionButtonSound = "actionButtonSound", "Action Button: Sound";
    /// Action button (`actionButtonMovie`).
    ActionButtonMovie = "actionButtonMovie", "Action Button: Video";
    /// Bent arrow (`bentArrow`).
    BentArrow = "bentArrow", "Bent Arrow";
    /// U-turn arrow (`uturnArrow`).
    UturnArrow = "uturnArrow", "U-Turn Arrow";
    /// Left-right-up arrow (`leftRightUpArrow`).
    LeftRightUpArrow = "leftRightUpArrow", "Left-Right-Up Arrow";
    /// Quad arrow (`quadArrow`).
    QuadArrow = "quadArrow", "Quad Arrow";
    /// Ribbon tilted down (`ribbon`).
    Ribbon = "ribbon", "Down Ribbon";
    /// Ribbon tilted up (`ribbon2`).
    Ribbon2 = "ribbon2", "Up Ribbon";
    /// Wave (`wave`).
    Wave = "wave", "Wave";
    /// Double wave (`doubleWave`).
    DoubleWave = "doubleWave", "Double Wave";
    /// Cross (`plus`).
    Plus = "plus", "Cross";
    /// Plus sign (`mathPlus`).
    MathPlus = "mathPlus", "Plus";
    /// Minus sign (`mathMinus`).
    MathMinus = "mathMinus", "Minus";
    /// Multiplication sign (`mathMultiply`).
    MathMultiply = "mathMultiply", "Multiply";
    /// Division sign (`mathDivide`).
    MathDivide = "mathDivide", "Division";
    /// Equal sign (`mathEqual`).
    MathEqual = "mathEqual", "Equal";
    /// Not-equal sign (`mathNotEqual`).
    MathNotEqual = "mathNotEqual", "Not Equal";
    /// Frame (`frame`).
    Frame = "frame", "Frame";
    /// Half frame (`halfFrame`).
    HalfFrame = "halfFrame", "Half Frame";
    /// L-shape (`corner`).
    Corner = "corner", "L-Shape";
    /// Diagonal stripe (`diagStripe`).
    DiagStripe = "diagStripe", "Diagonal Stripe";
    /// Chord (`chord`).
    Chord = "chord", "Chord";
    /// Teardrop (`teardrop`).
    Teardrop = "teardrop", "Teardrop";
    /// Pie (`pie`).
    Pie = "pie", "Pie";
    /// Block arc (`blockArc`).
    BlockArc = "blockArc", "Block Arc";
    /// Donut (`donut`).
    Donut = "donut", "Donut";
    /// "No" symbol (`noSmoking`).
    NoSmoking = "noSmoking", "\"No\" Symbol";
    /// Folded corner (`foldedCorner`).
    FoldedCorner = "foldedCorner", "Folded Corner";
    /// Bevel (`bevel`).
    Bevel = "bevel", "Bevel";
    /// Cube (`cube`).
    Cube = "cube", "Cube";
    /// Can, a cylinder (`can`).
    Can = "can", "Can";
    /// Lightning bolt (`lightningBolt`).
    LightningBolt = "lightningBolt", "Lightning Bolt";
    /// Sun (`sun`).
    Sun = "sun", "Sun";
    /// Moon (`moon`).
    Moon = "moon", "Moon";
    /// Smiley face (`smileyFace`).
    SmileyFace = "smileyFace", "Smiley Face";
    /// Cloud callout (`cloudCallout`).
    CloudCallout = "cloudCallout", "Cloud Callout";
    /// Line callout with one segment (`borderCallout1`).
    BorderCallout1 = "borderCallout1", "Line Callout 1";
    /// Line callout with two segments (`borderCallout2`).
    BorderCallout2 = "borderCallout2", "Line Callout 2";
    /// Flowchart alternate process (`flowChartAlternateProcess`).
    FlowChartAlternateProcess = "flowChartAlternateProcess", "Flowchart: Alternate Process";
    /// Flowchart predefined process (`flowChartPredefinedProcess`).
    FlowChartPredefinedProcess = "flowChartPredefinedProcess", "Flowchart: Predefined Process";
    /// Flowchart internal storage (`flowChartInternalStorage`).
    FlowChartInternalStorage = "flowChartInternalStorage", "Flowchart: Internal Storage";
    /// Flowchart multidocument (`flowChartMultidocument`).
    FlowChartMultidocument = "flowChartMultidocument", "Flowchart: Multidocument";
    /// Flowchart preparation (`flowChartPreparation`).
    FlowChartPreparation = "flowChartPreparation", "Flowchart: Preparation";
    /// Flowchart manual input (`flowChartManualInput`).
    FlowChartManualInput = "flowChartManualInput", "Flowchart: Manual Input";
    /// Flowchart manual operation (`flowChartManualOperation`).
    FlowChartManualOperation = "flowChartManualOperation", "Flowchart: Manual Operation";
    /// Flowchart off-page connector (`flowChartOffpageConnector`).
    FlowChartOffpageConnector = "flowChartOffpageConnector", "Flowchart: Off-page Connector";
    /// Flowchart card (`flowChartPunchedCard`).
    FlowChartPunchedCard = "flowChartPunchedCard", "Flowchart: Card";
    /// Flowchart punched tape (`flowChartPunchedTape`).
    FlowChartPunchedTape = "flowChartPunchedTape", "Flowchart: Punched Tape";
    /// Flowchart summing junction (`flowChartSummingJunction`).
    FlowChartSummingJunction = "flowChartSummingJunction", "Flowchart: Summing Junction";
    /// Flowchart or (`flowChartOr`).
    FlowChartOr = "flowChartOr", "Flowchart: Or";
    /// Flowchart collate (`flowChartCollate`).
    FlowChartCollate = "flowChartCollate", "Flowchart: Collate";
    /// Flowchart sort (`flowChartSort`).
    FlowChartSort = "flowChartSort", "Flowchart: Sort";
    /// Flowchart extract (`flowChartExtract`).
    FlowChartExtract = "flowChartExtract", "Flowchart: Extract";
    /// Flowchart merge (`flowChartMerge`).
    FlowChartMerge = "flowChartMerge", "Flowchart: Merge";
    /// Flowchart stored data (`flowChartOnlineStorage`).
    FlowChartOnlineStorage = "flowChartOnlineStorage", "Flowchart: Stored Data";
    /// Flowchart delay (`flowChartDelay`).
    FlowChartDelay = "flowChartDelay", "Flowchart: Delay";
    /// Flowchart sequential access storage (`flowChartMagneticTape`).
    FlowChartMagneticTape = "flowChartMagneticTape", "Flowchart: Sequential Access Storage";
    /// Flowchart magnetic disk, the database cylinder (`flowChartMagneticDisk`).
    FlowChartMagneticDisk = "flowChartMagneticDisk", "Flowchart: Magnetic Disk";
    /// Flowchart direct access storage (`flowChartMagneticDrum`).
    FlowChartMagneticDrum = "flowChartMagneticDrum", "Flowchart: Direct Access Storage";
    /// Flowchart display (`flowChartDisplay`).
    FlowChartDisplay = "flowChartDisplay", "Flowchart: Display";
    /// Flowchart offline storage (`flowChartOfflineStorage`).
    FlowChartOfflineStorage = "flowChartOfflineStorage", "Flowchart: Offline Storage";
}

impl Preset {
    /// The twelve action buttons, in PowerPoint's gallery order.
    pub const ACTION_BUTTONS: [Preset; 12] = [
        Preset::ActionButtonBackPrevious,
        Preset::ActionButtonForwardNext,
        Preset::ActionButtonBeginning,
        Preset::ActionButtonEnd,
        Preset::ActionButtonHome,
        Preset::ActionButtonInformation,
        Preset::ActionButtonReturn,
        Preset::ActionButtonMovie,
        Preset::ActionButtonDocument,
        Preset::ActionButtonSound,
        Preset::ActionButtonHelp,
        Preset::ActionButtonBlank,
    ];

    /// Whether this is one of the `actionButton*` presets.
    pub fn is_action_button(&self) -> bool {
        Preset::ACTION_BUTTONS.contains(self)
    }

    /// The click action PowerPoint gives a new action button of this
    /// preset (Home and Beginning: first slide, End: last, Back/Forward:
    /// previous/next, Return: last slide viewed; the others: none).
    pub fn default_action(&self) -> Option<crate::link::Action> {
        use crate::link::{Hyperlink, SlideRef};
        let to = match self {
            Preset::ActionButtonHome | Preset::ActionButtonBeginning => SlideRef::First,
            Preset::ActionButtonEnd => SlideRef::Last,
            Preset::ActionButtonBackPrevious => SlideRef::Previous,
            Preset::ActionButtonForwardNext => SlideRef::Next,
            Preset::ActionButtonReturn => SlideRef::LastViewed,
            _ => return None,
        };
        Some(Hyperlink::slide(to))
    }

    /// The preset with DrawingML name `prst` (`straightConnector1` is a
    /// line), if we support it.
    pub fn from_prst(prst: &str) -> Option<Preset> {
        if prst == "straightConnector1" {
            return Some(Preset::Line);
        }
        Preset::ALL.into_iter().find(|p| p.prst() == prst)
    }

    /// The ECMA-376 definition of a named preset (`None` for lines and
    /// custom geometry).
    fn def(&self) -> Option<&'static crate::presets::Def> {
        match self {
            Preset::Line | Preset::Custom { .. } => None,
            p => crate::presets::def(p.prst()),
        }
    }

    /// The adjust values this preset understands, with their defaults
    /// (ECMA-376 `presetShapeDefinitions.xml` `a:avLst`).
    pub fn adjust_defaults(&self) -> &'static [(&'static str, i64)] {
        self.def().map_or(&[], |d| d.av.as_slice())
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
    /// ones take the defaults; values are pinned as the definitions pin
    /// them). Paths with `fill="none"` (the cloud's inner arcs, the
    /// can's rim) are stroked only; action button icons are filled
    /// darker (`darken`).
    pub fn paths(&self, w: f64, h: f64, adj: &Adjust) -> Vec<SubPath> {
        match self {
            Preset::Custom { paths } => paths
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
                        darken: 0.0,
                    }
                })
                .collect(),
            Preset::Line => {
                let mut b = Builder::new(1.0, 1.0);
                b.m(0.0, 0.0);
                b.l(w, h);
                vec![SubPath::stroked(b.cmds)]
            }
            p => match p.def() {
                Some(d) => crate::presets::paths(d, w, h, adj),
                None => Preset::Rect.paths(w, h, adj),
            },
        }
    }

    /// The connection sites of the shape in a `w` × `h` box, in
    /// PowerPoint's order (the `idx` of `a:stCxn`; ECMA-376 `a:cxnLst`),
    /// plus the box centre as the last site. Custom geometry uses the
    /// rectangle's; a line its two ends.
    pub fn connection_sites(&self, w: f64, h: f64, adj: &Adjust) -> Vec<Site> {
        let site = |x: f64, y: f64, angle_deg: f64| Site { x, y, angle_deg };
        let mut out = match self {
            Preset::Line => vec![site(0.0, 0.0, 180.0), site(w, h, 0.0)],
            p => match p.def().or_else(|| Preset::Rect.def()) {
                Some(d) => crate::presets::sites(d, w, h, adj),
                None => Vec::new(),
            },
        };
        out.push(site(w / 2.0, h / 2.0, 0.0));
        out
    }

    /// The rectangle text is laid out in (`a:rect`; the box for lines,
    /// custom geometry and presets without one).
    pub fn text_rect(&self, w: f64, h: f64, adj: &Adjust) -> TextRect {
        let [l, t, r, b] = match self.def() {
            Some(d) => crate::presets::text_rect(d, w, h, adj),
            None => [0.0, 0.0, w, h],
        };
        TextRect { l, t, r, b }
    }

    /// The adjust handles of the shape in a `w` × `h` box with `adj`
    /// (`a:ahLst`; none for presets without adjust values).
    pub fn handles(&self, w: f64, h: f64, adj: &Adjust) -> Vec<AdjustHandle> {
        let Some(d) = self.def() else {
            return Vec::new();
        };
        let axis = |a: Option<crate::presets::Axis>| {
            a.map(|a| HandleAxis {
                adj: a.adj.to_owned(),
                base: a.base,
                k: a.k,
                min: a.min,
                max: a.max,
                samples: a.samples.iter().map(|&(v, c)| [v, c]).collect(),
            })
        };
        crate::presets::handles(d, w, h, adj)
            .into_iter()
            .map(|r| AdjustHandle {
                x: r.x,
                y: r.y,
                polar: r.polar,
                x_axis: axis(r.a),
                y_axis: axis(r.b),
            })
            .collect()
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
    pub(crate) fn points(self, turns: u8, w: f64, h: f64, adj: &Adjust) -> Vec<(f64, f64)> {
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
pub(crate) struct Builder {
    sx: f64,
    sy: f64,
    pub(crate) cmds: Vec<PathCmd>,
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
    pub(crate) fn new(sx: f64, sy: f64) -> Self {
        Builder {
            sx,
            sy,
            cmds: Vec::new(),
            cur: (0.0, 0.0),
            start: (0.0, 0.0),
        }
    }

    pub(crate) fn m(&mut self, x: f64, y: f64) {
        self.cur = (x, y);
        self.start = (x, y);
        self.cmds.push(PathCmd::MoveTo {
            x: x * self.sx,
            y: y * self.sy,
        });
    }

    pub(crate) fn l(&mut self, x: f64, y: f64) {
        self.cur = (x, y);
        self.cmds.push(PathCmd::LineTo {
            x: x * self.sx,
            y: y * self.sy,
        });
    }

    pub(crate) fn c(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, x: f64, y: f64) {
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

    pub(crate) fn q(&mut self, x1: f64, y1: f64, x: f64, y: f64) {
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
    pub(crate) fn a(&mut self, wr: f64, hr: f64, start_deg: f64, sweep_deg: f64) {
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

    pub(crate) fn z(&mut self) {
        self.cur = self.start;
        self.cmds.push(PathCmd::Close);
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
        assert_eq!(Preset::from_prst("gear6"), None);
        assert_eq!(Preset::from_prst("uturnArrow"), Some(Preset::UturnArrow));
        assert_eq!(Preset::ALL.len(), 110);
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
    fn action_buttons() {
        use crate::link::{Hyperlink, SlideRef};
        assert_eq!(Preset::ACTION_BUTTONS.len(), 12);
        for p in Preset::ACTION_BUTTONS {
            assert!(p.is_action_button());
            assert!(p.default_name().starts_with("Action Button: "));
            let paths = p.paths(W, H, &Adjust::new());
            if p == Preset::ActionButtonBlank {
                assert!(paths.len() == 1 && paths[0].fill && paths[0].stroke);
                continue;
            }
            // ECMA: the frame filled without outline first, the icon parts
            // filled darker / lighter, the outlines last
            assert!(paths[0].fill && !paths[0].stroke, "{p:?}");
            let last = paths.last().unwrap();
            assert!(!last.fill && last.stroke, "{p:?}");
            assert!(paths.iter().any(|sp| sp.darken != 0.0), "{p:?} has an icon");
        }
        assert_eq!(
            Preset::ActionButtonForwardNext.default_action(),
            Some(Hyperlink::slide(SlideRef::Next))
        );
        assert_eq!(
            Preset::ActionButtonReturn.default_action(),
            Some(Hyperlink::slide(SlideRef::LastViewed))
        );
        assert_eq!(Preset::ActionButtonHelp.default_action(), None);
        assert!(!Preset::Rect.is_action_button());
        let json = serde_json::to_string(&SubPath::filled(vec![])).unwrap();
        assert_eq!(json, r#"{"fill":true,"stroke":true,"commands":[]}"#);
    }

    #[test]
    fn every_preset_fills_its_box() {
        // Shapes whose outline touches all four sides of the box.
        for p in [
            Preset::Rect,
            Preset::RoundRect,
            Preset::Ellipse,
            Preset::Triangle,
            Preset::Diamond,
            Preset::Hexagon,
            Preset::RightArrow,
            Preset::UpDownArrow,
            Preset::Star4,
            Preset::Star6,
            Preset::FlowChartProcess,
            Preset::FlowChartTerminator,
            Preset::BentArrow,
            Preset::UturnArrow,
            Preset::QuadArrow,
            Preset::Plus,
            Preset::Frame,
            Preset::Can,
            Preset::Cube,
            Preset::Sun,
            Preset::SmileyFace,
            Preset::FlowChartMagneticDisk,
        ] {
            let (x0, y0, x1, y1) = bounds(&p, W, H);
            let tol = 2.0;
            assert!(near(x0, 0.0, tol) && near(y0, 0.0, tol), "{p:?} {x0} {y0}");
            assert!(near(x1, W, tol) && near(y1, H, tol), "{p:?} {x1} {y1}");
        }
    }

    /// Bounding box, text rectangle, handles and sites of every preset in
    /// two boxes and with adjusted values.
    #[test]
    fn preset_data_sanity() {
        // presets whose outline may leave the box (tails, leaders)
        let tails = [
            Preset::WedgeRectCallout,
            Preset::WedgeRoundRectCallout,
            Preset::WedgeEllipseCallout,
            Preset::CloudCallout,
            Preset::BorderCallout1,
            Preset::BorderCallout2,
            // the slash keeps its angle in narrow boxes
            Preset::MathNotEqual,
        ];
        for (w, h) in [(W, H), (400_000.0, 900_000.0)] {
            for p in Preset::ALL {
                let adj = Adjust::new();
                let (x0, y0, x1, y1) = bounds(&p, w, h);
                if !tails.contains(&p) {
                    let (tx, ty) = (w * 0.01, h * 0.02);
                    assert!(x0 >= -tx && y0 >= -ty, "{p:?} {x0} {y0}");
                    assert!(x1 <= w + tx && y1 <= h + ty, "{p:?} {x1} {y1}");
                }
                assert!(
                    (x1 - x0) > w * 0.3 || (y1 - y0) > h * 0.3,
                    "{p:?} is tiny: {x0} {y0} {x1} {y1}"
                );
                let r = p.text_rect(w, h, &adj);
                assert!(r.l <= r.r && r.t <= r.b, "{p:?} {r:?}");
                assert!(
                    r.l >= -1.0 && r.t >= -1.0 && r.r <= w + 1.0 && r.b <= h + 1.0,
                    "{p:?} text rect {r:?} outside the box"
                );
                let sites = p.connection_sites(w, h, &adj);
                assert!(sites.len() >= 2, "{p:?}");
                for s in &sites {
                    assert!(s.x.is_finite() && s.y.is_finite(), "{p:?}");
                    assert!((0.0..360.0).contains(&s.angle_deg), "{p:?} {s:?}");
                }
                let names: Vec<&str> = p.adjust_defaults().iter().map(|d| d.0).collect();
                let handles = p.handles(w, h, &adj);
                for hd in &handles {
                    assert!(hd.x.is_finite() && hd.y.is_finite(), "{p:?}");
                    assert!(hd.x_axis.is_some() || hd.y_axis.is_some(), "{p:?}");
                    for a in hd.x_axis.iter().chain(hd.y_axis.iter()) {
                        assert!(names.contains(&a.adj.as_str()), "{p:?} {}", a.adj);
                        assert!(a.min <= a.max, "{p:?} {a:?}");
                    }
                    // linear XY handles: the model gives the position
                    if !hd.polar {
                        for (a, pos) in [(&hd.x_axis, hd.x), (&hd.y_axis, hd.y)] {
                            if let Some(a) = a {
                                let v = adj_value(&p, &a.adj);
                                if v >= a.min && v <= a.max {
                                    let want = a.base + a.k * v;
                                    let s = a.samples.iter().find(|s| (s[0] - v).abs() < 1.0);
                                    assert!(
                                        s.is_some_and(|s| (s[1] - pos).abs() < 1.0),
                                        "{p:?} {}",
                                        a.adj
                                    );
                                    assert!(
                                        (want - pos).abs() <= w.max(h) * 0.02,
                                        "{p:?} {} at {v}: {want} vs {pos}",
                                        a.adj
                                    );
                                }
                            }
                        }
                    }
                }
                // every preset with an adjust value but `hf`/`vf` has a handle
                if names.iter().any(|n| n.starts_with("adj")) {
                    assert!(!handles.is_empty(), "{p:?} has no handles");
                }
            }
        }
        // a drag along a handle's axis changes the outline
        let h = &Preset::UturnArrow.handles(W, H, &Adjust::new())[0];
        let a = h.x_axis.as_ref().or(h.y_axis.as_ref()).unwrap();
        let moved: Adjust = [(a.adj.clone(), (a.min + (a.max - a.min) / 3.0) as i64)].into();
        assert_ne!(
            Preset::UturnArrow.path(W, H, &moved),
            Preset::UturnArrow.path(W, H, &Adjust::new())
        );
        // polar handles turn around the centre: pie's start angle
        let pie = Preset::Pie.handles(W, H, &Adjust::new());
        assert!(pie[0].polar);
        let ang = pie[0].y_axis.as_ref().unwrap();
        assert_eq!((ang.adj.as_str(), ang.k), ("adj1", 1.0));
    }

    fn adj_value(p: &Preset, name: &str) -> f64 {
        p.adjust_defaults()
            .iter()
            .find(|d| d.0 == name)
            .map_or(0.0, |d| d.1 as f64)
    }

    #[test]
    fn text_rects_and_inner_strokes() {
        let none = Adjust::new();
        // ellipse: the inscribed rectangle of ECMA's `a:rect`
        let r = Preset::Ellipse.text_rect(W, H, &none);
        assert!(near(r.l, W * (1.0 - 0.5f64.sqrt()) / 2.0, 1.0), "{r:?}");
        // right arrow: the shaft
        let r = Preset::RightArrow.text_rect(W, H, &none);
        assert_eq!((r.t, r.b), (150_000.0, 450_000.0));
        // the cloud's inner arcs are a stroke-only path
        let cloud = Preset::Cloud.paths(W, H, &none);
        assert_eq!(cloud.len(), 2);
        assert!(!cloud[1].fill && cloud[1].stroke);
        // the can's top ellipse is drawn lighter
        assert!(Preset::Can
            .paths(W, H, &none)
            .iter()
            .any(|p| p.darken < 0.0));
        // site lists follow PowerPoint: the hexagon has six, the star five ten
        assert_eq!(Preset::Hexagon.connection_sites(W, H, &none).len(), 7);
        assert_eq!(Preset::Star5.connection_sites(W, H, &none).len(), 6);
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
