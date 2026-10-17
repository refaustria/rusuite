//! Recommended PivotTables (P9-C3): candidate layouts for a source,
//! ranked like Excel's heuristics – a category field with few distinct
//! items on rows (two to a dozen are best), a numeric field summed in the
//! values, crosstabs of two small category fields, counts when the source
//! has no numbers. Identifier-like columns (every value distinct) are
//! never categories or values.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::{AggFunc, AxisField, DataField, FieldKind, Item, PivotCache, PivotFields, PivotTable};

/// One recommended layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    /// `Sum of Sales by Region` (Excel's caption).
    pub title: String,
    pub fields: PivotFields,
    /// Higher is better.
    pub score: f64,
}

struct Profile {
    distinct: usize,
    numeric: bool,
    /// Every value distinct (ids, names): neither category nor value.
    id_like: bool,
    blank_only: bool,
}

fn profile(cache: &PivotCache, f: usize) -> Profile {
    let mut seen: HashSet<super::ItemKey> = HashSet::new();
    let (mut nums, mut others, mut total) = (0usize, 0usize, 0usize);
    for r in &cache.records {
        let it = r.get(f).unwrap_or(&Item::Blank);
        if *it == Item::Blank {
            continue;
        }
        total += 1;
        match it {
            Item::Number(_) => nums += 1,
            _ => others += 1,
        }
        seen.insert(it.key());
    }
    let numeric = nums > 0 && others == 0;
    let name = cache.fields[f].name.to_lowercase();
    let id_name = name == "id"
        || name.ends_with(" id")
        || name.ends_with("_id")
        || name.ends_with("nr")
        || name.ends_with("no.")
        || name.starts_with('#');
    Profile {
        distinct: seen.len(),
        numeric,
        id_like: id_name || (total > 3 && seen.len() == total && !numeric),
        blank_only: total == 0,
    }
}

/// How good a field is on rows: best with 2..=12 distinct items.
fn category_score(p: &Profile, records: usize) -> f64 {
    if p.id_like || p.blank_only || p.distinct < 2 {
        return 0.0;
    }
    if p.distinct > 50 || p.distinct as f64 > (records as f64 * 0.9).max(2.0) {
        return 0.0;
    }
    let x = (p.distinct as f64 / 6.0).ln().abs();
    1.0 / (1.0 + x)
}

/// The recommended layouts for `cache`'s fields, best first (at most 10).
pub fn recommend_pivots(cache: &PivotCache) -> Vec<Recommendation> {
    let n = cache.records.len();
    let profiles: Vec<Profile> = (0..cache.fields.len()).map(|f| profile(cache, f)).collect();
    let name = |f: usize| cache.fields[f].name.clone();
    let mut cats: Vec<(usize, f64)> = profiles
        .iter()
        .enumerate()
        .filter(|(f, p)| {
            // Numbers are categories only when they repeat a lot (years).
            !p.numeric
                || cache.fields[*f].kind == FieldKind::Date
                || (p.distinct <= 12 && p.distinct * 3 <= n)
        })
        .map(|(f, p)| (f, category_score(p, n)))
        .filter(|(_, s)| *s > 0.0)
        .collect();
    cats.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let vals: Vec<usize> = profiles
        .iter()
        .enumerate()
        .filter(|(f, p)| {
            p.numeric
                && !p.id_like
                && cache.fields[*f].kind != FieldKind::Date
                && !cats.iter().any(|(c, _)| c == f)
        })
        .map(|(f, _)| f)
        .collect();
    let mut out: Vec<Recommendation> = Vec::new();
    let axis = |f: usize| -> Vec<AxisField> { vec![AxisField::from(f as u32)] };
    for (ci, &(c, cs)) in cats.iter().enumerate() {
        for (vi, &v) in vals.iter().enumerate() {
            // Earlier value columns are usually the main measure.
            let vs = 1.0 / (1.0 + vi as f64 * 0.15);
            out.push(Recommendation {
                title: format!("Sum of {} by {}", name(v), name(c)),
                fields: PivotFields {
                    rows: axis(c),
                    values: vec![DataField::new(v as u32, AggFunc::Sum)],
                    ..Default::default()
                },
                score: cs * vs,
            });
        }
        if vals.is_empty() {
            out.push(Recommendation {
                title: format!("Count of {} by {}", name(c), name(c)),
                fields: PivotFields {
                    rows: axis(c),
                    values: vec![DataField::new(c as u32, AggFunc::Count)],
                    ..Default::default()
                },
                score: cs * 0.8,
            });
        }
        // A crosstab with a second, smaller category on columns.
        for &(c2, cs2) in cats.iter().skip(ci + 1) {
            if profiles[c2].distinct > 6 {
                continue;
            }
            if let Some(&v) = vals.first() {
                out.push(Recommendation {
                    title: format!("Sum of {} by {} and {}", name(v), name(c), name(c2)),
                    fields: PivotFields {
                        rows: axis(c),
                        cols: axis(c2),
                        values: vec![DataField::new(v as u32, AggFunc::Sum)],
                        ..Default::default()
                    },
                    score: cs * cs2 * 0.7,
                });
            }
        }
        // Several measures side by side.
        if vals.len() >= 2 {
            out.push(Recommendation {
                title: format!(
                    "Sum of {} and Sum of {} by {}",
                    name(vals[0]),
                    name(vals[1]),
                    name(c)
                ),
                fields: PivotFields {
                    rows: axis(c),
                    values: vals[..2]
                        .iter()
                        .map(|&v| DataField::new(v as u32, AggFunc::Sum))
                        .collect(),
                    ..Default::default()
                },
                score: cs * 0.6,
            });
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score));
    out.truncate(10);
    out
}

/// The first `max_rows` rows of a recommendation's table as text (the
/// dialog's preview).
pub fn recommendation_preview(
    cache: &PivotCache,
    fields: &PivotFields,
    max_rows: usize,
) -> Vec<Vec<String>> {
    let mut t = PivotTable::new(0, "Preview", cache.id, 0, 0);
    t.set_fields(fields.clone());
    let Ok(out) = t.compute(cache) else {
        return Vec::new();
    };
    let e = out.table;
    (e.r0..=e.r1)
        .take(max_rows)
        .map(|r| {
            (e.c0..=e.c1)
                .map(|c| {
                    out.cell(r, c).map_or_else(String::new, |cell| {
                        crate::numfmt::display_value(&cell.value, cell.number_format.as_deref())
                    })
                })
                .collect()
        })
        .collect()
}
