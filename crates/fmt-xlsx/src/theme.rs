//! `xl/theme/theme1.xml`: color-scheme parsing and the built-in default
//! theme part, plus the mapping of SpreadsheetML `theme="N"` indices.

use core_model::{ColorScheme, Rgb, ThemeColorSlot};
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::xml::{attr, name_of, xml_err};
use crate::Result;

/// SpreadsheetML theme color index → slot. Excel swaps the dark/light
/// pairs relative to the scheme order: 0 = `lt1`, 1 = `dk1`, 2 = `lt2`,
/// 3 = `dk2`, then accents and hyperlinks.
pub fn slot_from_index(i: u32) -> Option<ThemeColorSlot> {
    use ThemeColorSlot::*;
    Some(match i {
        0 => Light1,
        1 => Dark1,
        2 => Light2,
        3 => Dark2,
        4 => Accent1,
        5 => Accent2,
        6 => Accent3,
        7 => Accent4,
        8 => Accent5,
        9 => Accent6,
        10 => Hyperlink,
        11 => FollowedHyperlink,
        _ => return None,
    })
}

/// Inverse of [`slot_from_index`].
pub fn index_of_slot(slot: ThemeColorSlot) -> u32 {
    (0..12)
        .find(|&i| slot_from_index(i) == Some(slot))
        .expect("every slot has an index")
}

/// Parses `<a:clrScheme>` of a theme part. Missing slots keep the Office
/// defaults; `None` if the part has no color scheme.
pub fn parse_color_scheme(xml: &[u8], part: &str) -> Result<Option<ColorScheme>> {
    let mut reader = Reader::from_reader(xml);
    let mut scheme: Option<ColorScheme> = None;
    let mut slot: Option<ThemeColorSlot> = None;
    loop {
        match reader.read_event().map_err(xml_err(part))? {
            Event::Start(el) | Event::Empty(el) => {
                let name = name_of(&el);
                if name == b"clrScheme" && scheme.is_none() {
                    let mut s = ColorScheme::default();
                    if let Some(n) = attr(&el, "name") {
                        s.name = n.into_owned();
                    }
                    scheme = Some(s);
                } else if let Some(s) = scheme.as_mut() {
                    let name = std::str::from_utf8(name).unwrap_or("");
                    if let Some(sl) = ThemeColorSlot::from_ooxml_name(name) {
                        slot = Some(sl);
                    } else if let Some(sl) = slot {
                        let hex = match name {
                            "srgbClr" => attr(&el, "val"),
                            "sysClr" => attr(&el, "lastClr"),
                            _ => None,
                        };
                        if let Some(rgb) = hex.and_then(|h| Rgb::from_hex(&h).ok()) {
                            s.set(sl, rgb);
                        }
                    }
                }
            }
            Event::End(el) => {
                let name = crate::xml::end_name(&el);
                if name == b"clrScheme" && scheme.is_some() {
                    break;
                }
                if std::str::from_utf8(name)
                    .ok()
                    .and_then(ThemeColorSlot::from_ooxml_name)
                    .is_some()
                {
                    slot = None;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(scheme)
}

/// A minimal but complete Office theme part with the colors of
/// [`ColorScheme::default`] and Calibri Light / Calibri fonts.
pub fn default_theme_xml() -> Vec<u8> {
    let scheme = ColorScheme::default();
    let mut colors = String::new();
    for slot in ThemeColorSlot::ALL {
        let n = slot.ooxml_scheme_name();
        colors.push_str(&format!(
            "<a:{n}><a:srgbClr val=\"{}\"/></a:{n}>",
            scheme.get(slot).to_hex()
        ));
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
    fn index_mapping() {
        assert_eq!(slot_from_index(0), Some(ThemeColorSlot::Light1));
        assert_eq!(slot_from_index(1), Some(ThemeColorSlot::Dark1));
        assert_eq!(slot_from_index(4), Some(ThemeColorSlot::Accent1));
        assert_eq!(slot_from_index(12), None);
        for slot in ThemeColorSlot::ALL {
            assert_eq!(slot_from_index(index_of_slot(slot)), Some(slot));
        }
    }

    #[test]
    fn default_theme_parses_back() {
        let xml = default_theme_xml();
        let scheme = parse_color_scheme(&xml, "theme").unwrap().unwrap();
        assert_eq!(scheme, ColorScheme::default());
    }

    #[test]
    fn parses_srgb_and_sysclr() {
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
    }
}
