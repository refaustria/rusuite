//! Tables: `p:graphicFrame/a:graphic/a:graphicData/a:tbl` ↔
//! [`model_show::Table`].

use model_show::table::{MEDIUM_STYLE_2_ACCENT_1, NO_STYLE_NO_GRID};
use model_show::{
    Anchor, BodyProps, CellBorders, ColSpec, Emu, Insets, RowSpec, Table, TableCell, TableLook,
    TextDirection,
};

use crate::drawing::{
    read_fill, read_line, read_text_body, write_fill, write_line_with_ends, write_paragraph,
};
use crate::xml::{parse_bool, parse_i64, parse_u32, El, XmlOut};
use crate::Warnings;

/// `a:graphicData/@uri` of tables.
pub const TABLE_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/table";

/// Reads `a:tbl`. `default_style` is the `def` of `ppt/tableStyles.xml`
/// (used when the table names no style).
pub fn read_table(tbl: &El, default_style: Option<&str>, w: &mut Warnings) -> Option<Table> {
    let pr = tbl.child("tblPr");
    let flag = |a: &str| pr.and_then(|p| p.attr(a)).and_then(parse_bool) == Some(true);
    let look = TableLook {
        first_row: flag("firstRow"),
        first_col: flag("firstCol"),
        last_row: flag("lastRow"),
        last_col: flag("lastCol"),
        band_rows: flag("bandRow"),
        band_cols: flag("bandCol"),
    };
    if flag("rtl") {
        w.add("right-to-left tables read as left-to-right");
    }
    let style_id = match pr.and_then(|p| p.child("tableStyleId")) {
        Some(id) => Some(id.text().trim().to_owned()),
        None => {
            if pr.is_some_and(|p| p.child("tableStyle").is_some()) {
                w.add("inline table style dropped");
            }
            default_style.map(str::to_owned)
        }
    }
    .filter(|s| !s.is_empty() && s != NO_STYLE_NO_GRID);
    if pr.is_some_and(|p| {
        p.elements().any(|e| {
            matches!(
                e.name.as_str(),
                "solidFill" | "gradFill" | "pattFill" | "blipFill"
            )
        })
    }) {
        w.add("table background fill dropped");
    }
    let cols: Vec<ColSpec> = tbl
        .child("tblGrid")
        .map(|g| {
            g.elements()
                .filter(|e| e.name == "gridCol")
                .map(|c| ColSpec {
                    width: Emu(c.attr("w").and_then(parse_i64).unwrap_or(0).max(0)),
                })
                .collect()
        })
        .unwrap_or_default();
    let trs: Vec<&El> = tbl.elements().filter(|e| e.name == "tr").collect();
    if cols.is_empty() || trs.is_empty() {
        w.add("empty table dropped");
        return None;
    }
    let nc = cols.len();
    let mut rows = Vec::with_capacity(trs.len());
    let mut cells = Vec::with_capacity(trs.len());
    // (row span, col span, merge flag) as written
    let mut spans: Vec<Vec<(u32, u32, bool)>> = Vec::with_capacity(trs.len());
    for tr in &trs {
        rows.push(RowSpec {
            height: Emu(tr.attr("h").and_then(parse_i64).unwrap_or(0).max(0)),
        });
        let tcs: Vec<&El> = tr.elements().filter(|e| e.name == "tc").collect();
        if tcs.len() > nc {
            w.add("table cells beyond the grid dropped");
        }
        let mut row = Vec::with_capacity(nc);
        let mut row_spans = Vec::with_capacity(nc);
        for c in 0..nc {
            match tcs.get(c) {
                Some(tc) => {
                    row.push(read_cell(tc, w));
                    let n = |a: &str| tc.attr(a).and_then(parse_u32).unwrap_or(1).max(1);
                    let merged = ["hMerge", "vMerge"]
                        .iter()
                        .any(|a| tc.attr(a).and_then(parse_bool) == Some(true));
                    row_spans.push((n("rowSpan"), n("gridSpan"), merged));
                }
                None => {
                    row.push(TableCell::new());
                    row_spans.push((1, 1, false));
                }
            }
        }
        cells.push(row);
        spans.push(row_spans);
    }
    let mut table = Table {
        rows,
        cols,
        cells,
        style_id,
        look,
    };
    apply_merges(&mut table, &spans, w);
    unstyle(&mut table);
    Some(table)
}

/// Sets spans and covered flags from the file's `rowSpan`/`gridSpan`
/// (`hMerge`/`vMerge` cells inside a region are covered; such flags
/// outside any region are ignored). Inconsistent merges are dropped.
fn apply_merges(t: &mut Table, spans: &[Vec<(u32, u32, bool)>], w: &mut Warnings) {
    let (nr, nc) = (t.rows.len(), t.cols.len());
    let mut taken = vec![vec![false; nc]; nr];
    let mut ok = true;
    for r in 0..nr {
        for c in 0..nc {
            let (rs, cs, merged) = spans[r][c];
            if taken[r][c] || merged || (rs == 1 && cs == 1) {
                continue;
            }
            let rs = (rs as usize).min(nr - r);
            let cs = (cs as usize).min(nc - c);
            let free = (r..r + rs).all(|rr| (c..c + cs).all(|cc| !taken[rr][cc]));
            if !free {
                ok = false;
                continue;
            }
            for (rr, row) in taken.iter_mut().enumerate().skip(r).take(rs) {
                for (cc, slot) in row.iter_mut().enumerate().skip(c).take(cs) {
                    *slot = true;
                    if (rr, cc) != (r, c) {
                        let cell = &mut t.cells[rr][cc];
                        cell.covered = true;
                    }
                }
            }
            t.cells[r][c].row_span = rs as u32;
            t.cells[r][c].col_span = cs as u32;
        }
    }
    if !ok || t.validate().is_err() {
        w.add("inconsistent merged table cells split");
        for cell in t.cells.iter_mut().flatten() {
            cell.covered = false;
            cell.row_span = 1;
            cell.col_span = 1;
        }
    }
}

/// Drops cell fills and borders that equal what the default table style
/// draws (our writer spelled that style out before tableStyles.xml held
/// its definition; reading such files gives the style-only cells again).
fn unstyle(t: &mut Table) {
    if t.style_id.as_deref() != Some(MEDIUM_STYLE_2_ACCENT_1) {
        return;
    }
    for r in 0..t.rows.len() {
        for c in 0..t.cols.len() {
            let style = t.style_cell(r, c);
            let cell = &mut t.cells[r][c];
            if cell.fill == Some(style.fill) {
                cell.fill = None;
            }
            let b = &mut cell.borders;
            for (own, st) in [
                (&mut b.left, style.borders.left),
                (&mut b.right, style.borders.right),
                (&mut b.top, style.borders.top),
                (&mut b.bottom, style.borders.bottom),
            ] {
                if *own == st {
                    *own = None;
                }
            }
        }
    }
}

/// `a:tc`: text, margins and anchor (`a:tcPr`), fill and borders.
fn read_cell(tc: &El, w: &mut Warnings) -> TableCell {
    let mut cell = TableCell::new();
    if let Some(tx) = tc.child("txBody") {
        cell.text = read_text_body(tx, BodyProps::default(), w);
        cell.text.normalize();
    }
    let mut props = BodyProps::default();
    if let Some(pr) = tc.child("tcPr") {
        let m = |a: &str, d: Emu| Emu(pr.attr(a).and_then(parse_i64).unwrap_or(d.0));
        let d = Insets::default();
        props.insets = Insets {
            left: m("marL", d.left),
            right: m("marR", d.right),
            top: m("marT", d.top),
            bottom: m("marB", d.bottom),
        };
        props.anchor = match pr.attr("anchor") {
            Some("ctr") => Anchor::Middle,
            Some("b") => Anchor::Bottom,
            Some("just" | "dist") => {
                w.add("justified vertical cell alignment read as top");
                Anchor::Top
            }
            _ => Anchor::Top,
        };
        if let Some(v) = pr.attr("vert") {
            props.vert = TextDirection::from_ooxml(v).unwrap_or_else(|| {
                w.add(format!("cell text direction {v} read as horizontal"));
                TextDirection::Horizontal
            });
        }
        let ln = |name: &str, w: &mut Warnings| pr.child(name).map(|l| read_line(Some(l), None, w));
        cell.borders = CellBorders {
            left: ln("lnL", w),
            right: ln("lnR", w),
            top: ln("lnT", w),
            bottom: ln("lnB", w),
            diag_down: ln("lnTlToBr", w),
            diag_up: ln("lnBlToTr", w),
        };
        if pr.child("cell3D").is_some() {
            w.add("3-D cell effects dropped");
        }
        cell.fill = read_fill(pr, w);
    }
    cell.text.props = props;
    cell
}

/// Writes `a:tbl` (inside `a:graphicData`) with the style's GUID in
/// `a:tableStyleId` and only the cells' own fills and borders.
pub fn write_table(x: &mut XmlOut, t: &Table, links: &mut dyn crate::link::LinkSink) {
    x.start("a:tbl", &[]);
    let look = t.look;
    let mut attrs = Vec::new();
    for (on, name) in [
        (look.first_row, "firstRow"),
        (look.first_col, "firstCol"),
        (look.last_row, "lastRow"),
        (look.last_col, "lastCol"),
        (look.band_rows, "bandRow"),
        (look.band_cols, "bandCol"),
    ] {
        if on {
            attrs.push((name, "1"));
        }
    }
    x.start("a:tblPr", &attrs);
    x.text_el(
        "a:tableStyleId",
        &[],
        t.style_id.as_deref().unwrap_or(NO_STYLE_NO_GRID),
    );
    x.end("a:tblPr");
    x.start("a:tblGrid", &[]);
    for c in &t.cols {
        x.empty("a:gridCol", &[("w", &c.width.0.max(0).to_string())]);
    }
    x.end("a:tblGrid");
    for (r, row) in t.rows.iter().enumerate() {
        x.start("a:tr", &[("h", &row.height.0.max(0).to_string())]);
        for c in 0..t.cols.len() {
            write_cell(x, t, r, c, links);
        }
        x.end("a:tr");
    }
    x.end("a:tbl");
}

fn write_cell(
    x: &mut XmlOut,
    t: &Table,
    r: usize,
    c: usize,
    links: &mut dyn crate::link::LinkSink,
) {
    let cell = &t.cells[r][c];
    let (rs, cs) = (cell.row_span.to_string(), cell.col_span.to_string());
    let mut attrs = Vec::new();
    if cell.covered {
        let (ar, ac) = t.anchor_of(r, c);
        if ar == r || ac != c {
            attrs.push(("hMerge", "1"));
        }
        if ac == c || ar != r {
            attrs.push(("vMerge", "1"));
        }
    } else {
        if cell.row_span > 1 {
            attrs.push(("rowSpan", rs.as_str()));
        }
        if cell.col_span > 1 {
            attrs.push(("gridSpan", cs.as_str()));
        }
    }
    x.start("a:tc", &attrs);
    x.start("a:txBody", &[]);
    x.empty("a:bodyPr", &[]);
    x.empty("a:lstStyle", &[]);
    if cell.text.paragraphs.is_empty() {
        x.empty("a:p", &[]);
    }
    for p in &cell.text.paragraphs {
        write_paragraph(x, p, links);
    }
    x.end("a:txBody");

    let props = &cell.text.props;
    let d = Insets::default();
    let s = |e: Emu| e.0.to_string();
    let (ml, mr, mt, mb) = (
        s(props.insets.left),
        s(props.insets.right),
        s(props.insets.top),
        s(props.insets.bottom),
    );
    let mut pr: Vec<(&str, &str)> = Vec::new();
    for (name, v, dv, sv) in [
        ("marL", props.insets.left, d.left, &ml),
        ("marR", props.insets.right, d.right, &mr),
        ("marT", props.insets.top, d.top, &mt),
        ("marB", props.insets.bottom, d.bottom, &mb),
    ] {
        if v != dv {
            pr.push((name, sv.as_str()));
        }
    }
    if props.vert != TextDirection::Horizontal {
        pr.push(("vert", props.vert.as_ooxml()));
    }
    match props.anchor {
        Anchor::Top => {}
        Anchor::Middle => pr.push(("anchor", "ctr")),
        Anchor::Bottom => pr.push(("anchor", "b")),
    }
    // only the cell's own formatting: the style is defined in
    // `tableStyles.xml` and referenced by `a:tableStyleId`
    let borders = cell.borders;
    let fill = cell.fill;
    x.start("a:tcPr", &pr);
    let none = model_show::ArrowEnd::default();
    for (name, line) in [
        ("a:lnL", borders.left),
        ("a:lnR", borders.right),
        ("a:lnT", borders.top),
        ("a:lnB", borders.bottom),
        ("a:lnTlToBr", borders.diag_down),
        ("a:lnBlToTr", borders.diag_up),
    ] {
        if let Some(line) = line {
            write_line_with_ends(x, name, &line, &none, &none);
        }
    }
    if let Some(f) = fill {
        write_fill(x, &f);
    }
    x.end("a:tcPr");
    x.end("a:tc");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;
    use model_show::{Color, Fill, Line, TextBody};

    fn roundtrip(t: &Table) -> (Table, Vec<String>) {
        let mut x = XmlOut::fragment();
        write_table(&mut x, t, &mut crate::link::NoLinks);
        let xml = String::from_utf8(x.finish()).unwrap();
        let el = parse(xml.as_bytes(), "t").unwrap();
        let mut w = Warnings::default();
        let back = read_table(&el, None, &mut w).unwrap();
        (back, w.into_vec())
    }

    #[test]
    fn table_roundtrip() {
        let mut t = Table::new(3, 3, Emu(3_000_000), Emu(1_200_000));
        t.cells[0][0].text = TextBody::plain("Head");
        t.merge(1, 0, 2, 2).unwrap();
        t.merge(0, 1, 1, 2).unwrap();
        t.cells[2][2].fill = Some(Fill::Solid(Color::Rgb(core_model::Rgb::new(255, 0, 0))));
        t.cells[2][2].borders.left = Some(Line::solid(
            Color::Rgb(core_model::Rgb::new(0, 0, 0)),
            Emu(25_400),
        ));
        t.cells[1][2].text.props.anchor = Anchor::Bottom;
        t.cells[1][2].text.props.insets.left = Emu(0);
        t.look.last_col = true;
        t.validate().unwrap();
        let (back, warnings) = roundtrip(&t);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(back, t);
        // no style: written as "No Style, No Grid", read back as none
        t.style_id = None;
        let (back, _) = roundtrip(&t);
        assert_eq!(back, t);
    }

    #[test]
    fn diagonals_text_direction_and_style_flags_roundtrip() {
        let mut t = Table::new(2, 2, Emu(2_000_000), Emu(800_000));
        let red = Line::solid(Color::Rgb(core_model::Rgb::new(255, 0, 0)), Emu(19_050))
            .with_compound(model_show::LineCompound::Double);
        t.cells[0][1].borders.diag_down = Some(red);
        t.cells[1][0].borders.diag_up = Some(Line::default());
        t.cells[1][1].text.props.vert = TextDirection::Rotate270;
        t.cells[0][0].text.props.vert = TextDirection::Stacked;
        t.style_id = Some("{E8034E78-7F5D-4C2E-B375-FC64B27BC917}".into());
        t.look.band_cols = true;
        let mut x = XmlOut::fragment();
        write_table(&mut x, &t, &mut crate::link::NoLinks);
        let xml = String::from_utf8(x.finish()).unwrap();
        assert!(xml.contains(r#"<a:tblPr firstRow="1" bandRow="1" bandCol="1"><a:tableStyleId>{E8034E78-7F5D-4C2E-B375-FC64B27BC917}</a:tableStyleId>"#));
        assert!(xml.contains(r#"<a:tcPr vert="vert270">"#));
        assert!(xml.contains(r#"<a:lnTlToBr w="19050" cmpd="dbl">"#));
        // style-only cells write no fills: the only one is the red line's
        assert_eq!(xml.matches("<a:solidFill>").count(), 1);
        let (back, warnings) = roundtrip(&t);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(back, t);
    }

    #[test]
    fn merge_flags_and_bad_spans() {
        let xml = r#"<a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="10"/><a:gridCol w="10"/></a:tblGrid><a:tr h="5"><a:tc gridSpan="2" rowSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc><a:tc hMerge="1"/></a:tr><a:tr h="5"><a:tc vMerge="1"/><a:tc hMerge="1" vMerge="1"/></a:tr><a:tr h="5"><a:tc gridSpan="5"/></a:tr></a:tbl>"#;
        let el = parse(xml.as_bytes(), "t").unwrap();
        let mut w = Warnings::default();
        let t = read_table(&el, Some(MEDIUM_STYLE_2_ACCENT_1), &mut w).unwrap();
        t.validate().unwrap();
        assert!(w.into_vec().is_empty());
        assert_eq!((t.cells[0][0].row_span, t.cells[0][0].col_span), (2, 2));
        assert!(t.cells[1][1].covered);
        // the oversized span is clamped to the grid
        assert_eq!(t.cells[2][0].col_span, 2);
        assert_eq!(t.style_id.as_deref(), Some(MEDIUM_STYLE_2_ACCENT_1));
        assert!(t.look.first_row && !t.look.band_rows);
    }
}
