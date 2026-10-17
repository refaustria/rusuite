//! Charts shared by Calc and Show (P8-18): the format-agnostic chart
//! model, the resolved data a renderer draws, the Office series palette
//! and Excel's "recommended chart" for a selected range.
//!
//! The model follows DrawingML charts (`c:chartSpace`, ECMA-376 Part 1
//! §21.2) closely enough that Excel and PowerPoint files map onto it
//! without loss for the supported chart types; everything the UI needs
//! to render a chart is specified in `docs/charts.md`.
//!
//! Data is referenced by formula text ([`DataRef::Ref`], e.g.
//! `Sheet1!$B$2:$B$7`, exactly what OOXML stores in `c:f`): Calc resolves
//! it against its workbook (`model_sheet::Workbook::chart_data`), Show
//! against the chart's embedded workbook or the cached values.
//!
//! ```
//! use core_model::chart::{CellClass, Chart, ChartKind, DataRef};
//!
//! // A1:C4 with a header row and a category column.
//! let t = CellClass::Text;
//! let n = CellClass::Number;
//! let cells = vec![
//!     vec![CellClass::Empty, t, t],
//!     vec![t, n, n],
//!     vec![t, n, n],
//!     vec![t, n, n],
//! ];
//! let chart = Chart::from_range("Sheet1", 0, 0, &cells).unwrap();
//! assert!(matches!(chart.kind, ChartKind::Bar { .. }));
//! assert_eq!(chart.series.len(), 2);
//! assert_eq!(chart.series[0].values, DataRef::reference("Sheet1!$B$2:$B$4"));
//! assert_eq!(chart.categories, Some(DataRef::reference("Sheet1!$A$2:$A$4")));
//! ```

use serde::{Deserialize, Serialize};

use crate::color::{apply_tint, Color, ColorScheme, Rgb, ThemeColorSlot};

fn is_false(b: &bool) -> bool {
    !*b
}

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

fn default_style() -> u8 {
    2
}

fn is_default_style(s: &u8) -> bool {
    *s == 2
}

// --- data ----------------------------------------------------------------------

/// One data point: a number, a text or a blank. Serializes untagged
/// (`1.5`, `"Jan"`, `null`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChartValue {
    Number(f64),
    Text(String),
    Blank,
}

/// Where a series takes its values or categories from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DataRef {
    /// A reference formula without `=`, e.g. `Sheet1!$B$2:$B$7` or
    /// `'My data'!$A$1:$C$1` (one row or column; several areas in
    /// parentheses are kept but only resolved by Show's caches).
    /// `cache`: the values last stored in the file, used only when the
    /// reference cannot be resolved (e.g. an external workbook).
    Ref {
        formula: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache: Option<Vec<ChartValue>>,
    },
    /// Literal values (`c:numLit` / `c:strLit`).
    Literal { values: Vec<ChartValue> },
}

impl DataRef {
    /// A reference without cache.
    pub fn reference(formula: impl Into<String>) -> Self {
        DataRef::Ref {
            formula: formula.into(),
            cache: None,
        }
    }

    /// The reference formula, `None` for literals.
    pub fn formula(&self) -> Option<&str> {
        match self {
            DataRef::Ref { formula, .. } => Some(formula),
            DataRef::Literal { .. } => None,
        }
    }

    /// Mutable access to the reference formula (reference adjustment).
    pub fn formula_mut(&mut self) -> Option<&mut String> {
        match self {
            DataRef::Ref { formula, .. } => Some(formula),
            DataRef::Literal { .. } => None,
        }
    }
}

/// A text that is either typed in or taken from a cell (chart, axis and
/// series titles).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TextSource {
    /// Typed text (rich text in the file is flattened: paragraphs joined
    /// with `\n`, run formatting dropped).
    Literal { text: String },
    /// A cell reference formula (`Sheet1!$B$1`); `cache` as for
    /// [`DataRef::Ref`].
    Ref {
        formula: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache: Option<String>,
    },
}

impl TextSource {
    pub fn literal(text: impl Into<String>) -> Self {
        TextSource::Literal { text: text.into() }
    }

    pub fn reference(formula: impl Into<String>) -> Self {
        TextSource::Ref {
            formula: formula.into(),
            cache: None,
        }
    }

    pub fn formula(&self) -> Option<&str> {
        match self {
            TextSource::Ref { formula, .. } => Some(formula),
            TextSource::Literal { .. } => None,
        }
    }

    pub fn formula_mut(&mut self) -> Option<&mut String> {
        match self {
            TextSource::Ref { formula, .. } => Some(formula),
            TextSource::Literal { .. } => None,
        }
    }
}

/// A chart or axis title.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartTitle {
    /// `None` = automatic: for a chart title the name of the only series
    /// (Excel shows no automatic title for charts with several series),
    /// for an axis title `"Axis Title"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextSource>,
    /// Drawn over the plot area instead of taking space from it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub overlay: bool,
    /// Font of the title (`c:txPr` / the rich text's run properties).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_format: Option<TextFormat>,
    /// Position set by hand (`c:layout/c:manualLayout`); `None` = automatic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<ManualLayout>,
}

impl ChartTitle {
    pub fn literal(text: impl Into<String>) -> Self {
        ChartTitle {
            text: Some(TextSource::literal(text)),
            ..ChartTitle::default()
        }
    }
}

// --- chart kinds ---------------------------------------------------------------------

/// Column (vertical bars) or bar (horizontal bars).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BarDirection {
    Column,
    Bar,
}

/// How the series of a bar, line or area chart combine. Bars use
/// `Clustered`, `Stacked` or `PercentStacked`; lines and areas
/// `Standard`, `Stacked` or `PercentStacked`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Grouping {
    Standard,
    Clustered,
    Stacked,
    PercentStacked,
}

impl Grouping {
    pub fn is_stacked(self) -> bool {
        matches!(self, Grouping::Stacked | Grouping::PercentStacked)
    }
}

/// The scatter variants of Excel's "Insert Scatter" menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScatterStyle {
    /// Markers only.
    Marker,
    /// Straight lines with markers.
    LineMarker,
    /// Straight lines without markers.
    Line,
    /// Smooth lines with markers.
    SmoothMarker,
    /// Smooth lines without markers.
    Smooth,
}

impl ScatterStyle {
    pub fn has_lines(self) -> bool {
        !matches!(self, ScatterStyle::Marker)
    }

    pub fn has_markers(self) -> bool {
        matches!(
            self,
            ScatterStyle::Marker | ScatterStyle::LineMarker | ScatterStyle::SmoothMarker
        )
    }

    pub fn is_smooth(self) -> bool {
        matches!(self, ScatterStyle::SmoothMarker | ScatterStyle::Smooth)
    }

    /// The variant with these properties (`lines == false` is markers
    /// only, whatever the other flags say).
    pub fn from_parts(lines: bool, markers: bool, smooth: bool) -> Self {
        match (lines, markers, smooth) {
            (false, _, _) => ScatterStyle::Marker,
            (true, true, false) => ScatterStyle::LineMarker,
            (true, false, false) => ScatterStyle::Line,
            (true, true, true) => ScatterStyle::SmoothMarker,
            (true, false, true) => ScatterStyle::Smooth,
        }
    }
}

/// The chart type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ChartKind {
    Bar {
        direction: BarDirection,
        grouping: Grouping,
    },
    Line {
        grouping: Grouping,
        /// Markers on the data points ("Line with Markers").
        markers: bool,
    },
    Area {
        grouping: Grouping,
    },
    Pie,
    Doughnut,
    Scatter {
        style: ScatterStyle,
    },
    /// Several chart types in one plot area: every series carries its own
    /// [`Series::kind`] (never `Combo`) and [`Series::axis`].
    Combo,
    /// A chart type Rusuite does not model (radar, stock, bubble,
    /// surface, 3-D, pie of pie, …): read-only, kept as the original
    /// `c:chartSpace` XML and written back verbatim. `kind` is the
    /// element name of the first chart group (`radarChart`, `bar3DChart`).
    Unsupported {
        kind: String,
        xml: String,
    },
}

impl ChartKind {
    /// Excel's default chart: clustered column.
    pub fn column() -> Self {
        ChartKind::Bar {
            direction: BarDirection::Column,
            grouping: Grouping::Clustered,
        }
    }

    /// Pie and doughnut charts have no axes.
    pub fn has_axes(&self) -> bool {
        !matches!(
            self,
            ChartKind::Pie | ChartKind::Doughnut | ChartKind::Unsupported { .. }
        )
    }
}

/// Primary or secondary value axis of a series.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AxisGroup {
    #[default]
    Primary,
    Secondary,
}

impl AxisGroup {
    fn is_primary(&self) -> bool {
        *self == AxisGroup::Primary
    }
}

// --- formatting ------------------------------------------------------------------------

/// A shape fill (`c:spPr` / `a:noFill`, `a:solidFill`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Fill {
    None,
    Solid { color: Color },
}

/// DrawingML preset dash names (`a:prstDash/@val`, which is also the
/// serialized form).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineDash {
    Solid,
    Dot,
    Dash,
    LgDash,
    DashDot,
    LgDashDot,
    LgDashDotDot,
    SysDash,
    SysDot,
    SysDashDot,
    SysDashDotDot,
}

impl LineDash {
    pub const ALL: [LineDash; 11] = [
        LineDash::Solid,
        LineDash::Dot,
        LineDash::Dash,
        LineDash::LgDash,
        LineDash::DashDot,
        LineDash::LgDashDot,
        LineDash::LgDashDotDot,
        LineDash::SysDash,
        LineDash::SysDot,
        LineDash::SysDashDot,
        LineDash::SysDashDotDot,
    ];

    /// The `a:prstDash` value.
    pub fn name(self) -> &'static str {
        match self {
            LineDash::Solid => "solid",
            LineDash::Dot => "dot",
            LineDash::Dash => "dash",
            LineDash::LgDash => "lgDash",
            LineDash::DashDot => "dashDot",
            LineDash::LgDashDot => "lgDashDot",
            LineDash::LgDashDotDot => "lgDashDotDot",
            LineDash::SysDash => "sysDash",
            LineDash::SysDot => "sysDot",
            LineDash::SysDashDot => "sysDashDot",
            LineDash::SysDashDotDot => "sysDashDotDot",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.name() == name)
    }
}

/// A line or outline (`a:ln`). Absent fields come from the chart style.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineFormat {
    /// No line at all (`a:noFill`); the other fields are then ignored.
    #[serde(default, skip_serializing_if = "is_false")]
    pub none: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// Width in EMU (12 700 per point).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<LineDash>,
}

impl LineFormat {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// No line.
    pub fn hidden() -> Self {
        LineFormat {
            none: true,
            ..Self::default()
        }
    }
}

/// Marker shapes (`c:symbol/@val`, also the serialized form).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkerSymbol {
    None,
    Auto,
    Circle,
    Dash,
    Diamond,
    Dot,
    Plus,
    Square,
    Star,
    Triangle,
    X,
}

impl MarkerSymbol {
    pub const ALL: [MarkerSymbol; 11] = [
        MarkerSymbol::None,
        MarkerSymbol::Auto,
        MarkerSymbol::Circle,
        MarkerSymbol::Dash,
        MarkerSymbol::Diamond,
        MarkerSymbol::Dot,
        MarkerSymbol::Plus,
        MarkerSymbol::Square,
        MarkerSymbol::Star,
        MarkerSymbol::Triangle,
        MarkerSymbol::X,
    ];

    pub fn name(self) -> &'static str {
        match self {
            MarkerSymbol::None => "none",
            MarkerSymbol::Auto => "auto",
            MarkerSymbol::Circle => "circle",
            MarkerSymbol::Dash => "dash",
            MarkerSymbol::Diamond => "diamond",
            MarkerSymbol::Dot => "dot",
            MarkerSymbol::Plus => "plus",
            MarkerSymbol::Square => "square",
            MarkerSymbol::Star => "star",
            MarkerSymbol::Triangle => "triangle",
            MarkerSymbol::X => "x",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.name() == name)
    }
}

/// A data point marker (line and scatter charts).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub symbol: MarkerSymbol,
    /// Size in points, 2..=72 (Excel's default: 5; 7 since Office 2013).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
}

/// Formatting of a single data point (`c:dPt`), e.g. one pie slice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPoint {
    /// 0-based index of the point in the series.
    pub idx: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<Marker>,
}

/// A gradient stop: position 0..=1 along the gradient and its colour.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    pub pos: f64,
    pub color: Color,
}

/// The fill of the chart area or the plot area (`c:spPr`): none, solid,
/// a gradient or a picture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AreaFill {
    None,
    Solid {
        color: Color,
    },
    /// `a:gradFill`: linear at `angle` degrees (0 = left to right,
    /// clockwise, as `a:lin/@ang`), or radial from the centre (`a:path`).
    Gradient {
        stops: Vec<GradientStop>,
        #[serde(default)]
        angle: f64,
        #[serde(default, skip_serializing_if = "is_false")]
        radial: bool,
    },
    /// `a:blipFill` stretched over the area (or tiled).
    Picture {
        media: crate::Media,
        #[serde(default, skip_serializing_if = "is_false")]
        tile: bool,
    },
}

impl AreaFill {
    /// The colour a simple painter would use (the first gradient stop).
    pub fn main_color(&self) -> Option<Color> {
        match self {
            AreaFill::Solid { color } => Some(*color),
            AreaFill::Gradient { stops, .. } => stops.first().map(|s| s.color),
            _ => None,
        }
    }
}

/// Fill, outline and effects of a chart part (`c:spPr`). Absent fields
/// come from the chart style.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeFormat {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<AreaFill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
    /// Office's "Offset: Bottom Right" outer shadow (`a:outerShdw`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub shadow: bool,
}

impl ShapeFormat {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Text properties of a chart text (`c:txPr`, `a:defRPr` / `a:rPr`).
/// Absent fields come from the chart style (docs/charts.md).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFormat {
    /// Latin typeface (`a:latin/@typeface`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// Size in points (`@sz` / 100).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// Text rotation in degrees, −90..=90 (`a:bodyPr/@rot` / 60 000);
    /// negative = reading upwards. `None` = automatic (category labels
    /// turn to −45° when they would overlap, like Excel's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<i32>,
}

impl TextFormat {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// A position (and size) set by hand (`c:manualLayout`, `xMode`/`yMode`
/// `edge`): fractions 0..=1 of the chart area from its top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualLayout {
    pub x: f64,
    pub y: f64,
    /// Width and height; `None` = automatic size (titles, legends).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
}

/// Which way error bars point (`c:errDir`; only scatter charts have X
/// error bars).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorBarDirection {
    X,
    #[default]
    Y,
}

impl ErrorBarDirection {
    fn is_y(&self) -> bool {
        *self == ErrorBarDirection::Y
    }
}

/// Which side of the point error bars extend to (`c:errBarType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorBarType {
    #[default]
    Both,
    Plus,
    Minus,
}

/// The size of the error bars (`c:errValType`, `c:val`, `c:plus`/`c:minus`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ErrorAmount {
    /// The same amount for every point.
    Fixed { value: f64 },
    /// A percentage of each value.
    Percentage { value: f64 },
    /// `value` standard deviations of the series' values, around their mean.
    StdDev { value: f64 },
    /// The standard error of the series' values.
    StdErr,
    /// Per-point amounts from cells (or literals).
    Custom {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plus: Option<DataRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        minus: Option<DataRef>,
    },
}

/// Error bars of a series (`c:errBars`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBars {
    #[serde(default, skip_serializing_if = "ErrorBarDirection::is_y")]
    pub direction: ErrorBarDirection,
    #[serde(default)]
    pub bar_type: ErrorBarType,
    pub amount: ErrorAmount,
    /// No caps at the ends (`c:noEndCap`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub no_end_cap: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
}

/// A data table under the plot area (`c:dTable`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTable {
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub horizontal: bool,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub vertical: bool,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub outline: bool,
    /// Legend keys in front of the series names.
    #[serde(default, skip_serializing_if = "is_false")]
    pub keys: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_format: Option<TextFormat>,
}

impl Default for DataTable {
    fn default() -> Self {
        DataTable {
            horizontal: true,
            vertical: true,
            outline: true,
            keys: false,
            text_format: None,
        }
    }
}

/// Up/down bars of a line chart (`c:upDownBars`): between the first and
/// the last series per category.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpDownBars {
    /// Percent of a bar width (0..=500; `None` = 150).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<u16>,
    /// Bars where the last series is higher (default: white, dark outline).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub up: Option<ShapeFormat>,
    /// Bars where the last series is lower (default: dark).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub down: Option<ShapeFormat>,
}

/// The data label of one point (`c:dLbl`), overriding the series' labels.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointLabel {
    pub idx: u32,
    /// The point has no label (`c:delete`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub delete: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_value: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_percent: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_category: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_series: bool,
    /// The point's cell of [`DataLabels::range`].
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_range: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<LabelPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_format: Option<TextFormat>,
    /// Moved by hand (`c:layout`), fractions of the chart area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<ManualLayout>,
}

/// Where data labels sit (`c:dLblPos`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelPosition {
    BestFit,
    Bottom,
    Center,
    InsideBase,
    InsideEnd,
    Left,
    OutsideEnd,
    Right,
    Top,
}

impl LabelPosition {
    pub const ALL: [LabelPosition; 9] = [
        LabelPosition::BestFit,
        LabelPosition::Bottom,
        LabelPosition::Center,
        LabelPosition::InsideBase,
        LabelPosition::InsideEnd,
        LabelPosition::Left,
        LabelPosition::OutsideEnd,
        LabelPosition::Right,
        LabelPosition::Top,
    ];

    /// The `c:dLblPos/@val` value.
    pub fn ooxml_name(self) -> &'static str {
        match self {
            LabelPosition::BestFit => "bestFit",
            LabelPosition::Bottom => "b",
            LabelPosition::Center => "ctr",
            LabelPosition::InsideBase => "inBase",
            LabelPosition::InsideEnd => "inEnd",
            LabelPosition::Left => "l",
            LabelPosition::OutsideEnd => "outEnd",
            LabelPosition::Right => "r",
            LabelPosition::Top => "t",
        }
    }

    pub fn from_ooxml_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.ooxml_name() == name)
    }
}

/// Data labels (`c:dLbls`). All flags off = no labels.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLabels {
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_value: bool,
    /// Pie and doughnut only: the point's share of the series total.
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_percent: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_category: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_series: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_legend_key: bool,
    /// `None` = the chart type's default (bars: outside end; lines:
    /// right; pies: best fit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<LabelPosition>,
    /// Number format of the values; `None` = linked to the source cells.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// "Value From Cells": the label texts of the points, one cell per
    /// point (`c15:datalabelsRange`), shown with `show_range`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<DataRef>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub show_range: bool,
    /// Leader lines from labels moved away from their point (pies and,
    /// since Office 2013, every chart; `c:showLeaderLines`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub leader_lines: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_format: Option<TextFormat>,
    /// Labels of single points, by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<PointLabel>,
}

impl DataLabels {
    /// Whether no label part is shown (and no point has its own label).
    pub fn is_empty(&self) -> bool {
        !(self.show_value
            || self.show_percent
            || self.show_category
            || self.show_series
            || self.show_legend_key
            || self.show_range)
            && self.points.is_empty()
    }
}

/// A trendline type (`c:trendlineType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrendlineKind {
    Linear,
    Exponential,
    Logarithmic,
    Power,
    /// Order 2..=6.
    Polynomial {
        order: u8,
    },
    /// Period 2..=255.
    MovingAverage {
        period: u32,
    },
}

/// A series trendline (`c:trendline`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trendline {
    pub kind: TrendlineKind,
    /// Legend text; `None` = Excel's automatic name ("Linear (Sales)").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub display_equation: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub display_r_squared: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
}

// --- series --------------------------------------------------------------------------------

/// One data series.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    /// Legend text; `None` = `"Series<n>"` (1-based position).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<TextSource>,
    /// The values (`c:val`; scatter: the Y values, `c:yVal`).
    pub values: DataRef,
    /// The categories of this series (`c:cat`; scatter: the X values,
    /// `c:xVal`); `None` = [`Chart::categories`], and without those
    /// `1, 2, 3, …`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<DataRef>,
    /// The chart type of the series in a [`ChartKind::Combo`] chart;
    /// ignored otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ChartKind>,
    #[serde(default, skip_serializing_if = "AxisGroup::is_primary")]
    pub axis: AxisGroup,
    /// Bar/area/pie fill; `None` = the palette color (see
    /// [`palette_color`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    /// Line (line/scatter) or outline (bar/area/pie).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<Marker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_points: Vec<DataPoint>,
    /// Overrides [`Chart::data_labels`] for this series.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_labels: Option<DataLabels>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trendline: Option<Trendline>,
    /// Line/scatter: smoothed line; `None` = the chart kind's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smooth: Option<bool>,
    /// Error bars (at most one per direction; X only for scatter).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub error_bars: Vec<ErrorBars>,
}

impl Series {
    /// A series of `values` with everything else automatic.
    pub fn new(values: DataRef) -> Self {
        Series {
            name: None,
            values,
            categories: None,
            kind: None,
            axis: AxisGroup::Primary,
            fill: None,
            line: None,
            marker: None,
            data_points: Vec::new(),
            data_labels: None,
            trendline: None,
            smooth: None,
            error_bars: Vec::new(),
        }
    }
}

// --- axes, legend ----------------------------------------------------------------------------

/// Where the other axis crosses this one (`c:crosses` / `c:crossesAt`).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Crosses {
    /// At zero (value axes) or the first category.
    #[default]
    AutoZero,
    Min,
    Max,
    At {
        value: f64,
    },
}

impl Crosses {
    fn is_auto(&self) -> bool {
        *self == Crosses::AutoZero
    }
}

/// Tick label placement (`c:tickLblPos`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TickLabels {
    #[default]
    NextTo,
    High,
    Low,
    None,
}

impl TickLabels {
    fn is_next_to(&self) -> bool {
        *self == TickLabels::NextTo
    }
}

/// A category or value axis. For scatter charts the category axis is the
/// X value axis.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<ChartTitle>,
    /// Bounds and units; `None` = automatic (value axes only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub major_unit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minor_unit: Option<f64>,
    /// Tick label number format; `None` = linked to the source cells.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// Logarithmic scale with this base (2..=1000).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_base: Option<f64>,
    /// Values (or categories) in reverse order (`orientation maxMin`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub reverse: bool,
    #[serde(default, skip_serializing_if = "Crosses::is_auto")]
    pub crosses: Crosses,
    #[serde(default, skip_serializing_if = "is_false")]
    pub major_gridlines: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub minor_gridlines: bool,
    #[serde(default, skip_serializing_if = "TickLabels::is_next_to")]
    pub tick_labels: TickLabels,
    /// The axis is hidden (`c:delete`); its scale still applies.
    #[serde(default, skip_serializing_if = "is_false")]
    pub delete: bool,
    /// Font and rotation of the tick labels (`c:txPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_format: Option<TextFormat>,
    /// Axis line format (`c:spPr`); `None` = the style's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<LineFormat>,
}

impl Axis {
    /// Excel's default value axis: automatic scale with major gridlines.
    pub fn value() -> Self {
        Axis {
            major_gridlines: true,
            ..Axis::default()
        }
    }
}

/// The axes of a chart with axes (ignored for pie and doughnut).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axes {
    /// Category axis (scatter: X axis); horizontal for columns, lines and
    /// areas, vertical for bars.
    pub cat: Axis,
    /// Primary value axis.
    pub val: Axis,
    /// The value axis of the [`AxisGroup::Secondary`] series (drawn on the
    /// opposite side); required when a series uses it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub second_val: Option<Axis>,
}

impl Default for Axes {
    fn default() -> Self {
        Axes {
            cat: Axis::default(),
            val: Axis::value(),
            second_val: None,
        }
    }
}

/// Legend placement (`c:legendPos`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LegendPosition {
    Top,
    Bottom,
    Left,
    Right,
    TopRight,
}

impl LegendPosition {
    pub fn ooxml_name(self) -> &'static str {
        match self {
            LegendPosition::Top => "t",
            LegendPosition::Bottom => "b",
            LegendPosition::Left => "l",
            LegendPosition::Right => "r",
            LegendPosition::TopRight => "tr",
        }
    }

    pub fn from_ooxml_name(name: &str) -> Option<Self> {
        Some(match name {
            "t" => LegendPosition::Top,
            "b" => LegendPosition::Bottom,
            "l" => LegendPosition::Left,
            "r" => LegendPosition::Right,
            "tr" => LegendPosition::TopRight,
            _ => return None,
        })
    }
}

/// The legend. Its font and manual layout are [`Chart::legend_text_format`]
/// and [`Chart::legend_layout`] (`c:legend/c:txPr`, `c:legend/c:layout`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Legend {
    pub position: LegendPosition,
    /// Drawn over the plot area.
    #[serde(default, skip_serializing_if = "is_false")]
    pub overlay: bool,
}

impl Legend {
    /// A legend at `position`, not overlaying the plot area.
    pub fn at(position: LegendPosition) -> Self {
        Legend {
            position,
            overlay: false,
        }
    }
}

/// How empty cells are plotted (`c:dispBlanksAs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisplayBlanks {
    /// Leave a gap.
    #[default]
    Gap,
    /// Plot as zero.
    Zero,
    /// Connect the neighbouring points with a line (lines/scatter).
    Span,
}

impl DisplayBlanks {
    fn is_gap(&self) -> bool {
        *self == DisplayBlanks::Gap
    }
}

// --- chart -------------------------------------------------------------------------------

/// A chart: what `c:chartSpace` describes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    /// `None` = no title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<ChartTitle>,
    pub kind: ChartKind,
    #[serde(default)]
    pub series: Vec<Series>,
    /// Categories shared by the series without own ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<DataRef>,
    #[serde(default)]
    pub axes: Axes,
    /// `None` = no legend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend: Option<Legend>,
    /// Office chart style 1..=48 (`c:style`; 2 = Excel's default). Only
    /// its color rule is used, see [`palette_color`].
    #[serde(default = "default_style", skip_serializing_if = "is_default_style")]
    pub style: u8,
    /// One color per point instead of per series (single-series pies and
    /// doughnuts).
    #[serde(default, skip_serializing_if = "is_false")]
    pub vary_colors: bool,
    /// Skip data in hidden rows and columns (Excel's default: on).
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub plot_visible_only: bool,
    #[serde(default, skip_serializing_if = "DisplayBlanks::is_gap")]
    pub display_blanks_as: DisplayBlanks,
    /// Data labels of every series (see [`Series::data_labels`]).
    #[serde(default, skip_serializing_if = "DataLabels::is_empty")]
    pub data_labels: DataLabels,
    /// Bar/column gap between categories in percent of a bar (0..=500;
    /// `None` = 150).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<u16>,
    /// Bar/column overlap of the series in percent (-100..=100; `None` =
    /// 0, stacked charts always 100).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overlap: Option<i8>,
    /// Doughnut hole in percent of the diameter (10..=90; `None` = 50).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hole_size: Option<u8>,
    /// Pie/doughnut: angle of the first slice in degrees clockwise from
    /// 12 o'clock (`None` = 0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_slice_angle: Option<u16>,
    /// Chart area fill, border and shadow (`c:chartSpace/c:spPr`);
    /// `None` = the style's (white, light grey border).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chart_area: Option<ShapeFormat>,
    /// Plot area fill, border and shadow (`c:plotArea/c:spPr`); `None` =
    /// no fill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_area: Option<ShapeFormat>,
    /// Plot area position and size set by hand (inner plot area).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_layout: Option<ManualLayout>,
    /// Default text properties of the whole chart (`c:chartSpace/c:txPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_format: Option<TextFormat>,
    /// Font of the legend entries (`c:legend/c:txPr`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend_text_format: Option<TextFormat>,
    /// Legend position and size set by hand; `None` = per
    /// [`Legend::position`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend_layout: Option<ManualLayout>,
    /// Rounded chart area corners (`c:roundedCorners`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub rounded_corners: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_table: Option<DataTable>,
    /// Line charts: up/down bars between the first and the last series.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub up_down_bars: Option<UpDownBars>,
    /// Line charts: high-low lines from the highest to the lowest value
    /// per category (`c:hiLowLines`); the line's format.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high_low_lines: Option<LineFormat>,
}

impl Chart {
    /// An empty chart of `kind` with Excel's defaults.
    pub fn new(kind: ChartKind) -> Self {
        Chart {
            title: None,
            kind,
            series: Vec::new(),
            categories: None,
            axes: Axes::default(),
            legend: None,
            style: 2,
            vary_colors: false,
            plot_visible_only: true,
            display_blanks_as: DisplayBlanks::Gap,
            data_labels: DataLabels::default(),
            gap_width: None,
            overlap: None,
            hole_size: None,
            first_slice_angle: None,
            chart_area: None,
            plot_area: None,
            plot_layout: None,
            text_format: None,
            legend_text_format: None,
            legend_layout: None,
            rounded_corners: false,
            data_table: None,
            up_down_bars: None,
            high_low_lines: None,
        }
    }

    /// The effective chart kind of series `i` (its own kind in a combo
    /// chart, else the chart's).
    pub fn series_kind(&self, i: usize) -> &ChartKind {
        match (&self.kind, self.series.get(i).and_then(|s| s.kind.as_ref())) {
            (ChartKind::Combo, Some(k)) => k,
            (ChartKind::Combo, None) => &ChartKind::Combo,
            (k, _) => k,
        }
    }

    /// The categories of series `i`: its own, else the chart's.
    pub fn series_categories(&self, i: usize) -> Option<&DataRef> {
        self.series
            .get(i)
            .and_then(|s| s.categories.as_ref())
            .or(self.categories.as_ref())
    }

    /// Every reference formula of the chart (titles, names, values,
    /// categories), for reference adjustment.
    pub fn formulas_mut(&mut self) -> Vec<&mut String> {
        let mut out = Vec::new();
        if let Some(f) = self
            .title
            .as_mut()
            .and_then(|t| t.text.as_mut()?.formula_mut())
        {
            out.push(f);
        }
        let Axes {
            cat,
            val,
            second_val,
        } = &mut self.axes;
        for axis in [Some(cat), Some(val), second_val.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(f) = axis
                .title
                .as_mut()
                .and_then(|t| t.text.as_mut()?.formula_mut())
            {
                out.push(f);
            }
        }
        if let Some(f) = self.categories.as_mut().and_then(DataRef::formula_mut) {
            out.push(f);
        }
        for s in &mut self.series {
            if let Some(f) = s.name.as_mut().and_then(TextSource::formula_mut) {
                out.push(f);
            }
            if let Some(f) = s.values.formula_mut() {
                out.push(f);
            }
            if let Some(f) = s.categories.as_mut().and_then(DataRef::formula_mut) {
                out.push(f);
            }
            for e in &mut s.error_bars {
                if let ErrorAmount::Custom { plus, minus } = &mut e.amount {
                    for d in [plus, minus].into_iter().flatten() {
                        if let Some(f) = d.formula_mut() {
                            out.push(f);
                        }
                    }
                }
            }
            if let Some(f) = s
                .data_labels
                .as_mut()
                .and_then(|l| l.range.as_mut()?.formula_mut())
            {
                out.push(f);
            }
        }
        out
    }

    /// Every reference formula of the chart.
    pub fn formulas(&self) -> Vec<&str> {
        let mut out = Vec::new();
        fn title(t: &Option<ChartTitle>) -> Option<&str> {
            t.as_ref().and_then(|t| t.text.as_ref()?.formula())
        }
        out.extend(title(&self.title));
        out.extend(title(&self.axes.cat.title));
        out.extend(title(&self.axes.val.title));
        if let Some(a) = &self.axes.second_val {
            out.extend(title(&a.title));
        }
        out.extend(self.categories.as_ref().and_then(DataRef::formula));
        for s in &self.series {
            out.extend(s.name.as_ref().and_then(TextSource::formula));
            out.extend(s.values.formula());
            out.extend(s.categories.as_ref().and_then(DataRef::formula));
            for e in &s.error_bars {
                if let ErrorAmount::Custom { plus, minus } = &e.amount {
                    for d in [plus, minus].into_iter().flatten() {
                        out.extend(d.formula());
                    }
                }
            }
            out.extend(
                s.data_labels
                    .as_ref()
                    .and_then(|l| l.range.as_ref()?.formula()),
            );
        }
        out
    }

    /// Excel's recommended chart for a selected range ("Insert → Chart"
    /// on a selection): a clustered column chart.
    ///
    /// `cells` are the classes of the range's cells, row-major, starting
    /// at `(r0, c0)` (0-based) on sheet `sheet`. As in Excel:
    ///
    /// * the first row holds the series names when it has no numbers
    ///   (outside the first column) and some text, or when the top-left
    ///   cell is empty;
    /// * the first column holds the categories when it has no numbers
    ///   below the header row and some text, or when the top-left cell is
    ///   empty and the first row is a header;
    /// * series run down the columns when there are at least as many data
    ///   rows as data columns, else along the rows;
    /// * one series: automatic title (the series name), no legend; several
    ///   series: the title "Chart Title" and a legend at the bottom;
    ///   Office 2013's gap width 219 % and overlap -27 %.
    ///
    /// `None` when the range has no numeric data cell.
    pub fn from_range(sheet: &str, r0: u32, c0: u32, cells: &[Vec<CellClass>]) -> Option<Chart> {
        let rows = cells.len();
        let cols = cells.iter().map(Vec::len).max().unwrap_or(0);
        if rows == 0 || cols == 0 {
            return None;
        }
        let at = |r: usize, c: usize| {
            cells
                .get(r)
                .and_then(|row| row.get(c))
                .copied()
                .unwrap_or(CellClass::Empty)
        };
        let corner_empty = at(0, 0) == CellClass::Empty;
        let first_row: Vec<CellClass> = (1..cols).map(|c| at(0, c)).collect();
        let header_row = rows > 1
            && (corner_empty
                || (!first_row.contains(&CellClass::Number)
                    && (at(0, 0) == CellClass::Text || first_row.contains(&CellClass::Text))))
            && (0..cols).any(|c| at(0, c) != CellClass::Number);
        let start_row = usize::from(header_row);
        let first_col: Vec<CellClass> = (start_row..rows).map(|r| at(r, 0)).collect();
        let cat_col = cols > 1
            && ((corner_empty && header_row)
                || (!first_col.contains(&CellClass::Number)
                    && first_col.contains(&CellClass::Text)));
        let start_col = usize::from(cat_col);
        let has_numbers =
            (start_row..rows).any(|r| (start_col..cols).any(|c| at(r, c) == CellClass::Number));
        if !has_numbers || start_row >= rows || start_col >= cols {
            return None;
        }
        let (data_rows, data_cols) = (rows - start_row, cols - start_col);
        let by_cols = data_rows >= data_cols;
        let abs = |r: usize, c: usize| {
            format!(
                "${}${}",
                col_letters(c0 + c as u32),
                r0 as u64 + r as u64 + 1
            )
        };
        let range = |ra: usize, ca: usize, rb: usize, cb: usize| {
            let a = abs(ra, ca);
            let b = abs(rb, cb);
            if a == b {
                format!("{}!{a}", quote_sheet(sheet))
            } else {
                format!("{}!{a}:{b}", quote_sheet(sheet))
            }
        };
        let (last_r, last_c) = (rows - 1, cols - 1);
        let mut chart = Chart::new(ChartKind::column());
        let series: Vec<Series> = if by_cols {
            if cat_col {
                chart.categories = Some(DataRef::reference(range(start_row, 0, last_r, 0)));
            }
            (start_col..cols)
                .map(|c| Series {
                    name: header_row.then(|| TextSource::reference(range(0, c, 0, c))),
                    ..Series::new(DataRef::reference(range(start_row, c, last_r, c)))
                })
                .collect()
        } else {
            if header_row {
                chart.categories = Some(DataRef::reference(range(0, start_col, 0, last_c)));
            }
            (start_row..rows)
                .map(|r| Series {
                    name: cat_col.then(|| TextSource::reference(range(r, 0, r, 0))),
                    ..Series::new(DataRef::reference(range(r, start_col, r, last_c)))
                })
                .collect()
        };
        if series.len() == 1 {
            chart.title = Some(ChartTitle::default());
        } else {
            chart.title = Some(ChartTitle::literal("Chart Title"));
            chart.legend = Some(Legend::at(LegendPosition::Bottom));
        }
        chart.series = series;
        chart.gap_width = Some(219);
        chart.overlap = Some(-27);
        Some(chart)
    }
}

/// What a cell holds, for [`Chart::from_range`]. Dates are numbers;
/// booleans and errors count as text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CellClass {
    Empty,
    Number,
    Text,
}

/// `A`, `B`, …, `Z`, `AA`, … for a 0-based column.
fn col_letters(mut col: u32) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (col % 26) as u8);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// A sheet name as written before `!` in a reference: quoted (`'It''s'`)
/// unless it is a plain identifier that cannot be read as a cell.
pub fn quote_sheet(name: &str) -> String {
    let mut chars = name.chars();
    let plain = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    let letters = name.bytes().take_while(u8::is_ascii_alphabetic).count();
    let rest = &name[letters..];
    let like_a1 =
        (1..=3).contains(&letters) && !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit());
    let upper = name.to_ascii_uppercase();
    let like_r1c1 = upper
        .strip_prefix('R')
        .map(|r| r.trim_start_matches(|c: char| c.is_ascii_digit()))
        .and_then(|r| r.strip_prefix('C'))
        .is_some_and(|r| r.bytes().all(|b| b.is_ascii_digit()));
    if plain && !like_a1 && !like_r1c1 && !upper.eq_ignore_ascii_case("TRUE") {
        name.to_owned()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

// --- resolved data -------------------------------------------------------------------------

/// A chart's data as the renderer draws it: one entry per
/// [`Chart::series`], in order.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedChart {
    pub series: Vec<ResolvedSeries>,
    /// The resolved chart title for an automatic title or a referenced
    /// one (`None` = no title text).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The data of one series.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSeries {
    /// Legend text (the referenced cell's display text, the literal, or
    /// `Series<n>`).
    pub name: String,
    /// Category labels as displayed in their cells (`1`, `2`, … without
    /// categories); as many as `values`.
    pub categories: Vec<String>,
    /// Numeric categories when every non-blank category is a number
    /// (scatter X values, date axes); `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x_values: Option<Vec<Option<f64>>>,
    /// `None` = blank or not a number (see [`Chart::display_blanks_as`]).
    pub values: Vec<Option<f64>>,
    /// Number format of the first value cell (for "linked to source"
    /// labels and axes); `None` = General.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_code: Option<String>,
    /// Number format of the first category cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_format_code: Option<String>,
}

// --- palette ---------------------------------------------------------------------------------

/// The brightness variations Office applies to the six accents when a
/// colorful chart has more than six series (`colors1.xml` of Office
/// 2013+), as [`Color::Theme`] tints: `lumMod 60%` = −0.4,
/// `lumMod 80% lumOff 20%` = +0.2, and so on.
pub const PALETTE_VARIATIONS: [f64; 9] = [0.0, -0.4, 0.2, -0.2, 0.4, -0.5, 0.3, -0.3, 0.5];

const ACCENTS: [ThemeColorSlot; 6] = [
    ThemeColorSlot::Accent1,
    ThemeColorSlot::Accent2,
    ThemeColorSlot::Accent3,
    ThemeColorSlot::Accent4,
    ThemeColorSlot::Accent5,
    ThemeColorSlot::Accent6,
];

/// The automatic color of series (or, with [`Chart::vary_colors`], point)
/// `index` of `count` for Office chart style `style`. The rule (see
/// `docs/charts.md`) depends on `(style - 1) % 8`:
///
/// * `1` (styles 2, 10, …, 42; also 0 and > 48): colorful: accent
///   `1 + index % 6`, tinted by [`PALETTE_VARIATIONS`]`[(index / 6) % 9]`;
/// * `0` (styles 1, 9, …): grayscale: `tx1` tinted from 0.15 (first) to
///   0.85 (last);
/// * `2..=7`: monochrome accent `k - 1`, shaded from −0.5 (first) to
///   +0.4 (last).
pub fn palette_color(style: u8, index: usize, count: usize) -> Color {
    let column = if (1..=48).contains(&style) {
        (style - 1) % 8
    } else {
        1
    };
    let spread = |lo: f64, hi: f64| {
        if count <= 1 {
            (lo + hi) / 2.0
        } else {
            lo + (hi - lo) * index.min(count - 1) as f64 / (count - 1) as f64
        }
    };
    let round = |t: f64| (t * 1000.0).round() / 1000.0;
    match column {
        0 => Color::Theme {
            slot: ThemeColorSlot::Dark1,
            tint: round(spread(0.15, 0.85)),
        },
        1 => Color::Theme {
            slot: ACCENTS[index % 6],
            tint: PALETTE_VARIATIONS[(index / 6) % PALETTE_VARIATIONS.len()],
        },
        k => Color::Theme {
            slot: ACCENTS[usize::from(k) - 2],
            tint: if count <= 1 {
                0.0
            } else {
                round(spread(-0.5, 0.4))
            },
        },
    }
}

/// [`palette_color`] resolved against a color scheme.
pub fn palette_rgb(style: u8, index: usize, count: usize, scheme: &ColorScheme) -> Rgb {
    match palette_color(style, index, count) {
        Color::Theme { slot, tint } => apply_tint(scheme.get(slot), tint),
        other => other.resolve(scheme, Rgb::BLACK),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const E: CellClass = CellClass::Empty;
    const N: CellClass = CellClass::Number;
    const T: CellClass = CellClass::Text;

    fn refs(chart: &Chart) -> Vec<String> {
        chart.formulas().into_iter().map(str::to_owned).collect()
    }

    #[test]
    fn recommended_chart_with_headers() {
        let cells = vec![vec![E, T, T], vec![T, N, N], vec![T, N, N]];
        let c = Chart::from_range("Data", 1, 1, &cells).unwrap();
        // 2 data rows × 2 data columns: series in columns.
        assert_eq!(
            refs(&c),
            [
                "Data!$B$3:$B$4",
                "Data!$C$2",
                "Data!$C$3:$C$4",
                "Data!$D$2",
                "Data!$D$3:$D$4"
            ]
        );
        assert_eq!(c.title, Some(ChartTitle::literal("Chart Title")));
        assert_eq!(c.legend.unwrap().position, LegendPosition::Bottom);
        assert_eq!((c.gap_width, c.overlap), (Some(219), Some(-27)));
    }

    #[test]
    fn recommended_chart_orientation_and_plain_numbers() {
        // Wide range: series along the rows.
        let cells = vec![vec![T, T, T, T], vec![T, N, N, N]];
        let c = Chart::from_range("My data", 0, 0, &cells).unwrap();
        assert_eq!(c.series.len(), 1);
        assert_eq!(
            c.categories,
            Some(DataRef::reference("'My data'!$B$1:$D$1"))
        );
        assert_eq!(
            c.series[0].name,
            Some(TextSource::reference("'My data'!$A$2"))
        );
        assert_eq!(c.title, Some(ChartTitle::default()));
        assert_eq!(c.legend, None);
        // Only numbers: no header, no categories, series per column.
        let cells = vec![vec![N, N], vec![N, N], vec![N, N]];
        let c = Chart::from_range("S", 0, 0, &cells).unwrap();
        assert_eq!(c.series.len(), 2);
        assert_eq!(c.categories, None);
        assert_eq!(c.series[1].values, DataRef::reference("S!$B$1:$B$3"));
        assert!(c.series[1].name.is_none());
        // A numeric first column is data unless the corner is empty.
        let cells = vec![vec![T, T], vec![N, N], vec![N, N]];
        let c = Chart::from_range("S", 0, 0, &cells).unwrap();
        assert_eq!(c.series.len(), 2);
        let cells = vec![vec![E, T], vec![N, N], vec![N, N]];
        let c = Chart::from_range("S", 0, 0, &cells).unwrap();
        assert_eq!(c.series.len(), 1);
        assert_eq!(c.categories, Some(DataRef::reference("S!$A$2:$A$3")));
        // No numbers: no chart.
        assert!(Chart::from_range("S", 0, 0, &[vec![T, T]]).is_none());
        assert!(Chart::from_range("S", 0, 0, &[]).is_none());
    }

    #[test]
    fn sheet_quoting() {
        assert_eq!(quote_sheet("Sheet1"), "Sheet1");
        assert_eq!(quote_sheet("My data"), "'My data'");
        assert_eq!(quote_sheet("It's"), "'It''s'");
        assert_eq!(quote_sheet("A1"), "'A1'");
        assert_eq!(quote_sheet("R1C1"), "'R1C1'");
        assert_eq!(quote_sheet("1st"), "'1st'");
    }

    #[test]
    fn palette_rule() {
        let accent = |i: usize| match palette_color(2, i, 20) {
            Color::Theme { slot, tint } => (slot, tint),
            c => panic!("{c:?}"),
        };
        assert_eq!(accent(0), (ThemeColorSlot::Accent1, 0.0));
        assert_eq!(accent(5), (ThemeColorSlot::Accent6, 0.0));
        assert_eq!(accent(6), (ThemeColorSlot::Accent1, -0.4));
        assert_eq!(accent(13), (ThemeColorSlot::Accent2, 0.2));
        let scheme = ColorScheme::default();
        assert_eq!(palette_rgb(2, 0, 1, &scheme), Rgb::new(0x44, 0x72, 0xC4));
        // Out-of-range styles behave like style 2.
        assert_eq!(palette_color(0, 3, 4), palette_color(2, 3, 4));
        assert_eq!(palette_color(49, 3, 4), palette_color(10, 3, 4));
        // Monochrome accent 2 (style 4), dark to light.
        let Color::Theme { slot, tint } = palette_color(4, 0, 3) else {
            panic!()
        };
        assert_eq!((slot, tint), (ThemeColorSlot::Accent2, -0.5));
        let Color::Theme { tint, .. } = palette_color(4, 2, 3) else {
            panic!()
        };
        assert_eq!(tint, 0.4);
        // Grayscale.
        let Color::Theme { slot, tint } = palette_color(1, 1, 3) else {
            panic!()
        };
        assert_eq!((slot, tint), (ThemeColorSlot::Dark1, 0.5));
    }

    #[test]
    fn serde_shape() {
        let mut chart = Chart::new(ChartKind::Scatter {
            style: ScatterStyle::Smooth,
        });
        chart.series.push(Series {
            name: Some(TextSource::literal("A")),
            data_points: vec![DataPoint {
                idx: 1,
                fill: Some(Fill::Solid {
                    color: Color::theme(ThemeColorSlot::Accent2),
                }),
                line: None,
                marker: None,
            }],
            trendline: Some(Trendline {
                kind: TrendlineKind::MovingAverage { period: 3 },
                name: None,
                display_equation: false,
                display_r_squared: true,
                line: None,
            }),
            ..Series::new(DataRef::Literal {
                values: vec![
                    ChartValue::Number(1.5),
                    ChartValue::Text("x".into()),
                    ChartValue::Blank,
                ],
            })
        });
        let json = serde_json::to_value(&chart).unwrap();
        assert_eq!(
            json["kind"],
            serde_json::json!({"type":"scatter","style":"smooth"})
        );
        assert_eq!(
            json["series"][0]["values"],
            serde_json::json!({"type":"literal","values":[1.5,"x",null]})
        );
        assert_eq!(
            json["axes"]["val"],
            serde_json::json!({"majorGridlines":true})
        );
        assert!(json.get("style").is_none() && json.get("plotVisibleOnly").is_none());
        let back: Chart = serde_json::from_value(json).unwrap();
        assert_eq!(back, chart);
        // Minimal JSON gets the defaults.
        let min: Chart = serde_json::from_str(r#"{"kind":{"type":"pie"}}"#).unwrap();
        assert_eq!(min, Chart::new(ChartKind::Pie));
    }

    #[test]
    fn formulas_cover_every_reference() {
        let cells = vec![vec![E, T], vec![T, N]];
        let mut c = Chart::from_range("S", 0, 0, &cells).unwrap();
        c.axes.val.title = Some(ChartTitle {
            text: Some(TextSource::reference("S!$Z$1")),
            ..ChartTitle::default()
        });
        let n = c.formulas().len();
        assert_eq!(n, 4);
        for f in c.formulas_mut() {
            f.push('X');
        }
        assert!(c.formulas().iter().all(|f| f.ends_with('X')));
    }
}
