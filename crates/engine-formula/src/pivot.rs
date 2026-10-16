//! What `GETPIVOTDATA` reads: the visible values of a pivot table
//! ([`PivotData`]), registered by the document model with
//! [`Engine::set_pivot_data`](crate::Engine::set_pivot_data) and looked up
//! through [`CellProvider::pivot_data`](crate::CellProvider::pivot_data).

use crate::eval::{CellCoord, SheetId};
use crate::value::Value;

/// An item as `GETPIVOTDATA` may name it: by value or by its label.
#[derive(Debug, Clone, PartialEq)]
pub struct PivotItemName {
    pub value: Value,
    /// The label the pivot table shows (`"(blank)"` for a blank item).
    pub label: String,
}

impl PivotItemName {
    /// Whether the argument `v` names this item: an equal number or
    /// boolean, or a text equal (ignoring case) to the label or the text
    /// value.
    pub fn matches(&self, v: &Value) -> bool {
        match (v, &self.value) {
            (Value::Number(a), Value::Number(b)) => a == b,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Text(t), _) => {
                t.to_lowercase() == self.label.to_lowercase()
                    || matches!(&self.value, Value::Text(s) if s.to_lowercase() == t.to_lowercase())
            }
            (Value::Number(n), _) => {
                let text = Value::Number(*n);
                crate::value::to_text(&text).is_ok_and(|t| t == self.label)
            }
            _ => false,
        }
    }
}

/// One visible value cell of a pivot table.
#[derive(Debug, Clone, PartialEq)]
pub struct PivotEntry {
    /// Index into [`PivotData::data_names`].
    pub data: usize,
    /// The field/item pairs that identify the cell (empty = the grand
    /// total), field names as in the source.
    pub key: Vec<(String, PivotItemName)>,
    pub value: Value,
}

/// The values of one pivot table.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PivotData {
    /// The cells of the pivot table (inclusive): `GETPIVOTDATA` accepts
    /// any of them as its `pivot_table` argument.
    pub area: (u32, u32, u32, u32),
    /// Per data field the names it answers to (the caption such as
    /// `Sum of Sales`, the source field name `Sales`).
    pub data_names: Vec<Vec<String>>,
    pub entries: Vec<PivotEntry>,
    /// Page (filter) fields with exactly one selected item: they may be
    /// named in a lookup, with that item only.
    pub fixed: Vec<(String, PivotItemName)>,
}

impl PivotData {
    pub fn contains(&self, row: u32, col: u32) -> bool {
        let (r0, c0, r1, c1) = self.area;
        (r0..=r1).contains(&row) && (c0..=c1).contains(&col)
    }

    /// `GETPIVOTDATA`'s rule: the value of the visible cell for data field
    /// `data_field` whose field/item pairs are exactly `pairs` (in any
    /// order; field names ignore case). `None` = no such cell (`#REF!`).
    pub fn lookup(&self, data_field: &str, pairs: &[(String, Value)]) -> Option<Value> {
        let want = data_field.trim().to_lowercase();
        let data = self
            .data_names
            .iter()
            .position(|names| names.iter().any(|n| n.to_lowercase() == want))?;
        let mut rest: Vec<&(String, Value)> = Vec::new();
        for p in pairs {
            let field = p.0.to_lowercase();
            match self.fixed.iter().find(|(f, _)| f.to_lowercase() == field) {
                Some((_, item)) if item.matches(&p.1) => {}
                Some(_) => return None,
                None => rest.push(p),
            }
        }
        let entry = self.entries.iter().find(|e| {
            e.data == data
                && e.key.len() == rest.len()
                && rest.iter().all(|(f, v)| {
                    let f = f.to_lowercase();
                    e.key
                        .iter()
                        .any(|(k, item)| k.to_lowercase() == f && item.matches(v))
                })
        })?;
        match &entry.value {
            Value::Empty => None,
            v => Some(v.clone()),
        }
    }
}

/// The pivot tables of one sheet, for [`CellProvider`](crate::CellProvider)
/// implementations.
pub fn find_pivot_value(
    tables: &[PivotData],
    at: CellCoord,
    data_field: &str,
    pairs: &[(String, Value)],
) -> Option<Value> {
    tables
        .iter()
        .find(|t| t.contains(at.row, at.col))?
        .lookup(data_field, pairs)
}

/// Pivot tables by sheet (the engine's registry).
pub(crate) type PivotRegistry = std::collections::HashMap<SheetId, Vec<PivotData>>;
