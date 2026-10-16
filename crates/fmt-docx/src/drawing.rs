//! DrawingML pieces of shapes, text boxes and picture formatting shared by
//! the reader and the writer: fills and outlines (`a:solidFill`, `a:ln`),
//! preset geometry with adjust values, the `wps:style` references Word uses
//! for shape colours, picture effects (`a:srcRect`, `a:lum`, `a:grayscl`,
//! `a:duotone`, `a:biLevel`, `a:outerShdw`) and the VML fallback colours.

use std::collections::BTreeMap;

use core_model::units::Emu;
use core_model::{Color, ColorScheme, Rgb};
use fmt_ooxml::chart::{read_color, write_color};
use model_text::{Crop, LineDash, PictureFormat, Recolor, ShapeFill, ShapeLine};

use crate::xml::{El, Node, XmlOut};

/// `uri` of `a:graphicData` holding a `wps:wsp`.
pub(crate) const URI_WPS: &str =
    "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
pub(crate) const NS_WPS: &str = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
pub(crate) const NS_WP14: &str =
    "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";
pub(crate) const NS_V: &str = "urn:schemas-microsoft-com:vml";
pub(crate) const NS_O: &str = "urn:schemas-microsoft-com:office:office";
pub(crate) const NS_W10: &str = "urn:schemas-microsoft-com:office:word";

/// The fill element of `sp_pr` (`None` when it has none: the style
/// reference decides).
pub(crate) fn read_fill(sp_pr: &El) -> Option<ShapeFill> {
    for el in sp_pr.elements() {
        match el.name.as_str() {
            "noFill" => return Some(ShapeFill::None),
            "solidFill" => return Some(read_color(el).map_or(ShapeFill::None, ShapeFill::Solid)),
            // Gradients and patterns: their first colour.
            "gradFill" | "pattFill" => {
                return Some(
                    el.find("srgbClr")
                        .or_else(|| el.find("schemeClr"))
                        .and_then(|c| {
                            let wrap = El {
                                name: "x".into(),
                                children: vec![Node::El(c.clone())],
                                ..Default::default()
                            };
                            read_color(&wrap)
                        })
                        .map_or(ShapeFill::None, ShapeFill::Solid),
                )
            }
            _ => {}
        }
    }
    None
}

/// An `a:ln`: `None` when it has no fill of its own (the style reference
/// gives the colour), else the outline.
pub(crate) fn read_line(ln: &El) -> (Option<ShapeFill>, Option<Emu>, LineDash) {
    let width = ln.attr("w").and_then(|v| v.parse::<i64>().ok()).map(Emu);
    let dash = ln
        .child("prstDash")
        .and_then(|d| d.val())
        .map_or(LineDash::Solid, LineDash::from_prst);
    (read_fill(ln), width, dash)
}

/// Writes a fill element.
pub(crate) fn write_fill(x: &mut XmlOut, f: &ShapeFill) {
    match f {
        ShapeFill::None => x.empty("a:noFill", &[]),
        ShapeFill::Solid(c) => {
            x.start("a:solidFill", &[]);
            write_color(x, c);
            x.end("a:solidFill");
        }
    }
}

/// Writes `a:ln`.
pub(crate) fn write_line(x: &mut XmlOut, l: &ShapeLine) {
    let w = l.width.0.max(0).to_string();
    x.start("a:ln", &[("w", &w)]);
    write_fill(x, &l.fill);
    if !l.is_none() && l.dash != LineDash::Solid {
        x.empty("a:prstDash", &[("val", l.dash.prst())]);
    }
    x.end("a:ln");
}

/// `a:prstGeom` → preset name and adjust values (`a:gd name fmla="val N"`).
pub(crate) fn read_preset(g: &El) -> (String, BTreeMap<String, i64>) {
    let prst = g.attr("prst").unwrap_or("rect").to_owned();
    let mut adj = BTreeMap::new();
    if let Some(av) = g.child("avLst") {
        for gd in av.elements().filter(|e| e.name == "gd") {
            let (Some(name), Some(f)) = (gd.attr("name"), gd.attr("fmla")) else {
                continue;
            };
            if let Some(v) = f
                .strip_prefix("val ")
                .and_then(|v| v.trim().parse::<i64>().ok())
            {
                adj.insert(name.to_owned(), v);
            }
        }
    }
    (prst, adj)
}

/// Writes `a:prstGeom`.
pub(crate) fn write_preset(x: &mut XmlOut, prst: &str, adj: &BTreeMap<String, i64>) {
    x.start("a:prstGeom", &[("prst", prst)]);
    if adj.is_empty() {
        x.empty("a:avLst", &[]);
    } else {
        x.start("a:avLst", &[]);
        for (k, v) in adj {
            x.empty("a:gd", &[("name", k), ("fmla", &format!("val {v}"))]);
        }
        x.end("a:avLst");
    }
    x.end("a:prstGeom");
}

/// Serializes `el` (DrawingML: prefixed element names, unprefixed
/// attributes) back to XML.
pub(crate) fn el_to_xml(el: &El) -> String {
    let mut x = XmlOut::fragment();
    fn put(x: &mut XmlOut, el: &El) {
        let name = el.qname();
        // Namespace declarations (local names only in the DOM) are left out:
        // the part's root declares them.
        let attrs: Vec<(&str, &str)> = el
            .attrs
            .iter()
            .filter(|(_, v)| !v.starts_with("http://") && !v.starts_with("urn:"))
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        if el.children.is_empty() {
            x.empty(&name, &attrs);
            return;
        }
        x.start(&name, &attrs);
        for c in &el.children {
            match c {
                Node::El(e) => put(x, e),
                Node::Text(t) => x.text(t),
            }
        }
        x.end(&name);
    }
    put(&mut x, el);
    String::from_utf8(x.finish()).unwrap_or_default()
}

/// The colour of a `wps:style` reference (`a:lnRef`, `a:fillRef`,
/// `a:fontRef`) with its index (`idx`, 0 = none; `fontRef` has `minor`).
pub(crate) fn style_ref(style: Option<&El>, name: &str) -> Option<(u32, Option<Color>)> {
    let r = style?.child(name)?;
    let idx = match r.attr("idx") {
        Some("major" | "minor") => 1,
        Some(v) => v.parse().unwrap_or(0),
        None => 0,
    };
    Some((idx, read_color(r)))
}

/// Line width of the Office theme's line style `idx` (`a:lnStyleLst`).
pub(crate) fn theme_line_width(idx: u32) -> Emu {
    match idx {
        1 => Emu(6350),
        3 => Emu(19050),
        _ => Emu(12_700),
    }
}

/// Writes the `wps:style` Word uses (no theme fill/line/effect: those are
/// explicit in `wps:spPr`; the font colour reference carries the text
/// colour).
pub(crate) fn write_style(x: &mut XmlOut, text: &Color) {
    x.start("wps:style", &[]);
    for r in ["a:lnRef", "a:fillRef", "a:effectRef"] {
        x.start(r, &[("idx", "0")]);
        x.empty("a:scrgbClr", &[("r", "0"), ("g", "0"), ("b", "0")]);
        x.end(r);
    }
    x.start("a:fontRef", &[("idx", "minor")]);
    write_color(x, text);
    x.end("a:fontRef");
    x.end("wps:style");
}

/// `#RRGGBB` of `c` for VML attributes.
pub(crate) fn vml_color(c: &Color, scheme: &ColorScheme) -> String {
    format!("#{}", c.resolve(scheme, Rgb::BLACK).to_hex())
}

/// Points (VML `style` lengths) of an EMU length.
pub(crate) fn emu_pt(v: Emu) -> String {
    let pt = v.0 as f64 / 12_700.0;
    let s = format!("{pt:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    format!("{s}pt")
}

// --- pictures ----------------------------------------------------------------

/// Reads the picture formatting from `pic:pic` (`blipFill` effects and
/// crop, `spPr` outline shape, border and shadow).
pub(crate) fn read_picture_format(pic: &El) -> PictureFormat {
    let mut f = PictureFormat::default();
    let pct = |el: &El, a: &str| {
        el.attr(a)
            .and_then(|v| v.trim().parse::<i32>().ok())
            .unwrap_or(0)
    };
    if let Some(bf) = pic.child("blipFill") {
        if let Some(src) = bf.child("srcRect") {
            f.crop = Crop {
                left: pct(src, "l"),
                top: pct(src, "t"),
                right: pct(src, "r"),
                bottom: pct(src, "b"),
            };
        }
        if let Some(blip) = bf.child("blip") {
            for e in blip.elements() {
                match e.name.as_str() {
                    "grayscl" => f.recolor = Recolor::Grayscale,
                    "duotone" => f.recolor = Recolor::Sepia,
                    "biLevel" => f.recolor = Recolor::BlackWhite,
                    "lum" => {
                        let (b, c) = (pct(e, "bright"), pct(e, "contrast"));
                        if b == 70_000 && c == -70_000 {
                            f.recolor = Recolor::Washout;
                        } else {
                            f.brightness = b.clamp(-100_000, 100_000);
                            f.contrast = c.clamp(-100_000, 100_000);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    if let Some(sp) = pic.child("spPr") {
        if let Some(g) = sp.child("prstGeom") {
            let prst = g.attr("prst").unwrap_or("rect");
            if prst != "rect" {
                f.geometry = Some(prst.to_owned());
            }
        }
        if let Some(ln) = sp.child("ln") {
            let (fill, width, dash) = read_line(ln);
            if let Some(fill @ ShapeFill::Solid(_)) = fill {
                f.border = Some(ShapeLine {
                    fill,
                    width: width.unwrap_or(Emu(9525)),
                    dash,
                });
            }
        }
        f.shadow = sp
            .child("effectLst")
            .is_some_and(|e| e.child("outerShdw").is_some());
    }
    f
}

/// Writes the effects of `a:blip` (inside the element).
pub(crate) fn write_blip_effects(x: &mut XmlOut, f: &PictureFormat) {
    match f.recolor {
        Recolor::None => {}
        Recolor::Grayscale => x.empty("a:grayscl", &[]),
        Recolor::Sepia => {
            x.start("a:duotone", &[]);
            x.empty("a:prstClr", &[("val", "black")]);
            x.empty("a:srgbClr", &[("val", "D9C3A5")]);
            x.end("a:duotone");
        }
        Recolor::BlackWhite => x.empty("a:biLevel", &[("thresh", "50000")]),
        Recolor::Washout => x.empty("a:lum", &[("bright", "70000"), ("contrast", "-70000")]),
    }
    if (f.brightness != 0 || f.contrast != 0) && f.recolor != Recolor::Washout {
        let (b, c) = (f.brightness.to_string(), f.contrast.to_string());
        x.empty("a:lum", &[("bright", &b), ("contrast", &c)]);
    }
}

/// Writes `a:srcRect` when cropped.
pub(crate) fn write_src_rect(x: &mut XmlOut, c: &Crop) {
    if c.is_none() {
        return;
    }
    let v = [c.left, c.top, c.right, c.bottom].map(|n| n.to_string());
    let mut attrs = Vec::new();
    for (k, val) in ["l", "t", "r", "b"].into_iter().zip(&v) {
        if val != "0" {
            attrs.push((k, val.as_str()));
        }
    }
    x.empty("a:srcRect", &attrs);
}

/// Writes Word's "Offset: Bottom Right" outer shadow.
pub(crate) fn write_shadow(x: &mut XmlOut) {
    x.start("a:effectLst", &[]);
    x.start(
        "a:outerShdw",
        &[
            ("blurRad", "50800"),
            ("dist", "38100"),
            ("dir", "2700000"),
            ("algn", "tl"),
            ("rotWithShape", "0"),
        ],
    );
    x.start("a:prstClr", &[("val", "black")]);
    x.empty("a:alpha", &[("val", "40000")]);
    x.end("a:prstClr");
    x.end("a:outerShdw");
    x.end("a:effectLst");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(xml: &str) -> El {
        crate::xml::parse(xml.as_bytes(), "t").unwrap()
    }

    #[test]
    fn preset_and_custom_geometry() {
        let g = el(
            r#"<a:prstGeom xmlns:a="a" prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>"#,
        );
        let (p, adj) = read_preset(&g);
        assert_eq!(p, "roundRect");
        assert_eq!(adj.get("adj"), Some(&25000));
        let mut x = XmlOut::fragment();
        write_preset(&mut x, &p, &adj);
        let s = String::from_utf8(x.finish()).unwrap();
        assert!(s.contains(r#"<a:gd name="adj" fmla="val 25000"/>"#), "{s}");
        let c = el(
            r#"<a:custGeom xmlns:a="http://a"><a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo></a:path></a:pathLst></a:custGeom>"#,
        );
        let xml = el_to_xml(&c);
        assert!(
            xml.starts_with("<a:custGeom><a:pathLst><a:path w=\"10\" h=\"10\">"),
            "{xml}"
        );
    }

    #[test]
    fn picture_effects_roundtrip() {
        let f = PictureFormat {
            crop: Crop {
                left: 10_000,
                top: 0,
                right: 5_000,
                bottom: 20_000,
            },
            border: Some(ShapeLine::solid(Color::Rgb(Rgb::new(1, 2, 3)), Emu(25_400))),
            geometry: Some("roundRect".into()),
            shadow: true,
            brightness: 20_000,
            contrast: -40_000,
            recolor: Recolor::Grayscale,
        };
        let mut x = XmlOut::fragment();
        x.start("pic:pic", &[]);
        x.start("pic:blipFill", &[]);
        x.start("a:blip", &[]);
        write_blip_effects(&mut x, &f);
        x.end("a:blip");
        write_src_rect(&mut x, &f.crop);
        x.end("pic:blipFill");
        x.start("pic:spPr", &[]);
        write_preset(&mut x, f.geometry.as_deref().unwrap(), &BTreeMap::new());
        write_line(&mut x, f.border.as_ref().unwrap());
        write_shadow(&mut x);
        x.end("pic:spPr");
        x.end("pic:pic");
        let xml = String::from_utf8(x.finish()).unwrap();
        let back = read_picture_format(&el(
            &xml.replace("<pic:pic>", r#"<pic:pic xmlns:pic="p" xmlns:a="a">"#)
        ));
        assert_eq!(back, f, "{xml}");
        assert!(xml.contains(r#"<a:srcRect l="10000" r="5000" b="20000"/>"#));
        assert_eq!(emu_pt(Emu(12_700 * 3 / 2)), "1.5pt");
    }
}
