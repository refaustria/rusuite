//! Label, date and value filters of pivot fields (P9-C3): Excel's Label
//! Filters (begins with, contains, between, …), Date Filters and Value
//! Filters (greater than …, between, Top 10 items / percent / sum).

use serde::{Deserialize, Serialize};

use super::Item;

/// Excel's Label Filters (`captionEqual`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelOp {
    Equal,
    NotEqual,
    BeginsWith,
    NotBeginsWith,
    EndsWith,
    NotEndsWith,
    Contains,
    NotContains,
    Greater,
    GreaterOrEqual,
    Less,
    LessOrEqual,
    Between,
    NotBetween,
}

/// Excel's Date Filters on a date field (`dateEqual`, …), day by day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DateOp {
    Equal,
    NotEqual,
    Before,
    After,
    Between,
    NotBetween,
}

/// Excel's Value Filters (`valueGreaterThan`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValueOp {
    Equal,
    NotEqual,
    Greater,
    GreaterOrEqual,
    Less,
    LessOrEqual,
    Between,
    NotBetween,
}

/// What Top 10 counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TopBy {
    /// The `count` largest items.
    #[default]
    Items,
    /// The largest items making up `count` percent of the total.
    Percent,
    /// The largest items until their sum reaches `count`.
    Sum,
}

/// A filter of a row or column field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PivotFilter {
    /// On the item labels (case ignored; `*` and `?` wildcards for equal).
    Label {
        op: LabelOp,
        value: String,
        /// The upper bound of between.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        value2: String,
    },
    /// On date items (serials, compared by day).
    Date {
        op: DateOp,
        value: f64,
        #[serde(default)]
        value2: f64,
    },
    /// On each item's value of data field `data` (within its parent item).
    Value {
        op: ValueOp,
        data: u32,
        value: f64,
        #[serde(default)]
        value2: f64,
    },
    /// Top / Bottom 10 by data field `data` (within the parent item).
    Top {
        data: u32,
        #[serde(default)]
        bottom: bool,
        count: f64,
        #[serde(default)]
        by: TopBy,
    },
}

/// `*` / `?` wildcard match (both lower case already).
fn wild(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || (p[pi] != '*' && p[pi] == t[ti])) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

impl PivotFilter {
    /// The SpreadsheetML filter type (`ST_PivotFilterType`).
    pub fn xml_type(&self) -> &'static str {
        match self {
            PivotFilter::Label { op, .. } => match op {
                LabelOp::Equal => "captionEqual",
                LabelOp::NotEqual => "captionNotEqual",
                LabelOp::BeginsWith => "captionBeginsWith",
                LabelOp::NotBeginsWith => "captionNotBeginsWith",
                LabelOp::EndsWith => "captionEndsWith",
                LabelOp::NotEndsWith => "captionNotEndsWith",
                LabelOp::Contains => "captionContains",
                LabelOp::NotContains => "captionNotContains",
                LabelOp::Greater => "captionGreaterThan",
                LabelOp::GreaterOrEqual => "captionGreaterThanOrEqual",
                LabelOp::Less => "captionLessThan",
                LabelOp::LessOrEqual => "captionLessThanOrEqual",
                LabelOp::Between => "captionBetween",
                LabelOp::NotBetween => "captionNotBetween",
            },
            PivotFilter::Date { op, .. } => match op {
                DateOp::Equal => "dateEqual",
                DateOp::NotEqual => "dateNotEqual",
                DateOp::Before => "dateOlderThan",
                DateOp::After => "dateNewerThan",
                DateOp::Between => "dateBetween",
                DateOp::NotBetween => "dateNotBetween",
            },
            PivotFilter::Value { op, .. } => match op {
                ValueOp::Equal => "valueEqual",
                ValueOp::NotEqual => "valueNotEqual",
                ValueOp::Greater => "valueGreaterThan",
                ValueOp::GreaterOrEqual => "valueGreaterThanOrEqual",
                ValueOp::Less => "valueLessThan",
                ValueOp::LessOrEqual => "valueLessThanOrEqual",
                ValueOp::Between => "valueBetween",
                ValueOp::NotBetween => "valueNotBetween",
            },
            PivotFilter::Top { by, .. } => match by {
                TopBy::Items => "count",
                TopBy::Percent => "percent",
                TopBy::Sum => "sum",
            },
        }
    }

    /// The filter of an `ST_PivotFilterType` with its values (`s1`, `s2`
    /// for caption filters, `n1`, `n2` for date / value filters, `data`
    /// for value filters, `bottom` for top 10).
    pub fn from_xml(
        ty: &str,
        s1: &str,
        s2: &str,
        n1: f64,
        n2: f64,
        data: u32,
        bottom: bool,
    ) -> Option<PivotFilter> {
        let label = |op| PivotFilter::Label {
            op,
            value: s1.to_owned(),
            value2: s2.to_owned(),
        };
        let date = |op| PivotFilter::Date {
            op,
            value: n1,
            value2: n2,
        };
        let value = |op| PivotFilter::Value {
            op,
            data,
            value: n1,
            value2: n2,
        };
        let top = |by| PivotFilter::Top {
            data,
            bottom,
            count: n1,
            by,
        };
        Some(match ty {
            "captionEqual" => label(LabelOp::Equal),
            "captionNotEqual" => label(LabelOp::NotEqual),
            "captionBeginsWith" => label(LabelOp::BeginsWith),
            "captionNotBeginsWith" => label(LabelOp::NotBeginsWith),
            "captionEndsWith" => label(LabelOp::EndsWith),
            "captionNotEndsWith" => label(LabelOp::NotEndsWith),
            "captionContains" => label(LabelOp::Contains),
            "captionNotContains" => label(LabelOp::NotContains),
            "captionGreaterThan" => label(LabelOp::Greater),
            "captionGreaterThanOrEqual" => label(LabelOp::GreaterOrEqual),
            "captionLessThan" => label(LabelOp::Less),
            "captionLessThanOrEqual" => label(LabelOp::LessOrEqual),
            "captionBetween" => label(LabelOp::Between),
            "captionNotBetween" => label(LabelOp::NotBetween),
            "dateEqual" => date(DateOp::Equal),
            "dateNotEqual" => date(DateOp::NotEqual),
            "dateOlderThan" => date(DateOp::Before),
            "dateNewerThan" => date(DateOp::After),
            "dateBetween" => date(DateOp::Between),
            "dateNotBetween" => date(DateOp::NotBetween),
            "valueEqual" => value(ValueOp::Equal),
            "valueNotEqual" => value(ValueOp::NotEqual),
            "valueGreaterThan" => value(ValueOp::Greater),
            "valueGreaterThanOrEqual" => value(ValueOp::GreaterOrEqual),
            "valueLessThan" => value(ValueOp::Less),
            "valueLessThanOrEqual" => value(ValueOp::LessOrEqual),
            "valueBetween" => value(ValueOp::Between),
            "valueNotBetween" => value(ValueOp::NotBetween),
            "count" => top(TopBy::Items),
            "percent" => top(TopBy::Percent),
            "sum" => top(TopBy::Sum),
            _ => return None,
        })
    }

    /// The data field the filter reads (value and top filters).
    pub fn data(&self) -> Option<u32> {
        match self {
            PivotFilter::Value { data, .. } | PivotFilter::Top { data, .. } => Some(*data),
            _ => None,
        }
    }

    /// The filter after data fields moved (`None`: its data field went).
    pub(crate) fn remap_data(self, map: impl Fn(u32) -> Option<u32>) -> Option<PivotFilter> {
        match self {
            PivotFilter::Value {
                op,
                data,
                value,
                value2,
            } => Some(PivotFilter::Value {
                op,
                data: map(data)?,
                value,
                value2,
            }),
            PivotFilter::Top {
                data,
                bottom,
                count,
                by,
            } => Some(PivotFilter::Top {
                data: map(data)?,
                bottom,
                count,
                by,
            }),
            f => Some(f),
        }
    }

    /// Whether a label or date filter lets `item` (shown as `label`) pass;
    /// value filters pass everything here.
    pub(crate) fn label_ok(&self, item: &Item, label: &str) -> bool {
        match self {
            PivotFilter::Label { op, value, value2 } => {
                let l = label.to_lowercase();
                let v = value.to_lowercase();
                let cmp = |b: &str| -> std::cmp::Ordering {
                    match (item, b.trim().parse::<f64>()) {
                        (Item::Number(n), Ok(x)) => n.total_cmp(&x),
                        _ => l.as_str().cmp(&b.to_lowercase()),
                    }
                };
                use std::cmp::Ordering::{Greater, Less};
                match op {
                    LabelOp::Equal => wild(&v, &l),
                    LabelOp::NotEqual => !wild(&v, &l),
                    LabelOp::BeginsWith => l.starts_with(&v),
                    LabelOp::NotBeginsWith => !l.starts_with(&v),
                    LabelOp::EndsWith => l.ends_with(&v),
                    LabelOp::NotEndsWith => !l.ends_with(&v),
                    LabelOp::Contains => l.contains(&v),
                    LabelOp::NotContains => !l.contains(&v),
                    LabelOp::Greater => cmp(value) == Greater,
                    LabelOp::GreaterOrEqual => cmp(value) != Less,
                    LabelOp::Less => cmp(value) == Less,
                    LabelOp::LessOrEqual => cmp(value) != Greater,
                    LabelOp::Between => cmp(value) != Less && cmp(value2) != Greater,
                    LabelOp::NotBetween => cmp(value) == Less || cmp(value2) == Greater,
                }
            }
            PivotFilter::Date { op, value, value2 } => {
                let Item::Number(n) = item else {
                    return false;
                };
                let (d, a, b) = (n.floor(), value.floor(), value2.floor());
                match op {
                    DateOp::Equal => d == a,
                    DateOp::NotEqual => d != a,
                    DateOp::Before => d < a,
                    DateOp::After => d > a,
                    DateOp::Between => d >= a && d <= b,
                    DateOp::NotBetween => d < a || d > b,
                }
            }
            _ => true,
        }
    }

    /// Whether a value filter lets an item with value `v` pass (`None` =
    /// no number: never).
    pub(crate) fn value_ok(&self, v: Option<f64>) -> bool {
        let PivotFilter::Value {
            op, value, value2, ..
        } = self
        else {
            return true;
        };
        let Some(v) = v else { return false };
        let (lo, hi) = (value.min(*value2), value.max(*value2));
        match op {
            ValueOp::Equal => v == *value,
            ValueOp::NotEqual => v != *value,
            ValueOp::Greater => v > *value,
            ValueOp::GreaterOrEqual => v >= *value,
            ValueOp::Less => v < *value,
            ValueOp::LessOrEqual => v <= *value,
            ValueOp::Between => v >= lo && v <= hi,
            ValueOp::NotBetween => v < lo || v > hi,
        }
    }
}

/// The items a Top 10 filter keeps of `values` (`(item, value)`, items
/// without a number never pass). Ties with the last kept item are kept
/// for Top N items, as in Excel.
pub(crate) fn top_keep(
    values: &[(u32, Option<f64>)],
    bottom: bool,
    count: f64,
    by: TopBy,
) -> Vec<u32> {
    let mut nums: Vec<(u32, f64)> = values.iter().filter_map(|&(i, v)| Some((i, v?))).collect();
    nums.sort_by(|a, b| {
        let o = b.1.total_cmp(&a.1);
        if bottom {
            o.reverse()
        } else {
            o
        }
    });
    let mut keep = Vec::new();
    match by {
        TopBy::Items => {
            let n = count.max(0.0).ceil() as usize;
            let mut last = None;
            for (k, &(i, v)) in nums.iter().enumerate() {
                if k < n || last == Some(v) {
                    keep.push(i);
                    last = Some(v);
                } else {
                    break;
                }
            }
        }
        TopBy::Percent | TopBy::Sum => {
            let total: f64 = nums.iter().map(|x| x.1).sum();
            let goal = if by == TopBy::Percent {
                total * count / 100.0
            } else {
                count
            };
            let mut acc = 0.0;
            for &(i, v) in &nums {
                if acc >= goal && !keep.is_empty() {
                    break;
                }
                keep.push(i);
                acc += v;
            }
        }
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(op: LabelOp, v: &str, v2: &str) -> PivotFilter {
        PivotFilter::Label {
            op,
            value: v.into(),
            value2: v2.into(),
        }
    }

    #[test]
    fn label_ops() {
        let t = |f: &PivotFilter, s: &str| f.label_ok(&Item::Text(s.into()), s);
        assert!(t(&label(LabelOp::BeginsWith, "ea", ""), "East"));
        assert!(!t(&label(LabelOp::BeginsWith, "we", ""), "East"));
        assert!(t(&label(LabelOp::Contains, "AS", ""), "East"));
        assert!(t(&label(LabelOp::NotContains, "x", ""), "East"));
        assert!(t(&label(LabelOp::EndsWith, "st", ""), "West"));
        assert!(t(&label(LabelOp::Equal, "w*t", ""), "West"));
        assert!(!t(&label(LabelOp::Equal, "w?t", ""), "West"));
        assert!(t(&label(LabelOp::Between, "e", "o"), "North"));
        assert!(!t(&label(LabelOp::Between, "e", "o"), "West"));
        assert!(t(&label(LabelOp::NotBetween, "e", "o"), "West"));
        assert!(t(&label(LabelOp::Greater, "m", ""), "North"));
        // Numbers compare as numbers.
        let n = label(LabelOp::Greater, "9", "");
        assert!(n.label_ok(&Item::Number(10.0), "10"));
    }

    #[test]
    fn date_and_value_ops() {
        let d = PivotFilter::Date {
            op: DateOp::Between,
            value: 45292.0,
            value2: 45322.0,
        };
        assert!(d.label_ok(&Item::Number(45300.5), ""));
        assert!(!d.label_ok(&Item::Number(45323.0), ""));
        assert!(!d.label_ok(&Item::Text("x".into()), "x"));
        let v = |op, a, b| PivotFilter::Value {
            op,
            data: 0,
            value: a,
            value2: b,
        };
        assert!(v(ValueOp::Greater, 10.0, 0.0).value_ok(Some(11.0)));
        assert!(!v(ValueOp::Greater, 10.0, 0.0).value_ok(Some(10.0)));
        assert!(v(ValueOp::Between, 20.0, 10.0).value_ok(Some(15.0)));
        assert!(v(ValueOp::NotBetween, 10.0, 20.0).value_ok(Some(25.0)));
        assert!(!v(ValueOp::NotEqual, 1.0, 0.0).value_ok(None));
    }

    #[test]
    fn top_ten() {
        let vals = [
            (0, Some(10.0)),
            (1, Some(40.0)),
            (2, Some(30.0)),
            (3, None),
            (4, Some(30.0)),
        ];
        assert_eq!(top_keep(&vals, false, 2.0, TopBy::Items), vec![1, 2, 4]);
        assert_eq!(top_keep(&vals, true, 1.0, TopBy::Items), vec![0]);
        // 50 % of 110 = 55: 40, then 30 crosses it.
        assert_eq!(top_keep(&vals, false, 50.0, TopBy::Percent), vec![1, 2]);
        assert_eq!(top_keep(&vals, false, 40.0, TopBy::Sum), vec![1]);
    }
}
