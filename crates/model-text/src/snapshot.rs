//! JSON snapshots of a [`Document`].
//!
//! The snapshot is the document itself: node ids are persisted, and the id
//! counter is recomputed on load as the largest id + 1 so newly allocated
//! ids never collide with loaded ones.

use serde::Deserialize;

use crate::block::Block;
use crate::document::Document;
use crate::media::MediaStore;
use crate::numbering::Numbering;
use crate::page::PageSetup;
use crate::style::StyleSheet;
use crate::Error;

/// The serializable form of a [`Document`] (identical to it).
pub type DocumentSnapshot = Document;

/// Deserialization shape of [`Document`] (everything but the id counter).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentData {
    #[serde(default)]
    body: Vec<Block>,
    #[serde(default)]
    styles: StyleSheet,
    #[serde(default)]
    numbering: Numbering,
    #[serde(default)]
    page: PageSetup,
    #[serde(default)]
    media: MediaStore,
}

impl From<DocumentData> for Document {
    fn from(d: DocumentData) -> Self {
        let mut doc = Document::empty(d.styles, d.page);
        doc.body = d.body;
        doc.numbering = d.numbering;
        doc.media = d.media;
        doc.next_id = doc.max_node_id() + 1;
        doc
    }
}

impl Document {
    /// Serializes the document to JSON.
    pub fn to_json(&self) -> Result<String, Error> {
        Ok(serde_json::to_string(self)?)
    }

    /// Parses a document from JSON produced by [`Document::to_json`].
    pub fn from_json(json: &str) -> Result<Self, Error> {
        Ok(serde_json::from_str(json)?)
    }
}
