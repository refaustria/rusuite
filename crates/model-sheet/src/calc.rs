//! Calculation settings (Formulas › Calculation Options and File ›
//! Options › Formulas): the calculation mode, whether a reader should
//! recalculate on load, and the R1C1 reference style. Saved in
//! `<calcPr calcMode fullCalcOnLoad refMode>`.

use serde::{Deserialize, Serialize};

use crate::workbook::Workbook;
use engine_formula::Recalc;

/// Formulas › Calculation Options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalcMode {
    /// Recalculate after every change.
    #[default]
    Automatic,
    /// Automatic except for data tables (Rusuite has no What-If data
    /// tables, so this calculates like `Automatic`; it is kept for Excel).
    AutomaticNoTables,
    /// Recalculate only on Calculate Now (F9) / Calculate Sheet (Shift+F9).
    Manual,
}

impl CalcMode {
    /// The `calcMode` attribute value (`auto`, `autoNoTable`, `manual`).
    pub fn file_name(self) -> &'static str {
        match self {
            CalcMode::Automatic => "auto",
            CalcMode::AutomaticNoTables => "autoNoTable",
            CalcMode::Manual => "manual",
        }
    }

    /// Reads a `calcMode` attribute value (unknown: automatic).
    pub fn from_file_name(s: &str) -> CalcMode {
        match s {
            "manual" => CalcMode::Manual,
            "autoNoTable" => CalcMode::AutomaticNoTables,
            _ => CalcMode::Automatic,
        }
    }
}

/// The workbook's calculation settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalcSettings {
    #[serde(default)]
    pub mode: CalcMode,
    /// `fullCalcOnLoad`: a reader recalculates every formula on load
    /// (Rusuite writes its own results; on by default for safety).
    #[serde(default = "yes")]
    pub full_calc_on_load: bool,
    /// File › Options › Formulas › R1C1 reference style (display and
    /// entry only; `refMode="R1C1"`).
    #[serde(default)]
    pub r1c1: bool,
}

fn yes() -> bool {
    true
}

impl Default for CalcSettings {
    fn default() -> Self {
        CalcSettings {
            mode: CalcMode::Automatic,
            full_calc_on_load: true,
            r1c1: false,
        }
    }
}

impl CalcSettings {
    /// Whether these are the defaults (nothing to save in a snapshot).
    pub fn is_default(&self) -> bool {
        *self == CalcSettings::default()
    }
}

impl Workbook {
    /// The calculation settings.
    pub fn calc_settings(&self) -> CalcSettings {
        self.calc
    }

    /// Replaces the calculation settings; switching to manual stops
    /// automatic recalculation, switching back recalculates what is
    /// pending.
    pub fn set_calc_settings(&mut self, settings: CalcSettings) -> Recalc {
        self.calc = settings;
        self.engine_mut()
            .set_manual(settings.mode == CalcMode::Manual)
    }

    /// Calculate Now (F9).
    pub fn calculate_now(&mut self) -> Recalc {
        self.engine_mut().calculate_now()
    }

    /// Calculate Sheet (Shift+F9).
    pub fn calculate_sheet(&mut self, sheet: engine_formula::SheetId) -> Recalc {
        self.engine_mut().calculate_sheet(sheet)
    }

    /// Manual mode with cells awaiting recalculation.
    pub fn needs_calc(&self) -> bool {
        self.engine().needs_calc()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_formula::{CellCoord, Value};

    #[test]
    fn manual_mode_through_the_workbook() {
        let mut wb = Workbook::new();
        let s = wb.sheet_id("Sheet1").unwrap();
        wb.set_input(CellCoord::new(s, 0, 0), "1").unwrap();
        wb.set_input(CellCoord::new(s, 0, 1), "=A1+1").unwrap();
        wb.set_calc_settings(CalcSettings {
            mode: CalcMode::Manual,
            ..Default::default()
        });
        wb.set_input(CellCoord::new(s, 0, 0), "2").unwrap();
        assert!(wb.needs_calc());
        assert_eq!(wb.value(CellCoord::new(s, 0, 1)), Value::Number(2.0));
        wb.calculate_now();
        assert_eq!(wb.value(CellCoord::new(s, 0, 1)), Value::Number(3.0));
        // The snapshot keeps the settings.
        let back = Workbook::from_snapshot(&wb.to_snapshot()).unwrap();
        assert_eq!(back.calc_settings().mode, CalcMode::Manual);
        assert!(back.engine().is_manual());
        assert_eq!(back.value(CellCoord::new(s, 0, 1)), Value::Number(3.0));
        assert_eq!(
            CalcMode::from_file_name("autoNoTable"),
            CalcMode::AutomaticNoTables
        );
        assert_eq!(CalcMode::Manual.file_name(), "manual");
    }
}
