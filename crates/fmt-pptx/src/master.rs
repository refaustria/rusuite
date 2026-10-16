//! Slide masters and layouts: the XML pieces shared by the reader and the
//! writer – text styles (`p:txStyles`), list styles of placeholders
//! (`a:lstStyle`, level 1), backgrounds, the colour map, header/footer
//! flags (`p:hf`) and placeholder shapes. The parts themselves are
//! assembled in `read.rs` / `write.rs` (they need the shape reader and
//! writer for decorative shapes).

use core_model::{RunProperties, ThemeColorSlot};
use model_show::{
    run_diff, Anchor, Background, BodyProps, ColorMap, Emu, HeaderFooter, HfDate, LevelStyle,
    PlaceholderDef, PlaceholderKind, TextField, TextParagraphProps, TextStyles,
};

use crate::drawing::{
    read_body_pr, read_color, read_fill, read_ppr, read_rpr, write_body_pr_with, write_color,
    write_fill, write_ppr_children, write_rpr, write_xfrm,
};
use crate::xml::{parse_bool, parse_i64, parse_u32, El, XmlOut};
use crate::Warnings;

/// Attributes PowerPoint writes on every text-style level.
pub const LEVEL_ATTRS: [(&str, &str); 5] = [
    ("defTabSz", "914400"),
    ("rtl", "0"),
    ("eaLnBrk", "1"),
    ("latinLnBrk", "0"),
    ("hangingPunct", "1"),
];

// --- reading ----------------------------------------------------------------------

/// One `a:lvlNpPr` → [`LevelStyle`].
pub fn read_level(lvl: &El, w: &mut Warnings) -> LevelStyle {
    let mut paragraph = read_ppr(lvl, w);
    paragraph.level = 0;
    LevelStyle {
        paragraph,
        run: lvl
            .child("defRPr")
            .map(|r| read_rpr(r, w))
            .unwrap_or_default(),
        margin_left: lvl.attr("marL").and_then(parse_i64).map(Emu),
        indent: lvl.attr("indent").and_then(parse_i64).map(Emu),
    }
}

/// The nine levels of a list-style element (`p:titleStyle`, `a:lstStyle`,
/// …); a missing level repeats the one above it (`base` for level 1).
fn read_levels(el: &El, base: &[LevelStyle], w: &mut Warnings) -> Vec<LevelStyle> {
    let mut out: Vec<LevelStyle> = Vec::with_capacity(9);
    for n in 1..=9 {
        let name = format!("lvl{n}pPr");
        let lvl = match el.child(&name) {
            Some(l) => read_level(l, w),
            None => out
                .last()
                .cloned()
                .or_else(|| base.first().cloned())
                .unwrap_or_default(),
        };
        out.push(lvl);
    }
    out
}

/// `p:txStyles` → [`TextStyles`] (missing styles: the Office ones).
pub fn read_text_styles(tx: Option<&El>, w: &mut Warnings) -> TextStyles {
    let office = TextStyles::office();
    let Some(tx) = tx else {
        return office;
    };
    let get = |name: &str, base: &[LevelStyle], w: &mut Warnings| {
        tx.child(name)
            .map_or_else(|| base.to_vec(), |el| read_levels(el, base, w))
    };
    TextStyles {
        title: get("titleStyle", &office.title, w),
        body: get("bodyStyle", &office.body, w),
        other: get("otherStyle", &office.other, w),
    }
}

/// Level 1 of a shape's `a:lstStyle` (paragraph and run properties; both
/// empty when there is none).
pub fn lst_style_lvl1(
    tx_body: Option<&El>,
    w: &mut Warnings,
) -> (TextParagraphProps, RunProperties) {
    tx_body
        .and_then(|t| t.child("lstStyle"))
        .and_then(|l| l.child("lvl1pPr"))
        .map(|lvl| {
            let l = read_level(lvl, w);
            (l.paragraph, l.run)
        })
        .unwrap_or_default()
}

/// `p:bg` → [`Background`] (`p:bgPr` fill or `p:bgRef idx` + colour).
pub fn read_background(bg: &El, w: &mut Warnings) -> Option<Background> {
    if let Some(pr) = bg.child("bgPr") {
        return read_fill(pr, w).map(Background::Fill);
    }
    let r = bg.child("bgRef")?;
    let index = r.attr("idx").and_then(parse_u32).unwrap_or(1001);
    let color = read_color(r, w)?;
    Some(Background::Style { index, color })
}

/// `p:clrMap` → [`ColorMap`].
pub fn read_clr_map(el: Option<&El>) -> ColorMap {
    let mut m = ColorMap::default();
    let Some(el) = el else {
        return m;
    };
    for (attr, slot) in [
        ("bg1", &mut m.bg1),
        ("tx1", &mut m.tx1),
        ("bg2", &mut m.bg2),
        ("tx2", &mut m.tx2),
    ] {
        if let Some(s) = el.attr(attr).and_then(ThemeColorSlot::from_ooxml_name) {
            *slot = s;
        }
    }
    m
}

/// `p:hf` flags `(dt, ftr, sldNum)`: absent element = all off, absent
/// attributes = on (the schema default).
pub fn hf_flags(el: Option<&El>) -> (bool, bool, bool) {
    let Some(el) = el else {
        return (false, false, false);
    };
    let f = |a: &str| el.attr(a).and_then(parse_bool).unwrap_or(true);
    (f("dt"), f("ftr"), f("sldNum"))
}

/// The header/footer settings of a master: flags from `p:hf`; footer text
/// and date from the master's (else the first layout's) footer and date
/// placeholder text (`texts`: `(kind, text, field)` of those placeholders,
/// master first). `not_on_title`: the Title Slide layout hides them.
pub fn header_footer_of(
    hf: Option<&El>,
    texts: &[(PlaceholderKind, String, Option<TextField>)],
    not_on_title: bool,
) -> HeaderFooter {
    let (dt, ftr, num) = hf_flags(hf);
    let first = |k: PlaceholderKind, pred: &dyn Fn(&str, &Option<TextField>) -> bool| {
        texts
            .iter()
            .find(|(kk, t, f)| *kk == k && pred(t, f))
            .map(|(_, t, f)| (t.clone(), f.clone()))
    };
    let date = if !dt {
        HfDate::Off
    } else {
        match first(PlaceholderKind::DateTime, &|t, f| {
            matches!(f, Some(TextField::DateTime { .. })) || (f.is_none() && !t.is_empty())
        }) {
            Some((_, Some(TextField::DateTime { format }))) => HfDate::Auto { format },
            Some((text, _)) => HfDate::Fixed { text },
            None => HfDate::Auto { format: 1 },
        }
    };
    let footer = ftr.then(|| {
        first(PlaceholderKind::Footer, &|t, _| !t.is_empty())
            .map(|(t, _)| t)
            .unwrap_or_default()
    });
    HeaderFooter {
        date,
        footer,
        slide_number: num,
        not_on_title: not_on_title && (dt || ftr || num),
    }
}

/// `a:bodyPr` of a master/layout placeholder over `base`, and whether it
/// is vertical (`vert="eaVert"`/`"vert"`, or `orient="vert"` on the
/// `p:ph`).
pub fn body_pr_of(
    tx_body: Option<&El>,
    base: BodyProps,
    orient_vert: bool,
    w: &mut Warnings,
) -> (BodyProps, bool) {
    let mut props = base;
    let mut vertical = orient_vert;
    if let Some(bp) = tx_body.and_then(|t| t.child("bodyPr")) {
        let mut bp = bp.clone();
        if let Some(i) = bp.attrs.iter().position(|(k, _)| k == "vert") {
            let (_, v) = bp.attrs.remove(i);
            vertical |= v != "horz";
        }
        read_body_pr(&bp, &mut props, w);
    }
    (props, vertical)
}

/// The placeholder kind of a `p:ph/@type` on a layout of kind `title`
/// (`title`/`ctrTitle` → centred title on Title Slide layouts, title
/// elsewhere). `None` for types we do not model (`hdr`, `clipArt`… →
/// body-like types are [`PlaceholderKind::Body`]).
pub fn kind_of_type(ty: &str, on_title_layout: bool) -> Option<PlaceholderKind> {
    Some(match ty {
        "title" | "ctrTitle" => {
            if on_title_layout {
                PlaceholderKind::CenteredTitle
            } else {
                PlaceholderKind::Title
            }
        }
        "subTitle" => PlaceholderKind::Subtitle,
        "pic" => PlaceholderKind::Picture,
        "dt" => PlaceholderKind::DateTime,
        "ftr" => PlaceholderKind::Footer,
        "sldNum" => PlaceholderKind::SlideNumber,
        "body" | "obj" | "chart" | "tbl" | "dgm" | "media" | "clipArt" => PlaceholderKind::Body,
        _ => return None,
    })
}

// --- writing ----------------------------------------------------------------------

/// Writes `p:bg` for `bg`.
pub fn write_background(x: &mut XmlOut, bg: &Background) {
    x.start("p:bg", &[]);
    match bg {
        Background::Fill(f) => {
            x.start("p:bgPr", &[]);
            write_fill(x, f);
            x.empty("a:effectLst", &[]);
            x.end("p:bgPr");
        }
        Background::Style { index, color } => {
            x.start("p:bgRef", &[("idx", &index.to_string())]);
            write_color(x, color);
            x.end("p:bgRef");
        }
        // written by the slide writer, which owns the image relationships
        Background::Picture(_) => {
            x.start("p:bgPr", &[]);
            x.empty("a:noFill", &[]);
            x.empty("a:effectLst", &[]);
            x.end("p:bgPr");
        }
    }
    x.end("p:bg");
}

/// Writes `p:clrMap`.
pub fn write_clr_map(x: &mut XmlOut, m: &ColorMap) {
    let name = |s: ThemeColorSlot| s.ooxml_scheme_name();
    x.empty(
        "p:clrMap",
        &[
            ("bg1", name(m.bg1)),
            ("tx1", name(m.tx1)),
            ("bg2", name(m.bg2)),
            ("tx2", name(m.tx2)),
            ("accent1", "accent1"),
            ("accent2", "accent2"),
            ("accent3", "accent3"),
            ("accent4", "accent4"),
            ("accent5", "accent5"),
            ("accent6", "accent6"),
            ("hlink", "hlink"),
            ("folHlink", "folHlink"),
        ],
    );
}

/// Writes `p:hf` with the flags of `hf` (all four attributes stated).
pub fn write_hf(x: &mut XmlOut, dt: bool, ftr: bool, num: bool) {
    let b = |v: bool| if v { "1" } else { "0" };
    x.empty(
        "p:hf",
        &[
            ("sldNum", b(num)),
            ("hdr", "0"),
            ("ftr", b(ftr)),
            ("dt", b(dt)),
        ],
    );
}

/// Writes one text-style level `name` (`a:lvl1pPr` …): `marL`,
/// `indent`, `algn` and PowerPoint's fixed attributes, then spacing,
/// bullet and `a:defRPr`.
fn write_level(x: &mut XmlOut, name: &str, l: &LevelStyle) {
    let mar = l.margin_left.map(|e| e.0.to_string());
    let ind = l.indent.map(|e| e.0.to_string());
    let algn = crate::drawing::ppr_attrs(
        &TextParagraphProps {
            alignment: l.paragraph.alignment,
            ..TextParagraphProps::default()
        },
        false,
    );
    let mut attrs: Vec<(&str, &str)> = Vec::new();
    if let Some(m) = &mar {
        attrs.push(("marL", m));
    }
    if let Some(i) = &ind {
        attrs.push(("indent", i));
    }
    for (k, v) in &algn {
        attrs.push((k, v));
    }
    attrs.extend(LEVEL_ATTRS);
    x.start(name, &attrs);
    write_ppr_children(x, &l.paragraph);
    write_rpr(x, "a:defRPr", &l.run, true);
    x.end(name);
}

/// Writes `p:txStyles`.
pub fn write_text_styles(x: &mut XmlOut, s: &TextStyles) {
    x.start("p:txStyles", &[]);
    for (name, levels, def) in [
        ("p:titleStyle", &s.title, false),
        ("p:bodyStyle", &s.body, false),
        ("p:otherStyle", &s.other, true),
    ] {
        x.start(name, &[]);
        if def {
            x.start("a:defPPr", &[]);
            x.empty("a:defRPr", &[("lang", "en-US")]);
            x.end("a:defPPr");
        }
        for (i, l) in levels.iter().take(9).enumerate() {
            write_level(x, &format!("a:lvl{}pPr", i + 1), l);
        }
        x.end(name);
    }
    x.end("p:txStyles");
}

/// Writes an `a:lstStyle` whose level 1 states `para`/`run` (empty
/// `a:lstStyle` when both are empty).
fn write_lst_style(x: &mut XmlOut, para: &TextParagraphProps, run: &RunProperties) {
    if para.is_empty() && run.is_empty() {
        x.empty("a:lstStyle", &[]);
        return;
    }
    x.start("a:lstStyle", &[]);
    let attrs = crate::drawing::ppr_attrs(para, false);
    let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    x.start("a:lvl1pPr", &attrs);
    write_ppr_children(x, para);
    if !run.is_empty() {
        write_rpr(x, "a:defRPr", run, true);
    }
    x.end("a:lvl1pPr");
    x.end("a:lstStyle");
}

/// Writes `a:bodyPr` stating only what differs from `base` (plus
/// `vert="eaVert"` for vertical placeholders).
fn write_body_pr_diff(x: &mut XmlOut, p: &BodyProps, base: &BodyProps, vertical: bool) {
    let mut attrs: Vec<(&str, String)> = Vec::new();
    if vertical {
        attrs.push(("vert", "eaVert".into()));
    }
    if p.wrap != base.wrap {
        attrs.push(("wrap", if p.wrap { "square" } else { "none" }.into()));
    }
    for (name, v, b) in [
        ("lIns", p.insets.left, base.insets.left),
        ("tIns", p.insets.top, base.insets.top),
        ("rIns", p.insets.right, base.insets.right),
        ("bIns", p.insets.bottom, base.insets.bottom),
    ] {
        if v != b {
            attrs.push((name, v.0.to_string()));
        }
    }
    if p.anchor != base.anchor {
        let a = match p.anchor {
            Anchor::Top => "t",
            Anchor::Middle => "ctr",
            Anchor::Bottom => "b",
        };
        attrs.push(("anchor", a.into()));
    }
    let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    if p.autofit == base.autofit
        && p.font_scale == base.font_scale
        && p.line_reduction == base.line_reduction
    {
        x.empty("a:bodyPr", &attrs);
        return;
    }
    x.start("a:bodyPr", &attrs);
    crate::drawing::write_autofit(x, p);
    x.end("a:bodyPr");
}

/// `p:ph` attributes of a master/layout/slide placeholder: `type` (none
/// for content placeholders), `orient="vert"`, `idx` (when ≠ 0).
pub fn ph_attrs(
    kind: PlaceholderKind,
    text_only: bool,
    vertical: bool,
    idx: u32,
) -> Vec<(&'static str, String)> {
    let ty = match kind {
        PlaceholderKind::Title => Some("title"),
        PlaceholderKind::CenteredTitle => Some("ctrTitle"),
        PlaceholderKind::Subtitle => Some("subTitle"),
        PlaceholderKind::Body if text_only => Some("body"),
        PlaceholderKind::Body => None,
        PlaceholderKind::Picture => Some("pic"),
        PlaceholderKind::DateTime => Some("dt"),
        PlaceholderKind::Footer => Some("ftr"),
        PlaceholderKind::SlideNumber => Some("sldNum"),
    };
    let mut v = Vec::new();
    if let Some(t) = ty {
        v.push(("type", t.to_owned()));
    }
    if vertical {
        v.push(("orient", "vert".to_owned()));
    }
    if idx != 0 {
        v.push(("idx", idx.to_string()));
    }
    v
}

/// PowerPoint's prompt text of a master/layout placeholder.
fn prompt_of(kind: PlaceholderKind, master: bool) -> &'static str {
    match kind {
        PlaceholderKind::Title | PlaceholderKind::CenteredTitle => {
            "Click to edit Master title style"
        }
        PlaceholderKind::Subtitle => "Click to edit Master subtitle style",
        PlaceholderKind::Body if master => "Click to edit Master text styles",
        PlaceholderKind::Body => "Click to edit Master text styles",
        PlaceholderKind::Picture => "Click icon to add picture",
        _ => "",
    }
}

/// How [`placeholder_sp`] writes a placeholder.
pub struct PhWrite<'a> {
    /// `p:cNvPr id`.
    pub id: u32,
    /// The definition.
    pub def: &'a PlaceholderDef,
    /// Text defaults the list style is relative to (`None`: write no
    /// list style).
    pub text_base: Option<(&'a TextParagraphProps, &'a RunProperties)>,
    /// Body properties the `a:bodyPr` is relative to (`None`: write all).
    pub body_base: Option<&'a BodyProps>,
    /// Write `a:xfrm` (layouts omit it when the master's is the same).
    pub xfrm: bool,
    /// Master placeholder (prompt texts).
    pub master: bool,
    /// The header/footer settings (text of date/footer/number).
    pub hf: &'a HeaderFooter,
}

/// A master or layout placeholder `p:sp`.
pub fn placeholder_sp(x: &mut XmlOut, ph: &PhWrite<'_>) {
    let def = ph.def;
    let id = ph.id.to_string();
    let base = match def.kind {
        PlaceholderKind::CenteredTitle | PlaceholderKind::Title => "Title Placeholder",
        PlaceholderKind::Subtitle => "Subtitle Placeholder",
        PlaceholderKind::Body if def.vertical => "Vertical Text Placeholder",
        PlaceholderKind::Body if def.text_only => "Text Placeholder",
        PlaceholderKind::Body => "Content Placeholder",
        PlaceholderKind::Picture => "Picture Placeholder",
        PlaceholderKind::DateTime => "Date Placeholder",
        PlaceholderKind::Footer => "Footer Placeholder",
        PlaceholderKind::SlideNumber => "Slide Number Placeholder",
    };
    let name = format!("{base} {}", ph.id - 1);
    x.start("p:sp", &[]);
    x.start("p:nvSpPr", &[]);
    x.empty("p:cNvPr", &[("id", &id), ("name", &name)]);
    x.start("p:cNvSpPr", &[]);
    x.empty("a:spLocks", &[("noGrp", "1")]);
    x.end("p:cNvSpPr");
    let mut attrs = ph_attrs(def.kind, def.text_only, def.vertical, def.idx);
    let prompt = def
        .prompt
        .as_deref()
        .filter(|_| !def.kind.is_header_footer());
    if prompt.is_some() {
        attrs.push(("hasCustomPrompt", "1".to_owned()));
    }
    let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    x.start("p:nvPr", &[]);
    x.empty("p:ph", &attrs);
    x.end("p:nvPr");
    x.end("p:nvSpPr");
    if ph.xfrm {
        x.start("p:spPr", &[]);
        write_xfrm(x, &def.transform, false);
        x.start("a:prstGeom", &[("prst", "rect")]);
        x.empty("a:avLst", &[]);
        x.end("a:prstGeom");
        x.end("p:spPr");
    } else {
        x.empty("p:spPr", &[]);
    }
    x.start("p:txBody", &[]);
    match ph.body_base {
        Some(b) => write_body_pr_diff(x, &def.body_defaults, b, def.vertical),
        None => write_body_pr_with(x, &def.body_defaults, def.vertical),
    }
    match ph.text_base {
        Some((p, r)) => write_lst_style(
            x,
            &def.paragraph_defaults.diff_from(p),
            &run_diff(&def.run_defaults, r),
        ),
        None => x.empty("a:lstStyle", &[]),
    }
    if let Some(prompt) = prompt {
        // custom prompt text: one paragraph per line (on the master's body
        // placeholder line N is outline level N, as its sample text)
        for (i, line) in prompt.split('\n').enumerate() {
            x.start("a:p", &[]);
            if ph.master && def.kind == PlaceholderKind::Body && (1..9).contains(&i) {
                x.empty("a:pPr", &[("lvl", &i.to_string())]);
            }
            text_run(x, line);
            x.empty("a:endParaRPr", &[("lang", "en-US")]);
            x.end("a:p");
        }
        x.end("p:txBody");
        x.end("p:sp");
        return;
    }
    x.start("a:p", &[]);
    let field = |x: &mut XmlOut, ty: &str, guid: &str, text: &str| {
        x.start("a:fld", &[("id", guid), ("type", ty)]);
        x.empty("a:rPr", &[("lang", "en-US")]);
        x.text_el("a:t", &[], text);
        x.end("a:fld");
    };
    match def.kind {
        PlaceholderKind::DateTime => match &ph.hf.date {
            HfDate::Auto { format } => field(
                x,
                &TextField::DateTime { format: *format }.ooxml_type(),
                DATE_FIELD_GUID,
                "",
            ),
            HfDate::Fixed { text } => text_run(x, text),
            HfDate::Off => field(x, "datetimeFigureOut", DATE_FIELD_GUID, ""),
        },
        PlaceholderKind::Footer => {
            if let Some(t) = ph.hf.footer.as_deref().filter(|t| !t.is_empty()) {
                text_run(x, t);
            }
        }
        PlaceholderKind::SlideNumber => field(x, "slidenum", NUMBER_FIELD_GUID, "‹#›"),
        k => text_run(x, prompt_of(k, ph.master)),
    }
    x.empty("a:endParaRPr", &[("lang", "en-US")]);
    x.end("a:p");
    x.end("p:txBody");
    x.end("p:sp");
}

fn text_run(x: &mut XmlOut, text: &str) {
    if text.is_empty() {
        return;
    }
    x.start("a:r", &[]);
    x.empty("a:rPr", &[("lang", "en-US")]);
    x.text_el("a:t", &[], text);
    x.end("a:r");
}

/// `a:fld/@id` of date fields we write.
pub const DATE_FIELD_GUID: &str = "{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}";
/// `a:fld/@id` of slide-number fields we write.
pub const NUMBER_FIELD_GUID: &str = "{9D3A5A06-5E21-4C21-9D1E-4F8B8A0E2C3D}";
