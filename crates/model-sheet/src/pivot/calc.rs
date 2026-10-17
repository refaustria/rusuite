//! Formulas of calculated fields and items (P9-C3).
//!
//! A formula names fields (calculated fields: `Sales*1.1`,
//! `'Unit Price'*Qty`) or items of the same field (calculated items:
//! `East+West`). The names are replaced by placeholders before the formula
//! is parsed with the engine's parser; evaluation hands the placeholders
//! their values as defined names, so every worksheet function works.

use std::collections::HashMap;
use std::sync::LazyLock;

use engine_formula::{
    evaluate, parse, CellCoord, CellProvider, ErrorKind, EvalContext, Expr, FunctionRegistry,
    SheetId, Value,
};

static FUNCTIONS: LazyLock<FunctionRegistry> = LazyLock::new(FunctionRegistry::with_builtins);

/// A parsed formula with the names it uses (`names[k]` is placeholder
/// `_pf<k>`, as written).
#[derive(Debug, Clone)]
pub(crate) struct Formula {
    expr: Expr,
    pub(crate) names: Vec<String>,
}

fn placeholder(k: usize) -> String {
    format!("_pf{k}")
}

/// Parses `formula` (with or without `=`): quoted names (`'Unit Price'`)
/// and bare identifiers for which `known` holds (not followed by `(`)
/// become placeholders. Fails with a message for a formula that does not
/// parse or names something unknown in quotes.
pub(crate) fn compile(formula: &str, known: impl Fn(&str) -> bool) -> Result<Formula, String> {
    let src = formula.trim();
    let src = src.strip_prefix('=').unwrap_or(src);
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len() + 8);
    let mut names: Vec<String> = Vec::new();
    let slot = |name: String, names: &mut Vec<String>| -> String {
        let at = names
            .iter()
            .position(|n| n.eq_ignore_ascii_case(&name))
            .unwrap_or_else(|| {
                names.push(name);
                names.len() - 1
            });
        placeholder(at)
    };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            // A string literal ("" escapes a quote).
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == '"' {
                    if chars.get(i + 1) == Some(&'"') {
                        out.push('"');
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c == '\'' {
            let mut name = String::new();
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    if chars.get(i + 1) == Some(&'\'') {
                        name.push('\'');
                        i += 2;
                        continue;
                    }
                    break;
                }
                name.push(chars[i]);
                i += 1;
            }
            i += 1;
            if !known(&name) {
                return Err(format!("unknown name '{name}'"));
            }
            out.push_str(&slot(name, &mut names));
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len()
                && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.')
            {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            let mut j = i;
            while j < chars.len() && chars[j] == ' ' {
                j += 1;
            }
            let call = chars.get(j) == Some(&'(');
            if !call && known(&word) {
                out.push_str(&slot(word, &mut names));
            } else {
                out.push_str(&word);
            }
            continue;
        }
        if c.is_ascii_digit() {
            // Numbers (with exponents) stay as they are.
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric()
                    || chars[i] == '.'
                    || ((chars[i] == '+' || chars[i] == '-') && matches!(chars[i - 1], 'e' | 'E')))
            {
                out.push(chars[i]);
                i += 1;
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    let expr = parse(&out).map_err(|e| e.to_string())?;
    Ok(Formula { expr, names })
}

struct Names {
    defs: HashMap<String, Expr>,
}

impl CellProvider for Names {
    fn sheet_id(&self, _name: &str) -> Option<SheetId> {
        None
    }

    fn value(&self, _c: CellCoord) -> Value {
        Value::Empty
    }

    fn used_range(&self, _sheet: SheetId) -> Option<(u32, u32)> {
        None
    }

    fn defined_name(&self, name: &str, _sheet: SheetId) -> Option<&Expr> {
        self.defs.get(&name.to_lowercase())
    }
}

fn literal(v: Value) -> Expr {
    match v {
        Value::Number(n) => Expr::Number(n),
        Value::Empty => Expr::Number(0.0),
        Value::Text(t) => Expr::Text(t),
        Value::Bool(b) => Expr::Bool(b),
        Value::Error(e) => Expr::Error(e),
        Value::Array(_) => Expr::Error(ErrorKind::Value),
    }
}

/// Evaluates `f` with `value_of(k)` as the value of its name `k`.
pub(crate) fn eval(f: &Formula, mut value_of: impl FnMut(usize) -> Value) -> Value {
    let defs = (0..f.names.len())
        .map(|k| (placeholder(k), literal(value_of(k))))
        .collect();
    let names = Names { defs };
    let ctx = EvalContext::new(&names, &FUNCTIONS, CellCoord::new(SheetId(0), 0, 0));
    match evaluate(&f.expr, &ctx) {
        Value::Array(a) => a.top_left(),
        v => v,
    }
}

impl crate::Workbook {
    /// Calculated fields of pivot table `id`'s cache (Excel's Fields,
    /// Items & Sets › Calculated Field): `field` `None` adds field `name`
    /// with `formula` and puts `Sum of <name>` in the table's values; with
    /// a field, its name and formula change, or it goes (`formula`
    /// `None`). The formula names fields (quoted when they have spaces).
    /// Every table of the cache is rewritten; on error nothing changes.
    pub fn set_calculated_field(
        &mut self,
        id: u32,
        field: Option<u32>,
        name: &str,
        formula: Option<&str>,
    ) -> Result<engine_formula::Recalc, crate::Error> {
        use super::{CacheField, DataField, FieldKind};
        let bad = |m: String| crate::Error::InvalidPivot(m);
        let (s, i) = self.locate_pivot(id)?;
        let table = &self.pivots(s)[i];
        let mut cache = self
            .pivot_cache(table.cache_id)
            .cloned()
            .ok_or_else(|| bad("no cache".into()))?;
        if cache.raw.is_some() || table.raw.is_some() {
            return Err(bad("this pivot table is read-only".into()));
        }
        let n = cache.fields.len() as u32;
        let identity: Vec<Option<u32>> = (0..n).map(Some).collect();
        let name = name.trim();
        match (field, formula) {
            (Some(f), None) => {
                if cache
                    .fields
                    .get(f as usize)
                    .and_then(|x| x.formula.as_ref())
                    .is_none()
                {
                    return Err(bad(format!("field {f} is not a calculated field")));
                }
                let map = cache.remove_field(f);
                self.replace_pivot_cache(id, cache, map, &[], |_| {})
            }
            (field, Some(formula)) => {
                if name.is_empty() {
                    return Err(bad("the calculated field needs a name".into()));
                }
                if cache
                    .fields
                    .iter()
                    .enumerate()
                    .any(|(k, x)| Some(k as u32) != field && x.name.eq_ignore_ascii_case(name))
                {
                    return Err(bad(format!("the field name {name:?} is taken")));
                }
                let names: Vec<String> = cache.fields.iter().map(|f| f.name.clone()).collect();
                compile(formula, |x| names.iter().any(|n| n.eq_ignore_ascii_case(x)))
                    .map_err(|e| bad(format!("formula: {e}")))?;
                let formula = formula.trim().trim_start_matches('=').to_owned();
                match field {
                    Some(f) => {
                        let cf = cache
                            .fields
                            .get_mut(f as usize)
                            .filter(|x| x.formula.is_some())
                            .ok_or_else(|| bad(format!("field {f} is not a calculated field")))?;
                        cf.name = name.to_owned();
                        cf.formula = Some(formula);
                        self.replace_pivot_cache(id, cache, identity, &[], |_| {})
                    }
                    None => {
                        let mut cf = CacheField::new(name);
                        cf.kind = FieldKind::Number;
                        cf.formula = Some(formula);
                        cache.fields.push(cf);
                        let len = cache.fields.len();
                        for r in &mut cache.records {
                            r.resize(len, super::Item::Blank);
                        }
                        let new = len as u32 - 1;
                        self.replace_pivot_cache(id, cache, identity, &[], |t| {
                            t.values.push(DataField::sum(new));
                        })
                    }
                }
            }
            (None, None) => Err(bad("nothing to do".into())),
        }
    }

    /// Calculated items of field `field` (Excel's Calculated Item): `item`
    /// `None` adds item `name` = `formula` over the field's items; with an
    /// item (a calculated one), its name and formula change, or it goes
    /// (`formula` `None`). Grouped fields have none (as in Excel).
    pub fn set_calculated_item(
        &mut self,
        id: u32,
        field: u32,
        item: Option<u32>,
        name: &str,
        formula: Option<&str>,
    ) -> Result<engine_formula::Recalc, crate::Error> {
        use super::{CalculatedItem, Item};
        let bad = |m: String| crate::Error::InvalidPivot(m);
        let (s, i) = self.locate_pivot(id)?;
        let table = &self.pivots(s)[i];
        let mut cache = self
            .pivot_cache(table.cache_id)
            .cloned()
            .ok_or_else(|| bad("no cache".into()))?;
        if cache.raw.is_some() || table.raw.is_some() {
            return Err(bad("this pivot table is read-only".into()));
        }
        let cf = cache
            .fields
            .get(field as usize)
            .ok_or_else(|| bad(format!("no field {field}")))?;
        if cf.group.is_some() || cf.formula.is_some() {
            return Err(bad("this field cannot have calculated items".into()));
        }
        let n = cache.fields.len() as u32;
        let identity: Vec<Option<u32>> = (0..n).map(Some).collect();
        let labels: Vec<String> = cf
            .shared_items
            .iter()
            .map(|i| i.label(cf.number_format.as_deref()))
            .collect();
        let name = name.trim();
        match (item, formula) {
            (Some(it), None) => {
                if cache.calculated_item(field, it).is_none() {
                    return Err(bad("not a calculated item".into()));
                }
                cache.fields[field as usize]
                    .shared_items
                    .remove(it as usize);
                cache
                    .calculated_items
                    .retain(|c| !(c.field == field && c.item == it));
                for c in &mut cache.calculated_items {
                    if c.field == field && c.item > it {
                        c.item -= 1;
                    }
                }
                let item_maps: Vec<Vec<Option<u32>>> = cache
                    .fields
                    .iter()
                    .enumerate()
                    .map(|(f, x)| {
                        let len = x.shared_items.len() as u32 + u32::from(f as u32 == field);
                        (0..len)
                            .map(|k| {
                                if f as u32 != field {
                                    Some(k)
                                } else {
                                    match k.cmp(&it) {
                                        std::cmp::Ordering::Less => Some(k),
                                        std::cmp::Ordering::Equal => None,
                                        std::cmp::Ordering::Greater => Some(k - 1),
                                    }
                                }
                            })
                            .collect()
                    })
                    .collect();
                self.replace_pivot_cache_with(id, cache, identity, item_maps, |_| {})
            }
            (item, Some(formula)) => {
                if name.is_empty() {
                    return Err(bad("the calculated item needs a name".into()));
                }
                if labels
                    .iter()
                    .enumerate()
                    .any(|(k, l)| Some(k as u32) != item && l.eq_ignore_ascii_case(name))
                {
                    return Err(bad(format!("the item name {name:?} is taken")));
                }
                compile(formula, |x| {
                    labels.iter().any(|n| n.eq_ignore_ascii_case(x))
                })
                .map_err(|e| bad(format!("formula: {e}")))?;
                let formula = formula.trim().trim_start_matches('=').to_owned();
                let cfm = &mut cache.fields[field as usize];
                match item {
                    Some(it) => {
                        let c = cache
                            .calculated_items
                            .iter_mut()
                            .find(|c| c.field == field && c.item == it)
                            .ok_or_else(|| bad("not a calculated item".into()))?;
                        c.formula = formula;
                        cfm.shared_items[it as usize] = Item::Text(name.to_owned());
                    }
                    None => {
                        cfm.shared_items.push(Item::Text(name.to_owned()));
                        let it = cfm.shared_items.len() as u32 - 1;
                        cache.calculated_items.push(CalculatedItem {
                            field,
                            item: it,
                            formula,
                        });
                    }
                }
                self.replace_pivot_cache(id, cache, identity, &[], |_| {})
            }
            (None, None) => Err(bad("nothing to do".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(src: &str, vals: &[(&str, f64)]) -> Value {
        let known = |n: &str| vals.iter().any(|(k, _)| k.eq_ignore_ascii_case(n));
        let f = compile(src, known).unwrap();
        eval(&f, |k| {
            let name = &f.names[k];
            Value::Number(
                vals.iter()
                    .find(|(n, _)| n.eq_ignore_ascii_case(name))
                    .unwrap()
                    .1,
            )
        })
    }

    #[test]
    fn names_numbers_and_functions() {
        assert_eq!(run("=Sales*1.1", &[("Sales", 10.0)]), Value::Number(11.0));
        assert_eq!(
            run("'Unit Price'*qty", &[("Unit Price", 2.5), ("Qty", 4.0)]),
            Value::Number(10.0)
        );
        assert_eq!(
            run("IF(Q1>Q2,Q1,Q2)+1e1", &[("Q1", 3.0), ("Q2", 7.0)]),
            Value::Number(17.0)
        );
        assert_eq!(
            run("East/West", &[("East", 1.0), ("West", 0.0)]),
            Value::Error(ErrorKind::Div0)
        );
        assert!(compile("'Nope'*2", |_| false).is_err());
        assert!(compile("Sales*", |_| true).is_err());
    }
}
