//! Information functions.

pub mod isblank;
pub mod iserror;
pub mod isna;
pub mod isnumber;
pub mod istext;
pub mod na;

use super::FunctionRegistry;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(na::Na));
    r.register(Box::new(iserror::IsError));
    r.register(Box::new(isblank::IsBlank));
    r.register(Box::new(isnumber::IsNumber));
    r.register(Box::new(istext::IsText));
    r.register(Box::new(isna::IsNa));
}
