//! Grouping of pivot fields (P9-C3): dates by seconds … years (several
//! levels become extra fields `Years`, `Quarters`, `Months`, … as in
//! Excel), numbers by start / end / interval, and manual groups of
//! selected items (`Group1`, … in a new field `Region2`). Stored as
//! Excel stores them (`fieldGroup` with `rangePr` / `discretePr` and
//! `groupItems`); the group items are the grouped field's shared items.

use engine_formula::{Recalc, SheetId};
use serde::{Deserialize, Serialize};

use super::{AxisField, CacheField, FieldKind, Item, PivotCache, PivotTable, SortOrder};
use crate::workbook::Workbook;
use crate::Error;

/// Excel's date grouping levels (`rangePr groupBy`), finest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DateGroupBy {
    Seconds,
    Minutes,
    Hours,
    Days,
    Months,
    Quarters,
    Years,
}

impl DateGroupBy {
    pub const ALL: [DateGroupBy; 7] = [
        DateGroupBy::Seconds,
        DateGroupBy::Minutes,
        DateGroupBy::Hours,
        DateGroupBy::Days,
        DateGroupBy::Months,
        DateGroupBy::Quarters,
        DateGroupBy::Years,
    ];

    /// The `groupBy` value.
    pub fn xml_name(self) -> &'static str {
        match self {
            DateGroupBy::Seconds => "seconds",
            DateGroupBy::Minutes => "minutes",
            DateGroupBy::Hours => "hours",
            DateGroupBy::Days => "days",
            DateGroupBy::Months => "months",
            DateGroupBy::Quarters => "quarters",
            DateGroupBy::Years => "years",
        }
    }

    pub fn from_xml_name(s: &str) -> Option<DateGroupBy> {
        Self::ALL.into_iter().find(|g| g.xml_name() == s)
    }

    /// The name of the extra field of this level (`Years`).
    pub fn field_name(self) -> &'static str {
        match self {
            DateGroupBy::Seconds => "Seconds",
            DateGroupBy::Minutes => "Minutes",
            DateGroupBy::Hours => "Hours",
            DateGroupBy::Days => "Days",
            DateGroupBy::Months => "Months",
            DateGroupBy::Quarters => "Quarters",
            DateGroupBy::Years => "Years",
        }
    }
}

/// How a grouped field maps the values of its base field to items.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GroupKind {
    /// Numbers in bins of `interval` from `start` to `end` (`rangePr
    /// groupBy="range"`); items `<start`, `0-9`, `10-19`, …, `>end`.
    Number {
        start: f64,
        end: f64,
        interval: f64,
        /// Start / end follow the data on refresh (`autoStart`/`autoEnd`).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        auto_start: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        auto_end: bool,
    },
    /// Dates (serials) by `by`; `interval` = days per group for `Days`.
    Date {
        by: DateGroupBy,
        start: f64,
        end: f64,
        #[serde(default = "one")]
        interval: u32,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        auto_start: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        auto_end: bool,
    },
    /// Manual groups (`discretePr`): per shared item of the base field, the
    /// index of its group item.
    Items { map: Vec<u32> },
}

fn one() -> u32 {
    1
}

/// A field's grouping (`fieldGroup base`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldGroup {
    /// The field whose values are grouped (the field itself for a range
    /// grouping of its own values).
    pub base: u32,
    #[serde(flatten)]
    pub kind: GroupKind,
}

/// What [`Workbook::group_pivot_field`] does (Excel's Group dialog or
/// Group Selection).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GroupSpec {
    /// Dates by one or more levels (`None` start/end = the data's).
    Date {
        by: Vec<DateGroupBy>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        end: Option<f64>,
        /// Days per group (`Days` alone; default 1).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        days: Option<u32>,
    },
    /// Numbers by `interval`.
    Number {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        end: Option<f64>,
        interval: f64,
    },
    /// The shared items `items` of the field become one group.
    Items { items: Vec<u32> },
}

// --- dates ------------------------------------------------------------------------------

/// `(year, month, day, hour, minute, second)` of a 1900-system serial.
pub(crate) fn civil(serial: f64) -> (i64, u32, u32, u32, u32, u32) {
    let days = serial.floor() as i64;
    let secs = ((serial - serial.floor()) * 86_400.0).round() as i64;
    let (days, secs) = if secs >= 86_400 {
        (days + 1, secs - 86_400)
    } else {
        (days, secs)
    };
    if days == 60 {
        // Excel's fictitious 1900-02-29.
        return (1900, 2, 29, 0, 0, 0);
    }
    let z = days_from_civil(1899, 12, 30) + if days < 61 { days + 1 } else { days };
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (
        y,
        m as u32,
        d as u32,
        (secs / 3600) as u32,
        ((secs / 60) % 60) as u32,
        (secs % 60) as u32,
    )
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/// Days per month in a leap year (Excel's day items run 1-Jan … 31-Dec, 366).
const MONTH_DAYS: [u32; 12] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

fn date_label(serial: f64) -> String {
    crate::numfmt::display_value(&engine_formula::Value::Number(serial), Some("m/d/yyyy"))
}

fn num_label(n: f64) -> String {
    crate::numfmt::display_value(&engine_formula::Value::Number(n), None)
}

/// Number of bins (or level items) of a range grouping.
fn level_count(kind: &GroupKind) -> u32 {
    match *kind {
        GroupKind::Number {
            start,
            end,
            interval,
            ..
        } => {
            if interval.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) || end < start {
                return 1;
            }
            (((end - start) / interval).floor() as u32 + 1).min(100_000)
        }
        GroupKind::Date {
            by,
            start,
            end,
            interval,
            ..
        } => match by {
            DateGroupBy::Years => {
                let (y0, ..) = civil(start);
                let (y1, ..) = civil(end.max(start));
                (y1 - y0 + 1).clamp(1, 10_000) as u32
            }
            DateGroupBy::Quarters => 4,
            DateGroupBy::Months => 12,
            DateGroupBy::Days if interval <= 1 => 366,
            DateGroupBy::Days => {
                let span = (end.floor() - start.floor()).max(0.0) as u32;
                (span / interval + 1).min(100_000)
            }
            DateGroupBy::Hours => 24,
            DateGroupBy::Minutes | DateGroupBy::Seconds => 60,
        },
        GroupKind::Items { .. } => 0,
    }
}

/// The group items of a range grouping: `<start`, the bins or level
/// items, `>end`.
pub(crate) fn range_items(kind: &GroupKind) -> Vec<Item> {
    let mut out = Vec::new();
    let n = level_count(kind);
    match *kind {
        GroupKind::Number {
            start,
            end,
            interval,
            ..
        } => {
            out.push(format!("<{}", num_label(start)));
            let integral = start.fract() == 0.0 && interval.fract() == 0.0;
            for k in 0..n {
                let lo = start + f64::from(k) * interval;
                let hi = if integral {
                    lo + interval - 1.0
                } else {
                    lo + interval
                };
                out.push(format!("{}-{}", num_label(lo), num_label(hi)));
            }
            out.push(format!(">{}", num_label(end)));
        }
        GroupKind::Date {
            by,
            start,
            end,
            interval,
            ..
        } => {
            out.push(format!("<{}", date_label(start)));
            match by {
                DateGroupBy::Years => {
                    let (y0, ..) = civil(start);
                    out.extend((0..n).map(|k| (y0 + i64::from(k)).to_string()));
                }
                DateGroupBy::Quarters => out.extend((1..=4).map(|q| format!("Qtr{q}"))),
                DateGroupBy::Months => out.extend(MONTHS.iter().map(|m| (*m).to_owned())),
                DateGroupBy::Days if interval <= 1 => {
                    for (m, days) in MONTH_DAYS.iter().enumerate() {
                        out.extend((1..=*days).map(|d| format!("{d}-{}", MONTHS[m])));
                    }
                }
                DateGroupBy::Days => {
                    let s = start.floor();
                    for k in 0..n {
                        let a = s + f64::from(k * interval);
                        let b = a + f64::from(interval) - 1.0;
                        out.push(format!("{} - {}", date_label(a), date_label(b)));
                    }
                }
                DateGroupBy::Hours => out.extend((0..24).map(|h| match h {
                    0 => "12 AM".to_owned(),
                    1..=11 => format!("{h} AM"),
                    12 => "12 PM".to_owned(),
                    _ => format!("{} PM", h - 12),
                })),
                DateGroupBy::Minutes | DateGroupBy::Seconds => {
                    out.extend((0..60).map(|m| format!(":{m:02}")))
                }
            }
            out.push(format!(">{}", date_label(end)));
        }
        GroupKind::Items { .. } => return Vec::new(),
    }
    out.into_iter().map(Item::Text).collect()
}

/// The group item of `value` in a range grouping whose items are `items`
/// (blank values: a `(blank)` item at the end, if any).
pub(crate) fn range_index(kind: &GroupKind, value: &Item, items: &[Item]) -> u32 {
    let blank = || {
        items
            .iter()
            .rposition(|i| *i == Item::Blank)
            .map_or(u32::MAX, |p| p as u32)
    };
    let v = match value {
        Item::Number(v) => *v,
        Item::Blank => return blank(),
        _ => return u32::MAX,
    };
    let n = level_count(kind);
    let gt = n + 1;
    let idx = match *kind {
        GroupKind::Number {
            start,
            end,
            interval,
            ..
        } => {
            if v < start {
                0
            } else if v > end {
                gt
            } else {
                1 + (((v - start) / interval).floor() as u32).min(n - 1)
            }
        }
        GroupKind::Date {
            by,
            start,
            end,
            interval,
            ..
        } => {
            if v < start {
                0
            } else if v > end {
                gt
            } else {
                let (y, m, d, h, mi, s) = civil(v);
                match by {
                    DateGroupBy::Years => {
                        let (y0, ..) = civil(start);
                        1 + ((y - y0).max(0) as u32).min(n - 1)
                    }
                    DateGroupBy::Quarters => 1 + (m - 1) / 3,
                    DateGroupBy::Months => m,
                    DateGroupBy::Days if interval <= 1 => {
                        MONTH_DAYS[..(m - 1) as usize].iter().sum::<u32>() + d
                    }
                    DateGroupBy::Days => {
                        let k = ((v.floor() - start.floor()) as u32) / interval;
                        1 + k.min(n - 1)
                    }
                    DateGroupBy::Hours => 1 + h,
                    DateGroupBy::Minutes => 1 + mi,
                    DateGroupBy::Seconds => 1 + s,
                }
            }
        }
        GroupKind::Items { .. } => return u32::MAX,
    };
    if (idx as usize) < items.len() {
        idx
    } else {
        u32::MAX
    }
}

/// Ascending order of group items: their own order, `(blank)` last.
pub(crate) fn grouped_cmp(items: &[Item], a: u32, b: u32) -> std::cmp::Ordering {
    let blank = |i: u32| items.get(i as usize) == Some(&Item::Blank);
    blank(a).cmp(&blank(b)).then(a.cmp(&b))
}

/// The range kind of `spec` for `level` over `values` (numbers).
fn date_kind(level: DateGroupBy, start: f64, end: f64, days: u32, auto: (bool, bool)) -> GroupKind {
    GroupKind::Date {
        by: level,
        start,
        end,
        interval: if level == DateGroupBy::Days {
            days.max(1)
        } else {
            1
        },
        auto_start: auto.0,
        auto_end: auto.1,
    }
}

/// The items of a range grouping over `cache`'s records of `base`, a
/// `(blank)` item appended when the base field has blanks.
fn items_for(kind: &GroupKind, cache: &PivotCache, base: u32) -> Vec<Item> {
    let mut items = range_items(kind);
    let blank = cache
        .records
        .iter()
        .any(|r| matches!(r.get(base as usize), Some(Item::Blank) | None));
    if blank {
        items.push(Item::Blank);
    }
    items
}

fn unique_field_name(cache: &PivotCache, name: &str) -> String {
    let used = |n: &str| cache.fields.iter().any(|f| f.name.eq_ignore_ascii_case(n));
    if !used(name) {
        return name.to_owned();
    }
    (2u32..)
        .map(|k| format!("{name}{k}"))
        .find(|n| !used(n))
        .expect("unbounded")
}

/// Min and max of the numbers of field `base`; fails when it holds text.
fn number_bounds(cache: &PivotCache, base: u32) -> Result<(f64, f64), Error> {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for r in &cache.records {
        match r.get(base as usize) {
            Some(Item::Number(n)) => {
                lo = lo.min(*n);
                hi = hi.max(*n);
            }
            Some(Item::Blank) | None => {}
            Some(_) => {
                return Err(Error::InvalidPivot(
                    "cannot group that selection: the field holds text".into(),
                ))
            }
        }
    }
    if lo > hi {
        return Err(Error::InvalidPivot(
            "cannot group that selection: no numbers".into(),
        ));
    }
    Ok((lo, hi))
}

impl PivotCache {
    /// Recomputes the bounds and items of range groupings with automatic
    /// start/end from the records (refresh).
    pub(crate) fn regroup(&mut self) {
        for i in 0..self.fields.len() {
            let Some(g) = self.fields[i].group.clone() else {
                continue;
            };
            let mut kind = g.kind.clone();
            let bounds = number_bounds(self, g.base).ok();
            match &mut kind {
                GroupKind::Number {
                    start,
                    end,
                    auto_start,
                    auto_end,
                    ..
                }
                | GroupKind::Date {
                    start,
                    end,
                    auto_start,
                    auto_end,
                    ..
                } => {
                    if let Some((lo, hi)) = bounds {
                        if *auto_start {
                            *start = if matches!(g.kind, GroupKind::Date { .. }) {
                                lo.floor()
                            } else {
                                lo
                            };
                        }
                        if *auto_end {
                            *end = hi;
                        }
                    }
                }
                GroupKind::Items { .. } => continue,
            }
            let items = items_for(&kind, self, g.base);
            let f = &mut self.fields[i];
            f.shared_items = items;
            f.group = Some(FieldGroup { base: g.base, kind });
        }
    }

    /// Removes field `i`: `map[old] = new` for every field.
    pub(crate) fn remove_field(&mut self, i: u32) -> Vec<Option<u32>> {
        let n = self.fields.len() as u32;
        let map: Vec<Option<u32>> = (0..n)
            .map(|f| match f.cmp(&i) {
                std::cmp::Ordering::Less => Some(f),
                std::cmp::Ordering::Equal => None,
                std::cmp::Ordering::Greater => Some(f - 1),
            })
            .collect();
        self.fields.remove(i as usize);
        for rec in &mut self.records {
            if (i as usize) < rec.len() {
                rec.remove(i as usize);
            }
        }
        for f in &mut self.fields {
            if let Some(g) = f.group.as_mut() {
                if let Some(b) = map.get(g.base as usize).copied().flatten() {
                    g.base = b;
                }
            }
        }
        self.calculated_items.retain(|c| c.field != i);
        for c in &mut self.calculated_items {
            if let Some(f) = map.get(c.field as usize).copied().flatten() {
                c.field = f;
            }
        }
        map
    }

    /// Ungroups field `field` (a range grouping of its own values with its
    /// extra level fields, a level field – the whole date grouping – or a
    /// manual group field, which goes). Returns the field map.
    pub(crate) fn ungroup(&mut self, field: u32) -> Result<(Vec<Option<u32>>, u32), Error> {
        let n = self.fields.len() as u32;
        let g = self
            .fields
            .get(field as usize)
            .and_then(|f| f.group.clone())
            .ok_or_else(|| Error::InvalidPivot("the field is not grouped".into()))?;
        let mut map: Vec<Option<u32>> = (0..n).map(Some).collect();
        let compose = |map: &mut Vec<Option<u32>>, step: Vec<Option<u32>>| {
            for m in map.iter_mut() {
                *m = m.and_then(|x| step.get(x as usize).copied().flatten());
            }
        };
        if let GroupKind::Items { .. } = g.kind {
            let step = self.remove_field(field);
            compose(&mut map, step);
            return Ok((map, g.base));
        }
        let base = g.base;
        // The level fields of the base go, then the base's own grouping.
        loop {
            let next = self.fields.iter().enumerate().position(|(i, f)| {
                i as u32 != base
                    && f.group.as_ref().is_some_and(|g| {
                        g.base == base && !matches!(g.kind, GroupKind::Items { .. })
                    })
            });
            let Some(i) = next else { break };
            let step = self.remove_field(i as u32);
            compose(&mut map, step);
        }
        let new_base = map[base as usize].unwrap_or(base);
        if let Some(f) = self.fields.get_mut(new_base as usize) {
            if f.group.as_ref().is_some_and(|g| g.base == new_base) {
                f.group = None;
                f.shared_items.clear();
            }
        }
        self.normalize();
        Ok((map, new_base))
    }
}

impl Workbook {
    /// Groups field `field` of pivot table `id`'s cache (Excel's Group):
    /// dates by levels (the finest on the field itself, coarser ones as
    /// new fields placed before it on the table's axis), numbers by an
    /// interval, or selected items into `Group<n>` of a new field
    /// `<name>2` placed before it. Every table of the cache is rewritten;
    /// on error nothing changes.
    pub fn group_pivot_field(
        &mut self,
        id: u32,
        field: u32,
        spec: GroupSpec,
    ) -> Result<Recalc, Error> {
        let (s, i) = self.locate_pivot(id)?;
        let table = self.pivots(s)[i].clone();
        let mut cache = self
            .pivot_cache(table.cache_id)
            .cloned()
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        if cache.raw.is_some() || table.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot table is read-only".into()));
        }
        let cf = cache
            .fields
            .get(field as usize)
            .cloned()
            .ok_or_else(|| Error::InvalidPivot(format!("no field {field}")))?;
        if cf.formula.is_some() {
            return Err(Error::InvalidPivot(
                "a calculated field cannot be grouped".into(),
            ));
        }
        match spec {
            GroupSpec::Items { items } => self.group_items(s, id, cache, field, &items),
            GroupSpec::Date {
                by,
                start,
                end,
                days,
            } => {
                let mut by: Vec<DateGroupBy> = by;
                by.sort();
                by.dedup();
                let finest = *by
                    .first()
                    .ok_or_else(|| Error::InvalidPivot("no grouping level".into()))?;
                // Grouping a grouped field again replaces its grouping.
                let mut map: Vec<Option<u32>> = (0..cache.fields.len() as u32).map(Some).collect();
                let mut base = field;
                if cf.group.is_some() {
                    if matches!(
                        cf.group.as_ref().map(|g| &g.kind),
                        Some(GroupKind::Items { .. })
                    ) {
                        return Err(Error::InvalidPivot(
                            "ungroup the field before grouping it by dates".into(),
                        ));
                    }
                    let (m, b) = cache.ungroup(field)?;
                    map = m;
                    base = b;
                }
                if !cache.fields[base as usize].is_source(base) {
                    return Err(Error::InvalidPivot("cannot group that selection".into()));
                }
                let (lo, hi) = number_bounds(&cache, base)?;
                let auto = (start.is_none(), end.is_none());
                let start = start.unwrap_or(lo.floor());
                let end = end.unwrap_or(hi);
                let days = days.unwrap_or(1);
                let kind = date_kind(finest, start, end, days, auto);
                let items = items_for(&kind, &cache, base);
                let f = &mut cache.fields[base as usize];
                f.group = Some(FieldGroup { base, kind });
                f.shared_items = items;
                f.kind = FieldKind::Date;
                let mut added = Vec::new();
                for level in by.iter().skip(1).rev() {
                    let kind = date_kind(*level, start, end, 1, auto);
                    let mut nf = CacheField::new(&unique_field_name(&cache, level.field_name()));
                    nf.shared_items = items_for(&kind, &cache, base);
                    nf.group = Some(FieldGroup { base, kind });
                    cache.fields.push(nf);
                    added.push(cache.fields.len() as u32 - 1);
                }
                let n = cache.fields.len();
                for rec in &mut cache.records {
                    rec.resize(n, Item::Blank);
                }
                self.replace_pivot_cache(id, cache, map, &[base], |t| {
                    insert_before(t, base, &added);
                })
            }
            GroupSpec::Number {
                start,
                end,
                interval,
            } => {
                if interval.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater)
                    || !interval.is_finite()
                {
                    return Err(Error::InvalidPivot("the interval must be positive".into()));
                }
                let mut map: Vec<Option<u32>> = (0..cache.fields.len() as u32).map(Some).collect();
                let mut base = field;
                if cf.group.is_some() {
                    let (m, b) = cache.ungroup(field)?;
                    map = m;
                    base = b;
                }
                let (lo, hi) = number_bounds(&cache, base)?;
                let start_v = start.unwrap_or(lo);
                let end_v = end.unwrap_or(hi);
                if end_v < start_v {
                    return Err(Error::InvalidPivot(
                        "the end must not be before the start".into(),
                    ));
                }
                let kind = GroupKind::Number {
                    start: start_v,
                    end: end_v,
                    interval,
                    auto_start: start.is_none(),
                    auto_end: end.is_none(),
                };
                let items = items_for(&kind, &cache, base);
                let f = &mut cache.fields[base as usize];
                f.group = Some(FieldGroup { base, kind });
                f.shared_items = items;
                self.replace_pivot_cache(id, cache, map, &[base], |_| {})
            }
        }
    }

    fn group_items(
        &mut self,
        sheet: SheetId,
        id: u32,
        mut cache: PivotCache,
        field: u32,
        items: &[u32],
    ) -> Result<Recalc, Error> {
        let table = self
            .pivots(sheet)
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or(Error::UnknownPivot(id))?;
        if table.axis_field(field).is_none() {
            return Err(Error::InvalidPivot(
                "only items of a row or column field can be grouped".into(),
            ));
        }
        let n_items = cache.fields[field as usize].shared_items.len() as u32;
        if items.is_empty() || items.iter().any(|&i| i >= n_items) {
            return Err(Error::InvalidPivot("cannot group that selection".into()));
        }
        let map: Vec<Option<u32>> = (0..cache.fields.len() as u32).map(Some).collect();
        // The group field over `field`, created when missing.
        let existing = cache.fields.iter().position(|f| {
            f.group
                .as_ref()
                .is_some_and(|g| g.base == field && matches!(g.kind, GroupKind::Items { .. }))
        });
        let (g, created) = match existing {
            Some(g) => (g as u32, false),
            None => {
                let base = &cache.fields[field as usize];
                let mut nf =
                    CacheField::new(&unique_field_name(&cache, &format!("{}2", base.name)));
                nf.number_format = base.number_format.clone();
                nf.kind = base.kind;
                let order = table.item_order(&cache, field);
                let mut gmap = vec![0u32; base.shared_items.len()];
                for (pos, &it) in order.iter().enumerate() {
                    nf.shared_items.push(base.shared_items[it as usize].clone());
                    gmap[it as usize] = pos as u32;
                }
                nf.group = Some(FieldGroup {
                    base: field,
                    kind: GroupKind::Items { map: gmap },
                });
                cache.fields.push(nf);
                let n = cache.fields.len();
                for rec in &mut cache.records {
                    rec.resize(n, Item::Blank);
                }
                (n as u32 - 1, true)
            }
        };
        let gf = &cache.fields[g as usize];
        let Some(FieldGroup {
            kind: GroupKind::Items { map: old_map },
            ..
        }) = gf.group.clone()
        else {
            unreachable!("an items group")
        };
        let used: std::collections::HashSet<String> = gf
            .shared_items
            .iter()
            .map(|i| i.label(None).to_lowercase())
            .collect();
        let name = (1u32..)
            .map(|k| format!("Group{k}"))
            .find(|n| !used.contains(&n.to_lowercase()))
            .expect("unbounded");
        let selected: std::collections::BTreeSet<u32> = items.iter().copied().collect();
        let touched: std::collections::BTreeSet<u32> = selected
            .iter()
            .filter_map(|&b| old_map.get(b as usize).copied())
            .collect();
        // New group items: the new group where the first touched one was.
        let mut new_items: Vec<Item> = Vec::new();
        let mut renum: Vec<Option<u32>> = vec![None; gf.shared_items.len()];
        let mut group_at: Option<u32> = None;
        let still_used = |gi: u32| {
            old_map
                .iter()
                .enumerate()
                .any(|(b, &x)| x == gi && !selected.contains(&(b as u32)))
        };
        for (gi, item) in gf.shared_items.iter().enumerate() {
            let gi = gi as u32;
            if touched.contains(&gi) && group_at.is_none() {
                group_at = Some(new_items.len() as u32);
                new_items.push(Item::Text(name.clone()));
            }
            if !touched.contains(&gi) || still_used(gi) {
                renum[gi as usize] = Some(new_items.len() as u32);
                new_items.push(item.clone());
            }
        }
        let group_at = group_at.unwrap_or_else(|| {
            new_items.push(Item::Text(name.clone()));
            new_items.len() as u32 - 1
        });
        let new_map: Vec<u32> = old_map
            .iter()
            .enumerate()
            .map(|(b, &x)| {
                if selected.contains(&(b as u32)) {
                    group_at
                } else {
                    renum.get(x as usize).copied().flatten().unwrap_or(group_at)
                }
            })
            .collect();
        let gf = &mut cache.fields[g as usize];
        gf.shared_items = new_items;
        gf.group = Some(FieldGroup {
            base: field,
            kind: GroupKind::Items { map: new_map },
        });
        let touched_fields = [g];
        self.replace_pivot_cache(id, cache, map, &touched_fields, |t| {
            if created {
                insert_before(t, field, &[g]);
            }
        })
    }

    /// Ungroups field `field` of pivot table `id`'s cache (Excel's
    /// Ungroup): a date / number grouping goes with its level fields, a
    /// manual group field goes; with `items` (group items of a manual
    /// group field) only those groups are dissolved.
    pub fn ungroup_pivot_field(
        &mut self,
        id: u32,
        field: u32,
        items: Option<&[u32]>,
    ) -> Result<Recalc, Error> {
        let (s, i) = self.locate_pivot(id)?;
        let table = &self.pivots(s)[i];
        let mut cache = self
            .pivot_cache(table.cache_id)
            .cloned()
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        if cache.raw.is_some() || table.raw.is_some() {
            return Err(Error::InvalidPivot("this pivot table is read-only".into()));
        }
        let g = cache
            .fields
            .get(field as usize)
            .and_then(|f| f.group.clone())
            .ok_or_else(|| Error::InvalidPivot("the field is not grouped".into()))?;
        if let (Some(items), GroupKind::Items { map }) = (items, &g.kind) {
            // Dissolve the listed groups: their members become their own items.
            let base_items = cache.fields[g.base as usize].shared_items.clone();
            let gf = &cache.fields[field as usize];
            let dissolve: std::collections::BTreeSet<u32> = items.iter().copied().collect();
            let mut new_items = Vec::new();
            let mut renum: Vec<Option<u32>> = vec![None; gf.shared_items.len()];
            let mut new_map = map.clone();
            for (gi, item) in gf.shared_items.iter().enumerate() {
                let gi = gi as u32;
                if dissolve.contains(&gi) {
                    for (b, x) in map.iter().enumerate() {
                        if *x == gi {
                            new_map[b] = new_items.len() as u32;
                            new_items.push(base_items[b].clone());
                        }
                    }
                } else {
                    renum[gi as usize] = Some(new_items.len() as u32);
                    new_items.push(item.clone());
                }
            }
            for (b, x) in map.iter().enumerate() {
                if !dissolve.contains(x) {
                    new_map[b] = renum[*x as usize].unwrap_or(0);
                }
            }
            let gf = &mut cache.fields[field as usize];
            gf.shared_items = new_items;
            gf.group = Some(FieldGroup {
                base: g.base,
                kind: GroupKind::Items { map: new_map },
            });
            let map: Vec<Option<u32>> = (0..cache.fields.len() as u32).map(Some).collect();
            return self.replace_pivot_cache(id, cache, map, &[field], |_| {});
        }
        let (map, base) = cache.ungroup(field)?;
        self.replace_pivot_cache(id, cache, map, &[base], |_| {})
    }

    /// Replaces pivot table `id`'s cache by `cache` whose fields map from
    /// the old ones by `map`; the items of `reset` fields changed (their
    /// filters, collapsed items and manual orders go); `edit` adjusts
    /// table `id` afterwards. Every table of the cache is rewritten; on
    /// error nothing changes.
    pub(crate) fn replace_pivot_cache(
        &mut self,
        id: u32,
        cache: PivotCache,
        map: Vec<Option<u32>>,
        reset: &[u32],
        edit: impl FnOnce(&mut PivotTable),
    ) -> Result<Recalc, Error> {
        let Some(old_cache) = self.pivot_caches.iter().find(|c| c.id == cache.id).cloned() else {
            return Err(Error::InvalidPivot("no cache".into()));
        };
        // Item maps: identity, except for the reset fields (in new indices).
        let item_maps: Vec<Vec<Option<u32>>> = (0..old_cache.fields.len())
            .map(|f| {
                let keep = map[f].is_some_and(|nf| !reset.contains(&nf));
                (0..old_cache.fields[f].shared_items.len() as u32)
                    .map(|i| keep.then_some(i))
                    .collect()
            })
            .collect();
        self.replace_pivot_cache_with(id, cache, map, item_maps, edit)
    }

    /// [`replace_pivot_cache`](Self::replace_pivot_cache) with explicit
    /// item maps (`item_maps[old field][old item] = new item`).
    pub(crate) fn replace_pivot_cache_with(
        &mut self,
        id: u32,
        cache: PivotCache,
        map: Vec<Option<u32>>,
        item_maps: Vec<Vec<Option<u32>>>,
        edit: impl FnOnce(&mut PivotTable),
    ) -> Result<Recalc, Error> {
        let cache_id = cache.id;
        let ci = self
            .pivot_caches
            .iter()
            .position(|c| c.id == cache_id)
            .ok_or_else(|| Error::InvalidPivot("no cache".into()))?;
        let old_cache = self.pivot_caches[ci].clone();
        let users: Vec<(SheetId, u32)> = self
            .sheets()
            .into_iter()
            .flat_map(|(s, _)| {
                self.pivots(s)
                    .iter()
                    .filter(|p| p.cache_id == cache_id)
                    .map(move |p| (s, p.id))
                    .collect::<Vec<_>>()
            })
            .collect();
        let old_tables: Vec<(SheetId, Vec<PivotTable>)> = users
            .iter()
            .map(|(s, _)| *s)
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .map(|s| (s, self.pivots(s).to_vec()))
            .collect();
        self.pivot_caches[ci] = cache;
        let mut edit = Some(edit);
        for &(s, tid) in &users {
            if let Ok(data) = self.sheet_data_mut(s) {
                if let Some(p) = data.pivots.iter_mut().find(|p| p.id == tid) {
                    p.remap_fields(&map, &item_maps);
                    if tid == id {
                        if let Some(e) = edit.take() {
                            e(p);
                        }
                    }
                }
            }
        }
        let valid = {
            let c = &self.pivot_caches[ci];
            users.iter().try_for_each(|&(s, tid)| {
                self.pivots(s)
                    .iter()
                    .find(|p| p.id == tid)
                    .map_or(Ok(()), |p| p.validate(c))
            })
        };
        let result = valid.and_then(|()| self.render_pivots(&users));
        match result {
            Ok(r) => Ok(r),
            Err(e) => {
                self.pivot_caches[ci] = old_cache;
                for (s, tables) in old_tables {
                    if let Ok(data) = self.sheet_data_mut(s) {
                        data.pivots = tables;
                    }
                }
                Err(e)
            }
        }
    }
}

/// Puts the cache fields `added` (in order) just before `field` on its
/// axis of `t`; nothing when `field` is on no axis.
fn insert_before(t: &mut PivotTable, field: u32, added: &[u32]) {
    for axis in [&mut t.rows, &mut t.cols] {
        if let Some(pos) = axis.iter().position(|a| a.field == field) {
            let layout = axis[pos].layout;
            for (k, &f) in added.iter().enumerate() {
                axis.insert(
                    pos + k,
                    AxisField {
                        layout,
                        ..AxisField::from(f)
                    },
                );
            }
            return;
        }
    }
}

/// `SortOrder::Manual` orders over items that changed are dropped.
pub(crate) fn remap_sort(sort: SortOrder, items: impl Fn(u32) -> Option<u32>) -> SortOrder {
    match sort {
        SortOrder::Manual { order } => SortOrder::Manual {
            order: order.into_iter().filter_map(items).collect(),
        },
        s => s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        // 2024-01-15 18:00 = 45306.75; 1900-03-01 = 61.
        assert_eq!(civil(45306.75), (2024, 1, 15, 18, 0, 0));
        assert_eq!(civil(61.0), (1900, 3, 1, 0, 0, 0));
        assert_eq!(civil(59.0), (1900, 2, 28, 0, 0, 0));
    }

    #[test]
    fn number_bins() {
        let k = GroupKind::Number {
            start: 0.0,
            end: 25.0,
            interval: 10.0,
            auto_start: false,
            auto_end: false,
        };
        let items = range_items(&k);
        let labels: Vec<String> = items.iter().map(|i| i.label(None)).collect();
        assert_eq!(labels, ["<0", "0-9", "10-19", "20-29", ">25"]);
        assert_eq!(range_index(&k, &Item::Number(-1.0), &items), 0);
        assert_eq!(range_index(&k, &Item::Number(10.0), &items), 2);
        assert_eq!(range_index(&k, &Item::Number(25.0), &items), 3);
        assert_eq!(range_index(&k, &Item::Number(26.0), &items), 4);
        assert_eq!(range_index(&k, &Item::Text("x".into()), &items), u32::MAX);
    }

    #[test]
    fn date_levels() {
        let k = |by| GroupKind::Date {
            by,
            start: 45292.0, // 2024-01-01
            end: 45700.0,   // 2025-02-12
            interval: 1,
            auto_start: true,
            auto_end: true,
        };
        let years = range_items(&k(DateGroupBy::Years));
        assert_eq!(years[1], Item::Text("2024".into()));
        assert_eq!(years[2], Item::Text("2025".into()));
        assert_eq!(years[0], Item::Text("<1/1/2024".into()));
        // 2024-03-15 = 45366.
        let v = Item::Number(45366.0);
        assert_eq!(range_index(&k(DateGroupBy::Years), &v, &years), 1);
        let months = range_items(&k(DateGroupBy::Months));
        assert_eq!(months.len(), 14);
        assert_eq!(range_index(&k(DateGroupBy::Months), &v, &months), 3);
        let quarters = range_items(&k(DateGroupBy::Quarters));
        assert_eq!(range_index(&k(DateGroupBy::Quarters), &v, &quarters), 1);
        let days = range_items(&k(DateGroupBy::Days));
        assert_eq!(days.len(), 368);
        assert_eq!(
            days[range_index(&k(DateGroupBy::Days), &v, &days) as usize],
            Item::Text("15-Mar".into())
        );
        let hours = range_items(&k(DateGroupBy::Hours));
        assert_eq!(hours[1], Item::Text("12 AM".into()));
        assert_eq!(
            range_index(&k(DateGroupBy::Hours), &Item::Number(45366.75), &hours),
            19
        );
    }
}
