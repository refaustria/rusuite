//! The templates File › New offers besides the blank document: Report,
//! Letter, Memo and Minutes (English and German), built here and written
//! with our own writer as `.dotx` files to `apps/write/public/templates/`
//! (the UI fetches them and sends `newFromTemplate`).
//!
//! Regenerate the files with
//! `RUSUITE_WRITE_TEMPLATES=1 cargo test -p write-core templates`; without
//! the variable the test checks that the committed files are current.

use core_model::units::Twips;
use core_model::{FontSize, RunProperties};
use model_text::{
    Block, CellProperties, CoreProperties, Document, Field, FieldKind, Inline, NodeId,
    NumberingDef, NumberingRef, Paragraph, ParagraphBorders, Run, Table, TableCell,
    TableProperties, TableRow, TableWidth,
};

/// The built-in template ids, in the order File › New shows them.
pub const TEMPLATE_IDS: &[&str] = &["report", "letter", "memo", "minutes"];

/// The languages the templates exist in (`en` → `memo.dotx`, `de` →
/// `memo.de.dotx`).
pub const TEMPLATE_LANGS: &[&str] = &["en", "de"];

/// The file name of template `id` in `lang`.
pub fn template_file_name(id: &str, lang: &str) -> String {
    if lang == "en" {
        format!("{id}.dotx")
    } else {
        format!("{id}.{lang}.dotx")
    }
}

struct B {
    doc: Document,
    blocks: Vec<Block>,
}

fn run(text: &str) -> Inline {
    Inline::Run(Run::new(text))
}

fn bold(text: &str) -> Inline {
    Inline::Run(Run {
        props: RunProperties {
            bold: Some(true),
            ..Default::default()
        },
        ..Run::new(text)
    })
}

fn field(kind: FieldKind) -> Inline {
    Inline::Field(Field {
        kind,
        cached: String::new(),
        props: RunProperties::default(),
    })
}

impl B {
    fn new() -> Self {
        B {
            doc: Document::new(),
            blocks: Vec::new(),
        }
    }

    fn id(&mut self) -> NodeId {
        self.doc.alloc_id()
    }

    fn para(&mut self, style: Option<&str>, inlines: Vec<Inline>) -> &mut Paragraph {
        let mut p = Paragraph::new(self.id());
        p.props.style = style.map(str::to_owned);
        p.inlines = inlines;
        self.blocks.push(Block::Paragraph(p));
        match self.blocks.last_mut() {
            Some(Block::Paragraph(p)) => p,
            _ => unreachable!(),
        }
    }

    fn text(&mut self, style: Option<&str>, text: &str) -> &mut Paragraph {
        self.para(style, vec![run(text)])
    }

    /// A list of `items` with a new numbering definition.
    fn list(&mut self, numbered: bool, items: &[&str]) {
        let num_id = self.doc.numbering.next_id();
        self.doc.numbering.insert(if numbered {
            NumberingDef::decimal_default(num_id)
        } else {
            NumberingDef::bullet_default(num_id)
        });
        for item in items {
            self.text(Some("ListParagraph"), item).props.numbering =
                Some(NumberingRef { num_id, level: 0 });
        }
    }

    /// A Table Grid table, the first row bold.
    fn table(&mut self, rows: &[&[&str]], widths: &[i32]) {
        let mut out = Vec::new();
        for (r, row) in rows.iter().enumerate() {
            let mut cells = Vec::new();
            for (c, text) in row.iter().enumerate() {
                let mut p = Paragraph::new(self.id());
                p.inlines = vec![if r == 0 { bold(text) } else { run(text) }];
                p.props.spacing = Some(model_text::Spacing {
                    before: None,
                    after: Some(Twips(0)),
                    line: None,
                });
                let props = CellProperties {
                    width: Some(TableWidth::Twips(Twips(widths[c]))),
                    ..Default::default()
                };
                let id = self.id();
                cells.push(TableCell::new(id, props, vec![Block::Paragraph(p)]));
            }
            out.push(TableRow {
                id: self.id(),
                props: Default::default(),
                cells,
            });
        }
        let id = self.id();
        self.blocks.push(Block::Table(Table {
            id,
            props: TableProperties {
                style: Some("TableGrid".into()),
                col_widths: widths.iter().map(|w| Twips(*w)).collect(),
                ..Default::default()
            },
            rows: out,
        }));
    }

    fn finish(mut self, properties: CoreProperties, footer: Option<&str>) -> Document {
        if self.blocks.is_empty() {
            self.text(None, "");
        }
        self.doc.body = self.blocks;
        self.doc.properties = properties;
        self.doc.page.footer_text = footer.map(str::to_owned);
        // The one section is built again from the page setup (with the footer).
        self.doc.sections.clear();
        self.doc.normalize();
        self.doc
    }
}

/// The texts of a template in one language.
struct Texts {
    t: fn(&str) -> &'static str,
}

fn en(key: &str) -> &'static str {
    match key {
        "report.title" => "[Report Title]",
        "report.subtitle" => "[Subtitle or the date]",
        "report.h.intro" => "Introduction",
        "report.intro" => "[Start with the purpose of this report. To replace any placeholder text, select it and start typing. Use the styles of Home › Styles to keep the look consistent.]",
        "report.h.findings" => "Findings",
        "report.h.detail" => "[Detail]",
        "report.findings" => "[Summarize what you found.]",
        "report.point1" => "[First point]",
        "report.point2" => "[Second point]",
        "report.point3" => "[Third point]",
        "report.h.conclusion" => "Conclusion",
        "report.conclusion" => "[Wrap up and name the next steps.]",
        "report.footer" => "Page {PAGE}",
        "report.name" => "Report",
        "letter.sender" => "[Your Name]\n[Street Address]\n[City, Postal Code]",
        "letter.recipient" => "[Recipient Name]\n[Company]\n[Street Address]\n[City, Postal Code]",
        "letter.subject" => "[Subject]",
        "letter.salutation" => "Dear [Recipient],",
        "letter.body" => "[Write the text of your letter here. To replace any placeholder text, select it and start typing.]",
        "letter.closing" => "Sincerely,",
        "letter.signature" => "[Your Name]",
        "letter.name" => "Letter",
        "memo.title" => "Memo",
        "memo.to" => "To:",
        "memo.from" => "From:",
        "memo.cc" => "CC:",
        "memo.date" => "Date:",
        "memo.re" => "Re:",
        "memo.to.value" => "[Recipient names]",
        "memo.from.value" => "[Your name]",
        "memo.cc.value" => "[Names]",
        "memo.re.value" => "[Subject]",
        "memo.body" => "[Type the text of the memo here. To replace any placeholder text, select it and start typing.]",
        "memo.name" => "Memo",
        "minutes.title" => "Meeting Minutes",
        "minutes.date" => "Date:",
        "minutes.time" => "Time:",
        "minutes.place" => "Location:",
        "minutes.attendees" => "Attendees:",
        "minutes.place.value" => "[Room or link]",
        "minutes.time.value" => "[Start – end]",
        "minutes.attendees.value" => "[Names]",
        "minutes.h.agenda" => "Agenda",
        "minutes.agenda1" => "[Topic one]",
        "minutes.agenda2" => "[Topic two]",
        "minutes.agenda3" => "[Topic three]",
        "minutes.h.notes" => "Discussion",
        "minutes.notes" => "[Summarize the discussion and the decisions.]",
        "minutes.h.actions" => "Action Items",
        "minutes.action" => "Action",
        "minutes.owner" => "Owner",
        "minutes.due" => "Due",
        "minutes.action1" => "[Task]",
        "minutes.owner1" => "[Name]",
        "minutes.due1" => "[Date]",
        "minutes.footer" => "Page {PAGE}",
        "minutes.name" => "Minutes",
        _ => "",
    }
}

fn de(key: &str) -> &'static str {
    match key {
        "report.title" => "[Titel des Berichts]",
        "report.subtitle" => "[Untertitel oder Datum]",
        "report.h.intro" => "Einleitung",
        "report.intro" => "[Beginne mit dem Zweck dieses Berichts. Um einen Platzhaltertext zu ersetzen, markiere ihn und tippe los. Mit den Formatvorlagen unter Start › Formatvorlagen bleibt das Aussehen einheitlich.]",
        "report.h.findings" => "Ergebnisse",
        "report.h.detail" => "[Detail]",
        "report.findings" => "[Fasse zusammen, was du herausgefunden hast.]",
        "report.point1" => "[Erster Punkt]",
        "report.point2" => "[Zweiter Punkt]",
        "report.point3" => "[Dritter Punkt]",
        "report.h.conclusion" => "Fazit",
        "report.conclusion" => "[Fasse zusammen und nenne die nächsten Schritte.]",
        "report.footer" => "Seite {PAGE}",
        "report.name" => "Bericht",
        "letter.sender" => "[Dein Name]\n[Straße und Hausnummer]\n[PLZ Ort]",
        "letter.recipient" => "[Name des Empfängers]\n[Firma]\n[Straße und Hausnummer]\n[PLZ Ort]",
        "letter.subject" => "[Betreff]",
        "letter.salutation" => "Sehr geehrte Damen und Herren,",
        "letter.body" => "[Schreib hier den Text deines Briefs. Um einen Platzhaltertext zu ersetzen, markiere ihn und tippe los.]",
        "letter.closing" => "Mit freundlichen Grüßen",
        "letter.signature" => "[Dein Name]",
        "letter.name" => "Brief",
        "memo.title" => "Aktennotiz",
        "memo.to" => "An:",
        "memo.from" => "Von:",
        "memo.cc" => "Cc:",
        "memo.date" => "Datum:",
        "memo.re" => "Betreff:",
        "memo.to.value" => "[Namen der Empfänger]",
        "memo.from.value" => "[Dein Name]",
        "memo.cc.value" => "[Namen]",
        "memo.re.value" => "[Betreff]",
        "memo.body" => "[Schreib hier den Text der Notiz. Um einen Platzhaltertext zu ersetzen, markiere ihn und tippe los.]",
        "memo.name" => "Aktennotiz",
        "minutes.title" => "Besprechungsprotokoll",
        "minutes.date" => "Datum:",
        "minutes.time" => "Uhrzeit:",
        "minutes.place" => "Ort:",
        "minutes.attendees" => "Teilnehmer:",
        "minutes.place.value" => "[Raum oder Link]",
        "minutes.time.value" => "[Beginn – Ende]",
        "minutes.attendees.value" => "[Namen]",
        "minutes.h.agenda" => "Tagesordnung",
        "minutes.agenda1" => "[Erstes Thema]",
        "minutes.agenda2" => "[Zweites Thema]",
        "minutes.agenda3" => "[Drittes Thema]",
        "minutes.h.notes" => "Besprechung",
        "minutes.notes" => "[Fasse die Diskussion und die Beschlüsse zusammen.]",
        "minutes.h.actions" => "Aufgaben",
        "minutes.action" => "Aufgabe",
        "minutes.owner" => "Verantwortlich",
        "minutes.due" => "Fällig",
        "minutes.action1" => "[Aufgabe]",
        "minutes.owner1" => "[Name]",
        "minutes.due1" => "[Datum]",
        "minutes.footer" => "Seite {PAGE}",
        "minutes.name" => "Protokoll",
        _ => "",
    }
}

/// A "Label:<tab>value" line (memo, minutes header).
fn label_line(b: &mut B, label: &str, value: Vec<Inline>) {
    let mut inlines = vec![bold(label), run("\t")];
    inlines.extend(value);
    let p = b.para(None, inlines);
    p.props.tabs = vec![model_text::TabStop {
        pos: Twips(1440),
        kind: model_text::TabKind::Left,
        leader: model_text::TabLeader::None,
    }];
    p.props.spacing = Some(model_text::Spacing {
        before: None,
        after: Some(Twips(60)),
        line: None,
    });
}

fn lines(b: &mut B, text: &str) {
    for l in text.split('\n') {
        b.text(Some("NoSpacing"), l);
    }
}

/// The template document `id` in `lang` (`None` for unknown ids or
/// languages).
pub fn template_document(id: &str, lang: &str) -> Option<Document> {
    let tx = Texts {
        t: match lang {
            "en" => en,
            "de" => de,
            _ => return None,
        },
    };
    let t = tx.t;
    let mut b = B::new();
    let date_format = if lang == "de" {
        "d. MMMM yyyy"
    } else {
        "MMMM d, yyyy"
    };
    let date = || {
        field(FieldKind::Date {
            format: Some(date_format.to_owned()),
        })
    };
    let (name, footer) = match id {
        "report" => {
            b.text(Some("Title"), t("report.title"));
            b.text(Some("Subtitle"), t("report.subtitle"));
            b.text(Some("Heading1"), t("report.h.intro"));
            b.text(None, t("report.intro"));
            b.text(Some("Heading1"), t("report.h.findings"));
            b.text(None, t("report.findings"));
            b.text(Some("Heading2"), t("report.h.detail"));
            b.list(
                false,
                &[t("report.point1"), t("report.point2"), t("report.point3")],
            );
            b.text(Some("Heading1"), t("report.h.conclusion"));
            b.text(None, t("report.conclusion"));
            (t("report.name"), Some(t("report.footer")))
        }
        "letter" => {
            lines(&mut b, t("letter.sender"));
            b.text(None, "");
            lines(&mut b, t("letter.recipient"));
            b.text(None, "");
            b.para(None, vec![date()]).props.alignment = Some(model_text::Alignment::Right);
            b.para(None, vec![bold(t("letter.subject"))]);
            b.text(None, t("letter.salutation"));
            b.text(None, t("letter.body"));
            b.text(None, t("letter.closing"));
            b.text(None, "");
            b.text(None, t("letter.signature"));
            (t("letter.name"), None)
        }
        "memo" => {
            b.text(Some("Title"), t("memo.title"));
            label_line(&mut b, t("memo.to"), vec![run(t("memo.to.value"))]);
            label_line(&mut b, t("memo.from"), vec![run(t("memo.from.value"))]);
            label_line(&mut b, t("memo.cc"), vec![run(t("memo.cc.value"))]);
            label_line(&mut b, t("memo.date"), vec![date()]);
            label_line(&mut b, t("memo.re"), vec![run(t("memo.re.value"))]);
            // Word's memo rule under the header block.
            let rule = b.text(None, "");
            rule.props.borders = Some(ParagraphBorders {
                bottom: Some(model_text::BorderSide::new(
                    model_text::BorderStyle::Single,
                    model_text::BorderSide::width_from_eighths(12),
                    core_model::Color::Auto,
                )),
                ..Default::default()
            });
            b.text(None, t("memo.body"));
            (t("memo.name"), None)
        }
        "minutes" => {
            b.text(Some("Title"), t("minutes.title"));
            label_line(&mut b, t("minutes.date"), vec![date()]);
            label_line(
                &mut b,
                t("minutes.time"),
                vec![run(t("minutes.time.value"))],
            );
            label_line(
                &mut b,
                t("minutes.place"),
                vec![run(t("minutes.place.value"))],
            );
            label_line(
                &mut b,
                t("minutes.attendees"),
                vec![run(t("minutes.attendees.value"))],
            );
            b.text(Some("Heading1"), t("minutes.h.agenda"));
            b.list(
                true,
                &[
                    t("minutes.agenda1"),
                    t("minutes.agenda2"),
                    t("minutes.agenda3"),
                ],
            );
            b.text(Some("Heading1"), t("minutes.h.notes"));
            b.text(None, t("minutes.notes"));
            b.text(Some("Heading1"), t("minutes.h.actions"));
            b.table(
                &[
                    &[t("minutes.action"), t("minutes.owner"), t("minutes.due")],
                    &[t("minutes.action1"), t("minutes.owner1"), t("minutes.due1")],
                ],
                &[4800, 2400, 1826],
            );
            b.text(None, "");
            (t("minutes.name"), Some(t("minutes.footer")))
        }
        _ => return None,
    };
    let props = CoreProperties {
        title: Some(name.to_owned()),
        ..Default::default()
    };
    let mut doc = b.finish(props, footer);
    // The title page of a memo: bigger title, no space wasted.
    if id == "memo" {
        if let Some(s) = doc.styles.get_mut("Title") {
            s.run.size = Some(FontSize::from_pt(36.0));
        }
    }
    Some(doc)
}

/// Template `id` in `lang` as `.dotx` bytes.
pub fn template_bytes(id: &str, lang: &str) -> Option<Vec<u8>> {
    let doc = template_document(id, lang)?;
    let ctx = fmt_docx::DocxContext {
        template: true,
        ..Default::default()
    };
    fmt_docx::write_with_context(&doc, &ctx).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteDocument;

    fn dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/templates")
    }

    #[test]
    fn templates_are_current() {
        let regen = std::env::var_os("RUSUITE_WRITE_TEMPLATES").is_some();
        if regen {
            std::fs::create_dir_all(dir()).unwrap();
        }
        for id in TEMPLATE_IDS {
            for lang in TEMPLATE_LANGS {
                let bytes = template_bytes(id, lang).unwrap();
                // The writer is deterministic.
                assert_eq!(bytes, template_bytes(id, lang).unwrap(), "{id} {lang}");
                let path = dir().join(template_file_name(id, lang));
                if regen {
                    std::fs::write(&path, &bytes).unwrap();
                } else {
                    let committed = std::fs::read(&path).unwrap_or_else(|_| {
                        panic!("{} missing: run RUSUITE_WRITE_TEMPLATES=1 cargo test -p write-core templates", path.display())
                    });
                    assert!(
                        committed == bytes,
                        "{} is stale: run RUSUITE_WRITE_TEMPLATES=1 cargo test -p write-core templates",
                        path.display()
                    );
                }
            }
        }
    }

    #[test]
    fn new_from_template_is_an_untitled_document() {
        let bytes = template_bytes("memo", "en").unwrap();
        let (opened, _) = WriteDocument::open_docx_coded(&bytes, "memo.dotx").unwrap();
        assert!(opened.is_template());
        assert_eq!(opened.suggested_name(), "memo.dotx");
        let (doc, warnings) = WriteDocument::new_from_template(&bytes, "memo.dotx").unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(!doc.is_template());
        assert_eq!(doc.source_name, None);
        assert_eq!(doc.suggested_name(), "Untitled.docx");
        let d = doc.document();
        assert_eq!(d.properties.title.as_deref(), Some("Memo"));
        assert!(d.plain_text().contains("[Recipient names]"));
        // Styles come along (the memo's bigger title).
        assert_eq!(
            d.styles.get("Title").unwrap().run.size,
            Some(FontSize::from_pt(36.0))
        );
        // Saved, it is a document again.
        let saved = doc.save_docx().unwrap();
        let back = fmt_docx::read_with_context(&saved).unwrap();
        assert!(!back.context.template);
    }

    #[test]
    fn every_template_reads_back_with_its_structure() {
        for lang in TEMPLATE_LANGS {
            let report = template_document("report", lang).unwrap();
            let back = fmt_docx::read(&template_bytes("report", lang).unwrap()).unwrap();
            assert_eq!(back.plain_text(), report.plain_text());
            assert!(back.page.footer_text.is_some() || back.sections[0].footers.default.is_some());
            let minutes = fmt_docx::read(&template_bytes("minutes", lang).unwrap()).unwrap();
            assert!(minutes.body.iter().any(|b| matches!(b, Block::Table(_))));
            let letter = fmt_docx::read(&template_bytes("letter", lang).unwrap()).unwrap();
            assert!(letter.paragraphs().any(|p| p.inlines.iter().any(
                |i| matches!(i, Inline::Field(f) if matches!(f.kind, FieldKind::Date { .. }))
            )));
        }
        assert!(template_document("nope", "en").is_none());
        assert!(template_document("memo", "fr").is_none());
        assert_eq!(template_file_name("memo", "de"), "memo.de.dotx");
    }

    #[test]
    fn save_as_template_switches_the_content_type_and_name() {
        let mut doc = WriteDocument::new();
        doc.source_name = Some("Plan.docx".into());
        doc.set_template(true);
        assert_eq!(doc.suggested_name(), "Plan.dotx");
        let bytes = doc.save_docx().unwrap();
        assert!(
            fmt_docx::read_with_context(&bytes)
                .unwrap()
                .context
                .template
        );
        doc.set_template(false);
        assert_eq!(doc.suggested_name(), "Plan.docx");
    }
}
