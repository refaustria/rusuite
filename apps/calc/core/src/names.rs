//! Defined names (P8-23): the name commands, Create from Selection, the
//! `names` / `nameAt` requests, Formula Auditing's `precedents` /
//! `dependents`, and the `names` list of patches.

use engine_formula::ast::is_valid_name;
use engine_formula::{NameScope, Value};
use model_sheet::names::{abs_area, sheet_prefix};
use model_sheet::{CellCoord, DefinedName, SheetId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::{CalcCommand, Rect, SheetRect};
use crate::display::display_value;
use crate::doc::{CalcApplied, CalcDocument, CalcError, Result};

/// A defined name on the wire. `sheet` = the id of the scope sheet,
/// absent = a workbook name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct NameDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sheet: Option<u32>,
    /// The definition without `=` (`Sheet1!$A$1:$B$5`, `0.19`, `OFFSET(...)`).
    pub refers_to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub hidden: bool,
    /// `Print_Area`, `Print_Titles`, …: Excel's built-in names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, as = "Option<crate::wire::BuiltinName>")]
    pub builtin: Option<model_sheet::BuiltinName>,
}

impl NameDef {
    pub(crate) fn scope(&self) -> NameScope {
        scope_of(self.sheet)
    }

    fn to_model(&self) -> DefinedName {
        DefinedName {
            name: self.name.trim().to_string(),
            scope: self.scope(),
            refers_to: self
                .refers_to
                .trim()
                .strip_prefix('=')
                .unwrap_or(self.refers_to.trim())
                .to_string(),
            comment: self.comment.clone().filter(|c| !c.is_empty()),
            hidden: self.hidden,
            builtin: self.builtin,
        }
    }

    fn from_model(n: &DefinedName) -> Self {
        NameDef {
            name: n.name.clone(),
            sheet: match n.scope {
                NameScope::Workbook => None,
                NameScope::Sheet(s) => Some(s.0),
            },
            refers_to: n.refers_to.clone(),
            comment: n.comment.clone(),
            hidden: n.hidden,
            builtin: n.builtin,
        }
    }
}

pub(crate) fn scope_of(sheet: Option<u32>) -> NameScope {
    sheet.map_or(NameScope::Workbook, |s| NameScope::Sheet(SheetId(s)))
}

/// A name as the UI lists it (Name Box, autocomplete, formula colouring):
/// its definition plus the range it refers to when that is a single
/// area.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct NameInfo {
    #[serde(flatten)]
    pub def: NameDef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub range: Option<SheetRect>,
}

/// A row of the Name Manager: the name and its current value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct NameRow {
    #[serde(flatten)]
    pub info: NameInfo,
    /// The value as the Name Manager shows it: a number, `"text"`, or an
    /// array `{1;2;3}` for a range (shortened with `…`).
    pub value: String,
}

/// Which edges of the selection Create from Selection takes names from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct NameEdges {
    #[serde(default)]
    pub top: bool,
    #[serde(default)]
    pub left: bool,
    #[serde(default)]
    pub bottom: bool,
    #[serde(default)]
    pub right: bool,
}

/// Elements of an array value shown before `…`.
const MAX_PREVIEW_VALUES: usize = 12;

fn preview_scalar(v: &Value) -> String {
    match v {
        Value::Text(t) => format!("\"{t}\""),
        Value::Empty => String::new(),
        v => display_value(v, None),
    }
}

/// The Name Manager's value text of `v`.
pub fn preview_value(v: &Value) -> String {
    let Value::Array(a) = v else {
        return preview_scalar(v);
    };
    let mut out = String::from("{");
    let mut n = 0;
    'rows: for r in 0..a.rows() {
        for c in 0..a.cols() {
            if n == MAX_PREVIEW_VALUES {
                out.push('…');
                break 'rows;
            }
            if c > 0 {
                out.push(',');
            } else if r > 0 {
                out.push(';');
            }
            out.push_str(&preview_scalar(a.get(r, c).unwrap_or(&Value::Empty)));
            n += 1;
        }
    }
    out.push('}');
    out
}

/// Turns a header text into a valid name the way Excel's Create from
/// Selection does: invalid characters (spaces included) become `_`, a
/// name that starts with a digit or would read as a cell reference gets
/// a `_` before / after it. `None` for an empty text.
pub fn name_from_text(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let mut out: String = t
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '_' | '.' | '\\' | '?') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let first = out.chars().next()?;
    if !(first.is_alphabetic() || first == '_' || first == '\\') {
        out.insert(0, '_');
    }
    if !is_valid_name(&out) {
        out.push('_');
    }
    out.truncate(255);
    is_valid_name(&out).then_some(out)
}

impl CalcDocument {
    /// The defined names with their single-area ranges.
    pub fn name_infos(&self) -> Vec<NameInfo> {
        let wb = self.workbook();
        let engine = wb.engine();
        let first = engine.sheets().next().map_or(SheetId(0), |(s, _)| s);
        engine
            .names()
            .iter()
            .zip(wb.names())
            .map(|(entry, def)| {
                let host = match def.scope {
                    NameScope::Sheet(s) => s,
                    NameScope::Workbook => first,
                };
                let range = engine.name_range(entry, host).map(|r| SheetRect {
                    sheet: r.sheet.0,
                    r0: r.r0,
                    c0: r.c0,
                    r1: r.r1,
                    c1: r.c1,
                });
                NameInfo {
                    def: NameDef::from_model(&def),
                    range,
                }
            })
            .collect()
    }

    /// The `names` request: every name with its value evaluated on
    /// `sheet` (sheet names on their own sheet).
    pub fn name_rows(&self, sheet: u32) -> Result<Vec<NameRow>> {
        let s = self.sheet(sheet)?;
        let engine = self.workbook().engine();
        Ok(self
            .name_infos()
            .into_iter()
            .zip(engine.names())
            .map(|(info, entry)| {
                let at = match entry.scope {
                    NameScope::Sheet(own) => own,
                    NameScope::Workbook => s,
                };
                let value = preview_value(&engine.name_value(entry, CellCoord::new(at, 0, 0)));
                NameRow { info, value }
            })
            .collect())
    }

    /// The `nameAt` request: the name the Name Box shows for a selection
    /// that is exactly a named range (a name of the sheet first, then a
    /// workbook name; hidden names are skipped).
    pub fn name_at(&self, sheet: u32, rect: Rect) -> Result<Option<String>> {
        let s = self.sheet(sheet)?;
        let hit = |local: bool| {
            self.name_infos().into_iter().find(|n| {
                let scope_ok = if local {
                    n.def.sheet == Some(s.0)
                } else {
                    n.def.sheet.is_none()
                };
                scope_ok
                    && !n.def.hidden
                    && n.range.is_some_and(|r| {
                        r.sheet == sheet
                            && (r.r0, r.c0, r.r1, r.c1) == (rect.r0, rect.c0, rect.r1, rect.c1)
                    })
            })
        };
        Ok(hit(true).or_else(|| hit(false)).map(|n| n.def.name))
    }

    /// The `precedents` request: the cells and ranges the formula in the
    /// cell reads directly (through its names too).
    pub fn precedents(&self, sheet: u32, row: u32, col: u32) -> Result<Vec<SheetRect>> {
        let c = CellCoord::new(self.sheet(sheet)?, row, col);
        Ok(self
            .workbook()
            .engine()
            .precedents(c)
            .into_iter()
            .map(|r| SheetRect {
                sheet: r.sheet.0,
                r0: r.r0,
                c0: r.c0,
                r1: r.r1,
                c1: r.c1,
            })
            .collect())
    }

    /// The `dependents` request: the formula cells reading the cell.
    pub fn dependents(&self, sheet: u32, row: u32, col: u32) -> Result<Vec<SheetRect>> {
        let c = CellCoord::new(self.sheet(sheet)?, row, col);
        Ok(self
            .workbook()
            .engine()
            .dependents(c)
            .into_iter()
            .map(|d| SheetRect {
                sheet: d.sheet.0,
                r0: d.row,
                c0: d.col,
                r1: d.row,
                c1: d.col,
            })
            .collect())
    }

    /// The name commands. Every inverse is `RestoreNames` with the list
    /// before the command (exact undo).
    pub(crate) fn names_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        let before: Vec<NameDef> = self
            .workbook()
            .names()
            .iter()
            .map(NameDef::from_model)
            .collect();
        let recalc = match cmd {
            C::DefineName { def } => {
                self.check_scope(def.sheet)?;
                self.workbook_mut().define_name(&def.to_model())?
            }
            C::UpdateName { name, sheet, def } => {
                self.check_scope(def.sheet)?;
                self.workbook_mut()
                    .update_name(name, scope_of(*sheet), &def.to_model())?
            }
            C::DeleteName { name, sheet } => {
                self.workbook_mut().delete_name(name, scope_of(*sheet))?.2
            }
            C::RestoreNames { names } => {
                let list: Vec<DefinedName> = names.iter().map(NameDef::to_model).collect();
                self.workbook_mut().set_names(&list)?
            }
            C::CreateNamesFromSelection {
                sheet,
                r0,
                c0,
                r1,
                c1,
                edges,
            } => {
                let range = self.range(*sheet, *r0, *c0, *r1, *c1)?;
                let defs = self.names_from_selection(range, *edges)?;
                let wb = self.workbook_mut();
                wb.begin_batch();
                let mut result = Ok(());
                for d in &defs {
                    let r = match wb.name(&d.name, d.scope) {
                        Some(old) => wb.update_name(&old.name, old.scope, d),
                        None => wb.define_name(d),
                    };
                    if let Err(e) = r {
                        result = Err(e);
                        break;
                    }
                }
                let recalc = wb.end_batch();
                if let Err(e) = result {
                    let list: Vec<DefinedName> = before.iter().map(NameDef::to_model).collect();
                    let _ = self.workbook_mut().set_names(&list);
                    return Err(e.into());
                }
                recalc
            }
            _ => unreachable!("not a name command: {cmd:?}"),
        };
        Ok(app_common::Applied {
            patch: self.content_patch([], &recalc),
            inverse: Some(C::RestoreNames { names: before }),
        })
    }

    fn check_scope(&self, sheet: Option<u32>) -> Result<()> {
        if let Some(s) = sheet {
            self.sheet(s)?;
        }
        Ok(())
    }

    /// The names Create from Selection makes for `range`.
    fn names_from_selection(
        &self,
        range: model_sheet::CellRange,
        edges: NameEdges,
    ) -> Result<Vec<DefinedName>> {
        let wb = self.workbook();
        let s = range.sheet;
        let prefix = sheet_prefix(wb.engine().sheet_name(s).unwrap_or_default());
        let text = |row: u32, col: u32| {
            let c = CellCoord::new(s, row, col);
            let v = wb.value(c);
            let shown = display_value(&v, wb.style(c).number_format.as_deref());
            name_from_text(&shown)
        };
        // The data area: the range without the label rows/columns.
        let r0 = range.r0 + u32::from(edges.top);
        let r1 = range.r1.saturating_sub(u32::from(edges.bottom));
        let c0 = range.c0 + u32::from(edges.left);
        let c1 = range.c1.saturating_sub(u32::from(edges.right));
        if r0 > r1 || c0 > c1 {
            return Err(CalcError::NothingToName);
        }
        let mut out: Vec<DefinedName> = Vec::new();
        let mut push = |name: Option<String>, area: (u32, u32, u32, u32)| {
            let Some(name) = name else { return };
            let refers = format!("{prefix}{}", abs_area(area.0, area.1, area.2, area.3));
            let def = DefinedName::new(&name, NameScope::Workbook, &refers);
            match out
                .iter_mut()
                .find(|d| d.name.to_lowercase() == name.to_lowercase())
            {
                Some(slot) => *slot = def,
                None => out.push(def),
            }
        };
        for (on, row) in [(edges.top, range.r0), (edges.bottom, range.r1)] {
            if on {
                for col in c0..=c1 {
                    push(text(row, col), (r0, col, r1, col));
                }
            }
        }
        for (on, col) in [(edges.left, range.c0), (edges.right, range.c1)] {
            if on {
                for row in r0..=r1 {
                    push(text(row, col), (row, c0, row, c1));
                }
            }
        }
        if out.is_empty() {
            return Err(CalcError::NothingToName);
        }
        Ok(out)
    }

    /// Reports the name list in `patch` and makes undo restore it when a
    /// command other than a name command changed it (structural edits and
    /// sheet renames/deletes rewrite definitions; deleting a sheet drops
    /// its names).
    pub(crate) fn mark_names(
        &self,
        before: Vec<DefinedName>,
        cmd: &CalcCommand,
        applied: &mut CalcApplied,
    ) {
        let after = self.workbook().names();
        if after == before {
            return;
        }
        applied.patch.names = Some(self.name_infos());
        let names_cmd = matches!(
            cmd,
            CalcCommand::DefineName { .. }
                | CalcCommand::UpdateName { .. }
                | CalcCommand::DeleteName { .. }
                | CalcCommand::RestoreNames { .. }
                | CalcCommand::CreateNamesFromSelection { .. }
        );
        if names_cmd {
            return;
        }
        let restore = CalcCommand::RestoreNames {
            names: before.iter().map(NameDef::from_model).collect(),
        };
        applied.inverse = Some(match applied.inverse.take() {
            Some(inv) => CalcCommand::Compound {
                commands: vec![inv, restore],
            },
            None => restore,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_header_texts() {
        assert_eq!(name_from_text("Sales 2024").as_deref(), Some("Sales_2024"));
        assert_eq!(name_from_text("2024").as_deref(), Some("_2024"));
        assert_eq!(name_from_text("A1").as_deref(), Some("A1_"));
        assert_eq!(name_from_text("R2").as_deref(), Some("R2_"));
        assert_eq!(
            name_from_text("Net-Profit (€)").as_deref(),
            Some("Net_Profit____")
        );
        assert_eq!(name_from_text("  "), None);
        assert_eq!(name_from_text("Übersicht").as_deref(), Some("Übersicht"));
    }

    #[test]
    fn value_previews() {
        use engine_formula::Array;
        assert_eq!(preview_value(&Value::Number(0.19)), "0.19");
        assert_eq!(preview_value(&Value::Text("x".into())), "\"x\"");
        let a = Array::new(
            2,
            2,
            vec![
                Value::Number(1.0),
                Value::Text("a".into()),
                Value::Bool(true),
                Value::Empty,
            ],
        )
        .unwrap();
        assert_eq!(preview_value(&Value::Array(a)), "{1,\"a\";TRUE,}");
        let long = Array::new(
            20,
            1,
            (0..20).map(|i| Value::Number(f64::from(i))).collect(),
        )
        .unwrap();
        assert!(preview_value(&Value::Array(long)).ends_with("11…}"));
    }
}
