//! Slicers (P9-C2), written from the MS-XLSX documentation (Excel 2010
//! `x14` pivot slicers, Excel 2013 `x15` table slicers):
//!
//! * `xl/slicerCaches/slicerCacheN.xml` (`slicerCacheDefinition`, related
//!   from the workbook with the 2007 `slicerCache` relationship, listed in
//!   the workbook `extLst`: `x14:slicerCaches` for pivot caches,
//!   `x15:slicerCaches` for table caches) plus a defined name per cache
//!   (`Slicer_Region` = `#N/A`);
//! * `xl/slicers/slicerN.xml` (`slicers`, related from the sheet with the
//!   `slicer` relationship, listed in the sheet `extLst`: `x14:slicerList`
//!   / `x15:slicerList`); one part for the sheet's pivot slicers, one for
//!   its table slicers;
//! * the position in the sheet's drawing: an anchor holding
//!   `mc:AlternateContent` with a `graphicFrame` whose `sle:slicer` names
//!   the slicer (`Requires="a14"` / `"sle15"`) and a plain shape as the
//!   fallback for readers without slicers.
//!
//! The reader accepts exactly this structure (the parts reached through
//! these relationships, the anchors by slicer name) and drops what it
//! cannot resolve with a warning.

use std::collections::{BTreeSet, HashMap};

use fmt_ooxml::xml::{parse, El};
use fmt_ooxml::{Package, PartName, Relationships, TargetMode};
use model_sheet::{ChartAnchor, SheetId, Slicer, SlicerCache, SlicerSort, SlicerSource, Workbook};

use crate::styles::MAIN_NS;
use crate::xml::XmlOut;
use crate::Result;

/// Relationship workbook → slicer cache.
pub(crate) const SLICER_CACHE_REL: &str =
    "http://schemas.microsoft.com/office/2007/relationships/slicerCache";
/// Relationship sheet → slicers part.
pub(crate) const SLICER_REL: &str = "http://schemas.microsoft.com/office/2007/relationships/slicer";
pub(crate) const SLICER_CACHE_CT: &str = "application/vnd.ms-excel.slicerCache+xml";
pub(crate) const SLICER_CT: &str = "application/vnd.ms-excel.slicer+xml";

pub(crate) const X14_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
pub(crate) const X15_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const MC_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/// `graphicData/@uri` and the `sle` namespace of the drawing frame.
pub(crate) const SLE_NS: &str = "http://schemas.microsoft.com/office/drawing/2010/slicer";
const SLE15_NS: &str = "http://schemas.microsoft.com/office/drawing/2012/slicer";
const A14_NS: &str = "http://schemas.microsoft.com/office/drawing/2010/main";

/// Workbook `extLst` entries.
const EXT_PIVOT_CACHES: &str = "{BBE1A952-AA13-448e-AADC-164F8A28A991}";
const EXT_TABLE_CACHES: &str = "{46BE6895-7355-4a93-B00E-2C351335B9C9}";
/// Sheet `extLst` entries.
const EXT_PIVOT_SLICERS: &str = "{A8765BA9-456A-4dab-B4F3-ACF838C121DE}";
const EXT_TABLE_SLICERS: &str = "{3A4CF648-6AED-40f4-86FF-DC5316D8AED3}";
/// The slicer cache's `x15:tableSlicerCache` extension.
const EXT_TABLE_SLICER_CACHE: &str = "{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}";

fn is_table(c: &SlicerCache) -> bool {
    matches!(c.source, SlicerSource::Table { .. })
}

/// The relationship ids of a sheet's slicer parts.
#[derive(Debug, Default)]
pub(crate) struct SheetSlicers {
    pub pivot: Option<String>,
    pub table: Option<String>,
}

/// The relationship ids of the workbook's slicer caches.
#[derive(Debug, Default)]
pub(crate) struct BookSlicers {
    pub pivot: Vec<String>,
    pub table: Vec<String>,
    /// The cache names (written as `#N/A` defined names).
    pub names: Vec<String>,
}

/// Numbering of the written slicer parts.
#[derive(Debug, Default)]
pub(crate) struct SlicerParts {
    slicers: usize,
}

impl SlicerParts {
    /// Writes the slicers of `sheet` (one part for pivot slicers, one
    /// for table slicers) related from the sheet.
    pub(crate) fn write_sheet(
        &mut self,
        pkg: &mut Package,
        sheet_rels: &mut Relationships,
        wb: &Workbook,
        sheet: SheetId,
    ) -> Result<SheetSlicers> {
        let mut out = SheetSlicers::default();
        for table in [false, true] {
            let list: Vec<&Slicer> = wb
                .slicers(sheet)
                .iter()
                .filter(|s| {
                    wb.slicer_cache(&s.cache)
                        .is_some_and(|c| is_table(c) == table)
                })
                .collect();
            if list.is_empty() {
                continue;
            }
            self.slicers += 1;
            let n = self.slicers;
            let part = PartName::new(format!("/xl/slicers/slicer{n}.xml"))?;
            pkg.insert_part(part, SLICER_CT, slicers_xml(&list));
            let rid = sheet_rels
                .add(SLICER_REL, format!("../slicers/slicer{n}.xml"))
                .id
                .clone();
            if table {
                out.table = Some(rid);
            } else {
                out.pivot = Some(rid);
            }
        }
        Ok(out)
    }

    /// Writes the slicer caches, related from the workbook. `sheets`: the
    /// written sheets in order (`tabId` = position + 1).
    pub(crate) fn write_caches(
        &self,
        pkg: &mut Package,
        book_rels: &mut Relationships,
        wb: &Workbook,
        sheets: &[(SheetId, String)],
    ) -> Result<BookSlicers> {
        let mut out = BookSlicers::default();
        for (i, c) in wb.slicer_caches().iter().enumerate() {
            let n = i + 1;
            let part = PartName::new(format!("/xl/slicerCaches/slicerCache{n}.xml"))?;
            pkg.insert_part(part, SLICER_CACHE_CT, cache_xml(wb, c, sheets));
            let rid = book_rels
                .add(SLICER_CACHE_REL, format!("slicerCaches/slicerCache{n}.xml"))
                .id
                .clone();
            if is_table(c) {
                out.table.push(rid);
            } else {
                out.pivot.push(rid);
            }
            out.names.push(c.name.clone());
        }
        Ok(out)
    }
}

fn root_attrs() -> [(&'static str, &'static str); 4] {
    [
        ("xmlns", X14_NS),
        ("xmlns:mc", MC_NS),
        ("mc:Ignorable", "x"),
        ("xmlns:x", MAIN_NS),
    ]
}

fn slicers_xml(list: &[&Slicer]) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("slicers", &root_attrs());
    for s in list {
        let cols = s.columns.to_string();
        let height = s.row_height.to_string();
        let mut a: Vec<(&str, &str)> = vec![
            ("name", &s.name),
            ("cache", &s.cache),
            ("caption", &s.caption),
        ];
        if s.columns != 1 {
            a.push(("columnCount", &cols));
        }
        if !s.show_caption {
            a.push(("showCaption", "0"));
        }
        if s.style != model_sheet::DEFAULT_SLICER_STYLE {
            a.push(("style", &s.style));
        }
        a.push(("rowHeight", &height));
        x.empty("slicer", &a);
    }
    x.end("slicers");
    x.finish()
}

fn cache_xml(wb: &Workbook, c: &SlicerCache, sheets: &[(SheetId, String)]) -> Vec<u8> {
    let mut x = XmlOut::new();
    let mut a: Vec<(&str, &str)> = root_attrs().to_vec();
    a.push(("name", &c.name));
    a.push(("sourceName", &c.source_name));
    x.start("slicerCacheDefinition", &a);
    let descending = c.sort == SlicerSort::Descending;
    match &c.source {
        SlicerSource::Pivot { cache, pivots, .. } => {
            let tables: Vec<(String, String)> = pivots
                .iter()
                .filter_map(|id| {
                    let (s, t) = wb.pivot(*id)?;
                    let tab = sheets.iter().position(|(x, _)| *x == s)? + 1;
                    Some((tab.to_string(), t.name.clone()))
                })
                .collect();
            if !tables.is_empty() {
                x.start("pivotTables", &[]);
                for (tab, name) in &tables {
                    x.empty("pivotTable", &[("tabId", tab), ("name", name)]);
                }
                x.end("pivotTables");
            }
            x.start("data", &[]);
            let id = cache.to_string();
            let mut ta = vec![("pivotCacheId", id.as_str())];
            if descending {
                ta.push(("sortOrder", "descending"));
            }
            x.start("tabular", &ta);
            let items = pivot_item_order(wb, c);
            x.start("items", &[("count", &items.len().to_string())]);
            for i in items {
                let xi = i.to_string();
                if c.hidden.contains(&i) {
                    x.empty("i", &[("x", &xi)]);
                } else {
                    x.empty("i", &[("x", &xi), ("s", "1")]);
                }
            }
            x.end("items");
            x.end("tabular");
            x.end("data");
        }
        SlicerSource::Table { table, column } => {
            x.start("extLst", &[]);
            x.start(
                "x:ext",
                &[("uri", EXT_TABLE_SLICER_CACHE), ("xmlns:x15", X15_NS)],
            );
            let (t, col) = (table.to_string(), column.to_string());
            let mut ta = vec![("tableId", t.as_str()), ("column", col.as_str())];
            if descending {
                ta.push(("sortOrder", "descending"));
            }
            x.empty("x15:tableSlicerCache", &ta);
            x.end("x:ext");
            x.end("extLst");
        }
    }
    x.end("slicerCacheDefinition");
    x.finish()
}

/// The shared items of a pivot slicer in display order.
fn pivot_item_order(wb: &Workbook, c: &SlicerCache) -> Vec<u32> {
    let SlicerSource::Pivot { cache, field, .. } = &c.source else {
        return Vec::new();
    };
    let Some(pc) = wb.pivot_cache(*cache) else {
        return Vec::new();
    };
    let probe = model_sheet::PivotTable {
        rows: vec![model_sheet::pivot::AxisField::from(*field)],
        ..model_sheet::PivotTable::new(0, "x", *cache, 0, 0)
    };
    probe.item_order(pc, *field)
}

/// The workbook `extLst` with the slicer cache lists (nothing without
/// caches).
pub(crate) fn workbook_ext_xml(x: &mut XmlOut, ids: &BookSlicers) {
    if ids.pivot.is_empty() && ids.table.is_empty() {
        return;
    }
    x.start("extLst", &[]);
    if !ids.pivot.is_empty() {
        x.start("ext", &[("uri", EXT_PIVOT_CACHES), ("xmlns:x14", X14_NS)]);
        x.start("x14:slicerCaches", &[]);
        for rid in &ids.pivot {
            x.empty("x14:slicerCache", &[("r:id", rid)]);
        }
        x.end("x14:slicerCaches");
        x.end("ext");
    }
    if !ids.table.is_empty() {
        x.start("ext", &[("uri", EXT_TABLE_CACHES), ("xmlns:x15", X15_NS)]);
        x.start("x15:slicerCaches", &[("xmlns:x14", X14_NS)]);
        for rid in &ids.table {
            x.empty("x14:slicerCache", &[("r:id", rid)]);
        }
        x.end("x15:slicerCaches");
        x.end("ext");
    }
    x.end("extLst");
}

/// The sheet `extLst` with the slicer lists (nothing without slicers).
pub(crate) fn sheet_ext_xml(x: &mut XmlOut, ids: &SheetSlicers) {
    if ids.pivot.is_none() && ids.table.is_none() {
        return;
    }
    x.start("extLst", &[]);
    if let Some(rid) = &ids.pivot {
        x.start("ext", &[("uri", EXT_PIVOT_SLICERS), ("xmlns:x14", X14_NS)]);
        x.start("x14:slicerList", &[]);
        x.empty("x14:slicer", &[("r:id", rid)]);
        x.end("x14:slicerList");
        x.end("ext");
    }
    if let Some(rid) = &ids.table {
        x.start("ext", &[("uri", EXT_TABLE_SLICERS), ("xmlns:x14", X14_NS)]);
        x.start("x15:slicerList", &[("xmlns:x15", X15_NS)]);
        x.empty("x14:slicer", &[("r:id", rid)]);
        x.end("x15:slicerList");
        x.end("ext");
    }
    x.end("extLst");
}

/// The drawing frame of slicer `s` inside an open anchor: the
/// `mc:AlternateContent` with the slicer frame and the fallback shape.
pub(crate) fn drawing_frame_xml(x: &mut XmlOut, s: &Slicer, table: bool, id: usize) {
    x.start("mc:AlternateContent", &[("xmlns:mc", MC_NS)]);
    if table {
        x.start(
            "mc:Choice",
            &[("xmlns:sle15", SLE15_NS), ("Requires", "sle15")],
        );
    } else {
        x.start("mc:Choice", &[("xmlns:a14", A14_NS), ("Requires", "a14")]);
    }
    x.start("xdr:graphicFrame", &[("macro", "")]);
    x.start("xdr:nvGraphicFramePr", &[]);
    x.empty("xdr:cNvPr", &[("id", &id.to_string()), ("name", &s.name)]);
    x.empty("xdr:cNvGraphicFramePr", &[]);
    x.end("xdr:nvGraphicFramePr");
    x.start("xdr:xfrm", &[]);
    x.empty("a:off", &[("x", "0"), ("y", "0")]);
    x.empty("a:ext", &[("cx", "0"), ("cy", "0")]);
    x.end("xdr:xfrm");
    x.start("a:graphic", &[]);
    x.start("a:graphicData", &[("uri", SLE_NS)]);
    x.empty("sle:slicer", &[("xmlns:sle", SLE_NS), ("name", &s.name)]);
    x.end("a:graphicData");
    x.end("a:graphic");
    x.end("xdr:graphicFrame");
    x.end("mc:Choice");
    x.start("mc:Fallback", &[]);
    x.start("xdr:sp", &[("macro", ""), ("textlink", "")]);
    x.start("xdr:nvSpPr", &[]);
    x.empty("xdr:cNvPr", &[("id", "0"), ("name", "")]);
    x.start("xdr:cNvSpPr", &[]);
    x.empty("a:spLocks", &[("noTextEdit", "1")]);
    x.end("xdr:cNvSpPr");
    x.end("xdr:nvSpPr");
    x.start("xdr:spPr", &[]);
    x.start("a:xfrm", &[]);
    x.empty("a:off", &[("x", "0"), ("y", "0")]);
    x.empty("a:ext", &[("cx", "1828800"), ("cy", "2524125")]);
    x.end("a:xfrm");
    x.start("a:prstGeom", &[("prst", "rect")]);
    x.empty("a:avLst", &[]);
    x.end("a:prstGeom");
    x.start("a:solidFill", &[]);
    x.empty("a:prstClr", &[("val", "white")]);
    x.end("a:solidFill");
    x.start("a:ln", &[("w", "1")]);
    x.start("a:solidFill", &[]);
    x.empty("a:prstClr", &[("val", "green")]);
    x.end("a:solidFill");
    x.end("a:ln");
    x.end("xdr:spPr");
    x.start("xdr:txBody", &[]);
    x.empty(
        "a:bodyPr",
        &[("vertOverflow", "clip"), ("horzOverflow", "clip")],
    );
    x.empty("a:lstStyle", &[]);
    x.start("a:p", &[]);
    x.start("a:r", &[]);
    x.empty("a:rPr", &[("lang", "en-US"), ("sz", "1100")]);
    x.text_el(
        "a:t",
        &[],
        if table {
            "This shape represents a table slicer. Table slicers are supported in Excel or later."
        } else {
            "This shape represents a slicer. Slicers are supported in Excel 2010 or later."
        },
    );
    x.end("a:r");
    x.end("a:p");
    x.end("xdr:txBody");
    x.end("xdr:sp");
    x.end("mc:Fallback");
    x.end("mc:AlternateContent");
}

// --- reading -------------------------------------------------------------------

/// The slicer anchor of an `mc:AlternateContent` drawing object: the
/// slicer's name (`sle:slicer/@name`), `None` for other content.
pub(crate) fn drawing_slicer_name(alt: &El) -> Option<String> {
    let choice = alt.elements().find(|e| e.name == "Choice")?;
    let frame = choice.child("graphicFrame")?;
    let data = frame.find("graphicData")?;
    if data.attr("uri") != Some(SLE_NS) {
        return None;
    }
    data.child("slicer")?.attr("name").map(str::to_owned)
}

/// The names of the slicer caches `rids` (relationships of the workbook
/// part `main`): their `#N/A` defined names are not user names.
pub(crate) fn cache_names(pkg: &Package, main: &PartName, rids: &[String]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for rid in rids {
        let Some(part) = resolve(pkg, main, rid, SLICER_CACHE_REL) else {
            continue;
        };
        if let Some(name) = pkg
            .part(&part)
            .and_then(|p| parse(&p.data, part.as_str()).ok())
            .and_then(|root| root.attr("name").map(|n| n.to_ascii_lowercase()))
        {
            out.insert(name);
        }
    }
    out
}

fn resolve(pkg: &Package, from: &PartName, rid: &str, kind: &str) -> Option<PartName> {
    let rel = pkg.relationships(from)?.get(rid)?;
    if rel.target_mode != TargetMode::Internal || rel.rel_type != kind {
        return None;
    }
    from.resolve(&rel.target).ok()
}

fn sort_of(el: &El) -> SlicerSort {
    match el.attr("sortOrder") {
        Some("descending") => SlicerSort::Descending,
        _ => SlicerSort::Ascending,
    }
}

/// Reads the slicer caches (`rids` of the workbook), the sheets' slicer
/// parts and their drawing anchors (`anchors`: per sheet, slicer name →
/// anchor). Call after tables and pivot tables are loaded. Returns
/// warnings.
#[allow(clippy::too_many_arguments)]
pub(crate) fn load(
    pkg: &Package,
    main: &PartName,
    wb: &mut Workbook,
    rids: &[String],
    sheets: &[(SheetId, String, PartName)],
    anchors: &HashMap<SheetId, Vec<(String, ChartAnchor)>>,
    consumed: &mut BTreeSet<PartName>,
) -> Vec<String> {
    let mut warnings = Vec::new();
    // (part number, cache): read in part order (the extLst lists pivot
    // caches before table caches).
    let mut numbered: Vec<(u64, SlicerCache)> = Vec::new();
    // The pivot table names in the file: (tabId, name) → id.
    let pivot_by_name = |tab: u32, name: &str| -> Option<u32> {
        let (s, _, _) = sheets.get(tab.checked_sub(1)? as usize)?;
        wb.pivots(*s)
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
            .map(|p| p.id)
    };
    for rid in rids {
        let Some(part) = resolve(pkg, main, rid, SLICER_CACHE_REL) else {
            warnings.push(format!("slicer cache {rid} is missing"));
            continue;
        };
        let Some(root) = pkg
            .part(&part)
            .and_then(|p| parse(&p.data, part.as_str()).ok())
        else {
            warnings.push(format!("{part}: unreadable slicer cache dropped"));
            continue;
        };
        consumed.insert(part.clone());
        let (Some(name), Some(source_name)) = (root.attr("name"), root.attr("sourceName")) else {
            warnings.push(format!("{part}: slicer cache without a name dropped"));
            continue;
        };
        let mut cache = SlicerCache {
            name: name.to_owned(),
            source_name: source_name.to_owned(),
            source: SlicerSource::Table {
                table: 0,
                column: 0,
            },
            hidden: BTreeSet::new(),
            sort: SlicerSort::Ascending,
        };
        let table = root.find("tableSlicerCache");
        let tabular = root.child("data").and_then(|d| d.child("tabular"));
        if let Some(t) = table {
            let num = |a| t.attr(a).and_then(|v| v.trim().parse::<u32>().ok());
            let (Some(table), Some(column)) = (num("tableId"), num("column")) else {
                warnings.push(format!(
                    "{part}: table slicer cache without a table dropped"
                ));
                continue;
            };
            cache.source = SlicerSource::Table { table, column };
            cache.sort = sort_of(t);
        } else if let Some(tab) = tabular {
            let Some(pc) = tab
                .attr("pivotCacheId")
                .and_then(|v| v.trim().parse::<u32>().ok())
            else {
                warnings.push(format!(
                    "{part}: slicer cache without a pivot cache dropped"
                ));
                continue;
            };
            let pivots: Vec<u32> = root
                .child("pivotTables")
                .into_iter()
                .flat_map(|p| p.elements())
                .filter(|e| e.name == "pivotTable")
                .filter_map(|e| {
                    let tab = e.attr("tabId")?.trim().parse::<u32>().ok()?;
                    pivot_by_name(tab, e.attr("name")?)
                })
                .collect();
            // The cache of the connected tables (the file's pivotCacheId
            // is Excel's x14 id, which this writer keeps equal to cacheId).
            let cache_id = pivots
                .first()
                .and_then(|p| wb.pivot(*p))
                .map(|(_, t)| t.cache_id)
                .unwrap_or(pc);
            let Some(field) = wb.pivot_cache(cache_id).and_then(|c| {
                c.fields
                    .iter()
                    .position(|f| f.name.eq_ignore_ascii_case(source_name))
            }) else {
                warnings.push(format!(
                    "{part}: slicer field {source_name:?} not found; dropped"
                ));
                continue;
            };
            cache.hidden = tab
                .child("items")
                .into_iter()
                .flat_map(|i| i.elements())
                .filter(|i| i.name == "i")
                .filter(|i| i.attr("s").and_then(fmt_ooxml::xml::parse_bool) != Some(true))
                .filter_map(|i| i.attr("x")?.trim().parse::<u32>().ok())
                .collect();
            cache.sort = sort_of(tab);
            cache.source = SlicerSource::Pivot {
                cache: cache_id,
                field: field as u32,
                pivots,
            };
        } else {
            warnings.push(format!("{part}: unsupported slicer cache (OLAP?) dropped"));
            continue;
        }
        let number = part
            .as_str()
            .trim_end_matches(".xml")
            .rsplit(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|d| d.parse().ok())
            .unwrap_or(u64::MAX);
        numbered.push((number, cache));
    }
    numbered.sort_by_key(|(n, _)| *n);
    let caches: Vec<SlicerCache> = numbered.into_iter().map(|(_, c)| c).collect();
    let mut per_sheet: Vec<(SheetId, Vec<Slicer>)> = Vec::new();
    let mut next_id = 1;
    for (sheet, name, part) in sheets {
        let Some(rels) = pkg.relationships(part) else {
            continue;
        };
        let mut list = Vec::new();
        for rel in rels.iter().filter(|r| r.rel_type == SLICER_REL) {
            let Ok(target) = part.resolve(&rel.target) else {
                continue;
            };
            let Some(root) = pkg
                .part(&target)
                .and_then(|p| parse(&p.data, target.as_str()).ok())
            else {
                warnings.push(format!("sheet {name:?}: slicer part {target} is missing"));
                continue;
            };
            consumed.insert(target.clone());
            for el in root.elements().filter(|e| e.name == "slicer") {
                let (Some(sname), Some(cache)) = (el.attr("name"), el.attr("cache")) else {
                    continue;
                };
                let Some(anchor) = anchors
                    .get(sheet)
                    .and_then(|a| a.iter().find(|(n, _)| n == sname))
                    .map(|(_, a)| *a)
                else {
                    warnings.push(format!(
                        "sheet {name:?}: slicer {sname:?} has no position; dropped"
                    ));
                    continue;
                };
                let num = |a: &str| el.attr(a).and_then(|v| v.trim().parse::<i64>().ok());
                let style = el
                    .attr("style")
                    .filter(|s| model_sheet::slicer::is_builtin_slicer_style(s))
                    .unwrap_or(model_sheet::DEFAULT_SLICER_STYLE);
                list.push(Slicer {
                    id: 0,
                    name: sname.to_owned(),
                    cache: cache.to_owned(),
                    caption: el.attr("caption").unwrap_or(sname).to_owned(),
                    show_caption: el
                        .attr("showCaption")
                        .and_then(fmt_ooxml::xml::parse_bool)
                        .unwrap_or(true),
                    columns: num("columnCount").map_or(1, |c| c.clamp(1, 20_000) as u32),
                    row_height: num("rowHeight")
                        .filter(|h| *h > 0)
                        .unwrap_or(model_sheet::slicer::DEFAULT_ROW_HEIGHT),
                    style: style.to_owned(),
                    anchor,
                });
            }
        }
        // Back to front as in the drawing.
        let order = |s: &Slicer| {
            anchors
                .get(sheet)
                .and_then(|a| a.iter().position(|(n, _)| *n == s.name))
                .unwrap_or(usize::MAX)
        };
        list.sort_by_key(order);
        for s in &mut list {
            s.id = next_id;
            next_id += 1;
        }
        if !list.is_empty() {
            per_sheet.push((*sheet, list));
        }
    }
    if caches.is_empty() && per_sheet.is_empty() {
        return warnings;
    }
    // Slicers naming a missing cache go; so do caches whose source is gone.
    let n = caches.len();
    for (_, list) in &mut per_sheet {
        list.retain(|s| caches.iter().any(|c| c.name.eq_ignore_ascii_case(&s.cache)));
    }
    if let Err(e) = wb.set_slicer_state((caches.clone(), per_sheet.clone())) {
        // One bad cache must not take the others: keep the valid ones.
        let mut kept = Vec::new();
        for c in caches {
            let mut trial = kept.clone();
            trial.push(c.clone());
            if wb.set_slicer_state((trial.clone(), Vec::new())).is_ok() {
                kept = trial;
            }
        }
        for (_, list) in &mut per_sheet {
            list.retain(|s| kept.iter().any(|c| c.name.eq_ignore_ascii_case(&s.cache)));
        }
        warnings.push(format!(
            "{} of {n} slicer cache(s) dropped ({e})",
            n - kept.len()
        ));
        if let Err(e) = wb.set_slicer_state((kept, per_sheet)) {
            warnings.push(format!("slicers dropped: {e}"));
            let _ = wb.set_slicer_state((Vec::new(), Vec::new()));
        }
    }
    warnings
}
