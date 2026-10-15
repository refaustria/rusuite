//! `.pptx` → [`Presentation`].

use std::collections::{BTreeSet, HashMap};
use std::io::Cursor;

use core_model::Color;
use fmt_ooxml::{Package, PartName, TargetMode};
use model_show::{
    BodyProps, Emu, Fill, LayoutKind, Line, MediaId, NodeId, PlaceholderDef, PlaceholderKind,
    Presentation, Preset, Shape, ShapeKind, Slide, SlideSize, TextBody, Transform,
};

use crate::drawing::{
    read_color, read_fill, read_line, read_text_body, read_xfrm, Space, Xfrm, STYLE_LINE_WIDTHS,
};
use crate::theme::parse_theme;
use crate::xml::{parse, parse_bool, parse_i64, parse_u32, El};
use crate::{Error, PptxContext, Result, Warnings};

/// Everything [`read_with_context`] returns.
#[derive(Debug)]
pub struct ReadOutput {
    /// The presentation (normalized, see [`Presentation::normalize`]).
    pub presentation: Presentation,
    /// File-level data to pass to [`write_with_context`](crate::write_with_context).
    pub context: PptxContext,
    /// Human-readable notes about content that was dropped or approximated.
    pub warnings: Vec<String>,
}

/// Reads a `.pptx` file. Unsupported content is dropped silently; use
/// [`read_with_warnings`] to learn what was dropped.
pub fn read(bytes: &[u8]) -> Result<Presentation> {
    Ok(read_with_context(bytes)?.presentation)
}

/// Like [`read()`], also returning notes about dropped/approximated content.
pub fn read_with_warnings(bytes: &[u8]) -> Result<(Presentation, Vec<String>)> {
    let out = read_with_context(bytes)?;
    Ok((out.presentation, out.warnings))
}

/// The last path segment of a relationship type (`…/relationships/slide`
/// → `slide`), so transitional and strict types match alike.
fn rel_kind(rel_type: &str) -> &str {
    rel_type.rsplit('/').next().unwrap_or("")
}

/// The first internal relationship of `kind` from `source`, resolved.
fn related(pkg: &Package, source: &PartName, kind: &str) -> Option<PartName> {
    pkg.relationships(source)?
        .iter()
        .filter(|r| r.target_mode == TargetMode::Internal && rel_kind(&r.rel_type) == kind)
        .find_map(|r| source.resolve(&r.target).ok())
}

/// The internal relationship `rid` from `source`, resolved.
fn target_of(pkg: &Package, source: &PartName, rid: &str) -> Option<PartName> {
    pkg.relationships(source)?
        .get(rid)
        .filter(|r| r.target_mode == TargetMode::Internal)
        .and_then(|r| source.resolve(&r.target).ok())
}

/// Reads a `.pptx` file, returning the presentation, the file context (raw
/// theme part) and warnings.
pub fn read_with_context(bytes: &[u8]) -> Result<ReadOutput> {
    let pkg = Package::open(Cursor::new(bytes))?;
    let mut w = Warnings::default();
    let main = pkg.main_document_part().ok_or_else(|| {
        Error::MissingPart("officeDocument relationship (ppt/presentation.xml)".into())
    })?;
    let main_data = &pkg
        .part(&main)
        .ok_or_else(|| Error::MissingPart(main.to_string()))?
        .data;
    let root = parse(main_data, main.as_str())?;
    let mut consumed: BTreeSet<PartName> = BTreeSet::new();
    consumed.insert(main.clone());

    let size = root
        .child("sldSz")
        .and_then(|s| {
            Some(SlideSize {
                width: Emu(s.attr("cx").and_then(parse_i64)?),
                height: Emu(s.attr("cy").and_then(parse_i64)?),
            })
        })
        .unwrap_or_default();
    let mut p = Presentation::empty(size);
    let mut context = PptxContext::default();

    if let Some(theme) = related(&pkg, &main, "theme") {
        if let Some(part) = pkg.part(&theme) {
            p.theme = parse_theme(&part.data, theme.as_str())?;
            if pkg.relationships(&theme).is_some_and(|r| !r.is_empty()) {
                w.add(format!(
                    "{theme}: theme has its own relationships; a generated theme part is written"
                ));
            } else {
                context.theme_xml = Some(part.data.clone());
            }
        }
    }

    let mut reader = Reader {
        pkg: &pkg,
        p: &mut p,
        w: &mut w,
        media: HashMap::new(),
        layouts: HashMap::new(),
        consumed: &mut consumed,
    };
    if let Some(list) = root.child("sldIdLst") {
        for id in list.elements().filter(|e| e.name == "sldId") {
            // `p:sldId` has both `id` and `r:id`; attributes are stored by
            // local name, so take the `id` that resolves as a relationship.
            let target = id
                .attrs
                .iter()
                .filter(|(k, _)| k == "id")
                .find_map(|(_, v)| target_of(&pkg, &main, v));
            let Some(part) = target else {
                reader.w.add("slide with dangling relationship dropped");
                continue;
            };
            reader.read_slide(&part)?;
        }
    }
    p.normalize();

    for (name, part) in pkg.parts() {
        if consumed.contains(name) {
            continue;
        }
        let ct = part.content_type.as_str();
        let silent = [
            "slideMaster+xml",
            "slideLayout+xml",
            "theme+xml",
            "presProps+xml",
            "viewProps+xml",
            "tableStyles+xml",
            "core-properties+xml",
            "extended-properties+xml",
            "notesMaster+xml",
            "handoutMaster+xml",
            "printerSettings",
        ];
        if silent.iter().any(|s| ct.ends_with(s)) || name.as_str().starts_with("/docProps/") {
            continue;
        }
        if ct.ends_with("notesSlide+xml") {
            // Notes of slides that were dropped (or not linked from one).
            w.add("speaker notes dropped");
        } else if ct.contains("comment") {
            w.add("comments dropped");
        } else if ct.starts_with("image/") {
            w.add("unused or unsupported images dropped");
        } else {
            w.add(format!("part {name} ({ct}) dropped"));
        }
    }
    Ok(ReadOutput {
        presentation: p,
        context,
        warnings: w.into_vec(),
    })
}

/// A placeholder of a file's layout or master: its type, index and
/// position (if it has one).
#[derive(Debug, Clone, PartialEq)]
struct PhPos {
    ty: String,
    idx: Option<u32>,
    xfrm: Option<Transform>,
}

/// What we use of a file's slide layout.
#[derive(Debug, Clone, Default)]
struct LayoutInfo {
    /// `p:sldLayout/@type` (missing → `cust`).
    ty: String,
    /// Placeholders of the layout, then of its master.
    layout_phs: Vec<PhPos>,
    master_phs: Vec<PhPos>,
}

/// The `p:ph` of a shape element (`p:sp`, `p:pic`, …), if any.
fn ph_of(shape: &El) -> Option<&El> {
    shape
        .elements()
        .find(|e| e.name.starts_with("nv"))
        .and_then(|nv| nv.child("nvPr"))
        .and_then(|nv| nv.child("ph"))
}

/// The placeholder type of a `p:ph` (missing → `obj`).
fn ph_type(ph: &El) -> &str {
    ph.attr("type").unwrap_or("obj")
}

/// Placeholders (type, index, position) of a layout or master part.
fn placeholders_of(root: &El) -> Vec<PhPos> {
    let mut out = Vec::new();
    if let Some(tree) = root.child("cSld").and_then(|c| c.child("spTree")) {
        for sp in tree.elements() {
            if let Some(ph) = ph_of(sp) {
                let xfrm = sp
                    .child("spPr")
                    .and_then(|s| s.child("xfrm"))
                    .map(|x| Space::SLIDE.map(&read_xfrm(x)));
                out.push(PhPos {
                    ty: ph_type(ph).to_owned(),
                    idx: ph.attr("idx").and_then(parse_u32),
                    xfrm,
                });
            }
        }
    }
    out
}

/// Class of a placeholder type for matching slide placeholders to layout
/// and master ones.
fn ph_class(ty: &str) -> &str {
    match ty {
        "title" | "ctrTitle" => "title",
        "body" | "obj" | "subTitle" => "body",
        other => other,
    }
}

/// Maps a layout part's type to a built-in layout (`None`: not one of
/// ours).
pub(crate) fn layout_of_type(ty: &str) -> Option<LayoutKind> {
    match ty {
        "title" => Some(LayoutKind::Title),
        "obj" | "tx" => Some(LayoutKind::TitleContent),
        "blank" => Some(LayoutKind::Blank),
        _ => None,
    }
}

/// Whether a placeholder type is a content/body placeholder.
fn is_body_like(ty: &str) -> bool {
    matches!(
        ty,
        "body" | "obj" | "pic" | "chart" | "tbl" | "dgm" | "media" | "clipArt"
    )
}

/// Chooses the built-in layout of a slide from the types of its
/// placeholders and the type of the file's layout part. The placeholders
/// win (LibreOffice references a `title` layout from almost every slide):
/// a centered title or subtitle → Title; a body/content placeholder →
/// Title and Content; only a title → by the layout part's type
/// (`title` → Title, otherwise Title and Content); no placeholders → Blank.
pub(crate) fn infer_layout(ph_types: &[&str], layout_type: &str, w: &mut Warnings) -> LayoutKind {
    if ph_types
        .iter()
        .any(|t| matches!(*t, "ctrTitle" | "subTitle"))
    {
        return LayoutKind::Title;
    }
    if ph_types.iter().any(|t| is_body_like(t)) {
        return LayoutKind::TitleContent;
    }
    if ph_types.contains(&"title") {
        return match layout_of_type(layout_type) {
            Some(LayoutKind::Title) => LayoutKind::Title,
            Some(_) => LayoutKind::TitleContent,
            None => {
                w.add(format!(
                    "slide layout type {layout_type} mapped to Title and Content"
                ));
                LayoutKind::TitleContent
            }
        };
    }
    LayoutKind::Blank
}

/// Maps a placeholder type to our placeholder kind on a slide with
/// `layout` (`title`/`ctrTitle` become the layout's title kind). `None`
/// for placeholders we do not model (date, footer, slide number, …).
pub(crate) fn placeholder_kind(ty: &str, layout: LayoutKind) -> Option<PlaceholderKind> {
    match ty {
        "title" | "ctrTitle" => Some(if layout == LayoutKind::Title {
            PlaceholderKind::CenteredTitle
        } else {
            PlaceholderKind::Title
        }),
        "subTitle" => Some(PlaceholderKind::Subtitle),
        t if is_body_like(t) => Some(PlaceholderKind::Body),
        _ => None,
    }
}

/// Style references of a shape (`p:style`): colors for fill, outline and
/// text when the shape does not set its own.
#[derive(Debug, Default)]
struct StyleRefs {
    fill: Option<Color>,
    line: Option<Line>,
    font: Option<Color>,
}

fn read_style(st: Option<&El>, w: &mut Warnings) -> StyleRefs {
    let mut out = StyleRefs::default();
    let Some(st) = st else {
        return out;
    };
    let idx = |e: &El| e.attr("idx").and_then(parse_i64).unwrap_or(0);
    if let Some(r) = st.child("fillRef").filter(|r| idx(r) > 0) {
        out.fill = read_color(r, w);
    }
    if let Some(r) = st.child("lnRef").filter(|r| idx(r) > 0) {
        if let Some(c) = read_color(r, w) {
            let i = (idx(r).clamp(1, 3) - 1) as usize;
            out.line = Some(Line::solid(c, Emu(STYLE_LINE_WIDTHS[i])));
        }
    }
    if let Some(r) = st.child("fontRef") {
        out.font = read_color(r, w);
    }
    out
}

struct Reader<'a> {
    pkg: &'a Package,
    p: &'a mut Presentation,
    w: &'a mut Warnings,
    /// Media part → id in the presentation's store (first-reference order).
    media: HashMap<PartName, MediaId>,
    /// Parsed layout parts.
    layouts: HashMap<PartName, LayoutInfo>,
    consumed: &'a mut BTreeSet<PartName>,
}

/// Per-slide state while reading shapes.
struct SlideCtx<'a> {
    part: &'a PartName,
    layout: LayoutKind,
    info: &'a LayoutInfo,
}

impl Reader<'_> {
    fn layout_info(&mut self, slide: &PartName) -> LayoutInfo {
        let Some(layout) = related(self.pkg, slide, "slideLayout") else {
            return LayoutInfo::default();
        };
        if let Some(info) = self.layouts.get(&layout) {
            return info.clone();
        }
        let mut info = LayoutInfo {
            ty: "cust".into(),
            ..LayoutInfo::default()
        };
        if let Some(root) = self
            .pkg
            .part(&layout)
            .and_then(|part| parse(&part.data, layout.as_str()).ok())
        {
            info.ty = root.attr("type").unwrap_or("cust").to_owned();
            info.layout_phs = placeholders_of(&root);
        }
        if let Some(master) = related(self.pkg, &layout, "slideMaster") {
            if let Some(root) = self
                .pkg
                .part(&master)
                .and_then(|part| parse(&part.data, master.as_str()).ok())
            {
                info.master_phs = placeholders_of(&root);
            }
        }
        self.layouts.insert(layout, info.clone());
        info
    }

    fn read_slide(&mut self, part: &PartName) -> Result<()> {
        let data = &self
            .pkg
            .part(part)
            .ok_or_else(|| Error::MissingPart(part.to_string()))?
            .data;
        self.consumed.insert(part.clone());
        let root = parse(data, part.as_str())?;
        let c_sld = root.child("cSld").ok_or_else(|| Error::Malformed {
            part: part.to_string(),
            reason: "no p:cSld".into(),
        })?;
        let info = self.layout_info(part);
        let tree = c_sld.child("spTree");
        let mut types = Vec::new();
        if let Some(tree) = tree {
            collect_ph_types(tree, &mut types);
        }
        let types: Vec<&str> = types.iter().map(String::as_str).collect();
        let layout = infer_layout(&types, &info.ty, self.w);

        let mut slide = Slide::new(self.p.alloc_id(), layout);
        slide.hidden = root.attr("show").and_then(parse_bool) == Some(false);
        slide.notes = self.read_notes(part);
        if let Some(bg) = c_sld.child("bg") {
            slide.background = self.read_background(bg);
        }
        let ctx = SlideCtx {
            part,
            layout,
            info: &info,
        };
        if let Some(tree) = tree {
            let mut shapes = self.read_tree(tree, Space::SLIDE, &ctx);
            for s in &mut shapes {
                self.p.assign_ids(s);
            }
            slide.shapes = shapes;
        }
        for el in root.elements() {
            match el.name.as_str() {
                "transition" => self.w.add("slide transitions dropped"),
                "timing" => self.w.add("animations dropped"),
                "AlternateContent" if el.find("transition").is_some() => {
                    self.w.add("slide transitions dropped");
                }
                _ => {}
            }
        }
        self.p.slides.push(slide);
        Ok(())
    }

    /// The plain text of the slide's notes (`notesSlide` part, body
    /// placeholder): paragraphs joined by `\n`; `None` when empty.
    fn read_notes(&mut self, slide: &PartName) -> Option<String> {
        let part = related(self.pkg, slide, "notesSlide")?;
        let data = &self.pkg.part(&part)?.data;
        self.consumed.insert(part.clone());
        let root = parse(data, part.as_str()).ok()?;
        let tree = root.child("cSld")?.child("spTree")?;
        let body = tree
            .elements()
            .find(|el| el.name == "sp" && ph_of(el).is_some_and(|ph| ph_type(ph) == "body"))?;
        let mut scratch = Warnings::default();
        let text = read_text_body(body.child("txBody")?, BodyProps::default(), &mut scratch);
        let joined = text
            .paragraphs
            .iter()
            .map(|p| p.runs.iter().map(|r| r.text.as_str()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        let trimmed = joined.trim_end_matches('\n');
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    }

    fn read_background(&mut self, bg: &El) -> Option<Fill> {
        if let Some(pr) = bg.child("bgPr") {
            return read_fill(pr, self.w);
        }
        if let Some(r) = bg.child("bgRef") {
            return read_color(r, self.w).map(Fill::Solid);
        }
        None
    }

    /// Children of a shape tree or group, bottom to top.
    fn read_tree(&mut self, parent: &El, space: Space, ctx: &SlideCtx<'_>) -> Vec<Shape> {
        let mut out = Vec::new();
        for el in parent.elements() {
            let shape = match el.name.as_str() {
                "sp" => self.read_sp(el, space, ctx),
                "cxnSp" => self.read_connector(el, space),
                "pic" => self.read_picture(el, space, ctx),
                "grpSp" => self.read_group(el, space, ctx),
                "graphicFrame" => {
                    let uri = el
                        .find("graphicData")
                        .and_then(|g| g.attr("uri"))
                        .unwrap_or("");
                    if uri.ends_with("/table") {
                        self.w.add("tables dropped");
                    } else if uri.ends_with("/chart") {
                        self.w.add("charts dropped");
                    } else {
                        self.w
                            .add("graphic frames (diagrams, embedded objects) dropped");
                    }
                    None
                }
                "AlternateContent" => {
                    let branch = el.child("Fallback").or_else(|| el.child("Choice"));
                    if let Some(b) = branch {
                        out.extend(self.read_tree(b, space, ctx));
                    }
                    None
                }
                "contentPart" => {
                    self.w.add("ink (content parts) dropped");
                    None
                }
                "nvGrpSpPr" | "grpSpPr" | "extLst" => None,
                _ => {
                    self.w.add(format!("shape element {} dropped", el.qname()));
                    None
                }
            };
            out.extend(shape);
        }
        out
    }

    /// The built-in placeholder definition for `kind` (on the slide's
    /// layout, else on any layout).
    fn builtin_def(&self, kind: PlaceholderKind, layout: LayoutKind) -> Option<&PlaceholderDef> {
        self.p
            .layout(layout)
            .placeholder(kind)
            .or_else(|| self.p.layouts.iter().find_map(|l| l.placeholder(kind)))
    }

    /// Position of a placeholder without `a:xfrm`: from the file's layout
    /// (same `idx`, else same type class), then its master, then our
    /// built-in layout.
    fn inherited_xfrm(
        &self,
        ph: &El,
        kind: Option<PlaceholderKind>,
        ctx: &SlideCtx<'_>,
    ) -> Option<Transform> {
        let ty = ph_type(ph);
        let idx = ph.attr("idx").and_then(parse_u32);
        let find = |list: &[PhPos], by_idx: bool| {
            let by_index = by_idx
                .then(|| {
                    idx.and_then(|i| list.iter().find(|p| p.idx == Some(i) && p.xfrm.is_some()))
                })
                .flatten();
            by_index
                .or_else(|| list.iter().find(|p| p.ty == ty && p.xfrm.is_some()))
                .or_else(|| {
                    list.iter()
                        .find(|p| ph_class(&p.ty) == ph_class(ty) && p.xfrm.is_some())
                })
                .and_then(|p| p.xfrm)
        };
        find(&ctx.info.layout_phs, true)
            .or_else(|| find(&ctx.info.master_phs, false))
            .or_else(|| {
                kind.and_then(|k| self.builtin_def(k, ctx.layout))
                    .map(|d| d.transform)
            })
    }

    fn read_sp(&mut self, el: &El, space: Space, ctx: &SlideCtx<'_>) -> Option<Shape> {
        let nv = el.child("nvSpPr");
        let name = nv
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let ph = ph_of(el);
        let kind = ph.and_then(|ph| {
            let k = placeholder_kind(ph_type(ph), ctx.layout);
            if k.is_none() {
                self.w.add(format!(
                    "placeholder type {} read as a plain text box",
                    ph_type(ph)
                ));
            }
            k
        });
        let sp_pr = el.child("spPr");
        let style = read_style(el.child("style"), self.w);
        let transform = match sp_pr.and_then(|s| s.child("xfrm")) {
            Some(x) => space.map(&read_xfrm(x)),
            None => match ph.and_then(|ph| self.inherited_xfrm(ph, kind, ctx)) {
                Some(t) => t,
                None => {
                    self.w.add("shape without position dropped");
                    return None;
                }
            },
        };
        let geometry = match sp_pr {
            Some(s) => self.geometry(s),
            None => Preset::Rect,
        };
        let fill = sp_pr
            .and_then(|s| read_fill(s, self.w))
            .or(style.fill.map(Fill::Solid))
            .unwrap_or(Fill::None);
        let line = read_line(sp_pr.and_then(|s| s.child("ln")), style.line, self.w);
        let base = kind
            .and_then(|k| self.builtin_def(k, ctx.layout))
            .map_or_else(BodyProps::default, |d| d.body_defaults);
        let mut text = el
            .child("txBody")
            .map(|tx| read_text_body(tx, base, self.w));
        if text.is_none() && kind.is_some() {
            text = Some(TextBody {
                props: base,
                paragraphs: Vec::new(),
            });
        }
        if let (Some(body), Some(color)) = (&mut text, style.font) {
            for r in body.paragraphs.iter_mut().flat_map(|p| p.runs.iter_mut()) {
                r.props.color.get_or_insert(color);
            }
        }
        if geometry == Preset::Line && text.as_ref().is_some_and(TextBody::is_empty) {
            text = None;
        }
        Some(Shape {
            id: NodeId(0),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Auto { geometry, text },
            fill,
            line,
            placeholder: kind,
        })
    }

    /// Preset geometry of `p:spPr`.
    fn geometry(&mut self, sp_pr: &El) -> Preset {
        if let Some(g) = sp_pr.child("prstGeom") {
            let prst = g.attr("prst").unwrap_or("rect");
            return match prst {
                "rect" => Preset::Rect,
                "roundRect" => {
                    if g.child("avLst")
                        .is_some_and(|l| l.elements().next().is_some())
                    {
                        self.w.add("rounded rectangle corner size dropped");
                    }
                    Preset::RoundRect
                }
                "ellipse" => Preset::Ellipse,
                "line" | "straightConnector1" => Preset::Line,
                other => {
                    self.w
                        .add(format!("preset geometry {other} read as rectangle"));
                    Preset::Rect
                }
            };
        }
        if sp_pr.child("custGeom").is_some() {
            self.w.add("custom geometry read as rectangle");
        }
        Preset::Rect
    }

    fn read_connector(&mut self, el: &El, space: Space) -> Option<Shape> {
        let name = el
            .child("nvCxnSpPr")
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let sp_pr = el.child("spPr");
        let Some(xfrm) = sp_pr.and_then(|s| s.child("xfrm")) else {
            self.w.add("shape without position dropped");
            return None;
        };
        if let Some(prst) = sp_pr
            .and_then(|s| s.child("prstGeom"))
            .and_then(|g| g.attr("prst"))
            .filter(|p| !matches!(*p, "line" | "straightConnector1"))
        {
            self.w
                .add(format!("connector {prst} read as a straight line"));
        }
        let style = read_style(el.child("style"), self.w);
        let fill = sp_pr
            .and_then(|s| read_fill(s, self.w))
            .unwrap_or(Fill::None);
        let line = read_line(sp_pr.and_then(|s| s.child("ln")), style.line, self.w);
        Some(Shape {
            id: NodeId(0),
            alt: alt_of(el),
            name,
            transform: space.map(&read_xfrm(xfrm)),
            kind: ShapeKind::Auto {
                geometry: Preset::Line,
                text: None,
            },
            fill,
            line,
            placeholder: None,
        })
    }

    fn read_picture(&mut self, el: &El, space: Space, ctx: &SlideCtx<'_>) -> Option<Shape> {
        let name = el
            .child("nvPicPr")
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let blip_fill = el.child("blipFill");
        let blip = blip_fill.and_then(|b| b.child("blip"));
        let Some(rid) = blip.and_then(|b| b.attr("embed")) else {
            if blip.and_then(|b| b.attr("link")).is_some() {
                self.w.add("linked (external) pictures dropped");
            } else {
                self.w.add("picture without image dropped");
            }
            return None;
        };
        let Some(part_name) = target_of(self.pkg, ctx.part, rid) else {
            self.w
                .add(format!("picture with dangling relationship {rid} dropped"));
            return None;
        };
        let media = match self.media.get(&part_name) {
            Some(id) => *id,
            None => {
                let Some(part) = self.pkg.part(&part_name) else {
                    self.w
                        .add(format!("image part {part_name} missing; picture dropped"));
                    return None;
                };
                let id = self
                    .p
                    .media
                    .insert(part.content_type.clone(), part.data.clone());
                self.consumed.insert(part_name.clone());
                self.media.insert(part_name, id);
                id
            }
        };
        if blip_fill.and_then(|b| b.child("srcRect")).is_some_and(|r| {
            ["l", "t", "r", "b"]
                .iter()
                .any(|a| r.attr(a).and_then(parse_i64).is_some_and(|v| v != 0))
        }) {
            self.w.add("picture cropping dropped");
        }
        let sp_pr = el.child("spPr");
        let ph = ph_of(el);
        let transform = match sp_pr.and_then(|s| s.child("xfrm")) {
            Some(x) => space.map(&read_xfrm(x)),
            None => match ph.and_then(|ph| self.inherited_xfrm(ph, None, ctx)) {
                Some(t) => t,
                None => {
                    self.w.add("shape without position dropped");
                    return None;
                }
            },
        };
        let style = read_style(el.child("style"), self.w);
        let line = read_line(sp_pr.and_then(|s| s.child("ln")), style.line, self.w);
        Some(Shape {
            id: NodeId(0),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Picture { media },
            fill: Fill::None,
            line,
            placeholder: None,
        })
    }

    fn read_group(&mut self, el: &El, space: Space, ctx: &SlideCtx<'_>) -> Option<Shape> {
        let name = el
            .child("nvGrpSpPr")
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let xf: Xfrm = el
            .child("grpSpPr")
            .and_then(|g| g.child("xfrm"))
            .map(read_xfrm)
            .unwrap_or_default();
        let transform = space.map(&xf);
        let inner = Space::child_space(&transform, &xf);
        let children = self.read_tree(el, inner, ctx);
        Some(Shape {
            id: NodeId(0),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Group { children },
            fill: Fill::None,
            line: Line::default(),
            placeholder: None,
        })
    }
}

/// `p:cNvPr/@descr` of a shape element (`p:sp`, `p:pic`, …), if set.
fn alt_of(shape: &El) -> Option<String> {
    shape
        .elements()
        .find(|e| e.name.starts_with("nv"))
        .and_then(|nv| nv.child("cNvPr"))
        .and_then(|c| c.attr("descr"))
        .filter(|d| !d.is_empty())
        .map(str::to_owned)
}

/// Types of all placeholders in a shape tree (including inside groups).
fn collect_ph_types(tree: &El, out: &mut Vec<String>) {
    for el in tree.elements() {
        match el.name.as_str() {
            "grpSp" => collect_ph_types(el, out),
            "AlternateContent" => {
                if let Some(b) = el.child("Fallback").or_else(|| el.child("Choice")) {
                    collect_ph_types(b, out);
                }
            }
            _ => {
                if let Some(ph) = ph_of(el) {
                    out.push(ph_type(ph).to_owned());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_inference() {
        let mut w = Warnings::default();
        let mut infer = |t: &[&str], l: &str| infer_layout(t, l, &mut w);
        assert_eq!(infer(&["ctrTitle", "subTitle"], "title"), LayoutKind::Title);
        // LibreOffice: `title` + `subTitle` on a blank layout part
        assert_eq!(infer(&["title", "subTitle"], "blank"), LayoutKind::Title);
        assert_eq!(infer(&["title", "obj"], "blank"), LayoutKind::TitleContent);
        assert_eq!(infer(&["title", "body"], "obj"), LayoutKind::TitleContent);
        assert_eq!(infer(&["title"], "title"), LayoutKind::Title);
        assert_eq!(infer(&["title"], "obj"), LayoutKind::TitleContent);
        assert_eq!(infer(&[], "title"), LayoutKind::Blank);
        assert_eq!(infer(&["dt", "sldNum"], "obj"), LayoutKind::Blank);
        assert!(w.into_vec().is_empty());
        let mut w = Warnings::default();
        assert_eq!(
            infer_layout(&["title"], "titleOnly", &mut w),
            LayoutKind::TitleContent
        );
        assert_eq!(
            w.into_vec(),
            ["slide layout type titleOnly mapped to Title and Content"]
        );
        assert_eq!(layout_of_type("tx"), Some(LayoutKind::TitleContent));
        assert_eq!(layout_of_type("twoObj"), None);
    }

    #[test]
    fn placeholder_kinds() {
        use LayoutKind::*;
        use PlaceholderKind as K;
        assert_eq!(placeholder_kind("title", Title), Some(K::CenteredTitle));
        assert_eq!(placeholder_kind("ctrTitle", Title), Some(K::CenteredTitle));
        assert_eq!(placeholder_kind("title", TitleContent), Some(K::Title));
        assert_eq!(placeholder_kind("ctrTitle", TitleContent), Some(K::Title));
        assert_eq!(placeholder_kind("subTitle", Title), Some(K::Subtitle));
        assert_eq!(placeholder_kind("obj", TitleContent), Some(K::Body));
        assert_eq!(placeholder_kind("body", TitleContent), Some(K::Body));
        assert_eq!(placeholder_kind("pic", TitleContent), Some(K::Body));
        assert_eq!(placeholder_kind("sldNum", TitleContent), None);
        assert_eq!(placeholder_kind("ftr", Blank), None);
        assert_eq!(ph_class("ctrTitle"), "title");
        assert_eq!(ph_class("obj"), ph_class("body"));
    }

    #[test]
    fn style_refs() {
        let st = parse(
            br#"<p:style xmlns:p="p" xmlns:a="a"><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>"#,
            "t",
        )
        .unwrap();
        let mut w = Warnings::default();
        let s = read_style(Some(&st), &mut w);
        use core_model::ThemeColorSlot as S;
        assert_eq!(s.fill, Some(Color::theme(S::Accent1)));
        assert_eq!(s.font, Some(Color::theme(S::Light1)));
        let line = s.line.unwrap();
        assert_eq!(line.width, Emu(12_700));
        assert_eq!(
            line.fill,
            Fill::Solid(Color::Theme {
                slot: S::Accent1,
                tint: -0.5
            })
        );
        // LibreOffice: zero indexes, no colors
        let lo = parse(
            br#"<p:style><a:lnRef idx="0"/><a:fillRef idx="0"/><a:effectRef idx="0"/><a:fontRef idx="minor"/></p:style>"#,
            "t",
        )
        .unwrap();
        let s = read_style(Some(&lo), &mut w);
        assert!(s.fill.is_none() && s.line.is_none() && s.font.is_none());
    }
}
