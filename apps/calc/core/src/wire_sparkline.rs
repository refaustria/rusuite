//! TypeScript-only mirrors of the sparkline types of
//! `model_sheet::sparkline` (see [`crate::wire`] for the pattern); a test
//! round-trips populated values to catch drift.

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
    /// Mirror of `model_sheet::SparklineKind`.
    #[serde(rename_all = "camelCase")]
    pub enum SparklineKind {
        Line,
        Column,
        WinLoss,
    }

    /// Mirror of `model_sheet::SparklineAxis`: automatic per sparkline,
    /// the same for the group, or a fixed value.
    #[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum SparklineAxis {
        Individual,
        Group,
        Custom { value: f64 },
    }

    /// Mirror of `model_sheet::SparklineEmpty`.
    #[serde(rename_all = "camelCase")]
    pub enum SparklineEmpty {
        Gap,
        Zero,
        Span,
    }

    /// Mirror of `model_sheet::Sparkline`: location cell (0-based) and
    /// data reference (without `=`).
    #[serde(rename_all = "camelCase")]
    pub struct Sparkline {
        pub row: u32,
        pub col: u32,
        pub data: String,
    }

    /// Mirror of `model_sheet::SparklineColors`.
    #[serde(rename_all = "camelCase")]
    pub struct SparklineColors {
        pub series: Color,
        pub negative: Color,
        pub axis: Color,
        pub markers: Color,
        pub first: Color,
        pub last: Color,
        pub high: Color,
        pub low: Color,
    }

    /// Mirror of `model_sheet::SparklineGroup`. Absent fields take the
    /// defaults (line, style 1 colours, nothing highlighted, automatic
    /// axes, 0.75 pt, empty cells as gaps).
    #[serde(rename_all = "camelCase")]
    pub struct SparklineGroup {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub kind: Option<SparklineKind>,
        pub sparklines: Vec<Sparkline>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub colors: Option<SparklineColors>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub high: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub low: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub first: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub last: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub negative: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub markers: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub show_axis: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub right_to_left: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub min_axis: Option<SparklineAxis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub max_axis: Option<SparklineAxis>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub date_range: Option<String>,
        /// Points; absent = 0.75.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub line_weight: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub empty_cells: Option<SparklineEmpty>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub display_hidden: bool,
    }

    /// Mirror of `model_sheet::SparklineData`.
    #[serde(rename_all = "camelCase")]
    pub struct SparklineData {
        pub values: Vec<Option<f64>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub dates: Option<Vec<Option<f64>>>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_sheet as ms;

    #[test]
    fn mirrors_match_the_sparkline_model() {
        let mut g = ms::SparklineGroup::new(
            ms::SparklineKind::WinLoss,
            vec![ms::Sparkline {
                row: 1,
                col: 2,
                data: "S!A1:D1".into(),
            }],
        );
        let json = serde_json::to_value(&g).unwrap();
        let m: SparklineGroup = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&m).unwrap(), json);
        g.high = true;
        g.low = true;
        g.first = true;
        g.last = true;
        g.negative = true;
        g.markers = true;
        g.show_axis = true;
        g.right_to_left = true;
        g.display_hidden = true;
        g.min_axis = ms::SparklineAxis::Custom { value: -1.0 };
        g.max_axis = ms::SparklineAxis::Group;
        g.date_range = Some("S!A2:D2".into());
        g.line_weight = 2.0;
        g.empty_cells = ms::SparklineEmpty::Span;
        g.colors = ms::sparkline_style(20);
        let json = serde_json::to_value(&g).unwrap();
        let m: SparklineGroup = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&m).unwrap(), json);
        assert_eq!(
            serde_json::from_value::<ms::SparklineGroup>(json).unwrap(),
            g
        );
        let d = ms::SparklineData {
            values: vec![Some(1.0), None],
            dates: Some(vec![None, Some(2.0)]),
        };
        let json = serde_json::to_value(&d).unwrap();
        let m: SparklineData = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(serde_json::to_value(&m).unwrap(), json);
    }
}
