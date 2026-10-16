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
#[cfg(test)]
pub(crate) fn find_matches(
    text: &[char],
    pattern: &[char],
    match_case: bool,
    whole_word: bool,
) -> Vec<(usize, usize)> {
    find_matches_where(text, pattern, match_case, whole_word, |_, _| true)
}

/// One element of a compiled wildcard pattern.
#[derive(Debug, Clone, PartialEq)]
enum Atom {
    Char(char),
    Any,
    /// Character ranges; `true` = negated (`[!…]`).
    Set(Vec<(char, char)>, bool),
    WordStart,
    WordEnd,
}

/// An atom with its repetition (`max == usize::MAX` = unbounded; `lazy`
/// for `*`, which Word matches as short as possible).
#[derive(Debug, Clone, PartialEq)]
struct Item {
    atom: Atom,
    min: usize,
    max: usize,
    lazy: bool,
}

/// A Word wildcard pattern (Find › Use wildcards), compiled.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Wildcard {
    items: Vec<Item>,
}

/// Why a wildcard pattern is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PatternError(pub String);

impl Wildcard {
    /// Compiles `pattern`: `?`, `*`, `[abc]`, `[a-z]`, `[!…]`, `{n}`,
    /// `{n,}`, `{n,m}`, `@`, `<`, `>`, `\x`; `(` `)` are ignored (groups).
    pub(crate) fn compile(pattern: &str) -> Result<Self, PatternError> {
        let cs: Vec<char> = pattern.chars().collect();
        let mut items: Vec<Item> = Vec::new();
        let one = |atom| Item {
            atom,
            min: 1,
            max: 1,
            lazy: false,
        };
        let mut i = 0;
        while i < cs.len() {
            let c = cs[i];
            i += 1;
            match c {
                '?' => items.push(one(Atom::Any)),
                '*' => items.push(Item {
                    atom: Atom::Any,
                    min: 0,
                    max: usize::MAX,
                    lazy: true,
                }),
                '<' => items.push(one(Atom::WordStart)),
                '>' => items.push(one(Atom::WordEnd)),
                '(' | ')' => {}
                '\\' => {
                    let e = *cs
                        .get(i)
                        .ok_or_else(|| PatternError("pattern ends with \\".into()))?;
                    i += 1;
                    items.push(one(Atom::Char(e)));
                }
                '[' => {
                    let neg = cs.get(i) == Some(&'!');
                    if neg {
                        i += 1;
                    }
                    let mut ranges = Vec::new();
                    let mut closed = false;
                    while i < cs.len() {
                        let a = cs[i];
                        i += 1;
                        if a == ']' && !ranges.is_empty() {
                            closed = true;
                            break;
                        }
                        let a = if a == '\\' && i < cs.len() {
                            i += 1;
                            cs[i - 1]
                        } else {
                            a
                        };
                        if cs.get(i) == Some(&'-') && cs.get(i + 1).is_some_and(|&b| b != ']') {
                            let b = cs[i + 1];
                            i += 2;
                            if b < a {
                                return Err(PatternError(format!("bad range {a}-{b}")));
                            }
                            ranges.push((a, b));
                        } else {
                            ranges.push((a, a));
                        }
                    }
                    if !closed {
                        return Err(PatternError("missing ]".into()));
                    }
                    items.push(one(Atom::Set(ranges, neg)));
                }
                '{' => {
                    let end = cs[i..]
                        .iter()
                        .position(|&c| c == '}')
                        .ok_or_else(|| PatternError("missing }".into()))?;
                    let body: String = cs[i..i + end].iter().collect();
                    i += end + 1;
                    let last = items
                        .last_mut()
                        .filter(|it| it.min == 1 && it.max == 1)
                        .ok_or_else(|| PatternError("{} without an item before it".into()))?;
                    let num = |t: &str| {
                        t.trim()
                            .parse::<usize>()
                            .map_err(|_| PatternError(format!("bad count {{{body}}}")))
                    };
                    let (min, max) = match body.split_once(',') {
                        None => {
                            let n = num(&body)?;
                            (n, n)
                        }
                        Some((a, b)) if b.trim().is_empty() => (num(a)?, usize::MAX),
                        Some((a, b)) => (num(a)?, num(b)?),
                    };
                    if min > max {
                        return Err(PatternError(format!("bad count {{{body}}}")));
                    }
                    last.min = min;
                    last.max = max;
                }
                '@' => {
                    let last = items
                        .last_mut()
                        .filter(|it| it.min == 1 && it.max == 1)
                        .ok_or_else(|| PatternError("@ without an item before it".into()))?;
                    last.max = usize::MAX;
                }
                c => items.push(one(Atom::Char(c))),
            }
        }
        if items.is_empty() {
            return Err(PatternError("empty pattern".into()));
        }
        Ok(Wildcard { items })
    }

    /// Whether the atom accepts position `i` of `text` (zero-width atoms
    /// are handled by the matcher).
    fn accepts(atom: &Atom, c: char) -> bool {
        match atom {
            Atom::Char(x) => *x == c,
            Atom::Any => true,
            Atom::Set(ranges, neg) => ranges.iter().any(|&(a, b)| a <= c && c <= b) != *neg,
            Atom::WordStart | Atom::WordEnd => false,
        }
    }

    /// The end of a match of items `k..` starting at `i`, if any.
    fn match_from(&self, text: &[char], k: usize, i: usize, steps: &mut usize) -> Option<usize> {
        *steps += 1;
        if *steps > 200_000 {
            return None; // pathological pattern: give up
        }
        let Some(item) = self.items.get(k) else {
            return Some(i);
        };
        match item.atom {
            Atom::WordStart => {
                let ok = i < text.len()
                    && is_word_char(text[i])
                    && (i == 0 || !is_word_char(text[i - 1]));
                return if ok {
                    self.match_from(text, k + 1, i, steps)
                } else {
                    None
                };
            }
            Atom::WordEnd => {
                let ok = i > 0
                    && is_word_char(text[i - 1])
                    && (i == text.len() || !is_word_char(text[i]));
                return if ok {
                    self.match_from(text, k + 1, i, steps)
                } else {
                    None
                };
            }
            _ => {}
        }
        // How many chars this item can take from i.
        let mut avail = 0;
        while avail < item.max
            && i + avail < text.len()
            && Self::accepts(&item.atom, text[i + avail])
        {
            avail += 1;
        }
        if avail < item.min {
            return None;
        }
        if item.lazy {
            (item.min..=avail).find_map(|n| self.match_from(text, k + 1, i + n, steps))
        } else {
            (item.min..=avail)
                .rev()
                .find_map(|n| self.match_from(text, k + 1, i + n, steps))
        }
    }

    /// Non-overlapping, non-empty matches left to right; `accept` can
    /// reject a candidate (the search then goes on one position later).
    pub(crate) fn find(
        &self,
        text: &[char],
        mut accept: impl FnMut(usize, usize) -> bool,
    ) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let mut i = 0;
        let mut steps = 0;
        while i < text.len() {
            match self.match_from(text, 0, i, &mut steps) {
                Some(e) if e > i && accept(i, e) => {
                    out.push((i, e));
                    i = e;
                }
                _ => i += 1,
            }
        }
        out
    }
}

/// [`find_matches`] with a filter: candidates `accept` rejects are skipped
/// (the search goes on one position later).
pub(crate) fn find_matches_where(
    text: &[char],
    pattern: &[char],
    match_case: bool,
    whole_word: bool,
    mut accept: impl FnMut(usize, usize) -> bool,
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
                    && (i + n == text.len() || !is_word_char(text[i + n]))))
            && accept(i, i + n);
        if hit {
            out.push((i, i + n));
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

/// The maximal stretches of positions where `ok` holds (formatting-only
/// search).
pub(crate) fn stretches(len: usize, ok: impl Fn(usize) -> bool) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = None;
    for i in 0..=len {
        let good = i < len && ok(i);
        match (good, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                out.push((s, i));
                start = None;
            }
            _ => {}
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

    fn w(text: &str, pat: &str) -> Vec<String> {
        let t: Vec<char> = text.chars().collect();
        Wildcard::compile(pat)
            .unwrap()
            .find(&t, |_, _| true)
            .into_iter()
            .map(|(s, e)| t[s..e].iter().collect())
            .collect()
    }

    #[test]
    fn wildcard_any_and_star() {
        assert_eq!(w("cat cot cut", "c?t"), ["cat", "cot", "cut"]);
        // `*` is as short as possible
        assert_eq!(w("bad bed bid", "b*d"), ["bad", "bed", "bid"]);
        assert_eq!(w("abc", "a*"), ["a"]);
        assert_eq!(w("Cat cat", "cat"), ["cat"], "always case-sensitive");
    }

    #[test]
    fn wildcard_sets_ranges_and_negation() {
        assert_eq!(w("a1 b2 c3", "[a-b][0-9]"), ["a1", "b2"]);
        assert_eq!(w("sit set sat", "s[!a]t"), ["sit", "set"]);
        assert_eq!(w("x-y", "[\\-]"), ["-"]);
        assert_eq!(w("abc", "[ac]"), ["a", "c"]);
    }

    #[test]
    fn wildcard_counts_and_at() {
        assert_eq!(w("1 22 333 4444", "<[0-9]{3}>"), ["333"]);
        assert_eq!(w("1 22 333 4444", "<[0-9]{2,}>"), ["22", "333", "4444"]);
        assert_eq!(w("1 22 333 4444", "<[0-9]{1,2}>"), ["1", "22"]);
        assert_eq!(w("lo loo looo", "lo@"), ["lo", "loo", "looo"]);
    }

    #[test]
    fn wildcard_word_bounds_escape_and_groups() {
        assert_eq!(w("the other theme", "<the>"), ["the"]);
        assert_eq!(w("the other theme", "<the"), ["the", "the"]);
        assert_eq!(w("what? why?", "wh*\\?"), ["what?", "why?"]);
        assert_eq!(w("abab", "(ab)"), ["ab", "ab"]);
    }

    #[test]
    fn wildcard_errors() {
        for bad in ["[abc", "a{2", "{2}", "@", "a\\", "[z-a]", "a{3,1}", "()"] {
            assert!(Wildcard::compile(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn filtered_and_stretch_search() {
        let t: Vec<char> = "fox fox fox".chars().collect();
        let p: Vec<char> = "fox".chars().collect();
        // only the second one is "bold"
        assert_eq!(
            find_matches_where(&t, &p, true, false, |s, _| s == 4),
            [(4, 7)]
        );
        assert_eq!(stretches(6, |i| (2..5).contains(&i)), [(2, 5)]);
        assert_eq!(stretches(3, |_| true), [(0, 3)]);
        assert!(stretches(3, |_| false).is_empty());
    }
}
