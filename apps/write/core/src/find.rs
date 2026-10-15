//! Text matching for find/replace (char offsets, see [`crate::command`]).

/// Simple case folding of one char (multi-char lowercase mappings such
/// as `İ` keep the original char).
fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Non-overlapping matches of `pattern` in `text`, left to right, as
/// `(start, end)` char offsets. `whole_word` requires a non-word char (or
/// the text boundary) on both sides. An empty pattern never matches.
pub(crate) fn find_matches(
    text: &[char],
    pattern: &[char],
    match_case: bool,
    whole_word: bool,
) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let n = pattern.len();
    if n == 0 || n > text.len() {
        return out;
    }
    let eq = |a: char, b: char| {
        if match_case {
            a == b
        } else {
            a == b || fold(a) == fold(b)
        }
    };
    let mut i = 0;
    while i + n <= text.len() {
        let hit = text[i..i + n].iter().zip(pattern).all(|(&a, &b)| eq(a, b))
            && (!whole_word
                || ((i == 0 || !is_word_char(text[i - 1]))
                    && (i + n == text.len() || !is_word_char(text[i + n]))));
        if hit {
            out.push((i, i + n));
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(text: &str, pat: &str, case: bool, word: bool) -> Vec<(usize, usize)> {
        let t: Vec<char> = text.chars().collect();
        let p: Vec<char> = pat.chars().collect();
        find_matches(&t, &p, case, word)
    }

    #[test]
    fn matching_rules() {
        assert_eq!(
            m("Cat cat CAT", "cat", false, false),
            [(0, 3), (4, 7), (8, 11)]
        );
        assert_eq!(m("Cat cat CAT", "cat", true, false), [(4, 7)]);
        assert_eq!(
            m("cat concat cats cat_ cat", "cat", true, true),
            [(0, 3), (21, 24)]
        );
        assert_eq!(m("aaaa", "aa", true, false), [(0, 2), (2, 4)]);
        assert_eq!(m("Élan élan", "ÉLAN", false, true), [(0, 4), (5, 9)]);
        assert!(m("abc", "", false, false).is_empty());
        assert!(m("ab", "abc", false, false).is_empty());
    }
}
