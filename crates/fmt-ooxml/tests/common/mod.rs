//! Helpers shared by the integration tests.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use fmt_ooxml::{Package, PartName};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

/// Builds a ZIP from `(entry name, bytes)` pairs using the `zip` crate directly.
pub fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// Reads every file entry of a ZIP, keyed by lower-cased entry name.
pub fn zip_entries(bytes: &[u8]) -> BTreeMap<String, (String, Vec<u8>)> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = BTreeMap::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).unwrap();
        if f.is_dir() {
            continue;
        }
        let name = f.name().unwrap().trim_start_matches('/').to_owned();
        let mut data = Vec::new();
        f.read_to_end(&mut data).unwrap();
        out.insert(name.to_ascii_lowercase(), (name, data));
    }
    out
}

/// `true` for entries this crate regenerates instead of copying.
pub fn is_generated(entry: &str) -> bool {
    entry.eq_ignore_ascii_case("[Content_Types].xml")
        || entry.to_ascii_lowercase().ends_with(".rels")
}

/// Source part of every part-level `.rels` entry (`dir/_rels/file.rels` -> `/dir/file`).
pub fn rel_sources(entries: &BTreeMap<String, (String, Vec<u8>)>) -> Vec<PartName> {
    entries
        .values()
        .filter_map(|(name, _)| {
            let (dir, file) = name.rsplit_once('/')?;
            let stem = file.strip_suffix(".rels").filter(|s| !s.is_empty())?;
            let src_dir = dir.strip_suffix("_rels")?;
            PartName::new(format!("/{src_dir}{stem}")).ok()
        })
        .collect()
}

/// Asserts that `rewritten` is an equivalent rewrite of the package in `original`.
pub fn assert_roundtrip_equivalent(label: &str, original: &[u8], rewritten: &[u8]) {
    let a = Package::open(Cursor::new(original))
        .unwrap_or_else(|e| panic!("{label}: open original: {e}"));
    let b =
        Package::open(Cursor::new(rewritten)).unwrap_or_else(|e| panic!("{label}: reopen: {e}"));

    // Same parts, same order, same content types, same bytes.
    let pa: Vec<_> = a.parts().collect();
    let pb: Vec<_> = b.parts().collect();
    assert_eq!(pa.len(), pb.len(), "{label}: part count");
    for ((na, xa), (nb, xb)) in pa.iter().zip(&pb) {
        assert_eq!(na.as_str(), nb.as_str(), "{label}: part order/name");
        assert_eq!(
            xa.content_type, xb.content_type,
            "{label}: content type of {na}"
        );
        assert!(xa.data == xb.data, "{label}: bytes of {na} differ");
    }

    // Raw ZIP level: same entry set, non-generated entries byte-identical.
    let ea = zip_entries(original);
    let eb = zip_entries(rewritten);
    assert_eq!(
        ea.keys().collect::<Vec<_>>(),
        eb.keys().collect::<Vec<_>>(),
        "{label}: zip entry set"
    );
    for (key, (name, data)) in &ea {
        if !is_generated(name) {
            assert!(
                &eb[key].1 == data,
                "{label}: entry {name} not byte-identical"
            );
        }
    }

    // Relationships: same set per source.
    assert_eq!(
        a.package_relationships(),
        b.package_relationships(),
        "{label}: package relationships"
    );
    for source in rel_sources(&ea) {
        assert_eq!(
            a.relationships(&source),
            b.relationships(&source),
            "{label}: relationships of {source}"
        );
        assert!(
            a.relationships(&source).is_some(),
            "{label}: rels of {source} not loaded"
        );
    }
}
