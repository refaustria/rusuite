//! The Show performance scenario (P5-4): 100 slides × 20 shapes with text,
//! loaded, serialized, edited (transform, duplicate), saved and reopened.

#![allow(dead_code)]

use model_show::{
    Emu, LayoutKind, NodeId, Presentation, Preset, Shape, TextParagraph, TextRun, Transform,
};
use show_core::{dispatch_with, ShowCommand, ShowDocument, ShowHost};

#[path = "support.rs"]
pub mod support;
use support::Report;

pub const SLIDES: usize = 100;
pub const SHAPES: usize = 20;

fn cm(x: f64, y: f64, w: f64, h: f64) -> Transform {
    Transform::new(
        Emu::from_cm(x),
        Emu::from_cm(y),
        Emu::from_cm(w),
        Emu::from_cm(h),
    )
}

/// The fixture: `SLIDES` blank slides with one title text box and
/// `SHAPES - 1` text boxes / labelled auto shapes in a grid.
pub fn presentation() -> Presentation {
    let mut p = Presentation::empty(model_show::SlideSize::widescreen());
    for s in 0..SLIDES {
        let slide = p.add_slide(LayoutKind::Blank);
        let mut title = Shape::text_box(cm(1.0, 0.5, 31.0, 2.0), "");
        title.text_mut().expect("text").paragraphs = vec![TextParagraph::plain(&format!(
            "Slide {} – quarterly review",
            s + 1
        ))];
        p.add_shape(slide, title).expect("title");
        for k in 1..SHAPES {
            let (col, row) = ((k - 1) % 5, (k - 1) / 5);
            let t = cm(1.0 + col as f64 * 6.4, 3.0 + row as f64 * 3.8, 6.0, 3.4);
            let shape = match k % 3 {
                0 => {
                    let mut tb = Shape::text_box(t, "");
                    tb.text_mut().expect("text").paragraphs = vec![
                        TextParagraph::bulleted(0)
                            .with_text(&format!("Point {k} of slide {}", s + 1)),
                        TextParagraph::bulleted(1).with_text("Revenue grew across all regions"),
                    ];
                    tb
                }
                1 => labeled(Preset::Rect, t, &format!("Box {k}")),
                _ => labeled(Preset::Ellipse, t, &format!("Item {k}")),
            };
            p.add_shape(slide, shape).expect("shape");
        }
    }
    p.normalize();
    p
}

fn labeled(preset: Preset, t: Transform, label: &str) -> Shape {
    let mut s = Shape::auto(preset, t);
    if let Some(body) = s.text_mut() {
        body.paragraphs[0].runs = vec![TextRun::new(label)];
    }
    s
}

fn ok(out: &str) {
    assert!(
        out.starts_with(r#"{"ok""#),
        "{}",
        &out[..300.min(out.len())]
    );
}

/// Runs the scenario; returns the report and the saved `.pptx`.
pub fn run() -> (Report, Vec<u8>) {
    let mut r = Report::default();
    let pres = presentation();
    let json = serde_json::to_string(&pres).expect("json");
    r.add(
        "fixture: Presentation JSON",
        json.len() as f64 / 1e6,
        "MB",
        None,
    );

    let mut host = ShowHost::new(ShowDocument::new());
    let request = format!(r#"{{"type":"load","presentation":{json}}}"#);
    let out = r.time(
        "Load (dispatch: parse + validate + reply with the presentation)",
        Some(2000.0),
        || dispatch_with(&mut host, &request),
    );
    ok(&out);
    let out = r.time("GetPresentation (dispatch)", None, || {
        dispatch_with(&mut host, r#"{"type":"getPresentation"}"#)
    });
    ok(&out);
    r.add(
        "GetPresentation JSON size",
        out.len() as f64 / 1e6,
        "MB",
        None,
    );

    let slide: NodeId = host.doc().presentation().slides[50].id;
    let shape: NodeId = host.doc().presentation().slides[50].shapes[5].id;
    let mut x = 0;
    r.median(
        "SetTransform of one shape (Host::apply)",
        51,
        Some(50.0),
        || {
            x += 1;
            let t = cm(1.0 + f64::from(x % 7), 3.0, 6.0, 3.4);
            host.apply(ShowCommand::SetTransform {
                shapes: vec![(shape, t)],
            })
            .expect("transform");
        },
    );
    r.median("SetTransform of one shape (dispatch JSON)", 51, Some(50.0), || {
        x += 1;
        let req = format!(
            r#"{{"type":"apply","command":{{"type":"setTransform","shapes":[[{},{{"x":{},"y":1080000,"w":2160000,"h":1224000,"rotationDeg":0,"flipH":false,"flipV":false}}]]}}}}"#,
            shape.0,
            360_000 + (x % 7) * 36_000
        );
        ok(&dispatch_with(&mut host, &req));
    });
    r.median("DuplicateSlide (dispatch JSON)", 21, Some(50.0), || {
        let req = format!(
            r#"{{"type":"apply","command":{{"type":"duplicateSlide","id":{}}}}}"#,
            slide.0
        );
        ok(&dispatch_with(&mut host, &req));
    });
    // Back to the fixture's 100 slides for the file round trip.
    let out = dispatch_with(&mut host, &request);
    ok(&out);
    let bytes = r.time("save_pptx", Some(2000.0), || {
        host.doc().save_pptx().expect("save")
    });
    r.add("pptx size", bytes.len() as f64 / 1e6, "MB", None);
    let (reopened, _) = r.time("open_pptx", Some(2000.0), || {
        ShowDocument::open_pptx(&bytes, "perf.pptx").expect("open")
    });
    assert_eq!(reopened.presentation().slides.len(), SLIDES);
    r.add(
        "peak RSS (VmHWM)",
        support::proc_status_mb("VmHWM"),
        "MB",
        None,
    );
    (r, bytes)
}
