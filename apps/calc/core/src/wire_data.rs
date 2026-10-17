//! TypeScript-only mirrors of the P9-C2 model types: custom table styles
//! and slicers (see [`crate::wire`] for the pattern). A test round-trips
//! populated values to catch drift.

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

fn is_one(v: &u32) -> bool {
    *v == 1
}

fn one() -> u32 {
    1
}

mirror! {
    /// Mirror of `model_sheet::TableStyleElementType`.
    #[serde(rename_all = "camelCase")]
    pub enum TableStyleElementType {
        WholeTable,
        HeaderRow,
        TotalRow,
        FirstColumn,
        LastColumn,
        FirstRowStripe,
        SecondRowStripe,
        FirstColumnStripe,
        SecondColumnStripe,
    }

    /// Mirror of `model_sheet::TableStyleElement`.
    #[serde(rename_all = "camelCase")]
    pub struct TableStyleElement {
        #[serde(rename = "type")]
        pub kind: TableStyleElementType,
        /// Stripe size (1–9); absent = 1.
        #[serde(default = "one", skip_serializing_if = "is_one")]
        #[ts(optional, as = "Option<u32>")]
        pub size: u32,
        pub dxf: crate::wire_cf::DxfStyle,
    }

    /// Mirror of `model_sheet::CustomTableStyle`.
    #[serde(rename_all = "camelCase")]
    pub struct CustomTableStyle {
        pub name: String,
        pub elements: Vec<TableStyleElement>,
    }

    /// Mirror of `model_sheet::TableStyles`.
    #[serde(rename_all = "camelCase")]
    pub struct TableStyles {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<CustomTableStyle>>")]
        pub custom: Vec<CustomTableStyle>,
        /// Absent = `TableStyleMedium2`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub default_style: Option<String>,
    }

    /// Mirror of `model_sheet::ConsolidateFunction`.
    #[serde(rename_all = "camelCase")]
    pub enum ConsolidateFunction {
        Sum,
        Count,
        Average,
        Max,
        Min,
        Product,
        CountNums,
        StdDev,
        StdDevP,
        Var,
        VarP,
    }

    /// Mirror of `model_sheet::SlicerSource`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum SlicerSource {
        Table { table: u32, column: u32 },
        Pivot {
            cache: u32,
            field: u32,
            #[serde(default)]
            pivots: Vec<u32>,
        },
    }

    /// Mirror of `model_sheet::SlicerSort`.
    #[serde(rename_all = "camelCase")]
    pub enum SlicerSort {
        Ascending,
        Descending,
    }

    /// Mirror of `model_sheet::SlicerCache`.
    #[serde(rename_all = "camelCase")]
    pub struct SlicerCache {
        pub name: String,
        pub source_name: String,
        pub source: SlicerSource,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<u32>>")]
        pub hidden: Vec<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub sort: Option<SlicerSort>,
    }

    /// Mirror of `model_sheet::Slicer`.
    #[serde(rename_all = "camelCase")]
    pub struct Slicer {
        pub id: u32,
        pub name: String,
        pub cache: String,
        pub caption: String,
        /// Absent = shown.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub show_caption: Option<bool>,
        /// Absent = 1.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub columns: Option<u32>,
        /// Button height in EMU; absent = 241300.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, as = "Option<f64>")]
        pub row_height: Option<i64>,
        pub style: String,
        pub anchor: crate::wire_chart::ChartAnchor,
    }

    /// Mirror of `model_sheet::SlicerItem`.
    #[serde(rename_all = "camelCase")]
    pub struct SlicerItem {
        pub name: String,
        pub selected: bool,
        pub has_data: bool,
    }
}

#[cfg(test)]
mod tests {
    use model_sheet as m;
    use serde::de::DeserializeOwned;
    use serde::Serialize;

    pub(crate) fn same_shape<R, M>(real: &R)
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
        let styles = m::TableStyles {
            custom: vec![m::CustomTableStyle {
                name: "Mine".into(),
                elements: vec![
                    m::TableStyleElement {
                        kind: m::TableStyleElementType::HeaderRow,
                        size: 1,
                        dxf: m::DxfStyle {
                            bold: Some(true),
                            fill: Some(core_model::Color::Rgb(core_model::Rgb::new(1, 2, 3))),
                            ..Default::default()
                        },
                    },
                    m::TableStyleElement {
                        kind: m::TableStyleElementType::SecondColumnStripe,
                        size: 3,
                        dxf: m::DxfStyle::default(),
                    },
                ],
            }],
            default_style: Some("Mine".into()),
        };
        same_shape::<_, super::TableStyles>(&styles);
        same_shape::<_, super::TableStyles>(&m::TableStyles::default());
        let cache = m::SlicerCache {
            name: "Slicer_Region".into(),
            source_name: "Region".into(),
            source: m::SlicerSource::Pivot {
                cache: 1,
                field: 2,
                pivots: vec![3, 4],
            },
            hidden: [1, 5].into_iter().collect(),
            sort: m::SlicerSort::Descending,
        };
        same_shape::<_, super::SlicerCache>(&cache);
        same_shape::<_, super::SlicerCache>(&m::SlicerCache {
            source: m::SlicerSource::Table {
                table: 1,
                column: 2,
            },
            hidden: Default::default(),
            sort: m::SlicerSort::Ascending,
            ..cache
        });
        let slicer = m::Slicer {
            id: 1,
            name: "Region".into(),
            cache: "Slicer_Region".into(),
            caption: "Region".into(),
            show_caption: false,
            columns: 3,
            row_height: 300_000,
            style: "SlicerStyleDark2".into(),
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
        };
        same_shape::<_, super::Slicer>(&slicer);
        same_shape::<_, super::Slicer>(&m::Slicer {
            show_caption: true,
            columns: 1,
            row_height: m::slicer::DEFAULT_ROW_HEIGHT,
            ..slicer
        });
        for f in [
            m::ConsolidateFunction::Sum,
            m::ConsolidateFunction::CountNums,
            m::ConsolidateFunction::StdDevP,
            m::ConsolidateFunction::VarP,
        ] {
            same_shape::<_, super::ConsolidateFunction>(&f);
        }
        same_shape::<_, super::SlicerItem>(&m::SlicerItem {
            name: "East".into(),
            selected: true,
            has_data: false,
        });
    }
}
