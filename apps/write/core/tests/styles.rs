//! P8-21: styles management (add / update / rename / delete / default,
//! update from selection, character styles, clear formatting) and find /
//! replace with formatting and wildcards. Every command is checked for
//! undo/redo identity.

use app_common::Host;
use core_model::{Color, Rgb, RunProperties};
use model_text::{
    Alignment, Block, Document, Inline, NodeId, Paragraph, ParagraphProperties, Run, Style,
    StyleKind, StylePatch,
};
use serde_json::{json, Value as Json};
use write_core::{
    dispatch_with, FindFormat, FindQuery, WriteCommand as C, WriteDocument, WriteHost, WritePatch,
};

/// Paragraphs with ids 1, 2, …; `#` = Heading 1, `>` = Quote; `*word*`
/// makes `word` bold.
fn host(texts: &[&str]) -> WriteHost {
    let mut doc = Document::new();
    doc.body.clear();
    for (i, t) in texts.iter().enumerate() {
        let id = NodeId(i as u64 + 1);
        doc.reserve_id(id);
        let (style, t) = match (t.strip_prefix("# "), t.strip_prefix("> ")) {
            (Some(t), _) => (Some("Heading1"), t),
            (_, Some(t)) => (Some("Quote"), t),
            _ => (None, *t),
        };
        let mut p = Paragraph::new(id);
        for (k, part) in t.split('*').enumerate() {
            if part.is_empty() {
                continue;
            }
            let props = RunProperties {
                bold: (k % 2 == 1).then_some(true),
                ..Default::default()
            };
            p.inlines.push(Inline::Run(Run::with_props(part, props)));
        }
        p.props.style = style.map(str::to_owned);
        doc.body.push(Block::Paragraph(p));
    }
    Host::new(WriteDocument::from_document(doc).unwrap())
}

fn json_of(h: &WriteHost) -> Json {
    serde_json::to_value(h.doc().document()).unwrap()
}

fn doc(h: &WriteHost) -> &Document {
    h.doc().document()
}

/// Applies `cmd`, checks undo → before and redo → after.
fn apply(h: &mut WriteHost, cmd: C) -> WritePatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn err_code(h: &mut WriteHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before, "failed command changed the document");
    e.code()
}

fn id(n: u64) -> NodeId {
    NodeId(n)
}

fn para(h: &WriteHost, n: u64) -> &Paragraph {
    doc(h).find_paragraph(id(n)).unwrap()
}

fn runs(h: &WriteHost, n: u64) -> Vec<(String, Option<String>)> {
    para(h, n)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .map(|r| (r.text.clone(), r.style.clone()))
        .collect()
}

fn replaced_ids(p: &WritePatch) -> Vec<NodeId> {
    let mut v: Vec<NodeId> = p.replaced.iter().map(Block::id).collect();
    v.sort();
    v
}

fn custom(id: &str, name: &str, kind: StyleKind) -> Style {
    Style {
        based_on: Some(if kind == StyleKind::Character {
            "DefaultParagraphFont".into()
        } else {
            "Normal".into()
        }),
        custom: true,
        quick_format: true,
        ..Style::new(id, name, kind)
    }
}

fn red() -> Option<Color> {
    Some(Color::Rgb(Rgb::new(0xC0, 0, 0)))
}

fn find(h: &mut WriteHost, q: &FindQuery) -> Vec<(u64, u32, u32)> {
    let reply = dispatch_with(h, &json!({"type": "find", "query": q}).to_string());
    let v: Json = serde_json::from_str(&reply).unwrap();
    let m = &v["ok"]["matches"];
    assert!(m.is_array(), "{reply}");
    m.as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["block"].as_u64().unwrap(),
                m["from"].as_u64().unwrap() as u32,
                m["to"].as_u64().unwrap() as u32,
            )
        })
        .collect()
}

fn bold_format() -> FindFormat {
    FindFormat {
        run: Some(RunProperties {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn replace_cmd(find: &str, replace: &str, format: Option<FindFormat>) -> C {
    C::FindReplace {
        find: find.into(),
        replace: replace.into(),
        match_case: false,
        whole_word: false,
        all: true,
        wildcards: false,
        format,
        replace_format: None,
    }
}

// ----- style sheet commands ------------------------------------------------------

#[test]
fn add_style_and_apply_it() {
    let mut h = host(&["One", "Two"]);
    let mut s = custom("Memo", "Memo", StyleKind::Paragraph);
    s.paragraph.alignment = Some(Alignment::Center);
    let p = apply(&mut h, C::AddStyle { style: s });
    assert!(p.styles.unwrap().get("Memo").is_some());
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(2)],
            style: "Memo".into(),
        },
    );
    let pp = doc(&h).resolve_paragraph_props(para(&h, 2));
    assert_eq!(pp.alignment, Some(Alignment::Center));
    // duplicates and bad parents are refused, the document unchanged
    assert_eq!(
        err_code(
            &mut h,
            C::AddStyle {
                style: custom("Memo", "Other", StyleKind::Paragraph)
            }
        ),
        "invalid_command"
    );
    let mut bad = custom("X", "X", StyleKind::Paragraph);
    bad.based_on = Some("Nope".into());
    assert_eq!(
        err_code(&mut h, C::AddStyle { style: bad }),
        "unknown_style"
    );
}

#[test]
fn set_style_accepts_linked_styles() {
    let mut h = host(&["One"]);
    assert_eq!(doc(&h).styles.get("Quote").unwrap().kind, StyleKind::Linked);
    apply(
        &mut h,
        C::SetStyle {
            blocks: vec![id(1)],
            style: "Quote".into(),
        },
    );
    assert_eq!(para(&h, 1).props.style.as_deref(), Some("Quote"));
    assert_eq!(
        err_code(
            &mut h,
            C::SetStyle {
                blocks: vec![id(1)],
                style: "Strong".into()
            }
        ),
        "unknown_style"
    );
}

#[test]
fn update_style_reports_users_and_descendants() {
    let mut h = host(&["# Head", "Body", "# Head 2"]);
    let mut child = custom("Sub", "Sub heading", StyleKind::Paragraph);
    child.based_on = Some("Heading1".into());
    h.apply(C::AddStyle { style: child }).unwrap();
    h.apply(C::SetStyle {
        blocks: vec![id(2)],
        style: "Sub".into(),
    })
    .unwrap();
    let p = apply(
        &mut h,
        C::UpdateStyle {
            id: "Heading1".into(),
            patch: StylePatch {
                run: Some(RunProperties {
                    color: red(),
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
    );
    assert!(p.styles.is_some());
    assert_eq!(replaced_ids(&p), [id(1), id(2), id(3)]);
    let r = doc(&h).resolve_run_props(para(&h, 2), &Run::default());
    assert_eq!(r.color, red(), "inherited by the child style");
    // the docx keeps it
    let bytes = h.doc().save_docx().unwrap();
    let back = fmt_docx::read(&bytes).unwrap();
    assert_eq!(back.styles.get("Heading1").unwrap().run.color, red());
    assert_eq!(back.styles.get("Heading1Char").unwrap().run.color, red());
}

#[test]
fn update_style_rejects_cycles() {
    let mut h = host(&["x"]);
    let mut a = custom("A", "A", StyleKind::Paragraph);
    a.based_on = Some("Heading1".into());
    h.apply(C::AddStyle { style: a }).unwrap();
    let code = err_code(
        &mut h,
        C::UpdateStyle {
            id: "Heading1".into(),
            patch: StylePatch {
                based_on: Some("A".into()),
                ..Default::default()
            },
        },
    );
    assert_eq!(code, "invalid_command");
}

#[test]
fn rename_and_default_style() {
    let mut h = host(&["One", "# Two"]);
    h.apply(C::AddStyle {
        style: custom("Body", "Body", StyleKind::Paragraph),
    })
    .unwrap();
    apply(
        &mut h,
        C::RenameStyle {
            id: "Body".into(),
            name: "Body Text 2".into(),
        },
    );
    assert_eq!(doc(&h).styles.get("Body").unwrap().name, "Body Text 2");
    let p = apply(
        &mut h,
        C::SetDefaultStyle {
            kind: StyleKind::Paragraph,
            id: "Body".into(),
        },
    );
    assert!(p.styles.is_some());
    assert_eq!(replaced_ids(&p), [id(1)], "the unstyled paragraph changes");
    assert_eq!(
        doc(&h)
            .styles
            .default_style(StyleKind::Paragraph)
            .unwrap()
            .id,
        "Body"
    );
}

#[test]
fn delete_style_repoints_paragraphs_to_normal() {
    let mut h = host(&["One", "Two", "Three"]);
    h.apply(C::AddStyle {
        style: custom("Memo", "Memo", StyleKind::Paragraph),
    })
    .unwrap();
    h.apply(C::SetStyle {
        blocks: vec![id(1), id(3)],
        style: "Memo".into(),
    })
    .unwrap();
    let p = apply(
        &mut h,
        C::DeleteStyle {
            id: "Memo".into(),
            replacement: None,
        },
    );
    assert_eq!(replaced_ids(&p), [id(1), id(3)]);
    assert!(doc(&h).styles.get("Memo").is_none());
    assert_eq!(para(&h, 1).props.style, None);
    // built-ins cannot be deleted
    assert_eq!(
        err_code(
            &mut h,
            C::DeleteStyle {
                id: "Heading1".into(),
                replacement: None
            }
        ),
        "invalid_command"
    );
}

#[test]
fn delete_style_with_replacement_and_character_runs() {
    let mut h = host(&["One two"]);
    h.apply(C::AddStyle {
        style: custom("Memo", "Memo", StyleKind::Paragraph),
    })
    .unwrap();
    h.apply(C::AddStyle {
        style: custom("Key", "Key", StyleKind::Character),
    })
    .unwrap();
    h.apply(C::SetStyle {
        blocks: vec![id(1)],
        style: "Memo".into(),
    })
    .unwrap();
    h.apply(C::ApplyCharacterStyle {
        block: id(1),
        from: 4,
        to: 7,
        style: Some("Key".into()),
    })
    .unwrap();
    apply(
        &mut h,
        C::DeleteStyle {
            id: "Memo".into(),
            replacement: Some("Quote".into()),
        },
    );
    assert_eq!(para(&h, 1).props.style.as_deref(), Some("Quote"));
    apply(
        &mut h,
        C::DeleteStyle {
            id: "Key".into(),
            replacement: None,
        },
    );
    assert!(runs(&h, 1).iter().all(|(_, s)| s.is_none()));
}

#[test]
fn apply_character_style_splits_runs_and_maps_linked() {
    let mut h = host(&["Hello world"]);
    let p = apply(
        &mut h,
        C::ApplyCharacterStyle {
            block: id(1),
            from: 6,
            to: 11,
            style: Some("Strong".into()),
        },
    );
    assert_eq!(replaced_ids(&p), [id(1)]);
    assert_eq!(
        runs(&h, 1),
        [
            ("Hello ".into(), None),
            ("world".into(), Some("Strong".into()))
        ]
    );
    let r = doc(&h).resolve_run_props(para(&h, 1), para(&h, 1).inlines[1].as_run().unwrap());
    assert_eq!(r.bold, Some(true));
    // a linked style applied to part of a paragraph: its character half
    apply(
        &mut h,
        C::ApplyCharacterStyle {
            block: id(1),
            from: 0,
            to: 5,
            style: Some("Heading1".into()),
        },
    );
    assert_eq!(runs(&h, 1)[0].1.as_deref(), Some("Heading1Char"));
    // removing
    apply(
        &mut h,
        C::ApplyCharacterStyle {
            block: id(1),
            from: 0,
            to: 11,
            style: None,
        },
    );
    assert_eq!(runs(&h, 1), [("Hello world".into(), None)]);
    assert_eq!(
        err_code(
            &mut h,
            C::ApplyCharacterStyle {
                block: id(1),
                from: 0,
                to: 2,
                style: Some("TableGrid".into())
            }
        ),
        "unknown_style"
    );
}

#[test]
fn typing_keeps_the_character_style() {
    let mut h = host(&["ab"]);
    h.apply(C::ApplyCharacterStyle {
        block: id(1),
        from: 0,
        to: 2,
        style: Some("Emphasis".into()),
    })
    .unwrap();
    apply(
        &mut h,
        C::InsertText {
            block: id(1),
            offset: 2,
            text: "c".into(),
            props: None,
            style: None,
            link: None,
        },
    );
    assert_eq!(runs(&h, 1), [("abc".into(), Some("Emphasis".into()))]);
    // explicit props + style from the editor's marks
    apply(
        &mut h,
        C::InsertText {
            block: id(1),
            offset: 0,
            text: "x".into(),
            props: Some(RunProperties::default()),
            style: Some("Strong".into()),
            link: None,
        },
    );
    assert_eq!(runs(&h, 1)[0], ("x".into(), Some("Strong".into())));
    // replacing text keeps the style of the first replaced character
    apply(
        &mut h,
        C::ReplaceText {
            block: id(1),
            from: 1,
            to: 4,
            text: "ABC".into(),
        },
    );
    assert_eq!(runs(&h, 1)[1], ("ABC".into(), Some("Emphasis".into())));
}

#[test]
fn update_style_from_selection() {
    // Body paragraph centred with direct red bold text → Heading 1 takes it.
    let mut h = host(&["Sample", "# Other heading"]);
    h.apply(C::SetParagraphProps {
        blocks: vec![id(1)],
        patch: ParagraphProperties {
            alignment: Some(Alignment::Center),
            ..Default::default()
        },
    })
    .unwrap();
    h.apply(C::SetRunProps {
        block: id(1),
        from: 0,
        to: 6,
        patch: RunProperties {
            bold: Some(true),
            color: red(),
            ..Default::default()
        },
    })
    .unwrap();
    let p = apply(
        &mut h,
        C::UpdateStyleFromSelection {
            id: "Heading1".into(),
            block: id(1),
            offset: 2,
        },
    );
    assert_eq!(replaced_ids(&p), [id(1), id(2)]);
    let h1 = doc(&h).styles.get("Heading1").unwrap();
    assert_eq!(h1.paragraph.alignment, Some(Alignment::Center));
    assert_eq!(h1.run.bold, Some(true));
    assert_eq!(h1.run.color, red());
    // Normal's spacing (the sample paragraph's) replaces Heading 1's
    let sp = doc(&h)
        .styles
        .resolve_paragraph("Heading1")
        .spacing
        .unwrap();
    assert_eq!(sp.before.unwrap_or_default().0, 0);
    assert_eq!(sp.after.unwrap().0, 160);
    // the sample paragraph is now a plain Heading 1, direct formatting gone
    let p1 = para(&h, 1);
    assert_eq!(p1.props.style.as_deref(), Some("Heading1"));
    assert_eq!(p1.props.alignment, None);
    assert!(p1.inlines[0].as_run().unwrap().props.is_empty());
    // the other heading follows
    let other = doc(&h).resolve_run_props(para(&h, 2), &Run::default());
    assert_eq!(other.color, red());
    // the character half stays in step
    assert_eq!(doc(&h).styles.get("Heading1Char").unwrap().run.color, red());
}

#[test]
fn update_character_style_from_selection() {
    let mut h = host(&["a *bold* b"]);
    h.apply(C::AddStyle {
        style: custom("Key", "Key", StyleKind::Character),
    })
    .unwrap();
    apply(
        &mut h,
        C::UpdateStyleFromSelection {
            id: "Key".into(),
            block: id(1),
            offset: 3,
        },
    );
    let key = doc(&h).styles.get("Key").unwrap();
    assert_eq!(key.run.bold, Some(true));
    assert_eq!(key.run.size, None, "only what differs from the paragraph");
    // the sample run took the character style, its direct bold is gone
    let r = para(&h, 1).inlines[1].as_run().unwrap();
    assert_eq!((r.text.as_str(), r.style.as_deref()), ("bold", Some("Key")));
    assert!(r.props.is_empty());
}

#[test]
fn clear_formatting_keep_style() {
    let mut h = host(&["> *Quoted*"]);
    h.apply(C::ApplyCharacterStyle {
        block: id(1),
        from: 0,
        to: 3,
        style: Some("Strong".into()),
    })
    .unwrap();
    h.apply(C::SetParagraphProps {
        blocks: vec![id(1)],
        patch: ParagraphProperties {
            alignment: Some(Alignment::Right),
            ..Default::default()
        },
    })
    .unwrap();
    apply(
        &mut h,
        C::ClearFormatting {
            block: id(1),
            from: 0,
            to: 6,
            paragraph: true,
            keep_style: true,
        },
    );
    let p = para(&h, 1);
    assert_eq!(p.props.style.as_deref(), Some("Quote"));
    assert_eq!(p.props.alignment, None);
    assert_eq!(runs(&h, 1), [("Quoted".into(), None)]);
    assert!(p.inlines[0].as_run().unwrap().props.is_empty());
    // without keepStyle the paragraph becomes Normal (Clear All Formatting)
    apply(
        &mut h,
        C::ClearFormatting {
            block: id(1),
            from: 0,
            to: 6,
            paragraph: true,
            keep_style: false,
        },
    );
    assert_eq!(para(&h, 1).props.style, None);
}

#[test]
fn blocks_with_style_request() {
    let mut h = host(&["# A", "b", "# C"]);
    let reply = dispatch_with(&mut h, r#"{"type":"blocksWithStyle","id":"Heading1"}"#);
    assert_eq!(reply, r#"{"ok":{"type":"blockIds","ids":[1,3]}}"#);
    let reply = dispatch_with(&mut h, r#"{"type":"blocksWithStyle","id":"Normal"}"#);
    assert_eq!(reply, r#"{"ok":{"type":"blockIds","ids":[2]}}"#);
    let reply = dispatch_with(&mut h, r#"{"type":"blocksWithStyle","id":"Nope"}"#);
    assert_eq!(reply, r#"{"ok":{"type":"blockIds","ids":[]}}"#);
}

#[test]
fn style_commands_over_json() {
    let mut h = host(&["x"]);
    let reply = dispatch_with(
        &mut h,
        &json!({"type": "apply", "command": {"type": "addStyle", "style": {
            "id": "Memo", "name": "Memo", "kind": "linked", "basedOn": "Normal", "link": "MemoChar",
            "quickFormat": true, "custom": true, "run": {"italic": true}}}})
        .to_string(),
    );
    assert!(reply.contains(r#""styles":{"#), "{reply}");
    let reply = dispatch_with(
        &mut h,
        &json!({"type": "apply", "command": {"type": "updateStyle", "id": "Memo",
            "patch": {"next": "Heading1", "autoRedefine": true, "paragraph": {"alignment": "center"}}}})
        .to_string(),
    );
    assert!(reply.starts_with(r#"{"ok":"#), "{reply}");
    let memo = doc(&h).styles.get("Memo").unwrap();
    assert_eq!(memo.next.as_deref(), Some("Heading1"));
    assert!(memo.auto_redefine);
    let reply = dispatch_with(
        &mut h,
        r#"{"type":"apply","command":{"type":"deleteStyle","id":"Normal"}}"#,
    );
    assert!(reply.contains(r#""code":"invalid_command""#), "{reply}");
}

// ----- find / replace with formatting ----------------------------------------------

#[test]
fn find_bold_fox_only() {
    let mut h = host(&["The fox and the *fox*.", "*Fox* again, fox"]);
    let q = FindQuery {
        text: "fox".into(),
        format: Some(bold_format()),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &q), [(1, 16, 19), (2, 0, 3)]);
    let plain = FindQuery {
        text: "fox".into(),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &plain).len(), 4);
    let case = FindQuery {
        match_case: true,
        ..plain
    };
    assert_eq!(find(&mut h, &case).len(), 3);
}

#[test]
fn replace_only_bold_occurrences() {
    let mut h = host(&["The fox and the *fox*."]);
    let p = apply(&mut h, replace_cmd("fox", "cat", Some(bold_format())));
    assert_eq!(p.info.as_deref(), Some("1 replacement"));
    assert_eq!(para(&h, 1).text(), "The fox and the cat.");
    // the replacement took the bold formatting
    let r = para(&h, 1)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .find(|r| r.text == "cat")
        .unwrap();
    assert_eq!(r.props.bold, Some(true));
}

#[test]
fn find_with_style_and_paragraph_format() {
    let mut h = host(&["# fox title", "fox body", "> fox quote"]);
    let by_style = FindQuery {
        text: "fox".into(),
        format: Some(FindFormat {
            style: Some("Heading1".into()),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &by_style), [(1, 0, 3)]);
    let centred = FindQuery {
        text: "fox".into(),
        format: Some(FindFormat {
            paragraph: Some(ParagraphProperties {
                alignment: Some(Alignment::Center),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &centred), [(3, 0, 3)], "Quote is centred");
    // a character style constraint
    h.apply(C::ApplyCharacterStyle {
        block: id(2),
        from: 4,
        to: 8,
        style: Some("Emphasis".into()),
    })
    .unwrap();
    let emph = FindQuery {
        text: String::new(),
        format: Some(FindFormat {
            style: Some("Emphasis".into()),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &emph), [(2, 4, 8)]);
}

#[test]
fn find_highlight_and_formatting_only_stretches() {
    let mut h = host(&["one *two three* four"]);
    let only_bold = FindQuery {
        format: Some(bold_format()),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &only_bold), [(1, 4, 13)]);
    h.apply(C::SetRunProps {
        block: id(1),
        from: 0,
        to: 3,
        patch: RunProperties {
            highlight: Some(Color::Rgb(Rgb::new(0xFF, 0xFF, 0))),
            ..Default::default()
        },
    })
    .unwrap();
    let hl = FindQuery {
        format: Some(FindFormat {
            highlight: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(find(&mut h, &hl), [(1, 0, 3)]);
}

#[test]
fn replace_formatting_only() {
    // Find: bold, Replace: (empty) with italic → text kept, italic added.
    let mut h = host(&["a *b* c *d*"]);
    let cmd = C::FindReplace {
        find: String::new(),
        replace: String::new(),
        match_case: false,
        whole_word: false,
        all: true,
        wildcards: false,
        format: Some(bold_format()),
        replace_format: Some(FindFormat {
            run: Some(RunProperties {
                italic: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        }),
    };
    let p = apply(&mut h, cmd);
    assert_eq!(p.info.as_deref(), Some("2 replacements"));
    assert_eq!(para(&h, 1).text(), "a b c d");
    let italic: Vec<&str> = para(&h, 1)
        .inlines
        .iter()
        .filter_map(Inline::as_run)
        .filter(|r| r.props.italic == Some(true))
        .map(|r| r.text.as_str())
        .collect();
    assert_eq!(italic, ["b", "d"]);
}

#[test]
fn replace_with_a_style_format() {
    let mut h = host(&["fox one", "other fox"]);
    let cmd = C::FindReplace {
        find: "fox".into(),
        replace: "wolf".into(),
        match_case: false,
        whole_word: true,
        all: true,
        wildcards: false,
        format: None,
        replace_format: Some(FindFormat {
            style: Some("Strong".into()),
            ..Default::default()
        }),
    };
    apply(&mut h, cmd);
    assert_eq!(runs(&h, 1)[0], ("wolf".into(), Some("Strong".into())));
    // a paragraph style as replacement format restyles the paragraph
    let cmd = C::FindReplace {
        find: "one".into(),
        replace: "two".into(),
        match_case: false,
        whole_word: false,
        all: true,
        wildcards: false,
        format: None,
        replace_format: Some(FindFormat {
            style: Some("Quote".into()),
            ..Default::default()
        }),
    };
    apply(&mut h, cmd);
    assert_eq!(para(&h, 1).props.style.as_deref(), Some("Quote"));
    assert_eq!(para(&h, 2).props.style, None);
}

#[test]
fn wildcard_find_and_replace() {
    let mut h = host(&["cat cot cut", "Call 555-1234 now"]);
    let q = FindQuery {
        text: "c?t".into(),
        wildcards: true,
        ..Default::default()
    };
    assert_eq!(find(&mut h, &q), [(1, 0, 3), (1, 4, 7), (1, 8, 11)]);
    let digits = FindQuery {
        text: "[0-9]{3}-[0-9]{4}".into(),
        wildcards: true,
        ..Default::default()
    };
    assert_eq!(find(&mut h, &digits), [(2, 5, 13)]);
    let cmd = C::FindReplace {
        find: "<[0-9]@>".into(),
        replace: "#".into(),
        match_case: true,
        whole_word: false,
        all: true,
        wildcards: true,
        format: None,
        replace_format: None,
    };
    let p = apply(&mut h, cmd);
    assert_eq!(p.info.as_deref(), Some("2 replacements"));
    assert_eq!(para(&h, 2).text(), "Call #-# now");
    // invalid patterns are an error, not a panic
    let bad = json!({"type": "find", "query": {"text": "[abc", "wildcards": true}}).to_string();
    let reply = dispatch_with(&mut h, &bad);
    assert!(reply.contains("invalid_command"), "{reply}");
}

#[test]
fn replace_first_only_and_nothing_to_find() {
    let mut h = host(&["fox fox", "fox"]);
    let cmd = C::FindReplace {
        find: "fox".into(),
        replace: "dog".into(),
        match_case: false,
        whole_word: false,
        all: false,
        wildcards: false,
        format: None,
        replace_format: None,
    };
    apply(&mut h, cmd);
    assert_eq!(para(&h, 1).text(), "dog fox");
    assert_eq!(para(&h, 2).text(), "fox");
    assert_eq!(
        err_code(&mut h, replace_cmd("", "x", None)),
        "invalid_command"
    );
}

#[test]
fn character_styles_survive_docx_roundtrip() {
    let mut h = host(&["Hello world"]);
    h.apply(C::AddStyle {
        style: custom("Key", "Key Term", StyleKind::Character),
    })
    .unwrap();
    h.apply(C::ApplyCharacterStyle {
        block: id(1),
        from: 0,
        to: 5,
        style: Some("Key".into()),
    })
    .unwrap();
    let bytes = h.doc().save_docx().unwrap();
    let (back, warnings) = WriteDocument::open_docx(&bytes, "x.docx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let d = back.document();
    let p = d.paragraphs().next().unwrap();
    let r = p.inlines[0].as_run().unwrap();
    assert_eq!(
        (r.text.as_str(), r.style.as_deref()),
        ("Hello", Some("Key"))
    );
    assert_eq!(d.styles.get("Key").unwrap().name, "Key Term");
    assert!(d.styles.get("Key").unwrap().custom);
}
