//! `GETPIVOTDATA(data_field, pivot_table, [field1, item1], ...)`.

use crate::ast::{ErrorKind, Expr};
use crate::eval::CellCoord;
use crate::functions::lookup::util::reference_arg;
use crate::functions::{Arity, CallContext, Function};
use crate::value::{to_text, Value};

/// The value of a pivot table: `data_field` names a data field (its
/// caption such as `"Sum of Sales"` or the source field `"Sales"`),
/// `pivot_table` is any cell of the pivot table, the field/item pairs
/// select the row and column (none = the grand total). Only values the
/// pivot table shows are found: a hidden subtotal, a grand total that is
/// switched off, a filtered item, an empty cell or a cell outside every
/// pivot table give `#REF!` (see [`crate::PivotData::lookup`]). Items
/// match by value or by their label (text ignoring case). Volatile: the
/// document model rewrites pivot tables on refresh.
pub struct GetPivotData;

impl Function for GetPivotData {
    fn name(&self) -> &'static str {
        "GETPIVOTDATA"
    }

    fn arity(&self) -> Arity {
        Arity::range(2, 254)
    }

    fn is_volatile(&self) -> bool {
        true
    }

    fn call(&self, args: &[Expr], ctx: &mut CallContext) -> Value {
        let data_field = match ctx.scalar(&args[0]) {
            Value::Error(e) => return Value::Error(e),
            v => match to_text(&v) {
                Ok(t) => t,
                Err(e) => return Value::Error(e),
            },
        };
        let at = match reference_arg(&args[1], ctx) {
            Ok(r) => CellCoord::new(r.sheet, r.r0, r.c0),
            Err(_) => return Value::Error(ErrorKind::Ref),
        };
        let rest = &args[2..];
        if rest.len() % 2 == 1 {
            return Value::Error(ErrorKind::Ref);
        }
        let mut pairs = Vec::with_capacity(rest.len() / 2);
        for pair in rest.chunks(2) {
            let field = match ctx.scalar(&pair[0]) {
                Value::Error(e) => return Value::Error(e),
                v => match to_text(&v) {
                    Ok(t) => t,
                    Err(e) => return Value::Error(e),
                },
            };
            let item = match ctx.scalar(&pair[1]) {
                Value::Error(e) => return Value::Error(e),
                v => v,
            };
            pairs.push((field, item));
        }
        ctx.eval_context()
            .provider
            .pivot_data(at, &data_field, &pairs)
            .unwrap_or(Value::Error(ErrorKind::Ref))
    }
}
