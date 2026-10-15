//! Text functions.

use super::FunctionRegistry;

pub mod concat;
pub mod concatenate;
pub mod exact;
pub mod find;
pub mod left;
pub mod len;
pub mod lower;
pub mod mid;
pub(crate) mod numfmt;
pub mod right;
pub mod substitute;
pub mod text_;
pub mod trim;
pub mod upper;
pub mod value;

/// Registers every text function.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(concat::Concat));
    r.register(Box::new(concatenate::Concatenate));
    r.register(Box::new(exact::Exact));
    r.register(Box::new(find::Find));
    r.register(Box::new(left::Left));
    r.register(Box::new(len::Len));
    r.register(Box::new(lower::Lower));
    r.register(Box::new(mid::Mid));
    r.register(Box::new(right::Right));
    r.register(Box::new(substitute::Substitute));
    r.register(Box::new(text_::Text));
    r.register(Box::new(trim::Trim));
    r.register(Box::new(upper::Upper));
    r.register(Box::new(value::ValueFn));
}

/// Truncated integer argument as `usize`; negative → `#VALUE!`.
pub(crate) fn count_arg(n: f64) -> Result<usize, crate::ast::ErrorKind> {
    let t = n.trunc();
    if t < 0.0 {
        Err(crate::ast::ErrorKind::Value)
    } else {
        Ok(t as usize)
    }
}
