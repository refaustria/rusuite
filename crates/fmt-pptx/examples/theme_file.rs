//! Builds the theme file `testdata/pptx/rusuite-harbor.thmx` (P9-S5): the
//! built-in Harbor theme (colours, fonts, format scheme) with a named
//! master ("Harbor"), its dark background, a decorative accent bar, the
//! eleven standard layouts and a custom layout "Quote", written with
//! `fmt_pptx::write_thmx` – the file Design › Browse for Themes reads in
//! the tests and the e2e suite.
//!
//! ```text
//! cargo run -q -p fmt-pptx --example theme_file -- [out.thmx]
//! ```

use model_show::{
    builtin_theme, Emu, Fill, Layout, LayoutKind, Presentation, Preset, Shape, Transform,
};

fn main() {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/pptx/rusuite-harbor.thmx"
        )
        .to_owned()
    });
    let mut p = Presentation::new();
    let b = builtin_theme("harbor").expect("harbor");
    p.theme = b.theme;
    p.master.name = "Harbor".into();
    p.master.background = b.background;
    let size = p.slide_size;
    let mut bar = Shape::auto(
        Preset::Rect,
        Transform::new(
            Emu(0),
            Emu(size.height.0 - 228_600),
            size.width,
            Emu(228_600),
        ),
    );
    bar.name = "Accent bar".into();
    bar.fill = Fill::Solid(core_model::Color::theme(
        core_model::ThemeColorSlot::Accent2,
    ));
    bar.line.fill = Fill::None;
    p.assign_ids(&mut bar);
    p.master.shapes.push(bar);
    p.layouts = LayoutKind::STANDARD
        .iter()
        .map(|k| Layout::from_master(k.clone(), &p.master, size))
        .collect();
    let mut quote = Layout::from_master(LayoutKind::TitleOnly, &p.master, size);
    quote.kind = LayoutKind::Custom("Quote".into());
    p.layouts.push(quote);
    let bytes = fmt_pptx::write_thmx(&p).expect("thmx");
    std::fs::write(&out, bytes).expect("write");
    println!("{out}");
}
