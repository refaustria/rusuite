//! Char-offset arithmetic on paragraph inlines (ADR 0007 §3): run text
//! counts in Unicode scalar values, images, breaks, fields, note
//! references and comment/bookmark markers count as one.

use std::collections::HashSet;

use model_text::{bookmark_marker_of, marker_of, Inline, Paragraph, Run, RunProperties};

/// A range marker's identity: comment or bookmark id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum MarkerKey {
    Comment(u32),
    Bookmark(u32),
}

/// The range marker of `inline` (comment or bookmark): key and whether it
/// is a start.
fn range_marker(inline: &Inline) -> Option<(MarkerKey, bool)> {
    marker_of(inline)
        .map(|(id, s)| (MarkerKey::Comment(id.0), s))
        .or_else(|| bookmark_marker_of(inline).map(|(id, s)| (MarkerKey::Bookmark(id.0), s)))
}

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
                let rest = run.with_text(tail);
                inlines.insert(i + 1, Inline::Run(rest));
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

/// [`replace_range`] that keeps the comment and bookmark markers of
/// `from..to` whose partner lies outside the range: ends go before `new`,
/// starts after it, so a partly deleted range shrinks to the text that is
/// left (a range deleted as a whole loses both markers). Returns the
/// removed inlines and the number of markers kept.
pub(crate) fn replace_keeping_markers(
    p: &mut Paragraph,
    from: usize,
    to: usize,
    new: Vec<Inline>,
) -> (Vec<Inline>, usize) {
    let doomed = slice(p, from, to);
    let ids = |start: bool| -> HashSet<MarkerKey> {
        doomed
            .iter()
            .filter_map(range_marker)
            .filter(|(_, s)| *s == start)
            .map(|(id, _)| id)
            .collect()
    };
    let (starts, ends) = (ids(true), ids(false));
    let mut kept_ends = Vec::new();
    let mut kept_starts = Vec::new();
    for i in &doomed {
        match range_marker(i) {
            Some((id, true)) if !ends.contains(&id) => kept_starts.push(i.clone()),
            Some((id, false)) if !starts.contains(&id) => kept_ends.push(i.clone()),
            _ => {}
        }
    }
    let kept = kept_ends.len() + kept_starts.len();
    let mut all = kept_ends;
    all.extend(new);
    all.extend(kept_starts);
    (replace_range(p, from, to, all), kept)
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
/// the formatting of typed text at `offset`. The hyperlink is inherited
/// only inside a link (the text after `offset` has the same link), never
/// at its end (Word).
pub(crate) fn inherited_run(p: &Paragraph, offset: usize) -> Run {
    let mut run = inherited_format(p, offset);
    if run.link.is_some() && run_at(p, offset).and_then(|r| r.link.as_ref()) != run.link.as_ref() {
        run.link = None;
        if run.style.as_deref() == Some("Hyperlink") {
            run.style = None;
        }
    }
    run
}

fn inherited_format(p: &Paragraph, offset: usize) -> Run {
    let template = |r: &Run| r.with_text("");
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

/// [`props_at`] with the character style and link (an empty run).
pub(crate) fn run_format_at(p: &Paragraph, offset: usize) -> Run {
    match run_at(p, offset) {
        Some(run) => run.with_text(""),
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
    fn partial_deletes_keep_lone_markers() {
        use model_text::CommentId;
        let s = |id| Inline::CommentStart { id: CommentId(id) };
        let e = |id| Inline::CommentEnd { id: CommentId(id) };
        let mut p = Paragraph::new(NodeId(1));
        p.inlines = vec![
            Inline::Run(Run::new("ab")),
            s(1),
            Inline::Run(Run::new("cd")),
            s(2),
            Inline::Run(Run::new("e")),
            e(2),
            Inline::Run(Run::new("f")),
            e(1),
        ];
        // "b[1" deleted: start 1 stays; "cd [2 e 2] f" deleted: 2 goes, end 1 stays.
        let (removed, kept) =
            replace_keeping_markers(&mut p, 1, 3, vec![Inline::Run(Run::new("X"))]);
        assert_eq!(kept, 1);
        assert_eq!(removed.len(), 2);
        assert_eq!(p.text(), "aX\u{FEFF}cd\u{FEFF}e\u{FEFF}f\u{FEFF}");
        let (_, kept) = replace_keeping_markers(&mut p, 3, 9, vec![]);
        assert_eq!(kept, 0);
        assert_eq!(p.text(), "aX\u{FEFF}\u{FEFF}");
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
