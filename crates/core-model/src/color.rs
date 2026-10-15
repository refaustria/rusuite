//! Colors: plain RGB, theme-based colors with tint/shade, and the automatic
//! color, plus the theme [`ColorScheme`].

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

/// Error returned when parsing an [`Rgb`] from a hex string fails.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ColorParseError {
    /// The input (without a leading `#`) is not 6 (`RRGGBB`) or 8 (`AARRGGBB`) digits long.
    #[error("invalid hex color length {len} in {input:?}: expected 6 or 8 hex digits")]
    InvalidLength {
        /// The rejected input.
        input: String,
        /// Number of bytes after stripping a leading `#`.
        len: usize,
    },
    /// The input contains a character that is not a hexadecimal digit.
    #[error("invalid character in hex color {input:?}")]
    InvalidCharacter {
        /// The rejected input.
        input: String,
    },
}

/// An opaque 24-bit sRGB color.
///
/// Serializes as an uppercase 6-digit hex string such as `"FF0000"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Rgb {
    /// Red channel.
    pub r: u8,
    /// Green channel.
    pub g: u8,
    /// Blue channel.
    pub b: u8,
}

impl Rgb {
    /// Black (`000000`).
    pub const BLACK: Rgb = Rgb::new(0, 0, 0);
    /// White (`FFFFFF`).
    pub const WHITE: Rgb = Rgb::new(0xFF, 0xFF, 0xFF);

    /// Creates a color from its channels.
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Parses a hex color.
    ///
    /// Accepts `RRGGBB` and `AARRGGBB` (alpha is ignored), case-insensitive,
    /// optionally prefixed with `#`.
    pub fn from_hex(input: &str) -> Result<Self, ColorParseError> {
        let hex = input.strip_prefix('#').unwrap_or(input);
        if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(ColorParseError::InvalidCharacter {
                input: input.to_owned(),
            });
        }
        let rgb = match hex.len() {
            6 => hex,
            8 => &hex[2..],
            len => {
                return Err(ColorParseError::InvalidLength {
                    input: input.to_owned(),
                    len,
                })
            }
        };
        // All bytes are ASCII hex digits, so slicing and parsing cannot fail.
        let channel = |i: usize| u8::from_str_radix(&rgb[i..i + 2], 16).unwrap_or(0);
        Ok(Self::new(channel(0), channel(2), channel(4)))
    }

    /// Formats the color as an uppercase 6-digit hex string, e.g. `"FF0000"`.
    pub fn to_hex(&self) -> String {
        format!("{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }
}

impl fmt::Display for Rgb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }
}

impl std::str::FromStr for Rgb {
    type Err = ColorParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_hex(s)
    }
}

impl Serialize for Rgb {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Rgb {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Rgb::from_hex(&s).map_err(serde::de::Error::custom)
    }
}

/// One of the 12 color slots of a theme color scheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeColorSlot {
    /// Dark 1 (`dk1`, mapped as `tx1` – usually the main text color).
    Dark1,
    /// Light 1 (`lt1`, mapped as `bg1` – usually the background color).
    Light1,
    /// Dark 2 (`dk2`, mapped as `tx2`).
    Dark2,
    /// Light 2 (`lt2`, mapped as `bg2`).
    Light2,
    /// Accent 1.
    Accent1,
    /// Accent 2.
    Accent2,
    /// Accent 3.
    Accent3,
    /// Accent 4.
    Accent4,
    /// Accent 5.
    Accent5,
    /// Accent 6.
    Accent6,
    /// Hyperlink (`hlink`).
    Hyperlink,
    /// Followed hyperlink (`folHlink`).
    FollowedHyperlink,
}

impl ThemeColorSlot {
    /// All slots in scheme order (the order used by [`ColorScheme::colors`]).
    pub const ALL: [ThemeColorSlot; 12] = [
        Self::Dark1,
        Self::Light1,
        Self::Dark2,
        Self::Light2,
        Self::Accent1,
        Self::Accent2,
        Self::Accent3,
        Self::Accent4,
        Self::Accent5,
        Self::Accent6,
        Self::Hyperlink,
        Self::FollowedHyperlink,
    ];

    /// Index of this slot in [`ThemeColorSlot::ALL`] and [`ColorScheme::colors`].
    pub const fn index(self) -> usize {
        self as usize
    }

    /// Parses an OOXML color-scheme name.
    ///
    /// Accepts the scheme names (`dk1`, `lt1`, `dk2`, `lt2`, `accent1`..`accent6`,
    /// `hlink`, `folHlink`) and the mapped names used by Word and Excel
    /// (`tx1`, `bg1`, `tx2`, `bg2`). Matching is case-sensitive, as in OOXML.
    pub fn from_ooxml_name(name: &str) -> Option<Self> {
        Some(match name {
            "dk1" | "tx1" => Self::Dark1,
            "lt1" | "bg1" => Self::Light1,
            "dk2" | "tx2" => Self::Dark2,
            "lt2" | "bg2" => Self::Light2,
            "accent1" => Self::Accent1,
            "accent2" => Self::Accent2,
            "accent3" => Self::Accent3,
            "accent4" => Self::Accent4,
            "accent5" => Self::Accent5,
            "accent6" => Self::Accent6,
            "hlink" => Self::Hyperlink,
            "folHlink" => Self::FollowedHyperlink,
            _ => return None,
        })
    }

    /// The OOXML color-scheme element name (`dk1`, `lt1`, …, `folHlink`).
    pub const fn ooxml_scheme_name(self) -> &'static str {
        match self {
            Self::Dark1 => "dk1",
            Self::Light1 => "lt1",
            Self::Dark2 => "dk2",
            Self::Light2 => "lt2",
            Self::Accent1 => "accent1",
            Self::Accent2 => "accent2",
            Self::Accent3 => "accent3",
            Self::Accent4 => "accent4",
            Self::Accent5 => "accent5",
            Self::Accent6 => "accent6",
            Self::Hyperlink => "hlink",
            Self::FollowedHyperlink => "folHlink",
        }
    }
}

/// A color as specified in a document.
///
/// Serializes as a discriminated union with `kind` and `value` fields, e.g.
/// `{"kind":"rgb","value":"FF0000"}`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Color {
    /// The automatic color; its concrete value depends on context
    /// (usually black text / white background).
    Auto,
    /// An explicit RGB color.
    Rgb(Rgb),
    /// A theme color, optionally lightened or darkened.
    #[serde(rename_all = "camelCase")]
    Theme {
        /// The theme color slot.
        slot: ThemeColorSlot,
        /// Tint in `-1.0..=1.0`: negative darkens (shade), positive
        /// lightens, `0.0` leaves the color unchanged. See [`apply_tint`].
        tint: f64,
    },
}

impl Color {
    /// A theme color without tint.
    pub const fn theme(slot: ThemeColorSlot) -> Self {
        Self::Theme { slot, tint: 0.0 }
    }

    /// Resolves this color to a concrete RGB value using `scheme` for theme
    /// colors and `auto` for [`Color::Auto`].
    pub fn resolve(&self, scheme: &ColorScheme, auto: Rgb) -> Rgb {
        match *self {
            Self::Auto => auto,
            Self::Rgb(rgb) => rgb,
            Self::Theme { slot, tint } => apply_tint(scheme.get(slot), tint),
        }
    }
}

impl From<Rgb> for Color {
    fn from(rgb: Rgb) -> Self {
        Self::Rgb(rgb)
    }
}

/// Applies an Excel/ECMA-376 tint to a color.
///
/// The color is converted to HLS (lightness in `0..=1`); for `tint < 0` the
/// lightness becomes `L * (1 + tint)`, for `tint > 0` it becomes
/// `L * (1 - tint) + tint`. Hue and saturation are kept. `tint` is clamped to
/// `-1.0..=1.0`; `0.0` and NaN return the color unchanged.
pub fn apply_tint(color: Rgb, tint: f64) -> Rgb {
    if tint == 0.0 || tint.is_nan() {
        return color;
    }
    let tint = tint.clamp(-1.0, 1.0);
    let (h, l, s) = rgb_to_hls(color);
    let l = if tint < 0.0 {
        l * (1.0 + tint)
    } else {
        l * (1.0 - tint) + tint
    };
    hls_to_rgb(h, l.clamp(0.0, 1.0), s)
}

/// RGB → HLS with all components in `0..=1` (same as Python's `colorsys`).
fn rgb_to_hls(c: Rgb) -> (f64, f64, f64) {
    let r = f64::from(c.r) / 255.0;
    let g = f64::from(c.g) / 255.0;
    let b = f64::from(c.b) / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, l, 0.0);
    }
    let d = max - min;
    let s = if l <= 0.5 {
        d / (max + min)
    } else {
        d / (2.0 - max - min)
    };
    let rc = (max - r) / d;
    let gc = (max - g) / d;
    let bc = (max - b) / d;
    let h = if r == max {
        bc - gc
    } else if g == max {
        2.0 + rc - bc
    } else {
        4.0 + gc - rc
    };
    ((h / 6.0).rem_euclid(1.0), l, s)
}

/// HLS → RGB, inverse of [`rgb_to_hls`], rounding each channel to nearest.
fn hls_to_rgb(h: f64, l: f64, s: f64) -> Rgb {
    let to_u8 = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
    if s == 0.0 {
        let v = to_u8(l);
        return Rgb::new(v, v, v);
    }
    let m2 = if l <= 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let m1 = 2.0 * l - m2;
    let v = |hue: f64| {
        let hue = hue.rem_euclid(1.0);
        if hue < 1.0 / 6.0 {
            m1 + (m2 - m1) * hue * 6.0
        } else if hue < 0.5 {
            m2
        } else if hue < 2.0 / 3.0 {
            m1 + (m2 - m1) * (2.0 / 3.0 - hue) * 6.0
        } else {
            m1
        }
    };
    Rgb::new(
        to_u8(v(h + 1.0 / 3.0)),
        to_u8(v(h)),
        to_u8(v(h - 1.0 / 3.0)),
    )
}

/// A theme color scheme: one RGB value per [`ThemeColorSlot`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorScheme {
    /// Scheme name, e.g. `"Office"`.
    pub name: String,
    /// Colors indexed by [`ThemeColorSlot::index`], in [`ThemeColorSlot::ALL`] order.
    pub colors: [Rgb; 12],
}

impl ColorScheme {
    /// Returns the color of `slot`.
    pub fn get(&self, slot: ThemeColorSlot) -> Rgb {
        self.colors[slot.index()]
    }

    /// Sets the color of `slot`.
    pub fn set(&mut self, slot: ThemeColorSlot, color: Rgb) {
        self.colors[slot.index()] = color;
    }
}

impl Default for ColorScheme {
    /// The Office theme colors (Office 2013–2022).
    fn default() -> Self {
        Self {
            name: "Office".to_owned(),
            colors: [
                Rgb::new(0x00, 0x00, 0x00), // dk1
                Rgb::new(0xFF, 0xFF, 0xFF), // lt1
                Rgb::new(0x44, 0x54, 0x6A), // dk2
                Rgb::new(0xE7, 0xE6, 0xE6), // lt2
                Rgb::new(0x44, 0x72, 0xC4), // accent1
                Rgb::new(0xED, 0x7D, 0x31), // accent2
                Rgb::new(0xA5, 0xA5, 0xA5), // accent3
                Rgb::new(0xFF, 0xC0, 0x00), // accent4
                Rgb::new(0x5B, 0x9B, 0xD5), // accent5
                Rgb::new(0x70, 0xAD, 0x47), // accent6
                Rgb::new(0x05, 0x63, 0xC1), // hlink
                Rgb::new(0x95, 0x4F, 0x72), // folHlink
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Rgb {
        Rgb::from_hex(s).unwrap()
    }

    #[test]
    fn parse_accepted_forms() {
        let red = Rgb::new(0xFF, 0, 0);
        assert_eq!(hex("FF0000"), red);
        assert_eq!(hex("#FF0000"), red);
        assert_eq!(hex("ff0000"), red);
        assert_eq!(hex("#fF0000"), red);
        assert_eq!(hex("80FF0000"), red);
        assert_eq!(hex("#00ff0000"), red);
        assert_eq!(hex("0563c1"), Rgb::new(0x05, 0x63, 0xC1));
        assert_eq!("123456".parse::<Rgb>().unwrap(), Rgb::new(0x12, 0x34, 0x56));
    }

    #[test]
    fn parse_rejects_bad_input() {
        for bad in [
            "",
            "#",
            "F00",
            "FF000",
            "FF00000",
            "FF0000000",
            "##FF0000",
            " FF0000",
        ] {
            assert!(Rgb::from_hex(bad).is_err(), "{bad:?} should be rejected");
        }
        assert!(matches!(
            Rgb::from_hex("FF00"),
            Err(ColorParseError::InvalidLength { len: 4, .. })
        ));
        assert!(matches!(
            Rgb::from_hex("GG0000"),
            Err(ColorParseError::InvalidCharacter { .. })
        ));
        assert!(matches!(
            Rgb::from_hex("FF00é0"),
            Err(ColorParseError::InvalidCharacter { .. })
        ));
        assert!(matches!(
            Rgb::from_hex("+F0000"),
            Err(ColorParseError::InvalidCharacter { .. })
        ));
    }

    #[test]
    fn format_hex() {
        assert_eq!(Rgb::new(0xAB, 0x0C, 0x01).to_hex(), "AB0C01");
        assert_eq!(Rgb::new(0xAB, 0x0C, 0x01).to_string(), "AB0C01");
        assert_eq!(Rgb::BLACK.to_hex(), "000000");
        assert_eq!(hex("#abcdef").to_hex(), "ABCDEF");
    }

    #[test]
    fn rgb_serde_is_hex_string() {
        let json = serde_json::to_string(&Rgb::new(0xFF, 0x80, 0)).unwrap();
        assert_eq!(json, "\"FF8000\"");
        let back: Rgb = serde_json::from_str("\"#ff8000\"").unwrap();
        assert_eq!(back, Rgb::new(0xFF, 0x80, 0));
        assert!(serde_json::from_str::<Rgb>("\"nope\"").is_err());
    }

    fn assert_close(actual: Rgb, expected: &str, ctx: &str) {
        let e = hex(expected);
        let ok = [(actual.r, e.r), (actual.g, e.g), (actual.b, e.b)]
            .iter()
            .all(|&(a, b)| a.abs_diff(b) <= 1);
        assert!(ok, "{ctx}: got {actual}, expected {expected}");
    }

    #[test]
    fn tint_reference_values() {
        let cases: &[(&str, f64, &str)] = &[
            ("FFFFFF", -0.05, "F2F2F2"),
            ("FFFFFF", -0.15, "D9D9D9"),
            ("FFFFFF", -0.25, "BFBFBF"),
            ("FFFFFF", -0.35, "A6A6A6"),
            ("FFFFFF", -0.50, "808080"),
            // Black: Excel's "Black, Text 1, Lighter N%" palette entries.
            ("000000", 0.05, "0D0D0D"),
            ("000000", 0.15, "262626"),
            ("000000", 0.25, "404040"),
            ("000000", 0.35, "595959"),
            ("000000", 0.50, "808080"),
            // Black lightened to the same greys the white shades above reach:
            // L' = tint for L = 0, so tint = 1 - shade amount.
            ("000000", 0.95, "F2F2F2"),
            ("000000", 0.85, "D9D9D9"),
            ("000000", 0.75, "BFBFBF"),
            ("000000", 0.65, "A6A6A6"),
            ("4F81BD", 0.80, "DCE6F1"),
            ("4F81BD", 0.60, "B8CCE4"),
            ("4F81BD", 0.40, "95B3D7"),
            ("4F81BD", -0.25, "376092"),
            ("4F81BD", -0.50, "244061"),
            ("C0504D", 0.60, "E6B9B8"),
            ("C0504D", -0.25, "953735"),
        ];
        for &(base, tint, expected) in cases {
            assert_close(
                apply_tint(hex(base), tint),
                expected,
                &format!("{base} tint {tint}"),
            );
        }
    }

    #[test]
    fn tint_edge_cases() {
        let c = hex("4F81BD");
        assert_eq!(apply_tint(c, 0.0), c);
        assert_eq!(apply_tint(c, f64::NAN), c);
        assert_eq!(apply_tint(c, 1.0), Rgb::WHITE);
        assert_eq!(apply_tint(c, -1.0), Rgb::BLACK);
        assert_eq!(apply_tint(c, 5.0), Rgb::WHITE);
        assert_eq!(apply_tint(c, -5.0), Rgb::BLACK);
    }

    #[test]
    fn hls_roundtrip_is_exact() {
        for c in ["4F81BD", "C0504D", "123456", "FEDCBA", "00FF00", "808080"] {
            let rgb = hex(c);
            let (h, l, s) = rgb_to_hls(rgb);
            assert_eq!(hls_to_rgb(h, l, s), rgb, "{c}");
        }
    }

    #[test]
    fn slot_names_both_directions() {
        for slot in ThemeColorSlot::ALL {
            assert_eq!(
                ThemeColorSlot::from_ooxml_name(slot.ooxml_scheme_name()),
                Some(slot)
            );
        }
        let expected = [
            "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5",
            "accent6", "hlink", "folHlink",
        ];
        for (i, slot) in ThemeColorSlot::ALL.iter().enumerate() {
            assert_eq!(slot.index(), i);
            assert_eq!(slot.ooxml_scheme_name(), expected[i]);
        }
        use ThemeColorSlot as S;
        assert_eq!(S::from_ooxml_name("tx1"), Some(S::Dark1));
        assert_eq!(S::from_ooxml_name("bg1"), Some(S::Light1));
        assert_eq!(S::from_ooxml_name("tx2"), Some(S::Dark2));
        assert_eq!(S::from_ooxml_name("bg2"), Some(S::Light2));
        assert_eq!(S::from_ooxml_name("accent7"), None);
        assert_eq!(S::from_ooxml_name("folhlink"), None);
        assert_eq!(S::from_ooxml_name(""), None);
    }

    #[test]
    fn scheme_get_set_and_default() {
        let mut scheme = ColorScheme::default();
        assert_eq!(scheme.name, "Office");
        assert_eq!(scheme.get(ThemeColorSlot::Accent1), hex("4472C4"));
        assert_eq!(scheme.get(ThemeColorSlot::FollowedHyperlink), hex("954F72"));
        assert_eq!(scheme.get(ThemeColorSlot::Dark2), hex("44546A"));
        scheme.set(ThemeColorSlot::Accent1, hex("4F81BD"));
        assert_eq!(scheme.get(ThemeColorSlot::Accent1), hex("4F81BD"));
    }

    #[test]
    fn color_resolve() {
        let scheme = ColorScheme::default();
        let auto = Rgb::BLACK;
        assert_eq!(Color::Auto.resolve(&scheme, auto), auto);
        assert_eq!(
            Color::Rgb(hex("123456")).resolve(&scheme, auto),
            hex("123456")
        );
        assert_eq!(
            Color::theme(ThemeColorSlot::Accent2).resolve(&scheme, auto),
            hex("ED7D31")
        );
        let shaded = Color::Theme {
            slot: ThemeColorSlot::Light1,
            tint: -0.5,
        };
        assert_close(shaded.resolve(&scheme, auto), "808080", "lt1 -0.5");
    }

    #[test]
    fn color_serde_roundtrip() {
        for c in [
            Color::Auto,
            Color::Rgb(hex("ABCDEF")),
            Color::Theme {
                slot: ThemeColorSlot::FollowedHyperlink,
                tint: -0.25,
            },
        ] {
            let json = serde_json::to_string(&c).unwrap();
            assert_eq!(serde_json::from_str::<Color>(&json).unwrap(), c, "{json}");
        }
    }
}
