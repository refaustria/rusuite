//! `XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])`.

use std::cmp::Ordering;

use crate::ast::{ErrorKind, Expr};
use crate::functions::helpers::opt_num;
use crate::functions::lookup::util::{lookup_value, wildcard_match, Table};
use crate::functions::{Arity, CallContext};
use crate::value::{compare, Value};

fn kind(v: &Value) -> Option<u8> {
    match v {
        Value::Number(_) => Some(0),
        Value::Text(_) => Some(1),
        Value::Bool(_) => Some(2),
        _ => None,
    }
}

/// Parsed `match_mode` / `search_mode` arguments at `args[i]`, `args[i+1]`.
pub(crate) fn modes(args: &[Expr], ctx: &CallContext, i: usize) -> Result<(i32, i32), ErrorKind> {
    let m = opt_num(ctx, args, i, 0.0)?.trunc() as i32;
    let s = opt_num(ctx, args, i + 1, 1.0)?.trunc() as i32;
    if !(-1..=2).contains(&m) || !matches!(s, -2 | -1 | 1 | 2) {
        return Err(ErrorKind::Value);
    }
    Ok((m, s))
}

/// The 1-D item list of a lookup array (`#VALUE!` if it is 2-D).
pub(crate) fn items(table: &Table) -> Result<(Vec<Value>, bool), ErrorKind> {
    if table.rows > 1 && table.cols > 1 {
        return Err(ErrorKind::Value);
    }
    let vertical = table.cols == 1;
    let n = if vertical {
        table.used_rows
    } else {
        table.used_cols
    };
    let v = (0..n)
        .map(|i| {
            if vertical {
                table.get(i, 0)
            } else {
                table.get(0, i)
            }
        })
        .collect();
    Ok((v, vertical))
}

/// 0-based index of the match of `needle` among `items`.
pub(crate) fn locate(
    needle: &Value,
    items: &[Value],
    match_mode: i32,
    search_mode: i32,
) -> Option<usize> {
    let k = kind(needle)?;
    let order: Vec<usize> = if search_mode < 0 {
        (0..items.len()).rev().collect()
    } else {
        (0..items.len()).collect()
    };
    let exact = |v: &Value| match (needle, v) {
        (Value::Text(p), Value::Text(t)) if match_mode == 2 => wildcard_match(p, t),
        _ => kind(v) == Some(k) && compare(v, needle) == Ok(Ordering::Equal),
    };
    if let Some(&i) = order.iter().find(|&&i| exact(&items[i])) {
        return Some(i);
    }
    if match_mode != -1 && match_mode != 1 {
        return None;
    }
    let want = if match_mode == -1 {
        Ordering::Less
    } else {
        Ordering::Greater
    };
    let mut best: Option<usize> = None;
    for &i in &order {
        let v = &items[i];
        if kind(v) != Some(k) || compare(v, needle) != Ok(want) {
            continue;
        }
        let better = match best {
            None => true,
            Some(b) => compare(v, &items[b]) == Ok(want.reverse()),
        };
        if better {
            best = Some(i);
        }
    }
    best
}

function!(
    /// 1-based position of a value in a one-dimensional array. Match mode
    /// 0 exact (default), -1 exact or next smaller, 1 exact or next larger,
    /// 2 wildcards; search mode 1 first-to-last, -1 last-to-first, 2/-2
    /// binary search on ascending/descending data (evaluated as a scan,
    /// which gives the same result on sorted data). Not found is `#N/A`.
    XMatch, "XMATCH", Arity::range(2, 4), |args, ctx| {
    let needle = ctx.scalar(&args[0]);
    if let Value::Error(e) = needle {
        return Err(e);
    }
    let needle = lookup_value(needle);
    let table = Table::new(ctx.range(&args[1])?);
    let (m, s) = modes(args, ctx, 2)?;
    let (items, _) = items(&table)?;
    locate(&needle, &items, m, s)
        .map(|i| Value::Number((i + 1) as f64))
        .ok_or(ErrorKind::NA)
});
