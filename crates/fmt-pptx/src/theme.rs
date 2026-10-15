//! `ppt/theme/theme1.xml`: parsing into [`core_model::Theme`] and writing a
//! theme part from the model.
//!
//! The parser is a copy of `fmt-docx`'s (format crates do not depend on
//! each other); the writer differs: it emits the model's colors and fonts
//! instead of the fixed Office theme.

use core_model::{ColorScheme, Rgb, Theme, ThemeColorSlot};

use crate::xml::{parse, El, XmlOut};
use crate::Result;

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
        theme.colors = parse_color_scheme(cs);
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

fn parse_color_scheme(cs: &El) -> ColorScheme {
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

/// A minimal but complete theme part with the colors and fonts of `theme`
/// (all colors as `a:srgbClr`) and Office-like format styles (three solid
/// `phClr` fills, three outlines of 0.5/1/1.5 pt, no effects).
pub fn theme_xml(theme: &Theme) -> Vec<u8> {
    const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
    let mut x = XmlOut::new();
    x.start("a:theme", &[("xmlns:a", NS_A), ("name", &theme.name)]);
    x.start("a:themeElements", &[]);
    x.start("a:clrScheme", &[("name", &theme.colors.name)]);
    for slot in ThemeColorSlot::ALL {
        let n = format!("a:{}", slot.ooxml_scheme_name());
        x.start(&n, &[]);
        x.empty("a:srgbClr", &[("val", &theme.colors.get(slot).to_hex())]);
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
        x.empty("a:latin", &[("typeface", latin)]);
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
        let back = parse_theme(&theme_xml(&theme), "theme").unwrap();
        assert_eq!(back, theme);
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
        let back = parse_theme(&theme_xml(&theme), "theme").unwrap();
        assert_eq!(back, theme);
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
        assert_eq!(t.colors.name, "LO");
        assert_eq!(
            t.colors.get(ThemeColorSlot::Accent1),
            Rgb::new(0x18, 0xA3, 0x03)
        );
        assert_eq!(t.fonts.major_latin, "Liberation Sans");
        assert_eq!(t.fonts.minor_east_asian, "Noto");
    }
}
