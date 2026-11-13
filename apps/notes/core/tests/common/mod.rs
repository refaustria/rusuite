//! Shared helpers for the notes-core integration tests.
#![allow(dead_code)]
use loro::{ExportMode, LoroDoc, LoroList, LoroMap, LoroText, VersionVector};
use notes_core::{dispatch_with, NotesHost};
use serde_json::Value;

pub const T0: i64 = 1_763_000_000_000;

/// Dispatches a request (JSON value) and returns the `ok` body, panicking on an error reply.
pub fn ok(host: &mut NotesHost, req: Value) -> Value {
    let reply: Value = serde_json::from_str(&dispatch_with(host, &req.to_string())).unwrap();
    assert!(reply.get("err").is_none(), "{req} → {reply}");
    reply["ok"].clone()
}

pub fn err(host: &mut NotesHost, req: Value) -> String {
    let reply: Value = serde_json::from_str(&dispatch_with(host, &req.to_string())).unwrap();
    reply["err"]["code"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

/// A host with one notebook `nb` and one section; returns (host, section id).
pub fn host_with_section() -> (NotesHost, String) {
    let mut host = NotesHost::with_peers("dev-a", 11, 12);
    ok(
        &mut host,
        serde_json::json!({"type": "createNotebook", "name": "Work", "id": "nb", "now": T0}),
    );
    let s = ok(
        &mut host,
        serde_json::json!({"type": "createSection", "notebook": "nb", "title": "Inbox", "now": T0}),
    );
    (host, s["id"].as_str().unwrap().to_string())
}

pub fn create_page(host: &mut NotesHost, section: &str, title: &str) -> String {
    let p = ok(
        host,
        serde_json::json!({"type": "createPage", "notebook": "nb", "parent": section, "title": title}),
    );
    p["page"]["docId"].as_str().unwrap().to_string()
}

/// The editor side: a mirror `LoroDoc` seeded from the core, using the mirror peer id.
pub struct Mirror {
    pub doc: LoroDoc,
    sent: VersionVector,
}

impl Mirror {
    pub fn open(host: &mut NotesHost, doc_id: &str) -> Mirror {
        let opened = ok(
            host,
            serde_json::json!({"type": "openPage", "docId": doc_id}),
        );
        let doc = LoroDoc::new();
        doc.set_peer_id(
            opened["page"]["mirrorPeer"]
                .as_str()
                .unwrap()
                .parse()
                .unwrap(),
        )
        .unwrap();
        doc.set_change_merge_interval(opened["page"]["mergeIntervalSecs"].as_i64().unwrap());
        doc.import(&host.export_updates(doc_id, &[]).unwrap())
            .unwrap();
        let sent = doc.oplog_vv();
        Mirror { doc, sent }
    }

    fn children(&self) -> LoroList {
        self.doc
            .get_map("doc")
            .get("children")
            .unwrap()
            .into_container()
            .unwrap()
            .into_list()
            .unwrap()
    }

    /// Appends a paragraph with `text` (in loro-prosemirror's shape), as typing in the editor would.
    pub fn type_paragraph(&self, text: &str, attrs: &[(&str, Value)]) {
        let children = self.children();
        let p = children
            .insert_container(children.len(), LoroMap::new())
            .unwrap();
        p.insert("nodeName", "paragraph").unwrap();
        let a = p.insert_container("attributes", LoroMap::new()).unwrap();
        for (k, v) in attrs {
            a.insert(k, loro::LoroValue::from(v.clone())).unwrap();
        }
        let c = p.insert_container("children", LoroList::new()).unwrap();
        let t = c.insert_container(0, LoroText::new()).unwrap();
        t.insert(0, text).unwrap();
    }

    /// The text container of top-level block `i`.
    pub fn block_text(&self, i: usize) -> LoroText {
        let p = self
            .children()
            .get(i)
            .unwrap()
            .into_container()
            .unwrap()
            .into_map()
            .unwrap();
        let c = p
            .get("children")
            .unwrap()
            .into_container()
            .unwrap()
            .into_list()
            .unwrap();
        c.get(0)
            .unwrap()
            .into_container()
            .unwrap()
            .into_text()
            .unwrap()
    }

    /// Commits at `now` and ships the local updates to the core (as `subscribeLocalUpdates` would).
    pub fn commit_and_send(&mut self, host: &mut NotesHost, doc_id: &str, now: i64) {
        self.doc
            .commit_with(loro::CommitOptions::new().timestamp(now / 1000));
        let bytes = self.doc.export(ExportMode::updates(&self.sent)).unwrap();
        self.sent = self.doc.oplog_vv();
        host.import_updates(doc_id, &bytes, None).unwrap();
    }

    /// Pulls what the core has and the mirror does not.
    pub fn pull(&mut self, host: &mut NotesHost, doc_id: &str) {
        let bytes = host
            .export_updates(doc_id, &self.doc.oplog_vv().encode())
            .unwrap();
        self.doc.import(&bytes).unwrap();
    }
}
