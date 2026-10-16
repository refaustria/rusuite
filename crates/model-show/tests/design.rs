//! Masters, layouts, header/footer placeholders and themes.

use core_model::{Color, FontSize, ThemeColorSlot};
use model_show::{
    builtin_theme, Background, FooterDate, HfDate, LayoutKind, PlaceholderKind, Presentation,
    ResolvedFill, Shape, SlideSize, TextBody, TextField,
};

fn kinds(p: &Presentation, slide: model_show::NodeId) -> Vec<(PlaceholderKind, Option<u32>)> {
    p.slide(slide)
        .unwrap()
        .shapes
        .iter()
        .filter_map(|s| s.placeholder.map(|k| (k, s.placeholder_idx)))
        .collect()
}

#[test]
fn new_deck_has_the_standard_layouts() {
    let p = Presentation::new();
    let ks: Vec<_> = p.layouts.iter().map(|l| l.kind.clone()).collect();
    assert_eq!(ks, LayoutKind::STANDARD.to_vec());
    assert_eq!(p.layouts[3].display_name(), "Two Content");
    // the title slide holds the centred title and the subtitle (no footers)
    assert_eq!(
        kinds(&p, p.slides[0].id),
        [
            (PlaceholderKind::CenteredTitle, None),
            (PlaceholderKind::Subtitle, Some(1))
        ]
    );
    p.validate().unwrap();
}

#[test]
fn placeholders_inherit_from_layout_then_master() {
    let mut p = Presentation::empty(SlideSize::widescreen());
    let s = p.add_slide(LayoutKind::Comparison);
    assert_eq!(
        kinds(&p, s),
        [
            (PlaceholderKind::Title, None),
            (PlaceholderKind::Body, Some(1)),
            (PlaceholderKind::Body, Some(2)),
            (PlaceholderKind::Body, Some(3)),
            (PlaceholderKind::Body, Some(4)),
        ]
    );
    let slide = p.slide(s).unwrap().clone();
    // the right heading resolves to its own layout placeholder (bold 24 pt)
    let head = &slide.shapes[3];
    let r = p.resolve_placeholder(&slide, head).unwrap();
    assert!(!r.from_master);
    assert_eq!(r.def.idx, 3);
    assert_eq!(r.def.run_defaults.bold, Some(true));
    assert_eq!(r.def.run_defaults.size, Some(FontSize::from_pt(24.0)));
    assert_eq!(head.transform, r.def.transform);
    // a footer on a layout without one inherits the master's
    let mut ftr = Shape::text_box(r.def.transform, "x");
    ftr.placeholder = Some(PlaceholderKind::Footer);
    let mut blank = slide.clone();
    blank.layout = LayoutKind::Custom("gone".into());
    p.layouts
        .push(model_show::Layout::new(LayoutKind::Custom("gone".into())));
    let r = p.resolve_placeholder(&blank, &ftr).unwrap();
    assert!(r.from_master);
    assert_eq!(r.def.kind, PlaceholderKind::Footer);
    // deeper outline levels come from the master body style
    let (para, run) = p.resolve_level(&slide, &slide.shapes[2], 2);
    assert_eq!(run.size, Some(FontSize::from_pt(20.0)));
    assert!(para.bullet.is_some());
}

#[test]
fn layout_change_remaps_by_type_and_idx() {
    let mut p = Presentation::empty(SlideSize::widescreen());
    let s = p.add_slide(LayoutKind::TwoContent);
    {
        let slide = p.slide_mut(s).unwrap();
        *slide.shapes[1].text_mut().unwrap() = TextBody::plain("left");
        *slide.shapes[2].text_mut().unwrap() = TextBody::plain("right");
    }
    let two = p.layout(&LayoutKind::TwoContent).unwrap().clone();
    let cmp = p.layout(&LayoutKind::Comparison).unwrap().clone();
    let slide = p.slide_mut(s).unwrap();
    slide.apply_layout(&two, &cmp);
    // idx 1 and 2 keep their text and take the Comparison boxes; the
    // headings 3 and 4 are added
    let texts: Vec<_> = slide
        .shapes
        .iter()
        .map(|x| {
            (
                x.placeholder_idx,
                x.text().map(TextBody::plain_text).unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(
        texts,
        [
            (Some(3), String::new()),
            (Some(4), String::new()),
            (None, String::new()),
            (Some(1), "left".into()),
            (Some(2), "right".into()),
        ]
    );
    let left = slide
        .shapes
        .iter()
        .find(|x| x.placeholder_idx == Some(2))
        .unwrap();
    assert_eq!(
        left.transform,
        cmp.find(PlaceholderKind::Body, Some(2)).unwrap().transform
    );
    // and back: the headings were empty and go, the contents stay
    slide.apply_layout(&cmp, &two);
    let idx: Vec<_> = slide.shapes.iter().map(|x| x.placeholder_idx).collect();
    assert_eq!(idx, [None, Some(1), Some(2)]);
}

#[test]
fn header_footer_placeholders_and_resolution() {
    let mut p = Presentation::empty(SlideSize::widescreen());
    p.master.header_footer = model_show::HeaderFooter {
        date: HfDate::Auto { format: 3 },
        footer: Some("Rusuite".into()),
        slide_number: true,
        not_on_title: true,
    };
    let title = p.add_slide(LayoutKind::Title);
    let body = p.add_slide(LayoutKind::TitleContent);
    // not on the title slide
    assert!(kinds(&p, title).iter().all(|(k, _)| !k.is_header_footer()));
    let k = kinds(&p, body);
    assert_eq!(
        &k[2..],
        [
            (PlaceholderKind::DateTime, Some(10)),
            (PlaceholderKind::Footer, Some(11)),
            (PlaceholderKind::SlideNumber, Some(12)),
        ]
    );
    let f = p.resolved_footer(body).unwrap();
    assert_eq!(f.date, Some(FooterDate::Auto { format: 3 }));
    assert_eq!(f.footer.as_deref(), Some("Rusuite"));
    assert_eq!(f.slide_number, Some(2));
    let num = &p.slide(body).unwrap().shapes[4];
    assert_eq!(
        num.text().unwrap().paragraphs[0].runs[0].field,
        Some(TextField::SlideNumber)
    );
    assert_eq!(
        p.resolved_footer(title).unwrap(),
        model_show::ResolvedFooter::default()
    );
    // the slide's own footer position is the layout's
    let l = p.layout(&LayoutKind::TitleContent).unwrap();
    assert_eq!(
        p.slide(body).unwrap().shapes[3].transform,
        l.placeholder(PlaceholderKind::Footer).unwrap().transform
    );
}

#[test]
fn themes_and_backgrounds() {
    let mut p = Presentation::new();
    let s = p.slides[0].clone();
    assert_eq!(
        p.resolved_background(&s),
        ResolvedFill::Solid {
            color: core_model::Rgb::WHITE,
            alpha: 1.0
        }
    );
    let b = builtin_theme("lagoon").unwrap();
    p.theme = b.theme;
    p.master.background = b.background;
    let ResolvedFill::Gradient { stops, .. } = p.resolved_background(&s) else {
        panic!("lagoon has a gradient background")
    };
    assert_eq!(stops.len(), 2);
    // a layout background overrides the master's, a slide's both
    p.layouts[0].background = Some(Background::Fill(model_show::Fill::Solid(Color::theme(
        ThemeColorSlot::Accent2,
    ))));
    assert_eq!(
        p.resolved_background(&s),
        ResolvedFill::Solid {
            color: core_model::Rgb::new(0xFF, 0x7F, 0x50),
            alpha: 1.0
        }
    );
    let mut s2 = s.clone();
    s2.background = Some(model_show::Fill::None);
    assert_eq!(p.resolved_background(&s2), ResolvedFill::None);
    // snapshots keep master, layouts, sections and the theme's format
    let back = Presentation::from_json(&p.to_json().unwrap()).unwrap();
    assert_eq!(back, p);
}

#[test]
fn old_snapshots_get_master_and_all_layouts() {
    let json = r#"{"slideSize":{"width":12192000,"height":6858000},
        "slides":[{"id":1,"layout":"titleContent","shapes":[]}],
        "layouts":[{"kind":"title","placeholders":[]}],
        "theme":{"name":"T","colors":{"name":"c","colors":["000000","FFFFFF","44546A","E7E6E6","4472C4","ED7D31","A5A5A5","FFC000","5B9BD5","70AD47","0563C1","954F72"]},
          "fonts":{"name":"f","majorLatin":"A","minorLatin":"B","majorEastAsian":"","minorEastAsian":"","majorComplexScript":"","minorComplexScript":""}},
        "media":[]}"#;
    let p = Presentation::from_json(json).unwrap();
    assert_eq!(p.layouts.len(), 11);
    assert!(
        p.layouts[0].placeholders.is_empty(),
        "given layouts are kept"
    );
    assert_eq!(
        p.master,
        model_show::SlideMaster::builtin(SlideSize::widescreen())
    );
    assert_eq!(p.theme.format, model_show::FormatScheme::office());
    p.validate().unwrap();
}
