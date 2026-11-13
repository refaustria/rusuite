//! Reader warnings, in the same shape as the other format crates'
//! (`fmt_docx::ReaderWarning`): a stable code the UI translates, its
//! parameters, the English text and a repeat count.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

/// A note about content that was dropped or approximated. Codes start with
/// `onenote.` and are listed in `docs/onenote-subset.md`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarning {
    /// Stable identifier, e.g. `onenote.ink.inText`.
    pub code: String,
    /// Values of the `{name}` placeholders of the message.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
    /// The English message (without the count).
    pub text: String,
    /// How often it occurred.
    pub count: usize,
}

impl ImportWarning {
    /// The English line: the text, with ` (Nx)` for repeats.
    pub fn line(&self) -> String {
        match self.count {
            0 | 1 => self.text.clone(),
            n => format!("{} ({n}x)", self.text),
        }
    }
}

/// Collects warnings, merging repeats (same text) into one entry.
#[derive(Debug, Default)]
pub(crate) struct Warnings {
    order: Vec<ImportWarning>,
    index: HashMap<String, usize>,
}

impl Warnings {
    /// Adds warning `code`: `template` with its `{name}` placeholders
    /// replaced by `params` is the English text.
    pub(crate) fn warn(
        &mut self,
        code: &'static str,
        template: &'static str,
        params: &[(&'static str, &dyn std::fmt::Display)],
    ) {
        let mut text = template.to_owned();
        let mut map = BTreeMap::new();
        for (k, v) in params {
            let v = v.to_string();
            text = text.replace(&format!("{{{k}}}"), &v);
            map.insert((*k).to_owned(), v);
        }
        match self.index.get(&text) {
            Some(&i) => self.order[i].count += 1,
            None => {
                self.index.insert(text.clone(), self.order.len());
                self.order.push(ImportWarning {
                    code: code.to_owned(),
                    params: map,
                    text,
                    count: 1,
                });
            }
        }
    }

    pub(crate) fn into_warnings(self) -> Vec<ImportWarning> {
        self.order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_merge_and_placeholders_fill() {
        let mut w = Warnings::default();
        w.warn("onenote.x", "{what} dropped", &[("what", &"ink")]);
        w.warn("onenote.x", "{what} dropped", &[("what", &"ink")]);
        w.warn("onenote.x", "{what} dropped", &[("what", &"math")]);
        let v = w.into_warnings();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].line(), "ink dropped (2x)");
        assert_eq!(v[0].params["what"], "ink");
        assert_eq!(v[1].line(), "math dropped");
    }
}
