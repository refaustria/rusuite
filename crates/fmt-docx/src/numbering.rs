//! `word/numbering.xml` ↔ [`model_text::Numbering`].
//!
//! Every `w:abstractNum` becomes an [`AbstractNumbering`], every `w:num` a
//! [`NumberingDef`] pointing to it with its `w:lvlOverride`s (start
//! overrides and whole levels) and the resolved levels. Bullet characters
//! are stored readable (`•`, `▪`) in the model; Word stores bullets of the
//! Symbol and Wingdings fonts as private-use characters (U+F0B7, U+F0A7),
//! which are mapped on read and write.

use std::collections::BTreeMap;

use core_model::{ColorScheme, FontFace, RunProperties};
use model_text::{
    AbstractNumbering, Level, LevelKind, LevelOverride, LevelSuffix, Numbering, NumberingDef,
};

use crate::props::{read_indent_quiet, read_rpr, write_fonts, write_indent, write_rpr};
use crate::xml::{parse, parse_u32, toggle, El, WriteVal, XmlOut};
use crate::{NumInstance, Result, Warnings};

pub(crate) const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/// Symbol font code points (0x20–0xFF, stored by Word as U+F000 + code)
/// with a readable Unicode equivalent.
const SYMBOL_MAP: &[(u8, char)] = &[
    (0xB7, '•'),
    (0xA7, '♣'),
    (0xA8, '♦'),
    (0xA9, '♥'),
    (0xAA, '♠'),
    (0xAE, '→'),
    (0xDE, '⇒'),
    (0xB0, '°'),
];

/// Wingdings code points with a readable Unicode equivalent.
const WINGDINGS_MAP: &[(u8, char)] = &[
    (0xA7, '▪'),
    (0x6C, '●'),
    (0x6E, '■'),
    (0x6F, '□'),
    (0x71, '❑'),
    (0x75, '⧫'),
    (0x76, '❖'),
    (0xA1, '○'),
    (0xA8, '◻'),
    (0xD8, '➢'),
    (0xFC, '✔'),
];

fn symbol_table(font: Option<&FontFace>) -> Option<&'static [(u8, char)]> {
    match font? {
        FontFace::Named(n) if n.eq_ignore_ascii_case("Symbol") => Some(SYMBOL_MAP),
        FontFace::Named(n) if n.eq_ignore_ascii_case("Wingdings") => Some(WINGDINGS_MAP),
        _ => None,
    }
}

/// Bullet text as stored by Word (private-use / 8-bit symbol code points
/// for Symbol and Wingdings) → readable characters.
pub fn bullet_from_word(text: &str, font: Option<&FontFace>) -> String {
    let Some(table) = symbol_table(font) else {
        return text.to_owned();
    };
    text.chars()
        .map(|c| {
            let code = c as u32;
            let byte = match code {
                0xF000..=0xF0FF => Some((code - 0xF000) as u8),
                0x20..=0xFF => Some(code as u8),
                _ => None,
            };
            byte.and_then(|b| table.iter().find(|(k, _)| *k == b).map(|(_, v)| *v))
                .unwrap_or(c)
        })
        .collect()
}

/// Readable bullet characters → Word's private-use code points for the
/// Symbol and Wingdings fonts. Other fonts and characters are unchanged.
pub fn bullet_to_word(text: &str, font: Option<&FontFace>) -> String {
    let Some(table) = symbol_table(font) else {
        return text.to_owned();
    };
    text.chars()
        .map(|c| {
            table
                .iter()
                .find(|(_, v)| *v == c)
                .and_then(|(k, _)| char::from_u32(0xF000 + u32::from(*k)))
                .unwrap_or(c)
        })
        .collect()
}

/// What [`read_numbering`] produces.
#[derive(Debug, Default)]
pub(crate) struct ReadNumbering {
    pub numbering: Numbering,
    pub instances: Vec<NumInstance>,
}

fn level_kind(fmt: &str, w: &mut Warnings) -> LevelKind {
    match fmt {
        "decimal" => LevelKind::Decimal,
        "lowerLetter" => LevelKind::LowerLetter,
        "upperLetter" => LevelKind::UpperLetter,
        "lowerRoman" => LevelKind::LowerRoman,
        "upperRoman" => LevelKind::UpperRoman,
        "bullet" => LevelKind::Bullet,
        "ordinal" => LevelKind::Ordinal,
        "decimalZero" => LevelKind::DecimalZero,
        "none" => LevelKind::None,
        other => {
            w.add(format!(
                "word/numbering.xml: number format {other:?} read as decimal"
            ));
            LevelKind::Decimal
        }
    }
}

fn level_kind_name(kind: LevelKind) -> &'static str {
    match kind {
        LevelKind::Bullet => "bullet",
        LevelKind::Decimal => "decimal",
        LevelKind::LowerLetter => "lowerLetter",
        LevelKind::UpperLetter => "upperLetter",
        LevelKind::LowerRoman => "lowerRoman",
        LevelKind::UpperRoman => "upperRoman",
        LevelKind::Ordinal => "ordinal",
        LevelKind::DecimalZero => "decimalZero",
        LevelKind::None => "none",
    }
}

/// `w:numFmt` / `w:pgNumType/@w:fmt` value → kind (unknown → `None`).
pub(crate) fn number_format(v: &str) -> Option<LevelKind> {
    let mut w = Warnings::default();
    let kind = level_kind(v, &mut w);
    w.is_empty().then_some(kind)
}

/// Kind → `w:numFmt` value.
pub(crate) fn number_format_name(kind: LevelKind) -> &'static str {
    level_kind_name(kind)
}

fn read_level(lvl: &El, w: &mut Warnings) -> Level {
    let mut level = Level::new(LevelKind::Decimal, "");
    level.start = 0;
    for el in lvl.elements() {
        match el.name.as_str() {
            "start" => level.start = el.val().and_then(parse_u32).unwrap_or(0),
            "numFmt" => level.kind = level_kind(el.val().unwrap_or("decimal"), w),
            "lvlText" => level.text = el.val().unwrap_or("").to_owned(),
            "lvlRestart" => {
                level.restart = el
                    .val()
                    .and_then(parse_u32)
                    .map(|v| u8::try_from(v.min(9)).unwrap_or(9))
            }
            "isLgl" => level.legal = toggle(el),
            "suff" => {
                level.suffix = match el.val() {
                    Some("space") => LevelSuffix::Space,
                    Some("nothing") => LevelSuffix::Nothing,
                    _ => LevelSuffix::Tab,
                }
            }
            "pPr" => level.indent = el.child("ind").and_then(read_indent_quiet),
            "rPr" => {
                let mut run = read_rpr(el, "list level", w);
                level.font = run.font.take();
                level.run = (!run.is_empty()).then_some(run);
            }
            "lvlPicBulletId" | "legacy" => w.add(format!(
                "word/numbering.xml: list level property {} dropped",
                el.qname()
            )),
            "pStyle" => w.add("word/numbering.xml: list level linked to a style; link dropped"),
            _ => {}
        }
    }
    if level.kind == LevelKind::Bullet {
        level.text = bullet_from_word(&level.text, level.font.as_ref());
    }
    level
}

fn ilvl_of(el: &El) -> Option<usize> {
    el.attr("ilvl")
        .and_then(parse_u32)
        .map(|v| v as usize)
        .filter(|&v| v <= 8)
}

fn default_level(i: usize) -> Level {
    Level::new(LevelKind::Decimal, format!("%{}.", i + 1))
}

/// Parses `numbering.xml`.
pub(crate) fn read_numbering(xml: &[u8], part: &str, w: &mut Warnings) -> Result<ReadNumbering> {
    let root = parse(xml, part)?;
    let mut out = ReadNumbering::default();
    for el in root.elements() {
        match el.name.as_str() {
            "abstractNum" => {
                let Some(id) = el.attr("abstractNumId").and_then(parse_u32) else {
                    continue;
                };
                if out.numbering.get_abstract(id).is_some() {
                    w.add(format!("{part}: duplicate abstractNum {id} dropped"));
                    continue;
                }
                if el.child("numStyleLink").is_some() || el.child("styleLink").is_some() {
                    w.add(format!("{part}: numbering style links dropped"));
                }
                let mut levels: BTreeMap<usize, Level> = BTreeMap::new();
                for lvl in el.elements().filter(|e| e.name == "lvl") {
                    if let Some(i) = ilvl_of(lvl) {
                        levels.insert(i, read_level(lvl, w));
                    }
                }
                let n = levels.keys().next_back().map_or(0, |m| m + 1);
                let levels = (0..n)
                    .map(|i| levels.remove(&i).unwrap_or_else(|| default_level(i)))
                    .collect();
                out.numbering
                    .abstracts
                    .push(AbstractNumbering { id, levels });
            }
            "num" => {
                let Some(num_id) = el.attr("numId").and_then(parse_u32).filter(|&n| n != 0) else {
                    continue;
                };
                let Some(abstract_id) = el
                    .child("abstractNumId")
                    .and_then(El::val)
                    .and_then(parse_u32)
                else {
                    w.add(format!(
                        "{part}: num {num_id} without abstractNumId dropped"
                    ));
                    continue;
                };
                let mut overrides = Vec::new();
                let mut start_overrides = Vec::new();
                for ov in el.elements().filter(|e| e.name == "lvlOverride") {
                    let Some(i) = ilvl_of(ov) else { continue };
                    let start = ov
                        .child("startOverride")
                        .and_then(El::val)
                        .map(|s| parse_u32(s).unwrap_or(0));
                    let definition = ov.child("lvl").map(|l| read_level(l, w));
                    if start.is_some() {
                        start_overrides.push(i as u8);
                    }
                    if start.is_some() || definition.is_some() {
                        overrides.push(LevelOverride {
                            level: i as u8,
                            start,
                            definition,
                        });
                    }
                }
                out.numbering.insert(NumberingDef {
                    id: num_id,
                    abstract_id: Some(abstract_id),
                    overrides,
                    levels: Vec::new(),
                });
                out.instances.push(NumInstance {
                    num_id,
                    abstract_id,
                    start_overrides,
                });
            }
            _ => {}
        }
    }
    // Nums whose abstractNum is missing.
    let missing: Vec<u32> = out
        .numbering
        .defs
        .iter()
        .filter(|d| out.numbering.resolved_levels(d).is_none())
        .map(|d| d.id)
        .collect();
    for id in missing {
        let a = out
            .numbering
            .get(id)
            .and_then(|d| d.abstract_id)
            .unwrap_or(0);
        w.add(format!(
            "{part}: num {id} references missing abstractNum {a}; dropped"
        ));
        out.numbering.defs.retain(|d| d.id != id);
        out.instances.retain(|i| i.num_id != id);
    }
    out.numbering.resolve();
    Ok(out)
}

/// Writes `numbering.xml`; `None` if there are no lists.
///
/// The abstract definitions are written with their ids, then one more per
/// standalone list (and per list whose levels no longer match its abstract
/// definition and overrides, e.g. edited without [`Numbering::resolve`]);
/// every list as a `w:num` with its `w:lvlOverride`s.
pub(crate) fn write_numbering(n: &Numbering, scheme: &ColorScheme) -> Option<Vec<u8>> {
    let defs: Vec<&NumberingDef> = n.defs.iter().filter(|d| d.id != 0).collect();
    if defs.is_empty() {
        return None;
    }
    let mut next_abstract = n.next_abstract_id();
    // (abstract id, levels)
    let mut abstracts: Vec<(u32, &[Level])> = n
        .abstracts
        .iter()
        .map(|a| (a.id, a.levels.as_slice()))
        .collect();
    // (num id, abstract id, overrides)
    let mut nums: Vec<(u32, u32, &[LevelOverride])> = Vec::new();
    for def in defs {
        match def.abstract_id {
            Some(a) if n.resolved_levels(def).as_deref() == Some(def.levels.as_slice()) => {
                nums.push((def.id, a, &def.overrides));
            }
            _ => {
                abstracts.push((next_abstract, &def.levels));
                nums.push((def.id, next_abstract, &[]));
                next_abstract += 1;
            }
        }
    }

    let mut x = XmlOut::new();
    x.start("w:numbering", &[("xmlns:w", W_NS)]);
    for (id, levels) in &abstracts {
        x.start("w:abstractNum", &[("w:abstractNumId", &id.to_string())]);
        for (i, level) in levels.iter().enumerate().take(9) {
            write_level(&mut x, i, level, scheme);
        }
        x.end("w:abstractNum");
    }
    for (num_id, abs_id, overrides) in &nums {
        x.start("w:num", &[("w:numId", &num_id.to_string())]);
        x.val("w:abstractNumId", &abs_id.to_string());
        for o in overrides.iter() {
            x.start("w:lvlOverride", &[("w:ilvl", &o.level.min(8).to_string())]);
            if let Some(start) = o.start {
                x.val("w:startOverride", &start.to_string());
            }
            if let Some(def) = &o.definition {
                write_level(&mut x, usize::from(o.level.min(8)), def, scheme);
            }
            x.end("w:lvlOverride");
        }
        x.end("w:num");
    }
    x.end("w:numbering");
    Some(x.finish())
}

fn write_level(x: &mut XmlOut, i: usize, level: &Level, scheme: &ColorScheme) {
    x.start("w:lvl", &[("w:ilvl", &i.to_string())]);
    x.val("w:start", &level.start.to_string());
    x.val("w:numFmt", level_kind_name(level.kind));
    if let Some(r) = level.restart {
        x.val("w:lvlRestart", &r.to_string());
    }
    if level.legal {
        x.empty("w:isLgl", &[]);
    }
    match level.suffix {
        LevelSuffix::Tab => {}
        LevelSuffix::Space => x.val("w:suff", "space"),
        LevelSuffix::Nothing => x.val("w:suff", "nothing"),
    }
    let text = if level.kind == LevelKind::Bullet {
        bullet_to_word(&level.text, level.font.as_ref())
    } else {
        level.text.clone()
    };
    x.val("w:lvlText", &text);
    x.val("w:lvlJc", "left");
    if let Some(ind) = level.indent.filter(|i| !i.is_empty()) {
        x.start("w:pPr", &[]);
        write_indent(x, &ind);
        x.end("w:pPr");
    }
    let run = level.run.clone().unwrap_or_default();
    if level.font.is_some() || !run.is_empty() {
        // `rFonts` with `hint="default"` (as Word writes list fonts), then
        // the other properties.
        let mut fragment = XmlOut::fragment();
        write_rpr(&mut fragment, &RunProperties { font: None, ..run }, scheme);
        let rest = fragment.finish();
        x.start("w:rPr", &[]);
        if let Some(font) = &level.font {
            write_fonts(x, font, true);
        }
        // Strip the fragment's own `<w:rPr>` wrapper.
        let inner = rest
            .strip_prefix(b"<w:rPr>".as_slice())
            .and_then(|r| r.strip_suffix(b"</w:rPr>".as_slice()))
            .unwrap_or(&[]);
        x.raw(inner);
        x.end("w:rPr");
    }
    x.end("w:lvl");
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::units::Twips;
    use core_model::FontSize;
    use model_text::{Indent, NumberingRef};

    #[test]
    fn bullets_map_both_ways() {
        let symbol = FontFace::from("Symbol");
        let wingdings = FontFace::from("Wingdings");
        let courier = FontFace::from("Courier New");
        assert_eq!(bullet_from_word("\u{F0B7}", Some(&symbol)), "•");
        assert_eq!(bullet_from_word("\u{B7}", Some(&symbol)), "•");
        assert_eq!(bullet_from_word("\u{F0A7}", Some(&wingdings)), "▪");
        assert_eq!(bullet_from_word("\u{F0D8}", Some(&wingdings)), "➢");
        assert_eq!(bullet_from_word("o", Some(&courier)), "o");
        assert_eq!(bullet_from_word("\u{F0B7}", None), "\u{F0B7}");
        // unknown private-use code points stay as they are
        assert_eq!(bullet_from_word("\u{F020}", Some(&symbol)), "\u{F020}");
        assert_eq!(bullet_to_word("•", Some(&symbol)), "\u{F0B7}");
        assert_eq!(bullet_to_word("▪", Some(&wingdings)), "\u{F0A7}");
        assert_eq!(bullet_to_word("o", Some(&courier)), "o");
        assert_eq!(bullet_to_word("•", None), "•");
        for table in [SYMBOL_MAP, WINGDINGS_MAP] {
            let font = if table == SYMBOL_MAP {
                &symbol
            } else {
                &wingdings
            };
            for (_, c) in table {
                let s = c.to_string();
                assert_eq!(
                    bullet_from_word(&bullet_to_word(&s, Some(font)), Some(font)),
                    s
                );
            }
        }
    }

    fn write(n: &Numbering) -> Vec<u8> {
        write_numbering(n, &ColorScheme::default()).unwrap()
    }

    #[test]
    fn default_lists_roundtrip() {
        let mut n = Numbering::default();
        n.insert(NumberingDef::bullet_default(1));
        n.insert(NumberingDef::decimal_default(2));
        let xml = write(&n);
        let s = String::from_utf8(xml.clone()).unwrap();
        assert!(s.contains("<w:lvlText w:val=\"\u{F0B7}\"/>"), "{s}");
        assert!(s.contains(r#"<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/>"#));
        let back = read_numbering(&xml, "n", &mut Warnings::default()).unwrap();
        // Standalone lists come back as lists on their own abstracts.
        assert_eq!(back.numbering.abstracts.len(), 2);
        for (a, b) in back.numbering.defs.iter().zip(&n.defs) {
            assert_eq!((a.id, &a.levels), (b.id, &b.levels));
            assert!(a.abstract_id.is_some());
        }
        // and are written identically again
        assert_eq!(write(&back.numbering), xml);
    }

    #[test]
    fn abstracts_and_overrides_roundtrip() {
        // LibreOffice's list restart: num 4 = abstract 3 restarted at 1;
        // num 5 = abstract 3 starting at 7.
        let xml = br#"<w:numbering xmlns:w="x">
            <w:abstractNum w:abstractNumId="3">
              <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
                <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:b/><w:color w:val="FF0000"/><w:sz w:val="28"/></w:rPr></w:lvl>
              <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlRestart w:val="0"/><w:isLgl/><w:suff w:val="space"/><w:lvlText w:val="%1.%2)"/></w:lvl>
            </w:abstractNum>
            <w:abstractNum w:abstractNumId="1">
              <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/><w:suff w:val="nothing"/><w:lvlText w:val=""/></w:lvl>
            </w:abstractNum>
            <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
            <w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>
            <w:num w:numId="4"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
            <w:num w:numId="5"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride>
              <w:lvlOverride w:ilvl="2"><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="ordinal"/><w:lvlText w:val="%3"/></w:lvl></w:lvlOverride></w:num>
            <w:num w:numId="6"><w:abstractNumId w:val="9"/></w:num>
        </w:numbering>"#;
        let mut w = Warnings::default();
        let r = read_numbering(xml, "n", &mut w).unwrap();
        assert_eq!(w.into_vec().len(), 1, "missing abstractNum 9");
        let n = &r.numbering;
        assert_eq!(n.defs.len(), 4);
        assert_eq!(n.abstracts.len(), 2);
        let none = &n.get(1).unwrap().levels[0];
        assert_eq!(
            (none.kind, none.text.as_str(), none.suffix),
            (LevelKind::None, "", LevelSuffix::Nothing)
        );
        let d3 = n.get(3).unwrap();
        assert_eq!(d3.abstract_id, Some(3));
        assert_eq!(d3.levels[0].start, 1);
        assert_eq!(
            d3.levels[0].indent,
            Some(Indent {
                left: Some(Twips(720)),
                hanging: Some(Twips(360)),
                ..Default::default()
            })
        );
        let run = d3.levels[0].run.as_ref().unwrap();
        assert_eq!(
            (run.bold, run.size),
            (Some(true), Some(FontSize::from_half_points(28)))
        );
        let l1 = &d3.levels[1];
        assert_eq!(
            (l1.restart, l1.legal, l1.suffix, l1.text.as_str()),
            (Some(0), true, LevelSuffix::Space, "%1.%2)")
        );
        let d5 = n.get(5).unwrap();
        assert_eq!(d5.levels[0].start, 7);
        assert_eq!(d5.levels[1], d3.levels[1]);
        assert_eq!(d5.levels[2].kind, LevelKind::Ordinal);
        assert_eq!(d5.start_override(0), Some(7));

        // Written back: same abstracts, same nums and overrides.
        let out = write(n);
        let s = String::from_utf8(out.clone()).unwrap();
        assert_eq!(s.matches("<w:abstractNum ").count(), 2, "{s}");
        assert!(s.contains(r#"<w:num w:numId="4"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>"#), "{s}");
        assert!(
            s.contains(r#"<w:numFmt w:val="none"/><w:suff w:val="nothing"/><w:lvlText w:val=""/>"#)
        );
        assert!(s.contains(r#"<w:lvlRestart w:val="0"/><w:isLgl/><w:suff w:val="space"/>"#));
        let back = read_numbering(&out, "n", &mut Warnings::default()).unwrap();
        assert_eq!(back.numbering, r.numbering);

        // Levels edited without resolve: the list gets its own abstract.
        let mut edited = r.numbering.clone();
        edited.defs.iter_mut().find(|d| d.id == 4).unwrap().levels[1].text = "(%2)".into();
        let s = String::from_utf8(write(&edited)).unwrap();
        assert_eq!(s.matches("<w:abstractNum ").count(), 3);
        let back = read_numbering(s.as_bytes(), "n", &mut Warnings::default()).unwrap();
        assert_eq!(
            back.numbering.get(4).unwrap().levels,
            edited.get(4).unwrap().levels
        );
        assert!(back
            .numbering
            .level(NumberingRef {
                num_id: 4,
                level: 1
            })
            .is_some());
    }
}
