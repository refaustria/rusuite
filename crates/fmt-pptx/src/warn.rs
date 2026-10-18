//! Coded reader warnings (W-26, P9-X2): every note of the reader has a
//! stable code with an English template in [`TEMPLATES`]; the UI's shared
//! catalog holds the same text under `reader.<code>` in every language
//! (`packages/ui-shared/src/i18n/locales/*.json`) and translates the
//! warning from its code and parameters. Same scheme as `fmt-docx` and `fmt-xlsx`.

use std::collections::{BTreeMap, HashMap};
use std::fmt;

use serde::{Deserialize, Serialize};

/// A note of the reader about content that was dropped or approximated:
/// a stable `code` (the UI translates it, docs/i18n.md "Reader
/// warnings"), its parameters and the English `text` (the fallback).
/// Repeats are merged (`count`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderWarning {
    /// Stable identifier, e.g. `pptx.fill.gradient`.
    pub code: String,
    /// Values of the `{name}` placeholders of the message.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
    /// The English message (without the count).
    pub text: String,
    /// How often it occurred.
    pub count: usize,
}

impl ReaderWarning {
    /// The English line: the text, with ` (Nx)` for repeats.
    pub fn line(&self) -> String {
        match self.count {
            0 | 1 => self.text.clone(),
            n => format!("{} ({n}x)", self.text),
        }
    }
}

/// A warning while it is collected: the code and the parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Note {
    pub(crate) code: &'static str,
    pub(crate) params: Vec<(&'static str, String)>,
}

/// `note!("pptx.line.dash", value = val)`: a [`Note`] whose
/// parameters are named like the template's placeholders.
macro_rules! note {
    ($code:literal $(, $k:ident = $v:expr)* $(,)?) => {
        $crate::warn::Note::new($code, vec![$((stringify!($k), ($v).to_string())),*])
    };
}
pub(crate) use note;

impl Note {
    pub(crate) fn new(code: &'static str, params: Vec<(&'static str, String)>) -> Self {
        Self { code, params }
    }

    /// Adds the parameter `key` (the context the caller knows, e.g. the
    /// sheet of a note of a sub-reader).
    pub(crate) fn with(mut self, key: &'static str, value: impl fmt::Display) -> Self {
        self.params.push((key, value.to_string()));
        self
    }

    /// The English text: the template with its placeholders filled.
    pub(crate) fn text(&self) -> String {
        let template = template(self.code);
        debug_assert!(
            template.is_some(),
            "reader warning {} has no template",
            self.code
        );
        let template = template.unwrap_or(self.code);
        debug_assert!(
            placeholders(template).len() == self.params.len()
                && self
                    .params
                    .iter()
                    .all(|(k, _)| placeholders(template).contains(k)),
            "reader warning {}: parameters {:?} do not match {template:?}",
            self.code,
            self.params.iter().map(|(k, _)| *k).collect::<Vec<_>>()
        );
        fill(template, &self.params)
    }
}

impl fmt::Display for Note {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text())
    }
}

/// The names of the `{name}` placeholders of `template`.
pub(crate) fn placeholders(template: &str) -> Vec<&str> {
    template
        .split('{')
        .skip(1)
        .filter_map(|s| s.split_once('}').map(|(name, _)| name))
        .collect()
}

/// `template` with each `{name}` replaced by its value (one pass: values
/// are not scanned again).
fn fill(template: &str, params: &[(&'static str, String)]) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let mut rest = template;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.split_once('}') {
            Some((name, tail)) => {
                match params.iter().find(|(k, _)| *k == name) {
                    Some((_, v)) => out.push_str(v),
                    None => {
                        out.push('{');
                        out.push_str(name);
                        out.push('}');
                    }
                }
                rest = tail;
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// The English template of `code`.
pub(crate) fn template(code: &str) -> Option<&'static str> {
    TEMPLATES.iter().find(|(c, _)| *c == code).map(|(_, t)| *t)
}

/// Collects the notes of one read, merging repeats into one entry with a
/// count.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    details: Vec<ReaderWarning>,
    index: HashMap<String, usize>,
}

impl Warnings {
    pub(crate) fn add(&mut self, note: Note) {
        let text = note.text();
        match self.index.get(&text) {
            Some(&i) => self.details[i].count += 1,
            None => {
                self.index.insert(text.clone(), self.details.len());
                self.details.push(ReaderWarning {
                    code: note.code.to_owned(),
                    params: note
                        .params
                        .into_iter()
                        .map(|(k, v)| (k.to_owned(), v))
                        .collect(),
                    text,
                    count: 1,
                });
            }
        }
    }

    /// The English lines (` (Nx)` for repeats).
    #[cfg(test)]
    pub(crate) fn into_vec(self) -> Vec<String> {
        self.details.iter().map(ReaderWarning::line).collect()
    }

    /// `(lines, details)`.
    pub(crate) fn finish(self) -> (Vec<String>, Vec<ReaderWarning>) {
        (
            self.details.iter().map(ReaderWarning::line).collect(),
            self.details,
        )
    }
}

/// The codes of a chart part's notes from `fmt_ooxml::chart` (English
/// strings there).
pub(crate) fn chart_note(msg: &str) -> Note {
    const UNSUPPORTED: &str = " chart is not supported; kept unchanged (read-only)";
    const ELEMENTS: &str = "chart elements dropped: ";
    if let Some(kind) = msg.strip_suffix(UNSUPPORTED) {
        note!("pptx.chart.unsupportedKind", kind = kind)
    } else if let Some(names) = msg.strip_prefix(ELEMENTS) {
        note!("pptx.chart.elementsDropped", names = names)
    } else if msg == "chart user shapes / external data dropped" {
        note!("pptx.chart.userShapes")
    } else if msg == "chart without a plot area or chart group" {
        note!("pptx.chart.noPlotArea")
    } else {
        note!("pptx.chart.other", text = msg)
    }
}

/// Every code with its English template (the text of `reader.<code>` in
/// the UI's English catalog; a test compares them).
pub(crate) const TEMPLATES: &[(&str, &str)] = &[
    ("pptx.anim.classDropped", "animations of class {class} dropped"),
    ("pptx.anim.effectDropped", "animation effect {class} #{preset} dropped"),
    ("pptx.anim.noTarget", "animations without a shape target dropped"),
    ("pptx.anim.droppedShapes", "animations of dropped shapes dropped"),
    ("pptx.anim.badPath", "motion paths with an unreadable path dropped"),
    ("pptx.anim.triggered", "triggered animations dropped"),
    ("pptx.anim.outsideMain", "animation timing nodes outside the main sequence dropped"),
    ("pptx.anim.noPreset", "animations without a preset dropped"),
    ("pptx.anim.paragraphs", "animations of text paragraphs applied to the whole shape"),
    ("pptx.color.alpha", "color transparency (a:alpha) dropped"),
    ("pptx.color.modifier", "color modifier {name} dropped"),
    ("pptx.color.preset", "preset color {name} read as black"),
    ("pptx.color.hsl", "HSL colors (a:hslClr) dropped"),
    ("pptx.fill.gradient", "gradient fill read as its first color"),
    ("pptx.fill.pattern", "pattern fill read as its foreground color"),
    ("pptx.fill.picture", "picture fill of a shape dropped"),
    ("pptx.fill.group", "group fill (a:grpFill) dropped"),
    ("pptx.line.dash", "line dash {value} read as dashed"),
    ("pptx.line.customDash", "custom line dash read as dashed"),
    ("pptx.line.compound", "line compound type {value} read as single"),
    ("pptx.line.arrowhead", "arrowhead {kind} read as a triangle"),
    ("pptx.text.anchor", "text anchor {value} read as top"),
    ("pptx.text.direction", "text direction {value} read as horizontal"),
    ("pptx.text.rotation", "text rotation (a:bodyPr rot) dropped"),
    ("pptx.text.warp", "text warp (WordArt) dropped"),
    ("pptx.text.threeD", "3-D text dropped"),
    ("pptx.text.equations", "equations and alternate text content dropped"),
    ("pptx.text.contentDropped", "text content {name} dropped"),
    ("pptx.text.listStyles", "shape list styles (a:lstStyle) dropped"),
    ("pptx.bullet.startAt", "numbered list start value (startAt) dropped"),
    ("pptx.bullet.scheme", "numbering scheme {scheme} read as arabicPeriod"),
    ("pptx.bullet.picture", "picture bullets read as •"),
    ("pptx.paragraph.alignment", "paragraph alignment {value} read as justified"),
    ("pptx.paragraph.rtl", "right-to-left paragraph direction dropped"),
    ("pptx.paragraph.tabs", "tab stops dropped"),
    ("pptx.paragraph.propertyDropped", "paragraph property {name} dropped"),
    ("pptx.run.caps", "capitalization (cap) dropped"),
    ("pptx.run.spacing", "character spacing (spc) dropped"),
    ("pptx.run.gradient", "gradient text fill read as its first color"),
    ("pptx.run.noFill", "invisible text (a:noFill) read as normal text"),
    ("pptx.run.outline", "text outline dropped"),
    ("pptx.run.effects", "text effects dropped"),
    ("pptx.run.mouseOver", "mouse-over hyperlinks dropped"),
    ("pptx.run.propertyDropped", "run property {name} dropped"),
    ("pptx.geom.adjust", "adjust value {name} of {shape} dropped"),
    ("pptx.geom.preset", "preset geometry {preset} read as rectangle"),
    ("pptx.geom.noPaths", "custom geometry without paths read as rectangle"),
    ("pptx.geom.guide", "custom geometry guide {guide} unknown (read as 0)"),
    ("pptx.geom.formula", "custom geometry formula {formula} unknown (read as 0)"),
    ("pptx.geom.command", "custom geometry command {command} dropped"),
    ("pptx.link.jump", "slide show jump {jump} dropped"),
    ("pptx.link.customShowNoId", "custom show link without id dropped"),
    ("pptx.link.actions", "click actions other than hyperlinks and slide jumps dropped (programs, macros, sounds, other files)"),
    ("pptx.link.otherParts", "hyperlinks to other parts (files, custom shows) dropped"),
    ("pptx.link.dangling", "hyperlinks with a dangling relationship dropped"),
    ("pptx.link.missingSlide", "hyperlinks to missing slides dropped"),
    ("pptx.background.pattern", "background pattern {preset} drawn as 50 %"),
    ("pptx.background.noImage", "background picture without image dropped"),
    ("pptx.background.danglingImage", "background picture with dangling relationship {rid} dropped"),
    ("pptx.background.imageMissing", "image part {part} missing; background picture dropped"),
    ("pptx.theme.relationships", "{part}: theme has its own relationships; a generated theme part is written"),
    ("pptx.theme.noMaster", "the theme file has no slide master: the Office master is kept"),
    ("pptx.slide.dangling", "slide with dangling relationship dropped"),
    ("pptx.notes.dropped", "speaker notes dropped"),
    ("pptx.comments.dropped", "comments dropped"),
    ("pptx.images.unused", "unused or unsupported images dropped"),
    ("pptx.package.partDropped", "part {part} ({contentType}) dropped"),
    ("pptx.sections.reordered", "sections out of slide order rearranged"),
    ("pptx.customShow.noId", "custom show without id dropped"),
    ("pptx.customShow.dropped", "custom show \"{name}\" dropped (no or a duplicate name or id)"),
    ("pptx.customShow.missingSlide", "custom show \"{name}\": a slide that is not in the presentation dropped"),
    ("pptx.layout.typeMapped", "slide layout type {layoutType} mapped to Title and Content"),
    ("pptx.layout.placeholderType", "layout placeholder type {phType} dropped"),
    ("pptx.layout.placeholderNoPosition", "layout placeholder without position dropped"),
    ("pptx.master.placeholderType", "master placeholder type {phType} dropped"),
    ("pptx.connector.missingShapes", "connector attachments to missing shapes dropped"),
    ("pptx.connector.groups", "connector attachments to groups or connectors dropped"),
    ("pptx.connector.arrowheads", "arrowheads dropped"),
    ("pptx.connector.customGeometry", "custom connector geometry read as a straight line"),
    ("pptx.connector.kind", "connector {kind} read as a straight line"),
    ("pptx.transition.soundMissing", "transition sound file missing; sound dropped"),
    ("pptx.transition.fadeThroughBlack", "fade-through-black transition read as fade"),
    ("pptx.transition.dropped", "slide transition {name} dropped"),
    ("pptx.shape.graphicFrames", "graphic frames (diagrams, embedded objects) dropped"),
    ("pptx.shape.ink", "ink (content parts) dropped"),
    ("pptx.shape.elementDropped", "shape element {name} dropped"),
    ("pptx.shape.mouseOver", "mouse-over actions dropped"),
    ("pptx.shape.noPosition", "shape without position dropped"),
    ("pptx.chart.rotation", "chart rotation and flips dropped"),
    ("pptx.chart.dangling", "chart with a dangling relationship dropped"),
    ("pptx.chart.unreadable", "unreadable chart dropped ({error})"),
    ("pptx.chart.oleData", "chart data embedded as an OLE object dropped (the chart keeps its data)"),
    ("pptx.chart.unsupportedKind", "{kind} chart is not supported; kept unchanged (read-only)"),
    ("pptx.chart.userShapes", "chart user shapes / external data dropped"),
    ("pptx.chart.noPlotArea", "chart without a plot area or chart group"),
    ("pptx.chart.elementsDropped", "chart elements dropped: {names}"),
    ("pptx.chart.other", "{text}"),
    ("pptx.media.linked", "linked (not embedded) audio/video kept as its poster picture"),
    ("pptx.media.missing", "audio/video part missing; kept as its poster picture"),
    ("pptx.placeholder.plainText", "placeholder type {phType} read as a plain text box"),
    ("pptx.table.rotation", "table rotation and flips dropped"),
    ("pptx.table.rtl", "right-to-left tables read as left-to-right"),
    ("pptx.table.inlineStyle", "inline table style dropped"),
    ("pptx.table.background", "table background fill dropped"),
    ("pptx.table.empty", "empty table dropped"),
    ("pptx.table.beyondGrid", "table cells beyond the grid dropped"),
    ("pptx.table.mergesSplit", "inconsistent merged table cells split"),
    ("pptx.table.justifiedAlign", "justified vertical cell alignment read as top"),
    ("pptx.table.cellDirection", "cell text direction {value} read as horizontal"),
    ("pptx.table.threeD", "3-D cell effects dropped"),
    ("pptx.picture.linked", "linked (external) pictures dropped"),
    ("pptx.picture.noImage", "picture without image dropped"),
    ("pptx.picture.tiled", "tiled picture fill read as stretched"),
    ("pptx.picture.duotone", "picture duotone without two colours dropped"),
    ("pptx.picture.effect", "picture effect {effect} dropped"),
    ("pptx.picture.effects", "picture effects other than an outer shadow dropped"),
    ("pptx.picture.danglingImage", "picture with dangling relationship {rid} dropped"),
    ("pptx.picture.imageMissing", "image part {part} missing; picture dropped"),
    ("pptx.tableStyle.diagonal", "diagonal table style borders dropped"),
    ("pptx.tableStyle.threeD", "3-D table style effects dropped"),
    ("pptx.tableStyle.partDropped", "table style part {part} dropped"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_fill_placeholders_and_merge_repeats() {
        let mut w = Warnings::default();
        w.add(note!("pptx.line.dash", value = "sysDot"));
        w.add(note!("pptx.text.warp"));
        w.add(note!("pptx.line.dash", value = "sysDot"));
        w.add(note!("pptx.chart.unreadable", error = "{x} stays"));
        let (lines, details) = w.finish();
        assert_eq!(
            lines,
            [
                "line dash sysDot read as dashed (2x)",
                "text warp (WordArt) dropped",
                "unreadable chart dropped ({x} stays)"
            ]
        );
        assert_eq!(details[0].count, 2);
        assert_eq!(details[0].params["value"], "sysDot");
        let json = serde_json::to_value(&details[1]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"code": "pptx.text.warp", "text": "text warp (WordArt) dropped", "count": 1})
        );
    }

    #[test]
    fn chart_notes_from_fmt_ooxml_get_codes() {
        let n = chart_note("lineChart3D chart is not supported; kept unchanged (read-only)");
        assert_eq!(n.code, "pptx.chart.unsupportedKind");
        assert_eq!(n.params, [("kind", "lineChart3D".to_owned())]);
        assert_eq!(
            chart_note("chart elements dropped: a, b").code,
            "pptx.chart.elementsDropped"
        );
        assert_eq!(chart_note("something new").text(), "something new");
    }

    /// The value of `key` in a flat JSON catalog (`"key": "value"` on one
    /// line; the catalogs only escape `\"` and `\\` in these messages).
    fn catalog_value(json: &str, key: &str) -> Option<String> {
        let start = json.find(&format!("\"{key}\": \""))? + key.len() + 5;
        let mut out = String::new();
        let mut chars = json[start..].chars();
        while let Some(c) = chars.next() {
            match c {
                '"' => return Some(out),
                '\\' => out.push(chars.next()?),
                c => out.push(c),
            }
        }
        None
    }

    /// Every code is unique, used in the sources, and has the same text
    /// in the UI's English catalog (`reader.<code>`) and a German message
    /// with the same placeholders.
    #[test]
    fn templates_match_the_ui_catalogs() {
        let dir = env!("CARGO_MANIFEST_DIR");
        let catalog = |lang: &str| {
            let path = format!("{dir}/../../packages/ui-shared/src/i18n/locales/{lang}.json");
            std::fs::read_to_string(path).unwrap()
        };
        let (en, de) = (catalog("en"), catalog("de"));
        let src: String = std::fs::read_dir(format!("{dir}/src"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|x| x == "rs") && !p.ends_with("warn.rs"))
            .map(|p| std::fs::read_to_string(p).unwrap())
            .collect();
        let mut seen = std::collections::HashSet::new();
        for (code, template) in TEMPLATES {
            assert!(seen.insert(*code), "{code}: twice");
            assert!(code.starts_with("pptx."), "{code}");
            let key = format!("reader.{code}");
            assert_eq!(
                catalog_value(&en, &key).as_deref(),
                Some(*template),
                "{key}: packages/ui-shared/src/i18n/locales/en.json"
            );
            let german =
                catalog_value(&de, &key).unwrap_or_else(|| panic!("{key}: no German message"));
            let mut a = placeholders(template);
            let mut b = placeholders(&german);
            a.sort_unstable();
            b.sort_unstable();
            assert_eq!(a, b, "{key}: placeholders of the German message");
            let used = src.contains(&format!("\"{code}\"")) || code.starts_with("pptx.chart.");
            assert!(used, "{code}: not used");
        }
        // Every code used in the sources has a template.
        for part in src.split("note!(\"").skip(1) {
            let code = part.split('"').next().unwrap();
            assert!(template(code).is_some(), "{code}: no template");
        }
        assert!(TEMPLATES.len() >= 110, "{}", TEMPLATES.len());
    }
}
