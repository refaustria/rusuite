//! Font faces, font sizes and the theme [`FontScheme`].

use serde::{Deserialize, Serialize};

/// A font size, stored exactly in hundredths of a point.
///
/// This is lossless for Word half-points (×50), PowerPoint `sz` values
/// (already hundredths) and Excel's decimal point sizes (×100).
/// Serializes as the plain integer number of hundredths (e.g. 11 pt → `1100`).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct FontSize(u32);

impl FontSize {
    /// Creates a size from points, rounded to the nearest hundredth.
    /// Negative and NaN inputs yield zero.
    pub fn from_pt(pt: f64) -> Self {
        let h = (pt * 100.0).round();
        // `as` saturates for out-of-range floats and maps NaN to 0.
        Self(h.max(0.0) as u32)
    }

    /// Creates a size from half-points (Word's `w:sz`).
    pub const fn from_half_points(half_points: u32) -> Self {
        Self(half_points.saturating_mul(50))
    }

    /// Creates a size from hundredths of a point (PowerPoint's `sz`).
    pub const fn from_hundredths(hundredths: u32) -> Self {
        Self(hundredths)
    }

    /// The size in points.
    pub fn pt(self) -> f64 {
        f64::from(self.0) / 100.0
    }

    /// The size in half-points, rounded to nearest (halves round up).
    pub const fn half_points(self) -> u32 {
        (self.0 + 25) / 50
    }

    /// The size in hundredths of a point.
    pub const fn hundredths(self) -> u32 {
        self.0
    }
}

/// A font slot of the theme's font scheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeFontSlot {
    /// Major (heading) font, Latin script.
    MajorLatin,
    /// Minor (body) font, Latin script.
    MinorLatin,
    /// Major (heading) font, East Asian scripts.
    MajorEastAsian,
    /// Minor (body) font, East Asian scripts.
    MinorEastAsian,
    /// Major (heading) font, complex scripts.
    MajorComplexScript,
    /// Minor (body) font, complex scripts.
    MinorComplexScript,
}

/// The font face of a run: either a font family name or a theme font.
///
/// Serializes as `{"kind":"named","value":"Arial"}` or
/// `{"kind":"theme","value":"minorLatin"}`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum FontFace {
    /// An explicit font family name.
    Named(String),
    /// A reference to a font of the theme's font scheme.
    Theme(ThemeFontSlot),
}

impl FontFace {
    /// Resolves the face to a font family name using `scheme` for theme fonts.
    ///
    /// May return an empty string for east-asian/complex-script theme slots
    /// that the scheme leaves empty ("inherit").
    pub fn resolve<'a>(&'a self, scheme: &'a FontScheme) -> &'a str {
        match self {
            Self::Named(name) => name,
            Self::Theme(slot) => scheme.get(*slot),
        }
    }
}

impl From<&str> for FontFace {
    fn from(name: &str) -> Self {
        Self::Named(name.to_owned())
    }
}

/// The theme font scheme: major (headings) and minor (body) fonts per script.
///
/// Empty strings mean "not specified / inherit".
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontScheme {
    /// Scheme name, e.g. `"Office"`.
    pub name: String,
    /// Major Latin font.
    pub major_latin: String,
    /// Minor Latin font.
    pub minor_latin: String,
    /// Major East Asian font.
    pub major_east_asian: String,
    /// Minor East Asian font.
    pub minor_east_asian: String,
    /// Major complex-script font.
    pub major_complex_script: String,
    /// Minor complex-script font.
    pub minor_complex_script: String,
}

impl FontScheme {
    /// Returns the font family name for `slot`.
    pub fn get(&self, slot: ThemeFontSlot) -> &str {
        match slot {
            ThemeFontSlot::MajorLatin => &self.major_latin,
            ThemeFontSlot::MinorLatin => &self.minor_latin,
            ThemeFontSlot::MajorEastAsian => &self.major_east_asian,
            ThemeFontSlot::MinorEastAsian => &self.minor_east_asian,
            ThemeFontSlot::MajorComplexScript => &self.major_complex_script,
            ThemeFontSlot::MinorComplexScript => &self.minor_complex_script,
        }
    }
}

impl Default for FontScheme {
    /// The Office font scheme: Calibri Light / Calibri.
    fn default() -> Self {
        Self {
            name: "Office".to_owned(),
            major_latin: "Calibri Light".to_owned(),
            minor_latin: "Calibri".to_owned(),
            major_east_asian: String::new(),
            minor_east_asian: String::new(),
            major_complex_script: String::new(),
            minor_complex_script: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_size_conversions_are_exact() {
        let s = FontSize::from_pt(11.0);
        assert_eq!(s.hundredths(), 1100);
        assert_eq!(s.half_points(), 22);
        assert_eq!(s.pt(), 11.0);

        let s = FontSize::from_pt(10.5);
        assert_eq!(s.hundredths(), 1050);
        assert_eq!(s.half_points(), 21);
        assert_eq!(s.pt(), 10.5);

        let s = FontSize::from_half_points(21);
        assert_eq!(s, FontSize::from_pt(10.5));
        assert_eq!(s.hundredths(), 1050);
        assert_eq!(s.half_points(), 21);

        let s = FontSize::from_hundredths(1800);
        assert_eq!(s, FontSize::from_pt(18.0));
        assert_eq!(s.half_points(), 36);
        assert_eq!(s.pt(), 18.0);
    }

    #[test]
    fn font_size_rounding_and_edges() {
        assert_eq!(FontSize::from_pt(10.555).hundredths(), 1056);
        assert_eq!(FontSize::from_pt(-3.0).hundredths(), 0);
        assert_eq!(FontSize::from_pt(f64::NAN).hundredths(), 0);
        assert_eq!(FontSize::from_hundredths(1024).half_points(), 20);
        assert_eq!(FontSize::from_hundredths(1025).half_points(), 21);
        assert!(FontSize::from_pt(10.0) < FontSize::from_pt(10.5));
    }

    #[test]
    fn font_size_serde_is_integer() {
        let json = serde_json::to_string(&FontSize::from_pt(10.5)).unwrap();
        assert_eq!(json, "1050");
        let back: FontSize = serde_json::from_str("1800").unwrap();
        assert_eq!(back, FontSize::from_hundredths(1800));
    }

    #[test]
    fn font_face_resolve() {
        let scheme = FontScheme::default();
        assert_eq!(FontFace::from("Arial").resolve(&scheme), "Arial");
        assert_eq!(
            FontFace::Theme(ThemeFontSlot::MajorLatin).resolve(&scheme),
            "Calibri Light"
        );
        assert_eq!(
            FontFace::Theme(ThemeFontSlot::MinorLatin).resolve(&scheme),
            "Calibri"
        );
        assert_eq!(
            FontFace::Theme(ThemeFontSlot::MinorEastAsian).resolve(&scheme),
            ""
        );
    }
}
