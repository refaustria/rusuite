#![forbid(unsafe_code)]
//! Reads and writes `.pptx` files, mapping to and from
//! [`model_show::Presentation`] (ADR 0008).
//!
//! The supported PresentationML/DrawingML subset (slides, placeholders,
//! auto shapes, pictures, groups, lines, DrawingML text, solid fills,
//! outlines, backgrounds, the theme) and everything that is dropped are
//! listed in `docs/ooxml-subset.md`. Masters and layouts are not imported:
//! slides are mapped onto the three built-in layouts and written with fixed
//! master/layout parts.
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

mod drawing;
mod parts;
mod read;
mod write;
mod xml;

use serde::{Deserialize, Serialize};

pub use read::{read, read_with_context, read_with_warnings, ReadOutput};
pub use write::{write, write_with_context};

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
    /// [`theme`](model_show::Presentation::theme) (keeping effect and fill
    /// styles we do not model); otherwise the theme part is generated from
    /// the model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_xml: Option<Vec<u8>>,
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

/// Collects warnings, merging repeats into one line with a count.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    order: Vec<String>,
    counts: std::collections::HashMap<String, usize>,
}

impl Warnings {
    pub(crate) fn add(&mut self, msg: impl Into<String>) {
        let msg = msg.into();
        let n = self.counts.entry(msg.clone()).or_insert(0);
        if *n == 0 {
            self.order.push(msg);
        }
        *n += 1;
    }

    pub(crate) fn into_vec(self) -> Vec<String> {
        self.order
            .into_iter()
            .map(|m| match self.counts[&m] {
                1 => m,
                n => format!("{m} ({n}x)"),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warnings_merge_repeats() {
        let mut w = Warnings::default();
        w.add("a");
        w.add("b");
        w.add("a");
        assert_eq!(w.into_vec(), ["a (2x)", "b"]);
    }
}
