//! Conditional formatting (Excel's Home ▸ Conditional Formatting).
//!
//! Every sheet keeps a list of [`CfRule`]s in priority order (the first
//! rule has priority 1 and wins). A rule covers one or more ranges and is
//! either a *highlight* rule (cell value comparison, formula, text,
//! blanks/errors, top/bottom N, above/below average, duplicates/unique)
//! that applies its [`DxfStyle`] to matching cells, or a *graphical* rule
//! (data bar, colour scale, icon set) that computes a bar length, a fill
//! colour or an icon per number cell.
//!
//! Rule formulas are written for the anchor cell of the rule (see
//! `crate::rules`); [`Workbook::effective_cf`] shifts them per cell like
//! a copied formula and evaluates them with the engine's evaluator, the
//! cell being the current cell.
//!
//! # Combining rules (as Excel)
//!
//! Rules are applied in priority order. For each property of the
//! differential style (font colour, bold, …, fill, each border side,
//! number format) the first matching rule that sets it wins; the first
//! data bar, colour scale and icon set win likewise. A matching rule with
//! `stop_if_true` ends the evaluation for that cell.
//!
//! ```
//! use engine_formula::{CellCoord, CellRect, RangeRef};
//! use model_sheet::{CfKind, CfRule, CompareOp, DxfStyle, Workbook};
//!
//! let mut wb = Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! for (r, v) in ["5", "50", "500"].iter().enumerate() {
//!     wb.set_input(CellCoord::new(s, r as u32, 0), v).unwrap();
//! }
//! let rule = CfRule {
//!     ranges: vec![CellRect { r0: 0, c0: 0, r1: 2, c1: 0 }],
//!     kind: CfKind::CellIs { op: CompareOp::GreaterThan, formulas: vec!["10".into()] },
//!     dxf: Some(DxfStyle { bold: Some(true), ..Default::default() }),
//!     ..CfRule::new(CfKind::DuplicateValues)
//! };
//! wb.add_cf_rule(s, rule).unwrap();
//! let hits = wb.effective_cf(RangeRef::new(s, 0, 0, 9, 9));
//! let rows: Vec<u32> = hits.iter().map(|(c, _)| c.row).collect();
//! assert_eq!(rows, [1, 2]);
//! ```

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

use core_model::{Color, ColorScheme, Rgb};
use engine_formula::eval::{evaluate, CellProvider};
use engine_formula::value::{compare, to_number, to_text};
use engine_formula::{offset_relative, CellCoord, CellRect, CellShift, Expr, SheetId, Value};
use serde::{Deserialize, Serialize};

use crate::rules::{
    anchor, check_formulas, check_ranges, parse_formula, rect_intersection, shift_rule,
    subtract_ranges, truthy,
};
use crate::style::Borders;
use crate::workbook::Workbook;
use crate::{CellRange, Error};

// --- types ---------------------------------------------------------------------

/// A comparison of a cell value (conditional formatting `cellIs`, data
/// validation). `Between` / `NotBetween` take two bounds (inclusive, in
/// either order), the others one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompareOp {
    Between,
    NotBetween,
    Equal,
    NotEqual,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
}

impl CompareOp {
    /// Whether the operator takes two bounds.
    pub fn needs_two(self) -> bool {
        matches!(self, CompareOp::Between | CompareOp::NotBetween)
    }

    /// The SpreadsheetML name (`greaterThan`, …).
    pub fn name(self) -> &'static str {
        match self {
            CompareOp::Between => "between",
            CompareOp::NotBetween => "notBetween",
            CompareOp::Equal => "equal",
            CompareOp::NotEqual => "notEqual",
            CompareOp::GreaterThan => "greaterThan",
            CompareOp::LessThan => "lessThan",
            CompareOp::GreaterThanOrEqual => "greaterThanOrEqual",
            CompareOp::LessThanOrEqual => "lessThanOrEqual",
        }
    }

    pub fn from_name(name: &str) -> Option<CompareOp> {
        [
            CompareOp::Between,
            CompareOp::NotBetween,
            CompareOp::Equal,
            CompareOp::NotEqual,
            CompareOp::GreaterThan,
            CompareOp::LessThan,
            CompareOp::GreaterThanOrEqual,
            CompareOp::LessThanOrEqual,
        ]
        .into_iter()
        .find(|op| op.name() == name)
    }

    /// `v op a` (or `v` between `a` and `b`) with the formula comparison
    /// rules (blank = 0 / `""`, text case-insensitive, numbers < text <
    /// logicals); an error on either side is false.
    pub fn test(self, v: &Value, a: &Value, b: Option<&Value>) -> bool {
        let Ok(o) = compare(v, a) else {
            return false;
        };
        match self {
            CompareOp::Equal => o == Ordering::Equal,
            CompareOp::NotEqual => o != Ordering::Equal,
            CompareOp::GreaterThan => o == Ordering::Greater,
            CompareOp::LessThan => o == Ordering::Less,
            CompareOp::GreaterThanOrEqual => o != Ordering::Less,
            CompareOp::LessThanOrEqual => o != Ordering::Greater,
            CompareOp::Between | CompareOp::NotBetween => {
                let Some(b) = b else { return false };
                let (Ok(ob), Ok(ab)) = (compare(v, b), compare(a, b)) else {
                    return false;
                };
                // Inclusive, bounds in either order.
                let (lo, hi) = if ab == Ordering::Greater {
                    (ob, o)
                } else {
                    (o, ob)
                };
                let inside = lo != Ordering::Less && hi != Ordering::Greater;
                inside == (self == CompareOp::Between)
            }
        }
    }
}

/// The differential formatting a highlight rule applies: every `None`
/// leaves the cell's own formatting alone.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DxfStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_color: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Single underline on/off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    /// Solid background colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(default, skip_serializing_if = "Borders::is_default")]
    pub borders: Borders,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

impl DxfStyle {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Fills the properties `self` does not set from `lower` (a rule of
    /// lower priority).
    fn fill_from(&mut self, lower: &DxfStyle) {
        self.font_color = self.font_color.or(lower.font_color);
        self.bold = self.bold.or(lower.bold);
        self.italic = self.italic.or(lower.italic);
        self.underline = self.underline.or(lower.underline);
        self.strike = self.strike.or(lower.strike);
        self.fill = self.fill.or(lower.fill);
        self.borders = lower.borders.merged_with(&self.borders);
        if self.number_format.is_none() {
            self.number_format.clone_from(&lower.number_format);
        }
    }
}

/// A threshold of a data bar, colour scale or icon set. The strings are
/// numbers or formulas (without `=`, evaluated at the rule's anchor cell).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum CfValue {
    /// The smallest number of the ranges.
    Min,
    /// The largest number of the ranges.
    Max,
    /// Excel 2010's "Automatic" data bar minimum: the smallest number,
    /// or 0 when every number is positive (`min(0, lowest)`).
    AutoMin,
    /// "Automatic" maximum: `max(0, highest)`.
    AutoMax,
    Num(String),
    /// `min + p% × (max − min)`.
    Percent(String),
    /// The `p`th percentile of the numbers (`PERCENTILE.INC`).
    Percentile(String),
    Formula(String),
}

impl CfValue {
    fn text_mut(&mut self) -> Option<&mut String> {
        match self {
            CfValue::Min | CfValue::Max | CfValue::AutoMin | CfValue::AutoMax => None,
            CfValue::Num(s)
            | CfValue::Percent(s)
            | CfValue::Percentile(s)
            | CfValue::Formula(s) => Some(s),
        }
    }
}

/// One point of a colour scale.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorPoint {
    pub value: CfValue,
    pub color: Color,
}

/// The icon sets of Excel 2007 (`iconSet` names in SpreadsheetML).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IconSetKind {
    #[serde(rename = "3Arrows")]
    Arrows3,
    #[serde(rename = "3ArrowsGray")]
    ArrowsGray3,
    #[serde(rename = "3Flags")]
    Flags3,
    #[serde(rename = "3TrafficLights1")]
    TrafficLights3,
    #[serde(rename = "3TrafficLights2")]
    TrafficLightsRimmed3,
    #[serde(rename = "3Signs")]
    Signs3,
    #[serde(rename = "3Symbols")]
    Symbols3,
    #[serde(rename = "3Symbols2")]
    SymbolsUncircled3,
    #[serde(rename = "4Arrows")]
    Arrows4,
    #[serde(rename = "4ArrowsGray")]
    ArrowsGray4,
    #[serde(rename = "4RedToBlack")]
    RedToBlack4,
    #[serde(rename = "4Rating")]
    Rating4,
    #[serde(rename = "4TrafficLights")]
    TrafficLights4,
    #[serde(rename = "5Arrows")]
    Arrows5,
    #[serde(rename = "5ArrowsGray")]
    ArrowsGray5,
    #[serde(rename = "5Rating")]
    Rating5,
    #[serde(rename = "5Quarters")]
    Quarters5,
}

const ICON_SETS: [(IconSetKind, &str); 17] = [
    (IconSetKind::Arrows3, "3Arrows"),
    (IconSetKind::ArrowsGray3, "3ArrowsGray"),
    (IconSetKind::Flags3, "3Flags"),
    (IconSetKind::TrafficLights3, "3TrafficLights1"),
    (IconSetKind::TrafficLightsRimmed3, "3TrafficLights2"),
    (IconSetKind::Signs3, "3Signs"),
    (IconSetKind::Symbols3, "3Symbols"),
    (IconSetKind::SymbolsUncircled3, "3Symbols2"),
    (IconSetKind::Arrows4, "4Arrows"),
    (IconSetKind::ArrowsGray4, "4ArrowsGray"),
    (IconSetKind::RedToBlack4, "4RedToBlack"),
    (IconSetKind::Rating4, "4Rating"),
    (IconSetKind::TrafficLights4, "4TrafficLights"),
    (IconSetKind::Arrows5, "5Arrows"),
    (IconSetKind::ArrowsGray5, "5ArrowsGray"),
    (IconSetKind::Rating5, "5Rating"),
    (IconSetKind::Quarters5, "5Quarters"),
];

impl IconSetKind {
    /// The SpreadsheetML name (`3Arrows`, …).
    pub fn name(self) -> &'static str {
        ICON_SETS
            .iter()
            .find(|(k, _)| *k == self)
            .map_or("3TrafficLights1", |(_, n)| n)
    }

    pub fn from_name(name: &str) -> Option<IconSetKind> {
        ICON_SETS.iter().find(|(_, n)| *n == name).map(|(k, _)| *k)
    }

    /// Number of icons (3, 4 or 5).
    pub fn icons(self) -> usize {
        match self.name().as_bytes()[0] {
            b'4' => 4,
            b'5' => 5,
            _ => 3,
        }
    }
}

/// The periods of Excel's "A Date Occurring" rule (`timePeriod`). Weeks
/// start on Sunday, as Excel's `WEEKDAY`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimePeriod {
    Yesterday,
    Today,
    Tomorrow,
    /// Today and the six days before.
    Last7Days,
    LastWeek,
    ThisWeek,
    NextWeek,
    LastMonth,
    ThisMonth,
    NextMonth,
}

const TIME_PERIODS: [(TimePeriod, &str); 10] = [
    (TimePeriod::Yesterday, "yesterday"),
    (TimePeriod::Today, "today"),
    (TimePeriod::Tomorrow, "tomorrow"),
    (TimePeriod::Last7Days, "last7Days"),
    (TimePeriod::LastWeek, "lastWeek"),
    (TimePeriod::ThisWeek, "thisWeek"),
    (TimePeriod::NextWeek, "nextWeek"),
    (TimePeriod::LastMonth, "lastMonth"),
    (TimePeriod::ThisMonth, "thisMonth"),
    (TimePeriod::NextMonth, "nextMonth"),
];

impl TimePeriod {
    /// The SpreadsheetML name (`last7Days`, …).
    pub fn name(self) -> &'static str {
        TIME_PERIODS
            .iter()
            .find(|(p, _)| *p == self)
            .map_or("today", |(_, n)| n)
    }

    pub fn from_name(name: &str) -> Option<TimePeriod> {
        TIME_PERIODS
            .iter()
            .find(|(_, n)| *n == name)
            .map(|(p, _)| *p)
    }

    /// Whether the day `day` (a date serial without time) lies in the
    /// period relative to `today`.
    pub fn contains(self, day: i64, today: i64) -> bool {
        // WEEKDAY(today) - 1: days since the week's Sunday.
        let since_sunday = (today - 1).rem_euclid(7);
        let sunday = today - since_sunday;
        let month = |serial: i64| {
            engine_formula::functions::datetime::serial::serial_to_ymd(serial as f64)
                .map(|(y, m, _)| i64::from(y) * 12 + i64::from(m) - 1)
        };
        let months = |delta: i64| match (month(day), month(today)) {
            (Some(a), Some(b)) => a == b + delta,
            _ => false,
        };
        match self {
            TimePeriod::Yesterday => day == today - 1,
            TimePeriod::Today => day == today,
            TimePeriod::Tomorrow => day == today + 1,
            TimePeriod::Last7Days => (today - 6..=today).contains(&day),
            TimePeriod::LastWeek => (sunday - 7..sunday).contains(&day),
            TimePeriod::ThisWeek => (sunday..sunday + 7).contains(&day),
            TimePeriod::NextWeek => (sunday + 7..sunday + 14).contains(&day),
            TimePeriod::LastMonth => months(-1),
            TimePeriod::ThisMonth => months(0),
            TimePeriod::NextMonth => months(1),
        }
    }
}

/// Where a data bar's zero axis sits (Excel 2010 `axisPosition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataBarAxis {
    /// Proportional to the negative part of the range (no axis when every
    /// value is positive).
    #[default]
    Automatic,
    /// The middle of the cell.
    Midpoint,
    /// No axis: negative bars grow in the same direction as positive ones.
    None,
}

/// The direction of a data bar (Excel 2010 `direction`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataBarDirection {
    /// As the sheet (left to right).
    #[default]
    Context,
    LeftToRight,
    RightToLeft,
}

fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

fn ten() -> u32 {
    10
}

fn is_ten(n: &u32) -> bool {
    *n == 10
}

fn ninety() -> u32 {
    90
}

fn is_ninety(n: &u32) -> bool {
    *n == 90
}

/// Excel 2010's default fill of negative data bars.
pub const NEGATIVE_BAR_COLOR: Rgb = Rgb::new(255, 0, 0);

/// What the grid draws for a data bar in one cell: the bar spans `from`
/// to `to` (fractions of the cell width, from its left edge, `from <=
/// to`), an axis at `axis` when the rule has one. The colours are final
/// (negative values already use the negative colours).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBarDraw {
    pub from: f64,
    pub to: f64,
    /// The cell's value is negative.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub negative: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<f64>,
    pub color: Color,
    /// Gradient (fading to white towards the bar's end) or solid fill.
    pub gradient: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis_color: Option<Color>,
}

/// What a rule tests or draws.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CfKind {
    /// "Cell value": compares the cell with one or two formulas.
    CellIs {
        op: CompareOp,
        formulas: Vec<String>,
    },
    /// "Use a formula": true (or non-zero) applies the format.
    Expression {
        formula: String,
    },
    /// Text contains `text` (case-insensitive).
    ContainsText {
        text: String,
    },
    NotContainsText {
        text: String,
    },
    BeginsWith {
        text: String,
    },
    EndsWith {
        text: String,
    },
    /// Blank or only spaces.
    ContainsBlanks,
    NotContainsBlanks,
    ContainsErrors,
    NotContainsErrors,
    /// The `rank` largest (`bottom`: smallest) numbers, or `rank` percent
    /// of them; ties included.
    Top10 {
        rank: u32,
        percent: bool,
        bottom: bool,
    },
    /// Numbers above (`above`) or below the average; `equal` includes it.
    /// With `std_dev` = n (1–3): numbers above `average + n σ` (below
    /// `average − n σ`), σ the population standard deviation.
    AboveAverage {
        above: bool,
        equal: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        std_dev: Option<u32>,
    },
    /// "A Date Occurring": date serials in the period around today.
    TimePeriod {
        period: TimePeriod,
    },
    /// Values occurring more than once (text case-insensitive).
    DuplicateValues,
    UniqueValues,
    /// A data bar from `min` to `max`. The other fields are Excel 2010's
    /// options (`x14:dataBar`); their defaults are those of an Excel 2007
    /// bar (gradient, no border, bars from 10 % to 90 % of the cell).
    DataBar {
        color: Color,
        min: CfValue,
        max: CfValue,
        show_value: bool,
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        gradient: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border: Option<Color>,
        /// Fill of negative bars (`None`: Excel's red).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        negative_color: Option<Color>,
        /// Border of negative bars (`None`: as the positive border).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        negative_border: Option<Color>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        axis_color: Option<Color>,
        #[serde(default, skip_serializing_if = "is_default")]
        axis: DataBarAxis,
        #[serde(default, skip_serializing_if = "is_default")]
        direction: DataBarDirection,
        /// Shortest and longest bar, percent of the cell width.
        #[serde(default = "ten", skip_serializing_if = "is_ten")]
        min_length: u32,
        #[serde(default = "ninety", skip_serializing_if = "is_ninety")]
        max_length: u32,
    },
    /// Two or three points, lowest first.
    ColorScale {
        points: Vec<ColorPoint>,
    },
    /// `thresholds` has one entry per icon, lowest first (the first is
    /// usually `percent 0`); a number gets the icon of the last threshold
    /// it reaches (`>=`, or `>` where `greater[i]` is true; `greater` may
    /// be empty = all `>=`).
    IconSet {
        set: IconSetKind,
        thresholds: Vec<CfValue>,
        reverse: bool,
        show_value: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        greater: Vec<bool>,
    },
}

impl CfKind {
    /// A data bar with Excel 2007's look (gradient fill, no border, the
    /// automatic axis, bars from 10 % to 90 % of the cell).
    pub fn data_bar(color: Color, min: CfValue, max: CfValue, show_value: bool) -> CfKind {
        CfKind::DataBar {
            color,
            min,
            max,
            show_value,
            gradient: true,
            border: None,
            negative_color: None,
            negative_border: None,
            axis_color: None,
            axis: DataBarAxis::Automatic,
            direction: DataBarDirection::Context,
            min_length: 10,
            max_length: 90,
        }
    }

    /// Every formula of the rule (thresholds included).
    fn formulas_mut(&mut self) -> Vec<&mut String> {
        match self {
            CfKind::CellIs { formulas, .. } => formulas.iter_mut().collect(),
            CfKind::Expression { formula } => vec![formula],
            CfKind::DataBar { min, max, .. } => [min, max]
                .into_iter()
                .filter_map(CfValue::text_mut)
                .collect(),
            CfKind::ColorScale { points } => points
                .iter_mut()
                .filter_map(|p| p.value.text_mut())
                .collect(),
            CfKind::IconSet { thresholds, .. } => thresholds
                .iter_mut()
                .filter_map(CfValue::text_mut)
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Whether the rule applies a [`DxfStyle`] (not a bar, scale or icon).
    pub fn is_highlight(&self) -> bool {
        !matches!(
            self,
            CfKind::DataBar { .. } | CfKind::ColorScale { .. } | CfKind::IconSet { .. }
        )
    }
}

/// A conditional formatting rule of one sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfRule {
    /// Unique per sheet; 0 when adding = assign one.
    #[serde(default)]
    pub id: u32,
    pub ranges: Vec<CellRect>,
    /// 1 = highest; the position in the sheet's list (renumbered on every
    /// change). When adding, 0 = top.
    #[serde(default)]
    pub priority: u32,
    #[serde(default)]
    pub stop_if_true: bool,
    pub kind: CfKind,
    /// The format of a highlight rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf: Option<DxfStyle>,
}

impl CfRule {
    /// A rule of `kind` without ranges, id, priority or format.
    pub fn new(kind: CfKind) -> Self {
        CfRule {
            id: 0,
            ranges: Vec::new(),
            priority: 0,
            stop_if_true: false,
            kind,
            dxf: None,
        }
    }

    pub(crate) fn parts_mut(&mut self) -> (&mut Vec<CellRect>, Vec<&mut String>) {
        (&mut self.ranges, self.kind.formulas_mut())
    }

    /// Normalizes and checks ranges, formulas and the kind's arity.
    fn check(&mut self) -> Result<(), Error> {
        check_ranges(&mut self.ranges)?;
        check_formulas(self.kind.formulas_mut())?;
        let bad = |m: &str| Err(Error::InvalidRule(m.into()));
        match &self.kind {
            CfKind::CellIs { op, formulas }
                if formulas.len() != 1 + usize::from(op.needs_two()) =>
            {
                bad("wrong number of formulas")
            }
            CfKind::Top10 { rank, percent, .. } if *rank == 0 || (*percent && *rank > 100) => {
                bad("invalid rank")
            }
            CfKind::ColorScale { points } if !(2..=3).contains(&points.len()) => {
                bad("a colour scale has 2 or 3 points")
            }
            CfKind::IconSet {
                set,
                thresholds,
                greater,
                ..
            } if thresholds.len() != set.icons()
                || !(greater.is_empty() || greater.len() == thresholds.len()) =>
            {
                bad("one threshold per icon")
            }
            CfKind::AboveAverage {
                std_dev: Some(n), ..
            } if !(1..=3).contains(n) => bad("1 to 3 standard deviations"),
            CfKind::DataBar {
                min_length,
                max_length,
                ..
            } if min_length > max_length || *max_length > 100 => bad("data bar lengths"),
            _ => Ok(()),
        }
    }
}

/// The conditional formatting of one cell.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfResult {
    /// The combined differential format of the matching highlight rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf: Option<DxfStyle>,
    /// The data bar, computed in full (lengths, axis, colours).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bar: Option<DataBarDraw>,
    /// Colour scale background.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// Icon index into `icon_set`, 0 = the icon of the lowest values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<IconSetKind>,
    /// A data bar or icon set hides the cell value (`show_value: false`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hide_value: bool,
    /// The value in the number format of the highlight rule (`dxf/numFmt`),
    /// replacing the cell's own display text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

impl CfResult {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

// --- evaluation ----------------------------------------------------------------

/// Statistics of the numbers in a rule's ranges.
struct Numbers {
    sorted: Vec<f64>,
}

impl Numbers {
    fn min(&self) -> Option<f64> {
        self.sorted.first().copied()
    }

    fn max(&self) -> Option<f64> {
        self.sorted.last().copied()
    }

    /// `PERCENTILE.INC` with `p` in percent.
    fn percentile(&self, p: f64) -> Option<f64> {
        let n = self.sorted.len();
        if n == 0 {
            return None;
        }
        let pos = (p / 100.0).clamp(0.0, 1.0) * (n - 1) as f64;
        let i = pos.floor() as usize;
        let frac = pos - i as f64;
        let lo = self.sorted[i];
        let hi = self.sorted[(i + 1).min(n - 1)];
        Some(lo + frac * (hi - lo))
    }
}

/// Grouping key for duplicate/unique values.
#[derive(PartialEq, Eq, Hash)]
enum ValueKey {
    Number(u64),
    Text(String),
    Bool(bool),
    Error(String),
}

fn value_key(v: &Value) -> Option<ValueKey> {
    Some(match v {
        Value::Empty => return None,
        Value::Number(n) => ValueKey::Number(if *n == 0.0 { 0 } else { n.to_bits() }),
        Value::Text(t) => ValueKey::Text(t.to_uppercase()),
        Value::Bool(b) => ValueKey::Bool(*b),
        Value::Error(e) => ValueKey::Error(e.to_string()),
        Value::Array(_) => return value_key(&v.clone().into_scalar()),
    })
}

/// A rule prepared for evaluating many cells.
enum Prepared {
    CellIs(CompareOp, Vec<Expr>),
    Expression(Expr),
    Text(TextTest, String),
    Blanks(bool),
    Errors(bool),
    /// Numbers `>= cut` (`top`) or `<= cut`.
    Rank {
        cut: f64,
        top: bool,
    },
    /// Numbers beyond `cut` (`above`: `> cut`, else `< cut`); `equal`
    /// includes it.
    Average {
        cut: f64,
        above: bool,
        equal: bool,
    },
    Period(TimePeriod, i64),
    Count {
        counts: HashMap<ValueKey, u32>,
        duplicates: bool,
    },
    Bar(Box<BarSpec>),
    Scale(Vec<(f64, Color)>),
    Icons {
        set: IconSetKind,
        cuts: Vec<f64>,
        greater: Vec<bool>,
        reverse: bool,
        show: bool,
    },
    Never,
}

/// A data bar rule prepared against its range: the bounds and options.
struct BarSpec {
    lo: f64,
    hi: f64,
    color: Color,
    show: bool,
    gradient: bool,
    border: Option<Color>,
    negative_color: Option<Color>,
    negative_border: Option<Color>,
    axis_color: Option<Color>,
    axis: DataBarAxis,
    direction: DataBarDirection,
    min_length: f64,
    max_length: f64,
}

impl BarSpec {
    /// The bar of value `n` (Excel's geometry): without an axis the bar
    /// grows from the left edge, `min_length` for `lo` to `max_length`
    /// for `hi`; with an axis (some value below zero, or the midpoint
    /// axis) positive bars grow right of it and negative bars left of it,
    /// each side scaled by its extreme. Right-to-left mirrors everything.
    fn draw(&self, n: f64) -> DataBarDraw {
        let (lo, hi) = (self.lo.min(self.hi), self.lo.max(self.hi));
        let v = n.clamp(lo, hi);
        let negative = n < 0.0;
        let axis = match self.axis {
            DataBarAxis::None => None,
            DataBarAxis::Midpoint => Some(0.5),
            DataBarAxis::Automatic if lo < 0.0 => {
                Some(if hi <= 0.0 { 1.0 } else { -lo / (hi - lo) })
            }
            DataBarAxis::Automatic => None,
        };
        let (from, to) = match axis {
            None => {
                let frac = if hi > lo { (v - lo) / (hi - lo) } else { 1.0 };
                (
                    0.0,
                    self.min_length + frac * (self.max_length - self.min_length),
                )
            }
            Some(a) => {
                let (pos, neg) = if self.axis == DataBarAxis::Midpoint {
                    let m = hi.abs().max(lo.abs());
                    (m, m)
                } else {
                    (hi.max(0.0), -lo.min(0.0))
                };
                let scale = self.max_length;
                if v >= 0.0 {
                    let len = if pos > 0.0 { v / pos } else { 0.0 };
                    (a, a + len * (1.0 - a) * scale)
                } else {
                    let len = if neg > 0.0 { -v / neg } else { 0.0 };
                    (a - len * a * scale, a)
                }
            }
        };
        let rtl = self.direction == DataBarDirection::RightToLeft;
        let flip = |x: f64| if rtl { 1.0 - x } else { x };
        let (from, to) = if rtl {
            (flip(to), flip(from))
        } else {
            (from, to)
        };
        let color = if negative {
            self.negative_color
                .unwrap_or(Color::Rgb(NEGATIVE_BAR_COLOR))
        } else {
            self.color
        };
        let border = if negative {
            self.negative_border.or(self.border)
        } else {
            self.border
        };
        DataBarDraw {
            from: from.clamp(0.0, 1.0),
            to: to.clamp(0.0, 1.0),
            negative,
            axis: axis.map(flip),
            color,
            gradient: self.gradient,
            border,
            axis_color: axis.map(|_| self.axis_color.unwrap_or(Color::Rgb(Rgb::BLACK))),
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum TextTest {
    Contains,
    NotContains,
    Begins,
    Ends,
}

impl Prepared {
    /// Whether a blank cell can match (otherwise only used cells are
    /// evaluated).
    fn blank_can_match(&self) -> bool {
        matches!(
            self,
            Prepared::CellIs(..) | Prepared::Expression(_) | Prepared::Blanks(true)
        ) || matches!(self, Prepared::Text(t, s) if *t == TextTest::NotContains || s.is_empty())
    }
}

fn number_of(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(*n),
        _ => None,
    }
}

fn lerp(a: Rgb, b: Rgb, t: f64) -> Rgb {
    let ch = |x: u8, y: u8| (f64::from(x) + (f64::from(y) - f64::from(x)) * t).round() as u8;
    Rgb::new(ch(a.r, b.r), ch(a.g, b.g), ch(a.b, b.b))
}

struct Evaluator<'a> {
    wb: &'a Workbook,
    sheet: SheetId,
    scheme: ColorScheme,
}

impl Evaluator<'_> {
    fn eval_at(&self, expr: &Expr, at: CellCoord) -> Value {
        let engine = self.wb.engine();
        let ctx = engine.eval_context(engine as &dyn CellProvider, at);
        evaluate(expr, &ctx)
    }

    /// The non-blank values of the rule's ranges (each range clipped to the used
    /// area of the sheet).
    fn values(&self, rule: &CfRule) -> Vec<Value> {
        let Some((mr, mc)) = self.wb.used_range(self.sheet) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for r in &rule.ranges {
            for row in r.r0..=r.r1.min(mr) {
                for col in r.c0..=r.c1.min(mc) {
                    let v = self.wb.value(CellCoord::new(self.sheet, row, col));
                    if !matches!(v, Value::Empty) {
                        out.push(v);
                    }
                }
            }
        }
        out
    }

    fn stats(values: &[Value]) -> Numbers {
        let mut sorted: Vec<f64> = values.iter().filter_map(number_of).collect();
        sorted.sort_by(f64::total_cmp);
        Numbers { sorted }
    }

    /// A threshold as a number (`None`: not computable).
    fn threshold(&self, v: &CfValue, nums: &Numbers, at: CellCoord) -> Option<f64> {
        let num = |s: &str| -> Option<f64> {
            if let Ok(n) = s.trim().parse::<f64>() {
                return Some(n);
            }
            let expr = parse_formula(s).ok()?;
            to_number(&self.eval_at(&expr, at)).ok()
        };
        let (min, max) = (nums.min()?, nums.max()?);
        match v {
            CfValue::Min => Some(min),
            CfValue::Max => Some(max),
            CfValue::AutoMin => Some(min.min(0.0)),
            CfValue::AutoMax => Some(max.max(0.0)),
            CfValue::Num(s) | CfValue::Formula(s) => num(s),
            CfValue::Percent(s) => Some(min + num(s)? / 100.0 * (max - min)),
            CfValue::Percentile(s) => nums.percentile(num(s)?),
        }
    }

    fn prepare(&self, rule: &CfRule) -> Prepared {
        let Some((ar, ac)) = anchor(&rule.ranges) else {
            return Prepared::Never;
        };
        let at = CellCoord::new(self.sheet, ar, ac);
        let text = |t: TextTest, s: &str| Prepared::Text(t, s.to_lowercase());
        match &rule.kind {
            CfKind::CellIs { op, formulas } => {
                match formulas.iter().map(|f| parse_formula(f)).collect() {
                    Ok(asts) => Prepared::CellIs(*op, asts),
                    Err(_) => Prepared::Never,
                }
            }
            CfKind::Expression { formula } => match parse_formula(formula) {
                Ok(ast) => Prepared::Expression(ast),
                Err(_) => Prepared::Never,
            },
            CfKind::ContainsText { text: s } => text(TextTest::Contains, s),
            CfKind::NotContainsText { text: s } => text(TextTest::NotContains, s),
            CfKind::BeginsWith { text: s } => text(TextTest::Begins, s),
            CfKind::EndsWith { text: s } => text(TextTest::Ends, s),
            CfKind::ContainsBlanks => Prepared::Blanks(true),
            CfKind::NotContainsBlanks => Prepared::Blanks(false),
            CfKind::ContainsErrors => Prepared::Errors(true),
            CfKind::NotContainsErrors => Prepared::Errors(false),
            CfKind::Top10 {
                rank,
                percent,
                bottom,
            } => {
                let nums = Self::stats(&self.values(rule));
                let count = nums.sorted.len();
                if count == 0 {
                    return Prepared::Never;
                }
                let n = if *percent {
                    ((count as f64 * f64::from(*rank) / 100.0).floor() as usize).max(1)
                } else {
                    *rank as usize
                }
                .min(count);
                let cut = if *bottom {
                    nums.sorted[n - 1]
                } else {
                    nums.sorted[count - n]
                };
                Prepared::Rank { cut, top: !bottom }
            }
            CfKind::AboveAverage {
                above,
                equal,
                std_dev,
            } => {
                let nums = Self::stats(&self.values(rule));
                if nums.sorted.is_empty() {
                    return Prepared::Never;
                }
                let n = nums.sorted.len() as f64;
                let avg = nums.sorted.iter().sum::<f64>() / n;
                let cut = match std_dev {
                    Some(k) => {
                        let var = nums.sorted.iter().map(|x| (x - avg).powi(2)).sum::<f64>() / n;
                        let d = f64::from(*k) * var.sqrt();
                        if *above {
                            avg + d
                        } else {
                            avg - d
                        }
                    }
                    None => avg,
                };
                Prepared::Average {
                    cut,
                    above: *above,
                    equal: *equal,
                }
            }
            CfKind::TimePeriod { period } => {
                let engine = self.wb.engine();
                let ctx = engine.eval_context(engine as &dyn CellProvider, at);
                Prepared::Period(*period, (ctx.now)().floor() as i64)
            }
            CfKind::DuplicateValues | CfKind::UniqueValues => {
                let mut counts = HashMap::new();
                for v in self.values(rule) {
                    if let Some(k) = value_key(&v) {
                        *counts.entry(k).or_insert(0) += 1;
                    }
                }
                Prepared::Count {
                    counts,
                    duplicates: matches!(rule.kind, CfKind::DuplicateValues),
                }
            }
            CfKind::DataBar {
                color,
                min,
                max,
                show_value,
                gradient,
                border,
                negative_color,
                negative_border,
                axis_color,
                axis,
                direction,
                min_length,
                max_length,
            } => {
                let nums = Self::stats(&self.values(rule));
                match (
                    self.threshold(min, &nums, at),
                    self.threshold(max, &nums, at),
                ) {
                    (Some(lo), Some(hi)) => Prepared::Bar(Box::new(BarSpec {
                        lo,
                        hi,
                        color: *color,
                        show: *show_value,
                        gradient: *gradient,
                        border: *border,
                        negative_color: *negative_color,
                        negative_border: *negative_border,
                        axis_color: *axis_color,
                        axis: *axis,
                        direction: *direction,
                        min_length: f64::from(*min_length) / 100.0,
                        max_length: f64::from(*max_length) / 100.0,
                    })),
                    _ => Prepared::Never,
                }
            }
            CfKind::ColorScale { points } => {
                let nums = Self::stats(&self.values(rule));
                let pts: Option<Vec<(f64, Color)>> = points
                    .iter()
                    .map(|p| Some((self.threshold(&p.value, &nums, at)?, p.color)))
                    .collect();
                pts.map_or(Prepared::Never, Prepared::Scale)
            }
            CfKind::IconSet {
                set,
                thresholds,
                reverse,
                show_value,
                greater,
            } => {
                let nums = Self::stats(&self.values(rule));
                let cuts: Option<Vec<f64>> = thresholds
                    .iter()
                    .map(|t| self.threshold(t, &nums, at))
                    .collect();
                cuts.map_or(Prepared::Never, |cuts| Prepared::Icons {
                    set: *set,
                    cuts,
                    greater: greater.clone(),
                    reverse: *reverse,
                    show: *show_value,
                })
            }
        }
    }

    /// Applies a prepared rule to cell `c`; `true` if it matched.
    fn apply(
        &self,
        p: &Prepared,
        rule: &CfRule,
        (ar, ac): (u32, u32),
        c: CellCoord,
        out: &mut CfResult,
    ) -> bool {
        let v = self.wb.value(c);
        let shift = |e: &Expr| {
            offset_relative(
                e,
                i64::from(c.row) - i64::from(ar),
                i64::from(c.col) - i64::from(ac),
            )
        };
        let matched = match p {
            Prepared::Never => false,
            Prepared::CellIs(op, asts) => {
                let bounds: Vec<Value> = asts.iter().map(|e| self.eval_at(&shift(e), c)).collect();
                match bounds.as_slice() {
                    [a] => op.test(&v, a, None),
                    [a, b] => op.test(&v, a, Some(b)),
                    _ => false,
                }
            }
            Prepared::Expression(e) => truthy(&self.eval_at(&shift(e), c)),
            Prepared::Text(test, needle) => match to_text(&v) {
                Err(_) => *test == TextTest::NotContains,
                Ok(t) => {
                    let t = t.to_lowercase();
                    match test {
                        TextTest::Contains => t.contains(needle.as_str()),
                        TextTest::NotContains => !t.contains(needle.as_str()),
                        TextTest::Begins => t.starts_with(needle.as_str()),
                        TextTest::Ends => t.ends_with(needle.as_str()),
                    }
                }
            },
            Prepared::Blanks(want) => match &v {
                Value::Error(_) => false,
                Value::Empty => *want,
                Value::Text(t) => t.trim().is_empty() == *want,
                _ => !*want,
            },
            Prepared::Errors(want) => v.is_error() == *want,
            Prepared::Rank { cut, top } => {
                number_of(&v).is_some_and(|n| if *top { n >= *cut } else { n <= *cut })
            }
            Prepared::Average { cut, above, equal } => number_of(&v)
                .is_some_and(|n| (*equal && n == *cut) || if *above { n > *cut } else { n < *cut }),
            Prepared::Period(period, today) => {
                number_of(&v).is_some_and(|n| period.contains(n.floor() as i64, *today))
            }
            Prepared::Count { counts, duplicates } => value_key(&v)
                .and_then(|k| counts.get(&k))
                .is_some_and(|&n| (n > 1) == *duplicates),
            Prepared::Bar(spec) => {
                let Some(n) = number_of(&v) else { return false };
                if out.bar.is_none() {
                    out.bar = Some(spec.draw(n));
                    out.hide_value |= !spec.show;
                }
                return true;
            }
            Prepared::Scale(points) => {
                let Some(n) = number_of(&v) else { return false };
                if out.color.is_none() {
                    out.color = Some(self.scale_color(points, n));
                }
                return true;
            }
            Prepared::Icons {
                set,
                cuts,
                greater,
                reverse,
                show,
            } => {
                let Some(n) = number_of(&v) else { return false };
                if out.icon.is_none() {
                    let reached = cuts
                        .iter()
                        .enumerate()
                        .skip(1)
                        .take_while(|&(i, &t)| {
                            if greater.get(i).copied().unwrap_or(false) {
                                n > t
                            } else {
                                n >= t
                            }
                        })
                        .count();
                    let last = cuts.len().saturating_sub(1);
                    let i = if *reverse { last - reached } else { reached };
                    out.icon = Some(i as u8);
                    out.icon_set = Some(*set);
                    out.hide_value |= !show;
                }
                return true;
            }
        };
        if matched {
            if let Some(dxf) = rule.dxf.as_ref().filter(|d| !d.is_empty()) {
                match out.dxf.as_mut() {
                    Some(have) => have.fill_from(dxf),
                    None => out.dxf = Some(dxf.clone()),
                }
            }
        }
        matched
    }

    fn scale_color(&self, points: &[(f64, Color)], n: f64) -> Color {
        let rgb = |c: &Color| c.resolve(&self.scheme, Rgb::BLACK);
        let (first, last) = (points[0], points[points.len() - 1]);
        if n <= first.0 {
            return first.1;
        }
        if n >= last.0 {
            return last.1;
        }
        for w in points.windows(2) {
            let ((a, ca), (b, cb)) = (w[0], w[1]);
            if n == a {
                return ca;
            }
            if n < b && b > a {
                return Color::Rgb(lerp(rgb(&ca), rgb(&cb), (n - a) / (b - a)));
            }
        }
        last.1
    }
}

// --- the workbook API ----------------------------------------------------------

impl Workbook {
    /// The conditional formatting rules of `sheet` in priority order.
    pub fn cf_rules(&self, sheet: SheetId) -> &[CfRule] {
        &self.sheet_data(sheet).conditional_formats
    }

    /// Replaces the rules of `sheet` (loading files, undo). Rules are
    /// checked and normalized (formulas without `=`), sorted by priority
    /// (stable) and renumbered `1..`; rules with id 0 get fresh ids. Fails
    /// with [`Error::InvalidRule`] for a malformed rule or duplicate ids;
    /// on error nothing changes.
    pub fn set_cf_rules(&mut self, sheet: SheetId, rules: Vec<CfRule>) -> Result<(), Error> {
        self.sheet_data_mut(sheet)?;
        let mut rules = rules;
        let mut seen = std::collections::HashSet::new();
        for r in &mut rules {
            r.check()?;
            if r.id != 0 && !seen.insert(r.id) {
                return Err(Error::InvalidRule(format!("duplicate rule id {}", r.id)));
            }
        }
        rules.sort_by_key(|r| r.priority);
        let mut next = seen.iter().max().copied().unwrap_or(0);
        for (i, r) in rules.iter_mut().enumerate() {
            if r.id == 0 {
                next += 1;
                r.id = next;
            }
            r.priority = i as u32 + 1;
        }
        self.sheet_data_mut(sheet)?.conditional_formats = rules;
        Ok(())
    }

    fn renumber(rules: &mut [CfRule]) {
        for (i, r) in rules.iter_mut().enumerate() {
            r.priority = i as u32 + 1;
        }
    }

    fn rule_index(&self, sheet: SheetId, id: u32) -> Result<usize, Error> {
        self.cf_rules(sheet)
            .iter()
            .position(|r| r.id == id)
            .ok_or(Error::UnknownRule(id))
    }

    /// Adds a rule at position `rule.priority` (1 or 0 = top, as Excel
    /// adds new rules; beyond the end = bottom). A rule with id 0 gets a
    /// fresh id; an id in use fails. Returns the id.
    pub fn add_cf_rule(&mut self, sheet: SheetId, rule: CfRule) -> Result<u32, Error> {
        let mut rule = rule;
        rule.check()?;
        let data = self.sheet_data_mut(sheet)?;
        let rules = &mut data.conditional_formats;
        if rule.id == 0 {
            rule.id = rules.iter().map(|r| r.id).max().unwrap_or(0) + 1;
        } else if rules.iter().any(|r| r.id == rule.id) {
            return Err(Error::InvalidRule(format!("duplicate rule id {}", rule.id)));
        }
        let at = (rule.priority.max(1) as usize - 1).min(rules.len());
        let id = rule.id;
        rules.insert(at, rule);
        Self::renumber(rules);
        Ok(id)
    }

    /// Replaces the rule with `rule.id`, moving it to `rule.priority`
    /// (0 = keep its position). Returns the previous rule.
    pub fn update_cf_rule(&mut self, sheet: SheetId, rule: CfRule) -> Result<CfRule, Error> {
        let i = self.rule_index(sheet, rule.id)?;
        let mut rule = rule;
        rule.check()?;
        let rules = &mut self.sheet_data_mut(sheet)?.conditional_formats;
        let old = rules.remove(i);
        let at = match rule.priority {
            0 => i,
            p => (p as usize - 1).min(rules.len()),
        };
        rules.insert(at, rule);
        Self::renumber(rules);
        Ok(old)
    }

    /// Removes the rule `id`; returns it (with its priority).
    pub fn remove_cf_rule(&mut self, sheet: SheetId, id: u32) -> Result<CfRule, Error> {
        let i = self.rule_index(sheet, id)?;
        let rules = &mut self.sheet_data_mut(sheet)?.conditional_formats;
        let old = rules.remove(i);
        Self::renumber(rules);
        Ok(old)
    }

    /// Moves the rule `id` to `priority` (1 = top, clamped to the end).
    /// Returns its previous priority.
    pub fn move_cf_rule(&mut self, sheet: SheetId, id: u32, priority: u32) -> Result<u32, Error> {
        let i = self.rule_index(sheet, id)?;
        let rules = &mut self.sheet_data_mut(sheet)?.conditional_formats;
        let rule = rules.remove(i);
        let at = (priority.max(1) as usize - 1).min(rules.len());
        rules.insert(at, rule);
        Self::renumber(rules);
        Ok(i as u32 + 1)
    }

    /// Excel's "Clear Rules from Selected Cells": removes `range` from
    /// every rule of its sheet (rules left without cells disappear).
    /// Returns whether anything changed.
    pub fn clear_cf(&mut self, range: CellRange) -> Result<bool, Error> {
        let cut = CellRect {
            r0: range.r0,
            c0: range.c0,
            r1: range.r1,
            c1: range.c1,
        };
        let rules = &mut self.sheet_data_mut(range.sheet)?.conditional_formats;
        let mut changed = false;
        rules.retain_mut(|rule| {
            let (ranges, formulas) = rule.parts_mut();
            subtract_ranges(ranges, formulas, &cut, &mut changed)
        });
        Self::renumber(rules);
        Ok(changed)
    }

    /// Moves the rules and validations of every sheet for a row/column
    /// insert or delete on `sheet` (see `crate::rules`).
    pub(crate) fn shift_rules(&mut self, sheet: SheetId, op: CellShift) {
        let names: Vec<(SheetId, String)> = self.sheets();
        let Some(target) = names
            .iter()
            .find(|(id, _)| *id == sheet)
            .map(|(_, n)| n.clone())
        else {
            return;
        };
        for (id, host) in &names {
            let same = *id == sheet;
            let Ok(data) = self.sheet_data_mut(*id) else {
                continue;
            };
            data.conditional_formats.retain_mut(|rule| {
                let (ranges, formulas) = rule.parts_mut();
                shift_rule(ranges, formulas, op, same, host, &target)
            });
            Self::renumber(&mut data.conditional_formats);
            data.validations.retain_mut(|dv| {
                let (ranges, formulas) = dv.parts_mut();
                shift_rule(ranges, formulas, op, same, host, &target)
            });
        }
    }

    /// The conditional formatting of the cells of `range`: one entry per
    /// cell with a non-empty result, in row-major order. Rule formulas are
    /// evaluated per cell; range statistics (top N, average, duplicates,
    /// bar/scale/icon thresholds) once per rule and call. Rules that
    /// cannot match blank cells only look at the used area.
    pub fn effective_cf(&self, range: CellRange) -> Vec<(CellCoord, CfResult)> {
        let sheet = range.sheet;
        let rules = self.cf_rules(sheet);
        if rules.is_empty() {
            return Vec::new();
        }
        let view = CellRect {
            r0: range.r0,
            c0: range.c0,
            r1: range.r1,
            c1: range.c1,
        };
        let used = self.used_range(sheet);
        let ev = Evaluator {
            wb: self,
            sheet,
            scheme: ColorScheme::default(),
        };
        let mut cells: BTreeMap<(u32, u32), (CfResult, bool)> = BTreeMap::new();
        for rule in rules {
            let parts: Vec<CellRect> = rule
                .ranges
                .iter()
                .filter_map(|r| rect_intersection(r, &view))
                .collect();
            if parts.is_empty() {
                continue;
            }
            let Some(anchor) = anchor(&rule.ranges) else {
                continue;
            };
            let prepared = ev.prepare(rule);
            let limit = if prepared.blank_can_match() {
                None
            } else {
                match used {
                    Some(u) => Some(u),
                    None => continue,
                }
            };
            for part in parts {
                let (r1, c1) = match limit {
                    Some((mr, mc)) => (part.r1.min(mr), part.c1.min(mc)),
                    None => (part.r1, part.c1),
                };
                for row in part.r0..=r1 {
                    for col in part.c0..=c1 {
                        let entry = cells.entry((row, col)).or_default();
                        if entry.1 {
                            continue;
                        }
                        let c = CellCoord::new(sheet, row, col);
                        if ev.apply(&prepared, rule, anchor, c, &mut entry.0) && rule.stop_if_true {
                            entry.1 = true;
                        }
                    }
                }
            }
        }
        cells
            .into_iter()
            .filter(|(_, (r, _))| !r.is_empty())
            .map(|((row, col), (mut r, _))| {
                let c = CellCoord::new(sheet, row, col);
                if let Some(code) = r.dxf.as_ref().and_then(|d| d.number_format.as_deref()) {
                    let v = self.value(c);
                    if !matches!(v, Value::Empty) {
                        r.display = Some(crate::numfmt::display_value(&v, Some(code)));
                    }
                }
                (c, r)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::RangeRef;

    fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
        CellRect { r0, c0, r1, c1 }
    }

    fn bold() -> Option<DxfStyle> {
        Some(DxfStyle {
            bold: Some(true),
            ..Default::default()
        })
    }

    fn red() -> Color {
        Color::Rgb(Rgb::new(255, 0, 0))
    }

    fn rule(ranges: Vec<CellRect>, kind: CfKind) -> CfRule {
        CfRule {
            ranges,
            dxf: bold(),
            ..CfRule::new(kind)
        }
    }

    /// A column of numbers in A1:A{n}.
    fn column(values: &[&str]) -> (Workbook, SheetId) {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for (r, v) in values.iter().enumerate() {
            wb.set_input(CellCoord::new(s, r as u32, 0), v).unwrap();
        }
        (wb, s)
    }

    fn hits(wb: &Workbook, s: SheetId) -> Vec<(u32, u32)> {
        wb.effective_cf(RangeRef::new(s, 0, 0, 20, 5))
            .into_iter()
            .map(|(c, _)| (c.row, c.col))
            .collect()
    }

    fn rows(wb: &Workbook, s: SheetId) -> Vec<u32> {
        hits(wb, s).into_iter().map(|(r, _)| r).collect()
    }

    #[test]
    fn compare_ops() {
        let n = Value::Number;
        assert!(CompareOp::Between.test(&n(5.0), &n(10.0), Some(&n(1.0))));
        assert!(CompareOp::Between.test(&n(1.0), &n(1.0), Some(&n(10.0))));
        assert!(!CompareOp::NotBetween.test(&n(5.0), &n(1.0), Some(&n(10.0))));
        assert!(CompareOp::GreaterThan.test(&Value::Text("a".into()), &n(5.0), None));
        assert!(CompareOp::Equal.test(&Value::Empty, &n(0.0), None));
        assert!(CompareOp::Equal.test(
            &Value::Text("ABC".into()),
            &Value::Text("abc".into()),
            None
        ));
        assert!(!CompareOp::Equal.test(
            &Value::Error(engine_formula::ErrorKind::NA),
            &n(0.0),
            None
        ));
        for op in [CompareOp::Between, CompareOp::LessThanOrEqual] {
            assert_eq!(CompareOp::from_name(op.name()), Some(op));
        }
    }

    #[test]
    fn cell_value_and_expression_rules_are_relative() {
        let (mut wb, s) = column(&["1", "5", "10", "20"]);
        for r in 0..4 {
            wb.set_input(CellCoord::new(s, r, 1), "6").unwrap();
        }
        // A1:A4 > B1 (relative): compares each row with its own B cell.
        wb.add_cf_rule(
            s,
            rule(
                vec![rect(0, 0, 3, 0)],
                CfKind::CellIs {
                    op: CompareOp::GreaterThan,
                    formulas: vec!["=B1".into()],
                },
            ),
        )
        .unwrap();
        assert_eq!(rows(&wb, s), [2, 3]);
        assert_eq!(
            wb.cf_rules(s)[0].kind,
            CfKind::CellIs {
                op: CompareOp::GreaterThan,
                formulas: vec!["B1".into()],
            }
        );
        // Expression on row parity, whole range C1:C4 including blanks.
        wb.set_cf_rules(
            s,
            vec![rule(
                vec![rect(0, 2, 3, 2)],
                CfKind::Expression {
                    formula: "MOD(ROW(),2)=0".into(),
                },
            )],
        )
        .unwrap();
        assert_eq!(hits(&wb, s), [(1, 2), (3, 2)]);
        // Between with a $-anchored bound.
        wb.set_input(CellCoord::new(s, 0, 4), "10").unwrap();
        wb.set_cf_rules(
            s,
            vec![rule(
                vec![rect(0, 0, 3, 0)],
                CfKind::CellIs {
                    op: CompareOp::Between,
                    formulas: vec!["5".into(), "$E$1".into()],
                },
            )],
        )
        .unwrap();
        assert_eq!(rows(&wb, s), [1, 2]);
    }

    #[test]
    fn text_blank_and_error_rules() {
        let (wb, s) = column(&["Apple pie", "banana", "", "=1/0", "  "]);
        let mut wb = wb;
        let r = vec![rect(0, 0, 4, 0)];
        let check = |wb: &mut Workbook, kind: CfKind, expected: &[u32]| {
            wb.set_cf_rules(s, vec![rule(r.clone(), kind)]).unwrap();
            assert_eq!(rows(wb, s), expected);
        };
        check(&mut wb, CfKind::ContainsText { text: "PIE".into() }, &[0]);
        check(
            &mut wb,
            CfKind::NotContainsText { text: "an".into() },
            &[0, 2, 3, 4],
        );
        check(&mut wb, CfKind::BeginsWith { text: "b".into() }, &[1]);
        check(&mut wb, CfKind::EndsWith { text: "IE".into() }, &[0]);
        check(&mut wb, CfKind::ContainsBlanks, &[2, 4]);
        check(&mut wb, CfKind::NotContainsBlanks, &[0, 1]);
        check(&mut wb, CfKind::ContainsErrors, &[3]);
        check(&mut wb, CfKind::NotContainsErrors, &[0, 1, 2, 4]);
    }

    #[test]
    fn top_average_and_duplicates() {
        let (mut wb, s) = column(&["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "x", "X"]);
        let r = vec![rect(0, 0, 11, 0)];
        let check = |wb: &mut Workbook, kind: CfKind, expected: &[u32]| {
            wb.set_cf_rules(s, vec![rule(r.clone(), kind)]).unwrap();
            assert_eq!(rows(wb, s), expected);
        };
        check(
            &mut wb,
            CfKind::Top10 {
                rank: 3,
                percent: false,
                bottom: false,
            },
            &[7, 8, 9],
        );
        check(
            &mut wb,
            CfKind::Top10 {
                rank: 20,
                percent: true,
                bottom: true,
            },
            &[0, 1],
        );
        check(
            &mut wb,
            CfKind::AboveAverage {
                above: true,
                equal: false,
                std_dev: None,
            },
            &[5, 6, 7, 8, 9],
        );
        check(
            &mut wb,
            CfKind::AboveAverage {
                above: false,
                equal: true,
                std_dev: None,
            },
            &[0, 1, 2, 3, 4],
        );
        check(&mut wb, CfKind::DuplicateValues, &[10, 11]);
        check(&mut wb, CfKind::UniqueValues, &(0..10).collect::<Vec<_>>());
    }

    #[test]
    fn bars_scales_and_icons() {
        let (mut wb, s) = column(&["0", "50", "100", "text"]);
        let r = vec![rect(0, 0, 3, 0)];
        wb.set_cf_rules(
            s,
            vec![rule(
                r.clone(),
                CfKind::data_bar(red(), CfValue::Min, CfValue::Max, false),
            )],
        )
        .unwrap();
        let res = wb.effective_cf(RangeRef::new(s, 0, 0, 9, 0));
        let bars: Vec<(f64, f64)> = res
            .iter()
            .map(|(_, r)| r.bar.as_ref().map(|b| (b.from, b.to)).unwrap())
            .collect();
        assert_eq!(bars, [(0.0, 0.1), (0.0, 0.5), (0.0, 0.9)]);
        assert!(res[0].1.hide_value && res[0].1.bar.as_ref().unwrap().color == red());

        let white = Color::Rgb(Rgb::WHITE);
        wb.set_cf_rules(
            s,
            vec![rule(
                r.clone(),
                CfKind::ColorScale {
                    points: vec![
                        ColorPoint {
                            value: CfValue::Min,
                            color: white,
                        },
                        ColorPoint {
                            value: CfValue::Max,
                            color: red(),
                        },
                    ],
                },
            )],
        )
        .unwrap();
        let colors: Vec<Option<Color>> = wb
            .effective_cf(RangeRef::new(s, 0, 0, 9, 0))
            .into_iter()
            .map(|(_, r)| r.color)
            .collect();
        assert_eq!(
            colors,
            [
                Some(white),
                Some(Color::Rgb(Rgb::new(255, 128, 128))),
                Some(red())
            ]
        );

        let pct = |p: &str| CfValue::Percent(p.into());
        wb.set_cf_rules(
            s,
            vec![rule(
                r,
                CfKind::IconSet {
                    set: IconSetKind::Arrows3,
                    thresholds: vec![pct("0"), pct("33"), pct("67")],
                    reverse: false,
                    show_value: true,
                    greater: Vec::new(),
                },
            )],
        )
        .unwrap();
        let icons: Vec<Option<u8>> = wb
            .effective_cf(RangeRef::new(s, 0, 0, 9, 0))
            .into_iter()
            .map(|(_, r)| r.icon)
            .collect();
        assert_eq!(icons, [Some(0), Some(1), Some(2)]);
        assert_eq!(
            IconSetKind::from_name("5Quarters").map(IconSetKind::icons),
            Some(5)
        );
    }

    #[test]
    fn priority_merging_and_stop_if_true() {
        let (mut wb, s) = column(&["5", "50"]);
        let r = vec![rect(0, 0, 1, 0)];
        let gt = |n: &str| CfKind::CellIs {
            op: CompareOp::GreaterThan,
            formulas: vec![n.into()],
        };
        let fill = CfRule {
            dxf: Some(DxfStyle {
                fill: Some(red()),
                bold: Some(false),
                ..Default::default()
            }),
            ..rule(r.clone(), gt("1"))
        };
        let first = wb.add_cf_rule(s, fill).unwrap();
        // Added at the top: its bold wins over the lower rule's bold:false.
        let top = wb.add_cf_rule(s, rule(r.clone(), gt("10"))).unwrap();
        assert_eq!(wb.cf_rules(s)[0].id, top);
        let res = wb.effective_cf(RangeRef::new(s, 0, 0, 1, 0));
        let dxf = res[1].1.dxf.clone().unwrap();
        assert_eq!((dxf.bold, dxf.fill), (Some(true), Some(red())));
        assert_eq!(res[0].1.dxf.as_ref().unwrap().bold, Some(false));
        // Stop if true on the top rule hides the lower one for row 1.
        let mut stop = wb.cf_rules(s)[0].clone();
        stop.stop_if_true = true;
        wb.update_cf_rule(s, stop).unwrap();
        let res = wb.effective_cf(RangeRef::new(s, 0, 0, 1, 0));
        assert_eq!(res[1].1.dxf.as_ref().unwrap().fill, None);
        // Reorder, remove, unknown ids.
        assert_eq!(wb.move_cf_rule(s, first, 1).unwrap(), 2);
        assert_eq!(wb.cf_rules(s)[0].id, first);
        assert_eq!(wb.cf_rules(s)[1].priority, 2);
        assert_eq!(wb.remove_cf_rule(s, 99), Err(Error::UnknownRule(99)));
        assert_eq!(wb.remove_cf_rule(s, first).unwrap().priority, 1);
        assert_eq!(wb.cf_rules(s)[0].priority, 1);
        // Malformed rules are rejected.
        assert!(matches!(
            wb.add_cf_rule(s, rule(r.clone(), gt("1+"))),
            Err(Error::InvalidRule(_))
        ));
        let between = CfKind::CellIs {
            op: CompareOp::Between,
            formulas: vec!["1".into()],
        };
        assert!(wb.add_cf_rule(s, rule(r, between)).is_err());
        assert!(wb.add_cf_rule(s, rule(vec![], gt("1"))).is_err());
    }

    #[test]
    fn clear_and_structural_edits() {
        let (mut wb, s) = column(&["1", "2", "3", "4", "5", "6"]);
        let id = wb
            .add_cf_rule(
                s,
                rule(
                    vec![rect(0, 0, 5, 1)],
                    CfKind::Expression {
                        formula: "A1>$A$3".into(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(rows(&wb, s), [3, 4, 5]);
        // Clearing the top rows re-anchors the formula.
        assert!(wb.clear_cf(RangeRef::new(s, 0, 0, 1, 9)).unwrap());
        let r = &wb.cf_rules(s)[0];
        assert_eq!(r.ranges, vec![rect(2, 0, 5, 1)]);
        assert_eq!(
            r.kind,
            CfKind::Expression {
                formula: "A3>$A$3".into()
            }
        );
        assert_eq!(rows(&wb, s), [3, 4, 5]);
        assert!(!wb.clear_cf(RangeRef::new(s, 10, 0, 12, 0)).unwrap());
        // Inserting a row above moves range and references.
        wb.insert_rows(s, 0, 1).unwrap();
        let r = &wb.cf_rules(s)[0];
        assert_eq!(r.ranges, vec![rect(3, 0, 6, 1)]);
        assert_eq!(
            r.kind,
            CfKind::Expression {
                formula: "A4>$A$4".into()
            }
        );
        assert_eq!(rows(&wb, s), [4, 5, 6]);
        // Duplicated sheets and snapshots keep the rules.
        let (copy, _) = wb.duplicate_sheet(s, "Copy").unwrap();
        assert_eq!(wb.cf_rules(copy), wb.cf_rules(s));
        let snap = wb.to_snapshot();
        let back = Workbook::from_snapshot(&snap).unwrap();
        assert_eq!(back.cf_rules(s), wb.cf_rules(s));
        assert_eq!(back.to_snapshot(), snap);
        // Deleting all its rows removes the rule.
        wb.delete_rows(s, 0, 10).unwrap();
        assert!(wb.cf_rules(s).is_empty());
        assert_eq!(wb.remove_cf_rule(s, id), Err(Error::UnknownRule(id)));
    }

    #[test]
    fn serde_shape() {
        let r = CfRule {
            id: 3,
            priority: 1,
            ..rule(
                vec![rect(0, 0, 1, 1)],
                CfKind::data_bar(red(), CfValue::Min, CfValue::Percent("90".into()), true),
            )
        };
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["kind"]["type"], "dataBar");
        assert_eq!(json["kind"]["max"]["type"], "percent");
        assert_eq!(json["kind"]["max"]["value"], "90");
        assert_eq!(json["kind"]["min"]["type"], "min");
        assert_eq!(json["dxf"]["bold"], true);
        let back: CfRule = serde_json::from_value(json).unwrap();
        assert_eq!(back, r);
        assert_eq!(
            serde_json::to_value(IconSetKind::TrafficLights3).unwrap(),
            "3TrafficLights1"
        );
    }

    /// 2024-01-17 (a Wednesday), noon.
    fn wednesday() -> f64 {
        45308.5
    }

    #[test]
    fn date_occurring_periods() {
        // Days around Wed 2024-01-17: Sun 01-07 .. Sat 01-27, and Dec/Feb.
        let today = wednesday() as i64;
        let p = |period: TimePeriod, delta: i64| period.contains(today + delta, today);
        assert!(p(TimePeriod::Today, 0) && !p(TimePeriod::Today, 1));
        assert!(p(TimePeriod::Yesterday, -1) && p(TimePeriod::Tomorrow, 1));
        assert!(p(TimePeriod::Last7Days, -6) && !p(TimePeriod::Last7Days, -7));
        assert!(!p(TimePeriod::Last7Days, 1));
        // This week: Sun 01-14 .. Sat 01-20.
        assert!(p(TimePeriod::ThisWeek, -3) && p(TimePeriod::ThisWeek, 3));
        assert!(!p(TimePeriod::ThisWeek, -4) && !p(TimePeriod::ThisWeek, 4));
        assert!(p(TimePeriod::LastWeek, -4) && p(TimePeriod::LastWeek, -10));
        assert!(!p(TimePeriod::LastWeek, -11));
        assert!(p(TimePeriod::NextWeek, 4) && p(TimePeriod::NextWeek, 10));
        assert!(!p(TimePeriod::NextWeek, 11));
        // Months: January; December 2023; February 2024.
        assert!(p(TimePeriod::ThisMonth, -16) && !p(TimePeriod::ThisMonth, -17));
        assert!(p(TimePeriod::LastMonth, -17) && p(TimePeriod::LastMonth, -47));
        assert!(!p(TimePeriod::LastMonth, -48));
        assert!(p(TimePeriod::NextMonth, 15) && !p(TimePeriod::NextMonth, 14));
        for (period, name) in TIME_PERIODS {
            assert_eq!(TimePeriod::from_name(name), Some(period));
            assert_eq!(period.name(), name);
        }
    }

    #[test]
    fn date_occurring_rule_uses_the_engine_clock() {
        let today = wednesday().floor();
        let days: Vec<String> = [-1.0, 0.0, 1.0, 0.75]
            .iter()
            .map(|d| (today + d).to_string())
            .collect();
        let refs: Vec<&str> = days.iter().map(String::as_str).collect();
        let (mut wb, s) = column(&refs);
        wb.set_input(CellCoord::new(s, 4, 0), "today").unwrap();
        wb.engine_mut().set_now(wednesday);
        let mut rule = rule(
            vec![rect(0, 0, 9, 0)],
            CfKind::TimePeriod {
                period: TimePeriod::Today,
            },
        );
        wb.add_cf_rule(s, rule.clone()).unwrap();
        // Today, and today with a time of day.
        assert_eq!(rows(&wb, s), [1, 3]);
        rule.id = 1;
        rule.kind = CfKind::TimePeriod {
            period: TimePeriod::Yesterday,
        };
        wb.update_cf_rule(s, rule).unwrap();
        assert_eq!(rows(&wb, s), [0]);
    }

    #[test]
    fn above_average_with_standard_deviations() {
        // 1..=9 and 30: average 7.5, population σ ≈ 7.83.
        let vals: Vec<String> = (1..=9)
            .map(|n| n.to_string())
            .chain(["30".into()])
            .collect();
        let refs: Vec<&str> = vals.iter().map(String::as_str).collect();
        let (mut wb, s) = column(&refs);
        let mut check = |above: bool, equal: bool, std_dev: Option<u32>, want: &[u32]| {
            wb.set_cf_rules(
                s,
                vec![rule(
                    vec![rect(0, 0, 9, 0)],
                    CfKind::AboveAverage {
                        above,
                        equal,
                        std_dev,
                    },
                )],
            )
            .unwrap();
            assert_eq!(rows(&wb, s), want, "{above} {equal} {std_dev:?}");
        };
        check(true, false, None, &[7, 8, 9]);
        check(true, false, Some(1), &[9]);
        check(true, false, Some(3), &[]);
        check(false, false, Some(1), &[]);
        check(false, false, None, &[0, 1, 2, 3, 4, 5, 6]);
        // Equal includes the cut: 2 values, σ = 1, avg 1 → 1 + σ = 2.
        let (mut wb, s) = column(&["0", "2"]);
        wb.set_cf_rules(
            s,
            vec![rule(
                vec![rect(0, 0, 1, 0)],
                CfKind::AboveAverage {
                    above: true,
                    equal: true,
                    std_dev: Some(1),
                },
            )],
        )
        .unwrap();
        assert_eq!(rows(&wb, s), [1]);
        let mut bad = rule(
            vec![rect(0, 0, 1, 0)],
            CfKind::AboveAverage {
                above: true,
                equal: false,
                std_dev: Some(4),
            },
        );
        assert!(bad.check().is_err());
        bad.kind = CfKind::TimePeriod {
            period: TimePeriod::NextMonth,
        };
        assert!(bad.check().is_ok());
    }

    #[test]
    fn icon_thresholds_greater_than_and_reverse() {
        let (mut wb, s) = column(&["0", "50", "51", "100"]);
        let num = |n: &str| CfValue::Num(n.into());
        let set = |wb: &mut Workbook, greater: Vec<bool>, reverse: bool| {
            wb.set_cf_rules(
                s,
                vec![rule(
                    vec![rect(0, 0, 3, 0)],
                    CfKind::IconSet {
                        set: IconSetKind::Arrows3,
                        thresholds: vec![num("0"), num("50"), num("100")],
                        reverse,
                        show_value: false,
                        greater,
                    },
                )],
            )
            .unwrap();
            wb.effective_cf(RangeRef::new(s, 0, 0, 9, 0))
                .into_iter()
                .map(|(_, r)| (r.icon.unwrap(), r.hide_value))
                .collect::<Vec<_>>()
        };
        let icons = |v: Vec<(u8, bool)>| v.into_iter().map(|(i, _)| i).collect::<Vec<_>>();
        assert_eq!(icons(set(&mut wb, vec![], false)), [0, 1, 1, 2]);
        assert_eq!(
            icons(set(&mut wb, vec![false, true, true], false)),
            [0, 0, 1, 1]
        );
        assert_eq!(icons(set(&mut wb, vec![], true)), [2, 1, 1, 0]);
        assert!(set(&mut wb, vec![], true).iter().all(|(_, hide)| *hide));
        // `greater` must be empty or one per threshold.
        let mut bad = rule(
            vec![rect(0, 0, 3, 0)],
            CfKind::IconSet {
                set: IconSetKind::Arrows3,
                thresholds: vec![num("0"), num("50"), num("100")],
                reverse: false,
                show_value: true,
                greater: vec![true],
            },
        );
        assert!(bad.check().is_err());
        bad.kind = CfKind::data_bar(red(), CfValue::Min, CfValue::Max, true);
        if let CfKind::DataBar { min_length, .. } = &mut bad.kind {
            *min_length = 95;
        }
        assert!(bad.check().is_err());
    }

    fn bar_spec(lo: f64, hi: f64, axis: DataBarAxis) -> BarSpec {
        BarSpec {
            lo,
            hi,
            color: red(),
            show: true,
            gradient: false,
            border: None,
            negative_color: None,
            negative_border: None,
            axis_color: None,
            axis,
            direction: DataBarDirection::Context,
            min_length: 0.0,
            max_length: 1.0,
        }
    }

    #[test]
    fn data_bar_axis_math() {
        let span = |b: DataBarDraw| (b.from, b.to, b.negative, b.axis);
        // Positive only: no axis, from the left edge.
        let s = bar_spec(0.0, 100.0, DataBarAxis::Automatic);
        assert_eq!(span(s.draw(25.0)), (0.0, 0.25, false, None));
        // -50..150: the axis at 25 %; positive bars scaled by 150 over
        // the right 75 %, negative ones by 50 over the left 25 %.
        let s = bar_spec(-50.0, 150.0, DataBarAxis::Automatic);
        assert_eq!(span(s.draw(150.0)), (0.25, 1.0, false, Some(0.25)));
        assert_eq!(span(s.draw(-50.0)), (0.0, 0.25, true, Some(0.25)));
        assert_eq!(span(s.draw(-25.0)), (0.125, 0.25, true, Some(0.25)));
        let b = s.draw(-25.0);
        assert_eq!(b.color, Color::Rgb(NEGATIVE_BAR_COLOR));
        assert_eq!(b.axis_color, Some(Color::Rgb(Rgb::BLACK)));
        // Midpoint: both sides scaled by the larger extreme.
        let s = bar_spec(-50.0, 100.0, DataBarAxis::Midpoint);
        assert_eq!(span(s.draw(100.0)), (0.5, 1.0, false, Some(0.5)));
        assert_eq!(span(s.draw(-50.0)), (0.25, 0.5, true, Some(0.5)));
        // All negative: the axis on the right edge.
        let s = bar_spec(-10.0, -2.0, DataBarAxis::Automatic);
        assert_eq!(span(s.draw(-10.0)), (0.0, 1.0, true, Some(1.0)));
        // No axis: negative values grow from the left like positive ones.
        let s = bar_spec(-50.0, 50.0, DataBarAxis::None);
        assert_eq!(span(s.draw(-50.0)), (0.0, 0.0, true, None));
        assert_eq!(span(s.draw(50.0)), (0.0, 1.0, false, None));
        // Right to left mirrors bar and axis; lengths 10..90 %.
        let mut s = bar_spec(-50.0, 150.0, DataBarAxis::Automatic);
        s.direction = DataBarDirection::RightToLeft;
        assert_eq!(span(s.draw(150.0)), (0.0, 0.75, false, Some(0.75)));
        let mut s = bar_spec(0.0, 10.0, DataBarAxis::Automatic);
        (s.min_length, s.max_length) = (0.1, 0.9);
        s.negative_border = Some(red());
        assert_eq!(span(s.draw(0.0)), (0.0, 0.1, false, None));
        assert!((s.draw(10.0).to - 0.9).abs() < 1e-12);
        assert_eq!(s.draw(5.0).border, None);
    }

    #[test]
    fn auto_min_max_and_bar_rules_in_the_sheet() {
        let (mut wb, s) = column(&["-10", "0", "30"]);
        let mut kind = CfKind::data_bar(red(), CfValue::AutoMin, CfValue::AutoMax, true);
        if let CfKind::DataBar {
            negative_color,
            min_length,
            max_length,
            gradient,
            ..
        } = &mut kind
        {
            *negative_color = Some(Color::Rgb(Rgb::new(0, 0, 255)));
            (*min_length, *max_length) = (0, 100);
            *gradient = false;
        }
        wb.set_cf_rules(s, vec![rule(vec![rect(0, 0, 2, 0)], kind)])
            .unwrap();
        let res = wb.effective_cf(RangeRef::new(s, 0, 0, 9, 0));
        let bars: Vec<DataBarDraw> = res.into_iter().filter_map(|(_, r)| r.bar).collect();
        assert_eq!(bars.len(), 3);
        assert_eq!(
            (bars[0].from, bars[0].to, bars[0].axis),
            (0.0, 0.25, Some(0.25))
        );
        assert_eq!(bars[0].color, Color::Rgb(Rgb::new(0, 0, 255)));
        assert!(!bars[0].gradient);
        assert_eq!((bars[2].from, bars[2].to), (0.25, 1.0));
        // Positive values only: autoMin is 0.
        let (mut wb, s) = column(&["10", "20"]);
        let kind = CfKind::data_bar(red(), CfValue::AutoMin, CfValue::AutoMax, true);
        wb.set_cf_rules(s, vec![rule(vec![rect(0, 0, 1, 0)], kind)])
            .unwrap();
        let res = wb.effective_cf(RangeRef::new(s, 0, 0, 9, 0));
        let b = res[0].1.bar.as_ref().unwrap();
        assert_eq!((b.from, b.axis), (0.0, None));
        assert!((b.to - 0.5).abs() < 1e-12);
    }

    #[test]
    fn rule_number_formats_change_the_display() {
        let (mut wb, s) = column(&["0.25", "5", "text"]);
        let mut r = rule(vec![rect(0, 0, 2, 0)], CfKind::NotContainsBlanks);
        r.dxf = Some(DxfStyle {
            number_format: Some("0.0%".into()),
            ..Default::default()
        });
        wb.set_cf_rules(s, vec![r]).unwrap();
        let shown: Vec<Option<String>> = wb
            .effective_cf(RangeRef::new(s, 0, 0, 9, 0))
            .into_iter()
            .map(|(_, r)| r.display)
            .collect();
        assert_eq!(
            shown,
            [
                Some("25.0%".to_string()),
                Some("500.0%".to_string()),
                Some("text".to_string())
            ]
        );
    }

    #[test]
    fn expression_rules_are_anchored_at_the_top_left() {
        // B2:C4 with =$B2>B$2: relative parts move per cell from B2.
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for (r, row) in [["5", "1"], ["7", "9"], ["3", "4"]].iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                wb.set_input(CellCoord::new(s, r as u32 + 1, c as u32 + 1), v)
                    .unwrap();
            }
        }
        wb.add_cf_rule(
            s,
            rule(
                vec![rect(1, 1, 3, 2)],
                CfKind::Expression {
                    formula: "=$B2>B$2".into(),
                },
            ),
        )
        .unwrap();
        // B3 (7>5), C2 (5>1), C3 (7>1), C4 (3>1).
        assert_eq!(hits(&wb, s), [(1, 2), (2, 1), (2, 2), (3, 2)]);
    }
}
