//! P9-W1: Word's list galleries (`ApplyNumbering` with presets and
//! formats), heading numbering and its TOC entries, Set Numbering Value
//! (`w:startOverride`), outline levels and the character formats of the
//! Word shortcuts, with `.docx` round trips.

use app_common::Host;
use core_model::{FontFace, RunProperties, Underline};
use model_text::{
    Block, Document, Level, LevelAlign, LevelKind, ListPreset, NodeId, Paragraph,
    ParagraphProperties, Toc,
};
use serde_json::Value as Json;
use write_core::{ListKind, WriteCommand as C, WriteDocument, WriteHost};

/// Paragraphs `(text, style)` with ids 1, 2, ….
fn host(paras: &[(&str, Option<&str>)]) -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    for (i, (t, style)) in paras.iter().enumerate() {
        let id = NodeId(i as u64 + 1);
        doc.reserve_id(id);
        let mut p = Paragraph::with_text(id, t);
        p.props.style = style.map(str::to_owned);
        doc.body.push(Block::Paragraph(p));
    }
    Host::new(WriteDocument::from_document(doc).unwrap())
}

fn plain(texts: &[&str]) -> WriteHost {
    host(&texts.iter().map(|t| (*t, None)).collect::<Vec<_>>())
}

fn json_of(h: &WriteHost) -> Json {
    serde_json::to_value(h.doc().document()).unwrap()
}

fn doc(h: &WriteHost) -> &Document {
    h.doc().document()
}

/// Applies `cmd`, checks undo → before and redo → after.
fn apply(h: &mut WriteHost, cmd: C) {
    let before = json_of(h);
    h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
}

fn labels(d: &Document) -> Vec<String> {
    d.list_numbers().into_iter().map(|(_, l)| l).collect()
}

fn reopen(h: &WriteHost) -> Document {
    let bytes = h.doc().save_docx().unwrap();
    WriteDocument::open_docx(&bytes, "x.docx")
        .unwrap()
        .0
        .into_document()
}

fn numbering(preset: Option<ListPreset>, format: Option<Level>, items: &[(u64, u8)]) -> C {
    C::ApplyNumbering {
        levels: vec![],
        preset,
        format,
        items: items.iter().map(|&(id, l)| (NodeId(id), l)).collect(),
    }
}

fn para(d: &Document, id: u64) -> &Paragraph {
    d.find_paragraph(NodeId(id)).unwrap()
}

#[test]
fn numbering_gallery_replaces_the_level_of_the_current_list() {
    let mut h = plain(&["a", "b", "c"]);
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![NodeId(1), NodeId(2), NodeId(3)],
            kind: ListKind::Decimal,
        },
    );
    apply(
        &mut h,
        numbering(
            Some(ListPreset::UpperRoman),
            None,
            &[(1, 0), (2, 0), (3, 0)],
        ),
    );
    assert_eq!(labels(doc(&h)), ["I.", "II.", "III."]);
    let n = para(doc(&h), 1).props.numbering.unwrap();
    let def = doc(&h).numbering.get(n.num_id).unwrap();
    assert_eq!(def.levels.len(), 9);
    let l0 = &def.levels[0];
    assert_eq!(l0.alignment, LevelAlign::Right);
    // The level keeps its indent (Word's 720 / 360); deeper levels stay.
    assert_eq!(l0.indent.unwrap().left.unwrap().0, 720);
    assert_eq!(def.levels[1].kind, LevelKind::LowerLetter);
}

#[test]
fn numbering_gallery_on_a_sub_level_changes_that_level_only() {
    let mut h = plain(&["a", "b"]);
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![NodeId(1), NodeId(2)],
            kind: ListKind::Decimal,
        },
    );
    apply(
        &mut h,
        C::IndentList {
            blocks: vec![NodeId(2)],
            delta: 1,
        },
    );
    apply(
        &mut h,
        numbering(Some(ListPreset::LowerLetterParen), None, &[(2, 1)]),
    );
    let d = doc(&h);
    let n = para(d, 2).props.numbering.unwrap();
    let def = d.numbering.get(n.num_id).unwrap();
    assert_eq!(
        (def.levels[0].text.as_str(), def.levels[1].text.as_str()),
        ("%1.", "%2)")
    );
    assert_eq!(n.level, 1);
}

#[test]
fn bullet_gallery_makes_a_new_bulleted_list() {
    let mut h = plain(&["a", "b"]);
    apply(
        &mut h,
        numbering(Some(ListPreset::BulletDiamond), None, &[(1, 0), (2, 0)]),
    );
    let d = doc(&h);
    assert_eq!(labels(d), ["◆", "◆"]);
    let n = para(d, 1).props.numbering.unwrap();
    let def = d.numbering.get(n.num_id).unwrap();
    // Deeper levels: Word's default bullets.
    assert_eq!(def.levels[1].text, "o");
    assert_eq!(para(d, 1).props.style.as_deref(), Some("ListParagraph"));
    // Saved and reopened: the same bullets.
    let back = reopen(&h);
    assert_eq!(labels(&back), ["◆", "◆"]);
}

#[test]
fn define_new_number_format_and_bullet() {
    let mut h = plain(&["a", "b"]);
    let format = Level {
        font: Some(FontFace::from("Arial")),
        alignment: LevelAlign::Center,
        ..Level::new(LevelKind::UpperLetter, "Part %1:")
    };
    apply(&mut h, numbering(None, Some(format), &[(1, 0), (2, 0)]));
    assert_eq!(labels(doc(&h)), ["Part A:", "Part B:"]);
    let back = reopen(&h);
    let n = para(&back, 1).props.numbering.unwrap();
    let l = &back.numbering.get(n.num_id).unwrap().levels[0];
    assert_eq!(l.font, Some(FontFace::from("Arial")));
    assert_eq!(l.alignment, LevelAlign::Center);
    assert_eq!(labels(&back), ["Part A:", "Part B:"]);

    let bullet = Level {
        font: Some(FontFace::from("Wingdings")),
        ..Level::new(LevelKind::Bullet, "➢")
    };
    let mut h = plain(&["x"]);
    apply(&mut h, numbering(None, Some(bullet), &[(1, 0)]));
    assert_eq!(labels(&reopen(&h)), ["➢"]);
    // Nothing to apply: an error, nothing changes.
    assert!(h.apply(numbering(None, None, &[(1, 0)])).is_err());
    assert!(h
        .apply(numbering(Some(ListPreset::Decimal), None, &[]))
        .is_err());
}

fn heading_doc() -> WriteHost {
    host(&[
        ("Intro", Some("Heading1")),
        ("Scope", Some("Heading2")),
        ("Body text", None),
        ("Terms", Some("Heading2")),
        ("Next", Some("Heading1")),
        ("Detail", Some("Heading3")),
    ])
}

#[test]
fn heading_preset_numbers_the_heading_styles() {
    let mut h = heading_doc();
    // The caret in "Scope" (a Heading 2): it stays a Heading 2.
    apply(
        &mut h,
        numbering(Some(ListPreset::HeadingDecimal), None, &[(2, 0)]),
    );
    let d = doc(&h);
    assert_eq!(para(d, 2).props.style.as_deref(), Some("Heading2"));
    assert_eq!(
        para(d, 2).props.numbering,
        None,
        "numbered through its style"
    );
    assert_eq!(labels(d), ["1", "1.1", "1.2", "2", "2.1.1"]);
    let h2 = d
        .styles
        .get("Heading2")
        .unwrap()
        .paragraph
        .numbering
        .unwrap();
    assert_eq!(h2.level, 1);
    let def = d.numbering.get(h2.num_id).unwrap();
    assert_eq!(def.levels[1].style.as_deref(), Some("Heading2"));
    // Saved: the levels keep their style links and the styles their numbering.
    let back = reopen(&h);
    assert_eq!(labels(&back), ["1", "1.1", "1.2", "2", "2.1.1"]);
    assert_eq!(
        back.styles
            .get("Heading3")
            .unwrap()
            .paragraph
            .numbering
            .map(|n| n.level),
        Some(2)
    );
}

#[test]
fn heading_preset_on_a_normal_paragraph_makes_it_a_heading() {
    let mut h = plain(&["Title one", "text"]);
    apply(
        &mut h,
        numbering(Some(ListPreset::HeadingOutline), None, &[(1, 0)]),
    );
    let d = doc(&h);
    assert_eq!(para(d, 1).props.style.as_deref(), Some("Heading1"));
    assert_eq!(labels(d), ["I."]);
    assert_eq!(para(d, 2).props.style, None);
}

#[test]
fn toc_entries_show_the_heading_numbers() {
    let mut h = heading_doc();
    apply(
        &mut h,
        numbering(Some(ListPreset::HeadingDecimal), None, &[(1, 0)]),
    );
    h.apply(C::InsertToc {
        after: None,
        from_level: Some(1),
        to_level: Some(3),
        title: None,
        new_id: Some(-1),
        caption: None,
    })
    .unwrap();
    let toc: &Toc = doc(&h)
        .body
        .iter()
        .find_map(|b| match b {
            Block::Toc(t) => Some(t),
            _ => None,
        })
        .unwrap();
    let texts: Vec<&str> = toc.entries.iter().map(|e| e.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "1 Intro",
            "1.1 Scope",
            "1.2 Terms",
            "2 Next",
            "2.1.1 Detail"
        ]
    );
    // Bullets are not part of an entry.
    let mut b = heading_doc();
    apply(
        &mut b,
        C::ApplyList {
            blocks: vec![NodeId(1)],
            kind: ListKind::Bullet,
        },
    );
    let entries = b.doc().document().build_toc(1, 3);
    assert_eq!(entries[0].text, "Intro");
}

#[test]
fn outline_level_puts_a_paragraph_into_the_toc() {
    let mut h = heading_doc();
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![NodeId(3)],
            patch: ParagraphProperties {
                outline_level: Some(1),
                ..Default::default()
            },
        },
    );
    // Body text takes a heading out.
    apply(
        &mut h,
        C::SetParagraphProps {
            blocks: vec![NodeId(4)],
            patch: ParagraphProperties {
                outline_level: Some(9),
                ..Default::default()
            },
        },
    );
    let check = |d: &Document| {
        let toc = d.build_toc(1, 3);
        let got: Vec<(&str, u8)> = toc.iter().map(|e| (e.text.as_str(), e.level)).collect();
        assert_eq!(
            got,
            [
                ("Intro", 1),
                ("Scope", 2),
                ("Body text", 2),
                ("Next", 1),
                ("Detail", 3)
            ]
        );
    };
    check(doc(&h));
    let back = reopen(&h);
    check(&back);
    assert_eq!(para(&back, 3).props.outline_level, Some(1));
    // Heading styles carry Word's outline levels.
    assert_eq!(
        back.styles.get("Heading2").unwrap().paragraph.outline_level,
        Some(1)
    );
}

#[test]
fn set_numbering_value_writes_a_start_override() {
    let mut h = plain(&["a", "b", "c", "d"]);
    apply(
        &mut h,
        C::ApplyList {
            blocks: vec![NodeId(1), NodeId(2), NodeId(3), NodeId(4)],
            kind: ListKind::Decimal,
        },
    );
    apply(
        &mut h,
        C::RestartList {
            block: NodeId(3),
            start: Some(5),
        },
    );
    assert_eq!(labels(doc(&h)), ["1.", "2.", "5.", "6."]);
    let back = reopen(&h);
    assert_eq!(labels(&back), ["1.", "2.", "5.", "6."]);
    let n = para(&back, 3).props.numbering.unwrap();
    assert_eq!(
        back.numbering.get(n.num_id).unwrap().start_override(0),
        Some(5)
    );
    // Restart at 1 and Continue Numbering.
    apply(
        &mut h,
        C::RestartList {
            block: NodeId(3),
            start: Some(1),
        },
    );
    assert_eq!(labels(doc(&h)), ["1.", "2.", "1.", "2."]);
    apply(&mut h, C::ContinueList { block: NodeId(3) });
    assert_eq!(labels(doc(&h)), ["1.", "2.", "3.", "4."]);
}

#[test]
fn small_caps_all_caps_double_underline_roundtrip() {
    let mut h = plain(&["abc def ghi"]);
    for (from, to, patch) in [
        (
            0,
            3,
            RunProperties {
                small_caps: Some(true),
                ..Default::default()
            },
        ),
        (
            4,
            7,
            RunProperties {
                all_caps: Some(true),
                ..Default::default()
            },
        ),
        (
            8,
            11,
            RunProperties {
                underline: Some(Underline::Double),
                ..Default::default()
            },
        ),
    ] {
        apply(
            &mut h,
            C::SetRunProps {
                block: NodeId(1),
                from,
                to,
                patch,
            },
        );
    }
    let back = reopen(&h);
    let runs: Vec<(String, RunProperties)> = para(&back, 1)
        .inlines
        .iter()
        .filter_map(|i| match i {
            model_text::Inline::Run(r) => Some((r.text.clone(), r.props.clone())),
            _ => None,
        })
        .collect();
    let of = |t: &str| runs.iter().find(|(x, _)| x.trim() == t).unwrap().1.clone();
    assert_eq!(of("abc").small_caps, Some(true));
    assert_eq!(of("def").all_caps, Some(true));
    assert_eq!(of("ghi").underline, Some(Underline::Double));
}
