//! Pictures in sheets (`xdr:pic` in the sheet's drawing): an image with
//! an anchor, like a chart ([`ChartAnchor`]: two-cell anchors move and
//! resize with the cells, one-cell anchors move only).

use core_model::Media;
use engine_formula::{SheetId, StructuralOp};
use serde::{Deserialize, Serialize};

use crate::chart::ChartAnchor;
use crate::workbook::Workbook;
use crate::Error;

/// A picture on a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    /// Unique per sheet, `>= 1` (0 when adding = assign one).
    pub id: u32,
    /// The drawing object name (`"Picture 1"`); empty = `"Picture <id>"`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// Alt text.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub descr: String,
    pub anchor: ChartAnchor,
    /// The image (PNG, JPEG, GIF, BMP, SVG…).
    pub media: Media,
}

/// The image types a picture may have.
pub const PICTURE_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "image/svg+xml",
    "image/webp",
];

/// The file extension of an image content type.
pub fn picture_extension(content_type: &str) -> &'static str {
    match content_type {
        "image/jpeg" => "jpeg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn check(p: &Picture) -> Result<(), Error> {
    p.anchor.check()?;
    if !PICTURE_TYPES.contains(&p.media.content_type.as_str()) || p.media.data.is_empty() {
        return Err(Error::InvalidChart(format!(
            "unsupported picture type {:?}",
            p.media.content_type
        )));
    }
    Ok(())
}

impl Workbook {
    /// The pictures of `sheet`, back to front.
    pub fn pictures(&self, sheet: SheetId) -> &[Picture] {
        &self.sheet_data(sheet).pictures
    }

    /// Replaces the pictures of `sheet` (loading, undo); ids 0 get fresh
    /// ones, empty names `Picture <id>`.
    pub fn set_pictures(&mut self, sheet: SheetId, pictures: Vec<Picture>) -> Result<(), Error> {
        let mut pictures = pictures;
        let mut seen = std::collections::HashSet::new();
        for p in &pictures {
            check(p)?;
            if p.id != 0 && !seen.insert(p.id) {
                return Err(Error::InvalidChart(format!(
                    "duplicate picture id {}",
                    p.id
                )));
            }
        }
        let mut next = seen.iter().max().copied().unwrap_or(0);
        for p in &mut pictures {
            if p.id == 0 {
                next += 1;
                p.id = next;
            }
            if p.name.is_empty() {
                p.name = format!("Picture {}", p.id);
            }
        }
        self.sheet_data_mut(sheet)?.pictures = pictures;
        Ok(())
    }

    /// Adds a picture in front (id 0 = fresh); returns its id.
    pub fn add_picture(&mut self, sheet: SheetId, picture: Picture) -> Result<u32, Error> {
        check(&picture)?;
        let data = self.sheet_data_mut(sheet)?;
        let mut picture = picture;
        if picture.id == 0 || data.pictures.iter().any(|p| p.id == picture.id) {
            picture.id = data.pictures.iter().map(|p| p.id).max().unwrap_or(0) + 1;
        }
        if picture.name.is_empty() {
            picture.name = format!("Picture {}", picture.id);
        }
        let id = picture.id;
        data.pictures.push(picture);
        Ok(id)
    }

    /// Pictures follow row/column inserts and deletes like charts.
    pub(crate) fn shift_pictures(&mut self, sheet: SheetId, op: StructuralOp) {
        if let Ok(d) = self.sheet_data_mut(sheet) {
            for p in &mut d.pictures {
                p.anchor.shift(op);
            }
        }
    }
}
