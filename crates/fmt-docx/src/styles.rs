//! `word/styles.xml` ↔ [`model_text::StyleSheet`].

use core_model::{ColorScheme, RunProperties};
use model_text::{
    CellProperties, ConditionalFormat, ConditionalKind, Defaults, LatentException, LatentStyles,
    ParagraphProperties, Style, StyleKind, StyleSheet, TableStyle,
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
                        w.warn(
                            "docx.styles.duplicateId",
                            "{part}: duplicate style id {id} dropped",
                            &[("part", &part), ("id", &format!("{:?}", style.id))],
                        );
                    } else {
                        sheet.styles.push(style);
                    }
                }
            }
            "latentStyles" => sheet.latent = Some(read_latent(el)),
            _ => w.warn(
                "docx.styles.elementDropped",
                "{part}: {name} dropped",
                &[("part", &part), ("name", &el.qname())],
            ),
        }
    }
    Ok(sheet)
}

/// `w:latentStyles` → the model (unknown attributes are ignored).
fn read_latent(el: &El) -> LatentStyles {
    let b = |e: &El, name: &str| e.attr(name).and_then(parse_bool);
    let n = |e: &El, name: &str| e.attr(name).and_then(parse_u32);
    LatentStyles {
        def_locked_state: b(el, "defLockedState"),
        def_ui_priority: n(el, "defUIPriority"),
        def_semi_hidden: b(el, "defSemiHidden"),
        def_unhide_when_used: b(el, "defUnhideWhenUsed"),
        def_q_format: b(el, "defQFormat"),
        count: n(el, "count"),
        exceptions: el
            .elements()
            .filter(|c| c.name == "lsdException")
            .filter_map(|c| {
                Some(LatentException {
                    name: c.attr("name")?.to_owned(),
                    locked: b(c, "locked"),
                    ui_priority: n(c, "uiPriority"),
                    semi_hidden: b(c, "semiHidden"),
                    unhide_when_used: b(c, "unhideWhenUsed"),
                    q_format: b(c, "qFormat"),
                })
            })
            .collect(),
    }
}

/// `w:latentStyles` (after the document defaults, before the styles).
fn write_latent(x: &mut XmlOut, l: &LatentStyles) {
    let flag = |v: bool| if v { "1" } else { "0" };
    let mut attrs: Vec<(&str, String)> = Vec::new();
    let push_b = |attrs: &mut Vec<(&str, String)>, name, v: Option<bool>| {
        if let Some(v) = v {
            attrs.push((name, flag(v).to_owned()));
        }
    };
    push_b(&mut attrs, "w:defLockedState", l.def_locked_state);
    if let Some(p) = l.def_ui_priority {
        attrs.push(("w:defUIPriority", p.to_string()));
    }
    push_b(&mut attrs, "w:defSemiHidden", l.def_semi_hidden);
    push_b(&mut attrs, "w:defUnhideWhenUsed", l.def_unhide_when_used);
    push_b(&mut attrs, "w:defQFormat", l.def_q_format);
    if let Some(c) = l.count {
        attrs.push(("w:count", c.to_string()));
    }
    let refs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    if l.exceptions.is_empty() {
        x.empty("w:latentStyles", &refs);
        return;
    }
    x.start("w:latentStyles", &refs);
    for e in &l.exceptions {
        let mut a: Vec<(&str, String)> = vec![("w:name", e.name.clone())];
        push_b(&mut a, "w:locked", e.locked);
        if let Some(p) = e.ui_priority {
            a.push(("w:uiPriority", p.to_string()));
        }
        push_b(&mut a, "w:semiHidden", e.semi_hidden);
        push_b(&mut a, "w:unhideWhenUsed", e.unhide_when_used);
        push_b(&mut a, "w:qFormat", e.q_format);
        let refs: Vec<(&str, &str)> = a.iter().map(|(k, v)| (*k, v.as_str())).collect();
        x.empty("w:lsdException", &refs);
    }
    x.end("w:latentStyles");
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
        // A paragraph style with a `w:link` is a linked style.
        "paragraph" if el.child("link").and_then(El::val).is_some() => StyleKind::Linked,
        "paragraph" => StyleKind::Paragraph,
        "character" => StyleKind::Character,
        "table" => StyleKind::Table,
        "numbering" => StyleKind::Numbering,
        other => {
            w.warn(
                "docx.styles.kindDropped",
                "{part}: {kind} style {id} dropped",
                &[
                    ("part", &part),
                    ("kind", &other),
                    ("id", &format!("{id:?}")),
                ],
            );
            return None;
        }
    };
    let ctx = format!("{part} (style {id})");
    let child_val = |name: &str| el.child(name).and_then(El::val).map(str::to_owned);
    // On/off children: present = on unless `w:val` says otherwise.
    let flag = |name: &str| {
        el.child(name)
            .is_some_and(|c| c.val().and_then(parse_bool).unwrap_or(true))
    };
    let mut style = Style {
        based_on: child_val("basedOn"),
        next: child_val("next"),
        link: child_val("link"),
        is_default: el.attr("default").and_then(parse_bool).unwrap_or(false),
        quick_format: flag("qFormat"),
        priority: child_val("uiPriority").as_deref().and_then(parse_u32),
        hidden: flag("hidden"),
        semi_hidden: flag("semiHidden"),
        unhide_when_used: flag("unhideWhenUsed"),
        custom: el.attr("customStyle").and_then(parse_bool).unwrap_or(false),
        auto_redefine: flag("autoRedefine"),
        table: None,
        ..Style::new(&id, &child_val("name").unwrap_or_else(|| id.clone()), kind)
    };
    let mut table = TableStyle::default();
    for c in el.elements() {
        match c.name.as_str() {
            "pPr" => {
                style.paragraph = read_ppr(c, &ctx, w);
                if style.paragraph.style.take().is_some() {
                    w.warn(
                        "docx.styles.pStyleInStyle",
                        "{ctx}: w:pStyle inside a style dropped",
                        &[("ctx", &ctx)],
                    );
                }
                if style.paragraph.run_defaults.take().is_some() {
                    w.warn(
                        "docx.styles.markFormatting",
                        "{ctx}: paragraph mark formatting dropped",
                        &[("ctx", &ctx)],
                    );
                }
            }
            "rPr" => style.run = read_rpr(c, &ctx, w),
            "tblPr" if kind != StyleKind::Table => {}
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
                    w.warn(
                        "docx.styles.tableRowFormatting",
                        "{ctx}: table style row formatting dropped",
                        &[("ctx", &ctx)],
                    );
                }
            }
            "tblStylePr" => {
                if let Some(f) = read_conditional(c, &ctx, w) {
                    table.conditional.retain(|o| o.kind != f.kind);
                    table.conditional.push(f);
                }
            }
            name if SILENT_STYLE.contains(&name) => {}
            _ => w.warn(
                "docx.styles.childDropped",
                "{ctx}: {name} dropped",
                &[("ctx", &ctx), ("name", &c.qname())],
            ),
        }
    }
    if style.kind == StyleKind::Table && !table.is_empty() {
        style.table = Some(table);
    } else if !table.is_empty() {
        w.warn(
            "docx.styles.tableFormattingOnNonTable",
            "{ctx}: table formatting of a non-table style dropped",
            &[("ctx", &ctx)],
        );
    }
    Some(style)
}

/// `w:tblStylePr` → conditional format (`None` for unknown types).
fn read_conditional(el: &El, ctx: &str, w: &mut Warnings) -> Option<ConditionalFormat> {
    let Some(kind) = el.attr("type").and_then(ConditionalKind::from_docx) else {
        w.warn(
            "docx.styles.conditionalDropped",
            "{ctx}: conditional table formatting {kind} dropped",
            &[("ctx", &ctx), ("kind", &format!("{:?}", el.attr("type")))],
        );
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
                    w.warn(
                        "docx.styles.conditionalChildDropped",
                        "{ctx}: conditional table/row formatting {name} dropped",
                        &[("ctx", &ctx), ("name", &c.qname())],
                    );
                }
            }
            _ => w.warn(
                "docx.styles.childDropped",
                "{ctx}: {name} dropped",
                &[("ctx", &ctx), ("name", &c.qname())],
            ),
        }
    }
    Some(f)
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
    if let Some(l) = &sheet.latent {
        write_latent(&mut x, l);
    }
    for s in &sheet.styles {
        let mut attrs = vec![("w:type", s.kind.docx_type())];
        if s.is_default {
            attrs.push(("w:default", "1"));
        }
        if s.custom {
            attrs.push(("w:customStyle", "1"));
        }
        attrs.push(("w:styleId", &s.id));
        x.start("w:style", &attrs);
        // Word's (CT_Style) child order.
        x.val("w:name", &s.name);
        if let Some(b) = &s.based_on {
            x.val("w:basedOn", b);
        }
        if let Some(n) = &s.next {
            x.val("w:next", n);
        }
        if let Some(l) = &s.link {
            x.val("w:link", l);
        }
        if s.auto_redefine {
            x.empty("w:autoRedefine", &[]);
        }
        if s.hidden {
            x.empty("w:hidden", &[]);
        }
        if let Some(p) = s.priority {
            x.val("w:uiPriority", &p.to_string());
        }
        if s.semi_hidden {
            x.empty("w:semiHidden", &[]);
        }
        if s.unhide_when_used {
            x.empty("w:unhideWhenUsed", &[]);
        }
        if s.quick_format {
            x.empty("w:qFormat", &[]);
        }
        if s.kind == StyleKind::Numbering {
            // Numbering styles carry only their list reference.
            if let Some(n) = s.paragraph.numbering {
                let p = ParagraphProperties {
                    numbering: Some(n),
                    ..Default::default()
                };
                write_ppr(&mut x, &p, scheme);
            }
            x.end("w:style");
            continue;
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
        assert!(s.contains(r#"<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1Char"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr>"#));
        assert!(s.contains(r#"<w:style w:type="character" w:customStyle="1" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Heading1"/><w:uiPriority w:val="9"/><w:rPr>"#));
        assert!(s.contains(r#"<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>"#));
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
        assert!(w.into_vec().is_empty());
        assert_eq!(sheet.defaults.run.size.unwrap().pt(), 11.0);
        // "Don't hyphenate" is kept (Layout › Hyphenation respects it).
        assert_eq!(sheet.defaults.paragraph.suppress_auto_hyphens, Some(true));
        assert_eq!(
            ParagraphProperties {
                suppress_auto_hyphens: None,
                ..sheet.defaults.paragraph.clone()
            },
            ParagraphProperties::default()
        );
        let h1 = sheet.get("Heading1").unwrap();
        assert_eq!(h1.name, "heading 1");
        assert_eq!(h1.based_on.as_deref(), Some("Heading"));
        assert_eq!(h1.paragraph.numbering.unwrap().num_id, 1);
        assert_eq!(h1.run.bold, Some(true));
        assert_eq!(sheet.get("T").unwrap().kind, StyleKind::Table);
        assert_eq!(sheet.get("L").unwrap().kind, StyleKind::Numbering);
        assert!(h1.quick_format);
    }

    const WORD_STYLES: &[u8] = br#"<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault>
        <w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
        <w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:count="376"><w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/></w:latentStyles>
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
        <w:style w:type="paragraph" w:customStyle="1" w:styleId="Memo"><w:name w:val="Memo"/><w:basedOn w:val="Normal"/><w:next w:val="MemoBody"/><w:link w:val="MemoChar"/><w:autoRedefine/><w:uiPriority w:val="5"/><w:qFormat/><w:rsid w:val="00AB12"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
        <w:style w:type="paragraph" w:customStyle="1" w:styleId="MemoBody"><w:name w:val="Memo Body"/><w:basedOn w:val="Normal"/><w:hidden/><w:semiHidden w:val="0"/><w:unhideWhenUsed/></w:style>
        <w:style w:type="character" w:customStyle="1" w:styleId="MemoChar"><w:name w:val="Memo Char"/><w:link w:val="Memo"/><w:semiHidden/><w:rPr><w:b/></w:rPr></w:style>
        </w:styles>"#;

    #[test]
    fn reads_flags_links_and_latent_styles() {
        let mut w = Warnings::default();
        let sheet = read_styles(WORD_STYLES, "styles", &mut w).unwrap();
        assert!(w.into_vec().is_empty());
        assert_eq!(sheet.styles.len(), 4, "latent styles are not styles");
        let latent = sheet.latent.as_ref().unwrap();
        assert_eq!(latent.def_ui_priority, Some(99));
        assert_eq!(latent.count, Some(376));
        assert_eq!(latent.def_locked_state, Some(false));
        assert_eq!(latent.exceptions[0].name, "Normal");
        assert_eq!(latent.exceptions[0].q_format, Some(true));
        // Written back after the defaults and read again unchanged.
        let xml = write_styles(&sheet, &ColorScheme::default());
        let text = String::from_utf8(xml.clone()).unwrap();
        let (d, l, st) = (
            text.find("</w:docDefaults>").unwrap(),
            text.find("<w:latentStyles").unwrap(),
            text.find("<w:style ").unwrap(),
        );
        assert!(d < l && l < st);
        let mut w = Warnings::default();
        assert_eq!(read_styles(&xml, "styles", &mut w).unwrap(), sheet);
        let memo = sheet.get("Memo").unwrap();
        assert_eq!(memo.kind, StyleKind::Linked);
        assert_eq!(memo.link.as_deref(), Some("MemoChar"));
        assert_eq!(memo.next.as_deref(), Some("MemoBody"));
        assert_eq!(memo.priority, Some(5));
        assert!(memo.custom && memo.quick_format && memo.auto_redefine && !memo.hidden);
        let body = sheet.get("MemoBody").unwrap();
        assert_eq!(body.kind, StyleKind::Paragraph);
        assert!(body.hidden && !body.semi_hidden && body.unhide_when_used && !body.quick_format);
        let c = sheet.get("MemoChar").unwrap();
        assert_eq!(c.kind, StyleKind::Character);
        assert!(c.semi_hidden);
        assert_eq!(
            sheet.defaults.paragraph.spacing.unwrap().after,
            Some(core_model::units::Twips(120))
        );
    }

    #[test]
    fn custom_styles_roundtrip_in_order() {
        let mut w = Warnings::default();
        let sheet = read_styles(WORD_STYLES, "styles", &mut w).unwrap();
        let xml = write_styles(&sheet, &ColorScheme::default());
        let s = String::from_utf8(xml.clone()).unwrap();
        assert!(s.contains(r#"<w:style w:type="paragraph" w:customStyle="1" w:styleId="Memo"><w:name w:val="Memo"/><w:basedOn w:val="Normal"/><w:next w:val="MemoBody"/><w:link w:val="MemoChar"/><w:autoRedefine/><w:uiPriority w:val="5"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr>"#), "{s}");
        assert!(s.contains(r#"<w:name w:val="Memo Body"/><w:basedOn w:val="Normal"/><w:hidden/><w:unhideWhenUsed/>"#));
        let order: Vec<&str> = sheet.styles.iter().map(|s| s.id.as_str()).collect();
        let back = read_styles(&xml, "styles", &mut w).unwrap();
        assert_eq!(back, sheet);
        assert_eq!(
            back.styles
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            order
        );
        // stable: writing again gives the same bytes
        assert_eq!(write_styles(&back, &ColorScheme::default()), xml);
    }
}
