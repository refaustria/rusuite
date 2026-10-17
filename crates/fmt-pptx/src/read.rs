//! `.pptx` → [`Presentation`].

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::Cursor;

use core_model::Color;
use fmt_ooxml::{Package, PartName, TargetMode};
use model_show::clip::media_content_type;
use model_show::{
    Adjust, Attach, Background, BodyProps, Connector, ConnectorKind, Crop, Emu, Fill, Layout,
    LayoutKind, Line, MediaClip, MediaId, MediaKind, NodeId, PictureFill, PictureProps,
    PlaceholderDef, PlaceholderKind, Presentation, Preset, Recolor, Section, Shadow, Shape,
    ShapeKind, Slide, SlideMaster, SlideSize, TextBody, TextField, Transform,
};

use crate::anim::{read_media_timing, read_slide_transition, read_timing};
use crate::chart::{shape_from_chart, CHART_URI, XLSX_CT};
use crate::drawing::{
    color_and_alpha, read_arrows, read_color, read_fill, read_line, read_text_body, read_xfrm,
    Space, Xfrm, ANGLE_UNITS_PER_DEGREE, STYLE_LINE_WIDTHS,
};
use crate::geom::{read_adjust, read_geometry};
use crate::link::{read_hlink, resolve_part_links, resolve_slide_links};
use crate::master::{
    body_pr_of, header_footer_of, kind_of_type, lst_style_lvl1, read_background as read_bg,
    read_clr_map, read_text_styles,
};
use crate::table::{read_table, TABLE_URI};
use crate::theme::read_theme;
use crate::xml::{parse, parse_bool, parse_i64, parse_u32, El};
use crate::{Error, PptxContext, Result, Warnings};

/// `p:ext/@uri` of the PowerPoint 2010 section list.
pub(crate) const SECTION_EXT_URI: &str = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";

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

/// The part an `p:sldId`/`p:sldMasterId`/`p:sldLayoutId` element points
/// at: it has both `id` and `r:id`, stored by local name, so take the
/// `id` that resolves as a relationship.
fn id_target(pkg: &Package, source: &PartName, el: &El) -> Option<PartName> {
    el.attrs
        .iter()
        .filter(|(k, _)| k == "id")
        .find_map(|(_, v)| target_of(pkg, source, v))
}

/// The numeric `id` of a `p:sldId` (the `id` that is a number).
fn numeric_id(el: &El) -> Option<u32> {
    el.attrs
        .iter()
        .filter(|(k, _)| k == "id")
        .find_map(|(_, v)| parse_u32(v))
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

    // the master (first of sldMasterIdLst) and its theme
    let masters: Vec<PartName> = root
        .child("sldMasterIdLst")
        .map(|l| {
            l.elements()
                .filter(|e| e.name == "sldMasterId")
                .filter_map(|e| id_target(&pkg, &main, e))
                .collect()
        })
        .unwrap_or_default();
    if masters.len() > 1 {
        w.add("only the first slide master is kept (slides of the others use its layouts)");
    }
    let master = masters
        .first()
        .cloned()
        .or_else(|| related(&pkg, &main, "slideMaster"));
    let theme_part = master
        .as_ref()
        .and_then(|m| related(&pkg, m, "theme"))
        .or_else(|| related(&pkg, &main, "theme"));
    if let Some(theme) = theme_part {
        if let Some(part) = pkg.part(&theme) {
            p.theme = read_theme(&part.data, theme.as_str())?;
            if pkg.relationships(&theme).is_some_and(|r| !r.is_empty()) {
                w.add(format!(
                    "{theme}: theme has its own relationships; a generated theme part is written"
                ));
            } else {
                context.theme_xml = Some(part.data.clone());
            }
        }
    }

    // the default table style (for tables that name none) and the styles
    // that are not built-ins
    let table_styles_root = related(&pkg, &main, "tableStyles")
        .and_then(|name| pkg.part(&name))
        .and_then(|part| parse(&part.data, "tableStyles").ok());
    let default_table_style = table_styles_root
        .as_ref()
        .and_then(|root| root.attr("def").map(str::to_owned));
    if let Some(root) = &table_styles_root {
        p.table_styles = crate::tablestyle::read_table_styles(root, &mut w);
    }
    let mut reader = Reader {
        pkg: &pkg,
        p: &mut p,
        w: &mut w,
        media: HashMap::new(),
        layouts: HashMap::new(),
        synthesized: HashSet::new(),
        consumed: &mut consumed,
        default_table_style,
    };
    if let Some(m) = &master {
        reader.read_master(m)?;
    }
    // slide numeric ids (for sections), in slide order
    let mut slide_numbers: Vec<(u32, NodeId)> = Vec::new();
    let mut slide_parts: HashMap<String, NodeId> = HashMap::new();
    if let Some(list) = root.child("sldIdLst") {
        for el in list.elements().filter(|e| e.name == "sldId") {
            let Some(part) = id_target(&pkg, &main, el) else {
                reader.w.add("slide with dangling relationship dropped");
                continue;
            };
            let id = reader.read_slide(&part)?;
            slide_parts.insert(part.as_str().to_owned(), id);
            if let Some(n) = numeric_id(el) {
                slide_numbers.push((n, id));
            }
        }
    }
    resolve_slide_links(&mut p, &slide_parts, &mut w);
    read_sections(&root, &slide_numbers, &mut p, &mut w);
    let props_root = |kind: &str| {
        related(&pkg, &main, kind)
            .and_then(|name| pkg.part(&name))
            .and_then(|part| parse(&part.data, kind).ok())
    };
    if let Some(r) = props_root("viewProps") {
        p.view = crate::props::read_view_props(&r);
    }
    if let Some(r) = props_root("presProps") {
        p.show_settings = crate::props::read_pres_props(&r);
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

/// `p:extLst/p:ext/p14:sectionLst` → [`Presentation::sections`] (slides
/// of unknown ids are skipped; slides in no section join the one before).
fn read_sections(root: &El, numbers: &[(u32, NodeId)], p: &mut Presentation, w: &mut Warnings) {
    let Some(list) = root
        .child("extLst")
        .into_iter()
        .flat_map(|l| l.elements())
        .filter(|e| e.name == "ext" && e.attr("uri") == Some(SECTION_EXT_URI))
        .find_map(|e| e.child("sectionLst"))
    else {
        return;
    };
    let mut seen = HashSet::new();
    for s in list.elements().filter(|e| e.name == "section") {
        let mut section = Section::new(s.attr("name").unwrap_or(""));
        for id in s
            .child("sldIdLst")
            .into_iter()
            .flat_map(|l| l.elements())
            .filter(|e| e.name == "sldId")
        {
            let Some(n) = id.attr("id").and_then(parse_u32) else {
                continue;
            };
            if let Some((_, node)) = numbers.iter().find(|(k, _)| *k == n) {
                if seen.insert(*node) {
                    section.slide_ids.push(*node);
                }
            }
        }
        p.sections.push(section);
    }
    if p.sections.is_empty() {
        return;
    }
    p.fix_sections();
    if p.validate_sections().is_err() {
        w.add("sections out of slide order rearranged");
    }
}

/// Maps a layout part's type to one of the layouts the inference uses
/// (`None`: not one of them).
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

/// Whether a placeholder type is a date, footer, slide number or header.
fn is_hf_type(ty: &str) -> bool {
    matches!(ty, "dt" | "ftr" | "sldNum" | "hdr")
}

/// Chooses a standard layout for a slide that does not fit the layout it
/// references, from the types of its placeholders and the type of the
/// file's layout part. The placeholders win (LibreOffice references a
/// `title` layout from almost every slide): a centered title or subtitle →
/// Title; a body/content placeholder → Title and Content; only a title →
/// by the layout part's type (`title` → Title, otherwise Title and
/// Content); no placeholders → Blank.
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

/// Whether a slide whose (non-header/footer) placeholder types are
/// `types` fits `layout`: every type has a placeholder of its kind on the
/// layout (titles match titles, content/body/picture match content, body
/// or picture placeholders, a subtitle needs a subtitle), and a slide
/// without placeholders only fits a layout without any.
pub(crate) fn fits(types: &[&str], layout: &Layout) -> bool {
    let has =
        |pred: &dyn Fn(PlaceholderKind) -> bool| layout.placeholders.iter().any(|d| pred(d.kind));
    if types.is_empty() {
        return !has(&|k| !k.is_header_footer());
    }
    types.iter().all(|t| match *t {
        "title" | "ctrTitle" => {
            has(&|k| matches!(k, PlaceholderKind::Title | PlaceholderKind::CenteredTitle))
        }
        "subTitle" => has(&|k| k == PlaceholderKind::Subtitle),
        t if is_body_like(t) => {
            has(&|k| matches!(k, PlaceholderKind::Body | PlaceholderKind::Picture))
        }
        _ => true,
    })
}

/// Maps a placeholder type to our placeholder kind on a slide with
/// `layout` (`title`/`ctrTitle` become the layout's title kind). `None`
/// for placeholders we do not model (header, …).
pub(crate) fn placeholder_kind(ty: &str, layout: &LayoutKind) -> Option<PlaceholderKind> {
    kind_of_type(ty, *layout == LayoutKind::Title)
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
    /// Layout part → the layout it became.
    layouts: HashMap<PartName, LayoutKind>,
    /// Standard layouts generated from the master (the file has none).
    synthesized: HashSet<LayoutKind>,
    consumed: &'a mut BTreeSet<PartName>,
    /// `def` of `ppt/tableStyles.xml`.
    default_table_style: Option<String>,
}

/// Per-part state while reading shapes.
struct SlideCtx<'a> {
    /// The part (for relationships).
    part: &'a PartName,
    /// The slide's layout (placeholder kinds, body properties).
    layout: Layout,
    /// The layout the slide's file references, when it differs.
    file_layout: Option<Layout>,
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

/// A copy of a shape tree without its placeholder elements.
fn without_placeholders(tree: &El) -> El {
    let mut t = tree.clone();
    t.children.retain(|n| match n {
        fmt_ooxml::xml::Node::El(e) => ph_of(e).is_none(),
        _ => true,
    });
    t
}

/// The plain text and first field of a placeholder's text body.
/// The custom prompt of a master/layout placeholder (`hasCustomPrompt`):
/// its paragraphs' text joined by `\n`.
fn custom_prompt(sp: &El, ph: &El) -> Option<String> {
    if ph.attr("hasCustomPrompt").and_then(parse_bool) != Some(true) {
        return None;
    }
    let tx = sp.child("txBody")?;
    let body = read_text_body(tx, BodyProps::default(), &mut Warnings::default());
    let text = body
        .paragraphs
        .iter()
        .map(|p| p.runs.iter().map(|r| r.text.as_str()).collect::<String>())
        .collect::<Vec<_>>()
        .join("\n");
    Some(text)
}

fn text_and_field(sp: &El, w: &mut Warnings) -> (String, Option<TextField>) {
    let Some(tx) = sp.child("txBody") else {
        return (String::new(), None);
    };
    let body = read_text_body(tx, BodyProps::default(), w);
    let field = body
        .paragraphs
        .iter()
        .flat_map(|p| &p.runs)
        .find_map(|r| r.field.clone());
    let text = body
        .paragraphs
        .iter()
        .flat_map(|p| &p.runs)
        .filter(|r| r.field.is_none())
        .map(|r| r.text.as_str())
        .collect::<String>();
    (text, field)
}

impl Reader<'_> {
    /// Reads the master, its layouts (in `p:sldLayoutIdLst` order) and
    /// decorative shapes; standard layouts the file lacks are added from
    /// the master.
    fn read_master(&mut self, part: &PartName) -> Result<()> {
        let Some(data) = self.pkg.part(part).map(|p| p.data.clone()) else {
            return Ok(());
        };
        self.consumed.insert(part.clone());
        let root = parse(&data, part.as_str())?;
        let size = self.p.slide_size;
        let builtin = SlideMaster::builtin(size);
        let c_sld = root.child("cSld");
        let background = c_sld
            .and_then(|c| c.child("bg"))
            .and_then(|bg| self.read_background(bg, part))
            .unwrap_or_default();
        let mut m = SlideMaster {
            name: c_sld.and_then(|c| c.attr("name")).unwrap_or("").to_owned(),
            background,
            placeholders: Vec::new(),
            shapes: Vec::new(),
            text_styles: read_text_styles(root.child("txStyles"), self.w),
            color_map: read_clr_map(root.child("clrMap")),
            header_footer: Default::default(),
        };
        let mut texts = Vec::new();
        let tree = c_sld.and_then(|c| c.child("spTree"));
        if let Some(tree) = tree {
            for sp in tree.elements().filter(|e| e.name == "sp") {
                let Some(ph) = ph_of(sp) else { continue };
                let ty = ph_type(ph);
                let Some(kind) = kind_of_type(ty, false) else {
                    self.w.add(format!("master placeholder type {ty} dropped"));
                    continue;
                };
                let transform = sp
                    .child("spPr")
                    .and_then(|s| s.child("xfrm"))
                    .map(|x| Space::SLIDE.map(&read_xfrm(x)))
                    .or_else(|| builtin.placeholder_for(kind).map(|d| d.transform))
                    .unwrap_or_default();
                let (sp_para, sp_run) = m.style_defaults(kind);
                let tx = sp.child("txBody");
                let (lp, lr) = lst_style_lvl1(tx, self.w);
                let (body, vertical) = body_pr_of(
                    tx,
                    BodyProps::default(),
                    ph.attr("orient") == Some("vert"),
                    self.w,
                );
                if kind.is_header_footer() {
                    let (t, f) = text_and_field(sp, &mut Warnings::default());
                    texts.push((kind, t, f));
                }
                m.placeholders.push(PlaceholderDef {
                    kind,
                    idx: ph.attr("idx").and_then(parse_u32).unwrap_or(0),
                    transform,
                    body_defaults: body,
                    run_defaults: sp_run.merged_with(&lr),
                    paragraph_defaults: sp_para.merged_with(&lp),
                    text_only: ty == "body",
                    vertical,
                    prompt: custom_prompt(sp, ph),
                });
            }
            m.shapes = self.read_part_shapes(part, tree);
        }
        complete_master(&mut m, &builtin);
        self.p.master = m.clone();
        // layouts
        let mut layouts: Vec<Layout> = Vec::new();
        let mut not_on_title = false;
        let mut ids: Vec<PartName> = root
            .child("sldLayoutIdLst")
            .map(|l| {
                l.elements()
                    .filter(|e| e.name == "sldLayoutId")
                    .filter_map(|e| id_target(self.pkg, part, e))
                    .collect()
            })
            .unwrap_or_default();
        // layouts the master links to without listing them
        if let Some(rels) = self.pkg.relationships(part) {
            for r in rels.iter() {
                if r.target_mode == TargetMode::Internal && rel_kind(&r.rel_type) == "slideLayout" {
                    if let Ok(t) = part.resolve(&r.target) {
                        if !ids.contains(&t) {
                            ids.push(t);
                        }
                    }
                }
            }
        }
        for lp in ids {
            if let Some((layout, hf_texts, hides_hf)) = self.read_layout(&lp, &m, &layouts)? {
                texts.extend(hf_texts);
                if layout.kind == LayoutKind::Title && hides_hf {
                    not_on_title = true;
                }
                self.layouts.insert(lp, layout.kind.clone());
                layouts.push(layout);
            }
        }
        for k in LayoutKind::STANDARD {
            if !layouts.iter().any(|l| l.kind == k) {
                self.synthesized.insert(k.clone());
                layouts.push(Layout::from_master(k, &m, size));
            }
        }
        m.header_footer = header_footer_of(root.child("hf"), &texts, not_on_title);
        self.p.master = m;
        self.p.layouts = layouts;
        Ok(())
    }

    /// The non-placeholder shapes of a master or layout shape tree, with
    /// node ids.
    fn read_part_shapes(&mut self, part: &PartName, tree: &El) -> Vec<Shape> {
        let ctx = SlideCtx {
            part,
            layout: Layout::new(LayoutKind::Blank),
            file_layout: None,
        };
        let mut shapes = self.read_tree(&without_placeholders(tree), Space::SLIDE, &ctx);
        self.resolve_links(part, &mut shapes);
        let mut spids = HashMap::new();
        for s in &mut shapes {
            assign_ids(self.p, s, &mut spids);
        }
        if remap_attachments(&mut shapes, &spids) {
            self.w
                .add("connector attachments to missing shapes dropped");
        }
        shapes
    }

    /// One layout part → the model layout, the text of its date/footer
    /// placeholders and whether it hides the header/footer (`p:hf` all
    /// off). `existing`: the layouts read so far (kinds are unique: a
    /// second layout of a standard type becomes a custom layout).
    #[allow(clippy::type_complexity)]
    fn read_layout(
        &mut self,
        part: &PartName,
        m: &SlideMaster,
        existing: &[Layout],
    ) -> Result<
        Option<(
            Layout,
            Vec<(PlaceholderKind, String, Option<TextField>)>,
            bool,
        )>,
    > {
        let Some(data) = self.pkg.part(part).map(|p| p.data.clone()) else {
            return Ok(None);
        };
        self.consumed.insert(part.clone());
        let root = parse(&data, part.as_str())?;
        let c_sld = root.child("cSld");
        let name = c_sld.and_then(|c| c.attr("name")).unwrap_or("").to_owned();
        let ty = root.attr("type").unwrap_or("cust");
        let taken = |k: &LayoutKind| existing.iter().any(|l| &l.kind == k);
        let (kind, own_name) = match LayoutKind::from_ooxml_type(ty).filter(|k| !taken(k)) {
            Some(k) => {
                let n = if name == k.display_name() {
                    String::new()
                } else {
                    name.clone()
                };
                (k, n)
            }
            None => {
                let base = if name.is_empty() {
                    "Custom Layout".to_owned()
                } else {
                    name.clone()
                };
                let mut n = base.clone();
                let mut i = 2;
                while taken(&LayoutKind::Custom(n.clone())) {
                    n = format!("{base} {i}");
                    i += 1;
                }
                (LayoutKind::Custom(n), String::new())
            }
        };
        let on_title = kind == LayoutKind::Title;
        let mut layout = Layout::new(kind);
        layout.name = own_name;
        layout.show_master_shapes = root.attr("showMasterSp").and_then(parse_bool) != Some(false);
        layout.background = c_sld
            .and_then(|c| c.child("bg"))
            .and_then(|bg| self.read_background(bg, part));
        let mut texts = Vec::new();
        if let Some(tree) = c_sld.and_then(|c| c.child("spTree")) {
            for sp in tree
                .elements()
                .filter(|e| e.name == "sp" || e.name == "pic")
            {
                let Some(ph) = ph_of(sp) else { continue };
                let pty = ph_type(ph);
                let Some(pk) = kind_of_type(pty, on_title) else {
                    self.w.add(format!("layout placeholder type {pty} dropped"));
                    continue;
                };
                let base = m.placeholder_for(pk);
                let transform = sp
                    .child("spPr")
                    .and_then(|s| s.child("xfrm"))
                    .map(|x| Space::SLIDE.map(&read_xfrm(x)))
                    .or_else(|| base.map(|d| d.transform));
                let Some(transform) = transform else {
                    self.w.add("layout placeholder without position dropped");
                    continue;
                };
                let (bp, br) = match base {
                    Some(d) => (d.paragraph_defaults.clone(), d.run_defaults.clone()),
                    None => m.style_defaults(pk),
                };
                let tx = sp.child("txBody");
                let (lp, lr) = lst_style_lvl1(tx, self.w);
                let body_base = base.map_or_else(BodyProps::default, |d| d.body_defaults);
                let (body, vertical) =
                    body_pr_of(tx, body_base, ph.attr("orient") == Some("vert"), self.w);
                if pk.is_header_footer() {
                    let (t, f) = text_and_field(sp, &mut Warnings::default());
                    texts.push((pk, t, f));
                }
                layout.placeholders.push(PlaceholderDef {
                    kind: pk,
                    idx: ph.attr("idx").and_then(parse_u32).unwrap_or(0),
                    transform,
                    body_defaults: body,
                    run_defaults: br.merged_with(&lr),
                    paragraph_defaults: bp.merged_with(&lp),
                    text_only: pty == "body",
                    vertical,
                    prompt: custom_prompt(sp, ph),
                });
            }
            layout.shapes = self.read_part_shapes(part, tree);
        }
        let hides = root
            .child("hf")
            .is_some_and(|h| crate::master::hf_flags(Some(h)) == (false, false, false));
        Ok(Some((layout, texts, hides)))
    }

    /// Reads a layout part the master does not list (e.g. one of another
    /// master): it replaces a standard layout that was synthesized from
    /// the master, else becomes a new (possibly custom) layout.
    fn adopt_layout(&mut self, lp: &PartName) -> Result<()> {
        let master = self.p.master.clone();
        let existing: Vec<Layout> = self
            .p
            .layouts
            .iter()
            .filter(|l| !self.synthesized.contains(&l.kind))
            .cloned()
            .collect();
        let Some((layout, _, _)) = self.read_layout(lp, &master, &existing)? else {
            return Ok(());
        };
        let kind = layout.kind.clone();
        match self.p.layouts.iter().position(|l| l.kind == kind) {
            Some(i) => self.p.layouts[i] = layout,
            None => self.p.layouts.push(layout),
        }
        self.synthesized.remove(&kind);
        self.layouts.insert(lp.clone(), kind);
        Ok(())
    }

    fn read_slide(&mut self, part: &PartName) -> Result<NodeId> {
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
        let layout_part = related(self.pkg, part, "slideLayout");
        if let Some(lp) = &layout_part {
            if !self.layouts.contains_key(lp) {
                self.adopt_layout(lp)?;
            }
        }
        let file_kind = layout_part
            .as_ref()
            .and_then(|lp| self.layouts.get(lp).cloned());
        let file_layout = file_kind.as_ref().and_then(|k| self.p.layout(k).cloned());
        let tree = c_sld.child("spTree");
        let mut types = Vec::new();
        if let Some(tree) = tree {
            collect_ph_types(tree, &mut types);
        }
        let types: Vec<&str> = types
            .iter()
            .map(String::as_str)
            .filter(|t| !is_hf_type(t))
            .collect();
        let kind = match &file_layout {
            Some(l) if fits(&types, l) => l.kind.clone(),
            _ => {
                let ty = file_kind.as_ref().map_or("cust", LayoutKind::ooxml_type);
                infer_layout(&types, ty, self.w)
            }
        };
        let layout = self.p.layout_or_builtin(&kind);

        let mut slide = Slide::new(self.p.alloc_id(), kind.clone());
        slide.hidden = root.attr("show").and_then(parse_bool) == Some(false);
        slide.show_master_shapes = root.attr("showMasterSp").and_then(parse_bool) != Some(false);
        slide.notes = self.read_notes(part);
        if let Some(bg) = c_sld.child("bg") {
            slide.background = self.read_background(bg, part);
        }
        let ctx = SlideCtx {
            part,
            file_layout: file_layout.filter(|l| l.kind != kind),
            layout,
        };
        // Shapes come back carrying their `p:cNvPr/@id`; map those to the
        // node ids we assign (for animation targets).
        let mut spids = HashMap::new();
        if let Some(tree) = tree {
            let mut shapes = self.read_tree(tree, Space::SLIDE, &ctx);
            self.resolve_links(part, &mut shapes);
            normalize_placeholder_idx(&mut shapes, &ctx.layout);
            for s in &mut shapes {
                assign_ids(self.p, s, &mut spids);
            }
            if remap_attachments(&mut shapes, &spids) {
                self.w
                    .add("connector attachments to missing shapes dropped");
            }
            slide.shapes = shapes;
            if !slide.detach_missing().is_empty() {
                self.w
                    .add("connector attachments to groups or connectors dropped");
            }
        }
        slide.transition = read_slide_transition(&root, self.w);
        let timing = root.child("timing").or_else(|| {
            root.elements()
                .filter(|e| e.name == "AlternateContent")
                .find_map(|e| {
                    e.child("Fallback")
                        .or_else(|| e.child("Choice"))
                        .and_then(|b| b.child("timing"))
                })
        });
        if let Some(timing) = timing {
            for (spid, mt) in read_media_timing(timing) {
                let Some(&id) = spids.get(&spid) else {
                    continue;
                };
                if let Some(ShapeKind::Media(m)) = slide.find_shape_mut(id).map(|s| &mut s.kind) {
                    if let Some(start) = mt.start {
                        m.start = start;
                    }
                    if let Some(v) = mt.volume {
                        m.volume = v.min(100_000);
                    }
                    m.muted = mt.muted;
                    m.hide_when_not_playing = mt.hide;
                    m.loop_playback = mt.looped;
                }
            }
            slide.animations = read_timing(timing, &spids, self.w);
            for a in &mut slide.animations {
                a.id = self.p.alloc_id();
            }
        }
        let id = slide.id;
        self.p.slides.push(slide);
        Ok(id)
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

    /// The media id of image relationship `rid` of `part` (the image is
    /// added to the media store once); `what` names the dropped thing in
    /// warnings.
    fn image_of(&mut self, part: &PartName, rid: &str, what: &str) -> Option<MediaId> {
        let Some(part_name) = target_of(self.pkg, part, rid) else {
            self.w
                .add(format!("{what} with dangling relationship {rid} dropped"));
            return None;
        };
        if let Some(id) = self.media.get(&part_name) {
            return Some(*id);
        }
        let Some(data) = self.pkg.part(&part_name) else {
            self.w
                .add(format!("image part {part_name} missing; {what} dropped"));
            return None;
        };
        let id = self
            .p
            .media
            .insert(data.content_type.clone(), data.data.clone());
        self.consumed.insert(part_name.clone());
        self.media.insert(part_name, id);
        Some(id)
    }

    /// `p:bg` of a slide, layout or master: `p:bgPr` with a fill or a
    /// picture (`a:blipFill`: `a:tile` → tiled, `a:alphaModFix` →
    /// transparency), or `p:bgRef`.
    fn read_background(&mut self, bg: &El, part: &PartName) -> Option<Background> {
        if let Some(blip_fill) = bg.child("bgPr").and_then(|pr| pr.child("blipFill")) {
            let blip = blip_fill.child("blip");
            let Some(rid) = blip.and_then(|b| b.attr("embed")) else {
                self.w.add("background picture without image dropped");
                return None;
            };
            let media = self.image_of(part, rid, "background picture")?;
            let transparency = blip
                .and_then(|b| b.child("alphaModFix"))
                .and_then(|a| a.attr("amt"))
                .and_then(|v| v.parse::<f64>().ok())
                .map_or(0.0, |amt| (1.0 - amt / 100_000.0).clamp(0.0, 1.0));
            return Some(Background::Picture(PictureFill {
                media,
                tile: blip_fill.child("tile").is_some(),
                transparency,
            }));
        }
        read_bg(bg, self.w)
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
                    if uri == TABLE_URI || uri.ends_with("/table") {
                        out.extend(
                            self.read_table_frame(el, space)
                                .map(|s| self.with_action(s, el)),
                        );
                    } else if uri == CHART_URI || uri.ends_with("/chart") {
                        out.extend(
                            self.read_chart_frame(el, space, ctx)
                                .map(|s| self.with_action(s, el)),
                        );
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
            out.extend(shape.map(|s| self.with_action(s, el)));
        }
        out
    }

    /// `shape` with the click action of its element's `p:cNvPr/a:hlinkClick`
    /// and its `p:cNvPr/@hidden` flag.
    fn with_action(&mut self, mut shape: Shape, el: &El) -> Shape {
        let c_nv_pr = el
            .elements()
            .find(|e| e.name.starts_with("nv"))
            .and_then(|nv| nv.child("cNvPr"));
        shape.hidden = c_nv_pr
            .and_then(|c| c.attr("hidden"))
            .and_then(parse_bool)
            .unwrap_or(false);
        // `p:cNvSpPr/a:spLocks`, `p:cNvPicPr/a:picLocks`, … `@noChangeAspect`
        shape.lock_aspect = el
            .elements()
            .find(|e| e.name.starts_with("nv"))
            .and_then(|nv| {
                nv.elements()
                    .find(|e| e.name.starts_with("cNv") && e.name != "cNvPr")
            })
            .and_then(|c| c.elements().find(|e| e.name.ends_with("Locks")))
            .and_then(|l| l.attr("noChangeAspect"))
            .and_then(parse_bool)
            .unwrap_or(false);
        if let Some(h) = c_nv_pr.and_then(|c| c.child("hlinkClick")) {
            shape.click_action = read_hlink(h, self.w);
        }
        if el
            .elements()
            .any(|e| e.name.starts_with("nv") && e.find("hlinkMouseOver").is_some())
        {
            self.w.add("mouse-over actions dropped");
        }
        shape
    }

    /// Resolves the relationship ids of the links read from `part`.
    fn resolve_links(&mut self, part: &PartName, shapes: &mut [Shape]) {
        let rels = self.pkg.relationships(part);
        let rel_of = |rid: &str| {
            let r = rels?.get(rid)?;
            if r.target_mode == TargetMode::External {
                return Some((rel_kind(&r.rel_type).to_owned(), r.target.clone(), true));
            }
            let target = part.resolve(&r.target).ok()?;
            Some((
                rel_kind(&r.rel_type).to_owned(),
                target.as_str().to_owned(),
                false,
            ))
        };
        resolve_part_links(shapes, &rel_of, self.w);
    }

    /// The media store id of part `name` (inserted on first use; the
    /// content type from the package, `fallback_ct` when it is generic).
    fn media_of_part(&mut self, name: &PartName, fallback_ct: Option<&str>) -> Option<MediaId> {
        if let Some(id) = self.media.get(name) {
            return Some(*id);
        }
        let part = self.pkg.part(name)?;
        let mut ct = part.content_type.clone();
        if let Some(f) = fallback_ct {
            if !(ct.starts_with("video/") || ct.starts_with("audio/") || ct == f) {
                ct = f.to_owned();
            }
        }
        let id = self.p.media.insert(ct, part.data.clone());
        self.consumed.insert(name.clone());
        self.media.insert(name.clone(), id);
        Some(id)
    }

    /// A `p:graphicFrame` holding a chart: the chart part (and its
    /// embedded workbook) → a chart shape with the data of its caches.
    fn read_chart_frame(&mut self, el: &El, space: Space, ctx: &SlideCtx<'_>) -> Option<Shape> {
        let name = el
            .child("nvGraphicFramePr")
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let Some(xfrm) = el.child("xfrm") else {
            self.w.add("shape without position dropped");
            return None;
        };
        let mut transform = space.map(&read_xfrm(xfrm));
        if transform.rotation_deg != 0.0 || transform.flip_h || transform.flip_v {
            self.w.add("chart rotation and flips dropped");
            transform.rotation_deg = 0.0;
            transform.flip_h = false;
            transform.flip_v = false;
        }
        let rid = el.find("graphicData")?.child("chart")?.attr("id")?;
        let Some(part) = target_of(self.pkg, ctx.part, rid) else {
            self.w.add("chart with a dangling relationship dropped");
            return None;
        };
        let data = self.pkg.part(&part)?.data.clone();
        self.consumed.insert(part.clone());
        let read = match fmt_ooxml::chart::read_chart_ext(&data, part.as_str()) {
            Ok(r) => r,
            Err(e) => {
                self.w.add(format!("unreadable chart dropped ({e})"));
                return None;
            }
        };
        for msg in read.warnings {
            self.w.add(msg);
        }
        let mut workbook = None;
        if let Some(rels) = self.pkg.relationships(&part) {
            for r in rels
                .iter()
                .filter(|r| r.target_mode == TargetMode::Internal)
            {
                let Ok(target) = part.resolve(&r.target) else {
                    continue;
                };
                let wanted = Some(r.id.as_str()) == read.external_data.as_deref();
                let ct = self.pkg.content_type_of(&target).unwrap_or("").to_owned();
                if wanted && ct == XLSX_CT {
                    workbook = Some(target);
                } else {
                    if wanted {
                        self.w.add("chart data embedded as an OLE object dropped (the chart keeps its data)");
                    }
                    // chart style / colour parts, OLE objects, images of the chart
                    self.consumed.insert(target);
                }
            }
        }
        let mut chart = shape_from_chart(read.chart, None);
        if let Some(target) = workbook {
            // a workbook we would generate from the data anyway is not kept
            let generated = crate::chart::workbook_xlsx(&chart.data).ok();
            if self.pkg.part(&target).map(|p| &p.data) == generated.as_ref() {
                self.consumed.insert(target);
            } else {
                chart.workbook = self.media_of_part(&target, None);
            }
        }
        Some(Shape {
            id: file_id(el),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Chart(Box::new(chart)),
            fill: Fill::None,
            line: Line::default(),
            placeholder: None,
            placeholder_idx: None,
            click_action: None,
            hidden: false,
            lock_aspect: false,
            text_color: None,
        })
    }

    /// The audio/video of a `p:pic` (`a:videoFile`/`a:audioFile` +
    /// `p14:media r:embed`): `Some` with the clip when the file is
    /// embedded; `None` when the picture is no media shape; linked
    /// (external) media → `None` with a warning (the poster stays as a
    /// picture).
    fn read_media(&mut self, el: &El, ctx: &SlideCtx<'_>) -> Option<MediaClip> {
        let nv = el.child("nvPicPr")?.child("nvPr")?;
        let (kind, file) = if let Some(v) = nv.child("videoFile") {
            (MediaKind::Video, v)
        } else {
            (MediaKind::Audio, nv.child("audioFile")?)
        };
        let embed = nv
            .find("media")
            .and_then(|m| m.attr("embed"))
            .or_else(|| file.attr("link"));
        let rels = self.pkg.relationships(ctx.part);
        let rel = embed.and_then(|rid| rels?.get(rid));
        let Some(rel) = rel.filter(|r| r.target_mode == TargetMode::Internal) else {
            self.w
                .add("linked (not embedded) audio/video kept as its poster picture");
            return None;
        };
        let target = ctx.part.resolve(&rel.target).ok()?;
        let ext = target.extension().unwrap_or("").to_owned();
        let fallback = media_content_type(&ext).unwrap_or(match kind {
            MediaKind::Video => "video/mp4",
            MediaKind::Audio => "audio/mpeg",
        });
        let Some(media) = self.media_of_part(&target, Some(fallback)) else {
            self.w
                .add("audio/video part missing; kept as its poster picture");
            return None;
        };
        // the other relationship (a:videoFile r:link) points at the same part
        if let Some(t) = file
            .attr("link")
            .and_then(|rid| target_of(self.pkg, ctx.part, rid))
        {
            self.consumed.insert(t);
        }
        Some(MediaClip::new(kind, media))
    }

    /// The layout (else master) placeholder a slide placeholder
    /// `kind`/`idx` inherits from.
    fn def_for(
        &self,
        ctx: &SlideCtx<'_>,
        kind: PlaceholderKind,
        idx: Option<u32>,
    ) -> Option<PlaceholderDef> {
        ctx.layout
            .find(kind, idx)
            .cloned()
            .or_else(|| self.p.master.placeholder_for(kind).cloned())
    }

    /// Position of a placeholder without `a:xfrm`: from the layout the
    /// file references (same `idx`, else same type, else same class), then
    /// the slide's layout, then the master.
    fn inherited_xfrm(
        &self,
        ph: &El,
        kind: Option<PlaceholderKind>,
        ctx: &SlideCtx<'_>,
    ) -> Option<Transform> {
        let ty = ph_type(ph);
        let kind = kind.or_else(|| kind_of_type(ty, false))?;
        let idx = ph.attr("idx").and_then(parse_u32);
        ctx.file_layout
            .as_ref()
            .and_then(|l| l.find(kind, idx))
            .or_else(|| ctx.layout.find(kind, idx))
            .or_else(|| self.p.master.placeholder_for(kind))
            .map(|d| d.transform)
    }

    fn read_sp(&mut self, el: &El, space: Space, ctx: &SlideCtx<'_>) -> Option<Shape> {
        let nv = el.child("nvSpPr");
        let name = nv
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let ph = ph_of(el);
        let ph_idx = ph
            .and_then(|ph| ph.attr("idx"))
            .and_then(parse_u32)
            .filter(|i| *i != 0);
        let kind = ph.and_then(|ph| {
            let k = placeholder_kind(ph_type(ph), &ctx.layout.kind);
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
        let (geometry, adjust) =
            read_geometry(sp_pr, transform.w.0 as f64, transform.h.0 as f64, self.w);
        let fill = sp_pr
            .and_then(|s| read_fill(s, self.w))
            .or(style.fill.map(Fill::Solid))
            .unwrap_or(Fill::None);
        let ln = sp_pr.and_then(|s| s.child("ln"));
        let line = read_line(ln, style.line, self.w);
        let (head, tail) = read_arrows(ln, self.w);
        let arrows = !head.is_none() || !tail.is_none();
        let base = kind
            .and_then(|k| self.def_for(ctx, k, ph_idx))
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
        // the style's text colour (`a:fontRef`) stays on the shape (`text_color`): runs
        // without a colour use it, also those typed later
        if geometry == Preset::Line && text.as_ref().is_some_and(TextBody::is_empty) {
            text = None;
        }
        let kind_of_shape =
            if geometry == Preset::Line && text.is_none() && kind.is_none() && arrows {
                // a line with arrowheads (LibreOffice writes lines as p:sp)
                ShapeKind::Connector(Connector {
                    head,
                    tail,
                    ..Connector::new(ConnectorKind::Straight)
                })
            } else {
                if arrows {
                    self.w.add("arrowheads dropped");
                }
                ShapeKind::Auto {
                    geometry,
                    adjust,
                    text,
                }
            };
        Some(Shape {
            id: file_id(el),
            alt: alt_of(el),
            name,
            transform,
            kind: kind_of_shape,
            fill,
            line,
            placeholder: kind,
            placeholder_idx: kind.and(ph_idx),
            click_action: None,
            hidden: false,
            lock_aspect: false,
            text_color: style.font,
        })
    }

    fn read_connector(&mut self, el: &El, space: Space) -> Option<Shape> {
        let nv = el.child("nvCxnSpPr");
        let name = nv
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let sp_pr = el.child("spPr");
        let Some(xfrm) = sp_pr.and_then(|s| s.child("xfrm")) else {
            self.w.add("shape without position dropped");
            return None;
        };
        let geom = sp_pr.and_then(|s| s.child("prstGeom"));
        let prst = geom.and_then(|g| g.attr("prst"));
        if sp_pr.is_some_and(|s| s.child("custGeom").is_some()) {
            self.w
                .add("custom connector geometry read as a straight line");
        }
        let (kind, bends) = match prst.map(|p| (p, ConnectorKind::from_prst(p))) {
            None => (ConnectorKind::Straight, 2),
            Some((_, Some(k))) => k,
            Some((other, None)) => {
                self.w
                    .add(format!("connector {other} read as a straight line"));
                (ConnectorKind::Straight, 2)
            }
        };
        let adjust = match (geom, prst) {
            (Some(g), Some(p)) => read_adjust(g, kind.adjust_defaults(bends), p, self.w),
            _ => Adjust::new(),
        };
        let style = read_style(el.child("style"), self.w);
        let fill = sp_pr
            .and_then(|s| read_fill(s, self.w))
            .unwrap_or(Fill::None);
        let ln = sp_pr.and_then(|s| s.child("ln"));
        let line = read_line(ln, style.line, self.w);
        let (head, tail) = read_arrows(ln, self.w);
        let cxn = nv.and_then(|n| n.child("cNvCxnSpPr"));
        let attach = |name: &str| {
            let e = cxn?.child(name)?;
            Some(Attach {
                // the file's shape id; mapped to node ids after the slide
                shape: NodeId(u64::from(e.attr("id").and_then(parse_u32)?)),
                site: e.attr("idx").and_then(parse_u32).unwrap_or(0),
            })
        };
        let (start, end) = (attach("stCxn"), attach("endCxn"));
        let plain_line = matches!(prst, None | Some("line"))
            && start.is_none()
            && end.is_none()
            && head.is_none()
            && tail.is_none();
        let kind = if plain_line {
            ShapeKind::Auto {
                geometry: Preset::Line,
                adjust: Adjust::new(),
                text: None,
            }
        } else {
            ShapeKind::Connector(Connector {
                kind,
                bends,
                start,
                end,
                head,
                tail,
                adjust,
            })
        };
        Some(Shape {
            id: file_id(el),
            alt: alt_of(el),
            name,
            transform: space.map(&read_xfrm(xfrm)),
            kind,
            fill,
            line,
            placeholder: None,
            placeholder_idx: None,
            click_action: None,
            hidden: false,
            lock_aspect: false,
            text_color: None,
        })
    }

    /// A `p:graphicFrame` holding a table.
    fn read_table_frame(&mut self, el: &El, space: Space) -> Option<Shape> {
        let name = el
            .child("nvGraphicFramePr")
            .and_then(|n| n.child("cNvPr"))
            .and_then(|c| c.attr("name"))
            .unwrap_or("")
            .to_owned();
        let Some(xfrm) = el.child("xfrm") else {
            self.w.add("shape without position dropped");
            return None;
        };
        let mut transform = space.map(&read_xfrm(xfrm));
        if transform.rotation_deg != 0.0 || transform.flip_h || transform.flip_v {
            self.w.add("table rotation and flips dropped");
            transform.rotation_deg = 0.0;
            transform.flip_h = false;
            transform.flip_v = false;
        }
        let tbl = el.find("tbl")?;
        let table = read_table(tbl, self.default_table_style.as_deref(), self.w)?;
        Some(Shape {
            id: file_id(el),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Table(table),
            fill: Fill::None,
            line: Line::default(),
            placeholder: None,
            placeholder_idx: None,
            click_action: None,
            hidden: false,
            lock_aspect: false,
            text_color: None,
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
        if let Some(mut clip) = self.read_media(el, ctx) {
            let Some(xfrm) = el.child("spPr").and_then(|s| s.child("xfrm")) else {
                self.w.add("shape without position dropped");
                return None;
            };
            let poster = blip
                .and_then(|b| b.attr("embed"))
                .and_then(|rid| target_of(self.pkg, ctx.part, rid));
            if let Some(poster) = poster {
                let generated = self
                    .pkg
                    .part(&poster)
                    .is_some_and(|p| p.data == crate::media::PLACEHOLDER_POSTER);
                if generated {
                    self.consumed.insert(poster);
                } else {
                    clip.poster = self.media_of_part(&poster, None);
                }
            }
            let style = read_style(el.child("style"), self.w);
            let line = read_line(
                el.child("spPr").and_then(|s| s.child("ln")),
                style.line,
                self.w,
            );
            return Some(Shape {
                id: file_id(el),
                alt: alt_of(el),
                name,
                transform: space.map(&read_xfrm(xfrm)),
                kind: ShapeKind::Media(clip),
                fill: Fill::None,
                line,
                placeholder: None,
                placeholder_idx: None,
                click_action: None,
                hidden: false,
                lock_aspect: false,
                text_color: None,
            });
        }
        let Some(rid) = blip.and_then(|b| b.attr("embed")) else {
            if blip.and_then(|b| b.attr("link")).is_some() {
                self.w.add("linked (external) pictures dropped");
            } else {
                self.w.add("picture without image dropped");
            }
            return None;
        };
        let media = self.image_of(ctx.part, rid, "picture")?;
        let sp_pr = el.child("spPr");
        let ph = ph_of(el);
        let ph_kind = ph.and_then(|ph| placeholder_kind(ph_type(ph), &ctx.layout.kind));
        let transform = match sp_pr.and_then(|s| s.child("xfrm")) {
            Some(x) => space.map(&read_xfrm(x)),
            None => match ph.and_then(|ph| self.inherited_xfrm(ph, ph_kind, ctx)) {
                Some(t) => t,
                None => {
                    self.w.add("shape without position dropped");
                    return None;
                }
            },
        };
        let props = self.read_picture_props(blip_fill, sp_pr, &transform);
        let style = read_style(el.child("style"), self.w);
        let line = read_line(sp_pr.and_then(|s| s.child("ln")), style.line, self.w);
        let ph_idx = ph
            .and_then(|ph| ph.attr("idx"))
            .and_then(parse_u32)
            .filter(|i| *i != 0);
        Some(Shape {
            id: file_id(el),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Picture { media, props },
            fill: Fill::None,
            line,
            placeholder: ph_kind,
            placeholder_idx: ph_kind.and(ph_idx),
            click_action: None,
            hidden: false,
            lock_aspect: false,
            text_color: None,
        })
    }

    /// Crop (`a:srcRect`), blip effects (`a:alphaModFix`, `a:grayscl`,
    /// `a:biLevel`, `a:duotone`, `a:lum`, PowerPoint 2010's
    /// `a14:brightnessContrast`), outline shape (`a:prstGeom`) and outer
    /// shadow of a picture.
    fn read_picture_props(
        &mut self,
        blip_fill: Option<&El>,
        sp_pr: Option<&El>,
        transform: &Transform,
    ) -> PictureProps {
        let mut props = PictureProps::default();
        let pct = |e: &El, a: &str| e.attr(a).and_then(parse_i64).unwrap_or(0) as f64 / 100_000.0;
        if let Some(r) = blip_fill.and_then(|b| b.child("srcRect")) {
            props.crop = Crop {
                left: pct(r, "l"),
                top: pct(r, "t"),
                right: pct(r, "r"),
                bottom: pct(r, "b"),
            };
        }
        if blip_fill.is_some_and(|b| b.child("tile").is_some()) {
            self.w.add("tiled picture fill read as stretched");
        }
        if let Some(blip) = blip_fill.and_then(|b| b.child("blip")) {
            for e in blip.elements() {
                match e.name.as_str() {
                    "alphaModFix" => {
                        let amt = e.attr("amt").and_then(parse_i64).unwrap_or(100_000);
                        props.transparency = (1.0 - amt as f64 / 100_000.0).clamp(0.0, 1.0);
                    }
                    "grayscl" => props.recolor = Recolor::Grayscale,
                    "biLevel" => {
                        props.recolor = Recolor::BlackWhite {
                            threshold: pct(e, "thresh"),
                        }
                    }
                    "duotone" => {
                        let colors: Vec<_> = e
                            .elements()
                            .filter_map(|c| crate::drawing::color_of(c, self.w))
                            .map(|c| self.p.theme.resolve(&c))
                            .collect();
                        if let [dark, light] = colors[..] {
                            props.recolor = if dark == core_model::Rgb::BLACK
                                && light == Recolor::SEPIA_LIGHT
                            {
                                Recolor::Sepia
                            } else {
                                Recolor::Duotone { dark, light }
                            };
                        } else {
                            self.w.add("picture duotone without two colours dropped");
                        }
                    }
                    "lum" => {
                        props.brightness = pct(e, "bright");
                        props.contrast = pct(e, "contrast");
                    }
                    "extLst" => {
                        if let Some(bc) = e.find("brightnessContrast") {
                            props.brightness = pct(bc, "bright");
                            props.contrast = pct(bc, "contrast");
                        }
                    }
                    other => self.w.add(format!("picture effect {other} dropped")),
                }
            }
        }
        if let Some(sp) = sp_pr {
            if sp
                .child("prstGeom")
                .is_some_and(|g| g.attr("prst") != Some("rect"))
                || sp.child("custGeom").is_some()
            {
                let (g, adjust) =
                    read_geometry(Some(sp), transform.w.0 as f64, transform.h.0 as f64, self.w);
                if !adjust.is_empty() {
                    self.w.add("picture shape adjust values dropped");
                }
                if g != Preset::Rect {
                    props.geometry = Some(g);
                }
            }
            if let Some(eff) = sp.child("effectLst") {
                for e in eff.elements() {
                    if e.name == "outerShdw" {
                        let n = |a: &str| e.attr(a).and_then(parse_i64).unwrap_or(0);
                        let (color, alpha) = color_and_alpha(e, self.w)
                            .unwrap_or((Color::Rgb(core_model::Rgb::BLACK), 1.0));
                        props.shadow = Some(Shadow {
                            color,
                            alpha,
                            blur: Emu(n("blurRad")),
                            distance: Emu(n("dist")),
                            direction_deg: n("dir") as f64 / ANGLE_UNITS_PER_DEGREE,
                        });
                    } else {
                        self.w
                            .add("picture effects other than an outer shadow dropped");
                    }
                }
            }
        }
        props
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
            id: file_id(el),
            alt: alt_of(el),
            name,
            transform,
            kind: ShapeKind::Group { children },
            fill: Fill::None,
            line: Line::default(),
            placeholder: None,
            placeholder_idx: None,
            click_action: None,
            hidden: false,
            lock_aspect: false,
            text_color: None,
        })
    }
}

/// Adds the placeholders of the Office master that `m` lacks (title,
/// body, date, footer, slide number – LibreOffice writes masters without
/// placeholders), with `m`'s text styles plus the Office placeholders'
/// own changes.
fn complete_master(m: &mut SlideMaster, builtin: &SlideMaster) {
    let office = model_show::TextStyles::office();
    for def in &builtin.placeholders {
        if m.placeholders.iter().any(|d| d.kind == def.kind) {
            continue;
        }
        let class = def.kind.text_class();
        let o = office.level(class, 0);
        let f = m.text_styles.level(class, 0);
        let mut d = def.clone();
        d.paragraph_defaults = f
            .paragraph
            .merged_with(&def.paragraph_defaults.diff_from(&o.paragraph));
        d.run_defaults = f
            .run
            .merged_with(&model_show::run_diff(&def.run_defaults, &o.run));
        m.placeholders.push(d);
    }
}

/// Gives slide placeholders without an `idx` the `idx` of the layout
/// placeholder they inherit from, unless another placeholder of the slide
/// already uses it (the writer applies the same rule, so ids round-trip).
pub(crate) fn normalize_placeholder_idx(shapes: &mut [Shape], layout: &Layout) {
    fn explicit(shapes: &[Shape], out: &mut HashSet<u32>) {
        for s in shapes {
            if let (Some(_), Some(i)) = (s.placeholder, s.placeholder_idx) {
                out.insert(i);
            }
            explicit(s.children(), out);
        }
    }
    fn fill(shapes: &mut [Shape], layout: &Layout, used: &mut HashSet<u32>) {
        for s in shapes {
            if let (Some(k), None) = (s.placeholder, s.placeholder_idx) {
                if let Some(d) = layout.find(k, None) {
                    if d.idx != 0 && used.insert(d.idx) {
                        s.placeholder_idx = Some(d.idx);
                    }
                }
            }
            if let ShapeKind::Group { children } = &mut s.kind {
                fill(children, layout, used);
            }
        }
    }
    let mut used = HashSet::new();
    explicit(shapes, &mut used);
    fill(shapes, layout, &mut used);
}

/// `p:cNvPr/@id` of a shape element as a provisional node id (0 if
/// missing); [`assign_ids`] replaces it.
fn file_id(shape: &El) -> NodeId {
    let id = shape
        .elements()
        .find(|e| e.name.starts_with("nv"))
        .and_then(|nv| nv.child("cNvPr"))
        .and_then(|c| c.attr("id"))
        .and_then(parse_u32)
        .unwrap_or(0);
    NodeId(u64::from(id))
}

/// Gives `shape` and its descendants fresh ids (like
/// [`Presentation::assign_ids`]), recording file shape id → node id (the
/// first shape wins when a file repeats an id).
fn assign_ids(p: &mut Presentation, shape: &mut Shape, map: &mut HashMap<u32, NodeId>) {
    let file = u32::try_from(shape.id.0).unwrap_or(0);
    shape.id = p.alloc_id();
    shape.fill_default_name();
    if file != 0 {
        map.entry(file).or_insert(shape.id);
    }
    if let ShapeKind::Group { children } = &mut shape.kind {
        for c in children {
            assign_ids(p, c, map);
        }
    }
}

/// Maps connector attachments from file shape ids to node ids (`spids`);
/// attachments to ids not on the slide are dropped. Returns whether any
/// was dropped.
fn remap_attachments(shapes: &mut [Shape], spids: &HashMap<u32, NodeId>) -> bool {
    let mut dropped = false;
    for s in shapes {
        match &mut s.kind {
            ShapeKind::Connector(c) => {
                for end in [&mut c.start, &mut c.end] {
                    if let Some(a) = end {
                        match u32::try_from(a.shape.0).ok().and_then(|f| spids.get(&f)) {
                            Some(&id) => a.shape = id,
                            None => {
                                *end = None;
                                dropped = true;
                            }
                        }
                    }
                }
            }
            ShapeKind::Group { children } => dropped |= remap_attachments(children, spids),
            _ => {}
        }
    }
    dropped
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
        // fitting a slide to the layout it references
        let size = SlideSize::widescreen();
        let title = Layout::builtin(LayoutKind::Title, size);
        let two = Layout::builtin(LayoutKind::TwoContent, size);
        let blank = Layout::builtin(LayoutKind::Blank, size);
        assert!(fits(&["title", "subTitle"], &title));
        assert!(!fits(&["title", "obj"], &title));
        assert!(fits(&["title", "obj", "obj"], &two));
        assert!(fits(&["pic"], &two));
        assert!(!fits(&[], &two));
        assert!(fits(&[], &blank));
        assert!(!fits(&["title"], &blank));
    }

    #[test]
    fn placeholder_kinds() {
        use LayoutKind::*;
        use PlaceholderKind as K;
        assert_eq!(placeholder_kind("title", &Title), Some(K::CenteredTitle));
        assert_eq!(placeholder_kind("ctrTitle", &Title), Some(K::CenteredTitle));
        assert_eq!(placeholder_kind("title", &TitleContent), Some(K::Title));
        assert_eq!(placeholder_kind("ctrTitle", &TitleContent), Some(K::Title));
        assert_eq!(placeholder_kind("subTitle", &Title), Some(K::Subtitle));
        assert_eq!(placeholder_kind("obj", &TitleContent), Some(K::Body));
        assert_eq!(placeholder_kind("body", &TitleContent), Some(K::Body));
        assert_eq!(placeholder_kind("pic", &TitleContent), Some(K::Picture));
        assert_eq!(
            placeholder_kind("sldNum", &TitleContent),
            Some(K::SlideNumber)
        );
        assert_eq!(placeholder_kind("ftr", &Blank), Some(K::Footer));
        assert_eq!(placeholder_kind("dt", &Blank), Some(K::DateTime));
        assert_eq!(placeholder_kind("hdr", &Blank), None);
    }

    #[test]
    fn placeholder_idx_normalization() {
        let two = Layout::builtin(LayoutKind::TwoContent, SlideSize::widescreen());
        let mut shapes: Vec<Shape> = (0..3)
            .map(|_| {
                let mut s = Shape::text_box(Transform::default(), "");
                s.placeholder = Some(PlaceholderKind::Body);
                s
            })
            .collect();
        shapes[2].placeholder_idx = Some(1);
        normalize_placeholder_idx(&mut shapes, &two);
        // idx 1 is taken by the explicit one: the first stays without
        let idx: Vec<_> = shapes.iter().map(|s| s.placeholder_idx).collect();
        assert_eq!(idx, [None, None, Some(1)]);
        shapes[2].placeholder_idx = None;
        normalize_placeholder_idx(&mut shapes, &two);
        let idx: Vec<_> = shapes.iter().map(|s| s.placeholder_idx).collect();
        assert_eq!(idx, [Some(1), None, None]);
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
