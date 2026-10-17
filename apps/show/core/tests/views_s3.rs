//! P9-S3: custom shows, Set Up Slide Show options, backgrounds, guides
//! and the saved view – commands, undo and the `.pptx` round trip.

use app_common::Host;
use model_show::{
    CustomShow, Emu, Hyperlink, LayoutKind, LinkTarget, NodeId, Presentation, Shape, ShowSettings,
    ShowType, Transform,
};
use serde_json::Value as Json;
use show_core::{ShowCommand as C, ShowDocument, ShowHost, ShowPatch};

fn deck() -> Presentation {
    let mut p = Presentation::new();
    for _ in 0..3 {
        let s = p.add_slide(LayoutKind::Blank);
        let t = Transform::new(Emu(0), Emu(0), Emu(914_400), Emu(457_200));
        p.add_shape(s, Shape::text_box(t, "Hello")).unwrap();
    }
    p
}

fn host() -> ShowHost {
    Host::new(ShowDocument::from_presentation(deck()).unwrap())
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

fn reopened(h: &ShowHost) -> Presentation {
    let bytes = h.doc().save_pptx().unwrap();
    ShowDocument::open_pptx(&bytes, "x.pptx")
        .unwrap()
        .0
        .into_presentation()
}

fn slide_ids(h: &ShowHost) -> Vec<NodeId> {
    h.doc().presentation().slides.iter().map(|s| s.id).collect()
}

fn show(id: u32, name: &str, slides: Vec<NodeId>) -> CustomShow {
    CustomShow {
        id,
        name: name.into(),
        slide_ids: slides,
    }
}

#[test]
fn custom_shows_are_a_command_and_saved_in_order() {
    let mut h = host();
    let ids = slide_ids(&h);
    let shows = vec![
        show(0, "Short", vec![ids[3], ids[1]]),
        show(5, "Repeat", vec![ids[2], ids[2]]),
    ];
    let p = apply(
        &mut h,
        C::SetCustomShows {
            shows: shows.clone(),
        },
    );
    assert_eq!(p.custom_shows.as_ref(), Some(&shows));
    let back = reopened(&h);
    let new_ids: Vec<NodeId> = back.slides.iter().map(|s| s.id).collect();
    assert_eq!(back.custom_shows.len(), 2);
    assert_eq!(back.custom_shows[0].name, "Short");
    assert_eq!(back.custom_shows[0].slide_ids, vec![new_ids[3], new_ids[1]]);
    assert_eq!(back.custom_shows[1].id, 5);
    assert_eq!(back.custom_shows[1].slide_ids, vec![new_ids[2], new_ids[2]]);
    // the XML: rIds of the slides in show order
    let bytes = h.doc().save_pptx().unwrap();
    let xml = zip_text(&bytes, "ppt/presentation.xml");
    assert!(
        xml.contains(r#"<p:custShow name="Short" id="0"><p:sldLst><p:sld r:id="rId5"/><p:sld r:id="rId3"/></p:sldLst></p:custShow>"#),
        "{xml}"
    );
}

#[test]
fn custom_shows_are_validated() {
    let mut h = host();
    let ids = slide_ids(&h);
    let dup = vec![show(0, "A", vec![]), show(0, "B", vec![])];
    assert!(h.apply(C::SetCustomShows { shows: dup }).is_err());
    let unknown = vec![show(0, "A", vec![NodeId(9999)])];
    assert!(h.apply(C::SetCustomShows { shows: unknown }).is_err());
    let names = vec![show(0, "A", vec![ids[0]]), show(1, "a", vec![])];
    assert!(h.apply(C::SetCustomShows { shows: names }).is_err());
    // Set Up Slide Show cannot name a show that does not exist
    let settings = ShowSettings {
        custom_show: Some(3),
        ..ShowSettings::default()
    };
    assert!(h.apply(C::SetShowSettings { settings }).is_err());
}

#[test]
fn deleting_a_slide_removes_it_from_custom_shows_and_undo_restores() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(0, "S", vec![ids[1], ids[2]])],
    })
    .unwrap();
    let p = apply(&mut h, C::DeleteSlides { ids: vec![ids[1]] });
    assert_eq!(p.custom_shows.unwrap()[0].slide_ids, vec![ids[2]]);
    h.undo().unwrap();
    assert_eq!(
        h.doc().presentation().custom_shows[0].slide_ids,
        vec![ids[1], ids[2]]
    );
}

#[test]
fn removing_the_set_up_show_resets_it() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(2, "S", vec![ids[0]])],
    })
    .unwrap();
    h.apply(C::SetShowSettings {
        settings: ShowSettings {
            custom_show: Some(2),
            ..ShowSettings::default()
        },
    })
    .unwrap();
    let p = apply(&mut h, C::SetCustomShows { shows: vec![] });
    assert_eq!(p.show_settings.unwrap().custom_show, None);
    h.undo().unwrap();
    assert_eq!(h.doc().presentation().show_settings.custom_show, Some(2));
}

#[test]
fn set_up_show_options_round_trip() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(1, "Kiosk loop", vec![ids[2], ids[0]])],
    })
    .unwrap();
    let settings = ShowSettings {
        loop_show: true,
        show_type: ShowType::Kiosk,
        custom_show: Some(1),
        pen_color: Some("0070C0".into()),
        without_animation: true,
        ..ShowSettings::default()
    };
    let p = apply(
        &mut h,
        C::SetShowSettings {
            settings: settings.clone(),
        },
    );
    assert_eq!(p.show_settings, Some(settings.clone()));
    assert_eq!(reopened(&h).show_settings, settings);
    let window = ShowSettings {
        show_type: ShowType::Window,
        show_scrollbar: false,
        ..ShowSettings::default()
    };
    h.apply(C::SetShowSettings {
        settings: window.clone(),
    })
    .unwrap();
    assert_eq!(reopened(&h).show_settings, window);
    let bad = ShowSettings {
        pen_color: Some("#00f".into()),
        ..ShowSettings::default()
    };
    assert!(h.apply(C::SetShowSettings { settings: bad }).is_err());
}

#[test]
fn links_to_custom_shows_round_trip() {
    let mut h = host();
    let ids = slide_ids(&h);
    h.apply(C::SetCustomShows {
        shows: vec![show(4, "Details", vec![ids[3]])],
    })
    .unwrap();
    let shape = h.doc().presentation().slides[1].shapes[0].id;
    let link = Hyperlink {
        target: LinkTarget::CustomShow {
            id: 4,
            return_after: true,
        },
        tooltip: None,
    };
    h.apply(C::SetClickAction {
        shapes: vec![shape],
        action: Some(link.clone()),
    })
    .unwrap();
    let back = reopened(&h);
    assert_eq!(back.slides[1].shapes[0].click_action, Some(link));
}

/// The text of a part of a package (`name` with a leading `/`).
fn zip_text(bytes: &[u8], name: &str) -> String {
    let pkg = fmt_ooxml::Package::open(std::io::Cursor::new(bytes)).unwrap();
    let part = pkg
        .part(&fmt_ooxml::PartName::new(format!("/{name}")).unwrap())
        .unwrap();
    String::from_utf8(part.data.clone()).unwrap()
}
