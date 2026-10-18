//! Pictures in sheets (`xdr:pic` in the sheet's drawing): an image with
//! an anchor, like a chart ([`ChartAnchor`]: two-cell anchors move and
//! resize with the cells, one-cell anchors move only), Format Picture ›
//! Properties (move and size with cells / move but don't size / don't
//! move or size: `twoCellAnchor/@editAs`), crop (`a:srcRect`), border
//! (`a:ln`), transparency (`a:alphaModFix`) and the z-order (the list
//! order, back to front).

use core_model::{Color, Media};
use engine_formula::{SheetId, StructuralOp};
use serde::{Deserialize, Serialize};

use crate::chart::{CellOffset, ChartAnchor};
use crate::workbook::Workbook;
use crate::Error;

/// How a picture follows row / column edits (Format Picture › Properties).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Placement {
    /// Move and size with cells (`editAs="twoCell"`, the two-cell default).
    #[default]
    MoveAndSize,
    /// Move but don't size with cells (`editAs="oneCell"`).
    Move,
    /// Don't move or size with cells (`editAs="absolute"`).
    Fixed,
}

/// Crop (Picture Format › Crop, `a:srcRect`): the parts cut off each side,
/// in thousandths of a percent of the image (`25000` = 25 %); negative
/// values add space.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Crop {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Crop {
    pub fn is_none(&self) -> bool {
        *self == Crop::default()
    }
}

/// Picture Border (`xdr:spPr/a:ln`): a solid line.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureLine {
    pub color: Color,
    /// Weight in EMU (12700 = 1 pt).
    pub width: i64,
}

/// EMU per CSS px at 96 dpi.
pub const EMU_PER_PX: i64 = 9525;

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
    /// How a two-cell anchor follows row / column edits (one-cell anchors
    /// always move, absolute ones stay; see [`Picture::placement`]).
    #[serde(default, skip_serializing_if = "is_default_placement")]
    pub edit_as: Placement,
    #[serde(default, skip_serializing_if = "Crop::is_none")]
    pub crop: Crop,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<PictureLine>,
    /// Picture Transparency, percent (0 = opaque).
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub transparency: u8,
}

fn is_default_placement(p: &Placement) -> bool {
    *p == Placement::MoveAndSize
}

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}

impl Picture {
    /// A picture of `media` at `anchor` with nothing else set.
    pub fn new(anchor: ChartAnchor, media: Media) -> Self {
        Picture {
            id: 0,
            name: String::new(),
            descr: String::new(),
            anchor,
            media,
            edit_as: Placement::MoveAndSize,
            crop: Crop::default(),
            line: None,
            transparency: 0,
        }
    }

    /// How the picture follows row / column edits.
    pub fn placement(&self) -> Placement {
        match self.anchor {
            ChartAnchor::TwoCell { .. } => self.edit_as,
            ChartAnchor::OneCell { .. } => Placement::Move,
            ChartAnchor::Absolute { .. } => Placement::Fixed,
        }
    }
}

/// Where to move a picture in the z-order (Bring Forward ▾ / Send Backward ▾).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZOrder {
    Front,
    Forward,
    Backward,
    Back,
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
    let c = p.crop;
    if [c.left, c.top, c.right, c.bottom]
        .iter()
        .any(|v| v.abs() > 1_000_000)
        || i64::from(c.left) + i64::from(c.right) >= 100_000
        || i64::from(c.top) + i64::from(c.bottom) >= 100_000
        || p.transparency > 100
        || p.line.is_some_and(|l| !(0..=20 * 12700).contains(&l.width))
    {
        return Err(Error::InvalidChart("invalid picture format".into()));
    }
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

    /// Moves picture `id` in the z-order of its sheet; `false` when it is
    /// already there (or unknown).
    pub fn reorder_picture(&mut self, sheet: SheetId, id: u32, to: ZOrder) -> Result<bool, Error> {
        let d = self.sheet_data_mut(sheet)?;
        let Some(i) = d.pictures.iter().position(|p| p.id == id) else {
            return Ok(false);
        };
        let last = d.pictures.len() - 1;
        let j = match to {
            ZOrder::Front => last,
            ZOrder::Back => 0,
            ZOrder::Forward => (i + 1).min(last),
            ZOrder::Backward => i.saturating_sub(1),
        };
        if i == j {
            return Ok(false);
        }
        let p = d.pictures.remove(i);
        d.pictures.insert(j, p);
        Ok(true)
    }

    /// The pictures' rectangles (px) before a row / column edit, for those
    /// that must keep their size or position ([`Placement::Move`] /
    /// [`Placement::Fixed`] two-cell anchors).
    pub(crate) fn picture_rects_before(&self, sheet: SheetId) -> Vec<Option<PxRect>> {
        self.sheet_data(sheet)
            .pictures
            .iter()
            .map(|p| match (p.anchor, p.edit_as) {
                (ChartAnchor::TwoCell { .. }, Placement::Move | Placement::Fixed) => {
                    Some(self.anchor_px(sheet, &p.anchor))
                }
                _ => None,
            })
            .collect()
    }

    /// Pictures follow row/column inserts and deletes like charts, except
    /// that "move but don't size" keeps the size and "don't move or size"
    /// the place (`before`: [`picture_rects_before`](Self::picture_rects_before)).
    pub(crate) fn shift_pictures(
        &mut self,
        sheet: SheetId,
        op: StructuralOp,
        before: &[Option<PxRect>],
    ) {
        let Ok(d) = self.sheet_data_mut(sheet) else {
            return;
        };
        let mut pending: Vec<(usize, Placement, PxRect, ChartAnchor)> = Vec::new();
        for (i, p) in d.pictures.iter_mut().enumerate() {
            let mut moved = p.anchor;
            moved.shift(op);
            match before.get(i).copied().flatten() {
                Some(rect) => pending.push((i, p.edit_as, rect, moved)),
                None => p.anchor = moved,
            }
        }
        for (i, placement, rect, moved) in pending {
            let anchor = match placement {
                // Keep the size: the top-left corner moves with its cell.
                Placement::Move => {
                    let at = match moved {
                        ChartAnchor::TwoCell { from, .. } => self.offset_px(sheet, &from),
                        _ => (rect.x, rect.y),
                    };
                    self.px_anchor(
                        sheet,
                        PxRect {
                            x: at.0,
                            y: at.1,
                            ..rect
                        },
                    )
                }
                // Keep the place on the sheet.
                _ => self.px_anchor(sheet, rect),
            };
            if let Ok(d) = self.sheet_data_mut(sheet) {
                if let Some(p) = d.pictures.get_mut(i) {
                    p.anchor = anchor;
                }
            }
        }
    }

    // --- sheet geometry in px (Excel's rounding at the default font) --------------------

    /// Width of column `col` in px (8.43 characters → 64 px; hidden → 0).
    pub fn col_px(&self, sheet: SheetId, col: u32) -> f64 {
        let info = self.col_info(sheet, col);
        if info.hidden {
            return 0.0;
        }
        let w = info
            .width
            .unwrap_or(self.sheet_format(sheet).default_col_width);
        if w <= 0.0 {
            0.0
        } else {
            (w * 7.0 + 5.0).round()
        }
    }

    /// Height of row `row` in px (15 pt → 20 px; hidden → 0).
    pub fn row_px(&self, sheet: SheetId, row: u32) -> f64 {
        let info = self.row_info(sheet, row);
        if info.hidden {
            return 0.0;
        }
        (info
            .height
            .unwrap_or(self.sheet_format(sheet).default_row_height)
            * 4.0
            / 3.0)
            .round()
    }

    fn col_start_px(&self, sheet: SheetId, col: u32) -> f64 {
        let default = (self.sheet_format(sheet).default_col_width * 7.0 + 5.0).round();
        let extra: f64 = self
            .cols(sheet)
            .take_while(|(c, _)| *c < col)
            .map(|(c, _)| self.col_px(sheet, c) - default)
            .sum();
        default * f64::from(col) + extra
    }

    fn row_start_px(&self, sheet: SheetId, row: u32) -> f64 {
        let default = (self.sheet_format(sheet).default_row_height * 4.0 / 3.0).round();
        let extra: f64 = self
            .rows(sheet)
            .take_while(|(r, _)| *r < row)
            .map(|(r, _)| self.row_px(sheet, r) - default)
            .sum();
        default * f64::from(row) + extra
    }

    fn offset_px(&self, sheet: SheetId, c: &CellOffset) -> (f64, f64) {
        (
            self.col_start_px(sheet, c.col) + c.col_offset as f64 / EMU_PER_PX as f64,
            self.row_start_px(sheet, c.row) + c.row_offset as f64 / EMU_PER_PX as f64,
        )
    }

    /// The rectangle of an anchor in sheet px.
    pub fn anchor_px(&self, sheet: SheetId, a: &ChartAnchor) -> PxRect {
        let emu = |v: i64| v as f64 / EMU_PER_PX as f64;
        match a {
            ChartAnchor::TwoCell { from, to } => {
                let (x0, y0) = self.offset_px(sheet, from);
                let (x1, y1) = self.offset_px(sheet, to);
                PxRect {
                    x: x0,
                    y: y0,
                    w: (x1 - x0).max(0.0),
                    h: (y1 - y0).max(0.0),
                }
            }
            ChartAnchor::OneCell {
                from,
                width,
                height,
            } => {
                let (x, y) = self.offset_px(sheet, from);
                PxRect {
                    x,
                    y,
                    w: emu(*width),
                    h: emu(*height),
                }
            }
            ChartAnchor::Absolute {
                x,
                y,
                width,
                height,
            } => PxRect {
                x: emu(*x),
                y: emu(*y),
                w: emu(*width),
                h: emu(*height),
            },
        }
    }

    /// A two-cell anchor for a px rectangle.
    pub fn px_anchor(&self, sheet: SheetId, r: PxRect) -> ChartAnchor {
        use engine_formula::ast::{MAX_COL, MAX_ROW};
        let locate = |pos: f64,
                      size: &dyn Fn(u32) -> f64,
                      start: &dyn Fn(u32) -> f64,
                      max: u32|
         -> CellOffset {
            let pos = pos.max(0.0);
            // A first guess from the default size, then walk.
            let mut i = 0u32;
            let mut at = 0.0;
            let guess = (pos / size(u32::MAX).max(1.0)).floor() as u32;
            if guess > 0 {
                i = guess.min(max);
                at = start(i);
                while i > 0 && at > pos {
                    i -= 1;
                    at -= size(i);
                }
            }
            while i < max && pos >= at + size(i) {
                at += size(i);
                i += 1;
            }
            CellOffset {
                col: i,
                row: 0,
                col_offset: ((pos - at).max(0.0) * EMU_PER_PX as f64).round() as i64,
                row_offset: 0,
            }
        };
        let default_col = (self.sheet_format(sheet).default_col_width * 7.0 + 5.0).round();
        let default_row = (self.sheet_format(sheet).default_row_height * 4.0 / 3.0).round();
        let col_size = |c: u32| {
            if c == u32::MAX {
                default_col
            } else {
                self.col_px(sheet, c)
            }
        };
        let row_size = |r: u32| {
            if r == u32::MAX {
                default_row
            } else {
                self.row_px(sheet, r)
            }
        };
        let col_start = |c: u32| self.col_start_px(sheet, c);
        let row_start = |r: u32| self.row_start_px(sheet, r);
        let cell = |x: f64, y: f64| {
            let c = locate(x, &col_size, &col_start, MAX_COL);
            let r = locate(y, &row_size, &row_start, MAX_ROW);
            CellOffset {
                col: c.col,
                row: r.col,
                col_offset: c.col_offset,
                row_offset: r.col_offset,
            }
        };
        ChartAnchor::TwoCell {
            from: cell(r.x, r.y),
            to: cell(r.x + r.w, r.y + r.h),
        }
    }
}

/// A rectangle in sheet px.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PxRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pic(edit_as: Placement) -> Picture {
        // C3:E8 (B2-based offsets 0).
        let anchor = ChartAnchor::TwoCell {
            from: CellOffset {
                col: 2,
                row: 2,
                col_offset: 0,
                row_offset: 0,
            },
            to: CellOffset {
                col: 5,
                row: 8,
                col_offset: 0,
                row_offset: 0,
            },
        };
        let mut p = Picture::new(
            anchor,
            Media {
                content_type: "image/png".into(),
                data: vec![1],
            },
        );
        p.edit_as = edit_as;
        p
    }

    fn rect_after_insert(edit_as: Placement, at: u32, count: u32) -> (PxRect, ChartAnchor) {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.add_picture(s, pic(edit_as)).unwrap();
        wb.insert_rows(s, at, count).unwrap();
        let a = wb.pictures(s)[0].anchor;
        (wb.anchor_px(s, &a), a)
    }

    #[test]
    fn placement_decides_how_pictures_follow_inserted_rows() {
        // Rows inserted above: all move down by 2 × 20 px except "don't move or size".
        let (r, _) = rect_after_insert(Placement::MoveAndSize, 0, 2);
        assert_eq!((r.y, r.h), (80.0, 120.0));
        let (r, _) = rect_after_insert(Placement::Move, 0, 2);
        assert_eq!((r.y, r.h), (80.0, 120.0));
        let (r, a) = rect_after_insert(Placement::Fixed, 0, 2);
        assert_eq!((r.x, r.y, r.w, r.h), (128.0, 40.0, 192.0, 120.0));
        assert!(matches!(a, ChartAnchor::TwoCell { from, .. } if from.row == 2));
        // Rows inserted inside: move and size grows; move keeps the size.
        let (r, _) = rect_after_insert(Placement::MoveAndSize, 4, 3);
        assert_eq!((r.y, r.h), (40.0, 180.0));
        let (r, _) = rect_after_insert(Placement::Move, 4, 3);
        assert_eq!((r.y, r.h), (40.0, 120.0));
        assert_eq!(pic(Placement::Fixed).placement(), Placement::Fixed);
    }

    #[test]
    fn z_order_and_format_checks() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        for _ in 0..3 {
            wb.add_picture(s, pic(Placement::MoveAndSize)).unwrap();
        }
        let ids = |wb: &Workbook| wb.pictures(s).iter().map(|p| p.id).collect::<Vec<_>>();
        assert_eq!(ids(&wb), vec![1, 2, 3]);
        assert!(wb.reorder_picture(s, 1, ZOrder::Front).unwrap());
        assert_eq!(ids(&wb), vec![2, 3, 1]);
        assert!(wb.reorder_picture(s, 1, ZOrder::Backward).unwrap());
        assert_eq!(ids(&wb), vec![2, 1, 3]);
        assert!(!wb.reorder_picture(s, 2, ZOrder::Back).unwrap());
        let mut bad = pic(Placement::Move);
        bad.crop = Crop {
            left: 60_000,
            right: 50_000,
            ..Crop::default()
        };
        assert!(wb.add_picture(s, bad).is_err());
        let mut bad = pic(Placement::Move);
        bad.transparency = 101;
        assert!(wb.add_picture(s, bad).is_err());
    }

    #[test]
    fn px_anchors_roundtrip_through_cells() {
        let wb = Workbook::new();
        let s = SheetId(0);
        let r = PxRect {
            x: 100.0,
            y: 45.0,
            w: 70.0,
            h: 30.0,
        };
        let a = wb.px_anchor(s, r);
        assert_eq!(
            a,
            ChartAnchor::TwoCell {
                from: CellOffset {
                    col: 1,
                    row: 2,
                    col_offset: 36 * EMU_PER_PX,
                    row_offset: 5 * EMU_PER_PX
                },
                to: CellOffset {
                    col: 2,
                    row: 3,
                    col_offset: 42 * EMU_PER_PX,
                    row_offset: 15 * EMU_PER_PX
                },
            }
        );
        assert_eq!(wb.anchor_px(s, &a), r);
    }
}
