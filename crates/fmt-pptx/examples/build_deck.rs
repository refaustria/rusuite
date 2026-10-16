//! Builds a 10-slide deck in code (all layouts, every shape kind, groups,
//! pictures, bullets at three levels, numbering, rotated and flipped shapes,
//! backgrounds) and writes it with `fmt_pptx::write`.
//!
//! ```text
//! cargo run -q -p fmt-pptx --example build_deck -- [out.pptx]
//! ```
//!
//! Default output: `testdata/pptx/out/rusuite-10-slides.pptx` (relative to
//! the workspace root) – the Phase 4 file-level proof to open in PowerPoint
//! and LibreOffice. The deck is also built by `tests/built.rs`.

use core_model::{
    Color, FontFace, FontSize, Rgb, RunProperties, ThemeColorSlot, ThemeFontSlot, Underline,
    VerticalAlign,
};
use model_show::{
    Alignment, Anchor, AutoNumScheme, Bullet, Emu, Fill, LayoutKind, Line, LineDash, NodeId,
    Presentation, Preset, Shape, TextBody, TextParagraph, TextRun, TextSpacing, Transform,
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

fn rgb(hex: &str) -> Color {
    Color::Rgb(Rgb::from_hex(hex).expect("hex color"))
}

fn run(text: &str, props: RunProperties) -> TextRun {
    TextRun {
        props,
        text: text.to_owned(),
        field: None,
    }
}

/// Sets the paragraphs of placeholder `index` on slide `slide`.
fn fill_placeholder(p: &mut Presentation, slide: NodeId, index: usize, paras: Vec<TextParagraph>) {
    let s = p.slide_mut(slide).expect("slide");
    s.shapes[index]
        .text_mut()
        .expect("placeholder text")
        .paragraphs = paras;
}

fn text_box(t: Transform, paras: Vec<TextParagraph>) -> Shape {
    let mut s = Shape::text_box(t, "");
    s.text_mut().expect("text box").paragraphs = paras;
    s
}

/// An auto shape with centered `label`.
fn labeled(preset: Preset, t: Transform, label: &str) -> Shape {
    let mut s = Shape::auto(preset, t);
    if let Some(body) = s.text_mut() {
        body.paragraphs[0].runs = vec![TextRun::new(label)];
    }
    s
}

/// The deck: 10 slides, see the module docs.
pub fn build_deck() -> Presentation {
    let mut p = Presentation::new();
    let accent = |slot| Color::theme(slot);

    // 1 – title slide
    let s1 = p.slides[0].id;
    fill_placeholder(&mut p, s1, 0, vec![TextParagraph::plain("Rusuite Show")]);
    fill_placeholder(
        &mut p,
        s1,
        1,
        vec![TextParagraph::plain(
            "Phase 4 milestone – a deck written by fmt-pptx",
        )],
    );

    // 2 – title and content: bullets at three levels
    let s2 = p.add_slide(LayoutKind::TitleContent);
    fill_placeholder(&mut p, s2, 0, vec![TextParagraph::plain("Agenda")]);
    fill_placeholder(
        &mut p,
        s2,
        1,
        vec![
            TextParagraph::bulleted(0).with_text("Model: slides, shapes, text"),
            TextParagraph::bulleted(1).with_text("Shapes are auto shapes, pictures or groups"),
            TextParagraph {
                props: model_show::TextParagraphProps {
                    level: 2,
                    bullet: Some(Bullet::Char("–".into())),
                    ..Default::default()
                },
                runs: vec![TextRun::new("Groups nest, children are relative")],
            },
            TextParagraph::bulleted(1).with_text("Text follows DrawingML"),
            TextParagraph::bulleted(0).with_text("Format: read and write .pptx"),
            TextParagraph::bulleted(0).with_text("Editor: Konva canvas"),
        ],
    );

    // 3 – numbered list and run formatting
    let s3 = p.add_slide(LayoutKind::TitleContent);
    fill_placeholder(
        &mut p,
        s3,
        0,
        vec![TextParagraph::plain("Numbering and formatting")],
    );
    let num = |level: u8, scheme, text: &str| TextParagraph {
        props: model_show::TextParagraphProps {
            level,
            bullet: Some(Bullet::AutoNum(scheme)),
            ..Default::default()
        },
        runs: vec![TextRun::new(text)],
    };
    let bold = RunProperties {
        bold: Some(true),
        ..Default::default()
    };
    let italic_red = RunProperties {
        italic: Some(true),
        color: Some(rgb("C00000")),
        ..Default::default()
    };
    let underline_big = RunProperties {
        underline: Some(Underline::Single),
        size: Some(FontSize::from_pt(32.0)),
        ..Default::default()
    };
    let mono_hl = RunProperties {
        font: Some(FontFace::from("Courier New")),
        highlight: Some(rgb("FFFF00")),
        ..Default::default()
    };
    let sup = RunProperties {
        vertical_align: Some(VerticalAlign::Superscript),
        ..Default::default()
    };
    let strike_theme = RunProperties {
        strike: Some(true),
        color: Some(Color::Theme {
            slot: ThemeColorSlot::Accent2,
            tint: -0.25,
        }),
        ..Default::default()
    };
    let mut formatted = num(0, AutoNumScheme::ArabicPeriod, "");
    formatted.runs = vec![
        run("Bold", bold),
        TextRun::new(", "),
        run("italic red", italic_red),
        TextRun::new(", "),
        run("underlined 32 pt", underline_big),
    ];
    let mut formatted2 = num(0, AutoNumScheme::ArabicPeriod, "");
    formatted2.runs = vec![
        run("Courier on yellow", mono_hl),
        TextRun::new(", E = mc"),
        run("2", sup),
        TextRun::new(", "),
        run("struck through", strike_theme),
    ];
    fill_placeholder(
        &mut p,
        s3,
        1,
        vec![
            formatted,
            formatted2,
            num(1, AutoNumScheme::AlphaLcPeriod, "Sub-item a"),
            num(1, AutoNumScheme::AlphaLcPeriod, "Sub-item b"),
            num(0, AutoNumScheme::ArabicPeriod, "Third item"),
        ],
    );

    // 4 – blank: every auto shape kind and a text box
    let s4 = p.add_slide(LayoutKind::Blank);
    let shapes = vec![
        labeled(Preset::Rect, cm(1.5, 2.0, 6.0, 4.0), "Rectangle"),
        labeled(Preset::RoundRect, cm(9.0, 2.0, 6.0, 4.0), "Rounded"),
        labeled(Preset::Ellipse, cm(16.5, 2.0, 6.0, 4.0), "Ellipse"),
        Shape::auto(Preset::Line, cm(24.0, 2.0, 7.0, 4.0)),
        text_box(
            cm(1.5, 8.0, 30.0, 2.0),
            vec![TextParagraph::plain(
                "A text box: rectangle, no fill, no outline, grows with its text.",
            )],
        ),
    ];
    for s in shapes {
        p.add_shape(s4, s).expect("slide");
    }

    // 5 – rotation and flips
    let s5 = p.add_slide(LayoutKind::Blank);
    let mut r30 = labeled(Preset::Rect, cm(3.0, 5.0, 8.0, 4.0), "Rotated 30°");
    r30.transform.rotation_deg = 30.0;
    let mut r330 = labeled(Preset::RoundRect, cm(13.0, 5.0, 8.0, 4.0), "Rotated −30°");
    r330.transform.rotation_deg = 330.0;
    r330.fill = Fill::Solid(accent(ThemeColorSlot::Accent2));
    let mut flipped = Shape::auto(Preset::Line, cm(23.0, 4.0, 7.0, 6.0));
    flipped.transform.flip_h = true;
    flipped.line = Line::solid(rgb("7030A0"), Emu::from_pt(4.0));
    let mut flipped_v = labeled(Preset::Ellipse, cm(23.0, 12.0, 7.0, 4.0), "Flipped V");
    flipped_v.transform.flip_v = true;
    for s in [r30, r330, flipped, flipped_v] {
        p.add_shape(s5, s).expect("slide");
    }

    // 6 – pictures
    let s6 = p.add_slide(LayoutKind::Blank);
    let gradient = p.media.insert(
        "image/png",
        png(64, 64, |x, y| [(x * 4) as u8, (y * 4) as u8, 160]),
    );
    let checker = p.media.insert(
        "image/png",
        png(64, 64, |x, y| {
            if (x / 8 + y / 8) % 2 == 0 {
                [30, 30, 30]
            } else {
                [230, 230, 230]
            }
        }),
    );
    p.add_shape(s6, Shape::picture(gradient, cm(2.0, 3.0, 8.0, 8.0)))
        .expect("slide");
    let mut framed = Shape::picture(checker, cm(12.0, 3.0, 8.0, 8.0));
    framed.line = Line::solid(accent(ThemeColorSlot::Accent1), Emu::from_pt(3.0));
    p.add_shape(s6, framed).expect("slide");
    let mut rotated_pic = Shape::picture(gradient, cm(23.0, 4.0, 6.0, 6.0));
    rotated_pic.transform.rotation_deg = 15.0;
    p.add_shape(s6, rotated_pic).expect("slide");

    // 7 – groups (one nested)
    let s7 = p.add_slide(LayoutKind::Blank);
    let inner = Shape::group(vec![
        labeled(Preset::Ellipse, cm(14.0, 9.0, 4.0, 3.0), "In"),
        labeled(Preset::Rect, cm(19.0, 9.0, 4.0, 3.0), "ner"),
    ]);
    let outer = Shape::group(vec![
        labeled(Preset::Rect, cm(2.0, 2.0, 10.0, 5.0), "Group member"),
        text_box(
            cm(2.0, 8.0, 10.0, 1.5),
            vec![TextParagraph::plain("Text box in a group")],
        ),
        inner,
    ]);
    p.add_shape(s7, outer).expect("slide");
    let mut rotated_group = Shape::group(vec![
        labeled(Preset::Rect, cm(24.0, 2.0, 4.0, 2.0), "A"),
        labeled(Preset::Ellipse, cm(28.0, 4.0, 3.0, 3.0), "B"),
    ]);
    rotated_group.transform.rotation_deg = 20.0;
    p.add_shape(s7, rotated_group).expect("slide");

    // 8 – background color with light text
    let s8 = p.add_slide(LayoutKind::TitleContent);
    p.slide_mut(s8).expect("slide").background = Some(Fill::Solid(rgb("1F3864")));
    let white = RunProperties {
        color: Some(rgb("FFFFFF")),
        ..Default::default()
    };
    fill_placeholder(
        &mut p,
        s8,
        0,
        vec![TextParagraph {
            props: Default::default(),
            runs: vec![run("Backgrounds", white.clone())],
        }],
    );
    let mut b1 = TextParagraph::bulleted(0);
    b1.runs = vec![run("Solid slide background", white.clone())];
    let mut b2 = TextParagraph::bulleted(1);
    b2.runs = vec![run("Placeholders inherit the master styles", white)];
    fill_placeholder(&mut p, s8, 1, vec![b1, b2]);

    // 9 – outlines, alignment, anchors, spacing
    let s9 = p.add_slide(LayoutKind::Blank);
    for (i, (dash, anchor, align)) in [
        (LineDash::Solid, Anchor::Top, Alignment::Left),
        (LineDash::Dash, Anchor::Middle, Alignment::Center),
        (LineDash::Dot, Anchor::Bottom, Alignment::Right),
    ]
    .into_iter()
    .enumerate()
    {
        let mut s = Shape::auto(Preset::Rect, cm(1.5 + 10.5 * i as f64, 2.0, 9.5, 6.0));
        s.fill = Fill::Solid(Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: 0.6,
        });
        s.line = Line {
            fill: Fill::Solid(rgb("203864")),
            width: Emu::from_pt(1.0 + 1.5 * i as f64),
            dash,
        };
        let mut para = TextParagraph::plain(&format!("{dash:?} outline, {anchor:?}, {align:?}"));
        para.props.alignment = Some(align);
        para.props.spacing_after = Some(TextSpacing::Points(600));
        para.props.line_spacing = Some(TextSpacing::Percent(120_000));
        *s.text_mut().expect("text") = TextBody {
            props: model_show::BodyProps {
                anchor,
                ..Default::default()
            },
            paragraphs: vec![para],
        };
        p.add_shape(s9, s).expect("slide");
    }
    let mut themed = text_box(
        cm(1.5, 10.0, 30.0, 3.0),
        vec![TextParagraph {
            props: Default::default(),
            runs: vec![run(
                "Theme fonts and colors: heading font in accent 6",
                RunProperties {
                    font: Some(FontFace::Theme(ThemeFontSlot::MajorLatin)),
                    size: Some(FontSize::from_pt(28.0)),
                    color: Some(accent(ThemeColorSlot::Accent6)),
                    ..Default::default()
                },
            )],
        }],
    );
    themed.transform.h = Emu::from_cm(2.0);
    p.add_shape(s9, themed).expect("slide");

    // 10 – closing title slide on a theme-colored background
    let s10 = p.add_slide(LayoutKind::Title);
    p.slide_mut(s10).expect("slide").background = Some(Fill::Solid(Color::Theme {
        slot: ThemeColorSlot::Accent1,
        tint: 0.8,
    }));
    fill_placeholder(&mut p, s10, 0, vec![TextParagraph::plain("Thank you")]);
    fill_placeholder(
        &mut p,
        s10,
        1,
        vec![TextParagraph::plain("Questions?\nrusuite.example")],
    );
    p.normalize();
    p
}

// --- a minimal PNG encoder (stored deflate blocks), so the deck needs no files ---

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &d in data {
        a = (a + u32::from(d)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

/// An RGB PNG of `w`×`h` pixels.
fn png(w: u32, h: u32, pixel: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let mut raw = Vec::new();
    for y in 0..h {
        raw.push(0); // filter: none
        for x in 0..w {
            raw.extend_from_slice(&pixel(x, y));
        }
    }
    let mut z = vec![0x78, 0x01];
    let chunks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (i, c) in chunks.iter().enumerate() {
        z.push(u8::from(i + 1 == chunks.len()));
        let len = c.len() as u16;
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(c);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
    };
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    out
}

fn main() -> std::process::ExitCode {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/pptx/out/rusuite-10-slides.pptx"
        )
        .to_owned()
    });
    let deck = build_deck();
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
