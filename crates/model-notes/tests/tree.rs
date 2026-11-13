//! Notebook hierarchy: structure rules, ordering, soft delete / recycle bin, and the concurrency cases of the
//! P11-N0 spike (`tree_moves`) – review focus 2 of `docs/plan-3.14159.md` (concurrent move of the same page).
use model_notes::{NodeKind, NotebookDoc, NotesError, TreeNode, RECYCLE_BIN_MS};

const T0: i64 = 1_763_000_000_000;

fn sync(a: &NotebookDoc, b: &NotebookDoc) {
    let ua = a.doc().export(loro::ExportMode::all_updates()).unwrap();
    let ub = b.doc().export(loro::ExportMode::all_updates()).unwrap();
    a.doc().import(&ub).unwrap();
    b.doc().import(&ua).unwrap();
}

/// A notebook created on peer 1 and opened (synced) on peer 2.
fn pair() -> (NotebookDoc, NotebookDoc) {
    let a = NotebookDoc::new("Work", T0);
    a.doc().set_peer_id(1).unwrap();
    let b =
        NotebookDoc::from_bytes(&a.doc().export(loro::ExportMode::Snapshot).unwrap(), &[]).unwrap();
    b.doc().set_peer_id(2).unwrap();
    (a, b)
}

fn titles(nodes: &[TreeNode]) -> Vec<String> {
    nodes.iter().map(|n| n.title.clone()).collect()
}

fn find<'a>(nodes: &'a [TreeNode], id: &str) -> Option<&'a TreeNode> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(f) = find(&n.children, id) {
            return Some(f);
        }
    }
    None
}

fn count(nodes: &[TreeNode], id: &str) -> usize {
    nodes
        .iter()
        .map(|n| usize::from(n.id == id) + count(&n.children, id))
        .sum()
}

#[test]
fn new_notebook_has_name_format_version_and_builtin_tags() {
    let nb = NotebookDoc::new("Work", T0);
    let info = nb.info();
    assert_eq!(info.name, "Work");
    assert_eq!(info.format_version, model_notes::FORMAT_VERSION);
    let tags = nb.tags();
    assert!(tags.iter().any(|t| t.id == "todo" && t.kind.is_todo()));
    assert!(tags.iter().any(|t| t.id == "important"));
    assert!(nb.tree().is_empty());
}

#[test]
fn create_and_order_sections_groups_and_pages() {
    let nb = NotebookDoc::new("Work", T0);
    let s1 = nb.create_section(None, None, "Inbox", T0).unwrap();
    let g = nb.create_group(None, None, "Projects", T0).unwrap();
    let s2 = nb.create_section(Some(&g), None, "Rusuite", T0).unwrap();
    let s0 = nb.create_section(None, Some(0), "First", T0).unwrap();
    let p1 = nb.create_page(&s1, None, "Hello", T0).unwrap();
    let p2 = nb.create_page(&s1, Some(0), "Before hello", T0).unwrap();
    let sub = nb.create_page(&p1.node, None, "Sub page", T0).unwrap();

    let tree = nb.tree();
    assert_eq!(titles(&tree), ["First", "Inbox", "Projects"]);
    assert_eq!(tree[0].id, s0);
    let inbox = find(&tree, &s1).unwrap();
    assert_eq!(inbox.kind, NodeKind::Section);
    assert_eq!(titles(&inbox.children), ["Before hello", "Hello"]);
    assert_eq!(inbox.children[0].id, p2.node);
    let hello = find(&tree, &p1.node).unwrap();
    assert_eq!(hello.page_doc.as_deref(), Some(p1.doc_id.as_str()));
    assert_eq!(hello.created, T0);
    assert_eq!(titles(&hello.children), ["Sub page"]);
    assert_eq!(
        find(&tree, &sub.node).unwrap().parent.as_deref(),
        Some(p1.node.as_str())
    );
    assert_eq!(
        find(&tree, &s2).unwrap().parent.as_deref(),
        Some(g.as_str())
    );
    assert_ne!(p1.doc_id, p2.doc_id);
    assert_eq!(nb.page_doc_ids().len(), 3);
}

#[test]
fn structure_rules_are_enforced() {
    let nb = NotebookDoc::new("Work", T0);
    let g = nb.create_group(None, None, "G", T0).unwrap();
    let s = nb.create_section(None, None, "S", T0).unwrap();
    let p = nb.create_page(&s, None, "P", T0).unwrap();
    // Pages live in sections or under pages, never at the root or in a group.
    assert!(matches!(
        nb.create_page(&g, None, "x", T0),
        Err(NotesError::InvalidParent { .. })
    ));
    assert!(matches!(
        nb.move_node(&p.node, None, 0, T0),
        Err(NotesError::InvalidParent { .. })
    ));
    // Sections and groups never go under pages or sections.
    assert!(matches!(
        nb.create_section(Some(&s), None, "x", T0),
        Err(NotesError::InvalidParent { .. })
    ));
    assert!(matches!(
        nb.move_node(&g, Some(&p.node), 0, T0),
        Err(NotesError::InvalidParent { .. })
    ));
    // A node never moves under itself or its descendants.
    let g2 = nb.create_group(Some(&g), None, "G2", T0).unwrap();
    assert!(matches!(
        nb.move_node(&g, Some(&g2), 0, T0),
        Err(NotesError::Cycle)
    ));
    assert!(matches!(
        nb.rename("nope@1", "x", T0),
        Err(NotesError::UnknownNode(_))
    ));
}

#[test]
fn move_rename_colour() {
    let nb = NotebookDoc::new("Work", T0);
    let s1 = nb.create_section(None, None, "A", T0).unwrap();
    let s2 = nb.create_section(None, None, "B", T0).unwrap();
    let a = nb.create_page(&s1, None, "a", T0).unwrap();
    let b = nb.create_page(&s1, None, "b", T0).unwrap();
    let c = nb.create_page(&s1, None, "c", T0).unwrap();
    // Reorder within the parent: c to the front, then a to the end.
    nb.move_node(&c.node, Some(&s1), 0, T0 + 1).unwrap();
    assert_eq!(
        titles(&find(&nb.tree(), &s1).unwrap().children),
        ["c", "a", "b"]
    );
    nb.move_node(&a.node, Some(&s1), 2, T0 + 1).unwrap();
    assert_eq!(
        titles(&find(&nb.tree(), &s1).unwrap().children),
        ["c", "b", "a"]
    );
    // Across sections; indices count visible (not deleted) siblings only.
    nb.delete(&b.node, T0 + 2).unwrap();
    nb.move_node(&c.node, Some(&s2), 0, T0 + 3).unwrap();
    nb.move_node(&a.node, Some(&s2), 0, T0 + 3).unwrap();
    assert_eq!(titles(&find(&nb.tree(), &s2).unwrap().children), ["a", "c"]);
    nb.move_node(&s2, None, 0, T0 + 4).unwrap();
    assert_eq!(titles(&nb.tree()), ["B", "A"]);

    nb.rename(&s1, "Renamed", T0 + 5).unwrap();
    nb.set_color(&s1, Some("#FF8000"), T0 + 5).unwrap();
    let n = find(&nb.tree(), &s1).unwrap().clone();
    assert_eq!(
        (n.title.as_str(), n.color.as_deref(), n.modified),
        ("Renamed", Some("#FF8000"), T0 + 5)
    );
    nb.set_color(&s1, None, T0 + 6).unwrap();
    assert_eq!(find(&nb.tree(), &s1).unwrap().color, None);
    nb.rename_notebook("Private", T0).unwrap();
    assert_eq!(nb.info().name, "Private");
}

#[test]
fn soft_delete_restore_and_purge_after_60_days() {
    let nb = NotebookDoc::new("Work", T0);
    let s = nb.create_section(None, None, "S", T0).unwrap();
    let keep = nb.create_page(&s, None, "keep", T0).unwrap();
    let gone = nb.create_page(&s, None, "gone", T0).unwrap();
    let sub = nb.create_page(&gone.node, None, "sub", T0).unwrap();

    nb.delete(&gone.node, T0 + 10).unwrap();
    let tree = nb.tree();
    assert_eq!(titles(&find(&tree, &s).unwrap().children), ["keep"]);
    let bin = nb.recycle_bin();
    assert_eq!(bin.len(), 1);
    assert_eq!(bin[0].node.id, gone.node);
    assert_eq!(bin[0].deleted, T0 + 10);
    assert_eq!(
        titles(&bin[0].node.children),
        ["sub"],
        "the subtree goes with it"
    );

    nb.restore(&gone.node, T0 + 20).unwrap();
    assert_eq!(
        titles(&find(&nb.tree(), &s).unwrap().children),
        ["keep", "gone"]
    );
    assert!(nb.recycle_bin().is_empty());

    nb.delete(&gone.node, T0 + 30).unwrap();
    // Not expired yet.
    assert!(nb
        .purge_expired(T0 + 30 + RECYCLE_BIN_MS - 1)
        .unwrap()
        .is_empty());
    let purged = nb.purge_expired(T0 + 30 + RECYCLE_BIN_MS).unwrap();
    let mut docs = purged.clone();
    docs.sort();
    let mut want = vec![gone.doc_id.clone(), sub.doc_id.clone()];
    want.sort();
    assert_eq!(docs, want, "purge reports the page docs to drop");
    assert!(nb.recycle_bin().is_empty());
    assert_eq!(nb.page_doc_ids(), vec![keep.doc_id.clone()]);
    assert!(matches!(
        nb.restore(&gone.node, T0),
        Err(NotesError::UnknownNode(_))
    ));
}

#[test]
fn restore_of_a_page_inside_a_deleted_section_needs_the_section_or_a_target() {
    let nb = NotebookDoc::new("Work", T0);
    let s = nb.create_section(None, None, "S", T0).unwrap();
    let other = nb.create_section(None, None, "Other", T0).unwrap();
    let p = nb.create_page(&s, None, "p", T0).unwrap();
    nb.delete(&p.node, T0 + 1).unwrap();
    nb.delete(&s, T0 + 2).unwrap();
    let bin = nb.recycle_bin();
    let entry = bin.iter().find(|e| e.node.id == p.node).unwrap();
    assert!(entry.parent_deleted);
    assert!(matches!(
        nb.restore(&p.node, T0 + 3),
        Err(NotesError::ParentDeleted(_))
    ));
    nb.restore_to(&p.node, &other, T0 + 3).unwrap();
    assert_eq!(titles(&find(&nb.tree(), &other).unwrap().children), ["p"]);
}

/// Review focus 2: two people move the same page into different sections at the same time → the page exists once.
#[test]
fn concurrent_moves_of_the_same_page_keep_one_node() {
    let (a, b) = pair();
    let s1 = a.create_section(None, None, "S1", T0).unwrap();
    let s2 = a.create_section(None, None, "S2", T0).unwrap();
    let page = a.create_page(&s1, None, "page", T0).unwrap();
    sync(&a, &b);
    a.move_node(&page.node, Some(&s2), 0, T0 + 1).unwrap();
    let s3 = b.create_section(None, None, "S3", T0 + 1).unwrap();
    b.move_node(&page.node, Some(&s3), 0, T0 + 1).unwrap();
    sync(&a, &b);
    for nb in [&a, &b] {
        let tree = nb.tree();
        assert_eq!(count(&tree, &page.node), 1, "exactly one page");
        assert_eq!(nb.page_doc_ids(), vec![page.doc_id.clone()]);
    }
    assert_eq!(a.tree(), b.tree());
    assert_eq!(a.doc().get_deep_value(), b.doc().get_deep_value());
}

#[test]
fn concurrent_moves_that_would_form_a_cycle_leave_a_tree() {
    let (a, b) = pair();
    let x = a.create_group(None, None, "x", T0).unwrap();
    let y = a.create_group(None, None, "y", T0).unwrap();
    sync(&a, &b);
    a.move_node(&x, Some(&y), 0, T0 + 1).unwrap();
    b.move_node(&y, Some(&x), 0, T0 + 1).unwrap();
    sync(&a, &b);
    assert_eq!(a.tree(), b.tree());
    let tree = a.tree();
    assert_eq!(tree.len(), 1, "exactly one root, no cycle");
    assert_eq!(tree[0].children.len(), 1);
    assert_eq!(count(&tree, &x) + count(&tree, &y), 2);
}

#[test]
fn move_into_concurrently_deleted_section_lands_in_the_recycle_bin() {
    let (a, b) = pair();
    let s1 = a.create_section(None, None, "S1", T0).unwrap();
    let s2 = a.create_section(None, None, "S2", T0).unwrap();
    let page = a.create_page(&s1, None, "page", T0).unwrap();
    sync(&a, &b);
    a.delete(&s2, T0 + 1).unwrap();
    b.move_node(&page.node, Some(&s2), 0, T0 + 1).unwrap();
    sync(&a, &b);
    assert_eq!(a.tree(), b.tree());
    for nb in [&a, &b] {
        assert_eq!(count(&nb.tree(), &page.node), 0, "deleted with its section");
        let bin = nb.recycle_bin();
        let sec = bin
            .iter()
            .find(|e| e.node.id == s2)
            .expect("section in the recycle bin");
        assert_eq!(
            count(&sec.node.children, &page.node),
            1,
            "page recoverable with it"
        );
    }
    a.restore(&s2, T0 + 2).unwrap();
    assert_eq!(count(&a.tree(), &page.node), 1);
}

#[test]
fn concurrent_create_in_the_same_section_keeps_both() {
    let (a, b) = pair();
    let s = a.create_section(None, None, "S", T0).unwrap();
    sync(&a, &b);
    let pa = a.create_page(&s, Some(0), "from a", T0).unwrap();
    let pb = b.create_page(&s, Some(0), "from b", T0).unwrap();
    sync(&a, &b);
    assert_eq!(a.tree(), b.tree());
    let sec = find(&a.tree(), &s).unwrap().clone();
    assert_eq!(sec.children.len(), 2);
    assert_ne!(pa.doc_id, pb.doc_id);
}

#[test]
fn structural_undo_is_local_only() {
    let (a, b) = pair();
    let mut undo = a.undo_manager();
    let s = a.create_section(None, None, "S", T0).unwrap();
    undo.record_new_checkpoint().unwrap();
    sync(&a, &b);
    let sb = b.create_section(None, None, "B's", T0).unwrap();
    sync(&a, &b);
    a.rename(&s, "S renamed", T0 + 1).unwrap();
    assert!(undo.undo().unwrap());
    assert_eq!(find(&a.tree(), &s).unwrap().title, "S");
    assert!(undo.undo().unwrap());
    let tree = a.tree();
    assert!(find(&tree, &s).is_none(), "own create undone");
    assert!(find(&tree, &sb).is_some(), "peer's section untouched");
    assert!(undo.redo().unwrap());
    // Loro re-creates an undone node under a new tree id (meta copied), so the UI re-reads the tree after redo.
    assert_eq!(titles(&a.tree()), ["S", "B's"]);
}

#[test]
fn peers_map_records_device_ids() {
    let nb = NotebookDoc::new("Work", T0);
    nb.register_peer(42, "device-a").unwrap();
    nb.register_peer(42, "device-a").unwrap();
    assert_eq!(nb.device_of(42).as_deref(), Some("device-a"));
    assert_eq!(nb.device_of(7), None);
}

#[test]
fn custom_tags() {
    let nb = NotebookDoc::new("Work", T0);
    let id = nb
        .add_tag(
            "Waiting",
            Some("hourglass"),
            Some("#3366FF"),
            model_notes::TagKind::Custom,
        )
        .unwrap();
    let t = nb.tags().into_iter().find(|t| t.id == id).unwrap();
    assert_eq!(
        (t.label.as_str(), t.icon.as_deref()),
        ("Waiting", Some("hourglass"))
    );
}
