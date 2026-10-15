//! `word/styles.xml` ↔ [`model_text::StyleSheet`].

use core_model::{ColorScheme, RunProperties};
use model_text::{
    CellProperties, ConditionalFormat, ConditionalKind, Defaults, ParagraphProperties, Style,
    StyleKind, StyleSheet, TableStyle,
};

use crate::numbering::W_NS;
use crate::props::{read_ppr, read_rpr, write_ppr, write_rpr};
use crate::read::{read_tbl_pr, read_tc_pr};
use crate::write::{write_tbl_pr, write_tc_pr};
use crate::xml::{parse, parse_bool, parse_u32, El, WriteVal, XmlOut};
use crate::{Result, Warnings};

/// `w:style` children that carry no formatting we model and are dropped
/// silently.
const SILENT_STYLE: &[&str] = &[
    "name",
    "aliases",
    "basedOn",
    "next",
    "link",
    "autoRedefine",
    "hidden",
    "uiPriority",
    "semiHidden",
    "unhideWhenUsed",
    "qFormat",
    "locked",
    "personal",
    "personalCompose",
    "personalReply",
    "rsid",
];

/// Parses `styles.xml`.
pub(crate) fn read_styles(xml: &[u8], part: &str, w: &mut Warnings) -> Result<StyleSheet> {
    let root = parse(xml, part)?;
    let mut sheet = StyleSheet::default();
    for el in root.elements() {
        match el.name.as_str() {
            "docDefaults" => sheet.defaults = read_defaults(el, part, w),
            "style" => {
                if let Some(style) = read_style(el, part, w) {
                    if sheet.get(&style.id).is_some() {
                        w.add(format!("{part}: duplicate style id {:?} dropped", style.id));
                    } else {
                        sheet.styles.push(style);
                    }
                }
            }
            "latentStyles" => {}
            _ => w.add(format!("{part}: {} dropped", el.qname())),
        }
    }
    Ok(sheet)
}

fn read_defaults(el: &El, part: &str, w: &mut Warnings) -> Defaults {
    let ctx = format!("{part} (document defaults)");
    let run = el
        .child("rPrDefault")
        .and_then(|d| d.child("rPr"))
        .map(|r| read_rpr(r, &ctx, w))
        .unwrap_or_default();
    let paragraph = el
        .child("pPrDefault")
        .and_then(|d| d.child("pPr"))
        .map(|p| read_ppr(p, &ctx, w))
        .unwrap_or_default();
    Defaults { run, paragraph }
}

fn read_style(el: &El, part: &str, w: &mut Warnings) -> Option<Style> {
    let id = el.attr("styleId")?.to_owned();
    let kind = match el.attr("type").unwrap_or("paragraph") {
        "paragraph" => StyleKind::Paragraph,
        "character" => StyleKind::Character,
        "table" => StyleKind::Table,
        other => {
            w.add(format!("{part}: {other} style {id:?} dropped"));
            return None;
        }
    };
    let ctx = format!("{part} (style {id})");
    let child_val = |name: &str| el.child(name).and_then(El::val).map(str::to_owned);
    let mut style = Style {
        name: child_val("name").unwrap_or_else(|| id.clone()),
        id,
        kind,
        based_on: child_val("basedOn"),
        next: child_val("next"),
        paragraph: ParagraphProperties::default(),
        run: RunProperties::default(),
        is_default: el.attr("default").and_then(parse_bool).unwrap_or(false),
        table: None,
    };
    let mut table = TableStyle::default();
    for c in el.elements() {
        match c.name.as_str() {
            "pPr" => {
                style.paragraph = read_ppr(c, &ctx, w);
                if style.paragraph.style.take().is_some() {
                    w.add(format!("{ctx}: w:pStyle inside a style dropped"));
                }
                if style.paragraph.run_defaults.take().is_some() {
                    w.add(format!("{ctx}: paragraph mark formatting dropped"));
                }
            }
            "rPr" => style.run = read_rpr(c, &ctx, w),
            "tblPr" => {
                table.table = read_tbl_pr(c, &ctx, w);
                let band = |name: &str| {
                    c.child(name)
                        .and_then(El::val)
                        .and_then(parse_u32)
                        .map(|v| v.min(255) as u8)
                };
                table.row_band_size = band("tblStyleRowBandSize");
                table.col_band_size = band("tblStyleColBandSize");
            }
            "tcPr" => table.cell = read_tc_pr(c, &ctx, w),
            "trPr" => {
                if c.elements().next().is_some() {
                    w.add(format!("{ctx}: table style row formatting dropped"));
                }
            }
            "tblStylePr" => {
                if let Some(f) = read_conditional(c, &ctx, w) {
                    table.conditional.retain(|o| o.kind != f.kind);
                    table.conditional.push(f);
                }
            }
            name if SILENT_STYLE.contains(&name) => {}
            _ => w.add(format!("{ctx}: {} dropped", c.qname())),
        }
    }
    if style.kind == StyleKind::Table && !table.is_empty() {
        style.table = Some(table);
    } else if !table.is_empty() {
        w.add(format!(
            "{ctx}: table formatting of a non-table style dropped"
        ));
    }
    Some(style)
}

/// `w:tblStylePr` → conditional format (`None` for unknown types).
fn read_conditional(el: &El, ctx: &str, w: &mut Warnings) -> Option<ConditionalFormat> {
    let Some(kind) = el.attr("type").and_then(ConditionalKind::from_docx) else {
        w.add(format!(
            "{ctx}: conditional table formatting {:?} dropped",
            el.attr("type")
        ));
        return None;
    };
    let mut f = ConditionalFormat {
        kind,
        paragraph: ParagraphProperties::default(),
        run: RunProperties::default(),
        cell: CellProperties::default(),
    };
    for c in el.elements() {
        match c.name.as_str() {
            "pPr" => {
                f.paragraph = read_ppr(c, ctx, w);
                f.paragraph.style = None;
                f.paragraph.run_defaults = None;
            }
            "rPr" => f.run = read_rpr(c, ctx, w),
            "tcPr" => f.cell = read_tc_pr(c, ctx, w),
            "tblPr" | "trPr" => {
                if c.elements().next().is_some() {
                    w.add(format!(
                        "{ctx}: conditional table/row formatting {} dropped",
                        c.qname()
                    ));
                }
            }
            _ => w.add(format!("{ctx}: {} dropped", c.qname())),
        }
    }
    Some(f)
}

/// Styles that Word shows in its quick style gallery.
fn is_quick_style(id: &str) -> bool {
    matches!(
        id,
        "Normal" | "Title" | "Subtitle" | "Quote" | "ListParagraph"
    ) || id
        .strip_prefix("Heading")
        .is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit())
}

/// Writes `styles.xml`: document defaults and all styles in order.
pub(crate) fn write_styles(sheet: &StyleSheet, scheme: &ColorScheme) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("w:styles", &[("xmlns:w", W_NS)]);
    x.start("w:docDefaults", &[]);
    x.start("w:rPrDefault", &[]);
    if sheet.defaults.run.is_empty() {
        x.empty("w:rPr", &[]);
    } else {
        write_rpr(&mut x, &sheet.defaults.run, scheme);
    }
    x.end("w:rPrDefault");
    x.start("w:pPrDefault", &[]);
    let mut pdef = sheet.defaults.paragraph.clone();
    pdef.style = None;
    if pdef.is_empty() {
        x.empty("w:pPr", &[]);
    } else {
        write_ppr(&mut x, &pdef, scheme);
    }
    x.end("w:pPrDefault");
    x.end("w:docDefaults");
    for s in &sheet.styles {
        let kind = match s.kind {
            StyleKind::Paragraph => "paragraph",
            StyleKind::Character => "character",
            StyleKind::Table => "table",
        };
        let mut attrs = vec![("w:type", kind)];
        if s.is_default {
            attrs.push(("w:default", "1"));
        }
        attrs.push(("w:styleId", &s.id));
        x.start("w:style", &attrs);
        x.val("w:name", &s.name);
        if let Some(b) = &s.based_on {
            x.val("w:basedOn", b);
        }
        if let Some(n) = &s.next {
            x.val("w:next", n);
        }
        if s.kind == StyleKind::Paragraph && is_quick_style(&s.id) {
            x.empty("w:qFormat", &[]);
        }
        if s.kind != StyleKind::Character {
            let mut p = s.paragraph.clone();
            p.style = None;
            p.run_defaults = None;
            write_ppr(&mut x, &p, scheme);
        }
        write_rpr(&mut x, &s.run, scheme);
        if let Some(t) = s.table.as_ref().filter(|_| s.kind == StyleKind::Table) {
            write_table_style(&mut x, t, scheme);
        }
        x.end("w:style");
    }
    x.end("w:styles");
    x.finish()
}

/// `w:tblPr`, `w:tcPr` and `w:tblStylePr` of a table style.
fn write_table_style(x: &mut XmlOut, t: &TableStyle, scheme: &ColorScheme) {
    let mut probe = t.table.clone();
    probe.style = None;
    probe.look = None;
    probe.col_widths.clear();
    if !probe.is_empty() || t.row_band_size.is_some() || t.col_band_size.is_some() {
        write_tbl_pr(x, &probe, scheme, (t.row_band_size, t.col_band_size));
    }
    write_tc_pr(x, &t.cell, 1, None, scheme);
    for f in &t.conditional {
        x.start("w:tblStylePr", &[("w:type", f.kind.docx_name())]);
        let mut p = f.paragraph.clone();
        p.style = None;
        p.run_defaults = None;
        write_ppr(x, &p, scheme);
        write_rpr(x, &f.run, scheme);
        write_tc_pr(x, &f.cell, 1, None, scheme);
        x.end("w:tblStylePr");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_defaults_roundtrip() {
        let sheet = StyleSheet::office_defaults();
        let xml = write_styles(&sheet, &ColorScheme::default());
        let s = String::from_utf8(xml.clone()).unwrap();
        assert!(s.contains(r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>"#), "{s}");
        assert!(s.contains(r#"w:themeColor="accent1" w:themeShade="BF""#));
        let mut w = Warnings::default();
        let back = read_styles(&xml, "styles", &mut w).unwrap();
        assert!(w.into_vec().is_empty());
        assert_eq!(back, sheet);
    }

    #[test]
    fn reads_libreoffice_styles() {
        let xml = br#"<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr>
            <w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:eastAsia="X"/><w:kern w:val="2"/>
            <w:sz w:val="22"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
            <w:pPrDefault><w:pPr><w:suppressAutoHyphens w:val="true"/></w:pPr></w:pPrDefault></w:docDefaults>
            <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Heading"/>
            <w:next w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
            <w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
            <w:style w:type="numbering" w:styleId="L"><w:name w:val="L"/></w:style>
            <w:style w:type="table" w:styleId="T"><w:name w:val="T"/><w:tblPr/></w:style></w:styles>"#;
        let mut w = Warnings::default();
        let sheet = read_styles(xml, "styles", &mut w).unwrap();
        assert_eq!(w.into_vec().len(), 1);
        assert_eq!(sheet.defaults.run.size.unwrap().pt(), 11.0);
        assert!(sheet.defaults.paragraph.is_empty());
        let h1 = sheet.get("Heading1").unwrap();
        assert_eq!(h1.name, "heading 1");
        assert_eq!(h1.based_on.as_deref(), Some("Heading"));
        assert_eq!(h1.paragraph.numbering.unwrap().num_id, 1);
        assert_eq!(h1.run.bold, Some(true));
        assert_eq!(sheet.get("T").unwrap().kind, StyleKind::Table);
        assert!(sheet.get("L").is_none());
    }
}
