//! Length units used by the document models.
//!
//! - [`Twips`]: 1/20 of a point (WordprocessingML's `dxa`), used for
//!   paragraph and page layout.
//! - [`Emu`]: English Metric Units (DrawingML), used for image extents.
//!   1 inch = 914 400 EMU, 1 pt = 12 700 EMU, 1 twip = 635 EMU.
//! - [`Pt`]: typographic points as a float, for UI-facing values.
//!
//! All three serialize as plain numbers. Conversions from floats round to the
//! nearest integer unit (NaN maps to zero, out-of-range values saturate).

use serde::{Deserialize, Serialize};

/// EMU per inch.
pub const EMU_PER_INCH: i64 = 914_400;
/// EMU per centimeter.
pub const EMU_PER_CM: i64 = 360_000;
/// EMU per point.
pub const EMU_PER_PT: i64 = 12_700;
/// EMU per twip.
pub const EMU_PER_TWIP: i64 = 635;
/// EMU per CSS pixel at 96 dpi.
pub const EMU_PER_PX96: i64 = 9_525;
/// Twips per point.
pub const TWIPS_PER_PT: i32 = 20;
/// Twips per inch.
pub const TWIPS_PER_INCH: i32 = 1_440;

/// A length in twentieths of a point (1 inch = 1440 twips).
///
/// Serializes as the plain integer number of twips.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Twips(pub i32);

impl Twips {
    /// Zero.
    pub const ZERO: Twips = Twips(0);

    /// Converts points to twips, rounded to the nearest twip.
    pub fn from_pt(pt: f64) -> Self {
        Self((pt * f64::from(TWIPS_PER_PT)).round() as i32)
    }

    /// Converts inches to twips, rounded to the nearest twip.
    pub fn from_inch(inch: f64) -> Self {
        Self((inch * f64::from(TWIPS_PER_INCH)).round() as i32)
    }

    /// Converts centimeters to twips, rounded to the nearest twip.
    pub fn from_cm(cm: f64) -> Self {
        Self((cm / 2.54 * f64::from(TWIPS_PER_INCH)).round() as i32)
    }

    /// The length in points.
    pub fn to_pt(self) -> f64 {
        f64::from(self.0) / f64::from(TWIPS_PER_PT)
    }

    /// The length in CSS pixels at 96 dpi (1 px = 15 twips).
    pub fn to_px96(self) -> f64 {
        f64::from(self.0) / 15.0
    }

    /// The exact length in EMU.
    pub fn to_emu(self) -> Emu {
        Emu::from_twips(self)
    }
}

/// A length in English Metric Units (1 inch = 914 400 EMU).
///
/// Serializes as the plain integer number of EMU.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Emu(pub i64);

impl Emu {
    /// Zero.
    pub const ZERO: Emu = Emu(0);

    /// Converts twips to EMU (exact: 1 twip = 635 EMU).
    pub const fn from_twips(twips: Twips) -> Self {
        Self(twips.0 as i64 * EMU_PER_TWIP)
    }

    /// Converts points to EMU, rounded to the nearest EMU.
    pub fn from_pt(pt: f64) -> Self {
        Self((pt * EMU_PER_PT as f64).round() as i64)
    }

    /// Converts centimeters to EMU, rounded to the nearest EMU.
    pub fn from_cm(cm: f64) -> Self {
        Self((cm * EMU_PER_CM as f64).round() as i64)
    }

    /// Converts inches to EMU, rounded to the nearest EMU.
    pub fn from_inch(inch: f64) -> Self {
        Self((inch * EMU_PER_INCH as f64).round() as i64)
    }

    /// Converts CSS pixels at 96 dpi to EMU, rounded to the nearest EMU.
    pub fn from_px96(px: f64) -> Self {
        Self((px * EMU_PER_PX96 as f64).round() as i64)
    }

    /// The length in CSS pixels at 96 dpi (1 px = 9525 EMU).
    pub fn to_px96(self) -> f64 {
        self.0 as f64 / EMU_PER_PX96 as f64
    }

    /// The length in points.
    pub fn to_pt(self) -> f64 {
        self.0 as f64 / EMU_PER_PT as f64
    }

    /// The length in twips, rounded to the nearest twip.
    pub fn to_twips(self) -> Twips {
        Twips((self.0 as f64 / EMU_PER_TWIP as f64).round() as i32)
    }
}

/// A length in typographic points (1/72 inch), as a float.
///
/// Serializes as a plain JSON number.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Pt(pub f64);

impl Pt {
    /// The length in twips, rounded to the nearest twip.
    pub fn to_twips(self) -> Twips {
        Twips::from_pt(self.0)
    }

    /// The length in EMU, rounded to the nearest EMU.
    pub fn to_emu(self) -> Emu {
        Emu::from_pt(self.0)
    }
}

impl From<Twips> for Pt {
    fn from(t: Twips) -> Self {
        Pt(t.to_pt())
    }
}

impl From<Emu> for Pt {
    fn from(e: Emu) -> Self {
        Pt(e.to_pt())
    }
}

impl From<Twips> for Emu {
    fn from(t: Twips) -> Self {
        Emu::from_twips(t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_values() {
        assert_eq!(Twips::from_inch(1.0), Twips(1440));
        assert_eq!(Emu::from_inch(1.0), Emu(914_400));
        assert_eq!(Emu::from_twips(Twips(1440)), Emu(914_400));
        assert_eq!(Twips::from_pt(12.0), Twips(240));
        assert_eq!(Twips(240).to_pt(), 12.0);
        assert_eq!(Emu::from_pt(1.0), Emu(12_700));
        assert_eq!(Emu::from_pt(72.0), Emu::from_inch(1.0));
        assert_eq!(Emu::from_cm(1.0), Emu(360_000));
        assert_eq!(Emu::from_cm(2.54), Emu::from_inch(1.0));
        assert_eq!(Twips::from_cm(2.54), Twips(1440));
        assert_eq!(Emu::from_twips(Twips(1)), Emu(635));
        assert_eq!(Twips(1).to_emu(), Emu(635));
        assert_eq!(Emu::from(Twips(20)), Emu::from_pt(1.0));
    }

    #[test]
    fn pixels_at_96_dpi() {
        assert_eq!(Emu::from_inch(1.0).to_px96(), 96.0);
        assert_eq!(Emu(9525).to_px96(), 1.0);
        assert_eq!(Emu::from_px96(96.0), Emu(914_400));
        assert_eq!(Twips(1440).to_px96(), 96.0);
        assert_eq!(Twips(15).to_px96(), 1.0);
    }

    #[test]
    fn back_conversions_and_rounding() {
        assert_eq!(Emu(914_400).to_twips(), Twips(1440));
        assert_eq!(Emu(12_700).to_pt(), 1.0);
        assert_eq!(Emu(317).to_twips(), Twips(0));
        assert_eq!(Emu(318).to_twips(), Twips(1));
        assert_eq!(Twips::from_pt(10.53), Twips(211));
        assert_eq!(Twips::from_pt(-1.0), Twips(-20));
        assert_eq!(Twips::from_pt(f64::NAN), Twips(0));
        assert_eq!(Pt(12.0).to_twips(), Twips(240));
        assert_eq!(Pt(1.0).to_emu(), Emu(12_700));
        assert_eq!(Pt::from(Twips(30)), Pt(1.5));
        assert_eq!(Pt::from(Emu(6350)), Pt(0.5));
        assert!(Twips(1) < Twips(2));
    }

    #[test]
    fn serde_as_plain_numbers() {
        assert_eq!(serde_json::to_string(&Twips(240)).unwrap(), "240");
        assert_eq!(serde_json::to_string(&Emu(914_400)).unwrap(), "914400");
        assert_eq!(serde_json::to_string(&Pt(10.5)).unwrap(), "10.5");
        assert_eq!(serde_json::from_str::<Twips>("-15").unwrap(), Twips(-15));
        assert_eq!(serde_json::from_str::<Emu>("635").unwrap(), Emu(635));
        assert_eq!(serde_json::from_str::<Pt>("12").unwrap(), Pt(12.0));
    }
}
