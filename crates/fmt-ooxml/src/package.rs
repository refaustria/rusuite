//! The in-memory OPC package.

use std::collections::{BTreeMap, HashSet};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::content_types::{ContentTypes, DefaultEntry, CONTENT_TYPES_ENTRY};
use crate::error::{Error, Result};
use crate::part_name::{resolve_from, RelsSource};
use crate::relationships::{Relationships, TargetMode};
use crate::PartName;

/// Relationship type of the package's main document part (transitional OOXML).
pub const OFFICE_DOCUMENT_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
/// Relationship type of the main document part in strict OOXML.
pub const OFFICE_DOCUMENT_REL_STRICT: &str =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument";

const PACKAGE_RELS_ENTRY: &str = "_rels/.rels";

/// A part's content type and raw bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Part {
    /// MIME content type from `[Content_Types].xml`.
    pub content_type: String,
    /// Raw part bytes.
    pub data: Vec<u8>,
}

/// A fully loaded OPC package (`.docx`, `.xlsx`, `.pptx`, …).
///
/// `[Content_Types].xml` and all `.rels` parts are not exposed as parts: content
/// types live on each [`Part`], relationships in a sidecar keyed by source part.
/// Both are regenerated on [`write`](Self::write); every other part is written
/// back byte-for-byte.
#[derive(Debug, Clone, Default)]
pub struct Package {
    parts: Vec<(PartName, Part)>,
    defaults: Vec<DefaultEntry>,
    package_rels: Option<Relationships>,
    rels: BTreeMap<PartName, Relationships>,
}

impl Package {
    /// An empty package.
    pub fn new() -> Self {
        Self::default()
    }

    /// Reads a package from a ZIP stream, loading every part into memory.
    pub fn open(reader: impl Read + Seek) -> Result<Self> {
        let mut archive = ZipArchive::new(reader)?;
        let mut content_types = None;
        let mut entries = Vec::with_capacity(archive.len());
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            if file.is_dir() {
                continue;
            }
            let name = file.name()?.into_owned();
            let mut data = Vec::with_capacity(usize::try_from(file.size()).unwrap_or(0));
            file.read_to_end(&mut data)?;
            if name.eq_ignore_ascii_case(CONTENT_TYPES_ENTRY) {
                content_types = Some(ContentTypes::parse(&data)?);
            } else {
                entries.push((name, data));
            }
        }
        let content_types = content_types.ok_or(Error::MissingContentTypes)?;

        let mut pkg = Package {
            defaults: content_types.defaults.clone(),
            ..Self::default()
        };
        let mut seen = HashSet::with_capacity(entries.len());
        for (name, data) in entries {
            let part_name = PartName::new(format!("/{}", name.trim_start_matches('/')))?;
            if !seen.insert(part_name.clone()) {
                return Err(Error::DuplicatePart(part_name));
            }
            match part_name.rels_source() {
                Some(RelsSource::Package) => {
                    pkg.package_rels = Some(Relationships::parse(&data, part_name.as_str())?);
                }
                Some(RelsSource::Part(source)) => {
                    let rels = Relationships::parse(&data, part_name.as_str())?;
                    pkg.rels.insert(source, rels);
                }
                None => {
                    let content_type = content_types
                        .get(&part_name)
                        .ok_or_else(|| Error::MissingContentType(part_name.clone()))?
                        .to_owned();
                    pkg.parts.push((part_name, Part { content_type, data }));
                }
            }
        }
        Ok(pkg)
    }

    /// Opens a package file from disk.
    pub fn open_path(path: impl AsRef<Path>) -> Result<Self> {
        Self::open(BufReader::new(File::open(path)?))
    }

    /// Writes the package as a ZIP stream.
    ///
    /// Order: `[Content_Types].xml`, `_rels/.rels`, then each part in original
    /// order directly followed by its `.rels`; relationships whose source part no
    /// longer exists come last. All entries are Deflate-compressed with a fixed
    /// timestamp, so writing the same package twice yields identical bytes.
    pub fn write<W: Write + Seek>(&self, writer: W) -> Result<W> {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::DEFAULT)
            .unix_permissions(0o644);
        let mut zip = ZipWriter::new(writer);

        let put = |zip: &mut ZipWriter<W>, name: &str, data: &[u8]| -> Result<()> {
            zip.start_file(name, options)?;
            zip.write_all(data)?;
            Ok(())
        };

        put(
            &mut zip,
            CONTENT_TYPES_ENTRY,
            &self.content_types().to_xml(),
        )?;
        if let Some(rels) = &self.package_rels {
            put(&mut zip, PACKAGE_RELS_ENTRY, &rels.to_xml())?;
        }
        for (name, part) in &self.parts {
            put(&mut zip, name.zip_entry_name(), &part.data)?;
            if let Some(rels) = self.rels.get(name) {
                put(
                    &mut zip,
                    name.rels_part_name().zip_entry_name(),
                    &rels.to_xml(),
                )?;
            }
        }
        for (source, rels) in &self.rels {
            if self.part(source).is_none() {
                put(
                    &mut zip,
                    source.rels_part_name().zip_entry_name(),
                    &rels.to_xml(),
                )?;
            }
        }
        Ok(zip.finish()?)
    }

    /// Writes the package to a file on disk.
    pub fn write_path(&self, path: impl AsRef<Path>) -> Result<()> {
        let writer = self.write(BufWriter::new(File::create(path)?))?;
        writer.into_inner().map_err(|e| e.into_error())?;
        Ok(())
    }

    /// The content types table that [`write`](Self::write) would emit.
    pub fn content_types(&self) -> ContentTypes {
        ContentTypes::regenerate(
            &self.defaults,
            self.parts.iter().map(|(n, p)| (n, p.content_type.as_str())),
        )
    }

    /// All parts in stable original order (inserted parts at the end).
    pub fn parts(&self) -> impl Iterator<Item = (&PartName, &Part)> {
        self.parts.iter().map(|(n, p)| (n, p))
    }

    /// Looks up a part.
    pub fn part(&self, name: &PartName) -> Option<&Part> {
        self.parts.iter().find(|(n, _)| n == name).map(|(_, p)| p)
    }

    /// Looks up a part mutably.
    pub fn part_mut(&mut self, name: &PartName) -> Option<&mut Part> {
        self.parts
            .iter_mut()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p)
    }

    /// Inserts a part at the end of the order, or replaces an existing part in
    /// place (returning the old one).
    pub fn insert_part(
        &mut self,
        name: PartName,
        content_type: impl Into<String>,
        data: Vec<u8>,
    ) -> Option<Part> {
        let part = Part {
            content_type: content_type.into(),
            data,
        };
        match self.part_mut(&name) {
            Some(existing) => Some(std::mem::replace(existing, part)),
            None => {
                self.parts.push((name, part));
                None
            }
        }
    }

    /// Removes a part and its relationships. Relationships pointing *to* it are left alone.
    pub fn remove_part(&mut self, name: &PartName) -> Option<Part> {
        let idx = self.parts.iter().position(|(n, _)| n == name)?;
        self.rels.remove(name);
        Some(self.parts.remove(idx).1)
    }

    /// The content type of a part.
    pub fn content_type_of(&self, name: &PartName) -> Option<&str> {
        self.part(name).map(|p| p.content_type.as_str())
    }

    /// The relationships whose source is `source`.
    pub fn relationships(&self, source: &PartName) -> Option<&Relationships> {
        self.rels.get(source)
    }

    /// Mutable access to the relationships whose source is `source`.
    pub fn relationships_mut(&mut self, source: &PartName) -> Option<&mut Relationships> {
        self.rels.get_mut(source)
    }

    /// Replaces (or creates) the relationships of `source`, returning the previous set.
    pub fn set_relationships(
        &mut self,
        source: PartName,
        rels: Relationships,
    ) -> Option<Relationships> {
        self.rels.insert(source, rels)
    }

    /// Relationships of the package itself (`/_rels/.rels`).
    pub fn package_relationships(&self) -> Option<&Relationships> {
        self.package_rels.as_ref()
    }

    /// Mutable package relationships, created empty if absent.
    pub fn package_relationships_mut(&mut self) -> &mut Relationships {
        self.package_rels.get_or_insert_with(Relationships::new)
    }

    /// The main document part: target of the package-level `officeDocument` relationship.
    pub fn main_document_part(&self) -> Option<PartName> {
        let rels = self.package_rels.as_ref()?;
        [OFFICE_DOCUMENT_REL, OFFICE_DOCUMENT_REL_STRICT]
            .iter()
            .find_map(|t| {
                rels.by_type(t)
                    .find(|r| r.target_mode == TargetMode::Internal)
            })
            .and_then(|r| resolve_from("/", &r.target).ok())
    }

    /// The part targeted by the first internal relationship of `rel_type` from `source`.
    pub fn related_part(&self, source: &PartName, rel_type: &str) -> Option<PartName> {
        self.rels
            .get(source)?
            .by_type(rel_type)
            .find(|r| r.target_mode == TargetMode::Internal)
            .and_then(|r| source.resolve(&r.target).ok())
    }
}
