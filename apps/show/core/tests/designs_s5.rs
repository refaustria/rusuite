//! P9-S5: Reuse Slides › Keep source formatting brings the source master,
//! theme and layouts as a further design; Design › Browse for Themes
//! (`importDesign`) and Save Current Theme (`saveTheme`).

use std::io::Cursor;

use app_common::Host;
use core_model::media::{base64_decode, base64_encode};
use model_show::{
    builtin_theme, Design, Emu, Layout, LayoutKind, Presentation, Preset, Shape, Transform,
};
use serde_json::{json, Value as Json};
use show_core::{dispatch_with, ShowCommand as C, ShowDocument, ShowHost, ShowPatch};

fn host() -> ShowHost {
    let mut p = Presentation::new();
    p.add_slide(LayoutKind::TitleContent);
    p.layouts
        .push(Layout::new(LayoutKind::Custom("Mine".into())));
    p.add_slide(LayoutKind::Custom("Mine".into()));
    Host::new(ShowDocument::from_presentation(p).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

fn apply(h: &mut ShowHost, cmd: C) -> ShowPatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo");
    patch
}

/// A Harbor deck: its master has a name, a background, a decorative
/// picture and a custom layout.
fn harbor_deck() -> Presentation {
    let mut p = Presentation::new();
    let b = builtin_theme("harbor").unwrap();
    p.theme = b.theme;
    p.master.name = "Harbor".into();
    p.master.background = b.background;
    let img = p.media.insert("image/png", vec![1, 2, 3]);
    let mut pic = Shape::picture(img, Transform::new(Emu(0), Emu(0), Emu(100), Emu(100)));
    p.assign_ids(&mut pic);
    p.master.shapes.push(pic);
    let mut quote = Layout::new(LayoutKind::Custom("Quote".into()));
    quote
        .shapes
        .push(Shape::auto(Preset::Rect, Transform::default()));
    p.layouts.push(quote);
    p.add_slide(LayoutKind::Custom("Quote".into()));
    p
}

/// The source's main design as `insertSlides` sends it (id 0).
fn main_design(p: &Presentation) -> Design {
    Design {
        id: 0,
        master: p.master.clone(),
        layouts: p.layouts.clone(),
        theme: p.theme.clone(),
    }
}

fn insert(src: &Presentation, keep: bool) -> C {
    C::InsertSlides {
        after: None,
        slides: src.slides.clone(),
        layouts: src.layouts.clone(),
        designs: if keep {
            vec![main_design(src)]
        } else {
            Vec::new()
        },
        media: src.media.clone(),
        keep_source_formatting: keep,
    }
}

#[test]
fn keep_source_formatting_adds_the_source_master_theme_and_layouts_once() {
    let src = harbor_deck();
    let mut h = host();
    let p = apply(&mut h, insert(&src, true));
    assert!(
        p.designs.as_ref().is_some_and(|d| d.len() == 1),
        "the patch carries the designs"
    );
    let pres = h.doc().presentation();
    assert_eq!(pres.designs.len(), 1);
    let d = &pres.designs[0];
    assert_eq!(d.id, 1);
    assert_eq!(d.name(), "Harbor");
    assert_eq!(d.theme.name, src.theme.name);
    assert_eq!(d.layouts.len(), src.layouts.len());
    // the master's picture got a new id and this presentation's media id
    let model_show::ShapeKind::Picture { media, .. } = &d.master.shapes[0].kind else {
        panic!()
    };
    assert_eq!(pres.media.get(*media).unwrap().data, vec![1, 2, 3]);
    assert_ne!(d.master.shapes[0].id, src.master.shapes[0].id);
    // the inserted slides use it, with their own layouts
    let inserted: Vec<_> = pres.slides.iter().take(src.slides.len()).collect();
    assert!(inserted.iter().all(|s| s.design == Some(1)));
    assert_eq!(inserted[1].layout, LayoutKind::Custom("Quote".into()));
    assert_eq!(pres.background_of(inserted[0]), d.master.background);
    // the main design is untouched
    assert_eq!(pres.theme.name, "Office");
    assert!(pres.master.name.is_empty());
    // a second reuse of the same deck shares the design
    h.apply(insert(&src, true)).unwrap();
    let pres = h.doc().presentation();
    assert_eq!(pres.designs.len(), 1);
    assert_eq!(
        pres.slides.iter().filter(|s| s.design == Some(1)).count(),
        2 * src.slides.len()
    );
    // saved: two masters, read back as two designs
    let bytes = h.doc().save_pptx().unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    assert_eq!(back.designs.len(), 1);
    assert_eq!(back.designs[0].master.name, "Harbor");
    assert_eq!(
        back.slides.iter().filter(|s| s.design.is_some()).count(),
        2 * src.slides.len()
    );
}

#[test]
fn reusing_slides_of_the_own_design_adds_no_design() {
    let mut h = host();
    let mut src = h.doc().presentation().clone();
    src.slides.truncate(1);
    apply(&mut h, insert(&src, true));
    assert!(h.doc().presentation().designs.is_empty());
    assert_eq!(h.doc().presentation().slides[0].design, None);
}

#[test]
fn use_destination_theme_maps_layouts_by_kind_and_name() {
    let mut src = harbor_deck();
    // a custom layout the destination has by name, and one it lacks
    src.layouts
        .push(Layout::new(LayoutKind::Custom("Mine".into())));
    src.add_slide(LayoutKind::Custom("Mine".into()));
    src.add_slide(LayoutKind::SectionHeader);
    let mut h = host();
    apply(&mut h, insert(&src, false));
    let pres = h.doc().presentation();
    assert!(pres.designs.is_empty());
    let kinds: Vec<_> = pres
        .slides
        .iter()
        .take(src.slides.len())
        .map(|s| s.layout.clone())
        .collect();
    assert_eq!(kinds[0], LayoutKind::Title);
    // "Quote" is unknown here: inferred from its placeholders (none: Blank)
    assert_eq!(kinds[1], LayoutKind::Blank);
    assert_eq!(kinds[2], LayoutKind::Custom("Mine".into()));
    assert_eq!(kinds[3], LayoutKind::SectionHeader);
}

#[test]
fn browse_for_themes_replaces_the_design_and_remaps_the_slides() {
    let mut h = host();
    // a theme file: the Harbor deck's design as .thmx
    let thmx = fmt_pptx::write_thmx(&harbor_deck()).unwrap();
    let before = h.doc().presentation().clone();
    let p = apply(
        &mut h,
        C::ImportDesign {
            bytes_base64: base64_encode(&thmx),
        },
    );
    assert!(p.theme.is_some() && p.master.is_some() && p.layouts.is_some());
    let pres = h.doc().presentation();
    assert_eq!(pres.theme.name, builtin_theme("harbor").unwrap().theme.name);
    assert_eq!(pres.master.name, "Harbor");
    assert!(pres
        .layouts
        .iter()
        .any(|l| l.kind == LayoutKind::Custom("Quote".into())));
    // the master picture is in the media now
    let model_show::ShapeKind::Picture { media, .. } = &pres.master.shapes[0].kind else {
        panic!()
    };
    assert_eq!(pres.media.get(*media).unwrap().data, vec![1, 2, 3]);
    // slides keep their standard layouts; the custom one the theme lacks is inferred
    assert_eq!(pres.slides.len(), before.slides.len());
    assert_eq!(pres.slides[0].layout, before.slides[0].layout);
    assert_eq!(pres.slides[1].layout, LayoutKind::TitleContent);
    assert_ne!(pres.slides[2].layout, LayoutKind::Custom("Mine".into()));
    assert!(pres.designs.is_empty());
    pres.validate().unwrap();
    // a broken file changes nothing
    let json = json_of(&h);
    assert_eq!(
        h.apply(C::ImportDesign {
            bytes_base64: base64_encode(b"no zip")
        })
        .unwrap_err()
        .code(),
        "invalid_file"
    );
    assert_eq!(json_of(&h), json);
}

#[test]
fn save_current_theme_writes_a_thmx_named_after_the_theme() {
    let mut h = host();
    h.apply(C::ImportDesign {
        bytes_base64: base64_encode(&fmt_pptx::write_thmx(&harbor_deck()).unwrap()),
    })
    .unwrap();
    let reply: Json = serde_json::from_str(&dispatch_with(
        &mut h,
        &json!({"type": "saveTheme"}).to_string(),
    ))
    .unwrap();
    let saved = &reply["ok"];
    let name = saved["suggestedName"].as_str().unwrap();
    assert!(name.ends_with(".thmx"), "{reply}");
    assert!(name.starts_with(&builtin_theme("harbor").unwrap().theme.name));
    let bytes = base64_decode(saved["bytesBase64"].as_str().unwrap()).unwrap();
    let pkg = fmt_ooxml::Package::open(Cursor::new(&bytes)).unwrap();
    assert_eq!(
        pkg.main_document_part().unwrap().as_str(),
        "/theme/theme/theme1.xml"
    );
    let d = fmt_pptx::read_design_file(&bytes, model_show::SlideSize::widescreen())
        .unwrap()
        .presentation;
    assert_eq!(d.master.name, "Harbor");
}
