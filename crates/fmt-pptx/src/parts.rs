//! The fixed parts of a written package: `presentation.xml` (with the
//! section list), notes master and slides, `presProps`, `viewProps`,
//! `tableStyles` and `docProps`.
//!
//! Element order follows PowerPoint-generated files (PresentationML is
//! validated strictly by PowerPoint).

use model_show::Presentation;

use crate::master::LEVEL_ATTRS;
use crate::read::SECTION_EXT_URI;
use crate::xml::XmlOut;

pub const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";

/// `xmlns` attributes of a PresentationML root element.
pub const ROOT_NS: [(&str, &str); 3] = [("xmlns:a", NS_A), ("xmlns:r", NS_R), ("xmlns:p", NS_P)];

/// Writes `p:nvGrpSpPr` + `p:grpSpPr` of a shape tree root.
pub fn sp_tree_start(x: &mut XmlOut) {
    x.start("p:spTree", &[]);
    x.start("p:nvGrpSpPr", &[]);
    x.empty("p:cNvPr", &[("id", "1"), ("name", "")]);
    x.empty("p:cNvGrpSpPr", &[]);
    x.empty("p:nvPr", &[]);
    x.end("p:nvGrpSpPr");
    x.start("p:grpSpPr", &[]);
    x.start("a:xfrm", &[]);
    x.empty("a:off", &[("x", "0"), ("y", "0")]);
    x.empty("a:ext", &[("cx", "0"), ("cy", "0")]);
    x.empty("a:chOff", &[("x", "0"), ("y", "0")]);
    x.empty("a:chExt", &[("cx", "0"), ("cy", "0")]);
    x.end("a:xfrm");
    x.end("p:grpSpPr");
}

/// `a:defRPr` of the default text style.
fn def_rpr(x: &mut XmlOut, sz: u32, major: bool) {
    let (lt, ea, cs) = if major {
        ("+mj-lt", "+mj-ea", "+mj-cs")
    } else {
        ("+mn-lt", "+mn-ea", "+mn-cs")
    };
    x.start("a:defRPr", &[("sz", &sz.to_string()), ("kern", "1200")]);
    x.start("a:solidFill", &[]);
    x.empty("a:schemeClr", &[("val", "tx1")]);
    x.end("a:solidFill");
    x.empty("a:latin", &[("typeface", lt)]);
    x.empty("a:ea", &[("typeface", ea)]);
    x.empty("a:cs", &[("typeface", cs)]);
    x.end("a:defRPr");
}

/// `ppt/presentation.xml`: master id, slide ids (`rId2`…), slide size,
/// notes size and a default text style.
///
/// `notes_master_rid`: the relationship id of the notes master, when the
/// package has one.
pub fn presentation_xml(p: &Presentation, notes_master_rid: Option<&str>) -> Vec<u8> {
    let mut x = XmlOut::new();
    let mut attrs: Vec<(&str, &str)> = ROOT_NS.to_vec();
    attrs.push(("saveSubsetFonts", "1"));
    x.start("p:presentation", &attrs);
    x.start("p:sldMasterIdLst", &[]);
    x.empty("p:sldMasterId", &[("id", "2147483648"), ("r:id", "rId1")]);
    x.end("p:sldMasterIdLst");
    if let Some(rid) = notes_master_rid {
        x.start("p:notesMasterIdLst", &[]);
        x.empty("p:notesMasterId", &[("r:id", rid)]);
        x.end("p:notesMasterIdLst");
    }
    if !p.slides.is_empty() {
        x.start("p:sldIdLst", &[]);
        for i in 0..p.slides.len() {
            let id = (256 + i).to_string();
            let rid = format!("rId{}", i + 2);
            x.empty("p:sldId", &[("id", &id), ("r:id", &rid)]);
        }
        x.end("p:sldIdLst");
    }
    // ST_SlideSizeCoordinate: 1" .. 56"
    let clamp = |v: i64| v.clamp(914_400, 51_206_400).to_string();
    x.empty(
        "p:sldSz",
        &[
            ("cx", &clamp(p.slide_size.width.0)),
            ("cy", &clamp(p.slide_size.height.0)),
        ],
    );
    x.empty("p:notesSz", &[("cx", "6858000"), ("cy", "9144000")]);
    write_custom_shows(&mut x, p);
    x.start("p:defaultTextStyle", &[]);
    x.start("a:defPPr", &[]);
    x.empty("a:defRPr", &[("lang", "en-US")]);
    x.end("a:defPPr");
    let mut attrs = vec![("marL", "0"), ("algn", "l")];
    attrs.extend(LEVEL_ATTRS);
    x.start("a:lvl1pPr", &attrs);
    def_rpr(&mut x, 1800, false);
    x.end("a:lvl1pPr");
    x.end("p:defaultTextStyle");
    if !p.sections.is_empty() {
        x.start("p:extLst", &[]);
        x.start("p:ext", &[("uri", SECTION_EXT_URI)]);
        x.start("p14:sectionLst", &[("xmlns:p14", NS_P14)]);
        for (i, section) in p.sections.iter().enumerate() {
            x.start(
                "p14:section",
                &[("name", &section.name), ("id", &section_guid(i))],
            );
            x.start("p14:sldIdLst", &[]);
            for id in &section.slide_ids {
                if let Some(n) = p.slide_index(*id) {
                    x.empty("p14:sldId", &[("id", &(256 + n).to_string())]);
                }
            }
            x.end("p14:sldIdLst");
            x.end("p14:section");
        }
        x.end("p14:sectionLst");
        x.end("p:ext");
        x.end("p:extLst");
    }
    x.end("p:presentation");
    x.finish()
}

/// `p:custShowLst`: each custom show's slides as the presentation's
/// slide relationships (`rId2`… in slide order, as `p:sldIdLst`).
fn write_custom_shows(x: &mut XmlOut, p: &Presentation) {
    if p.custom_shows.is_empty() {
        return;
    }
    x.start("p:custShowLst", &[]);
    for show in &p.custom_shows {
        x.start(
            "p:custShow",
            &[("name", &show.name), ("id", &show.id.to_string())],
        );
        x.start("p:sldLst", &[]);
        for id in &show.slide_ids {
            if let Some(n) = p.slide_index(*id) {
                x.empty("p:sld", &[("r:id", &format!("rId{}", n + 2))]);
            }
        }
        x.end("p:sldLst");
        x.end("p:custShow");
    }
    x.end("p:custShowLst");
}

/// PowerPoint 2010 main namespace (`p14:`).
pub const NS_P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";

/// A stable GUID for section `i` (sections have no id in the model).
fn section_guid(i: usize) -> String {
    format!("{{{:08X}-5EC7-4E1D-8A3B-{:012X}}}", 0x5EC7_1000 + i, i + 1)
}

/// The standard colour map of masters.
fn clr_map(x: &mut XmlOut) {
    x.empty(
        "p:clrMap",
        &[
            ("bg1", "lt1"),
            ("tx1", "dk1"),
            ("bg2", "lt2"),
            ("tx2", "dk2"),
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

/// Notes page boxes (portrait 7.5" × 10"): slide image and notes body.
const NOTES_SLIDE_IMAGE: (&str, &str, &str, &str) = ("685800", "1143000", "5486400", "3086100");
const NOTES_BODY: (&str, &str, &str, &str) = ("685800", "4400550", "5486400", "3600450");

/// A notes placeholder `p:sp`: `ty` is `sldImg` or `body`; `xfrm` is
/// written on the master only (slides inherit it).
fn notes_ph(
    x: &mut XmlOut,
    id: u32,
    ty: &str,
    xfrm: Option<(&str, &str, &str, &str)>,
    text: Option<&str>,
) {
    let (name, idx) = if ty == "body" {
        (format!("Notes Placeholder {}", id - 1), Some("1"))
    } else {
        (format!("Slide Image Placeholder {}", id - 1), None)
    };
    x.start("p:sp", &[]);
    x.start("p:nvSpPr", &[]);
    x.empty("p:cNvPr", &[("id", &id.to_string()), ("name", &name)]);
    x.start("p:cNvSpPr", &[]);
    if ty == "body" {
        x.empty("a:spLocks", &[("noGrp", "1")]);
    } else {
        x.empty(
            "a:spLocks",
            &[("noGrp", "1"), ("noRot", "1"), ("noChangeAspect", "1")],
        );
    }
    x.end("p:cNvSpPr");
    x.start("p:nvPr", &[]);
    match idx {
        Some(i) => x.empty("p:ph", &[("type", ty), ("idx", i)]),
        None => x.empty("p:ph", &[("type", ty)]),
    }
    x.end("p:nvPr");
    x.end("p:nvSpPr");
    match xfrm {
        Some((ox, oy, cx, cy)) => {
            x.start("p:spPr", &[]);
            x.start("a:xfrm", &[]);
            x.empty("a:off", &[("x", ox), ("y", oy)]);
            x.empty("a:ext", &[("cx", cx), ("cy", cy)]);
            x.end("a:xfrm");
            x.start("a:prstGeom", &[("prst", "rect")]);
            x.empty("a:avLst", &[]);
            x.end("a:prstGeom");
            x.end("p:spPr");
        }
        None => x.empty("p:spPr", &[]),
    }
    if ty == "body" {
        x.start("p:txBody", &[]);
        x.empty("a:bodyPr", &[]);
        x.empty("a:lstStyle", &[]);
        for line in text.unwrap_or("").split('\n') {
            x.start("a:p", &[]);
            if !line.is_empty() {
                x.start("a:r", &[]);
                x.empty("a:rPr", &[("lang", "en-US"), ("dirty", "0")]);
                x.text_el("a:t", &[], line);
                x.end("a:r");
            }
            x.end("a:p");
        }
        x.end("p:txBody");
    }
    x.end("p:sp");
}

/// `ppt/notesMasters/notesMaster1.xml`: slide image and notes body
/// placeholders on a portrait notes page.
pub fn notes_master_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("p:notesMaster", &ROOT_NS);
    x.start("p:cSld", &[]);
    sp_tree_start(&mut x);
    notes_ph(&mut x, 2, "sldImg", Some(NOTES_SLIDE_IMAGE), None);
    notes_ph(&mut x, 3, "body", Some(NOTES_BODY), None);
    x.end("p:spTree");
    x.end("p:cSld");
    clr_map(&mut x);
    x.end("p:notesMaster");
    x.finish()
}

/// `ppt/notesSlides/notesSlideN.xml` holding `notes` as plain paragraphs.
pub fn notes_slide_xml(notes: &str) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("p:notes", &ROOT_NS);
    x.start("p:cSld", &[]);
    sp_tree_start(&mut x);
    notes_ph(&mut x, 2, "sldImg", None, None);
    notes_ph(&mut x, 3, "body", None, Some(notes));
    x.end("p:spTree");
    x.end("p:cSld");
    x.start("p:clrMapOvr", &[]);
    x.empty("a:masterClrMapping", &[]);
    x.end("p:clrMapOvr");
    x.end("p:notes");
    x.finish()
}

/// `docProps/core.xml`: empty (no timestamps: core crates have no clock).
pub fn core_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.empty(
        "cp:coreProperties",
        &[
            (
                "xmlns:cp",
                "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
            ),
            ("xmlns:dc", "http://purl.org/dc/elements/1.1/"),
            ("xmlns:dcterms", "http://purl.org/dc/terms/"),
            ("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"),
        ],
    );
    x.finish()
}

/// `docProps/app.xml`: application name and slide count.
pub fn app_xml(slides: usize) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start(
        "Properties",
        &[(
            "xmlns",
            "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
        )],
    );
    x.text_el("Application", &[], "Rusuite");
    x.text_el("Slides", &[], &slides.to_string());
    x.end("Properties");
    x.finish()
}
