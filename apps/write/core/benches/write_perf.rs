//! The Write performance scenario (P5-4): a ~200-page document (4000
//! paragraphs, ~100k words in mixed runs, headings, 20 tables, 20 images)
//! loaded, edited, searched, serialized, saved and reopened.

#![allow(dead_code)]

use core_model::{Color, Rgb, RunProperties};
use model_text::{
    Block, Document, Emu, Inline, InlineImage, NodeId, Paragraph, Run, Table, TableCell, TableRow,
    Twips,
};
use write_core::{dispatch_with, WriteCommand, WriteDocument, WriteHost};

#[path = "support.rs"]
pub mod support;
use support::{png, Report};

pub const PARAGRAPHS: usize = 4000;
pub const TABLES: usize = 20;
pub const IMAGES: usize = 20;

const WORDS: [&str; 40] = [
    "the",
    "report",
    "shows",
    "that",
    "quarterly",
    "revenue",
    "grew",
    "across",
    "all",
    "regions",
    "while",
    "costs",
    "remained",
    "stable",
    "and",
    "margins",
    "improved",
    "significantly",
    "for",
    "our",
    "customers",
    "in",
    "europe",
    "asia",
    "lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "analysis",
    "of",
    "market",
    "trends",
    "suggests",
    "further",
    "growth",
    "next",
    "year",
    "with",
    "confidence",
];

fn words(seed: usize, n: usize) -> String {
    (0..n)
        .map(|i| WORDS[(seed * 7 + i * 13 + i * i) % WORDS.len()])
        .collect::<Vec<_>>()
        .join(" ")
}

/// A body paragraph of ~25 words in 3–5 runs with mixed formatting.
fn paragraph(doc: &mut Document, i: usize) -> Paragraph {
    let mut p = Paragraph::new(doc.alloc_id());
    let runs = 3 + i % 3;
    for k in 0..runs {
        let mut props = RunProperties::default();
        match (i + k) % 5 {
            1 => props.bold = Some(true),
            2 => props.italic = Some(true),
            3 => props.color = Some(Color::Rgb(Rgb::new(0x1F, 0x4E, 0x79))),
            _ => {}
        }
        let mut text = words(i * 5 + k, 25 / runs + 1);
        text.push(' ');
        p.inlines.push(Inline::Run(Run::with_props(text, props)));
    }
    p
}

fn table(doc: &mut Document, t: usize) -> Table {
    let mut rows = Vec::new();
    for r in 0..6 {
        let id = doc.alloc_id();
        let cells = (0..4)
            .map(|c| {
                let id = doc.alloc_id();
                let p = Paragraph::with_text(doc.alloc_id(), &words(t * 31 + r * 4 + c, 3));
                TableCell {
                    id,
                    props: Default::default(),
                    blocks: vec![Block::Paragraph(p)],
                    grid_span: 1,
                    v_merge: None,
                }
            })
            .collect();
        rows.push(TableRow {
            id,
            props: Default::default(),
            cells,
        });
    }
    let props = model_text::TableProperties {
        col_widths: vec![Twips(2000); 4],
        ..Default::default()
    };
    Table {
        id: doc.alloc_id(),
        props,
        rows,
    }
}

/// The fixture document.
pub fn document() -> Document {
    let mut doc = Document::new();
    doc.body.clear();
    let image_every = PARAGRAPHS / IMAGES;
    let table_every = PARAGRAPHS / TABLES;
    for i in 0..PARAGRAPHS {
        if i % 40 == 0 {
            let mut h = Paragraph::with_text(
                doc.alloc_id(),
                &format!("Section {} {}", i / 40 + 1, words(i, 4)),
            );
            h.props.style = Some(if i % 200 == 0 { "Heading1" } else { "Heading2" }.to_owned());
            doc.body.push(Block::Paragraph(h));
            continue;
        }
        let mut p = paragraph(&mut doc, i);
        if i % image_every == image_every / 2 {
            let k = i / image_every;
            let bytes = png(320, 240, |x, y| [(x + k as u32 * 10) as u8, y as u8, 128]);
            let media = doc.media.insert("image/png", bytes);
            p.inlines.push(Inline::Image(InlineImage {
                media,
                width: Emu::from_cm(8.0),
                height: Emu::from_cm(6.0),
                alt: Some(format!("Figure {}", k + 1)),
                name: None,
                anchor: None,
            }));
        }
        doc.body.push(Block::Paragraph(p));
        if i % table_every == table_every / 3 {
            let t = table(&mut doc, i / table_every);
            doc.body.push(Block::Table(t));
        }
    }
    doc.normalize();
    doc
}

/// Id of the body paragraph closest to the middle.
pub fn middle_paragraph(doc: &Document) -> NodeId {
    doc.body[doc.body.len() / 2..]
        .iter()
        .find_map(|b| match b {
            Block::Paragraph(p) if !p.inlines.is_empty() => Some(p.id),
            _ => None,
        })
        .expect("a paragraph")
}

fn ok(out: &str) {
    assert!(
        out.starts_with(r#"{"ok""#),
        "{}",
        &out[..300.min(out.len())]
    );
}

/// Runs the scenario; returns the report and the saved `.docx`.
pub fn run() -> (Report, Vec<u8>) {
    let mut r = Report::default();
    let doc = document();
    let words = doc.word_count();
    let json = serde_json::to_string(&doc).expect("json");
    r.add("fixture: words", words as f64, "", None);
    r.add("fixture: top-level blocks", doc.body.len() as f64, "", None);
    r.add(
        "fixture: Document JSON (with media)",
        json.len() as f64 / 1e6,
        "MB",
        None,
    );

    let mut host = WriteHost::new(WriteDocument::new());
    let request = format!(r#"{{"type":"load","document":{json}}}"#);
    drop(json);
    let out = r.time(
        "Load (dispatch: parse + normalize + reply with the document)",
        Some(3000.0),
        || dispatch_with(&mut host, &request),
    );
    ok(&out);
    r.add("Load reply size", out.len() as f64 / 1e6, "MB", None);
    drop(out);
    drop(request);
    r.time("Load (WriteDocument::from_document, no JSON)", None, || {
        WriteDocument::from_document(doc.clone()).expect("load")
    });

    let mid = middle_paragraph(host.doc().document());
    let mut k = 0;
    r.median(
        "InsertText in the middle (Host::apply)",
        51,
        Some(30.0),
        || {
            k += 1;
            let cmd = WriteCommand::InsertText {
                block: mid,
                offset: 3,
                text: "x".into(),
                props: None,
                style: None,
                link: None,
            };
            host.apply(cmd).expect("insert");
        },
    );
    r.median("InsertText in the middle (dispatch JSON)", 51, Some(30.0), || {
        let req = format!(r#"{{"type":"apply","command":{{"type":"insertText","block":{},"offset":3,"text":"y"}}}}"#, mid.0);
        ok(&dispatch_with(&mut host, &req));
    });
    let find = |f: &str, t: &str| WriteCommand::FindReplace {
        find: f.into(),
        replace: t.into(),
        match_case: false,
        whole_word: true,
        all: true,
        wildcards: false,
        format: None,
        replace_format: None,
    };
    let env = r.time(
        "FindReplace all (\"revenue\" → \"turnover\", Host::apply)",
        None,
        || host.apply(find("revenue", "turnover")).expect("replace"),
    );
    r.add(
        "FindReplace: replaced paragraphs in the patch",
        env.patch.replaced.len() as f64,
        "",
        None,
    );
    let out = r.time("FindReplace all back (dispatch JSON incl. patch)", None, || {
        dispatch_with(&mut host, r#"{"type":"apply","command":{"type":"findReplace","find":"turnover","replace":"revenue","matchCase":false,"wholeWord":true,"all":true}}"#)
    });
    ok(&out);
    r.add(
        "FindReplace patch JSON size",
        out.len() as f64 / 1e6,
        "MB",
        None,
    );

    let out = r.time("GetDocument (dispatch: clone + JSON)", None, || {
        dispatch_with(&mut host, r#"{"type":"getDocument"}"#)
    });
    ok(&out);
    r.add("GetDocument JSON size", out.len() as f64 / 1e6, "MB", None);
    drop(out);

    let bytes = r.time("save_docx", Some(2000.0), || {
        host.doc().save_docx().expect("save")
    });
    r.add("docx size", bytes.len() as f64 / 1e6, "MB", None);
    let (reopened, _) = r.time("open_docx", Some(3000.0), || {
        WriteDocument::open_docx(&bytes, "perf.docx").expect("open")
    });
    assert_eq!(reopened.document().media.len(), IMAGES);
    r.add(
        "peak RSS (VmHWM)",
        support::proc_status_mb("VmHWM"),
        "MB",
        None,
    );
    (r, bytes)
}
