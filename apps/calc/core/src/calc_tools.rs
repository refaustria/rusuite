//! Formulas › Calculation (P9-C4): the calculation options (Automatic /
//! Automatic except for data tables / Manual, R1C1 reference style),
//! Calculate Now / Calculate Sheet, and the name tools Apply Names and
//! Paste Names › Paste List.

use engine_formula::ast::{Expr, RangeKind};
use engine_formula::{NameScope, RangeRef};
use model_sheet::{CalcMode, CalcSettings};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::CalcCommand;
use crate::doc::{CalcApplied, CalcDocument, Result};
use crate::patch::CalcPatch;

/// Formulas › Calculation Options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub enum CalcModeWire {
    #[default]
    Automatic,
    AutomaticNoTables,
    Manual,
}

impl From<CalcMode> for CalcModeWire {
    fn from(m: CalcMode) -> Self {
        match m {
            CalcMode::Automatic => CalcModeWire::Automatic,
            CalcMode::AutomaticNoTables => CalcModeWire::AutomaticNoTables,
            CalcMode::Manual => CalcModeWire::Manual,
        }
    }
}

impl From<CalcModeWire> for CalcMode {
    fn from(m: CalcModeWire) -> Self {
        match m {
            CalcModeWire::Automatic => CalcMode::Automatic,
            CalcModeWire::AutomaticNoTables => CalcMode::AutomaticNoTables,
            CalcModeWire::Manual => CalcMode::Manual,
        }
    }
}

/// The calculation options of the workbook (saved in `<calcPr>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CalcOptions {
    pub mode: CalcModeWire,
    /// `fullCalcOnLoad`: other applications recalculate on open.
    pub full_calc_on_load: bool,
    /// R1C1 reference style (display and entry only).
    pub r1c1: bool,
}

impl From<CalcSettings> for CalcOptions {
    fn from(s: CalcSettings) -> Self {
        CalcOptions {
            mode: s.mode.into(),
            full_calc_on_load: s.full_calc_on_load,
            r1c1: s.r1c1,
        }
    }
}

impl From<CalcOptions> for CalcSettings {
    fn from(o: CalcOptions) -> Self {
        CalcSettings {
            mode: o.mode.into(),
            full_calc_on_load: o.full_calc_on_load,
            r1c1: o.r1c1,
        }
    }
}

/// The calculation state the UI shows: the options and whether manual
/// mode has cells awaiting recalculation ("Calculate" in the status bar).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CalcState {
    pub options: CalcOptions,
    pub needs_calc: bool,
}

impl CalcDocument {
    /// The current [`CalcState`].
    pub fn calc_state(&self) -> CalcState {
        CalcState {
            options: self.workbook().calc_settings().into(),
            needs_calc: self.workbook().needs_calc(),
        }
    }

    /// After any command: the patch carries the calculation state when it
    /// changed.
    pub(crate) fn mark_calc(&self, before: CalcState, applied: &mut CalcApplied) {
        let after = self.calc_state();
        if after != before {
            applied.patch.calc = Some(after);
        }
    }

    /// The calculation commands.
    pub(crate) fn calc_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        match cmd {
            C::SetCalcOptions { options } => {
                let before: CalcOptions = self.workbook().calc_settings().into();
                let recalc = self.workbook_mut().set_calc_settings((*options).into());
                Ok(app_common::Applied {
                    patch: self.content_patch([], &recalc),
                    inverse: Some(C::SetCalcOptions { options: before }),
                })
            }
            C::CalculateNow => {
                let recalc = self.workbook_mut().calculate_now();
                Ok(app_common::Applied {
                    patch: self.content_patch([], &recalc),
                    inverse: None,
                })
            }
            C::CalculateSheet { sheet } => {
                let s = self.sheet(*sheet)?;
                let recalc = self.workbook_mut().calculate_sheet(s);
                Ok(app_common::Applied {
                    patch: self.content_patch([], &recalc),
                    inverse: None,
                })
            }
            &C::ApplyNames {
                sheet,
                r0,
                c0,
                r1,
                c1,
                ref names,
                ignore_relative,
            } => self.apply_names(sheet, (r0, c0, r1, c1), names, ignore_relative),
            &C::PasteNameList { sheet, row, col } => self.paste_name_list(sheet, row, col),
            C::ConvertToNumber { sheet, cells } => self.convert_to_number(*sheet, cells),
            _ => unreachable!("not a calculation command: {cmd:?}"),
        }
    }

    /// Runs `SetInput` commands as one undo step.
    fn set_inputs(&mut self, inputs: Vec<(u32, u32, u32, String)>) -> Result<CalcApplied> {
        let mut patch = CalcPatch::default();
        let mut inverses = Vec::new();
        for (sheet, row, col, input) in inputs {
            let applied = self.apply_cmd(&CalcCommand::SetInput {
                sheet,
                row,
                col,
                input,
            })?;
            app_common::Patch::merge(&mut patch, applied.patch);
            inverses.extend(applied.inverse);
        }
        inverses.reverse();
        Ok(app_common::Applied {
            patch,
            inverse: Some(CalcCommand::Compound { commands: inverses }),
        })
    }

    /// Formulas › Define Name › Apply Names: in the formulas of the range
    /// (a single cell: the whole sheet, as Excel), references equal to the
    /// range of one of `names` become that name. `ignore_relative` (Excel's
    /// default) matches whatever the `$` flags; otherwise only absolute
    /// references match. Only names visible from the sheet are applied.
    fn apply_names(
        &mut self,
        sheet: u32,
        (r0, c0, r1, c1): (u32, u32, u32, u32),
        names: &[String],
        ignore_relative: bool,
    ) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let whole = r0 == r1 && c0 == c1;
        let area = if whole {
            None
        } else {
            Some(self.range(sheet, r0, c0, r1, c1)?)
        };
        let wb = self.workbook();
        let engine = wb.engine();
        // (name, range) of the chosen names visible from `s`.
        let mut targets: Vec<(String, RangeRef)> = Vec::new();
        for want in names {
            let entry = engine
                .names()
                .iter()
                .find(|n| n.scope == NameScope::Sheet(s) && n.name.eq_ignore_ascii_case(want))
                .or_else(|| {
                    engine.names().iter().find(|n| {
                        n.scope == NameScope::Workbook && n.name.eq_ignore_ascii_case(want)
                    })
                });
            if let Some(entry) = entry {
                if let Some(r) = engine.name_range(entry, s) {
                    targets.push((entry.name.clone(), r));
                }
            }
        }
        let mut inputs = Vec::new();
        for (c, content) in engine.cells(s) {
            let model_sheet::CellContent::Formula { ast, .. } = content else {
                continue;
            };
            if area.is_some_and(|a| !a.contains(c)) {
                continue;
            }
            let rewritten = engine_formula::engine::map_expr(ast, &|e| {
                let Expr::Reference(r) = e else {
                    return None;
                };
                if r.is_3d() {
                    return None;
                }
                let on = match &r.sheet {
                    None => s,
                    Some(n) => engine.sheet_id(n)?,
                };
                let abs = match r.kind {
                    RangeKind::Cell(a) => a.row_abs && a.col_abs,
                    RangeKind::Area(a, b) => a.row_abs && a.col_abs && b.row_abs && b.col_abs,
                    _ => false,
                };
                if !ignore_relative && !abs {
                    return None;
                }
                let rr = match r.kind {
                    RangeKind::Cell(a) => RangeRef::new(on, a.row, a.col, a.row, a.col),
                    RangeKind::Area(a, b) => RangeRef::new(on, a.row, a.col, b.row, b.col),
                    _ => return None,
                };
                targets
                    .iter()
                    .find(|(_, t)| *t == rr)
                    .map(|(n, _)| Expr::Name(n.clone()))
            });
            if &rewritten != ast {
                inputs.push((sheet, c.row, c.col, format!("={rewritten}")));
            }
        }
        inputs.sort();
        self.set_inputs(inputs)
    }

    /// Formulas › Use in Formula › Paste Names › Paste List: the names
    /// visible from the sheet (hidden ones left out), alphabetically, with
    /// their definitions as text, from `(row, col)` down.
    fn paste_name_list(&mut self, sheet: u32, row: u32, col: u32) -> Result<CalcApplied> {
        let s = self.sheet(sheet)?;
        let mut list: Vec<(String, String)> = self
            .workbook()
            .names()
            .into_iter()
            .filter(|n| !n.hidden && n.builtin.is_none())
            .filter(|n| matches!(n.scope, NameScope::Workbook) || n.scope == NameScope::Sheet(s))
            .map(|n| (n.name, n.refers_to))
            .collect();
        list.sort_by_key(|(n, _)| n.to_lowercase());
        let mut inputs = Vec::with_capacity(list.len() * 2);
        for (i, (name, refers)) in list.into_iter().enumerate() {
            let r = row.saturating_add(i as u32);
            inputs.push((sheet, r, col, format!("'{name}")));
            inputs.push((sheet, r, col.saturating_add(1), format!("'={refers}")));
        }
        self.set_inputs(inputs)
    }
}
