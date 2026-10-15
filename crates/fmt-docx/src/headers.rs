//! Default page headers and footers as plain text
//! ([`model_text::PageSetup::header_text`]): `w:hdr`/`w:ftr` parts →
//! paragraphs joined by `\n`, the `PAGE` field as [`PAGE_FIELD`]; and back.

use model_text::PAGE_FIELD;

use crate::numbering::W_NS;
use crate::xml::{El, Node, XmlOut};
use crate::Warnings;

/// Content type of a header part.
pub(crate) const CT_HEADER: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
/// Content type of a footer part.
pub(crate) const CT_FOOTER: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";

/// Whether a field instruction (`PAGE \* MERGEFORMAT`) is the page number.
fn is_page_field(instr: &str) -> bool {
    instr.split_whitespace().next() == Some("PAGE")
}

/// Field state of one paragraph (complex fields: `fldChar`/`instrText`).
#[derive(Default)]
struct Fields {
    /// Inside `begin … separate`: collecting the instruction.
    instr: Option<String>,
    /// Inside `separate … end` of a PAGE field: the cached result is skipped.
    skip_result: bool,
}

/// Plain text of a header/footer root (`w:hdr`, `w:ftr`). `what` names the
/// part in warnings ("header", "footer").
pub(crate) fn read_text(root: &El, what: &str, w: &mut Warnings) -> String {
    let mut paras = Vec::new();
    collect_paragraphs(root, what, w, &mut paras);
    // Trailing empty paragraphs carry no text (Word always writes one).
    while paras.last().is_some_and(String::is_empty) && paras.len() > 1 {
        paras.pop();
    }
    paras.join("\n")
}

fn collect_paragraphs(parent: &El, what: &str, w: &mut Warnings, out: &mut Vec<String>) {
    for el in parent.elements() {
        match el.name.as_str() {
            "p" => {
                let mut text = String::new();
                let mut fields = Fields::default();
                content(el, what, w, &mut fields, &mut text);
                out.push(text);
            }
            "tbl" => {
                w.add(format!("{what}: table read as plain text"));
                for row in el.elements().filter(|r| r.name == "tr") {
                    for cell in row.elements().filter(|c| c.name == "tc") {
                        collect_paragraphs(cell, what, w, out);
                    }
                }
            }
            "sdt" => {
                if let Some(c) = el.child("sdtContent") {
                    collect_paragraphs(c, what, w, out);
                }
            }
            "customXml" | "ins" => collect_paragraphs(el, what, w, out),
            _ => {}
        }
    }
}

fn content(parent: &El, what: &str, w: &mut Warnings, f: &mut Fields, text: &mut String) {
    for el in parent.elements() {
        match el.name.as_str() {
            "r" => run(el, what, w, f, text),
            "fldSimple" => {
                if el.attr("instr").is_some_and(is_page_field) {
                    text.push_str(PAGE_FIELD);
                } else {
                    content(el, what, w, f, text);
                }
            }
            "hyperlink" | "smartTag" | "customXml" | "ins" | "dir" | "bdo" => {
                content(el, what, w, f, text)
            }
            "sdt" => {
                if let Some(c) = el.child("sdtContent") {
                    content(c, what, w, f, text);
                }
            }
            _ => {}
        }
    }
}

fn run(r: &El, what: &str, w: &mut Warnings, f: &mut Fields, text: &mut String) {
    for el in r.elements() {
        match el.name.as_str() {
            "fldChar" => match el.attr("fldCharType") {
                Some("begin") => f.instr = Some(String::new()),
                Some("separate") => {
                    let instr = f.instr.take().unwrap_or_default();
                    if is_page_field(&instr) {
                        text.push_str(PAGE_FIELD);
                        f.skip_result = true;
                    }
                }
                Some("end") => {
                    // A field without a result part (begin … end).
                    if let Some(instr) = f.instr.take() {
                        if is_page_field(&instr) {
                            text.push_str(PAGE_FIELD);
                        }
                    }
                    f.skip_result = false;
                }
                _ => {}
            },
            "instrText" => {
                if let Some(instr) = &mut f.instr {
                    for n in &el.children {
                        if let Node::Text(t) = n {
                            instr.push_str(t);
                        }
                    }
                }
            }
            _ if f.instr.is_some() || f.skip_result => {}
            "t" => {
                for n in &el.children {
                    if let Node::Text(t) = n {
                        text.push_str(t);
                    }
                }
            }
            "tab" | "ptab" => text.push('\t'),
            "br" | "cr" => text.push(' '),
            "drawing" | "pict" | "object" => {
                w.add(format!("{what}: pictures and drawings dropped"));
            }
            _ => {}
        }
    }
}

/// A `w:hdr` (`footer == false`) or `w:ftr` part holding `text`: one
/// paragraph per line (style `Header`/`Footer` when the document has it),
/// [`PAGE_FIELD`] written as a `PAGE` field.
pub(crate) fn write_part(text: &str, footer: bool, style: Option<&str>) -> Vec<u8> {
    let root = if footer { "w:ftr" } else { "w:hdr" };
    let mut x = XmlOut::new();
    x.start(root, &[("xmlns:w", W_NS)]);
    for line in text.split('\n') {
        x.start("w:p", &[]);
        if let Some(style) = style {
            x.start("w:pPr", &[]);
            x.val("w:pStyle", style);
            x.end("w:pPr");
        }
        let mut first = true;
        for piece in line.split(PAGE_FIELD) {
            if !first {
                page_field(&mut x);
            }
            first = false;
            text_run(&mut x, piece);
        }
        x.end("w:p");
    }
    x.end(root);
    x.finish()
}

fn text_run(x: &mut XmlOut, s: &str) {
    if s.is_empty() {
        return;
    }
    x.start("w:r", &[]);
    for (i, seg) in s.split('\t').enumerate() {
        if i > 0 {
            x.empty("w:tab", &[]);
        }
        if !seg.is_empty() {
            let preserve =
                seg.starts_with(char::is_whitespace) || seg.ends_with(char::is_whitespace);
            let attrs: &[(&str, &str)] = if preserve {
                &[("xml:space", "preserve")]
            } else {
                &[]
            };
            x.text_el("w:t", attrs, seg);
        }
    }
    x.end("w:r");
}

/// `PAGE` as a complex field with a cached result of `1` (Word updates it).
fn page_field(x: &mut XmlOut) {
    x.start("w:r", &[]);
    x.empty("w:fldChar", &[("w:fldCharType", "begin")]);
    x.end("w:r");
    x.start("w:r", &[]);
    x.text_el("w:instrText", &[("xml:space", "preserve")], " PAGE ");
    x.end("w:r");
    x.start("w:r", &[]);
    x.empty("w:fldChar", &[("w:fldCharType", "separate")]);
    x.end("w:r");
    x.start("w:r", &[]);
    x.text_el("w:t", &[], "1");
    x.end("w:r");
    x.start("w:r", &[]);
    x.empty("w:fldChar", &[("w:fldCharType", "end")]);
    x.end("w:r");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    fn read(xml: &str) -> (String, Vec<String>) {
        let mut w = Warnings::default();
        let root = parse(xml.as_bytes(), "/word/header1.xml").unwrap();
        let t = read_text(&root, "header", &mut w);
        (t, w.into_vec())
    }

    const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;

    #[test]
    fn simple_and_complex_page_fields() {
        let xml = format!(
            r#"<w:hdr {NS}><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE \* MERGEFORMAT"><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>
            <w:p><w:r><w:t>Line 2 </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:tab/><w:t>x</w:t></w:r></w:p><w:p/></w:hdr>"#
        );
        let (t, w) = read(&xml);
        assert_eq!(t, "Page {PAGE}\nLine 2 {PAGE}\tx");
        assert!(w.is_empty());
    }

    #[test]
    fn other_fields_keep_their_result() {
        let xml = format!(
            r#"<w:ftr {NS}><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>NUMPAGES</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:drawing/></w:r></w:p></w:ftr>"#
        );
        let (t, w) = read(&xml);
        assert_eq!(t, "9");
        assert_eq!(w, vec!["header: pictures and drawings dropped".to_owned()]);
    }

    #[test]
    fn write_then_read() {
        let bytes = write_part("Report\t{PAGE} of the year\n", true, Some("Footer"));
        let s = String::from_utf8(bytes.clone()).unwrap();
        assert!(s.contains("<w:ftr"));
        assert!(s.contains(r#"<w:pStyle w:val="Footer"/>"#));
        assert!(s.contains("PAGE"));
        let root = parse(&bytes, "/word/footer1.xml").unwrap();
        let mut w = Warnings::default();
        assert_eq!(
            read_text(&root, "footer", &mut w),
            "Report\t{PAGE} of the year"
        );
    }
}
