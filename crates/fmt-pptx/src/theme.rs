//! The theme part (`ppt/theme/theme1.xml`): colours and fonts via
//! [`fmt_ooxml::theme::parse_theme`], plus the format scheme
//! (`a:fmtScheme`) which only Show models.

use core_model::{Rgb, ThemeColorSlot};
use fmt_ooxml::theme::parse_theme;
use model_show::{
    ColorBase, ColorMod, EffectStyle, Emu, FormatScheme, Gradient, GradientShape, GradientStop,
    LineDash, StyleColor, StyleFill, StyleLine, StyleShadow, Theme,
};

use crate::drawing::{dash_from, dash_name, preset_color, ANGLE_UNITS_PER_DEGREE};
use crate::xml::{parse, parse_i64, xml_error, El, XmlOut};
use crate::Result;

/// DrawingML main namespace.
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

/// Parses a theme part: colours and fonts, and the format scheme (absent
/// → the Office one).
pub fn read_theme(xml: &[u8], part: &str) -> Result<Theme> {
    let core = parse_theme(xml, part).map_err(xml_error)?;
    let mut theme = Theme::from(core);
    let root = parse(xml, part)?;
    if let Some(fs) = root
        .child("themeElements")
        .and_then(|e| e.child("fmtScheme"))
    {
        theme.format = read_format_scheme(fs);
    }
    Ok(theme)
}

/// A colour element of the format scheme → [`StyleColor`] (`None` for
/// unknown elements).
fn style_color(el: &El) -> Option<StyleColor> {
    let base = match el.name.as_str() {
        "schemeClr" => match el.attr("val")? {
            "phClr" => ColorBase::Placeholder,
            v => ColorBase::Scheme(ThemeColorSlot::from_ooxml_name(v)?),
        },
        "srgbClr" => ColorBase::Rgb(Rgb::from_hex(el.attr("val")?).ok()?),
        "sysClr" => ColorBase::Rgb(Rgb::from_hex(el.attr("lastClr")?).ok()?),
        "prstClr" => ColorBase::Rgb(preset_color(el.attr("val")?).unwrap_or(Rgb::BLACK)),
        _ => return None,
    };
    let mods = el
        .elements()
        .filter_map(|m| {
            let v = m.attr("val").and_then(parse_i64)?;
            ColorMod::from_ooxml(&m.name, i32::try_from(v).ok()?)
        })
        .collect();
    Some(StyleColor { base, mods })
}

/// The first colour child of `parent`.
fn color_child(parent: &El) -> Option<StyleColor> {
    parent.elements().find_map(style_color)
}

/// A fill element (`a:noFill`, `a:solidFill`, `a:gradFill`; others read
/// as a solid placeholder colour) → [`StyleFill`].
fn style_fill(el: &El) -> Option<StyleFill> {
    Some(match el.name.as_str() {
        "noFill" => StyleFill::None,
        "solidFill" => StyleFill::Solid(color_child(el).unwrap_or(StyleColor::placeholder(&[]))),
        "gradFill" => {
            let stops = el
                .child("gsLst")
                .map(|l| {
                    l.elements()
                        .filter(|g| g.name == "gs")
                        .filter_map(|g| {
                            Some(GradientStop {
                                pos: g.attr("pos").and_then(parse_i64).unwrap_or(0) as f64
                                    / 100_000.0,
                                color: color_child(g)?,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let (angle_deg, shape) = if let Some(lin) = el.child("lin") {
                (
                    lin.attr("ang").and_then(parse_i64).unwrap_or(0) as f64
                        / ANGLE_UNITS_PER_DEGREE,
                    GradientShape::Linear,
                )
            } else if let Some(p) = el.child("path") {
                let shape = match p.attr("path") {
                    Some("circle") => GradientShape::Circle,
                    Some("rect") => GradientShape::Rect,
                    _ => GradientShape::Shape,
                };
                (0.0, shape)
            } else {
                (0.0, GradientShape::Linear)
            };
            StyleFill::Gradient(Gradient {
                stops,
                angle_deg,
                shape,
                rotate_with_shape: el.attr("rotWithShape") == Some("1"),
            })
        }
        "pattFill" | "blipFill" | "grpFill" => StyleFill::Solid(StyleColor::placeholder(&[])),
        _ => return None,
    })
}

fn fills_of(list: Option<&El>) -> Vec<StyleFill> {
    list.map(|l| l.elements().filter_map(style_fill).collect())
        .unwrap_or_default()
}

/// `a:fmtScheme` → [`FormatScheme`] (missing lists stay empty).
pub fn read_format_scheme(fs: &El) -> FormatScheme {
    let lines = fs
        .child("lnStyleLst")
        .map(|l| {
            l.elements()
                .filter(|e| e.name == "ln")
                .map(|ln| StyleLine {
                    width: Emu(ln.attr("w").and_then(parse_i64).unwrap_or(0)),
                    fill: ln
                        .elements()
                        .find_map(style_fill)
                        .unwrap_or(StyleFill::None),
                    dash: ln
                        .child("prstDash")
                        .and_then(|d| d.attr("val"))
                        .and_then(dash_from)
                        .unwrap_or(LineDash::Solid),
                })
                .collect()
        })
        .unwrap_or_default();
    let effects = fs
        .child("effectStyleLst")
        .map(|l| {
            l.elements()
                .filter(|e| e.name == "effectStyle")
                .map(|es| EffectStyle {
                    shadow: es.find("outerShdw").and_then(|s| {
                        let n = |a: &str| s.attr(a).and_then(parse_i64).unwrap_or(0);
                        Some(StyleShadow {
                            blur: Emu(n("blurRad")),
                            distance: Emu(n("dist")),
                            direction_deg: n("dir") as f64 / ANGLE_UNITS_PER_DEGREE,
                            color: color_child(s)?,
                        })
                    }),
                })
                .collect()
        })
        .unwrap_or_default();
    FormatScheme {
        name: fs.attr("name").unwrap_or("").to_owned(),
        fill_styles: fills_of(fs.child("fillStyleLst")),
        line_styles: lines,
        effect_styles: effects,
        bg_fill_styles: fills_of(fs.child("bgFillStyleLst")),
    }
}

fn write_style_color(x: &mut XmlOut, c: &StyleColor) {
    let (name, attrs): (&str, Vec<(&str, String)>) = match c.base {
        ColorBase::Placeholder => ("a:schemeClr", vec![("val", "phClr".to_owned())]),
        ColorBase::Scheme(slot) => (
            "a:schemeClr",
            vec![("val", slot.ooxml_scheme_name().to_owned())],
        ),
        ColorBase::Rgb(rgb) => ("a:srgbClr", vec![("val", rgb.to_hex())]),
    };
    let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    if c.mods.is_empty() {
        x.empty(name, &attrs);
        return;
    }
    x.start(name, &attrs);
    for m in &c.mods {
        x.empty(
            &format!("a:{}", m.ooxml_name()),
            &[("val", &m.value().to_string())],
        );
    }
    x.end(name);
}

/// Writes a style fill element.
pub fn write_style_fill(x: &mut XmlOut, f: &StyleFill) {
    match f {
        StyleFill::None => x.empty("a:noFill", &[]),
        StyleFill::Solid(c) => {
            x.start("a:solidFill", &[]);
            write_style_color(x, c);
            x.end("a:solidFill");
        }
        StyleFill::Gradient(g) => {
            x.start(
                "a:gradFill",
                &[("rotWithShape", if g.rotate_with_shape { "1" } else { "0" })],
            );
            x.start("a:gsLst", &[]);
            for s in &g.stops {
                let pos = ((s.pos * 100_000.0).round() as i64).to_string();
                x.start("a:gs", &[("pos", &pos)]);
                write_style_color(x, &s.color);
                x.end("a:gs");
            }
            x.end("a:gsLst");
            match g.shape {
                GradientShape::Linear => {
                    let ang = ((g.angle_deg * ANGLE_UNITS_PER_DEGREE).round() as i64).to_string();
                    x.empty("a:lin", &[("ang", &ang), ("scaled", "0")]);
                }
                shape => {
                    let p = match shape {
                        GradientShape::Circle => "circle",
                        GradientShape::Rect => "rect",
                        _ => "shape",
                    };
                    x.start("a:path", &[("path", p)]);
                    x.empty(
                        "a:fillToRect",
                        &[
                            ("l", "50000"),
                            ("t", "50000"),
                            ("r", "50000"),
                            ("b", "50000"),
                        ],
                    );
                    x.end("a:path");
                }
            }
            x.end("a:gradFill");
        }
    }
}

/// The theme part for `theme`: all 12 colours as `a:srgbClr`, major/minor
/// latin/ea/cs fonts and the format scheme of the model.
pub fn theme_xml(theme: &Theme) -> Vec<u8> {
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
    let fs = &theme.format;
    x.start("a:fmtScheme", &[("name", &fs.name)]);
    x.start("a:fillStyleLst", &[]);
    for s in &fs.fill_styles {
        write_style_fill(&mut x, s);
    }
    x.end("a:fillStyleLst");
    x.start("a:lnStyleLst", &[]);
    for l in &fs.line_styles {
        let w = l.width.0.max(0).to_string();
        x.start(
            "a:ln",
            &[("w", &w), ("cap", "flat"), ("cmpd", "sng"), ("algn", "ctr")],
        );
        write_style_fill(&mut x, &l.fill);
        x.empty("a:prstDash", &[("val", dash_name(l.dash))]);
        x.empty("a:miter", &[("lim", "800000")]);
        x.end("a:ln");
    }
    x.end("a:lnStyleLst");
    x.start("a:effectStyleLst", &[]);
    for e in &fs.effect_styles {
        x.start("a:effectStyle", &[]);
        match &e.shadow {
            None => x.empty("a:effectLst", &[]),
            Some(s) => {
                x.start("a:effectLst", &[]);
                let dir = ((s.direction_deg * ANGLE_UNITS_PER_DEGREE).round() as i64).to_string();
                x.start(
                    "a:outerShdw",
                    &[
                        ("blurRad", &s.blur.0.max(0).to_string()),
                        ("dist", &s.distance.0.max(0).to_string()),
                        ("dir", &dir),
                        ("algn", "ctr"),
                        ("rotWithShape", "0"),
                    ],
                );
                write_style_color(&mut x, &s.color);
                x.end("a:outerShdw");
                x.end("a:effectLst");
            }
        }
        x.end("a:effectStyle");
    }
    x.end("a:effectStyleLst");
    x.start("a:bgFillStyleLst", &[]);
    for s in &fs.bg_fill_styles {
        write_style_fill(&mut x, s);
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
    fn every_builtin_theme_roundtrips() {
        for b in model_show::builtin_themes() {
            let xml = theme_xml(&b.theme);
            assert_eq!(read_theme(&xml, "t").unwrap(), b.theme, "{}", b.id);
        }
    }

    #[test]
    fn reads_office_format_scheme_spelling() {
        let xml = br#"<a:theme xmlns:a="a" name="T"><a:themeElements><a:fmtScheme name="Office">
          <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
          <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
          <a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></a:fillStyleLst>
          <a:lnStyleLst><a:ln w="9525" cap="flat"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="dash"/></a:ln></a:lnStyleLst>
          <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d/></a:effectStyle></a:effectStyleLst>
          <a:bgFillStyleLst><a:solidFill><a:sysClr val="window" lastClr="FFFFFF"/></a:solidFill></a:bgFillStyleLst>
          </a:fmtScheme></a:themeElements></a:theme>"#;
        let t = read_theme(xml, "t").unwrap();
        let f = &t.format;
        assert_eq!(f.fill_styles.len(), 3);
        let StyleFill::Gradient(g) = &f.fill_styles[1] else {
            panic!()
        };
        assert_eq!((g.angle_deg, g.rotate_with_shape), (90.0, true));
        assert_eq!(
            g.stops[0].color.mods,
            [
                ColorMod::LumMod(110_000),
                ColorMod::SatMod(105_000),
                ColorMod::Tint(67_000)
            ]
        );
        let StyleFill::Gradient(g) = &f.fill_styles[2] else {
            panic!()
        };
        assert_eq!(g.shape, GradientShape::Circle);
        assert_eq!(f.line_styles[0].width, Emu(9_525));
        assert_eq!(f.line_styles[0].dash, LineDash::Dash);
        assert!(f.effect_styles[0].shadow.is_none());
        let sh = f.effect_styles[1].shadow.as_ref().unwrap();
        assert_eq!((sh.blur, sh.direction_deg), (Emu(57_150), 90.0));
        assert_eq!(sh.color.mods, [ColorMod::Alpha(63_000)]);
        assert_eq!(
            f.bg_fill_styles[0],
            StyleFill::Solid(StyleColor::rgb(Rgb::WHITE, &[]))
        );
        // and what we write reads back the same
        assert_eq!(read_theme(&theme_xml(&t), "t").unwrap(), t);
        // no fmtScheme: the Office one
        let bare = br#"<a:theme xmlns:a="a" name="B"><a:themeElements/></a:theme>"#;
        assert_eq!(
            read_theme(bare, "t").unwrap().format,
            FormatScheme::office()
        );
    }
}
