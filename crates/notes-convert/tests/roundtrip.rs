//! Round trips of a fixture page with every block type through Markdown, HTML and .docx, the docx corpus, and a
//! LibreOffice check of exported .docx files (skipped when `soffice` is not installed).
use std::collections::HashMap;
use std::path::PathBuf;

use notes_convert::{
    blob_id, docx, html, markdown, take_title, ExportContext, ExportPage, ImportContext, TagCatalog,
};
use serde_json::{json, Value};

/// A 2×2 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00, 0xFD, 0xD4, 0x9A,
    0x73, 0x00, 0x00, 0x00, 0x10, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x44, 0x0C, 0x10, 0x0A, 0x00, 0x1F, 0xEE, 0x03, 0xFD, 0x8B, 0x5F, 0x14, 0xD4, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

fn t(s: &str) -> Value {
    json!({"type": "text", "text": s})
}

fn tm(s: &str, marks: Value) -> Value {
    json!({"type": "text", "text": s, "marks": marks})
}

fn p(content: Vec<Value>) -> Value {
    json!({"type": "paragraph", "content": content})
}

fn fixture() -> (Value, HashMap<String, Vec<u8>>) {
    let img = blob_id(PNG);
    let att = blob_id(b"attached bytes");
    let doc = json!({"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [t("Section heading")]},
        p(vec![
            t("Plain "),
            tm("bold", json!([{"type": "bold"}])),
            t(" "),
            tm("italic", json!([{"type": "italic"}])),
            t(" "),
            tm("under", json!([{"type": "underline"}])),
            t(" "),
            tm("struck", json!([{"type": "strike"}])),
            t(" "),
            tm("code", json!([{"type": "code"}])),
            t(" H"),
            tm("2", json!([{"type": "subscript"}])),
            t("O x"),
            tm("2", json!([{"type": "superscript"}])),
            t(" "),
            tm("marked", json!([{"type": "highlight", "attrs": {"color": "#FFFF00"}}])),
            t(" "),
            tm("red", json!([{"type": "textStyle", "attrs": {"color": "#FF0000"}}])),
            t(" "),
            tm("a link", json!([{"type": "link", "attrs": {"href": "https://example.com/x"}}])),
            json!({"type": "hardBreak"}),
            t("see "),
            json!({"type": "pageLink", "attrs": {"pageId": "pg-home", "title": "Home"}}),
        ]),
        {"type": "paragraph", "attrs": {"tags": ["important"]}, "content": [t("Tagged line")]},
        {"type": "bulletList", "content": [
            {"type": "listItem", "content": [p(vec![t("one")]),
                {"type": "orderedList", "content": [{"type": "listItem", "content": [p(vec![t("one.a")])]}]}]},
            {"type": "listItem", "content": [p(vec![t("two")])]}
        ]},
        {"type": "orderedList", "attrs": {"start": 3}, "content": [
            {"type": "listItem", "content": [p(vec![t("three")])]},
            {"type": "listItem", "content": [p(vec![t("four")])]}
        ]},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": true}, "content": [p(vec![t("done task")])]},
            {"type": "taskItem", "attrs": {"checked": false}, "content": [p(vec![t("open task")])]}
        ]},
        {"type": "blockquote", "content": [p(vec![t("Quoted words")])]},
        {"type": "codeBlock", "attrs": {"language": "rust"}, "content": [t("fn main() {\n    println!(\"hi\");\n}")]},
        {"type": "horizontalRule"},
        {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "content": [p(vec![t("Name")])]},
                {"type": "tableHeader", "content": [p(vec![t("Value")])]}
            ]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [p(vec![t("a")])]},
                {"type": "tableCell", "content": [p(vec![t("1")])]}
            ]}
        ]},
        {"type": "image", "attrs": {"blob": img, "alt": "dot"}},
        {"type": "attachment", "attrs": {"blob": att, "name": "notes.txt", "size": 14}},
        p(vec![t("The end.")]),
    ]});
    let blobs = HashMap::from([(img, PNG.to_vec()), (att, b"attached bytes".to_vec())]);
    (doc, blobs)
}

/// A comparable outline of content: node types, the attributes that matter, text with mark names.
fn shape(v: &Value, drop_marks: &[&str], out: &mut Vec<String>, depth: usize) {
    let ty = v["type"].as_str().unwrap_or_default();
    if ty == "text" {
        let mut ms: Vec<String> = v["marks"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|m| {
                        let n = m["type"].as_str()?;
                        if drop_marks.contains(&n) {
                            return None;
                        }
                        Some(match n {
                            "link" => format!("link={}", m["attrs"]["href"].as_str().unwrap_or("")),
                            "textStyle" | "highlight" => {
                                format!("{n}={}", m["attrs"]["color"].as_str().unwrap_or(""))
                            }
                            _ => n.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        ms.sort();
        out.push(format!(
            "{}{:?} {}",
            "  ".repeat(depth),
            v["text"].as_str().unwrap_or(""),
            ms.join(",")
        ));
        return;
    }
    let mut attrs = Vec::new();
    for k in [
        "level", "start", "checked", "language", "tags", "pageId", "alt", "name", "blob",
    ] {
        if let Some(a) = v["attrs"].get(k).filter(|a| !a.is_null()) {
            if k == "start" && a == 1 {
                continue;
            }
            attrs.push(format!("{k}={a}"));
        }
    }
    out.push(format!("{}{ty} {}", "  ".repeat(depth), attrs.join(" ")));
    if let Some(c) = v["content"].as_array() {
        // Merge adjacent texts with equal marks (writers may split them differently).
        let mut merged: Vec<Value> = Vec::new();
        for n in c {
            let mut n = n.clone();
            if let Some(ms) = n.get_mut("marks").and_then(Value::as_array_mut) {
                ms.retain(|m| !drop_marks.contains(&m["type"].as_str().unwrap_or_default()));
                if ms.is_empty() {
                    n.as_object_mut().unwrap().remove("marks");
                }
            }
            let n = &n;
            if let (Some(last), true) = (merged.last_mut(), n["type"] == "text") {
                if last["type"] == "text" && last.get("marks") == n.get("marks") {
                    let s = format!(
                        "{}{}",
                        last["text"].as_str().unwrap(),
                        n["text"].as_str().unwrap()
                    );
                    last["text"] = s.into();
                    continue;
                }
            }
            merged.push(n.clone());
        }
        for n in &merged {
            shape(n, drop_marks, out, depth + 1);
        }
    }
}

fn outline(blocks: &[Value], drop_marks: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    for b in blocks {
        shape(b, drop_marks, &mut out, 0);
    }
    out
}

fn resolve(title: &str) -> Option<String> {
    (title == "Home").then(|| "pg-home".to_string())
}

fn title_of(id: &str) -> Option<String> {
    (id == "pg-home").then(|| "Home".to_string())
}

fn page() -> (ExportPage, HashMap<String, Vec<u8>>) {
    let (doc, blobs) = fixture();
    (
        ExportPage {
            title: "Fixture page".into(),
            doc,
            level: 0,
        },
        blobs,
    )
}

fn blocks(doc: &Value) -> Vec<Value> {
    doc["content"].as_array().cloned().unwrap_or_default()
}

/// Applies a lossy step to the fixture: replace matching blocks.
fn map_blocks(v: Vec<Value>, f: &dyn Fn(Value) -> Vec<Value>) -> Vec<Value> {
    v.into_iter().flat_map(f).collect()
}

#[test]
fn markdown_round_trip() {
    let (page, blobs) = page();
    let ectx = ExportContext {
        page_title: Some(&title_of),
        tags: TagCatalog::builtin(),
    };
    let md = markdown::export_page(&page, &blobs, &ectx);
    assert!(md.starts_with("# Fixture page\n"));
    assert!(md.contains("[[Home]]"), "{md}");
    assert!(md.contains("Tagged line [Important]"), "{md}");
    assert!(md.contains("- [x] done task"), "{md}");
    assert!(md.contains("```rust"), "{md}");
    let ictx = ImportContext {
        resolve_page: Some(&resolve),
        tags: TagCatalog::builtin(),
    };
    let r = markdown::import(&md, &ictx);
    let mut got = r.value;
    assert_eq!(take_title(&mut got, "x"), "Fixture page");
    // Markdown keeps no colours; attachments become their name in a single-file export.
    let expected = map_blocks(blocks(&page.doc), &|b| {
        if b["type"] == "attachment" {
            vec![p(vec![t("📎 notes.txt")])]
        } else {
            vec![b]
        }
    });
    let mut want = outline(&expected, &["textStyle"]);
    for l in &mut want {
        *l = l.replace("highlight=#FFFF00", "highlight=");
    }
    assert_eq!(outline(&got, &["textStyle"]), want, "\n{md}");
    assert_eq!(r.blobs.len(), 1, "the image came back as a blob");
    assert_eq!(r.blobs[0].bytes, PNG);
}

#[test]
fn markdown_section_zip_has_pages_and_assets() {
    let (page, blobs) = page();
    let second = ExportPage {
        title: "Second/Page".into(),
        doc: json!({"type": "doc", "content": [p(vec![t("hello")])]}),
        level: 1,
    };
    let zip = markdown::export_section(&[page, second], &blobs, &ExportContext::default()).unwrap();
    let mut a = zip::ZipArchive::new(std::io::Cursor::new(zip)).unwrap();
    let names: Vec<String> = (0..a.len())
        .map(|i| a.by_index(i).unwrap().name().unwrap().to_string())
        .collect();
    assert!(
        names.contains(&"01 Fixture page.md".to_string()),
        "{names:?}"
    );
    assert!(
        names.contains(&"02 Second_Page.md".to_string()),
        "{names:?}"
    );
    assert!(names
        .iter()
        .any(|n| n.starts_with("assets/") && n.ends_with(".png")));
    assert!(names
        .iter()
        .any(|n| n.starts_with("assets/") && n.ends_with("notes.txt")));
}

#[test]
fn html_round_trip() {
    let (page, blobs) = page();
    let ectx = ExportContext {
        page_title: Some(&title_of),
        tags: TagCatalog::builtin(),
    };
    let doc = html::export_page(&page, &blobs, &ectx);
    assert!(doc.starts_with("<!DOCTYPE html>"));
    assert!(doc.contains("<title>Fixture page</title>"));
    assert!(doc.contains("data:image/png;base64,"));
    let ictx = ImportContext {
        resolve_page: Some(&resolve),
        tags: TagCatalog::builtin(),
    };
    let r = html::import(&doc, &ictx);
    let mut got = r.value;
    assert_eq!(take_title(&mut got, "x"), "Fixture page");
    assert_eq!(
        outline(&got, &[]),
        outline(&blocks(&page.doc), &[]),
        "\n{doc}"
    );
    assert_eq!(r.blobs.len(), 2);
}

#[test]
fn docx_round_trip() {
    let (page, blobs) = page();
    let ectx = ExportContext {
        page_title: Some(&title_of),
        tags: TagCatalog::builtin(),
    };
    let bytes = docx::export(std::slice::from_ref(&page), &blobs, &ectx).unwrap();
    let ictx = ImportContext {
        resolve_page: Some(&resolve),
        tags: TagCatalog::builtin(),
    };
    let r = docx::import(&bytes, &ictx).unwrap();
    let mut got = r.value;
    assert_eq!(take_title(&mut got, "x"), "Fixture page");
    // .docx loses: code block language, attachments (name only), the rule (a border), page links (text).
    let expected = map_blocks(blocks(&page.doc), &|mut b| match b["type"].as_str() {
        Some("attachment") => vec![p(vec![t("📎 notes.txt")])],
        Some("horizontalRule") => vec![],
        Some("codeBlock") => {
            b["attrs"] = json!({});
            vec![b]
        }
        _ => vec![b],
    });
    let mut want = outline(&expected, &[]);
    for l in &mut want {
        *l = l.replace("pageLink pageId=\"pg-home\"", "PAGELINK");
    }
    // The page link comes back as its title text, merged into the run before it.
    let want: Vec<String> = want
        .into_iter()
        .filter(|l| !l.trim_start().starts_with("PAGELINK"))
        .map(|l| l.replace("\"see \" ", "\"see Home\" "))
        .collect();
    assert_eq!(outline(&got, &[]), want);
    assert_eq!(r.blobs.len(), 1);
    assert_eq!(r.blobs[0].bytes, PNG);
}

#[test]
fn docx_section_export_puts_each_page_on_a_new_page() {
    let (page, blobs) = page();
    let second = ExportPage {
        title: "Second".into(),
        doc: json!({"type": "doc", "content": [p(vec![t("hello")])]}),
        level: 0,
    };
    let bytes = docx::export(&[page, second], &blobs, &ExportContext::default()).unwrap();
    let d = fmt_docx::read(&bytes).unwrap();
    let headings: Vec<_> = d
        .paragraphs()
        .filter(|p| p.props.style.as_deref() == Some("Heading1"))
        .collect();
    assert_eq!(headings.len(), 2);
    assert_eq!(headings[1].text(), "Second");
    assert_eq!(headings[1].props.page_break_before, Some(true));
    soffice_check(&bytes, "section");
}

fn testdata(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/docx")
        .join(rel)
}

#[test]
fn docx_corpus_imports() {
    let ctx = ImportContext::default();
    let read = |f: &str| docx::import(&std::fs::read(testdata(f)).unwrap(), &ctx).unwrap();

    let lists = read("provisional-18-bullet-list-3-levels.docx");
    assert_eq!(
        lists
            .value
            .iter()
            .filter(|b| b["type"] == "bulletList")
            .count(),
        1
    );
    let depth = serde_json::to_string(&lists.value)
        .unwrap()
        .matches("bulletList")
        .count();
    assert!(depth >= 3, "three nested levels: {depth}");

    let table = read("provisional-23-table-2x2.docx");
    let t = table
        .value
        .iter()
        .find(|b| b["type"] == "table")
        .expect("a table");
    let rows = t["content"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["content"].as_array().unwrap().len(), 2);

    let image = read("provisional-30-image-inline.docx");
    assert_eq!(image.blobs.len(), 1);
    assert!(image.value.iter().any(|b| b["type"] == "image"));

    let heading = read("provisional-01-heading-1.docx");
    assert!(heading
        .value
        .iter()
        .any(|b| b["type"] == "heading" && b["attrs"]["level"] == 1));
}

/// Converts `bytes` with LibreOffice (when installed) and fails on errors or warnings on stderr.
fn soffice_check(bytes: &[u8], name: &str) {
    let Ok(out) = std::process::Command::new("soffice")
        .arg("--version")
        .output()
    else {
        eprintln!("skipping LibreOffice check: soffice not found");
        return;
    };
    if !out.status.success() {
        eprintln!("skipping LibreOffice check: soffice --version failed");
        return;
    }
    let dir = std::env::temp_dir().join(format!("notes-convert-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join(format!("{name}.docx"));
    std::fs::write(&file, bytes).unwrap();
    // A private profile: parallel runs (other agents, other tests) must not share LibreOffice's lock.
    let profile = format!(
        "-env:UserInstallation=file://{}",
        dir.join("profile").display()
    );
    let out = std::process::Command::new("soffice")
        .args([&profile, "--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&dir)
        .arg(&file)
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let pdf = dir.join(format!("{name}.pdf"));
    let ok = out.status.success() && pdf.exists();
    let complaints: Vec<&str> = stderr
        .lines()
        .filter(|l| {
            let l = l.to_ascii_lowercase();
            (l.contains("error") || l.contains("warn")) && !l.contains("javaldx")
        })
        .collect();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(ok, "LibreOffice could not convert {name}: {stderr}");
    assert!(
        complaints.is_empty(),
        "LibreOffice complained: {complaints:?}"
    );
}

#[test]
fn docx_export_opens_in_libreoffice() {
    let (page, blobs) = page();
    let bytes = docx::export(&[page], &blobs, &ExportContext::default()).unwrap();
    soffice_check(&bytes, "page");
}
