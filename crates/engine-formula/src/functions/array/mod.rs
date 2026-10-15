//! Dynamic array functions (Excel 365): `SORT`, `SORTBY`, `FILTER`,
//! `UNIQUE`, `SEQUENCE`, `RANDARRAY`. Their results are arrays that spill
//! when they are the result of a cell formula (see
//! [`Engine`](crate::Engine)); inside other functions they work as arrays
//! (`SUM(SEQUENCE(4))`, `INDEX(SORT(A1:A9),1)`).

use std::cmp::Ordering;

use crate::ast::{ErrorKind, Expr};
use crate::functions::lookup::util::Table;
use crate::functions::{CallContext, FunctionRegistry};
use crate::value::{to_number, Array, Value};

pub mod filter;
pub mod randarray;
pub mod sequence;
pub mod sort;
pub mod sortby;
#[cfg(test)]
mod tests;
pub mod unique;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(filter::Filter));
    r.register(Box::new(randarray::RandArray));
    r.register(Box::new(sequence::Sequence));
    r.register(Box::new(sort::Sort));
    r.register(Box::new(sortby::SortBy));
    r.register(Box::new(unique::Unique));
}

/// Largest array the generating functions (`SEQUENCE`, `RANDARRAY`)
/// build; bigger requests give `#NUM!`.
pub(crate) const MAX_ARRAY_CELLS: usize = 1 << 24;

/// A rectangular block of values (row-major).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Grid {
    pub rows: usize,
    pub cols: usize,
    pub data: Vec<Value>,
}

impl Grid {
    /// The values of a range or array argument; whole-column/row
    /// references are clipped to the used range (at least one cell).
    pub fn of(ctx: &CallContext, e: &Expr) -> Result<Grid, ErrorKind> {
        let t = Table::new(ctx.range(e)?);
        let rows = t.used_rows.clamp(1, t.rows.max(1));
        let cols = t.used_cols.clamp(1, t.cols.max(1));
        let mut data = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for c in 0..cols {
                data.push(t.get(r, c));
            }
        }
        Ok(Grid { rows, cols, data })
    }

    pub fn row(&self, r: usize) -> &[Value] {
        &self.data[r * self.cols..(r + 1) * self.cols]
    }

    pub fn get(&self, r: usize, c: usize) -> &Value {
        &self.data[r * self.cols + c]
    }

    pub fn transpose(&self) -> Grid {
        let mut data = Vec::with_capacity(self.data.len());
        for c in 0..self.cols {
            for r in 0..self.rows {
                data.push(self.get(r, c).clone());
            }
        }
        Grid {
            rows: self.cols,
            cols: self.rows,
            data,
        }
    }

    /// The rows `order` (indices into `self`), in that order.
    pub fn pick_rows(&self, order: &[usize]) -> Grid {
        Grid {
            rows: order.len(),
            cols: self.cols,
            data: order
                .iter()
                .flat_map(|&r| self.row(r).iter().cloned())
                .collect(),
        }
    }

    /// The result value: one cell → that value, otherwise an array; no
    /// cells → `#CALC!`.
    pub fn into_value(self) -> Result<Value, ErrorKind> {
        if self.rows == 0 || self.cols == 0 {
            return Err(ErrorKind::Calc);
        }
        if self.rows * self.cols == 1 {
            return Ok(self.data.into_iter().next().unwrap_or(Value::Empty));
        }
        Array::new(self.rows, self.cols, self.data)
            .map(Value::Array)
            .ok_or(ErrorKind::Value)
    }
}

/// The numbers of a scalar or array argument (errors propagate).
pub(crate) fn numbers(ctx: &CallContext, e: &Expr) -> Result<Vec<f64>, ErrorKind> {
    Grid::of(ctx, e)?.data.iter().map(to_number).collect()
}

/// A size argument of `SEQUENCE`/`RANDARRAY` (truncated): negative
/// `#VALUE!`, zero `#CALC!`.
pub(crate) fn size_arg(n: f64) -> Result<usize, ErrorKind> {
    let n = n.trunc();
    if n < 0.0 {
        Err(ErrorKind::Value)
    } else if n == 0.0 {
        Err(ErrorKind::Calc)
    } else if n > 1_048_576.0 {
        Err(ErrorKind::Value)
    } else {
        Ok(n as usize)
    }
}

/// The checked cell count of a `rows × cols` result.
pub(crate) fn cell_count(rows: usize, cols: usize) -> Result<usize, ErrorKind> {
    rows.checked_mul(cols)
        .filter(|&n| n <= MAX_ARRAY_CELLS)
        .ok_or(ErrorKind::Num)
}

/// Sort rank of a value: numbers, text, booleans, errors; blanks last in
/// either direction.
fn rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Bool(_) => 2,
        Value::Error(_) | Value::Array(_) => 3,
        Value::Empty => 4,
    }
}

/// The ordering of `SORT`/`SORTBY` keys: numbers < text (case-insensitive)
/// < booleans < errors, reversed when `descending`; blank cells always go
/// last.
pub(crate) fn sort_cmp(a: &Value, b: &Value, descending: bool) -> Ordering {
    let (ra, rb) = (rank(a), rank(b));
    if ra == 4 || rb == 4 {
        return ra.cmp(&rb);
    }
    let o = if ra != rb {
        ra.cmp(&rb)
    } else {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
            (Value::Text(x), Value::Text(y)) => x.to_uppercase().cmp(&y.to_uppercase()),
            (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
            _ => Ordering::Equal,
        }
    };
    if descending {
        o.reverse()
    } else {
        o
    }
}

/// A sort order argument: `1` ascending, `-1` descending, else `#VALUE!`.
pub(crate) fn descending(order: f64) -> Result<bool, ErrorKind> {
    let o = order.trunc();
    if o == 1.0 {
        Ok(false)
    } else if o == -1.0 {
        Ok(true)
    } else {
        Err(ErrorKind::Value)
    }
}

/// Equality of two values for `UNIQUE`: same type and equal
/// (text case-insensitively); blanks equal blanks.
pub(crate) fn same(a: &Value, b: &Value) -> bool {
    rank(a) == rank(b) && sort_cmp(a, b, false) == Ordering::Equal && {
        match (a, b) {
            (Value::Error(x), Value::Error(y)) => x == y,
            _ => true,
        }
    }
}
