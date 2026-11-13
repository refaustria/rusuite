#![forbid(unsafe_code)]
//! Reads OneNote 2010+ section files (`.one`) and notebook packages
//! (`.onepkg`, a CAB archive) into a plain, serde-serialisable intermediate
//! tree ([`OneSection`], [`OneNotebook`]) for the Notes app's importer.
//!
//! Parsing of the file format (MS-ONESTORE, MS-ONE, MS-FSSHTTPB) is done by
//! the `onenote_parser` crate (MPL-2.0, used unmodified from crates.io; see
//! `docs/legal-notes.md`); this crate maps its object model onto ours and
//! turns what it cannot carry over into [`ImportWarning`]s. The supported
//! subset is listed in `docs/onenote-subset.md`.
//!
//! Both entry points work on bytes and compile for `wasm32-unknown-unknown`
//! (the import also runs in the browser). Unsupported inputs (OneNote 2007,
//! password-protected sections, other files) are an [`OneNoteError`], never a
//! panic.

mod convert;
mod detect;
mod map;
mod model;
mod package;
mod warn;

pub use model::{
    Block, Imported, InkStroke, ListInfo, NotebookItem, NumberFormat, OneNotebook, OnePage,
    OneSection, PageItem, Rect, Rgb, Run, Tag, TagKind,
};
pub use warn::ImportWarning;

use detect::Sniff;
use warn::Warnings;

/// Why a file could not be imported at all.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OneNoteError {
    /// The bytes are not a OneNote file of the expected kind.
    #[error("not a OneNote {expected} file")]
    NotOneNote {
        /// `section (.one)` or `package (.onepkg)`.
        expected: &'static str,
    },
    /// A section was given where a package was expected.
    #[error("this is a OneNote section (.one), not a notebook package (.onepkg)")]
    SectionNotPackage,
    /// A notebook table of contents (`.onetoc2`) or a package was given where
    /// a section was expected.
    #[error("this is a OneNote notebook ({found}), not a section (.one)")]
    NotASection {
        /// What was found instead.
        found: &'static str,
    },
    /// The file is in the OneNote 2007 (or older) format.
    #[error("OneNote 2007 files are not supported: open the section in OneNote 2010 or later and save it again")]
    Legacy2007,
    /// The section is password-protected (encrypted).
    #[error(
        "password-protected sections cannot be imported: remove the password in OneNote first"
    )]
    PasswordProtected,
    /// The package has no notebook (`.onetoc2`) or is not a valid cabinet.
    #[error("the package contains no readable notebook: {0}")]
    BadPackage(String),
    /// The file is damaged or uses something the parser does not understand.
    #[error("the OneNote file could not be read: {0}")]
    Malformed(String),
}

/// Reads a section file (`.one`). `file_name` is the fallback section name
/// (OneNote normally stores the display name in the file).
pub fn read_section(bytes: &[u8], file_name: &str) -> Result<Imported<OneSection>, OneNoteError> {
    match detect::sniff(bytes) {
        Sniff::Desktop { toc: false, .. } | Sniff::Package => {}
        Sniff::Desktop { toc: true, .. } => {
            return Err(OneNoteError::NotASection { found: ".onetoc2" })
        }
        Sniff::LegacyOneNote => return Err(OneNoteError::Legacy2007),
        Sniff::Cab => return Err(OneNoteError::NotASection { found: ".onepkg" }),
        Sniff::Other => {
            return Err(OneNoteError::NotOneNote {
                expected: "section (.one)",
            })
        }
    }
    let name = base_name(file_name);
    let section = guard(|| package::parse_section(bytes, name))?
        .map_err(|e| classify(&e.to_string(), bytes))?;
    let mut w = Warnings::default();
    let value = convert::section(&section, &mut w);
    Ok(Imported {
        value,
        warnings: w.into_warnings(),
    })
}

/// Reads a notebook package (`.onepkg`). `file_name` gives the notebook's
/// name, which the package itself does not store.
pub fn read_package(bytes: &[u8], file_name: &str) -> Result<Imported<OneNotebook>, OneNoteError> {
    match detect::sniff(bytes) {
        Sniff::Cab => {}
        Sniff::Desktop { toc: false, .. } | Sniff::Package => {
            return Err(OneNoteError::SectionNotPackage)
        }
        Sniff::LegacyOneNote => return Err(OneNoteError::Legacy2007),
        Sniff::Desktop { toc: true, .. } | Sniff::Other => {
            return Err(OneNoteError::NotOneNote {
                expected: "package (.onepkg)",
            })
        }
    }
    let notebook = guard(|| package::parse_package(bytes))?.map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Malformed OneNote package") || msg.contains("Not a table of contents") {
            OneNoteError::BadPackage(msg)
        } else {
            classify(&msg, bytes)
        }
    })?;
    let mut w = Warnings::default();
    let base = base_name(file_name);
    let stem = base
        .rsplit_once('.')
        .map_or(base, |(stem, _)| stem)
        .to_owned();
    let value = convert::notebook(&notebook, stem, &mut w);
    Ok(Imported {
        value,
        warnings: w.into_warnings(),
    })
}

/// The last component of a path in either `/` or `\` form.
fn base_name(file_name: &str) -> &str {
    file_name.rsplit(['/', '\\']).next().unwrap_or(file_name)
}

/// Maps a parser error to ours: encrypted objects mean a password-protected
/// section; a failing desktop file written by pre-2010 code is OneNote 2007.
fn classify(msg: &str, bytes: &[u8]) -> OneNoteError {
    if msg.contains("encrypted") {
        return OneNoteError::PasswordProtected;
    }
    if msg.starts_with("Not a section file") {
        return OneNoteError::NotASection { found: ".onetoc2" };
    }
    if let Sniff::Desktop { toc: false, ffv } = detect::sniff(bytes) {
        if ffv < 0x2A {
            return OneNoteError::Legacy2007;
        }
    }
    OneNoteError::Malformed(msg.to_owned())
}

/// Runs the parser. On native targets a panic inside it (a parser bug on
/// hostile input) becomes [`OneNoteError::Malformed`] instead of taking the
/// app down; on wasm panics abort, which the robustness tests guard against.
fn guard<T>(f: impl FnOnce() -> T) -> Result<T, OneNoteError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
            .map_err(|_| OneNoteError::Malformed("the parser failed on this file".to_owned()))
    }
    #[cfg(target_arch = "wasm32")]
    {
        Ok(f())
    }
}
