//! Excel tables: `xl/tables/tableN.xml`, related from the sheet and
//! listed in its `<tableParts>`, and structured references in formulas
//! (file form `Table1[[#This Row],[Qty]]`, always qualified; display form
//! `[@Qty]` in the model).

use std::collections::BTreeSet;

use engine_formula::ast::Expr;
use engine_formula::{CellCoord, SheetId};
use fmt_ooxml::{Package, PartName, Relationships, TargetMode};
use model_sheet::{Table, TableColumn, TableLook, TotalsCell, TotalsFunction, Workbook};
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::a1::{parse_range, range_name};
use crate::read::FilterReader;
use crate::styles::MAIN_NS;
use crate::xlfn::{add_xlfn_prefixes, strip_xlfn_prefixes};
use crate::xml::{
    attr, attr_bool, attr_parse, decode_x_escapes, encode_x_escapes, name_of, push_ref, push_text,
    xml_err, XmlOut,
};
use crate::Result;

/// Relationship type sheet → table part.
pub(crate) const TABLE_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";
/// Content type of a table part.
pub(crate) const TABLE_CT: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

/// Rebuilds `e` with `f` applied to every structured reference.
pub(crate) fn map_structured(
    e: &Expr,
    f: &dyn Fn(&engine_formula::StructRef) -> engine_formula::StructRef,
) -> Expr {
    match e {
        Expr::Structured(s) => Expr::Structured(f(s)),
        Expr::Call { name, args } => Expr::Call {
            name: name.clone(),
            args: args.iter().map(|a| map_structured(a, f)).collect(),
        },
        Expr::Unary { op, expr } => Expr::Unary {
            op: *op,
            expr: Box::new(map_structured(expr, f)),
        },
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: *op,
            lhs: Box::new(map_structured(lhs, f)),
            rhs: Box::new(map_structured(rhs, f)),
        },
        Expr::Array(rows) => Expr::Array(
            rows.iter()
                .map(|r| r.iter().map(|x| map_structured(x, f)).collect())
                .collect(),
        ),
        other => other.clone(),
    }
}

pub(crate) fn has_structured(e: &Expr) -> bool {
    match e {
        Expr::Structured(_) => true,
        Expr::Call { args, .. } => args.iter().any(has_structured),
        Expr::Unary { expr, .. } => has_structured(expr),
        Expr::Binary { lhs, rhs, .. } => has_structured(lhs) || has_structured(rhs),
        Expr::Array(rows) => rows.iter().flatten().any(has_structured),
        _ => false,
    }
}

/// The file form of a cell formula's AST: structured references
/// qualified with `table` (the table holding the cell) and `#This Row`
/// spelled out.
pub(crate) fn to_file_refs(e: &Expr, table: Option<&str>) -> Expr {
    map_structured(e, &|s| s.file_form(table))
}

/// The display form of a formula read from a file: `@` for this row and,
/// inside table `own`, references to it without the table name (as Excel
/// shows them).
pub(crate) fn to_display_refs(e: &Expr, own: Option<&str>) -> Expr {
    map_structured(e, &|s| {
        let mut d = s.display_form();
        if d.table
            .as_deref()
            .zip(own)
            .is_some_and(|(t, o)| t.eq_ignore_ascii_case(o))
        {
            d.table = None;
        }
        d
    })
}

/// A table formula (calculated column, custom total) of table `own` from
/// the file: the display form without `=`; `None` when it does not parse.
fn formula_from_file(text: &str, own: &str) -> Option<String> {
    let body = strip_xlfn_prefixes(text.trim());
    let ast = engine_formula::parse(&format!("={body}")).ok()?;
    Some(to_display_refs(&ast, Some(own)).to_string())
}

/// A table formula in the file form (without `=`).
fn formula_to_file(text: &str, table: &str) -> String {
    match engine_formula::parse(&format!("={}", text.trim_start_matches('='))) {
        Ok(ast) => add_xlfn_prefixes(&to_file_refs(&ast, Some(table)).to_string()),
        Err(_) => text.to_string(),
    }
}

/// Reads one table part.
fn parse_table(xml: &[u8], part: &str, warnings: &mut Vec<String>) -> Result<Option<Table>> {
    let mut reader = Reader::from_reader(xml);
    let mut table: Option<Table> = None;
    let mut filter = FilterReader::default();
    let mut in_filter = false;
    let mut capture: Option<&'static str> = None;
    let mut text = String::new();
    loop {
        let ev = reader.read_event().map_err(xml_err(part))?;
        match ev {
            Event::Start(ref el) | Event::Empty(ref el) => {
                let empty = matches!(ev, Event::Empty(_));
                match name_of(el) {
                    b"table" => {
                        let Some((r0, c0, r1, c1)) = attr(el, "ref").and_then(|r| parse_range(&r))
                        else {
                            warnings.push(format!("{part}: table without a range dropped"));
                            return Ok(None);
                        };
                        let name = attr(el, "displayName")
                            .or_else(|| attr(el, "name"))
                            .map(|n| n.into_owned())
                            .unwrap_or_default();
                        let header = attr_parse::<u32>(el, "headerRowCount").unwrap_or(1) > 0;
                        let totals = attr_parse::<u32>(el, "totalsRowCount").unwrap_or(0) > 0;
                        table = Some(Table {
                            id: attr_parse(el, "id").unwrap_or(0),
                            name,
                            r0: r0.min(r1),
                            c0: c0.min(c1),
                            r1: r0.max(r1),
                            c1: c0.max(c1),
                            header_row: header,
                            totals_row: totals,
                            columns: Vec::new(),
                            style: String::new(),
                            look: TableLook {
                                first_column: false,
                                last_column: false,
                                banded_rows: false,
                                banded_columns: false,
                            },
                            auto_filter: None,
                        });
                    }
                    b"autoFilter" => {
                        in_filter = !empty;
                        filter.start(b"autoFilter", el, empty);
                    }
                    name if in_filter => {
                        filter.start(name, el, empty);
                    }
                    b"tableColumn" => {
                        if let Some(t) = table.as_mut() {
                            let name = attr(el, "name")
                                .map(|n| decode_x_escapes(&n).into_owned())
                                .unwrap_or_default();
                            let mut col = TableColumn::new(
                                attr_parse(el, "id").unwrap_or(t.columns.len() as u32 + 1),
                                &name,
                            );
                            if let Some(label) = attr(el, "totalsRowLabel") {
                                col.totals = Some(TotalsCell::Label {
                                    text: decode_x_escapes(&label).into_owned(),
                                });
                            }
                            if let Some(f) = attr(el, "totalsRowFunction") {
                                if let Some(function) = TotalsFunction::from_file_name(&f) {
                                    col.totals = Some(TotalsCell::Function { function });
                                } else if f == "custom" {
                                    col.totals = Some(TotalsCell::Custom {
                                        formula: String::new(),
                                    });
                                }
                            }
                            t.columns.push(col);
                        }
                    }
                    b"calculatedColumnFormula" if !empty => {
                        capture = Some("calc");
                        text.clear();
                    }
                    b"totalsRowFormula" if !empty => {
                        capture = Some("total");
                        text.clear();
                    }
                    b"tableStyleInfo" => {
                        if let Some(t) = table.as_mut() {
                            t.style = attr(el, "name").map(|n| n.into_owned()).unwrap_or_default();
                            let flag = |n| attr_bool(el, n).unwrap_or(false);
                            t.look = TableLook {
                                first_column: flag("showFirstColumn"),
                                last_column: flag("showLastColumn"),
                                banded_rows: flag("showRowStripes"),
                                banded_columns: flag("showColumnStripes"),
                            };
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(ref t) if capture.is_some() => push_text(&mut text, t),
            Event::GeneralRef(ref r) if capture.is_some() => push_ref(&mut text, r),
            Event::End(ref el) => {
                let name = crate::xml::end_name(el);
                match name {
                    b"autoFilter" => in_filter = false,
                    b"filterColumn" | b"sortState" if in_filter => filter.end(name),
                    b"calculatedColumnFormula" | b"totalsRowFormula" => {
                        let which = capture.take();
                        let f = std::mem::take(&mut text);
                        let own = table.as_ref().map(|t| t.name.clone()).unwrap_or_default();
                        let col = table.as_mut().and_then(|t| t.columns.last_mut());
                        match (which, col, formula_from_file(&f, &own)) {
                            (Some("calc"), Some(c), Some(f)) => c.calculated_formula = Some(f),
                            (Some("total"), Some(c), Some(f)) => {
                                c.totals = Some(TotalsCell::Custom { formula: f })
                            }
                            _ => warnings.push(format!("{part}: table formula {f:?} dropped")),
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    warnings.extend(filter.warnings.drain(..).map(|w| format!("{part}: {w}")));
    let Some(mut t) = table else {
        return Ok(None);
    };
    // A custom total without its formula is dropped.
    for c in &mut t.columns {
        if matches!(&c.totals, Some(TotalsCell::Custom { formula }) if formula.is_empty()) {
            c.totals = None;
        }
    }
    t.auto_filter = filter.auto_filter.take().map(|mut af| {
        af.columns.retain(|c| (t.c0..=t.c1).contains(&c.col));
        af
    });
    Ok(Some(t))
}

/// Loads the tables of every sheet (before the cells, so that structured
/// references register). Returns warnings.
pub(crate) fn load(
    pkg: &Package,
    wb: &mut Workbook,
    sheets: &[(SheetId, String, PartName)],
    consumed: &mut BTreeSet<PartName>,
) -> Result<Vec<String>> {
    let mut warnings = Vec::new();
    let mut used_ids = BTreeSet::new();
    for (id, name, part) in sheets {
        let Some(rels) = pkg.relationships(part) else {
            continue;
        };
        let mut tables = Vec::new();
        for r in rels.iter().filter(|r| r.rel_type == TABLE_REL) {
            if r.target_mode != TargetMode::Internal {
                continue;
            }
            let Ok(target) = part.resolve(&r.target) else {
                continue;
            };
            let Some(p) = pkg.part(&target) else {
                warnings.push(format!("sheet {name:?}: table {} is missing", r.target));
                continue;
            };
            consumed.insert(target.clone());
            if let Some(t) = parse_table(&p.data, target.as_str(), &mut warnings)? {
                tables.push(t);
            }
        }
        if tables.is_empty() {
            continue;
        }
        for t in &mut tables {
            if t.id == 0 || !used_ids.insert(t.id) {
                t.id = used_ids.iter().max().copied().unwrap_or(0) + 1;
                used_ids.insert(t.id);
            }
            let width = (t.c1 - t.c0 + 1) as usize;
            if t.columns.len() != width {
                warnings.push(format!(
                    "sheet {name:?}: table {:?} has {} columns for a {width}-column range; columns fixed",
                    t.name,
                    t.columns.len()
                ));
                t.columns.truncate(width);
                while t.columns.len() < width {
                    let n = t.columns.len() as u32 + 1;
                    let cname = t.unique_column_name(&format!("Column{n}"), None);
                    t.columns.push(TableColumn::new(n + 1000, &cname));
                }
            }
        }
        let count = tables.len();
        if let Err(e) = wb.set_tables(*id, tables.clone()) {
            // Keep what is valid on its own.
            let mut kept = Vec::new();
            for t in tables {
                let mut trial = kept.clone();
                trial.push(t.clone());
                if wb.set_tables(*id, trial).is_ok() {
                    kept.push(t);
                } else {
                    warnings.push(format!("sheet {name:?}: table {:?} dropped ({e})", t.name));
                }
            }
            if kept.len() != count {
                let _ = wb.set_tables(*id, kept);
            }
        }
    }
    Ok(warnings)
}

/// Counter of the table parts written so far.
#[derive(Default)]
pub(crate) struct TableParts {
    count: usize,
}

impl TableParts {
    /// Writes the table parts of `sheet`; returns the relationship ids
    /// for `<tableParts>`.
    pub(crate) fn write(
        &mut self,
        pkg: &mut Package,
        sheet_rels: &mut Relationships,
        wb: &Workbook,
        sheet: SheetId,
    ) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        for t in wb.tables(sheet) {
            self.count += 1;
            let part = PartName::new(format!("/xl/tables/table{}.xml", self.count))?;
            pkg.insert_part(part, TABLE_CT, table_xml(t));
            ids.push(
                sheet_rels
                    .add(TABLE_REL, format!("../tables/table{}.xml", self.count))
                    .id
                    .clone(),
            );
        }
        Ok(ids)
    }
}

/// `<tableParts>` of a sheet.
pub(crate) fn table_parts_xml(x: &mut XmlOut, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    x.start("tableParts", &[("count", &ids.len().to_string())]);
    for id in ids {
        x.empty("tablePart", &[("r:id", id)]);
    }
    x.end("tableParts");
}

/// One `xl/tables/tableN.xml`.
fn table_xml(t: &Table) -> Vec<u8> {
    let mut x = XmlOut::new();
    let id = t.id.to_string();
    let r = range_name(t.r0, t.c0, t.r1, t.c1);
    let mut a: Vec<(&str, &str)> = vec![
        ("xmlns", MAIN_NS),
        ("id", &id),
        ("name", &t.name),
        ("displayName", &t.name),
        ("ref", &r),
    ];
    if !t.header_row {
        a.push(("headerRowCount", "0"));
    }
    if t.totals_row {
        a.push(("totalsRowCount", "1"));
    } else {
        a.push(("totalsRowShown", "0"));
    }
    x.start("table", &a);
    if let Some(af) = &t.auto_filter {
        crate::write::auto_filter_xml(&mut x, af);
    }
    x.start("tableColumns", &[("count", &t.columns.len().to_string())]);
    for c in &t.columns {
        let cid = c.id.to_string();
        let name = encode_x_escapes(&c.name);
        let mut a: Vec<(&str, &str)> = vec![("id", &cid), ("name", &name)];
        let label;
        match &c.totals {
            Some(TotalsCell::Function { function }) => {
                a.push(("totalsRowFunction", function.file_name()))
            }
            Some(TotalsCell::Label { text }) => {
                label = encode_x_escapes(text).into_owned();
                a.push(("totalsRowLabel", &label));
            }
            Some(TotalsCell::Custom { .. }) => a.push(("totalsRowFunction", "custom")),
            None => {}
        }
        let custom = match &c.totals {
            Some(TotalsCell::Custom { formula }) => Some(formula_to_file(formula, &t.name)),
            _ => None,
        };
        if c.calculated_formula.is_none() && custom.is_none() {
            x.empty("tableColumn", &a);
            continue;
        }
        x.start("tableColumn", &a);
        if let Some(f) = &c.calculated_formula {
            x.text_el("calculatedColumnFormula", &[], &formula_to_file(f, &t.name));
        }
        if let Some(f) = &custom {
            x.text_el("totalsRowFormula", &[], f);
        }
        x.end("tableColumn");
    }
    x.end("tableColumns");
    let flag = |b: bool| if b { "1" } else { "0" };
    let mut a: Vec<(&str, &str)> = Vec::new();
    if !t.style.is_empty() {
        a.push(("name", &t.style));
    }
    a.extend([
        ("showFirstColumn", flag(t.look.first_column)),
        ("showLastColumn", flag(t.look.last_column)),
        ("showRowStripes", flag(t.look.banded_rows)),
        ("showColumnStripes", flag(t.look.banded_columns)),
    ]);
    x.empty("tableStyleInfo", &a);
    x.end("table");
    x.finish()
}

/// The name of the table holding `c` (for qualifying references).
pub(crate) fn table_name_at(wb: &Workbook, c: CellCoord) -> Option<&str> {
    wb.table_at(c).map(|t| t.name.as_str())
}
