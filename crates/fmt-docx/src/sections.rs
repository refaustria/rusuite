//! `w:sectPr` ↔ [`Section`] (without the header/footer content, which the
//! reader and writer handle as separate parts).

use core_model::units::Twips;
use model_text::{
    ColumnWidth, Columns, HeaderSlot, Margins, Orientation, PageSetup, Section, SectionId,
    SectionKind,
};

use crate::numbering::{number_format, number_format_name};
use crate::xml::{parse_twips, parse_u32, toggle, El, WriteVal, XmlOut};
use crate::Warnings;

/// A header or footer reference of a `w:sectPr`: footer?, slot, `r:id`.
pub(crate) type HeaderRef = (bool, HeaderSlot, String);

fn slot_of(v: &str) -> Option<HeaderSlot> {
    match v {
        "default" => Some(HeaderSlot::Default),
        "first" => Some(HeaderSlot::First),
        "even" => Some(HeaderSlot::Even),
        _ => None,
    }
}

fn slot_name(s: HeaderSlot) -> &'static str {
    match s {
        HeaderSlot::Default => "default",
        HeaderSlot::First => "first",
        HeaderSlot::Even => "even",
    }
}

/// `w:sectPr` → section `id` (no headers yet) and its header/footer
/// references.
pub(crate) fn read_sect_pr(s: &El, id: SectionId, w: &mut Warnings) -> (Section, Vec<HeaderRef>) {
    let mut sec = Section::new(id, PageSetup::a4());
    let mut refs = Vec::new();
    let page = &mut sec.page;
    let tw = |el: &El, a: &str| el.attr(a).and_then(parse_twips).map(Twips);
    for el in s.elements() {
        match el.name.as_str() {
            "pgSz" => {
                if let Some(v) = tw(el, "w") {
                    page.width = v;
                }
                if let Some(v) = tw(el, "h") {
                    page.height = v;
                }
                page.orientation = match el.attr("orient") {
                    Some("landscape") => Orientation::Landscape,
                    _ => Orientation::Portrait,
                };
            }
            "pgMar" => {
                let m: &mut Margins = &mut page.margins;
                for (a, slot) in [
                    ("top", &mut m.top),
                    ("right", &mut m.right),
                    ("bottom", &mut m.bottom),
                    ("left", &mut m.left),
                    ("header", &mut m.header),
                    ("footer", &mut m.footer),
                ] {
                    if let Some(v) = tw(el, a) {
                        *slot = v;
                    }
                }
                if tw(el, "gutter").is_some_and(|g| g.0 != 0) {
                    w.warn("docx.section.gutter", "section: gutter margin dropped", &[]);
                }
            }
            "headerReference" | "footerReference" => {
                let footer = el.name == "footerReference";
                let slot = el.attr("type").map_or(Some(HeaderSlot::Default), slot_of);
                match (slot, el.attr("id")) {
                    (Some(slot), Some(rid)) => refs.push((footer, slot, rid.to_owned())),
                    (None, _) => w.warn(
                        "docx.section.unknownHeaderType",
                        "section: header/footer of unknown type dropped",
                        &[],
                    ),
                    (_, None) => {}
                }
            }
            "type" => {
                sec.kind = match el.val() {
                    Some("continuous") => SectionKind::Continuous,
                    Some("evenPage") => SectionKind::EvenPage,
                    Some("oddPage") => SectionKind::OddPage,
                    Some("nextColumn") => {
                        w.warn(
                            "docx.section.columnBreak",
                            "section: column break section read as continuous",
                            &[],
                        );
                        SectionKind::Continuous
                    }
                    _ => SectionKind::NextPage,
                }
            }
            "cols" => {
                let widths: Vec<ColumnWidth> = el
                    .elements()
                    .filter(|c| c.name == "col")
                    .map(|c| ColumnWidth {
                        width: tw(c, "w").unwrap_or(Twips(0)),
                        space: tw(c, "space").unwrap_or(Twips(0)),
                    })
                    .collect();
                let num = el
                    .attr("num")
                    .and_then(parse_u32)
                    .map(|n| n.clamp(1, 45) as u8);
                let equal = el
                    .attr("equalWidth")
                    .and_then(crate::xml::parse_bool)
                    .unwrap_or(widths.is_empty());
                let count = num.unwrap_or(if equal || widths.is_empty() {
                    1
                } else {
                    widths.len().clamp(1, 45) as u8
                });
                sec.columns = Columns {
                    count,
                    spacing: tw(el, "space"),
                    equal: equal || widths.len() != usize::from(count),
                    widths: if equal || widths.len() != usize::from(count) {
                        Vec::new()
                    } else {
                        widths
                    },
                    separator: el.attr("sep").and_then(crate::xml::parse_bool) == Some(true),
                };
            }
            "titlePg" => sec.title_page = toggle(el),
            "pgNumType" => {
                sec.page_number_start = el.attr("start").and_then(parse_u32);
                sec.page_number_format = match el.attr("fmt") {
                    Some(f) => number_format(f).or_else(|| {
                        w.warn(
                            "docx.section.pageNumberFormat",
                            "section: page number format {format} read as decimal",
                            &[("format", &format!("{f:?}"))],
                        );
                        None
                    }),
                    None => None,
                };
                if el.attr("chapStyle").is_some() {
                    w.warn(
                        "docx.section.chapterNumbers",
                        "section: chapter numbers in page numbers dropped",
                        &[],
                    );
                }
            }
            "bidi" | "rtlGutter" if !toggle(el) => {}
            "textDirection" if matches!(el.val(), Some("lrTb" | "tb")) => {}
            "formProt" | "docGrid" | "printerSettings" | "noEndnote" | "sectPrChange" => {}
            _ => w.warn(
                "docx.section.propertyDropped",
                "section: {name} dropped",
                &[("name", &el.qname())],
            ),
        }
    }
    (sec, refs)
}

/// Serialized `w:sectPr` of `s` with its header/footer references.
pub(crate) fn write_sect_pr(s: &Section, refs: &[HeaderRef]) -> Vec<u8> {
    let mut x = XmlOut::fragment();
    x.start("w:sectPr", &[]);
    for footer in [false, true] {
        for (_, slot, rid) in refs.iter().filter(|r| r.0 == footer) {
            let name = if footer {
                "w:footerReference"
            } else {
                "w:headerReference"
            };
            x.empty(name, &[("w:type", slot_name(*slot)), ("r:id", rid)]);
        }
    }
    match s.kind {
        SectionKind::NextPage => {}
        SectionKind::Continuous => x.val("w:type", "continuous"),
        SectionKind::EvenPage => x.val("w:type", "evenPage"),
        SectionKind::OddPage => x.val("w:type", "oddPage"),
    }
    let p = &s.page;
    let (w, h) = (p.width.0.to_string(), p.height.0.to_string());
    let mut size = vec![("w:w", w.as_str()), ("w:h", h.as_str())];
    if p.orientation == Orientation::Landscape {
        size.push(("w:orient", "landscape"));
    }
    x.empty("w:pgSz", &size);
    let m = &p.margins;
    let vals = [m.top, m.right, m.bottom, m.left, m.header, m.footer].map(|t| t.0.to_string());
    x.empty(
        "w:pgMar",
        &[
            ("w:top", &vals[0]),
            ("w:right", &vals[1]),
            ("w:bottom", &vals[2]),
            ("w:left", &vals[3]),
            ("w:header", &vals[4]),
            ("w:footer", &vals[5]),
            ("w:gutter", "0"),
        ],
    );
    if s.page_number_start.is_some() || s.page_number_format.is_some() {
        let start = s.page_number_start.map(|v| v.to_string());
        let mut attrs = Vec::new();
        if let Some(f) = s.page_number_format {
            attrs.push(("w:fmt", number_format_name(f)));
        }
        if let Some(st) = &start {
            attrs.push(("w:start", st.as_str()));
        }
        x.empty("w:pgNumType", &attrs);
    }
    let c = &s.columns;
    if !c.is_single() {
        let num = c.count.max(1).to_string();
        let space = c.spacing.map(|t| t.0.to_string());
        let mut attrs = Vec::new();
        if let Some(sp) = &space {
            attrs.push(("w:space", sp.as_str()));
        }
        if c.count > 1 {
            attrs.push(("w:num", num.as_str()));
        }
        if c.separator {
            attrs.push(("w:sep", "1"));
        }
        let unequal = !c.equal && c.widths.len() == usize::from(c.count) && c.count > 1;
        if unequal {
            attrs.push(("w:equalWidth", "0"));
            x.start("w:cols", &attrs);
            for (i, col) in c.widths.iter().enumerate() {
                let w = col.width.0.to_string();
                let sp = col.space.0.to_string();
                let mut a = vec![("w:w", w.as_str())];
                if i + 1 < c.widths.len() {
                    a.push(("w:space", sp.as_str()));
                }
                x.empty("w:col", &a);
            }
            x.end("w:cols");
        } else {
            x.empty("w:cols", &attrs);
        }
    }
    if s.title_page {
        x.empty("w:titlePg", &[]);
    }
    x.end("w:sectPr");
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    #[test]
    fn sect_pr_both_directions() {
        let xml = r#"<w:sectPr xmlns:w="w" xmlns:r="r"><w:headerReference w:type="default" r:id="rId2"/>
            <w:headerReference w:type="first" r:id="rId3"/><w:footerReference w:type="even" r:id="rId4"/>
            <w:type w:val="continuous"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
            <w:pgMar w:top="1000" w:right="1100" w:bottom="1200" w:left="1300" w:header="500" w:footer="600" w:gutter="0"/>
            <w:pgNumType w:fmt="lowerRoman" w:start="3"/><w:cols w:space="708" w:num="2"/><w:formProt w:val="false"/>
            <w:titlePg/><w:textDirection w:val="lrTb"/><w:docGrid w:linePitch="360"/></w:sectPr>"#;
        let el = parse(xml.as_bytes(), "d").unwrap();
        let mut w = Warnings::default();
        let (s, refs) = read_sect_pr(&el, SectionId(4), &mut w);
        assert!(w.is_empty(), "{:?}", w.into_vec());
        assert_eq!(s.id, SectionId(4));
        assert_eq!(s.kind, SectionKind::Continuous);
        assert_eq!(s.page.orientation, Orientation::Landscape);
        assert_eq!(s.page.margins.left, Twips(1300));
        assert_eq!((s.columns.count, s.columns.spacing), (2, Some(Twips(708))));
        assert!(s.title_page);
        assert_eq!(s.page_number_start, Some(3));
        assert_eq!(
            s.page_number_format,
            Some(model_text::LevelKind::LowerRoman)
        );
        assert_eq!(
            refs,
            vec![
                (false, HeaderSlot::Default, "rId2".to_owned()),
                (false, HeaderSlot::First, "rId3".to_owned()),
                (true, HeaderSlot::Even, "rId4".to_owned()),
            ]
        );
        let out = write_sect_pr(&s, &refs);
        let text = String::from_utf8(out.clone()).unwrap();
        assert!(text.starts_with(r#"<w:sectPr><w:headerReference w:type="default" r:id="rId2"/>"#));
        let back = parse(
            format!(r#"<w:x xmlns:w="w" xmlns:r="r">{text}</w:x>"#).as_bytes(),
            "d",
        )
        .unwrap();
        let (s2, refs2) = read_sect_pr(back.child("sectPr").unwrap(), SectionId(4), &mut w);
        assert_eq!((s2, refs2), (s, refs));
    }
}
