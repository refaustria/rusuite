//! Text functions.

use super::FunctionRegistry;

pub mod char_;
pub mod clean;
pub mod concat;
pub mod concatenate;
pub mod exact;
pub mod find;
pub mod fixed;
pub mod left;
pub mod len;
pub mod lower;
pub mod mid;
pub mod numbervalue;
pub(crate) mod numfmt;
pub mod proper;
pub mod replace;
pub mod rept;
pub mod right;
pub mod search;
pub mod substitute;
#[cfg(test)]
mod tests;
pub mod text_;
pub mod textjoin;
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
    r.register(Box::new(search::Search));
    r.register(Box::new(replace::Replace));
    r.register(Box::new(rept::Rept));
    r.register(Box::new(proper::Proper));
    r.register(Box::new(char_::Char));
    r.register(Box::new(char_::Code));
    r.register(Box::new(char_::Unicode));
    r.register(Box::new(char_::UniChar));
    r.register(Box::new(clean::Clean));
    r.register(Box::new(numbervalue::NumberValue));
    r.register(Box::new(fixed::Fixed));
    r.register(Box::new(textjoin::TextJoin));
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
