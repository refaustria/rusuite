//! `word/theme/theme1.xml`: parsing into [`core_model::Theme`] and the
//! built-in default theme part.

use core_model::{ColorScheme, Rgb, Theme, ThemeColorSlot};

use crate::xml::{parse, El};
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

/// A minimal but complete Office theme part with the colors of
/// [`ColorScheme::default`] and Calibri Light / Calibri fonts.
pub fn default_theme_xml() -> Vec<u8> {
    let scheme = ColorScheme::default();
    let mut colors = String::new();
    for slot in ThemeColorSlot::ALL {
        let n = slot.ooxml_scheme_name();
        let c = scheme.get(slot).to_hex();
        let inner = match slot {
            ThemeColorSlot::Dark1 => format!("<a:sysClr val=\"windowText\" lastClr=\"{c}\"/>"),
            ThemeColorSlot::Light1 => format!("<a:sysClr val=\"window\" lastClr=\"{c}\"/>"),
            _ => format!("<a:srgbClr val=\"{c}\"/>"),
        };
        colors.push_str(&format!("<a:{n}>{inner}</a:{n}>"));
    }
    let fill = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>";
    let line = |w: u32| {
        format!(
            "<a:ln w=\"{w}\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/><a:miter lim=\"800000\"/></a:ln>"
        )
    };
    let effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
    let font = |latin: &str, panose: &str| {
        format!("<a:latin typeface=\"{latin}\" panose=\"{panose}\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/>")
    };
    format!(
        "{decl}<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office Theme\">\
<a:themeElements><a:clrScheme name=\"{name}\">{colors}</a:clrScheme>\
<a:fontScheme name=\"Office\"><a:majorFont>{major}</a:majorFont><a:minorFont>{minor}</a:minorFont></a:fontScheme>\
<a:fmtScheme name=\"Office\"><a:fillStyleLst>{fill}{fill}{fill}</a:fillStyleLst>\
<a:lnStyleLst>{l1}{l2}{l3}</a:lnStyleLst>\
<a:effectStyleLst>{effect}{effect}{effect}</a:effectStyleLst>\
<a:bgFillStyleLst>{fill}{fill}{fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements>\
<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>",
        decl = fmt_ooxml::xml::DECLARATION,
        name = scheme.name,
        major = font("Calibri Light", "020F0302020204030204"),
        minor = font("Calibri", "020F0502020204030204"),
        l1 = line(6350),
        l2 = line(12700),
        l3 = line(19050),
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_parses_back() {
        let theme = parse_theme(&default_theme_xml(), "theme").unwrap();
        assert_eq!(theme.colors, ColorScheme::default());
        assert_eq!(theme.fonts.major_latin, "Calibri Light");
        assert_eq!(theme.fonts.minor_latin, "Calibri");
        assert_eq!(theme.name, "Office Theme");
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
        assert_eq!(t.fonts.minor_latin, "Liberation Serif");
        assert_eq!(t.fonts.minor_east_asian, "Noto");
    }
}
