//! `ppt/tableStyles.xml` ↔ [`TableStyleDef`]s.
//!
//! The writer defines every style the presentation's tables use (and the
//! default, Medium Style 2 – Accent 1): the presentation's own styles as
//! read, PowerPoint's built-ins from their family rules
//! ([`model_show::builtin_table_styles`]). The reader interprets every
//! `a:tblStyle` whose GUID is not a built-in, so tables of files with
//! other styles render their colours.

use std::collections::BTreeSet;

use crate::Warnings;
use model_show::table::MEDIUM_STYLE_2_ACCENT_1;
use model_show::tablestyle::PART_NAMES;
use model_show::{
    builtin_table_style, Emu, Fill, Line, Presentation, Shape, ShapeKind, TableStyleDef,
    TableStylePart,
};

use crate::drawing::{read_color, read_fill, read_line, write_color, write_fill, write_line};
use crate::parts::NS_A;
use crate::xml::{El, XmlOut};

/// The edges of `a:tcBdr` in writing order with their model fields.
const EDGES: [&str; 6] = ["left", "right", "top", "bottom", "insideH", "insideV"];

fn edge_mut<'a>(p: &'a mut TableStylePart, name: &str) -> Option<&'a mut Option<Line>> {
    Some(match name {
        "left" => &mut p.left,
        "right" => &mut p.right,
        "top" => &mut p.top,
        "bottom" => &mut p.bottom,
        "insideH" => &mut p.inside_h,
        "insideV" => &mut p.inside_v,
        _ => return None,
    })
}

fn edge(p: &TableStylePart, name: &str) -> Option<Line> {
    match name {
        "left" => p.left,
        "right" => p.right,
        "top" => p.top,
        "bottom" => p.bottom,
        "insideH" => p.inside_h,
        "insideV" => p.inside_v,
        _ => None,
    }
}

/// `on`/`off`/`def` of `a:tcTxStyle/@b`, `@i`.
fn on_off(v: Option<&str>) -> Option<bool> {
    match v {
        Some("on") => Some(true),
        Some("off") => Some(false),
        _ => None,
    }
}

/// A fill of `a:tcStyle` or `a:tblBg`: `a:fill` with a fill element, or
/// `a:fillRef` with its colour (read as a solid fill).
fn read_part_fill(parent: &El, w: &mut Warnings) -> Option<Fill> {
    if let Some(f) = parent.child("fill") {
        return read_fill(f, w);
    }
    parent
        .child("fillRef")
        .and_then(|r| read_color(r, w))
        .map(Fill::Solid)
}

/// One `a:tcBdr` edge: `a:ln`, or `a:lnRef` with its colour (1 pt).
fn read_edge(el: &El, w: &mut Warnings) -> Option<Line> {
    if let Some(ln) = el.child("ln") {
        return Some(read_line(Some(ln), None, w));
    }
    el.child("lnRef")
        .and_then(|r| read_color(r, w))
        .map(|c| Line::solid(c, Emu(12_700)))
}

fn read_part(el: &El, w: &mut Warnings) -> TableStylePart {
    let mut p = TableStylePart::default();
    if let Some(tx) = el.child("tcTxStyle") {
        p.bold = on_off(tx.attr("b"));
        p.italic = on_off(tx.attr("i"));
        p.text_color = read_color(tx, w);
    }
    if let Some(tc) = el.child("tcStyle") {
        if let Some(bdr) = tc.child("tcBdr") {
            for e in bdr.elements() {
                if let Some(slot) = edge_mut(&mut p, &e.name) {
                    *slot = read_edge(e, w);
                } else {
                    w.add("diagonal table style borders dropped");
                }
            }
        }
        p.fill = read_part_fill(tc, w);
        if tc.child("cell3D").is_some() {
            w.add("3-D table style effects dropped");
        }
    }
    p
}

/// The styles of a `tableStyles.xml` root (`a:tblStyleLst`) that are not
/// PowerPoint built-ins.
pub fn read_table_styles(root: &El, w: &mut Warnings) -> Vec<TableStyleDef> {
    let mut out = Vec::new();
    for st in root.elements().filter(|e| e.name == "tblStyle") {
        let Some(id) = st.attr("styleId") else {
            continue;
        };
        if builtin_table_style(id).is_some() {
            continue;
        }
        let mut def = TableStyleDef::new(id, st.attr("styleName").unwrap_or(""));
        for part in st.elements() {
            if let Some(slot) = def.part_mut(&part.name) {
                *slot = read_part(part, w);
            } else if part.name == "tblBg" {
                // the table background shows where the whole table has no fill
                if let Some(f) = read_part_fill(part, w) {
                    def.whole.fill.get_or_insert(f);
                }
            } else {
                w.add(format!("table style part {} dropped", part.name));
            }
        }
        out.push(def);
    }
    out
}

fn write_part(x: &mut XmlOut, name: &str, p: &TableStylePart) {
    x.start(&format!("a:{name}"), &[]);
    if p.bold.is_some() || p.italic.is_some() || p.text_color.is_some() {
        let flag = |v: bool| if v { "on" } else { "off" };
        let mut attrs = Vec::new();
        if let Some(b) = p.bold {
            attrs.push(("b", flag(b)));
        }
        if let Some(i) = p.italic {
            attrs.push(("i", flag(i)));
        }
        x.start("a:tcTxStyle", &attrs);
        x.start("a:fontRef", &[("idx", "minor")]);
        x.empty("a:prstClr", &[("val", "black")]);
        x.end("a:fontRef");
        if let Some(c) = &p.text_color {
            write_color(x, c);
        }
        x.end("a:tcTxStyle");
    }
    x.start("a:tcStyle", &[]);
    if EDGES.iter().any(|e| edge(p, e).is_some()) {
        x.start("a:tcBdr", &[]);
        for e in EDGES {
            if let Some(line) = edge(p, e) {
                x.start(&format!("a:{e}"), &[]);
                write_line(x, &line);
                x.end(&format!("a:{e}"));
            }
        }
        x.end("a:tcBdr");
    }
    if let Some(f) = &p.fill {
        x.start("a:fill", &[]);
        write_fill(x, f);
        x.end("a:fill");
    }
    x.end("a:tcStyle");
    x.end(&format!("a:{name}"));
}

fn write_style(x: &mut XmlOut, s: &TableStyleDef) {
    x.start("a:tblStyle", &[("styleId", &s.id), ("styleName", &s.name)]);
    for name in PART_NAMES {
        let Some(p) = s.part(name) else { continue };
        if name == "wholeTbl" || !p.is_empty() {
            write_part(x, name, p);
        }
    }
    x.end("a:tblStyle");
}

/// The style ids the presentation's tables use (slides, layouts, master).
fn used_ids(p: &Presentation) -> BTreeSet<String> {
    fn walk(shapes: &[Shape], out: &mut BTreeSet<String>) {
        for s in shapes {
            match &s.kind {
                ShapeKind::Table(t) => {
                    if let Some(id) = &t.style_id {
                        out.insert(id.to_ascii_uppercase());
                    }
                }
                ShapeKind::Group { children } => walk(children, out),
                _ => {}
            }
        }
    }
    let mut out = BTreeSet::new();
    for s in &p.slides {
        walk(&s.shapes, &mut out);
    }
    for l in &p.layouts {
        walk(&l.shapes, &mut out);
    }
    walk(&p.master.shapes, &mut out);
    out
}

/// `ppt/tableStyles.xml`: `def` = Medium Style 2 – Accent 1 and the
/// definitions of it and of every style a table uses (the presentation's
/// own styles first, then the built-ins; unknown ids are left out).
pub fn table_styles_xml(p: &Presentation) -> Vec<u8> {
    let mut ids = used_ids(p);
    ids.insert(MEDIUM_STYLE_2_ACCENT_1.to_owned());
    let mut x = XmlOut::new();
    x.start(
        "a:tblStyleLst",
        &[("xmlns:a", NS_A), ("def", MEDIUM_STYLE_2_ACCENT_1)],
    );
    // the default first, then by id
    let mut order: Vec<&String> = ids.iter().collect();
    order.sort_by_key(|id| (id.as_str() != MEDIUM_STYLE_2_ACCENT_1, id.as_str()));
    for id in order {
        let def = p
            .table_styles
            .iter()
            .find(|s| s.id.eq_ignore_ascii_case(id))
            .or_else(|| builtin_table_style(id));
        if let Some(def) = def {
            write_style(&mut x, def);
        }
    }
    x.end("a:tblStyleLst");
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;
    use model_show::Transform;

    #[test]
    fn builtins_roundtrip_through_the_part_reader() {
        // a built-in written out and read as if it were unknown gives the
        // same definition
        for id in [
            MEDIUM_STYLE_2_ACCENT_1,
            "{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}",
            "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}",
            "{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}",
        ] {
            let def = builtin_table_style(id).unwrap();
            let mut x = XmlOut::new();
            x.start("a:tblStyleLst", &[("xmlns:a", NS_A)]);
            let mut renamed = def.clone();
            renamed.id = "{00000000-0000-0000-0000-000000000001}".into();
            write_style(&mut x, &renamed);
            x.end("a:tblStyleLst");
            let root = parse(&x.finish(), "t").unwrap();
            let mut w = Warnings::default();
            let back = read_table_styles(&root, &mut w);
            assert!(w.into_vec().is_empty());
            assert_eq!(back, [renamed], "{}", def.name);
        }
    }

    #[test]
    fn used_styles_are_written() {
        let mut p = Presentation::new();
        let slide = p.slides[0].id;
        let mut s = Shape::table(2, 2, Transform::new(Emu(0), Emu(0), Emu(1_000), Emu(1_000)));
        s.table_mut().unwrap().style_id = Some("{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}".into());
        p.add_shape(slide, s).unwrap();
        let xml = String::from_utf8(table_styles_xml(&p)).unwrap();
        assert!(xml.contains(r#"def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}""#));
        assert!(xml.contains(r#"styleId="{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}" styleName="Medium Style 2 - Accent 3""#));
        assert!(xml.contains(r#"<a:schemeClr val="accent3"/>"#));
    }
}
