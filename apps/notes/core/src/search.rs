//! In-memory full-text index over page titles and plain text.
//!
//! Matching is case- and diacritics-insensitive (Unicode NFKD, combining marks stripped, lowercase), per word
//! by prefix, AND across words; `"quoted words"` must appear as a phrase. Pages whose title matches every term
//! rank before body-only hits.
use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use unicode_normalization::char::{decompose_compatible, is_combining_mark};

/// Appends the search form of `c` (NFKD, no combining marks, lowercase) to `out`.
fn fold_char(c: char, out: &mut String) {
    if c.is_ascii() {
        out.push(c.to_ascii_lowercase());
        return;
    }
    decompose_compatible(c, |d| {
        if !is_combining_mark(d) {
            out.extend(d.to_lowercase());
        }
    });
}

/// The search form of a string.
#[must_use]
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        fold_char(c, &mut out);
    }
    out
}

/// A word of the original text: its search form and its byte range in the original.
struct Token {
    word: String,
    start: usize,
    end: usize,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || is_combining_mark(c)
}

fn tokens(s: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut cur: Option<Token> = None;
    for (i, c) in s.char_indices() {
        if is_word_char(c) {
            let t = cur.get_or_insert_with(|| Token {
                word: String::new(),
                start: i,
                end: i,
            });
            fold_char(c, &mut t.word);
            t.end = i + c.len_utf8();
        } else if let Some(t) = cur.take() {
            if !t.word.is_empty() {
                out.push(t);
            }
        }
    }
    if let Some(t) = cur.filter(|t| !t.word.is_empty()) {
        out.push(t);
    }
    out
}

fn words(s: &str) -> Vec<String> {
    tokens(s).into_iter().map(|t| t.word).collect()
}

/// A parsed query term.
#[derive(Debug, Clone, PartialEq)]
enum Term {
    /// A word matched by prefix.
    Prefix(String),
    /// Consecutive words, matched exactly except the last (prefix).
    Phrase(Vec<String>),
}

fn parse_query(q: &str) -> Vec<Term> {
    let mut terms = Vec::new();
    for (i, part) in q.split('"').enumerate() {
        let ws = words(part);
        if i % 2 == 1 {
            match ws.len() {
                0 => {}
                1 => terms.push(Term::Prefix(ws[0].clone())),
                _ => terms.push(Term::Phrase(ws)),
            }
        } else {
            terms.extend(ws.into_iter().map(Term::Prefix));
        }
    }
    terms
}

/// Whether the word sequence `seq` contains `phrase` (all words exact, the last by prefix).
fn seq_has_phrase(seq: &[String], phrase: &[String]) -> bool {
    let Some((last, init)) = phrase.split_last() else {
        return false;
    };
    seq.windows(phrase.len())
        .any(|w| w[..init.len()] == *init && w[init.len()].starts_with(last.as_str()))
}

fn term_matches(seq: &[String], t: &Term) -> bool {
    match t {
        Term::Prefix(p) => seq.iter().any(|w| w.starts_with(p.as_str())),
        Term::Phrase(ph) => seq_has_phrase(seq, ph),
    }
}

/// Byte ranges (in the original string) of every token matching any term.
fn match_ranges(text: &str, terms: &[Term]) -> Vec<(usize, usize)> {
    let toks = tokens(text);
    let ws: Vec<String> = toks.iter().map(|t| t.word.clone()).collect();
    let mut out = Vec::new();
    for t in terms {
        match t {
            Term::Prefix(p) => {
                for tok in toks.iter().filter(|tok| tok.word.starts_with(p.as_str())) {
                    out.push((tok.start, tok.end));
                }
            }
            Term::Phrase(ph) => {
                if ph.is_empty() || ws.len() < ph.len() {
                    continue;
                }
                for i in 0..=ws.len() - ph.len() {
                    if seq_has_phrase(&ws[i..i + ph.len()], ph) {
                        out.push((toks[i].start, toks[i + ph.len() - 1].end));
                    }
                }
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn utf16_len(s: &str) -> u32 {
    u32::try_from(s.encode_utf16().count()).unwrap_or(u32::MAX)
}

/// A search hit. Ranges are `[start, end)` in UTF-16 code units of `snippet` / `title` (JS string indices).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/notes/src/generated/")]
pub struct SearchHit {
    pub notebook_id: String,
    pub doc_id: String,
    pub title: String,
    pub title_ranges: Vec<[u32; 2]>,
    pub snippet: String,
    pub ranges: Vec<[u32; 2]>,
}

struct Entry {
    notebook: String,
    doc: String,
    title: String,
    title_words: Vec<String>,
    text: String,
    text_words: Vec<String>,
    /// Unique words of title + text (keys into `SearchIndex::words`).
    vocab: BTreeSet<String>,
}

/// The index of all pages of the open notebooks.
#[derive(Default)]
pub struct SearchIndex {
    entries: Vec<Option<Entry>>,
    by_key: HashMap<(String, String), u32>,
    words: BTreeMap<String, BTreeSet<u32>>,
}

const SNIPPET_BEFORE: usize = 40;
const SNIPPET_LEN: usize = 160;

impl SearchIndex {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of indexed pages.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_key.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_key.is_empty()
    }

    /// Adds or replaces a page.
    pub fn upsert(&mut self, notebook: &str, doc: &str, title: &str, text: &str) {
        let key = (notebook.to_string(), doc.to_string());
        if let Some(&slot) = self.by_key.get(&key) {
            self.drop_words(slot);
        }
        let title_words = words(title);
        let text_words = words(text);
        let vocab: BTreeSet<String> = title_words
            .iter()
            .chain(text_words.iter())
            .cloned()
            .collect();
        let slot = match self.by_key.get(&key) {
            Some(&s) => s,
            None => {
                let s = u32::try_from(self.entries.len()).unwrap_or(u32::MAX);
                self.entries.push(None);
                self.by_key.insert(key, s);
                s
            }
        };
        for w in &vocab {
            self.words.entry(w.clone()).or_default().insert(slot);
        }
        self.entries[slot as usize] = Some(Entry {
            notebook: notebook.to_string(),
            doc: doc.to_string(),
            title: title.to_string(),
            title_words,
            text: text.to_string(),
            text_words,
            vocab,
        });
    }

    /// Whether the page is indexed with exactly this title and text.
    pub(crate) fn same(&self, notebook: &str, doc: &str, title: &str, text: &str) -> bool {
        self.by_key
            .get(&(notebook.to_string(), doc.to_string()))
            .and_then(|s| self.entries[*s as usize].as_ref())
            .is_some_and(|e| e.title == title && e.text == text)
    }

    /// Updates only the title of an indexed page (keeps its text).
    pub fn set_title(&mut self, notebook: &str, doc: &str, title: &str) {
        let key = (notebook.to_string(), doc.to_string());
        let Some(&slot) = self.by_key.get(&key) else {
            return;
        };
        let text = self.entries[slot as usize]
            .as_ref()
            .map(|e| e.text.clone())
            .unwrap_or_default();
        self.upsert(notebook, doc, title, &text);
    }

    fn drop_words(&mut self, slot: u32) {
        if let Some(e) = self.entries[slot as usize].take() {
            for w in &e.vocab {
                if let Some(set) = self.words.get_mut(w) {
                    set.remove(&slot);
                    if set.is_empty() {
                        self.words.remove(w);
                    }
                }
            }
        }
    }

    pub fn remove(&mut self, notebook: &str, doc: &str) {
        if let Some(slot) = self.by_key.remove(&(notebook.to_string(), doc.to_string())) {
            self.drop_words(slot);
        }
    }

    pub fn remove_notebook(&mut self, notebook: &str) {
        let docs: Vec<String> = self
            .by_key
            .keys()
            .filter(|(n, _)| n == notebook)
            .map(|(_, d)| d.clone())
            .collect();
        for d in docs {
            self.remove(notebook, &d);
        }
    }

    /// Pages containing a word starting with `prefix`.
    fn prefix_pages(&self, prefix: &str) -> BTreeSet<u32> {
        let mut out = BTreeSet::new();
        for (_, pages) in self
            .words
            .range(prefix.to_string()..)
            .take_while(|(w, _)| w.starts_with(prefix))
        {
            out.extend(pages.iter().copied());
        }
        out
    }

    /// Runs a query; `notebook` restricts it to one notebook, `include` filters pages (e.g. not deleted).
    pub fn search(
        &self,
        query: &str,
        notebook: Option<&str>,
        limit: usize,
        include: &dyn Fn(&str, &str) -> bool,
    ) -> Vec<SearchHit> {
        let terms = parse_query(query);
        if terms.is_empty() {
            return Vec::new();
        }
        // Candidates: AND over the terms' page sets (a phrase contributes its words: exact, last by prefix).
        let mut cand: Option<BTreeSet<u32>> = None;
        for t in &terms {
            let set = match t {
                Term::Prefix(p) => self.prefix_pages(p),
                Term::Phrase(ph) => {
                    let mut s: Option<BTreeSet<u32>> = None;
                    for (i, w) in ph.iter().enumerate() {
                        let pages = if i + 1 == ph.len() {
                            self.prefix_pages(w)
                        } else {
                            self.words.get(w).cloned().unwrap_or_default()
                        };
                        s = Some(match s {
                            None => pages,
                            Some(prev) => prev.intersection(&pages).copied().collect(),
                        });
                    }
                    s.unwrap_or_default()
                }
            };
            cand = Some(match cand {
                None => set,
                Some(prev) => prev.intersection(&set).copied().collect(),
            });
            if cand.as_ref().is_some_and(BTreeSet::is_empty) {
                return Vec::new();
            }
        }
        // Verify (phrases, and terms split between title and body) and rank.
        let mut scored: Vec<(u8, usize, &Entry)> = Vec::new();
        for slot in cand.unwrap_or_default() {
            let Some(e) = self.entries[slot as usize].as_ref() else {
                continue;
            };
            if notebook.is_some_and(|n| n != e.notebook) || !include(&e.notebook, &e.doc) {
                continue;
            }
            let mut all_title = true;
            let mut ok = true;
            let mut body_hits = 0usize;
            for t in &terms {
                let in_title = term_matches(&e.title_words, t);
                let in_body = term_matches(&e.text_words, t);
                all_title &= in_title;
                if !in_title && !in_body {
                    ok = false;
                    break;
                }
                if in_body {
                    body_hits += match t {
                        Term::Prefix(p) => e
                            .text_words
                            .iter()
                            .filter(|w| w.starts_with(p.as_str()))
                            .count(),
                        Term::Phrase(_) => 1,
                    };
                }
            }
            if ok {
                scored.push((u8::from(!all_title), body_hits, e));
            }
        }
        scored.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then(b.1.cmp(&a.1))
                .then_with(|| a.2.title.cmp(&b.2.title))
        });
        scored
            .into_iter()
            .take(limit)
            .map(|(_, _, e)| hit(e, &terms))
            .collect()
    }
}

fn hit(e: &Entry, terms: &[Term]) -> SearchHit {
    let title_ranges = to_utf16_ranges(&e.title, 0, &match_ranges(&e.title, terms));
    let ranges = match_ranges(&e.text, terms);
    // Window: from a little before the first body match, on char boundaries, newlines shown as spaces.
    let first = ranges.first().map_or(0, |r| r.0);
    let mut start = first;
    let mut back = 0;
    while start > 0 && back < SNIPPET_BEFORE {
        start -= 1;
        while !e.text.is_char_boundary(start) {
            start -= 1;
        }
        back += 1;
    }
    // Start at a word boundary when we cut into the text.
    if start > 0 {
        if let Some(sp) = e.text[start..first].find(char::is_whitespace) {
            start += sp + 1;
        }
    }
    let mut end = start;
    for (n, (i, c)) in e.text[start..].char_indices().enumerate() {
        if n >= SNIPPET_LEN {
            break;
        }
        end = start + i + c.len_utf8();
    }
    let ellipsis = u32::from(start > 0);
    let in_window: Vec<(usize, usize)> = ranges
        .into_iter()
        .filter(|r| r.0 >= start && r.1 <= end)
        .collect();
    let ranges = to_utf16_ranges(&e.text[start..end], start, &in_window)
        .into_iter()
        .map(|[a, b]| [a + ellipsis, b + ellipsis])
        .collect();
    SearchHit {
        notebook_id: e.notebook.clone(),
        doc_id: e.doc.clone(),
        title: e.title.clone(),
        title_ranges,
        ranges,
        snippet: format!(
            "{}{}",
            if start > 0 { "…" } else { "" },
            e.text[start..end].replace('\n', " ")
        ),
    }
}

/// Byte ranges of the original → UTF-16 ranges within `s`, which starts at byte `base` of the original → UTF-16 ranges within it.
fn to_utf16_ranges(s: &str, base: usize, ranges: &[(usize, usize)]) -> Vec<[u32; 2]> {
    ranges
        .iter()
        .filter_map(|&(a, b)| {
            let (a, b) = (a.checked_sub(base)?, b.checked_sub(base)?);
            Some([utf16_len(s.get(..a)?), utf16_len(s.get(..b)?)])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(_: &str, _: &str) -> bool {
        true
    }

    #[test]
    fn fold_strips_case_and_diacritics() {
        assert_eq!(
            fold("Ärger CAFÉ naïve Ångström ﬁ"),
            "arger cafe naive angstrom fi"
        );
        assert_eq!(words("Hello, wörld! x2"), ["hello", "world", "x2"]);
    }

    #[test]
    fn query_parsing() {
        assert_eq!(
            parse_query(r#"Foo "big Bär" baz"#),
            vec![
                Term::Prefix("foo".into()),
                Term::Phrase(vec!["big".into(), "bar".into()]),
                Term::Prefix("baz".into())
            ]
        );
    }

    #[test]
    fn snippet_and_ranges_are_utf16() {
        let mut ix = SearchIndex::new();
        ix.upsert("n", "d", "Tïtle", "😀 Grüße aus Köln");
        let hits = ix.search("koln", None, 10, &all);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "😀 Grüße aus Köln");
        // 😀 is two UTF-16 units.
        assert_eq!(hits[0].ranges, vec![[13, 17]]);
        let hits = ix.search("title", None, 10, &all);
        assert_eq!(hits[0].title_ranges, vec![[0, 5]]);
    }

    #[test]
    fn remove_and_reindex() {
        let mut ix = SearchIndex::new();
        ix.upsert("n", "d", "A", "apple");
        ix.upsert("n", "d", "A", "banana");
        assert!(ix.search("apple", None, 10, &all).is_empty());
        assert_eq!(ix.search("ban", None, 10, &all).len(), 1);
        ix.remove("n", "d");
        assert!(ix.search("ban", None, 10, &all).is_empty());
        assert!(ix.is_empty());
    }
}
