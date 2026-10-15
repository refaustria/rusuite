//! [`Presentation`] → `.pptx`. Every part is regenerated (only the theme
//! may come verbatim from [`PptxContext`]); masters and layouts are the
//! fixed built-ins; the output is deterministic.

use std::collections::HashMap;
use std::io::Cursor;

use fmt_ooxml::theme::{parse_theme, theme_xml};
use fmt_ooxml::{ct, rel, Package, PartName, Relationships};
use model_show::{
    Adjust, Connector, Fill, LayoutKind, MediaId, NodeId, PlaceholderKind, Presentation, Preset,
    Shape, ShapeKind, Slide, Table,
};

use crate::anim::{write_timing, write_transition, Target};
use crate::drawing::{write_fill, write_line, write_line_with_ends, write_text_body, write_xfrm};
use crate::geom::{write_av_lst, write_geometry};
use crate::parts::{self, layout_meta, sp_tree_start, write_nv_pr_ph, ROOT_NS};
use crate::table::{write_table, TABLE_URI};
use crate::xml::XmlOut;
use crate::{Error, PptxContext, Result};

/// Writes `presentation` as `.pptx` bytes with a theme part generated from
/// [`Presentation::theme`].
pub fn write(presentation: &Presentation) -> Result<Vec<u8>> {
    write_with_context(presentation, &PptxContext::default())
}

/// Writes `presentation` as `.pptx` bytes, reusing the theme part from
/// `ctx` (as returned by [`read_with_context`](crate::read_with_context))
/// if it still matches the presentation's theme.
///
/// Fails with [`Error::InvalidPresentation`] if a picture references media
/// that is not in the presentation's store.
pub fn write_with_context(p: &Presentation, ctx: &PptxContext) -> Result<Vec<u8>> {
    let pn = PartName::new;
    let mut media = MediaParts::default();
    let mut slides = Vec::with_capacity(p.slides.len());
    for (i, slide) in p.slides.iter().enumerate() {
        slides.push(write_slide(p, slide, i + 1, &mut media)?);
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
    pkg.insert_part(master.clone(), ct::SLIDE_MASTER, parts::slide_master_xml(p));
    let mut master_rels = Relationships::new();
    for kind in LayoutKind::ALL {
        let (_, _, n) = layout_meta(kind);
        master_rels.add(
            rel::SLIDE_LAYOUT,
            format!("../slideLayouts/slideLayout{n}.xml"),
        );
    }
    master_rels.add(rel::THEME, "../theme/theme1.xml");
    pkg.set_relationships(master, master_rels);

    for layout in &p.layouts {
        let (_, _, n) = layout_meta(layout.kind);
        let name = PartName::new(format!("/ppt/slideLayouts/slideLayout{n}.xml"))?;
        pkg.insert_part(
            name.clone(),
            ct::SLIDE_LAYOUT,
            parts::slide_layout_xml(layout),
        );
        let mut r = Relationships::new();
        r.add(rel::SLIDE_MASTER, "../slideMasters/slideMaster1.xml");
        pkg.set_relationships(name, r);
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
        Some(xml) if parse_theme(xml, "theme").ok().as_ref() == Some(&p.theme) => xml.clone(),
        _ => theme_xml(&p.theme),
    };
    if has_notes {
        pkg.insert_part(pn("/ppt/theme/theme2.xml")?, ct::THEME, theme_xml(&p.theme));
    }
    pkg.insert_part(pn("/ppt/theme/theme1.xml")?, ct::THEME, theme);
    pkg.insert_part(
        pn("/ppt/presProps.xml")?,
        ct::PRES_PROPS,
        parts::pres_props_xml(),
    );
    pkg.insert_part(
        pn("/ppt/viewProps.xml")?,
        ct::VIEW_PROPS,
        parts::view_props_xml(),
    );
    pkg.insert_part(
        pn("/ppt/tableStyles.xml")?,
        ct::TABLE_STYLES,
        parts::table_styles_xml(),
    );
    for (name, content_type, data) in media.parts {
        pkg.insert_part(PartName::new(format!("/ppt/{name}"))?, content_type, data);
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

/// Media parts of the package, numbered in first-reference order.
#[derive(Default)]
struct MediaParts {
    /// Media id → `media/imageN.ext`.
    names: HashMap<MediaId, String>,
    /// (`media/imageN.ext`, content type, bytes).
    parts: Vec<(String, String, Vec<u8>)>,
}

impl MediaParts {
    fn name_of(&mut self, p: &Presentation, id: MediaId) -> Result<String> {
        if let Some(n) = self.names.get(&id) {
            return Ok(n.clone());
        }
        let m = p.media.get(id).ok_or_else(|| {
            Error::InvalidPresentation(format!("picture references missing media {}", id.0))
        })?;
        let name = format!(
            "media/image{}.{}",
            self.parts.len() + 1,
            extension_of(&m.content_type)
        );
        self.parts
            .push((name.clone(), m.content_type.clone(), m.data.clone()));
        self.names.insert(id, name.clone());
        Ok(name)
    }
}

struct SlideWriter<'a> {
    x: XmlOut,
    p: &'a Presentation,
    rels: Relationships,
    media: &'a mut MediaParts,
    /// Media id → relationship id within this slide.
    media_rels: HashMap<MediaId, String>,
    next_shape_id: u32,
    /// Node id → how the shape was written (animation targets).
    targets: HashMap<NodeId, Target>,
    /// Next `idx` for subtitle/body placeholders (unique per slide).
    next_ph_idx: u32,
    /// Node id → the `p:cNvPr id` it is written with (connector targets).
    spids: HashMap<NodeId, u32>,
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

/// One slide part and its relationships.
///
/// `number` is the slide's 1-based part number (also of its notes part).
fn write_slide(
    p: &Presentation,
    slide: &Slide,
    number: usize,
    media: &mut MediaParts,
) -> Result<(Vec<u8>, Relationships)> {
    let mut rels = Relationships::new();
    let (_, _, n) = layout_meta(slide.layout);
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
    let mut w = SlideWriter {
        x: XmlOut::new(),
        p,
        rels,
        media,
        media_rels: HashMap::new(),
        next_shape_id: 2,
        targets: HashMap::new(),
        next_ph_idx: 1,
        spids: shape_ids(&slide.shapes),
    };
    let mut root: Vec<(&str, &str)> = ROOT_NS.to_vec();
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
    if !slide.animations.is_empty() {
        write_timing(&mut w.x, &slide.animations, &w.targets).map_err(|id| {
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
        self.x.empty("p:cNvPr", &attrs);
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
            ShapeKind::Picture { media } => self.picture(s, *media)?,
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

    fn auto_shape(&mut self, s: &Shape, geometry: &Preset, adjust: &Adjust) {
        let ph_idx = match s.placeholder {
            Some(PlaceholderKind::Subtitle | PlaceholderKind::Body) => {
                let i = self.next_ph_idx;
                self.next_ph_idx += 1;
                Some(i)
            }
            _ => None,
        };
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
        match s.placeholder {
            Some(kind) => write_nv_pr_ph(x, kind, ph_idx),
            None => x.empty("p:nvPr", &[]),
        }
        x.end("p:nvSpPr");
        x.start("p:spPr", &[]);
        write_xfrm(x, &s.transform, false);
        write_geometry(x, geometry, adjust);
        write_fill(&mut self.x, &s.fill);
        write_line(&mut self.x, &s.line);
        self.x.end("p:spPr");
        if let Some(body) = s.text() {
            write_text_body(&mut self.x, "p:txBody", body);
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
        let x = &mut self.x;
        x.start("p:graphicFrame", &[]);
        x.start("p:nvGraphicFramePr", &[]);
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
        x.start("a:graphic", &[]);
        x.start("a:graphicData", &[("uri", TABLE_URI)]);
        write_table(x, t);
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

    fn picture(&mut self, s: &Shape, media: MediaId) -> Result<()> {
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
        x.empty("p:nvPr", &[]);
        x.end("p:nvPicPr");
        x.start("p:blipFill", &[]);
        x.empty("a:blip", &[("r:embed", &rid)]);
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
