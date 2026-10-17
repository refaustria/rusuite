//! Field results computed from the document: cross-references (`REF`,
//! `PAGEREF`, `NOTEREF`), sequence numbers (`SEQ`, Word's caption
//! numbers) and document properties (`TITLE`, `AUTHOR`, `SUBJECT`,
//! `KEYWORDS`, `COMMENTS`, `LASTSAVEDBY`, `DOCPROPERTY`; `SAVEDATE` is
//! formatted by the UI, like `DATE`).
//!
//! Page numbers come from the UI's pagination (as for `PAGE`): the caller
//! passes the page of each paragraph it knows.

use std::collections::HashMap;

use crate::block::{Block, NodeId, Paragraph};
use crate::document::{paragraphs_in, Document};
use crate::inline::{FieldKind, Inline, NoteKind};
use crate::link::BookmarkRange;
use crate::numbering::LevelKind;

/// What Word shows for a reference to a missing bookmark.
pub const REF_ERROR: &str = "Error! Reference source not found.";

/// What Word shows for a `STYLEREF` whose style no paragraph has.
pub const STYLEREF_ERROR: &str = "Error! No text of specified style in document.";

/// One computed field result: paragraph, char offset of the field, text.
pub type FieldValue = (NodeId, usize, String);

impl Document {
    /// The display number of every note reference: footnotes 1, 2, …,
    /// endnotes i, ii, … in the order of their first reference in the body.
    pub fn note_numbers(&self) -> HashMap<u32, String> {
        let mut out = HashMap::new();
        let (mut foot, mut end) = (0u32, 0u32);
        for p in self.paragraphs() {
            for i in &p.inlines {
                if let Inline::NoteRef(r) = i {
                    if out.contains_key(&r.id) {
                        continue;
                    }
                    let n = match r.kind {
                        NoteKind::Foot => {
                            foot += 1;
                            foot.to_string()
                        }
                        NoteKind::End => {
                            end += 1;
                            LevelKind::LowerRoman.format(end)
                        }
                    };
                    out.insert(r.id, n);
                }
            }
        }
        out
    }

    /// The results of the computable fields of the body (table cells
    /// included), notes, headers and footers: `SEQ` counted in document
    /// order per identifier (case-insensitive, `\r` resets, `\c` repeats,
    /// `\s n` restarts after headings of level ≤ n, `\h` hides), `REF` the
    /// bookmark's text (`\n`: the paragraph's list number, `\w` with its
    /// context, `\r` relative to the field, `\p` "above"/"below"),
    /// `PAGEREF` the page of the bookmark's start paragraph in `pages`
    /// (formatted like the section's page numbers; fields whose page is
    /// unknown are left out), `NOTEREF` the note number, `STYLEREF` the
    /// nearest paragraph of the style (see [`FieldKind::StyleRef`]),
    /// `TITLE`/`AUTHOR`/`SUBJECT`/`KEYWORDS`/`COMMENTS`/`LASTSAVEDBY`/
    /// `DOCPROPERTY` the properties (left out when empty). A missing
    /// bookmark gives [`REF_ERROR`]. Locked fields are left out.
    pub fn computed_fields(&self, pages: &HashMap<NodeId, u32>) -> Vec<FieldValue> {
        // Pass 1: sequence numbers (REF texts may contain them).
        let mut counters: HashMap<String, u32> = HashMap::new();
        let mut seq: Vec<FieldValue> = Vec::new();
        let resets = seq_heading_resets(self);
        for p in self.paragraphs() {
            if !resets.is_empty() {
                if let Some(level) = self.outline_level(p) {
                    for (key, reset) in &resets {
                        if level <= *reset {
                            counters.insert(key.clone(), 0);
                        }
                    }
                }
            }
            for_each_field(p, |at, field| {
                if let FieldKind::Seq {
                    identifier,
                    format,
                    reset,
                    current,
                    hidden,
                    ..
                } = &field.kind
                {
                    let c = counters.entry(identifier.to_lowercase()).or_insert(0);
                    *c = match (reset, current) {
                        (Some(r), _) => *r,
                        (None, true) => *c,
                        (None, false) => *c + 1,
                    };
                    if !field.locked {
                        let text = if *hidden {
                            String::new()
                        } else {
                            format.unwrap_or(LevelKind::Decimal).format(*c)
                        };
                        seq.push((p.id, at, text));
                    }
                }
            });
        }
        let mut doc = self.clone();
        doc.set_field_results(&seq);
        let bookmarks: HashMap<String, BookmarkRange> = doc
            .bookmarks()
            .into_iter()
            .map(|b| (b.name.to_lowercase(), b))
            .collect();
        let labels: HashMap<NodeId, String> = doc.list_numbers().into_iter().collect();
        let notes = doc.note_numbers();
        let order: HashMap<NodeId, usize> = doc
            .paragraphs()
            .enumerate()
            .map(|(i, p)| (p.id, i))
            .collect();
        let body: Vec<&Paragraph> = doc.paragraphs().collect();
        let mut out = seq;
        for c in doc.text_containers() {
            for p in paragraphs_in(c) {
                for_each_field(p, |at, field| {
                    if field.locked {
                        return;
                    }
                    let value = match &field.kind {
                        FieldKind::Title => doc.properties.title.clone(),
                        FieldKind::Author => doc.properties.author.clone(),
                        FieldKind::Subject => doc.properties.subject.clone(),
                        FieldKind::Keywords => doc.properties.keywords.clone(),
                        FieldKind::Comments => doc.properties.description.clone(),
                        FieldKind::LastSavedBy => doc.properties.last_modified_by.clone(),
                        FieldKind::DocProperty { name } => {
                            doc.properties.named(name).map(str::to_owned)
                        }
                        FieldKind::Ref {
                            bookmark,
                            number,
                            relative,
                            full,
                            position,
                            ..
                        } => Some(match bookmarks.get(&bookmark.to_lowercase()) {
                            None => REF_ERROR.to_owned(),
                            Some(b) => {
                                let numbered = *number || *relative || *full;
                                let mut text = if numbered {
                                    let mut chain =
                                        doc.number_chain(&body, &order, &labels, b.start_block);
                                    let mut chain = if *full || !*relative {
                                        chain
                                    } else {
                                        let here = doc.number_chain(&body, &order, &labels, p.id);
                                        let common = chain
                                            .iter()
                                            .zip(&here)
                                            .take(chain.len().saturating_sub(1))
                                            .take_while(|(a, b)| a == b)
                                            .count();
                                        chain.split_off(common)
                                    };
                                    if *number && !*full && !*relative {
                                        chain = chain.split_off(chain.len().saturating_sub(1));
                                    }
                                    if chain.is_empty() {
                                        doc.bookmark_text(b)
                                    } else if *full || *relative {
                                        chain.join(".")
                                    } else {
                                        labels
                                            .get(&b.start_block)
                                            .map(|l| l.trim_end_matches(['.', ')']).to_owned())
                                            .unwrap_or_else(|| chain.join("."))
                                    }
                                } else if *position {
                                    String::new()
                                } else {
                                    doc.bookmark_text(b)
                                };
                                if *position {
                                    let here = order.get(&p.id).copied();
                                    let there = order.get(&b.start_block).copied();
                                    let above = match (here, there) {
                                        (Some(h), Some(t)) => t < h || (t == h && b.start < at),
                                        _ => true,
                                    };
                                    let word = if above { "above" } else { "below" };
                                    text = if text.is_empty() {
                                        word.to_owned()
                                    } else {
                                        format!("{text} {word}")
                                    };
                                }
                                text
                            }
                        }),
                        FieldKind::PageRef { bookmark, .. } => {
                            match bookmarks.get(&bookmark.to_lowercase()) {
                                None => Some(REF_ERROR.to_owned()),
                                Some(b) => pages
                                    .get(&b.start_block)
                                    .map(|&n| doc.page_text(b.start_block, n)),
                            }
                        }
                        FieldKind::NoteRef { bookmark, .. } => {
                            Some(match bookmarks.get(&bookmark.to_lowercase()) {
                                None => REF_ERROR.to_owned(),
                                Some(b) => doc
                                    .note_in(b)
                                    .and_then(|id| notes.get(&id).cloned())
                                    .unwrap_or_else(|| REF_ERROR.to_owned()),
                            })
                        }
                        FieldKind::StyleRef {
                            style,
                            last,
                            number,
                        } => Some(
                            doc.style_ref(&body, &order, pages, p.id, style, *last)
                                .map(|q| {
                                    if *number {
                                        labels
                                            .get(&q.id)
                                            .map(|l| l.trim_end_matches(['.', ')']).to_owned())
                                            .unwrap_or_default()
                                    } else {
                                        q.display_text().trim().to_owned()
                                    }
                                })
                                .unwrap_or_else(|| STYLEREF_ERROR.to_owned()),
                        ),
                        _ => None,
                    };
                    if let Some(v) = value.filter(|v| !v.is_empty()) {
                        out.push((p.id, at, v));
                    }
                });
            }
        }
        out
    }

    /// Page `n` formatted like the page numbers of the section holding
    /// body block `block`.
    fn page_text(&self, block: NodeId, n: u32) -> String {
        self.section_index_of(block)
            .and_then(|i| self.sections.get(i))
            .and_then(|s| s.page_number_format)
            .unwrap_or(LevelKind::Decimal)
            .format(n)
    }

    /// The list numbers of `block` and its parent items (the nearest
    /// earlier paragraphs of the same list at each lower level), each
    /// without trailing punctuation: `["1", "2", "a"]` for item 1.2.a.
    fn number_chain(
        &self,
        body: &[&Paragraph],
        order: &HashMap<NodeId, usize>,
        labels: &HashMap<NodeId, String>,
        block: NodeId,
    ) -> Vec<String> {
        let Some(&i) = order.get(&block) else {
            return Vec::new();
        };
        let Some(num) = body[i].props.numbering else {
            return labels
                .get(&block)
                .map(|l| vec![last_number(l)])
                .unwrap_or_default();
        };
        let mut chain = vec![last_number(labels.get(&block).map_or("", String::as_str))];
        let mut level = num.level;
        for q in body[..i].iter().rev() {
            if level == 0 {
                break;
            }
            match q.props.numbering {
                Some(n) if n.num_id == num.num_id && n.level < level => {
                    chain.push(last_number(labels.get(&q.id).map_or("", String::as_str)));
                    level = n.level;
                }
                _ => {}
            }
        }
        chain.reverse();
        chain.retain(|c| !c.is_empty());
        chain
    }

    /// Whether paragraph `p` is in style `style` (its id or name, or for a
    /// number `n` Heading n).
    fn in_style(&self, p: &Paragraph, style: &str) -> bool {
        if let Ok(n) = style.trim().parse::<u8>() {
            return self.outline_level(p) == Some(n)
                && p.props
                    .style
                    .as_deref()
                    .is_some_and(|s| s.to_ascii_lowercase().starts_with("heading"));
        }
        let Some(id) = p.props.style.as_deref() else {
            return style.eq_ignore_ascii_case("Normal");
        };
        id.eq_ignore_ascii_case(style)
            || self
                .styles
                .get(id)
                .is_some_and(|s| s.name.eq_ignore_ascii_case(style))
    }

    /// The paragraph a `STYLEREF style` field at paragraph `at` shows: in
    /// the body the nearest one at or before it (else the first after
    /// it); in a header or footer the first (`last`: the last) one on the
    /// section's first page in `pages`, else the nearest one before that
    /// page, else the first one of the section; in notes the first one.
    fn style_ref<'a>(
        &self,
        body: &[&'a Paragraph],
        order: &HashMap<NodeId, usize>,
        pages: &HashMap<NodeId, u32>,
        at: NodeId,
        style: &str,
        last: bool,
    ) -> Option<&'a Paragraph> {
        let matches = |p: &&&Paragraph| self.in_style(p, style);
        if let Some(&i) = order.get(&at) {
            return body[..=i]
                .iter()
                .rev()
                .find(matches)
                .or_else(|| body[i..].iter().find(matches))
                .copied();
        }
        let Some(section) = self.header_of_block(at) else {
            return body.iter().find(matches).copied();
        };
        let in_section: Vec<&&Paragraph> = body
            .iter()
            .filter(|p| self.section_index_of(p.id) == Some(section))
            .collect();
        let first_page = in_section.iter().find_map(|p| pages.get(&p.id)).copied();
        if let Some(page) = first_page {
            let on_page: Vec<&&Paragraph> = in_section
                .iter()
                .copied()
                .filter(|p| pages.get(&p.id) == Some(&page))
                .collect();
            let found = if last {
                on_page.iter().rev().find(|p| matches(p))
            } else {
                on_page.iter().find(|p| matches(p))
            };
            if let Some(p) = found {
                return Some(**p);
            }
            let start = on_page
                .first()
                .and_then(|p| order.get(&p.id))
                .copied()
                .unwrap_or(0);
            if let Some(p) = body[..start].iter().rev().find(matches) {
                return Some(*p);
            }
        }
        in_section.into_iter().find(|p| matches(p)).copied()
    }

    /// Sets the cached result of the fields at `values` (unknown positions
    /// are ignored); returns the ones that changed with their old text.
    pub fn set_field_results(&mut self, values: &[FieldValue]) -> Vec<FieldValue> {
        let mut by_block: HashMap<NodeId, Vec<(usize, &str)>> = HashMap::new();
        for (b, at, v) in values {
            by_block.entry(*b).or_default().push((*at, v));
        }
        let mut old = Vec::new();
        for (block, list) in by_block {
            let Some(Block::Paragraph(p)) = self.find_block_mut(block) else {
                continue;
            };
            let mut pos = 0;
            for inline in &mut p.inlines {
                let len = match inline {
                    Inline::Run(r) => r.text.chars().count(),
                    _ => 1,
                };
                if let Inline::Field(f) = inline {
                    if f.locked {
                        pos += len;
                        continue;
                    }
                    if let Some((_, v)) = list.iter().find(|(at, _)| *at == pos) {
                        if f.cached != *v {
                            old.push((
                                block,
                                pos,
                                std::mem::replace(&mut f.cached, (*v).to_owned()),
                            ));
                        }
                    }
                }
                pos += len;
            }
        }
        old
    }

    /// The note whose reference mark lies inside bookmark `b`.
    fn note_in(&self, b: &BookmarkRange) -> Option<u32> {
        let mut inside = false;
        for c in self.text_containers() {
            for p in paragraphs_in(c) {
                if !inside && p.id != b.start_block {
                    continue;
                }
                inside = true;
                let mut pos = 0;
                for i in &p.inlines {
                    let after_start = p.id != b.start_block || pos >= b.start;
                    let before_end = p.id != b.end_block || pos < b.end;
                    if let Inline::NoteRef(r) = i {
                        if after_start && before_end {
                            return Some(r.id);
                        }
                    }
                    pos += match i {
                        Inline::Run(r) => r.text.chars().count(),
                        _ => 1,
                    };
                }
                if p.id == b.end_block {
                    return None;
                }
            }
        }
        None
    }

    /// Caption paragraphs of sequence `identifier` (paragraphs of the body
    /// holding a `SEQ identifier` field), in document order.
    pub fn captions(&self, identifier: &str) -> Vec<&Paragraph> {
        self.paragraphs()
            .filter(|p| {
                p.inlines.iter().any(|i| {
                    matches!(i, Inline::Field(f) if matches!(&f.kind,
                        FieldKind::Seq { identifier: id, .. } if id.eq_ignore_ascii_case(identifier)))
                })
            })
            .collect()
    }
}

/// The last number of a list label (`1.2.a)` → `a`, `(iv)` → `iv`).
fn last_number(label: &str) -> String {
    let t = label.trim().trim_matches(['.', ')', '(', ' ']);
    t.rsplit(['.', ')', '('])
        .find(|s| !s.is_empty())
        .unwrap_or(t)
        .to_owned()
}

/// `(identifier, level)` of the `SEQ … \s level` fields anywhere in the
/// document (their counters restart after headings of level ≤ `level`).
fn seq_heading_resets(doc: &Document) -> Vec<(String, u8)> {
    let mut out: Vec<(String, u8)> = Vec::new();
    for p in doc.paragraphs() {
        for_each_field(p, |_, f| {
            if let FieldKind::Seq {
                identifier,
                heading_reset: Some(l),
                ..
            } = &f.kind
            {
                let id = identifier.to_lowercase();
                if !out.iter().any(|(i, _)| *i == id) {
                    out.push((id, *l));
                }
            }
        });
    }
    out
}

/// Calls `f(offset, field)` for every field of `p`.
fn for_each_field(p: &Paragraph, mut f: impl FnMut(usize, &crate::inline::Field)) {
    let mut pos = 0;
    for i in &p.inlines {
        if let Inline::Field(field) = i {
            f(pos, field);
        }
        pos += match i {
            Inline::Run(r) => r.text.chars().count(),
            _ => 1,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inline::{Field, NoteRef, Run};
    use crate::link::BookmarkId;
    use crate::section::Note;
    use core_model::RunProperties;

    fn field(kind: FieldKind) -> Inline {
        Inline::Field(Field::new(kind))
    }
    fn seq(id: &str) -> Inline {
        field(FieldKind::Seq {
            identifier: id.into(),
            format: None,
            reset: None,
            current: false,
            hidden: false,
            heading_reset: None,
        })
    }
    fn run(t: &str) -> Inline {
        Inline::Run(Run::new(t))
    }

    fn doc_with(paras: Vec<Vec<Inline>>) -> Document {
        let mut doc = Document::new();
        doc.body.clear();
        for inl in paras {
            let mut p = Paragraph::new(doc.alloc_id());
            p.inlines = inl;
            doc.body.push(Block::Paragraph(p));
        }
        doc.normalize();
        doc
    }

    fn value(vals: &[FieldValue], doc: &Document, para: usize) -> Vec<String> {
        let id = doc.body[para].id();
        vals.iter()
            .filter(|v| v.0 == id)
            .map(|v| v.2.clone())
            .collect()
    }

    #[test]
    fn sequences_count_per_identifier_in_document_order() {
        let doc = doc_with(vec![
            vec![run("Figure "), seq("Figure"), run(": a")],
            vec![run("Table "), seq("Table")],
            vec![run("Figure "), seq("figure")],
            vec![
                run("Figure "),
                field(FieldKind::Seq {
                    identifier: "Figure".into(),
                    format: Some(LevelKind::UpperRoman),
                    reset: None,
                    current: false,
                    hidden: false,
                    heading_reset: None,
                }),
            ],
            vec![field(FieldKind::Seq {
                identifier: "Table".into(),
                format: None,
                reset: Some(7),
                current: false,
                hidden: false,
                heading_reset: None,
            })],
        ]);
        let v = doc.computed_fields(&HashMap::new());
        assert_eq!(value(&v, &doc, 0), ["1"]);
        assert_eq!(value(&v, &doc, 1), ["1"]);
        assert_eq!(value(&v, &doc, 2), ["2"]);
        assert_eq!(value(&v, &doc, 3), ["III"]);
        assert_eq!(value(&v, &doc, 4), ["7"]);
        assert_eq!(doc.captions("FIGURE").len(), 3);
    }

    #[test]
    fn references_take_text_page_and_numbers() {
        let mut doc = doc_with(vec![
            vec![
                Inline::BookmarkStart {
                    id: BookmarkId(1),
                    name: "_Ref1".into(),
                },
                run("Figure "),
                seq("Figure"),
                Inline::BookmarkEnd { id: BookmarkId(1) },
                run(": cat"),
            ],
            vec![
                run("See "),
                field(FieldKind::Ref {
                    bookmark: "_ref1".into(),
                    hyperlink: true,
                    number: false,
                    relative: false,
                    full: false,
                    position: false,
                }),
                run(" on page "),
                field(FieldKind::PageRef {
                    bookmark: "_Ref1".into(),
                    hyperlink: true,
                }),
                field(FieldKind::Ref {
                    bookmark: "missing".into(),
                    hyperlink: false,
                    number: false,
                    relative: false,
                    full: false,
                    position: false,
                }),
            ],
            vec![
                run("x"),
                Inline::BookmarkStart {
                    id: BookmarkId(2),
                    name: "note".into(),
                },
                Inline::NoteRef(NoteRef {
                    id: 5,
                    kind: NoteKind::Foot,
                    props: RunProperties::default(),
                }),
                Inline::BookmarkEnd { id: BookmarkId(2) },
                field(FieldKind::NoteRef {
                    bookmark: "note".into(),
                    hyperlink: true,
                    formatted: false,
                }),
                field(FieldKind::Title),
            ],
        ]);
        doc.notes.push(Note {
            id: 5,
            kind: NoteKind::Foot,
            blocks: Vec::new(),
        });
        doc.properties.title = Some("Report".into());
        let first = doc.body[0].id();
        let pages = HashMap::from([(first, 3)]);
        let v = doc.computed_fields(&pages);
        assert_eq!(value(&v, &doc, 1), ["Figure 1", "3", REF_ERROR]);
        assert_eq!(value(&v, &doc, 2), ["1", "Report"]);
        // Without the page, PAGEREF is left alone.
        let v = doc.computed_fields(&HashMap::new());
        assert_eq!(value(&v, &doc, 1), ["Figure 1", REF_ERROR]);
        // Applying the values sets the cached results once.
        let changed = doc.set_field_results(&doc.computed_fields(&pages));
        assert_eq!(changed.len(), 6);
        assert!(doc
            .set_field_results(&doc.computed_fields(&pages))
            .is_empty());
    }

    #[test]
    fn number_only_references_use_the_list_label() {
        use crate::numbering::NumberingDef;
        use crate::props::NumberingRef;
        let mut doc = doc_with(vec![
            vec![
                Inline::BookmarkStart {
                    id: BookmarkId(1),
                    name: "item".into(),
                },
                run("First"),
                Inline::BookmarkEnd { id: BookmarkId(1) },
            ],
            vec![field(FieldKind::Ref {
                bookmark: "item".into(),
                hyperlink: false,
                number: true,
                relative: false,
                full: false,
                position: false,
            })],
        ]);
        doc.numbering.insert(NumberingDef::decimal_default(1));
        if let Block::Paragraph(p) = &mut doc.body[0] {
            p.props.numbering = Some(NumberingRef {
                num_id: 1,
                level: 0,
            });
        }
        let v = doc.computed_fields(&HashMap::new());
        assert_eq!(value(&v, &doc, 1), ["1"]);
    }

    #[test]
    fn property_fields_take_the_document_properties() {
        let mut doc = doc_with(vec![vec![
            field(FieldKind::Subject),
            field(FieldKind::Keywords),
            field(FieldKind::Comments),
            field(FieldKind::LastSavedBy),
            field(FieldKind::DocProperty {
                name: "Company".into(),
            }),
            field(FieldKind::SaveDate { format: None }),
        ]]);
        doc.properties.subject = Some("Budget".into());
        doc.properties.keywords = Some("q3".into());
        doc.properties.description = Some("Draft".into());
        doc.properties.last_modified_by = Some("Ann".into());
        doc.properties.company = Some("ACME".into());
        let v = doc.computed_fields(&HashMap::new());
        // SAVEDATE is formatted by the UI.
        assert_eq!(value(&v, &doc, 0), ["Budget", "q3", "Draft", "Ann", "ACME"]);
        doc.properties.company = None;
        let v = doc.computed_fields(&HashMap::new());
        assert_eq!(value(&v, &doc, 0).len(), 4);
    }

    fn seq_with(id: &str, current: bool, hidden: bool, heading_reset: Option<u8>) -> Inline {
        field(FieldKind::Seq {
            identifier: id.into(),
            format: None,
            reset: None,
            current,
            hidden,
            heading_reset,
        })
    }

    #[test]
    fn sequence_switches_repeat_hide_and_restart_at_headings() {
        let mut doc = doc_with(vec![
            vec![run("Chapter A")],
            vec![seq_with("Fig", false, false, Some(1))],
            vec![seq_with("Fig", true, false, None)],
            vec![seq_with("Fig", false, true, None)],
            vec![run("Chapter B")],
            vec![seq_with("Fig", false, false, None)],
        ]);
        for i in [0, 4] {
            if let Block::Paragraph(p) = &mut doc.body[i] {
                p.props.style = Some("Heading1".into());
            }
        }
        let v = doc.computed_fields(&HashMap::new());
        assert_eq!(value(&v, &doc, 1), ["1"]);
        // \c repeats the current number.
        assert_eq!(value(&v, &doc, 2), ["1"]);
        // \h counts (2) but shows nothing.
        assert_eq!(value(&v, &doc, 3), [""]);
        // \s 1: restarted after the second Heading 1.
        assert_eq!(value(&v, &doc, 5), ["1"]);
        let k = FieldKind::parse(r#"SEQ Fig \* ARABIC \c \s 1 \h"#).unwrap();
        assert_eq!(
            k,
            FieldKind::Seq {
                identifier: "Fig".into(),
                format: None,
                reset: None,
                current: true,
                hidden: true,
                heading_reset: Some(1),
            }
        );
        assert_eq!(FieldKind::parse(&k.instruction()), Some(k));
    }

    fn reff(bookmark: &str, number: bool, relative: bool, full: bool, position: bool) -> Inline {
        field(FieldKind::Ref {
            bookmark: bookmark.into(),
            hyperlink: false,
            number,
            relative,
            full,
            position,
        })
    }

    #[test]
    fn reference_switches_number_context_and_position() {
        use crate::numbering::NumberingDef;
        use crate::props::NumberingRef;
        let mut doc = doc_with(vec![
            vec![run("Top")],
            vec![
                Inline::BookmarkStart {
                    id: BookmarkId(1),
                    name: "sub".into(),
                },
                run("Sub"),
                Inline::BookmarkEnd { id: BookmarkId(1) },
            ],
            vec![reff("sub", true, false, false, false)],
            vec![reff("sub", false, false, true, false)],
            vec![reff("sub", false, true, false, false)],
            vec![reff("sub", false, false, false, true)],
            vec![reff("sub", true, false, false, true)],
        ]);
        let mut def = NumberingDef::decimal_default(1);
        def.levels[1].text = "%2)".into();
        doc.numbering.insert(def);
        let levels = [Some(0), Some(1), None, None, Some(1), None, None];
        for (i, l) in levels.iter().enumerate() {
            if let (Some(l), Block::Paragraph(p)) = (l, &mut doc.body[i]) {
                p.props.numbering = Some(NumberingRef {
                    num_id: 1,
                    level: *l,
                });
            }
        }
        let v = doc.computed_fields(&HashMap::new());
        // \n: the label as shown (level 2 is `a)`), without punctuation.
        assert_eq!(value(&v, &doc, 2), ["a"]);
        // \w: with its context (item 1, sub-item a).
        assert_eq!(value(&v, &doc, 3), ["1.a"]);
        // \r from a paragraph in the same list under the same parent.
        assert_eq!(value(&v, &doc, 4), ["a"]);
        // \p alone: above; with \n: number + above.
        assert_eq!(value(&v, &doc, 5), ["above"]);
        assert_eq!(value(&v, &doc, 6), ["a above"]);
        let k = FieldKind::parse(r"REF sub \w \p \h").unwrap();
        assert!(matches!(
            k,
            FieldKind::Ref {
                full: true,
                position: true,
                hyperlink: true,
                number: false,
                ..
            }
        ));
        assert_eq!(FieldKind::parse(&k.instruction()), Some(k));
    }

    #[test]
    fn style_references_in_body_and_headers() {
        use crate::section::HeaderSlot;
        let mut doc = doc_with(vec![
            vec![run("Intro")],
            vec![run("text")],
            vec![run("Methods")],
            vec![field(FieldKind::StyleRef {
                style: "Heading 1".into(),
                last: false,
                number: false,
            })],
            vec![field(FieldKind::StyleRef {
                style: "Missing".into(),
                last: false,
                number: false,
            })],
        ]);
        for i in [0, 2] {
            if let Block::Paragraph(p) = &mut doc.body[i] {
                p.props.style = Some("Heading1".into());
            }
        }
        let mut hp = Paragraph::new(doc.alloc_id());
        hp.inlines = vec![field(FieldKind::StyleRef {
            style: "Heading 1".into(),
            last: true,
            number: false,
        })];
        let hid = hp.id;
        *doc.sections[0].headers.get_mut(HeaderSlot::Default) = Some(vec![Block::Paragraph(hp)]);
        let v = doc.computed_fields(&HashMap::new());
        assert_eq!(value(&v, &doc, 3), ["Methods"]);
        assert_eq!(value(&v, &doc, 4), [STYLEREF_ERROR]);
        // Without pages, the header takes the section's first one.
        let h: Vec<_> = v
            .iter()
            .filter(|x| x.0 == hid)
            .map(|x| x.2.clone())
            .collect();
        assert_eq!(h, ["Intro"]);
        // With pages: the last Heading 1 on the first page (\l).
        let pages: HashMap<NodeId, u32> = doc.body.iter().map(|b| (b.id(), 1)).collect();
        let v = doc.computed_fields(&pages);
        let h: Vec<_> = v
            .iter()
            .filter(|x| x.0 == hid)
            .map(|x| x.2.clone())
            .collect();
        assert_eq!(h, ["Methods"]);
        let k = FieldKind::parse(r#"STYLEREF "Heading 1" \l \* MERGEFORMAT"#).unwrap();
        assert_eq!(
            k,
            FieldKind::StyleRef {
                style: "Heading 1".into(),
                last: true,
                number: false
            }
        );
        assert_eq!(FieldKind::parse(&k.instruction()), Some(k));
        assert_eq!(
            FieldKind::parse("SECTIONPAGES"),
            Some(FieldKind::SectionPages)
        );
    }

    #[test]
    fn locked_fields_keep_their_result() {
        let mut doc = doc_with(vec![vec![seq("Figure"), seq("Figure")]]);
        if let Block::Paragraph(p) = &mut doc.body[0] {
            if let Inline::Field(f) = &mut p.inlines[0] {
                f.locked = true;
                f.cached = "9".into();
            }
        }
        let v = doc.computed_fields(&HashMap::new());
        // The locked one still counts.
        assert_eq!(value(&v, &doc, 0), ["2"]);
        let id = doc.body[0].id();
        assert!(doc.set_field_results(&[(id, 0, "1".into())]).is_empty());
        let json = serde_json::to_value(&doc.body[0]).unwrap();
        assert!(json.to_string().contains(r#""locked":true"#));
    }
}
