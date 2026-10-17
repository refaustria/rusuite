//! Lookup and reference functions.

use super::FunctionRegistry;

pub mod address;
pub mod areas;
pub mod choose;
pub mod column;
pub mod getpivotdata;
pub mod hlookup;
pub mod hyperlink;
pub mod index;
pub mod indirect;
pub mod lookup_;
pub mod match_;
pub mod offset;
pub mod row;
pub mod rows;
#[cfg(test)]
mod tests;
pub mod transpose;
pub(crate) mod util;
pub mod vlookup;
pub mod xlookup;
pub mod xmatch;

/// Registers every lookup/reference function.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(areas::Areas));
    r.register(Box::new(choose::Choose));
    r.register(Box::new(column::Column));
    r.register(Box::new(hlookup::Hlookup));
    r.register(Box::new(index::Index));
    r.register(Box::new(match_::Match));
    r.register(Box::new(row::Row));
    r.register(Box::new(vlookup::Vlookup));
    r.register(Box::new(rows::Rows));
    r.register(Box::new(rows::Columns));
    r.register(Box::new(lookup_::Lookup));
    r.register(Box::new(xmatch::XMatch));
    r.register(Box::new(xlookup::XLookup));
    r.register(Box::new(indirect::Indirect));
    r.register(Box::new(offset::Offset));
    r.register(Box::new(address::Address));
    r.register(Box::new(transpose::Transpose));
    r.register(Box::new(hyperlink::Hyperlink));
    r.register(Box::new(getpivotdata::GetPivotData));
}
