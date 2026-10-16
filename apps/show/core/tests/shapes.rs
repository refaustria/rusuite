//! Shape library, connectors and tables through the command API: every
//! command is checked for undo → before and redo → after.

use app_common::Host;
use core_model::{Color, Rgb};
use model_show::{
    Adjust, Anchor, ArrowEnd, ArrowKind, Attach, ConnectorKind, Emu, Fill, LayoutKind, Line,
    NodeId, Presentation, Preset, Shape, ShapeKind, Table, TableLook, TextBody, Transform,
};
use serde_json::{json, Value as Json};
use show_core::{
    dispatch_with, ConnectorPatch, NewAttach, NewConnector, NewShape, NewShapeKind,
    ShowCommand as C, ShowDocument, ShowHost, TableCellPatch,
};

fn tr(x: i64, y: i64, w: i64, h: i64) -> Transform {
    Transform::new(Emu(x), Emu(y), Emu(w), Emu(h))
}

fn id(n: u64) -> NodeId {
    NodeId(n)
}

/// Slide 1: title slide (1; 2, 3). Slide 4: blank with rects 5 (0,0
/// 100×100) and 6 (300,300 100×100).
fn host() -> ShowHost {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    for t in [tr(0, 0, 100, 100), tr(300, 300, 100, 100)] {
        p.add_shape(s, Shape::auto(Preset::Rect, t)).unwrap();
    }
    Host::new(ShowDocument::from_presentation(p).unwrap())
}

fn json_of(h: &ShowHost) -> Json {
    serde_json::to_value(h.doc().presentation()).unwrap()
}

fn shape(h: &ShowHost, n: u64) -> &Shape {
    h.doc().presentation().find_shape(id(n)).unwrap().1
}

fn table(h: &ShowHost, n: u64) -> &Table {
    shape(h, n).table_data().unwrap()
}

/// Applies `cmd`, checks undo → before, redo → after, leaves it applied.
fn apply(h: &mut ShowHost, cmd: C) -> show_core::ShowPatch {
    let before = json_of(h);
    let patch = h.apply(cmd.clone()).unwrap().patch;
    let after = json_of(h);
    h.undo().unwrap().unwrap();
    assert_eq!(json_of(h), before, "undo of {cmd:?}");
    h.redo().unwrap().unwrap();
    assert_eq!(json_of(h), after, "redo of {cmd:?}");
    patch
}

fn err_code(h: &mut ShowHost, cmd: C) -> &'static str {
    let before = json_of(h);
    let e = h.apply(cmd).unwrap_err();
    assert_eq!(
        json_of(h),
        before,
        "failed command changed the presentation"
    );
    e.code()
}

fn new_shape(temp: i64, kind: NewShapeKind, t: Transform) -> NewShape {
    let mut ns = NewShape::from(&Shape::auto(Preset::Rect, t));
    ns.id = temp;
    ns.kind = kind;
    ns
}

fn ends(h: &ShowHost, n: u64) -> ((f64, f64), (f64, f64)) {
    shape(h, n).transform.line_ends()
}

#[test]
fn presets_and_adjust_values() {
    let mut h = host();
    let kind = NewShapeKind::Auto {
        geometry: Preset::WedgeRectCallout,
        adjust: Adjust::from([("adj1".to_owned(), 40_000)]),
        text: Some(TextBody::plain("Hi")),
    };
    let p = apply(
        &mut h,
        C::AddShape {
            slide: id(4),
            shape: new_shape(-1, kind, tr(500, 0, 200, 100)),
            index: None,
        },
    );
    assert_eq!(p.id_map, [(-1, id(7))]);
    assert_eq!(shape(&h, 7).name, "Rectangular Callout 7");
    // adjust, then change the preset (adjust values reset)
    apply(
        &mut h,
        C::SetGeometry {
            shapes: vec![id(7)],
            geometry: None,
            adjust: Some(Adjust::from([("adj2".to_owned(), -70_000)])),
        },
    );
    assert!(
        matches!(&shape(&h, 7).kind, ShapeKind::Auto { adjust, .. } if adjust["adj2"] == -70_000 && adjust.len() == 1)
    );
    apply(
        &mut h,
        C::SetGeometry {
            shapes: vec![id(7), id(5)],
            geometry: Some(Preset::Star5),
            adjust: None,
        },
    );
    assert!(
        matches!(&shape(&h, 7).kind, ShapeKind::Auto { geometry: Preset::Star5, adjust, .. } if adjust.is_empty())
    );
    let bad = C::SetGeometry {
        shapes: vec![id(7)],
        geometry: None,
        adjust: Some(Adjust::from([("adj9".to_owned(), 1)])),
    };
    assert_eq!(err_code(&mut h, bad), "invalid_command");

    // outlines for the renderer
    let reply = dispatch_with(
        &mut h,
        &json!({"type": "shapePaths", "queries": [
            {"kind": {"kind": "preset", "value": "ellipse"}, "w": 200.0, "h": 100.0},
            {"kind": {"kind": "preset", "value": "rightArrow"}, "w": 200.0, "h": 100.0, "adjust": {"adj2": 0}},
            {"kind": {"kind": "connector", "value": {"kind": "elbow"}}, "w": 100.0, "h": 50.0},
            {"kind": {"kind": "connector", "value": {"kind": "curved", "bends": 1}}, "w": 100.0, "h": 50.0}
        ]})
        .to_string(),
    );
    let v: Json = serde_json::from_str(&reply).unwrap();
    let shapes = &v["ok"]["shapes"];
    let ellipse = &shapes[0]["paths"][0]["commands"];
    assert_eq!(ellipse[0], json!({"kind": "moveTo", "x": 0.0, "y": 50.0}));
    assert!(ellipse
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["kind"] != "arcTo"));
    assert_eq!(shapes[0]["sites"].as_array().unwrap().len(), 9);
    assert_eq!(
        shapes[1]["paths"][0]["commands"][2],
        json!({"kind": "lineTo", "x": 200.0, "y": 0.0})
    );
    assert_eq!(shapes[2]["paths"][0]["fill"], json!(false));
    assert_eq!(
        shapes[2]["paths"][0]["commands"].as_array().unwrap().len(),
        4
    );
    assert_eq!(
        shapes[3]["paths"][0]["commands"][1]["kind"],
        json!("cubicTo")
    );
}

/// Adds rects -1/-2 and a connector -3 between them in one command.
fn glued(h: &mut ShowHost, kind: ConnectorKind) {
    let auto = || NewShapeKind::Auto {
        geometry: Preset::Rect,
        adjust: Adjust::new(),
        text: None,
    };
    let conn = NewShapeKind::Connector(NewConnector {
        kind,
        start: Some(NewAttach { shape: -1, site: 3 }),
        end: Some(NewAttach { shape: -2, site: 1 }),
        tail: ArrowEnd::new(ArrowKind::Triangle),
        ..Default::default()
    });
    let add = |shape| C::AddShape {
        slide: id(4),
        shape,
        index: None,
    };
    let p = apply(
        h,
        C::Compound {
            commands: vec![
                add(new_shape(-1, auto(), tr(1000, 1000, 100, 100))),
                add(new_shape(-2, auto(), tr(1500, 1200, 100, 100))),
                add(new_shape(-3, conn, Transform::default())),
            ],
        },
    );
    assert_eq!(p.id_map, [(-1, id(7)), (-2, id(8)), (-3, id(9))]);
}

#[test]
fn connectors_follow_their_shapes() {
    let mut h = host();
    glued(&mut h, ConnectorKind::Elbow);
    let c = shape(&h, 9).connector().unwrap();
    assert_eq!(
        c.start,
        Some(Attach {
            shape: id(7),
            site: 3
        })
    );
    assert_eq!(shape(&h, 9).name, "Elbow Connector 9");
    // routed when added: right of 7 → left of 8
    assert_eq!(ends(&h, 9), ((1100.0, 1050.0), (1500.0, 1250.0)));
    // moving a target reroutes the connector (and the patch carries it)
    let p = apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(8), tr(1500, 2000, 100, 100))],
        },
    );
    assert_eq!(p.slides.len(), 1);
    assert_eq!(ends(&h, 9), ((1100.0, 1050.0), (1500.0, 2050.0)));
    // aligning, grouping and ungrouping keep it glued
    apply(
        &mut h,
        C::Align {
            shapes: vec![id(7), id(8)],
            mode: model_show::AlignMode::Top,
            to: show_core::AlignTarget::Selection,
        },
    );
    assert_eq!(ends(&h, 9), ((1100.0, 1050.0), (1500.0, 1050.0)));
    apply(
        &mut h,
        C::Group {
            shapes: vec![id(7), id(8), id(9)],
            new_id: -1,
        },
    );
    let mut g = shape(&h, 10).transform;
    g.x.0 += 1_000;
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(10), g)],
        },
    );
    let slide = h.doc().presentation().slide(id(4)).unwrap();
    let abs = slide.absolute_transform(id(9)).unwrap();
    assert_eq!(abs.line_ends(), ((2100.0, 1050.0), (2500.0, 1050.0)));
    apply(&mut h, C::Ungroup { group: id(10) });
    assert_eq!(ends(&h, 9), ((2100.0, 1050.0), (2500.0, 1050.0)));
    // arrowheads and kind
    apply(
        &mut h,
        C::SetConnector {
            shape: id(9),
            patch: ConnectorPatch {
                kind: Some(ConnectorKind::Curved),
                head: Some(ArrowEnd::new(ArrowKind::Oval)),
                ..Default::default()
            },
        },
    );
    let c = shape(&h, 9).connector().unwrap();
    assert_eq!(
        (c.kind, c.head.kind),
        (ConnectorKind::Curved, ArrowKind::Oval)
    );
    // re-glue the end to the bottom of 5: the connector moves there
    apply(
        &mut h,
        C::SetConnector {
            shape: id(9),
            patch: ConnectorPatch {
                end: Some(Some(Attach {
                    shape: id(5),
                    site: 2,
                })),
                ..Default::default()
            },
        },
    );
    assert_eq!(ends(&h, 9).1, (50.0, 100.0));
    // invalid attachments are refused
    let bad = C::SetConnector {
        shape: id(9),
        patch: ConnectorPatch {
            start: Some(Some(Attach {
                shape: id(9),
                site: 0,
            })),
            ..Default::default()
        },
    };
    assert_eq!(err_code(&mut h, bad), "invalid_command");
    let bad = C::SetConnector {
        shape: id(2),
        patch: ConnectorPatch::default(),
    };
    assert_eq!(err_code(&mut h, bad), "invalid_command");
    // moving the connector itself lets go of shapes that stayed
    let moved = {
        let mut t = shape(&h, 9).transform;
        t.y.0 += 5_000;
        t
    };
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(9), moved)],
        },
    );
    let c = shape(&h, 9).connector().unwrap();
    assert_eq!((c.start, c.end), (None, None));
    assert_eq!(shape(&h, 9).transform, moved);
}

#[test]
fn deleting_and_copying_glued_shapes() {
    let mut h = host();
    glued(&mut h, ConnectorKind::Straight);
    // a copied slide's connector is glued to the copies
    apply(
        &mut h,
        C::DuplicateSlide {
            id: id(4),
            new_ids: vec![],
        },
    );
    let p = h.doc().presentation();
    let copy = &p.slides[2];
    let c = copy.shapes[4].connector().unwrap();
    assert_eq!(c.start.unwrap().shape, copy.shapes[2].id);
    assert_eq!(c.end.unwrap().shape, copy.shapes[3].id);
    // deleting a target detaches the end; the line stays where it was
    let before = ends(&h, 9);
    apply(&mut h, C::DeleteShapes { ids: vec![id(8)] });
    let c = shape(&h, 9).connector().unwrap();
    assert_eq!((c.start.is_some(), c.end), (true, None));
    assert_eq!(ends(&h, 9), before);
    // connectors glued to unknown shapes cannot be added
    let conn = NewShapeKind::Connector(NewConnector {
        start: Some(NewAttach { shape: 2, site: 0 }),
        ..Default::default()
    });
    let add = C::AddShape {
        slide: id(4),
        shape: new_shape(-1, conn, Transform::default()),
        index: None,
    };
    assert_eq!(err_code(&mut h, add), "invalid_command");
    // nor with unresolved temporary ids
    let conn = NewShapeKind::Connector(NewConnector {
        start: Some(NewAttach { shape: -7, site: 0 }),
        ..Default::default()
    });
    let add = C::AddShape {
        slide: id(4),
        shape: new_shape(-1, conn, Transform::default()),
        index: None,
    };
    assert_eq!(err_code(&mut h, add), "invalid_command");
}

#[test]
fn table_commands() {
    let mut h = host();
    let p = apply(
        &mut h,
        C::InsertTable {
            slide: id(4),
            rows: 3,
            cols: 2,
            transform: None,
            new_id: -1,
        },
    );
    assert_eq!(p.id_map, [(-1, id(7))]);
    let s = shape(&h, 7);
    assert_eq!(s.name, "Table 7");
    assert_eq!(s.transform, tr(2_032_000, 2_872_740, 8_128_000, 1_112_520));
    assert_eq!(table(&h, 7).cols[0].width, Emu(4_064_000));
    assert_eq!(
        table(&h, 7).look,
        TableLook {
            first_row: true,
            band_rows: true,
            ..Default::default()
        }
    );

    let mut body = TextBody::plain("Head");
    body.props.anchor = Anchor::Bottom; // ignored: the cell keeps its own
    apply(
        &mut h,
        C::SetTableCellText {
            shape: id(7),
            row: 0,
            col: 0,
            body,
        },
    );
    assert_eq!(table(&h, 7).cells[0][0].text.plain_text(), "Head");
    assert_eq!(table(&h, 7).cells[0][0].text.props.anchor, Anchor::Top);

    apply(
        &mut h,
        C::InsertTableRow {
            shape: id(7),
            index: 1,
        },
    );
    assert_eq!(table(&h, 7).row_count(), 4);
    assert_eq!(shape(&h, 7).transform.h, Emu(1_483_360));
    apply(
        &mut h,
        C::InsertTableCol {
            shape: id(7),
            index: 0,
        },
    );
    assert_eq!(shape(&h, 7).transform.w, Emu(12_192_000));
    apply(
        &mut h,
        C::DeleteTableCol {
            shape: id(7),
            index: 2,
        },
    );
    apply(
        &mut h,
        C::DeleteTableRow {
            shape: id(7),
            index: 3,
        },
    );
    assert_eq!((table(&h, 7).row_count(), table(&h, 7).col_count()), (3, 2));
    assert_eq!(shape(&h, 7).transform.h, Emu(1_112_520));

    apply(
        &mut h,
        C::MergeTableCells {
            shape: id(7),
            row: 0,
            col: 0,
            row_span: 2,
            col_span: 2,
        },
    );
    assert_eq!(table(&h, 7).cells[0][0].row_span, 2);
    let covered = C::SetTableCellText {
        shape: id(7),
        row: 1,
        col: 1,
        body: TextBody::plain("x"),
    };
    assert_eq!(err_code(&mut h, covered), "invalid_command");
    apply(
        &mut h,
        C::SplitTableCell {
            shape: id(7),
            row: 0,
            col: 0,
        },
    );
    assert!(!table(&h, 7).cells[1][1].covered);

    let red = Fill::Solid(Color::Rgb(Rgb::new(255, 0, 0)));
    apply(
        &mut h,
        C::SetTableCellProps {
            shape: id(7),
            row: 1,
            col: 0,
            row_span: 2,
            col_span: 2,
            patch: TableCellPatch {
                fill: Some(Some(red)),
                bottom: Some(Some(Line::solid(Color::Rgb(Rgb::new(0, 0, 0)), Emu(9_525)))),
                anchor: Some(Anchor::Middle),
                ..Default::default()
            },
        },
    );
    let t = table(&h, 7);
    assert!(t.cells[1..].iter().flatten().all(|c| c.fill == Some(red)));
    assert_eq!(t.cells[2][1].text.props.anchor, Anchor::Middle);
    assert_eq!(t.cells[0][0].fill, None);
    apply(
        &mut h,
        C::SetTableCellProps {
            shape: id(7),
            row: 2,
            col: 1,
            row_span: 1,
            col_span: 1,
            patch: TableCellPatch {
                fill: Some(None),
                ..Default::default()
            },
        },
    );
    assert_eq!(table(&h, 7).cells[2][1].fill, None);

    apply(
        &mut h,
        C::SetTableStyle {
            shape: id(7),
            style_id: None,
            look: TableLook::default(),
        },
    );
    assert_eq!(table(&h, 7).style_id, None);
    apply(
        &mut h,
        C::SetTableGrid {
            shape: id(7),
            col_widths: Some(vec![Emu(1_000), Emu(3_000)]),
            row_heights: None,
        },
    );
    assert_eq!(shape(&h, 7).transform.w, Emu(4_000));
    // resizing the box scales the grid
    let mut wide = shape(&h, 7).transform;
    wide.w = Emu(8_000);
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(id(7), wide)],
        },
    );
    assert_eq!(table(&h, 7).cols[1].width, Emu(6_000));

    // errors leave the table alone
    for bad in [
        C::DeleteTableRow {
            shape: id(7),
            index: 9,
        },
        C::InsertTableCol {
            shape: id(7),
            index: 9,
        },
        C::MergeTableCells {
            shape: id(7),
            row: 0,
            col: 0,
            row_span: 1,
            col_span: 1,
        },
        C::SplitTableCell {
            shape: id(7),
            row: 0,
            col: 0,
        },
        C::SetTableGrid {
            shape: id(7),
            col_widths: Some(vec![Emu(1)]),
            row_heights: None,
        },
        C::SetTableCellProps {
            shape: id(7),
            row: 2,
            col: 1,
            row_span: 2,
            col_span: 1,
            patch: TableCellPatch::default(),
        },
        C::InsertTableRow {
            shape: id(5),
            index: 0,
        },
        C::InsertTable {
            slide: id(4),
            rows: 0,
            cols: 1,
            transform: None,
            new_id: -1,
        },
    ] {
        assert_eq!(err_code(&mut h, bad.clone()), "invalid_command", "{bad:?}");
    }
    // a single-row table keeps its row
    apply(
        &mut h,
        C::InsertTable {
            slide: id(4),
            rows: 1,
            cols: 1,
            transform: Some(tr(0, 0, 100, 100)),
            new_id: -1,
        },
    );
    assert_eq!(
        err_code(
            &mut h,
            C::DeleteTableRow {
                shape: id(8),
                index: 0
            }
        ),
        "invalid_command"
    );
}

#[test]
fn shapes_survive_pptx() {
    let mut h = host();
    glued(&mut h, ConnectorKind::Elbow);
    apply(
        &mut h,
        C::InsertTable {
            slide: id(4),
            rows: 2,
            cols: 2,
            transform: None,
            new_id: -1,
        },
    );
    apply(
        &mut h,
        C::MergeTableCells {
            shape: id(10),
            row: 0,
            col: 0,
            row_span: 1,
            col_span: 2,
        },
    );
    let bytes = h.doc().save_pptx().unwrap();
    let (doc, warnings) = ShowDocument::open_pptx(&bytes, "s.pptx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let slide = &doc.presentation().slides[1];
    let c = slide.shapes[4].connector().unwrap();
    assert_eq!(c.kind, ConnectorKind::Elbow);
    assert_eq!(c.start.unwrap().shape, slide.shapes[2].id);
    assert_eq!(c.tail.kind, ArrowKind::Triangle);
    let t = slide.shapes[5].table_data().unwrap();
    assert_eq!(t.cells[0][0].col_span, 2);
    assert!(t.cells[0][1].covered);
}

#[test]
fn new_shapes_have_the_json_of_shapes() {
    let mut h = host();
    glued(&mut h, ConnectorKind::Curved);
    apply(
        &mut h,
        C::InsertTable {
            slide: id(4),
            rows: 1,
            cols: 2,
            transform: None,
            new_id: -1,
        },
    );
    for n in [9, 10] {
        let s = shape(&h, n);
        assert_eq!(
            serde_json::to_value(NewShape::from(s)).unwrap(),
            serde_json::to_value(s).unwrap()
        );
        let back: NewShape = serde_json::from_value(serde_json::to_value(s).unwrap()).unwrap();
        assert_eq!(back, NewShape::from(s));
    }
}

/// P8-40 S-05: moving a connector together with both shapes it is glued to
/// (one drag of the selection, a nudge) moves its route along instead of
/// rerouting it (a route read from a file stays as it was drawn).
#[test]
fn a_connector_moved_with_its_shapes_keeps_its_route() {
    let mut p = Presentation::new();
    let s = p.add_slide(LayoutKind::Blank);
    let a = p
        .add_shape(s, Shape::auto(Preset::Rect, tr(0, 0, 100, 100)))
        .unwrap();
    let b = p
        .add_shape(s, Shape::auto(Preset::Rect, tr(300, 300, 100, 100)))
        .unwrap();
    let mut c = model_show::Connector::new(ConnectorKind::Straight);
    c.start = Some(Attach { shape: a, site: 2 });
    c.end = Some(Attach { shape: b, site: 0 });
    // as a file may store it: not the route the core would compute
    let cid = p
        .add_shape(s, Shape::connector_shape(c, tr(40, 100, 280, 200)))
        .unwrap();
    let mut h: ShowHost = Host::new(ShowDocument::from_presentation(p).unwrap());
    let before = shape(&h, cid.0).clone();
    let moved = |h: &ShowHost, n: NodeId| {
        let mut t = shape(h, n.0).transform;
        t.x.0 += 500;
        t.y.0 += 300;
        (n, t)
    };
    let shapes = vec![moved(&h, a), moved(&h, b), moved(&h, cid)];
    apply(&mut h, C::SetTransform { shapes });
    let after = shape(&h, cid.0);
    assert_eq!(after.kind, before.kind, "still glued, same route");
    assert_eq!(after.transform, tr(540, 400, 280, 200));
    // moving one of the shapes alone reroutes it (bottom of a → top of b)
    let mut t = shape(&h, b.0).transform;
    t.x.0 += 1_000;
    apply(
        &mut h,
        C::SetTransform {
            shapes: vec![(b, t)],
        },
    );
    assert_eq!(ends(&h, cid.0), ((550.0, 400.0), (1850.0, 600.0)));
}
