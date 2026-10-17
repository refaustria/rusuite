//! `.docx` → [`Document`].

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::Cursor;

use core_model::units::{Emu, Twips};
use core_model::{RunProperties, VerticalAlign};
use fmt_ooxml::theme::parse_theme;
use fmt_ooxml::{Package, PartName, TargetMode};
use model_text::{
    Anchor, HAlign, HPos, HRelative, Insets, Placement, VAlignPos, VPos, VRelative, WrapKind,
    WrapSide,
};
use model_text::{Autofit, Drawing, DrawingKind, DrawingText, LineDash, ShapeFill, ShapeLine};
use model_text::{
    Block, BreakKind, CellProperties, Document, Field, FieldKind, HeightRule, Inline, InlineImage,
    MediaId, Note, NoteKind, NoteRef, PageSetup, Paragraph, RowHeight, RowProperties, Run, Section,
    SectionId, StyleSheet, Table, TableCell, TableLayout, TableProperties, TableRow, TableWidth,
    Toc, VAlign, VMerge,
};
use model_text::{BookmarkId, Comment, CommentId, CoreProperties, Hyperlink, LinkTarget};

use crate::drawing::{
    el_to_xml, read_fill, read_line, read_picture_format, read_preset, style_ref, theme_line_width,
};

use crate::numbering::read_numbering;
use crate::props::{
    read_borders, read_cell_margins, read_ppr, read_rpr, read_shading, read_table_jc,
    read_tbl_look, read_width,
};
use crate::sections::{read_sect_pr, HeaderRef};
use crate::styles::read_styles;
use crate::toc;
use crate::xml::{parse, parse_bool, parse_twips, parse_u32, toggle, xml_error, El, Node};
use crate::{DocxContext, Error, Result, Warnings};

/// Everything [`read_with_context`] returns.
#[derive(Debug)]
pub struct ReadOutput {
    /// The document (normalized, see [`Document::normalize`]).
    pub document: Document,
    /// File-level data to pass to [`write_with_context`](crate::write_with_context).
    pub context: DocxContext,
    /// Human-readable notes about content that was dropped or approximated
    /// (English; the lines of [`details`](Self::details)).
    pub warnings: Vec<String>,
    /// The same notes with their stable codes and parameters (for a
    /// translated UI).
    pub details: Vec<crate::ReaderWarning>,
}

/// Reads a `.docx` file. Unsupported content is dropped silently; use
/// [`read_with_warnings`] to learn what was dropped.
pub fn read(bytes: &[u8]) -> Result<Document> {
    Ok(read_with_context(bytes)?.document)
}

/// Like [`read()`], also returning notes about dropped/approximated content.
pub fn read_with_warnings(bytes: &[u8]) -> Result<(Document, Vec<String>)> {
    let out = read_with_context(bytes)?;
    Ok((out.document, out.warnings))
}

/// The last path segment of a relationship type (`…/relationships/styles`
/// → `styles`), so transitional and strict types match alike.
fn rel_kind(rel_type: &str) -> &str {
    rel_type.rsplit('/').next().unwrap_or("")
}

/// Reads a `.docx` file, returning the document, the file context (theme
/// and settings parts, numbering layout) and warnings.
pub fn read_with_context(bytes: &[u8]) -> Result<ReadOutput> {
    let pkg = Package::open(Cursor::new(bytes))?;
    let mut w = Warnings::default();
    let main = pkg.main_document_part().ok_or_else(|| {
        Error::MissingPart("officeDocument relationship (word/document.xml)".into())
    })?;
    let main_part = pkg
        .part(&main)
        .ok_or_else(|| Error::MissingPart(main.to_string()))?;
    let main_data = &main_part.data;
    let is_template = main_part.content_type == crate::TEMPLATE_CONTENT_TYPE;
    let mut consumed: BTreeSet<PartName> = BTreeSet::new();
    consumed.insert(main.clone());
    let mut properties = CoreProperties::default();
    for p in ["/docProps/core.xml", "/docProps/app.xml"] {
        let name = PartName::new(p)?;
        if let Some(part) = pkg.part(&name) {
            // Unreadable property parts are not worth failing the file.
            if let Ok(root) = parse(&part.data, name.as_str()) {
                read_properties(&root, &mut properties);
            }
        }
        consumed.insert(name);
    }

    // Parts related to the main document, by kind.
    let mut related: HashMap<&str, PartName> = HashMap::new();
    if let Some(rels) = pkg.relationships(&main) {
        for r in rels.iter() {
            if r.target_mode != TargetMode::Internal {
                continue;
            }
            let kind = rel_kind(&r.rel_type);
            if kind == "image" || related.contains_key(kind) {
                continue;
            }
            if let Ok(part) = main.resolve(&r.target) {
                related.insert(kind, part);
            }
        }
    }
    let data_of = |kind: &str| -> Option<(&PartName, &[u8])> {
        let name = related.get(kind)?;
        Some((name, pkg.part(name)?.data.as_slice()))
    };

    let mut context = DocxContext {
        template: is_template,
        ..Default::default()
    };
    let mut settings_read = model_text::DocumentSettings::default();
    if let Some((name, data)) = data_of("theme") {
        context.theme = Some(parse_theme(data, name.as_str()).map_err(xml_error)?);
        if pkg.relationships(name).is_some_and(|r| !r.is_empty()) {
            w.warn(
                "docx.package.themeRelationships",
                "{part}: theme has its own relationships; replaced by the built-in theme",
                &[("part", &name)],
            );
        } else {
            context.theme_xml = Some(data.to_vec());
        }
        consumed.insert(name.clone());
    }
    if let Some((name, data)) = data_of("settings") {
        if pkg.relationships(name).is_some_and(|r| !r.is_empty()) {
            w.warn(
                "docx.package.settingsRelationships",
                "{part}: settings have their own relationships; replaced by default settings",
                &[("part", &name)],
            );
        } else {
            let settings = parse(data, name.as_str())?;
            context.footnote_separators = separator_ids(&settings, "footnotePr", "footnote");
            context.endnote_separators = separator_ids(&settings, "endnotePr", "endnote");
            settings_read.auto_hyphenation = settings.child("autoHyphenation").is_some_and(toggle);
            settings_read.hyphenation_zone = settings
                .child("hyphenationZone")
                .and_then(|z| z.val())
                .and_then(parse_twips)
                .and_then(|v| u32::try_from(v).ok());
            settings_read.endnotes_at_section_end = settings
                .child("endnotePr")
                .and_then(|e| e.child("pos"))
                .and_then(|p| p.val())
                == Some("sectEnd");
            context.settings_xml = Some(data.to_vec());
        }
        consumed.insert(name.clone());
    }
    if let Some((name, _)) = data_of("fontTable") {
        // Font metadata; regenerated by Word on save, not needed.
        consumed.insert(name.clone());
    }
    for kind in [
        "webSettings",
        "customXml",
        "people",
        "commentsIds",
        "commentsExtensible",
    ] {
        if let Some((name, _)) = data_of(kind) {
            consumed.insert(name.clone());
        }
    }

    let styles = match data_of("styles") {
        Some((name, data)) => {
            consumed.insert(name.clone());
            read_styles(data, name.as_str(), &mut w)?
        }
        None => StyleSheet::default(),
    };
    let numbering = match data_of("numbering") {
        Some((name, data)) => {
            consumed.insert(name.clone());
            Some(read_numbering(data, name.as_str(), &mut w)?)
        }
        None => None,
    };

    let root = parse(main_data, main.as_str())?;
    let body = root.child("body").ok_or_else(|| Error::Malformed {
        part: main.to_string(),
        reason: "no w:body".into(),
    })?;

    let mut doc = Document::empty(styles, PageSetup::a4());
    doc.properties = properties;
    doc.settings = settings_read;
    if let Some(n) = numbering {
        doc.numbering = n.numbering;
        context.numbering = n.instances;
        link_style_levels(&mut doc);
    }

    let mut media = HashMap::new();
    let mut reader = BodyReader::new(
        &mut doc,
        &pkg,
        main.clone(),
        &mut w,
        &mut media,
        &mut consumed,
    );
    reader.main_body = true;
    let blocks = reader.read_blocks(body);
    let marks = std::mem::take(&mut reader.section_marks);
    let tocs = std::mem::take(&mut reader.tocs);
    doc.body = blocks;

    // Sections: one per paragraph-level sectPr, then the body-level one.
    let mut sections: Vec<(Section, Vec<HeaderRef>)> = Vec::new();
    for (k, (pid, sect)) in marks.iter().enumerate() {
        let id = SectionId(k as u32 + 1);
        sections.push(read_sect_pr(sect, id, &mut w));
        if let Some(Block::Paragraph(p)) = doc.find_block_mut(*pid) {
            p.props.section_end = Some(id);
        }
    }
    let last_id = SectionId(marks.len() as u32 + 1);
    sections.push(match body.child("sectPr") {
        Some(s) => read_sect_pr(s, last_id, &mut w),
        None => (Section::new(last_id, PageSetup::a4()), Vec::new()),
    });
    for (section, refs) in &mut sections {
        for (footer, slot, rid) in refs.iter() {
            let part = pkg
                .relationships(&main)
                .and_then(|r| r.get(rid))
                .filter(|r| r.target_mode == TargetMode::Internal)
                .and_then(|r| main.resolve(&r.target).ok());
            let Some(part) = part else {
                if *footer {
                    w.warn(
                        "docx.footer.danglingRelationship",
                        "footer with dangling relationship {rid} dropped",
                        &[("rid", rid)],
                    );
                } else {
                    w.warn(
                        "docx.header.danglingRelationship",
                        "header with dangling relationship {rid} dropped",
                        &[("rid", rid)],
                    );
                }
                continue;
            };
            let Some(data) = pkg.part(&part).map(|p| p.data.as_slice()) else {
                if *footer {
                    w.warn(
                        "docx.footer.partMissing",
                        "footer part {part} missing; dropped",
                        &[("part", &part)],
                    );
                } else {
                    w.warn(
                        "docx.header.partMissing",
                        "header part {part} missing; dropped",
                        &[("part", &part)],
                    );
                }
                continue;
            };
            let root = parse(data, part.as_str())?;
            consumed.insert(part.clone());
            let mut reader =
                BodyReader::new(&mut doc, &pkg, part, &mut w, &mut media, &mut consumed);
            let blocks = reader.read_blocks(&root);
            *section.header_footer_mut(*footer).get_mut(*slot) = Some(blocks);
        }
    }
    doc.page = sections
        .last()
        .map(|s| s.0.page.clone())
        .unwrap_or_default();
    doc.sections = sections.into_iter().map(|(s, _)| s).collect();

    // Footnotes and endnotes.
    let mut notes = Vec::new();
    for (kind, rel, el_name) in [
        (NoteKind::Foot, "footnotes", "footnote"),
        (NoteKind::End, "endnotes", "endnote"),
    ] {
        let Some((name, data)) = data_of(rel) else {
            continue;
        };
        let name = name.clone();
        let root = parse(data, name.as_str())?;
        consumed.insert(name.clone());
        let mut reader = BodyReader::new(&mut doc, &pkg, name, &mut w, &mut media, &mut consumed);
        for n in root.elements().filter(|e| e.name == el_name) {
            if n.attr("type").is_some_and(|t| t != "normal") {
                continue; // separators: regenerated on write
            }
            let Some(id) = n.attr("id").and_then(|v| v.trim().parse::<i64>().ok()) else {
                continue;
            };
            let blocks = reader.read_blocks(n);
            notes.push((kind, id, blocks));
        }
    }
    assign_note_ids(&mut doc, notes, &mut w);

    // Comments: `w:comment`s, threads and "done" from `commentsExtended`
    // (optional; without it every comment is a root).
    if let Some((name, data)) = data_of("comments") {
        let name = name.clone();
        let root = parse(data, name.as_str())?;
        consumed.insert(name.clone());
        let extended = match data_of("commentsExtended") {
            Some((ext, data)) => {
                consumed.insert(ext.clone());
                Some(parse(data, ext.as_str())?)
            }
            None => None,
        };
        let mut reader = BodyReader::new(&mut doc, &pkg, name, &mut w, &mut media, &mut consumed);
        let mut by_para: HashMap<String, CommentId> = HashMap::new();
        let mut comments = Vec::new();
        for c in root.elements().filter(|e| e.name == "comment") {
            let Some(id) = c.attr("id").and_then(parse_u32) else {
                continue;
            };
            let id = CommentId(id);
            if let Some(para) = c
                .elements()
                .filter(|e| e.name == "p")
                .last()
                .and_then(|p| p.attr("paraId"))
            {
                by_para.insert(para.to_ascii_uppercase(), id);
            }
            let content = reader.read_blocks(c);
            comments.push(Comment {
                id,
                author: c.attr("author").unwrap_or_default().to_owned(),
                initials: c.attr("initials").unwrap_or_default().to_owned(),
                date: c.attr("date").filter(|d| !d.is_empty()).map(str::to_owned),
                content,
                parent: None,
                resolved: false,
            });
        }
        if let Some(ext) = extended {
            for e in ext.elements().filter(|e| e.name == "commentEx") {
                let Some(id) = e
                    .attr("paraId")
                    .and_then(|p| by_para.get(&p.to_ascii_uppercase()))
                else {
                    continue;
                };
                let parent = e
                    .attr("paraIdParent")
                    .and_then(|p| by_para.get(&p.to_ascii_uppercase()))
                    .copied();
                let done = e.attr("done").and_then(parse_bool).unwrap_or(false);
                if let Some(c) = comments.iter_mut().find(|c| c.id == *id) {
                    c.parent = parent.filter(|p| p != id);
                    c.resolved = done;
                }
            }
        }
        doc.comments = comments;
        // Threads are resolved as a whole (Word marks every comment).
        let resolved: Vec<CommentId> = doc
            .comments
            .iter()
            .filter(|c| c.resolved)
            .map(|c| doc.thread_root(c.id))
            .collect();
        for c in &mut doc.comments {
            let root = c.parent.unwrap_or(c.id);
            c.resolved = resolved.contains(&root);
        }
    }

    // Tables of contents: entries rebuilt from the headings, page numbers
    // taken from the cached entries with the same text.
    for (id, lines) in tocs {
        let Some(Block::Toc(t)) = doc.find_block(id) else {
            continue;
        };
        let mut entries = doc.toc_entries(t);
        let mut used = vec![false; lines.len()];
        for e in &mut entries {
            if let Some(k) = (0..lines.len()).find(|&k| !used[k] && lines[k].0 == e.text) {
                used[k] = true;
                e.page = lines[k].1;
            }
        }
        if let Some(Block::Toc(t)) = doc.find_block_mut(id) {
            t.entries = entries;
        }
    }
    doc.normalize();

    for (name, part) in pkg.parts() {
        if !consumed.contains(name) {
            w.warn(
                "docx.package.partDropped",
                "part {part} ({type}) dropped",
                &[("part", name), ("type", &part.content_type)],
            );
        }
    }
    Ok(ReadOutput {
        document: doc,
        context,
        warnings: w.lines(),
        details: w.into_warnings(),
    })
}

/// `(separator id, continuation separator id)` listed in the settings'
/// `w:footnotePr` (or `w:endnotePr`).
fn separator_ids(settings: &El, pr: &str, item: &str) -> Option<(i32, i32)> {
    let ids: Vec<i32> = settings
        .child(pr)?
        .elements()
        .filter(|e| e.name == item)
        .filter_map(|e| e.attr("id")?.trim().parse().ok())
        .collect();
    match ids.as_slice() {
        [a, b, ..] => Some((*a, *b)),
        _ => None,
    }
}

/// Gives the notes model ids (unique across foot- and endnotes, at least
/// 1: footnotes keep theirs, colliding endnotes get fresh ones), updates
/// the references and drops references to missing notes.
fn assign_note_ids(doc: &mut Document, notes: Vec<(NoteKind, i64, Vec<Block>)>, w: &mut Warnings) {
    let mut map: HashMap<(NoteKind, u32), u32> = HashMap::new();
    let mut taken: HashSet<u32> = HashSet::new();
    let mut pending = Vec::new();
    for (kind, id, blocks) in notes {
        let wanted = u32::try_from(id).ok().filter(|&i| i >= 1);
        match wanted {
            Some(i) if taken.insert(i) => {
                map.insert((kind, i), i);
                doc.notes.push(Note {
                    id: i,
                    kind,
                    blocks,
                });
            }
            _ => pending.push((kind, id, blocks)),
        }
    }
    for (kind, id, blocks) in pending {
        let fresh = taken.iter().max().map_or(1, |m| m + 1);
        taken.insert(fresh);
        if let Ok(old) = u32::try_from(id) {
            map.insert((kind, old), fresh);
        }
        doc.notes.push(Note {
            id: fresh,
            kind,
            blocks,
        });
    }
    let mut dangling = false;
    let mut fix = |inlines: &mut Vec<Inline>| {
        inlines.retain_mut(|i| match i {
            Inline::NoteRef(r) => match map.get(&(r.kind, r.id)) {
                Some(&id) => {
                    r.id = id;
                    true
                }
                None => {
                    dangling = true;
                    false
                }
            },
            _ => true,
        });
    };
    for c in doc.containers_mut() {
        for_each_paragraph(c, &mut fix);
    }
    if dangling {
        w.warn(
            "docx.notes.orphanReferences",
            "footnote/endnote references without a note dropped",
            &[],
        );
    }
}

/// Calls `f` on the inlines of every paragraph in `blocks` (tables
/// included).
fn for_each_paragraph(blocks: &mut [Block], f: &mut impl FnMut(&mut Vec<Inline>)) {
    for b in blocks {
        match b {
            Block::Paragraph(p) => f(&mut p.inlines),
            Block::Table(t) => {
                for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                    for_each_paragraph(&mut cell.blocks, f);
                }
            }
            Block::Toc(_) => {}
        }
    }
}

/// A table of contents read: block id, levels, cached entries (text,
/// page).
type ReadToc = (model_text::NodeId, Vec<(String, Option<u32>)>);

/// A complex field being read (`w:fldChar begin … separate … end`).
#[derive(Debug)]
struct OpenField {
    instr: String,
    /// `separate` was seen: runs are the result.
    result: bool,
    /// The modelled field kind (decided at `separate`/`end`).
    kind: Option<FieldKind>,
    cached: String,
    props: Option<RunProperties>,
}

struct BodyReader<'a> {
    doc: &'a mut Document,
    pkg: &'a Package,
    /// The part being read (its relationships resolve images).
    part: PartName,
    w: &'a mut Warnings,
    /// Media part → id in the document's store (first-reference order).
    media: &'a mut HashMap<PartName, MediaId>,
    consumed: &'a mut BTreeSet<PartName>,
    /// Table nesting depth (0 = the part's top level).
    depth: usize,
    /// Paragraph-level `w:sectPr`s of the main body: (paragraph, sectPr).
    section_marks: Vec<(model_text::NodeId, El)>,
    /// Tables of contents read: (block id, levels, cached entries).
    tocs: Vec<ReadToc>,
    /// Open complex fields of the current paragraph, outermost first.
    fields: Vec<OpenField>,
    /// Ids of `_Toc` bookmarks (their ends are dropped silently).
    toc_bookmarks: HashSet<String>,
    /// Reading the main document's body (sections and TOCs live there).
    main_body: bool,
    /// Comment range starts met between blocks: they open the next
    /// paragraph.
    pending_marks: Vec<Inline>,
}

/// Body-level elements dropped silently.
const SILENT_BLOCK: &[&str] = &["sectPr", "proofErr", "permStart", "permEnd"];

impl<'a> BodyReader<'a> {
    fn new(
        doc: &'a mut Document,
        pkg: &'a Package,
        part: PartName,
        w: &'a mut Warnings,
        media: &'a mut HashMap<PartName, MediaId>,
        consumed: &'a mut BTreeSet<PartName>,
    ) -> Self {
        Self {
            doc,
            pkg,
            part,
            w,
            media,
            consumed,
            depth: 0,
            section_marks: Vec::new(),
            tocs: Vec::new(),
            fields: Vec::new(),
            toc_bookmarks: HashSet::new(),
            main_body: false,
            pending_marks: Vec::new(),
        }
    }

    /// Whether blocks read now are top-level blocks of the main body.
    fn in_main_body(&self) -> bool {
        self.main_body && self.depth == 0
    }

    /// The marker of a `w:bookmarkStart`/`w:bookmarkEnd`; `None` for
    /// `_Toc…` bookmarks (regenerated with the tables of contents),
    /// `_GoBack` (Word's last edit position) and malformed ones.
    fn bookmark(&mut self, el: &El) -> Option<Inline> {
        let raw = el.attr("id")?;
        let id = BookmarkId(parse_u32(raw)?);
        if el.name == "bookmarkStart" {
            let name = el.attr("name").unwrap_or_default();
            let toc = name.len() > 4 && name[..4].eq_ignore_ascii_case("_toc");
            if toc || name.eq_ignore_ascii_case("_GoBack") || name.is_empty() {
                self.toc_bookmarks.insert(raw.to_owned());
                return None;
            }
            Some(Inline::BookmarkStart {
                id,
                name: name.to_owned(),
            })
        } else if self.toc_bookmarks.contains(raw) {
            None
        } else {
            Some(Inline::BookmarkEnd { id })
        }
    }

    /// The link of a `w:hyperlink`: its external relationship (`r:id`,
    /// `mailto:` = e-mail) or its bookmark (`w:anchor`), and the tooltip.
    fn hyperlink(&mut self, el: &El) -> Option<Hyperlink> {
        let tooltip = el
            .attr("tooltip")
            .filter(|t| !t.is_empty())
            .map(str::to_owned);
        let target = if let Some(rid) = el.attr("id") {
            let rel = self.pkg.relationships(&self.part).and_then(|r| r.get(rid));
            match rel {
                Some(r) => LinkTarget::from_url(&r.target),
                None => {
                    self.w.warn(
                        "docx.link.danglingRelationship",
                        "hyperlink with a dangling relationship dropped",
                        &[],
                    );
                    return None;
                }
            }
        } else {
            LinkTarget::Bookmark(el.attr("anchor").filter(|a| !a.is_empty())?.to_owned())
        };
        Some(Hyperlink { target, tooltip })
    }
}

impl BodyReader<'_> {
    /// Blocks of `w:body`, `w:tc`, `w:sdtContent`, …
    fn read_blocks(&mut self, parent: &El) -> Vec<Block> {
        let mut out = Vec::new();
        self.collect_blocks(parent, &mut out);
        out
    }

    /// A table of contents from `scan`.
    fn toc_block(&mut self, scan: toc::TocScan) -> Block {
        let mut t = Toc::new(self.doc.alloc_id());
        (t.from_level, t.to_level) = scan.levels;
        t.title = scan.title;
        t.caption = scan.caption;
        self.tocs.push((t.id, scan.lines));
        Block::Toc(t)
    }

    fn collect_blocks(&mut self, parent: &El, out: &mut Vec<Block>) {
        let els: Vec<&El> = parent.elements().collect();
        let mut i = 0;
        while i < els.len() {
            let el = els[i];
            i += 1;
            match el.name.as_str() {
                "p" => {
                    if self.in_main_body() && toc::starts_toc(el) {
                        let run: Vec<&El> = els[i - 1..]
                            .iter()
                            .take_while(|e| e.name == "p")
                            .copied()
                            .collect();
                        if let Some(scan) = toc::scan(&run, false) {
                            i += scan.consumed - 1;
                            let b = self.toc_block(scan);
                            out.push(b);
                            continue;
                        }
                    }
                    out.push(Block::Paragraph(self.read_paragraph(el)));
                }
                "tbl" => out.push(Block::Table(self.read_table(el))),
                "sdt" => {
                    let Some(c) = el.child("sdtContent") else {
                        continue;
                    };
                    if self.in_main_body() && toc::is_toc_sdt(el) {
                        let paras: Vec<&El> = c.elements().filter(|e| e.name == "p").collect();
                        if let Some(scan) = toc::scan(&paras, true) {
                            let rest: Vec<&El> = paras[scan.consumed..].to_vec();
                            let b = self.toc_block(scan);
                            out.push(b);
                            for p in rest {
                                out.push(Block::Paragraph(self.read_paragraph(p)));
                            }
                            continue;
                        }
                    }
                    self.collect_blocks(c, out);
                }
                "customXml" | "ins" | "moveTo" => self.collect_blocks(el, out),
                "del" | "moveFrom" => {
                    self.w
                        .warn("docx.tracking.deletions", "tracked deletions dropped", &[])
                }
                "tcPr" | "trPr" | "tblPr" => {}
                "AlternateContent" => {
                    if let Some(c) = el.child("Choice") {
                        self.collect_blocks(c, out);
                    }
                }
                "bookmarkStart" | "bookmarkEnd" => {
                    // Between paragraphs: like comment markers.
                    if let Some(m) = self.bookmark(el) {
                        match (&m, out.last_mut()) {
                            (Inline::BookmarkEnd { .. }, Some(Block::Paragraph(p))) => {
                                p.inlines.push(m)
                            }
                            _ => self.pending_marks.push(m),
                        }
                    }
                }
                "commentRangeStart" | "commentRangeEnd" => {
                    // Between paragraphs: a start opens the next paragraph,
                    // an end closes the previous one.
                    let Some(id) = el.attr("id").and_then(parse_u32).map(CommentId) else {
                        continue;
                    };
                    if el.name == "commentRangeStart" {
                        self.pending_marks.push(Inline::CommentStart { id });
                    } else if let Some(Block::Paragraph(p)) = out.last_mut() {
                        p.inlines.push(Inline::CommentEnd { id });
                    } else {
                        self.pending_marks.push(Inline::CommentEnd { id });
                    }
                }
                name if SILENT_BLOCK.contains(&name) => {}
                _ => self.w.warn(
                    "docx.body.blockDropped",
                    "block element {name} dropped",
                    &[("name", &el.qname())],
                ),
            }
        }
    }

    fn read_paragraph(&mut self, p: &El) -> Paragraph {
        let mut para = Paragraph::new(self.doc.alloc_id());
        if let Some(ppr) = p.child("pPr") {
            para.props = read_ppr(ppr, "paragraph", self.w);
            if let Some(sect) = ppr.child("sectPr") {
                if self.in_main_body() {
                    self.section_marks.push((para.id, sect.clone()));
                } else {
                    self.w.warn(
                        "docx.section.outsideBody",
                        "section break outside the main text dropped",
                        &[],
                    );
                }
            }
        }
        self.fields.clear();
        para.inlines.append(&mut self.pending_marks);
        self.read_content(p, &mut para.inlines);
        // A field still open at the end of the paragraph: keep what was
        // read of it.
        if let Some(i) = self.capturing() {
            let f = self.fields.swap_remove(i);
            push_field(f, &mut para.inlines);
        }
        self.fields.clear();
        para
    }

    /// Index of the outermost open field whose result is being captured
    /// (a modelled field in its result part).
    fn capturing(&self) -> Option<usize> {
        self.fields
            .iter()
            .position(|f| f.result && f.kind.is_some())
    }

    /// Whether content is currently part of a field instruction.
    fn in_instruction(&self) -> bool {
        self.fields.iter().any(|f| !f.result)
    }

    /// Paragraph content (runs and their wrappers).
    fn read_content(&mut self, parent: &El, out: &mut Vec<Inline>) {
        for el in parent.elements() {
            match el.name.as_str() {
                "pPr" => {}
                "r" => self.read_run(el, out),
                "hyperlink" => {
                    let link = self.hyperlink(el);
                    let start = out.len();
                    self.read_content(el, out);
                    if let Some(link) = link {
                        for inline in &mut out[start..] {
                            match inline {
                                Inline::Run(run) => run.link = Some(link.clone()),
                                Inline::Field(_) | Inline::Image(_) => {
                                    self.w.warn(
                                        "docx.link.onFieldOrPicture",
                                        "hyperlinks on fields and pictures dropped",
                                        &[],
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                }
                "fldSimple" => {
                    let kind = el.attr("instr").and_then(FieldKind::parse);
                    match kind {
                        Some(kind) if self.capturing().is_none() && !self.in_instruction() => {
                            let props = el
                                .elements()
                                .find(|r| r.name == "r")
                                .and_then(|r| r.child("rPr"))
                                .map(|rpr| read_rpr(rpr, "field", self.w))
                                .unwrap_or_default();
                            let mut inner = Vec::new();
                            self.read_content(el, &mut inner);
                            let mut field = Field::new(kind);
                            field.props = props;
                            field.cached = inner
                                .iter()
                                .filter_map(|i| i.as_run().map(|r| r.text.as_str()))
                                .collect();
                            out.push(Inline::Field(field));
                        }
                        _ => {
                            if kind.is_none() {
                                self.w.warn("docx.field.flattened", FLATTENED, &[]);
                            }
                            self.read_content(el, out);
                        }
                    }
                }
                "smartTag" | "customXml" | "ins" | "moveTo" | "dir" | "bdo" => {
                    self.read_content(el, out)
                }
                "sdt" => {
                    if let Some(c) = el.child("sdtContent") {
                        self.read_content(c, out);
                    }
                }
                "AlternateContent" => {
                    if let Some(c) = el.child("Choice") {
                        self.read_content(c, out);
                    }
                }
                "del" | "moveFrom" => {
                    self.w
                        .warn("docx.tracking.deletions", "tracked deletions dropped", &[])
                }
                "bookmarkStart" | "bookmarkEnd" => {
                    if let Some(m) = self.bookmark(el) {
                        out.push(m);
                    }
                }
                "commentRangeStart" | "commentRangeEnd" => {
                    if let Some(id) = el.attr("id").and_then(parse_u32) {
                        let id = CommentId(id);
                        out.push(if el.name == "commentRangeStart" {
                            Inline::CommentStart { id }
                        } else {
                            Inline::CommentEnd { id }
                        });
                    }
                }
                "oMath" | "oMathPara" => {
                    self.w
                        .warn("docx.content.equations", "equations dropped", &[]);
                }
                "proofErr" | "permStart" | "permEnd" => {}
                _ => self.w.warn(
                    "docx.paragraph.contentDropped",
                    "paragraph content {name} dropped",
                    &[("name", &el.qname())],
                ),
            }
        }
    }

    fn read_run(&mut self, r: &El, out: &mut Vec<Inline>) {
        let note = r.elements().any(|e| {
            matches!(
                e.name.as_str(),
                "footnoteReference" | "endnoteReference" | "footnoteRef" | "endnoteRef"
            )
        });
        // The character style (`w:rStyle`); a note reference's style is
        // implied (and regenerated).
        let mut style = None;
        let props = r
            .child("rPr")
            .map(|rpr| {
                let mut quiet = rpr.clone();
                quiet.children.retain(|n| match n {
                    Node::El(e) if e.name == "rStyle" => {
                        if !note {
                            style = e.val().map(str::to_owned);
                        }
                        false
                    }
                    _ => true,
                });
                read_rpr(&quiet, "run", self.w)
            })
            .unwrap_or_default();
        let start = out.len();
        let mut text = String::new();
        self.run_children(r, &props, &mut text, out);
        flush(&mut text, &props, out);
        if style.is_some() {
            for inline in &mut out[start..] {
                if let Inline::Run(run) = inline {
                    run.style.clone_from(&style);
                }
            }
        }
    }

    /// Adds run text, or captures it as the result of an open field.
    fn text(&mut self, s: &str, props: &RunProperties, text: &mut String) {
        if self.in_instruction() {
            return;
        }
        match self.capturing() {
            Some(i) => {
                let f = &mut self.fields[i];
                f.cached.push_str(s);
                f.props.get_or_insert_with(|| props.clone());
            }
            None => text.push_str(s),
        }
    }

    fn fld_char(
        &mut self,
        el: &El,
        props: &RunProperties,
        text: &mut String,
        out: &mut Vec<Inline>,
    ) {
        match el.attr("fldCharType") {
            Some("begin") => self.fields.push(OpenField {
                instr: String::new(),
                result: false,
                kind: None,
                cached: String::new(),
                props: None,
            }),
            Some("separate") => {
                let outer = self.capturing().is_some();
                if let Some(f) = self.fields.last_mut().filter(|f| !f.result) {
                    f.result = true;
                    f.kind = if outer {
                        None
                    } else {
                        FieldKind::parse(&f.instr)
                    };
                    if f.kind.is_none() && !outer {
                        self.w.warn("docx.field.flattened", FLATTENED, &[]);
                    }
                }
            }
            Some("end") => {
                let Some(mut f) = self.fields.pop() else {
                    return;
                };
                if !f.result {
                    // begin … end without a result
                    if self.capturing().is_none() {
                        f.kind = FieldKind::parse(&f.instr);
                    }
                    if f.kind.is_none() && self.capturing().is_none() {
                        self.w.warn("docx.field.flattened", FLATTENED, &[]);
                    }
                }
                if f.kind.is_some() && self.capturing().is_none() {
                    flush(text, props, out);
                    push_field(f, out);
                }
            }
            _ => {}
        }
    }

    fn run_children(
        &mut self,
        r: &El,
        props: &RunProperties,
        text: &mut String,
        out: &mut Vec<Inline>,
    ) {
        for el in r.elements() {
            match el.name.as_str() {
                "rPr" => {}
                "t" => {
                    let mut s = String::new();
                    for n in &el.children {
                        if let Node::Text(t) = n {
                            s.push_str(t);
                        }
                    }
                    self.text(&s, props, text);
                }
                "tab" | "ptab" => self.text("\t", props, text),
                "br" if self.in_instruction() || self.capturing().is_some() => {}
                "br" => {
                    let kind = match el.attr("type") {
                        Some("page") => BreakKind::Page,
                        Some("column") => BreakKind::Column,
                        _ => BreakKind::Line,
                    };
                    flush(text, props, out);
                    out.push(Inline::Break(kind));
                }
                "cr" if self.in_instruction() || self.capturing().is_some() => {}
                "cr" => {
                    flush(text, props, out);
                    out.push(Inline::Break(BreakKind::Line));
                }
                "noBreakHyphen" => self.text("\u{2011}", props, text),
                "softHyphen" => self.text("\u{00AD}", props, text),
                "sym" => {
                    let c = el
                        .attr("char")
                        .and_then(|h| u32::from_str_radix(h, 16).ok())
                        .and_then(char::from_u32);
                    if let Some(c) = c {
                        self.text(&c.to_string(), props, text);
                    }
                    self.w.warn(
                        "docx.run.symbolFont",
                        "symbol characters (w:sym) lose their font",
                        &[],
                    );
                }
                "drawing" => {
                    flush(text, props, out);
                    if let Some(inline) = self.read_drawing(el) {
                        out.push(inline);
                    }
                }
                "AlternateContent" => {
                    if let Some(c) = el.child("Choice") {
                        self.run_children(c, props, text, out);
                    }
                }
                "pict" | "object" => self.w.warn(
                    "docx.content.vmlObjects",
                    "VML pictures and embedded objects dropped",
                    &[],
                ),
                "fldChar" => self.fld_char(el, props, text, out),
                "instrText" => {
                    if let Some(f) = self.fields.last_mut().filter(|f| !f.result) {
                        f.instr.push_str(&el.text());
                    }
                }
                "footnoteReference" | "endnoteReference" => {
                    let kind = if el.name == "footnoteReference" {
                        NoteKind::Foot
                    } else {
                        NoteKind::End
                    };
                    let Some(id) = el.attr("id").and_then(parse_u32) else {
                        continue;
                    };
                    flush(text, props, out);
                    let mut props = props.clone();
                    // Superscript is what the reference style does anyway.
                    if props
                        == (RunProperties {
                            vertical_align: Some(VerticalAlign::Superscript),
                            ..Default::default()
                        })
                    {
                        props = RunProperties::default();
                    }
                    out.push(Inline::NoteRef(NoteRef { id, kind, props }));
                }
                "commentReference" => {
                    // A comment without a range is anchored at its
                    // reference (zero length); after a range the extra
                    // pair is dropped by `Document::fix_comments`.
                    if let Some(id) = el.attr("id").and_then(parse_u32) {
                        flush(text, props, out);
                        let id = CommentId(id);
                        out.push(Inline::CommentStart { id });
                        out.push(Inline::CommentEnd { id });
                    }
                }
                "footnoteRef"
                | "endnoteRef"
                | "lastRenderedPageBreak"
                | "delText"
                | "delInstrText"
                | "annotationRef"
                | "separator"
                | "continuationSeparator" => {}
                _ => self.w.warn(
                    "docx.run.contentDropped",
                    "run content {name} dropped",
                    &[("name", &el.qname())],
                ),
            }
        }
    }

    fn read_drawing(&mut self, d: &El) -> Option<Inline> {
        let (shape, floating) = match (d.child("inline"), d.child("anchor")) {
            (Some(i), _) => (i, false),
            (None, Some(a)) => (a, true),
            _ => return None,
        };
        let data = shape.find("graphicData");
        if let Some(wsp) = data.and_then(|g| g.child("wsp")) {
            return self
                .read_shape(shape, wsp, floating)
                .map(|d| Inline::Drawing(Box::new(d)));
        }
        if data.and_then(|g| g.child("wgp")).is_some() {
            self.w.warn(
                "docx.drawing.groups",
                "grouped drawing objects dropped",
                &[],
            );
            return None;
        }
        let blip = data.and_then(|g| g.find("blip"));
        let Some(rid) = blip.and_then(|b| b.attr("embed")) else {
            if blip.and_then(|b| b.attr("link")).is_some() {
                self.w.warn(
                    "docx.image.external",
                    "linked (external) images dropped",
                    &[],
                );
            } else {
                self.w.warn(
                    "docx.drawing.otherObjects",
                    "drawing objects other than pictures dropped",
                    &[],
                );
            }
            return None;
        };
        let target = self
            .pkg
            .relationships(&self.part)
            .and_then(|r| r.get(rid))
            .filter(|r| r.target_mode == TargetMode::Internal)
            .and_then(|r| self.part.resolve(&r.target).ok());
        let Some(part_name) = target else {
            self.w.warn(
                "docx.image.danglingRelationship",
                "image with dangling relationship {rid} dropped",
                &[("rid", &rid)],
            );
            return None;
        };
        let media = match self.media.get(&part_name) {
            Some(id) => *id,
            None => {
                let Some(part) = self.pkg.part(&part_name) else {
                    self.w.warn(
                        "docx.image.partMissing",
                        "image part {part} missing; dropped",
                        &[("part", &part_name)],
                    );
                    return None;
                };
                let id = self
                    .doc
                    .media
                    .insert(part.content_type.clone(), part.data.clone());
                self.consumed.insert(part_name.clone());
                self.media.insert(part_name, id);
                id
            }
        };
        let extent = shape.child("extent");
        let emu = |a: &str| {
            extent
                .and_then(|e| e.attr(a))
                .and_then(|v| v.trim().parse::<i64>().ok())
                .map_or(Emu(0), Emu)
        };
        let doc_pr = shape.child("docPr");
        let attr = |a: &str| {
            doc_pr
                .and_then(|d| d.attr(a))
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        };
        let link = doc_pr
            .and_then(|d| d.child("hlinkClick"))
            .and_then(|h| self.drawing_link(h));
        let format = data
            .and_then(|g| g.child("pic"))
            .map(read_picture_format)
            .unwrap_or_default();
        Some(Inline::Image(InlineImage {
            media,
            width: emu("cx"),
            height: emu("cy"),
            alt: attr("descr"),
            name: attr("name"),
            anchor: floating.then(|| read_anchor(shape, self.w)),
            format,
            link,
        }))
    }

    /// The link of an `a:hlinkClick` (its relationship; `#name` targets are
    /// bookmarks).
    fn drawing_link(&mut self, h: &El) -> Option<Hyperlink> {
        let rid = h.attr("id")?;
        let rel = self
            .pkg
            .relationships(&self.part)
            .and_then(|r| r.get(rid))?;
        let target = match rel.target.strip_prefix('#') {
            Some(b) if !b.is_empty() => LinkTarget::Bookmark(b.to_owned()),
            _ => LinkTarget::from_url(&rel.target),
        };
        let tooltip = h
            .attr("tooltip")
            .filter(|t| !t.is_empty())
            .map(str::to_owned);
        Some(Hyperlink { target, tooltip })
    }

    /// A `wps:wsp` (shape or text box) in `wp:inline` / `wp:anchor` `frame`.
    fn read_shape(&mut self, frame: &El, wsp: &El, floating: bool) -> Option<Drawing> {
        let extent = frame.child("extent");
        let emu = |a: &str| {
            extent
                .and_then(|e| e.attr(a))
                .and_then(|v| v.trim().parse::<i64>().ok())
                .map_or(Emu(0), Emu)
        };
        let doc_pr = frame.child("docPr");
        let attr = |a: &str| {
            doc_pr
                .and_then(|d| d.attr(a))
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        };
        let text_box = wsp
            .child("cNvSpPr")
            .and_then(|c| c.attr("txBox"))
            .and_then(parse_bool)
            .unwrap_or(false);
        let id = self.doc.alloc_id();
        let mut d = Drawing::shape(id, "rect", emu("cx"), emu("cy"));
        d.kind = if text_box {
            DrawingKind::TextBox
        } else {
            DrawingKind::Shape
        };
        d.name = attr("name");
        d.alt = attr("descr");
        d.anchor = floating.then(|| read_anchor(frame, self.w));
        let style = wsp.child("style");
        let sp = wsp.child("spPr");
        if let Some(x) = sp.and_then(|s| s.child("xfrm")) {
            d.rotation = x
                .attr("rot")
                .and_then(|v| v.parse::<i64>().ok())
                .map_or(0.0, |r| r as f64 / 60_000.0);
            d.flip_h = x.attr("flipH").and_then(parse_bool).unwrap_or(false);
            d.flip_v = x.attr("flipV").and_then(parse_bool).unwrap_or(false);
        }
        if let Some(g) = sp.and_then(|s| s.child("prstGeom")) {
            (d.preset, d.adjust) = read_preset(g);
        } else if let Some(g) = sp.and_then(|s| s.child("custGeom")) {
            d.preset = "rect".into();
            d.custom_geometry = Some(el_to_xml(g));
            self.w.warn(
                "docx.drawing.customGeometry",
                "custom shape geometry drawn as its bounding box",
                &[],
            );
        }
        // Fill and outline: explicit, else from the style references.
        d.fill = match sp.and_then(read_fill) {
            Some(f) => f,
            None => match style_ref(style, "fillRef") {
                Some((idx, Some(c))) if idx > 0 => ShapeFill::Solid(c),
                _ => ShapeFill::None,
            },
        };
        let ln = sp.and_then(|s| s.child("ln"));
        let (lfill, lwidth, dash) = ln.map_or((None, None, LineDash::Solid), read_line);
        let lref = style_ref(style, "lnRef");
        d.line = match lfill {
            Some(fill) => ShapeLine {
                fill,
                width: lwidth.unwrap_or(Emu(9525)),
                dash,
            },
            None => match lref {
                Some((idx, Some(c))) if idx > 0 => ShapeLine {
                    fill: ShapeFill::Solid(c),
                    width: lwidth.unwrap_or_else(|| theme_line_width(idx)),
                    dash,
                },
                _ => ShapeLine::default(),
            },
        };
        d.text_color = style_ref(style, "fontRef").and_then(|(_, c)| c);
        let body = wsp.child("bodyPr");
        let content = wsp.child("txbx").and_then(|t| t.child("txbxContent"));
        if let Some(c) = content {
            let blocks = self.read_nested_blocks(c);
            let mut t = DrawingText::new(blocks);
            if let Some(b) = body {
                let ins = |a: &str, def: i64| {
                    Emu(b.attr(a).and_then(|v| v.parse::<i64>().ok()).unwrap_or(def))
                };
                t.insets = Insets {
                    left: ins("lIns", 91_440),
                    top: ins("tIns", 45_720),
                    right: ins("rIns", 91_440),
                    bottom: ins("bIns", 45_720),
                };
                t.vertical_align = match b.attr("anchor") {
                    Some("ctr") => VAlignPos::Center,
                    Some("b") => VAlignPos::Bottom,
                    _ => VAlignPos::Top,
                };
                t.wrap = b.attr("wrap") != Some("none");
                if b.child("spAutoFit").is_some() {
                    t.autofit = Autofit::Resize;
                }
            }
            d.text = Some(t);
        } else if text_box {
            d.text = Some(DrawingText::new(Vec::new()));
        }
        Some(d)
    }

    /// The blocks of a text box (`w:txbxContent`): read like a nested
    /// container (no section marks, no tables of contents; drawings inside
    /// are dropped, as text boxes do not nest).
    fn read_nested_blocks(&mut self, c: &El) -> Vec<Block> {
        let fields = std::mem::take(&mut self.fields);
        let marks = std::mem::take(&mut self.pending_marks);
        self.depth += 1;
        let mut blocks = self.read_blocks(c);
        self.depth -= 1;
        self.fields = fields;
        self.pending_marks = marks;
        let mut nested = false;
        for b in &mut blocks {
            strip_drawings(b, &mut nested);
        }
        if nested {
            self.w.warn(
                "docx.drawing.insideTextBox",
                "drawing objects inside text boxes dropped",
                &[],
            );
        }
        blocks
    }

    fn read_table(&mut self, t: &El) -> Table {
        let mut table = Table {
            id: self.doc.alloc_id(),
            props: TableProperties::default(),
            rows: Vec::new(),
        };
        if let Some(pr) = t.child("tblPr") {
            table.props = self.read_tbl_pr(pr);
        }
        if let Some(grid) = t.child("tblGrid") {
            table.props.col_widths = grid
                .elements()
                .filter(|g| g.name == "gridCol")
                .map(|g| Twips(g.attr("w").and_then(parse_twips).unwrap_or(0)))
                .collect();
        }
        self.collect_rows(t, &mut table.rows);
        drop_grid_widths(&mut table);
        table
    }

    fn collect_rows(&mut self, parent: &El, rows: &mut Vec<TableRow>) {
        for el in parent.elements() {
            match el.name.as_str() {
                "tr" => {
                    let row = self.read_row(el);
                    rows.push(row);
                }
                "sdt" => {
                    if let Some(c) = el.child("sdtContent") {
                        self.collect_rows(c, rows);
                    }
                }
                "customXml" => self.collect_rows(el, rows),
                _ => {}
            }
        }
    }

    fn read_tbl_pr(&mut self, pr: &El) -> TableProperties {
        read_tbl_pr(pr, "table", self.w)
    }

    fn read_row(&mut self, tr: &El) -> TableRow {
        let mut row = TableRow {
            id: self.doc.alloc_id(),
            props: RowProperties::default(),
            cells: Vec::new(),
        };
        if let Some(pr) = tr.child("trPr") {
            for el in pr.elements() {
                match el.name.as_str() {
                    "trHeight" => {
                        let v = el.val().and_then(parse_twips).unwrap_or(0);
                        row.props.height = match el.attr("hRule") {
                            Some("auto") => None,
                            Some("exact") => Some(RowHeight {
                                value: Twips(v),
                                rule: HeightRule::Exact,
                            }),
                            _ => Some(RowHeight {
                                value: Twips(v),
                                rule: HeightRule::AtLeast,
                            }),
                        };
                    }
                    "tblHeader" => row.props.header = toggle(el),
                    "cantSplit" => row.props.cant_split = toggle(el),
                    "cnfStyle" | "trPrChange" => {}
                    _ => self.w.warn(
                        "docx.table.rowPropertyDropped",
                        "table row property {name} dropped",
                        &[("name", &el.qname())],
                    ),
                }
            }
        }
        self.collect_cells(tr, &mut row.cells);
        row
    }

    fn collect_cells(&mut self, parent: &El, cells: &mut Vec<TableCell>) {
        for el in parent.elements() {
            match el.name.as_str() {
                "tc" => {
                    let cell = self.read_cell(el);
                    cells.push(cell);
                }
                "sdt" => {
                    if let Some(c) = el.child("sdtContent") {
                        self.collect_cells(c, cells);
                    }
                }
                "customXml" => self.collect_cells(el, cells),
                _ => {}
            }
        }
    }

    fn read_cell(&mut self, tc: &El) -> TableCell {
        let id = self.doc.alloc_id();
        let mut cell = TableCell::new(id, CellProperties::default(), Vec::new());
        if let Some(pr) = tc.child("tcPr") {
            cell.props = read_tc_pr(pr, "table cell", self.w);
            for el in pr.elements() {
                match el.name.as_str() {
                    "gridSpan" => {
                        cell.grid_span = el
                            .val()
                            .and_then(parse_u32)
                            .map_or(1, |n| n.clamp(1, 63) as u16);
                    }
                    "vMerge" => {
                        cell.v_merge = Some(match el.val() {
                            Some("restart") => VMerge::Restart,
                            _ => VMerge::Continue,
                        });
                    }
                    "hMerge" => self.w.warn(
                        "docx.table.hMerge",
                        "legacy horizontal merges (hMerge) read as separate cells",
                        &[],
                    ),
                    _ => {}
                }
            }
        }
        self.depth += 1;
        cell.blocks = self.read_blocks(tc);
        self.depth -= 1;
        cell
    }
}

/// Clears cell widths that just repeat the grid (the writer derives
/// them from the grid, so a changed grid is not contradicted by stale
/// cell widths).
fn drop_grid_widths(t: &mut Table) {
    let grid = &t.props.col_widths;
    if grid.is_empty() {
        return;
    }
    for row in &mut t.rows {
        let mut col = 0;
        for cell in &mut row.cells {
            let span = cell.span();
            if let (Some(TableWidth::Twips(w)), Some(ws)) =
                (cell.props.width, grid.get(col..col + span))
            {
                if ws.iter().map(|g| g.0).sum::<i32>() == w.0 {
                    cell.props.width = None;
                }
            }
            col += span;
        }
    }
}

/// `w:tblPr` (of a table or a table style) → table properties.
pub(crate) fn read_tbl_pr(pr: &El, ctx: &str, w: &mut Warnings) -> TableProperties {
    let mut p = TableProperties::default();
    for el in pr.elements() {
        match el.name.as_str() {
            "tblW" => p.width = read_width(el),
            "tblBorders" => p.borders = read_borders(el, ctx, w),
            "tblCellMar" => p.cell_margins = read_cell_margins(el),
            "tblStyle" => p.style = el.val().map(str::to_owned),
            "tblLook" => p.look = Some(read_tbl_look(el)),
            "jc" => {
                p.alignment = el.val().and_then(read_table_jc);
                if p.alignment.is_none() {
                    w.warn(
                        "docx.table.alignmentDropped",
                        "{ctx}: table alignment dropped",
                        &[("ctx", &ctx)],
                    );
                }
            }
            "tblInd" => {
                p.indent = match read_width(el) {
                    Some(TableWidth::Twips(t)) => Some(t),
                    _ => None,
                }
            }
            "tblLayout" => {
                p.layout = Some(match el.attr("type") {
                    Some("fixed") => TableLayout::Fixed,
                    _ => TableLayout::Autofit,
                })
            }
            "tblStyleRowBandSize" | "tblStyleColBandSize" | "tblPrChange" => {}
            _ => w.warn(
                "docx.table.propertyDropped",
                "{ctx}: table property {name} dropped",
                &[("ctx", &ctx), ("name", &el.qname())],
            ),
        }
    }
    p
}

/// `w:tcPr` (of a cell or a table style) → cell properties (merge marks
/// are read by the caller).
pub(crate) fn read_tc_pr(pr: &El, ctx: &str, w: &mut Warnings) -> CellProperties {
    let mut props = CellProperties::default();
    for el in pr.elements() {
        match el.name.as_str() {
            "tcW" => props.width = read_width(el),
            "shd" => props.shading = read_shading(el),
            "tcBorders" => props.borders = read_borders(el, ctx, w),
            "tcMar" => props.margins = read_cell_margins(el),
            "vAlign" => {
                props.vertical_align = match el.val() {
                    Some("top") => Some(VAlign::Top),
                    Some("center") | Some("both") => Some(VAlign::Center),
                    Some("bottom") => Some(VAlign::Bottom),
                    _ => None,
                }
            }
            "gridSpan" | "vMerge" | "hMerge" | "cnfStyle" | "hideMark" | "tcPrChange" => {}
            _ => w.warn(
                "docx.table.cellPropertyDropped",
                "{ctx}: table cell property {name} dropped",
                &[("ctx", &ctx), ("name", &el.qname())],
            ),
        }
    }
    props
}

/// Removes the drawings from the paragraphs of `b` (text box content).
fn strip_drawings(b: &mut Block, found: &mut bool) {
    match b {
        Block::Paragraph(p) => p.inlines.retain(|i| {
            let d = matches!(i, Inline::Drawing(_));
            *found |= d;
            !d
        }),
        Block::Table(t) => {
            for cell in t.rows.iter_mut().flat_map(|r| &mut r.cells) {
                for b in &mut cell.blocks {
                    strip_drawings(b, found);
                }
            }
        }
        Block::Toc(_) => {}
    }
}

/// `wp:anchor` → floating placement.
fn read_anchor(a: &El, w: &mut Warnings) -> Anchor {
    let emu_attr = |name: &str| {
        a.attr(name)
            .and_then(|v| v.trim().parse::<i64>().ok())
            .map_or(Emu(0), |v| Emu(v.max(0)))
    };
    let flag = |name: &str| a.attr(name).and_then(parse_bool).unwrap_or(false);
    let offset = |el: &El| {
        el.child("posOffset")
            .and_then(|o| o.text().trim().parse::<i64>().ok())
            .map(Emu)
    };
    let mut anchor = Anchor::new(WrapKind::InFront);
    anchor.distance = Insets {
        top: emu_attr("distT"),
        bottom: emu_attr("distB"),
        left: emu_attr("distL"),
        right: emu_attr("distR"),
    };
    anchor.allow_overlap = flag("allowOverlap");
    if flag("simplePos") {
        w.warn(
            "docx.float.simplePosition",
            "floating image: simple positioning read as offset from the page",
            &[],
        );
        let sp = a.child("simplePos");
        let at = |n: &str| {
            sp.and_then(|e| e.attr(n))
                .and_then(|v| v.trim().parse::<i64>().ok())
                .map_or(Emu(0), Emu)
        };
        anchor.h = HPos {
            relative_to: HRelative::Page,
            place: Placement::Offset(at("x")),
        };
        anchor.v = VPos {
            relative_to: VRelative::Page,
            place: Placement::Offset(at("y")),
        };
    } else {
        if let Some(h) = a.child("positionH") {
            let rel = match h.attr("relativeFrom").unwrap_or("column") {
                "margin" => HRelative::Margin,
                "page" | "leftMargin" => HRelative::Page,
                "column" => HRelative::Column,
                "character" => HRelative::Character,
                other => {
                    w.warn(
                        "docx.float.horizontalRelative",
                        "floating image: horizontal position relative to {relative} read as relative to the margin",
                        &[("relative", &other)],
                    );
                    HRelative::Margin
                }
            };
            let place = match h.child("align").map(El::text) {
                Some(al) => Placement::Align(match al.trim() {
                    "center" => HAlign::Center,
                    "right" | "outside" => HAlign::Right,
                    _ => HAlign::Left,
                }),
                None => Placement::Offset(offset(h).unwrap_or(Emu(0))),
            };
            anchor.h = HPos {
                relative_to: rel,
                place,
            };
        }
        if let Some(v) = a.child("positionV") {
            let rel = match v.attr("relativeFrom").unwrap_or("paragraph") {
                "margin" => VRelative::Margin,
                "page" | "topMargin" => VRelative::Page,
                "paragraph" => VRelative::Paragraph,
                "line" => VRelative::Line,
                other => {
                    w.warn(
                        "docx.float.verticalRelative",
                        "floating image: vertical position relative to {relative} read as relative to the margin",
                        &[("relative", &other)],
                    );
                    VRelative::Margin
                }
            };
            let place = match v.child("align").map(El::text) {
                Some(al) => Placement::Align(match al.trim() {
                    "center" => VAlignPos::Center,
                    "bottom" | "outside" => VAlignPos::Bottom,
                    _ => VAlignPos::Top,
                }),
                None => Placement::Offset(offset(v).unwrap_or(Emu(0))),
            };
            anchor.v = VPos {
                relative_to: rel,
                place,
            };
        }
    }
    let side = |el: &El| match el.attr("wrapText").unwrap_or("bothSides") {
        "left" => WrapSide::Left,
        "right" => WrapSide::Right,
        "largest" => WrapSide::Largest,
        _ => WrapSide::Both,
    };
    let behind = flag("behindDoc");
    anchor.wrap = if behind {
        WrapKind::Behind
    } else {
        WrapKind::InFront
    };
    for el in a.elements() {
        match el.name.as_str() {
            "wrapSquare" => {
                anchor.wrap = WrapKind::Square;
                anchor.wrap_side = side(el);
            }
            "wrapTight" | "wrapThrough" => {
                anchor.wrap = WrapKind::Tight;
                anchor.wrap_side = side(el);
            }
            "wrapTopAndBottom" => anchor.wrap = WrapKind::TopAndBottom,
            "wrapNone" => {}
            _ => {}
        }
    }
    if behind && anchor.wrap != WrapKind::Behind {
        w.warn(
            "docx.float.behindText",
            "floating image: behind-text flag on a wrapping image dropped",
            &[],
        );
    }
    anchor
}

/// Warning for fields that are not modelled.
pub(crate) const FLATTENED: &str =
    "fields other than PAGE, NUMPAGES, DATE, TIME, FILENAME, AUTHOR, TITLE, REF, PAGEREF, NOTEREF and SEQ flattened to their current result";

/// `docProps/core.xml` (Dublin Core) or `docProps/app.xml` (`Pages`,
/// `Company`) →
/// the properties.
fn read_properties(root: &El, p: &mut CoreProperties) {
    for el in root.elements() {
        let text = el.text();
        let text = text.trim();
        let value = (!text.is_empty()).then(|| text.to_owned());
        match el.name.as_str() {
            "title" => p.title = value,
            "subject" => p.subject = value,
            "creator" => p.author = value,
            "keywords" => p.keywords = value,
            "description" => p.description = value,
            "category" => p.category = value,
            "lastModifiedBy" => p.last_modified_by = value,
            "created" => p.created = value,
            "modified" => p.modified = value,
            "revision" => p.revision = text.parse().ok(),
            "Pages" => p.pages = text.parse().ok(),
            "Company" => p.company = value,
            _ => {}
        }
    }
}

/// Emits a completed modelled field.
fn push_field(f: OpenField, out: &mut Vec<Inline>) {
    if let Some(kind) = f.kind {
        out.push(Inline::Field(Field {
            kind,
            cached: f.cached,
            props: f.props.unwrap_or_default(),
        }));
    }
}

/// Moves pending text into a run.
fn flush(text: &mut String, props: &RunProperties, out: &mut Vec<Inline>) {
    if !text.is_empty() {
        out.push(Inline::Run(Run::with_props(
            std::mem::take(text),
            props.clone(),
        )));
    }
}

/// A style numbered with a list that has a level linked to it (`w:pStyle`
/// in the level, Word's heading numbering) uses that level: Word writes
/// the style's `w:numPr` without `w:ilvl`.
fn link_style_levels(doc: &mut Document) {
    let numbering = &doc.numbering;
    for style in doc.styles.styles.iter_mut() {
        let Some(n) = style.paragraph.numbering.as_mut().filter(|n| n.num_id != 0) else {
            continue;
        };
        let linked = numbering.get(n.num_id).and_then(|d| {
            d.levels
                .iter()
                .position(|l| l.style.as_deref() == Some(style.id.as_str()))
        });
        if let Some(i) = linked {
            n.level = i as u8;
        }
    }
}

#[cfg(test)]
mod style_link_tests {
    use super::*;
    use model_text::{Level, LevelKind, NumberingDef, NumberingRef};

    #[test]
    fn style_numbering_takes_the_linked_level() {
        let mut doc = Document::new();
        let levels = (0..3)
            .map(|i| Level {
                style: Some(format!("Heading{}", i + 1)),
                ..Level::new(LevelKind::Decimal, format!("%{}", i + 1))
            })
            .collect();
        doc.numbering.insert(NumberingDef::standalone(4, levels));
        // Word writes `<w:numPr><w:numId w:val="4"/></w:numPr>` (level 0 on read).
        for id in ["Heading2", "Heading3", "Normal"] {
            let s = doc.styles.styles.iter_mut().find(|s| s.id == id).unwrap();
            s.paragraph.numbering = Some(NumberingRef {
                num_id: 4,
                level: 0,
            });
        }
        link_style_levels(&mut doc);
        let level = |id: &str| {
            doc.styles
                .get(id)
                .unwrap()
                .paragraph
                .numbering
                .unwrap()
                .level
        };
        assert_eq!(
            (level("Heading2"), level("Heading3"), level("Normal")),
            (1, 2, 0)
        );
    }
}
