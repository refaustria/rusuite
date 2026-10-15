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
        same_shape::<_, SheetView>(&ms::SheetView {
            frozen_rows: 1,
            frozen_cols: 2,
            zoom: 150,
            show_gridlines: false,
            show_headings: true,
        });
    }
}
