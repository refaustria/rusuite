//! TypeScript-only mirrors of the pivot table types of
//! `model_sheet::pivot` (see [`crate::wire`] for the pattern). Fields the
//! model fills with defaults when they are absent are optional here, so
//! the UI may leave them out. A test round-trips populated values to
//! catch drift.

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
    /// Mirror of `model_sheet::pivot::Item`: a distinct value of a cache
    /// field (`{"t":"text","v":"East"}`, `{"t":"blank"}`).
    #[serde(tag = "t", content = "v", rename_all = "camelCase")]
    pub enum PivotItem {
        Blank,
        Number(f64),
        Text(String),
        Bool(bool),
        /// The error's text (`#N/A`).
        Error(String),
    }

    /// Mirror of `model_sheet::pivot::PivotSource`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum PivotSource {
        Range { sheet: String, r0: u32, c0: u32, r1: u32, c1: u32 },
        Table { name: String },
        Name { name: String },
    }

    /// Mirror of `model_sheet::pivot::FieldKind`.
    #[serde(rename_all = "camelCase")]
    pub enum FieldKind {
        Number,
        Text,
        Date,
        Mixed,
    }

    /// Mirror of `model_sheet::pivot::CacheField`.
    #[serde(rename_all = "camelCase")]
    pub struct CacheField {
        pub name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub shared_items: Option<Vec<PivotItem>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub kind: Option<FieldKind>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub contains_blank: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub number_format: Option<String>,
    }

    /// Mirror of `model_sheet::pivot::RawPivotXml`.
    #[serde(rename_all = "camelCase")]
    pub struct RawPivotXml {
        pub reason: String,
        pub xml: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub records: Option<String>,
    }

    /// Mirror of `model_sheet::pivot::PivotCache`.
    #[serde(rename_all = "camelCase")]
    pub struct PivotCache {
        pub id: u32,
        pub source: PivotSource,
        pub fields: Vec<CacheField>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub records: Option<Vec<Vec<PivotItem>>>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub refresh_on_load: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub stale: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub raw: Option<RawPivotXml>,
    }

    /// Mirror of `model_sheet::pivot::SortOrder`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum SortOrder {
        Ascending,
        Descending,
        /// Shared item indices first, in this order.
        Manual { order: Vec<u32> },
    }

    /// Mirror of `model_sheet::pivot::AggFunc`.
    #[serde(rename_all = "camelCase")]
    pub enum AggFunc {
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

    /// Mirror of `model_sheet::pivot::Subtotals`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum Subtotals {
        Automatic,
        None,
        Custom { functions: Vec<AggFunc> },
    }

    /// Mirror of `model_sheet::pivot::PivotLayout`.
    #[serde(rename_all = "camelCase")]
    pub enum PivotLayout {
        Compact,
        Outline,
        Tabular,
    }

    /// Mirror of `model_sheet::pivot::AxisField`: a row or column field.
    #[serde(rename_all = "camelCase")]
    pub struct AxisField {
        /// Cache field index.
        pub field: u32,
        /// Absent = ascending.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub sort: Option<SortOrder>,
        /// Absent = automatic.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub subtotals: Option<Subtotals>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_all_items: bool,
        /// Shared item indices.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<u32>>")]
        pub collapsed_items: Vec<u32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<u32>>")]
        pub hidden_items: Vec<u32>,
        /// Absent = compact.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub layout: Option<PivotLayout>,
    }

    /// Mirror of `model_sheet::pivot::PageSelection`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum PageSelection {
        All,
        Items { items: Vec<u32> },
    }

    /// Mirror of `model_sheet::pivot::PageField`: a filter field.
    #[serde(rename_all = "camelCase")]
    pub struct PageField {
        pub field: u32,
        /// Absent = all.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub selected: Option<PageSelection>,
    }

    /// Mirror of `model_sheet::pivot::BaseItem`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum BaseItem {
        Item { item: u32 },
        Previous,
        Next,
    }

    /// Mirror of `model_sheet::pivot::ShowAs`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum ShowAs {
        Normal,
        PercentOfTotal,
        PercentOfRow,
        PercentOfColumn,
        PercentOfParent,
        DifferenceFrom { base_field: u32, base_item: BaseItem },
        RunningTotal { base_field: u32 },
        Rank { base_field: u32 },
    }

    /// Mirror of `model_sheet::pivot::DataField`: a field in the values
    /// area.
    #[serde(rename_all = "camelCase")]
    pub struct DataField {
        pub field: u32,
        /// Absent = `"<Func> of <field>"`.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub name: String,
        /// Absent = sum.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub func: Option<AggFunc>,
        /// Absent = normal.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub show_as: Option<ShowAs>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub number_format: Option<String>,
    }

    /// Mirror of `model_sheet::pivot::ValuesAxis`.
    #[serde(rename_all = "camelCase")]
    pub enum ValuesAxis {
        Rows,
        Columns,
    }

    /// Mirror of `model_sheet::pivot::PivotOptions` (absent = Excel's
    /// default: grand totals on, row/column headers on, not banded,
    /// `PivotStyleLight16`, values on columns, last, empty cells blank,
    /// errors shown, labels not repeated, field headers shown, indent 1).
    #[serde(rename_all = "camelCase")]
    pub struct PivotOptions {
        /// Excel's `rowGrandTotals`: the Grand Total column on the right.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub grand_total_rows: Option<bool>,
        /// Excel's `colGrandTotals`: the Grand Total row at the bottom.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub grand_total_cols: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub row_headers_bold: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub col_headers_bold: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub banded: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub style: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub values_in: Option<ValuesAxis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub values_position: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub empty_as: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub error_as: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub repeat_labels: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub show_field_headers: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub compact_rows_indent: Option<u8>,
    }

    /// Mirror of `model_sheet::pivot::PivotRect` (inclusive).
    #[serde(rename_all = "camelCase")]
    pub struct PivotRect {
        pub r0: u32,
        pub c0: u32,
        pub r1: u32,
        pub c1: u32,
    }

    /// Mirror of `model_sheet::pivot::PivotTable`.
    #[serde(rename_all = "camelCase")]
    pub struct PivotTable {
        pub id: u32,
        pub name: String,
        pub cache_id: u32,
        /// Everything the table occupies (page fields included).
        pub location: PivotRect,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub rows: Option<Vec<AxisField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub cols: Option<Vec<AxisField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub filters: Option<Vec<PageField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub values: Option<Vec<DataField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub options: Option<PivotOptions>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub raw: Option<RawPivotXml>,
    }

    /// Mirror of `model_sheet::pivot::PivotFields`: the fields of a new
    /// pivot table.
    #[serde(rename_all = "camelCase")]
    pub struct PivotFields {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub rows: Option<Vec<AxisField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub cols: Option<Vec<AxisField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub values: Option<Vec<DataField>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub filters: Option<Vec<PageField>>,
    }

    /// Mirror of `model_sheet::pivot::CellRole`: what a pivot cell is.
    #[serde(rename_all = "camelCase")]
    pub enum PivotCellKind {
        Header,
        RowLabel,
        ColLabel,
        Value,
        Subtotal,
        GrandTotal,
        Page,
        Blank,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use model_sheet::pivot as m;
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
        let back: R = serde_json::from_value(again).unwrap();
        assert_eq!(&back, real);
    }

    #[test]
    fn mirrors_match_the_pivot_model() {
        let cache = m::PivotCache {
            id: 3,
            source: m::PivotSource::range("Data", 0, 0, 9, 3),
            fields: vec![
                m::CacheField {
                    name: "Region".into(),
                    shared_items: vec![
                        m::Item::Text("East".into()),
                        m::Item::Number(2.5),
                        m::Item::Bool(true),
                        m::Item::Error("#N/A".into()),
                        m::Item::Blank,
                    ],
                    kind: m::FieldKind::Mixed,
                    contains_blank: true,
                    number_format: Some("0.0".into()),
                },
                m::CacheField::new("Sales"),
            ],
            records: vec![vec![m::Item::Text("East".into()), m::Item::Number(1.0)]],
            refresh_on_load: true,
            stale: true,
            raw: Some(m::RawPivotXml {
                reason: "OLAP".into(),
                xml: "<x/>".into(),
                records: Some("<r/>".into()),
            }),
        };
        same_shape::<_, super::PivotCache>(&cache);
        same_shape::<_, super::PivotSource>(&m::PivotSource::Name { name: "N".into() });
        same_shape::<_, super::PivotSource>(&m::PivotSource::Table { name: "T".into() });
        let mut t = m::PivotTable::new(7, "PivotTable7", 3, 2, 1);
        t.rows = vec![
            m::AxisField {
                field: 0,
                sort: m::SortOrder::Manual { order: vec![1, 0] },
                subtotals: m::Subtotals::Custom {
                    functions: m::AggFunc::ALL.to_vec(),
                },
                show_all_items: true,
                collapsed_items: BTreeSet::from([1]),
                hidden_items: BTreeSet::from([2, 3]),
                layout: m::PivotLayout::Tabular,
            },
            m::AxisField {
                sort: m::SortOrder::Descending,
                subtotals: m::Subtotals::None,
                layout: m::PivotLayout::Outline,
                ..1.into()
            },
        ];
        t.cols = vec![2.into()];
        t.filters = vec![
            m::PageField {
                field: 3,
                selected: m::PageSelection::Items {
                    items: BTreeSet::from([0, 4]),
                },
            },
            m::PageField {
                field: 4,
                selected: m::PageSelection::All,
            },
        ];
        let shows = [
            m::ShowAs::Normal,
            m::ShowAs::PercentOfTotal,
            m::ShowAs::PercentOfRow,
            m::ShowAs::PercentOfColumn,
            m::ShowAs::PercentOfParent,
            m::ShowAs::DifferenceFrom {
                base_field: 1,
                base_item: m::BaseItem::Item { item: 2 },
            },
            m::ShowAs::DifferenceFrom {
                base_field: 1,
                base_item: m::BaseItem::Previous,
            },
            m::ShowAs::DifferenceFrom {
                base_field: 1,
                base_item: m::BaseItem::Next,
            },
            m::ShowAs::RunningTotal { base_field: 0 },
            m::ShowAs::Rank { base_field: 0 },
        ];
        t.values = shows
            .iter()
            .zip(m::AggFunc::ALL.iter().cycle())
            .map(|(s, f)| m::DataField {
                field: 1,
                name: "x".into(),
                func: *f,
                show_as: *s,
                number_format: Some("0%".into()),
            })
            .collect();
        t.options = m::PivotOptions {
            grand_total_rows: false,
            grand_total_cols: false,
            row_headers_bold: false,
            col_headers_bold: false,
            banded: true,
            style: "PivotStyleDark2".into(),
            values_in: m::ValuesAxis::Rows,
            values_position: Some(1),
            empty_as: "-".into(),
            error_as: Some("e".into()),
            repeat_labels: true,
            show_field_headers: false,
            compact_rows_indent: 3,
        };
        same_shape::<_, super::PivotTable>(&t);
        same_shape::<_, super::PivotTable>(&m::PivotTable::new(1, "P", 1, 0, 0));
        same_shape::<_, super::PivotFields>(&m::PivotFields {
            rows: t.rows.clone(),
            cols: t.cols.clone(),
            values: t.values.clone(),
            filters: t.filters.clone(),
        });
        for role in [
            m::CellRole::Header,
            m::CellRole::RowLabel,
            m::CellRole::ColLabel,
            m::CellRole::Value,
            m::CellRole::Subtotal,
            m::CellRole::GrandTotal,
            m::CellRole::Page,
            m::CellRole::Blank,
        ] {
            same_shape::<_, super::PivotCellKind>(&role);
        }
        for k in [
            m::FieldKind::Number,
            m::FieldKind::Text,
            m::FieldKind::Date,
            m::FieldKind::Mixed,
        ] {
            same_shape::<_, super::FieldKind>(&k);
        }
    }
}
