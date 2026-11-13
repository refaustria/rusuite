//! Reads the committed sample files (`testdata/onenote/`, see its README for
//! sources and licences). Tests skip with a message when a file is missing.
//! Extra local files (e.g. the owner's notebooks) can be checked with
//! `ONENOTE_EXTRA=/path/a.one,/path/b.onepkg cargo test -p fmt-onenote`.

use std::io::{Cursor, Write};
use std::path::PathBuf;

use fmt_onenote::{
    read_package, read_section, Block, NotebookItem, NumberFormat, OneNoteError, OneSection,
    PageItem, TagKind,
};

fn sample(rel: &str) -> Option<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/onenote")
        .join(rel);
    match std::fs::read(&path) {
        Ok(b) => Some(b),
        Err(_) => {
            eprintln!(
                "skipping: {} not found (see testdata/onenote/README.md)",
                path.display()
            );
            None
        }
    }
}

/// All blocks of a section, depth-first (table cells included).
fn blocks(s: &OneSection) -> Vec<&Block> {
    fn walk<'a>(b: &'a Block, out: &mut Vec<&'a Block>) {
        out.push(b);
        if let Block::Table { rows } = b {
            for cell in rows.iter().flatten() {
                for inner in cell {
                    walk(inner, out);
                }
            }
        }
    }
    let mut out = Vec::new();
    for p in &s.pages {
        for item in &p.contents {
            if let PageItem::Outline { blocks, .. } = item {
                for b in blocks {
                    walk(b, &mut out);
                }
            }
        }
    }
    out
}

fn paragraph_text(b: &Block) -> Option<String> {
    match b {
        Block::Paragraph { runs, .. } => Some(runs.iter().map(|r| r.text.as_str()).collect()),
        _ => None,
    }
}

#[test]
fn rich_page_with_lists_tables_tags_links_images_and_ink() {
    let Some(bytes) = sample("notebook/New Section 1.one") else {
        return;
    };
    let r = read_section(&bytes, "New Section 1.one").expect("reads");
    let s = &r.value;
    assert_eq!(s.name, "New Section 1");
    assert!(s.color.is_some());
    assert_eq!(s.pages.len(), 1);
    let page = &s.pages[0];
    assert_eq!(page.title, "Test Page");
    assert_eq!(page.level, 0);
    assert_eq!(page.created, Some(1_603_795_643));
    assert!(page.modified >= page.created);

    let all = blocks(s);
    let paras: Vec<_> = all.iter().filter_map(|b| paragraph_text(b)).collect();
    assert!(paras.iter().any(|t| t == "ABCDEF"));
    assert!(paras
        .iter()
        .any(|t| t.starts_with("Lorem ipsum dolor sit amet")));

    let headings = all
        .iter()
        .filter(|b| matches!(b, Block::Paragraph { style: Some(s), .. } if s == "heading1"))
        .count();
    assert_eq!(headings, 1);

    let lists: Vec<_> = all
        .iter()
        .filter_map(|b| match b {
            Block::Paragraph {
                list: Some(l),
                level,
                ..
            } => Some((l.clone(), *level)),
            _ => None,
        })
        .collect();
    assert_eq!(
        lists.iter().filter(|(l, _)| !l.ordered).count(),
        3,
        "bullets"
    );
    assert_eq!(
        lists.iter().filter(|(l, _)| l.ordered).count(),
        6,
        "numbered"
    );
    assert!(lists
        .iter()
        .any(|(l, lvl)| l.number_format == Some(NumberFormat::LowerRoman) && *lvl == 3));

    let tags: Vec<_> = all
        .iter()
        .flat_map(|b| match b {
            Block::Paragraph { tags, .. } => tags.clone(),
            _ => vec![],
        })
        .collect();
    let todos: Vec<_> = tags.iter().filter(|t| t.kind == TagKind::ToDo).collect();
    assert_eq!(todos.len(), 2);
    assert_eq!(todos.iter().filter(|t| t.checked == Some(true)).count(), 1);
    assert!(tags
        .iter()
        .any(|t| t.kind == TagKind::Important && t.checked.is_none()));

    let links: Vec<_> = all
        .iter()
        .flat_map(|b| match b {
            Block::Paragraph { runs, .. } => runs.iter().filter_map(|r| r.link.clone()).collect(),
            _ => vec![],
        })
        .collect();
    assert_eq!(links, ["https://example.com"]);
    assert!(
        !paras
            .iter()
            .any(|t| t.contains("HYPERLINK") || t.contains('\u{fddf}')),
        "link markers are hidden"
    );

    let tables: Vec<_> = all
        .iter()
        .filter_map(|b| match b {
            Block::Table { rows } => Some(rows),
            _ => None,
        })
        .collect();
    assert_eq!(tables.len(), 2);
    assert_eq!((tables[0].len(), tables[0][0].len()), (2, 3));
    assert_eq!(paragraph_text(&tables[0][1][2][0]).as_deref(), Some("3"));

    let images: Vec<_> = all
        .iter()
        .filter_map(|b| match b {
            Block::Image { mime, data, .. } => Some((mime, data)),
            _ => None,
        })
        .collect();
    assert_eq!(images.len(), 1);
    assert_eq!(images[0].0, "image/jpeg");
    assert!(images[0].1.starts_with(&[0xFF, 0xD8]));

    let inks: Vec<_> = page
        .contents
        .iter()
        .filter_map(|i| match i {
            PageItem::Ink { pos, strokes } => Some((pos, strokes)),
            _ => None,
        })
        .collect();
    assert_eq!(inks.len(), 1);
    let (pos, strokes) = inks[0];
    let pos = pos.expect("placed");
    assert!(pos.width.unwrap() > 0.0 && pos.height.unwrap() > 0.0);
    assert!(strokes[0].points.len() > 100);
    assert!(strokes
        .iter()
        .flat_map(|s| &s.points)
        .all(|&(x, y, _)| x >= 0.0 && y >= 0.0 && x <= pos.width.unwrap() + 0.01));

    let outline_pos = page.contents.iter().find_map(|i| match i {
        PageItem::Outline { pos, .. } => *pos,
        _ => None,
    });
    let outline_pos = outline_pos.expect("outline position");
    assert_eq!((outline_pos.x, outline_pos.y), (36.0, 86.4));

    let codes: Vec<_> = r.warnings.iter().map(|w| w.code.as_str()).collect();
    assert_eq!(codes, ["onenote.math"]);
}

#[test]
fn page_image_and_attached_file() {
    let Some(bytes) = sample("notebook/New Section Group/New Section 2.one") else {
        return;
    };
    let s = read_section(&bytes, "New Section 2.one").unwrap().value;
    let titles: Vec<_> = s.pages.iter().map(|p| p.title.as_str()).collect();
    assert_eq!(titles, ["Test Page 3", "Test Page 4"]);
    match &s.pages[0].contents[..] {
        [PageItem::Image {
            pos: Some(pos),
            mime,
            data,
            ..
        }] => {
            assert_eq!(mime, "image/png");
            assert!(data.starts_with(b"\x89PNG"));
            assert!(pos.width.is_some() && pos.height.is_some());
        }
        other => panic!("expected one image, got {other:?}"),
    }
    let attachments: Vec<_> = blocks(&s)
        .into_iter()
        .filter_map(|b| match b {
            Block::Attachment { file_name, data } => Some((file_name.clone(), data.len())),
            _ => None,
        })
        .collect();
    assert_eq!(attachments, [("ff-16b-2c-44100hz.mp3".to_owned(), 77_279)]);
}

#[test]
fn desktop_section_with_embedded_docx() {
    let Some(bytes) = sample("onenote-2016/OneWithFileData.one") else {
        return;
    };
    let s = read_section(&bytes, "OneWithFileData.one").unwrap().value;
    let att = blocks(&s).into_iter().find_map(|b| match b {
        Block::Attachment { file_name, data } => Some((file_name.clone(), data.clone())),
        _ => None,
    });
    let (name, data) = att.expect("attachment");
    assert_eq!(name, "testing.docx");
    assert_eq!(data.len(), 14_660);
    assert!(data.starts_with(b"PK"), "a zip (docx)");
}

#[test]
fn handwriting_strokes_are_read() {
    let Some(bytes) = sample("handwriting_recognition.one") else {
        return;
    };
    let s = read_section(&bytes, "handwriting_recognition.one")
        .unwrap()
        .value;
    let strokes: usize = s
        .pages
        .iter()
        .flat_map(|p| &p.contents)
        .map(|i| match i {
            PageItem::Ink { strokes, .. } => strokes.len(),
            _ => 0,
        })
        .sum();
    assert!(strokes >= 20, "{strokes} strokes");
}

#[test]
fn section_json_round_trips() {
    let Some(bytes) = sample("notebook/New Section 1.one") else {
        return;
    };
    let r = read_section(&bytes, "x.one").unwrap();
    let json = serde_json::to_string(&r).unwrap();
    let back: fmt_onenote::Imported<OneSection> = serde_json::from_str(&json).unwrap();
    assert_eq!(back, r);
}

/// Builds a `.onepkg` (MSZIP cabinet) from sample files: `(name in the
/// package, sample path)`, with `\\` separators as OneNote writes them.
fn build_package(files: &[(&str, &str)]) -> Option<Vec<u8>> {
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

fn sections(items: &[NotebookItem]) -> Vec<(String, usize)> {
    items
        .iter()
        .map(|i| match i {
            NotebookItem::Section(s) => (s.name.clone(), s.pages.len()),
            NotebookItem::Group { name, .. } => (format!("group {name}"), 0),
        })
        .collect()
}

#[test]
fn package_reads_the_sections_its_toc_lists() {
    // The sample notebook's root toc lists only "New Section 1.one"; the
    // section group folder next to it is not referenced and is ignored.
    let Some(pkg) = build_package(&[
        ("Open Notebook.onetoc2", "notebook/Open Notebook.onetoc2"),
        ("New Section 1.one", "notebook/New Section 1.one"),
        (
            "New Section Group\\Open Notebook.onetoc2",
            "notebook/New Section Group/Open Notebook.onetoc2",
        ),
        (
            "New Section Group\\New Section 2.one",
            "notebook/New Section Group/New Section 2.one",
        ),
    ]) else {
        return;
    };
    let r = read_package(&pkg, "C:\\Users\\me\\Work Notes.onepkg").expect("reads");
    assert_eq!(r.value.name, "Work Notes");
    assert_eq!(sections(&r.value.items), [("New Section 1".to_owned(), 1)]);
}

#[test]
fn package_sections_keep_toc_order() {
    let Some(pkg) = build_package(&[
        (
            "Open Notebook.onetoc2",
            "notebook/New Section Group/Open Notebook.onetoc2",
        ),
        (
            "New Section 2.one",
            "notebook/New Section Group/New Section 2.one",
        ),
        (
            "New Section 1.one",
            "notebook/New Section Group/New Section 1.one",
        ),
    ]) else {
        return;
    };
    let nb = read_package(&pkg, "Group.onepkg").unwrap().value;
    assert_eq!(
        sections(&nb.items),
        [
            ("New Section 1".to_owned(), 1),
            ("New Section 2".to_owned(), 2)
        ]
    );
}

#[test]
fn wrong_kinds_of_file_are_clear_errors() {
    let Some(one) = sample("notebook/New Section Group/New Section 1.one") else {
        return;
    };
    assert_eq!(
        read_package(&one, "renamed.onepkg"),
        Err(OneNoteError::SectionNotPackage)
    );
    if let Some(pkg) = build_package(&[("Open Notebook.onetoc2", "notebook/Open Notebook.onetoc2")])
    {
        assert_eq!(
            read_section(&pkg, "x.one").unwrap_err(),
            OneNoteError::NotASection { found: ".onepkg" }
        );
    }
    if let Some(toc) = sample("notebook/Open Notebook.onetoc2") {
        assert_eq!(
            read_section(&toc, "Open Notebook.onetoc2").unwrap_err(),
            OneNoteError::NotASection { found: ".onetoc2" }
        );
    }
    assert!(matches!(
        read_section(b"PK\x03\x04 a docx", "x.one"),
        Err(OneNoteError::NotOneNote { .. })
    ));
    assert!(matches!(
        read_package(b"", "x.onepkg"),
        Err(OneNoteError::NotOneNote { .. })
    ));
    // A cabinet without a notebook inside.
    let mut builder = cab::CabinetBuilder::new();
    builder
        .add_folder(cab::CompressionType::None)
        .add_file("readme.txt");
    let mut writer = builder.build(Cursor::new(Vec::new())).unwrap();
    while let Some(mut f) = writer.next_file().unwrap() {
        f.write_all(b"hello").unwrap();
    }
    let cab = writer.finish().unwrap().into_inner();
    assert!(matches!(
        read_package(&cab, "x.onepkg"),
        Err(OneNoteError::BadPackage(_))
    ));
}

#[test]
fn onenote_2007_header_is_reported() {
    let Some(mut one) = sample("onenote-2016/OneWithFileData.one") else {
        return;
    };
    // Unknown file format GUID (as in pre-2010 files).
    one[48..64].copy_from_slice(&[0x11; 16]);
    assert_eq!(
        read_section(&one, "old.one").unwrap_err(),
        OneNoteError::Legacy2007
    );
}

#[test]
fn truncated_files_are_errors() {
    for rel in [
        "notebook/New Section 1.one",
        "onenote-2016/OneWithFileData.one",
    ] {
        let Some(bytes) = sample(rel) else { continue };
        for cut in [
            0,
            10,
            70,
            512,
            4096,
            bytes.len() / 3,
            bytes.len() / 2,
            bytes.len() - 1,
        ] {
            let r = read_section(&bytes[..cut], "cut.one");
            assert!(r.is_err() || cut > 4096, "{rel} cut at {cut}: {r:?}");
        }
    }
}

#[test]
fn extra_local_files() {
    let Ok(list) = std::env::var("ONENOTE_EXTRA") else {
        return;
    };
    for path in list.split(',').filter(|p| !p.is_empty()) {
        let bytes = std::fs::read(path).expect(path);
        if path.ends_with(".onepkg") {
            match read_package(&bytes, path) {
                Ok(r) => eprintln!(
                    "{path}: {} items, {} warnings",
                    r.value.items.len(),
                    r.warnings.len()
                ),
                Err(e) => eprintln!("{path}: {e}"),
            }
        } else {
            match read_section(&bytes, path) {
                Ok(r) => {
                    eprintln!(
                        "{path}: {} pages, {} warnings",
                        r.value.pages.len(),
                        r.warnings.len()
                    );
                    for p in &r.value.pages {
                        eprintln!(
                            "  page {:?} level {} items {}",
                            p.title,
                            p.level,
                            p.contents.len()
                        );
                    }
                    for w in &r.warnings {
                        eprintln!("  warning {}: {}", w.code, w.line());
                    }
                }
                Err(e) => eprintln!("{path}: {e}"),
            }
        }
    }
}
