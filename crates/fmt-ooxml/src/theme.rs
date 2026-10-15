//! DrawingML theme parts (`*/theme/theme1.xml`): parsing into
//! [`core_model::Theme`] and writing a theme part from one.
//!
//! The vocabulary is shared by all three OOXML formats; only the mapping of
//! SpreadsheetML's `theme="N"` color indices is format-specific and lives
//! in `fmt-xlsx`.

use core_model::{ColorScheme, Rgb, Theme, ThemeColorSlot};

use crate::xml::{parse, El, XmlOut};
use crate::Result;

/// DrawingML main namespace (`a:`).
pub const DRAWINGML_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

/// Parses the color scheme and the major/minor fonts of a theme part.
/// Missing pieces keep the Office defaults.
pub fn parse_theme(xml: &[u8], part: &str) -> Result<Theme> {
    let root = parse(xml, part)?;
    let mut theme = Theme::default();
    if let Some(name) = root.attr("name") {
        theme.name = name.to_owned();
    }
    let Some(elements) = root.child("themeElements") else {
        return Ok(theme);
    };
    if let Some(cs) = elements.child("clrScheme") {
        theme.colors = color_scheme_of(cs);
    }
    if let Some(fs) = elements.child("fontScheme") {
        let f = &mut theme.fonts;
        if let Some(n) = fs.attr("name") {
            f.name = n.to_owned();
        }
        let face = |group: Option<&El>, script: &str| {
            group
                .and_then(|g| g.child(script))
                .and_then(|e| e.attr("typeface"))
                .map(str::to_owned)
        };
        let (major, minor) = (fs.child("majorFont"), fs.child("minorFont"));
        let set = |slot: &mut String, v: Option<String>| {
            if let Some(v) = v {
                *slot = v;
            }
        };
        set(&mut f.major_latin, face(major, "latin"));
        set(&mut f.minor_latin, face(minor, "latin"));
        set(&mut f.major_east_asian, face(major, "ea"));
        set(&mut f.minor_east_asian, face(minor, "ea"));
        set(&mut f.major_complex_script, face(major, "cs"));
        set(&mut f.minor_complex_script, face(minor, "cs"));
    }
    Ok(theme)
}

/// Parses only the first `<a:clrScheme>` of a theme part. Missing slots
/// keep the Office defaults; `None` if the part has no color scheme.
pub fn parse_color_scheme(xml: &[u8], part: &str) -> Result<Option<ColorScheme>> {
    let root = parse(xml, part)?;
    let cs = if root.name == "clrScheme" {
        Some(&root)
    } else {
        root.find("clrScheme")
    };
    Ok(cs.map(color_scheme_of))
}

/// `<a:clrScheme>` → [`ColorScheme`]; colors are `a:srgbClr/@val` or
/// `a:sysClr/@lastClr`.
fn color_scheme_of(cs: &El) -> ColorScheme {
    let mut scheme = ColorScheme::default();
    if let Some(n) = cs.attr("name") {
        scheme.name = n.to_owned();
    }
    for slot_el in cs.elements() {
        let Some(slot) = ThemeColorSlot::from_ooxml_name(&slot_el.name) else {
            continue;
        };
        let hex = slot_el.elements().find_map(|c| match c.name.as_str() {
            "srgbClr" => c.attr("val"),
            "sysClr" => c.attr("lastClr"),
            _ => None,
        });
        if let Some(rgb) = hex.and_then(|h| Rgb::from_hex(h).ok()) {
            scheme.set(slot, rgb);
        }
    }
    scheme
}

/// How [`theme_xml_with`] spells a few optional details.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ThemeXmlOptions {
    /// Write `dk1`/`lt1` as `a:sysClr` (`windowText`/`window`) like Word
    /// does, instead of `a:srgbClr`.
    pub system_colors: bool,
    /// Write the `panose` attribute for the Office fonts (Calibri,
    /// Calibri Light) like Excel and Word do.
    pub panose: bool,
}

/// PANOSE classification of the Office theme fonts.
fn panose_of(typeface: &str) -> Option<&'static str> {
    match typeface {
        "Calibri Light" => Some("020F0302020204030204"),
        "Calibri" => Some("020F0502020204030204"),
        _ => None,
    }
}

/// [`theme_xml_with`] with the default options (all colors as
/// `a:srgbClr`, no PANOSE).
pub fn theme_xml(theme: &Theme) -> Vec<u8> {
    theme_xml_with(theme, ThemeXmlOptions::default())
}

/// The built-in Office theme part (`name="Office Theme"`, colors of
/// [`ColorScheme::default`], Calibri Light / Calibri with PANOSE) that the
/// writers use when a document brings no theme of its own.
/// `system_colors` selects Word's `a:sysClr` spelling for `dk1`/`lt1`.
pub fn office_theme_xml(system_colors: bool) -> Vec<u8> {
    let theme = Theme {
        name: "Office Theme".to_owned(),
        ..Theme::default()
    };
    theme_xml_with(
        &theme,
        ThemeXmlOptions {
            system_colors,
            panose: true,
        },
    )
}

/// A minimal but complete theme part with the colors and fonts of `theme`
/// and Office-like format styles (three solid `phClr` fills, three outlines
/// of 0.5/1/1.5 pt, no effects).
pub fn theme_xml_with(theme: &Theme, opts: ThemeXmlOptions) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "a:theme",
        &[("xmlns:a", DRAWINGML_NS), ("name", &theme.name)],
    );
    x.start("a:themeElements", &[]);
    x.start("a:clrScheme", &[("name", &theme.colors.name)]);
    for slot in ThemeColorSlot::ALL {
        let n = format!("a:{}", slot.ooxml_scheme_name());
        let hex = theme.colors.get(slot).to_hex();
        x.start(&n, &[]);
        let sys = match slot {
            ThemeColorSlot::Dark1 if opts.system_colors => Some("windowText"),
            ThemeColorSlot::Light1 if opts.system_colors => Some("window"),
            _ => None,
        };
        match sys {
            Some(val) => x.empty("a:sysClr", &[("val", val), ("lastClr", &hex)]),
            None => x.empty("a:srgbClr", &[("val", &hex)]),
        }
        x.end(&n);
    }
    x.end("a:clrScheme");
    let f = &theme.fonts;
    x.start("a:fontScheme", &[("name", &f.name)]);
    for (group, latin, ea, cs) in [
        (
            "a:majorFont",
            &f.major_latin,
            &f.major_east_asian,
            &f.major_complex_script,
        ),
        (
            "a:minorFont",
            &f.minor_latin,
            &f.minor_east_asian,
            &f.minor_complex_script,
        ),
    ] {
        x.start(group, &[]);
        match panose_of(latin).filter(|_| opts.panose) {
            Some(p) => x.empty("a:latin", &[("typeface", latin), ("panose", p)]),
            None => x.empty("a:latin", &[("typeface", latin)]),
        }
        x.empty("a:ea", &[("typeface", ea)]);
        x.empty("a:cs", &[("typeface", cs)]);
        x.end(group);
    }
    x.end("a:fontScheme");
    x.start("a:fmtScheme", &[("name", "Office")]);
    let solid = |x: &mut XmlOut| {
        x.start("a:solidFill", &[]);
        x.empty("a:schemeClr", &[("val", "phClr")]);
        x.end("a:solidFill");
    };
    x.start("a:fillStyleLst", &[]);
    for _ in 0..3 {
        solid(&mut x);
    }
    x.end("a:fillStyleLst");
    x.start("a:lnStyleLst", &[]);
    for w in ["6350", "12700", "19050"] {
        x.start(
            "a:ln",
            &[("w", w), ("cap", "flat"), ("cmpd", "sng"), ("algn", "ctr")],
        );
        solid(&mut x);
        x.empty("a:prstDash", &[("val", "solid")]);
        x.empty("a:miter", &[("lim", "800000")]);
        x.end("a:ln");
    }
    x.end("a:lnStyleLst");
    x.start("a:effectStyleLst", &[]);
    for _ in 0..3 {
        x.start("a:effectStyle", &[]);
        x.empty("a:effectLst", &[]);
        x.end("a:effectStyle");
    }
    x.end("a:effectStyleLst");
    x.start("a:bgFillStyleLst", &[]);
    for _ in 0..3 {
        solid(&mut x);
    }
    x.end("a:bgFillStyleLst");
    x.end("a:fmtScheme");
    x.end("a:themeElements");
    x.empty("a:objectDefaults", &[]);
    x.empty("a:extraClrSchemeLst", &[]);
    x.end("a:theme");
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_parses_back() {
        let theme = Theme::default();
        assert_eq!(parse_theme(&theme_xml(&theme), "theme").unwrap(), theme);
        for sys in [false, true] {
            let xml = office_theme_xml(sys);
            let back = parse_theme(&xml, "theme").unwrap();
            assert_eq!(back.colors, ColorScheme::default());
            assert_eq!(back.fonts, theme.fonts);
            assert_eq!(back.name, "Office Theme");
            let s = String::from_utf8(xml).unwrap();
            assert_eq!(s.contains("<a:sysClr val=\"windowText\""), sys);
            assert!(s.contains("panose=\"020F0502020204030204\""));
            assert_eq!(
                parse_color_scheme(s.as_bytes(), "t").unwrap(),
                Some(ColorScheme::default())
            );
        }
    }

    #[test]
    fn custom_theme_roundtrips() {
        let mut theme = Theme {
            name: "Mine & Yours".into(),
            ..Theme::default()
        };
        theme.colors.name = "Colors".into();
        theme
            .colors
            .set(ThemeColorSlot::Accent3, Rgb::new(0x12, 0x34, 0x56));
        theme
            .colors
            .set(ThemeColorSlot::Dark1, Rgb::new(0x20, 0x20, 0x20));
        theme.fonts.major_latin = "Georgia".into();
        theme.fonts.minor_east_asian = "Noto Sans CJK".into();
        for opts in [
            ThemeXmlOptions::default(),
            ThemeXmlOptions {
                system_colors: true,
                panose: true,
            },
        ] {
            let back = parse_theme(&theme_xml_with(&theme, opts), "theme").unwrap();
            assert_eq!(back, theme);
        }
    }

    #[test]
    fn parses_libreoffice_style_theme() {
        let xml = br#"<a:theme xmlns:a="x" name="LibreOffice"><a:themeElements>
            <a:clrScheme name="LO"><a:dk1><a:srgbClr val="000000"/></a:dk1>
            <a:accent1><a:srgbClr val="18A303"/></a:accent1></a:clrScheme>
            <a:fontScheme name="LO"><a:majorFont><a:latin typeface="Liberation Sans"/></a:majorFont>
            <a:minorFont><a:latin typeface="Liberation Serif"/><a:ea typeface="Noto"/></a:minorFont></a:fontScheme>
            </a:themeElements></a:theme>"#;
        let t = parse_theme(xml, "t").unwrap();
        assert_eq!(t.name, "LibreOffice");
        assert_eq!(t.colors.name, "LO");
        assert_eq!(
            t.colors.get(ThemeColorSlot::Accent1),
            Rgb::new(0x18, 0xA3, 0x03)
        );
        assert_eq!(t.fonts.major_latin, "Liberation Sans");
        assert_eq!(t.fonts.minor_latin, "Liberation Serif");
        assert_eq!(t.fonts.minor_east_asian, "Noto");
    }

    #[test]
    fn color_scheme_only() {
        let xml = br#"<a:theme xmlns:a="x"><a:themeElements><a:clrScheme name="Mine">
            <a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1>
            <a:accent2><a:srgbClr val="ff0000"/></a:accent2>
            </a:clrScheme></a:themeElements></a:theme>"#;
        let s = parse_color_scheme(xml, "t").unwrap().unwrap();
        assert_eq!(s.name, "Mine");
        assert_eq!(s.get(ThemeColorSlot::Dark1), Rgb::new(0x11, 0x11, 0x11));
        assert_eq!(s.get(ThemeColorSlot::Accent2), Rgb::new(255, 0, 0));
        assert_eq!(
            s.get(ThemeColorSlot::Accent1),
            ColorScheme::default().get(ThemeColorSlot::Accent1)
        );
        assert_eq!(parse_color_scheme(b"<a/>", "t").unwrap(), None);
        assert!(parse_color_scheme(b"<a><b></a>", "t").is_err());
    }
}
