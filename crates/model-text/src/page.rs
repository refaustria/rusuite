//! Page size and margins (docx `w:sectPr`, single section).

use core_model::units::Twips;
use serde::{Deserialize, Serialize};

/// Page orientation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum Orientation {
    /// Taller than wide.
    Portrait,
    /// Wider than tall.
    Landscape,
}

/// Page margins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Margins {
    /// Top margin.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub top: Twips,
    /// Right margin.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub right: Twips,
    /// Bottom margin.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub bottom: Twips,
    /// Left margin.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub left: Twips,
    /// Distance from the page top to the header.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub header: Twips,
    /// Distance from the page bottom to the footer.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub footer: Twips,
}

impl Default for Margins {
    /// Word's defaults: 1 inch on all sides, header/footer at 708 twips.
    fn default() -> Self {
        Self {
            top: Twips(1440),
            right: Twips(1440),
            bottom: Twips(1440),
            left: Twips(1440),
            header: Twips(708),
            footer: Twips(708),
        }
    }
}

/// Page setup. `width`/`height` are the actual page dimensions (already
/// swapped for landscape).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct PageSetup {
    /// Page width.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub width: Twips,
    /// Page height.
    #[cfg_attr(feature = "ts", ts(as = "i32"))]
    pub height: Twips,
    /// Margins.
    pub margins: Margins,
    /// Orientation.
    pub orientation: Orientation,
}

impl PageSetup {
    /// A4 portrait (210 × 297 mm = 11906 × 16838 twips), Word's margins.
    pub fn a4() -> Self {
        Self {
            width: Twips(11906),
            height: Twips(16838),
            margins: Margins::default(),
            orientation: Orientation::Portrait,
        }
    }

    /// US Letter portrait (8.5 × 11 in = 12240 × 15840 twips), Word's margins.
    pub fn letter() -> Self {
        Self {
            width: Twips(12240),
            height: Twips(15840),
            margins: Margins::default(),
            orientation: Orientation::Portrait,
        }
    }

    /// The same page turned to `orientation` (swaps width and height if it
    /// changes).
    #[must_use]
    pub fn with_orientation(mut self, orientation: Orientation) -> Self {
        if orientation != self.orientation {
            std::mem::swap(&mut self.width, &mut self.height);
            self.orientation = orientation;
        }
        self
    }

    /// Width available for text (page width minus left and right margins).
    pub fn content_width(&self) -> Twips {
        Twips(self.width.0 - self.margins.left.0 - self.margins.right.0)
    }
}

impl Default for PageSetup {
    fn default() -> Self {
        Self::a4()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets() {
        let a4 = PageSetup::a4();
        assert_eq!(a4.content_width(), Twips(9026));
        assert_eq!(a4.margins.header, Twips(708));
        let l = PageSetup::letter().with_orientation(Orientation::Landscape);
        assert_eq!((l.width, l.height), (Twips(15840), Twips(12240)));
        assert_eq!(l.with_orientation(Orientation::Landscape), l);
        assert_eq!(
            l.with_orientation(Orientation::Portrait),
            PageSetup::letter()
        );
    }
}
