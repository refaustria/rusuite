//! The two-module path of the web app (P11-N6b): the converter side (`plan::convert::wire`, what
//! `app-notes-convert-wasm` exports) makes plans and files; the host applies plans (`binary::apply_import`) and
//! hands out import contexts and export sources. Results must match the one-step commands.
mod common;

use std::path::PathBuf;

use common::{create_page, host_with_section, ok, T0};
use notes_core::plan::convert::wire;
use notes_core::plan::{decode_frame, encode_frame, ImportPlan};
use notes_core::{binary, NotesHost, PersistEffect};
use serde_json::{json, Value};

fn sample(rel: &str) -> Option<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../testdata")
        .join(rel);
    std::fs::read(&path).ok().or_else(|| {
        eprintln!("skipping: {} not found", path.display());
        None
    })
}

fn apply(host: &mut NotesHost, req: Value, frame: &[u8]) -> Value {
    let reply: Value =
        serde_json::from_str(&binary::apply_import(host, &req.to_string(), frame)).unwrap();
    assert!(reply.get("err").is_none(), "{req} → {reply}");
    reply["ok"].clone()
}

fn titles(nodes: &Value, out: &mut Vec<String>) {
    for n in nodes.as_array().unwrap() {
        out.push(format!(
            "{}:{}",
            n["kind"].as_str().unwrap(),
            n["title"].as_str().unwrap()
        ));
        titles(&n["children"], out);
    }
}

fn blob_count(host: &mut NotesHost) -> usize {
    host.take_effects()
        .iter()
        .filter(|e| matches!(e, PersistEffect::Blob { .. }))
        .count()
}

#[test]
fn onenote_section_through_both_modules_matches_one_step() {
    let Some(bytes) = sample("onenote/notebook/New Section 1.one") else {
        return;
    };
    let frame = wire::import_file(
        &json!({"kind": "oneNote", "fileName": "New Section 1.one", "seed": 42}).to_string(),
        &bytes,
    )
    .unwrap();
    let (plan_json, blobs) = decode_frame(&frame).unwrap();
    let plan: ImportPlan = serde_json::from_str(plan_json).unwrap();
    assert!(plan.notebook.is_none());
    assert_eq!(plan.stats.sections, 1);
    assert!(plan.stats.pages >= 1);
    assert_eq!(
        (plan.stats.images + plan.stats.attachments) as usize,
        blobs.len()
    );

    let (mut split, _) = host_with_section();
    split.take_effects();
    let a = apply(
        &mut split,
        json!({"type": "importOneNote", "fileName": "New Section 1.one", "notebook": "nb", "now": T0}),
        &frame,
    );
    let (mut one, _) = host_with_section();
    one.take_effects();
    let b: Value = serde_json::from_str(&binary::import_file(
        &mut one,
        &json!({"type": "importOneNote", "fileName": "New Section 1.one", "notebook": "nb", "now": T0})
            .to_string(),
        &bytes,
    ))
    .unwrap();
    let b = &b["ok"];
    let (mut ta, mut tb) = (Vec::new(), Vec::new());
    titles(&a["tree"], &mut ta);
    titles(&b["tree"], &mut tb);
    assert_eq!(ta, tb);
    assert_eq!(
        a["pages"].as_array().unwrap().len(),
        plan.stats.pages as usize
    );
    assert_eq!(a["warnings"], b["warnings"]);
    assert_eq!(blob_count(&mut split), blob_count(&mut one));
    // The plan's doc ids are used.
    let first = plan.items.iter().find_map(|i| match i {
        notes_core::plan::PlanItem::Section { pages, .. } => pages[0].doc_id.clone(),
        notes_core::plan::PlanItem::Group { .. } => None,
    });
    assert_eq!(a["pages"][0]["docId"].as_str(), first.as_deref());
}

#[test]
fn onenote_errors_come_back_as_json() {
    let err = wire::import_file(
        &json!({"kind": "oneNote", "fileName": "x.one"}).to_string(),
        b"PK\x03\x04 not onenote",
    )
    .unwrap_err();
    let v: Value = serde_json::from_str(&err).unwrap();
    assert_eq!(v["err"]["code"], "format");
    let err = wire::import_file("{", b"").unwrap_err();
    assert!(err.contains("bad_request"), "{err}");
    // A section plan needs a target notebook; a broken frame is refused.
    let (mut host, _) = host_with_section();
    let frame = encode_frame(
        r#"{"items":[{"kind":"section","name":"S","pages":[]}]}"#,
        [],
    );
    let r: Value = serde_json::from_str(&binary::apply_import(
        &mut host,
        &json!({"type": "importOneNote", "fileName": "a.one"}).to_string(),
        &frame,
    ))
    .unwrap();
    assert_eq!(r["err"]["code"], "bad_request");
    let r: Value = serde_json::from_str(&binary::apply_import(
        &mut host,
        &json!({"type": "importOneNote", "fileName": "a.one", "notebook": "nb"}).to_string(),
        &frame[..2],
    ))
    .unwrap();
    assert_eq!(r["err"]["code"], "bad_request");
}

#[test]
fn custom_tags_and_doc_ids_of_a_plan() {
    let (mut host, section) = host_with_section();
    let taken = create_page(&mut host, &section, "Existing");
    let plan = json!({
        "notebook": {"name": "Imported", "color": "#336699"},
        "items": [{"kind": "group", "name": "G", "items": [{"kind": "section", "name": "S", "color": "#FF0000", "pages": [
            {"title": "P1", "docId": "pg-plan-1", "blocks": [
                {"type": "paragraph", "attrs": {"tags": ["import-tag-0", "important"]}, "content": [{"type": "text", "text": "Follow up"}]}]},
            {"title": "Sub", "level": 1, "docId": taken, "blocks": []},
            {"title": "Bad id", "docId": "../x", "blocks": []}
        ]}]}],
        "tags": [{"placeholder": "import-tag-0", "label": "Follow", "todo": true}],
        "warnings": [{"code": "x", "text": "x", "count": 2}]
    });
    let frame = encode_frame(&plan.to_string(), [b"blob-bytes".as_slice()]);
    let r = apply(
        &mut host,
        json!({"type": "importOneNote", "fileName": "x.onepkg", "id": "nb-new", "now": T0}),
        &frame,
    );
    assert_eq!(r["notebook"]["id"], "nb-new");
    assert_eq!(r["notebook"]["info"]["color"], "#336699");
    assert_eq!(r["warnings"][0]["count"], 2);
    let mut t = Vec::new();
    titles(&r["tree"], &mut t);
    assert_eq!(
        t,
        ["group:G", "section:S", "page:P1", "page:Sub", "page:Bad id"]
    );
    let pages = r["pages"].as_array().unwrap();
    assert_eq!(pages[0]["docId"], "pg-plan-1");
    assert_ne!(
        pages[1]["docId"],
        taken.as_str(),
        "a taken doc id is replaced"
    );
    assert_ne!(pages[2]["docId"], "../x");
    let tags = ok(&mut host, json!({"type": "tags", "notebook": "nb-new"}));
    let follow = tags["tags"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["label"] == "Follow")
        .expect("the custom tag");
    assert_eq!(follow["kind"], "customToDo");
    let page = host.page("pg-plan-1").unwrap().to_pm_json();
    assert_eq!(
        page.pointer("/content/0/attrs/tags"),
        Some(&json!([follow["id"].clone(), "important"]))
    );
    assert!(host
        .take_effects()
        .iter()
        .any(|e| matches!(e, PersistEffect::Blob { notebook, .. } if notebook == "nb-new")));
}

#[test]
fn markdown_with_the_notebook_context() {
    let (mut host, section) = host_with_section();
    create_page(&mut host, &section, "Home");
    let ctx = ok(
        &mut host,
        json!({"type": "importContext", "notebook": "nb"}),
    );
    assert_eq!(ctx["type"], "importContext");
    assert!(ctx["context"]["titles"]["home"].is_string());
    let frame = wire::import_file(
        &json!({"kind": "markdown", "fileName": "notes/Plan.md", "context": ctx["context"]})
            .to_string(),
        b"# Weekly plan\n\nSee [[Home]].\n\nCall Bob [To-do]\n",
    )
    .unwrap();
    let r = apply(
        &mut host,
        json!({"type": "importMarkdown", "fileName": "notes/Plan.md", "notebook": "nb", "parent": section}),
        &frame,
    );
    assert_eq!(r["nodes"].as_array().unwrap().len(), 1);
    let doc = r["pages"][0]["docId"].as_str().unwrap().to_string();
    let pm = host.page(&doc).unwrap().to_pm_json().to_string();
    assert!(pm.contains("pageLink"), "{pm}");
    assert!(pm.contains("\"todo\""), "{pm}");
    assert_eq!(host.page(&doc).unwrap().title(), "Weekly plan");
    // A page plan needs its parent.
    let r: Value = serde_json::from_str(&binary::apply_import(
        &mut host,
        &json!({"type": "importOneNote", "fileName": "x", "notebook": "nb"}).to_string(),
        &frame,
    ))
    .unwrap();
    assert_eq!(r["err"]["code"], "bad_request");
}

#[test]
fn exports_through_sources_match_one_step() {
    let (mut host, section) = host_with_section();
    let md = "# Exported\n\nSome **bold** text.\n\n![dot](data:image/png;base64,iVBORw0KGgo=)\n";
    let r = ok(
        &mut host,
        json!({"type": "importMarkdown", "fileName": "x.md", "notebook": "nb", "parent": section, "text": md}),
    );
    let doc = r["pages"][0]["docId"].as_str().unwrap().to_string();
    let blobs: Vec<Vec<u8>> = host
        .take_effects()
        .into_iter()
        .filter_map(|e| match e {
            PersistEffect::Blob { bytes, .. } => Some(bytes),
            _ => None,
        })
        .collect();
    let framed: Vec<u8> = blobs
        .iter()
        .flat_map(|b| notes_core::log_record(b))
        .collect();
    let src = ok(&mut host, json!({"type": "pageExportSource", "docId": doc}));
    assert_eq!(src["source"]["blobs"].as_array().unwrap().len(), 1);
    assert_eq!(src["source"]["title"], "Exported");
    for format in ["md", "html", "docx"] {
        let a = wire::export(
            &json!({"format": format, "source": src["source"]}).to_string(),
            &framed,
        )
        .unwrap();
        let b = binary::export(
            &mut host,
            &json!({"type": "exportPage", "docId": doc, "format": format}).to_string(),
            &framed,
        )
        .unwrap();
        if format == "docx" {
            assert!(a.starts_with(b"PK"));
        } else {
            assert_eq!(a, b, "{format}");
        }
    }
    let sec = ok(
        &mut host,
        json!({"type": "sectionExportSource", "notebook": "nb", "section": section}),
    );
    assert_eq!(sec["source"]["section"], true);
    let zip = wire::export(
        &json!({"format": "md", "source": sec["source"]}).to_string(),
        &framed,
    )
    .unwrap();
    assert!(zip.starts_with(b"PK"));
    let err = wire::export(
        &json!({"format": "md", "source": {"section": false, "title": "", "pages": []}})
            .to_string(),
        &[],
    )
    .unwrap_err();
    assert!(err.contains("bad_request"), "{err}");
}

#[test]
fn paste_through_the_convert_module() {
    let frame = wire::paste_html(
        &json!({"html": "<h2>Hi</h2><p onclick=\"x()\">a <a href=\"https://example.com/\">link</a> <img src=\"data:image/png;base64,iVBORw0KGgo=\"> <img src=\"https://tracker.example/p.png\" alt=\"remote\"></p>"})
            .to_string(),
    )
    .unwrap();
    let (json, blobs) = decode_frame(&frame).unwrap();
    let v: Value = serde_json::from_str(json).unwrap();
    let s = v["content"].to_string();
    assert_eq!(v["content"]["type"], "doc");
    assert!(
        s.contains("\"heading\"") && s.contains("https://example.com/"),
        "{s}"
    );
    assert!(!s.contains("onclick"), "{s}");
    assert_eq!(blobs.len(), 1);
    assert!(v["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w["code"] == "notes.image.remote"));
}
