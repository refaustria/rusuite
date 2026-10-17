//! [`WritePatch`]: what changed, reported after every command, undo and
//! redo (ADR 0007 §1).

use app_common::Patch;
use model_text::{
    Block, Comment, CoreProperties, DocumentSettings, NodeId, Note, Numbering, PageSetup, Section,
    StyleSheet,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A block that is new at its position.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct InsertedBlock {
    /// The preceding sibling (`null` = first in its container).
    pub after: Option<NodeId>,
    /// The table cell holding the block (`null` = the body).
    pub parent: Option<NodeId>,
    /// The block with its real ids.
    pub block: Block,
}

/// The authoritative changes of one command, undo or redo.
///
/// The UI applies them in this order: remove `deleted`, insert `inserted`
/// in list order (each `after` exists by then), then replace every block
/// of `replaced` by id. A block appears in at most one of the three
/// lists; blocks inside an inserted or replaced block are not listed
/// separately. Structural changes inside a table cell (blocks inserted,
/// deleted or replaced there, cell/row/column/table properties) report
/// the whole innermost table in `replaced`; text and paragraph-property
/// changes report just the paragraph, wherever it is. Paragraphs whose
/// list label changed are reported in `replaced` too; every reported
/// numbered paragraph carries its `listLabel`. Changes inside notes,
/// headers and footers report all `notes` / `sections` instead; comment
/// changes report all `comments` (and the paragraphs whose markers
/// changed).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/write/src/generated/")]
pub struct WritePatch {
    /// Full blocks (top-level or inside a cell) that changed in place.
    pub replaced: Vec<Block>,
    /// Blocks new at their position (top level).
    pub inserted: Vec<InsertedBlock>,
    /// Removed top-level blocks. A block that was removed and re-inserted
    /// (e.g. `replaceBlocks` reusing an id) appears here and in
    /// `inserted`.
    pub deleted: Vec<NodeId>,
    /// `[temporary id, real id]` for every temporary id of the command.
    #[ts(type = "Array<[number, NodeId]>")]
    pub id_map: Vec<(i64, NodeId)>,
    /// The whole style sheet, when it changed.
    pub styles: Option<StyleSheet>,
    /// All list definitions, when they changed.
    pub numbering: Option<Numbering>,
    /// The page setup, when it changed.
    pub page: Option<PageSetup>,
    /// All sections (with their headers and footers), when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sections: Option<Vec<Section>>,
    /// All footnotes and endnotes, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notes: Option<Vec<Note>>,
    /// All comments, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comments: Option<Vec<Comment>>,
    /// The document properties, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub properties: Option<CoreProperties>,
    /// The document settings, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub settings: Option<DocumentSettings>,
    /// The footnote/endnote separators, when they changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub separators: Option<model_text::NoteSeparators>,
    /// A message for the status bar (e.g. `"3 replacements"`).
    pub info: Option<String>,
}

impl WritePatch {
    /// Whether nothing changed.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

impl Patch for WritePatch {
    /// Folds a later patch into this one. The document folds compound
    /// commands itself (with exact positions); this is a best-effort merge
    /// for callers combining independent replies.
    fn merge(&mut self, other: Self) {
        for id in other.deleted {
            self.replaced.retain(|b| b.id() != id);
            let before = self.inserted.len();
            self.inserted.retain(|b| b.block.id() != id);
            if self.inserted.len() == before && !self.deleted.contains(&id) {
                self.deleted.push(id);
            }
        }
        for ins in other.inserted {
            self.replaced.retain(|b| b.id() != ins.block.id());
            self.inserted.push(ins);
        }
        for block in other.replaced {
            if let Some(slot) = self
                .inserted
                .iter_mut()
                .find(|b| b.block.id() == block.id())
            {
                slot.block = block;
            } else if let Some(slot) = self.replaced.iter_mut().find(|b| b.id() == block.id()) {
                *slot = block;
            } else {
                self.replaced.push(block);
            }
        }
        self.id_map.extend(other.id_map);
        if other.styles.is_some() {
            self.styles = other.styles;
        }
        if other.numbering.is_some() {
            self.numbering = other.numbering;
        }
        if other.page.is_some() {
            self.page = other.page;
        }
        if other.sections.is_some() {
            self.sections = other.sections;
        }
        if other.notes.is_some() {
            self.notes = other.notes;
        }
        if other.comments.is_some() {
            self.comments = other.comments;
        }
        if other.properties.is_some() {
            self.properties = other.properties;
        }
        if other.settings.is_some() {
            self.settings = other.settings;
        }
        if other.separators.is_some() {
            self.separators = other.separators;
        }
        if other.info.is_some() {
            self.info = other.info;
        }
    }
}
