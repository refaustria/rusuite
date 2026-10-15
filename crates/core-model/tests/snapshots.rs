//! JSON snapshot tests pinning the serde (IPC) shape of the model types.

use core_model::{
    Color, FontFace, FontSize, Rgb, RunProperties, Theme, ThemeColorSlot, Underline, VerticalAlign,
};

#[test]
fn run_properties_full() {
    let props = RunProperties {
        font: Some(FontFace::Named("Arial".to_owned())),
        size: Some(FontSize::from_pt(10.5)),
        bold: Some(true),
        italic: Some(false),
        underline: Some(Underline::Double),
        strike: Some(true),
        color: Some(Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: -0.25,
        }),
        highlight: Some(Color::Rgb(Rgb::new(0xFF, 0xFF, 0x00))),
        vertical_align: Some(VerticalAlign::Superscript),
    };
    insta::assert_json_snapshot!(props);
    let json = serde_json::to_string(&props).unwrap();
    assert_eq!(serde_json::from_str::<RunProperties>(&json).unwrap(), props);
}

#[test]
fn run_properties_theme_font() {
    let props = RunProperties {
        font: Some(FontFace::Theme(core_model::ThemeFontSlot::MinorLatin)),
        ..Default::default()
    };
    insta::assert_json_snapshot!(props);
}

#[test]
fn theme_default() {
    let theme = Theme::default();
    insta::assert_json_snapshot!(theme);
    let json = serde_json::to_string(&theme).unwrap();
    assert_eq!(serde_json::from_str::<Theme>(&json).unwrap(), theme);
}

#[test]
fn color_auto() {
    insta::assert_json_snapshot!(Color::Auto);
}

#[test]
fn color_rgb() {
    insta::assert_json_snapshot!(Color::Rgb(Rgb::new(0x44, 0x72, 0xC4)));
}

#[test]
fn color_theme() {
    insta::assert_json_snapshot!(Color::Theme {
        slot: ThemeColorSlot::FollowedHyperlink,
        tint: 0.4,
    });
}
