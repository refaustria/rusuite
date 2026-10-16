//! [`Document`] → `.docx`. Every part is regenerated (only the theme and
//! settings parts may come from [`DocxContext`]); the output is
//! deterministic.

use std::collections::HashMap;
use std::io::Cursor;

use core_model::units::Twips;
use core_model::{ColorScheme, RunProperties, VerticalAlign};
use fmt_ooxml::theme::office_theme_xml;
use fmt_ooxml::{ct, rel, Package, PartName, Relationships};
use model_text::{
    Anchor, Block, BreakKind, CellProperties, Document, Field, HAlign, HRelative, HeightRule,
    Inline, InlineImage, MediaId, NodeId, NoteKind, NoteRef, Paragraph, Placement, Run, StyleKind,
    Table, TableLayout, TableProperties, TableWidth, Toc, VAlign, VAlignPos, VMerge, VRelative,
    WrapKind, WrapSide,
};
use model_text::{Comment, CommentId};

use crate::numbering::{write_numbering, W_NS};
use crate::props::{
    table_jc_name, write_borders, write_cell_margins, write_margins_as, write_ppr_sect, write_rpr,
    write_rpr_styled, write_shading, write_tbl_look, write_width,
};
use crate::sections::{write_sect_pr, HeaderRef};
use crate::styles::write_styles;
use crate::xml::{WriteVal, XmlOut};
use crate::{DocxContext, Error, Result};

const NS_R: &str = rel::NS;
const NS_WP: &str = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";

/// Relationship type of `word/footnotes.xml`.
pub(crate) const REL_FOOTNOTES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes";
/// Relationship type of `word/endnotes.xml`.
pub(crate) const REL_ENDNOTES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes";
const CT_FOOTNOTES: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
const CT_ENDNOTES: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml";

/// Relationship type of `word/comments.xml`.
pub(crate) const REL_COMMENTS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const CT_COMMENTS: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const REL_COMMENTS_EXTENDED: &str =
    "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
const CT_COMMENTS_EXTENDED: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml";
const REL_COMMENTS_IDS: &str =
    "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds";
const CT_COMMENTS_IDS: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml";
const REL_COMMENTS_EXTENSIBLE: &str =
    "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible";
const CT_COMMENTS_EXTENSIBLE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_W14: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
const NS_W15: &str = "http://schemas.microsoft.com/office/word/2012/wordml";
const NS_W16CID: &str = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const NS_W16CEX: &str = "http://schemas.microsoft.com/office/word/2018/wordml/cex";

/// Writes `doc` as `.docx` bytes with the built-in theme and settings.
pub fn write(doc: &Document) -> Result<Vec<u8>> {
    write_with_context(doc, &DocxContext::default())
}

/// What all parts of one write share.
struct Shared {
    /// Media id → `media/imageN.ext`, in first-reference order.
    media_names: HashMap<MediaId, String>,
    /// (`media/imageN.ext`, content type, bytes).
    media_parts: Vec<(String, String, Vec<u8>)>,
    next_docpr: u32,
    /// Headings that are table-of-contents targets → bookmark (id, name).
    toc_targets: HashMap<NodeId, (u32, String)>,
    /// Model note id → id written to the notes part.
    note_ids: HashMap<u32, i64>,
    /// Comment → `w14:paraId` of its last paragraph (links
    /// `commentsExtended`/`commentsIds` to it).
    comment_para_ids: HashMap<CommentId, String>,
}

/// Writes `doc` as `.docx` bytes, reusing the theme and settings parts
/// from `ctx` (as returned by
/// [`read_with_context`](crate::read_with_context)).
///
/// Fails with [`Error::InvalidDocument`] if an image references media that
/// is not in the document's store. Tables without rows and rows without
/// cells are not written (Word rejects them); references to missing notes
/// are dropped.
pub fn write_with_context(doc: &Document, ctx: &DocxContext) -> Result<Vec<u8>> {
    let theme = ctx.theme_or_default();
    let scheme = &theme.colors;
    let pn = PartName::new;

    // Work on a synced copy if the sections are not in shape (a document
    // built by hand without `normalize`, or `page` changed directly).
    let in_sync = match doc.sections.last() {
        Some(last) => {
            let strip = |p: &model_text::PageSetup| model_text::PageSetup {
                header_text: None,
                footer_text: None,
                ..p.clone()
            };
            strip(&last.page) == strip(&doc.page)
        }
        None => false,
    };
    let owned;
    let doc = if in_sync {
        doc
    } else {
        let mut copy = doc.clone();
        copy.sync_sections();
        owned = copy;
        &owned
    };

    let mut rels = Relationships::new();
    rels.add(rel::STYLES, "styles.xml");
    rels.add(rel::SETTINGS, "settings.xml");
    rels.add(rel::THEME, "theme/theme1.xml");
    let numbering_xml = write_numbering(&doc.numbering, scheme);
    if numbering_xml.is_some() {
        rels.add(rel::NUMBERING, "numbering.xml");
    }

    let foot_sep = ctx.footnote_separators.unwrap_or((-1, 0));
    let end_sep = ctx.endnote_separators.unwrap_or((-1, 0));
    let mut shared = Shared {
        media_names: HashMap::new(),
        media_parts: Vec::new(),
        next_docpr: 1,
        toc_targets: toc_targets(doc),
        note_ids: note_ids(doc, [foot_sep.0, foot_sep.1, end_sep.0, end_sep.1]),
        comment_para_ids: doc
            .comments
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id, format!("{:08X}", 0x1000_0000 + i)))
            .collect(),
    };
    let content_width = doc.page.content_width().0;
    let mut parts: Vec<(String, &str, Vec<u8>, Relationships)> = Vec::new();

    // Notes.
    for (kind, sep, file, rel_type, content_type) in [
        (
            NoteKind::Foot,
            foot_sep,
            "footnotes.xml",
            REL_FOOTNOTES,
            CT_FOOTNOTES,
        ),
        (
            NoteKind::End,
            end_sep,
            "endnotes.xml",
            REL_ENDNOTES,
            CT_ENDNOTES,
        ),
    ] {
        if !doc.notes.iter().any(|n| n.kind == kind) {
            continue;
        }
        let mut w = PartWriter::new(doc, scheme, &mut shared, content_width);
        w.notes(kind, sep)?;
        let (xml, part_rels) = w.finish();
        rels.add(rel_type, file);
        parts.push((file.to_owned(), content_type, xml, part_rels));
    }

    // Comments: the comments part (author, date, initials, text), the
    // threads and "done" flags (`commentsExtended`), durable ids and UTC
    // dates as Word writes them.
    if !doc.comments.is_empty() {
        let mut w = PartWriter::new(doc, scheme, &mut shared, content_width);
        w.comments()?;
        let (xml, part_rels) = w.finish();
        rels.add(REL_COMMENTS, "comments.xml");
        parts.push(("comments.xml".to_owned(), CT_COMMENTS, xml, part_rels));
        for (file, rel_type, content_type, xml) in [
            (
                "commentsExtended.xml",
                REL_COMMENTS_EXTENDED,
                CT_COMMENTS_EXTENDED,
                comments_extended_xml(doc, &shared.comment_para_ids),
            ),
            (
                "commentsIds.xml",
                REL_COMMENTS_IDS,
                CT_COMMENTS_IDS,
                comments_ids_xml(doc, &shared.comment_para_ids),
            ),
            (
                "commentsExtensible.xml",
                REL_COMMENTS_EXTENSIBLE,
                CT_COMMENTS_EXTENSIBLE,
                comments_extensible_xml(doc),
            ),
        ] {
            rels.add(rel_type, file);
            parts.push((file.to_owned(), content_type, xml, Relationships::new()));
        }
    }

    // Headers and footers, per section.
    let mut section_refs: Vec<Vec<HeaderRef>> = Vec::new();
    let mut counts = [0usize; 2];
    for section in &doc.sections {
        let mut refs = Vec::new();
        for footer in [false, true] {
            for (slot, blocks) in section.header_footer(footer).slots() {
                let k = usize::from(footer);
                counts[k] += 1;
                let (name, rel_type, content_type) = if footer {
                    (format!("footer{}.xml", counts[k]), rel::FOOTER, ct::FOOTER)
                } else {
                    (format!("header{}.xml", counts[k]), rel::HEADER, ct::HEADER)
                };
                let mut w = PartWriter::new(doc, scheme, &mut shared, content_width);
                w.header_footer(blocks, footer)?;
                let (xml, part_rels) = w.finish();
                let rid = rels.add(rel_type, name.clone()).id.clone();
                refs.push((footer, slot, rid));
                parts.push((name, content_type, xml, part_rels));
            }
        }
        section_refs.push(refs);
    }

    // The body.
    let mut w = PartWriter::new(doc, scheme, &mut shared, content_width);
    w.rels = rels;
    w.document(&section_refs)?;
    let (main_xml, rels) = w.finish();

    let main = pn("/word/document.xml")?;
    let mut pkg = Package::new();
    pkg.insert_part(main.clone(), ct::DOCUMENT, main_xml);
    pkg.insert_part(
        pn("/word/styles.xml")?,
        ct::WORD_STYLES,
        write_styles(&doc.styles, scheme),
    );
    let even_headers = doc
        .sections
        .iter()
        .any(|s| s.headers.even.is_some() || s.footers.even.is_some());
    let has_notes = [NoteKind::Foot, NoteKind::End].map(|k| doc.notes.iter().any(|n| n.kind == k));
    pkg.insert_part(
        pn("/word/settings.xml")?,
        ct::SETTINGS,
        ctx.settings_xml
            .clone()
            .unwrap_or_else(|| default_settings_xml(even_headers, has_notes, foot_sep, end_sep)),
    );
    pkg.insert_part(
        pn("/word/theme/theme1.xml")?,
        ct::THEME,
        ctx.theme_xml
            .clone()
            .unwrap_or_else(|| office_theme_xml(true)),
    );
    if let Some(xml) = numbering_xml {
        pkg.insert_part(pn("/word/numbering.xml")?, ct::NUMBERING, xml);
    }
    for (file, content_type, data, part_rels) in parts {
        let name = PartName::new(format!("/word/{file}"))?;
        pkg.insert_part(name.clone(), content_type, data);
        if !part_rels.is_empty() {
            pkg.set_relationships(name, part_rels);
        }
    }
    for (name, content_type, data) in std::mem::take(&mut shared.media_parts) {
        pkg.insert_part(PartName::new(format!("/word/{name}"))?, content_type, data);
    }
    pkg.set_relationships(main, rels);
    pkg.insert_part(pn("/docProps/core.xml")?, ct::CORE_PROPERTIES, core_xml());
    pkg.insert_part(pn("/docProps/app.xml")?, ct::EXTENDED_PROPERTIES, app_xml());
    let root = pkg.package_relationships_mut();
    root.add(rel::OFFICE_DOCUMENT, "word/document.xml");
    root.add(rel::CORE_PROPERTIES, "docProps/core.xml");
    root.add(rel::EXTENDED_PROPERTIES, "docProps/app.xml");
    Ok(pkg.write(Cursor::new(Vec::new()))?.into_inner())
}

/// Bookmarks for the headings that tables of contents point to:
/// `_Toc` + nine digits, numbered in order of first reference.
fn toc_targets(doc: &Document) -> HashMap<NodeId, (u32, String)> {
    let mut out = HashMap::new();
    for t in doc.body.iter().filter_map(Block::as_toc) {
        for e in &t.entries {
            if out.contains_key(&e.target) || doc.find_paragraph(e.target).is_none() {
                continue;
            }
            let n = out.len() as u32;
            out.insert(e.target, (n, format!("_Toc{:09}", n + 1)));
        }
    }
    out
}

/// Ids to write for the notes: the model's, except where they collide
/// with the separator ids (then the next free ids).
fn note_ids(doc: &Document, reserved: [i32; 4]) -> HashMap<u32, i64> {
    let reserved: Vec<i64> = reserved.iter().map(|&r| i64::from(r)).collect();
    let mut used: Vec<i64> = doc.notes.iter().map(|n| i64::from(n.id)).collect();
    let mut out = HashMap::new();
    for n in &doc.notes {
        let mut id = i64::from(n.id);
        if reserved.contains(&id) {
            id = used.iter().chain(&reserved).max().copied().unwrap_or(0) + 1;
            used.push(id);
        }
        out.insert(n.id, id);
    }
    out
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

/// Writes one part (document, header, footer, notes).
struct PartWriter<'a> {
    x: XmlOut,
    doc: &'a Document,
    scheme: &'a ColorScheme,
    /// This part's relationships.
    rels: Relationships,
    /// Media id → relationship id in this part.
    media_rels: HashMap<MediaId, String>,
    shared: &'a mut Shared,
    content_width: i32,
    /// The note whose reference mark opens the next paragraph.
    note_mark: Option<NoteKind>,
    /// The next paragraph opens with a comment's `w:annotationRef`.
    comment_mark: bool,
    /// The paragraph that gets a `w14:paraId` (a comment's last one).
    para_id: Option<(NodeId, String)>,
}

impl<'a> PartWriter<'a> {
    fn new(
        doc: &'a Document,
        scheme: &'a ColorScheme,
        shared: &'a mut Shared,
        content_width: i32,
    ) -> Self {
        Self {
            x: XmlOut::new(),
            doc,
            scheme,
            rels: Relationships::new(),
            media_rels: HashMap::new(),
            shared,
            content_width,
            note_mark: None,
            comment_mark: false,
            para_id: None,
        }
    }

    fn finish(self) -> (Vec<u8>, Relationships) {
        (self.x.finish(), self.rels)
    }

    fn root(&mut self, name: &str) {
        self.x.start(
            name,
            &[
                ("xmlns:w", W_NS),
                ("xmlns:r", NS_R),
                ("xmlns:wp", NS_WP),
                ("xmlns:a", NS_A),
                ("xmlns:pic", NS_PIC),
            ],
        );
    }

    fn document(&mut self, refs: &[Vec<HeaderRef>]) -> Result<()> {
        self.root("w:document");
        self.x.start("w:body", &[]);
        let doc = self.doc;
        let n = doc.sections.len();
        let mut next = 0;
        for b in &doc.body {
            let sect = match b {
                Block::Paragraph(p)
                    if next + 1 < n && p.props.section_end == Some(doc.sections[next].id) =>
                {
                    next += 1;
                    Some(write_sect_pr(&doc.sections[next - 1], &refs[next - 1]))
                }
                _ => None,
            };
            self.block(b, sect.as_deref())?;
        }
        if !matches!(doc.body.last(), Some(Block::Paragraph(_))) {
            self.x.empty("w:p", &[]);
        }
        if let Some(last) = doc.sections.last() {
            self.x.raw(&write_sect_pr(last, &refs[n - 1]));
        }
        self.x.end("w:body");
        self.x.end("w:document");
        Ok(())
    }

    fn header_footer(&mut self, blocks: &[Block], footer: bool) -> Result<()> {
        let root = if footer { "w:ftr" } else { "w:hdr" };
        self.root(root);
        self.blocks(blocks, true)?;
        self.x.end(root);
        Ok(())
    }

    fn notes(&mut self, kind: NoteKind, sep: (i32, i32)) -> Result<()> {
        let (root, item) = match kind {
            NoteKind::Foot => ("w:footnotes", "w:footnote"),
            NoteKind::End => ("w:endnotes", "w:endnote"),
        };
        self.root(root);
        for (id, ty, el) in [
            (sep.0, "separator", "w:separator"),
            (sep.1, "continuationSeparator", "w:continuationSeparator"),
        ] {
            self.x
                .start(item, &[("w:type", ty), ("w:id", &id.to_string())]);
            self.x.start("w:p", &[]);
            self.x.start("w:pPr", &[]);
            self.x.empty(
                "w:spacing",
                &[("w:after", "0"), ("w:line", "240"), ("w:lineRule", "auto")],
            );
            self.x.end("w:pPr");
            self.x.start("w:r", &[]);
            self.x.empty(el, &[]);
            self.x.end("w:r");
            self.x.end("w:p");
            self.x.end(item);
        }
        let doc = self.doc;
        for note in doc.notes.iter().filter(|n| n.kind == kind) {
            let id = self.shared.note_ids[&note.id].to_string();
            self.x.start(item, &[("w:id", &id)]);
            self.note_mark = Some(kind);
            self.blocks(&note.blocks, true)?;
            self.note_mark = None;
            self.x.end(item);
        }
        self.x.end(root);
        Ok(())
    }

    /// Blocks, followed by an empty paragraph if they do not end with one
    /// and `trailing` (Word requires a paragraph at the end of every cell,
    /// header and note).
    fn blocks(&mut self, blocks: &[Block], trailing: bool) -> Result<()> {
        for b in blocks {
            self.block(b, None)?;
        }
        if trailing && !matches!(blocks.last(), Some(Block::Paragraph(_))) {
            self.x.empty("w:p", &[]);
        }
        Ok(())
    }

    fn block(&mut self, b: &Block, sect: Option<&[u8]>) -> Result<()> {
        match b {
            Block::Paragraph(p) => self.paragraph(p, sect),
            Block::Table(t) => self.table(t),
            Block::Toc(t) => {
                self.toc(t);
                Ok(())
            }
        }
    }

    fn paragraph(&mut self, p: &Paragraph, sect: Option<&[u8]>) -> Result<()> {
        match self.para_id.as_ref().filter(|(id, _)| *id == p.id) {
            Some((_, pid)) => {
                let pid = pid.clone();
                self.x
                    .start("w:p", &[("w14:paraId", &pid), ("w14:textId", "77777777")]);
            }
            None => self.x.start("w:p", &[]),
        }
        write_ppr_sect(&mut self.x, &p.props, self.scheme, sect);
        if std::mem::take(&mut self.comment_mark) {
            self.x.start("w:r", &[]);
            self.comment_reference_rpr();
            self.x.empty("w:annotationRef", &[]);
            self.x.end("w:r");
        }
        if let Some(kind) = self.note_mark.take() {
            self.x.start("w:r", &[]);
            self.reference_rpr(kind, &RunProperties::default());
            self.x.empty(
                match kind {
                    NoteKind::Foot => "w:footnoteRef",
                    NoteKind::End => "w:endnoteRef",
                },
                &[],
            );
            self.x.end("w:r");
        }
        let bookmark = self.shared.toc_targets.get(&p.id).cloned();
        if let Some((id, name)) = &bookmark {
            self.x.empty(
                "w:bookmarkStart",
                &[("w:id", &id.to_string()), ("w:name", name)],
            );
        }
        for inline in &p.inlines {
            match inline {
                Inline::Run(run) => self.run(run),
                Inline::Image(img) => self.image(img)?,
                Inline::Break(kind) => {
                    self.x.start("w:r", &[]);
                    self.brk(*kind);
                    self.x.end("w:r");
                }
                Inline::Field(f) => self.field(f),
                Inline::NoteRef(r) => self.note_ref(r),
                Inline::CommentStart { id } => self.comment_marks(*id, true),
                Inline::CommentEnd { id } => self.comment_marks(*id, false),
            }
        }
        if let Some((id, _)) = &bookmark {
            self.x.empty("w:bookmarkEnd", &[("w:id", &id.to_string())]);
        }
        self.x.end("w:p");
        Ok(())
    }

    /// `w:rPr` of a note reference mark: the reference character style
    /// when the document defines it, else plain superscript; plus `props`.
    fn reference_rpr(&mut self, kind: NoteKind, props: &RunProperties) {
        let style = match kind {
            NoteKind::Foot => "FootnoteReference",
            NoteKind::End => "EndnoteReference",
        };
        let has_style = self
            .doc
            .styles
            .get(style)
            .is_some_and(|s| s.kind == StyleKind::Character);
        let mut props = props.clone();
        if !has_style && props.vertical_align.is_none() {
            props.vertical_align = Some(VerticalAlign::Superscript);
        }
        write_rpr_styled(&mut self.x, &props, self.scheme, has_style.then_some(style));
    }

    fn note_ref(&mut self, r: &NoteRef) {
        let Some(id) = self
            .doc
            .note(r.id)
            .filter(|n| n.kind == r.kind)
            .and_then(|n| self.shared.note_ids.get(&n.id))
            .copied()
        else {
            return; // a reference to a missing note
        };
        self.x.start("w:r", &[]);
        self.reference_rpr(r.kind, &r.props);
        let name = match r.kind {
            NoteKind::Foot => "w:footnoteReference",
            NoteKind::End => "w:endnoteReference",
        };
        self.x.empty(name, &[("w:id", &id.to_string())]);
        self.x.end("w:r");
    }

    /// `w:rPr` of a comment reference mark: the `CommentReference`
    /// character style when the document defines it.
    fn comment_reference_rpr(&mut self) {
        let has_style = self
            .doc
            .styles
            .get("CommentReference")
            .is_some_and(|s| s.kind == StyleKind::Character);
        if has_style {
            self.x.start("w:rPr", &[]);
            self.x.val("w:rStyle", "CommentReference");
            self.x.end("w:rPr");
        }
    }

    /// The range start (`start`) or end of thread `id`, for the root and
    /// each reply (as Word writes them); an end is followed by the
    /// `w:commentReference` run. Markers of unknown comments or replies
    /// are skipped.
    fn comment_marks(&mut self, id: CommentId, start: bool) {
        let doc = self.doc;
        if doc.comment(id).map_or(true, Comment::is_reply) {
            return;
        }
        for c in doc.thread(id) {
            let cid = c.id.0.to_string();
            if start {
                self.x.empty("w:commentRangeStart", &[("w:id", &cid)]);
            } else {
                self.x.empty("w:commentRangeEnd", &[("w:id", &cid)]);
                self.x.start("w:r", &[]);
                self.comment_reference_rpr();
                self.x.empty("w:commentReference", &[("w:id", &cid)]);
                self.x.end("w:r");
            }
        }
    }

    /// `word/comments.xml`: one `w:comment` per comment and reply; its
    /// first paragraph opens with the `w:annotationRef` mark, its last one
    /// carries the `w14:paraId` the extended parts refer to.
    fn comments(&mut self) -> Result<()> {
        self.x.start(
            "w:comments",
            &[
                ("xmlns:w", W_NS),
                ("xmlns:r", NS_R),
                ("xmlns:wp", NS_WP),
                ("xmlns:a", NS_A),
                ("xmlns:pic", NS_PIC),
                ("xmlns:mc", NS_MC),
                ("xmlns:w14", NS_W14),
                ("mc:Ignorable", "w14"),
            ],
        );
        let doc = self.doc;
        for c in &doc.comments {
            let id = c.id.0.to_string();
            let mut attrs: Vec<(&str, &str)> = vec![("w:id", &id), ("w:author", &c.author)];
            if let Some(d) = &c.date {
                attrs.push(("w:date", d));
            }
            if !c.initials.is_empty() {
                attrs.push(("w:initials", &c.initials));
            }
            self.x.start("w:comment", &attrs);
            let pid = self.shared.comment_para_ids[&c.id].clone();
            self.comment_mark = true;
            match model_text::document::paragraphs_in(&c.content).last() {
                Some(last) => {
                    self.para_id = Some((last.id, pid));
                    self.blocks(&c.content, true)?;
                }
                None => {
                    self.x
                        .start("w:p", &[("w14:paraId", &pid), ("w14:textId", "77777777")]);
                    self.x.start("w:r", &[]);
                    self.comment_reference_rpr();
                    self.x.empty("w:annotationRef", &[]);
                    self.x.end("w:r");
                    self.x.end("w:p");
                }
            }
            self.comment_mark = false;
            self.para_id = None;
            self.x.end("w:comment");
        }
        self.x.end("w:comments");
        Ok(())
    }

    /// A field as `w:fldSimple` with its cached result.
    fn field(&mut self, f: &Field) {
        let instr = format!(" {} ", f.kind.instruction());
        self.x.start("w:fldSimple", &[("w:instr", &instr)]);
        if !f.cached.is_empty() || !f.props.is_empty() {
            self.x.start("w:r", &[]);
            write_rpr(&mut self.x, &f.props, self.scheme);
            self.run_text(&f.cached);
            self.x.end("w:r");
        }
        self.x.end("w:fldSimple");
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
        // `w:rStyle` names a character style: a linked style by its
        // character half.
        let style = run
            .style
            .as_deref()
            .and_then(|id| self.doc.styles.get(id))
            .and_then(|s| match s.kind {
                StyleKind::Character => Some(s.id.as_str()),
                StyleKind::Linked => s.link.as_deref(),
                _ => None,
            });
        write_rpr_styled(&mut self.x, &run.props, self.scheme, style);
        self.run_text(&run.text);
        self.x.end("w:r");
    }

    /// The content of a run: text, `w:tab`, `w:br`.
    fn run_text(&mut self, text: &str) {
        let mut seg = String::new();
        for c in text.chars() {
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
    }

    /// Relationship id of `media` in this part, adding the media part on
    /// first use in the package.
    fn media_rel(&mut self, media: MediaId) -> Result<String> {
        if let Some(rid) = self.media_rels.get(&media) {
            return Ok(rid.clone());
        }
        let name = match self.shared.media_names.get(&media) {
            Some(n) => n.clone(),
            None => {
                let m = self.doc.media.get(media).ok_or_else(|| {
                    Error::InvalidDocument(format!("image references missing media {}", media.0))
                })?;
                let name = format!(
                    "media/image{}.{}",
                    self.shared.media_parts.len() + 1,
                    extension_of(&m.content_type)
                );
                self.shared.media_parts.push((
                    name.clone(),
                    m.content_type.clone(),
                    m.data.clone(),
                ));
                self.shared.media_names.insert(media, name.clone());
                name
            }
        };
        let rid = self.rels.add(rel::IMAGE, name).id.clone();
        self.media_rels.insert(media, rid.clone());
        Ok(rid)
    }

    /// A table of contents in a "Table of Contents" `w:sdt`: the title
    /// paragraph (style `TOCHeading`), then one paragraph per entry (style
    /// `TOCn`, right tab with dot leader at the text width, the text as a
    /// hyperlink to the heading's `_Toc` bookmark, the page number as a
    /// `PAGEREF` field), all inside the `TOC \o "a-b" \h \z \u` field.
    fn toc(&mut self, t: &Toc) {
        let instr = format!(" TOC \\o \"{}-{}\" \\h \\z \\u ", t.from_level, t.to_level);
        self.x.start("w:sdt", &[]);
        self.x.start("w:sdtPr", &[]);
        self.x.start("w:docPartObj", &[]);
        self.x.val("w:docPartGallery", "Table of Contents");
        self.x.empty("w:docPartUnique", &[]);
        self.x.end("w:docPartObj");
        self.x.end("w:sdtPr");
        self.x.start("w:sdtContent", &[]);
        if let Some(title) = &t.title {
            self.x.start("w:p", &[]);
            self.x.start("w:pPr", &[]);
            self.x.val("w:pStyle", "TOCHeading");
            self.x.end("w:pPr");
            self.run(&Run::new(title.clone()));
            self.x.end("w:p");
        }
        let tab_pos = self.content_width.max(0).to_string();
        let n = t.entries.len();
        if n == 0 {
            self.x.start("w:p", &[]);
            self.fld_char("begin");
            self.instr_text(&instr);
            self.fld_char("separate");
            self.fld_char("end");
            self.x.end("w:p");
        }
        for (i, e) in t.entries.iter().enumerate() {
            let bookmark = self.shared.toc_targets.get(&e.target).cloned();
            self.x.start("w:p", &[]);
            self.x.start("w:pPr", &[]);
            self.x
                .val("w:pStyle", &format!("TOC{}", e.level.clamp(1, 9)));
            self.x.start("w:tabs", &[]);
            self.x.empty(
                "w:tab",
                &[("w:val", "right"), ("w:leader", "dot"), ("w:pos", &tab_pos)],
            );
            self.x.end("w:tabs");
            self.x.end("w:pPr");
            if i == 0 {
                self.fld_char("begin");
                self.instr_text(&instr);
                self.fld_char("separate");
            }
            if let Some((_, name)) = &bookmark {
                self.x
                    .start("w:hyperlink", &[("w:anchor", name), ("w:history", "1")]);
            }
            self.run(&Run::new(format!("{}\t", e.text)));
            let page = e.page.map(|p| p.to_string()).unwrap_or_default();
            match &bookmark {
                Some((_, name)) => {
                    self.fld_char("begin");
                    self.instr_text(&format!(" PAGEREF {name} \\h "));
                    self.fld_char("separate");
                    self.run(&Run::new(page));
                    self.fld_char("end");
                    self.x.end("w:hyperlink");
                }
                None => self.run(&Run::new(page)),
            }
            if i + 1 == n {
                self.fld_char("end");
            }
            self.x.end("w:p");
        }
        self.x.end("w:sdtContent");
        self.x.end("w:sdt");
    }

    /// `<w:r><w:fldChar w:fldCharType="ty"/></w:r>`.
    fn fld_char(&mut self, ty: &str) {
        self.x.start("w:r", &[]);
        self.x.empty("w:fldChar", &[("w:fldCharType", ty)]);
        self.x.end("w:r");
    }

    /// `<w:r><w:instrText>text</w:instrText></w:r>`.
    fn instr_text(&mut self, text: &str) {
        self.x.start("w:r", &[]);
        self.x
            .text_el("w:instrText", &[("xml:space", "preserve")], text);
        self.x.end("w:r");
    }

    fn image(&mut self, img: &InlineImage) -> Result<()> {
        let rid = self.media_rel(img.media)?;
        let n = self.shared.next_docpr;
        let id = n.to_string();
        self.shared.next_docpr += 1;
        let (cx, cy) = (
            img.width.0.max(0).to_string(),
            img.height.0.max(0).to_string(),
        );
        let x = &mut self.x;
        x.start("w:r", &[]);
        x.start("w:drawing", &[]);
        let frame = if img.anchor.is_some() {
            "wp:anchor"
        } else {
            "wp:inline"
        };
        match &img.anchor {
            None => {
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
            }
            Some(a) => {
                let z = (251_658_240u64 + u64::from(n)).to_string();
                write_anchor_start(x, a, &z, &cx, &cy);
            }
        }
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
        x.end(frame);
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
        let grid = grid(t, self.content_width);
        self.x.start("w:tbl", &[]);
        write_tbl_pr(&mut self.x, &t.props, scheme, (None, None));
        self.x.start("w:tblGrid", &[]);
        for w in &grid {
            self.x.empty("w:gridCol", &[("w:w", &w.to_string())]);
        }
        self.x.end("w:tblGrid");
        for row in rows {
            self.x.start("w:tr", &[]);
            let rp = &row.props;
            if !rp.is_empty() {
                self.x.start("w:trPr", &[]);
                if rp.cant_split {
                    self.x.empty("w:cantSplit", &[]);
                }
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
            let mut col = 0;
            for cell in &row.cells {
                self.x.start("w:tc", &[]);
                let span = cell.span();
                // Without an own width a cell is as wide as its grid
                // columns (Word sizes autofit tables by `w:tcW`).
                let width = cell.props.width.or_else(|| {
                    let ws = grid.get(col..col + span)?;
                    Some(TableWidth::Twips(Twips(ws.iter().sum())))
                });
                col += span;
                let cp = CellProperties {
                    width,
                    ..cell.props
                };
                write_tc_pr(&mut self.x, &cp, cell.grid_span, cell.v_merge, scheme);
                self.blocks(&cell.blocks, false)?;
                self.x.end("w:tc");
            }
            self.x.end("w:tr");
        }
        self.x.end("w:tbl");
        Ok(())
    }
}

/// Writes `w:tblPr` (of a table or a table style) in Word's order.
pub(crate) fn write_tbl_pr(
    x: &mut XmlOut,
    p: &TableProperties,
    scheme: &ColorScheme,
    bands: (Option<u8>, Option<u8>),
) {
    x.start("w:tblPr", &[]);
    if let Some(s) = &p.style {
        x.val("w:tblStyle", s);
    }
    if let Some(n) = bands.0 {
        x.val("w:tblStyleRowBandSize", &n.to_string());
    }
    if let Some(n) = bands.1 {
        x.val("w:tblStyleColBandSize", &n.to_string());
    }
    if let Some(w) = p.width {
        write_width(x, "w:tblW", w);
    }
    if let Some(a) = p.alignment {
        x.val("w:jc", table_jc_name(a));
    }
    if let Some(i) = p.indent {
        write_width(x, "w:tblInd", TableWidth::Twips(i));
    }
    if let Some(b) = &p.borders {
        write_borders(x, "w:tblBorders", b, scheme);
    }
    if let Some(l) = p.layout {
        let t = match l {
            TableLayout::Fixed => "fixed",
            TableLayout::Autofit => "autofit",
        };
        x.empty("w:tblLayout", &[("w:type", t)]);
    }
    if let Some(m) = &p.cell_margins {
        write_cell_margins(x, m);
    }
    if let Some(l) = &p.look {
        write_tbl_look(x, l);
    }
    x.end("w:tblPr");
}

/// Writes `w:tcPr` (nothing if empty) in Word's order.
pub(crate) fn write_tc_pr(
    x: &mut XmlOut,
    cp: &CellProperties,
    span: u16,
    v_merge: Option<VMerge>,
    scheme: &ColorScheme,
) {
    if cp.is_empty() && span <= 1 && v_merge.is_none() {
        return;
    }
    x.start("w:tcPr", &[]);
    if let Some(w) = cp.width {
        write_width(x, "w:tcW", w);
    }
    if span > 1 {
        x.val("w:gridSpan", &span.to_string());
    }
    match v_merge {
        Some(VMerge::Restart) => x.val("w:vMerge", "restart"),
        Some(VMerge::Continue) => x.empty("w:vMerge", &[]),
        None => {}
    }
    if let Some(b) = &cp.borders {
        write_borders(x, "w:tcBorders", b, scheme);
    }
    if let Some(c) = &cp.shading {
        write_shading(x, c, scheme);
    }
    if let Some(m) = &cp.margins {
        write_margins_as(x, "w:tcMar", m);
    }
    if let Some(v) = cp.vertical_align {
        let v = match v {
            VAlign::Top => "top",
            VAlign::Center => "center",
            VAlign::Bottom => "bottom",
        };
        x.val("w:vAlign", v);
    }
    x.end("w:tcPr");
}

/// Writes the start of `wp:anchor` up to the wrapping element (the
/// caller continues with `wp:docPr`).
fn write_anchor_start(x: &mut XmlOut, a: &Anchor, z: &str, cx: &str, cy: &str) {
    let d = &a.distance;
    let (t, b, l, r) = (
        d.top.0.max(0).to_string(),
        d.bottom.0.max(0).to_string(),
        d.left.0.max(0).to_string(),
        d.right.0.max(0).to_string(),
    );
    let flag = |v: bool| if v { "1" } else { "0" };
    x.start(
        "wp:anchor",
        &[
            ("distT", &t),
            ("distB", &b),
            ("distL", &l),
            ("distR", &r),
            ("simplePos", "0"),
            ("relativeHeight", z),
            ("behindDoc", flag(a.behind_text())),
            ("locked", "0"),
            ("layoutInCell", "1"),
            ("allowOverlap", flag(a.allow_overlap)),
        ],
    );
    x.empty("wp:simplePos", &[("x", "0"), ("y", "0")]);
    let h_rel = match a.h.relative_to {
        HRelative::Margin => "margin",
        HRelative::Page => "page",
        HRelative::Column => "column",
        HRelative::Character => "character",
    };
    x.start("wp:positionH", &[("relativeFrom", h_rel)]);
    match a.h.place {
        Placement::Align(al) => x.text_el(
            "wp:align",
            &[],
            match al {
                HAlign::Left => "left",
                HAlign::Center => "center",
                HAlign::Right => "right",
            },
        ),
        Placement::Offset(o) => x.text_el("wp:posOffset", &[], &o.0.to_string()),
    }
    x.end("wp:positionH");
    let v_rel = match a.v.relative_to {
        VRelative::Margin => "margin",
        VRelative::Page => "page",
        VRelative::Paragraph => "paragraph",
        VRelative::Line => "line",
    };
    x.start("wp:positionV", &[("relativeFrom", v_rel)]);
    match a.v.place {
        Placement::Align(al) => x.text_el(
            "wp:align",
            &[],
            match al {
                VAlignPos::Top => "top",
                VAlignPos::Center => "center",
                VAlignPos::Bottom => "bottom",
            },
        ),
        Placement::Offset(o) => x.text_el("wp:posOffset", &[], &o.0.to_string()),
    }
    x.end("wp:positionV");
    x.empty("wp:extent", &[("cx", cx), ("cy", cy)]);
    x.empty(
        "wp:effectExtent",
        &[("l", "0"), ("t", "0"), ("r", "0"), ("b", "0")],
    );
    let side = match a.wrap_side {
        WrapSide::Both => "bothSides",
        WrapSide::Left => "left",
        WrapSide::Right => "right",
        WrapSide::Largest => "largest",
    };
    match a.wrap {
        WrapKind::Square => x.empty("wp:wrapSquare", &[("wrapText", side)]),
        WrapKind::Tight => {
            // Word requires a polygon; the image's bounding box.
            x.start("wp:wrapTight", &[("wrapText", side)]);
            x.start("wp:wrapPolygon", &[("edited", "0")]);
            x.empty("wp:start", &[("x", "0"), ("y", "0")]);
            for (px, py) in [
                ("0", "21600"),
                ("21600", "21600"),
                ("21600", "0"),
                ("0", "0"),
            ] {
                x.empty("wp:lineTo", &[("x", px), ("y", py)]);
            }
            x.end("wp:wrapPolygon");
            x.end("wp:wrapTight");
        }
        WrapKind::TopAndBottom => x.empty("wp:wrapTopAndBottom", &[]),
        WrapKind::Behind | WrapKind::InFront => x.empty("wp:wrapNone", &[]),
    }
}

/// Grid column widths: the table's own, or derived from the first row's
/// fixed cell widths, or the text width split evenly.
fn grid(t: &Table, content_width: i32) -> Vec<i32> {
    if !t.props.col_widths.is_empty() {
        return t.props.col_widths.iter().map(|w| w.0.max(0)).collect();
    }
    let cols = t.grid_cols().max(1);
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

/// `word/commentsExtended.xml`: per comment its paragraph id, the
/// thread's root (`paraIdParent`, replies only) and `done`.
fn comments_extended_xml(doc: &Document, para: &HashMap<CommentId, String>) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "w15:commentsEx",
        &[
            ("xmlns:mc", NS_MC),
            ("xmlns:w15", NS_W15),
            ("mc:Ignorable", "w15"),
        ],
    );
    for c in &doc.comments {
        let mut attrs: Vec<(&str, &str)> = vec![("w15:paraId", &para[&c.id])];
        if let Some(p) = c.parent.and_then(|p| para.get(&p)) {
            attrs.push(("w15:paraIdParent", p));
        }
        attrs.push(("w15:done", if c.resolved { "1" } else { "0" }));
        x.empty("w15:commentEx", &attrs);
    }
    x.end("w15:commentsEx");
    x.finish()
}

/// A comment's durable id (`commentsIds`/`commentsExtensible`).
fn durable_id(index: usize) -> String {
    format!("{:08X}", 0x3000_0000 + index)
}

/// `word/commentsIds.xml`: paragraph id → durable id.
fn comments_ids_xml(doc: &Document, para: &HashMap<CommentId, String>) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "w16cid:commentsIds",
        &[
            ("xmlns:mc", NS_MC),
            ("xmlns:w16cid", NS_W16CID),
            ("mc:Ignorable", "w16cid"),
        ],
    );
    for (i, c) in doc.comments.iter().enumerate() {
        x.empty(
            "w16cid:commentId",
            &[
                ("w16cid:paraId", &para[&c.id]),
                ("w16cid:durableId", &durable_id(i)),
            ],
        );
    }
    x.end("w16cid:commentsIds");
    x.finish()
}

/// `word/commentsExtensible.xml`: durable id → UTC date.
fn comments_extensible_xml(doc: &Document) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "w16cex:commentsExtensible",
        &[
            ("xmlns:mc", NS_MC),
            ("xmlns:w16cex", NS_W16CEX),
            ("mc:Ignorable", "w16cex"),
        ],
    );
    for (i, c) in doc.comments.iter().enumerate() {
        let id = durable_id(i);
        let mut attrs: Vec<(&str, &str)> = vec![("w16cex:durableId", &id)];
        if let Some(d) = &c.date {
            attrs.push(("w16cex:dateUtc", d));
        }
        x.empty("w16cex:commentExtensible", &attrs);
    }
    x.end("w16cex:commentsExtensible");
    x.finish()
}

fn default_settings_xml(
    even_headers: bool,
    notes: [bool; 2],
    foot_sep: (i32, i32),
    end_sep: (i32, i32),
) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("w:settings", &[("xmlns:w", W_NS)]);
    if even_headers {
        x.empty("w:evenAndOddHeaders", &[]);
    }
    for (on, pr, item, sep) in [
        (notes[0], "w:footnotePr", "w:footnote", foot_sep),
        (notes[1], "w:endnotePr", "w:endnote", end_sep),
    ] {
        if on {
            x.start(pr, &[]);
            x.empty(item, &[("w:id", &sep.0.to_string())]);
            x.empty(item, &[("w:id", &sep.1.to_string())]);
            x.end(pr);
        }
    }
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
        NumberingDef, NumberingRef, Orientation, PageSetup, ParagraphProperties, TableCell,
        TableProperties, TableRow,
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
                    anchor: None,
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
                    grid_span: 1,
                    v_merge: None,
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
        // A standalone list comes back on an abstract definition of its own.
        assert_eq!(back.numbering.defs[0].levels, doc.numbering.defs[0].levels);
        assert_eq!(back.numbering.defs[0].abstract_id, Some(0));
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
    fn header_and_footer_roundtrip() {
        let mut doc = Document::new();
        doc.set_header_text(false, Some("Quarterly report\tDraft"));
        doc.set_header_text(true, Some("Page {PAGE}"));
        assert_eq!(doc.page.footer_text.as_deref(), Some("Page {PAGE}"));
        let bytes = write(&doc).unwrap();
        let pkg = fmt_ooxml::Package::open(Cursor::new(bytes.as_slice())).unwrap();
        let main = PartName::new("/word/document.xml").unwrap();
        let xml = String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap();
        let sect = &xml[xml.find("<w:sectPr>").unwrap()..];
        assert!(sect.starts_with(r#"<w:sectPr><w:headerReference w:type="default" r:id="#));
        assert!(sect.contains("<w:footerReference"));
        let footer = PartName::new("/word/footer1.xml").unwrap();
        let part = pkg.part(&footer).unwrap();
        assert_eq!(part.content_type, ct::FOOTER);
        let footer_xml = String::from_utf8_lossy(&part.data);
        assert!(
            footer_xml
                .contains(r#"<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>"#),
            "{footer_xml}"
        );
        let out = crate::read_with_context(&bytes).unwrap();
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
        assert_eq!(out.document.page, doc.page);

        // Removing them removes the parts.
        doc.set_header_text(false, None);
        doc.set_header_text(true, Some(""));
        let bytes = write(&doc).unwrap();
        let back = crate::read(&bytes).unwrap();
        assert_eq!((back.page.header_text, back.page.footer_text), (None, None));
        assert!(!String::from_utf8_lossy(&bytes).contains("header1.xml"));
    }

    #[test]
    fn page_changed_directly_is_written() {
        let mut doc = Document::new();
        doc.page = PageSetup::letter().with_orientation(Orientation::Landscape);
        let back = crate::read(&write(&doc).unwrap()).unwrap();
        assert_eq!(back.page, doc.page);
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
                anchor: None,
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
            grid_span: 1,
            v_merge: None,
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
