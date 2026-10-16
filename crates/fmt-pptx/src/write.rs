//! [`Presentation`] → `.pptx`. Every part is regenerated (only the theme
//! may come verbatim from [`PptxContext`]): the master and the
//! presentation's layouts, slides, notes; the output is deterministic.

use std::collections::HashMap;
use std::io::Cursor;

use core_model::chart::ChartKind;
use fmt_ooxml::chart::{write_chart_with, ChartWriteOptions};
use fmt_ooxml::{ct, rel, Package, PartName, Relationships};
use model_show::clip::media_extension;
use model_show::{
    Adjust, ChartShape, Connector, Fill, HfDate, Layout, LayoutKind, MediaClip, MediaId, MediaKind,
    NodeId, PictureProps, Presentation, Preset, Recolor, Shape, ShapeKind, Slide, Table,
};

use crate::anim::{write_timing, write_transition, MediaTarget, Target};
use crate::chart::{workbook_xlsx, TableData, CHART_URI, PACKAGE_REL, XLSX_CT};
use crate::drawing::{
    deg_to_rot, write_color_with_alpha, write_fill, write_line, write_line_with_ends,
    write_text_body, write_xfrm,
};
use crate::geom::{write_av_lst, write_geometry};
use crate::link::{write_hlink, LinkSink, LinkXml, PartLinks, MEDIA_ACTION};
use crate::master::{
    ph_attrs, placeholder_sp, write_background, write_clr_map, write_hf, write_text_styles, PhWrite,
};
use crate::media::{AUDIO_REL, MEDIA_EXT_URI, MEDIA_REL, PLACEHOLDER_POSTER, VIDEO_REL};
use crate::parts::{self, sp_tree_start, ROOT_NS};
use crate::table::{write_table, TABLE_URI};
use crate::theme::{read_theme, theme_xml};
use crate::xml::XmlOut;
use crate::{Error, PptxContext, Result};

/// Writes `presentation` as `.pptx` bytes with a theme part generated from
/// [`Presentation::theme`].
pub fn write(presentation: &Presentation) -> Result<Vec<u8>> {
    write_with_context(presentation, &PptxContext::default())
}

/// The layouts written: the presentation's, plus built-ins for standard
/// layouts slides use that the list lacks.
fn written_layouts(p: &Presentation) -> Vec<Layout> {
    let mut out = p.layouts.clone();
    for s in &p.slides {
        if !out.iter().any(|l| l.kind == s.layout) {
            out.push(p.layout_or_builtin(&s.layout));
        }
    }
    out
}

/// Writes `presentation` as `.pptx` bytes, reusing the theme part from
/// `ctx` (as returned by [`read_with_context`](crate::read_with_context))
/// if it still matches the presentation's theme.
///
/// Fails with [`Error::InvalidPresentation`] if a picture references media
/// that is not in the presentation's store.
pub fn write_with_context(p: &Presentation, ctx: &PptxContext) -> Result<Vec<u8>> {
    let pn = PartName::new;
    let layouts = written_layouts(p);
    let mut media = MediaParts::default();
    let (master_xml, master_rels) = write_master(p, &layouts, &mut media)?;
    let mut layout_parts = Vec::with_capacity(layouts.len());
    for layout in &layouts {
        layout_parts.push(write_layout(p, layout, &mut media)?);
    }
    let mut slides = Vec::with_capacity(p.slides.len());
    for (i, slide) in p.slides.iter().enumerate() {
        slides.push(write_slide(p, &layouts, slide, i + 1, &mut media)?);
    }
    let has_notes = p.slides.iter().any(|s| s.notes.is_some());

    let mut pkg = Package::new();
    let main = pn("/ppt/presentation.xml")?;
    let mut pres_rels = Relationships::new();
    pres_rels.add(rel::SLIDE_MASTER, "slideMasters/slideMaster1.xml");
    for i in 0..p.slides.len() {
        pres_rels.add(rel::SLIDE, format!("slides/slide{}.xml", i + 1));
    }
    pres_rels.add(rel::PRES_PROPS, "presProps.xml");
    pres_rels.add(rel::VIEW_PROPS, "viewProps.xml");
    pres_rels.add(rel::THEME, "theme/theme1.xml");
    pres_rels.add(rel::TABLE_STYLES, "tableStyles.xml");
    let notes_master_rid = has_notes.then(|| {
        pres_rels
            .add(rel::NOTES_MASTER, "notesMasters/notesMaster1.xml")
            .id
            .clone()
    });
    pkg.insert_part(
        main.clone(),
        ct::PRESENTATION,
        parts::presentation_xml(p, notes_master_rid.as_deref()),
    );
    pkg.set_relationships(main, pres_rels);

    let master = pn("/ppt/slideMasters/slideMaster1.xml")?;
    pkg.insert_part(master.clone(), ct::SLIDE_MASTER, master_xml);
    pkg.set_relationships(master, master_rels);

    for (i, (xml, rels)) in layout_parts.into_iter().enumerate() {
        let name = PartName::new(format!("/ppt/slideLayouts/slideLayout{}.xml", i + 1))?;
        pkg.insert_part(name.clone(), ct::SLIDE_LAYOUT, xml);
        pkg.set_relationships(name, rels);
    }

    for (i, (xml, rels)) in slides.into_iter().enumerate() {
        let name = PartName::new(format!("/ppt/slides/slide{}.xml", i + 1))?;
        pkg.insert_part(name.clone(), ct::SLIDE, xml);
        pkg.set_relationships(name, rels);
    }

    if has_notes {
        let master = pn("/ppt/notesMasters/notesMaster1.xml")?;
        pkg.insert_part(master.clone(), ct::NOTES_MASTER, parts::notes_master_xml());
        let mut r = Relationships::new();
        r.add(rel::THEME, "../theme/theme2.xml");
        pkg.set_relationships(master, r);
        for (i, slide) in p.slides.iter().enumerate() {
            let Some(notes) = &slide.notes else { continue };
            let name = PartName::new(format!("/ppt/notesSlides/notesSlide{}.xml", i + 1))?;
            pkg.insert_part(name.clone(), ct::NOTES_SLIDE, parts::notes_slide_xml(notes));
            let mut r = Relationships::new();
            r.add(rel::NOTES_MASTER, "../notesMasters/notesMaster1.xml");
            r.add(rel::SLIDE, format!("../slides/slide{}.xml", i + 1));
            pkg.set_relationships(name, r);
        }
    }

    let theme = match &ctx.theme_xml {
        Some(xml) if read_theme(xml, "theme").ok().as_ref() == Some(&p.theme) => xml.clone(),
        _ => theme_xml(&p.theme),
    };
    if has_notes {
        pkg.insert_part(pn("/ppt/theme/theme2.xml")?, ct::THEME, theme_xml(&p.theme));
    }
    pkg.insert_part(pn("/ppt/theme/theme1.xml")?, ct::THEME, theme);
    pkg.insert_part(
        pn("/ppt/presProps.xml")?,
        ct::PRES_PROPS,
        crate::props::pres_props_xml(&p.show_settings),
    );
    pkg.insert_part(
        pn("/ppt/viewProps.xml")?,
        ct::VIEW_PROPS,
        crate::props::view_props_xml(&p.view),
    );
    pkg.insert_part(
        pn("/ppt/tableStyles.xml")?,
        ct::TABLE_STYLES,
        parts::table_styles_xml(),
    );
    for (name, content_type, data) in media.parts {
        pkg.insert_part(PartName::new(format!("/ppt/{name}"))?, content_type, data);
    }
    for c in media.charts {
        let name = PartName::new(format!("/ppt/{}", c.name))?;
        pkg.insert_part(name.clone(), ct::CHART, c.xml);
        pkg.set_relationships(name, c.rels);
        if let Some((wb, bytes)) = c.workbook {
            pkg.insert_part(PartName::new(format!("/ppt/{wb}"))?, XLSX_CT, bytes);
        }
    }
    pkg.insert_part(
        pn("/docProps/core.xml")?,
        ct::CORE_PROPERTIES,
        parts::core_xml(),
    );
    pkg.insert_part(
        pn("/docProps/app.xml")?,
        ct::EXTENDED_PROPERTIES,
        parts::app_xml(p.slides.len()),
    );
    let root = pkg.package_relationships_mut();
    root.add(rel::OFFICE_DOCUMENT, "ppt/presentation.xml");
    root.add(rel::CORE_PROPERTIES, "docProps/core.xml");
    root.add(rel::EXTENDED_PROPERTIES, "docProps/app.xml");
    Ok(pkg.write(Cursor::new(Vec::new()))?.into_inner())
}

/// `ppt/slideMasters/slideMaster1.xml` and its relationships (layouts
/// `rId1`…, the theme, then images of its shapes).
fn write_master(
    p: &Presentation,
    layouts: &[Layout],
    media: &mut MediaParts,
) -> Result<(Vec<u8>, Relationships)> {
    let m = &p.master;
    let mut rels = Relationships::new();
    for i in 0..layouts.len() {
        rels.add(
            rel::SLIDE_LAYOUT,
            format!("../slideLayouts/slideLayout{}.xml", i + 1),
        );
    }
    rels.add(rel::THEME, "../theme/theme1.xml");
    let mut w = SlideWriter::new(p, rels, media, &m.shapes);
    w.x.start("p:sldMaster", &ROOT_NS);
    if m.name.is_empty() {
        w.x.start("p:cSld", &[]);
    } else {
        w.x.start("p:cSld", &[("name", &m.name)]);
    }
    write_background(&mut w.x, &m.background);
    sp_tree_start(&mut w.x);
    for s in &m.shapes {
        w.shape(s)?;
    }
    for def in &m.placeholders {
        let l = m.text_styles.level(def.kind.text_class(), 0);
        let id = w.next_shape_id;
        w.next_shape_id += 1;
        placeholder_sp(
            &mut w.x,
            &PhWrite {
                id,
                def,
                text_base: Some((&l.paragraph, &l.run)),
                body_base: None,
                xfrm: true,
                master: true,
                hf: &m.header_footer,
            },
        );
    }
    w.x.end("p:spTree");
    w.x.end("p:cSld");
    write_clr_map(&mut w.x, &m.color_map);
    w.x.start("p:sldLayoutIdLst", &[]);
    for i in 0..layouts.len() {
        let id = (2_147_483_649u64 + i as u64).to_string();
        let rid = format!("rId{}", i + 1);
        w.x.empty("p:sldLayoutId", &[("id", &id), ("r:id", &rid)]);
    }
    w.x.end("p:sldLayoutIdLst");
    let hf = &m.header_footer;
    write_hf(
        &mut w.x,
        hf.date != HfDate::Off,
        hf.footer.is_some(),
        hf.slide_number,
    );
    write_text_styles(&mut w.x, &m.text_styles);
    w.x.end("p:sldMaster");
    Ok((w.x.finish(), w.rels))
}

/// One `ppt/slideLayouts/slideLayoutN.xml` and its relationships (master,
/// then images of its shapes). Placeholders state only what differs from
/// the master's (no `a:xfrm` when the position is the master's).
fn write_layout(
    p: &Presentation,
    layout: &Layout,
    media: &mut MediaParts,
) -> Result<(Vec<u8>, Relationships)> {
    let m = &p.master;
    let mut rels = Relationships::new();
    rels.add(rel::SLIDE_MASTER, "../slideMasters/slideMaster1.xml");
    let mut w = SlideWriter::new(p, rels, media, &layout.shapes);
    let mut attrs: Vec<(&str, &str)> = ROOT_NS.to_vec();
    attrs.push(("type", layout.kind.ooxml_type()));
    attrs.push(("preserve", "1"));
    if !layout.show_master_shapes {
        attrs.push(("showMasterSp", "0"));
    }
    w.x.start("p:sldLayout", &attrs);
    w.x.start("p:cSld", &[("name", layout.display_name())]);
    if let Some(bg) = &layout.background {
        write_background(&mut w.x, bg);
    }
    sp_tree_start(&mut w.x);
    for s in &layout.shapes {
        w.shape(s)?;
    }
    for def in &layout.placeholders {
        let base = m.placeholder_for(def.kind);
        let style = m.style_defaults(def.kind);
        let text_base = match base {
            Some(b) => (&b.paragraph_defaults, &b.run_defaults),
            None => (&style.0, &style.1),
        };
        let default_body = model_show::BodyProps::default();
        let body_base = base.map_or(&default_body, |b| &b.body_defaults);
        let id = w.next_shape_id;
        w.next_shape_id += 1;
        placeholder_sp(
            &mut w.x,
            &PhWrite {
                id,
                def,
                text_base: Some(text_base),
                body_base: Some(body_base),
                xfrm: base.map_or(true, |b| b.transform != def.transform),
                master: false,
                hf: &m.header_footer,
            },
        );
    }
    w.x.end("p:spTree");
    w.x.end("p:cSld");
    w.x.start("p:clrMapOvr", &[]);
    w.x.empty("a:masterClrMapping", &[]);
    w.x.end("p:clrMapOvr");
    if layout.kind == LayoutKind::Title && m.header_footer.not_on_title {
        write_hf(&mut w.x, false, false, false);
    }
    w.x.end("p:sldLayout");
    Ok((w.x.finish(), w.rels))
}

/// File extension for a media content type.
fn extension_of(content_type: &str) -> &str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpeg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        "image/x-emf" | "image/emf" => "emf",
        "image/x-wmf" | "image/wmf" => "wmf",
        _ => "bin",
    }
}

/// A chart part to write.
struct ChartPartOut {
    /// `charts/chartN.xml` (relative to `/ppt/`).
    name: String,
    xml: Vec<u8>,
    rels: Relationships,
    /// `embeddings/…xlsx` and its bytes.
    workbook: Option<(String, Vec<u8>)>,
}

/// Media parts of the package (images `media/imageN.ext`, audio/video
/// `media/mediaN.ext`), numbered in first-reference order, and the chart
/// parts.
#[derive(Default)]
struct MediaParts {
    /// Media id → part name (relative to `/ppt/`).
    names: HashMap<MediaId, String>,
    /// (part name, content type, bytes).
    parts: Vec<(String, String, Vec<u8>)>,
    images: usize,
    clips: usize,
    /// The generated poster of clips without one.
    placeholder: Option<String>,
    charts: Vec<ChartPartOut>,
}

impl MediaParts {
    /// The image part of media `id`.
    fn name_of(&mut self, p: &Presentation, id: MediaId) -> Result<String> {
        self.part_of(p, id, false)
    }

    fn part_of(&mut self, p: &Presentation, id: MediaId, clip: bool) -> Result<String> {
        if let Some(n) = self.names.get(&id) {
            return Ok(n.clone());
        }
        let m = p.media.get(id).ok_or_else(|| {
            Error::InvalidPresentation(format!("a shape references missing media {}", id.0))
        })?;
        let name = if clip {
            self.clips += 1;
            format!(
                "media/media{}.{}",
                self.clips,
                media_extension(&m.content_type)
            )
        } else {
            self.images += 1;
            format!(
                "media/image{}.{}",
                self.images,
                extension_of(&m.content_type)
            )
        };
        self.parts
            .push((name.clone(), m.content_type.clone(), m.data.clone()));
        self.names.insert(id, name.clone());
        Ok(name)
    }

    /// The generated poster image.
    fn placeholder_poster(&mut self) -> String {
        if let Some(n) = &self.placeholder {
            return n.clone();
        }
        self.images += 1;
        let name = format!("media/image{}.png", self.images);
        self.parts.push((
            name.clone(),
            "image/png".to_owned(),
            PLACEHOLDER_POSTER.to_vec(),
        ));
        self.placeholder = Some(name.clone());
        name
    }
}

struct SlideWriter<'a> {
    x: XmlOut,
    p: &'a Presentation,
    rels: Relationships,
    media: &'a mut MediaParts,
    /// Media id → relationship id within this part.
    media_rels: HashMap<MediaId, String>,
    next_shape_id: u32,
    /// Node id → how the shape was written (animation targets).
    targets: HashMap<NodeId, Target>,
    /// Node id → the `p:cNvPr id` it is written with (connector targets).
    spids: HashMap<NodeId, u32>,
    /// The slide's layout (placeholder types and indexes).
    layout: Option<Layout>,
    /// Node id → the `idx` a placeholder is written with.
    ph_idx: HashMap<NodeId, u32>,
    /// Link targets → relationship ids of this part.
    link_cache: HashMap<String, String>,
    /// The slides folder relative to this part (links to slides).
    slides_dir: &'static str,
    /// Media shapes written (`spid`, clip), for `p:timing`.
    clips: Vec<(u32, MediaClip)>,
}

impl<'a> SlideWriter<'a> {
    fn new(
        p: &'a Presentation,
        rels: Relationships,
        media: &'a mut MediaParts,
        shapes: &[Shape],
    ) -> Self {
        SlideWriter {
            x: XmlOut::new(),
            p,
            rels,
            media,
            media_rels: HashMap::new(),
            next_shape_id: 2,
            targets: HashMap::new(),
            spids: shape_ids(shapes),
            layout: None,
            ph_idx: HashMap::new(),
            link_cache: HashMap::new(),
            slides_dir: "../slides/",
            clips: Vec::new(),
        }
    }

    /// The `a:hlinkClick` of `link` (relationships added to this part).
    fn link_xml(&mut self, link: &model_show::Hyperlink) -> Option<LinkXml> {
        let p = self.p;
        let number = move |id: NodeId| p.slide_index(id).map(|i| i + 1);
        PartLinks {
            rels: &mut self.rels,
            slide_number: &number,
            slides_dir: self.slides_dir,
            cache: &mut self.link_cache,
        }
        .link(link)
    }

    /// Writes a text body with this part's links.
    fn text_body(&mut self, name: &str, body: &model_show::TextBody) {
        let p = self.p;
        let number = move |id: NodeId| p.slide_index(id).map(|i| i + 1);
        let mut links = PartLinks {
            rels: &mut self.rels,
            slide_number: &number,
            slides_dir: self.slides_dir,
            cache: &mut self.link_cache,
        };
        write_text_body(&mut self.x, name, body, &mut links);
    }
}

/// The `p:cNvPr id` every shape of `shapes` gets: 2, 3, … in document
/// order (a group before its children), as [`SlideWriter::ids`] assigns
/// them.
fn shape_ids(shapes: &[Shape]) -> HashMap<NodeId, u32> {
    fn walk(shapes: &[Shape], next: &mut u32, out: &mut HashMap<NodeId, u32>) {
        for s in shapes {
            out.insert(s.id, *next);
            *next += 1;
            walk(s.children(), next, out);
        }
    }
    let mut out = HashMap::new();
    walk(shapes, &mut 2, &mut out);
    out
}

/// The `idx` each placeholder of `shapes` is written with: its own, else
/// its layout placeholder's when no other placeholder of the slide uses
/// it (see `read::normalize_placeholder_idx`); none for the others.
fn placeholder_indexes(shapes: &[Shape], layout: &Layout) -> HashMap<NodeId, u32> {
    let mut work = shapes.to_vec();
    crate::read::normalize_placeholder_idx(&mut work, layout);
    let mut out = HashMap::new();
    fn walk(shapes: &[Shape], out: &mut HashMap<NodeId, u32>) {
        for s in shapes {
            if let (Some(_), Some(i)) = (s.placeholder, s.placeholder_idx) {
                out.insert(s.id, i);
            }
            walk(s.children(), out);
        }
    }
    walk(&work, &mut out);
    out
}

/// One slide part and its relationships.
///
/// `number` is the slide's 1-based part number (also of its notes part).
fn write_slide(
    p: &Presentation,
    layouts: &[Layout],
    slide: &Slide,
    number: usize,
    media: &mut MediaParts,
) -> Result<(Vec<u8>, Relationships)> {
    let mut rels = Relationships::new();
    let n = layouts
        .iter()
        .position(|l| l.kind == slide.layout)
        .map_or(1, |i| i + 1);
    rels.add(
        rel::SLIDE_LAYOUT,
        format!("../slideLayouts/slideLayout{n}.xml"),
    );
    if slide.notes.is_some() {
        rels.add(
            rel::NOTES_SLIDE,
            format!("../notesSlides/notesSlide{number}.xml"),
        );
    }
    let layout = layouts
        .get(n - 1)
        .cloned()
        .unwrap_or_else(|| p.layout_or_builtin(&slide.layout));
    let mut w = SlideWriter::new(p, rels, media, &slide.shapes);
    w.slides_dir = "";
    w.ph_idx = placeholder_indexes(&slide.shapes, &layout);
    w.layout = Some(layout);
    let mut root: Vec<(&str, &str)> = ROOT_NS.to_vec();
    if !slide.show_master_shapes {
        root.push(("showMasterSp", "0"));
    }
    if slide.hidden {
        root.push(("show", "0"));
    }
    w.x.start("p:sld", &root);
    w.x.start("p:cSld", &[]);
    if let Some(bg) = &slide.background {
        w.x.start("p:bg", &[]);
        w.x.start("p:bgPr", &[]);
        write_fill(&mut w.x, bg);
        w.x.empty("a:effectLst", &[]);
        w.x.end("p:bgPr");
        w.x.end("p:bg");
    }
    sp_tree_start(&mut w.x);
    for s in &slide.shapes {
        w.shape(s)?;
    }
    w.x.end("p:spTree");
    w.x.end("p:cSld");
    w.x.start("p:clrMapOvr", &[]);
    w.x.empty("a:masterClrMapping", &[]);
    w.x.end("p:clrMapOvr");
    if let Some(t) = &slide.transition {
        write_transition(&mut w.x, t);
    }
    let clips = std::mem::take(&mut w.clips);
    let media_targets: Vec<MediaTarget<'_>> = clips
        .iter()
        .map(|(spid, clip)| MediaTarget { spid: *spid, clip })
        .collect();
    if !slide.animations.is_empty() || !media_targets.is_empty() {
        write_timing(&mut w.x, &slide.animations, &w.targets, &media_targets).map_err(|id| {
            Error::InvalidPresentation(format!(
                "animation {} targets a shape that is not on slide {number}",
                id.0
            ))
        })?;
    }
    w.x.end("p:sld");
    Ok((w.x.finish(), w.rels))
}

impl SlideWriter<'_> {
    /// `(id, name)` for the next `p:cNvPr`; empty names get PowerPoint-style
    /// defaults (`"Rectangle 3"`).
    /// `p:cNvPr` attributes: id, name and (if set) the alt text.
    fn c_nv_pr(&mut self, s: &Shape) {
        let (id, name) = self.ids(s);
        self.targets.insert(
            s.id,
            Target {
                spid: self.next_shape_id - 1,
                text: false,
                placeholder: false,
            },
        );
        let mut attrs = vec![("id", id.as_str()), ("name", name.as_str())];
        if let Some(alt) = s.alt.as_deref().filter(|a| !a.is_empty()) {
            attrs.push(("descr", alt));
        }
        if s.hidden {
            attrs.push(("hidden", "1"));
        }
        let link = match &s.click_action {
            Some(a) => self.link_xml(a),
            None if matches!(s.kind, ShapeKind::Media(_)) => Some(LinkXml {
                rid: String::new(),
                action: Some(MEDIA_ACTION.to_owned()),
                tooltip: None,
            }),
            None => None,
        };
        match link {
            Some(l) => {
                self.x.start("p:cNvPr", &attrs);
                write_hlink(&mut self.x, &l);
                self.x.end("p:cNvPr");
            }
            None => self.x.empty("p:cNvPr", &attrs),
        }
    }

    fn ids(&mut self, s: &Shape) -> (String, String) {
        let id = self.next_shape_id;
        self.next_shape_id += 1;
        let name = if s.name.is_empty() {
            format!("{} {}", s.default_name(), id - 1)
        } else {
            s.name.clone()
        };
        (id.to_string(), name)
    }

    fn shape(&mut self, s: &Shape) -> Result<()> {
        match &s.kind {
            ShapeKind::Auto {
                geometry,
                adjust,
                text,
            } => {
                let textless = !matches!(text, Some(t) if !t.is_empty());
                if *geometry == Preset::Line && textless && s.placeholder.is_none() {
                    self.line_connector(s);
                } else {
                    self.auto_shape(s, geometry, adjust);
                }
            }
            ShapeKind::Connector(c) => self.connector(s, c),
            ShapeKind::Table(t) => self.table(s, t),
            ShapeKind::Picture { media, props } => self.picture(s, *media, props)?,
            ShapeKind::Chart(c) => self.chart(s, c)?,
            ShapeKind::Media(m) => self.media_shape(s, m)?,
            ShapeKind::Group { children } => {
                let x = &mut self.x;
                x.start("p:grpSp", &[]);
                x.start("p:nvGrpSpPr", &[]);
                self.c_nv_pr(s);
                let x = &mut self.x;
                x.empty("p:cNvGrpSpPr", &[]);
                x.empty("p:nvPr", &[]);
                x.end("p:nvGrpSpPr");
                x.start("p:grpSpPr", &[]);
                write_xfrm(x, &s.transform, true);
                x.end("p:grpSpPr");
                for c in children {
                    self.shape(c)?;
                }
                self.x.end("p:grpSp");
            }
        }
        Ok(())
    }

    fn geometry(&mut self, prst: &str) {
        self.x.start("a:prstGeom", &[("prst", prst)]);
        self.x.empty("a:avLst", &[]);
        self.x.end("a:prstGeom");
    }

    /// Writes `p:nvPr` with the shape's `p:ph` (type and orientation as
    /// its layout placeholder has them, the slide's `idx`), or empty.
    fn nv_pr(&mut self, s: &Shape) {
        let Some(kind) = s.placeholder else {
            self.x.empty("p:nvPr", &[]);
            return;
        };
        let idx = self.ph_idx.get(&s.id).copied().unwrap_or(0);
        let def = self
            .layout
            .as_ref()
            .and_then(|l| l.find(kind, (idx != 0).then_some(idx)));
        let text_only = def.is_some_and(|d| d.kind == kind && d.text_only);
        let vertical = def.is_some_and(|d| d.vertical);
        let attrs = ph_attrs(kind, text_only, vertical, idx);
        let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        self.x.start("p:nvPr", &[]);
        self.x.empty("p:ph", &attrs);
        self.x.end("p:nvPr");
    }

    fn auto_shape(&mut self, s: &Shape, geometry: &Preset, adjust: &Adjust) {
        let x = &mut self.x;
        x.start("p:sp", &[]);
        x.start("p:nvSpPr", &[]);
        self.c_nv_pr(s);
        let x = &mut self.x;
        if s.placeholder.is_some() {
            x.start("p:cNvSpPr", &[]);
            x.empty("a:spLocks", &[("noGrp", "1")]);
            x.end("p:cNvSpPr");
        } else if s.is_text_box() {
            x.empty("p:cNvSpPr", &[("txBox", "1")]);
        } else {
            x.empty("p:cNvSpPr", &[]);
        }
        self.nv_pr(s);
        let x = &mut self.x;
        x.end("p:nvSpPr");
        x.start("p:spPr", &[]);
        write_xfrm(x, &s.transform, false);
        write_geometry(x, geometry, adjust);
        write_fill(&mut self.x, &s.fill);
        write_line(&mut self.x, &s.line);
        self.x.end("p:spPr");
        if let Some(body) = s.text() {
            self.text_body("p:txBody", body);
            if let Some(t) = self.targets.get_mut(&s.id) {
                t.text = true;
                t.placeholder = s.placeholder.is_some();
            }
        }
        self.x.end("p:sp");
    }

    /// A connector: `p:cxnSp` with `a:stCxn`/`a:endCxn` (by the targets'
    /// written ids) and arrowheads.
    fn connector(&mut self, s: &Shape, c: &Connector) {
        let x = &mut self.x;
        x.start("p:cxnSp", &[]);
        x.start("p:nvCxnSpPr", &[]);
        self.c_nv_pr(s);
        let ends: Vec<(&str, String, String)> = [("a:stCxn", c.start), ("a:endCxn", c.end)]
            .into_iter()
            .filter_map(|(name, a)| {
                let a = a?;
                let id = self.spids.get(&a.shape)?;
                Some((name, id.to_string(), a.site.to_string()))
            })
            .collect();
        let x = &mut self.x;
        if ends.is_empty() {
            x.empty("p:cNvCxnSpPr", &[]);
        } else {
            x.start("p:cNvCxnSpPr", &[]);
            for (name, id, idx) in &ends {
                x.empty(name, &[("id", id), ("idx", idx)]);
            }
            x.end("p:cNvCxnSpPr");
        }
        x.empty("p:nvPr", &[]);
        x.end("p:nvCxnSpPr");
        x.start("p:spPr", &[]);
        write_xfrm(x, &s.transform, false);
        x.start("a:prstGeom", &[("prst", &c.prst())]);
        write_av_lst(x, &c.adjust);
        x.end("a:prstGeom");
        if s.fill != Fill::None {
            write_fill(x, &s.fill);
        }
        write_line_with_ends(x, "a:ln", &s.line, &c.head, &c.tail);
        x.end("p:spPr");
        x.end("p:cxnSp");
    }

    /// A table: `p:graphicFrame` with `a:tbl`.
    fn table(&mut self, s: &Shape, t: &Table) {
        self.frame_start(s);
        let x = &mut self.x;
        x.start("a:graphic", &[]);
        x.start("a:graphicData", &[("uri", TABLE_URI)]);
        let p = self.p;
        let number = move |id: NodeId| p.slide_index(id).map(|i| i + 1);
        let mut links = PartLinks {
            rels: &mut self.rels,
            slide_number: &number,
            slides_dir: self.slides_dir,
            cache: &mut self.link_cache,
        };
        write_table(&mut self.x, t, &mut links);
        let x = &mut self.x;
        x.end("a:graphicData");
        x.end("a:graphic");
        x.end("p:graphicFrame");
    }

    /// A plain line (`Auto` with `Preset::Line`): `p:cxnSp` with
    /// `prst="line"`.
    fn line_connector(&mut self, s: &Shape) {
        let x = &mut self.x;
        x.start("p:cxnSp", &[]);
        x.start("p:nvCxnSpPr", &[]);
        self.c_nv_pr(s);
        let x = &mut self.x;
        x.empty("p:cNvCxnSpPr", &[]);
        x.empty("p:nvPr", &[]);
        x.end("p:nvCxnSpPr");
        x.start("p:spPr", &[]);
        write_xfrm(x, &s.transform, false);
        self.geometry("line");
        if s.fill != Fill::None {
            write_fill(&mut self.x, &s.fill);
        }
        write_line(&mut self.x, &s.line);
        self.x.end("p:spPr");
        self.x.end("p:cxnSp");
    }

    /// `p:nvGraphicFramePr` + `p:xfrm` of a graphic frame (tables, charts).
    fn frame_start(&mut self, s: &Shape) {
        self.x.start("p:graphicFrame", &[]);
        self.x.start("p:nvGraphicFramePr", &[]);
        self.c_nv_pr(s);
        let x = &mut self.x;
        x.start("p:cNvGraphicFramePr", &[]);
        x.empty("a:graphicFrameLocks", &[("noGrp", "1")]);
        x.end("p:cNvGraphicFramePr");
        x.empty("p:nvPr", &[]);
        x.end("p:nvGraphicFramePr");
        let tr = &s.transform;
        x.start("p:xfrm", &[]);
        x.empty(
            "a:off",
            &[("x", &tr.x.0.to_string()), ("y", &tr.y.0.to_string())],
        );
        x.empty(
            "a:ext",
            &[
                ("cx", &tr.w.0.max(0).to_string()),
                ("cy", &tr.h.0.max(0).to_string()),
            ],
        );
        x.end("p:xfrm");
    }

    /// A chart: `p:graphicFrame` → `c:chart r:id` → `ppt/charts/chartN.xml`
    /// (+ the embedded workbook).
    fn chart(&mut self, s: &Shape, c: &ChartShape) -> Result<()> {
        let n = self.media.charts.len() + 1;
        let mut rels = Relationships::new();
        let unsupported = matches!(c.chart.kind, ChartKind::Unsupported { .. });
        let workbook = if unsupported {
            None
        } else {
            let bytes = match c.workbook.and_then(|id| self.p.media.get(id)) {
                Some(m) => m.data.clone(),
                None => workbook_xlsx(&c.data)?,
            };
            Some((
                format!("embeddings/Microsoft_Excel_Worksheet{n}.xlsx"),
                bytes,
            ))
        };
        let external_data = workbook
            .as_ref()
            .map(|(name, _)| rels.add(PACKAGE_REL, format!("../{name}")).id.clone());
        let xml = write_chart_with(
            &c.chart,
            &TableData::new(c),
            &ChartWriteOptions {
                external_data,
                transparent_area: true,
            },
        );
        let name = format!("charts/chart{n}.xml");
        let rid = self.rels.add(rel::CHART, format!("../{name}")).id.clone();
        self.media.charts.push(ChartPartOut {
            name,
            xml,
            rels,
            workbook,
        });
        self.frame_start(s);
        let x = &mut self.x;
        x.start("a:graphic", &[]);
        x.start("a:graphicData", &[("uri", CHART_URI)]);
        x.empty(
            "c:chart",
            &[
                ("xmlns:c", fmt_ooxml::chart::CHART_NS),
                ("xmlns:r", crate::parts::NS_R),
                ("r:id", &rid),
            ],
        );
        x.end("a:graphicData");
        x.end("a:graphic");
        x.end("p:graphicFrame");
        Ok(())
    }

    /// Audio/video: `p:pic` with `a:videoFile`/`a:audioFile r:link` and
    /// `p14:media r:embed` (both to `media/mediaN.ext`), the poster (or
    /// the generated placeholder) as the picture.
    fn media_shape(&mut self, s: &Shape, clip: &MediaClip) -> Result<()> {
        let file = self.media.part_of(self.p, clip.media, true)?;
        let embed = self.rels.add(MEDIA_REL, format!("../{file}")).id.clone();
        let (file_el, link_rel) = match clip.kind {
            MediaKind::Video => ("a:videoFile", VIDEO_REL),
            MediaKind::Audio => ("a:audioFile", AUDIO_REL),
        };
        let link = self.rels.add(link_rel, format!("../{file}")).id.clone();
        let poster = match clip.poster {
            Some(id) => self.media.name_of(self.p, id)?,
            None => self.media.placeholder_poster(),
        };
        let poster_rid = self.rels.add(rel::IMAGE, format!("../{poster}")).id.clone();
        self.x.start("p:pic", &[]);
        self.x.start("p:nvPicPr", &[]);
        self.c_nv_pr(s);
        self.clips.push((self.next_shape_id - 1, clip.clone()));
        let x = &mut self.x;
        x.start("p:cNvPicPr", &[]);
        x.empty("a:picLocks", &[("noChangeAspect", "1")]);
        x.end("p:cNvPicPr");
        x.start("p:nvPr", &[]);
        x.empty(file_el, &[("r:link", &link)]);
        x.start("p:extLst", &[]);
        x.start("p:ext", &[("uri", MEDIA_EXT_URI)]);
        x.empty(
            "p14:media",
            &[("xmlns:p14", crate::parts::NS_P14), ("r:embed", &embed)],
        );
        x.end("p:ext");
        x.end("p:extLst");
        x.end("p:nvPr");
        x.end("p:nvPicPr");
        x.start("p:blipFill", &[]);
        x.empty("a:blip", &[("r:embed", &poster_rid)]);
        x.start("a:stretch", &[]);
        x.empty("a:fillRect", &[]);
        x.end("a:stretch");
        x.end("p:blipFill");
        x.start("p:spPr", &[]);
        write_xfrm(x, &s.transform, false);
        self.geometry("rect");
        write_line(&mut self.x, &s.line);
        self.x.end("p:spPr");
        self.x.end("p:pic");
        Ok(())
    }

    fn picture(&mut self, s: &Shape, media: MediaId, props: &PictureProps) -> Result<()> {
        let rid = match self.media_rels.get(&media) {
            Some(r) => r.clone(),
            None => {
                let name = self.media.name_of(self.p, media)?;
                let rid = self.rels.add(rel::IMAGE, format!("../{name}")).id.clone();
                self.media_rels.insert(media, rid.clone());
                rid
            }
        };
        let x = &mut self.x;
        x.start("p:pic", &[]);
        x.start("p:nvPicPr", &[]);
        self.c_nv_pr(s);
        let x = &mut self.x;
        x.start("p:cNvPicPr", &[]);
        x.empty("a:picLocks", &[("noChangeAspect", "1")]);
        x.end("p:cNvPicPr");
        self.nv_pr(s);
        let x = &mut self.x;
        x.end("p:nvPicPr");
        x.start("p:blipFill", &[]);
        write_blip(x, &rid, props);
        let c = &props.crop;
        if !c.is_none() {
            let v = |f: f64| ((f * 100_000.0).round() as i64).to_string();
            let vals = [("l", c.left), ("t", c.top), ("r", c.right), ("b", c.bottom)]
                .map(|(k, f)| (k, v(f)));
            let attrs: Vec<(&str, &str)> = vals
                .iter()
                .filter(|(_, v)| v != "0")
                .map(|(k, v)| (*k, v.as_str()))
                .collect();
            x.empty("a:srcRect", &attrs);
        }
        x.start("a:stretch", &[]);
        x.empty("a:fillRect", &[]);
        x.end("a:stretch");
        x.end("p:blipFill");
        x.start("p:spPr", &[]);
        write_xfrm(x, &s.transform, false);
        match &props.geometry {
            Some(g) => write_geometry(x, g, &Adjust::new()),
            None => self.geometry("rect"),
        }
        write_line(&mut self.x, &s.line);
        if let Some(sh) = &props.shadow {
            let x = &mut self.x;
            x.start("a:effectLst", &[]);
            let dir = deg_to_rot(sh.direction_deg).to_string();
            x.start(
                "a:outerShdw",
                &[
                    ("blurRad", &sh.blur.0.max(0).to_string()),
                    ("dist", &sh.distance.0.max(0).to_string()),
                    ("dir", &dir),
                    ("algn", "tl"),
                    ("rotWithShape", "0"),
                ],
            );
            write_color_with_alpha(x, &sh.color, sh.alpha);
            x.end("a:outerShdw");
            x.end("a:effectLst");
        }
        self.x.end("p:spPr");
        self.x.end("p:pic");
        Ok(())
    }
}

/// `a:blip` with the picture's effects: transparency (`a:alphaModFix`),
/// recolouring (`a:grayscl`, `a:biLevel`, `a:duotone`), brightness and
/// contrast (`a:lum`).
fn write_blip(x: &mut XmlOut, rid: &str, props: &PictureProps) {
    let pct = |f: f64| ((f * 100_000.0).round() as i64).to_string();
    let has_effects = props.transparency != 0.0
        || props.recolor != Recolor::None
        || props.brightness != 0.0
        || props.contrast != 0.0;
    if !has_effects {
        x.empty("a:blip", &[("r:embed", rid)]);
        return;
    }
    x.start("a:blip", &[("r:embed", rid)]);
    if props.transparency != 0.0 {
        x.empty(
            "a:alphaModFix",
            &[("amt", &pct(1.0 - props.transparency.clamp(0.0, 1.0)))],
        );
    }
    let duotone = |x: &mut XmlOut, dark: core_model::Rgb, light: core_model::Rgb| {
        x.start("a:duotone", &[]);
        x.empty("a:srgbClr", &[("val", &dark.to_hex())]);
        x.empty("a:srgbClr", &[("val", &light.to_hex())]);
        x.end("a:duotone");
    };
    match props.recolor {
        Recolor::None => {}
        Recolor::Grayscale => x.empty("a:grayscl", &[]),
        Recolor::Sepia => duotone(x, core_model::Rgb::BLACK, Recolor::SEPIA_LIGHT),
        Recolor::BlackWhite { threshold } => {
            x.empty("a:biLevel", &[("thresh", &pct(threshold.clamp(0.0, 1.0)))])
        }
        Recolor::Duotone { dark, light } => duotone(x, dark, light),
    }
    if props.brightness != 0.0 || props.contrast != 0.0 {
        let mut attrs = Vec::new();
        let (b, c) = (pct(props.brightness), pct(props.contrast));
        if props.brightness != 0.0 {
            attrs.push(("bright", b.as_str()));
        }
        if props.contrast != 0.0 {
            attrs.push(("contrast", c.as_str()));
        }
        x.empty("a:lum", &attrs);
    }
    x.end("a:blip");
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_show::{Emu, Transform};

    #[test]
    fn missing_media_is_an_error() {
        let mut p = Presentation::empty(model_show::SlideSize::widescreen());
        let s = p.add_slide(LayoutKind::Blank);
        p.add_shape(
            s,
            Shape::picture(MediaId(9), Transform::new(Emu(0), Emu(0), Emu(1), Emu(1))),
        )
        .unwrap();
        assert!(matches!(write(&p), Err(Error::InvalidPresentation(_))));
    }

    #[test]
    fn deterministic_and_complete() {
        let p = Presentation::new();
        let a = write(&p).unwrap();
        assert_eq!(a, write(&p).unwrap());
        let pkg = Package::open(Cursor::new(a)).unwrap();
        let names: Vec<&str> = pkg.parts().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            [
                "/ppt/presentation.xml",
                "/ppt/slideMasters/slideMaster1.xml",
                "/ppt/slideLayouts/slideLayout1.xml",
                "/ppt/slideLayouts/slideLayout2.xml",
                "/ppt/slideLayouts/slideLayout3.xml",
                "/ppt/slideLayouts/slideLayout4.xml",
                "/ppt/slideLayouts/slideLayout5.xml",
                "/ppt/slideLayouts/slideLayout6.xml",
                "/ppt/slideLayouts/slideLayout7.xml",
                "/ppt/slideLayouts/slideLayout8.xml",
                "/ppt/slideLayouts/slideLayout9.xml",
                "/ppt/slideLayouts/slideLayout10.xml",
                "/ppt/slideLayouts/slideLayout11.xml",
                "/ppt/slides/slide1.xml",
                "/ppt/theme/theme1.xml",
                "/ppt/presProps.xml",
                "/ppt/viewProps.xml",
                "/ppt/tableStyles.xml",
                "/docProps/core.xml",
                "/docProps/app.xml",
            ]
        );
    }

    #[test]
    fn hidden_notes_and_alt_roundtrip() {
        let mut p = Presentation::new();
        let s2 = p.add_slide(LayoutKind::Blank);
        let pic_media = p.media.insert("image/png".to_owned(), vec![1, 2, 3]);
        let mut pic = Shape::picture(pic_media, Transform::new(Emu(0), Emu(0), Emu(9), Emu(9)));
        pic.alt = Some("A <logo> & \"mark\"".into());
        p.add_shape(s2, pic).unwrap();
        {
            let slide = p.slide_mut(s2).unwrap();
            slide.hidden = true;
            slide.notes = Some("First line\n\nThird & last".into());
        }
        let bytes = write(&p).unwrap();
        let pkg = Package::open(Cursor::new(bytes.clone())).unwrap();
        let names: Vec<&str> = pkg.parts().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"/ppt/notesMasters/notesMaster1.xml"));
        assert!(names.contains(&"/ppt/notesSlides/notesSlide2.xml"));
        assert!(!names.contains(&"/ppt/notesSlides/notesSlide1.xml"));
        assert!(names.contains(&"/ppt/theme/theme2.xml"));
        let pres = String::from_utf8(
            pkg.part(&PartName::new("/ppt/presentation.xml").unwrap())
                .unwrap()
                .data
                .clone(),
        )
        .unwrap();
        assert!(pres.contains("<p:notesMasterIdLst><p:notesMasterId r:id="));

        let (back, warnings) = crate::read_with_warnings(&bytes).unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(!back.slides[0].hidden);
        assert_eq!(back.slides[0].notes, None);
        assert!(back.slides[1].hidden);
        assert_eq!(
            back.slides[1].notes.as_deref(),
            Some("First line\n\nThird & last")
        );
        assert_eq!(
            back.slides[1].shapes[0].alt.as_deref(),
            Some("A <logo> & \"mark\"")
        );
        // Without notes, no notes parts are written.
        let plain = write(&Presentation::new()).unwrap();
        let pkg = Package::open(Cursor::new(plain)).unwrap();
        assert!(!pkg.parts().any(|(n, _)| n.as_str().contains("notes")));
    }
}
