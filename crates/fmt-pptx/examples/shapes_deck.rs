//! Builds a 4-slide deck with every supported preset shape, a flowchart
//! with glued connectors, a table with merged cells, and connector
//! variants, and writes it with `fmt_pptx::write`.
//!
//! ```text
//! cargo run -q -p fmt-pptx --example shapes_deck -- [out.pptx]
//! ```
//!
//! Default output: `testdata/pptx/out/rusuite-shapes.pptx` (relative to the
//! workspace root) – the file to open in PowerPoint and LibreOffice to
//! check shapes, connectors and tables. The deck is also built by
//! `tests/shapes.rs`.

use core_model::{Color, Rgb, ThemeColorSlot};
use model_show::{
    Adjust, Anchor, ArrowEnd, ArrowKind, ArrowSize, Attach, Connector, ConnectorKind, Emu, Fill,
    GeomPath, LayoutKind, Line, LineDash, NodeId, PathCmd, Presentation, Preset, Shape, TextBody,
    TextParagraph, Transform,
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

/// Adds an auto shape with PowerPoint's default style and `label`.
fn add(
    p: &mut Presentation,
    slide: NodeId,
    preset: Preset,
    adjust: &[(&str, i64)],
    t: Transform,
    label: &str,
) -> NodeId {
    let mut s = Shape::auto(preset, t);
    if let model_show::ShapeKind::Auto { adjust: a, .. } = &mut s.kind {
        *a = adjust.iter().map(|(n, v)| ((*n).to_owned(), *v)).collect();
    }
    if let Some(body) = s.text_mut() {
        let mut para = TextParagraph::plain(label);
        para.props.alignment = Some(model_show::Alignment::Center);
        body.paragraphs = vec![para];
    }
    p.add_shape(slide, s).expect("slide exists")
}

/// Adds a connector from `start` to `end` (shape, site).
fn connect(
    p: &mut Presentation,
    slide: NodeId,
    kind: ConnectorKind,
    start: (NodeId, u32),
    end: (NodeId, u32),
    tail: ArrowKind,
) -> NodeId {
    let mut c = Connector::new(kind);
    c.start = Some(Attach {
        shape: start.0,
        site: start.1,
    });
    c.end = Some(Attach {
        shape: end.0,
        site: end.1,
    });
    c.tail = ArrowEnd::new(tail);
    let mut s = Shape::connector_shape(c, Transform::default());
    s.line.width = Emu(19_050);
    p.add_shape(slide, s).expect("slide exists")
}

fn title(p: &mut Presentation, slide: NodeId, text: &str) {
    p.add_shape(slide, Shape::text_box(cm(1.0, 0.3, 30.0, 1.5), text))
        .expect("slide exists");
}

/// Slide 1: every preset in a grid, labelled with its DrawingML name.
fn gallery(p: &mut Presentation) {
    let s = p.add_slide(LayoutKind::Blank);
    title(p, s, "Preset shapes");
    for (i, preset) in Preset::ALL.iter().enumerate() {
        let (col, row) = ((i % 8) as f64, (i / 8) as f64);
        let t = cm(1.0 + col * 4.0, 2.4 + row * 3.3, 3.2, 2.4);
        let mut shape = Shape::auto(preset.clone(), t);
        if let Some(body) = shape.text_mut() {
            let mut para = TextParagraph::plain(preset.prst());
            para.props.alignment = Some(model_show::Alignment::Center);
            para.runs[0].props.size = Some(core_model::FontSize::from_pt(8.0));
            body.paragraphs = vec![para];
        }
        p.add_shape(s, shape).expect("slide exists");
    }
    // a freeform (custom geometry): a house
    let house = Preset::Custom {
        paths: vec![GeomPath {
            w: 100.0,
            h: 100.0,
            fill: true,
            stroke: true,
            commands: vec![
                PathCmd::MoveTo { x: 0.0, y: 40.0 },
                PathCmd::LineTo { x: 50.0, y: 0.0 },
                PathCmd::LineTo { x: 100.0, y: 40.0 },
                PathCmd::LineTo { x: 100.0, y: 100.0 },
                PathCmd::LineTo { x: 0.0, y: 100.0 },
                PathCmd::Close,
            ],
        }],
    };
    p.add_shape(s, Shape::auto(house, cm(29.0, 15.6, 2.4, 2.4)))
        .expect("slide exists");
}

/// Slide 2: a flowchart with glued elbow and straight connectors.
fn flowchart(p: &mut Presentation) -> NodeId {
    let s = p.add_slide(LayoutKind::Blank);
    title(p, s, "Flowchart");
    let start = add(
        p,
        s,
        Preset::FlowChartTerminator,
        &[],
        cm(2.0, 3.0, 5.0, 2.0),
        "Start",
    );
    let input = add(
        p,
        s,
        Preset::FlowChartInputOutput,
        &[],
        cm(2.0, 7.0, 5.0, 2.0),
        "Read",
    );
    let check = add(
        p,
        s,
        Preset::FlowChartDecision,
        &[],
        cm(11.0, 6.5, 6.0, 3.0),
        "OK?",
    );
    let work = add(
        p,
        s,
        Preset::FlowChartProcess,
        &[],
        cm(21.0, 7.0, 5.0, 2.0),
        "Work",
    );
    let report = add(
        p,
        s,
        Preset::FlowChartDocument,
        &[],
        cm(21.0, 12.0, 5.0, 2.5),
        "Report",
    );
    let end = add(
        p,
        s,
        Preset::FlowChartTerminator,
        &[],
        cm(11.0, 14.0, 6.0, 2.0),
        "End",
    );
    let tri = ArrowKind::Triangle;
    connect(p, s, ConnectorKind::Straight, (start, 2), (input, 0), tri);
    connect(p, s, ConnectorKind::Elbow, (input, 3), (check, 1), tri);
    connect(p, s, ConnectorKind::Straight, (check, 3), (work, 1), tri);
    connect(p, s, ConnectorKind::Elbow, (work, 2), (report, 0), tri);
    connect(p, s, ConnectorKind::Elbow, (check, 2), (end, 0), tri);
    connect(
        p,
        s,
        ConnectorKind::Curved,
        (report, 2),
        (end, 3),
        ArrowKind::Stealth,
    );
    p.reroute_connectors(s).expect("slide exists");
    s
}

/// Slide 3: a table with header row, merged cells and own formatting.
fn table(p: &mut Presentation) {
    let s = p.add_slide(LayoutKind::Blank);
    title(p, s, "Table");
    let mut shape = Shape::table(4, 3, cm(2.0, 3.0, 24.0, 8.0));
    let t = shape.table_mut().expect("table");
    let text = [
        ["Region", "Q1", "Q2"],
        ["North", "12", "15"],
        ["South", "9", "11"],
        ["Total", "21", "26"],
    ];
    for (r, row) in text.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            t.cells[r][c].text = TextBody::plain(v);
            t.cells[r][c].text.props.anchor = Anchor::Middle;
        }
    }
    t.look.last_row = true;
    t.merge(1, 0, 2, 1).expect("merge");
    t.cells[3][2].fill = Some(Fill::Solid(Color::Rgb(Rgb::new(0xFF, 0xC0, 0x00))));
    t.cells[3][2].borders.bottom = Some(Line {
        fill: Fill::Solid(Color::Rgb(Rgb::new(0xC0, 0, 0))),
        width: Emu(38_100),
        dash: LineDash::Dash,
    });
    p.add_shape(s, shape).expect("slide exists");
    // a plain grid without style
    let mut plain = Shape::table(2, 2, cm(2.0, 13.0, 10.0, 3.0));
    let t = plain.table_mut().expect("table");
    t.style_id = None;
    t.look = Default::default();
    t.cells[0][0].text = TextBody::plain("no style");
    p.add_shape(s, plain).expect("slide exists");
}

/// Slide 4: lines and connectors with arrowheads, adjusted shapes and a
/// connector inside a group.
fn connectors(p: &mut Presentation) {
    let s = p.add_slide(LayoutKind::Blank);
    title(p, s, "Lines, arrows and adjust values");
    let kinds = [
        ArrowKind::Triangle,
        ArrowKind::Stealth,
        ArrowKind::Diamond,
        ArrowKind::Oval,
        ArrowKind::Arrow,
    ];
    let sizes = [ArrowSize::Small, ArrowSize::Medium, ArrowSize::Large];
    for (i, k) in kinds.iter().enumerate() {
        let mut c = Connector::new(ConnectorKind::Straight);
        c.head = ArrowEnd {
            kind: *k,
            width: sizes[i % 3],
            length: sizes[(i + 1) % 3],
        };
        c.tail = ArrowEnd::new(kinds[(i + 2) % 5]);
        let mut sh = Shape::connector_shape(c, cm(1.0, 3.0 + i as f64 * 1.2, 8.0, 0.8));
        sh.line = Line::solid(Color::theme(ThemeColorSlot::Accent2), Emu(25_400));
        p.add_shape(s, sh).expect("slide exists");
    }
    // an unattached elbow with its middle moved, flipped
    let mut c = Connector::new(ConnectorKind::Elbow);
    c.adjust = Adjust::from([("adj1".to_owned(), 25_000)]);
    let mut sh = Shape::connector_shape(c, cm(1.0, 10.0, 8.0, 4.0));
    sh.transform.flip_v = true;
    p.add_shape(s, sh).expect("slide exists");
    // adjusted presets
    add(
        p,
        s,
        Preset::RoundRect,
        &[("adj", 45_000)],
        cm(11.0, 3.0, 5.0, 3.0),
        "round",
    );
    add(
        p,
        s,
        Preset::RightArrow,
        &[("adj1", 30_000), ("adj2", 80_000)],
        cm(17.0, 3.0, 6.0, 3.0),
        "arrow",
    );
    add(
        p,
        s,
        Preset::WedgeRoundRectCallout,
        &[("adj1", 60_000), ("adj2", -20_000), ("adj3", 30_000)],
        cm(11.0, 8.0, 6.0, 3.0),
        "callout",
    );
    add(
        p,
        s,
        Preset::Star5,
        &[("adj", 30_000)],
        cm(24.0, 3.0, 4.0, 4.0),
        "",
    );
    // a group holding two shapes and a connector between them
    let a = add(p, s, Preset::Ellipse, &[], cm(20.0, 10.0, 3.0, 3.0), "A");
    let b = add(p, s, Preset::Hexagon, &[], cm(27.0, 14.0, 3.0, 2.0), "B");
    let link = connect(
        p,
        s,
        ConnectorKind::Curved,
        (a, 6),
        (b, 1),
        ArrowKind::Triangle,
    );
    p.reroute_connectors(s).expect("slide exists");
    // group them, keeping their ids (the connector's attachments)
    let gid = p.alloc_id();
    let slide = p.slide_mut(s).expect("slide");
    let picked: Vec<Shape> = slide
        .shapes
        .iter()
        .filter(|sh| [a, b, link].contains(&sh.id))
        .cloned()
        .collect();
    slide.shapes.retain(|sh| ![a, b, link].contains(&sh.id));
    let mut group = Shape::group(picked);
    group.id = gid;
    group.name = "Linked".into();
    slide.shapes.push(group);
}

/// The deck: gallery, flowchart, table, connectors.
pub fn shapes_deck() -> Presentation {
    let mut p = Presentation::empty(model_show::SlideSize::widescreen());
    gallery(&mut p);
    flowchart(&mut p);
    table(&mut p);
    connectors(&mut p);
    p
}

fn main() -> std::process::ExitCode {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/pptx/out/rusuite-shapes.pptx"
        )
        .to_owned()
    });
    let deck = shapes_deck();
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
