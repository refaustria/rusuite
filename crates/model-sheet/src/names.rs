//! Defined names ([`DefinedName`]): the engine resolves and recalculates
//! them ([`engine_formula::Engine::set_name`]); the workbook adds what a
//! document keeps besides the definition – comment, hidden flag and the
//! built-in names (`Print_Area`, `Print_Titles`, …) that `fmt-xlsx` maps
//! to `_xlnm.*`.
//!
//! Excel's rules: a name is unique per scope (case-insensitive); a sheet
//! name wins over a workbook name of the same spelling on its sheet.
//! Built-in names are sheet-level. The print area and print titles of a
//! sheet are its `Print_Area` / `Print_Titles` names, so they follow
//! row/column inserts and deletes like any other name.

use engine_formula::ast::{col_to_letters, sheet_needs_quotes, MAX_COL, MAX_ROW};
use engine_formula::{Expr, NameScope, Recalc, SheetId};
use serde::{Deserialize, Serialize};

use crate::workbook::Workbook;
use crate::Error;

/// Excel's built-in names (`_xlnm.<Name>` in the file).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BuiltinName {
    PrintArea,
    PrintTitles,
    Criteria,
    Extract,
    ConsolidateArea,
    SheetTitle,
}

impl BuiltinName {
    pub const ALL: [BuiltinName; 6] = [
        BuiltinName::PrintArea,
        BuiltinName::PrintTitles,
        BuiltinName::Criteria,
        BuiltinName::Extract,
        BuiltinName::ConsolidateArea,
        BuiltinName::SheetTitle,
    ];

    /// The name as Excel shows it (`Print_Area`).
    pub fn display(self) -> &'static str {
        match self {
            BuiltinName::PrintArea => "Print_Area",
            BuiltinName::PrintTitles => "Print_Titles",
            BuiltinName::Criteria => "Criteria",
            BuiltinName::Extract => "Extract",
            BuiltinName::ConsolidateArea => "Consolidate_Area",
            BuiltinName::SheetTitle => "Sheet_Title",
        }
    }

    /// The name in the file (`_xlnm.Print_Area`).
    pub fn file_name(self) -> String {
        format!("_xlnm.{}", self.display())
    }

    /// The built-in name of a file name (`_xlnm.Print_Area`, any case).
    pub fn from_file_name(name: &str) -> Option<BuiltinName> {
        let prefix = name.get(..6)?;
        if !prefix.eq_ignore_ascii_case("_xlnm.") {
            return None;
        }
        let tail = &name[6..];
        Self::ALL
            .into_iter()
            .find(|b| b.display().eq_ignore_ascii_case(tail))
    }
}

/// A defined name of the workbook.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedName {
    /// As shown (`Tax`, `Print_Area`).
    pub name: String,
    pub scope: NameScope,
    /// The definition without `=`: `Sheet1!$A$1:$B$5`, `0.19`,
    /// `OFFSET(...)`.
    pub refers_to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<BuiltinName>,
}

impl DefinedName {
    /// A plain name without comment.
    pub fn new(name: &str, scope: NameScope, refers_to: &str) -> Self {
        DefinedName {
            name: name.to_string(),
            scope,
            refers_to: refers_to.strip_prefix('=').unwrap_or(refers_to).to_string(),
            comment: None,
            hidden: false,
            builtin: None,
        }
    }
}

/// The rows `r0..=r1` and columns `c0..=c1` repeated on every printed
/// page.
pub type PrintTitles = (Option<(u32, u32)>, Option<(u32, u32)>);

/// What the workbook keeps per name besides the engine's definition.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct NameMeta {
    pub comment: Option<String>,
    pub hidden: bool,
    pub builtin: Option<BuiltinName>,
}

pub(crate) type NameKey = (String, NameScope);

pub(crate) fn key(name: &str, scope: NameScope) -> NameKey {
    (name.to_lowercase(), scope)
}

/// `$A$1:$C$9` / `$1:$3` / `$A:$B` text for a rectangle (whole rows or
/// columns when the rectangle spans the sheet).
pub fn abs_area(r0: u32, c0: u32, r1: u32, c1: u32) -> String {
    if c0 == 0 && c1 == MAX_COL {
        return format!("${}:${}", r0 + 1, r1 + 1);
    }
    if r0 == 0 && r1 == MAX_ROW {
        return format!("${}:${}", col_to_letters(c0), col_to_letters(c1));
    }
    let cell = |r: u32, c: u32| format!("${}${}", col_to_letters(c), r + 1);
    if (r0, c0) == (r1, c1) {
        cell(r0, c0)
    } else {
        format!("{}:{}", cell(r0, c0), cell(r1, c1))
    }
}

/// `Sheet1!` or `'My Sheet'!`.
pub fn sheet_prefix(name: &str) -> String {
    if sheet_needs_quotes(name) {
        format!("'{}'!", name.replace('\'', "''"))
    } else {
        format!("{name}!")
    }
}

impl Workbook {
    /// The defined names in definition order.
    pub fn names(&self) -> Vec<DefinedName> {
        self.engine()
            .names()
            .iter()
            .map(|n| {
                let meta = self
                    .name_meta
                    .get(&key(&n.name, n.scope))
                    .cloned()
                    .unwrap_or_default();
                DefinedName {
                    name: n.name.clone(),
                    scope: n.scope,
                    refers_to: n.formula.clone(),
                    comment: meta.comment,
                    hidden: meta.hidden,
                    builtin: meta.builtin,
                }
            })
            .collect()
    }

    /// The name `name` (case-insensitive) of exactly `scope`.
    pub fn name(&self, name: &str, scope: NameScope) -> Option<DefinedName> {
        self.names()
            .into_iter()
            .find(|n| n.scope == scope && n.name.to_lowercase() == name.to_lowercase())
    }

    fn put_meta(&mut self, def: &DefinedName) {
        let meta = NameMeta {
            comment: def.comment.clone().filter(|c| !c.is_empty()),
            hidden: def.hidden,
            builtin: def.builtin,
        };
        let k = key(&def.name, def.scope);
        if meta == NameMeta::default() {
            self.name_meta.remove(&k);
        } else {
            self.name_meta.insert(k, meta);
        }
    }

    /// Adds a name at the end of the list. Fails with
    /// `DuplicateName` / `InvalidName` / a parse error (see
    /// [`engine_formula::Engine::insert_name`]).
    pub fn define_name(&mut self, def: &DefinedName) -> Result<Recalc, Error> {
        let at = self.engine().names().len();
        self.insert_name(at, def)
    }

    /// Inserts a name at position `index` (undo of a delete).
    pub fn insert_name(&mut self, index: usize, def: &DefinedName) -> Result<Recalc, Error> {
        let recalc = self
            .engine_mut()
            .insert_name(index, &def.name, def.scope, &def.refers_to)?;
        self.put_meta(def);
        Ok(recalc)
    }

    /// Replaces the name `old` (in `old_scope`) by `def`, in place.
    pub fn update_name(
        &mut self,
        old: &str,
        old_scope: NameScope,
        def: &DefinedName,
    ) -> Result<Recalc, Error> {
        let recalc =
            self.engine_mut()
                .update_name(old, old_scope, &def.name, def.scope, &def.refers_to)?;
        self.name_meta.remove(&key(old, old_scope));
        self.put_meta(def);
        Ok(recalc)
    }

    /// Deletes a name; returns its position and definition (for undo).
    pub fn delete_name(
        &mut self,
        name: &str,
        scope: NameScope,
    ) -> Result<(usize, DefinedName, Recalc), Error> {
        let names = self.names();
        let index = names
            .iter()
            .position(|n| n.scope == scope && n.name.to_lowercase() == name.to_lowercase())
            .ok_or_else(|| engine_formula::EngineError::UnknownName(name.to_string()))?;
        let recalc = self.engine_mut().remove_name(name, scope)?;
        self.name_meta.remove(&key(name, scope));
        Ok((index, names[index].clone(), recalc))
    }

    /// Replaces every name (undo of edits that rewrote names).
    pub fn set_names(&mut self, names: &[DefinedName]) -> Result<Recalc, Error> {
        let list: Vec<(String, NameScope, String)> = names
            .iter()
            .map(|n| (n.name.clone(), n.scope, n.refers_to.clone()))
            .collect();
        let recalc = self.engine_mut().replace_names(&list)?;
        self.name_meta.clear();
        for n in names {
            self.put_meta(n);
        }
        Ok(recalc)
    }

    /// Drops the metadata of names that no longer exist (after a sheet
    /// was removed) and copies the metadata of names the engine copied.
    pub(crate) fn sync_name_meta(&mut self, copied_from: Option<(SheetId, SheetId)>) {
        if let Some((from, to)) = copied_from {
            let copies: Vec<(NameKey, NameMeta)> = self
                .name_meta
                .iter()
                .filter(|((_, s), _)| *s == NameScope::Sheet(from))
                .map(|((n, _), m)| ((n.clone(), NameScope::Sheet(to)), m.clone()))
                .collect();
            self.name_meta.extend(copies);
        }
        let live: std::collections::HashSet<NameKey> = self
            .engine()
            .names()
            .iter()
            .map(|n| key(&n.name, n.scope))
            .collect();
        self.name_meta.retain(|k, _| live.contains(k));
    }

    /// The built-in name `b` of `sheet`.
    pub fn builtin_name(&self, sheet: SheetId, b: BuiltinName) -> Option<DefinedName> {
        self.names()
            .into_iter()
            .find(|n| n.scope == NameScope::Sheet(sheet) && n.builtin == Some(b))
    }

    /// Sets (or with `None` removes) the built-in name `b` of `sheet`.
    pub fn set_builtin_name(
        &mut self,
        sheet: SheetId,
        b: BuiltinName,
        refers_to: Option<&str>,
    ) -> Result<Recalc, Error> {
        let scope = NameScope::Sheet(sheet);
        let existing = self.builtin_name(sheet, b);
        match (existing, refers_to) {
            (Some(old), Some(text)) => {
                let def = DefinedName {
                    refers_to: text.to_string(),
                    ..old.clone()
                };
                self.update_name(&old.name, scope, &def)
            }
            (Some(old), None) => Ok(self.delete_name(&old.name, scope)?.2),
            (None, Some(text)) => {
                let def = DefinedName {
                    builtin: Some(b),
                    ..DefinedName::new(b.display(), scope, text)
                };
                self.define_name(&def)
            }
            (None, None) => Ok(Recalc::default()),
        }
    }

    /// The print area of `sheet`: the rectangles of its `Print_Area`
    /// name (several areas are printed one after the other).
    pub fn print_area(&self, sheet: SheetId) -> Vec<crate::CellRange> {
        let Some(def) = self.builtin_name(sheet, BuiltinName::PrintArea) else {
            return Vec::new();
        };
        self.name_ranges(&def)
    }

    /// Sets the print area of `sheet` (`None`: clear it).
    pub fn set_print_area(
        &mut self,
        sheet: SheetId,
        area: Option<(u32, u32, u32, u32)>,
    ) -> Result<Recalc, Error> {
        let text = match area {
            Some((r0, c0, r1, c1)) => {
                let name = self
                    .engine()
                    .sheet_name(sheet)
                    .ok_or(Error::UnknownSheet(sheet))?;
                Some(format!(
                    "{}{}",
                    sheet_prefix(name),
                    abs_area(r0, c0, r1, c1)
                ))
            }
            None => None,
        };
        self.set_builtin_name(sheet, BuiltinName::PrintArea, text.as_deref())
    }

    /// The rows and columns repeated on every printed page (`Print_Titles`):
    /// `(rows r0..=r1, cols c0..=c1)`.
    pub fn print_titles(&self, sheet: SheetId) -> PrintTitles {
        let Some(def) = self.builtin_name(sheet, BuiltinName::PrintTitles) else {
            return (None, None);
        };
        let (mut rows, mut cols) = (None, None);
        for r in self.name_ranges(&def) {
            if r.c0 == 0 && r.c1 == MAX_COL {
                rows = Some((r.r0, r.r1));
            } else if r.r0 == 0 && r.r1 == MAX_ROW {
                cols = Some((r.c0, r.c1));
            }
        }
        (rows, cols)
    }

    /// Sets the print titles of `sheet` (both `None`: clear them).
    pub fn set_print_titles(
        &mut self,
        sheet: SheetId,
        rows: Option<(u32, u32)>,
        cols: Option<(u32, u32)>,
    ) -> Result<Recalc, Error> {
        let name = self
            .engine()
            .sheet_name(sheet)
            .ok_or(Error::UnknownSheet(sheet))?;
        let prefix = sheet_prefix(name);
        let mut parts = Vec::new();
        if let Some((c0, c1)) = cols {
            parts.push(format!("{prefix}{}", abs_area(0, c0, MAX_ROW, c1)));
        }
        if let Some((r0, r1)) = rows {
            parts.push(format!("{prefix}{}", abs_area(r0, 0, r1, MAX_COL)));
        }
        let text = (!parts.is_empty()).then(|| parts.join(","));
        self.set_builtin_name(sheet, BuiltinName::PrintTitles, text.as_deref())
    }

    /// The rectangles of a name that is a reference or a union of
    /// references (`A1:B2,D1:D9`), resolved on its scope sheet.
    pub fn name_ranges(&self, def: &DefinedName) -> Vec<crate::CellRange> {
        let engine = self.engine();
        let Some(entry) = engine.name(&def.name, def.scope) else {
            return Vec::new();
        };
        let sheet = match def.scope {
            NameScope::Sheet(s) => s,
            NameScope::Workbook => engine.sheets().next().map_or(SheetId(0), |(s, _)| s),
        };
        let parts: Vec<&Expr> = match &entry.ast {
            Expr::Call { name, args } if name == engine_formula::engine::UNION_CALL => {
                args.iter().collect()
            }
            e => vec![e],
        };
        let ctx = engine.eval_context(engine, engine_formula::CellCoord::new(sheet, 0, 0));
        parts
            .into_iter()
            .filter_map(|e| match e {
                Expr::Reference(r) => engine_formula::eval::resolve(r, &ctx).ok(),
                _ => None,
            })
            .collect()
    }
}
