//! Tags in formats without tags (Markdown, HTML, .docx): a plain-text marker ` [Label]` after the block's text
//! (`docs/notes-format.md` §7). Built-in tags use their English catalog label (`To-do`, `Important`, …), a ticked
//! to-do `To-do: done`; custom tags their own label. Importers recognise trailing markers whose label is in the
//! notebook's [`TagCatalog`].
use model_notes::{TagDef, TagKind};

/// The English label of a built-in tag kind (custom kinds: `None`).
#[must_use]
pub fn tag_label(kind: TagKind) -> Option<&'static str> {
    Some(match kind {
        TagKind::ToDo => "To-do",
        TagKind::Important => "Important",
        TagKind::Question => "Question",
        TagKind::Idea => "Idea",
        TagKind::Critical => "Critical",
        TagKind::Contact => "Contact",
        TagKind::Address => "Address",
        TagKind::Phone => "Phone number",
        TagKind::Remember => "Remember for later",
        TagKind::Definition => "Definition",
        TagKind::Highlight => "Highlight",
        TagKind::Custom | TagKind::CustomToDo => return None,
    })
}

/// The tag definitions of the target notebook (id, kind, label for markers).
#[derive(Debug, Clone, Default)]
pub struct TagCatalog {
    defs: Vec<TagDef>,
}

impl TagCatalog {
    #[must_use]
    pub fn new(defs: Vec<TagDef>) -> Self {
        Self { defs }
    }

    /// The built-in tags only (no notebook at hand).
    #[must_use]
    pub fn builtin() -> Self {
        let kinds = [
            ("todo", TagKind::ToDo),
            ("important", TagKind::Important),
            ("question", TagKind::Question),
            ("idea", TagKind::Idea),
            ("critical", TagKind::Critical),
            ("contact", TagKind::Contact),
            ("address", TagKind::Address),
            ("phone", TagKind::Phone),
            ("remember", TagKind::Remember),
            ("definition", TagKind::Definition),
            ("highlight", TagKind::Highlight),
        ];
        Self::new(
            kinds
                .iter()
                .map(|(id, kind)| TagDef {
                    id: (*id).into(),
                    kind: *kind,
                    label: String::new(),
                    icon: None,
                    color: None,
                })
                .collect(),
        )
    }

    fn label_of(def: &TagDef) -> String {
        if def.label.is_empty() {
            tag_label(def.kind).unwrap_or(def.id.as_str()).to_string()
        } else {
            def.label.clone()
        }
    }

    fn defs(&self) -> Vec<TagDef> {
        if self.defs.is_empty() {
            Self::builtin().defs
        } else {
            self.defs.clone()
        }
    }

    /// The marker text for a block's tags, e.g. ` [To-do: done] [Important]` (empty without tags).
    #[must_use]
    pub fn marker(&self, tags: &[String], checked: Option<bool>) -> String {
        let defs = self.defs();
        let mut out = String::new();
        for id in tags {
            let def = defs.iter().find(|d| &d.id == id);
            let label = def.map_or_else(|| id.clone(), Self::label_of);
            let todo = def.is_some_and(|d| d.kind.is_todo());
            if todo && checked == Some(true) {
                out.push_str(&format!(" [{label}: done]"));
            } else {
                out.push_str(&format!(" [{label}]"));
            }
        }
        out
    }

    /// Splits trailing tag markers off `text`: the text without them, the tag ids and the checked state.
    #[must_use]
    pub fn strip_markers(&self, text: &str) -> (String, Vec<String>, Option<bool>) {
        let defs = self.defs();
        let mut rest = text.trim_end().to_string();
        let mut tags = Vec::new();
        let mut checked = None;
        while let Some(inner) = rest.strip_suffix(']') {
            let Some(open) = inner.rfind(" [") else { break };
            let label = &inner[open + 2..];
            let (label, done) = match label.strip_suffix(": done") {
                Some(l) => (l, true),
                None => (label, false),
            };
            let Some(def) = defs
                .iter()
                .find(|d| Self::label_of(d).eq_ignore_ascii_case(label))
            else {
                break;
            };
            if def.kind.is_todo() {
                checked = Some(done || checked == Some(true));
            } else if done {
                break;
            }
            tags.insert(0, def.id.clone());
            rest.truncate(open);
        }
        (rest, tags, checked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_round_trip() {
        let c = TagCatalog::builtin();
        let tags = vec!["todo".to_string(), "important".to_string()];
        let m = c.marker(&tags, Some(true));
        assert_eq!(m, " [To-do: done] [Important]");
        let (text, back, checked) = c.strip_markers(&format!("Buy milk{m}"));
        assert_eq!(text, "Buy milk");
        assert_eq!(back, tags);
        assert_eq!(checked, Some(true));
        let (text, back, _) = c.strip_markers("see [Unknown]");
        assert_eq!((text.as_str(), back.len()), ("see [Unknown]", 0));
    }

    #[test]
    fn custom_labels() {
        let c = TagCatalog::new(vec![TagDef {
            id: "t-1".into(),
            kind: TagKind::Custom,
            label: "Follow up".into(),
            icon: None,
            color: None,
        }]);
        assert_eq!(c.marker(&["t-1".into()], None), " [Follow up]");
        assert_eq!(c.strip_markers("x [follow up]").1, ["t-1"]);
    }
}
