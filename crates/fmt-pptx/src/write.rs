//! [`Presentation`] → `.pptx`. Every part is regenerated (only the theme
//! may come verbatim from [`PptxContext`]); masters and layouts are the
//! fixed built-ins; the output is deterministic.

use std::collections::HashMap;
use std::io::Cursor;

use fmt_ooxml::{Package, PartName, Relationships, OFFICE_DOCUMENT_REL};
use model_show::{
    Fill, LayoutKind, MediaId, PlaceholderKind, Presentation, Preset, Shape, ShapeKind, Slide,
};

use crate::drawing::{write_fill, write_line, write_text_body, write_xfrm};
use crate::parts::{self, layout_meta, sp_tree_start, write_nv_pr_ph, ROOT_NS};
use crate::theme::{parse_theme, theme_xml};
use crate::xml::XmlOut;
use crate::{Error, PptxContext, Result};

const CT_PRESENTATION: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const CT_SLIDE: &str = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const CT_LAYOUT: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const CT_MASTER: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";
const CT_PRES_PROPS: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml";
const CT_VIEW_PROPS: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml";
const CT_TABLE_STYLES: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml";
const CT_NOTES_SLIDE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const CT_NOTES_MASTER: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml";
const CT_THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";
const CT_CORE: &str = "application/vnd.openxmlformats-package.core-properties+xml";
const CT_APP: &str = "application/vnd.openxmlformats-officedocument.extended-properties+xml";

const REL_BASE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_CORE: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";

fn rel(kind: &str) -> String {
    format!("{REL_BASE}/{kind}")
}

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
    pres_rels.add(rel("slideMaster"), "slideMasters/slideMaster1.xml");
    for i in 0..p.slides.len() {
        pres_rels.add(rel("slide"), format!("slides/slide{}.xml", i + 1));
    }
    pres_rels.add(rel("presProps"), "presProps.xml");
    pres_rels.add(rel("viewProps"), "viewProps.xml");
    pres_rels.add(rel("theme"), "theme/theme1.xml");
    pres_rels.add(rel("tableStyles"), "tableStyles.xml");
    let notes_master_rid = has_notes.then(|| {
        pres_rels
            .add(rel("notesMaster"), "notesMasters/notesMaster1.xml")
            .id
            .clone()
    });
    pkg.insert_part(
        main.clone(),
        CT_PRESENTATION,
        parts::presentation_xml(p, notes_master_rid.as_deref()),
    );
    pkg.set_relationships(main, pres_rels);

    let master = pn("/ppt/slideMasters/slideMaster1.xml")?;
    pkg.insert_part(master.clone(), CT_MASTER, parts::slide_master_xml(p));
    let mut master_rels = Relationships::new();
    for kind in LayoutKind::ALL {
        let (_, _, n) = layout_meta(kind);
        master_rels.add(
            rel("slideLayout"),
            format!("../slideLayouts/slideLayout{n}.xml"),
        );
    }
    master_rels.add(rel("theme"), "../theme/theme1.xml");
    pkg.set_relationships(master, master_rels);

    for layout in &p.layouts {
        let (_, _, n) = layout_meta(layout.kind);
        let name = PartName::new(format!("/ppt/slideLayouts/slideLayout{n}.xml"))?;
        pkg.insert_part(name.clone(), CT_LAYOUT, parts::slide_layout_xml(layout));
        let mut r = Relationships::new();
        r.add(rel("slideMaster"), "../slideMasters/slideMaster1.xml");
        pkg.set_relationships(name, r);
    }

    for (i, (xml, rels)) in slides.into_iter().enumerate() {
        let name = PartName::new(format!("/ppt/slides/slide{}.xml", i + 1))?;
        pkg.insert_part(name.clone(), CT_SLIDE, xml);
        pkg.set_relationships(name, rels);
    }

    if has_notes {
        let master = pn("/ppt/notesMasters/notesMaster1.xml")?;
        pkg.insert_part(master.clone(), CT_NOTES_MASTER, parts::notes_master_xml());
        let mut r = Relationships::new();
        r.add(rel("theme"), "../theme/theme2.xml");
        pkg.set_relationships(master, r);
        for (i, slide) in p.slides.iter().enumerate() {
            let Some(notes) = &slide.notes else { continue };
            let name = PartName::new(format!("/ppt/notesSlides/notesSlide{}.xml", i + 1))?;
            pkg.insert_part(name.clone(), CT_NOTES_SLIDE, parts::notes_slide_xml(notes));
            let mut r = Relationships::new();
            r.add(rel("notesMaster"), "../notesMasters/notesMaster1.xml");
            r.add(rel("slide"), format!("../slides/slide{}.xml", i + 1));
            pkg.set_relationships(name, r);
        }
    }

    let theme = match &ctx.theme_xml {
        Some(xml) if parse_theme(xml, "theme").ok().as_ref() == Some(&p.theme) => xml.clone(),
        _ => theme_xml(&p.theme),
    };
    if has_notes {
        pkg.insert_part(pn("/ppt/theme/theme2.xml")?, CT_THEME, theme_xml(&p.theme));
    }
    pkg.insert_part(pn("/ppt/theme/theme1.xml")?, CT_THEME, theme);
    pkg.insert_part(
        pn("/ppt/presProps.xml")?,
        CT_PRES_PROPS,
        parts::pres_props_xml(),
    );
    pkg.insert_part(
        pn("/ppt/viewProps.xml")?,
        CT_VIEW_PROPS,
        parts::view_props_xml(),
    );
    pkg.insert_part(
        pn("/ppt/tableStyles.xml")?,
        CT_TABLE_STYLES,
        parts::table_styles_xml(),
    );
    for (name, content_type, data) in media.parts {
        pkg.insert_part(PartName::new(format!("/ppt/{name}"))?, content_type, data);
    }
    pkg.insert_part(pn("/docProps/core.xml")?, CT_CORE, parts::core_xml());
    pkg.insert_part(
        pn("/docProps/app.xml")?,
        CT_APP,
        parts::app_xml(p.slides.len()),
    );
    let root = pkg.package_relationships_mut();
    root.add(OFFICE_DOCUMENT_REL, "ppt/presentation.xml");
    root.add(REL_CORE, "docProps/core.xml");
    root.add(rel("extended-properties"), "docProps/app.xml");
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
    /// Next `idx` for subtitle/body placeholders (unique per slide).
    next_ph_idx: u32,
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
        rel("slideLayout"),
        format!("../slideLayouts/slideLayout{n}.xml"),
    );
    if slide.notes.is_some() {
        rels.add(
            rel("notesSlide"),
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
        next_ph_idx: 1,
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
    w.x.end("p:sld");
    Ok((w.x.finish(), w.rels))
}

impl SlideWriter<'_> {
    /// `(id, name)` for the next `p:cNvPr`; empty names get PowerPoint-style
    /// defaults (`"Rectangle 3"`).
    /// `p:cNvPr` attributes: id, name and (if set) the alt text.
    fn c_nv_pr(&mut self, s: &Shape) {
        let (id, name) = self.ids(s);
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
            ShapeKind::Auto { geometry, text } => {
                let textless = !matches!(text, Some(t) if !t.is_empty());
                if *geometry == Preset::Line && textless && s.placeholder.is_none() {
                    self.connector(s);
                } else {
                    self.auto_shape(s, *geometry);
                }
            }
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

    fn auto_shape(&mut self, s: &Shape, geometry: Preset) {
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
        self.geometry(match geometry {
            Preset::Rect => "rect",
            Preset::RoundRect => "roundRect",
            Preset::Ellipse => "ellipse",
            Preset::Line => "line",
        });
        write_fill(&mut self.x, &s.fill);
        write_line(&mut self.x, &s.line);
        self.x.end("p:spPr");
        if let Some(body) = s.text() {
            write_text_body(&mut self.x, "p:txBody", body);
        }
        self.x.end("p:sp");
    }

    fn connector(&mut self, s: &Shape) {
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
                let rid = self.rels.add(rel("image"), format!("../{name}")).id.clone();
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
