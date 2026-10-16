//! DrawingML mapping shared by the reader and the writer: transforms
//! (`a:xfrm`), colors, fills, outlines and text bodies (`p:txBody`).

use core_model::{
    apply_tint, Color, FontFace, FontSize, Rgb, RunProperties, ThemeColorSlot, ThemeFontSlot,
    Underline, VerticalAlign,
};
use model_show::text::FULL_SCALE;
use model_show::{
    Alignment, Anchor, ArrowEnd, ArrowKind, ArrowSize, AutoNumScheme, Autofit, BodyProps, Bullet,
    Emu, Fill, Hyperlink, Line, LineDash, TextBody, TextDirection, TextField, TextParagraph,
    TextParagraphProps, TextRun, TextSpacing, Transform,
};

use crate::link::{read_hlink, write_hlink, LinkSink, LinkXml};

use crate::xml::{parse_bool, parse_i64, parse_u32, El, XmlOut};
use crate::Warnings;

// --- transforms ------------------------------------------------------------------

/// DrawingML angles are in 60000ths of a degree.
pub const ANGLE_UNITS_PER_DEGREE: f64 = 60_000.0;

/// `a:xfrm/@rot` (60000ths of a degree, clockwise) → degrees in `0..360`.
pub fn rot_to_deg(rot: i64) -> f64 {
    let deg = (rot as f64 / ANGLE_UNITS_PER_DEGREE).rem_euclid(360.0);
    if deg == 0.0 {
        0.0
    } else {
        deg
    }
}

/// Degrees (clockwise) → `a:xfrm/@rot`, normalized to `0..21600000`.
pub fn deg_to_rot(deg: f64) -> i64 {
    if !deg.is_finite() {
        return 0;
    }
    let full = 360 * 60_000;
    ((deg * ANGLE_UNITS_PER_DEGREE).round() as i64).rem_euclid(full)
}

/// A raw `a:xfrm` as written in the file.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Xfrm {
    /// `a:off` (x, y).
    pub off: (i64, i64),
    /// `a:ext` (cx, cy).
    pub ext: (i64, i64),
    /// `@rot`.
    pub rot: i64,
    /// `@flipH`.
    pub flip_h: bool,
    /// `@flipV`.
    pub flip_v: bool,
    /// `a:chOff` (groups only).
    pub ch_off: Option<(i64, i64)>,
    /// `a:chExt` (groups only).
    pub ch_ext: Option<(i64, i64)>,
}

/// Parses an `a:xfrm` element.
pub fn read_xfrm(el: &El) -> Xfrm {
    let pair = |name: &str, a: &str, b: &str| {
        el.child(name).map(|c| {
            (
                c.attr(a).and_then(parse_i64).unwrap_or(0),
                c.attr(b).and_then(parse_i64).unwrap_or(0),
            )
        })
    };
    let flag = |a: &str| el.attr(a).and_then(parse_bool).unwrap_or(false);
    Xfrm {
        off: pair("off", "x", "y").unwrap_or_default(),
        ext: pair("ext", "cx", "cy").unwrap_or_default(),
        rot: el.attr("rot").and_then(parse_i64).unwrap_or(0),
        flip_h: flag("flipH"),
        flip_v: flag("flipV"),
        ch_off: pair("chOff", "x", "y"),
        ch_ext: pair("chExt", "cx", "cy"),
    }
}

/// A coordinate space: maps raw file coordinates (slide space, or a
/// group's child space `chOff`/`chExt`) to model coordinates (relative to
/// the parent group's top-left corner, at scale 1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Space {
    off_x: i64,
    off_y: i64,
    sx: f64,
    sy: f64,
}

impl Space {
    /// Slide space: coordinates are taken as they are.
    pub const SLIDE: Space = Space {
        off_x: 0,
        off_y: 0,
        sx: 1.0,
        sy: 1.0,
    };

    /// Maps a shape's raw `xfrm` into the model.
    pub fn map(&self, xf: &Xfrm) -> Transform {
        let s = |v: i64, off: i64, k: f64| Emu(((v - off) as f64 * k).round() as i64);
        Transform {
            x: s(xf.off.0, self.off_x, self.sx),
            y: s(xf.off.1, self.off_y, self.sy),
            w: s(xf.ext.0, 0, self.sx),
            h: s(xf.ext.1, 0, self.sy),
            rotation_deg: rot_to_deg(xf.rot),
            flip_h: xf.flip_h,
            flip_v: xf.flip_v,
        }
    }

    /// The child space of a group whose raw `xfrm` is `xf` and whose model
    /// transform (already mapped) is `group`: child coordinates are
    /// renormalized to `chOff` = 0 and `chExt` = the group's model size.
    pub fn child_space(group: &Transform, xf: &Xfrm) -> Space {
        let (ox, oy) = xf.ch_off.unwrap_or(xf.off);
        let (cw, ch) = xf.ch_ext.unwrap_or(xf.ext);
        let k = |model: Emu, child: i64| {
            if child > 0 {
                model.0 as f64 / child as f64
            } else {
                1.0
            }
        };
        Space {
            off_x: ox,
            off_y: oy,
            sx: k(group.w, cw),
            sy: k(group.h, ch),
        }
    }
}

/// Writes `a:xfrm` (with `a:chOff` 0/0 and `a:chExt` = size for groups).
pub fn write_xfrm(x: &mut XmlOut, t: &Transform, group: bool) {
    let rot = deg_to_rot(t.rotation_deg).to_string();
    let mut attrs: Vec<(&str, &str)> = Vec::new();
    if rot != "0" {
        attrs.push(("rot", &rot));
    }
    if t.flip_h {
        attrs.push(("flipH", "1"));
    }
    if t.flip_v {
        attrs.push(("flipV", "1"));
    }
    let (px, py) = (t.x.0.to_string(), t.y.0.to_string());
    let (cx, cy) = (t.w.0.max(0).to_string(), t.h.0.max(0).to_string());
    x.start("a:xfrm", &attrs);
    x.empty("a:off", &[("x", &px), ("y", &py)]);
    x.empty("a:ext", &[("cx", &cx), ("cy", &cy)]);
    if group {
        x.empty("a:chOff", &[("x", "0"), ("y", "0")]);
        x.empty("a:chExt", &[("cx", &cx), ("cy", &cy)]);
    }
    x.end("a:xfrm");
}

// --- colors ---------------------------------------------------------------------

/// The scheme value written for a theme slot (`tx1`/`bg1`/`tx2`/`bg2` for
/// the dark/light slots, as PowerPoint writes them in slides).
pub fn scheme_val(slot: ThemeColorSlot) -> &'static str {
    match slot {
        ThemeColorSlot::Dark1 => "tx1",
        ThemeColorSlot::Light1 => "bg1",
        ThemeColorSlot::Dark2 => "tx2",
        ThemeColorSlot::Light2 => "bg2",
        other => other.ooxml_scheme_name(),
    }
}

/// A few `a:prstClr` names.
pub(crate) fn preset_color(name: &str) -> Option<Rgb> {
    let hex = match name {
        "black" => "000000",
        "white" => "FFFFFF",
        "red" => "FF0000",
        "green" => "008000",
        "lime" => "00FF00",
        "blue" => "0000FF",
        "yellow" => "FFFF00",
        "cyan" | "aqua" => "00FFFF",
        "magenta" | "fuchsia" => "FF00FF",
        "gray" | "grey" => "808080",
        "darkGray" | "darkGrey" => "A9A9A9",
        "lightGray" | "lightGrey" => "D3D3D3",
        "silver" => "C0C0C0",
        "orange" => "FFA500",
        "navy" => "000080",
        "maroon" => "800000",
        "purple" => "800080",
        "teal" => "008080",
        "olive" => "808000",
        _ => return None,
    };
    Rgb::from_hex(hex).ok()
}

/// The tint (see [`core_model::apply_tint`]) expressed by the modifier
/// children of a color element. `lumMod`/`lumOff` map exactly
/// (`lumMod = 1 − t`, `lumOff = t` for lighter, `lumMod = 1 + t` for
/// darker); `a:shade`/`a:tint` are approximated.
fn color_tint(el: &El, w: &mut Warnings) -> f64 {
    let pct = |c: &El| c.attr("val").and_then(parse_i64).unwrap_or(100_000) as f64 / 100_000.0;
    let (mut lum_mod, mut lum_off, mut other) = (1.0, 0.0, 0.0);
    for c in el.elements() {
        match c.name.as_str() {
            "lumMod" => lum_mod = pct(c),
            "lumOff" => lum_off = pct(c),
            // approximations (no warning: PowerPoint's default shape
            // outline is `shade 50000`, which model-show writes as −0.5)
            "shade" => other = -(1.0 - pct(c)),
            "tint" => other = 1.0 - pct(c),
            "alpha" => w.add("color transparency (a:alpha) dropped"),
            _ => w.add(format!("color modifier {} dropped", c.qname())),
        }
    }
    let t = if lum_off > 0.0 {
        lum_off
    } else if lum_mod < 1.0 {
        lum_mod - 1.0
    } else {
        other
    };
    (t.clamp(-1.0, 1.0) * 100_000.0).round() / 100_000.0
}

/// sRGB encoding of a linear channel in `0..=1`.
fn srgb_encode(v: f64) -> u8 {
    let v = v.clamp(0.0, 1.0);
    let e = if v <= 0.003_130_8 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (e * 255.0).round() as u8
}

/// A color element (`a:srgbClr`, `a:schemeClr`, `a:sysClr`, `a:prstClr`,
/// `a:scrgbClr`) → [`Color`]. `phClr` and unknown elements give `None`.
pub fn color_of(el: &El, w: &mut Warnings) -> Option<Color> {
    let rgb_with_mods = |rgb: Rgb, w: &mut Warnings| {
        let t = color_tint(el, w);
        Color::Rgb(apply_tint(rgb, t))
    };
    match el.name.as_str() {
        "srgbClr" => {
            let rgb = Rgb::from_hex(el.attr("val")?).ok()?;
            Some(rgb_with_mods(rgb, w))
        }
        "sysClr" => {
            let rgb = el.attr("lastClr").and_then(|h| Rgb::from_hex(h).ok())?;
            Some(rgb_with_mods(rgb, w))
        }
        "prstClr" => {
            let name = el.attr("val").unwrap_or("");
            match preset_color(name) {
                Some(rgb) => Some(rgb_with_mods(rgb, w)),
                None => {
                    w.add(format!("preset color {name} read as black"));
                    Some(Color::Rgb(Rgb::new(0, 0, 0)))
                }
            }
        }
        "scrgbClr" => {
            let ch = |a: &str| el.attr(a).and_then(parse_i64).unwrap_or(0) as f64 / 100_000.0;
            let rgb = Rgb::new(
                srgb_encode(ch("r")),
                srgb_encode(ch("g")),
                srgb_encode(ch("b")),
            );
            Some(rgb_with_mods(rgb, w))
        }
        "schemeClr" => {
            let slot = ThemeColorSlot::from_ooxml_name(el.attr("val")?)?;
            Some(Color::Theme {
                slot,
                tint: color_tint(el, w),
            })
        }
        "hslClr" => {
            w.add("HSL colors (a:hslClr) dropped");
            None
        }
        _ => None,
    }
}

const COLOR_ELEMENTS: [&str; 6] = [
    "srgbClr",
    "schemeClr",
    "sysClr",
    "prstClr",
    "scrgbClr",
    "hslClr",
];

/// The first color child of `parent` with its opacity (`a:alpha`, 1 when
/// absent; the alpha is not part of [`Color`]).
pub fn color_and_alpha(parent: &El, w: &mut Warnings) -> Option<(Color, f64)> {
    let c = parent
        .elements()
        .find(|c| COLOR_ELEMENTS.contains(&c.name.as_str()))?;
    let mut c = c.clone();
    let mut alpha: f64 = 1.0;
    c.children.retain(|n| match n {
        fmt_ooxml::xml::Node::El(e) if e.name == "alpha" => {
            alpha = e.attr("val").and_then(parse_i64).unwrap_or(100_000) as f64 / 100_000.0;
            false
        }
        _ => true,
    });
    Some((color_of(&c, w)?, alpha.clamp(0.0, 1.0)))
}

/// The first color child of `parent` (e.g. of `a:solidFill`).
pub fn read_color(parent: &El, w: &mut Warnings) -> Option<Color> {
    parent
        .elements()
        .find(|c| COLOR_ELEMENTS.contains(&c.name.as_str()))
        .and_then(|c| color_of(c, w))
}

/// Writes a color element.
pub fn write_color(x: &mut XmlOut, c: &Color) {
    write_color_with_alpha(x, c, 1.0);
}

/// Writes a color element, with an `a:alpha` child when `alpha < 1`.
pub fn write_color_with_alpha(x: &mut XmlOut, c: &Color, alpha: f64) {
    let n = |v: f64| ((v * 100_000.0).round() as i64).to_string();
    let mut mods: Vec<(&str, String)> = Vec::new();
    let (name, val) = match *c {
        Color::Auto => ("a:schemeClr", "tx1".to_owned()),
        Color::Rgb(rgb) => ("a:srgbClr", rgb.to_hex()),
        Color::Theme { slot, tint } => {
            if tint != 0.0 && !tint.is_nan() {
                let t = tint.clamp(-1.0, 1.0);
                if t < 0.0 {
                    mods.push(("a:lumMod", n(1.0 + t)));
                } else {
                    mods.push(("a:lumMod", n(1.0 - t)));
                    mods.push(("a:lumOff", n(t)));
                }
            }
            ("a:schemeClr", scheme_val(slot).to_owned())
        }
    };
    if alpha < 1.0 {
        mods.push(("a:alpha", n(alpha.clamp(0.0, 1.0))));
    }
    if mods.is_empty() {
        x.empty(name, &[("val", &val)]);
        return;
    }
    x.start(name, &[("val", &val)]);
    for (m, v) in &mods {
        x.empty(m, &[("val", v)]);
    }
    x.end(name);
}

// --- fills and outlines ------------------------------------------------------------

/// The fill given by the fill child of `parent` (`a:noFill`, `a:solidFill`;
/// gradients and patterns are approximated by one of their colors).
/// `None` if `parent` specifies no fill (inherit).
pub fn read_fill(parent: &El, w: &mut Warnings) -> Option<Fill> {
    for el in parent.elements() {
        match el.name.as_str() {
            "noFill" => return Some(Fill::None),
            "solidFill" => return Some(read_color(el, w).map_or(Fill::None, Fill::Solid)),
            "gradFill" => {
                w.add("gradient fill read as its first color");
                let color = el.find("gs").and_then(|gs| read_color(gs, w));
                return Some(color.map_or(Fill::None, Fill::Solid));
            }
            "pattFill" => {
                w.add("pattern fill read as its foreground color");
                let color = el.child("fgClr").and_then(|c| read_color(c, w));
                return Some(color.map_or(Fill::None, Fill::Solid));
            }
            "blipFill" => {
                w.add("picture fill of a shape dropped");
                return Some(Fill::None);
            }
            "grpFill" => {
                w.add("group fill (a:grpFill) dropped");
                return Some(Fill::None);
            }
            _ => {}
        }
    }
    None
}

/// Writes a fill element.
pub fn write_fill(x: &mut XmlOut, fill: &Fill) {
    match fill {
        Fill::None => x.empty("a:noFill", &[]),
        Fill::Solid(c) => {
            x.start("a:solidFill", &[]);
            write_color(x, c);
            x.end("a:solidFill");
        }
    }
}

/// `a:prstDash/@val` → [`LineDash`] (`None` for values approximated as
/// dashes, so the caller can warn).
pub fn dash_from(val: &str) -> Option<LineDash> {
    match val {
        "solid" => Some(LineDash::Solid),
        "dash" | "sysDash" | "lgDash" => Some(LineDash::Dash),
        "dot" | "sysDot" => Some(LineDash::Dot),
        _ => None,
    }
}

/// [`LineDash`] → `a:prstDash/@val`.
pub fn dash_name(dash: LineDash) -> &'static str {
    match dash {
        LineDash::Solid => "solid",
        LineDash::Dash => "dash",
        LineDash::Dot => "sysDot",
    }
}

/// Theme line widths of the Office theme's `a:lnStyleLst` (for `a:lnRef`).
pub const STYLE_LINE_WIDTHS: [i64; 3] = [6_350, 12_700, 19_050];

/// Reads `a:ln`. `style` is the outline from the shape's `p:style/a:lnRef`
/// (used when `a:ln` gives no fill or width).
pub fn read_line(ln: Option<&El>, style: Option<Line>, w: &mut Warnings) -> Line {
    let base = style.unwrap_or_default();
    let Some(ln) = ln else {
        return base;
    };
    let mut line = base;
    if let Some(v) = ln.attr("w").and_then(parse_i64) {
        line.width = Emu(v.max(0));
    }
    if let Some(fill) = read_fill(ln, w) {
        line.fill = fill;
    } else if style.is_none() {
        line.fill = Fill::None;
    }
    if let Some(d) = ln.child("prstDash") {
        let val = d.attr("val").unwrap_or("solid");
        line.dash = dash_from(val).unwrap_or_else(|| {
            w.add(format!("line dash {val} read as dashed"));
            LineDash::Dash
        });
    } else if ln.child("custDash").is_some() {
        w.add("custom line dash read as dashed");
        line.dash = LineDash::Dash;
    }
    if ln.attr("cmpd").is_some_and(|c| c != "sng") {
        w.add("compound lines read as single lines");
    }
    line
}

/// Writes `a:ln` (always explicit: width, fill, dash).
pub fn write_line(x: &mut XmlOut, line: &Line) {
    write_line_with_ends(x, "a:ln", line, &ArrowEnd::default(), &ArrowEnd::default());
}

/// Writes an outline element `name` (`a:ln`, or `a:lnL` … in table cells)
/// with arrowheads (`a:headEnd`/`a:tailEnd`, only when set).
pub fn write_line_with_ends(
    x: &mut XmlOut,
    name: &str,
    line: &Line,
    head: &ArrowEnd,
    tail: &ArrowEnd,
) {
    let wv = line.width.0.max(0).to_string();
    x.start(name, &[("w", &wv)]);
    write_fill(x, &line.fill);
    x.empty("a:prstDash", &[("val", dash_name(line.dash))]);
    for (el, end) in [("a:headEnd", head), ("a:tailEnd", tail)] {
        if !end.is_none() {
            let mut attrs = vec![("type", arrow_kind_name(end.kind))];
            if end.width != ArrowSize::Medium {
                attrs.push(("w", arrow_size_name(end.width)));
            }
            if end.length != ArrowSize::Medium {
                attrs.push(("len", arrow_size_name(end.length)));
            }
            x.empty(el, &attrs);
        }
    }
    x.end(name);
}

fn arrow_kind_name(k: ArrowKind) -> &'static str {
    match k {
        ArrowKind::None => "none",
        ArrowKind::Triangle => "triangle",
        ArrowKind::Stealth => "stealth",
        ArrowKind::Diamond => "diamond",
        ArrowKind::Oval => "oval",
        ArrowKind::Arrow => "arrow",
    }
}

fn arrow_size_name(s: ArrowSize) -> &'static str {
    match s {
        ArrowSize::Small => "sm",
        ArrowSize::Medium => "med",
        ArrowSize::Large => "lg",
    }
}

/// The arrowheads of `a:ln` (`a:headEnd`, `a:tailEnd`; unknown types
/// read as triangles with a warning).
pub fn read_arrows(ln: Option<&El>, w: &mut Warnings) -> (ArrowEnd, ArrowEnd) {
    let end = |name: &str, w: &mut Warnings| {
        let Some(e) = ln.and_then(|l| l.child(name)) else {
            return ArrowEnd::default();
        };
        let kind = match e.attr("type").unwrap_or("none") {
            "none" => ArrowKind::None,
            "triangle" => ArrowKind::Triangle,
            "stealth" => ArrowKind::Stealth,
            "diamond" => ArrowKind::Diamond,
            "oval" => ArrowKind::Oval,
            "arrow" => ArrowKind::Arrow,
            other => {
                w.add(format!("arrowhead {other} read as a triangle"));
                ArrowKind::Triangle
            }
        };
        let size = |a: &str| match e.attr(a) {
            Some("sm") => ArrowSize::Small,
            Some("lg") => ArrowSize::Large,
            _ => ArrowSize::Medium,
        };
        ArrowEnd {
            kind,
            width: size("w"),
            length: size("len"),
        }
    };
    (end("headEnd", w), end("tailEnd", w))
}

// --- text: body and paragraphs --------------------------------------------------------

/// `a:bodyPr` over `props` (attributes that are absent keep `props`).
pub fn read_body_pr(bp: &El, props: &mut BodyProps, w: &mut Warnings) {
    match bp.attr("wrap") {
        Some("none") => props.wrap = false,
        Some("square") => props.wrap = true,
        _ => {}
    }
    for (a, slot) in [
        ("lIns", &mut props.insets.left),
        ("tIns", &mut props.insets.top),
        ("rIns", &mut props.insets.right),
        ("bIns", &mut props.insets.bottom),
    ] {
        if let Some(v) = bp.attr(a).and_then(parse_i64) {
            *slot = Emu(v);
        }
    }
    match bp.attr("anchor") {
        Some("t") => props.anchor = Anchor::Top,
        Some("ctr") => props.anchor = Anchor::Middle,
        Some("b") => props.anchor = Anchor::Bottom,
        Some(other) => w.add(format!("text anchor {other} read as top")),
        None => {}
    }
    if let Some(v) = bp.attr("vert") {
        match TextDirection::from_ooxml(v) {
            Some(d) => props.vert = d,
            None => w.add(format!("text direction {v} read as horizontal")),
        }
    }
    if let Some(n) = bp.attr("numCol").and_then(parse_u32) {
        props.columns = n.clamp(1, 16);
    }
    if let Some(v) = bp.attr("spcCol").and_then(parse_i64) {
        props.column_spacing = Emu(v.max(0));
    }
    if bp.attr("rot").and_then(parse_i64).is_some_and(|r| r != 0) {
        w.add("text rotation (a:bodyPr rot) dropped");
    }
    for el in bp.elements() {
        match el.name.as_str() {
            "noAutofit" => props.autofit = Autofit::None,
            "normAutofit" => {
                props.autofit = Autofit::Shrink;
                props.font_scale = el
                    .attr("fontScale")
                    .and_then(parse_percent)
                    .map_or(FULL_SCALE, |v| v.clamp(1_000, FULL_SCALE));
                props.line_reduction = el
                    .attr("lnSpcReduction")
                    .and_then(parse_percent)
                    .map_or(0, |v| v.min(FULL_SCALE));
            }
            "spAutoFit" => props.autofit = Autofit::Resize,
            "prstTxWarp" => w.add("text warp (WordArt) dropped"),
            "scene3d" | "sp3d" | "flatTx" => w.add("3-D text dropped"),
            _ => {}
        }
    }
}

/// An `ST_Percentage`: 1/1000 % (`62500`) or a percent string (`62.5%`).
fn parse_percent(v: &str) -> Option<u32> {
    match v.strip_suffix('%') {
        Some(p) => p
            .trim()
            .parse::<f64>()
            .ok()
            .map(|f| (f * 1000.0).round().max(0.0) as u32),
        None => v.trim().parse::<i64>().ok().map(|n| n.max(0) as u32),
    }
}

/// Writes the autofit child of `a:bodyPr` (`normAutofit` with its scale).
pub fn write_autofit(x: &mut XmlOut, p: &BodyProps) {
    match p.autofit {
        Autofit::None => x.empty("a:noAutofit", &[]),
        Autofit::Shrink => {
            let scale = p.font_scale.to_string();
            let red = p.line_reduction.to_string();
            let mut attrs = Vec::new();
            if p.font_scale != FULL_SCALE {
                attrs.push(("fontScale", scale.as_str()));
            }
            if p.line_reduction != 0 {
                attrs.push(("lnSpcReduction", red.as_str()));
            }
            x.empty("a:normAutofit", &attrs);
        }
        Autofit::Resize => x.empty("a:spAutoFit", &[]),
    }
}

/// Writes `a:bodyPr` with every modelled attribute and the autofit child.
pub fn write_body_pr(x: &mut XmlOut, p: &BodyProps) {
    write_body_pr_with(x, p, false);
}

/// [`write_body_pr`], with `vert="eaVert"` first when `vertical`.
pub fn write_body_pr_with(x: &mut XmlOut, p: &BodyProps, vertical: bool) {
    let ins =
        [p.insets.left, p.insets.top, p.insets.right, p.insets.bottom].map(|e| e.0.to_string());
    let anchor = match p.anchor {
        Anchor::Top => "t",
        Anchor::Middle => "ctr",
        Anchor::Bottom => "b",
    };
    let mut attrs = vec![
        ("wrap", if p.wrap { "square" } else { "none" }),
        ("lIns", &ins[0]),
        ("tIns", &ins[1]),
        ("rIns", &ins[2]),
        ("bIns", &ins[3]),
        ("rtlCol", "0"),
        ("anchor", anchor),
    ];
    if vertical {
        attrs.insert(0, ("vert", "eaVert"));
    } else if p.vert != TextDirection::Horizontal {
        attrs.insert(0, ("vert", p.vert.as_ooxml()));
    }
    let cols = p.columns.to_string();
    let spc = p.column_spacing.0.to_string();
    if p.columns > 1 {
        attrs.push(("numCol", &cols));
        if p.column_spacing.0 > 0 {
            attrs.push(("spcCol", &spc));
        }
    }
    x.start("a:bodyPr", &attrs);
    write_autofit(x, p);
    x.end("a:bodyPr");
}

/// `a:buAutoNum/@type` → scheme (`None` for unsupported schemes).
pub fn autonum_from(t: &str) -> Option<AutoNumScheme> {
    Some(match t {
        "arabicPeriod" => AutoNumScheme::ArabicPeriod,
        "arabicParenR" => AutoNumScheme::ArabicParenR,
        "alphaLcPeriod" => AutoNumScheme::AlphaLcPeriod,
        "alphaUcPeriod" => AutoNumScheme::AlphaUcPeriod,
        "romanLcPeriod" => AutoNumScheme::RomanLcPeriod,
        "romanUcPeriod" => AutoNumScheme::RomanUcPeriod,
        _ => return None,
    })
}

/// Scheme → `a:buAutoNum/@type`.
pub fn autonum_name(s: AutoNumScheme) -> &'static str {
    match s {
        AutoNumScheme::ArabicPeriod => "arabicPeriod",
        AutoNumScheme::ArabicParenR => "arabicParenR",
        AutoNumScheme::AlphaLcPeriod => "alphaLcPeriod",
        AutoNumScheme::AlphaUcPeriod => "alphaUcPeriod",
        AutoNumScheme::RomanLcPeriod => "romanLcPeriod",
        AutoNumScheme::RomanUcPeriod => "romanUcPeriod",
    }
}

/// A bullet element of `a:pPr` → [`Bullet`] (`None` for other elements).
pub fn bullet_of(el: &El, w: &mut Warnings) -> Option<Bullet> {
    match el.name.as_str() {
        "buNone" => Some(Bullet::None),
        "buChar" => Some(Bullet::Char(el.attr("char").unwrap_or("•").to_owned())),
        "buAutoNum" => {
            let t = el.attr("type").unwrap_or("arabicPeriod");
            if el
                .attr("startAt")
                .and_then(parse_u32)
                .is_some_and(|n| n != 1)
            {
                w.add("numbered list start value (startAt) dropped");
            }
            Some(Bullet::AutoNum(autonum_from(t).unwrap_or_else(|| {
                w.add(format!("numbering scheme {t} read as arabicPeriod"));
                AutoNumScheme::ArabicPeriod
            })))
        }
        "buBlip" => {
            w.add("picture bullets read as •");
            Some(Bullet::Char("•".to_owned()))
        }
        _ => None,
    }
}

fn read_spacing(el: &El) -> Option<TextSpacing> {
    if let Some(p) = el.child("spcPct").and_then(|c| c.attr("val")) {
        let p = p.trim();
        return match p.strip_suffix('%') {
            Some(n) => n
                .trim()
                .parse::<f64>()
                .ok()
                .map(|v| TextSpacing::Percent((v * 1000.0).round().max(0.0) as u32)),
            None => parse_u32(p).map(TextSpacing::Percent),
        };
    }
    el.child("spcPts")
        .and_then(|c| c.attr("val"))
        .and_then(parse_u32)
        .map(TextSpacing::Points)
}

/// `a:pPr` → paragraph properties.
pub fn read_ppr(ppr: &El, w: &mut Warnings) -> TextParagraphProps {
    let alignment = match ppr.attr("algn") {
        Some("l") => Some(Alignment::Left),
        Some("ctr") => Some(Alignment::Center),
        Some("r") => Some(Alignment::Right),
        Some("just") => Some(Alignment::Justify),
        Some(other) => {
            w.add(format!("paragraph alignment {other} read as justified"));
            Some(Alignment::Justify)
        }
        None => None,
    };
    let mut p = TextParagraphProps {
        alignment,
        ..TextParagraphProps::default()
    };
    if let Some(l) = ppr.attr("lvl").and_then(parse_u32) {
        p.level = l.min(8) as u8;
    }
    if ppr.attr("rtl").and_then(parse_bool) == Some(true) {
        w.add("right-to-left paragraph direction dropped");
    }
    for el in ppr.elements() {
        match el.name.as_str() {
            "lnSpc" => p.line_spacing = read_spacing(el),
            "spcBef" => p.spacing_before = read_spacing(el),
            "spcAft" => p.spacing_after = read_spacing(el),
            "tabLst" => {
                if el.elements().next().is_some() {
                    w.add("tab stops dropped");
                }
            }
            "buClrTx" | "buClr" | "buSzTx" | "buSzPct" | "buSzPts" | "buFontTx" | "buFont"
            | "defRPr" | "extLst" => {}
            _ => {
                if let Some(b) = bullet_of(el, w) {
                    p.bullet = Some(b);
                } else {
                    w.add(format!("paragraph property {} dropped", el.qname()));
                }
            }
        }
    }
    p
}

/// A `latin` typeface → font face (`+mj-lt`/`+mn-lt` → theme slots).
pub fn font_from_typeface(t: &str) -> Option<FontFace> {
    let slot = match t {
        "" => return None,
        "+mj-lt" => ThemeFontSlot::MajorLatin,
        "+mn-lt" => ThemeFontSlot::MinorLatin,
        "+mj-ea" => ThemeFontSlot::MajorEastAsian,
        "+mn-ea" => ThemeFontSlot::MinorEastAsian,
        "+mj-cs" => ThemeFontSlot::MajorComplexScript,
        "+mn-cs" => ThemeFontSlot::MinorComplexScript,
        named => return Some(FontFace::Named(named.to_owned())),
    };
    Some(FontFace::Theme(slot))
}

/// Font face → `a:latin/@typeface` (theme slots as `+mj-lt`/`+mn-lt`).
pub fn typeface_of(f: &FontFace) -> &str {
    match f {
        FontFace::Named(n) => n,
        FontFace::Theme(
            ThemeFontSlot::MajorLatin
            | ThemeFontSlot::MajorEastAsian
            | ThemeFontSlot::MajorComplexScript,
        ) => "+mj-lt",
        FontFace::Theme(_) => "+mn-lt",
    }
}

/// `a:u` value → underline.
fn underline_from(v: &str) -> Underline {
    match v {
        "none" => Underline::None,
        "dbl" => Underline::Double,
        "dotted" | "dottedHeavy" => Underline::Dotted,
        "wavy" | "wavyHeavy" | "wavyDbl" => Underline::Wavy,
        v if v.starts_with("dash") || v.starts_with("dotDash") || v.starts_with("dotDotDash") => {
            Underline::Dashed
        }
        _ => Underline::Single,
    }
}

fn underline_name(u: Underline) -> &'static str {
    match u {
        Underline::None => "none",
        Underline::Single => "sng",
        Underline::Double => "dbl",
        Underline::Dotted => "dotted",
        Underline::Dashed => "dash",
        Underline::Wavy => "wavy",
    }
}

/// `a:rPr` (or `a:endParaRPr`/`a:defRPr`) → run properties.
pub fn read_rpr(rpr: &El, w: &mut Warnings) -> RunProperties {
    let mut p = RunProperties::default();
    let flag = |a: &str| rpr.attr(a).and_then(parse_bool);
    if let Some(sz) = rpr.attr("sz").and_then(parse_u32) {
        p.size = Some(FontSize::from_hundredths(sz));
    }
    p.bold = flag("b");
    p.italic = flag("i");
    p.underline = rpr.attr("u").map(underline_from);
    p.strike = rpr.attr("strike").map(|s| s != "noStrike");
    p.vertical_align = rpr
        .attr("baseline")
        .and_then(parse_i64)
        .map(|b| match b.signum() {
            1 => VerticalAlign::Superscript,
            -1 => VerticalAlign::Subscript,
            _ => VerticalAlign::Baseline,
        });
    if rpr.attr("cap").is_some_and(|c| c != "none") {
        w.add("capitalization (cap) dropped");
    }
    if rpr.attr("spc").and_then(parse_i64).is_some_and(|s| s != 0) {
        w.add("character spacing (spc) dropped");
    }
    for el in rpr.elements() {
        match el.name.as_str() {
            "solidFill" => p.color = read_color(el, w),
            "gradFill" => {
                w.add("gradient text fill read as its first color");
                p.color = el.find("gs").and_then(|gs| read_color(gs, w));
            }
            "noFill" => w.add("invisible text (a:noFill) read as normal text"),
            "highlight" => p.highlight = read_color(el, w),
            "latin" => p.font = el.attr("typeface").and_then(font_from_typeface),
            "ln" => w.add("text outline dropped"),
            "effectLst" | "effectDag" => {
                if el.elements().next().is_some() {
                    w.add("text effects dropped");
                }
            }
            // runs: read by `read_paragraph`
            "hlinkClick" => {}
            "hlinkMouseOver" => w.add("mouse-over hyperlinks dropped"),
            "ea" | "cs" | "sym" | "uLnTx" | "uLn" | "uFillTx" | "uFill" | "rtl" | "extLst" => {}
            _ => w.add(format!("run property {} dropped", el.qname())),
        }
    }
    p
}

/// Writes `a:rPr` (or another `CT_TextCharacterProperties` element named
/// `name`); nothing if the properties are empty and `always` is false.
pub fn write_rpr(x: &mut XmlOut, name: &str, p: &RunProperties, always: bool) {
    write_rpr_link(x, name, p, always, None);
}

/// [`write_rpr`] with a hyperlink (`a:hlinkClick` as the last child).
pub fn write_rpr_link(
    x: &mut XmlOut,
    name: &str,
    p: &RunProperties,
    always: bool,
    link: Option<&LinkXml>,
) {
    if p.is_empty() && !always && link.is_none() {
        return;
    }
    let sz = p.size.map(|s| s.hundredths().to_string());
    let mut attrs: Vec<(&str, &str)> = Vec::new();
    if let Some(sz) = &sz {
        attrs.push(("sz", sz));
    }
    let b = |v: bool| if v { "1" } else { "0" };
    if let Some(v) = p.bold {
        attrs.push(("b", b(v)));
    }
    if let Some(v) = p.italic {
        attrs.push(("i", b(v)));
    }
    if let Some(u) = p.underline {
        attrs.push(("u", underline_name(u)));
    }
    if let Some(s) = p.strike {
        attrs.push(("strike", if s { "sngStrike" } else { "noStrike" }));
    }
    if let Some(va) = p.vertical_align {
        attrs.push((
            "baseline",
            match va {
                VerticalAlign::Superscript => "30000",
                VerticalAlign::Subscript => "-25000",
                VerticalAlign::Baseline => "0",
            },
        ));
    }
    let color = p.color.filter(|c| *c != Color::Auto);
    let highlight = p.highlight.filter(|c| *c != Color::Auto);
    if color.is_none() && highlight.is_none() && p.font.is_none() && link.is_none() {
        x.empty(name, &attrs);
        return;
    }
    x.start(name, &attrs);
    if let Some(c) = &color {
        x.start("a:solidFill", &[]);
        write_color(x, c);
        x.end("a:solidFill");
    }
    if let Some(c) = &highlight {
        x.start("a:highlight", &[]);
        write_color(x, c);
        x.end("a:highlight");
    }
    if let Some(f) = &p.font {
        x.empty("a:latin", &[("typeface", typeface_of(f))]);
    }
    if let Some(l) = link {
        write_hlink(x, l);
    }
    x.end(name);
}

/// Appends `text` with `props` to `runs`, merging with the previous run if
/// it has the same formatting (fields are never merged). Empty text is
/// ignored.
fn push_run(runs: &mut Vec<TextRun>, props: RunProperties, text: &str, link: Option<Hyperlink>) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = runs.last_mut() {
        if last.props == props && last.field.is_none() && last.hyperlink == link {
            last.text.push_str(text);
            return;
        }
    }
    runs.push(TextRun {
        props,
        text: text.to_owned(),
        field: None,
        hyperlink: link,
    });
}

/// `a:p` → paragraph. `a:br` becomes a `"\n"` in the run text; fields
/// (`a:fld`) become field runs with their current text.
pub fn read_paragraph(p: &El, w: &mut Warnings) -> TextParagraph {
    let mut para = TextParagraph::new();
    let props_of =
        |el: &El, w: &mut Warnings| el.child("rPr").map(|r| read_rpr(r, w)).unwrap_or_default();
    let link_of = |el: &El, w: &mut Warnings| {
        el.child("rPr")
            .and_then(|r| r.child("hlinkClick"))
            .and_then(|h| read_hlink(h, w))
    };
    for el in p.elements() {
        match el.name.as_str() {
            "pPr" => para.props = read_ppr(el, w),
            "r" => {
                let props = props_of(el, w);
                let link = link_of(el, w);
                let text = el.child("t").map(El::text).unwrap_or_default();
                push_run(&mut para.runs, props, &text, link);
            }
            "fld" => {
                let props = props_of(el, w);
                let text = el.child("t").map(El::text).unwrap_or_default();
                let field = TextField::from_ooxml(el.attr("type").unwrap_or(""));
                para.runs.push(TextRun {
                    props,
                    text,
                    field: Some(field),
                    hyperlink: link_of(el, w),
                });
            }
            "br" => {
                let props = props_of(el, w);
                let link = link_of(el, w);
                push_run(&mut para.runs, props, "\n", link);
            }
            "endParaRPr" | "extLst" => {}
            "AlternateContent" => w.add("equations and alternate text content dropped"),
            _ => w.add(format!("text content {} dropped", el.qname())),
        }
    }
    para
}

/// `p:txBody` (or `a:txBody`) → text body, starting from `base` body
/// properties (layout defaults for placeholders).
pub fn read_text_body(tx: &El, base: BodyProps, w: &mut Warnings) -> TextBody {
    let mut body = TextBody {
        props: base,
        paragraphs: Vec::new(),
    };
    for el in tx.elements() {
        match el.name.as_str() {
            "bodyPr" => read_body_pr(el, &mut body.props, w),
            "lstStyle" => {
                if el.elements().next().is_some() {
                    w.add("shape list styles (a:lstStyle) dropped");
                }
            }
            "p" => body.paragraphs.push(read_paragraph(el, w)),
            _ => {}
        }
    }
    body
}

/// Left margin and first-line indent written for bulleted paragraphs (the
/// model has no indents): PowerPoint's body levels (0.25" hanging, 0.5"
/// per level), 0.375" hanging for numbering.
pub fn bullet_indent(bullet: &Bullet, level: u8) -> Option<(i64, i64)> {
    let hang = match bullet {
        Bullet::None => return None,
        Bullet::Char(_) => 228_600,
        Bullet::AutoNum(_) => 342_900,
    };
    Some((hang + i64::from(level) * 457_200, -hang))
}

fn write_spacing(x: &mut XmlOut, name: &str, s: &TextSpacing) {
    x.start(name, &[]);
    match s {
        TextSpacing::Percent(v) => x.empty("a:spcPct", &[("val", &v.to_string())]),
        TextSpacing::Points(v) => x.empty("a:spcPts", &[("val", &v.to_string())]),
    }
    x.end(name);
}

/// Attributes of a paragraph-properties element in PowerPoint's order:
/// `marL` (bulleted only), `lvl` (if > 0), `indent`, `algn`.
pub fn ppr_attrs(p: &TextParagraphProps, with_level: bool) -> Vec<(&'static str, String)> {
    let mut v = Vec::new();
    let indent = p.bullet.as_ref().and_then(|b| bullet_indent(b, p.level));
    if let Some((m, _)) = indent {
        v.push(("marL", m.to_string()));
    }
    if with_level && p.level > 0 {
        v.push(("lvl", p.level.min(8).to_string()));
    }
    if let Some((_, i)) = indent {
        v.push(("indent", i.to_string()));
    }
    if let Some(a) = p.alignment {
        let a = match a {
            Alignment::Left => "l",
            Alignment::Center => "ctr",
            Alignment::Right => "r",
            Alignment::Justify => "just",
        };
        v.push(("algn", a.to_owned()));
    }
    v
}

/// Children of a paragraph-properties element: spacing, then bullet.
pub fn write_ppr_children(x: &mut XmlOut, p: &TextParagraphProps) {
    if let Some(s) = &p.line_spacing {
        write_spacing(x, "a:lnSpc", s);
    }
    if let Some(s) = &p.spacing_before {
        write_spacing(x, "a:spcBef", s);
    }
    if let Some(s) = &p.spacing_after {
        write_spacing(x, "a:spcAft", s);
    }
    match &p.bullet {
        None => {}
        Some(Bullet::None) => x.empty("a:buNone", &[]),
        Some(Bullet::Char(c)) => {
            x.empty("a:buFont", &[("typeface", "Arial")]);
            x.empty("a:buChar", &[("char", c)]);
        }
        Some(Bullet::AutoNum(s)) => {
            x.empty("a:buFont", &[("typeface", "+mj-lt")]);
            x.empty("a:buAutoNum", &[("type", autonum_name(*s))]);
        }
    }
}

/// Writes `a:pPr` (nothing if the properties are empty).
pub fn write_ppr(x: &mut XmlOut, name: &str, p: &TextParagraphProps) {
    if p.is_empty() {
        return;
    }
    let attrs = ppr_attrs(p, true);
    let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let has_children = p.line_spacing.is_some()
        || p.spacing_before.is_some()
        || p.spacing_after.is_some()
        || p.bullet.is_some();
    if !has_children {
        x.empty(name, &attrs);
        return;
    }
    x.start(name, &attrs);
    write_ppr_children(x, p);
    x.end(name);
}

/// `a:fld/@id` of the fields we write (one GUID per field type).
fn field_guid(f: &TextField) -> &'static str {
    match f {
        TextField::SlideNumber => crate::master::NUMBER_FIELD_GUID,
        TextField::DateTime { .. } => crate::master::DATE_FIELD_GUID,
        TextField::Other { .. } => "{3A7E6C1D-2B8F-4E59-9C1A-6D0F5B2E8A47}",
    }
}

/// Writes one run: `\n` and U+000B become `a:br` (with the run's
/// formatting), `\r` is dropped; a field run becomes `a:fld`.
fn write_run(x: &mut XmlOut, run: &TextRun, links: &mut dyn LinkSink) {
    let link = run.hyperlink.as_ref().and_then(|h| links.link(h));
    let link = link.as_ref();
    if let Some(f) = &run.field {
        let ty = f.ooxml_type();
        x.start("a:fld", &[("id", field_guid(f)), ("type", &ty)]);
        write_rpr_link(x, "a:rPr", &run.props, true, link);
        let text: String = run.text.chars().filter(|c| !c.is_control()).collect();
        x.text_el("a:t", &[], &text);
        x.end("a:fld");
        return;
    }
    let mut seg = String::new();
    let flush = |x: &mut XmlOut, seg: &mut String| {
        if seg.is_empty() {
            return;
        }
        x.start("a:r", &[]);
        write_rpr_link(x, "a:rPr", &run.props, false, link);
        x.text_el("a:t", &[], seg);
        x.end("a:r");
        seg.clear();
    };
    for c in run.text.chars() {
        match c {
            '\n' | '\u{B}' => {
                flush(x, &mut seg);
                if run.props.is_empty() && link.is_none() {
                    x.empty("a:br", &[]);
                } else {
                    x.start("a:br", &[]);
                    write_rpr_link(x, "a:rPr", &run.props, false, link);
                    x.end("a:br");
                }
            }
            '\r' => {}
            c => seg.push(c),
        }
    }
    flush(x, &mut seg);
}

/// Writes `a:p`.
pub fn write_paragraph(x: &mut XmlOut, p: &TextParagraph, links: &mut dyn LinkSink) {
    if p.props.is_empty()
        && p.runs
            .iter()
            .all(|r| r.text.is_empty() && r.field.is_none())
    {
        x.empty("a:p", &[]);
        return;
    }
    x.start("a:p", &[]);
    write_ppr(x, "a:pPr", &p.props);
    for r in &p.runs {
        write_run(x, r, links);
    }
    x.end("a:p");
}

/// Writes a text body element `name` (`p:txBody`): `a:bodyPr`, an empty
/// `a:lstStyle` and the paragraphs (at least one).
pub fn write_text_body(x: &mut XmlOut, name: &str, body: &TextBody, links: &mut dyn LinkSink) {
    x.start(name, &[]);
    write_body_pr(x, &body.props);
    x.empty("a:lstStyle", &[]);
    if body.paragraphs.is_empty() {
        x.empty("a:p", &[]);
    }
    for p in &body.paragraphs {
        write_paragraph(x, p, links);
    }
    x.end(name);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    fn el(xml: &str) -> El {
        parse(xml.as_bytes(), "t").unwrap()
    }

    fn written(f: impl FnOnce(&mut XmlOut)) -> String {
        let mut x = XmlOut::new();
        f(&mut x);
        let s = String::from_utf8(x.finish()).unwrap();
        s[fmt_ooxml::xml::DECLARATION.len()..].to_owned()
    }

    #[test]
    fn rotation_units() {
        assert_eq!(rot_to_deg(19_800_000), 330.0);
        assert_eq!(rot_to_deg(5_400_000), 90.0);
        assert_eq!(rot_to_deg(-5_400_000), 270.0);
        assert_eq!(rot_to_deg(21_600_000), 0.0);
        assert_eq!(deg_to_rot(330.0), 19_800_000);
        assert_eq!(deg_to_rot(-30.0), 19_800_000);
        assert_eq!(deg_to_rot(360.0), 0);
        assert_eq!(deg_to_rot(12.5), 750_000);
        assert_eq!(deg_to_rot(f64::NAN), 0);
        for rot in [0, 1, 60_000, 1_234_567, 21_599_999] {
            assert_eq!(deg_to_rot(rot_to_deg(rot)), rot);
        }
    }

    #[test]
    fn xfrm_and_emu() {
        let xf = read_xfrm(&el(
            r#"<a:xfrm rot="5400000" flipH="1"><a:off x="100" y="-200"/><a:ext cx="300" cy="400"/></a:xfrm>"#,
        ));
        let t = Space::SLIDE.map(&xf);
        assert_eq!((t.x.0, t.y.0, t.w.0, t.h.0), (100, -200, 300, 400));
        assert_eq!(t.rotation_deg, 90.0);
        assert!(t.flip_h && !t.flip_v);
        let s = written(|x| write_xfrm(x, &t, false));
        assert_eq!(
            s,
            r#"<a:xfrm rot="5400000" flipH="1"><a:off x="100" y="-200"/><a:ext cx="300" cy="400"/></a:xfrm>"#
        );
        assert_eq!(Space::SLIDE.map(&read_xfrm(&el(&s))), t);
        let g = written(|x| write_xfrm(x, &Transform::new(Emu(1), Emu(2), Emu(3), Emu(4)), true));
        assert!(g.ends_with(r#"<a:chOff x="0" y="0"/><a:chExt cx="3" cy="4"/></a:xfrm>"#));
    }

    #[test]
    fn group_child_coordinates() {
        // LibreOffice style: chOff = off, chExt = ext → children rebased.
        let gx = read_xfrm(&el(
            r#"<a:xfrm><a:off x="1800000" y="1440000"/><a:ext cx="6120000" cy="3240000"/><a:chOff x="1800000" y="1440000"/><a:chExt cx="6120000" cy="3240000"/></a:xfrm>"#,
        ));
        let g = Space::SLIDE.map(&gx);
        let inner = Space::child_space(&g, &gx);
        let cx = read_xfrm(&el(
            r#"<a:xfrm><a:off x="4320000" y="2520000"/><a:ext cx="3600000" cy="2160000"/></a:xfrm>"#,
        ));
        let c = inner.map(&cx);
        assert_eq!(
            (c.x.0, c.y.0, c.w.0, c.h.0),
            (2_520_000, 1_080_000, 3_600_000, 2_160_000)
        );

        // Scaled child space: chExt is twice the extent → children halve.
        let gx = read_xfrm(&el(
            r#"<a:xfrm><a:off x="1000" y="2000"/><a:ext cx="500" cy="300"/><a:chOff x="100" y="100"/><a:chExt cx="1000" cy="600"/></a:xfrm>"#,
        ));
        let g = Space::SLIDE.map(&gx);
        let inner = Space::child_space(&g, &gx);
        let c = inner.map(&read_xfrm(&el(
            r#"<a:xfrm><a:off x="300" y="700"/><a:ext cx="200" cy="100"/></a:xfrm>"#,
        )));
        assert_eq!((c.x.0, c.y.0, c.w.0, c.h.0), (100, 300, 100, 50));

        // Nested: inner group in the scaled space, its children at its scale.
        let ngx = read_xfrm(&el(
            r#"<a:xfrm><a:off x="100" y="100"/><a:ext cx="400" cy="400"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm>"#,
        ));
        let ng = inner.map(&ngx);
        assert_eq!((ng.x.0, ng.w.0), (0, 200));
        let leaf = Space::child_space(&ng, &ngx).map(&read_xfrm(&el(
            r#"<a:xfrm><a:off x="50" y="0"/><a:ext cx="50" cy="10"/></a:xfrm>"#,
        )));
        assert_eq!((leaf.x.0, leaf.w.0, leaf.h.0), (100, 100, 20));

        // Our own output (chOff 0, chExt = ext) is the identity.
        let t = Transform::new(Emu(10), Emu(20), Emu(30), Emu(40));
        let ox = read_xfrm(&el(&written(|x| write_xfrm(x, &t, true))));
        let s = Space::child_space(&Space::SLIDE.map(&ox), &ox);
        let child = Transform::new(Emu(5), Emu(6), Emu(7), Emu(8));
        let cx = read_xfrm(&el(&written(|x| write_xfrm(x, &child, false))));
        assert_eq!(s.map(&cx), child);
    }

    #[test]
    fn colors_and_theme_tints() {
        let mut w = Warnings::default();
        let c = |xml: &str, w: &mut Warnings| color_of(&el(xml), w);
        assert_eq!(
            c(r#"<a:srgbClr val="3465a4"/>"#, &mut w),
            Some(Color::Rgb(Rgb::new(0x34, 0x65, 0xA4)))
        );
        assert_eq!(
            c(r#"<a:schemeClr val="tx1"/>"#, &mut w),
            Some(Color::theme(ThemeColorSlot::Dark1))
        );
        assert_eq!(
            c(
                r#"<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>"#,
                &mut w
            ),
            Some(Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: -0.25
            })
        );
        assert_eq!(
            c(
                r#"<a:schemeClr val="accent2"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>"#,
                &mut w
            ),
            Some(Color::Theme {
                slot: ThemeColorSlot::Accent2,
                tint: 0.4
            })
        );
        assert_eq!(
            c(r#"<a:sysClr val="windowText" lastClr="000000"/>"#, &mut w),
            Some(Color::Rgb(Rgb::new(0, 0, 0)))
        );
        assert_eq!(
            c(r#"<a:prstClr val="red"/>"#, &mut w),
            Some(Color::Rgb(Rgb::new(255, 0, 0)))
        );
        assert_eq!(
            c(r#"<a:scrgbClr r="100000" g="0" b="21404"/>"#, &mut w),
            Some(Color::Rgb(Rgb::new(255, 0, 127)))
        );
        assert_eq!(c(r#"<a:schemeClr val="phClr"/>"#, &mut w), None);
        assert!(w.into_vec().is_empty());

        // write → read is exact for theme tints
        for tint in [0.0, -0.25, -0.5, 0.4, 0.8, 0.15] {
            let col = Color::Theme {
                slot: ThemeColorSlot::Accent4,
                tint,
            };
            let s = written(|x| write_color(x, &col));
            assert_eq!(
                color_of(&el(&s), &mut Warnings::default()),
                Some(col),
                "{s}"
            );
        }
        assert_eq!(
            written(|x| write_color(x, &Color::theme(ThemeColorSlot::Light1))),
            r#"<a:schemeClr val="bg1"/>"#
        );
        let mut w = Warnings::default();
        c(
            r#"<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>"#,
            &mut w,
        );
        assert_eq!(w.into_vec(), ["color transparency (a:alpha) dropped"]);
    }

    #[test]
    fn fills_lines_and_dashes() {
        let mut w = Warnings::default();
        let sp = el(
            r#"<p:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln w="54000"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="sysDash"/></a:ln></p:spPr>"#,
        );
        assert_eq!(
            read_fill(&sp, &mut w),
            Some(Fill::Solid(Color::Rgb(Rgb::new(255, 0, 0))))
        );
        let line = read_line(sp.child("ln"), None, &mut w);
        assert_eq!(line.width, Emu(54_000));
        assert_eq!(line.dash, LineDash::Dash);
        assert_eq!(line.fill, Fill::Solid(Color::Rgb(Rgb::new(0, 255, 0))));
        assert_eq!(read_fill(&el("<p:spPr/>"), &mut w), None);
        assert_eq!(
            read_fill(&el("<p:spPr><a:noFill/></p:spPr>"), &mut w),
            Some(Fill::None)
        );
        // ln without fill and without style: no outline
        let l = read_line(Some(&el(r#"<a:ln w="9525"/>"#)), None, &mut w);
        assert!(l.is_none());
        assert!(w.into_vec().is_empty());

        for (val, dash) in [
            ("solid", Some(LineDash::Solid)),
            ("dash", Some(LineDash::Dash)),
            ("sysDash", Some(LineDash::Dash)),
            ("lgDash", Some(LineDash::Dash)),
            ("sysDot", Some(LineDash::Dot)),
            ("dot", Some(LineDash::Dot)),
            ("lgDashDotDot", None),
        ] {
            assert_eq!(dash_from(val), dash, "{val}");
        }
        for d in [LineDash::Solid, LineDash::Dash, LineDash::Dot] {
            assert_eq!(dash_from(dash_name(d)), Some(d));
            let line = Line {
                fill: Fill::Solid(Color::theme(ThemeColorSlot::Accent1)),
                width: Emu(25_400),
                dash: d,
            };
            let s = written(|x| write_line(x, &line));
            assert_eq!(
                read_line(Some(&el(&s)), None, &mut Warnings::default()),
                line
            );
        }
        let mut w = Warnings::default();
        let ln = el(
            r#"<a:ln><a:prstDash val="dashDot"/><a:tailEnd type="triangle"/><a:headEnd type="swirl" w="lg" len="sm"/></a:ln>"#,
        );
        read_line(Some(&ln), None, &mut w);
        let (head, tail) = read_arrows(Some(&ln), &mut w);
        assert_eq!(
            w.into_vec(),
            [
                "line dash dashDot read as dashed",
                "arrowhead swirl read as a triangle"
            ]
        );
        assert_eq!(tail, ArrowEnd::new(ArrowKind::Triangle));
        assert_eq!(
            head,
            ArrowEnd {
                kind: ArrowKind::Triangle,
                width: ArrowSize::Large,
                length: ArrowSize::Small
            }
        );
        // arrowheads round-trip
        let line = Line::solid(Color::theme(ThemeColorSlot::Accent1), Emu(9_525));
        let s = written(|x| write_line_with_ends(x, "a:ln", &line, &head, &tail));
        assert_eq!(
            s,
            r#"<a:ln w="9525"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:prstDash val="solid"/><a:headEnd type="triangle" w="lg" len="sm"/><a:tailEnd type="triangle"/></a:ln>"#
        );
        let mut w = Warnings::default();
        assert_eq!(read_arrows(Some(&el(&s)), &mut w), (head, tail));
        assert!(w.into_vec().is_empty());
    }

    #[test]
    fn bullets_and_paragraph_props() {
        let mut w = Warnings::default();
        let p = read_ppr(
            &el(
                r#"<a:pPr lvl="2" algn="ctr" marL="792000" indent="-216000"><a:spcBef><a:spcPts val="850"/></a:spcBef><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:buClr><a:srgbClr val="000000"/></a:buClr><a:buSzPct val="45000"/><a:buFont typeface=""/><a:buChar char="▪"/></a:pPr>"#,
            ),
            &mut w,
        );
        assert_eq!(p.level, 2);
        assert_eq!(p.alignment, Some(Alignment::Center));
        assert_eq!(p.bullet, Some(Bullet::Char("▪".into())));
        assert_eq!(p.spacing_before, Some(TextSpacing::Points(850)));
        assert_eq!(p.line_spacing, Some(TextSpacing::Percent(90_000)));
        let none = read_ppr(&el("<a:pPr><a:buNone/></a:pPr>"), &mut w);
        assert_eq!(none.bullet, Some(Bullet::None));
        let num = read_ppr(
            &el(r#"<a:pPr><a:buAutoNum type="romanUcPeriod"/></a:pPr>"#),
            &mut w,
        );
        assert_eq!(
            num.bullet,
            Some(Bullet::AutoNum(AutoNumScheme::RomanUcPeriod))
        );
        assert!(w.into_vec().is_empty());
        let mut w = Warnings::default();
        let odd = read_ppr(
            &el(r#"<a:pPr><a:buAutoNum type="circleNumDbPlain" startAt="3"/></a:pPr>"#),
            &mut w,
        );
        assert_eq!(
            odd.bullet,
            Some(Bullet::AutoNum(AutoNumScheme::ArabicPeriod))
        );
        assert_eq!(w.into_vec().len(), 2);

        for s in [
            AutoNumScheme::ArabicPeriod,
            AutoNumScheme::ArabicParenR,
            AutoNumScheme::AlphaLcPeriod,
            AutoNumScheme::AlphaUcPeriod,
            AutoNumScheme::RomanLcPeriod,
            AutoNumScheme::RomanUcPeriod,
        ] {
            assert_eq!(autonum_from(autonum_name(s)), Some(s));
        }
        for bullet in [
            Bullet::None,
            Bullet::Char("–".into()),
            Bullet::AutoNum(AutoNumScheme::AlphaLcPeriod),
        ] {
            let props = TextParagraphProps {
                alignment: Some(Alignment::Right),
                level: 1,
                bullet: Some(bullet),
                spacing_before: Some(TextSpacing::Percent(20_000)),
                spacing_after: Some(TextSpacing::Points(600)),
                line_spacing: Some(TextSpacing::Percent(150_000)),
            };
            let s = written(|x| write_ppr(x, "a:pPr", &props));
            assert_eq!(read_ppr(&el(&s), &mut Warnings::default()), props, "{s}");
        }
        assert_eq!(
            bullet_indent(&Bullet::Char("•".into()), 2),
            Some((1_143_000, -228_600))
        );
        assert_eq!(bullet_indent(&Bullet::None, 0), None);
    }

    #[test]
    fn run_props_roundtrip() {
        let props = RunProperties {
            font: Some(FontFace::Theme(ThemeFontSlot::MajorLatin)),
            size: Some(FontSize::from_pt(24.0)),
            bold: Some(true),
            italic: Some(false),
            underline: Some(Underline::Double),
            strike: Some(true),
            color: Some(Color::Theme {
                slot: ThemeColorSlot::Accent2,
                tint: -0.25,
            }),
            highlight: Some(Color::Rgb(Rgb::new(255, 255, 0))),
            vertical_align: Some(VerticalAlign::Superscript),
            ..Default::default()
        };
        let s = written(|x| write_rpr(x, "a:rPr", &props, false));
        assert_eq!(read_rpr(&el(&s), &mut Warnings::default()), props, "{s}");
        // LibreOffice's explicit defaults
        let lo = read_rpr(
            &el(
                r#"<a:rPr b="0" lang="en-US" sz="1800" strike="noStrike" u="none"><a:solidFill><a:srgbClr val="ffffff"/></a:solidFill><a:effectLst></a:effectLst><a:uFillTx/><a:latin typeface="Arial"/></a:rPr>"#,
            ),
            &mut Warnings::default(),
        );
        assert_eq!(lo.bold, Some(false));
        assert_eq!(lo.strike, Some(false));
        assert_eq!(lo.underline, Some(Underline::None));
        assert_eq!(lo.font, Some(FontFace::from("Arial")));
        assert_eq!(lo.size, Some(FontSize::from_pt(18.0)));
        assert_eq!(
            font_from_typeface("+mn-lt"),
            Some(FontFace::Theme(ThemeFontSlot::MinorLatin))
        );
        assert_eq!(font_from_typeface(""), None);
        assert_eq!(
            written(|x| write_rpr(x, "a:rPr", &RunProperties::default(), false)),
            ""
        );
    }

    #[test]
    fn paragraphs_breaks_and_fields() {
        let mut w = Warnings::default();
        let p = read_paragraph(
            &el(
                r#"<a:p><a:r><a:rPr b="1"/><a:t>one</a:t></a:r><a:br><a:rPr b="1"/></a:br><a:r><a:rPr b="1"/><a:t>two </a:t></a:r><a:fld id="x" type="slidenum"><a:t>3</a:t></a:fld><a:r><a:t></a:t></a:r><a:endParaRPr/></a:p>"#,
            ),
            &mut w,
        );
        assert_eq!(p.runs.len(), 2);
        assert_eq!(p.runs[0].text, "one\ntwo ");
        assert_eq!(p.runs[1].text, "3");
        assert_eq!(p.runs[1].field, Some(TextField::SlideNumber));
        assert!(w.into_vec().is_empty());
        let s = written(|x| write_paragraph(x, &p, &mut crate::link::NoLinks));
        assert!(s.contains(r#"<a:br><a:rPr b="1"/></a:br>"#), "{s}");
        assert!(
            s.contains(r#"<a:fld id="{9D3A5A06-5E21-4C21-9D1E-4F8B8A0E2C3D}" type="slidenum"><a:rPr/><a:t>3</a:t></a:fld>"#),
            "{s}"
        );
        assert_eq!(read_paragraph(&el(&s), &mut Warnings::default()), p);
        assert_eq!(
            written(|x| write_paragraph(x, &TextParagraph::new(), &mut crate::link::NoLinks)),
            "<a:p/>"
        );
    }

    #[test]
    fn body_props_roundtrip() {
        let props = BodyProps {
            anchor: Anchor::Bottom,
            wrap: false,
            insets: model_show::Insets {
                left: Emu(1),
                top: Emu(2),
                right: Emu(3),
                bottom: Emu(4),
            },
            autofit: Autofit::Resize,
            ..BodyProps::default()
        };
        let body = TextBody {
            props,
            paragraphs: vec![TextParagraph::plain("x")],
        };
        let s = written(|x| write_text_body(x, "p:txBody", &body, &mut crate::link::NoLinks));
        assert_eq!(
            read_text_body(&el(&s), BodyProps::default(), &mut Warnings::default()),
            body
        );
        // direction, columns and the shrink scale (P8-28)
        let shrunk = TextBody {
            props: BodyProps {
                autofit: Autofit::Shrink,
                font_scale: 62_500,
                line_reduction: 20_000,
                vert: TextDirection::Rotate270,
                columns: 2,
                column_spacing: Emu(91_440),
                ..BodyProps::default()
            },
            paragraphs: vec![TextParagraph::plain("x")],
        };
        let s = written(|x| write_text_body(x, "p:txBody", &shrunk, &mut crate::link::NoLinks));
        assert!(
            s.contains(r#"<a:normAutofit fontScale="62500" lnSpcReduction="20000"/>"#),
            "{s}"
        );
        assert!(
            s.contains(r#"vert="vert270""#) && s.contains(r#"numCol="2""#),
            "{s}"
        );
        assert_eq!(
            read_text_body(&el(&s), BodyProps::default(), &mut Warnings::default()),
            shrunk
        );
        let pct = read_text_body(
            &el(
                r#"<p:txBody><a:bodyPr vert="wordArtVert"><a:normAutofit fontScale="77.5%"/></a:bodyPr><a:p/></p:txBody>"#,
            ),
            BodyProps::default(),
            &mut Warnings::default(),
        );
        assert_eq!(pct.props.font_scale, 77_500);
        assert_eq!(pct.props.vert, TextDirection::Stacked);
        // absent attributes keep the base
        let base = BodyProps {
            anchor: Anchor::Middle,
            autofit: Autofit::Shrink,
            ..BodyProps::default()
        };
        let b = read_text_body(
            &el("<p:txBody><a:bodyPr/><a:p/></p:txBody>"),
            base,
            &mut Warnings::default(),
        );
        assert_eq!(b.props, base);
        assert_eq!(b.paragraphs, vec![TextParagraph::new()]);
    }
}
