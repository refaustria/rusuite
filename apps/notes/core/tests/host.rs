//! notes-core end to end: dispatch, editor mirror exchange, persist effects, interop, tasks/backlinks/blobs,
//! history/restore/compaction.
mod common;

use common::{create_page, err, host_with_section, ok, Mirror, T0};
use loro::LoroDoc;
use notes_core::{decode_effects, encode_effects, NotesHost, PersistEffect};
use serde_json::json;

#[test]
fn dispatch_builds_a_notebook() {
    let (mut host, inbox) = host_with_section();
    let hello = ok(&mut host, json!({"type": "hello", "deviceId": "dev-a"}));
    assert_eq!(
        (hello["peer"].as_str(), hello["mirrorPeer"].as_str()),
        (Some("11"), Some("12"))
    );
    let g = ok(
        &mut host,
        json!({"type": "createGroup", "notebook": "nb", "title": "Projects", "index": 0}),
    );
    let g = g["id"].as_str().unwrap().to_string();
    let s2 = ok(
        &mut host,
        json!({"type": "createSection", "notebook": "nb", "parent": g, "title": "Rusuite"}),
    );
    let s2 = s2["id"].as_str().unwrap().to_string();
    let page = create_page(&mut host, &inbox, "First page");
    ok(
        &mut host,
        json!({"type": "setColor", "notebook": "nb", "node": inbox, "color": "#FF8000"}),
    );
    let tree = ok(&mut host, json!({"type": "getTree", "notebook": "nb"}))["tree"].clone();
    assert_eq!(tree[0]["title"], "Projects");
    assert_eq!(tree[0]["children"][0]["id"], json!(s2));
    assert_eq!(tree[1]["color"], "#FF8000");
    let node = tree[1]["children"][0].clone();
    assert_eq!(
        (node["title"].as_str(), node["pageDoc"].as_str()),
        (Some("First page"), Some(page.as_str()))
    );

    // Rename a page: tree and page doc title follow.
    ok(
        &mut host,
        json!({"type": "rename", "notebook": "nb", "node": node["id"], "title": "Renamed", "now": T0 + 5}),
    );
    assert_eq!(host.page(&page).unwrap().title(), "Renamed");
    // Move it into the other section, then undo (structural, local).
    ok(
        &mut host,
        json!({"type": "move", "notebook": "nb", "node": node["id"], "parent": s2, "index": 0}),
    );
    let tree = ok(&mut host, json!({"type": "getTree", "notebook": "nb"}))["tree"].clone();
    assert_eq!(tree[0]["children"][0]["children"][0]["title"], "Renamed");
    assert_eq!(
        ok(&mut host, json!({"type": "undo", "notebook": "nb"}))["changed"],
        true
    );
    let tree = ok(&mut host, json!({"type": "getTree", "notebook": "nb"}))["tree"].clone();
    assert_eq!(tree[1]["children"][0]["title"], "Renamed");

    // Errors carry stable codes.
    assert_eq!(
        err(&mut host, json!({"type": "getTree", "notebook": "nope"})),
        "unknown_notebook"
    );
    assert_eq!(
        err(
            &mut host,
            json!({"type": "createPage", "notebook": "nb", "parent": g, "title": "x"})
        ),
        "invalid_parent"
    );
    assert_eq!(
        err(
            &mut host,
            json!({"type": "move", "notebook": "nb", "node": g, "parent": s2, "index": 0})
        ),
        "cycle"
    );
    assert_eq!(err(&mut host, json!({"type": "bogus"})), "bad_request");
    let list = ok(&mut host, json!({"type": "listNotebooks"}));
    assert_eq!(list["notebooks"][0]["info"]["name"], "Work");
    assert_eq!(list["notebooks"][0]["pages"], 1);
}

#[test]
fn every_change_becomes_a_persist_effect_and_reloads() {
    let (mut host, inbox) = host_with_section();
    let page = create_page(&mut host, &inbox, "P");
    let mut m = Mirror::open(&mut host, &page);
    m.type_paragraph("hello from the editor", &[]);
    m.commit_and_send(&mut host, &page, T0 + 1000);
    let effects = host.take_effects();
    assert!(effects
        .iter()
        .all(|e| matches!(e, PersistEffect::Append { .. })));
    assert!(effects
        .iter()
        .any(|e| matches!(e, PersistEffect::Append { doc, .. } if doc == &page)));
    assert!(effects
        .iter()
        .any(|e| matches!(e, PersistEffect::Append { doc, .. } if doc == "nb")));
    assert_eq!(decode_effects(&encode_effects(&effects)).unwrap(), effects);
    assert!(host.take_effects().is_empty(), "drained");

    // A fresh host loads the same docs from the appended records.
    let mut logs: std::collections::BTreeMap<String, Vec<u8>> = Default::default();
    for e in &effects {
        if let PersistEffect::Append { doc, bytes, .. } = e {
            logs.entry(doc.clone())
                .or_default()
                .extend(notes_core::log_record(bytes));
        }
    }
    let mut other = NotesHost::with_peers("dev-b", 21, 22);
    for (doc, log) in &logs {
        assert!(other.load_doc("nb", doc, &[], log).unwrap().is_empty());
    }
    ok(&mut other, json!({"type": "openNotebook", "id": "nb"}));
    assert_eq!(
        other.page(&page).unwrap().plain_text(),
        "hello from the editor"
    );
    assert_eq!(
        other.notebook_doc("nb").unwrap().device_of(12).as_deref(),
        Some("dev-a"),
        "mirror peer recorded"
    );
    assert_eq!(
        other.notebook_doc("nb").unwrap().device_of(11).as_deref(),
        Some("dev-a")
    );
}

#[test]
fn core_edits_reach_the_mirror_and_remote_updates_merge() {
    let (mut host, inbox) = host_with_section();
    let page = create_page(&mut host, &inbox, "P");
    let mut m = Mirror::open(&mut host, &page);
    m.block_text(0).insert(0, "local").unwrap();
    m.commit_and_send(&mut host, &page, T0);

    // A remote peer edits the same page (relay path: import_updates without a mirror).
    let remote = LoroDoc::new();
    remote.set_peer_id(99).unwrap();
    remote
        .import(&host.export_updates(&page, &[]).unwrap())
        .unwrap();
    let rt = remote
        .get_map("doc")
        .get("children")
        .unwrap()
        .into_container()
        .unwrap()
        .into_list()
        .unwrap();
    let rp = rt
        .get(0)
        .unwrap()
        .into_container()
        .unwrap()
        .into_map()
        .unwrap();
    let rc = rp
        .get("children")
        .unwrap()
        .into_container()
        .unwrap()
        .into_list()
        .unwrap();
    rc.get(0)
        .unwrap()
        .into_container()
        .unwrap()
        .into_text()
        .unwrap()
        .insert(5, " + remote")
        .unwrap();
    remote.commit();
    let r = host
        .import_updates(
            &page,
            &remote.export(loro::ExportMode::all_updates()).unwrap(),
            None,
        )
        .unwrap();
    assert!(r.changed && !r.pending);
    // Re-sending the same bytes is harmless.
    let again = host
        .import_updates(
            &page,
            &remote.export(loro::ExportMode::all_updates()).unwrap(),
            None,
        )
        .unwrap();
    assert!(!again.changed);
    m.pull(&mut host, &page);
    assert_eq!(m.block_text(0).to_string(), "local + remote");
    assert_eq!(host.page(&page).unwrap().plain_text(), "local + remote");
    // Search sees imported text.
    let hits = ok(&mut host, json!({"type": "search", "query": "remote"}));
    assert_eq!(hits["hits"][0]["docId"], json!(page));
}

#[test]
fn unknown_page_doc_of_the_tree_starts_from_genesis() {
    let (mut host, inbox) = host_with_section();
    // Another device created a page; only the notebook update has arrived so far.
    let nb_bytes = host.export_updates("nb", &[]).unwrap();
    let mut b = NotesHost::with_peers("dev-b", 21, 22);
    b.load_doc("nb", "nb", &[], &notes_core::log_record(&nb_bytes))
        .unwrap();
    ok(&mut b, json!({"type": "openNotebook", "id": "nb"}));
    let page = create_page(&mut b, &inbox, "Remote page");
    let update = b
        .export_updates("nb", &host.version_vector("nb").unwrap())
        .unwrap();
    host.import_updates("nb", &update, None).unwrap();
    let opened = ok(&mut host, json!({"type": "openPage", "docId": page}));
    assert_eq!(opened["page"]["title"], "Remote page");
    assert_eq!(
        host.page(&page).unwrap().to_pm_json(),
        json!({"type": "doc", "content": [{"type": "paragraph"}]})
    );
    // When the creator's page doc arrives it merges with the local genesis.
    let pb = b.export_updates(&page, &[]).unwrap();
    host.import_updates(&page, &pb, None).unwrap();
    assert_eq!(host.page(&page).unwrap().title(), "Remote page");
}

/// Interop: a page written by the browser (loro-crdt WASM + loro-prosemirror, P11-N0 fixture).
#[test]
fn browser_page_from_the_spike_reads_correctly() {
    let snap = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/browser-snapshot.bin"
    ))
    .unwrap();
    let expected: serde_json::Value = serde_json::from_slice(
        &std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/browser-doc.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let mut host = NotesHost::with_peers("dev-a", 11, 12);
    ok(
        &mut host,
        json!({"type": "createNotebook", "name": "N", "id": "nb"}),
    );
    let s = ok(
        &mut host,
        json!({"type": "createSection", "notebook": "nb", "title": "S"}),
    )["id"]
        .clone();
    let page = create_page(&mut host, s.as_str().unwrap(), "Browser");
    // The spike's page used its own genesis: store it as the page's snapshot (a fresh doc, no local genesis).
    host.close_page(&page).unwrap();
    let nb_snap = host.notebook_doc("nb").unwrap().snapshot().unwrap();
    let mut h2 = NotesHost::with_peers("dev-a", 13, 14);
    h2.load_doc("nb", "nb", &nb_snap, &[]).unwrap();
    h2.load_doc("nb", &page, &snap, &[]).unwrap();
    ok(&mut h2, json!({"type": "openNotebook", "id": "nb"}));
    let p = h2.page(&page).unwrap();
    use loro::ToJson;
    assert_eq!(
        p.doc().get_deep_value().to_json_value()["doc"],
        expected["doc"]
    );
    assert_eq!(
        p.plain_text(),
        "Shopping and plans\nPlain paragraph with bold and italic and a link\nLists\nmilk\nbread\nfirst\nsecond\ncall mum\nbuy flowers"
    );
    let pm = p.to_pm_json();
    let marks: Vec<&str> = pm["content"][1]["content"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|t| t["marks"].as_array().into_iter().flatten())
        .filter_map(|m| m["type"].as_str())
        .collect();
    assert_eq!(marks, ["bold", "italic", "link"], "marks survive: {pm}");
    let tasks = ok(&mut h2, json!({"type": "tasks", "filter": "all"}))["tasks"].clone();
    assert_eq!(tasks.as_array().unwrap().len(), 2);
    assert_eq!(
        (tasks[0]["text"].as_str(), tasks[0]["checked"].as_bool()),
        (Some("call mum"), Some(true))
    );
    let open = ok(&mut h2, json!({"type": "tasks", "filter": "open"}))["tasks"].clone();
    assert_eq!(open[0]["text"], "buy flowers");
    let outline = h2.page(&page).unwrap().outline();
    assert_eq!(
        outline
            .iter()
            .map(|o| (o.level, o.text.as_str()))
            .collect::<Vec<_>>(),
        [(1, "Shopping and plans"), (2, "Lists")]
    );
}

#[test]
fn tasks_backlinks_and_blobs_across_notebooks() {
    let (mut host, inbox) = host_with_section();
    let target = create_page(&mut host, &inbox, "Target");
    let linker = create_page(&mut host, &inbox, "Linker");
    let mut m = Mirror::open(&mut host, &linker);
    m.type_paragraph(
        "pay rent",
        &[("tags", json!(["todo"])), ("checked", json!(false))],
    );
    m.type_paragraph("an idea", &[("tags", json!(["idea"]))]);
    m.type_paragraph(
        "done thing",
        &[("tags", json!(["todo"])), ("checked", json!(true))],
    );
    m.commit_and_send(&mut host, &linker, T0);
    // Another peer adds a page link and an image (PM JSON writer of model-notes).
    let other = LoroDoc::new();
    other.set_peer_id(55).unwrap();
    other
        .import(&host.export_updates(&linker, &[]).unwrap())
        .unwrap();
    let other = model_notes::PageDoc::from_doc(other);
    let vv = other.doc().oplog_vv();
    other
        .append_blocks(&[
            json!({"type": "paragraph", "content": [{"type": "pageLink", "attrs": {"pageId": target}}]}),
            json!({"type": "image", "attrs": {"blob": "aa11"}}),
        ])
        .unwrap();
    host.import_updates(
        &linker,
        &other.doc().export(loro::ExportMode::updates(&vv)).unwrap(),
        None,
    )
    .unwrap();
    // Second notebook with its own to-do.
    ok(
        &mut host,
        json!({"type": "createNotebook", "name": "Home", "id": "nb2"}),
    );
    let s = ok(
        &mut host,
        json!({"type": "createSection", "notebook": "nb2", "title": "S"}),
    )["id"]
        .clone();
    let p2 = ok(
        &mut host,
        json!({"type": "createPage", "notebook": "nb2", "parent": s, "title": "Shopping"}),
    );
    let p2 = p2["page"]["docId"].as_str().unwrap().to_string();
    let mut m2 = Mirror::open(&mut host, &p2);
    m2.type_paragraph("buy milk", &[("tags", json!(["todo"]))]);
    m2.commit_and_send(&mut host, &p2, T0);

    let open = ok(&mut host, json!({"type": "tasks", "filter": "open"}))["tasks"].clone();
    let texts: Vec<&str> = open
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, ["pay rent", "buy milk"]);
    assert_eq!(open[1]["notebookId"], "nb2");
    assert_eq!(open[0]["path"], json!([open[0]["block"].clone()]));
    let done = ok(&mut host, json!({"type": "tasks", "filter": "done"}))["tasks"].clone();
    assert_eq!(done[0]["text"], "done thing");

    let back = ok(&mut host, json!({"type": "backlinks", "pageId": target}))["pages"].clone();
    assert_eq!(back.as_array().unwrap().len(), 1);
    assert_eq!(
        (back[0]["docId"].as_str(), back[0]["title"].as_str()),
        (Some(linker.as_str()), Some("Linker"))
    );
    assert_eq!(
        ok(
            &mut host,
            json!({"type": "referencedBlobs", "notebook": "nb"})
        )["ids"],
        json!(["aa11"])
    );

    // Deleted pages drop out of tasks and backlinks.
    let node = host
        .notebook_doc("nb")
        .unwrap()
        .node_of_page_doc(&linker)
        .unwrap();
    ok(
        &mut host,
        json!({"type": "delete", "notebook": "nb", "node": node}),
    );
    assert!(
        ok(&mut host, json!({"type": "backlinks", "pageId": target}))["pages"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let open = ok(&mut host, json!({"type": "tasks", "filter": "open"}))["tasks"].clone();
    assert_eq!(open.as_array().unwrap().len(), 1);
    assert_eq!(
        ok(&mut host, json!({"type": "recycleBin", "notebook": "nb"}))["entries"][0]["node"]
            ["title"],
        "Linker"
    );
}

#[test]
fn purge_node_update_tag_and_put_blob() {
    let (mut host, inbox) = host_with_section();
    let a = create_page(&mut host, &inbox, "A");
    let b = create_page(&mut host, &inbox, "B");
    let doc = host.notebook_doc("nb").unwrap();
    let (na, nb_) = (
        doc.node_of_page_doc(&a).unwrap(),
        doc.node_of_page_doc(&b).unwrap(),
    );
    host.take_effects();
    for n in [&na, &nb_] {
        ok(
            &mut host,
            json!({"type": "delete", "notebook": "nb", "node": n}),
        );
    }
    let purged = ok(
        &mut host,
        json!({"type": "purgeNode", "notebook": "nb", "node": na}),
    );
    assert_eq!(purged["docIds"], json!([a.clone()]));
    let bin = ok(&mut host, json!({"type": "recycleBin", "notebook": "nb"}))["entries"].clone();
    assert_eq!(bin.as_array().unwrap().len(), 1);
    assert_eq!(bin[0]["node"]["title"], "B");
    assert!(host
        .take_effects()
        .iter()
        .any(|e| matches!(e, notes_core::PersistEffect::Delete { doc, .. } if *doc == a)));
    let code = err(
        &mut host,
        json!({"type": "purgeNode", "notebook": "nb", "node": "999@1"}),
    );
    assert!(!code.is_empty());

    let id = ok(
        &mut host,
        json!({"type": "addTag", "notebook": "nb", "label": "Waiting", "kind": "customToDo"}),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    ok(
        &mut host,
        json!({"type": "updateTag", "notebook": "nb", "id": id, "label": "Blocked", "color": "#FF0000", "icon": "lock"}),
    );
    let tags = ok(&mut host, json!({"type": "tags", "notebook": "nb"}))["tags"].clone();
    let t = tags
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == json!(id))
        .unwrap();
    assert_eq!(
        (&t["label"], &t["color"], &t["icon"], &t["kind"]),
        (
            &json!("Blocked"),
            &json!("#FF0000"),
            &json!("lock"),
            &json!("customToDo")
        )
    );
    assert_eq!(
        err(
            &mut host,
            json!({"type": "updateTag", "notebook": "nb", "id": "nope", "label": "x"})
        ),
        "unknown_tag"
    );

    let sha = notes_core::binary::put_blob(&mut host, "nb", b"png bytes").unwrap();
    assert_eq!(sha, notes_core::blob_id(b"png bytes"));
    notes_core::binary::put_blob(&mut host, "nb", b"png bytes").unwrap();
    let blobs: Vec<_> = host
        .take_effects()
        .into_iter()
        .filter(|e| matches!(e, notes_core::PersistEffect::Blob { .. }))
        .collect();
    assert_eq!(blobs.len(), 1, "queued once");
    assert!(notes_core::binary::put_blob(&mut host, "nope", b"x").is_err());
}

#[test]
fn history_groups_preview_restore_and_compaction() {
    let (mut host, inbox) = host_with_section();
    let page = create_page(&mut host, &inbox, "H");
    let mut m = Mirror::open(&mut host, &page);
    // Three edits within a minute (one group), then one 10 minutes later.
    for (i, w) in ["one", " two", " three"].iter().enumerate() {
        let t = m.block_text(0);
        t.insert(t.len_unicode(), w).unwrap();
        m.commit_and_send(&mut host, &page, T0 + 10_000 * (i as i64 + 1));
    }
    let t = m.block_text(0);
    t.insert(t.len_unicode(), " four").unwrap();
    m.commit_and_send(&mut host, &page, T0 + 600_000);
    // A remote peer edits in between our groups' times (separate group, unknown device).
    let remote = LoroDoc::new();
    remote.set_peer_id(77).unwrap();
    remote
        .import(&host.export_updates(&page, &[]).unwrap())
        .unwrap();
    remote.get_map("meta").insert("title", "H!").unwrap();
    remote.commit_with(loro::CommitOptions::new().timestamp((T0 + 700_000) / 1000));
    host.import_updates(
        &page,
        &remote.export(loro::ExportMode::all_updates()).unwrap(),
        None,
    )
    .unwrap();

    let entries = ok(&mut host, json!({"type": "history", "docId": page}))["entries"].clone();
    let e = entries.as_array().unwrap();
    let summary: Vec<(String, Option<String>)> = e
        .iter()
        .map(|g| {
            (
                g["peer"].as_str().unwrap().to_string(),
                g["deviceId"].as_str().map(str::to_string),
            )
        })
        .collect();
    // Core peer 11 (page meta at creation), mirror 12 (one + two + three), mirror 12 (four), remote 77.
    assert_eq!(
        summary,
        [
            ("11".to_string(), Some("dev-a".to_string())),
            ("12".to_string(), Some("dev-a".to_string())),
            ("12".to_string(), Some("dev-a".to_string())),
            ("77".to_string(), None)
        ]
    );
    assert_eq!(e[1]["start"], json!(T0 + 10_000));
    assert_eq!(e[1]["end"], json!(T0 + 30_000));
    let after_three = e[1]["frontiers"].clone();

    let preview = ok(
        &mut host,
        json!({"type": "checkoutPreview", "docId": page, "frontiers": after_three}),
    );
    assert_eq!(preview["preview"]["text"], "one two three");
    assert_eq!(
        host.page(&page).unwrap().plain_text(),
        "one two three four",
        "preview leaves the live doc"
    );

    let changes_before = host.page(&page).unwrap().doc().len_changes();
    ok(
        &mut host,
        json!({"type": "restore", "docId": page, "frontiers": after_three, "now": T0 + 800_000}),
    );
    let p = host.page(&page).unwrap();
    assert_eq!(p.plain_text(), "one two three");
    assert_eq!(p.title(), "H", "meta restored too");
    assert!(
        p.doc().len_changes() > changes_before,
        "restore adds ops, never rewrites history"
    );
    m.pull(&mut host, &page);
    assert_eq!(m.block_text(0).to_string(), "one two three");
    let n = ok(&mut host, json!({"type": "history", "docId": page}))["entries"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(n, 5);

    // Compaction: one snapshot that still has the full history.
    host.take_effects();
    ok(&mut host, json!({"type": "compact", "docId": page}));
    let effects = host.take_effects();
    let [PersistEffect::Replace { snapshot, .. }] = effects.as_slice() else {
        panic!("{effects:?}")
    };
    let reloaded = LoroDoc::new();
    reloaded.import(snapshot).unwrap();
    assert!(!reloaded.is_shallow());
    assert_eq!(model_notes::change_groups(&reloaded, 60).len(), 5);
}

#[test]
fn purge_drops_page_docs() {
    let (mut host, inbox) = host_with_section();
    let page = create_page(&mut host, &inbox, "Old");
    let node = host
        .notebook_doc("nb")
        .unwrap()
        .node_of_page_doc(&page)
        .unwrap();
    ok(
        &mut host,
        json!({"type": "delete", "notebook": "nb", "node": node, "now": T0}),
    );
    assert!(ok(
        &mut host,
        json!({"type": "purge", "notebook": "nb", "now": T0 + 1000})
    )["docIds"]
        .as_array()
        .unwrap()
        .is_empty());
    host.take_effects();
    let purged = ok(
        &mut host,
        json!({"type": "purge", "notebook": "nb", "now": T0 + model_notes::RECYCLE_BIN_MS}),
    );
    assert_eq!(purged["docIds"], json!([page]));
    assert!(host
        .take_effects()
        .iter()
        .any(|e| matches!(e, PersistEffect::Delete { doc, .. } if doc == &page)));
    assert_eq!(
        err(&mut host, json!({"type": "openPage", "docId": page})),
        "unknown_doc"
    );
}

#[test]
fn genesis_is_exposed_and_identical() {
    assert_eq!(notes_core::page_genesis(), model_notes::page_genesis());
    assert!(!notes_core::page_genesis().is_empty());
}

#[test]
fn rebind_device_records_earlier_peers_under_the_new_id() {
    let (mut host, inbox) = host_with_section();
    let page = create_page(&mut host, &inbox, "R");
    let mut m = Mirror::open(&mut host, &page);
    let t = m.block_text(0);
    t.insert(0, "before sharing").unwrap();
    m.commit_and_send(&mut host, &page, T0 + 1000);
    let devices = |host: &mut NotesHost| -> Vec<Option<String>> {
        let h = ok(host, json!({"type": "history", "docId": page}))["entries"].clone();
        h.as_array()
            .unwrap()
            .iter()
            .map(|g| g["deviceId"].as_str().map(str::to_string))
            .collect()
    };
    assert!(devices(&mut host)
        .iter()
        .all(|d| d.as_deref() == Some("dev-a")));
    host.take_effects();
    host.rebind_device("dev-a", "a1b2").unwrap();
    assert!(devices(&mut host)
        .iter()
        .all(|d| d.as_deref() == Some("a1b2")));
    // The new records are persisted (and so travel to the other members).
    assert!(host
        .take_effects()
        .iter()
        .any(|e| matches!(e, PersistEffect::Append { doc, .. } if doc == "nb")));
    // Further edits of this session record the new id too.
    let t = m.block_text(0);
    t.insert(0, "x").unwrap();
    m.commit_and_send(&mut host, &page, T0 + 900_000);
    assert!(devices(&mut host)
        .iter()
        .all(|d| d.as_deref() == Some("a1b2")));
}

/// P11-X1: a first share of a large page goes out in parts below the relay's envelope limit; a fresh device that
/// imports the parts (in order or reversed) has the same page.
#[test]
fn large_doc_exports_in_parts_below_the_limit() {
    let (mut host, inbox) = host_with_section();
    let page = create_page(&mut host, &inbox, "Big");
    let mut m = Mirror::open(&mut host, &page);
    // Incompressible text: ~450 kB in many changes, plus one 200 kB insert (a single change that must be sliced).
    // Scaled down from a 3 MB page and the relay's 512 KiB parts to keep the debug build fast; the engine test
    // (`apps/notes/src/sync/engine.test.ts`) sends a > 3 MB page.
    let mut seed = 0x2545_f491_4f6c_dd1d_u64;
    let mut text = |n: usize| -> String {
        (0..n)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                char::from(b'a' + (seed % 26) as u8)
            })
            .collect()
    };
    for i in 0..30 {
        m.type_paragraph(&text(15_000), &[]);
        m.commit_and_send(&mut host, &page, T0 + i * 60_000);
    }
    m.type_paragraph(&text(200_000), &[]);
    m.commit_and_send(&mut host, &page, T0 + 200 * 60_000);
    let all = host.export_updates(&page, &[]).unwrap();
    assert!(all.len() > 600 * 1024, "{}", all.len());

    let max = 64 * 1024;
    let parts = host.export_update_chunks(&page, &[], max).unwrap();
    assert!(parts.len() >= 7, "{} parts", parts.len());
    assert!(
        parts.iter().all(|p| p.len() <= max),
        "{:?}",
        parts.iter().map(Vec::len).collect::<Vec<_>>()
    );
    let expected = host.page(&page).unwrap().to_pm_json();
    for order in [false, true] {
        let mut b = NotesHost::with_peers("dev-b", 21, 22);
        b.load_doc(
            "nb",
            "nb",
            &[],
            &notes_core::log_record(&host.export_updates("nb", &[]).unwrap()),
        )
        .unwrap();
        ok(&mut b, json!({"type": "openNotebook", "id": "nb"}));
        let mut seq: Vec<&Vec<u8>> = parts.iter().collect();
        if order {
            seq.reverse();
        }
        for p in seq {
            b.import_updates(&page, p, None).unwrap();
        }
        assert_eq!(b.page(&page).unwrap().to_pm_json(), expected);
        assert_eq!(
            b.version_vector(&page).unwrap(),
            host.version_vector(&page).unwrap()
        );
    }
    // Small updates stay one part; updates since a version only cover what is new.
    let vv = host.version_vector(&page).unwrap();
    m.block_text(0).insert(0, "x").unwrap();
    m.commit_and_send(&mut host, &page, T0 + 300 * 60_000);
    let since = host.export_update_chunks(&page, &vv, max).unwrap();
    assert_eq!(since.len(), 1);
    assert!(since[0].len() < 1024, "{}", since[0].len());
}
