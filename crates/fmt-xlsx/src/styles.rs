//! `xl/styles.xml` ↔ [`CellStyle`]s.
//!
//! Reading resolves every `<cellXfs>` entry into a [`CellStyle`]
//! (`numFmtId`/`fontId`/`fillId`/`borderId` are taken as given; the
//! `applyX` flags are ignored, as Excel does). Fonts are stored as the
//! difference from the default font (font 0), so a cell that only turns
//! bold on gets `bold: Some(true)` and nothing else. Values that equal the
//! defaults (font properties of font 0, `general`/`bottom` alignment,
//! `wrapText="0"`, `indent="0"`, the `none`/`gray125` fills, `General`)
//! read as "inherit" (`None`).
//!
//! Writing regenerates the whole part from a [`StyleTable`]: one `<xf>` per
//! style in id order (so xf index = [`StyleId`](model_sheet::StyleId)),
//! deduplicated fonts/fills/borders, custom number formats from id 164.

use std::collections::HashMap;

use core_model::{Color, FontFace, FontSize, Rgb, RunProperties, Underline, VerticalAlign};
use model_sheet::numfmt::{builtin_code, builtin_id, GENERAL};
use model_sheet::{
    Alignment, BorderSide, BorderStyle, Borders, CellStyle, Fill, HAlign, StyleTable, VAlign,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::theme::{index_of_slot, slot_from_index};
use crate::xml::{attr, attr_bool, attr_parse, name_of, toggle, xml_err, XmlOut};
use crate::Result;

pub const MAIN_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// The legacy 64-entry indexed color palette (ECMA-376 Part 1, §18.8.27).
/// Indices 64 and 65 are the system foreground/background ([`Color::Auto`]).
pub const INDEXED_PALETTE: [u32; 64] = [
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, //
    0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, //
    0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080, //
    0x9999FF, 0x993366, 0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF, //
    0x000080, 0xFF00FF, 0xFFFF00, 0x00FFFF, 0x800080, 0x800000, 0x008080, 0x0000FF, //
    0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99, 0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99, //
    0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00, 0xFF9900, 0xFF6600, 0x666699, 0x969696, //
    0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333, //
];

fn rgb_of(v: u32) -> Rgb {
    Rgb::new((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

/// The default font of a new workbook: Calibri 11, theme text color.
pub fn builtin_default_font() -> RunProperties {
    normalize_font(RunProperties {
        font: Some(FontFace::Named("Calibri".into())),
        size: Some(FontSize::from_pt(11.0)),
        color: Some(Color::theme(core_model::ThemeColorSlot::Dark1)),
        ..Default::default()
    })
}

/// Fills in the "off" values (`bold: false`, `underline: None`, …) so that
/// fonts can be compared field by field.
pub fn normalize_font(mut f: RunProperties) -> RunProperties {
    f.bold.get_or_insert(false);
    f.italic.get_or_insert(false);
    f.strike.get_or_insert(false);
    f.underline.get_or_insert(Underline::None);
    f.vertical_align.get_or_insert(VerticalAlign::Baseline);
    f.highlight = None;
    f
}

/// The fields of `font` that differ from `default` (both normalized).
pub fn font_diff(font: &RunProperties, default: &RunProperties) -> RunProperties {
    fn d<T: PartialEq + Clone>(v: &Option<T>, base: &Option<T>) -> Option<T> {
        if v == base {
            None
        } else {
            v.clone()
        }
    }
    RunProperties {
        font: d(&font.font, &default.font),
        size: d(&font.size, &default.size),
        bold: d(&font.bold, &default.bold),
        italic: d(&font.italic, &default.italic),
        underline: d(&font.underline, &default.underline),
        strike: d(&font.strike, &default.strike),
        color: d(&font.color, &default.color),
        highlight: None,
        vertical_align: d(&font.vertical_align, &default.vertical_align),
    }
}

// --- reading ---------------------------------------------------------------

/// A `CT_Color` before palette resolution.
#[derive(Debug, Clone, Default)]
struct RawColor {
    auto: bool,
    rgb: Option<String>,
    indexed: Option<u32>,
    theme: Option<u32>,
    tint: f64,
}

impl RawColor {
    fn from_el(el: &BytesStart<'_>) -> Self {
        RawColor {
            auto: attr_bool(el, "auto").unwrap_or(false),
            rgb: attr(el, "rgb").map(|s| s.into_owned()),
            indexed: attr_parse(el, "indexed"),
            theme: attr_parse(el, "theme"),
            tint: attr_parse(el, "tint").unwrap_or(0.0),
        }
    }

    fn resolve(&self, palette: &[Rgb]) -> Option<Color> {
        if let Some(slot) = self.theme.and_then(slot_from_index) {
            return Some(Color::Theme {
                slot,
                tint: self.tint,
            });
        }
        if let Some(rgb) = self.rgb.as_deref().and_then(|h| Rgb::from_hex(h).ok()) {
            return Some(Color::Rgb(rgb));
        }
        if let Some(i) = self.indexed {
            return match palette.get(i as usize) {
                Some(&rgb) => Some(Color::Rgb(rgb)),
                None if i == 64 || i == 65 => Some(Color::Auto),
                None => None,
            };
        }
        self.auto.then_some(Color::Auto)
    }
}

impl RawColor {
    fn from_dom(el: &fmt_ooxml::xml::El) -> Self {
        let num = |n: &str| el.attr(n).and_then(|v| v.trim().parse().ok());
        RawColor {
            auto: el
                .attr("auto")
                .and_then(fmt_ooxml::xml::parse_bool)
                .unwrap_or(false),
            rgb: el.attr("rgb").map(str::to_owned),
            indexed: num("indexed"),
            theme: num("theme"),
            tint: el
                .attr("tint")
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0.0),
        }
    }
}

/// A `CT_Color` DOM element outside the styles part (conditional
/// formatting colours), resolved against the default indexed palette.
pub(crate) fn color_of_dom(el: &fmt_ooxml::xml::El) -> Option<Color> {
    let palette: Vec<Rgb> = INDEXED_PALETTE.iter().map(|&v| rgb_of(v)).collect();
    RawColor::from_dom(el).resolve(&palette)
}

/// A `CT_Color` element outside the styles part (e.g. `sheetPr/tabColor`),
/// resolved against the default indexed palette.
pub(crate) fn color_of_el(el: &BytesStart<'_>) -> Option<Color> {
    let palette: Vec<Rgb> = INDEXED_PALETTE.iter().map(|&v| rgb_of(v)).collect();
    RawColor::from_el(el).resolve(&palette)
}

#[derive(Debug, Default)]
struct RawFont {
    props: RunProperties,
    color: Option<RawColor>,
}

#[derive(Debug, Default)]
struct RawFill {
    pattern: Option<String>,
    fg: Option<RawColor>,
    gradient: bool,
}

#[derive(Debug, Default)]
struct RawBorder {
    /// left, right, top, bottom
    sides: [Option<(String, Option<RawColor>)>; 4],
}

#[derive(Debug, Default)]
struct RawXf {
    num_fmt: u32,
    font: usize,
    fill: usize,
    border: usize,
    alignment: Alignment,
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Other,
    NumFmts,
    Fonts,
    Fills,
    Borders,
    CellXfs,
    Colors,
}

/// The result of parsing `styles.xml`.
#[derive(Debug)]
pub struct ParsedStyles {
    /// One style per `<cellXfs>` entry.
    pub xfs: Vec<CellStyle>,
    /// Font 0, normalized.
    pub default_font: RunProperties,
    /// The differential formats of `<dxfs>` (conditional formatting).
    pub dxfs: Vec<model_sheet::DxfStyle>,
}

fn underline_of(v: Option<&str>) -> Underline {
    match v {
        None | Some("single") | Some("singleAccounting") => Underline::Single,
        Some("double") | Some("doubleAccounting") => Underline::Double,
        _ => Underline::None,
    }
}

fn halign_of(v: &str) -> Option<HAlign> {
    Some(match v {
        "left" => HAlign::Left,
        "center" | "centerContinuous" => HAlign::Center,
        "right" => HAlign::Right,
        "fill" => HAlign::Fill,
        "justify" | "distributed" => HAlign::Justify,
        _ => return None,
    })
}

fn valign_of(v: &str) -> Option<VAlign> {
    Some(match v {
        "top" => VAlign::Top,
        "center" | "justify" | "distributed" => VAlign::Center,
        _ => return None,
    })
}

fn border_style_of(v: &str) -> Option<BorderStyle> {
    Some(match v {
        "thin" => BorderStyle::Thin,
        "medium" => BorderStyle::Medium,
        "thick" => BorderStyle::Thick,
        "dashed" | "mediumDashed" | "dashDot" | "mediumDashDot" | "dashDotDot"
        | "mediumDashDotDot" | "slantDashDot" => BorderStyle::Dashed,
        "dotted" => BorderStyle::Dotted,
        "double" => BorderStyle::Double,
        "hair" => BorderStyle::Hair,
        _ => return None,
    })
}

fn alignment_of(el: &BytesStart<'_>) -> Alignment {
    Alignment {
        horizontal: attr(el, "horizontal").and_then(|v| halign_of(&v)),
        vertical: attr(el, "vertical").and_then(|v| valign_of(&v)),
        wrap_text: attr_bool(el, "wrapText").filter(|&w| w),
        indent: attr_parse::<u32>(el, "indent")
            .filter(|&i| i > 0)
            .map(|i| i.min(255) as u8),
    }
}

/// Parses `styles.xml`. Lossy mappings are reported through `warn`.
pub fn parse_styles(xml: &[u8], part: &str, warn: &mut dyn FnMut(String)) -> Result<ParsedStyles> {
    let mut reader = Reader::from_reader(xml);
    let mut section = Section::Other;
    let mut num_fmts: HashMap<u32, String> = HashMap::new();
    let mut fonts: Vec<RawFont> = Vec::new();
    let mut fills: Vec<RawFill> = Vec::new();
    let mut borders: Vec<RawBorder> = Vec::new();
    let mut xfs: Vec<RawXf> = Vec::new();
    let mut palette: Option<Vec<Rgb>> = None;
    let mut side: Option<usize> = None;
    let mut dxfs: Option<fmt_ooxml::xml::El> = None;
    loop {
        let ev = reader.read_event().map_err(xml_err(part))?;
        let (el, is_empty) = match &ev {
            Event::Start(el) => (el, false),
            Event::Empty(el) => (el, true),
            Event::End(el) => {
                match crate::xml::end_name(el) {
                    b"numFmts" | b"fonts" | b"fills" | b"borders" | b"cellXfs" | b"colors"
                    | b"cellStyleXfs" | b"dxfs" | b"cellStyles" | b"tableStyles" | b"extLst" => {
                        section = Section::Other;
                    }
                    b"left" | b"right" | b"top" | b"bottom" | b"start" | b"end" => side = None,
                    _ => {}
                }
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let name = name_of(el);
        match (section, name) {
            (Section::Other, b"numFmts") => section = Section::NumFmts,
            (Section::Other, b"fonts") => section = Section::Fonts,
            (Section::Other, b"fills") => section = Section::Fills,
            (Section::Other, b"borders") => section = Section::Borders,
            (Section::Other, b"cellXfs") => section = Section::CellXfs,
            (Section::Other, b"colors") => section = Section::Colors,
            // Kept for after the palette is known (it comes last).
            (Section::Other, b"dxfs") if !is_empty => {
                let span = reader.read_to_end(el.name()).map_err(xml_err(part))?;
                let inner = &xml[span.start as usize..span.end as usize];
                dxfs = Some(crate::condfmt::subtree(el, inner, part)?);
            }
            // Skipped wholesale (their children reuse font/fill/border names).
            (
                Section::Other,
                b"cellStyleXfs" | b"dxfs" | b"cellStyles" | b"tableStyles" | b"extLst",
            ) if !is_empty => {
                reader.read_to_end(el.name()).map_err(xml_err(part))?;
            }
            (Section::NumFmts, b"numFmt") => {
                if let (Some(id), Some(code)) =
                    (attr_parse::<u32>(el, "numFmtId"), attr(el, "formatCode"))
                {
                    num_fmts.insert(id, code.into_owned());
                }
            }
            (Section::Fonts, b"font") => fonts.push(RawFont::default()),
            (Section::Fonts, _) => {
                let Some(f) = fonts.last_mut() else { continue };
                let p = &mut f.props;
                match name {
                    b"b" => p.bold = Some(toggle(el)),
                    b"i" => p.italic = Some(toggle(el)),
                    b"strike" => p.strike = Some(toggle(el)),
                    b"u" => p.underline = Some(underline_of(attr(el, "val").as_deref())),
                    b"vertAlign" => {
                        p.vertical_align = Some(match attr(el, "val").as_deref() {
                            Some("superscript") => VerticalAlign::Superscript,
                            Some("subscript") => VerticalAlign::Subscript,
                            _ => VerticalAlign::Baseline,
                        })
                    }
                    b"sz" => p.size = attr_parse::<f64>(el, "val").map(FontSize::from_pt),
                    b"name" => p.font = attr(el, "val").map(|v| FontFace::Named(v.into_owned())),
                    b"color" => f.color = Some(RawColor::from_el(el)),
                    _ => {}
                }
            }
            (Section::Fills, b"fill") => fills.push(RawFill::default()),
            (Section::Fills, _) => {
                let Some(f) = fills.last_mut() else { continue };
                match name {
                    b"patternFill" => {
                        f.pattern = Some(
                            attr(el, "patternType")
                                .map_or_else(|| "none".into(), |v| v.into_owned()),
                        );
                    }
                    b"fgColor" => f.fg = Some(RawColor::from_el(el)),
                    b"gradientFill" => f.gradient = true,
                    _ => {}
                }
            }
            (Section::Borders, b"border") => borders.push(RawBorder::default()),
            (Section::Borders, _) => {
                let Some(b) = borders.last_mut() else {
                    continue;
                };
                let idx = match name {
                    b"left" | b"start" => Some(0),
                    b"right" | b"end" => Some(1),
                    b"top" => Some(2),
                    b"bottom" => Some(3),
                    _ => None,
                };
                if let Some(i) = idx {
                    b.sides[i] = attr(el, "style").map(|s| (s.into_owned(), None));
                    side = (!is_empty).then_some(i);
                } else if name == b"color" {
                    if let Some(Some((_, color))) = side.map(|i| &mut b.sides[i]) {
                        *color = Some(RawColor::from_el(el));
                    }
                } else if name == b"diagonal" || name == b"vertical" || name == b"horizontal" {
                    side = None;
                }
            }
            (Section::CellXfs, b"xf") => xfs.push(RawXf {
                num_fmt: attr_parse(el, "numFmtId").unwrap_or(0),
                font: attr_parse(el, "fontId").unwrap_or(0),
                fill: attr_parse(el, "fillId").unwrap_or(0),
                border: attr_parse(el, "borderId").unwrap_or(0),
                alignment: Alignment::default(),
            }),
            (Section::CellXfs, b"alignment") => {
                if let Some(x) = xfs.last_mut() {
                    x.alignment = alignment_of(el);
                }
            }
            (Section::Colors, b"indexedColors") => palette = Some(Vec::new()),
            (Section::Colors, b"rgbColor") => {
                if let Some(p) = palette.as_mut() {
                    p.push(
                        attr(el, "rgb")
                            .and_then(|h| Rgb::from_hex(&h).ok())
                            .unwrap_or(Rgb::BLACK),
                    );
                }
            }
            _ => {}
        }
    }

    let palette = palette.unwrap_or_else(|| INDEXED_PALETTE.iter().map(|&v| rgb_of(v)).collect());
    let font_of = |f: &RawFont| {
        normalize_font(RunProperties {
            color: f.color.as_ref().and_then(|c| c.resolve(&palette)),
            ..f.props.clone()
        })
    };
    let default_font = fonts.first().map_or_else(builtin_default_font, font_of);
    let fonts: Vec<RunProperties> = fonts
        .iter()
        .map(|f| font_diff(&font_of(f), &default_font))
        .collect();

    let mut approximated_pattern = false;
    let fills: Vec<Option<Fill>> = fills
        .iter()
        .map(|f| match f.pattern.as_deref() {
            None | Some("none") | Some("gray125") => {
                if f.gradient {
                    approximated_pattern = true;
                }
                None
            }
            Some(p) => {
                approximated_pattern |= p != "solid";
                Some(Fill::Solid(
                    f.fg.as_ref()
                        .and_then(|c| c.resolve(&palette))
                        .unwrap_or(Color::Auto),
                ))
            }
        })
        .collect();
    if approximated_pattern {
        warn("pattern/gradient fills approximated (pattern → solid foreground color, gradient → no fill)".into());
    }

    let borders: Vec<Borders> = borders
        .iter()
        .map(|b| {
            let side = |i: usize| {
                let (style, color) = b.sides[i].as_ref()?;
                Some(BorderSide {
                    style: border_style_of(style)?,
                    color: color
                        .as_ref()
                        .and_then(|c| c.resolve(&palette))
                        .unwrap_or(Color::Auto),
                })
            };
            Borders {
                left: side(0),
                right: side(1),
                top: side(2),
                bottom: side(3),
            }
        })
        .collect();

    let mut unknown_fmts: Vec<u32> = Vec::new();
    let mut code_of = |id: u32| -> Option<String> {
        let code = match num_fmts.get(&id) {
            Some(c) => c.clone(),
            None => match u16::try_from(id).ok().and_then(builtin_code) {
                Some(c) => c.to_owned(),
                None => {
                    if !unknown_fmts.contains(&id) {
                        unknown_fmts.push(id);
                    }
                    return None;
                }
            },
        };
        (!code.eq_ignore_ascii_case(GENERAL)).then_some(code)
    };
    let xfs: Vec<CellStyle> = xfs
        .iter()
        .map(|x| CellStyle {
            font: fonts.get(x.font).cloned().unwrap_or_default(),
            fill: fills.get(x.fill).copied().flatten(),
            borders: borders.get(x.border).copied().unwrap_or_default(),
            alignment: x.alignment,
            number_format: code_of(x.num_fmt),
        })
        .collect();
    for id in unknown_fmts {
        warn(format!(
            "number format id {id} is not defined (locale-dependent built-in); read as General"
        ));
    }
    let dxfs = dxfs.map_or_else(Vec::new, |el| {
        crate::condfmt::parse_dxfs(&el, &|c| RawColor::from_dom(c).resolve(&palette))
    });
    Ok(ParsedStyles {
        xfs,
        default_font,
        dxfs,
    })
}

// --- writing ---------------------------------------------------------------

fn color_attrs(c: Color) -> Vec<(&'static str, String)> {
    match c {
        Color::Auto => vec![("auto", "1".into())],
        Color::Rgb(rgb) => vec![("rgb", format!("FF{}", rgb.to_hex()))],
        Color::Theme { slot, tint } => {
            let mut v = vec![("theme", index_of_slot(slot).to_string())];
            if tint != 0.0 {
                v.push(("tint", format!("{tint}")));
            }
            v
        }
    }
}

pub(crate) fn color_el(x: &mut XmlOut, name: &str, c: Color) {
    let attrs = color_attrs(c);
    let refs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    x.empty(name, &refs);
}

fn font_xml(f: &RunProperties) -> Vec<u8> {
    let mut x = XmlOut::fragment();
    x.start("font", &[]);
    if f.bold == Some(true) {
        x.empty("b", &[]);
    }
    if f.italic == Some(true) {
        x.empty("i", &[]);
    }
    if f.strike == Some(true) {
        x.empty("strike", &[]);
    }
    match f.underline {
        None | Some(Underline::None) => {}
        Some(Underline::Double) => x.empty("u", &[("val", "double")]),
        Some(_) => x.empty("u", &[]),
    }
    match f.vertical_align {
        Some(VerticalAlign::Superscript) => x.empty("vertAlign", &[("val", "superscript")]),
        Some(VerticalAlign::Subscript) => x.empty("vertAlign", &[("val", "subscript")]),
        _ => {}
    }
    if let Some(size) = f.size {
        x.empty("sz", &[("val", &format!("{}", size.pt()))]);
    }
    if let Some(c) = f.color {
        color_el(&mut x, "color", c);
    }
    let name = match &f.font {
        Some(FontFace::Named(n)) => n.as_str(),
        Some(FontFace::Theme(core_model::ThemeFontSlot::MajorLatin)) => "Calibri Light",
        _ => "Calibri",
    };
    x.empty("name", &[("val", name)]);
    x.empty("family", &[("val", "2")]);
    x.end("font");
    x.finish()
}

fn fill_xml(c: Option<Color>) -> Vec<u8> {
    let mut x = XmlOut::fragment();
    x.start("fill", &[]);
    match c {
        None => x.empty("patternFill", &[("patternType", "none")]),
        Some(c) => {
            x.start("patternFill", &[("patternType", "solid")]);
            color_el(&mut x, "fgColor", c);
            x.empty("bgColor", &[("indexed", "64")]);
            x.end("patternFill");
        }
    }
    x.end("fill");
    x.finish()
}

fn gray125_xml() -> Vec<u8> {
    let mut x = XmlOut::fragment();
    x.start("fill", &[]);
    x.empty("patternFill", &[("patternType", "gray125")]);
    x.end("fill");
    x.finish()
}

fn border_style_name(s: BorderStyle) -> &'static str {
    match s {
        BorderStyle::Thin => "thin",
        BorderStyle::Medium => "medium",
        BorderStyle::Thick => "thick",
        BorderStyle::Dashed => "dashed",
        BorderStyle::Dotted => "dotted",
        BorderStyle::Double => "double",
        BorderStyle::Hair => "hair",
    }
}

fn border_xml(b: &Borders) -> Vec<u8> {
    let mut x = XmlOut::fragment();
    x.start("border", &[]);
    for (name, side) in [
        ("left", b.left),
        ("right", b.right),
        ("top", b.top),
        ("bottom", b.bottom),
    ] {
        match side {
            None => x.empty(name, &[]),
            Some(s) => {
                x.start(name, &[("style", border_style_name(s.style))]);
                color_el(&mut x, "color", s.color);
                x.end(name);
            }
        }
    }
    x.empty("diagonal", &[]);
    x.end("border");
    x.finish()
}

/// Deduplicating list of XML fragments.
struct Pool {
    items: Vec<Vec<u8>>,
    index: HashMap<Vec<u8>, usize>,
}

impl Pool {
    fn new(first: Vec<Vec<u8>>) -> Self {
        let mut p = Pool {
            items: Vec::new(),
            index: HashMap::new(),
        };
        for f in first {
            p.add(f);
        }
        p
    }

    fn add(&mut self, frag: Vec<u8>) -> usize {
        if let Some(&i) = self.index.get(&frag) {
            return i;
        }
        let i = self.items.len();
        self.index.insert(frag.clone(), i);
        self.items.push(frag);
        i
    }

    fn write(&self, x: &mut XmlOut, name: &str) {
        x.start(name, &[("count", &self.items.len().to_string())]);
        for f in &self.items {
            x.raw(f);
        }
        x.end(name);
    }
}

fn halign_name(h: HAlign) -> &'static str {
    match h {
        HAlign::General => "general",
        HAlign::Left => "left",
        HAlign::Center => "center",
        HAlign::Right => "right",
        HAlign::Fill => "fill",
        HAlign::Justify => "justify",
    }
}

fn valign_name(v: VAlign) -> &'static str {
    match v {
        VAlign::Top => "top",
        VAlign::Center => "center",
        VAlign::Bottom => "bottom",
    }
}

/// Generates `styles.xml` with one `<xf>` per style of `table`, in id order.
#[cfg(test)]
pub fn write_styles(table: &StyleTable, default_font: &RunProperties) -> Vec<u8> {
    write_styles_with_dxfs(table, default_font, &[])
}

/// [`write_styles`] plus the differential formats of conditional
/// formatting (`dxfId` = index into `dxfs`).
pub fn write_styles_with_dxfs(
    table: &StyleTable,
    default_font: &RunProperties,
    dxfs: &[model_sheet::DxfStyle],
) -> Vec<u8> {
    let default_font = normalize_font(default_font.clone());
    let mut fonts = Pool::new(vec![font_xml(&default_font)]);
    let mut fills = Pool::new(vec![fill_xml(None), gray125_xml()]);
    let mut borders = Pool::new(vec![border_xml(&Borders::default())]);
    let mut custom_fmts: Vec<String> = Vec::new();

    struct Xf {
        num_fmt: u32,
        font: usize,
        fill: usize,
        border: usize,
        alignment: Alignment,
    }
    let xfs: Vec<Xf> = table
        .iter()
        .map(|(_, s)| {
            let num_fmt = match s.number_format.as_deref() {
                None => 0,
                Some(code) => match builtin_id(code) {
                    Some(id) => u32::from(id),
                    None => {
                        let i = custom_fmts
                            .iter()
                            .position(|c| c == code)
                            .unwrap_or_else(|| {
                                custom_fmts.push(code.to_owned());
                                custom_fmts.len() - 1
                            });
                        164 + i as u32
                    }
                },
            };
            let fill = match s.fill {
                None | Some(Fill::None) => 0,
                Some(Fill::Solid(c)) => fills.add(fill_xml(Some(c))),
            };
            Xf {
                num_fmt,
                font: fonts.add(font_xml(&default_font.merged_with(&s.font))),
                fill,
                border: borders.add(border_xml(&s.borders)),
                alignment: s.alignment,
            }
        })
        .collect();

    let mut x = XmlOut::new();
    x.start("styleSheet", &[("xmlns", MAIN_NS)]);
    if !custom_fmts.is_empty() {
        x.start("numFmts", &[("count", &custom_fmts.len().to_string())]);
        for (i, code) in custom_fmts.iter().enumerate() {
            x.empty(
                "numFmt",
                &[("numFmtId", &(164 + i).to_string()), ("formatCode", code)],
            );
        }
        x.end("numFmts");
    }
    fonts.write(&mut x, "fonts");
    fills.write(&mut x, "fills");
    borders.write(&mut x, "borders");
    x.start("cellStyleXfs", &[("count", "1")]);
    x.empty(
        "xf",
        &[
            ("numFmtId", "0"),
            ("fontId", "0"),
            ("fillId", "0"),
            ("borderId", "0"),
        ],
    );
    x.end("cellStyleXfs");
    x.start("cellXfs", &[("count", &xfs.len().to_string())]);
    for xf in &xfs {
        let ids = [
            xf.num_fmt.to_string(),
            xf.font.to_string(),
            xf.fill.to_string(),
            xf.border.to_string(),
        ];
        let mut attrs: Vec<(&str, &str)> = vec![
            ("numFmtId", &ids[0]),
            ("fontId", &ids[1]),
            ("fillId", &ids[2]),
            ("borderId", &ids[3]),
            ("xfId", "0"),
        ];
        for (flag, on) in [
            ("applyNumberFormat", xf.num_fmt != 0),
            ("applyFont", xf.font != 0),
            ("applyFill", xf.fill != 0),
            ("applyBorder", xf.border != 0),
            ("applyAlignment", !xf.alignment.is_default()),
        ] {
            if on {
                attrs.push((flag, "1"));
            }
        }
        if xf.alignment.is_default() {
            x.empty("xf", &attrs);
        } else {
            x.start("xf", &attrs);
            let a = xf.alignment;
            let indent = a.indent.map(|i| i.to_string());
            let mut al: Vec<(&str, &str)> = Vec::new();
            if let Some(h) = a.horizontal {
                al.push(("horizontal", halign_name(h)));
            }
            if let Some(v) = a.vertical {
                al.push(("vertical", valign_name(v)));
            }
            if let Some(w) = a.wrap_text {
                al.push(("wrapText", if w { "1" } else { "0" }));
            }
            if let Some(i) = &indent {
                al.push(("indent", i));
            }
            x.empty("alignment", &al);
            x.end("xf");
        }
    }
    x.end("cellXfs");
    x.start("cellStyles", &[("count", "1")]);
    x.empty(
        "cellStyle",
        &[("name", "Normal"), ("xfId", "0"), ("builtinId", "0")],
    );
    x.end("cellStyles");
    crate::condfmt::write_dxfs(&mut x, dxfs);
    x.empty(
        "tableStyles",
        &[
            ("count", "0"),
            ("defaultTableStyle", "TableStyleMedium2"),
            ("defaultPivotStyle", "PivotStyleLight16"),
        ],
    );
    x.end("styleSheet");
    x.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::ThemeColorSlot;

    fn parse(xml: &str) -> (ParsedStyles, Vec<String>) {
        let mut warnings = Vec::new();
        let p = parse_styles(xml.as_bytes(), "styles", &mut |w| warnings.push(w)).unwrap();
        (p, warnings)
    }

    const SAMPLE: &str = r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="General"/><numFmt numFmtId="165" formatCode="0.000"/></numFmts>
<fonts count="4">
 <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
 <font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
 <font><i val="1"/><strike/><u val="double"/><sz val="14"/><color theme="4" tint="-0.249977111117893"/><name val="Arial"/></font>
 <font><u/><vertAlign val="superscript"/><sz val="11"/><color indexed="10"/><name val="Calibri"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
 <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
 <fill><patternFill patternType="solid"><fgColor theme="5" tint="0.39997558519241921"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
 <border><left style="thin"><color indexed="64"/></left><right style="medium"><color rgb="FFFF0000"/></right><top style="dashDot"/><bottom style="double"><color theme="1"/></bottom><diagonal style="thin"/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="1" fillId="2" borderId="1"/></cellStyleXfs>
<cellXfs count="7">
 <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="general" vertical="bottom" wrapText="false" indent="0"/></xf>
 <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1"/>
 <xf numFmtId="4" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="0"/>
 <xf numFmtId="165" fontId="3" fillId="1" borderId="0" xfId="0"><alignment horizontal="centerContinuous" vertical="top" wrapText="1" indent="2"/></xf>
 <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0"/>
 <xf numFmtId="42" fontId="0" fillId="0" borderId="0" xfId="0"/>
 <xf numFmtId="0" fontId="9" fillId="9" borderId="9" xfId="0"/>
</cellXfs>
<dxfs count="1"><dxf><font><b/></font><fill><patternFill><bgColor rgb="FF00FF00"/></patternFill></fill></dxf></dxfs>
</styleSheet>"#;

    #[test]
    fn reads_every_feature() {
        let (p, warnings) = parse(SAMPLE);
        assert_eq!(p.xfs.len(), 7);
        assert_eq!(p.default_font.font, Some(FontFace::Named("Calibri".into())));
        assert_eq!(p.default_font.size, Some(FontSize::from_pt(11.0)));
        assert!(p.xfs[0].is_default(), "{:?}", p.xfs[0]);

        let bold = &p.xfs[1];
        assert_eq!(
            bold.font,
            RunProperties {
                bold: Some(true),
                ..Default::default()
            }
        );
        assert_eq!(
            bold.fill,
            Some(Fill::Solid(Color::Rgb(Rgb::new(255, 255, 0))))
        );

        let x = &p.xfs[2];
        assert_eq!(x.font.italic, Some(true));
        assert_eq!(x.font.strike, Some(true));
        assert_eq!(x.font.underline, Some(Underline::Double));
        assert_eq!(x.font.size, Some(FontSize::from_pt(14.0)));
        assert_eq!(x.font.font, Some(FontFace::Named("Arial".into())));
        assert_eq!(
            x.font.color,
            Some(Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: -0.249977111117893
            })
        );
        assert_eq!(x.font.bold, None);
        assert_eq!(
            x.fill,
            Some(Fill::Solid(Color::Theme {
                slot: ThemeColorSlot::Accent2,
                tint: 0.399_975_585_192_419_2
            }))
        );
        assert_eq!(x.number_format.as_deref(), Some("#,##0.00"));
        let b = x.borders;
        assert_eq!(
            b.left,
            Some(BorderSide {
                style: BorderStyle::Thin,
                color: Color::Auto
            })
        );
        assert_eq!(
            b.right,
            Some(BorderSide {
                style: BorderStyle::Medium,
                color: Color::Rgb(Rgb::new(255, 0, 0))
            })
        );
        assert_eq!(
            b.top,
            Some(BorderSide {
                style: BorderStyle::Dashed,
                color: Color::Auto
            })
        );
        assert_eq!(
            b.bottom,
            Some(BorderSide {
                style: BorderStyle::Double,
                color: Color::theme(ThemeColorSlot::Dark1)
            })
        );

        let x = &p.xfs[3];
        assert_eq!(x.number_format.as_deref(), Some("0.000"));
        assert_eq!(x.font.underline, Some(Underline::Single));
        assert_eq!(x.font.vertical_align, Some(VerticalAlign::Superscript));
        // Legacy palette entry 10 is red.
        assert_eq!(x.font.color, Some(Color::Rgb(Rgb::new(255, 0, 0))));
        assert_eq!(x.fill, None, "gray125 reads as no fill");
        assert_eq!(
            x.alignment,
            Alignment {
                horizontal: Some(HAlign::Center),
                vertical: Some(VAlign::Top),
                wrap_text: Some(true),
                indent: Some(2),
            }
        );
        assert_eq!(p.xfs[4].number_format.as_deref(), Some("mm-dd-yy"));
        assert_eq!(p.xfs[5].number_format, None);
        assert!(
            p.xfs[6].is_default(),
            "out-of-range ids fall back to defaults"
        );
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(warnings[0].contains("42"));
    }

    #[test]
    fn custom_indexed_palette() {
        let xml = r#"<styleSheet><fonts><font><sz val="10"/><name val="Arial"/></font><font><color indexed="1"/><sz val="10"/><name val="Arial"/></font></fonts>
            <cellXfs><xf fontId="0"/><xf fontId="1"/></cellXfs>
            <colors><indexedColors><rgbColor rgb="FF000000"/><rgbColor rgb="FF123456"/></indexedColors></colors></styleSheet>"#;
        let (p, _) = parse(xml);
        assert_eq!(
            p.xfs[1].font.color,
            Some(Color::Rgb(Rgb::new(0x12, 0x34, 0x56)))
        );
        assert_eq!(p.default_font.size, Some(FontSize::from_pt(10.0)));
    }

    fn sample_styles() -> Vec<CellStyle> {
        let (p, _) = parse(SAMPLE);
        p.xfs
    }

    #[test]
    fn write_then_read_is_identity() {
        let (table, _) = StyleTable::from_list(&sample_styles());
        let mut extra = table.clone();
        extra.intern(&CellStyle {
            fill: Some(Fill::None),
            number_format: Some("yyyy-mm-dd".into()),
            ..Default::default()
        });
        for t in [table, extra] {
            let xml = write_styles(&t, &builtin_default_font());
            let (p, warnings) = parse(std::str::from_utf8(&xml).unwrap());
            assert!(warnings.is_empty(), "{warnings:?}");
            assert_eq!(p.default_font, builtin_default_font());
            let expected: Vec<CellStyle> = t
                .iter()
                .map(|(_, s)| CellStyle {
                    fill: s.fill.filter(|f| *f != Fill::None),
                    ..s.clone()
                })
                .collect();
            assert_eq!(p.xfs, expected);
        }
    }

    #[test]
    fn writes_dedup_and_custom_ids() {
        let mut t = StyleTable::new();
        let red = Color::Rgb(Rgb::new(255, 0, 0));
        for nf in ["0.00", "0.000", "#,##0", "0.000"] {
            t.intern(&CellStyle {
                number_format: Some(nf.into()),
                fill: Some(Fill::Solid(red)),
                ..Default::default()
            });
        }
        let xml = String::from_utf8(write_styles(&t, &builtin_default_font())).unwrap();
        assert!(
            xml.contains(
                r#"<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts>"#
            ),
            "{xml}"
        );
        assert!(xml.contains(r#"<fills count="3">"#), "{xml}");
        assert!(xml.contains(r#"<fonts count="1">"#), "{xml}");
        assert!(xml.contains(r#"<cellXfs count="4">"#), "{xml}");
        assert!(xml.contains(r#"<xf numFmtId="2" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>"#), "{xml}");
        assert!(xml.contains(r#"<xf numFmtId="3" "#), "{xml}");
    }

    #[test]
    fn color_attributes() {
        assert_eq!(color_attrs(Color::Auto), vec![("auto", "1".to_string())]);
        assert_eq!(
            color_attrs(Color::Rgb(Rgb::new(1, 2, 255))),
            vec![("rgb", "FF0102FF".to_string())]
        );
        assert_eq!(
            color_attrs(Color::Theme {
                slot: ThemeColorSlot::Light1,
                tint: 0.5
            }),
            vec![("theme", "0".to_string()), ("tint", "0.5".to_string())]
        );
        assert_eq!(
            color_attrs(Color::theme(ThemeColorSlot::Accent6)),
            vec![("theme", "9".to_string())]
        );
    }
}
