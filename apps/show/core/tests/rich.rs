//! P8-24 commands: charts (insert, data, formatting), hyperlinks and click
//! actions, audio/video, Reuse Slides – each with undo/redo identity and,
//! where it matters, a `.pptx` round trip.

use std::io::Cursor;

use app_common::Host;
use core_model::chart::{BarDirection, ChartKind, Grouping};
use core_model::media::base64_encode;
use model_show::{
    ChartData, ChartSeriesData, Emu, Hyperlink, LayoutKind, LinkTarget, MediaKind, MediaStart,
    NodeId, Presentation, Preset, Shape, ShapeKind, SlideRef, TextParagraph, Transform,
};
use serde_json::Value as Json;
use show_core::{dispatch_with, MediaPatch, ShowCommand as C, ShowDocument, ShowHost, ShowPatch};

fn deck() -> Presentation {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    let mut tb = Shape::text_box(
        Transform::new(Emu(0), Emu(0), Emu(4_000_000), Emu(500_000)),
        "",
    );
    tb.text_mut().unwrap().paragraphs = vec![TextParagraph::plain("Go to the end")];
    p.add_shape(s, tb).unwrap();
    p.add_slide(LayoutKind::TitleContent);
    p
}

fn host() -> ShowHost {
    Host::new(ShowDocument::from_presentation(deck()).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

/// Applies `cmd`, checks undo → before and redo → after.
fn apply(h: &mut ShowHost, cmd: C) -> ShowPatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn err(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(json_of(h), before);
    e.code()
}

fn slide(h: &ShowHost, i: usize) -> NodeId {
    h.doc().presentation().slides[i].id
}

fn shape(h: &ShowHost, id: NodeId) -> Shape {
    h.doc().presentation().find_shape(id).unwrap().1.clone()
}

fn new_id(p: &ShowPatch) -> NodeId {
    p.id_map[0].1
}

fn package_parts(bytes: &[u8]) -> Vec<String> {
    let pkg = fmt_ooxml::Package::open(Cursor::new(bytes)).unwrap();
    pkg.parts().map(|(n, _)| n.as_str().to_owned()).collect()
}

#[test]
fn insert_chart_edit_data_and_format() {
    let mut h = host();
    let s = slide(&h, 1);
    let p = apply(
        &mut h,
        C::InsertChart {
            slide: s,
            kind: ChartKind::column(),
            transform: None,
            new_id: -1,
        },
    );
    let id = new_id(&p);
    assert_eq!(p.slides.len(), 1);
    let c = shape(&h, id);
    assert_eq!(c.name, format!("Chart {}", id.0));
    let chart = c.chart_data().unwrap();
    assert_eq!(chart.data, ChartData::sample());
    assert_eq!(chart.chart.series.len(), 3);
    // centred, 2/3 of the slide
    assert_eq!(c.transform.w.0, 12_192_000 * 2 / 3);

    // Edit Data: a fourth series and a changed value
    let mut d = chart.data.clone();
    d.series[0].values[1] = Some(9.0);
    d.series.push(ChartSeriesData {
        name: "Series 4".into(),
        values: vec![Some(1.0); 4],
        format_code: None,
    });
    apply(&mut h, C::SetChartData { shape: id, data: d });
    let c = shape(&h, id);
    let chart = c.chart_data().unwrap();
    assert_eq!(chart.chart.series.len(), 4);
    assert_eq!(chart.resolved().series[0].values[1], Some(9.0));

    // Change Chart Type → stacked bars; the series references stay
    let mut f = chart.chart.clone();
    f.kind = ChartKind::Bar {
        direction: BarDirection::Bar,
        grouping: Grouping::Stacked,
    };
    f.series[3].values = core_model::chart::DataRef::reference("Elsewhere!$Z$1");
    apply(
        &mut h,
        C::UpdateChart {
            shape: id,
            chart: Box::new(f),
        },
    );
    let c = shape(&h, id);
    let chart = c.chart_data().unwrap();
    assert!(matches!(chart.chart.kind, ChartKind::Bar { .. }));
    assert_eq!(
        chart.chart.series[3].values,
        core_model::chart::DataRef::reference("Sheet1!$E$2:$E$5")
    );

    // errors
    assert_eq!(
        err(
            &mut h,
            C::InsertChart {
                slide: s,
                kind: ChartKind::Combo,
                transform: None,
                new_id: -2
            }
        ),
        "invalid_command"
    );
    let mut bad = ChartData::sample();
    bad.series[0].values[0] = Some(f64::INFINITY);
    assert_eq!(
        err(
            &mut h,
            C::SetChartData {
                shape: id,
                data: bad
            }
        ),
        "invalid_command"
    );

    // saved with a chart part and an embedded workbook
    let bytes = h.doc().save_pptx().unwrap();
    let parts = package_parts(&bytes);
    assert!(
        parts.contains(&"/ppt/charts/chart1.xml".to_owned()),
        "{parts:?}"
    );
    assert!(parts.contains(&"/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx".to_owned()));
    let (doc, warnings) = ShowDocument::open_pptx(&bytes, "c.pptx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let back = doc.presentation().slides[1]
        .shapes
        .iter()
        .find_map(Shape::chart_data)
        .unwrap();
    assert_eq!(back.data.series[0].values[1], Some(9.0));
}

#[test]
fn hyperlinks_and_click_actions() {
    let mut h = host();
    let tb = h.doc().presentation().slides[1].shapes[0].id;
    let target = slide(&h, 2);
    apply(
        &mut h,
        C::SetHyperlink {
            shape: tb,
            paragraph: 0,
            from: 10,
            to: 13,
            link: Some(Hyperlink::slide(SlideRef::Id(target))),
        },
    );
    let runs = shape(&h, tb).text().unwrap().paragraphs[0].runs.clone();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[1].text, "end");
    assert!(runs[1].hyperlink.is_some());
    // removing it merges the runs again
    let mut h2 = h.clone_for_test();
    h2.apply(C::SetHyperlink {
        shape: tb,
        paragraph: 0,
        from: 0,
        to: 13,
        link: None,
    })
    .unwrap();
    assert_eq!(shape(&h2, tb).text().unwrap().paragraphs[0].runs.len(), 1);

    apply(
        &mut h,
        C::SetClickAction {
            shapes: vec![tb],
            action: Some(Hyperlink::url("https://example.com")),
        },
    );
    assert_eq!(
        err(
            &mut h,
            C::SetClickAction {
                shapes: vec![tb],
                action: Some(Hyperlink::url("  ")),
            }
        ),
        "invalid_command"
    );
    // an action button with its default action
    let s = slide(&h, 2);
    let mut button = show_core::NewShape::from(&Shape::action_button(
        Preset::ActionButtonForwardNext,
        Transform::new(Emu(0), Emu(0), Emu(500_000), Emu(500_000)),
    ));
    button.id = -1;
    let p = apply(
        &mut h,
        C::AddShape {
            slide: s,
            shape: button,
            index: None,
        },
    );
    let b = shape(&h, new_id(&p));
    assert_eq!(b.click_action, Some(Hyperlink::slide(SlideRef::Next)));

    let bytes = h.doc().save_pptx().unwrap();
    let slide2 = {
        let pkg = fmt_ooxml::Package::open(Cursor::new(&bytes)).unwrap();
        String::from_utf8(
            pkg.part(&fmt_ooxml::PartName::new("/ppt/slides/slide3.xml").unwrap())
                .unwrap()
                .data
                .clone(),
        )
        .unwrap()
    };
    assert!(
        slide2.contains("ppaction://hlinkshowjump?jump=nextslide"),
        "{slide2}"
    );
    let (doc, _) = ShowDocument::open_pptx(&bytes, "l.pptx").unwrap();
    let p = doc.presentation();
    let runs = &p.slides[1].shapes[0].text().unwrap().paragraphs[0].runs;
    assert_eq!(
        runs[1].hyperlink.as_ref().unwrap().target,
        LinkTarget::Slide(SlideRef::Id(p.slides[2].id))
    );
    assert_eq!(
        p.slides[1].shapes[0].click_action,
        Some(Hyperlink::url("https://example.com"))
    );
}

/// Test helper: a host holding a copy of the presentation.
trait CloneForTest {
    fn clone_for_test(&self) -> ShowHost;
}

impl CloneForTest for ShowHost {
    fn clone_for_test(&self) -> ShowHost {
        Host::new(ShowDocument::from_presentation(self.doc().presentation().clone()).unwrap())
    }
}

#[test]
fn media_insert_playback_and_poster() {
    let mut h = host();
    let s = slide(&h, 1);
    let p = apply(
        &mut h,
        C::InsertMedia {
            slide: s,
            content_type: "video/webm".into(),
            bytes_base64: base64_encode(b"\x1aE\xdf\xa3webm"),
            transform: None,
            new_id: -1,
        },
    );
    let id = new_id(&p);
    let m = shape(&h, id);
    let clip = m.media_clip().unwrap();
    assert_eq!(clip.kind, MediaKind::Video);
    assert_eq!(m.name, format!("Video {}", id.0));
    assert_eq!(m.transform.w.0 * 9, m.transform.h.0 * 16);
    apply(
        &mut h,
        C::SetMediaProps {
            shapes: vec![id],
            patch: MediaPatch {
                start: Some(MediaStart::InClickSequence),
                loop_playback: Some(true),
                volume: Some(200_000),
                ..MediaPatch::default()
            },
        },
    );
    let clip = shape(&h, id).media_clip().unwrap().clone();
    assert_eq!(clip.start, MediaStart::InClickSequence);
    assert!(clip.loop_playback);
    assert_eq!(clip.volume, 100_000);
    let png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\0\x02\0\0\0\x03\x08\x06\0\0\0".to_vec();
    apply(
        &mut h,
        C::SetMediaPoster {
            shape: id,
            content_type: Some("image/png".into()),
            bytes_base64: Some(base64_encode(&png)),
        },
    );
    assert!(shape(&h, id).media_clip().unwrap().poster.is_some());
    assert_eq!(
        err(
            &mut h,
            C::InsertMedia {
                slide: s,
                content_type: "image/png".into(),
                bytes_base64: base64_encode(&png),
                transform: None,
                new_id: -9,
            }
        ),
        "invalid_command"
    );
    // audio: a small icon in the middle
    let p = apply(
        &mut h,
        C::InsertMedia {
            slide: s,
            content_type: "audio/mpeg".into(),
            bytes_base64: base64_encode(b"ID3"),
            transform: None,
            new_id: -2,
        },
    );
    let a = shape(&h, new_id(&p));
    assert_eq!(a.media_clip().unwrap().kind, MediaKind::Audio);
    assert_eq!(a.transform.w, Emu(457_200));

    let bytes = h.doc().save_pptx().unwrap();
    let (doc, warnings) = ShowDocument::open_pptx(&bytes, "m.pptx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let back = &doc.presentation().slides[1].shapes;
    let v = back.iter().find_map(Shape::media_clip).unwrap();
    assert_eq!(v.start, MediaStart::InClickSequence);
    assert!(v.loop_playback && v.poster.is_some());
}

/// A two-slide source deck: a custom layout slide with a picture and a
/// link to its second slide, and a title-and-content slide.
fn source() -> Presentation {
    let mut p = Presentation::new();
    p.slides.clear();
    let mut custom = model_show::Layout::new(LayoutKind::Custom("Quote".into()));
    custom.shapes.push(Shape::auto(
        Preset::Rect,
        Transform::new(Emu(0), Emu(0), Emu(100), Emu(100)),
    ));
    p.layouts.push(custom);
    let a = p.add_slide(LayoutKind::Custom("Quote".into()));
    let b = p.add_slide(LayoutKind::TitleContent);
    let img = p.media.insert("image/png", vec![9, 9, 9]);
    let mut pic = Shape::picture(img, Transform::new(Emu(0), Emu(0), Emu(10), Emu(10)));
    pic.click_action = Some(Hyperlink::slide(SlideRef::Id(b)));
    p.add_shape(a, pic).unwrap();
    let mut other = Shape::auto(Preset::Rect, Transform::default());
    other.click_action = Some(Hyperlink::slide(SlideRef::Id(NodeId(9_999))));
    p.add_shape(a, other).unwrap();
    p
}

#[test]
fn insert_slides_with_and_without_source_formatting() {
    let src = source();
    let mut h = host();
    let first = slide(&h, 0);
    let before_layouts = h.doc().presentation().layouts.len();
    let p = apply(
        &mut h,
        C::InsertSlides {
            after: Some(first),
            slides: src.slides.clone(),
            layouts: src.layouts.clone(),
            media: src.media.clone(),
            keep_source_formatting: true,
        },
    );
    assert_eq!(p.slides.len(), 2);
    assert!(p.layouts.is_some(), "a copied layout is a design change");
    let pres = h.doc().presentation();
    assert_eq!(pres.slides.len(), 5);
    // each used source layout became a custom layout ("Title and
    // Content" is taken: numbered)
    assert_eq!(pres.layouts.len(), before_layouts + 2);
    let copied = &pres.slides[1];
    assert_eq!(copied.layout, LayoutKind::Custom("Quote".into()));
    assert_eq!(
        pres.slides[2].layout,
        LayoutKind::Custom("Title and Content 2".into())
    );
    // the picture's link follows the inserted copy of its target; the
    // link to a slide that was not inserted is gone
    assert_eq!(
        copied.shapes[0].click_action,
        Some(Hyperlink::slide(SlideRef::Id(pres.slides[2].id)))
    );
    assert_eq!(copied.shapes[1].click_action, None);
    let ShapeKind::Picture { media, .. } = &copied.shapes[0].kind else {
        panic!("picture")
    };
    assert_eq!(pres.media.get(*media).unwrap().data, vec![9, 9, 9]);

    // without source formatting: the custom layout maps to a standard one
    let mut h = host();
    apply(
        &mut h,
        C::InsertSlides {
            after: None,
            slides: src.slides.clone(),
            layouts: src.layouts.clone(),
            media: src.media.clone(),
            keep_source_formatting: false,
        },
    );
    let pres = h.doc().presentation();
    assert_eq!(pres.layouts.len(), before_layouts);
    assert_eq!(pres.slides[0].layout, LayoutKind::Blank);
    assert_eq!(pres.slides[1].layout, LayoutKind::TitleContent);
    // fresh, unique ids
    let mut ids: Vec<NodeId> = pres.slides.iter().map(|s| s.id).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 5);

    assert_eq!(
        err(
            &mut h,
            C::InsertSlides {
                after: None,
                slides: Vec::new(),
                layouts: Vec::new(),
                media: Default::default(),
                keep_source_formatting: false,
            }
        ),
        "invalid_command"
    );
}

#[test]
fn peek_presentation_changes_nothing() {
    let mut h = host();
    let bytes = fmt_pptx::write(&source()).unwrap();
    let before = json_of(&h);
    let reply = dispatch_with(
        &mut h,
        &format!(
            r#"{{"type":"peekPresentation","bytesBase64":"{}"}}"#,
            base64_encode(&bytes)
        ),
    );
    let v: Json = serde_json::from_str(&reply).unwrap();
    assert_eq!(v["ok"]["type"], "peeked", "{reply}");
    assert_eq!(
        v["ok"]["presentation"]["slides"].as_array().unwrap().len(),
        2
    );
    assert_eq!(json_of(&h), before);
    assert!(!h.is_dirty());
}
