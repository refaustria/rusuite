//! Pivot tables (P8-30): `xl/pivotCache/pivotCacheDefinitionN.xml`,
//! `pivotCacheRecordsN.xml` and `xl/pivotTables/pivotTableN.xml` ↔
//! [`model_sheet::pivot`] (mapping in `docs/pivot.md` and
//! `docs/ooxml-subset.md`).
//!
//! The writer lists `rowItems`/`colItems` from the model's layout, so a
//! file opens without a refresh. The reader takes the definitions and
//! the cache records; the cells stay as stored unless the cache asks for
//! a refresh on load. Calculated fields and items, grouped fields, OLAP
//! and non-worksheet sources are kept as raw XML (read-only tables).

use std::collections::{BTreeSet, HashMap};

use fmt_ooxml::xml::{parse, El};
use fmt_ooxml::{rel, Package, PartName, Relationships, TargetMode};
use model_sheet::pivot::{
    AggFunc, AxisField, BaseItem, CacheField, CalculatedItem, DataField, DateGroupBy, FieldGroup,
    FieldKind, GroupKind, Item, LineKind, PageField, PageSelection, PivotCache, PivotFilter,
    PivotLayout, PivotOptions, PivotOutput, PivotRect, PivotSource, PivotTable, RawPivotXml,
    ShowAs, SortOrder, Subtotals, TopBy, ValuesAxis,
};
use model_sheet::{SheetId, StyleTable, Workbook};

use crate::a1::{parse_range, range_name};
use crate::styles::MAIN_NS;
use crate::xml::{fmt_num, xml_error, XmlOut};
use crate::Result;

pub(crate) const CACHE_DEF_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition";
pub(crate) const CACHE_RECORDS_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords";
pub(crate) const TABLE_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable";
const CACHE_DEF_CT: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml";
const CACHE_RECORDS_CT: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";
const TABLE_CT: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml";
const X14_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
/// `x14:dataField` (show values as % of parent, rank).
const X14_DATA_FIELD_EXT: &str = "{E15A36E0-9728-4e99-A89B-3F7291B0FE68}";
/// `x14:pivotField` (repeat item labels).
const X14_PIVOT_FIELD_EXT: &str = "{2946ED86-A175-432a-8AC1-64E0C546D7DE}";
/// `baseItem` values for the previous / next item.
const BASE_PREVIOUS: u32 = 1_048_828;
const BASE_NEXT: u32 = 1_048_829;
/// Rusuite's data field extension: a Distinct Count (Excel offers it for
/// data-model tables only; others read the field as a Count).
const RS_DATA_FIELD_EXT: &str = "{7B1C5D2E-6A3F-4E8B-9C0D-2F4A6B8C1E35}";
const RS_NS: &str = "https://rusuit.es/xlsx/2026/pivot";
/// The `field` of a data reference (`-2` as an unsigned int).
const DATA_FIELD_REF: &str = "4294967294";

// --- dates --------------------------------------------------------------------------

/// Days since 1970-01-01 of a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil date of days since 1970-01-01.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Serial 0 of the 1900 date system (serials from 61 on; Excel counts a
/// fictitious 1900-02-29 as 60).
fn serial_base() -> i64 {
    days_from_civil(1899, 12, 30)
}

/// A date serial as `yyyy-mm-ddThh:mm:ss` (1900 system).
fn iso_of_serial(serial: f64) -> String {
    let days = serial.floor() as i64;
    let secs = ((serial - serial.floor()) * 86_400.0).round() as i64;
    let z = serial_base() + if days < 61 { days + 1 } else { days };
    let (y, m, d) = civil_from_days(z);
    let (h, mi, s) = (secs / 3600, (secs / 60) % 60, secs % 60);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}")
}

/// `yyyy-mm-dd[Thh:mm:ss]` as a date serial.
fn serial_of_iso(s: &str) -> Option<f64> {
    let (date, time) = s.split_once('T').unwrap_or((s, ""));
    let mut it = date.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    let mut days = days_from_civil(y, m, d) - serial_base();
    if days < 61 {
        days -= 1;
    }
    let mut frac = 0.0;
    if !time.is_empty() {
        let parts: Vec<f64> = time
            .trim_end_matches('Z')
            .split(':')
            .filter_map(|p| p.parse().ok())
            .collect();
        frac = (parts.first().unwrap_or(&0.0) * 3600.0
            + parts.get(1).unwrap_or(&0.0) * 60.0
            + parts.get(2).unwrap_or(&0.0))
            / 86_400.0;
    }
    Some(days as f64 + frac)
}

// --- number formats ---------------------------------------------------------------

/// The `numFmtId` the style writer gives `code` (see
/// `styles::write_styles_with_dxfs`), `None` when no cell uses it.
fn num_fmt_id(table: &StyleTable, code: &str) -> Option<u32> {
    use model_sheet::numfmt::builtin_id;
    if let Some(id) = builtin_id(code) {
        return Some(u32::from(id));
    }
    let mut custom: Vec<&str> = Vec::new();
    for (_, s) in table.iter() {
        if let Some(c) = s.number_format.as_deref() {
            if builtin_id(c).is_none() && !custom.contains(&c) {
                custom.push(c);
            }
        }
    }
    custom
        .iter()
        .position(|c| *c == code)
        .map(|i| 164 + i as u32)
}

// --- writing ------------------------------------------------------------------------

/// Numbers the caches and tables across the workbook while writing.
#[derive(Default)]
pub(crate) struct PivotParts {
    tables: usize,
    /// Cache id → file number, in first-use order.
    caches: Vec<u32>,
}

/// The items a field lists in `sharedItems` (axis and page fields, and
/// every field that is not purely numeric).
fn itemized(cache: &PivotCache, tables: &[&PivotTable], f: u32, slicers: &BTreeSet<u32>) -> bool {
    let field = &cache.fields[f as usize];
    // Grouped values are written as they are (the items are `groupItems`).
    if field.group.is_some() || !field.is_source(f) {
        return false;
    }
    let grouped_by_items = cache.fields.iter().any(|g| {
        g.group
            .as_ref()
            .is_some_and(|g| g.base == f && matches!(g.kind, GroupKind::Items { .. }))
    });
    grouped_by_items
        || cache.calculated_items.iter().any(|c| c.field == f)
        || tables.iter().any(|t| {
            t.rows.iter().chain(&t.cols).any(|a| a.field == f)
                || t.filters
                    .iter()
                    .chain(&t.field_filters)
                    .any(|p| p.field == f)
        })
        || slicers.contains(&f)
        || !matches!(field.kind, FieldKind::Number | FieldKind::Date)
}

/// The fields of pivot cache `cache` a slicer shows (they need shared
/// items: the slicer cache lists them by index).
pub(crate) fn slicer_fields(wb: &Workbook, cache: u32) -> BTreeSet<u32> {
    wb.slicer_caches()
        .iter()
        .filter_map(|c| match &c.source {
            model_sheet::SlicerSource::Pivot {
                cache: id, field, ..
            } if *id == cache => Some(*field),
            _ => None,
        })
        .collect()
}

/// Excel 2010's cache extension: the `pivotCacheId` slicer caches refer to.
const X14_CACHE_DEF_EXT: &str = "{725AE2AE-9491-48be-B2B4-4EB974FC3084}";

fn item_el(x: &mut XmlOut, item: &Item, date: bool) {
    match item {
        Item::Blank => x.empty("m", &[]),
        Item::Number(n) if date => x.empty("d", &[("v", &iso_of_serial(*n))]),
        Item::Number(n) => x.empty("n", &[("v", &fmt_num(*n))]),
        Item::Text(t) => x.empty("s", &[("v", &crate::xml::encode_x_escapes(t))]),
        Item::Bool(b) => x.empty("b", &[("v", if *b { "1" } else { "0" })]),
        Item::Error(e) => x.empty("e", &[("v", e)]),
    }
}

fn shared_items_el(x: &mut XmlOut, field: &CacheField, items: Option<&[Item]>, all: &[&Item]) {
    let date = field.kind == FieldKind::Date;
    let (mut num, mut text, mut blank, mut other, mut int) = (false, false, false, false, true);
    let (mut min, mut max) = (f64::INFINITY, f64::NEG_INFINITY);
    for it in all {
        match it {
            Item::Blank => blank = true,
            Item::Number(n) => {
                num = true;
                int &= n.fract() == 0.0;
                min = min.min(*n);
                max = max.max(*n);
            }
            Item::Text(_) => text = true,
            Item::Bool(_) | Item::Error(_) => other = true,
        }
    }
    let mut a: Vec<(&str, String)> = Vec::new();
    if !(text || blank || other) {
        a.push(("containsSemiMixedTypes", "0".into()));
    }
    if date {
        a.push(("containsNonDate", "0".into()));
        a.push(("containsDate", "1".into()));
    }
    if !text {
        a.push(("containsString", "0".into()));
    }
    if blank {
        a.push(("containsBlank", "1".into()));
    }
    if [num, text, other].iter().filter(|b| **b).count() > 1 {
        a.push(("containsMixedTypes", "1".into()));
    }
    if num && !date {
        a.push(("containsNumber", "1".into()));
        if int {
            a.push(("containsInteger", "1".into()));
        }
        a.push(("minValue", fmt_num(min)));
        a.push(("maxValue", fmt_num(max)));
    }
    if num && date {
        a.push(("minDate", iso_of_serial(min)));
        a.push(("maxDate", iso_of_serial(max)));
    }
    if let Some(items) = items {
        a.push(("count", items.len().to_string()));
    }
    let attrs: Vec<(&str, &str)> = a.iter().map(|(k, v)| (*k, v.as_str())).collect();
    match items {
        Some(items) if !items.is_empty() => {
            x.start("sharedItems", &attrs);
            for it in items {
                item_el(x, it, date);
            }
            x.end("sharedItems");
        }
        _ => x.empty("sharedItems", &attrs),
    }
}

/// The date level of a range grouping (`None`: numbers or manual).
fn date_level(g: &FieldGroup) -> Option<DateGroupBy> {
    match g.kind {
        GroupKind::Date { by, .. } => Some(by),
        _ => None,
    }
}

/// `<fieldGroup>` of field `i`: `par` (the next coarser date level of
/// the same base), `base`, `rangePr` / `discretePr` and `groupItems`.
fn field_group_el(x: &mut XmlOut, cache: &PivotCache, i: u32, g: &FieldGroup, items: &[Item]) {
    let par = date_level(g).and_then(|level| {
        cache
            .fields
            .iter()
            .enumerate()
            .filter_map(|(j, f)| {
                let fg = f.group.as_ref()?;
                let l = date_level(fg)?;
                (fg.base == g.base && l > level && j as u32 != i).then_some((l, j))
            })
            .min()
            .map(|(_, j)| j.to_string())
    });
    let base = g.base.to_string();
    let mut a: Vec<(&str, &str)> = Vec::new();
    if let Some(p) = &par {
        a.push(("par", p));
    }
    a.push(("base", &base));
    x.start("fieldGroup", &a);
    match &g.kind {
        GroupKind::Number {
            start,
            end,
            interval,
            auto_start,
            auto_end,
        } => {
            let (s0, e0, iv) = (fmt_num(*start), fmt_num(*end), fmt_num(*interval));
            let mut r: Vec<(&str, &str)> = Vec::new();
            if !auto_start {
                r.push(("autoStart", "0"));
            }
            if !auto_end {
                r.push(("autoEnd", "0"));
            }
            r.extend([
                ("startNum", s0.as_str()),
                ("endNum", &e0),
                ("groupInterval", &iv),
            ]);
            x.empty("rangePr", &r);
        }
        GroupKind::Date {
            by,
            start,
            end,
            interval,
            auto_start,
            auto_end,
        } => {
            let (s0, e0, iv) = (
                iso_of_serial(*start),
                iso_of_serial(*end),
                interval.to_string(),
            );
            let mut r: Vec<(&str, &str)> = Vec::new();
            if !auto_start {
                r.push(("autoStart", "0"));
            }
            if !auto_end {
                r.push(("autoEnd", "0"));
            }
            r.extend([
                ("groupBy", by.xml_name()),
                ("startDate", &s0),
                ("endDate", &e0),
            ]);
            if *interval > 1 {
                r.push(("groupInterval", &iv));
            }
            x.empty("rangePr", &r);
        }
        GroupKind::Items { map } => {
            x.start("discretePr", &[("count", &map.len().to_string())]);
            for v in map {
                x.empty("x", &[("v", &v.to_string())]);
            }
            x.end("discretePr");
        }
    }
    x.start("groupItems", &[("count", &items.len().to_string())]);
    for it in items {
        item_el(x, it, false);
    }
    x.end("groupItems");
    x.end("fieldGroup");
}

fn cache_definition_xml(wb: &Workbook, cache: &PivotCache, tables: &[&PivotTable]) -> Vec<u8> {
    let slicers = slicer_fields(wb, cache.id);
    let mut x = XmlOut::new();
    let count = cache.records.len().to_string();
    let mut a: Vec<(&str, &str)> = vec![("xmlns", MAIN_NS), ("xmlns:r", rel::NS), ("r:id", "rId1")];
    if cache.refresh_on_load {
        a.push(("refreshOnLoad", "1"));
    }
    a.extend([
        ("createdVersion", "6"),
        ("refreshedVersion", "6"),
        ("minRefreshableVersion", "3"),
        ("recordCount", count.as_str()),
    ]);
    x.start("pivotCacheDefinition", &a);
    x.start("cacheSource", &[("type", "worksheet")]);
    match &cache.source {
        PivotSource::Range {
            sheet,
            r0,
            c0,
            r1,
            c1,
        } => x.empty(
            "worksheetSource",
            &[("ref", &range_name(*r0, *c0, *r1, *c1)), ("sheet", sheet)],
        ),
        PivotSource::Table { name } | PivotSource::Name { name } => {
            x.empty("worksheetSource", &[("name", name)])
        }
    }
    x.end("cacheSource");
    x.start("cacheFields", &[("count", &cache.fields.len().to_string())]);
    for (i, f) in cache.fields.iter().enumerate() {
        let fmt = f
            .number_format
            .as_deref()
            .and_then(|c| num_fmt_id(wb.styles(), c))
            .unwrap_or(0)
            .to_string();
        let name = crate::xml::encode_x_escapes(&f.name);
        let mut ca: Vec<(&str, &str)> = vec![("name", &name), ("numFmtId", &fmt)];
        if let Some(formula) = &f.formula {
            ca.push(("formula", formula));
        }
        let source = f.is_source(i as u32);
        if !source {
            ca.push(("databaseField", "0"));
        }
        if f.formula.is_some() {
            x.empty("cacheField", &ca);
            continue;
        }
        x.start("cacheField", &ca);
        if source {
            let all: Vec<&Item> = cache.records.iter().filter_map(|r| r.get(i)).collect();
            if itemized(cache, tables, i as u32, &slicers) {
                let items: Vec<&Item> = f.shared_items.iter().collect();
                shared_items_el(&mut x, f, Some(&f.shared_items), &items);
            } else {
                shared_items_el(&mut x, f, None, &all);
            }
        }
        if let Some(g) = &f.group {
            field_group_el(&mut x, cache, i as u32, g, &f.shared_items);
        }
        x.end("cacheField");
    }
    x.end("cacheFields");
    if !cache.calculated_items.is_empty() {
        x.start(
            "calculatedItems",
            &[("count", &cache.calculated_items.len().to_string())],
        );
        for c in &cache.calculated_items {
            x.start("calculatedItem", &[("formula", &c.formula)]);
            x.start(
                "pivotArea",
                &[
                    ("cacheIndex", "1"),
                    ("outline", "0"),
                    ("fieldPosition", "0"),
                ],
            );
            x.start("references", &[("count", "1")]);
            x.start(
                "reference",
                &[("field", &c.field.to_string()), ("count", "1")],
            );
            x.empty("x", &[("v", &c.item.to_string())]);
            x.end("reference");
            x.end("references");
            x.end("pivotArea");
            x.end("calculatedItem");
        }
        x.end("calculatedItems");
    }
    if !slicers.is_empty() {
        x.start("extLst", &[]);
        x.start("ext", &[("uri", X14_CACHE_DEF_EXT), ("xmlns:x14", X14_NS)]);
        x.empty(
            "x14:pivotCacheDefinition",
            &[("pivotCacheId", &cache.id.to_string())],
        );
        x.end("ext");
        x.end("extLst");
    }
    x.end("pivotCacheDefinition");
    x.finish()
}

fn cache_records_xml(
    cache: &PivotCache,
    tables: &[&PivotTable],
    slicers: &BTreeSet<u32>,
) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "pivotCacheRecords",
        &[
            ("xmlns", MAIN_NS),
            ("xmlns:r", rel::NS),
            ("count", &cache.records.len().to_string()),
        ],
    );
    let maps: Vec<Option<HashMap<String, usize>>> = (0..cache.fields.len())
        .map(|f| {
            itemized(cache, tables, f as u32, slicers).then(|| {
                cache.fields[f]
                    .shared_items
                    .iter()
                    .enumerate()
                    .map(|(i, it)| (format!("{:?}", key_of(it)), i))
                    .collect()
            })
        })
        .collect();
    for rec in &cache.records {
        x.start("r", &[]);
        for (f, it) in rec.iter().enumerate() {
            if !cache.fields.get(f).is_some_and(|cf| cf.is_source(f as u32)) {
                continue;
            }
            match maps.get(f).and_then(Option::as_ref) {
                Some(map) => {
                    let i = map.get(&format!("{:?}", key_of(it))).copied().unwrap_or(0);
                    if i == 0 {
                        x.empty("x", &[]);
                    } else {
                        x.empty("x", &[("v", &i.to_string())]);
                    }
                }
                None => item_el(&mut x, it, cache.fields[f].kind == FieldKind::Date),
            }
        }
        x.end("r");
    }
    x.end("pivotCacheRecords");
    x.finish()
}

/// Item identity for the record → shared item map (text ignoring case).
fn key_of(it: &Item) -> (u8, String) {
    match it {
        Item::Blank => (0, String::new()),
        Item::Number(n) => (1, fmt_num(*n + 0.0)),
        Item::Text(t) => (2, t.to_lowercase()),
        Item::Bool(b) => (3, b.to_string()),
        Item::Error(e) => (4, e.clone()),
    }
}

/// The `ST_ItemType` of a custom subtotal.
fn item_type(f: AggFunc) -> &'static str {
    match f {
        AggFunc::Count => "countA",
        AggFunc::CountNums => "count",
        AggFunc::Average => "avg",
        AggFunc::StdDevP => "stdDevP",
        AggFunc::VarP => "varP",
        other => other.xml_name(),
    }
}

/// `<i>` lines of `rowItems`/`colItems`.
fn items_xml(x: &mut XmlOut, name: &str, lines: &[model_sheet::pivot::AxisLine]) {
    x.start(name, &[("count", &lines.len().max(1).to_string())]);
    if lines.is_empty() {
        x.empty("i", &[]);
    }
    let mut prev: Vec<u32> = Vec::new();
    for l in lines {
        let r = if l.kind == LineKind::Data {
            l.items
                .iter()
                .zip(&prev)
                .take_while(|(a, b)| a == b)
                .count()
                .min(l.items.len().saturating_sub(1))
        } else {
            0
        };
        let t = match l.kind {
            LineKind::Data => None,
            LineKind::Default => Some("default"),
            LineKind::Func(f) => Some(item_type(f)),
            LineKind::Grand => Some("grand"),
            LineKind::Blank => Some("blank"),
        };
        let r_s = r.to_string();
        let i_s = l.data.to_string();
        let mut a: Vec<(&str, &str)> = Vec::new();
        if let Some(t) = t {
            a.push(("t", t));
        }
        if r > 0 {
            a.push(("r", &r_s));
        }
        if l.data > 0 {
            a.push(("i", &i_s));
        }
        let rest = &l.items[r.min(l.items.len())..];
        if rest.is_empty() {
            x.empty("i", &a);
        } else {
            x.start("i", &a);
            for v in rest {
                if *v == 0 {
                    x.empty("x", &[]);
                } else {
                    x.empty("x", &[("v", &v.to_string())]);
                }
            }
            x.end("i");
        }
        if l.kind == LineKind::Data {
            prev = l.items.clone();
        }
    }
    x.end(name);
}

fn bool_attr(v: bool) -> &'static str {
    if v {
        "1"
    } else {
        "0"
    }
}

fn table_xml(wb: &Workbook, t: &PivotTable, cache: &PivotCache, out: &PivotOutput) -> Vec<u8> {
    let o = &t.options;
    let mut x = XmlOut::new();
    let form = t.rows.first().map_or(PivotLayout::Compact, |a| a.layout);
    let cache_id = t.cache_id.to_string();
    let indent = o.compact_rows_indent.to_string();
    let data_pos = o.values_position.map(|p| p.to_string());
    let mut a: Vec<(&str, &str)> = vec![
        ("xmlns", MAIN_NS),
        ("name", &t.name),
        ("cacheId", &cache_id),
        ("applyNumberFormats", "0"),
        ("applyBorderFormats", "0"),
        ("applyFontFormats", "0"),
        ("applyPatternFormats", "0"),
        ("applyAlignmentFormats", "0"),
        ("applyWidthHeightFormats", "1"),
        ("dataCaption", "Values"),
    ];
    if o.values_in == ValuesAxis::Rows {
        a.push(("dataOnRows", "1"));
    }
    if let Some(p) = &data_pos {
        a.push(("dataPosition", p));
    }
    if let Some(e) = &o.error_as {
        a.push(("showError", "1"));
        a.push(("errorCaption", e));
    }
    if !o.empty_as.is_empty() {
        a.push(("missingCaption", &o.empty_as));
    }
    if !o.show_field_headers {
        a.push(("showHeaders", "0"));
    }
    a.extend([
        ("updatedVersion", "6"),
        ("minRefreshableVersion", "3"),
        ("useAutoFormatting", "1"),
        ("itemPrintTitles", "1"),
        ("createdVersion", "6"),
    ]);
    if o.compact_rows_indent != 1 {
        a.push(("indent", &indent));
    }
    if !o.grand_total_rows {
        a.push(("rowGrandTotals", "0"));
    }
    if !o.grand_total_cols {
        a.push(("colGrandTotals", "0"));
    }
    if form != PivotLayout::Compact {
        a.push(("compact", "0"));
        a.push(("compactData", "0"));
    }
    if form != PivotLayout::Tabular {
        a.push(("outline", "1"));
        a.push(("outlineData", "1"));
    }
    a.push(("multipleFieldFilters", "0"));
    x.start("pivotTableDefinition", &a);
    // Location.
    let l = out.table;
    let (fhr, fdr, fdc) = (
        out.first_header_row.to_string(),
        out.header_rows.to_string(),
        out.label_cols.to_string(),
    );
    let pages = t.filters.len().to_string();
    let mut la: Vec<(&str, &str)> = vec![
        ("ref", ""),
        ("firstHeaderRow", &fhr),
        ("firstDataRow", &fdr),
        ("firstDataCol", &fdc),
    ];
    let reference = range_name(l.r0, l.c0, l.r1, l.c1);
    la[0].1 = &reference;
    if !t.filters.is_empty() {
        la.push(("rowPageCount", &pages));
        la.push(("colPageCount", "1"));
    }
    x.empty("location", &la);
    // Fields.
    x.start("pivotFields", &[("count", &cache.fields.len().to_string())]);
    for f in 0..cache.fields.len() as u32 {
        let on_rows = t.rows.iter().find(|a| a.field == f);
        let on_cols = t.cols.iter().find(|a| a.field == f);
        let page = t.filters.iter().find(|p| p.field == f);
        let axis = on_rows.or(on_cols);
        let mut fa: Vec<(&str, String)> = Vec::new();
        if on_rows.is_some() {
            fa.push(("axis", "axisRow".into()));
        } else if on_cols.is_some() {
            fa.push(("axis", "axisCol".into()));
        } else if page.is_some() {
            fa.push(("axis", "axisPage".into()));
        }
        if t.values.iter().any(|d| d.field == f) {
            fa.push(("dataField", "1".into()));
        }
        if cache.fields[f as usize].formula.is_some() {
            for k in ["dragToRow", "dragToCol", "dragToPage"] {
                fa.push((k, "0".into()));
            }
        }
        let show_all = axis.is_some_and(|a| a.show_all_items);
        if !show_all {
            fa.push(("showAll", "0".into()));
        }
        if let Some(a) = on_rows {
            if a.insert_blank_row {
                fa.push(("insertBlankRow", "1".into()));
            }
            if a.subtotal_bottom {
                fa.push(("subtotalTop", "0".into()));
            }
            match a.layout {
                PivotLayout::Compact => {}
                PivotLayout::Outline => fa.push(("compact", "0".into())),
                PivotLayout::Tabular => {
                    fa.push(("compact", "0".into()));
                    fa.push(("outline", "0".into()));
                }
            }
        }
        if let Some(p) = page {
            if matches!(&p.selected, PageSelection::Items { items } if items.len() > 1) {
                fa.push(("multipleItemSelectionAllowed", "1".into()));
            }
        }
        if let Some(a) = axis {
            match &a.sort {
                SortOrder::Ascending => fa.push(("sortType", "ascending".into())),
                SortOrder::Descending => fa.push(("sortType", "descending".into())),
                SortOrder::ByValue { descending, .. } => fa.push((
                    "sortType",
                    if *descending {
                        "descending"
                    } else {
                        "ascending"
                    }
                    .into(),
                )),
                SortOrder::Manual { .. } => {}
            }
            match &a.subtotals {
                Subtotals::Automatic => {}
                Subtotals::None => fa.push(("defaultSubtotal", "0".into())),
                Subtotals::Custom { functions } => {
                    fa.push(("defaultSubtotal", "0".into()));
                    for func in functions {
                        let name: &'static str = match func {
                            AggFunc::Sum => "sumSubtotal",
                            AggFunc::Count => "countASubtotal",
                            AggFunc::Average => "avgSubtotal",
                            AggFunc::Max => "maxSubtotal",
                            AggFunc::Min => "minSubtotal",
                            AggFunc::Product => "productSubtotal",
                            AggFunc::CountNums => "countSubtotal",
                            AggFunc::StdDev => "stdDevSubtotal",
                            AggFunc::StdDevP => "stdDevPSubtotal",
                            AggFunc::Var => "varSubtotal",
                            AggFunc::VarP => "varPSubtotal",
                            AggFunc::DistinctCount => "countASubtotal",
                        };
                        fa.push((name, "1".into()));
                    }
                }
            }
        } else if page.is_some() {
            // Page fields: no subtotals.
        }
        let attrs: Vec<(&str, &str)> = fa.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let repeat = on_rows.is_some() && o.repeat_labels;
        let slicer = t.field_filters.iter().find(|p| p.field == f);
        if axis.is_none() && page.is_none() {
            // A slicer's filter on a field on no axis: its hidden items.
            match slicer.map(|p| &p.selected) {
                Some(PageSelection::Items { items }) => {
                    x.start("pivotField", &attrs);
                    let order = t.item_order(cache, f);
                    x.start("items", &[("count", &order.len().to_string())]);
                    for i in &order {
                        let xi = i.to_string();
                        if items.contains(i) {
                            x.empty("item", &[("x", &xi)]);
                        } else {
                            x.empty("item", &[("h", "1"), ("x", &xi)]);
                        }
                    }
                    x.end("items");
                    x.end("pivotField");
                }
                _ => x.empty("pivotField", &attrs),
            }
            continue;
        }
        x.start("pivotField", &attrs);
        let order = t.item_order(cache, f);
        let mut items_n = order.len();
        let subtotal_items: Vec<&str> = match axis.map(|a| &a.subtotals) {
            Some(Subtotals::Automatic) => vec!["default"],
            Some(Subtotals::Custom { functions }) => {
                functions.iter().map(|f| item_type(*f)).collect()
            }
            None if page.is_some() => vec!["default"],
            _ => Vec::new(),
        };
        items_n += subtotal_items.len();
        x.start("items", &[("count", &items_n.to_string())]);
        for i in &order {
            let xi = i.to_string();
            let mut ia: Vec<(&str, &str)> = Vec::new();
            let hidden = match (axis, page) {
                (Some(a), _) => a.hidden_items.contains(i),
                (None, Some(p)) => {
                    matches!(&p.selected, PageSelection::Items { items } if items.len() > 1 && !items.contains(i))
                }
                _ => false,
            };
            if hidden {
                ia.push(("h", "1"));
            }
            if axis.is_some_and(|a| a.collapsed_items.contains(i)) {
                ia.push(("sd", "0"));
            }
            if cache.calculated_item(f, *i).is_some() {
                ia.push(("f", "1"));
            }
            ia.push(("x", &xi));
            x.empty("item", &ia);
        }
        for t in subtotal_items {
            x.empty("item", &[("t", t)]);
        }
        x.end("items");
        if let Some(SortOrder::ByValue { data, .. }) = axis.map(|a| &a.sort) {
            x.start("autoSortScope", &[]);
            x.start(
                "pivotArea",
                &[("dataOnly", "0"), ("outline", "0"), ("fieldPosition", "0")],
            );
            x.start("references", &[("count", "1")]);
            x.start(
                "reference",
                &[("field", DATA_FIELD_REF), ("count", "1"), ("selected", "0")],
            );
            x.empty("x", &[("v", &data.to_string())]);
            x.end("reference");
            x.end("references");
            x.end("pivotArea");
            x.end("autoSortScope");
        }
        if repeat {
            x.start("extLst", &[]);
            x.start(
                "ext",
                &[("uri", X14_PIVOT_FIELD_EXT), ("xmlns:x14", X14_NS)],
            );
            x.empty("x14:pivotField", &[("fillDownLabels", "1")]);
            x.end("ext");
            x.end("extLst");
        }
        x.end("pivotField");
    }
    x.end("pivotFields");
    let fields_xml = |x: &mut XmlOut, name: &str, list: &[i32]| {
        if list.is_empty() {
            return;
        }
        x.start(name, &[("count", &list.len().to_string())]);
        for f in list {
            x.empty("field", &[("x", &f.to_string())]);
        }
        x.end(name);
    };
    fields_xml(&mut x, "rowFields", &out.row_fields);
    if !out.row_fields.is_empty() || !out.row_items.is_empty() {
        items_xml(&mut x, "rowItems", &out.row_items);
    }
    fields_xml(&mut x, "colFields", &out.col_fields);
    items_xml(&mut x, "colItems", &out.col_items);
    if !t.filters.is_empty() {
        x.start("pageFields", &[("count", &t.filters.len().to_string())]);
        for p in &t.filters {
            let fld = p.field.to_string();
            let mut pa: Vec<(&str, &str)> = vec![("fld", &fld)];
            let pos = match &p.selected {
                PageSelection::Items { items } if items.len() == 1 => {
                    let i = *items.iter().next().expect("one");
                    t.item_order(cache, p.field)
                        .iter()
                        .position(|&o| o == i)
                        .map(|p| p.to_string())
                }
                _ => None,
            };
            if let Some(pos) = &pos {
                pa.push(("item", pos));
            }
            pa.push(("hier", "-1"));
            x.empty("pageField", &pa);
        }
        x.end("pageFields");
    }
    if !t.values.is_empty() {
        x.start("dataFields", &[("count", &t.values.len().to_string())]);
        for d in &t.values {
            let name = d.caption(cache);
            let fld = d.field.to_string();
            let mut da: Vec<(&str, String)> = vec![("name", name), ("fld", fld)];
            if d.func != AggFunc::Sum {
                da.push(("subtotal", d.func.xml_name().into()));
            }
            let pos = |base_field: u32, base_item: BaseItem| match base_item {
                BaseItem::Previous => BASE_PREVIOUS,
                BaseItem::Next => BASE_NEXT,
                BaseItem::Item { item } => t
                    .item_order(cache, base_field)
                    .iter()
                    .position(|&o| o == item)
                    .unwrap_or(0) as u32,
            };
            let (show, base, item, x14): (Option<&str>, u32, u32, Option<&str>) = match d.show_as {
                ShowAs::Normal => (None, 0, 0, None),
                ShowAs::PercentOfTotal => (Some("percentOfTotal"), 0, 0, None),
                ShowAs::PercentOfRow => (Some("percentOfRow"), 0, 0, None),
                ShowAs::PercentOfColumn => (Some("percentOfCol"), 0, 0, None),
                ShowAs::PercentOfParent => (None, 0, 0, Some("percentOfParentRow")),
                ShowAs::DifferenceFrom {
                    base_field,
                    base_item,
                } => {
                    let item = match base_item {
                        BaseItem::Previous => BASE_PREVIOUS,
                        BaseItem::Next => BASE_NEXT,
                        BaseItem::Item { item } => t
                            .item_order(cache, base_field)
                            .iter()
                            .position(|&o| o == item)
                            .unwrap_or(0) as u32,
                    };
                    (Some("difference"), base_field, item, None)
                }
                ShowAs::RunningTotal { base_field } => (Some("runTotal"), base_field, 0, None),
                ShowAs::Rank { base_field } => (None, base_field, 0, Some("rankDescending")),
                ShowAs::RankAscending { base_field } => {
                    (None, base_field, 0, Some("rankAscending"))
                }
                ShowAs::PercentOfParentColumn => (None, 0, 0, Some("percentOfParentCol")),
                ShowAs::PercentOfParentTotal { base_field } => {
                    (None, base_field, 0, Some("percentOfParent"))
                }
                ShowAs::PercentRunningTotal { base_field } => {
                    (None, base_field, 0, Some("percentOfRunningTotal"))
                }
                ShowAs::PercentOf {
                    base_field,
                    base_item,
                } => (
                    Some("percent"),
                    base_field,
                    pos(base_field, base_item),
                    None,
                ),
                ShowAs::PercentDifferenceFrom {
                    base_field,
                    base_item,
                } => (
                    Some("percentDiff"),
                    base_field,
                    pos(base_field, base_item),
                    None,
                ),
                ShowAs::Index => (Some("index"), 0, 0, None),
            };
            if let Some(s) = show {
                da.push(("showDataAs", s.into()));
            }
            da.push(("baseField", base.to_string()));
            da.push(("baseItem", item.to_string()));
            if let Some(id) = d
                .number_format
                .as_deref()
                .and_then(|c| num_fmt_id(wb.styles(), c))
            {
                da.push(("numFmtId", id.to_string()));
            }
            let attrs: Vec<(&str, &str)> = da.iter().map(|(k, v)| (*k, v.as_str())).collect();
            let distinct = d.func == AggFunc::DistinctCount;
            if x14.is_none() && !distinct {
                x.empty("dataField", &attrs);
            } else {
                x.start("dataField", &attrs);
                x.start("extLst", &[]);
                if let Some(v) = x14 {
                    x.start("ext", &[("uri", X14_DATA_FIELD_EXT), ("xmlns:x14", X14_NS)]);
                    x.empty("x14:dataField", &[("pivotShowAs", v)]);
                    x.end("ext");
                }
                if distinct {
                    x.start("ext", &[("uri", RS_DATA_FIELD_EXT), ("xmlns:rs", RS_NS)]);
                    x.empty("rs:dataField", &[("distinctCount", "1")]);
                    x.end("ext");
                }
                x.end("extLst");
                x.end("dataField");
            }
        }
        x.end("dataFields");
    }
    x.empty(
        "pivotTableStyleInfo",
        &[
            ("name", &o.style),
            ("showRowHeaders", bool_attr(o.row_headers_bold)),
            ("showColHeaders", bool_attr(o.col_headers_bold)),
            ("showRowStripes", bool_attr(o.banded)),
            ("showColStripes", bool_attr(o.banded_cols)),
            ("showLastColumn", "1"),
        ],
    );
    filters_xml(&mut x, t);
    x.end("pivotTableDefinition");
    x.finish()
}

/// `<filters>`: the label, date and value filters of the axis fields.
fn filters_xml(x: &mut XmlOut, t: &PivotTable) {
    let list: Vec<(u32, &PivotFilter)> = t
        .rows
        .iter()
        .chain(&t.cols)
        .filter_map(|a| Some((a.field, a.filter.as_ref()?)))
        .collect();
    if list.is_empty() {
        return;
    }
    x.start("filters", &[("count", &list.len().to_string())]);
    for (k, (field, f)) in list.iter().enumerate() {
        let fld = field.to_string();
        let id = (k + 1).to_string();
        let mut a: Vec<(&str, String)> = vec![("fld", fld)];
        if let Some(d) = f.data() {
            a.push(("iMeasureFld", d.to_string()));
        }
        a.push(("type", f.xml_type().into()));
        a.push(("evalOrder", "-1".into()));
        a.push(("id", id));
        if let PivotFilter::Label { value, value2, .. } = f {
            a.push(("stringValue1", value.clone()));
            if !value2.is_empty() {
                a.push(("stringValue2", value2.clone()));
            }
        }
        let attrs: Vec<(&str, &str)> = a.iter().map(|(k, v)| (*k, v.as_str())).collect();
        x.start("filter", &attrs);
        x.start("autoFilter", &[("ref", "A1")]);
        x.start("filterColumn", &[("colId", "0")]);
        match f {
            PivotFilter::Top {
                bottom, count, by, ..
            } => {
                let c = fmt_num(*count);
                let mut ta: Vec<(&str, &str)> = Vec::new();
                if *bottom {
                    ta.push(("top", "0"));
                }
                if *by == TopBy::Percent {
                    ta.push(("percent", "1"));
                }
                ta.push(("val", &c));
                ta.push(("filterVal", &c));
                x.empty("top10", &ta);
            }
            PivotFilter::Label { op, value, value2 } => {
                use model_sheet::pivot::LabelOp as L;
                let (and, items): (bool, Vec<(Option<&str>, String)>) = match op {
                    L::Equal => (false, vec![(None, value.clone())]),
                    L::NotEqual => (false, vec![(Some("notEqual"), value.clone())]),
                    L::BeginsWith => (false, vec![(None, format!("{value}*"))]),
                    L::NotBeginsWith => (false, vec![(Some("notEqual"), format!("{value}*"))]),
                    L::EndsWith => (false, vec![(None, format!("*{value}"))]),
                    L::NotEndsWith => (false, vec![(Some("notEqual"), format!("*{value}"))]),
                    L::Contains => (false, vec![(None, format!("*{value}*"))]),
                    L::NotContains => (false, vec![(Some("notEqual"), format!("*{value}*"))]),
                    L::Greater => (false, vec![(Some("greaterThan"), value.clone())]),
                    L::GreaterOrEqual => (false, vec![(Some("greaterThanOrEqual"), value.clone())]),
                    L::Less => (false, vec![(Some("lessThan"), value.clone())]),
                    L::LessOrEqual => (false, vec![(Some("lessThanOrEqual"), value.clone())]),
                    L::Between => (
                        true,
                        vec![
                            (Some("greaterThanOrEqual"), value.clone()),
                            (Some("lessThanOrEqual"), value2.clone()),
                        ],
                    ),
                    L::NotBetween => (
                        false,
                        vec![
                            (Some("lessThan"), value.clone()),
                            (Some("greaterThan"), value2.clone()),
                        ],
                    ),
                };
                custom_filters(x, and, &items);
            }
            PivotFilter::Value {
                op, value, value2, ..
            } => {
                use model_sheet::pivot::ValueOp as V;
                let (v1, v2) = (fmt_num(*value), fmt_num(*value2));
                let (and, items): (bool, Vec<(Option<&str>, String)>) = match op {
                    V::Equal => (false, vec![(None, v1)]),
                    V::NotEqual => (false, vec![(Some("notEqual"), v1)]),
                    V::Greater => (false, vec![(Some("greaterThan"), v1)]),
                    V::GreaterOrEqual => (false, vec![(Some("greaterThanOrEqual"), v1)]),
                    V::Less => (false, vec![(Some("lessThan"), v1)]),
                    V::LessOrEqual => (false, vec![(Some("lessThanOrEqual"), v1)]),
                    V::Between => (
                        true,
                        vec![
                            (Some("greaterThanOrEqual"), v1),
                            (Some("lessThanOrEqual"), v2),
                        ],
                    ),
                    V::NotBetween => (
                        false,
                        vec![(Some("lessThan"), v1), (Some("greaterThan"), v2)],
                    ),
                };
                custom_filters(x, and, &items);
            }
            PivotFilter::Date {
                op, value, value2, ..
            } => {
                use model_sheet::pivot::DateOp as D;
                let (v1, v2) = (fmt_num(*value), fmt_num(*value2));
                let (and, items): (bool, Vec<(Option<&str>, String)>) = match op {
                    D::Equal => (false, vec![(None, v1)]),
                    D::NotEqual => (false, vec![(Some("notEqual"), v1)]),
                    D::Before => (false, vec![(Some("lessThan"), v1)]),
                    D::After => (false, vec![(Some("greaterThan"), v1)]),
                    D::Between => (
                        true,
                        vec![
                            (Some("greaterThanOrEqual"), v1),
                            (Some("lessThanOrEqual"), v2),
                        ],
                    ),
                    D::NotBetween => (
                        false,
                        vec![(Some("lessThan"), v1), (Some("greaterThan"), v2)],
                    ),
                };
                custom_filters(x, and, &items);
            }
        }
        x.end("filterColumn");
        x.end("autoFilter");
        x.end("filter");
    }
    x.end("filters");
}

fn custom_filters(x: &mut XmlOut, and: bool, items: &[(Option<&str>, String)]) {
    x.start("customFilters", if and { &[("and", "1")] } else { &[] });
    for (op, val) in items {
        let mut a: Vec<(&str, &str)> = Vec::new();
        if let Some(op) = op {
            a.push(("operator", op));
        }
        a.push(("val", val));
        x.empty("customFilter", &a);
    }
    x.end("customFilters");
}

/// `r:id` of the root element set to `rId1` (raw cache definitions point
/// at their records part with it).
fn with_records_rid(xml: &str) -> String {
    let Some(start) = xml.find("<pivotCacheDefinition") else {
        return xml.to_owned();
    };
    let end = xml[start..].find('>').map_or(xml.len(), |e| start + e);
    let head = &xml[start..end];
    let Some(at) = head.find("r:id=\"") else {
        return xml.to_owned();
    };
    let value_start = start + at + 6;
    let Some(len) = xml[value_start..].find('"') else {
        return xml.to_owned();
    };
    format!("{}rId1{}", &xml[..value_start], &xml[value_start + len..])
}

impl PivotParts {
    fn cache_number(&mut self, id: u32) -> usize {
        match self.caches.iter().position(|&c| c == id) {
            Some(i) => i + 1,
            None => {
                self.caches.push(id);
                self.caches.len()
            }
        }
    }

    /// Writes the pivot tables of `sheet`, related from the sheet.
    pub(crate) fn write_tables(
        &mut self,
        pkg: &mut Package,
        sheet_rels: &mut Relationships,
        wb: &Workbook,
        sheet: SheetId,
    ) -> Result<()> {
        for t in wb.pivots(sheet) {
            let Some(cache) = wb.pivot_cache(t.cache_id) else {
                continue;
            };
            self.tables += 1;
            let n = self.tables;
            let xml = match (&t.raw, wb.pivot_output(t.id)) {
                (Some(raw), _) => raw.xml.clone().into_bytes(),
                (None, Some(out)) => table_xml(wb, t, cache, out),
                (None, None) => match t.compute(cache) {
                    Ok(out) => table_xml(wb, t, cache, &out),
                    Err(_) => continue,
                },
            };
            let part = PartName::new(format!("/xl/pivotTables/pivotTable{n}.xml"))?;
            pkg.insert_part(part.clone(), TABLE_CT, xml);
            let c = self.cache_number(t.cache_id);
            let mut rels = Relationships::new();
            rels.add(
                CACHE_DEF_REL,
                format!("../pivotCache/pivotCacheDefinition{c}.xml"),
            );
            pkg.set_relationships(part, rels);
            sheet_rels.add(TABLE_REL, format!("../pivotTables/pivotTable{n}.xml"));
        }
        Ok(())
    }

    /// Writes the caches the tables used, related from the workbook;
    /// returns `(cacheId, r:id)` for `<pivotCaches>`.
    pub(crate) fn write_caches(
        &self,
        pkg: &mut Package,
        book_rels: &mut Relationships,
        wb: &Workbook,
    ) -> Result<Vec<(u32, String)>> {
        let mut out = Vec::new();
        for (i, &id) in self.caches.iter().enumerate() {
            let Some(cache) = wb.pivot_cache(id) else {
                continue;
            };
            let n = i + 1;
            let tables: Vec<&PivotTable> = wb
                .sheets()
                .iter()
                .flat_map(|(s, _)| wb.pivots(*s).iter())
                .filter(|t| t.cache_id == id)
                .collect();
            let def = PartName::new(format!("/xl/pivotCache/pivotCacheDefinition{n}.xml"))?;
            let records = PartName::new(format!("/xl/pivotCache/pivotCacheRecords{n}.xml"))?;
            let (def_xml, rec_xml) = match &cache.raw {
                Some(raw) => (
                    with_records_rid(&raw.xml).into_bytes(),
                    raw.records.clone().map(String::into_bytes),
                ),
                None => (
                    cache_definition_xml(wb, cache, &tables),
                    Some(cache_records_xml(cache, &tables, &slicer_fields(wb, id))),
                ),
            };
            pkg.insert_part(def.clone(), CACHE_DEF_CT, def_xml);
            if let Some(rec) = rec_xml {
                pkg.insert_part(records, CACHE_RECORDS_CT, rec);
                let mut rels = Relationships::new();
                rels.add(CACHE_RECORDS_REL, format!("pivotCacheRecords{n}.xml"));
                pkg.set_relationships(def, rels);
            }
            let rid = book_rels
                .add(
                    CACHE_DEF_REL,
                    format!("pivotCache/pivotCacheDefinition{n}.xml"),
                )
                .id
                .clone();
            out.push((id, rid));
        }
        Ok(out)
    }
}

/// `<pivotCaches>` of `workbook.xml`.
pub(crate) fn pivot_caches_xml(x: &mut XmlOut, caches: &[(u32, String)]) {
    if caches.is_empty() {
        return;
    }
    x.start("pivotCaches", &[]);
    for (id, rid) in caches {
        x.empty("pivotCache", &[("cacheId", &id.to_string()), ("r:id", rid)]);
    }
    x.end("pivotCaches");
}

// --- reading ------------------------------------------------------------------------

fn attr_u32(el: &El, name: &str) -> Option<u32> {
    el.attr(name).and_then(|v| v.trim().parse().ok())
}

fn attr_bool(el: &El, name: &str, default: bool) -> bool {
    el.attr(name)
        .and_then(fmt_ooxml::xml::parse_bool)
        .unwrap_or(default)
}

fn read_item(el: &El) -> Option<Item> {
    let v = el.attr("v");
    Some(match el.name.as_str() {
        "m" => Item::Blank,
        "n" => Item::Number(v?.trim().parse().ok()?),
        "s" => match v {
            Some(t) if !t.is_empty() => Item::Text(crate::xml::decode_x_escapes(t).into_owned()),
            _ => Item::Blank,
        },
        "b" => Item::Bool(v.and_then(fmt_ooxml::xml::parse_bool).unwrap_or(false)),
        "e" => Item::Error(v.unwrap_or("#N/A").to_owned()),
        "d" => Item::Number(serial_of_iso(v?)?),
        _ => return None,
    })
}

/// Why a cache definition cannot be modelled.
fn unsupported_cache(root: &El) -> Option<String> {
    let source = root.child("cacheSource");
    match source.and_then(|s| s.attr("type")) {
        Some("worksheet") | None => {}
        Some(t) => return Some(format!("{t} source")),
    }
    if source.and_then(|s| s.child("worksheetSource")).is_none() {
        return Some("no worksheet source".into());
    }
    if root.child("cacheHierarchies").is_some() {
        return Some("OLAP cache".into());
    }
    None
}

/// Reads a cache definition (and its records).
fn read_cache(
    pkg: &Package,
    part: &PartName,
    id: u32,
    num_fmts: &HashMap<u32, String>,
    consumed: &mut BTreeSet<PartName>,
) -> Result<(PivotCache, Option<String>)> {
    let data = pkg
        .part(part)
        .ok_or_else(|| crate::Error::MissingPart(part.to_string()))?;
    consumed.insert(part.clone());
    let root = parse(&data.data, part.as_str()).map_err(xml_error)?;
    let records_part = pkg.related_part(part, CACHE_RECORDS_REL);
    let records_xml = records_part
        .as_ref()
        .and_then(|p| pkg.part(p))
        .map(|p| p.data.clone());
    if let Some(p) = &records_part {
        consumed.insert(p.clone());
    }
    let source_el = root
        .child("cacheSource")
        .and_then(|s| s.child("worksheetSource"));
    let source = match source_el {
        Some(ws) => match (
            ws.attr("ref").and_then(parse_range),
            ws.attr("sheet"),
            ws.attr("name"),
        ) {
            (Some((r0, c0, r1, c1)), Some(sheet), _) => PivotSource::range(sheet, r0, c0, r1, c1),
            (_, _, Some(name)) => PivotSource::Name {
                name: name.to_owned(),
            },
            _ => PivotSource::Name {
                name: String::new(),
            },
        },
        None => PivotSource::Name {
            name: String::new(),
        },
    };
    let mut cache = PivotCache {
        id,
        source,
        fields: Vec::new(),
        records: Vec::new(),
        refresh_on_load: attr_bool(&root, "refreshOnLoad", false),
        stale: false,
        raw: None,
        calculated_items: Vec::new(),
    };
    if let Some(reason) = unsupported_cache(&root) {
        cache.raw = Some(RawPivotXml {
            reason: reason.clone(),
            xml: String::from_utf8_lossy(&data.data).into_owned(),
            records: records_xml.map(|r| String::from_utf8_lossy(&r).into_owned()),
        });
        return Ok((cache, Some(reason)));
    }
    let mut dates = Vec::new();
    // The fields with a source column, in record order.
    let mut source_fields: Vec<usize> = Vec::new();
    if let Some(fields) = root.child("cacheFields") {
        for f in fields.elements().filter(|e| e.name == "cacheField") {
            let mut cf =
                CacheField::new(&crate::xml::decode_x_escapes(f.attr("name").unwrap_or("")));
            cf.number_format = attr_u32(f, "numFmtId").filter(|&n| n != 0).and_then(|n| {
                num_fmts
                    .get(&n)
                    .cloned()
                    .or_else(|| model_sheet::numfmt::builtin_code(n as u16).map(str::to_owned))
            });
            let index = cache.fields.len() as u32;
            cf.formula = f
                .attr("formula")
                .map(|v| v.trim().trim_start_matches('=').to_owned());
            if cf.formula.is_some() {
                cf.kind = FieldKind::Number;
            }
            if attr_bool(f, "databaseField", true) && cf.formula.is_none() {
                source_fields.push(index as usize);
            }
            let shared = f.child("sharedItems");
            if let Some(s) = shared {
                cf.shared_items = s.elements().filter_map(read_item).collect();
            }
            if let Some(g) = f
                .child("fieldGroup")
                .and_then(|g| read_field_group(g, index))
            {
                let items: Vec<Item> = f
                    .child("fieldGroup")
                    .and_then(|g| g.child("groupItems"))
                    .map(|gi| gi.elements().filter_map(read_item).collect())
                    .unwrap_or_default();
                if g.base != index {
                    // A level / manual group field: no source column.
                    source_fields.retain(|&x| x != index as usize);
                }
                cf.shared_items = items;
                cf.group = Some(g);
            }
            let date = shared.is_some_and(|s| attr_bool(s, "containsDate", false))
                || shared.is_some_and(|s| s.elements().any(|e| e.name == "d"));
            if date && cf.number_format.is_none() {
                cf.number_format = Some("m/d/yyyy".into());
            }
            dates.push(date);
            cache.fields.push(cf);
        }
    }
    // Shared items of grouped source fields are their raw values in the
    // file (when listed): records index them, the model keeps group items.
    let raw_items: Vec<Vec<Item>> = root
        .child("cacheFields")
        .map(|fs| {
            fs.elements()
                .filter(|e| e.name == "cacheField")
                .map(|f| {
                    f.child("sharedItems")
                        .map(|s| s.elements().filter_map(read_item).collect())
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default();
    if let Some(xml) = records_xml {
        let rroot = parse(&xml, "pivotCacheRecords").map_err(xml_error)?;
        let n = cache.fields.len();
        for r in rroot.elements().filter(|e| e.name == "r") {
            let mut rec = vec![Item::Blank; n];
            for (k, v) in r.elements().enumerate() {
                let Some(&i) = source_fields.get(k) else {
                    break;
                };
                let item = if v.name == "x" {
                    let idx = attr_u32(v, "v").unwrap_or(0) as usize;
                    raw_items
                        .get(i)
                        .and_then(|items| items.get(idx))
                        .cloned()
                        .unwrap_or(Item::Blank)
                } else {
                    read_item(v).unwrap_or(Item::Blank)
                };
                rec[i] = item;
            }
            cache.records.push(rec);
        }
    }
    if let Some(ci) = root.child("calculatedItems") {
        for c in ci.elements().filter(|e| e.name == "calculatedItem") {
            let Some(formula) = c.attr("formula") else {
                continue;
            };
            let reference = c
                .child("pivotArea")
                .and_then(|p| p.child("references"))
                .and_then(|r| r.elements().find(|e| e.name == "reference"));
            let (Some(field), Some(item)) = (
                reference.and_then(|r| attr_u32(r, "field")),
                reference
                    .and_then(|r| r.elements().find(|e| e.name == "x"))
                    .map(|x| attr_u32(x, "v").unwrap_or(0)),
            ) else {
                continue;
            };
            let ok = cache
                .fields
                .get(field as usize)
                .is_some_and(|f| (item as usize) < f.shared_items.len());
            if ok {
                cache.calculated_items.push(CalculatedItem {
                    field,
                    item,
                    formula: formula.trim().trim_start_matches('=').to_owned(),
                });
            }
        }
    }
    cache.normalize();
    for (f, date) in cache.fields.iter_mut().zip(dates) {
        if date {
            f.kind = FieldKind::Date;
        }
    }
    Ok((cache, None))
}

/// `<fieldGroup>` of field `index` (`None`: an unknown grouping).
fn read_field_group(g: &El, index: u32) -> Option<FieldGroup> {
    let base = attr_u32(g, "base").unwrap_or(index);
    if let Some(r) = g.child("rangePr") {
        let auto_start = attr_bool(r, "autoStart", true);
        let auto_end = attr_bool(r, "autoEnd", true);
        let num = |k: &str| r.attr(k).and_then(|v| v.trim().parse::<f64>().ok());
        let date = |k: &str| r.attr(k).and_then(serial_of_iso);
        let kind = match r.attr("groupBy").unwrap_or("range") {
            "range" => GroupKind::Number {
                start: num("startNum").unwrap_or(0.0),
                end: num("endNum").unwrap_or(0.0),
                interval: num("groupInterval").unwrap_or(1.0),
                auto_start,
                auto_end,
            },
            by => GroupKind::Date {
                by: DateGroupBy::from_xml_name(by)?,
                start: date("startDate").unwrap_or(0.0),
                end: date("endDate").unwrap_or(0.0),
                interval: num("groupInterval").map_or(1, |v| v.max(1.0) as u32),
                auto_start,
                auto_end,
            },
        };
        return Some(FieldGroup { base, kind });
    }
    let d = g.child("discretePr")?;
    let map = d
        .elements()
        .filter(|e| e.name == "x")
        .map(|x| attr_u32(x, "v").unwrap_or(0))
        .collect();
    Some(FieldGroup {
        base,
        kind: GroupKind::Items { map },
    })
}

fn func_of_subtotal_attr(name: &str) -> Option<AggFunc> {
    Some(match name {
        "sumSubtotal" => AggFunc::Sum,
        "countASubtotal" => AggFunc::Count,
        "avgSubtotal" => AggFunc::Average,
        "maxSubtotal" => AggFunc::Max,
        "minSubtotal" => AggFunc::Min,
        "productSubtotal" => AggFunc::Product,
        "countSubtotal" => AggFunc::CountNums,
        "stdDevSubtotal" => AggFunc::StdDev,
        "stdDevPSubtotal" => AggFunc::StdDevP,
        "varSubtotal" => AggFunc::Var,
        "varPSubtotal" => AggFunc::VarP,
        _ => return None,
    })
}

struct FieldInfo {
    /// Shared item indices in display order.
    order: Vec<u32>,
    hidden: BTreeSet<u32>,
    axis: AxisField,
    multi: bool,
    fill_down: bool,
}

fn ext_child<'a>(el: &'a El, uri: &str, name: &str) -> Option<&'a El> {
    el.child("extLst")?
        .elements()
        .filter(|e| e.name == "ext" && e.attr("uri") == Some(uri))
        .find_map(|e| e.child(name))
}

fn read_field(f: &El, index: u32, cache: &PivotCache) -> FieldInfo {
    let mut order = Vec::new();
    let mut hidden = BTreeSet::new();
    let mut collapsed = BTreeSet::new();
    let n = cache
        .fields
        .get(index as usize)
        .map_or(0, |cf| cf.shared_items.len() as u32);
    if let Some(items) = f.child("items") {
        for it in items.elements().filter(|e| e.name == "item") {
            if it.attr("t").is_some_and(|t| t != "data") {
                continue;
            }
            let Some(x) = attr_u32(it, "x").filter(|&x| x < n) else {
                continue;
            };
            order.push(x);
            if attr_bool(it, "h", false) {
                hidden.insert(x);
            }
            if !attr_bool(it, "sd", true) {
                collapsed.insert(x);
            }
        }
    }
    let layout = match (attr_bool(f, "compact", true), attr_bool(f, "outline", true)) {
        (_, false) => PivotLayout::Tabular,
        (false, true) => PivotLayout::Outline,
        (true, true) => PivotLayout::Compact,
    };
    let custom: Vec<AggFunc> = f
        .attrs
        .iter()
        .filter(|(_, v)| fmt_ooxml::xml::parse_bool(v) == Some(true))
        .filter_map(|(k, _)| func_of_subtotal_attr(k))
        .collect();
    let subtotals = if attr_bool(f, "defaultSubtotal", true) {
        Subtotals::Automatic
    } else if custom.is_empty() {
        Subtotals::None
    } else {
        Subtotals::Custom { functions: custom }
    };
    let probe = PivotTable {
        rows: vec![AxisField::from(index)],
        ..PivotTable::new(0, "x", cache.id, 0, 0)
    };
    // A sort by a data field's values (`autoSortScope` on `-2`).
    let by_value = f
        .child("autoSortScope")
        .and_then(|a| a.child("pivotArea"))
        .and_then(|p| p.child("references"))
        .and_then(|r| {
            r.elements()
                .find(|e| e.name == "reference" && e.attr("field") == Some(DATA_FIELD_REF))
        })
        .map(|r| {
            r.elements()
                .find(|e| e.name == "x")
                .and_then(|x| attr_u32(x, "v"))
                .unwrap_or(0)
        });
    let sort = match (f.attr("sortType"), by_value) {
        (Some(t @ ("ascending" | "descending")), Some(data)) => SortOrder::ByValue {
            data,
            descending: t == "descending",
        },
        _ => match f.attr("sortType") {
            Some("ascending") => SortOrder::Ascending,
            Some("descending") => SortOrder::Descending,
            _ if order.is_empty() || order == probe.item_order(cache, index) => {
                SortOrder::Ascending
            }
            _ => SortOrder::Manual {
                order: order.clone(),
            },
        },
    };
    let fill_down = ext_child(f, X14_PIVOT_FIELD_EXT, "pivotField")
        .is_some_and(|e| attr_bool(e, "fillDownLabels", false));
    FieldInfo {
        axis: AxisField {
            field: index,
            sort,
            subtotals,
            show_all_items: attr_bool(f, "showAll", true),
            collapsed_items: collapsed,
            hidden_items: hidden.clone(),
            layout,
            subtotal_bottom: !attr_bool(f, "subtotalTop", true),
            filter: None,
            insert_blank_row: attr_bool(f, "insertBlankRow", false),
        },
        order,
        hidden,
        multi: attr_bool(f, "multipleItemSelectionAllowed", false),
        fill_down,
    }
}

/// A `<filter>` of a pivot table definition (`None`: a kind we do not
/// model, e.g. OLAP member filters).
fn read_filter(f: &El) -> Option<PivotFilter> {
    let ty = f.attr("type")?;
    let col = f.child("autoFilter").and_then(|a| a.child("filterColumn"));
    let custom: Vec<f64> = col
        .and_then(|c| c.child("customFilters"))
        .map(|cf| {
            cf.elements()
                .filter(|e| e.name == "customFilter")
                .filter_map(|e| e.attr("val")?.trim().parse::<f64>().ok())
                .collect()
        })
        .unwrap_or_default();
    let top = col.and_then(|c| c.child("top10"));
    let n1 = match top {
        Some(t) => t
            .attr("val")
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(10.0),
        None => custom.first().copied().unwrap_or(0.0),
    };
    let n2 = custom.get(1).copied().unwrap_or(0.0);
    let bottom = top.is_some_and(|t| !attr_bool(t, "top", true));
    let ty = match (ty, top) {
        // A Top 10 written as `count` with `percent="1"` means percent.
        ("count", Some(t)) if attr_bool(t, "percent", false) => "percent",
        (ty, _) => ty,
    };
    PivotFilter::from_xml(
        ty,
        f.attr("stringValue1").unwrap_or(""),
        f.attr("stringValue2").unwrap_or(""),
        n1,
        n2,
        attr_u32(f, "iMeasureFld").unwrap_or(0),
        bottom,
    )
}

/// Why a table definition cannot be modelled.
fn unsupported_table(root: &El) -> Option<String> {
    if root.child("pivotHierarchies").is_some() {
        return Some("OLAP".into());
    }
    None
}

fn read_table(
    root: &El,
    xml: &[u8],
    cache: &PivotCache,
    id: u32,
    num_fmts: &HashMap<u32, String>,
) -> (PivotTable, Option<String>) {
    let name = root.attr("name").unwrap_or("PivotTable").to_owned();
    let loc = root.child("location");
    let (r0, c0, r1, c1) = loc
        .and_then(|l| l.attr("ref"))
        .and_then(parse_range)
        .unwrap_or((0, 0, 0, 0));
    let pages = loc.and_then(|l| attr_u32(l, "rowPageCount")).unwrap_or(0);
    let anchor_r = if pages > 0 {
        r0.saturating_sub(pages + 1)
    } else {
        r0
    };
    let mut t = PivotTable::new(id, &name, cache.id, anchor_r, c0);
    t.location = PivotRect::new(anchor_r, c0, r1.max(r0), c1.max(c0));
    let raw = |reason: String, mut t: PivotTable| {
        t.raw = Some(RawPivotXml {
            reason: reason.clone(),
            xml: String::from_utf8_lossy(xml).into_owned(),
            records: None,
        });
        (t, Some(reason))
    };
    if cache.raw.is_some() {
        return raw("its cache is not supported".into(), t);
    }
    if let Some(reason) = unsupported_table(root) {
        return raw(reason, t);
    }
    let fields: Vec<FieldInfo> = root
        .child("pivotFields")
        .map(|pf| {
            pf.elements()
                .filter(|e| e.name == "pivotField")
                .enumerate()
                .map(|(i, f)| read_field(f, i as u32, cache))
                .collect()
        })
        .unwrap_or_default();
    let axis_list = |el: Option<&El>, values: &mut Option<u32>| -> Vec<AxisField> {
        let mut out = Vec::new();
        for (pos, f) in el
            .map(|e| {
                e.elements()
                    .filter(|f| f.name == "field")
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
            .into_iter()
            .enumerate()
        {
            match f.attr("x").and_then(|x| x.trim().parse::<i64>().ok()) {
                Some(-2) => *values = Some(pos as u32),
                Some(x) if x >= 0 => {
                    if let Some(info) = fields.get(x as usize) {
                        out.push(info.axis.clone());
                    }
                }
                _ => {}
            }
        }
        out
    };
    let mut values_rows = None;
    let mut values_cols = None;
    t.rows = axis_list(root.child("rowFields"), &mut values_rows);
    t.cols = axis_list(root.child("colFields"), &mut values_cols);
    if let Some(filters) = root.child("filters") {
        for f in filters.elements().filter(|e| e.name == "filter") {
            let Some(field) = attr_u32(f, "fld") else {
                continue;
            };
            let Some(filter) = read_filter(f) else {
                continue;
            };
            if let Some(a) = t.axis_field_mut(field) {
                a.filter = Some(filter);
            }
        }
    }
    if let Some(pf) = root.child("pageFields") {
        for p in pf.elements().filter(|e| e.name == "pageField") {
            let Some(f) = attr_u32(p, "fld") else {
                continue;
            };
            let info = fields.get(f as usize);
            let selected = match (attr_u32(p, "item"), info) {
                (Some(pos), Some(info)) => match info.order.get(pos as usize) {
                    Some(&i) => PageSelection::Items {
                        items: BTreeSet::from([i]),
                    },
                    None => PageSelection::All,
                },
                (None, Some(info)) if info.multi && !info.hidden.is_empty() => {
                    PageSelection::Items {
                        items: info
                            .order
                            .iter()
                            .copied()
                            .filter(|i| !info.hidden.contains(i))
                            .collect(),
                    }
                }
                _ => PageSelection::All,
            };
            t.filters.push(PageField { field: f, selected });
        }
    }
    // Hidden items of a field on no axis: a slicer's filter.
    for (i, info) in fields.iter().enumerate() {
        let f = i as u32;
        let used = t.rows.iter().chain(&t.cols).any(|a| a.field == f)
            || t.filters.iter().any(|p| p.field == f);
        if !used && !info.hidden.is_empty() {
            t.field_filters.push(PageField {
                field: f,
                selected: PageSelection::Items {
                    items: info
                        .order
                        .iter()
                        .copied()
                        .filter(|x| !info.hidden.contains(x))
                        .collect(),
                },
            });
        }
    }
    if let Some(df) = root.child("dataFields") {
        for d in df.elements().filter(|e| e.name == "dataField") {
            let Some(field) = attr_u32(d, "fld") else {
                continue;
            };
            let distinct = ext_child(d, RS_DATA_FIELD_EXT, "dataField")
                .is_some_and(|e| attr_bool(e, "distinctCount", false));
            let func = if distinct {
                AggFunc::DistinctCount
            } else {
                d.attr("subtotal")
                    .and_then(AggFunc::from_xml_name)
                    .unwrap_or(AggFunc::Sum)
            };
            let base_field = attr_u32(d, "baseField").unwrap_or(0);
            let base_item = attr_u32(d, "baseItem").unwrap_or(0);
            let x14 =
                ext_child(d, X14_DATA_FIELD_EXT, "dataField").and_then(|e| e.attr("pivotShowAs"));
            let base_item_of = |pos: u32| match pos {
                BASE_PREVIOUS => BaseItem::Previous,
                BASE_NEXT => BaseItem::Next,
                pos => fields
                    .get(base_field as usize)
                    .and_then(|f| f.order.get(pos as usize))
                    .map_or(BaseItem::Previous, |&item| BaseItem::Item { item }),
            };
            let show_as = match (x14, d.attr("showDataAs")) {
                (Some("percentOfParentRow"), _) => ShowAs::PercentOfParent,
                (Some("rankDescending"), _) => ShowAs::Rank { base_field },
                (Some("rankAscending"), _) => ShowAs::RankAscending { base_field },
                (Some("percentOfParentCol"), _) => ShowAs::PercentOfParentColumn,
                (Some("percentOfParent"), _) => ShowAs::PercentOfParentTotal { base_field },
                (Some("percentOfRunningTotal"), _) => ShowAs::PercentRunningTotal { base_field },
                (_, Some("percent")) => ShowAs::PercentOf {
                    base_field,
                    base_item: base_item_of(base_item),
                },
                (_, Some("percentDiff")) => ShowAs::PercentDifferenceFrom {
                    base_field,
                    base_item: base_item_of(base_item),
                },
                (_, Some("index")) => ShowAs::Index,
                (_, Some("percentOfTotal")) => ShowAs::PercentOfTotal,
                (_, Some("percentOfRow")) => ShowAs::PercentOfRow,
                (_, Some("percentOfCol")) => ShowAs::PercentOfColumn,
                (_, Some("difference")) => ShowAs::DifferenceFrom {
                    base_field,
                    base_item: match base_item {
                        BASE_PREVIOUS => BaseItem::Previous,
                        BASE_NEXT => BaseItem::Next,
                        pos => fields
                            .get(base_field as usize)
                            .and_then(|f| f.order.get(pos as usize))
                            .map_or(BaseItem::Previous, |&item| BaseItem::Item { item }),
                    },
                },
                (_, Some("runTotal")) => ShowAs::RunningTotal { base_field },
                _ => ShowAs::Normal,
            };
            let mut data = DataField {
                field,
                name: String::new(),
                func,
                show_as,
                number_format: attr_u32(d, "numFmtId").filter(|&n| n != 0).and_then(|n| {
                    num_fmts
                        .get(&n)
                        .cloned()
                        .or_else(|| model_sheet::numfmt::builtin_code(n as u16).map(str::to_owned))
                }),
            };
            let caption = d.attr("name").unwrap_or("").to_owned();
            if caption != data.caption(cache) {
                data.name = caption;
            }
            t.values.push(data);
        }
    }
    let style = root.child("pivotTableStyleInfo");
    let mut o = PivotOptions {
        grand_total_rows: attr_bool(root, "rowGrandTotals", true),
        grand_total_cols: attr_bool(root, "colGrandTotals", true),
        values_in: if attr_bool(root, "dataOnRows", false) {
            ValuesAxis::Rows
        } else {
            ValuesAxis::Columns
        },
        empty_as: root.attr("missingCaption").unwrap_or("").to_owned(),
        error_as: attr_bool(root, "showError", false)
            .then(|| root.attr("errorCaption").unwrap_or("").to_owned()),
        show_field_headers: attr_bool(root, "showHeaders", true),
        compact_rows_indent: attr_u32(root, "indent").map_or(1, |i| i.min(127) as u8),
        repeat_labels: t
            .rows
            .iter()
            .any(|a| fields.get(a.field as usize).is_some_and(|f| f.fill_down)),
        ..PivotOptions::default()
    };
    let position = values_rows.or(values_cols);
    let axis_len = if o.values_in == ValuesAxis::Rows {
        t.rows.len()
    } else {
        t.cols.len()
    } as u32;
    o.values_position = position.filter(|&p| p < axis_len);
    if let Some(s) = style {
        if let Some(n) = s.attr("name") {
            o.style = n.to_owned();
        }
        o.row_headers_bold = attr_bool(s, "showRowHeaders", true);
        o.col_headers_bold = attr_bool(s, "showColHeaders", true);
        o.banded = attr_bool(s, "showRowStripes", false);
        o.banded_cols = attr_bool(s, "showColStripes", false);
    }
    t.options = o;
    if let Err(e) = t.validate(cache) {
        return raw(format!("unreadable definition ({e})"), t);
    }
    (t, None)
}

/// Reads the workbook's pivot caches and the pivot tables of `sheets`
/// into `wb`. Returns warnings.
pub(crate) fn load(
    pkg: &Package,
    main: &PartName,
    wb: &mut Workbook,
    caches: &[(u32, String)],
    sheets: &[(SheetId, String, PartName)],
    num_fmts: &HashMap<u32, String>,
    consumed: &mut BTreeSet<PartName>,
) -> Result<Vec<String>> {
    let mut warnings = Vec::new();
    let rels = pkg.relationships(main);
    let mut models: Vec<PivotCache> = Vec::new();
    let mut by_part: HashMap<PartName, u32> = HashMap::new();
    for (id, rid) in caches {
        let Some(r) = rels
            .and_then(|r| r.get(rid))
            .filter(|r| r.target_mode == TargetMode::Internal)
        else {
            warnings.push(format!("pivot cache {id}: part missing; dropped"));
            continue;
        };
        let part = main.resolve(&r.target)?;
        if pkg.part(&part).is_none() {
            warnings.push(format!("pivot cache {id}: part missing; dropped"));
            continue;
        }
        let (cache, unsupported) = read_cache(pkg, &part, *id, num_fmts, consumed)?;
        if let Some(why) = unsupported {
            warnings.push(format!(
                "pivot cache {id}: {why} not supported; kept read-only"
            ));
        }
        by_part.insert(part, *id);
        models.push(cache);
    }
    wb.set_pivot_caches(models.clone());
    let mut next_id = 1;
    let mut refresh: BTreeSet<u32> = BTreeSet::new();
    for (sheet, name, part) in sheets {
        let Some(srels) = pkg.relationships(part) else {
            continue;
        };
        let mut tables = Vec::new();
        for r in srels.by_type(TABLE_REL) {
            let tpart = part.resolve(&r.target)?;
            let Some(data) = pkg.part(&tpart) else {
                warnings.push(format!("sheet {name:?}: pivot table part missing"));
                continue;
            };
            consumed.insert(tpart.clone());
            let root = parse(&data.data, tpart.as_str()).map_err(xml_error)?;
            let cache_id = attr_u32(&root, "cacheId")
                .or_else(|| {
                    pkg.related_part(&tpart, CACHE_DEF_REL)
                        .and_then(|p| by_part.get(&p).copied())
                })
                .unwrap_or(0);
            let Some(cache) = models.iter().find(|c| c.id == cache_id) else {
                warnings.push(format!(
                    "sheet {name:?}: pivot table without its cache dropped"
                ));
                continue;
            };
            let (t, why) = read_table(&root, &data.data, cache, next_id, num_fmts);
            next_id += 1;
            if let Some(why) = why {
                warnings.push(format!(
                    "sheet {name:?}: pivot table {:?}: {why} not supported; kept read-only",
                    t.name
                ));
            }
            if cache.refresh_on_load && cache.raw.is_none() {
                refresh.insert(cache.id);
            }
            tables.push(t);
        }
        if !tables.is_empty() {
            if let Err(e) = wb.set_pivots(*sheet, tables) {
                warnings.push(format!("sheet {name:?}: pivot tables dropped: {e}"));
            }
        }
    }
    for id in refresh {
        if let Err(e) = wb.refresh_cache(id) {
            warnings.push(format!("pivot cache {id}: refresh on load failed: {e}"));
        }
    }
    Ok(warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_roundtrip() {
        for (serial, iso) in [
            (1.0, "1900-01-01T00:00:00"),
            (59.0, "1900-02-28T00:00:00"),
            (61.0, "1900-03-01T00:00:00"),
            (45306.0, "2024-01-15T00:00:00"),
            (45306.75, "2024-01-15T18:00:00"),
        ] {
            assert_eq!(iso_of_serial(serial), iso);
            assert_eq!(serial_of_iso(iso), Some(serial));
        }
        assert_eq!(serial_of_iso("2024-01-15"), Some(45306.0));
    }

    #[test]
    fn records_rid() {
        let xml = r#"<?xml?><pivotCacheDefinition xmlns:r="x" r:id="rId7" a="1"><x r:id="rId9"/>"#;
        assert_eq!(
            with_records_rid(xml),
            r#"<?xml?><pivotCacheDefinition xmlns:r="x" r:id="rId1" a="1"><x r:id="rId9"/>"#
        );
    }
}
