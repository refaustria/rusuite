//! P9-S4: animations, transitions and media round 2 – the new options as
//! commands (undo/redo), their validation and the `.pptx` round trip.

use app_common::Host;
use core_model::media::base64_encode;
use model_show::{
    Animation, AnimationKind, Bookmark, Direction, Effect, Emu, LayoutKind, NodeId, Presentation,
    Repeat, Shape, ShapeKind, StartOn, TextBuild, TextParagraph, Transform, Transition,
    TransitionKind, TransitionOption, TransitionSound, Trigger,
};
use serde_json::Value as Json;
use show_core::{AnimationPatch, MediaPatch, ShowCommand as C, ShowDocument, ShowHost, ShowPatch};

/// One blank slide: a text box with three paragraphs (levels 0, 1, 0) and
/// a rectangle.
fn deck() -> (Presentation, NodeId, NodeId, NodeId) {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    let t = Transform::new(Emu(0), Emu(0), Emu(3_000_000), Emu(2_000_000));
    let mut text = Shape::text_box(t, "First");
    if let Some(b) = text.text_mut() {
        let mut sub = TextParagraph::plain("Detail");
        sub.props.level = 1;
        b.paragraphs.push(sub);
        b.paragraphs.push(TextParagraph::plain("Second"));
    }
    let text = p.add_shape(s, text).unwrap();
    let rect = p
        .add_shape(
            s,
            Shape::auto(
                model_show::Preset::Rect,
                Transform::new(Emu(4_000_000), Emu(0), Emu(1_000_000), Emu(1_000_000)),
            ),
        )
        .unwrap();
    (p, s, text, rect)
}

fn host() -> (ShowHost, NodeId, NodeId, NodeId) {
    let (p, s, t, r) = deck();
    (
        Host::new(ShowDocument::from_presentation(p).unwrap()),
        s,
        t,
        r,
    )
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

/// Applies `cmd`, checks that undo and redo restore the JSON exactly.
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

fn fails(h: &mut ShowHost, cmd: C) {
    let before = json_of(h);
    assert!(h.apply(cmd).is_err());
    assert_eq!(json_of(h), before);
}

fn reopened(h: &ShowHost) -> Presentation {
    let bytes = h.doc().save_pptx().unwrap();
    ShowDocument::open_pptx(&bytes, "x.pptx")
        .unwrap()
        .0
        .into_presentation()
}

fn slide_xml(h: &ShowHost) -> String {
    let bytes = h.doc().save_pptx().unwrap();
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes)).unwrap();
    let part = pkg
        .part(&fmt_ooxml::PartName::new("/ppt/slides/slide2.xml").unwrap())
        .unwrap();
    String::from_utf8(part.data.clone()).unwrap()
}

fn add(h: &mut ShowHost, slide: NodeId, a: Animation, new_id: i64) -> NodeId {
    let p = apply(
        h,
        C::AddAnimation {
            slide,
            animation: a,
            new_id,
            index: None,
        },
    );
    p.id_map[0].1
}

fn anims(h: &ShowHost, slide: NodeId) -> Vec<Animation> {
    h.doc()
        .presentation()
        .slide(slide)
        .unwrap()
        .animations
        .clone()
}

/// Shapes keep their ids through a save, animations get new ones.
fn same_but_ids(a: &[Animation], b: &[Animation]) {
    let strip = |v: &[Animation]| -> Vec<Animation> {
        v.iter()
            .map(|a| Animation {
                id: NodeId(0),
                ..a.clone()
            })
            .collect()
    };
    assert_eq!(strip(a), strip(b));
}

#[test]
fn float_in_by_paragraph_is_saved_as_a_paragraph_build() {
    let (mut h, s, text, _) = host();
    let mut a = Animation::new(text, AnimationKind::Entrance, Effect::Float);
    a.build = Some(TextBuild::by_paragraph());
    add(&mut h, s, a, -1);
    let xml = slide_xml(&h);
    assert!(xml.contains(r#"build="p""#), "{xml}");
    // three paragraphs, three behaviors each
    assert_eq!(xml.matches("<p:pRg ").count(), 9);
    assert_eq!(
        xml.matches(r#"presetID="42" presetClass="entr""#).count(),
        3
    );
    let back = reopened(&h);
    let shape_back = &back.slides[1].shapes[0];
    same_but_ids(
        &back.slides[1].animations,
        &[Animation {
            shape: shape_back.id,
            ..anims(&h, s)[0].clone()
        }],
    );
}

#[test]
fn motion_paths_and_emphasis_options_round_trip() {
    let (mut h, s, text, rect) = host();
    let mut path = Animation::new(rect, AnimationKind::Path, Effect::PathCustom);
    path.path = Some("M 0 0 C 0.1 0.2 0.2 0.2 0.3 0 L 0.4 0.1 E".into());
    let id = add(&mut h, s, path, -1);
    // editing a handle sends the whole path
    apply(
        &mut h,
        C::UpdateAnimation {
            id,
            patch: AnimationPatch {
                path: Some(Some("M 0 0 L 0.5 0.5 E".into())),
                ..Default::default()
            },
        },
    );
    let mut spin = Animation::new(text, AnimationKind::Emphasis, Effect::Spin);
    spin.amount = Some(-180);
    spin.auto_reverse = true;
    spin.repeat = Some(Repeat::Times(2000));
    spin.trigger = Trigger::AfterPrevious;
    add(&mut h, s, spin, -2);
    let mut color = Animation::new(rect, AnimationKind::Emphasis, Effect::FillColor);
    color.color = Some("00B050".into());
    color.rewind = true;
    add(&mut h, s, color, -3);
    let xml = slide_xml(&h);
    assert!(xml.contains(r#"path="M 0 0 L 0.5 0.5 E""#), "{xml}");
    let back = reopened(&h);
    same_but_ids(&back.slides[1].animations, &anims(&h, s));
    // a bad path, colour or amount is refused
    for patch in [
        AnimationPatch {
            path: Some(Some("L 1 2".into())),
            ..Default::default()
        },
        AnimationPatch {
            amount: Some(Some(7)),
            ..Default::default()
        },
        AnimationPatch {
            color: Some(Some("00B050".into())),
            ..Default::default()
        },
    ] {
        fails(&mut h, C::UpdateAnimation { id, patch });
    }
}

#[test]
fn changing_the_effect_drops_options_it_does_not_take() {
    let (mut h, s, _, rect) = host();
    let mut a = Animation::new(rect, AnimationKind::Emphasis, Effect::Transparency);
    a.amount = Some(80);
    let id = add(&mut h, s, a, -1);
    apply(
        &mut h,
        C::UpdateAnimation {
            id,
            patch: AnimationPatch {
                effect: Some(Effect::FontColor),
                ..Default::default()
            },
        },
    );
    let a = &anims(&h, s)[0];
    assert_eq!(
        (a.effect, a.amount, a.color.as_deref()),
        (Effect::FontColor, None, None)
    );
}

#[test]
fn triggers_are_validated_saved_and_pruned() {
    let (mut h, s, text, rect) = host();
    let mut a = Animation::new(text, AnimationKind::Entrance, Effect::Fade);
    a.start_on = Some(StartOn::Click(rect));
    add(&mut h, s, a, -1);
    // a trigger shape on another slide
    let mut bad = Animation::new(text, AnimationKind::Entrance, Effect::Fade);
    bad.start_on = Some(StartOn::Click(NodeId(999)));
    fails(
        &mut h,
        C::AddAnimation {
            slide: s,
            animation: bad,
            new_id: -2,
            index: None,
        },
    );
    // a bookmark the rect does not have (it is no clip)
    let mut bmk = Animation::new(text, AnimationKind::Exit, Effect::Fade);
    bmk.start_on = Some(StartOn::Bookmark {
        shape: rect,
        name: "Bookmark 1".into(),
    });
    fails(
        &mut h,
        C::AddAnimation {
            slide: s,
            animation: bmk,
            new_id: -2,
            index: None,
        },
    );
    let xml = slide_xml(&h);
    assert!(xml.contains(r#"nodeType="interactiveSeq""#), "{xml}");
    let back = reopened(&h);
    assert_eq!(
        back.slides[1].animations[0].start_on,
        Some(StartOn::Click(rect))
    );
    // deleting the trigger shape removes the triggered animation
    apply(&mut h, C::DeleteShapes { ids: vec![rect] });
    assert!(anims(&h, s).is_empty());
}

#[test]
fn set_animation_order_reorders_and_checks_the_permutation() {
    let (mut h, s, text, rect) = host();
    let a = add(
        &mut h,
        s,
        Animation::new(text, AnimationKind::Entrance, Effect::Fade),
        -1,
    );
    let b = add(
        &mut h,
        s,
        Animation::new(rect, AnimationKind::Entrance, Effect::Appear),
        -2,
    );
    let c = add(
        &mut h,
        s,
        Animation {
            trigger: Trigger::WithPrevious,
            ..Animation::new(rect, AnimationKind::Emphasis, Effect::Pulse)
        },
        -3,
    );
    apply(
        &mut h,
        C::SetAnimationOrder {
            slide: s,
            order: vec![b, c, a],
        },
    );
    assert_eq!(
        anims(&h, s).iter().map(|x| x.id).collect::<Vec<_>>(),
        [b, c, a]
    );
    fails(
        &mut h,
        C::SetAnimationOrder {
            slide: s,
            order: vec![b, a],
        },
    );
    fails(
        &mut h,
        C::SetAnimationOrder {
            slide: s,
            order: vec![b, a, a],
        },
    );
}

#[test]
fn p14_transitions_and_sounds_round_trip() {
    let (mut h, s, _, _) = host();
    let mut cube = Transition::new(TransitionKind::Cube);
    cube.direction = Some(Direction::Up);
    apply(
        &mut h,
        C::SetTransition {
            slides: vec![s],
            transition: Some(cube),
        },
    );
    apply(
        &mut h,
        C::SetTransitionSound {
            slides: vec![s],
            content_type: Some("audio/wav".into()),
            bytes_base64: Some(base64_encode(b"RIFF\x24\0\0\0WAVEfmt ")),
            stop_previous: false,
            loop_until_next: true,
        },
    );
    let xml = slide_xml(&h);
    assert!(
        xml.contains(r#"<p14:prism dir="u"/><p:sndAc><p:stSnd loop="1"><p:snd r:embed="#),
        "{xml}"
    );
    let back = reopened(&h);
    let t = back.slides[1].transition.unwrap();
    assert_eq!(
        (t.kind, t.direction),
        (TransitionKind::Cube, Some(Direction::Up))
    );
    match t.sound {
        Some(TransitionSound::Play {
            media,
            loop_until_next: true,
        }) => assert_eq!(back.media.get(media).unwrap().content_type, "audio/wav"),
        other => panic!("{other:?}"),
    }
    // Apply To All copies the sound; Stop Previous on a slide without one
    let mut glitter = Transition::new(TransitionKind::Glitter);
    glitter.option = Some(TransitionOption::Hexagons);
    let sound = h
        .doc()
        .presentation()
        .slide(s)
        .unwrap()
        .transition
        .unwrap()
        .sound;
    apply(
        &mut h,
        C::SetTransition {
            slides: vec![s],
            transition: Some(Transition { sound, ..glitter }),
        },
    );
    apply(&mut h, C::ApplyTransitionToAll { from: s });
    let first = h.doc().presentation().slides[0].id;
    assert_eq!(
        h.doc().presentation().slides[0].transition.unwrap().kind,
        TransitionKind::Glitter
    );
    apply(
        &mut h,
        C::SetTransitionSound {
            slides: vec![first],
            content_type: None,
            bytes_base64: None,
            stop_previous: true,
            loop_until_next: false,
        },
    );
    let back = reopened(&h);
    assert_eq!(
        back.slides[0].transition.unwrap().sound,
        Some(TransitionSound::StopPrevious)
    );
    assert_eq!(
        back.slides[1].transition.unwrap().option,
        Some(TransitionOption::Hexagons)
    );
    // a sound that is no audio
    fails(
        &mut h,
        C::SetTransitionSound {
            slides: vec![s],
            content_type: Some("image/png".into()),
            bytes_base64: Some(base64_encode(b"x")),
            stop_previous: false,
            loop_until_next: false,
        },
    );
}

#[test]
fn media_trim_fade_bookmarks_and_commands_round_trip() {
    let (mut h, s, text, _) = host();
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
    let clip = p.id_map[0].1;
    apply(
        &mut h,
        C::SetMediaProps {
            shapes: vec![clip],
            patch: MediaPatch {
                trim_start_ms: Some(1000),
                trim_end_ms: Some(500),
                fade_in_ms: Some(250),
                fade_out_ms: Some(750),
                play_across_slides: Some(true),
                rewind: Some(true),
                bookmarks: Some(vec![
                    Bookmark {
                        name: "Bookmark 2".into(),
                        time_ms: 2500,
                    },
                    Bookmark {
                        name: "Bookmark 1".into(),
                        time_ms: 1500,
                    },
                ]),
                ..Default::default()
            },
        },
    );
    // bookmarks are kept in time order
    let names: Vec<String> = match &h.doc().presentation().find_shape(clip).unwrap().1.kind {
        ShapeKind::Media(m) => m.bookmarks.iter().map(|b| b.name.clone()).collect(),
        _ => unreachable!(),
    };
    assert_eq!(names, ["Bookmark 1", "Bookmark 2"]);
    // an exit on the bookmark, a pause of the clip
    let mut on_bmk = Animation::new(text, AnimationKind::Exit, Effect::Fade);
    on_bmk.start_on = Some(StartOn::Bookmark {
        shape: clip,
        name: "Bookmark 1".into(),
    });
    add(&mut h, s, on_bmk, -2);
    add(
        &mut h,
        s,
        Animation::new(clip, AnimationKind::Media, Effect::MediaPause),
        -3,
    );
    // a media command on a shape that is no clip
    fails(
        &mut h,
        C::AddAnimation {
            slide: s,
            animation: Animation::new(text, AnimationKind::Media, Effect::MediaStop),
            new_id: -4,
            index: None,
        },
    );
    let xml = slide_xml(&h);
    for want in [
        r#"<p14:trim st="1000" end="500"/>"#,
        r#"<p14:fade in="250" out="750"/>"#,
        r#"<p14:bmk name="Bookmark 1" time="1500"/>"#,
        r#"p14:bmkName="Bookmark 1""#,
        r#"cmd="togglePause""#,
        r#"numSld="999""#,
    ] {
        assert!(xml.contains(want), "{want}\n{xml}");
    }
    let back = reopened(&h);
    let shape = back.slides[1]
        .shapes
        .iter()
        .find(|s| matches!(s.kind, ShapeKind::Media(_)))
        .unwrap();
    let ShapeKind::Media(m) = &shape.kind else {
        unreachable!()
    };
    assert_eq!(
        (m.trim_start_ms, m.trim_end_ms, m.fade_in_ms, m.fade_out_ms),
        (1000, 500, 250, 750)
    );
    assert!(m.play_across_slides && m.rewind);
    assert_eq!(m.bookmarks.len(), 2);
    same_but_ids(&back.slides[1].animations, &anims(&h, s));
    // removing the bookmark removes the animation it triggers
    apply(
        &mut h,
        C::SetMediaProps {
            shapes: vec![clip],
            patch: MediaPatch {
                bookmarks: Some(vec![]),
                ..Default::default()
            },
        },
    );
    assert_eq!(anims(&h, s).len(), 1);
    // duplicate bookmark names are refused
    fails(
        &mut h,
        C::SetMediaProps {
            shapes: vec![clip],
            patch: MediaPatch {
                bookmarks: Some(vec![
                    Bookmark {
                        name: "A".into(),
                        time_ms: 1,
                    },
                    Bookmark {
                        name: "A".into(),
                        time_ms: 2,
                    },
                ]),
                ..Default::default()
            },
        },
    );
}
