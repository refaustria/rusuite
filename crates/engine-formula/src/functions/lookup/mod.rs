//! Lookup and reference functions.

use super::FunctionRegistry;

pub mod choose;
pub mod column;
pub mod hlookup;
pub mod index;
pub mod match_;
pub mod row;
pub(crate) mod util;
pub mod vlookup;

/// Registers every lookup/reference function.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(choose::Choose));
    r.register(Box::new(column::Column));
    r.register(Box::new(hlookup::Hlookup));
    r.register(Box::new(index::Index));
    r.register(Box::new(match_::Match));
    r.register(Box::new(row::Row));
    r.register(Box::new(vlookup::Vlookup));
}
