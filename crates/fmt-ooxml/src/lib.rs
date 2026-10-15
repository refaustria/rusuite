#![forbid(unsafe_code)]
//! OPC (Open Packaging Conventions) package reader/writer shared by the OOXML
//! format crates: ZIP container, `[Content_Types].xml`, relationships, the
//! well-known relationship/content types ([`rel`], [`ct`]), XML helpers
//! (a small DOM and element writer, [`xml`]) and the DrawingML theme part
//! ([`theme`]) that Excel, Word and PowerPoint files share.
//!
//! Word/Excel/PowerPoint *content* vocabularies stay in the format crates.
//!
//! ```no_run
//! use fmt_ooxml::Package;
//! let pkg = Package::open_path("in.docx")?;
//! let main = pkg.main_document_part().expect("main part");
//! println!("{main}: {:?}", pkg.content_type_of(&main));
//! pkg.write_path("out.docx")?;
//! # Ok::<(), fmt_ooxml::Error>(())
//! ```

pub mod chart;
pub mod content_types;
mod error;
mod package;
mod part_name;
pub mod relationships;
pub mod theme;
mod types;
pub mod xml;

pub use content_types::{ContentTypes, DefaultEntry, OverrideEntry};
pub use error::{Error, Result};
pub use package::{Package, Part, OFFICE_DOCUMENT_REL, OFFICE_DOCUMENT_REL_STRICT};
pub use part_name::PartName;
pub use relationships::{Relationship, Relationships, TargetMode};
pub use types::{ct, rel};
