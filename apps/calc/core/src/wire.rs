//! TypeScript-only mirrors of the `model-sheet` style types (see
//! [`app_common::wire`] for the rationale). They copy the serde shape of
//! the real types exactly; the real types are what is (de)serialized,
//! these only drive `ts-rs` through `#[ts(as = "...")]`. A test
//! round-trips fully populated values to catch drift.

use app_common::wire::{Color, RunProperties};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Mirror of `model_sheet::Fill`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "color")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum Fill {
    None,
    Solid(Color),
}

/// Mirror of `model_sheet::BorderStyle`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum BorderStyle {
    Thin,
    Medium,
    Thick,
    Dashed,
    Dotted,
    Double,
    Hair,
}

/// Mirror of `model_sheet::BorderSide`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct BorderSide {
    pub style: BorderStyle,
    pub color: Color,
}

/// Mirror of `model_sheet::Borders`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Borders {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSide>,
}

/// Mirror of `model_sheet::HAlign`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum HAlign {
    General,
    Left,
    Center,
    Right,
    Fill,
    Justify,
}

/// Mirror of `model_sheet::VAlign`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum VAlign {
    Top,
    Center,
    Bottom,
}

/// Mirror of `model_sheet::Alignment`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Alignment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<HAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical: Option<VAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent: Option<u8>,
}

/// Mirror of `model_sheet::CellStyle`: every part optional (absent =
/// inherit). Used both for the style table and for style patches
/// (`applyStyle`), where only the present parts are merged in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CellStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<RunProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub borders: Option<Borders>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<Alignment>,
    /// Number format code (`"0.00"`, `"yyyy-mm-dd"`); absent = `General`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

/// Mirror of `model_sheet::SheetFormat`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetFormat {
    /// Excel character units (default 8.43).
    pub default_col_width: f64,
    /// Points (default 15).
    pub default_row_height: f64,
}

/// Mirror of `model_sheet::SheetView`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetView {
    /// Rows `0..frozenRows` stay visible when scrolling (0 = none).
    pub frozen_rows: u32,
    /// Columns `0..frozenCols` stay visible when scrolling (0 = none).
    pub frozen_cols: u32,
    /// Percent, 10..=400 (default 100).
    pub zoom: u16,
    pub show_gridlines: bool,
    /// Row numbers and column letters.
    pub show_headings: bool,
}

/// Mirror of `model_sheet::SortKind`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum SortKind {
    /// By value type: numbers < text < logical < errors, blanks last.
    Auto,
    /// Text that looks like a number sorts as that number.
    Numbers,
    /// Numbers sort as text.
    Text,
}

/// Mirror of `model_sheet::SortKey`: one level of a sort.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SortKey {
    /// Absolute column index.
    pub col: u32,
    pub ascending: bool,
    /// Absent = `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<SortKind>,
}

/// Mirror of `model_sheet::SortState`: the last sort of a sheet (rows
/// without the header).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SortState {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    pub keys: Vec<SortKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub case_sensitive: Option<bool>,
}

/// Mirror of `model_sheet::FilterOp`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum FilterOp {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
    Contains,
    NotContains,
    BeginsWith,
    EndsWith,
}

/// Mirror of `model_sheet::Criterion`: a number `value` compares
/// numerically with number cells, other values with the displayed text
/// (case-insensitive; `eq`/`ne` accept `*`, `?`, `~`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Criterion {
    pub op: FilterOp,
    pub value: String,
}

/// Mirror of `model_sheet::DynamicFilter`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum DynamicFilter {
    AboveAverage,
    BelowAverage,
    Today,
    Yesterday,
    Tomorrow,
}

/// Mirror of `model_sheet::Filter`: the filter of one column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum Filter {
    /// Displayed texts to show (case-insensitive); `""` = blanks.
    Values {
        values: Vec<String>,
    },
    /// All (`and`) or any of the criteria.
    Custom {
        criteria: Vec<Criterion>,
        and: bool,
    },
    /// The `value` largest (`top`) or smallest numbers, or `value` %.
    Top10 {
        top: bool,
        percent: bool,
        value: f64,
    },
    Dynamic {
        filter: DynamicFilter,
    },
}

/// Mirror of `model_sheet::FilterColumn`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct FilterColumn {
    /// Absolute column index.
    pub col: u32,
    pub filter: Filter,
}

/// Mirror of `model_sheet::AutoFilter`: the range (header row `r0`) and
/// the filtered columns; the UI shows a dropdown on every header cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct AutoFilter {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<FilterColumn>>")]
    pub columns: Vec<FilterColumn>,
}

/// Mirror of `model_sheet::FilterValue`: one entry of the filter
/// dropdown's value list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct FilterValue {
    /// The displayed text; `""` = blank cells.
    pub display: String,
    pub count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::{Rgb, RunProperties as Run, ThemeColorSlot};
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
        let side = |style| ms::BorderSide {
            style,
            color: core_model::Color::theme(ThemeColorSlot::Accent1),
        };
        let borders = [
            ms::BorderStyle::Thin,
            ms::BorderStyle::Medium,
            ms::BorderStyle::Thick,
            ms::BorderStyle::Dashed,
            ms::BorderStyle::Dotted,
            ms::BorderStyle::Double,
            ms::BorderStyle::Hair,
        ];
        for b in borders {
            same_shape::<_, BorderSide>(&side(b));
        }
        for h in [
            ms::HAlign::General,
            ms::HAlign::Left,
            ms::HAlign::Center,
            ms::HAlign::Right,
            ms::HAlign::Fill,
            ms::HAlign::Justify,
        ] {
            same_shape::<_, HAlign>(&h);
        }
        for v in [ms::VAlign::Top, ms::VAlign::Center, ms::VAlign::Bottom] {
            same_shape::<_, VAlign>(&v);
        }
        same_shape::<_, Fill>(&ms::Fill::None);
        let full = ms::CellStyle {
            font: Run {
                bold: Some(true),
                ..Default::default()
            },
            fill: Some(ms::Fill::Solid(core_model::Color::Rgb(Rgb::new(1, 2, 3)))),
            borders: ms::Borders {
                left: Some(side(ms::BorderStyle::Thin)),
                right: Some(side(ms::BorderStyle::Thick)),
                top: Some(side(ms::BorderStyle::Hair)),
                bottom: Some(side(ms::BorderStyle::Double)),
            },
            alignment: ms::Alignment {
                horizontal: Some(ms::HAlign::Center),
                vertical: Some(ms::VAlign::Top),
                wrap_text: Some(true),
                indent: Some(2),
            },
            number_format: Some("0.00".into()),
        };
        same_shape::<_, CellStyle>(&full);
        same_shape::<_, CellStyle>(&ms::CellStyle::default());
        same_shape::<_, SheetFormat>(&ms::SheetFormat::default());
        let key = |col, ascending, kind| ms::SortKey {
            col,
            ascending,
            kind,
        };
        for kind in [
            ms::SortKind::Auto,
            ms::SortKind::Numbers,
            ms::SortKind::Text,
        ] {
            same_shape::<_, SortKey>(&key(1, false, kind));
        }
        for case_sensitive in [false, true] {
            same_shape::<_, SortState>(&ms::SortState {
                r0: 1,
                c0: 0,
                r1: 9,
                c1: 3,
                keys: vec![key(2, true, ms::SortKind::Auto)],
                case_sensitive,
            });
        }
        let ops = [
            ms::FilterOp::Eq,
            ms::FilterOp::Ne,
            ms::FilterOp::Gt,
            ms::FilterOp::Ge,
            ms::FilterOp::Lt,
            ms::FilterOp::Le,
            ms::FilterOp::Contains,
            ms::FilterOp::NotContains,
            ms::FilterOp::BeginsWith,
            ms::FilterOp::EndsWith,
        ];
        let criteria = ops
            .iter()
            .map(|&op| ms::Criterion {
                op,
                value: "x*".into(),
            })
            .collect();
        let mut filters = vec![
            ms::Filter::Values {
                values: vec!["a".into(), String::new()],
            },
            ms::Filter::Custom {
                criteria,
                and: true,
            },
            ms::Filter::Top10 {
                top: false,
                percent: true,
                value: 12.5,
            },
        ];
        filters.extend(
            [
                ms::DynamicFilter::AboveAverage,
                ms::DynamicFilter::BelowAverage,
                ms::DynamicFilter::Today,
                ms::DynamicFilter::Yesterday,
                ms::DynamicFilter::Tomorrow,
            ]
            .map(|filter| ms::Filter::Dynamic { filter }),
        );
        let mut af = ms::AutoFilter::new(0, 1, 20, 9);
        same_shape::<_, AutoFilter>(&af);
        af.columns = filters
            .into_iter()
            .enumerate()
            .map(|(i, filter)| ms::FilterColumn {
                col: i as u32 + 1,
                filter,
            })
            .collect();
        same_shape::<_, AutoFilter>(&af);
        same_shape::<_, FilterValue>(&ms::FilterValue {
            display: "x".into(),
            count: 3,
        });
        same_shape::<_, SheetView>(&ms::SheetView {
            frozen_rows: 1,
            frozen_cols: 2,
            zoom: 150,
            show_gridlines: false,
            show_headings: true,
        });
    }
}
