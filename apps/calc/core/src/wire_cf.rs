//! TypeScript-only mirrors of the conditional formatting and data
//! validation types of `model-sheet` (see [`crate::wire`] for the
//! pattern): they copy the serde shape of the real types, which are what
//! is (de)serialized; a test round-trips populated values to catch drift.

use app_common::wire::Color;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::Rect;
use crate::wire::Borders;

/// Mirror of `model_sheet::CompareOp`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
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

/// Mirror of `model_sheet::DxfStyle`: the format a highlight rule
/// applies; absent = the cell's own formatting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct DxfStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub font_color: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub underline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub strike: Option<bool>,
    /// Solid background.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fill: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub borders: Option<Borders>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub number_format: Option<String>,
}

/// Mirror of `model_sheet::CfValue`: a threshold. The strings are numbers
/// or formulas without `=` (evaluated at the rule's top-left cell).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CfValue {
    Min,
    Max,
    Num(String),
    Percent(String),
    Percentile(String),
    Formula(String),
}

/// Mirror of `model_sheet::ColorPoint`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct ColorPoint {
    pub value: CfValue,
    pub color: Color,
}

/// Mirror of `model_sheet::IconSetKind` (SpreadsheetML names).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "apps/calc/src/generated/")]
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

/// Mirror of `model_sheet::CfKind`: what a rule tests or draws. Text
/// tests are case-insensitive; `iconSet.thresholds` has one entry per
/// icon, lowest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CfKind {
    CellIs {
        op: CompareOp,
        formulas: Vec<String>,
    },
    Expression {
        formula: String,
    },
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
    ContainsBlanks,
    NotContainsBlanks,
    ContainsErrors,
    NotContainsErrors,
    Top10 {
        rank: u32,
        percent: bool,
        bottom: bool,
    },
    AboveAverage {
        above: bool,
        equal: bool,
    },
    DuplicateValues,
    UniqueValues,
    DataBar {
        color: Color,
        min: CfValue,
        max: CfValue,
        show_value: bool,
    },
    ColorScale {
        points: Vec<ColorPoint>,
    },
    IconSet {
        set: IconSetKind,
        thresholds: Vec<CfValue>,
        reverse: bool,
        show_value: bool,
    },
}

/// Mirror of `model_sheet::CfRule`. Formulas are written for the top-left
/// cell of the ranges' bounding box (relative references shift per cell);
/// a leading `=` is accepted. Adding: `id` 0 = assign, `priority` = the
/// position (1 or 0 = top).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CfRule {
    pub id: u32,
    pub ranges: Vec<Rect>,
    pub priority: u32,
    pub stop_if_true: bool,
    pub kind: CfKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dxf: Option<DxfStyle>,
}

/// Mirror of `model_sheet::CfResult`: the conditional formatting of one
/// cell (combined over its rules).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CfResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dxf: Option<DxfStyle>,
    /// Data bar length, 0..=1 of the full bar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bar: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bar_color: Option<Color>,
    /// Colour scale background.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<Color>,
    /// Index into `iconSet`, 0 = the icon of the lowest values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub icon: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub icon_set: Option<IconSetKind>,
    /// Draw only the bar/icon, not the value.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub hide_value: bool,
}

/// Mirror of `model_sheet::ListSource`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum ListSource {
    /// A range such as `$A$1:$A$9` or `Other!$B$1:$B$5` (no `=`).
    Formula {
        formula: String,
    },
    Literal {
        values: Vec<String>,
    },
}

/// Mirror of `model_sheet::ValidationKind`: `f1`/`f2` are numbers or
/// formulas (`f2` only for `between`/`notBetween`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum ValidationKind {
    Any,
    List {
        source: ListSource,
    },
    Whole {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        f2: Option<String>,
    },
    Decimal {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        f2: Option<String>,
    },
    Date {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        f2: Option<String>,
    },
    Time {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        f2: Option<String>,
    },
    TextLength {
        op: CompareOp,
        f1: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        f2: Option<String>,
    },
    Custom {
        formula: String,
    },
}

/// Mirror of `model_sheet::ErrorStyle`: what the UI does on a failed
/// check (`stop` rejects, `warning` asks, `information` informs).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum ErrorStyle {
    Stop,
    Warning,
    Information,
}

/// Mirror of `model_sheet::DataValidation`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct DataValidation {
    pub ranges: Vec<Rect>,
    pub kind: ValidationKind,
    /// "Ignore blank".
    pub allow_blank: bool,
    /// In-cell dropdown of a list.
    pub show_dropdown: bool,
    pub show_input: bool,
    /// Check input at all.
    pub show_error: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub input_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub input_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_message: Option<String>,
    pub error_style: ErrorStyle,
}

/// Mirror of `model_sheet::ValidationResult`: the reply to
/// `validateInput`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct ValidationResult {
    pub ok: bool,
    /// Index of the cell's validation in the sheet's list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rule: Option<u32>,
    /// Set when the check failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_style: Option<ErrorStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::{Rgb, ThemeColorSlot};
    use engine_formula::CellRect;
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
    fn mirrors_match_model_sheet() {
        let red = core_model::Color::Rgb(Rgb::new(255, 0, 0));
        let theme = core_model::Color::theme(ThemeColorSlot::Accent1);
        let dxf = ms::DxfStyle {
            font_color: Some(red),
            bold: Some(true),
            italic: Some(false),
            underline: Some(true),
            strike: Some(false),
            fill: Some(theme),
            borders: ms::Borders {
                top: Some(ms::BorderSide {
                    style: ms::BorderStyle::Thin,
                    color: red,
                }),
                ..Default::default()
            },
            number_format: Some("0%".into()),
        };
        same_shape::<_, DxfStyle>(&dxf);
        same_shape::<_, DxfStyle>(&ms::DxfStyle::default());
        let v = |s: &str| s.to_string();
        let values = [
            ms::CfValue::Min,
            ms::CfValue::Max,
            ms::CfValue::Num(v("1")),
            ms::CfValue::Percent(v("50")),
            ms::CfValue::Percentile(v("90")),
            ms::CfValue::Formula(v("$A$1")),
        ];
        let ops = [
            ms::CompareOp::Between,
            ms::CompareOp::NotBetween,
            ms::CompareOp::Equal,
            ms::CompareOp::NotEqual,
            ms::CompareOp::GreaterThan,
            ms::CompareOp::LessThan,
            ms::CompareOp::GreaterThanOrEqual,
            ms::CompareOp::LessThanOrEqual,
        ];
        let mut kinds: Vec<ms::CfKind> = ops
            .iter()
            .map(|&op| ms::CfKind::CellIs {
                op,
                formulas: vec![v("1"), v("A1")],
            })
            .collect();
        kinds.extend([
            ms::CfKind::Expression { formula: v("A1") },
            ms::CfKind::ContainsText { text: v("a") },
            ms::CfKind::NotContainsText { text: v("a") },
            ms::CfKind::BeginsWith { text: v("a") },
            ms::CfKind::EndsWith { text: v("a") },
            ms::CfKind::ContainsBlanks,
            ms::CfKind::NotContainsBlanks,
            ms::CfKind::ContainsErrors,
            ms::CfKind::NotContainsErrors,
            ms::CfKind::Top10 {
                rank: 5,
                percent: true,
                bottom: false,
            },
            ms::CfKind::AboveAverage {
                above: false,
                equal: true,
            },
            ms::CfKind::DuplicateValues,
            ms::CfKind::UniqueValues,
            ms::CfKind::DataBar {
                color: red,
                min: values[0].clone(),
                max: values[1].clone(),
                show_value: false,
            },
            ms::CfKind::ColorScale {
                points: values
                    .iter()
                    .map(|value| ms::ColorPoint {
                        value: value.clone(),
                        color: theme,
                    })
                    .collect(),
            },
        ]);
        for set in [
            "3Arrows",
            "3ArrowsGray",
            "3Flags",
            "3TrafficLights1",
            "3TrafficLights2",
            "3Signs",
            "3Symbols",
            "3Symbols2",
            "4Arrows",
            "4ArrowsGray",
            "4RedToBlack",
            "4Rating",
            "4TrafficLights",
            "5Arrows",
            "5ArrowsGray",
            "5Rating",
            "5Quarters",
        ] {
            let set = ms::IconSetKind::from_name(set).unwrap();
            same_shape::<_, IconSetKind>(&set);
            kinds.push(ms::CfKind::IconSet {
                set,
                thresholds: values.to_vec(),
                reverse: true,
                show_value: true,
            });
        }
        for (i, kind) in kinds.into_iter().enumerate() {
            let rule = ms::CfRule {
                id: i as u32 + 1,
                ranges: vec![CellRect {
                    r0: 0,
                    c0: 1,
                    r1: 2,
                    c1: 3,
                }],
                priority: 2,
                stop_if_true: i % 2 == 0,
                kind,
                dxf: (i % 3 == 0).then(|| dxf.clone()),
            };
            same_shape::<_, CfRule>(&rule);
        }
        same_shape::<_, CfResult>(&ms::CfResult::default());
        same_shape::<_, CfResult>(&ms::CfResult {
            dxf: Some(dxf),
            bar: Some(0.5),
            bar_color: Some(red),
            color: Some(theme),
            icon: Some(2),
            icon_set: Some(ms::IconSetKind::Arrows3),
            hide_value: true,
        });

        let cmp = |op| (op, v("1"), Some(v("$B$2")));
        let mut vkinds = vec![
            ms::ValidationKind::Any,
            ms::ValidationKind::List {
                source: ms::ListSource::Formula {
                    formula: v("$A$1:$A$3"),
                },
            },
            ms::ValidationKind::List {
                source: ms::ListSource::Literal {
                    values: vec![v("a"), v("b")],
                },
            },
            ms::ValidationKind::Custom { formula: v("A1>0") },
        ];
        for op in ops {
            let (op, f1, f2) = cmp(op);
            vkinds.extend([
                ms::ValidationKind::Whole {
                    op,
                    f1: f1.clone(),
                    f2: f2.clone(),
                },
                ms::ValidationKind::Decimal {
                    op,
                    f1: f1.clone(),
                    f2: None,
                },
                ms::ValidationKind::Date {
                    op,
                    f1: f1.clone(),
                    f2: f2.clone(),
                },
                ms::ValidationKind::Time {
                    op,
                    f1: f1.clone(),
                    f2: None,
                },
                ms::ValidationKind::TextLength { op, f1, f2 },
            ]);
        }
        let styles = [
            ms::ErrorStyle::Stop,
            ms::ErrorStyle::Warning,
            ms::ErrorStyle::Information,
        ];
        for (i, kind) in vkinds.into_iter().enumerate() {
            let mut dv = ms::DataValidation::new(
                vec![CellRect {
                    r0: 1,
                    c0: 1,
                    r1: 1,
                    c1: 1,
                }],
                kind,
            );
            dv.error_style = styles[i % 3];
            if i % 2 == 0 {
                dv.allow_blank = false;
                dv.input_title = Some(v("t"));
                dv.input_message = Some(v("m"));
                dv.error_title = Some(v("e"));
                dv.error_message = Some(v("x"));
            }
            same_shape::<_, DataValidation>(&dv);
        }
        same_shape::<_, ValidationResult>(&ms::ValidationResult::default());
        same_shape::<_, ValidationResult>(&ms::ValidationResult {
            ok: false,
            rule: Some(1),
            error_style: Some(ms::ErrorStyle::Warning),
            title: Some(v("t")),
            message: Some(v("m")),
        });
    }
}
