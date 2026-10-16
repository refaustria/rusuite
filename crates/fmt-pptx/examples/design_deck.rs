//! Builds a deck that exercises the design features – a built-in theme,
//! master and layout backgrounds, a custom layout with a decorative
//! shape, every standard layout, date/footer/slide-number placeholders,
//! sections and adjusted pictures – and writes it with `fmt_pptx::write`.
//!
//! ```text
//! cargo run -q -p fmt-pptx --example design_deck -- [out.pptx]
//! ```
//!
//! Default output: `testdata/pptx/out/rusuite-design.pptx` (relative to the
//! workspace root) – the file to open in PowerPoint and LibreOffice. The
//! deck is also built by `tests/design.rs`.

use core_model::{Color, Rgb, ThemeColorSlot};
use model_show::{
    builtin_theme, presentation::header_footer_shapes, Background, Crop, Emu, Fill, HeaderFooter,
    HfDate, Layout, LayoutKind, Line, NodeId, PictureProps, Presentation, Preset, Recolor, Shadow,
    Shape, SlideSize, TextBody, TextParagraph, Transform,
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

/// A 4×4 RGB PNG (stored, no compression needed for tests).
pub fn tiny_png() -> Vec<u8> {
    // 4x4 pixels, 8-bit RGB, one zlib "stored" block
    fn crc(data: &[u8]) -> u32 {
        let mut c = 0xFFFF_FFFFu32;
        for &b in data {
            c ^= u32::from(b);
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
        }
        !c
    }
    fn adler(data: &[u8]) -> u32 {
        let (mut a, mut b) = (1u32, 0u32);
        for &d in data {
            a = (a + u32::from(d)) % 65_521;
            b = (b + a) % 65_521;
        }
        (b << 16) | a
    }
    let mut raw = Vec::new();
    for y in 0..4u8 {
        raw.push(0); // filter: none
        for x in 0..4u8 {
            raw.extend_from_slice(&[x * 60, y * 60, 200 - x * 40]);
        }
    }
    let mut z = vec![0x78, 0x01, 0x01];
    let len = raw.len() as u16;
    z.extend_from_slice(&len.to_le_bytes());
    z.extend_from_slice(&(!len).to_le_bytes());
    z.extend_from_slice(&raw);
    z.extend_from_slice(&adler(&raw).to_be_bytes());
    let chunk = |out: &mut Vec<u8>, kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut c = kind.to_vec();
        c.extend_from_slice(data);
        out.extend_from_slice(&c);
        out.extend_from_slice(&crc(&c).to_be_bytes());
    };
    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&4u32.to_be_bytes());
    ihdr.extend_from_slice(&4u32.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &ihdr);
    chunk(&mut png, b"IDAT", &z);
    chunk(&mut png, b"IEND", &[]);
    png
}

fn set_text(p: &mut Presentation, slide: NodeId, index: usize, text: &str) {
    let s = p.slide_mut(slide).expect("slide");
    if let Some(body) = s.shapes.get_mut(index).and_then(Shape::text_mut) {
        body.paragraphs = vec![TextParagraph::plain(text)];
    }
}

/// The design deck: Harbor theme, a custom "Quote" layout with an accent
/// bar and its own background, one slide per standard layout (except the
/// vertical ones), footers on all but the title slide, three sections and
/// a slide of adjusted pictures.
pub fn design_deck() -> Presentation {
    let mut p = Presentation::empty(SlideSize::widescreen());
    let theme = builtin_theme("harbor").expect("built-in theme");
    p.theme = theme.theme;
    p.master.background = theme.background;
    p.master.header_footer = HeaderFooter {
        date: HfDate::Auto { format: 1 },
        footer: Some("Rusuite design deck".into()),
        slide_number: true,
        not_on_title: true,
    };
    // a custom layout with a decorative bar and a tinted background
    let mut quote =
        Layout::from_master(LayoutKind::Custom("Quote".into()), &p.master, p.slide_size);
    quote.background = Some(Background::Fill(Fill::Solid(Color::Theme {
        slot: ThemeColorSlot::Accent1,
        tint: 0.8,
    })));
    let mut bar = Shape::auto(Preset::Rect, cm(0.0, 0.0, 1.0, 19.05));
    bar.fill = Fill::Solid(Color::theme(ThemeColorSlot::Accent1));
    bar.line = Line::default();
    if let model_show::ShapeKind::Auto { text, .. } = &mut bar.kind {
        *text = None;
    }
    p.assign_ids(&mut bar);
    quote.shapes.push(bar);
    p.layouts.push(quote);
    // the master's own graphics hide on the section header layout
    if let Some(l) = p.layout_mut(&LayoutKind::SectionHeader) {
        l.show_master_shapes = false;
    }

    let title = p.add_slide(LayoutKind::Title);
    set_text(&mut p, title, 0, "Design deck");
    set_text(
        &mut p,
        title,
        1,
        "Themes, masters, footers, sections, pictures",
    );
    let mut ids = vec![title];
    for (kind, text) in [
        (LayoutKind::TitleContent, "Title and content"),
        (LayoutKind::SectionHeader, "Section header"),
        (LayoutKind::TwoContent, "Two content"),
        (LayoutKind::Comparison, "Comparison"),
        (LayoutKind::TitleOnly, "Title only"),
        (LayoutKind::ContentWithCaption, "Content with caption"),
        (LayoutKind::PictureWithCaption, "Picture with caption"),
        (LayoutKind::Custom("Quote".into()), "A quote layout"),
    ] {
        let s = p.add_slide(kind);
        set_text(&mut p, s, 0, text);
        ids.push(s);
    }
    // a fixed date and a slide without master graphics
    {
        let s = p.slide_mut(ids[1]).expect("slide");
        s.shapes
            .retain(|x| x.placeholder != Some(model_show::PlaceholderKind::DateTime));
    }
    let layout = p.layout_or_builtin(&LayoutKind::TitleContent);
    let fixed = HeaderFooter {
        date: HfDate::Fixed {
            text: "16 October 2026".into(),
        },
        ..HeaderFooter::default()
    };
    for mut sh in header_footer_shapes(&fixed, &layout, &p.master) {
        p.assign_ids(&mut sh);
        p.slide_mut(ids[1]).expect("slide").shapes.push(sh);
    }
    p.slide_mut(ids[2]).expect("slide").show_master_shapes = false;

    // pictures
    let pics = p.add_slide(LayoutKind::TitleOnly);
    set_text(&mut p, pics, 0, "Adjusted pictures");
    let media = p.media.insert("image/png", tiny_png());
    let variants = [
        PictureProps {
            crop: Crop {
                left: 0.25,
                top: 0.0,
                right: 0.0,
                bottom: 0.25,
            },
            ..PictureProps::default()
        },
        PictureProps {
            recolor: Recolor::Grayscale,
            brightness: 0.2,
            contrast: -0.3,
            ..PictureProps::default()
        },
        PictureProps {
            recolor: Recolor::Sepia,
            transparency: 0.4,
            ..PictureProps::default()
        },
        PictureProps {
            recolor: Recolor::BlackWhite { threshold: 0.5 },
            geometry: Some(Preset::Ellipse),
            ..PictureProps::default()
        },
        PictureProps {
            recolor: Recolor::Duotone {
                dark: Rgb::new(0x1F, 0x3A, 0x5F),
                light: Rgb::new(0xE6, 0xEE, 0xF5),
            },
            geometry: Some(Preset::RoundRect),
            shadow: Some(Shadow::default()),
            ..PictureProps::default()
        },
    ];
    for (i, props) in variants.into_iter().enumerate() {
        let mut pic = Shape::picture(media, cm(1.0 + 6.5 * i as f64, 6.0, 5.5, 5.5));
        if let Some(pp) = pic.picture_props_mut() {
            *pp = props;
        }
        if i == 4 {
            pic.line = Line::solid(Color::theme(ThemeColorSlot::Accent2), Emu(28_575));
        }
        p.add_shape(pics, pic).expect("slide");
    }
    ids.push(pics);
    // a caption under the pictures
    let mut caption = Shape::text_box(cm(1.0, 13.0, 30.0, 1.5), "");
    if let Some(t) = caption.text_mut() {
        *t = TextBody::plain("crop · grayscale + corrections · sepia 40 % · black & white oval · duotone with shadow");
    }
    p.add_shape(pics, caption).expect("slide");

    // sections: intro (title), layouts, pictures
    p.add_section("Intro", Some(ids[0])).expect("section");
    p.add_section("Layouts", Some(ids[1])).expect("section");
    p.add_section("Pictures", Some(pics)).expect("section");
    p
}

#[allow(dead_code)]
fn main() -> std::process::ExitCode {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/pptx/out/rusuite-design.pptx"
        )
        .to_owned()
    });
    let deck = design_deck();
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
            eprintln!("cannot write {out}: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}
