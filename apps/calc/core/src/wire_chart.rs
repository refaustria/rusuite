//! TypeScript-only mirrors of the chart types of `core_model::chart` and
//! `model_sheet::chart` (see [`crate::wire`] for the pattern): they copy
//! the serde shape of the real types, which are what is (de)serialized;
//! a test round-trips populated values to catch drift. The rendering
//! rules are specified in `docs/charts.md`.

use app_common::wire::Color;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

macro_rules! mirror {
    ($($item:item)*) => {
        $(
            #[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
            #[ts(export, export_to = "apps/calc/src/generated/")]
            $item
        )*
    };
}

mirror! {
    /// Mirror of `core_model::chart::ChartValue`: a number, a text or a
    /// blank (`null`).
    #[serde(untagged)]
    pub enum ChartValue {
        Number(f64),
        Text(String),
        Blank,
    }

    /// Mirror of `core_model::chart::DataRef`. `formula` is a reference
    /// without `=` (`Sheet1!$B$2:$B$7`); `cache` holds the file's values
    /// of a reference Calc cannot resolve.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum DataRef {
        Ref {
            formula: String,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            cache: Option<Vec<ChartValue>>,
        },
        Literal {
            values: Vec<ChartValue>,
        },
    }

    /// Mirror of `core_model::chart::TextSource`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum TextSource {
        Literal {
            text: String,
        },
        Ref {
            formula: String,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            cache: Option<String>,
        },
    }

    /// Mirror of `core_model::chart::ChartTitle`; absent `text` =
    /// automatic (chart: the only series' name; axis: "Axis Title").
    #[serde(rename_all = "camelCase")]
    pub struct ChartTitle {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text: Option<TextSource>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub overlay: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text_format: Option<TextFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub layout: Option<ManualLayout>,
    }

    /// Mirror of `core_model::chart::TextFormat`: font, size (pt), bold,
    /// italic, colour and rotation (degrees, −90..=90); absent = the
    /// chart style's.
    #[serde(rename_all = "camelCase")]
    pub struct TextFormat {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub font: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub size: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub bold: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub italic: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub color: Option<Color>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub rotation: Option<i32>,
    }

    /// Mirror of `core_model::chart::ManualLayout`: fractions of the chart
    /// area from its top-left corner.
    #[serde(rename_all = "camelCase")]
    pub struct ManualLayout {
        pub x: f64,
        pub y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub w: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub h: Option<f64>,
    }

    /// Mirror of `core_model::chart::GradientStop` (`pos` 0..=1).
    #[serde(rename_all = "camelCase")]
    pub struct GradientStop {
        pub pos: f64,
        pub color: Color,
    }

    /// Mirror of `core_model::chart::AreaFill`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum AreaFill {
        None,
        Solid {
            color: Color,
        },
        Gradient {
            stops: Vec<GradientStop>,
            #[serde(default)]
            #[ts(optional, as = "Option<f64>")]
            angle: f64,
            #[serde(default, skip_serializing_if = "std::ops::Not::not")]
            #[ts(optional, as = "Option<bool>")]
            radial: bool,
        },
        Picture {
            media: crate::wire_tables::Media,
            #[serde(default, skip_serializing_if = "std::ops::Not::not")]
            #[ts(optional, as = "Option<bool>")]
            tile: bool,
        },
    }

    /// Mirror of `core_model::chart::ShapeFormat`.
    #[serde(rename_all = "camelCase")]
    pub struct ShapeFormat {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub fill: Option<AreaFill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub shadow: bool,
    }

    /// Mirror of `core_model::chart::ErrorBarDirection`.
    #[serde(rename_all = "camelCase")]
    pub enum ErrorBarDirection {
        X,
        Y,
    }

    /// Mirror of `core_model::chart::ErrorBarType`.
    #[serde(rename_all = "camelCase")]
    pub enum ErrorBarType {
        Both,
        Plus,
        Minus,
    }

    /// Mirror of `core_model::chart::ErrorAmount`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ErrorAmount {
        Fixed { value: f64 },
        Percentage { value: f64 },
        StdDev { value: f64 },
        StdErr,
        Custom {
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            plus: Option<DataRef>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            minus: Option<DataRef>,
        },
    }

    /// Mirror of `core_model::chart::ErrorBars`; absent direction = `y`,
    /// absent type = `both`.
    #[serde(rename_all = "camelCase")]
    pub struct ErrorBars {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub direction: Option<ErrorBarDirection>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub bar_type: Option<ErrorBarType>,
        pub amount: ErrorAmount,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub no_end_cap: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
    }

    /// Mirror of `core_model::chart::DataTable`; absent borders = shown.
    #[serde(rename_all = "camelCase")]
    pub struct DataTable {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub horizontal: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub vertical: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub outline: Option<bool>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub keys: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text_format: Option<TextFormat>,
    }

    /// Mirror of `core_model::chart::UpDownBars`.
    #[serde(rename_all = "camelCase")]
    pub struct UpDownBars {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub gap_width: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub up: Option<ShapeFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub down: Option<ShapeFormat>,
    }

    /// Mirror of `core_model::chart::PointLabel`.
    #[serde(rename_all = "camelCase")]
    pub struct PointLabel {
        pub idx: u32,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub delete: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_value: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_percent: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_category: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_series: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_range: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub position: Option<LabelPosition>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub number_format: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text_format: Option<TextFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub layout: Option<ManualLayout>,
    }

    /// Mirror of `core_model::chart::BarDirection`.
    #[serde(rename_all = "camelCase")]
    pub enum BarDirection {
        Column,
        Bar,
    }

    /// Mirror of `core_model::chart::Grouping`.
    #[serde(rename_all = "camelCase")]
    pub enum Grouping {
        Standard,
        Clustered,
        Stacked,
        PercentStacked,
    }

    /// Mirror of `core_model::chart::ScatterStyle`.
    #[serde(rename_all = "camelCase")]
    pub enum ScatterStyle {
        Marker,
        LineMarker,
        Line,
        SmoothMarker,
        Smooth,
    }

    /// Mirror of `core_model::chart::ChartKind`. `unsupported` charts are
    /// read-only (render a placeholder).
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ChartKind {
        Bar {
            direction: BarDirection,
            grouping: Grouping,
        },
        Line {
            grouping: Grouping,
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
        Combo,
        Unsupported {
            kind: String,
            xml: String,
        },
    }

    /// Mirror of `core_model::chart::AxisGroup`.
    #[serde(rename_all = "camelCase")]
    pub enum AxisGroup {
        Primary,
        Secondary,
    }

    /// Mirror of `core_model::chart::Fill`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ChartFill {
        None,
        Solid {
            color: Color,
        },
    }

    /// Mirror of `core_model::chart::LineDash` (DrawingML `prstDash` names).
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

    /// Mirror of `core_model::chart::LineFormat`; `width` in EMU (12 700
    /// per point).
    #[serde(rename_all = "camelCase")]
    pub struct LineFormat {
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub none: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub color: Option<Color>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<f64>")]
        pub width: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub dash: Option<LineDash>,
    }

    /// Mirror of `core_model::chart::MarkerSymbol`.
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

    /// Mirror of `core_model::chart::Marker`; `size` in points.
    #[serde(rename_all = "camelCase")]
    pub struct Marker {
        pub symbol: MarkerSymbol,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub size: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub fill: Option<ChartFill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
    }

    /// Mirror of `core_model::chart::DataPoint`.
    #[serde(rename_all = "camelCase")]
    pub struct DataPoint {
        pub idx: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub fill: Option<ChartFill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub marker: Option<Marker>,
    }

    /// Mirror of `core_model::chart::LabelPosition`.
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

    /// Mirror of `core_model::chart::DataLabels`.
    #[serde(rename_all = "camelCase")]
    pub struct DataLabels {
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_value: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_percent: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_category: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_series: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_legend_key: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub position: Option<LabelPosition>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub number_format: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub range: Option<DataRef>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_range: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub leader_lines: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text_format: Option<TextFormat>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<PointLabel>>")]
        pub points: Vec<PointLabel>,
    }

    /// Mirror of `core_model::chart::TrendlineKind`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum TrendlineKind {
        Linear,
        Exponential,
        Logarithmic,
        Power,
        Polynomial { order: u8 },
        MovingAverage { period: u32 },
    }

    /// Mirror of `core_model::chart::Trendline`.
    #[serde(rename_all = "camelCase")]
    pub struct Trendline {
        pub kind: TrendlineKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub name: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub display_equation: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub display_r_squared: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
    }

    /// Mirror of `core_model::chart::Series`.
    #[serde(rename_all = "camelCase")]
    pub struct Series {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub name: Option<TextSource>,
        pub values: DataRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub categories: Option<DataRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub kind: Option<ChartKind>,
        /// Absent = primary.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub axis: Option<AxisGroup>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub fill: Option<ChartFill>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub marker: Option<Marker>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<DataPoint>>")]
        pub data_points: Vec<DataPoint>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub data_labels: Option<DataLabels>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub trendline: Option<Trendline>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub smooth: Option<bool>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<ErrorBars>>")]
        pub error_bars: Vec<ErrorBars>,
    }

    /// Mirror of `core_model::chart::Crosses`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum Crosses {
        AutoZero,
        Min,
        Max,
        At { value: f64 },
    }

    /// Mirror of `core_model::chart::TickLabels`.
    #[serde(rename_all = "camelCase")]
    pub enum TickLabels {
        NextTo,
        High,
        Low,
        None,
    }

    /// Mirror of `core_model::chart::Axis`.
    #[serde(rename_all = "camelCase")]
    pub struct Axis {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub title: Option<ChartTitle>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub min: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub max: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub major_unit: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub minor_unit: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub number_format: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub log_base: Option<f64>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub reverse: bool,
        /// Absent = `autoZero`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub crosses: Option<Crosses>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub major_gridlines: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub minor_gridlines: bool,
        /// Absent = `nextTo`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub tick_labels: Option<TickLabels>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub delete: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text_format: Option<TextFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line: Option<LineFormat>,
    }

    /// Mirror of `core_model::chart::Axes`.
    #[serde(rename_all = "camelCase")]
    pub struct Axes {
        pub cat: Axis,
        pub val: Axis,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub second_val: Option<Axis>,
    }

    /// Mirror of `core_model::chart::LegendPosition`.
    #[serde(rename_all = "camelCase")]
    pub enum LegendPosition {
        Top,
        Bottom,
        Left,
        Right,
        TopRight,
    }

    /// Mirror of `core_model::chart::Legend`.
    #[serde(rename_all = "camelCase")]
    pub struct Legend {
        pub position: LegendPosition,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub overlay: bool,
    }

    /// Mirror of `core_model::chart::DisplayBlanks`.
    #[serde(rename_all = "camelCase")]
    pub enum DisplayBlanks {
        Gap,
        Zero,
        Span,
    }

    /// Mirror of `core_model::chart::Chart`. Absent optional fields take
    /// the defaults of `docs/charts.md` (style 2, plot visible only,
    /// blanks as gaps, gap width 150, overlap 0, hole 50 %, first slice 0°).
    #[serde(rename_all = "camelCase")]
    pub struct Chart {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub title: Option<ChartTitle>,
        pub kind: ChartKind,
        pub series: Vec<Series>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub categories: Option<DataRef>,
        pub axes: Axes,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub legend: Option<Legend>,
        /// Office chart style 1..=48; absent = 2.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub style: Option<u8>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub vary_colors: bool,
        /// Absent = true.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub plot_visible_only: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub display_blanks_as: Option<DisplayBlanks>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub data_labels: Option<DataLabels>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub gap_width: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub overlap: Option<i8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub hole_size: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub first_slice_angle: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub chart_area: Option<ShapeFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub plot_area: Option<ShapeFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub plot_layout: Option<ManualLayout>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub text_format: Option<TextFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub legend_text_format: Option<TextFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub legend_layout: Option<ManualLayout>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub rounded_corners: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub data_table: Option<DataTable>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub up_down_bars: Option<UpDownBars>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub high_low_lines: Option<LineFormat>,
    }

    /// Mirror of `model_sheet::CellOffset`: a cell corner plus an offset
    /// in EMU (914 400 per inch, 9 525 per CSS pixel).
    #[serde(rename_all = "camelCase")]
    pub struct CellOffset {
        pub col: u32,
        pub row: u32,
        #[ts(as = "f64")]
        pub col_offset: i64,
        #[ts(as = "f64")]
        pub row_offset: i64,
    }

    /// Mirror of `model_sheet::ChartAnchor`.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ChartAnchor {
        TwoCell { from: CellOffset, to: CellOffset },
        OneCell {
            from: CellOffset,
            #[ts(as = "f64")]
            width: i64,
            #[ts(as = "f64")]
            height: i64,
        },
        Absolute {
            #[ts(as = "f64")]
            x: i64,
            #[ts(as = "f64")]
            y: i64,
            #[ts(as = "f64")]
            width: i64,
            #[ts(as = "f64")]
            height: i64,
        },
    }

    /// Mirror of `model_sheet::ChartObject`: a chart on a sheet.
    #[serde(rename_all = "camelCase")]
    pub struct ChartObject {
        pub id: u32,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub name: String,
        pub anchor: ChartAnchor,
        pub chart: Chart,
        /// A PivotChart: the pivot table whose layout the series follow.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub pivot: Option<u32>,
    }

    /// Mirror of `core_model::chart::ResolvedSeries`.
    #[serde(rename_all = "camelCase")]
    pub struct ResolvedSeries {
        pub name: String,
        pub categories: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub x_values: Option<Vec<Option<f64>>>,
        pub values: Vec<Option<f64>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub format_code: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub category_format_code: Option<String>,
    }

    /// Mirror of `model_sheet::ResolvedErrorBars`.
    #[serde(rename_all = "camelCase")]
    pub struct ResolvedErrorBars {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub plus: Option<Vec<Option<f64>>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub minus: Option<Vec<Option<f64>>>,
    }

    /// Mirror of `model_sheet::SeriesExtras`: custom error bar amounts
    /// and "Value From Cells" texts of a series (Calc merges them into the
    /// resolved series for the renderer).
    #[serde(rename_all = "camelCase")]
    pub struct SeriesExtras {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<ResolvedErrorBars>>")]
        pub error_bars: Vec<ResolvedErrorBars>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub label_texts: Option<Vec<String>>,
    }

    /// Mirror of `core_model::chart::ResolvedChart`: the data of a chart,
    /// one entry per series.
    #[serde(rename_all = "camelCase")]
    pub struct ResolvedChart {
        pub series: Vec<ResolvedSeries>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub title: Option<String>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::chart as cm;
    use core_model::{Rgb, ThemeColorSlot};
    use model_sheet as ms;
    use serde::de::DeserializeOwned;

    fn same_shape<R, M>(real: &R)
    where
        R: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
        M: Serialize + DeserializeOwned,
    {
        let json = serde_json::to_value(real).unwrap();
        let mirror: M = serde_json::from_value(json.clone()).unwrap();
        let back = serde_json::to_value(&mirror).unwrap();
        assert_eq!(json, back);
        assert_eq!(&serde_json::from_value::<R>(back).unwrap(), real);
    }

    #[test]
    fn mirrors_match_the_chart_model() {
        let red = core_model::Color::Rgb(Rgb::new(255, 0, 0));
        let line = cm::LineFormat {
            none: false,
            color: Some(red),
            width: Some(12_700),
            dash: Some(cm::LineDash::LgDashDot),
        };
        let marker = cm::Marker {
            symbol: cm::MarkerSymbol::Triangle,
            size: Some(7),
            fill: Some(cm::Fill::Solid {
                color: core_model::Color::theme(ThemeColorSlot::Accent3),
            }),
            line: Some(cm::LineFormat::hidden()),
        };
        let tf = cm::TextFormat {
            font: Some("Arial".into()),
            size: Some(9.5),
            bold: Some(true),
            italic: Some(false),
            color: Some(red),
            rotation: Some(-45),
        };
        let layout = cm::ManualLayout {
            x: 0.1,
            y: 0.2,
            w: Some(0.5),
            h: None,
        };
        let shape = cm::ShapeFormat {
            fill: Some(cm::AreaFill::Gradient {
                stops: vec![cm::GradientStop {
                    pos: 0.5,
                    color: red,
                }],
                angle: 45.0,
                radial: true,
            }),
            line: Some(line),
            shadow: true,
        };
        let labels = cm::DataLabels {
            show_value: true,
            show_percent: true,
            show_category: true,
            show_series: true,
            show_legend_key: true,
            position: Some(cm::LabelPosition::InsideBase),
            number_format: Some("0%".into()),
            range: Some(cm::DataRef::reference("S!$D$2:$D$4")),
            show_range: true,
            leader_lines: true,
            text_format: Some(tf.clone()),
            points: vec![
                cm::PointLabel {
                    idx: 1,
                    delete: true,
                    ..cm::PointLabel::default()
                },
                cm::PointLabel {
                    idx: 2,
                    show_value: true,
                    show_percent: true,
                    show_category: true,
                    show_series: true,
                    show_range: true,
                    position: Some(cm::LabelPosition::Top),
                    number_format: Some("0".into()),
                    text_format: Some(tf.clone()),
                    layout: Some(layout),
                    delete: false,
                },
            ],
        };
        let axis = cm::Axis {
            title: Some(cm::ChartTitle {
                text: Some(cm::TextSource::Ref {
                    formula: "S!$A$1".into(),
                    cache: Some("t".into()),
                }),
                overlay: true,
                text_format: Some(tf.clone()),
                layout: Some(layout),
            }),
            min: Some(0.0),
            max: Some(10.0),
            major_unit: Some(2.0),
            minor_unit: Some(0.5),
            number_format: Some("0.0".into()),
            log_base: Some(10.0),
            reverse: true,
            crosses: cm::Crosses::At { value: 1.5 },
            major_gridlines: true,
            minor_gridlines: true,
            tick_labels: cm::TickLabels::High,
            delete: true,
            text_format: Some(tf.clone()),
            line: Some(line),
        };
        let kinds = [
            cm::ChartKind::column(),
            cm::ChartKind::Line {
                grouping: cm::Grouping::PercentStacked,
                markers: true,
            },
            cm::ChartKind::Area {
                grouping: cm::Grouping::Stacked,
            },
            cm::ChartKind::Pie,
            cm::ChartKind::Doughnut,
            cm::ChartKind::Scatter {
                style: cm::ScatterStyle::SmoothMarker,
            },
            cm::ChartKind::Combo,
            cm::ChartKind::Unsupported {
                kind: "radarChart".into(),
                xml: "<x/>".into(),
            },
        ];
        let trends = [
            cm::TrendlineKind::Linear,
            cm::TrendlineKind::Exponential,
            cm::TrendlineKind::Logarithmic,
            cm::TrendlineKind::Power,
            cm::TrendlineKind::Polynomial { order: 3 },
            cm::TrendlineKind::MovingAverage { period: 4 },
        ];
        for (i, kind) in kinds.into_iter().enumerate() {
            let mut chart = cm::Chart::new(kind.clone());
            chart.title = Some(cm::ChartTitle::literal("T"));
            chart.categories = Some(cm::DataRef::Literal {
                values: vec![
                    cm::ChartValue::Text("a".into()),
                    cm::ChartValue::Number(2.0),
                    cm::ChartValue::Blank,
                ],
            });
            chart
                .series
                .push(cm::Series::new(cm::DataRef::reference("S!$B$2:$B$4")));
            chart.series.push(cm::Series {
                name: Some(cm::TextSource::literal("n")),
                categories: Some(cm::DataRef::Ref {
                    formula: "S!$A$2:$A$4".into(),
                    cache: Some(vec![cm::ChartValue::Number(1.0)]),
                }),
                kind: Some(cm::ChartKind::column()),
                axis: cm::AxisGroup::Secondary,
                fill: Some(cm::Fill::None),
                line: Some(line),
                marker: Some(marker),
                data_points: vec![cm::DataPoint {
                    idx: 1,
                    fill: Some(cm::Fill::Solid { color: red }),
                    line: Some(line),
                    marker: Some(marker),
                }],
                data_labels: Some(labels.clone()),
                trendline: Some(cm::Trendline {
                    kind: trends[i % trends.len()],
                    name: Some("tl".into()),
                    display_equation: true,
                    display_r_squared: true,
                    line: Some(line),
                }),
                smooth: Some(true),
                error_bars: vec![
                    cm::ErrorBars {
                        direction: cm::ErrorBarDirection::X,
                        bar_type: cm::ErrorBarType::Minus,
                        amount: cm::ErrorAmount::Custom {
                            plus: Some(cm::DataRef::reference("S!$E$2:$E$4")),
                            minus: None,
                        },
                        no_end_cap: true,
                        line: Some(line),
                    },
                    cm::ErrorBars {
                        direction: cm::ErrorBarDirection::Y,
                        bar_type: cm::ErrorBarType::Both,
                        amount: [
                            cm::ErrorAmount::Fixed { value: 1.0 },
                            cm::ErrorAmount::Percentage { value: 5.0 },
                            cm::ErrorAmount::StdDev { value: 2.0 },
                            cm::ErrorAmount::StdErr,
                        ][i % 4]
                            .clone(),
                        no_end_cap: false,
                        line: None,
                    },
                ],
                ..cm::Series::new(cm::DataRef::reference("S!$C$2:$C$4"))
            });
            chart.axes = cm::Axes {
                cat: axis.clone(),
                val: cm::Axis::value(),
                second_val: Some(axis.clone()),
            };
            chart.legend = Some(cm::Legend {
                position: cm::LegendPosition::TopRight,
                overlay: true,
            });
            chart.style = 9;
            chart.vary_colors = true;
            chart.plot_visible_only = false;
            chart.display_blanks_as = cm::DisplayBlanks::Span;
            chart.data_labels = labels.clone();
            chart.gap_width = Some(80);
            chart.overlap = Some(-20);
            chart.hole_size = Some(40);
            chart.first_slice_angle = Some(30);
            chart.chart_area = Some(shape.clone());
            chart.plot_area = Some(cm::ShapeFormat {
                fill: Some(if i % 2 == 0 {
                    cm::AreaFill::Picture {
                        media: core_model::Media {
                            content_type: "image/png".into(),
                            data: vec![1, 2, 3],
                        },
                        tile: true,
                    }
                } else {
                    cm::AreaFill::Solid { color: red }
                }),
                ..cm::ShapeFormat::default()
            });
            chart.plot_layout = Some(layout);
            chart.text_format = Some(tf.clone());
            chart.legend_text_format = Some(tf.clone());
            chart.legend_layout = Some(layout);
            chart.rounded_corners = true;
            chart.data_table = Some(cm::DataTable {
                horizontal: false,
                vertical: true,
                outline: false,
                keys: true,
                text_format: Some(tf.clone()),
            });
            chart.up_down_bars = Some(cm::UpDownBars {
                gap_width: Some(80),
                up: Some(shape.clone()),
                down: None,
            });
            chart.high_low_lines = Some(line);
            same_shape::<_, Chart>(&chart);
            same_shape::<_, Chart>(&cm::Chart::new(kind));
        }
        for anchor in [
            ms::ChartAnchor::TwoCell {
                from: ms::CellOffset::default(),
                to: ms::CellOffset {
                    col: 3,
                    row: 4,
                    col_offset: 5,
                    row_offset: 6,
                },
            },
            ms::ChartAnchor::OneCell {
                from: ms::CellOffset::default(),
                width: 1,
                height: 2,
            },
            ms::ChartAnchor::Absolute {
                x: 1,
                y: 2,
                width: 3,
                height: 4,
            },
        ] {
            same_shape::<_, ChartObject>(&ms::ChartObject {
                id: 3,
                name: "Chart 3".into(),
                anchor,
                chart: cm::Chart::new(cm::ChartKind::Pie),
                pivot: Some(2),
            });
        }
        same_shape::<_, ResolvedChart>(&cm::ResolvedChart {
            series: vec![cm::ResolvedSeries {
                name: "s".into(),
                categories: vec!["a".into()],
                x_values: Some(vec![Some(1.0), None]),
                values: vec![Some(2.0), None],
                format_code: Some("0".into()),
                category_format_code: Some("d".into()),
            }],
            title: Some("t".into()),
        });
        same_shape::<_, ResolvedChart>(&cm::ResolvedChart::default());
        same_shape::<_, SeriesExtras>(&ms::SeriesExtras {
            error_bars: vec![
                ms::ResolvedErrorBars {
                    plus: Some(vec![Some(1.0), None]),
                    minus: None,
                },
                ms::ResolvedErrorBars::default(),
            ],
            label_texts: Some(vec!["a".into()]),
        });
    }
}
