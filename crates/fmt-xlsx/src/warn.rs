//! Coded reader warnings (W-26, P9-X2): every note of the reader has a
//! stable code with an English template in [`TEMPLATES`]; the UI's shared
//! catalog holds the same text under `reader.<code>` in every language
//! (`packages/ui-shared/src/i18n/locales/*.json`) and translates the
//! warning from its code and parameters. Same scheme as `fmt-docx`.

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
    /// Stable identifier, e.g. `xlsx.cell.isoDate`.
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

/// `note!("xlsx.cell.isoDate", sheet = name, cell = at)`: a [`Note`] whose
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

/// Collects the notes of one read: the English lines in order (every
/// occurrence, as [`ReadOutput::warnings`](crate::ReadOutput) always had
/// them) and the coded warnings with repeats merged.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    lines: Vec<String>,
    details: Vec<ReaderWarning>,
    index: HashMap<String, usize>,
}

impl Warnings {
    pub(crate) fn push(&mut self, note: Note) {
        let text = note.text();
        self.lines.push(text.clone());
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

    pub(crate) fn extend(&mut self, notes: impl IntoIterator<Item = Note>) {
        for n in notes {
            self.push(n);
        }
    }

    /// `(lines, details)`.
    pub(crate) fn finish(self) -> (Vec<String>, Vec<ReaderWarning>) {
        (self.lines, self.details)
    }
}

/// The codes of a chart part's notes from `fmt_ooxml::chart` (English
/// strings there) in the chart part `part` (the caller adds the sheet).
pub(crate) fn chart_note(msg: &str, part: &str) -> Note {
    const UNSUPPORTED: &str = " chart is not supported; kept unchanged (read-only)";
    const ELEMENTS: &str = "chart elements dropped: ";
    let n = if let Some(kind) = msg.strip_suffix(UNSUPPORTED) {
        note!("xlsx.chart.unsupportedKind", kind = kind)
    } else if let Some(names) = msg.strip_prefix(ELEMENTS) {
        note!("xlsx.chart.elementsDropped", names = names)
    } else if msg == "chart user shapes / external data dropped" {
        note!("xlsx.chart.userShapes")
    } else if msg == "chart without a plot area or chart group" {
        note!("xlsx.chart.noPlotArea")
    } else {
        note!("xlsx.chart.other", text = msg)
    };
    n.with("part", part)
}

/// Every code with its English template (the text of `reader.<code>` in
/// the UI's English catalog; a test compares them).
pub(crate) const TEMPLATES: &[(&str, &str)] = &[
    // Workbook and package.
    ("xlsx.styles.tableStylesDropped", "table styles dropped: {error}"),
    ("xlsx.styles.gradient", "gradient fills approximated (no fill)"),
    ("xlsx.styles.numFmtUndefined", "number format id {id} is not defined (locale-dependent built-in); read as General"),
    ("xlsx.styles.pivotTableStyle", "pivot table style \"{name}\" is not supported; dropped"),
    ("xlsx.styles.tableStyleDuplicate", "table style \"{name}\" is duplicate or built-in; dropped"),
    ("xlsx.sheet.noPart", "sheet \"{sheet}\" has no part; dropped"),
    ("xlsx.sheet.notWorksheet", "sheet \"{sheet}\" is not a worksheet ({relType}); dropped"),
    ("xlsx.sheet.allHidden", "sheet \"{sheet}\": every sheet is hidden; this one is shown"),
    ("xlsx.chartSheet.noChart", "chart sheet \"{sheet}\" has no chart"),
    ("xlsx.package.partDropped", "part {part} ({contentType}) dropped"),
    ("xlsx.name.sheetMissing", "defined name \"{name}\": its sheet is missing; dropped"),
    ("xlsx.name.dropped", "defined name \"{name}\" ({formula}) dropped: {error}"),
    // Sheet contents.
    ("xlsx.sheet.mergeInvalid", "sheet \"{sheet}\": invalid merged cells dropped: {ranges}"),
    ("xlsx.sheet.backgroundPicture", "sheet \"{sheet}\": background picture dropped"),
    ("xlsx.sheet.oleObjects", "sheet \"{sheet}\": OLE objects dropped"),
    ("xlsx.sheet.formControls", "sheet \"{sheet}\": form controls dropped"),
    ("xlsx.formula.sharedNoMaster", "sheet \"{sheet}\": {cell}: shared formula {index} has no master; cached value kept"),
    ("xlsx.formula.dataTable", "sheet \"{sheet}\": {cell}: data table formula dropped; cached value kept"),
    ("xlsx.formula.unsupported", "sheet \"{sheet}\": {cell}: formula \"{formula}\" not supported ({error}); cached value kept"),
    ("xlsx.cell.sharedStringRange", "sheet \"{sheet}\": {cell}: shared string {index} out of range"),
    ("xlsx.cell.unknownError", "sheet \"{sheet}\": {cell}: unknown error \"{value}\" kept as text"),
    ("xlsx.cell.isoDate", "sheet \"{sheet}\": {cell}: ISO date cell kept as text"),
    ("xlsx.cell.invalidNumber", "sheet \"{sheet}\": {cell}: invalid number \"{value}\" dropped"),
    ("xlsx.link.badRange", "sheet \"{sheet}\": hyperlink on \"{range}\" dropped"),
    ("xlsx.link.noTarget", "sheet \"{sheet}\": hyperlink on {range} without target dropped"),
    ("xlsx.link.dropped", "sheet \"{sheet}\": hyperlinks dropped: {error}"),
    // AutoFilter and sort (a sheet's, or a table part's).
    ("xlsx.filter.noRange", "sheet \"{sheet}\": auto filter without a valid range dropped"),
    ("xlsx.filter.unsupportedSort", "sheet \"{sheet}\": unsupported sort condition dropped"),
    ("xlsx.filter.unsupportedColumn", "sheet \"{sheet}\": unsupported filter of column {column} dropped (time groups or other dynamic filters)"),
    ("xlsx.filter.outsideRange", "sheet \"{sheet}\": filter columns outside the AutoFilter range dropped"),
    ("xlsx.tableFilter.noRange", "{part}: auto filter without a valid range dropped"),
    ("xlsx.tableFilter.unsupportedSort", "{part}: unsupported sort condition dropped"),
    ("xlsx.tableFilter.unsupportedColumn", "{part}: unsupported filter of column {column} dropped (time groups or other dynamic filters)"),
    // Conditional formatting, data validation, sparklines.
    ("xlsx.cf.noRange", "sheet \"{sheet}\": conditional formatting without a valid sqref dropped"),
    ("xlsx.cf.ruleDropped", "sheet \"{sheet}\": conditional formatting rule dropped ({error})"),
    ("xlsx.cf.x14Dropped", "sheet \"{sheet}\": {count} Excel 2010 conditional formatting extension(s) (x14) dropped"),
    ("xlsx.validation.dropped", "sheet \"{sheet}\": data validation dropped ({error})"),
    ("xlsx.sparkline.incomplete", "sheet \"{sheet}\": a sparkline without data or location dropped"),
    ("xlsx.sparkline.dropped", "sheet \"{sheet}\": sparklines dropped ({error})"),
    // Tables.
    ("xlsx.table.noRange", "{part}: table without a range dropped"),
    ("xlsx.table.formulaDropped", "{part}: table formula \"{formula}\" dropped"),
    ("xlsx.table.missing", "sheet \"{sheet}\": table {part} is missing"),
    ("xlsx.table.columnsFixed", "sheet \"{sheet}\": table \"{name}\" has {columns} columns for a {width}-column range; columns fixed"),
    ("xlsx.table.dropped", "sheet \"{sheet}\": table \"{name}\" dropped ({error})"),
    // Drawings: charts, pictures, other objects.
    ("xlsx.drawing.relMissing", "sheet \"{sheet}\": drawing {rid} is missing"),
    ("xlsx.drawing.missing", "sheet \"{sheet}\": drawing {part} is missing"),
    ("xlsx.drawing.graphicFrames", "sheet \"{sheet}\": graphic frames (SmartArt, tables, …) dropped"),
    ("xlsx.drawing.unsupportedImages", "sheet \"{sheet}\": pictures of unsupported image types dropped"),
    ("xlsx.drawing.objects", "sheet \"{sheet}\": drawing objects dropped"),
    ("xlsx.drawing.shapes", "sheet \"{sheet}\": shapes dropped"),
    ("xlsx.drawing.groups", "sheet \"{sheet}\": shape groups dropped"),
    ("xlsx.chart.missing", "sheet \"{sheet}\": chart {rid} of {part} is missing"),
    ("xlsx.chart.dropped", "sheet \"{sheet}\": charts dropped: {error}"),
    ("xlsx.chart.unsupportedKind", "sheet \"{sheet}\": {part}: {kind} chart is not supported; kept unchanged (read-only)"),
    ("xlsx.chart.userShapes", "sheet \"{sheet}\": {part}: chart user shapes / external data dropped"),
    ("xlsx.chart.noPlotArea", "sheet \"{sheet}\": {part}: chart without a plot area or chart group"),
    ("xlsx.chart.elementsDropped", "sheet \"{sheet}\": {part}: chart elements dropped: {names}"),
    ("xlsx.chart.other", "sheet \"{sheet}\": {part}: {text}"),
    ("xlsx.pivotChart.unbound", "sheet \"{sheet}\": the PivotChart of \"{source}\" has no pivot table; kept as a chart"),
    ("xlsx.picture.noImage", "sheet \"{sheet}\": a picture of {part} has no image; dropped"),
    ("xlsx.picture.dropped", "sheet \"{sheet}\": pictures dropped: {error}"),
    // Notes and threaded comments.
    ("xlsx.comment.orphanReply", "sheet \"{sheet}\": reply {id} without its comment dropped"),
    ("xlsx.comment.secondThread", "sheet \"{sheet}\": second comment thread on {cell} dropped"),
    ("xlsx.comment.dropped", "sheet \"{sheet}\": comments dropped: {error}"),
    ("xlsx.note.noVml", "sheet \"{sheet}\": notes without a VML drawing: default boxes"),
    ("xlsx.note.orphanVml", "sheet \"{sheet}\": legacy drawing without notes dropped"),
    ("xlsx.note.dropped", "sheet \"{sheet}\": notes dropped: {error}"),
    // Pivot tables.
    ("xlsx.pivotCache.missing", "pivot cache {id}: part missing; dropped"),
    ("xlsx.pivotCache.unsupported", "pivot cache {id}: {reason} not supported; kept read-only"),
    ("xlsx.pivotCache.refreshFailed", "pivot cache {id}: refresh on load failed: {error}"),
    ("xlsx.pivot.partMissing", "sheet \"{sheet}\": pivot table part missing"),
    ("xlsx.pivot.noCache", "sheet \"{sheet}\": pivot table without its cache dropped"),
    ("xlsx.pivot.unsupported", "sheet \"{sheet}\": pivot table \"{name}\": {reason} not supported; kept read-only"),
    ("xlsx.pivot.dropped", "sheet \"{sheet}\": pivot tables dropped: {error}"),
    // Slicers.
    ("xlsx.slicerCache.relMissing", "slicer cache {rid} is missing"),
    ("xlsx.slicerCache.unreadable", "{part}: unreadable slicer cache dropped"),
    ("xlsx.slicerCache.noName", "{part}: slicer cache without a name dropped"),
    ("xlsx.slicerCache.noTable", "{part}: table slicer cache without a table dropped"),
    ("xlsx.slicerCache.noPivot", "{part}: slicer cache without a pivot cache dropped"),
    ("xlsx.slicerCache.fieldMissing", "{part}: slicer field \"{field}\" not found; dropped"),
    ("xlsx.slicerCache.unsupported", "{part}: unsupported slicer cache (OLAP?) dropped"),
    ("xlsx.slicerCache.dropped", "{dropped} of {total} slicer cache(s) dropped ({error})"),
    ("xlsx.slicer.partMissing", "sheet \"{sheet}\": slicer part {part} is missing"),
    ("xlsx.slicer.noPosition", "sheet \"{sheet}\": slicer \"{name}\" has no position; dropped"),
    ("xlsx.slicer.dropped", "slicers dropped: {error}"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_fill_placeholders_and_merge_repeats() {
        let mut w = Warnings::default();
        w.push(note!("xlsx.cell.isoDate", sheet = "S", cell = "A1"));
        w.push(note!("xlsx.cell.isoDate", sheet = "S", cell = "A1"));
        w.push(note!("xlsx.slicer.dropped", error = "{x} stays"));
        let (lines, details) = w.finish();
        assert_eq!(lines[0], "sheet \"S\": A1: ISO date cell kept as text");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[2], "slicers dropped: {x} stays");
        assert_eq!(details.len(), 2);
        assert_eq!(details[0].count, 2);
        assert_eq!(
            details[0].line(),
            "sheet \"S\": A1: ISO date cell kept as text (2x)"
        );
        assert_eq!(details[0].params["cell"], "A1");
        assert_eq!(details[1].code, "xlsx.slicer.dropped");
    }

    #[test]
    fn chart_notes_from_fmt_ooxml_get_codes() {
        let n = chart_note(
            "lineChart3D chart is not supported; kept unchanged (read-only)",
            "/c.xml",
        )
        .with("sheet", "S");
        assert_eq!(n.code, "xlsx.chart.unsupportedKind");
        assert_eq!(
            n.text(),
            "sheet \"S\": /c.xml: lineChart3D chart is not supported; kept unchanged (read-only)"
        );
        assert_eq!(
            chart_note("chart elements dropped: a, b", "/c").code,
            "xlsx.chart.elementsDropped"
        );
        assert_eq!(
            chart_note("something new", "/c").with("sheet", "S").text(),
            "sheet \"S\": /c: something new"
        );
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
            assert!(code.starts_with("xlsx."), "{code}");
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
            let used = src.contains(&format!("\"{code}\""))
                || ["xlsx.chart.", "xlsx.tableFilter."]
                    .iter()
                    .any(|p| code.starts_with(p));
            assert!(used, "{code}: not used");
        }
        // Every code used in the sources has a template.
        for part in src.split("note!(\"").skip(1) {
            let code = part.split('"').next().unwrap();
            assert!(template(code).is_some(), "{code}: no template");
        }
        assert!(TEMPLATES.len() >= 80, "{}", TEMPLATES.len());
    }
}
