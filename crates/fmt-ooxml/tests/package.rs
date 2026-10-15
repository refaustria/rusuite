//! Package-level tests against an in-memory fixture.

mod common;

use std::io::Cursor;

use common::{assert_roundtrip_equivalent, build_zip, zip_entries};
use fmt_ooxml::{Error, Package, PartName, TargetMode, OFFICE_DOCUMENT_REL};

const IMAGE_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const LINK_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const MAIN_CT: &str = "application/x-test-main+xml";

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/x-test-main+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

const DOC_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/x.png"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/></Relationships>"#;

const DOC: &[u8] = b"<?xml version=\"1.0\"?>\n<doc>  untouched   whitespace </doc>";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n not really a png";

/// Minimal valid package; entries deliberately not in our write order.
fn fixture() -> Vec<u8> {
    build_zip(&[
        ("word/media/x.png", PNG),
        ("[Content_Types].xml", CONTENT_TYPES.as_bytes()),
        ("word/_rels/document.xml.rels", DOC_RELS.as_bytes()),
        ("_rels/.rels", ROOT_RELS.as_bytes()),
        ("word/document.xml", DOC),
    ])
}

fn pn(s: &str) -> PartName {
    PartName::new(s).unwrap()
}

fn write_to_vec(pkg: &Package) -> Vec<u8> {
    pkg.write(Cursor::new(Vec::new())).unwrap().into_inner()
}

#[test]
fn open_and_inspect() {
    let pkg = Package::open(Cursor::new(fixture())).unwrap();
    let names: Vec<_> = pkg.parts().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names, ["/word/media/x.png", "/word/document.xml"]);

    let main = pkg.main_document_part().unwrap();
    assert_eq!(main.as_str(), "/word/document.xml");
    assert_eq!(pkg.content_type_of(&main), Some(MAIN_CT));
    assert_eq!(pkg.part(&main).unwrap().data, DOC);
    assert_eq!(
        pkg.content_type_of(&pn("/WORD/MEDIA/X.PNG")),
        Some("image/png")
    );

    let rels = pkg.relationships(&main).unwrap();
    assert_eq!(rels.len(), 2);
    assert_eq!(rels.get("rId9").unwrap().target_mode, TargetMode::External);
    assert_eq!(
        pkg.related_part(&main, IMAGE_REL).unwrap().as_str(),
        "/word/media/x.png"
    );
    assert_eq!(
        pkg.related_part(&main, LINK_REL),
        None,
        "external targets are not parts"
    );
    assert_eq!(pkg.package_relationships().unwrap().len(), 1);
    assert!(pkg.relationships(&pn("/word/media/x.png")).is_none());
}

#[test]
fn write_reopen_is_equivalent() {
    let original = fixture();
    let pkg = Package::open(Cursor::new(&original)).unwrap();
    let rewritten = write_to_vec(&pkg);
    assert_roundtrip_equivalent("fixture", &original, &rewritten);
}

#[test]
fn write_order_and_generated_xml() {
    let pkg = Package::open(Cursor::new(fixture())).unwrap();
    let bytes = write_to_vec(&pkg);
    let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
    let names: Vec<String> = (0..archive.len())
        .map(|i| {
            let f = archive.by_index(i).unwrap();
            assert_eq!(f.compression(), zip::CompressionMethod::Deflated);
            f.name().unwrap().into_owned()
        })
        .collect();
    assert_eq!(
        names,
        [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/media/x.png",
            "word/document.xml",
            "word/_rels/document.xml.rels",
        ]
    );
    let entries = zip_entries(&bytes);
    let ct = String::from_utf8(entries["[content_types].xml"].1.clone()).unwrap();
    assert!(ct.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n"));
    assert!(ct.contains(
        r#"<Override PartName="/word/document.xml" ContentType="application/x-test-main+xml"/>"#
    ));
    assert!(!ct.contains("x.png\""), "png is covered by its Default");
}

#[test]
fn write_is_deterministic() {
    let pkg = Package::open(Cursor::new(fixture())).unwrap();
    let a = write_to_vec(&pkg);
    let b = write_to_vec(&pkg);
    assert_eq!(a, b);
    let again = Package::open(Cursor::new(&a)).unwrap();
    assert_eq!(
        write_to_vec(&again),
        a,
        "rewrite of rewrite is a fixed point"
    );
}

#[test]
fn mutate_insert_remove() {
    let mut pkg = Package::open(Cursor::new(fixture())).unwrap();
    let main = pkg.main_document_part().unwrap();

    let new_img = pn("/word/media/y.gif");
    assert!(pkg
        .insert_part(new_img.clone(), "image/gif", b"GIF89a".to_vec())
        .is_none());
    let id = pkg
        .relationships_mut(&main)
        .unwrap()
        .add(IMAGE_REL, "media/y.gif")
        .id
        .clone();
    assert_eq!(id, "rId10");
    pkg.part_mut(&main).unwrap().data = b"<doc/>".to_vec();

    let reopened = Package::open(Cursor::new(write_to_vec(&pkg))).unwrap();
    assert_eq!(reopened.parts().last().unwrap().0, &new_img);
    assert_eq!(reopened.content_type_of(&new_img), Some("image/gif"));
    assert_eq!(reopened.part(&main).unwrap().data, b"<doc/>");
    assert_eq!(
        reopened
            .relationships(&main)
            .unwrap()
            .get("rId10")
            .unwrap()
            .target,
        "media/y.gif"
    );

    let mut pkg = reopened;
    assert!(pkg.remove_part(&main).is_some());
    assert!(pkg.relationships(&main).is_none());
    assert!(pkg.part(&main).is_none());
    let reopened = Package::open(Cursor::new(write_to_vec(&pkg))).unwrap();
    assert_eq!(reopened.parts().count(), 2);
}

#[test]
fn missing_content_types() {
    let bytes = build_zip(&[
        ("_rels/.rels", ROOT_RELS.as_bytes()),
        ("word/document.xml", DOC),
    ]);
    assert!(matches!(
        Package::open(Cursor::new(bytes)),
        Err(Error::MissingContentTypes)
    ));
}

#[test]
fn not_a_zip() {
    assert!(matches!(
        Package::open(Cursor::new(b"this is not a zip file at all".to_vec())),
        Err(Error::Zip(_))
    ));
}

#[test]
fn part_without_content_type() {
    let bytes = build_zip(&[
        ("[Content_Types].xml", CONTENT_TYPES.as_bytes()),
        ("word/thing.bin", b"x"),
    ]);
    match Package::open(Cursor::new(bytes)) {
        Err(Error::MissingContentType(name)) => assert_eq!(name.as_str(), "/word/thing.bin"),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn main_part_constant_matches() {
    let pkg = Package::open(Cursor::new(fixture())).unwrap();
    assert!(pkg
        .package_relationships()
        .unwrap()
        .first_by_type(OFFICE_DOCUMENT_REL)
        .is_some());
}

#[test]
fn write_path_and_open_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.docx");
    let pkg = Package::open(Cursor::new(fixture())).unwrap();
    pkg.write_path(&path).unwrap();
    let back = Package::open_path(&path).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), write_to_vec(&back));
}
