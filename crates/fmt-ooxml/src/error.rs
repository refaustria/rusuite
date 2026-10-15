//! Error type for OPC package handling.

use crate::PartName;

/// Result alias used throughout this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong while reading or writing an OPC package.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The container is not a readable ZIP archive (or writing the ZIP failed).
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),

    /// An XML part managed by this crate (`[Content_Types].xml`, `*.rels`) is not well-formed.
    #[error("xml error in {part}: {source}")]
    Xml {
        /// ZIP entry or part name of the offending XML.
        part: String,
        /// Underlying parser error.
        source: quick_xml::Error,
    },

    /// A string is not a valid OPC part name.
    #[error("invalid part name {name:?}: {reason}")]
    InvalidPartName {
        /// The rejected input.
        name: String,
        /// Which rule was violated.
        reason: &'static str,
    },

    /// The ZIP archive has no `[Content_Types].xml` entry.
    #[error("package has no [Content_Types].xml")]
    MissingContentTypes,

    /// A part has neither a matching `Default` nor an `Override` content type.
    #[error("no content type for part {0}")]
    MissingContentType(PartName),

    /// Two ZIP entries map to the same (case-insensitive) part name.
    #[error("duplicate part {0}")]
    DuplicatePart(PartName),

    /// Structurally valid XML that violates the OPC schema (e.g. a missing required attribute).
    #[error("malformed {part}: {reason}")]
    Malformed {
        /// ZIP entry or part name of the offending XML.
        part: String,
        /// What is wrong.
        reason: String,
    },

    /// I/O error while reading or writing.
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}
