//! Reads the reference documents under `testdata/docx/`, checks the
//! features listed in `manifest.json` against the model, round-trips every
//! file and snapshots our `document.xml` for a few of them.

use std::collections::BTreeSet;
use std::io::Cursor;
use std::path::PathBuf;

use core_model::units::Twips;
use core_model::{Color, Rgb, Theme, VerticalAlign};
use fmt_ooxml::{Package, PartName};
use model_text::{
    Alignment, Block, BorderStyle, BreakKind, Document, Inline, LevelKind, LineSpacing, NodeId,
    Orientation, Paragraph, TableBorders,
};

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/docx")
}

fn load(name: &str) -> Vec<u8> {
    std::fs::read(dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn files() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "docx"))
        .collect();
    v.sort();
    assert!(v.len() >= 52, "{v:?}");
    v
}

struct Entry {
    file: String,
    features: Vec<String>,
    paragraphs: usize,
}

fn manifest() -> Vec<Entry> {
    let json: serde_json::Value =
        serde_json::from_slice(&load("manifest.json")).expect("manifest.json");
    json.as_array()
        .unwrap()
        .iter()
        .map(|e| Entry {
            file: e["file"].as_str().unwrap().to_owned(),
            features: e["features"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| f.as_str().unwrap().to_owned())
                .collect(),
            paragraphs: e["paragraphs"].as_u64().unwrap() as usize,
        })
        .collect()
}

// --- features ------------------------------------------------------------------

fn cm(t: Twips) -> String {
    format!("{:.1}", f64::from(t.0) * 2.54 / 1440.0)
}

fn pt(t: Twips) -> String {
    format!("{}", f64::from(t.0) / 20.0)
}

/// Canonical form of a feature: numbers in `key=…cm` / `key=…pt` values
/// get one decimal, so `1cm`, `1.0cm` and our `1.0cm` compare equal.
fn canon(f: &str) -> String {
    let Some((key, val)) = f.split_once('=') else {
        return f.to_owned();
    };
    for unit in ["cm", "pt"] {
        if let Some(nums) = val.strip_suffix(unit) {
            let parsed: Option<Vec<f64>> = nums
                .split(',')
                .map(|n| n.trim().trim_end_matches(unit).parse().ok())
                .collect();
            if let Some(ns) = parsed {
                let joined: Vec<String> = ns.iter().map(|n| format!("{n:.1}")).collect();
                return format!("{key}={}{unit}", joined.join(","));
            }
        }
    }
    f.to_owned()
}

fn level_format(kind: LevelKind) -> &'static str {
    match kind {
        LevelKind::Bullet => "bullet",
        LevelKind::Decimal => "decimal",
        LevelKind::LowerLetter => "lower-alpha",
        LevelKind::UpperLetter => "upper-alpha",
        LevelKind::LowerRoman => "lower-roman",
        LevelKind::UpperRoman => "upper-roman",
    }
}

fn border_features(b: &TableBorders, out: &mut BTreeSet<String>) {
    for side in [b.top, b.left, b.bottom, b.right, b.inside_h, b.inside_v]
        .into_iter()
        .flatten()
    {
        let name = match side.style {
            BorderStyle::Single | BorderStyle::Thick => "solid",
            BorderStyle::Double => "double",
            BorderStyle::Dotted => "dotted",
            BorderStyle::Dashed => "dashed",
            BorderStyle::None => continue,
        };
        out.insert(format!("table:border={name}"));
        if !matches!(side.color, Color::Auto | Color::Rgb(Rgb::BLACK)) {
            out.insert("table:border-color".into());
        }
    }
}

/// The features of `doc` in the vocabulary of `docs/docx-suite.md`.
fn features_of(doc: &Document, theme: &Theme) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let paragraphs: Vec<&Paragraph> = doc.paragraphs().collect();
    if paragraphs.len() >= 200 {
        out.insert("long:200-paragraphs".into());
    }
    // num id → (deepest level, level-0 kind)
    let mut lists: Vec<(u32, u8, LevelKind)> = Vec::new();
    let mut images = 0;
    for p in &paragraphs {
        let pp = doc.resolve_paragraph_props(p);
        match pp.style.as_deref() {
            Some("Title") => {
                out.insert("title".into());
            }
            Some(s) if s.starts_with("Heading") && s.len() == 8 => {
                out.insert(format!("heading:{}", &s[7..]));
            }
            Some("Normal") | None => {
                let direct = &p.props;
                if direct.alignment.is_some()
                    || direct.indent.is_some()
                    || direct.spacing.is_some()
                    || p.inlines
                        .iter()
                        .any(|i| i.as_run().is_some_and(|r| !r.props.is_empty()))
                {
                    out.insert("style:normal".into());
                }
            }
            _ => {}
        }
        if let Some(a) = pp.alignment {
            let a = match a {
                Alignment::Left => "left",
                Alignment::Center => "center",
                Alignment::Right => "right",
                Alignment::Justify => "justify",
            };
            out.insert(format!("para:align={a}"));
        }
        if let Some(ind) = pp.indent {
            for (k, v) in [
                ("left", ind.left),
                ("right", ind.right),
                ("first", ind.first_line),
                ("hanging", ind.hanging),
            ] {
                if let Some(v) = v.filter(|v| v.0 != 0) {
                    out.insert(format!("para:indent-{k}={}cm", cm(v)));
                }
            }
        }
        if let Some(sp) = pp.spacing {
            if let Some(b) = sp.before {
                out.insert(format!("para:space-before={}pt", pt(b)));
            }
            if let Some(a) = sp.after {
                out.insert(format!("para:space-after={}pt", pt(a)));
            }
            match sp.line {
                Some(LineSpacing::Multiple(m)) if (m - 1.0).abs() < 1e-9 => {
                    out.insert("para:line-spacing=single".into());
                }
                Some(LineSpacing::Multiple(m)) if (m - 1.5).abs() < 1e-9 => {
                    out.insert("para:line-spacing=1.5".into());
                }
                Some(LineSpacing::Multiple(m)) if (m - 2.0).abs() < 1e-9 => {
                    out.insert("para:line-spacing=double".into());
                }
                Some(LineSpacing::Multiple(m)) => {
                    out.insert(format!("para:line-spacing={}%", (m * 100.0).round()));
                }
                Some(LineSpacing::Exact(_) | LineSpacing::AtLeast(_)) => {
                    out.insert("para:line-spacing=exact".into());
                }
                None => {}
            }
        }
        if let Some(num) = pp.numbering {
            if let (Some(level), Some(def)) =
                (doc.numbering.level(num), doc.numbering.get(num.num_id))
            {
                // LibreOffice's heading outline: levels without a label.
                if !(level.kind == LevelKind::Bullet && level.text.is_empty()) {
                    let kind0 = def.levels[0].kind;
                    match lists.iter_mut().find(|l| l.0 == num.num_id) {
                        Some(l) => l.1 = l.1.max(num.level),
                        None => lists.push((num.num_id, num.level, kind0)),
                    }
                }
            }
        }
        if p.inlines.is_empty() {
            out.insert("para:empty".into());
        }
        for inline in &p.inlines {
            match inline {
                Inline::Run(run) => {
                    let r = doc.resolve_run_props(p, run);
                    if r.bold == Some(true) {
                        out.insert("run:bold".into());
                    }
                    if r.italic == Some(true) {
                        out.insert("run:italic".into());
                    }
                    if r.underline
                        .is_some_and(|u| u != core_model::Underline::None)
                    {
                        out.insert("run:underline".into());
                    }
                    if r.strike == Some(true) {
                        out.insert("run:strike".into());
                    }
                    match r.vertical_align {
                        Some(VerticalAlign::Superscript) => {
                            out.insert("run:superscript".into());
                        }
                        Some(VerticalAlign::Subscript) => {
                            out.insert("run:subscript".into());
                        }
                        _ => {}
                    }
                    if let Some(f) = &r.font {
                        out.insert(format!("run:font={}", f.resolve(&theme.fonts)));
                    }
                    if let Some(s) = r.size {
                        out.insert(format!("run:size={}", s.pt()));
                    }
                    if let Some(c) = r.color.filter(|c| *c != Color::Auto) {
                        let rgb = c.resolve(&theme.colors, Rgb::BLACK);
                        out.insert(format!("run:color={}", rgb.to_hex()));
                    }
                    if let Some(Color::Rgb(h)) = r.highlight {
                        if let Some(name) = fmt_docx::highlight_name(h) {
                            out.insert(format!("run:highlight={name}"));
                        }
                    }
                    if run.text.contains('\t') {
                        out.insert("tab".into());
                    }
                    if !run.text.is_ascii() {
                        out.insert("text:unicode".into());
                    }
                    if run
                        .text
                        .chars()
                        .any(|c| matches!(c, '\u{0590}'..='\u{08FF}' | '\u{FB1D}'..='\u{FDFF}'))
                    {
                        out.insert("text:rtl".into());
                    }
                }
                Inline::Image(img) => {
                    images += 1;
                    if img.alt.is_some() {
                        out.insert("image:alt".into());
                    }
                }
                Inline::Break(BreakKind::Page) => {
                    out.insert("break:page".into());
                }
                Inline::Break(BreakKind::Line) => {
                    out.insert("break:line".into());
                }
            }
        }
    }
    if images > 0 {
        out.insert(format!("image:count={images}"));
    }
    let mut numbered = 0;
    for (_, deepest, kind) in lists {
        let levels = deepest + 1;
        if kind == LevelKind::Bullet {
            out.insert(format!("list:bullet:levels={levels}"));
        } else {
            numbered += 1;
            out.insert(format!(
                "list:number:levels={levels}:format={}",
                level_format(kind)
            ));
        }
    }
    if numbered >= 2 {
        out.insert("list:restart".into());
    }
    tables_features(&doc.body, false, &mut out);

    let page = &doc.page;
    let (w, h) = match page.orientation {
        Orientation::Portrait => (page.width.0, page.height.0),
        Orientation::Landscape => (page.height.0, page.width.0),
    };
    let near = |a: i32, b: i32| (a - b).abs() <= 20;
    if near(w, 11906) && near(h, 16838) {
        out.insert("page:a4".into());
    }
    if near(w, 12240) && near(h, 15840) {
        out.insert("page:letter".into());
    }
    if page.orientation == Orientation::Landscape {
        out.insert("page:landscape".into());
    }
    let m = &page.margins;
    out.insert(format!(
        "page:margins={},{},{},{}cm",
        cm(m.top),
        cm(m.right),
        cm(m.bottom),
        cm(m.left)
    ));
    out.into_iter().map(|f| canon(&f)).collect()
}

fn tables_features(blocks: &[Block], in_table: bool, out: &mut BTreeSet<String>) {
    for b in blocks {
        let Block::Table(t) = b else {
            if in_table {
                if let Block::Paragraph(p) = b {
                    if p.props.numbering.is_some() {
                        out.insert("table:contains-list".into());
                    }
                    if p.inlines.iter().any(|i| matches!(i, Inline::Image(_))) {
                        out.insert("table:contains-image".into());
                    }
                }
            }
            continue;
        };
        let cols = t.rows.iter().map(|r| r.cells.len()).max().unwrap_or(0);
        let header = if t.rows.first().is_some_and(|r| r.props.header) {
            ":header"
        } else {
            ""
        };
        out.insert(format!("table:rows={}:cols={cols}{header}", t.rows.len()));
        if !t.props.col_widths.is_empty() {
            let ws: Vec<String> = t.props.col_widths.iter().map(|w| cm(*w)).collect();
            out.insert(format!("table:col-widths={}cm", ws.join(",")));
        }
        if let Some(b) = &t.props.borders {
            border_features(b, out);
        }
        for cell in t.rows.iter().flat_map(|r| &r.cells) {
            if let Some(b) = &cell.props.borders {
                border_features(b, out);
            }
            if cell
                .blocks
                .iter()
                .filter(|b| b.as_paragraph().is_some())
                .count()
                > 1
            {
                out.insert("table:multi-paragraph-cells".into());
            }
            tables_features(&cell.blocks, true, out);
        }
    }
}

/// Manifest features the generated files do not actually contain
/// (`gen.py` lists them, LibreOffice did not write them).
/// File 46's generator lists green and magenta highlights, but the file
/// only has yellow and cyan (`w:shd w:fill` FFFF00 / 00FFFF; "magenta" is
/// just the text of the cyan run).
const MANIFEST_ERRATA: &[(&str, &str)] = &[
    (
        "provisional-46-all-run-properties.docx",
        "run:highlight=green",
    ),
    (
        "provisional-46-all-run-properties.docx",
        "run:highlight=magenta",
    ),
];

#[test]
fn manifest_features_are_read() {
    let mut missing = Vec::new();
    for e in manifest() {
        let out = fmt_docx::read_with_context(&load(&e.file))
            .unwrap_or_else(|err| panic!("{}: {err}", e.file));
        let theme = out.context.theme_or_default();
        let have = features_of(&out.document, &theme);
        for f in &e.features {
            let errata = MANIFEST_ERRATA
                .iter()
                .any(|(file, feat)| *file == e.file && feat == f);
            if !have.contains(&canon(f)) && !errata {
                missing.push(format!("{}: {f} (have {have:?})", e.file));
            }
        }
        let n = out.document.paragraphs().count();
        assert!(
            n >= e.paragraphs,
            "{}: {n} < {} paragraphs",
            e.file,
            e.paragraphs
        );
    }
    assert!(
        missing.is_empty(),
        "missing features:\n{}",
        missing.join("\n")
    );
}

// --- roundtrip -------------------------------------------------------------------

fn zero_ids(blocks: &mut [Block]) {
    for b in blocks {
        match b {
            Block::Paragraph(p) => p.id = NodeId(0),
            Block::Table(t) => {
                t.id = NodeId(0);
                for row in &mut t.rows {
                    row.id = NodeId(0);
                    for cell in &mut row.cells {
                        cell.id = NodeId(0);
                        zero_ids(&mut cell.blocks);
                    }
                }
            }
        }
    }
}

/// Asserts `a == b` after `normalize()`, ignoring node ids.
fn assert_same(name: &str, a: &Document, b: &Document) {
    let (mut a, mut b) = (a.clone(), b.clone());
    a.normalize();
    b.normalize();
    zero_ids(&mut a.body);
    zero_ids(&mut b.body);
    assert_eq!(a.styles, b.styles, "{name}: styles");
    assert_eq!(a.numbering, b.numbering, "{name}: numbering");
    assert_eq!(a.page, b.page, "{name}: page");
    assert_eq!(a.media, b.media, "{name}: media");
    assert_eq!(a.body.len(), b.body.len(), "{name}: block count");
    for (i, (x, y)) in a.body.iter().zip(&b.body).enumerate() {
        assert_eq!(x, y, "{name}: block {i}");
    }
}

/// Num ids grouped by shared `abstractNum`, with their overridden levels.
fn num_groups(nums: &[fmt_docx::NumInstance]) -> BTreeSet<Vec<(u32, Vec<u8>)>> {
    let abstracts: BTreeSet<u32> = nums.iter().map(|n| n.abstract_id).collect();
    abstracts
        .into_iter()
        .map(|a| {
            nums.iter()
                .filter(|n| n.abstract_id == a)
                .map(|n| (n.num_id, n.start_overrides.clone()))
                .collect()
        })
        .collect()
}

#[test]
fn every_file_roundtrips() {
    for f in files() {
        let name = f.file_name().unwrap().to_string_lossy().into_owned();
        let first = fmt_docx::read_with_context(&std::fs::read(&f).unwrap())
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let bytes = fmt_docx::write_with_context(&first.document, &first.context)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let second = fmt_docx::read_with_context(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            second.warnings.is_empty(),
            "{name}: our output reads with warnings: {:?}",
            second.warnings
        );
        assert_same(&name, &first.document, &second.document);
        let (a, b) = (&first.context, &second.context);
        assert_eq!(a.theme_xml, b.theme_xml, "{name}: theme part");
        assert_eq!(a.theme, b.theme, "{name}: theme");
        assert_eq!(a.settings_xml, b.settings_xml, "{name}: settings part");
        assert_eq!(
            num_groups(&a.numbering),
            num_groups(&b.numbering),
            "{name}: nums sharing an abstractNum"
        );
        // writing is deterministic and a fixpoint
        let again = fmt_docx::write_with_context(&second.document, &second.context).unwrap();
        assert_eq!(again, bytes, "{name}: second write differs");
    }
}

#[test]
fn context_carries_theme_and_settings() {
    let bytes = load("provisional-01-heading-1.docx");
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(out.context.theme_xml.is_some());
    assert!(out.context.settings_xml.is_some());
    // The plain writer uses built-in parts, and the result still reads.
    let plain = fmt_docx::write(&out.document).unwrap();
    let back = fmt_docx::read(&plain).unwrap();
    assert_same("01 (no context)", &out.document, &back);
}

// --- snapshots --------------------------------------------------------------------

/// `document.xml` of `bytes`, re-indented for review.
fn pretty_document_xml(bytes: &[u8]) -> String {
    use quick_xml::events::Event;
    let pkg = Package::open(Cursor::new(bytes)).unwrap();
    let xml = &pkg
        .part(&PartName::new("/word/document.xml").unwrap())
        .unwrap()
        .data;
    let mut reader = quick_xml::Reader::from_reader(xml.as_slice());
    let mut writer = quick_xml::Writer::new_with_indent(Vec::new(), b' ', 1);
    loop {
        match reader.read_event().unwrap() {
            Event::Eof => break,
            Event::Decl(_) => {}
            ev => writer.write_event(ev).unwrap(),
        }
    }
    String::from_utf8(writer.into_inner()).unwrap()
}

#[test]
fn document_xml_snapshots() {
    for (n, file) in [
        ("07", "provisional-07-title-headings.docx"),
        ("18", "provisional-18-bullet-list-3-levels.docx"),
        ("24", "provisional-24-table-4x3-header.docx"),
        ("30", "provisional-30-image-inline.docx"),
        ("35", "provisional-35-page-landscape.docx"),
        ("46", "provisional-46-all-run-properties.docx"),
    ] {
        let out = fmt_docx::read_with_context(&load(file)).unwrap();
        let bytes = fmt_docx::write_with_context(&out.document, &out.context).unwrap();
        insta::assert_snapshot!(format!("document_xml_{n}"), pretty_document_xml(&bytes));
    }
}
