//! Mapping of run, paragraph and table properties between
//! WordprocessingML (`w:rPr`, `w:pPr`, `w:tblPr`, …) and the model, both
//! directions.

use core_model::units::Twips;
use core_model::{
    Color, ColorScheme, FontFace, FontSize, Rgb, RunProperties, ThemeColorSlot, ThemeFontSlot,
    Underline, VerticalAlign,
};
use model_text::{
    Alignment, BorderSide, BorderStyle, CellMargins, Indent, LineSpacing, NumberingRef,
    ParagraphBorders, ParagraphProperties, Spacing, TabKind, TabLeader, TabStop, TableAlignment,
    TableBorders, TableLook, TableWidth,
};

use crate::xml::{parse_twips, parse_u32, toggle, El, WriteVal, XmlOut};
use crate::Warnings;

// --- colors -------------------------------------------------------------------

/// Word's 16 highlight colors (`w:highlight w:val`) and their RGB values.
pub const HIGHLIGHT_COLORS: [(&str, Rgb); 16] = [
    ("black", Rgb::new(0x00, 0x00, 0x00)),
    ("blue", Rgb::new(0x00, 0x00, 0xFF)),
    ("cyan", Rgb::new(0x00, 0xFF, 0xFF)),
    ("green", Rgb::new(0x00, 0xFF, 0x00)),
    ("magenta", Rgb::new(0xFF, 0x00, 0xFF)),
    ("red", Rgb::new(0xFF, 0x00, 0x00)),
    ("yellow", Rgb::new(0xFF, 0xFF, 0x00)),
    ("white", Rgb::new(0xFF, 0xFF, 0xFF)),
    ("darkBlue", Rgb::new(0x00, 0x00, 0x80)),
    ("darkCyan", Rgb::new(0x00, 0x80, 0x80)),
    ("darkGreen", Rgb::new(0x00, 0x80, 0x00)),
    ("darkMagenta", Rgb::new(0x80, 0x00, 0x80)),
    ("darkRed", Rgb::new(0x80, 0x00, 0x00)),
    ("darkYellow", Rgb::new(0x80, 0x80, 0x00)),
    ("darkGray", Rgb::new(0x80, 0x80, 0x80)),
    ("lightGray", Rgb::new(0xC0, 0xC0, 0xC0)),
];

/// RGB value of a named Word highlight color.
pub fn highlight_rgb(name: &str) -> Option<Rgb> {
    HIGHLIGHT_COLORS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, c)| *c)
}

/// Name of the Word highlight color with exactly this RGB value.
pub fn highlight_name(rgb: Rgb) -> Option<&'static str> {
    HIGHLIGHT_COLORS
        .iter()
        .find(|(_, c)| *c == rgb)
        .map(|(n, _)| *n)
}

/// The Word highlight color nearest to `rgb` (squared RGB distance; ties
/// go to the earlier entry of [`HIGHLIGHT_COLORS`]).
pub fn nearest_highlight(rgb: Rgb) -> (&'static str, Rgb) {
    let dist = |c: Rgb| {
        let d = |a: u8, b: u8| (i32::from(a) - i32::from(b)).pow(2);
        d(c.r, rgb.r) + d(c.g, rgb.g) + d(c.b, rgb.b)
    };
    HIGHLIGHT_COLORS
        .iter()
        .min_by_key(|(_, c)| dist(*c))
        .copied()
        .expect("non-empty table")
}

/// `w:themeTint` (hex byte) → model tint: `1 − v/255` (`99` → 0.4,
/// Word's "Lighter 60 %"; `33` → 0.8, "Lighter 80 %").
///
/// The result is snapped to two decimals when that value writes back as the
/// same byte (so `BF` reads as exactly −0.25, not −0.25098…).
pub fn theme_tint_to_tint(v: u8) -> f64 {
    snap(1.0 - f64::from(v) / 255.0)
}

/// `w:themeShade` (hex byte) → model tint: `−(1 − v/255)` (`BF` → −0.25,
/// Word's "Darker 25 %"). Snapped like [`theme_tint_to_tint`].
pub fn theme_shade_to_tint(v: u8) -> f64 {
    snap(-(1.0 - f64::from(v) / 255.0))
}

fn snap(t: f64) -> f64 {
    let rounded = (t * 100.0).round() / 100.0;
    if tint_to_theme_attr(rounded) == tint_to_theme_attr(t) {
        rounded
    } else {
        t
    }
}

/// Model tint → (`"themeTint"` | `"themeShade"`, hex byte); `None` for 0.
pub fn tint_to_theme_attr(tint: f64) -> Option<(&'static str, u8)> {
    if tint.is_nan() || tint == 0.0 {
        return None;
    }
    let t = tint.clamp(-1.0, 1.0);
    let byte = |f: f64| (f * 255.0).round().clamp(0.0, 255.0) as u8;
    Some(if t > 0.0 {
        ("themeTint", byte(1.0 - t))
    } else {
        ("themeShade", byte(1.0 + t))
    })
}

fn hex_byte(v: &str) -> Option<u8> {
    u8::from_str_radix(v.trim(), 16).ok()
}

/// `ST_ThemeColor` → slot.
fn theme_slot(name: &str) -> Option<ThemeColorSlot> {
    use ThemeColorSlot::*;
    Some(match name {
        "dark1" | "text1" => Dark1,
        "light1" | "background1" => Light1,
        "dark2" | "text2" => Dark2,
        "light2" | "background2" => Light2,
        "accent1" => Accent1,
        "accent2" => Accent2,
        "accent3" => Accent3,
        "accent4" => Accent4,
        "accent5" => Accent5,
        "accent6" => Accent6,
        "hyperlink" => Hyperlink,
        "followedHyperlink" => FollowedHyperlink,
        _ => return None,
    })
}

/// Slot → `ST_ThemeColor` as Word writes it.
fn theme_slot_name(slot: ThemeColorSlot) -> &'static str {
    use ThemeColorSlot::*;
    match slot {
        Dark1 => "text1",
        Light1 => "background1",
        Dark2 => "text2",
        Light2 => "background2",
        Accent1 => "accent1",
        Accent2 => "accent2",
        Accent3 => "accent3",
        Accent4 => "accent4",
        Accent5 => "accent5",
        Accent6 => "accent6",
        Hyperlink => "hyperlink",
        FollowedHyperlink => "followedHyperlink",
    }
}

/// Attribute names of a color: value, theme color, tint, shade.
struct ColorAttrs {
    val: &'static str,
    theme: &'static str,
    tint: &'static str,
    shade: &'static str,
}

const RUN_COLOR: ColorAttrs = ColorAttrs {
    val: "val",
    theme: "themeColor",
    tint: "themeTint",
    shade: "themeShade",
};
const BORDER_COLOR: ColorAttrs = ColorAttrs {
    val: "color",
    theme: "themeColor",
    tint: "themeTint",
    shade: "themeShade",
};
const SHD_FILL: ColorAttrs = ColorAttrs {
    val: "fill",
    theme: "themeFill",
    tint: "themeFillTint",
    shade: "themeFillShade",
};

fn read_color(el: &El, a: &ColorAttrs) -> Option<Color> {
    if let Some(slot) = el.attr(a.theme).and_then(theme_slot) {
        let tint = if let Some(v) = el.attr(a.shade).and_then(hex_byte) {
            theme_shade_to_tint(v)
        } else if let Some(v) = el.attr(a.tint).and_then(hex_byte) {
            theme_tint_to_tint(v)
        } else {
            0.0
        };
        return Some(Color::Theme { slot, tint });
    }
    match el.attr(a.val)?.trim() {
        "auto" => Some(Color::Auto),
        hex => Rgb::from_hex(hex).ok().map(Color::Rgb),
    }
}

/// Attributes for writing `color` (value with its RGB fallback for theme
/// colors).
fn color_attrs(color: &Color, scheme: &ColorScheme, a: &ColorAttrs) -> Vec<(&'static str, String)> {
    let mut out = vec![(a.val, color_hex(color, scheme))];
    if let Color::Theme { slot, tint } = *color {
        out.push((a.theme, theme_slot_name(slot).to_owned()));
        if let Some((kind, v)) = tint_to_theme_attr(tint) {
            let name = if kind == "themeTint" { a.tint } else { a.shade };
            out.push((name, format!("{v:02X}")));
        }
    }
    out
}

fn color_hex(color: &Color, scheme: &ColorScheme) -> String {
    match color {
        Color::Auto => "auto".to_owned(),
        c => c.resolve(scheme, Rgb::BLACK).to_hex(),
    }
}

fn attrs_ref<'a>(v: &'a [(&'a str, String)]) -> Vec<(&'a str, &'a str)> {
    v.iter().map(|(k, v)| (*k, v.as_str())).collect()
}

// --- fonts --------------------------------------------------------------------

fn theme_font_slot(name: &str) -> Option<ThemeFontSlot> {
    use ThemeFontSlot::*;
    Some(match name {
        "majorAscii" | "majorHAnsi" => MajorLatin,
        "minorAscii" | "minorHAnsi" => MinorLatin,
        "majorEastAsia" => MajorEastAsian,
        "minorEastAsia" => MinorEastAsian,
        "majorBidi" => MajorComplexScript,
        "minorBidi" => MinorComplexScript,
        _ => return None,
    })
}

fn theme_font_name(slot: ThemeFontSlot) -> &'static str {
    use ThemeFontSlot::*;
    match slot {
        MajorLatin => "majorHAnsi",
        MinorLatin => "minorHAnsi",
        MajorEastAsian => "majorEastAsia",
        MinorEastAsian => "minorEastAsia",
        MajorComplexScript => "majorBidi",
        MinorComplexScript => "minorBidi",
    }
}

/// `w:rFonts` → font face (theme attributes take precedence, as in Word).
pub(crate) fn read_fonts(el: &El) -> Option<FontFace> {
    let named = |a: &str| {
        el.attr(a)
            .filter(|s| !s.is_empty())
            .map(|s| FontFace::Named(s.to_owned()))
    };
    let themed = |a: &str| el.attr(a).and_then(theme_font_slot).map(FontFace::Theme);
    themed("asciiTheme")
        .or_else(|| named("ascii"))
        .or_else(|| themed("hAnsiTheme"))
        .or_else(|| named("hAnsi"))
}

pub(crate) fn write_fonts(x: &mut XmlOut, font: &FontFace, hint: bool) {
    let mut attrs: Vec<(&str, &str)> = match font {
        FontFace::Named(n) => vec![("w:ascii", n), ("w:hAnsi", n)],
        FontFace::Theme(slot) => {
            let n = theme_font_name(*slot);
            vec![("w:asciiTheme", n), ("w:hAnsiTheme", n)]
        }
    };
    if hint {
        attrs.push(("w:hint", "default"));
    }
    x.empty("w:rFonts", &attrs);
}

// --- run properties -----------------------------------------------------------

fn underline_of(v: &str) -> Option<Underline> {
    Some(match v {
        "none" => Underline::None,
        "single" | "words" | "thick" => Underline::Single,
        "double" => Underline::Double,
        "dotted" | "dottedHeavy" => Underline::Dotted,
        "dash" | "dashedHeavy" | "dashLong" | "dashLongHeavy" | "dotDash" | "dashDotHeavy"
        | "dotDotDash" | "dashDotDotHeavy" => Underline::Dashed,
        "wave" | "wavyHeavy" | "wavyDouble" => Underline::Wavy,
        _ => return None,
    })
}

fn underline_name(u: Underline) -> &'static str {
    match u {
        Underline::None => "none",
        Underline::Single => "single",
        Underline::Double => "double",
        Underline::Dotted => "dotted",
        Underline::Dashed => "dash",
        Underline::Wavy => "wave",
    }
}

/// `w:rPr` children that are dropped silently: complex-script twins of
/// modelled properties and properties without visible effect.
const SILENT_RPR: &[&str] = &[
    "bCs",
    "iCs",
    "szCs",
    "lang",
    "kern",
    "noProof",
    "webHidden",
    "snapToGrid",
    "rPrChange",
    "specVanish",
    "oMath",
];

/// `w:rPr` → run properties. `ctx` names the location in warnings.
pub(crate) fn read_rpr(rpr: &El, ctx: &str, w: &mut Warnings) -> RunProperties {
    let mut p = RunProperties::default();
    let mut shd_highlight: Option<Color> = None;
    for el in rpr.elements() {
        match el.name.as_str() {
            "rFonts" => p.font = read_fonts(el).or(p.font.take()),
            "b" => p.bold = Some(toggle(el)),
            "i" => p.italic = Some(toggle(el)),
            "strike" => p.strike = Some(toggle(el)),
            "dstrike" => {
                if toggle(el) {
                    w.add(format!("{ctx}: double strikethrough read as single"));
                    p.strike = Some(true);
                } else if p.strike.is_none() {
                    p.strike = Some(false);
                }
            }
            "color" => p.color = read_color(el, &RUN_COLOR),
            "sz" => p.size = el.val().and_then(parse_u32).map(FontSize::from_half_points),
            "highlight" => {
                p.highlight = match el.val() {
                    Some("none") => Some(Color::Auto),
                    Some(name) => highlight_rgb(name).map(Color::Rgb).or_else(|| {
                        w.add(format!("{ctx}: unknown highlight color {name:?} dropped"));
                        None
                    }),
                    None => None,
                }
            }
            "shd" => {
                let fill = read_color(el, &SHD_FILL);
                match fill {
                    Some(Color::Auto) | None => {}
                    Some(c) => {
                        let rgb = c.resolve(&ColorScheme::default(), Rgb::WHITE);
                        let (_, near) = nearest_highlight(rgb);
                        if near != rgb {
                            w.add(format!(
                                "{ctx}: run shading {} approximated by highlight {}",
                                rgb.to_hex(),
                                near.to_hex()
                            ));
                        }
                        shd_highlight = Some(Color::Rgb(near));
                    }
                }
            }
            "u" => {
                p.underline = match el.val() {
                    None => Some(Underline::Single),
                    Some(v) => underline_of(v).or_else(|| {
                        w.add(format!("{ctx}: underline style {v:?} read as single"));
                        Some(Underline::Single)
                    }),
                };
            }
            "vertAlign" => {
                p.vertical_align = match el.val() {
                    Some("superscript") => Some(VerticalAlign::Superscript),
                    Some("subscript") => Some(VerticalAlign::Subscript),
                    Some("baseline") => Some(VerticalAlign::Baseline),
                    _ => None,
                }
            }
            "rtl" | "cs" => {
                if toggle(el) {
                    w.add(format!("{ctx}: right-to-left run formatting dropped"));
                }
            }
            name if SILENT_RPR.contains(&name) => {}
            _ => w.add(format!("{ctx}: run property {} dropped", el.qname())),
        }
    }
    if p.highlight.is_none() {
        p.highlight = shd_highlight;
    }
    p
}

/// Writes `<w:rPr>` (nothing if `p` is empty) in Word's element order.
pub(crate) fn write_rpr(x: &mut XmlOut, p: &RunProperties, scheme: &ColorScheme) {
    write_rpr_styled(x, p, scheme, None);
}

/// [`write_rpr`] with a character style reference (`w:rStyle`) first.
pub(crate) fn write_rpr_styled(
    x: &mut XmlOut,
    p: &RunProperties,
    scheme: &ColorScheme,
    style: Option<&str>,
) {
    if p.is_empty() && style.is_none() {
        return;
    }
    x.start("w:rPr", &[]);
    if let Some(s) = style {
        x.val("w:rStyle", s);
    }
    if let Some(font) = &p.font {
        write_fonts(x, font, false);
    }
    if let Some(b) = p.bold {
        toggle_el(x, "w:b", b);
        toggle_el(x, "w:bCs", b);
    }
    if let Some(i) = p.italic {
        toggle_el(x, "w:i", i);
        toggle_el(x, "w:iCs", i);
    }
    if let Some(s) = p.strike {
        toggle_el(x, "w:strike", s);
    }
    if let Some(c) = &p.color {
        let attrs = prefixed(color_attrs(c, scheme, &RUN_COLOR));
        x.empty("w:color", &attrs_ref(&attrs));
    }
    if let Some(sz) = p.size {
        let v = sz.half_points().to_string();
        x.val("w:sz", &v);
        x.val("w:szCs", &v);
    }
    if let Some(h) = &p.highlight {
        let name = match h {
            Color::Auto => "none",
            c => nearest_highlight(c.resolve(scheme, Rgb::WHITE)).0,
        };
        x.val("w:highlight", name);
    }
    if let Some(u) = p.underline {
        x.val("w:u", underline_name(u));
    }
    if let Some(v) = p.vertical_align {
        x.val(
            "w:vertAlign",
            match v {
                VerticalAlign::Baseline => "baseline",
                VerticalAlign::Superscript => "superscript",
                VerticalAlign::Subscript => "subscript",
            },
        );
    }
    x.end("w:rPr");
}

fn prefixed(v: Vec<(&'static str, String)>) -> Vec<(&'static str, String)> {
    v.into_iter()
        .map(|(k, val)| (w_attr(k), val))
        .collect::<Vec<_>>()
}

/// `name` → `w:name` for the fixed attribute names used here.
fn w_attr(name: &str) -> &'static str {
    match name {
        "val" => "w:val",
        "color" => "w:color",
        "fill" => "w:fill",
        "themeColor" => "w:themeColor",
        "themeTint" => "w:themeTint",
        "themeShade" => "w:themeShade",
        "themeFill" => "w:themeFill",
        "themeFillTint" => "w:themeFillTint",
        "themeFillShade" => "w:themeFillShade",
        other => unreachable!("unexpected attribute {other}"),
    }
}

/// A toggle element: `<w:b/>` for true, `<w:b w:val="0"/>` for false.
fn toggle_el(x: &mut XmlOut, name: &str, on: bool) {
    if on {
        x.empty(name, &[]);
    } else {
        x.val(name, "0");
    }
}

// --- paragraph properties -----------------------------------------------------

/// `w:pPr` children that are dropped silently (no visible effect in our
/// layout, or defaults).
const SILENT_PPR: &[&str] = &[
    "widowControl",
    "suppressAutoHyphens",
    "suppressLineNumbers",
    "outlineLvl",
    "snapToGrid",
    "autoSpaceDE",
    "autoSpaceDN",
    "adjustRightInd",
    "kinsoku",
    "wordWrap",
    "overflowPunct",
    "topLinePunct",
    "cnfStyle",
    "divId",
    "pPrChange",
    "textAlignment",
];

fn read_spacing(el: &El, ctx: &str, w: &mut Warnings) -> Option<Spacing> {
    let tw = |a: &str| el.attr(a).and_then(parse_twips).map(Twips);
    let line = el.attr("line").and_then(parse_twips).map(|v| {
        match el.attr("lineRule").unwrap_or("auto") {
            "exact" => LineSpacing::Exact(Twips(v)),
            "atLeast" => LineSpacing::AtLeast(Twips(v)),
            _ => LineSpacing::from_240ths(v),
        }
    });
    for a in ["beforeAutospacing", "afterAutospacing"] {
        if el.attr(a).and_then(crate::xml::parse_bool) == Some(true) {
            w.add(format!("{ctx}: automatic paragraph spacing dropped"));
        }
    }
    for a in ["beforeLines", "afterLines"] {
        if el.attr(a).is_some() {
            w.add(format!("{ctx}: paragraph spacing in lines dropped"));
        }
    }
    let s = Spacing {
        before: tw("before"),
        after: tw("after"),
        line,
    };
    (!s.is_empty()).then_some(s)
}

fn read_indent(el: &El, ctx: &str, w: &mut Warnings) -> Option<Indent> {
    let tw = |a: &str| el.attr(a).and_then(parse_twips).map(Twips);
    let hanging = tw("hanging");
    let ind = Indent {
        left: tw("left").or_else(|| tw("start")),
        right: tw("right").or_else(|| tw("end")),
        first_line: if hanging.is_some() {
            None
        } else {
            tw("firstLine")
        },
        hanging,
    };
    if el.attrs.iter().any(|(k, _)| k.ends_with("Chars")) {
        w.add(format!("{ctx}: indentation in characters dropped"));
    }
    (!ind.is_empty()).then_some(ind)
}

pub(crate) fn read_jc(v: &str, ctx: &str, w: &mut Warnings) -> Option<Alignment> {
    Some(match v {
        "left" | "start" => Alignment::Left,
        "center" => Alignment::Center,
        "right" | "end" => Alignment::Right,
        "both" | "distribute" => Alignment::Justify,
        "lowKashida" | "mediumKashida" | "highKashida" | "thaiDistribute" => {
            w.add(format!("{ctx}: alignment {v:?} read as justify"));
            Alignment::Justify
        }
        _ => {
            w.add(format!("{ctx}: alignment {v:?} dropped"));
            return None;
        }
    })
}

/// `w:numPr` → numbering reference.
fn read_numpr(el: &El) -> Option<NumberingRef> {
    let num_id = el.child("numId")?.val().and_then(parse_u32)?;
    let level = el
        .child("ilvl")
        .and_then(El::val)
        .and_then(parse_u32)
        .unwrap_or(0)
        .min(8) as u8;
    Some(NumberingRef { num_id, level })
}

/// `w:pPr` → paragraph properties.
///
/// In a right-to-left (`w:bidi`) paragraph `left`/`right` are logical
/// (start/end); since the direction is dropped, the alignment is mirrored
/// so the paragraph keeps its visual alignment.
pub(crate) fn read_ppr(ppr: &El, ctx: &str, w: &mut Warnings) -> ParagraphProperties {
    let mut p = ParagraphProperties::default();
    let mut bidi = false;
    for el in ppr.elements() {
        match el.name.as_str() {
            "pStyle" => p.style = el.val().map(str::to_owned),
            "keepNext" => p.keep_next = Some(toggle(el)),
            "pageBreakBefore" => p.page_break_before = Some(toggle(el)),
            "numPr" => {
                if el.child("ins").is_some() {
                    w.add(format!("{ctx}: numbering change tracking dropped"));
                }
                p.numbering = read_numpr(el);
            }
            "spacing" => p.spacing = read_spacing(el, ctx, w),
            "ind" => p.indent = read_indent(el, ctx, w),
            "jc" => p.alignment = el.val().and_then(|v| read_jc(v, ctx, w)),
            "rPr" => {
                let r = read_rpr(el, ctx, w);
                p.run_defaults = (!r.is_empty()).then_some(r);
            }
            "bidi" => {
                if toggle(el) {
                    bidi = true;
                    w.add(format!("{ctx}: right-to-left paragraph direction dropped"));
                }
            }
            "tabs" => p.tabs = read_tabs(el, ctx, w),
            "pBdr" => p.borders = read_pbdr(el, ctx, w),
            "shd" => p.shading = read_shading(el),
            // Section breaks are read by the body reader.
            "sectPr" => {}
            name if SILENT_PPR.contains(&name) => {}
            _ => w.add(format!("{ctx}: paragraph property {} dropped", el.qname())),
        }
    }
    if bidi {
        p.alignment = p.alignment.map(|a| match a {
            Alignment::Left => Alignment::Right,
            Alignment::Right => Alignment::Left,
            other => other,
        });
    }
    p
}

/// Writes `<w:pPr>` (nothing if empty) in Word's element order.
pub(crate) fn write_ppr(x: &mut XmlOut, p: &ParagraphProperties, scheme: &ColorScheme) {
    write_ppr_sect(x, p, scheme, None);
}

/// [`write_ppr`] with a section break: `sect` is a serialized `w:sectPr`
/// written last. (`section_end` itself is not written: the caller decides
/// whether it names a section.)
pub(crate) fn write_ppr_sect(
    x: &mut XmlOut,
    p: &ParagraphProperties,
    scheme: &ColorScheme,
    sect: Option<&[u8]>,
) {
    let mut probe = p.clone();
    probe.section_end = None;
    if probe
        .run_defaults
        .as_ref()
        .is_some_and(RunProperties::is_empty)
    {
        probe.run_defaults = None;
    }
    if probe.is_empty() && sect.is_none() {
        return;
    }
    x.start("w:pPr", &[]);
    if let Some(s) = &p.style {
        x.val("w:pStyle", s);
    }
    if let Some(k) = p.keep_next {
        toggle_el(x, "w:keepNext", k);
    }
    if let Some(k) = p.page_break_before {
        toggle_el(x, "w:pageBreakBefore", k);
    }
    if let Some(n) = p.numbering {
        x.start("w:numPr", &[]);
        x.val("w:ilvl", &n.level.to_string());
        x.val("w:numId", &n.num_id.to_string());
        x.end("w:numPr");
    }
    if let Some(b) = &p.borders {
        write_pbdr(x, b, scheme);
    }
    if let Some(c) = &p.shading {
        write_shading(x, c, scheme);
    }
    write_tabs(x, &p.tabs);
    if let Some(s) = &p.spacing {
        write_spacing(x, s);
    }
    if let Some(i) = &p.indent {
        write_indent(x, i);
    }
    if let Some(a) = p.alignment {
        x.val(
            "w:jc",
            match a {
                Alignment::Left => "left",
                Alignment::Center => "center",
                Alignment::Right => "right",
                Alignment::Justify => "both",
            },
        );
    }
    if let Some(r) = &p.run_defaults {
        write_rpr(x, r, scheme);
    }
    if let Some(sect) = sect {
        x.raw(sect);
    }
    x.end("w:pPr");
}

fn write_spacing(x: &mut XmlOut, s: &Spacing) {
    if s.is_empty() {
        return;
    }
    let mut attrs: Vec<(&str, String)> = Vec::new();
    if let Some(b) = s.before {
        attrs.push(("w:before", b.0.to_string()));
    }
    if let Some(a) = s.after {
        attrs.push(("w:after", a.0.to_string()));
    }
    match s.line {
        Some(LineSpacing::Multiple(m)) => {
            attrs.push(("w:line", ((m * 240.0).round() as i64).to_string()));
            attrs.push(("w:lineRule", "auto".into()));
        }
        Some(LineSpacing::Exact(t)) => {
            attrs.push(("w:line", t.0.to_string()));
            attrs.push(("w:lineRule", "exact".into()));
        }
        Some(LineSpacing::AtLeast(t)) => {
            attrs.push(("w:line", t.0.to_string()));
            attrs.push(("w:lineRule", "atLeast".into()));
        }
        None => {}
    }
    x.empty("w:spacing", &attrs_ref(&attrs));
}

/// Writes `<w:ind>` (nothing if empty). `hanging` wins over `first_line`.
pub(crate) fn write_indent(x: &mut XmlOut, i: &Indent) {
    if i.is_empty() {
        return;
    }
    let mut attrs: Vec<(&str, String)> = Vec::new();
    if let Some(l) = i.left {
        attrs.push(("w:left", l.0.to_string()));
    }
    if let Some(r) = i.right {
        attrs.push(("w:right", r.0.to_string()));
    }
    if let Some(h) = i.hanging {
        attrs.push(("w:hanging", h.0.to_string()));
    } else if let Some(f) = i.first_line {
        attrs.push(("w:firstLine", f.0.to_string()));
    }
    x.empty("w:ind", &attrs_ref(&attrs));
}

/// `w:pBdr` → paragraph borders.
fn read_pbdr(el: &El, ctx: &str, w: &mut Warnings) -> Option<ParagraphBorders> {
    let mut b = ParagraphBorders::default();
    for side in el.elements() {
        let slot = match side.name.as_str() {
            "top" => &mut b.top,
            "left" | "start" => &mut b.left,
            "bottom" => &mut b.bottom,
            "right" | "end" => &mut b.right,
            "between" => &mut b.between,
            _ => {
                w.add(format!("{ctx}: paragraph border {} dropped", side.qname()));
                continue;
            }
        };
        *slot = Some(read_border_side(side, ctx, w));
    }
    (!b.is_empty()).then_some(b)
}

fn write_pbdr(x: &mut XmlOut, b: &ParagraphBorders, scheme: &ColorScheme) {
    let sides = [
        ("w:top", b.top),
        ("w:left", b.left),
        ("w:bottom", b.bottom),
        ("w:right", b.right),
        ("w:between", b.between),
    ];
    write_sides(x, "w:pBdr", &sides, scheme);
}

/// `w:tabs` → tab stops (sorted by position).
fn read_tabs(el: &El, ctx: &str, w: &mut Warnings) -> Vec<TabStop> {
    let mut out: Vec<TabStop> = Vec::new();
    for t in el.elements().filter(|t| t.name == "tab") {
        let Some(pos) = t.attr("pos").and_then(parse_twips) else {
            continue;
        };
        let kind = match t.val().unwrap_or("left") {
            "left" | "start" => TabKind::Left,
            "center" => TabKind::Center,
            "right" | "end" => TabKind::Right,
            "decimal" => TabKind::Decimal,
            "bar" => TabKind::Bar,
            "clear" => TabKind::Clear,
            other => {
                w.add(format!("{ctx}: tab stop kind {other:?} read as left"));
                TabKind::Left
            }
        };
        let leader = match t.attr("leader").unwrap_or("none") {
            "dot" => TabLeader::Dot,
            "hyphen" => TabLeader::Hyphen,
            "underscore" => TabLeader::Underscore,
            "heavy" => {
                w.add(format!("{ctx}: heavy tab leader read as underscore"));
                TabLeader::Underscore
            }
            "middleDot" => {
                w.add(format!("{ctx}: middle-dot tab leader read as dots"));
                TabLeader::Dot
            }
            _ => TabLeader::None,
        };
        model_text::props::merge_tabs(
            &mut out,
            &[TabStop {
                pos: Twips(pos),
                kind,
                leader,
            }],
        );
    }
    out
}

fn write_tabs(x: &mut XmlOut, tabs: &[TabStop]) {
    if tabs.is_empty() {
        return;
    }
    x.start("w:tabs", &[]);
    for t in tabs {
        let kind = match t.kind {
            TabKind::Left => "left",
            TabKind::Center => "center",
            TabKind::Right => "right",
            TabKind::Decimal => "decimal",
            TabKind::Bar => "bar",
            TabKind::Clear => "clear",
        };
        let pos = t.pos.0.to_string();
        let mut attrs = vec![("w:val", kind)];
        let leader = match t.leader {
            TabLeader::None => None,
            TabLeader::Dot => Some("dot"),
            TabLeader::Hyphen => Some("hyphen"),
            TabLeader::Underscore => Some("underscore"),
        };
        if let Some(l) = leader {
            attrs.push(("w:leader", l));
        }
        attrs.push(("w:pos", &pos));
        x.empty("w:tab", &attrs);
    }
    x.end("w:tabs");
}

/// `w:ind` of a numbering level or style (no warnings context needed).
pub(crate) fn read_indent_quiet(el: &El) -> Option<Indent> {
    read_indent(el, "", &mut Warnings::default())
}

// --- tables -------------------------------------------------------------------

/// `w:tblW` / `w:tcW` → width. `nil` and unknown types → `None`.
pub(crate) fn read_width(el: &El) -> Option<TableWidth> {
    let w = el.attr("w").unwrap_or("0");
    match el.attr("type").unwrap_or("dxa") {
        "auto" => Some(TableWidth::Auto),
        "pct" => {
            let pct = match w.trim().strip_suffix('%') {
                Some(p) => p.trim().parse::<f64>().ok()? * 50.0,
                None => w.trim().parse::<f64>().ok()?,
            };
            Some(TableWidth::Pct(
                pct.round().clamp(0.0, f64::from(u16::MAX)) as u16
            ))
        }
        "dxa" => parse_twips(w).map(|t| TableWidth::Twips(Twips(t))),
        _ => None,
    }
}

pub(crate) fn write_width(x: &mut XmlOut, name: &str, width: TableWidth) {
    let (w, t) = match width {
        TableWidth::Auto => ("0".to_owned(), "auto"),
        TableWidth::Twips(t) => (t.0.to_string(), "dxa"),
        TableWidth::Pct(p) => (p.to_string(), "pct"),
    };
    x.empty(name, &[("w:w", &w), ("w:type", t)]);
}

fn border_style(v: &str, ctx: &str, w: &mut Warnings) -> BorderStyle {
    match v {
        "single" => BorderStyle::Single,
        "double" => BorderStyle::Double,
        "dashed" | "dashSmallGap" | "dotDash" | "dotDotDash" | "dashDotStroked" => {
            BorderStyle::Dashed
        }
        "dotted" => BorderStyle::Dotted,
        "thick" => BorderStyle::Thick,
        "nil" | "none" => BorderStyle::None,
        other => {
            w.add(format!("{ctx}: border style {other:?} read as single"));
            BorderStyle::Single
        }
    }
}

fn border_style_name(s: BorderStyle) -> &'static str {
    match s {
        BorderStyle::Single => "single",
        BorderStyle::Double => "double",
        BorderStyle::Dashed => "dashed",
        BorderStyle::Dotted => "dotted",
        BorderStyle::Thick => "thick",
        BorderStyle::None => "nil",
    }
}

fn read_border_side(el: &El, ctx: &str, w: &mut Warnings) -> BorderSide {
    BorderSide {
        style: border_style(el.val().unwrap_or("single"), ctx, w),
        width: BorderSide::width_from_eighths(el.attr("sz").and_then(parse_u32).unwrap_or(0)),
        color: read_color(el, &BORDER_COLOR).unwrap_or(Color::Auto),
        space: el
            .attr("space")
            .and_then(parse_u32)
            .filter(|&v| v > 0)
            .map(|v| v.min(31) as u8),
    }
}

/// `w:tblBorders` / `w:tcBorders` → borders.
pub(crate) fn read_borders(el: &El, ctx: &str, w: &mut Warnings) -> Option<TableBorders> {
    let mut b = TableBorders::default();
    for side in el.elements() {
        let slot = match side.name.as_str() {
            "top" => &mut b.top,
            "left" | "start" => &mut b.left,
            "bottom" => &mut b.bottom,
            "right" | "end" => &mut b.right,
            "insideH" => &mut b.inside_h,
            "insideV" => &mut b.inside_v,
            _ => {
                w.add(format!("{ctx}: border {} dropped", side.qname()));
                continue;
            }
        };
        *slot = Some(read_border_side(side, ctx, w));
    }
    (b != TableBorders::default()).then_some(b)
}

pub(crate) fn write_borders(x: &mut XmlOut, name: &str, b: &TableBorders, scheme: &ColorScheme) {
    let sides = [
        ("w:top", b.top),
        ("w:left", b.left),
        ("w:bottom", b.bottom),
        ("w:right", b.right),
        ("w:insideH", b.inside_h),
        ("w:insideV", b.inside_v),
    ];
    write_sides(x, name, &sides, scheme);
}

/// Writes `<name>` with one element per set side (nothing if none is set).
fn write_sides(
    x: &mut XmlOut,
    name: &str,
    sides: &[(&str, Option<BorderSide>)],
    scheme: &ColorScheme,
) {
    if sides.iter().all(|(_, s)| s.is_none()) {
        return;
    }
    x.start(name, &[]);
    for (n, side) in sides {
        let Some(s) = side else { continue };
        let mut attrs = vec![
            ("w:val", border_style_name(s.style).to_owned()),
            ("w:sz", s.width_eighths().to_string()),
            ("w:space", s.space.unwrap_or(0).to_string()),
        ];
        attrs.extend(prefixed(color_attrs(&s.color, scheme, &BORDER_COLOR)));
        x.empty(n, &attrs_ref(&attrs));
    }
    x.end(name);
}

/// `w:tblCellMar` → cell margins.
pub(crate) fn read_cell_margins(el: &El) -> Option<CellMargins> {
    let mut m = CellMargins::default();
    for side in el.elements() {
        let v = match read_width(side) {
            Some(TableWidth::Twips(t)) => Some(t),
            _ => None,
        };
        match side.name.as_str() {
            "top" => m.top = v,
            "left" | "start" => m.left = v,
            "bottom" => m.bottom = v,
            "right" | "end" => m.right = v,
            _ => {}
        }
    }
    (m != CellMargins::default()).then_some(m)
}

pub(crate) fn write_cell_margins(x: &mut XmlOut, m: &CellMargins) {
    write_margins_as(x, "w:tblCellMar", m);
}

/// `w:jc` of a table → alignment.
pub(crate) fn read_table_jc(v: &str) -> Option<TableAlignment> {
    match v {
        "left" | "start" => Some(TableAlignment::Left),
        "center" => Some(TableAlignment::Center),
        "right" | "end" => Some(TableAlignment::Right),
        _ => None,
    }
}

pub(crate) fn table_jc_name(a: TableAlignment) -> &'static str {
    match a {
        TableAlignment::Left => "left",
        TableAlignment::Center => "center",
        TableAlignment::Right => "right",
    }
}

/// `w:tblLook`: the explicit attributes, else the `w:val` bit mask.
pub(crate) fn read_tbl_look(el: &El) -> TableLook {
    let mask = el
        .val()
        .and_then(|v| u32::from_str_radix(v.trim(), 16).ok())
        .unwrap_or(0);
    let flag = |name: &str, bit: u32| {
        el.attr(name)
            .and_then(crate::xml::parse_bool)
            .unwrap_or(mask & bit != 0)
    };
    TableLook {
        first_row: flag("firstRow", 0x0020),
        last_row: flag("lastRow", 0x0040),
        first_col: flag("firstColumn", 0x0080),
        last_col: flag("lastColumn", 0x0100),
        banded_rows: !flag("noHBand", 0x0200),
        banded_cols: !flag("noVBand", 0x0400),
    }
}

/// Writes `w:tblLook` as Word does (mask plus attributes).
pub(crate) fn write_tbl_look(x: &mut XmlOut, l: &TableLook) {
    let mut mask = 0u32;
    for (on, bit) in [
        (l.first_row, 0x0020),
        (l.last_row, 0x0040),
        (l.first_col, 0x0080),
        (l.last_col, 0x0100),
        (!l.banded_rows, 0x0200),
        (!l.banded_cols, 0x0400),
    ] {
        if on {
            mask |= bit;
        }
    }
    let b = |v: bool| if v { "1" } else { "0" };
    let val = format!("{mask:04X}");
    x.empty(
        "w:tblLook",
        &[
            ("w:val", val.as_str()),
            ("w:firstRow", b(l.first_row)),
            ("w:lastRow", b(l.last_row)),
            ("w:firstColumn", b(l.first_col)),
            ("w:lastColumn", b(l.last_col)),
            ("w:noHBand", b(!l.banded_rows)),
            ("w:noVBand", b(!l.banded_cols)),
        ],
    );
}

/// `w:tcMar` / `w:tblCellMar` element name for writing.
pub(crate) fn write_margins_as(x: &mut XmlOut, name: &str, m: &CellMargins) {
    let sides = [
        ("w:top", m.top),
        ("w:left", m.left),
        ("w:bottom", m.bottom),
        ("w:right", m.right),
    ];
    if sides.iter().all(|(_, s)| s.is_none()) {
        return;
    }
    x.start(name, &[]);
    for (n, v) in sides {
        if let Some(t) = v {
            write_width(x, n, TableWidth::Twips(t));
        }
    }
    x.end(name);
}

/// `w:shd` of a cell → background color (`auto` / missing fill → `None`).
pub(crate) fn read_shading(el: &El) -> Option<Color> {
    match read_color(el, &SHD_FILL)? {
        Color::Auto => None,
        c => Some(c),
    }
}

pub(crate) fn write_shading(x: &mut XmlOut, c: &Color, scheme: &ColorScheme) {
    if matches!(c, Color::Auto) {
        return;
    }
    let mut attrs = vec![
        ("w:val", "clear".to_owned()),
        ("w:color", "auto".to_owned()),
    ];
    attrs.extend(prefixed(color_attrs(c, scheme, &SHD_FILL)));
    x.empty("w:shd", &attrs_ref(&attrs));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;
    use model_text::{TabKind, TabLeader};

    fn el(xml: &str) -> El {
        parse(xml.as_bytes(), "test").unwrap()
    }

    fn out(f: impl FnOnce(&mut XmlOut)) -> String {
        let mut x = XmlOut::new();
        f(&mut x);
        let s = String::from_utf8(x.finish()).unwrap();
        s[fmt_ooxml::xml::DECLARATION.len()..].to_owned()
    }

    #[test]
    fn theme_tint_and_shade() {
        // Word's palette: themeTint 99 = "Lighter 60 %" (L' = 0.6 L + 0.4),
        // 66 = "Lighter 40 %", 33 = "Lighter 80 %"; themeShade BF = "Darker 25 %".
        assert!((theme_tint_to_tint(0x99) - 0.4).abs() < 1e-12);
        assert!((theme_tint_to_tint(0x66) - 0.6).abs() < 1e-12);
        assert!((theme_tint_to_tint(0x33) - 0.8).abs() < 1e-12);
        assert_eq!(theme_shade_to_tint(0xBF), -0.25);
        assert_eq!(theme_shade_to_tint(0x80), -0.5);
        assert_eq!(theme_tint_to_tint(0x99), 0.4);
        assert_eq!(tint_to_theme_attr(0.4), Some(("themeTint", 0x99)));
        assert_eq!(tint_to_theme_attr(0.6), Some(("themeTint", 0x66)));
        assert_eq!(tint_to_theme_attr(-0.25), Some(("themeShade", 0xBF)));
        assert_eq!(tint_to_theme_attr(0.0), None);
        for v in 0..=255u8 {
            let t = theme_tint_to_tint(v);
            if v != 255 {
                assert_eq!(tint_to_theme_attr(t), Some(("themeTint", v)));
            }
            let s = theme_shade_to_tint(v);
            if v != 255 {
                assert_eq!(tint_to_theme_attr(s), Some(("themeShade", v)));
            }
        }
        // Resolved colors match Word's: accent1 4472C4 lighter 60 % = 8EAADB,
        // darker 25 % = 2F5496.
        let scheme = ColorScheme::default();
        let c = read_color(
            &el(r#"<w:color w:val="8EAADB" w:themeColor="accent1" w:themeTint="99"/>"#),
            &RUN_COLOR,
        )
        .unwrap();
        let close = |a: Rgb, hex: &str| {
            let b = Rgb::from_hex(hex).unwrap();
            a.r.abs_diff(b.r) <= 2 && a.g.abs_diff(b.g) <= 2 && a.b.abs_diff(b.b) <= 2
        };
        assert!(close(c.resolve(&scheme, Rgb::BLACK), "8EAADB"));
        let c = read_color(
            &el(r#"<w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/>"#),
            &RUN_COLOR,
        )
        .unwrap();
        assert!(close(c.resolve(&scheme, Rgb::BLACK), "2F5496"));
    }

    #[test]
    fn highlight_nearest() {
        assert_eq!(nearest_highlight(Rgb::new(0xFF, 0xFF, 0x00)).0, "yellow");
        assert_eq!(nearest_highlight(Rgb::new(0xF0, 0xF0, 0x10)).0, "yellow");
        assert_eq!(nearest_highlight(Rgb::new(0x00, 0x70, 0x00)).0, "darkGreen");
        assert_eq!(nearest_highlight(Rgb::new(0xBB, 0xBB, 0xBB)).0, "lightGray");
        assert_eq!(nearest_highlight(Rgb::new(0x10, 0x10, 0x10)).0, "black");
        for (name, rgb) in HIGHLIGHT_COLORS {
            assert_eq!(nearest_highlight(rgb).0, name);
            assert_eq!(highlight_rgb(name), Some(rgb));
            assert_eq!(highlight_name(rgb), Some(name));
        }
    }

    #[test]
    fn run_props_both_directions() {
        let mut w = Warnings::default();
        let rpr = el(
            r#"<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:i w:val="0"/>
            <w:strike/><w:color w:val="C00000"/><w:sz w:val="36"/><w:u w:val="single"/>
            <w:shd w:fill="FFFF00" w:val="clear"/><w:vertAlign w:val="superscript"/><w:lang w:val="en-US"/></w:rPr>"#,
        );
        let p = read_rpr(&rpr, "t", &mut w);
        assert!(w.into_vec().is_empty());
        assert_eq!(p.font, Some(FontFace::from("Georgia")));
        assert_eq!(p.bold, Some(true));
        assert_eq!(p.italic, Some(false));
        assert_eq!(p.strike, Some(true));
        assert_eq!(p.color, Some(Color::Rgb(Rgb::new(0xC0, 0, 0))));
        assert_eq!(p.size, Some(FontSize::from_pt(18.0)));
        assert_eq!(p.underline, Some(Underline::Single));
        assert_eq!(p.highlight, Some(Color::Rgb(Rgb::new(0xFF, 0xFF, 0))));
        assert_eq!(p.vertical_align, Some(VerticalAlign::Superscript));

        let xml = out(|x| write_rpr(x, &p, &ColorScheme::default()));
        assert_eq!(
            xml,
            "<w:rPr><w:rFonts w:ascii=\"Georgia\" w:hAnsi=\"Georgia\"/><w:b/><w:bCs/>\
<w:i w:val=\"0\"/><w:iCs w:val=\"0\"/><w:strike/><w:color w:val=\"C00000\"/>\
<w:sz w:val=\"36\"/><w:szCs w:val=\"36\"/><w:highlight w:val=\"yellow\"/><w:u w:val=\"single\"/>\
<w:vertAlign w:val=\"superscript\"/></w:rPr>"
        );
        let back = read_rpr(&el(&xml), "t", &mut Warnings::default());
        assert_eq!(back, p);

        // theme font and theme color with shade
        let p = RunProperties {
            font: Some(FontFace::Theme(ThemeFontSlot::MajorLatin)),
            color: Some(Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: theme_shade_to_tint(0xBF),
            }),
            highlight: Some(Color::Auto),
            underline: Some(Underline::None),
            ..Default::default()
        };
        let xml = out(|x| write_rpr(x, &p, &ColorScheme::default()));
        assert!(xml.contains(r#"<w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/>"#));
        assert!(
            xml.contains(r#"w:themeColor="accent1" w:themeShade="BF""#),
            "{xml}"
        );
        assert!(xml.contains(r#"<w:highlight w:val="none"/>"#));
        assert_eq!(read_rpr(&el(&xml), "t", &mut Warnings::default()), p);
        assert_eq!(
            out(|x| write_rpr(x, &RunProperties::default(), &ColorScheme::default())),
            ""
        );
    }

    #[test]
    fn run_shading_snaps_and_warns() {
        let mut w = Warnings::default();
        let p = read_rpr(
            &el(r#"<w:rPr><w:shd w:val="clear" w:fill="FFFF33"/></w:rPr>"#),
            "t",
            &mut w,
        );
        assert_eq!(p.highlight, Some(Color::Rgb(Rgb::new(0xFF, 0xFF, 0))));
        assert_eq!(w.into_vec().len(), 1);
        // w:highlight wins over w:shd
        let p = read_rpr(
            &el(r#"<w:rPr><w:highlight w:val="green"/><w:shd w:fill="FFFF00"/></w:rPr>"#),
            "t",
            &mut Warnings::default(),
        );
        assert_eq!(p.highlight, Some(Color::Rgb(Rgb::new(0, 0xFF, 0))));
    }

    #[test]
    fn paragraph_props_both_directions() {
        let mut w = Warnings::default();
        let ppr = el(
            r#"<w:pPr><w:pStyle w:val="Normal"/><w:keepNext/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>
            <w:bidi w:val="0"/><w:spacing w:lineRule="auto" w:line="360" w:before="120" w:after="240"/>
            <w:ind w:left="1134" w:right="567" w:hanging="850"/><w:jc w:val="both"/><w:rPr></w:rPr></w:pPr>"#,
        );
        let p = read_ppr(&ppr, "t", &mut w);
        assert!(w.into_vec().is_empty());
        assert_eq!(p.style.as_deref(), Some("Normal"));
        assert_eq!(p.keep_next, Some(true));
        assert_eq!(
            p.numbering,
            Some(NumberingRef {
                num_id: 2,
                level: 1
            })
        );
        let sp = p.spacing.unwrap();
        assert_eq!(sp.before, Some(Twips(120)));
        assert_eq!(sp.after, Some(Twips(240)));
        assert_eq!(sp.line, Some(LineSpacing::Multiple(1.5)));
        let ind = p.indent.unwrap();
        assert_eq!(ind.left, Some(Twips(1134)));
        assert_eq!(ind.right, Some(Twips(567)));
        assert_eq!(ind.hanging, Some(Twips(850)));
        assert_eq!(p.alignment, Some(Alignment::Justify));
        assert_eq!(p.run_defaults, None);

        let xml = out(|x| write_ppr(x, &p, &ColorScheme::default()));
        assert_eq!(
            xml,
            "<w:pPr><w:pStyle w:val=\"Normal\"/><w:keepNext/><w:numPr><w:ilvl w:val=\"1\"/>\
<w:numId w:val=\"2\"/></w:numPr><w:spacing w:before=\"120\" w:after=\"240\" w:line=\"360\" w:lineRule=\"auto\"/>\
<w:ind w:left=\"1134\" w:right=\"567\" w:hanging=\"850\"/><w:jc w:val=\"both\"/></w:pPr>"
        );
        assert_eq!(read_ppr(&el(&xml), "t", &mut Warnings::default()), p);

        let exact = read_ppr(
            &el(
                r#"<w:pPr><w:spacing w:line="360" w:lineRule="exact"/><w:ind w:start="720" w:firstLine="360"/><w:jc w:val="end"/></w:pPr>"#,
            ),
            "t",
            &mut Warnings::default(),
        );
        assert_eq!(
            exact.spacing.unwrap().line,
            Some(LineSpacing::Exact(Twips(360)))
        );
        assert_eq!(exact.indent.unwrap().first_line, Some(Twips(360)));
        assert_eq!(exact.alignment, Some(Alignment::Right));
        let mut w = Warnings::default();
        let rtl = read_ppr(
            &el(r#"<w:pPr><w:bidi/><w:tabs/><w:pBdr/><w:jc w:val="left"/></w:pPr>"#),
            "t",
            &mut w,
        );
        assert_eq!(w.into_vec().len(), 1);
        assert_eq!(rtl.alignment, Some(Alignment::Right), "mirrored");
    }

    #[test]
    fn paragraph_borders_shading_tabs() {
        let xml = r#"<w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/>
            <w:bottom w:val="double" w:sz="6" w:space="1" w:color="FF0000"/>
            <w:between w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>
            <w:shd w:val="clear" w:color="auto" w:fill="D9E2F3" w:themeFill="accent1" w:themeFillTint="33"/>
            <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/><w:tab w:val="center" w:pos="4513"/>
            <w:tab w:val="clear" w:pos="720"/><w:tab w:val="decimal" w:leader="middleDot" w:pos="6000"/></w:tabs></w:pPr>"#;
        let mut w = Warnings::default();
        let p = read_ppr(&el(xml), "t", &mut w);
        assert_eq!(w.into_vec().len(), 1, "middleDot approximated");
        let b = p.borders.unwrap();
        assert_eq!(b.top.unwrap().space, Some(1));
        assert_eq!(b.bottom.unwrap().style, BorderStyle::Double);
        assert!(b.between.is_some() && b.left.is_none());
        assert_eq!(
            p.shading,
            Some(Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: 0.8
            })
        );
        let tabs: Vec<(i32, TabKind, TabLeader)> =
            p.tabs.iter().map(|t| (t.pos.0, t.kind, t.leader)).collect();
        assert_eq!(
            tabs,
            [
                (720, TabKind::Clear, TabLeader::None),
                (4513, TabKind::Center, TabLeader::None),
                (6000, TabKind::Decimal, TabLeader::Dot),
                (9026, TabKind::Right, TabLeader::Dot),
            ]
        );
        let out = out(|x| write_ppr(x, &p, &ColorScheme::default()));
        assert!(
            out.starts_with(
                r#"<w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/>"#
            ),
            "{out}"
        );
        assert!(out.contains(
            r#"</w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="DAE3F3" w:themeFill="accent1" w:themeFillTint="33"/><w:tabs><w:tab w:val="clear" w:pos="720"/>"#
        ), "{out}");
        assert!(out.contains(r#"<w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs>"#));
        let mut w = Warnings::default();
        assert_eq!(read_ppr(&el(&out), "t", &mut w), p);
        assert!(w.into_vec().is_empty());
    }

    #[test]
    fn units_and_borders() {
        // borders: eighths of a point; sizes: half-points; lengths: twips
        let mut w = Warnings::default();
        let b = read_borders(
            &el(
                r#"<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="FF0000"/>
                <w:start w:val="dotted" w:sz="12"/><w:insideH w:val="nil"/></w:tcBorders>"#,
            ),
            "t",
            &mut w,
        )
        .unwrap();
        let top = b.top.unwrap();
        assert_eq!(top.width, Twips(10));
        assert_eq!(top.width_eighths(), 4);
        assert_eq!(top.color, Color::Rgb(Rgb::new(0xFF, 0, 0)));
        assert_eq!(b.left.unwrap().style, BorderStyle::Dotted);
        assert_eq!(b.left.unwrap().width, Twips(30));
        assert_eq!(b.left.unwrap().color, Color::Auto);
        assert_eq!(b.inside_h.unwrap().style, BorderStyle::None);
        let xml = out(|x| write_borders(x, "w:tcBorders", &b, &ColorScheme::default()));
        assert_eq!(read_borders(&el(&xml), "t", &mut w), Some(b));
        assert!(w.into_vec().is_empty());

        assert_eq!(FontSize::from_half_points(21).pt(), 10.5);
        assert_eq!(
            read_width(&el(r#"<w:tblW w:w="5000" w:type="pct"/>"#)),
            Some(TableWidth::Pct(5000))
        );
        assert_eq!(
            read_width(&el(r#"<w:tblW w:w="50%" w:type="pct"/>"#)),
            Some(TableWidth::Pct(2500))
        );
        assert_eq!(
            read_width(&el(r#"<w:tcW w:w="4535" w:type="dxa"/>"#)),
            Some(TableWidth::Twips(Twips(4535)))
        );
        assert_eq!(
            read_width(&el(r#"<w:tcW w:w="0" w:type="auto"/>"#)),
            Some(TableWidth::Auto)
        );
        assert_eq!(read_width(&el(r#"<w:tcW w:w="0" w:type="nil"/>"#)), None);
        let m = read_cell_margins(&el(
            r#"<w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:start w:w="108" w:type="dxa"/></w:tblCellMar>"#,
        ))
        .unwrap();
        assert_eq!(m.top, Some(Twips(57)));
        assert_eq!(m.left, Some(Twips(108)));
        let xml = out(|x| write_cell_margins(x, &m));
        assert_eq!(read_cell_margins(&el(&xml)), Some(m));
    }
}
