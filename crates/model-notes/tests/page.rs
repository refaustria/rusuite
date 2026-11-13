//! Page documents: deterministic genesis (spike rule b), the loro-prosemirror layout, readers, canvas and ink.
use loro::{ExportMode, LoroDoc, LoroText, ToJson};
use model_notes::{page_genesis, BlockTag, CanvasItem, InkStroke, OutlineEntry, PageDoc, TaskItem};
use serde_json::json;

const T0: i64 = 1_763_000_000_000;

/// The genesis paragraph's text container (the one both peers share).
fn first_text(p: &PageDoc) -> LoroText {
    let children = p
        .doc()
        .get_map("doc")
        .get("children")
        .unwrap()
        .into_container()
        .unwrap()
        .into_list()
        .unwrap();
    let para = children
        .get(0)
        .unwrap()
        .into_container()
        .unwrap()
        .into_map()
        .unwrap();
    let pc = para
        .get("children")
        .unwrap()
        .into_container()
        .unwrap()
        .into_list()
        .unwrap();
    pc.get(0)
        .unwrap()
        .into_container()
        .unwrap()
        .into_text()
        .unwrap()
}

fn sync(a: &LoroDoc, b: &LoroDoc) {
    let ua = a.export(ExportMode::all_updates()).unwrap();
    let ub = b.export(ExportMode::all_updates()).unwrap();
    a.import(&ub).unwrap();
    b.import(&ua).unwrap();
}

#[test]
fn genesis_is_deterministic_and_has_the_binding_layout() {
    assert_eq!(page_genesis(), page_genesis());
    let page = PageDoc::from_bytes(&[], &[page_genesis()]).unwrap();
    assert_eq!(
        page.doc().get_deep_value().to_json_value(),
        json!({"doc": {"nodeName": "doc", "attributes": {}, "children": [
            {"nodeName": "paragraph", "attributes": {}, "children": [""]}
        ]}})
    );
    assert_eq!(
        page.to_pm_json(),
        json!({"type": "doc", "content": [{"type": "paragraph"}]})
    );
}

/// The spike's failure case: two peers start the "same" new page independently and type – no text vanishes.
#[test]
fn two_peers_creating_the_same_page_keep_both_texts() {
    let a = PageDoc::create(Some("Shared"), T0);
    a.doc().set_peer_id(1).unwrap();
    let b = PageDoc::create(None, T0);
    b.doc().set_peer_id(2).unwrap();
    a.append_blocks(&[
        json!({"type": "paragraph", "content": [{"type": "text", "text": "from A"}]}),
    ])
    .unwrap();
    b.append_blocks(&[
        json!({"type": "paragraph", "content": [{"type": "text", "text": "from B"}]}),
    ])
    .unwrap();
    first_text(&a).insert(0, "a:").unwrap();
    first_text(&b).insert(0, "b:").unwrap();
    a.doc().commit();
    b.doc().commit();
    sync(a.doc(), b.doc());
    assert_eq!(a.doc().get_deep_value(), b.doc().get_deep_value());
    let text = a.plain_text();
    for s in ["from A", "from B", "a:", "b:"] {
        assert!(text.contains(s), "{s:?} missing in {text:?}");
    }
}

fn rich_page() -> PageDoc {
    let page = PageDoc::create(Some("Rich"), T0);
    page.append_blocks(&[
        json!({"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Plans"}]}),
        json!({"type": "paragraph", "content": [
            {"type": "text", "text": "See "},
            {"type": "text", "text": "the roadmap", "marks": [{"type": "pageLink", "attrs": {"pageId": "pg-1"}}]},
            {"type": "text", "text": " and "},
            {"type": "pageLink", "attrs": {"pageId": "pg-2", "title": "Ideas"}},
            {"type": "text", "text": " now", "marks": [{"type": "bold"}]},
            {"type": "hardBreak"},
            {"type": "text", "text": "line two"}
        ]}),
        json!({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Todo"}]}),
        json!({"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": true}, "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "call mum"}]}]},
            {"type": "taskItem", "attrs": {"checked": false}, "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "buy flowers"}]}]}
        ]}),
        json!({"type": "paragraph", "attrs": {"tags": ["todo", "important"], "checked": false},
               "content": [{"type": "text", "text": "file taxes"}]}),
        json!({"type": "paragraph", "attrs": {"tags": ["idea"]}, "content": [{"type": "text", "text": "a bot"}]}),
        json!({"type": "image", "attrs": {"blob": "ab12", "alt": "cat"}}),
        json!({"type": "paragraph", "content": [
            {"type": "attachment", "attrs": {"blob": "cd34", "name": "a.pdf"}},
            {"type": "pageLink", "attrs": {"pageId": "pg-1"}}
        ]}),
    ])
    .unwrap();
    page
}

#[test]
fn readers_over_prosemirror_content() {
    let page = rich_page();
    assert_eq!(page.title(), "Rich");
    let text = page.plain_text();
    assert!(
        text.starts_with(
            "Plans\nSee the roadmap and Ideas now\nline two\nTodo\ncall mum\nbuy flowers\n"
        ),
        "{text}"
    );
    assert!(text.contains("file taxes"));

    assert_eq!(
        page.outline(),
        vec![
            OutlineEntry {
                level: 1,
                text: "Plans".into(),
                block: 1
            },
            OutlineEntry {
                level: 2,
                text: "Todo".into(),
                block: 3
            },
        ]
    );
    assert_eq!(
        page.links(),
        vec!["pg-1".to_string(), "pg-2".to_string()],
        "deduplicated, in order"
    );
    let mut blobs = page.blobs();
    blobs.sort();
    assert_eq!(blobs, ["ab12", "cd34"]);

    let tags = page.block_tags();
    assert_eq!(
        tags,
        vec![
            BlockTag {
                tags: vec!["todo".into(), "important".into()],
                checked: Some(false),
                text: "file taxes".into(),
                block: 5
            },
            BlockTag {
                tags: vec!["idea".into()],
                checked: None,
                text: "a bot".into(),
                block: 6
            },
        ]
    );
    let tasks = page.tasks(&["todo".to_string()]);
    assert_eq!(
        tasks,
        vec![
            TaskItem {
                text: "call mum".into(),
                checked: true,
                block: 4,
                tags: vec![]
            },
            TaskItem {
                text: "buy flowers".into(),
                checked: false,
                block: 4,
                tags: vec![]
            },
            TaskItem {
                text: "file taxes".into(),
                checked: false,
                block: 5,
                tags: vec!["todo".into(), "important".into()]
            },
        ]
    );
}

#[test]
fn pm_json_round_trip() {
    let page = rich_page();
    let pm = page.to_pm_json();
    let content = pm["content"].as_array().unwrap();
    // Genesis paragraph first (empty), then the appended blocks unchanged.
    assert_eq!(content[0], json!({"type": "paragraph"}));
    assert_eq!(
        content[2]["content"][1]["marks"],
        json!([{"type": "pageLink", "attrs": {"pageId": "pg-1"}}])
    );
    assert_eq!(
        content[2]["content"][4],
        json!({"type": "text", "text": " now", "marks": [{"type": "bold"}]})
    );
    assert_eq!(content[2]["content"][5], json!({"type": "hardBreak"}));
    let copy = PageDoc::create(None, T0);
    copy.append_blocks(&content[1..]).unwrap();
    assert_eq!(copy.to_pm_json(), pm);
}

#[test]
fn meta_canvas_and_ink() {
    let page = PageDoc::create(Some("Sketch"), T0);
    assert!(!page.is_canvas());
    page.set_canvas(true, T0 + 5).unwrap();
    page.set_title("Sketch 2", T0 + 6).unwrap();
    let meta = page.meta();
    assert!(meta.canvas);
    assert_eq!(
        (meta.title.as_str(), meta.created, meta.modified),
        ("Sketch 2", T0, T0 + 6)
    );

    let item = CanvasItem {
        id: "box1".into(),
        kind: "text".into(),
        x: 10.0,
        y: 20.0,
        w: 300.0,
        h: 0.0,
        blob: None,
    };
    page.add_canvas_item(&item).unwrap();
    page.add_canvas_item(&CanvasItem {
        id: "img".into(),
        kind: "image".into(),
        blob: Some("ef56".into()),
        ..item.clone()
    })
    .unwrap();
    page.move_canvas_item("box1", 50.0, 60.0).unwrap();
    let items = page.canvas_items();
    assert_eq!(items.len(), 2);
    assert_eq!((items[0].x, items[0].y), (50.0, 60.0));
    assert!(
        page.blobs().contains(&"ef56".to_string()),
        "canvas image blobs count"
    );

    let stroke = InkStroke {
        id: "s1".into(),
        tool: "pen".into(),
        color: "#000000".into(),
        width: 20,
        points: vec![0, 0, 128, 10, 12, 255],
    };
    page.add_stroke(&stroke).unwrap();
    assert_eq!(page.ink_strokes(), vec![stroke]);
    page.remove_stroke("s1").unwrap();
    assert!(page.ink_strokes().is_empty());
}

#[test]
fn strokes_written_by_the_web_editor_read_back() {
    // loro-crdt (JS) stores numbers as doubles; the canvas editor (P11-N4) writes strokes that way.
    let page = PageDoc::create(Some("Ink"), T0);
    let m = page
        .doc()
        .get_list("ink")
        .push_container(loro::LoroMap::new())
        .unwrap();
    m.insert("id", "s-web").unwrap();
    m.insert("tool", "highlighter").unwrap();
    m.insert("color", "#FFEB3B").unwrap();
    m.insert("width", 120.0).unwrap();
    m.insert(
        "points",
        vec![
            loro::LoroValue::Double(10.0),
            loro::LoroValue::Double(-20.0),
            loro::LoroValue::Double(128.0),
        ],
    )
    .unwrap();
    page.doc().commit();
    let s = &page.ink_strokes()[0];
    assert_eq!((s.width, s.points.clone()), (120, vec![10, -20, 128]));
}

#[test]
fn imported_content_replaces_the_empty_genesis_paragraph() {
    let p = PageDoc::create(Some("Imported"), T0);
    p.import_blocks(
        &[
            json!({"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "H"}]}),
            json!({"type": "paragraph", "content": [{"type": "text", "text": "body"}]}),
        ],
        T0 + 5,
    )
    .unwrap();
    let pm = p.to_pm_json();
    let kinds: Vec<&str> = pm["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["type"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["heading", "paragraph"]);
    // Nothing to import: the genesis paragraph stays (the editor needs a text block).
    let q = PageDoc::create(None, T0);
    q.import_blocks(&[], T0).unwrap();
    assert_eq!(q.to_pm_json()["content"].as_array().unwrap().len(), 1);
    // A page that already has content keeps it.
    p.import_blocks(&[json!({"type": "paragraph"})], T0)
        .unwrap();
    assert_eq!(p.to_pm_json()["content"].as_array().unwrap().len(), 3);
}

#[test]
fn page_times_can_be_set() {
    let p = PageDoc::create(Some("Old"), T0);
    p.set_times(1_600_000_000_000, 1_600_000_500_000).unwrap();
    let m = p.meta();
    assert_eq!(
        (m.created, m.modified),
        (1_600_000_000_000, 1_600_000_500_000)
    );
}

#[test]
fn appended_marks_do_not_spread_to_the_next_run() {
    let p = PageDoc::create(None, T0);
    p.append_blocks(&[json!({"type": "paragraph", "content": [
        {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
        {"type": "text", "text": " plain "},
        {"type": "text", "text": "link", "marks": [{"type": "link", "attrs": {"href": "https://x"}}]},
        {"type": "text", "text": " end"}
    ]})])
    .unwrap();
    let para = &p.to_pm_json()["content"][1]["content"];
    assert_eq!(para[0]["text"], "bold");
    assert_eq!(para[1]["text"], " plain ");
    assert!(para[1].get("marks").is_none(), "{para}");
    assert_eq!(para[3]["text"], " end");
    assert!(para[3].get("marks").is_none(), "{para}");
}
