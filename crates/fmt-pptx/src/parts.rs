//! The fixed parts of a written package: slide master, the three slide
//! layouts, `presProps`, `viewProps`, `tableStyles` and `docProps`.
//!
//! Element order follows PowerPoint-generated files (PresentationML is
//! validated strictly by PowerPoint). Placeholder positions and text
//! defaults come from [`Presentation::layouts`].

use core_model::RunProperties;
use model_show::{
    Layout, LayoutKind, PlaceholderDef, PlaceholderKind, Presentation, TextParagraphProps,
};

use crate::drawing::{ppr_attrs, write_body_pr, write_ppr_children, write_rpr, write_xfrm};
use crate::xml::XmlOut;

pub const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";

/// `xmlns` attributes of a PresentationML root element.
pub const ROOT_NS: [(&str, &str); 3] = [("xmlns:a", NS_A), ("xmlns:r", NS_R), ("xmlns:p", NS_P)];

/// `p:ph` attributes (type, idx) of a placeholder kind. `idx` is the
/// placeholder index used on layouts (slides may renumber body-like
/// placeholders to keep indexes unique).
pub fn ph_attrs(kind: PlaceholderKind) -> (Option<&'static str>, Option<u32>) {
    match kind {
        PlaceholderKind::CenteredTitle => (Some("ctrTitle"), None),
        PlaceholderKind::Title => (Some("title"), None),
        PlaceholderKind::Subtitle => (Some("subTitle"), Some(1)),
        PlaceholderKind::Body => (None, Some(1)),
    }
}

/// `p:sldLayout/@type`, `p:cSld/@name` and part number of a layout.
pub fn layout_meta(kind: LayoutKind) -> (&'static str, &'static str, usize) {
    match kind {
        LayoutKind::Title => ("title", "Title Slide", 1),
        LayoutKind::TitleContent => ("obj", "Title and Content", 2),
        LayoutKind::Blank => ("blank", "Blank", 3),
    }
}

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

/// Writes `p:nvPr` with a `p:ph` of `kind` (index `idx` overrides the
/// default index).
pub fn write_nv_pr_ph(x: &mut XmlOut, kind: PlaceholderKind, idx: Option<u32>) {
    let (ty, default_idx) = ph_attrs(kind);
    let idx = idx.or(default_idx).map(|i| i.to_string());
    let mut attrs: Vec<(&str, &str)> = Vec::new();
    if let Some(t) = ty {
        attrs.push(("type", t));
    }
    if let Some(i) = &idx {
        attrs.push(("idx", i));
    }
    x.start("p:nvPr", &[]);
    x.empty("p:ph", &attrs);
    x.end("p:nvPr");
}

/// A master or layout placeholder `p:sp` with prompt text and, for
/// layouts, a level-1 list style with the placeholder's text defaults.
fn placeholder_sp(
    x: &mut XmlOut,
    id: u32,
    name: &str,
    def: &PlaceholderDef,
    ph: (Option<&str>, Option<u32>),
    with_lst_style: bool,
    prompt: &str,
) {
    let id = id.to_string();
    x.start("p:sp", &[]);
    x.start("p:nvSpPr", &[]);
    x.empty("p:cNvPr", &[("id", &id), ("name", name)]);
    x.start("p:cNvSpPr", &[]);
    x.empty("a:spLocks", &[("noGrp", "1")]);
    x.end("p:cNvSpPr");
    let idx = ph.1.map(|i| i.to_string());
    let mut attrs: Vec<(&str, &str)> = Vec::new();
    if let Some(t) = ph.0 {
        attrs.push(("type", t));
    }
    if let Some(i) = &idx {
        attrs.push(("idx", i));
    }
    x.start("p:nvPr", &[]);
    x.empty("p:ph", &attrs);
    x.end("p:nvPr");
    x.end("p:nvSpPr");
    x.start("p:spPr", &[]);
    write_xfrm(x, &def.transform, false);
    x.start("a:prstGeom", &[("prst", "rect")]);
    x.empty("a:avLst", &[]);
    x.end("a:prstGeom");
    x.end("p:spPr");
    x.start("p:txBody", &[]);
    write_body_pr(x, &def.body_defaults);
    if with_lst_style {
        x.start("a:lstStyle", &[]);
        lvl_ppr(x, "a:lvl1pPr", &def.paragraph_defaults, &def.run_defaults);
        x.end("a:lstStyle");
    } else {
        x.empty("a:lstStyle", &[]);
    }
    x.start("a:p", &[]);
    x.start("a:r", &[]);
    x.empty("a:rPr", &[("lang", "en-US")]);
    x.text_el("a:t", &[], prompt);
    x.end("a:r");
    x.empty("a:endParaRPr", &[("lang", "en-US")]);
    x.end("a:p");
    x.end("p:txBody");
    x.end("p:sp");
}

/// A list-style level (`a:lvlNpPr`) holding paragraph defaults and a
/// `a:defRPr` with the run defaults.
fn lvl_ppr(x: &mut XmlOut, name: &str, para: &TextParagraphProps, run: &RunProperties) {
    let attrs = ppr_attrs(para, false);
    let attrs: Vec<(&str, &str)> = attrs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    x.start(name, &attrs);
    write_ppr_children(x, para);
    write_rpr(x, "a:defRPr", run, true);
    x.end(name);
}

/// The placeholder definition `kind` from the presentation's layouts
/// (first layout that has one).
fn def_of(p: &Presentation, kind: PlaceholderKind) -> Option<&PlaceholderDef> {
    p.layouts.iter().find_map(|l| l.placeholder(kind))
}

/// `ppt/slideMasters/slideMaster1.xml`: white background, title and body
/// placeholders (positions of the Title and Content layout), the standard
/// color map, the three layout ids and text styles (title 44 pt major
/// font; body 28/24/20/18 pt minor font with `•` bullets, 0.5" per level;
/// other text 18 pt).
pub fn slide_master_xml(p: &Presentation) -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("p:sldMaster", &ROOT_NS);
    x.start("p:cSld", &[]);
    x.start("p:bg", &[]);
    x.start("p:bgRef", &[("idx", "1001")]);
    x.empty("a:schemeClr", &[("val", "bg1")]);
    x.end("p:bgRef");
    x.end("p:bg");
    sp_tree_start(&mut x);
    let builtin = Layout::builtin(LayoutKind::TitleContent, p.slide_size);
    let title = def_of(p, PlaceholderKind::Title)
        .or_else(|| builtin.placeholder(PlaceholderKind::Title))
        .cloned()
        .expect("built-in title placeholder");
    let body = def_of(p, PlaceholderKind::Body)
        .or_else(|| builtin.placeholder(PlaceholderKind::Body))
        .cloned()
        .expect("built-in body placeholder");
    let plain = |d: &PlaceholderDef| PlaceholderDef {
        paragraph_defaults: TextParagraphProps::default(),
        run_defaults: RunProperties::default(),
        ..d.clone()
    };
    placeholder_sp(
        &mut x,
        2,
        "Title Placeholder 1",
        &plain(&title),
        (Some("title"), None),
        false,
        "Click to edit Master title style",
    );
    placeholder_sp(
        &mut x,
        3,
        "Text Placeholder 2",
        &plain(&body),
        (Some("body"), Some(1)),
        false,
        "Click to edit Master text styles",
    );
    x.end("p:spTree");
    x.end("p:cSld");
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
    x.start("p:sldLayoutIdLst", &[]);
    for (i, _) in LayoutKind::ALL.iter().enumerate() {
        let id = (2_147_483_649u64 + i as u64).to_string();
        let rid = format!("rId{}", i + 1);
        x.empty("p:sldLayoutId", &[("id", &id), ("r:id", &rid)]);
    }
    x.end("p:sldLayoutIdLst");
    x.start("p:txStyles", &[]);
    text_styles(&mut x);
    x.end("p:txStyles");
    x.end("p:sldMaster");
    x.finish()
}

/// `a:defRPr` children shared by the master text styles.
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

const LEVEL_ATTRS: [(&str, &str); 5] = [
    ("defTabSz", "914400"),
    ("rtl", "0"),
    ("eaLnBrk", "1"),
    ("latinLnBrk", "0"),
    ("hangingPunct", "1"),
];

fn text_styles(x: &mut XmlOut) {
    let pct = |x: &mut XmlOut, name: &str, v: &str| {
        x.start(name, &[]);
        x.empty("a:spcPct", &[("val", v)]);
        x.end(name);
    };
    // title
    x.start("p:titleStyle", &[]);
    let mut attrs = vec![("algn", "l")];
    attrs.extend(LEVEL_ATTRS);
    x.start("a:lvl1pPr", &attrs);
    pct(x, "a:lnSpc", "90000");
    pct(x, "a:spcBef", "0");
    x.empty("a:buNone", &[]);
    def_rpr(x, 4400, true);
    x.end("a:lvl1pPr");
    x.end("p:titleStyle");
    // body
    x.start("p:bodyStyle", &[]);
    for lvl in 0..9u32 {
        let name = format!("a:lvl{}pPr", lvl + 1);
        let mar = (228_600 + lvl * 457_200).to_string();
        let mut attrs = vec![("marL", mar.as_str()), ("indent", "-228600"), ("algn", "l")];
        attrs.extend(LEVEL_ATTRS);
        x.start(&name, &attrs);
        pct(x, "a:lnSpc", "90000");
        x.start("a:spcBef", &[]);
        x.empty(
            "a:spcPts",
            &[("val", if lvl == 0 { "1000" } else { "500" })],
        );
        x.end("a:spcBef");
        x.empty("a:buFont", &[("typeface", "Arial")]);
        x.empty("a:buChar", &[("char", "•")]);
        let sz = match lvl {
            0 => 2800,
            1 => 2400,
            2 => 2000,
            _ => 1800,
        };
        def_rpr(x, sz, false);
        x.end(&name);
    }
    x.end("p:bodyStyle");
    // other
    x.start("p:otherStyle", &[]);
    x.start("a:defPPr", &[]);
    x.empty("a:defRPr", &[("lang", "en-US")]);
    x.end("a:defPPr");
    for lvl in 0..9u32 {
        let name = format!("a:lvl{}pPr", lvl + 1);
        let mar = (lvl * 457_200).to_string();
        let mut attrs = vec![("marL", mar.as_str()), ("algn", "l")];
        attrs.extend(LEVEL_ATTRS);
        x.start(&name, &attrs);
        def_rpr(x, 1800, false);
        x.end(&name);
    }
    x.end("p:otherStyle");
}

/// `ppt/slideLayouts/slideLayoutN.xml` for `layout`: its placeholders at
/// their positions, each with the layout's text defaults as list style.
pub fn slide_layout_xml(layout: &Layout) -> Vec<u8> {
    let (ty, name, _) = layout_meta(layout.kind);
    let mut x = XmlOut::new();
    let mut attrs: Vec<(&str, &str)> = ROOT_NS.to_vec();
    attrs.push(("type", ty));
    attrs.push(("preserve", "1"));
    x.start("p:sldLayout", &attrs);
    x.start("p:cSld", &[("name", name)]);
    sp_tree_start(&mut x);
    for (i, def) in layout.placeholders.iter().enumerate() {
        let (base, prompt) = match def.kind {
            PlaceholderKind::CenteredTitle | PlaceholderKind::Title => {
                ("Title", "Click to edit Master title style")
            }
            PlaceholderKind::Subtitle => ("Subtitle", "Click to edit Master subtitle style"),
            PlaceholderKind::Body => ("Content Placeholder", "Click to edit Master text styles"),
        };
        let id = i as u32 + 2;
        placeholder_sp(
            &mut x,
            id,
            &format!("{base} {}", id - 1),
            def,
            ph_attrs(def.kind),
            true,
            prompt,
        );
    }
    x.end("p:spTree");
    x.end("p:cSld");
    x.start("p:clrMapOvr", &[]);
    x.empty("a:masterClrMapping", &[]);
    x.end("p:clrMapOvr");
    x.end("p:sldLayout");
    x.finish()
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
    x.end("p:presentation");
    x.finish()
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

/// `ppt/presProps.xml` (empty).
pub fn pres_props_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.empty("p:presentationPr", &ROOT_NS);
    x.finish()
}

/// `ppt/viewProps.xml`: normal view at 100 %.
pub fn view_props_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.start("p:viewPr", &ROOT_NS);
    x.start("p:normalViewPr", &[]);
    x.empty("p:restoredLeft", &[("sz", "15620")]);
    x.empty("p:restoredTop", &[("sz", "94660")]);
    x.end("p:normalViewPr");
    x.start("p:slideViewPr", &[]);
    x.start("p:cSldViewPr", &[("snapToGrid", "0")]);
    x.start("p:cViewPr", &[("varScale", "1")]);
    x.start("p:scale", &[]);
    x.empty("a:sx", &[("n", "100"), ("d", "100")]);
    x.empty("a:sy", &[("n", "100"), ("d", "100")]);
    x.end("p:scale");
    x.empty("p:origin", &[("x", "0"), ("y", "0")]);
    x.end("p:cViewPr");
    x.empty("p:guideLst", &[]);
    x.end("p:cSldViewPr");
    x.end("p:slideViewPr");
    x.empty("p:gridSpacing", &[("cx", "76200"), ("cy", "76200")]);
    x.end("p:viewPr");
    x.finish()
}

/// `ppt/tableStyles.xml` (no styles, PowerPoint's default style id).
pub fn table_styles_xml() -> Vec<u8> {
    let mut x = XmlOut::new();
    x.empty(
        "a:tblStyleLst",
        &[
            ("xmlns:a", NS_A),
            ("def", "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"),
        ],
    );
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
