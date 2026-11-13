//! Storage: FolderStore round trip, crash-truncated logs, compaction on disk, `.rnotes` backups incl. blobs.
mod common;

use std::path::PathBuf;

use common::{create_page, host_with_section, ok, Mirror, T0};
use notes_core::{blob_id, FolderStore, NotesHost, PersistEffect};
use serde_json::json;

fn tmp(name: &str) -> PathBuf {
    let p = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("notes-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    p
}

/// A notebook folder with one page of text and an image blob; returns (store, page doc id, blob).
fn folder(name: &str) -> (FolderStore, NotesHost, String, Vec<u8>) {
    let (mut host, inbox) = host_with_section();
    let store = FolderStore::create(&tmp(name), "nb", "Work").unwrap();
    let page = create_page(&mut host, &inbox, "Stored page");
    let mut m = Mirror::open(&mut host, &page);
    m.block_text(0).insert(0, "persisted text").unwrap();
    m.commit_and_send(&mut host, &page, T0);
    let blob = b"\x89PNG fake image".to_vec();
    store.apply(&host.take_effects()).unwrap();
    store
        .apply(&[PersistEffect::Blob {
            notebook: "nb".into(),
            sha256: blob_id(&blob),
            bytes: blob.clone(),
        }])
        .unwrap();
    (store, host, page, blob)
}

#[test]
fn folder_round_trip() {
    let (store, _host, page, blob) = folder("roundtrip");
    let root = store.root().to_path_buf();
    assert!(root.join("notebook.json").exists());
    assert!(root.join("docs/nb.log").exists());
    assert!(root.join(format!("docs/{page}.log")).exists());
    assert!(root.join(format!("blobs/{}", blob_id(&blob))).exists());

    let store = FolderStore::open(&root).unwrap();
    assert_eq!(store.manifest().notebook_id, "nb");
    let mut host = NotesHost::with_peers("dev-b", 31, 32);
    let (summary, warnings) = store.load_into(&mut host).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(summary.info.name, "Work");
    assert_eq!(host.page(&page).unwrap().plain_text(), "persisted text");
    assert_eq!(store.get_blob(&blob_id(&blob)).unwrap(), blob);

    // Edits in the second session append to the same logs; compaction replaces them by a snapshot.
    let mut m = Mirror::open(&mut host, &page);
    let t = m.block_text(0);
    t.insert(t.len_unicode(), ", edited").unwrap();
    m.commit_and_send(&mut host, &page, T0 + 1);
    store.apply(&host.take_effects()).unwrap();
    ok(&mut host, json!({"type": "compact", "docId": page}));
    store.apply(&host.take_effects()).unwrap();
    assert!(root.join(format!("docs/{page}.snapshot")).exists());
    assert!(!root.join(format!("docs/{page}.log")).exists());
    let mut h3 = NotesHost::with_peers("dev-c", 41, 42);
    store.load_into(&mut h3).unwrap();
    assert_eq!(
        h3.page(&page).unwrap().plain_text(),
        "persisted text, edited"
    );
    assert_eq!(
        h3.history(&page).unwrap().len(),
        3,
        "history survives compaction"
    );
}

#[test]
fn append_after_crash() {
    let (store, mut host, page, _) = folder("crash");
    let log = store.root().join(format!("docs/{page}.log"));
    let good = std::fs::metadata(&log).unwrap().len();
    // A crash in the middle of an append: half a record at the end.
    let mut m = Mirror::open(&mut host, &page);
    m.block_text(0).insert(0, "lost? ").unwrap();
    m.commit_and_send(&mut host, &page, T0 + 2);
    let effects = host.take_effects();
    let PersistEffect::Append { bytes, .. } = effects
        .iter()
        .find(|e| matches!(e, PersistEffect::Append { doc, .. } if doc == &page))
        .unwrap()
    else {
        unreachable!()
    };
    let record = notes_core::log_record(bytes);
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&log).unwrap();
        f.write_all(&record[..record.len() / 2]).unwrap();
    }

    // Loading never fails: the torn record is dropped with a warning and the file repaired.
    let mut h2 = NotesHost::with_peers("dev-b", 51, 52);
    let (_, warnings) = FolderStore::open(store.root())
        .unwrap()
        .load_into(&mut h2)
        .unwrap();
    assert_eq!(warnings.len(), 1);
    assert_eq!(
        (warnings[0].code.as_str(), warnings[0].doc.as_str()),
        ("truncated_log", page.as_str())
    );
    assert_eq!(std::fs::metadata(&log).unwrap().len(), good);
    assert_eq!(h2.page(&page).unwrap().plain_text(), "persisted text");

    // Appending after the repair works and survives the next load.
    let mut m2 = Mirror::open(&mut h2, &page);
    m2.block_text(0).insert(0, "after crash: ").unwrap();
    m2.commit_and_send(&mut h2, &page, T0 + 3);
    store.apply(&h2.take_effects()).unwrap();
    let mut h3 = NotesHost::with_peers("dev-c", 61, 62);
    let (_, warnings) = store.load_into(&mut h3).unwrap();
    assert!(warnings.is_empty());
    assert_eq!(
        h3.page(&page).unwrap().plain_text(),
        "after crash: persisted text"
    );

    // The in-memory loader (web/IndexedDB path) tolerates a torn log the same way.
    let mut torn = std::fs::read(&log).unwrap();
    torn.extend_from_slice(&[9, 0, 0, 0, 1]);
    let mut h4 = NotesHost::with_peers("dev-d", 71, 72);
    let w = h4.load_doc("nb", &page, &[], &torn).unwrap();
    assert_eq!(w[0].code, "truncated_log");
}

#[test]
fn backup_round_trip_with_blobs() {
    let (store, mut host, page, blob) = folder("backup");
    // Host-made backup (web: "Download backup"): snapshots + the blobs the UI hands in.
    let referenced = vec![blob.clone()];
    let bytes = host.export_backup("nb", &referenced).unwrap();
    assert_eq!(&bytes[..2], b"PK");
    let mut other = NotesHost::with_peers("dev-b", 81, 82);
    let (summary, warnings) = other.import_backup(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(summary.id, "nb");
    assert_eq!(other.page(&page).unwrap().plain_text(), "persisted text");
    let effects = other.take_effects();
    assert!(effects
        .iter()
        .any(|e| matches!(e, PersistEffect::Blob { bytes, .. } if *bytes == blob)));
    assert!(effects
        .iter()
        .any(|e| matches!(e, PersistEffect::Replace { doc, .. } if doc == &page)));
    assert!(effects
        .iter()
        .any(|e| matches!(e, PersistEffect::Replace { doc, .. } if doc == "nb")));
    assert!(other.import_backup(&bytes).is_err(), "already open");

    // Folder-made backup (desktop) unpacks into a new folder that loads the same.
    let archive = store.export_backup().unwrap();
    let dir = tmp("restored");
    let (restored, warnings) = FolderStore::import_backup(&dir, &archive).unwrap();
    assert!(warnings.is_empty());
    assert_eq!(restored.get_blob(&blob_id(&blob)).unwrap(), blob);
    let mut h = NotesHost::with_peers("dev-c", 91, 92);
    restored.load_into(&mut h).unwrap();
    assert_eq!(h.page(&page).unwrap().plain_text(), "persisted text");
    assert!(
        FolderStore::import_backup(&dir, &archive).is_err(),
        "never overwrites a notebook folder"
    );
}

#[test]
fn hostile_backups_are_rejected_or_sanitised() {
    use std::io::Write;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    zip.start_file("notebook.json", o).unwrap();
    zip.write_all(br#"{"format":"rusuite-notes","formatVersion":1,"notebookId":"nb","name":"x"}"#)
        .unwrap();
    zip.start_file("docs/../../evil.snapshot", o).unwrap();
    zip.write_all(b"x").unwrap();
    zip.start_file(
        "blobs/0000000000000000000000000000000000000000000000000000000000000000",
        o,
    )
    .unwrap();
    zip.write_all(b"not matching").unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    let (b, warnings) = notes_core::Backup::read(&bytes).unwrap();
    assert!(b.docs.is_empty() && b.blobs.is_empty());
    let codes: Vec<&str> = warnings.iter().map(|w| w.code.as_str()).collect();
    assert_eq!(codes, ["unknown_entry", "blob_mismatch"]);

    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zip.start_file("notebook.json", o).unwrap();
    zip.write_all(br#"{"format":"rusuite-notes","formatVersion":99,"notebookId":"nb","name":"x"}"#)
        .unwrap();
    let newer = zip.finish().unwrap().into_inner();
    assert!(
        notes_core::Backup::read(&newer).is_err(),
        "newer format refused"
    );
}
