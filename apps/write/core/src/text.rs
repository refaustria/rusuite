//! Char-offset arithmetic on paragraph inlines (ADR 0007 §3): run text
//! counts in Unicode scalar values, images, breaks, fields and note
//! references count as one.

use model_text::{Inline, Paragraph, Run, RunProperties};

/// Number of positions of one inline.
pub(crate) fn inline_len(inline: &Inline) -> usize {
    match inline {
        Inline::Run(run) => run.text.chars().count(),
        _ => 1,
    }
}

/// Number of positions of a list of inlines.
pub(crate) fn inlines_len(inlines: &[Inline]) -> usize {
    inlines.iter().map(inline_len).sum()
}

/// Makes `offset` an inline boundary (splitting a run if needed) and
/// returns the index of the first inline at or after it. `offset` must be
/// at most the total length.
fn split_at(inlines: &mut Vec<Inline>, offset: usize) -> usize {
    let mut pos = 0;
    for i in 0..inlines.len() {
        if pos == offset {
            return i;
        }
        let len = inline_len(&inlines[i]);
        if offset < pos + len {
            // Strictly inside: only runs are longer than one position.
            if let Inline::Run(run) = &mut inlines[i] {
                let byte = run
                    .text
                    .char_indices()
                    .nth(offset - pos)
                    .map_or(run.text.len(), |(b, _)| b);
                let tail = run.text.split_off(byte);
                let props = run.props.clone();
                let style = run.style.clone();
                inlines.insert(i + 1, Inline::Run(Run::styled(tail, style, props)));
            }
            return i + 1;
        }
        pos += len;
    }
    inlines.len()
}

/// Replaces positions `from..to` of `p` by `new` and returns the removed
/// inlines. Offsets must be valid (`from <= to <= p.len()`).
pub(crate) fn replace_range(
    p: &mut Paragraph,
    from: usize,
    to: usize,
    new: Vec<Inline>,
) -> Vec<Inline> {
    let start = split_at(&mut p.inlines, from);
    let end = split_at(&mut p.inlines, to);
    p.inlines.splice(start..end, new).collect()
}

/// A copy of positions `from..to` of `p`.
pub(crate) fn slice(p: &Paragraph, from: usize, to: usize) -> Vec<Inline> {
    let mut inlines = p.inlines.clone();
    let start = split_at(&mut inlines, from);
    let end = split_at(&mut inlines, to);
    inlines.drain(start..end).collect()
}

/// Calls `f` on the formatting of every run in `from..to` (splitting runs
/// at the boundaries).
pub(crate) fn for_each_run_in(
    p: &mut Paragraph,
    from: usize,
    to: usize,
    mut f: impl FnMut(&mut RunProperties),
) {
    let start = split_at(&mut p.inlines, from);
    let end = split_at(&mut p.inlines, to);
    for inline in &mut p.inlines[start..end] {
        if let Inline::Run(run) = inline {
            f(&mut run.props);
        }
    }
}

/// Calls `f` on every run in `from..to` (splitting runs at the
/// boundaries).
pub(crate) fn for_each_run_mut_in(
    p: &mut Paragraph,
    from: usize,
    to: usize,
    mut f: impl FnMut(&mut Run),
) {
    let start = split_at(&mut p.inlines, from);
    let end = split_at(&mut p.inlines, to);
    for inline in &mut p.inlines[start..end] {
        if let Inline::Run(run) = inline {
            f(run);
        }
    }
}

/// The run at position `offset` (the inline covering `offset..offset+1`),
/// if it is a run.
fn run_at(p: &Paragraph, offset: usize) -> Option<&Run> {
    let mut pos = 0;
    for inline in &p.inlines {
        let len = inline_len(inline);
        if offset < pos + len {
            return inline.as_run();
        }
        pos += len;
    }
    None
}

/// Formatting for text typed at `offset`: the run containing the
/// character before `offset` (the nearest run before it if that is an
/// image or break), else the first run, else none.
pub(crate) fn inherited_props(p: &Paragraph, offset: usize) -> RunProperties {
    inherited_run(p, offset).props
}

/// [`inherited_props`] with the character style: an empty run carrying
/// the formatting of typed text at `offset`.
pub(crate) fn inherited_run(p: &Paragraph, offset: usize) -> Run {
    let template = |r: &Run| Run::styled("", r.style.clone(), r.props.clone());
    if offset > 0 {
        let mut pos = 0;
        let mut last_run: Option<&Run> = None;
        for inline in &p.inlines {
            if pos >= offset {
                break;
            }
            if let Inline::Run(run) = inline {
                if !run.text.is_empty() {
                    last_run = Some(run);
                }
            }
            pos += inline_len(inline);
        }
        if let Some(run) = last_run {
            return template(run);
        }
    }
    p.inlines
        .iter()
        .find_map(Inline::as_run)
        .map(template)
        .unwrap_or_default()
}

/// Formatting of the character at `offset` (for replacements): the run
/// there, or [`inherited_props`] when it is an image or break.
#[cfg(test)]
pub(crate) fn props_at(p: &Paragraph, offset: usize) -> RunProperties {
    run_format_at(p, offset).props
}

/// [`props_at`] with the character style (an empty run).
pub(crate) fn run_format_at(p: &Paragraph, offset: usize) -> Run {
    match run_at(p, offset) {
        Some(run) => Run::styled("", run.style.clone(), run.props.clone()),
        None => inherited_run(p, offset),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_text::{BreakKind, NodeId};

    fn bold() -> RunProperties {
        RunProperties {
            bold: Some(true),
            ..Default::default()
        }
    }

    fn para() -> Paragraph {
        let mut p = Paragraph::new(NodeId(1));
        p.inlines = vec![
            Inline::Run(Run::new("aé")),
            Inline::Break(BreakKind::Line),
            Inline::Run(Run::with_props("😀b", bold())),
        ];
        p
    }

    #[test]
    fn lengths_count_scalars_and_atoms() {
        let p = para();
        assert_eq!(inlines_len(&p.inlines), 5);
        assert_eq!(p.len(), 5);
    }

    #[test]
    fn split_inside_multibyte_runs() {
        let mut p = para();
        let removed = replace_range(&mut p, 1, 4, vec![]);
        assert_eq!(
            removed,
            vec![
                Inline::Run(Run::new("é")),
                Inline::Break(BreakKind::Line),
                Inline::Run(Run::with_props("😀", bold())),
            ]
        );
        assert_eq!(p.text(), "ab");
        assert_eq!(
            slice(&para(), 3, 5),
            vec![Inline::Run(Run::with_props("😀b", bold()))]
        );
    }

    #[test]
    fn inheritance() {
        let p = para();
        assert_eq!(inherited_props(&p, 0), RunProperties::default());
        assert_eq!(inherited_props(&p, 3), RunProperties::default()); // after the break
        assert_eq!(inherited_props(&p, 4), bold());
        assert_eq!(props_at(&p, 2), RunProperties::default());
        assert_eq!(props_at(&p, 3), bold());
    }
}
