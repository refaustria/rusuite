//! `.pptx` open/save through `dispatch_with` (P4-7, ADR 0002 file-IO
//! amendments).

use std::path::PathBuf;

use core_model::media::{base64_decode, base64_encode};
use core_model::{Color, Rgb};
use model_show::{Fill, NodeId, Presentation, Shape, ShapeKind, TextBody, TextParagraph};
use serde_json::{json, Value as Json};
use show_core::{dispatch_with, ShowCommand, ShowDocument, ShowHost};

fn testdata() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../testdata/pptx")
}

fn call(h: &mut ShowHost, req: &Json) -> Json {
    serde_json::from_str(&dispatch_with(h, &req.to_string())).unwrap()
}

fn ok(h: &mut ShowHost, req: &Json) -> Json {
    let reply = call(h, req);
    assert!(reply.get("ok").is_some(), "{req}: {reply}");
    reply["ok"].clone()
}

fn open(h: &mut ShowHost, bytes: &[u8], name: &str) -> Json {
    ok(
        h,
        &json!({"type": "openPptx", "bytesBase64": base64_encode(bytes), "name": name}),
    )
}

fn save(h: &mut ShowHost) -> (Vec<u8>, String) {
    let saved = ok(h, &json!({"type": "savePptx"}));
    assert_eq!(saved["type"], "saved");
    (
        base64_decode(saved["bytesBase64"].as_str().unwrap()).unwrap(),
        saved["suggestedName"].as_str().unwrap().to_owned(),
    )
}

fn apply(h: &mut ShowHost, cmd: &ShowCommand) -> Json {
    ok(h, &json!({"type": "apply", "command": cmd}))
}

fn manifest_files() -> Vec<String> {
    let text = std::fs::read_to_string(testdata().join("manifest.json")).unwrap();
    let entries: Vec<Json> = serde_json::from_str(&text).unwrap();
    entries
        .iter()
        .map(|e| e["file"].as_str().unwrap().to_owned())
        .collect()
}

/// `p` as JSON with every slide and shape id set to 0 (the JSON also
/// leaves out the private id counter).
fn without_ids(p: &Presentation) -> Json {
    fn walk(shapes: &mut [Shape]) {
        for s in shapes {
            s.id = NodeId(0);
            if let ShapeKind::Group { children } = &mut s.kind {
                walk(children);
            }
        }
    }
    let mut p = p.clone();
    for slide in &mut p.slides {
        slide.id = NodeId(0);
        walk(&mut slide.shapes);
    }
    serde_json::to_value(&p).unwrap()
}

/// The first shape with text on the first slide.
fn first_text_shape(p: &Presentation) -> &Shape {
    p.slides[0]
        .shapes
        .iter()
        .find(|s| s.text().is_some())
        .expect("a text shape on slide 1")
}

#[test]
fn opens_every_manifest_deck_and_saves_it_back() {
    let files = manifest_files();
    assert!(files.len() >= 25, "{} files", files.len());
    let mut h = ShowHost::new(ShowDocument::new());
    let mut last_revision = 0;
    for file in files {
        let bytes = std::fs::read(testdata().join(&file)).unwrap();
        let opened = open(&mut h, &bytes, &file);
        assert_eq!(opened["type"], "opened", "{file}");
        assert!(opened["warnings"].is_array(), "{file}");
        assert!(
            opened["presentation"]["slides"]
                .as_array()
                .is_some_and(|s| !s.is_empty()),
            "{file}"
        );
        let env = &opened["envelope"];
        assert_eq!(env["dirty"], false, "{file}");
        assert_eq!(env["canUndo"], false, "{file}");
        let revision = env["revision"].as_u64().unwrap();
        assert!(revision > last_revision, "{file}");
        last_revision = revision;
        let state = ok(&mut h, &json!({"type": "documentState"}));
        assert_eq!(state["name"], file.as_str());

        let (back, suggested) = save(&mut h);
        assert_eq!(suggested, file);
        let reopened = ShowDocument::open_pptx(&back, &file).unwrap().0;
        assert_eq!(
            without_ids(reopened.presentation()),
            without_ids(h.doc().presentation()),
            "{file}"
        );
    }
}

#[test]
fn edit_save_reopen_keeps_the_edit() {
    let file = "provisional-25-pitch-deck.pptx";
    let bytes = std::fs::read(testdata().join(file)).unwrap();
    let mut h = ShowHost::new(ShowDocument::new());
    open(&mut h, &bytes, file);
    let shape = first_text_shape(h.doc().presentation());
    let id = shape.id;
    let mut body: TextBody = shape.text().unwrap().clone();
    body.paragraphs.insert(0, TextParagraph::plain("EDITED"));
    let patch = apply(&mut h, &ShowCommand::SetTextBody { shape: id, body });
    assert_eq!(patch["envelope"]["dirty"], true);
    let slides = h.doc().presentation().slides.len();
    let last = h.doc().presentation().slides[slides - 1].id;
    apply(&mut h, &ShowCommand::DeleteSlides { ids: vec![last] });

    let (out, _) = save(&mut h);
    let mut h2 = ShowHost::new(ShowDocument::new());
    let reopened = open(&mut h2, &out, "copy.pptx");
    assert_eq!(
        reopened["presentation"]["slides"].as_array().unwrap().len(),
        slides - 1
    );
    let text = first_text_shape(h2.doc().presentation())
        .text()
        .unwrap()
        .plain_text();
    assert!(text.starts_with("EDITED"), "{text}");
    assert_eq!(
        without_ids(h2.doc().presentation()),
        without_ids(h.doc().presentation())
    );
}

#[test]
fn dirty_and_mark_saved_semantics() {
    let file = "provisional-06-blank-rectangle.pptx";
    let bytes = std::fs::read(testdata().join(file)).unwrap();
    let mut h = ShowHost::new(ShowDocument::new());
    let state = ok(&mut h, &json!({"type": "documentState"}));
    assert_eq!(
        state,
        json!({"type": "documentState", "dirty": false, "revision": 0, "name": null})
    );

    let opened = open(&mut h, &bytes, file);
    let rev = opened["envelope"]["revision"].as_u64().unwrap();
    let slide = h.doc().presentation().slides[0].id;
    apply(
        &mut h,
        &ShowCommand::SetSlideBackground {
            slide,
            fill: Some(Fill::Solid(Color::Rgb(Rgb::from_hex("C00000").unwrap()))),
        },
    );
    // savePptx does not mark the presentation saved.
    save(&mut h);
    let state = ok(&mut h, &json!({"type": "documentState"}));
    assert_eq!(state["dirty"], true);
    assert_eq!(state["name"], file);
    // markSaved without a name keeps the name; with a name renames (save as).
    let state = ok(&mut h, &json!({"type": "markSaved"}));
    assert_eq!(
        state,
        json!({"type": "documentState", "dirty": false, "revision": rev + 1, "name": file})
    );
    let state = ok(
        &mut h,
        &json!({"type": "markSaved", "name": "renamed.pptx"}),
    );
    assert_eq!(state["name"], "renamed.pptx");
    assert_eq!(save(&mut h).1, "renamed.pptx");
    // Undo after a save makes the presentation dirty again.
    ok(&mut h, &json!({"type": "undo"}));
    assert_eq!(ok(&mut h, &json!({"type": "documentState"}))["dirty"], true);
    // A new presentation forgets the name and the file context.
    ok(&mut h, &json!({"type": "newPresentation"}));
    assert_eq!(
        ok(&mut h, &json!({"type": "documentState"}))["name"],
        Json::Null
    );
    assert!(h.doc().pptx_context.is_none());
    assert_eq!(save(&mut h).1, "Untitled.pptx");
}

#[test]
fn open_errors() {
    let mut h = ShowHost::new(ShowDocument::new());
    let r = call(
        &mut h,
        &json!({"type": "openPptx", "bytesBase64": "%%%%", "name": "a.pptx"}),
    );
    assert_eq!(r["err"]["code"], "bad_request");
    let r = call(
        &mut h,
        &json!({"type": "openPptx", "bytesBase64": base64_encode(b"not a zip"), "name": "a.pptx"}),
    );
    assert_eq!(r["err"]["code"], "invalid_file");
    // A failed open leaves the presentation alone.
    assert_eq!(ok(&mut h, &json!({"type": "documentState"}))["revision"], 0);
    // The ping placeholder is gone.
    assert_eq!(
        call(&mut h, &json!({"type": "ping"}))["err"]["code"],
        "bad_request"
    );
}
