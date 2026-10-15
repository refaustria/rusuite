//! `word/numbering.xml` ↔ [`model_text::Numbering`].
//!
//! Every `w:num` becomes one [`NumberingDef`] with the levels of its
//! `w:abstractNum` and its `w:lvlOverride`s applied (ADR 0006). Bullet
//! characters are stored readable (`•`, `▪`) in the model; Word stores
//! bullets of the Symbol and Wingdings fonts as private-use characters
//! (U+F0B7, U+F0A7), which are mapped on read and write.

use std::collections::BTreeMap;

use core_model::FontFace;
use model_text::{Level, LevelKind, Numbering, NumberingDef};

use crate::props::{read_fonts, read_indent_quiet, write_fonts, write_indent};
use crate::xml::{parse, parse_u32, El, XmlOut};
use crate::{DocxContext, NumInstance, Result, Warnings};

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

fn level_kind(fmt: &str, w: &mut Warnings) -> (LevelKind, bool) {
    let kind = match fmt {
        "decimal" => LevelKind::Decimal,
        "lowerLetter" => LevelKind::LowerLetter,
        "upperLetter" => LevelKind::UpperLetter,
        "lowerRoman" => LevelKind::LowerRoman,
        "upperRoman" => LevelKind::UpperRoman,
        "bullet" => LevelKind::Bullet,
        "none" => return (LevelKind::Bullet, true),
        other => {
            w.add(format!(
                "word/numbering.xml: number format {other:?} read as decimal"
            ));
            LevelKind::Decimal
        }
    };
    (kind, false)
}

fn read_level(lvl: &El, w: &mut Warnings) -> Level {
    let mut level = Level {
        kind: LevelKind::Decimal,
        text: String::new(),
        start: 0,
        indent: None,
        font: None,
    };
    let mut none = false;
    for el in lvl.elements() {
        match el.name.as_str() {
            "start" => level.start = el.val().and_then(parse_u32).unwrap_or(0),
            "numFmt" => (level.kind, none) = level_kind(el.val().unwrap_or("decimal"), w),
            "lvlText" => level.text = el.val().unwrap_or("").to_owned(),
            "pPr" => level.indent = el.child("ind").and_then(read_indent_quiet),
            "rPr" => level.font = el.child("rFonts").and_then(read_fonts),
            "lvlRestart" | "isLgl" | "lvlPicBulletId" | "legacy" => w.add(format!(
                "word/numbering.xml: list level property {} dropped",
                el.qname()
            )),
            "pStyle" => w.add("word/numbering.xml: list level linked to a style; link dropped"),
            _ => {}
        }
    }
    if none {
        // A level without number: only its literal text remains.
        let mut text = String::new();
        let mut chars = level.text.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '%' && chars.peek().is_some_and(char::is_ascii_digit) {
                chars.next();
            } else {
                text.push(c);
            }
        }
        level.text = text;
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
    Level {
        kind: LevelKind::Decimal,
        text: format!("%{}.", i + 1),
        start: 1,
        indent: None,
        font: None,
    }
}

/// Parses `numbering.xml`.
pub(crate) fn read_numbering(xml: &[u8], part: &str, w: &mut Warnings) -> Result<ReadNumbering> {
    let root = parse(xml, part)?;
    let mut abstracts: BTreeMap<u32, Vec<Level>> = BTreeMap::new();
    let mut out = ReadNumbering::default();
    for el in root.elements() {
        match el.name.as_str() {
            "abstractNum" => {
                let Some(id) = el.attr("abstractNumId").and_then(parse_u32) else {
                    continue;
                };
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
                abstracts.insert(id, levels);
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
                let Some(base) = abstracts.get(&abstract_id) else {
                    w.add(format!(
                        "{part}: num {num_id} references missing abstractNum {abstract_id}; dropped"
                    ));
                    continue;
                };
                let mut levels = base.clone();
                let mut start_overrides = Vec::new();
                for ov in el.elements().filter(|e| e.name == "lvlOverride") {
                    let Some(i) = ilvl_of(ov) else { continue };
                    while levels.len() <= i {
                        levels.push(default_level(levels.len()));
                    }
                    if let Some(lvl) = ov.child("lvl") {
                        levels[i] = read_level(lvl, w);
                    }
                    if let Some(s) = ov.child("startOverride").and_then(El::val) {
                        levels[i].start = parse_u32(s).unwrap_or(0);
                        start_overrides.push(i as u8);
                    }
                }
                out.numbering.insert(NumberingDef { id: num_id, levels });
                out.instances.push(NumInstance {
                    num_id,
                    abstract_id,
                    start_overrides,
                });
            }
            _ => {}
        }
    }
    Ok(out)
}

/// A `w:num` to write: num id, abstract id, `(level, start)` overrides.
type NumOut = (u32, u32, Vec<(u8, u32)>);

/// Whether `def` can share the abstract definition `base`: equal levels,
/// except the start value of levels listed in `overrides`.
fn compatible(base: &[Level], def: &[Level], overrides: &[u8]) -> bool {
    base.len() == def.len()
        && base.iter().zip(def).enumerate().all(|(i, (a, b))| {
            a == b
                || (overrides.contains(&(i as u8)) && {
                    let mut a = a.clone();
                    a.start = b.start;
                    a == *b
                })
        })
}

/// Writes `numbering.xml`; `None` if there are no definitions.
///
/// Without context every def gets its own `abstractNum`. With the context of
/// a read file, nums that shared an `abstractNum` (and still have
/// compatible levels) share one again, with their `w:startOverride`s.
pub(crate) fn write_numbering(n: &Numbering, ctx: &DocxContext) -> Option<Vec<u8>> {
    let defs: Vec<&NumberingDef> = n.defs.iter().filter(|d| d.id != 0).collect();
    if defs.is_empty() {
        return None;
    }
    // (abstract id, levels, abstract id in the original file)
    let mut abstracts: Vec<(u32, &[Level], Option<u32>)> = Vec::new();
    // (num id, abstract id, overrides (level, start))
    let mut nums: Vec<NumOut> = Vec::new();
    for def in defs {
        let inst = ctx.numbering.iter().find(|i| i.num_id == def.id);
        let overrides: Vec<(u8, u32)> = inst
            .map(|i| {
                i.start_overrides
                    .iter()
                    .filter_map(|&l| Some((l, def.levels.get(usize::from(l))?.start)))
                    .collect()
            })
            .unwrap_or_default();
        let shared = inst.and_then(|inst| {
            abstracts.iter().find(|(_, levels, orig)| {
                *orig == Some(inst.abstract_id)
                    && compatible(levels, &def.levels, &inst.start_overrides)
            })
        });
        let abs_id = match shared {
            Some((id, _, _)) => *id,
            None => {
                let id = abstracts.len() as u32;
                abstracts.push((id, &def.levels, inst.map(|i| i.abstract_id)));
                id
            }
        };
        nums.push((def.id, abs_id, overrides));
    }

    let mut x = XmlOut::new();
    x.start("w:numbering", &[("xmlns:w", W_NS)]);
    for (id, levels, _) in &abstracts {
        x.start("w:abstractNum", &[("w:abstractNumId", &id.to_string())]);
        for (i, level) in levels.iter().enumerate().take(9) {
            write_level(&mut x, i, level);
        }
        x.end("w:abstractNum");
    }
    for (num_id, abs_id, overrides) in &nums {
        x.start("w:num", &[("w:numId", &num_id.to_string())]);
        x.val("w:abstractNumId", &abs_id.to_string());
        for (lvl, start) in overrides {
            x.start("w:lvlOverride", &[("w:ilvl", &lvl.to_string())]);
            x.val("w:startOverride", &start.to_string());
            x.end("w:lvlOverride");
        }
        x.end("w:num");
    }
    x.end("w:numbering");
    Some(x.finish())
}

fn write_level(x: &mut XmlOut, i: usize, level: &Level) {
    let none = level.kind == LevelKind::Bullet && level.text.is_empty();
    x.start("w:lvl", &[("w:ilvl", &i.to_string())]);
    x.val("w:start", &level.start.to_string());
    let fmt = match level.kind {
        _ if none => "none",
        LevelKind::Bullet => "bullet",
        LevelKind::Decimal => "decimal",
        LevelKind::LowerLetter => "lowerLetter",
        LevelKind::UpperLetter => "upperLetter",
        LevelKind::LowerRoman => "lowerRoman",
        LevelKind::UpperRoman => "upperRoman",
    };
    x.val("w:numFmt", fmt);
    if none {
        x.val("w:suff", "nothing");
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
    if let Some(font) = &level.font {
        x.start("w:rPr", &[]);
        write_fonts(x, font, true);
        x.end("w:rPr");
    }
    x.end("w:lvl");
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::units::Twips;
    use model_text::Indent;

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

    #[test]
    fn default_lists_roundtrip() {
        let mut n = Numbering::default();
        n.insert(NumberingDef::bullet_default(1));
        n.insert(NumberingDef::decimal_default(2));
        let xml = write_numbering(&n, &DocxContext::default()).unwrap();
        let s = String::from_utf8(xml.clone()).unwrap();
        assert!(s.contains("<w:lvlText w:val=\"\u{F0B7}\"/>"), "{s}");
        assert!(s.contains(r#"<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/>"#));
        let back = read_numbering(&xml, "n", &mut Warnings::default()).unwrap();
        assert_eq!(back.numbering, n);
    }

    #[test]
    fn overrides_flatten_and_regroup() {
        // LibreOffice's list restart: num 4 = abstract 3 restarted at 1;
        // num 5 = abstract 3 starting at 7.
        let xml = br#"<w:numbering xmlns:w="x">
            <w:abstractNum w:abstractNumId="3">
              <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
                <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
              <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
            </w:abstractNum>
            <w:abstractNum w:abstractNumId="1">
              <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/><w:suff w:val="nothing"/><w:lvlText w:val=""/></w:lvl>
            </w:abstractNum>
            <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
            <w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>
            <w:num w:numId="4"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
            <w:num w:numId="5"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
            <w:num w:numId="6"><w:abstractNumId w:val="9"/></w:num>
        </w:numbering>"#;
        let mut w = Warnings::default();
        let r = read_numbering(xml, "n", &mut w).unwrap();
        assert_eq!(w.into_vec().len(), 1, "missing abstractNum 9");
        let defs = &r.numbering.defs;
        assert_eq!(defs.len(), 4);
        let none = &r.numbering.get(1).unwrap().levels[0];
        assert_eq!((none.kind, none.text.as_str()), (LevelKind::Bullet, ""));
        let d3 = r.numbering.get(3).unwrap();
        assert_eq!(d3.levels[0].start, 1);
        assert_eq!(
            d3.levels[0].indent,
            Some(Indent {
                left: Some(Twips(720)),
                hanging: Some(Twips(360)),
                ..Default::default()
            })
        );
        assert_eq!(d3.levels[1].text, "%2)");
        assert_eq!(r.numbering.get(5).unwrap().levels[0].start, 7);
        assert_eq!(r.numbering.get(5).unwrap().levels[1], d3.levels[1]);

        // Written back with context: nums 3, 4, 5 share one abstractNum.
        let ctx = DocxContext {
            numbering: r.instances.clone(),
            ..Default::default()
        };
        let out = write_numbering(&r.numbering, &ctx).unwrap();
        let s = String::from_utf8(out.clone()).unwrap();
        assert_eq!(s.matches("<w:abstractNum ").count(), 2, "{s}");
        assert!(s.contains(r#"<w:num w:numId="5"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>"#), "{s}");
        assert!(
            s.contains(r#"<w:numFmt w:val="none"/><w:suff w:val="nothing"/><w:lvlText w:val=""/>"#)
        );
        let back = read_numbering(&out, "n", &mut Warnings::default()).unwrap();
        assert_eq!(back.numbering, r.numbering);

        // Without context: one abstractNum per num.
        let s = String::from_utf8(write_numbering(&r.numbering, &DocxContext::default()).unwrap())
            .unwrap();
        assert_eq!(s.matches("<w:abstractNum ").count(), 4);

        // An edited def no longer shares its abstract.
        let mut edited = r.numbering.clone();
        edited.defs.iter_mut().find(|d| d.id == 4).unwrap().levels[1].text = "(%2)".into();
        let s = String::from_utf8(write_numbering(&edited, &ctx).unwrap()).unwrap();
        assert_eq!(s.matches("<w:abstractNum ").count(), 3);
        let back = read_numbering(s.as_bytes(), "n", &mut Warnings::default()).unwrap();
        assert_eq!(back.numbering, edited);
    }
}
