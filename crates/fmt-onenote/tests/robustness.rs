//! Hostile input never panics: random bytes, truncations and byte mutations
//! of a real section give `Ok` or `Err`. A caught parser panic (native only;
//! on wasm it would abort) counts as a failure.

use std::path::PathBuf;

use fmt_onenote::{read_package, read_section, OneNoteError};
use proptest::prelude::*;

fn small_section() -> Option<Vec<u8>> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/onenote/notebook/New Section Group/New Section 1.one");
    std::fs::read(p).ok()
}

fn desktop_section() -> Option<Vec<u8>> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/onenote/onenote-2016/OneWithFileData.one");
    std::fs::read(p).ok()
}

fn no_caught_panic<T: std::fmt::Debug>(r: &Result<T, OneNoteError>) {
    if let Err(OneNoteError::Malformed(m)) = r {
        assert_ne!(m, "the parser failed on this file", "the parser panicked");
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    #[test]
    fn random_bytes(data in proptest::collection::vec(any::<u8>(), 0..2048)) {
        no_caught_panic(&read_section(&data, "r.one"));
        no_caught_panic(&read_package(&data, "r.onepkg"));
    }

    #[test]
    fn mutated_sections(
        which in 0usize..2,
        edits in proptest::collection::vec((any::<prop::sample::Index>(), any::<u8>()), 1..8),
        cut in any::<prop::sample::Index>(),
        truncate in any::<bool>(),
    ) {
        let Some(mut bytes) = (if which == 0 { small_section() } else { desktop_section() }) else {
            eprintln!("skipping: sample files missing");
            return Ok(());
        };
        // Keep the header so the parser (not the sniffer) sees the damage.
        for (at, b) in edits {
            let i = 80 + at.index(bytes.len() - 80);
            bytes[i] = b;
        }
        if truncate {
            bytes.truncate(cut.index(bytes.len()));
        }
        no_caught_panic(&read_section(&bytes, "m.one"));
    }
}
