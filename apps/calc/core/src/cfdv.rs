//! Conditional formatting and data validation: the rule commands, their
//! inverses, and the queries behind `validateInput`, `listValues` and
//! `sheetRules` (P8-11).

use app_common::Applied;
use engine_formula::RangeRef;
use model_sheet::{CellCoord, CfRule, DataValidation, SheetId, ValidationResult};

use crate::command::{CalcCommand, Rect};
use crate::doc::{CalcApplied, CalcDocument, Result};
use crate::patch::{CalcPatch, CellCf};

/// The rules and validations of every sheet, in sheet order.
pub(crate) type RulesState = Vec<(SheetId, Vec<CfRule>, Vec<DataValidation>)>;

impl CalcDocument {
    /// Applies one of the rule commands (see [`CalcCommand::AddCfRule`]
    /// and the following variants).
    pub(crate) fn rules_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        let sheet = match cmd {
            C::AddCfRule { sheet, .. }
            | C::UpdateCfRule { sheet, .. }
            | C::RemoveCfRule { sheet, .. }
            | C::ReorderCfRule { sheet, .. }
            | C::ClearCf { sheet, .. }
            | C::SetValidation { sheet, .. }
            | C::RemoveValidation { sheet, .. }
            | C::RestoreCfRules { sheet, .. }
            | C::RestoreValidations { sheet, .. } => *sheet,
            _ => unreachable!("not a rule command: {cmd:?}"),
        };
        let s = self.sheet(sheet)?;
        let rules_before = || self.workbook().cf_rules(s).to_vec();
        let validations_before = || self.workbook().validations(s).to_vec();
        let inverse = match cmd {
            C::AddCfRule { rule, .. } => {
                let id = self.workbook_mut().add_cf_rule(s, rule.clone())?;
                C::RemoveCfRule { sheet, id }
            }
            C::UpdateCfRule { rule, .. } => {
                let old = self.workbook_mut().update_cf_rule(s, rule.clone())?;
                C::UpdateCfRule { sheet, rule: old }
            }
            &C::RemoveCfRule { id, .. } => {
                let old = self.workbook_mut().remove_cf_rule(s, id)?;
                C::AddCfRule { sheet, rule: old }
            }
            &C::ReorderCfRule { id, priority, .. } => {
                let old = self.workbook_mut().move_cf_rule(s, id, priority)?;
                C::ReorderCfRule {
                    sheet,
                    id,
                    priority: old,
                }
            }
            &C::ClearCf { range, .. } => {
                let before = rules_before();
                match range {
                    None => self.workbook_mut().set_cf_rules(s, Vec::new())?,
                    Some(r) => {
                        let range = self.rect_range(sheet, r)?;
                        self.workbook_mut().clear_cf(range)?;
                    }
                }
                C::RestoreCfRules {
                    sheet,
                    rules: before,
                }
            }
            C::RestoreCfRules { rules, .. } => {
                let before = rules_before();
                self.workbook_mut().set_cf_rules(s, rules.clone())?;
                C::RestoreCfRules {
                    sheet,
                    rules: before,
                }
            }
            C::SetValidation { validation, .. } => {
                let before = validations_before();
                self.workbook_mut().set_validation(s, validation.clone())?;
                C::RestoreValidations {
                    sheet,
                    validations: before,
                }
            }
            &C::RemoveValidation { range, .. } => {
                let before = validations_before();
                let range = self.rect_range(sheet, range)?;
                self.workbook_mut().remove_validation(range)?;
                C::RestoreValidations {
                    sheet,
                    validations: before,
                }
            }
            C::RestoreValidations { validations, .. } => {
                let before = validations_before();
                self.workbook_mut()
                    .set_validations(s, validations.clone())?;
                C::RestoreValidations {
                    sheet,
                    validations: before,
                }
            }
            _ => unreachable!("not a rule command: {cmd:?}"),
        };
        Ok(Applied {
            patch: CalcPatch {
                cf_sheets: vec![sheet],
                ..Default::default()
            },
            inverse: Some(inverse),
        })
    }

    fn rect_range(&self, sheet: u32, r: Rect) -> Result<RangeRef> {
        self.range(sheet, r.r0, r.c0, r.r1, r.c1)
    }

    /// Commands that bring back the rules and validations of `s` (the
    /// undo of deleting the sheet); empty without any.
    pub(crate) fn rules_inverse(&self, s: SheetId) -> Vec<CalcCommand> {
        let wb = self.workbook();
        let mut out = Vec::new();
        if !wb.cf_rules(s).is_empty() {
            out.push(CalcCommand::RestoreCfRules {
                sheet: s.0,
                rules: wb.cf_rules(s).to_vec(),
            });
        }
        if !wb.validations(s).is_empty() {
            out.push(CalcCommand::RestoreValidations {
                sheet: s.0,
                validations: wb.validations(s).to_vec(),
            });
        }
        out
    }

    /// The rules and validations of every sheet.
    pub(crate) fn rules_state(&self) -> RulesState {
        let wb = self.workbook();
        wb.sheets()
            .into_iter()
            .map(|(s, _)| (s, wb.cf_rules(s).to_vec(), wb.validations(s).to_vec()))
            .collect()
    }

    /// After a command that does not report its own rule changes (paste,
    /// cut, sort, …): the restore of the rules and validations that
    /// changed is appended to the inverse and their sheets are marked.
    pub(crate) fn mark_rules(&self, before: Option<RulesState>, applied: &mut CalcApplied) {
        let Some(before) = before else { return };
        let (restore, sheets) = self.rules_changed(before);
        if restore.is_empty() {
            return;
        }
        crate::tables::append_inverse(applied, restore);
        for s in sheets {
            if !applied.patch.cf_sheets.contains(&s) {
                applied.patch.cf_sheets.push(s);
            }
        }
    }

    /// Copies (or, for a cut, moves) the rules of a pasted block with its
    /// cells (see [`model_sheet::Workbook::copy_rules`]).
    pub(crate) fn paste_rules(
        &mut self,
        src: RangeRef,
        dst: SheetId,
        origin: (u32, u32),
        repeats: (u32, u32),
        cut: bool,
        what: model_sheet::RulesPaste,
    ) -> Result<()> {
        if cut {
            self.workbook_mut().move_rules(src, dst, origin)?;
        } else if what.cf || what.validation {
            self.workbook_mut()
                .copy_rules(src, dst, origin, repeats, what)?;
        }
        Ok(())
    }

    /// After a structural edit: the commands restoring the rules and
    /// validations that changed since `before`, and the changed sheets.
    pub(crate) fn rules_changed(&self, before: RulesState) -> (Vec<CalcCommand>, Vec<u32>) {
        let wb = self.workbook();
        let mut restore = Vec::new();
        let mut sheets = Vec::new();
        for (s, rules, validations) in before {
            if wb.engine().sheet_name(s).is_none() {
                continue; // deleted: the sheet's restore brings them back
            }
            let mut changed = false;
            if wb.cf_rules(s) != rules.as_slice() {
                restore.push(CalcCommand::RestoreCfRules { sheet: s.0, rules });
                changed = true;
            }
            if wb.validations(s) != validations.as_slice() {
                restore.push(CalcCommand::RestoreValidations {
                    sheet: s.0,
                    validations,
                });
                changed = true;
            }
            if changed {
                sheets.push(s.0);
            }
        }
        (restore, sheets)
    }

    /// Adds every sheet with conditional formatting to `patch.cf_sheets`
    /// when cells changed or rows/columns moved: rule results can depend on
    /// any cell (formulas, top N, averages, duplicates).
    pub(crate) fn mark_cf_sheets(&self, patch: &mut CalcPatch) {
        if patch.cells.is_empty() && patch.structural.is_empty() {
            return;
        }
        let wb = self.workbook();
        for (s, _) in wb.sheets() {
            if !wb.cf_rules(s).is_empty() && !patch.cf_sheets.contains(&s.0) {
                patch.cf_sheets.push(s.0);
            }
        }
    }

    /// The conditional formatting of the cells of `range`.
    pub(crate) fn region_cf(&self, range: RangeRef) -> Vec<CellCf> {
        self.workbook()
            .effective_cf(range)
            .into_iter()
            .map(|(c, cf)| CellCf {
                row: c.row,
                col: c.col,
                cf,
            })
            .collect()
    }

    /// The `validateInput` request: checks `input` against the cell's data
    /// validation before the UI sends `setInput`.
    pub fn validate_input(
        &self,
        sheet: u32,
        row: u32,
        col: u32,
        input: &str,
    ) -> Result<ValidationResult> {
        let c = self.cell(sheet, row, col)?;
        Ok(self.workbook().validate_input(c, input)?)
    }

    /// The `listValues` request: the dropdown values of the cell's list
    /// validation (empty without one).
    pub fn list_values(&self, sheet: u32, row: u32, col: u32) -> Result<Vec<String>> {
        let c = self.cell(sheet, row, col)?;
        Ok(self.workbook().list_values(c))
    }

    /// The `invalidCells` request (Circle Invalid Data): at most 255 cells,
    /// as Excel.
    pub fn invalid_cells(&self, sheet: u32) -> Result<Vec<crate::Rect>> {
        let s = self.sheet(sheet)?;
        Ok(self
            .workbook()
            .invalid_cells(s, 255)
            .into_iter()
            .map(|c| crate::Rect {
                r0: c.row,
                c0: c.col,
                r1: c.row,
                c1: c.col,
            })
            .collect())
    }

    /// The `sheetRules` request: the conditional formatting rules (priority
    /// order) and data validations of `sheet`.
    pub fn sheet_rules(&self, sheet: u32) -> Result<(Vec<CfRule>, Vec<DataValidation>)> {
        let s = self.sheet(sheet)?;
        let wb = self.workbook();
        Ok((wb.cf_rules(s).to_vec(), wb.validations(s).to_vec()))
    }

    fn cell(&self, sheet: u32, row: u32, col: u32) -> Result<CellCoord> {
        let range = self.range(sheet, row, col, row, col)?;
        Ok(CellCoord::new(range.sheet, row, col))
    }
}
