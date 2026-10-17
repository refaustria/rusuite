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
    /// order per identifier (case-insensitive, `\r` resets), `REF` the
    /// bookmark's text (`\n`: the paragraph's list number), `PAGEREF` the
    /// page of the bookmark's start paragraph in `pages` (formatted like
    /// the section's page numbers; fields whose page is unknown are left
    /// out), `NOTEREF` the note number, `TITLE`/`AUTHOR`/`SUBJECT`/
    /// `KEYWORDS`/`COMMENTS`/`LASTSAVEDBY`/`DOCPROPERTY` the properties
    /// (left out when empty). A missing bookmark gives [`REF_ERROR`].
    pub fn computed_fields(&self, pages: &HashMap<NodeId, u32>) -> Vec<FieldValue> {
        // Pass 1: sequence numbers (REF texts may contain them).
        let mut counters: HashMap<String, u32> = HashMap::new();
        let mut seq: Vec<FieldValue> = Vec::new();
        for p in self.paragraphs() {
            for_each_field(p, |at, kind| {
                if let FieldKind::Seq {
                    identifier,
                    format,
                    reset,
                } = kind
                {
                    let c = counters.entry(identifier.to_lowercase()).or_insert(0);
                    *c = reset.unwrap_or(*c + 1);
                    seq.push((p.id, at, format.unwrap_or(LevelKind::Decimal).format(*c)));
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
        let mut out = seq;
        for c in doc.text_containers() {
            for p in paragraphs_in(c) {
                for_each_field(p, |at, kind| {
                    let value = match kind {
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
                            bookmark, number, ..
                        } => Some(match bookmarks.get(&bookmark.to_lowercase()) {
                            None => REF_ERROR.to_owned(),
                            Some(b) if *number => match labels.get(&b.start_block) {
                                Some(l) => l.trim_end_matches(['.', ')']).to_owned(),
                                None => doc.bookmark_text(b),
                            },
                            Some(b) => doc.bookmark_text(b),
                        }),
                        FieldKind::PageRef { bookmark, .. } => {
                            match bookmarks.get(&bookmark.to_lowercase()) {
                                None => Some(REF_ERROR.to_owned()),
                                Some(b) => pages.get(&b.start_block).map(|&n| {
                                    let fmt = doc
                                        .section_index_of(b.start_block)
                                        .and_then(|i| doc.sections.get(i))
                                        .and_then(|s| s.page_number_format)
                                        .unwrap_or(LevelKind::Decimal);
                                    fmt.format(n)
                                }),
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

/// Calls `f(offset, kind)` for every field of `p`.
fn for_each_field(p: &Paragraph, mut f: impl FnMut(usize, &FieldKind)) {
    let mut pos = 0;
    for i in &p.inlines {
        if let Inline::Field(field) = i {
            f(pos, &field.kind);
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
                }),
            ],
            vec![field(FieldKind::Seq {
                identifier: "Table".into(),
                format: None,
                reset: Some(7),
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
}
