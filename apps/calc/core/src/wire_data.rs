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
    }
}
