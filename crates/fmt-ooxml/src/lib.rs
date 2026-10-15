#![forbid(unsafe_code)]
//! OPC (Open Packaging Conventions) package reader/writer shared by the OOXML
//! format crates: ZIP container, `[Content_Types].xml`, relationships and a few
//! XML helpers.
//!
//! This crate has no knowledge of Word/Excel/PowerPoint vocabularies.
//!
//! ```no_run
//! use fmt_ooxml::Package;
//! let pkg = Package::open_path("in.docx")?;
//! let main = pkg.main_document_part().expect("main part");
//! println!("{main}: {:?}", pkg.content_type_of(&main));
//! pkg.write_path("out.docx")?;
//! # Ok::<(), fmt_ooxml::Error>(())
//! ```

pub mod content_types;
mod error;
mod package;
mod part_name;
pub mod relationships;
pub mod xml;

pub use content_types::{ContentTypes, DefaultEntry, OverrideEntry};
pub use error::{Error, Result};
pub use package::{Package, Part, OFFICE_DOCUMENT_REL, OFFICE_DOCUMENT_REL_STRICT};
pub use part_name::PartName;
pub use relationships::{Relationship, Relationships, TargetMode};
