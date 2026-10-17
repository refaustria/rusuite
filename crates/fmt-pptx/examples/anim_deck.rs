//! Builds a deck with every supported slide transition and animation
//! preset (P8-7; the PowerPoint 2010+ transitions, effects, motion paths,
//! paragraph builds and triggers of P9-S4 on slides 8 and later) and writes it with `fmt_pptx::write`.
//!
//! ```text
//! cargo run -q -p fmt-pptx --example anim_deck -- [out.pptx]
//! ```
//!
//! Default output: `testdata/pptx/out/rusuite-animations.pptx` (relative to
//! the workspace root) – the file to open in PowerPoint and LibreOffice to
//! check transitions and animations. The deck is also built by
//! `tests/anim.rs`.

use model_show::{
    Animation, AnimationKind, Direction, Effect, Emu, Fill, LayoutKind, NodeId, Presentation,
    Preset, Repeat, Shape, StartOn, TextBuild, TextParagraph, Transform, Transition,
    TransitionKind, Trigger,
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

/// Adds a filled, labeled shape to `slide`; returns its id.
fn add(p: &mut Presentation, slide: NodeId, preset: Preset, t: Transform, label: &str) -> NodeId {
    let mut s = Shape::auto(preset, t);
    s.fill = Fill::Solid(core_model::Color::theme(
        core_model::ThemeColorSlot::Accent1,
    ));
    if let Some(body) = s.text_mut() {
        body.paragraphs = vec![TextParagraph::plain(label)];
    }
    p.add_shape(slide, s).expect("slide exists")
}

/// A blank slide with a text box `title` and `transition`; returns its id.
fn slide(p: &mut Presentation, title: &str, transition: Transition) -> NodeId {
    let id = p.add_slide(LayoutKind::Blank);
    p.add_shape(id, Shape::text_box(cm(1.0, 0.5, 30.0, 2.0), title))
        .expect("slide exists");
    p.slide_mut(id).expect("slide").transition = Some(transition);
    id
}

fn transition(kind: TransitionKind, direction: Option<Direction>) -> Transition {
    Transition {
        direction,
        ..Transition::new(kind)
    }
}

/// Appends an animation to `slide`.
fn animate(
    p: &mut Presentation,
    slide: NodeId,
    shape: NodeId,
    kind: AnimationKind,
    effect: Effect,
    trigger: Trigger,
    direction: Option<Direction>,
) {
    let mut a = Animation::new(shape, kind, effect);
    a.id = p.alloc_id();
    a.trigger = trigger;
    a.direction = direction;
    p.slide_mut(slide).expect("slide").animations.push(a);
}

/// The deck: see the module docs.
pub fn anim_deck() -> Presentation {
    use AnimationKind::{Emphasis, Entrance, Exit};
    use Trigger::{AfterPrevious, OnClick, WithPrevious};
    let mut p = Presentation::new();

    // 1 – fade transition; title flies in, subtitle fades in with it
    let s1 = p.slides[0].id;
    let (title, subtitle) = {
        let s = p.slide_mut(s1).expect("slide");
        s.transition = Some(Transition::new(TransitionKind::Fade));
        s.shapes[0].text_mut().expect("title").paragraphs =
            vec![TextParagraph::plain("Transitions and animations")];
        s.shapes[1].text_mut().expect("subtitle").paragraphs =
            vec![TextParagraph::plain("Every preset fmt-pptx writes")];
        (s.shapes[0].id, s.shapes[1].id)
    };
    animate(&mut p, s1, title, Entrance, Effect::FlyIn, OnClick, None);
    let mut fade = Animation::new(subtitle, Entrance, Effect::Fade);
    fade.id = p.alloc_id();
    fade.trigger = WithPrevious;
    fade.delay_ms = 250;
    fade.duration_ms = 1000;
    p.slide_mut(s1).expect("slide").animations.push(fade);

    // 2 – push transition; entrances and emphasis
    let s2 = slide(
        &mut p,
        "Push from bottom · entrances and emphasis",
        transition(TransitionKind::Push, Some(Direction::Up)),
    );
    let r = add(&mut p, s2, Preset::Rect, cm(1.5, 4.0, 6.0, 4.0), "Wipe");
    let e = add(&mut p, s2, Preset::Ellipse, cm(9.0, 4.0, 6.0, 4.0), "Zoom");
    let q = add(
        &mut p,
        s2,
        Preset::RoundRect,
        cm(16.5, 4.0, 6.0, 4.0),
        "Appear",
    );
    let f = add(&mut p, s2, Preset::Rect, cm(24.0, 4.0, 6.0, 4.0), "Fly in");
    animate(
        &mut p,
        s2,
        r,
        Entrance,
        Effect::Wipe,
        OnClick,
        Some(Direction::Left),
    );
    animate(&mut p, s2, e, Entrance, Effect::Zoom, AfterPrevious, None);
    animate(&mut p, s2, q, Entrance, Effect::Appear, OnClick, None);
    animate(
        &mut p,
        s2,
        f,
        Entrance,
        Effect::FlyIn,
        WithPrevious,
        Some(Direction::RightUp),
    );
    animate(&mut p, s2, r, Emphasis, Effect::Spin, OnClick, None);
    animate(
        &mut p,
        s2,
        e,
        Emphasis,
        Effect::GrowShrink,
        AfterPrevious,
        None,
    );

    // 3 – wipe transition, advances after 3 s too; exits
    let s3 = slide(
        &mut p,
        "Wipe · exits",
        Transition {
            advance_after_ms: Some(3000),
            ..transition(TransitionKind::Wipe, Some(Direction::Right))
        },
    );
    let ids: Vec<NodeId> = ["Fade", "Fly out", "Wipe", "Zoom", "Disappear"]
        .iter()
        .enumerate()
        .map(|(i, label)| {
            add(
                &mut p,
                s3,
                Preset::Rect,
                cm(1.0 + 6.2 * i as f64, 5.0, 5.5, 4.0),
                label,
            )
        })
        .collect();
    animate(&mut p, s3, ids[0], Exit, Effect::Fade, OnClick, None);
    animate(
        &mut p,
        s3,
        ids[1],
        Exit,
        Effect::FlyIn,
        OnClick,
        Some(Direction::Right),
    );
    animate(
        &mut p,
        s3,
        ids[2],
        Exit,
        Effect::Wipe,
        OnClick,
        Some(Direction::Up),
    );
    animate(&mut p, s3, ids[3], Exit, Effect::Zoom, AfterPrevious, None);
    animate(&mut p, s3, ids[4], Exit, Effect::Appear, OnClick, None);

    // 4–7 – the other transitions; 7 advances only automatically
    let s4 = slide(
        &mut p,
        "Cover from top-right",
        transition(TransitionKind::Cover, Some(Direction::LeftDown)),
    );
    let c = add(
        &mut p,
        s4,
        Preset::Ellipse,
        cm(10.0, 5.0, 8.0, 6.0),
        "With the slide",
    );
    animate(&mut p, s4, c, Entrance, Effect::Fade, AfterPrevious, None);
    slide(
        &mut p,
        "Split vertical in",
        transition(TransitionKind::Split, Some(Direction::VerticalIn)),
    );
    slide(&mut p, "Cut", transition(TransitionKind::Cut, None));
    slide(
        &mut p,
        "Zoom in, advances after 2 s",
        Transition {
            advance_on_click: false,
            advance_after_ms: Some(2000),
            ..transition(TransitionKind::Zoom, Some(Direction::In))
        },
    );
    // 8–10 – the other entrance/exit and emphasis effects, motion paths
    for (title, kind) in [
        ("More entrances", Entrance),
        ("More emphasis", Emphasis),
        ("More exits", Exit),
        ("Motion paths", AnimationKind::Path),
    ] {
        let s = slide(&mut p, title, transition(TransitionKind::Fade, None));
        let effects: Vec<Effect> = Effect::ALL
            .into_iter()
            .filter(|e| {
                e.supports(kind)
                    && !matches!(
                        e,
                        Effect::Appear
                            | Effect::Fade
                            | Effect::FlyIn
                            | Effect::Wipe
                            | Effect::Zoom
                            | Effect::Spin
                            | Effect::GrowShrink
                    )
            })
            .collect();
        for (i, effect) in effects.iter().enumerate() {
            let (col, row) = (i % 6, i / 6);
            let shape = add(
                &mut p,
                s,
                Preset::Rect,
                cm(1.0 + 5.2 * col as f64, 3.0 + 3.2 * row as f64, 4.6, 2.6),
                &format!("{effect:?}"),
            );
            let mut a = Animation::new(shape, kind, *effect);
            a.id = p.alloc_id();
            a.trigger = if i % 2 == 0 { OnClick } else { AfterPrevious };
            if *effect == Effect::PathCustom {
                a.path = Some("M 0 0 C 0.05 0.1 0.1 -0.1 0.2 0 L 0.25 0.1 E".to_owned());
            }
            if *effect == Effect::Teeter {
                a.repeat = Some(Repeat::Times(2000));
            }
            p.slide_mut(s).expect("slide").animations.push(a);
        }
    }

    // 12 – a paragraph build and a trigger
    let s = slide(
        &mut p,
        "Float in by paragraph; click the star",
        transition(TransitionKind::Vortex, Some(Direction::Right)),
    );
    let mut body = Shape::text_box(cm(2.0, 3.0, 18.0, 8.0), "First point");
    if let Some(t) = body.text_mut() {
        let mut sub = TextParagraph::plain("A detail");
        sub.props.level = 1;
        t.paragraphs.push(sub);
        t.paragraphs.push(TextParagraph::plain("Second point"));
    }
    let body = p.add_shape(s, body).expect("slide exists");
    let star = add(
        &mut p,
        s,
        Preset::Ellipse,
        cm(24.0, 4.0, 4.0, 4.0),
        "Trigger",
    );
    let mut a = Animation::new(body, Entrance, Effect::Float);
    a.id = p.alloc_id();
    a.build = Some(TextBuild::by_paragraph());
    p.slide_mut(s).expect("slide").animations.push(a);
    let mut t = Animation::new(star, Emphasis, Effect::Pulse);
    t.id = p.alloc_id();
    t.start_on = Some(StartOn::Click(star));
    p.slide_mut(s).expect("slide").animations.push(t);

    // 13 and later – every other transition kind
    for kind in TransitionKind::ALL {
        if kind.is_extension() && kind != TransitionKind::Vortex {
            slide(
                &mut p,
                &format!("{kind:?}"),
                transition(kind, kind.gallery_direction()),
            );
        }
    }
    p
}

fn main() -> std::process::ExitCode {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/pptx/out/rusuite-animations.pptx"
        )
        .to_owned()
    });
    let deck = anim_deck();
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
