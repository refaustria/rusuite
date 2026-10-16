//! TypeScript-only mirrors of the table, text import/export, outline and
//! picture types of `model_sheet` (see [`crate::wire`] for the pattern).
//! A test round-trips populated values to catch drift.

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
    /// Mirror of `model_sheet::TotalsFunction`.
    #[serde(rename_all = "camelCase")]
    pub enum TotalsFunction {
        Average,
        Count,
        CountNums,
        Max,
        Min,
        StdDev,
        Sum,
        Var,
    }

    /// Mirror of `model_sheet::TotalsCell`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum TotalsCell {
        Function { function: TotalsFunction },
        Label { text: String },
        Custom { formula: String },
    }

    /// Mirror of `model_sheet::TableColumn`.
    #[serde(rename_all = "camelCase")]
    pub struct TableColumn {
        pub id: u32,
        pub name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub calculated_formula: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub totals: Option<TotalsCell>,
    }

    /// Mirror of `model_sheet::TableLook`.
    #[serde(rename_all = "camelCase")]
    pub struct TableLook {
        pub first_column: bool,
        pub last_column: bool,
        pub banded_rows: bool,
        pub banded_columns: bool,
    }

    /// Mirror of `model_sheet::Table`.
    #[serde(rename_all = "camelCase")]
    pub struct Table {
        pub id: u32,
        pub name: String,
        pub r0: u32,
        pub c0: u32,
        pub r1: u32,
        pub c1: u32,
        pub header_row: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub totals_row: bool,
        pub columns: Vec<TableColumn>,
        pub style: String,
        pub look: TableLook,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub auto_filter: Option<crate::wire::AutoFilter>,
    }

    /// Mirror of `model_sheet::textio::SplitKind`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum SplitKind {
        Delimited {
            #[serde(default)]
            #[ts(optional, as = "Option<bool>")]
            tab: bool,
            #[serde(default)]
            #[ts(optional, as = "Option<bool>")]
            semicolon: bool,
            #[serde(default)]
            #[ts(optional, as = "Option<bool>")]
            comma: bool,
            #[serde(default)]
            #[ts(optional, as = "Option<bool>")]
            space: bool,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            other: Option<String>,
            #[serde(default)]
            #[ts(optional, as = "Option<bool>")]
            consecutive: bool,
        },
        FixedWidth { breaks: Vec<u32> },
    }

    /// Mirror of `model_sheet::textio::DateOrder`.
    #[serde(rename_all = "camelCase")]
    pub enum DateOrder {
        Mdy,
        Dmy,
        Ymd,
    }

    /// Mirror of `model_sheet::textio::ColumnFormat`.
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum ColumnFormat {
        General,
        Text,
        Date { order: DateOrder },
        Skip,
    }

    /// Mirror of `model_sheet::textio::TextImportOptions`.
    #[serde(rename_all = "camelCase")]
    pub struct TextImportOptions {
        pub split: SplitKind,
        /// `null` = {none}; absent = `"`.
        #[serde(default)]
        #[ts(optional)]
        pub qualifier: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<ColumnFormat>>")]
        pub formats: Vec<ColumnFormat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub decimal: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub thousands: Option<String>,
    }

    /// Mirror of `model_sheet::textio::TextEncoding`.
    #[serde(rename_all = "camelCase")]
    pub enum TextEncoding {
        Utf8,
        Windows1252,
        Utf16Le,
        Utf16Be,
    }

    /// Mirror of `model_sheet::textio::CsvOptions`.
    #[serde(rename_all = "camelCase")]
    pub struct CsvOptions {
        pub separator: String,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        pub bom: bool,
        #[serde(default)]
        #[ts(optional, as = "Option<bool>")]
        pub quote_all: bool,
    }

    /// Mirror of `model_sheet::OutlineProps`.
    #[serde(rename_all = "camelCase")]
    pub struct OutlineProps {
        pub summary_below: bool,
        pub summary_right: bool,
    }

    /// Mirror of `model_sheet::Axis` (rows or columns).
    #[serde(rename_all = "camelCase")]
    pub enum LineAxis {
        Rows,
        Cols,
    }

    /// Mirror of `core_model::Media`: the image bytes as base64.
    #[serde(rename_all = "camelCase")]
    pub struct Media {
        pub content_type: String,
        pub data: String,
    }

    /// Mirror of `model_sheet::Picture`.
    #[serde(rename_all = "camelCase")]
    pub struct Picture {
        pub id: u32,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub name: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub descr: String,
        pub anchor: crate::wire_chart::ChartAnchor,
        pub media: Media,
    }
}

#[cfg(test)]
mod tests {
    use model_sheet as m;
    use serde::de::DeserializeOwned;
    use serde::Serialize;

    fn same_shape<R, M>(real: &R)
    where
        R: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
        M: Serialize + DeserializeOwned,
    {
        let json = serde_json::to_value(real).unwrap();
        let mirror: M = serde_json::from_value(json.clone()).unwrap();
        let again = serde_json::to_value(&mirror).unwrap();
        assert_eq!(json, again);
        assert_eq!(&serde_json::from_value::<R>(again).unwrap(), real);
    }

    #[test]
    fn mirrors_match_the_model() {
        let mut t = m::Table::new(
            4,
            "Sales",
            1,
            2,
            9,
            4,
            &["A".into(), "B".into(), "C".into()],
        );
        t.totals_row = true;
        t.columns[0].totals = Some(m::TotalsCell::Label {
            text: "Total".into(),
        });
        t.columns[1].totals = Some(m::TotalsCell::Function {
            function: m::TotalsFunction::CountNums,
        });
        t.columns[2].totals = Some(m::TotalsCell::Custom {
            formula: "MAX([C])".into(),
        });
        t.columns[2].calculated_formula = Some("[@A]*2".into());
        t.look.first_column = true;
        same_shape::<_, super::Table>(&t);
        for split in [
            m::textio::SplitKind::by(';'),
            m::textio::SplitKind::by('|'),
            m::textio::SplitKind::FixedWidth { breaks: vec![3, 7] },
        ] {
            let o = m::textio::TextImportOptions {
                split,
                qualifier: None,
                formats: vec![
                    m::textio::ColumnFormat::General,
                    m::textio::ColumnFormat::Text,
                    m::textio::ColumnFormat::Date {
                        order: m::textio::DateOrder::Dmy,
                    },
                    m::textio::ColumnFormat::Skip,
                ],
                decimal: ',',
                thousands: '.',
            };
            same_shape::<_, super::TextImportOptions>(&o);
        }
        same_shape::<_, super::CsvOptions>(&m::textio::CsvOptions {
            separator: ';',
            bom: true,
            quote_all: true,
        });
        same_shape::<_, super::OutlineProps>(&m::OutlineProps {
            summary_below: false,
            summary_right: true,
        });
        same_shape::<_, super::Picture>(&m::Picture {
            id: 2,
            name: "Logo".into(),
            descr: "alt".into(),
            anchor: m::ChartAnchor::OneCell {
                from: m::CellOffset {
                    col: 1,
                    row: 2,
                    col_offset: 3,
                    row_offset: 4,
                },
                width: 10,
                height: 20,
            },
            media: core_model::Media {
                content_type: "image/png".into(),
                data: vec![1, 2, 3],
            },
        });
        same_shape::<_, super::TextEncoding>(&m::textio::TextEncoding::Utf16Be);
        same_shape::<_, super::LineAxis>(&m::Axis::Cols);
    }
}
