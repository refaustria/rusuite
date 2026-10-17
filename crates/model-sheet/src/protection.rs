//! Sheet and workbook protection (Review › Protect Sheet / Protect
//! Workbook) and the two password forms Excel writes.
//!
//! The flags keep the meaning of the `.xlsx` attributes
//! (`<sheetProtection>`, ECMA-376 Part 1 §18.3.1.85): `true` means the
//! action is **protected** (not allowed), so `formatCells: true` (the
//! default) forbids formatting and `selectLockedCells: true` forbids
//! selecting locked cells. Excel's Protect Sheet dialog shows the
//! inverse ("Allow all users of this worksheet to: ☑ Format cells").
//!
//! Passwords are never stored, only their hashes:
//!
//! * the legacy 16-bit hash (`password="CC1A"`), see [`legacy_hash`];
//! * `algorithmName="SHA-512"` + `hashValue` + `saltValue` +
//!   `spinCount` (base64), see [`HashedPassword::sha512`]: `H0 =
//!   SHA-512(salt ‖ UTF-16LE(password))`, then `spinCount` times
//!   `Hn = SHA-512(Hn-1 ‖ LE32(n-1))` (§18.2.29 / Excel's iterator
//!   appended after the hash).
//!
//! ```
//! use model_sheet::protection::{legacy_hash, HashedPassword};
//!
//! assert_eq!(legacy_hash("test"), 0xCBEB);
//! let h = HashedPassword::sha512("secret", &[1; 16], 10);
//! assert!(h.verify("secret"));
//! assert!(!h.verify("Secret"));
//! ```

use base64::Engine as _;
use engine_formula::{CellContent, CellCoord, SheetId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};

use crate::style::StyleId;
use crate::{CellRange, Error, Workbook};

/// Excel's default `spinCount` for SHA-512 password hashes.
pub const DEFAULT_SPIN_COUNT: u32 = 100_000;

/// Excel's text when a protected sheet refuses a change.
pub const SHEET_PROTECTED_MESSAGE: &str = "The cell or chart you're trying to change is on a protected sheet. To make a change, unprotect the sheet. You might be requested to enter a password.";

/// Excel's text when a locked workbook structure refuses a sheet change.
pub const WORKBOOK_PROTECTED_MESSAGE: &str = "The workbook is protected and cannot be changed.";

/// Excel's text for a wrong password.
pub const WRONG_PASSWORD_MESSAGE: &str = "The password you supplied is not correct. Verify that the CAPS LOCK key is off and be sure to use the correct capitalization.";

/// The legacy 16-bit password hash of ECMA-376 Part 4 §14.7.1 (what
/// openpyxl and old Excel versions write as `password="…"`, four hex
/// digits).
pub fn legacy_hash(password: &str) -> u16 {
    let mut hash: u32 = 0;
    let mut len: u32 = 0;
    for (i, ch) in password.chars().enumerate() {
        // Excel hashes the bytes of the password in the ANSI code page;
        // for the characters below U+0100 that is the code point.
        let value = (u32::from(ch) & 0xFFFF) << (i as u32 + 1).min(31);
        let rotated = value >> 15;
        hash ^= (value & 0x7FFF) | rotated;
        len += 1;
    }
    hash ^= len;
    hash ^= 0xCE4B;
    (hash & 0xFFFF) as u16
}

/// A password stored as `algorithmName` / `hashValue` / `saltValue` /
/// `spinCount` (the base64 texts as in the file).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashedPassword {
    /// `SHA-512` as Excel writes it (also `SHA-256`, `SHA-384`; other
    /// algorithms are kept but never verify).
    pub algorithm_name: String,
    pub hash_value: String,
    pub salt_value: String,
    pub spin_count: u32,
}

fn utf16le(password: &str) -> Vec<u8> {
    password.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

fn iterate<D: Digest>(password: &str, salt: &[u8], spin_count: u32) -> Vec<u8> {
    let mut h = D::new();
    h.update(salt);
    h.update(utf16le(password));
    let mut hash = h.finalize().to_vec();
    for i in 0..spin_count {
        let mut h = D::new();
        h.update(&hash);
        h.update(i.to_le_bytes());
        hash = h.finalize().to_vec();
    }
    hash
}

impl HashedPassword {
    /// The SHA-512 form of `password` with `salt` (Excel: 16 random
    /// bytes) and `spin_count` iterations.
    pub fn sha512(password: &str, salt: &[u8], spin_count: u32) -> Self {
        let b64 = base64::engine::general_purpose::STANDARD;
        HashedPassword {
            algorithm_name: "SHA-512".into(),
            hash_value: b64.encode(iterate::<Sha512>(password, salt, spin_count)),
            salt_value: b64.encode(salt),
            spin_count,
        }
    }

    /// Whether `password` produces this hash.
    pub fn verify(&self, password: &str) -> bool {
        let b64 = base64::engine::general_purpose::STANDARD;
        let (Ok(salt), Ok(expected)) = (
            b64.decode(self.salt_value.trim()),
            b64.decode(self.hash_value.trim()),
        ) else {
            return false;
        };
        let got = match self.algorithm_name.to_ascii_uppercase().as_str() {
            "SHA-512" | "SHA512" => iterate::<Sha512>(password, &salt, self.spin_count),
            "SHA-384" | "SHA384" => iterate::<sha2::Sha384>(password, &salt, self.spin_count),
            "SHA-256" | "SHA256" => iterate::<sha2::Sha256>(password, &salt, self.spin_count),
            _ => return false,
        };
        got == expected
    }
}

/// The password of a protection: none, the legacy hash, the salted hash
/// or both (as a file may carry).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Password {
    /// The legacy 16-bit hash (`password` attribute).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hashed: Option<HashedPassword>,
}

impl Password {
    /// Excel's form for a new password: SHA-512 with `salt` and
    /// [`DEFAULT_SPIN_COUNT`]; an empty password is no password.
    pub fn new(password: &str, salt: &[u8]) -> Self {
        if password.is_empty() {
            return Password::default();
        }
        Password {
            legacy: None,
            hashed: Some(HashedPassword::sha512(password, salt, DEFAULT_SPIN_COUNT)),
        }
    }

    pub fn is_none(&self) -> bool {
        self.legacy.is_none() && self.hashed.is_none()
    }

    /// Whether `password` unlocks: anything without a password; with the
    /// salted hash, that hash decides; else the legacy hash.
    pub fn verify(&self, password: &str) -> bool {
        match (&self.hashed, self.legacy) {
            (Some(h), _) => h.verify(password),
            (None, Some(l)) => legacy_hash(password) == l,
            (None, None) => true,
        }
    }
}

/// `<sheetProtection>`: see the module docs for the meaning of the flags.
/// `Default` is what Excel's Protect Sheet dialog writes by default
/// (selecting cells allowed, everything else protected).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetProtection {
    /// The sheet is protected (a `<sheetProtection>` with `sheet="0"`
    /// only carries options).
    pub sheet: bool,
    /// Objects (charts, pictures, notes) are protected.
    pub objects: bool,
    pub scenarios: bool,
    pub format_cells: bool,
    pub format_columns: bool,
    pub format_rows: bool,
    pub insert_columns: bool,
    pub insert_rows: bool,
    pub insert_hyperlinks: bool,
    pub delete_columns: bool,
    pub delete_rows: bool,
    /// Selecting locked cells is not allowed.
    pub select_locked_cells: bool,
    /// Selecting unlocked cells is not allowed.
    pub select_unlocked_cells: bool,
    pub sort: bool,
    pub auto_filter: bool,
    pub pivot_tables: bool,
    #[serde(skip_serializing_if = "Password::is_none")]
    pub password: Password,
}

impl Default for SheetProtection {
    fn default() -> Self {
        SheetProtection {
            sheet: true,
            objects: true,
            scenarios: true,
            format_cells: true,
            format_columns: true,
            format_rows: true,
            insert_columns: true,
            insert_rows: true,
            insert_hyperlinks: true,
            delete_columns: true,
            delete_rows: true,
            select_locked_cells: false,
            select_unlocked_cells: false,
            sort: true,
            auto_filter: true,
            pivot_tables: true,
            password: Password::default(),
        }
    }
}

impl SheetProtection {
    /// Whether the protection is in force (`sheet="1"`).
    pub fn is_active(&self) -> bool {
        self.sheet
    }
}

/// `<workbookProtection>`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkbookProtection {
    /// Sheets cannot be added, deleted, renamed, moved, copied, hidden or
    /// unhidden.
    pub lock_structure: bool,
    /// The window size and position are fixed (kept for the file only).
    pub lock_windows: bool,
    #[serde(skip_serializing_if = "Password::is_none")]
    pub password: Password,
}

impl WorkbookProtection {
    pub fn is_active(&self) -> bool {
        self.lock_structure || self.lock_windows
    }
}

impl Workbook {
    /// The sheet's `<sheetProtection>` (possibly inactive, `sheet: false`).
    pub fn sheet_protection(&self, id: SheetId) -> Option<&SheetProtection> {
        self.sheet_data(id).protection.as_ref()
    }

    /// The protection in force on the sheet (`None`: unprotected).
    pub fn active_protection(&self, id: SheetId) -> Option<&SheetProtection> {
        self.sheet_protection(id).filter(|p| p.is_active())
    }

    pub fn set_sheet_protection(
        &mut self,
        id: SheetId,
        protection: Option<SheetProtection>,
    ) -> Result<(), Error> {
        self.sheet_data_mut(id)?.protection = protection;
        Ok(())
    }

    pub fn workbook_protection(&self) -> Option<&WorkbookProtection> {
        self.protection.as_ref()
    }

    pub fn set_workbook_protection(&mut self, protection: Option<WorkbookProtection>) {
        self.protection = protection;
    }

    /// Whether Protect Workbook locks the structure (sheets cannot be
    /// added, deleted, renamed, moved, hidden or unhidden).
    pub fn structure_locked(&self) -> bool {
        self.protection.as_ref().is_some_and(|p| p.lock_structure)
    }

    fn style_locked(&self, id: StyleId) -> bool {
        self.styles().get(id).protection.locked.unwrap_or(true)
    }

    /// The cell's effective `locked` flag (Excel's default: locked).
    pub fn is_locked(&self, c: CellCoord) -> bool {
        self.style_locked(self.style_id(c))
    }

    /// Whether the formula bar hides the cell's formula: a formula cell
    /// with the `hidden` flag on a protected sheet.
    pub fn is_formula_hidden(&self, c: CellCoord) -> bool {
        self.active_protection(c.sheet).is_some()
            && self.style(c).protection.hidden == Some(true)
            && matches!(self.content(c), CellContent::Formula { .. })
    }

    /// Whether any cell of `range` is locked. Large ranges (whole rows
    /// or columns) are decided from the own, row and column styles
    /// without visiting every cell.
    pub fn range_has_locked(&self, range: CellRange) -> bool {
        let (r0, c0) = (range.r0.min(range.r1), range.c0.min(range.c1));
        let (r1, c1) = (range.r0.max(range.r1), range.c0.max(range.c1));
        let height = u64::from(r1 - r0) + 1;
        let width = u64::from(c1 - c0) + 1;
        if height * width <= 1 << 16 {
            return (r0..=r1).any(|row| {
                (c0..=c1).any(|col| self.is_locked(CellCoord::new(range.sheet, row, col)))
            });
        }
        let data = self.sheet_data(range.sheet);
        let inside = |row: u32, col: u32| (r0..=r1).contains(&row) && (c0..=c1).contains(&col);
        if data
            .cell_styles
            .iter()
            .any(|(&(row, col), &id)| inside(row, col) && self.style_locked(id))
        {
            return true;
        }
        // The cells without an own style take the row, else the column
        // style (some such cell exists in every row of a large range).
        let mut styled_rows = 0u64;
        for (_, info) in data.rows.range(r0..=r1) {
            if let Some(id) = info.style {
                styled_rows += 1;
                if self.style_locked(id) {
                    return true;
                }
            }
        }
        if styled_rows == height {
            return false;
        }
        let mut styled_cols = 0u64;
        for (_, info) in data.cols.range(c0..=c1) {
            if let Some(id) = info.style {
                styled_cols += 1;
                if self.style_locked(id) {
                    return true;
                }
            }
        }
        styled_cols < width
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_hash_matches_openpyxl() {
        // `openpyxl.utils.protection.hash_password`.
        assert_eq!(legacy_hash(""), 0xCE4B);
        assert_eq!(legacy_hash("test"), 0xCBEB);
        assert_eq!(legacy_hash("password"), 0x83AF);
        assert_eq!(legacy_hash("Rusuite2026"), 0xC35A);
        assert_eq!(legacy_hash("abc"), 0xCC1A);
    }

    #[test]
    fn sha512_known_vector() {
        // Independently computed (Python hashlib) for salt 0..16, 100000
        // iterations of the ECMA-376 scheme.
        let salt: Vec<u8> = (0..16).collect();
        let h = HashedPassword::sha512("test", &salt, DEFAULT_SPIN_COUNT);
        assert_eq!(h.salt_value, "AAECAwQFBgcICQoLDA0ODw==");
        assert_eq!(h.hash_value, KNOWN_TEST_HASH);
        assert!(h.verify("test"));
        assert!(!h.verify("Test"));
        assert!(!h.verify(""));
    }

    const KNOWN_TEST_HASH: &str =
        "kdzmKvUf75HfA139bmknTx3jS5fWiutEA6RBGAszO6u8TWVHxbvj+mCzRnoOrXQhYGnJ5tcghBKAX1PBRLZdtg==";

    #[test]
    fn password_verify_forms() {
        assert!(Password::default().verify("anything"));
        let legacy = Password {
            legacy: Some(legacy_hash("abc")),
            hashed: None,
        };
        assert!(legacy.verify("abc"));
        assert!(!legacy.verify("abd"));
        let new = Password::new("abc", &[7; 16]);
        assert!(new.hashed.is_some() && new.legacy.is_none());
        assert!(new.verify("abc") && !new.verify("ABC"));
        assert!(Password::new("", &[7; 16]).is_none());
        let unknown = Password {
            legacy: None,
            hashed: Some(HashedPassword {
                algorithm_name: "MD5".into(),
                ..HashedPassword::sha512("x", &[0; 16], 1)
            }),
        };
        assert!(!unknown.verify("x"));
    }

    #[test]
    fn sha256_and_bad_base64() {
        let mut h = HashedPassword::sha512("pw", &[3; 8], 5);
        h.algorithm_name = "SHA-256".into();
        assert!(!h.verify("pw"));
        h.salt_value = "***".into();
        assert!(!h.verify("pw"));
    }

    #[test]
    fn locked_cells_of_ranges() {
        use crate::{CellStyle, Protection};
        use engine_formula::ast::MAX_COL;
        let mut wb = Workbook::new();
        let s = SheetId(0);
        assert!(wb.range_has_locked(CellRange::new(s, 0, 0, 0, 0)));
        let open = CellStyle {
            protection: Protection {
                locked: Some(false),
                hidden: Some(true),
            },
            ..Default::default()
        };
        wb.apply_style_patch(CellRange::new(s, 1, 1, 2, 2), &open)
            .unwrap();
        assert!(!wb.range_has_locked(CellRange::new(s, 1, 1, 2, 2)));
        assert!(wb.range_has_locked(CellRange::new(s, 1, 1, 3, 2)));
        // A whole row: locked unless the row style unlocks it.
        let row = CellRange::new(s, 5, 0, 5, MAX_COL);
        assert!(wb.range_has_locked(row));
        let id = wb.intern_style(&open);
        let info = crate::RowInfo {
            style: Some(id),
            ..Default::default()
        };
        wb.set_row_info(s, 5, info).unwrap();
        assert!(!wb.range_has_locked(row));
        // Formula hiding needs a protected sheet and a formula.
        wb.set_input(CellCoord::new(s, 1, 1), "=1+1").unwrap();
        wb.set_input(CellCoord::new(s, 2, 2), "7").unwrap();
        assert!(!wb.is_formula_hidden(CellCoord::new(s, 1, 1)));
        wb.set_sheet_protection(s, Some(SheetProtection::default()))
            .unwrap();
        assert!(wb.is_formula_hidden(CellCoord::new(s, 1, 1)));
        assert!(!wb.is_formula_hidden(CellCoord::new(s, 2, 2)));
    }

    #[test]
    fn defaults_follow_excel() {
        let p = SheetProtection::default();
        assert!(p.is_active() && p.format_cells && !p.select_locked_cells);
        let json = serde_json::to_string(&p).unwrap();
        assert!(!json.contains("password"));
        let back: SheetProtection = serde_json::from_str(r#"{"sort":false}"#).unwrap();
        assert!(back.sheet && !back.sort && back.format_cells);
        assert!(!WorkbookProtection::default().is_active());
    }
}
