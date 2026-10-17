//! Several masters (designs), non-standard colour maps and theme files
//! (P9-S5).

mod common;

use std::io::Cursor;

use core_model::{Color, ThemeColorSlot};
use fmt_ooxml::{Package, PartName};
use model_show::{
    builtin_theme, ColorMap, Design, Emu, Fill, Layout, LayoutKind, Presentation, Preset, Shape,
    SlideMaster, SlideSize, Transform,
};

fn rect(w: Emu, h: Emu) -> Shape {
    Shape::auto(Preset::Rect, Transform::new(Emu(0), Emu(0), w, h))
}

fn part(bytes: &[u8], name: &str) -> Option<String> {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let p = pkg.part(&PartName::new(name).unwrap())?;
    Some(String::from_utf8(p.data.clone()).unwrap())
}

/// The relationship targets of part `name`, space-separated.
fn targets(bytes: &[u8], name: &str) -> String {
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let rels = pkg.relationships(&PartName::new(name).unwrap()).unwrap();
    rels.iter()
        .map(|r| r.target.clone())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Replaces `from` by `to` in part `name` of the package.
fn patch(bytes: &[u8], name: &str, from: &str, to: &str) -> Vec<u8> {
    let mut pkg = Package::open(Cursor::new(bytes)).unwrap();
    let pn = PartName::new(name).unwrap();
    let p = pkg.part(&pn).unwrap();
    let (ct, xml) = (
        p.content_type.clone(),
        String::from_utf8(p.data.clone()).unwrap(),
    );
    assert!(xml.contains(from), "{name} lacks {from}: {xml}");
    pkg.insert_part(pn, ct, xml.replace(from, to).into_bytes());
    pkg.write(Cursor::new(Vec::new())).unwrap().into_inner()
}

/// The Harbor design as a further design `id`.
fn harbor(id: u32, size: SlideSize) -> Design {
    let b = builtin_theme("harbor").unwrap();
    let mut master = SlideMaster::builtin(size);
    master.name = "Harbor".into();
    master.background = b.background;
    master.shapes.push(rect(Emu(400_000), size.height));
    let layouts = LayoutKind::STANDARD
        .iter()
        .map(|k| Layout::from_master(k.clone(), &master, size))
        .collect();
    Design {
        id,
        master,
        layouts,
        theme: b.theme,
    }
}

fn two_design_deck() -> Presentation {
    let mut p = Presentation::new();
    let size = p.slide_size;
    let mut d = harbor(1, size);
    p.assign_ids(&mut d.master.shapes[0]);
    p.designs.push(d);
    let id = p.add_slide(LayoutKind::TitleContent);
    p.slide_mut(id).unwrap().design = Some(1);
    p.validate().unwrap();
    p
}

#[test]
fn a_second_master_with_its_theme_and_layouts_roundtrips() {
    let deck = two_design_deck();
    let bytes = fmt_pptx::write(&deck).unwrap();
    let pres = part(&bytes, "/ppt/presentation.xml").unwrap();
    assert_eq!(pres.matches("<p:sldMasterId ").count(), 2, "{pres}");
    let m2 = part(&bytes, "/ppt/slideMasters/slideMaster2.xml").expect("second master");
    assert!(m2.contains(r#"<p:cSld name="Harbor">"#), "{m2}");
    assert!(m2.contains("<p:sldLayoutId "), "{m2}");
    let rels2 = targets(&bytes, "/ppt/slideMasters/slideMaster2.xml");
    assert!(rels2.contains("../theme/theme2.xml"), "{rels2}");
    assert!(
        rels2.contains("slideLayout12.xml"),
        "the second master's layouts are numbered on: {rels2}"
    );
    let t2 = part(&bytes, "/ppt/theme/theme2.xml").unwrap();
    assert!(t2.contains("Harbor"), "{t2}");
    // the slide of the second design points at one of its layouts
    let s2 = targets(&bytes, "/ppt/slides/slide2.xml");
    let layout = s2.split(' ').find(|t| t.contains("slideLayouts/")).unwrap();
    let n: usize = layout
        .rsplit("slideLayout")
        .next()
        .unwrap()
        .trim_end_matches(".xml")
        .parse()
        .unwrap();
    assert!(n > 11, "{s2}");
    // master and layout ids are unique across masters
    let ids: Vec<String> = [
        pres.clone(),
        part(&bytes, "/ppt/slideMasters/slideMaster1.xml").unwrap(),
        m2,
    ]
    .iter()
    .flat_map(|x| {
        x.split(r#" id=""#)
            .skip(1)
            .map(|s| s.split('"').next().unwrap().to_owned())
            .collect::<Vec<_>>()
    })
    .filter(|v| v.len() == 10)
    .collect();
    let mut sorted = ids.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), ids.len(), "{ids:?}");

    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(back.designs.len(), 1);
    let d = &back.designs[0];
    assert_eq!(d.master.name, "Harbor");
    assert_eq!(d.theme, deck.designs[0].theme);
    assert_eq!(d.master.shapes.len(), 1);
    assert_eq!(d.layouts.len(), 11);
    assert_eq!(back.slides[0].design, None);
    assert_eq!(back.slides[1].design, Some(d.id));
    assert_eq!(back.theme.name, "Office");
    // the slide resolves its placeholders and background from its design
    assert_eq!(back.background_of(&back.slides[1]), d.master.background);
    // written again: the same parts
    assert!(!fmt_pptx::write(&back).unwrap().is_empty());
    common::assert_same("two designs", &deck, &back);
}

fn dark() -> ColorMap {
    ColorMap {
        bg1: ThemeColorSlot::Dark1,
        tx1: ThemeColorSlot::Light1,
        bg2: ThemeColorSlot::Dark2,
        tx2: ThemeColorSlot::Light2,
    }
}

#[test]
fn a_dark_colour_map_is_honoured_when_reading_and_writing() {
    let mut p = Presentation::new();
    p.master.color_map = dark();
    let mut sh = rect(Emu(100_000), Emu(100_000));
    sh.fill = Fill::Solid(Color::theme(ThemeColorSlot::Light1));
    let id = p.slides[0].id;
    p.add_shape(id, sh).unwrap();
    let bytes = fmt_pptx::write(&p).unwrap();
    let master = part(&bytes, "/ppt/slideMasters/slideMaster1.xml").unwrap();
    assert!(
        master.contains(r#"<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2""#),
        "{master}"
    );
    let slide = part(&bytes, "/ppt/slides/slide1.xml").unwrap();
    // Light 1 is "the text colour" under this map
    assert!(
        slide.contains(r#"<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>"#),
        "{slide}"
    );
    let back = fmt_pptx::read(&bytes).unwrap();
    assert_eq!(back.master.color_map, dark());
    assert_eq!(
        back.slides[0].shapes.last().unwrap().fill,
        Fill::Solid(Color::theme(ThemeColorSlot::Light1))
    );
    // the model's Dark 1 title text is the background colour under this map
    assert!(
        master.contains(r#"<a:defRPr sz="4400"><a:solidFill><a:schemeClr val="bg1"/>"#),
        "{master}"
    );
    let text = back.master.text_styles.title[0].run.color;
    assert_eq!(text, Some(Color::theme(ThemeColorSlot::Dark1)));
}

#[test]
fn a_slide_colour_map_override_is_honoured() {
    let mut p = Presentation::new();
    let mut sh = rect(Emu(100_000), Emu(100_000));
    sh.fill = Fill::Solid(Color::theme(ThemeColorSlot::Light1)); // written as bg1
    let id = p.slides[0].id;
    p.add_shape(id, sh).unwrap();
    let bytes = fmt_pptx::write(&p).unwrap();
    let ovr = patch(
        &bytes,
        "/ppt/slides/slide1.xml",
        "<a:masterClrMapping/>",
        r#"<a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>"#,
    );
    let back = fmt_pptx::read(&ovr).unwrap();
    // bg1 on that slide is Dark 1
    assert_eq!(
        back.slides[0].shapes.last().unwrap().fill,
        Fill::Solid(Color::theme(ThemeColorSlot::Dark1))
    );
    // written with the master's (standard) map: the same colour
    let again = fmt_pptx::write(&back).unwrap();
    let slide = part(&again, "/ppt/slides/slide1.xml").unwrap();
    assert!(slide.contains(r#"<a:schemeClr val="tx1"/>"#), "{slide}");
    assert!(slide.contains("<a:masterClrMapping/>"));
}

#[test]
fn save_current_theme_writes_a_thmx_that_reads_back() {
    let mut p = Presentation::new();
    let size = p.slide_size;
    let h = harbor(1, size);
    p.theme = h.theme.clone();
    p.master = h.master.clone();
    p.layouts = h.layouts.clone();
    let bytes = fmt_pptx::write_thmx(&p).unwrap();
    let pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let main = pkg.main_document_part().unwrap();
    assert_eq!(main.as_str(), "/theme/theme/theme1.xml");
    assert!(pkg.part(&main).unwrap().content_type.ends_with("theme+xml"));
    assert!(part(&bytes, "/theme/slideMasters/slideMaster1.xml").is_some());
    assert!(part(&bytes, "/theme/slideLayouts/slideLayout11.xml").is_some());
    assert!(part(&bytes, "/ppt/presentation.xml").is_none());

    let out = fmt_pptx::read_design_file(&bytes, SlideSize::widescreen()).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let d = out.presentation;
    assert!(d.slides.is_empty());
    assert_eq!(d.theme, p.theme);
    assert_eq!(d.master.name, "Harbor");
    assert_eq!(d.master.background, p.master.background);
    assert_eq!(d.master.shapes.len(), 1);
    assert_eq!(d.layouts.len(), 11);
}

#[test]
fn a_potx_or_pptx_is_a_design_file_too() {
    let deck = two_design_deck();
    let bytes = fmt_pptx::write(&deck).unwrap();
    // a template: the same package with the template's main content type
    let mut pkg = Package::open(Cursor::new(&bytes)).unwrap();
    let main = pkg.main_document_part().unwrap();
    let data = pkg.part(&main).unwrap().data.clone();
    pkg.insert_part(
        main,
        "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
        data,
    );
    let potx = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let out = fmt_pptx::read_design_file(&potx, SlideSize::widescreen()).unwrap();
    assert_eq!(out.presentation.master.name, deck.master.name);
    assert_eq!(out.presentation.layouts.len(), deck.layouts.len());
    // a theme without a master: the Office master stays
    let mut bare = Package::new();
    let t = PartName::new("/theme/theme/theme1.xml").unwrap();
    let xml = part(&bytes, "/ppt/theme/theme2.xml").unwrap();
    bare.insert_part(t, fmt_ooxml::ct::THEME, xml.into_bytes());
    bare.package_relationships_mut()
        .add(fmt_ooxml::rel::OFFICE_DOCUMENT, "theme/theme/theme1.xml");
    let bare = bare.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let out = fmt_pptx::read_design_file(&bare, SlideSize::widescreen()).unwrap();
    assert_eq!(out.presentation.theme.name, "Harbor");
    assert_eq!(out.warnings.len(), 1);
}

#[test]
fn libreoffice_footer_size_comes_from_the_master_placeholder_runs() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../testdata/pptx/provisional-30-sections-footers.pptx"
    );
    let bytes = std::fs::read(path).unwrap();
    // older LibreOffice: no size in the placeholders' list styles, only on their runs
    let lo = patch(
        &bytes,
        "/ppt/slideMasters/slideMaster1.xml",
        r#"<a:defRPr b="0" lang="en-US" sz="2400""#,
        r#"<a:defRPr b="0" lang="en-US""#,
    );
    let p = fmt_pptx::read(&lo).unwrap();
    let footer = p
        .master
        .placeholder_for(model_show::PlaceholderKind::Footer)
        .unwrap();
    assert_eq!(
        footer.run_defaults.size,
        Some(core_model::FontSize::from_pt(24.0))
    );
    let number = p
        .master
        .placeholder_for(model_show::PlaceholderKind::SlideNumber)
        .unwrap();
    assert_eq!(
        number.run_defaults.size,
        Some(core_model::FontSize::from_pt(24.0))
    );
}

#[test]
fn picture_shapes_keep_their_adjust_values() {
    let mut p = Presentation::new();
    let img = p.media.insert("image/png", vec![1, 2, 3]);
    let mut pic = Shape::picture(
        img,
        Transform::new(Emu(0), Emu(0), Emu(2_000_000), Emu(1_000_000)),
    );
    if let model_show::ShapeKind::Picture { props, .. } = &mut pic.kind {
        props.geometry = Some(Preset::RoundRect);
        props.adjust.insert("adj".into(), 30_000);
    }
    let id = p.slides[0].id;
    p.add_shape(id, pic).unwrap();
    let bytes = fmt_pptx::write(&p).unwrap();
    let slide = part(&bytes, "/ppt/slides/slide1.xml").unwrap();
    assert!(slide.contains(r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>"#), "{slide}");
    let (back, warnings) = fmt_pptx::read_with_warnings(&bytes).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let model_show::ShapeKind::Picture { props, .. } = &back.slides[0].shapes.last().unwrap().kind
    else {
        panic!("picture")
    };
    assert_eq!(props.geometry, Some(Preset::RoundRect));
    assert_eq!(props.adjust.get("adj"), Some(&30_000));
}

#[test]
fn date_fields_show_the_date_they_were_saved_on() {
    let mut p = Presentation::new();
    p.master.header_footer.date = model_show::HfDate::Auto { format: 2 };
    let ctx = fmt_pptx::PptxContext {
        date_texts: [(2u8, "Saturday, October 17, 2026".to_owned())]
            .into_iter()
            .collect(),
        ..Default::default()
    };
    let bytes = fmt_pptx::write_with_context(&p, &ctx).unwrap();
    let master = part(&bytes, "/ppt/slideMasters/slideMaster1.xml").unwrap();
    assert!(
        master.contains(
            r#"type="datetime2"><a:rPr lang="en-US"/><a:t>Saturday, October 17, 2026</a:t>"#
        ),
        "{master}"
    );
    // without the UI's clock: empty, as before
    let plain = part(
        &fmt_pptx::write(&p).unwrap(),
        "/ppt/slideMasters/slideMaster1.xml",
    )
    .unwrap();
    assert!(
        plain.contains(r#"type="datetime2"><a:rPr lang="en-US"/><a:t></a:t>"#),
        "{plain}"
    );
}

#[test]
fn the_testdata_theme_file_reads_and_is_what_the_generator_writes() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../testdata/pptx/rusuite-harbor.thmx"
    );
    let bytes = std::fs::read(path).unwrap();
    let out = fmt_pptx::read_design_file(&bytes, SlideSize::widescreen()).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let d = out.presentation;
    assert_eq!(d.theme.name, builtin_theme("harbor").unwrap().theme.name);
    assert_eq!(d.master.name, "Harbor");
    assert_eq!(d.master.shapes.len(), 1);
    assert_eq!(d.layouts.len(), 12);
    assert!(d.layout(&LayoutKind::Custom("Quote".into())).is_some());
    // written again it is the same file (regenerate with `--example theme_file`)
    assert_eq!(fmt_pptx::write_thmx(&d).unwrap(), bytes);
}
