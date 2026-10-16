//! Tables of contents: recognising the `TOC` field (in a "Table of
//! Contents" `w:sdt` or bare in the body) and its cached entries.

use crate::xml::{El, Node};

/// What [`scan`] found.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct TocScan {
    /// Text of the paragraphs before the field (the title), if any.
    pub title: Option<String>,
    /// Outline levels from the `\o "a-b"` switch (default 1–3).
    pub levels: (u8, u8),
    /// The sequence of a table of figures (`\c "Figure"`).
    pub caption: Option<String>,
    /// Cached entries: text and page number (the text after the last tab,
    /// if it is a number).
    pub lines: Vec<(String, Option<u32>)>,
    /// Number of paragraphs that belong to the TOC (title included).
    pub consumed: usize,
}

/// Whether `sdt` is a "Table of Contents" content control.
pub(crate) fn is_toc_sdt(sdt: &El) -> bool {
    sdt.child("sdtPr")
        .and_then(|p| p.find("docPartGallery"))
        .and_then(El::val)
        .is_some_and(|v| v == "Table of Contents")
}

/// Whether the field instruction is a `TOC` field.
fn is_toc_instr(instr: &str) -> bool {
    instr
        .split_whitespace()
        .next()
        .is_some_and(|w| w.eq_ignore_ascii_case("TOC"))
}

/// The caption sequence of a `TOC` instruction (`\c "Figure"`, also
/// `\c Figure`): a table of figures.
pub(crate) fn toc_caption(instr: &str) -> Option<String> {
    let at = instr.find("\\c")?;
    let rest = instr[at + 2..].trim_start();
    let name = match rest.strip_prefix('"') {
        Some(q) => &q[..q.find('"')?],
        None => rest.split_whitespace().next()?,
    };
    (!name.is_empty() && !name.starts_with('\\')).then(|| name.to_owned())
}

/// The outline levels of a `TOC` instruction (`\o "1-3"`).
pub(crate) fn toc_levels(instr: &str) -> (u8, u8) {
    let parse = || -> Option<(u8, u8)> {
        let at = instr.find("\\o")?;
        let rest = instr[at + 2..].trim_start().strip_prefix('"')?;
        let range = &rest[..rest.find('"')?];
        let (a, b) = range.split_once('-')?;
        let a: u8 = a.trim().parse().ok()?;
        let b: u8 = b.trim().parse().ok()?;
        (1..=9).contains(&a).then_some((a, b.clamp(a, 9)))
    };
    parse().unwrap_or((1, 3))
}

#[derive(Debug)]
struct Frame {
    instr: String,
    in_instr: bool,
    toc: bool,
}

#[derive(Debug, Default)]
struct Scanner {
    stack: Vec<Frame>,
    instr: Option<String>,
    started: bool,
    finished: bool,
    text: String,
    before: String,
}

impl Scanner {
    fn visible(&self) -> bool {
        self.stack.iter().all(|f| !f.in_instr)
    }

    fn push_text(&mut self, s: &str) {
        if !self.visible() || self.finished {
            return;
        }
        if self.started {
            self.text.push_str(s);
        } else {
            self.before.push_str(s);
        }
    }

    fn content(&mut self, parent: &El) {
        for el in parent.elements() {
            match el.name.as_str() {
                "r" => self.run(el),
                "hyperlink" | "smartTag" | "customXml" | "ins" | "dir" | "bdo" | "fldSimple" => {
                    self.content(el)
                }
                "sdt" => {
                    if let Some(c) = el.child("sdtContent") {
                        self.content(c);
                    }
                }
                _ => {}
            }
        }
    }

    fn run(&mut self, r: &El) {
        for el in r.elements() {
            match el.name.as_str() {
                "fldChar" => match el.attr("fldCharType") {
                    Some("begin") => self.stack.push(Frame {
                        instr: String::new(),
                        in_instr: true,
                        toc: false,
                    }),
                    Some("separate") => {
                        let outermost = self.stack.len() == 1;
                        if let Some(top) = self.stack.last_mut() {
                            top.in_instr = false;
                            if outermost && !self.started && is_toc_instr(&top.instr) {
                                top.toc = true;
                                self.started = true;
                                self.instr = Some(top.instr.clone());
                            }
                        }
                    }
                    Some("end") => {
                        if let Some(f) = self.stack.pop() {
                            let empty_toc = f.in_instr
                                && self.stack.is_empty()
                                && !self.started
                                && is_toc_instr(&f.instr);
                            if empty_toc {
                                self.started = true;
                                self.instr = Some(f.instr);
                            }
                            if f.toc || empty_toc {
                                self.finished = true;
                            }
                        }
                    }
                    _ => {}
                },
                "instrText" => {
                    if let Some(top) = self.stack.last_mut().filter(|f| f.in_instr) {
                        top.instr.push_str(&el.text());
                    }
                }
                "t" => {
                    let mut s = String::new();
                    for n in &el.children {
                        if let Node::Text(t) = n {
                            s.push_str(t);
                        }
                    }
                    self.push_text(&s);
                }
                "tab" | "ptab" => self.push_text("\t"),
                _ => {}
            }
        }
    }
}

/// Whether paragraph `p` starts a `TOC` field.
pub(crate) fn starts_toc(p: &El) -> bool {
    let mut s = Scanner::default();
    s.content(p);
    s.started
}

/// One cached entry line → text and page.
fn entry(line: &str) -> Option<(String, Option<u32>)> {
    let (text, page) = match line.rsplit_once('\t') {
        Some((t, p)) => match p.trim().parse::<u32>() {
            Ok(n) => (t, Some(n)),
            Err(_) => (line, None),
        },
        None => (line, None),
    };
    let text = text.replace('\t', " ").trim().to_owned();
    (!text.is_empty()).then_some((text, page))
}

/// Scans `paras` for a `TOC` field: paragraphs before it are the title
/// (only if `title_allowed`), each paragraph of its result one entry.
/// `None` if no TOC field starts, or (without `title_allowed`, i.e. a bare
/// field in the body) if it does not end.
pub(crate) fn scan(paras: &[&El], title_allowed: bool) -> Option<TocScan> {
    let mut s = Scanner::default();
    let mut out = TocScan::default();
    let mut title = Vec::new();
    for (i, p) in paras.iter().enumerate() {
        let was_started = s.started;
        s.text.clear();
        s.before.clear();
        s.content(p);
        if !s.started {
            if !title_allowed {
                return None;
            }
            let t = s.before.trim();
            if !t.is_empty() {
                title.push(t.to_owned());
            }
            continue;
        }
        if !was_started && !s.before.trim().is_empty() && title_allowed {
            title.push(s.before.trim().to_owned());
        }
        if let Some(e) = entry(&s.text) {
            out.lines.push(e);
        }
        if s.finished {
            out.consumed = i + 1;
            break;
        }
    }
    if !s.started || (!s.finished && !title_allowed) {
        return None;
    }
    if !s.finished {
        out.consumed = paras.len();
    }
    out.levels = toc_levels(s.instr.as_deref().unwrap_or(""));
    out.caption = toc_caption(s.instr.as_deref().unwrap_or(""));
    out.title = (!title.is_empty()).then(|| title.join(" "));
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    fn paras(xml: &str) -> El {
        parse(
            format!(r#"<w:body xmlns:w="w">{xml}</w:body>"#).as_bytes(),
            "d",
        )
        .unwrap()
    }

    #[test]
    fn levels() {
        assert_eq!(toc_levels(r#" TOC \o "1-3" \h \z \u "#), (1, 3));
        assert_eq!(toc_levels(r#"TOC \f \o "2-4" \h"#), (2, 4));
        assert_eq!(toc_levels(r#"TOC \h"#), (1, 3));
        assert_eq!(toc_levels(r#"TOC \o "5-2""#), (5, 5));
        assert_eq!(
            toc_caption(r#" TOC \h \z \c "Figure" "#).as_deref(),
            Some("Figure")
        );
        assert_eq!(toc_caption(r#"TOC \c Table \h"#).as_deref(), Some("Table"));
        assert_eq!(toc_caption(r#"TOC \o "1-3""#), None);
    }

    #[test]
    fn word_style_toc_with_pagerefs() {
        let body = paras(
            r#"<w:p><w:r><w:t>Contents</w:t></w:r></w:p>
            <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \o "1-2" \h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>
              <w:hyperlink w:anchor="_Toc1"><w:r><w:t>Intro</w:t></w:r><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGEREF _Toc1 \h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>
            <w:p><w:hyperlink w:anchor="_Toc2"><w:r><w:t>Next	part</w:t></w:r></w:hyperlink><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
            <w:p><w:r><w:t>After</w:t></w:r></w:p>"#,
        );
        let ps: Vec<&El> = body.elements().collect();
        assert!(!starts_toc(ps[0]) && starts_toc(ps[1]));
        let s = scan(&ps, true).unwrap();
        assert_eq!(s.title.as_deref(), Some("Contents"));
        assert_eq!(s.levels, (1, 2));
        assert_eq!(
            s.lines,
            vec![
                ("Intro".to_owned(), Some(3)),
                ("Next part".to_owned(), None)
            ]
        );
        assert_eq!(s.consumed, 3);
        // bare in the body: no title allowed
        assert!(scan(&ps, false).is_none());
        assert_eq!(scan(&ps[1..], false).unwrap().consumed, 2);
        // unterminated bare field
        assert!(scan(&ps[1..2], false).is_none());
    }

    #[test]
    fn empty_toc_field() {
        let body = paras(
            r#"<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \o "1-1"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#,
        );
        let ps: Vec<&El> = body.elements().collect();
        let s = scan(&ps, false).unwrap();
        assert_eq!((s.levels, s.lines.len(), s.consumed), ((1, 1), 0, 1));
    }
}
