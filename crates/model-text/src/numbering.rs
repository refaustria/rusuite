//! List numbering definitions (docx `numbering.xml`, flattened per `num`).

use core_model::units::Twips;
use core_model::FontFace;
use serde::{Deserialize, Serialize};

use crate::props::{Indent, NumberingRef};

/// Number format of a list level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LevelKind {
    /// A bullet character (the level's `text`).
    Bullet,
    /// 1, 2, 3, …
    Decimal,
    /// a, b, c, …
    LowerLetter,
    /// A, B, C, …
    UpperLetter,
    /// i, ii, iii, …
    LowerRoman,
    /// I, II, III, …
    UpperRoman,
}

/// One level of a list.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    /// Number format.
    pub kind: LevelKind,
    /// Label template: `"%1."` (`%n` = number of level n, 1-based) or the
    /// bullet character.
    pub text: String,
    /// First number.
    pub start: u32,
    /// Indentation of paragraphs on this level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent: Option<Indent>,
    /// Font of the label (e.g. `Symbol` for bullets).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<FontFace>,
}

/// A list definition: up to nine levels (docx `w:num` with its resolved
/// `w:abstractNum`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberingDef {
    /// Id referenced by [`NumberingRef::num_id`]; never `0`.
    pub id: u32,
    /// Levels `0..=8`.
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
    /// Word's default bulleted list: `•` (Symbol), `o` (Courier New),
    /// `▪` (Wingdings), repeating; indents 720, 1440, … with 360 hanging.
    pub fn bullet_default(id: u32) -> Self {
        let bullets = [("•", "Symbol"), ("o", "Courier New"), ("▪", "Wingdings")];
        let levels = (0..9)
            .map(|i| {
                let (text, font) = bullets[i % 3];
                Level {
                    kind: LevelKind::Bullet,
                    text: text.to_owned(),
                    start: 1,
                    indent: level_indent(i, 360),
                    font: Some(FontFace::from(font)),
                }
            })
            .collect();
        Self { id, levels }
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
                    kind,
                    text: format!("%{}.", i + 1),
                    start: 1,
                    indent: level_indent(i, hanging),
                    font: None,
                }
            })
            .collect();
        Self { id, levels }
    }

    /// The level `level`, if defined.
    pub fn level(&self, level: u8) -> Option<&Level> {
        self.levels.get(usize::from(level))
    }
}

/// All list definitions of a document.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Numbering {
    /// Definitions; ids are unique.
    #[serde(default)]
    pub defs: Vec<NumberingDef>,
}

impl Numbering {
    /// The definition with id `id`.
    pub fn get(&self, id: u32) -> Option<&NumberingDef> {
        self.defs.iter().find(|d| d.id == id)
    }

    /// The level a paragraph's numbering reference points to. `None` for
    /// `num_id == 0` ("no numbering") and dangling references.
    pub fn level(&self, num: NumberingRef) -> Option<&Level> {
        if num.num_id == 0 {
            return None;
        }
        self.get(num.num_id)?.level(num.level)
    }

    /// An unused id (max + 1, at least 1).
    pub fn next_id(&self) -> u32 {
        self.defs.iter().map(|d| d.id).max().unwrap_or(0) + 1
    }

    /// Adds `def`, replacing a definition with the same id.
    pub fn insert(&mut self, def: NumberingDef) {
        match self.defs.iter_mut().find(|d| d.id == def.id) {
            Some(slot) => *slot = def,
            None => self.defs.push(def),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    #[test]
    fn lookup() {
        let mut n = Numbering::default();
        assert_eq!(n.next_id(), 1);
        n.insert(NumberingDef::bullet_default(1));
        n.insert(NumberingDef::decimal_default(n.next_id()));
        assert_eq!(n.defs.len(), 2);
        let lvl = n
            .level(NumberingRef {
                num_id: 2,
                level: 1,
            })
            .unwrap();
        assert_eq!(lvl.kind, LevelKind::LowerLetter);
        assert!(n
            .level(NumberingRef {
                num_id: 0,
                level: 0
            })
            .is_none());
        assert!(n
            .level(NumberingRef {
                num_id: 9,
                level: 0
            })
            .is_none());
        assert!(n
            .level(NumberingRef {
                num_id: 1,
                level: 9
            })
            .is_none());
        n.insert(NumberingDef::decimal_default(1));
        assert_eq!(n.defs.len(), 2);
        assert_eq!(n.get(1).unwrap().levels[0].kind, LevelKind::Decimal);
    }
}
