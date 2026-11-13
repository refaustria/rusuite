//! Converter warnings, in the shape of the other readers' (`fmt_docx::ReaderWarning`,
//! `fmt_onenote::ImportWarning`): a stable code the UI translates, its parameters, the English text and a
//! repeat count. Codes: `onenote.*` (passed through from `fmt-onenote`), `docx.*` (from `fmt-docx` and the
//! page mapping), `notes.*` (this crate; listed in `docs/notes-format.md` §7).
use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

/// A note about content that was dropped or approximated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ConvertWarning {
    pub code: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "Option<BTreeMap<String, String>>", optional))]
    pub params: BTreeMap<String, String>,
    /// The English message (without the count).
    pub text: String,
    pub count: usize,
}

impl ConvertWarning {
    /// The English line: the text, with ` (Nx)` for repeats.
    #[must_use]
    pub fn line(&self) -> String {
        match self.count {
            0 | 1 => self.text.clone(),
            n => format!("{} ({n}x)", self.text),
        }
    }
}

impl From<fmt_onenote::ImportWarning> for ConvertWarning {
    fn from(w: fmt_onenote::ImportWarning) -> Self {
        ConvertWarning {
            code: w.code,
            params: w.params,
            text: w.text,
            count: w.count,
        }
    }
}

impl From<fmt_docx::ReaderWarning> for ConvertWarning {
    fn from(w: fmt_docx::ReaderWarning) -> Self {
        ConvertWarning {
            code: w.code,
            params: w.params,
            text: w.text,
            count: w.count,
        }
    }
}

/// Collects warnings, merging repeats (same text) into one entry.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    order: Vec<ConvertWarning>,
    index: HashMap<String, usize>,
}

impl Warnings {
    /// Adds warning `code`: `template` with its `{name}` placeholders replaced by `params`.
    pub(crate) fn warn(&mut self, code: &str, template: &str, params: &[(&str, &str)]) {
        let mut text = template.to_owned();
        let mut map = BTreeMap::new();
        for (k, v) in params {
            text = text.replace(&format!("{{{k}}}"), v);
            map.insert((*k).to_owned(), (*v).to_owned());
        }
        self.push(ConvertWarning {
            code: code.to_owned(),
            params: map,
            text,
            count: 1,
        });
    }

    pub(crate) fn push(&mut self, w: ConvertWarning) {
        match self.index.get(&w.text) {
            Some(&i) => self.order[i].count += w.count.max(1),
            None => {
                self.index.insert(w.text.clone(), self.order.len());
                self.order.push(w);
            }
        }
    }

    pub(crate) fn into_vec(self) -> Vec<ConvertWarning> {
        self.order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_merge() {
        let mut w = Warnings::default();
        w.warn("notes.x", "{what} dropped", &[("what", "ink")]);
        w.warn("notes.x", "{what} dropped", &[("what", "ink")]);
        w.warn("notes.x", "{what} dropped", &[("what", "math")]);
        let v = w.into_vec();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].line(), "ink dropped (2x)");
        assert_eq!(v[0].params["what"], "ink");
    }
}
