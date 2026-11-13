//! Tag definitions (list `"tags"` of the notebook doc). Blocks reference them by id in their `tags` attribute.
use serde::{Deserialize, Serialize};

/// The kind of a tag; the built-in kinds mirror OneNote's (and `fmt-onenote`'s `TagKind`), so the importer can
/// map them 1:1. `ToDo`-like kinds carry a checked state on the block (`checked` attribute).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub enum TagKind {
    ToDo,
    Important,
    Question,
    Idea,
    Critical,
    Contact,
    Address,
    Phone,
    Remember,
    Definition,
    Highlight,
    /// A user-defined tag (label, icon and colour from its definition).
    Custom,
    /// A user-defined tag with a check box.
    CustomToDo,
}

impl TagKind {
    /// Tags of this kind have a check box and appear in the tasks view.
    #[must_use]
    pub fn is_todo(self) -> bool {
        matches!(self, TagKind::ToDo | TagKind::CustomToDo)
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            TagKind::ToDo => "toDo",
            TagKind::Important => "important",
            TagKind::Question => "question",
            TagKind::Idea => "idea",
            TagKind::Critical => "critical",
            TagKind::Contact => "contact",
            TagKind::Address => "address",
            TagKind::Phone => "phone",
            TagKind::Remember => "remember",
            TagKind::Definition => "definition",
            TagKind::Highlight => "highlight",
            TagKind::Custom => "custom",
            TagKind::CustomToDo => "customToDo",
        }
    }

    pub(crate) fn parse(s: &str) -> TagKind {
        serde_json::from_value(serde_json::Value::String(s.to_string())).unwrap_or(TagKind::Custom)
    }
}

/// One tag definition. Built-in tags have fixed ids (`todo`, `important`, …) and an empty label: the UI shows its
/// catalog text for the kind; custom tags carry the user's label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct TagDef {
    pub id: String,
    pub kind: TagKind,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub color: Option<String>,
}

/// The built-in tags every new notebook starts with: (id, kind, icon).
pub(crate) const BUILTIN_TAGS: &[(&str, TagKind, &str)] = &[
    ("todo", TagKind::ToDo, "checkbox"),
    ("important", TagKind::Important, "star"),
    ("question", TagKind::Question, "question"),
    ("idea", TagKind::Idea, "lightbulb"),
    ("critical", TagKind::Critical, "exclamation"),
    ("contact", TagKind::Contact, "person"),
    ("address", TagKind::Address, "house"),
    ("phone", TagKind::Phone, "phone"),
    ("remember", TagKind::Remember, "bookmark"),
    ("definition", TagKind::Definition, "book"),
    ("highlight", TagKind::Highlight, "marker"),
];
