#![forbid(unsafe_code)]
//! Reads and writes `.pptx` files, mapping to and from
//! [`model_show::Presentation`] (ADR 0008).
//!
//! The supported PresentationML/DrawingML subset (the slide master and its
//! layouts with placeholders, text styles, backgrounds and decorative
//! shapes; slides, placeholders incl. date/footer/slide number with
//! fields, auto shapes with preset or custom geometry, pictures with crop
//! and adjustments, groups, lines, connectors with arrowheads, tables,
//! DrawingML text, solid fills, outlines, backgrounds, the theme with its
//! format scheme, sections, slide transitions and preset animations) and
//! everything that is dropped are listed in `docs/ooxml-subset.md`.
//!
//! ```
//! use model_show::{LayoutKind, Presentation, TextParagraph};
//!
//! let mut p = Presentation::new();
//! p.slides[0].shapes[0].text_mut().unwrap().paragraphs = vec![TextParagraph::plain("Hello")];
//! p.add_slide(LayoutKind::Blank);
//!
//! let bytes = fmt_pptx::write(&p)?;
//! let back = fmt_pptx::read(&bytes)?;
//! assert_eq!(back.slides.len(), 2);
//! assert_eq!(back.slides[0].shapes[0].text().unwrap().plain_text(), "Hello");
//! # Ok::<(), fmt_pptx::Error>(())
//! ```
//!
//! [`read()`] / [`write()`] work on bytes and compile for `wasm32` (ADR 0005);
//! the `*_path` helpers exist on native targets only.

mod anim;
mod chart;
mod drawing;
mod geom;
mod link;
mod master;
mod media;
mod parts;
mod props;
mod read;
mod table;
mod tablestyle;
mod theme;
mod transition;
mod warn;
mod write;
mod xml;

use serde::{Deserialize, Serialize};

pub use read::{read, read_with_context, read_with_warnings, ReadOutput};
pub use warn::ReaderWarning;
pub(crate) use warn::Warnings;
pub use write::{write, write_thmx, write_with_context};

/// Design › Browse for Themes (P9-S5): reads the design of a theme file –
/// a `.thmx` (its theme and, when it has one, its master and layouts,
/// placed as they are on a `slide_size` slide) or a `.potx` / `.pptx`
/// (the whole file; its main master, layouts and theme are the design).
pub fn read_design_file(bytes: &[u8], slide_size: model_show::SlideSize) -> Result<ReadOutput> {
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes))?;
    let main = pkg
        .main_document_part()
        .ok_or_else(|| Error::MissingPart("officeDocument relationship".into()))?;
    let is_theme = pkg
        .part(&main)
        .is_some_and(|p| p.content_type.ends_with("theme+xml"));
    if is_theme {
        read::read_thmx(&pkg, &main, slide_size)
    } else {
        read_with_context(bytes)
    }
}

/// Result alias of this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong while reading or writing a `.pptx` file.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The OPC container (ZIP, content types, relationships) is broken.
    #[error(transparent)]
    Package(#[from] fmt_ooxml::Error),
    /// A PresentationML part is not well-formed XML.
    #[error("xml error in {part}: {source}")]
    Xml {
        /// The part name.
        part: String,
        /// The parser error.
        source: quick_xml::Error,
    },
    /// A required part is missing.
    #[error("missing part: {0}")]
    MissingPart(String),
    /// Well-formed XML that violates the schema in a way we cannot recover
    /// from (e.g. a `p:sld` without `p:cSld`).
    #[error("malformed {part}: {reason}")]
    Malformed {
        /// The part name.
        part: String,
        /// What is wrong.
        reason: String,
    },
    /// The presentation to write violates a model invariant (e.g. a
    /// picture whose media is missing from the store).
    #[error("invalid presentation: {0}")]
    InvalidPresentation(String),
    /// I/O error (only from the `*_path` helpers).
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

/// File-level data that has no slot in [`model_show::Presentation`] but
/// should survive a read → write cycle. Obtained from
/// [`read_with_context`], passed to [`write_with_context`];
/// [`PptxContext::default`] is what [`write()`] uses.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PptxContext {
    /// Raw `ppt/theme/theme1.xml` of the file that was read. It is written
    /// back verbatim as long as it still parses to the presentation's
    /// [`theme`](model_show::Presentation::theme) (keeping effects and
    /// details of the format scheme we do not model); otherwise the theme
    /// part is generated from the model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_xml: Option<Vec<u8>>,
    /// The current text of each `datetimeN` field (format number → text,
    /// e.g. `1` → `"10/17/2026"`; P9-S5): date fields are written showing
    /// it, as PowerPoint does. The core has no clock; the UI sends its
    /// own. Empty: fields keep their stored text.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub date_texts: std::collections::BTreeMap<u8, String>,
}

/// Reads a `.pptx` file from disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn read_path(path: impl AsRef<std::path::Path>) -> Result<model_show::Presentation> {
    read(&std::fs::read(path)?)
}

/// Writes `presentation` as a `.pptx` file to disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn write_path(
    presentation: &model_show::Presentation,
    path: impl AsRef<std::path::Path>,
) -> Result<()> {
    std::fs::write(path, write(presentation)?)?;
    Ok(())
}
