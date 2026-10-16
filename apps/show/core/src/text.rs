//! Char-offset arithmetic on DrawingML paragraphs: positions count the
//! Unicode scalar values of the runs' text.

use core_model::RunProperties;
use model_show::{TextParagraph, TextRun};

/// Number of positions of a paragraph.
pub(crate) fn para_len(p: &TextParagraph) -> usize {
    p.runs.iter().map(|r| r.text.chars().count()).sum()
}

/// Makes `offset` a run boundary (splitting a run if needed) and returns
/// the index of the first run at or after it. `offset` must be at most the
/// paragraph length.
fn split_at(runs: &mut Vec<TextRun>, offset: usize) -> usize {
    let mut pos = 0;
    for i in 0..runs.len() {
        if pos == offset {
            return i;
        }
        let len = runs[i].text.chars().count();
        if offset < pos + len && runs[i].field.is_some() {
            // fields are atomic: the boundary moves to the field's start
            return i;
        }
        if offset < pos + len {
            let run = &mut runs[i];
            let byte = run
                .text
                .char_indices()
                .nth(offset - pos)
                .map_or(run.text.len(), |(b, _)| b);
            let tail = run.text.split_off(byte);
            let props = run.props.clone();
            let hyperlink = run.hyperlink.clone();
            runs.insert(
                i + 1,
                TextRun {
                    props,
                    text: tail,
                    field: None,
                    hyperlink,
                },
            );
            return i + 1;
        }
        pos += len;
    }
    runs.len()
}

/// Merges `patch` into the formatting of positions `from..to` (valid,
/// `from <= to <= len`), then merges neighbouring runs with equal
/// formatting and drops empty runs. An empty range changes nothing.
pub(crate) fn set_run_props(p: &mut TextParagraph, from: usize, to: usize, patch: &RunProperties) {
    if from >= to {
        return;
    }
    let start = split_at(&mut p.runs, from);
    let end = split_at(&mut p.runs, to);
    for run in &mut p.runs[start..end] {
        run.props.apply(patch);
    }
    merge_runs(&mut p.runs);
}

/// Sets (or removes) the hyperlink of positions `from..to` (valid,
/// `from <= to <= len`), like [`set_run_props`]; fields in the range get
/// it too.
pub(crate) fn set_run_link(
    p: &mut TextParagraph,
    from: usize,
    to: usize,
    link: Option<&model_show::Hyperlink>,
) {
    if from >= to {
        return;
    }
    let start = split_at(&mut p.runs, from);
    let end = split_at(&mut p.runs, to);
    for run in &mut p.runs[start..end] {
        run.hyperlink = link.cloned();
    }
    merge_runs(&mut p.runs);
}

/// Drops empty runs (when there is text) and joins neighbours with equal
/// formatting.
fn merge_runs(runs: &mut Vec<TextRun>) {
    if runs.iter().any(|r| !r.text.is_empty()) {
        runs.retain(|r| !r.text.is_empty() || r.field.is_some());
    }
    let mut out: Vec<TextRun> = Vec::with_capacity(runs.len());
    for run in runs.drain(..) {
        match out.last_mut() {
            Some(last)
                if last.props == run.props
                    && last.hyperlink == run.hyperlink
                    && !run.text.is_empty()
                    && last.field.is_none()
                    && run.field.is_none() =>
            {
                last.text.push_str(&run.text);
            }
            _ => out.push(run),
        }
    }
    *runs = out;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bold() -> RunProperties {
        RunProperties {
            bold: Some(true),
            ..Default::default()
        }
    }

    #[test]
    fn splits_at_scalar_offsets_and_merges() {
        let mut p = TextParagraph::plain("a😀bé");
        assert_eq!(para_len(&p), 4);
        set_run_props(&mut p, 1, 3, &bold());
        let texts: Vec<_> = p.runs.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts, ["a", "😀b", "é"]);
        assert_eq!(p.runs[1].props, bold());
        set_run_props(&mut p, 0, 4, &bold());
        assert_eq!(p.runs.len(), 1);
        assert_eq!(p.text(), "a😀bé");
        set_run_props(&mut p, 2, 2, &RunProperties::default());
        assert_eq!(p.runs.len(), 1);
    }

    #[test]
    fn fields_stay_whole() {
        let mut p = TextParagraph::plain("Slide ");
        p.runs
            .push(TextRun::field(model_show::TextField::SlideNumber, "12"));
        set_run_props(&mut p, 7, 8, &bold());
        // a range inside the field formats the whole field
        assert_eq!(p.runs.len(), 2);
        assert_eq!(p.runs[1].props, bold());
        set_run_props(&mut p, 0, 8, &bold());
        assert_eq!(p.runs.len(), 2, "a field never merges");
        assert!(p.runs[1].field.is_some() && p.runs[1].props == bold());
    }
}
