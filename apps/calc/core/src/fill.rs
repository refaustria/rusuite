//! Pure helpers of the clipboard and fill-handle commands: formula
//! shifting and the per-line series logic of
//! [`FillRange`](crate::CalcCommand::FillRange).

use engine_formula::{adjust_references_for_move, offset_relative, MoveContext, Value};

use crate::command::FillMode;

/// Shifts the relative references of a formula input (`=…`) by
/// `(d_row, d_col)`, as Excel's copy/paste and fill do. Other inputs,
/// a zero offset and unparsable formulas are returned unchanged.
pub fn shift_input(input: &str, d_row: i64, d_col: i64) -> String {
    if !input.starts_with('=') || (d_row == 0 && d_col == 0) {
        return input.to_owned();
    }
    match engine_formula::parse(input) {
        Ok(ast) => format!("={}", offset_relative(&ast, d_row, d_col)),
        Err(_) => input.to_owned(),
    }
}

/// Rewrites a formula input (`=…`) for a cut-and-paste move (see
/// [`adjust_references_for_move`]); `None` when it is not a formula, does
/// not parse or does not reference the moved cells.
pub fn move_input(input: &str, ctx: &MoveContext) -> Option<String> {
    if !input.starts_with('=') {
        return None;
    }
    let ast = engine_formula::parse(input).ok()?;
    let moved = adjust_references_for_move(&ast, ctx);
    (moved != ast).then(|| format!("={moved}"))
}

/// One source cell of a fill line, as the series logic sees it.
#[derive(Debug, Clone, PartialEq)]
pub enum FillItem {
    /// A number constant; `date` when its number format is a date/time.
    Number { n: f64, date: bool },
    /// A text constant.
    Text(String),
    /// Anything else (formula, boolean, error, blank): repeated.
    Other,
}

/// What a fill line produces at position `k` (0 = first source cell;
/// negative before it, for fills up or left).
#[derive(Debug, Clone, PartialEq)]
pub enum FillPlan {
    /// Repeat the source pattern (formulas shifted by their distance).
    Copy,
    /// `a + b·k`.
    Linear { a: f64, b: f64 },
    /// `prefix` followed by `|a + b·k|`, zero-padded to `width` digits.
    TextNumber {
        prefix: String,
        width: usize,
        a: f64,
        b: f64,
    },
}

impl FillPlan {
    /// The generated value at `k`, or `None` for [`FillPlan::Copy`].
    pub fn value_at(&self, k: i64) -> Option<Value> {
        match self {
            FillPlan::Copy => None,
            FillPlan::Linear { a, b } => Some(Value::Number(round15(a + b * k as f64))),
            FillPlan::TextNumber {
                prefix,
                width,
                a,
                b,
            } => {
                let n = round15(a + b * k as f64).abs();
                Some(Value::Text(format!(
                    "{prefix}{:0width$}",
                    n as u64,
                    width = *width
                )))
            }
        }
    }
}

/// Rounds to 15 significant digits (hides binary noise such as
/// `0.30000000000000004`, as Excel's display does).
fn round15(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    format!("{x:.14e}").parse().unwrap_or(x)
}

/// `"Item 12"` → `("Item ", 12, 2)`: the text before a trailing run of
/// ASCII digits, the number and the digit count. `None` without
/// trailing digits or with nothing before them (a pure number is not
/// text-with-number).
fn split_trailing_number(t: &str) -> Option<(&str, u64, usize)> {
    let digits = t.bytes().rev().take_while(u8::is_ascii_digit).count();
    if digits == 0 || digits == t.len() || digits > 15 {
        return None;
    }
    let (prefix, num) = t.split_at(t.len() - digits);
    Some((prefix, num.parse().ok()?, digits))
}

/// Least-squares line through `(i, ys[i])`: `(a, b)` of `a + b·i`
/// (Excel's linear trend for AutoFill).
fn best_fit(ys: &[f64]) -> (f64, f64) {
    let n = ys.len() as f64;
    let mx = (n - 1.0) / 2.0;
    let my = ys.iter().sum::<f64>() / n;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for (i, y) in ys.iter().enumerate() {
        let dx = i as f64 - mx;
        sxy += dx * (y - my);
        sxx += dx * dx;
    }
    let b = if sxx == 0.0 { 0.0 } else { sxy / sxx };
    (my - b * mx, b)
}

/// Decides how one line of a fill continues (see [`FillMode`]).
pub fn plan(items: &[FillItem], mode: FillMode) -> FillPlan {
    if items.is_empty() || mode == FillMode::Copy {
        return FillPlan::Copy;
    }
    let single = items.len() == 1;
    // Whether the series (rather than the copy) is wanted.
    let series = |auto_series: bool| match mode {
        FillMode::Auto => auto_series,
        FillMode::Alternate => !auto_series,
        FillMode::Series => true,
        FillMode::Copy => false,
    };
    let numbers: Option<Vec<(f64, bool)>> = items
        .iter()
        .map(|it| match it {
            FillItem::Number { n, date } => Some((*n, *date)),
            _ => None,
        })
        .collect();
    if let Some(nums) = numbers {
        // One plain number is copied; one date steps by a day.
        let auto_series = !single || nums[0].1;
        if !series(auto_series) {
            return FillPlan::Copy;
        }
        if single {
            return FillPlan::Linear {
                a: nums[0].0,
                b: 1.0,
            };
        }
        let ys: Vec<f64> = nums.iter().map(|x| x.0).collect();
        let (a, b) = best_fit(&ys);
        return FillPlan::Linear { a, b };
    }
    let texts: Option<Vec<(&str, u64, usize)>> = items
        .iter()
        .map(|it| match it {
            FillItem::Text(t) => split_trailing_number(t),
            _ => None,
        })
        .collect();
    if let Some(texts) = texts {
        let prefix = texts[0].0;
        if texts.iter().all(|t| t.0 == prefix) && series(true) {
            let width = texts.iter().map(|t| t.2).min().unwrap_or(1);
            // Zero padding only when the source is padded ("Item01").
            let padded = texts
                .iter()
                .any(|t| t.2 > 1 && t.1 < 10u64.pow(t.2 as u32 - 1));
            let ys: Vec<f64> = texts.iter().map(|t| t.1 as f64).collect();
            let (a, b) = if single { (ys[0], 1.0) } else { best_fit(&ys) };
            if b.fract() == 0.0 && a.fract() == 0.0 {
                return FillPlan::TextNumber {
                    prefix: prefix.to_owned(),
                    width: if padded { width } else { 1 },
                    a,
                    b,
                };
            }
        }
    }
    FillPlan::Copy
}

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> FillItem {
        FillItem::Number { n, date: false }
    }

    fn values(p: &FillPlan, ks: std::ops::Range<i64>) -> Vec<Value> {
        ks.map(|k| p.value_at(k).unwrap()).collect()
    }

    #[test]
    fn shift_moves_relative_parts_only() {
        assert_eq!(shift_input("=A1+$B$2+C$3+$D4", 2, 1), "=B3+$B$2+D$3+$D6");
        assert_eq!(shift_input("=SUM(A1:A3)", 1, 0), "=SUM(A2:A4)");
        assert_eq!(shift_input("=A1", -1, 0), "=#REF!");
        assert_eq!(shift_input("=A:A", 5, 1), "=B:B");
        assert_eq!(shift_input("plain", 3, 3), "plain");
        assert_eq!(shift_input("=a1", 0, 0), "=a1");
        assert_eq!(shift_input("=Sheet2!A1", 1, 1), "=Sheet2!B2");
    }

    #[test]
    fn single_number_copies_or_counts() {
        assert_eq!(plan(&[num(5.0)], FillMode::Auto), FillPlan::Copy);
        let p = plan(&[num(5.0)], FillMode::Alternate);
        assert_eq!(
            values(&p, 1..3),
            vec![Value::Number(6.0), Value::Number(7.0)]
        );
        assert_eq!(plan(&[num(5.0)], FillMode::Series), p);
    }

    #[test]
    fn two_numbers_continue_linearly() {
        let p = plan(&[num(1.0), num(2.0)], FillMode::Auto);
        assert_eq!(p, FillPlan::Linear { a: 1.0, b: 1.0 });
        assert_eq!(p.value_at(9), Some(Value::Number(10.0)));
        assert_eq!(p.value_at(-1), Some(Value::Number(0.0)));
        assert_eq!(
            plan(&[num(1.0), num(2.0)], FillMode::Alternate),
            FillPlan::Copy
        );
        let p = plan(&[num(10.0), num(7.5)], FillMode::Auto);
        assert_eq!(
            values(&p, 2..4),
            vec![Value::Number(5.0), Value::Number(2.5)]
        );
    }

    #[test]
    fn three_numbers_use_the_best_fit_trend() {
        // Excel: 1, 3, 4 → 5.666…, 7.166…
        let p = plan(&[num(1.0), num(3.0), num(4.0)], FillMode::Auto);
        let FillPlan::Linear { a, b } = p else {
            panic!("{p:?}")
        };
        assert!((a + 3.0 * b - 5.666_666_666_666_67).abs() < 1e-9);
        assert!((a + 4.0 * b - 7.166_666_666_666_67).abs() < 1e-9);
    }

    #[test]
    fn decimals_do_not_accumulate_noise() {
        let p = plan(&[num(0.1), num(0.2)], FillMode::Auto);
        assert_eq!(p.value_at(2), Some(Value::Number(0.3)));
        assert_eq!(p.value_at(6), Some(Value::Number(0.7)));
    }

    #[test]
    fn single_date_steps_by_a_day() {
        let d = FillItem::Number {
            n: 45306.0,
            date: true,
        };
        let p = plan(std::slice::from_ref(&d), FillMode::Auto);
        assert_eq!(p.value_at(1), Some(Value::Number(45307.0)));
        assert_eq!(plan(&[d], FillMode::Alternate), FillPlan::Copy);
    }

    #[test]
    fn text_with_number_counts_up() {
        let p = plan(&[FillItem::Text("Item1".into())], FillMode::Auto);
        assert_eq!(
            values(&p, 1..3),
            vec![Value::Text("Item2".into()), Value::Text("Item3".into())]
        );
        assert_eq!(p.value_at(-2), Some(Value::Text("Item1".into())));
        assert_eq!(
            plan(&[FillItem::Text("Item1".into())], FillMode::Alternate),
            FillPlan::Copy
        );
        let p = plan(
            &[FillItem::Text("Q 1".into()), FillItem::Text("Q 3".into())],
            FillMode::Auto,
        );
        assert_eq!(p.value_at(2), Some(Value::Text("Q 5".into())));
        let p = plan(&[FillItem::Text("No 007".into())], FillMode::Auto);
        assert_eq!(p.value_at(3), Some(Value::Text("No 010".into())));
    }

    #[test]
    fn other_content_is_copied() {
        assert_eq!(
            plan(&[FillItem::Text("abc".into())], FillMode::Series),
            FillPlan::Copy
        );
        assert_eq!(plan(&[FillItem::Other], FillMode::Auto), FillPlan::Copy);
        assert_eq!(
            plan(&[num(1.0), FillItem::Other], FillMode::Auto),
            FillPlan::Copy
        );
        assert_eq!(
            plan(
                &[FillItem::Text("a1".into()), FillItem::Text("b2".into())],
                FillMode::Auto
            ),
            FillPlan::Copy
        );
        assert_eq!(plan(&[num(1.0), num(2.0)], FillMode::Copy), FillPlan::Copy);
        assert_eq!(
            plan(&[FillItem::Text("12".into())], FillMode::Auto),
            FillPlan::Copy
        );
    }
}
