//! Date and time functions (1900 date system with the Lotus leap-year bug).

pub mod date;
pub mod day;
pub mod days;
pub mod month;
pub mod now;
pub mod serial;
pub mod today;
pub mod weekday;
pub mod year;

use super::FunctionRegistry;

/// Registers every function of this family.
pub fn register(r: &mut FunctionRegistry) {
    r.register(Box::new(today::Today));
    r.register(Box::new(now::Now));
    r.register(Box::new(date::Date));
    r.register(Box::new(year::Year));
    r.register(Box::new(month::Month));
    r.register(Box::new(day::Day));
    r.register(Box::new(weekday::Weekday));
    r.register(Box::new(days::Days));
}
