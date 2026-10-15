//! A tiny read-eval-print loop on top of [`engine_formula::Engine`].
//!
//! ```text
//! cargo run -p engine-formula --example repl
//! > =SUM(1,2,3)*2
//! 12
//! > A1 = 5
//! 5
//! > B1 = =A1*2
//! 10
//! ```
//!
//! Type `:help` for the commands.

use std::collections::BTreeSet;
use std::io::{self, BufRead, IsTerminal, Write};

use engine_formula::ast::{col_to_letters, CellRef};
use engine_formula::value::{format_general, to_text};
use engine_formula::{CellCoord, Engine, EngineError, Recalc, Value};

const HELP: &str = "\
=FORMULA          evaluate a formula in a scratch cell (Sheet1!ZZ1)
A1 = 5            assign a cell (text right of the first `=`, verbatim)
B2 = =A1*2        assign a formula
Sheet2!C3 = hi    assign a cell on another sheet
:sheet Name       add a sheet
:show             print all non-empty cells
:help             this text
:q                quit";

/// Scratch cell `ZZ1` (column index 701, row 0) on the first sheet.
const SCRATCH_COL: u32 = 701;

struct Repl {
    engine: Engine,
    /// Cells assigned through the REPL (the engine has no cell iterator).
    assigned: BTreeSet<CellCoord>,
}

fn main() {
    let mut repl = Repl {
        engine: Engine::new(),
        assigned: BTreeSet::new(),
    };
    let tty = io::stdin().is_terminal();
    let stdin = io::stdin();
    let mut out = io::stdout();
    let mut lines = stdin.lock().lines();
    loop {
        if tty {
            let _ = write!(out, "> ");
            let _ = out.flush();
        }
        let Some(Ok(line)) = lines.next() else { break };
        let line = line.trim_end_matches('\r');
        if line.trim() == ":q" {
            break;
        }
        for l in repl.handle(line) {
            let _ = writeln!(out, "{l}");
        }
        let _ = out.flush();
    }
}

impl Repl {
    fn handle(&mut self, line: &str) -> Vec<String> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        if trimmed == ":help" {
            return vec![HELP.to_string()];
        }
        if trimmed == ":show" {
            return self.show();
        }
        if let Some(rest) = trimmed.strip_prefix(":sheet") {
            let name = rest.trim();
            if name.is_empty() {
                return vec!["error: usage: :sheet Name".to_string()];
            }
            return match self.engine.add_sheet(name) {
                Ok(_) => vec![format!("added sheet {name}")],
                Err(e) => vec![format!("error: {e}")],
            };
        }
        if trimmed.starts_with(':') {
            return vec![format!("error: unknown command `{trimmed}` (try :help)")];
        }
        if trimmed.starts_with('=') {
            return self.evaluate(line, trimmed);
        }
        if let Some(eq) = line.find('=') {
            if let Some(cell) = self.parse_target(line[..eq].trim()) {
                let raw = &line[eq + 1..];
                let text = raw.trim();
                let offset = eq + 1 + (raw.len() - raw.trim_start().len());
                return self.assign(cell, text, line, offset);
            }
        }
        vec![format!(
            "error: expected `=formula` or `CELL = value`, got `{trimmed}`"
        )]
    }

    /// Evaluates a formula in the scratch cell and clears it again.
    fn evaluate(&mut self, line: &str, formula: &str) -> Vec<String> {
        let offset = line.len() - line.trim_start().len();
        let sheet = self.engine.sheets().next().map(|(id, _)| id).unwrap();
        let scratch = CellCoord::new(sheet, 0, SCRATCH_COL);
        match self.engine.set_input(scratch, formula) {
            Ok(recalc) => {
                let shown = self.display(scratch, &recalc);
                let _ = self.engine.clear(scratch);
                vec![shown]
            }
            Err(e) => error_lines(&e, line, offset),
        }
    }

    fn assign(&mut self, cell: CellCoord, text: &str, line: &str, offset: usize) -> Vec<String> {
        match self.engine.set_input(cell, text) {
            Ok(recalc) => {
                if text.is_empty() {
                    self.assigned.remove(&cell);
                } else {
                    self.assigned.insert(cell);
                }
                let mut shown = self.display(cell, &recalc);
                let also: Vec<String> = recalc
                    .changed
                    .iter()
                    .filter(|&&c| c != cell)
                    .map(|&c| {
                        format!(
                            "{}={}",
                            self.name(c, Some(cell.sheet)),
                            self.display(c, &recalc)
                        )
                    })
                    .collect();
                if !also.is_empty() {
                    shown.push_str(&format!(" (also: {})", also.join(", ")));
                }
                vec![shown]
            }
            Err(e) => error_lines(&e, line, offset),
        }
    }

    /// The value of `c`, with the cycle path appended if `c` is on it.
    fn display(&self, c: CellCoord, recalc: &Recalc) -> String {
        let text = format_value(&self.engine.value(c));
        match &recalc.cycle {
            Some(cycle) if cycle.cells.contains(&c) => {
                let mut path: Vec<String> = cycle
                    .cells
                    .iter()
                    .map(|&x| self.name(x, Some(c.sheet)))
                    .collect();
                path.push(path[0].clone());
                format!("{text} (circular: {})", path.join(" -> "))
            }
            _ => text,
        }
    }

    /// `A1`, or `Sheet!A1` when the sheet differs from `relative_to`.
    fn name(&self, c: CellCoord, relative_to: Option<engine_formula::SheetId>) -> String {
        let a1 = format!("{}{}", col_to_letters(c.col), c.row + 1);
        if relative_to == Some(c.sheet) {
            a1
        } else {
            let sheet = self.engine.sheet_name(c.sheet).unwrap_or("?");
            format!("{sheet}!{a1}")
        }
    }

    /// Parses `A1`, `$B$2` or `Sheet2!C3` / `'My Sheet'!C3` (default `Sheet1`).
    fn parse_target(&self, s: &str) -> Option<CellCoord> {
        let (sheet_name, cell) = match s.rsplit_once('!') {
            Some((sheet, cell)) => {
                let sheet = sheet.trim();
                let sheet = sheet
                    .strip_prefix('\'')
                    .and_then(|x| x.strip_suffix('\''))
                    .map_or_else(|| sheet.to_string(), |x| x.replace("''", "'"));
                (sheet, cell.trim())
            }
            None => ("Sheet1".to_string(), s),
        };
        let r = CellRef::parse(cell).ok()?;
        self.engine
            .sheet_id(&sheet_name)
            .map(|id| CellCoord::new(id, r.row, r.col))
    }

    fn show(&self) -> Vec<String> {
        let mut lines = Vec::new();
        for &c in &self.assigned {
            let value = format_value(&self.engine.value(c));
            let name = self.name(c, None);
            match self.engine.formula_text(c) {
                Some(f) => lines.push(format!("{name} = {value}    ({f})")),
                None => lines.push(format!("{name} = {value}")),
            }
        }
        if lines.is_empty() {
            lines.push("(no cells)".to_string());
        }
        lines
    }
}

/// Excel General rendering; errors as their literal (`#DIV/0!`).
fn format_value(v: &Value) -> String {
    match v {
        Value::Number(n) => format_general(*n),
        other => match to_text(other) {
            Ok(s) => s,
            Err(e) => e.to_string(),
        },
    }
}

/// `error: <message> at <pos>` plus the input with a caret under `pos`.
fn error_lines(e: &EngineError, line: &str, offset: usize) -> Vec<String> {
    match e {
        EngineError::Parse(p) => {
            let at = offset + p.pos;
            let col = line.char_indices().take_while(|&(i, _)| i < at).count();
            vec![
                format!("error: {} at {}", p.message, p.pos),
                line.to_string(),
                format!("{}^", " ".repeat(col)),
            ]
        }
        other => vec![format!("error: {other}")],
    }
}
