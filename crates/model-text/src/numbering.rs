//! List numbering definitions (docx `numbering.xml`).
//!
//! As in Word, a list ([`NumberingDef`], docx `w:num`) usually points to a
//! shared abstract definition ([`AbstractNumbering`], `w:abstractNum`)
//! and may override some of its levels ([`LevelOverride`]: a new start
//! value or a whole level). Lists sharing an abstract definition share
//! one counter: they continue each other's numbering unless a level has a
//! start override (Word's "restart numbering"). Every def also carries
//! its resolved [`levels`](NumberingDef::levels) (the abstract levels with
//! the overrides applied) so readers need not resolve anything;
//! [`Numbering::resolve`] recomputes them.

use std::collections::{HashMap, HashSet};

use core_model::units::Twips;
use core_model::{FontFace, RunProperties};
use serde::{Deserialize, Serialize};

use crate::props::{Indent, NumberingRef};

/// Number format of a list level (docx `w:numFmt`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum LevelKind {
    /// A bullet character (the level's `text`).
    Bullet,
    /// 1, 2, 3, …
    Decimal,
    /// a, b, c, … z, aa, bb, …
    LowerLetter,
    /// A, B, C, … Z, AA, BB, …
    UpperLetter,
    /// i, ii, iii, …
    LowerRoman,
    /// I, II, III, …
    UpperRoman,
    /// 1st, 2nd, 3rd, …
    Ordinal,
    /// 01, 02, … 09, 10, …
    DecimalZero,
    /// No number: `%n` of this level is empty (the level text's literal
    /// characters remain).
    None,
}

impl LevelKind {
    /// `n` in this format (`Bullet` and `None` give an empty string).
    pub fn format(self, n: u32) -> String {
        match self {
            LevelKind::Bullet | LevelKind::None => String::new(),
            LevelKind::Decimal => n.to_string(),
            LevelKind::DecimalZero => format!("{n:02}"),
            LevelKind::LowerLetter => letters(n, b'a'),
            LevelKind::UpperLetter => letters(n, b'A'),
            LevelKind::LowerRoman => roman(n).to_ascii_lowercase(),
            LevelKind::UpperRoman => roman(n),
            LevelKind::Ordinal => {
                let suffix = match (n % 10, n % 100) {
                    (_, 11..=13) => "th",
                    (1, _) => "st",
                    (2, _) => "nd",
                    (3, _) => "rd",
                    _ => "th",
                };
                format!("{n}{suffix}")
            }
        }
    }
}

/// Word's letter numbering: a … z, then aa … zz, aaa, … (the letter
/// repeated, not base 26); `0` gives an empty string.
fn letters(n: u32, base: u8) -> String {
    if n == 0 {
        return String::new();
    }
    let letter = char::from(base + ((n - 1) % 26) as u8);
    let count = ((n - 1) / 26 + 1) as usize;
    std::iter::repeat(letter).take(count.min(64)).collect()
}

/// Upper-case roman numeral (`0` → empty; above 3999 the thousands repeat
/// `M`, capped at 64 characters).
fn roman(mut n: u32) -> String {
    const TABLE: [(u32, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, digits) in TABLE {
        while n >= value && out.len() < 64 {
            out.push_str(digits);
            n -= value;
        }
    }
    out
}

/// What follows a list label (docx `w:suff`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum LevelSuffix {
    /// A tab to the next tab stop (Word's default).
    #[default]
    Tab,
    /// A space.
    Space,
    /// Nothing.
    Nothing,
}

impl LevelSuffix {
    fn is_tab(&self) -> bool {
        *self == LevelSuffix::Tab
    }
}

/// One level of a list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Level {
    /// Number format.
    pub kind: LevelKind,
    /// Label template: `"%1."`, `"%1.%2."` (`%n` = the current number of
    /// level n, 1-based, in that level's format) or the bullet character.
    pub text: String,
    /// First number.
    pub start: u32,
    /// Indentation of paragraphs on this level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent: Option<Indent>,
    /// Font of the label (e.g. `Symbol` for bullets).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(as = "Option<app_common::wire::FontFace>"))]
    pub font: Option<FontFace>,
    /// Other formatting of the label (size, colour, bold, …; its `font`
    /// is always `None`, see [`Level::font`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(
        feature = "ts",
        ts(as = "Option<app_common::wire::RunProperties>", optional)
    )]
    pub run: Option<RunProperties>,
    /// Docx `w:lvlRestart`: this level restarts after a level `<= restart`
    /// (1-based) is used; `Some(0)` = never restarts. `None` = Word's
    /// default: after any shallower level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub restart: Option<u8>,
    /// Docx `w:isLgl`: all numbers in this level's label are shown as
    /// decimal ("legal" numbering: `1.1` under `I.`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub legal: bool,
    /// What follows the label.
    #[serde(default, skip_serializing_if = "LevelSuffix::is_tab")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<LevelSuffix>"))]
    pub suffix: LevelSuffix,
}

impl Level {
    /// A level of `kind` with label template `text`, starting at 1,
    /// without indent or formatting.
    pub fn new(kind: LevelKind, text: impl Into<String>) -> Self {
        Self {
            kind,
            text: text.into(),
            start: 1,
            indent: None,
            font: None,
            run: None,
            restart: None,
            legal: false,
            suffix: LevelSuffix::Tab,
        }
    }
}

/// A shared list definition: up to nine levels (docx `w:abstractNum`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct AbstractNumbering {
    /// Id referenced by [`NumberingDef::abstract_id`].
    pub id: u32,
    /// Levels `0..=8`.
    pub levels: Vec<Level>,
}

/// A per-list change of one level of the abstract definition (docx
/// `w:lvlOverride`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct LevelOverride {
    /// The level, `0..=8`.
    pub level: u8,
    /// `w:startOverride`: the list restarts this level at `start` when it
    /// is first used (instead of continuing the shared counter).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub start: Option<u32>,
    /// A replacement level definition (`w:lvlOverride/w:lvl`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub definition: Option<Level>,
}

/// A list (docx `w:num`): an abstract definition plus overrides, or (with
/// `abstract_id == None`) a standalone list whose `levels` are its own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct NumberingDef {
    /// Id referenced by [`NumberingRef::num_id`]; never `0`.
    pub id: u32,
    /// The shared definition this list uses; `None` = standalone (its own
    /// counter, `levels` authoritative).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub abstract_id: Option<u32>,
    /// Level overrides (only with an `abstract_id`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<LevelOverride>>"))]
    pub overrides: Vec<LevelOverride>,
    /// Effective levels `0..=8`: the abstract levels with the overrides
    /// applied (derived when `abstract_id` is set, see
    /// [`Numbering::resolve`]).
    pub levels: Vec<Level>,
}

/// Word's default list indent: `left = 720 * (level + 1)`.
fn level_indent(level: usize, hanging: i32) -> Option<Indent> {
    Some(Indent {
        left: Some(Twips(720 * (level as i32 + 1))),
        hanging: Some(Twips(hanging)),
        ..Default::default()
    })
}

impl NumberingDef {
    /// A standalone list with `levels`.
    pub fn standalone(id: u32, levels: Vec<Level>) -> Self {
        Self {
            id,
            abstract_id: None,
            overrides: Vec::new(),
            levels,
        }
    }

    /// Word's default bulleted list: `•` (Symbol), `o` (Courier New),
    /// `▪` (Wingdings), repeating; indents 720, 1440, … with 360 hanging.
    pub fn bullet_default(id: u32) -> Self {
        let bullets = [("•", "Symbol"), ("o", "Courier New"), ("▪", "Wingdings")];
        let levels = (0..9)
            .map(|i| {
                let (text, font) = bullets[i % 3];
                Level {
                    indent: level_indent(i, 360),
                    font: Some(FontFace::from(font)),
                    ..Level::new(LevelKind::Bullet, text)
                }
            })
            .collect();
        Self::standalone(id, levels)
    }

    /// Word's default numbered list: `1.`, `a.`, `i.`, repeating; indents
    /// 720, 1440, … with 360 hanging (180 for roman levels).
    pub fn decimal_default(id: u32) -> Self {
        let kinds = [
            (LevelKind::Decimal, 360),
            (LevelKind::LowerLetter, 360),
            (LevelKind::LowerRoman, 180),
        ];
        let levels = (0..9)
            .map(|i| {
                let (kind, hanging) = kinds[i % 3];
                Level {
                    indent: level_indent(i, hanging),
                    ..Level::new(kind, format!("%{}.", i + 1))
                }
            })
            .collect();
        Self::standalone(id, levels)
    }

    /// Word's "1., 1.1., 1.1.1." multilevel list (each level shows all
    /// shallower numbers); indents 360, 792, 1224, … with hanging
    /// 360, 432, 504, ….
    pub fn legal_default(id: u32) -> Self {
        let levels = (0..9)
            .map(|i| {
                let text: String = (1..=i + 1).map(|n| format!("%{n}.")).collect();
                Level {
                    indent: Some(Indent {
                        left: Some(Twips(360 + 432 * i)),
                        hanging: Some(Twips(360 + 72 * i)),
                        ..Default::default()
                    }),
                    ..Level::new(LevelKind::Decimal, text)
                }
            })
            .collect();
        Self::standalone(id, levels)
    }

    /// The level `level`, if defined.
    pub fn level(&self, level: u8) -> Option<&Level> {
        self.levels.get(usize::from(level))
    }

    /// The start override of `level`, if any.
    pub fn start_override(&self, level: u8) -> Option<u32> {
        self.overrides
            .iter()
            .find(|o| o.level == level)
            .and_then(|o| o.start)
    }
}

/// Default level `i` when an abstract definition has fewer levels than an
/// override needs.
fn filler_level(i: usize) -> Level {
    Level::new(LevelKind::Decimal, format!("%{}.", i + 1))
}

/// `base` with `overrides` applied.
pub fn apply_overrides(base: &[Level], overrides: &[LevelOverride]) -> Vec<Level> {
    let mut levels = base.to_vec();
    for o in overrides {
        let i = usize::from(o.level.min(8));
        while levels.len() <= i {
            levels.push(filler_level(levels.len()));
        }
        if let Some(def) = &o.definition {
            levels[i] = def.clone();
        }
        if let Some(start) = o.start {
            levels[i].start = start;
        }
    }
    levels
}

/// All list definitions of a document.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Numbering {
    /// Lists; ids are unique.
    #[serde(default)]
    pub defs: Vec<NumberingDef>,
    /// Shared definitions; ids are unique.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<AbstractNumbering>>"))]
    pub abstracts: Vec<AbstractNumbering>,
}

impl Numbering {
    /// The definition with id `id`.
    pub fn get(&self, id: u32) -> Option<&NumberingDef> {
        self.defs.iter().find(|d| d.id == id)
    }

    /// The abstract definition with id `id`.
    pub fn get_abstract(&self, id: u32) -> Option<&AbstractNumbering> {
        self.abstracts.iter().find(|a| a.id == id)
    }

    /// The level a paragraph's numbering reference points to. `None` for
    /// `num_id == 0` ("no numbering") and dangling references.
    pub fn level(&self, num: NumberingRef) -> Option<&Level> {
        if num.num_id == 0 {
            return None;
        }
        self.get(num.num_id)?.level(num.level)
    }

    /// An unused list id (max + 1, at least 1).
    pub fn next_id(&self) -> u32 {
        self.defs.iter().map(|d| d.id).max().unwrap_or(0) + 1
    }

    /// An unused abstract id (max + 1, at least 0).
    pub fn next_abstract_id(&self) -> u32 {
        self.abstracts.iter().map(|a| a.id + 1).max().unwrap_or(0)
    }

    /// Adds `def`, replacing a definition with the same id.
    pub fn insert(&mut self, def: NumberingDef) {
        match self.defs.iter_mut().find(|d| d.id == def.id) {
            Some(slot) => *slot = def,
            None => self.defs.push(def),
        }
    }

    /// The levels list `def` gets from its abstract definition and
    /// overrides; `None` for standalone lists and missing abstracts.
    pub fn resolved_levels(&self, def: &NumberingDef) -> Option<Vec<Level>> {
        let base = self.get_abstract(def.abstract_id?)?;
        Some(apply_overrides(&base.levels, &def.overrides))
    }

    /// Recomputes the `levels` of every list that uses an abstract
    /// definition; lists pointing to a missing abstract become standalone
    /// (keeping their levels).
    pub fn resolve(&mut self) {
        let resolved: Vec<Option<Vec<Level>>> =
            self.defs.iter().map(|d| self.resolved_levels(d)).collect();
        for (def, levels) in self.defs.iter_mut().zip(resolved) {
            match levels {
                Some(l) => def.levels = l,
                None => {
                    def.abstract_id = None;
                    def.overrides.clear();
                }
            }
        }
    }

    /// Makes list `num_id` use an abstract definition (creating one from
    /// its levels if it is standalone) and returns the abstract id.
    /// `None` if the list does not exist.
    pub fn ensure_abstract(&mut self, num_id: u32) -> Option<u32> {
        let next = self.next_abstract_id();
        let def = self.defs.iter_mut().find(|d| d.id == num_id)?;
        if let Some(a) = def.abstract_id {
            return Some(a);
        }
        def.abstract_id = Some(next);
        def.overrides.clear();
        let levels = def.levels.clone();
        self.abstracts.push(AbstractNumbering { id: next, levels });
        Some(next)
    }

    /// The key of the counter a list uses: lists sharing an abstract
    /// definition share it.
    fn counter_key(&self, num_id: u32) -> (bool, u32) {
        match self.get(num_id).and_then(|d| d.abstract_id) {
            Some(a) => (true, a),
            None => (false, num_id),
        }
    }
}

/// Word's list counting over paragraphs in document order (see
/// [`crate::Document::list_numbers`]).
#[derive(Debug, Default)]
pub(crate) struct ListCounter {
    /// Counter key → current number per level (`None` = not used yet).
    counters: HashMap<(bool, u32), [Option<u32>; 9]>,
    /// (list, level) whose start override was applied.
    started: HashSet<(u32, u8)>,
}

impl ListCounter {
    /// Counts one paragraph numbered with `num` and returns its label
    /// (`None` for dangling references and `num_id == 0`).
    pub(crate) fn next(&mut self, numbering: &Numbering, num: NumberingRef) -> Option<String> {
        let def = numbering.get(num.num_id).filter(|_| num.num_id != 0)?;
        let lvl = usize::from(num.level.min(8));
        let level = def.levels.get(lvl)?;
        let key = numbering.counter_key(num.num_id);
        let counters = self.counters.entry(key).or_insert([None; 9]);
        // Deeper levels restart when a level at or above their restart
        // level is used (lvlRestart; default: any shallower level).
        for (k, slot) in counters.iter_mut().enumerate().skip(lvl + 1) {
            let restart_after = def
                .levels
                .get(k)
                .and_then(|l| l.restart)
                .map_or(k, usize::from);
            if lvl < restart_after {
                *slot = None;
            }
        }
        // A start override restarts the level the first time this list
        // uses it.
        let first_use = self.started.insert((def.id, lvl as u8));
        counters[lvl] = match (def.start_override(lvl as u8), counters[lvl]) {
            (Some(start), _) if first_use => Some(start),
            (_, Some(n)) => Some(n.saturating_add(1)),
            (_, None) => Some(level.start),
        };
        Some(label(def, lvl, counters))
    }
}

/// The label of level `lvl` of `def` with the current `counters`.
fn label(def: &NumberingDef, lvl: usize, counters: &[Option<u32>; 9]) -> String {
    let level = &def.levels[lvl];
    if level.kind == LevelKind::Bullet {
        return level.text.clone();
    }
    let mut out = String::new();
    let mut chars = level.text.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, chars.peek().and_then(|d| d.to_digit(10))) {
            ('%', Some(d @ 1..=9)) => {
                chars.next();
                let k = d as usize - 1;
                let kind = match def.levels.get(k) {
                    // Legal numbering shows every number as decimal (a
                    // level without number stays empty).
                    Some(l) if level.legal && l.kind != LevelKind::None => LevelKind::Decimal,
                    Some(l) => l.kind,
                    None => LevelKind::Decimal,
                };
                let start = def.levels.get(k).map_or(1, |l| l.start);
                out.push_str(&kind.format(counters[k].unwrap_or(start)));
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(num_id: u32, level: u8) -> NumberingRef {
        NumberingRef { num_id, level }
    }

    #[test]
    fn defaults_have_nine_levels() {
        let b = NumberingDef::bullet_default(1);
        assert_eq!(b.levels.len(), 9);
        assert_eq!(b.levels[0].text, "•");
        assert_eq!(b.levels[0].font, Some(FontFace::from("Symbol")));
        assert_eq!(b.levels[4].text, "o");
        assert_eq!(b.levels[8].indent.unwrap().left, Some(Twips(6480)));

        let d = NumberingDef::decimal_default(2);
        assert_eq!(d.levels.len(), 9);
        assert_eq!(d.levels[0].text, "%1.");
        assert_eq!(d.levels[1].kind, LevelKind::LowerLetter);
        assert_eq!(d.levels[2].kind, LevelKind::LowerRoman);
        assert_eq!(d.levels[2].indent.unwrap().hanging, Some(Twips(180)));
        assert_eq!(d.levels[8].text, "%9.");
        assert_eq!(d.levels[1].indent.unwrap().left, Some(Twips(1440)));

        let l = NumberingDef::legal_default(3);
        assert_eq!(l.levels[2].text, "%1.%2.%3.");
    }

    #[test]
    fn lookup() {
        let mut n = Numbering::default();
        assert_eq!(n.next_id(), 1);
        n.insert(NumberingDef::bullet_default(1));
        n.insert(NumberingDef::decimal_default(n.next_id()));
        assert_eq!(n.defs.len(), 2);
        assert_eq!(n.level(r(2, 1)).unwrap().kind, LevelKind::LowerLetter);
        assert!(n.level(r(0, 0)).is_none());
        assert!(n.level(r(9, 0)).is_none());
        assert!(n.level(r(1, 9)).is_none());
        n.insert(NumberingDef::decimal_default(1));
        assert_eq!(n.defs.len(), 2);
        assert_eq!(n.get(1).unwrap().levels[0].kind, LevelKind::Decimal);
    }

    #[test]
    fn formats() {
        let f = |k: LevelKind, n| k.format(n);
        assert_eq!(f(LevelKind::LowerLetter, 1), "a");
        assert_eq!(f(LevelKind::LowerLetter, 26), "z");
        assert_eq!(f(LevelKind::LowerLetter, 27), "aa");
        assert_eq!(f(LevelKind::UpperLetter, 53), "AAA");
        assert_eq!(f(LevelKind::UpperRoman, 1994), "MCMXCIV");
        assert_eq!(f(LevelKind::LowerRoman, 4), "iv");
        assert_eq!(f(LevelKind::Ordinal, 1), "1st");
        assert_eq!(f(LevelKind::Ordinal, 12), "12th");
        assert_eq!(f(LevelKind::Ordinal, 22), "22nd");
        assert_eq!(f(LevelKind::Ordinal, 103), "103rd");
        assert_eq!(f(LevelKind::DecimalZero, 7), "07");
        assert_eq!(f(LevelKind::DecimalZero, 12), "12");
        assert_eq!(f(LevelKind::None, 5), "");
        assert_eq!(f(LevelKind::Decimal, 0), "0");
    }

    fn labels(n: &Numbering, refs: &[NumberingRef]) -> Vec<String> {
        let mut c = ListCounter::default();
        refs.iter().map(|&x| c.next(n, x).unwrap()).collect()
    }

    #[test]
    fn multilevel_counting_restarts_deeper_levels() {
        let mut n = Numbering::default();
        n.insert(NumberingDef::legal_default(1));
        let got = labels(
            &n,
            &[
                r(1, 0),
                r(1, 1),
                r(1, 1),
                r(1, 2),
                r(1, 0),
                r(1, 2),
                r(1, 1),
            ],
        );
        // A level-2 item right after a level-0 one shows the unused
        // level 1 at its start value.
        assert_eq!(
            got,
            ["1.", "1.1.", "1.2.", "1.2.1.", "2.", "2.1.1.", "2.1."]
        );
    }

    #[test]
    fn lvl_restart_and_legal() {
        let mut d = NumberingDef::decimal_default(1);
        d.levels[0].kind = LevelKind::UpperRoman;
        d.levels[1].text = "%1.%2".into();
        d.levels[1].legal = true;
        // Level 3 never restarts.
        d.levels[2].restart = Some(0);
        d.levels[2].text = "(%3)".into();
        let mut n = Numbering::default();
        n.insert(d);
        let got = labels(&n, &[r(1, 0), r(1, 1), r(1, 2), r(1, 0), r(1, 1), r(1, 2)]);
        assert_eq!(got, ["I.", "1.1", "(i)", "II.", "2.1", "(ii)"]);
    }

    #[test]
    fn shared_abstract_continues_until_start_override() {
        let mut n = Numbering::default();
        n.insert(NumberingDef::decimal_default(1));
        let a = n.ensure_abstract(1).unwrap();
        assert_eq!(n.ensure_abstract(1), Some(a));
        n.insert(NumberingDef {
            id: 2,
            abstract_id: Some(a),
            overrides: vec![],
            levels: vec![],
        });
        n.insert(NumberingDef {
            id: 3,
            abstract_id: Some(a),
            overrides: vec![LevelOverride {
                level: 0,
                start: Some(1),
                definition: None,
            }],
            levels: vec![],
        });
        n.resolve();
        assert_eq!(n.get(2).unwrap().levels, n.get(1).unwrap().levels);
        let got = labels(&n, &[r(1, 0), r(1, 0), r(2, 0), r(3, 0), r(3, 0), r(1, 0)]);
        // 2 continues 1; 3 restarts; 1 then continues the shared counter.
        assert_eq!(got, ["1.", "2.", "3.", "1.", "2.", "3."]);
        // a standalone list counts alone
        n.insert(NumberingDef::decimal_default(4));
        assert_eq!(labels(&n, &[r(1, 0), r(4, 0), r(1, 0)]), ["1.", "1.", "2."]);
        assert!(ListCounter::default().next(&n, r(0, 0)).is_none());
        assert!(ListCounter::default().next(&n, r(9, 0)).is_none());
    }

    #[test]
    fn overrides_resolve() {
        let mut n = Numbering::default();
        n.abstracts.push(AbstractNumbering {
            id: 5,
            levels: vec![Level::new(LevelKind::Decimal, "%1.")],
        });
        n.insert(NumberingDef {
            id: 1,
            abstract_id: Some(5),
            overrides: vec![
                LevelOverride {
                    level: 0,
                    start: Some(4),
                    definition: None,
                },
                LevelOverride {
                    level: 2,
                    start: None,
                    definition: Some(Level::new(LevelKind::Bullet, "–")),
                },
            ],
            levels: vec![],
        });
        n.insert(NumberingDef {
            id: 2,
            abstract_id: Some(99),
            overrides: vec![],
            levels: vec![Level::new(LevelKind::Ordinal, "%1")],
        });
        n.resolve();
        let d = n.get(1).unwrap();
        assert_eq!(d.levels.len(), 3);
        assert_eq!(d.levels[0].start, 4);
        assert_eq!(d.levels[1], filler_level(1));
        assert_eq!(d.levels[2].text, "–");
        let d2 = n.get(2).unwrap();
        assert_eq!((d2.abstract_id, d2.levels.len()), (None, 1));
        assert_eq!(n.next_abstract_id(), 6);
        assert_eq!(labels(&n, &[r(1, 0), r(1, 2), r(2, 0)]), ["4.", "–", "1st"]);
    }

    #[test]
    fn json_keeps_old_shape() {
        let json = serde_json::to_string(&NumberingDef::decimal_default(1)).unwrap();
        assert!(
            json.starts_with(
                r#"{"id":1,"levels":[{"kind":"decimal","text":"%1.","start":1,"indent""#
            ),
            "{json}"
        );
        assert!(!json.contains("legal") && !json.contains("suffix"));
        let back: NumberingDef = serde_json::from_str(&json).unwrap();
        assert_eq!(back, NumberingDef::decimal_default(1));
    }
}
