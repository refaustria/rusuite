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
    Alignment, Block, BorderStyle, BreakKind, Document, FieldKind, HAlign, HeaderSlot, Inline,
    LevelKind, LineSpacing, NodeId, NoteKind, Orientation, Paragraph, Placement, TabKind,
    TabLeader, TableBorders, VMerge, WrapKind,
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
        .filter(|p| p.extension().is_some_and(|e| e == "docx" || e == "dotx"))
        .collect();
    v.sort();
    assert!(v.len() >= 60, "{v:?}");
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
        LevelKind::Ordinal => "ordinal",
        LevelKind::DecimalZero => "decimal-zero",
        LevelKind::None => "none",
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
                let unlabelled = level.kind == LevelKind::None
                    || (level.kind == LevelKind::Bullet && level.text.is_empty());
                if !unlabelled {
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
        if let Some(b) = &pp.borders {
            if [b.top, b.bottom, b.left, b.right]
                .iter()
                .flatten()
                .any(|s| s.style != BorderStyle::None)
            {
                out.insert("para:border".into());
            }
        }
        if pp.shading.is_some_and(|c| c != Color::Auto) {
            out.insert("para:shading".into());
        }
        for t in &pp.tabs {
            let kind = match t.kind {
                TabKind::Left => "left",
                TabKind::Center => "center",
                TabKind::Right => "right",
                TabKind::Decimal => "decimal",
                TabKind::Bar => "bar",
                TabKind::Clear => continue,
            };
            out.insert(format!("para:tab={kind}"));
            let leader = match t.leader {
                TabLeader::None => continue,
                TabLeader::Dot => "dot",
                TabLeader::Hyphen => "hyphen",
                TabLeader::Underscore => "underscore",
            };
            out.insert(format!("para:tab-leader={leader}"));
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
                    if r.underline == Some(core_model::Underline::Words) {
                        out.insert("run:words-underline".into());
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
                    for (on, name) in [
                        (r.small_caps, "run:small-caps"),
                        (r.all_caps, "run:all-caps"),
                        (r.double_strike, "run:double-strike"),
                        (r.outline, "run:outline"),
                        (r.shadow, "run:shadow"),
                        (r.emboss, "run:emboss"),
                        (r.imprint, "run:imprint"),
                        (r.hidden, "run:hidden"),
                    ] {
                        if on == Some(true) {
                            out.insert(name.into());
                        }
                    }
                    if let Some(sp) = r.char_spacing.filter(|v| *v != 0) {
                        out.insert(format!("run:spacing={}pt", f64::from(sp) / 20.0));
                    }
                    if let Some(v) = r.position.filter(|v| *v != 0) {
                        out.insert(format!("run:position={}pt", f64::from(v) / 2.0));
                    }
                    if let Some(v) = r.scale.filter(|v| *v != 100) {
                        out.insert(format!("run:scale={v}"));
                    }
                    if r.kerning.is_some_and(|k| k > 0) {
                        out.insert("run:kerning".into());
                    }
                    if run.text.contains('\t') {
                        out.insert("tab".into());
                    }
                    if let Some(l) = &run.link {
                        out.insert(
                            match l.target {
                                model_text::LinkTarget::Url(_) => "link:url",
                                model_text::LinkTarget::Bookmark(_) => "link:bookmark",
                                model_text::LinkTarget::Email { .. } => "link:email",
                            }
                            .into(),
                        );
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
                    if let Some(a) = &img.anchor {
                        out.insert(format!(
                            "image:float={}",
                            match a.wrap {
                                WrapKind::Square => "square",
                                // LibreOffice writes its contour wrap as wrapThrough.
                                WrapKind::Tight | WrapKind::Through => "tight",
                                WrapKind::TopAndBottom => "top-bottom",
                                WrapKind::Behind => "behind",
                                WrapKind::InFront => "in-front",
                            }
                        ));
                        if let Placement::Align(al) = a.h.place {
                            out.insert(format!(
                                "image:float-align={}",
                                match al {
                                    HAlign::Left => "left",
                                    HAlign::Center => "center",
                                    HAlign::Right => "right",
                                }
                            ));
                        }
                    }
                }
                Inline::Drawing(d) => {
                    out.insert(match d.kind {
                        model_text::DrawingKind::TextBox => "drawing:textbox".to_owned(),
                        model_text::DrawingKind::Shape => format!("drawing:shape={}", d.preset),
                        model_text::DrawingKind::Group => "drawing:group".to_owned(),
                        model_text::DrawingKind::Picture => "drawing:picture".to_owned(),
                    });
                    if d.blocks().iter().any(|b| {
                        b.as_paragraph()
                            .is_some_and(|p| !p.text().trim().is_empty())
                    }) {
                        out.insert("drawing:text".into());
                    }
                    match &d.anchor {
                        None => {
                            out.insert("drawing:inline".into());
                        }
                        Some(a) => {
                            out.insert(format!(
                                "drawing:float={}",
                                match a.wrap {
                                    WrapKind::Square => "square",
                                    WrapKind::Tight | WrapKind::Through => "tight",
                                    WrapKind::TopAndBottom => "top-bottom",
                                    WrapKind::Behind => "behind",
                                    WrapKind::InFront => "in-front",
                                }
                            ));
                        }
                    }
                }
                Inline::Break(BreakKind::Page) => {
                    out.insert("break:page".into());
                }
                Inline::Break(BreakKind::Line) => {
                    out.insert("break:line".into());
                }
                Inline::Break(BreakKind::Column) => {
                    out.insert("break:column".into());
                }
                Inline::Field(_)
                | Inline::NoteRef(_)
                | Inline::CommentStart { .. }
                | Inline::CommentEnd { .. }
                | Inline::BookmarkStart { .. }
                | Inline::BookmarkEnd { .. } => {}
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
    structure_features(doc, &mut out);

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
    style_features(doc, &mut out);
    comment_features(doc, &mut out);
    out.into_iter().map(|f| canon(&f)).collect()
}

/// Comments: count (replies included), distinct authors, replies,
/// resolved threads, a range starting in a table cell.
fn comment_features(doc: &Document, out: &mut BTreeSet<String>) {
    if doc.comments.is_empty() {
        return;
    }
    out.insert(format!("comment:count={}", doc.comments.len()));
    let authors: BTreeSet<&str> = doc.comments.iter().map(|c| c.author.as_str()).collect();
    out.insert(format!("comment:authors={}", authors.len()));
    if doc.comments.iter().any(|c| c.parent.is_some()) {
        out.insert("comment:reply".into());
    }
    if doc.comments.iter().any(|c| c.resolved) {
        out.insert("comment:resolved".into());
    }
    let top: BTreeSet<NodeId> = doc.body.iter().map(Block::id).collect();
    if doc
        .comment_ranges()
        .iter()
        .any(|r| !top.contains(&r.start_block))
    {
        out.insert("comment:in-table".into());
    }
}

/// Named styles in use: custom paragraph / character styles, linked
/// styles, a `next` style other than Normal, hidden styles.
fn style_features(doc: &Document, out: &mut BTreeSet<String>) {
    use model_text::StyleKind;
    for p in doc.paragraphs() {
        if let Some(s) = p.props.style.as_deref().and_then(|id| doc.styles.get(id)) {
            if s.custom && s.kind.is_paragraph() {
                out.insert("style:custom-paragraph".into());
            }
            if s.kind == StyleKind::Linked {
                out.insert("style:linked".into());
            }
            if s.next
                .as_deref()
                .is_some_and(|n| n != "Normal" && n != s.id)
            {
                out.insert("style:next".into());
            }
            if s.hidden {
                out.insert("style:hidden".into());
            }
            let p = doc.styles.resolve_paragraph(&s.id);
            if p.shading.is_some() {
                out.insert("style:shading".into());
            }
            if p.borders.is_some_and(|b| b.bottom.is_some()) {
                out.insert("style:bottom-rule".into());
            }
        }
        for r in p.inlines.iter().filter_map(Inline::as_run) {
            if let Some(s) = r.style.as_deref().and_then(|id| doc.styles.get(id)) {
                if s.kind == StyleKind::Character && s.link.is_none() {
                    out.insert("style:custom-character".into());
                }
                if s.link.is_some() {
                    out.insert("style:linked".into());
                }
            }
        }
    }
}

/// Lists labels, sections, headers/footers, fields, notes and tables of
/// contents.
fn structure_features(doc: &Document, out: &mut BTreeSet<String>) {
    for (_, label) in doc.list_numbers() {
        if !label.is_empty() {
            out.insert(format!("list:label={label}"));
        }
    }
    out.insert(format!("section:count={}", doc.sections.len()));
    for s in &doc.sections {
        if s.page.orientation == Orientation::Landscape {
            out.insert("section:landscape".into());
        }
        for (footer, what) in [(false, "header"), (true, "footer")] {
            for (slot, _) in s.header_footer(footer).slots() {
                let slot = match slot {
                    HeaderSlot::Default => "default",
                    HeaderSlot::First => "first",
                    HeaderSlot::Even => "even",
                };
                out.insert(format!("{what}:{slot}"));
            }
        }
        if let Some(n) = s.page_number_start {
            out.insert(format!("page-number:start={n}"));
        }
        if s.columns.count > 1 {
            out.insert(format!("section:columns={}", s.columns.count));
        }
        if s.columns.separator {
            out.insert("section:column-separator".into());
        }
    }
    let visible = doc.bookmarks().iter().filter(|b| !b.hidden()).count();
    if visible > 0 {
        out.insert(format!("bookmark:count={visible}"));
    }
    for (key, v) in [
        ("title", &doc.properties.title),
        ("subject", &doc.properties.subject),
        ("author", &doc.properties.author),
        ("keywords", &doc.properties.keywords),
        ("company", &doc.properties.company),
    ] {
        if v.is_some() {
            out.insert(format!("props:{key}"));
        }
    }
    for c in doc.containers() {
        for p in model_text::document::paragraphs_in(c) {
            for i in &p.inlines {
                if let Inline::Field(f) = i {
                    out.insert(match f.kind {
                        FieldKind::Page => "field:page".to_owned(),
                        FieldKind::NumPages => "field:numpages".to_owned(),
                        FieldKind::Date { .. } => "field:date".to_owned(),
                        FieldKind::Time { .. } => "field:time".to_owned(),
                        FieldKind::FileName => "field:filename".to_owned(),
                        FieldKind::Author => "field:author".to_owned(),
                        FieldKind::Title => "field:title".to_owned(),
                        FieldKind::Subject => "field:subject".to_owned(),
                        FieldKind::Keywords => "field:keywords".to_owned(),
                        FieldKind::Comments => "field:comments".to_owned(),
                        FieldKind::LastSavedBy => "field:lastsavedby".to_owned(),
                        FieldKind::SaveDate { .. } => "field:savedate".to_owned(),
                        FieldKind::DocProperty { ref name } => {
                            format!("field:docproperty={}", name.to_lowercase())
                        }
                        FieldKind::Ref { .. } => "field:ref".to_owned(),
                        FieldKind::PageRef { .. } => "field:pageref".to_owned(),
                        FieldKind::NoteRef { .. } => "field:noteref".to_owned(),
                        FieldKind::Seq { ref identifier, .. } => {
                            format!("field:seq={identifier}")
                        }
                    });
                }
            }
        }
    }
    for (kind, name) in [(NoteKind::Foot, "footnote"), (NoteKind::End, "endnote")] {
        let n = doc.notes.iter().filter(|n| n.kind == kind).count();
        if n > 0 {
            out.insert(format!("note:{name}={n}"));
        }
    }
    for t in doc.body.iter().filter_map(Block::as_toc) {
        out.insert(format!("toc:levels={}-{}", t.from_level, t.to_level));
        out.insert(format!("toc:entries={}", t.entries.len()));
        if !t.entries.is_empty() {
            out.insert("tab".into()); // entry text and page number
        }
    }
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
        let cols = t.grid_cols();
        if t.rows
            .iter()
            .flat_map(|r| &r.cells)
            .any(|c| c.grid_span > 1)
        {
            out.insert("table:merged=horizontal".into());
        }
        if t.rows
            .iter()
            .flat_map(|r| &r.cells)
            .any(|c| c.v_merge == Some(VMerge::Restart))
        {
            out.insert("table:merged=vertical".into());
        }
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
        let mut have = features_of(&out.document, &theme);
        if out.context.template {
            have.insert("template".into());
        }
        for f in &e.features {
            let errata = MANIFEST_ERRATA
                .iter()
                .any(|(file, feat)| *file == e.file && feat == f);
            if !have.contains(&canon(f)) && !errata {
                missing.push(format!("{}: {f} (have {have:?})", e.file));
            }
        }
        // The generator counts the paragraphs of a table of contents too.
        let toc_paragraphs: usize = out
            .document
            .body
            .iter()
            .filter_map(Block::as_toc)
            .map(|t| t.entries.len() + usize::from(t.title.is_some()))
            .sum();
        let n = out.document.paragraphs().count() + toc_paragraphs;
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
            Block::Toc(t) => {
                t.id = NodeId(0);
                for e in &mut t.entries {
                    e.target = NodeId(0);
                }
            }
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
    for d in [&mut a, &mut b] {
        for c in d.containers_mut() {
            zero_ids(c);
        }
    }
    assert_eq!(a.styles, b.styles, "{name}: styles");
    assert_eq!(a.sections, b.sections, "{name}: sections");
    assert_eq!(a.notes, b.notes, "{name}: notes");
    assert_eq!(a.comments, b.comments, "{name}: comments");
    assert_eq!(a.numbering, b.numbering, "{name}: numbering");
    assert_eq!(a.page, b.page, "{name}: page");
    assert_eq!(a.media, b.media, "{name}: media");
    assert_eq!(a.properties, b.properties, "{name}: properties");
    assert_eq!(a.settings, b.settings, "{name}: settings");
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
        ("61", "provisional-61-shapes-text-boxes.docx"),
        ("62", "provisional-62-character-formatting.docx"),
    ] {
        let out = fmt_docx::read_with_context(&load(file)).unwrap();
        let bytes = fmt_docx::write_with_context(&out.document, &out.context).unwrap();
        insta::assert_snapshot!(format!("document_xml_{n}"), pretty_document_xml(&bytes));
    }
}

// --- document structure (P8-9) ---------------------------------------------------

fn read_out(name: &str) -> fmt_docx::ReadOutput {
    fmt_docx::read_with_context(&load(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// `doc` written and read back (no warnings), for assertions on our output.
fn reread(doc: &Document) -> Document {
    let out = fmt_docx::read_with_context(&fmt_docx::write(doc).unwrap()).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    out.document
}

#[test]
fn multilevel_numbering_labels() {
    let doc = read_out("provisional-51-multilevel-legal-numbering.docx").document;
    let labels: Vec<String> = doc.list_numbers().into_iter().map(|(_, l)| l).collect();
    assert_eq!(
        labels,
        ["1.", "1.1.", "1.2.", "1.2.1.", "1.2.2.", "2.", "2.1.", "2.1.1.", "3.", "3.1."]
    );
    assert_eq!(
        reread(&doc).list_numbers().len(),
        10,
        "labels survive our writer"
    );
}

#[test]
fn sections_headers_and_fields() {
    let doc = read_out("provisional-52-sections-headers-fields.docx").document;
    assert_eq!(doc.sections.len(), 3);
    let [s1, s2, s3] = [&doc.sections[0], &doc.sections[1], &doc.sections[2]];
    assert!(s1.title_page && !s2.title_page);
    assert_eq!(s2.page_number_start, Some(1));
    assert_eq!(s3.page.orientation, Orientation::Landscape);
    assert_eq!(doc.page, s3.page);
    assert_eq!(
        s1.headers
            .first
            .as_ref()
            .map(|b| b[0].as_paragraph().unwrap().text()),
        Some("Title page header".to_owned())
    );
    assert_eq!(s2.page.footer_text.as_deref(), Some("Page {PAGE} of 4"));
    assert_eq!(
        doc.page.header_text.as_deref(),
        Some("Landscape appendix header")
    );
    // section ends: the paragraph before each new section
    let ends: Vec<String> = doc
        .paragraphs()
        .filter(|p| p.props.section_end.is_some())
        .map(|p| p.text())
        .collect();
    assert_eq!(
        ends,
        ["Created on \u{FFFC}.", "This is page \u{FFFC} of \u{FFFC}."]
    );
    let fields: Vec<FieldKind> = doc
        .paragraphs()
        .flat_map(|p| &p.inlines)
        .filter_map(|i| match i {
            Inline::Field(f) => Some(f.kind.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        fields,
        [
            FieldKind::Date {
                format: Some(r"d\.M\.yyyy".into())
            },
            FieldKind::Page,
            FieldKind::NumPages
        ]
    );
    let back = reread(&doc);
    assert_same("52 (no context)", &doc, &back);
}

#[test]
fn footnotes_and_endnotes() {
    let doc = read_out("provisional-53-footnotes-endnotes.docx").document;
    let notes: Vec<(u32, NoteKind, String)> = doc
        .notes
        .iter()
        .map(|n| (n.id, n.kind, n.blocks[0].as_paragraph().unwrap().text()))
        .collect();
    // The endnote's id 2 collides with a footnote: it gets a fresh one.
    assert_eq!(
        notes,
        [
            (2, NoteKind::Foot, "The first footnote.".to_owned()),
            (
                3,
                NoteKind::Foot,
                "Second footnote, with a longer explanation.".to_owned()
            ),
            (4, NoteKind::Foot, "Third footnote.".to_owned()),
            (5, NoteKind::End, "The only endnote.".to_owned()),
        ]
    );
    let refs: Vec<(u32, NoteKind)> = doc
        .paragraphs()
        .flat_map(|p| &p.inlines)
        .filter_map(|i| match i {
            Inline::NoteRef(r) => Some((r.id, r.kind)),
            _ => None,
        })
        .collect();
    assert_eq!(
        refs,
        [
            (2, NoteKind::Foot),
            (3, NoteKind::Foot),
            (5, NoteKind::End),
            (4, NoteKind::Foot)
        ]
    );
    // With the file's settings the separators keep LibreOffice's ids 0/1.
    let out = read_out("provisional-53-footnotes-endnotes.docx");
    assert_eq!(out.context.footnote_separators, Some((0, 1)));
    let bytes = fmt_docx::write_with_context(&out.document, &out.context).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let foot = String::from_utf8(
        pkg.part(&PartName::new("/word/footnotes.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap();
    assert!(
        foot.contains(r#"<w:footnote w:type="separator" w:id="0">"#),
        "{foot}"
    );
    assert!(foot.contains(r#"<w:footnote w:id="2"><w:p><w:pPr><w:pStyle w:val="Normal"/>"#));
    assert!(foot.contains(r#"<w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/>"#));
    // Without context: default separators -1/0 and settings that list them.
    let bytes = fmt_docx::write(&doc).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let settings = String::from_utf8(
        pkg.part(&PartName::new("/word/settings.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap();
    assert!(settings
        .contains(r#"<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>"#));
    assert_same("53 (no context)", &doc, &reread(&doc));
}

#[test]
fn table_of_contents() {
    let doc = read_out("provisional-54-table-of-contents.docx").document;
    let toc = doc.body.iter().find_map(Block::as_toc).unwrap();
    assert_eq!((toc.from_level, toc.to_level), (1, 3));
    assert_eq!(toc.title.as_deref(), Some("Contents"));
    let entries: Vec<(&str, u8, Option<u32>)> = toc
        .entries
        .iter()
        .map(|e| (e.text.as_str(), e.level, e.page))
        .collect();
    assert_eq!(
        entries,
        [
            ("Introduction", 1, Some(1)),
            ("Background", 2, Some(1)),
            ("Goals", 2, Some(1)),
            ("Design", 1, Some(2)),
            ("Architecture", 2, Some(2)),
            ("Storage", 3, Some(2)),
            ("Summary", 1, Some(3)),
        ]
    );
    for e in &toc.entries {
        assert_eq!(doc.find_paragraph(e.target).unwrap().text(), e.text);
    }
    // Our output: Word's structure (sdt, TOC field, hyperlinks to _Toc
    // bookmarks, PAGEREF fields).
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = pretty_document_xml(&bytes);
    for needle in [
        r#"<w:docPartGallery w:val="Table of Contents"/>"#,
        r#"TOC \o "1-3" \h \z \u"#,
        r#"<w:hyperlink w:anchor="_Toc000000001" w:history="1">"#,
        r#"PAGEREF _Toc000000007 \h"#,
        r#"<w:bookmarkStart w:id="0" w:name="_Toc000000001"/>"#,
        r#"<w:pStyle w:val="TOC3"/>"#,
    ] {
        assert!(xml.contains(needle), "{needle} missing in\n{xml}");
    }
    assert_same("54 (no context)", &doc, &reread(&doc));
}

// --- tables, floating images, paragraph borders (P8-15) --------------------------

/// LibreOffice links its outline numbering to the heading styles; that
/// link is all the reader drops from files 55–57.
fn assert_no_new_warnings(warnings: &[String]) {
    let other: Vec<&String> = warnings
        .iter()
        .filter(|w| !w.contains("list level linked to a style"))
        .collect();
    assert!(other.is_empty(), "{other:?}");
}

fn cell_texts(t: &model_text::Table) -> Vec<Vec<String>> {
    t.rows
        .iter()
        .map(|r| {
            r.cells
                .iter()
                .map(|c| {
                    let tag = match c.v_merge {
                        Some(VMerge::Restart) => "^",
                        Some(VMerge::Continue) => "|",
                        None => "",
                    };
                    let p: Vec<String> = model_text::document::paragraphs_in(&c.blocks)
                        .map(Paragraph::text)
                        .collect();
                    format!("{tag}{}x{}", p.join("/"), c.grid_span)
                })
                .collect()
        })
        .collect()
}

#[test]
fn merged_cells() {
    let out = read_out("provisional-55-table-merged-cells.docx");
    assert_no_new_warnings(&out.warnings);
    let doc = out.document;
    let tables: Vec<&model_text::Table> = doc.body.iter().filter_map(Block::as_table).collect();
    assert_eq!(
        cell_texts(tables[0]),
        [
            vec!["Quarterly figuresx4"],
            vec!["^Regionx1", "Q1x1", "Q2x1", "Totalx1"],
            vec!["|x1", "10x1", "12x1", "22x1"],
            vec!["Northx1", "5x1", "8 (merged)x2"],
        ]
    );
    assert_eq!(
        cell_texts(tables[1]),
        [
            vec!["A1x1", "^Block B1:C2x2"],
            vec!["A2x1", "|x2"],
            vec!["A3x1", "B3x1", "C3x1"],
        ]
    );
    for t in &tables {
        t.check_grid().unwrap();
    }
    // Our output: gridSpan / vMerge as Word writes them, and the cell
    // widths follow the grid.
    let xml = pretty_document_xml(&fmt_docx::write(&doc).unwrap());
    for needle in [
        r#"<w:gridSpan w:val="4"/>"#,
        r#"<w:vMerge w:val="restart"/>"#,
        "<w:vMerge/>",
        r#"<w:tcW w:w="4537" w:type="dxa"/>"#,
        r#"<w:tblLayout w:type="fixed"/>"#,
    ] {
        assert!(xml.contains(needle), "{needle} missing in\n{xml}");
    }
    assert_same("55 (no context)", &doc, &reread(&doc));
}

#[test]
fn floating_images() {
    use model_text::{HRelative, VRelative};
    let out = read_out("provisional-56-images-floating.docx");
    assert_no_new_warnings(&out.warnings);
    let doc = out.document;
    let anchors: Vec<model_text::Anchor> = doc
        .paragraphs()
        .flat_map(|p| &p.inlines)
        .filter_map(|i| match i {
            Inline::Image(img) => img.anchor,
            _ => None,
        })
        .collect();
    let summary: Vec<(WrapKind, Placement<HAlign>, HRelative, VRelative)> = anchors
        .iter()
        .map(|a| (a.wrap, a.h.place, a.h.relative_to, a.v.relative_to))
        .collect();
    assert_eq!(
        summary,
        [
            (
                WrapKind::Square,
                Placement::Align(HAlign::Left),
                HRelative::Column,
                VRelative::Paragraph
            ),
            (
                // LibreOffice's contour wrap (`wp:wrapThrough`).
                WrapKind::Through,
                Placement::Align(HAlign::Right),
                HRelative::Column,
                VRelative::Paragraph
            ),
            (
                WrapKind::TopAndBottom,
                Placement::Align(HAlign::Center),
                HRelative::Column,
                VRelative::Paragraph
            ),
            (
                WrapKind::Behind,
                Placement::Align(HAlign::Center),
                HRelative::Column,
                VRelative::Paragraph
            ),
        ]
    );
    // 0.2 cm side distance
    assert_eq!(anchors[0].distance.left, core_model::units::Emu(71_755));
    let bytes = fmt_docx::write(&doc).unwrap();
    let xml = pretty_document_xml(&bytes);
    for needle in [
        r#"<wp:anchor distT="0" distB="0" distL="71755" distR="71755" simplePos="0""#,
        r#"<wp:positionH relativeFrom="column">"#,
        "<wp:align>right</wp:align>",
        r#"<wp:wrapSquare wrapText="bothSides"/>"#,
        // Written back as read (P9-W4: wrapThrough is kept).
        r#"<wp:wrapThrough wrapText="bothSides">"#,
        "<wp:wrapTopAndBottom/>",
        r#"behindDoc="1""#,
    ] {
        assert!(xml.contains(needle), "{needle} missing in\n{xml}");
    }
    assert_same("56 (no context)", &doc, &reread(&doc));
}

#[test]
fn paragraph_borders_shading_and_tabs() {
    let out = read_out("provisional-57-paragraph-borders-shading-tabs.docx");
    assert_no_new_warnings(&out.warnings);
    let doc = out.document;
    let ps: Vec<&Paragraph> = doc.paragraphs().collect();
    let boxed = doc.resolve_paragraph_props(ps[1]).borders.unwrap();
    assert!([boxed.top, boxed.left, boxed.bottom, boxed.right]
        .iter()
        .all(|s| s.is_some_and(|s| s.style == BorderStyle::Single)));
    assert_eq!(boxed.top.unwrap().space, Some(3));
    let rule = doc.resolve_paragraph_props(ps[2]).borders.unwrap();
    assert_eq!(
        rule.bottom.unwrap().color,
        Color::Rgb(Rgb::new(0x44, 0x72, 0xC4))
    );
    assert!(rule.top.is_none());
    assert_eq!(
        doc.resolve_paragraph_props(ps[3]).shading,
        Some(Color::Rgb(Rgb::new(0xFF, 0xF2, 0xCC)))
    );
    let tabs = doc.resolve_paragraph_props(ps[6]).tabs;
    let kinds: Vec<(i32, TabKind, TabLeader)> =
        tabs.iter().map(|t| (t.pos.0, t.kind, t.leader)).collect();
    assert_eq!(
        kinds,
        [
            (1701, TabKind::Left, TabLeader::None),
            (4535, TabKind::Center, TabLeader::None),
            (6803, TabKind::Decimal, TabLeader::None),
            (9071, TabKind::Right, TabLeader::Dot),
        ]
    );
    let xml = pretty_document_xml(&fmt_docx::write(&doc).unwrap());
    for needle in [
        r#"<w:top w:val="single" w:sz="4" w:space="3" w:color="000000"/>"#,
        r#"<w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>"#,
        r#"<w:tab w:val="right" w:leader="dot" w:pos="9071"/>"#,
    ] {
        assert!(xml.contains(needle), "{needle} missing in\n{xml}");
    }
    assert_same("57 (no context)", &doc, &reread(&doc));
}

// --- named styles (P8-21) ------------------------------------------------------

#[test]
fn custom_linked_and_hidden_styles() {
    use model_text::StyleKind;
    let out = read_out("provisional-58-styles-custom.docx");
    assert_no_new_warnings(&out.warnings);
    let doc = out.document;
    let st = &doc.styles;
    let heading = st.get("MemoHeading").unwrap();
    assert_eq!(heading.kind, StyleKind::Linked);
    assert_eq!(heading.name, "Memo Heading");
    assert_eq!(heading.next.as_deref(), Some("MemoBody"));
    assert_eq!(heading.link.as_deref(), Some("MemoHeadingChar"));
    assert!(heading.custom && heading.quick_format);
    assert_eq!(heading.priority, Some(5));
    let body = st.get("MemoBody").unwrap();
    assert!(!body.quick_format && !body.hidden);
    let note = st.get("InternalNote").unwrap();
    assert!(note.hidden && note.semi_hidden && note.unhide_when_used);
    assert_eq!(st.get("KeyTerm").unwrap().kind, StyleKind::Character);
    assert!(st.find_by_name("heading 1").is_some(), "built-ins kept");
    // runs keep their character styles and resolve through them
    let ps: Vec<&Paragraph> = doc.paragraphs().collect();
    let runs: Vec<&model_text::Run> = ps[2].inlines.iter().filter_map(Inline::as_run).collect();
    let styled: Vec<(&str, Option<&str>)> = runs
        .iter()
        .map(|r| (r.text.as_str(), r.style.as_deref()))
        .collect();
    assert_eq!(
        styled,
        [
            ("A ", None),
            ("key term", Some("KeyTerm")),
            (" and a ", None),
            ("linked run", Some("MemoHeadingChar")),
            (" in Normal text.", None),
        ]
    );
    let key = doc.resolve_run_props(ps[2], runs[1]);
    assert_eq!(key.bold, Some(true));
    assert_eq!(key.color, Some(Color::Rgb(Rgb::new(0xC0, 0, 0))));
    assert_eq!(doc.blocks_with_style("KeyTerm"), [ps[2].id]);
    // our output: the flags and w:rStyle as Word writes them
    let bytes = fmt_docx::write(&doc).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let styles = String::from_utf8(
        pkg.part(&PartName::new("/word/styles.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap();
    for needle in [
        r#"<w:style w:type="paragraph" w:customStyle="1" w:styleId="InternalNote"><w:name w:val="Internal Note"/><w:basedOn w:val="Normal"/><w:hidden/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>"#,
        r#"<w:next w:val="MemoBody"/><w:link w:val="MemoHeadingChar"/><w:uiPriority w:val="5"/><w:qFormat/>"#,
    ] {
        assert!(styles.contains(needle), "{needle} missing in\n{styles}");
    }
    // Word's latent styles travel along (P9-W3), between the defaults and the styles.
    assert!(doc.styles.latent.is_some());
    assert!(styles.contains("<w:latentStyles"), "{styles}");
    assert_eq!(
        fmt_docx::read(&bytes).unwrap().styles.latent,
        doc.styles.latent
    );
    let xml = pretty_document_xml(&bytes);
    assert!(xml.contains(r#"<w:rStyle w:val="KeyTerm"/>"#), "{xml}");
    assert_same("58 (no context)", &doc, &reread(&doc));
}

#[test]
fn built_in_table_styles_are_written_like_word() {
    let doc = Document::new();
    let bytes = fmt_docx::write(&doc).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let styles = String::from_utf8(
        pkg.part(&PartName::new("/word/styles.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap();
    for needle in [
        r#"<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>"#,
        r#"<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>"#,
        r#"<w:style w:type="table" w:styleId="GridTable4-Accent1"><w:name w:val="Grid Table 4 Accent 1"/>"#,
        r#"<w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="1"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="8FAADC" w:themeColor="accent1" w:themeTint="99"/>"#,
        r#"<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/><w:color w:val="FFFFFF" w:themeColor="background1"/></w:rPr><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="4472C4" w:themeColor="accent1"/>"#,
        r#"<w:insideH w:val="nil" w:sz="0" w:space="0" w:color="auto"/>"#,
        r#"<w:shd w:val="clear" w:color="auto" w:fill="4472C4" w:themeFill="accent1"/></w:tcPr></w:tblStylePr>"#,
        r#"<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="DAE3F3" w:themeFill="accent1" w:themeFillTint="33"/>"#,
    ] {
        assert!(styles.contains(needle), "{needle} missing in\n{styles}");
    }
    // A table using a style keeps it, and the style resolves after reading.
    let back = fmt_docx::read(&bytes).unwrap();
    assert_eq!(back.styles, doc.styles);
}

// --- comments (P8-25) ------------------------------------------------------------

#[test]
fn comments_threads_and_ranges() {
    let out = read_out("provisional-59-comments.docx");
    assert_no_new_warnings(&out.warnings);
    let doc = out.document;
    type Row<'a> = (u32, &'a str, &'a str, Option<&'a str>, Option<u32>, bool);
    let summary: Vec<Row> = doc
        .comments
        .iter()
        .map(|c| {
            (
                c.id.0,
                c.author.as_str(),
                c.initials.as_str(),
                c.date.as_deref(),
                c.parent.map(|p| p.0),
                c.resolved,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                0,
                "Anna Berg",
                "AB",
                Some("2026-10-01T09:30:00Z"),
                None,
                false
            ),
            (
                1,
                "Ben Cole",
                "BC",
                Some("2026-10-02T10:00:00Z"),
                None,
                false
            ),
            (
                2,
                "Anna Berg",
                "AB",
                Some("2026-10-02T11:15:00Z"),
                Some(1),
                false
            ),
            (
                3,
                "Ben Cole",
                "BC",
                Some("2026-10-03T08:00:00Z"),
                None,
                true
            ),
            (
                4,
                "Anna Berg",
                "AB",
                Some("2026-10-04T14:45:00Z"),
                None,
                false
            ),
        ]
    );
    assert_eq!(
        doc.comments[1].text(),
        "This whole paragraph needs a source.\nSecond paragraph of the comment."
    );
    // The commented text of every thread (markers resolved to offsets).
    let commented: Vec<(u32, String)> = doc
        .comment_ranges()
        .iter()
        .map(|r| {
            assert_eq!(r.start_block, r.end_block);
            let p = doc.find_paragraph(r.start_block).unwrap();
            let chars: Vec<char> = p.text().chars().collect();
            let t: String = chars[r.start + 1..r.end].iter().collect();
            (r.id.0, t.replace('\u{FEFF}', ""))
        })
        .collect();
    assert_eq!(commented[0], (0, "quick brown".to_owned()));
    assert!(
        commented[1].1.starts_with("Reference documents"),
        "{commented:?}"
    );
    assert_eq!(commented[2], (3, "resolved".to_owned()));
    assert_eq!(commented[3], (4, "with a note".to_owned()));
    assert_eq!(commented.len(), 4, "replies have no range of their own");

    // Our output: Word's parts, markers for every thread member.
    let bytes = fmt_docx::write(&doc).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let part = |n: &str| {
        String::from_utf8(
            pkg.part(&PartName::new(n).unwrap())
                .unwrap_or_else(|| panic!("{n} missing"))
                .data
                .clone(),
        )
        .unwrap()
    };
    let main = pretty_document_xml(&bytes);
    assert_eq!(main.matches("<w:commentRangeStart").count(), 5);
    assert_eq!(main.matches("<w:commentRangeEnd").count(), 5);
    assert_eq!(main.matches("<w:commentReference").count(), 5);
    let comments = part("/word/comments.xml");
    assert_eq!(comments.matches("<w:comment ").count(), 5);
    assert!(comments.contains(
        r#"<w:comment w:id="0" w:author="Anna Berg" w:date="2026-10-01T09:30:00Z" w:initials="AB">"#
    ));
    assert_eq!(comments.matches("<w:annotationRef/>").count(), 5);
    let ext = part("/word/commentsExtended.xml");
    assert!(
        ext.contains(
            r#"<w15:commentEx w15:paraId="10000002" w15:paraIdParent="10000001" w15:done="0"/>"#
        ),
        "{ext}"
    );
    assert!(
        ext.contains(r#"<w15:commentEx w15:paraId="10000003" w15:done="1"/>"#),
        "{ext}"
    );
    assert!(part("/word/commentsIds.xml")
        .contains(r#"w16cid:paraId="10000004" w16cid:durableId="30000004""#));
    assert!(
        part("/word/commentsExtensible.xml").contains(r#"w16cex:dateUtc="2026-10-04T14:45:00Z""#)
    );
    let ct = &pkg
        .part(&PartName::new("/word/commentsExtended.xml").unwrap())
        .unwrap()
        .content_type;
    assert!(
        ct.ends_with("wordprocessingml.commentsExtended+xml"),
        "{ct}"
    );
    assert_same("59 (no context)", &doc, &reread(&doc));
    insta::assert_snapshot!("document_xml_59", main);
}

#[test]
fn comments_read_tolerantly() {
    // Without commentsExtended every comment is a root; a comment without
    // a range is anchored at its reference; markers between paragraphs
    // open the next / close the previous paragraph.
    let mut doc = Document::new();
    doc.body.clear();
    for t in ["one", "two"] {
        let id = doc.alloc_id();
        doc.body.push(Block::Paragraph(Paragraph::with_text(id, t)));
    }
    let id = doc.body[0].id();
    let c = model_text::Comment::new(&mut doc, model_text::CommentId(7), "X", "c", None);
    doc.comments.push(c);
    if let Block::Paragraph(p) = &mut doc.body[0] {
        let _ = id;
        p.inlines.insert(
            0,
            Inline::CommentStart {
                id: model_text::CommentId(7),
            },
        );
        p.inlines.push(Inline::CommentEnd {
            id: model_text::CommentId(7),
        });
    }
    let bytes = fmt_docx::write(&doc).unwrap();
    let mut pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let main = PartName::new("/word/document.xml").unwrap();
    let xml = String::from_utf8(pkg.part(&main).unwrap().data.clone()).unwrap();
    // Move the start between the paragraphs' boundary and drop the range end.
    let xml = xml
        .replacen(
            r#"<w:p><w:commentRangeStart w:id="7"/>"#,
            r#"<w:commentRangeStart w:id="7"/><w:p>"#,
            1,
        )
        .replacen(r#"<w:commentRangeEnd w:id="7"/>"#, "", 1);
    pkg.insert_part(main, fmt_ooxml::ct::DOCUMENT, xml.into_bytes());
    pkg.remove_part(&PartName::new("/word/commentsExtended.xml").unwrap());
    let bytes = pkg.write(Cursor::new(Vec::new())).unwrap().into_inner();
    let out = fmt_docx::read_with_context(&bytes).unwrap();
    let back = out.document;
    assert_eq!(back.comments.len(), 1);
    let r = back.comment_ranges();
    // Start at 0 (from between the paragraphs), end at the reference.
    assert_eq!((r[0].start, r[0].end), (0, 4));
    assert_eq!(back.body[0].as_paragraph().unwrap().display_text(), "one");
}

#[test]
fn links_bookmarks_cross_references_captions_columns_properties() {
    let out = read_out("provisional-60-links-bookmarks-columns.docx");
    assert_no_new_warnings(&out.warnings);
    let doc = out.document;
    // Hyperlinks: web, e-mail, a bookmark; the Hyperlink character style.
    let links: Vec<(String, model_text::LinkTarget)> = doc
        .paragraphs()
        .flat_map(|p| p.inlines.iter())
        .filter_map(Inline::as_run)
        .filter_map(|r| Some((r.text.clone(), r.link.as_ref()?.target.clone())))
        .collect();
    assert_eq!(
        links,
        [
            (
                "the example site".to_owned(),
                model_text::LinkTarget::Url("https://www.example.com/".into())
            ),
            (
                "info@example.com".to_owned(),
                model_text::LinkTarget::Email {
                    address: "info@example.com".into(),
                    subject: None
                }
            ),
            (
                "the summary".to_owned(),
                model_text::LinkTarget::Bookmark("summary".into())
            ),
        ]
    );
    // Bookmarks and the cross-references to them.
    let names: Vec<String> = doc.bookmarks().into_iter().map(|b| b.name).collect();
    assert_eq!(names, ["results", "summary"]);
    let results = doc.bookmark("results").unwrap();
    assert_eq!(doc.bookmark_text(&results), "results");
    let fields: Vec<(FieldKind, String)> = doc
        .paragraphs()
        .flat_map(|p| p.inlines.iter())
        .filter_map(|i| match i {
            Inline::Field(f) => Some((f.kind.clone(), f.cached.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(
        fields[0],
        (
            FieldKind::PageRef {
                bookmark: "results".into(),
                hyperlink: true
            },
            "1".into()
        )
    );
    assert!(matches!(&fields[1].0, FieldKind::Ref { bookmark, .. } if bookmark == "results"));
    // Captions: SEQ numbered per label; the computed values match the file.
    assert_eq!(doc.captions("Figure").len(), 2);
    assert_eq!(doc.captions("Table").len(), 1);
    let computed =
        doc.computed_fields(&std::collections::HashMap::from([(results.start_block, 1)]));
    for (block, at, value) in &computed {
        let p = doc.find_paragraph(*block).unwrap();
        let mut pos = 0;
        for i in &p.inlines {
            if pos == *at {
                if let Inline::Field(f) = i {
                    assert_eq!(&f.cached, value, "{:?}", f.kind);
                }
            }
            pos += match i {
                Inline::Run(r) => r.text.chars().count(),
                _ => 1,
            };
        }
    }
    // Columns: a two-column section with a column break, a three-column one
    // with a separator line.
    let cols: Vec<(u8, bool)> = doc
        .sections
        .iter()
        .map(|s| (s.columns.count, s.columns.separator))
        .collect();
    assert_eq!(cols, [(1, false), (2, false), (3, true), (1, false)]);
    assert!(doc.paragraphs().any(|p| p
        .inlines
        .contains(&Inline::Break(model_text::BreakKind::Column))));
    // Document properties.
    let p = &doc.properties;
    assert_eq!(p.title.as_deref(), Some("Links and columns"));
    assert_eq!(p.subject.as_deref(), Some("Reference suite"));
    assert_eq!(p.author.as_deref(), Some("Anna Berg"));
    assert_eq!(p.keywords.as_deref(), Some("links columns"));
    // Our output keeps all of it.
    let bytes = fmt_docx::write_with_context(&doc, &out.context).unwrap();
    let main = pretty_document_xml(&bytes);
    assert_eq!(main.matches("<w:hyperlink").count(), 3, "{main}");
    assert!(main.contains(r#"<w:bookmarkStart w:id="0" w:name="results"/>"#));
    assert!(main.contains(r#"w:instr=" PAGEREF results \h ""#));
    assert!(
        main.contains(r#"<w:cols w:space="226" w:num="3" w:sep="1"/>"#),
        "{main}"
    );
    let back = fmt_docx::read_with_context(&bytes).unwrap();
    assert!(back.warnings.is_empty(), "{:?}", back.warnings);
    assert_same("60", &doc, &back.document);
    insta::assert_snapshot!("document_xml_60", main);
}

// --- pagination round 3 (P9-W2) ----------------------------------------------------

/// A one-cell row with `text` and row properties `props`.
fn row(doc: &mut Document, text: &str, props: model_text::RowProperties) -> model_text::TableRow {
    let p = Paragraph::with_text(doc.alloc_id(), text);
    model_text::TableRow {
        id: doc.alloc_id(),
        props,
        cells: vec![model_text::TableCell::new(
            doc.alloc_id(),
            Default::default(),
            vec![Block::Paragraph(p)],
        )],
    }
}

#[test]
fn nested_table_header_and_cant_split_roundtrip() {
    let mut doc = Document::new();
    let header = model_text::RowProperties {
        header: true,
        ..Default::default()
    };
    let keep = model_text::RowProperties {
        cant_split: true,
        ..Default::default()
    };
    let inner_rows = vec![
        row(&mut doc, "inner head", header),
        row(&mut doc, "inner kept", keep),
        row(&mut doc, "inner plain", Default::default()),
    ];
    let inner = model_text::Table {
        id: doc.alloc_id(),
        props: Default::default(),
        rows: inner_rows,
    };
    let after = Paragraph::with_text(doc.alloc_id(), "");
    let mut outer_row = row(&mut doc, "outer", keep);
    outer_row.cells[0].blocks.push(Block::Table(inner));
    outer_row.cells[0].blocks.push(Block::Paragraph(after));
    let outer_head = row(&mut doc, "outer head", header);
    let outer = model_text::Table {
        id: doc.alloc_id(),
        props: Default::default(),
        rows: vec![outer_head, outer_row],
    };
    doc.body = vec![
        Block::Table(outer),
        Block::Paragraph(Paragraph::new(doc.alloc_id())),
    ];
    let back = reread(&doc);
    let t = back.body[0].as_table().unwrap();
    assert!(t.rows[0].props.header && !t.rows[0].props.cant_split);
    assert!(t.rows[1].props.cant_split && !t.rows[1].props.header);
    let nested = t.rows[1].cells[0]
        .blocks
        .iter()
        .find_map(|b| b.as_table())
        .expect("nested table");
    let flags: Vec<(bool, bool)> = nested
        .rows
        .iter()
        .map(|r| (r.props.header, r.props.cant_split))
        .collect();
    assert_eq!(flags, vec![(true, false), (false, true), (false, false)]);
}

#[test]
fn endnotes_at_section_end_and_note_numbering_roundtrip() {
    let mut doc = Document::new();
    doc.settings.endnotes_at_section_end = true;
    let mut end1 = Paragraph::with_text(doc.alloc_id(), "first section");
    end1.props.section_end = Some(model_text::SectionId(7));
    let last = Paragraph::with_text(doc.alloc_id(), "second section");
    doc.body = vec![Block::Paragraph(end1), Block::Paragraph(last)];
    let mut first = model_text::Section::new(model_text::SectionId(7), doc.page.clone());
    first.footnote_numbering = Some(model_text::NoteNumbering {
        format: Some(LevelKind::LowerLetter),
        start: None,
        restart: model_text::NoteRestart::EachPage,
    });
    first.endnote_numbering = Some(model_text::NoteNumbering {
        format: Some(LevelKind::UpperRoman),
        start: Some(2),
        restart: model_text::NoteRestart::EachSection,
    });
    let second = model_text::Section::new(model_text::SectionId(8), doc.page.clone());
    doc.sections = vec![first.clone(), second];
    doc.sync_sections();
    let back = reread(&doc);
    assert!(back.settings.endnotes_at_section_end);
    assert_eq!(back.sections.len(), 2);
    assert_eq!(
        back.sections[0].footnote_numbering,
        first.footnote_numbering
    );
    assert_eq!(back.sections[0].endnote_numbering, first.endnote_numbering);
    assert_eq!(back.sections[1].footnote_numbering, None);
    // Written back again, unchanged (the settings keep `w:pos` first in `w:endnotePr`).
    let again = reread(&back);
    assert_eq!(again.sections, back.sections);
    let bytes = fmt_docx::write(&back).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let xml = String::from_utf8(
        pkg.part(&PartName::new("/word/settings.xml").unwrap())
            .unwrap()
            .data
            .clone(),
    )
    .unwrap();
    assert!(
        xml.contains(r#"<w:endnotePr><w:pos w:val="sectEnd"/>"#),
        "{xml}"
    );
}

// --- style sets, properties, templates (P9-W3) -------------------------------------

#[test]
fn style_sets_properties_and_template() {
    let out = read_out("provisional-63-style-sets-properties.docx");
    let doc = &out.document;
    assert!(!out.context.template);
    assert_eq!(doc.properties.company.as_deref(), Some("ACME Corp"));
    assert_eq!(
        doc.properties.title.as_deref(),
        Some("Style sets and properties")
    );
    let shaded = doc.styles.get("ShadedHeading").unwrap();
    assert_eq!(shaded.kind, model_text::StyleKind::Linked);
    assert!(shaded.paragraph.shading.is_some());
    assert_eq!(shaded.run.all_caps, Some(true));
    let lined = doc.styles.get("LinedHeading").unwrap();
    assert_eq!(lined.run.small_caps, Some(true));
    assert!(lined.run.char_spacing.is_some());
    // Fields: TITLE, SUBJECT, AUTHOR, KEYWORDS and DOCPROPERTY Company compute from the properties.
    let kinds: Vec<FieldKind> = doc
        .paragraphs()
        .flat_map(|p| p.inlines.iter())
        .filter_map(|i| match i {
            Inline::Field(f) => Some(f.kind.clone()),
            _ => None,
        })
        .collect();
    assert!(kinds.contains(&FieldKind::DocProperty {
        name: "Company".into()
    }));
    assert!(kinds.contains(&FieldKind::Keywords) && kinds.contains(&FieldKind::Subject));
    let values: Vec<String> = doc
        .computed_fields(&Default::default())
        .into_iter()
        .map(|(_, _, v)| v)
        .collect();
    assert!(values.iter().any(|v| v == "ACME Corp"), "{values:?}");
    // Written back: company in app.xml, the words-only underline, the DOCPROPERTY field.
    let bytes = fmt_docx::write_with_context(doc, &out.context).unwrap();
    let pkg = Package::open(Cursor::new(bytes.as_slice())).unwrap();
    let part = |n: &str| {
        String::from_utf8(pkg.part(&PartName::new(n).unwrap()).unwrap().data.clone()).unwrap()
    };
    assert!(part("/docProps/app.xml").contains("<Company>ACME Corp</Company>"));
    let xml = part("/word/document.xml");
    assert!(xml.contains(r#"<w:u w:val="words"/>"#), "{xml}");
    assert!(xml.contains("DOCPROPERTY Company"), "{xml}");

    let tpl = read_out("provisional-64-template-memo.dotx");
    assert!(tpl.context.template);
    assert_eq!(tpl.document.properties.title.as_deref(), Some("Memo"));
    assert!(tpl.document.plain_text().contains("[Recipient names]"));
    let again = fmt_docx::write_with_context(&tpl.document, &tpl.context).unwrap();
    assert!(
        fmt_docx::read_with_context(&again)
            .unwrap()
            .context
            .template
    );
}
