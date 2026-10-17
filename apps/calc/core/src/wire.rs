//! TypeScript-only mirrors of the `model-sheet` style types (see
//! [`app_common::wire`] for the rationale). They copy the serde shape of
//! the real types exactly; the real types are what is (de)serialized,
//! these only drive `ts-rs` through `#[ts(as = "...")]`. A test
//! round-trips fully populated values to catch drift.

use app_common::wire::{Color, RunProperties};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Mirror of `model_sheet::BuiltinName`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum BuiltinName {
    PrintArea,
    PrintTitles,
    Criteria,
    Extract,
    ConsolidateArea,
    SheetTitle,
}

/// Mirror of `model_sheet::Fill`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind", content = "color")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum Fill {
    None,
    Solid(Color),
    Pattern(PatternFill),
}

/// Mirror of `model_sheet::PatternType`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum PatternType {
    DarkGray,
    MediumGray,
    LightGray,
    Gray125,
    Gray0625,
    DarkHorizontal,
    DarkVertical,
    DarkDown,
    DarkUp,
    DarkGrid,
    DarkTrellis,
    LightHorizontal,
    LightVertical,
    LightDown,
    LightUp,
    LightGrid,
    LightTrellis,
}

/// Mirror of `model_sheet::PatternFill`: pattern colour `fg` over the
/// background colour `bg` (absent: automatic black / white).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct PatternFill {
    pub pattern: PatternType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fg: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bg: Option<Color>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagonal_up: Option<BorderSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagonal_down: Option<BorderSide>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shrink_to_fit: Option<bool>,
    /// Degrees, `-90..=90`, positive = counter-clockwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_rotation: Option<i16>,
}

/// Mirror of `model_sheet::Protection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Protection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

/// Mirror of `model_sheet::HashedPassword`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct HashedPassword {
    pub algorithm_name: String,
    pub hash_value: String,
    pub salt_value: String,
    pub spin_count: u32,
}

/// Mirror of `model_sheet::Password` (hashes only, never the text).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct Password {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub legacy: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hashed: Option<HashedPassword>,
}

/// Mirror of `model_sheet::SheetProtection`: the `.xlsx` flags, `true` =
/// the action is protected (not allowed); `selectLockedCells` /
/// `selectUnlockedCells` `true` = selecting them is not allowed. Absent
/// flags take Excel's dialog defaults (see `SheetProtection::default`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetProtection {
    pub sheet: bool,
    pub objects: bool,
    pub scenarios: bool,
    pub format_cells: bool,
    pub format_columns: bool,
    pub format_rows: bool,
    pub insert_columns: bool,
    pub insert_rows: bool,
    pub insert_hyperlinks: bool,
    pub delete_columns: bool,
    pub delete_rows: bool,
    pub select_locked_cells: bool,
    pub select_unlocked_cells: bool,
    pub sort: bool,
    pub auto_filter: bool,
    pub pivot_tables: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<Password>,
}

/// Mirror of `model_sheet::WorkbookProtection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct WorkbookProtection {
    pub lock_structure: bool,
    pub lock_windows: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<Password>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protection: Option<Protection>,
    /// Accounting underline (`singleAccounting` / `doubleAccounting`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline_accounting: Option<bool>,
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

fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

/// Mirror of `model_sheet::SheetView`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetView {
    /// How many rows stay visible when scrolling, from `topRow` (0 = none).
    pub frozen_rows: u32,
    /// How many columns stay visible when scrolling, from `leftCol` (0 = none).
    pub frozen_cols: u32,
    /// The first row of the top(-left) pane (`sheetView/@topLeftCell`):
    /// the frozen area starts there; without frozen panes the scroll position.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    #[ts(as = "Option<u32>", optional)]
    pub top_row: u32,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    #[ts(as = "Option<u32>", optional)]
    pub left_col: u32,
    /// The first row / column of the scrolling (bottom-right) pane
    /// (`pane/@topLeftCell`).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    #[ts(as = "Option<u32>", optional)]
    pub pane_row: u32,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    #[ts(as = "Option<u32>", optional)]
    pub pane_col: u32,
    /// View › Split: splitter positions in twips (1/20 pt) from the cell
    /// area's left / top edge (0 = none; ignored while frozen).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    #[ts(as = "Option<u32>", optional)]
    pub split_x: u32,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    #[ts(as = "Option<u32>", optional)]
    pub split_y: u32,
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
    /// Absolute column index (the row of a left-to-right sort).
    pub col: u32,
    /// Ascending, or (colour and icon keys) on top.
    pub ascending: bool,
    /// Absent = `auto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<SortKind>,
    /// Absent = the values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sort_on: Option<SortOn>,
    /// A custom list order (`Mon, Tue, …`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub custom_list: Option<Vec<String>>,
}

/// Mirror of `model_sheet::SortOn`: what a sort level compares.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum SortOn {
    Values,
    /// Cells with this fill (absent: no fill) on top / at the bottom.
    CellColor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<Color>,
    },
    /// Cells with this font colour (absent: automatic).
    FontColor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<Color>,
    },
    Icon {
        set: crate::wire_cf::IconSetKind,
        icon: u8,
    },
}

/// Mirror of `model_sheet::DateGroup`: a year, a month or a day of the
/// AutoFilter's date tree.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct DateGroup {
    pub year: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub month: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub day: Option<u32>,
}

/// Mirror of `model_sheet::LineColors`: the reply to `lineColors`
/// (Sort by Color / Filter by Color choices of a column).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct LineColors {
    /// `null`: no fill.
    pub fills: Vec<Option<Color>>,
    /// `null`: automatic.
    pub fonts: Vec<Option<Color>>,
    pub icons: Vec<(crate::wire_cf::IconSetKind, u8)>,
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
    /// A left-to-right sort: the keys are rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub column_sort: Option<bool>,
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
    /// The date tree: dates in a group, plus the other `values`.
    DateGroups {
        groups: Vec<DateGroup>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        values: Vec<String>,
    },
    /// Filter by Color: the fill (`font`: font colour; absent colour: none / automatic).
    Color {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        color: Option<Color>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        font: bool,
    },
    Icon {
        set: crate::wire_cf::IconSetKind,
        icon: u8,
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
    /// `[year, month, day]` of a date cell (the date tree).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub date: Option<[u32; 3]>,
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
                diagonal_up: Some(side(ms::BorderStyle::Thin)),
                diagonal_down: Some(side(ms::BorderStyle::Dashed)),
            },
            alignment: ms::Alignment {
                horizontal: Some(ms::HAlign::Center),
                vertical: Some(ms::VAlign::Top),
                wrap_text: Some(true),
                indent: Some(2),
                shrink_to_fit: Some(true),
                text_rotation: Some(-45),
            },
            number_format: Some("0.00".into()),
            protection: ms::Protection {
                locked: Some(false),
                hidden: Some(true),
            },
            underline_accounting: Some(true),
        };
        same_shape::<_, CellStyle>(&full);
        for pattern in ms::PatternType::ALL {
            same_shape::<_, Fill>(&ms::Fill::Pattern(ms::PatternFill {
                pattern,
                fg: Some(core_model::Color::Rgb(Rgb::new(1, 2, 3))),
                bg: None,
            }));
        }
        let mut prot = ms::SheetProtection {
            password: ms::Password {
                legacy: Some(0xCC1A),
                hashed: Some(ms::HashedPassword::sha512("x", &[1; 16], 2)),
            },
            ..Default::default()
        };
        same_shape::<_, SheetProtection>(&prot);
        prot.password = ms::Password::default();
        same_shape::<_, SheetProtection>(&prot);
        same_shape::<_, WorkbookProtection>(&ms::WorkbookProtection {
            lock_structure: true,
            ..Default::default()
        });
        same_shape::<_, CellStyle>(&ms::CellStyle::default());
        same_shape::<_, SheetFormat>(&ms::SheetFormat::default());
        let key = |col, ascending, kind| ms::SortKey {
            col,
            ascending,
            kind,
            ..Default::default()
        };
        for kind in [
            ms::SortKind::Auto,
            ms::SortKind::Numbers,
            ms::SortKind::Text,
        ] {
            same_shape::<_, SortKey>(&key(1, false, kind));
        }
        let red = core_model::Color::Rgb(Rgb::new(255, 0, 0));
        for sort_on in [
            ms::SortOn::CellColor { color: Some(red) },
            ms::SortOn::CellColor { color: None },
            ms::SortOn::FontColor { color: Some(red) },
            ms::SortOn::FontColor { color: None },
            ms::SortOn::Icon {
                set: ms::IconSetKind::Arrows3,
                icon: 2,
            },
        ] {
            same_shape::<_, SortKey>(&ms::SortKey {
                sort_on,
                ..ms::SortKey::new(3, false)
            });
        }
        same_shape::<_, SortKey>(&ms::SortKey {
            custom_list: Some(vec!["Mon".into(), "Tue".into()]),
            ..ms::SortKey::new(3, true)
        });
        same_shape::<_, SortState>(&ms::SortState {
            r0: 1,
            c0: 0,
            r1: 9,
            c1: 3,
            keys: vec![key(2, true, ms::SortKind::Auto)],
            column_sort: true,
            ..Default::default()
        });
        same_shape::<_, LineColors>(&ms::LineColors {
            fills: vec![None, Some(red)],
            fonts: vec![Some(red)],
            icons: vec![(ms::IconSetKind::Flags3, 1)],
        });
        for case_sensitive in [false, true] {
            same_shape::<_, SortState>(&ms::SortState {
                r0: 1,
                c0: 0,
                r1: 9,
                c1: 3,
                keys: vec![key(2, true, ms::SortKind::Auto)],
                case_sensitive,
                ..Default::default()
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
        filters.extend([
            ms::Filter::DateGroups {
                groups: vec![
                    ms::DateGroup {
                        year: 2024,
                        month: None,
                        day: None,
                    },
                    ms::DateGroup {
                        year: 2025,
                        month: Some(2),
                        day: Some(28),
                    },
                ],
                values: vec![String::new()],
            },
            ms::Filter::DateGroups {
                groups: vec![],
                values: vec![],
            },
            ms::Filter::Color {
                color: Some(red),
                font: true,
            },
            ms::Filter::Color {
                color: None,
                font: false,
            },
            ms::Filter::Icon {
                set: ms::IconSetKind::Rating5,
                icon: 4,
            },
        ]);
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
            date: None,
        });
        same_shape::<_, FilterValue>(&ms::FilterValue {
            display: "2024-01-05".into(),
            count: 1,
            date: Some([2024, 1, 5]),
        });
        same_shape::<_, SheetView>(&ms::SheetView {
            frozen_rows: 1,
            frozen_cols: 2,
            zoom: 150,
            show_gridlines: false,
            show_headings: true,
            ..ms::SheetView::default()
        });
        same_shape::<_, SheetView>(&ms::SheetView {
            top_row: 4,
            left_col: 1,
            pane_row: 9,
            pane_col: 3,
            split_x: 2400,
            split_y: 1200,
            ..ms::SheetView::default()
        });
    }
}
