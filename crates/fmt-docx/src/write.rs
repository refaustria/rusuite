//! [`Document`] → `.docx`. Every part is regenerated (only the theme and
//! settings parts may come from [`DocxContext`]); the output is
//! deterministic.

use std::collections::HashMap;
use std::io::Cursor;

use core_model::ColorScheme;
use fmt_ooxml::{Package, PartName, Relationships, OFFICE_DOCUMENT_REL};
use model_text::{
    Block, BreakKind, Document, HeightRule, Inline, InlineImage, MediaId, Orientation, Paragraph,
    Run, Table, TableWidth, VAlign,
};

use crate::numbering::{write_numbering, W_NS};
use crate::props::{
    write_borders, write_cell_margins, write_ppr, write_rpr, write_shading, write_width,
};
use crate::styles::write_styles;
use crate::theme::default_theme_xml;
use crate::xml::XmlOut;
use crate::{DocxContext, Error, Result};

const CT_DOCUMENT: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CT_STYLES: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";
const CT_NUMBERING: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
const CT_SETTINGS: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";
const CT_THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";
const CT_CORE: &str = "application/vnd.openxmlformats-package.core-properties+xml";
const CT_APP: &str = "application/vnd.openxmlformats-officedocument.extended-properties+xml";

const REL_BASE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_CORE: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";

const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP: &str = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";

fn rel(kind: &str) -> String {
    format!("{REL_BASE}/{kind}")
}

/// Writes `doc` as `.docx` bytes with the built-in theme and settings.
pub fn write(doc: &Document) -> Result<Vec<u8>> {
    write_with_context(doc, &DocxContext::default())
}

/// Writes `doc` as `.docx` bytes, reusing the theme and settings parts and
/// the numbering layout from `ctx` (as returned by
/// [`read_with_context`](crate::read_with_context)).
///
/// Fails with [`Error::InvalidDocument`] if an image references media that
/// is not in the document's store. Tables without rows and rows without
/// cells are not written (Word rejects them).
pub fn write_with_context(doc: &Document, ctx: &DocxContext) -> Result<Vec<u8>> {
    let theme = ctx.theme_or_default();
    let scheme = &theme.colors;
    let pn = PartName::new;

    let mut rels = Relationships::new();
    rels.add(rel("styles"), "styles.xml");
    rels.add(rel("settings"), "settings.xml");
    rels.add(rel("theme"), "theme/theme1.xml");
    let numbering_xml = write_numbering(&doc.numbering, ctx);
    if numbering_xml.is_some() {
        rels.add(rel("numbering"), "numbering.xml");
    }

    let mut w = DocWriter {
        x: XmlOut::new(),
        doc,
        scheme,
        rels,
        media: HashMap::new(),
        media_parts: Vec::new(),
        next_docpr: 1,
    };
    w.document()?;
    let DocWriter {
        x,
        rels,
        media_parts,
        ..
    } = w;

    let main = pn("/word/document.xml")?;
    let mut pkg = Package::new();
    pkg.insert_part(main.clone(), CT_DOCUMENT, x.finish());
    pkg.insert_part(
        pn("/word/styles.xml")?,
        CT_STYLES,
        write_styles(&doc.styles, scheme),
    );
    pkg.insert_part(
        pn("/word/settings.xml")?,
        CT_SETTINGS,
        ctx.settings_xml
            .clone()
            .unwrap_or_else(default_settings_xml),
    );
    pkg.insert_part(
        pn("/word/theme/theme1.xml")?,
        CT_THEME,
        ctx.theme_xml.clone().unwrap_or_else(default_theme_xml),
    );
    if let Some(xml) = numbering_xml {
        pkg.insert_part(pn("/word/numbering.xml")?, CT_NUMBERING, xml);
    }
    for (name, content_type, data) in media_parts {
        pkg.insert_part(PartName::new(format!("/word/{name}"))?, content_type, data);
    }
    pkg.set_relationships(main, rels);
    pkg.insert_part(pn("/docProps/core.xml")?, CT_CORE, core_xml());
    pkg.insert_part(pn("/docProps/app.xml")?, CT_APP, app_xml());
    let root = pkg.package_relationships_mut();
    root.add(OFFICE_DOCUMENT_REL, "word/document.xml");
    root.add(REL_CORE, "docProps/core.xml");
    root.add(rel("extended-properties"), "docProps/app.xml");
    Ok(pkg.write(Cursor::new(Vec::new()))?.into_inner())
}

/// File extension for a media content type.
fn extension_of(content_type: &str) -> &str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpeg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        "image/x-emf" | "image/emf" => "emf",
        "image/x-wmf" | "image/wmf" => "wmf",
        _ => "bin",
    }
}

struct DocWriter<'a> {
    x: XmlOut,
    doc: &'a Document,
    scheme: &'a ColorScheme,
    rels: Relationships,
    /// Media id → relationship id, in first-reference order.
    media: HashMap<MediaId, String>,
    /// (`media/imageN.ext`, content type, bytes).
    media_parts: Vec<(String, String, Vec<u8>)>,
    next_docpr: u32,
}

impl DocWriter<'_> {
    fn document(&mut self) -> Result<()> {
        self.x.start(
            "w:document",
            &[
                ("xmlns:w", W_NS),
                ("xmlns:r", NS_R),
                ("xmlns:wp", NS_WP),
                ("xmlns:a", NS_A),
                ("xmlns:pic", NS_PIC),
            ],
        );
        self.x.start("w:body", &[]);
        self.blocks(&self.doc.body)?;
        self.section();
        self.x.end("w:body");
        self.x.end("w:document");
        Ok(())
    }

    /// Blocks, followed by an empty paragraph if they do not end with one
    /// (Word requires a paragraph at the end of the body and every cell).
    fn blocks(&mut self, blocks: &[Block]) -> Result<()> {
        for b in blocks {
            match b {
                Block::Paragraph(p) => self.paragraph(p)?,
                Block::Table(t) => self.table(t)?,
            }
        }
        if !matches!(blocks.last(), Some(Block::Paragraph(_))) {
            self.x.empty("w:p", &[]);
        }
        Ok(())
    }

    fn paragraph(&mut self, p: &Paragraph) -> Result<()> {
        self.x.start("w:p", &[]);
        write_ppr(&mut self.x, &p.props, self.scheme);
        for inline in &p.inlines {
            match inline {
                Inline::Run(run) => self.run(run),
                Inline::Image(img) => self.image(img)?,
                Inline::Break(kind) => {
                    self.x.start("w:r", &[]);
                    self.brk(*kind);
                    self.x.end("w:r");
                }
            }
        }
        self.x.end("w:p");
        Ok(())
    }

    fn brk(&mut self, kind: BreakKind) {
        match kind {
            BreakKind::Line => self.x.empty("w:br", &[]),
            BreakKind::Page => self.x.empty("w:br", &[("w:type", "page")]),
        }
    }

    fn text(&mut self, s: &str) {
        if s.is_empty() {
            return;
        }
        let preserve = s.starts_with(char::is_whitespace)
            || s.ends_with(char::is_whitespace)
            || s.contains("  ");
        let attrs: &[(&str, &str)] = if preserve {
            &[("xml:space", "preserve")]
        } else {
            &[]
        };
        self.x.text_el("w:t", attrs, s);
    }

    /// A run; tabs become `w:tab`, `\n`/U+000B line breaks and U+000C page
    /// breaks become `w:br`.
    fn run(&mut self, run: &Run) {
        if run.text.is_empty() {
            return;
        }
        self.x.start("w:r", &[]);
        write_rpr(&mut self.x, &run.props, self.scheme);
        let mut seg = String::new();
        for c in run.text.chars() {
            let special = match c {
                '\t' => Some(None),
                '\n' | '\u{B}' => Some(Some(BreakKind::Line)),
                '\u{C}' => Some(Some(BreakKind::Page)),
                '\r' => continue,
                _ => None,
            };
            match special {
                None => seg.push(c),
                Some(kind) => {
                    self.text(&std::mem::take(&mut seg));
                    match kind {
                        None => self.x.empty("w:tab", &[]),
                        Some(k) => self.brk(k),
                    }
                }
            }
        }
        self.text(&seg);
        self.x.end("w:r");
    }

    /// Relationship id of `media`, adding the media part on first use.
    fn media_rel(&mut self, media: MediaId) -> Result<String> {
        if let Some(rid) = self.media.get(&media) {
            return Ok(rid.clone());
        }
        let m = self.doc.media.get(media).ok_or_else(|| {
            Error::InvalidDocument(format!("image references missing media {}", media.0))
        })?;
        let name = format!(
            "media/image{}.{}",
            self.media_parts.len() + 1,
            extension_of(&m.content_type)
        );
        let rid = self.rels.add(rel("image"), name.clone()).id.clone();
        self.media_parts
            .push((name, m.content_type.clone(), m.data.clone()));
        self.media.insert(media, rid.clone());
        Ok(rid)
    }

    fn image(&mut self, img: &InlineImage) -> Result<()> {
        let rid = self.media_rel(img.media)?;
        let id = self.next_docpr.to_string();
        self.next_docpr += 1;
        let (cx, cy) = (
            img.width.0.max(0).to_string(),
            img.height.0.max(0).to_string(),
        );
        let x = &mut self.x;
        x.start("w:r", &[]);
        x.start("w:drawing", &[]);
        x.start(
            "wp:inline",
            &[
                ("distT", "0"),
                ("distB", "0"),
                ("distL", "0"),
                ("distR", "0"),
            ],
        );
        x.empty("wp:extent", &[("cx", &cx), ("cy", &cy)]);
        x.empty(
            "wp:effectExtent",
            &[("l", "0"), ("t", "0"), ("r", "0"), ("b", "0")],
        );
        let mut doc_pr = vec![
            ("id", id.as_str()),
            ("name", img.name.as_deref().unwrap_or("")),
        ];
        if let Some(alt) = &img.alt {
            doc_pr.push(("descr", alt));
        }
        x.empty("wp:docPr", &doc_pr);
        x.start("wp:cNvGraphicFramePr", &[]);
        x.empty("a:graphicFrameLocks", &[("noChangeAspect", "1")]);
        x.end("wp:cNvGraphicFramePr");
        x.start("a:graphic", &[]);
        x.start("a:graphicData", &[("uri", NS_PIC)]);
        x.start("pic:pic", &[]);
        x.start("pic:nvPicPr", &[]);
        x.empty(
            "pic:cNvPr",
            &[("id", "0"), ("name", img.name.as_deref().unwrap_or(""))],
        );
        x.empty("pic:cNvPicPr", &[]);
        x.end("pic:nvPicPr");
        x.start("pic:blipFill", &[]);
        x.empty("a:blip", &[("r:embed", &rid)]);
        x.start("a:stretch", &[]);
        x.empty("a:fillRect", &[]);
        x.end("a:stretch");
        x.end("pic:blipFill");
        x.start("pic:spPr", &[]);
        x.start("a:xfrm", &[]);
        x.empty("a:off", &[("x", "0"), ("y", "0")]);
        x.empty("a:ext", &[("cx", &cx), ("cy", &cy)]);
        x.end("a:xfrm");
        x.start("a:prstGeom", &[("prst", "rect")]);
        x.empty("a:avLst", &[]);
        x.end("a:prstGeom");
        x.end("pic:spPr");
        x.end("pic:pic");
        x.end("a:graphicData");
        x.end("a:graphic");
        x.end("wp:inline");
        x.end("w:drawing");
        x.end("w:r");
        Ok(())
    }

    fn table(&mut self, t: &Table) -> Result<()> {
        let rows: Vec<_> = t.rows.iter().filter(|r| !r.cells.is_empty()).collect();
        if rows.is_empty() {
            return Ok(());
        }
        let scheme = self.scheme;
        self.x.start("w:tbl", &[]);
        self.x.start("w:tblPr", &[]);
        if let Some(w) = t.props.width {
            write_width(&mut self.x, "w:tblW", w);
        }
        if let Some(b) = &t.props.borders {
            write_borders(&mut self.x, "w:tblBorders", b, scheme);
        }
        if let Some(m) = &t.props.cell_margins {
            write_cell_margins(&mut self.x, m);
        }
        self.x.end("w:tblPr");
        self.x.start("w:tblGrid", &[]);
        for w in grid(t, self.doc.page.content_width().0) {
            self.x.empty("w:gridCol", &[("w:w", &w.to_string())]);
        }
        self.x.end("w:tblGrid");
        for row in rows {
            self.x.start("w:tr", &[]);
            let rp = &row.props;
            if !rp.is_empty() {
                self.x.start("w:trPr", &[]);
                if let Some(h) = rp.height {
                    let rule = match h.rule {
                        HeightRule::AtLeast => "atLeast",
                        HeightRule::Exact => "exact",
                    };
                    self.x.empty(
                        "w:trHeight",
                        &[("w:val", &h.value.0.to_string()), ("w:hRule", rule)],
                    );
                }
                if rp.header {
                    self.x.empty("w:tblHeader", &[]);
                }
                self.x.end("w:trPr");
            }
            for cell in &row.cells {
                self.x.start("w:tc", &[]);
                let cp = &cell.props;
                if !cp.is_empty() {
                    self.x.start("w:tcPr", &[]);
                    if let Some(w) = cp.width {
                        write_width(&mut self.x, "w:tcW", w);
                    }
                    if let Some(b) = &cp.borders {
                        write_borders(&mut self.x, "w:tcBorders", b, scheme);
                    }
                    if let Some(c) = &cp.shading {
                        write_shading(&mut self.x, c, scheme);
                    }
                    if let Some(v) = cp.vertical_align {
                        let v = match v {
                            VAlign::Top => "top",
                            VAlign::Center => "center",
                            VAlign::Bottom => "bottom",
                        };
                        self.x.val("w:vAlign", v);
                    }
                    self.x.end("w:tcPr");
                }
                self.blocks(&cell.blocks)?;
                self.x.end("w:tc");
            }
            self.x.end("w:tr");
        }
        self.x.end("w:tbl");
        Ok(())
    }

    fn section(&mut self) {
        let p = &self.doc.page;
        let x = &mut self.x;
        x.start("w:sectPr", &[]);
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
        x.end("w:sectPr");
    }
}

/// Grid column widths: the table's own, or derived from the first row's
/// fixed cell widths, or the text width split evenly.
fn grid(t: &Table, content_width: i32) -> Vec<i32> {
    if !t.props.col_widths.is_empty() {
        return t.props.col_widths.iter().map(|w| w.0.max(0)).collect();
    }
    let cols = t
        .rows
        .iter()
        .map(|r| r.cells.len())
        .max()
        .unwrap_or(0)
        .max(1);
    let first: Option<Vec<i32>> = t.rows.first().and_then(|r| {
        (r.cells.len() == cols)
            .then(|| {
                r.cells
                    .iter()
                    .map(|c| match c.props.width {
                        Some(TableWidth::Twips(w)) => Some(w.0.max(0)),
                        _ => None,
                    })
                    .collect()
            })
            .flatten()
    });
    first.unwrap_or_else(|| vec![content_width.max(cols as i32) / cols as i32; cols])
}

fn default_settings_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("w:settings", &[("xmlns:w", W_NS)]);
    x.start("w:compat", &[]);
    x.empty(
        "w:compatSetting",
        &[
            ("w:name", "compatibilityMode"),
            ("w:uri", "http://schemas.microsoft.com/office/word"),
            ("w:val", "15"),
        ],
    );
    x.end("w:compat");
    x.end("w:settings");
    x.finish()
}

fn core_xml() -> Vec<u8> {
    // No timestamps: core crates have no clock (ADR 0005), and fixed fake
    // dates would be misleading. Both are optional.
    let mut x = XmlOut::new();
    x.empty(
        "cp:coreProperties",
        &[
            (
                "xmlns:cp",
                "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
            ),
            ("xmlns:dc", "http://purl.org/dc/elements/1.1/"),
            ("xmlns:dcterms", "http://purl.org/dc/terms/"),
            ("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"),
        ],
    );
    x.finish()
}

fn app_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "Properties",
        &[(
            "xmlns",
            "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
        )],
    );
    x.text_el("Application", &[], "Rusuite");
    x.end("Properties");
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::units::{Emu, Twips};
    use core_model::RunProperties;
    use model_text::{
        NumberingDef, NumberingRef, PageSetup, ParagraphProperties, TableCell, TableProperties,
        TableRow,
    };

    fn para(doc: &mut Document, inlines: Vec<Inline>) -> Block {
        let mut p = Paragraph::new(doc.alloc_id());
        p.inlines = inlines;
        Block::Paragraph(p)
    }

    #[test]
    fn built_document_roundtrips() {
        let mut doc = Document::empty(
            model_text::StyleSheet::office_defaults(),
            PageSetup::letter().with_orientation(Orientation::Landscape),
        );
        let png = doc.media.insert("image/png", vec![0x89, b'P', b'N', b'G']);
        doc.numbering.insert(NumberingDef::bullet_default(1));
        let bold = RunProperties {
            bold: Some(true),
            ..Default::default()
        };
        let p1 = para(
            &mut doc,
            vec![
                Inline::Run(Run::with_props("Bold ", bold)),
                Inline::Run(Run::new("a\tb")),
                Inline::Break(BreakKind::Line),
                Inline::Image(InlineImage {
                    media: png,
                    width: Emu(914_400),
                    height: Emu(457_200),
                    alt: Some("A <logo>".into()),
                    name: None,
                }),
                Inline::Break(BreakKind::Page),
            ],
        );
        let mut item = Paragraph::with_text(doc.alloc_id(), "  item  ");
        item.props = ParagraphProperties {
            style: Some("ListParagraph".into()),
            numbering: Some(NumberingRef {
                num_id: 1,
                level: 0,
            }),
            ..Default::default()
        };
        let cell_p = Block::Paragraph(Paragraph::with_text(doc.alloc_id(), "cell"));
        let table = Block::Table(Table {
            id: doc.alloc_id(),
            props: TableProperties {
                width: Some(TableWidth::Pct(5000)),
                col_widths: vec![Twips(2000)],
                ..Default::default()
            },
            rows: vec![TableRow {
                id: doc.alloc_id(),
                props: Default::default(),
                cells: vec![TableCell {
                    id: doc.alloc_id(),
                    props: Default::default(),
                    blocks: vec![cell_p],
                }],
            }],
        });
        doc.body = vec![p1, Block::Paragraph(item), table];
        doc.normalize();

        let bytes = write(&doc).unwrap();
        assert_eq!(bytes, write(&doc).unwrap(), "deterministic");
        let out = crate::read_with_context(&bytes).unwrap();
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
        let back = out.document;
        assert_eq!(back.media, doc.media);
        assert_eq!(back.page, doc.page);
        assert_eq!(back.numbering, doc.numbering);
        assert_eq!(back.plain_text(), doc.plain_text());
        assert_eq!(back.body.len(), doc.body.len());
        let Block::Paragraph(p) = &back.body[0] else {
            panic!()
        };
        assert_eq!(
            p.inlines,
            match &doc.body[0] {
                Block::Paragraph(p) => p.inlines.clone(),
                _ => unreachable!(),
            }
        );
    }

    #[test]
    fn missing_media_is_an_error() {
        let mut doc = Document::new();
        let p = para(
            &mut doc,
            vec![Inline::Image(InlineImage {
                media: MediaId(7),
                width: Emu(1),
                height: Emu(1),
                alt: None,
                name: None,
            })],
        );
        doc.body = vec![p];
        assert!(matches!(write(&doc), Err(Error::InvalidDocument(_))));
    }

    #[test]
    fn grid_fallbacks() {
        let mut doc = Document::new();
        let cell = |doc: &mut Document, w: Option<TableWidth>| TableCell {
            id: doc.alloc_id(),
            props: model_text::CellProperties {
                width: w,
                ..Default::default()
            },
            blocks: vec![],
        };
        let c1 = cell(&mut doc, Some(TableWidth::Twips(Twips(1000))));
        let c2 = cell(&mut doc, Some(TableWidth::Twips(Twips(3000))));
        let mut t = Table {
            id: doc.alloc_id(),
            props: TableProperties::default(),
            rows: vec![TableRow {
                id: doc.alloc_id(),
                props: Default::default(),
                cells: vec![c1, c2],
            }],
        };
        assert_eq!(grid(&t, 9000), vec![1000, 3000]);
        t.rows[0].cells[1].props.width = None;
        assert_eq!(grid(&t, 9000), vec![4500, 4500]);
    }
}
