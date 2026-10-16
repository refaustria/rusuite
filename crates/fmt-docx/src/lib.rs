#![forbid(unsafe_code)]
//! Reads and writes `.docx` files, mapping to and from
//! [`model_text::Document`].
//!
//! The supported WordprocessingML subset (paragraphs, runs, lists, tables,
//! inline images, styles, numbering, page setup) and everything that is
//! dropped are listed in `docs/ooxml-subset.md`.
//!
//! ```
//! use model_text::{Block, Document, Paragraph};
//!
//! let mut doc = Document::new();
//! let id = doc.alloc_id();
//! doc.body = vec![Block::Paragraph(Paragraph::with_text(id, "Hello"))];
//!
//! let bytes = fmt_docx::write(&doc)?;
//! let back = fmt_docx::read(&bytes)?;
//! assert_eq!(back.plain_text(), "Hello");
//! assert_eq!(back.styles, doc.styles);
//! # Ok::<(), fmt_docx::Error>(())
//! ```
//!
//! [`read()`] / [`write()`] work on bytes and compile for `wasm32` (ADR 0005);
//! the `*_path` helpers exist on native targets only.

mod drawing;
mod numbering;
mod props;
mod read;
mod sections;
mod styles;
mod toc;
mod write;
mod xml;

use core_model::Theme;
use serde::{Deserialize, Serialize};

pub use props::{
    highlight_name, highlight_rgb, nearest_highlight, theme_shade_to_tint, theme_tint_to_tint,
    tint_to_theme_attr, HIGHLIGHT_COLORS,
};
pub use read::{read, read_with_context, read_with_warnings, ReadOutput};
pub use write::{write, write_with_context};

/// Result alias of this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong while reading or writing a `.docx` file.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The OPC container (ZIP, content types, relationships) is broken.
    #[error(transparent)]
    Package(#[from] fmt_ooxml::Error),
    /// A WordprocessingML part is not well-formed XML.
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
    /// from (e.g. a `w:document` without `w:body`).
    #[error("malformed {part}: {reason}")]
    Malformed {
        /// The part name.
        part: String,
        /// What is wrong.
        reason: String,
    },
    /// The document to write violates a model invariant (e.g. an image
    /// whose media is missing from the store).
    #[error("invalid document: {0}")]
    InvalidDocument(String),
    /// I/O error (only from the `*_path` helpers).
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

/// One `w:num` of the file that was read and how it was defined: which
/// `w:abstractNum` it used and which levels had a `w:startOverride`.
///
/// Informational: the model keeps this itself
/// ([`model_text::NumberingDef::abstract_id`] and `overrides`), and the
/// writer uses the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumInstance {
    /// `w:numId`.
    pub num_id: u32,
    /// `w:abstractNumId` it referenced.
    pub abstract_id: u32,
    /// Levels (`w:ilvl`) that had a `w:startOverride`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub start_overrides: Vec<u8>,
}

/// File-level data that has no slot in [`model_text::Document`] but should
/// survive a read → write cycle. Obtained from [`read_with_context`], passed
/// to [`write_with_context`]; [`DocxContext::default`] is what [`write()`]
/// uses.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxContext {
    /// Raw `word/theme/theme1.xml`, written back verbatim. `None` = the
    /// built-in Office theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_xml: Option<Vec<u8>>,
    /// The parsed theme (colors and fonts), used to resolve theme fonts and
    /// the `w:val` fallback of theme colors. `None` = the Office theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    /// Raw `word/settings.xml`, written back verbatim. `None` = a minimal
    /// settings part (compatibility mode 15).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings_xml: Option<Vec<u8>>,
    /// How the nums of the file shared abstract definitions
    /// (informational, see [`NumInstance`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub numbering: Vec<NumInstance>,
    /// Ids of the separator and continuation-separator footnotes as listed
    /// in the settings part (`w:footnotePr/w:footnote`); the writer reuses
    /// them so the kept settings stay consistent. `None` = `-1` and `0`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footnote_separators: Option<(i32, i32)>,
    /// Like [`footnote_separators`](Self::footnote_separators) for
    /// endnotes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endnote_separators: Option<(i32, i32)>,
}

impl DocxContext {
    /// The theme in effect (the context's or the Office default).
    pub fn theme_or_default(&self) -> std::borrow::Cow<'_, Theme> {
        match &self.theme {
            Some(t) => std::borrow::Cow::Borrowed(t),
            None => std::borrow::Cow::Owned(Theme::default()),
        }
    }
}

/// Reads a `.docx` file from disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn read_path(path: impl AsRef<std::path::Path>) -> Result<model_text::Document> {
    read(&std::fs::read(path)?)
}

/// Writes `doc` as a `.docx` file to disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn write_path(doc: &model_text::Document, path: impl AsRef<std::path::Path>) -> Result<()> {
    std::fs::write(path, write(doc)?)?;
    Ok(())
}

/// A note of the reader about content that was dropped or approximated:
/// a stable `code` (the UI translates it, docs/ui.md "Write pre-release fixes"), its
/// parameters and the English `text` (the fallback). Repeats are merged
/// (`count`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderWarning {
    /// Stable identifier, e.g. `docx.numbering.levelStyleLink`.
    pub code: String,
    /// Values of the `{name}` placeholders of the message.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub params: std::collections::BTreeMap<String, String>,
    /// The English message (without the count).
    pub text: String,
    /// How often it occurred.
    pub count: usize,
}

impl ReaderWarning {
    /// The English line: the text, with ` (Nx)` for repeats.
    pub fn line(&self) -> String {
        match self.count {
            0 | 1 => self.text.clone(),
            n => format!("{} ({n}x)", self.text),
        }
    }
}

/// Collects warnings, merging repeats into one entry with a count.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    order: Vec<ReaderWarning>,
    index: std::collections::HashMap<String, usize>,
}

impl Warnings {
    /// Adds the warning `code`: `template` with its `{name}` placeholders
    /// replaced by `params` is the English text.
    pub(crate) fn warn(
        &mut self,
        code: &'static str,
        template: &'static str,
        params: &[(&'static str, &dyn std::fmt::Display)],
    ) {
        let mut text = template.to_owned();
        let mut map = std::collections::BTreeMap::new();
        for (k, v) in params {
            let v = v.to_string();
            text = text.replace(&format!("{{{k}}}"), &v);
            map.insert((*k).to_owned(), v);
        }
        match self.index.get(&text) {
            Some(&i) => self.order[i].count += 1,
            None => {
                self.index.insert(text.clone(), self.order.len());
                self.order.push(ReaderWarning {
                    code: code.to_owned(),
                    params: map,
                    text,
                    count: 1,
                });
            }
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// The English lines (see [`ReaderWarning::line`]).
    pub(crate) fn lines(&self) -> Vec<String> {
        self.order.iter().map(ReaderWarning::line).collect()
    }

    /// [`lines`](Self::lines), consuming.
    #[cfg(test)]
    pub(crate) fn into_vec(self) -> Vec<String> {
        self.lines()
    }

    /// The warnings with their codes.
    pub(crate) fn into_warnings(self) -> Vec<ReaderWarning> {
        self.order
    }
}

#[cfg(test)]
mod warning_tests {
    use super::*;

    #[test]
    fn coded_warnings_merge_repeats_and_fill_placeholders() {
        let mut w = Warnings::default();
        w.warn(
            "docx.run.propertyDropped",
            "{ctx}: run property {name} dropped",
            &[("ctx", &"styles"), ("name", &"w:foo")],
        );
        w.warn(
            "docx.run.propertyDropped",
            "{ctx}: run property {name} dropped",
            &[("ctx", &"styles"), ("name", &"w:foo")],
        );
        w.warn("docx.content.equations", "equations dropped", &[]);
        assert_eq!(
            w.lines(),
            vec![
                "styles: run property w:foo dropped (2x)".to_owned(),
                "equations dropped".to_owned()
            ]
        );
        let d = w.into_warnings();
        assert_eq!(d[0].code, "docx.run.propertyDropped");
        assert_eq!(d[0].count, 2);
        assert_eq!(d[0].params["name"], "w:foo");
        assert_eq!(d[0].params["ctx"], "styles");
        assert_eq!(d[1].params.len(), 0);
        let json = serde_json::to_value(&d[1]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"code": "docx.content.equations", "text": "equations dropped", "count": 1})
        );
    }

    /// Every `w.warn` call site: the code is `docx.*` and unique per
    /// template, and every `{placeholder}` of the template gets a
    /// parameter (the UI catalog keys are `reader.<code>`).
    #[test]
    fn warning_sites_are_consistent() {
        let src: String = [
            "lib.rs",
            "numbering.rs",
            "props.rs",
            "read.rs",
            "sections.rs",
            "styles.rs",
        ]
        .iter()
        .map(|f| {
            std::fs::read_to_string(format!("{}/src/{f}", env!("CARGO_MANIFEST_DIR"))).unwrap()
        })
        .collect();
        let catalog: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(format!(
                "{}/../../packages/ui-shared/src/i18n/locales/en.json",
                env!("CARGO_MANIFEST_DIR")
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            catalog["reader.docx.field.flattened"].as_str(),
            Some(read::FLATTENED)
        );
        let mut seen = std::collections::HashMap::new();
        let mut n = 0;
        for part in src.split(".warn(").skip(1) {
            let mut strs = part.split('"');
            let code = strs.nth(1).unwrap();
            if code == "code" || !code.starts_with("docx.") {
                continue;
            }
            n += 1;
            let after = &part[part.find(code).unwrap() + code.len() + 1..];
            if !after
                .trim_start()
                .trim_start_matches(',')
                .trim_start()
                .starts_with('"')
            {
                continue; // a constant (FLATTENED)
            }
            let rest = strs.collect::<Vec<_>>().join("\"");
            let template = rest.split('"').nth(1).unwrap_or("");
            if template.is_empty() {
                continue; // a constant (FLATTENED)
            }
            let prev = seen.insert(code.to_owned(), template.to_owned());
            // The UI's English catalog has the same text under `reader.<code>`.
            assert_eq!(
                catalog[format!("reader.{code}")].as_str(),
                Some(template),
                "{code}: packages/ui-shared/src/i18n/locales/en.json"
            );
            assert!(
                prev.is_none() || prev.as_deref() == Some(template),
                "{code}: two templates"
            );
            for ph in template.split('{').skip(1) {
                let name = ph.split('}').next().unwrap();
                assert!(
                    part.contains(&format!("(\"{name}\"")),
                    "{code}: no parameter {name}"
                );
            }
        }
        assert!(n >= 75, "{n} sites");
    }
}
