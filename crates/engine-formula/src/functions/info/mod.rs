//! Information functions.

pub mod cell;
pub mod isblank;
pub mod iserr;
pub mod iserror;
pub mod iseven;
pub mod islogical;
pub mod isna;
pub mod isnontext;
pub mod isnumber;
pub mod isref;
pub mod istext;
pub mod n;
pub mod na;
pub mod t;
#[cfg(test)]
mod tests;
pub mod type_;

use super::FunctionRegistry;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(na::Na));
    r.register(Box::new(iserror::IsError));
    r.register(Box::new(isblank::IsBlank));
    r.register(Box::new(isnumber::IsNumber));
    r.register(Box::new(istext::IsText));
    r.register(Box::new(isna::IsNa));
    r.register(Box::new(islogical::IsLogical));
    r.register(Box::new(isnontext::IsNonText));
    r.register(Box::new(iserr::IsErr));
    r.register(Box::new(isref::IsRef));
    r.register(Box::new(iseven::IsEven));
    r.register(Box::new(iseven::IsOdd));
    r.register(Box::new(n::N));
    r.register(Box::new(t::T));
    r.register(Box::new(type_::Type));
    r.register(Box::new(cell::Cell));
}
