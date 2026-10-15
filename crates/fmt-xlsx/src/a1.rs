//! A1 cell references ↔ 0-based `(row, col)`.

use engine_formula::ast::{col_to_letters, letters_to_col, MAX_COL, MAX_ROW};

/// Parses a plain A1 reference (`B7`, case-insensitive, no `$`) into
/// 0-based `(row, col)`. `None` if malformed or out of range.
pub fn parse_cell(s: &str) -> Option<(u32, u32)> {
    let split = s.find(|c: char| !c.is_ascii_alphabetic())?;
    let (letters, digits) = s.split_at(split);
    if letters.is_empty() || digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let col = letters_to_col(letters).filter(|&c| c <= MAX_COL)?;
    let row: u64 = digits.parse().ok()?;
    if row == 0 || row > u64::from(MAX_ROW) + 1 {
        return None;
    }
    Some((row as u32 - 1, col))
}

/// Formats 0-based `(row, col)` as `A1` text.
pub fn cell_name(row: u32, col: u32) -> String {
    format!("{}{}", col_to_letters(col), row + 1)
}

/// Formats an inclusive 0-based range as `A1:B2` (or `A1` for one cell).
pub fn range_name(r0: u32, c0: u32, r1: u32, c1: u32) -> String {
    if (r0, c0) == (r1, c1) {
        cell_name(r0, c0)
    } else {
        format!("{}:{}", cell_name(r0, c0), cell_name(r1, c1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a1_roundtrip() {
        assert_eq!(parse_cell("A1"), Some((0, 0)));
        assert_eq!(parse_cell("b7"), Some((6, 1)));
        assert_eq!(parse_cell("XFD1048576"), Some((MAX_ROW, MAX_COL)));
        for bad in ["", "A", "1", "A0", "XFE1", "A1048577", "A1B", "$A$1", "A-1"] {
            assert_eq!(parse_cell(bad), None, "{bad}");
        }
        assert_eq!(cell_name(0, 0), "A1");
        assert_eq!(cell_name(6, 27), "AB7");
        for (r, c) in [(0, 0), (9, 25), (99, 26), (MAX_ROW, MAX_COL)] {
            assert_eq!(parse_cell(&cell_name(r, c)), Some((r, c)));
        }
        assert_eq!(range_name(0, 0, 0, 0), "A1");
        assert_eq!(range_name(0, 0, 6, 5), "A1:F7");
    }
}
