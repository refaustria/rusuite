//! Roundtrip every reference file under `testdata/{docx,xlsx,pptx}`.

mod common;

use std::io::Cursor;
use std::path::PathBuf;

use common::assert_roundtrip_equivalent;
use fmt_ooxml::Package;

fn testdata_files() -> Vec<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata");
    let mut files = Vec::new();
    for ext in ["docx", "xlsx", "pptx"] {
        let Ok(dir) = std::fs::read_dir(root.join(ext)) else {
            continue;
        };
        for entry in dir.flatten() {
            let path = entry.path();
            let matches = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case(ext));
            if matches && path.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

#[test]
fn testdata_roundtrip() {
    let files = testdata_files();
    for path in &files {
        let label = path.display().to_string();
        let original = std::fs::read(path).unwrap();
        let pkg = Package::open(Cursor::new(&original)).unwrap_or_else(|e| panic!("{label}: {e}"));
        let rewritten = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
        assert_roundtrip_equivalent(&label, &original, &rewritten);
    }
    println!("testdata_roundtrip: processed {} file(s)", files.len());
}
