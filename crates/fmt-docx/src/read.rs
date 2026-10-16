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
use model_text::{
    Block, BreakKind, CellProperties, Document, Field, FieldKind, HeightRule, Inline, InlineImage,
    MediaId, Note, NoteKind, NoteRef, PageSetup, Paragraph, RowHeight, RowProperties, Run, Section,
    SectionId, StyleSheet, Table, TableCell, TableLayout, TableProperties, TableRow, TableWidth,
    Toc, VAlign, VMerge,
};
use model_text::{Comment, CommentId};

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
    /// Human-readable notes about content that was dropped or approximated.
    pub warnings: Vec<String>,
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
    let main_data = &pkg
        .part(&main)
        .ok_or_else(|| Error::MissingPart(main.to_string()))?
        .data;
    let mut consumed: BTreeSet<PartName> = BTreeSet::new();
    consumed.insert(main.clone());
    for p in ["/docProps/core.xml", "/docProps/app.xml"] {
        consumed.insert(PartName::new(p)?);
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

    let mut context = DocxContext::default();
    if let Some((name, data)) = data_of("theme") {
        context.theme = Some(parse_theme(data, name.as_str()).map_err(xml_error)?);
        if pkg.relationships(name).is_some_and(|r| !r.is_empty()) {
            w.add(format!(
                "{name}: theme has its own relationships; replaced by the built-in theme"
            ));
        } else {
            context.theme_xml = Some(data.to_vec());
        }
        consumed.insert(name.clone());
    }
    if let Some((name, data)) = data_of("settings") {
        if pkg.relationships(name).is_some_and(|r| !r.is_empty()) {
            w.add(format!(
                "{name}: settings have their own relationships; replaced by default settings"
            ));
        } else {
            let settings = parse(data, name.as_str())?;
            context.footnote_separators = separator_ids(&settings, "footnotePr", "footnote");
            context.endnote_separators = separator_ids(&settings, "endnotePr", "endnote");
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
    if let Some(n) = numbering {
        doc.numbering = n.numbering;
        context.numbering = n.instances;
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
            let what = if *footer { "footer" } else { "header" };
            let part = pkg
                .relationships(&main)
                .and_then(|r| r.get(rid))
                .filter(|r| r.target_mode == TargetMode::Internal)
                .and_then(|r| main.resolve(&r.target).ok());
            let Some(part) = part else {
                w.add(format!("{what} with dangling relationship {rid} dropped"));
                continue;
            };
            let Some(data) = pkg.part(&part).map(|p| p.data.as_slice()) else {
                w.add(format!("{what} part {part} missing; dropped"));
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
    for (id, (from, to), lines) in tocs {
        let mut entries = doc.build_toc(from, to);
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
            w.add(format!("part {name} ({}) dropped", part.content_type));
        }
    }
    Ok(ReadOutput {
        document: doc,
        context,
        warnings: w.into_vec(),
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
        w.add("footnote/endnote references without a note dropped");
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
type ReadToc = (model_text::NodeId, (u8, u8), Vec<(String, Option<u32>)>);

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
const SILENT_BLOCK: &[&str] = &[
    "sectPr",
    "bookmarkStart",
    "bookmarkEnd",
    "proofErr",
    "permStart",
    "permEnd",
];

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
        self.tocs.push((t.id, scan.levels, scan.lines));
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
                "del" | "moveFrom" => self.w.add("tracked deletions dropped"),
                "tcPr" | "trPr" | "tblPr" => {}
                "AlternateContent" => {
                    if let Some(c) = el.child("Choice") {
                        self.collect_blocks(c, out);
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
                _ => self.w.add(format!("block element {} dropped", el.qname())),
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
                    self.w.add("section break outside the main text dropped");
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
                    self.w.add("hyperlink targets dropped (link text kept)");
                    self.read_content(el, out);
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
                                self.w.add(FLATTENED);
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
                "del" | "moveFrom" => self.w.add("tracked deletions dropped"),
                "bookmarkStart" => {
                    let toc = el
                        .attr("name")
                        .is_some_and(|n| n.len() > 4 && n[..4].eq_ignore_ascii_case("_toc"));
                    if toc {
                        // Targets of table-of-contents entries: regenerated.
                        if let Some(id) = el.attr("id") {
                            self.toc_bookmarks.insert(id.to_owned());
                        }
                    } else {
                        self.w.add("bookmarks dropped");
                    }
                }
                "bookmarkEnd" => {
                    if !el
                        .attr("id")
                        .is_some_and(|id| self.toc_bookmarks.contains(id))
                    {
                        self.w.add("bookmarks dropped");
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
                "oMath" | "oMathPara" => self.w.add("equations dropped"),
                "proofErr" | "permStart" | "permEnd" => {}
                _ => self
                    .w
                    .add(format!("paragraph content {} dropped", el.qname())),
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
                        self.w.add(FLATTENED);
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
                        self.w.add(FLATTENED);
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
                        Some("column") => {
                            self.w.add("column break read as line break");
                            BreakKind::Line
                        }
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
                    self.w.add("symbol characters (w:sym) lose their font");
                }
                "drawing" => {
                    flush(text, props, out);
                    if let Some(img) = self.read_drawing(el) {
                        out.push(Inline::Image(img));
                    }
                }
                "AlternateContent" => {
                    if let Some(c) = el.child("Choice") {
                        self.run_children(c, props, text, out);
                    }
                }
                "pict" | "object" => self.w.add("VML pictures and embedded objects dropped"),
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
                _ => self.w.add(format!("run content {} dropped", el.qname())),
            }
        }
    }

    fn read_drawing(&mut self, d: &El) -> Option<InlineImage> {
        let (shape, floating) = match (d.child("inline"), d.child("anchor")) {
            (Some(i), _) => (i, false),
            (None, Some(a)) => (a, true),
            _ => return None,
        };
        let data = shape.find("graphicData");
        let blip = data.and_then(|g| g.find("blip"));
        let Some(rid) = blip.and_then(|b| b.attr("embed")) else {
            if blip.and_then(|b| b.attr("link")).is_some() {
                self.w.add("linked (external) images dropped");
            } else {
                self.w.add("drawing objects other than pictures dropped");
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
            self.w
                .add(format!("image with dangling relationship {rid} dropped"));
            return None;
        };
        let media = match self.media.get(&part_name) {
            Some(id) => *id,
            None => {
                let Some(part) = self.pkg.part(&part_name) else {
                    self.w
                        .add(format!("image part {part_name} missing; dropped"));
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
        Some(InlineImage {
            media,
            width: emu("cx"),
            height: emu("cy"),
            alt: attr("descr"),
            name: attr("name"),
            anchor: floating.then(|| read_anchor(shape, self.w)),
        })
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
                    _ => self
                        .w
                        .add(format!("table row property {} dropped", el.qname())),
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
                    "hMerge" => self
                        .w
                        .add("legacy horizontal merges (hMerge) read as separate cells"),
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
                    w.add(format!("{ctx}: table alignment dropped"));
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
            _ => w.add(format!("{ctx}: table property {} dropped", el.qname())),
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
            _ => w.add(format!("{ctx}: table cell property {} dropped", el.qname())),
        }
    }
    props
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
        w.add("floating image: simple positioning read as offset from the page");
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
                    w.add(format!(
                        "floating image: horizontal position relative to {other} read as relative to the margin"
                    ));
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
                    w.add(format!(
                        "floating image: vertical position relative to {other} read as relative to the margin"
                    ));
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
        w.add("floating image: behind-text flag on a wrapping image dropped");
    }
    anchor
}

/// Warning for fields that are not modelled.
const FLATTENED: &str =
    "fields other than PAGE, NUMPAGES, DATE, TIME, FILENAME and AUTHOR flattened to their current result";

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
