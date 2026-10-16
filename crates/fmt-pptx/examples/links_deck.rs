//! Builds a 3-slide deck of hyperlinks, action buttons and media: text
//! with a web link (with a ScreenTip) and a jump to slide 3, a shape that
//! ends the show; the six navigation action buttons with their default
//! actions; a video (no poster: the generated placeholder) playing on
//! click, and a looping, hidden, quiet sound that starts automatically.
//! Written with `fmt_pptx::write`.
//!
//! ```text
//! cargo run -q -p fmt-pptx --example links_deck -- [out.pptx]
//! ```
//!
//! Default output: `testdata/pptx/out/rusuite-links.pptx` (relative to
//! the workspace root). The deck is also built by `tests/links.rs`.

use model_show::{
    Emu, Hyperlink, LayoutKind, LinkTarget, MediaClip, MediaKind, MediaStart, Presentation, Preset,
    Shape, SlideRef, TextParagraph, TextRun, Transform,
};

/// A box in centimeters.
fn cm(x: f64, y: f64, w: f64, h: f64) -> Transform {
    Transform::new(
        Emu::from_cm(x),
        Emu::from_cm(y),
        Emu::from_cm(w),
        Emu::from_cm(h),
    )
}

/// The first bytes of a WebM file (an EBML header; enough for the
/// package, not a playable video).
pub const WEBM: &[u8] =
    b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\xf7\x81\x01B\xf2\x81\x04B\xf3\x81\x08B\x82\x84webm";
/// A tiny "WAV" (RIFF header only).
pub const WAV: &[u8] = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00@\x1f\x00\x00@\x1f\x00\x00\x01\x00\x08\x00data\x00\x00\x00\x00";

pub fn links_deck() -> Presentation {
    let mut p = Presentation::empty(model_show::SlideSize::widescreen());
    let s1 = p.add_slide(LayoutKind::Blank);
    let s2 = p.add_slide(LayoutKind::Blank);
    let s3 = p.add_slide(LayoutKind::Blank);

    // 1: text links and a shape that ends the show
    let mut tb = Shape::text_box(cm(2.0, 2.0, 24.0, 3.0), "");
    let mut para = TextParagraph::new();
    para.runs.push(TextRun::new("Visit "));
    para.runs.push(TextRun {
        hyperlink: Some(Hyperlink {
            target: LinkTarget::Url("https://example.com/rusuite?a=1&b=2".into()),
            tooltip: Some("The Rusuite site".into()),
        }),
        ..TextRun::new("example.com")
    });
    para.runs.push(TextRun::new(" or jump to "));
    para.runs.push(TextRun {
        hyperlink: Some(Hyperlink::slide(SlideRef::Id(s3))),
        ..TextRun::new("the media slide")
    });
    tb.text_mut().expect("text box").paragraphs = vec![para];
    p.add_shape(s1, tb).expect("slide exists");
    let mut end = Shape::auto(Preset::RoundRect, cm(2.0, 7.0, 6.0, 2.5));
    end.click_action = Some(Hyperlink {
        target: LinkTarget::EndShow,
        tooltip: None,
    });
    if let Some(b) = end.text_mut() {
        b.paragraphs = vec![TextParagraph::plain("End show")];
    }
    p.add_shape(s1, end).expect("slide exists");
    let mut web = Shape::auto(Preset::Ellipse, cm(10.0, 7.0, 4.0, 2.5));
    web.click_action = Some(Hyperlink::url("mailto:team@example.com"));
    p.add_shape(s1, web).expect("slide exists");

    // 2: the navigation action buttons
    for (i, preset) in [
        Preset::ActionButtonBackPrevious,
        Preset::ActionButtonForwardNext,
        Preset::ActionButtonBeginning,
        Preset::ActionButtonEnd,
        Preset::ActionButtonHome,
        Preset::ActionButtonReturn,
    ]
    .into_iter()
    .enumerate()
    {
        p.add_shape(
            s2,
            Shape::action_button(preset, cm(2.0 + i as f64 * 3.0, 14.0, 2.2, 2.2)),
        )
        .expect("slide exists");
    }
    let mut info = Shape::action_button(Preset::ActionButtonInformation, cm(22.0, 14.0, 2.2, 2.2));
    info.click_action = Some(Hyperlink::slide(SlideRef::Id(s1)));
    p.add_shape(s2, info).expect("slide exists");

    // 3: a video and a sound
    let video = p.media.insert("video/webm", WEBM.to_vec());
    p.add_shape(
        s3,
        Shape::media(
            MediaClip::new(MediaKind::Video, video),
            cm(2.0, 2.0, 16.0, 9.0),
        ),
    )
    .expect("slide exists");
    let sound = p.media.insert("audio/wav", WAV.to_vec());
    let clip = MediaClip {
        start: MediaStart::Automatically,
        loop_playback: true,
        hide_when_not_playing: true,
        volume: MediaClip::VOLUME_LOW,
        ..MediaClip::new(MediaKind::Audio, sound)
    };
    p.add_shape(s3, Shape::media(clip, cm(20.0, 2.0, 2.0, 2.0)))
        .expect("slide exists");
    p
}

fn main() -> std::process::ExitCode {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/pptx/out/rusuite-links.pptx"
        )
        .to_owned()
    });
    let deck = links_deck();
    if let Some(dir) = std::path::Path::new(&out).parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("cannot create {}: {e}", dir.display());
            return std::process::ExitCode::FAILURE;
        }
    }
    match fmt_pptx::write_path(&deck, &out) {
        Ok(()) => {
            println!("wrote {out} ({} slides)", deck.slides.len());
            std::process::ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("write failed: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}
