//! Import (OneNote, Markdown, HTML, .docx) and export (Markdown, HTML, .docx) through the dispatch and binary
//! entry points. OneNote samples: `testdata/onenote/` (tests skip with a message when a file is missing).
mod common;

use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use common::{create_page, host_with_section, ok, T0};
use notes_core::{binary, decode_effects, NotesHost, PersistEffect};
use serde_json::{json, Value};

fn sample(rel: &str) -> Option<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../testdata")
        .join(rel);
    match std::fs::read(&path) {
        Ok(b) => Some(b),
        Err(_) => {
            eprintln!("skipping: {} not found", path.display());
            None
        }
    }
}

fn import(host: &mut NotesHost, req: Value, bytes: &[u8]) -> Value {
    let reply: Value =
        serde_json::from_str(&binary::import_file(host, &req.to_string(), bytes)).unwrap();
    assert!(reply.get("err").is_none(), "{req} → {reply}");
    reply["ok"].clone()
}

fn blob_effects(host: &mut NotesHost) -> HashMap<String, Vec<u8>> {
    let bytes = notes_core::encode_effects(&host.take_effects());
    decode_effects(&bytes)
        .unwrap()
        .into_iter()
        .filter_map(|e| match e {
            PersistEffect::Blob { sha256, bytes, .. } => Some((sha256, bytes)),
            _ => None,
        })
        .collect()
}

fn find<'a>(nodes: &'a [Value], title: &str) -> Option<&'a Value> {
    for n in nodes {
        if n["title"] == title {
            return Some(n);
        }
        if let Some(f) = n["children"].as_array().and_then(|c| find(c, title)) {
            return Some(f);
        }
    }
    None
}

fn page_json(host: &mut NotesHost, doc: &str) -> Value {
    host.page(doc).unwrap().to_pm_json()
}

#[test]
fn onenote_section_imports_into_the_open_notebook() {
    let Some(bytes) = sample("onenote/notebook/New Section 1.one") else {
        return;
    };
    let (mut host, _) = host_with_section();
    host.take_effects();
    let r = import(
        &mut host,
        json!({"type": "importOneNote", "fileName": "New Section 1.one", "notebook": "nb", "now": T0}),
        &bytes,
    );
    assert_eq!(r["type"], "fileImported");
    let tree = r["tree"].as_array().unwrap();
    let section = find(tree, "New Section 1").expect("the section");
    assert_eq!(section["kind"], "section");
    assert!(section["color"]
        .as_str()
        .is_some_and(|c| c.starts_with('#')));
    let page = &section["children"][0];
    assert_eq!(page["title"], "Test Page");
    assert_eq!(page["created"], 1_603_795_643_000_i64);
    let doc = page["pageDoc"].as_str().unwrap().to_string();

    // The page has ink: a canvas page with strokes; its text is searchable.
    let p = host.page(&doc).unwrap();
    assert!(p.is_canvas());
    assert!(!p.ink_strokes().is_empty());
    assert!(!p.canvas_items().is_empty());
    assert!(p.plain_text().contains("ABCDEF"));
    assert_eq!(p.meta().created, 1_603_795_643_000);
    let hits = ok(&mut host, json!({"type": "search", "query": "ABCDEF"}));
    assert_eq!(hits["hits"][0]["docId"], doc);

    // To-dos: two, one ticked; the "important" tag is kept.
    let tasks = ok(&mut host, json!({"type": "tasks", "filter": "all"}));
    let tasks = tasks["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2, "{tasks:?}");
    assert_eq!(tasks.iter().filter(|t| t["checked"] == true).count(), 1);
    let pm = page_json(&mut host, &doc).to_string();
    assert!(pm.contains("\"important\""));

    // The JPEG is a blob, queued for storage and referenced by the notebook.
    let blobs = blob_effects(&mut host);
    assert!(blobs.values().any(|b| b.starts_with(&[0xFF, 0xD8])));
    let referenced = ok(
        &mut host,
        json!({"type": "referencedBlobs", "notebook": "nb"}),
    );
    for id in blobs.keys() {
        assert!(
            referenced["ids"].as_array().unwrap().contains(&json!(id)),
            "{id}"
        );
    }
    // Reader warnings pass through.
    let codes: Vec<&str> = r["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"onenote.math"), "{codes:?}");
}

#[test]
fn onenote_pages_images_and_attachments() {
    let Some(bytes) = sample("onenote/notebook/New Section Group/New Section 2.one") else {
        return;
    };
    let (mut host, _) = host_with_section();
    host.take_effects();
    let r = import(
        &mut host,
        json!({"type": "importOneNote", "fileName": "New Section 2.one", "notebook": "nb"}),
        &bytes,
    );
    let section = find(r["tree"].as_array().unwrap(), "New Section 2").unwrap();
    let titles: Vec<&str> = section["children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Test Page 3", "Test Page 4"]);
    assert_eq!(r["pages"].as_array().unwrap().len(), 2);
    let doc3 = section["children"][0]["pageDoc"]
        .as_str()
        .unwrap()
        .to_string();
    // A single picture on the page: a flowing page with an image block.
    let p3 = page_json(&mut host, &doc3);
    assert!(!host.page(&doc3).unwrap().is_canvas());
    assert_eq!(p3["content"][0]["type"], "image");
    let blobs = blob_effects(&mut host);
    assert!(blobs.values().any(|b| b.starts_with(b"\x89PNG")));
    assert!(
        blobs.values().any(|b| b.len() == 77_279),
        "the mp3 attachment"
    );
    let all: String = r["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| page_json(&mut host, p["docId"].as_str().unwrap()).to_string())
        .collect();
    assert!(all.contains("\"attachment\"") && all.contains("ff-16b-2c-44100hz.mp3"));
}

#[test]
fn onenote_handwriting_is_a_canvas_page() {
    let Some(bytes) = sample("onenote/handwriting_recognition.one") else {
        return;
    };
    let (mut host, _) = host_with_section();
    let r = import(
        &mut host,
        json!({"type": "importOneNote", "fileName": "handwriting_recognition.one", "notebook": "nb"}),
        &bytes,
    );
    let strokes: usize = r["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let page = host.page(p["docId"].as_str().unwrap()).unwrap();
            let n = page.ink_strokes().len();
            assert_eq!(page.is_canvas(), n > 0, "pages with ink are canvas pages");
            n
        })
        .sum();
    assert!(strokes >= 20, "{strokes}");
}

/// A `.onepkg` (MSZIP cabinet) from sample files.
fn package(files: &[(&str, &str)]) -> Option<Vec<u8>> {
    let mut data = Vec::new();
    for (_, rel) in files {
        data.push(sample(rel)?);
    }
    let mut builder = cab::CabinetBuilder::new();
    let folder = builder.add_folder(cab::CompressionType::MsZip);
    for (name, _) in files {
        folder.add_file(*name);
    }
    let mut writer = builder.build(Cursor::new(Vec::new())).unwrap();
    let mut i = 0;
    while let Some(mut f) = writer.next_file().unwrap() {
        f.write_all(&data[i]).unwrap();
        i += 1;
    }
    Some(writer.finish().unwrap().into_inner())
}

#[test]
fn onenote_package_becomes_a_new_notebook() {
    let Some(pkg) = package(&[
        (
            "Open Notebook.onetoc2",
            "onenote/notebook/New Section Group/Open Notebook.onetoc2",
        ),
        (
            "New Section 2.one",
            "onenote/notebook/New Section Group/New Section 2.one",
        ),
        (
            "New Section 1.one",
            "onenote/notebook/New Section Group/New Section 1.one",
        ),
    ]) else {
        return;
    };
    let mut host = NotesHost::with_peers("dev", 21, 22);
    let r = import(
        &mut host,
        json!({"type": "importOneNote", "fileName": "Work Notes.onepkg", "id": "nb-imp", "now": T0}),
        &pkg,
    );
    assert_eq!(r["notebook"]["id"], "nb-imp");
    assert_eq!(r["notebook"]["info"]["name"], "Work Notes");
    let sections: Vec<&str> = r["tree"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["title"].as_str().unwrap())
        .collect();
    assert_eq!(sections, ["New Section 1", "New Section 2"]);
    assert_eq!(r["notebook"]["pages"], 3);
    let effects = host.take_effects();
    assert!(effects
        .iter()
        .any(|e| matches!(e, PersistEffect::Append { doc, .. } if doc == "nb-imp")));
    // A second import of the same package into an explicit id is refused (notebook open).
    let reply: Value = serde_json::from_str(&binary::import_file(
        &mut host,
        &json!({"type": "importOneNote", "fileName": "x.onepkg", "id": "nb-imp"}).to_string(),
        &pkg,
    ))
    .unwrap();
    assert_eq!(reply["err"]["code"], "notebook_open");
}

#[test]
fn onenote_errors_are_clear() {
    let (mut host, _) = host_with_section();
    let reply: Value = serde_json::from_str(&binary::import_file(
        &mut host,
        &json!({"type": "importOneNote", "fileName": "x.one", "notebook": "nb"}).to_string(),
        b"PK\x03\x04 not onenote",
    ))
    .unwrap();
    assert_eq!(reply["err"]["code"], "format");
    // A section needs a target notebook.
    if let Some(bytes) = sample("onenote/notebook/New Section 1.one") {
        let reply: Value = serde_json::from_str(&binary::import_file(
            &mut host,
            &json!({"type": "importOneNote", "fileName": "a.one"}).to_string(),
            &bytes,
        ))
        .unwrap();
        assert_eq!(reply["err"]["code"], "bad_request");
    }
    // Bytes only through the binary path.
    let reply: Value = serde_json::from_str(&notes_core::dispatch_with(
        &mut host,
        &json!({"type": "importDocx", "fileName": "a.docx", "notebook": "nb", "parent": "x"})
            .to_string(),
    ))
    .unwrap();
    assert_eq!(reply["err"]["code"], "bad_request");
}

#[test]
fn markdown_import_through_dispatch_links_pages_and_tags() {
    let (mut host, section) = host_with_section();
    let home = create_page(&mut host, &section, "Home");
    let r = ok(
        &mut host,
        json!({"type": "importMarkdown", "fileName": "notes/Plan.md", "notebook": "nb", "parent": section,
               "text": "# Weekly plan\n\nSee [[Home]].\n\nCall Bob [To-do]\n\n- [x] shipped\n", "now": T0 + 1}),
    );
    assert_eq!(r["type"], "fileImported");
    let page = &r["pages"][0];
    let doc = page["docId"].as_str().unwrap().to_string();
    let tree = r["tree"].as_array().unwrap();
    assert!(
        find(tree, "Weekly plan").is_some(),
        "title from the leading H1"
    );
    let back = ok(&mut host, json!({"type": "backlinks", "pageId": home}));
    assert_eq!(back["pages"][0]["docId"], doc);
    let tasks = ok(&mut host, json!({"type": "tasks", "filter": "all"}));
    let texts: Vec<&str> = tasks["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["text"].as_str().unwrap())
        .collect();
    assert!(texts.contains(&"Call Bob"), "{texts:?}");
    assert!(texts.contains(&"shipped"), "{texts:?}");
    // The first block is content, not the genesis' empty paragraph.
    assert_eq!(
        page_json(&mut host, &doc)["content"][0]["type"],
        "paragraph"
    );
    assert_eq!(
        page_json(&mut host, &doc)["content"][0]["content"][0]["text"],
        "See "
    );
}

#[test]
fn html_paste_is_sanitised_and_queues_blobs() {
    let (mut host, _) = host_with_section();
    host.take_effects();
    let r = ok(
        &mut host,
        json!({"type": "pasteHtml", "notebook": "nb",
               "html": "<p onclick=\"x()\">Hi<script>alert(1)</script> <img src=\"data:image/png;base64,iVBORw0KGgo=\"></p>"}),
    );
    assert_eq!(r["type"], "pasted");
    let s = r["content"].to_string();
    assert!(!s.contains("alert") && !s.contains("onclick"), "{s}");
    assert_eq!(r["content"]["type"], "doc");
    assert!(s.contains("\"image\""));
    assert_eq!(blob_effects(&mut host).len(), 1);
    assert!(r["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w["code"] == "notes.html.removed"));
}

#[test]
fn html_and_docx_files_import_as_pages() {
    let (mut host, section) = host_with_section();
    let r = import(
        &mut host,
        json!({"type": "importHtml", "fileName": "page.html", "notebook": "nb", "parent": section}),
        b"<html><head><title>From the web</title></head><body><p>Hello <b>world</b></p></body></html>",
    );
    assert!(find(r["tree"].as_array().unwrap(), "From the web").is_some());

    let Some(docx) = sample("docx/provisional-23-table-2x2.docx") else {
        return;
    };
    let r = import(
        &mut host,
        json!({"type": "importDocx", "fileName": "provisional-23-table-2x2.docx", "notebook": "nb", "parent": section}),
        &docx,
    );
    let doc = r["pages"][0]["docId"].as_str().unwrap().to_string();
    assert!(page_json(&mut host, &doc).to_string().contains("\"table\""));
}

fn export(host: &mut NotesHost, req: Value, blobs: &[u8]) -> Vec<u8> {
    binary::export(host, &req.to_string(), blobs).unwrap_or_else(|e| panic!("{req}: {e}"))
}

#[test]
fn pages_and_sections_export() {
    let (mut host, section) = host_with_section();
    let md = "# Exported\n\nSome **bold** text.\n\n- a\n- b\n\n![dot](data:image/png;base64,iVBORw0KGgo=)\n";
    let r = ok(
        &mut host,
        json!({"type": "importMarkdown", "fileName": "x.md", "notebook": "nb", "parent": section, "text": md}),
    );
    let doc = r["pages"][0]["docId"].as_str().unwrap().to_string();
    let blobs = blob_effects(&mut host);
    let framed: Vec<u8> = blobs
        .values()
        .flat_map(|b| notes_core::log_record(b))
        .collect();
    create_page(&mut host, &section, "Second");

    let out = export(
        &mut host,
        json!({"type": "exportPage", "docId": doc, "format": "md"}),
        &framed,
    );
    let text = String::from_utf8(out).unwrap();
    assert!(text.starts_with("# Exported\n"), "{text}");
    assert!(text.contains("**bold**"), "{text}");
    assert!(text.contains("data:image/png;base64,"), "{text}");

    let out = export(
        &mut host,
        json!({"type": "exportPage", "docId": doc, "format": "html"}),
        &framed,
    );
    let html = String::from_utf8(out).unwrap();
    assert!(html.contains("<strong>bold</strong>") && html.contains("<title>Exported</title>"));

    let out = export(
        &mut host,
        json!({"type": "exportPage", "docId": doc, "format": "docx"}),
        &[],
    );
    assert!(out.starts_with(b"PK"));

    let zip = export(
        &mut host,
        json!({"type": "exportSection", "notebook": "nb", "section": section, "format": "md"}),
        &framed,
    );
    let mut a = zip::ZipArchive::new(Cursor::new(zip)).unwrap();
    let names: Vec<String> = (0..a.len())
        .map(|i| a.by_index(i).unwrap().name().unwrap().to_string())
        .collect();
    assert!(names.contains(&"01 Exported.md".to_string()), "{names:?}");
    assert!(names.contains(&"02 Second.md".to_string()), "{names:?}");
    assert!(names.iter().any(|n| n.starts_with("assets/")));

    let docx = export(
        &mut host,
        json!({"type": "exportSection", "notebook": "nb", "section": section, "format": "docx"}),
        &framed,
    );
    assert!(docx.starts_with(b"PK"));
    let err = binary::export(
        &mut host,
        &json!({"type": "exportPage", "docId": "nope", "format": "md"}).to_string(),
        &[],
    )
    .unwrap_err();
    assert!(err.contains("unknown_doc"), "{err}");
}

#[test]
fn markdown_survives_the_page_document() {
    // Every Markdown construct, through a Loro page document and back.
    let (mut host, section) = host_with_section();
    create_page(&mut host, &section, "Home");
    let md = "# Round trip\n\n## Heading\n\nPlain **bold** *italic* <u>under</u> ~~gone~~ `code` H<sub>2</sub>O \
              <mark>hl</mark> [link](https://example.com/)\\\nsee [[Home]]\n\nTagged [Important]\n\n\
              - one\n  1. one.a\n- two\n\n3. three\n4. four\n\n- [x] done\n- [ ] open\n\n> quoted\n\n\
              ```rust\nfn main() {}\n```\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    let r = ok(
        &mut host,
        json!({"type": "importMarkdown", "fileName": "x.md", "notebook": "nb", "parent": section, "text": md}),
    );
    let doc = r["pages"][0]["docId"].as_str().unwrap().to_string();
    let out = binary::export(
        &mut host,
        &json!({"type": "exportPage", "docId": doc, "format": "md"}).to_string(),
        &[],
    )
    .unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), md);
}
