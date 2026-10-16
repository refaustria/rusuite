#![forbid(unsafe_code)]
//! Reads and writes `.xlsx` files, mapping to and from
//! [`model_sheet::Workbook`].
//!
//! The supported subset (values, formulas, cell styles, column/row
//! dimensions, sheet defaults, sheet views with frozen panes, hidden
//! sheets, merged cells, AutoFilter, conditional formatting, data
//! validation, charts) and everything that is dropped are listed in
//! `docs/ooxml-subset.md`.
//!
//! ```
//! use engine_formula::{CellCoord, Value};
//!
//! let mut wb = model_sheet::Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! wb.set_input(CellCoord::new(s, 0, 0), "21").unwrap();
//! wb.set_input(CellCoord::new(s, 0, 1), "=A1*2").unwrap();
//!
//! let bytes = fmt_xlsx::write(&wb)?;
//! let back = fmt_xlsx::read(&bytes)?;
//! assert_eq!(back.value(CellCoord::new(s, 0, 1)), Value::Number(42.0));
//! assert_eq!(back.to_snapshot(), wb.to_snapshot());
//! # Ok::<(), fmt_xlsx::Error>(())
//! ```
//!
//! [`read()`] / [`write()`] work on bytes and compile for `wasm32` (ADR 0005);
//! the `*_path` helpers exist on native targets only.

pub mod a1;
mod condfmt;
mod drawing;
mod dynarray;
mod read;
mod styles;
mod theme;
mod write;
mod xlfn;
mod xml;

use core_model::{ColorScheme, RunProperties};
use serde::{Deserialize, Serialize};

pub use read::{read, read_with_context, read_with_warnings, ReadOutput};
pub use write::{write, write_with_context};
pub use xlfn::{add_xlfn_prefixes, strip_xlfn_prefixes, XLFN_FUNCTIONS, XLWS_FUNCTIONS};

/// Result alias of this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong while reading or writing an `.xlsx` file.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The OPC container (ZIP, content types, relationships) is broken.
    #[error(transparent)]
    Package(#[from] fmt_ooxml::Error),
    /// A SpreadsheetML part is not well-formed XML.
    #[error("xml error in {part}: {source}")]
    Xml {
        part: String,
        source: quick_xml::Error,
    },
    /// A required part is missing.
    #[error("missing part: {0}")]
    MissingPart(String),
    /// Well-formed XML that violates the SpreadsheetML schema in a way we
    /// cannot recover from.
    #[error("malformed {part}: {reason}")]
    Malformed { part: String, reason: String },
    /// A feature we deliberately do not support (e.g. `date1904`).
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// The workbook model rejected the loaded data (e.g. duplicate sheet names).
    #[error(transparent)]
    Model(#[from] model_sheet::Error),
    /// I/O error (only from the `*_path` helpers).
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

/// File-level data that has no slot in [`model_sheet::Workbook`] but should survive a
/// read → write cycle. Obtained from [`read_with_context`], passed to
/// [`write_with_context`]; [`XlsxContext::default`] is what [`write()`] uses.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxContext {
    /// Raw `xl/theme/theme1.xml`, written back verbatim. `None` = the
    /// built-in Office theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_xml: Option<Vec<u8>>,
    /// The theme's color scheme (informational: theme colors stay
    /// [`core_model::Color::Theme`] in the model).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<ColorScheme>,
    /// The workbook default font (font 0 of `styles.xml`, fully specified).
    /// Cell-style fonts are stored as differences from it. `None` =
    /// Calibri 11.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_font: Option<RunProperties>,
}

/// Reads an `.xlsx` file from disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn read_path(path: impl AsRef<std::path::Path>) -> Result<model_sheet::Workbook> {
    read(&std::fs::read(path)?)
}

/// Writes `wb` as an `.xlsx` file to disk (native targets only).
#[cfg(not(target_arch = "wasm32"))]
pub fn write_path(wb: &model_sheet::Workbook, path: impl AsRef<std::path::Path>) -> Result<()> {
    std::fs::write(path, write(wb)?)?;
    Ok(())
}
