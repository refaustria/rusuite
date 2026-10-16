//! P8-19 commands: themes, layouts, master placeholders, backgrounds,
//! reset, header & footer, sections, picture adjustments – each with its
//! undo/redo identity, patches and `.pptx` round trip.

use app_common::Host;
use core_model::{Color, Rgb, RunProperties, ThemeColorSlot};
use model_show::{
    Background, Crop, Emu, Fill, HfDate, LayoutKind, NodeId, PictureProps, PlaceholderKind,
    Presentation, Recolor, Shape, Transform,
};
use serde_json::Value as Json;
use show_core::{
    dispatch_with, BackgroundTarget, DesignTarget, HfTarget, PicturePatch, PlaceholderPatch,
    ShowCommand as C, ShowDocument, ShowHost, ThemeChoice,
};

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

fn pres(h: &ShowHost) -> &Presentation {
    h.doc().presentation()
}

/// Applies `cmd`, checks undo and redo, leaves it applied; returns the
/// patch.
fn apply(h: &mut ShowHost, cmd: C) -> show_core::ShowPatch {
    let before = json_of(h);
    let env = h.apply(cmd.clone()).unwrap();
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    env.patch
}

fn err_code(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before);
    e.code()
}

/// Title slide (1: title 2, subtitle 3), Title and Content (4: 5, 6),
/// Two Content (7: 8, 9, 10), blank with a picture (11: picture 12).
fn host() -> ShowHost {
    let mut p = Presentation::new();
    p.add_slide(LayoutKind::TitleContent);
    p.add_slide(LayoutKind::TwoContent);
    let s = p.add_slide(LayoutKind::Blank);
    let m = p.media.insert("image/png", b"\x89PNG\r\n\x1a\n".to_vec());
    p.add_shape(s, Shape::picture(m, tr(1000, 1000, 8000, 6000)))
        .unwrap();
    Host::new(ShowDocument::from_presentation(p).unwrap())
}

fn ids(h: &ShowHost) -> Vec<NodeId> {
    pres(h).slides.iter().map(|s| s.id).collect()
}

#[test]
fn themes_colors_and_fonts() {
    let mut h = host();
    let patch = apply(
        &mut h,
        C::ApplyTheme {
            theme: ThemeChoice::Builtin("ember".into()),
        },
    );
    assert_eq!(pres(&h).theme.name, "Ember");
    assert!(patch.theme.is_some() && patch.master.is_some() && patch.layouts.is_some());
    assert!(patch.slides.is_empty());
    // placeholders keep their geometry
    assert_eq!(
        pres(&h).layouts,
        Presentation::new().layouts,
        "layouts unchanged"
    );
    assert_eq!(
        pres(&h).master.background,
        model_show::builtin_theme("ember").unwrap().background
    );
    let mut colors = pres(&h).theme.colors.clone();
    colors.set(ThemeColorSlot::Accent1, Rgb::new(1, 2, 3));
    apply(&mut h, C::SetThemeColors { colors });
    assert_eq!(
        pres(&h)
            .theme
            .resolve(&Color::theme(ThemeColorSlot::Accent1)),
        Rgb::new(1, 2, 3)
    );
    let mut fonts = pres(&h).theme.fonts.clone();
    fonts.major_latin = "Georgia".into();
    apply(&mut h, C::SetThemeFonts { fonts });
    let custom = model_show::builtin_theme("lagoon").unwrap().theme;
    apply(
        &mut h,
        C::ApplyTheme {
            theme: ThemeChoice::Custom(Box::new(custom.clone())),
        },
    );
    assert_eq!(pres(&h).theme, custom);
    assert_eq!(
        err_code(
            &mut h,
            C::ApplyTheme {
                theme: ThemeChoice::Builtin("nope".into())
            }
        ),
        "invalid_command"
    );
    // the theme reaches the file
    let bytes = h.doc().save_pptx().unwrap();
    let back = fmt_pptx::read(&bytes).unwrap();
    assert_eq!(back.theme, custom);
}

#[test]
fn layouts_add_duplicate_delete() {
    let mut h = host();
    apply(
        &mut h,
        C::AddLayout {
            name: "Agenda".into(),
        },
    );
    let agenda = LayoutKind::Custom("Agenda".into());
    assert_eq!(pres(&h).layouts.last().unwrap().kind, agenda);
    assert_eq!(
        err_code(
            &mut h,
            C::AddLayout {
                name: "Agenda".into()
            }
        ),
        "invalid_command"
    );
    apply(
        &mut h,
        C::DuplicateLayout {
            layout: LayoutKind::TwoContent,
        },
    );
    let dup = LayoutKind::Custom("1_Two Content".into());
    let i = pres(&h).layouts.iter().position(|l| l.kind == dup).unwrap();
    assert_eq!(pres(&h).layouts[i - 1].kind, LayoutKind::TwoContent);
    assert_eq!(
        pres(&h).layouts[i].placeholders,
        pres(&h)
            .layout(&LayoutKind::TwoContent)
            .unwrap()
            .placeholders
    );
    // slides can use the new layouts
    let first = ids(&h)[0];
    apply(
        &mut h,
        C::AddSlide {
            after: Some(first),
            layout: dup.clone(),
            new_ids: vec![],
        },
    );
    assert_eq!(pres(&h).slides[1].layout, dup);
    assert_eq!(
        err_code(
            &mut h,
            C::DeleteLayout {
                layout: dup.clone()
            }
        ),
        "invalid_command",
        "in use"
    );
    apply(
        &mut h,
        C::DeleteLayout {
            layout: agenda.clone(),
        },
    );
    assert!(pres(&h).layout(&agenda).is_none());
    assert_eq!(
        err_code(
            &mut h,
            C::SetSlideLayout {
                slide: first,
                layout: agenda
            }
        ),
        "invalid_command"
    );
    // custom layouts survive the file
    let back = fmt_pptx::read(&h.doc().save_pptx().unwrap()).unwrap();
    assert!(back.layout(&dup).is_some());
    assert_eq!(back.slides[1].layout, dup);
}

#[test]
fn master_placeholder_changes_flow_to_layouts_and_slides() {
    let mut h = host();
    let s = ids(&h)[1]; // Title and Content
    let title_box = pres(&h).master.placeholders[0].transform;
    let moved = Transform {
        y: Emu(title_box.y.0 + 100_000),
        ..title_box
    };
    let red = RunProperties {
        color: Some(Color::Rgb(Rgb::new(0xC0, 0, 0))),
        bold: Some(true),
        ..RunProperties::default()
    };
    let patch = apply(
        &mut h,
        C::SetMasterPlaceholderProps {
            target: DesignTarget::Master,
            placeholder: PlaceholderKind::Title,
            idx: None,
            patch: PlaceholderPatch {
                transform: Some(moved),
                run: Some(red.clone()),
                ..PlaceholderPatch::default()
            },
        },
    );
    let p = pres(&h);
    // the title style follows; layouts that inherited the box follow, the
    // title slide's own box stays
    assert_eq!(p.master.text_styles.title[0].run.bold, Some(true));
    let tc = p.layout(&LayoutKind::TitleContent).unwrap();
    assert_eq!(tc.placeholders[0].transform, moved);
    assert_eq!(tc.placeholders[0].run_defaults.color, red.color);
    let title_layout = p.layout(&LayoutKind::Title).unwrap();
    assert_ne!(title_layout.placeholders[0].transform, moved);
    assert_eq!(title_layout.placeholders[0].run_defaults.bold, Some(true));
    // and the slides' title placeholders that sat at the layout's box
    assert_eq!(p.slide(s).unwrap().shapes[0].transform, moved);
    assert!(patch.slides.iter().any(|x| x.id == s));
    // a layout change
    let b = p.layout(&LayoutKind::TwoContent).unwrap().placeholders[2].transform;
    let wide = Transform {
        w: Emu(b.w.0 - 1000),
        ..b
    };
    apply(
        &mut h,
        C::SetMasterPlaceholderProps {
            target: DesignTarget::Layout(LayoutKind::TwoContent),
            placeholder: PlaceholderKind::Body,
            idx: Some(2),
            patch: PlaceholderPatch {
                transform: Some(wide),
                ..PlaceholderPatch::default()
            },
        },
    );
    let two = ids(&h)[2];
    let right = pres(&h).slide(two).unwrap().shapes[2].clone();
    assert_eq!((right.placeholder_idx, right.transform), (Some(2), wide));
    assert_eq!(
        err_code(
            &mut h,
            C::SetMasterPlaceholderProps {
                target: DesignTarget::Layout(LayoutKind::Blank),
                placeholder: PlaceholderKind::Title,
                idx: None,
                patch: PlaceholderPatch::default(),
            }
        ),
        "invalid_command"
    );
    // master/layout edits survive the file
    let back = fmt_pptx::read(&h.doc().save_pptx().unwrap()).unwrap();
    assert_eq!(back.master.placeholders[0].transform, moved);
    assert_eq!(
        back.layout(&LayoutKind::TwoContent).unwrap().placeholders[2].transform,
        wide
    );
}

#[test]
fn backgrounds_and_reset() {
    let mut h = host();
    let [s1, s2, ..] = ids(&h)[..] else { panic!() };
    let blue = Background::Fill(Fill::Solid(Color::Rgb(Rgb::new(0, 0, 0xFF))));
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Slides(vec![s1]),
            fill: Some(blue),
            hide_master_shapes: Some(true),
        },
    );
    let slide = pres(&h).slide(s1).unwrap();
    assert!(!slide.show_master_shapes);
    assert!(slide.background.is_some());
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Layout(LayoutKind::TitleContent),
            fill: Some(Background::Style {
                index: 1003,
                color: Color::theme(ThemeColorSlot::Light2),
            }),
            hide_master_shapes: None,
        },
    );
    apply(
        &mut h,
        C::SetBackground {
            target: BackgroundTarget::Master,
            fill: Some(blue),
            hide_master_shapes: None,
        },
    );
    assert_eq!(pres(&h).master.background, blue);
    assert_eq!(
        err_code(
            &mut h,
            C::SetBackground {
                target: BackgroundTarget::Slides(vec![s1]),
                fill: Some(Background::default()),
                hide_master_shapes: None
            }
        ),
        "invalid_command"
    );
    // reset: moved and reformatted placeholders go back
    let body = pres(&h).slide(s2).unwrap().shapes[1].id;
    h.apply(C::SetTransform {
        shapes: vec![(body, tr(1, 2, 3, 4))],
    })
    .unwrap();
    h.apply(C::SetRunProps {
        shape: body,
        paragraph: 0,
        from: 0,
        to: 0,
        patch: RunProperties::default(),
    })
    .unwrap();
    h.apply(C::DeleteShapes {
        ids: vec![pres(&h).slide(s2).unwrap().shapes[0].id],
    })
    .unwrap();
    apply(&mut h, C::ResetSlide { slides: vec![s2] });
    let slide = pres(&h).slide(s2).unwrap();
    let layout = pres(&h).layout(&LayoutKind::TitleContent).unwrap();
    assert_eq!(slide.shapes.len(), 2, "the title is back");
    assert_eq!(slide.shapes[1].transform, layout.placeholders[1].transform);
    assert_ne!(slide.shapes[0].id, NodeId(0));
    // backgrounds survive the file
    let back = fmt_pptx::read(&h.doc().save_pptx().unwrap()).unwrap();
    assert_eq!(back.master.background, blue);
    assert!(!back.slides[0].show_master_shapes);
    assert!(back
        .layout(&LayoutKind::TitleContent)
        .unwrap()
        .background
        .is_some());
}

#[test]
fn header_and_footer() {
    let mut h = host();
    let all = ids(&h);
    let patch = apply(
        &mut h,
        C::SetHeaderFooter {
            date: HfDate::Fixed {
                text: "Q4 2026".into(),
            },
            footer: Some("Confidential".into()),
            slide_number: true,
            apply_to: HfTarget::All,
            not_on_title: true,
        },
    );
    assert!(patch.master.is_some());
    assert_eq!(patch.slides.len(), all.len());
    let p = pres(&h);
    assert!(p.master.header_footer.not_on_title);
    assert_eq!(p.resolved_footer(all[0]).unwrap().footer, None);
    let f = p.resolved_footer(all[2]).unwrap();
    assert_eq!(f.footer.as_deref(), Some("Confidential"));
    assert_eq!(f.slide_number, Some(3));
    // new slides get them too
    apply(
        &mut h,
        C::AddSlide {
            after: Some(all[3]),
            layout: LayoutKind::TitleOnly,
            new_ids: vec![],
        },
    );
    let new = *ids(&h).last().unwrap();
    assert_eq!(
        pres(&h).resolved_footer(new).unwrap().footer.as_deref(),
        Some("Confidential")
    );
    // one slide: number only, automatic date; a moved footer stays put
    let ftr = pres(&h)
        .slide(all[1])
        .unwrap()
        .shapes
        .iter()
        .find(|s| s.placeholder == Some(PlaceholderKind::Footer))
        .unwrap()
        .id;
    h.apply(C::SetTransform {
        shapes: vec![(ftr, tr(10, 10, 100, 100))],
    })
    .unwrap();
    apply(
        &mut h,
        C::SetHeaderFooter {
            date: HfDate::Auto { format: 2 },
            footer: Some("Moved".into()),
            slide_number: false,
            apply_to: HfTarget::Slides(vec![all[1]]),
            not_on_title: false,
        },
    );
    let p = pres(&h);
    let f = p.resolved_footer(all[1]).unwrap();
    assert_eq!(f.date, Some(model_show::FooterDate::Auto { format: 2 }));
    assert_eq!(f.slide_number, None);
    let moved = p
        .slide(all[1])
        .unwrap()
        .shapes
        .iter()
        .find(|s| s.placeholder == Some(PlaceholderKind::Footer))
        .unwrap();
    assert_eq!(moved.transform, tr(10, 10, 100, 100));
    assert_eq!(
        p.master.header_footer.footer.as_deref(),
        Some("Confidential")
    );
    // and the file
    let back = fmt_pptx::read(&h.doc().save_pptx().unwrap()).unwrap();
    assert_eq!(back.master.header_footer, p.master.header_footer);
    assert_eq!(
        back.resolved_footer(back.slides[1].id).unwrap(),
        p.resolved_footer(all[1]).unwrap()
    );
}

#[test]
fn sections_follow_slides() {
    let mut h = host();
    let all = ids(&h);
    let patch = apply(
        &mut h,
        C::AddSection {
            name: "Body".into(),
            first_slide: Some(all[1]),
        },
    );
    assert_eq!(patch.sections.as_ref().unwrap().len(), 2);
    apply(
        &mut h,
        C::AddSection {
            name: "End".into(),
            first_slide: Some(all[3]),
        },
    );
    apply(
        &mut h,
        C::RenameSection {
            index: 0,
            name: "Start".into(),
        },
    );
    let names: Vec<_> = pres(&h).sections.iter().map(|s| s.name.clone()).collect();
    assert_eq!(names, ["Start", "Body", "End"]);
    // slide commands keep the sections valid and undo restores them
    let patch = apply(
        &mut h,
        C::MoveSlide {
            id: all[3],
            to_index: 0,
        },
    );
    assert!(patch.sections.is_some());
    assert_eq!(pres(&h).sections[0].slide_ids[0], all[3]);
    pres(&h).validate().unwrap();
    apply(&mut h, C::DeleteSlides { ids: vec![all[1]] });
    pres(&h).validate().unwrap();
    apply(
        &mut h,
        C::DuplicateSlide {
            id: all[2],
            new_ids: vec![],
        },
    );
    apply(
        &mut h,
        C::MoveSection {
            index: 2,
            to_index: 0,
        },
    );
    pres(&h).validate().unwrap();
    apply(
        &mut h,
        C::RemoveSection {
            index: 1,
            keep_slides: true,
        },
    );
    let n = pres(&h).slides.len();
    apply(
        &mut h,
        C::RemoveSection {
            index: 1,
            keep_slides: false,
        },
    );
    assert!(pres(&h).slides.len() < n);
    pres(&h).validate().unwrap();
    assert_eq!(
        err_code(
            &mut h,
            C::RenameSection {
                index: 9,
                name: "x".into()
            }
        ),
        "invalid_command"
    );
    // sections survive the file
    let doc = h.doc();
    let back = fmt_pptx::read(&doc.save_pptx().unwrap()).unwrap();
    let shape = |p: &Presentation| {
        p.sections
            .iter()
            .map(|s| (s.name.clone(), s.slide_ids.len()))
            .collect::<Vec<_>>()
    };
    assert_eq!(shape(&back), shape(pres(&h)));
}

#[test]
fn picture_adjustments() {
    let mut h = host();
    let pic = pres(&h).slides[3].shapes[0].id;
    let shape = |h: &ShowHost| pres(h).find_shape(pic).unwrap().1.clone();
    apply(
        &mut h,
        C::SetPictureProps {
            shapes: vec![pic],
            patch: PicturePatch {
                brightness: Some(0.3),
                contrast: Some(5.0),
                recolor: Some(Recolor::Grayscale),
                transparency: Some(0.5),
                geometry: Some(Some(model_show::Preset::Ellipse)),
                shadow: Some(Some(model_show::Shadow::default())),
                ..PicturePatch::default()
            },
        },
    );
    let p = shape(&h).picture_props().unwrap().clone();
    assert_eq!((p.brightness, p.contrast, p.transparency), (0.3, 1.0, 0.5));
    // cropping 25 % off the left moves the left edge, the image stays put
    apply(
        &mut h,
        C::CropPicture {
            shape: pic,
            crop: Crop {
                left: 0.25,
                ..Crop::default()
            },
            transform: None,
        },
    );
    assert_eq!(shape(&h).transform, tr(3000, 1000, 6000, 6000));
    // the file keeps it all
    let back = fmt_pptx::read(&h.doc().save_pptx().unwrap()).unwrap();
    let bp = back.slides[3].shapes[0].picture_props().unwrap().clone();
    assert_eq!(bp, shape(&h).picture_props().unwrap().clone());
    // reset: adjustments go, the box grows back
    apply(
        &mut h,
        C::ResetPicture {
            shapes: vec![pic],
            size: false,
        },
    );
    assert_eq!(shape(&h).transform, tr(1000, 1000, 8000, 6000));
    assert_eq!(shape(&h).picture_props().unwrap(), &PictureProps::default());
    assert_eq!(
        err_code(
            &mut h,
            C::CropPicture {
                shape: pic,
                crop: Crop {
                    left: 0.6,
                    right: 0.5,
                    ..Crop::default()
                },
                transform: None
            }
        ),
        "invalid_command"
    );
    let title = pres(&h).slides[0].shapes[0].id;
    assert_eq!(
        err_code(
            &mut h,
            C::SetPictureProps {
                shapes: vec![title],
                patch: PicturePatch::default()
            }
        ),
        "invalid_command"
    );
}

#[test]
fn slide_size_scales_custom_designs() {
    let mut h = host();
    // the Office design is replaced by the 4:3 one
    apply(
        &mut h,
        C::SetSlideSize {
            size: model_show::SlideSize::standard(),
            scale: Default::default(),
        },
    );
    assert_eq!(
        pres(&h).layouts,
        Presentation::empty(model_show::SlideSize::standard()).layouts
    );
    // a changed design scales
    h.apply(C::SetMasterPlaceholderProps {
        target: DesignTarget::Master,
        placeholder: PlaceholderKind::Title,
        idx: None,
        patch: PlaceholderPatch {
            transform: Some(tr(1000, 1000, 9_144_000, 1000)),
            ..PlaceholderPatch::default()
        },
    })
    .unwrap();
    apply(
        &mut h,
        C::SetSlideSize {
            size: model_show::SlideSize {
                width: Emu(18_288_000),
                height: Emu(6_858_000),
            },
            scale: Default::default(),
        },
    );
    assert_eq!(
        pres(&h).master.placeholders[0].transform,
        tr(2000, 1000, 18_288_000, 1000)
    );
}

#[test]
fn themes_request_lists_the_gallery() {
    let mut h = host();
    let reply = dispatch_with(&mut h, r#"{"type":"getThemes"}"#);
    let v: Json = serde_json::from_str(&reply).unwrap();
    let themes = v["ok"]["themes"].as_array().unwrap();
    assert_eq!(themes.len(), 8);
    assert_eq!(themes[0]["id"], "office");
    assert_eq!(themes[1]["theme"]["name"], "Harbor");
    // and a command over the wire
    let reply = dispatch_with(
        &mut h,
        r#"{"type":"apply","command":{"type":"applyTheme","theme":{"kind":"builtin","value":"meadow"}}}"#,
    );
    assert!(reply.contains(r#""theme":{"name":"Meadow""#), "{reply}");
    let reply = dispatch_with(
        &mut h,
        r#"{"type":"apply","command":{"type":"setBackground","target":{"kind":"master"},"fill":null}}"#,
    );
    assert!(reply.starts_with(r#"{"ok":"#), "{reply}");
}
